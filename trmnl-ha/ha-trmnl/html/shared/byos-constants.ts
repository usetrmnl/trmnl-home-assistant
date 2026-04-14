/**
 * BYOS shared constants
 *
 * NOTE: Lives under html/shared/ (not types/) so the frontend's runtime import
 * resolves via the static-file router. `types/` is backend-only + type-only
 * imports, which Bun strips at transpile time.
 *
 * @module shared/byos-constants
 */

import type { ByosDeliveryMode } from '../../types/domain.js'

/**
 * Default delivery mode shown in the UI when a schedule has no explicit choice.
 * Keep in sync with the backward-compat branch in
 * `ByosHanamiFormatTransformer#selectMode`.
 */
export const BYOS_DEFAULT_DELIVERY_MODE: ByosDeliveryMode = 'data'
