/**
 * Webhook Format Transformers - Strategy Pattern for Payload Formats
 *
 * Transforms screenshot image data into format-specific webhook payloads.
 * Each format (raw, BYOS Hanami, etc.) has its own transformer that knows
 * how to structure the HTTP payload correctly.
 *
 * @module lib/scheduler/webhook-formats
 */

import type {
  ImageFormat,
  WebhookFormatConfig,
  ByosHanamiConfig,
} from '../../types/domain.js'

/** MIME type mapping for image formats */
const CONTENT_TYPES: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  bmp: 'image/bmp',
}

/** Transformed webhook payload ready for HTTP POST */
export interface WebhookPayload {
  /** Request body (Buffer for binary, string for JSON) */
  body: Buffer | string
  /** Content-Type header value */
  contentType: string
}

/** Strategy interface for webhook format transformers */
export interface FormatTransformer {
  /**
   * Transforms image buffer into format-specific webhook payload.
   *
   * @param imageBuffer - Raw image data
   * @param format - Image format (png, jpeg, bmp)
   * @param config - Optional format-specific configuration
   * @returns Payload with body and content type
   */
  transform(
    imageBuffer: Buffer,
    format: ImageFormat,
    config?: unknown,
  ): WebhookPayload
}

/**
 * Raw format transformer - sends binary image data directly.
 * This is the current/default behavior.
 */
export class RawFormatTransformer implements FormatTransformer {
  transform(imageBuffer: Buffer, format: ImageFormat): WebhookPayload {
    return {
      body: imageBuffer,
      contentType: CONTENT_TYPES[format] ?? 'image/png',
    }
  }
}

/**
 * BYOS Hanami API format transformer.
 * Wraps image in JSON with base64 encoding and metadata.
 *
 * BYOS API expects:
 * ```
 * POST /api/screens
 * Content-Type: application/json
 * {
 *   "screen": {
 *     "data": "<base64-encoded-image>",
 *     "label": "Home Assistant",
 *     "name": "ha-dashboard",
 *     "model_id": "1",
 *     "file_name": "ha-dashboard.png"
 *   }
 * }
 * ```
 */
export class ByosHanamiFormatTransformer implements FormatTransformer {
  transform(
    imageBuffer: Buffer,
    format: ImageFormat,
    config?: ByosHanamiConfig,
  ): WebhookPayload {
    if (!config) {
      throw new Error(
        'BYOS Hanami format requires config with label, name, and model_id',
      )
    }

    const base64Data = imageBuffer.toString('base64')
    const fileName = `${config.name}.${format}`

    const payload = {
      screen: {
        data: base64Data,
        label: config.label,
        name: config.name,
        model_id: config.model_id,
        file_name: fileName,
      },
    }

    return {
      body: JSON.stringify(payload),
      contentType: 'application/json',
    }
  }
}

/**
 * Factory function to get the appropriate transformer for a webhook format.
 *
 * @param formatConfig - Optional format configuration (null/undefined = raw)
 * @returns Format transformer instance
 */
export function getTransformer(
  formatConfig?: WebhookFormatConfig | null,
): FormatTransformer {
  if (!formatConfig || formatConfig.format === 'raw') {
    return new RawFormatTransformer()
  }

  if (formatConfig.format === 'byos-hanami') {
    return new ByosHanamiFormatTransformer()
  }

  // Fallback to raw for unknown formats (defensive)
  return new RawFormatTransformer()
}
