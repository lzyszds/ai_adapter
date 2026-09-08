# 构建上下文 = 仓库根目录（monorepo）
FROM oven/bun:1-slim AS base

WORKDIR /app

# 1) 复制依赖清单并安装（利用缓存层）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN bun add -g pnpm@10.33.2 && pnpm install --frozen-lockfile

# 2) 复制源码（node_modules/.cache/prisma 已被 .dockerignore 排除）
COPY apps/api apps/api
COPY packages/shared packages/shared

# 3) 在 linux/amd64 构建容器内重新生成 Prisma Client，避免带入宿主 Windows engine
ENV DATABASE_URL="mysql://user:pass@localhost:3306/db"
RUN pnpm --filter @llm-shield/api db:generate

# 4) 入口：启动前同步 schema，然后运行服务
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
