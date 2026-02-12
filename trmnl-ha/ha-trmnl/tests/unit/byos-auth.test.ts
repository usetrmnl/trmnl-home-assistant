/**
 * Tests for BYOS JWT Authentication Manager.
 *
 * Covers:
 * - getBaseUrl() — pure URL parsing
 * - getValidAccessToken() — token validation and refresh flow
 * - login() — fetch-based login with error handling
 *
 * Uses globalThis.fetch override (scoped to this file) instead of
 * mock.module to avoid Bun's global mock pollution.
 *
 * @see lib/scheduler/byos-auth.ts
 * @module tests/unit/byos-auth
 */

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import {
  getBaseUrl,
  getValidAccessToken,
  login,
} from '../../lib/scheduler/byos-auth.js'
import type { ByosAuthConfig } from '../../types/domain.js'

// ---------------------------------------------------------------------------
// Fetch mock — scoped to this file, restored in afterAll
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch

function mockFetch(
  response: Partial<Response> & { json?: () => Promise<unknown> },
) {
  globalThis.fetch = mock(async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({}),
    ...response,
  })) as unknown as typeof fetch
}

afterAll(() => {
  globalThis.fetch = realFetch
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('byos-auth', () => {
  beforeEach(() => {
    globalThis.fetch = realFetch
  })

  // -------------------------------------------------------------------------
  // getBaseUrl
  // -------------------------------------------------------------------------

  describe('#getBaseUrl', () => {
    it('extracts base URL from webhook path', () => {
      expect(getBaseUrl('https://example.com/api/screens')).toBe(
        'https://example.com',
      )
    })

    it('preserves non-standard ports', () => {
      expect(getBaseUrl('https://trmnl.local:3000/api/screens')).toBe(
        'https://trmnl.local:3000',
      )
    })

    it('handles HTTP protocol', () => {
      expect(getBaseUrl('http://192.168.1.100/api/screens')).toBe(
        'http://192.168.1.100',
      )
    })

    it('handles deep webhook paths', () => {
      expect(getBaseUrl('https://host.com/v2/api/webhook/push')).toBe(
        'https://host.com',
      )
    })
  })

  // -------------------------------------------------------------------------
  // getValidAccessToken — token state logic
  // -------------------------------------------------------------------------

  describe('#getValidAccessToken', () => {
    it('returns null when no access_token stored', async () => {
      const auth: ByosAuthConfig = { enabled: true }

      const result = await getValidAccessToken('https://host.com/api', auth)

      expect(result).toBeNull()
    })

    it('returns null when no refresh_token stored', async () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'some-token',
      }

      const result = await getValidAccessToken('https://host.com/api', auth)

      expect(result).toBeNull()
    })

    it('returns access_token when still valid (not expired)', async () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'valid-token',
        refresh_token: 'refresh',
        obtained_at: Date.now(), // Just obtained — still valid
      }

      const result = await getValidAccessToken('https://host.com/api', auth)

      expect(result).toBe('valid-token')
    })

    it('refreshes token when expired and returns new token', async () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'old-token',
        refresh_token: 'my-refresh',
        obtained_at: Date.now() - 30 * 60 * 1000, // 30 min ago — expired
      }

      mockFetch({
        ok: true,
        json: async () => ({
          access_token: 'fresh-token',
          refresh_token: 'new-refresh',
        }),
      })

      const result = await getValidAccessToken('https://host.com/api', auth)

      expect(result).toBe('fresh-token')
    })

    it('calls onTokenRefresh callback with new tokens', async () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'old',
        refresh_token: 'refresh',
        obtained_at: Date.now() - 30 * 60 * 1000,
      }

      mockFetch({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
        }),
      })

      let callbackTokens: unknown = null
      await getValidAccessToken('https://host.com/api', auth, (tokens) => {
        callbackTokens = tokens
      })

      expect(callbackTokens).toMatchObject({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
      })
    })

    it('returns null when refresh fails', async () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'old',
        refresh_token: 'refresh',
        obtained_at: Date.now() - 30 * 60 * 1000,
      }

      mockFetch({ ok: false, status: 401 })

      const result = await getValidAccessToken('https://host.com/api', auth)

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // login — fetch-based authentication
  // -------------------------------------------------------------------------

  describe('#login', () => {
    it('returns tokens on successful login', async () => {
      mockFetch({
        ok: true,
        json: async () => ({
          access_token: 'acc-123',
          refresh_token: 'ref-456',
        }),
      })

      const result = await login('https://host.com', 'user@test.com', 'pass')

      expect(result.access_token).toBe('acc-123')
      expect(result.refresh_token).toBe('ref-456')
    })

    it('throws when response is not ok', async () => {
      mockFetch({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })

      await expect(
        login('https://host.com', 'bad@test.com', 'wrong'),
      ).rejects.toThrow('BYOS login failed')
    })

    it('throws when response is missing tokens', async () => {
      mockFetch({
        ok: true,
        json: async () => ({ success: true }), // No tokens
      })

      await expect(
        login('https://host.com', 'user@test.com', 'pass'),
      ).rejects.toThrow('missing tokens')
    })

    it('posts to /login endpoint with credentials', async () => {
      let capturedUrl = ''
      let capturedBody = ''

      globalThis.fetch = mock(
        async (input: string | URL | Request, init?: RequestInit) => {
          capturedUrl =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url
          capturedBody = init?.body as string
          return {
            ok: true,
            json: async () => ({
              access_token: 'a',
              refresh_token: 'r',
            }),
          } as Response
        },
      ) as unknown as typeof fetch

      await login('https://byos.example.com', 'me@test.com', 'secret')

      expect(capturedUrl).toBe('https://byos.example.com/login')
      expect(JSON.parse(capturedBody)).toEqual({
        login: 'me@test.com',
        password: 'secret',
      })
    })
  })
})
