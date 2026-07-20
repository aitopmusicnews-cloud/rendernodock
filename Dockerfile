FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Install ALL dependencies (dev included) for build stage
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# Build web
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @mvs/web build

# Build api
COPY apps/api ./apps/api
RUN pnpm --filter @mvs/api build

# Runtime image
FROM node:20-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/apps/api/dist ./apps/api/dist
COPY --from=base /app/apps/web/dist ./web

RUN mkdir -p ./storage/uploads ./storage/analyses ./storage/renders ./storage/clips ./storage/images

ENV NODE_ENV=production
ENV WEB_DIST_DIR=/app/web
ENV PORT=3001

EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
