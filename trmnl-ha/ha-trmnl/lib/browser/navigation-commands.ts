/**
 * Browser Navigation Commands - Home Assistant Page Automation
 *
 * Encapsulates all browser navigation and page manipulation operations for Home Assistant.
 * Uses Command Pattern - each class is a single-purpose command with .call() method.
 *
 * @module lib/browser/navigation-commands
 */

import type { Page } from 'puppeteer'
import {
  isAddOn,
  DEFAULT_WAIT_TIME,
  COLD_START_EXTRA_WAIT,
} from '../../const.js'
import { CannotOpenPageError } from '../../error.js'
import type { NavigationResult } from '../../types/domain.js'
import { navigationLogger } from '../logger.js'

const log = navigationLogger()

/** Auth storage for localStorage injection */
export type AuthStorage = Record<string, string>

/**
 * Navigates to pages with optional Home Assistant authentication injection.
 *
 * Supports two modes:
 * 1. HA Mode: Resolves pagePath against base URL, injects HA auth tokens
 * 2. Generic Mode: Uses targetUrl directly, skips auth injection
 *
 * Navigation Strategies:
 * 1. First Navigation: Injects auth tokens via evaluateOnNewDocument(), then page.goto()
 * 2. Subsequent Navigation: Uses client-side router (real HA) or page.goto() (mock/generic)
 */
export class NavigateToPage {
  #page: Page
  #authStorage: AuthStorage
  #homeAssistantUrl: string

  constructor(page: Page, authStorage: AuthStorage, homeAssistantUrl: string) {
    this.#page = page
    this.#authStorage = authStorage
    // NOTE: Normalize URL to strip default ports (80/http, 443/https)
    // so startsWith checks match URLs resolved by the URL class
    this.#homeAssistantUrl = new URL(homeAssistantUrl).origin
  }

  /**
   * Navigates to specified page.
   *
   * @param pagePath - Page path relative to HA base (e.g., "/lovelace/kitchen")
   * @param isFirstNavigation - True for first navigation (inject auth if applicable)
   * @param targetUrl - Full URL to navigate to (overrides pagePath resolution)
   * @returns Recommended wait time in milliseconds
   * @throws CannotOpenPageError If navigation fails
   */
  async call(
    pagePath: string,
    isFirstNavigation: boolean = false,
    targetUrl?: string,
  ): Promise<NavigationResult> {
    if (isFirstNavigation) {
      return this.#firstNavigation(pagePath, targetUrl)
    } else {
      return this.#subsequentNavigation(pagePath, targetUrl)
    }
  }

  /**
   * Determines if HA auth should be injected for a given URL.
   * Only inject auth when navigating to the configured HA instance.
   */
  #shouldInjectAuth(pageUrl: string): boolean {
    return pageUrl.startsWith(this.#homeAssistantUrl)
  }

