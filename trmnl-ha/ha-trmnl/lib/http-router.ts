/**
 * HTTP Router Module
 *
 * Maps incoming HTTP requests to appropriate handlers for:
 * - UI endpoints (root page at /)
 * - API endpoints (schedules, devices, presets CRUD)
 * - Health checks (/health)
 * - Static file serving (JS, CSS, images)
 *
 * @module lib/http-router
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { handleUIRequest } from '../ui.js'
import {
  loadSchedules as defaultLoadSchedules,
  createSchedule as defaultCreateSchedule,
  updateSchedule as defaultUpdateSchedule,
  deleteSchedule as defaultDeleteSchedule,
} from './scheduleStore.js'
import {
  login as defaultByosLogin,
  getBaseUrl as defaultGetBaseUrl,
} from './scheduler/byos-auth.js'
import { loadPresets } from '../devices.js'
import { PALETTE_OPTIONS } from '../const.js'
import type { BrowserFacade } from './browserFacade.js'
import type {
  ScheduleInput,
  ScheduleUpdate,
  WebhookResult,
} from '../types/domain.js'
import type { Schedule } from '../types/domain.js'
import type { TokenResponse } from './scheduler/byos-auth.js'
import { toJson } from './json.js'
import { httpLogger } from './logger.js'

const log = httpLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const HTML_DIR = join(__dirname, '..', 'html')

/** MIME types for static file serving */
const MIME_TYPES: Record<string, string> = {
  js: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
}

/** Scheduler interface for manual execution */
interface Scheduler {
  executeNow(
    scheduleId: string,
  ): Promise<{ success: boolean; savedPath: string; webhook?: WebhookResult }>
}

/** Injectable dependencies for testability without global mock.module() */
export interface HttpRouterDeps {
  loadSchedules: () => Promise<Schedule[]>
  createSchedule: (input: ScheduleInput) => Promise<Schedule>
  updateSchedule: (
    id: string,
    updates: ScheduleUpdate,
  ) => Promise<Schedule | null>
  deleteSchedule: (id: string) => Promise<boolean>
  byosLogin: (
    baseUrl: string,
    login: string,
    password: string,
  ) => Promise<TokenResponse>
  getBaseUrl: (webhookUrl: string) => string
}

const defaultDeps: HttpRouterDeps = {
  loadSchedules: defaultLoadSchedules,
  createSchedule: defaultCreateSchedule,
  updateSchedule: defaultUpdateSchedule,
  deleteSchedule: defaultDeleteSchedule,
  byosLogin: defaultByosLogin,
  getBaseUrl: defaultGetBaseUrl,
}

/**
 * HTTP router dispatching requests to handlers based on URL paths and methods.
 */
export class HttpRouter {
  #facade: BrowserFacade
  #scheduler: Scheduler | null
  #deps: HttpRouterDeps

  constructor(
    facade: BrowserFacade,
    scheduler: Scheduler | null = null,
    deps: Partial<HttpRouterDeps> = {},
  ) {
    this.#facade = facade
    this.#scheduler = scheduler
    this.#deps = { ...defaultDeps, ...deps }
  }

