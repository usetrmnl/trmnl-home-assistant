/**
 * UI Renderer Module - Pure View Layer (Template Generation)
 *
 * Generates all HTML templates for the schedule editor UI. This module is a pure
 * view layer with NO business logic - all data manipulation happens in other modules.
 *
 * Architecture:
 * - Three main render classes: RenderTabs, RenderEmptyState, RenderScheduleContent
 * - Each class is command-pattern: instantiate with data, call .call() to render
 * - All event handlers delegate to window.app.* methods (defined in app.js)
 *
 * NOTE: This file is 650+ lines of mostly HTML strings. Focus on class-level docs.
 * NOTE: When modifying templates, preserve "s_" field ID prefix - app.js depends on it.
 *
 * @module html/js/ui-renderer
 */

import type { Schedule } from '../../types/domain.js'
import type { PaletteOption } from './palette-options.js'

/**
 * Renders the tab bar showing all schedules as clickable tabs.
 */
export class RenderTabs {
  schedules: Schedule[]
  activeScheduleId: string | null

  constructor(schedules: Schedule[], activeScheduleId: string | null) {
    this.schedules = schedules
    this.activeScheduleId = activeScheduleId
  }

  call(): void {
    const tabBar = document.getElementById('tabBar')
    if (!tabBar) return

    tabBar.innerHTML = this.schedules
      .map((schedule) => this.#renderTab(schedule))
      .join('')
  }

  #renderTab(schedule: Schedule): string {
    const isActive = schedule.id === this.activeScheduleId
    const statusDot = schedule.enabled
      ? '<span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>'
      : ''

    return `
      <button
        onclick="window.app.selectSchedule('${schedule.id}')"
        class="px-4 py-2 rounded-t-lg font-semibold transition-all ${
          isActive ? 'tab-active' : 'tab-inactive'
        }"
      >
        ${statusDot}${schedule.name || 'Untitled'}
      </button>
    `
  }
}

/**
 * Renders empty state UI when no schedules exist.
 */
export class RenderEmptyState {
  call(): void {
    const content = document.getElementById('tabContent')
    if (!content) return

    content.innerHTML = `
      <div class="text-center py-12">
        <svg class="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        <h3 class="text-lg font-semibold text-gray-600 mb-2">No Schedules</h3>
        <p class="text-gray-500 mb-4">Create your first schedule to get started</p>
        <button
          onclick="window.app.createSchedule()"
          class="px-6 py-2 text-white rounded-md transition duration-200"
          style="background-color: var(--primary)"
        >
          + New Schedule
        </button>
      </div>
    `
  }
}

/**
 * Renders the complete schedule editor UI with all settings and preview.
 */
export class RenderScheduleContent {
  schedule: Schedule
  paletteOptions: PaletteOption[]

  constructor(schedule: Schedule, paletteOptions: PaletteOption[]) {
    this.schedule = schedule
    this.paletteOptions = paletteOptions
  }

  call(): void {
    const content = document.getElementById('tabContent')
    if (!content) return

    content.innerHTML = this.#buildTemplate()
  }

  #buildTemplate(): string {
    const s = this.schedule

