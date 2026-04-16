/**
 * Unit tests for FloydSteinbergStrategy
 *
 * Pure unit tests — no ImageMagick required. The strategy only queues arguments
 * onto a gm State object via .out(), so a chainable spy captures exactly what
 * would be passed to ImageMagick at stream time.
 *
 * Regression coverage for issue #48: Floyd-Steinberg dithering was broken for
 * 1-bit / 2-color grayscale output because `-monochrome` and `-type Bilevel`
 * force a 50% threshold that discards the error diffusion matrix.
 *
 * @module tests/unit/floyd-steinberg-strategy
 */

import { execSync } from 'child_process'
import { describe, it, expect } from 'bun:test'
import gmLib from 'gm'
import type { State } from 'gm'
import { FloydSteinbergStrategy } from '../../lib/dithering/floyd-steinberg-strategy.js'
import { applyDithering } from '../../lib/dithering.js'

const gm = gmLib.subClass({ imageMagick: true })

// Chainable spy that records every .out(...) call. The strategy treats its
// input as an opaque chainable object, so this is sufficient to capture the
// full ImageMagick command sequence the strategy would emit.
function createStateSpy() {
  const calls: string[][] = []
  const spy: Pick<State, 'out'> = {
    out(...args: string[]) {
      calls.push(args)
      return spy as State
    },
  }
  return { spy: spy as State, calls }
}

describe('FloydSteinbergStrategy', () => {
  const strategy = new FloydSteinbergStrategy()

  describe('#call (grayscale mode, 2 colors)', () => {
    // NOTE: Regression for issue #48. Previously the strategy emitted
    // `-monochrome` (or `-type Bilevel`) after `-dither FloydSteinberg`, which
    // forces a hard 50% threshold and cancels the error diffusion. The fix
    // replaces that with `-colors 2`, which preserves the dither pattern.

    it('requests Floyd-Steinberg dithering', () => {
      const { spy, calls } = createStateSpy()

      strategy.call(spy, { mode: 'grayscale', colors: 2 })

      expect(calls).toContainEqual(['-dither', 'FloydSteinberg'])
    })

    it('reduces to 2 colors via -colors, not -monochrome', () => {
      const { spy, calls } = createStateSpy()

      strategy.call(spy, { mode: 'grayscale', colors: 2 })

      expect(calls).toContainEqual(['-colors', '2'])
    })

    it('does not emit -monochrome (regression guard for issue #48)', () => {
      const { spy, calls } = createStateSpy()

      strategy.call(spy, { mode: 'grayscale', colors: 2 })

      expect(calls.flat()).not.toContain('-monochrome')
    })

    it('does not emit -type Bilevel (regression guard for issue #48)', () => {
      const { spy, calls } = createStateSpy()

      strategy.call(spy, { mode: 'grayscale', colors: 2 })

      const flat = calls.flat()
      expect(flat).not.toContain('Bilevel')
      expect(flat).not.toContain('bilevel')
    })
  })

  describe('#call (grayscale mode, multi-level)', () => {
    it('reduces to the requested palette size via -colors', () => {
      const { spy, calls } = createStateSpy()

      strategy.call(spy, { mode: 'grayscale', colors: 4 })

      expect(calls).toContainEqual(['-dither', 'FloydSteinberg'])
      expect(calls).toContainEqual(['-colors', '4'])
    })

    it('supports 16-level grayscale', () => {
      const { spy, calls } = createStateSpy()

      strategy.call(spy, { mode: 'grayscale', colors: 16 })

      expect(calls).toContainEqual(['-colors', '16'])
    })
  })

  describe('#call (color mode)', () => {
    it('emits Floyd-Steinberg dither without forcing a palette size', () => {
      const { spy, calls } = createStateSpy()

      strategy.call(spy, { mode: 'color' })

      expect(calls).toContainEqual(['-dither', 'FloydSteinberg'])
      // Color mode relies on `-remap mpr:palette` applied upstream in
      // applyColorDithering(), so the strategy must not add its own -colors.
      expect(calls.flat()).not.toContain('-colors')
    })
  })

  describe('#call (unsupported input)', () => {
    it('returns the image unchanged when grayscale colors is missing', () => {
      const { spy, calls } = createStateSpy()

      const result = strategy.call(spy, { mode: 'grayscale' })

      expect(calls).toHaveLength(0)
      expect(result).toBe(spy)
    })
  })

  // ==========================================================================
  // Regression: issue #48 — Floyd-Steinberg broken for 1-bit / bw palette
  // ==========================================================================
  //
  // Before the fix, the strategy emitted `-monochrome` after `-dither
  // FloydSteinberg`, forcing a 50% threshold and discarding the error
  // diffusion. A solid mid-gray input therefore collapsed to a single solid
  // color. With the fix, error diffusion is preserved and the same input
  // produces a mix of black and white pixels.
  //
  // Assertions are observable at the ImageMagick level via `identify`, so
  // they run through the entire applyDithering pipeline — not just the
  // strategy class — and would catch any future regression introduced
  // elsewhere in the pipeline.

  describe('Floyd-Steinberg 1-bit regression (issue #48)', () => {
    async function uniformGrayImage(
      hex: string,
      size = 80
    ): Promise<Buffer> {
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        gm(size, size, hex).stream('png', (err, stdout) => {
          if (err) return reject(err)
          stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
          stdout.on('end', () => resolve(Buffer.concat(chunks)))
          stdout.on('error', reject)
        })
      })
    }

    function uniqueColorCount(buffer: Buffer): number {
      const raw = execSync('magick - -format "%k" info:', {
        input: buffer,
        encoding: 'utf-8',
        timeout: 5000,
      })
      return Number.parseInt(raw.trim(), 10)
    }

    // NOTE: Tests use gray values away from the 50% threshold point. At
    // exactly 50% gray, the buggy `-monochrome` path can still emit two
    // colors due to IM's rounding, producing a false negative. At 40% and
    // 60% the bug cleanly collapses the image to a single color, so the
    // uniqueColorCount check is a reliable regression signal.

    it('produces dither pattern on a 40% gray input (would collapse to black under bug)', async () => {
      const input = await uniformGrayImage('#666666')

      const dithered = await applyDithering(input, {
        method: 'floyd-steinberg',
        palette: 'bw',
        format: 'png',
        // Disable level/gamma/normalize so the only variable in play is the
        // dithering step — keeps the assertion tight against issue #48.
        gammaCorrection: false,
        normalize: false,
      })

      expect(uniqueColorCount(dithered)).toBeGreaterThanOrEqual(2)
    })

    it('produces dither pattern on a 60% gray input (would collapse to white under bug)', async () => {
      const input = await uniformGrayImage('#999999')

      const dithered = await applyDithering(input, {
        method: 'floyd-steinberg',
        palette: 'bw',
        format: 'png',
        gammaCorrection: false,
        normalize: false,
      })

      expect(uniqueColorCount(dithered)).toBeGreaterThanOrEqual(2)
    })
  })
})
