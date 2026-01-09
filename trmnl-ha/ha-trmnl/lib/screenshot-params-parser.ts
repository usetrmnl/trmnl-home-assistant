/**
 * Screenshot Parameters Parser Module
 *
 * Converts URL query parameters into structured screenshot request parameters.
 *
 * @module lib/screenshot-params-parser
 */

import { VALID_FORMATS, VALID_ROTATIONS } from '../const.js'
import type {
  Viewport,
  CropRegion,
  ImageFormat,
  RotationAngle,
  DitheringConfig,
  DitheringMethod,
  Palette,
  BitDepth,
  CompressionLevel,
} from '../types/domain.js'

/** Parsed screenshot parameters */
export interface ParsedScreenshotParams {
  pagePath: string
  /** Full target URL (if provided, overrides pagePath + base URL resolution) */
  targetUrl?: string
  viewport: Viewport
  extraWait?: number
  zoom: number
  crop: CropRegion | null
  invert: boolean
  format: ImageFormat
  rotate?: RotationAngle
  lang?: string
  theme?: string
  dark: boolean
  next?: number
  dithering?: DitheringConfig
}

/**
 * Parses and validates URL query parameters into screenshot request parameters.
 */
export class ScreenshotParamsParser {
  /**
   * Parses URL into structured screenshot parameters.
   *
   * @param requestUrl - Parsed URL object with searchParams
   * @returns Screenshot parameters or null if invalid
   */
  call(requestUrl: URL): ParsedScreenshotParams | null {
    const viewport = this.#parseViewport(requestUrl)
    if (!viewport) return null

    // Full URL param for generic (non-HA) screenshots
    const targetUrl = requestUrl.searchParams.get('url') || undefined

    return {
      pagePath: requestUrl.pathname,
      targetUrl,
      viewport,
      ...this.#parseProcessing(requestUrl),
      ...this.#parseDithering(requestUrl),
    }
  }

  /**
   * Parses viewport dimensions from "viewport=WIDTHxHEIGHT" parameter.
   */
  #parseViewport(url: URL): Viewport | null {
    const viewportParams = (url.searchParams.get('viewport') || '')
      .split('x')
      .map((n) => parseInt(n))

    if (
      viewportParams.length !== 2 ||
      !viewportParams.every((x) => !isNaN(x))
    ) {
      return null
    }

    return {
      width: viewportParams[0]!,
      height: viewportParams[1]!,
    }
  }

  /**
   * Parses image processing and Home Assistant configuration parameters.
   */
  #parseProcessing(
    url: URL
  ): Omit<ParsedScreenshotParams, 'pagePath' | 'viewport' | 'dithering'> {
    // Wait time
    let extraWait: number | undefined = parseInt(
      url.searchParams.get('wait') || ''
    )
    if (isNaN(extraWait)) extraWait = undefined

    // Zoom
    let zoom = parseFloat(url.searchParams.get('zoom') || '')
    if (isNaN(zoom) || zoom <= 0) zoom = 1

    // Crop parameters
    let crop: CropRegion | null = null
    const cropX = parseInt(url.searchParams.get('crop_x') || '')
    const cropY = parseInt(url.searchParams.get('crop_y') || '')
    const cropWidth = parseInt(url.searchParams.get('crop_width') || '')
    const cropHeight = parseInt(url.searchParams.get('crop_height') || '')

    if (
      !isNaN(cropX) &&
      !isNaN(cropY) &&
      !isNaN(cropWidth) &&
      !isNaN(cropHeight) &&
      cropWidth > 0 &&
      cropHeight > 0
    ) {
      crop = { x: cropX, y: cropY, width: cropWidth, height: cropHeight }
    }

    // Invert
    const invert = url.searchParams.has('invert')

    // Format
    let format = (url.searchParams.get('format') || 'png') as ImageFormat
    if (!VALID_FORMATS.includes(format)) format = 'png'

    // Rotation
    let rotate: RotationAngle | undefined = parseInt(
      url.searchParams.get('rotate') || ''
    ) as RotationAngle
    if (isNaN(rotate) || !VALID_ROTATIONS.includes(rotate)) rotate = undefined

    // Language, theme, dark mode
    const lang = url.searchParams.get('lang') || undefined
    const theme = url.searchParams.get('theme') || undefined
    const dark = url.searchParams.has('dark')

    // Next parameter for preloading
    let next: number | undefined = parseInt(url.searchParams.get('next') || '')
    if (isNaN(next) || next < 0) next = undefined

    return {
      extraWait,
      zoom,
      crop,
      invert,
      format,
      rotate,
      lang,
      theme,
      dark,
      next,
    }
  }

  /**
   * Parses dithering parameters when dithering is enabled.
   */
  #parseDithering(url: URL): { dithering?: DitheringConfig } {
    const ditheringEnabled = url.searchParams.has('dithering')

    if (!ditheringEnabled) {
      return { dithering: undefined }
    }

    const method = (url.searchParams.get('dither_method') ||
      'floyd-steinberg') as DitheringMethod
    const palette = (url.searchParams.get('palette') || 'gray-4') as Palette

    const gammaCorrection = !url.searchParams.has('no_gamma')

    const levelsEnabled = url.searchParams.has('levels_enabled')

    let blackLevel = parseInt(url.searchParams.get('black_level') || '')
    if (isNaN(blackLevel) || blackLevel < 0 || blackLevel > 100) blackLevel = 0

    let whiteLevel = parseInt(url.searchParams.get('white_level') || '')
    if (isNaN(whiteLevel) || whiteLevel < 0 || whiteLevel > 100)
      whiteLevel = 100

    const normalize = !url.searchParams.has('no_normalize')
    const saturationBoost = url.searchParams.has('saturation_boost')

    let bitDepth: BitDepth | undefined
    const bitDepthParam = parseInt(url.searchParams.get('bit_depth') || '')
    if ([1, 2, 4, 8].includes(bitDepthParam)) {
      bitDepth = bitDepthParam as BitDepth
    }

    let compressionLevel: CompressionLevel | undefined
    const compressionParam = parseInt(
      url.searchParams.get('compression_level') || ''
    )
    if (compressionParam >= 1 && compressionParam <= 9) {
      compressionLevel = compressionParam as CompressionLevel
    }

    return {
      dithering: {
        enabled: true,
        method,
        palette,
        gammaCorrection,
        levelsEnabled,
        blackLevel,
        whiteLevel,
        normalize,
        saturationBoost,
        bitDepth,
        compressionLevel,
      },
    }
  }
}
