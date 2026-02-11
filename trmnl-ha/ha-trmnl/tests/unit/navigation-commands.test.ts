/**
 * Unit tests for NavigateToPage
 *
 * Verifies auth injection behavior and navigation strategies
 * (full reload vs client-side routing).
 *
 * @module tests/unit/navigation-commands
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  NavigateToPage,
  type AuthStorage,
} from '../../lib/browser/navigation-commands.js'
import type { Page } from 'puppeteer'

/** Tracks which Page methods were called */
interface MockPageCalls {
  evaluateOnNewDocument: number
  removeScriptToEvaluateOnNewDocument: number
  goto: string[]
  reload: number
  evaluate: number
}

/** Creates a mock Puppeteer Page that tracks method calls */
function createMockPage(
  currentUrl = 'about:blank',
): Page & { calls: MockPageCalls } {
  const calls: MockPageCalls = {
    evaluateOnNewDocument: 0,
    removeScriptToEvaluateOnNewDocument: 0,
    goto: [],
    reload: 0,
    evaluate: 0,
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
    goto: async (url: string) => {
      calls.goto.push(url)
      return { ok: () => true, status: () => 200 }
    },
    reload: async () => {
      calls.reload++
      return { ok: () => true, status: () => 200 }
    },
    evaluate: async () => {
      calls.evaluate++
    },
    url: () => currentUrl,
  } as unknown as Page & { calls: MockPageCalls }
}

const STUB_AUTH: AuthStorage = { hassTokens: '{}' }

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

      await nav.call('/lovelace/0', true)

      expect(mockPage.calls.evaluateOnNewDocument).toBe(1)
    })

    it('injects auth when HTTPS HA URL has explicit port 443', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'https://ha.example.com:443',
      )

      await nav.call('/lovelace/0', true)

      expect(mockPage.calls.evaluateOnNewDocument).toBe(1)
    })

    it('injects auth when HA URL has no explicit port', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant',
      )

      await nav.call('/lovelace/0', true)

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

      await nav.call('/lovelace/0', true)

      expect(mockPage.calls.evaluateOnNewDocument).toBe(1)
    })

    it('injects auth for HTTPS on non-default port', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'https://ha.example.com:8443',
      )

      await nav.call('/lovelace/dashboard', true)

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

      await nav.call('/unused', true, 'http://other-server.com/page')

      expect(mockPage.calls.evaluateOnNewDocument).toBe(0)
    })

    it('skips auth when targetUrl host differs from HA', async () => {
      const nav = new NavigateToPage(
        mockPage,
        STUB_AUTH,
        'http://homeassistant:80',
      )

      await nav.call('/unused', true, 'http://grafana.local:3000/dashboard')

      expect(mockPage.calls.evaluateOnNewDocument).toBe(0)
    })
  })

  // ==========================================================================
  // Subsequent navigation: client-side panel remount for fresh content (Issue #34)
  // ==========================================================================

  describe('subsequent navigation to same HA path', () => {
    it('uses client-side panel remount for same HA path (no full reload)', async () => {
      const page = createMockPage('http://homeassistant:8123/lovelace/kitchen')
      const nav = new NavigateToPage(
        page,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/lovelace/kitchen', false)

      // NOTE: Uses evaluate (client-side navigate-away-and-back) instead of
      // page.reload(). This forces HA to remount the lovelace panel and clear
      // stale card states without tearing down the entire frontend.
      expect(page.calls.reload).toBe(0)
      expect(page.calls.evaluate).toBe(1)
      expect(page.calls.goto).toEqual([])
    })

    it('uses client-side navigation for a different HA path', async () => {
      const page = createMockPage('http://homeassistant:8123/lovelace/kitchen')
      const nav = new NavigateToPage(
        page,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/lovelace/living-room', false)

      expect(page.calls.reload).toBe(0)
      expect(page.calls.evaluate).toBe(1)
      expect(page.calls.goto).toEqual([])
    })

    it('uses page.goto for generic targetUrl on subsequent navigation', async () => {
      const page = createMockPage('http://homeassistant:8123/lovelace/kitchen')
      const nav = new NavigateToPage(
        page,
        STUB_AUTH,
        'http://homeassistant:8123',
      )

      await nav.call('/unused', false, 'http://grafana.local:3000/dashboard')

      expect(page.calls.reload).toBe(0)
      expect(page.calls.evaluate).toBe(0)
      expect(page.calls.goto).toEqual(['http://grafana.local:3000/dashboard'])
    })
  })
})
