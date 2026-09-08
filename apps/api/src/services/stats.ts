import type { StatsResponse, ModelDetail, TrendPoint } from "@llm-shield/shared";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { config } from "../config";
import { logger } from "../lib/logger";

const CACHE_KEY = "cache:stats";

export async function getStats(): Promise<StatsResponse> {
  if (redis.status === "ready") {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return JSON.parse(cached) as StatsResponse;
    } catch (error) { logger.warn("[stats] cache read failed", error); }
  }

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [logs, grouped] = await Promise.all([
    prisma.requestLog.findMany({ where: { timestamp: { gte: since } }, orderBy: { timestamp: "asc" } }),
    prisma.requestLog.groupBy({
      by: ["mappedModel"],
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
    }),
  ]);

  const totalRequests = logs.length;
  const successCount = logs.filter((x) => x.statusCode >= 200 && x.statusCode < 300).length;
  const promptTokens = logs.reduce((n, x) => n + x.promptTokens, 0);
  const completionTokens = logs.reduce((n, x) => n + x.completionTokens, 0);
  const totalTokens = logs.reduce((n, x) => n + x.totalTokens, 0);
  const avgDurationMs = totalRequests ? Math.round(logs.reduce((n, x) => n + x.duration, 0) / totalRequests) : 0;

  const models: ModelDetail[] = grouped.map((g) => {
    const modelLogs = logs.filter((x) => x.mappedModel === g.mappedModel);
    const successes = modelLogs.filter((x) => x.statusCode >= 200 && x.statusCode < 300).length;
    return {
      mappedModel: g.mappedModel,
      requestCount: g._count._all,
      successCount: successes,
      successRate: g._count._all ? successes / g._count._all : 0,
      promptTokens: g._sum.promptTokens ?? 0,
      completionTokens: g._sum.completionTokens ?? 0,
      totalTokens: g._sum.totalTokens ?? 0,
      originalModels: [...new Set(modelLogs.map((x) => x.originalModel))],
    };
  });

  const trendMap = new Map<string, TrendPoint>();
  for (const log of logs) {
    const date = new Date(log.timestamp);
    date.setMinutes(Math.floor(date.getMinutes() / 5) * 5, 0, 0);
    const timestamp = date.toISOString();
    const point = trendMap.get(timestamp) ?? { timestamp, requestCount: 0, totalTokens: 0 };
    point.requestCount += 1;
    point.totalTokens += log.totalTokens;
    trendMap.set(timestamp, point);
  }

  const result: StatsResponse = {
    summary: { totalRequests, successCount, failedCount: totalRequests - successCount, promptTokens, completionTokens, totalTokens, avgDurationMs },
    models,
    trends: [...trendMap.values()],
    generatedAt: new Date().toISOString(),
  };
  if (redis.status === "ready") {
    try { await redis.set(CACHE_KEY, JSON.stringify(result), "PX", config.STATS_CACHE_TTL_MS); }
    catch (error) { logger.warn("[stats] cache write failed", error); }
  }
  return result;
}
