import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { Browser } from '../../screenshot.js'
import { getImageInfo } from '../../lib/dithering.js'
import { buildParams } from '../../lib/scheduler/params-builder.js'
import { ScreenshotParamsParser } from '../../lib/screenshot-params-parser.js'
import { buildScreenshotParams } from '../../html/shared/build-screenshot-params.js'
import type { Schedule } from '../../types/domain.js'
import { createFakeBrowser } from '../helpers/browser-doubles.js'
import { buildSchedule } from '../helpers/schedule-fixtures.js'

const viewport = { width: 1448, height: 1072 }
const crop = { enabled: true, x: 0, y: 0, width: 724, height: 536 }

const builders = {
  scheduled: buildParams,
  preview: (schedule: Schedule) => {
    const params = buildScreenshotParams(schedule)
    const parsed = new ScreenshotParamsParser().call(
      new URL(`http://localhost/lovelace/0?${params}`),
    )!
    // Processing flags must never leak into the Home Assistant URL.
    expect(parsed.pagePath).toBe('/lovelace/0')
    return parsed
  },
}

for (const [path, build] of Object.entries(builders)) {
  describe(`Crop fit (${path}, real ImageMagick)`, () => {
    async function capture(overrides: Partial<Schedule> = {}) {
      const schedule = buildSchedule({ viewport, crop, crop_fit: true, ...overrides })
      const input = execFileSync('convert', [
        '-size', `${schedule.crop.width}x${schedule.crop.height}`, 'xc:black', 'png:-',
      ])
      const fake = createFakeBrowser(({ page }) => {
        page.screenshot = (async () => input) as unknown as typeof page.screenshot
      })
      // Only Puppeteer is replaced; screenshotPage and processImage are real.
      const browser = new Browser('http://ha.test', 'dummy', {
        launchBrowser: async () => fake.browser,
      })
      try {
        const { image } = await browser.screenshotPage(build(schedule))
        return { image, input }
      } finally {
        await browser.cleanup()
      }
    }

    it('enlarges a matching crop to the pre-rotation viewport', async () => {
      const { image } = await capture()
      expect(await getImageInfo(image)).toMatchObject({ width: 1448, height: 1072 })
    })

    it('fits before rotating 90 degrees', async () => {
      const { image } = await capture({ rotate: 90 })
      expect(await getImageInfo(image)).toMatchObject({ width: 1072, height: 1448 })
    })

    it('fits before the dithering rotation and format conversion', async () => {
      const { image } = await capture({
        rotate: 90,
        format: 'jpeg',
        dithering: {
          enabled: true, method: 'threshold', palette: 'bw',
          gammaCorrection: true, blackLevel: 0, whiteLevel: 100,
          normalize: false, saturationBoost: false,
        },
      })
      expect(await getImageInfo(image)).toEqual({ width: 1072, height: 1448, format: 'jpeg' })
    })

    it('uniformly scales a square and centers it on white padding', async () => {
      const { image } = await capture({ crop: { ...crop, width: 100, height: 100 } })
      expect(await getImageInfo(image)).toMatchObject({ width: 1448, height: 1072 })
      const pixels = execFileSync('convert', ['-', '-depth', '8', 'gray:-'], {
        input: image, maxBuffer: 2_000_000,
      })
      // A 1072px square with exactly 188px white padding on each side.
      for (const y of [0, 536, 1071]) {
        expect([...pixels.subarray(y * 1448, y * 1448 + 188)].every((p) => p === 255)).toBe(true)
        expect([...pixels.subarray(y * 1448 + 188, y * 1448 + 1260)].every((p) => p === 0)).toBe(true)
        expect([...pixels.subarray(y * 1448 + 1260, (y + 1) * 1448)].every((p) => p === 255)).toBe(true)
      }
    })

    it('pads the HA header preset with 28 white pixels above and below', async () => {
      const { image } = await capture({ crop: { ...crop, y: 56, width: 1448, height: 1016 } })
      expect(await getImageInfo(image)).toMatchObject({ width: 1448, height: 1072 })
      const pixels = execFileSync('convert', ['-', '-depth', '8', 'gray:-'], {
        input: image, maxBuffer: 2_000_000,
      })
      expect(pixels[27 * 1448 + 724]).toBe(255)
      expect(pixels[28 * 1448 + 724]).toBe(0)
      expect(pixels[1043 * 1448 + 724]).toBe(0)
      expect(pixels[1044 * 1448 + 724]).toBe(255)
    })

    it('preserves crop dimensions and bytes for old schedules without crop_fit', async () => {
      const { image, input } = await capture({ crop_fit: undefined })
      expect(await getImageInfo(image)).toMatchObject({ width: 724, height: 536 })
      expect(image.equals(input)).toBe(true)
    })

    it('leaves capture bytes unchanged when cropping is disabled', async () => {
      const { image, input } = await capture({ crop: { ...crop, enabled: false } })
      expect(image.equals(input)).toBe(true)
    })
  })
}

it('omits fitting from the uncropped crop-modal preview', () => {
  const params = buildScreenshotParams(
    buildSchedule({ viewport, crop, crop_fit: true }), { includeCrop: false },
  )
  expect(params.has('crop_fit')).toBe(false)
  expect(params.has('crop_width')).toBe(false)
})
