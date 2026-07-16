/**
 * Unit tests for BrowserFacade
 *
 * Tests health monitoring and crash recovery logic.
 *
 * @module tests/unit/browserFacade
 */

import { describe, it, expect, beforeEach, setSystemTime } from 'bun:test'
import {
  BrowserFacade,
  type BrowserInstance,
  type BrowserFacadeOptions,
} from '../../lib/browserFacade.js'
import { BrowserRecoveryFailedError } from '../../error.js'

/** Fast backoff for tests (1ms base, 10ms max) */
const FAST_BACKOFF: BrowserFacadeOptions = { backoffBase: 1, backoffMax: 10 }

/** Creates mock browser with configurable behavior */
function createMockBrowser(
  options: {
    connected?: boolean
    cleanupFails?: boolean
    initFails?: boolean
    initFailCount?: number
  } = {}
): BrowserInstance & { calls: { cleanup: number; init: number } } {
  let initAttempts = 0
  const calls = { cleanup: 0, init: 0 }

  return {
    calls,
    cleanup: async () => {
      calls.cleanup++
      if (options.cleanupFails) throw new Error('Cleanup failed')
    },
    triggerInit: async () => {
      calls.init++
      initAttempts++
      if (
        options.initFails &&
        initAttempts <= (options.initFailCount ?? Infinity)
      ) {
        throw new Error('Init failed')
      }
    },
    isConnected: () => options.connected ?? true,
  }
}

