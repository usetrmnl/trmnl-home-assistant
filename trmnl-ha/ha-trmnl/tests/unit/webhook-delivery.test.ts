/**
 * Tests for webhook delivery connection-error reporting (issue #71).
 *
 * Uses a globalThis.fetch override (restored in afterAll) — no network.
 *
 * @see lib/scheduler/webhook-delivery.ts
 * @module tests/unit/webhook-delivery
 */

import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import {
  uploadToWebhook,
  clearKnownByosScreenIds,
  WebhookHttpError,
  WebhookConnectionError,
  redactWebhookUrl,
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

describe('uploadToWebhook — next check-in', () => {
  it('carries the next check-in time the TRMNL image endpoint answers', async () => {
    mockFetch({ text: async () => '{"data":{"message":"Image upload queued","next_check_in_at":"2026-11-03T12:10:00Z"}}' })

    const result = await upload('https://trmnl.com/api/plugin_settings/abc/image')
    expect(result.nextCheckInAt).toBe(Date.parse('2026-11-03T12:10:00Z'))
  })

  it('leaves it unset when the server answers without one', async () => {
    mockFetch({ text: async () => '{"message":"ok"}' })

    const result = await upload()
    expect(result.nextCheckInAt).toBeUndefined()
  })
})

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
      /Could not reach larapaper\.home\.arpa:.*may not resolve inside the app container/,
    )
  })

  it('marks an unreachable server as a WebhookConnectionError', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('The socket connection was closed unexpectedly.')
    }) as unknown as typeof fetch

    const error = await upload().then(() => null, (err: unknown) => err)
    expect(error).toBeInstanceOf(WebhookConnectionError)
  })

  it('passes HTTP errors through untouched', async () => {
    mockFetch({ ok: false, status: 500, text: async () => 'nope' })

    const error = await upload().then(() => null, (err: unknown) => err)
    expect(error).toBeInstanceOf(WebhookHttpError)
    expect(error).not.toBeInstanceOf(WebhookConnectionError)
    expect((error as Error).message).toMatch(/HTTP 500/)
  })

  it('does not echo a malformed webhook URL in a connection error', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Invalid URL')
    }) as unknown as typeof fetch

    expect(upload('not a url')).rejects.toThrow(/Could not reach \[invalid webhook URL\]/)
  })

  it('redacts a credential-bearing webhook URL from a fetch error', async () => {
    const url = 'https://trmnl.example/api/plugin_settings/private-id/image?token=private'
    globalThis.fetch = mock(async () => {
      throw new Error(`Could not fetch ${url}`)
    }) as unknown as typeof fetch

    const error = await upload(url).then(() => null, (err: unknown) => err as Error)
    expect(error?.message).not.toContain(url)
    expect(error?.message).toContain('[redacted webhook URL]')
  })
})

describe('redactWebhookUrl', () => {
  it('removes each copy of the configured URL without masking safe context', () => {
    const url = 'https://trmnl.example/api/plugin_settings/private-id/image?token=private'
    expect(redactWebhookUrl(`POST ${url} failed: ${url}`, url)).toBe(
      'POST [redacted webhook URL] failed: [redacted webhook URL]',
    )
  })
})

describe('uploadToWebhook — HTTP error details', () => {
  function mockRefusal(body: unknown) {
    mockFetch({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Content',
      text: async () => JSON.stringify(body),
    })
  }

  it('shows the detail of a Problem Details response', async () => {
    mockRefusal({ title: 'Unprocessable Content', status: 422, detail: 'Image is too large.' })

    await expect(upload()).rejects.toThrow('HTTP 422: Unprocessable Content - Image is too large.')
  })

  it('removes URLs from a Problem Details detail', async () => {
    mockRefusal({ detail: 'Could not fetch http://app.local:10000/output/a.png?secret=abc123 for screen.' })

    const error = await upload().catch((err: unknown) => err as Error)
    expect((error as Error).message).toContain('Could not fetch [redacted URL] for screen.')
    expect((error as Error).message).not.toContain('abc123')
  })

  it('ignores a detail that is not text', async () => {
    mockRefusal({ detail: { field: 'uri' } })

    const error = await upload().catch((err: unknown) => err as Error)
    expect((error as Error).message).toBe('HTTP 422: Unprocessable Content')
  })

  it('redacts the configured URL from response details that callers may log', async () => {
    const url = 'https://trmnl.example/api/plugin_settings/private-id/image?token=private'
    mockFetch({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify({ message: `Rejected ${url}` }),
    })

    const error = await upload(url).then(() => null, (err: unknown) => err as Error)
    expect(error?.message).not.toContain(url)
    expect(error?.message).toContain('[redacted webhook URL]')
  })

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

  it('shows the reason of a refused PATCH, not of the create', async () => {
    const responses = [
      Response.json({ detail: 'Screen exists with name ("test-screen") and model ID (1).' }, { status: 422 }),
      Response.json({ data: [{ id: 7, model_id: 1, name: 'test-screen' }] }),
      Response.json({ detail: 'magick: improper image header.' }, { status: 422 }),
    ]
    globalThis.fetch = mock(async () => responses.shift()!) as unknown as typeof fetch

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
          auth: { enabled: true, access_token: 'Bearer token', refresh_token: 'refresh', obtained_at: Date.now() },
        },
      },
    })

    await expect(result).rejects.toThrow(/^HTTP 422: .* - magick: improper image header\.$/)
  })
})

