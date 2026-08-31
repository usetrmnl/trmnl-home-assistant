/**
 * BYOS shared constants
 *
 * NOTE: Lives under html/shared/ (not types/) so the frontend's runtime import
 * resolves via the static-file router. `types/` is backend-only + type-only
 * imports, which Bun strips at transpile time.
 *
 * @module shared/byos-constants
 */

import type { ByosDeliveryMode, ByosHanamiConfig } from '../../types/domain.js'

/**
 * Delivery mode for a schedule that has never chosen one. Terminus dropped
 * base64 in 0.52.0, so a new schedule that stays on the default has to be one
 * Terminus can still accept.
 */
export const BYOS_DEFAULT_DELIVERY_MODE: ByosDeliveryMode = 'uri'

/**
 * Delivery mode to show for a schedule's stored config.
 *
 * New schedules get the default; stored ones get whatever the transformer
 * would actually pick, so the dropdown never disagrees with what gets sent.
 *
 * Keep in sync with `ByosHanamiFormatTransformer#selectMode`.
 */
export function deliveryModeFor(
  config?: Pick<ByosHanamiConfig, 'delivery_mode' | 'addon_base_url'>,
): ByosDeliveryMode {
  if (!config) return BYOS_DEFAULT_DELIVERY_MODE
  if (config.delivery_mode) return config.delivery_mode

  return config.addon_base_url ? 'uri' : 'data'
}
