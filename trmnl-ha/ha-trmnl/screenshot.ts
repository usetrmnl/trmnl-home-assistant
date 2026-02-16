/**
 * Browser Automation Module for Home Assistant Screenshot Capture
 *
 * Manages Puppeteer browser lifecycle and screenshot capture with aggressive optimization.
 * Uses fresh page per request for clean state and error classification for robust automation.
 *
 * Performance Optimizations:
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
  debugLogging as defaultDebugLogging,
  chromiumExecutable as defaultChromiumExecutable,
} from './const.js'
import {
  CannotOpenPageError,
  BrowserCrashError,
  PageCorruptedError,
} from './error.js'
import { processImage as defaultProcessImage } from './lib/dithering.js'
import {
  NavigateToPage,
  WaitForLoadingComplete,
  DismissToasts,
  WaitForPaintStability,
  WaitForHassReady,
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

  // NOTE: The following were removed to fix stale dashboard rendering (issue #34):
  // --disable-cache, --disk-cache-size=1  → prevented resource caching, no fallback on network hiccups
  // --single-process                      → one stall affects entire browser, less stable long-running
  // --enable-low-end-device-mode          → throttles JS timers/rAF, can stall HA card render cycles
  // --disable-background-networking       → could affect WebSocket keepalive/reconnection
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
  /** Fixed wait time in ms. If omitted, waits for loading indicators to clear. */
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
// INJECTABLE DEPENDENCIES
// =============================================================================

/** Injectable dependencies for testability without global mock.module() */
export interface BrowserDeps {
  launchBrowser: (options: {
    headless: boolean | 'shell'
    executablePath?: string
    args: string[]
    acceptInsecureCerts?: boolean
  }) => Promise<PuppeteerBrowser>
  processImage: typeof defaultProcessImage
  chromiumExecutable: string | undefined
  debugLogging: boolean
}

