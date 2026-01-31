/**
 * Unit tests for Webhook Format Transformers
 *
 * Tests the strategy pattern implementation for different webhook payload formats.
 *
 * @module tests/unit/webhook-formats
 */

import { describe, it, expect } from 'bun:test'
import {
  RawFormatTransformer,
  ByosHanamiFormatTransformer,
  getTransformer,
} from '../../lib/scheduler/webhook-formats.js'
import type { WebhookFormatConfig } from '../../types/domain.js'

describe('RawFormatTransformer', () => {
  const transformer = new RawFormatTransformer()

  it('returns Buffer body with image buffer contents', () => {
    const imageBuffer = Buffer.from('test image data')
    const result = transformer.transform(imageBuffer, 'png')

    expect(result.body).toBeInstanceOf(Buffer)
    expect((result.body as Buffer).toString()).toBe('test image data')
  })

  it('sets correct Content-Type for PNG', () => {
    const imageBuffer = Buffer.from('test')
    const result = transformer.transform(imageBuffer, 'png')

    expect(result.contentType).toBe('image/png')
  })

  it('sets correct Content-Type for JPEG', () => {
    const imageBuffer = Buffer.from('test')
    const result = transformer.transform(imageBuffer, 'jpeg')

    expect(result.contentType).toBe('image/jpeg')
  })

  it('sets correct Content-Type for BMP', () => {
    const imageBuffer = Buffer.from('test')
    const result = transformer.transform(imageBuffer, 'bmp')

    expect(result.contentType).toBe('image/bmp')
  })
})

describe('ByosHanamiFormatTransformer', () => {
  const transformer = new ByosHanamiFormatTransformer()
  const validConfig = {
    label: 'Home Assistant',
    name: 'ha-dashboard',
    model_id: '1',
    preprocessed: true,
  }

  it('returns JSON string body', () => {
    const imageBuffer = Buffer.from('test image data')
    const result = transformer.transform(imageBuffer, 'png', validConfig)

    expect(typeof result.body).toBe('string')
    // Should be valid JSON
    expect(() => JSON.parse(result.body as string)).not.toThrow()
  })

  it('sets Content-Type to application/json', () => {
    const imageBuffer = Buffer.from('test')
    const result = transformer.transform(imageBuffer, 'png', validConfig)

    expect(result.contentType).toBe('application/json')
  })

  it('base64 encodes image data correctly', () => {
    const imageBuffer = Buffer.from('test image data')
    const result = transformer.transform(imageBuffer, 'png', validConfig)
    const payload = JSON.parse(result.body as string)

    // Decode base64 and verify
    const decoded = Buffer.from(payload.screen.data, 'base64').toString()
    expect(decoded).toBe('test image data')
  })

  it('includes all required BYOS fields', () => {
    const imageBuffer = Buffer.from('test')
    const result = transformer.transform(imageBuffer, 'png', validConfig)
    const payload = JSON.parse(result.body as string)

    expect(payload.screen).toBeDefined()
    expect(payload.screen.data).toBeDefined()
    expect(payload.screen.label).toBe('Home Assistant')
    expect(payload.screen.name).toBe('ha-dashboard')
    expect(payload.screen.model_id).toBe('1')
    expect(payload.screen.file_name).toBe('ha-dashboard.png')
  })

  it('sets correct file_name extension for JPEG', () => {
    const imageBuffer = Buffer.from('test')
    const result = transformer.transform(imageBuffer, 'jpeg', validConfig)
    const payload = JSON.parse(result.body as string)

    expect(payload.screen.file_name).toBe('ha-dashboard.jpeg')
  })

  it('sets correct file_name extension for BMP', () => {
    const imageBuffer = Buffer.from('test')
    const result = transformer.transform(imageBuffer, 'bmp', validConfig)
    const payload = JSON.parse(result.body as string)

    expect(payload.screen.file_name).toBe('ha-dashboard.bmp')
  })

  it('throws error when config is missing', () => {
    const imageBuffer = Buffer.from('test')

    expect(() => transformer.transform(imageBuffer, 'png')).toThrow(
      'BYOS Hanami format requires config with label, name, and model_id',
    )
  })
})

describe('getTransformer factory', () => {
  it('returns RawFormatTransformer for undefined format', () => {
    const transformer = getTransformer(undefined)

    expect(transformer).toBeInstanceOf(RawFormatTransformer)
  })

  it('returns RawFormatTransformer for raw format', () => {
    const config: WebhookFormatConfig = { format: 'raw' }
    const transformer = getTransformer(config)

    expect(transformer).toBeInstanceOf(RawFormatTransformer)
  })

  it('returns ByosHanamiFormatTransformer for byos-hanami format', () => {
    const config: WebhookFormatConfig = {
      format: 'byos-hanami',
      byosConfig: {
        label: 'Test',
        name: 'test',
        model_id: '1',
        preprocessed: true,
      },
    }
    const transformer = getTransformer(config)

    expect(transformer).toBeInstanceOf(ByosHanamiFormatTransformer)
  })

  it('returns RawFormatTransformer for unknown format (defensive fallback)', () => {
    // Force unknown format via type assertion (simulates future format or data corruption)
    const config = {
      format: 'unknown-format',
    } as unknown as WebhookFormatConfig
    const transformer = getTransformer(config)

    expect(transformer).toBeInstanceOf(RawFormatTransformer)
  })
})
