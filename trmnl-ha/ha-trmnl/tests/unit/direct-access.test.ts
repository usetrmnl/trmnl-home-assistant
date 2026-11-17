/**
 * Unit tests for direct port access rules
 *
 * @module tests/unit/direct-access
 */

import { describe, it, expect } from 'bun:test'
import type { IncomingMessage } from 'node:http'
import { directAccessRefusal, withDirectAccessSecret } from '../../lib/direct-access.js'

const LAN_ADDRESS = '192.168.1.50'
const SUPERVISOR = '172.30.32.2'

function request(remoteAddress: string, authorization?: string): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: authorization ? { authorization } : {},
  } as unknown as IncomingMessage
}

const refusal = (path: string, from: IncomingMessage, policy: { isAddOn: boolean; secret?: string }) =>
  directAccessRefusal(from, new URL(path, 'http://localhost'), policy)

describe('directAccessRefusal', () => {
  describe('without a secret', () => {
    const policy = { isAddOn: true }

    it.each(['/api/schedules', '/api/schedules/abc', '/'])('refuses %s from the network', (path) => {
      expect(refusal(path, request(LAN_ADDRESS), policy)).toContain('Show in sidebar')
    })

    it.each(['/lovelace/0?viewport=800x480', '/?url=https%3A%2F%2Fexample.com', '/output/kitchen.png', '/health'])(
      'serves %s to the network',
      (path) => {
        expect(refusal(path, request(LAN_ADDRESS), policy)).toBeNull()
      },
    )

    it('serves the API through ingress', () => {
      expect(refusal('/api/schedules', request(SUPERVISOR), policy)).toBeNull()
    })

    it('serves the API through ingress on an IPv4-mapped address', () => {
      expect(refusal('/api/schedules', request(`::ffff:${SUPERVISOR}`), policy)).toBeNull()
    })

    it('treats Home Assistant Core on the gateway address as the network', () => {
      expect(refusal('/api/schedules', request('172.30.32.1'), policy)).toContain('sidebar')
    })
  })

  describe('with a secret', () => {
    const policy = { isAddOn: true, secret: 's3cret' }

    it('refuses a render without the secret', () => {
      expect(refusal('/lovelace/0', request(LAN_ADDRESS), policy)).toContain('secret')
    })

    it('refuses a wrong secret', () => {
      expect(refusal('/api/schedules?secret=guess', request(LAN_ADDRESS), policy)).toContain('secret')
    })

    it('serves the API with the secret in the query', () => {
      expect(refusal('/api/schedules?secret=s3cret', request(LAN_ADDRESS), policy)).toBeNull()
    })

    it('serves the API with the secret as a bearer token', () => {
      expect(refusal('/api/schedules', request(LAN_ADDRESS, 'Bearer s3cret'), policy)).toBeNull()
    })

    it('refuses the settings page even with the secret, since its API calls carry none', () => {
      expect(refusal('/?secret=s3cret', request(LAN_ADDRESS), policy)).toContain('sidebar')
    })

    it('serves health checks without the secret', () => {
      expect(refusal('/health', request(LAN_ADDRESS), policy)).toBeNull()
    })

    it('serves ingress without the secret', () => {
      expect(refusal('/lovelace/0', request(SUPERVISOR), policy)).toBeNull()
    })
  })

  it('leaves standalone installs open, which have no ingress', () => {
    expect(refusal('/api/schedules', request(LAN_ADDRESS), { isAddOn: false })).toBeNull()
  })

  it('refuses a request whose socket address is unknown', () => {
    const unknown = { socket: {}, headers: {} } as unknown as IncomingMessage

    expect(refusal('/api/schedules', unknown, { isAddOn: true })).toContain('sidebar')
  })
})

describe('withDirectAccessSecret', () => {
  it('adds the secret to the query', () => {
    expect(withDirectAccessSecret('http://ha.local:10000/output/a.png', 's3cret')).toBe(
      'http://ha.local:10000/output/a.png?secret=s3cret',
    )
  })

  it('returns the URL unchanged without a secret', () => {
    expect(withDirectAccessSecret('http://ha.local:10000/output/a.png', undefined)).toBe(
      'http://ha.local:10000/output/a.png',
    )
  })
})
