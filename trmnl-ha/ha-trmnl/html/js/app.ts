/**
 * TRMNL HA Schedule Manager - Main Application Module
 *
 * Front-end orchestrator coordinating all UI modules and user interactions.
 * Exposes global app instance (window.app) for HTML onclick handlers.
 *
 * Architecture Pattern:
 * Façade pattern - presents simple API to HTML while coordinating complex subsystems.
 *
 * NOTE: This is the only module that touches window global.
 * NOTE: When adding features, follow delegation pattern (create module, call from App).
 *
 * @module html/js/app
 */

import { ScheduleManager } from './schedule-manager.js'
import {
  RenderTabs,
  RenderEmptyState,
  RenderScheduleContent,
} from './ui-renderer.js'
import { PreviewGenerator } from './preview-generator.js'
import { CropModal } from './crop-modal.js'
import { ConfirmModal } from './confirm-modal.js'
import { DevicePresetsManager } from './device-presets.js'
import { SendSchedule, LoadPalettes, ByosLogin } from './api-client.js'
import type { PaletteOption } from './palette-options.js'
import type {
  Schedule,
  CropRegion,
  ScheduleUpdate,
  SendScheduleResponse,
  WebhookFormat,
  WebhookFormatConfig,
  ByosAuthConfig,
} from '../../types/domain.js'

// =============================================================================
// FORM PARSING HELPERS
// =============================================================================

/**
 * Safely parse integer from form input, returning default only for empty/NaN.
 * Unlike `parseInt(value) || default`, this preserves 0 as a valid value.
 */
function parseIntOrDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  if (!value || value.trim() === '') return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Safely parse float from form input, returning default only for empty/NaN.
 * Unlike `parseFloat(value) || default`, this preserves 0 as a valid value.
 */
function parseFloatOrDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  if (!value || value.trim() === '') return defaultValue
  const parsed = parseFloat(value)
  return isNaN(parsed) ? defaultValue : parsed
}

// Extend Window to include app instance
declare global {
  interface Window {
    app: App
  }
}

/** Crop settings from modal */
interface CropSettings extends CropRegion {
  enabled: boolean
}

/**
 * Main application class coordinating all UI modules.
 */
class App {
  #scheduleManager: ScheduleManager
  #previewGenerator: PreviewGenerator
  #cropModal: CropModal
  #confirmModal: ConfirmModal
  #devicePresetsManager: DevicePresetsManager
  #paletteOptions: PaletteOption[] = []

  constructor() {
    this.#scheduleManager = new ScheduleManager()
    this.#previewGenerator = new PreviewGenerator()
    this.#cropModal = new CropModal()
    this.#confirmModal = new ConfirmModal()
    this.#devicePresetsManager = new DevicePresetsManager()
  }

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  async init(): Promise<void> {
    try {
      // Remove ?refresh=1 from URL to prevent repeated forced refreshes
      if (window.location.search.includes('refresh=1')) {
        window.history.replaceState({}, '', window.location.pathname)
      }

      // Show HA status banner if not connected
      this.#updateHAStatusBanner()

      // Load palettes and schedules in parallel
      const [, palettes] = await Promise.all([
        this.#scheduleManager.loadAll(),
        new LoadPalettes().call(),
      ])
      this.#paletteOptions = palettes

      this.renderUI()

      await this.#devicePresetsManager.loadAndRenderPresets()

      const autoRefreshCheckbox = document.getElementById(
        'autoRefreshToggle',
      ) as HTMLInputElement | null
      if (autoRefreshCheckbox) {
        autoRefreshCheckbox.checked = this.#previewGenerator.autoRefresh
      }
    } catch (err) {
      console.error('Error initializing app:', err)
      this.#showError('Failed to load schedules')
    }
  }

