# 构建上下文 = 仓库根目录（monorepo）
# 单镜像：Nginx 提供前端静态资源，反代本机 Bun API。
# 默认经 DaoCloud 镜像加速拉取基础镜像（Docker Hub 直连超时时可构建）。

ARG NODE_IMAGE=docker.m.daocloud.io/library/node:22-slim
ARG BUN_IMAGE=docker.m.daocloud.io/oven/bun:1-slim

FROM ${NODE_IMAGE} AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate \
  && pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY apps/api apps/api
COPY packages/shared packages/shared

RUN pnpm --filter @llm-shield/web build

ENV DATABASE_URL="mysql://user:pass@localhost:3306/db"
RUN pnpm --filter @llm-shield/api db:generate

FROM ${NODE_IMAGE} AS deps

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate \
  && pnpm install --frozen-lockfile --prod --filter @llm-shield/api

COPY apps/api apps/api
COPY packages/shared packages/shared

ENV DATABASE_URL="mysql://user:pass@localhost:3306/db"
RUN pnpm --filter @llm-shield/api db:generate

FROM ${BUN_IMAGE} AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx openssl ca-certificates \
  && rm -f /etc/nginx/sites-enabled/default \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app /app
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.standalone.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
  && find /app -name '.env' -type f -delete 2>/dev/null || true \
  && find /app -name '.env.*' -type f ! -name '.env.example' -delete 2>/dev/null || true

EXPOSE 80
CMD ["/app/docker-entrypoint.sh"]
