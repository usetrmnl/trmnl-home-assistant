/**
 * Home Assistant persistent notifications.
 *
 * The scheduler's failures are otherwise only visible in the add-on log, which
 * nobody reads until screens have been stale for a day.
 *
 * @module lib/ha-notify
 */

import { hassToken, hassUrl } from '../const.js'
import { schedulerLogger } from './logger.js'
import type { Schedule } from '../types/domain.js'

const log = schedulerLogger()

/** Where to post, defaulting to the configured Home Assistant */
export interface HaTarget {
  url?: string
  token?: string
}

/**
 * Tells the user a BYOS schedule needs signing in again.
 *
 * Reuses one notification id per schedule so a daily expiry replaces its own
 * notice instead of stacking up. Never throws - a failed notification must not
 * take the scheduler tick with it.
 */
export async function notifyReauthRequired(
  schedule: Pick<Schedule, 'id' | 'name'>,
  { url = hassUrl, token = hassToken }: HaTarget = {},
): Promise<void> {
  if (!token) return

  try {
    const response = await fetch(
      `${url}/api/services/persistent_notification/create`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'TRMNL: sign in to your BYOS server',
          message:
            `The saved session for "${schedule.name}" expired, so screens are no longer being sent. ` +
            'Open the TRMNL add-on, pick the schedule and authenticate again. ' +
            'Ticking "stay signed in" lets the add-on recover from this on its own.',
          notification_id: `trmnl_byos_reauth_${schedule.id}`,
        }),
      },
    )

    if (!response.ok) {
      log.warn`Could not notify Home Assistant of the expired BYOS session: HTTP ${response.status}`
    }
  } catch (err) {
    log.warn`Could not notify Home Assistant of the expired BYOS session: ${(err as Error).message}`
  }
}
