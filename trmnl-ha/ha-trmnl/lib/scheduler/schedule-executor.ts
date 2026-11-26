/**
 * Schedule Executor - Orchestrates scheduled screenshot capture
 *
 * Uses stateless services for screenshot operations.
 *
 * @module lib/scheduler/schedule-executor
 */

import { createHash } from 'node:crypto'
import {
  saveScreenshot,
  cleanupOldScreenshots,
  uploadToWebhook,
  WebhookHttpError,
  buildParams,
} from './services.js'
import { sleep } from '../sleep.js'
import {
  SCHEDULER_MAX_RETRIES,
  SCHEDULER_RETRY_DELAY_MS,
  SCHEDULER_RETENTION_MULTIPLIER,
  SCHEDULER_IMAGE_FILE_PATTERN,
  isSchedulerNetworkError,
} from '../../const.js'
import { loadSchedules, updateSchedule } from '../scheduleStore.js'
import { buildRefreshedAuthUpdate } from './byos-auth.js'
import { errorKind } from '../error-kind.js'
import { withDirectAccessSecret } from '../direct-access.js'
import { DIRECT_ACCESS_SECRET } from '../../const.js'
import { notifyUploadRefused, clearUploadRefused, notifyReauthRequired, clearReauthRequired } from '../ha-notify.js'
import type {
  Schedule,
  ScreenshotParams,
  WebhookResult,
} from '../../types/domain.js'
import { schedulerLogger } from '../logger.js'
import { timed } from '../metrics.js'

const log = schedulerLogger()

/** Resend an unchanged image this often anyway: the server queues an upload before storing it, so a 200 can still be lost. */
const UNCHANGED_RESEND_MS = 4 * 60 * 60 * 1000

/** Function type for screenshot capture */
export type ScreenshotFunction = (params: ScreenshotParams) => Promise<Buffer>

/** Result from schedule execution */
export interface ExecutionResult {
  success: boolean
  savedPath: string
  webhook?: WebhookResult
  /** Capture, save and upload time, so an aligned capture can start early enough */
  durationMs?: number
}

/** Home Assistant notices for delivery and authentication failures */
interface ScheduleNotifier {
  notifyUploadRefused(schedule: Schedule, reason: string): Promise<void>
  clearUploadRefused(schedule: Schedule): Promise<void>
  notifyReauthRequired(schedule: Schedule): Promise<void>
  clearReauthRequired(schedule: Schedule): Promise<void>
}

/**
 * Orchestrates schedule execution with retry logic.
 */
export class ScheduleExecutor {
  #screenshotFn: ScreenshotFunction
  #outputDir: string
  #notifier: ScheduleNotifier
  /** Last image hash each webhook URL accepted, and when */
  #lastSent = new Map<string, { hash: string; at: number }>()

  constructor(
    screenshotFn: ScreenshotFunction,
    outputDir: string,
    notifier: ScheduleNotifier = { notifyUploadRefused, clearUploadRefused, notifyReauthRequired, clearReauthRequired },
  ) {
    this.#screenshotFn = screenshotFn
    this.#outputDir = outputDir
    this.#notifier = notifier
  }

  /** Executes schedule with automatic retry on network failures */
  async call(schedule: Schedule, { force = false } = {}): Promise<ExecutionResult> {
    const startTime = Date.now()
    log.info`Running: ${schedule.name}`

    const result = await this.#executeWithRetry(schedule, force)
    result.durationMs = Date.now() - startTime

    this.#logResult(schedule.name, result, result.durationMs)
    return result
  }

