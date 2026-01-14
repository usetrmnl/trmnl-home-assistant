/**
 * Advanced Dithering Module - E-ink Display Image Optimization
 *
 * Provides high-quality image processing optimized for e-ink displays with limited color
 * palettes. Combines dithering, color reduction, level adjustments, and format conversion
 * into a single ImageMagick pipeline for optimal performance.
 *
 *
 * @module lib/dithering
 */

import gmLib, { State } from 'gm'

const gm = gmLib.subClass({ imageMagick: true })

import {
  COLOR_PALETTES,
  GRAYSCALE_PALETTES,
  VALID_ROTATIONS,
} from '../const.js'
import { FloydSteinbergStrategy } from './dithering/floyd-steinberg-strategy.js'
import { OrderedStrategy } from './dithering/ordered-strategy.js'
import { ThresholdStrategy } from './dithering/threshold-strategy.js'
import type {
  DitheringMethod,
  Palette,
  RotationAngle,
  ImageFormat,
  ColorPalette,
  GrayscalePalette,
  BitDepth,
  CompressionLevel,
} from '../types/domain.js'
import type {
  DitheringStrategy,
  DitheringMode,
} from '../types/dithering-strategy.js'
import { ditheringLogger } from './logger.js'

const log = ditheringLogger()

// =============================================================================
// PUBLIC CONSTANTS
// =============================================================================

/** Supported dithering methods */
export const SUPPORTED_METHODS: readonly DitheringMethod[] = [
  'floyd-steinberg',
  'ordered',
  'threshold',
] as const

/** Method name including legacy 'none' alias */
type DitheringMethodWithAlias = DitheringMethod | 'none'

/** Supported palette names (grayscale + color) */
export const SUPPORTED_PALETTES: readonly Palette[] = [
  ...Object.keys(GRAYSCALE_PALETTES),
  ...Object.keys(COLOR_PALETTES),
] as Palette[]

/**
 * Checks if a palette is a color palette (vs grayscale)
 */
export function isColorPalette(palette: string): palette is ColorPalette {
  return palette in COLOR_PALETTES
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/** Options for image processing */
export interface ProcessImageOptions {
  format?: ImageFormat
  rotate?: RotationAngle
  invert?: boolean
  dithering?: DitheringOptions
}

/** Options for dithering */
export interface DitheringOptions {
  enabled?: boolean
  method?: DitheringMethodWithAlias
  palette?: Palette
  gammaCorrection?: boolean
  /** Enable manual black/white level adjustments */
  levelsEnabled?: boolean
  blackLevel?: number
  whiteLevel?: number
  normalize?: boolean
  saturationBoost?: boolean
  invert?: boolean
  rotate?: RotationAngle | 0
  format?: ImageFormat
  /** Override bit depth for PNG output (default: auto from palette) */
  bitDepth?: BitDepth
  /** PNG compression level 1-9 (default: 9, max compression) */
  compressionLevel?: CompressionLevel
}

/** Validated dithering options with defaults applied */
export interface ValidatedDitheringOptions {
  method: DitheringMethodWithAlias
  palette: Palette
  gammaCorrection: boolean
  blackLevel: number
  whiteLevel: number
  normalize: boolean
  saturationBoost: boolean
  rotate: RotationAngle | 0
}

/** Image metadata */
export interface ImageInfo {
  width: number
  height: number
  format: string
}

/**
 * Validates and normalizes dithering options with sensible defaults.
 */
export function validateDitheringOptions(
  options: Partial<DitheringOptions> = {}
): ValidatedDitheringOptions {
  const palette = (
    SUPPORTED_PALETTES.includes(options.palette!) ? options.palette : 'gray-4'
  )!
  const isColor = isColorPalette(palette)

  return {
    method:
      options.method &&
      ['floyd-steinberg', 'ordered', 'none', 'threshold'].includes(
        options.method
      )
        ? options.method
        : 'floyd-steinberg',
    palette,
    gammaCorrection:
      options.gammaCorrection !== undefined ? options.gammaCorrection : true,
    blackLevel: Math.max(0, Math.min(100, options.blackLevel ?? 0)),
    whiteLevel: Math.max(0, Math.min(100, options.whiteLevel ?? 100)),
    // NOTE: normalize defaults to true for ALL palettes (including grayscale)
    // to prevent washed-out gray output. See GitHub issue #9.
    normalize: options.normalize ?? true,
    saturationBoost:
      options.saturationBoost !== undefined ? options.saturationBoost : isColor,
    rotate: VALID_ROTATIONS.includes(options.rotate as RotationAngle)
      ? (options.rotate as RotationAngle)
      : 0,
  }
}

// =============================================================================
// DITHERING STRATEGY REGISTRY
// =============================================================================

/** Strategy registry mapping method names to strategy instances */
const DITHERING_STRATEGIES: Record<
  DitheringMethodWithAlias,
  DitheringStrategy
> = {
  'floyd-steinberg': new FloydSteinbergStrategy(),
  ordered: new OrderedStrategy(),
  threshold: new ThresholdStrategy(),
  none: new ThresholdStrategy(), // Legacy alias
}

/**
 * Gets dithering strategy for a given method name.
 * Falls back to Floyd-Steinberg if unknown method provided.
 */
function getStrategy(method: string): DitheringStrategy {
  return (
    DITHERING_STRATEGIES[method as DitheringMethodWithAlias] ||
    DITHERING_STRATEGIES['floyd-steinberg']
  )
}

// =============================================================================
// STREAM UTILITIES
// =============================================================================

/** Options for streaming gm image to buffer */
interface StreamOptions {
  format: string
  onCleanup?: () => void
}

/**
 * Streams a gm image to a Buffer with consistent error handling.
 * Extracted to reduce duplication across processing functions.
 */
function streamToBuffer(
  image: State,
  { format, onCleanup }: StreamOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    const cleanup = () => {
      if (onCleanup) onCleanup()
    }

    image.stream(format, (err, stdout, stderr) => {
      if (err) {
        cleanup()
        reject(err)
        return
      }

      stdout.on('data', (chunk: Buffer) => chunks.push(chunk))

      stdout.on('end', () => {
        cleanup()
        const buffer = Buffer.concat(chunks)
        if (buffer.length === 0) {
          reject(new Error(`ImageMagick produced empty ${format} output`))
        } else {
          resolve(buffer)
        }
      })

      stdout.on('error', (err: Error) => {
        cleanup()
        reject(err)
      })

      stderr.on('data', (data: Buffer) => {
        log.warn`ImageMagick stderr: ${data.toString()}`
      })
    })
  })
}