const defaultDeps: BrowserDeps = {
  launchBrowser: (opts) => puppeteer.launch(opts),
  processImage: defaultProcessImage,
  chromiumExecutable: defaultChromiumExecutable,
  debugLogging: defaultDebugLogging,
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
  #deps: BrowserDeps

  // Cache last requested values to avoid unnecessary page updates
  #lastRequestedLang: string | undefined
  #lastRequestedTheme: string | undefined
  #lastRequestedDarkMode: boolean | undefined

  constructor(
    homeAssistantUrl: string,
    token: string,
    deps: Partial<BrowserDeps> = {},
  ) {
    this.#homeAssistantUrl = homeAssistantUrl
    this.#token = token
    this.#deps = { ...defaultDeps, ...deps }
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
   * Gets or creates Puppeteer page instance.
   * Separates browser launch from page creation to support per-request page recycling.
   */
  async #getPage(): Promise<Page> {
    if (this.#page) return this.#page

    // Launch browser if needed (reused across requests)
    if (!this.#browser) {
      browserLog.info`Starting browser`
      try {
        // NOTE: acceptInsecureCerts allows screenshots of HTTPS pages with:
        // - Self-signed certificates
        // - Internal domains with custom CAs
        // - Let's Encrypt certs when CA store is incomplete in Docker
        const browser = await this.#deps.launchBrowser({
          headless: 'shell',
          executablePath: this.#deps.chromiumExecutable,
          args: PUPPETEER_ARGS,
          acceptInsecureCerts: true,
        })

        // Monitor browser process death
        browser.on('disconnected', () => {
          browserLog.error`Browser process disconnected!`
          this.#browser = undefined
          this.#page = undefined
        })

        this.#browser = browser
      } catch (err) {
        throw new BrowserCrashError(err as Error)
      }
    }

    // Create fresh page
    try {
      const page = await this.#browser.newPage()
      this.#setupPageLogging(page)
      this.#page = page
      return this.#page
    } catch (err) {
      throw new BrowserCrashError(err as Error)
    }
  }

  /**
   * Closes current page while keeping the browser process alive.
   * Resets all page-related state so the next #getPage() creates a fresh context.
   *
   * NOTE: This is the "nuclear" fix for issue #34 (stale dashboard rendering).
   * HA's frontend accumulates stale state (WebSocket connections, LitElement
   * component state, cached renders) in long-lived pages. Creating a fresh page
   * per request eliminates all accumulated state.
   */
  async #closePage(): Promise<void> {
    const page = this.#page
    this.#page = undefined

    this.#lastRequestedLang = undefined
    this.#lastRequestedTheme = undefined
    this.#lastRequestedDarkMode = undefined
    this.#pageErrorDetected = false

    try {
      if (page) await page.close()
    } catch (err) {
      browserLog.debug`Error closing page: ${err}`
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
    if (this.#deps.debugLogging) {
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
    try {
      // Fresh page per request: close existing page to eliminate accumulated
      // stale state (WebSocket connections, cached renders, component state)
      await this.#closePage()

      const page = await this.#getPage()
      await page.setViewport(viewport)

      // Always first navigation on fresh page - injects auth + full page.goto()
      const authStorage = this.#buildAuthStorage()
      const navigateCmd = new NavigateToPage(
        page,
        authStorage,
        this.#homeAssistantUrl,
      )
      await navigateCmd.call(pagePath, targetUrl)

      // Check if we landed on HA login/auth page (indicates invalid token)
      const currentUrl = page.url()
      if (currentUrl.includes('/auth/')) {
        log.error`INVALID ACCESS TOKEN - Redirected to login page: ${currentUrl}`
        log.error`Your Home Assistant access token appears to be invalid or expired`
        log.error`Please generate a new Long-Lived Access Token in your HA profile:`
        log.error`  Profile -> Security -> Long-Lived Access Tokens -> Create Token`
        // Continue anyway - will capture the login page (helps user see the issue)
      }

      // Apply page setup strategy (HA vs Generic have different requirements)
      const isGenericUrl = !!targetUrl
      const setupStrategy = getPageSetupStrategy(isGenericUrl)
      const setupResult = await setupStrategy.setup(page, {
        zoom,
        theme,
        lang,
        dark,
        lastTheme: this.#lastRequestedTheme,
        lastLang: this.#lastRequestedLang,
        lastDarkMode: this.#lastRequestedDarkMode,
      })

      if (setupResult.langChanged) this.#lastRequestedLang = lang
      if (setupResult.themeChanged) {
        this.#lastRequestedTheme = theme
        this.#lastRequestedDarkMode = dark
      }

      // Wait strategy: explicit fixed wait OR multi-stage readiness detection
      // NOTE: page.goto() already uses waitUntil:'networkidle2' so network is settled
      if (extraWait && extraWait > 0) {
        log.debug`Explicit wait: ${extraWait}ms`
        await new Promise((resolve) => setTimeout(resolve, extraWait))
      } else {
        // Stage 1: Wait for network to re-settle after theme/language changes
        // Theme and language changes trigger WebSocket messages and cascading renders
        if (setupResult.themeChanged || setupResult.langChanged) {
          log.debug`Waiting for network idle after page setup changes`
          try {
            await page.waitForNetworkIdle({ idleTime: 500, concurrency: 2 })
          } catch (_err) {
            log.debug`Network idle wait timed out after page setup`
          }
        }

        // Stage 2: Wait for HA entity data to load (HA pages only)
        if (!isGenericUrl) {
          const hassReadyCmd = new WaitForHassReady(page)
          await hassReadyCmd.call()
        }

        // Stage 3: Wait for loading indicators to clear
        const loadingCmd = new WaitForLoadingComplete(page, 15000)
        const loadingWait = await loadingCmd.call()
        log.debug`Loading indicators cleared after ${loadingWait}ms`

        // Stage 4: Dismiss notification toasts (HA pages only)
        if (!isGenericUrl) {
          const dismissCmd = new DismissToasts(page)
          const count = await dismissCmd.call()
          if (count > 0) log.debug`Dismissed ${count} notification toast(s)`
        }

        // Stage 5: Wait for rendering pipeline to flush
        const paintCmd = new WaitForPaintStability(page)
        await paintCmd.call()
      }

      return { time: Date.now() - start }
    } catch (err) {
      this.#pageErrorDetected = false

      if (err instanceof BrowserCrashError) throw err
      if (this.#pageErrorDetected) {
        throw new PageCorruptedError(
          `Navigation failed with page errors: ${(err as Error).message}`,
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
    format = 'png',
    rotate,
    invert,
    dithering,
    crop,
  }: ScreenshotCaptureParams): Promise<ScreenshotResult> {
    if (this.#busy) throw new Error('Browser is busy')

    const start = Date.now()
    this.#busy = true
    try {
      const page = await this.#getPage()

      // Capture screenshot (use crop clip if specified, otherwise full viewport)
      const screenshotData = await page.screenshot({
        type: 'png',
        ...(crop && crop.width > 0 && crop.height > 0 && {
          clip: {
            x: crop.x,
            y: crop.y,
            width: crop.width,
            height: crop.height,
          },
        }),
      })

      // Process image with dithering and format conversion
      const startProcess = Date.now()
      const image = await this.#deps.processImage(Buffer.from(screenshotData), {
        format,
        rotate,
        invert,
        dithering,
      })
      log.debug`Image processing took ${Date.now() - startProcess}ms`

      return { image, time: Date.now() - start }
    } catch (err) {
      if (
        (err as Error).message?.includes('Target closed') ||
        (err as Error).message?.includes('Session closed') ||
        (err as Error).message?.includes('Protocol error')
      ) {
        throw new BrowserCrashError(err as Error)
      }

      if (this.#pageErrorDetected) {
        throw new PageCorruptedError(
          `Screenshot failed with page errors: ${(err as Error).message}`,
        )
      }

      throw err
    } finally {
      this.#busy = false
    }
  }
}
