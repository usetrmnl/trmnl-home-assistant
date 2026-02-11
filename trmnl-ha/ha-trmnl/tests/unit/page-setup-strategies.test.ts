/**
 * Unit tests for Page Setup Strategies
 *
 * Tests HAPageSetup and GenericPageSetup strategy implementations.
 *
 * @module tests/unit/page-setup-strategies
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test'
import {
  HAPageSetup,
  GenericPageSetup,
  getPageSetupStrategy,
  type PageSetupOptions,
} from '../../lib/browser/page-setup-strategies.js'

/** Creates a mock Page object with configurable behavior */
function createMockPage(options: { hasHAElements?: boolean } = {}) {
  const evaluateCalls: { fn: unknown; args: unknown[] }[] = []
  const waitForFunctionCalls: { fn: unknown; options: unknown }[] = []

  return {
    evaluateCalls,
    waitForFunctionCalls,
    evaluate: mock(async (fn: unknown, ...args: unknown[]) => {
      evaluateCalls.push({ fn, args })
      return undefined
    }),
    waitForFunction: mock(async (fn: unknown, fnOptions: unknown) => {
      waitForFunctionCalls.push({ fn, options: fnOptions })
      // Simulate HA elements check - resolve if hasHAElements, timeout otherwise
      if (!options.hasHAElements) {
        throw new Error('Timeout')
      }
    }),
  }
}

/** Default options for testing */
function defaultOptions(
  overrides: Partial<PageSetupOptions> = {},
): PageSetupOptions {
  return {
    zoom: 1,
    theme: undefined,
    lang: undefined,
    dark: undefined,
    lastTheme: undefined,
    lastLang: undefined,
    lastDarkMode: undefined,
    ...overrides,
  }
}

