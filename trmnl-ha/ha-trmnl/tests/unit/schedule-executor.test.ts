/**
 * Unit tests for Schedule Executor — BYOS URI delivery.
 *
 * Covers the URI sent to BYOS servers in URI delivery mode: it must point
 * at the capture saved by the same run (served at /output/) so the BYOS
 * fetch does not trigger a second full dashboard render (#74).
 *
 * Uses a temp output dir and a globalThis.fetch override (restored in
 * afterAll) to capture the webhook payload without a network.
 *
 * @see lib/scheduler/schedule-executor.ts
 * @module tests/unit/schedule-executor
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  mock,
  spyOn,
} from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ScheduleExecutor } from '../../lib/scheduler/schedule-executor.js'
import * as sleepModule from '../../lib/sleep.js'
import {
  captureFetch,
  mockFetch,
  restoreFetch,
} from '../helpers/fetch-mock.js'
import {
  buildSchedule,
  buildByosSchedule,
} from '../helpers/schedule-fixtures.js'
import type { Schedule } from '../../types/domain.js'

afterAll(restoreFetch)

/** Executor writing into a fresh temp dir */
function createExecutor(
  screenshotFn: () => Promise<Buffer>,
): ScheduleExecutor {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-executor-'))
  return new ScheduleExecutor(screenshotFn, outputDir)
}

describe('ScheduleExecutor — BYOS URI delivery', () => {
  let outputDir: string
  let executor: ScheduleExecutor
  let requests: ReturnType<typeof captureFetch>

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-executor-'))
    executor = new ScheduleExecutor(
      async () => Buffer.from('fake-png'),
      outputDir,
    )
    requests = captureFetch()
  })

  it('sends a URI pointing at the saved capture, not a render endpoint', async () => {
    const result = await executor.call(buildByosSchedule())

    // Payloads are JSON strings; anything else would be a test setup bug
    const payload = JSON.parse(requests[0]!.init?.body as string) as {
      screen: { uri: string }
    }
    const savedFilename = path.basename(result.savedPath)

    expect(payload.screen.uri).toBe(
      `http://192.168.1.10:10000/output/${savedFilename}`,
    )
  })

  it('saves the capture the URI points at', async () => {
    const result = await executor.call(buildByosSchedule())

    expect(fs.readFileSync(result.savedPath, 'utf-8')).toBe('fake-png')
  })

  it('falls back to embedded data when delivery_mode is data', async () => {
    const schedule = buildByosSchedule()
    schedule.webhook_format!.byosConfig!.delivery_mode = 'data'

    await executor.call(schedule)

    const payload = JSON.parse(requests[0]!.init?.body as string) as {
      screen: { uri?: string; data?: string }
    }

    expect(payload.screen.uri).toBeUndefined()
    expect(payload.screen.data).toBeDefined()
  })
})

describe('ScheduleExecutor — network retry', () => {
  let sleepSpy: { mockRestore: () => void }

  beforeEach(() => {
    // Skip the real 5s SCHEDULER_RETRY_DELAY_MS between attempts
    sleepSpy = spyOn(sleepModule, 'sleep').mockResolvedValue(undefined)
  })

  afterEach(() => {
    sleepSpy.mockRestore()
  })

  it('retries after a network error and succeeds', async () => {
    let attempts = 0
    const executor = createExecutor(async () => {
      attempts++
      if (attempts === 1) throw new Error('net::ERR_CONNECTION_REFUSED')
      return Buffer.from('fake-png')
    })

    const result = await executor.call(buildSchedule())

    expect(result.success).toBe(true)
    expect(attempts).toBe(2)
  })

  it('throws once retries are exhausted', async () => {
    let attempts = 0
    const executor = createExecutor(async () => {
      attempts++
      throw new Error('net::ERR_CONNECTION_REFUSED')
    })

    await expect(executor.call(buildSchedule())).rejects.toThrow(
      /ERR_CONNECTION_REFUSED/,
    )
    expect(attempts).toBe(3)
  })
})

