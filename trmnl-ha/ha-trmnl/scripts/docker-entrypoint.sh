#!/bin/bash
set -e

# Run an explicit command as-is (e.g. `docker run <image> bun --version`)
# without the app setup below; only the default no-argument launch continues.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "Starting TRMNL HA..."

# Ensure data subdirectories exist for persistence.
# Supports two mount points:
#   -v ./trmnl-data:/data      (recommended, matches docs)
#   -v ./trmnl-data:/app/data  (also works, legacy workaround)
# In HA add-on mode, /data is managed by HA Supervisor.
if [ -d "/data" ]; then
  mkdir -p /data/output
else
  mkdir -p data/output
fi

# Local app directories (logs stay app-local, not persisted)
mkdir -p logs

# Pick a runtime. Bun's baseline build still needs CPU instructions that
# pre-2013 x86 chips lack and crashes on startup there (#24); fall back to
# Node via tsx when Bun can't run. RUNTIME=node|bun forces a choice.
# Invoke tsx via `node --import` so Node reads the loader as a module. Exec-ing
# node_modules/.bin/tsx instead would resolve its shebang and demand execute
# permission on tsx's script, which the AppArmor profile does not grant.
if [ "$RUNTIME" = "node" ]; then
  echo "Starting under Node (RUNTIME=node)"
  exec node --import tsx main.ts
elif [ "$RUNTIME" != "bun" ] && ! bun --version >/dev/null 2>&1; then
  echo "Bun failed to start (unsupported CPU?); falling back to Node"
  exec node --import tsx main.ts
fi

exec bun run main.ts
