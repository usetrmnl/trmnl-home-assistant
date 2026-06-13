/**
 * @module tests/unit/cron-interval
 */

import { describe, it, expect } from 'bun:test'
import { cronToIntervalMinutes } from '../../lib/scheduler/cron-interval.js'

describe('.cronToIntervalMinutes', () => {
  it('maps every-minute to 1', () => {
    expect(cronToIntervalMinutes('* * * * *')).toBe(1)
  })

  it('maps every-N-minutes', () => {
    expect(cronToIntervalMinutes('*/10 * * * *')).toBe(10)
  })

  it('maps top-of-hour to 60', () => {
    expect(cronToIntervalMinutes('0 * * * *')).toBe(60)
  })

  it('maps every-N-hours to minutes', () => {
    expect(cronToIntervalMinutes('0 */3 * * *')).toBe(180)
  })

  it('trims surrounding whitespace', () => {
    expect(cronToIntervalMinutes('  */5 * * * * ')).toBe(5)
  })

  it('returns null for weekday-specific cron', () => {
    expect(cronToIntervalMinutes('0 9 * * 1-5')).toBeNull()
  })

  it('returns null for a fixed time of day', () => {
    expect(cronToIntervalMinutes('0 0 * * *')).toBeNull()
  })

  it('returns null for multiple specific hours', () => {
    expect(cronToIntervalMinutes('0 8,18 * * *')).toBeNull()
  })

  it('returns null for a 6-field (seconds) expression', () => {
    expect(cronToIntervalMinutes('*/10 * * * * *')).toBeNull()
  })

  it('returns null for an out-of-range minute step', () => {
    expect(cronToIntervalMinutes('*/60 * * * *')).toBeNull()
  })

  it('returns null for a malformed expression', () => {
    expect(cronToIntervalMinutes('not-a-cron')).toBeNull()
  })
})
