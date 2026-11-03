/**
 * @module tests/unit/check-in-alignment
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { CheckInAligner, parseNextCheckInAt } from '../../lib/scheduler/check-in-alignment.js'

const NOW = Date.parse('2026-11-03T12:00:00Z')
const LEAD_MS = 120_000
const MINUTE = 60_000

describe('parseNextCheckInAt', () => {
  it('reads the upload response of the TRMNL image endpoint', () => {
    const body = '{"data":{"message":"Image upload queued","next_check_in_at":"2026-11-03T12:10:00.000Z"}}'
    expect(parseNextCheckInAt(body)).toBe(NOW + 10 * MINUTE)
  })

  it('is undefined when the server gives no time', () => {
    expect(parseNextCheckInAt('{"data":{"message":"Image upload queued"}}')).toBeUndefined()
  })

  it('is undefined for a body that is not JSON', () => {
    expect(parseNextCheckInAt('ok')).toBeUndefined()
  })

  it('is undefined for a time that does not parse', () => {
    expect(parseNextCheckInAt('{"data":{"next_check_in_at":"soon"}}')).toBeUndefined()
  })
})

describe('CheckInAligner', () => {
  let aligner: CheckInAligner
  let timers: { ms: number; fn: () => void; cleared: boolean }[]

  beforeEach(() => {
    timers = []
    aligner = new CheckInAligner(LEAD_MS, {
      set: (fn, ms) => {
        const timer = { ms, fn, cleared: false }
        timers.push(timer)
        return timer
      },
      clear: (timer) => {
        ;(timer as { cleared: boolean }).cleared = true
      },
    })
  })

  it('schedules a capture one lead before the check-in', () => {
    const target = aligner.scheduleCapture('s1', NOW + 10 * MINUTE, () => {}, NOW)
    expect(target).toBe(NOW + 8 * MINUTE)
    expect(timers[0]?.ms).toBe(8 * MINUTE)
  })

  it('reports the pending capture until it fires', () => {
    aligner.scheduleCapture('s1', NOW + 10 * MINUTE, () => {}, NOW)
    expect(aligner.pendingAt('s1')).toBe(NOW + 8 * MINUTE)
    timers[0]!.fn()
    expect(aligner.pendingAt('s1')).toBeNull()
  })

  it('runs the capture when the timer fires', () => {
    let ran = 0
    aligner.scheduleCapture('s1', NOW + 10 * MINUTE, () => { ran++ }, NOW)
    timers[0]!.fn()
    expect(ran).toBe(1)
  })

  it('schedules nothing when the check-in is already inside the lead', () => {
    expect(aligner.scheduleCapture('s1', NOW + MINUTE, () => {}, NOW)).toBeNull()
    expect(timers).toHaveLength(0)
  })

  it('schedules nothing for a check-in more than a day away', () => {
    expect(aligner.scheduleCapture('s1', NOW + 25 * 60 * MINUTE, () => {}, NOW)).toBeNull()
  })

  it('schedules nothing when no time was given', () => {
    expect(aligner.scheduleCapture('s1', undefined, () => {}, NOW)).toBeNull()
  })

  it('starts the capture earlier for a schedule whose runs are slow', () => {
    aligner.recordRunDuration('s1', 90_000)
    aligner.recordRunDuration('s1', 150_000)
    // twice the slowest recent run plus a margin, instead of the 2 min lead
    expect(aligner.leadMsFor('s1')).toBe(2 * 150_000 + 30_000)
    expect(aligner.scheduleCapture('s1', NOW + 10 * MINUTE, () => {}, NOW)).toBe(NOW + 10 * MINUTE - 330_000)
  })

  it('keeps the configured lead for a schedule whose runs are quick', () => {
    aligner.recordRunDuration('s1', 8_000)
    expect(aligner.leadMsFor('s1')).toBe(LEAD_MS)
  })

  it('forgets runs older than the last five', () => {
    aligner.recordRunDuration('s1', 200_000)
    for (let i = 0; i < 5; i++) aligner.recordRunDuration('s1', 10_000)
    expect(aligner.leadMsFor('s1')).toBe(LEAD_MS)
  })

  it('never leads by more than fifteen minutes', () => {
    aligner.recordRunDuration('s1', 20 * MINUTE)
    expect(aligner.leadMsFor('s1')).toBe(15 * MINUTE)
  })

  it('replaces an earlier capture for the same schedule', () => {
    aligner.scheduleCapture('s1', NOW + 10 * MINUTE, () => {}, NOW)
    aligner.scheduleCapture('s1', NOW + 20 * MINUTE, () => {}, NOW)
    expect(timers[0]?.cleared).toBe(true)
    expect(aligner.pendingAt('s1')).toBe(NOW + 18 * MINUTE)
  })

  it('clears one schedule', () => {
    aligner.scheduleCapture('s1', NOW + 10 * MINUTE, () => {}, NOW)
    aligner.clear('s1')
    expect(timers[0]?.cleared).toBe(true)
    expect(aligner.pendingAt('s1')).toBeNull()
  })

  it('stops every schedule', () => {
    aligner.scheduleCapture('s1', NOW + 10 * MINUTE, () => {}, NOW)
    aligner.scheduleCapture('s2', NOW + 10 * MINUTE, () => {}, NOW)
    aligner.stopAll()
    expect(timers.every((t) => t.cleared)).toBe(true)
  })
})
