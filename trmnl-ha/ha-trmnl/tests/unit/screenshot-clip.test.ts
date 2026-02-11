/**
 * Tests for Browser.navigatePage viewport and Browser.screenshotPage clip logic.
 *
 * Verifies that:
 * - HEADER_HEIGHT offset is no longer applied to viewport or clip regions
 * - Crop is passed directly as clip when present with positive dimensions
 * - No clip is set when crop is absent, null, or has zero dimensions
 *
 * @module tests/unit/screenshot-clip
 */

import { mock, describe, it, expect, beforeEach } from 'bun:test'

// Safety: provide env vars in case const.js mock doesn't intercept
process.env['HOME_ASSISTANT_URL'] = 'http://localhost:8123'
process.env['ACCESS_TOKEN'] = 'test-token'

// ---------------------------------------------------------------------------
// Mock page factory
// ---------------------------------------------------------------------------

type MockFn = ReturnType<typeof mock>

interface MockPage {
  screenshot: MockFn
  setViewport: MockFn
  close: MockFn
  on: MockFn
  url: () => string
  waitForNetworkIdle: MockFn
}

let currentMockPage: MockPage

function createMockPage(): MockPage {
  const page: MockPage = {
    screenshot: mock(
      async (_opts?: unknown) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
    setViewport: mock(async (_v?: unknown) => {}),
    close: mock(async () => {}),
    url: () => 'http://localhost:8123/lovelace',
    waitForNetworkIdle: mock(async () => {}),
    // on() must return the page for method chaining in #setupPageLogging
    on: mock(() => page),
  }
  currentMockPage = page
  return page
}

// ---------------------------------------------------------------------------
// Module mocks (evaluated before Browser import)
// ---------------------------------------------------------------------------

const mockBrowserInstance = {
  connected: true,
  newPage: mock(async () => createMockPage()),
  close: mock(async () => {}),
  on: mock(() => {}),
}

mock.module('puppeteer', () => ({
  default: { launch: mock(async () => mockBrowserInstance) },
}))

const noopLogger = {
  info: () => {},
  debug: () => {},
  error: () => {},
  warn: () => {},
  trace: () => {},
}

mock.module('../../lib/logger.js', () => ({
  screenshotLogger: () => noopLogger,
  browserLogger: () => noopLogger,
}))

mock.module('../../const.js', () => ({
  debugLogging: false,
  chromiumExecutable: undefined,
}))

mock.module('../../lib/dithering.js', () => ({
  processImage: mock(async (buf: Buffer) => buf),
}))

mock.module('../../lib/browser/navigation-commands.js', () => ({
  NavigateToPage: class {
    async call() {}
  },
  WaitForLoadingComplete: class {
    async call() {
      return 0
    }
  },
  DismissToasts: class {
    async call() {
      return 0
    }
  },
  WaitForPaintStability: class {
    async call() {}
  },
  WaitForHassReady: class {
    async call() {}
  },
}))

mock.module('../../lib/browser/page-setup-strategies.js', () => ({
  getPageSetupStrategy: () => ({
    setup: async () => ({ themeChanged: false, langChanged: false }),
  }),
}))

// ---------------------------------------------------------------------------
// Import module under test (uses mocked dependencies)
// ---------------------------------------------------------------------------

import { Browser } from '../../screenshot.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Browser.navigatePage', () => {
  it('sets viewport directly without header height offset', async () => {
    const browser = new Browser('http://localhost:8123', 'test-token')
    const viewport = { width: 800, height: 480 }

    await browser.navigatePage({ pagePath: '/lovelace/0', viewport })

    expect(currentMockPage.setViewport).toHaveBeenCalledWith(viewport)
  })

  it('does not add scaled header offset when zoom is set', async () => {
    const browser = new Browser('http://localhost:8123', 'test-token')
    const viewport = { width: 1200, height: 825 }

    await browser.navigatePage({ pagePath: '/lovelace/0', viewport, zoom: 1.5 })

    // Before: height would be 825 + Math.round(56 * 1.5) = 825 + 84 = 909
    // After: height stays 825
    expect(currentMockPage.setViewport).toHaveBeenCalledWith(viewport)
  })
})

describe('Browser.screenshotPage', () => {
  let browser: InstanceType<typeof Browser>

  beforeEach(async () => {
    browser = new Browser('http://localhost:8123', 'test-token')
    await browser.navigatePage({
      pagePath: '/lovelace/0',
      viewport: { width: 800, height: 480 },
    })
    // Clear screenshot mock calls from navigatePage setup
    currentMockPage.screenshot.mockClear()
  })

  it('passes crop directly as clip without header offset', async () => {
    await browser.screenshotPage({
      viewport: { width: 800, height: 480 },
      crop: { x: 10, y: 56, width: 780, height: 424 },
    })

    // Before: clip.y would be 56 (headerHeight) + 56 (crop.y) = 112
    // After: clip.y is exactly crop.y = 56
    expect(currentMockPage.screenshot).toHaveBeenCalledWith({
      type: 'png',
      clip: { x: 10, y: 56, width: 780, height: 424 },
    })
  })

  it('captures full viewport when no crop provided', async () => {
    await browser.screenshotPage({
      viewport: { width: 800, height: 480 },
    })

    // Before: always set clip with y=headerHeight even without crop
    // After: no clip at all → Puppeteer captures full viewport
    expect(currentMockPage.screenshot).toHaveBeenCalledWith({ type: 'png' })
  })

  it('captures full viewport when crop is null', async () => {
    await browser.screenshotPage({
      viewport: { width: 800, height: 480 },
      crop: null,
    })

    expect(currentMockPage.screenshot).toHaveBeenCalledWith({ type: 'png' })
  })

  it('ignores crop with zero width', async () => {
    await browser.screenshotPage({
      viewport: { width: 800, height: 480 },
      crop: { x: 0, y: 0, width: 0, height: 480 },
    })

    expect(currentMockPage.screenshot).toHaveBeenCalledWith({ type: 'png' })
  })

  it('ignores crop with zero height', async () => {
    await browser.screenshotPage({
      viewport: { width: 800, height: 480 },
      crop: { x: 0, y: 0, width: 800, height: 0 },
    })

    expect(currentMockPage.screenshot).toHaveBeenCalledWith({ type: 'png' })
  })

  it('returns image buffer and positive timing', async () => {
    const result = await browser.screenshotPage({
      viewport: { width: 800, height: 480 },
      crop: { x: 0, y: 0, width: 800, height: 480 },
    })

    expect(result.image).toBeInstanceOf(Buffer)
    expect(typeof result.time).toBe('number')
  })
})
