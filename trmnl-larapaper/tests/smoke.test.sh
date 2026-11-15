#!/usr/bin/env bash
# Boots the built add-on the way the Supervisor would (a /data with options.json, the
# ingress proxy's address) and checks what it adds to LaraPaper: the options, /data,
# ingress, the Home Assistant proxy for recipes (against tests/fake-ha.py) and that a
# restart keeps the app key, plus that it still renders a screen.
#
# Needs Docker, curl and python3 on the host.
#
# Usage: trmnl-larapaper/tests/smoke.test.sh [image]
# Extra docker run arguments (e.g. an AppArmor profile) go in SMOKE_DOCKER_ARGS.
set -uo pipefail

IMAGE="${1:-trmnl-larapaper:dev}"
WORK=$(mktemp -d)
FAILED=0
APP=larapaper-smoke
# Where published ports reach the container from; Docker on a Mac (OrbStack, Docker
# Desktop) forwards them from a 192.168 address. SMOKE_INGRESS_PROXY overrides it.
INGRESS_PROXY="${SMOKE_INGRESS_PROXY:-$([ "$(uname)" = Darwin ] && echo 192.168.0.0/16 || echo 172.16.0.0/12)}"
# The fake Home Assistant, on the host, stands in for the Supervisor's Core API proxy
FAKE_HA_PORT=18123
SUPERVISOR_TOKEN_TEST=supervisor-smoke-token
HA_KEY=smoke-key-0123456789abcdefghij

# shellcheck disable=SC2329 # run by the trap
cleanup() {
    [ "$FAILED" = 0 ] || docker logs "$APP" 2>&1 | tail -80
    docker rm -f "$APP" >/dev/null 2>&1
    [ -z "${FAKE_HA_PID:-}" ] || kill "$FAKE_HA_PID" 2>/dev/null
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
            -e HA_INGRESS_PROXY="$INGRESS_PROXY" \
            -e SUPERVISOR_TOKEN="$SUPERVISOR_TOKEN_TEST" \
            -e HASSIO_TOKEN="$SUPERVISOR_TOKEN_TEST" \
            -e HA_API_URL="http://host.docker.internal:$FAKE_HA_PORT/core/api" \
            --add-host host.docker.internal:host-gateway \
            -v "$WORK/data:/data" ${SMOKE_DOCKER_ARGS:-} "$IMAGE" >/dev/null
    fi
    wait_up || { fail "add-on became healthy"; exit 1; }
}

mkdir -p "$WORK/data"
python3 "$(dirname "$0")/fake-ha.py" "$FAKE_HA_PORT" &
FAKE_HA_PID=$!

start '{"app_url": "http://localhost:4567/", "multiuser_registration": false}'
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

