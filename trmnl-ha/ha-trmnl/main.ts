/**
 * Main Application Entry Point
 *
 * Starts the HTTP server and scheduler, monitors memory, and handles crash
 * recovery and graceful shutdown. Requests are answered by RequestHandler.
 *
 * @module main
 */

import http from 'node:http'
import type { Server } from 'node:http'
import { Browser } from './screenshot.js'
import { isAddOn, hassUrl, hassToken, SERVER_PORT } from './const.js'
import { BrowserCrashError, PageCorruptedError } from './error.js'
import { Scheduler } from './scheduler.js'
import { RequestHandler } from './lib/request-handler.js'
import { initializeLogging, appLogger } from './lib/logger.js'

// Initialize logging before anything else
await initializeLogging()
const log = appLogger()

// =============================================================================
// INITIALIZATION
// =============================================================================

const browser = new Browser(hassUrl, hassToken!)
const requestHandler = new RequestHandler(browser)
const scheduler = new Scheduler((params) =>
  requestHandler.takeScreenshot(params)
)

requestHandler.router.setScheduler(scheduler)

const server: Server = http.createServer((request, response) =>
  requestHandler.handleRequest(request, response)
)
server.listen(SERVER_PORT)

scheduler.start()

const serverUrl = isAddOn
  ? `http://homeassistant.local:${SERVER_PORT}`
  : `http://localhost:${SERVER_PORT}`
log.info`Server started at ${serverUrl}`
log.info`Scheduler is running`

// =============================================================================
// SIMPLE RESILIENCE FEATURES
// =============================================================================

/**
 * Simple memory monitor - checks every 30 seconds
 */
function startMemoryMonitor(): void {
  const WARN_THRESHOLD = 700 * 1024 * 1024
  const EXIT_THRESHOLD = 900 * 1024 * 1024

  setInterval(() => {
    const usage = process.memoryUsage()
    const rss = usage.rss
    const rssMB = (rss / 1024 / 1024).toFixed(2)

    if (rss > EXIT_THRESHOLD) {
      log.fatal`CRITICAL: Memory ${rssMB}MB / 1024MB - exiting for restart`
      process.exit(1)
    } else if (rss > WARN_THRESHOLD) {
      log.warn`Memory warning: ${rssMB}MB / 1024MB`
    }
  }, 30000)
}

startMemoryMonitor()

// =============================================================================
// CRASH RECOVERY & GRACEFUL SHUTDOWN
// =============================================================================

/**
 * Checks if error is browser-related by message content or error type.
 */
function isBrowserRelatedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as Error
  return (
    err.message?.includes('browser') ||
    err.message?.includes('chromium') ||
    err.message?.includes('puppeteer') ||
    error instanceof BrowserCrashError ||
    error instanceof PageCorruptedError
  )
}

/** Longest a shutdown waits for captures under way to finish uploading */
const SHUTDOWN_DRAIN_MS = 20000
/** Last resort; stays under the add-on's 45 s stop timeout in config.yaml */
const SHUTDOWN_FORCE_MS = 40000
let shuttingDown = false

/**
 * Graceful shutdown handler for SIGTERM and SIGINT signals.
 *
 * Order matters: captures under way finish first, because a BYOS server
 * fetches the uploaded image back from this server while answering the
 * upload. Then the server closes, then the browser (each close step has its
 * own time limit, see Browser.cleanup).
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log.info`${signal} received, shutting down gracefully...`

  const forced = setTimeout(() => {
    log.error`Forced shutdown after timeout`
    process.exit(1)
  }, SHUTDOWN_FORCE_MS)

  scheduler.stop()
  if (!(await scheduler.drain(SHUTDOWN_DRAIN_MS))) {
    log.info`Captures still running after ${SHUTDOWN_DRAIN_MS / 1000}s; stopping anyway`
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    // Idle keep-alive connections would otherwise hold close() open (Node)
    server.closeIdleConnections()
  })
  log.info`HTTP server closed`

  await browser.shutdown()
  log.info`Browser cleaned up`

  clearTimeout(forced)
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

process.on('uncaughtException', async (err: Error) => {
  log.fatal`Uncaught Exception: ${err}`

  if (isBrowserRelatedError(err)) {
    log.error`Browser-related crash, allowing container restart...`
  }

  process.exit(1)
})

process.on(
  'unhandledRejection',
  async (reason: unknown, _promise: Promise<unknown>) => {
    log.error`Unhandled Rejection: ${reason}`

    if (isBrowserRelatedError(reason)) {
      log.error`Browser-related rejection, allowing container restart...`
      process.exit(1)
    }

    log.warn`Non-browser rejection logged, continuing...`
  }
)
