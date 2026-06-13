/**
 * @module tests/unit/cooldown-tracker
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { CooldownTracker } from '../../lib/scheduler/cooldown-tracker.js'
import type { WebhookResult } from '../../types/domain.js'

const DEFAULT_MS = 5000
const NOW = 1_000_000

function buildWebhook(overrides: Partial<WebhookResult> = {}): WebhookResult {
  return {
    attempted: true,
    success: false,
    statusCode: 429,
    url: 'https://example.com/api/screens',
    ...overrides,
  }
}

describe('CooldownTracker', () => {
  let tracker: CooldownTracker

  beforeEach(() => {
    tracker = new CooldownTracker(DEFAULT_MS)
  })

  describe('#record', () => {
    it('honors Retry-After on a 429', () => {
      const webhook = buildWebhook({ statusCode: 429, retryAfterMs: 120000 })
      expect(tracker.record('a', webhook, NOW)).toBe(NOW + 120000)
    })

    it('falls back to the default wait on a 503 without Retry-After', () => {
      expect(tracker.record('a', buildWebhook({ statusCode: 503 }), NOW)).toBe(NOW + DEFAULT_MS)
    })

    it('returns null for a successful webhook', () => {
      expect(tracker.record('a', buildWebhook({ success: true }), NOW)).toBeNull()
    })

    it('returns null when no webhook was attempted', () => {
      expect(tracker.record('a', undefined, NOW)).toBeNull()
    })

    it('returns null for a non-backoff status', () => {
      expect(tracker.record('a', buildWebhook({ statusCode: 404 }), NOW)).toBeNull()
    })

    it('clears an existing cooldown once a send succeeds', () => {
      tracker.record('a', buildWebhook({ statusCode: 429, retryAfterMs: 120000 }), NOW)
      tracker.record('a', buildWebhook({ success: true }), NOW)

      expect(tracker.blockedUntil('a', NOW + 1)).toBeNull()
    })
  })

  describe('#blockedUntil', () => {
    it('is null for an unknown schedule', () => {
      expect(tracker.blockedUntil('unknown', NOW)).toBeNull()
    })

    it('returns the expiry while still cooling down', () => {
      tracker.record('a', buildWebhook({ statusCode: 429, retryAfterMs: 2000 }), NOW)
      expect(tracker.blockedUntil('a', NOW + 1000)).toBe(NOW + 2000)
    })

    it('is null once the cooldown elapses', () => {
      tracker.record('a', buildWebhook({ statusCode: 429, retryAfterMs: 2000 }), NOW)
      expect(tracker.blockedUntil('a', NOW + 2000)).toBeNull()
    })

    it('isolates cooldowns per schedule', () => {
      tracker.record('a', buildWebhook({ statusCode: 429, retryAfterMs: 2000 }), NOW)
      expect(tracker.blockedUntil('b', NOW + 1000)).toBeNull()
    })
  })
})
