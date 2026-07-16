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

import { mock, describe, it, expect, beforeEach, afterAll } from 'bun:test'
import type { BrowserDeps } from '../../screenshot.js'

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
  // via fireConsole() to exercise the orphan-detection retry path.
  const handlers = new Map<string, ((arg: unknown) => void)[]>()

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
    // Wait commands + page setup strategies
    evaluate: mock(async () => 0),
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

    // ------------------------------------------------------------------------
    // Retry on HA WS subscribeMessage race
    //
    // home-assistant-js-websocket has a microtask race between subscribe
    // handler registration and incoming WS frames. When triggered, HA logs
    // "Received event for unknown subscription N" and drops forecast data.
    // The orphan-detector listens for these warnings and retries by re-mounting
    // the panel via in-page SPA pushState on the same live page (warm WS
    // connection + warm JS heap is what wins the race on slow hardware).
    // Attempt 1 is always a fresh page.goto(); attempts 2..N reuse the page.
    // ------------------------------------------------------------------------

    describe('retry on WS subscription race', () => {
      // These tests override mockBrowserInstance.newPage.mockImplementation
      // to inject console-warning triggers. Restore the default after the
      // block so #screenshotPage tests below get plain pages.
      afterAll(() => {
        mockBrowserInstance.newPage.mockClear()
        mockBrowserInstance.newPage.mockImplementation(async () =>
          createMockPage(),
        )
      })

      // Wrap a fresh page's goto() so it fires a chosen console warning AFTER
      // the navigation handler has been attached. Used to trigger the orphan
      // on attempt 1 (the only attempt that calls goto).
      function makePageWithGotoTrigger(
        text: string,
        type: string = 'warn',
      ): MockPage {
        const page = createMockPage()
        const origGoto = page.goto
        page.goto = mock(async (url: string) => {
          const result = await origGoto(url)
          page.fireConsole(text, type)
          return result
        }) as MockFn
        return page
      }

      // Wrap both goto() and evaluate() so the orphan warning fires on
      // attempt 1 (via goto) AND every soft-retry (via softReroute's
      // pushState evaluate calls). Used to exercise the MAX_ATTEMPTS cap.
      function makePagePersistentlyOrphaning(
        text: string,
        type: string = 'warn',
      ): MockPage {
        const page = makePageWithGotoTrigger(text, type)
        const origEvaluate = page.evaluate
        page.evaluate = mock(
          async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
            const result = await origEvaluate(fn, ...args)
            page.fireConsole(text, type)
            return result
          },
        ) as MockFn
        return page
      }

      it('soft-retries on the same page when an orphan warning fires', async () => {
        const browser = new Browser(BASE_URL, TOKEN, mockDeps)
        mockBrowserInstance.newPage.mockClear()

        let pageCreatedCount = 0
        mockBrowserInstance.newPage.mockImplementation(async () => {
          pageCreatedCount++
          // First (and only) page created: orphans on goto, succeeds on
          // soft-retry (softReroute uses evaluate, not goto, so the trigger
          // doesn't re-fire).
          return makePageWithGotoTrigger(
            'Received event for unknown subscription 42. Unsubscribing.',
          )
        })

        const result = await browser.navigatePage({
          pagePath: '/lovelace/0',
          viewport: DEFAULT_VIEWPORT,
        })

        // Soft retry reuses the same page — only one newPage() call total.
        expect(pageCreatedCount).toBe(1)
        // goto called exactly once (attempt 1); retry used pushState evaluate.
        expect(currentMockPage.goto).toHaveBeenCalledTimes(1)
        expect(typeof result.time).toBe('number')
      })

      it('does NOT retry when no orphan warning fires', async () => {
        const browser = new Browser(BASE_URL, TOKEN, mockDeps)
        mockBrowserInstance.newPage.mockClear()

        let pageCreatedCount = 0
        mockBrowserInstance.newPage.mockImplementation(async () => {
          pageCreatedCount++
          return createMockPage()
        })

        await browser.navigatePage({
          pagePath: '/lovelace/0',
          viewport: DEFAULT_VIEWPORT,
        })

        expect(pageCreatedCount).toBe(1)
      })

      it('caps retries at MAX_ATTEMPTS (no infinite loop on persistent race)', async () => {
        const browser = new Browser(BASE_URL, TOKEN, mockDeps)
        mockBrowserInstance.newPage.mockClear()

        // Every attempt orphans (goto on attempt 1, evaluate on each retry).
        // Verify we still return after the cap and never create extra pages.
        // Cap matches the MAX_ATTEMPTS constant in screenshot.ts (currently 5).
        let pageCreatedCount = 0
        mockBrowserInstance.newPage.mockImplementation(async () => {
          pageCreatedCount++
          return makePagePersistentlyOrphaning(
            'Received event for unknown subscription 1. Unsubscribing.',
          )
        })

        const result = await browser.navigatePage({
          pagePath: '/lovelace/0',
          viewport: DEFAULT_VIEWPORT,
        })

        // Still only one page across all soft retries.
        expect(pageCreatedCount).toBe(1)
        // goto called exactly once (only attempt 1 does a hard navigation).
        expect(currentMockPage.goto).toHaveBeenCalledTimes(1)
        // 'console' subscribed once by #setupPageLogging plus once per
        // attempt — exactly MAX_ATTEMPTS (5) attempts ran, then we stopped.
        const consoleSubscriptions = currentMockPage.on.mock.calls.filter(
          (call) => call[0] === 'console',
        ).length
        expect(consoleSubscriptions).toBe(6)
        expect(typeof result.time).toBe('number')
      })

      it('ignores non-orphan console warnings', async () => {
        const browser = new Browser(BASE_URL, TOKEN, mockDeps)
        mockBrowserInstance.newPage.mockClear()

        let pageCreatedCount = 0
        mockBrowserInstance.newPage.mockImplementation(async () => {
          pageCreatedCount++
          return makePageWithGotoTrigger('Some unrelated browser warning')
        })

        await browser.navigatePage({
          pagePath: '/lovelace/0',
          viewport: DEFAULT_VIEWPORT,
        })

        // No retry — only 1 page.
        expect(pageCreatedCount).toBe(1)
      })

      it('ignores orphan-like warnings of non-warning type', async () => {
        // Detector only matches type() === 'warn' | 'warning'. An 'info' or
        // 'log' message with similar text shouldn't trigger a retry.
        const browser = new Browser(BASE_URL, TOKEN, mockDeps)
        mockBrowserInstance.newPage.mockClear()

        let pageCreatedCount = 0
        mockBrowserInstance.newPage.mockImplementation(async () => {
          pageCreatedCount++
          return makePageWithGotoTrigger(
            'Received event for unknown subscription 7. Unsubscribing.',
            'info',
          )
        })

        await browser.navigatePage({
          pagePath: '/lovelace/0',
          viewport: DEFAULT_VIEWPORT,
        })

        expect(pageCreatedCount).toBe(1)
      })

      it('keeps #busy=false after a retried navigation completes', async () => {
        const browser = new Browser(BASE_URL, TOKEN, mockDeps)
        mockBrowserInstance.newPage.mockClear()

        mockBrowserInstance.newPage.mockImplementation(async () =>
          makePageWithGotoTrigger(
            'Received event for unknown subscription 99. Unsubscribing.',
          ),
        )

        await browser.navigatePage({
          pagePath: '/lovelace/0',
          viewport: DEFAULT_VIEWPORT,
        })

        expect(browser.busy).toBe(false)
      })
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
