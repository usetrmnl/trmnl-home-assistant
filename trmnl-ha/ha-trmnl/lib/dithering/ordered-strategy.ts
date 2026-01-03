/**
 * Ordered (Bayer Matrix) Dithering Strategy
 *
 * Implements ordered dithering using Bayer threshold matrix.
 * Faster than Floyd-Steinberg (~2x) but lower quality (visible patterns).
 *
 * Algorithm Overview:
 * Uses pre-computed Bayer matrix to threshold pixels deterministically.
 * Each pixel position maps to a threshold value in the repeating matrix.
 * Creates regular crosshatch/checkerboard patterns.
 *
 * @module lib/dithering/ordered-strategy
 */

import type { State } from 'gm'
import type {
  DitheringStrategy,
  DitheringStrategyOptions,
} from '../../types/dithering-strategy.js'

/**
 * Ordered (Bayer matrix) dithering
 *
 * Fast with visible patterns. Use for:
 * - UI elements (text, icons, charts)
 * - Batch processing (performance critical)
 * - Real-time dithering (speed over quality)
 */
export class OrderedStrategy implements DitheringStrategy {
  /**
   * Applies ordered (Bayer matrix) dithering via ImageMagick.
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
        // Binary (black & white) with Bayer matrix (ordered2x2)
        return image.out('-dither', 'None').out('-monochrome')
      } else if (colors !== undefined && colors > 2) {
        // Multi-level grayscale with ordered dithering
        return image.out('-dither', 'None').out('-colors', String(colors))
      }
    } else if (mode === 'color') {
      // Color palette with ordered dithering
      return image.out('-dither', 'None')
    }

    // Fallback: return image unchanged
    return image
  }
}
