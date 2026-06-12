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
import type { Schedule } from '../../types/domain.js'

/** Minimal valid Schedule for testing */
function buildSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'test-id-1',
    name: 'Test Schedule',
    enabled: true,
    cron: '*/30 * * * *',
    webhook_url: null,
    ha_mode: true,
    dashboard_path: '/lovelace/0',
    viewport: { width: 800, height: 480 },
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    ...overrides,
  } as Schedule
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

  it('returns null for unchanged content loaded as fresh objects', () => {
    const first = changedSnapshot([buildSchedule()], '')!

    // Reload parses the file anew each tick — equal content, new identity
    expect(changedSnapshot([buildSchedule()], first)).toBeNull()
  })

  it('returns a new snapshot when a field changes', () => {
    const first = changedSnapshot([buildSchedule()], '')!
    const edited = [buildSchedule({ cron: '* * * * *' })]

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
})
