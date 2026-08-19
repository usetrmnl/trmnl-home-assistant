# Terminus Server (BYOS) for Home Assistant

![TRMNL Logo](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/logo.png?raw=true)

This is a Home Assistant add-on that runs a [TRMNL Terminus Server](https://github.com/usetrmnl/terminus) on your instance to enable self-hosted local management of TRMNL devices (BYOS). The server is exposed to port `2300` by default.

## Configuration

### Home Assistant IP (required)

The IP address of your Home Assistant instance (e.g. `192.168.1.50`).

### Terminus settings (optional)

Every other option is optional. Apart from **Session expiration**, described below, each is left unset by default, in which case Terminus applies its own default. Setting one exports the matching [Terminus environment variable](https://github.com/usetrmnl/terminus/blob/main/doc/configuration.adoc) (the option key, uppercased) into the server and worker processes.

| Option | Environment variable | Terminus default |
|--------|----------------------|------------------|
| `api_access_token_period` | `API_ACCESS_TOKEN_PERIOD` | 1800 |
| `session_expiration_enabled` | `SESSION_EXPIRATION_ENABLED` | enabled |
| `session_inactivity_limit` | `SESSION_INACTIVITY_LIMIT` | 1800 |
| `session_lifetime_limit` | `SESSION_LIFETIME_LIMIT` | 86400 |
| `ferrum_default_timeout` | `FERRUM_DEFAULT_TIMEOUT` | 30 |
| `ferrum_process_timeout` | `FERRUM_PROCESS_TIMEOUT` | 15 |
| `ferrum_javascript_errors` | `FERRUM_JAVASCRIPT_ERRORS` | enabled |
| `http_timeout_connect` | `HTTP_TIMEOUT_CONNECT` | 2 |
| `http_timeout_read` | `HTTP_TIMEOUT_READ` | 10 |
| `http_timeout_write` | `HTTP_TIMEOUT_WRITE` | 10 |
| `hanami_max_threads` | `HANAMI_MAX_THREADS` | 5 |
| `hanami_min_threads` | `HANAMI_MIN_THREADS` | matches the maximum |
| `hanami_web_concurrency` | `HANAMI_WEB_CONCURRENCY` | 0 |
| `firmware_synchronizer` | `FIRMWARE_SYNCHRONIZER` | enabled |
| `font_synchronizer` | `FONT_SYNCHRONIZER` | enabled |
| `model_synchronizer` | `MODEL_SYNCHRONIZER` | enabled |
| `screen_synchronizer` | `SCREEN_SYNCHRONIZER` | enabled |
| `rack_attack_allowed_subnets` | `RACK_ATTACK_ALLOWED_SUBNETS` | all subnets allowed |

Variables the add-on manages itself — `API_URI`, `APP_SECRET`, `APP_SETUP`, `DATABASE_*`, `KEYVALUE_*`, `HANAMI_PORT`, `FONTS_PATH` — are not configurable, since the container wires them to its bundled Postgres, Valkey and `/data` layout.

To add another variable from the Terminus docs, add the lowercased key to `schema:` in `config.yaml` and to `PASSTHROUGH_OPTIONS` in `rootfs/etc/cont-init.d/01-init-environment.sh`.

### Session expiration (default: off)

This is the one option the add-on sets a default for. Terminus expires a session after 30 minutes idle and 24 hours in total, and ties its API tokens to that session. Anything pushing screens on a schedule cannot survive those limits unattended: refreshing resets the inactivity timer but never the lifetime cap, so the session lapses a day after login however diligently the token is refreshed, and every push then fails until somebody signs in by hand. Sessions therefore do not expire unless you switch this on.

Turn it on if the server is reachable beyond your trusted network, and expect to re-authenticate any BYOS push schedules once per lifetime. The [TRMNL add-on](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/docs/webhook-formats.md) can save its login and sign in again on its own if you would rather keep expiry on.

Raising `api_access_token_period` on its own does not extend a session: `session_inactivity_limit` and `session_lifetime_limit` still apply, and the shortest of the three is what ends it. Move all three together.

## Security

**Important:** This add-on is designed for trusted home networks. While Terminus itself has authentication features, this add-on wrapper does not provide any special security features when it comes to port or database credential accesses.

The container itself is confined by an AppArmor profile (`apparmor.txt`): it is denied access to Home Assistant's `/config`, `/ssl`, `/backup`, `/share` and `/media` directories, to other add-ons, and to raw sockets. To check for denials after a deploy, SSH into Home Assistant and run `journalctl _TRANSPORT="audit" | grep 'apparmor="DENIED"' | grep trmnl-terminus`.

All persistent data is stored under `/data` inside the add-on container. This includes:

- PostgreSQL database files
- Valkey (cache/queue) data
- Uploaded images and fonts
- Application secret key

This data is included in Home Assistant backups. The add-on is stopped during backups to ensure data consistency. Logs and temporary files are excluded.
