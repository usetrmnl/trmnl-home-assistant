/**
 * Tests for webhook delivery connection-error reporting (issue #71).
 *
 * Uses a globalThis.fetch override (restored in afterAll) — no network.
 *
 * @see lib/scheduler/webhook-delivery.ts
 * @module tests/unit/webhook-delivery
 */

import { describe, it, expect, afterAll, mock } from 'bun:test'
import {
  uploadToWebhook,
  WebhookHttpError,
} from '../../lib/scheduler/webhook-delivery.js'
import { mockFetch, restoreFetch } from '../helpers/fetch-mock.js'

afterAll(restoreFetch)

/** Minimal upload with only the webhook URL varying */
function upload(webhookUrl = 'http://byos.local/api/screens') {
  return uploadToWebhook({
    webhookUrl,
    imageBuffer: Buffer.from('png'),
    format: 'png',
  })
}

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

    expect(upload()).rejects.toThrow(/HTTP 500/)
  })

  it('keeps the connection error message for a malformed webhook URL', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Invalid URL')
    }) as unknown as typeof fetch

    expect(upload('not a url')).rejects.toThrow(/Could not reach not a url/)
  })
})

describe('uploadToWebhook — HTTP error details', () => {
  it('throws a WebhookHttpError carrying the Retry-After delay on 429', async () => {
    mockFetch({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'Retry-After': '120' }),
    })

    const err = (await upload().then(
      () => null,
      (e: unknown) => e,
    )) as WebhookHttpError

    expect(err).toBeInstanceOf(WebhookHttpError)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(120000)
  })

  it('appends the message field from a JSON error body', async () => {
    mockFetch({
      ok: false,
      status: 413,
      statusText: 'Payload Too Large',
      text: async () => '{"message":"too big"}',
    })

    expect(upload()).rejects.toThrow('HTTP 413: Payload Too Large - too big')
  })

  it('appends a short plain-text error body raw', async () => {
    mockFetch({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'bit depth unsupported',
    })

    expect(upload()).rejects.toThrow(
      'HTTP 400: Bad Request - bit depth unsupported',
    )
  })
})

describe('uploadToWebhook — BYOS 422 fallback', () => {
  it('propagates the original 422 when the screen list fetch fails', async () => {
    // POST → 422 (screen exists), then GET /api/screens → 500 (no PATCH target)
    const responses = [
      new Response('{"error":"exists"}', { status: 422 }),
      new Response('nope', { status: 500 }),
    ]
    globalThis.fetch = mock(
      async () => responses.shift()!,
    ) as unknown as typeof fetch

    const result = uploadToWebhook({
      webhookUrl: 'http://byos.local/api/screens',
      imageBuffer: Buffer.from('png'),
      format: 'png',
      webhookFormat: {
        format: 'byos-hanami',
        byosConfig: {
          label: 'Test',
          name: 'test-screen',
          model_id: '1',
          preprocessed: true,
          auth: {
            enabled: true,
            access_token: 'Bearer token',
            refresh_token: 'refresh',
            obtained_at: Date.now(), // Fresh — no refresh fetch
          },
        },
      },
    })

    await expect(result).rejects.toThrow(/HTTP 422/)
    expect(responses).toHaveLength(0) // Both POST and GET were attempted
  })
})
