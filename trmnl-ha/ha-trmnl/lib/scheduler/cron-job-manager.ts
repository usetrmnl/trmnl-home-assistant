/**
 * Cron Job Manager Module
 *
 * Manages lifecycle of cron jobs for scheduled screenshot capture and webhook delivery.
 * Wraps node-cron library with schedule-specific operations and stale data prevention.
 *
 * Stale Data Prevention:
 * Cron callbacks capture schedule data in closures. When schedules are updated
 * (new URL, new webhook, etc.), existing jobs would continue using OLD data.
 * Solution: Always stop + recreate jobs on upsert, ensuring fresh closures.
 *
 * NOTE: This module is owned by Scheduler class - don't instantiate directly.
 * NOTE: When modifying upsertJob(), preserve the destroy-before-recreate pattern.
 *
 * @module lib/scheduler/cron-job-manager
 */

import cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import type { Schedule } from '../../types/domain.js'
import { cronLogger } from '../logger.js'

const log = cronLogger()

/** Extended scheduled task with attached cron expression metadata */
interface ExtendedScheduledTask extends ScheduledTask {
  cronExpression: string
}

/**
 * Manages cron job lifecycle with automatic stale data prevention.
 */
export class CronJobManager {
  #jobs = new Map<string, ExtendedScheduledTask>()

  get jobs(): Map<string, ExtendedScheduledTask> {
    return this.#jobs
  }

  get jobCount(): number {
    return this.#jobs.size
  }

  /**
   * Creates or updates a cron job for a schedule (upsert operation).
   *
   * @param schedule - Schedule object with id, name, cron expression
   * @param callback - Function to execute when cron fires
   * @returns True if job was created/updated, false if validation failed
   */
  upsertJob(
    schedule: Pick<Schedule, 'id' | 'name' | 'cron'>,
    callback: () => void
  ): boolean {
    if (!cron.validate(schedule.cron)) {
      log.error`Invalid cron expression for ${schedule.name}: ${schedule.cron}`
      return false
    }

    // Destroy existing job (not just stop) so node-cron drops it from its
    // global registry — stopped tasks otherwise accumulate forever
    const existingJob = this.#jobs.get(schedule.id)
    if (existingJob) {
      existingJob.destroy()
    }

    // Create new job with fresh callback
    const job = cron.schedule(schedule.cron, callback) as ExtendedScheduledTask
    job.cronExpression = schedule.cron
    this.#jobs.set(schedule.id, job)

    log.info`Scheduled: ${schedule.name} (${schedule.cron})`

    return true
  }

  /**
   * Removes a single cron job by schedule ID.
   *
   * @param id - Schedule ID to remove
   * @param name - Optional schedule name for better logging
   * @returns True if job was removed, false if not found
   */
  removeJob(id: string, name?: string): boolean {
    const job = this.#jobs.get(id)
    if (job) {
      job.destroy()
      this.#jobs.delete(id)
      const logName = name ? name : id
      log.info`Stopped job: ${logName}`
      return true
    }
    return false
  }

  /**
   * Removes jobs for schedules that no longer exist (bulk cleanup).
   *
   * @param activeIds - Set of currently active schedule IDs
   * @returns Number of jobs pruned (stopped and removed)
   */
  pruneInactiveJobs(activeIds: Set<string>): number {
    let prunedCount = 0
    for (const [id, job] of this.#jobs) {
      if (!activeIds.has(id)) {
        job.destroy()
        this.#jobs.delete(id)
        log.info`Removed deleted schedule job: ${id}`
        prunedCount++
      }
    }
    return prunedCount
  }

  /**
   * Stops all cron jobs and clears the jobs Map (shutdown operation).
   */
  stopAll(): void {
    for (const [_id, job] of this.#jobs) {
      job.destroy()
    }
    this.#jobs.clear()
  }
}
