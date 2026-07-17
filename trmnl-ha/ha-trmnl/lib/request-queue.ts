/**
 * Serializes access to the single browser instance.
 *
 * The browser can run one operation at a time; callers acquire before
 * navigating or capturing and release when done. Waiters are woken in
 * arrival order, and release hands the queue directly to the next waiter
 * so a caller arriving in the same tick cannot barge in ahead of it.
 *
 * @module lib/request-queue
 */

export class RequestQueue {
  #busy = false
  #waiting: (() => void)[] = []

  get busy(): boolean {
    return this.#busy
  }

  /** Waits until the queue is free, then holds it. */
  async acquire(): Promise<void> {
    if (this.#busy) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve))
      // The releasing side kept the queue held for us — nothing to claim
      return
    }
    this.#busy = true
  }

  /** Holds the queue only if it is free right now. */
  tryAcquire(): boolean {
    if (this.#busy) return false
    this.#busy = true
    return true
  }

  /** Frees the queue, or hands it directly to the next waiter. */
  release(): void {
    const next = this.#waiting.shift()
    if (next) {
      next()
      return
    }
    this.#busy = false
  }
}
