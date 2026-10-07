# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --omit=dev; else npm ci --omit=dev; fi
COPY scripts/build.mjs scripts/build.mjs
COPY web web
COPY worker worker
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/dist dist
COPY --from=build --chown=node:node /app/worker worker
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server server
COPY --chown=node:node scripts/password-hash.mjs scripts/state-transfer.mjs scripts/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/index.mjs"]
