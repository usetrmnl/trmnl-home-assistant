[![AI Coauthored](https://img.shields.io/badge/AI_Coauthored-↗_see_details-58a6ff?style=flat)](https://coauthored.dev/#v:1;o:~Y29hdXRob3JlZC5kZXY;created:2026-01-01;scope:project;intent:spike,prod;traj:stable;ai:code,debug,refactor,test,doc,arch;tools:~Q2xhdWRlIENvZGU;review:spot,ran,aitests,iter;strengths:backend,domain;confident:security,perf;limits:bugs,debt;env:external;data:medium;valid:unit,integ,e2e,perf;focus:arch,security,edge;notes:~SW4gZ2VuZXJhbCB0aGlzIGlzIGEgd29ya2luZyBidXQgdW5yZWZpbmVkIGNvZGViYXNlLiBUaGVyZSBpcyBjb25maWRlbmNlIGluIHRoZSBnZW5lcmFsIGFwcHJvYWNoLCBzZWN1cml0eSwgaW50ZWdyYXRpb24gd2l0aCBIb21lIEFzc2lzdGFudCBldGMuIEhvd2V2ZXIgdGhlcmUgaXMgdGVjaG5pY2FsIGRlYnQgaW4gdGVybXMgb2YgY29tbWl0IGhpc3RvcnksIGFyY2hpdGVjdHVyZSBwYXR0ZXJucywgYW5kIGluIGEgbGluZS1ieS1saW5lIGNvZGUgcmV2aWV3IG9mIHRoZSBpbnRlcm5hbHMu)

# TRMNL HA

![TRMNL Logo](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/logo.png?raw=true)

Send Home Assistant dashboard screenshots to your TRMNL e-ink display with advanced dithering optimized for e-paper screens.

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fusetrmnl%2Ftrmnl-home-assistant)

**Note:** This add-on can capture screenshots from **any website**, not just Home Assistant dashboards. See [Standalone Mode](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#standalone-mode) for detailed setup.

## Features

- **E-ink optimized dithering** - Floyd-Steinberg and Ordered algorithms for crisp e-paper rendering
- **TRMNL webhook integration** - Automatic dashboard uploads to TRMNL devices
- **Fetch URL (pull mode)** - Direct URL for on-demand screenshots, works with ESPHome and custom e-ink setups
- **Scheduled captures** - Cron-based automation with Web UI management
- **Device presets** - Pre-configured settings for 24+ popular e-ink displays
- **Crash recovery** - Automatic browser recovery and process supervision
- **High performance** - Powered by Bun runtime for fast startup and low memory

## Installation

### Home Assistant OS (Recommended)

1. Add this repository to Home Assistant:
   - Go to **Settings** → **Add-ons** → **Add-on Store** → **⋮** → **Repositories**
   - Add: `https://github.com/usetrmnl/trmnl-home-assistant`

2. Install the **TRMNL HA** add-on

3. Configure your access token:
   - In Home Assistant: **Profile** → **Long-Lived Access Tokens** → **Create Token**
   - Add to the add-on configuration

4. Start the add-on and open the Web UI

### Home Assistant Container (Docker)

Running HA as a Docker container? No problem! Just one command:

```bash
docker run -d --name trmnl-ha \
  --restart unless-stopped \
  -e HOME_ASSISTANT_URL=http://YOUR_HOST_IP:8123 \
  -e ACCESS_TOKEN=your_token_here \
  -p 10000:10000 \
  -v ./trmnl-data:/data \
  ghcr.io/usetrmnl/trmnl-ha-amd64:latest # ARM64 (Pi 4/5, Apple Silicon): ghcr.io/usetrmnl/trmnl-ha-aarch64:latest
```

> **Note:** Replace `YOUR_HOST_IP` with your machine's IP (e.g., `192.168.1.100`). Container names like `homeassistant` won't work since HA uses host networking.

Then open `http://localhost:10000` - that's it!

See [full Docker setup](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#home-assistant-container-docker) for Docker Compose and timezone configuration.

### Proxmox Users

If running Home Assistant OS in Proxmox, set the VM host type to `host` for Chromium to work properly.

## Security

**Important:** This add-on is designed for trusted home networks.

- The Web UI (port 10000) has **no built-in authentication**
- **Always use Ingress** (sidebar integration) instead of direct port access
- **Never expose port 10000** directly to the internet
- Access tokens are stored securely in Home Assistant's add-on configuration

## Documentation

| Topic | Description |
|-------|-------------|
| [Configuration](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#configuration) | Required and optional settings |
| [Web UI](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#web-ui) | Using the web interface |
| [API Reference](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#api-reference) | Screenshot endpoint parameters |
| [Fetch URL (Pull Mode)](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#fetch-url-pull-mode) | On-demand screenshots via direct URL |
| [Device Presets](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#device-presets) | Supported e-ink displays |
| [Scheduled Captures](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#scheduled-captures) | Cron-based automation |
| [Webhook Formats](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/docs/webhook-formats.md) | TRMNL, BYOS, and custom endpoints |
| [Troubleshooting](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#troubleshooting) | Common issues and fixes |
| [Local Development](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md#local-development) | Development setup |

## Attribution

This project is based on the [puppet](https://github.com/balloob/home-assistant-addons/tree/main/puppet) Home Assistant add-on by [Paulus Schoutsen](https://github.com/balloob).

See the [NOTICE](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/NOTICE) file for complete attribution and modification details.

## License

Copyright (c) Paulus Schoutsen (original work)
Copyright (c) 2024-2025 TRMNL (enhancements and modifications)

Licensed under the [Apache License 2.0](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/LICENSE)

## Links

- [TRMNL](https://usetrmnl.com)
- [Documentation](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/DOCS.md)
- [Changelog](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/CHANGELOG.md)
- [Upstream Project (puppet)](https://github.com/balloob/home-assistant-addons)
