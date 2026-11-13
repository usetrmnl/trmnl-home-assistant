/**
 * Finds the address of Home Assistant Core from inside the add-on.
 *
 * @module lib/core-url
 */

export const DEFAULT_ADDON_HASS_URL = 'http://homeassistant:8123'
const SUPERVISOR_TIMEOUT_MS = 3000

/**
 * Returns the configured address, or, when the option is left at its
 * default, the port and scheme Supervisor reports for Core. New Home
 * Assistant OS installs serve Core on port 80, not 8123.
 */
export async function resolveAddonHassUrl(
  configured: string | undefined,
  supervisorToken: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (configured && configured.replace(/\/+$/, '') !== DEFAULT_ADDON_HASS_URL) return configured
  if (!supervisorToken) return DEFAULT_ADDON_HASS_URL

  try {
    const response = await fetchImpl('http://supervisor/core/info', {
      headers: { Authorization: `Bearer ${supervisorToken}` },
      signal: AbortSignal.timeout(SUPERVISOR_TIMEOUT_MS),
    })
    const { data } = (await response.json()) as { data?: { port?: number; ssl?: boolean } }
    if (!data?.port) return DEFAULT_ADDON_HASS_URL

    return `${data.ssl ? 'https' : 'http'}://homeassistant:${data.port}`
  } catch {
    return DEFAULT_ADDON_HASS_URL
  }
}
