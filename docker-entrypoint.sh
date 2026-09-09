#!/bin/sh
set -e

# 清除镜像内可能残留的 .env，防止 Bun/Prisma 读到 localhost
find /app -name '.env' -type f -delete 2>/dev/null || true
find /app -name '.env.*' -type f ! -name '.env.example' -delete 2>/dev/null || true

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL 未设置"
  exit 1
fi

echo "[entrypoint] DATABASE_URL host: $(echo "$DATABASE_URL" | sed -E 's|.*@([^/]+)/.*|\1|')"

cd /app/apps/api

schema_ready=0
if [ "${PRISMA_DB_PUSH:-auto}" != "always" ]; then
  if DATABASE_URL="$DATABASE_URL" bun -e "
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    try {
      // 校验表及关键列（question/is_stream 等），避免旧库仅有表结构时跳过 db push
      await prisma.\$queryRaw\`SELECT question, is_stream FROM request_logs LIMIT 1\`;
      process.exit(0);
    } catch {
      process.exit(1);
    } finally {
      await prisma.\$disconnect();
    }
  " 2>/dev/null; then
    schema_ready=1
    echo "[entrypoint] schema ready, skip db push"
  fi
fi

if [ "$schema_ready" -eq 0 ]; then
  echo "[entrypoint] syncing Prisma schema..."
  if ! DATABASE_URL="$DATABASE_URL" bunx prisma db push --skip-generate --schema prisma/schema.prisma; then
    echo "[entrypoint] ERROR: prisma db push failed (check DATABASE_URL / MySQL)"
    exit 1
  fi
  echo "[entrypoint] prisma sync ok"
fi

cd /app
echo "[entrypoint] starting API..."
DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" UPSTREAM_URL="$UPSTREAM_URL" \
  UPSTREAM_API_KEY="$UPSTREAM_API_KEY" \
  bun run apps/api/src/index.ts &

api_ready=0
i=0
while [ "$i" -lt 45 ]; do
  if bun -e "
    fetch('http://127.0.0.1:3000/health')
      .then(async (r) => {
        if (!r.ok) process.exit(1);
        const j = await r.json();
        process.exit(j.status === 'ok' && j.database === 'up' ? 0 : 1);
      })
      .catch(() => process.exit(1));
  " 2>/dev/null; then
    api_ready=1
    echo "[entrypoint] API ready"
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$api_ready" -eq 0 ]; then
  echo "[entrypoint] ERROR: API failed to start within 45s (check logs above)"
  exit 1
fi

echo "[entrypoint] starting nginx..."
exec nginx -g 'daemon off;'
