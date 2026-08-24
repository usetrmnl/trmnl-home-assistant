/**
 * Unit tests for Scheduler change detection.
 *
 * changedSnapshot() decides whether the reload loop re-registers cron jobs:
 * only when schedules.json content actually changed.
 *
 * @module tests/unit/scheduler
 */

import { describe, it, expect } from 'bun:test'
import { changedSnapshot } from '../../scheduler.js'
import {
  buildByosSchedule,
  buildSchedule,
} from '../helpers/schedule-fixtures.js'
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
