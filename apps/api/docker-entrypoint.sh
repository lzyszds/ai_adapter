#!/bin/sh
set -e

cd /app

# 幂等同步 schema 到 MySQL（自托管单机部署，无需预置 migration 文件）
echo "[entrypoint] syncing Prisma schema..."
bunx prisma db push --schema apps/api/prisma/schema.prisma

echo "[entrypoint] starting API..."
exec bun run apps/api/src/index.ts
