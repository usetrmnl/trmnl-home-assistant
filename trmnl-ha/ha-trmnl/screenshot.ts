/**
 * Browser Automation Module for Home Assistant Screenshot Capture
 *
 * Manages Puppeteer browser lifecycle and screenshot capture with aggressive optimization.
 * Implements caching, smart waiting, and error classification for robust automation.
 *
 * Performance Optimizations:
 * - Navigation caching: Skip navigation if same path requested
 * - Theme caching: Skip theme updates if same theme/dark mode requested
 * - Language caching: Skip language updates if same lang requested
 * - Puppeteer args: 40+ flags to disable unused features and reduce memory
 *
 * NOTE: Browser class is stateful - single instance per app (owned by main.js).
 * NOTE: When modifying cache logic, ensure state is reset on errors (stale cache = bugs).
 *
 * @module screenshot
 */

import puppeteer from 'puppeteer'
import type { Browser as PuppeteerBrowser, Page, Viewport } from 'puppeteer'
import {
  debugLogging,
  isAddOn,
  chromiumExecutable,
  HEADER_HEIGHT,
  ignoreSslErrors,
} from './const.js'
import {
  CannotOpenPageError,
  BrowserCrashError,
  PageCorruptedError,
} from './error.js'
import { processImage } from './lib/dithering.js'
import {
  NavigateToPage,
  WaitForPageStable,
  type AuthStorage,
} from './lib/browser/navigation-commands.js'
import { getPageSetupStrategy } from './lib/browser/page-setup-strategies.js'
import type {
  ScreenshotResult,
  CropRegion,
  ImageFormat,
  RotationAngle,
  DitheringConfig,
} from './types/domain.js'
import { screenshotLogger, browserLogger } from './lib/logger.js'

const log = screenshotLogger()
const browserLog = browserLogger()

// =============================================================================
// BROWSER CONFIGURATION
// =============================================================================

/**
 * Default localStorage values for Home Assistant UI customization.
 */
const HASS_LOCAL_STORAGE_DEFAULTS: AuthStorage = {
  dockedSidebar: `"always_hidden"`,
  selectedTheme: `{"dark": false}`,
}

/**
 * Puppeteer launch arguments optimized for headless screenshot capture.
 */
const PUPPETEER_ARGS: string[] = [
  // Disable unnecessary background processes
  '--autoplay-policy=user-gesture-required',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-hang-monitor',
  '--disable-renderer-backgrounding',

  // Disable security features (safe in headless context)
  '--disable-client-side-phishing-detection',
  '--disable-setuid-sandbox',
  '--no-sandbox',
  '--no-zygote',

  // Disable unneeded features
  '--disable-dev-shm-usage',
  '--disable-domain-reliability',
  '--disable-features=AudioServiceOutOfProcess',
  '--disable-ipc-flooding-protection',
  '--disable-notifications',
  '--disable-offer-store-unmasked-wallet-cards',
  '--disable-popup-blocking',
  '--disable-print-preview',
  '--disable-prompt-on-repost',
  '--disable-speech-api',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-first-run',
  '--no-pings',

  // UI optimizations
  '--hide-scrollbars',
  '--ignore-gpu-blacklist',
  '--use-gl=swiftshader',

  // Credential handling
  '--password-store=basic',
  '--use-mock-keychain',

  // GPU and rendering optimizations
  '--disable-gpu',
  '--disable-accelerated-2d-canvas',
  '--disable-software-rasterizer',

  // Memory and cache optimizations
  '--disable-application-cache',
  '--disable-cache',
  '--disk-cache-size=1',
  '--media-cache-size=1',

  // Process isolation optimizations
  '--disable-features=IsolateOrigins,site-per-process',
  '--single-process',

  // Add low-end device mode for resource-constrained environments
  ...(isAddOn ? ['--enable-low-end-device-mode'] : []),

  // SSL certificate handling (allows self-signed certs for local HA instances)
  // Controlled via ignore_ssl_errors option in add-on configuration
  ...(ignoreSslErrors ? ['--ignore-certificate-errors'] : []),
]

// =============================================================================
// TYPES
// =============================================================================

/** Navigation parameters for navigatePage() */
export interface NavigateParams {
  pagePath: string
  /** Full target URL (if provided, overrides pagePath + base URL resolution) */
  targetUrl?: string
  viewport: Viewport
  extraWait?: number
  zoom?: number
  lang?: string
  theme?: string
  dark?: boolean
}

/** Screenshot capture parameters for screenshotPage() */
export interface ScreenshotCaptureParams {
  viewport: Viewport
  zoom?: number
  format?: ImageFormat
  rotate?: RotationAngle
  invert?: boolean
  dithering?: DitheringConfig
  crop?: CropRegion | null
}

/** Navigation result */
interface NavigateResult {
  time: number
}

// =============================================================================
// BROWSER CLASS
// =============================================================================

/**
 * Manages Puppeteer browser lifecycle with caching and error classification.
 */
export class Browser {
  #homeAssistantUrl: string
  #token: string
  #browser: PuppeteerBrowser | undefined
  #page: Page | undefined
  #busy: boolean = false
  #pageErrorDetected: boolean = false

