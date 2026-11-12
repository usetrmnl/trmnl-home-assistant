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

/** Calls a persistent_notification service. Never throws - a failed notice must not take the scheduler tick with it. */
async function callNotificationService(
  service: 'create' | 'dismiss',
  payload: { notification_id: string; title?: string; message?: string },
  { url = hassUrl, token = hassToken }: HaTarget,
): Promise<void> {
  if (!token) return

  try {
    const response = await fetch(`${url}/api/services/persistent_notification/${service}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      log.warn`Could not ${service} Home Assistant notification ${payload.notification_id}: HTTP ${response.status}`
    }
  } catch (err) {
    log.warn`Could not ${service} Home Assistant notification ${payload.notification_id}: ${(err as Error).message}`
  }
}

/** Tells the user a BYOS schedule needs signing in again. Reuses one id per schedule so a daily expiry replaces its own notice. */
export async function notifyReauthRequired(
  schedule: Pick<Schedule, 'id' | 'name'>,
  target: HaTarget = {},
): Promise<void> {
  await callNotificationService('create', {
    title: 'TRMNL: sign in to your BYOS server',
    message:
      `The saved session for "${schedule.name}" expired, so screens are no longer being sent. ` +
      'Open the TRMNL add-on, pick the schedule and authenticate again. ' +
      'Ticking "stay signed in" lets the add-on recover from this on its own.',
    notification_id: `trmnl_byos_reauth_${schedule.id}`,
  }, target)
}

const uploadRefusedId = (schedule: Pick<Schedule, 'id'>): string => `trmnl_upload_refused_${schedule.id}`

/** Tells the user the server refused a schedule's image, with the server's own reason. */
export async function notifyUploadRefused(
  schedule: Pick<Schedule, 'id' | 'name'>,
  reason: string,
  target: HaTarget = {},
): Promise<void> {
  await callNotificationService('create', {
    title: 'TRMNL: screen not delivered',
    message: `The server refused the image for "${schedule.name}", so your device still shows an older screen.\n\n${reason}`,
    notification_id: uploadRefusedId(schedule),
  }, target)
}

/** Removes the refusal notice once the schedule delivers again. */
export async function clearUploadRefused(
  schedule: Pick<Schedule, 'id'>,
  target: HaTarget = {},
): Promise<void> {
  await callNotificationService('dismiss', { notification_id: uploadRefusedId(schedule) }, target)
}
