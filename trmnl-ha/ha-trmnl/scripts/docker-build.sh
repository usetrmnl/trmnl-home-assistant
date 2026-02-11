#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${BLUE}🔨 Building TRMNL HA Docker image...${NC}"
echo ""

cd "$PROJECT_ROOT"

# Build the image
docker build -t trmnl-ha .

# Remove dangling images left behind by the re-tag
docker image prune -f --filter "dangling=true" > /dev/null 2>&1 || true

echo ""
echo -e "${GREEN}✅ Build complete!${NC}"
echo ""
echo "Next steps:"
echo "  ./scripts/docker-run.sh   - Run the container"
echo ""
echo "Tip: Use ./scripts/docker-dev.sh to build and run in one command"
