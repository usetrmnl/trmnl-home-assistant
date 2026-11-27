/**
 * Webhook Delivery - Uploads screenshots to TRMNL webhook endpoints
 *
 * Stateless service with single options object parameter.
 * Throws on HTTP errors (caller handles gracefully).
 *
 * @module lib/scheduler/webhook-delivery
 */

import type { ImageFormat, WebhookFormatConfig } from '../../types/domain.js'
import { webhookLogger } from '../logger.js'
import { errorKind } from '../error-kind.js'
import { getTransformer } from './webhook-formats.js'
import { getValidAccessToken, getBaseUrl, type TokenResponse } from './byos-auth.js'
import { parseNextCheckInAt } from './check-in-alignment.js'

const log = webhookLogger()

/** Webhook URLs can contain write credentials in their path or query string. */
export function redactWebhookUrl(text: string, webhookUrl: string): string {
  return webhookUrl ? text.replaceAll(webhookUrl, '[redacted webhook URL]') : text
}

/**
 * HTTP error from a webhook send, carrying the status and any parsed
 * Retry-After delay so the scheduler can apply a cooldown without re-parsing
 * the error message.
 */
export class WebhookHttpError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message)
    this.name = 'WebhookHttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * The webhook server could not be reached (refused, reset, DNS, timeout):
 * no HTTP status came back. Safe to retry briefly.
 */
export class WebhookConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WebhookConnectionError'
  }
}

/**
 * Parses the Retry-After header into milliseconds. Only the delta-seconds form
 * is supported; an HTTP-date, missing, or unparseable header returns null so
 * the caller falls back to its default cooldown.
 */
export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const trimmed = header.trim()
  // Number() accepts "" and whitespace as 0; require explicit digits
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed) * 1000
}

/** Screen object from BYOS API */
interface ByosScreen {
  id: number
  model_id: number
  label: string
  name: string
  [key: string]: unknown
}

/** BYOS API response wrapper */
interface ByosScreensResponse {
  data: ByosScreen[]
}

/**
 * BYOS screen ids learned from earlier deliveries, keyed by server + model_id +
 * name. With a known id an update is a single PATCH instead of a POST that the
 * server rejects with 422, a full screen list, and then a PATCH. Kept in memory
 * only: after a restart the first delivery learns the id again.
 */
const knownScreenIds = new Map<string, number>()

/** Forgets all learned BYOS screen ids. */
export function clearKnownByosScreenIds(): void {
  knownScreenIds.clear()
}

/** Reads the screen id from a BYOS create response ({ data: { id } }). */
function parseCreatedScreenId(responseText: string): number | null {
  try {
    const id = (JSON.parse(responseText) as { data?: { id?: unknown } }).data?.id
    return typeof id === 'number' ? id : null
  } catch {
    return null
  }
}

/**
 * Finds existing BYOS screen by composite key (model_id + name).
 *
 * BYOS uses a composite unique constraint - a model can have multiple screens.
 *
 * @param webhookUrl - The webhook URL (used to derive base URL)
 * @param modelId - The model_id to search for (as string, compared to API's number)
 * @param screenName - The screen name to match (composite key with model_id)
 * @param authToken - Bearer token for authentication
 * @returns Screen ID if found, null otherwise
 */
async function findExistingByosScreen(
  webhookUrl: string,
  modelId: string,
  screenName: string,
  authToken: string,
): Promise<number | null> {
  const baseUrl = getBaseUrl(webhookUrl)
  const screensUrl = `${baseUrl}/api/screens`

  try {
    const listResponse = await fetch(screensUrl, {
      method: 'GET',
      headers: { Authorization: authToken },
    })

    if (!listResponse.ok) {
      log.error`Failed to list screens: HTTP ${listResponse.status}`
      return null
    }

    const response = (await listResponse.json()) as ByosScreensResponse
    const screens = response.data

    // Find screen with matching model_id AND name (composite unique constraint)
    const targetModelId = parseInt(modelId, 10)
    const existingScreen = screens.find(
      (s) => s.model_id === targetModelId && s.name === screenName,
    )

    if (!existingScreen) {
      log.debug`No existing screen found with model_id=${modelId} name=${screenName}`
      return null
    }

    log.debug`Found existing screen with model_id=${modelId} name=${screenName}`
    return existingScreen.id
  } catch (err) {
    log.error`Error finding screen: ${errorKind(err)}`
    return null
  }
}

/**
 * Updates existing BYOS screen via PATCH.
 *
 * @param webhookUrl - The webhook URL (used to derive base URL)
 * @param screenId - The screen ID to update
 * @param body - The request body (same format as POST)
 * @param authToken - Bearer token for authentication
 * @returns Response from PATCH request
 */
async function patchByosScreen(
  webhookUrl: string,
  screenId: number,
  body: BodyInit,
  authToken: string,
): Promise<Response> {
  const baseUrl = getBaseUrl(webhookUrl)
  const patchUrl = `${baseUrl}/api/screens/${screenId}`

  log.info`Updating existing screen via PATCH`

  return fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: authToken,
      'Content-Type': 'application/json',
    },
    body,
  })
}

