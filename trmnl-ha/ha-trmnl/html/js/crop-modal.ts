/**
 * Crop Modal Module
 *
 * Interactive modal for visual crop/zoom region selection.
 * Integrates Interact.js for drag-and-resize functionality.
 *
 * Design Pattern:
 * Coordinate System Adapter Pattern - converts between three coordinate spaces:
 * 1. Viewport coordinates (actual screenshot pixels, e.g., 800×480)
 * 2. Display coordinates (scaled CSS pixels in modal, e.g., 400×240)
 * 3. Interact.js transform coordinates (cumulative deltas from drag/resize)
 *
 * NOTE: Requires Interact.js library loaded globally (via CDN or bundle).
 * NOTE: When modifying coordinate conversions, test with various display scales.
 *
 * @module html/js/crop-modal
 */

import { FetchPreview } from './api-client.js'
import { ConfirmModal } from './confirm-modal.js'
import { resolveScreenshotTarget } from '../shared/screenshot-target.js'
import { buildScreenshotParams } from '../shared/build-screenshot-params.js'
import type { Schedule, CropRegion } from '../../types/domain.js'

/** Interact.js event types */
interface InteractDragEvent {
  target: HTMLElement
  dx: number
  dy: number
}

interface InteractResizeEvent {
  target: HTMLElement
  rect: { width: number; height: number }
  deltaRect: { left: number; top: number }
}

interface InteractModifiers {
  aspectRatio(options: { ratio: number; equalDelta: boolean }): unknown
}

interface InteractInstance {
  draggable(options: { listeners: { move: (event: InteractDragEvent) => void } }): InteractInstance
  resizable(options: {
    edges: { left: boolean; right: boolean; bottom: boolean; top: boolean }
    modifiers: unknown[]
    listeners: { move: (event: InteractResizeEvent) => void }
  }): InteractInstance
  unset(): void
}

interface InteractStatic {
  (selector: string | HTMLElement): InteractInstance
  modifiers: InteractModifiers
}

// Extend HTMLElement to include Interact.js internal state
interface InteractableElement extends HTMLElement {
  __interact__?: unknown
}

// Global interact declaration
declare const interact: InteractStatic

/** Modal state structure */
interface ModalState {
  crop: { x: number; y: number; width: number; height: number }
  containerScale: number
}

/** Crop settings returned when applied */
interface CropSettings extends CropRegion {
  enabled: true
}

/** Callback type for crop apply */
type OnApplyCallback = (cropSettings: CropSettings) => void | Promise<void>

/**
 * Interactive crop modal with Interact.js integration.
 */
export class CropModal {
  #fetchPreviewCmd: FetchPreview
  #confirmModal: ConfirmModal

