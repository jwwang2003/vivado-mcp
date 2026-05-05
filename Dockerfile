FROM node:22-bookworm-slim AS base

ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates libc6-dev libtinfo5 libx11-6 locales tini \
  && sed -i 's/^# *\(en_US.UTF-8 UTF-8\)/\1/' /etc/locale.gen \
  && locale-gen \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM deps AS test

WORKDIR /app
COPY package.json tsconfig.json vitest.config.ts Dockerfile docker-compose.yml docker-entrypoint.sh ./
COPY .dockerignore .gitmodules ./
COPY src ./src
COPY tests ./tests
COPY config ./config
COPY demos ./demos
COPY 3rdParty ./3rdParty
CMD ["pnpm", "test"]

FROM base AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json vitest.config.ts ./
COPY src ./src
RUN corepack enable && pnpm run build

FROM base AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV VIVADO_MCP_CONFIG=/app/config/vivado-mcp.json
ENV WORKSPACE_ROOT=/workspace
ENV HOME=/workspace/.container-home
ENV TMPDIR=/workspace/.tmp

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY config/vivado-mcp.example.json ./config/vivado-mcp.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
