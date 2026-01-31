/**
 * Integration tests for webhook delivery
 *
 * Tests uploadToWebhook service with real HTTP server.
 * Uses spy pattern to verify requests after they happen.
 *
 * @module tests/integration/webhook.test
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'bun:test'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  waitFor,
  type TestEnvironment,
} from '../helpers/mock-helper.js'
import { WebhookTestServer } from '../helpers/webhook-server.js'
import {
  createPNGBuffer,
  createJPEGBuffer,
  createBMPBuffer,
  validateImageMagic,
} from '../helpers/image-helper.js'
import {
  createTestSchedule,
  createWebhookSchedule,
  cleanupScheduleFile,
} from '../helpers/schedule-helper.js'
import {
  uploadToWebhook as webhookDelivery,
  type WebhookDeliveryOptions,
} from '../../lib/scheduler/services.js'
import { ScheduleExecutor } from '../../lib/scheduler/schedule-executor.js'
import type {
  Schedule,
  ScreenshotParams,
  ImageFormat,
} from '../../types/domain.js'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testScheduleFile = path.join(__dirname, '../test-webhook-schedules.json')
const testOutputDir = path.join(__dirname, '../../output')

/** Mock screenshot record for verification */
interface MockScreenshot {
  params: ScreenshotParams
  buffer: Buffer
  timestamp: Date
}

/**
 * NOTE: Test schedules from helpers use a simplified shape.
 * We cast to Schedule since webhook commands only use specific fields.
 */
const asSchedule = (
  testSchedule: ReturnType<typeof createTestSchedule>,
): Schedule => testSchedule as unknown as Schedule

