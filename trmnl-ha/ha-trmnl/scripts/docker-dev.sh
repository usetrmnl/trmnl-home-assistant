#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CONTAINER_NAME="trmnl-ha-dev"
IMAGE_NAME="trmnl-ha"
VOLUME_DIR="/tmp/trmnl-data"
PORT="10000"

# Resolve paths relative to script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="${SCRIPT_DIR}/.."
OPTIONS_DEV="${APP_DIR}/options-dev.json"

echo -e "${BLUE}🚀 TRMNL HA Development Mode${NC}"
echo ""

# =============================================================================
# CONFIGURATION CHECK
# =============================================================================

OPTIONS_EXAMPLE="${APP_DIR}/options-dev.json.example"
if [ ! -f "$OPTIONS_DEV" ] && [ -f "$OPTIONS_EXAMPLE" ]; then
  echo -e "${YELLOW}📄 Creating options-dev.json from example...${NC}"
  cp "$OPTIONS_EXAMPLE" "$OPTIONS_DEV"
  echo "   Please configure ${OPTIONS_DEV} with your settings"
  echo ""
fi

if [ ! -f "$OPTIONS_DEV" ]; then
  echo -e "${YELLOW}⚠️  No options-dev.json found and no example to copy${NC}"
  exit 1
fi

echo -e "${GREEN}📄 Config: options-dev.json${NC}"
echo -e "${GREEN}📁 Source: mounted from local files${NC}"
echo ""

# =============================================================================
# STOP EXISTING CONTAINER
# =============================================================================

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Stopping existing container..."
  docker stop "${CONTAINER_NAME}" 2>/dev/null || true
  docker rm "${CONTAINER_NAME}" 2>/dev/null || true
fi

# =============================================================================
# BUILD IMAGE (only if needed or forced)
# =============================================================================

if [[ "$1" == "--build" ]] || [[ "$(docker images -q ${IMAGE_NAME} 2>/dev/null)" == "" ]]; then
  echo -e "${BLUE}🔨 Building image...${NC}"
  cd "$PROJECT_ROOT"
  docker build -t "${IMAGE_NAME}" .
  echo ""
fi

# =============================================================================
# CREATE VOLUME DIRECTORY
# =============================================================================

if [ ! -d "$VOLUME_DIR" ]; then
  mkdir -p "$VOLUME_DIR"
fi

# =============================================================================
# RUN CONTAINER WITH LOCAL MOUNTS
# =============================================================================

echo -e "${BLUE}▶️  Starting with hot-reload (Ctrl+C to stop)${NC}"
echo ""
echo "   UI: http://localhost:${PORT}/"
echo ""

docker run -it --rm \
  --name "${CONTAINER_NAME}" \
  --memory 1g \
  --memory-swap 1g \
  -p "${PORT}:${PORT}" \
  -v "${VOLUME_DIR}:/data" \
  -v "${OPTIONS_DEV}:/data/options.json:ro" \
  -v "${APP_DIR}/lib:/app/lib" \
  -v "${APP_DIR}/html:/app/html" \
  -v "${APP_DIR}/main.ts:/app/main.ts" \
  -v "${APP_DIR}/const.ts:/app/const.ts" \
  -v "${APP_DIR}/error.ts:/app/error.ts" \
  -v "${APP_DIR}/screenshot.ts:/app/screenshot.ts" \
  -v "${APP_DIR}/scheduler.ts:/app/scheduler.ts" \
  -v "${APP_DIR}/types:/app/types" \
  "${IMAGE_NAME}" \
  bun --watch run main.ts
