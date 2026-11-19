# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS base
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
COPY --chown=node:node third_party/reminder/docs/ ./third_party/reminder/docs/
COPY --chown=node:node third_party/travel/docs/ ./third_party/travel/docs/
COPY --chown=node:node third_party/knowledge/docs/ ./third_party/knowledge/docs/
COPY --chown=node:node third_party/projects/docs/ ./third_party/projects/docs/
COPY --chown=node:node third_party/finance/docs/ ./third_party/finance/docs/
COPY --chown=node:node third_party/intelligence/docs/ ./third_party/intelligence/docs/
COPY --chown=node:node third_party/memo/docs/ ./third_party/memo/docs/
COPY --chown=node:node third_party/tingproof/docs/ ./third_party/tingproof/docs/
COPY --chown=node:node third_party/lattice/docs/ ./third_party/lattice/docs/
COPY --chown=node:node third_party/lattice/src/business/schema.mjs ./third_party/lattice/src/business/schema.mjs
COPY --chown=node:node third_party/letters ./third_party/letters/
COPY --chown=node:node third_party/profiles ./third_party/profiles/
COPY --chown=node:node third_party/calendar ./third_party/calendar/
COPY --chown=node:node third_party/polaris/apps/docs/site/development/prd.md third_party/polaris/apps/docs/site/development/prd.zh-CN.md ./third_party/polaris/apps/docs/site/development/
COPY --chown=node:node third_party/matrix-reader/PRD.md ./third_party/matrix-reader/
COPY --from=matrix-reader-build --chown=node:node /build/dist/ ./third_party/matrix-reader/dist/
USER node
EXPOSE 4321
CMD ["node", "src/server.mjs", "--host", "0.0.0.0", "--port", "4321"]
