#!/bin/bash
set -e

echo "Starting TRMNL HA..."
mkdir -p logs output data
exec "$@"