describe('ScheduleExecutor — webhook failure reporting', () => {
  const webhookSchedule = () =>
    buildSchedule({ webhook_url: 'https://byos.example.com/api/screens' })
  let sleepSpy: { mockRestore: () => void }

  beforeEach(() => {
    // A thrown fetch is a connection error, which the upload retries
    sleepSpy = spyOn(sleepModule, 'sleep').mockResolvedValue(undefined)
  })

  afterEach(() => {
    sleepSpy.mockRestore()
  })

  it('reports statusCode and retryAfterMs from a WebhookHttpError', async () => {
    mockFetch({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'Retry-After': '60' }),
    })
    const executor = createExecutor(async () => Buffer.from('fake-png'))

    const result = await executor.call(webhookSchedule())

    expect(result.webhook).toMatchObject({
      attempted: true,
      success: false,
      statusCode: 429,
      retryAfterMs: 60000,
    })
  })

  it('scrapes the status from a plain error message', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('HTTP 503: service unavailable')
    }) as unknown as typeof fetch
    const executor = createExecutor(async () => Buffer.from('fake-png'))

    const result = await executor.call(webhookSchedule())

    expect(result.webhook).toMatchObject({
      attempted: true,
      success: false,
      statusCode: 503,
    })
    expect(result.webhook!.retryAfterMs).toBeUndefined()
  })
})

