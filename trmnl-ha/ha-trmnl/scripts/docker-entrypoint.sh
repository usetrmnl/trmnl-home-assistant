#!/bin/bash
set -e

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

exec "$@"
