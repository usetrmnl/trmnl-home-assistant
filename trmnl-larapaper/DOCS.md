# LaraPaper (BYOS) for Home Assistant

![TRMNL Logo](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/logo.png?raw=true)

This add-on runs [LaraPaper](https://github.com/usetrmnl/larapaper), a self-hosted TRMNL
server (BYOS) with recipes, playlists and mashups, inside Home Assistant. It is the
official LaraPaper image with these additions:

- The database, generated screens and app key are kept in `/data`, so they survive
  updates and are part of Home Assistant backups.
- **The web UI opens inside Home Assistant** (ingress), wherever Home Assistant is
  reachable.

## Setup

1. Set **App URL** to the address your TRMNL uses to reach this add-on, e.g.
   `http://192.168.1.10:4567`. The device downloads its screen image from there, so use
   an IP address or a name the device can resolve (`.local` names usually don't work).
2. Start the add-on and click **Open Web UI**. Register your account, then turn off
   **Allow registration**.
3. Point the TRMNL at the server. A new device starts in Wi-Fi pairing mode; to get back
   to it, hold the left and right ends of the touch bar until the screen flashes (TRMNL X)
   or hold the button on the back for 6 to 8 seconds (TRMNL OG). Connect to the **TRMNL**
   Wi-Fi network, tap **Advanced** → **Custom Server** → **Yes** and enter the App URL
   without a trailing slash, then go **Back to Wi-Fi**, pick your network and **Connect**.
   With the **Auto-Join** toggle in LaraPaper's header switched on, the device appears by
   itself. The "Please visit trmnl.com/start" screen it then shows comes from the
   firmware and can be ignored; the device picks up its playlist at the next refresh. A
   TRMNL OG on firmware older than 1.4.6 has no **Custom Server** option and needs a
   firmware update first.
4. Add recipes under **Plugins**, for example from LaraPaper's OSS catalog or the TRMNL
   catalog.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| App URL | empty | The address in the screen links LaraPaper gives the TRMNL (`APP_URL`) |
| Allow registration | on | Whether anyone reaching the web UI can create an account |

## The web UI

**Open Web UI** (and **Show in sidebar** on the add-on's page) shows LaraPaper inside
Home Assistant, which passes it on through its own connection (ingress). It works
wherever Home Assistant does, for example through Home Assistant Cloud or your own remote
access, so LaraPaper itself never has to be reachable from the internet. You still log in
to LaraPaper there; passkeys you created at `http://<ha-ip>:4567` don't work under Home
Assistant's address, a password does.

LaraPaper links screen images to the App URL
([LaraPaper #289](https://github.com/usetrmnl/larapaper/issues/289)); inside Home
Assistant the add-on points those links through Home Assistant instead, so the images
show there too.

At home, the web UI is also at the App URL (port 4567), next to the TRMNL's device API.

## Security

This add-on is meant for trusted home networks. Port 4567 serves the TRMNL device API
and the web UI; don't expose it to the internet (use **Open Web UI** from outside).
Ingress on port 8099 only answers Home Assistant's own proxy.

The container itself is confined by an AppArmor profile (`apparmor.txt`): it is denied
access to Home Assistant's `/config`, `/ssl`, `/backup`, `/share` and `/media`
directories, to other add-ons, and to raw sockets. To check for denials after a deploy,
SSH into Home Assistant and run
`journalctl _TRANSPORT="audit" | grep 'apparmor="DENIED"' | grep trmnl-larapaper`.

## Updating

The add-on's version is the LaraPaper release it runs (`0.45.1` runs LaraPaper 0.45.1).
A fix to the add-on alone between LaraPaper releases adds `-1`, `-2`.