  async #firstNavigation(
    pagePath: string,
    targetUrl?: string,
  ): Promise<NavigationResult> {
    // Resolve the final URL: use targetUrl if provided, otherwise resolve against HA base
    const pageUrl =
      targetUrl || new URL(pagePath, this.#homeAssistantUrl).toString()
    const injectAuth = this.#shouldInjectAuth(pageUrl)

    log.info`Navigating to: ${pageUrl} (HA auth: ${injectAuth ? 'yes' : 'no'})`

    let evaluateId: { identifier: string } | undefined

    // Only inject HA auth when navigating to the configured HA instance
    if (injectAuth) {
      evaluateId = await this.#page.evaluateOnNewDocument(
        (storage: AuthStorage) => {
          for (const [key, value] of Object.entries(storage)) {
            localStorage.setItem(key, value)
          }
        },
        this.#authStorage,
      )
    }

    let response
    try {
      response = await this.#page.goto(pageUrl)
    } catch (err) {
      if (evaluateId) {
        this.#page.removeScriptToEvaluateOnNewDocument(evaluateId.identifier)
      }
      throw new CannotOpenPageError(0, pageUrl, (err as Error).message)
    }

    if (!response?.ok()) {
      if (evaluateId) {
        this.#page.removeScriptToEvaluateOnNewDocument(evaluateId.identifier)
      }
      throw new CannotOpenPageError(response?.status() ?? 0, pageUrl)
    }

    if (evaluateId) {
      this.#page.removeScriptToEvaluateOnNewDocument(evaluateId.identifier)
    }

    return {
      waitTime: DEFAULT_WAIT_TIME + (isAddOn ? COLD_START_EXTRA_WAIT : 0),
    }
  }

  async #subsequentNavigation(
    pagePath: string,
    targetUrl?: string,
  ): Promise<NavigationResult> {
    const isGenericUrl = !!targetUrl
    const isCurrentlyOnHA = this.#page.url().startsWith(this.#homeAssistantUrl)

    // Use page.goto() for generic URLs or when not currently on HA
    // Use client-side navigation only when already on HA (faster, preserves state)
    if (isGenericUrl || !isCurrentlyOnHA) {
      const pageUrl =
        targetUrl || new URL(pagePath, this.#homeAssistantUrl).toString()
      log.info`Navigating to: ${pageUrl} (mode: ${
        isGenericUrl ? 'generic' : 'full-reload'
      })`

      let response
      try {
        response = await this.#page.goto(pageUrl)
      } catch (err) {
        throw new CannotOpenPageError(0, pageUrl, (err as Error).message)
      }

      if (!response?.ok()) {
        throw new CannotOpenPageError(response?.status() ?? 0, pageUrl)
      }
    } else {
      const currentPath = new URL(this.#page.url()).pathname
      const haUrl = new URL(pagePath, this.#homeAssistantUrl).toString()

      if (currentPath === pagePath) {
        log.info`Navigating to: ${haUrl} (mode: HA panel remount, same path)`
        await this.#page.evaluate((path: string) => {
          const fire = (p: string) => {
            history.replaceState(null, '', p)
            const event = new Event('location-changed') as Event & {
              detail?: { replace: boolean }
            }
            event.detail = { replace: true }
            window.dispatchEvent(event)
          }
          // Navigate away to force panel unmount, then back to target
          fire('/')
          fire(path)
        }, pagePath)
      } else {
        log.info`Navigating to: ${haUrl} (mode: HA client-side)`
        await this.#page.evaluate((path: string) => {
          const state = history.state as { root?: boolean } | null
          history.replaceState(state?.root ? { root: true } : null, '', path)
          const event = new Event('location-changed') as Event & {
            detail?: { replace: boolean }
          }
          event.detail = { replace: true }
          window.dispatchEvent(event)
        }, pagePath)
      }
    }

    return { waitTime: DEFAULT_WAIT_TIME }
  }
}

/**
 * Waits for Home Assistant page to finish loading by checking shadow DOM loading flags.
 */
export class WaitForPageLoad {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  async call(): Promise<void> {
    try {
      await this.#page.waitForFunction(
        () => {
          const haEl = document.querySelector('home-assistant')
          if (!haEl) return false

          const mainEl = (
            haEl as Element & { shadowRoot: ShadowRoot | null }
          ).shadowRoot?.querySelector('home-assistant-main')
          if (!mainEl) return false

          const panelResolver = (
            mainEl as Element & { shadowRoot: ShadowRoot | null }
          ).shadowRoot?.querySelector('partial-panel-resolver') as
            | (Element & { _loading?: boolean })
            | null
          if (!panelResolver || panelResolver._loading) return false

          const panel = panelResolver.children[0] as
            | (Element & { _loading?: boolean })
            | undefined
          if (!panel) return false

          return !('_loading' in panel) || !panel._loading
        },
        { timeout: 3000, polling: 100 },
      )
    } catch (_err) {
      log.debug`Timeout waiting for HA to finish loading`
    }
  }
}

/** Page stability metrics */
interface StabilityMetrics {
  height: number
  contentHash: number
}

/**
 * Smart wait strategy that detects when page content stops changing.
 */
export class WaitForPageStable {
  #page: Page
  #timeout: number

  constructor(page: Page, timeout: number = 5000) {
    this.#page = page
    this.#timeout = timeout
  }

  /**
   * Waits for content stabilization or timeout.
   * @returns Actual wait time in milliseconds
   */
  async call(): Promise<number> {
    const start = Date.now()
    let lastHeight = 0
    let lastContent = 0
    let stableChecks = 0
    const requiredStableChecks = 3

    while (Date.now() - start < this.#timeout) {
      const metrics = await this.#page.evaluate((): StabilityMetrics => {
        const haEl = document.querySelector('home-assistant')
        if (!haEl) return { height: 0, contentHash: 0 }

        return {
          height: document.body.scrollHeight,
          contentHash: haEl.shadowRoot?.innerHTML?.length || 0,
        }
      })

