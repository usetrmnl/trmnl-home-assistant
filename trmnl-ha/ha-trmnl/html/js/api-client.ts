/**
 * API Client Module
 *
 * Thin wrappers around fetch() API for backend communication.
 * Each class represents one API operation following Command Pattern.
 *
 * @module html/js/api-client
 */

import type {
  Schedule,
  ScheduleInput,
  ScheduleUpdate,
  PresetsConfig,
  SendScheduleResponse,
} from '../../types/domain.js'
import type { PaletteOption } from './palette-options.js'

/**
 * Fetches all schedules from the API
 */
export class LoadSchedules {
  baseUrl: string

  constructor(baseUrl = './api/schedules') {
    this.baseUrl = baseUrl
  }

  async call(): Promise<Schedule[]> {
    const response = await fetch(this.baseUrl)
    if (!response.ok) {
      throw new Error(`Failed to load schedules: ${response.statusText}`)
    }
    return response.json()
  }
}

/**
 * Creates a new schedule
 */
export class CreateSchedule {
  baseUrl: string

  constructor(baseUrl = './api/schedules') {
    this.baseUrl = baseUrl
  }

  async call(schedule: ScheduleInput): Promise<Schedule> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedule),
    })

    if (!response.ok) {
      throw new Error(`Failed to create schedule: ${response.statusText}`)
    }

    return response.json()
  }
}

/**
 * Updates an existing schedule
 */
export class UpdateSchedule {
  baseUrl: string

  constructor(baseUrl = './api/schedules') {
    this.baseUrl = baseUrl
  }

  async call(id: string, updates: ScheduleUpdate): Promise<Schedule> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    if (!response.ok) {
      throw new Error(`Failed to update schedule: ${response.statusText}`)
    }

    return response.json()
  }
}

/**
 * Deletes a schedule
 */
export class DeleteSchedule {
  baseUrl: string

  constructor(baseUrl = './api/schedules') {
    this.baseUrl = baseUrl
  }

  async call(id: string): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to delete schedule: ${response.statusText}`)
    }

    return response.json()
  }
}

/**
 * Loads device presets
 */
export class LoadPresets {
  baseUrl: string

  constructor(baseUrl = './api/presets') {
    this.baseUrl = baseUrl
  }

  async call(): Promise<PresetsConfig> {
    const response = await fetch(this.baseUrl)
    if (!response.ok) {
      throw new Error(`Failed to load presets: ${response.statusText}`)
    }
    return response.json()
  }
}

/**
 * Loads palette options for UI dropdown
 */
export class LoadPalettes {
  baseUrl: string

  constructor(baseUrl = './api/palettes') {
    this.baseUrl = baseUrl
  }

  async call(): Promise<PaletteOption[]> {
    const response = await fetch(this.baseUrl)
    if (!response.ok) {
      throw new Error(`Failed to load palettes: ${response.statusText}`)
    }
    return response.json()
  }
}

/**
 * Triggers immediate execution of a schedule.
 * Takes screenshot and optionally uploads to webhook.
 */
export class SendSchedule {
  baseUrl: string

  constructor(baseUrl = './api/schedules') {
    this.baseUrl = baseUrl
  }

  async call(id: string): Promise<SendScheduleResponse> {
    const response = await fetch(`${this.baseUrl}/${id}/send`, {
      method: 'POST',
    })

    // Always try to parse JSON response, even on error
    const data = (await response.json()) as SendScheduleResponse

    if (!response.ok) {
      return {
        success: false,
        error: data.error ?? `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    return data
  }
}

/**
 * Fetches a screenshot preview
 */
export class FetchPreview {
  /**
   * Fetches preview image for a schedule
   */
  async call(path: string, params: URLSearchParams): Promise<Blob> {
    const url = `.${path}?${params.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.blob()
  }
}

/** Response from BYOS login API */
export interface ByosLoginResponse {
  success: boolean
  access_token?: string
  refresh_token?: string
  obtained_at?: number
  error?: string
}

/**
 * Authenticates with BYOS server and returns tokens.
 * Credentials are NOT stored - only passed to server for authentication.
 */
export class ByosLogin {
  baseUrl: string

  constructor(baseUrl = './api/byos/login') {
    this.baseUrl = baseUrl
  }

  async call(
    webhookUrl: string,
    login: string,
    password: string,
  ): Promise<ByosLoginResponse> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl, login, password }),
    })

    const data = (await response.json()) as ByosLoginResponse

    if (!response.ok) {
      return {
        success: false,
        error: data.error ?? `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    return data
  }
}
