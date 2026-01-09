/**
 * Unit tests for Screenshot Parameters Parser
 *
 * @module tests/unit/screenshot-params-parser
 */

import { describe, it, expect } from 'bun:test'
import { ScreenshotParamsParser } from '../../lib/screenshot-params-parser.js'

describe('ScreenshotParamsParser', () => {
  const parser = new ScreenshotParamsParser()

  // Helper to create URL with query params
  const createUrl = (
    pathname: string,
    params: Record<string, string | boolean | undefined>
  ): URL => {
    const url = new URL(`http://localhost${pathname}`)
    Object.entries(params).forEach(([key, value]) => {
      if (value === true) {
        url.searchParams.set(key, '')
      } else if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    })
    return url
  }

  // ==========================================================================
  // call() - Main parser entry point
  // ==========================================================================

  describe('call', () => {
    it('returns null when viewport parameter is missing', () => {
      const url = createUrl('/lovelace/0', {})

      const result = parser.call(url)

      expect(result).toBeNull()
    })

    it('returns null when viewport parameter is invalid', () => {
      const url = createUrl('/lovelace/0', { viewport: 'invalid' })

      const result = parser.call(url)

      expect(result).toBeNull()
    })

    it('returns params object when viewport is valid', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600' })

      const result = parser.call(url)

      expect(result).not.toBeNull()
      expect(result!.pagePath).toBe('/lovelace/0')
    })
  })

  // ==========================================================================
  // Viewport Parsing - Required parameter (WIDTHxHEIGHT)
  // ==========================================================================

  describe('Viewport Parsing', () => {
    it('parses valid viewport dimensions', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600' })

      const result = parser.call(url)

      expect(result!.viewport).toEqual({ width: 800, height: 600 })
    })

    it('parses viewport with large dimensions', () => {
      const url = createUrl('/lovelace/0', { viewport: '1920x1080' })

      const result = parser.call(url)

      expect(result!.viewport).toEqual({ width: 1920, height: 1080 })
    })

    it('returns null for viewport with missing height', () => {
      const url = createUrl('/lovelace/0', { viewport: '800' })

      const result = parser.call(url)

      expect(result).toBeNull()
    })

    it('returns null for viewport with non-numeric values', () => {
      const url = createUrl('/lovelace/0', { viewport: 'widexhigh' })

      const result = parser.call(url)

      expect(result).toBeNull()
    })

    it('returns null for viewport with too many parts', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600x100' })

      const result = parser.call(url)

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Processing Parameters - Optional screenshot processing params
  // ==========================================================================

  describe('Processing Parameters', () => {
    it('includes pagePath from URL pathname', () => {
      const url = createUrl('/lovelace/dashboard', { viewport: '800x600' })

      const result = parser.call(url)

      expect(result!.pagePath).toBe('/lovelace/dashboard')
    })

    it('parses wait parameter as integer', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        wait: '1500',
      })

      const result = parser.call(url)

      expect(result!.extraWait).toBe(1500)
    })

    it('sets wait to undefined when invalid', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600', wait: 'abc' })

      const result = parser.call(url)

      expect(result!.extraWait).toBeUndefined()
    })

    it('parses zoom parameter as float', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600', zoom: '0.8' })

      const result = parser.call(url)

      expect(result!.zoom).toBe(0.8)
    })

    it('defaults zoom to 1 when invalid', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600', zoom: 'abc' })

      const result = parser.call(url)

      expect(result!.zoom).toBe(1)
    })

    it('defaults zoom to 1 when negative', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        zoom: '-0.5',
      })

      const result = parser.call(url)

      expect(result!.zoom).toBe(1)
    })

    it('parses format parameter', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        format: 'jpeg',
      })

      const result = parser.call(url)

      expect(result!.format).toBe('jpeg')
    })

    it('defaults format to png when invalid', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        format: 'invalid',
      })

      const result = parser.call(url)

      expect(result!.format).toBe('png')
    })

    it('parses rotate parameter when valid', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        rotate: '90',
      })

      const result = parser.call(url)

      expect(result!.rotate).toBe(90)
    })

    it('sets rotate to undefined when invalid', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        rotate: '45',
      })

      const result = parser.call(url)

      expect(result!.rotate).toBeUndefined()
    })

    it('parses invert flag when present', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        invert: true,
      })

      const result = parser.call(url)

      expect(result!.invert).toBe(true)
    })

    it('sets invert to false when absent', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600' })

      const result = parser.call(url)

      expect(result!.invert).toBe(false)
    })
  })

  // ==========================================================================
  // Crop Parameters - All four required for valid crop
  // ==========================================================================

  describe('Crop Parameters', () => {
    it('parses all crop parameters when valid', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        crop_x: '10',
        crop_y: '20',
        crop_width: '400',
        crop_height: '300',
      })

      const result = parser.call(url)

      expect(result!.crop).toEqual({
        x: 10,
        y: 20,
        width: 400,
        height: 300,
      })
    })

    it('sets crop to null when any parameter missing', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        crop_x: '10',
        crop_y: '20',
        crop_width: '400',
        // crop_height missing
      })

      const result = parser.call(url)

      expect(result!.crop).toBeNull()
    })

    it('sets crop to null when width is non-positive', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        crop_x: '10',
        crop_y: '20',
        crop_width: '0',
        crop_height: '300',
      })

      const result = parser.call(url)

      expect(result!.crop).toBeNull()
    })

    it('sets crop to null when height is non-positive', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        crop_x: '10',
        crop_y: '20',
        crop_width: '400',
        crop_height: '-100',
      })

      const result = parser.call(url)

      expect(result!.crop).toBeNull()
    })
  })

  // ==========================================================================
  // Home Assistant Parameters - lang, theme, dark mode
  // ==========================================================================

  describe('Home Assistant Parameters', () => {
    it('parses lang parameter', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600', lang: 'es' })

      const result = parser.call(url)

      expect(result!.lang).toBe('es')
    })

    it('sets lang to undefined when absent', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600' })

      const result = parser.call(url)

      expect(result!.lang).toBeUndefined()
    })

    it('parses theme parameter', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        theme: 'dark',
      })

      const result = parser.call(url)

      expect(result!.theme).toBe('dark')
    })

    it('parses dark mode flag when present', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600', dark: true })

      const result = parser.call(url)

      expect(result!.dark).toBe(true)
    })

    it('sets dark to false when absent', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600' })

      const result = parser.call(url)

      expect(result!.dark).toBe(false)
    })
  })

  // ==========================================================================
  // Preloading Parameter - next
  // ==========================================================================

  describe('Preloading Parameter', () => {
    it('parses next parameter for preloading', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600', next: '60' })

      const result = parser.call(url)

      expect(result!.next).toBe(60)
    })

    it('sets next to undefined when negative', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600', next: '-5' })

      const result = parser.call(url)

      expect(result!.next).toBeUndefined()
    })

    it('sets next to undefined when invalid', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600', next: 'abc' })

      const result = parser.call(url)

      expect(result!.next).toBeUndefined()
    })
  })

  // ==========================================================================
  // Dithering Parameters - Only parsed when dithering flag present
  // ==========================================================================

  describe('Dithering Parameters', () => {
    it('excludes dithering when flag absent', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600' })

      const result = parser.call(url)

      expect(result!.dithering).toBeUndefined()
    })

    it('includes dithering config when flag present', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
      })

      const result = parser.call(url)

      expect(result!.dithering).toBeDefined()
      expect(result!.dithering!.enabled).toBe(true)
    })

    it('uses defaults for dithering when only flag present', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
      })

      const result = parser.call(url)

      expect(result!.dithering).toMatchObject({
        enabled: true,
        method: 'floyd-steinberg',
        palette: 'gray-4',
        gammaCorrection: true,
        blackLevel: 0,
        whiteLevel: 100,
      })
    })

    it('parses dither method parameter', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        dither_method: 'ordered',
      })

      const result = parser.call(url)

      expect(result!.dithering!.method).toBe('ordered')
    })

    it('parses palette parameter', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        palette: 'gray-16',
      })

      const result = parser.call(url)

      expect(result!.dithering!.palette).toBe('gray-16')
    })

    it('defaults gammaCorrection to true', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
      })

      const result = parser.call(url)

      expect(result!.dithering!.gammaCorrection).toBe(true)
    })

    it('disables gammaCorrection when no_gamma flag present', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        no_gamma: true,
      })

      const result = parser.call(url)

      expect(result!.dithering!.gammaCorrection).toBe(false)
    })

    it('parses blackLevel within 0-100 range', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        black_level: '15',
      })

      const result = parser.call(url)

      expect(result!.dithering!.blackLevel).toBe(15)
    })

    it('clamps blackLevel to 0 when negative', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        black_level: '-10',
      })

      const result = parser.call(url)

      expect(result!.dithering!.blackLevel).toBe(0)
    })

    it('clamps blackLevel to 0 when above 100', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        black_level: '150',
      })

      const result = parser.call(url)

      expect(result!.dithering!.blackLevel).toBe(0)
    })

    it('parses whiteLevel within 0-100 range', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        white_level: '85',
      })

      const result = parser.call(url)

      expect(result!.dithering!.whiteLevel).toBe(85)
    })

    it('clamps whiteLevel to 100 when above 100', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        white_level: '150',
      })

      const result = parser.call(url)

      expect(result!.dithering!.whiteLevel).toBe(100)
    })

    it('defaults normalize to true when no_normalize is absent', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
      })

      const result = parser.call(url)

      expect(result!.dithering!.normalize).toBe(true)
    })

    it('parses no_normalize flag to disable normalization', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        no_normalize: true,
      })

      const result = parser.call(url)

      expect(result!.dithering!.normalize).toBe(false)
    })

    it('parses saturationBoost flag when present', () => {
      const url = createUrl('/lovelace/0', {
        viewport: '800x600',
        dithering: true,
        saturation_boost: true,
      })

      const result = parser.call(url)

      expect(result!.dithering!.saturationBoost).toBe(true)
    })
  })

  // ==========================================================================
  // Target URL Parameter - Generic mode (full URL override)
  // ==========================================================================

  describe('Target URL Parameter', () => {
    it('parses url parameter for generic mode', () => {
      const url = createUrl('/', {
        viewport: '800x600',
        url: 'https://grafana.local/dashboard',
      })

      const result = parser.call(url)

      expect(result!.targetUrl).toBe('https://grafana.local/dashboard')
    })

    it('sets targetUrl to undefined when absent', () => {
      const url = createUrl('/lovelace/0', { viewport: '800x600' })

      const result = parser.call(url)

      expect(result!.targetUrl).toBeUndefined()
    })

    it('includes pagePath alongside targetUrl', () => {
      const url = createUrl('/some-path', {
        viewport: '800x600',
        url: 'https://example.com',
      })

      const result = parser.call(url)

      expect(result!.pagePath).toBe('/some-path')
      expect(result!.targetUrl).toBe('https://example.com')
    })

    it('works with all other parameters', () => {
      const url = createUrl('/', {
        viewport: '800x600',
        url: 'https://status.github.com',
        dithering: true,
        format: 'jpeg',
        invert: true,
      })

      const result = parser.call(url)

      expect(result!.targetUrl).toBe('https://status.github.com')
      expect(result!.dithering!.enabled).toBe(true)
      expect(result!.format).toBe('jpeg')
      expect(result!.invert).toBe(true)
    })
  })

  // ==========================================================================
  // Complete Example - Full parameter set
  // ==========================================================================

  describe('Complete Example', () => {
    it('parses all parameters together', () => {
      const url = createUrl('/lovelace/dashboard', {
        viewport: '800x480',
        wait: '1000',
        zoom: '0.8',
        format: 'jpeg',
        rotate: '90',
        lang: 'es',
        theme: 'dark',
        dark: true,
        invert: true,
        crop_x: '10',
        crop_y: '10',
        crop_width: '780',
        crop_height: '460',
        next: '60',
        dithering: true,
        dither_method: 'ordered',
        palette: 'gray-16',
        black_level: '10',
        white_level: '90',
        normalize: true,
      })

      const result = parser.call(url)

      expect(result).toMatchObject({
        pagePath: '/lovelace/dashboard',
        viewport: { width: 800, height: 480 },
        extraWait: 1000,
        zoom: 0.8,
        format: 'jpeg',
        rotate: 90,
        lang: 'es',
        theme: 'dark',
        dark: true,
        invert: true,
        crop: { x: 10, y: 10, width: 780, height: 460 },
        next: 60,
        dithering: {
          enabled: true,
          method: 'ordered',
          palette: 'gray-16',
          gammaCorrection: true,
          blackLevel: 10,
          whiteLevel: 90,
          normalize: true,
          saturationBoost: false,
        },
      })
    })
  })
})
