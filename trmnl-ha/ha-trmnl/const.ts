/**
 * Configuration constants for the TRMNL HA add-on
 * @module const
 */

import { readFileSync, existsSync } from 'fs'
import type {
  ImageFormat,
  RotationAngle,
  ContentTypeMap,
  ColorPaletteDefinition,
  GrayscalePaletteDefinition,
} from './types/domain.js'

// =============================================================================
// OPTIONS FILE LOADING
// =============================================================================

interface Options {
  home_assistant_url?: string
  access_token?: string
  chromium_executable?: string
  keep_browser_open?: boolean
  debug_logging?: boolean
  ignore_ssl_errors?: boolean
}

/**
 * Searches for and loads the first available options file
 * Priority: local dev file first, then add-on data path
 */
const optionsFile = ['./options-dev.json', '/data/options.json'].find(
  existsSync
)

if (!optionsFile) {
  console.error(
    'No options file found. Please copy options-dev.json.example to options-dev.json'
  )
  process.exit(1)
}

const options = JSON.parse(readFileSync(optionsFile, 'utf-8')) as Options

// =============================================================================
// ENVIRONMENT DETECTION
// =============================================================================

/**
 * Whether running as Home Assistant add-on (true) or local development (false)
 */
export const isAddOn: boolean = optionsFile === '/data/options.json'

/**
 * Whether to use mock Home Assistant for testing and local development
 * Set MOCK_HA=true environment variable to enable mock mode
 * In mock mode, the app connects to a mock HA server on localhost:8123
 */
export const useMockHA: boolean = process.env['MOCK_HA'] === 'true'

if (useMockHA) {
  console.log(
    '[Mock] Running in MOCK mode - using mock HA server on localhost:8123'
  )
}

// =============================================================================
// HOME ASSISTANT CONNECTION
// =============================================================================

/**
 * Home Assistant base URL
 * Automatically switches to mock server when MOCK_HA=true
 */
export const hassUrl: string = useMockHA
  ? 'http://localhost:8123' // Mock HA server
  : isAddOn
  ? options.home_assistant_url || 'http://homeassistant:8123'
  : options.home_assistant_url || 'http://localhost:8123'

/**
 * Long-lived access token for Home Assistant authentication
 * Uses mock token when MOCK_HA=true, otherwise reads from options
 */
export const hassToken: string | undefined = useMockHA
  ? 'mock-token-for-testing' // Any token works with mock server
  : options.access_token

// Only warn about missing token when running as HA add-on (where it's required)
// Standalone users may intentionally skip the token for generic URL screenshots
if (!hassToken && !useMockHA && isAddOn) {
  console.warn(
    'No access token configured. UI will show configuration instructions.'
  )
}

// =============================================================================
// BROWSER CONFIGURATION
// =============================================================================

/**
 * Path to Chromium/Chrome executable
 */
export const chromiumExecutable: string = isAddOn
  ? '/usr/bin/chromium'
  : options.chromium_executable ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/**
 * Keep browser instance open between requests for performance
 */
export const keepBrowserOpen: boolean = options.keep_browser_open ?? false

/**
 * Enable debug logging (from HA add-on configuration)
 * When true, sets log level to 'debug' for verbose output
 * Default: true for development, controlled by options in production
 */
export const debugLogging: boolean = options.debug_logging ?? true

/**
 * Ignore SSL certificate errors (from HA add-on configuration)
 * When true, accepts self-signed certificates for HTTPS connections
 * Required for users with custom SSL certs on their HA instance
 * Default: false (strict SSL validation)
 */
export const ignoreSslErrors: boolean = options.ignore_ssl_errors ?? false

// Apply SSL settings to Node/Bun TLS stack (affects fetch, WebSocket, etc.)
// NOTE: Must be set before any TLS connections are made
if (ignoreSslErrors) {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
  console.log('[SSL] Ignoring SSL certificate errors (configured in add-on settings)')
}

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

/**
 * HTTP server port
 */
export const SERVER_PORT: number = 10000

/**
 * Browser idle timeout before cleanup (milliseconds)
 * Configurable via BROWSER_TIMEOUT environment variable
 * Default increased from 30s to 60s for better performance under intermittent load
 */