// =============================================================================
// FORMAT CONFIGURATION
// =============================================================================

/** Format-specific configuration for output */
interface FormatConfig {
  format: string
  compressionLevel?: CompressionLevel
  isColorPalette?: boolean
  bitDepth?: number | null
}

/**
 * Applies format-specific optimizations to a gm image.
 * Centralized to avoid duplication between processImage and applyDithering.
 */
function configureOutputFormat(
  image: State,
  {
    format,
    compressionLevel = 9,
    isColorPalette = false,
    bitDepth,
  }: FormatConfig
): { image: State; outputFormat: string } {
  let outputFormat: string = format

  if (format === 'bmp') {
    outputFormat = 'bmp3'
    if (bitDepth === 1) {
      image = image.out('-monochrome')
    } else if (bitDepth !== null && bitDepth !== undefined) {
      image = image.out('-depth', String(bitDepth))
    }
  } else if (format === 'jpeg') {
    outputFormat = 'jpeg'
    image = image.quality(60).interlace('Line')
  } else if (format === 'png') {
    if (bitDepth !== null && bitDepth !== undefined) {
      image = image.out('-type', 'Grayscale').out('-depth', String(bitDepth))
      log.debug`Outputting ${bitDepth}-bit grayscale PNG for e-ink`
    }
    // NOTE: Skip exclude-chunks for color palettes - removes PLTE chunk
    if (isColorPalette) {
      image = image.define(`png:compression-level=${compressionLevel}`)
    } else {
      image = image
        .define(`png:compression-level=${compressionLevel}`)
        .define('png:compression-filter=5')
        .define('png:compression-strategy=1')
        .define('png:exclude-chunks=all')
    }
    log.debug`PNG compression level: ${compressionLevel}`
  }

  return { image, outputFormat }
}

// =============================================================================
// IMAGE PROCESSING PIPELINE
// =============================================================================

/**
 * Main entry point for image processing - handles dithering, rotation, inversion, and format conversion.
 */
export async function processImage(
  imageBuffer: Buffer,
  options: ProcessImageOptions = {}
): Promise<Buffer> {
  const { format = 'png', rotate, invert, dithering } = options

  let buffer = imageBuffer

  // Apply dithering if enabled (includes format conversion in single pipeline)
  if (dithering?.enabled) {
    buffer = await applyDithering(buffer, {
      ...dithering,
      invert: invert || false,
      rotate: rotate || 0,
      format,
    })
  } else if (rotate || invert) {
    // Rotate and/or invert without dithering
    buffer = await applySimpleProcessing(buffer, { rotate, invert })
    // Convert format if needed
    if (format !== 'png') {
      buffer = await convertToFormat(buffer, format)
    }
  } else if (format !== 'png') {
    // Just format conversion, no processing
    buffer = await convertToFormat(buffer, format)
  }

  return buffer
}