  /** Logs execution status without credential-bearing URLs or remote details. */
  #logResult(name: string, result: ExecutionResult, durationMs: number): void {
    const webhookStatus = this.#formatWebhookStatus(result.webhook)
    log.info`Completed: ${name} in ${durationMs}ms | saved: ${result.savedPath} | webhook: ${webhookStatus}`
  }

  /** Formats webhook status for logging */
  #formatWebhookStatus(webhook: WebhookResult | undefined): string {
    if (!webhook) return 'not configured'
    if (!webhook.attempted) return 'skipped, image unchanged'
    if (webhook.success) return `${webhook.statusCode} OK`
    return `FAILED (HTTP ${webhook.statusCode ?? 'unknown'})`
  }

  /** Retry wrapper for network failures */
  async #executeWithRetry(schedule: Schedule, force: boolean): Promise<ExecutionResult> {
    for (let attempt = 1; attempt <= SCHEDULER_MAX_RETRIES; attempt++) {
      try {
        return await this.#executeOnce(schedule, force)
      } catch (err) {
        if (!this.#shouldRetry(err as Error, attempt)) throw err
        this.#logRetry(schedule.name, err as Error, attempt)
        await sleep(SCHEDULER_RETRY_DELAY_MS)
      }
    }
    throw new Error(`Failed after ${SCHEDULER_MAX_RETRIES} attempts`)
  }

  /** Single execution attempt */
  async #executeOnce(schedule: Schedule, force: boolean): Promise<ExecutionResult> {
    const params = buildParams(schedule)
    const imageBuffer = await this.#screenshotFn(params)
    const { savedPath, filename } = await this.#saveAndCleanup(
      schedule,
      imageBuffer,
      params.format,
    )
    const hash = createHash('sha256').update(imageBuffer).digest('hex')
    if (!force && this.#alreadySent(schedule, hash)) {
      return { success: true, savedPath, webhook: { attempted: false, success: true } }
    }

    const url = schedule.webhook_url
    if (url) this.#lastSent.delete(url)
    const webhook = await this.#uploadIfConfigured(
      schedule,
      imageBuffer,
      params.format,
      filename,
    )
    if (url && webhook?.success) this.#lastSent.set(url, { hash, at: Date.now() })
    return { success: true, savedPath, webhook }
  }

  /** BYOS is left out: a URI upload names a saved file the server may fetch after cleanup has deleted it. */
  #alreadySent(schedule: Schedule, hash: string): boolean {
    if (!schedule.webhook_url || schedule.webhook_format?.byosConfig) return false
    const last = this.#lastSent.get(schedule.webhook_url)
    return last?.hash === hash && Date.now() - last.at < UNCHANGED_RESEND_MS
  }

  /** Saves screenshot and runs LRU cleanup */
  async #saveAndCleanup(
    schedule: Schedule,
    imageBuffer: Buffer,
    format: string,
  ): Promise<{ savedPath: string; filename: string }> {
    const { outputPath, filename } = saveScreenshot({
      outputDir: this.#outputDir,
      scheduleName: schedule.name,
      imageBuffer,
      format: format as 'png' | 'jpeg',
    })
    log.info`Saved: ${outputPath}`

    const schedules = await loadSchedules()
    // Floor at 1: "Send Now" runs disabled schedules too, and with zero
    // enabled schedules maxFiles would be 0 — deleting the capture we just
    // saved (and 404ing the BYOS URI fetch that points at it).
    const enabledCount = Math.max(
      schedules.filter((s) => s.enabled).length,
      1,
    )
    const maxFiles = enabledCount * SCHEDULER_RETENTION_MULTIPLIER
    const { deletedCount } = cleanupOldScreenshots({
      outputDir: this.#outputDir,
      maxFiles,
      filePattern: SCHEDULER_IMAGE_FILE_PATTERN,
    })

    if (deletedCount > 0)
      log.debug`Cleanup: Deleted ${deletedCount} old file(s)`
    return { savedPath: outputPath, filename }
  }

  /**
   * Builds the URL for BYOS URI mode, pointing at the capture that was just
   * saved. The BYOS server used to be sent a live screenshot-endpoint URL,
   * so its fetch triggered a second full render per update (#74).
   * Returns undefined when URI mode is not applicable.
   */
  #buildScreenshotUrl(
    schedule: Schedule,
    filename: string,
  ): string | undefined {
    const byos = schedule.webhook_format?.byosConfig
    if (!byos?.addon_base_url) return undefined
    if (byos.delivery_mode === 'data') return undefined

    const url = `${byos.addon_base_url.replace(/\/+$/, '')}/output/${encodeURIComponent(filename)}`
    return withDirectAccessSecret(url, DIRECT_ACCESS_SECRET)
  }

  /** Uploads to webhook if configured, returns result for UI feedback */
  async #uploadIfConfigured(
    schedule: Schedule,
    imageBuffer: Buffer,
    format: string,
    filename: string,
  ): Promise<WebhookResult | undefined> {
    if (!schedule.webhook_url) return undefined

    const webhookUrl = schedule.webhook_url
    const screenshotUrl = this.#buildScreenshotUrl(schedule, filename)
    let authRenewed = false

    try {
      const result = await timed('webhook.upload', () =>
        uploadToWebhook({
          webhookUrl,
          webhookHeaders: schedule.webhook_headers,
          imageBuffer,
          format: format as 'png' | 'jpeg',
          webhookFormat: schedule.webhook_format,
          screenshotUrl,
        onTokenRefresh: (newTokens) => {
          authRenewed = true
          void this.#notifier.clearReauthRequired(schedule)
          const updates = buildRefreshedAuthUpdate(schedule, newTokens)
          if (!updates) return

          updateSchedule(schedule.id, updates).catch((err: unknown) => {
            log.error`Failed to persist refreshed BYOS tokens: ${(err as Error).message}`
          })
        },
        }),
      )

      log.info`Schedule "${schedule.name}" webhook success: HTTP ${result.status}`
      void this.#notifier.clearUploadRefused(schedule)
      if (!authRenewed && schedule.webhook_format?.byosConfig?.auth?.enabled) {
        void this.#notifier.clearReauthRequired(schedule)
      }

      return {
        attempted: true,
        success: true,
        statusCode: result.status,
        url: webhookUrl,
        nextCheckInAt: result.nextCheckInAt,
      }
    } catch (err) {
      const errorMessage = (err as Error).message

      // Network errors carry no status, so fall back to scraping the message.
      let statusCode: number | undefined
      let retryAfterMs: number | undefined
      if (err instanceof WebhookHttpError) {
        statusCode = err.status
        retryAfterMs = err.retryAfterMs ?? undefined
      } else {
        const statusMatch = errorMessage.match(/HTTP (\d+):/)
        statusCode = statusMatch?.[1] ? parseInt(statusMatch[1], 10) : undefined
      }

      // Remote errors can echo credentials, including only part of a URL.
      // Keep details for the UI, but log only the numeric status.
      log.error`Schedule "${schedule.name}" webhook failed: ${statusCode ? `HTTP ${statusCode}` : errorKind(err)}`

      if (statusCode === 401 && schedule.webhook_format?.byosConfig?.auth?.enabled) {
        void this.#notifier.notifyReauthRequired(schedule)
      } else if (this.#isRefusal(statusCode) || (statusCode === 500 && screenshotUrl)) {
        void this.#notifier.notifyUploadRefused(schedule, errorMessage)
      }

      return {
        attempted: true,
        success: false,
        statusCode,
        retryAfterMs,
        error: errorMessage,
        url: webhookUrl,
      }
    }
  }

  /** A 4xx other than a rate limit: sending the same image again will not help. A lapsed BYOS login has its own sign-in notice. */
  #isRefusal(statusCode: number | undefined): boolean {
    return statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 429
  }

  #shouldRetry(error: Error, attempt: number): boolean {
    return isSchedulerNetworkError(error) && attempt < SCHEDULER_MAX_RETRIES
  }

  #logRetry(name: string, err: Error, attempt: number): void {
    log.warn`Network error (${attempt}/${SCHEDULER_MAX_RETRIES}) for ${name}: ${err.message}`
    log.info`Retrying in ${SCHEDULER_RETRY_DELAY_MS / 1000}s...`
  }
}
