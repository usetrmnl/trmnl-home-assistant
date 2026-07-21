# Terminus Server (BYOS) for Home Assistant

![TRMNL Logo](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/logo.png?raw=true)

This is a Home Assistant add-on that runs a [TRMNL Terminus Server](https://github.com/usetrmnl/terminus) on your instance to enable self-hosted local management of TRMNL devices (BYOS). The server is exposed to port `2300` by default.

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fusetrmnl%2Ftrmnl-home-assistant)

## Installation

### Home Assistant OS (Recommended)

1. Add this repository to Home Assistant:
   - Go to **Settings** → **Add-ons** → **Add-on Store** → **⋮** → **Repositories**
   - Add: `https://github.com/usetrmnl/trmnl-home-assistant`

2. Install the **Terminus Server (BYOS)** add-on

3. Add your Home Assistance instance's information to the add-on's configuration

4. Start the add-on and open the Web UI

## Security

**Important:** This add-on is designed for trusted home networks. While Terminus itself has authentication features, this add-on wrapper does not provide any special security features when it comes to port or database credential accesses.

## License

Copyright (c) 2026 TRMNL

Licensed under the [Apache License 2.0](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-terminus/LICENSE)

## Links

- [TRMNL](https://usetrmnl.com)
- [Terminus](https://github.com/usetrmnl/terminus)
- [Documentation](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-terminus/DOCS.md)
- [Changelog](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-terminus/CHANGELOG.md)
