# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
The version mirrors the [LaraPaper](https://github.com/usetrmnl/larapaper) release
the add-on bundles, so add-on 0.45.1 ships LaraPaper 0.45.1. A wrapper-only fix
between upstream releases takes a `-1`, `-2` suffix.

Each entry starts with the bundled LaraPaper release's own notes (on the version that
first bundles it), followed by the add-on's own changes under "Home Assistant add-on".

## [0.45.1] - 2026-10-21

### LaraPaper 0.45.1

From the [LaraPaper 0.45.1 release](https://github.com/usetrmnl/larapaper/releases/tag/0.45.1):

#### SECURITY RELEASE 🚨

* Critical PHP security release 2026-10-21 (CVE-2026-109618, CVE-2026-109619)
* Bumps the Docker base image to PHP 8.4.27

Updating is strongly recommended for Docker Image deployments. Bare-metal deployments should upgrade to PHP 8.4.27.

**Full Changelog**: [0.45.0...0.45.1](https://github.com/usetrmnl/larapaper/compare/0.45.0...0.45.1)

### LaraPaper 0.45.0

From the [LaraPaper 0.45.0 release](https://github.com/usetrmnl/larapaper/releases/tag/0.45.0):

#### What's Changed
* feat: enhance plugin context with additional device and settings information
* fix(#285): use default stderr stream logger
* fix(#285): increase default http client timeout to 15 sec
* fix: access to lab settings for the first user only

### Home Assistant add-on

- LaraPaper 0.45.1 as a Home Assistant add-on: its data in `/data`, the web UI
  through ingress (screen images included), confined by an AppArmor profile.
