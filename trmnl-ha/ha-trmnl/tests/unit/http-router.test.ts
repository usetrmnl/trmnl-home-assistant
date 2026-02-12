/**
 * Unit tests for HTTP Router
 *
 * Covers route matching, method validation, response codes, and content types
 * for all API endpoints: health, schedules CRUD, presets, palettes, BYOS login,
 * and static file serving.
 *
 * @module tests/unit/http-router
 */

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'

// ---------------------------------------------------------------------------
// Module mocks — replace scheduleStore and byos-auth before HttpRouter loads
// ---------------------------------------------------------------------------

const mockLoadSchedules = mock(async () => [{ id: 's1', name: 'Test' }])
const mockCreateSchedule = mock(async (_input: unknown) => ({
  id: 'new-1',
  name: 'Created',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}))
const mockUpdateSchedule = mock(
  async (_id: unknown, _updates: unknown) =>
    ({
      id: 'u1',
      name: 'Updated',
      updatedAt: new Date().toISOString(),
    }) as Record<string, unknown> | null,
)
const mockDeleteSchedule = mock(async (_id: unknown) => true)

mock.module('../../lib/scheduleStore.js', () => ({
  loadSchedules: mockLoadSchedules,
  saveSchedules: mock(async () => {}),
  getSchedule: mock(async () => null),
  createSchedule: mockCreateSchedule,
  updateSchedule: mockUpdateSchedule,
  deleteSchedule: mockDeleteSchedule,
}))

const mockByosLogin = mock(async () => ({
  access_token: 'test-access',
  refresh_token: 'test-refresh',
}))

mock.module('../../lib/scheduler/byos-auth.js', () => ({
  login: mockByosLogin,
  getBaseUrl: (url: string) => new URL(url).origin,
  getValidAccessToken: mock(async () => null),
}))

// ---------------------------------------------------------------------------
// Import module under test (uses mocked leaf deps + real data modules)
// ---------------------------------------------------------------------------

import { HttpRouter } from '../../lib/http-router.js'
import type { BrowserFacade } from '../../lib/browserFacade.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Clean up global mocks so other test files get real modules
afterAll(() => {
  mock.restore()
})

/** Mock HTTP request */
interface MockRequest {
  method: string
  on: (event: string, callback: (...args: unknown[]) => void) => void
}

/** Mock HTTP response with captured output */
interface MockResponse {
  statusCode: number | null
  headers: Record<string, string>
  body: string | Buffer
  setHeader: (key: string, value: string) => void
  writeHead: (code: number, headers?: Record<string, string>) => void
  end: (data?: string | Buffer) => void
}