describe('Webhook Integration', () => {
  let testEnv: TestEnvironment
  let webhookServer: WebhookTestServer
  let executor: ScheduleExecutor
  let mockScreenshots: MockScreenshot[] = []

  // Mock screenshot function that returns fake image buffers
  const mockScreenshotFn = async (
    params: ScreenshotParams,
  ): Promise<Buffer> => {
    const format: ImageFormat = params.format || 'png'
    let buffer: Buffer

    if (format === 'jpeg') {
      buffer = createJPEGBuffer()
    } else if (format === 'bmp') {
      buffer = createBMPBuffer()
    } else {
      buffer = createPNGBuffer()
    }

    mockScreenshots.push({ params, buffer, timestamp: new Date() })
    return buffer
  }

  // Helper to upload to webhook (matches ScheduleExecutor error handling)
  const uploadToWebhook = async (
    schedule: Schedule,
    imageBuffer: Buffer,
    format: ImageFormat,
  ): Promise<void> => {
    try {
      await webhookDelivery({
        webhookUrl: schedule.webhook_url!,
        webhookHeaders: schedule.webhook_headers,
        imageBuffer,
        format,
      })
    } catch (err) {
      console.error(
        '[Scheduler] Webhook upload failed:',
        (err as Error).message,
      )
      // Don't throw - errors are logged only
    }
  }

  beforeAll(async () => {
    testEnv = await setupTestEnvironment()

    // Start webhook test server
    webhookServer = new WebhookTestServer(10002)
    await webhookServer.start()
  }, 30000)

  afterAll(async () => {
    if (webhookServer) {
      await webhookServer.stop()
    }
    cleanupScheduleFile(testScheduleFile)
    await teardownTestEnvironment(testEnv)
  })

  beforeEach(() => {
    mockScreenshots = []
    webhookServer.clearRequests()
    webhookServer.reset()
    cleanupScheduleFile(testScheduleFile)

    // Ensure output directory exists (may not exist in CI)
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true })
    }

    // Create executor with mock screenshot function
    executor = new ScheduleExecutor(mockScreenshotFn, testOutputDir)
  })

  afterEach(async () => {
    // Cleanup output directory
    if (fs.existsSync(testOutputDir)) {
      const files = fs.readdirSync(testOutputDir)
      files.forEach((file) => {
        if (/\.(png|jpeg|jpg|bmp)$/i.exec(file)) {
          fs.unlinkSync(path.join(testOutputDir, file))
        }
      })
    }
  })

  // ==========================================================================
  // uploadToWebhook - Basic HTTP delivery
  // ==========================================================================

  describe('uploadToWebhook', () => {
    it('sends POST request to webhook URL', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/test'),
      )
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')

      const requests = webhookServer.getRequests()

      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        url: '/test',
        method: 'POST',
      })
    })

    it('sets Content-Type header based on image format', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/png'),
      )
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')

      const requests = webhookServer.getRequests()

      expect(requests[0]!.headers).toMatchObject({
        'content-type': 'image/png',
      })
    })

    it('sends complete image buffer without corruption', async () => {
      const pngBuffer = createPNGBuffer()
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/integrity'),
      )

      await uploadToWebhook(schedule, pngBuffer, 'png')

      const requests = webhookServer.getRequests()
      const receivedBuffer = requests[0]!.body

      expect(receivedBuffer).toEqual(pngBuffer)
      expect(validateImageMagic(receivedBuffer, 'png')).toBe(true)
    })
  })

  // ==========================================================================
  // Format-specific Content-Type headers
  // ==========================================================================

  describe('Content-Type Headers', () => {
    it('sends image/png for PNG format', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/png'),
      )
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')

      const requests = webhookServer.getRequests()
      expect(requests[0]!.headers['content-type']).toBe('image/png')
    })

    it('sends image/jpeg for JPEG format', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/jpeg'),
      )
      await uploadToWebhook(schedule, createJPEGBuffer(), 'jpeg')

      const requests = webhookServer.getRequests()
      expect(requests[0]!.headers['content-type']).toBe('image/jpeg')
    })

    it('sends image/bmp for BMP format', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/bmp'),
      )
      await uploadToWebhook(schedule, createBMPBuffer(), 'bmp')

      const requests = webhookServer.getRequests()
      expect(requests[0]!.headers['content-type']).toBe('image/bmp')
    })

    it('does not allow webhook_headers to override Content-Type', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/no-override', {
          'Content-Type': 'application/octet-stream', // Try to override
        }),
      )
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')

      const requests = webhookServer.getRequests()
      // Content-Type should be image/png, not the override
      expect(requests[0]!.headers['content-type']).toBe('image/png')
    })
  })

  // ==========================================================================
  // Custom Headers & Authentication
  // ==========================================================================

  describe('Custom Headers', () => {
    it('includes custom webhook headers in request', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/headers', {
          'X-Custom-Header': 'test-value',
          'X-API-Key': 'secret123',
        }),
      )
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')

      const requests = webhookServer.getRequests()

      expect(requests[0]!.headers).toMatchObject({
        'x-custom-header': 'test-value',
        'x-api-key': 'secret123',
      })
    })

    it('sends Authorization header with Bearer token', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/bearer', {
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        }),
      )
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')

      const requests = webhookServer.getRequests()
      expect(requests[0]!.headers.authorization).toContain('Bearer')
    })

    it('sends multiple custom headers together', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/multi', {
          'X-Custom-1': 'value1',
          'X-Custom-2': 'value2',
          'X-Custom-3': 'value3',
        }),
      )
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')

      const requests = webhookServer.getRequests()

      expect(requests[0]!.headers).toMatchObject({
        'x-custom-1': 'value1',
        'x-custom-2': 'value2',
        'x-custom-3': 'value3',
      })
    })

    it('sends webhook headers alongside Content-Type', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/auth', {
          Authorization: 'Bearer token123',
        }),
      )
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')

      const requests = webhookServer.getRequests()

      expect(requests[0]!.headers).toMatchObject({
        authorization: 'Bearer token123',
        'content-type': 'image/png',
      })
    })
  })

  // ==========================================================================
  // HTTP Response Handling
  // ==========================================================================

  describe('Response Handling', () => {
    it('handles 200 OK responses successfully', async () => {
      webhookServer.setResponseStatus(200)
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/ok'),
      )

      // Test passes if no error is thrown
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })

    it('handles 201 Created responses successfully', async () => {
      webhookServer.setResponseStatus(201)
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/created'),
      )

      // Test passes if no error is thrown
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })

    it('handles 204 No Content responses with empty body', async () => {
      webhookServer.setResponseStatus(204)
      webhookServer.setResponseBody('')
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/no-content'),
      )

      // Test passes if no error is thrown
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })

    it('handles large response bodies without errors', async () => {
      webhookServer.setResponseStatus(200)
      webhookServer.setResponseBody('A'.repeat(500)) // 500 chars
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/large-body'),
      )

      // Test passes if no error is thrown
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })
  })

  // ==========================================================================
  // Error Handling - Should never throw, always log
  // ==========================================================================

  describe('Error Handling', () => {
    it('logs but does not throw on 400 client errors', async () => {
      webhookServer.setResponseStatus(400)
      webhookServer.setResponseBody('Bad Request')
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/bad-request'),
      )

      // Test passes if no error is thrown (errors are logged only)
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })

    it('logs but does not throw on 404 not found', async () => {
      webhookServer.setResponseStatus(404)
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/not-found'),
      )

      // Test passes if no error is thrown (errors are logged only)
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })

    it('logs but does not throw on 500 server errors', async () => {
      webhookServer.setResponseStatus(500)
      webhookServer.setResponseBody('Internal Server Error')
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:10002/error'),
      )

      // Test passes if no error is thrown (errors are logged only)
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })

    it('logs but does not throw on connection refused', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://localhost:19999/refused'),
      )

      // Test passes if no error is thrown (errors are logged only)
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })

    it('logs but does not throw on DNS resolution failures', async () => {
      const schedule = asSchedule(
        createWebhookSchedule('http://nonexistent.invalid.domain/test'),
      )

      // Test passes if no error is thrown (errors are logged only)
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })

    it('logs but does not throw on invalid URL schemes', async () => {
      const schedule = asSchedule(createWebhookSchedule('not-a-valid-url'))

      // Test passes if no error is thrown (errors are logged only)
      await uploadToWebhook(schedule, createPNGBuffer(), 'png')
    })
  })

  // ==========================================================================
  // Integration with ScheduleExecutor
  // ==========================================================================

  describe('Schedule Execution Integration', () => {
    it('triggers webhook after successful screenshot', async () => {
      const schedule = asSchedule(
        createTestSchedule({
          name: 'Webhook Test',
          cron: '*/10 * * * * *',
          webhook_url: 'http://localhost:10002/screenshot',
          enabled: false,
        }),
      )

      await executor.call(schedule)
      await waitFor(() => webhookServer.getRequests().length > 0, 2000)

      const requests = webhookServer.getRequests()

      expect(requests).toHaveLength(1)
      expect(requests[0]!.body.length).toBeGreaterThan(0)
      expect(validateImageMagic(requests[0]!.body, 'png')).toBe(true)
    })

    it('skips webhook when webhook_url is null', async () => {
      const schedule = asSchedule(
        createTestSchedule({
          name: 'No Webhook',
          cron: '*/10 * * * * *',
          webhook_url: null,
          enabled: false,
        }),
      )

      await executor.call(schedule)
      await new Promise((resolve) => setTimeout(resolve, 500))

      expect(webhookServer.getRequests()).toHaveLength(0)
    })

    it('skips webhook when webhook_url is empty string', async () => {
      const schedule = asSchedule(
        createTestSchedule({
          name: 'Empty Webhook',
          cron: '*/10 * * * * *',
          webhook_url: '',
          enabled: false,
        }),
      )

      await executor.call(schedule)
      await new Promise((resolve) => setTimeout(resolve, 500))

      expect(webhookServer.getRequests()).toHaveLength(0)
    })

    it('sends PNG format through webhook', async () => {
      webhookServer.clearRequests()
      const schedule = asSchedule(
        createTestSchedule({
          name: 'Test PNG',
          format: 'png',
          webhook_url: 'http://localhost:10002/format-test',
          enabled: false,
        }),
      )

      await executor.call(schedule)
      await waitFor(() => webhookServer.getRequests().length > 0, 2000)

      const requests = webhookServer.getRequests()

      expect(requests).toHaveLength(1)
      expect(validateImageMagic(requests[0]!.body, 'png')).toBe(true)
    })

    it('sends JPEG format through webhook', async () => {
      webhookServer.clearRequests()
      const schedule = asSchedule(
        createTestSchedule({
          name: 'Test JPEG',
          format: 'jpeg',
          webhook_url: 'http://localhost:10002/format-test',
          enabled: false,
        }),
      )

      await executor.call(schedule)
      await waitFor(() => webhookServer.getRequests().length > 0, 2000)

      const requests = webhookServer.getRequests()

      expect(requests).toHaveLength(1)
      expect(validateImageMagic(requests[0]!.body, 'jpeg')).toBe(true)
    })

    it('sends BMP format through webhook', async () => {
      webhookServer.clearRequests()
      const schedule = asSchedule(
        createTestSchedule({
          name: 'Test BMP',
          format: 'bmp',
          webhook_url: 'http://localhost:10002/format-test',
          enabled: false,
        }),
      )

      await executor.call(schedule)
      await waitFor(() => webhookServer.getRequests().length > 0, 2000)

      const requests = webhookServer.getRequests()

      expect(requests).toHaveLength(1)
      expect(validateImageMagic(requests[0]!.body, 'bmp')).toBe(true)
    })

    it('sends dithered images through webhook', async () => {
      const schedule = asSchedule(
        createTestSchedule({
          name: 'Dithered Test',
          webhook_url: 'http://localhost:10002/dithered',
          enabled: false,
          dithering: {
            enabled: true,
            method: 'floyd-steinberg',
            palette: 'gray-4',
          },
        }),
      )

      await executor.call(schedule)
      await waitFor(() => webhookServer.getRequests().length > 0, 2000)

      const requests = webhookServer.getRequests()

      expect(requests).toHaveLength(1)
      expect(requests[0]!.body.length).toBeGreaterThan(0)
      expect(validateImageMagic(requests[0]!.body, 'png')).toBe(true)
    })
  })

  // ==========================================================================
  // BYOS 422 Error Handling - Delete existing screen and retry
  // ==========================================================================

  describe('BYOS 422 Error Handling', () => {
    /**
     * Helper to call webhookDelivery directly with BYOS format config.
     * This bypasses the schedule-based wrapper to test the raw 422 handling.
     */
    const uploadByosWebhook = async (
      options: WebhookDeliveryOptions,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        await webhookDelivery(options)
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }

    it('retries after 422 by deleting existing screen', async () => {
      let postCount = 0

      // Mock BYOS screens endpoint - return 422 on first POST, 201 on retry
      webhookServer.setRouteHandler('POST /api/screens', () => {
        postCount++
        if (postCount === 1) {
          return {
            status: 422,
            body: JSON.stringify({ error: 'Screen already exists' }),
          }
        }
        return { status: 201, body: JSON.stringify({ id: 99, model_id: 1 }) }
      })

      // Mock GET /api/screens - return list with matching screen
      webhookServer.setRouteHandler('GET /api/screens', () => {
        return {
          status: 200,
          body: JSON.stringify({
            data: [{ id: 42, model_id: 1, label: 'Test', name: 'test-screen' }],
          }),
        }
      })

      // Mock DELETE /api/screens/:id
      webhookServer.setRouteHandler('DELETE /api/screens/*', () => {
        return { status: 200, body: JSON.stringify({ success: true }) }
      })

      const result = await uploadByosWebhook({
        webhookUrl: 'http://localhost:10002/api/screens',
        imageBuffer: createPNGBuffer(),
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
              access_token: 'Bearer test-token',
              refresh_token: 'refresh-token', // Required for getValidAccessToken
              obtained_at: Date.now(), // Token is fresh, no refresh needed
            },
          },
        },
      })

      expect(result.success).toBe(true)
      expect(postCount).toBe(2) // Initial POST + retry POST

      // Verify request sequence: POST (422) → GET → DELETE → POST (201)
      const requests = webhookServer.getRequests()
      expect(requests.length).toBeGreaterThanOrEqual(4)
      expect(requests[0]!.method).toBe('POST')
      expect(requests[1]!.method).toBe('GET')
      expect(requests[2]!.method).toBe('DELETE')
      expect(requests[3]!.method).toBe('POST')
    })

    it('fails gracefully when screen not found for deletion', async () => {
      let postCount = 0

      // Return 422 on all POSTs
      webhookServer.setRouteHandler('POST /api/screens', () => {
        postCount++
        return {
          status: 422,
          body: JSON.stringify({ error: 'Screen already exists' }),
        }
      })

      // Return empty screen list (no matching screen to delete)
      webhookServer.setRouteHandler('GET /api/screens', () => {
        return { status: 200, body: JSON.stringify({ data: [] }) }
      })

      const result = await uploadByosWebhook({
        webhookUrl: 'http://localhost:10002/api/screens',
        imageBuffer: createPNGBuffer(),
        format: 'png',
        webhookFormat: {
          format: 'byos-hanami',
          byosConfig: {
            label: 'Test',
            name: 'test-screen',
            model_id: '999', // No matching screen
            preprocessed: true,
            auth: {
              enabled: true,
              access_token: 'Bearer test-token',
              refresh_token: 'refresh-token',
              obtained_at: Date.now(),
            },
          },
        },
      })

      // Should fail because no screen was found to delete
      expect(result.success).toBe(false)
      expect(result.error).toContain('422')
      expect(postCount).toBe(1) // Only initial POST, no retry
    })

    it('fails gracefully when DELETE fails', async () => {
      let postCount = 0

      webhookServer.setRouteHandler('POST /api/screens', () => {
        postCount++
        return {
          status: 422,
          body: JSON.stringify({ error: 'Screen already exists' }),
        }
      })

      webhookServer.setRouteHandler('GET /api/screens', () => {
        return {
          status: 200,
          body: JSON.stringify({
            data: [{ id: 42, model_id: 1, label: 'Test', name: 'test-screen' }],
          }),
        }
      })

      // DELETE fails
      webhookServer.setRouteHandler('DELETE /api/screens/*', () => {
        return { status: 500, body: JSON.stringify({ error: 'Server error' }) }
      })

      const result = await uploadByosWebhook({
        webhookUrl: 'http://localhost:10002/api/screens',
        imageBuffer: createPNGBuffer(),
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
              access_token: 'Bearer test-token',
              refresh_token: 'refresh-token',
              obtained_at: Date.now(),
            },
          },
        },
      })

      expect(result.success).toBe(false)
      expect(postCount).toBe(1) // Only initial POST, no retry after failed delete
    })

    it('skips 422 handling for non-BYOS format', async () => {
      webhookServer.setResponseStatus(422)
      webhookServer.setResponseBody('Unprocessable Entity')

      const result = await uploadByosWebhook({
        webhookUrl: 'http://localhost:10002/api/raw',
        imageBuffer: createPNGBuffer(),
        format: 'png',
        // No webhookFormat = raw format, no 422 retry logic
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('422')

      // Only one request - no retry for raw format
      const requests = webhookServer.getRequests()
      expect(requests).toHaveLength(1)
    })

    it('skips 422 handling when no auth token present', async () => {
      webhookServer.setRouteHandler('POST /api/screens', () => {
        return {
          status: 422,
          body: JSON.stringify({ error: 'Screen already exists' }),
        }
      })

      const result = await uploadByosWebhook({
        webhookUrl: 'http://localhost:10002/api/screens',
        imageBuffer: createPNGBuffer(),
        format: 'png',
        webhookFormat: {
          format: 'byos-hanami',
          byosConfig: {
            label: 'Test',
            name: 'test-screen',
            model_id: '1',
            preprocessed: true,
            // No auth config - should skip 422 retry
          },
        },
      })

      expect(result.success).toBe(false)

      // Only one request - no retry without auth
      const requests = webhookServer.getRequests()
      expect(requests).toHaveLength(1)
    })

    it('finds correct screen by model_id among multiple screens', async () => {
      let deletedId = ''
      let postCount = 0

      webhookServer.setRouteHandler('POST /api/screens', () => {
        postCount++
        if (postCount === 1) {
          return {
            status: 422,
            body: JSON.stringify({ error: 'Screen already exists' }),
          }
        }
        return { status: 201, body: JSON.stringify({ id: 99, model_id: 2 }) }
      })

      // Multiple screens, only one matches model_id=2
      webhookServer.setRouteHandler('GET /api/screens', () => {
        return {
          status: 200,
          body: JSON.stringify({
            data: [
              { id: 10, model_id: 1, label: 'Other', name: 'other-screen' },
              { id: 20, model_id: 2, label: 'Target', name: 'target-screen' },
              { id: 30, model_id: 3, label: 'Another', name: 'another-screen' },
            ],
          }),
        }
      })

      webhookServer.setRouteHandler('DELETE /api/screens/*', (req) => {
        deletedId = req.url!.split('/').pop()!
        return { status: 200, body: JSON.stringify({ success: true }) }
      })

      const result = await uploadByosWebhook({
        webhookUrl: 'http://localhost:10002/api/screens',
        imageBuffer: createPNGBuffer(),
        format: 'png',
        webhookFormat: {
          format: 'byos-hanami',
          byosConfig: {
            label: 'Target',
            name: 'target-screen',
            model_id: '2', // Should match screen with id=20
            preprocessed: true,
            auth: {
              enabled: true,
              access_token: 'Bearer test-token',
              refresh_token: 'refresh-token',
              obtained_at: Date.now(),
            },
          },
        },
      })

      expect(result.success).toBe(true)
      expect(deletedId).toBe('20') // Correct screen was deleted
    })
  })
})
