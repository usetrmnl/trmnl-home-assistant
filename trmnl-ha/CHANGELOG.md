# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.3] - 2026-07-17

### Added

- Node runtime fallback for CPUs that Bun's baseline build cannot run on: the image ships Node alongside Bun and the entrypoint falls back to it automatically when Bun fails to start (#24). Set the `RUNTIME` environment variable to `node` or `bun` to force a choice.
- The AppArmor profile is fixed and enabled: it now grants the paths the current image needs and runs in enforce mode, blocking access to `/config`, `/ssl`, and execution from `/data` (#27)
- Troubleshooting entry for a blank add-on page or stalled scheduler, covering the recovery steps for the symptom reported in #46

## [0.9.2] - 2026-07-17

### Added

- Pipeline timing metrics: every capture stage (browser launch, navigation, readiness waits, screenshot, dithering, webhook upload) is timed, with rolling p50/p95 summaries exposed on `/health` — slow installs can now be diagnosed from data (#57)

### Changed

- Navigation waits for the page load event instead of network idle, cutting ~400ms from every capture. Readiness is detected by the checks that follow (hass state, loading indicators, paint stability), which the network-idle window duplicated
- The Home Assistant readiness check now logs a warning when it times out instead of a debug line — a capture that always spends the full 5s timeout is the usual cause of slow-capture reports (#57)
- Webhook delivery and browser request serialization were restructured for maintainability, and the test suite was consolidated with coverage added for previously untested retry and error paths

### Fixed

- Captures without a theme or dark-mode setting no longer pay a 500ms "theme changed" settle wait on every screenshot — a fresh page compared `false` against `undefined` and re-applied the default theme each time
- A malformed webhook URL now surfaces the connection error naming the URL, instead of failing with a bare TypeError while composing that message

## [0.9.1] - 2026-07-17

### Added

- `timestamp_12h` add-on option (`TIMESTAMP_12H` environment variable in standalone) to render the capture-time overlay in 12-hour AM/PM format instead of the 24-hour default (#68)

### Changed

- Webhook connection failures now name the unreachable host and point at the usual culprit — local hostnames that don't resolve inside the add-on container (#71)
- The preview's over-50KB warning is now spelled out next to the file size instead of hiding in a hover tooltip — oversized images can crash-loop TRMNL devices (#70)

### Fixed

- Orphaned Chromium/crashpad processes are now reaped: the container runs under `tini` as PID 1, so periodic browser restarts no longer accumulate zombie processes (#72)
- A failed BYOS token refresh no longer discards the stored access token, which turned a refresh 400 (Terminus rotates refresh tokens on use) into an unauthenticated push and a 401 on nearly every scheduled cycle. The push now falls back to the stored token, which stock Terminus keeps valid (#75)
- BYOS URI delivery no longer renders every dashboard twice: the URI sent to the BYOS server now points at the capture saved by that run (served at `/output/`), instead of a live screenshot endpoint that triggered a second full Chromium render when fetched (#74)
- Dashboard paths with query params like Kiosk Mode's `?kiosk` no longer fail with HTTP 400: previews join system params with `&` instead of a second `?`, and unknown query params on screenshot requests are forwarded to the Home Assistant page URL instead of being dropped (#44)
- WebSocket-driven cards (weather forecasts, render templates) intermittently rendered empty when the HA frontend lost its `subscribeMessage` registration race and discarded the subscription data. Navigation now watches for the orphaned-subscription console warning and soft-retries by re-mounting the panel on the live page, preserving the warm WebSocket connection that wins the race — thanks @michael-fritzsch (#55)
- "Send Now" on a disabled schedule no longer deletes the capture it just saved when no other schedules are enabled — the retention limit previously computed to zero files

## [0.9.0] - 2026-06-24

### Added

- Interval-based scheduling — pick a simple "every N minutes/hours" cadence instead of writing cron. Cron remains as an advanced escape hatch for specific times and weekdays, and existing cron schedules that map to a simple interval are migrated automatically on load
- Schedule jitter — a small random delay (up to 30s, configurable via `SCHEDULER_JITTER_MAX_MS`) before each capture, so installs don't all hit the TRMNL server on the same second

### Changed

- The scheduler now backs off when the TRMNL server returns 429 or 503, honouring the `Retry-After` header (5-minute default when absent), instead of retrying on the next tick

## [0.8.2] - 2026-06-12

### Added

- Optional capture-time overlay: a small timestamp in the bottom-right corner of the screenshot, enabled globally via the `timestamp_overlay` add-on option, per schedule, or with the `timestamp` URL parameter, so stale screens are visible at a glance
- Configurable navigation timeout: `navigation_timeout_ms` add-on option (`NAVIGATION_TIMEOUT` environment variable in standalone) for complex dashboards on slower hardware (#58)

### Changed

- BYOS tokens now refresh once they are 10 minutes old (was 25), so restarts and outages of up to ~20 minutes no longer kill the refresh chain
- When stored BYOS tokens expire beyond the refresh window, the scheduler logs one clear re-authenticate warning instead of failing silently at send time
- Failed previews now show the server's failure details instead of only the HTTP status

### Fixed

- BYOS token operations (login, logout, manual save) no longer reset Delivery Mode to legacy or clear the Add-on URL (#62)
- BYOS access tokens are refreshed proactively on the scheduler tick. Terminus only accepts refreshes while the 30-minute access token is still valid, so the previous send-time-only refresh failed with 401s for any schedule running less often than every 30 minutes
- Scheduler reload no longer re-registers cron jobs and logs every 60 seconds when schedules are unchanged (#64)
- Replaced cron jobs are now destroyed instead of stopped, preventing unbounded task accumulation in node-cron's registry
- Device preset selection is now saved on the schedule and restored on every render — it previously reset to "Custom Configuration" immediately, inviting re-picks that overwrote customised viewport, crop, rotation and format values
- Timezone validation no longer warns on valid zone aliases like Etc/UTC, the Docker image's default TZ
- A non-numeric NAVIGATION_TIMEOUT value no longer disables the navigation timeout entirely

## [0.8.1] - 2026-04-16

### Added

- Add colour palletes and new devices

### Changed

- Update kobo device rotation
- Fixed PNG chunk stripping breaking TRMNL firmware

### Fixed

- Use -colors 2 instead of -monochrome for Floyd-Steinberg 1-bit dithering
## [0.8.0] - 2026-04-14

### Changed

- Added BYOS Hanami URI delivery mode
- Change viewport size for TRMNL X
## [0.7.0] - 2026-03-06

### Changed

- Updated dashboard dropdown to use HA panels API
## [0.6.9] - 2026-02-12

### Changed

- Fixed BYOS JWT token refresh not persisting
- Increase spec coverage
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
[0.6.9]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.8...v0.6.9
[0.7.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.6.9...v0.7.0
[0.8.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.7.0...v0.8.0
[0.8.1]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.8.0...v0.8.1
[0.8.2]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.8.1...v0.8.2
[0.9.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.8.2...v0.9.0
[0.9.1]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.9.0...v0.9.1
[0.9.2]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.9.1...v0.9.2
[0.9.3]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.9.2...v0.9.3
[0.2.0]: https://github.com/usetrmnl/trmnl-home-assistant/compare/v0.1.0...v0.2.0
