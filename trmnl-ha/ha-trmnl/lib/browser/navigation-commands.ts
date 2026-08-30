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
  NAVIGATION_TIMEOUT,
} from '../../const.js'
import { CannotOpenPageError } from '../../error.js'
import type { NavigationResult } from '../../types/domain.js'
import { navigationLogger } from '../logger.js'

const log = navigationLogger()

/** Set once the warning below has been given, so it is given only once. */
let warnedAboutInternals = false

/**
 * Clears the one-time internals warning. Exists for tests: the flag is process
 * wide, so without this whichever test runs first decides what the others see.
 */
export function resetInternalsWarning(): void {
  warnedAboutInternals = false
}

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
      // networkidle2, not the faster 'load': cards keep loading resources
      // after the load event fires, so 'load' captures a half-drawn dashboard.
      response = await this.#page.goto(pageUrl, {
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      })
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

const LOADING_SELECTORS = [
  'ha-circular-progress',
  'hass-loading-screen',
  '.loading',
  '.spinner',
  '[loading]',
  'hui-card-preview',
].join(', ')

/**
 * Decides whether the page has finished rendering and can be captured.
 *
 * Runs inside the browser via page.waitForFunction, so it must stay
 * self-contained: no imports, no module scope, no closures over anything here.
 *
 * An absence of loading indicators is not enough on its own. Home Assistant
 * passes through several states that contain no indicator and no content
 * either, and each one lasts longer the slower the instance is.
 *
 * @param selectors Comma-separated loading-indicator selectors
 * @returns true when the page can be captured
 */
export function isPageReadyForCapture(selectors: string): boolean {
  // Sits on the document root rather than in a shadow root, and is removed
  // once the app has started.
  if (document.getElementById('ha-launch-screen')) return false

  const haEl = document.querySelector('home-assistant')
  // Either not a Home Assistant page, or its root element is not defined yet.
  if (!haEl?.shadowRoot) return true

  const main = haEl.shadowRoot.querySelector('home-assistant-main') as
    | (Element & { shadowRoot?: ShadowRoot | null })
    | null
  const resolver = main?.shadowRoot?.querySelector('partial-panel-resolver')
  const panel = resolver?.firstElementChild as
    | (Element & { _panelState?: string })
    | null
    | undefined
  // The launch screen goes before a panel is mounted, leaving nothing to find.
  if (!panel) return false
  // Only the lovelace panel reports a load state.
  if ('_panelState' in panel && panel._panelState !== 'loaded') return false

  let pending = false
  let expectedCards = 0
  let renderedCards = 0

  const scan = (root: ShadowRoot | Document): void => {
    for (const el of Array.from(root.querySelectorAll(selectors))) {
      const style = window.getComputedStyle(el)
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        pending = true
      }
    }

    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.tagName === 'HUI-CARD') renderedCards++

      // A view lists the cards it will build before building them, so the
      // panel can report itself loaded while the dashboard is still empty.
      const declared = (el as Element & { _cards?: unknown })._cards
      if (Array.isArray(declared)) expectedCards += declared.length

      // Energy cards show a translated "Loading" string as plain text, with
      // no element or class to match on, so their own fields are the only
      // way to tell. The table and distribution cards use _data; the usage
      // graph uses _chartData and draws bare axes until it has series. The
      // date and period selectors carry neither and must not be waited on.
      if (el.tagName.startsWith('HUI-ENERGY')) {
        const card = el as Element & { _data?: unknown; _chartData?: unknown }
        if ('_data' in el && card._data === undefined) pending = true
        // A dashboard whose energy statistics are empty also has no series,
        // so that case waits the full timeout before it is captured.
        if (Array.isArray(card._chartData) && card._chartData.length === 0) {
          pending = true
        }
      }

      const shadow = (el as Element & { shadowRoot?: ShadowRoot | null })
        .shadowRoot
      if (shadow) scan(shadow)
    }
  }

  scan(haEl.shadowRoot)

  return !pending && renderedCards >= expectedCards
}

/**
 * Waits for the page to finish rendering, up to a timeout.
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

  /** @returns Actual wait time in milliseconds */
  async call(): Promise<number> {
    const start = Date.now()

    try {
      await this.#page.waitForFunction(
        isPageReadyForCapture,
        { timeout: this.#timeout, polling: 100 },
        LOADING_SELECTORS,
      )
    } catch (_err) {
      log.debug`Page readiness timed out after ${Date.now() - start}ms`
    }

    await this.#warnIfInternalsMissing()

    const actualWait = Date.now() - start
    log.debug`Page ready after ${actualWait}ms`
    return actualWait
  }

  /**
   * Reports, once per process, that the readiness check has stopped checking
   * anything. Without this the add-on would quietly go back to capturing
   * half-drawn dashboards after a Home Assistant upgrade.
   */
  async #warnIfInternalsMissing(): Promise<void> {
    if (warnedAboutInternals) return

    try {
      if (await this.#page.evaluate(readinessInternalsPresent)) return
    } catch (_err) {
      return // Page closed or navigated away.
    }

    warnedAboutInternals = true
    log.warn`This version of Home Assistant no longer reports when a dashboard has finished drawing, so screenshots may be captured before cards have filled in. Please report this along with your Home Assistant version.`
  }
}

/**
 * Dismisses Home Assistant notification toasts (e.g., "Update available").
 *
 * HA fires toasts on page load for updates, new integrations, etc.
 * These appear even on fresh pages and would pollute screenshots.
 *
 * NOTE: Calls .close() on the ha-toast element directly rather than clicking
 * action/dismiss buttons. The action button (slot="action") can trigger
 * navigation or other side effects; the dismiss button (slot="dismiss") is
 * only rendered when dismissable=true. Calling .close() is safe in all cases.
 *
 * @see frontend/src/managers/notification-manager.ts
 * @see frontend/src/components/ha-toast.ts (extends mwc-snackbar)
 */
