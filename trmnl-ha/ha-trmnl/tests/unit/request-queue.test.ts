/**
 * Tests for the request queue serializing browser access.
 *
 * @see lib/request-queue.ts
 * @module tests/unit/request-queue
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { RequestQueue } from '../../lib/request-queue.js'

describe('RequestQueue', () => {
  let queue: RequestQueue

  beforeEach(() => {
    queue = new RequestQueue()
  })

  it('acquires immediately when free', async () => {
    await queue.acquire()

    expect(queue.busy).toBe(true)
  })

  it('makes a second acquire wait until release', async () => {
    await queue.acquire()
    let secondAcquired = false
    const second = queue.acquire().then(() => {
      secondAcquired = true
    })
    await Bun.sleep(1)

    expect(secondAcquired).toBe(false)

    queue.release()
    await second

    expect(secondAcquired).toBe(true)
    expect(queue.busy).toBe(true)
  })

  it('wakes waiters in arrival order', async () => {
    await queue.acquire()
    const order: number[] = []
    const first = queue.acquire().then(() => order.push(1))
    const second = queue.acquire().then(() => order.push(2))

    queue.release()
    await first
    queue.release()
    await second

    expect(order).toEqual([1, 2])
  })

  it('frees the queue on release with no waiters', async () => {
    await queue.acquire()
    queue.release()

    expect(queue.busy).toBe(false)
  })

  it('tryAcquire holds the queue only when free', async () => {
    expect(queue.tryAcquire()).toBe(true)
    expect(queue.tryAcquire()).toBe(false)

    queue.release()

    expect(queue.tryAcquire()).toBe(true)
  })

  it('hands the queue to a waiter before a new caller can take it', async () => {
    await queue.acquire()
    const waiter = queue.acquire()

    queue.release()

    // The queue belongs to the waiter from the moment of release
    expect(queue.tryAcquire()).toBe(false)
    await waiter
    expect(queue.busy).toBe(true)
  })
})
