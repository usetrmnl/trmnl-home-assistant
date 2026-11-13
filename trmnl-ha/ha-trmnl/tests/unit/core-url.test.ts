import { describe, expect, it } from 'bun:test'
import { resolveAddonHassUrl } from '../../lib/core-url.js'

const supervisorAnswering = (data: unknown) =>
  (async () => Response.json({ result: 'ok', data })) as unknown as typeof fetch

describe('resolveAddonHassUrl', () => {
  it('uses the port Supervisor reports when the option is left at its default', async () => {
    const url = await resolveAddonHassUrl('http://homeassistant:8123', 'token', supervisorAnswering({ port: 80, ssl: false }))
    expect(url).toBe('http://homeassistant:80')
  })

  it('uses https when Core serves it', async () => {
    const url = await resolveAddonHassUrl('', 'token', supervisorAnswering({ port: 8123, ssl: true }))
    expect(url).toBe('https://homeassistant:8123')
  })

  it('keeps an address the user typed', async () => {
    const url = await resolveAddonHassUrl('http://192.168.1.5:8123', 'token', supervisorAnswering({ port: 80, ssl: false }))
    expect(url).toBe('http://192.168.1.5:8123')
  })

  it('falls back to the default when Supervisor does not answer', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    expect(await resolveAddonHassUrl('http://homeassistant:8123', 'token', failing)).toBe('http://homeassistant:8123')
  })

  it('falls back to the default without a Supervisor token', async () => {
    expect(await resolveAddonHassUrl('', undefined, supervisorAnswering({ port: 80, ssl: false }))).toBe('http://homeassistant:8123')
  })
})