  #modalState: ModalState = {
    crop: { x: 0, y: 0, width: 800, height: 480 },
    containerScale: 1,
  }

  #onApply: OnApplyCallback | null = null

  constructor() {
    this.#fetchPreviewCmd = new FetchPreview()
    this.#confirmModal = new ConfirmModal()
  }

  /**
   * Opens interactive crop modal for schedule.
   */
  async open(schedule: Schedule | null, onApply: OnApplyCallback): Promise<void> {
    if (!schedule) {
      await this.#confirmModal.alert({
        title: 'No Schedule Selected',
        message: 'Please select a schedule first.',
        type: 'warning',
      })
      return
    }

    this.#onApply = onApply

    this.#modalState.crop = schedule.crop?.enabled
      ? { ...schedule.crop }
      : {
          x: 0,
          y: 0,
          width: schedule.viewport.width,
          height: schedule.viewport.height,
        }

    this.#showModal(true)

    try {
      // Use shared param builder (exclude crop - we show uncropped for selection)
      const params = buildScreenshotParams(schedule, { includeCrop: false })
      const target = resolveScreenshotTarget(schedule)

      // Add full URL param for generic mode
      if (target.fullUrl) {
        params.append('url', target.fullUrl)
      }

      const blob = await this.#fetchPreviewCmd.call(target.path, params)
      const imageUrl = URL.createObjectURL(blob)

      await this.#loadImage(imageUrl, schedule)
    } catch (err) {
      console.error('Error loading screenshot:', err)
      await this.#confirmModal.alert({
        title: 'Error Loading Screenshot',
        message: `Failed to load screenshot: ${(err as Error).message}`,
        type: 'error',
      })
      this.close()
    }
  }

  /**
   * Closes crop modal and cleans up resources.
   */
  close(): void {
    const modal = document.getElementById('cropModal')
    modal?.classList.add('hidden')

    const img = document.getElementById('modalPreviewImage') as HTMLImageElement | null
    if (img?.src) {
      URL.revokeObjectURL(img.src)
      img.src = ''
    }
  }

  /**
   * Resets crop to full viewport (no cropping).
   */
  reset(schedule: Schedule | null): void {
    if (!schedule) return

    const overlay = document.getElementById('cropOverlay')

    this.#modalState.crop = {
      x: 0,
      y: 0,
      width: schedule.viewport.width,
      height: schedule.viewport.height,
    }

    if (overlay) {
      overlay.removeAttribute('data-x')
      overlay.removeAttribute('data-y')
      overlay.style.transform = 'translate(0px, 0px)'
    }

    this.#updateCropOverlay(schedule)
  }

  /**
   * Applies current crop settings via callback.
   * NOTE: Must await #onApply so the save + form update completes
   * before close(). Otherwise the modal closing can trigger a form
   * re-render that overwrites the crop values.
   */
  async apply(): Promise<void> {
    if (!this.#onApply) return

    const cropSettings: CropSettings = {
      enabled: true,
      x: Math.round(this.#modalState.crop.x),
      y: Math.round(this.#modalState.crop.y),
      width: Math.round(this.#modalState.crop.width),
      height: Math.round(this.#modalState.crop.height),
    }

    await this.#onApply(cropSettings)
    this.close()
  }

  #showModal(loading = false): void {
    const modal = document.getElementById('cropModal')
    const loadingEl = document.getElementById('modalLoading')
    const img = document.getElementById('modalPreviewImage')
    const overlay = document.getElementById('cropOverlay')

    modal?.classList.remove('hidden')

    if (loading) {
      loadingEl?.classList.remove('hidden')
      img?.classList.add('hidden')
      overlay?.classList.add('hidden')
    }
  }

  async #loadImage(imageUrl: string, schedule: Schedule): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = document.getElementById('modalPreviewImage') as HTMLImageElement | null
      const loadingEl = document.getElementById('modalLoading')

      if (!img) {
        reject(new Error('Image element not found'))
        return
      }

      img.onload = () => {
        loadingEl?.classList.add('hidden')
        img.classList.remove('hidden')

        const container = document.getElementById('modalPreviewContainer')
        if (container) {
          container.style.position = 'relative'
          container.style.display = 'block'
        }

        this.#updateCropOverlay(schedule)
        document.getElementById('cropOverlay')?.classList.remove('hidden')
        this.#initInteract(schedule)

        resolve()
      }

      img.onerror = () => {
        reject(new Error('Failed to load image'))
      }

      img.src = imageUrl
    })
  }

  #updateCropOverlay(schedule: Schedule): void {
    if (!schedule) return

    const overlay = document.getElementById('cropOverlay')
    const img = document.getElementById('modalPreviewImage') as HTMLImageElement | null
    if (!overlay || !img) return

    const actualWidth = schedule.viewport.width
    const displayedWidth = img.clientWidth

    this.#modalState.containerScale = displayedWidth / actualWidth

    const imgRect = img.getBoundingClientRect()
    const containerRect = document.getElementById('modalPreviewContainer')?.getBoundingClientRect()
    if (!containerRect) return

    const imgOffsetX = imgRect.left - containerRect.left
    const imgOffsetY = imgRect.top - containerRect.top

    const displayX = imgOffsetX + this.#modalState.crop.x * this.#modalState.containerScale
    const displayY = imgOffsetY + this.#modalState.crop.y * this.#modalState.containerScale
    const displayWidth = this.#modalState.crop.width * this.#modalState.containerScale
    const displayHeight = this.#modalState.crop.height * this.#modalState.containerScale

    if (!overlay.hasAttribute('data-x')) {
      overlay.style.left = `${displayX}px`
      overlay.style.top = `${displayY}px`
      overlay.style.width = `${displayWidth}px`
      overlay.style.height = `${displayHeight}px`
      overlay.style.transform = 'translate(0px, 0px)'
      overlay.setAttribute('data-x', '0')
      overlay.setAttribute('data-y', '0')
    }

    this.#updateDimensionsDisplay()
  }

  #updateDimensionsDisplay(): void {
    const dims = document.getElementById('cropDimensions')
    if (!dims) return

    dims.textContent = `${Math.round(this.#modalState.crop.width)} × ${Math.round(
      this.#modalState.crop.height
    )} px (offset: ${Math.round(this.#modalState.crop.x)}, ${Math.round(this.#modalState.crop.y)})`
  }

  #updateCropFromTransform(schedule: Schedule): void {
    if (!schedule) return

    const overlay = document.getElementById('cropOverlay')
    const img = document.getElementById('modalPreviewImage')
    if (!overlay || !img) return

    const overlayRect = overlay.getBoundingClientRect()
    const imgRect = img.getBoundingClientRect()

    const rawX = (overlayRect.left - imgRect.left) / this.#modalState.containerScale
    const rawY = (overlayRect.top - imgRect.top) / this.#modalState.containerScale
    const rawWidth = overlayRect.width / this.#modalState.containerScale
    const rawHeight = overlayRect.height / this.#modalState.containerScale

    // Clamp position within viewport bounds
    const x = Math.max(0, Math.min(schedule.viewport.width - 50, rawX))
    const y = Math.max(0, Math.min(schedule.viewport.height - 50, rawY))

    // Shrink dimensions to fit within viewport when dragged near edges
    // This allows dragging a full-size overlay to reposition and crop
    const width = Math.max(50, Math.min(schedule.viewport.width - x, rawWidth))
    const height = Math.max(50, Math.min(schedule.viewport.height - y, rawHeight))

    this.#modalState.crop = { x, y, width, height }

    this.#updateDimensionsDisplay()
  }

  #initInteract(schedule: Schedule): void {
    const overlay = document.getElementById('cropOverlay') as InteractableElement | null
    const img = document.getElementById('modalPreviewImage')
    if (!overlay || !img || !schedule) return

    if (overlay.__interact__) {
      interact(overlay).unset()
    }

    overlay.setAttribute('data-x', '0')
    overlay.setAttribute('data-y', '0')

    const aspectRatio = schedule.viewport.width / schedule.viewport.height

    interact('#cropOverlay')
      .draggable({
        listeners: {
          move: (event: InteractDragEvent) => {
            const target = event.target

            const x = (parseFloat(target.getAttribute('data-x') || '0') || 0) + event.dx
            const y = (parseFloat(target.getAttribute('data-y') || '0') || 0) + event.dy

            target.style.transform = `translate(${x}px, ${y}px)`
            target.setAttribute('data-x', String(x))
            target.setAttribute('data-y', String(y))

            this.#updateCropFromTransform(schedule)
          },
        },
      })
      .resizable({
        edges: { left: true, right: true, bottom: true, top: true },
        modifiers: [
          interact.modifiers.aspectRatio({
            ratio: aspectRatio,
            equalDelta: false,
          }),
        ],
        listeners: {
          move: (event: InteractResizeEvent) => {
            const target = event.target
            let x = parseFloat(target.getAttribute('data-x') || '0') || 0
            let y = parseFloat(target.getAttribute('data-y') || '0') || 0

            x += event.deltaRect.left
            y += event.deltaRect.top

            target.style.width = `${event.rect.width}px`
            target.style.height = `${event.rect.height}px`

            target.style.transform = `translate(${x}px, ${y}px)`
            target.setAttribute('data-x', String(x))
            target.setAttribute('data-y', String(y))

            this.#updateCropFromTransform(schedule)
          },
        },
      })
  }
}
