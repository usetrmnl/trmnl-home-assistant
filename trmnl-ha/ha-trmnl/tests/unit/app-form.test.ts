import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import presetsJson from '../../devices.json'
import type { PresetsConfig, Schedule, TimestampPosition } from '../../types/domain.js'
import { buildSchedule } from '../helpers/schedule-fixtures.js'

const presets = presetsJson as PresetsConfig
interface FormApp {
  sendNow(scheduleId: string, event: Event): Promise<void>
  init(): Promise<void>
  updateScheduleFromForm(): Promise<void>
  applyDevicePreset(): Promise<void>
  useLocalServer(kind: string): Promise<void>
  byosLogin(): Promise<void>
}
const globals = globalThis as unknown as {
  window: { app: FormApp; uiConfig?: unknown }
  document: Document
  localStorage: Storage
}
const originals = {
  window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
  document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
  localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
}
const inputs = new Map<string, unknown>()
let App: new () => FormApp
let app: FormApp
let schedule: Schedule
let saves: Schedule[]

beforeAll(async () => {
  globals.window = {
    location: { search: '' },
    addEventListener() {},
  } as unknown as typeof globals.window
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: { getItem: () => null },
  })
  globals.document = {
    getElementById: (id: string) => inputs.get(id) ?? null,
    createElement: () => ({ value: '', dataset: {} }),
  } as unknown as Document
  // Browser modules are transpiled by Bun; tsconfig excludes html/js.
  const appModule = '../../html/js/app.js'
  await import(appModule)
  App = globals.window.app.constructor as new () => FormApp
})

beforeEach(async () => {
  inputs.clear()
  saves = []
  schedule = buildSchedule({
    device: 'schedule_kindle_voyage',
    dithering: {
      palette: 'gray-4', normalize: true, saturationBoost: false,
      ...presets['schedule_kindle_voyage']!.dithering,
    } as Schedule['dithering'],
  })
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      schedule = JSON.parse(init.body as string) as Schedule
      saves.push(schedule)
      return Response.json(schedule)
    }
    if (String(url).endsWith('/schedules')) return Response.json([schedule])
    if (String(url).endsWith('/presets')) return Response.json(presets)
    if (String(url).endsWith('/byos/login')) {
      return Response.json({ success: true, access_token: 'a', refresh_token: 'r', model_id: '11' })
    }
    return Response.json([])
  }) as typeof fetch
  app = new App()
  globals.window.app = app
  await app.init()
  for (const [id, value] of Object.entries({ s_width: '1448', s_height: '1072', s_rotate: '90', s_format: 'png' })) {
    let currentValue = value
    inputs.set(id, {
      get value() { return currentValue },
      set value(next: string | number) { currentValue = String(next) },
      dispatchEvent: () => { void app.updateScheduleFromForm(); return true },
    })
  }
  inputs.set('s_dithering', { checked: true })
  inputs.set('s_normalize', { checked: true })
})

