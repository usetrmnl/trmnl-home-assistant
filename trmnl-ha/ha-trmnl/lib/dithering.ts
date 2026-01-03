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
import { unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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
  blackLevel?: number
  whiteLevel?: number
  normalize?: boolean
  saturationBoost?: boolean
  invert?: boolean
  rotate?: RotationAngle | 0
  format?: ImageFormat
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
    normalize: options.normalize !== undefined ? options.normalize : isColor,
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

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let image: State = gm(imageBuffer)

    if (rotate && VALID_ROTATIONS.includes(rotate)) {
      image = image.rotate('white', rotate)
    }

    if (invert) {
      image = image.out('-negate')
    }

    image.stream('png', (err, stdout, stderr) => {
      if (err) {
        reject(err)
        return
      }

      stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      stdout.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
      stdout.on('error', reject)
      stderr.on('data', (data: Buffer) => {
        log.warn`ImageMagick stderr: ${data.toString()}`
      })
    })
  })
}

/**
 * Converts image buffer to specified format with e-ink optimizations.
 * Applies aggressive compression while preserving visual quality for e-ink displays.
 */
export async function convertToFormat(
  imageBuffer: Buffer,
  format: ImageFormat
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    let image: State = gm(imageBuffer)

    // Strip metadata for smaller files
    image = image.strip()

    let imFormat: string = format
    if (format === 'bmp') {
      imFormat = 'bmp3'
    } else if (format === 'jpeg') {
      imFormat = 'jpeg'
      // Lower quality for e-ink (no smooth gradients needed)
      image = image.quality(60).interlace('Line')
    } else if (format === 'png') {
      // Maximum PNG compression with all optimizations
      image = image
        .define('png:compression-level=9')
        .define('png:compression-filter=5')
        .define('png:compression-strategy=1')
        .define('png:exclude-chunks=all') // Remove all ancillary chunks
    }

    image.stream(imFormat, (err, stdout, stderr) => {
      if (err) {
        reject(err)
        return
      }

      stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      stdout.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if (buffer.length === 0) {
          reject(new Error(`ImageMagick produced empty ${format} output`))
        } else {
          resolve(buffer)
        }
      })
      stdout.on('error', reject)
      stderr.on('data', (data: Buffer) => {
        log.warn`ImageMagick stderr: ${data.toString()}`
      })
    })
  })
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
export async function applyDithering(
  imageBuffer: Buffer,
  options: DitheringOptions = {}
): Promise<Buffer> {
  const {
    method = 'floyd-steinberg',
    palette = 'gray-4',
    gammaCorrection = true,
    blackLevel = 0,
    whiteLevel = 100,
    normalize = false,
    saturationBoost = false,
    invert = false,
    rotate = 0,
    format = 'png',
  } = options

  const isColorPaletteMode = palette && COLOR_PALETTES[palette as ColorPalette]
  const isGrayscalePaletteMode =
    palette && GRAYSCALE_PALETTES[palette as GrayscalePalette]

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
    image = await applyColorDithering(image, {
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
      blackLevel,
      whiteLevel,
    })
    image = result.image
    bitDepth = result.bitDepth
  }

  // Apply color inversion if requested
  if (invert) {
    image = image.out('-negate')
  }

  // Strip all metadata for smaller file size
  image = image.strip()

  // Apply format-specific optimizations
  let outputFormat: string = format
  if (format === 'bmp') {
    outputFormat = 'bmp3'
    // Apply bit depth for BMP - use -monochrome for 1-bit
    if (bitDepth === 1) {
      image = image.out('-monochrome')
    } else if (bitDepth !== null) {
      image = image.out('-depth', String(bitDepth))
    }
  } else if (format === 'jpeg') {
    outputFormat = 'jpeg'
    // Lower quality for e-ink (no smooth gradients needed)
    image = image.quality(60).interlace('Line')
  } else if (format === 'png') {
    if (bitDepth !== null) {
      image = image.out('-type', 'Grayscale').out('-depth', String(bitDepth))
      log.debug`Outputting ${bitDepth}-bit grayscale PNG for e-ink`
    }
    // PNG compression settings
    image = image
      .define('png:compression-level=9')
      .define('png:compression-filter=5')
      .define('png:compression-strategy=1')
      .define('png:exclude-chunks=all')
  }

  // Stream to final format
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    image.stream(outputFormat, (err, stdout, stderr) => {
      if (err) {
        reject(err)
        return
      }

      stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      stdout.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if (buffer.length === 0) {
          reject(new Error(`ImageMagick produced empty ${format} output`))
        } else {
          resolve(buffer)
        }
      })

      stdout.on('error', (err: Error) => {
        reject(err)
      })

      stderr.on('data', (data: Buffer) => {
        log.warn`ImageMagick stderr: ${data.toString()}`
      })
    })
  })
}

/** Options for grayscale dithering */
interface GrayscaleDitheringOptions {
  method: string
  colors: number
  blackLevel: number
  whiteLevel: number
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
  const { method, colors, blackLevel, whiteLevel } = options
  const bitDepth = getBitDepth(colors)

  // Convert to grayscale
  image = image.colorspace('Gray')

  // Apply level adjustments for contrast
  if (blackLevel > 0 || whiteLevel < 100) {
    const blackPoint = `${blackLevel}%`
    const whitePoint = `${whiteLevel}%`
    // NOTE: gm .level() accepts strings but @types/gm is incomplete
    image = (
      image as State & { level(b: string, g: number, w: string): State }
    ).level(blackPoint, 1.0, whitePoint)
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
 */
async function applyColorDithering(
  image: State,
  options: ColorDitheringOptions
): Promise<State> {
  const { palette, method, normalize, saturationBoost } = options
  const colors = COLOR_PALETTES[palette]

  if (!colors) {
    throw new Error(`Unknown color palette: ${palette}`)
  }

  // Normalize brightness for better color mapping
  if (normalize) {
    image = image.normalize()
  }

  // Boost saturation for more vivid colors on e-ink
  if (saturationBoost) {
    image = image.modulate(110, 150)
  }

  // Convert to RGB colorspace for color processing
  image = image.colorspace('RGB')

  // Create temporary palette file for remapping
  const paletteFile = join(tmpdir(), `palette_${Date.now()}.png`)

  try {
    await createPaletteFile(colors, paletteFile)

    const strategy = getStrategy(method)
    image = strategy.call(image, {
      mode: 'color' as DitheringMode,
    })

    image = image.map(paletteFile)
    image = image.colorspace('sRGB')

    return image
  } finally {
    if (existsSync(paletteFile)) {
      try {
        unlinkSync(paletteFile)
      } catch (_e) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Creates a temporary palette file from color array for ImageMagick color remapping.
 */
function createPaletteFile(
  colors: string[],
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const width = colors.length
    const height = 1

    let paletteImage: State = gm(width, height, colors[0])

    colors.forEach((color, i) => {
      if (i > 0) {
        paletteImage = paletteImage.fill(color).drawPoint(i, 0)
      }
    })

    paletteImage.write(outputPath, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}
