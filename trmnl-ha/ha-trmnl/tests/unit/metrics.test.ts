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

  it('slides the sample window while counting all samples', () => {
    // 500 samples, window of 200: only the last 200 (all 30s) remain
    for (let i = 0; i < 200; i++) recordTiming('stage.b', 10)
    for (let i = 0; i < 300; i++) recordTiming('stage.b', 30)

    const summary = metricsSummary()['stage.b']!

    expect(summary.count).toBe(500)
    expect(summary.meanMs).toBe(30)
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

  it('keeps stages independent', () => {
    recordTiming('stage.fast', 5)
    recordTiming('stage.slow', 5000)

    const summary = metricsSummary()

    expect(summary['stage.fast']!.maxMs).toBe(5)
    expect(summary['stage.slow']!.maxMs).toBe(5000)
  })

  it('summarizes a single sample without percentile errors', () => {
    recordTiming('stage.once', 42)

    const summary = metricsSummary()['stage.once']!

    expect(summary.p50Ms).toBe(42)
    expect(summary.p95Ms).toBe(42)
    expect(summary.meanMs).toBe(42)
  })
})
