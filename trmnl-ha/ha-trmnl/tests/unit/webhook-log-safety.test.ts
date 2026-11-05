/**
 * Capture real LogTape records through delivery and executor completion.
 * Remote text is untrusted even when it echoes only a credential fragment.
 * @module tests/unit/webhook-log-safety
 */
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getValidAccessToken, login } from '../../lib/scheduler/byos-auth.js'
import { Scheduler } from '../../scheduler.js'
import * as scheduleStore from '../../lib/scheduleStore.js'
import { ScheduleExecutor } from '../../lib/scheduler/schedule-executor.js'
import { captureLogs, type LogCapture } from '../helpers/log-capture.js'
import { restoreFetch } from '../helpers/fetch-mock.js'
import { buildByosSchedule, buildSchedule } from '../helpers/schedule-fixtures.js'

const credential = 'SYNTHETIC-WRITE-CREDENTIAL'
const bearer = 'SYNTHETIC-BEARER-CREDENTIAL'
const url = `https://example.invalid/api/plugin_settings/${credential}/image`
const echo = `Rejected ${url}; credential=${credential}; Authorization: ${bearer}`
let logs: LogCapture | undefined
let outputDir: string | undefined

afterEach(async () => {
  restoreFetch()
  await logs?.stop()
  logs = undefined
  if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true })
  outputDir = undefined
})

async function setup() {
  logs = await captureLogs('trace')
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-log-safety-'))
  return new ScheduleExecutor(async () => Buffer.from('png'), outputDir)
}

function expectSafeLogs() {
  // Positive assertions prevent a missing/unconfigured logger from passing.
  expect(logs!.contains('Sending webhook')).toBe(true)
  expect(logs!.contains('Completed: Test Schedule')).toBe(true)
  expect(logs!.contains(url)).toBe(false)
  expect(logs!.contains(credential)).toBe(false)
  expect(logs!.contains(bearer)).toBe(false)
}

describe('credential-safe webhook logs', () => {
  for (const status of [200, 429, 503]) {
    it(`logs HTTP ${status} without echoed response text or the upload URL`, async () => {
      const executor = await setup()
      let sentUrl: string | undefined
      globalThis.fetch = mock(async (input: string | URL | Request) => {
        sentUrl = input instanceof Request ? input.url : input.toString()
        return new Response(JSON.stringify({ message: echo }), {
          status, statusText: echo, headers: { 'Retry-After': '60' },
        })
      }) as unknown as typeof fetch
      const result = await executor.call(buildSchedule({
        webhook_url: url, webhook_headers: { Authorization: bearer },
      }))
      expect(sentUrl).toBe(url)
      expect(result.webhook).toMatchObject({ success: status === 200, statusCode: status, url })
      expectSafeLogs()
      expect(logs!.contains(status === 200 ? '200 OK' : `FAILED (HTTP ${status})`)).toBe(true)
      expect(logs!.contains(status === 200 ? 'Webhook success: HTTP 200' : `Webhook failed: HTTP ${status}`)).toBe(true)
      if (status !== 200) {
        // UI feedback and cooldown metadata remain available to callers.
        expect(result.webhook!.error).toContain(credential)
        expect(result.webhook!.retryAfterMs).toBe(60000)
      }
    })
  }

  for (const stage of ['fetch', 'response body']) {
    it(`does not log an echoed ${stage} error`, async () => {
      const executor = await setup()
      globalThis.fetch = mock(async () => {
        if (stage === 'fetch') throw new Error(echo)
        return { text: async () => { throw new Error(echo) } }
      }) as unknown as typeof fetch
      const result = await executor.call(buildSchedule({ webhook_url: url }))
      expect(result.webhook?.success).toBe(false)
      expect(result.webhook?.error).toContain(credential)
      expectSafeLogs()
      expect(logs!.contains('webhook failed: HTTP unknown', 'error')).toBe(true)
      expect(logs!.contains('FAILED (HTTP unknown)')).toBe(true)
    })
  }

  for (const stage of ['list error', 'list failure', 'patch error', 'patch failure', 'patch success']) {
    it(`keeps BYOS ${stage} logs free of echoed remote details`, async () => {
      const executor = await setup()
      let calls = 0
      globalThis.fetch = mock(async () => {
        calls++
        if (calls === 1) return new Response(echo, { status: 422, statusText: echo })
        if (calls === 2) {
          if (stage === 'list error') throw new Error(echo)
          if (stage === 'list failure') return new Response(echo, { status: 503, statusText: echo })
          return new Response(JSON.stringify({ data: [{ id: credential, model_id: 1, name: 'trmnl_screen' }] }))
        }
        if (stage === 'patch error') throw new Error(echo)
        return new Response(echo, { status: stage === 'patch success' ? 200 : 503, statusText: echo })
      }) as unknown as typeof fetch
      const schedule = buildByosSchedule({ webhook_url: url })
      schedule.webhook_format!.byosConfig!.auth!.access_token = bearer
      const result = await executor.call(schedule)
      expect(calls).toBe(stage.startsWith('list') ? 2 : 3)
      expect(result.webhook?.success).toBe(stage === 'patch success')
      expectSafeLogs()
      const expectedLog = {
        'list error': 'Error finding screen',
        'list failure': 'Failed to list screens: HTTP 503',
        'patch error': 'webhook failed: HTTP unknown',
        'patch failure': 'PATCH failed: HTTP 503',
        'patch success': 'PATCH successful: HTTP 200',
      }[stage]!
      expect(logs!.contains(expectedLog)).toBe(true)
    })
  }
})


