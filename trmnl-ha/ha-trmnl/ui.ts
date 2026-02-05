/**
 * Web UI request handler for the TRMNL HA add-on
 * Serves the configuration interface and error pages
 *
 * @module ui
 */

import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { lookup } from 'node:dns/promises'
import {
  createConnection,
  createLongLivedTokenAuth,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
} from 'home-assistant-js-websocket'
import type {
  HassConfig,
  Connection,
  ConnectionOptions,
} from 'home-assistant-js-websocket'
import type { HaWebSocket as LibHaWebSocket } from 'home-assistant-js-websocket/dist/socket.js'
import * as messages from 'home-assistant-js-websocket/dist/messages.js'
import { atLeastHaVersion } from 'home-assistant-js-websocket/dist/util.js'
import WebSocket from 'ws'
import { hassUrl, hassToken, SERVER_PORT } from './const.js'
import { loadPresets } from './devices.js'
import type { PresetsConfig } from './types/domain.js'
import { uiLogger } from './lib/logger.js'

const log = uiLogger()

// =============================================================================
// CONSTANTS
// =============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const HTML_DIR = join(__dirname, 'html')

// =============================================================================
// TYPES
// =============================================================================

/** Theme data from Home Assistant */
interface ThemesResult {
  themes: Record<string, Record<string, string>>
  default_theme: string
}

/** Network URL data from Home Assistant */
interface NetworkResult {
  external_url: string | null
  internal_url: string | null
}

/** Dashboard info from Home Assistant */
interface DashboardInfo {
  url_path: string
  title?: string
  mode?: string
}

/** Combined Home Assistant data for UI */
interface HomeAssistantData {
  themes: ThemesResult | null
  network: NetworkResult | null
  config: HassConfig | null
  dashboards: string[] | null
  presets?: PresetsConfig
}

/** UI configuration passed to frontend */
interface UIConfig {
  hasToken: boolean
  hassUrl: string
  /** Whether HA connection succeeded (themes/dashboards available) */
  haConnected: boolean
  /** First 4 chars of token masked (e.g., "eyJ1****") for debugging */
  tokenPreview: string | null
  /** Human-readable connection status reason */
  connectionStatus: string
  /** Timestamp when HA data was last fetched (for cache age display) */
  cachedAt: number | null
  /** Server port for constructing Fetch URLs (10000 for add-on, configurable for standalone) */
  serverPort: number
}

// =============================================================================
// HA DATA CACHE
// =============================================================================

/** Cached HA data to avoid blocking every UI request */
let cachedHassData: HomeAssistantData | null = null

/** Timestamp when cache was last populated */
let cacheTimestamp: number = 0

/** Tracks if the last connection error was an invalid auth token */
let lastConnectionErrorWasAuth: boolean = false

// =============================================================================
// CUSTOM WEBSOCKET WITH SSL BYPASS
// =============================================================================

/**
 * WebSocket interface extended with Home Assistant version
 * NOTE: We use a local interface because ws.WebSocket has different methods
 * than the browser's WebSocket that home-assistant-js-websocket expects.
 * We cast to the library's HaWebSocket type at the end.
 */
interface HaWebSocket extends WebSocket {
  haVersion: string
}

const MSG_TYPE_AUTH_REQUIRED = 'auth_required'
const MSG_TYPE_AUTH_INVALID = 'auth_invalid'
const MSG_TYPE_AUTH_OK = 'auth_ok'

/**
 * Extracts hostname from a URL for DNS diagnostics
 */
function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Checks if hostname can be resolved via DNS
 * Returns detailed diagnostic info for error logging
 */
async function checkDnsResolution(
  hostname: string,
): Promise<{ resolved: boolean; ip?: string; error?: string }> {
  try {
    const result = await lookup(hostname)
    return { resolved: true, ip: result.address }
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    return {
      resolved: false,
      error: `${error.code || 'UNKNOWN'}: ${error.message}`,
    }
  }
}

/**
 * Creates a WebSocket connection with SSL certificate validation bypassed.
 * This is necessary for:
 * - Self-signed certificates
 * - Internal domains that may not have proper certificate chains
 * - Docker containers that may not have all CA certificates
 *
 * NOTE: The auth flow is adapted from home-assistant-js-websocket's socket.js
 * NOTE: We cast to LibHaWebSocket because ws.WebSocket has different methods
 * than the browser's WebSocket, but they're compatible enough for our use case.
 */
