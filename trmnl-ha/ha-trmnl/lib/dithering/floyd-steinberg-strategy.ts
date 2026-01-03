/**
 * Floyd-Steinberg Error Diffusion Dithering Strategy
 *
 * Implements Floyd-Steinberg algorithm for high-quality dithering.
 * Best visual quality but slowest performance (~2x slower than ordered).
 *
 * Algorithm Overview:
 * Error diffusion algorithm that distributes quantization errors to neighboring pixels.
 * When a pixel is rounded to nearest palette color, the rounding error propagates:
 * - 7/16 to pixel on right
 * - 3/16 to pixel below-left
 * - 5/16 to pixel below
 * - 1/16 to pixel below-right
 *
 * This creates natural-looking dither patterns without visible repetition.
 *
 * @module lib/dithering/floyd-steinberg-strategy
 */

import type { State } from 'gm'
import type {
  DitheringStrategy,
  DitheringStrategyOptions,
} from '../../types/dithering-strategy.js'

/**
 * Floyd-Steinberg error diffusion dithering
 *
 * Best quality, slowest performance. Use for:
 * - Photographic content (gradients, faces, natural scenes)
 * - Maximum quality when performance not critical
 */
export class FloydSteinbergStrategy implements DitheringStrategy {
  /**
   * Applies Floyd-Steinberg dithering via ImageMagick.
   *
   * @param image - gm image instance (chainable)
   * @param options - Dithering configuration
   * @returns Modified gm image instance (chainable)
   */
  call(
    image: State,
    options: DitheringStrategyOptions = { mode: 'grayscale' }
  ): State {
    const { mode, colors } = options

    if (mode === 'grayscale') {
      if (colors === 2) {
        // Binary (black & white) with error diffusion
        return image.out('-dither', 'FloydSteinberg').out('-monochrome')
      } else if (colors !== undefined && colors > 2) {
        // Multi-level grayscale with error diffusion
        return image
          .out('-dither', 'FloydSteinberg')
          .out('-colors', String(colors))
      }
    } else if (mode === 'color') {
      // Color palette with error diffusion
      return image.out('-dither', 'FloydSteinberg')
    }

    // Fallback: return image unchanged
    return image
  }
}