describe('uploadToWebhook — BYOS server error', () => {
  function uploadAfterServerError(screenshotUrl?: string) {
    mockFetch({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => `<!DOCTYPE html><title>500: Internal Server Error</title>${' '.repeat(1000)}`,
    })
    return uploadToWebhook({
      webhookUrl: 'http://byos.local/api/screens',
      imageBuffer: Buffer.from('png'),
      format: 'png',
      screenshotUrl,
      webhookFormat: {
        format: 'byos-hanami',
        byosConfig: { label: 'Test', name: 'test-screen', model_id: '1', preprocessed: true },
      },
    })
  }

  it('points at the App URL when Terminus could not load the screenshot', async () => {
    await expect(uploadAfterServerError('http://app.local:10000/output/a.png')).rejects.toThrow(
      'HTTP 500: Internal Server Error - Terminus could not load the screenshot. Check that Terminus can open the App URL in the schedule settings.',
    )
  })

  it('adds no hint when the image is sent as data', async () => {
    await expect(uploadAfterServerError()).rejects.toThrow(/^HTTP 500: Internal Server Error$/)
  })
})

describe('uploadToWebhook — known BYOS screen ids', () => {
  const screensUrl = 'http://byos.local/api/screens'
  const screenList = () =>
    Response.json({ data: [{ id: 7, model_id: 1, label: 'Test', name: 'test-screen' }] })

  /** Queues responses and records each request as "METHOD /path". */
  function queue(responses: (Response | Error)[]): string[] {
    const calls: string[] = []
    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
      const next = responses.shift()!
      if (next instanceof Error) throw next
      return next
    }) as unknown as typeof fetch
    return calls
  }

  function byosUpload(name = 'test-screen', webhookUrl = screensUrl) {
    return uploadToWebhook({
      webhookUrl,
      imageBuffer: Buffer.from('png'),
      format: 'png',
      webhookFormat: {
        format: 'byos-hanami',
        byosConfig: {
          label: 'Test',
          name,
          model_id: '1',
          preprocessed: true,
          auth: {
            enabled: true,
            access_token: 'Bearer token',
            refresh_token: 'refresh',
            obtained_at: Date.now(),
          },
        },
      },
    })
  }

  /** Teaches the module screen id 7 through the normal 422 flow. */
  async function learnScreenId() {
    queue([
      new Response('{"error":"exists"}', { status: 422 }),
      screenList(),
      new Response('{}', { status: 200 }),
    ])
    await byosUpload()
  }

  beforeEach(() => clearKnownByosScreenIds())

  it('sends a single PATCH once the id was learned from the 422 flow', async () => {
    await learnScreenId()
    const calls = queue([new Response('{}', { status: 200 })])

    const result = await byosUpload()

    expect(result.success).toBe(true)
    expect(calls).toEqual(['PATCH /api/screens/7'])
  })

  it('remembers the id from a successful create', async () => {
    queue([Response.json({ data: { id: 9 } }, { status: 201 })])
    await byosUpload()
    const calls = queue([new Response('{}', { status: 200 })])

    await byosUpload()

    expect(calls).toEqual(['PATCH /api/screens/9'])
  })

  it('keeps ids separate per screen name and server', async () => {
    await learnScreenId()

    let calls = queue([Response.json({ data: { id: 8 } }, { status: 201 })])
    await byosUpload('other-screen')
    expect(calls).toEqual(['POST /api/screens'])

    calls = queue([Response.json({ data: { id: 3 } }, { status: 201 })])
    await byosUpload('test-screen', 'http://other.local/api/screens')
    expect(calls).toEqual(['POST /api/screens'])
  })

  for (const status of [404, 422]) {
    it(`falls back to create when the known screen is gone (${status})`, async () => {
      await learnScreenId()
      const calls = queue([
        new Response('{"error":"Unable to find screen"}', { status }),
        Response.json({ data: { id: 11 } }, { status: 201 }),
        new Response('{}', { status: 200 }),
      ])

      await byosUpload()
      await byosUpload()

      expect(calls).toEqual([
        'PATCH /api/screens/7',
        'POST /api/screens',
        'PATCH /api/screens/11',
      ])
    })
  }

  it('surfaces other HTTP errors without a POST and keeps the id', async () => {
    await learnScreenId()
    const calls = queue([
      new Response('{"error":"slow down"}', {
        status: 429,
        headers: { 'Retry-After': '30' },
      }),
      new Response('{}', { status: 200 }),
    ])

    const error = await byosUpload().catch((err: unknown) => err)
    expect(error).toBeInstanceOf(WebhookHttpError)
    expect((error as WebhookHttpError).status).toBe(429)
    expect((error as WebhookHttpError).retryAfterMs).toBe(30_000)

    await byosUpload()
    expect(calls).toEqual(['PATCH /api/screens/7', 'PATCH /api/screens/7'])
  })

  it('reports a connection failure by host and keeps the id', async () => {
    await learnScreenId()
    const calls = queue([
      new Error('Unable to connect'),
      new Response('{}', { status: 200 }),
    ])

    const error = await byosUpload().catch((err: unknown) => err)
    expect(error).toBeInstanceOf(WebhookConnectionError)
    expect((error as Error).message).toMatch(/Could not reach byos\.local/)
    await byosUpload()

    expect(calls).toEqual(['PATCH /api/screens/7', 'PATCH /api/screens/7'])
  })
})
