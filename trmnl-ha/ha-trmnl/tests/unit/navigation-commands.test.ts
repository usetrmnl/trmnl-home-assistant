/**
 * Unit tests for NavigateToPage and wait/update commands
 *
 * Verifies auth injection, error handling, wait strategies, and page setup commands.
 *
 * @module tests/unit/navigation-commands
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  NavigateToPage,
  WaitForPageLoad,
  WaitForLoadingComplete,
  DismissToasts,
  WaitForPaintStability,
  resetInternalsWarning,
  WaitForWebSocketIdle,
  WaitForHassReady,
  UpdateLanguage,
  UpdateTheme,
  isPageReadyForCapture,
  readinessInternalsPresent,
  type AuthStorage,
} from '../../lib/browser/navigation-commands.js'
import { CannotOpenPageError } from '../../error.js'
import type { Page } from 'puppeteer'

// =============================================================================
// MOCK HELPERS
// =============================================================================

/** Tracks which Page methods were called */
interface MockPageCalls {
  evaluateOnNewDocument: number
  removeScriptToEvaluateOnNewDocument: number
  goto: string[]
  gotoOptions: unknown[]
  evaluate: { fn: unknown; args: unknown[] }[]
  waitForFunction: number
}

interface MockPageOptions {
  gotoResponse?: { ok: () => boolean; status: () => number } | null
  gotoError?: Error
  evaluateResult?: unknown
  waitForFunctionError?: Error
}

/** Creates a mock Puppeteer Page that tracks method calls */
function createMockPage(
  options: MockPageOptions = {},
): Page & { calls: MockPageCalls } {
  const calls: MockPageCalls = {
    evaluateOnNewDocument: 0,
    removeScriptToEvaluateOnNewDocument: 0,
    goto: [],
    gotoOptions: [],
    evaluate: [],
    waitForFunction: 0,
  }

  return {
    calls,
    evaluateOnNewDocument: async () => {
      calls.evaluateOnNewDocument++
      return { identifier: 'mock-id' }
    },
    removeScriptToEvaluateOnNewDocument: async () => {
      calls.removeScriptToEvaluateOnNewDocument++
    },
    goto: async (url: string, opts?: unknown) => {
      calls.goto.push(url)
      calls.gotoOptions.push(opts)
      if (options.gotoError) throw options.gotoError
      return 'gotoResponse' in options
        ? options.gotoResponse
        : { ok: () => true, status: () => 200 }
    },
    evaluate: async (fn: unknown, ...args: unknown[]) => {
      calls.evaluate.push({ fn, args })
      return options.evaluateResult
    },
    waitForFunction: async () => {
      calls.waitForFunction++
      if (options.waitForFunctionError) throw options.waitForFunctionError
    },
  } as unknown as Page & { calls: MockPageCalls }
}

const STUB_AUTH: AuthStorage = { hassTokens: '{}' }

// =============================================================================
// NavigateToPage
// =============================================================================

