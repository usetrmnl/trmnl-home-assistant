import { afterEach, describe, expect, it } from 'bun:test'
import {
  createLocalServerCache,
  findLocalServers,
  readTerminusModelId,
} from '../../lib/local-servers.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('findLocalServers', () => {
  it('returns null outside Home Assistant', async () => {
    expect(await findLocalServers('my-laptop', async () => true)).toBeNull()
  })

  it('lists the sibling add-ons that answer', async () => {
    const found = await findLocalServers(
      '5f3a2b1c-trmnl-ha',
      async (url) => url.includes('terminus'),
    )

    expect(found).toEqual({
      addonUrl: 'http://5f3a2b1c-trmnl-ha:10000',
      servers: [{ kind: 'terminus', url: 'http://5f3a2b1c-trmnl-terminus:2300' }],
    })
  })

  it('probes the LaraPaper add-on on its internal port', async () => {
    const found = await findLocalServers('local-trmnl-ha', async () => true)

    expect(found?.servers).toContainEqual({
      kind: 'larapaper',
      url: 'http://local-trmnl-larapaper:8080',
    })
  })

  it('returns no servers when no sibling answers', async () => {
    const found = await findLocalServers('local-trmnl-ha', async () => false)

    expect(found?.servers).toEqual([])
  })
})

describe('readTerminusModelId', () => {
  const devices = (models: number[], status = 200) => {
    globalThis.fetch = (async () =>
      Response.json(
        { data: models.map((model_id) => ({ model_id })) },
        { status },
      )) as unknown as typeof fetch
  }

  it('returns the model id every device shares', async () => {
    devices([11, 11])

    expect(await readTerminusModelId('http://t:2300', 'token')).toBe('11')
  })

  it('returns undefined when devices differ in model', async () => {
    devices([11, 12])

    expect(await readTerminusModelId('http://t:2300', 'token')).toBeUndefined()
  })

  it('returns undefined when there are no devices', async () => {
    devices([])

    expect(await readTerminusModelId('http://t:2300', 'token')).toBeUndefined()
  })

  it('returns undefined when Terminus refuses the request', async () => {
    devices([11], 401)

    expect(await readTerminusModelId('http://t:2300', 'token')).toBeUndefined()
  })

  it('returns undefined when Terminus cannot be reached', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch

    expect(await readTerminusModelId('http://t:2300', 'token')).toBeUndefined()
  })
})

describe('createLocalServerCache', () => {
  function countingFinder() {
    const finder = async () => ({ addonUrl: `http://x-trmnl-ha:10000`, servers: [], call: ++finder.calls })
    finder.calls = 0
    return finder
  }

  it('probes once within five minutes', async () => {
    const finder = countingFinder()
    let now = 0
    const cached = createLocalServerCache(finder, () => now)

    await cached()
    now += 4 * 60_000
    await cached()

    expect(finder.calls).toBe(1)
  })

  it('probes again after five minutes, so a new add-on appears', async () => {
    const finder = countingFinder()
    let now = 0
    const cached = createLocalServerCache(finder, () => now)

    await cached()
    now += 5 * 60_000 + 1
    await cached()

    expect(finder.calls).toBe(2)
  })
})
