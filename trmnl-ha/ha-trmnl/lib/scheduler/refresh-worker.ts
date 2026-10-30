/** Persistent refresh worker. Errors and status never contain credentials or raw responses.
 * @module lib/scheduler/refresh-worker
 */
import fs from 'node:fs/promises'
import https from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { Schedule } from '../../types/domain.js'
import type { ExecutionResult } from './schedule-executor.js'
import { planRefresh, validateRefreshConfigs, type DeviceTiming, type RefreshConfig, type RefreshState } from './refresh-planner.js'

interface SavedDevice { timing: DeviceTiming | null; state: RefreshState; identity: number }
export interface RefreshDeps {
  readDevice(id: number): Promise<DeviceTiming>
  execute(schedule: Schedule): Promise<ExecutionResult>
  loadSchedules(): Promise<Schedule[]>
  now(): Date
}
interface AccountReadOptions {
  get?: (url: string, options: https.RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest
  deadlineMs?: number
}
export interface RefreshHealth {
  healthy: boolean
  enabled: boolean
  busy: boolean
  phase: string
  cycle_started_at: string | null
  last_completed_at: string
  last_progress_at: string
  reason?: string
}
/** Only the official account host receives this credential. TLS verification is explicit
 * because the screenshot browser supports private/self-signed HA certificates.
 * The deadline covers DNS, connect, TLS and the entire body, including trickle responses.
 * Transport/deadline injection allows offline cancellation tests in the Bun runtime. */
export async function readAccountTiming(id: number, token: string, options: AccountReadOptions = {}): Promise<DeviceTiming> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const controller = new AbortController()
      let response: IncomingMessage | undefined
      const fail = () => reject(new Error('Account read failed'))
      timer = setTimeout(() => {
        // Settle explicitly even if the transport fails to emit its abort/error event.
        fail()
        controller.abort()
        response?.destroy()
        req?.destroy()
      }, options.deadlineMs ?? 15000)
      const req = (options.get ?? https.get)(`https://trmnl.com/api/devices/${id}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        rejectUnauthorized: true,
        signal: controller.signal,
      }, incoming => {
        response = incoming
        let data = ''
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString()
          if (data.length > 1_000_000) {
            fail()
            response?.destroy()
            req?.destroy()
          }
        })
        response.on('end', () => incoming.statusCode === 200 ? resolve(data) : fail())
        response.on('error', fail)
        response.on('aborted', fail)
        response.on('close', () => { if (!incoming.complete) fail() })
      })
      req.on('error', fail)
    })
    return timingFromAccount(JSON.parse(body) as unknown, id)
  }
  catch { throw new Error('Account read failed') }
  finally { clearTimeout(timer) }
}
/** Validate and allowlist account responses before retaining them across outages. */
export function timingFromAccount(response: unknown, id: number): DeviceTiming {
  const data = (response as { data?: DeviceTiming & { id?: number } })?.data
  const minute = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440
  if (data?.id !== id || typeof data.refresh_interval !== 'number'
    || !Number.isInteger(data.refresh_interval) || data.refresh_interval < 60 || data.refresh_interval > 86400
    || typeof data.sleep_mode_enabled !== 'boolean'
    || (data.sleep_mode_enabled && (!minute(data.sleep_start_time) || !minute(data.sleep_end_time)))) {
    throw new Error('Account read failed')
  }
  return { refresh_interval: data.refresh_interval, hardware_last_ping_at: data.hardware_last_ping_at,
    sleep_mode_enabled: data.sleep_mode_enabled, sleep_start_time: data.sleep_start_time,
    sleep_end_time: data.sleep_end_time, sleep_until: data.sleep_until }
}

/** One serial worker for account polling and fixed/dynamic delivery. */
export class RefreshWorker {
  #saved: Record<string, SavedDevice> = {}
  #status: Record<string, object> = {}
  #busy = false
  #loaded = false
  #fixedQueue = new Set<string>()
  #phase = 'idle'
  #cycleStarted: number | null = null
  #lastCompleted: number
  #lastProgress: number
  constructor(private configs: RefreshConfig[], private file: string, private deps: RefreshDeps) {
    validateRefreshConfigs(configs)
    this.#lastCompleted = this.#lastProgress = deps.now().getTime()
  }
  /** Returns only allowlisted diagnostic fields. */
  status(): object { return { worker: this.health(), schedules: structuredClone(this.#status) } }
  /** A stalled cycle remains locked: failing health lets the process watchdog recover
   * without abandoning a capture that could still upload after a second one starts. */
  health(): RefreshHealth {
    const now = this.deps.now().getTime(), enabled = this.configs.length > 0
    const reason = !enabled ? undefined
      : this.#cycleStarted !== null && now - this.#cycleStarted > 300000 ? 'Refresh cycle exceeded five minutes'
      : !this.#busy && now - this.#lastCompleted > 180000 ? 'Refresh polling stopped'
      : undefined
    return { healthy: !reason, enabled, busy: this.#busy, phase: this.#phase,
      cycle_started_at: this.#cycleStarted === null ? null : new Date(this.#cycleStarted).toISOString(),
      last_completed_at: new Date(this.#lastCompleted).toISOString(),
      last_progress_at: new Date(this.#lastProgress).toISOString(), ...(reason ? { reason } : {}) }
  }
  #setPhase(phase: string): void {
    this.#phase = phase
    this.#lastProgress = this.deps.now().getTime()
  }
  /** Whether this schedule opts into refresh alignment. */
  owns(id: string): boolean { return this.configs.some(c => c.schedule_id === id) }
  async #load(): Promise<void> {
    if (this.#loaded) return
    try { this.#saved = JSON.parse(await fs.readFile(this.file, 'utf8')) as Record<string, SavedDevice> }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Refresh state unreadable')
    }
    this.#loaded = true
  }
  async #save(): Promise<void> {
    const temp = `${this.file}.tmp`
    await fs.writeFile(temp, JSON.stringify(this.#saved), { mode: 0o600 })
    await fs.rename(temp, this.file)
  }
  /** Poll once; overlapping ticks are skipped rather than queued. */
  async tick(fixedId?: string): Promise<void> {
    if (fixedId) this.#fixedQueue.add(fixedId)
    if (this.#busy) return
    this.#busy = true
    this.#cycleStarted = this.deps.now().getTime()
    if (fixedId) this.#fixedQueue.delete(fixedId)
    try {
      this.#setPhase('loading-state')
      await this.#load()
      this.#setPhase('loading-schedules')
      const schedules = await this.deps.loadSchedules()
      for (const config of this.configs) {
        if (fixedId && config.schedule_id !== fixedId) continue
        const fixedRequested = config.schedule_id === fixedId || this.#fixedQueue.delete(config.schedule_id)
        const schedule = schedules.find(s => s.id === config.schedule_id)
        if (!schedule?.enabled || schedule.interval_minutes != null || !schedule.webhook_url) {
          this.#status[config.schedule_id] = { ready: false, error: 'Requires enabled cron schedule with webhook' }
          continue
        }
        const now = this.deps.now(), stamp = now.getTime() / 1000
        let saved = this.#saved[config.schedule_id]
        if (!saved || saved.identity !== config.device_id) saved = { identity: config.device_id, timing: null, state: {} }
        this.#saved[config.schedule_id] = saved
        if (fixedRequested) saved.state.pending_fixed = stamp
        let readOK = true
        this.#setPhase('reading-device')
        try { saved.timing = await this.deps.readDevice(config.device_id) }
        catch { readOK = false }
        // Without any successful account read, do not guess the sleep window.
        if (!saved.timing && !saved.state.pending_fixed) {
          this.#status[config.schedule_id] = { ready: false, device_read_ok: false, error: 'Waiting for first account read' }
          continue
        }
        const decision = planRefresh(now, saved.timing, saved.state, config)
        saved.state = decision.state
        this.#status[config.schedule_id] = { ready: true, device_read_ok: readOK, checked_at: now.toISOString(), ...decision.plan,
          last_success: saved.state.last_success ?? null, last_delivery_reason: saved.state.last_delivery_reason ?? null,
          last_delivery_target: saved.state.last_delivery_target ?? null, failures: saved.state.failures ?? 0 }
        this.#setPhase('saving-state')
        await this.#save()
        // Fixed cron still runs during sleep; it shares the lock, floor and backoff.
        if (saved.state.pending_fixed && stamp - saved.state.pending_fixed > 900) delete saved.state.pending_fixed
        const fixed = saved.state.pending_fixed !== undefined
        const fixedKey = `fixed:${Math.floor((saved.state.pending_fixed ?? stamp) / 60)}`
        if (fixed ? (saved.state.delivered ?? []).includes(fixedKey) || stamp < (saved.state.retry_after ?? 0)
          || stamp - (saved.state.last_success ?? 0) < Math.min(300, decision.plan.configured_interval) : !decision.plan.due) continue
        saved.state.retry_after = stamp + 180
        await this.#save() // reserve before capture/upload
        let serverDelay = 0
        try {
          this.#setPhase('capturing-and-delivering')
          const result = await this.deps.execute(schedule)
          if (result.webhook?.statusCode === 429 || result.webhook?.statusCode === 503) {
            serverDelay = Math.min(Math.max((result.webhook.retryAfterMs ?? 300000) / 1000, 0), 86400)
          }
          if (!result.success || !result.webhook?.attempted || !result.webhook.success) throw new Error()
          saved.state.last_success = this.deps.now().getTime() / 1000
          saved.state.failures = 0; saved.state.retry_after = 0
          saved.state.last_delivery_reason = fixed ? 'fixed' : decision.plan.reason
          saved.state.last_delivery_target = fixed ? saved.state.pending_fixed! : decision.plan.target
          delete saved.state.pending_fixed
          saved.state.delivered = [...(saved.state.delivered ?? []), fixed ? fixedKey : decision.plan.key].slice(-32)
        } catch {
          saved.state.failures = Math.min((saved.state.failures ?? 0) + 1, 8)
          saved.state.retry_after = stamp + Math.max(Math.min(60 * 2 ** saved.state.failures, 900), serverDelay)
        }
        this.#setPhase('saving-state')
        await this.#save()
        this.#status[config.schedule_id] = { ...this.#status[config.schedule_id], last_success: saved.state.last_success ?? null,
          last_delivery_reason: saved.state.last_delivery_reason ?? null, last_delivery_target: saved.state.last_delivery_target ?? null,
          failures: saved.state.failures ?? 0, retry_after: saved.state.retry_after ?? 0 }
      }
    } catch {
      // Persistence/load failures fail closed; no upload without a saved reservation.
      for (const c of this.configs) this.#status[c.schedule_id] = { ready: false, error: 'Refresh worker unavailable' }
    } finally {
      this.#lastCompleted = this.deps.now().getTime()
      this.#cycleStarted = null
      this.#setPhase('idle')
      this.#busy = false
      const queued = this.#fixedQueue.values().next().value as string | undefined
      if (queued) await this.tick(queued)
    }
  }
}