export class DismissToasts {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  /** @returns Number of toasts dismissed */
  async call(): Promise<number> {
    return this.#page.evaluate(() => {
      const haEl = document.querySelector('home-assistant')
      if (!haEl) return 0

      const notifyEl = haEl.shadowRoot?.querySelector(
        'notification-manager',
      ) as (Element & { shadowRoot: ShadowRoot | null }) | null
      if (!notifyEl?.shadowRoot) return 0

      const toasts = Array.from(
        notifyEl.shadowRoot.querySelectorAll('ha-toast'),
      ) as (HTMLElement & { close?: (reason?: string) => void })[]
      let dismissed = 0
      for (const toast of toasts) {
        if (typeof toast.close === 'function') {
          toast.close('dismiss')
          dismissed++
        }
      }
      return dismissed
    })
  }
}

/**
 * Reports whether the Home Assistant fields isPageReadyForCapture depends on
 * are still there. They are private to the frontend and a release is free to
 * rename them, at which point the readiness check starts passing everything.
 *
 * Runs inside the browser, so it must stay self-contained.
 *
 * @returns false only when a lovelace panel is missing those fields
 */
export function readinessInternalsPresent(): boolean {
  const haEl = document.querySelector('home-assistant')
  if (!haEl?.shadowRoot) return true

  const main = haEl.shadowRoot.querySelector('home-assistant-main') as
    | (Element & { shadowRoot?: ShadowRoot | null })
    | null
  const resolver = main?.shadowRoot?.querySelector('partial-panel-resolver')
  const panel = resolver?.firstElementChild
  // Only the lovelace panel exposes these; other panels never had them.
  if (panel?.tagName !== 'HA-PANEL-LOVELACE') return true
  if (!('_panelState' in panel)) return false

  let sawDeclaredCards = false
  const walk = (root: ShadowRoot | Document): void => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if ('_cards' in el) sawDeclaredCards = true
      const shadow = (el as Element & { shadowRoot?: ShadowRoot | null })
        .shadowRoot
      if (shadow) walk(shadow)
    }
  }
  walk(haEl.shadowRoot)
  return sawDeclaredCards
}

/**
 * Waits for the browser rendering pipeline to flush after DOM changes.
 *
 * Uses the "double requestAnimationFrame" technique: two consecutive rAF
 * callbacks ensure the browser has composed and painted at least one frame.
 * This catches the gap between "loading indicators gone" and "pixels painted".
 */
/**
 * Waits for the rendered layout to stop changing.
 *
 * Frontend modules loaded as Lovelace resources (card-mod and friends) restyle
 * cards after the dashboard reports itself ready, which resizes everything
 * around them. Sampling the layout until it holds still catches that; a couple
 * of animation frames returns before it has even started.
 */
export class WaitForPaintStability {
  #page: Page
  #quietMs: number
  #timeout: number

  constructor(page: Page, quietMs: number = 300, timeout: number = 3000) {
    this.#page = page
    this.#quietMs = quietMs
    this.#timeout = timeout
  }

  async call(): Promise<void> {
    try {
      await this.#page.waitForFunction(
        (quietMs: number) => {
          const root = document.documentElement
          const signature = `${root.scrollHeight}:${root.scrollWidth}:${document.querySelectorAll('*').length}`
          const store = window as unknown as Record<string, unknown>
          const seen = store['__trmnlLayout'] as
            | { signature: string; since: number }
            | undefined

          if (seen?.signature !== signature) {
            store['__trmnlLayout'] = { signature, since: Date.now() }
            return false
          }
          return Date.now() - seen.since >= quietMs
        },
        { timeout: this.#timeout, polling: 100 },
        this.#quietMs,
      )
    } catch (_err) {
      log.debug`Layout stability wait timed out`
    }
  }
}

/**
 * Waits for the Home Assistant websocket to go quiet.
 *
 * Energy and history cards render a plain "Loading" string with no element to
 * match on while they fetch their data over the websocket, which an HTTP
 * network-idle check cannot see. Watching the frames covers every such card
 * without depending on card internals.
 *
 * `quietMs` must be long enough to span a card's fetch but short enough to fit
 * between the routine state updates that also travel this websocket. `timeout`
 * caps the wait for a dashboard whose updates never pause.
 */
export class WaitForWebSocketIdle {
  #page: Page
  #quietMs: number
  #timeout: number

  constructor(page: Page, quietMs: number = 500, timeout: number = 12000) {
    this.#page = page
    this.#quietMs = quietMs
    this.#timeout = timeout
  }

  async call(): Promise<void> {
    let client
    try {
      client = await this.#page.createCDPSession()
      await client.send('Network.enable')

      let lastFrameAt = Date.now()
      const recordFrame = (): void => {
        lastFrameAt = Date.now()
      }
      client.on('Network.webSocketFrameReceived', recordFrame)
      client.on('Network.webSocketFrameSent', recordFrame)

      const start = Date.now()
      while (Date.now() - start < this.#timeout) {
        if (Date.now() - lastFrameAt >= this.#quietMs) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      log.debug`Websocket idle wait reached its ${this.#timeout}ms limit`
    } catch (err) {
      log.debug`Websocket idle wait skipped: ${(err as Error).message}`
    } finally {
      if (client) {
        try {
          await client.detach()
        } catch (_err) {
          /* session already gone */
        }
      }
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
      // A readiness check that never passes adds this full timeout to every
      // screenshot, so the timeout must stay visible above debug level (#57)
      log.warn`Home Assistant readiness check timed out after ${this.#timeout}ms — hass state never fully populated; capture continues but adds ${this.#timeout}ms to every screenshot`
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
