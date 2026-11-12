/**
 * Finds the Terminus and LaraPaper add-ons installed beside this one.
 *
 * Supervisor names each add-on container `<repository>-<slug>`, so add-ons
 * from this repository share our hostname up to the slug.
 *
 * @module lib/local-servers
 */

import { hostname } from 'node:os'
import { SERVER_PORT } from '../const.js'
import type { LocalServer, LocalServers } from '../types/domain.js'

const OWN_SLUG = 'trmnl-ha'
const SIBLING_ADDRESSES: Record<LocalServer['kind'], string> = {
  terminus: 'trmnl-terminus:2300',
  larapaper: 'trmnl-larapaper:8080',
}
const PROBE_TIMEOUT_MS = 1000

async function answersHttp(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return true
  } catch {
    return false
  }
}

/**
 * Lists the sibling add-ons that answer HTTP.
 *
 * @returns null when not running as a Home Assistant add-on
 */
export async function findLocalServers(
  ownHostname = hostname(),
  isUp = answersHttp,
): Promise<LocalServers | null> {
  if (!ownHostname.endsWith(`-${OWN_SLUG}`)) return null

  const prefix = ownHostname.slice(0, -OWN_SLUG.length)
  const candidates = Object.entries(SIBLING_ADDRESSES).map(
    ([kind, address]) =>
      ({ kind, url: `http://${prefix}${address}` }) as LocalServer,
  )
  const up = await Promise.all(candidates.map(({ url }) => isUp(url)))

  return {
    addonUrl: `http://${ownHostname}:${SERVER_PORT}`,
    servers: candidates.filter((_, index) => up[index]),
  }
}

const LOCAL_SERVER_CACHE_MS = 5 * 60_000

/** Reuses one probe for five minutes, so a page load does not wait on add-ons that are not installed. */
export function createLocalServerCache(
  find: () => Promise<LocalServers | null> = findLocalServers,
  now: () => number = Date.now,
): () => Promise<LocalServers | null> {
  let cached: { at: number; result: Promise<LocalServers | null> } | null = null
  return () => {
    if (!cached || now() - cached.at > LOCAL_SERVER_CACHE_MS) cached = { at: now(), result: find() }
    return cached.result
  }
}

export const cachedLocalServers = createLocalServerCache()

/**
 * Reads the model id every device on a Terminus server shares.
 *
 * @returns undefined when the devices differ, none exist, or the read fails
 */
export async function readTerminusModelId(
  baseUrl: string,
  accessToken: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(`${baseUrl}/api/devices`, {
      headers: { Authorization: accessToken },
    })
    if (!response.ok) return undefined

    const { data } = (await response.json()) as {
      data?: { model_id: number }[]
    }
    const modelIds = new Set(data?.map(({ model_id }) => String(model_id)))
    return modelIds.size === 1 ? [...modelIds][0] : undefined
  } catch {
    return undefined
  }
}
