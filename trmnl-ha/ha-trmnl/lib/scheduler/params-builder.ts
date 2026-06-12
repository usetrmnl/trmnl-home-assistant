/**
 * Screenshot Parameters Builder
 *
 * Converts schedule config to screenshot request params.
 * Stateless service with sensible defaults.
 *
 * @module lib/scheduler/params-builder
 */

import type {
  Schedule,
  ScreenshotParams,
  Viewport,
  ImageFormat,
} from '../../types/domain.js'
import { resolveScreenshotTarget } from '../../html/shared/screenshot-target.js'

/** Default screenshot parameters */
const DEFAULTS = {
  viewport: { width: 758, height: 1024 } as Viewport,
  extraWait: undefined as number | undefined,
  invert: false,
  zoom: 1,
  format: 'png' as ImageFormat,
  dark: false,
}

/**
 * Builds screenshot params from schedule config with sensible defaults.
 *
 * @param schedule - Schedule configuration
 * @returns Screenshot request params
 */
export function buildParams(schedule: Schedule): ScreenshotParams {
  const target = resolveScreenshotTarget(schedule)

  return {
    pagePath: target.path,
    targetUrl: target.fullUrl,
    format: schedule.format || DEFAULTS.format,
    viewport: schedule.viewport ?? DEFAULTS.viewport,
    crop: schedule.crop?.enabled ? schedule.crop : null,
    dithering: schedule.dithering?.enabled ? schedule.dithering : undefined,
    extraWait: schedule.wait ?? DEFAULTS.extraWait,
    zoom: schedule.zoom ?? DEFAULTS.zoom,
    invert: schedule.invert ?? DEFAULTS.invert,
    timestamp: schedule.timestamp ?? false,
    dark: schedule.dark ?? DEFAULTS.dark,
    rotate: schedule.rotate ?? undefined,
    lang: schedule.lang ?? undefined,
    theme: schedule.theme ?? undefined,
  }
}

/** Gets default values (useful for UI/docs) */
export function getDefaults(): typeof DEFAULTS {
  return { ...DEFAULTS }
}
