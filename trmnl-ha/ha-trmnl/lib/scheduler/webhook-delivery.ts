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
 * Updates an existing BYOS screen by model_id using PATCH.
 * Used to handle 422 errors when screen already exists.
 *
 * @param webhookUrl - The webhook URL (used to derive base URL)
 * @param modelId - The model_id to search for (as string, compared to API's number)
 * @param authToken - Bearer token for authentication
 * @param imageBuffer - The new image buffer to upload
 * @param format - The image format
 * @param byosConfig - The BYOS configuration with label, name, etc.
 * @returns true if screen was found and updated, false otherwise
 */
async function updateExistingByosScreen(
  webhookUrl: string,
  modelId: string,
  authToken: string,
  imageBuffer: Buffer,
  format: ImageFormat,
  byosConfig: NonNullable<
    NonNullable<WebhookFormatConfig>['byosConfig']
  >,
): Promise<boolean> {
  const baseUrl = getBaseUrl(webhookUrl)
  const screensUrl = `${baseUrl}/api/screens`

  try {
    // GET /api/screens to list all screens
    const listResponse = await fetch(screensUrl, {
      method: 'GET',
      headers: { Authorization: authToken },
    })

    if (!listResponse.ok) {
      log.error`Failed to list screens: ${listResponse.status} ${listResponse.statusText}`
      return false
    }

    const response = (await listResponse.json()) as ByosScreensResponse
    const screens = response.data

    // Find screen with matching model_id (API returns number, we store string)
    const targetModelId = parseInt(modelId, 10)
    const existingScreen = screens.find((s) => s.name === byosConfig.name && s.model_id === targetModelId)
    if (!existingScreen) {
      log.debug`No existing screen found with model_id: ${modelId}`
      return false
    }

    log.info`Found existing screen id=${existingScreen.id} with model_id=${modelId}, updating...`

    // Build PATCH payload with content as data URI
    // PATCH API expects HTML content, so we embed the image as a data URI
    const base64Image = imageBuffer.toString('base64')
    const mimeType = format === 'png' ? 'image/png' : 'image/bmp'
    const dataUri = `data:${mimeType};base64,${base64Image}`
    const htmlContent = `<img src="${dataUri}" class="image image--fill" />`
    
    const patchPayload = {
      screen: {
        model_id: targetModelId,
        label: byosConfig.label,
        name: byosConfig.name,
        content: htmlContent,
      },
    }

    // PATCH /api/screens/:id
    const patchResponse = await fetch(`${screensUrl}/${existingScreen.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchPayload),
    })

    if (!patchResponse.ok) {
      log.error`Failed to update screen: ${patchResponse.status} ${patchResponse.statusText}`
      return false
    }

    log.info`Successfully updated screen id=${existingScreen.id}`
    return true
  } catch (err) {
    log.error`Error during screen update: ${(err as Error).message}`
    return false
  }
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
    // Try to update the existing screen instead of deleting and recreating
    if (response.status === 422 && byosConfig && headers['Authorization']) {
      log.info`Got 422, attempting to update existing screen...`
      const updated = await updateExistingByosScreen(
        webhookUrl,
        byosConfig.model_id,
        headers['Authorization'],
        imageBuffer,
        format,
        byosConfig,
      )
      if (updated) {
        log.info`Successfully updated existing screen`
        return {
          success: true,
          status: 200,
          statusText: 'OK (Updated)',
        }
      }
      log.error`Failed to update existing screen`
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
