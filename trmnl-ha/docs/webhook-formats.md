# Webhook Formats

When uploading screenshots via webhooks, the add-on supports multiple payload formats to integrate with different e-ink display backends.

## Supported Formats

| Format | Content-Type | Use Case |
|--------|--------------|----------|
| **Raw** (default) | `image/png`, `image/jpeg`, `image/bmp` | Direct binary upload to TRMNL or custom endpoints |
| **BYOS Hanami** | `application/json` | Self-hosted [Terminus / BYOS Hanami](https://github.com/usetrmnl/terminus) servers |

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

For self-hosted [Terminus / BYOS Hanami](https://github.com/usetrmnl/terminus) installations, this format wraps the screen metadata in a JSON payload and delivers the image to `POST /api/screens`.

### Delivery Modes

Terminus supports two incompatible payload shapes depending on its version. The add-on exposes both via a **Delivery Mode** dropdown in the schedule UI.

| Mode | Terminus versions | Image transport |
|------|-------------------|-----------------|
| **URI** (recommended) | `≥ 0.11.0`, required from `0.52.0` onward | Terminus fetches the image from the add-on over HTTP |
| **Legacy base64** | `≤ 0.51.0` only | Add-on inlines the image as base64 in the JSON body |

Base64 support was removed from Terminus in `0.52.0` (released 2026-04-01). New installations should pick **URI** mode; older deployments can stay on **Legacy base64** until they upgrade.

### URI Mode

In URI mode, the add-on sends a small JSON payload referencing a screenshot endpoint on the add-on itself. Terminus then calls back to that URL, downloads the dithered image, and stores it.

**Request:**
```http
POST /api/screens
Content-Type: application/json
Authorization: <jwt-access-token>

{
  "screen": {
    "uri": "http://192.168.1.100:10000/lovelace/0?viewport=800x480&dithering=&dither_method=floyd-steinberg&palette=gray-4",
    "label": "Home Assistant",
    "name": "ha-dashboard",
    "model_id": "1",
    "preprocessed": true
  }
}
```

**Requirements:**

- `preprocessed: true` tells Terminus to use the image as-is without running its own dithering. The add-on always sends preprocessed images since it dithers locally.
- The add-on's screenshot endpoint must be reachable without authentication, or the Add-on URL must include any credentials Terminus needs.
- If URI mode is selected but **Add-on URL** is blank, the add-on throws a clear error at delivery time rather than silently falling back.

#### Setting the Add-on URL

> ⚠️ **This is the URL Terminus will use to reach the add-on — not the URL you use in your browser.**
>
> The Add-on URL field must resolve from *Terminus's* network vantage point, not yours. If Terminus runs in Docker on the same host, `http://localhost:10000` will **not** work — inside the Terminus container, `localhost` points at the container itself, and nothing is listening on port `10000` there.

Think of it as two asymmetric network hops:

```
You (browser) ──────▶ Add-on UI       (your browser resolves "localhost")
Add-on ──────▶ Terminus               (webhook URL, see "Webhook URL" field)
Terminus ──────▶ Add-on screenshot    (Add-on URL, see this section)
```

The second and third hops resolve DNS from different vantage points, so the Webhook URL and the Add-on URL often need to be different strings even when both services are on the same physical machine.

Pick the value that matches your deployment topology:

| Where Terminus runs | Set Add-on URL to | Notes |
|---|---|---|
| Docker on the same host as the add-on (Docker Desktop on Mac/Windows) | `http://host.docker.internal:10000` | Docker Desktop's built-in DNS name for the host machine |
| Docker on the same Linux host | `http://172.17.0.1:10000` or your LAN IP | `172.17.0.1` is the default docker bridge gateway; LAN IP also works |
| A different machine on the same LAN | `http://<add-on-lan-ip>:10000` | Use the add-on host's routable IP, never `localhost` |
| Behind a reverse proxy / public URL | `https://trmnl.example.com` | Whatever public hostname forwards to the add-on's port 10000 |
| As a Home Assistant add-on, accessed via ingress | The add-on's ingress URL | See your HA installation's external ingress configuration |

**Verification shortcut.** Before retrying a failed schedule, shell into the Terminus container and confirm it can reach the add-on:

```sh
docker compose -p terminus-development exec web \
  curl -sI http://host.docker.internal:10000/health
# Expected: HTTP/1.1 200 OK
```

If that curl fails, fix the URL before touching anything else — every downstream error (`ECONNREFUSED`, `improper image header` from MiniMagick, 500 from Terminus) traces back to this one setting.

### Legacy Base64 Mode

Legacy mode embeds the image directly in the JSON body. Keep it selected only if your Terminus is `≤ 0.51.0`.

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
    "model_id": "1",
    "file_name": "ha-dashboard.png",
    "preprocessed": true
  }
}
```

### Backward Compatibility

Schedules created before this feature shipped have no `delivery_mode` field in their stored config. The add-on treats them as follows:

- No `delivery_mode` + no Add-on URL → **Legacy base64** (preserves pre-existing behavior)
- No `delivery_mode` + Add-on URL configured → **URI**
- Explicit `delivery_mode: 'data'` → **Legacy base64** (user choice wins even if Add-on URL is set)
- Explicit `delivery_mode: 'uri'` → **URI** (throws if Add-on URL is missing)

### Configuration Fields

| Field | Description |
|-------|-------------|
| `label` | Display name shown in BYOS UI |
| `name` | Unique screen identifier (slug format) |
| `model_id` | BYOS device model ID (from your BYOS setup) |
| `preprocessed` | Whether the image is already optimized for e-ink (always `true` from the add-on) |
| `delivery_mode` | `'uri'` or `'data'`. Omitted on legacy schedules. |
| `addon_base_url` | URL of this add-on as reachable **from Terminus**, required for URI mode. See [Setting the Add-on URL](#setting-the-add-on-url). |

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
    screenshotUrl?: string,
  ): WebhookPayload {
    // Transform the image buffer into your payload format.
    // `screenshotUrl` is only set for URI-mode formats (see BYOS Hanami).
    // Formats that inline the image can ignore it.
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
#buildScreenshotUrl(schedule)   ← URI mode only; undefined otherwise
       ↓
uploadToWebhook(options)
       ↓
getTransformer(webhookFormat)   ← Strategy selection
       ↓
transformer.transform(buffer, format, config, screenshotUrl)
       ↓                         ← BYOS transformer branches on delivery_mode
fetch(webhookUrl, { body, headers })
```

For BYOS in URI mode, Terminus then performs a second round-trip back to the add-on's screenshot endpoint to download the actual image.

The transformer is responsible for:
- Converting the image buffer to the target payload format
- Setting the appropriate `Content-Type` header
- Encoding data as needed (base64, multipart, etc.)
