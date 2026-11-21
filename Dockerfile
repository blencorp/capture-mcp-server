# syntax=docker/dockerfile:1
# Hosted HTTP image. Railway builds this file from the repository root; it carries its own start
# command, health check and port, so it does not depend on railway.toml (which Railway stops reading
# on 2026-12-01). HTTP mode refuses to start without auth: set MCP_REQUIRE_OAUTH=true,
# OAUTH_TOKEN_SECRET and MCP_PUBLIC_BASE_URL.

FROM node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# HOST stays unset: Node then listens dual-stack, which Railway's private network needs.
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    PORT=8080
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json LICENSE ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
