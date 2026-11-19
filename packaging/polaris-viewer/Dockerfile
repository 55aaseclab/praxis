# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/polaris-portal/package.json ./apps/polaris-portal/
COPY packages/polaris-shell/package.json ./packages/polaris-shell/
COPY packages/surface-wanghai/package.json ./packages/surface-wanghai/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY apps/polaris-portal ./apps/polaris-portal/
COPY packages ./packages/
RUN npm run build

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
ARG REVISION
LABEL org.opencontainers.image.revision=$REVISION
WORKDIR /viewer
COPY --from=build /src/apps/polaris-portal/dist/ ./apps/polaris-portal/dist/
COPY --chmod=0444 server.mjs entrypoint.mjs ingress.mjs ./
# A fixed regular-file target makes the runtime reject a directory bind here.
RUN mkdir -p /run/praxis && touch /run/praxis/observations.json && chmod 000 /run/praxis/observations.json
ENV NODE_ENV=production
USER node
EXPOSE 18787
ENTRYPOINT ["node", "--permission", "--allow-fs-read=/viewer", "--allow-fs-read=/run/praxis/observations.json", "entrypoint.mjs"]
