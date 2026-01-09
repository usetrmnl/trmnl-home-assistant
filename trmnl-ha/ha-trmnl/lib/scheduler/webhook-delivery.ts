/**
 * Webhook Delivery - Uploads screenshots to TRMNL webhook endpoints
 *
 * Stateless service with single options object parameter.
 * Throws on HTTP errors (caller handles gracefully).
 *
 * @module lib/scheduler/webhook-delivery
 */

import { SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH } from '../../const.js'
import type { ImageFormat } from '../../types/domain.js'
import { webhookLogger } from '../logger.js'

const log = webhookLogger()

/** MIME type mapping */
const CONTENT_TYPES: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  bmp: 'image/bmp',
  png: 'image/png',
}

/** Options for webhook upload */
export interface WebhookDeliveryOptions {
  webhookUrl: string
  webhookHeaders?: Record<string, string>
  imageBuffer: Buffer
  format: ImageFormat
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
  options: WebhookDeliveryOptions
): Promise<WebhookDeliveryResult> {
  const { webhookUrl, webhookHeaders = {}, imageBuffer, format } = options
  const contentType = CONTENT_TYPES[format] || 'image/png'

  log.info`Sending webhook: ${webhookUrl} (${contentType}, ${imageBuffer.length} bytes)`

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { ...webhookHeaders, 'Content-Type': contentType },
    body: new Uint8Array(imageBuffer),
  })

  const responseText = await response.text()

  if (!response.ok) {
    log.error`Webhook failed: ${response.status} ${response.statusText}`

    // Extract error message from response body for better UI feedback
    let errorDetail = ''
    if (responseText) {
      const truncated = responseText.substring(
        0,
        SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH
      )
      log.error`Response body: ${truncated}`

      // Try to parse JSON error response (e.g., {"error": "Image bit depth..."})
      try {
        const parsed = JSON.parse(responseText)
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

    throw new Error(`HTTP ${response.status}: ${response.statusText}${errorDetail}`)
  }

  log.info`Webhook success: ${response.status} ${response.statusText}`
  if (responseText) {
    log.debug`Response body: ${responseText.substring(0, SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH)}`
  }

  return { success: true, status: response.status, statusText: response.statusText }
}
