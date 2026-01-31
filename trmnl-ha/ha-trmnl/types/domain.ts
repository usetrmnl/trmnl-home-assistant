/**
 * Domain Types for TRMNL Home Assistant Add-on
 *
 * Core type definitions used throughout the application.
 * All modules should import types from this file.
 *
 * @module types/domain
 */

// =============================================================================
// VIEWPORT & DIMENSIONS
// =============================================================================

/** Viewport dimensions for screenshot capture */
export interface Viewport {
  width: number
  height: number
}

/** Crop region for partial screenshots */
export interface CropRegion {
  x: number
  y: number
  width: number
  height: number
}

// =============================================================================
// IMAGE PROCESSING
// =============================================================================

/** Valid output image formats */
export type ImageFormat = 'png' | 'jpeg' | 'bmp'

/** Valid rotation angles in degrees */
export type RotationAngle = 90 | 180 | 270

/** Grayscale palette types for e-ink displays */
export type GrayscalePalette = 'bw' | 'gray-4' | 'gray-16' | 'gray-256'

/** Color palette types for color e-ink displays */
export type ColorPalette =
  | 'color-6a' // 6-color: R, G, B, Y, Black, White
  | 'color-7a' // 7-color ACeP/Gallery with Orange
  | 'color-7b' // 7-color with Cyan (instead of Orange)
  | 'color-8a' // 8-color Spectra 6 T2000 (both Cyan + Orange)

/** All supported palettes */
export type Palette = GrayscalePalette | ColorPalette

/** Dithering algorithm methods */
export type DitheringMethod = 'floyd-steinberg' | 'ordered' | 'threshold'

/** Valid bit depth values for PNG output */
export type BitDepth = 1 | 2 | 4 | 8

/** Valid PNG compression levels (1-9, higher = smaller files but slower) */
export type CompressionLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** Dithering configuration for e-ink optimization */
export interface DitheringConfig {
  enabled: boolean
  method: DitheringMethod
  palette: Palette
  gammaCorrection: boolean
  /** Enable manual black/white level adjustments (default: false) */
  levelsEnabled?: boolean
  blackLevel: number
  whiteLevel: number
  normalize: boolean
  saturationBoost: boolean
  /** Override bit depth for PNG output (default: auto from palette) */
  bitDepth?: BitDepth
  /** PNG compression level 1-9 (default: 9, max compression) */
  compressionLevel?: CompressionLevel
}

// =============================================================================
// SCREENSHOT PARAMETERS
// =============================================================================

/**
 * Screenshot request parameters (parsed from URL query params)
 *
 * Used by ScreenshotParamsParser and passed to Browser.screenshotPage()
 */
export interface ScreenshotParams {
  /** Dashboard page path (e.g., "/lovelace/default") */
  pagePath: string

  /** Full target URL (if provided, overrides pagePath + base URL resolution) */
  targetUrl?: string

  /** Viewport dimensions */
  viewport: Viewport

  /** Extra wait time after page load (milliseconds) */
  extraWait?: number

  /** Browser zoom level (1.0 = 100%) */
  zoom: number

  /** Crop region for partial screenshots */
  crop: CropRegion | null

  /** Invert colors (for e-ink displays) */
  invert: boolean

  /** Output image format */
  format: ImageFormat

  /** Rotation angle */
  rotate?: RotationAngle

  /** Home Assistant UI language code */
  lang?: string

  /** Home Assistant theme name */
  theme?: string

  /** Enable dark mode */
  dark: boolean

  /** Seconds until next request (for preloading) */
  next?: number

  /** Dithering configuration (undefined if not enabled) */
  dithering?: DitheringConfig
}

// =============================================================================
// WEBHOOK FORMATS
// =============================================================================

/** Supported webhook payload formats */
export type WebhookFormat = 'raw' | 'byos-hanami'

/** BYOS Hanami API configuration */
export interface ByosHanamiConfig {
  /** Display label shown in BYOS UI */
  label: string
  /** Unique screen identifier */
  name: string
  /** BYOS model ID */
  model_id: string
  /** Whether the screen has been preprocessed */
  preprocessed: boolean
  /** JWT authentication settings */
  auth?: ByosAuthConfig
}

/** BYOS JWT authentication configuration (tokens only - no credentials stored) */
export interface ByosAuthConfig {
  /** Enable JWT authentication */
  enabled: boolean
  /** JWT access token (short-lived, ~30 min) */
  access_token?: string
  /** JWT refresh token (long-lived, ~14 days) */
  refresh_token?: string
  /** Timestamp when tokens were obtained */
  obtained_at?: number
}

/** Webhook format configuration */
export interface WebhookFormatConfig {
  format: WebhookFormat
  /** Required when format is 'byos-hanami' */
  byosConfig?: ByosHanamiConfig
}

// =============================================================================
// SCHEDULE
// =============================================================================

/**
 * Schedule configuration for automated screenshot capture
 *
 * Persisted to JSON file via scheduleStore module
 */
export interface Schedule {
  /** Unique identifier */
  id: string

  /** Human-readable name */
  name: string

  /** Whether schedule is active */
  enabled: boolean

  /** Cron expression for scheduling */
  cron: string

  /** Webhook URL to POST screenshot to (null if local-only) */
  webhook_url: string | null