  /**
   * Shows/hides the HA status banner based on connection status.
   * Populates with diagnostic info: URL, token preview, status reason.
   */
  #updateHAStatusBanner(): void {
    const banner = document.getElementById('haStatusBanner')
    const content = document.getElementById('haStatusContent')
    if (!banner || !content) return

    // @ts-expect-error window.uiConfig is injected by server
    const uiConfig = window.uiConfig || {
      haConnected: false,
      hassUrl: '',
      tokenPreview: null,
      connectionStatus: 'Unknown',
      cachedAt: null,
    }

    // Log connection status to browser console for debugging
    const logPrefix = '[HA Connection]'
    if (uiConfig.haConnected) {
      console.log(
        `${logPrefix} Connected | URL: ${uiConfig.hassUrl} | Token: ${uiConfig.tokenPreview}`,
      )
      banner.classList.add('hidden')
      return
    }
    console.warn(
      `${logPrefix} ${uiConfig.connectionStatus} | URL: ${
        uiConfig.hassUrl
      } | Token: ${uiConfig.tokenPreview ?? 'not set'}`,
    )

    // Build diagnostic info
    const tokenInfo = uiConfig.tokenPreview
      ? `<code class="bg-amber-100 px-1 rounded">${uiConfig.tokenPreview}</code>`
      : '<span class="text-red-600 font-medium">not set</span>'

    // Refresh link (only show if we have cached data)
    const refreshLink = uiConfig.cachedAt
      ? `<br><a href="?refresh=1" class="text-amber-600 underline hover:text-amber-800">↻ Refresh HA status</a>`
      : ''