/** Options for webhook upload */
export interface WebhookDeliveryOptions {
  webhookUrl: string
  webhookHeaders?: Record<string, string>
  imageBuffer: Buffer
  format: ImageFormat
  /** Webhook payload format (null/undefined = 'raw' for backward compat) */
  webhookFormat?: WebhookFormatConfig | null
  /** Screenshot URL for BYOS URI mode (Terminus fetches from this URL) */
  screenshotUrl?: string
  /** Callback to persist refreshed BYOS JWT tokens */
  onTokenRefresh?: (newTokens: TokenResponse) => void
}

/** Result from webhook upload */
export interface WebhookDeliveryResult {
  success: boolean
  status: number
  statusText: string
  /** Epoch ms when a TRMNL device next shows this image, when the server says */
  nextCheckInAt?: number
}

/**
 * Uploads screenshot to webhook via HTTP POST.
 *
 * @param options - Upload options
 * @returns Result with success status and HTTP info
 * @throws Error on HTTP errors (4xx, 5xx) or network failures
 */
export async function uploadToWebhook(
  options: WebhookDeliveryOptions,
): Promise<WebhookDeliveryResult> {
  return new DeliverWebhook(options).call()
}

/**
 * One webhook delivery: builds the payload, sends it, and on failure
 * recovers via BYOS PATCH or throws a WebhookHttpError with details.
 */
class DeliverWebhook {
  #options: WebhookDeliveryOptions

  constructor(options: WebhookDeliveryOptions) {
    this.#options = options
  }

  async call(): Promise<WebhookDeliveryResult> {
    const { body, contentType } = this.#buildPayload()
    const headers = await this.#buildHeaders(contentType)

    const updated = await this.#patchKnownScreen(body, headers)
    if (updated) return updated

    const response = await this.#send(body, headers)
    const responseText = await response.text()

    if (response.ok) {
      this.#rememberScreenId(parseCreatedScreenId(responseText))
      return this.#successResult(response, responseText)
    }
    return this.#recoverOrThrow(response, responseText, body, headers)
  }

