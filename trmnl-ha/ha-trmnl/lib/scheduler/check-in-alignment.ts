/**
 * Times a schedule's next capture to land just before the TRMNL device checks
 * in, using the `next_check_in_at` the image upload endpoint answers. A cron
 * fire while a capture is pending is redundant and skipped; a reply without a
 * time hands the schedule back to its cron.
 *
 * @module lib/scheduler/check-in-alignment
 */

/** A check-in further out than this is a device asleep or gone; the cron covers it. */
const MAX_LOOKAHEAD_MS = 24 * 60 * 60 * 1000
/** Lead learned from slow runs: twice the slowest of the last five, plus this, capped. */
const RUN_DURATIONS_KEPT = 5
const LEARNED_LEAD_MARGIN_MS = 30_000
const MAX_LEAD_MS = 15 * 60 * 1000

/** Epoch ms of `data.next_check_in_at` in an upload response body, if present. */
export function parseNextCheckInAt(responseText: string): number | undefined {
  try {
    const parsed = JSON.parse(responseText) as { data?: { next_check_in_at?: unknown } }
    const value = parsed?.data?.next_check_in_at
    if (typeof value !== 'string') return undefined
    const at = Date.parse(value)
    return Number.isFinite(at) ? at : undefined
  } catch {
    return undefined
  }
}

/** Timer functions, injectable for tests. */
export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(timer: unknown): void
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

interface PendingCapture {
  at: number
  timer: unknown
}

export class CheckInAligner {
  #leadMs: number
  #timers: Timers
  #pending = new Map<string, PendingCapture>()
  #runDurations = new Map<string, number[]>()

  constructor(leadMs: number, timers: Timers = realTimers) {
    this.#leadMs = leadMs
    this.#timers = timers
  }

  /**
   * Arms one capture at `nextCheckInAt - lead`. Returns the capture time, or
   * null when there is nothing to schedule: no time, a check-in already inside the
   * lead (the image just sent is the one it will get), or one too far out.
   */
  scheduleCapture(id: string, nextCheckInAt: number | undefined, run: () => void, now: number = Date.now()): number | null {
    this.clear(id)
    if (nextCheckInAt === undefined) return null

    const at = nextCheckInAt - this.leadMsFor(id)
    if (at <= now || nextCheckInAt - now > MAX_LOOKAHEAD_MS) return null

    const timer = this.#timers.set(() => {
      this.#pending.delete(id)
      run()
    }, at - now)
    this.#pending.set(id, { at, timer })
    return at
  }

  /** How long a schedule's last capture and upload took, so a slow dashboard gets a longer lead. */
  recordRunDuration(id: string, durationMs: number): void {
    const recent = [...(this.#runDurations.get(id) ?? []), durationMs].slice(-RUN_DURATIONS_KEPT)
    this.#runDurations.set(id, recent)
  }

  /** The configured lead, or more when this schedule's recent runs need it. */
  leadMsFor(id: string): number {
    const slowest = Math.max(0, ...(this.#runDurations.get(id) ?? []))
    return Math.min(Math.max(this.#leadMs, 2 * slowest + LEARNED_LEAD_MARGIN_MS), MAX_LEAD_MS)
  }

  /** Epoch ms of the pending capture for a schedule, or null. */
  pendingAt(id: string): number | null {
    return this.#pending.get(id)?.at ?? null
  }

  clear(id: string): void {
    const pending = this.#pending.get(id)
    if (!pending) return
    this.#timers.clear(pending.timer)
    this.#pending.delete(id)
  }

  stopAll(): void {
    for (const id of [...this.#pending.keys()]) this.clear(id)
  }
}
