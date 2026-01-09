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

### Home Assistant Add-on

1. Install from the add-on store
2. Create token: **Profile** → **Long-Lived Access Tokens** → **Create Token**
3. Add token to add-on configuration
4. Start add-on and open Web UI

### Docker (Standalone)

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
| `keep_browser_open` | bool | `false` | Keep browser alive between requests (faster, more memory) |
| `ignore_ssl_errors` | bool | `false` | Accept self-signed SSL certificates (for HTTPS with custom certs) |

---

## Web UI

Access via **Ingress** (recommended) or directly at `http://homeassistant.local:10000/`

**Features:**

- Interactive screenshot preview with timing/size info
- Schedule management (create/edit/delete)
- Device preset picker (24+ e-ink displays)
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
| **Pull** | Display requests image on-demand via HTTP GET | ESPHome, custom e-ink setups, testing |
| **Push** | Add-on POSTs to webhook on schedule | TRMNL devices, automated updates |

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

The Web UI shows diagnostic banner with status, URL, and masked token. Add `?refresh=1` to force reconnection.

### HTTPS / SSL Certificate Issues

If you're using HTTPS with a self-signed certificate (common with nginx/Caddy reverse proxies):

**Symptoms:**
- "Home Assistant not connected"
- "Connection failed - could not reach HA"
- Webhook delivery fails to local endpoints

**Solution:** Enable the `ignore_ssl_errors` option in add-on configuration:

1. Go to add-on **Configuration** tab
2. Set `ignore_ssl_errors: true`
3. Save and restart the add-on

For standalone Docker users, add to `options-dev.json`:
```json
{
  "ignore_ssl_errors": true
}
```

**Note:** This is safe for home network use since you're connecting to your own Home Assistant instance.

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
