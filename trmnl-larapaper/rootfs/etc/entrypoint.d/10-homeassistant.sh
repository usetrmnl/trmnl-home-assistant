#!/bin/sh
# Home Assistant glue for LaraPaper. serversideup-php runs /etc/entrypoint.d/* in
# order on every start, before 50-laravel-automations.sh (migrations, config cache),
# so what this writes to .env is live on each boot.
set -e

APP_DIR="${APP_DIR:-/var/www/html}"
DATA_DIR="${DATA_DIR:-/data}"

log() { echo "[larapaper-ha] $1"; }

# Keep the database and generated screens in /data, which survives add-on updates and
# is included in Home Assistant backups (same paths as upstream docker-compose).
persist() {
    image_path="$APP_DIR/$1"
    data_path="$DATA_DIR/$2"
    mkdir -p "$data_path"
    if [ ! -L "$image_path" ]; then
        if [ -d "$image_path" ]; then
            cp -a "$image_path/." "$data_path/" 2>/dev/null || true
            rm -rf "$image_path"
        fi
        mkdir -p "$(dirname "$image_path")"
        ln -s "$data_path" "$image_path"
    fi
}
persist database/storage database
persist storage/app/public/images/generated generated
[ -f "$DATA_DIR/database/database.sqlite" ] || touch "$DATA_DIR/database/database.sqlite"
chown -R www-data:www-data "$DATA_DIR/database" "$DATA_DIR/generated" 2>/dev/null || true

# APP_KEY is generated once: rotating it would invalidate encrypted settings.
if [ ! -s "$DATA_DIR/app_key" ]; then
    echo "base64:$(head -c 32 /dev/urandom | base64 | tr -d '\n')" > "$DATA_DIR/app_key"
    log "generated APP_KEY"
fi

# Add-on options (/data/options.json); PHP is in the image, jq/bashio are not.
opt() {
    # shellcheck disable=SC2016 # PHP code, not shell expansions
    php -r '$o = json_decode(@file_get_contents($argv[1]), true) ?: [];
            $v = $o[$argv[2]] ?? "";
            echo is_bool($v) ? ($v ? "1" : "0") : $v;' "$DATA_DIR/options.json" "$1"
}

set_env() {
    tmp="$APP_DIR/.env.tmp"
    grep -v "^$1=" "$APP_DIR/.env" > "$tmp" || true
    printf '%s=%s\n' "$1" "$(env_value "$2")" >> "$tmp"
    cat "$tmp" > "$APP_DIR/.env"
    rm -f "$tmp"
}

# A value as .env (phpdotenv) reads it back unchanged: plain when it's safe, else
# double-quoted with \, " and $ escaped (unquoted values can't hold spaces or #).
env_value() {
    case "$1" in
        *[!A-Za-z0-9_./:,@+=-]*) printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"$]/\\&/g')" ;;
        *) printf '%s' "$1" ;;
    esac
}

# Every start begins from the image's .env, so an option or extra variable taken off
# falls back to LaraPaper's default (the container survives a plain restart).
[ -f "$APP_DIR/.env.image" ] || cp "$APP_DIR/.env" "$APP_DIR/.env.image"
cp "$APP_DIR/.env.image" "$APP_DIR/.env"

APP_URL="$(opt app_url)"
APP_URL="${APP_URL%/}"
MULTIUSER_REGISTRATION="$(opt multiuser_registration)"
LOG_LEVEL="$(opt log_level)"
TRANSFORM_RUNNER_URL="$(opt transform_runner_url)"
TRANSFORM_RUNNER_URL="${TRANSFORM_RUNNER_URL%/}"
TRANSFORM_RUNNER_TOKEN="$(opt transform_runner_token)"
HA_KEY="$(opt home_assistant_key)"

set_env APP_KEY "$(cat "$DATA_DIR/app_key")"
set_env APP_ENV production
set_env APP_DEBUG false
set_env DB_DATABASE database/storage/database.sqlite
set_env APP_TIMEZONE "${TZ:-UTC}"
# LaraPaper 0.46.0 replaced REGISTRATION_ENABLED: the first account can always register,
# further ones only with MULTIUSER_REGISTRATION_ENABLED (which also turns off Blade).
set_env MULTIUSER_REGISTRATION_ENABLED "${MULTIUSER_REGISTRATION:-0}"
[ -n "$APP_URL" ] && set_env APP_URL "$APP_URL"
# LaraPaper logs at debug unless told otherwise
set_env LOG_LEVEL "${LOG_LEVEL:-info}"
# Recipe transforms: LaraPaper's own JavaScript runner, or an external runner (such as
# byos-transform-runner) for more languages and a real sandbox
if [ -n "$TRANSFORM_RUNNER_URL" ]; then
    set_env TRANSFORM_PROVIDER http
    set_env TRANSFORM_RUNNER_URL "$TRANSFORM_RUNNER_URL"
    [ -n "$TRANSFORM_RUNNER_TOKEN" ] && set_env TRANSFORM_RUNNER_TOKEN "$TRANSFORM_RUNNER_TOKEN"
