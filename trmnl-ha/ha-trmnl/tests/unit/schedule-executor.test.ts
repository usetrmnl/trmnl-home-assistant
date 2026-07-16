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

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ScheduleExecutor } from '../../lib/scheduler/schedule-executor.js'
import type { Schedule } from '../../types/domain.js'

const realFetch = globalThis.fetch

afterAll(() => {
  globalThis.fetch = realFetch
})

/** Captures webhook requests and replies 200 */
function captureFetch(requests: { url: string; body: string }[]) {
  globalThis.fetch = mock(async (url: unknown, init?: RequestInit) => {
    // Payloads are JSON strings; anything else would be a test setup bug
    requests.push({ url: String(url), body: init?.body as string })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
}

function createByosSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'byos-1',
    name: 'Terminus',
    enabled: true,
    cron: '* * * * *',
    dashboard_path: '/lovelace/0',
    viewport: { width: 800, height: 480 },
    format: 'png',
    webhook_url: 'https://byos.example.com/api/screens',
    webhook_format: {
      format: 'byos-hanami',
      byosConfig: {
        model_id: '1',
        name: 'trmnl_screen',
        label: 'TRMNL Screen',
        addon_base_url: 'http://192.168.1.10:10000/',
        delivery_mode: 'uri',
        auth: {
          enabled: true,
          access_token: 'token',
          refresh_token: 'refresh',
          obtained_at: Date.now(),
        },
      },
    },
    ...overrides,
  } as Schedule
}

describe('ScheduleExecutor — BYOS URI delivery', () => {
  let outputDir: string
  let executor: ScheduleExecutor
  let requests: { url: string; body: string }[]

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-executor-'))
    executor = new ScheduleExecutor(
      async () => Buffer.from('fake-png'),
      outputDir,
    )
    requests = []
    captureFetch(requests)
  })

  it('sends a URI pointing at the saved capture, not a render endpoint', async () => {
    const result = await executor.call(createByosSchedule())

    const payload = JSON.parse(requests[0]!.body) as {
      screen: { uri: string }
    }
    const savedFilename = path.basename(result.savedPath)

    expect(payload.screen.uri).toBe(
      `http://192.168.1.10:10000/output/${savedFilename}`,
    )
  })

  it('saves the capture the URI points at', async () => {
    const result = await executor.call(createByosSchedule())

    expect(fs.readFileSync(result.savedPath, 'utf-8')).toBe('fake-png')
  })

  it('falls back to embedded data when delivery_mode is data', async () => {
    const schedule = createByosSchedule()
    schedule.webhook_format!.byosConfig!.delivery_mode = 'data'

    await executor.call(schedule)

    const payload = JSON.parse(requests[0]!.body) as {
      screen: { uri?: string; data?: string }
    }

    expect(payload.screen.uri).toBeUndefined()
    expect(payload.screen.data).toBeDefined()
  })
})
