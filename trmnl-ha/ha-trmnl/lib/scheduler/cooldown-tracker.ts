/**
 * Per-schedule backoff state. After a 429/503 the schedule is held off until the
 * server's Retry-After (or a default) elapses, so an overloaded server isn't
 * hammered by the next cron ticks.
 *
 * @module lib/scheduler/cooldown-tracker
 */

import type { WebhookResult } from '../../types/domain.js'

const BACKOFF_STATUS_CODES = new Set([429, 503])

export class CooldownTracker {
  #defaultMs: number
  #until = new Map<string, number>()

  constructor(defaultMs: number) {
    this.#defaultMs = defaultMs
  }

  /** Active cooldown expiry (epoch ms) for a schedule, or null when free to fire. */
  blockedUntil(id: string, now: number = Date.now()): number | null {
    const until = this.#until.get(id)
    return until !== undefined && now < until ? until : null
  }

  /**
   * Updates a schedule's cooldown from its webhook outcome. Clears it unless the
   * server returned a backoff status.
   *
   * @returns New expiry (epoch ms) when a cooldown is set, else null
   */
  record(
    id: string,
    webhook: WebhookResult | undefined,
    now: number = Date.now(),
  ): number | null {
    if (!webhook || webhook.success || webhook.statusCode === undefined) {
      this.#until.delete(id)
      return null
    }
    if (!BACKOFF_STATUS_CODES.has(webhook.statusCode)) {
      this.#until.delete(id)
      return null
    }

    const until = now + (webhook.retryAfterMs ?? this.#defaultMs)
    this.#until.set(id, until)
    return until
  }
}
