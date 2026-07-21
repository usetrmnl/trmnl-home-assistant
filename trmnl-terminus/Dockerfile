ARG BUILD_FROM
ARG S6_OVERLAY_VERSION=3.2.0.2

# Stage 1: S6 overlay installer
FROM alpine:3.21 AS s6-installer

ARG S6_OVERLAY_VERSION
ARG TARGETARCH

# hadolint ignore=DL3018
RUN apk add --no-cache curl tar xz && \
    case "${TARGETARCH}" in \
        "amd64") S6_ARCH="x86_64" ;; \
        "arm64") S6_ARCH="aarch64" ;; \
        *) echo "Unsupported: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" \
        -o /tmp/s6-noarch.tar.xz && \
    curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" \
        -o /tmp/s6-arch.tar.xz && \
    mkdir -p /s6-root && \
    tar -C /s6-root -Jxpf /tmp/s6-noarch.tar.xz && \
    tar -C /s6-root -Jxpf /tmp/s6-arch.tar.xz

# Stage 2: Final runtime image
# hadolint ignore=DL3006
FROM ${BUILD_FROM}

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# hadolint ignore=DL3002
USER root

ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
ENV S6_CMD_WAIT_FOR_SERVICES_MAXTIME=120000
ENV S6_SERVICES_GRACETIME=30000
ENV HANAMI_PORT=2300

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
        postgresql-18 \
        valkey-server \
        valkey-tools \
        jq \
    && rm -rf /var/lib/apt/lists/*

COPY --from=s6-installer /s6-root /

COPY rootfs /

# hadolint ignore=SC2015
RUN chmod +x /etc/cont-init.d/* && \
    chmod +x /usr/local/bin/* && \
    chmod +x /etc/s6-overlay/s6-rc.d/*/run 2>/dev/null || true && \
    chmod +x /etc/s6-overlay/s6-rc.d/*/finish 2>/dev/null || true && \
    chmod +x /etc/s6-overlay/s6-rc.d/*/data/check 2>/dev/null || true

ENTRYPOINT ["/init"]
