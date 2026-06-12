/**
 * Unit tests for Screenshot Parameters Builder
 *
 * Tests Schedule → ScreenshotParams conversion with defaults.
 *
 * @module tests/unit/params-builder
 */

import { describe, it, expect } from 'bun:test'
import { buildParams, getDefaults } from '../../lib/scheduler/params-builder.js'
import type { Schedule } from '../../types/domain.js'

/** Creates minimal schedule for testing */
function createSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'test-id',
    name: 'Test Schedule',
    enabled: true,
    cron: '* * * * *',
    dashboard_path: '/lovelace/0',
    viewport: { width: 800, height: 480 },
    format: 'png',
    ...overrides,
  } as Schedule
}

describe('params-builder', () => {
  // ==========================================================================
  // buildParams() - Main conversion function
  // ==========================================================================

  describe('buildParams', () => {
    it('converts schedule to screenshot params', () => {
      const schedule = createSchedule()

      const params = buildParams(schedule)

      expect(params.pagePath).toBe('/lovelace/0')
      expect(params.viewport).toEqual({ width: 800, height: 480 })
      expect(params.format).toBe('png')
    })

    it('uses dashboard_path as pagePath', () => {
      const schedule = createSchedule({ dashboard_path: '/lovelace/dashboard' })

      const params = buildParams(schedule)

      expect(params.pagePath).toBe('/lovelace/dashboard')
    })

    it('defaults pagePath when dashboard_path empty', () => {
      const schedule = createSchedule({ dashboard_path: '' })

      const params = buildParams(schedule)

      expect(params.pagePath).toBe('/lovelace/0')
    })
  })

  // ==========================================================================
  // Viewport Handling
  // ==========================================================================

  describe('Viewport', () => {
    it('passes viewport object directly', () => {
      const schedule = createSchedule({
        viewport: { width: 1920, height: 1080 },
      })

      const params = buildParams(schedule)

      expect(params.viewport).toEqual({ width: 1920, height: 1080 })
    })

    it('uses default viewport when undefined', () => {
      const schedule = createSchedule({ viewport: undefined })

      const params = buildParams(schedule)

      expect(params.viewport).toEqual({ width: 758, height: 1024 })
    })
  })

  // ==========================================================================
  // Format Handling
  // ==========================================================================

  describe('Format', () => {
    it('uses png format', () => {
      const schedule = createSchedule({ format: 'png' })

      const params = buildParams(schedule)

      expect(params.format).toBe('png')
    })

    it('uses jpeg format', () => {
      const schedule = createSchedule({ format: 'jpeg' })

      const params = buildParams(schedule)

      expect(params.format).toBe('jpeg')
    })

    it('uses bmp format', () => {
      const schedule = createSchedule({ format: 'bmp' })

      const params = buildParams(schedule)

      expect(params.format).toBe('bmp')
    })

    it('defaults to png when undefined', () => {
      const schedule = createSchedule({ format: undefined })

      const params = buildParams(schedule)

      expect(params.format).toBe('png')
    })
  })

  // ==========================================================================
  // Crop Region
  // ==========================================================================

  describe('Crop', () => {
    it('includes crop when enabled', () => {
      const schedule = createSchedule({
        crop: { enabled: true, x: 10, y: 20, width: 400, height: 300 },
      })

      const params = buildParams(schedule)

      // NOTE: params.crop includes all fields from schedule.crop
      expect(params.crop).toMatchObject({
        x: 10,
        y: 20,
        width: 400,
        height: 300,
      })
    })

    it('returns null when crop disabled', () => {
      const schedule = createSchedule({
        crop: { enabled: false, x: 10, y: 20, width: 400, height: 300 },
      })

      const params = buildParams(schedule)

      expect(params.crop).toBeNull()
    })

    it('returns null when crop undefined', () => {
      const schedule = createSchedule({ crop: undefined })

      const params = buildParams(schedule)

      expect(params.crop).toBeNull()
    })
  })

  // ==========================================================================
  // Dithering Configuration
  // ==========================================================================

  describe('Dithering', () => {
    it('includes dithering when enabled', () => {
      const schedule = createSchedule({
        dithering: {
          enabled: true,
          method: 'floyd-steinberg',
          palette: 'gray-4',
          gammaCorrection: true,
          blackLevel: 0,
          whiteLevel: 100,
          normalize: false,
          saturationBoost: false,
        },
      })

      const params = buildParams(schedule)

      expect(params.dithering).toMatchObject({
        enabled: true,
        method: 'floyd-steinberg',
        palette: 'gray-4',
      })
    })

    it('returns undefined when dithering disabled', () => {
      const schedule = createSchedule({
        dithering: {
          enabled: false,
          method: 'floyd-steinberg',
          palette: 'gray-4',
          gammaCorrection: true,
          blackLevel: 0,
          whiteLevel: 100,
          normalize: false,
          saturationBoost: false,
        },
      })

      const params = buildParams(schedule)

      expect(params.dithering).toBeUndefined()
    })

    it('returns undefined when dithering undefined', () => {
      const schedule = createSchedule({ dithering: undefined })

      const params = buildParams(schedule)

      expect(params.dithering).toBeUndefined()
    })
  })

  // ==========================================================================
  // Optional Parameters
  // ==========================================================================

  describe('Optional Parameters', () => {
    it('includes extraWait from schedule.wait', () => {
      const schedule = createSchedule({ wait: 2000 })

      const params = buildParams(schedule)

      expect(params.extraWait).toBe(2000)
    })

    it('includes zoom', () => {
      const schedule = createSchedule({ zoom: 0.8 })

      const params = buildParams(schedule)

      expect(params.zoom).toBe(0.8)
    })

    it('defaults zoom to 1', () => {
      const schedule = createSchedule({ zoom: undefined })

      const params = buildParams(schedule)

      expect(params.zoom).toBe(1)
    })

    it('includes timestamp', () => {
      const schedule = createSchedule({ timestamp: true })

      const params = buildParams(schedule)

      expect(params.timestamp).toBe(true)
    })

    it('defaults timestamp to false', () => {
      const schedule = createSchedule({})

      const params = buildParams(schedule)

      expect(params.timestamp).toBe(false)
    })

    it('includes invert', () => {
      const schedule = createSchedule({ invert: true })

      const params = buildParams(schedule)

      expect(params.invert).toBe(true)
    })

    it('defaults invert to false', () => {
      const schedule = createSchedule({ invert: undefined })

      const params = buildParams(schedule)

      expect(params.invert).toBe(false)
    })

    it('includes dark mode', () => {
      const schedule = createSchedule({ dark: true })

      const params = buildParams(schedule)

      expect(params.dark).toBe(true)
    })

    it('defaults dark to false', () => {
      const schedule = createSchedule({ dark: undefined })

      const params = buildParams(schedule)

      expect(params.dark).toBe(false)
    })

    it('includes rotation', () => {
      const schedule = createSchedule({ rotate: 90 })

      const params = buildParams(schedule)

      expect(params.rotate).toBe(90)
    })

    it('includes language', () => {
      const schedule = createSchedule({ lang: 'es' })

      const params = buildParams(schedule)

      expect(params.lang).toBe('es')
    })

    it('includes theme', () => {
      const schedule = createSchedule({ theme: 'dark' })

      const params = buildParams(schedule)

      expect(params.theme).toBe('dark')
    })
  })

  // ==========================================================================
  // getDefaults() - Expose default values
  // ==========================================================================

  describe('getDefaults', () => {
    it('returns default configuration', () => {
      const defaults = getDefaults()

      expect(defaults).toMatchObject({
        viewport: { width: 758, height: 1024 },
        format: 'png',
        zoom: 1,
        invert: false,
        dark: false,
      })
    })

    it('returns copy of defaults (not reference)', () => {
      const defaults1 = getDefaults()
      const defaults2 = getDefaults()

      expect(defaults1).not.toBe(defaults2)
      expect(defaults1).toEqual(defaults2)
    })
  })
})