      if (
        metrics.height === lastHeight &&
        metrics.contentHash === lastContent
      ) {
        stableChecks++
        if (stableChecks >= requiredStableChecks) {
          const actualWait = Date.now() - start
          log.debug`Page stable after ${actualWait}ms (${stableChecks} checks)`
          return actualWait
        }
      } else {
        stableChecks = 0
      }

      lastHeight = metrics.height
      lastContent = metrics.contentHash

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const actualWait = Date.now() - start
    log.debug`Page stability timeout after ${actualWait}ms`
    return actualWait
  }
}

/**
 * Waits for network activity to settle (no pending requests).
 *
 * Tracks XHR/Fetch requests and waits until no requests are in-flight
 * for a specified quiet period. This catches async data loading from widgets.
 */
export class WaitForNetworkIdle {
  #page: Page
  #timeout: number
  #idleTime: number

  constructor(page: Page, timeout: number = 10000, idleTime: number = 500) {
    this.#page = page
    this.#timeout = timeout
    this.#idleTime = idleTime
  }

  /**
   * Waits for network to be idle or timeout.
   * @returns Actual wait time in milliseconds
   */
  async call(): Promise<number> {
    const start = Date.now()

    try {
      // Use CDP to monitor network activity
      const client = await this.#page.createCDPSession()
      await client.send('Network.enable')

      let pendingRequests = 0
      let lastActivityTime = Date.now()

      const onRequestWillBeSent = () => {
        pendingRequests++
        lastActivityTime = Date.now()
      }

      const onLoadingFinished = () => {
        pendingRequests = Math.max(0, pendingRequests - 1)
        lastActivityTime = Date.now()
      }

      const onLoadingFailed = () => {
        pendingRequests = Math.max(0, pendingRequests - 1)
        lastActivityTime = Date.now()
      }

      client.on('Network.requestWillBeSent', onRequestWillBeSent)
      client.on('Network.loadingFinished', onLoadingFinished)
      client.on('Network.loadingFailed', onLoadingFailed)

      // Wait for network to be idle
      while (Date.now() - start < this.#timeout) {
        const timeSinceLastActivity = Date.now() - lastActivityTime
        const isIdle =
          pendingRequests === 0 && timeSinceLastActivity >= this.#idleTime

        if (isIdle) {
          const actualWait = Date.now() - start
          log.debug`Network idle after ${actualWait}ms`
          await client.detach()
          return actualWait
        }

        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      await client.detach()
      const actualWait = Date.now() - start
      log.debug`Network idle timeout after ${actualWait}ms (${pendingRequests} pending)`
      return actualWait
    } catch (err) {
      // CDP not available or error - fall through gracefully
      log.debug`Network idle detection unavailable: ${(err as Error).message}`
      return Date.now() - start
    }
  }
}

/**
 * Waits for Home Assistant loading indicators to disappear.
 *
 * Detects common HA loading patterns: circular progress spinners,
 * skeleton loaders, and loading placeholders.
 */
export class WaitForLoadingComplete {
  #page: Page
  #timeout: number

  constructor(page: Page, timeout: number = 10000) {
    this.#page = page
    this.#timeout = timeout
  }

  /**
   * Waits for loading indicators to disappear or timeout.
   * @returns Actual wait time in milliseconds
   */
  async call(): Promise<number> {
    const start = Date.now()

    // Common HA loading indicator selectors
    const loadingSelectors = [
      'ha-circular-progress',
      '.loading',
      '.spinner',
      '[loading]',
      'hui-card-preview', // Card preview placeholder
    ].join(', ')

    while (Date.now() - start < this.#timeout) {
      const hasLoadingIndicators = await this.#page.evaluate((selectors) => {
        const haEl = document.querySelector('home-assistant')
        if (!haEl?.shadowRoot) return false

        // Check for loading indicators in shadow DOM
        const checkShadowRoot = (root: ShadowRoot | Document): boolean => {
          const indicators = Array.from(root.querySelectorAll(selectors))
          for (const el of indicators) {
            // Only count visible indicators
            const style = window.getComputedStyle(el)
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              return true
            }
          }

          // Recursively check shadow roots
          const elementsWithShadow = Array.from(root.querySelectorAll('*'))
          for (const el of elementsWithShadow) {
            if ((el as Element & { shadowRoot?: ShadowRoot }).shadowRoot) {
              if (
                checkShadowRoot(
                  (el as Element & { shadowRoot: ShadowRoot }).shadowRoot,
                )
              ) {
                return true
              }
            }
          }

          return false
        }

        return checkShadowRoot(haEl.shadowRoot)
      }, loadingSelectors)

