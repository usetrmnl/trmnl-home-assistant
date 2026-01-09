/**
 * Schedule Store Module
 *
 * Manages schedule persistence to JSON file using async I/O.
 * Uses per-file mutex to prevent race conditions on concurrent writes.
 *
 * @module scheduleStore
 */

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Schedule,
  ScheduleInput,
  ScheduleUpdate,
} from '../types/domain.js'
import { schedulerLogger } from './logger.js'

const log = schedulerLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// =============================================================================
// FILE LOCKING (prevents race conditions on concurrent writes)
// =============================================================================

/** Pending operation chains per file path */
const fileLocks = new Map<string, Promise<unknown>>()

/**
 * Executes operation with exclusive file access.
 * Chains operations - each waits for all prior operations to complete.
 *
 * NOTE: This is a proper mutex using promise chaining. Each new operation
 * extends the chain atomically, ensuring serial execution order.
 */
async function withLock<T>(
  filePath: string,
  operation: () => Promise<T>
): Promise<T> {
  // Get current chain and immediately extend it with our operation
  // This is atomic - no await between get and set
  const previousOperation = fileLocks.get(filePath) ?? Promise.resolve()

  // Create the chained operation that waits for previous, then runs ours
  const chainedOperation = previousOperation
    .catch(() => {}) // Don't let previous failures block us
    .then(operation)

  // Register our operation as the new tail of the chain
  fileLocks.set(filePath, chainedOperation)

  try {
    return await chainedOperation
  } finally {
    // Cleanup if we're still the tail
    if (fileLocks.get(filePath) === chainedOperation) {
      fileLocks.delete(filePath)
    }
  }
}

// NOTE: existsSync is used at startup only (sync is fine for config detection)
const isAddOn = existsSync('/data/options.json')
const DEFAULT_SCHEDULES_FILE = isAddOn
  ? '/data/schedules.json'
  : path.join(__dirname, '..', 'data', 'schedules.json')

/**
 * Check if file exists (async)
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Migrates schedule data to add any missing fields with defaults.
 * Ensures backward compatibility when new fields are added.
 */
function migrateSchedule(schedule: Partial<Schedule>): Schedule {
  // Migrate dithering.normalize to true for existing schedules (issue #9)
  // This ensures the UI checkbox matches the backend default behavior
  // NOTE: dithering can be a boolean (legacy) or an object (current format)
  const dithering =
    schedule.dithering && typeof schedule.dithering === 'object'
      ? {
          ...schedule.dithering,
          normalize: schedule.dithering.normalize ?? true,
        }
      : schedule.dithering

  return {
    ...schedule,
    // Default ha_mode based on whether target_url is set (for existing schedules)
    ha_mode: schedule.ha_mode ?? !schedule.target_url,
    dithering,
  } as Schedule
}

/**
 * Load schedules from JSON file
 */
export async function loadSchedules(
  filePath: string = DEFAULT_SCHEDULES_FILE
): Promise<Schedule[]> {
  try {
    if (await fileExists(filePath)) {
      const data = await fs.readFile(filePath, 'utf-8')
      const schedules = JSON.parse(data) as Partial<Schedule>[]
      // Migrate any schedules missing new fields
      return schedules.map(migrateSchedule)
    }
  } catch (err) {
    log.error`Error loading schedules: ${err}`
  }
  return []
}

/**
 * Save schedules to JSON file
 */
export async function saveSchedules(
  filePath: string,
  schedules: Schedule[]
): Promise<void>
export async function saveSchedules(schedules: Schedule[]): Promise<void>
export async function saveSchedules(
  filePathOrSchedules: string | Schedule[],
  schedules?: Schedule[]
): Promise<void> {
  const filePath =
    typeof filePathOrSchedules === 'string'
      ? filePathOrSchedules
      : DEFAULT_SCHEDULES_FILE
  const data =
    typeof filePathOrSchedules === 'string' ? schedules! : filePathOrSchedules

  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2))
  } catch (err) {
    log.error`Error saving schedules: ${err}`
    throw err
  }
}

/**
 * Get a schedule by ID
 */
export async function getSchedule(
  filePath: string,
  id: string
): Promise<Schedule | null>
export async function getSchedule(id: string): Promise<Schedule | null>
export async function getSchedule(
  filePathOrId: string,
  id?: string
): Promise<Schedule | null> {
  const filePath =
    typeof id === 'string' ? filePathOrId : DEFAULT_SCHEDULES_FILE
  const scheduleId = typeof id === 'string' ? id : filePathOrId

  const schedules = await loadSchedules(filePath)
  return schedules.find((s) => s.id === scheduleId) ?? null
}

/**
 * Create a new schedule
 */
export async function createSchedule(
  filePath: string,
  schedule: ScheduleInput
): Promise<Schedule>
export async function createSchedule(schedule: ScheduleInput): Promise<Schedule>
export async function createSchedule(
  filePathOrSchedule: string | ScheduleInput,
  schedule?: ScheduleInput
): Promise<Schedule> {
  const filePath =
    typeof filePathOrSchedule === 'string'
      ? filePathOrSchedule
      : DEFAULT_SCHEDULES_FILE
  const data =
    typeof filePathOrSchedule === 'string' ? schedule! : filePathOrSchedule

  return withLock(filePath, async () => {
    const schedules = await loadSchedules(filePath)
    const newSchedule: Schedule = migrateSchedule({
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    schedules.push(newSchedule)
    await saveSchedules(filePath, schedules)
    return newSchedule
  })
}

/**
 * Update an existing schedule
 */
export async function updateSchedule(
  filePath: string,
  id: string,
  updates: ScheduleUpdate
): Promise<Schedule | null>
export async function updateSchedule(
  id: string,
  updates: ScheduleUpdate
): Promise<Schedule | null>
export async function updateSchedule(
  filePathOrId: string,
  idOrUpdates: string | ScheduleUpdate,
  updates?: ScheduleUpdate
): Promise<Schedule | null> {
  const filePath =
    typeof updates !== 'undefined' ? filePathOrId : DEFAULT_SCHEDULES_FILE
  const id =
    typeof updates !== 'undefined' ? (idOrUpdates as string) : filePathOrId
  const data =
    typeof updates !== 'undefined' ? updates : (idOrUpdates as ScheduleUpdate)

  return withLock(filePath, async () => {
    const schedules = await loadSchedules(filePath)
    const index = schedules.findIndex((s) => s.id === id)
    if (index === -1) {
      return null
    }
    // NOTE: Original schedule has all required fields, update only overrides some
    const updatedSchedule = {
      ...schedules[index],
      ...data,
      id,
      updatedAt: new Date().toISOString(),
    } as Schedule
    schedules[index] = updatedSchedule
    await saveSchedules(filePath, schedules)
    return updatedSchedule
  })
}

/**
 * Delete a schedule
 */
export async function deleteSchedule(
  filePath: string,
  id: string
): Promise<boolean>
export async function deleteSchedule(id: string): Promise<boolean>
export async function deleteSchedule(
  filePathOrId: string,
  id?: string
): Promise<boolean> {
  const filePath =
    typeof id === 'string' ? filePathOrId : DEFAULT_SCHEDULES_FILE
  const scheduleId = typeof id === 'string' ? id : filePathOrId

  return withLock(filePath, async () => {
    const schedules = await loadSchedules(filePath)
    const index = schedules.findIndex((s) => s.id === scheduleId)
    if (index === -1) {
      return false
    }
    schedules.splice(index, 1)
    await saveSchedules(filePath, schedules)
    return true
  })
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `schedule_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}
