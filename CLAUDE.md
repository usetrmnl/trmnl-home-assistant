# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Home Assistant app (formerly add-on) for TRMNL e-ink displays. Captures HA dashboard screenshots with advanced dithering algorithms optimized for e-paper screens.

**Runtime:** Bun 1.3.5+ (not Node.js)
**Language:** TypeScript with strict type checking
**Image Processing:** ImageMagick 7 Q16-HDRI via `gm` package

## Development Commands

```bash
cd trmnl-ha/ha-trmnl

# Development
bun install
bun run dev                 # Hot-reload development server

# Testing
bun test                    # All tests
bun test tests/unit         # Unit tests only
bun test tests/integration  # Integration tests (requires MOCK_HA=true)
bun test --coverage         # With coverage report
bun test --watch            # Watch mode

# Run single test file
bun test tests/unit/dithering.test.ts

# Linting & Type Checking
bun run lint                # ESLint
bun run lint:fix            # Auto-fix lint issues
bun run typecheck           # TypeScript check (no emit)

# Mock HA Server (for local development without real HA)
bun run mock:server         # Start mock HA on localhost:8123
MOCK_HA=true bun run dev    # Run app with mock HA

# Docker Development
./scripts/docker-dev.sh     # Build + run with hot-reload (recommended)
./scripts/docker-build.sh   # Build container only
./scripts/docker-run.sh     # Run container only
```

## Architecture

### Request Flow
```
HTTP Request → HttpRouter → RequestHandler → Browser (Puppeteer)
                                ↓
                        screenshotPage()
                                ↓
                    processImage() (dithering via ImageMagick)
                                ↓
                        HTTP Response (PNG/JPEG/BMP)
```

### Key Modules

| File | Purpose |
|------|---------|
| `main.ts` | Entry point, RequestHandler orchestrates HTTP server + Browser lifecycle |
| `screenshot.ts` | Browser class - Puppeteer automation, navigation caching, screenshot capture |
| `scheduler.ts` | Cron-based automation, delegates to CronJobManager + ScheduleExecutor |
| `lib/http-router.ts` | HTTP routing for UI, API, health, static files |
| `lib/dithering.ts` | Image processing pipeline via ImageMagick |
| `lib/scheduleStore.ts` | Schedule CRUD operations with JSON persistence |
| `lib/logger.ts` | LogTape-based structured logging with module categories |
| `const.ts` | All configuration constants, environment detection |
| `error.ts` | Custom error classes for browser lifecycle management |

### Dithering Strategy Pattern

Dithering algorithms implement `DitheringStrategy` interface:
```
lib/dithering/
├── floyd-steinberg-strategy.ts  # Error diffusion (best quality)
├── ordered-strategy.ts          # Pattern-based (fastest)
└── threshold-strategy.ts        # Simple binary (smallest files)
```

### Browser Health & Recovery

The `BrowserFacade` tracks consecutive failures and triggers recovery:
1. **Stage 1:** Restart browser process
2. **Stage 2:** Full container restart if Stage 1 fails repeatedly

Error hierarchy:
- `BrowserCrashError` → immediate recovery
- `PageCorruptedError` → browser cleanup
- `BrowserHealthCheckError` → tracked failure
- `BrowserRecoveryFailedError` → container restart

## Code Conventions

### TypeScript
- Strict mode enabled (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`)
- ES Modules only (import/export, not require)
- Private class members use `#` prefix
- Underscore prefix for intentionally unused variables (`_unused`)

### Testing
- Bun's built-in test runner (`bun:test`)
- Test files: `*.test.ts` in `tests/` directory
- Create test images dynamically, don't commit fixtures

### Documentation
- JSDoc on all public functions
- Module-level docstrings with `@module` tag
- Comments explain "why", not "what"

## Key Type Files

| File | Contains |
|------|----------|
| `types/domain.ts` | Core domain types (ScreenshotParams, Schedule, ImageFormat, etc.) |
| `types/dithering-strategy.ts` | Strategy interface for dithering algorithms |
| `types/browser-context.ts` | Browser navigation and cache state types |

## Local Development Setup

### Recommended: Docker Dev (ensures ImageMagick version parity)

```bash
cd trmnl-ha/ha-trmnl
cp options-dev.json.example options-dev.json
# Edit options-dev.json with your HA URL and token
./scripts/docker-dev.sh
```

This runs the app inside Docker with hot-reload, using the **exact same ImageMagick 7 Q16-HDRI** version as production. This ensures dithering output is identical between dev and prod.

### Alternative: Native Bun (requires local ImageMagick 7)

If you prefer running outside Docker, you need ImageMagick 7 installed locally:

```bash
# macOS
brew install imagemagick

# Verify version (must be 7.x with Q16-HDRI)
convert -version | head -1
# Should show: Version: ImageMagick 7.x.x Q16-HDRI
```

Then:
1. Copy `options-dev.json.example` to `options-dev.json`
2. Add your HA URL and access token
3. Run `bun run dev`

### Mock HA Server (for development without real HA)

```bash
# Terminal 1: Mock HA server
bun run mock:server

# Terminal 2: App with mock mode
MOCK_HA=true bun run dev
```

## Logging

Uses [LogTape](https://logtape.org) for structured, timestamped logging with zero dependencies.

### Log Format
```
[2025-12-30T11:19:53.454Z] [INFO ] [scheduler] Starting scheduler...
[2025-12-30T11:19:53.454Z] [INFO ] [app] Server started at http://localhost:10000
```

### Usage
```typescript
import { appLogger, browserLogger, schedulerLogger } from './lib/logger.js'

const log = appLogger()
log.info`Server started at ${url}`
log.debug`Processing ${count} items`
log.error`Failed: ${error.message}`
```

### Available Loggers
- `appLogger()` - Main app lifecycle
- `browserLogger()` - Puppeteer/browser operations
- `screenshotLogger()` - Screenshot capture
- `schedulerLogger()` - Cron scheduling
- `cronLogger()` - Cron job management
- `webhookLogger()` - Webhook delivery
- `httpLogger()` - HTTP routing
- `uiLogger()` - UI serving
- `ditheringLogger()` - Image processing
- `navigationLogger()` - Page navigation
- `configLogger()` - Configuration loading

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LOG_LEVEL` | `info` | Log verbosity: trace, debug, info, warning, error, fatal |
| `MOCK_HA` | `false` | Use mock HA server for testing |
| `BROWSER_TIMEOUT` | `60000` | Idle timeout before browser cleanup (ms) |
| `MAX_SCREENSHOTS_BEFORE_RESTART` | `100` | Proactive browser restart threshold |

## Docker Container

- Base: `debian:bookworm-slim` (multi-stage build)
- Chromium for headless browser
- ImageMagick 7 Q16-HDRI (copied from `dpokidov/imagemagick` for consistent dithering)
- Health check: `GET /health` on port 10000
