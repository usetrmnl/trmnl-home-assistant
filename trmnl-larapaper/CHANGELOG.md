# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
The version mirrors the [LaraPaper](https://github.com/usetrmnl/larapaper) release
the add-on bundles, so add-on 0.45.1 ships LaraPaper 0.45.1. A wrapper-only fix
between upstream releases takes a `-1`, `-2` suffix.

Each entry starts with the bundled LaraPaper release's own notes (on the version that
first bundles it), followed by the add-on's own changes under "Home Assistant add-on".

## [0.46.0-1] - 2026-11-14

### Home Assistant add-on

- **Allow registration** is now **Allow more accounts** (off by default), and sets
  LaraPaper 0.46.0's `MULTIUSER_REGISTRATION_ENABLED`: the old option set
  `REGISTRATION_ENABLED`, which LaraPaper 0.46.0 no longer reads. The first account can
  always register. With more accounts allowed, LaraPaper stops rendering Blade recipes.
- Through ingress, a recipe's rendered image (**Render Image**) now loads from the ingress
  path instead of the App URL.

## [0.46.0] - 2026-11-06

### LaraPaper 0.46.0

From the [LaraPaper 0.46.0 release](https://github.com/usetrmnl/larapaper/releases/tag/0.46.0):

#### SECURITY RELEASE (2) 🚨

This release fixes two security vulnerabilities, one of them Critical, see advisories [GHSA-f3rp-5j6r-j7cp](https://github.com/usetrmnl/larapaper/security/advisories/GHSA-f3rp-5j6r-j7cp) and [GHSA-8242-j995-x55j](https://github.com/usetrmnl/larapaper/security/advisories/GHSA-8242-j995-x55j). All users should upgrade. Some changes are breaking, so read the upgrade notes below before you update.
Bare-metal deployments should also update node to v24.22.1.

##### Other changes

* feat: add playlist list and update API endpoints by [@lollo03](https://github.com/lollo03) in [#312](https://github.com/usetrmnl/larapaper/pull/312)
* feat: selectable plugins for pause and sleep mode, added toggle for mirroring separate device like a physical device by [@Sammyjo20](https://github.com/Sammyjo20) in [#321](https://github.com/usetrmnl/larapaper/pull/321)
* feat: bump `TRMNL_BLADE_FRAMEWORK_VERSION` to 3.4.6
* feat: limit Auto-Join to 15 minutes
* fix: harden device resolution and screen update endpoints; add rate limiting
* fix: harden recipe owner check
* fix(#320): bump to node v24.22.1

#### Upgrade notes
- Blade is disabled automatically once a second user account exists. Single-user instances keep Blade.
- `INSECURE_BLADE_ALLOW_PHP_EXECUTION=true` forces Blade on in multi-user mode, and false forces it off everywhere. Only set it to true if you trust every user, for example in a family or homelab setup.
-  `REGISTRATION_ENABLED` is replaced by `MULTIUSER_REGISTRATION_ENABLED` (default false). The first account can always register, but further signups are closed unless you set `MULTIUSER_REGISTRATION_ENABLED=true`. Remove `REGISTRATION_ENABLED` from your environment.
    - This also applies to new accounts created through OIDC.
- POST /api/screens with the access-token header now returns 401. Send Authorization: Bearer <token> with a token that has the update-screen ability
- Auto-Join is turned off during the upgrade. Turn it on again when you want to add a device. It now switches off by itself after 15 minutes.
- Re-pairing a device that has connected before (for example after a factory reset or WiFi reset) now requires Auto-Join to be on for its owner while the device runs setup. On multi-user instances, delete the device and add it again.

#### New Contributors
* [@lollo03](https://github.com/lollo03) made their first contribution in [#312](https://github.com/usetrmnl/larapaper/pull/312)
* [@Sammyjo20](https://github.com/Sammyjo20) made their first contribution in [#321](https://github.com/usetrmnl/larapaper/pull/321)

**Full Changelog**: [0.45.1...0.46.0](https://github.com/usetrmnl/larapaper/compare/0.45.1...0.46.0)

### Home Assistant add-on

- Updated LaraPaper to 0.46.0

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
