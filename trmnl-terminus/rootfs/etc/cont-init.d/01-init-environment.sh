#!/command/with-contenv bash
# shellcheck shell=bash
set -e

HANAMI_PORT="${HANAMI_PORT:-2300}"

HA_IP=""
if [ -f /data/options.json ]; then
    HA_IP=$(jq -r '.ha_ip // empty' /data/options.json 2>/dev/null)
fi

if [ -z "$HA_IP" ]; then
    echo "[terminus] ERROR: ha_ip is required. Set it in the add-on's configuration tab."
    exit 1
fi

HA_IP=$(echo "$HA_IP" | sed -E 's|https?://||' | sed -E 's|[:/].*||')
API_URI="http://${HA_IP}:${HANAMI_PORT}"

echo "$API_URI" > /data/.api_uri

# Terminus settings the user may override from the add-on config. Each entry is
# an option key whose env var is the key uppercased; only keys actually present
# in options.json are exported, so Terminus falls back to its own defaults.
# Managed vars (DATABASE_URL, API_URI, APP_SECRET, ...) are deliberately absent
# so the add-on config cannot break the container's own wiring.
PASSTHROUGH_OPTIONS=(
    api_access_token_period
    session_expiration_enabled
    session_inactivity_limit
    session_lifetime_limit
    ferrum_default_timeout
    ferrum_process_timeout
    ferrum_javascript_errors
    http_timeout_connect
    http_timeout_read
    http_timeout_write
    hanami_max_threads
    hanami_min_threads
    hanami_web_concurrency
    firmware_synchronizer
    font_synchronizer
    model_synchronizer
    screen_synchronizer
    rack_attack_allowed_subnets
)

# Regenerated every start so a removed option stops being exported.
: > /var/run/terminus.env

echo "[terminus] Environment configured"
echo "[terminus]   API_URI=${API_URI}"
echo "[terminus]   DATABASE_URL=postgres://postgres@localhost/terminus"
echo "[terminus]   KEYVALUE_URL=unix:///var/run/valkey/valkey.sock"

for option in "${PASSTHROUGH_OPTIONS[@]}"; do
    # select(. != null) rather than `// empty` so a `false` boolean survives.
    value=$(jq -r --arg k "$option" '.[$k] | select(. != null) | tostring' /data/options.json 2>/dev/null)
    [ -z "$value" ] && continue

    name=${option^^}
    printf 'export %s=%q\n' "$name" "$value" >> /var/run/terminus.env
    echo "[terminus]   ${name}=${value}"
done