/**
 * Apply simple processing (rotation and/or inversion) without dithering
 */
async function applySimpleProcessing(
  imageBuffer: Buffer,
  options: { rotate?: RotationAngle; invert?: boolean } = {}
): Promise<Buffer> {
  const { rotate, invert } = options

  if (!rotate && !invert) {
    return imageBuffer
  }

  let image: State = gm(imageBuffer)

  if (rotate && VALID_ROTATIONS.includes(rotate)) {
    image = image.rotate('white', rotate)
  }

  if (invert) {
    image = image.out('-negate')
  }

  return streamToBuffer(image, { format: 'png' })
}

/**
 * Converts image buffer to specified format with e-ink optimizations.
 * Applies aggressive compression while preserving visual quality for e-ink displays.
 */
export async function convertToFormat(
  imageBuffer: Buffer,
  format: ImageFormat
): Promise<Buffer> {
  const image: State = gm(imageBuffer).strip()

  const { image: configured, outputFormat } = configureOutputFormat(image, {
    format,
    isColorPalette: false,
  })

  return streamToBuffer(configured, { format: outputFormat })
}

/**
 * Get image metadata
 */
export async function getImageInfo(imageBuffer: Buffer): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    gm(imageBuffer).identify((err, data) => {
      if (err) {
        reject(err)
        return
      }
      resolve({
        width: data.size.width,
        height: data.size.height,
        format: data.format.toLowerCase(),
      })
    })
  })
}

// =============================================================================
// DITHERING PIPELINE
// =============================================================================

/**
 * Applies advanced dithering with color reduction, level adjustments, and format conversion.
 */
/** Result from dithering including size info */
export interface DitheringResult {
  buffer: Buffer
  sizeBytes: number
  sizeKB: number
  bitDepth: number | null
  compressionLevel: number
}

export async function applyDithering(
  imageBuffer: Buffer,
  options: DitheringOptions = {}
): Promise<Buffer> {
  const {
    method = 'floyd-steinberg',
    palette = 'gray-4',
    gammaCorrection = true,
    levelsEnabled = false,
    blackLevel = 0,
    whiteLevel = 100,
    invert = false,
    rotate = 0,
    format = 'png',
    bitDepth: bitDepthOverride,
    compressionLevel = 9,
  } = options

  const isColorPaletteMode = Boolean(
    palette && COLOR_PALETTES[palette as ColorPalette]
  )
  const isGrayscalePaletteMode = Boolean(
    palette && GRAYSCALE_PALETTES[palette as GrayscalePalette]
  )

  // Smart defaults:
  // - normalize: enabled by default for ALL palettes to prevent gray/washed-out output
  // - saturationBoost: enabled by default only for color palettes
  // See GitHub issue #9 for gray background root cause analysis.
  const normalize = options.normalize ?? true
  const saturationBoost = options.saturationBoost ?? isColorPaletteMode

  let image: State = gm(imageBuffer)

  // Apply rotation BEFORE dithering
  if (rotate && VALID_ROTATIONS.includes(rotate)) {
    image = image.rotate('white', rotate)
  }

  // Remove color profile for e-ink
  if (gammaCorrection) {
    image = image.noProfile()
  }

  // Track bit depth for compression (grayscale only)
  let bitDepth: number | null = null

  // Process based on palette type
  if (isColorPaletteMode) {
    image = applyColorDithering(image, {
      palette: palette as ColorPalette,
      method,
      normalize,
      saturationBoost,
    })
  } else {
    const colors = isGrayscalePaletteMode
      ? GRAYSCALE_PALETTES[palette as GrayscalePalette]
      : GRAYSCALE_PALETTES['gray-4']
    const result = applyGrayscaleDithering(image, {
      method,
      colors,
      levelsEnabled,
      blackLevel,
      whiteLevel,
      normalize,
    })
    image = result.image
    // Use override if provided, otherwise use calculated from palette
    bitDepth = bitDepthOverride ?? result.bitDepth
    if (bitDepthOverride && bitDepthOverride !== result.bitDepth) {
      log.debug`Using custom bit depth ${bitDepthOverride} (palette default: ${result.bitDepth})`
    }
  }

  // Apply color inversion if requested
  if (invert) {
    image = image.out('-negate')
  }

  // Strip metadata for smaller files (skip for color palettes - breaks colormap)
  if (!isColorPaletteMode) {
    image = image.strip()
  }

  // Apply format-specific optimizations
  const { image: configured, outputFormat } = configureOutputFormat(image, {
    format,
    compressionLevel,
    isColorPalette: isColorPaletteMode,
    bitDepth,
  })

  // Stream to final format
  const buffer = await streamToBuffer(configured, { format: outputFormat })

  // Log output size
  const sizeKB = (buffer.length / 1024).toFixed(1)
  const status = buffer.length > 50 * 1024 ? '⚠️ OVER 50KB' : '✓'
  log.info`Output: ${buffer.length} bytes (${sizeKB}KB) ${status} [depth:${
    bitDepth ?? 'auto'
  }, compression:${compressionLevel}]`

  return buffer
}

