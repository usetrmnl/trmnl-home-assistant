# TRMNL HA Documentation

## Overview

The add-on runs as a supervised Docker container that:

1. **Authenticates** using a Home Assistant long-lived access token
2. **Navigates** to dashboards using headless Chromium
3. **Captures** screenshots with configurable viewport, theme, and wait times
4. **Processes** images with e-ink optimized dithering via ImageMagick
5. **Uploads** via webhooks at scheduled times

Schedules and configuration persist in `/data` (mounted by Home Assistant Supervisor).

---

## Quick Start

### Home Assistant Add-on (HA OS)

1. Install from the add-on store
2. Create token: **Profile** → **Long-Lived Access Tokens** → **Create Token**
3. Add token to add-on configuration
4. Start add-on and open Web UI

> **⚠️ Connection Issues?** If you can't connect, check the `home_assistant_url` in your add-on config. Use the default `http://homeassistant:8123` (internal Docker name) — NOT `homeassistant.local:8123` (mDNS name). If that still fails, use your device's IP address: `http://192.168.x.x:8123`

### Home Assistant Container (Docker)

> **Note:** HA Container doesn't have an add-on store. Like other add-ons (Mosquitto, Zigbee2MQTT, Node-RED), you run TRMNL HA as a separate container alongside Home Assistant.

> **⚠️ Important: Use IP Address, Not Hostname**
>
> You MUST use your device's actual IP address (e.g., `http://192.168.1.100:8123`), NOT `homeassistant.local:8123`. The `.local` mDNS name doesn't resolve from inside Docker containers.
>
> **Find your IP:** Run `hostname -I` on Linux/Pi, or check your router's device list.

**Add to your existing `docker-compose.yml`:**

Most HA Container users manage services via docker-compose. Just add TRMNL HA as another service:

```yaml
services:
  # Your existing HA service (typically uses network_mode: host)
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: homeassistant
    volumes:
      - /PATH_TO_YOUR_CONFIG:/config
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped
    privileged: true
    network_mode: host

  # Add TRMNL HA alongside your other services
  trmnl-ha:
    image: ghcr.io/usetrmnl/trmnl-ha-amd64:latest
    # ARM64 (Pi 4/5, Apple Silicon): ghcr.io/usetrmnl/trmnl-ha-aarch64:latest
    container_name: trmnl-ha
    restart: unless-stopped
    ports:
      - "10000:10000"
    environment:
      # Use your host's IP since HA uses network_mode: host (see note below)
      - HOME_ASSISTANT_URL=http://192.168.1.x:8123
      - ACCESS_TOKEN=your_long_lived_access_token
      - KEEP_BROWSER_OPEN=true
      - TZ=America/New_York
    volumes:
      - ./trmnl-data:/data

volumes:
  trmnl-data:
```

Then run:
```bash
docker compose up -d
```

**Or quick setup with `docker run`:**

```bash
docker run -d --name trmnl-ha \
  --restart unless-stopped \
  -e HOME_ASSISTANT_URL=http://192.168.1.x:8123 \
  -e ACCESS_TOKEN=your_long_lived_access_token \
  -e TZ=America/New_York \
  -p 10000:10000 \
  -v ./trmnl-data:/data \
  ghcr.io/usetrmnl/trmnl-ha-amd64:latest
```

**Environment Variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `HOME_ASSISTANT_URL` | Yes | Your HA URL (use host IP, e.g., `http://192.168.1.100:8123`) |
| `ACCESS_TOKEN` | Yes* | Long-lived access token (*optional for non-HA sites) |
| `KEEP_BROWSER_OPEN` | No | Keep browser alive between requests (default: `false`) |
| `TZ` | No | Timezone for scheduled captures (e.g., `America/New_York`) |
| `DEBUG_LOGGING` | No | Enable verbose logging (default: `false`) |

Access the Web UI at `http://localhost:10000/`

### Docker (Standalone - Development)

```bash
cd trmnl-ha
cp ha-trmnl/options-dev.json.example ha-trmnl/options-dev.json
```

Edit `options-dev.json`:
```json
{
  "home_assistant_url": "https://your-website.com",
  "keep_browser_open": true
}
```

