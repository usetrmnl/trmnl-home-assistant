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

import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ScheduleExecutor } from '../../lib/scheduler/schedule-executor.js'
import { captureFetch, restoreFetch } from '../helpers/fetch-mock.js'
import { buildByosSchedule } from '../helpers/schedule-fixtures.js'

afterAll(restoreFetch)

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
