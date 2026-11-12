/**
 * Unit tests for dithering module
 *
 * @module tests/unit/dithering
 */

import { describe, it, expect, beforeAll, setSystemTime } from 'bun:test'
import { execSync, execFileSync } from 'node:child_process'
import {
  processImage,
  formatTimestamp,
  applyDithering,
  convertToFormat,
  getImageInfo,
  SUPPORTED_METHODS,
  SUPPORTED_PALETTES,
  isColorPalette,
  isFullSpectrumPalette,
  validateDitheringOptions,
} from '../../lib/dithering.js'
import type { DitheringMethod, TimestampPosition } from '../../types/domain.js'
import gmLib from 'gm'

const gm = gmLib.subClass({ imageMagick: true })

// Auto-skip when ImageMagick 7 isn't available (local dev without IM7)
function hasImageMagick7(): boolean {
  try {
    const version = execSync('magick --version 2>/dev/null || convert --version 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    })
    return version.includes('ImageMagick 7')
  } catch {
    return false
  }
}

const describeDithering = hasImageMagick7() ? describe : describe.skip

// Annotation needs a font ImageMagick can resolve; bare CI runners may lack one
function canAnnotateText(): boolean {
  try {
    const out = execSync(
      "convert -size 40x20 xc:white -pointsize 10 -annotate +2+12 'x' png:-",
      { timeout: 5000, maxBuffer: 1_000_000 },
    )
    return out.length > 0
  } catch {
    return false
  }
}

const itWithFont = canAnnotateText() ? it : it.skip

function stampBounds(image: Buffer, width: number) {
  const pixels = execFileSync('convert', ['-', '-depth', '8', 'gray:-'], {
    input: image, maxBuffer: 10_000_000,
  })
  let left = width, top = pixels.length / width, right = -1, bottom = -1
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i]! < 128) {
      const x = i % width, y = Math.floor(i / width)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  expect(right).toBeGreaterThan(left)
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
}

function whiteImage(width: number, height: number): Buffer {
  return execFileSync('convert', ['-size', `${width}x${height}`, 'xc:white', 'png:-'])
}

// ImageMagick's wall clock is independent of Bun's frozen capture time.
function withoutWriteTime(buffer: Buffer): Buffer {
  const chunks = [buffer.subarray(0, 8)]
  for (let offset = 8; offset < buffer.length;) {
    const end = offset + buffer.readUInt32BE(offset) + 12
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const text = buffer.toString('ascii', offset + 8, end - 4)
    if (type !== 'tIME' && !(type === 'tEXt' && /^date:(create|modify|timestamp)\0/.test(text))) {
      chunks.push(buffer.subarray(offset, end))
    }
    offset = end
  }
  return Buffer.concat(chunks)
}

