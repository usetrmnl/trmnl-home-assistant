/**
 * Who may use the add-on's port directly, outside Home Assistant ingress.
 *
 * @module lib/direct-access
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Supervisor's address on the hassio network; ingress requests come from it. */
const SUPERVISOR_ADDRESS = '172.30.32.2'

/** Home Assistant OS installs the app with its sidebar entry turned off. */
const OPEN_FROM_SIDEBAR =
  'Open TRMNL HA from the Home Assistant sidebar (if it is not there, turn on "Show in sidebar" on the app\'s Info tab)'

export interface DirectAccessPolicy {
  isAddOn: boolean
  secret?: string
}

/**
 * Returns why a request is refused, or null when it may pass. Ingress is
 * already signed in to Home Assistant, so only direct requests are checked.
 */
export function directAccessRefusal(
  request: IncomingMessage,
  requestUrl: URL,
  { isAddOn, secret }: DirectAccessPolicy,
): string | null {
  if (!isAddOn || requestUrl.pathname === '/health' || isFromSupervisor(request)) return null

  if (isSettingsPage(requestUrl)) return `${OPEN_FROM_SIDEBAR}.`

  if (secret) {
    return hasSecret(request, requestUrl, secret)
      ? null
      : 'This port needs the direct access secret: add ?secret=<secret> or an Authorization: Bearer header.'
  }

  return requestUrl.pathname.startsWith('/api/')
    ? `${OPEN_FROM_SIDEBAR}, or set direct_access_secret to use the API on this port.`
    : null
}

/** Adds the secret to a URL that a device or BYOS server fetches from this port. */
export function withDirectAccessSecret(url: string, secret: string | undefined): string {
  if (!secret) return url
  const withSecret = new URL(url)
  withSecret.searchParams.set('secret', secret)
  return withSecret.toString()
}

function isFromSupervisor(request: IncomingMessage): boolean {
  return request.socket.remoteAddress?.replace(/^::ffff:/, '') === SUPERVISOR_ADDRESS
}

function isSettingsPage({ pathname, searchParams }: URL): boolean {
  return pathname === '/' && !searchParams.has('url')
}

function hasSecret(request: IncomingMessage, requestUrl: URL, secret: string): boolean {
  const bearer = request.headers.authorization?.replace(/^Bearer /, '')
  return [requestUrl.searchParams.get('secret'), bearer].some(
    (given) => given !== null && given !== undefined && secretsMatch(given, secret),
  )
}

function secretsMatch(given: string, secret: string): boolean {
  const givenBytes = Buffer.from(given)
  const secretBytes = Buffer.from(secret)
  return givenBytes.length === secretBytes.length && timingSafeEqual(givenBytes, secretBytes)
}
