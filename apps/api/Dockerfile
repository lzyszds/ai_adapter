# 构建上下文 = 仓库根目录（monorepo）
# 多阶段构建：运行阶段只保留 api 的生产依赖，显著减小镜像体积。

# ===== 阶段 1：构建 =====
FROM oven/bun:1-slim AS builder

WORKDIR /app

# 复制依赖清单并安装（利用缓存层）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN bun add -g pnpm@10.33.2 && pnpm install --frozen-lockfile

# 复制源码
COPY apps/api apps/api
COPY packages/shared packages/shared

# 在 linux/amd64 构建容器内生成 Prisma Client，避免带入宿主 Windows engine
ENV DATABASE_URL="mysql://user:pass@localhost:3306/db"
RUN pnpm --filter @llm-shield/api db:generate

# ===== 阶段 2：运行时 =====
# 只安装 @llm-shield/api 的生产依赖（不含 web 依赖、不含 devDependencies），镜像大幅瘦身
FROM oven/bun:1-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN bun add -g pnpm@10.33.2 && pnpm install --frozen-lockfile --prod --filter @llm-shield/api

COPY apps/api apps/api
COPY packages/shared packages/shared

# 在运行时镜像内重新生成 Prisma Client（确保引擎与运行时平台一致）
ENV DATABASE_URL="mysql://user:pass@localhost:3306/db"
RUN pnpm --filter @llm-shield/api db:generate

# 入口：启动前同步 schema，然后运行服务
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
