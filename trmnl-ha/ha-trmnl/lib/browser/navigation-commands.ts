/**
 * Browser Navigation Commands - Home Assistant Page Automation
 *
 * Encapsulates all browser navigation and page manipulation operations for Home Assistant.
 * Uses Command Pattern - each class is a single-purpose command with .call() method.
 *
 * NOTE: With the fresh-page-per-request model (issue #34 fix), every navigation
 * is a full page.goto() with auth injection. Client-side navigation was removed
 * because HA's frontend accumulates stale state in long-lived pages.
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
 * Always uses full page.goto() for maximum reliability.
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
   * Navigates to specified page with full page.goto().
   *
   * @param pagePath - Page path relative to HA base (e.g., "/lovelace/kitchen")
   * @param targetUrl - Full URL to navigate to (overrides pagePath resolution)
   * @returns Recommended wait time in milliseconds
   * @throws CannotOpenPageError If navigation fails
   */
  async call(pagePath: string, targetUrl?: string): Promise<NavigationResult> {
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
      response = await this.#page.goto(pageUrl, { waitUntil: 'networkidle2' })
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

  /**
   * Determines if HA auth should be injected for a given URL.
   * Only inject auth when navigating to the configured HA instance.
   */
  #shouldInjectAuth(pageUrl: string): boolean {
    return pageUrl.startsWith(this.#homeAssistantUrl)
  }
}

/**
 * Waits for Home Assistant page to finish loading by checking panel state.
 *
 * Checks two levels:
 * 1. partial-panel-resolver: must not be in _loading state
 * 2. ha-panel-lovelace: must reach _panelState === "loaded"
 *
 * _panelState is a state machine ("loading" | "loaded" | "error" | "yaml-editor")
 * that only reaches "loaded" after config is fetched AND registries are verified.
 * This is more reliable than _loading alone because it represents the panel's
 * own "I'm done" signal.
 *
 * For non-lovelace panels (e.g. ha-panel-history), falls back to the _loading check.
 *
 * @see frontend/src/panels/lovelace/ha-panel-lovelace.ts
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
            | (Element & {
                _loading?: boolean
                _panelState?: string
              })
            | undefined
          if (!panel) return false

          // Lovelace panels expose _panelState — wait for "loaded"
          if ('_panelState' in panel) {
            return panel._panelState === 'loaded'
          }

          // Non-lovelace panels: fall back to _loading check
          return !('_loading' in panel) || !panel._loading
        },
        { timeout: 5000, polling: 100 },
      )
    } catch (_err) {
      log.debug`Timeout waiting for HA to finish loading`
    }
  }
}

/**
 * Waits for Home Assistant loading indicators to disappear.
 *
 * Detects common HA loading patterns: circular progress spinners,
 * skeleton loaders, and loading placeholders.
 *
 * NOTE: Uses Puppeteer's waitForFunction instead of manual evaluate() polling.
 * The function is sent to the browser once and polled internally every 100ms,
 * eliminating IPC round-trip overhead per poll cycle.
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

    const loadingSelectors = [
      'ha-circular-progress',
      'hass-loading-screen', // Panel loading screen (shown while _panelState === "loading")
      '.loading',
      '.spinner',
      '[loading]',
      'hui-card-preview', // Card preview placeholder
    ].join(', ')

    try {
      await this.#page.waitForFunction(
        (selectors: string) => {
          // ha-launch-screen lives on document root (not in shadow DOM)
          // It's removed when the app is fully initialized
          if (document.getElementById('ha-launch-screen')) return false

          const haEl = document.querySelector('home-assistant')
          if (!haEl?.shadowRoot) return true // No HA element = nothing to wait for

          const checkShadowRoot = (root: ShadowRoot | Document): boolean => {
            const indicators = Array.from(root.querySelectorAll(selectors))
            for (const el of indicators) {
              const style = window.getComputedStyle(el)
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                return true
              }
            }

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

          // Return true (ready) when no visible loading indicators remain
          return !checkShadowRoot(haEl.shadowRoot)
        },
        { timeout: this.#timeout, polling: 100 },
        loadingSelectors,
      )
    } catch (_err) {
      log.debug`Loading indicator timeout after ${Date.now() - start}ms`
    }

    const actualWait = Date.now() - start
    log.debug`Loading indicators cleared after ${actualWait}ms`
    return actualWait
  }
}

/**
 * Waits for the browser rendering pipeline to flush after DOM changes.
 *
 * Uses the "double requestAnimationFrame" technique: two consecutive rAF
 * callbacks ensure the browser has composed and painted at least one frame.
 * This catches the gap between "loading indicators gone" and "pixels painted".
 */
export class WaitForPaintStability {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  async call(): Promise<void> {
    try {
      await this.#page.waitForFunction(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => resolve(true))
            })
          }),
        { timeout: 2000 },
      )
    } catch (_err) {
      log.debug`Paint stability check timed out`
    }
  }
}

/**
 * Waits for Home Assistant core data to be populated via WebSocket.
 *
 * The HA frontend loads data in this order (connection-mixin.ts):
 *   1. subscribeEntities → hass.states
 *   2. subscribeConfig → hass.config
 *   3. subscribeEntityRegistryDisplay → hass.entities
 *   4. subscribeDeviceRegistry → hass.devices
 *   5. subscribeAreaRegistry → hass.areas
 *
 * ha-panel-lovelace._fetchConfig() explicitly checks for entities, devices,
 * and areas before loading the dashboard config. Without these, cards that
 * reference devices/areas will render with incomplete data.
 *
 * @see frontend/src/state/connection-mixin.ts
 * @see frontend/src/panels/lovelace/ha-panel-lovelace.ts (_fetchConfig)
 */
export class WaitForHassReady {
  #page: Page
  #timeout: number

  constructor(page: Page, timeout: number = 5000) {
    this.#page = page
    this.#timeout = timeout
  }

  async call(): Promise<void> {
    try {
      await this.#page.waitForFunction(
        () => {
          const haEl = document.querySelector('home-assistant') as
            | (Element & {
                hass?: {
                  connected?: boolean
                  states?: Record<string, unknown>
                  config?: { state?: string }
                  entities?: Record<string, unknown>
                  devices?: Record<string, unknown>
                  areas?: Record<string, unknown>
                }
              })
            | null
          if (!haEl?.hass) return false

          const h = haEl.hass

          // Core check: entity state data must be populated (all HA versions)
          if (!h.states || Object.keys(h.states).length === 0) return false

          // Defensive checks: only enforce properties that exist on this HA version.
          // Older HA lacks registries; future HA may change the shape.
          // If the property exists but is falsy (null/undefined), data hasn't loaded yet.
          if ('connected' in h && !h.connected) return false
          if (h.config && 'state' in h.config && h.config.state !== 'RUNNING')
            return false
          if ('entities' in h && !h.entities) return false
          if ('devices' in h && !h.devices) return false
          if ('areas' in h && !h.areas) return false

          return true
        },
        { timeout: this.#timeout, polling: 100 },
      )
    } catch (_err) {
      log.debug`Hass ready check timed out after ${this.#timeout}ms`
    }
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
