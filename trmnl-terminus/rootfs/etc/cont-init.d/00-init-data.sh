#!/command/with-contenv bash
# shellcheck shell=bash
set -e

echo "[terminus] Initializing data directories..."

mkdir -p /data/postgres /data/valkey /data/uploads /data/uploads/cache /data/fonts /data/logs
chown -R postgres:postgres /data/postgres
chown -R app:app /data/uploads /data/fonts 2>/dev/null || true

mkdir -p /var/run/valkey /var/run/postgresql
chown postgres:postgres /var/run/postgresql
chmod 777 /var/run/valkey

if [ ! -f /data/.app_secret ]; then
    openssl rand -hex 64 > /data/.app_secret
    chmod 600 /data/.app_secret
    echo "[terminus] Generated APP_SECRET"
fi

rm -rf /app/public/uploads /app/public/fonts
ln -sfn /data/uploads /app/public/uploads
ln -sfn /data/fonts /app/public/fonts
mkdir -p /usr/share/fonts/terminus
ln -sfn /data/fonts/* /usr/share/fonts/terminus/ 2>/dev/null || true
mkdir -p /app/tmp/mini_magick
chown -R app:app /app/log /app/tmp /app/public/assets

echo "[terminus] Data initialization complete"
