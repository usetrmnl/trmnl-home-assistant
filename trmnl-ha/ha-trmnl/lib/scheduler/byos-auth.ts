/**
 * BYOS Hanami JWT Authentication Manager
 *
 * Handles token refresh for BYOS API. Tokens are stored in schedule config,
 * NOT credentials - user authenticates once via UI, tokens are saved.
 *
 * @module lib/scheduler/byos-auth
 */

import type { ByosAuthConfig } from '../../types/domain.js'
import { webhookLogger } from '../logger.js'

const log = webhookLogger()

/** Token response from BYOS login/refresh endpoints */
export interface TokenResponse {
  access_token: string
  refresh_token: string
  success?: string
}

/** Token validity duration (25 min to refresh before 30 min expiry) */
const ACCESS_TOKEN_VALIDITY_MS = 25 * 60 * 1000

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
    log.warn`BYOS auth: refresh failed (${response.status})`
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
 * Gets a valid access token, refreshing if needed.
 * Returns null if tokens are missing/expired and need re-authentication.
 *
 * @param webhookUrl - Full webhook URL (base URL is extracted)
 * @param auth - Stored auth config with tokens
 * @param onTokenRefresh - Callback to save new tokens (called on refresh)
 * @returns Access token or null if re-auth needed
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

    // Notify caller to save new tokens
    if (onTokenRefresh) {
      onTokenRefresh(newTokens)
    }

    return newTokens.access_token
  } catch (err) {
    // Refresh failed - user needs to re-authenticate
    log.error`BYOS auth: refresh failed, re-authentication required: ${(err as Error).message}`
    return null
  }
}
