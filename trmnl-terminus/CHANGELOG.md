# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
The version mirrors the [Terminus](https://github.com/usetrmnl/terminus) release
the add-on bundles, so add-on 0.66.0 ships Terminus 0.66.0. A wrapper-only fix
between upstream releases takes a `-1`, `-2` suffix.

## [0.69.0-1] - 2026-08-19

### Added

- Optional add-on options for Terminus settings such as
  `api_access_token_period`, the session and HTTP timeouts, the Puma thread
  and worker counts, the synchronizer toggles, and
  `rack_attack_allowed_subnets`. Each is exported as the matching environment
  variable only when set, so Terminus keeps its own defaults otherwise.

### Changed

- Sessions no longer expire by default. Terminus ends a session 24 hours after
  login however often its token is refreshed, which broke scheduled pushes
  overnight until someone signed in again

## [0.69.0] - 2026-08-17

### Changed

- Updated Terminus to 0.69.0

## [0.68.0] - 2026-08-10

### Changed

- Updated Terminus to 0.68.0

## [0.67.0] - 2026-08-02

### Changed

- Updated Terminus to 0.67.0

## [0.66.0] - 2026-08-02

### Added

- Initial public release of the Terminus Home Assistant Add-on
