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
import { getValidAccessToken, getBaseUrl } from './byos-auth.js'

const log = webhookLogger()

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
  const {
    webhookUrl,
    webhookHeaders = {},
    imageBuffer,
    format,
    webhookFormat,
  } = options

  // Get transformer and build payload
  const transformer = getTransformer(webhookFormat)
  const byosConfig =
    webhookFormat?.format === 'byos-hanami'
      ? webhookFormat.byosConfig
      : undefined
  const { body, contentType } = transformer.transform(
    imageBuffer,
    format,
    byosConfig,
  )

  log.info`Sending webhook: ${webhookUrl} (${contentType}, ${imageBuffer.length} bytes, format: ${webhookFormat?.format ?? 'raw'})`

  // Convert body to appropriate type for fetch API
  // String for JSON payloads, Uint8Array for binary (Buffer isn't directly supported)
  const fetchBody: BodyInit =
    typeof body === 'string' ? body : new Uint8Array(body)

  // Build headers with optional BYOS JWT auth
  const headers: Record<string, string> = {
    ...webhookHeaders,
    'Content-Type': contentType,
  }

  // Handle BYOS JWT authentication
  if (byosConfig?.auth?.enabled && byosConfig.auth.access_token) {
    const accessToken = await getValidAccessToken(webhookUrl, byosConfig.auth)
    if (accessToken) {
      headers['Authorization'] = accessToken
      log.debug`BYOS auth: using JWT token`
    } else {
      log.warn`BYOS auth: no valid token, request may fail`
    }
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: fetchBody,
  })

  const responseText = await response.text()

  if (!response.ok) {
    log.error`Webhook failed: ${response.status} ${response.statusText}`

    // Handle 422 (Unprocessable Entity) - likely screen already exists in BYOS
    // Find existing screen and update via PATCH instead of delete + recreate
    if (response.status === 422 && byosConfig && headers['Authorization']) {
      log.info`Got 422, attempting to find and update existing screen via PATCH...`
      const screenId = await findExistingByosScreen(
        webhookUrl,
        byosConfig.model_id,
        byosConfig.name,
        headers['Authorization'],
      )
      if (screenId !== null) {
        const patchResponse = await patchByosScreen(
          webhookUrl,
          screenId,
          fetchBody,
          headers['Authorization'],
        )
        if (patchResponse.ok) {
          log.info`PATCH successful: ${patchResponse.status} ${patchResponse.statusText}`
          return {
            success: true,
            status: patchResponse.status,
            statusText: patchResponse.statusText,
          }
        }
        log.error`PATCH failed: ${patchResponse.status} ${patchResponse.statusText}`
      }
    }

    // Extract error message from response body for better UI feedback
    let errorDetail = ''
    if (responseText) {
      const truncated = responseText.substring(
        0,
        SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH,
      )
      log.error`Response body: ${truncated}`

      // Try to parse JSON error response (e.g., {"error": "Image bit depth..."})
      try {
        const parsed = JSON.parse(responseText) as {
          error?: string
          message?: string
        }
        if (parsed.error) {
          errorDetail = ` - ${parsed.error}`
        } else if (parsed.message) {
          errorDetail = ` - ${parsed.message}`
        }
      } catch {
        // Not JSON, use raw text if short enough
        if (responseText.length <= 100) {
          errorDetail = ` - ${responseText}`
        }
      }
    }

    throw new Error(
      `HTTP ${response.status}: ${response.statusText}${errorDetail}`,
    )
  }

  log.info`Webhook success: ${response.status} ${response.statusText}`
  if (responseText) {
    log.debug`Response body: ${responseText.substring(0, SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH)}`
  }

  return {
    success: true,
    status: response.status,
    statusText: response.statusText,
  }
}
