/**
 * Tests for Browser class — viewport, clip, lifecycle, and busy-guard logic.
 *
 * Verifies that:
 * - HEADER_HEIGHT offset is no longer applied to viewport or clip regions
 * - Crop is passed directly as clip when present with positive dimensions
 * - No clip is set when crop is absent, null, or has zero dimensions
 * - Lifecycle methods (busy, isConnected, cleanup) behave correctly
 * - Busy guard prevents concurrent operations
 * - Generic mode (targetUrl) skips HA-specific page setup
 *
 * NOTE: Only mocks leaf dependencies (puppeteer, const, logger, dithering).
 * Real navigation-commands and page-setup-strategies are used with a
 * comprehensive mock page, avoiding global mock leaks into other test files.
 *
 * @module tests/unit/screenshot-clip
 */

import { mock, describe, it, expect, beforeEach, afterAll } from 'bun:test'

// Safety: provide env vars in case const.js mock doesn't intercept
process.env['HOME_ASSISTANT_URL'] = 'http://localhost:8123'
process.env['ACCESS_TOKEN'] = 'test-token'

// ---------------------------------------------------------------------------
// Mock page factory — comprehensive mock that works with real commands
// ---------------------------------------------------------------------------

type MockFn = ReturnType<typeof mock>

interface MockPage {
  screenshot: MockFn
  setViewport: MockFn
  close: MockFn
  on: MockFn
  url: () => string
  waitForNetworkIdle: MockFn
  // Methods required by real NavigateToPage
  evaluateOnNewDocument: MockFn
  goto: MockFn
  removeScriptToEvaluateOnNewDocument: MockFn
  // Methods required by real wait commands and page setup strategies
  evaluate: MockFn
  waitForFunction: MockFn
}

let currentMockPage: MockPage

function createMockPage(): MockPage {
  const page: MockPage = {
    screenshot: mock(
      async (_opts?: unknown) =>
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
    setViewport: mock(async (_v?: unknown) => {}),
    close: mock(async () => {}),
    url: () => 'http://localhost:8123/lovelace',
    waitForNetworkIdle: mock(async () => {}),
    // on() must return the page for method chaining in #setupPageLogging
    on: mock(() => page),
    // NavigateToPage: inject auth → navigate → cleanup
    evaluateOnNewDocument: mock(async () => ({ identifier: 'mock-id' })),
    goto: mock(async () => ({ ok: () => true, status: () => 200 })),
    removeScriptToEvaluateOnNewDocument: mock(async () => {}),
    // Wait commands + page setup strategies
    evaluate: mock(async () => 0),
    waitForFunction: mock(async () => {}),
  }
  currentMockPage = page
  return page
}

// ---------------------------------------------------------------------------
// Module mocks — only leaf dependencies, NOT shared modules
//
// NOTE: mock.module() is global in Bun. Mocking navigation-commands or
// page-setup-strategies here would poison tests in those files' own test
// suites. Instead we mock only leaf deps and let the real commands run
// against the comprehensive mock page above.
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
  navigationLogger: () => noopLogger,
}))

mock.module('../../const.js', () => ({
  debugLogging: false,
  chromiumExecutable: undefined,
  // Required by real NavigateToPage (imported via navigation-commands.ts)
  isAddOn: false,
  DEFAULT_WAIT_TIME: 500,
  COLD_START_EXTRA_WAIT: 0,
}))

mock.module('../../lib/dithering.js', () => ({
  processImage: mock(async (buf: Buffer) => buf),
}))

// ---------------------------------------------------------------------------
// Import module under test (uses mocked leaf deps + real commands)
// ---------------------------------------------------------------------------

import { Browser } from '../../screenshot.js'

// Clean up global mocks so other test files get real modules
afterAll(() => {
  mock.restore()
})