fi

log "APP_URL=${APP_URL:-<unset>} TZ=${TZ:-UTC} multiuser_registration=${MULTIUSER_REGISTRATION:-0} log_level=${LOG_LEVEL:-info} transforms=${TRANSFORM_RUNNER_URL:-local}"

# Home Assistant for recipes: a read-only copy of Home Assistant's REST API on
# http://127.0.0.1:8124, for recipes that poll Home Assistant (a TRMNL.com recipe's
# "Home Assistant URL" plus its access token). It answers only requests that carry the
# home_assistant_key option as their Bearer token, swaps that for the add-on's own
# Supervisor token (homeassistant_api), and passes only reads and the service calls that
# only return data. That token can do anything an administrator can, so it stays in this
# root-only nginx file (nginx's workers drop the environment): LaraPaper, its queue
# worker and recipes run as www-data and never see it (homeassistant-entrypoint). Browsers (a recipe's page while Chromium renders it) send Sec-Fetch-* or
# Origin headers, PHP's HTTP client doesn't: those requests are refused, so a page can't
# call it. HA_API_URL is for the smoke test's fake Home Assistant.
# homeassistant-entrypoint moved the token out of the environment into this file
SUPERVISOR_TOKEN="$(cat /run/supervisor_token 2>/dev/null || true)"
rm -f /run/supervisor_token
HA_API_CONF=/etc/nginx/conf.d/ha-api.conf
HA_API_URL="${HA_API_URL:-http://supervisor/core/api}"
HA_API_URL="${HA_API_URL%/}"
rm -f "$HA_API_CONF"
# A fresh random key in the right format, for the log, so nobody needs a generator
ha_key_suggestion() { head -c 24 /dev/urandom | base64 | tr '+/' '-_'; }
if [ -z "$HA_KEY" ]; then
    log "Home Assistant for recipes: off. To turn it on, set \"Home Assistant key for recipes\", e.g. to $(ha_key_suggestion)"
elif [ "${#HA_KEY}" -lt 24 ] || case "$HA_KEY" in *[!A-Za-z0-9_-]*) true ;; *) false ;; esac; then
    log "Home Assistant for recipes: off (home_assistant_key must be 24 or more letters, digits, - or _, e.g. $(ha_key_suggestion))"
elif [ -z "$SUPERVISOR_TOKEN" ]; then
    log "Home Assistant for recipes: off (no SUPERVISOR_TOKEN)"
# nginx won't start if the upstream's name doesn't resolve
elif ! getent hosts "$(printf '%s' "$HA_API_URL" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')" >/dev/null; then
    log "Home Assistant for recipes: off (can't resolve $HA_API_URL)"
else
    # One location per API path, each with the methods it allows; the rest is 404
    ha_location() { # ha_location <location> <path under /api> <method>
        cat <<LOCATION
    location $1 {
        limit_except $3 { deny all; }
        proxy_pass ${HA_API_URL}$2;
        proxy_set_header Authorization "Bearer ${SUPERVISOR_TOKEN}";
    }
LOCATION
    }
    {
        cat <<CONF
map \$http_authorization \$ha_key_ok {
    "~^Bearer ${HA_KEY}\$" 1;
    default 0;
}

server {
    listen 127.0.0.1:8124;
    access_log off;
    default_type application/json;

    if (\$http_sec_fetch_mode) { return 403 '{"message": "Not for browsers"}'; }
    if (\$http_origin) { return 403 '{"message": "Not for browsers"}'; }
    if (\$ha_key_ok = 0) { return 401 '{"message": "401: Unauthorized"}'; }
    # A % left after nginx decodes the path means it was encoded twice
    if (\$uri ~ "%") { return 400 '{"message": "Bad path"}'; }

CONF
        ha_location "= /api/" / GET
        ha_location "= /api/config" /config GET
        ha_location "= /api/states" /states GET
        ha_location /api/states/ /states/ GET
        ha_location "= /api/calendars" /calendars GET
        ha_location /api/calendars/ /calendars/ GET
        ha_location "= /api/history/period" /history/period GET
        ha_location /api/history/period/ /history/period/ GET
        ha_location "= /api/logbook" /logbook GET
        ha_location /api/logbook/ /logbook/ GET
        ha_location "= /api/template" /template POST
        for service in weather/get_forecasts calendar/get_events todo/get_items; do
            ha_location "= /api/services/$service" "/services/$service" POST
        done
        cat <<CONF

    location / {
        return 404 '{"message": "Not available to recipes"}';
    }
}
CONF
    } > "$HA_API_CONF"
    chmod 600 "$HA_API_CONF"
    log "Home Assistant for recipes on http://127.0.0.1:8124 (read-only) -> $HA_API_URL"