/** Options for grayscale dithering */
interface GrayscaleDitheringOptions {
  method: string
  colors: number
  levelsEnabled: boolean
  blackLevel: number
  whiteLevel: number
  normalize: boolean
}

/**
 * Calculate bit depth from number of colors.
 * Used for PNG/BMP compression optimization.
 */
function getBitDepth(colors: number): number {
  // 2 colors = 1-bit, 4 = 2-bit, 16 = 4-bit, 256 = 8-bit
  return Math.ceil(Math.log2(colors))
}

/** Result from grayscale dithering with bit depth info */
interface GrayscaleDitheringResult {
  image: State
  bitDepth: number
}

/**
 * Applies grayscale dithering with level adjustments.
 * Returns both the processed image and the bit depth for compression.
 */
function applyGrayscaleDithering(
  image: State,
  options: GrayscaleDitheringOptions
): GrayscaleDitheringResult {
  const { method, colors, levelsEnabled, blackLevel, whiteLevel, normalize } =
    options
  const bitDepth = getBitDepth(colors)

  // Convert to grayscale
  image = image.colorspace('Gray')

  // Normalize stretches histogram to use full range (auto-contrast)
  if (normalize) {
    image = image.normalize()
  }

  // Apply level adjustments for contrast (only when enabled and values differ from defaults)
  if (levelsEnabled && (blackLevel > 0 || whiteLevel < 100)) {
    const blackPoint = `${blackLevel}%`
    const whitePoint = `${whiteLevel}%`
    // NOTE: gm.level() uses GraphicsMagick arg order; ImageMagick expects black,white,gamma.
    image = image.out('-level', `${blackPoint},${whitePoint}`)
  }

  // Select and apply dithering strategy
  const strategy = getStrategy(method)
  image = strategy.call(image, {
    mode: 'grayscale' as DitheringMode,
    colors,
  })

  return { image, bitDepth }
}

/** Options for color dithering */
interface ColorDitheringOptions {
  palette: ColorPalette
  method: string
  normalize: boolean
  saturationBoost: boolean
}

/**
 * Applies color palette dithering with saturation boost and normalization.
 * Uses ImageMagick's mpr: (memory program register) to create inline palette,
 * avoiding temp file creation and cleanup.
 *
 * NOTE: This function returns a lazy pipeline (gm State object), not a Promise.
 * The ImageMagick commands are queued but not executed until the pipeline is
 * streamed via streamToBuffer(). This is intentional - no async/await needed.
 *
 * @see https://github.com/ImageMagick/ImageMagick/discussions/6332
 */
function applyColorDithering(
  image: State,
  options: ColorDitheringOptions
): State {
  const { palette, method, normalize, saturationBoost } = options
  const colors = COLOR_PALETTES[palette]

  if (!colors) {
    throw new Error(`Unknown color palette: ${palette}`)
  }

  // Boost saturation for more vivid colors on e-ink
  // NOTE: Must be applied BEFORE normalize, otherwise normalize cancels the effect
  if (saturationBoost) {
    image = image.modulate(110, 150)
  }

  // Normalize brightness for better color mapping
  if (normalize) {
    image = image.normalize()
  }

  // Convert to RGB colorspace for color processing
  image = image.colorspace('RGB')

  // Build inline palette using mpr: (memory program register)
  // This avoids temp file creation - palette exists only in memory
  // Lifecycle: mpr:palette is scoped to this ImageMagick command and freed on completion
  image = image.out('(')
  for (const color of colors) {
    image = image.out(`xc:${color}`)
  }
  image = image
    .out('+append')
    .out('-write', 'mpr:palette')
    .out('+delete')
    .out(')')

  // Apply dithering strategy
  const strategy = getStrategy(method)
  image = strategy.call(image, { mode: 'color' as DitheringMode })

  // Remap to the in-memory palette
  image = image.out('-remap', 'mpr:palette')
  image = image.colorspace('sRGB')

  return image
}
