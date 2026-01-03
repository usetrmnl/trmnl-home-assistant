/**
 * Dithering Strategy Interface
 *
 * Common interface for all dithering algorithm implementations.
 * Uses Strategy pattern for swappable dithering algorithms.
 *
 * @module types/dithering-strategy
 */

import type { State } from 'gm'

/** Dithering mode determining color handling */
export type DitheringMode = 'grayscale' | 'color'

/** Options passed to dithering strategies */
export interface DitheringStrategyOptions {
  /** Processing mode: grayscale or color */
  mode: DitheringMode

  /** Number of colors for grayscale mode (2, 4, 16, 256) */
  colors?: number
}

/**
 * Interface for dithering strategy implementations
 *
 * All strategies are stateless and reusable.
 */
export interface DitheringStrategy {
  /**
   * Applies dithering algorithm to image
   *
   * @param image - ImageMagick image instance (chainable)
   * @param options - Dithering configuration
   * @returns Modified ImageMagick image instance (chainable)
   */
  call(image: State, options: DitheringStrategyOptions): State
}
