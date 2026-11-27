/**
 * Custom error classes for the TRMNL HA add-on
 * @module error
 */

/**
 * Error thrown when a page cannot be opened in the browser
 * Used for navigation failures, 404s, DNS errors, or authentication issues
 */
export class CannotOpenPageError extends Error {
  readonly status: number
  readonly pagePath: string
  readonly networkError?: string

  constructor(status: number, pagePath: string, networkError?: string) {
    const message = networkError
      ? `Unable to open page: ${pagePath} (Network error: ${networkError})`
      : `Unable to open page: ${pagePath} (${status})`
    super(message)
    this.status = status
    this.pagePath = pagePath
    this.networkError = networkError
    this.name = 'CannotOpenPageError'
  }
}

/**
 * Home Assistant Core serves its frontend before it is RUNNING, so a capture
 * then shows blank or unavailable cards (#184)
 */
export class HassStartingError extends Error {
  constructor(state: string) {
    super(`Home Assistant is still starting (${state}); skipped the capture so the display keeps its last screen`)
    this.name = 'HassStartingError'
  }
}

/**
 * Error thrown when browser process crashes or becomes unresponsive
 * Triggers browser recovery without crashing the HTTP server
 */
export class BrowserCrashError extends Error {
  readonly originalError: Error

  constructor(originalError: Error) {
    super(`Browser crashed: ${originalError.message}`)
    this.originalError = originalError
    this.name = 'BrowserCrashError'
  }
}

/**
 * Error thrown when page is corrupted or in bad state
 * Triggers full browser cleanup and restart
 */
export class PageCorruptedError extends Error {
  constructor(reason: string) {
    super(`Page corrupted: ${reason}`)
    this.name = 'PageCorruptedError'
  }
}

/**
 * Error thrown when browser health check fails
 * Used by monitoring system to signal browser unhealthiness
 */
export class BrowserHealthCheckError extends Error {
  constructor(reason: string) {
    super(`Browser health check failed: ${reason}`)
    this.name = 'BrowserHealthCheckError'
  }
}

/**
 * Error thrown when browser recovery fails after max retries
 * Indicates a serious issue requiring process restart
 */
export class BrowserRecoveryFailedError extends Error {
  readonly attempts: number
  readonly lastError: Error

  constructor(attempts: number, lastError: Error) {
    super(
      `Browser recovery failed after ${attempts} attempts: ${lastError.message}`
    )
    this.attempts = attempts
    this.lastError = lastError
    this.name = 'BrowserRecoveryFailedError'
  }
}
