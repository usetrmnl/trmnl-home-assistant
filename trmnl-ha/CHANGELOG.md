# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.8] - 2026-02-11

### Changed

- Refactored header crop to user-controlled preset
- Fixed screenshot clip height being 56px too short
## [0.6.7] - 2026-02-11

### Changed

- Added DismissToasts command to screenshot pipeline
## [0.6.6] - 2026-02-11

### Changed

- Lint and type check
## [0.6.5] - 2026-02-11

### Changed

- Refactored browser to fresh-page-per-request model
## [0.6.4] - 2026-02-11

### Changed

- Fixed stale dashboard rendering with panel remount
## [0.6.3] - 2026-02-09

### Changed

- Fixed stale dashboard screenshots on repeated requests
## [0.6.2] - 2026-02-07

### Changed

- Fixed theme persistence leaking to user profile
## [0.6.1] - 2026-02-05

### Changed

- Fixed Fetch URL to use server port instead of ingress origin
## [0.6.0] - 2026-02-05

### Changed

- Added configurable server port for standalone mode
- Refactored BYOS 422 handling to use PATCH instead of delete and recreate
- Added Fetch URL feature for pull-mode integration
## [0.5.0] - 2026-01-31

### Changed

- Added BYOS Hanami webhook format with JWT authentication
- Added startup logging and safe config parsing
## [0.4.12] - 2026-01-20

### Changed

- Added color-7b and color-8a palettes with dynamic UI
## [0.4.11] - 2026-01-20

### Changed

- Fixed wait parameter to use explicit fixed delay
## [0.4.10] - 2026-01-20

### Changed

- Added smart wait detection for slow-loading widgets
- Fixed trailing slash in Home Assistant URL causing connection failures
## [0.4.9] - 2026-01-19

### Changed

- Added explicit invalid token detection and user guidance
## [0.4.8] - 2026-01-19

### Changed

- Fixed HTTPS connections with self-signed and real certificates
## [0.4.7] - 2026-01-15

### Fixed

- Correct ImageMagick level args
## [0.4.6] - 2026-01-12

### Changed

- Added Docker Container support with environment variables
## [0.4.5] - 2026-01-09

### Changed

- Added ImageMagick 7 Q16-HDRI for consistent dithering
- Added Cyan and 8-color palette support for e-ink displays
## [0.4.4] - 2026-01-09

### Changed

- Fixed washed-out gray output by enabling normalize for all palettes
## [0.4.3] - 2026-01-09

### Changed

- Added main branch validation to release script
- Refactored Bun installation to use official Docker image
- Updated docker scripts to auto-copy config example
- Fixed Bun installation for CPUs without AVX2 support
## [0.4.2] - 2026-01-07

### Added

- Add Claude Code GitHub Action (collaborators only)

### Changed

- Fixed color palette dithering to preserve PLTE chunk
## [0.4.1] - 2026-01-05

### Changed

- Update docs with absolute links
- Update docs to explain push vs pull architecture
- Update docs for non-ha setup clarity
## [0.4.0] - 2026-01-04

### Changed

- Updated schedule execution to return detailed webhook results
- Manual black/white level adjustments with `levels_enabled` toggle
- PNG compression level control (`compression_level` parameter)
- Added Generic URL mode for capturing any website
- Updated image processing to use ImageMagick
- Removed dead code and consolidated duplicate functionality
- Fix failing spec due to CI timing

## [0.3.2] - 2025-12-30

### Changed

- Revert "Simulates TRMNL firmware inversion in preview UI"
## [0.3.1] - 2025-12-30

### Changed

- Simulates TRMNL firmware inversion in preview UI
## [0.3.0] - 2025-12-30

### Changed

- Adds structured logging with LogTape
- Fix cli release script
## [0.2.2] - 2025-12-30

### Changed

- Update readme, metadata, hass support
## [0.2.1] - 2025-12-29

### Added

- Type-safe JSON serialization utility

## [0.2.0] - 2025-12-29

### Changed

- Rewritten in TypeScript for improved type safety and maintainability

## [0.1.0] - 2025-12-27

### Added

- Initial public release of TRMNL Home Assistant Add-on
- Screenshot capture of Home Assistant dashboards with headless Chromium
- Advanced e-ink optimized dithering (Floyd-Steinberg, Ordered algorithms)
- ImageMagick image processing with strategy pattern
- Bun runtime for high performance and low memory usage
- Web UI for interactive screenshot preview and configuration
- Cron-based schedule management with Web UI
- Device presets for popular e-ink displays
- TRMNL webhook integration for automated uploads
- Browser health monitoring and automatic crash recovery
- Process supervision with built-in log rotation
- API endpoint with configurable parameters
- Home Assistant ingress support for sidebar integration
- Health endpoint for monitoring system status

### Attribution

Based on the [puppet](https://github.com/balloob/home-assistant-addons/tree/main/puppet) Home Assistant add-on by Paulus Schoutsen.

---

[0.2.1]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.2.0...v0.2.1
[0.2.2]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.2.1...v0.2.2
[0.3.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.2.2...v0.3.0
[0.3.1]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.3.0...v0.3.1
[0.3.2]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.3.1...v0.3.2
[0.4.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.3.2...v0.4.0
[0.4.1]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.0...v0.4.1
[0.4.2]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.1...v0.4.2
[0.4.3]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.2...v0.4.3
[0.4.4]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.3...v0.4.4
[0.4.5]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.4...v0.4.5
[0.4.6]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.5...v0.4.6
[0.4.7]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.6...v0.4.7
[0.4.8]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.7...v0.4.8
[0.4.9]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.8...v0.4.9
[0.4.10]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.9...v0.4.10
[0.4.11]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.10...v0.4.11
[0.4.12]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.11...v0.4.12
[0.5.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.4.12...v0.5.0
[0.6.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.5.0...v0.6.0
[0.6.1]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.0...v0.6.1
[0.6.2]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.1...v0.6.2
[0.6.3]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.2...v0.6.3
[0.6.4]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.3...v0.6.4
[0.6.5]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.4...v0.6.5
[0.6.6]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.5...v0.6.6
[0.6.7]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.6...v0.6.7
[0.6.8]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.7...v0.6.8
[0.2.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.1.0...v0.2.0