function createSocketWithSslBypass(
  options: ConnectionOptions,
): Promise<LibHaWebSocket> {
  if (!options.auth) {
    throw new Error('Auth is required for WebSocket connection')
  }
  const auth = options.auth

  const wsUrl = auth.wsUrl
  const isSecure = wsUrl.startsWith('wss://')

  log.debug`Creating WebSocket connection to ${wsUrl}`
  log.debug`SSL bypass enabled: ${isSecure}`

  return new Promise((resolve, reject) => {
    function connect(
      triesLeft: number,
      promResolve: (socket: LibHaWebSocket) => void,
      promReject: (err: unknown) => void,
    ) {
      log.debug`WebSocket connection attempt (retries left: ${triesLeft})`

      // NOTE: rejectUnauthorized: false bypasses SSL certificate validation
      // This allows connections to:
      // - Self-signed certs
      // - Internal domains with custom CAs
      // - Let's Encrypt certs when CA store is incomplete
      const socket = new WebSocket(wsUrl, {
        rejectUnauthorized: false,
      }) as HaWebSocket

      let invalidAuth = false

      const closeMessage = (
        event?: WebSocket.CloseEvent | WebSocket.ErrorEvent,
      ) => {
        socket.removeEventListener('close', closeMessage)

        // Log detailed error info for diagnostics
        if (event && 'message' in event && event.message) {
          log.error`WebSocket error: ${event.message}`
        }
        if (event && 'code' in event) {
          log.debug`WebSocket close code: ${
            (event as WebSocket.CloseEvent).code
          }`
        }

        if (invalidAuth) {
          log.error`Authentication failed - invalid token`
          promReject(ERR_INVALID_AUTH)
          return
        }

        if (triesLeft === 0) {
          log.error`WebSocket connection failed after all retries`
          promReject(ERR_CANNOT_CONNECT)
          return
        }

        const newTries = triesLeft === -1 ? -1 : triesLeft - 1
        log.debug`Retrying WebSocket connection in 1s...`
        setTimeout(() => connect(newTries, promResolve, promReject), 1000)
      }

      const handleOpen = async () => {
        log.debug`WebSocket connection opened, sending auth...`
        try {
          if (auth.expired) {
            await auth.refreshAccessToken()
          }
          socket.send(JSON.stringify(messages.auth(auth.accessToken)))
        } catch (err) {
          log.error`Auth token refresh failed: ${(err as Error).message}`
          invalidAuth = err === ERR_INVALID_AUTH
          socket.close()
        }
      }

      const handleMessage = async (event: WebSocket.MessageEvent) => {
        const rawData =
          typeof event.data === 'string'
            ? event.data
            : (event.data as Buffer).toString()
        const message = JSON.parse(rawData) as {
          type: string
          ha_version?: string
        }
        log.debug`WebSocket message received: ${message.type}`

        switch (message.type) {
          case MSG_TYPE_AUTH_INVALID:
            log.error`Home Assistant rejected auth token`
            invalidAuth = true
            socket.close()
            break

          case MSG_TYPE_AUTH_OK:
            socket.removeEventListener('open', handleOpen)
            socket.removeEventListener('message', handleMessage)
            socket.removeEventListener('close', closeMessage)
            socket.removeEventListener('error', closeMessage)
            socket.haVersion = message.ha_version ?? ''
            log.info`Connected to Home Assistant ${message.ha_version ?? 'unknown'}`

            if (atLeastHaVersion(socket.haVersion, 2022, 9)) {
              socket.send(JSON.stringify(messages.supportedFeatures()))
            }
            // NOTE: Cast to LibHaWebSocket - ws.WebSocket is compatible enough
            // for home-assistant-js-websocket's needs (send, close, events)
            promResolve(socket as unknown as LibHaWebSocket)
            break

          case MSG_TYPE_AUTH_REQUIRED:
            log.debug`Auth required message received (expected)`
            break

          default:
            log.debug`Unhandled WebSocket message type: ${message.type}`
        }
      }

      const handleError = (event: WebSocket.ErrorEvent) => {
        log.error`WebSocket error event: ${event.message || 'Unknown error'}`
        closeMessage(event)
      }

      socket.addEventListener('open', handleOpen)
      socket.addEventListener('message', handleMessage)
      socket.addEventListener('close', closeMessage)
      socket.addEventListener('error', handleError)
    }

    connect(options.setupRetry ?? 0, resolve, reject)
  })
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sends an HTML response with proper headers
 */
function sendHtmlResponse(
  response: ServerResponse,
  html: string,
  statusCode: number = 200,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html',
    'Content-Length': Buffer.byteLength(html),
  })
  response.end(html)
}

// =============================================================================
// HOME ASSISTANT DATA FETCHING
// =============================================================================

