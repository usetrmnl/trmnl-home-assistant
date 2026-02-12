/**
 * Tests for Schedule Store CRUD operations.
 *
 * Uses temp files (passed via filePath overload) so no module mocking is needed.
 * Each test gets a fresh file path to prevent cross-test contamination.
 *
 * @see lib/scheduleStore.ts
 * @module tests/unit/schedule-store
 */

import { describe, it, expect, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  loadSchedules,
  saveSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from '../../lib/scheduleStore.js'
import type { Schedule, ScheduleInput } from '../../types/domain.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpFiles: string[] = []

function tmpFile(): string {
  const file = path.join(
    os.tmpdir(),
    `trmnl-test-schedules-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  )
  tmpFiles.push(file)
  return file
}

/** Minimal valid ScheduleInput for testing */
function buildScheduleInput(
  overrides: Partial<ScheduleInput> = {},
): ScheduleInput {
  return {
    name: 'Test Schedule',
    enabled: true,
    cron: '*/5 * * * *',
    webhook_url: null,
    ha_mode: true,
    dashboard_path: '/lovelace/0',
    viewport: { width: 800, height: 480 },
    crop: { enabled: false, x: 0, y: 0, width: 800, height: 480 },
    format: 'png',
    rotate: null,
    zoom: 1,
    wait: null,
    theme: null,
    lang: null,
    dark: false,
    invert: false,
    dithering: {
      enabled: true,
      method: 'floyd-steinberg',
      palette: 'bw',
      gammaCorrection: true,
      blackLevel: 0,
      whiteLevel: 100,
      normalize: true,
      saturationBoost: false,
    },
    ...overrides,
  }
}

// Clean up temp files after all tests
afterAll(async () => {
  await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => {})))
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduleStore', () => {
  // -------------------------------------------------------------------------
  // loadSchedules
  // -------------------------------------------------------------------------

  describe('#loadSchedules', () => {
    it('returns empty array when file does not exist', async () => {
      const result = await loadSchedules('/tmp/nonexistent-file.json')

      expect(result).toEqual([])
    })

    it('returns empty array when file contains invalid JSON', async () => {
      const file = tmpFile()
      await fs.writeFile(file, 'not valid json {{{')

      const result = await loadSchedules(file)

      expect(result).toEqual([])
    })

    it('loads schedules from valid JSON file', async () => {
      const file = tmpFile()
      const schedules = [{ id: 'test-1', name: 'Schedule 1', ha_mode: true }]
      await fs.writeFile(file, JSON.stringify(schedules))

      const result = await loadSchedules(file)

      expect(result[0]!.id).toBe('test-1')
    })

    it('migrates ha_mode to true when target_url is absent', async () => {
      const file = tmpFile()
      // Legacy schedule without ha_mode field
      await fs.writeFile(file, JSON.stringify([{ id: 's1', name: 'Old' }]))

      const result = await loadSchedules(file)

      expect(result[0]!.ha_mode).toBe(true)
    })

    it('migrates ha_mode to false when target_url is set', async () => {
      const file = tmpFile()
      await fs.writeFile(
        file,
        JSON.stringify([{ id: 's1', target_url: 'https://example.com' }]),
      )

      const result = await loadSchedules(file)

      expect(result[0]!.ha_mode).toBe(false)
    })

    it('migrates dithering.normalize to true when missing', async () => {
      const file = tmpFile()
      await fs.writeFile(
        file,
        JSON.stringify([
          {
            id: 's1',
            dithering: { enabled: true, method: 'floyd-steinberg' },
          },
        ]),
      )

      const result = await loadSchedules(file)
      const dithering = result[0]!.dithering as { normalize: boolean }

      expect(dithering.normalize).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // saveSchedules
  // -------------------------------------------------------------------------

  describe('#saveSchedules', () => {
    it('writes schedules as formatted JSON', async () => {
      const file = tmpFile()
      const schedules = [{ id: 's1', name: 'Test' }] as Schedule[]

      await saveSchedules(file, schedules)

      const content = await fs.readFile(file, 'utf-8')
      expect(JSON.parse(content)).toEqual(schedules)
    })

    it('formats JSON with 2-space indentation', async () => {
      const file = tmpFile()
      await saveSchedules(file, [{ id: 's1' }] as Schedule[])

      const content = await fs.readFile(file, 'utf-8')

      expect(content).toContain('  "id"')
    })
  })

  // -------------------------------------------------------------------------
  // getSchedule
  // -------------------------------------------------------------------------

  describe('#getSchedule', () => {
    it('returns schedule when found by id', async () => {
      const file = tmpFile()
      await fs.writeFile(
        file,
        JSON.stringify([
          { id: 'alpha', name: 'Alpha' },
          { id: 'beta', name: 'Beta' },
        ]),
      )

      const result = await getSchedule(file, 'beta')

      expect(result!.name).toBe('Beta')
    })

    it('returns null when id not found', async () => {
      const file = tmpFile()
      await fs.writeFile(file, JSON.stringify([{ id: 'alpha' }]))

      const result = await getSchedule(file, 'nonexistent')

      expect(result).toBeNull()
    })

    it('returns null when file is empty', async () => {
      const result = await getSchedule('/tmp/no-such-file.json', 'any')

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // createSchedule
  // -------------------------------------------------------------------------

  describe('#createSchedule', () => {
    it('assigns a generated id', async () => {
      const file = tmpFile()
      await fs.writeFile(file, '[]')

      const result = await createSchedule(file, buildScheduleInput())

      expect(result.id).toMatch(/^schedule_\d+_[a-z0-9]+$/)
    })

    it('sets createdAt timestamp', async () => {
      const file = tmpFile()
      await fs.writeFile(file, '[]')
      const before = new Date().toISOString()

      const result = await createSchedule(file, buildScheduleInput())

      expect(result.createdAt >= before).toBe(true)
    })

    it('sets updatedAt timestamp', async () => {
      const file = tmpFile()
      await fs.writeFile(file, '[]')

      const result = await createSchedule(file, buildScheduleInput())

      expect(result.updatedAt).toBeDefined()
    })

    it('persists schedule to file', async () => {
      const file = tmpFile()
      await fs.writeFile(file, '[]')

      const created = await createSchedule(
        file,
        buildScheduleInput({ name: 'Persisted' }),
      )
      const loaded = await loadSchedules(file)

      expect(loaded.find((s) => s.id === created.id)!.name).toBe('Persisted')
    })

    it('appends to existing schedules', async () => {
      const file = tmpFile()
      await fs.writeFile(
        file,
        JSON.stringify([{ id: 'existing', name: 'First' }]),
      )

      await createSchedule(file, buildScheduleInput({ name: 'Second' }))
      const loaded = await loadSchedules(file)

      expect(loaded.length).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // updateSchedule
  // -------------------------------------------------------------------------

  describe('#updateSchedule', () => {
    it('updates specified fields', async () => {
      const file = tmpFile()
      await fs.writeFile(
        file,
        JSON.stringify([{ id: 'u1', name: 'Original', enabled: true }]),
      )

      const result = await updateSchedule(file, 'u1', { name: 'Updated' })

      expect(result!.name).toBe('Updated')
    })

    it('preserves fields not included in update', async () => {
      const file = tmpFile()
      await fs.writeFile(
        file,
        JSON.stringify([{ id: 'u1', name: 'Original', enabled: true }]),
      )

      const result = await updateSchedule(file, 'u1', { name: 'Changed' })

      expect((result as Schedule & { enabled: boolean }).enabled).toBe(true)
    })

    it('updates the updatedAt timestamp', async () => {
      const file = tmpFile()
      const oldDate = '2020-01-01T00:00:00.000Z'
      await fs.writeFile(
        file,
        JSON.stringify([{ id: 'u1', updatedAt: oldDate }]),
      )

      const result = await updateSchedule(file, 'u1', { name: 'New' })

      expect(result!.updatedAt > oldDate).toBe(true)
    })

    it('returns null when id not found', async () => {
      const file = tmpFile()
      await fs.writeFile(file, JSON.stringify([{ id: 'u1' }]))

      const result = await updateSchedule(file, 'missing', { name: 'X' })

      expect(result).toBeNull()
    })

    it('persists changes to file', async () => {
      const file = tmpFile()
      await fs.writeFile(file, JSON.stringify([{ id: 'u1', name: 'Before' }]))

      await updateSchedule(file, 'u1', { name: 'After' })
      const loaded = await loadSchedules(file)

      expect(loaded[0]!.name).toBe('After')
    })
  })

  // -------------------------------------------------------------------------
  // deleteSchedule
  // -------------------------------------------------------------------------

  describe('#deleteSchedule', () => {
    it('returns true when schedule is deleted', async () => {
      const file = tmpFile()
      await fs.writeFile(file, JSON.stringify([{ id: 'd1' }]))

      const result = await deleteSchedule(file, 'd1')

      expect(result).toBe(true)
    })

    it('returns false when id not found', async () => {
      const file = tmpFile()
      await fs.writeFile(file, JSON.stringify([{ id: 'd1' }]))

      const result = await deleteSchedule(file, 'nonexistent')

      expect(result).toBe(false)
    })

    it('removes schedule from file', async () => {
      const file = tmpFile()
      await fs.writeFile(file, JSON.stringify([{ id: 'd1' }, { id: 'd2' }]))

      await deleteSchedule(file, 'd1')
      const loaded = await loadSchedules(file)

      expect(loaded.length).toBe(1)
      expect(loaded[0]!.id).toBe('d2')
    })

    it('leaves other schedules intact', async () => {
      const file = tmpFile()
      await fs.writeFile(
        file,
        JSON.stringify([
          { id: 'keep-1', name: 'Keep' },
          { id: 'remove', name: 'Remove' },
          { id: 'keep-2', name: 'Also Keep' },
        ]),
      )

      await deleteSchedule(file, 'remove')
      const loaded = await loadSchedules(file)
      const ids = loaded.map((s) => s.id)

      expect(ids).toEqual(['keep-1', 'keep-2'])
    })
  })

  // -------------------------------------------------------------------------
  // Concurrent access (withLock serialization)
  // -------------------------------------------------------------------------

  describe('concurrent access', () => {
    it('serializes concurrent creates without data loss', async () => {
      const file = tmpFile()
      await fs.writeFile(file, '[]')

      // Fire 5 concurrent creates
      const promises = Array.from({ length: 5 }, (_, i) =>
        createSchedule(file, buildScheduleInput({ name: `Concurrent-${i}` })),
      )

      await Promise.all(promises)
      const loaded = await loadSchedules(file)

      expect(loaded.length).toBe(5)
    })
  })
})
