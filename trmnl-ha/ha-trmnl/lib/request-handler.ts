/**
 * Request Handler - answers screenshot requests and routes UI/API requests
 *
 * Owns the request queue, browser crash detection and recovery, and the
 * screenshot function the scheduler calls.
 *
 * @module lib/request-handler
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  Browser,
  type NavigateParams,
  type ScreenshotCaptureParams,
} from '../screenshot.js'
import {
  isAddOn,
  keepBrowserOpen,
  BROWSER_TIMEOUT,
  MAX_SCREENSHOTS_BEFORE_RESTART,
  MAX_NEXT_REQUESTS,
  DIRECT_ACCESS_SECRET,
} from '../const.js'
import { directAccessRefusal } from './direct-access.js'
import {
  CannotOpenPageError,
  HassStartingError,
  BrowserCrashError,
  PageCorruptedError,
  BrowserHealthCheckError,
  BrowserRecoveryFailedError,
} from '../error.js'
import { BrowserFacade } from './browserFacade.js'
import { HttpRouter } from './http-router.js'
import { ScreenshotParamsParser } from './screenshot-params-parser.js'
import type { ScreenshotParams, ImageFormat } from '../types/domain.js'
import { appLogger, browserLogger } from './logger.js'
import { recordTiming } from './metrics.js'
import { RequestQueue } from './request-queue.js'

const log = appLogger()
const browserLog = browserLogger()

/**
 * Central request handler coordinating all HTTP requests and browser operations.
 */
export class RequestHandler {
  #browser: Browser
  #router: HttpRouter
  #facade: BrowserFacade
  #paramsParser: ScreenshotParamsParser
  #queue = new RequestQueue()
  #requestCount: number = 0
  #nextRequests: ReturnType<typeof setTimeout>[] = []
  #navigationTime: number = 0
  #lastAccess: Date = new Date()
  #browserCleanupTimer: ReturnType<typeof setTimeout> | undefined

  constructor(browser: Browser) {
    this.#browser = browser
    this.#facade = new BrowserFacade(browser)
    this.#router = new HttpRouter(this.#facade)
    this.#paramsParser = new ScreenshotParamsParser()
  }

  get busy(): boolean {
    return this.#queue.busy
  }

  get router(): HttpRouter {
    return this.#router
  }

  // ===========================================================================
  // BROWSER LIFECYCLE MANAGEMENT
  // ===========================================================================

  /**
   * Checks if browser should be cleaned up due to inactivity.
   */
  #runBrowserCleanupCheck = async (): Promise<void> => {
    if (this.#queue.busy) return

    const idleTime = Date.now() - this.#lastAccess.getTime()

    if (idleTime < BROWSER_TIMEOUT) {
      const remainingTime = BROWSER_TIMEOUT - idleTime
      this.#browserCleanupTimer = setTimeout(
        this.#runBrowserCleanupCheck,
        remainingTime + 100
      )
      return
    }

