/**
 * Shared globalThis.fetch mocks for unit tests.
 *
 * Overrides fetch in place — call restoreFetch() in afterAll/beforeEach
 * to put the real fetch back.
 *
 * @module tests/helpers/fetch-mock
 */

import { mock } from 'bun:test'

const realFetch = globalThis.fetch

/**
 * Stubs fetch with a canned response-like object (defaults: 200 OK, empty body)
 */
export function mockFetch(
  response: Partial<Response> & { json?: () => Promise<unknown> },
): void {
  globalThis.fetch = mock(async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({}),
    headers: new Headers(),
    ...response,
  })) as unknown as typeof fetch
}

/**
 * Stubs fetch to record every call and reply 200 '{}'.
 * Returns the array the calls are pushed into.
 */
export function captureFetch(): { url: string; init?: RequestInit }[] {
  const requests: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = mock(async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  return requests
}

/** Restores the real fetch captured at module load */
export function restoreFetch(): void {
  globalThis.fetch = realFetch
}
