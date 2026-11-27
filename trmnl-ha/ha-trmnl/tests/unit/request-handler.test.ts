/**
 * Unit tests for RequestHandler — how a failed screenshot request is answered.
 *
 * @see lib/request-handler.ts
 * @module tests/unit/request-handler
 */

import { describe, it, expect } from 'bun:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RequestHandler } from '../../lib/request-handler.js'
import { CannotOpenPageError, HassStartingError } from '../../error.js'
import type { Browser } from '../../screenshot.js'

/** Browser whose navigation fails with the given error */
function failingBrowser(error: Error): Browser {
  return {
    navigatePage: async () => {
      throw error
    },
  } as unknown as Browser
}

/** Response that records what was sent */
function recordingResponse(): ServerResponse & { body?: string } {
  const sent: { statusCode: number; headersSent: boolean; body?: string; end(body?: string): void } = {
    statusCode: 200,
    headersSent: false,
    end(body) {
      sent.body = body
      sent.headersSent = true
    },
  }
  return sent as unknown as ServerResponse & { body?: string }
}

const request = {
  method: 'GET',
  url: '/lovelace/0?viewport=800x480',
  headers: {},
} as IncomingMessage

describe('RequestHandler — failed screenshot requests', () => {
  it('answers 404 when the page cannot be opened', async () => {
    const handler = new RequestHandler(failingBrowser(new CannotOpenPageError(404, '/lovelace/0')))
    const response = recordingResponse()

    await handler.handleRequest(request, response)

    expect(response.statusCode).toBe(404)
  })

  it('answers 503 while Home Assistant is starting', async () => {
    const handler = new RequestHandler(failingBrowser(new HassStartingError('NOT_RUNNING')))
    const response = recordingResponse()

    await handler.handleRequest(request, response)

    expect(response).toMatchObject({ statusCode: 503, body: expect.stringContaining('still starting') })
  })

  it('answers 500 with the reason for any other error, then rethrows it', async () => {
    const error = new Error('capture failed')
    const handler = new RequestHandler(failingBrowser(error))
    const response = recordingResponse()

    await expect(handler.handleRequest(request, response)).rejects.toBe(error)
    expect(response).toMatchObject({ statusCode: 500, body: 'Request failed: capture failed' })
  })
})
