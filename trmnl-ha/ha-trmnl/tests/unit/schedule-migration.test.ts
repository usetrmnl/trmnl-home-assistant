/**
 * Migration of legacy cron schedules to interval_minutes, exercised through
 * loadSchedules (which runs migrateSchedule on read).
 *
 * @module tests/unit/schedule-migration
 */

import { describe, it, expect, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadSchedules } from '../../lib/scheduleStore.js'

const tmpFiles: string[] = []

async function writeSchedules(raw: unknown): Promise<string> {
  const file = path.join(
    os.tmpdir(),
    `trmnl-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  )
  tmpFiles.push(file)
  await fs.writeFile(file, JSON.stringify(raw), 'utf-8')
  return file
}

afterAll(async () => {
  await Promise.all(tmpFiles.map((f) => fs.rm(f, { force: true })))
})

describe('migrateSchedule (via loadSchedules)', () => {
  it('derives interval_minutes from a convertible cron', async () => {
    const file = await writeSchedules([{ id: '1', name: 'A', cron: '*/10 * * * *' }])
    const [schedule] = await loadSchedules(file)

    expect(schedule!.interval_minutes).toBe(10)
  })

  it('leaves interval_minutes null for a non-convertible cron', async () => {
    const file = await writeSchedules([{ id: '1', name: 'A', cron: '0 9 * * 1-5' }])
    const [schedule] = await loadSchedules(file)

    expect(schedule!.interval_minutes).toBeNull()
  })

  it('keeps an explicit interval_minutes', async () => {
    const file = await writeSchedules([
      { id: '1', name: 'A', cron: '*/10 * * * *', interval_minutes: 180 },
    ])
    const [schedule] = await loadSchedules(file)

    expect(schedule!.interval_minutes).toBe(180)
  })

  it('respects an explicit null even when the cron is convertible', async () => {
    const file = await writeSchedules([
      { id: '1', name: 'A', cron: '*/10 * * * *', interval_minutes: null },
    ])
    const [schedule] = await loadSchedules(file)

    expect(schedule!.interval_minutes).toBeNull()
  })
})
