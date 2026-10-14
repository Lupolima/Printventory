# JusttPrint server image: plain Node, no Electron. Build from the project folder:
#   docker build -f docker/Dockerfile .
# The server is src/server/index.js. Thumbnails render in headless Chromium (Puppeteer).

# --- Dependencies: production packages only, with better-sqlite3 built for Node ---
FROM node:22-trixie-slim AS deps

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# .npmrc sets legacy-peer-deps, which the lock file was written with.
COPY package.json package-lock.json .npmrc ./

# Electron and the build tooling are dev dependencies, so --omit=dev leaves them out.
# Puppeteer uses the system Chromium installed below instead of downloading its own.
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm rebuild better-sqlite3 \
    && node -e "new (require('better-sqlite3'))(':memory:').close()" \
    && npm cache clean --force

# --- Web UI: the React screens (src/web/) built with Vite into web-build/ ---
FROM node:22-trixie-slim AS web

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY vite.config.mjs ./
COPY src/web ./src/web
RUN npm run build:web

# --- Runtime ---
FROM node:22-trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Everything else; .dockerignore keeps tests, desktop build files and local data out.
COPY . .
COPY --from=web /app/web-build ./web-build

COPY docker/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Chromium's path and NODE_ENV are set in docker-entrypoint.sh rather than with ENV, so tools that
# read the image (Unraid's Docker Hub search) do not list them as settings to fill in.

# The database, thumbnails, settings and backups; mount a folder here to keep them.
VOLUME /root/.config/justtprint
EXPOSE 5000

# Shown by Unraid for a container from any template, and by registries.
LABEL net.unraid.docker.webui="http://[IP]:[PORT:5000]/" \
      net.unraid.docker.icon="https://raw.githubusercontent.com/ngolston/JusttPrint/main/assets/pwa-icon-512.png" \
      org.opencontainers.image.title="JusttPrint" \
      org.opencontainers.image.description="A self-hosted library for your 3D printing models" \
      org.opencontainers.image.source="https://github.com/ngolston/JusttPrint" \
      org.opencontainers.image.licenses="MIT"
# Healthy once /api/health answers on the port the server actually listens on (see src/server/healthcheck.js).
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD ["node", "/app/src/server/healthcheck.js"]

ENTRYPOINT ["docker-entrypoint.sh"]
