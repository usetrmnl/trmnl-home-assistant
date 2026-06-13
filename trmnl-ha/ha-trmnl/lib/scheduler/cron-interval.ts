/**
 * Converts the simple recurring cron forms to an interval in minutes. Used to
 * migrate existing cron schedules to the interval model; cron that targets
 * specific times or weekdays has no interval equivalent and stays cron-mode.
 *
 * @module lib/scheduler/cron-interval
 */

/**
 * @returns Interval in minutes for the simple recurring forms (every minute,
 * every N minutes, hourly, every N hours); null for any other or non-5-field
 * expression.
 */
export function cronToIntervalMinutes(cron: string): number | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') return null

  if (minute === '*' && hour === '*') return 1

  if (hour === '*') {
    if (minute === '0') return 60
    const everyN = /^\*\/(\d+)$/.exec(minute!)
    if (!everyN) return null
    const n = Number(everyN[1])
    return n >= 1 && n <= 59 ? n : null
  }

  if (minute !== '0') return null

  const everyHours = /^\*\/(\d+)$/.exec(hour!)
  if (!everyHours) return null
  const n = Number(everyHours[1])
  return n >= 1 && n <= 23 ? n * 60 : null
}
