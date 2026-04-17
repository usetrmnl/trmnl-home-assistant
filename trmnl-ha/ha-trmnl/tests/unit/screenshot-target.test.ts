/**
 * Tests for Screenshot Target Resolution
 */

import { describe, it, expect } from 'bun:test'
import { resolveScreenshotTarget } from '../../html/shared/screenshot-target.js'
import type { Schedule } from '../../types/domain.js'

// Minimal schedule fixture
const baseSchedule: Schedule = {
  id: 'test-1',
  name: 'Test',
  enabled: true,
  cron: '* * * * *',
  ha_mode: true,
  dashboard_path: '/lovelace/test',
  viewport: { width: 800, height: 480 },
  webhook_url: null,
  format: 'png',
  rotate: null,
  zoom: 1,
  wait: null,
  theme: null,
  lang: null,
  dark: false,
  invert: false,
  crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
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
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('resolveScreenshotTarget', () => {
  describe('HA Mode (ha_mode: true)', () => {
    it('uses dashboard_path as path', () => {
      const schedule = { ...baseSchedule, ha_mode: true, dashboard_path: '/lovelace/custom' }
      const target = resolveScreenshotTarget(schedule)

      expect(target.path).toBe('/lovelace/custom')
      expect(target.fullUrl).toBeUndefined()
      expect(target.isHAMode).toBe(true)
    })

    it('uses default path when dashboard_path is empty', () => {
      const schedule = { ...baseSchedule, ha_mode: true, dashboard_path: '' }
      const target = resolveScreenshotTarget(schedule)

      expect(target.path).toBe('/lovelace/0')
    })

    it('ignores target_url when in HA mode', () => {
      const schedule = {
        ...baseSchedule,
        ha_mode: true,
        dashboard_path: '/lovelace/home',
        target_url: 'https://example.com',
      }
      const target = resolveScreenshotTarget(schedule)

      expect(target.path).toBe('/lovelace/home')
      expect(target.fullUrl).toBeUndefined()
    })

    it('extracts query string from dashboard_path into pageQuery', () => {
      const schedule = { ...baseSchedule, ha_mode: true, dashboard_path: '/lovelace/0?kiosk' }
      const target = resolveScreenshotTarget(schedule)

      expect(target.path).toBe('/lovelace/0')
      expect(target.pageQuery).toBe('kiosk')
    })

    it('extracts multiple query params from dashboard_path', () => {
      const schedule = { ...baseSchedule, ha_mode: true, dashboard_path: '/lovelace/0?kiosk&sidebar=hidden' }
      const target = resolveScreenshotTarget(schedule)

      expect(target.path).toBe('/lovelace/0')
      expect(target.pageQuery).toBe('kiosk&sidebar=hidden')
    })

    it('sets pageQuery to undefined when no query string in dashboard_path', () => {
      const schedule = { ...baseSchedule, ha_mode: true, dashboard_path: '/lovelace/0' }
      const target = resolveScreenshotTarget(schedule)

      expect(target.path).toBe('/lovelace/0')
      expect(target.pageQuery).toBeUndefined()
    })
  })

  describe('Generic Mode (ha_mode: false)', () => {
    it('uses target_url as fullUrl', () => {
      const schedule = {
        ...baseSchedule,
        ha_mode: false,
        target_url: 'https://example.com/page',
      }
      const target = resolveScreenshotTarget(schedule)

      expect(target.path).toBe('/')
      expect(target.fullUrl).toBe('https://example.com/page')
      expect(target.isHAMode).toBe(false)
    })

    it('sets path to "/" for generic mode', () => {
      const schedule = {
        ...baseSchedule,
        ha_mode: false,
        dashboard_path: '/lovelace/ignored',
        target_url: 'https://google.com',
      }
      const target = resolveScreenshotTarget(schedule)

      expect(target.path).toBe('/')
    })
  })

  describe('Default behavior (ha_mode undefined)', () => {
    it('defaults to HA mode when ha_mode is undefined', () => {
      const schedule = { ...baseSchedule }
      // @ts-expect-error - testing undefined case
      delete schedule.ha_mode

      const target = resolveScreenshotTarget(schedule)

      expect(target.isHAMode).toBe(true)
      expect(target.path).toBe('/lovelace/test')
    })
  })
})
