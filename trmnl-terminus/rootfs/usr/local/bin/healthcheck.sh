#!/bin/bash
# The Home Assistant watchdog only polls /up, which keeps answering while
# Postgres or Valkey are down.
set -e

check() {
    local name=$1
    shift

    if ! "$@" > /dev/null 2>&1; then
        echo "$name is not responding"
        exit 1
    fi
}

check postgres /usr/lib/postgresql/18/bin/pg_isready -U postgres -q
check valkey valkey-cli -s /var/run/valkey/valkey.sock ping
check puma curl -sf "http://localhost:${HANAMI_PORT:-2300}/up"
