# LaraPaper (BYOS) for Home Assistant

![TRMNL Logo](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/logo.png?raw=true)

This app runs [LaraPaper](https://github.com/usetrmnl/larapaper), a self-hosted TRMNL
server (BYOS) with recipes, playlists and mashups, inside Home Assistant. It is the
official LaraPaper image with these additions:

- The database, generated screens and app key are kept in `/data`, so they survive
  updates and are part of Home Assistant backups.
- **The web UI opens inside Home Assistant** (ingress), wherever Home Assistant is
  reachable.
- **Recipes can read Home Assistant without a Home Assistant token**, if you set a key
  for them (see [Home Assistant in recipes](#home-assistant-in-recipes)).

## Setup

1. Set **App URL** to the address your TRMNL uses to reach this app, e.g.
   `http://192.168.1.10:4567`. The device downloads its screen image from there, so use
   an IP address or a name the device can resolve (`.local` names usually don't work).
2. Start the app and click **Open Web UI**. Register your account. Only this first
   account can register unless you turn on **Allow more accounts**.
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
4. To show a Home Assistant dashboard, create an **Image Webhook** plugin, add it to the device's playlist, and send to it from the TRMNL HA app with **Send to local server** ([how](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-ha/docs/webhook-formats.md#send-to-a-local-server)).
5. Add recipes under **Plugins**, for example from LaraPaper's OSS catalog or the TRMNL
   catalog.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| App URL | empty | The address in the screen links LaraPaper gives the TRMNL (`APP_URL`) |
| Home Assistant key for recipes | empty | Turns on read-only Home Assistant access for recipes that are given this key, see below |
| Allow more accounts | off | Whether anyone reaching the web UI can create an account after the first (`MULTIUSER_REGISTRATION_ENABLED`); LaraPaper then stops rendering Blade recipes unless you trust every user and set it up otherwise |
| Log level | info | How much LaraPaper writes to the app's log (`LOG_LEVEL`) |
| Transform runner URL | empty | Where recipe [transforms](https://usetrmnl.github.io/larapaper/usage/transform) run. Empty: LaraPaper's own JavaScript runner, inside the app. A URL: an external runner (`TRANSFORM_PROVIDER=http`, `TRANSFORM_RUNNER_URL`) |
| Transform runner token | empty | Bearer token for that runner (`TRANSFORM_RUNNER_TOKEN`) |
| Extra environment variables | none | Any other [LaraPaper environment variable](https://usetrmnl.github.io/larapaper/getting-started/environment-variables), as a name and a value |

### Transforms in other languages

LaraPaper runs JavaScript transforms itself. For PHP, Python or Ruby, or to isolate
transforms from LaraPaper, run [byos-transform-runner](https://github.com/bnussbau/byos-transform-runner)
somewhere LaraPaper can reach (it sandboxes each run with bubblewrap, which needs user
namespaces, so it doesn't fit in an app) and set **Transform runner URL** to it, e.g.
`http://192.168.1.20:3000`. Set its `TRANSFORM_API_KEY` and the same value as
**Transform runner token** if others can reach it.

### Extra environment variables

For LaraPaper settings without an option of their own, such as `HTTP_CLIENT_TIMEOUT` or
OpenID Connect sign-in (`OIDC_*`), add them under **Extra environment variables**. They
override the options above, apply on the next start, and go back to LaraPaper's default
once removed from the list. `APP_KEY`, `DB_CONNECTION`, `DB_DATABASE` and
`TRUSTED_PROXIES` stay the app's and are ignored there. OpenID Connect sends you back
to the App URL, so it signs you in there, not through **Open Web UI**.

## Home Assistant in recipes

Recipes that show Home Assistant data (made for TRMNL.com or LaraPaper) ask for your
Home Assistant URL and an access token. In this app there are two ways to fill those
in:

1. **The app's key (recommended).** Set **Home Assistant key for recipes** to a random
   string of 24 or more letters, digits, `-` or `_` and restart the app. While it is
   empty, the app's **Log** tab suggests a freshly generated one on each start; copy
   that. The option is masked like a password, and its eye icon shows it again when you
   need it for another recipe. In a recipe, enter `http://127.0.0.1:8124` as the Home Assistant
   URL and the key as its access token.
2. **A Home Assistant token.** Enter `http://homeassistant:8123` and a
   [long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile)
   from your Home Assistant profile. Use this for a recipe that needs more than the list
   below, or if you run transforms in an external transform runner.

With the key, recipes can only read. The app passes on just these requests and
refuses the rest:

| Request | For |
| --- | --- |
| `GET /api/`, `/api/config` | checking the connection, units and time zone |
| `GET /api/states`, `/api/states/<entity>` | entity states |
| `GET /api/calendars`, `/api/calendars/<entity>` | calendar events |
| `GET /api/history/period...`, `/api/logbook...` | history and recent activity |
| `POST /api/template` | rendering a template |
| `POST /api/services/weather/get_forecasts`, `.../calendar/get_events`, `.../todo/get_items` | forecasts, events and to-do items (service calls that only return data) |

Only recipes you give the key can use it, and it only works from inside the app:
`127.0.0.1:8124` isn't reachable from your network, and the key is no use anywhere else.
Requests from a browser, including a recipe's own page while it is rendered, are refused.

To do this the app has **Home Assistant API access** (shown on its page): Home
Assistant gives it a token that can do anything an administrator can. That token stays
with the app's own web server; LaraPaper and its recipes never see it. Without a key,
nothing uses it.

### For recipe authors

A recipe works here unchanged if it takes Home Assistant's URL and token from its form
fields, polls Home Assistant's REST API paths under that URL, sends the token as
`Authorization: Bearer <token>`, and asks for forecasts, calendar events or to-do items
with a POST to `/api/services/<domain>/<service>?return_response` (with
`polling_verb: post` or from its `transform.js`). Don't build `127.0.0.1:8124` into a
recipe; a hint in the URL field's description helps users find it, e.g. "In LaraPaper's
Home Assistant app: `http://127.0.0.1:8124` and the app's key".

## The web UI

**Open Web UI** (and **Show in sidebar** on the app's page) shows LaraPaper inside
Home Assistant, which passes it on through its own connection (ingress). It works
wherever Home Assistant does, for example through Home Assistant Cloud or your own remote
access, so LaraPaper itself never has to be reachable from the internet. You still log in
to LaraPaper there; passkeys you created at `http://<ha-ip>:4567` don't work under Home
Assistant's address, a password does.

LaraPaper links screen images to the App URL
([LaraPaper #289](https://github.com/usetrmnl/larapaper/issues/289)); inside Home
Assistant the app points those links through Home Assistant instead, so the images
show there too.

At home, the web UI is also at the App URL (port 4567), next to the TRMNL's device API.

## Security

This app is meant for trusted home networks. Port 4567 serves the TRMNL device API
and the web UI; don't expose it to the internet (use **Open Web UI** from outside).
Ingress on port 8099 only answers Home Assistant's own proxy, and the Home Assistant
access for recipes on port 8124 only answers from inside the app, with the key.

The container itself is confined by an AppArmor profile (`apparmor.txt`): it is denied
access to Home Assistant's `/config`, `/ssl`, `/backup`, `/share` and `/media`
directories, to other apps, and to raw sockets. To check for denials after a deploy,
SSH into Home Assistant and run
`journalctl _TRANSPORT="audit" | grep 'apparmor="DENIED"' | grep trmnl-larapaper`.

## Updating

The app's version is the LaraPaper release it runs (`0.45.1` runs LaraPaper 0.45.1).
A fix to the app alone between LaraPaper releases adds `-1`, `-2`.
