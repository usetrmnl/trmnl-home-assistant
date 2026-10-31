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
    printf '%s=%s\n' "$1" "$2" >> "$tmp"
    cat "$tmp" > "$APP_DIR/.env"
    rm -f "$tmp"
}

APP_URL="$(opt app_url)"
APP_URL="${APP_URL%/}"
REGISTRATION_ENABLED="$(opt registration_enabled)"

set_env APP_KEY "$(cat "$DATA_DIR/app_key")"
set_env APP_ENV production
set_env APP_DEBUG false
set_env DB_DATABASE database/storage/database.sqlite
set_env APP_TIMEZONE "${TZ:-UTC}"
set_env REGISTRATION_ENABLED "${REGISTRATION_ENABLED:-1}"
[ -n "$APP_URL" ] && set_env APP_URL "$APP_URL"

log "APP_URL=${APP_URL:-<unset>} TZ=${TZ:-UTC} registration=${REGISTRATION_ENABLED:-1}"

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
# ingress those links point at the ingress path instead, in pages and in Livewire's JSON
# (where slashes are escaped). nginx's quoted strings take \\ for one backslash.
storage_filter=""
if [ -n "$APP_URL" ]; then
    app_url_json="$(printf '%s' "$APP_URL" | sed 's#/#\\\\/#g')"
    storage_filter="sub_filter_types application/json;
        sub_filter_once off;
        sub_filter '$APP_URL/storage/' '\$ha_ingress_path/storage/';
        sub_filter '$app_url_json\\\\/storage\\\\/' '\$ha_ingress_path/storage/';"
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
