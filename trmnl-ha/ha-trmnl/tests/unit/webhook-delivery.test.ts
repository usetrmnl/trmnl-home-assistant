/**
 * Tests for webhook delivery connection-error reporting (issue #71).
 *
 * Uses a globalThis.fetch override (restored in afterAll) — no network.
 *
 * @see lib/scheduler/webhook-delivery.ts
 * @module tests/unit/webhook-delivery
 */

import { describe, it, expect, afterAll, mock } from 'bun:test'
import { uploadToWebhook } from '../../lib/scheduler/webhook-delivery.js'
import { mockFetch, restoreFetch } from '../helpers/fetch-mock.js'

afterAll(restoreFetch)

describe('uploadToWebhook — connection errors', () => {
  it('names the unreachable host and suggests the DNS fix', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Unable to connect. Is the computer able to access the url?')
    }) as unknown as typeof fetch

    expect(
      uploadToWebhook({
        webhookUrl: 'http://larapaper.home.arpa/api/plugins/abc/webhook',
        imageBuffer: Buffer.from('png'),
        format: 'png',
      }),
    ).rejects.toThrow(
      /Could not reach larapaper\.home\.arpa:.*may not resolve inside the add-on container/,
    )
  })

  it('passes HTTP errors through untouched', async () => {
    mockFetch({ ok: false, status: 500, text: async () => 'nope' })

    expect(
      uploadToWebhook({
        webhookUrl: 'http://byos.local/api/screens',
        imageBuffer: Buffer.from('png'),
        format: 'png',
      }),
    ).rejects.toThrow(/HTTP 500/)
  })
})
