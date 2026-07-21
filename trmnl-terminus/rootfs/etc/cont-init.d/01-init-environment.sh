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

echo "[terminus] Environment configured"
echo "[terminus]   API_URI=${API_URI}"
echo "[terminus]   DATABASE_URL=postgres://postgres@localhost/terminus"
echo "[terminus]   KEYVALUE_URL=unix:///var/run/valkey/valkey.sock"
