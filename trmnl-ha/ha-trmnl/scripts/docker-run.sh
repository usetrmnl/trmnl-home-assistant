#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CONTAINER_NAME="trmnl-ha-live"
IMAGE_NAME="trmnl-ha"
VOLUME_DIR="/tmp/trmnl-data"
PORT="10000"

# Resolve paths relative to script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPTIONS_DEV="${SCRIPT_DIR}/../options-dev.json"
OPTIONS_MOUNT=""

echo -e "${BLUE}🚀 Starting TRMNL HA container...${NC}"
echo ""

# Check for options-dev.json, auto-copy from example if missing
OPTIONS_EXAMPLE="${SCRIPT_DIR}/../options-dev.json.example"
if [ ! -f "$OPTIONS_DEV" ] && [ -f "$OPTIONS_EXAMPLE" ]; then
  echo -e "${YELLOW}📄 Creating options-dev.json from example...${NC}"
  cp "$OPTIONS_EXAMPLE" "$OPTIONS_DEV"
  echo "   Please configure ${OPTIONS_DEV} with your settings"
  echo ""
fi

if [ -f "$OPTIONS_DEV" ]; then
  echo -e "${GREEN}📄 Using local options-dev.json${NC}"
  OPTIONS_MOUNT="-v ${OPTIONS_DEV}:/data/options.json:ro"
else
  echo -e "${YELLOW}⚠️  No options-dev.json found and no example to copy${NC}"
  echo ""
fi

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${YELLOW}⚠️  Container '${CONTAINER_NAME}' already exists${NC}"
  echo "Stopping and removing existing container..."
  docker stop "${CONTAINER_NAME}" 2>/dev/null || true
  docker rm "${CONTAINER_NAME}" 2>/dev/null || true
  echo ""
fi

# Create volume directory if it doesn't exist
if [ ! -d "$VOLUME_DIR" ]; then
  echo "Creating volume directory: $VOLUME_DIR"
  mkdir -p "$VOLUME_DIR"
  echo ""
fi

# Run the container with resilience configuration
echo "Starting container with resilience features..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --memory 1g \
  --memory-swap 1g \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  -p "${PORT}:${PORT}" \
  -v "${VOLUME_DIR}:/data" \
  ${OPTIONS_MOUNT} \
  "${IMAGE_NAME}"

echo ""
echo -e "${GREEN}✅ Container started successfully!${NC}"
echo ""
echo "Container: ${CONTAINER_NAME}"
echo "Port:      ${PORT}"
echo "Volume:    ${VOLUME_DIR} → /data"
if [ -n "$OPTIONS_MOUNT" ]; then
  echo "Config:    options-dev.json (local file)"
else
  echo "Config:    ${VOLUME_DIR}/options.json"
fi
echo ""
echo "Next steps:"
echo "  ./scripts/docker-health.sh    - Check health status"
echo "  ./scripts/docker-logs.sh      - View application logs"
echo ""
echo "Access UI: http://localhost:${PORT}/"
