/**
 * Unit tests for parseRetryAfterMs.
 *
 * Only the delta-seconds form of Retry-After is supported; everything else
 * returns null so the scheduler falls back to its default cooldown.
 *
 * @module tests/unit/webhook-retry-after
 */

import { describe, it, expect } from 'bun:test'
import { parseRetryAfterMs } from '../../lib/scheduler/webhook-delivery.js'

describe('.parseRetryAfterMs', () => {
  it('parses delta-seconds into milliseconds', () => {
    expect(parseRetryAfterMs('120')).toBe(120000)
  })

  it('parses zero seconds', () => {
    expect(parseRetryAfterMs('0')).toBe(0)
  })

  it('trims surrounding whitespace', () => {
    expect(parseRetryAfterMs('  30 ')).toBe(30000)
  })

  it('returns null for a null header', () => {
    expect(parseRetryAfterMs(null)).toBeNull()
  })

  it('returns null for an empty header', () => {
    expect(parseRetryAfterMs('')).toBeNull()
  })

  it('returns null for an HTTP-date header', () => {
    expect(parseRetryAfterMs('Wed, 21 Oct 2025 07:28:00 GMT')).toBeNull()
  })

  it('returns null for a non-numeric header', () => {
    expect(parseRetryAfterMs('soon')).toBeNull()
  })

  it('returns null for a negative value', () => {
    expect(parseRetryAfterMs('-5')).toBeNull()
  })

  it('returns null for a fractional value', () => {
    expect(parseRetryAfterMs('1.5')).toBeNull()
  })
})
