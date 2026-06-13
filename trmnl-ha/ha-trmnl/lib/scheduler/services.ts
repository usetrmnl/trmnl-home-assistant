/**
 * Scheduler Services Manifest
 *
 * Central index of scheduler capabilities.
 * Documents what the scheduler can do at a glance.
 *
 * Following Structural Documentation pattern:
 * - Single entry point for all scheduler operations
 * - Names describe what they do (not how)
 * - All services are stateless functions
 *
 * @module lib/scheduler/services
 */

// Screenshot Operations
export { saveScreenshot, type SaveScreenshotOptions, type SaveResult } from './screenshot-saver.js'
export { cleanupOldScreenshots, type CleanupOptions, type CleanupResult } from './screenshot-cleanup.js'

// Webhook Operations
export { uploadToWebhook, WebhookHttpError, type WebhookDeliveryOptions, type WebhookDeliveryResult } from './webhook-delivery.js'

// Parameter Building
export { buildParams, getDefaults } from './params-builder.js'
