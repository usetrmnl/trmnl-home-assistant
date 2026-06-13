/**
 * Scheduler Module
 *
 * High-level orchestrator for automated screenshot capture on cron schedules.
 * Manages lifecycle, hot-reloads schedule changes, and delegates execution to specialized modules.
 *
 * Responsibilities:
 * 1. Lifecycle Management - start() initializes, stop() cleans up
 * 2. Hot-Reload - Periodic schedule file reload (every 60s by default)
 * 3. Cron Orchestration - Delegates to CronJobManager for job management
 * 4. Execution Delegation - Delegates to ScheduleExecutor for screenshot capture
 * 5. Manual Execution - "Send Now" API for on-demand screenshot triggers
 *
 * NOTE: Scheduler owns CronJobManager and ScheduleExecutor instances.
 * NOTE: When modifying reload logic, preserve upsert/prune synchronization pattern.
 *
 * @module scheduler
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadSchedules, updateSchedule } from './lib/scheduleStore.js'
import { ScheduleExecutor, type ScreenshotFunction, type ExecutionResult } from './lib/scheduler/schedule-executor.js'
import { CronJobManager } from './lib/scheduler/cron-job-manager.js'
import { CooldownTracker } from './lib/scheduler/cooldown-tracker.js'
import {
  buildRefreshedAuthUpdate,
  getValidAccessToken,
  isRefreshable,
} from './lib/scheduler/byos-auth.js'
import { sleep } from './lib/sleep.js'
import {
  SCHEDULER_RELOAD_INTERVAL_MS,
  SCHEDULER_OUTPUT_DIR_NAME,
  SCHEDULER_JITTER_MAX_MS,
  SCHEDULER_COOLDOWN_DEFAULT_MS,
  DATA_DIR,
} from './const.js'
import type { Schedule } from './types/domain.js'
import { schedulerLogger } from './lib/logger.js'

const log = schedulerLogger()

/**
 * Detects whether loaded schedules differ from the previous reload.
 *
 * @param schedules - Schedules loaded from disk this tick
 * @param lastSnapshot - Serialized snapshot from the previous reload
 * @returns New snapshot string when changed, null when identical
 */
export function changedSnapshot(
  schedules: Schedule[],
  lastSnapshot: string,
): string | null {
  const snapshot = JSON.stringify(schedules)
  return snapshot === lastSnapshot ? null : snapshot
}

/**
 * Random delay in ms within [0, maxMs), used to desynchronize cron fires across
 * installs so they don't all hit the TRMNL server on the same second.
 */
export function jitterMs(maxMs: number, rand: () => number = Math.random): number {
  if (maxMs <= 0) return 0
  return Math.floor(rand() * maxMs)
}

/**
 * High-level scheduler orchestrating cron jobs and screenshot execution.
 */
export class Scheduler {
  #outputDir: string
  #cronManager: CronJobManager
  #executor: ScheduleExecutor
  #reloadInterval: ReturnType<typeof setInterval> | undefined
  #lastSnapshot = ''
  #refreshingTokens = false
  #deadTokensWarned = new Set<string>()
  #cooldowns = new CooldownTracker(SCHEDULER_COOLDOWN_DEFAULT_MS)

  /**
   * Creates scheduler instance with injected screenshot function.
   *
   * @param screenshotFn - Screenshot capture function (async)
   */
  constructor(screenshotFn: ScreenshotFunction) {
    this.#outputDir = path.join(DATA_DIR, SCHEDULER_OUTPUT_DIR_NAME)
    this.#cronManager = new CronJobManager()
    this.#executor = new ScheduleExecutor(screenshotFn, this.#outputDir)

    // Ensure output directory exists
    if (!fs.existsSync(this.#outputDir)) {
      fs.mkdirSync(this.#outputDir, { recursive: true })
    }
  }

  /**
   * Starts the scheduler with immediate load and periodic reload.
   */
  start(): void {
    log.info`Starting scheduler...`
    // Fire-and-forget initial load (errors logged by loadAndSchedule)
    void this.#loadAndSchedule()
    void this.#keepByosTokensFresh()

    // The same tick keeps BYOS tokens fresh: the server only accepts
    // refreshes while the access token is still valid, so refreshing at
    // send time alone fails for schedules running less often than the
    // token lifetime
    this.#reloadInterval = setInterval(() => {
      void this.#loadAndSchedule()
      void this.#keepByosTokensFresh()
    }, SCHEDULER_RELOAD_INTERVAL_MS)
  }

