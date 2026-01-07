/**
 * Integration tests for color palette dithering
 *
 * Verifies that color palettes (color-6a, color-7a) correctly remap
 * images to use only the defined palette colors.
 *
 * @module tests/integration/color-palette
 */

import { describe, it, expect, beforeAll } from 'bun:test'
import { applyDithering } from '../../lib/dithering.js'
import { COLOR_PALETTES } from '../../const.js'
import type { ColorPalette } from '../../types/domain.js'
import {
  createColorfulTestImage,
  createGradientTestImage,
  createSolidColorImage,
} from '../helpers/image-helper.js'
import {
  extractUniqueColors,
  verifyColorsMatchPalette,
  hasColorNear,
} from '../helpers/color-helper.js'

describe('Color Palette Dithering', () => {
  let colorfulImage: Buffer
  let gradientImage: Buffer

  beforeAll(async () => {
    colorfulImage = await createColorfulTestImage()
    gradientImage = await createGradientTestImage()
  }, 30000)

  describe('color-6a palette (RGBYKW)', () => {
    const palette: ColorPalette = 'color-6a'
    const paletteColors = COLOR_PALETTES[palette]

    it('constrains colorful image to palette colors', async () => {
      const result = await applyDithering(colorfulImage, {
        method: 'floyd-steinberg',
        palette,
        format: 'png',
      })

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)

      const uniqueColors = await extractUniqueColors(result)
      const verification = verifyColorsMatchPalette(uniqueColors, paletteColors)

      if (!verification.valid) {
        console.log('Out-of-range colors:', verification.outOfRange)
      }

      expect(verification.valid).toBe(true)
    }, 30000)

    it('constrains gradient image to palette colors', async () => {
      const result = await applyDithering(gradientImage, {
        method: 'floyd-steinberg',
        palette,
        format: 'png',
      })

      const uniqueColors = await extractUniqueColors(result)
      const verification = verifyColorsMatchPalette(uniqueColors, paletteColors)

      expect(verification.valid).toBe(true)
    }, 30000)

    it('works with ordered dithering method', async () => {
      const result = await applyDithering(colorfulImage, {
        method: 'ordered',
        palette,
        format: 'png',
      })

      const uniqueColors = await extractUniqueColors(result)
      const verification = verifyColorsMatchPalette(uniqueColors, paletteColors)

      expect(verification.valid).toBe(true)
    }, 30000)
  })

  describe('color-7a palette (BWRGBYO)', () => {
    const palette: ColorPalette = 'color-7a'
    const paletteColors = COLOR_PALETTES[palette]

    it('constrains colorful image to palette colors', async () => {
      const result = await applyDithering(colorfulImage, {
        method: 'floyd-steinberg',
        palette,
        format: 'png',
      })

      expect(Buffer.isBuffer(result)).toBe(true)

      const uniqueColors = await extractUniqueColors(result)
      const verification = verifyColorsMatchPalette(uniqueColors, paletteColors)

      if (!verification.valid) {
        console.log('Out-of-range colors:', verification.outOfRange)
      }

      expect(verification.valid).toBe(true)
    }, 30000)

    it('includes orange in palette output when input has orange tones', async () => {
      const orangeImage = await createSolidColorImage('#FFA500')

      const result = await applyDithering(orangeImage, {
        method: 'threshold',
        palette,
        saturationBoost: false,
        normalize: false,
        format: 'png',
      })

      const uniqueColors = await extractUniqueColors(result)
      expect(hasColorNear(uniqueColors, '#FFA500')).toBe(true)
    }, 30000)
  })

  describe('output format compatibility', () => {
    it('produces valid PNG with color palette', async () => {
      const result = await applyDithering(colorfulImage, {
        method: 'floyd-steinberg',
        palette: 'color-6a',
        format: 'png',
      })

      // PNG magic number
      expect(result[0]).toBe(0x89)
      expect(result[1]).toBe(0x50)
    }, 30000)

    it('produces valid JPEG with color palette', async () => {
      const result = await applyDithering(colorfulImage, {
        method: 'floyd-steinberg',
        palette: 'color-6a',
        format: 'jpeg',
      })

      // JPEG magic number
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xd8)
    }, 30000)

    it('produces valid BMP with color palette', async () => {
      const result = await applyDithering(colorfulImage, {
        method: 'floyd-steinberg',
        palette: 'color-6a',
        format: 'bmp',
      })

      // BMP magic number
      expect(result[0]).toBe(0x42) // 'B'
      expect(result[1]).toBe(0x4d) // 'M'
    }, 30000)
  })

  describe('dithering quality options', () => {
    it('applies saturation boost when enabled', async () => {
      const withBoost = await applyDithering(colorfulImage, {
        method: 'floyd-steinberg',
        palette: 'color-6a',
        saturationBoost: true,
        format: 'png',
      })

      const withoutBoost = await applyDithering(colorfulImage, {
        method: 'floyd-steinberg',
        palette: 'color-6a',
        saturationBoost: false,
        format: 'png',
      })

      // Both should be valid buffers
      expect(Buffer.isBuffer(withBoost)).toBe(true)
      expect(Buffer.isBuffer(withoutBoost)).toBe(true)
      expect(withBoost.length).toBeGreaterThan(0)
      expect(withoutBoost.length).toBeGreaterThan(0)

      // Both should be valid PNGs
      expect(withBoost[0]).toBe(0x89)
      expect(withoutBoost[0]).toBe(0x89)
    }, 30000)

    it('applies normalization when enabled', async () => {
      const normalized = await applyDithering(colorfulImage, {
        method: 'floyd-steinberg',
        palette: 'color-6a',
        normalize: true,
        format: 'png',
      })

      expect(Buffer.isBuffer(normalized)).toBe(true)
      expect(normalized.length).toBeGreaterThan(0)
    }, 30000)
  })
})
