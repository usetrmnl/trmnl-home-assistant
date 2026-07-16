/**
 * In-memory pipeline timing metrics.
 *
 * Each pipeline stage records durations into a bounded ring buffer;
 * summaries (count/mean/p50/p95/max/last) are exposed on /health so slow
 * installs can be diagnosed from real numbers instead of guesses (#57).
 *
 * Deliberately tiny: no histograms, no exporters, no dependencies.
 *
 * @module lib/metrics
 */

/** Samples kept per stage — enough for a day of typical schedules */
const MAX_SAMPLES = 200

/** Summary statistics for one stage */
export interface StageSummary {
  count: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  lastMs: number
}

const stages = new Map<string, { samples: number[]; count: number }>()

/** Records one duration sample for a stage. */
export function recordTiming(stage: string, ms: number): void {
  let s = stages.get(stage)
  if (!s) {
    s = { samples: [], count: 0 }
    stages.set(stage, s)
  }
  s.count++
  s.samples.push(ms)
  if (s.samples.length > MAX_SAMPLES) s.samples.shift()
}

/** Times an async operation and records it under the given stage. */
export async function timed<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    recordTiming(stage, Math.round(performance.now() - start))
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]!
}

/** Rolling summary of all recorded stages, alphabetical by stage name. */
export function metricsSummary(): Record<string, StageSummary> {
  const result: Record<string, StageSummary> = {}
  for (const name of [...stages.keys()].sort()) {
    const { samples, count } = stages.get(name)!
    if (samples.length === 0) continue
    const sorted = [...samples].sort((a, b) => a - b)
    result[name] = {
      count,
      meanMs: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      maxMs: sorted[sorted.length - 1]!,
      lastMs: samples[samples.length - 1]!,
    }
  }
  return result
}

/** Clears all recorded samples (tests and benchmark resets). */
export function resetMetrics(): void {
  stages.clear()
}