    content.innerHTML = `
      <p class="text-sm font-medium text-amber-800">Home Assistant not connected</p>
      <p class="text-xs text-amber-700 mt-1">
        <strong>Status:</strong> ${uiConfig.connectionStatus}<br>
        <strong>URL:</strong> <code class="bg-amber-100 px-1 rounded">${uiConfig.hassUrl}</code><br>
        <strong>Token:</strong> ${tokenInfo}${refreshLink}
      </p>
      <p class="text-xs text-amber-600 mt-2">
        HA features (themes, dashboards, dark mode) are unavailable.
        Use <strong>Generic Mode</strong> to capture any URL, or configure your HA token.
      </p>
    `
    banner.classList.remove('hidden')
  }

  // =============================================================================
  // SCHEDULE OPERATIONS
  // =============================================================================

  async createSchedule(): Promise<void> {
    try {
      await this.#scheduleManager.create()
      this.renderUI()
    } catch (err) {
      console.error('Error creating schedule:', err)
      await this.#confirmModal.alert({
        title: 'Error',
        message: 'Failed to create schedule. Please try again.',
        type: 'error',
      })
    }
  }

  selectSchedule(id: string): void {
    this.#scheduleManager.selectSchedule(id)
    this.renderUI()
  }

  async deleteSchedule(id: string): Promise<void> {
    const confirmed = await this.#confirmModal.show({
      title: 'Delete Schedule',
      message:
        'Are you sure you want to delete this schedule? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      confirmClass: 'bg-red-600 hover:bg-red-700',
    })

    if (!confirmed) return

    try {
      await this.#scheduleManager.delete(id)
      this.renderUI()
    } catch (err) {
      console.error('Error deleting schedule:', err)
      await this.#confirmModal.alert({
        title: 'Error',
        message: 'Failed to delete schedule. Please try again.',
        type: 'error',
      })
    }
  }

  async updateField(field: keyof Schedule, value: unknown): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    const updates = { ...schedule, [field]: value } as ScheduleUpdate
    await this.#scheduleManager.update(schedule.id, updates)

    if (field === 'enabled') {
      this.renderUI()
    }

    if (this.#previewGenerator.autoRefresh) {
      this.loadPreview()
    }
  }

  async sendNow(scheduleId: string, event: Event): Promise<void> {
    const button = event.target as HTMLButtonElement
    const originalText = button.textContent
    const originalBgColor = button.style.backgroundColor

    // Disable button during send
    button.disabled = true
    button.textContent = 'Saving...'
    button.style.opacity = '0.6'
    button.style.cursor = 'not-allowed'

    // Ensure current form values are saved before sending
    // This prevents race conditions between auto-save and send
    await this.updateScheduleFromForm()

    button.textContent = 'Sending...'

    // Use SendSchedule command (follows same pattern as other API calls)
    const sendCommand = new SendSchedule()
    const result = await sendCommand.call(scheduleId)

    // Log detailed result to browser console
    this.#logSendResult(result)

    // Determine overall status based on screenshot + webhook results
    const { title, message, type, buttonText, buttonColor } =
      this.#buildSendResultFeedback(result)

    button.textContent = buttonText
    button.style.backgroundColor = buttonColor
    button.style.opacity = '1'

    await this.#confirmModal.alert({ title, message, type })

    // Reset button state if it still exists in DOM
    if (document.body.contains(button)) {
      button.textContent = originalText
      button.style.backgroundColor = originalBgColor
      button.disabled = false
      button.style.opacity = ''
      button.style.cursor = ''
    }
  }

  /** Logs send result to browser console for debugging */
  #logSendResult(result: SendScheduleResponse): void {
    const logPrefix = '[Send Now]'

    if (!result.success) {
      console.error(`${logPrefix} Screenshot capture failed:`, result.error)
      return
    }

    console.log(`${logPrefix} Screenshot saved: ${result.savedPath}`)

    if (!result.webhook) {
      console.log(`${logPrefix} No webhook configured`)
      return
    }

    const { webhook } = result
    if (webhook.success) {
      console.log(
        `${logPrefix} Webhook success: ${webhook.statusCode} → ${webhook.url}`,
      )
    } else {
      console.error(
        `${logPrefix} Webhook failed: ${webhook.error} → ${webhook.url}`,
      )
    }
  }

  /** Builds user-facing feedback based on send result */
  #buildSendResultFeedback(result: SendScheduleResponse): {
    title: string
    message: string
    type: 'success' | 'error' | 'warning'
    buttonText: string
    buttonColor: string
  } {
    // Screenshot capture failed
    if (!result.success) {
      return {
        title: 'Screenshot Failed',
        message: `Failed to capture screenshot: ${
          result.error ?? 'Unknown error'
        }`,
        type: 'error',
        buttonText: 'Failed',
        buttonColor: '#ef4444',
      }
    }

    // No webhook configured - just screenshot saved
    if (!result.webhook) {
      return {
        title: 'Screenshot Saved',
        message: `Screenshot captured and saved to:\n${result.savedPath}`,
        type: 'success',
        buttonText: 'Saved',
        buttonColor: '#10b981',
      }
    }

    // Webhook was attempted
    const { webhook } = result

    if (webhook.success) {
      return {
        title: 'Success',
        message:
          `Screenshot captured and sent to webhook.\n\n` +
          `Saved: ${result.savedPath}\n` +
          `Webhook: ${webhook.statusCode} OK\n` +
          `URL: ${webhook.url ?? 'N/A'}`,
        type: 'success',
        buttonText: 'Sent',
        buttonColor: '#10b981',
      }
    }

    // Webhook failed but screenshot was saved
    return {
      title: 'Partial Success',
      message:
        `Screenshot saved, but webhook delivery failed.\n\n` +
        `Saved: ${result.savedPath}\n` +
        `Error: ${webhook.error}\n` +
        `URL: ${webhook.url ?? 'N/A'}`,
      type: 'warning',
      buttonText: 'Partial',
      buttonColor: '#f59e0b',
    }
  }

  async updateScheduleFromForm(): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    const oldName = schedule.name

    const updates = this.#buildScheduleUpdates(schedule)

    await this.#scheduleManager.update(schedule.id, updates)

    if (oldName !== updates.name) {
      this.renderUI()
    } else {
      this.#renderScheduleContent()
    }

    if (this.#previewGenerator.autoRefresh) {
      this.loadPreview()
    }
  }

  #buildScheduleUpdates(schedule: Schedule): ScheduleUpdate {
    // Helper to get input/select element values
    const input = (id: string) =>
      (document.getElementById(id) as HTMLInputElement | null)?.value
    const checkbox = (id: string) =>
      (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false
    const select = (id: string) =>
      (document.getElementById(id) as HTMLSelectElement | null)?.value

    // Check if in HA mode or generic mode from the toggle
    // When toggle is checked = HA mode, unchecked = generic mode
    const haModeCheckbox = document.getElementById(
      's_ha_mode',
    ) as HTMLInputElement | null
    const isHAMode = haModeCheckbox?.checked ?? true // default to HA mode if checkbox missing

    // Build webhook format config
    const webhookFormat = this.#buildWebhookFormatConfig(
      select,
      input,
      checkbox,
    )

    return {
      ...schedule,
      // Mode toggle - always save the current state
      ha_mode: isHAMode,

      // Common fields (always update from form)
      name: input('s_name') || schedule.name,
      cron: input('s_cron') || schedule.cron,
      webhook_url: input('s_webhook') || null,
      webhook_format: webhookFormat,
      viewport: {
        width: parseIntOrDefault(input('s_width'), schedule.viewport.width),
        height: parseIntOrDefault(input('s_height'), schedule.viewport.height),
      },
      crop: {
        enabled: checkbox('s_crop_enabled'),
        x: parseIntOrDefault(input('s_crop_x'), 0),
        y: parseIntOrDefault(input('s_crop_y'), 0),
        width: parseIntOrDefault(
          input('s_crop_width'),
          schedule.viewport.width,
        ),
        height: parseIntOrDefault(
          input('s_crop_height'),
          schedule.viewport.height,
        ),
      },
      format: (select('s_format') as 'png' | 'jpeg' | 'bmp') || schedule.format,
      rotate: this.#parseRotation(select('s_rotate')),
      zoom: parseFloatOrDefault(input('s_zoom'), 1),
      wait: this.#parseWait(input('s_wait')),
      invert: checkbox('s_invert'),
      dithering: {
        enabled: checkbox('s_dithering'),
        method: select('s_method') || 'floyd-steinberg',
        palette: select('s_palette') || 'gray-4',
        gammaCorrection:
          (document.getElementById('s_gamma') as HTMLInputElement | null)
            ?.checked ?? true,
        levelsEnabled: checkbox('s_levels_enabled'),
        blackLevel: parseIntOrDefault(input('s_black'), 0),
        whiteLevel: parseIntOrDefault(input('s_white'), 100),
        normalize: checkbox('s_normalize'),
        saturationBoost: checkbox('s_saturation'),
        compressionLevel: parseIntOrDefault(select('s_compression'), 9) as
          | 1
          | 2
          | 3
          | 4
          | 5
          | 6
          | 7
          | 8
          | 9,
      },

      // Mode-specific fields: only update when in that mode, otherwise preserve existing
      // HA mode fields - only read from form when in HA mode
      dashboard_path: isHAMode
        ? input('s_path') || schedule.dashboard_path
        : schedule.dashboard_path,
      theme: isHAMode ? select('s_theme') || null : schedule.theme,
      dark: isHAMode ? checkbox('s_dark') : schedule.dark,
      lang: isHAMode ? input('s_lang') || null : schedule.lang,

      // Generic mode fields - only read from form when in generic mode
      target_url: isHAMode ? undefined : input('s_target_url') || undefined,
    }
  }

  #parseRotation(value: string | undefined): number | null {
    return value ? parseInt(value) : null
  }

  #parseWait(value: string | undefined): number | null {
    return value ? parseInt(value) : null
  }

  /**
   * Builds webhook format config from form inputs.
   * Returns null for 'raw' format so JSON.stringify includes it (clears existing value).
   * NOTE: Auth tokens are preserved from existing schedule, NOT read from form.
   */
  #buildWebhookFormatConfig(
    select: (id: string) => string | undefined,
    input: (id: string) => string | undefined,
    checkbox: (id: string) => boolean,
  ): WebhookFormatConfig | null {
    const format = (select('s_webhook_format') || 'raw') as WebhookFormat

    if (format === 'raw') {
      return null // null is preserved by JSON.stringify (unlike undefined which is omitted)
    }

    if (format === 'byos-hanami') {
      const name = input('s_byos_name') || 'ha-dashboard'
      const authEnabled = checkbox('s_byos_auth_enabled')

      // Preserve existing auth tokens (managed by byosLogin/byosLogout, not form)
      // If auth is enabled but no tokens yet, create empty auth object with enabled: true
      const existingAuth =
        this.#scheduleManager.activeSchedule?.webhook_format?.byosConfig?.auth

      return {
        format: 'byos-hanami',
        byosConfig: {
          label: input('s_byos_label') || 'Home Assistant',
          name,
          model_id: input('s_byos_model_id') || '1',
          preprocessed: true,
          auth: authEnabled ? (existingAuth ?? { enabled: true }) : undefined,
        },
      }
    }

    return null
  }

  // =============================================================================
  // UI RENDERING
  // =============================================================================

  renderUI(): void {
    const schedules = this.#scheduleManager.schedules
    const activeId = this.#scheduleManager.activeScheduleId

    new RenderTabs(schedules, activeId).call()

    if (this.#scheduleManager.isEmpty()) {
      new RenderEmptyState().call()
    } else {
      this.#renderScheduleContent()
    }
  }

  #renderScheduleContent(): void {
    const schedule = this.#scheduleManager.activeSchedule
    if (schedule) {
      new RenderScheduleContent(schedule, this.#paletteOptions).call()

      this.#devicePresetsManager.afterDOMRender(schedule)

      const autoRefreshCheckbox = document.getElementById(
        'autoRefreshToggle',
      ) as HTMLInputElement | null
      if (autoRefreshCheckbox) {
        autoRefreshCheckbox.checked = this.#previewGenerator.autoRefresh
      }
    }
  }

  // =============================================================================
  // PREVIEW OPERATIONS
  // =============================================================================

  toggleAutoRefresh(enabled: boolean): void {
    this.#previewGenerator.toggleAutoRefresh(enabled)

    if (enabled) {
      this.loadPreview()
    }
  }

  async loadPreview(): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    await this.#previewGenerator.call(schedule)
  }

  // =============================================================================
  // CROP MODAL OPERATIONS
  // =============================================================================

  async openCropModal(): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    await this.#cropModal.open(schedule, async (cropSettings: CropSettings) => {
      const updates = { ...schedule, crop: cropSettings }
      await this.#scheduleManager.update(schedule.id, updates)

      this.#updateCropFormInputs(cropSettings)

      if (this.#previewGenerator.autoRefresh) {
        this.loadPreview()
      }
    })
  }

  #updateCropFormInputs(crop: CropSettings): void {
    const cropEnabledInput = document.getElementById(
      's_crop_enabled',
    ) as HTMLInputElement | null
    const cropXInput = document.getElementById(
      's_crop_x',
    ) as HTMLInputElement | null
    const cropYInput = document.getElementById(
      's_crop_y',
    ) as HTMLInputElement | null
    const cropWidthInput = document.getElementById(
      's_crop_width',
    ) as HTMLInputElement | null
    const cropHeightInput = document.getElementById(
      's_crop_height',
    ) as HTMLInputElement | null

    if (cropEnabledInput) cropEnabledInput.checked = crop.enabled
    if (cropXInput) cropXInput.value = String(crop.x)
    if (cropYInput) cropYInput.value = String(crop.y)
    if (cropWidthInput) cropWidthInput.value = String(crop.width)
    if (cropHeightInput) cropHeightInput.value = String(crop.height)
  }

  closeCropModal(): void {
    this.#cropModal.close()
  }

  resetCrop(): void {
    const schedule = this.#scheduleManager.activeSchedule
    if (schedule) {
      this.#cropModal.reset(schedule)
    }
  }

  applyCropSettings(): void {
    this.#cropModal.apply()
  }

  // =============================================================================
  // DEVICE PRESET OPERATIONS
  // =============================================================================

  applyDevicePreset(): void {
    this.#devicePresetsManager.applyDevicePreset()
  }

  applyDashboardSelection(): void {
    this.#devicePresetsManager.applyDashboardSelection()
  }

  // =============================================================================
  // FETCH URL
  // =============================================================================

  /**
   * Copies the fetch URL (with full origin) to clipboard.
   */
  async copyFetchUrl(): Promise<void> {
    const input = document.getElementById(
      's_fetch_url',
    ) as HTMLInputElement | null
    if (!input) return

    const fullUrl = `${window.location.origin}${input.value}`

    try {
      await navigator.clipboard.writeText(fullUrl)
      // Brief visual feedback
      const copyBtn = input.nextElementSibling as HTMLButtonElement | null
      if (copyBtn) {
        const original = copyBtn.textContent
        copyBtn.textContent = 'Copied!'
        setTimeout(() => {
          copyBtn.textContent = original
        }, 1500)
      }
    } catch {
      // Fallback: select the text for manual copy
      input.value = fullUrl
      input.select()
    }
  }

  // =============================================================================
  // HA MODE TOGGLE
  // =============================================================================

  /**
   * Toggles between Home Assistant mode and Generic URL mode.
   * Saves the mode to config and refreshes the UI.
   */
  async toggleHAMode(enabled: boolean): Promise<void> {
    // Clear target_url when switching to HA mode
    if (enabled) {
      const targetUrlInput = document.getElementById(
        's_target_url',
      ) as HTMLInputElement | null
      if (targetUrlInput) targetUrlInput.value = ''
    }

    // Save the schedule with new ha_mode value and re-render
    await this.updateScheduleFromForm()
  }

  // =============================================================================
  // WEBHOOK FORMAT TOGGLE
  // =============================================================================

  /**
   * Builds a schedule update with BYOS auth config changes.
   * Centralizes the boilerplate of preserving existing BYOS config while updating auth.
   *
   * @param schedule - Current schedule to update
   * @param auth - New auth config (merged with enabled: true)
   * @returns Schedule update ready for persistence
   */
  #buildByosAuthUpdate(
    schedule: Schedule,
    auth: Partial<ByosAuthConfig>,
  ): ScheduleUpdate {
    const existing = schedule.webhook_format?.byosConfig
    return {
      ...schedule,
      webhook_format: {
        format: 'byos-hanami',
        byosConfig: {
          label: existing?.label || 'Home Assistant',
          name: existing?.name || 'ha-dashboard',
          model_id: existing?.model_id || '1',
          preprocessed: existing?.preprocessed ?? true,
          auth: { enabled: true, ...auth },
        },
      },
    }
  }

  /**
   * Toggles between webhook formats and shows/hides format-specific config.
   */
  async toggleWebhookFormat(format: string): Promise<void> {
    const byosSection = document.getElementById('byosConfigSection')
    if (byosSection) {
      byosSection.classList.toggle('hidden', format !== 'byos-hanami')
    }

    // Save the schedule with new webhook format
    await this.updateScheduleFromForm()
  }

  /**
   * Toggles BYOS JWT authentication fields visibility.
   */
  async toggleByosAuth(enabled: boolean): Promise<void> {
    const authFields = document.getElementById('byosAuthFields')
    if (authFields) {
      authFields.classList.toggle('hidden', !enabled)
    }

    // Save the schedule with new auth state
    await this.updateScheduleFromForm()
  }

  /**
   * Authenticates with BYOS server. Credentials are NOT stored.
   */
  async byosLogin(): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule?.webhook_url) {
      await this.#confirmModal.alert({
        title: 'Error',
        message: 'Please enter a webhook URL first.',
        type: 'error',
      })
      return
    }

    const loginInput = document.getElementById(
      's_byos_auth_login',
    ) as HTMLInputElement | null
    const passwordInput = document.getElementById(
      's_byos_auth_password',
    ) as HTMLInputElement | null

    const login = loginInput?.value?.trim()
    const password = passwordInput?.value

    if (!login || !password) {
      await this.#confirmModal.alert({
        title: 'Error',
        message: 'Please enter both email and password.',
        type: 'error',
      })
      return
    }

    try {
      const byosLoginCmd = new ByosLogin()
      const result = await byosLoginCmd.call(
        schedule.webhook_url,
        login,
        password,
      )

      if (!result.success || !result.access_token) {
        await this.#confirmModal.alert({
          title: 'Authentication Failed',
          message: result.error ?? 'Unknown error',
          type: 'error',
        })
        return
      }

      // Save tokens to schedule (NOT credentials)
      const updates = this.#buildByosAuthUpdate(schedule, {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        obtained_at: result.obtained_at,
      })

      await this.#scheduleManager.update(schedule.id, updates)
      this.renderUI()

      await this.#confirmModal.alert({
        title: 'Success',
        message: 'Successfully authenticated with BYOS server.',
        type: 'success',
      })
    } catch (err) {
      await this.#confirmModal.alert({
        title: 'Error',
        message: `Authentication failed: ${(err as Error).message}`,
        type: 'error',
      })
    }
  }

  /**
   * Removes BYOS authentication tokens.
   */
  async byosLogout(): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    const confirmed = await this.#confirmModal.show({
      title: 'Logout from BYOS',
      message:
        'This will remove your authentication tokens. You will need to re-authenticate to send screenshots.',
      confirmText: 'Logout',
      cancelText: 'Cancel',
      confirmClass: 'bg-red-600 hover:bg-red-700',
    })

    if (!confirmed) return

    // Clear auth tokens but keep other BYOS config
    const updates = this.#buildByosAuthUpdate(schedule, {
      access_token: undefined,
      refresh_token: undefined,
      obtained_at: undefined,
    })

    await this.#scheduleManager.update(schedule.id, updates)
    this.renderUI()
  }

  /**
   * Saves manually entered tokens (for users who don't want to enter password).
   */
  async byosSaveManualTokens(): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    const accessTokenInput = document.getElementById(
      's_byos_manual_access_token',
    ) as HTMLInputElement | null
    const refreshTokenInput = document.getElementById(
      's_byos_manual_refresh_token',
    ) as HTMLInputElement | null

    const accessToken = accessTokenInput?.value?.trim()
    const refreshToken = refreshTokenInput?.value?.trim()

    if (!accessToken) {
      await this.#confirmModal.alert({
        title: 'Error',
        message: 'Please enter at least an access token.',
        type: 'error',
      })
      return
    }

    // Save tokens to schedule
    const updates = this.#buildByosAuthUpdate(schedule, {
      access_token: accessToken,
      refresh_token: refreshToken || undefined,
      obtained_at: Date.now(),
    })

    await this.#scheduleManager.update(schedule.id, updates)
    this.renderUI()

    await this.#confirmModal.alert({
      title: 'Success',
      message: 'Tokens saved successfully.',
      type: 'success',
    })
  }

  // =============================================================================
  // ERROR HANDLING
  // =============================================================================

  #showError(message: string): void {
    const content = document.getElementById('tabContent')
    if (content) {
      content.innerHTML = `<p class="text-red-500 text-center py-8">${message}</p>`
    }
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

window.app = new App()

window.addEventListener('load', () => {
  window.app.init()
})
