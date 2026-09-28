/**
 * Page setup strategies for different URL types (HA vs Generic).
 *
 * Uses Strategy pattern to cleanly separate HA-specific page setup
 * (shadow DOM waits, theme, language) from generic URL setup.
 *
 * @module browser/page-setup-strategies
 */

import type { Page } from 'puppeteer-core'
import {
  WaitForPageLoad,
  UpdateLanguage,
  UpdateTheme,
} from './navigation-commands.js'

/** Options for page setup after navigation */
export interface PageSetupOptions {
  zoom: number
  theme?: string
  lang?: string
  dark?: boolean
  lastTheme?: string
  lastLang?: string
  lastDarkMode?: boolean
}

/** Result from page setup */
export interface PageSetupResult {
  waitTime: number
  themeChanged: boolean
  langChanged: boolean
}

/**
 * Strategy interface for page setup operations.
 */
export interface PageSetupStrategy {
  setup(page: Page, options: PageSetupOptions): Promise<PageSetupResult>
}

/**
 * Home Assistant page setup strategy.
 *
 * Handles HA-specific operations:
 * - Wait for shadow DOM loading flags
 * - Dismiss notification toasts
 * - Update language settings
 * - Update theme/dark mode
 */
export class HAPageSetup implements PageSetupStrategy {
  async setup(page: Page, options: PageSetupOptions): Promise<PageSetupResult> {
    const { zoom, theme, lang, dark, lastTheme, lastLang, lastDarkMode } = options
    let waitTime = 0
    let themeChanged = false
    let langChanged = false

    // Wait for HA shadow DOM to finish loading
    const waitLoadCmd = new WaitForPageLoad(page)
    await waitLoadCmd.call()

    // Set zoom
    await page.evaluate((zoomLevel: number) => {
      document.body.style.zoom = String(zoomLevel)
    }, zoom)

    // Headless Chromium's locale is always en-US, so HA's "system" formats
    // would show 12-hour clocks and US decimals whatever the user's language (#122)
    await page.evaluate(() => {
      type SelectFormat = (format: string, persist: boolean) => void
      const haEl = document.querySelector('home-assistant') as
        | (Element & {
            hass?: { locale?: { time_format?: string; number_format?: string; date_format?: string } }
            _selectTimeFormat?: SelectFormat
            _selectNumberFormat?: SelectFormat
            _selectDateFormat?: SelectFormat
          })
        | null
      const locale = haEl?.hass?.locale
      if (!haEl || !locale) return
      if (locale.time_format === 'system') haEl._selectTimeFormat?.('language', false)
      if (locale.number_format === 'system') haEl._selectNumberFormat?.('language', false)
      if (locale.date_format === 'system') haEl._selectDateFormat?.('language', false)
    })

    // Update language if changed
    if (lang !== lastLang) {
      const langCmd = new UpdateLanguage(page)
      await langCmd.call(lang || '')
      langChanged = true
      waitTime += 1000
    }

    // Normalize dark to boolean before comparing: the parser emits false
    // for an absent ?dark while a fresh page resets lastDarkMode to
    // undefined. Treating those as different re-applies the default theme
    // and pays its settle wait on every capture.
    if (theme !== lastTheme || (dark ?? false) !== (lastDarkMode ?? false)) {
      const themeCmd = new UpdateTheme(page)
      await themeCmd.call(theme || '', dark || false)
      themeChanged = true
      waitTime += 500
    }

    return { waitTime, themeChanged, langChanged }
  }
}

/**
 * Generic URL page setup strategy.
 *
 * Minimal setup for non-HA pages:
 * - Just set zoom level via CSS
 * - No shadow DOM waits, no HA-specific features
 */
export class GenericPageSetup implements PageSetupStrategy {
  async setup(page: Page, options: PageSetupOptions): Promise<PageSetupResult> {
    const { zoom } = options

    // Just set zoom via CSS - no HA-specific operations
    await page.evaluate((zoomLevel: number) => {
      document.body.style.zoom = String(zoomLevel)
    }, zoom)

    return { waitTime: 0, themeChanged: false, langChanged: false }
  }
}

/**
 * Factory to get the appropriate page setup strategy.
 */
export function getPageSetupStrategy(isGenericUrl: boolean): PageSetupStrategy {
  return isGenericUrl ? new GenericPageSetup() : new HAPageSetup()
}
