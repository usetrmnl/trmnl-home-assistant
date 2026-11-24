/**
 * Regression tests for final-pixel comparison and delivery lifecycle.
 * @module tests/unit/unchanged-upload
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import gmLib from 'gm'
import { MAX_UNCHANGED_UPLOAD_AGE_MS, pixelSignature } from '../../lib/scheduler/unchanged-upload.js'
import { ScheduleExecutor } from '../../lib/scheduler/schedule-executor.js'
import { JobManager } from '../../lib/scheduler/job-manager.js'
import { CheckInAligner } from '../../lib/scheduler/check-in-alignment.js'
import * as sleepModule from '../../lib/sleep.js'
import { Scheduler } from '../../scheduler.js'
import * as scheduleStore from '../../lib/scheduleStore.js'
import { buildSchedule, buildByosSchedule } from '../helpers/schedule-fixtures.js'
import { captureFetch, restoreFetch } from '../helpers/fetch-mock.js'

const gm = gmLib.subClass({ imageMagick: true })

/** Generate real PNG encodings; metadata and compression deliberately differ. */
async function png(color: string, comment = '', size = 8): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const image = gm(size, size, color)
    // gm drops empty arguments; passing an empty comment consumes -define on IM 7.1.1.
    if (comment) image.out('-set', 'comment', comment)
    image.out('-define', `png:compression-level=${comment ? 9 : 0}`)
      .toBuffer('PNG', (err, buffer) => err ? reject(err) : resolve(buffer))
  })
}