  get #byosConfig() {
    const { webhookFormat } = this.#options
    return webhookFormat?.format === 'byos-hanami'
      ? webhookFormat.byosConfig
      : undefined
  }

  /** Cache key for this delivery's BYOS screen; null when not BYOS. */
  get #screenKey(): string | null {
    const byos = this.#byosConfig
    if (!byos) return null
    try {
      return `${getBaseUrl(this.#options.webhookUrl)}|${byos.model_id}|${byos.name}`
    } catch {
      return null
    }
  }

  #rememberScreenId(screenId: number | null): void {
    const key = this.#screenKey
    if (key && screenId !== null) knownScreenIds.set(key, screenId)
  }

  /**
   * Updates a screen whose id is already known. Returns null when there is no
   * known id, or the server no longer has that screen (Terminus answers 422 for
   * an unknown id), so the normal create-or-find flow runs. Other HTTP errors
   * keep the id and throw, so auth and rate-limit handling still see them.
   */
  async #patchKnownScreen(
    body: BodyInit,
    headers: Record<string, string>,
  ): Promise<WebhookDeliveryResult | null> {
    const key = this.#screenKey
    const authToken = headers['Authorization']
    if (!key || !authToken) return null

    const screenId = knownScreenIds.get(key)
    if (screenId === undefined) return null

    let response: Response
    try {
      response = await patchByosScreen(this.#options.webhookUrl, screenId, body, authToken)
    } catch (err) {
      throw this.#connectionError(err)
    }

    if (response.ok) {
      log.info`PATCH successful: HTTP ${response.status}`
      return this.#result(response)
    }

    if (response.status === 404 || response.status === 422) {
      log.warn`PATCH of known screen failed: HTTP ${response.status}; finding it again`
      knownScreenIds.delete(key)
      return null
    }

    log.error`PATCH failed: HTTP ${response.status}`
    throw this.#httpError(response, await response.text())
  }

  #buildPayload(): { body: BodyInit; contentType: string } {
    const { imageBuffer, format, webhookFormat, screenshotUrl } =
      this.#options
    const { body, contentType } = getTransformer(webhookFormat).transform(
      imageBuffer,
      format,
      this.#byosConfig,
      screenshotUrl,
    )

    log.info`Sending webhook (${contentType}, ${imageBuffer.length} bytes, format: ${webhookFormat?.format ?? 'raw'})`

    // String for JSON payloads, Uint8Array for binary (fetch rejects Buffer)
    return {
      body: typeof body === 'string' ? body : new Uint8Array(body),
      contentType,
    }
  }

  async #buildHeaders(contentType: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      ...this.#options.webhookHeaders,
      'Content-Type': contentType,
    }

    const auth = this.#byosConfig?.auth
    if (auth?.enabled && auth.access_token) {
      const accessToken = await getValidAccessToken(
        this.#options.webhookUrl,
        auth,
        this.#options.onTokenRefresh,
      )
      if (accessToken) {
        headers['Authorization'] = accessToken
        log.debug`BYOS auth: using JWT token`
      } else {
        log.warn`BYOS auth: no valid token, request may fail`
      }
    }

    return headers
  }

  async #send(
    body: BodyInit,
    headers: Record<string, string>,
  ): Promise<Response> {
    try {
      return await fetch(this.#options.webhookUrl, {
        method: 'POST',
        headers,
        body,
      })
    } catch (err) {
      throw this.#connectionError(err)
    }
  }

  /**
   * Bun's raw connect errors ("Unable to connect...") don't say which
   * host failed or why. Most reports trace to hostnames that don't
   * resolve from inside the add-on container (#71), so name the host
   * and the likely fix.
   */
  #connectionError(err: unknown): WebhookConnectionError {
    const host = this.#hostname()
    const detail = redactWebhookUrl((err as Error).message, this.#options.webhookUrl)
    return new WebhookConnectionError(
      `Could not reach ${host}: ${detail}. ` +
        `If ${host} is a local hostname, it may not resolve inside the app container — try the server's IP address instead.`,
      { cause: err },
    )
  }

  /** The webhook host for error messages; never echo a malformed URL. */
  #hostname(): string {
    try {
      return new URL(this.#options.webhookUrl).hostname
    } catch {
      return '[invalid webhook URL]'
    }
  }

  /**
   * On 422 with BYOS auth the screen usually already exists: find it and
   * update via PATCH instead of delete + recreate. Anything unrecovered
   * throws a WebhookHttpError.
   */
  async #recoverOrThrow(
    response: Response,
    responseText: string,
    body: BodyInit,
    headers: Record<string, string>,
  ): Promise<WebhookDeliveryResult> {
    log.error`Webhook failed: HTTP ${response.status}`

    const authToken = headers['Authorization']
    if (response.status === 422 && this.#byosConfig && authToken) {
      const patched = await this.#patchExistingScreen(body, authToken)
      if (patched) return patched
    }

    throw this.#httpError(response, responseText)
  }

  #httpError(response: Response, responseText: string): WebhookHttpError {
    return new WebhookHttpError(
      `HTTP ${response.status}: ${response.statusText}${this.#errorDetail(responseText) || this.#imageFetchHint(response.status)}`,
      response.status,
      parseRetryAfterMs(response.headers.get('Retry-After')),
    )
  }

  async #patchExistingScreen(
    body: BodyInit,
    authToken: string,
  ): Promise<WebhookDeliveryResult | null> {
    const { webhookUrl } = this.#options
    const byos = this.#byosConfig!

    log.info`Got 422, attempting to find and update existing screen via PATCH...`
    const screenId = await findExistingByosScreen(
      webhookUrl,
      byos.model_id,
      byos.name,
      authToken,
    )
    if (screenId === null) return null

    let patchResponse: Response
    try {
      patchResponse = await patchByosScreen(
        webhookUrl,
        screenId,
        body,
        authToken,
      )
    } catch (err) {
      throw this.#connectionError(err)
    }
    if (!patchResponse.ok) {
      log.error`PATCH failed: HTTP ${patchResponse.status}`
      throw this.#httpError(patchResponse, await patchResponse.text())
    }

    this.#rememberScreenId(screenId)
    log.info`PATCH successful: HTTP ${patchResponse.status}`
    return this.#result(patchResponse)
  }

  /** Terminus answers a bare HTML 500 when it cannot fetch or read the image URL. */
  #imageFetchHint(status: number): string {
    return status === 500 && this.#byosConfig && this.#options.screenshotUrl
      ? ' - Terminus could not load the screenshot. Check that Terminus can open the App URL in the schedule settings.'
      : ''
  }

  /** Extracts a human-readable detail from an error response body. */
  #errorDetail(responseText: string): string {
    if (!responseText) return ''

    const safeText = redactWebhookUrl(responseText, this.#options.webhookUrl)

    try {
      const parsed = JSON.parse(safeText) as {
        error?: string
        message?: string
        detail?: unknown
      }
      if (parsed.error) return ` - ${parsed.error}`
      if (parsed.message) return ` - ${parsed.message}`
      // Problem Details (RFC 9457), used by Terminus. The detail can quote the
      // screenshot URL, which may carry an access secret, so drop any URL.
      if (typeof parsed.detail === 'string' && parsed.detail) {
        return ` - ${parsed.detail.replace(/https?:\/\/\S+/gi, '[redacted URL]')}`
      }
      return ''
    } catch {
      // Not JSON; short bodies are safe to show raw
      return safeText.length <= 100 ? ` - ${safeText}` : ''
    }
  }

  // Response bodies and status text can echo credentials; never log them.
  #successResult(response: Response, responseText: string): WebhookDeliveryResult {
    log.info`Webhook success: HTTP ${response.status}`
    return { ...this.#result(response), nextCheckInAt: parseNextCheckInAt(responseText) }
  }

  #result(response: Response): WebhookDeliveryResult {
    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
    }
  }
}
