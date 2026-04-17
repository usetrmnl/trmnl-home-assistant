/**
 * Screenshot Target Resolution
 *
 * Single source of truth for determining screenshot URL based on schedule mode.
 * Centralizes ha_mode vs generic mode logic to avoid scattered conditionals.
 *
 * NOTE: This module is shared between backend (Bun) and frontend (browser).
 * - Backend imports via file path: '../html/shared/screenshot-target.js'
 * - Frontend imports via HTTP: '/shared/screenshot-target.js'
 *
 * @module shared/screenshot-target
 */

import type { Schedule } from '../../types/domain.js'

/**
 * Resolved screenshot target - the actual URL/path to capture
 */
export interface ScreenshotTarget {
  /** Path for the request (dashboard path for HA, '/' for generic) */
  path: string
  /** Query string to append to the HA navigation URL (e.g. "kiosk" for kiosk mode) */
  pageQuery?: string
  /** Full URL for generic mode (undefined for HA mode) */
  fullUrl?: string
  /** Whether using Home Assistant mode */
  isHAMode: boolean
}

/** Default dashboard path when none specified */
const DEFAULT_DASHBOARD_PATH = '/lovelace/0'

/**
 * Resolves the screenshot target from schedule configuration.
 *
 * HA Mode (ha_mode: true):
 *   - Uses dashboard_path as the path
 *   - No fullUrl (uses HA base URL)
 *
 * Generic Mode (ha_mode: false):
 *   - Uses '/' as path
 *   - Sets fullUrl to target_url
 *
 * @param schedule - Schedule configuration
 * @returns Resolved target with path and optional full URL
 */
export function resolveScreenshotTarget(schedule: Schedule): ScreenshotTarget {
  const isHAMode = schedule.ha_mode ?? true

  if (isHAMode) {
    const rawPath = schedule.dashboard_path || DEFAULT_DASHBOARD_PATH
    const qIdx = rawPath.indexOf('?')
    const path = qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath
    const pageQuery = qIdx >= 0 ? rawPath.slice(qIdx + 1) : undefined

    return {
      path,
      pageQuery: pageQuery || undefined,
      fullUrl: undefined,
      isHAMode: true,
    }
  }

  return {
    path: '/',
    fullUrl: schedule.target_url,
    isHAMode: false,
  }
}
