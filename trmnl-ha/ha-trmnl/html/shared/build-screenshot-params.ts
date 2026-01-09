/**
 * Screenshot URL Parameters Builder
 *
 * Builds URLSearchParams from schedule configuration for screenshot requests.
 * Shared between preview-generator.ts and crop-modal.ts to ensure consistent
 * parameter handling across all screenshot flows.
 *
 * @module shared/build-screenshot-params
 */

import type { Schedule } from '../../types/domain.js'

/**
 * Builds URLSearchParams from schedule configuration.
 *
 * Handles all screenshot options including:
 * - Viewport, format, rotation, zoom, wait
 * - Crop region (optional, for preview only - crop-modal excludes this)
 * - Theme, dark mode, language (HA mode)
 * - Invert colors
 * - Full dithering configuration with levelsEnabled check
 *
 * @param schedule - Schedule configuration
 * @param options - Build options
 * @param options.includeCrop - Whether to include crop params (default: true)
 * @returns URLSearchParams for screenshot request
 */
export function buildScreenshotParams(
  schedule: Schedule,
  options: { includeCrop?: boolean } = {}
): URLSearchParams {
  const { includeCrop = true } = options
  const params = new URLSearchParams()

  // Viewport (required)
  params.append(
    'viewport',
    `${schedule.viewport.width}x${schedule.viewport.height}`
  )

  // Format
  if (schedule.format && schedule.format !== 'png') {
    params.append('format', schedule.format)
  }

  // Rotation
  if (schedule.rotate) {
    params.append('rotate', String(schedule.rotate))
  }

  // Zoom
  if (schedule.zoom && schedule.zoom !== 1) {
    params.append('zoom', String(schedule.zoom))
  }

  // Crop (optional - crop-modal fetches uncropped image)
  if (includeCrop && schedule.crop?.enabled) {
    params.append('crop_x', String(schedule.crop.x))
    params.append('crop_y', String(schedule.crop.y))
    params.append('crop_width', String(schedule.crop.width))
    params.append('crop_height', String(schedule.crop.height))
  }

  // Wait time
  if (schedule.wait) {
    params.append('wait', String(schedule.wait))
  }

  // Theme (HA mode only, but harmless if sent in generic mode)
  if (schedule.theme) {
    params.append('theme', schedule.theme)
  }

  // Dark mode
  if (schedule.dark) {
    params.append('dark', '')
  }

  // Language
  if (schedule.lang) {
    params.append('lang', schedule.lang)
  }

  // Invert colors
  if (schedule.invert) {
    params.append('invert', '')
  }

  // Dithering
  if (schedule.dithering?.enabled) {
    params.append('dithering', '')
    params.append(
      'dither_method',
      schedule.dithering.method || 'floyd-steinberg'
    )
    params.append('palette', schedule.dithering.palette || 'gray-4')

    // Gamma correction (default is enabled, so we send no_gamma when disabled)
    if (!schedule.dithering.gammaCorrection) {
      params.append('no_gamma', '')
    }

    // Levels - only send when enabled
    if (schedule.dithering.levelsEnabled) {
      params.append('levels_enabled', '')
      if (schedule.dithering.blackLevel > 0) {
        params.append('black_level', String(schedule.dithering.blackLevel))
      }
      if (schedule.dithering.whiteLevel < 100) {
        params.append('white_level', String(schedule.dithering.whiteLevel))
      }
    }

    // Normalize (default is enabled, so we send no_normalize when disabled)
    if (schedule.dithering.normalize === false) {
      params.append('no_normalize', '')
    }

    // Saturation boost
    if (schedule.dithering.saturationBoost) {
      params.append('saturation_boost', '')
    }

    // Compression level (only if not default 9)
    if (
      schedule.dithering.compressionLevel &&
      schedule.dithering.compressionLevel !== 9
    ) {
      params.append(
        'compression_level',
        String(schedule.dithering.compressionLevel)
      )
    }
  }

  return params
}
