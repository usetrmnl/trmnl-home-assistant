/**
 * Schedule Executor - Orchestrates scheduled screenshot capture
 *
 * Uses stateless services for screenshot operations.
 *
 * @module lib/scheduler/schedule-executor
 */

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
import type {
  Schedule,
  ScreenshotParams,
  WebhookResult,
} from '../../types/domain.js'
import { schedulerLogger } from '../logger.js'

const log = schedulerLogger()

/** Function type for screenshot capture */
export type ScreenshotFunction = (params: ScreenshotParams) => Promise<Buffer>

/** Result from schedule execution */
export interface ExecutionResult {
  success: boolean
  savedPath: string
  webhook?: WebhookResult
}

/**
 * Orchestrates schedule execution with retry logic.
 */
export class ScheduleExecutor {
  #screenshotFn: ScreenshotFunction
  #outputDir: string

  constructor(screenshotFn: ScreenshotFunction, outputDir: string) {
    this.#screenshotFn = screenshotFn
    this.#outputDir = outputDir
  }

  /** Executes schedule with automatic retry on network failures */
  async call(schedule: Schedule): Promise<ExecutionResult> {
    const startTime = Date.now()
    log.info`Running: ${schedule.name}`

    const result = await this.#executeWithRetry(schedule)

    this.#logResult(schedule.name, result, Date.now() - startTime)
    return result
  }

  /** Logs execution result with full details */
  #logResult(name: string, result: ExecutionResult, durationMs: number): void {
    const webhookStatus = this.#formatWebhookStatus(result.webhook)
    log.info`Completed: ${name} in ${durationMs}ms | saved: ${result.savedPath} | webhook: ${webhookStatus}`
  }

  /** Formats webhook status for logging */
  #formatWebhookStatus(webhook: WebhookResult | undefined): string {
    if (!webhook) return 'not configured'
    if (webhook.success) return `${webhook.statusCode} OK → ${webhook.url}`
    return `FAILED (${webhook.error}) → ${webhook.url}`
  }

  /** Retry wrapper for network failures */
  async #executeWithRetry(schedule: Schedule): Promise<ExecutionResult> {
    for (let attempt = 1; attempt <= SCHEDULER_MAX_RETRIES; attempt++) {
      try {
        return await this.#executeOnce(schedule)
      } catch (err) {
        if (!this.#shouldRetry(err as Error, attempt)) throw err
        this.#logRetry(schedule.name, err as Error, attempt)
        await sleep(SCHEDULER_RETRY_DELAY_MS)
      }
    }
    throw new Error(`Failed after ${SCHEDULER_MAX_RETRIES} attempts`)
  }

  /** Single execution attempt */
  async #executeOnce(schedule: Schedule): Promise<ExecutionResult> {
    const params = buildParams(schedule)
    const imageBuffer = await this.#screenshotFn(params)
    const { savedPath, filename } = await this.#saveAndCleanup(
      schedule,
      imageBuffer,
      params.format,
    )
    const webhook = await this.#uploadIfConfigured(
      schedule,
      imageBuffer,
      params.format,
      filename,
    )
    return { success: true, savedPath, webhook }
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
      format: format as 'png' | 'jpeg' | 'bmp',
    })
    log.info`Saved: ${outputPath}`

    const schedules = await loadSchedules()
    const maxFiles =
      schedules.filter((s) => s.enabled).length * SCHEDULER_RETENTION_MULTIPLIER
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

    return `${byos.addon_base_url.replace(/\/+$/, '')}/output/${encodeURIComponent(filename)}`
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

    try {
      const result = await uploadToWebhook({
        webhookUrl,
        webhookHeaders: schedule.webhook_headers,
        imageBuffer,
        format: format as 'png' | 'jpeg' | 'bmp',
        webhookFormat: schedule.webhook_format,
        screenshotUrl,
        onTokenRefresh: (newTokens) => {
          const updates = buildRefreshedAuthUpdate(schedule, newTokens)
          if (!updates) return

          updateSchedule(schedule.id, updates).catch((err: unknown) => {
            log.error`Failed to persist refreshed BYOS tokens: ${(err as Error).message}`
          })
        },
      })

      log.info`Schedule "${schedule.name}" webhook success: ${result.status} ${result.statusText}`

      return {
        attempted: true,
        success: true,
        statusCode: result.status,
        url: webhookUrl,
      }
    } catch (err) {
      const errorMessage = (err as Error).message
      log.error`Schedule "${schedule.name}" webhook failed: ${errorMessage}`

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

  #shouldRetry(error: Error, attempt: number): boolean {
    return isSchedulerNetworkError(error) && attempt < SCHEDULER_MAX_RETRIES
  }

  #logRetry(name: string, err: Error, attempt: number): void {
    log.warn`Network error (${attempt}/${SCHEDULER_MAX_RETRIES}) for ${name}: ${err.message}`
    log.info`Retrying in ${SCHEDULER_RETRY_DELAY_MS / 1000}s...`
  }
}
