/**
 * Unit tests for Configuration Helpers
 *
 * Tests pure functions extracted from const.ts for:
 * - Timezone validation
 * - Environment detection
 * - Browser path detection
 * - Network error detection
 *
 * @module tests/unit/config-helpers
 */

import { describe, it, expect } from 'bun:test'
import {
  isValidTimezone,
  hasEnvConfig,
  detectIsAddOn,
  parseEnvBoolean,
  isNetworkError,
  BROWSER_PATHS,
  NETWORK_ERROR_PATTERNS,
} from '../../lib/config-helpers.js'

// =============================================================================
// Timezone Validation
// =============================================================================

describe('isValidTimezone', () => {
  describe('valid IANA timezone names', () => {
    it('accepts America/New_York', () => {
      expect(isValidTimezone('America/New_York')).toBe(true)
    })

    it('accepts Europe/London', () => {
      expect(isValidTimezone('Europe/London')).toBe(true)
    })

    it('accepts Asia/Tokyo', () => {
      expect(isValidTimezone('Asia/Tokyo')).toBe(true)
    })

    it('accepts UTC', () => {
      expect(isValidTimezone('UTC')).toBe(true)
    })

    it('accepts Pacific/Auckland', () => {
      expect(isValidTimezone('Pacific/Auckland')).toBe(true)
    })

    it('accepts Etc/GMT offset format', () => {
      expect(isValidTimezone('Etc/GMT+5')).toBe(true)
    })
  })

  describe('invalid timezone values', () => {
    it('rejects EST abbreviation', () => {
      expect(isValidTimezone('EST')).toBe(false)
    })

    it('rejects PST abbreviation', () => {
      expect(isValidTimezone('PST')).toBe(false)
    })

    it('rejects GMT abbreviation', () => {
      expect(isValidTimezone('GMT')).toBe(false)
    })

    it('rejects bogus timezone', () => {
      expect(isValidTimezone('Fake/City')).toBe(false)
    })

    it('rejects empty string', () => {
      expect(isValidTimezone('')).toBe(false)
    })

    it('rejects offset format', () => {
      expect(isValidTimezone('UTC+5')).toBe(false)
    })

    it('rejects numeric offset', () => {
      expect(isValidTimezone('+05:30')).toBe(false)
    })
  })
})

// =============================================================================
// Environment Config Detection
// =============================================================================

describe('hasEnvConfig', () => {
  it('returns true when HOME_ASSISTANT_URL is set', () => {
    const env = { HOME_ASSISTANT_URL: 'http://192.168.1.100:8123' }

    expect(hasEnvConfig(env)).toBe(true)
  })

  it('returns true when ACCESS_TOKEN is set', () => {
    const env = { ACCESS_TOKEN: 'my-token' }

    expect(hasEnvConfig(env)).toBe(true)
  })

  it('returns true when both are set', () => {
    const env = {
      HOME_ASSISTANT_URL: 'http://192.168.1.100:8123',
      ACCESS_TOKEN: 'my-token',
    }

    expect(hasEnvConfig(env)).toBe(true)
  })

  it('returns false when neither is set', () => {
    const env = {}

    expect(hasEnvConfig(env)).toBe(false)
  })

  it('returns false when values are undefined', () => {
    const env = {
      HOME_ASSISTANT_URL: undefined,
      ACCESS_TOKEN: undefined,
    }

    expect(hasEnvConfig(env)).toBe(false)
  })

  it('returns false when values are empty strings', () => {
    const env = {
      HOME_ASSISTANT_URL: '',
      ACCESS_TOKEN: '',
    }

    expect(hasEnvConfig(env)).toBe(false)
  })
})

// =============================================================================
// Add-on Detection
// =============================================================================

describe('detectIsAddOn', () => {
  describe('SUPERVISOR_TOKEN detection (primary method)', () => {
    it('returns true when SUPERVISOR_TOKEN is present', () => {
      const env = { SUPERVISOR_TOKEN: 'abc123' }

      expect(detectIsAddOn(env, undefined)).toBe(true)
    })

    it('returns true even with env config when SUPERVISOR_TOKEN present', () => {
      const env = {
        SUPERVISOR_TOKEN: 'abc123',
        HOME_ASSISTANT_URL: 'http://192.168.1.100:8123',
      }

      expect(detectIsAddOn(env, '/data/options.json')).toBe(true)
    })
  })

  describe('options file detection (fallback method)', () => {
    it('returns true for /data/options.json without env config', () => {
      const env = {}

      expect(detectIsAddOn(env, '/data/options.json')).toBe(true)
    })

    it('returns false for /data/options.json WITH env config', () => {
      const env = { HOME_ASSISTANT_URL: 'http://192.168.1.100:8123' }

      expect(detectIsAddOn(env, '/data/options.json')).toBe(false)
    })

    it('returns false for options-dev.json', () => {
      const env = {}

      expect(detectIsAddOn(env, './options-dev.json')).toBe(false)
    })
  })

  describe('standalone mode detection', () => {
    it('returns false when using env vars only', () => {
      const env = {
        HOME_ASSISTANT_URL: 'http://192.168.1.100:8123',
        ACCESS_TOKEN: 'my-token',
      }

      expect(detectIsAddOn(env, undefined)).toBe(false)
    })

    it('returns false for local dev with options-dev.json', () => {
      const env = {}

      expect(detectIsAddOn(env, './options-dev.json')).toBe(false)
    })

    it('returns false when no config at all', () => {
      const env = {}

      expect(detectIsAddOn(env, undefined)).toBe(false)
    })
  })
})