  // Cache last requested values to avoid unnecessary page updates
  #lastRequestedPath: string | undefined
  #lastRequestedLang: string | undefined
  #lastRequestedTheme: string | undefined
  #lastRequestedDarkMode: boolean | undefined

  constructor(homeAssistantUrl: string, token: string) {
    this.#homeAssistantUrl = homeAssistantUrl
    this.#token = token
  }

  get busy(): boolean {
    return this.#busy
  }

  /**
   * Triggers page initialization (for recovery health checks).
   */
  async triggerInit(): Promise<void> {
    await this.#getPage()
  }

  /**
   * Checks if browser is connected.
   */
  isConnected(): boolean {
    return this.#browser?.connected ?? false
  }

  // ===========================================================================
  // BROWSER LIFECYCLE
  // ===========================================================================

  /**
   * Cleans up browser and page resources, resetting all state.
   */
  async cleanup(): Promise<void> {
    if (!this.#browser && !this.#page) return

    // Reset all state
    const page = this.#page
    const browser = this.#browser

    this.#page = undefined
    this.#browser = undefined
    this.#lastRequestedPath = undefined
    this.#lastRequestedLang = undefined
    this.#lastRequestedTheme = undefined
    this.#lastRequestedDarkMode = undefined
    this.#pageErrorDetected = false

    // Close page first, then browser
    try {
      if (page) await page.close()
    } catch (err) {
      browserLog.error`Error closing page during cleanup: ${err}`
    }

    try {
      if (browser) await browser.close()
    } catch (err) {
      browserLog.error`Error closing browser during cleanup: ${err}`
    }

    browserLog.info`Browser closed`
  }

  /**
   * Gets or creates Puppeteer page instance (lazy initialization pattern).
   */
  async #getPage(): Promise<Page> {
    if (this.#page) return this.#page

    browserLog.info`Starting browser`

    try {
      // Launch browser
      const browser = await puppeteer.launch({
        headless: 'shell',
        executablePath: chromiumExecutable,
        args: PUPPETEER_ARGS,
      })

      // Monitor browser process death
      browser.on('disconnected', () => {
        browserLog.error`Browser process disconnected!`
        this.#browser = undefined
        this.#page = undefined
      })

      const page = await browser.newPage()

      // Set up event logging
      this.#setupPageLogging(page)

      this.#browser = browser
      this.#page = page
      return this.#page
    } catch (err) {
      throw new BrowserCrashError(err as Error)
    }
  }

  /**
   * Configures page event handlers for logging and error detection.
   */
  #setupPageLogging(page: Page): void {
    page
      .on('framenavigated', (frame) => {
        browserLog.trace`Frame navigated: ${frame.url()}`
      })
      .on('console', (message) => {
        browserLog.trace`CONSOLE ${message
          .type()
          .slice(0, 3)
          .toUpperCase()} ${message.text()}`
      })
      .on('error', (err) => {
        browserLog.error`Page error: ${err}`
        this.#pageErrorDetected = true
      })
      .on('pageerror', (error) => {
        const message = (error as Error).message || String(error)
        // Filter out localStorage spam from chrome-error pages
        const isChromeErrorPage = page.url().startsWith('chrome-error://')
        const isLocalStorageError = message.includes('localStorage')

        if (isChromeErrorPage && isLocalStorageError) {
          return
        }

        browserLog.warn`Page error: ${message}`
        this.#pageErrorDetected = true
      })
      .on('requestfailed', (request) => {
        browserLog.debug`Request failed: ${
          request.failure()?.errorText
        } ${request.url()}`
      })

    // Verbose response logging in debug mode
    if (debugLogging) {
      page.on('response', (response) => {
        browserLog.trace`Response: ${response.status()} ${response.url()} (cache: ${response.fromCache()})`
      })
    }
  }

  /**
   * Builds Home Assistant authentication localStorage object.
   */
  #buildAuthStorage(): AuthStorage {
    const clientId = new URL('/', this.#homeAssistantUrl).toString()
    const hassUrl = clientId.slice(0, -1) // Remove trailing slash

    return {
      ...HASS_LOCAL_STORAGE_DEFAULTS,
      hassTokens: JSON.stringify({
        access_token: this.#token,
        token_type: 'Bearer',
        expires_in: 1800,
        hassUrl,
        clientId,
        expires: 9999999999999,
        refresh_token: '',
      }),
    }
  }

  // ===========================================================================
  // MAIN PUBLIC METHODS
  // ===========================================================================