  /** Custom headers for webhook requests */
  webhook_headers?: Record<string, string>

  /** Webhook payload format configuration (null/undefined = 'raw' for backward compat) */
  webhook_format?: WebhookFormatConfig | null

  /** Whether to use Home Assistant mode (true) or generic URL mode (false) */
  ha_mode: boolean

  /** Dashboard page path (used in HA mode) */
  dashboard_path: string

  /** Full target URL (used in generic mode, overrides dashboard_path) */
  target_url?: string

  /** Viewport dimensions */
  viewport: Viewport

  /** Crop region configuration */
  crop: CropRegion & { enabled: boolean }

  /** Output image format */
  format: ImageFormat

  /** Rotation angle (null for no rotation) */
  rotate: RotationAngle | null

  /** Browser zoom level */
  zoom: number

  /** Extra wait time (null for default) */
  wait: number | null

  /** Theme name (null for default) */
  theme: string | null

  /** Language code (null for default) */
  lang: string | null

  /** Enable dark mode */
  dark: boolean

  /** Invert colors */
  invert: boolean

  /** Dithering configuration */
  dithering: DitheringConfig

  /** ISO timestamp of creation */
  createdAt: string

  /** ISO timestamp of last update */
  updatedAt: string
}

/** Schedule data for creation (without auto-generated fields) */
export type ScheduleInput = Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>

/** Schedule data for updates (all fields optional except id) */
export type ScheduleUpdate = Partial<Omit<Schedule, 'id'>>

/** Webhook execution result details */
export interface WebhookResult {
  /** Whether webhook was attempted */
  attempted: boolean
  /** Whether webhook succeeded */
  success: boolean
  /** HTTP status code from webhook (if attempted) */
  statusCode?: number
  /** Error message (if failed) */
  error?: string
  /** Webhook URL that was called */
  url?: string
}

/** Response from triggering immediate schedule execution */
export interface SendScheduleResponse {
  /** Whether the overall execution was successful (screenshot captured) */
  success: boolean
  /** Path where screenshot was saved (if successful) */
  savedPath?: string
  /** Error message (if screenshot capture failed) */
  error?: string
  /** Webhook execution details (if webhook was configured) */
  webhook?: WebhookResult
}

// =============================================================================
// NAVIGATION & BROWSER
// =============================================================================

/** Result from navigation commands */
export interface NavigationResult {
  /** Recommended wait time after navigation (milliseconds) */
  waitTime: number
}

/** Screenshot capture result */
export interface ScreenshotResult {
  /** Image buffer */
  image: Buffer

  /** Total processing time (milliseconds) */
  time: number
}

// =============================================================================
// HEALTH & RECOVERY
// =============================================================================

/** Browser health status */
export interface HealthStatus {
  healthy: boolean
  reason?: string
  failureCount?: number
  lastFailure?: Date
}

/** Browser recovery statistics */
export interface RecoveryStats {
  totalRecoveries: number
  lastRecovery?: Date
  consecutiveFailures: number
}

// =============================================================================
// HTTP & API
// =============================================================================

/** Content-Type headers for output formats */
export type ContentTypeMap = Record<ImageFormat, string>

/** Grayscale palette config (for unified PALETTES) */
export interface GrayscalePaletteConfig {
  label: string
  levels: number
}

/** Color palette config (for unified PALETTES) */
export interface ColorPaletteConfig {
  label: string
  colors: string[]
}

/** Unified palette configuration (single source of truth) */
export type PaletteConfig = GrayscalePaletteConfig | ColorPaletteConfig

/** Type guard: is this a color palette config? */
export const isColorPalette = (c: PaletteConfig): c is ColorPaletteConfig =>
  'colors' in c

/** Type guard: is this a grayscale palette config? */
export const isGrayscalePalette = (
  c: PaletteConfig,
): c is GrayscalePaletteConfig => 'levels' in c

/** Color palette definitions (hex color arrays) - derived from PALETTES */
export type ColorPaletteDefinition = Record<ColorPalette, string[]>

/** Grayscale palette definitions (number of gray levels) - derived from PALETTES */
export type GrayscalePaletteDefinition = Record<GrayscalePalette, number>

// =============================================================================
// SCHEDULE PRESETS (devices.json structure)
// =============================================================================

/** Grayscale dithering config (uses bitDepth) */
export interface GrayscaleDitheringPreset {
  enabled: boolean
  method: string
  bitDepth: number
  gammaCorrection: boolean
  blackLevel: number
  whiteLevel: number
}

/** Color dithering config (uses palette) */
export interface ColorDitheringPreset {
  enabled: boolean
  method: string
  palette: ColorPalette
  gammaCorrection: boolean
  blackLevel: number
  whiteLevel: number
  normalize: boolean
  saturationBoost: boolean
}

/** Combined dithering preset type */
export type DitheringPreset = GrayscaleDitheringPreset | ColorDitheringPreset

/** Schedule preset from devices.json */
export interface SchedulePreset {
  name: string
  cron: string
  dashboard_path: string
  viewport: Viewport
  webhook_url: string
  format: string
  rotate: number
  dithering: DitheringPreset
  id: string
  createdAt: string
  updatedAt: string
}

/** All presets keyed by ID */
export type PresetsConfig = Record<string, SchedulePreset>
