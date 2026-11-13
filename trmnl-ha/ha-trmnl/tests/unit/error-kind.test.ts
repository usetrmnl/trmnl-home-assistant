import { describe, expect, it } from 'bun:test'
import { errorKind } from '../../lib/error-kind.js'

describe('errorKind', () => {
  it('names a system error by its code', () => {
    expect(errorKind(Object.assign(new Error('connect to https://x/SECRET'), { code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED')
  })

  it('reads the code from a fetch failure cause', () => {
    expect(errorKind(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))).toBe('ENOTFOUND')
  })

  it('falls back to the error type, never the message', () => {
    const kind = errorKind(new RangeError('token SECRET rejected'))
    expect(kind).toBe('RangeError')
  })

  it('handles a thrown non-error', () => {
    expect(errorKind('SECRET')).toBe('unknown error')
  })
})