> **Note:** `home_assistant_url` works with any website. Omit `access_token` for non-HA sites.

```bash
# Development (hot-reload)
./ha-trmnl/scripts/docker-dev.sh

# Production (background)
./ha-trmnl/scripts/docker-build.sh && ./ha-trmnl/scripts/docker-run.sh
```

### Native Bun

```bash
cd trmnl-ha/ha-trmnl
bun install
cp options-dev.json.example options-dev.json
bun run dev
```

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `access_token` | string | *required* | HA long-lived access token |
| `home_assistant_url` | string | `http://homeassistant:8123` | Base URL (works with any website) |
| `timezone` | string | (system) | Timezone for scheduled captures (e.g., `America/New_York`) |
| `keep_browser_open` | bool | `false` | Keep browser alive between requests (faster, more memory) |

> **Timezone Note:** Without a timezone set, scheduled captures run in UTC. Use an [IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) like `America/New_York`, `Europe/London`, or `Asia/Tokyo`. Invalid values silently fall back to UTC (check logs for warnings).

---

## Web UI

Access via **Ingress** (recommended) or directly at `http://homeassistant.local:10000/`

**Features:**

- Interactive screenshot preview with timing/size info
- Schedule management (create/edit/delete)
- Device preset picker (24+ e-ink displays)
- Copyable **Fetch URL** for pull-mode integration (ESPHome, custom setups)
- Manual "Send Now" trigger

**HA Mode Toggle** (when HA is connected):

| Mode | Description |
|------|-------------|
| **ON** | Captures HA dashboards with theme, language, dark mode support |
| **OFF** | Captures any URL (shows Full URL input instead of dashboard path) |

---

## API Reference

### Endpoints

| Mode | Endpoint | Auth | Theme/Lang/Dark |
|------|----------|------|-----------------|
| **HA Mode** | `GET /<dashboard-path>?viewport=...` | Token injected | Supported |
| **Generic** | `GET /?url=<full-url>&viewport=...` | None | N/A |

### Parameters

| Parameter | Required | Values | Description |
|-----------|----------|--------|-------------|
| `viewport` | Yes | `WxH` | Viewport dimensions (e.g., `800x480`) |
| `url` | No | URL | Full URL (overrides dashboard path, enables generic mode) |
| `dithering` | No | flag | Enable e-ink dithering |
| `dither_method` | No | `floyd-steinberg`, `ordered`, `none` | Algorithm (default: `floyd-steinberg`) |
| `palette` | No | `bw`, `gray-4`, `gray-16`, `gray-256` | Color palette |
| `compression_level` | No | `1-9` | PNG compression (default: `9`) |
| `levels_enabled` | No | flag | Enable black/white level adjustments |
| `black_level` | No | `0-100` | Black point (requires `levels_enabled`) |
| `white_level` | No | `0-100` | White point (requires `levels_enabled`) |
| `format` | No | `png`, `jpeg`, `bmp` | Output format (default: `png`) |
| `rotate` | No | `90`, `180`, `270` | Rotation degrees |
| `theme` | No | string | HA theme name (HA mode only) |
| `wait` | No | ms | Wait after page load (default: `750`) |
| `zoom` | No | number | Page zoom (default: `1.0`) |
| `lang` | No | string | UI language code (HA mode only) |
| `dark` | No | flag | Dark mode (HA mode only) |
| `invert` | No | flag | Invert colors |

### Examples

```bash
# HA dashboard (basic)
curl "http://localhost:10000/lovelace/0?viewport=800x480"

# HA dashboard (e-ink optimized)
curl "http://localhost:10000/lovelace/0?viewport=800x480&dithering&dither_method=floyd-steinberg"

# HA with theme + dark mode
curl "http://localhost:10000/lovelace/energy?viewport=480x800&theme=Graphite&dark&rotate=90"

# Any website (generic mode)
curl "http://localhost:10000/?url=https://grafana.local/dashboard&viewport=800x480&dithering"

# External image conversion
curl "http://localhost:10000/?url=https://images.unsplash.com/photo-example&viewport=800x480&dithering&palette=bw" -o dithered.png
```

### Pull vs Push