afterAll(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

it('preserves the preset bit depth when saving through the schedule form', async () => {
  await app.updateScheduleFromForm()
  expect(saves).toHaveLength(1)
  expect(saves[0]!.dithering.bitDepth).toBe(8)
})

it('omits bitDepth from the PUT body for a schedule without an override', async () => {
  const { bitDepth: _bitDepth, ...dithering } = schedule.dithering
  schedule = buildSchedule({ dithering })
  await app.init()
  await app.updateScheduleFromForm()
  expect(saves).toHaveLength(1)
  expect(saves[0]!.dithering).not.toHaveProperty('bitDepth')
})

it('applies all preset dithering fields in one save, including replacing bit depth', async () => {
  const select = {
    value: 'schedule_kindle_voyage',
    options: [{ value: '', dataset: { device: '{}' } }],
    get selectedIndex() { return this.options.findIndex((option) => option.value === this.value) },
    appendChild(option: { value: string; dataset: { device: string } }) { this.options.push(option) },
    remove(index: number) { this.options.splice(index, 1) },
  }
  inputs.set('devicePreset', select)
  // Selecting each preset must replace the previous preset's hidden override.
  for (const [id, bitDepth, palette] of [
    ['schedule_trmnl_og', 1, 'gray-4'],
    ['schedule_kindle_voyage', 8, 'gray-4'],
    ['schedule_inky_7_3', undefined, 'color-7a'],
    ['schedule_kindle_voyage', 8, 'gray-4'],
  ] as const) {
    const preset = presets[id]!
    inputs.set('s_palette', { value: schedule.dithering.palette })
    select.options.push({ value: id, dataset: { device: JSON.stringify(preset) } })
    select.value = id
    saves = []
    await app.applyDevicePreset()
    expect(saves).toHaveLength(1)
    expect(saves[0]!.dithering).toMatchObject(preset.dithering!)
    expect(saves[0]!.dithering.bitDepth).toBe(bitDepth)
    expect(saves[0]!.dithering.palette).toBe(palette)
  }
})

it('drops the preset bit depth and device when the preset is cleared', async () => {
  inputs.set('s_palette', { value: 'gray-16' })
  const select = {
    value: '',
    selectedIndex: 0,
    options: [{ value: '', dataset: { device: '{}' } }],
    appendChild(option: { value: string; dataset: { device: string } }) { select.options.push(option) },
    remove(index: number) { select.options.splice(index, 1) },
  }
  inputs.set('devicePreset', select)

  await app.applyDevicePreset()

  expect(saves).toHaveLength(1)
  expect(saves[0]!.device).toBeNull()
  expect(saves[0]!.dithering).not.toHaveProperty('bitDepth')
  expect(saves[0]!.dithering.palette).toBe('gray-16')
})

for (const position of ['bottom-right', 'bottom-left', 'top-left', 'top-right'] as TimestampPosition[]) {
  it(`round-trips the ${position} timestamp corner through the form`, async () => {
    const content = { innerHTML: '' }
    inputs.set('tabContent', content)
    inputs.set('s_timestamp', { checked: true })
    inputs.set('s_timestamp_position', { value: position })
    await app.updateScheduleFromForm()
    expect(saves).toHaveLength(1)
    expect(saves[0]!.timestampPosition).toBe(position)
    await app.init()
    const select = content.innerHTML.match(/<select[^>]*id="s_timestamp_position"[^>]*>([\s\S]*?)<\/select>/)?.[1]
    expect(select).toContain(`value="${position}" selected`)
  })
}

it('loads bottom-right for a schedule without a timestamp corner', async () => {
  const content = { innerHTML: '' }
  inputs.set('tabContent', content)
  await app.init()
  const select = content.innerHTML.match(/<select[^>]*id="s_timestamp_position"[^>]*>([\s\S]*?)<\/select>/)?.[1]
  expect(select).toContain('value="bottom-right" selected')
})

describe('send to local server', () => {
  const localServers = {
    addonUrl: 'http://local-trmnl-ha:10000',
    servers: [
      { kind: 'terminus', url: 'http://local-trmnl-terminus:2300' },
      { kind: 'larapaper', url: 'http://local-trmnl-larapaper:8080' },
    ],
  }
  const renderedForm = async () => {
    const content = { innerHTML: '' }
    inputs.set('tabContent', content)
    await app.init()
    return content.innerHTML
  }

  beforeEach(() => {
    globals.window.uiConfig = { serverPort: 10000, localServers }
    for (const id of ['confirmModal', 'confirmOverlay', 'confirmTitle', 'confirmMessage', 'confirmBtn', 'cancelBtn']) {
      inputs.set(id, { classList: { add() {}, remove() {} } })
    }
  })

  afterEach(() => {
    delete globals.window.uiConfig
  })

  it('hides the choice outside Home Assistant', async () => {
    delete globals.window.uiConfig
    expect(await renderedForm()).not.toContain('Send to local server')
  })

  it('offers each local server that answered', async () => {
    const html = await renderedForm()
    expect(html).toContain('window.app.useLocalServer(\'terminus\')')
    expect(html).toContain('window.app.useLocalServer(\'larapaper\')')
  })

  it('points the schedule at the LaraPaper plugin as a raw image', async () => {
    inputs.set('s_larapaper_uuid', { value: ' 0f1e-uuid ' })
    await app.useLocalServer('larapaper')
    expect(saves.at(-1)).toMatchObject({
      webhook_url: 'http://local-trmnl-larapaper:8080/api/plugin_settings/0f1e-uuid/image',
      webhook_format: { format: 'raw' },
    })
  })

  it('points the schedule at Terminus with this add-on as the image source', async () => {
    await app.useLocalServer('terminus')
    expect(saves.at(-1)).toMatchObject({
      webhook_url: 'http://local-trmnl-terminus:2300/api/screens',
      webhook_format: {
        format: 'byos-hanami',
        byosConfig: { delivery_mode: 'uri', addon_base_url: 'http://local-trmnl-ha:10000', auth: { enabled: true } },
      },
    })
  })

  it('takes the model id from the local Terminus after login', async () => {
    schedule = buildSchedule({ webhook_url: 'http://local-trmnl-terminus:2300/api/screens' })
    await app.init()
    inputs.set('s_byos_auth_login', { value: 'me@example.com' })
    inputs.set('s_byos_auth_password', { value: 'secret' })
    void app.byosLogin()
    while (saves.length === 0) await Bun.sleep(1)
    expect(saves[0]!.webhook_format?.byosConfig?.model_id).toBe('11')
  })

  it('says why the model id stayed when the local Terminus names none', async () => {
    const message = { textContent: '' }
    inputs.set('confirmMessage', message)
    const answer = globalThis.fetch
    globalThis.fetch = (async (url: unknown, init?: RequestInit) =>
      String(url).endsWith('/byos/login')
        ? Response.json({ success: true, access_token: 'a', refresh_token: 'r' })
        : answer(url as string, init)) as typeof fetch
    schedule = buildSchedule({ webhook_url: 'http://local-trmnl-terminus:2300/api/screens' })
    await app.init()
    inputs.set('s_byos_auth_login', { value: 'me@example.com' })
    inputs.set('s_byos_auth_password', { value: 'secret' })
    void app.byosLogin()
    while (!message.textContent) await Bun.sleep(1)
    expect(message.textContent).toContain('more than one model')
  })

  it('keeps the model id for a Terminus elsewhere', async () => {
    schedule = buildSchedule({ webhook_url: 'https://terminus.example.com/api/screens' })
    await app.init()
    inputs.set('s_byos_auth_login', { value: 'me@example.com' })
    inputs.set('s_byos_auth_password', { value: 'secret' })
    void app.byosLogin()
    while (saves.length === 0) await Bun.sleep(1)
    expect(saves[0]!.webhook_format?.byosConfig?.model_id).toBe('1')
  })
})

for (const outcome of ['success', 'webhook failure', 'capture failure']) {
  it(`keeps Send Now ${outcome} console logs credential-free`, async () => {
    const success = outcome === 'success'
    const credential = 'SYNTHETIC-CONSOLE-CREDENTIAL'
    const url = `https://example.invalid/api/${credential}`
    const detail = `Rejected ${credential}`
    globalThis.fetch = (async () => Response.json({
      success: outcome !== 'capture failure', error: detail, savedPath: '/output/test.png',
      webhook: { attempted: true, success, statusCode: success ? 200 : 503, url, error: detail },
    })) as unknown as typeof fetch
    const modalModule = '../../html/js/confirm-modal.js'
    const { ConfirmModal } = await import(modalModule)
    const alert = spyOn(ConfirmModal.prototype, 'alert').mockResolvedValue(undefined)
    const info = spyOn(console, 'log').mockImplementation(() => {})
    const error = spyOn(console, 'error').mockImplementation(() => {})
    // Avoid form/render side effects; exercise the actual public Send Now path.
    const save = spyOn(app, 'updateScheduleFromForm').mockResolvedValue(undefined)
    const documentBody = Object.getOwnPropertyDescriptor(globals.document, 'body')
    Object.defineProperty(globals.document, 'body', { configurable: true, value: { contains: () => false } })
    try {
      const button = { textContent: 'Send', style: {}, disabled: false }
      await app.sendNow('schedule-1', { target: button } as unknown as Event)
      const messages = [...info.mock.calls, ...error.mock.calls].map((args) => args.join(' ')).join('\n')
      expect(messages).toContain(outcome === 'capture failure'
        ? 'Screenshot capture failed'
        : success ? 'Webhook success: HTTP 200' : 'Webhook failed: HTTP 503')
      expect(messages).not.toContain(credential)
      expect(alert).toHaveBeenCalledTimes(1)
      const feedback = alert.mock.calls[0]![0] as { message: string }
      if (outcome !== 'capture failure') expect(feedback.message).toContain(url)
      if (!success) expect(feedback.message).toContain(detail)
    } finally {
      alert.mockRestore(); info.mockRestore(); error.mockRestore(); save.mockRestore()
      if (documentBody) Object.defineProperty(globals.document, 'body', documentBody)
      else Reflect.deleteProperty(globals.document, 'body')
    }
  })
}
