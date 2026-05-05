FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json vitest.config.ts ./
COPY src ./src
RUN corepack enable && pnpm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV VIVADO_MCP_CONFIG=/app/config/vivado-mcp.json
ENV WORKSPACE_ROOT=/workspace
ENV HOME=/workspace/.container-home
ENV TMPDIR=/workspace/.tmp

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY config/vivado-mcp.example.json ./config/vivado-mcp.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
