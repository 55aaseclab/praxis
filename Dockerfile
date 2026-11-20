# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS base
ARG PRAXIS_UID=1000
ARG PRAXIS_GID=1000
RUN groupmod -o -g "${PRAXIS_GID}" node && usermod -o -u "${PRAXIS_UID}" node
WORKDIR /workspace
ENV NODE_ENV=production

FROM base AS deployment-router
COPY --chown=node:node src/deployment ./src/deployment/
COPY --chown=node:node scripts/serve-deploy-proxy.mjs ./scripts/
USER node
CMD ["node", "scripts/serve-deploy-proxy.mjs"]

FROM base AS matrix-reader-build
WORKDIR /build
COPY third_party/matrix-reader/package*.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY third_party/matrix-reader/index.html third_party/matrix-reader/tsconfig.json third_party/matrix-reader/vite.config.mjs ./
COPY third_party/matrix-reader/src/ ./src/
RUN npm run build

FROM base AS praxis
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node src ./src/
COPY --chown=node:node public ./public/
COPY --chown=node:node config ./config/
COPY --chown=node:node scripts ./scripts/
COPY --chown=node:node docs ./docs/
COPY --chown=node:node skills ./skills/
# The context allowlist includes reviewed app metadata, public assets and docs.
COPY --chown=node:node third_party/ ./third_party/
COPY --from=matrix-reader-build --chown=node:node /build/dist/ ./third_party/matrix-reader/dist/
USER node
EXPOSE 4321
CMD ["node", "src/server.mjs", "--host", "0.0.0.0", "--port", "4321"]