# --- Services ----------------------------------------------------------------------
# The queue worker and the scheduler run jobs that render screens and, from LaraPaper
# 0.47.0, recipes' transform code: as www-data, as in LaraPaper's own image
for service in queue:work schedule:work; do
    check "$service runs as www-data" sh -c \
        "docker exec $APP ps -o user,args | grep 'artisan $service' | grep -v grep | grep -q '^www-data'"
    # with a HOME it can write: Chromium (every render in a queued job) fails without one.
    # Read from an unconfined container: the add-on's AppArmor profile denies the ptrace /proc/<pid>/environ needs
    home=$(docker run --rm --pid "container:$APP" --security-opt apparmor=unconfined -u www-data \
        --entrypoint sh "$IMAGE" -c "pid=\$(pgrep -f '[a]rtisan $service' | head -1);
        tr '\\0' '\\n' < /proc/\$pid/environ | sed -n 's/^HOME=//p'")
    check "$service has a writable HOME (${home:-none})" docker exec -u www-data "$APP" test -w "${home:-/missing}"
done

# A recipe transform (LaraPaper 0.47.0+) runs: Node under its permission model, so a
# confined add-on (SMOKE_DOCKER_ARGS) is shown to allow it
# shellcheck disable=SC2016 # PHP code
transform=$(docker exec -u www-data "$APP" php artisan tinker --execute '
    if (! class_exists(App\Services\Plugin\Transform\LocalTransformProvider::class)) { echo "transform=none"; return; }
    $result = app(App\Services\Plugin\Transform\LocalTransformProvider::class)
        ->execute("node", "function run(input) { return { count: input.items.length }; }", ["items" => [1, 2, 3], "trmnl" => []]);
    echo "transform=", json_encode($result->output);' 2>&1 | sed -n 's/^transform=//p')
if [ "$transform" = none ]; then
    echo "skip - recipe transforms (LaraPaper before 0.47.0)"
else
    check "recipe transforms run" test "$transform" = '{"count":3}'
fi

# --- Options and /data -------------------------------------------------------------
check "App URL from the options" docker exec "$APP" grep -qx 'APP_URL=http://localhost:4567' /var/www/html/.env
check "registration from the options" docker exec "$APP" grep -qx 'MULTIUSER_REGISTRATION_ENABLED=0' /var/www/html/.env
check "no REGISTRATION_ENABLED (gone since LaraPaper 0.46.0)" sh -c "! docker exec $APP grep -q '^REGISTRATION_ENABLED=' /var/www/html/.env"
check "log level defaults to info" docker exec "$APP" grep -qx 'LOG_LEVEL=info' /var/www/html/.env
check "transforms run in LaraPaper by default" sh -c "! docker exec $APP grep -q '^TRANSFORM_PROVIDER=' /var/www/html/.env"
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
# with escaped slashes and in Livewire's snapshot (JSON in JSON), as LaraPaper writes
# them; the device API port keeps APP_URL
# shellcheck disable=SC2016 # PHP code
docker exec -i "$APP" sh -c 'cat > /var/www/html/public/smoke-urls.php' <<'PHP'
<?php
$src = 'http://localhost:4567/storage/images/generated/x.png';
if (isset($_GET['snapshot'])) {
    header('Content-Type: application/json');
    echo json_encode(['snapshot' => json_encode(['src' => $src])]);
} elseif (isset($_GET['json'])) {
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
check "ingress: screen images in Livewire snapshots" ingress_has '/smoke-urls.php?snapshot=1' '\"/api/hassio_ingress/abc/storage/images'
check "device port: screen images keep the App URL" device_has /smoke-urls.php 'src="http://localhost:4567/storage/'
check "ingress: serves screen images" test "$(code -H 'X-Ingress-Path: /api/hassio_ingress/abc' http://127.0.0.1:8099/storage/images/setup-logo.bmp)" = 200
docker exec "$APP" rm -f /var/www/html/public/smoke-urls.php

# --- Home Assistant for recipes: off without a key ----------------------------------
check "HA proxy: off without a key" sh -c "! docker exec $APP curl -s -o /dev/null http://127.0.0.1:8124/api/"
check "HA proxy: the log suggests a key" sh -c \
    "docker logs $APP 2>&1 | grep -Eq 'Home Assistant for recipes: off.*e\\.g\\. to [A-Za-z0-9_-]{32}\$'"

# --- Restart with other options ---------------------------------------------------
# shellcheck disable=SC2016 # literal $ in a value
start '{"app_url": "http://localhost:4567/", "multiuser_registration": true, "log_level": "warning",
    "transform_runner_url": "http://runner:3000/", "transform_runner_token": "t0k$n \"x\" #1",
    "env_vars": [{"name": "HTTP_CLIENT_TIMEOUT", "value": "20"}, {"name": "OIDC_CLIENT_ID", "value": "my client"},
                 {"name": "LOG_LEVEL", "value": "error"}, {"name": "APP_KEY", "value": "nope"},
                 {"name": "LOG_STACK", "value": "single"}]}'
check "registration follows the options" docker exec "$APP" grep -qx 'MULTIUSER_REGISTRATION_ENABLED=1' /var/www/html/.env
# What LaraPaper itself reads, after the add-on wrote .env and Laravel cached its config
# shellcheck disable=SC2016 # PHP code
settings=$(docker exec -u www-data "$APP" php artisan tinker --execute '
    echo "settings=", json_encode([config("services.transform.provider"), config("services.transform.runner_url"),
        config("services.transform.runner_token"), config("app.http_client_timeout"), config("services.oidc.client_id"),
        config("logging.channels.stderr.level")]);' 2>&1 | sed -n 's/^settings=//p')
# shellcheck disable=SC2016 # literal $ in the token
check "transform runner, extra variables and log level reach LaraPaper (${settings:-none})" test "$settings" = \
    '["http","http:\/\/runner:3000","t0k$n \"x\" #1",20,"my client","error"]'
check "extra variables don't replace the app key" sh -c "! docker exec $APP grep -q '^APP_KEY=nope' /var/www/html/.env"

start '{"app_url": "http://localhost:4567/", "multiuser_registration": true, "home_assistant_key": "'"$HA_KEY"'"}'
check "removed extra variables go back to LaraPaper's default" sh -c \
    "! docker exec $APP grep -qE '^(HTTP_CLIENT_TIMEOUT|OIDC_CLIENT_ID)=' /var/www/html/.env"
check "removed transform runner goes back to LaraPaper's runner" sh -c "! docker exec $APP grep -q '^TRANSFORM_' /var/www/html/.env"
check "a removed extra variable restores the image's value" docker exec "$APP" grep -qx 'LOG_STACK=single,stderr' /var/www/html/.env
check "log level back to info" docker exec "$APP" grep -qx 'LOG_LEVEL=info' /var/www/html/.env

# --- Home Assistant for recipes ---------------------------------------------------
# As recipes call it: from inside the add-on, as www-data, with the key as Bearer token.
# The fake Home Assistant echoes what reached it.
# ha <curl arguments...>: the response body (the status code alone with -w)
ha() { docker exec -u www-data "$APP" curl -s "$@"; }
ha_code() { ha -o /dev/null -w '%{http_code}' "$@"; }
auth=(-H "Authorization: Bearer $HA_KEY")
echoed=$(ha "${auth[@]}" 'http://127.0.0.1:8124/api/states/sensor.outside')
check "HA proxy: passes reads to Core's API" grep -q '"path": "/core/api/states/sensor.outside"' <<<"$echoed"
check "HA proxy: with the Supervisor token" grep -q "\"auth\": \"Bearer $SUPERVISOR_TOKEN_TEST\"" <<<"$echoed"
check "HA proxy: keeps the query" sh -c "docker exec -u www-data $APP curl -s -H 'Authorization: Bearer $HA_KEY' \
    'http://127.0.0.1:8124/api/calendars/calendar.family?start=2026-11-08&end=2026-12-31' \
    | grep -qF '\"/core/api/calendars/calendar.family?start=2026-11-08&end=2026-12-31\"'"
check "HA proxy: keeps history paths" sh -c "docker exec -u www-data $APP curl -s -H 'Authorization: Bearer $HA_KEY' \
    'http://127.0.0.1:8124/api/history/period/2026-11-15T00:00:00+01:00?filter_entity_id=sensor.outside' \
    | grep -qF '/core/api/history/period/2026-11-15T00:00:00+01:00?filter_entity_id=sensor.outside'"
echoed=$(ha "${auth[@]}" -H 'Content-Type: application/json' -d '{"entity_id": "weather.home", "type": "daily"}' \
    'http://127.0.0.1:8124/api/services/weather/get_forecasts?return_response')
check "HA proxy: passes forecast service calls" grep -q '"method": "POST", "path": "/core/api/services/weather/get_forecasts?return_response"' <<<"$echoed"
check "HA proxy: ... with their body" grep -qF '"body": "{\"entity_id\": \"weather.home\", \"type\": \"daily\"}"' <<<"$echoed"
for path in /api/ /api/config /api/states /api/calendars /api/logbook; do
    check "HA proxy: GET $path" test "$(ha_code "${auth[@]}" "http://127.0.0.1:8124$path")" = 200
done
for path in /api/template /api/services/calendar/get_events /api/services/todo/get_items; do
    check "HA proxy: POST $path" test "$(ha_code "${auth[@]}" -d '{}' "http://127.0.0.1:8124$path")" = 200
done
check "HA proxy: refuses requests without the key" test "$(ha_code http://127.0.0.1:8124/api/states)" = 401
check "HA proxy: refuses a wrong key" test "$(ha_code -H 'Authorization: Bearer wrong-key-0123456789abcdefghij' http://127.0.0.1:8124/api/states)" = 401
check "HA proxy: refuses other service calls" test "$(ha_code "${auth[@]}" -d '{}' http://127.0.0.1:8124/api/services/light/turn_on)" = 404
check "HA proxy: refuses writing states" test "$(ha_code "${auth[@]}" -d '{}' http://127.0.0.1:8124/api/states/sensor.outside)" = 403
check "HA proxy: refuses a key in another case" test "$(ha_code -H "Authorization: Bearer ${HA_KEY^^}" http://127.0.0.1:8124/api/states)" = 401
check "HA proxy: refuses paths that only start like an allowed one" test "$(ha_code "${auth[@]}" http://127.0.0.1:8124/api/logbookx)" = 404
check "HA proxy: refuses double-encoded paths" test "$(ha_code "${auth[@]}" http://127.0.0.1:8124/api/logbook/%252e%252e/error_log)" = 400
check "HA proxy: refuses other API paths" test "$(ha_code "${auth[@]}" http://127.0.0.1:8124/api/events)" = 404
check "HA proxy: refuses browsers (Sec-Fetch-Mode)" test "$(ha_code "${auth[@]}" -H 'Sec-Fetch-Mode: cors' http://127.0.0.1:8124/api/states)" = 403
check "HA proxy: refuses browsers (Origin)" test "$(ha_code "${auth[@]}" -H 'Origin: null' http://127.0.0.1:8124/api/states)" = 403
check "HA proxy: only on the loopback interface" sh -c \
    "! docker exec $APP sh -c 'curl -s -o /dev/null http://\$(hostname -i | cut -d\" \" -f1):8124/api/'"
# The Supervisor token is an administrator's: www-data (LaraPaper, its queue worker and
# recipes) must not be able to read it, in files or in a process's environment (read
# from an unconfined container, as the AppArmor profile denies /proc/<pid>/environ).
check "HA proxy: www-data can't read the Supervisor token" sh -c \
    "! docker exec -u www-data $APP sh -c 'grep -rqs $SUPERVISOR_TOKEN_TEST /etc /run /var/www/html/.env /data /proc/1/environ'"
# As www-data, which can read its own processes' environment (the queue worker, the
# scheduler, PHP-FPM's workers, Chromium, transforms):
holders=$(docker run --rm --pid "container:$APP" --security-opt apparmor=unconfined -u www-data --entrypoint sh "$IMAGE" -c \
    "for f in /proc/[0-9]*/environ; do grep -qs $SUPERVISOR_TOKEN_TEST \$f && echo \${f%/environ}; done")
check "HA proxy: no www-data process holds the Supervisor token${holders:+ ($holders)}" test -z "$holders"

# --- Restarts keep the app key ----------------------------------------------------
check "restarts keep the app key" test "$(cat "$WORK/data/app_key")" = "$key"
check "... and LaraPaper uses it" docker exec "$APP" grep -qx "APP_KEY=$key" /var/www/html/.env

exit "$FAILED"
