/**
 * Tests for the crop clamping math in CropModal.#updateCropFromTransform().
 *
 * The clamping logic ensures that:
 * - Position is clamped within viewport bounds (min 50px remaining)
 * - Dimensions shrink to fit when the overlay extends past viewport edges
 * - Minimum 50px dimensions are enforced
 *
 * This function is a direct replica of the math in crop-modal.ts,
 * extracted here for isolated unit testing without DOM dependencies.
 *
 * @see html/js/crop-modal.ts — #updateCropFromTransform
 * @module tests/unit/crop-clamping
 */

import { describe, it, expect } from 'bun:test'

/**
 * Clamp crop region to fit within viewport bounds.
 *
 * Position is clamped to [0, viewport - 50] so at least 50px
 * of overlay is always visible. Then dimensions are shrunk so
 * the overlay never extends past the viewport edge.
 */
function clampCropToViewport(
  raw: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
) {
  const x = Math.max(0, Math.min(viewport.width - 50, raw.x))
  const y = Math.max(0, Math.min(viewport.height - 50, raw.y))

  const width = Math.max(50, Math.min(viewport.width - x, raw.width))
  const height = Math.max(50, Math.min(viewport.height - y, raw.height))

  return { x, y, width, height }
}

describe('clampCropToViewport', () => {
  const viewport = { width: 800, height: 480 }

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('passes through values fully within bounds', () => {
    const result = clampCropToViewport(
      { x: 100, y: 50, width: 400, height: 300 },
      viewport,
    )
    expect(result).toEqual({ x: 100, y: 50, width: 400, height: 300 })
  })

  // -------------------------------------------------------------------------
  // Position clamping
  // -------------------------------------------------------------------------

  it('clamps negative x to 0', () => {
    const result = clampCropToViewport(
      { x: -10, y: 50, width: 400, height: 300 },
      viewport,
    )
    expect(result.x).toBe(0)
  })

  it('clamps negative y to 0', () => {
    const result = clampCropToViewport(
      { x: 100, y: -20, width: 400, height: 300 },
      viewport,
    )
    expect(result.y).toBe(0)
  })

  it('clamps x to viewport.width - 50', () => {
    const result = clampCropToViewport(
      { x: 900, y: 0, width: 400, height: 300 },
      viewport,
    )
    expect(result.x).toBe(750)
  })

  it('clamps y to viewport.height - 50', () => {
    const result = clampCropToViewport(
      { x: 0, y: 500, width: 400, height: 300 },
      viewport,
    )
    expect(result.y).toBe(430)
  })

  // -------------------------------------------------------------------------
  // Dimension shrinking (edge overflow)
  // -------------------------------------------------------------------------

  it('shrinks width when overlay extends past right edge', () => {
    // x=700, remaining space = 800-700 = 100, requested width = 400
    const result = clampCropToViewport(
      { x: 700, y: 0, width: 400, height: 300 },
      viewport,
    )
    expect(result).toEqual({ x: 700, y: 0, width: 100, height: 300 })
  })

  it('shrinks height when overlay extends past bottom edge', () => {
    // y=400, remaining space = 480-400 = 80, requested height = 300
    const result = clampCropToViewport(
      { x: 0, y: 400, width: 400, height: 300 },
      viewport,
    )
    expect(result).toEqual({ x: 0, y: 400, width: 400, height: 80 })
  })

  // -------------------------------------------------------------------------
  // Minimum dimension enforcement
  // -------------------------------------------------------------------------

  it('enforces minimum 50px width', () => {
    const result = clampCropToViewport(
      { x: 0, y: 0, width: 10, height: 300 },
      viewport,
    )
    expect(result.width).toBe(50)
  })

  it('enforces minimum 50px height', () => {
    const result = clampCropToViewport(
      { x: 0, y: 0, width: 400, height: 20 },
      viewport,
    )
    expect(result.height).toBe(50)
  })

  // -------------------------------------------------------------------------
  // Combined: drag full-size overlay to new position
  // -------------------------------------------------------------------------

  it('shrinks full-viewport overlay when dragged right', () => {
    // Full 800×480 overlay dragged to x=100 → width shrinks to 700
    const result = clampCropToViewport(
      { x: 100, y: 0, width: 800, height: 480 },
      viewport,
    )
    expect(result).toEqual({ x: 100, y: 0, width: 700, height: 480 })
  })

  it('shrinks full-viewport overlay when dragged down', () => {
    // Full 800×480 overlay dragged to y=80 → height shrinks to 400
    const result = clampCropToViewport(
      { x: 0, y: 80, width: 800, height: 480 },
      viewport,
    )
    expect(result).toEqual({ x: 0, y: 80, width: 800, height: 400 })
  })

  it('clamps to minimum 50×50 at maximum edge position', () => {
    // Position at max corner: x=750, y=430 → only 50px remaining each way
    const result = clampCropToViewport(
      { x: 750, y: 430, width: 800, height: 480 },
      viewport,
    )
    expect(result).toEqual({ x: 750, y: 430, width: 50, height: 50 })
  })

  // -------------------------------------------------------------------------
  // Different viewport sizes
  // -------------------------------------------------------------------------

  it('works with small viewports', () => {
    const small = { width: 100, height: 100 }
    const result = clampCropToViewport(
      { x: 60, y: 70, width: 200, height: 200 },
      small,
    )
    // x clamped to min(50, 60)=50, width = min(100-60, 200)=40 → enforced to 50? No:
    // x = max(0, min(100-50, 60)) = max(0, min(50, 60)) = 50
    // width = max(50, min(100-50, 200)) = max(50, min(50, 200)) = 50
    // y = max(0, min(100-50, 70)) = max(0, min(50, 70)) = 50
    // height = max(50, min(100-50, 200)) = max(50, min(50, 200)) = 50
    expect(result).toEqual({ x: 50, y: 50, width: 50, height: 50 })
  })
})
