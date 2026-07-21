#!/bin/bash

# TRMNL Terminus HAOS Add-on Development Script
# Usage: ./dev.sh [command]

set -e

IMAGE_NAME="trmnl-terminus:dev"
CONTAINER_NAME="trmnl-terminus-dev"

cd "$(dirname "$0")"

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) BUILD_ARCH="amd64" ;;
  aarch64|arm64) BUILD_ARCH="aarch64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac
BUILD_FROM=$(grep "$BUILD_ARCH:" build.yaml | awk '{print $2}')

case "${1:-help}" in
  build)
    echo "Building Docker image (base: $BUILD_FROM)..."
    docker build --build-arg "BUILD_FROM=$BUILD_FROM" -t "$IMAGE_NAME" .
    echo "Build complete!"
    ;;

  run)
    echo "Running container..."
    echo "Press Ctrl+C to stop"
    echo ""
    docker run -it --rm \
      --name "$CONTAINER_NAME" \
      -p 2300:2300 \
      -v "$(pwd)/options-dev.json:/data/options.json" \
      "$IMAGE_NAME"
    ;;

  shell)
    echo "Starting shell in container..."
    docker run -it --rm \
      --name "$CONTAINER_NAME" \
      -v "$(pwd)/options-dev.json:/data/options.json" \
      "$IMAGE_NAME" /bin/bash
    ;;

  logs)
    docker logs -f "$CONTAINER_NAME"
    ;;

  stop)
    docker stop "$CONTAINER_NAME" 2>/dev/null || echo "Container not running"
    ;;

  clean)
    echo "Removing image..."
    docker rmi "$IMAGE_NAME" 2>/dev/null || echo "Image not found"
    ;;

  *)
    echo "TRMNL Terminus Development Script"
    echo ""
    echo "Usage: ./dev.sh [command]"
    echo ""
    echo "Commands:"
    echo "  build   Build the Docker image"
    echo "  run     Run the container (requires options-dev.json)"
    echo "  shell   Start a bash shell in the container"
    echo "  logs    Follow container logs"
    echo "  stop    Stop running container"
    echo "  clean   Remove the Docker image"
    ;;
esac