describe('Page Setup Strategies', () => {
  // ==========================================================================
  // getPageSetupStrategy() - Factory function
  // ==========================================================================

  describe('getPageSetupStrategy', () => {
    it('returns GenericPageSetup for generic URLs', () => {
      const strategy = getPageSetupStrategy(true)

      expect(strategy).toBeInstanceOf(GenericPageSetup)
    })

    it('returns HAPageSetup for HA URLs', () => {
      const strategy = getPageSetupStrategy(false)

      expect(strategy).toBeInstanceOf(HAPageSetup)
    })
  })

  // ==========================================================================
  // GenericPageSetup - Minimal setup for non-HA pages
  // ==========================================================================

  describe('GenericPageSetup', () => {
    let strategy: GenericPageSetup
    let mockPage: ReturnType<typeof createMockPage>

    beforeEach(() => {
      strategy = new GenericPageSetup()
      mockPage = createMockPage()
    })

    it('sets zoom via CSS', async () => {
      await strategy.setup(mockPage as never, defaultOptions({ zoom: 1.5 }))

      expect(mockPage.evaluate).toHaveBeenCalled()
      expect(mockPage.evaluateCalls.length).toBe(1)
      expect(mockPage.evaluateCalls[0]!.args[0]).toBe(1.5)
    })

    it('returns zero waitTime', async () => {
      const result = await strategy.setup(mockPage as never, defaultOptions())

      expect(result.waitTime).toBe(0)
    })

    it('returns themeChanged as false', async () => {
      const result = await strategy.setup(
        mockPage as never,
        defaultOptions({ theme: 'dark' }),
      )

      expect(result.themeChanged).toBe(false)
    })

    it('returns langChanged as false', async () => {
      const result = await strategy.setup(
        mockPage as never,
        defaultOptions({ lang: 'en' }),
      )

      expect(result.langChanged).toBe(false)
    })

    it('does not call waitForFunction (no HA shadow DOM checks)', async () => {
      await strategy.setup(mockPage as never, defaultOptions())

      expect(mockPage.waitForFunction).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // HAPageSetup - Full setup for Home Assistant pages
  // ==========================================================================

  describe('HAPageSetup', () => {
    let strategy: HAPageSetup
    let mockPage: ReturnType<typeof createMockPage>

    beforeEach(() => {
      strategy = new HAPageSetup()
      mockPage = createMockPage({ hasHAElements: true })
    })

    describe('zoom handling', () => {
      it('sets zoom via evaluate', async () => {
        await strategy.setup(
          mockPage as never,
          defaultOptions({
            zoom: 2,
          }),
        )

        // First call is WaitForPageLoad's waitForFunction
        // Then evaluate calls for zoom and possibly others
        const zoomCall = mockPage.evaluateCalls.find(
          (call) => call.args[0] === 2,
        )
        expect(zoomCall).toBeDefined()
      })
    })

    describe('theme changes', () => {
      it('returns themeChanged true when theme differs from last', async () => {
        const result = await strategy.setup(
          mockPage as never,
          defaultOptions({
            theme: 'dark',
            lastTheme: 'light',
          }),
        )

        expect(result.themeChanged).toBe(true)
      })

      it('returns themeChanged true when dark mode differs', async () => {
        const result = await strategy.setup(
          mockPage as never,
          defaultOptions({
            dark: true,
            lastDarkMode: false,
          }),
        )

        expect(result.themeChanged).toBe(true)
      })

      it('returns themeChanged false when theme unchanged', async () => {
        const result = await strategy.setup(
          mockPage as never,
          defaultOptions({
            theme: 'dark',
            lastTheme: 'dark',
            dark: true,
            lastDarkMode: true,
          }),
        )

        expect(result.themeChanged).toBe(false)
      })

      it('adds waitTime when theme changes', async () => {
        const result = await strategy.setup(
          mockPage as never,
          defaultOptions({
            theme: 'new-theme',
            lastTheme: 'old-theme',
          }),
        )

        expect(result.waitTime).toBeGreaterThanOrEqual(500)
      })
    })

    describe('language changes', () => {
      it('returns langChanged true when language differs', async () => {
        const result = await strategy.setup(
          mockPage as never,
          defaultOptions({
            lang: 'fr',
            lastLang: 'en',
          }),
        )

        expect(result.langChanged).toBe(true)
      })

      it('returns langChanged false when language unchanged', async () => {
        const result = await strategy.setup(
          mockPage as never,
          defaultOptions({
            lang: 'en',
            lastLang: 'en',
          }),
        )

        expect(result.langChanged).toBe(false)
      })

      it('adds waitTime when language changes', async () => {
        const result = await strategy.setup(
          mockPage as never,
          defaultOptions({
            lang: 'de',
            lastLang: 'en',
          }),
        )

        expect(result.waitTime).toBeGreaterThanOrEqual(1000)
      })
    })

    describe('shadow DOM wait', () => {
      it('calls waitForFunction to check HA loading state', async () => {
        await strategy.setup(mockPage as never, defaultOptions())

        expect(mockPage.waitForFunction).toHaveBeenCalled()
      })

      it('handles timeout gracefully when HA elements not found', async () => {
        const noHAPage = createMockPage({ hasHAElements: false })

        // Should not throw - timeout is caught internally
        const result = await strategy.setup(noHAPage as never, defaultOptions())

        expect(result).toBeDefined()
      })
    })

    describe('combined waitTime', () => {
      it('accumulates wait time from multiple changes', async () => {
        const result = await strategy.setup(
          mockPage as never,
          defaultOptions({
            theme: 'new-theme',
            lastTheme: 'old-theme',
            lang: 'fr',
            lastLang: 'en',
          }),
        )

        // Theme (500) + Lang (1000) = 1500+
        expect(result.waitTime).toBeGreaterThanOrEqual(1500)
      })
    })
  })

  // ==========================================================================
  // Strategy Pattern Contract
  // ==========================================================================

  describe('Strategy Pattern Contract', () => {
    it('both strategies implement the same interface', async () => {
      const haStrategy = new HAPageSetup()
      const genericStrategy = new GenericPageSetup()
      const mockPage = createMockPage({ hasHAElements: true })
      const options = defaultOptions()

      const haResult = await haStrategy.setup(mockPage as never, options)
      const genericResult = await genericStrategy.setup(
        mockPage as never,
        options,
      )

      // Both return the same result shape
      expect(haResult).toHaveProperty('waitTime')
      expect(haResult).toHaveProperty('themeChanged')
      expect(haResult).toHaveProperty('langChanged')

      expect(genericResult).toHaveProperty('waitTime')
      expect(genericResult).toHaveProperty('themeChanged')
      expect(genericResult).toHaveProperty('langChanged')
    })

    it('strategies can be used interchangeably', async () => {
      const mockPage = createMockPage({ hasHAElements: true })
      const options = defaultOptions({ zoom: 1.5 })

      // Factory returns strategy, caller doesn't care which type
      const strategy1 = getPageSetupStrategy(true) // Generic
      const strategy2 = getPageSetupStrategy(false) // HA

      const result1 = await strategy1.setup(mockPage as never, options)
      const result2 = await strategy2.setup(mockPage as never, options)

      // Both work and return valid results
      expect(typeof result1.waitTime).toBe('number')
      expect(typeof result2.waitTime).toBe('number')
    })
  })
})
