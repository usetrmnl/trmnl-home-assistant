/**
 * Palette options - SINGLE SOURCE OF TRUTH for UI labels
 *
 * This file is browser-safe (no Node.js deps) so it can be:
 * 1. Served directly to browser for UI
 * 2. Imported by server-side const.ts for PALETTES
 *
 * @module html/js/palette-options
 */

export interface PaletteOption {
  value: string
  label: string
}

/** Grayscale palette options */
export const GRAYSCALE_OPTIONS: PaletteOption[] = [
  { value: 'bw', label: '1-bit (B&W)' },
  { value: 'gray-4', label: '2-bit (4 grays)' },
  { value: 'gray-16', label: '4-bit (16 grays)' },
  { value: 'gray-256', label: '8-bit (256 grays)' },
]

/** Color palette options */
export const COLOR_OPTIONS: PaletteOption[] = [
  { value: 'color-6a', label: '6-color (Inky 13.3)' },
  { value: 'color-7a', label: '7-color (Inky 7.3)' },
  { value: 'color-7b', label: '7-color Cyan (RTM1002)' },
  { value: 'color-8a', label: '8-color (Spectra 6)' },
]

/** All palette options (for UI dropdown) */
export const PALETTE_OPTIONS: PaletteOption[] = [
  ...GRAYSCALE_OPTIONS,
  ...COLOR_OPTIONS,
]
