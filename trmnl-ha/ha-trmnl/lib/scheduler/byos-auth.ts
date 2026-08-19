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
 * enabled (rodauth's jwt_access_token_period, 1800s). Terminus enables session
 * expiration by default; the Terminus add-on turns it off, which makes tokens
 * ~100-year, so this window matters for any install that keeps it on.
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
 * Whether a stored login is available to re-authenticate with. Refreshing
 * cannot outlive the server's session lifetime cap, so this is the only way
 * back for a schedule that nobody is watching.
 */
export function canRelogin(auth: ByosAuthConfig): boolean {
  return Boolean(auth.login_email && auth.login_password)
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
 * Re-authenticates with the stored login and adopts the tokens it returns.
 *
 * @returns New access token, or null when no login is stored or it failed
 */
async function relogin(
  baseUrl: string,
  auth: ByosAuthConfig,
  onTokenRefresh?: (newTokens: TokenResponse) => void,
): Promise<string | null> {
  if (!canRelogin(auth)) return null

  try {
    const tokens = await login(baseUrl, auth.login_email!, auth.login_password!)
    adoptTokens(auth, tokens, onTokenRefresh)
    log.info`BYOS auth: re-authenticated with the stored login`
    return tokens.access_token
  } catch (err) {
    log.error`BYOS auth: re-authentication failed: ${(err as Error).message}`
    return null
  }
}

/** Copies fresh tokens into the in-memory auth and persists them. */
function adoptTokens(
  auth: ByosAuthConfig,
  tokens: TokenResponse,
  onTokenRefresh?: (newTokens: TokenResponse) => void,
): void {
  auth.access_token = tokens.access_token
  auth.refresh_token = tokens.refresh_token
  auth.obtained_at = Date.now()
  onTokenRefresh?.(tokens)
}

/**
 * Gets a valid access token, refreshing if needed. A failed refresh falls
 * back to the stored access token — it usually stays valid, and a push with a
 * genuinely expired token fails no worse than one with none.
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

    adoptTokens(auth, newTokens, onTokenRefresh)

    return newTokens.access_token
  } catch (err) {
    // A rejected refresh is not proof the session died: Rodauth rotates
    // refresh tokens on use, so a concurrent refresh (send path vs keepalive,
    // each holding its own copy of the auth config) leaves the loser with an
    // invalid refresh token → 400. See issue #75.
    //
    // A stored login recovers the case that is real - the server expired the
    // session, which refreshing can never outlive. Without one, keep using the
    // stored access token: it is usually still valid on the server (tokens
    // live ~100 years where session expiration is off, and where it is on they
    // outlive the refresh window), and a push with a genuinely dead token
    // fails no worse than one with none.
    log.warn`BYOS auth: refresh failed: ${(err as Error).message}`
    return (
      (await relogin(getBaseUrl(webhookUrl), auth, onTokenRefresh)) ??
      auth.access_token
    )
  }
}
