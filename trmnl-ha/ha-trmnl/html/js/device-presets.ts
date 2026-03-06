/**
 * Device Presets Manager Module
 *
 * Manages device presets and Home Assistant integration features.
 * Bridges TRMNL add-on configuration with Home Assistant runtime state.
 *
 * Design Pattern:
 * Integration Adapter Pattern - adapts external HA state (window.hass) to internal forms.
 *
 * NOTE: window.hass only available when running inside Home Assistant.
 * NOTE: When adding HA integrations, always provide fallback behavior.
 *
 * @module html/js/device-presets
 */

import { LoadPresets } from './api-client.js'
import type { PresetsConfig } from '../../types/domain.js'

/** Home Assistant config structure */
interface HassConfig {
  language?: string
}

/** Home Assistant themes structure */
interface HassThemes {
  themes?: Record<string, unknown>
}

/** Dashboard entry from backend */
interface DashboardEntry {
  path: string
  title: string
}

/** Home Assistant global object */
interface Hass {
  themes?: HassThemes
  config?: HassConfig
  dashboards?: DashboardEntry[] | string[]
}

// Extend Window to include Home Assistant global
declare global {
  interface Window {
    hass?: Hass
  }
}

/**
 * Manager coordinating device presets and Home Assistant integration.
 */
export class DevicePresetsManager {
  #loadPresetsCmd: LoadPresets
  #presets: PresetsConfig = {}

  constructor() {
    this.#loadPresetsCmd = new LoadPresets()
  }

  /**
   * Loads device presets from API and renders dropdown options.
   */
  async loadAndRenderPresets(): Promise<void> {
    try {
      this.#presets = await this.#loadPresetsCmd.call()
      this.#renderPresetOptions()
    } catch (err) {
      console.warn('Failed to load presets:', err)
    }
  }

  #renderPresetOptions(): void {
    const select = document.getElementById(
      'devicePreset',
    ) as HTMLSelectElement | null
    if (!select) return

    while (select.options.length > 1) {
      select.remove(1)
    }

    Object.entries(this.#presets).forEach(([presetId, preset]) => {
      const option = document.createElement('option')
      option.value = presetId
      option.textContent = preset.name || presetId
      option.dataset.device = JSON.stringify(preset)
      select.appendChild(option)
    })
  }

  /**
   * Public alias for #renderPresetOptions().
   */
  renderPresets(): void {
    this.#renderPresetOptions()
  }

  /**
   * Restores all dropdown state after DOM re-render.
   */
  afterDOMRender(schedule?: { theme?: string | null }): void {
    this.renderPresets()
    this.populateThemePicker(schedule?.theme ?? null)
    this.populateDashboardPicker()
    this.prefillLanguage()
  }

  /**
   * Applies selected device preset to form inputs.
   */
  applyDevicePreset(): boolean {
    const select = document.getElementById(
      'devicePreset',
    ) as HTMLSelectElement | null
    if (!select) return false

    const option = select.options[select.selectedIndex]

    if (!option.value) {
      document.getElementById('deviceInfo')?.classList.add('hidden')
      return false
    }

    const device = JSON.parse(option.dataset.device || '{}')

    const widthInput = document.getElementById(
      's_width',
    ) as HTMLInputElement | null
    const heightInput = document.getElementById(
      's_height',
    ) as HTMLInputElement | null

    if (widthInput && device.viewport?.width) {
      widthInput.value = device.viewport.width
      widthInput.dispatchEvent(new Event('change'))
    }

    if (heightInput && device.viewport?.height) {
      heightInput.value = device.viewport.height
      heightInput.dispatchEvent(new Event('change'))
    }

    if (device.rotate) {
      const rotateSelect = document.getElementById(
        's_rotate',
      ) as HTMLSelectElement | null
      if (rotateSelect) {
        rotateSelect.value = device.rotate
        rotateSelect.dispatchEvent(new Event('change'))
      }
    }

    if (device.format) {
      const formatSelect = document.getElementById(
        's_format',
      ) as HTMLSelectElement | null
      if (formatSelect) {
        formatSelect.value = device.format
        formatSelect.dispatchEvent(new Event('change'))
      }
    }

    const infoDiv = document.getElementById('deviceInfo')
    const infoPara = infoDiv?.querySelector('p')
    if (infoPara) {
      infoPara.textContent = `Using ${device.name}: ${device.viewport.width}x${
        device.viewport.height
      }${device.rotate ? `, ${device.rotate}° rotation` : ''}`
    }
    infoDiv?.classList.remove('hidden')

    return true
  }

  /**
   * Populates theme dropdown from Home Assistant themes.
   */
  populateThemePicker(selectedTheme: string | null = null): void {
    const themeSelect = document.getElementById(
      's_theme',
    ) as HTMLSelectElement | null
    if (!themeSelect) return

    themeSelect.innerHTML = '<option value="">Default</option>'

    if (!window.hass?.themes?.themes) {
      console.warn('No themes found in window.hass')
      return
    }

    Object.keys(window.hass.themes.themes)
      .sort()
      .forEach((theme) => {
        const option = document.createElement('option')
        option.value = theme
        option.textContent = theme
        if (theme === selectedTheme) {
          option.selected = true
        }
        themeSelect.appendChild(option)
      })
  }

  /**
   * Auto-fills language field from Home Assistant configuration.
   */
  prefillLanguage(): void {
    const langInput = document.getElementById(
      's_lang',
    ) as HTMLInputElement | null
    if (!langInput) return

    if (window.hass?.config?.language && !langInput.value) {
      langInput.value = window.hass.config.language
      langInput.placeholder = window.hass.config.language
    }
  }

  /**
   * Populates dashboard dropdown from Home Assistant dashboards.
   * Supports both { path, title } objects (new) and plain strings (legacy).
   */
  populateDashboardPicker(): void {
    const select = document.getElementById(
      'dashboardSelector',
    ) as HTMLSelectElement | null
    if (!select) return

    while (select.options.length > 1) {
      select.remove(1)
    }

    if (!window.hass?.dashboards || !Array.isArray(window.hass.dashboards)) {
      console.warn('No dashboards found in window.hass - using defaults')

      const defaults = ['/lovelace/0', '/home']
      defaults.forEach((path) => {
        const option = document.createElement('option')
        option.value = path
        option.textContent = path
        select.appendChild(option)
      })
      return
    }

    window.hass.dashboards.forEach((entry) => {
      const option = document.createElement('option')
      if (typeof entry === 'string') {
        option.value = entry
        option.textContent = entry
      } else {
        option.value = entry.path
        option.textContent = `${entry.title} (${entry.path})`
      }
      select.appendChild(option)
    })
  }

  /**
   * Copies selected dashboard path to dashboard input field.
   */
  applyDashboardSelection(): boolean {
    const select = document.getElementById(
      'dashboardSelector',
    ) as HTMLSelectElement | null
    const pathInput = document.getElementById(
      's_path',
    ) as HTMLInputElement | null

    if (!select || !pathInput) return false

    if (select.value) {
      pathInput.value = select.value
      pathInput.dispatchEvent(new Event('change'))

      select.value = ''
      return true
    }

    return false
  }
}