describe('BrowserFacade', () => {
  let mockBrowser: ReturnType<typeof createMockBrowser>
  let facade: BrowserFacade

  beforeEach(() => {
    mockBrowser = createMockBrowser()
    facade = new BrowserFacade(mockBrowser)
  })

  // ==========================================================================
  // recordSuccess() - Reset failure tracking
  // ==========================================================================

  describe('recordSuccess', () => {
    it('resets consecutive failures to zero', () => {
      facade.recordFailure()
      facade.recordFailure()

      facade.recordSuccess()

      const stats = facade.getStats()
      expect(stats.consecutiveFailures).toBe(0)
    })

    it('updates lastSuccessfulRequest timestamp', async () => {
      const before = facade.getStats().lastSuccessfulRequest

      // Real sleep so a stale timestamp cannot pass the strict comparison
      await new Promise((resolve) => setTimeout(resolve, 5))
      facade.recordSuccess()

      const after = facade.getStats().lastSuccessfulRequest
      expect(new Date(after).getTime()).toBeGreaterThan(
        new Date(before).getTime()
      )
    })
  })

  // ==========================================================================
  // recordFailure() - Track consecutive failures
  // ==========================================================================

  describe('recordFailure', () => {
    it('increments consecutive failures', () => {
      facade.recordFailure()

      const stats = facade.getStats()
      expect(stats.consecutiveFailures).toBe(1)
    })

    it('returns false when under MAX_FAILURES threshold', () => {
      const result1 = facade.recordFailure()
      const result2 = facade.recordFailure()

      expect(result1).toBe(false)
      expect(result2).toBe(false)
    })

    it('returns true when reaching MAX_FAILURES threshold', () => {
      facade.recordFailure()
      facade.recordFailure()
      const result = facade.recordFailure()

      expect(result).toBe(true)
    })
  })

  // ==========================================================================
  // checkHealth() - Health status determination
  // ==========================================================================

  describe('checkHealth', () => {
    it('returns healthy when no failures', () => {
      const result = facade.checkHealth()

      expect(result).toEqual({ healthy: true })
    })

    it('returns unhealthy when failures reach MAX_FAILURES', () => {
      facade.recordFailure()
      facade.recordFailure()
      facade.recordFailure()

      const result = facade.checkHealth()

      expect(result.healthy).toBe(false)
      expect(result.reason).toContain('consecutive failures')
    })

    it('returns healthy after success resets failures', () => {
      facade.recordFailure()
      facade.recordFailure()
      facade.recordFailure()
      facade.recordSuccess()

      const result = facade.checkHealth()

      expect(result).toEqual({ healthy: true })
    })

    it('returns unhealthy when stale with recorded failures', () => {
      facade.recordFailure()

      // #lastSuccess isn't injectable — age it by faking the clock instead
      setSystemTime(new Date(Date.now() + BrowserFacade.STALE_MS + 1000))
      const result = facade.checkHealth()
      setSystemTime()

      expect(result.healthy).toBe(false)
      expect(result.reason).toContain('No success in')
    })
  })

  // ==========================================================================
  // recover() - Browser crash recovery
  // ==========================================================================

  describe('recover', () => {
    it('does not start a second recovery while one is in flight', async () => {
      let initCalls = 0
      const slowBrowser: BrowserInstance = {
        cleanup: async () => {},
        // Slow enough that the second recover() sees the first in flight
        triggerInit: async () => {
          initCalls++
          await new Promise((r) => setTimeout(r, 50))
        },
        isConnected: () => true,
      }
      const slowFacade = new BrowserFacade(slowBrowser, FAST_BACKOFF)

      await Promise.all([slowFacade.recover(), slowFacade.recover()])

      expect(initCalls).toBe(1)
      expect(slowFacade.getStats().totalRecoveries).toBe(1)
    })

    it('calls browser cleanup and triggerInit', async () => {
      await facade.recover()

      expect(mockBrowser.calls.cleanup).toBe(1)
      expect(mockBrowser.calls.init).toBe(1)
    })

    it('increments totalRecoveries on success', async () => {
      await facade.recover()

      const stats = facade.getStats()
      expect(stats.totalRecoveries).toBe(1)
    })

    it('resets failures on successful recovery', async () => {
      facade.recordFailure()
      facade.recordFailure()

      await facade.recover()

      const stats = facade.getStats()
      expect(stats.consecutiveFailures).toBe(0)
    })

    it('retries when init fails', async () => {
      mockBrowser = createMockBrowser({ initFails: true, initFailCount: 2 })
      facade = new BrowserFacade(mockBrowser, FAST_BACKOFF)

      await facade.recover()

      expect(mockBrowser.calls.init).toBe(3) // 2 failures + 1 success
    })

    it('throws BrowserRecoveryFailedError after MAX_RECOVERY_ATTEMPTS', async () => {
      mockBrowser = createMockBrowser({ initFails: true })
      facade = new BrowserFacade(mockBrowser, FAST_BACKOFF)

      await expect(facade.recover()).rejects.toBeInstanceOf(
        BrowserRecoveryFailedError
      )
      expect(mockBrowser.calls.init).toBe(BrowserFacade.MAX_RECOVERY_ATTEMPTS)
    })

    it('throws BrowserRecoveryFailedError when browser not connected', async () => {
      mockBrowser = createMockBrowser({ connected: false })
      facade = new BrowserFacade(mockBrowser, FAST_BACKOFF)

      await expect(facade.recover()).rejects.toBeInstanceOf(
        BrowserRecoveryFailedError
      )
    })

    it('continues if cleanup fails', async () => {
      mockBrowser = createMockBrowser({ cleanupFails: true })
      facade = new BrowserFacade(mockBrowser)

      await facade.recover()

      expect(mockBrowser.calls.init).toBe(1)
    })
  })

  // ==========================================================================
  // getStats() - Combined monitoring stats
  // ==========================================================================

  describe('getStats', () => {
    it('returns all monitoring metrics', () => {
      const stats = facade.getStats()

      expect(stats).toMatchObject({
        lastSuccessfulRequest: expect.any(String),
        timeSinceSuccess: expect.any(Number),
        consecutiveFailures: 0,
        totalRecoveries: 0,
        recovering: false,
      })
    })

    it('returns ISO timestamp for lastSuccessfulRequest', () => {
      const stats = facade.getStats()

      expect(stats.lastSuccessfulRequest).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('tracks timeSinceSuccess in milliseconds', async () => {
      facade.recordSuccess()
      // Wait 100ms but only check for >= 50ms to account for CI timing variance
      await new Promise((r) => setTimeout(r, 100))

      const stats = facade.getStats()

      expect(stats.timeSinceSuccess).toBeGreaterThanOrEqual(50)
    })
  })

})