describe('HttpRouter', () => {
  let router: HttpRouter
  let mockFacade: BrowserFacade
  let mockScheduler: { executeNow: (id: string) => Promise<unknown> }
  let mockRequest: MockRequest
  let mockResponse: MockResponse

  // Helper to create fake HTTP request (no body)
  const createRequest = (method: string = 'GET'): MockRequest => ({
    method,
    on: (event: string, callback: () => void) => {
      if (event === 'end') callback()
    },
  })

  // Helper to create fake HTTP request WITH body (for POST/PUT)
  const createRequestWithBody = (
    method: string,
    body: string,
  ): MockRequest => ({
    method,
    on: (event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'data') callback(Buffer.from(body))
      if (event === 'end') callback()
    },
  })

  // Helper to create fake HTTP response with spy methods
  const createResponse = (): MockResponse => {
    const response: MockResponse = {
      statusCode: null,
      headers: {},
      body: '',
      setHeader: (key: string, value: string) => {
        response.headers[key.toLowerCase()] = value
      },
      writeHead: (code: number, headers: Record<string, string> = {}) => {
        response.statusCode = code
        Object.entries(headers).forEach(([key, value]) => {
          response.headers[key.toLowerCase()] = value
        })
      },
      end: (data?: string | Buffer) => {
        if (data) response.body = data
      },
    }
    return response
  }

  beforeEach(() => {
    // Create mock facade (combines health + recovery)
    mockFacade = {
      checkHealth: () => ({ healthy: true }),
      getStats: () => ({
        lastSuccessfulRequest: new Date().toISOString(),
        timeSinceSuccess: 0,
        consecutiveFailures: 0,
        totalRecoveries: 0,
        recovering: false,
      }),
    } as unknown as BrowserFacade

    mockScheduler = {
      executeNow: async (id: string) => ({
        id,
        executed: true,
        timestamp: new Date().toISOString(),
      }),
    }

    // Create router instance
    router = new HttpRouter(mockFacade)

    // Create fake request/response
    mockRequest = createRequest()
    mockResponse = createResponse()

    // Reset mock implementations to defaults
    mockLoadSchedules.mockImplementation(async () => [
      { id: 's1', name: 'Test' },
    ])
    mockCreateSchedule.mockImplementation(async (_input: unknown) => ({
      id: 'new-1',
      name: 'Created',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }))
    mockUpdateSchedule.mockImplementation(
      async (_id: unknown, _updates: unknown) =>
        ({
          id: 'u1',
          name: 'Updated',
          updatedAt: new Date().toISOString(),
        }) as Record<string, unknown> | null,
    )
    mockDeleteSchedule.mockImplementation(async (_id: unknown) => true)
    mockByosLogin.mockImplementation(async () => ({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
    }))
  })

  // ==========================================================================
  // route() - Main routing logic (return values)
  // ==========================================================================

  describe('route', () => {
    it('returns true when route is recognized', async () => {
      const url = new URL('http://localhost/health')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(handled).toBe(true)
    })

    it('returns false for unrecognized routes', async () => {
      const url = new URL('http://localhost/screenshot')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(handled).toBe(false)
    })
  })

  // ==========================================================================
  // Health Check Endpoint - GET /health
  // ==========================================================================

  describe('GET /health', () => {
    it('returns 200 when browser is healthy', async () => {
      ;(mockFacade as { checkHealth: () => { healthy: boolean } }).checkHealth =
        () => ({
          healthy: true,
        })
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('returns 503 when browser is degraded', async () => {
      ;(mockFacade as { checkHealth: () => { healthy: boolean } }).checkHealth =
        () => ({
          healthy: false,
        })
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(503)
    })

    it('includes browser health metrics in response body', async () => {
      ;(mockFacade as { checkHealth: () => unknown }).checkHealth = () => ({
        healthy: true,
      })
      ;(mockFacade as { getStats: () => unknown }).getStats = () => ({
        lastSuccessfulRequest: '2024-01-01T00:00:00.000Z',
        timeSinceSuccess: 0,
        consecutiveFailures: 0,
        totalRecoveries: 5,
        recovering: false,
      })
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      const response = JSON.parse(mockResponse.body as string)

      expect(response).toMatchObject({
        status: 'ok',
        browser: {
          healthy: true,
          totalRecoveries: 5,
        },
      })
    })

    it('sets Content-Type header to application/json', async () => {
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(mockResponse.headers['content-type']).toBe('application/json')
    })

    it('includes uptime in response', async () => {
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      const response = JSON.parse(mockResponse.body as string)

      expect(response.uptime).toBeGreaterThan(0)
    })

    it('includes ISO timestamp in response', async () => {
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      const response = JSON.parse(mockResponse.body as string)

      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  // ==========================================================================
  // Favicon - GET /favicon.ico
  // ==========================================================================

  describe('GET /favicon.ico', () => {
    it('returns 404 for favicon requests', async () => {
      const url = new URL('http://localhost/favicon.ico')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(404)
    })

    it('handles route (returns true)', async () => {
      const url = new URL('http://localhost/favicon.ico')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(handled).toBe(true)
    })
  })

  // ==========================================================================
  // Manual Execution - POST /api/schedules/:id/send
  // ==========================================================================

  describe('POST /api/schedules/:id/send', () => {
    // Use local scheduler for this describe block to avoid parallel test interference
    let localScheduler: typeof mockScheduler

    beforeEach(() => {
      // Create fresh mock scheduler with default successful behavior
      // Must return { success: boolean; savedPath: string } to match interface
      localScheduler = {
        executeNow: async (_id: string) => ({
          success: true,
          savedPath: '/output/test.png',
        }),
      }
      // Set scheduler for these tests
      router.setScheduler(
        localScheduler as Parameters<typeof router.setScheduler>[0],
      )
      mockRequest = createRequest('POST')
    })

    it('triggers schedule execution via scheduler', async () => {
      let executedId: string | undefined
      localScheduler.executeNow = async (id: string) => {
        executedId = id
        return { id, executed: true }
      }

      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(executedId).toBe('123')
    })

    it('extracts schedule ID correctly from URL path', async () => {
      let executedId: string | undefined
      localScheduler.executeNow = async (id: string) => {
        executedId = id
        return { id, executed: true }
      }

      const url = new URL('http://localhost/api/schedules/abc-456-def/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(executedId).toBe('abc-456-def')
    })

    it('returns 200 on successful execution', async () => {
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('includes success flag in response', async () => {
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      const response = JSON.parse(mockResponse.body as string)

      expect(response.success).toBe(true)
    })

    it('returns 405 for non-POST methods', async () => {
      mockRequest = createRequest('GET')
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(405)
    })

    it('returns 503 when scheduler not initialized', async () => {
      // Create router without scheduler
      const routerNoScheduler = new HttpRouter(mockFacade)

      const url = new URL('http://localhost/api/schedules/123/send')

      await routerNoScheduler.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(503)
    })

    it('returns 404 when schedule not found', async () => {
      localScheduler.executeNow = async () => {
        throw new Error('Schedule not found')
      }

      const url = new URL('http://localhost/api/schedules/999/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(404)
    })

    it('returns 500 for other execution errors', async () => {
      localScheduler.executeNow = async () => {
        throw new Error('Browser crashed')
      }

      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(500)
    })
  })

  // ==========================================================================
  // setScheduler() - Two-phase initialization
  // ==========================================================================

  describe('setScheduler', () => {
    it('allows scheduler to be set after construction', () => {
      const newRouter = new HttpRouter(mockFacade)

      newRouter.setScheduler(
        mockScheduler as Parameters<typeof router.setScheduler>[0],
      )

      // Verify scheduler was set (implicit - no error thrown)
      expect(() => {
        newRouter.setScheduler(
          mockScheduler as Parameters<typeof router.setScheduler>[0],
        )
      }).not.toThrow()
    })

    it('enables /send endpoint after scheduler is set', async () => {
      const newRouter = new HttpRouter(mockFacade)

      // Before setting scheduler - should return 503
      mockRequest = createRequest('POST')
      const url = new URL('http://localhost/api/schedules/123/send')
      await newRouter.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )
      expect(mockResponse.statusCode).toBe(503)

      // After setting scheduler - should work
      newRouter.setScheduler(
        mockScheduler as Parameters<typeof router.setScheduler>[0],
      )
      mockResponse = createResponse()
      await newRouter.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )
      expect(mockResponse.statusCode).toBe(200)
    })
  })

  // ==========================================================================
  // Unrecognized Routes - Fallback behavior
  // ==========================================================================

  describe('Unrecognized Routes', () => {
    it('returns false for screenshot requests', async () => {
      const url = new URL('http://localhost/lovelace/0')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(handled).toBe(false)
    })

    it('returns false for unknown paths', async () => {
      const url = new URL('http://localhost/unknown/path')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url,
      )

      expect(handled).toBe(false)
    })
  })

  // ==========================================================================
  // Schedules List - GET /api/schedules
  // ==========================================================================

  describe('GET /api/schedules', () => {
    it('returns 200 with schedule list', async () => {
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('returns schedules as JSON array', async () => {
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      const body = JSON.parse(mockResponse.body as string)

      expect(Array.isArray(body)).toBe(true)
    })

    it('sets Content-Type to application/json', async () => {
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.headers['content-type']).toBe('application/json')
    })
  })

  // ==========================================================================
  // Create Schedule - POST /api/schedules
  // ==========================================================================

  describe('POST /api/schedules', () => {
    it('returns 201 on successful creation', async () => {
      mockRequest = createRequestWithBody(
        'POST',
        JSON.stringify({ name: 'New Schedule' }),
      )
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(201)
    })

    it('includes created schedule in response', async () => {
      mockRequest = createRequestWithBody(
        'POST',
        JSON.stringify({ name: 'New Schedule' }),
      )
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      const body = JSON.parse(mockResponse.body as string)

      expect(body.id).toBe('new-1')
    })

    it('returns 400 for malformed JSON', async () => {
      mockRequest = createRequestWithBody('POST', 'not valid json {{{')
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(400)
    })

    it('includes error message for malformed JSON', async () => {
      mockRequest = createRequestWithBody('POST', '{invalid')
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      const body = JSON.parse(mockResponse.body as string)

      expect(body.error).toBeDefined()
    })
  })

  // ==========================================================================
  // /api/schedules — Method validation
  // ==========================================================================

  describe('/api/schedules — method validation', () => {
    it('returns 405 for PUT method', async () => {
      mockRequest = createRequest('PUT')
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(405)
    })

    it('returns 405 for DELETE method', async () => {
      mockRequest = createRequest('DELETE')
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(405)
    })

    it('includes error message in 405 response', async () => {
      mockRequest = createRequest('PATCH')
      const url = new URL('http://localhost/api/schedules')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      const body = JSON.parse(mockResponse.body as string)

      expect(body.error).toContain('not allowed')
    })
  })

  // ==========================================================================
  // Update Schedule - PUT /api/schedules/:id
  // ==========================================================================

  describe('PUT /api/schedules/:id', () => {
    it('returns 200 on successful update', async () => {
      mockRequest = createRequestWithBody(
        'PUT',
        JSON.stringify({ name: 'Updated' }),
      )
      const url = new URL('http://localhost/api/schedules/u1')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('returns 404 when schedule not found', async () => {
      mockUpdateSchedule.mockImplementationOnce(async () => null)
      mockRequest = createRequestWithBody(
        'PUT',
        JSON.stringify({ name: 'Missing' }),
      )
      const url = new URL('http://localhost/api/schedules/nonexistent')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(404)
    })

    it('returns 400 for malformed JSON', async () => {
      mockRequest = createRequestWithBody('PUT', '{broken')
      const url = new URL('http://localhost/api/schedules/u1')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(400)
    })
  })

  // ==========================================================================
  // Delete Schedule - DELETE /api/schedules/:id
  // ==========================================================================

  describe('DELETE /api/schedules/:id', () => {
    it('returns 200 on successful deletion', async () => {
      mockRequest = createRequest('DELETE')
      const url = new URL('http://localhost/api/schedules/d1')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('includes success flag in response', async () => {
      mockRequest = createRequest('DELETE')
      const url = new URL('http://localhost/api/schedules/d1')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      const body = JSON.parse(mockResponse.body as string)

      expect(body.success).toBe(true)
    })

    it('returns 404 when schedule not found', async () => {
      mockDeleteSchedule.mockImplementationOnce(async () => false)
      mockRequest = createRequest('DELETE')
      const url = new URL('http://localhost/api/schedules/nonexistent')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(404)
    })
  })

  // ==========================================================================
  // /api/schedules/:id — Method validation
  // ==========================================================================

  describe('/api/schedules/:id — method validation', () => {
    it('returns 405 for GET method', async () => {
      mockRequest = createRequest('GET')
      const url = new URL('http://localhost/api/schedules/some-id')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(405)
    })

    it('returns 405 for POST method', async () => {
      mockRequest = createRequest('POST')
      const url = new URL('http://localhost/api/schedules/some-id')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(405)
    })
  })

  // ==========================================================================
  // Presets API - GET /api/presets
  // ==========================================================================

  describe('GET /api/presets', () => {
    it('returns 200', async () => {
      const url = new URL('http://localhost/api/presets')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('sets Content-Type to application/json', async () => {
      const url = new URL('http://localhost/api/presets')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.headers['content-type']).toBe('application/json')
    })

    it('returns parseable JSON', async () => {
      const url = new URL('http://localhost/api/presets')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(() => JSON.parse(mockResponse.body as string)).not.toThrow()
    })
  })

  // ==========================================================================
  // Palettes API - GET /api/palettes
  // ==========================================================================

  describe('GET /api/palettes', () => {
    it('returns 200', async () => {
      const url = new URL('http://localhost/api/palettes')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('sets Content-Type to application/json', async () => {
      const url = new URL('http://localhost/api/palettes')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.headers['content-type']).toBe('application/json')
    })

    it('returns palette options as JSON array', async () => {
      const url = new URL('http://localhost/api/palettes')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      const body = JSON.parse(mockResponse.body as string)

      expect(Array.isArray(body)).toBe(true)
    })

    it('includes grayscale options', async () => {
      const url = new URL('http://localhost/api/palettes')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      const body = JSON.parse(mockResponse.body as string) as {
        value: string
      }[]
      const values = body.map((p) => p.value)

      expect(values).toContain('bw')
    })
  })

  // ==========================================================================
  // BYOS Login - POST /api/byos/login
  // ==========================================================================

  describe('POST /api/byos/login', () => {
    it('returns 405 for GET method', async () => {
      const url = new URL('http://localhost/api/byos/login')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(405)
    })

    it('returns 400 when required fields are missing', async () => {
      mockRequest = createRequestWithBody(
        'POST',
        JSON.stringify({ webhookUrl: 'https://example.com/api' }),
      )
      const url = new URL('http://localhost/api/byos/login')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(400)
    })

    it('includes error message for missing fields', async () => {
      mockRequest = createRequestWithBody('POST', JSON.stringify({}))
      const url = new URL('http://localhost/api/byos/login')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      const body = JSON.parse(mockResponse.body as string)

      expect(body.error).toContain('Missing')
    })

    it('returns 200 with tokens on successful login', async () => {
      mockRequest = createRequestWithBody(
        'POST',
        JSON.stringify({
          webhookUrl: 'https://byos.example.com/api/screens',
          login: 'user@test.com',
          password: 'secret',
        }),
      )
      const url = new URL('http://localhost/api/byos/login')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('includes access and refresh tokens in success response', async () => {
      mockRequest = createRequestWithBody(
        'POST',
        JSON.stringify({
          webhookUrl: 'https://byos.example.com/api/screens',
          login: 'user@test.com',
          password: 'secret',
        }),
      )
      const url = new URL('http://localhost/api/byos/login')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      const body = JSON.parse(mockResponse.body as string)

      expect(body.access_token).toBe('test-access')
      expect(body.refresh_token).toBe('test-refresh')
    })

    it('returns 401 when login fails', async () => {
      mockByosLogin.mockImplementationOnce(async () => {
        throw new Error('BYOS login failed: 401')
      })
      mockRequest = createRequestWithBody(
        'POST',
        JSON.stringify({
          webhookUrl: 'https://byos.example.com/api/screens',
          login: 'bad@test.com',
          password: 'wrong',
        }),
      )
      const url = new URL('http://localhost/api/byos/login')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(401)
    })
  })

  // ==========================================================================
  // Static File Serving - /js/, /css/, /shared/
  // ==========================================================================

  describe('Static file serving', () => {
    it('handles /js/ routes (returns true)', async () => {
      const url = new URL('http://localhost/js/app.js')

      const handled = await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(handled).toBe(true)
    })

    it('handles /css/ routes (returns true)', async () => {
      const url = new URL('http://localhost/css/styles.css')

      const handled = await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(handled).toBe(true)
    })

    it('handles /shared/ routes (returns true)', async () => {
      const url = new URL('http://localhost/shared/something.png')

      const handled = await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(handled).toBe(true)
    })

    it('returns 404 for nonexistent static files', async () => {
      const url = new URL('http://localhost/css/nonexistent-file.css')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.statusCode).toBe(404)
    })

    it('transpiles TypeScript to JavaScript for /js/ routes', async () => {
      const url = new URL('http://localhost/js/app.js')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      // app.ts exists in html/js/ — should transpile and return 200
      expect(mockResponse.statusCode).toBe(200)
    })

    it('sets correct content-type for transpiled JS', async () => {
      const url = new URL('http://localhost/js/app.js')

      await router.route(
        mockRequest as unknown as IncomingMessage,
        mockResponse as unknown as ServerResponse,
        url,
      )

      expect(mockResponse.headers['content-type']).toBe(
        'application/javascript',
      )
    })
  })
})
