# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
The version mirrors the [LaraPaper](https://github.com/usetrmnl/larapaper) release
the add-on bundles, so add-on 0.45.1 ships LaraPaper 0.45.1. A wrapper-only fix
between upstream releases takes a `-1`, `-2` suffix.

Each entry starts with the bundled LaraPaper release's own notes (on the version that
first bundles it), followed by the add-on's own changes under "Home Assistant add-on".

## [0.49.0] - 2026-11-25

### LaraPaper 0.49.0

From the [LaraPaper 0.49.0 release](https://github.com/usetrmnl/larapaper/releases/tag/0.49.0):

LaraPaper 0.49 upgrades the Docker base image to PHP 8.5 and Node.js 26, introduces support for field groups and conditional visibility in recipe configurations, as well as support for private certificates. It also includes improvements to transforms, markup rendering, and boolean configuration values. The open source catalog continues to grow, now featuring over 300 LaraPaper-compatible recipes.

#### What's Changed
* feat(#335): Support private/internal CA for Chromium renders (SPKI pinning) by [@Z0nd0R](https://github.com/Z0nd0R) in [#337](https://github.com/usetrmnl/larapaper/pull/337)
* feat(#318): add support for recipe field groups
* feat: add support for conditional visibility in recipe configuration
* feat(transform): add support for URL, URLSearchParams
* refactor: markup rendering
* fix: inject boolean configuration values as string into Liquid templates
* fix: boolean does not need to be optional in recipe configuration; default: false
* fix: recipes with only shared template should render
* chore: bump default versions: PHP 8.5; node 26
* chore: bump TRMNL_BLADE_FRAMEWORK_VERSION to 3.4.7
* chore: move playlist item text scale into submenu

#### New Contributors
* [@Z0nd0R](https://github.com/Z0nd0R) made their first contribution in [#337](https://github.com/usetrmnl/larapaper/pull/337)

**Full Changelog**: [0.48.0...0.49.0](https://github.com/usetrmnl/larapaper/compare/0.48.0...0.49.0)

### Home Assistant add-on

- Updated LaraPaper to 0.49.0

## [0.48.0] - 2026-11-20

### LaraPaper 0.48.0

From the [LaraPaper 0.48.0 release](https://github.com/usetrmnl/larapaper/releases/tag/0.48.0):

#### SECURITY RELEASE 🚨

* Critical PHP and nginx security release 2026-11-19 (#336)
  * Bumps the Docker base image to PHP 8.4.28
  * Bumps the Docker base image to nginx 1.30.7

Updating is recommended for Docker Image deployments. Bare-metal deployments should upgrade PHP and nginx.

##### Other changes

* feat: share Chromium's HTTP disk cache between renders by [@BartSchuurmans](https://github.com/BartSchuurmans) in [#332](https://github.com/usetrmnl/larapaper/pull/332)
* feat: per-device scale and per-playlist-item text scale setting by [@BartSchuurmans](https://github.com/BartSchuurmans) in [#309](https://github.com/usetrmnl/larapaper/pull/309)
* feat(models): add TRMNL Frame
* fix: framework_version `latest` failing validation

### Home Assistant add-on

- Updated LaraPaper to 0.48.0

## [0.47.0-3] - 2026-11-15

### Home Assistant add-on

- Recipes can read Home Assistant without a Home Assistant token: set the new **Home
  Assistant key for recipes** option, then enter `http://127.0.0.1:8124` as a recipe's
  Home Assistant URL and the key as its access token. The add-on passes on reads
  (states, calendars, history, logbook, templates) and the forecast, calendar event and
  to-do item service calls with its own Home Assistant access, and refuses everything
  else, requests without the key and requests from browsers. Off until a key is set.
  For this the add-on now has Home Assistant API access.
- The add-on's Supervisor token no longer reaches LaraPaper: it used to be in the
  environment of the queue worker and the scheduler, and readable by them in s6's copy
  of the environment, where a Blade recipe could have read it. It now only goes into
  the proxy's root-only config.
- The smoke test checks the proxy against a fake Home Assistant, and that no `www-data`
  process or file holds the token.

## [0.47.0-2] - 2026-11-15

### Home Assistant add-on

- New option **Log level** (`LOG_LEVEL`), `info` by default: LaraPaper logged at
  `debug` before.
- New options **Transform runner URL** and **Transform runner token**: run recipe
  transforms on an external runner such as byos-transform-runner (PHP, Python, Ruby,
  bubblewrap sandbox) instead of LaraPaper's own JavaScript runner.
- New option **Extra environment variables**: any other LaraPaper setting, as a name and
  a value. Removing one restores LaraPaper's default on the next start.

## [0.47.0-1] - 2026-11-15

### Home Assistant add-on

- Screens rendered in LaraPaper's queue worker work again: since 0.46.0-2 the worker
  and the scheduler ran as `www-data` with root's home directory, where Chromium can't
  start, so every queued render failed (the "Pre-render playlist items" Lab feature,
  playlist item cache warm/refresh). They now use `www-data`'s own.
- The smoke test checks both have a home directory they can write.

## [0.47.0] - 2026-11-15

### LaraPaper 0.47.0

From the [LaraPaper 0.47.0 release](https://github.com/usetrmnl/larapaper/releases/tag/0.47.0):

LaraPaper 0.47 introduces Transform, allowing recipes to pass through a transformation step before rendering. JavaScript transforms are supported out of the box. To support additional languages, you can deploy [byos-transform-runner](https://usetrmnl.github.io/larapaper/usage/transform) as a sidecar or [build your own transform provider](https://usetrmnl.github.io/larapaper/usage/transform-provider). See the [Docker Compose example](https://github.com/usetrmnl/larapaper/blob/main/docker/prod-transform/docker-compose.yml) for reference.

This release also adds a new Lab feature that refreshes the cache for the next playlist item before the device requests it, API-based cache control for playlist items, the ability to modify mashup configurations in playlists, cloud proxy support with a custom API key, more reliable web mirroring, and more.

#### What's Changed
* feat: add initial implementation of transform
* feat(#317): added cache control for playlist items via API
* feat(#317): add lab feature to pre-refresh the next playlist item's cache before the device fetches it
* feat(#326): playlist items / mashup can be edited
* feat(api): return the full user shape from /api/me by [@ikraamg](https://github.com/ikraamg) in [#325](https://github.com/usetrmnl/larapaper/pull/325)
* feat(framework): inject palette screen class into template
* feat: enhance Mirror WebUI by [@gablau](https://github.com/gablau) in [#323](https://github.com/usetrmnl/larapaper/pull/323)
* feat: update Device models and palettes
* feat: add proxy_cloud_api to device edit modal
* feat: allow cloud proxy with custom api key; validate connection on toggle
* feat: enhance device logs management with search and clear functionality
* feat: harmonize the device action menu
* feat: bump laravel-liquid to 0.7.0
* fix(#324): update image resolution logic to return null when images are missing, preventing 404 URLs
* docs: add security note to multi-user accounts

#### New Contributors
* [@ikraamg](https://github.com/ikraamg) made their first contribution in [#325](https://github.com/usetrmnl/larapaper/pull/325)

**Full Changelog**: [0.46.0...0.47.0](https://github.com/usetrmnl/larapaper/compare/0.46.0...0.47.0)

### Home Assistant add-on

- Updated LaraPaper to 0.47.0

## [0.46.0-2] - 2026-11-14

### Home Assistant add-on

- LaraPaper's queue worker and scheduler run as `www-data`, as in LaraPaper's own image
  and as the AppArmor profile describes; they ran as root. From LaraPaper 0.47.0 they
  also run recipes' transform code (with the "Pre-render playlist items" Lab feature on).
- The smoke test checks both, and that a recipe transform runs (LaraPaper 0.47.0 and up).

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
