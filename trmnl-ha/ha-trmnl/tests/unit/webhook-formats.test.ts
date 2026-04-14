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

  const imageBuffer = Buffer.from('test')

  describe('URI mode (with screenshotUrl)', () => {
    const screenshotUrl =
      'http://192.168.1.100:10000/lovelace/default?viewport=800x480&dithering=&dither_method=floyd-steinberg&palette=gray-4'

    it('sends uri instead of data', () => {
      const result = transformer.transform(imageBuffer, 'png', validConfig, screenshotUrl)
      const payload = JSON.parse(result.body as string)

      expect(payload.screen.uri).toBe(screenshotUrl)
      expect(payload.screen.data).toBeUndefined()
      expect(payload.screen.file_name).toBeUndefined()
    })

    it('includes label, name, model_id, and preprocessed', () => {
      const result = transformer.transform(imageBuffer, 'png', validConfig, screenshotUrl)
      const payload = JSON.parse(result.body as string)

      expect(payload.screen.label).toBe('Home Assistant')
      expect(payload.screen.name).toBe('ha-dashboard')
      expect(payload.screen.model_id).toBe('1')
      expect(payload.screen.preprocessed).toBe(true)
    })

    it('sets Content-Type to application/json', () => {
      const result = transformer.transform(imageBuffer, 'png', validConfig, screenshotUrl)

      expect(result.contentType).toBe('application/json')
    })
  })

  describe('data mode (legacy fallback, no screenshotUrl)', () => {
    it('returns JSON string body', () => {
      const result = transformer.transform(imageBuffer, 'png', validConfig)

      expect(typeof result.body).toBe('string')
      expect(() => JSON.parse(result.body as string)).not.toThrow()
    })

    it('sets Content-Type to application/json', () => {
      const result = transformer.transform(imageBuffer, 'png', validConfig)

      expect(result.contentType).toBe('application/json')
    })

    it('base64 encodes image data correctly', () => {
      // NOTE: Uses a distinctive payload so the round-trip decode is meaningful
      const distinctiveBuffer = Buffer.from('test image data')
      const result = transformer.transform(distinctiveBuffer, 'png', validConfig)
      const payload = JSON.parse(result.body as string)

      const decoded = Buffer.from(payload.screen.data, 'base64').toString()
      expect(decoded).toBe('test image data')
    })

    it('includes all required BYOS fields', () => {
      const result = transformer.transform(imageBuffer, 'png', validConfig)
      const payload = JSON.parse(result.body as string)

      expect(payload.screen).toBeDefined()
      expect(payload.screen.data).toBeDefined()
      expect(payload.screen.label).toBe('Home Assistant')
      expect(payload.screen.name).toBe('ha-dashboard')
      expect(payload.screen.model_id).toBe('1')
      expect(payload.screen.file_name).toBe('ha-dashboard.png')
      expect(payload.screen.preprocessed).toBe(true)
    })

    it('sets correct file_name extension for JPEG', () => {
      const result = transformer.transform(imageBuffer, 'jpeg', validConfig)
      const payload = JSON.parse(result.body as string)

      expect(payload.screen.file_name).toBe('ha-dashboard.jpeg')
    })

    it('sets correct file_name extension for BMP', () => {
      const result = transformer.transform(imageBuffer, 'bmp', validConfig)
      const payload = JSON.parse(result.body as string)

      expect(payload.screen.file_name).toBe('ha-dashboard.bmp')
    })
  })

  describe('explicit delivery_mode selection', () => {
    const screenshotUrl = 'http://192.168.1.100:10000/lovelace/default?viewport=800x480'

    it('respects explicit data mode even when screenshotUrl is present', () => {
      const config = { ...validConfig, delivery_mode: 'data' as const }
      const result = transformer.transform(imageBuffer, 'png', config, screenshotUrl)
      const payload = JSON.parse(result.body as string)

      expect(payload.screen.data).toBeDefined()
      expect(payload.screen.file_name).toBe('ha-dashboard.png')
      expect(payload.screen.uri).toBeUndefined()
    })

    it('uses uri mode when explicitly selected and screenshotUrl is present', () => {
      const config = { ...validConfig, delivery_mode: 'uri' as const }
      const result = transformer.transform(imageBuffer, 'png', config, screenshotUrl)
      const payload = JSON.parse(result.body as string)

      expect(payload.screen.uri).toBe(screenshotUrl)
      expect(payload.screen.data).toBeUndefined()
    })

    it('throws when uri mode is explicitly selected but screenshotUrl is missing', () => {
      const config = { ...validConfig, delivery_mode: 'uri' as const }

      expect(() => transformer.transform(imageBuffer, 'png', config)).toThrow(
        /URI mode requires "Add-on URL"/,
      )
    })

    it('treats legacy config (no delivery_mode, no url) as data mode', () => {
      const result = transformer.transform(imageBuffer, 'png', validConfig)
      const payload = JSON.parse(result.body as string)

      expect(payload.screen.data).toBeDefined()
      expect(payload.screen.uri).toBeUndefined()
    })

    it('defaults to uri when delivery_mode is unset but screenshotUrl is present', () => {
      const result = transformer.transform(imageBuffer, 'png', validConfig, screenshotUrl)
      const payload = JSON.parse(result.body as string)

      expect(payload.screen.uri).toBe(screenshotUrl)
      expect(payload.screen.data).toBeUndefined()
    })
  })

  it('throws error when config is missing', () => {
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
    const config = {
      format: 'unknown-format',
    } as unknown as WebhookFormatConfig
    const transformer = getTransformer(config)

    expect(transformer).toBeInstanceOf(RawFormatTransformer)
  })
})
