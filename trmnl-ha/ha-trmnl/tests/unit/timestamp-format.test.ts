/**
 * Tests for the capture-time overlay format (issue #68).
 *
 * Kept separate from dithering.test.ts because formatTimestamp is pure
 * string formatting — no ImageMagick required.
 *
 * @see lib/dithering.ts
 * @module tests/unit/timestamp-format
 */

import { describe, it, expect } from 'bun:test'
import { formatTimestamp } from '../../lib/dithering.js'

describe('formatTimestamp', () => {
  const afternoon = new Date(2026, 6, 16, 14, 30)
  const morning = new Date(2026, 6, 16, 9, 5)

  it('formats 24-hour time by default', () => {
    expect(formatTimestamp(afternoon, false)).toBe('2026-07-16 14:30')
  })

  it('formats 12-hour time with AM/PM when enabled', () => {
    expect(formatTimestamp(afternoon, true)).toBe('2026-07-16 2:30 PM')
  })

  it('keeps minutes zero-padded in 12-hour mode', () => {
    expect(formatTimestamp(morning, true)).toBe('2026-07-16 9:05 AM')
  })

  it('keeps hours zero-padded in 24-hour mode', () => {
    expect(formatTimestamp(morning, false)).toBe('2026-07-16 09:05')
  })
})
