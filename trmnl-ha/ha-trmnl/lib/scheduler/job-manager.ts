/**
 * Job Manager Module
 *
 * Runs each schedule on one of two strategies behind a uniform stop():
 * interval schedules on a self-rescheduling timer, cron schedules (the advanced
 * escape hatch) on node-cron.
 *
 * Jobs are always destroyed and recreated on upsert so the cron callback closes
 * over fresh schedule data rather than a stale copy.
 *
 * @module lib/scheduler/job-manager
 */

import cron from 'node-cron'
import type { Schedule } from '../../types/domain.js'
import { cronLogger } from '../logger.js'

const log = cronLogger()

const MS_PER_MINUTE = 60_000

/** A running schedule, stoppable regardless of which strategy backs it. */
export interface ManagedJob {
  stop(): void
}

type ScheduleCallback = () => void | Promise<void>

/**
 * Starts an interval timer that reschedules only after each run resolves, so a
 * slow capture can never stack onto the next tick. The first run is one interval
 * away, matching cron (which also waits for the next matching time).
 */
export function startIntervalJob(
  intervalMs: number,
  callback: ScheduleCallback,
): ManagedJob {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async (): Promise<void> => {
    try {
      await callback()
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), intervalMs)
    }
  }

  timer = setTimeout(() => void tick(), intervalMs)

  return {
    stop(): void {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}

export class JobManager {
  #jobs = new Map<string, ManagedJob>()

  get jobCount(): number {
    return this.#jobs.size
  }

  /**
   * Creates or replaces a schedule's job. Returns false (leaving any existing
   * job untouched) when the schedule's interval or cron is invalid.
   */
  upsertJob(
    schedule: Pick<Schedule, 'id' | 'name' | 'cron' | 'interval_minutes'>,
    callback: ScheduleCallback,
  ): boolean {
    const job = this.#createJob(schedule, callback)
    if (!job) return false

    this.#jobs.get(schedule.id)?.stop()
    this.#jobs.set(schedule.id, job)
    return true
  }

  /** Builds the job for a schedule's mode, or null when its config is invalid. */
  #createJob(
    schedule: Pick<Schedule, 'name' | 'cron' | 'interval_minutes'>,
    callback: ScheduleCallback,
  ): ManagedJob | null {
    const { interval_minutes } = schedule

    if (interval_minutes != null) {
      if (!Number.isInteger(interval_minutes) || interval_minutes < 1) {
        log.error`Invalid interval for ${schedule.name}: ${interval_minutes}`
        return null
      }
      log.info`Scheduled: ${schedule.name} (every ${interval_minutes} min)`
      return startIntervalJob(interval_minutes * MS_PER_MINUTE, callback)
    }

    if (!cron.validate(schedule.cron)) {
      log.error`Invalid cron expression for ${schedule.name}: ${schedule.cron}`
      return null
    }
    log.info`Scheduled: ${schedule.name} (${schedule.cron})`
    const task = cron.schedule(schedule.cron, callback)
    return { stop: () => task.destroy() }
  }

  removeJob(id: string, name?: string): boolean {
    const job = this.#jobs.get(id)
    if (!job) return false

    job.stop()
    this.#jobs.delete(id)
    log.info`Stopped job: ${name ?? id}`
    return true
  }

  /** Stops jobs whose schedules no longer exist. */
  pruneInactiveJobs(activeIds: Set<string>): number {
    let pruned = 0
    for (const [id, job] of this.#jobs) {
      if (!activeIds.has(id)) {
        job.stop()
        this.#jobs.delete(id)
        log.info`Removed deleted schedule job: ${id}`
        pruned++
      }
    }
    return pruned
  }

  stopAll(): void {
    for (const [, job] of this.#jobs) job.stop()
    this.#jobs.clear()
  }
}