// =============================================================================
// Boolean Environment Variable Parsing
// =============================================================================

describe('parseEnvBoolean', () => {
  it('returns true for "true" string', () => {
    expect(parseEnvBoolean('true', false)).toBe(true)
  })

  it('returns false for "false" string', () => {
    expect(parseEnvBoolean('false', true)).toBe(false)
  })

  it('returns false for any non-"true" string', () => {
    expect(parseEnvBoolean('yes', true)).toBe(false)
    expect(parseEnvBoolean('1', true)).toBe(false)
    expect(parseEnvBoolean('TRUE', true)).toBe(false)
  })

  it('returns default when undefined', () => {
    expect(parseEnvBoolean(undefined, true)).toBe(true)
    expect(parseEnvBoolean(undefined, false)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(parseEnvBoolean('', true)).toBe(false)
  })
})

// =============================================================================
// Network Error Detection
// =============================================================================

describe('isNetworkError', () => {
  it('detects "Network error"', () => {
    const error = new Error('Network error occurred')

    expect(isNetworkError(error)).toBe(true)
  })

  it('detects ERR_NAME_NOT_RESOLVED', () => {
    const error = new Error('net::ERR_NAME_NOT_RESOLVED')

    expect(isNetworkError(error)).toBe(true)
  })

  it('detects ERR_CONNECTION_REFUSED', () => {
    const error = new Error('net::ERR_CONNECTION_REFUSED at http://localhost')

    expect(isNetworkError(error)).toBe(true)
  })

  it('detects ERR_INTERNET_DISCONNECTED', () => {
    const error = new Error('ERR_INTERNET_DISCONNECTED')

    expect(isNetworkError(error)).toBe(true)
  })

  it('returns false for non-network errors', () => {
    const error = new Error('Timeout exceeded')

    expect(isNetworkError(error)).toBe(false)
  })

  it('returns false for generic errors', () => {
    const error = new Error('Something went wrong')

    expect(isNetworkError(error)).toBe(false)
  })

  it('handles errors without message', () => {
    const error = new Error()

    expect(isNetworkError(error)).toBe(false)
  })
})

// =============================================================================
// Constants
// =============================================================================

describe('BROWSER_PATHS', () => {
  it('includes Linux Chromium paths', () => {
    expect(BROWSER_PATHS).toContain('/usr/bin/chromium')
    expect(BROWSER_PATHS).toContain('/usr/bin/chromium-browser')
  })

  it('includes Linux Chrome paths', () => {
    expect(BROWSER_PATHS).toContain('/usr/bin/google-chrome')
    expect(BROWSER_PATHS).toContain('/usr/bin/google-chrome-stable')
  })

  it('includes macOS paths', () => {
    expect(BROWSER_PATHS).toContain(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    )
  })

  it('includes WSL paths', () => {
    expect(BROWSER_PATHS).toContain(
      '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
    )
  })

  it('prioritizes Docker/Linux paths first', () => {
    // First paths should be Linux for Docker compatibility
    expect(BROWSER_PATHS[0]).toBe('/usr/bin/chromium')
  })
})

describe('NETWORK_ERROR_PATTERNS', () => {
  it('includes common network error patterns', () => {
    expect(NETWORK_ERROR_PATTERNS).toContain('Network error')
    expect(NETWORK_ERROR_PATTERNS).toContain('ERR_NAME_NOT_RESOLVED')
    expect(NETWORK_ERROR_PATTERNS).toContain('ERR_CONNECTION_REFUSED')
    expect(NETWORK_ERROR_PATTERNS).toContain('ERR_INTERNET_DISCONNECTED')
  })

  it('has 4 patterns', () => {
    expect(NETWORK_ERROR_PATTERNS.length).toBe(4)
  })
})
