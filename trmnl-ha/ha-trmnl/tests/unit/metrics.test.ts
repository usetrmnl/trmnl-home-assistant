/**
 * Tests for the pipeline timing metrics module.
 *
 * @see lib/metrics.ts
 * @module tests/unit/metrics
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  recordTiming,
  timed,
  metricsSummary,
  resetMetrics,
} from '../../lib/metrics.js'

describe('metrics', () => {
  beforeEach(() => {
    resetMetrics()
  })

  it('summarizes recorded samples with percentiles', () => {
    for (let ms = 1; ms <= 100; ms++) recordTiming('stage.a', ms)

    const summary = metricsSummary()['stage.a']!

    expect(summary.count).toBe(100)
    expect(summary.meanMs).toBe(51) // mean of 1..100 rounded
    expect(summary.p50Ms).toBe(50)
    expect(summary.p95Ms).toBe(95)
    expect(summary.maxMs).toBe(100)
    expect(summary.lastMs).toBe(100)
  })

  it('bounds memory by keeping a rolling window but counting all samples', () => {
    for (let i = 0; i < 500; i++) recordTiming('stage.b', 10)

    const summary = metricsSummary()['stage.b']!

    expect(summary.count).toBe(500)
    expect(summary.meanMs).toBe(10)
  })

  it('times async work and records the duration', async () => {
    const result = await timed('stage.c', async () => {
      await new Promise((r) => setTimeout(r, 25))
      return 'done'
    })

    expect(result).toBe('done')
    expect(metricsSummary()['stage.c']!.lastMs).toBeGreaterThanOrEqual(20)
  })

  it('records the duration even when the operation throws', async () => {
    expect(
      timed('stage.d', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(metricsSummary()['stage.d']!.count).toBe(1)
  })

  it('returns an empty object when nothing is recorded', () => {
    expect(metricsSummary()).toEqual({})
  })
})
