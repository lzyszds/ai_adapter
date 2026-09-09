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
echo "[entrypoint] syncing Prisma schema..."
cd /app/apps/api
if ! DATABASE_URL="$DATABASE_URL" bun run db:push; then
  echo "[entrypoint] ERROR: prisma db push failed (check DATABASE_URL / MySQL)"
  exit 1
fi
echo "[entrypoint] prisma sync ok"

cd /app
echo "[entrypoint] starting API..."
DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" UPSTREAM_URL="$UPSTREAM_URL" \
  UPSTREAM_API_KEY="$UPSTREAM_API_KEY" PROXY_API_KEY="$PROXY_API_KEY" \
  bun run apps/api/src/index.ts &

i=0
while [ "$i" -lt 30 ]; do
  if bun -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "[entrypoint] API ready"
    break
  fi
  i=$((i + 1))
  sleep 1
done

echo "[entrypoint] starting nginx..."
exec nginx -g 'daemon off;'
