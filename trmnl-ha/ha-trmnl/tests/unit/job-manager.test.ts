/**
 * @module tests/unit/job-manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { JobManager, startIntervalJob } from '../../lib/scheduler/job-manager.js'
import { sleep } from '../../lib/sleep.js'
import type { Schedule } from '../../types/domain.js'

type JobInput = Pick<Schedule, 'id' | 'name' | 'cron' | 'interval_minutes'>

function buildJobInput(overrides: Partial<JobInput> = {}): JobInput {
  return {
    id: 'job-1',
    name: 'Job',
    cron: '* * * * *',
    interval_minutes: null,
    ...overrides,
  }
}

const noop = (): void => {}

describe('JobManager', () => {
  let manager: JobManager

  beforeEach(() => {
    manager = new JobManager()
  })

  afterEach(() => {
    manager.stopAll()
  })

  describe('#upsertJob', () => {
    it('registers an interval-mode job', () => {
      manager.upsertJob(buildJobInput({ interval_minutes: 15 }), noop)
      expect(manager.jobCount).toBe(1)
    })

    it('registers a cron-mode job', () => {
      manager.upsertJob(buildJobInput({ cron: '*/5 * * * *' }), noop)
      expect(manager.jobCount).toBe(1)
    })

    it('rejects an invalid cron expression', () => {
      expect(manager.upsertJob(buildJobInput({ cron: 'nope' }), noop)).toBe(false)
    })

    it('rejects a zero interval', () => {
      expect(manager.upsertJob(buildJobInput({ interval_minutes: 0 }), noop)).toBe(false)
    })

    it('rejects a fractional interval', () => {
      expect(manager.upsertJob(buildJobInput({ interval_minutes: 1.5 }), noop)).toBe(false)
    })

    it('replaces an existing job for the same id', () => {
      manager.upsertJob(buildJobInput({ cron: '* * * * *' }), noop)
      manager.upsertJob(buildJobInput({ interval_minutes: 30 }), noop)

      expect(manager.jobCount).toBe(1)
    })

    it('leaves the existing job untouched when the new config is invalid', () => {
      manager.upsertJob(buildJobInput({ interval_minutes: 30 }), noop)
      manager.upsertJob(buildJobInput({ interval_minutes: -1 }), noop)

      expect(manager.jobCount).toBe(1)
    })
  })

  describe('#removeJob', () => {
    it('removes a registered job', () => {
      manager.upsertJob(buildJobInput(), noop)
      manager.removeJob('job-1')

      expect(manager.jobCount).toBe(0)
    })

    it('returns false for an unknown id', () => {
      expect(manager.removeJob('missing')).toBe(false)
    })
  })

  describe('#pruneInactiveJobs', () => {
    it('drops jobs absent from the active set', () => {
      manager.upsertJob(buildJobInput({ id: 'keep' }), noop)
      manager.upsertJob(buildJobInput({ id: 'drop' }), noop)
      manager.pruneInactiveJobs(new Set(['keep']))

      expect(manager.jobCount).toBe(1)
    })
  })
})

describe('.startIntervalJob', () => {
  it('reschedules only after the callback resolves (no overlap)', async () => {
    let active = 0
    let maxActive = 0
    const job = startIntervalJob(10, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await sleep(15)
      active--
    })

    await sleep(80)
    job.stop()
    await sleep(20)

    expect(maxActive).toBe(1)
  })

  it('stops firing after stop()', async () => {
    let calls = 0
    const job = startIntervalJob(10, () => {
      calls++
    })

    await sleep(35)
    job.stop()
    const settled = calls
    await sleep(30)

    expect(calls).toBe(settled)
  })
})
