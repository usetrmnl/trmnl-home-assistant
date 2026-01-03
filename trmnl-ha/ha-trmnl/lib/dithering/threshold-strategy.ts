/**
 * Threshold Strategy (No Dithering)
 *
 * Simple threshold-based quantization without dithering.
 * Fastest method but lowest quality (harsh banding in gradients).
 *
 * Algorithm Overview:
 * Hard cutoff at threshold value - no smoothing or pattern generation.
 * Binary: Pixels above 50% brightness → white, below 50% → black.
 * Multi-level: Divides 0-255 range into N equal bands, snaps to nearest.
 *
 * @module lib/dithering/threshold-strategy
 */

import type { State } from 'gm'
import type {
  DitheringStrategy,
  DitheringStrategyOptions,
} from '../../types/dithering-strategy.js'

/**
 * Threshold-based quantization (no dithering)
 *
 * Fastest, lowest quality. Use for:
 * - Extreme performance requirements
 * - Binary content (text, line art, diagrams)
 * - Intentional posterization effect
 */
export class ThresholdStrategy implements DitheringStrategy {
  /**
   * Applies threshold-based quantization via ImageMagick.
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
        // Binary threshold at 50%
        return image.out('-threshold', '50%')
      } else if (colors !== undefined && colors > 2) {
        // Multi-level grayscale without dithering (posterize)
        return image.out('-posterize', String(colors))
      }
    } else if (mode === 'color') {
      // Color palette without dithering - return unchanged
      // Palette remapping happens separately
      return image
    }

    // Fallback: return image unchanged
    return image
  }
}
