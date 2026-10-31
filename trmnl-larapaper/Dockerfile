# LaraPaper for Home Assistant: the official LaraPaper image plus Home Assistant's
# /data, options and ingress. The Supervisor (and CI) pass BUILD_FROM from build.yaml.
ARG BUILD_FROM
# hadolint ignore=DL3006
FROM ${BUILD_FROM}

# Root so the entrypoint hook can take ownership of the Supervisor-mounted /data;
# PHP-FPM workers still run as www-data (serversideup-php images support this).
# hadolint ignore=DL3002
USER root

# OPcache on, as in LaraPaper's own docker-compose
ENV PHP_OPCACHE_ENABLE=1

COPY rootfs /
RUN chmod +x /etc/entrypoint.d/10-homeassistant.sh

# Home Assistant's add-on linter wants the native health check rather than a watchdog:
# healthy once Laravel answers (LaraPaper's /up).
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -fsS -o /dev/null http://localhost:8080/up || exit 1