describe('NavigateToPage', () => {
  let mockPage: ReturnType<typeof createMockPage>

  beforeEach(() => {
    mockPage = createMockPage()
  })

  // ==========================================================================
  // Auth injection with default port normalization (Issue #33)
  // ==========================================================================

  describe('default port normalization', () => {
    it('injects auth when HA URL has explicit port 80', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:80',
      )

      await nav.call('/lovelace/0')

      expect(mockPage.calls.evaluateOnNewDocument).toBe(1)
    })

    it('injects auth when HTTPS HA URL has explicit port 443', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'https://ha.example.com:443',
      )

      await nav.call('/lovelace/0')

      expect(mockPage.calls.evaluateOnNewDocument).toBe(1)
    })

    it('injects auth when HA URL has no explicit port', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant',
      )

      await nav.call('/lovelace/0')

      expect(mockPage.calls.evaluateOnNewDocument).toBe(1)
    })
  })

  // ==========================================================================
  // Auth injection with non-default ports
  // ==========================================================================

  describe('non-default ports', () => {
    it('injects auth for HA on port 8123', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/lovelace/0')

      expect(mockPage.calls.evaluateOnNewDocument).toBe(1)
    })

    it('injects auth for HTTPS on non-default port', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'https://ha.example.com:8443',
      )

      await nav.call('/lovelace/dashboard')

      expect(mockPage.calls.evaluateOnNewDocument).toBe(1)
    })
  })

  // ==========================================================================
  // External URLs should NOT get auth injection
  // ==========================================================================

  describe('external URLs', () => {
    it('skips auth for external targetUrl', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/unused', 'http://other-server.com/page')

      expect(mockPage.calls.evaluateOnNewDocument).toBe(0)
    })

    it('skips auth when targetUrl host differs from HA', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:80',
      )

      await nav.call('/unused', 'http://grafana.local:3000/dashboard')

      expect(mockPage.calls.evaluateOnNewDocument).toBe(0)
    })
  })

  // ==========================================================================
  // Navigation behavior
  // ==========================================================================

  describe('navigation', () => {
    it('always uses page.goto', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/lovelace/kitchen')

      expect(mockPage.calls.goto).toEqual([
        'http://homeassistant:8123/lovelace/kitchen',
      ])
    })

    it('uses targetUrl directly when provided', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/unused', 'http://grafana.local:3000/dashboard')

      expect(mockPage.calls.goto).toEqual([
        'http://grafana.local:3000/dashboard',
      ])
    })

    it('cleans up evaluateOnNewDocument after successful HA navigation', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/lovelace/0')

      expect(mockPage.calls.removeScriptToEvaluateOnNewDocument).toBe(1)
    })

    it('does not call removeScript for external URLs', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/unused', 'http://external.com/page')

      expect(mockPage.calls.removeScriptToEvaluateOnNewDocument).toBe(0)
    })

    it('passes NAVIGATION_TIMEOUT to page.goto (fixes #58)', async () => {
      const { NAVIGATION_TIMEOUT } = await import('../../const.js')
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/lovelace/0')

      expect(mockPage.calls.gotoOptions).toHaveLength(1)
      const opts = mockPage.calls.gotoOptions[0] as {
        waitUntil?: string
        timeout?: number
      }
      expect(opts.timeout).toBe(NAVIGATION_TIMEOUT)
    })

    it('waits for the network to settle so card resources finish loading', async () => {
      const mockPage = createMockPage()
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/lovelace/0')

      const opts = mockPage.calls.gotoOptions[0] as { waitUntil?: string }
      expect(opts.waitUntil).toBe('networkidle2')
    })
  })

  // ==========================================================================
  // Error handling
  // ==========================================================================

  describe('error handling', () => {
    it('throws CannotOpenPageError when goto throws', async () => {
      const failPage = createMockPage({
        gotoError: new Error('net::ERR_CONNECTION_REFUSED'),
      })
      const nav = new NavigateToPage(
        failPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await expect(nav.call('/lovelace/0')).rejects.toBeInstanceOf(
        CannotOpenPageError,
      )
    })

    it('cleans up evaluateOnNewDocument when goto throws for HA URLs', async () => {
      const failPage = createMockPage({
        gotoError: new Error('timeout'),
      })
      const nav = new NavigateToPage(
        failPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      try {
        await nav.call('/lovelace/0')
      } catch {
        // expected
      }

      expect(failPage.calls.removeScriptToEvaluateOnNewDocument).toBe(1)
    })

    it('throws CannotOpenPageError when response is not ok', async () => {
      const failPage = createMockPage({
        gotoResponse: { ok: () => false, status: () => 404 },
      })
      const nav = new NavigateToPage(
        failPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await expect(nav.call('/lovelace/missing')).rejects.toBeInstanceOf(
        CannotOpenPageError,
      )
    })

    it('cleans up evaluateOnNewDocument when response is not ok', async () => {
      const failPage = createMockPage({
        gotoResponse: { ok: () => false, status: () => 500 },
      })
      const nav = new NavigateToPage(
        failPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      try {
        await nav.call('/lovelace/0')
      } catch {
        // expected
      }

      expect(failPage.calls.removeScriptToEvaluateOnNewDocument).toBe(1)
    })

    it('throws CannotOpenPageError with status 0 when goto throws for external URL', async () => {
      const failPage = createMockPage({
        gotoError: new Error('DNS failed'),
      })
      const nav = new NavigateToPage(
        failPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      try {
        await nav.call('/unused', 'http://bad-host.invalid/page')
      } catch (err) {
        expect(err).toBeInstanceOf(CannotOpenPageError)
      }

      // No auth was injected so no cleanup needed
      expect(failPage.calls.removeScriptToEvaluateOnNewDocument).toBe(0)
    })

    it('handles null response gracefully', async () => {
      const failPage = createMockPage({ gotoResponse: null })
      const nav = new NavigateToPage(
        failPage,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await expect(nav.call('/lovelace/0')).rejects.toBeInstanceOf(
        CannotOpenPageError,
      )
    })
  })
})

// =============================================================================
// WaitForPageLoad
// =============================================================================

describe('WaitForPageLoad', () => {
  it('calls waitForFunction to check HA shadow DOM', async () => {
    const mockPage = createMockPage()
    const cmd = new WaitForPageLoad(mockPage)

    await cmd.call()

    expect(mockPage.calls.waitForFunction).toBe(1)
  })

  it('resolves when the wait times out', async () => {
    const mockPage = createMockPage({
      waitForFunctionError: new Error('Timeout'),
    })
    const cmd = new WaitForPageLoad(mockPage)

    await cmd.call()

    expect(mockPage.calls.waitForFunction).toBe(1)
  })

  it('uses 5 second timeout with 100ms polling', async () => {
    let capturedOptions: unknown
    const mockPage = {
      waitForFunction: async (_fn: unknown, opts: unknown) => {
        capturedOptions = opts
      },
    } as unknown as Page

    const cmd = new WaitForPageLoad(mockPage)
    await cmd.call()

    expect(capturedOptions).toEqual({ timeout: 5000, polling: 100 })
  })

  it('passes a function to waitForFunction', async () => {
    let capturedFn: unknown
    const mockPage = {
      waitForFunction: async (fn: unknown) => {
        capturedFn = fn
      },
    } as unknown as Page

    const cmd = new WaitForPageLoad(mockPage)
    await cmd.call()

    expect(typeof capturedFn).toBe('function')
  })
})

// =============================================================================
// WaitForLoadingComplete
// =============================================================================

describe('WaitForLoadingComplete', () => {
  // The warning latches for the life of the process, so this has to run
  // before anything else in the suite drives a page whose evaluate() reports
  // the internals as missing.
  it('checks the Home Assistant internals once and not again', async () => {
    resetInternalsWarning()
    let checks = 0
    const missingInternals = {
      waitForFunction: async () => {},
      evaluate: async () => {
        checks++
        return false
      },
    } as unknown as Page

    await new WaitForLoadingComplete(missingInternals, 10).call()
    await new WaitForLoadingComplete(missingInternals, 10).call()

    expect(checks).toBe(1)
  })

  it('returns wait time when resolved immediately', async () => {
    const mockPage = {
      waitForFunction: async () => {},
    } as unknown as Page

    const cmd = new WaitForLoadingComplete(mockPage, 5000)
    const waitTime = await cmd.call()

    expect(waitTime).toBeLessThan(500)
  })

  it('resolves when the wait times out', async () => {
    const mockPage = {
      waitForFunction: async () => {
        throw new Error('Waiting for function timed out')
      },
    } as unknown as Page

    const cmd = new WaitForLoadingComplete(mockPage, 500)
    const waitTime = await cmd.call()

    expect(waitTime).toBeDefined()
  })

  it('passes custom timeout with 100ms polling', async () => {
    let capturedOptions: unknown
    const mockPage = {
      waitForFunction: async (_fn: unknown, opts: unknown) => {
        capturedOptions = opts
      },
    } as unknown as Page

    const cmd = new WaitForLoadingComplete(mockPage, 8000)
    await cmd.call()

    expect(capturedOptions).toEqual({ timeout: 8000, polling: 100 })
  })

  it('defaults to 10 second timeout', async () => {
    let capturedOptions: unknown
    const mockPage = {
      waitForFunction: async (_fn: unknown, opts: unknown) => {
        capturedOptions = opts
      },
    } as unknown as Page

    const cmd = new WaitForLoadingComplete(mockPage)
    await cmd.call()

    expect(capturedOptions).toEqual({ timeout: 10000, polling: 100 })
  })

  describe('loading selectors', () => {
    it('includes ha-circular-progress spinner', async () => {
      let capturedSelectors: unknown
      const mockPage = {
        waitForFunction: async (
          _fn: unknown,
          _opts: unknown,
          selectors: unknown,
        ) => {
          capturedSelectors = selectors
        },
      } as unknown as Page

      const cmd = new WaitForLoadingComplete(mockPage)
      await cmd.call()

      expect(capturedSelectors as string).toContain('ha-circular-progress')
    })

    it('includes hass-loading-screen panel loading screen', async () => {
      let capturedSelectors: unknown
      const mockPage = {
        waitForFunction: async (
          _fn: unknown,
          _opts: unknown,
          selectors: unknown,
        ) => {
          capturedSelectors = selectors
        },
      } as unknown as Page

      const cmd = new WaitForLoadingComplete(mockPage)
      await cmd.call()

      expect(capturedSelectors as string).toContain('hass-loading-screen')
    })

    it('includes hui-card-preview card placeholder', async () => {
      let capturedSelectors: unknown
      const mockPage = {
        waitForFunction: async (
          _fn: unknown,
          _opts: unknown,
          selectors: unknown,
        ) => {
          capturedSelectors = selectors
        },
      } as unknown as Page

      const cmd = new WaitForLoadingComplete(mockPage)
      await cmd.call()

      expect(capturedSelectors as string).toContain('hui-card-preview')
    })

    it('includes generic loading class selectors', async () => {
      let capturedSelectors: unknown
      const mockPage = {
        waitForFunction: async (
          _fn: unknown,
          _opts: unknown,
          selectors: unknown,
        ) => {
          capturedSelectors = selectors
        },
      } as unknown as Page

      const cmd = new WaitForLoadingComplete(mockPage)
      await cmd.call()

      const selectors = capturedSelectors as string
      expect(selectors).toContain('.loading')
      expect(selectors).toContain('.spinner')
      expect(selectors).toContain('[loading]')
    })

    it('formats selectors as comma-separated CSS selector list', async () => {
      let capturedSelectors: unknown
      const mockPage = {
        waitForFunction: async (
          _fn: unknown,
          _opts: unknown,
          selectors: unknown,
        ) => {
          capturedSelectors = selectors
        },
      } as unknown as Page

      const cmd = new WaitForLoadingComplete(mockPage)
      await cmd.call()

      const selectors = capturedSelectors as string
      // Should be a valid CSS selector list (comma-separated)
      expect(selectors.split(', ').length).toBeGreaterThanOrEqual(6)
    })
  })
})

// =============================================================================
// DismissToasts
// =============================================================================

describe('DismissToasts', () => {
  it('calls page.evaluate and returns dismissed count', async () => {
    const mockPage = createMockPage({ evaluateResult: 2 })
    const cmd = new DismissToasts(mockPage)

    const result = await cmd.call()

    expect(mockPage.calls.evaluate.length).toBe(1)
    expect(result).toBe(2)
  })

  it('returns 0 when no toasts found', async () => {
    const mockPage = createMockPage({ evaluateResult: 0 })
    const cmd = new DismissToasts(mockPage)

    const result = await cmd.call()

    expect(result).toBe(0)
  })
})

// =============================================================================
// WaitForPaintStability
// =============================================================================

describe('WaitForPaintStability', () => {
  it('calls waitForFunction', async () => {
    let called = false
    const mockPage = {
      waitForFunction: async () => {
        called = true
      },
    } as unknown as Page

    const cmd = new WaitForPaintStability(mockPage)
    await cmd.call()

    expect(called).toBe(true)
  })

  it('resolves when the wait times out', async () => {
    const mockPage = {
      waitForFunction: async () => {
        throw new Error('Timeout')
      },
    } as unknown as Page

    const cmd = new WaitForPaintStability(mockPage)
    await cmd.call()
  })

  it('polls until the layout holds still', async () => {
    let capturedOptions: unknown
    const mockPage = {
      waitForFunction: async (_fn: unknown, opts: unknown) => {
        capturedOptions = opts
      },
    } as unknown as Page

    const cmd = new WaitForPaintStability(mockPage)
    await cmd.call()

    expect(capturedOptions).toEqual({ timeout: 3000, polling: 100 })
  })

  it('passes the layout sampler to the page', async () => {
    let capturedFn: unknown
    const mockPage = {
      waitForFunction: async (fn: unknown) => {
        capturedFn = fn
      },
    } as unknown as Page

    const cmd = new WaitForPaintStability(mockPage)
    await cmd.call()

    expect(typeof capturedFn).toBe('function')
  })
})

// =============================================================================
// WaitForWebSocketIdle
// =============================================================================

/** A CDP session whose websocket frame events a test can drive. */
function createWebSocketMockPage(options: { cdpUnavailable?: boolean } = {}): {
  page: Page
  emitFrame: () => void
  wasDetached: () => boolean
} {
  const handlers: (() => void)[] = []
  let detached = false

  const page = {
    createCDPSession: async () => {
      if (options.cdpUnavailable) throw new Error('CDP unavailable')
      return {
        send: async () => {},
        on: (_event: string, handler: () => void) => handlers.push(handler),
        detach: async () => {
          detached = true
        },
      }
    },
  } as unknown as Page

  return {
    page,
    emitFrame: () => handlers.forEach((handler) => handler()),
    wasDetached: () => detached,
  }
}

describe('WaitForWebSocketIdle', () => {
  it('resolves once no frame has arrived for the quiet window', async () => {
    const { page } = createWebSocketMockPage()
    const start = Date.now()

    await new WaitForWebSocketIdle(page, 150, 2000).call()

    expect(Date.now() - start).toBeGreaterThanOrEqual(150)
  })

  it('waits while frames keep arriving, then resolves after they stop', async () => {
    const { page, emitFrame } = createWebSocketMockPage()
    const interval = setInterval(emitFrame, 50)
    setTimeout(() => clearInterval(interval), 250)
    const start = Date.now()

    await new WaitForWebSocketIdle(page, 150, 2000).call()

    expect(Date.now() - start).toBeGreaterThanOrEqual(400)
  })

  it('stops at the timeout when frames never stop', async () => {
    const { page, emitFrame } = createWebSocketMockPage()
    const interval = setInterval(emitFrame, 40)
    const start = Date.now()

    await new WaitForWebSocketIdle(page, 300, 250).call()

    clearInterval(interval)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(250)
    expect(elapsed).toBeLessThan(700)
  })

  it('detaches the CDP session when done', async () => {
    const { page, wasDetached } = createWebSocketMockPage()

    await new WaitForWebSocketIdle(page, 100, 2000).call()

    expect(wasDetached()).toBe(true)
  })

  it('does not throw when a CDP session cannot be created', async () => {
    const { page } = createWebSocketMockPage({ cdpUnavailable: true })

    await new WaitForWebSocketIdle(page, 100, 2000).call()
  })
})

// =============================================================================
// WaitForHassReady
// =============================================================================

describe('WaitForHassReady', () => {
  it('calls waitForFunction', async () => {
    let called = false
    const mockPage = {
      waitForFunction: async () => {
        called = true
      },
    } as unknown as Page

    const cmd = new WaitForHassReady(mockPage)
    await cmd.call()

    expect(called).toBe(true)
  })

  it('resolves when the wait times out', async () => {
    const mockPage = {
      waitForFunction: async () => {
        throw new Error('Timeout')
      },
    } as unknown as Page

    const cmd = new WaitForHassReady(mockPage)
    await cmd.call()
  })

  it('uses 5 second timeout with 100ms polling', async () => {
    let capturedOptions: unknown
    const mockPage = {
      waitForFunction: async (_fn: unknown, opts: unknown) => {
        capturedOptions = opts
      },
    } as unknown as Page

    const cmd = new WaitForHassReady(mockPage)
    await cmd.call()

    expect(capturedOptions).toEqual({ timeout: 5000, polling: 100 })
  })

  it('respects custom timeout from constructor', async () => {
    let capturedOptions: unknown
    const mockPage = {
      waitForFunction: async (_fn: unknown, opts: unknown) => {
        capturedOptions = opts
      },
    } as unknown as Page

    const cmd = new WaitForHassReady(mockPage, 3000)
    await cmd.call()

    expect(capturedOptions).toEqual({ timeout: 3000, polling: 100 })
  })

  it('passes a function to waitForFunction', async () => {
    let capturedFn: unknown
    const mockPage = {
      waitForFunction: async (fn: unknown) => {
        capturedFn = fn
      },
    } as unknown as Page

    const cmd = new WaitForHassReady(mockPage)
    await cmd.call()

    expect(typeof capturedFn).toBe('function')
  })

})

// =============================================================================
// UpdateLanguage
// =============================================================================

describe('UpdateLanguage', () => {
  it('calls page.evaluate with the specified language', async () => {
    const mockPage = createMockPage()
    const cmd = new UpdateLanguage(mockPage)

    await cmd.call('fr')

    expect(mockPage.calls.evaluate.length).toBe(1)
    expect(mockPage.calls.evaluate[0]!.args[0]).toBe('fr')
  })

  it('defaults to "en" when empty string passed', async () => {
    const mockPage = createMockPage()
    const cmd = new UpdateLanguage(mockPage)

    await cmd.call('')

    expect(mockPage.calls.evaluate[0]!.args[0]).toBe('en')
  })
})

// =============================================================================
// UpdateTheme
// =============================================================================

describe('UpdateTheme', () => {
  it('calls page.evaluate with theme and dark mode', async () => {
    const mockPage = createMockPage()
    const cmd = new UpdateTheme(mockPage)

    await cmd.call('midnight', true)

    expect(mockPage.calls.evaluate.length).toBe(1)
    expect(mockPage.calls.evaluate[0]!.args[0]).toEqual({
      theme: 'midnight',
      dark: true,
    })
  })

  it('defaults empty theme to empty string', async () => {
    const mockPage = createMockPage()
    const cmd = new UpdateTheme(mockPage)

    await cmd.call('', false)

    expect(mockPage.calls.evaluate[0]!.args[0]).toEqual({
      theme: '',
      dark: false,
    })
  })
})

// =============================================================================
// Fake DOM
//
// isPageReadyForCapture and readinessInternalsPresent are shipped to the
// browser by page.evaluate, so they read globals rather than take a tree as an
// argument. These fakes supply the few DOM methods they use.
// =============================================================================

interface FakeEl {
  tagName: string
  /** Selectors this element answers to, since the fake does not parse CSS. */
  matches?: string[]
  shadowRoot?: FakeEl | null
  children?: FakeEl[]
  hidden?: boolean
  _panelState?: string
  _cards?: unknown[]
  _data?: unknown
  _chartData?: unknown
}

interface FakeNode extends FakeEl {
  shadowRoot: FakeNode | null
  firstElementChild: FakeNode | null
  querySelector: (s: string) => FakeNode | null
  querySelectorAll: (s: string) => FakeNode[]
}

function node(el: FakeEl): FakeNode {
  const children = (el.children ?? []).map(node)
  const descendants = children.flatMap((c) => [c, ...c.querySelectorAll('*')])

  const querySelectorAll = (sel: string): FakeNode[] => {
    if (sel === '*') return descendants
    const wanted = sel.split(',').map((s) => s.trim())
    return descendants.filter((d) =>
      (d.matches ?? []).some((m) => wanted.includes(m)),
    )
  }

  return {
    ...el,
    children,
    shadowRoot: el.shadowRoot ? node(el.shadowRoot) : null,
    firstElementChild: children[0] ?? null,
    querySelectorAll,
    querySelector: (sel) => querySelectorAll(sel)[0] ?? null,
  }
}

function installDom(opts: { launchScreen?: boolean; root?: FakeEl | null }) {
  const root = opts.root ? node(opts.root) : null
  const globals = globalThis as unknown as {
    document: unknown
    window: unknown
  }
  globals.document = {
    getElementById: (id: string) =>
      id === 'ha-launch-screen' && opts.launchScreen ? {} : null,
    querySelector: (sel: string) => (sel === 'home-assistant' ? root : null),
  }
  globals.window = {
    getComputedStyle: (el: FakeNode) =>
      el.hidden
        ? { display: 'none', visibility: 'hidden' }
        : { display: 'block', visibility: 'visible' },
  }
}

/** home-assistant tree with the given panel mounted in partial-panel-resolver. */
function haWith(panel: FakeEl | null): FakeEl {
  return {
    tagName: 'HOME-ASSISTANT',
    shadowRoot: {
      tagName: '#shadow',
      children: [
        {
          tagName: 'HOME-ASSISTANT-MAIN',
          matches: ['home-assistant-main'],
          shadowRoot: {
            tagName: '#shadow',
            children: [
              {
                tagName: 'PARTIAL-PANEL-RESOLVER',
                matches: ['partial-panel-resolver'],
                children: panel ? [panel] : [],
              },
            ],
          },
        },
      ],
    },
  }
}

/** A loaded lovelace panel containing the given cards. */
function lovelaceWith(cards: FakeEl[]): FakeEl {
  return haWith({
    tagName: 'HA-PANEL-LOVELACE',
    _panelState: 'loaded',
    children: cards,
  })
}

/** A loaded lovelace panel whose view declares cards but has rendered some. */
function viewWith(declared: number, rendered: number): FakeEl {
  return lovelaceWith([
    {
      tagName: 'HUI-VIEW',
      _cards: Array.from({ length: declared }, () => ({})),
      children: Array.from({ length: rendered }, () => ({
        tagName: 'HUI-CARD',
      })),
    },
  ])
}

const SPINNER: FakeEl = {
  tagName: 'HA-CIRCULAR-PROGRESS',
  matches: ['ha-circular-progress'],
}

// =============================================================================
// isPageReadyForCapture
// =============================================================================

describe('isPageReadyForCapture', () => {
  const selectors =
    'ha-circular-progress, hass-loading-screen, .loading, .spinner, [loading], hui-card-preview'

  const ready = (): boolean => isPageReadyForCapture(selectors)

  it('captures a page that has no home-assistant element', () => {
    installDom({ root: null })

    expect(ready()).toBe(true)
  })

  describe('start up', () => {
    it('waits while the launch screen is up', () => {
      installDom({ launchScreen: true, root: lovelaceWith([]) })

      expect(ready()).toBe(false)
    })

    it('waits after the launch screen goes but before a panel mounts', () => {
      installDom({ root: haWith(null) })

      expect(ready()).toBe(false)
    })

    it('waits while the lovelace panel reports itself loading', () => {
      installDom({
        root: haWith({ tagName: 'HA-PANEL-LOVELACE', _panelState: 'loading' }),
      })

      expect(ready()).toBe(false)
    })

    it('captures panels that report no load state', () => {
      installDom({ root: haWith({ tagName: 'HA-PANEL-HISTORY' }) })

      expect(ready()).toBe(true)
    })
  })

  describe('loading indicators', () => {
    it('waits while one is visible', () => {
      installDom({ root: lovelaceWith([SPINNER]) })

      expect(ready()).toBe(false)
    })

    it('captures when the only one is hidden', () => {
      installDom({ root: lovelaceWith([{ ...SPINNER, hidden: true }]) })

      expect(ready()).toBe(true)
    })
  })

  describe('cards a view has yet to render', () => {
    it('waits while any are outstanding', () => {
      installDom({ root: viewWith(3, 0) })

      expect(ready()).toBe(false)
    })

    it('captures once all are rendered', () => {
      installDom({ root: viewWith(2, 2) })

      expect(ready()).toBe(true)
    })

    it('captures a dashboard that declares none', () => {
      installDom({ root: viewWith(0, 0) })

      expect(ready()).toBe(true)
    })
  })

  describe('energy cards', () => {
    it('waits on one holding no data', () => {
      installDom({
        root: lovelaceWith([
          { tagName: 'HUI-ENERGY-SOURCES-TABLE-CARD', _data: undefined },
        ]),
      })

      expect(ready()).toBe(false)
    })

    it('captures once it has data', () => {
      installDom({
        root: lovelaceWith([
          { tagName: 'HUI-ENERGY-SOURCES-TABLE-CARD', _data: { stats: [] } },
        ]),
      })

      expect(ready()).toBe(true)
    })

    it('waits on a usage graph holding no series', () => {
      installDom({
        root: lovelaceWith([
          { tagName: 'HUI-ENERGY-USAGE-GRAPH-CARD', _chartData: [] },
        ]),
      })

      expect(ready()).toBe(false)
    })

    it('captures once the usage graph has its series', () => {
      installDom({
        root: lovelaceWith([
          { tagName: 'HUI-ENERGY-USAGE-GRAPH-CARD', _chartData: [{}, {}] },
        ]),
      })

      expect(ready()).toBe(true)
    })

    it('captures alongside energy elements that hold neither', () => {
      installDom({
        root: lovelaceWith([
          { tagName: 'HUI-ENERGY-DATE-SELECTION-CARD' },
          { tagName: 'HUI-ENERGY-PERIOD-SELECTOR' },
        ]),
      })

      expect(ready()).toBe(true)
    })
  })
})

// =============================================================================
// readinessInternalsPresent
// =============================================================================

describe('readinessInternalsPresent', () => {
  it('passes a page that has no home-assistant element', () => {
    installDom({ root: null })

    expect(readinessInternalsPresent()).toBe(true)
  })

  it('passes a panel that never carried these fields', () => {
    installDom({ root: haWith({ tagName: 'HA-PANEL-HISTORY' }) })

    expect(readinessInternalsPresent()).toBe(true)
  })

  it('passes lovelace while both fields are there', () => {
    installDom({ root: viewWith(0, 0) })

    expect(readinessInternalsPresent()).toBe(true)
  })

  it('fails when the lovelace panel drops its load state', () => {
    installDom({
      root: haWith({
        tagName: 'HA-PANEL-LOVELACE',
        children: [{ tagName: 'HUI-VIEW', _cards: [] }],
      }),
    })

    expect(readinessInternalsPresent()).toBe(false)
  })

  it('fails when no view declares its cards', () => {
    installDom({ root: lovelaceWith([{ tagName: 'HUI-VIEW' }]) })

    expect(readinessInternalsPresent()).toBe(false)
  })
})
