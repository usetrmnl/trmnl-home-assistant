/**
 * Tests for Home Assistant persistent notifications.
 *
 * @see lib/ha-notify.ts
 * @module tests/unit/ha-notify
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { notifyReauthRequired } from '../../lib/ha-notify.js'
import { captureFetch, mockFetch, restoreFetch } from '../helpers/fetch-mock.js'

afterAll(restoreFetch)

const schedule = { id: 'abc123', name: 'Kitchen' }
const ha = { url: 'http://homeassistant:8123', token: 'ha-token' }

describe('ha-notify', () => {
  beforeEach(restoreFetch)

  describe('#notifyReauthRequired', () => {
    it('calls the persistent notification service with the schedule name', async () => {
      const requests = captureFetch()

      await notifyReauthRequired(schedule, ha)

      expect(requests[0]!.url).toBe(
        'http://homeassistant:8123/api/services/persistent_notification/create',
      )
      expect(requests[0]!.init).toMatchObject({
        method: 'POST',
        headers: { Authorization: 'Bearer ha-token' },
      })
      const body = JSON.parse(requests[0]!.init?.body as string)
      expect(body.message).toContain('Kitchen')
    })

    it('reuses one notification id per schedule so expiries do not stack up', async () => {
      const requests = captureFetch()

      await notifyReauthRequired(schedule, ha)
      await notifyReauthRequired(schedule, ha)

      const ids = requests.map(
        (request) => JSON.parse(request.init?.body as string).notification_id,
      )
      expect(ids).toEqual(['trmnl_byos_reauth_abc123', 'trmnl_byos_reauth_abc123'])
    })

    it('stays quiet when no Home Assistant token is configured', async () => {
      const requests = captureFetch()

      await notifyReauthRequired(schedule, { url: ha.url, token: '' })

      expect(requests).toHaveLength(0)
    })

    it('swallows a rejected request rather than failing the tick', async () => {
      mockFetch({ ok: false, status: 401 })

      expect(await notifyReauthRequired(schedule, ha)).toBeUndefined()
    })

    it('swallows an unreachable Home Assistant', async () => {
      globalThis.fetch = (async () => {
        throw new Error('ECONNREFUSED')
      }) as unknown as typeof fetch

      expect(await notifyReauthRequired(schedule, ha)).toBeUndefined()
    })
  })
})