    await this.#browser.cleanup()
  }

  /**
   * Marks browser as accessed and resets cleanup timer.
   */
  #markBrowserAccessed(): void {
    clearTimeout(this.#browserCleanupTimer)
    this.#lastAccess = new Date()

    if (keepBrowserOpen) return

    this.#browserCleanupTimer = setTimeout(
      this.#runBrowserCleanupCheck,
      BROWSER_TIMEOUT + 100
    )
  }

  /**
   * Checks and performs proactive browser cleanup based on request count.
   */
  async #maybeCleanupAfterRequests(): Promise<void> {
    if (MAX_SCREENSHOTS_BEFORE_RESTART <= 0) return
    if (keepBrowserOpen) return

    this.#requestCount++

    if (this.#requestCount >= MAX_SCREENSHOTS_BEFORE_RESTART) {
      browserLog.info`Proactive cleanup after ${this.#requestCount} screenshots`
      await this.#browser.cleanup()
      this.#requestCount = 0
    }
  }

  // ===========================================================================
  // BROWSER HEALTH & RECOVERY
  // ===========================================================================

  /**
   * Ensures browser is healthy before critical operations.
   */
  async #ensureBrowserHealthy(): Promise<void> {
    const health = this.#facade.checkHealth()

    if (!health.healthy) {
      browserLog.warn`Browser unhealthy: ${health.reason}`
      await this.#facade.recover()
    }
  }

  /**
   * Handles browser crash/corruption errors with automatic recovery.
   */
  async #handleBrowserError(
    err: Error,
    requestId: string | number
  ): Promise<boolean> {
    const isBrowserError =
      err instanceof BrowserCrashError ||
      err instanceof PageCorruptedError ||
      err instanceof BrowserHealthCheckError

    if (!isBrowserError) return false

    browserLog.error`[${requestId}] Browser error: ${err.name} - ${err.message}`

    const shouldRecover = this.#facade.recordFailure()

    if (shouldRecover || err instanceof BrowserCrashError) {
      try {
        await this.#facade.recover()
        return true
      } catch (recoveryErr) {
        if (recoveryErr instanceof BrowserRecoveryFailedError) {
          browserLog.fatal`[${requestId}] CRITICAL: Browser recovery failed!`
          browserLog.error`[${requestId}] Server continues but browser unavailable`
        }
        throw recoveryErr
      }
    }

    return false
  }

  // ===========================================================================
  // REQUEST HANDLING
  // ===========================================================================

  /**
   * Main request handler - entry point for all HTTP requests.
   */
  async handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const requestUrl = new URL(request.url || '/', 'http://localhost')

    const refusal = directAccessRefusal(request, requestUrl, { isAddOn, secret: DIRECT_ACCESS_SECRET })
    if (refusal) {
      response.writeHead(403, { 'Content-Type': 'text/plain' })
      response.end(refusal)
      return
    }

    try {
      const routed = await this.#router.route(request, response, requestUrl)
      if (routed) return

      await this.#handleScreenshotRequest(request, response, requestUrl)
    } catch (err) {
      // Answer before rethrowing, or the client waits forever; the
      // unhandledRejection handler still decides whether to restart
      if (!response.headersSent) this.#sendError(response, 500, `Request failed: ${(err as Error).message}`)
      throw err
    }
  }

  /**
   * Handles screenshot requests with queue management.
   */
  async #handleScreenshotRequest(
    _request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL
  ): Promise<void> {
    const requestId = this.#requestCount
    const start = new Date()

    if (this.#queue.busy) log.debug`[${requestId}] Busy, waiting in queue`
    await this.#queue.acquire()
    log.debug`[${requestId}] Wait time: ${Date.now() - start.getTime()}ms`

    try {
      const params = this.#paramsParser.call(requestUrl)
      if (!params) return this.#sendError(response, 400, 'Invalid parameters')

      log.info`Screenshot request: ${params.pagePath} (${params.viewport.width}x${params.viewport.height})`

      const navTime = await this.#navigateWithRecovery(
        params,
        requestId,
        response
      )
      if (navTime === null) return

      const image = await this.#captureWithRecovery(params, requestId, response)
      if (!image) return

      const elapsed = Date.now() - start.getTime()
      recordTiming('request.total', elapsed)
      log.info`Screenshot complete: ${image.length} bytes in ${elapsed}ms`

      // Warn if screenshot is suspiciously small (likely blank/login page)
      if (image.length < 1000) {
        log.warning`Screenshot is very small (${image.length} bytes) - page may be blank or showing a login screen`
        log.warning`This usually indicates an invalid access token. Check your HA token is valid.`
      }

      this.#sendImage(response, image, params.format)
      if (params.next) this.#scheduleNextRequest(requestId, params, start)
    } finally {
      this.#queue.release()
      this.#markBrowserAccessed()
    }
  }

  /** Navigates to page with automatic recovery on failure */
  async #navigateWithRecovery(
    params: NavigateParams,
    requestId: number,
    response: ServerResponse
  ): Promise<number | null> {
    try {
      await this.#ensureBrowserHealthy()
      const result = await this.#browser.navigatePage(params)
      this.#facade.recordSuccess()
      this.#navigationTime = Math.max(this.#navigationTime, result.time)
      return result.time
    } catch (err) {
      return this.#handleNavigationError(
        err as Error,
        params,
        requestId,
        response
      )
    }
  }

  /** Handles navigation errors with recovery attempt */
  async #handleNavigationError(
    err: Error,
    params: NavigateParams,
    requestId: number,
    response: ServerResponse
  ): Promise<number | null> {
    if (err instanceof CannotOpenPageError) {
      this.#sendError(response, 404, `Cannot open page: ${err.message}`)
      return null
    }
    if (err instanceof HassStartingError) {
      this.#sendError(response, 503, err.message)
      return null
    }

    const recovered = await this.#handleBrowserError(err, requestId)
    if (!recovered) throw err

    return this.#retryNavigation(params, requestId, response)
  }

  /** Retries navigation after browser recovery */
  async #retryNavigation(
    params: NavigateParams,
    requestId: number,
    response: ServerResponse
  ): Promise<number | null> {
    browserLog.info`[${requestId}] Retrying navigation after recovery...`
    try {
      const result = await this.#browser.navigatePage(params)
      this.#facade.recordSuccess()
      return result.time
    } catch (retryErr) {
      browserLog.error`[${requestId}] Retry failed: ${retryErr}`
      this.#sendError(response, 503, 'Service temporarily unavailable')
      return null
    }
  }

  /** Captures screenshot with automatic recovery on failure */
  async #captureWithRecovery(
    params: ScreenshotCaptureParams,
    requestId: number,
    response: ServerResponse
  ): Promise<Buffer | null> {
    try {
      const result = await this.#browser.screenshotPage(params)
      this.#facade.recordSuccess()
      await this.#maybeCleanupAfterRequests()
      return result.image
    } catch (err) {
      return this.#handleCaptureError(err as Error, requestId, response)
    }
  }

  /** Handles screenshot capture errors */
  async #handleCaptureError(
    err: Error,
    requestId: number,
    response: ServerResponse
  ): Promise<null> {
    const recovered = await this.#handleBrowserError(err, requestId)
    if (recovered) {
      this.#sendError(response, 503, 'Screenshot failed - please retry')
    } else {
      throw err
    }
    return null
  }

  /** Sends error response */
  #sendError(response: ServerResponse, status: number, message: string): void {
    response.statusCode = status
    response.end(message)
  }

  /** Sends image response with proper headers */
  #sendImage(
    response: ServerResponse,
    image: Buffer,
    format: ImageFormat
  ): void {
    response.writeHead(200, {
      'Content-Type': this.#getContentType(format),
      'Content-Length': image.length,
    })
    response.end(image)
  }

  /**
   * Maps image format to HTTP Content-Type header.
   */
  #getContentType(format: ImageFormat): string {
    if (format === 'jpeg') return 'image/jpeg'
    if (format === 'bmp') return 'image/bmp'
    return 'image/png'
  }

  /**
   * Schedules next request for preloading.
   */
  #scheduleNextRequest(
    requestId: number,
    params: ScreenshotParams,
    start: Date
  ): void {
    const end = new Date()
    const requestTime = end.getTime() - start.getTime()
    const nextWaitTime =
      params.next! * 1000 - requestTime - this.#navigationTime - 1000

    if (nextWaitTime < 0) return

    log.debug`[${requestId}] Next request in ${nextWaitTime}ms`
    this.#nextRequests.push(
      setTimeout(
        () => this.#prepareNextRequest(requestId, params),
        nextWaitTime
      )
    )

    if (this.#nextRequests.length > MAX_NEXT_REQUESTS) {
      clearTimeout(this.#nextRequests.shift())
    }
  }

  /**
   * Prepares next request by preloading the page.
   */
  async #prepareNextRequest(
    requestId: number,
    params: ScreenshotParams
  ): Promise<void> {
    if (!this.#queue.tryAcquire()) {
      log.debug`Busy, skipping next request`
      return
    }

    const nextRequestId = `${requestId}-next`
    log.debug`[${nextRequestId}] Preparing next request`

    try {
      const navigateResult = await this.#browser.navigatePage({
        ...params,
        extraWait: 0,
      } as NavigateParams)
      log.debug`[${nextRequestId}] Navigated in ${navigateResult.time}ms`
    } catch (err) {
      log.error`[${nextRequestId}] Error preparing next request: ${err}`
    } finally {
      this.#queue.release()
      this.#markBrowserAccessed()
    }
  }

  /**
   * Public API for scheduler to take screenshots.
   */
  async takeScreenshot(params: ScreenshotParams): Promise<Buffer> {
    await this.#queue.acquire()

    try {
      await this.#ensureBrowserHealthy()
      await this.#browser.navigatePage(params as NavigateParams)
      const result = await this.#browser.screenshotPage(
        params as ScreenshotCaptureParams
      )
      this.#facade.recordSuccess()
      await this.#maybeCleanupAfterRequests()
      return result.image
    } catch (err) {
      const recovered = await this.#handleBrowserError(
        err as Error,
        '[Scheduler]'
      )
      if (recovered) {
        await this.#browser.navigatePage(params as NavigateParams)
        const result = await this.#browser.screenshotPage(
          params as ScreenshotCaptureParams
        )
        this.#facade.recordSuccess()
        await this.#maybeCleanupAfterRequests()
        return result.image
      }
      throw err
    } finally {
      this.#queue.release()
      this.#markBrowserAccessed()
    }
  }
}