| Architecture | Description | Use Case |
|--------------|-------------|----------|
| **Pull (Fetch URL)** | Device requests image on-demand via HTTP GET | ESPHome, custom e-ink, TRMNL BYOS, testing |
| **Push (Webhook)** | Add-on POSTs to webhook on schedule | TRMNL devices, automated updates |

**Pull mode** generates a fresh screenshot on every request. The browser launches automatically if not already running.

**Push mode** captures on a cron schedule and POSTs the image to your webhook URL.

Both modes can be used simultaneously on the same schedule — configure a webhook for push delivery while also using the fetch URL for on-demand access.

---

## Fetch URL (Pull Mode)

Each schedule in the Web UI displays a **Fetch URL** — a direct link that returns a screenshot image with all the schedule's current settings (viewport, dithering, format, etc.) applied.

### How It Works

1. Configure your schedule settings in the Web UI (viewport, dithering, palette, etc.)
2. The **Fetch URL** field shows the computed URL with all parameters
3. Click **Copy** to get the full URL
4. Configure your device or client to GET that URL

Any HTTP client that requests the URL receives the screenshot as a binary image response.

### URL Format

**HA mode (dashboard screenshots):**
```
http://<host>:10000/<dashboard-path>?viewport=800x480&dithering&dither_method=floyd-steinberg&palette=gray-4
```

**Generic mode (any website):**
```
http://<host>:10000/?url=https://example.com&viewport=800x480&dithering&palette=bw
```

### Use Cases

**ESPHome e-ink display:**
```yaml
display:
  - platform: waveshare_epaper
    # ...
    lambda: |-
      # Fetch image from TRMNL HA
      it.image(0, 0, id(ha_screenshot));

http_request:
  - url: "http://192.168.1.x:10000/lovelace/0?viewport=800x480&dithering&palette=gray-4"
    method: GET
```

**Cron job (Linux/macOS):**
```bash
# Save a screenshot every 15 minutes
*/15 * * * * curl -s "http://192.168.1.x:10000/lovelace/0?viewport=800x480&dithering" -o /tmp/dashboard.png
```

**Any HTTP client:**
```bash
# One-off fetch
curl "http://192.168.1.x:10000/lovelace/0?viewport=800x480&dithering&palette=bw&format=bmp" -o dashboard.bmp
```

### Performance Notes

- **Cold start:** First request launches the browser (~3-5s), subsequent requests reuse it
- **Idle timeout:** Browser shuts down after 60s of inactivity (configurable via `BROWSER_TIMEOUT`)
- **Keep warm:** Set `KEEP_BROWSER_OPEN=true` to keep the browser alive between requests
- **Concurrent requests:** Requests are queued and processed sequentially

---

## Scheduling

Create cron-based schedules via the Web UI for automatic captures.

**Storage:** `/data/schedules.json` (persists across restarts)

**Manual Trigger:** Click **Send Now** to execute immediately.

### Cron Syntax

```
┌─ minute (0-59)
│ ┌─ hour (0-23)
│ │ ┌─ day of month (1-31)
│ │ │ ┌─ month (1-12)
│ │ │ │ ┌─ day of week (0-6, Sun=0)
* * * * *
```

| Expression | Meaning |
|------------|---------|
| `*/15 * * * *` | Every 15 minutes |
| `0 * * * *` | Every hour |
| `0 6-22 * * *` | Hourly, 6 AM - 10 PM |
| `0 8,18 * * *` | At 8 AM and 6 PM |

---

## Device Presets

The Web UI includes 24+ presets for common e-ink displays:

- TRMNL OG (800x480)
- Waveshare displays (various sizes)
- Generic e-paper panels

Presets auto-configure viewport, rotation, dithering, and format.

---

## Webhook Formats

The add-on supports multiple webhook payload formats for different e-ink display backends:

