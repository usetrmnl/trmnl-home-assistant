/**
 * Schedule fixtures for unit tests.
 *
 * @module tests/helpers/schedule-fixtures
 */

import type { Schedule } from '../../types/domain.js'

/** Builds a minimal valid Schedule */
export function buildSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'schedule-1',
    name: 'Test Schedule',
    enabled: true,
    cron: '* * * * *',
    dashboard_path: '/lovelace/0',
    viewport: { width: 800, height: 480 },
    format: 'png',
    ...overrides,
  } as Schedule
}

/** Builds a Schedule configured for BYOS webhook delivery (URI mode) */
export function buildByosSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return buildSchedule({
    webhook_url: 'https://byos.example.com/api/screens',
    webhook_format: {
      format: 'byos-hanami',
      byosConfig: {
        model_id: '1',
        name: 'trmnl_screen',
        label: 'TRMNL Screen',
        preprocessed: true,
        addon_base_url: 'http://192.168.1.10:10000/',
        delivery_mode: 'uri',
        auth: {
          enabled: true,
          access_token: 'token',
          refresh_token: 'refresh',
          obtained_at: Date.now(),
        },
      },
    },
    ...overrides,
  })
}
