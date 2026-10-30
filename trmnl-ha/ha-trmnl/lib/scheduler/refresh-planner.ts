/** Pure, configurable planning from observed hardware pings. Never invents pings.
 * @module lib/scheduler/refresh-planner
 */
export interface RefreshConfig {
  schedule_id: string
  device_id: number
  lead_seconds: number
  fallback_interval_seconds: number
  initial_intervals_seconds: number[]
}
export interface DeviceTiming {
  refresh_interval?: number
  hardware_last_ping_at?: string
  sleep_mode_enabled?: boolean
  sleep_start_time?: number
  sleep_end_time?: number
  sleep_until?: string | null
}
export interface RefreshState {
  pending_fixed?: number
  ping?: number
  configured_interval?: number
  latched_interval?: number
  uncertain_anchor?: number
  delivered?: string[]
  last_success?: number
  retry_after?: number
  failures?: number
  last_delivery_reason?: string
  last_delivery_target?: number
}
export interface RefreshPlan {
  due: boolean
  reason: string
  key: string
  target: number
  capture_at: number
  hardware_last_ping: number | null
  configured_interval: number
  candidate_intervals: number[]
  stale_ping: boolean
}
/** Reject invalid configuration before starting a worker; never include input in errors. */
export function validateRefreshConfigs(configs: RefreshConfig[]): void {
  if (!Array.isArray(configs)) throw new Error('Invalid refresh scheduling configuration')
  const seen = new Set<string>()
  for (const c of configs) {
    if (!c || typeof c.schedule_id !== 'string' || !c.schedule_id || seen.has(c.schedule_id)
      || !Number.isSafeInteger(c.device_id) || c.device_id <= 0
      || !Number.isInteger(c.lead_seconds) || c.lead_seconds < 60 || c.lead_seconds > 600
      || !validInterval(c.fallback_interval_seconds)
      || !Array.isArray(c.initial_intervals_seconds) || c.initial_intervals_seconds.length > 8
      || c.initial_intervals_seconds.some(v => !validInterval(v))) {
      throw new Error('Invalid refresh scheduling configuration')
    }
    seen.add(c.schedule_id)
  }
}
function validInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 60 && value <= 86400
}
function validMinute(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440
}
/** Calendar boundaries use the configured process timezone, including DST. */
function nextMinute(now: Date, minute: number): Date {
  const next = new Date(now)
  next.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next
}
/** Returns a new state and allowlisted decision. All timestamp arithmetic uses seconds. */
export function planRefresh(now: Date, device: DeviceTiming | null, saved: RefreshState, config: RefreshConfig): { plan: RefreshPlan; state: RefreshState } {
  const state = { ...saved }
  const stamp = now.getTime() / 1000
  const interval = validInterval(device?.refresh_interval) ? device.refresh_interval
    : state.configured_interval ?? config.fallback_interval_seconds
  state.configured_interval = interval
  const ping = device?.hardware_last_ping_at ? Date.parse(device.hardware_last_ping_at) / 1000 : NaN
  if (Number.isFinite(ping) && ping > 0 && ping <= stamp + 60 && ping > (state.ping ?? 0)) {
    state.ping = ping
    state.latched_interval = interval
    state.delivered = (state.delivered ?? []).filter(key => !key.startsWith('ping:'))
    delete state.uncertain_anchor
    if (!saved.ping) state.uncertain_anchor = ping
  }
  const anchor = state.ping
  const rates = new Set([interval, state.latched_interval ?? interval])
  if (anchor && state.uncertain_anchor === anchor) config.initial_intervals_seconds.forEach(v => rates.add(v))
  const sleeping = device?.sleep_mode_enabled === true
    && validMinute(device.sleep_start_time) && validMinute(device.sleep_end_time)
    && device.sleep_start_time !== device.sleep_end_time
  const awakeAt = (target: number): boolean => {
    if (device?.sleep_until && Date.parse(device.sleep_until) > target * 1000) return false
    if (!sleeping) return true
    const at = new Date(target * 1000)
    const minute = at.getHours() * 60 + at.getMinutes()
    const start = device!.sleep_start_time!, end = device!.sleep_end_time!
    return start > end ? minute >= end && minute < start : minute < start || minute >= end
  }
  const candidates: { target: number; key: string; reason: string }[] = []
  if (sleeping) {
    const wake = nextMinute(now, device!.sleep_end_time!)
    if (awakeAt(wake.getTime() / 1000)) candidates.push({ target: wake.getTime() / 1000, key: `wake:${wake.getTime()}`, reason: 'wake' })
  }
  if (anchor) for (const rate of rates) {
    const target = anchor + rate
    if (target > stamp && awakeAt(target)) candidates.push({ target, key: `ping:${anchor}:${rate}`, reason: 'predicted' })
  }
  const delivered = state.delivered ?? []
  const pending = candidates.filter(c => !delivered.includes(c.key)).sort((a, b) => a.target - b.target)
  const candidate = pending[0] ?? { target: stamp + interval, key: 'waiting', reason: 'waiting' }
  let { target, key, reason } = candidate
  const lead = Math.min(config.lead_seconds, Math.floor(interval / 2))
  let due = key !== 'waiting' && target - lead <= stamp && target > stamp
  const stale = !anchor || stamp > anchor + Math.max(...rates) + 120
  if (stale && awakeAt(stamp) && !due && stamp - (state.last_success ?? 0) >= interval) {
    target = stamp; key = `fallback:${Math.floor(stamp / interval)}`; reason = 'stale_fallback'; due = true
  }
  if (stamp - (state.last_success ?? 0) < Math.min(300, interval) || stamp < (state.retry_after ?? 0)) due = false
  return { plan: { due, reason, key, target, capture_at: target - lead,
    hardware_last_ping: anchor ?? null, configured_interval: interval,
    candidate_intervals: [...rates].sort((a,b) => a-b), stale_ping: stale }, state }
}
