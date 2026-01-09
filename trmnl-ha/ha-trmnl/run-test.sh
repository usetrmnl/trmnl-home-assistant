#!/bin/bash
# Test script to reproduce slow-loading widget issue

set -e

echo "Starting mock HA server on port 8123..."
bun run tests/mocks/ha-server.ts &
SERVER_PID=$!

# Wait for server to start
sleep 2

echo ""
echo "Running slow-loading tests..."
echo ""

# Run the test
bun run test-slow-loading.ts

# Clean up
echo ""
echo "Stopping mock server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo "Done!"