fi

# Home Assistant ingress (the sidebar panel and "Open Web UI"): Home Assistant proxies
# /api/hassio_ingress/<token>/... to this port with the prefix removed and the prefix in
# X-Ingress-Path. LaraPaper follows a trusted proxy's X-Forwarded-Prefix (and its
# X-Forwarded-Host and -Proto, which Home Assistant sends), so nginx passes the ingress
# path on as that header and the Supervisor is a trusted proxy. Only the Supervisor may
# connect (HA_INGRESS_PROXY is for CI).
INGRESS_CONF=/etc/nginx/conf.d/ha-ingress.conf
HA_INGRESS_PROXY="${HA_INGRESS_PROXY:-172.30.32.2}"
set_env TRUSTED_PROXIES "$HA_INGRESS_PROXY"
# Screen images link to APP_URL/storage/... (the address the TRMNL uses, LaraPaper #289),
# which a browser away from home, or on an https Home Assistant, can't load. Through
# ingress those links point at the ingress path instead, in pages, in Livewire's JSON
# (where slashes are escaped as \/) and in the component snapshot inside that JSON
# (JSON in JSON, \\\/), where the recipe page keeps its rendered image. nginx's quoted
# strings take \\ for one backslash.
storage_filter=""
if [ -n "$APP_URL" ]; then
    app_url_json="$(printf '%s' "$APP_URL" | sed 's#/#\\\\/#g')"
    app_url_snapshot="$(printf '%s' "$APP_URL" | sed 's#/#\\\\\\\\\\\\/#g')"
    storage_filter="sub_filter_types application/json;
        sub_filter_once off;
        sub_filter '$APP_URL/storage/' '\$ha_ingress_path/storage/';
        sub_filter '$app_url_json\\\\/storage\\\\/' '\$ha_ingress_path/storage/';
        sub_filter '$app_url_snapshot\\\\\\\\\\\\/storage\\\\\\\\\\\\/' '\$ha_ingress_path/storage/';"
fi
cat > "$INGRESS_CONF" <<CONF
map \$http_x_ingress_path \$ha_ingress_path {
    "~^/api/hassio_ingress/[A-Za-z0-9_-]+\$" \$http_x_ingress_path;
    default "";
}

server {
    listen 8099;
    allow ${HA_INGRESS_PROXY};
    deny all;

    root /var/www/html/public;
    index index.php;
    charset utf-8;
    absolute_redirect off;

    if (\$ha_ingress_path = "") { return 400; }

    location / {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location ~ /\.(?!well-known) {
        deny all;
    }

    location ~ \.php\$ {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param HTTP_X_FORWARDED_PREFIX \$ha_ingress_path;
        ${storage_filter}
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_buffers ${NGINX_FASTCGI_BUFFERS:-8 8k};
        fastcgi_buffer_size ${NGINX_FASTCGI_BUFFER_SIZE:-8k};
        fastcgi_read_timeout ${PHP_MAX_EXECUTION_TIME:-99};
    }
}
CONF
log "Home Assistant ingress on port 8099 (from $HA_INGRESS_PROXY)"

# Extra environment variables (option env_vars), last so they can override the above.
# The ones the add-on can't run without stay its own.
# shellcheck disable=SC2016 # PHP code, not shell expansions
php -r '$o = json_decode(@file_get_contents($argv[1]), true) ?: [];
        foreach ($o["env_vars"] ?? [] as $e) {
            $v = $e["value"] ?? "";
            echo $e["name"] ?? "", "\t", is_bool($v) ? ($v ? "true" : "false") : str_replace(["\r", "\n"], " ", (string) $v), "\n";
        }' "$DATA_DIR/options.json" | while IFS="$(printf '\t')" read -r name value; do
    case "$name" in
        "") ;;
        APP_KEY | DB_CONNECTION | DB_DATABASE | TRUSTED_PROXIES)
            log "env_vars: $name is managed by the add-on, ignored" ;;
        *[!A-Z0-9_]* | [!A-Z]*)
            log "env_vars: $name is not a valid variable name, ignored" ;;
        *)
            set_env "$name" "$value"
            log "env_vars: set $name" ;;
    esac
done
