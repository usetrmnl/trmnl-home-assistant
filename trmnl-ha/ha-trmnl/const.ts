/**
 * Configuration constants for the TRMNL HA add-on
 * @module const
 */

// =============================================================================
// BUN TLS WORKAROUND
// =============================================================================
// NOTE: Bun has a known issue where rejectUnauthorized: false doesn't work
// for WebSocket connections. Setting NODE_TLS_REJECT_UNAUTHORIZED=0 is the
// only reliable workaround. This enables HTTPS connections with self-signed
// certs or internal domains.
// See: https://github.com/oven-sh/bun/issues/11821
//
// This is set automatically when the HA URL uses HTTPS. Users running with
// valid certificates can override this by setting NODE_TLS_REJECT_UNAUTHORIZED=1
// =============================================================================

import { existsSync } from 'fs'
import type {
  ImageFormat,
  RotationAngle,
  ContentTypeMap,
  ColorPaletteDefinition,
  GrayscalePaletteDefinition,
  Palette,
  PaletteConfig,
} from './types/domain.js'
import { isColorPalette, isGrayscalePalette } from './types/domain.js'
// Re-export browser-safe palette options (single source of truth for labels)
export {
  PALETTE_OPTIONS,
  GRAYSCALE_OPTIONS,
  COLOR_OPTIONS,
  type PaletteOption,
} from './html/js/palette-options.js'
import { PALETTE_OPTIONS } from './html/js/palette-options.js'

/** Lookup label from palette-options (single source of truth) */
const label = (value: string): string =>
  PALETTE_OPTIONS.find((p) => p.value === value)?.label ?? value
import {
  isValidTimezone,
  hasEnvConfig as checkEnvConfig,
  detectIsAddOn,
  findBrowser,
  isNetworkError,
  parseOptionsFile,
  OptionsParseError,
  type Options,
  NETWORK_ERROR_PATTERNS as SCHEDULER_NETWORK_ERROR_PATTERNS_IMPORT,
} from './lib/config-helpers.js'

// =============================================================================
// OPTIONS LOADING (ENV VARS → JSON FILE)
// =============================================================================

// NOTE: Early startup log before any config parsing - helps diagnose silent crashes
console.log('[Startup] TRMNL HA initializing...')

/**
 * Check if running with environment variable configuration
 * Supports simplified Docker deployment without config files
 */
const hasEnvConfig = checkEnvConfig(process.env)

/**
 * Searches for and loads the first available options file
 * Priority: local dev file first, then add-on data path
 * Optional when using environment variables
 */
const optionsFile = ['./options-dev.json', '/data/options.json'].find(
  existsSync,
)

// Require config file OR environment variables
if (!optionsFile && !hasEnvConfig) {
  console.error(
    '[Startup] FATAL: No configuration found. Either:\n' +
      '  1. Set HOME_ASSISTANT_URL and ACCESS_TOKEN environment variables, or\n' +
      '  2. Create options-dev.json (copy from options-dev.json.example)',
  )
  process.exit(1)
}

/**
 * Load options from JSON file with clear error messaging
 * Uses parseOptionsFile from config-helpers which throws OptionsParseError on failure
 */
