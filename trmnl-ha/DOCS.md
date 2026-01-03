# TRMNL HA Documentation

Complete documentation for the TRMNL Home Assistant add-on.

## How It Works

The add-on runs inside your Home Assistant instance as a supervised Docker container. It:

1. **Authenticates** using a Home Assistant long-lived access token
2. **Navigates** to your dashboards using headless Chromium
3. **Captures** screenshots with configurable viewport, theme, and wait times
4. **Processes** images with e-ink optimized dithering via ImageMagick
5. **Uploads** via webhooks at scheduled times

The add-on persists schedules and configuration in the `/data` directory (mounted by Home Assistant Supervisor).

## Configuration

### Required Options

| Option | Type | Description |
|--------|------|-------------|
| `access_token` | string | Home Assistant long-lived access token |

Create a token in Home Assistant: **Profile** → **Long-Lived Access Tokens** → **Create Token**

```yaml
access_token: "your-long-lived-token-here"
```

### Optional Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `home_assistant_url` | string | `http://homeassistant:8123` | Override HA URL (for SSL/custom hostname) |
| `keep_browser_open` | bool | `false` | Keep browser alive between requests (faster, more memory) |

```yaml
home_assistant_url: "https://ha.example.com:8123"
keep_browser_open: true
```

## Web UI

Access the Web UI to configure and preview screenshots:

- **Via Ingress (recommended):** Click **Open Web UI** on the add-on page in Home Assistant
- **Direct access (local only):** `http://homeassistant.local:10000/`

The UI provides:

- Interactive screenshot preview with timing information
- Schedule management (create/edit/delete cron schedules)
- Device preset picker (TRMNL OG, etc.)
- Manual "Send Now" trigger

## API Reference

### Screenshot Endpoint

Request any Home Assistant dashboard path with viewport dimensions:

```
GET /<dashboard-path>?<parameters>
```

### Examples

```bash
# Basic screenshot
http://homeassistant.local:10000/lovelace/0?viewport=800x480

# E-ink optimized (recommended)
http://homeassistant.local:10000/lovelace/0?viewport=800x480&dithering&dither_method=floyd-steinberg&bit_depth=2

# With theme
http://homeassistant.local:10000/lovelace/0?viewport=800x480&theme=Graphite%20E-ink%20Light

# Dark mode with rotation
http://homeassistant.local:10000/lovelace/energy?viewport=480x800&rotate=90&dark
```

### Parameters

| Parameter | Required | Values | Description |
|-----------|----------|--------|-------------|
| `viewport` | Yes | `WxH` | Viewport dimensions (e.g., `800x480`) |
| `dithering` | No | flag | Enable advanced dithering for e-ink |
| `dither_method` | No | `floyd-steinberg`, `ordered`, `none` | Dithering algorithm (default: `floyd-steinberg`) |
| `bit_depth` | No | `1`, `2`, `4`, `8` | Bits per pixel for dithering |
| `format` | No | `png`, `jpeg`, `bmp` | Output format (default: `png`) |
| `rotate` | No | `90`, `180`, `270` | Rotation in degrees |
| `theme` | No | string | Home Assistant theme name |
| `wait` | No | number | Wait time in ms after page load (default: `750`) |
| `zoom` | No | number | Page zoom level (default: `1.0`) |
| `lang` | No | string | UI language code (e.g., `nl`) |
| `dark` | No | flag | Enable dark mode |

## Device Presets

The Web UI includes presets for 24+ common e-ink displays, including:

- TRMNL OG (800x480)
- Waveshare displays (various sizes)
- Generic e-paper panels

Select a preset to automatically configure viewport, rotation, dithering, and format settings optimized for that device.

## Scheduled Captures

Use the Web UI to create cron-based schedules for automatic dashboard captures.

### Schedule Storage

Schedules are stored in `/data/schedules.json` and persist across container restarts.

### Manual Trigger

Click **Send Now** next to any schedule to execute immediately without waiting for the next cron interval.

### Cron Syntax

Standard cron expressions are supported:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

Examples:
- `*/15 * * * *` - Every 15 minutes
- `0 * * * *` - Every hour
- `0 6-22 * * *` - Every hour from 6 AM to 10 PM
- `0 8,18 * * *` - At 8 AM and 6 PM