describe('credential-safe BYOS authentication logs', () => {
  for (const failure of ['response', 'transport']) {
    it(`omits echoed ${failure} errors during refresh and re-login`, async () => {
      logs = await captureLogs('trace')
      let calls = 0
      globalThis.fetch = mock(async () => {
        calls++
        if (failure === 'transport') throw new Error(echo)
        return new Response(echo, { status: 401 })
      }) as unknown as typeof fetch
      const token = await getValidAccessToken(url, {
        enabled: true,
        access_token: bearer,
        refresh_token: credential,
        obtained_at: 1,
        login_email: 'user@example.invalid',
        login_password: credential,
      })
      expect(calls).toBe(2)
      expect(token).toBe(bearer)
      expect(logs.contains('BYOS auth: refresh failed')).toBe(true)
      expect(logs.contains('BYOS auth: re-authentication failed', 'error')).toBe(true)
      expect(logs.contains(credential)).toBe(false)
      expect(logs.contains(bearer)).toBe(false)
    })
  }
})


it('keeps malformed credential-bearing URLs out of BYOS keepalive errors', async () => {
  logs = await captureLogs('trace')
  const schedule = buildByosSchedule({ webhook_url: credential, enabled: false })
  schedule.webhook_format!.byosConfig!.auth!.obtained_at = Date.now() - 11 * 60 * 1000
  const load = spyOn(scheduleStore, 'loadSchedules').mockResolvedValue([schedule])
  const scheduler = new Scheduler(async () => Buffer.from('png'))
  try {
    scheduler.start()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(logs.contains('BYOS token keepalive failed', 'error')).toBe(true)
    expect(logs.contains(credential)).toBe(false)
  } finally { scheduler.stop(); load.mockRestore() }
})


it('does not log credentials embedded in a login base URL', async () => {
  logs = await captureLogs('trace')
  globalThis.fetch = mock(async () => Response.json({
    access_token: bearer, refresh_token: credential,
  })) as unknown as typeof fetch
  const tokens = await login(`https://user:${credential}@example.invalid`, 'user@example.invalid', credential)
  expect(tokens.access_token).toBe(bearer)
  expect(logs.contains('BYOS auth: login successful')).toBe(true)
  expect(logs.contains(credential)).toBe(false)
  expect(logs.contains(bearer)).toBe(false)
})
