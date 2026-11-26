/**
 * Tests for Home Assistant persistent notifications.
 *
 * @see lib/ha-notify.ts
 * @module tests/unit/ha-notify
 */

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import {
  notifyReauthRequired,
  notifyUploadRefused,
  clearUploadRefused,
  resetNotificationState,
} from '../../lib/ha-notify.js'
import * as notifications from '../../lib/ha-notify.js'
import { captureFetch, mockFetch, restoreFetch } from '../helpers/fetch-mock.js'

afterAll(restoreFetch)

const schedule = { id: 'abc123', name: 'Kitchen' }
const ha = { url: 'http://homeassistant:8123', token: 'ha-token' }

describe('ha-notify', () => {
  beforeEach(() => {
    restoreFetch()
    resetNotificationState()
  })

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

  describe('#notifyUploadRefused', () => {
    it("shows the server's reason under one id per schedule", async () => {
      const requests = captureFetch()

      await notifyUploadRefused(schedule, 'HTTP 422: Unprocessable Entity - BMP images are no longer supported.', ha)

      const body = JSON.parse(requests[0]!.init?.body as string)
      expect(body).toMatchObject({
        notification_id: 'trmnl_upload_refused_abc123',
        message: expect.stringContaining('BMP images are no longer supported.'),
      })
    })
  })

  describe('#clearUploadRefused', () => {
    it('dismisses the refusal notification for the schedule', async () => {
      const requests = captureFetch()

      await clearUploadRefused(schedule, ha)

      expect(requests[0]!.url).toBe(
        'http://homeassistant:8123/api/services/persistent_notification/dismiss',
      )
      expect(JSON.parse(requests[0]!.init?.body as string)).toEqual({
        notification_id: 'trmnl_upload_refused_abc123',
      })
    })
  })
})


describe('clearing recovered BYOS authentication', () => {
  beforeEach(resetNotificationState)

  it('dismisses the same persistent notification created for the schedule', async () => {
    const requests = captureFetch()
    expect(notifications).toHaveProperty('clearReauthRequired')
    await notifications.clearReauthRequired(schedule, ha)
    expect(requests[0]!.url).toBe(
      'http://homeassistant:8123/api/services/persistent_notification/dismiss',
    )
    expect(JSON.parse(requests[0]!.init?.body as string)).toEqual({
      notification_id: 'trmnl_byos_reauth_abc123',
    })
  })
})

// A successful upload clears its notices every time; only the first clear
// after start (or after a create) may reach Home Assistant.
describe('ha-notify repeated dismiss', () => {
  beforeEach(() => {
    restoreFetch()
    resetNotificationState()
  })

  it('calls dismiss once, then skips repeats', async () => {
    const requests = captureFetch()

    await clearUploadRefused(schedule, ha)
    await clearUploadRefused(schedule, ha)
    await clearUploadRefused(schedule, ha)

    expect(requests).toHaveLength(1)
  })

  it('dismisses again after a create', async () => {
    const requests = captureFetch()

    await clearUploadRefused(schedule, ha)
    await notifyUploadRefused(schedule, 'HTTP 422', ha)
    await clearUploadRefused(schedule, ha)
    await clearUploadRefused(schedule, ha)

    expect(requests.map((r) => r.url.split('/').pop())).toEqual(['dismiss', 'create', 'dismiss'])
  })

  it('keeps ids apart per schedule and per notice', async () => {
    const requests = captureFetch()

    await clearUploadRefused(schedule, ha)
    await clearUploadRefused({ id: 'other' }, ha)
    await notifications.clearReauthRequired(schedule, ha)
    await clearUploadRefused(schedule, ha)

    expect(requests).toHaveLength(3)
  })

  it('does not treat a notice as dismissed when a create overtakes the dismiss', async () => {
    const calls: string[] = []
    let finishDismiss: (response: Response) => void = () => {}
    globalThis.fetch = mock(async (url: string | URL) => {
      const service = String(url).split('/').pop()!
      calls.push(service)
      if (calls.length === 1) {
        return new Promise<Response>((resolve) => {
          finishDismiss = resolve
        })
      }
      return new Response('[]')
    }) as unknown as typeof fetch

    const slowDismiss = clearUploadRefused(schedule, ha)
    await notifyUploadRefused(schedule, 'HTTP 422', ha)
    finishDismiss(new Response('[]'))
    await slowDismiss
    await clearUploadRefused(schedule, ha)

    expect(calls).toEqual(['dismiss', 'create', 'dismiss'])
  })

  it('tries again when a dismiss failed', async () => {
    mockFetch({ ok: false, status: 502 })
    await clearUploadRefused(schedule, ha)
    const requests = captureFetch()

    await clearUploadRefused(schedule, ha)

    expect(requests).toHaveLength(1)
  })
})
