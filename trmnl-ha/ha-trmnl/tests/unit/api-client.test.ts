/**
 * Tests for API Client
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { FetchPreview } from '../../html/js/api-client.js'
import { mockFetch, restoreFetch } from '../helpers/fetch-mock.js'

afterEach(restoreFetch)

describe('FetchPreview', () => {
  describe('#call', () => {
    it('joins params with & when the path carries its own query', async () => {
      let requestedUrl = ''
      globalThis.fetch = (async (url: unknown) => {
        requestedUrl = String(url)
        return new Response(new Blob(['png']), { status: 200 })
      }) as unknown as typeof fetch

      await new FetchPreview().call(
        '/lovelace/0?kiosk',
        new URLSearchParams({ viewport: '800x480' }),
      )

      expect(requestedUrl).toBe('./lovelace/0?kiosk&viewport=800x480')
    })

    it('rejects with response body text when request fails', async () => {
      mockFetch({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () =>
          'Cannot open page: http://homeassistant:8123/lovelace/0 (net::ERR_NAME_NOT_RESOLVED)',
      })

      const fetchPreview = new FetchPreview()

      expect(fetchPreview.call('/lovelace/0', new URLSearchParams())).rejects.toThrow(
        'Cannot open page: http://homeassistant:8123/lovelace/0 (net::ERR_NAME_NOT_RESOLVED)',
      )
    })

    it('rejects with HTTP status when error body is empty', async () => {
      mockFetch({ ok: false, status: 404, statusText: 'Not Found' })

      const fetchPreview = new FetchPreview()

      expect(fetchPreview.call('/lovelace/0', new URLSearchParams())).rejects.toThrow(
        'HTTP 404: Not Found',
      )
    })

    it('resolves with blob when request succeeds', async () => {
      mockFetch({ blob: async () => new Blob(['image-bytes']) })

      const fetchPreview = new FetchPreview()
      const blob = await fetchPreview.call('/lovelace/0', new URLSearchParams())

      expect(blob.size).toBeGreaterThan(0)
    })
  })
})