export const BROWSER_TIMEOUT: number = parseInt(
  process.env['BROWSER_TIMEOUT'] || '60000'
)

/**
 * Maximum screenshots before proactive browser restart (memory cleanup)
 * Prevents gradual memory accumulation in long-running sessions (auto-refresh, scheduled jobs)
 * Browser automatically relaunches on next request after cleanup
 * Set to 0 to disable request-based cleanup
 * Configurable via MAX_SCREENSHOTS_BEFORE_RESTART environment variable
 */
export const MAX_SCREENSHOTS_BEFORE_RESTART: number = parseInt(
  process.env['MAX_SCREENSHOTS_BEFORE_RESTART'] || '100'
)

/**
 * Maximum queued "next" requests to prevent runaway loops
 */
export const MAX_NEXT_REQUESTS: number = 100

// =============================================================================
// SCREENSHOT CONFIGURATION
// =============================================================================

/**
 * Home Assistant header height in pixels (clipped from screenshots)
 */
export const HEADER_HEIGHT: number = 56

/**
 * Valid output image formats
 */
export const VALID_FORMATS: readonly ImageFormat[] = [
  'png',
  'jpeg',
  'bmp',
] as const

/**
 * Valid rotation angles in degrees
 */
export const VALID_ROTATIONS: readonly RotationAngle[] = [90, 180, 270] as const

/**
 * Color palette definitions for e-ink displays
 */
export const COLOR_PALETTES: ColorPaletteDefinition = {
  'color-6a': [
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#FFFF00',
    '#000000',
    '#FFFFFF',
  ],
  'color-7a': [
    '#000000',
    '#FFFFFF',
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#FFFF00',
    '#FFA500',
  ],
}

/**
 * Grayscale palette definitions (number of gray levels)
 */
export const GRAYSCALE_PALETTES: GrayscalePaletteDefinition = {
  bw: 2,
  'gray-4': 4,
  'gray-16': 16,
  'gray-256': 256,
}

/**
 * Default wait time after page load (milliseconds)
 * Add-on uses longer time due to slower environment
 */
export const DEFAULT_WAIT_TIME: number = isAddOn ? 750 : 500

/**
 * Extra wait time on cold start for icons/images to load (milliseconds)
 */
export const COLD_START_EXTRA_WAIT: number = 2500

/**
 * Content-Type headers for each output format
 */
export const CONTENT_TYPES: ContentTypeMap = {
  jpeg: 'image/jpeg',
  bmp: 'image/bmp',
  png: 'image/png',
}

// =============================================================================
// SCHEDULER CONFIGURATION
// =============================================================================

/**
 * Schedule reload interval in milliseconds
 */
export const SCHEDULER_RELOAD_INTERVAL_MS: number = 60000 // 1 minute

/**
 * Maximum retry attempts for failed schedules
 */
export const SCHEDULER_MAX_RETRIES: number = 3

/**
 * Delay between retry attempts in milliseconds
 */
export const SCHEDULER_RETRY_DELAY_MS: number = 5000 // 5 seconds

/**
 * Retention multiplier for screenshot files
 * Keep N times the number of enabled schedules
 */
export const SCHEDULER_RETENTION_MULTIPLIER: number = 2

/**
 * Regular expression pattern for image file extensions
 */
export const SCHEDULER_IMAGE_FILE_PATTERN: RegExp = /\.(png|jpeg|jpg|bmp)$/i

/**
 * Output directory name for scheduler screenshots
 */
export const SCHEDULER_OUTPUT_DIR_NAME: string = 'output'

/**
 * Maximum length for truncating response bodies in logs
 */
export const SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH: number = 200

/**
 * Network error detection patterns
 */
export const SCHEDULER_NETWORK_ERROR_PATTERNS: readonly string[] = [
  'Network error',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION_REFUSED',
  'ERR_INTERNET_DISCONNECTED',
] as const

/**
 * Check if error is a network error
 */
export function isSchedulerNetworkError(error: Error): boolean {
  return SCHEDULER_NETWORK_ERROR_PATTERNS.some((pattern) =>
    error.message?.includes(pattern)
  )
}