describe('ScheduleExecutor — refused upload notification', () => {
  const webhookSchedule = () =>
    buildSchedule({ webhook_url: 'https://trmnl.com/api/plugin_settings/uuid/image' })
  let sleepSpy: { mockRestore: () => void }

  beforeEach(() => {
    sleepSpy = spyOn(sleepModule, 'sleep').mockResolvedValue(undefined)
  })

  afterEach(() => {
    sleepSpy.mockRestore()
  })

  function createNotifyingExecutor() {
    const notifier = {
      refused: mock(async (_schedule: Schedule, _reason: string) => {}),
      cleared: mock(async (_schedule: Schedule) => {}),
      reauth: mock(async (_schedule: Schedule) => {}),
      reauthCleared: mock(async (_schedule: Schedule) => {}),
    }
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-executor-'))
    const executor = new ScheduleExecutor(async () => Buffer.from('fake-png'), outputDir, {
      notifyUploadRefused: notifier.refused,
      clearUploadRefused: notifier.cleared,
      notifyReauthRequired: notifier.reauth,
      clearReauthRequired: notifier.reauthCleared,
    })
    return { executor, notifier }
  }

  it('notifies Home Assistant when the server refuses the image', async () => {
    mockFetch({ ok: false, status: 422, statusText: 'Unprocessable Entity', text: async () => '{"error":"BMP images are no longer supported."}' })
    const { executor, notifier } = createNotifyingExecutor()

    await executor.call(webhookSchedule())

    expect(notifier.refused.mock.calls[0]![1]).toContain('BMP images are no longer supported.')
  })

  it('notifies Home Assistant when Terminus cannot load the screenshot URL', async () => {
    mockFetch({ ok: false, status: 500, statusText: 'Internal Server Error' })
    const { executor, notifier } = createNotifyingExecutor()

    await executor.call(buildByosSchedule())

    expect(notifier.refused.mock.calls[0]![1]).toContain('Check that Terminus can open the App URL')
  })

  it('stays quiet on a server error when the image is sent as data', async () => {
    mockFetch({ ok: false, status: 500, statusText: 'Internal Server Error' })
    const { executor, notifier } = createNotifyingExecutor()
    const schedule = buildByosSchedule()
    schedule.webhook_format!.byosConfig!.delivery_mode = 'data'

    await executor.call(schedule)

    expect(notifier.refused).not.toHaveBeenCalled()
  })

  it('stays quiet on a rate limit, which clears by itself', async () => {
    mockFetch({ ok: false, status: 429, statusText: 'Too Many Requests' })
    const { executor, notifier } = createNotifyingExecutor()

    await executor.call(webhookSchedule())

    expect(notifier.refused).not.toHaveBeenCalled()
  })

  it('creates a sign-in notice when BYOS rejects authentication', async () => {
    mockFetch({ ok: false, status: 401, statusText: 'Unauthorized' })
    const { executor, notifier } = createNotifyingExecutor()

    const schedule = buildByosSchedule()
    await executor.call(schedule)

    expect(notifier.refused).not.toHaveBeenCalled()
    expect(notifier.reauth).toHaveBeenCalledWith(schedule)
    expect(notifier.reauthCleared).not.toHaveBeenCalled()
  })

  it('clears the notification when an upload succeeds', async () => {
    mockFetch({ ok: true, status: 200 })
    const { executor, notifier } = createNotifyingExecutor()

    await executor.call(webhookSchedule())

    expect(notifier.cleared).toHaveBeenCalledTimes(1)
    expect(notifier.reauthCleared).not.toHaveBeenCalled()
  })

  it('clears a persisted sign-in notice after authenticated BYOS delivery', async () => {
    mockFetch({ ok: true, status: 200 })
    const { executor, notifier } = createNotifyingExecutor()
    const schedule = buildByosSchedule()

    await executor.call(schedule)

    expect(notifier.reauthCleared).toHaveBeenCalledWith(schedule)
    expect(notifier.reauth).not.toHaveBeenCalled()
  })

  it('clears a sign-in notice after token renewal even if image delivery fails', async () => {
    globalThis.fetch = mock(async (url: unknown) =>
      String(url).endsWith('/api/jwt')
        ? Response.json({ access_token: 'renewed', refresh_token: 'renewed-refresh' })
        : new Response('', { status: 503 }),
    ) as unknown as typeof fetch
    const { executor, notifier } = createNotifyingExecutor()
    const schedule = buildByosSchedule()
    schedule.webhook_format!.byosConfig!.auth!.obtained_at = Date.now() - 11 * 60_000

    const result = await executor.call(schedule)

    expect(result.webhook?.success).toBe(false)
    expect(notifier.reauthCleared).toHaveBeenCalledTimes(1)
    expect(notifier.reauth).not.toHaveBeenCalled()
  })

  it('keeps a sign-in notice when delivery has a network failure', async () => {
    globalThis.fetch = mock(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const { executor, notifier } = createNotifyingExecutor()

    await executor.call(buildByosSchedule())

    expect(notifier.reauthCleared).not.toHaveBeenCalled()
    expect(notifier.reauth).not.toHaveBeenCalled()
  })
})

describe('ScheduleExecutor — unchanged image', () => {
  const trmnlSchedule = () =>
    buildSchedule({ webhook_url: 'https://trmnl.com/api/plugin_settings/uuid/image' })

  let requests: ReturnType<typeof captureFetch>
  let image: string

  beforeEach(() => {
    requests = captureFetch()
    image = 'dashboard-a'
  })

  afterEach(() => {
    mock.restore()
  })

  const createImageExecutor = () => createExecutor(async () => Buffer.from(image))

  it('skips a scheduled upload when the image matches the last one sent', async () => {
    const executor = createImageExecutor()

    await executor.call(trmnlSchedule())
    const result = await executor.call(trmnlSchedule())

    expect(requests).toHaveLength(1)
    expect(result.webhook).toEqual({ attempted: false, success: true })
  })

  it('uploads when the image changes', async () => {
    const executor = createImageExecutor()

    await executor.call(trmnlSchedule())
    image = 'dashboard-b'
    await executor.call(trmnlSchedule())

    expect(requests).toHaveLength(2)
  })

  it('uploads an unchanged image when forced, as Send Now does', async () => {
    const executor = createImageExecutor()

    await executor.call(trmnlSchedule())
    await executor.call(trmnlSchedule(), { force: true })

    expect(requests).toHaveLength(2)
  })

  it('uploads an unchanged image again four hours after the last upload', async () => {
    const executor = createImageExecutor()
    const start = Date.now()
    const clock = spyOn(Date, 'now').mockReturnValue(start)

    await executor.call(trmnlSchedule())
    clock.mockReturnValue(start + 4 * 60 * 60 * 1000 - 1)
    await executor.call(trmnlSchedule())
    clock.mockReturnValue(start + 4 * 60 * 60 * 1000)
    await executor.call(trmnlSchedule())

    expect(requests).toHaveLength(2)
  })

  it('uploads an unchanged image again after a failed upload', async () => {
    mockFetch({ ok: false, status: 503, statusText: 'Service Unavailable' })
    const executor = createImageExecutor()
    await executor.call(trmnlSchedule())

    requests = captureFetch()
    await executor.call(trmnlSchedule())

    expect(requests).toHaveLength(1)
  })

  it('uploads when the same image goes to a different webhook', async () => {
    const executor = createImageExecutor()

    await executor.call(trmnlSchedule())
    await executor.call(buildSchedule({ webhook_url: 'https://trmnl.com/api/plugin_settings/other/image' }))

    expect(requests).toHaveLength(2)
  })

  it('always uploads to a BYOS server', async () => {
    const executor = createImageExecutor()

    await executor.call(buildByosSchedule())
    await executor.call(buildByosSchedule())

    expect(requests.filter((r) => r.url.endsWith('/api/screens'))).toHaveLength(2)
  })
})

describe('ScheduleExecutor — upload retry on connection errors', () => {
  const webhookSchedule = () =>
    buildSchedule({ webhook_url: 'https://byos.example.com/api/screens' })
  let sleepSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    sleepSpy = spyOn(sleepModule, 'sleep').mockResolvedValue(undefined)
  })

  afterEach(() => {
    sleepSpy.mockRestore()
  })

  /** fetch that throws a connection error for the first `failures` calls */
  function failingFetch(failures: number): { calls: number } {
    const state = { calls: 0 }
    globalThis.fetch = mock(async () => {
      state.calls++
      if (state.calls <= failures) {
        throw new Error('The socket connection was closed unexpectedly.')
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    return state
  }

  it('retries the upload while the server is unreachable, then succeeds', async () => {
    const fetchState = failingFetch(2)
    let captures = 0
    const executor = createExecutor(async () => {
      captures++
      return Buffer.from('fake-png')
    })

    const result = await executor.call(webhookSchedule())

    expect(result.webhook).toMatchObject({ attempted: true, success: true })
    expect(fetchState.calls).toBe(3)
    expect(captures).toBe(1)
    expect(sleepSpy.mock.calls.map((c: unknown[]) => c[0])).toEqual([5000, 15000])
  })

  it('reports failure after about a minute of tries', async () => {
    const fetchState = failingFetch(Infinity)
    const executor = createExecutor(async () => Buffer.from('fake-png'))

    const result = await executor.call(webhookSchedule())

    expect(result.webhook).toMatchObject({ attempted: true, success: false })
    expect(result.webhook!.error).toMatch(/Could not reach byos\.example\.com/)
    expect(fetchState.calls).toBe(4)
    expect(sleepSpy.mock.calls.map((c: unknown[]) => c[0])).toEqual([5000, 15000, 40000])
  })

  it('does not retry an HTTP error', async () => {
    mockFetch({ ok: false, status: 500, statusText: 'Server Error' })
    const executor = createExecutor(async () => Buffer.from('fake-png'))

    const result = await executor.call(webhookSchedule())

    expect(result.webhook).toMatchObject({ success: false, statusCode: 500 })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(sleepSpy).not.toHaveBeenCalled()
  })
})