      if (!hasLoadingIndicators) {
        const actualWait = Date.now() - start
        log.debug`Loading indicators cleared after ${actualWait}ms`
        return actualWait
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const actualWait = Date.now() - start
    log.debug`Loading indicator timeout after ${actualWait}ms`
    return actualWait
  }
}

/**
 * Dismisses HA notification toasts and sets browser zoom level.
 */
export class DismissToastsAndSetZoom {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  /**
   * Dismisses toasts and sets zoom.
   * @param zoom - Zoom level (1.0 = 100%)
   * @returns True if toast was dismissed
   */
  async call(zoom: number): Promise<boolean> {
    return this.#page.evaluate((zoomLevel: number) => {
      document.body.style.zoom = String(zoomLevel)

      const haEl = document.querySelector('home-assistant')
      if (!haEl) return false

      const notifyEl = haEl.shadowRoot?.querySelector(
        'notification-manager',
      ) as (Element & { shadowRoot: ShadowRoot | null }) | null
      if (!notifyEl) return false

      const actionEl = notifyEl.shadowRoot?.querySelector(
        'ha-toast *[slot=action]',
      ) as HTMLElement | null
      if (!actionEl) return false

      actionEl.click()
      return true
    }, zoom)
  }
}

/**
 * Updates Home Assistant UI language setting.
 */
export class UpdateLanguage {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  async call(lang: string): Promise<void> {
    await this.#page.evaluate((newLang: string) => {
      const haEl = document.querySelector('home-assistant') as
        | (Element & {
            _selectLanguage?: (lang: string, reload: boolean) => void
          })
        | null
      haEl?._selectLanguage?.(newLang, false)
    }, lang || 'en')
  }
}

/**
 * Updates Home Assistant theme and dark mode settings.
 *
 * NOTE: Since HA 2026.2 (frontend PR #28965), dispatching the 'settheme'
 * event persists the theme to the user's backend profile via WebSocket,
 * changing the theme globally for all sessions. We temporarily intercept
 * the persistence call so the change is visual-only for screenshots.
 *
 * @see https://github.com/usetrmnl/trmnl-home-assistant/issues/31
 * @see https://github.com/home-assistant/frontend/pull/28965
 */
export class UpdateTheme {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  async call(theme: string, dark: boolean): Promise<void> {
    await this.#page.evaluate(
      ({ theme, dark }: { theme: string; dark: boolean }) => {
        interface WsMsg {
          type: string
          [k: string]: unknown
        }
        type SendFn = (msg: WsMsg) => void
        type SendPromiseFn = (msg: WsMsg) => Promise<unknown>
        interface HAConn {
          sendMessage?: SendFn
          sendMessagePromise?: SendPromiseFn
          [k: string]: unknown
        }

        const haEl = document.querySelector('home-assistant') as
          | (Element & { hass?: { connection?: HAConn } })
          | null
        if (!haEl) return

        const conn = haEl.hass?.connection

        // Temporarily block theme persistence to user profile.
        // HA 2026.2+ persists theme via saveThemePreferences() which calls:
        //   conn.sendMessagePromise({ type: "frontend/set_user_data", key: "theme", value })
        // We intercept this specific call so the visual change happens
        // but nothing is saved to the backend.
        const isThemeSave = (msg: WsMsg) =>
          msg.type === 'frontend/set_user_data' && msg['key'] === 'theme'

        let origSendMessage: SendFn | undefined
        let origSendMessagePromise: SendPromiseFn | undefined

        if (conn?.sendMessage) {
          origSendMessage = conn.sendMessage.bind(conn)
          conn.sendMessage = (msg: WsMsg) => {
            if (isThemeSave(msg)) return
            origSendMessage!(msg)
          }
        }

        if (conn?.sendMessagePromise) {
          origSendMessagePromise = conn.sendMessagePromise.bind(conn)
          conn.sendMessagePromise = (msg: WsMsg) => {
            if (isThemeSave(msg)) return Promise.resolve(null)
            return origSendMessagePromise!(msg)
          }
        }

        // Dispatch theme change — HA applies it visually via LitElement reactivity
        haEl.dispatchEvent(
          new CustomEvent('settheme', {
            detail: { theme, dark },
          }),
        )

        // Restore original methods after HA processes the event
        if (conn) {
          setTimeout(() => {
            if (origSendMessage) conn.sendMessage = origSendMessage
            if (origSendMessagePromise)
              conn.sendMessagePromise = origSendMessagePromise
          }, 2000)
        }
      },
      { theme: theme || '', dark },
    )
  }
}