describe('unchanged raw uploads', () => {
  let output: string
  let image: Buffer
  let executor: ScheduleExecutor
  let requests: ReturnType<typeof captureFetch>
  let restoreStore: (() => void) | undefined
  let clock: ReturnType<typeof spyOn<typeof Date, 'now'>> | undefined
  const schedule = () => buildSchedule({
    webhook_url: 'https://example.com/image/test', skip_unchanged: true,
    interval_minutes: 30,
  })

  beforeEach(async () => {
    restoreStore = undefined
    clock = undefined
    output = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-unchanged-'))
    image = await png('white')
    executor = new ScheduleExecutor(async () => image, output)
    requests = captureFetch()
    const store = spyOn(scheduleStore, 'loadSchedules').mockResolvedValue([schedule()])
    restoreStore = () => store.mockRestore()
  })

  afterEach(() => {
    clock?.mockRestore()
    restoreStore?.()
    restoreFetch()
    fs.rmSync(output, { recursive: true, force: true })
  })

  it('compares decoded pixels, including dimensions, rather than PNG encoding', async () => {
    const encoded = await png('white', 'different metadata')
    expect(encoded.equals(image)).toBe(false)
    expect(await pixelSignature(encoded)).toBe(await pixelSignature(image))
    expect(await pixelSignature(await png('red'))).not.toBe(await pixelSignature(image))
    expect(await pixelSignature(await png('black'))).not.toBe(await pixelSignature(image))
    expect(await pixelSignature(await png('white', '', 16))).not.toBe(await pixelSignature(image))
  })

  it('uploads first, skips unchanged, then uploads changed pixels', async () => {
    const s = schedule()
    expect((await executor.call(s)).webhook?.attempted).toBe(true)
    image = await png('white', 'metadata only')
    const skipped = await executor.call(s)
    expect(skipped.webhook).toEqual({ attempted: false, success: true, skipped: 'unchanged' })
    expect(fs.existsSync(skipped.savedPath)).toBe(true)
    expect(s.interval_minutes).toBe(30)
    image = await png('red')
    expect((await executor.call(s)).webhook?.attempted).toBe(true)
    expect(requests.length).toBe(2)
  })

  it('bounds skips from the last acknowledged upload, without sliding the deadline', async () => {
    const start = Date.parse('2030-01-01T00:00:00Z')
    let now = start
    clock = spyOn(Date, 'now').mockImplementation(() => now)
    const s = schedule()
    await executor.call(s)
    for (const elapsed of [60_000, MAX_UNCHANGED_UPLOAD_AGE_MS - 1]) {
      now = start + elapsed
      expect((await executor.call(s)).webhook?.skipped).toBe('unchanged')
    }
    now = start + MAX_UNCHANGED_UPLOAD_AGE_MS
    expect((await executor.call(s)).webhook?.attempted).toBe(true)
    now += MAX_UNCHANGED_UPLOAD_AGE_MS - 1
    expect((await executor.call(s)).webhook?.skipped).toBe('unchanged')
    now += 1
    expect((await executor.call(s)).webhook?.attempted).toBe(true)
    expect(requests.length).toBe(3)
  })

  it('starts the age at acknowledgment rather than capture start', async () => {
    let now = Date.parse('2030-01-01T00:00:00Z')
    clock = spyOn(Date, 'now').mockImplementation(() => now)
    const okFetch = globalThis.fetch
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      now += 120_000
      return okFetch(...args)
    }) as unknown as typeof fetch
    await executor.call(schedule())
    globalThis.fetch = okFetch
    now += MAX_UNCHANGED_UPLOAD_AGE_MS - 1
    expect((await executor.call(schedule())).webhook?.skipped).toBe('unchanged')
    expect(requests.length).toBe(1)
  })

  it('resets the age after successful manual and changed-image sends', async () => {
    let now = Date.parse('2030-01-01T00:00:00Z')
    clock = spyOn(Date, 'now').mockImplementation(() => now)
    await executor.call(schedule())
    now += MAX_UNCHANGED_UPLOAD_AGE_MS - 1
    await executor.call(schedule(), { force: true })
    now += MAX_UNCHANGED_UPLOAD_AGE_MS - 1
    expect((await executor.call(schedule())).webhook?.skipped).toBe('unchanged')
    image = await png('red')
    await executor.call(schedule())
    now += MAX_UNCHANGED_UPLOAD_AGE_MS - 1
    expect((await executor.call(schedule())).webhook?.skipped).toBe('unchanged')
    expect(requests.length).toBe(3)
  })

  it('does not extend suppression after the clock moves backwards', async () => {
    let now = Date.parse('2030-01-01T00:00:00Z')
    clock = spyOn(Date, 'now').mockImplementation(() => now)
    await executor.call(schedule())
    now -= 1
    expect((await executor.call(schedule())).webhook?.attempted).toBe(true)
  })

  it('retains only a still-future check-in, without predicting the next one', async () => {
    const start = Date.parse('2030-01-01T00:00:00Z')
    let now = start
    clock = spyOn(Date, 'now').mockImplementation(() => now)
    globalThis.fetch = (async () => Response.json({ data: {
      next_check_in_at: new Date(start + 30 * 60_000).toISOString(),
    } })) as unknown as typeof fetch
    await executor.call(schedule())
    now += 60_000
    expect((await executor.call(schedule())).webhook?.nextCheckInAt).toBe(start + 30 * 60_000)
    now = start + 30 * 60_000
    const expired = (await executor.call(schedule())).webhook
    expect(expired?.skipped).toBe('unchanged')
    expect(expired?.nextCheckInAt).toBeUndefined()
  })

  it('retries an expired baseline after a refused refresh instead of suppressing it', async () => {
    let now = Date.parse('2030-01-01T00:00:00Z')
    clock = spyOn(Date, 'now').mockImplementation(() => now)
    await executor.call(schedule())
    now += MAX_UNCHANGED_UPLOAD_AGE_MS
    const okFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('', { status: 429 })) as unknown as typeof fetch
    expect((await executor.call(schedule())).webhook?.success).toBe(false)
    globalThis.fetch = okFetch
    expect((await executor.call(schedule())).webhook?.attempted).toBe(true)
  })

  it('keeps existing schedules opted out and local captures local', async () => {
    const s = schedule()
    delete s.skip_unchanged
    await executor.call(s)
    await executor.call(s)
    await executor.call({ ...s, webhook_url: null, skip_unchanged: true })
    expect(requests.length).toBe(2)
  })

  it('forces manual Send Now through the Scheduler entry point', async () => {
    const s = schedule()
    await executor.call(s)
    const scheduler = new Scheduler(async () => image)
    try {
      await scheduler.executeNow(s.id)
      await scheduler.executeNow(s.id)
      expect(requests.length).toBe(3)
    } finally { scheduler.stop() }
  })

  it('preserves the server check-in on skipped runs, then accepts fresh alignment', async () => {
    let tick: (() => void | Promise<void>) | undefined
    const job = spyOn(JobManager.prototype, 'upsertJob').mockImplementation((s, callback) => {
      expect(s.interval_minutes).toBe(30)
      tick = callback
      return true
    })
    const alignment = spyOn(CheckInAligner.prototype, 'scheduleCapture').mockReturnValue(null)
    const sleeping = spyOn(sleepModule, 'sleep').mockResolvedValue(undefined)
    globalThis.fetch = (async () => Response.json({ data: {
      next_check_in_at: '2030-01-01T12:00:00Z',
    } })) as unknown as typeof fetch
    const scheduler = new Scheduler(async () => image)
    try {
      scheduler.start()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(tick).toBeDefined()
      await tick!()
      expect(alignment.mock.calls.at(-1)?.[1]).toBe(Date.parse('2030-01-01T12:00:00Z'))
      await tick!()
      expect(alignment.mock.calls.at(-1)?.[1]).toBe(Date.parse('2030-01-01T12:00:00Z'))
      image = await png('red')
      await tick!()
      expect(alignment.mock.calls.at(-1)?.[1]).toBe(Date.parse('2030-01-01T12:00:00Z'))
    } finally {
      scheduler.stop()
      job.mockRestore()
      alignment.mockRestore()
      sleeping.mockRestore()
    }
  })

  it('sends once again after executor restart', async () => {
    await executor.call(schedule())
    executor = new ScheduleExecutor(async () => image, output)
    await executor.call(schedule())
    expect(requests.length).toBe(2)
  })

  it('uploads when destination, output config or headers change', async () => {
    const s = schedule()
    await executor.call(s)
    await executor.call({ ...s, webhook_url: 'https://example.com/image/other' })
    await executor.call({ ...s, rotate: 90 })
    await executor.call({ ...s, webhook_headers: { Authorization: 'synthetic-token' } })
    expect(requests.length).toBe(4)
  })

  it('does not suppress a restoration after another schedule changes the same URL', async () => {
    await executor.call(schedule())
    image = await png('black')
    await executor.call({ ...schedule(), id: 'other', skip_unchanged: false })
    image = await png('white')
    await executor.call(schedule())
    expect(requests.length).toBe(3)
  })

  it('serializes concurrent identical deliveries to the same URL', async () => {
    await Promise.all([executor.call(schedule()), executor.call(schedule())])
    expect(requests.length).toBe(1)
  })

  it.each([503, 429, 401])('does not keep a stale baseline after HTTP %i', async (status) => {
    await executor.call(schedule())
    const okFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('', { status })) as unknown as typeof fetch
    image = await png('black')
    expect((await executor.call(schedule())).webhook?.success).toBe(false)
    globalThis.fetch = okFetch
    // The failed send may have reached the server; even the old pixels must send.
    image = await png('white')
    expect((await executor.call(schedule())).webhook?.attempted).toBe(true)
    expect(requests.length).toBe(2)
  })

  it('does not keep a stale baseline after an uncertain network failure', async () => {
    await executor.call(schedule())
    const okFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('connection reset') }) as unknown as typeof fetch
    image = await png('black')
    expect((await executor.call(schedule())).webhook?.success).toBe(false)
    globalThis.fetch = okFetch
    image = await png('white')
    await executor.call(schedule())
    expect(requests.length).toBe(2)
  })

  it('fails open when pixel comparison fails', async () => {
    image = Buffer.from('invalid image')
    await executor.call(schedule())
    await executor.call(schedule())
    expect(requests.length).toBe(2)
  })

  it('leaves BYOS deliveries unchanged even if the option is set', async () => {
    const s = buildByosSchedule({ skip_unchanged: true })
    await executor.call(s)
    await executor.call(s)
    expect(requests.length).toBe(2)
  })
})
