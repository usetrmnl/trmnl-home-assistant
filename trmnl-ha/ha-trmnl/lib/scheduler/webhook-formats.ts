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
  ByosDeliveryMode,
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
   * @param screenshotUrl - Optional screenshot URL for URI mode
   * @returns Payload with body and content type
   */
  transform(
    imageBuffer: Buffer,
    format: ImageFormat,
    config?: unknown,
    screenshotUrl?: string,
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
 *
 * Two delivery modes, user-selectable via `config.delivery_mode`:
 * - `uri`: sends screenshot endpoint URL; Terminus fetches it.
 *   Required for Terminus >= 0.52.0 (base64 support was removed).
 * - `data`: sends base64-encoded image; only works on Terminus <= 0.51.0.
 *
 * Mode selection (including backward-compat defaults) lives in #selectMode.
 */
export class ByosHanamiFormatTransformer implements FormatTransformer {
  transform(
    imageBuffer: Buffer,
    format: ImageFormat,
    config?: ByosHanamiConfig,
    screenshotUrl?: string,
  ): WebhookPayload {
    if (!config) {
      throw new Error(
        'BYOS Hanami format requires config with label, name, and model_id',
      )
    }

    const mode = this.#selectMode(config, screenshotUrl)

    if (mode === 'uri') {
      // NOTE: #selectMode guarantees screenshotUrl is defined when mode is 'uri'
      return this.#buildUriPayload(config, screenshotUrl!)
    }

    return this.#buildDataPayload(imageBuffer, format, config)
  }

  /**
   * Decides which delivery mode to use for this request.
   *
   * Policy: if the schedule was already set up for data mode, keep data;
   * otherwise URI mode is the default.
   *
   * - Explicit `data` wins even when a screenshot URL is available.
   * - Legacy schedules (no `delivery_mode`, no `addon_base_url`) are treated
   *   as data-mode setups and preserved as-is.
   * - Explicit `uri` without a screenshot URL is a misconfiguration — fail
   *   loud rather than silently falling back.
   */
  #selectMode(
    config: ByosHanamiConfig,
    screenshotUrl?: string,
  ): ByosDeliveryMode {
    if (config.delivery_mode === 'data') return 'data'
    if (config.delivery_mode === undefined && !screenshotUrl) return 'data'

    if (!screenshotUrl) {
      throw new Error(
        'BYOS Hanami URI mode requires "Add-on URL" to be set in the schedule config.',
      )
    }
    return 'uri'
  }

  /** URI mode: Terminus fetches the image from the add-on's screenshot endpoint */
  #buildUriPayload(
    config: ByosHanamiConfig,
    screenshotUrl: string,
  ): WebhookPayload {
    const payload = {
      screen: {
        uri: screenshotUrl,
        label: config.label,
        name: config.name,
        model_id: config.model_id,
        preprocessed: config.preprocessed,
      },
    }

    return {
      body: JSON.stringify(payload),
      contentType: 'application/json',
    }
  }

  /** Data mode (legacy): base64-encoded image sent directly */
  #buildDataPayload(
    imageBuffer: Buffer,
    format: ImageFormat,
    config: ByosHanamiConfig,
  ): WebhookPayload {
    const base64Data = imageBuffer.toString('base64')
    const fileName = `${config.name}.${format}`

    const payload = {
      screen: {
        data: base64Data,
        label: config.label,
        name: config.name,
        model_id: config.model_id,
        file_name: fileName,
        preprocessed: config.preprocessed,
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