## Troubleshooting

### Proxmox VM Settings

If running Home Assistant OS in Proxmox, set the VM host type to `host` for Chromium to work properly. The default `kvm64` CPU type may cause issues with the browser sandbox.

### Chrome Crashes

If the browser crashes repeatedly:

1. Check the add-on logs for error messages
2. Ensure `keep_browser_open: false` to allow automatic recovery
3. Verify sufficient memory is available (recommended: 512MB+ for the add-on)

The add-on includes automatic crash detection and two-stage recovery:
- Stage 1: Restart the browser process
- Stage 2: Full container restart if Stage 1 fails repeatedly

### Image Quality Issues

For best e-ink results:

1. **Use an e-ink optimized theme** - [Graphite](https://github.com/TilmanGriesel/graphite) is recommended
2. **Enable dithering** - Add `dithering&dither_method=floyd-steinberg&bit_depth=2`
3. **Set proper viewport** - Match your display's exact dimensions
4. **Adjust wait time** - Increase if icons/images don't load: `wait=2000`

### Dashboard Not Loading

1. Verify the access token is valid and not expired
2. Check that the dashboard path is correct
3. Increase the `wait` parameter if the dashboard has many dynamic elements

## Security Considerations

### Network Isolation

- The add-on is designed for trusted home networks only
- Port 10000 has **no built-in authentication**
- Always use **Ingress** (sidebar integration) for access
- Never expose port 10000 directly to the internet

### Access Token Handling

- Tokens are stored securely in Home Assistant's add-on configuration
- Tokens are passed to the browser in memory, not written to disk
- Use a dedicated token for this add-on (revoke it to disable access)

### AppArmor Profile (TODO)

The add-on includes an AppArmor security profile that:

- Restricts file access to `/app`, `/data`, and `/tmp` only
- Allows network access for HTTP server and webhooks
- Blocks raw sockets and packet capture
- Prevents kernel module loading and mounting

## Local Development

### Requirements

- [Bun](https://bun.sh) 1.3.5 or later
- Docker (for container testing)

### Quick Start

```bash
cd trmnl-ha/ha-trmnl
bun install
bun run dev
```

### Docker Scripts

```bash
./scripts/docker-build.sh    # Build Docker image
./scripts/docker-run.sh      # Run container with volume mount
./scripts/docker-health.sh   # Check health status
./scripts/docker-logs.sh     # View logs
./scripts/docker-rebuild.sh  # Stop → Remove → Build → Run
./scripts/docker-stop.sh     # Stop container
```

### Local Configuration

1. Copy `options-dev.json.sample` to `options-dev.json`
2. Add your Home Assistant URL and access token
3. Run `./scripts/docker-run.sh`

**Data persistence:** Schedules and configuration persist in `/tmp/trmnl-data/` across container rebuilds.

### Development Commands

```bash
bun run dev              # Development mode with hot reload
bun run main.js          # Production mode
bun test                 # Run all tests
bun test --coverage      # Tests with coverage
bun run lint             # ESLint
```

## Health Monitoring

### Health Endpoint

```bash
curl http://localhost:10000/health | jq
```

### Response

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

### Health Status

| Field | Description |
|-------|-------------|
| `status` | `ok` or `error` |
| `uptime` | Seconds since container start |
| `browser.healthy` | Whether Chromium is responding |
| `browser.consecutiveFailures` | Failed health checks in a row |
| `browser.totalRecoveries` | Total browser restarts since startup |

## Enhancements from Upstream

This add-on is based on the [puppet](https://github.com/balloob/home-assistant-addons/tree/main/puppet) add-on with major enhancements:

- **TypeScript Rewrite:** Full rewrite with strict typing and modern ES modules
- **Runtime Migration:** Migrated from Node.js to Bun for improved performance
- **Image Processing Rewrite:** Replaced Sharp with ImageMagick, implementing strategy pattern for dithering algorithms
- **Scheduler System:** Added cron-based automation with Web UI management and webhook integration
- **Browser Health & Recovery:** Automatic crash detection and two-stage recovery system
- **Comprehensive Testing:** Unit and integration tests
- **Expanded Device Support:** Grew from 1 to 24+ device presets
