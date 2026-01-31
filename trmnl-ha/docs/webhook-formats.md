# Webhook Formats

When uploading screenshots via webhooks, the add-on supports multiple payload formats to integrate with different e-ink display backends.

## Supported Formats

| Format | Content-Type | Use Case |
|--------|--------------|----------|
| **Raw** (default) | `image/png`, `image/jpeg`, `image/bmp` | Direct binary upload to TRMNL or custom endpoints |
| **BYOS Hanami** | `application/json` | Self-hosted [BYOS](https://github.com/usetrmnl/byos) servers |

---

## Raw Format

The default format sends the image binary directly as the request body. This is the simplest format and works with most webhook endpoints.

**Request:**
```http
POST /your-webhook-endpoint
Content-Type: image/png
Authorization: Bearer <optional-token>

<binary image data>
```

**When to use:** TRMNL devices, custom webhook endpoints, any service expecting raw image uploads.

---

## BYOS Hanami Format

For self-hosted [BYOS (Build Your Own Server)](https://github.com/usetrmnl/byos) installations, this format wraps the image in a JSON payload with metadata.

**Request:**
```http
POST /api/screens
Content-Type: application/json
Authorization: <jwt-access-token>

{
  "screen": {
    "data": "<base64-encoded-image>",
    "label": "Home Assistant",
    "name": "ha-dashboard",
    "model_id": "1"
  }
}
```

### Configuration Fields

| Field | Description |
|-------|-------------|
| `label` | Display name shown in BYOS UI |
| `name` | Unique screen identifier (slug format) |
| `model_id` | BYOS device model ID (from your BYOS setup) |
| `preprocessed` | Whether the image is already optimized for e-ink |

### JWT Authentication

BYOS requires JWT authentication. You can either:

1. **Login via UI:** Enter your BYOS credentials in the schedule settings. The add-on exchanges them for tokens (credentials are NOT stored).
2. **Manual tokens:** Paste your access and refresh tokens directly if you prefer not to enter credentials.

Tokens auto-refresh when expired (25-minute validity, refreshed before 30-minute expiry).

### 422 Error Handling

If BYOS returns `422 Unprocessable Entity` (screen already exists), the add-on automatically:
1. Lists existing screens via `GET /api/screens`
2. Finds and deletes the screen with matching `model_id`
3. Retries the upload

---

## Adding Custom Formats

The webhook system uses a **Strategy Pattern** for extensibility. To add a new format:

### 1. Define the Format Type

Add your format to `types/domain.ts`:

```typescript
// Add to WebhookFormat union type
export type WebhookFormat = 'raw' | 'byos-hanami' | 'your-format'

// Add config interface if needed
export interface YourFormatConfig {
  apiKey: string
  // ... other fields
}
```

### 2. Create a Transformer

Add a new file `lib/scheduler/your-format-transformer.ts` or add to `webhook-formats.ts`:

```typescript
import type { FormatTransformer, WebhookPayload } from './webhook-formats.js'
import type { ImageFormat } from '../../types/domain.js'

export class YourFormatTransformer implements FormatTransformer {
  transform(
    imageBuffer: Buffer,
    format: ImageFormat,
    config?: YourFormatConfig,
  ): WebhookPayload {
    // Transform the image buffer into your payload format
    return {
      body: JSON.stringify({
        image: imageBuffer.toString('base64'),
        // ... your format's structure
      }),
      contentType: 'application/json',
    }
  }
}
```

### 3. Register the Transformer

Update `getTransformer()` in `lib/scheduler/webhook-formats.ts`:

```typescript
export function getTransformer(
  formatConfig?: WebhookFormatConfig | null,
): FormatTransformer {
  const format = formatConfig?.format ?? 'raw'

  switch (format) {
    case 'byos-hanami':
      return new ByosHanamiFormatTransformer()
    case 'your-format':
      return new YourFormatTransformer()
    default:
      return new RawFormatTransformer()
  }
}
```

### 4. Add UI Controls (Optional)

If your format needs configuration, add form fields in `html/js/ui-renderer.ts`:

```typescript
// In #renderWebhookFormatSection()
if (format === 'your-format') {
  html += `
    <div class="form-group">
      <label>API Key</label>
      <input type="text" name="your_api_key" value="${config?.apiKey ?? ''}" />
    </div>
  `
}
```

### 5. Write Tests

Add tests in `tests/unit/webhook-formats.test.ts`:

```typescript
describe('YourFormatTransformer', () => {
  it('transforms image to your format', () => {
    const transformer = new YourFormatTransformer()
    const result = transformer.transform(testBuffer, 'png', { apiKey: 'test' })

    expect(result.contentType).toBe('application/json')
    // ... verify payload structure
  })
})
```

---

## Architecture Overview

```
Schedule Execution
       ↓
ScheduleExecutor.call()
       ↓
uploadToWebhook(options)
       ↓
getTransformer(webhookFormat)  ← Strategy selection
       ↓
transformer.transform(buffer, format, config)
       ↓
fetch(webhookUrl, { body, headers })
```

The transformer is responsible for:
- Converting the image buffer to the target payload format
- Setting the appropriate `Content-Type` header
- Encoding data as needed (base64, multipart, etc.)
