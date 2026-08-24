/**
 * Unit tests for Browser lifecycle logging and reload recovery.
 *
 * @module tests/unit/browser-lifecycle
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Browser } from '../../screenshot.js'
import {
  createFakeBrowser,
  type FakeBrowser,
} from '../helpers/browser-doubles.js'
import { captureLogs, type LogCapture } from '../helpers/log-capture.js'

const CRASH_MESSAGE = 'Browser process disconnected'

describe('Browser', () => {
  let logs: LogCapture
  let fake: FakeBrowser
  let browser: Browser

  beforeEach(async () => {
    logs = await captureLogs()
    fake = createFakeBrowser()
    browser = new Browser('http://ha.test', 'token', {
      launchBrowser: async () => fake.browser,
    })
  })

  afterEach(async () => {
    await logs.stop()
  })

  describe('a disconnect it did not ask for', () => {
    it('is reported as a crash', async () => {
      await browser.triggerInit()

      fake.emit('disconnected')

      expect(logs.contains(CRASH_MESSAGE, 'error')).toBe(true)
    })

    it('drops the browser so the next request relaunches', async () => {
      await browser.triggerInit()

      fake.emit('disconnected')

      expect(browser.isConnected()).toBe(false)
    })
  })

  describe('a disconnect from its own cleanup', () => {
    it('closes the browser', async () => {
      await browser.triggerInit()

      await browser.cleanup()

      expect(fake.closeCount).toBe(1)
    })

    it('is not reported as a crash', async () => {
      await browser.triggerInit()

      await browser.cleanup()

      expect(logs.contains(CRASH_MESSAGE, 'error')).toBe(false)
    })
  })
})

const RESETTLE_MESSAGE = 'reloaded mid-capture'

/** A browser whose pages navigate underneath the caller mid-preparation. */
function browserThatReloads(reloadsPerPage: number): {
  fake: FakeBrowser
  browser: Browser
} {
  const fake = createFakeBrowser((page) => {
    let reloads = 0
    page.onEvaluate = () => {
      if (reloads >= reloadsPerPage) return
      reloads++
      page.emit('framenavigated', page.mainFrame)
    }
  })

  return {
    fake,
    browser: new Browser('http://ha.test', 'token', {
      launchBrowser: async () => fake.browser,
    }),
  }
}

const NAVIGATE = {
  pagePath: '/lovelace/0',
  viewport: { width: 800, height: 480 },
  zoom: 1.5,
}

describe('Browser navigation when the dashboard reloads', () => {
  let logs: LogCapture

  beforeEach(async () => {
    logs = await captureLogs()
  })

  afterEach(async () => {
    await logs.stop()
  })

  it('prepares the replacement document again', async () => {
    const { browser } = browserThatReloads(1)

    await browser.navigatePage(NAVIGATE)

    expect(logs.contains(RESETTLE_MESSAGE)).toBe(true)
  })

  it('gives up after one extra pass when it keeps reloading', async () => {
    const { browser } = browserThatReloads(Number.MAX_SAFE_INTEGER)

    await browser.navigatePage(NAVIGATE)

    expect(
      logs.entries.filter((e) => e.message.includes(RESETTLE_MESSAGE)),
    ).toHaveLength(1)
  })

  it('prepares the page once when nothing navigates', async () => {
    const { browser } = browserThatReloads(0)

    await browser.navigatePage(NAVIGATE)

    expect(logs.contains(RESETTLE_MESSAGE)).toBe(false)
  })
})
