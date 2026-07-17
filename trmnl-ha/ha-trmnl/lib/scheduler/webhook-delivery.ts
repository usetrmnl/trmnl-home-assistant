/**
 * Webhook Delivery - Uploads screenshots to TRMNL webhook endpoints
 *
 * Stateless service with single options object parameter.
 * Throws on HTTP errors (caller handles gracefully).
 *
 * @module lib/scheduler/webhook-delivery
 */

import { SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH } from '../../const.js'
import type { ImageFormat, WebhookFormatConfig } from '../../types/domain.js'
import { webhookLogger } from '../logger.js'
import { getTransformer } from './webhook-formats.js'
import { getValidAccessToken, getBaseUrl, type TokenResponse } from './byos-auth.js'

const log = webhookLogger()

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
      log.error`Failed to list screens: ${listResponse.status} ${listResponse.statusText}`
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

    log.debug`Found existing screen id=${existingScreen.id} with model_id=${modelId} name=${screenName}`
    return existingScreen.id
  } catch (err) {
    log.error`Error finding screen: ${(err as Error).message}`
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

  log.info`Updating existing screen id=${screenId} via PATCH`

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
    const response = await this.#send(body, headers)
    const responseText = await response.text()

    if (response.ok) return this.#successResult(response, responseText)
    return this.#recoverOrThrow(response, responseText, body, headers)
  }

  get #byosConfig() {
    const { webhookFormat } = this.#options
    return webhookFormat?.format === 'byos-hanami'
      ? webhookFormat.byosConfig
      : undefined
  }

  #buildPayload(): { body: BodyInit; contentType: string } {
    const { imageBuffer, format, webhookFormat, screenshotUrl, webhookUrl } =
      this.#options
    const { body, contentType } = getTransformer(webhookFormat).transform(
      imageBuffer,
      format,
      this.#byosConfig,
      screenshotUrl,
    )

    log.info`Sending webhook: ${webhookUrl} (${contentType}, ${imageBuffer.length} bytes, format: ${webhookFormat?.format ?? 'raw'})`

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
      // Bun's raw connect errors ("Unable to connect...") don't say which
      // host failed or why. Most reports trace to hostnames that don't
      // resolve from inside the add-on container (#71), so name the host
      // and the likely fix.
      const host = this.#hostname()
      throw new Error(
        `Could not reach ${host}: ${(err as Error).message}. ` +
          `If ${host} is a local hostname, it may not resolve inside the add-on container — try the server's IP address instead.`,
      )
    }
  }

  /** The webhook host for error messages; a malformed URL is shown raw. */
  #hostname(): string {
    try {
      return new URL(this.#options.webhookUrl).hostname
    } catch {
      return this.#options.webhookUrl
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
    log.error`Webhook failed: ${response.status} ${response.statusText}`

    const authToken = headers['Authorization']
    if (response.status === 422 && this.#byosConfig && authToken) {
      const patched = await this.#patchExistingScreen(body, authToken)
      if (patched) return patched
    }

    throw new WebhookHttpError(
      `HTTP ${response.status}: ${response.statusText}${this.#errorDetail(responseText)}`,
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

    const patchResponse = await patchByosScreen(
      webhookUrl,
      screenId,
      body,
      authToken,
    )
    if (!patchResponse.ok) {
      log.error`PATCH failed: ${patchResponse.status} ${patchResponse.statusText}`
      return null
    }

    log.info`PATCH successful: ${patchResponse.status} ${patchResponse.statusText}`
    return this.#result(patchResponse)
  }

  /** Extracts a human-readable detail from an error response body. */
  #errorDetail(responseText: string): string {
    if (!responseText) return ''

    log.error`Response body: ${responseText.substring(0, SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH)}`

    try {
      const parsed = JSON.parse(responseText) as {
        error?: string
        message?: string
      }
      if (parsed.error) return ` - ${parsed.error}`
      if (parsed.message) return ` - ${parsed.message}`
      return ''
    } catch {
      // Not JSON; short bodies are safe to show raw
      return responseText.length <= 100 ? ` - ${responseText}` : ''
    }
  }

  #successResult(response: Response, responseText: string): WebhookDeliveryResult {
    log.info`Webhook success: ${response.status} ${response.statusText}`
    if (responseText) {
      log.debug`Response body: ${responseText.substring(0, SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH)}`
    }
    return this.#result(response)
  }

  #result(response: Response): WebhookDeliveryResult {
    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
    }
  }
}
