/**
 * Puppeteer stand-ins for exercising the Browser lifecycle without Chromium.
 *
 * Only the members screenshot.ts actually touches are implemented, and every
 * one of them resolves to something harmless, so a test can drive navigation
 * and capture without a real page. Tests reach for emit() to make the page or
 * browser do the thing being tested: crash, or navigate underneath the caller.
 *
 * @module tests/helpers/browser-doubles
 */

import type { Browser as PuppeteerBrowser, Frame, Page } from 'puppeteer'

type Handler = (...args: unknown[]) => void

/** Records handlers so a test can fire the events Puppeteer would. */
class EventRecorder {
  #handlers = new Map<string, Handler[]>()

  on(event: string, handler: Handler): void {
    this.#handlers.set(event, [...(this.#handlers.get(event) ?? []), handler])
  }

  off(event: string, handler: Handler): void {
    this.#handlers.set(
      event,
      (this.#handlers.get(event) ?? []).filter((h) => h !== handler),
    )
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of [...(this.#handlers.get(event) ?? [])]) {
      handler(...args)
    }
  }

  count(event: string): number {
    return (this.#handlers.get(event) ?? []).length
  }
}

/** A fake page, plus the controls a test needs to drive it. */
export interface FakePage {
  page: Page
  emit(event: string, ...args: unknown[]): void
  mainFrame: Frame
  closed: boolean
  /** Runs on every evaluate(); use it to make a step navigate or throw. */
  onEvaluate?: () => void
}

/** A fake browser, plus the controls a test needs to drive it. */
export interface FakeBrowser {
  browser: PuppeteerBrowser
  emit(event: string, ...args: unknown[]): void
  pages: FakePage[]
  closeCount: number
}

export function createFakePage(): FakePage {
  const events = new EventRecorder()
  const mainFrame = { url: () => 'http://ha.test/lovelace/0' } as unknown as Frame

  const fake: FakePage = {
    emit: (event, ...args) => events.emit(event, ...args),
    mainFrame,
    closed: false,
    page: undefined as unknown as Page,
  }

  fake.page = {
    on(event: string, handler: Handler) {
      events.on(event, handler)
      return fake.page
    },
    off(event: string, handler: Handler) {
      events.off(event, handler)
      return fake.page
    },
    mainFrame: () => mainFrame,
    url: () => 'http://ha.test/lovelace/0',
    close: async () => {
      fake.closed = true
    },
    setViewport: async () => {},
    emulateMediaFeatures: async () => {},
    evaluateOnNewDocument: async () => ({ identifier: 'x' }),
    removeScriptToEvaluateOnNewDocument: async () => {},
    goto: async () => ({ ok: () => true, status: () => 200 }),
    evaluate: async (fn: unknown) => {
      fake.onEvaluate?.()
      return typeof fn === 'function' ? undefined : undefined
    },
    waitForFunction: async () => undefined,
    waitForNetworkIdle: async () => {},
    createCDPSession: async () => ({
      send: async () => {},
      on: () => {},
      detach: async () => {},
    }),
    screenshot: async () => Buffer.from('89504e470d0a1a0a', 'hex'),
  } as unknown as Page

  return fake
}

/**
 * @param onNewPage - Called with each page as it is created, so a test can arm
 * it before the code under test starts using it.
 */
export function createFakeBrowser(
  onNewPage?: (page: FakePage) => void,
): FakeBrowser {
  const events = new EventRecorder()
  const pages: FakePage[] = []

  const fake: FakeBrowser = {
    emit: (event, ...args) => events.emit(event, ...args),
    pages,
    closeCount: 0,
    browser: undefined as unknown as PuppeteerBrowser,
  }

  fake.browser = {
    connected: true,
    on(event: string, handler: Handler) {
      events.on(event, handler)
      return fake.browser
    },
    off(event: string, handler: Handler) {
      events.off(event, handler)
      return fake.browser
    },
    newPage: async () => {
      const page = createFakePage()
      pages.push(page)
      onNewPage?.(page)
      return page.page
    },
    close: async () => {
      fake.closeCount++
      // Puppeteer fires this for a deliberate close as well as for a crash.
      events.emit('disconnected')
    },
  } as unknown as PuppeteerBrowser

  return fake
}
