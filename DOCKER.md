# TRMNL HA - Docker Container Setup

**For Home Assistant Container (Docker) users who cannot use add-ons**

If you're running Home Assistant in Docker (not HA OS or HA Supervised), you can run TRMNL HA as a standalone container alongside your Home Assistant installation.

## Why This Guide?

Home Assistant add-ons are **only available** in:
- Home Assistant OS
- Home Assistant Supervised (deprecated)

If you see this error when trying to use the add-on:
> "This redirect is not supported by your Home Assistant installation..."

You need to use this standalone Docker setup instead.

## Quick Start

### 1. Prerequisites

- Docker and Docker Compose installed
- Home Assistant running in Docker
- Home Assistant long-lived access token

### 2. Setup

```bash
# Clone or download the repository
git clone https://github.com/usetrmnl/trmnl-home-assistant.git
cd trmnl-home-assistant

# Copy and configure environment file
cp .env.example .env
nano .env  # or use your preferred editor
```

### 3. Configure `.env`

Edit `.env` with your settings:

```env
# REQUIRED: Your Home Assistant URL
HA_URL=http://homeassistant:8123

# REQUIRED: Long-lived access token
HA_TOKEN=your_long_lived_access_token_here

# OPTIONAL: Performance settings
KEEP_BROWSER_OPEN=false
DEBUG_LOGGING=false
```

**Getting your access token:**
1. Open Home Assistant
2. Click your profile (bottom left)
3. Scroll to "Long-Lived Access Tokens"
4. Click "Create Token"
5. Copy the token to your `.env` file

### 4. Start the Container

```bash
docker compose up -d
```

### 5. Verify It's Running

```bash
# Check status
docker compose ps

# View logs
docker compose logs -f

# Check health
curl http://localhost:10000/health
```

### 6. Access the Web UI

Open your browser to: **http://localhost:10000**

## Network Configuration

The default setup assumes your Home Assistant container is named `homeassistant` and uses Docker's default bridge network.

### If HA Uses a Custom Network

1. Find your HA network:
```bash
docker inspect homeassistant | grep -A5 Networks
```

2. Edit `docker-compose.yml` and uncomment the networks section:
```yaml
services:
  trmnl-ha:
    # ... other config ...
    networks:
      - homeassistant  # Your HA network name

networks:
  homeassistant:
    external: true
```

### If HA is on the Host Network

Use `host.docker.internal` instead:
```env
HA_URL=http://host.docker.internal:8123
```

### If HA is on a Different Machine

Use the IP address or hostname:
```env
HA_URL=http://192.168.1.100:8123
```

## Configuration Options

All settings can be configured via environment variables in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `HA_URL` | `http://homeassistant:8123` | Home Assistant base URL |
| `HA_TOKEN` | *(required)* | Long-lived access token |
| `KEEP_BROWSER_OPEN` | `false` | Keep browser alive (faster, more memory) |
| `BROWSER_TIMEOUT` | `60000` | Idle timeout before browser cleanup (ms) |
| `MAX_SCREENSHOTS_BEFORE_RESTART` | `100` | Max screenshots before browser restart |
| `DEBUG_LOGGING` | `false` | Enable debug logs |
| `LOG_LEVEL` | `info` | Log level (trace/debug/info/warning/error/fatal) |
| `PORT` | `10000` | Web UI port |

## Managing the Container

```bash
# Start
docker compose up -d

# Stop
docker compose down

# Restart
docker compose restart

# View logs
docker compose logs -f

# Update to latest version
docker compose pull
docker compose up -d

# Remove (keeps data)
docker compose down

# Remove including data
docker compose down -v
```

## Data Persistence

Your schedules and configurations are stored in Docker volumes:
- `trmnl-data` - Schedule configurations
- `trmnl-logs` - Application logs
- `trmnl-output` - Screenshot outputs

These persist across container restarts and updates.

## Troubleshooting

### "Connection refused" when connecting to HA

**Problem:** TRMNL can't reach your Home Assistant container.

**Solutions:**
1. Verify HA container name: `docker ps | grep homeassistant`
2. If different, update `HA_URL` in `.env`
3. Check they're on the same network: `docker network inspect bridge`
4. Try using HA's IP address instead of hostname

### "Unauthorized" or "Invalid token"

**Problem:** Access token is invalid or expired.

**Solutions:**
1. Verify token is correct (no extra spaces)
2. Create a new long-lived access token in HA
3. Update `HA_TOKEN` in `.env`
4. Restart: `docker compose restart`

### Browser crashes or "Out of memory"

**Problem:** Container doesn't have enough memory.

**Solutions:**
1. Increase memory limit in `docker-compose.yml`:
```yaml
mem_limit: 2g  # Increase from 1g
```
2. Set `KEEP_BROWSER_OPEN=false` to reduce memory usage
3. Restart: `docker compose restart`

### Port 10000 already in use

**Problem:** Another service is using port 10000.

**Solutions:**
1. Change port in `.env`:
```env
PORT=10001
```
2. Restart: `docker compose restart`

### Images look washed out or incorrect

**Problem:** Dithering settings not optimized for your display.

**Solutions:**
1. Use the device presets in the Web UI
2. Try different dithering methods (Floyd-Steinberg vs Ordered)
3. Enable normalization for better contrast
4. See [Image Quality](trmnl-ha/DOCS.md#image-quality) guide

## Differences from Add-on

| Feature | Add-on | Docker Standalone |
|---------|--------|-------------------|
| Installation | HA Store | `docker compose up` |
| Configuration | HA UI | `.env` file |
| Sidebar Integration | ✅ Yes | ❌ No (direct access only) |
| Ingress Support | ✅ Yes | ❌ No |
| Updates | HA Store | `docker compose pull` |
| Network Setup | Automatic | Manual (usually simple) |
| Data Persistence | `/data` | Docker volumes |

**Note:** The standalone Docker setup doesn't include Home Assistant's ingress or sidebar integration. You'll access the Web UI directly at `http://localhost:10000` instead.

## Security Considerations

**IMPORTANT:** The Web UI has **no built-in authentication**.

### Recommendations:
1. ✅ Only expose to trusted networks (home LAN)
2. ❌ Never expose port 10000 to the internet
3. ✅ Use a reverse proxy (Nginx, Caddy) with authentication if needed
4. ✅ Keep your `HA_TOKEN` secure in `.env`
5. ✅ Add `.env` to `.gitignore` if committing to git

### Example Reverse Proxy (Nginx)

```nginx
location /trmnl/ {
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://localhost:10000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## Next Steps

Once running:

1. **Test basic screenshot**: Visit `http://localhost:10000/lovelace/0?viewport=800x480`
2. **Create a schedule**: Use the Web UI to set up automated captures
3. **Configure TRMNL webhook**: Add your TRMNL plugin webhook URL for automatic uploads
4. **Optimize for your display**: Use device presets and adjust dithering settings

## Support

- **Documentation**: [DOCS.md](trmnl-ha/DOCS.md)
- **Issues**: [GitHub Issues](https://github.com/usetrmnl/trmnl-home-assistant/issues)
- **TRMNL**: [usetrmnl.com](https://usetrmnl.com)

## Alternative: Pre-built Scripts

If you prefer not to use docker-compose, the repository includes standalone scripts:

```bash
cd trmnl-ha/ha-trmnl

# Copy and edit configuration
cp options-dev.json.example options-dev.json
nano options-dev.json

# Build and run
./scripts/docker-build.sh
./scripts/docker-run.sh
```

See [Local Development](trmnl-ha/DOCS.md#local-development) for details.