  /**
   * Navigates to page and applies configuration (lang, theme, zoom).
   * If targetUrl is provided, navigates directly to that URL (generic mode).
   * Otherwise, resolves pagePath against the configured base URL (HA mode).
   */
  async navigatePage({
    pagePath,
    targetUrl,
    viewport,
    extraWait,
    zoom = 1,
    lang,
    theme,
    dark,
  }: NavigateParams): Promise<NavigateResult> {
    if (this.#busy) throw new Error('Browser is busy')

    const start = Date.now()
    this.#busy = true
    const headerHeight = Math.round(HEADER_HEIGHT * zoom)

    try {
      const page = await this.#getPage()

      // Add header height to viewport (will be clipped in screenshot)
      viewport.height += headerHeight

      // Update viewport if changed
      const curViewport = page.viewport()
      if (
        !curViewport ||
        curViewport.width !== viewport.width ||
        curViewport.height !== viewport.height
      ) {
        await page.setViewport(viewport)
      }

      let waitTime = 0
      const isFirstNavigation = this.#lastRequestedPath === undefined

      // Navigate to page if path changed (or different targetUrl)
      const effectivePath = targetUrl || pagePath
      if (
        this.#lastRequestedPath === undefined ||
        this.#lastRequestedPath !== effectivePath
      ) {
        const authStorage = this.#buildAuthStorage()
        const navigateCmd = new NavigateToPage(
          page,
          authStorage,
          this.#homeAssistantUrl
        )
        const result = await navigateCmd.call(
          pagePath,
          isFirstNavigation,
          targetUrl
        )
        waitTime = result.waitTime
        this.#lastRequestedPath = effectivePath
      }

      // Apply page setup strategy (HA vs Generic have different requirements)
      const isGenericUrl = !!targetUrl
      const setupStrategy = getPageSetupStrategy(isGenericUrl)
      const setupResult = await setupStrategy.setup(page, {
        zoom,
        theme,
        lang,
        dark,
        isFirstNavigation,
        lastTheme: this.#lastRequestedTheme,
        lastLang: this.#lastRequestedLang,
        lastDarkMode: this.#lastRequestedDarkMode,
      })

      waitTime += setupResult.waitTime
      if (setupResult.langChanged) this.#lastRequestedLang = lang
      if (setupResult.themeChanged) {
        this.#lastRequestedTheme = theme
        this.#lastRequestedDarkMode = dark
      }

      // Apply smart wait strategy
      if (extraWait !== undefined && extraWait !== null && extraWait > 0) {
        log.debug`Explicit wait: ${extraWait}ms`
        await new Promise((resolve) => setTimeout(resolve, extraWait))
      } else {
        const maxWait = waitTime > 0 ? waitTime : 3000
        const waitStableCmd = new WaitForPageStable(page, maxWait)
        const actualWait = await waitStableCmd.call()
        log.debug`Smart wait: ${actualWait}ms (max: ${maxWait}ms)`
      }

      return { time: Date.now() - start }
    } catch (err) {
      this.#pageErrorDetected = false

      if (err instanceof BrowserCrashError) throw err
      if (this.#pageErrorDetected) {
        throw new PageCorruptedError(
          `Navigation failed with page errors: ${(err as Error).message}`
        )
      }
      if (err instanceof CannotOpenPageError) throw err

      if (
        (err as Error).message?.includes('Target closed') ||
        (err as Error).message?.includes('Session closed') ||
        (err as Error).message?.includes('Protocol error')
      ) {
        throw new BrowserCrashError(err as Error)
      }

      throw err
    } finally {
      this.#busy = false
    }
  }

  /**
   * Captures screenshot of current page with cropping and image processing.
   */
  async screenshotPage({
    viewport,
    zoom = 1,
    format = 'png',
    rotate,
    invert,
    dithering,
    crop,
  }: ScreenshotCaptureParams): Promise<ScreenshotResult> {
    if (this.#busy) throw new Error('Browser is busy')

    const start = Date.now()
    this.#busy = true
    const headerHeight = Math.round(HEADER_HEIGHT * zoom)

    try {
      const page = await this.#getPage()

      // Determine clip region (with optional crop)
      let clipRegion = {
        x: 0,
        y: headerHeight,
        width: viewport.width,
        height: viewport.height - headerHeight,
      }

      // Apply crop if specified
      if (crop && crop.width > 0 && crop.height > 0) {
        clipRegion = {
          x: crop.x,
          y: headerHeight + crop.y,
          width: crop.width,
          height: crop.height,
        }
      }

      // Capture screenshot as PNG (Puppeteer returns Uint8Array, convert to Buffer)
      const screenshotData = await page.screenshot({
        type: 'png',
        clip: clipRegion,
      })

      // Process image with dithering and format conversion
      const startProcess = Date.now()
      const image = await processImage(Buffer.from(screenshotData), {
        format,
        rotate,
        invert,
        dithering,
      })
      log.debug`Image processing took ${Date.now() - startProcess}ms`

      return { image, time: Date.now() - start }
    } catch (err) {
      this.#lastRequestedPath = undefined

      if (
        (err as Error).message?.includes('Target closed') ||
        (err as Error).message?.includes('Session closed') ||
        (err as Error).message?.includes('Protocol error')
      ) {
        throw new BrowserCrashError(err as Error)
      }

      if (this.#pageErrorDetected) {
        throw new PageCorruptedError(
          `Screenshot failed with page errors: ${(err as Error).message}`
        )
      }

      throw err
    } finally {
      this.#busy = false
    }
  }
}
