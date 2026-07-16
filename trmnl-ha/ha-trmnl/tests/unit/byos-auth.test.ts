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
  buildRefreshedAuthUpdate,
  getBaseUrl,
  getValidAccessToken,
  isRefreshable,
  login,
} from '../../lib/scheduler/byos-auth.js'
import { captureFetch, mockFetch, restoreFetch } from '../helpers/fetch-mock.js'
import type { ByosAuthConfig, Schedule } from '../../types/domain.js'

afterAll(restoreFetch)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('byos-auth', () => {
  beforeEach(restoreFetch)

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

  describe('#buildRefreshedAuthUpdate', () => {
    const newTokens = {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    }

    function buildByosSchedule(): Schedule {
      return {
        id: 'schedule-1',
        webhook_format: {
          format: 'byos-hanami',
          byosConfig: {
            label: 'Home Assistant',
            name: 'ha-dashboard',
            model_id: '1',
            preprocessed: true,
            delivery_mode: 'uri',
            addon_base_url: 'http://ha.local:10000',
            auth: {
              enabled: true,
              access_token: 'old-access',
              refresh_token: 'old-refresh',
              obtained_at: 1,
            },
          },
        },
      } as Schedule
    }

    it('returns null when schedule has no auth config', () => {
      const schedule = { id: 'schedule-1' } as Schedule

      expect(buildRefreshedAuthUpdate(schedule, newTokens)).toBeNull()
    })

    it('swaps in the new token pair', () => {
      const update = buildRefreshedAuthUpdate(buildByosSchedule(), newTokens)

      expect(update?.webhook_format?.byosConfig?.auth).toMatchObject({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
      })
    })

    it('stamps a fresh obtained_at', () => {
      const before = Date.now()

      const update = buildRefreshedAuthUpdate(buildByosSchedule(), newTokens)

      expect(
        update?.webhook_format?.byosConfig?.auth?.obtained_at,
      ).toBeGreaterThanOrEqual(before)
    })

    it('preserves delivery configuration', () => {
      const update = buildRefreshedAuthUpdate(buildByosSchedule(), newTokens)

      expect(update?.webhook_format?.byosConfig).toMatchObject({
        delivery_mode: 'uri',
        addon_base_url: 'http://ha.local:10000',
      })
    })

    it('preserves auth enablement', () => {
      const update = buildRefreshedAuthUpdate(buildByosSchedule(), newTokens)

      expect(update?.webhook_format?.byosConfig?.auth?.enabled).toBe(true)
    })
  })

  describe('#isRefreshable', () => {
    it('returns true while the access token is within its 30 min lifetime', () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'token',
        refresh_token: 'refresh',
        obtained_at: Date.now() - 26 * 60 * 1000,
      }

      expect(isRefreshable(auth)).toBe(true)
    })

    it('returns false once the access token has expired server-side', () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'token',
        refresh_token: 'refresh',
        obtained_at: Date.now() - 31 * 60 * 1000,
      }

      expect(isRefreshable(auth)).toBe(false)
    })

    it('returns false when tokens are missing', () => {
      const auth: ByosAuthConfig = { enabled: true, obtained_at: Date.now() }

      expect(isRefreshable(auth)).toBe(false)
    })

    it('returns false when obtained_at is missing', () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'token',
        refresh_token: 'refresh',
      }

      expect(isRefreshable(auth)).toBe(false)
    })
  })

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

    it('posts the refresh request to /api/jwt with the stored credentials', async () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'old-token',
        refresh_token: 'my-refresh',
        obtained_at: Date.now() - 30 * 60 * 1000, // Expired — forces refresh
      }
      const requests = captureFetch()

      await getValidAccessToken('https://host.com/api', auth)

      expect(requests[0]!.url).toBe('https://host.com/api/jwt')
      expect(requests[0]!.init).toMatchObject({
        method: 'POST',
        headers: { Authorization: 'old-token' },
      })
      expect(JSON.parse(requests[0]!.init?.body as string)).toEqual({
        refresh_token: 'my-refresh',
      })
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

    it('updates in-memory auth object on successful refresh', async () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'old-token',
        refresh_token: 'old-refresh',
        obtained_at: Date.now() - 30 * 60 * 1000,
      }

      mockFetch({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
        }),
      })

      await getValidAccessToken('https://host.com/api', auth)

      expect(auth.access_token).toBe('new-access')
      expect(auth.refresh_token).toBe('new-refresh')
      expect(auth.obtained_at).toBeGreaterThan(Date.now() - 5000)
    })

    it('falls back to the stored access token when refresh fails', async () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'old',
        refresh_token: 'refresh',
        obtained_at: Date.now() - 30 * 60 * 1000,
      }

      mockFetch({ ok: false, status: 400 })

      const result = await getValidAccessToken('https://host.com/api', auth)

      expect(result).toBe('old')
    })

    it('does not persist tokens when refresh fails', async () => {
      const auth: ByosAuthConfig = {
        enabled: true,
        access_token: 'old',
        refresh_token: 'refresh',
        obtained_at: Date.now() - 30 * 60 * 1000,
      }
      const onTokenRefresh = mock(() => {})

      mockFetch({ ok: false, status: 400 })

      await getValidAccessToken('https://host.com/api', auth, onTokenRefresh)

      expect(onTokenRefresh).not.toHaveBeenCalled()
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
