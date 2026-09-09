import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { config } from "./config";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { initBuffer, stopFlusher } from "./services/buffer";
import { getStats } from "./services/stats";
import { isStatsAuthorized } from "./lib/auth";
import { proxyRequest } from "./middleware/proxy";

const app = new Elysia()
  .use(cors({ origin: true, credentials: true }))
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") { set.status = 400; return { error: "Bad Request" }; }
    logger.error("[api] unhandled error", error);
    set.status = 500;
    return { error: "Internal Server Error" };
  })
  .get("/health", async () => {
    let redisOk = false;
    let databaseOk = false;
    try {
      if (redis.status === "ready") {
        await redis.ping();
        redisOk = true;
      }
    } catch { /* health endpoint reports dependency state */ }
    try {
      await prisma.$queryRaw`SELECT 1`;
      databaseOk = true;
    } catch { /* health endpoint reports dependency state */ }
    return {
      status: redisOk && databaseOk ? "ok" : "degraded",
      uptime: process.uptime(),
      redis: redisOk ? "up" : "down",
      database: databaseOk ? "up" : "down",
      timestamp: new Date().toISOString(),
    };
  })
  .get("/api/stats", ({ request, set }) => {
    if (!isStatsAuthorized(request)) {
      set.status = 401;
      return { error: "Unauthorized", message: "需要有效的上游 API Key" };
    }
    return getStats();
  })
  // 兜底：所有未被 API 路由匹配的请求视为代理请求，透传原始路径。
  .all("/*", ({ request }) => proxyRequest(request));

await initBuffer();

const server = app.listen(config.PORT);

async function shutdown(signal: string) {
  logger.info(`收到 ${signal}，开始优雅关闭...`);
  try {
    await stopFlusher();
    await prisma.$disconnect();
    await redis.quit();
  } catch (error) {
    logger.error("[shutdown]", error);
  }
  server.stop();
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

logger.info(`llm-shield API 已启动: http://${config.PORT} (upstream=${config.UPSTREAM_URL}, redis=${redis.status})`);