/**
 * Unit tests for Custom Error Classes
 *
 * Tests error construction, properties, and inheritance.
 *
 * @module tests/unit/error
 */

import { describe, it, expect } from 'bun:test'
import {
  CannotOpenPageError,
  BrowserCrashError,
  PageCorruptedError,
  BrowserHealthCheckError,
  BrowserRecoveryFailedError,
} from '../../error.js'

describe('Custom Error Classes', () => {
  // ==========================================================================
  // CannotOpenPageError
  // ==========================================================================

  describe('CannotOpenPageError', () => {
    it('extends Error', () => {
      const error = new CannotOpenPageError(404, '/lovelace/0')

      expect(error).toBeInstanceOf(Error)
    })

    it('has correct name property', () => {
      const error = new CannotOpenPageError(404, '/lovelace/0')

      expect(error.name).toBe('CannotOpenPageError')
    })

    it('stores status code', () => {
      const error = new CannotOpenPageError(404, '/lovelace/0')

      expect(error.status).toBe(404)
    })

    it('stores page path', () => {
      const error = new CannotOpenPageError(404, '/lovelace/dashboard')

      expect(error.pagePath).toBe('/lovelace/dashboard')
    })

    it('includes status in message', () => {
      const error = new CannotOpenPageError(404, '/lovelace/0')

      expect(error.message).toContain('404')
      expect(error.message).toContain('/lovelace/0')
    })

    it('includes network error in message when provided', () => {
      const error = new CannotOpenPageError(
        0,
        '/lovelace/0',
        'DNS_RESOLUTION_FAILED'
      )

      expect(error.message).toContain('DNS_RESOLUTION_FAILED')
      expect(error.networkError).toBe('DNS_RESOLUTION_FAILED')
    })
  })

  // ==========================================================================
  // BrowserCrashError
  // ==========================================================================

  describe('BrowserCrashError', () => {
    it('extends Error', () => {
      const original = new Error('Target closed')
      const error = new BrowserCrashError(original)

      expect(error).toBeInstanceOf(Error)
    })

    it('has correct name property', () => {
      const original = new Error('Target closed')
      const error = new BrowserCrashError(original)

      expect(error.name).toBe('BrowserCrashError')
    })

    it('stores original error', () => {
      const original = new Error('Session closed')
      const error = new BrowserCrashError(original)

      expect(error.originalError).toBe(original)
    })

    it('includes original message in error message', () => {
      const original = new Error('Protocol error')
      const error = new BrowserCrashError(original)

      expect(error.message).toContain('Protocol error')
    })
  })

  // ==========================================================================
  // PageCorruptedError
  // ==========================================================================

  describe('PageCorruptedError', () => {
    it('extends Error', () => {
      const error = new PageCorruptedError('JavaScript error detected')

      expect(error).toBeInstanceOf(Error)
    })

    it('has correct name property', () => {
      const error = new PageCorruptedError('JavaScript error')

      expect(error.name).toBe('PageCorruptedError')
    })

    it('includes reason in message', () => {
      const error = new PageCorruptedError('Navigation failed with page errors')

      expect(error.message).toContain('Navigation failed with page errors')
    })
  })

  // ==========================================================================
  // BrowserHealthCheckError
  // ==========================================================================

  describe('BrowserHealthCheckError', () => {
    it('extends Error', () => {
      const error = new BrowserHealthCheckError('5 consecutive failures')

      expect(error).toBeInstanceOf(Error)
    })

    it('has correct name property', () => {
      const error = new BrowserHealthCheckError('Stale connection')

      expect(error.name).toBe('BrowserHealthCheckError')
    })

    it('includes reason in message', () => {
      const error = new BrowserHealthCheckError('No success in 300s')

      expect(error.message).toContain('No success in 300s')
    })
  })

  // ==========================================================================
  // BrowserRecoveryFailedError
  // ==========================================================================

  describe('BrowserRecoveryFailedError', () => {
    it('extends Error', () => {
      const lastError = new Error('Init failed')
      const error = new BrowserRecoveryFailedError(5, lastError)

      expect(error).toBeInstanceOf(Error)
    })

    it('has correct name property', () => {
      const lastError = new Error('Init failed')
      const error = new BrowserRecoveryFailedError(5, lastError)

      expect(error.name).toBe('BrowserRecoveryFailedError')
    })

    it('stores attempt count', () => {
      const lastError = new Error('Init failed')
      const error = new BrowserRecoveryFailedError(5, lastError)

      expect(error.attempts).toBe(5)
    })

    it('stores last error', () => {
      const lastError = new Error('Connection refused')
      const error = new BrowserRecoveryFailedError(3, lastError)

      expect(error.lastError).toBe(lastError)
    })

    it('includes attempt count in message', () => {
      const lastError = new Error('Init failed')
      const error = new BrowserRecoveryFailedError(5, lastError)

      expect(error.message).toContain('5')
    })

    it('includes last error message in message', () => {
      const lastError = new Error('Browser process killed')
      const error = new BrowserRecoveryFailedError(3, lastError)

      expect(error.message).toContain('Browser process killed')
    })
  })

})