function loadOptionsFileSafe(filePath: string): Options {
  try {
    return parseOptionsFile(filePath)
  } catch (err) {
    if (err instanceof OptionsParseError) {
      console.error(`[Startup] FATAL: ${err.message}`)
      console.error(`[Startup] Error: ${err.cause.message}`)
      console.error(
        '[Startup] Check your addon configuration in Home Assistant',
      )
    } else {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[Startup] FATAL: Unexpected error loading config: ${message}`,
      )
    }
    process.exit(1)
  }
}

/**
 * Load options from JSON file (if present)
 */
const fileOptions: Options = optionsFile ? loadOptionsFileSafe(optionsFile) : {}

/**
 * Merged options: environment variables take precedence over file config
 * This allows Docker users to override settings without modifying files
 */
const options: Options = {
  home_assistant_url:
    process.env['HOME_ASSISTANT_URL'] ?? fileOptions.home_assistant_url,
  access_token: process.env['ACCESS_TOKEN'] ?? fileOptions.access_token,
  chromium_executable:
    process.env['CHROMIUM_EXECUTABLE'] ?? fileOptions.chromium_executable,
  keep_browser_open:
    process.env['KEEP_BROWSER_OPEN'] !== undefined
      ? process.env['KEEP_BROWSER_OPEN'] === 'true'
      : fileOptions.keep_browser_open,
  debug_logging:
    process.env['DEBUG_LOGGING'] !== undefined
      ? process.env['DEBUG_LOGGING'] === 'true'
      : fileOptions.debug_logging,
  server_port:
    process.env['SERVER_PORT'] !== undefined
      ? parseInt(process.env['SERVER_PORT'], 10)
      : fileOptions.server_port,
}

// Log configuration source for debugging
if (hasEnvConfig) {
  console.log('[Config] Using environment variables')
} else if (optionsFile) {
  console.log(`[Config] Using ${optionsFile}`)
}

/**
 * Set timezone from config (TZ env var takes precedence)
 * Important for scheduled captures to fire at correct local time
 *
 * Valid values: IANA timezone names like "America/New_York", "Europe/London"
 * @see https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
 */
const timezone = process.env.TZ ?? options.timezone ?? fileOptions.timezone
if (timezone) {
  // Validate timezone - invalid values silently fall back to UTC
  const isValid = isValidTimezone(timezone)

  if (!isValid) {
    console.warn(
      `[Config] ⚠️ Invalid timezone "${timezone}" - will fall back to UTC!`,
    )
    console.warn(
      '[Config] Valid examples: America/New_York, Europe/London, Asia/Tokyo',
    )
    console.warn(
      '[Config] Full list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones',
    )
  }

  process.env.TZ = timezone
  console.log(`[Config] Timezone: ${timezone}${isValid ? '' : ' (INVALID)'}`)
}

// =============================================================================
// ENVIRONMENT DETECTION
// =============================================================================

/**
 * Whether running as Home Assistant add-on (true) or standalone (false)
 *
 * Detection methods (in order of reliability):
 * 1. SUPERVISOR_TOKEN env var - injected by HA Supervisor into all add-ons
 * 2. /data/options.json exists without env config - fallback for edge cases
 *
 * Standalone includes: Docker with env vars, Docker with mounted config, local dev
 */
export const isAddOn: boolean = detectIsAddOn(process.env, optionsFile)

// Log running mode for debugging
if (isAddOn) {
  const detectedBy = process.env['SUPERVISOR_TOKEN']
    ? 'SUPERVISOR_TOKEN'
    : 'options file'
  console.log(`[Config] Running as HA add-on (detected via ${detectedBy})`)
} else {
  console.log('[Config] Running in standalone mode')
}

/**
 * Whether to use mock Home Assistant for testing and local development
 * Set MOCK_HA=true environment variable to enable mock mode
 * In mock mode, the app connects to a mock HA server on localhost:8123
 */
export const useMockHA: boolean = process.env['MOCK_HA'] === 'true'

if (useMockHA) {
  console.log(
    '[Mock] Running in MOCK mode - using mock HA server on localhost:8123',
  )
}

// =============================================================================
// HOME ASSISTANT CONNECTION
// =============================================================================

/**
 * Home Assistant base URL
 * Automatically switches to mock server when MOCK_HA=true
 * NOTE: Trailing slashes are stripped to prevent double-slash issues in URL paths
 */
const rawHassUrl: string = useMockHA
  ? 'http://localhost:8123' // Mock HA server
  : isAddOn
    ? options.home_assistant_url || 'http://homeassistant:8123'
    : options.home_assistant_url || 'http://localhost:8123'

export const hassUrl: string = rawHassUrl.replace(/\/+$/, '')

// Apply Bun TLS workaround for HTTPS URLs
// See comment at top of file for details
if (
  hassUrl.startsWith('https://') &&
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === undefined
) {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
  console.log('[Config] HTTPS detected - enabling TLS bypass for flexibility')
}

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
    'No access token configured. UI will show configuration instructions.',
  )
}

// =============================================================================
// BROWSER CONFIGURATION
// =============================================================================

/**
 * Path to Chromium/Chrome executable
 * Priority: user config → auto-detected → Puppeteer bundled (undefined)
 *
 * Browser detection uses platform-agnostic path list from config-helpers.ts
 */
export const chromiumExecutable: string | undefined =
  options.chromium_executable ?? findBrowser()

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

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

/**
 * Default HTTP server port (must match ingress_port in config.yaml for add-on mode)
 */
const DEFAULT_SERVER_PORT = 10000

/**
 * HTTP server port
 * - Add-on mode: Fixed at 10000 (required for HA ingress/sidebar)
 * - Standalone mode: Configurable via server_port option or SERVER_PORT env var
 */
export const SERVER_PORT: number = isAddOn
  ? DEFAULT_SERVER_PORT
  : (options.server_port ?? DEFAULT_SERVER_PORT)

// Warn if add-on user tried to configure a different port
if (
  isAddOn &&
  options.server_port &&
  options.server_port !== DEFAULT_SERVER_PORT
) {
  console.warn(
    `[Config] ⚠️ server_port=${options.server_port} ignored in add-on mode (must be ${DEFAULT_SERVER_PORT} for HA ingress)`,
  )
}

/**
 * Browser idle timeout before cleanup (milliseconds)
 * Configurable via BROWSER_TIMEOUT environment variable
 * Default increased from 30s to 60s for better performance under intermittent load
 */
export const BROWSER_TIMEOUT: number = parseInt(
  process.env['BROWSER_TIMEOUT'] || '60000',
)

/**
 * Maximum screenshots before proactive browser restart (memory cleanup)
 * Prevents gradual memory accumulation in long-running sessions (auto-refresh, scheduled jobs)
 * Browser automatically relaunches on next request after cleanup
 * Set to 0 to disable request-based cleanup
 * Configurable via MAX_SCREENSHOTS_BEFORE_RESTART environment variable
 */
export const MAX_SCREENSHOTS_BEFORE_RESTART: number = parseInt(
  process.env['MAX_SCREENSHOTS_BEFORE_RESTART'] || '100',
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
 * Unified palette definitions - SINGLE SOURCE OF TRUTH
 *
 * Add new palettes here and they automatically appear in UI + dithering.
 * Order determines dropdown display order.
 *
 * @see https://www.eink.com/brand/detail/Spectra6
 * @see https://shop.pimoroni.com/products/inky-impression-7-3
 */
export const PALETTES: Record<Palette, PaletteConfig> = {
  // Grayscale palettes (labels from palette-options.ts)
  bw: { label: label('bw'), levels: 2 },
  'gray-4': { label: label('gray-4'), levels: 4 },
  'gray-16': { label: label('gray-16'), levels: 16 },
  'gray-256': { label: label('gray-256'), levels: 256 },
  // Color palettes (labels from palette-options.ts)
  'color-6a': {
    label: label('color-6a'),
    colors: ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00'],
  },
  'color-7a': {
    label: label('color-7a'),
    colors: [
      '#000000',
      '#FFFFFF',
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFFF00',
      '#FF8C00',
    ],
  },
  'color-7b': {
    label: label('color-7b'),
    colors: [
      '#000000',
      '#FFFFFF',
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFFF00',
      '#00FFFF',
    ],
  },
  'color-8a': {
    label: label('color-8a'),
    colors: [
      '#000000',
      '#FFFFFF',
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFFF00',
      '#00FFFF',
      '#FF8C00',
    ],
  },
}

// =============================================================================
// DERIVED PALETTE CONSTANTS (backward compatibility)
// =============================================================================

/** Color palettes (hex arrays) - derived from PALETTES */
export const COLOR_PALETTES: ColorPaletteDefinition = Object.fromEntries(
  Object.entries(PALETTES)
    .filter(([_, config]) => isColorPalette(config))
    .map(([key, config]) => [key, (config as { colors: string[] }).colors]),
) as ColorPaletteDefinition

/** Grayscale palettes (gray levels) - derived from PALETTES */
export const GRAYSCALE_PALETTES: GrayscalePaletteDefinition =
  Object.fromEntries(
    Object.entries(PALETTES)
      .filter(([_, config]) => isGrayscalePalette(config))
      .map(([key, config]) => [key, (config as { levels: number }).levels]),
  ) as GrayscalePaletteDefinition

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
 * Re-exported from config-helpers for backward compatibility
 */
export const SCHEDULER_NETWORK_ERROR_PATTERNS: readonly string[] =
  SCHEDULER_NETWORK_ERROR_PATTERNS_IMPORT

/**
 * Check if error is a network error
 * Re-exported from config-helpers for backward compatibility
 */
export const isSchedulerNetworkError = isNetworkError
