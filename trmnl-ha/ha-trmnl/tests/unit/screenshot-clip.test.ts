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
 * NOTE: Uses constructor dependency injection instead of mock.module() to avoid
 * global mock pollution. Real navigation-commands and page-setup-strategies run
 * against the comprehensive mock page below.
 *
 * @module tests/unit/screenshot-clip
 */

import { mock, describe, it, expect, beforeEach } from 'bun:test'
import type { BrowserDeps } from '../../screenshot.js'
import { readinessInternalsPresent } from '../../lib/browser/navigation-commands.js'

// Safety: const.ts needs these env vars at module load time (no options-dev.json in CI)
process.env['HOME_ASSISTANT_URL'] = 'http://localhost:8123'
process.env['ACCESS_TOKEN'] = 'test-token'

// ---------------------------------------------------------------------------
// Mock page factory — comprehensive mock that works with real commands
// ---------------------------------------------------------------------------

type MockFn = ReturnType<typeof mock>

interface MockPage {
  screenshot: MockFn
  setViewport: MockFn
  emulateMediaFeatures: MockFn
  close: MockFn
  on: MockFn
  off: MockFn
  url: () => string
  waitForNetworkIdle: MockFn
  // Methods required by real NavigateToPage
  evaluateOnNewDocument: MockFn
  goto: MockFn
  removeScriptToEvaluateOnNewDocument: MockFn
  // Methods required by real wait commands and page setup strategies
  evaluate: MockFn
  waitForFunction: MockFn
  /** Test helper: invoke all registered 'console' handlers. */
  fireConsole: (text: string, type?: string) => void
}

let currentMockPage: MockPage

function createMockPage(): MockPage {
  // Map from event name to list of handlers. Tests can fire 'console' events
  // via fireConsole() to check that page warnings stay inert.
  const handlers = new Map<string, ((arg: unknown) => void)[]>()

  const page: MockPage = {
    screenshot: mock(
      async (_opts?: unknown) =>
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
    setViewport: mock(async (_v?: unknown) => {}),
    emulateMediaFeatures: mock(async (_f?: unknown) => {}),
    close: mock(async () => {}),
    url: () => 'http://localhost:8123/lovelace',
    waitForNetworkIdle: mock(async () => {}),
    // on() must return the page for method chaining in #setupPageLogging
    on: mock((event: string, handler: (arg: unknown) => void) => {
      const arr = handlers.get(event) ?? []
      arr.push(handler)
      handlers.set(event, arr)
      return page
    }),
    off: mock((event: string, handler: (arg: unknown) => void) => {
      const arr = handlers.get(event)
      if (arr) {
        const idx = arr.indexOf(handler)
        if (idx >= 0) arr.splice(idx, 1)
      }
      return page
    }),
    // NavigateToPage: inject auth → navigate → cleanup
    evaluateOnNewDocument: mock(async () => ({ identifier: 'mock-id' })),
    goto: mock(async () => ({ ok: () => true, status: () => 200 })),
    removeScriptToEvaluateOnNewDocument: mock(async () => {}),
    // Wait commands + page setup strategies. The readiness check asks whether
    // Home Assistant still exposes the fields it depends on, and must be told
    // yes; every other caller here reads a count.
    evaluate: mock(async (fn: unknown) =>
      fn === readinessInternalsPresent ? true : 0,
    ),
    waitForFunction: mock(async () => {}),
    fireConsole: (text: string, type: string = 'warn') => {
      const msg = { type: () => type, text: () => text }
      const arr = handlers.get('console') ?? []
      for (const h of arr) h(msg)
    },
  }
  currentMockPage = page
  return page
}

// ---------------------------------------------------------------------------
// Mock browser + injectable dependencies (no mock.module — avoids global pollution)
// ---------------------------------------------------------------------------

const mockBrowserInstance = {
  connected: true,
  newPage: mock(async () => createMockPage()),
  close: mock(async () => {}),
  on: mock(() => {}),
}

// Dynamic import: env vars must be set BEFORE const.ts loads (static imports hoist)
const { Browser } = await import('../../screenshot.js')

const mockDeps = {
  launchBrowser: mock(async () => mockBrowserInstance),
  processImage: mock(async (buf: Buffer) => buf),
  chromiumExecutable: undefined,
  debugLogging: false,
} as unknown as BrowserDeps

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
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)

      expect(browser.busy).toBe(false)
    })

    it('is false after navigation completes', async () => {
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)
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
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)

      expect(browser.isConnected()).toBe(false)
    })

    it('returns true after navigation launches browser', async () => {
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)
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
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)

      // Should not throw
      await browser.cleanup()

      expect(browser.isConnected()).toBe(false)
    })

    it('disconnects browser after cleanup', async () => {
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)
      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })
      await browser.cleanup()

      expect(browser.isConnected()).toBe(false)
    })

    it('calls close on the browser instance', async () => {
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)
      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })
      mockBrowserInstance.close.mockClear()

      await browser.cleanup()

      expect(mockBrowserInstance.close).toHaveBeenCalledTimes(1)
    })

    it('calls close on the page instance', async () => {
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)
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
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)

      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })

      expect(currentMockPage.setViewport).toHaveBeenCalledWith(DEFAULT_VIEWPORT)
    })

    it('does not add scaled header offset when zoom is set', async () => {
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)
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
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)

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
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)

      await browser.navigatePage({
        pagePath: '',
        targetUrl: 'https://example.com/dashboard',
        viewport: DEFAULT_VIEWPORT,
      })

      // Verify goto was called (navigation happened)
      expect(currentMockPage.goto).toHaveBeenCalled()
    })

    it('returns timing information', async () => {
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)

      const result = await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })

      expect(typeof result.time).toBe('number')
    })

    // The HA frontend logs "Received event for unknown subscription N" whenever
    // an event arrives for an already-unsubscribed id, which happens routinely
    // on panel unmount. Navigation must treat it as noise: a previous version
    // retried on it by re-mounting the panel, which remounted the wrong
    // dashboard and blanked energy/auto-entities cards (issues #84, #87).
    it('does not renavigate when HA logs an orphan subscription warning', async () => {
      const browser = new Browser(BASE_URL, TOKEN, mockDeps)
      mockBrowserInstance.newPage.mockClear()

      let pageCreatedCount = 0
      mockBrowserInstance.newPage.mockImplementation(async () => {
        pageCreatedCount++
        const page = createMockPage()
        const origGoto = page.goto
        page.goto = mock(async (url: string) => {
          const result = await origGoto(url)
          page.fireConsole(
            'Received event for unknown subscription 42. Unsubscribing.',
            'warn',
          )
          return result
        }) as MockFn
        return page
      })

      await browser.navigatePage({
        pagePath: '/lovelace/0',
        viewport: DEFAULT_VIEWPORT,
      })

      expect(pageCreatedCount).toBe(1)
      expect(currentMockPage.goto).toHaveBeenCalledTimes(1)
      expect(browser.busy).toBe(false)

      mockBrowserInstance.newPage.mockImplementation(async () =>
        createMockPage(),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Screenshot: #screenshotPage — clip logic
  // -------------------------------------------------------------------------

  describe('#screenshotPage', () => {
    let browser: InstanceType<typeof Browser>

    beforeEach(async () => {
      browser = new Browser(BASE_URL, TOKEN, mockDeps)
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

    it('passes a full-viewport crop through as the clip', async () => {
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
