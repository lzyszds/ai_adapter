import { z } from "zod";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  // 上游中转站地址，例如 https://api.midway.example.com/v1
  UPSTREAM_URL: z.string().url().default("http://localhost:4000/v1"),
  // 可选：服务端固定上游 Key；留空则使用 Claude 客户端填入的 Key 转发上游（仪表盘亦同）。
  UPSTREAM_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),

  DATABASE_URL: z
    .string()
    .default(
      "mysql://root:root@localhost:3306/llm_shield?connection_limit=20"
    ),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  // 缓冲刷新周期（毫秒），将 Redis 中累积的请求批量写入 MySQL。
  FLUSH_INTERVAL_MS: z.coerce.number().default(5000),
  // 批量写入单次最大条数。
  FLUSH_BATCH_SIZE: z.coerce.number().default(500),

  // 统计缓存 TTL（毫秒）。
  STATS_CACHE_TTL_MS: z.coerce.number().default(10000),

  // 与流式透传相关
  STREAM_IDLE_TIMEOUT_MS: z.coerce.number().default(120000),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = Bun.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    console.error("[config] 环境变量校验失败:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export const config = loadConfig();