| Format | Use Case |
|--------|----------|
| **Raw** (default) | TRMNL devices, custom endpoints |
| **BYOS Hanami** | Self-hosted [BYOS](https://github.com/usetrmnl/byos) servers |

See **[Webhook Formats Guide](docs/webhook-formats.md)** for:
- Detailed format specifications
- JWT authentication setup for BYOS
- How to add custom webhook formats

---

## Troubleshooting

### Proxmox Users

Set VM CPU type to `host` (not `kvm64`) for Chromium sandbox compatibility.

### Browser Crashes

1. Check add-on logs for errors
2. Set `keep_browser_open: false` to enable auto-recovery
3. Ensure 512MB+ memory available

**Recovery system:** Stage 1 restarts browser → Stage 2 restarts container if Stage 1 fails repeatedly.

### Image Quality

1. Use e-ink theme ([Graphite](https://github.com/TilmanGriesel/graphite) recommended)
2. Enable dithering: `dithering&dither_method=floyd-steinberg`
3. Match viewport to display dimensions exactly
4. Increase `wait` if icons don't load: `wait=2000`

### Dashboard Not Loading

1. Verify access token is valid
2. Check dashboard path is correct
3. Increase `wait` for complex dashboards

### HA Connection Issues

**Most common cause:** Using `homeassistant.local:8123` instead of the IP address.

| URL Type | Works? | Use Case |
|----------|--------|----------|
| `http://192.168.x.x:8123` | ✅ Yes | Always works (recommended) |
| `http://homeassistant:8123` | ✅ Yes | HA OS add-on only (internal Docker name) |
| `http://homeassistant.local:8123` | ❌ No | mDNS doesn't resolve inside containers |

**To find your IP:**
- Linux/Pi: `hostname -I`
- macOS: `ipconfig getifaddr en0`
- Or check your router's connected devices list

The Web UI shows diagnostic banner with status, URL, and masked token. Add `?refresh=1` to force reconnection.

---

## Security

**Network:** Designed for trusted home networks only.

| Recommendation | Reason |
|----------------|--------|
| Use Ingress | Port 10000 has no authentication |
| Never expose port 10000 | No rate limiting or auth |
| Use dedicated token | Revoke to disable access |

**Token handling:** Stored in HA config, passed in-memory only.

**AppArmor profile (TODO):** Restricts access to `/app`, `/data`, `/tmp`; blocks raw sockets and kernel modules.

---

## Health Monitoring

```bash
curl http://localhost:10000/health | jq
```

```json
{
  "status": "ok",
  "uptime": 3600,
  "browser": {
    "healthy": true,
    "consecutiveFailures": 0,
    "totalRecoveries": 0
  }
}
```

| Field | Description |
|-------|-------------|
| `status` | `ok` or `error` |
| `uptime` | Seconds since start |
| `browser.healthy` | Chromium responding |
| `browser.consecutiveFailures` | Sequential failures |
| `browser.totalRecoveries` | Total restarts |

---

## Local Development

### Requirements

- [Bun](https://bun.sh) 1.3.5+
- Docker (for container testing)

### Setup

```bash
cd trmnl-ha/ha-trmnl
cp options-dev.json.example options-dev.json
# Edit with your target URL
```

### Development (Hot-Reload)

```bash
# Docker (recommended)
./scripts/docker-dev.sh --build   # First time
./scripts/docker-dev.sh           # Subsequent runs

# Native Bun (faster, requires local Chrome)
bun install && bun run dev
```

- `.ts` changes → auto-restart
- `html/` changes → refresh browser
- Data persists in `/tmp/trmnl-data/`

### Production Testing

```bash
./scripts/docker-build.sh && ./scripts/docker-run.sh
```

### Scripts

| Script | Purpose |
|--------|---------|
| `docker-dev.sh` | Hot-reload development |
| `docker-build.sh` | Build production image |
| `docker-run.sh` | Run in background |
| `docker-stop.sh` | Stop container |
| `docker-health.sh` | Check health |
| `docker-logs.sh` | View logs |

### Testing

```bash
bun test              # All tests
bun test --coverage   # With coverage
bun run lint          # ESLint
```

---

## Attribution

Based on [puppet](https://github.com/balloob/home-assistant-addons/tree/main/puppet) by [Paulus Schoutsen](https://github.com/balloob).

**Enhancements:**
- TypeScript rewrite with strict typing
- Bun runtime (from Node.js)
- ImageMagick dithering with strategy pattern (from Sharp)
- Cron scheduler with Web UI and webhooks
- Expanded from 1 to 24+ device presets
