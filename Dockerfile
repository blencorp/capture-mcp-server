# syntax=docker/dockerfile:1
# Hosted HTTP image. Railway builds this file from the repository root; it carries its own start
# command, health check and port. Railway settings live in .railway/railway.ts. HTTP mode refuses
# to start without auth: set MCP_REQUIRE_OAUTH=true, OAUTH_TOKEN_SECRET and MCP_PUBLIC_BASE_URL.

# Base images are pinned by digest; Dependabot (docker ecosystem) proposes digest bumps.
FROM node:26-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS build
WORKDIR /app
# Node 25+ no longer bundles corepack; install the pnpm that package.json "packageManager" pins.
RUN npm install -g --ignore-scripts pnpm@12.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
COPY legal ./legal
RUN pnpm build && pnpm prune --prod

# ---- Docs: the documentation site (site/, Astro Starlight), served at /docs ---------------
# Its own pnpm root and lockfile. The build reads docs/sdk-reference.md and examples/*.json.
FROM node:26-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS docs
WORKDIR /repo
RUN npm install -g --ignore-scripts pnpm@12.21.0
COPY site/package.json site/pnpm-lock.yaml site/pnpm-workspace.yaml ./site/
RUN cd site && pnpm install --frozen-lockfile
COPY site ./site
COPY docs/sdk-reference.md ./docs/
COPY examples ./examples
RUN cd site && pnpm build

FROM node:26-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS runtime
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
# The documentation site sits beside dist/ (src/http-app.ts looks for ../docs-site from dist/).
COPY --from=docs --chown=node:node /repo/site/dist ./docs-site
COPY --chown=node:node package.json LICENSE NOTICE ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