  /** Reads HTTP request body as string */
  async #readRequestBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => resolve(body))
      request.on('error', reject)
    })
  }

  /**
   * Sets the scheduler instance (called after construction)
   */
  setScheduler(scheduler: Scheduler): void {
    this.#scheduler = scheduler
  }

  /**
   * Routes incoming HTTP request to appropriate handler.
   * @returns True if route was handled, false if caller should handle
   */
  async route(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<boolean> {
    const { pathname } = requestUrl

    // Skip logging for health checks (too noisy)
    if (pathname === '/health') {
      return this.#handleHealth(response)
    }

    // Log all other requests
    log.debug`${request.method} ${pathname}`

    if (pathname === '/favicon.ico') {
      response.statusCode = 404
      response.end()
      return true
    }

    // Serve UI at root UNLESS there's a 'url' param (generic screenshot mode)
    if (pathname === '/' && !requestUrl.searchParams.has('url')) {
      await handleUIRequest(response, requestUrl)
      return true
    }

    if (pathname === '/api/schedules') {
      return this.#handleSchedulesAPI(request, response)
    }

    if (pathname.startsWith('/api/schedules/')) {
      if (pathname.endsWith('/send')) {
        return this.#handleScheduleSendAPI(request, response, requestUrl)
      }
      return this.#handleScheduleAPI(request, response, requestUrl)
    }

    if (pathname === '/api/presets') {
      return this.#handlePresetsAPI(response)
    }

    if (pathname === '/api/palettes') {
      return this.#handlePalettesAPI(response)
    }

    if (pathname === '/api/byos/login') {
      return this.#handleByosLoginAPI(request, response)
    }

    if (
      pathname.startsWith('/js/') ||
      pathname.startsWith('/css/') ||
      pathname.startsWith('/shared/')
    ) {
      return this.#handleStaticFile(response, pathname)
    }

    return false
  }

  #handleHealth(response: ServerResponse): boolean {
    const health = this.#facade.checkHealth()
    const stats = this.#facade.getStats()

    const status = health.healthy ? 'ok' : 'degraded'
    const httpStatus = health.healthy ? 200 : 503

    response.writeHead(httpStatus, { 'Content-Type': 'application/json' })
    response.end(
      toJson({
        status,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        browser: { ...health, ...stats },
      }),
    )

    return true
  }

  async #handleSchedulesAPI(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    response.setHeader('Content-Type', 'application/json')

    if (request.method === 'GET') {
      const schedules = await this.#deps.loadSchedules()
      response.writeHead(200)
      response.end(toJson(schedules))
      return true
    }

    if (request.method === 'POST') {
      try {
        const body = await this.#readRequestBody(request)
        const schedule = JSON.parse(body) as ScheduleInput
        const created = await this.#deps.createSchedule(schedule)
        response.writeHead(201)
        response.end(toJson(created))
      } catch (err) {
        response.writeHead(400)
        response.end(toJson({ error: (err as Error).message }))
      }
      return true
    }

    response.writeHead(405)
    response.end(toJson({ error: 'Method not allowed' }))
    return true
  }

  async #handleScheduleAPI(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<boolean> {
    response.setHeader('Content-Type', 'application/json')

    const id = requestUrl.pathname.split('/').pop()!

    if (request.method === 'PUT') {
      try {
        const body = await this.#readRequestBody(request)
        const updates = JSON.parse(body) as ScheduleUpdate
        const updated = await this.#deps.updateSchedule(id, updates)

        if (!updated) {
          response.writeHead(404)
          response.end(toJson({ error: 'Schedule not found' }))
          return true
        }

        response.writeHead(200)
        response.end(toJson(updated))
      } catch (err) {
        response.writeHead(400)
        response.end(toJson({ error: (err as Error).message }))
      }
      return true
    }

    if (request.method === 'DELETE') {
      const deleted = await this.#deps.deleteSchedule(id)

      if (!deleted) {
        response.writeHead(404)
        response.end(toJson({ error: 'Schedule not found' }))
        return true
      }

      response.writeHead(200)
      response.end(toJson({ success: true }))
      return true
    }

    response.writeHead(405)
    response.end(toJson({ error: 'Method not allowed' }))
    return true
  }

  async #handleScheduleSendAPI(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<boolean> {
    response.setHeader('Content-Type', 'application/json')

    if (request.method !== 'POST') {
      response.writeHead(405)
      response.end(toJson({ error: 'Method not allowed' }))
      return true
    }

    if (!this.#scheduler) {
      response.writeHead(503)
      response.end(toJson({ error: 'Scheduler not available' }))
      return true
    }

    const pathParts = requestUrl.pathname.split('/')
    const id = pathParts[pathParts.length - 2]!

    try {
      const result = await this.#scheduler.executeNow(id)
      response.writeHead(200)
      response.end(toJson(result))
    } catch (err) {
      log.error`Manual schedule execution failed: ${err}`
      response.writeHead(
        (err as Error).message.includes('not found') ? 404 : 500,
      )
      response.end(toJson({ error: (err as Error).message }))
    }

    return true
  }

  #handlePresetsAPI(response: ServerResponse): boolean {
    const presets = loadPresets()
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(toJson(presets))
    return true
  }

  #handlePalettesAPI(response: ServerResponse): boolean {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(toJson(PALETTE_OPTIONS))
    return true
  }

  /**
   * Handles BYOS JWT login - authenticates and returns tokens.
   * Credentials are NOT stored - only used for this request.
   */
  async #handleByosLoginAPI(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    response.setHeader('Content-Type', 'application/json')

    if (request.method !== 'POST') {
      response.writeHead(405)
      response.end(toJson({ error: 'Method not allowed' }))
      return true
    }

    try {
      const body = await this.#readRequestBody(request)
      const { webhookUrl, login, password } = JSON.parse(body) as {
        webhookUrl: string
        login: string
        password: string
      }

      if (!webhookUrl || !login || !password) {
        response.writeHead(400)
        response.end(
          toJson({ error: 'Missing webhookUrl, login, or password' }),
        )
        return true
      }

      const baseUrl = this.#deps.getBaseUrl(webhookUrl)
      const tokens = await this.#deps.byosLogin(baseUrl, login, password)

      response.writeHead(200)
      response.end(
        toJson({
          success: true,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          obtained_at: Date.now(),
        }),
      )
    } catch (err) {
      log.error`BYOS login failed: ${(err as Error).message}`
      response.writeHead(401)
      response.end(toJson({ error: (err as Error).message }))
    }
    return true
  }

  async #handleStaticFile(
    response: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    try {
      const filePath = join(HTML_DIR, pathname)
      let content: Buffer | string
      let contentType: string

      const ext = pathname.split('.').pop() || ''

      // If requesting .js, check for .ts file first (TypeScript frontend)
      if (ext === 'js') {
        const tsPath = filePath.replace(/\.js$/, '.ts')
        try {
          const tsContent = await readFile(tsPath, 'utf-8')
          // Transpile TypeScript to JavaScript using Bun
          const transpiler = new Bun.Transpiler({ loader: 'ts' })
          content = transpiler.transformSync(tsContent)
          contentType = 'application/javascript'
        } catch {
          // Fall back to .js file if .ts doesn't exist
          content = await readFile(filePath)
          contentType = MIME_TYPES[ext] || 'text/plain'
        }
      } else {
        content = await readFile(filePath)
        contentType = MIME_TYPES[ext] || 'text/plain'
      }

      const contentLength =
        typeof content === 'string'
          ? Buffer.byteLength(content)
          : content.length

      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': contentLength,
      })
      response.end(content)
      return true
    } catch (_err) {
      response.statusCode = 404
      response.end('Not Found')
      return true
    }
  }
}