/** Timeout for HA connection attempts (5 seconds) */
const HA_CONNECTION_TIMEOUT = 5000

/**
 * Wraps a promise with a timeout
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ])
}

/**
 * Logs detailed diagnostic information when connection fails
 */
async function logConnectionDiagnostics(url: string, err: unknown) {
  const error = err as Error & { code?: string; cause?: unknown }

  log.error`HA connection failed: ${error.message || String(err)}`

  // Log error details
  if (error.code) {
    log.error`Error code: ${error.code}`
  }
  if (error.cause) {
    log.error`Error cause: ${JSON.stringify(error.cause)}`
  }

  // Check DNS resolution
  const hostname = extractHostname(url)
  if (hostname) {
    const dnsResult = await checkDnsResolution(hostname)
    if (dnsResult.resolved) {
      log.info`DNS resolution OK: ${hostname} -> ${dnsResult.ip}`
    } else {
      log.error`DNS resolution FAILED for ${hostname}: ${dnsResult.error}`
      log.error`Hint: The hostname may not be resolvable from inside the Docker container.`
      log.error`Try using an IP address instead, or configure Docker DNS settings.`
    }
  }

  // Protocol-specific hints
  if (url.startsWith('https://')) {
    log.info`Using HTTPS - SSL certificate validation is bypassed for flexibility.`
    log.info`If connection still fails, check if the HA server is reachable from this container.`
  }
}

/**
 * Fetches configuration data from Home Assistant via WebSocket and REST API.
 * Uses custom WebSocket creation with SSL certificate validation bypassed
 * to support self-signed certs and internal domains.
 */
async function fetchHomeAssistantData(): Promise<HomeAssistantData> {
  try {
    log.info`Connecting to HA at: ${hassUrl}`
    log.debug`Token configured: ${
      hassToken ? 'yes (' + hassToken.substring(0, 10) + '...)' : 'NO'
    }`
    log.debug`Protocol: ${
      hassUrl.startsWith('https://') ? 'HTTPS (SSL bypass enabled)' : 'HTTP'
    }`

    const auth = createLongLivedTokenAuth(hassUrl, hassToken!)

    // NOTE: Using custom createSocket to bypass SSL certificate validation
    // This is necessary for self-signed certs and internal domains
    const connection: Connection = await withTimeout(
      createConnection({
        auth,
        createSocket: createSocketWithSslBypass,
      }),
      HA_CONNECTION_TIMEOUT,
      `HA connection timeout after ${HA_CONNECTION_TIMEOUT}ms`,
    )

    log.debug`WebSocket connected, fetching HA data...`

    const [themesResult, networkResult, dashboardsResult] = await Promise.all([
      connection.sendMessagePromise<ThemesResult>({
        type: 'frontend/get_themes',
      }),
      connection.sendMessagePromise<NetworkResult>({ type: 'network/url' }),
      connection
        .sendMessagePromise<DashboardInfo[]>({
          type: 'lovelace/dashboards/list',
        })
        .catch(() => null),
    ])

    connection.close()
    log.debug`WebSocket closed, fetching REST API config...`

    const configResponse = await fetch(`${hassUrl}/api/config`, {
      headers: {
        Authorization: `Bearer ${hassToken}`,
        'Content-Type': 'application/json',
      },
    })

    const config: HassConfig | null = configResponse.ok
      ? ((await configResponse.json()) as HassConfig)
      : null

    if (!configResponse.ok) {
      log.warn`REST API /api/config failed: ${configResponse.status} ${configResponse.statusText}`
    }

    let dashboards = [
      '/lovelace/0',
      '/home',
      '/map',
      '/energy',
      '/history',
      '/logbook',
      '/config',
    ]

    try {
      if (dashboardsResult && Array.isArray(dashboardsResult)) {
        dashboardsResult.forEach((d) => {
          if (d.url_path) {
            dashboards.push(`/lovelace/${d.url_path}`)
            dashboards.push(`/${d.url_path}`)
            dashboards.push(`/${d.url_path}/0`)
            dashboards.push(`/lovelace/${d.url_path}/0`)
          }
        })
        dashboards = [...new Set(dashboards)]
      }
    } catch (err) {
      log.warn`Could not parse dashboards, using defaults: ${
        (err as Error).message
      }`
    }

    log.info`Successfully fetched HA data (${dashboards.length} dashboards)`
    lastConnectionErrorWasAuth = false // Clear on success
    return { themes: themesResult, network: networkResult, config, dashboards }
  } catch (err) {
    // Check if this was an authentication error
    if (err === ERR_INVALID_AUTH) {
      lastConnectionErrorWasAuth = true
      log.error`INVALID ACCESS TOKEN - Home Assistant rejected your token`
      log.error`Please generate a new Long-Lived Access Token in your HA profile`
      log.error`Profile -> Security -> Long-Lived Access Tokens -> Create Token`
    } else {
      lastConnectionErrorWasAuth = false
      await logConnectionDiagnostics(hassUrl, err)
    }
    return { themes: null, network: null, config: null, dashboards: null }
  }
}