    return `
      <div class="flex justify-end mb-4">
        <button onclick="window.app.deleteSchedule('${s.id}')"
          class="px-4 py-2 text-red-700 bg-red-100 rounded-md hover:bg-red-200 transition">
          Delete Schedule
        </button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Settings Column (1 of 3) -->
        <div class="lg:col-span-1 space-y-4">
          ${this.#renderScheduleSettings()}
          ${this.#renderScreenshotSettings()}
          ${this.#renderDitheringSettings()}
        </div>

        <!-- Preview Column (2 of 3, sticky on scroll) -->
        <div class="lg:col-span-2 lg:sticky lg:top-4 lg:self-start">
          ${this.#renderPreviewPanel()}
        </div>
      </div>
    `
  }

  #renderScheduleSettings(): string {
    const s = this.schedule
    const enabledClass = s.enabled
      ? 'bg-green-50 border-green-200'
      : 'bg-gray-50 border-gray-200'
    const enabledTextClass = s.enabled ? 'text-green-700' : 'text-gray-600'
    const statusBadge = s.enabled
      ? '<span class="text-xs text-green-600">Running on schedule</span>'
      : ''

    return `
      <div class="border-b pb-4">
        <h3 class="text-lg font-semibold mb-3" style="color: var(--primary-dark)">Schedule</h3>
        <div class="space-y-3">
          <div class="flex items-center justify-between p-3 rounded-md ${enabledClass} border"
               title="When enabled, this schedule will automatically capture and upload screenshots">
            <div class="flex items-center">
              <input type="checkbox" id="s_enabled" ${
                s.enabled ? 'checked' : ''
              }
                class="h-5 w-5 border-gray-300 rounded"
                onchange="window.app.updateField('enabled', this.checked)" />
              <label for="s_enabled" class="ml-2 font-medium ${enabledTextClass}">
                ${s.enabled ? 'Enabled' : 'Disabled'}
              </label>
            </div>
            ${statusBadge}
          </div>
          <p class="text-xs text-gray-500 mt-1">Toggle to activate/pause this schedule's automatic screenshot capture</p>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" id="s_name" value="${s.name || ''}"
              class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              placeholder="e.g., Living Room Display"
              title="Give this schedule a descriptive name to identify it easily" />
            <p class="text-xs text-gray-500 mt-1">Descriptive name for this schedule</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Cron Expression</label>
            <input type="text" id="s_cron" value="${s.cron || ''}"
              class="w-full px-3 py-2 border rounded-md font-mono" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              placeholder="*/10 * * * *"
              title="Unix cron format: minute hour day month weekday" />
            <p class="text-xs text-gray-500 mt-1">
              Schedule timing in cron format (e.g., <code>*/10 * * * *</code> = every 10 minutes).
              <a href="https://crontab.guru" target="_blank" class="underline" style="color: var(--primary)">Use cron helper →</a>
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
            <input type="url" id="s_webhook" value="${s.webhook_url || ''}"
              class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              
              placeholder="https://your-server.com/upload"
              title="Optional: POST screenshots to this URL when captured" />
            <p class="text-xs text-gray-500 mt-1">Optional: Screenshots will be POSTed to this URL</p>
            ${
              s.webhook_url
                ? `
            <button onclick="window.app.sendNow('${s.id}', event)"
              class="mt-2 px-4 py-2 text-white rounded-md transition hover:opacity-90"
              style="background-color: var(--primary)"
              title="Capture screenshot and send to webhook immediately">
              Send Now
            </button>
            `
                : ''
            }
          </div>

          ${this.#renderWebhookFormatSettings()}
        </div>
      </div>
    `
  }

  #renderWebhookFormatSettings(): string {
    const s = this.schedule
    const currentFormat = s.webhook_format?.format ?? 'raw'
    const byosConfig = s.webhook_format?.byosConfig
    const showByosFields = currentFormat === 'byos-hanami'

    return `
      <div id="webhookFormatSection" >
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Webhook Format</label>
          <select id="s_webhook_format" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            onchange="window.app.toggleWebhookFormat(this.value)"
            title="Payload format for webhook requests">
            <option value="raw" ${currentFormat === 'raw' ? 'selected' : ''}>Raw Image (default)</option>
            <option value="byos-hanami" ${currentFormat === 'byos-hanami' ? 'selected' : ''}>BYOS Hanami API</option>
          </select>
          <p class="text-xs text-gray-500 mt-1">Raw: sends binary image | BYOS: JSON-wrapped base64 for self-hosted TRMNL</p>
        </div>

        <div id="byosConfigSection" class="${showByosFields ? '' : 'hidden'} mt-3 p-3 rounded-md" style="background-color: #f9fafb; border: 1px solid #e5e7eb">
          <p class="text-xs font-medium text-gray-600 mb-2">BYOS Hanami Configuration (/api/screens)</p>
          <div class="space-y-2">
            <div>
              <label class="block text-xs text-gray-600 mb-1">Label</label>
              <input type="text" id="s_byos_label" value="${byosConfig?.label || 'Home Assistant'}"
                class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
                onchange="window.app.updateScheduleFromForm()"
                placeholder="Home Assistant"
                title="Display label shown in BYOS dashboard" />
            </div>
            <div>
              <label class="block text-xs text-gray-600 mb-1">Screen Name</label>
              <input type="text" id="s_byos_name" value="${byosConfig?.name || 'ha-dashboard'}"
                class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
                onchange="window.app.updateScheduleFromForm()"
                placeholder="ha-dashboard"
                title="Unique screen identifier (no spaces)" />
            </div>
            <div>
              <label class="block text-xs text-gray-600 mb-1">Model ID</label>
              <input type="text" id="s_byos_model_id" value="${byosConfig?.model_id || '1'}"
                class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
                onchange="window.app.updateScheduleFromForm()"
                placeholder="1"
                title="BYOS model ID for your device" />
            </div>
          </div>

          <!-- JWT Authentication -->
          <div class="mt-3 pt-3 border-t border-gray-200">
            <label class="flex items-center gap-2 text-xs font-medium text-gray-600 mb-2 cursor-pointer">
              <input type="checkbox" id="s_byos_auth_enabled" ${byosConfig?.auth?.enabled ? 'checked' : ''}
                class="h-4 w-4 border-gray-300 rounded"
                onchange="window.app.toggleByosAuth(this.checked)"
                title="Enable JWT authentication for BYOS API" />
              JWT Authentication
            </label>
            <div id="byosAuthFields" class="${byosConfig?.auth?.enabled ? '' : 'hidden'}">
              ${
                byosConfig?.auth?.access_token
                  ? `
              <!-- Authenticated state -->
              <div class="flex items-center justify-between p-2 rounded-md bg-green-50 border border-green-200">
                <div class="flex items-center gap-2">
                  <span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                  <span class="text-xs text-green-700">Authenticated</span>
                </div>
                <button type="button" onclick="window.app.byosLogout()"
                  class="text-xs text-red-600 hover:text-red-800 underline">
                  Clear Tokens
                </button>
              </div>
              <p class="text-xs text-gray-500 mt-1">Tokens auto-refresh. Valid for ~14 days.</p>
              `
                  : `
              <!-- Auth options: Login or Manual Token -->
              <div class="space-y-3">
                <!-- Option 1: Login with credentials -->
                <div class="p-2 rounded-md bg-gray-50 border border-gray-200">
                  <p class="text-xs font-medium text-gray-600 mb-2">Option 1: Login (credentials not stored)</p>
                  <div class="space-y-2">
                    <input type="email" id="s_byos_auth_login"
                      class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
                      placeholder="Email" />
                    <input type="password" id="s_byos_auth_password"
                      class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
                      placeholder="Password" />
                    <button type="button" onclick="window.app.byosLogin()"
                      class="w-full px-3 py-1.5 text-sm text-white rounded-md transition hover:opacity-90"
                      style="background-color: var(--primary)">
                      Authenticate
                    </button>
                  </div>
                </div>

                <!-- Option 2: Manual token entry -->
                <div class="p-2 rounded-md bg-gray-50 border border-gray-200">
                  <p class="text-xs font-medium text-gray-600 mb-2">Option 2: Paste tokens manually</p>
                  <div class="space-y-2">
                    <input type="text" id="s_byos_manual_access_token"
                      class="w-full px-2 py-1 text-sm border rounded-md font-mono" style="border-color: var(--primary-light)"
                      placeholder="Access Token" />
                    <input type="text" id="s_byos_manual_refresh_token"
                      class="w-full px-2 py-1 text-sm border rounded-md font-mono" style="border-color: var(--primary-light)"
                      placeholder="Refresh Token" />
                    <button type="button" onclick="window.app.byosSaveManualTokens()"
                      class="w-full px-3 py-1.5 text-sm border-2 rounded-md transition hover:bg-gray-100"
                      style="border-color: var(--primary); color: var(--primary)">
                      Save Tokens
                    </button>
                  </div>
                </div>
              </div>
              `
              }
            </div>
          </div>

          <p class="text-xs text-gray-500 mt-2">
            <a href="https://github.com/usetrmnl/byos_hanami/blob/main/doc/api.adoc#screens" target="_blank" class="underline" style="color: var(--primary)">BYOS Hanami docs</a>
          </p>
        </div>
      </div>
    `
  }

  #renderScreenshotSettings(): string {
    const s = this.schedule

    // Check if HA is connected to determine if toggle should be shown
    // @ts-expect-error window.uiConfig is injected by server
    const uiConfig = window.uiConfig || { haConnected: false, hasToken: false }

    // Use saved ha_mode from schedule (falls back to true for old schedules without this field)
    const isHAMode = s.ha_mode ?? true
    const haOptionsHidden = !isHAMode ? 'hidden' : ''
    const genericOptionsHidden = isHAMode ? 'hidden' : ''

    return `
      <div class="border-b pb-4">
        <h3 class="text-lg font-semibold mb-3" style="color: var(--primary-dark)">Screenshot</h3>
        <div class="space-y-3">
          <!-- HA Mode Toggle (only shown when HA is connected) -->
          <div class="${
            uiConfig.haConnected ? '' : 'hidden'
          } p-3 rounded-md bg-gray-50 border border-gray-200">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="s_ha_mode" ${isHAMode ? 'checked' : ''}
                class="h-5 w-5 border-gray-300 rounded"
                onchange="window.app.toggleHAMode(this.checked)"
                title="Toggle between Home Assistant dashboard mode and generic URL mode" />
              <span class="font-medium text-gray-700">Home Assistant Mode</span>
            </label>
            <p class="text-xs text-gray-500 mt-1 ml-7">
              ${
                isHAMode
                  ? 'Capturing Home Assistant dashboards with theme/language support'
                  : 'Capturing any URL (no HA-specific features)'
              }
            </p>
          </div>

          <!-- Generic URL Input (shown when HA mode is off) -->
          <div id="genericUrlSection" class="${genericOptionsHidden}">
            <label class="block text-sm font-medium text-gray-700 mb-1">Full URL</label>
            <input type="url" id="s_target_url" value="${s.target_url || ''}"
              class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              placeholder="https://example.com/dashboard"
              title="Full URL to capture (any website)" />
            <p class="text-xs text-gray-500 mt-1">Enter the complete URL of the page to screenshot</p>
          </div>

          <!-- HA-specific options (hidden when HA mode is off) -->
          <div id="haOptionsSection" class="${haOptionsHidden}">
            <!-- Dashboard Selector -->
            <div class="mb-3">
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Quick Select Dashboard
                <span class="text-gray-500 font-normal text-xs">(Optional - Auto-fills path below)</span>
              </label>
              <select id="dashboardSelector"
                class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
                onchange="window.app.applyDashboardSelection()"
                title="Select from your Home Assistant dashboards">
                <option value="">-- Select a dashboard --</option>
              </select>
              <p class="text-xs text-gray-500 mt-1">Quick select from your HA dashboards</p>
            </div>

            <!-- Dashboard Path -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Dashboard Path</label>
              <input type="text" id="s_path" value="${
                s.dashboard_path || '/home'
              }"
                class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
                onchange="window.app.updateScheduleFromForm()"
                placeholder="/lovelace/kitchen"
                title="Home Assistant dashboard path to capture" />
              <p class="text-xs text-gray-500 mt-1">Manual entry or use quick select above</p>
            </div>
          </div>

          <!-- Device Preset -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Device Preset
              <span class="text-gray-500 font-normal text-xs">(Optional - Auto-fills dimensions)</span>
            </label>
            <select id="devicePreset"
              class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.applyDevicePreset()"
              title="Pre-configured settings for common e-ink displays">
              <option value="">Custom Configuration</option>
            </select>
            <p class="text-xs text-gray-500 mt-1">Quick setup for common e-ink displays</p>
          </div>

          <!-- Device Info Banner -->
          <div id="deviceInfo" class="hidden px-4 py-3 rounded-md"
               style="background-color: #fef2f0; border: 1px solid var(--primary-light)">
            <p class="text-sm" style="color: var(--primary-dark)"></p>
          </div>

          <!-- Viewport Dimensions -->
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Width</label>
              <input type="number" id="s_width" value="${
                s.viewport?.width || 768
              }"
                class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
                onchange="window.app.updateScheduleFromForm()"
                title="Screenshot width in pixels" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Height</label>
              <input type="number" id="s_height" value="${
                s.viewport?.height || 1024
              }"
                class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
                onchange="window.app.updateScheduleFromForm()"
                title="Screenshot height in pixels" />
            </div>
          </div>
          <p class="text-xs text-gray-500 mt-1">Viewport dimensions in pixels - should match your e-ink display resolution</p>

          ${this.#renderCropSettings()}
          ${this.#renderFormatSettings()}
          ${this.#renderZoomWaitSettings()}

          <!-- HA-specific theme settings (hidden when HA mode is off) -->
          <div id="haThemeSection" class="${haOptionsHidden}">
            ${this.#renderThemeSettings()}
            ${this.#renderDarkModeToggle()}
          </div>

          <!-- Invert toggle (always visible, works for any display) -->
          <div class="flex items-center">
            <label class="flex items-center" title="Swap black and white after capture (useful for negative displays)">
              <input type="checkbox" id="s_invert" ${s.invert ? 'checked' : ''}
                class="h-4 w-4 border-gray-300 rounded"
                onchange="window.app.updateScheduleFromForm()" />
              <span class="ml-2 text-sm text-gray-700">Invert Colors</span>
            </label>
          </div>
          <p class="text-xs text-gray-500 mt-1">Flips black↔white (for inverted e-ink displays)</p>
        </div>
      </div>
    `
  }

  #renderCropSettings(): string {
    const s = this.schedule

    return `
      <div class="mt-4 p-3 rounded-md" style="background-color: #f9fafb; border: 1px solid #e5e7eb">
        <div class="flex justify-between items-center mb-2">
          <label class="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
            <input type="checkbox" id="s_crop_enabled" ${
              s.crop?.enabled ? 'checked' : ''
            }
              class="h-4 w-4 border-gray-300 rounded"
              onchange="window.app.updateScheduleFromForm()"
              title="Enable crop region" />
            Enable Crop Region
          </label>
        </div>
        <div class="grid grid-cols-4 gap-2">
          <div>
            <label class="block text-xs text-gray-600 mb-1">X</label>
            <input type="number" id="s_crop_x" value="${s.crop?.x || 0}"
              class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Crop offset from left (pixels)" />
          </div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">Y</label>
            <input type="number" id="s_crop_y" value="${s.crop?.y || 0}"
              class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Crop offset from top (pixels)" />
          </div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">Width</label>
            <input type="number" id="s_crop_width" value="${
              s.crop?.width || s.viewport?.width || 768
            }"
              class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Crop width (pixels)" />
          </div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">Height</label>
            <input type="number" id="s_crop_height" value="${
              s.crop?.height || s.viewport?.height || 1024
            }"
              class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Crop height (pixels)" />
          </div>
        </div>
        <p class="text-xs text-gray-500 mt-1">Use "Crop" button to visually adjust crop region</p>
        <div class="mt-2 px-3 py-2 rounded-md" style="background-color: #fef3c7; border: 1px solid #fbbf24">
          <p class="text-xs" style="color: #92400e">
            <strong>Note:</strong> When crop is enabled, the final image size will be the crop dimensions (Width × Height), not the viewport size.
          </p>
        </div>
      </div>
    `
  }

  #renderFormatSettings(): string {
    const s = this.schedule

    return `
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Format</label>
          <select id="s_format" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            onchange="window.app.updateScheduleFromForm()"
            title="Image output format">
            <option value="png" ${
              s.format === 'png' ? 'selected' : ''
            }>PNG</option>
            <option value="jpeg" ${
              s.format === 'jpeg' ? 'selected' : ''
            }>JPEG</option>
            <option value="bmp" ${
              s.format === 'bmp' ? 'selected' : ''
            }>BMP</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Rotation</label>
          <select id="s_rotate" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            onchange="window.app.updateScheduleFromForm()"
            title="Rotate image after capture">
            <option value="" ${!s.rotate ? 'selected' : ''}>None</option>
            <option value="90" ${s.rotate === 90 ? 'selected' : ''}>90°</option>
            <option value="180" ${
              s.rotate === 180 ? 'selected' : ''
            }>180°</option>
            <option value="270" ${
              s.rotate === 270 ? 'selected' : ''
            }>270°</option>
          </select>
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-1">PNG (lossless), JPEG (smaller files), or BMP (raw) | Rotate for portrait/landscape displays</p>
    `
  }

  #renderZoomWaitSettings(): string {
    const s = this.schedule

    return `
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Zoom</label>
          <input type="number" id="s_zoom" value="${
            s.zoom || 1
          }" step="0.1" min="0.1" max="5"
            class="w-full px-3 py-2 border rounded-md"
            style="border-color: var(--primary-light)"
            onchange="window.app.updateScheduleFromForm()"
            title="Browser zoom level (1.0 = 100%)" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Wait (ms)</label>
          <input type="number" id="s_wait" value="${
            s.wait || ''
          }" min="0" max="30000" step="100"
            class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            placeholder="Auto"
            onchange="window.app.updateScheduleFromForm()"
            title="Extra delay before screenshot (for slow-loading cards)" />
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-1">Zoom: Scale content (e.g., 0.8 for smaller text) | Wait: Extra loading time for charts/images</p>
    `
  }

  #renderThemeSettings(): string {
    const s = this.schedule

    return `
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Theme</label>
          <select id="s_theme"
            class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            onchange="window.app.updateScheduleFromForm()"
            title="Home Assistant theme (Graphite recommended for e-ink)">
            <option value="">Default</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Language</label>
          <input type="text" id="s_lang" value="${s.lang || ''}"
            class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            placeholder="en"
            onchange="window.app.updateScheduleFromForm()"
            title="Language code for Home Assistant UI" />
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-1">Theme: <a href="https://github.com/TilmanGriesel/graphite" target="_blank" class="underline" style="color: var(--primary)">Graphite</a> recommended for e-ink | Language: Override HA language (e.g., "en", "fr")</p>
    `
  }

  #renderDarkModeToggle(): string {
    const s = this.schedule

    return `
      <div class="flex items-center">
        <label class="flex items-center" title="Force dark mode in Home Assistant">
          <input type="checkbox" id="s_dark" ${s.dark ? 'checked' : ''}
            class="h-4 w-4 border-gray-300 rounded"
            onchange="window.app.updateScheduleFromForm()" />
          <span class="ml-2 text-sm text-gray-700">Dark Mode</span>
        </label>
      </div>
      <p class="text-xs text-gray-500 mt-1">Forces dark theme in Home Assistant</p>
    `
  }

  #renderDitheringSettings(): string {
    const s = this.schedule

    return `
      <div>
        <h3 class="text-lg font-semibold mb-3" style="color: var(--primary-dark)">Dithering</h3>
        <div class="space-y-3">
          <div class="flex items-center">
            <input type="checkbox" id="s_dithering" ${
              s.dithering?.enabled ? 'checked' : ''
            }
              class="h-4 w-4 border-gray-300 rounded"
              onchange="document.getElementById('ditheringControls').classList.toggle('hidden', !this.checked); window.app.updateScheduleFromForm()"
              title="Convert images to limited color palettes for e-ink displays" />
            <label for="s_dithering" class="ml-2 text-sm text-gray-700">Enable Dithering</label>
          </div>
          <p class="text-xs text-gray-500 mt-1">Optimizes images for e-ink displays by reducing colors and applying error diffusion</p>

          <div id="ditheringControls" class="${
            s.dithering?.enabled ? '' : 'hidden'
          } space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Method</label>
            <select id="s_method" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Algorithm for distributing color errors">
              <option value="floyd-steinberg" ${
                s.dithering?.method === 'floyd-steinberg' ? 'selected' : ''
              }>Floyd-Steinberg</option>
              <option value="ordered" ${
                s.dithering?.method === 'ordered' ? 'selected' : ''
              }>Ordered</option>
              <option value="none" ${
                s.dithering?.method === 'none' ? 'selected' : ''
              }>None</option>
            </select>
            <p class="text-xs text-gray-500 mt-1">Floyd-Steinberg (best quality, smooth gradients) | Ordered (faster, crosshatch pattern) | None (hard edges)</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Palette</label>
            <select id="s_palette" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Color palette matching your e-ink display capabilities">
              ${this.paletteOptions
                .map(
                  (p) =>
                    `<option value="${p.value}" ${
                      s.dithering?.palette === p.value ? 'selected' : ''
                    }>${p.label}</option>`,
                )
                .join('\n              ')}
            </select>
            <p class="text-xs text-gray-500 mt-1">Match your display: grayscale (TRMNL, classic e-ink) or color (Inky, Spectra, RTM1002)</p>
          </div>

          <div class="flex items-center">
            <input type="checkbox" id="s_gamma" ${
              s.dithering?.gammaCorrection ? 'checked' : ''
            }
              class="h-4 w-4 border-gray-300 rounded"
              onchange="window.app.updateScheduleFromForm()"
              title="Removes color profiles to linearize brightness for e-ink displays" />
            <label for="s_gamma" class="ml-2 text-sm text-gray-700">Gamma Correction</label>
          </div>
          <p class="text-xs text-gray-500 mt-1">✓ Recommended: Removes gamma curves so e-ink displays show proper brightness</p>

          <div class="flex items-center">
            <input type="checkbox" id="s_levels_enabled" ${
              s.dithering?.levelsEnabled ? 'checked' : ''
            }
              class="h-4 w-4 border-gray-300 rounded"
              onchange="document.getElementById('levelsControls').classList.toggle('hidden', !this.checked); window.app.updateScheduleFromForm()"
              title="Enable manual black/white level adjustments" />
            <label for="s_levels_enabled" class="ml-2 text-sm text-gray-700">Manual Levels</label>
          </div>
          <p class="text-xs text-gray-500 mt-1">Enable to manually adjust contrast. Disabled = preserve original image contrast.</p>

          <div id="levelsControls" class="${
            s.dithering?.levelsEnabled ? '' : 'hidden'
          } space-y-4 pl-4 border-l-2 border-gray-200">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Black Level: <span id="black_val">${
                s.dithering?.blackLevel ?? 0
              }</span>%</label>
              <input type="range" id="s_black" min="0" max="50" value="${
                s.dithering?.blackLevel ?? 0
              }"
                class="w-full"
                oninput="document.getElementById('black_val').textContent=this.value"
                onchange="window.app.updateScheduleFromForm()"
                title="Crush darker pixels to pure black for higher contrast" />
              <p class="text-xs text-gray-500 mt-1">Pixels darker than this become pure black</p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">White Level: <span id="white_val">${
                s.dithering?.whiteLevel ?? 100
              }</span>%</label>
              <input type="range" id="s_white" min="50" max="100" value="${
                s.dithering?.whiteLevel ?? 100
              }"
                class="w-full"
                oninput="document.getElementById('white_val').textContent=this.value"
                onchange="window.app.updateScheduleFromForm()"
                title="Crush lighter pixels to pure white for cleaner highlights" />
              <p class="text-xs text-gray-500 mt-1">Pixels brighter than this become pure white</p>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <label class="flex items-center" title="Stretches histogram so darkest pixel→black, brightest→white">
              <input type="checkbox" id="s_normalize" ${
                s.dithering?.normalize ? 'checked' : ''
              }
                class="h-4 w-4 border-gray-300 rounded"
                onchange="window.app.updateScheduleFromForm()" />
              <span class="ml-2 text-sm text-gray-700">Normalize</span>
            </label>
            <label class="flex items-center" title="Boost saturation by 50% for more vivid colors on e-ink">
              <input type="checkbox" id="s_saturation" ${
                s.dithering?.saturationBoost ? 'checked' : ''
              }
                class="h-4 w-4 border-gray-300 rounded"
                onchange="window.app.updateScheduleFromForm()" />
              <span class="ml-2 text-sm text-gray-700">Saturation Boost</span>
            </label>
          </div>
          <p class="text-xs text-gray-500 mt-1">Normalize: Maximizes contrast | Saturation Boost: Makes colors pop 50% more</p>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Compression Level</label>
            <select id="s_compression" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="PNG compression level (higher = smaller files, slower)">
              ${[9, 8, 7, 6, 5, 4, 3, 2, 1]
                .map(
                  (level) => `
                <option value="${level}" ${
                  (s.dithering?.compressionLevel ?? 9) === level
                    ? 'selected'
                    : ''
                }>${level} ${
                  level === 9
                    ? '(max compression)'
                    : level === 1
                      ? '(fastest)'
                      : ''
                }</option>
              `,
                )
                .join('')}
            </select>
            <p class="text-xs text-gray-500 mt-1">Higher = smaller files but slower. Default 9 (max). Try 6-7 if processing is slow.</p>
          </div>
          </div>
        </div>
      </div>
    `
  }

  #renderPreviewPanel(): string {
    return `
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold" style="color: var(--primary-dark)">Preview</h3>
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer"
                 title="Automatically regenerate preview when settings change">
            <input type="checkbox" id="autoRefreshToggle"
              class="h-4 w-4 border-gray-300 rounded"
              onchange="window.app.toggleAutoRefresh(this.checked)" />
            Auto-refresh
          </label>
          <span id="loadTime" class="text-sm text-gray-500"></span>
          <button onclick="window.app.openCropModal()"
            class="px-4 py-2 border-2 rounded-md transition hover:bg-gray-50"
            style="border-color: var(--primary); color: var(--primary)"
            title="Interactive crop region selection">
            Crop
          </button>
          <button onclick="window.app.loadPreview()"
            class="px-4 py-2 text-white rounded-md transition"
            style="background-color: var(--primary)">
            Refresh
          </button>
        </div>
      </div>

      <div id="previewContainer" class="bg-gray-50 rounded-lg p-4 min-h-[400px] preview-container-scroll">
        <div id="previewPlaceholder" class="text-center text-gray-400 flex items-center justify-center min-h-[400px]">
          <div>
            <svg class="mx-auto h-16 w-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p>Click Refresh to generate preview</p>
          </div>
        </div>
        <div id="loadingIndicator" class="hidden text-center flex items-center justify-center min-h-[400px]">
          <div>
            <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-t-transparent"
              style="border-color: var(--primary); border-top-color: transparent"></div>
            <p class="mt-4 text-gray-600">Generating screenshot...</p>
          </div>
        </div>
        <img id="previewImage" src="" alt="Preview" class="preview-img hidden" />
        <div class="text-center mt-2 space-y-1">
          <div class="flex justify-center gap-4">
            <span id="previewDimensions" class="text-xs text-gray-500 hidden"></span>
            <span id="previewFileSize" class="text-xs hidden"></span>
          </div>
          <p id="previewTargetUrl" class="text-xs text-gray-400 font-mono truncate max-w-full hidden" title="Target URL"></p>
        </div>
      </div>

      <div id="errorMessage" class="hidden mt-4 bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-md">
        <p id="errorText"></p>
      </div>
    `
  }
}