  /**
   * Stops the scheduler and cleans up all cron jobs.
   */
  stop(): void {
    log.info`Stopping scheduler...`
    clearInterval(this.#reloadInterval)
    this.#cronManager.stopAll()
  }

  /**
   * Manually executes a schedule by ID, bypassing cron schedule.
   *
   * @param scheduleId - UUID of schedule to execute
   * @returns Result with success status and saved path
   * @throws Error if schedule not found or execution fails
   */
  async executeNow(scheduleId: string): Promise<ExecutionResult> {
    const schedules = await loadSchedules()
    const schedule = schedules.find((s) => s.id === scheduleId)

    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`)
    }

    log.info`Manual execution: ${schedule.name}`

    return await this.#executor.call(schedule)
  }

  /**
   * Loads schedules from file and synchronizes cron jobs (upsert/prune pattern).
   */
  async #loadAndSchedule(): Promise<void> {
    const schedules = await loadSchedules()

    // Re-registering unchanged jobs every tick churns node-cron tasks and
    // floods the log
    const snapshot = changedSnapshot(schedules, this.#lastSnapshot)
    if (snapshot === null) return
    this.#lastSnapshot = snapshot

    const activeIds = new Set<string>()
    const enabledSchedules = schedules.filter((s) => s.enabled)

    log.info`Loaded ${schedules.length} schedule(s), ${enabledSchedules.length} enabled`

    for (const schedule of schedules) {
      if (!schedule.enabled) {
        log.debug`Schedule "${schedule.name}" is disabled`
        this.#cronManager.removeJob(schedule.id, schedule.name)
        continue
      }

      // Log active schedules at info level for visibility
      const webhookStatus = schedule.webhook_url ? '→ webhook' : '→ file only'
      log.info`  • ${schedule.name} [${schedule.cron}] ${webhookStatus}`

      activeIds.add(schedule.id)

      // Create/update cron job (delegates to CronJobManager)
      this.#cronManager.upsertJob(schedule, () => {
        this.#runSchedule(schedule)
      })
    }

    // Remove jobs for deleted schedules (delegates to CronJobManager)
    this.#cronManager.pruneInactiveJobs(activeIds)
  }

  /**
   * Proactively refreshes BYOS tokens before they expire.
   *
   * Disabled schedules are included so paused schedules keep working auth.
   * Tokens already past the server's expiry are skipped — the server would
   * reject the refresh, and the send path surfaces the re-auth error once
   * instead of every tick.
   */
  async #keepByosTokensFresh(): Promise<void> {
    if (this.#refreshingTokens) return
    this.#refreshingTokens = true
    try {
      const schedules = await loadSchedules()
      for (const schedule of schedules) {
        const auth = schedule.webhook_format?.byosConfig?.auth
        if (!schedule.webhook_url || !auth?.enabled) continue

        if (!isRefreshable(auth)) {
          if (auth.access_token && !this.#deadTokensWarned.has(schedule.id)) {
            this.#deadTokensWarned.add(schedule.id)
            log.warn`BYOS tokens for "${schedule.name}" expired beyond the refresh window — re-authenticate in the schedule settings`
          }
          continue
        }
        this.#deadTokensWarned.delete(schedule.id)

        await getValidAccessToken(schedule.webhook_url, auth, (newTokens) => {
          log.info`Refreshed BYOS tokens for schedule "${schedule.name}"`
          const updates = buildRefreshedAuthUpdate(schedule, newTokens)
          if (!updates) return

          void updateSchedule(schedule.id, updates).catch((err: unknown) => {
            log.error`Failed to persist refreshed BYOS tokens: ${(err as Error).message}`
          })
        })
      }
    } catch (err) {
      log.error`BYOS token keepalive failed: ${(err as Error).message}`
    } finally {
      this.#refreshingTokens = false
    }
  }

  /** Cron callback: skips while cooling down, jitters, then executes. */
  async #runSchedule(schedule: Schedule): Promise<void> {
    const blockedUntil = this.#cooldowns.blockedUntil(schedule.id)
    if (blockedUntil !== null) {
      log.info`Skipping "${schedule.name}": server cooldown active until ${new Date(blockedUntil).toISOString()}`
      return
    }

    const delay = jitterMs(SCHEDULER_JITTER_MAX_MS)
    if (delay > 0) {
      log.debug`Jittering ${delay}ms before "${schedule.name}"`
      await sleep(delay)
    }

    log.info`Cron triggered: ${schedule.name}`
    try {
      const result = await this.#executor.call(schedule)
      const cooldownUntil = this.#cooldowns.record(schedule.id, result.webhook)
      if (cooldownUntil !== null) {
        log.warn`Server asked "${schedule.name}" to back off (HTTP ${result.webhook?.statusCode}); pausing fires until ${new Date(cooldownUntil).toISOString()}`
      }
    } catch (err) {
      log.error`Schedule "${schedule.name}" failed: ${(err as Error).message}`
    }
  }
}
