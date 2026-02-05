/**
 * Pure helper functions for configuration logic
 * Extracted from const.ts for testability
 *
 * @module lib/config-helpers
 */

import { existsSync, readFileSync } from 'fs'

/**
 * Options configuration interface
 */
export interface Options {
  home_assistant_url?: string
  access_token?: string
  timezone?: string
  chromium_executable?: string
  keep_browser_open?: boolean
  debug_logging?: boolean
  server_port?: number
}

/**
 * Error thrown when options file parsing fails
 */
export class OptionsParseError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly cause: Error,
  ) {
    super(`Failed to parse config file: ${filePath}`)
    this.name = 'OptionsParseError'
  }
}

/**
 * Safely parse options JSON file
 * @param filePath - Path to the options JSON file
 * @returns Parsed options object
 * @throws OptionsParseError if file cannot be read or parsed
 */
export function parseOptionsFile(filePath: string): Options {
  try {
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as Options
  } catch (err) {
    throw new OptionsParseError(
      filePath,
      err instanceof Error ? err : new Error(String(err)),
    )
  }
}

/**
 * Common browser paths by platform
 * Puppeteer will use its bundled Chromium if none are found
 */
export const BROWSER_PATHS = [
  // Docker / Linux
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Windows (WSL paths)
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
] as const

/**
 * Find first available browser executable from known paths
 * @returns Path to browser executable, or undefined if none found
 */
export function findBrowser(): string | undefined {
  return BROWSER_PATHS.find(existsSync)
}

/**
 * Validate timezone against IANA timezone database
 * @param timezone - Timezone string to validate (e.g., "America/New_York")
 * @returns true if timezone is valid IANA timezone name
 */
export function isValidTimezone(timezone: string): boolean {
  const validTimezones = Intl.supportedValuesOf('timeZone')
  return validTimezones.includes(timezone)
}

/**
 * Check if running with environment variable configuration
 * @param env - Environment variables object (defaults to process.env)
 * @returns true if HOME_ASSISTANT_URL or ACCESS_TOKEN env vars are set
 */
export function hasEnvConfig(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env['HOME_ASSISTANT_URL'] || env['ACCESS_TOKEN'])
}

/**
 * Determine if running as Home Assistant add-on
 *
 * Detection methods (in order of reliability):
 * 1. SUPERVISOR_TOKEN env var - injected by HA Supervisor into all add-ons
 * 2. /data/options.json exists without env config - fallback for edge cases
 *
 * @param env - Environment variables object
 * @param optionsFile - Path to options file (if found)
 * @returns true if running as HA add-on, false for standalone mode
 */
export function detectIsAddOn(
  env: Record<string, string | undefined>,
  optionsFile: string | undefined,
): boolean {
  return Boolean(
    env['SUPERVISOR_TOKEN'] ||
    (optionsFile === '/data/options.json' && !hasEnvConfig(env)),
  )
}

/**
 * Parse boolean from environment variable string
 * @param value - String value from env var
 * @param defaultValue - Default if undefined
 * @returns Parsed boolean value
 */
export function parseEnvBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue
  return value === 'true'
}

/**
 * Network error detection patterns
 */
export const NETWORK_ERROR_PATTERNS = [
  'Network error',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION_REFUSED',
  'ERR_INTERNET_DISCONNECTED',
] as const

/**
 * Check if error is a network-related error
 * @param error - Error to check
 * @returns true if error message contains network error patterns
 */
export function isNetworkError(error: Error): boolean {
  return NETWORK_ERROR_PATTERNS.some((pattern) =>
    error.message?.includes(pattern),
  )
}
