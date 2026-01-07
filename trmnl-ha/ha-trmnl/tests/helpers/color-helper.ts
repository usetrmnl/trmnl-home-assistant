/**
 * Color Analysis Helper Utilities
 *
 * Provides color manipulation, distance calculation, and palette verification
 * for testing color dithering functionality.
 *
 * @module tests/helpers/color-helper
 */

import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default color tolerance for palette verification.
 * Allows for minor compression artifacts and color space conversion differences.
 * Value of 30 in RGB Euclidean distance covers ~2% variance per channel.
 */
const DEFAULT_COLOR_TOLERANCE = 30

/**
 * Default tolerance for hasColorNear checks.
 * Slightly higher than palette verification to account for dithering spread.
 */
const DEFAULT_NEAR_TOLERANCE = 50

// =============================================================================
// TYPES
// =============================================================================

/** RGB color components */
export interface RGB {
  r: number
  g: number
  b: number
}

/** Result of finding closest palette color */
export interface ClosestColorResult {
  color: string
  distance: number
}

/** Result of palette verification */
export interface PaletteVerification {
  valid: boolean
  outOfRange: ClosestColorResult[]
}

// =============================================================================
// COLOR PARSING
// =============================================================================

/**
 * Parses a hex color string to RGB components
 * @param hex - Color in format '#RRGGBB'
 */
export function hexToRgb(hex: string): RGB {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

// =============================================================================
// COLOR DISTANCE
// =============================================================================

/**
 * Calculates Euclidean distance between two colors in RGB space
 * @param hex1 - First color in format '#RRGGBB'
 * @param hex2 - Second color in format '#RRGGBB'
 * @returns Distance value (0 = identical, ~441 = max for black/white)
 */
export function colorDistance(hex1: string, hex2: string): number {
  const c1 = hexToRgb(hex1)
  const c2 = hexToRgb(hex2)

  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
      Math.pow(c1.g - c2.g, 2) +
      Math.pow(c1.b - c2.b, 2)
  )
}

/**
 * Finds the closest color in a palette to a given color
 * @param color - Target color in format '#RRGGBB'
 * @param palette - Array of palette colors in format '#RRGGBB'
 */
export function findClosestPaletteColor(
  color: string,
  palette: string[]
): ClosestColorResult {
  const firstColor = palette[0]
  if (!firstColor) {
    throw new Error('Palette must contain at least one color')
  }
  let closest: ClosestColorResult = { color: firstColor, distance: Infinity }

  for (const paletteColor of palette) {
    const dist = colorDistance(color, paletteColor)
    if (dist < closest.distance) {
      closest = { color: paletteColor, distance: dist }
    }
  }

  return closest
}

// =============================================================================
// IMAGE COLOR EXTRACTION
// =============================================================================

/**
 * Extracts unique colors from an image buffer using ImageMagick
 * @param imageBuffer - PNG image buffer
 * @returns Set of unique hex colors found in the image
 */
export async function extractUniqueColors(
  imageBuffer: Buffer
): Promise<Set<string>> {
  // Use timestamp + random bytes to avoid race conditions in parallel tests
  const uniqueId = `${Date.now()}_${randomBytes(4).toString('hex')}`
  const inputFile = join(tmpdir(), `color_extract_${uniqueId}.png`)
  writeFileSync(inputFile, imageBuffer)

  try {
    // Use 'convert' command for compatibility with both ImageMagick 6 and 7
    // IM7 has 'magick' but 'convert' still works; IM6 only has 'convert'
    const output = execFileSync(
      'convert',
      [inputFile, '-format', '%c', '-depth', '8', 'histogram:info:'],
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    )

    const colors = new Set<string>()
    const colorRegex = /#([0-9A-Fa-f]{6})/g
    let match

    while ((match = colorRegex.exec(output)) !== null) {
      const hexColor = match[1]
      if (hexColor) {
        colors.add(`#${hexColor.toUpperCase()}`)
      }
    }

    return colors
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to extract colors from image: ${message}`)
  } finally {
    try {
      unlinkSync(inputFile)
    } catch (_err) {
      // Cleanup failures are non-fatal in tests but worth noting for debugging
      // The OS will eventually clean up temp files
    }
  }
}

// =============================================================================
// PALETTE VERIFICATION
// =============================================================================

/**
 * Verifies all colors in an image are within tolerance of palette colors
 * @param imageColors - Set of colors found in the image
 * @param palette - Array of allowed palette colors
 * @param tolerance - Maximum allowed distance from palette (default: DEFAULT_COLOR_TOLERANCE)
 */
export function verifyColorsMatchPalette(
  imageColors: Set<string>,
  palette: string[],
  tolerance: number = DEFAULT_COLOR_TOLERANCE
): PaletteVerification {
  const outOfRange: ClosestColorResult[] = []

  for (const color of imageColors) {
    const closest = findClosestPaletteColor(color, palette)
    if (closest.distance > tolerance) {
      outOfRange.push({ color, distance: closest.distance })
    }
  }

  return {
    valid: outOfRange.length === 0,
    outOfRange,
  }
}

/**
 * Checks if any color in the set is close to a target color
 * @param colors - Set of colors to search
 * @param target - Target color to match
 * @param tolerance - Maximum distance to consider a match (default: DEFAULT_NEAR_TOLERANCE)
 */
export function hasColorNear(
  colors: Set<string>,
  target: string,
  tolerance: number = DEFAULT_NEAR_TOLERANCE
): boolean {
  return Array.from(colors).some((c) => colorDistance(c, target) < tolerance)
}
