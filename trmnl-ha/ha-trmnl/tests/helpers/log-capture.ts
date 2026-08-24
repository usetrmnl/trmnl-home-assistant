/**
 * Captures LogTape output so tests can assert on what was logged.
 *
 * The app only configures LogTape from initializeLogging(), which tests never
 * call, so log calls reach nothing and a console spy silently records zero
 * entries. Anything asserting on a log line has to configure a sink first.
 *
 * @module tests/helpers/log-capture
 */

import { configure, reset, type LogRecord } from '@logtape/logtape'

/** One captured log line, flattened for easy assertions. */
export interface CapturedLog {
  level: string
  category: string
  message: string
}

/** A running capture. Call stop() to restore the previous configuration. */
export interface LogCapture {
  entries: CapturedLog[]
  /** Messages at one level, in order. */
  messagesAt(level: string): string[]
  /** Whether any captured message contains the given text. */
  contains(text: string, level?: string): boolean
  stop(): Promise<void>
}

/** Joins LogTape's alternating template/value array back into a string. */
function flatten(message: readonly unknown[]): string {
  return message.map((part) => String(part)).join('')
}

/**
 * Routes every ha-trmnl log record into an array for the duration of a test.
 *
 * @param lowestLevel - Quietest level to capture (defaults to every level)
 */
export async function captureLogs(
  lowestLevel: 'trace' | 'debug' | 'info' | 'warning' | 'error' = 'trace',
): Promise<LogCapture> {
  const entries: CapturedLog[] = []

  await configure({
    reset: true,
    sinks: {
      memory: (record: LogRecord) => {
        entries.push({
          level: record.level,
          category: record.category.join('.'),
          message: flatten(record.message),
        })
      },
    },
    loggers: [
      { category: ['ha-trmnl'], lowestLevel, sinks: ['memory'] },
      { category: ['logtape', 'meta'], lowestLevel: 'error', sinks: [] },
    ],
  })

  return {
    entries,
    messagesAt: (level) =>
      entries.filter((e) => e.level === level).map((e) => e.message),
    contains: (text, level) =>
      entries.some(
        (e) => e.message.includes(text) && (!level || e.level === level),
      ),
    stop: async () => {
      await reset()
    },
  }
}
