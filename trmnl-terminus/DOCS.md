# Terminus Server (BYOS) for Home Assistant

![TRMNL Logo](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/logo.png?raw=true)

This is a Home Assistant add-on that runs a [TRMNL Terminus Server](https://github.com/usetrmnl/terminus) on your instance to enable self-hosted local management of TRMNL devices (BYOS). The server is exposed to port `2300` by default.

## Configuration

### Home Assistant IP (required)

The IP address of your Home Assistant instance (e.g. `192.168.1.50`).

## Security

**Important:** This add-on is designed for trusted home networks. While Terminus itself has authentication features, this add-on wrapper does not provide any special security features when it comes to port or database credential accesses.

The container itself is confined by an AppArmor profile (`apparmor.txt`): it is denied access to Home Assistant's `/config`, `/ssl`, `/backup`, `/share` and `/media` directories, to other add-ons, and to raw sockets. To check for denials after a deploy, SSH into Home Assistant and run `journalctl _TRANSPORT="audit" | grep 'apparmor="DENIED"' | grep trmnl-terminus`.

All persistent data is stored under `/data` inside the add-on container. This includes:

- PostgreSQL database files
- Valkey (cache/queue) data
- Uploaded images and fonts
- Application secret key

This data is included in Home Assistant backups. The add-on is stopped during backups to ensure data consistency. Logs and temporary files are excluded.
