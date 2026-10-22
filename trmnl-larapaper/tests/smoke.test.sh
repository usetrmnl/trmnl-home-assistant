#!/usr/bin/env bash
# Boots the built add-on the way the Supervisor would (a /data with options.json, the
# ingress proxy's address) and checks what it adds to LaraPaper: the options, /data,
# ingress and that a restart keeps the app key, plus that it still renders a screen.
#
# Needs Docker and curl on the host.
#
# Usage: trmnl-larapaper/tests/smoke.test.sh [image]
# Extra docker run arguments (e.g. an AppArmor profile) go in SMOKE_DOCKER_ARGS.
set -uo pipefail

IMAGE="${1:-trmnl-larapaper:dev}"
WORK=$(mktemp -d)
FAILED=0
APP=larapaper-smoke

# shellcheck disable=SC2329 # run by the trap
cleanup() {
    [ "$FAILED" = 0 ] || docker logs "$APP" 2>&1 | tail -80
    docker rm -f "$APP" >/dev/null 2>&1
    rm -rf "$WORK"
}
trap cleanup EXIT

ok() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILED=1; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else fail "$name"; fi; }

wait_up() {
    for _ in $(seq 1 90); do
        curl -fsS -o /dev/null http://localhost:4567/up 2>/dev/null && return 0
        sleep 2
    done
    return 1
}

# Starts (or restarts) the add-on with these options
start() {
    printf '%s' "$1" > "$WORK/data/options.json"
    if docker inspect "$APP" >/dev/null 2>&1; then
        docker restart "$APP" >/dev/null
    else
        # shellcheck disable=SC2086 # SMOKE_DOCKER_ARGS holds several arguments
        docker run -d --name "$APP" -p 4567:8080 -p 127.0.0.1:8099:8099 -e TZ=Europe/Amsterdam \
            -e HA_INGRESS_PROXY=172.16.0.0/12 \
            -v "$WORK/data:/data" ${SMOKE_DOCKER_ARGS:-} "$IMAGE" >/dev/null
    fi
    wait_up || { fail "add-on became healthy"; exit 1; }
}

mkdir -p "$WORK/data"

start '{"app_url": "http://localhost:4567/", "registration_enabled": false}'
ok "add-on became healthy"
key="$(cat "$WORK/data/app_key")"

# --- Rendering ---------------------------------------------------------------------
# A screen rendered the way recipes are (Chromium through Browsershot, then ImageMagick),
# so a confined add-on (SMOKE_DOCKER_ARGS) is shown to render too
# shellcheck disable=SC2016 # PHP code
png=$(docker exec -u www-data "$APP" php artisan tinker --execute '
    $markup = Illuminate\Support\Facades\Blade::render("<x-trmnl::screen>".view("trmnl")->render()."</x-trmnl::screen>");
    $model = App\Models\DeviceModel::where("name", "og_png")->firstOrFail();
    $id = App\Services\ImageGenerationService::generateImageFromModel($markup, $model);
    echo "png=", Illuminate\Support\Facades\Storage::disk("public")->path("images/generated/$id.png");' 2>&1 | sed -n 's/^png=//p')
check "renders a screen" docker exec "$APP" test -s "${png:-/missing}"

# --- Options and /data -------------------------------------------------------------
check "App URL from the options" docker exec "$APP" grep -qx 'APP_URL=http://localhost:4567' /var/www/html/.env
check "registration from the options" docker exec "$APP" grep -qx 'REGISTRATION_ENABLED=0' /var/www/html/.env
check "time zone from Home Assistant" docker exec "$APP" grep -qx 'APP_TIMEZONE=Europe/Amsterdam' /var/www/html/.env
check "app key in /data" test -s "$WORK/data/app_key"
check "database in /data" test -s "$WORK/data/database/database.sqlite"

# --- Ingress -----------------------------------------------------------------------
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# From inside the add-on, i.e. not from the Supervisor's (here: Docker's) network
check "ingress: refuses anyone but the Supervisor" test \
    "$(docker exec "$APP" curl -s -o /dev/null -w '%{http_code}' -H 'X-Ingress-Path: /api/hassio_ingress/abc' http://127.0.0.1:8099/up)" = 403
check "ingress: needs an ingress path" test "$(code http://127.0.0.1:8099/up)" = 400
check "ingress: needs a valid ingress path" test "$(code -H 'X-Ingress-Path: /elsewhere' http://127.0.0.1:8099/up)" = 400
check "ingress: answers with one" test "$(code -H 'X-Ingress-Path: /api/hassio_ingress/abc' http://127.0.0.1:8099/up)" = 200
check "ingress: answers at the prefix's root" test "$(code -H 'X-Ingress-Path: /api/hassio_ingress/abc' http://127.0.0.1:8099/)" = 200
check "ingress: redirects stay under the prefix" sh -c \
    "curl -s -o /dev/null -w '%{redirect_url}' -H 'X-Ingress-Path: /api/hassio_ingress/abc' http://127.0.0.1:8099/dashboard | grep -q '/api/hassio_ingress/abc/login'"
check "ingress: links carry the prefix" sh -c \
    "curl -s -H 'X-Ingress-Path: /api/hassio_ingress/abc' http://127.0.0.1:8099/login | grep -q '/api/hassio_ingress/abc/'"
# Screen image links (APP_URL/storage/...) point through ingress, in pages and in JSON
# with escaped slashes, as LaraPaper writes them; the device API port keeps APP_URL
# shellcheck disable=SC2016 # PHP code
docker exec -i "$APP" sh -c 'cat > /var/www/html/public/smoke-urls.php' <<'PHP'
<?php
$src = 'http://localhost:4567/storage/images/generated/x.png';
if (isset($_GET['json'])) {
    header('Content-Type: application/json');
    echo json_encode(['src' => $src]);
} else {
    echo "<img src=\"$src\">";
}
PHP
# <url on the ingress port|device port> <text the body must contain>
# shellcheck disable=SC2329 # run by check
ingress_has() { curl -s -H 'X-Ingress-Path: /api/hassio_ingress/abc' "http://127.0.0.1:8099$1" | grep -qF "$2"; }
# shellcheck disable=SC2329 # run by check
device_has() { curl -s "http://localhost:4567$1" | grep -qF "$2"; }
check "ingress: screen images in pages" ingress_has /smoke-urls.php 'src="/api/hassio_ingress/abc/storage/images/generated/x.png"'
check "ingress: screen images in JSON" ingress_has '/smoke-urls.php?json=1' '"/api/hassio_ingress/abc/storage/images'
check "device port: screen images keep the App URL" device_has /smoke-urls.php 'src="http://localhost:4567/storage/'
check "ingress: serves screen images" test "$(code -H 'X-Ingress-Path: /api/hassio_ingress/abc' http://127.0.0.1:8099/storage/images/setup-logo.bmp)" = 200
docker exec "$APP" rm -f /var/www/html/public/smoke-urls.php

# --- Restart with other options ---------------------------------------------------
start '{"app_url": "http://localhost:4567/", "registration_enabled": true}'
check "registration follows the options" docker exec "$APP" grep -qx 'REGISTRATION_ENABLED=1' /var/www/html/.env

# --- Restarts keep the app key ----------------------------------------------------
check "restarts keep the app key" test "$(cat "$WORK/data/app_key")" = "$key"
check "... and LaraPaper uses it" docker exec "$APP" grep -qx "APP_KEY=$key" /var/www/html/.env

exit "$FAILED"
