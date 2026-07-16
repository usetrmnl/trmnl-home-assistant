/**
 * Schedule Helper Utilities
 *
 * Utilities for creating and managing test schedules with fast cron expressions
 * @module tests/helpers/schedule-helper
 */

import fs from 'node:fs'

/** Schedule input for testing */
interface TestScheduleInput {
  name?: string
  dashboard_path?: string
  viewport?: string
  enabled?: boolean
  cron?: string
  format?: string
  zoom?: number
  wait?: number
  invert?: boolean
  dark?: boolean
  webhook_url?: string | null
  webhook_headers?: Record<string, string>
  dithering?: {
    enabled: boolean
    method?: string
    palette?: string
  }
}

/** Full test schedule object */
interface TestSchedule extends TestScheduleInput {
  name: string
  dashboard_path: string
  viewport: string
  enabled: boolean
  cron: string
  format: string
  zoom: number
  wait: number
  invert: boolean
  dark: boolean
  webhook_url: string | null
  webhook_headers: Record<string, string>
  dithering: {
    enabled: boolean
    method?: string
    palette?: string
  }
}

/**
 * Creates a test schedule with sensible defaults
 */
export function createTestSchedule(overrides: TestScheduleInput = {}): TestSchedule {
  const defaults: TestSchedule = {
    name: 'Test Schedule',
    dashboard_path: '/lovelace/0',
    viewport: '800x480',
    enabled: true,
    cron: '*/5 * * * * *', // Every 5 seconds by default
    format: 'png',
    zoom: 1,
    wait: 0,
    invert: false,
    dark: false,
    webhook_url: null,
    webhook_headers: {},
    dithering: {
      enabled: false,
    },
  }

  return { ...defaults, ...overrides }
}

/**
 * Creates a schedule with webhook configuration
 */
export function createWebhookSchedule(
  webhookUrl: string,
  headers: Record<string, string> = {}
): TestSchedule {
  return createTestSchedule({
    name: 'Webhook Test',
    webhook_url: webhookUrl,
    webhook_headers: headers,
  })
}

/**
 * Cleanup a schedule file if it exists
 */
export function cleanupScheduleFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}
