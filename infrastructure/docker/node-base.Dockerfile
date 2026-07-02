# syntax=docker/dockerfile:1
#
# hms-node-base — Shared Node.js base image for the Hospital Management System (HMS).
# -----------------------------------------------------------------------------------
# Purpose: a single, consistent Node.js runtime base that per-service Dockerfiles MAY
# extend to avoid duplication (see infrastructure/docker/README.md). It establishes:
#   * a pinned Node.js LTS Alpine base (Node 20; satisfies backend `engines: node >=18`),
#   * proper PID 1 signal handling via tini (clean SIGTERM/SIGINT -> graceful shutdown,
#     zombie reaping) — important for fast, correct pod termination in Kubernetes,
#   * a non-root user (`node`, shipped by the official image) for defense-in-depth,
#   * common OCI LABELs, a default WORKDIR, and
#   * a HEALTHCHECK scaffold hitting `GET /health` (the platform-wide health convention
#     used by every backend service + gateway and by K8s readiness/liveness probes).
#
# NOTE: This base image is OPTIONAL. The current per-service Dockerfiles
# (../../backend/<service>/Dockerfile, ../../frontend/Dockerfile) build directly on
# node:20-alpine / nginx:1.27-alpine. Adopt this base incrementally: build & tag it
# (e.g. `docker build -f infrastructure/docker/node-base.Dockerfile -t hms/node-base:20 .`)
# then change a service's first stage to `FROM hms/node-base:20`.
#
# This image contains NO application code and NO secrets.

ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine AS hms-node-base

# --- Common OCI image metadata (override org/source at build time as needed) ---
LABEL org.opencontainers.image.title="hms-node-base" \
      org.opencontainers.image.description="Shared Node.js (Alpine) base image for Hospital Management System services" \
      org.opencontainers.image.vendor="Hospital Management System" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.base.name="node:${NODE_VERSION}-alpine"

# --- Signal handling: tini becomes PID 1 and forwards signals to the app ---
# (Alternative at run time: `docker run --init ...`; tini baked in works everywhere,
#  including Kubernetes where `--init` is not available.)
RUN apk add --no-cache tini \
    && mkdir -p /app \
    && chown -R node:node /app

# Sensible production defaults (a build stage may override NODE_ENV=development).
ENV NODE_ENV=production
WORKDIR /app

# Run as the built-in non-root user provided by the official Node image.
USER node

# Health port the HEALTHCHECK probes. Downstream images MUST set this to their own
# service port (e.g. `ENV HEALTH_PORT=4001`) so the scaffold targets the right port.
# Defaults to 8080 (the API gateway port).
ENV HEALTH_PORT=8080

# HEALTHCHECK scaffold hitting the platform-wide `GET /health` endpoint using BusyBox
# `wget` (present in Alpine). Downstream images may redefine HEALTHCHECK if desired.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${HEALTH_PORT}/health" || exit 1

# tini as the entrypoint for correct signal handling; downstream images set their CMD
# (e.g. `CMD ["node", "src/server.js"]`). The default CMD is a harmless no-op.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--version"]
