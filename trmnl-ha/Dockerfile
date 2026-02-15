# syntax=docker/dockerfile:1.4
# TRMNL HA Add-on Dockerfile
# Multi-stage build for optimized image size while maintaining compatibility
# Uses Debian Bookworm for updated packages and better security

# =============================================================================
# STAGE 1: IMAGEMAGICK 7 SOURCE
# =============================================================================
# NOTE: Using dpokidov's IM7 image to ensure consistent dithering between
# local dev (IM7) and Docker. Debian apt only provides IM6 which has different
# algorithm implementations, colorspace handling, and HDRI support.
# See: https://github.com/dooman87/imagemagick-docker
FROM dpokidov/imagemagick:7.1.1-47-bookworm AS imagemagick

# =============================================================================
# STAGE 2: DEPENDENCY BUILDER
# =============================================================================
# NOTE: Using official Bun image which ships with baseline x64 builds for maximum
# CPU compatibility (supports Synology DS918+, older Proxmox VMs, CPUs without AVX2)
# See: https://github.com/oven-sh/bun/issues/21623
# See: https://github.com/usetrmnl/trmnl-home-assistant/issues/5
FROM oven/bun:1.3.5-slim AS builder

WORKDIR /build

# Copy package files for dependency installation
COPY ha-trmnl/package.json ha-trmnl/bunfig.toml ha-trmnl/bun.lock ./

# Install dependencies
# Skip Puppeteer's bundled Chrome - we'll use system Chromium in runtime stage
# NOTE: Using BuildKit cache mount for bun to speed up dependency installation
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# =============================================================================
# STAGE 3: RUNTIME
# =============================================================================
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install only runtime dependencies (ImageMagick copied from stage 1)
# NOTE: Grouped by purpose for clarity and maintainability
# NOTE: Using BuildKit cache mounts for apt to speed up rebuilds
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    # Browser runtime for Puppeteer
    chromium \
    chromium-sandbox \
    # Minimal utilities for health checks and runtime
    curl \
    ca-certificates \
    # font support for emoji
    fonts-noto-color-emoji \
    # CJK font support for international dashboards
    fonts-noto-cjk \
    # ImageMagick 7 runtime dependencies (binaries copied from stage 1)
    libgomp1 \
    libomp5 \
    libjpeg62-turbo \
    libpng16-16 \
    libtiff6 \
    libwebp7 \
    libwebpmux3 \
    libwebpdemux2 \
    libheif1 \
    libraw20 \
    liblcms2-2 \
    libfreetype6 \
    libfontconfig1 \
    libfftw3-double3 \
    liblqr-1-0 \
    libltdl7 \
    libopenjp2-7 \
    libxml2 \
    libzip4

# Copy ImageMagick 7 binaries and libraries from stage 1
# NOTE: This gives us IM7 with Q16-HDRI for consistent dithering with local dev
COPY --from=imagemagick /usr/local/bin/magick /usr/local/bin/
COPY --from=imagemagick /usr/local/lib/ /usr/local/lib/
COPY --from=imagemagick /usr/local/etc/ImageMagick-7/ /usr/local/etc/ImageMagick-7/

# Set up ImageMagick 7 CLI compatibility
# The gm package calls 'convert', but IM7 uses 'magick' and shows deprecation warnings
# We use a wrapper script that filters out the warning while preserving functionality
COPY ha-trmnl/scripts/imagemagick-wrapper.sh /usr/local/bin/convert
RUN chmod +x /usr/local/bin/convert && \
    ln -s /usr/local/bin/magick /usr/local/bin/identify && \
    ln -s /usr/local/bin/magick /usr/local/bin/mogrify && \
    ldconfig

# Copy Bun runtime from builder stage
# NOTE: /usr/local/bin is already in PATH, no additional ENV needed
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun

# Verify Bun is available
RUN bun --version

WORKDIR /app

# Copy node_modules from builder stage (production dependencies only)
COPY --from=builder /build/node_modules ./node_modules

# Copy package.json for metadata
COPY ha-trmnl/package.json ./

# Copy application code
# AI: The .dockerignore file excludes tests and dev files automatically
COPY ha-trmnl/ .

# =============================================================================
# RUNTIME CONFIGURATION
# =============================================================================

# Copy and set up entrypoint script
COPY ha-trmnl/scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Health check to verify server is running
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:10000/health || exit 1

# Use entrypoint for setup
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "main.js"]