// ---------------------------------------------------------------------------
// Shared defaults
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:8123'
const TOKEN = 'test-token'
const DEFAULT_VIEWPORT = { width: 800, height: 480 }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Browser', () => {
  // -------------------------------------------------------------------------
  // Lifecycle: #busy
  // -------------------------------------------------------------------------

  describe('#busy', () => {
    it('is false before any operation', () => {
      const browser = new Browser(BASE_URL, TOKEN)

      expect(browser.busy).toBe(false)
    })

    it('is false after navigation completes', async () => {
      const browser = new Browser(BASE_URL, TOKEN)
      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })

      expect(browser.busy).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Lifecycle: #isConnected
  // -------------------------------------------------------------------------

  describe('#isConnected', () => {
    it('returns false before browser is launched', () => {
      const browser = new Browser(BASE_URL, TOKEN)

      expect(browser.isConnected()).toBe(false)
    })

    it('returns true after navigation launches browser', async () => {
      const browser = new Browser(BASE_URL, TOKEN)
      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })

      expect(browser.isConnected()).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Lifecycle: #cleanup
  // -------------------------------------------------------------------------

  describe('#cleanup', () => {
    it('is safe to call when no browser exists', async () => {
      const browser = new Browser(BASE_URL, TOKEN)

      // Should not throw
      await browser.cleanup()

      expect(browser.isConnected()).toBe(false)
    })

    it('disconnects browser after cleanup', async () => {
      const browser = new Browser(BASE_URL, TOKEN)
      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })
      await browser.cleanup()

      expect(browser.isConnected()).toBe(false)
    })

    it('calls close on the browser instance', async () => {
      const browser = new Browser(BASE_URL, TOKEN)
      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })
      mockBrowserInstance.close.mockClear()

      await browser.cleanup()

      expect(mockBrowserInstance.close).toHaveBeenCalledTimes(1)
    })

    it('calls close on the page instance', async () => {
      const browser = new Browser(BASE_URL, TOKEN)
      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })
      const pageBefore = currentMockPage
      pageBefore.close.mockClear()

      await browser.cleanup()

      expect(pageBefore.close).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // Navigation: #navigatePage — viewport (no header offset)
  // -------------------------------------------------------------------------

  describe('#navigatePage', () => {
    it('sets viewport directly without header height offset', async () => {
      const browser = new Browser(BASE_URL, TOKEN)

      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })

      expect(currentMockPage.setViewport).toHaveBeenCalledWith(DEFAULT_VIEWPORT)
    })

    it('does not add scaled header offset when zoom is set', async () => {
      const browser = new Browser(BASE_URL, TOKEN)
      const viewport = { width: 1200, height: 825 }

      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport,
        zoom: 1.5,
      })

      // Before: height would be 825 + Math.round(56 * 1.5) = 825 + 84 = 909
      // After: height stays 825
      expect(currentMockPage.setViewport).toHaveBeenCalledWith(viewport)
    })

    it('rejects concurrent calls with busy error', async () => {
      const browser = new Browser(BASE_URL, TOKEN)

      // Start navigation without awaiting — sets #busy synchronously
      const pending = browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })

      // Second call should reject because #busy is still true
      const second = browser.navigatePage({
        pagePath: '/lovelace/1',
        viewport: DEFAULT_VIEWPORT,
      })

      await expect(second).rejects.toThrow('Browser is busy')
      await pending
    })

    it('navigates with targetUrl for generic mode', async () => {
      const browser = new Browser(BASE_URL, TOKEN)

      await browser.navigatePage({
        pagePath: '',
        targetUrl: 'https://example.com/dashboard',
        viewport: DEFAULT_VIEWPORT,
      })

      // Verify goto was called (navigation happened)
      expect(currentMockPage.goto).toHaveBeenCalled()
    })

    it('returns timing information', async () => {
      const browser = new Browser(BASE_URL, TOKEN)

      const result = await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })

      expect(typeof result.time).toBe('number')
    })
  })

  // -------------------------------------------------------------------------
  // Screenshot: #screenshotPage — clip logic
  // -------------------------------------------------------------------------

  describe('#screenshotPage', () => {
    let browser: InstanceType<typeof Browser>

    beforeEach(async () => {
      browser = new Browser(BASE_URL, TOKEN)
      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })
      currentMockPage.screenshot.mockClear()
    })

    it('passes crop directly as clip without header offset', async () => {
      await browser.screenshotPage({
        viewport: DEFAULT_VIEWPORT,
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
        viewport: DEFAULT_VIEWPORT,
      })

      // Before: always set clip with y=headerHeight even without crop
      // After: no clip at all → Puppeteer captures full viewport
      expect(currentMockPage.screenshot).toHaveBeenCalledWith({ type: 'png' })
    })

    it('captures full viewport when crop is null', async () => {
      await browser.screenshotPage({
        viewport: DEFAULT_VIEWPORT,
        crop: null,
      })

      expect(currentMockPage.screenshot).toHaveBeenCalledWith({ type: 'png' })
    })

    it('ignores crop with zero width', async () => {
      await browser.screenshotPage({
        viewport: DEFAULT_VIEWPORT,
        crop: { x: 0, y: 0, width: 0, height: 480 },
      })

      expect(currentMockPage.screenshot).toHaveBeenCalledWith({ type: 'png' })
    })

    it('ignores crop with zero height', async () => {
      await browser.screenshotPage({
        viewport: DEFAULT_VIEWPORT,
        crop: { x: 0, y: 0, width: 800, height: 0 },
      })

      expect(currentMockPage.screenshot).toHaveBeenCalledWith({ type: 'png' })
    })

    it('uses origin clip when crop covers full viewport', async () => {
      await browser.screenshotPage({
        viewport: DEFAULT_VIEWPORT,
        crop: { x: 0, y: 0, width: 800, height: 480 },
      })

      expect(currentMockPage.screenshot).toHaveBeenCalledWith({
        type: 'png',
        clip: { x: 0, y: 0, width: 800, height: 480 },
      })
    })

    it('returns image as Buffer', async () => {
      const result = await browser.screenshotPage({
        viewport: DEFAULT_VIEWPORT,
        crop: { x: 0, y: 0, width: 800, height: 480 },
      })

      expect(result.image).toBeInstanceOf(Buffer)
    })

    it('returns timing as number', async () => {
      const result = await browser.screenshotPage({
        viewport: DEFAULT_VIEWPORT,
      })

      expect(typeof result.time).toBe('number')
    })

    it('rejects concurrent calls with busy error', async () => {
      // Start screenshot without awaiting
      const pending = browser.screenshotPage({ viewport: DEFAULT_VIEWPORT })

      const second = browser.screenshotPage({ viewport: DEFAULT_VIEWPORT })

      await expect(second).rejects.toThrow('Browser is busy')
      await pending
    })
  })
})
