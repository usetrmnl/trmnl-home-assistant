/**
 * @module tests/unit/scheduler-jitter
 */

import { describe, it, expect } from 'bun:test'
import { jitterMs } from '../../scheduler.js'

const MAX = 600000

describe('.jitterMs', () => {
  it('returns 0 when rand is 0', () => {
    expect(jitterMs(MAX, () => 0)).toBe(0)
  })

  it('returns floor(rand * max) for a mid-range rand', () => {
    expect(jitterMs(MAX, () => 0.5)).toBe(300000)
  })

  it('stays strictly below max as rand approaches 1', () => {
    expect(jitterMs(MAX, () => 0.999999)).toBeLessThan(MAX)
  })

  it('returns 0 when max is 0', () => {
    expect(jitterMs(0, () => 0.5)).toBe(0)
  })

  it('returns 0 when max is negative', () => {
    expect(jitterMs(-1000, () => 0.5)).toBe(0)
  })
})
