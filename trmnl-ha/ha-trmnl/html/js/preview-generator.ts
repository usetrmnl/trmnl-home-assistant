/**
 * Preview Generator Module
 *
 * Generates screenshot previews from schedule configurations.
 * Translates complex schedule settings into URL parameters for backend.
 *
 * Design Pattern:
 * Command Pattern - uses FetchPreview command for API communication.
 * Pure functions (#buildUrlParams) separate data transformation from side effects.
 * Loading State Machine - coordinates multiple DOM elements during async operations.
 *
 * @module html/js/preview-generator
 */

import { FetchPreview } from './api-client.js'
import { resolveScreenshotTarget } from '../shared/screenshot-target.js'
import { buildScreenshotParams } from '../shared/build-screenshot-params.js'
import type { Schedule } from '../../types/domain.js'

/**
 * Preview generator coordinating screenshot display and auto-refresh.
 */
export class PreviewGenerator {
  #fetchPreviewCmd: FetchPreview
  #autoRefresh: boolean = false
  #currentBlobUrl: string | null = null

  constructor() {
    this.#fetchPreviewCmd = new FetchPreview()
    this.#autoRefresh = localStorage.getItem('trmnlAutoRefresh') === 'true'
  }

  get autoRefresh(): boolean {
    return this.#autoRefresh
  }

  /**
   * Toggles auto-refresh and persists to localStorage.
   */
  toggleAutoRefresh(enabled: boolean): boolean {
    this.#autoRefresh = enabled
    localStorage.setItem('trmnlAutoRefresh', String(enabled))
    return enabled
  }


  /**
   * Coordinates loading state across DOM elements.
   */
  #updateLoadingState(loading: boolean): void {
    const placeholder = document.getElementById('previewPlaceholder')
    const loadingEl = document.getElementById('loadingIndicator')
    const image = document.getElementById('previewImage')
    const error = document.getElementById('errorMessage')
    const loadTime = document.getElementById('loadTime')
    const dimensions = document.getElementById('previewDimensions')
    const fileSize = document.getElementById('previewFileSize')
    const targetUrl = document.getElementById('previewTargetUrl')

    if (loading) {
      placeholder?.classList.add('hidden')
      image?.classList.add('hidden')
      dimensions?.classList.add('hidden')
      fileSize?.classList.add('hidden')
      targetUrl?.classList.add('hidden')
      error?.classList.add('hidden')
      loadingEl?.classList.remove('hidden')
      if (loadTime) loadTime.textContent = ''
    } else {
      loadingEl?.classList.add('hidden')
    }
  }

  /**
   * Displays error message to user.
   */
  #showError(message: string): void {
    const error = document.getElementById('errorMessage')
    const errorText = document.getElementById('errorText')
    const placeholder = document.getElementById('previewPlaceholder')

    if (errorText) errorText.textContent = message
    error?.classList.remove('hidden')
    placeholder?.classList.remove('hidden')
  }

  /**
   * Displays loaded image with metadata including file size and target URL.
   */
  #displayImage(
    imageUrl: string,
    loadTimeMs: number,
    sizeBytes: number,
    targetUrl: string
  ): void {
    const image = document.getElementById(
      'previewImage'
    ) as HTMLImageElement | null
    const loadTime = document.getElementById('loadTime')
    const dimensions = document.getElementById('previewDimensions')
    const fileSize = document.getElementById('previewFileSize')
    const urlDisplay = document.getElementById('previewTargetUrl')

    if (!image) return

    if (this.#currentBlobUrl) {
      URL.revokeObjectURL(this.#currentBlobUrl)
    }

    if (loadTime) {
      loadTime.textContent = `${Math.round(loadTimeMs)}ms`
    }

    // Display file size with warning if over 50KB
    if (fileSize) {
      const sizeKB = (sizeBytes / 1024).toFixed(1)
      const isOverLimit = sizeBytes > 50 * 1024
      fileSize.textContent = `${sizeKB} KB`
      fileSize.className = isOverLimit ? 'text-red-500 font-bold' : 'text-muted'
      fileSize.title = isOverLimit
        ? 'Warning: Image exceeds TRMNL 50KB limit'
        : 'File size'
      fileSize.classList.remove('hidden')
    }

    // Display target URL
    if (urlDisplay) {
      urlDisplay.textContent = targetUrl
      urlDisplay.title = targetUrl
      urlDisplay.classList.remove('hidden')
    }

    const img = new Image()
    img.onload = () => {
      if (dimensions) {
        dimensions.textContent = `${img.naturalWidth} x ${img.naturalHeight} pixels`
        dimensions.classList.remove('hidden')
      }
    }
    img.src = imageUrl

    image.src = imageUrl
    image.classList.remove('hidden')

    this.#currentBlobUrl = imageUrl
  }

  /**
   * Generates and displays preview image for schedule configuration.
   */
  async call(schedule: Schedule | null): Promise<void> {
    if (!schedule) {
      console.error('No schedule provided to preview generator')
      return
    }

    this.#updateLoadingState(true)

    const startTime = performance.now()

    try {
      const params = buildScreenshotParams(schedule)
      const target = resolveScreenshotTarget(schedule)

      // Add full URL param for generic mode
      if (target.fullUrl) {
        params.append('url', target.fullUrl)
      }

      // Forward page-specific query params (e.g. kiosk mode) to the screenshot handler
      if (target.pageQuery) {
        params.append('page_query', target.pageQuery)
      }

      // Build the display URL (what's actually being captured)
      // @ts-expect-error window.uiConfig is injected by server
      const uiConfig = window.uiConfig || { hassUrl: '' }
      const rawPath = schedule.dashboard_path || '/lovelace/0'
      const displayUrl = target.fullUrl || `${uiConfig.hassUrl}${rawPath}`

      const blob = await this.#fetchPreviewCmd.call(target.path, params)
      const imageUrl = URL.createObjectURL(blob)

      const endTime = performance.now()
      const loadTimeMs = endTime - startTime

      this.#displayImage(imageUrl, loadTimeMs, blob.size, displayUrl)
      this.#updateLoadingState(false)
    } catch (err) {
      console.error('Error loading preview:', err)
      this.#showError((err as Error).message)
      this.#updateLoadingState(false)
    }
  }
}