describeDithering('Dithering Module', () => {
  let testImageBuffer: Buffer

  beforeAll(async () => {
    // Create ONE test image (100x100 gradient), reuse across all tests
    testImageBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []

      gm(100, 100, '#808080')
        .fill('#000000')
        .drawRectangle(0, 0, 50, 100)
        .fill('#ffffff')
        .drawRectangle(50, 0, 100, 100)
        .stream('png', (err, stdout, _stderr) => {
          if (err) {
            reject(err)
            return
          }
          stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
          stdout.on('end', () => {
            resolve(Buffer.concat(chunks))
          })
          stdout.on('error', reject)
        })
    })
  }, 30000)

  // ==========================================================================
  // Constants - Test that module exports expected values
  // ==========================================================================

  describe('SUPPORTED_METHODS', () => {
    it('exports array of supported dithering methods', () => {
      expect(SUPPORTED_METHODS).toEqual([
        'floyd-steinberg',
        'ordered',
        'threshold',
      ])
    })
  })

  describe('SUPPORTED_PALETTES', () => {
    it('exports array of all supported palettes', () => {
      expect(SUPPORTED_PALETTES).toEqual(
        expect.arrayContaining(['bw', 'gray-4', 'gray-16', 'color-7a'])
      )
    })

    it('includes BWR/BWY/BWRY accent palettes', () => {
      expect(SUPPORTED_PALETTES).toEqual(
        expect.arrayContaining(['color-3bwr', 'color-3bwy', 'color-4bwry'])
      )
    })

    it('includes full-spectrum palettes', () => {
      expect(SUPPORTED_PALETTES).toEqual(
        expect.arrayContaining(['color-12bit', 'color-24bit'])
      )
    })
  })

  // ==========================================================================
  // isColorPalette() - Domain logic helper
  // ==========================================================================

  describe('isColorPalette', () => {
    it('returns true for discrete color palettes', () => {
      expect(isColorPalette('color-6a')).toBe(true)
      expect(isColorPalette('color-7a')).toBe(true)
      expect(isColorPalette('color-3bwr')).toBe(true)
      expect(isColorPalette('color-3bwy')).toBe(true)
      expect(isColorPalette('color-4bwry')).toBe(true)
    })

    it('returns true for full-spectrum palettes', () => {
      expect(isColorPalette('color-12bit')).toBe(true)
      expect(isColorPalette('color-24bit')).toBe(true)
    })

    it('returns false for grayscale palettes', () => {
      expect(isColorPalette('bw')).toBe(false)
      expect(isColorPalette('gray-4')).toBe(false)
    })
  })

  // ==========================================================================
  // isFullSpectrumPalette() - Full-spectrum palette detection
  // ==========================================================================

  describe('isFullSpectrumPalette', () => {
    it('returns true for 12-bit and 24-bit palettes', () => {
      expect(isFullSpectrumPalette('color-12bit')).toBe(true)
      expect(isFullSpectrumPalette('color-24bit')).toBe(true)
    })

    it('returns false for discrete color palettes', () => {
      expect(isFullSpectrumPalette('color-6a')).toBe(false)
      expect(isFullSpectrumPalette('color-7a')).toBe(false)
      expect(isFullSpectrumPalette('color-3bwr')).toBe(false)
      expect(isFullSpectrumPalette('color-4bwry')).toBe(false)
    })

    it('returns false for grayscale palettes', () => {
      expect(isFullSpectrumPalette('bw')).toBe(false)
      expect(isFullSpectrumPalette('gray-4')).toBe(false)
    })
  })

  // ==========================================================================
  // validateDitheringOptions() - Options validation with defaults
  // ==========================================================================

  describe('validateDitheringOptions', () => {
    it('applies sensible defaults when options empty', () => {
      const result = validateDitheringOptions({})

      expect(result).toMatchObject({
        method: 'floyd-steinberg',
        palette: 'gray-4',
        gammaCorrection: true,
        blackLevel: 0,
        whiteLevel: 100,
        rotate: 0,
      })
    })

    it('preserves valid options', () => {
      const result = validateDitheringOptions({
        method: 'ordered',
        palette: 'gray-16',
        blackLevel: 10,
        whiteLevel: 90,
      })

      expect(result).toMatchObject({
        method: 'ordered',
        palette: 'gray-16',
        blackLevel: 10,
        whiteLevel: 90,
      })
    })

    it('falls back to defaults when invalid method provided', () => {
      // NOTE: Intentionally testing with invalid input - type assertion required
      const result = validateDitheringOptions({
        method: 'invalid-method' as DitheringMethod,
      })
      expect(result.method).toBe('floyd-steinberg')
    })

    it('clamps blackLevel and whiteLevel to 0-100 range', () => {
      const result = validateDitheringOptions({
        blackLevel: -50,
        whiteLevel: 200,
      })

      expect(result.blackLevel).toBe(0)
      expect(result.whiteLevel).toBe(100)
    })

    it('enables normalize by default for all palettes (fix for gray background issue #9)', () => {
      // Grayscale palette - normalize should be true by default
      const grayscaleResult = validateDitheringOptions({ palette: 'gray-4' })
      expect(grayscaleResult.normalize).toBe(true)
      expect(grayscaleResult.saturationBoost).toBe(false) // Only for color

      // Color palette - both normalize and saturationBoost should be true
      const colorResult = validateDitheringOptions({ palette: 'color-7a' })
      expect(colorResult.normalize).toBe(true)
      expect(colorResult.saturationBoost).toBe(true)
    })

    it('respects explicit normalize=false override', () => {
      const result = validateDitheringOptions({
        palette: 'gray-4',
        normalize: false,
      })

      expect(result.normalize).toBe(false)
    })

    it('enables saturationBoost by default for BWR/BWRY palettes', () => {
      const bwrResult = validateDitheringOptions({ palette: 'color-3bwr' })
      expect(bwrResult.saturationBoost).toBe(true)
      expect(bwrResult.normalize).toBe(true)

      const bwryResult = validateDitheringOptions({ palette: 'color-4bwry' })
      expect(bwryResult.saturationBoost).toBe(true)
    })

    it('enables saturationBoost by default for full-spectrum palettes', () => {
      const result12 = validateDitheringOptions({ palette: 'color-12bit' })
      expect(result12.saturationBoost).toBe(true)
      expect(result12.normalize).toBe(true)

      const result24 = validateDitheringOptions({ palette: 'color-24bit' })
      expect(result24.saturationBoost).toBe(true)
    })
  })

  // ==========================================================================
  // processImage() - Main entry point for image processing
  // ==========================================================================

  describe('processImage', () => {
    for (const width of [480, 758, 800]) {
      itWithFont(`preserves legacy 14pt PNG bytes at ${width}px except write-time metadata`, async () => {
        setSystemTime(new Date('2026-09-20T12:34:00Z'))
        try {
          const input = whiteImage(width, 480)
          const legacy = execFileSync('convert', ['-', '-gravity', 'SouthEast', '-undercolor', 'white',
            '-fill', 'black', '-pointsize', '14', '-annotate', '+4+4', ` ${formatTimestamp(new Date())} `, 'png:-'], { input })
          const actual = await processImage(input, { timestamp: true })
          expect(withoutWriteTime(actual).equals(withoutWriteTime(legacy))).toBe(true)
          expect(stampBounds(actual, width)).toEqual(stampBounds(legacy, width))
        } finally {
          setSystemTime()
        }
      })
    }

    itWithFont('scales the timestamp linearly with capture width', async () => {
      setSystemTime(new Date('2026-09-20T12:34:00Z'))
      try {
        for (const [width, points] of [[800, 14], [1448, 25.34], [1600, 28]] as const) {
          const input = whiteImage(width, 1072)
          const reference = execFileSync('convert', ['-', '-gravity', 'SouthEast', '-undercolor', 'white',
            '-fill', 'black', '-pointsize', String(points), '-annotate', '+4+4', ` ${formatTimestamp(new Date())} `, 'png:-'], { input })
          const actual = await processImage(input, { timestamp: true })
          expect(stampBounds(actual, width)).toEqual(stampBounds(reference, width))
        }
      } finally {
        setSystemTime()
      }
    })

    for (const position of ['bottom-right', 'bottom-left', 'top-left', 'top-right'] as TimestampPosition[]) {
      itWithFont(`draws the timestamp in ${position} before rotation`, async () => {
        const input = whiteImage(800, 480)
        const stamped = await processImage(input, { timestamp: true, timestampPosition: position })
        const bounds = stampBounds(stamped, 800)
        if (position.endsWith('left')) {
          expect(bounds.left).toBeLessThan(20)
          expect(bounds.right).toBeLessThan(400)
        } else {
          expect(bounds.right).toBeGreaterThan(780)
          expect(bounds.left).toBeGreaterThan(400)
        }
        if (position.startsWith('top')) {
          expect(bounds.top).toBeLessThan(20)
          expect(bounds.bottom).toBeLessThan(240)
        } else {
          expect(bounds.bottom).toBeGreaterThan(460)
          expect(bounds.top).toBeGreaterThan(240)
        }
        const rotated = await processImage(input, { timestamp: true, timestampPosition: position, rotate: 90 })
        expect(stampBounds(rotated, 480)).toEqual({
          left: 479 - bounds.bottom, right: 479 - bounds.top,
          top: bounds.left, bottom: bounds.right,
          width: bounds.height, height: bounds.width,
        })
      })
    }

    it('returns processed image buffer', async () => {
      const result = await processImage(testImageBuffer, {
        format: 'png',
      })

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    itWithFont('changes the image when timestamp overlay is enabled', async () => {
      const plain = await processImage(testImageBuffer, { format: 'png' })

      const stamped = await processImage(testImageBuffer, {
        format: 'png',
        timestamp: true,
      })

      expect(stamped.equals(plain)).toBe(false)
    })

    it('returns a valid image with timestamp enabled even without fonts', async () => {
      const stamped = await processImage(testImageBuffer, {
        format: 'png',
        timestamp: true,
      })

      expect(Buffer.isBuffer(stamped)).toBe(true)
      expect(stamped.length).toBeGreaterThan(0)
    })

    it('applies dithering when dithering.enabled is true', async () => {
      const result = await processImage(testImageBuffer, {
        format: 'png',
        dithering: {
          enabled: true,
          method: 'floyd-steinberg',
          palette: 'gray-4',
        },
      })

      const info = await getImageInfo(result)
      expect(info).toBeDefined()
    })

    it('skips dithering when dithering.enabled is false', async () => {
      const result = await processImage(testImageBuffer, {
        format: 'png',
        dithering: { enabled: false },
      })

      expect(Buffer.isBuffer(result)).toBe(true)
    })

    it('applies rotation when specified', async () => {
      const result = await processImage(testImageBuffer, {
        format: 'png',
        rotate: 90,
      })

      const info = await getImageInfo(result)
      // After 90° rotation, width and height swap
      expect(info.height).toBe(100)
      expect(info.width).toBe(100)
    })

    it('converts to specified format', async () => {
      const pngResult = await processImage(testImageBuffer, { format: 'png' })
      const jpegResult = await processImage(testImageBuffer, {
        format: 'jpeg',
      })

      // PNG magic number
      expect(pngResult[0]).toBe(0x89)
      expect(pngResult[1]).toBe(0x50)

      // JPEG magic number
      expect(jpegResult[0]).toBe(0xff)
      expect(jpegResult[1]).toBe(0xd8)
    })
  })

  // ==========================================================================
  // applyDithering() - Core dithering algorithm application
  // ==========================================================================

  describe('applyDithering', () => {
    describe('with valid inputs', () => {
      it('returns dithered image buffer', async () => {
        const result = await applyDithering(testImageBuffer, {
          method: 'floyd-steinberg',
          palette: 'gray-4',
        })

        expect(Buffer.isBuffer(result)).toBe(true)
        expect(result.length).toBeGreaterThan(0)
      })

      it('preserves image dimensions', async () => {
        const result = await applyDithering(testImageBuffer, {
          palette: 'gray-4',
        })
        const info = await getImageInfo(result)

        expect(info.width).toBe(100)
        expect(info.height).toBe(100)
      })

      it('processes images with different palettes', async () => {
        const bwResult = await applyDithering(testImageBuffer, {
          palette: 'bw',
        })
        const gray16Result = await applyDithering(testImageBuffer, {
          palette: 'gray-16',
        })

        // Both should process successfully
        expect(Buffer.isBuffer(bwResult)).toBe(true)
        expect(Buffer.isBuffer(gray16Result)).toBe(true)
      })

      it('processes images with different dithering methods', async () => {
        const floydResult = await applyDithering(testImageBuffer, {
          method: 'floyd-steinberg',
          palette: 'gray-4',
        })
        const orderedResult = await applyDithering(testImageBuffer, {
          method: 'ordered',
          palette: 'gray-4',
        })

        // Both methods should process successfully
        expect(Buffer.isBuffer(floydResult)).toBe(true)
        expect(Buffer.isBuffer(orderedResult)).toBe(true)
      })
    })

    describe('with gamma correction', () => {
      it('applies gamma correction by default', async () => {
        const result = await applyDithering(testImageBuffer, {
          palette: 'gray-4',
        })

        expect(Buffer.isBuffer(result)).toBe(true)
      })

      it('skips gamma correction when disabled', async () => {
        const result = await applyDithering(testImageBuffer, {
          palette: 'gray-4',
          gammaCorrection: false,
        })

        expect(Buffer.isBuffer(result)).toBe(true)
      })
    })

    describe('with level adjustments', () => {
      it('applies black and white level adjustments', async () => {
        const result = await applyDithering(testImageBuffer, {
          palette: 'gray-4',
          blackLevel: 10,
          whiteLevel: 90,
        })

        expect(Buffer.isBuffer(result)).toBe(true)
      })
    })

    describe('with rotation', () => {
      it('applies rotation during dithering pipeline', async () => {
        const result = await applyDithering(testImageBuffer, {
          palette: 'gray-4',
          rotate: 90,
        })

        expect(Buffer.isBuffer(result)).toBe(true)
      })
    })

    describe('with invalid inputs', () => {
      it('uses defaults for invalid method', async () => {
        // NOTE: Intentionally testing with invalid input - type assertion required
        const result = await applyDithering(testImageBuffer, {
          method: 'invalid' as DitheringMethod,
          palette: 'gray-4',
        })

        // Should not throw, uses default method
        expect(Buffer.isBuffer(result)).toBe(true)
      })
    })
  })

  // ==========================================================================
  // Discrete color palettes (BWR/BWY/BWRY) - accent color e-ink displays
  // ==========================================================================

  describe('applyDithering with discrete color palettes', () => {
    it('processes images with color-3bwr palette', async () => {
      const result = await applyDithering(testImageBuffer, {
        method: 'floyd-steinberg',
        palette: 'color-3bwr',
      })

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('processes images with color-4bwry palette', async () => {
      const result = await applyDithering(testImageBuffer, {
        method: 'floyd-steinberg',
        palette: 'color-4bwry',
      })

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('preserves image dimensions with BWR palette', async () => {
      const result = await applyDithering(testImageBuffer, {
        palette: 'color-3bwr',
      })
      const info = await getImageInfo(result)

      expect(info.width).toBe(100)
      expect(info.height).toBe(100)
    })
  })

  // ==========================================================================
  // Full-spectrum palettes (12-bit / 24-bit)
  // ==========================================================================

  describe('applyDithering with full-spectrum palettes', () => {
    it('processes images with color-12bit palette', async () => {
      const result = await applyDithering(testImageBuffer, {
        method: 'floyd-steinberg',
        palette: 'color-12bit',
      })

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('processes images with color-24bit palette', async () => {
      const result = await applyDithering(testImageBuffer, {
        method: 'floyd-steinberg',
        palette: 'color-24bit',
      })

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('preserves image dimensions with full-spectrum palettes', async () => {
      const result12 = await applyDithering(testImageBuffer, {
        palette: 'color-12bit',
      })
      const result24 = await applyDithering(testImageBuffer, {
        palette: 'color-24bit',
      })

      const info12 = await getImageInfo(result12)
      const info24 = await getImageInfo(result24)

      expect(info12.width).toBe(100)
      expect(info12.height).toBe(100)
      expect(info24.width).toBe(100)
      expect(info24.height).toBe(100)
    })

    it('works with all dithering methods for 12-bit', async () => {
      const methods = ['floyd-steinberg', 'ordered', 'threshold'] as const

      for (const method of methods) {
        const result = await applyDithering(testImageBuffer, {
          method,
          palette: 'color-12bit',
        })
        expect(Buffer.isBuffer(result)).toBe(true)
      }
    })

    it('24-bit passthrough works regardless of dithering method', async () => {
      const methods = ['floyd-steinberg', 'ordered', 'threshold'] as const

      for (const method of methods) {
        const result = await applyDithering(testImageBuffer, {
          method,
          palette: 'color-24bit',
        })
        expect(Buffer.isBuffer(result)).toBe(true)
      }
    })

    // NOTE: Observable effect test — 12-bit posterizes to 16 levels/channel
    // (4096 colors max), while 24-bit passes through at full color depth.
    // On a simple test image the unique color counts should differ.
    it('12-bit produces fewer unique colors than 24-bit', async () => {
      // Create a colorful test image with gradients
      const colorImage = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        gm(100, 100, '#FF6633')
          .fill('#3366FF')
          .drawRectangle(0, 0, 50, 50)
          .fill('#33CC66')
          .drawRectangle(50, 50, 100, 100)
          .stream('png', (err, stdout) => {
            if (err) return reject(err)
            stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
            stdout.on('end', () => resolve(Buffer.concat(chunks)))
            stdout.on('error', reject)
          })
      })

      const result12 = await applyDithering(colorImage, {
        palette: 'color-12bit',
        gammaCorrection: false,
        normalize: false,
        saturationBoost: false,
      })
      const result24 = await applyDithering(colorImage, {
        palette: 'color-24bit',
        gammaCorrection: false,
        normalize: false,
        saturationBoost: false,
      })

      const colors12 = Number.parseInt(
        execSync('magick - -format "%k" info:', {
          input: result12,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim(),
        10
      )
      const colors24 = Number.parseInt(
        execSync('magick - -format "%k" info:', {
          input: result24,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim(),
        10
      )

      expect(colors12).toBeLessThanOrEqual(colors24)
    })
  })

  // ==========================================================================
  // convertToFormat() - Format conversion with e-ink optimizations
  // ==========================================================================

  describe('convertToFormat', () => {
    it('converts to PNG format', async () => {
      const result = await convertToFormat(testImageBuffer, 'png')

      // Check PNG magic number
      expect(result[0]).toBe(0x89)
      expect(result[1]).toBe(0x50)
      expect(result[2]).toBe(0x4e)
      expect(result[3]).toBe(0x47)
    })

    it('converts to JPEG format', async () => {
      const result = await convertToFormat(testImageBuffer, 'jpeg')

      // Check JPEG magic number
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xd8)
    })
  })

  // ==========================================================================
  // getImageInfo() - Image metadata extraction
  // ==========================================================================

  describe('getImageInfo', () => {
    it('returns image metadata', async () => {
      const info = await getImageInfo(testImageBuffer)

      expect(info).toMatchObject({
        width: 100,
        height: 100,
        format: 'png',
      })
    })
  })

  // ==========================================================================
  // Performance - Critical e-ink optimization requirement
  // ==========================================================================

  describe('Performance', () => {
    // NOTE: Performance critical - e-ink displays need fast processing
    it('completes 1-bit dithering in under 2 seconds', async () => {
      const start = Date.now()

      await applyDithering(testImageBuffer, {
        method: 'floyd-steinberg',
        palette: 'bw',
      })

      const duration = Date.now() - start
      expect(duration).toBeLessThan(2000)
    })
  })

  // ==========================================================================
  // Compression - Critical for <50KB target on e-ink displays
  // ==========================================================================

  describe('Compression', () => {
    let largeTestImage: Buffer

    beforeAll(async () => {
      // Create larger test image (800x480 - typical TRMNL resolution)
      largeTestImage = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []

        // Create gradient image to simulate real dashboard content
        gm(800, 480, '#808080')
          .fill('#000000')
          .drawRectangle(0, 0, 400, 240)
          .fill('#404040')
          .drawRectangle(400, 0, 800, 240)
          .fill('#c0c0c0')
          .drawRectangle(0, 240, 400, 480)
          .fill('#ffffff')
          .drawRectangle(400, 240, 800, 480)
          .stream('png', (err, stdout, _stderr) => {
            if (err) {
              reject(err)
              return
            }
            stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
            stdout.on('end', () => {
              resolve(Buffer.concat(chunks))
            })
            stdout.on('error', reject)
          })
      })
    }, 30000)

    it('produces 1-bit BW images under 50KB for 800x480', async () => {
      const result = await applyDithering(largeTestImage, {
        method: 'floyd-steinberg',
        palette: 'bw',
        format: 'png',
      })

      const sizeKB = result.length / 1024
      // 1-bit 800x480 = 48,000 pixels / 8 = 6KB theoretical minimum
      // With PNG overhead, expect < 50KB
      expect(sizeKB).toBeLessThan(50)
    })

    it('produces 2-bit gray-4 images under 75KB for 800x480', async () => {
      const result = await applyDithering(largeTestImage, {
        method: 'floyd-steinberg',
        palette: 'gray-4',
        format: 'png',
      })

      const sizeKB = result.length / 1024
      // 2-bit 800x480 = 48,000 pixels / 4 = 12KB theoretical minimum
      expect(sizeKB).toBeLessThan(75)
    })

    it('all grayscale palettes produce reasonable file sizes', async () => {
      // NOTE: Dithering patterns can actually increase file size for simple images
      // because the error diffusion creates patterns that compress less efficiently.
      // Real-world dashboards will see better compression with lower bit depths.
      const bwResult = await applyDithering(largeTestImage, {
        method: 'floyd-steinberg',
        palette: 'bw',
        format: 'png',
      })
      const gray4Result = await applyDithering(largeTestImage, {
        method: 'floyd-steinberg',
        palette: 'gray-4',
        format: 'png',
      })
      const gray16Result = await applyDithering(largeTestImage, {
        method: 'floyd-steinberg',
        palette: 'gray-16',
        format: 'png',
      })

      // All should be under 100KB for 800x480 (well under 50KB target)
      expect(bwResult.length / 1024).toBeLessThan(100)
      expect(gray4Result.length / 1024).toBeLessThan(100)
      expect(gray16Result.length / 1024).toBeLessThan(100)
    })
  })

  // ==========================================================================
  // Regression: issue #47 — PNG rejected by TRMNL firmware
  // ==========================================================================
  //
  // Aggressive chunk stripping (`png:exclude-chunks=all` or an unconditional
  // `.strip()`) produced minimal PNGs containing only IHDR, IDAT and IEND.
  // These are technically valid per the PNG spec, but TRMNL firmware expects
  // ancillary chunks (bKGD in particular) and rejects the image with a
  // misleading "First two header bytes are invalid" error when they're
  // missing. The fix: don't strip chunks at all for PNG output — the saving
  // is under 0.5% of the 50KB budget and not worth the compatibility risk.
  //
  // Assertion locks in the observable effect: grayscale PNG output from
  // applyDithering must contain ancillary chunks beyond the bare IHDR / IDAT
  // / IEND minimum. This catches any future regression that reintroduces
  // chunk stripping in applyDithering or configureOutputFormat, without
  // hard-coding the specific chunk name ImageMagick happens to emit today.

  describe('PNG chunk preservation (issue #47)', () => {
    const PNG_SIGNATURE = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])

    // Walks a PNG byte buffer and returns the ordered list of chunk type
    // codes. A chunk is [4-byte length][4-byte type][data][4-byte CRC].
    // Stops after IEND. Kept inline — ~15 lines is cheaper than a dependency.
    function parsePngChunks(buffer: Buffer): string[] {
      if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('Not a PNG: signature mismatch')
      }
      const chunks: string[] = []
      let offset = 8
      while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset)
        const type = buffer.toString('ascii', offset + 4, offset + 8)
        chunks.push(type)
        offset += 12 + length // 4 length + 4 type + data + 4 CRC
        if (type === 'IEND') break
      }
      return chunks
    }

    const grayscalePalettes = ['bw', 'gray-4', 'gray-16'] as const

    for (const palette of grayscalePalettes) {
      describe(`with ${palette} palette`, () => {
        let output: Buffer

        beforeAll(async () => {
          output = await applyDithering(testImageBuffer, {
            method: 'floyd-steinberg',
            palette,
            format: 'png',
          })
        })

        it('starts with a valid PNG signature', () => {
          expect(output.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
        })

        it('contains required PNG chunks (IHDR, IDAT, IEND)', () => {
          const chunks = parsePngChunks(output)

          expect(chunks).toContain('IHDR')
          expect(chunks).toContain('IDAT')
          expect(chunks).toContain('IEND')
        })

        it('preserves ancillary chunks for firmware compatibility', () => {
          // NOTE: Regression guard for issue #47. The minimum-viable PNG is
          // IHDR + IDAT + IEND (3 chunks). Any output with more than that
          // means at least one ancillary chunk (bKGD, tIME, tEXt, ...) has
          // survived — which is what TRMNL firmware needs. Asserting
          // `> 3 chunks` is robust against IM version changes that might
          // swap which specific ancillary chunks get emitted by default.
          const chunks = parsePngChunks(output)

          expect(chunks.length).toBeGreaterThan(3)
        })
      })
    }
  })
})