/**
 * Gets HA data from cache or fetches fresh data.
 * Cache is used unless forceRefresh is true.
 */
async function getCachedOrFetch(forceRefresh: boolean): Promise<{
  data: HomeAssistantData
  cachedAt: number
}> {
  // Return cached data if available and not forcing refresh
  if (cachedHassData && !forceRefresh) {
    log.debug`Using cached HA data (age: ${Math.round(
      (Date.now() - cacheTimestamp) / 1000,
    )}s)`
    return { data: cachedHassData, cachedAt: cacheTimestamp }
  }

  // Fetch fresh data
  log.info`Fetching fresh HA data${forceRefresh ? ' (forced refresh)' : ''}`
  const data = await fetchHomeAssistantData()
  cachedHassData = data
  cacheTimestamp = Date.now()
  return { data, cachedAt: cacheTimestamp }
}

// =============================================================================
// MAIN UI HANDLER
// =============================================================================

/**
 * Handles requests for the web UI
 *
 * Always serves the main UI - no blocking error pages.
 * Connection status is passed to frontend for inline messaging.
 * HA data is cached to avoid blocking on every request.
 *
 * @param response - HTTP response object
 * @param requestUrl - Request URL to check for ?refresh=1 query param
 */
export async function handleUIRequest(
  response: ServerResponse,
  requestUrl?: URL,
): Promise<void> {
  try {
    // Check for forced refresh via query param
    const forceRefresh = requestUrl?.searchParams.get('refresh') === '1'

    // Attempt HA connection if token is configured (using cache)
    let hassData: HomeAssistantData = {
      themes: null,
      network: null,
      config: null,
      dashboards: null,
    }
    let cachedAt: number | null = null

    if (hassToken) {
      const result = await getCachedOrFetch(forceRefresh)
      hassData = result.data
      cachedAt = result.cachedAt
    }

    // Determine if HA connection succeeded
    const haConnected = !!(hassData.themes && hassData.config)

    // Build token preview (first 4 chars masked)
    const tokenPreview = hassToken ? `${hassToken.slice(0, 4)}****` : null

    // Determine connection status reason
    let connectionStatus: string
    if (haConnected) {
      connectionStatus = 'Connected'
    } else if (!hassToken) {
      connectionStatus = 'No token configured'
    } else if (lastConnectionErrorWasAuth) {
      connectionStatus =
        'Invalid access token - please generate a new token in HA'
    } else if (!hassData.themes && !hassData.config) {
      connectionStatus = 'Connection failed - could not reach HA'
    } else if (!hassData.themes) {
      connectionStatus = 'Connected but themes unavailable'
    } else {
      connectionStatus = 'Connected but config unavailable'
    }

    // Log connection status for debugging
    if (haConnected) {
      log.info`HA connection: ${connectionStatus} | URL: ${hassUrl} | Token: ${tokenPreview}`
    } else {
      log.warning`HA connection: ${connectionStatus} | URL: ${hassUrl} | Token: ${
        tokenPreview ?? 'not set'
      }`
    }

    // Build UI config for frontend
    const uiConfig: UIConfig = {
      hasToken: !!hassToken,
      hassUrl,
      haConnected,
      tokenPreview,
      connectionStatus,
      cachedAt,
      serverPort: SERVER_PORT,
    }

    const htmlPath = join(HTML_DIR, 'index.html')
    let html = await readFile(htmlPath, 'utf-8')

    const presets = loadPresets()
    const hassDataWithDevices: HomeAssistantData & { presets: PresetsConfig } =
      {
        ...hassData,
        presets,
      }

    // Inject both HA data and UI config into the page
    const scriptTag = `<script>
window.hass = ${JSON.stringify(hassDataWithDevices, null, 2)};
window.uiConfig = ${JSON.stringify(uiConfig)};
</script>`
    html = html.replace('</head>', `${scriptTag}\n  </head>`)

    sendHtmlResponse(response, html)
  } catch (err) {
    log.error`Error serving UI: ${err}`
    response.statusCode = 500
    response.end('Error loading UI')
  }
}
