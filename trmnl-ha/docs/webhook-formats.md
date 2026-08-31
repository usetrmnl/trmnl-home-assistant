# Sending screenshots to a server

A schedule takes a screenshot of your dashboard and sends it somewhere. This page covers the two ways it can send, and how to set each one up.

If you are not sure which you need:

| Send it to | Use | Why |
|---|---|---|
| A TRMNL device, or anything that accepts an image | **Raw Image** | It posts the picture and nothing else. Nothing to configure. |
| Your own [Terminus](https://github.com/usetrmnl/terminus) server | **Terminus** | Terminus wants the picture wrapped in a small message describing which screen it belongs to. |

You pick this in the schedule editor, under **Webhook Format**.

---

## Raw Image

The add-on posts the image on its own, as the whole body of the request.

```http
POST /your-webhook-endpoint
Content-Type: image/png
Authorization: Bearer <optional-token>

<the image>
```

That is all there is to it. Point **Webhook URL** at whatever should receive the picture and you are done.

---

## Terminus

Terminus is TRMNL's self-hosted server — you run it yourself instead of using trmnl.com. It stores "screens", and each screen is one image with a name attached. The add-on sends screenshots to your server's `/api/screens` address.

Set **Webhook URL** to that address, for example `https://terminus.example.com/api/screens`.

### The fields

| Field | What to put in it |
|---|---|
| **Label** | The name you want to see in Terminus. Anything readable, like "Kitchen dashboard". |
| **Screen Name** | A short id with no spaces, like `ha-dashboard`. Terminus uses it to recognize the same screen each time, so keep it the same once you have picked one. |
| **Model ID** | Which device model this screen is for, taken from your Terminus setup. `1` if you only have one. |
| **Delivery Mode** | Leave on **URI**. See below. |
| **Add-on URL** | Where Terminus can find this add-on. This one catches people out — see [Setting the Add-on URL](#setting-the-add-on-url). |

The add-on also tells Terminus the image is already prepared for e-ink, so Terminus leaves it alone. The add-on does that conversion itself, and doing it twice makes the picture worse.

### How it sends

The add-on posts a short message naming the screen and where the picture can be collected. Terminus then comes back and downloads it.

```http
POST /api/screens
Content-Type: application/json
Authorization: <access token>

{
  "screen": {
    "uri": "http://192.168.1.100:10000/output/ha-dashboard.png",
    "label": "Home Assistant",
    "name": "ha-dashboard",
    "model_id": "1",
    "preprocessed": true
  }
}
```

So there are two trips: the add-on tells Terminus about the picture, then Terminus fetches it. That second trip is why the Add-on URL matters.

---

## Setting the Add-on URL

> ⚠️ **This is the address *Terminus* uses to reach the add-on. It is not the address you type into your browser.**

Those are often different, even when both programs run on the same machine. Three separate connections are involved, and each one starts somewhere else:

```
You, in a browser  ──▶ the add-on's page     (whatever you type in the address bar)
The add-on         ──▶ Terminus              (the Webhook URL field)
Terminus           ──▶ the add-on's image    (the Add-on URL field — this one)
```

`localhost` means "the machine I am on", so it means something different depending on who says it. If Terminus runs in Docker and you tell it `http://localhost:10000`, it looks inside its own container, finds nothing there, and the send fails.

Pick the row that matches your setup:

| Where Terminus runs | Set Add-on URL to | Notes |
|---|---|---|
| Docker on the same computer, using Docker Desktop (Mac or Windows) | `http://host.docker.internal:10000` | Docker Desktop's built-in name for the computer it runs on |
| Docker on the same Linux computer | `http://172.17.0.1:10000`, or that computer's network address | `172.17.0.1` is Docker's default gateway on Linux |
| A different computer on your network | `http://<address-of-the-add-on's-computer>:10000` | Its actual network address. Never `localhost`. |
| Behind a reverse proxy or on a public address | `https://trmnl.example.com` | Whatever public address forwards to port 10000 |
| As a Home Assistant add-on reached through ingress | The add-on's ingress address | See your Home Assistant setup |

**Check it before anything else.** If a schedule fails, run this from inside Terminus and see whether it can reach the add-on at all:

```sh
docker compose -p terminus-development exec web \
  curl -sI http://host.docker.internal:10000/health
# You want: HTTP/1.1 200 OK
```

If that fails, fix the address before changing anything else. Nearly every error you will see downstream — `ECONNREFUSED`, `improper image header`, a 500 from Terminus — comes back to this one field.

---

## Signing in

Terminus asks for a token before it will accept anything. Turn on **JWT Authentication** in the schedule and use either option.

**Option 1 — sign in here.** Type your Terminus email and password and press Authenticate. The add-on trades them for tokens and keeps those. It does not keep the password unless you tick "Stay signed in".

**Option 2 — paste tokens you already have.** If you would rather not type your password into the add-on, or you want to script the setup, ask Terminus for tokens yourself:

```sh
curl -X POST https://terminus.example.com/login \
  -H 'Content-Type: application/json' \
  -d '{"login": "you@example.com", "password": "your-password"}'
```

Terminus answers with two tokens:

```json
{
  "access_token": "...",
  "refresh_token": "..."
}
```

Paste both into the schedule. You only do this once — the access token lasts about 30 minutes, and the add-on quietly swaps the refresh token for a fresh pair (`POST /api/jwt`) before it runs out.

### When sign-ins stop working

Terminus can be set to end a session 24 hours after you signed in, no matter how active it has been. Refreshing keeps the session from going idle, but it cannot extend that 24-hour ceiling. When the session ends, sends fail with a `401` and the add-on raises a Home Assistant notification asking you to sign in again.

Two ways to avoid that:

- **Tick "Stay signed in"** in the schedule. The add-on saves your Terminus password and signs in again by itself. Worth knowing: the password is stored in plain text in the add-on's schedules file, next to the token that already lives there. Treat both the same way. Leave this off if your server does not expire sessions.
- **Turn expiry off on the server.** The [Terminus add-on](https://github.com/usetrmnl/trmnl-home-assistant/blob/main/trmnl-terminus/DOCS.md) leaves sessions alone unless you switch **Session expiration** on. Running Terminus yourself with Docker Compose, set `SESSION_EXPIRATION_ENABLED=false` — and put it in the compose file's `environment:` block, not only in `.env`, or the container never sees it. To keep expiry but stretch it out, raise `API_ACCESS_TOKEN_PERIOD`, `SESSION_INACTIVITY_LIMIT` and `SESSION_LIFETIME_LIMIT` together; whichever is shortest is what ends the session.

---

## If the screen already exists

Terminus answers `422` when a screen with that model is already there. The add-on handles it: it looks up the existing screens, removes the one with the same Model ID, and sends again. You do not need to do anything.

---

## Older Terminus servers

Terminus used to accept the image inside the message itself, rather than fetching it. That was removed in Terminus `0.52.0`. The **Legacy base64** delivery mode still exists for anyone running `0.51.0` or older, and it is the only reason to move off **URI**. If you are on a current Terminus — including the Terminus add-on in this repository — leave it on URI.
