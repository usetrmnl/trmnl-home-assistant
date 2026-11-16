/**
 * Unit tests for Scheduler change detection.
 *
 * changedSnapshot() decides whether the reload loop re-registers cron jobs:
 * only when schedules.json content actually changed.
 *
 * @module tests/unit/scheduler
 */

import { describe, it, expect, afterEach, spyOn, mock } from 'bun:test'
import { changedSnapshot, Scheduler } from '../../scheduler.js'
import {
  buildByosSchedule,
  buildSchedule,
} from '../helpers/schedule-fixtures.js'
import * as scheduleStore from '../../lib/scheduleStore.js'
import { captureFetch, restoreFetch } from '../helpers/fetch-mock.js'
import type { Schedule } from '../../types/domain.js'

/** A BYOS schedule whose stored tokens carry the given rotation stamp. */
function byosWithTokens(stamp: number): Schedule[] {
  const schedule = buildByosSchedule()
  schedule.webhook_format!.byosConfig!.auth = {
    enabled: true,
    access_token: `access-${stamp}`,
    refresh_token: `refresh-${stamp}`,
    obtained_at: stamp,
  }
  return [schedule]
}

describe('changedSnapshot', () => {
  it('returns a snapshot on first load', () => {
    expect(changedSnapshot([buildSchedule()], '')).toBeTypeOf('string')
  })

  it('returns null when schedules are unchanged', () => {
    const schedules = [buildSchedule()]
    const first = changedSnapshot(schedules, '')!

    expect(changedSnapshot(schedules, first)).toBeNull()
  })

  it('returns a new snapshot when a field changes', () => {
    const first = changedSnapshot([buildSchedule()], '')!
    const edited = [buildSchedule({ cron: '*/30 * * * *' })]

    expect(changedSnapshot(edited, first)).toBeTypeOf('string')
  })

  it('returns a new snapshot when a schedule is added', () => {
    const first = changedSnapshot([buildSchedule()], '')!
    const grown = [buildSchedule(), buildSchedule({ id: 'test-id-2' })]

    expect(changedSnapshot(grown, first)).toBeTypeOf('string')
  })

  it('returns a new snapshot when all schedules are removed', () => {
    const first = changedSnapshot([buildSchedule()], '')!

    expect(changedSnapshot([], first)).toBeTypeOf('string')
  })

  it('returns null when only the BYOS tokens rotated', () => {
    const first = changedSnapshot(byosWithTokens(1000), '')!

    expect(changedSnapshot(byosWithTokens(2000), first)).toBeNull()
  })

  it('returns a new snapshot when a rotation accompanies a real edit', () => {
    const first = changedSnapshot(byosWithTokens(1000), '')!
    const [edited] = byosWithTokens(2000)
    edited!.interval_minutes = 30

    expect(changedSnapshot([edited!], first)).toBeTypeOf('string')
  })
})


describe('Scheduler BYOS authentication notices', () => {
  let scheduler: Scheduler | undefined
  const spies: { mockRestore(): void }[] = []

  afterEach(() => {
    scheduler?.stop()
    for (const spy of spies.splice(0)) spy.mockRestore()
    restoreFetch()
  })

  function scheduleWithExpiry(exp: number | undefined, ageMinutes = 31): Schedule {
    const schedule = buildByosSchedule({ enabled: false })
    schedule.webhook_format!.byosConfig!.auth!.access_token =
      `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
    schedule.webhook_format!.byosConfig!.auth!.obtained_at = Date.now() - ageMinutes * 60_000
    return schedule
  }

  function captureResponses(body: object, status = 200) {
    const requests: { url: string, init?: RequestInit }[] = []
    globalThis.fetch = mock(async (url: unknown, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      return Response.json(body, { status })
    }) as unknown as typeof fetch
    return requests
  }

  async function start(schedule: Schedule) {
    spies.push(spyOn(scheduleStore, 'loadSchedules').mockResolvedValue([schedule]))
    const update = spyOn(scheduleStore, 'updateSchedule').mockResolvedValue(schedule)
    spies.push(update)
    scheduler = new Scheduler(async () => Buffer.from('unused'))
    scheduler.start()
    // The store and HTTP responses resolve immediately. Drain the startup tick.
    await new Promise<void>((resolve) => setImmediate(resolve))
    return update
  }

  it('refreshes an older long-lived token on a paused schedule and dismisses stale notices', async () => {
    const requests = captureResponses({ access_token: 'renewed', refresh_token: 'renewed-refresh' })
    const schedule = scheduleWithExpiry(Date.now() / 1000 + 100 * 365 * 86400)

    const update = await start(schedule)

    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      '/api/jwt', '/api/services/persistent_notification/dismiss',
    ])
    expect(update).toHaveBeenCalledTimes(1)
    expect(JSON.parse(requests[1]!.init?.body as string)).toEqual({
      notification_id: 'trmnl_byos_reauth_schedule-1',
    })
  })

  it('warns for known expiry without attempting refresh', async () => {
    const requests = captureFetch()
    await start(scheduleWithExpiry(Date.now() / 1000 - 60))
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      '/api/services/persistent_notification/create',
    ])
  })

  it('does not infer expiry from incomplete refresh metadata', async () => {
    const requests = captureFetch()
    const schedule = scheduleWithExpiry(undefined)
    delete schedule.webhook_format!.byosConfig!.auth!.refresh_token
    await start(schedule)
    expect(requests).toHaveLength(0)
  })

  it('preserves a notice when refresh fails but token expiry is unknown', async () => {
    const requests = captureResponses({}, 400)
    await start(scheduleWithExpiry(undefined))
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(['/api/jwt'])
  })

  it('warns if a stored login cannot recover an expired token', async () => {
    const requests = captureResponses({}, 401)
    const schedule = scheduleWithExpiry(Date.now() / 1000 - 60)
    Object.assign(schedule.webhook_format!.byosConfig!.auth!, {
      login_email: 'test@example.com', login_password: 'test-password',
    })
    await start(schedule)
    expect(requests.map((r) => new URL(r.url).pathname)).toContain(
      '/api/services/persistent_notification/create',
    )
  })

  it('dismisses a persisted notice when a saved login recovers an expired token', async () => {
    const requests: string[] = []
    globalThis.fetch = mock(async (url: unknown) => {
      const pathname = new URL(String(url)).pathname
      requests.push(pathname)
      return pathname === '/api/jwt'
        ? Response.json({}, { status: 401 })
        : Response.json({ access_token: 'renewed', refresh_token: 'renewed-refresh' })
    }) as unknown as typeof fetch
    const schedule = scheduleWithExpiry(Date.now() / 1000 - 60)
    Object.assign(schedule.webhook_format!.byosConfig!.auth!, {
      login_email: 'test@example.com', login_password: 'test-password',
    })

    const update = await start(schedule)

    expect(requests).toEqual(['/api/jwt', '/login', '/api/services/persistent_notification/dismiss'])
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss a notice just because the cached token was recently obtained', async () => {
    const requests = captureFetch()
    await start(scheduleWithExpiry(Date.now() / 1000 + 3600, 1))
    expect(requests).toHaveLength(0)
  })
})
