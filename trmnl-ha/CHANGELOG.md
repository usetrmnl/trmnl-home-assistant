# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
[0.2.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.1.0...v0.2.0
