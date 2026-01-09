/**
 * Schedule Manager Module
 *
 * Business logic layer managing schedule state and CRUD operations.
 *
 * @module html/js/schedule-manager
 */

import {
  LoadSchedules,
  CreateSchedule,
  UpdateSchedule,
  DeleteSchedule,
} from './api-client.js'
import type {
  Schedule,
  ScheduleInput,
  ScheduleUpdate,
} from '../../types/domain.js'

/**
 * Schedule state manager coordinating CRUD operations and selection.
 */
export class ScheduleManager {
  #schedules: Schedule[] = []
  #activeScheduleId: string | null = null

  #loadSchedulesCmd: LoadSchedules
  #createScheduleCmd: CreateSchedule
  #updateScheduleCmd: UpdateSchedule
  #deleteScheduleCmd: DeleteSchedule

  constructor() {
    this.#loadSchedulesCmd = new LoadSchedules()
    this.#createScheduleCmd = new CreateSchedule()
    this.#updateScheduleCmd = new UpdateSchedule()
    this.#deleteScheduleCmd = new DeleteSchedule()
  }

  get schedules(): Schedule[] {
    return this.#schedules
  }

  get activeScheduleId(): string | null {
    return this.#activeScheduleId
  }

  get activeSchedule(): Schedule | undefined {
    return this.#schedules.find((s) => s.id === this.#activeScheduleId)
  }

  /**
   * Loads all schedules from API and updates local state.
   */
  async loadAll(): Promise<Schedule[]> {
    this.#schedules = await this.#loadSchedulesCmd.call()

    if (this.#schedules.length > 0 && !this.#activeScheduleId) {
      this.#activeScheduleId = this.#schedules[0]!.id
    }

    return this.#schedules
  }

  /**
   * Selects a schedule by ID.
   */
  selectSchedule(id: string): Schedule | null {
    const schedule = this.#schedules.find((s) => s.id === id)
    if (schedule) {
      this.#activeScheduleId = id
      return schedule
    }
    return null
  }

  /**
   * Creates new schedule with sensible defaults.
   */
  async create(): Promise<Schedule> {
    // @ts-expect-error window.uiConfig is injected by server
    const uiConfig = window.uiConfig || { haConnected: false }

    const defaultSchedule: ScheduleInput = {
      name: 'New Schedule',
      enabled: true,
      cron: '*/10 * * * *',
      ha_mode: uiConfig.haConnected, // Default to HA mode if connected
      dashboard_path: '/home',
      viewport: { width: 800, height: 480 },
      webhook_url: '',
      format: 'png',
      rotate: null,
      zoom: 1,
      wait: null,
      theme: null,
      lang: null,
      dark: false,
      invert: false,
      crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
      dithering: {
        enabled: true,
        method: 'floyd-steinberg',
        palette: 'gray-4',
        gammaCorrection: true,
        blackLevel: 0,
        whiteLevel: 100,
        normalize: true, // Enabled by default to prevent gray/washed-out output (issue #9)
        saturationBoost: false,
      },
    }

    const created = await this.#createScheduleCmd.call(defaultSchedule)
    this.#schedules.push(created)
    this.#activeScheduleId = created.id

    return created
  }

  /**
   * Updates existing schedule with partial changes.
   */
  async update(id: string, updates: ScheduleUpdate): Promise<Schedule> {
    const updated = await this.#updateScheduleCmd.call(id, updates)

    const index = this.#schedules.findIndex((s) => s.id === id)
    if (index !== -1) {
      this.#schedules[index] = updated
    }

    return updated
  }

  /**
   * Deletes schedule and updates selection state.
   */
  async delete(id: string): Promise<string | null> {
    await this.#deleteScheduleCmd.call(id)

    this.#schedules = this.#schedules.filter((s) => s.id !== id)

    if (this.#activeScheduleId === id) {
      this.#activeScheduleId =
        this.#schedules.length > 0 ? this.#schedules[0]!.id : null
    }

    return this.#activeScheduleId
  }

  /**
   * Checks if schedule collection is empty.
   */
  isEmpty(): boolean {
    return this.#schedules.length === 0
  }
}
