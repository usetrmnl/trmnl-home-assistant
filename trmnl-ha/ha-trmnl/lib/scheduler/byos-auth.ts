/**
 * BYOS Hanami JWT Authentication Manager
 *
 * Handles token refresh for BYOS API. Tokens are stored in schedule config,
 * NOT credentials - user authenticates once via UI, tokens are saved.
 *
 * @module lib/scheduler/byos-auth
 */

import type {
  ByosAuthConfig,
  Schedule,
  ScheduleUpdate,
} from '../../types/domain.js'
import { webhookLogger } from '../logger.js'

const log = webhookLogger()

/** Token response from BYOS login/refresh endpoints */
export interface TokenResponse {
  access_token: string
  refresh_token: string
  success?: string
}

/**
 * Token staleness threshold: refresh well before the 30 min server expiry.
 * The server rejects refreshes once the access token expires, so a fresher
 * token means restarts and outages of up to ~20 minutes keep the refresh
 * chain alive without re-authentication.
 */
const ACCESS_TOKEN_VALIDITY_MS = 10 * 60 * 1000

/**
 * Access token hard expiry on the BYOS server when session expiration is
 * enabled (rodauth's jwt_access_token_period, 1800s). Stock Terminus disables
 * session expiration and issues ~100-year tokens, so this window only matters
 * for hardened installs.
 *
 * NOTE: Rodauth rejects refresh requests once the access token has expired,
 * so past this window the only recovery is re-authentication.
 */
const ACCESS_TOKEN_EXPIRY_MS = 30 * 60 * 1000

/**
 * Extracts base URL from webhook URL.
 * e.g., "https://example.com/api/screens" → "https://example.com"
 */
export function getBaseUrl(webhookUrl: string): string {
  const url = new URL(webhookUrl)
  return `${url.protocol}//${url.host}`
}

/**
 * Checks if stored token is still valid (not expired).
 */
function isTokenValid(auth: ByosAuthConfig): boolean {
  if (!auth.obtained_at || !auth.access_token) return false
  const elapsed = Date.now() - auth.obtained_at
  return elapsed < ACCESS_TOKEN_VALIDITY_MS
}

/**
 * Checks whether stored tokens can still be refreshed. The BYOS server
 * rejects refresh requests once the access token itself has expired, so
 * callers should skip refresh attempts (and prompt re-auth) past this window.
 */
export function isRefreshable(auth: ByosAuthConfig): boolean {
  if (!auth.access_token || !auth.refresh_token || !auth.obtained_at)
    return false
  return Date.now() - auth.obtained_at < ACCESS_TOKEN_EXPIRY_MS
}

/**
 * Builds a schedule update that swaps in newly refreshed tokens while
 * preserving every other byosConfig field.
 *
 * @returns Update for persistence, or null when the schedule has no auth
 */
export function buildRefreshedAuthUpdate(
  schedule: Schedule,
  newTokens: TokenResponse,
): ScheduleUpdate | null {
  const byosConfig = schedule.webhook_format?.byosConfig
  if (!byosConfig?.auth) return null

  return {
    webhook_format: {
      ...schedule.webhook_format!,
      byosConfig: {
        ...byosConfig,
        auth: {
          ...byosConfig.auth,
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token,
          obtained_at: Date.now(),
        },
      },
    },
  }
}

/**
 * Performs login to get initial tokens.
 * Called from UI only - credentials are NOT stored.
 */
export async function login(
  baseUrl: string,
  loginEmail: string,
  password: string,
): Promise<TokenResponse> {
  const loginUrl = `${baseUrl}/login`
  log.info`BYOS auth: logging in to ${baseUrl}`

  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginEmail, password }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`BYOS login failed: ${response.status} ${text}`)
  }

  const data = (await response.json()) as TokenResponse
  if (!data.access_token || !data.refresh_token) {
    throw new Error('BYOS login response missing tokens')
  }

  log.info`BYOS auth: login successful`
  return data
}

/**
 * Refreshes access token using refresh token.
 */
async function refreshToken(
  baseUrl: string,
  auth: ByosAuthConfig,
): Promise<TokenResponse> {
  const refreshUrl = `${baseUrl}/api/jwt`
  log.info`BYOS auth: refreshing token`

  const response = await fetch(refreshUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth.access_token!,
    },
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    log.warn`BYOS auth: refresh failed (${response.status}) ${body}`
    throw new Error(`BYOS token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as TokenResponse
  if (!data.access_token || !data.refresh_token) {
    throw new Error('BYOS refresh response missing tokens')
  }

  log.info`BYOS auth: token refreshed successfully`
  return data
}

/**
 * Gets a valid access token, refreshing if needed. A failed refresh falls
 * back to the stored access token — on stock Terminus it stays valid, and a
 * push with a genuinely expired token fails no worse than one with none.
 *
 * @param webhookUrl - Full webhook URL (base URL is extracted)
 * @param auth - Stored auth config with tokens
 * @param onTokenRefresh - Callback to save new tokens (called on refresh)
 * @returns Access token, or null when no tokens are stored (re-auth needed)
 */
export async function getValidAccessToken(
  webhookUrl: string,
  auth: ByosAuthConfig,
  onTokenRefresh?: (newTokens: TokenResponse) => void,
): Promise<string | null> {
  // No tokens stored - need to authenticate
  if (!auth.access_token || !auth.refresh_token) {
    log.warn`BYOS auth: no tokens stored, authentication required`
    return null
  }

  // Token still valid - use it
  if (isTokenValid(auth)) {
    return auth.access_token
  }

  // Token expired - try to refresh
  try {
    const baseUrl = getBaseUrl(webhookUrl)
    const newTokens = await refreshToken(baseUrl, auth)

    // Update in-memory auth for current execution cycle
    auth.access_token = newTokens.access_token
    auth.refresh_token = newTokens.refresh_token
    auth.obtained_at = Date.now()

    // Persist new tokens to disk for future cron executions
    if (onTokenRefresh) {
      onTokenRefresh(newTokens)
    }

    return newTokens.access_token
  } catch (err) {
    // Rodauth rotates refresh tokens on use, so a concurrent refresh (send
    // path vs keepalive, each holding its own copy of the auth config) makes
    // the loser's refresh token invalid → 400. The stored access token is
    // still valid on the server (stock Terminus tokens live ~100 years, and
    // even with session expiration enabled it outlives the refresh window),
    // so use it rather than pushing unauthenticated. See issue #75.
    log.warn`BYOS auth: refresh failed, falling back to stored access token: ${(err as Error).message}`
    return auth.access_token
  }
}
