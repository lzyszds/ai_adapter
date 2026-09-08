import { config } from "../config";
import { prisma } from "../lib/prisma";
import { redis, connectRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import type { RequestRecord } from "../types";

const QUEUE_KEY = "buffer:requests";

/** 将请求记录送入缓冲：Redis 队列优先，Redis 不可用时降级直写 MySQL。 */
export async function enqueue(record: RequestRecord): Promise<void> {
  if (redis.status === "ready") {
    try {
      await redis.rpush(QUEUE_KEY, JSON.stringify(record));
      return;
    } catch (error) {
      logger.warn("[buffer] rpush 失败，降级直写 MySQL:", error);
    }
  }
  await writeDirect([record]);
}

async function writeDirect(records: RequestRecord[]): Promise<boolean> {
  if (records.length === 0) return true;
  try {
    await prisma.requestLog.createMany({
      data: records.map((r) => ({
        originalModel: r.originalModel,
        mappedModel: r.mappedModel,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        statusCode: r.statusCode,
        duration: r.duration,
        timestamp: new Date(r.timestamp),
      })),
    });
    return true;
  } catch (error) {
    logger.error("[buffer] 直写 MySQL 失败，稍后重试:", error);
    return false;
  }
}

/** 批量消费 Redis 队列并写入 MySQL，仅移除成功写入的条目。 */
async function flush(): Promise<void> {
  if (redis.status !== "ready") return;

  let batch: string[] = [];
  try {
    batch = await redis.lrange(QUEUE_KEY, 0, config.FLUSH_BATCH_SIZE - 1);
  } catch (error) {
    logger.warn("[buffer] lrange 失败:", error);
    return;
  }
  if (batch.length === 0) return;

  const records: RequestRecord[] = [];
  for (const item of batch) {
    try {
      records.push(JSON.parse(item));
    } catch {
      // 跳过损坏条目
    }
  }

  const ok = await writeDirect(records);
  if (!ok) return; // 保留队列，下次落库重试，避免丢数据
  // 仅对成功写入的批次做清理，避免重复消费。
  try {
    await redis.ltrim(QUEUE_KEY, batch.length, -1);
  } catch (error) {
    logger.warn("[buffer] ltrim 失败:", error);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startFlusher(): void {
  if (timer) return;
  timer = setInterval(() => {
    flush().catch((e) => logger.error("[buffer] flush 异常:", e));
  }, config.FLUSH_INTERVAL_MS);
  // 避免在进程退出时被阻塞
  if (timer.unref) timer.unref();
  logger.info(`[buffer] 刷新任务已启动，周期 ${config.FLUSH_INTERVAL_MS}ms`);
}

/** 优雅停机：停止定时器，尽力清空剩余队列。 */
export async function stopFlusher(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (redis.status === "ready") {
    try {
      await flush();
    } catch (e) {
      logger.error("[buffer] 停机清空失败:", e);
    }
  }
}

export async function initBuffer(): Promise<void> {
  const ok = await connectRedis();
  if (!ok) {
    logger.warn("[buffer] Redis 不可用，将降级直写 MySQL");
  }
  startFlusher();
}
