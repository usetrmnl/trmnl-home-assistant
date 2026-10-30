/** Regression tests for hung requests and watchdog recovery without overlapping work. */
import { expect, test } from 'bun:test'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readAccountTiming, RefreshWorker, type RefreshDeps } from '../../lib/scheduler/refresh-worker.js'
import type { Schedule } from '../../types/domain.js'

const device = { id: 1, refresh_interval: 1800, sleep_mode_enabled: false,
  hardware_last_ping_at: '2026-10-27T12:00:00Z' }
const config = { schedule_id: 'test', device_id: 1, lead_seconds: 180,
  fallback_interval_seconds: 1800, initial_intervals_seconds: [1800] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

async function withServer(handler: http.RequestListener, body: (get: NonNullable<NonNullable<Parameters<typeof readAccountTiming>[2]>['get']>) => Promise<void>) {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as import('node:net').AddressInfo
  try {
    await body((url, options, callback) => {
      expect(url).toBe('https://trmnl.com/api/devices/1')
      expect(options.rejectUnauthorized).toBe(true)
      return http.get(`http://127.0.0.1:${address.port}`, options, callback)
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

test('account deadline cancels before connection when DNS never completes', async () => {
  let request: http.ClientRequest | undefined
  let signal: AbortSignal | null | undefined
  await expect(readAccountTiming(1, 'PRIVATE_TOKEN', { deadlineMs: 30, get: (_url, options, callback) => {
    signal = options.signal
    request = http.get('http://unresolved.invalid', { ...options, lookup: () => {} }, callback)
    return request
  } })).rejects.toThrow('Account read failed')
  expect(signal?.aborted).toBe(true)
  expect(request?.destroyed).toBe(true)
})

test('account deadline cancels a server that never sends headers', async () => {
  await withServer(() => {}, async get => {
    await expect(readAccountTiming(1, 'PRIVATE_TOKEN', { get, deadlineMs: 40 })).rejects.toThrow('Account read failed')
  })
})

test('account deadline includes a body that keeps trickling without ending', async () => {
  let timer: ReturnType<typeof setInterval> | undefined
  let request: http.ClientRequest | undefined
  let response: http.IncomingMessage | undefined
  try {
    await withServer((_req, res) => {
      res.writeHead(200)
      res.write('{')
      timer = setInterval(() => res.write(' '), 5)
    }, async get => {
      await expect(readAccountTiming(1, 'PRIVATE_TOKEN', { deadlineMs: 60,
        get: (url, options, callback) => {
          request = get(url, options, incoming => { response = incoming; callback(incoming) })
          return request
        },
      })).rejects.toThrow('Account read failed')
      expect(request?.destroyed).toBe(true)
      expect(response?.destroyed).toBe(true)
    })
  } finally { clearInterval(timer) }
})

test('interrupted response rejects without leaking server text or the token', async () => {
  await withServer((_req, res) => {
    res.writeHead(200)
    res.write('PRIVATE_RESPONSE')
    setTimeout(() => res.destroy(), 5)
  }, async get => {
    await expect(readAccountTiming(1, 'PRIVATE_TOKEN', { get, deadlineMs: 100 })).rejects.toThrow(/^Account read failed$/)
  })
})

test('complete account response remains allowlisted', async () => {
  await withServer((_req, res) => res.end(JSON.stringify({ data: { ...device, secret: 'PRIVATE_RESPONSE' } })), async get => {
    const result = await readAccountTiming(1, 'PRIVATE_TOKEN', { get, deadlineMs: 1000 })
    expect(result.refresh_interval).toBe(1800)
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
})

async function withWorker(body: (h: { worker: RefreshWorker; deps: RefreshDeps; advance: (ms: number) => void }) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'refresh-recovery-'))
  let now = Date.parse('2026-10-27T12:27:00Z')
  const deps: RefreshDeps = {
    now: () => new Date(now), readDevice: async () => device,
    loadSchedules: async () => [{ id: 'test', enabled: true, interval_minutes: null, webhook_url: 'PRIVATE_WEBHOOK' } as Schedule],
    execute: async () => ({ success: true, savedPath: 'x', webhook: { attempted: true, success: true } }),
  }
  const worker = new RefreshWorker([config], path.join(dir, 'state.json'), deps)
  try { await body({ worker, deps, advance: ms => { now += ms } }) }
  finally { await rm(dir, { recursive: true, force: true }) }
}

test('hung account read fails health and retains lock until the operation actually settles', async () => withWorker(async h => {
  const entered = deferred<undefined>(), release = deferred<typeof device>()
  let reads = 0
  h.deps.readDevice = () => { reads++; entered.resolve(undefined); return release.promise }
  const pending = h.worker.tick()
  await entered.promise
  try {
    expect(h.worker.health().healthy).toBe(true)
    h.advance(300001)
    expect(h.worker.health()).toMatchObject({ healthy: false, busy: true, phase: 'reading-device' })
    await h.worker.tick('test')
    expect(reads).toBe(1)
    expect(JSON.stringify(h.worker.status())).not.toContain('PRIVATE')
  } finally { release.resolve(device); await pending }
  expect(h.worker.health()).toMatchObject({ healthy: true, busy: false, phase: 'idle' })
}))

test('hung capture fails health without launching a second upload', async () => withWorker(async h => {
  const entered = deferred<undefined>(), release = deferred<undefined>()
  let sends = 0
  h.deps.execute = async () => {
    sends++; entered.resolve(undefined); await release.promise
    return { success: true, savedPath: 'x', webhook: { attempted: true, success: true } }
  }
  const pending = h.worker.tick()
  await entered.promise
  try {
    h.advance(300001)
    expect(h.worker.health()).toMatchObject({ healthy: false, phase: 'capturing-and-delivering' })
    await h.worker.tick()
    expect(sends).toBe(1)
  } finally { release.resolve(undefined); await pending }
  await h.worker.tick()
  expect(sends).toBe(1)
  expect(h.worker.health().healthy).toBe(true)
}))

test('hung schedule loading exposes its phase and also fails the watchdog', async () => withWorker(async h => {
  const entered = deferred<undefined>(), release = deferred<Schedule[]>()
  h.deps.loadSchedules = () => { entered.resolve(undefined); return release.promise }
  const pending = h.worker.tick()
  await entered.promise
  try {
    h.advance(300001)
    expect(h.worker.health()).toMatchObject({ healthy: false, phase: 'loading-schedules' })
  } finally { release.resolve([]); await pending }
}))

test('stopped polling fails health but normal sleeping polls and disabled alignment stay healthy', async () => withWorker(async h => {
  const disabled = new RefreshWorker([], 'unused', h.deps)
  h.advance(180001)
  expect(h.worker.health()).toMatchObject({ healthy: false, reason: 'Refresh polling stopped' })
  expect(disabled.health()).toMatchObject({ healthy: true, enabled: false })
  h.deps.now = () => new Date('2026-10-27T23:30:00Z')
  h.deps.readDevice = async () => ({ ...device, sleep_mode_enabled: true, sleep_start_time: 0, sleep_end_time: 1439 })
  let sends = 0
  h.deps.execute = async () => { sends++; return { success: true, savedPath: 'unused' } }
  await h.worker.tick()
  expect(sends).toBe(0)
  expect(h.worker.health()).toMatchObject({ healthy: true, phase: 'idle' })
}))
