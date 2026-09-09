import type { StatsResponse, ModelDetail, RecentRequest, StatsWindow, TrendPoint } from "@llm-shield/shared";
import { resolveStatsWindow } from "@llm-shield/shared";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { config } from "../config";
import { logger } from "../lib/logger";

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

export async function getStats(window: StatsWindow = "1h"): Promise<StatsResponse> {
  const { key, config: windowConfig } = resolveStatsWindow(window);
  const cacheKey = `cache:stats:${key}`;
  if (redis.status === "ready") {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as StatsResponse;
    } catch (error) { logger.warn("[stats] cache read failed", error); }
  }

  const now = Date.now();
  const since = new Date(now - windowConfig.seconds * 1000);
  const logs = await prisma.requestLog.findMany({
    where: { timestamp: { gte: since } },
    orderBy: { timestamp: "asc" },
  });
  const totalRequests = logs.length;
  const successCount = logs.filter((x) => x.statusCode >= 200 && x.statusCode < 300).length;
  const failedCount = totalRequests - successCount;
  const promptTokens = logs.reduce((n, x) => n + x.promptTokens, 0);
  const completionTokens = logs.reduce((n, x) => n + x.completionTokens, 0);
  const totalTokens = logs.reduce((n, x) => n + x.totalTokens, 0);
  const durations = logs.map((x) => Math.max(0, x.duration));
  const totalDurationMs = durations.reduce((n, x) => n + x, 0);
  const recentRateSince = new Date(now - 120 * 1000);
  const recentRateCount = logs.filter((x) => x.timestamp >= recentRateSince).length;
  const statusMap = new Map<number, number>();
  for (const log of logs) statusMap.set(log.statusCode, (statusMap.get(log.statusCode) ?? 0) + 1);

  const models: ModelDetail[] = [];
  const modelMap = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = modelMap.get(log.mappedModel) ?? [];
    list.push(log);
    modelMap.set(log.mappedModel, list);
  }
  for (const [mappedModel, modelLogs] of modelMap) {
    const successes = modelLogs.filter((x) => x.statusCode >= 200 && x.statusCode < 300).length;
    models.push({
      mappedModel,
      requestCount: modelLogs.length,
      successCount: successes,
      successRate: modelLogs.length ? successes / modelLogs.length : 0,
      promptTokens: modelLogs.reduce((n, x) => n + x.promptTokens, 0),
      completionTokens: modelLogs.reduce((n, x) => n + x.completionTokens, 0),
      totalTokens: modelLogs.reduce((n, x) => n + x.totalTokens, 0),
      originalModels: [...new Set(modelLogs.map((x) => x.originalModel))],
      avgDurationMs: modelLogs.length ? Math.round(modelLogs.reduce((n, x) => n + x.duration, 0) / modelLogs.length) : 0,
      streamingCount: modelLogs.filter((x) => x.isStream).length,
    });
  }
  models.sort((a, b) => b.totalTokens - a.totalTokens);

  const trendMap = new Map<number, TrendPoint>();
  for (const log of logs) {
    const bucket = Math.floor(new Date(log.timestamp).getTime() / windowConfig.bucketMs) * windowConfig.bucketMs;
    const timestamp = new Date(bucket).toISOString();
    const point = trendMap.get(bucket) ?? {
      timestamp, requestCount: 0, totalTokens: 0, successCount: 0, failedCount: 0, totalDurationMs: 0, avgDurationMs: 0,
    };
    point.requestCount += 1;
    point.totalTokens += log.totalTokens;
    point.totalDurationMs += log.duration;
    if (log.statusCode >= 200 && log.statusCode < 300) point.successCount += 1;
    else point.failedCount += 1;
    point.avgDurationMs = Math.round(point.totalDurationMs / point.requestCount);
    trendMap.set(bucket, point);
  }

  const recentRequests: RecentRequest[] = [...logs].reverse().slice(0, 50).map((log) => ({
    id: log.id,
    timestamp: log.timestamp.toISOString(),
    originalModel: log.originalModel,
    mappedModel: log.mappedModel,
    question: log.question,
    statusCode: log.statusCode,
    duration: log.duration,
    totalTokens: log.totalTokens,
    isStream: log.isStream,
  }));
  const result: StatsResponse = {
    summary: {
      totalRequests,
      successCount,
      failedCount,
      promptTokens,
      completionTokens,
      totalTokens,
      avgDurationMs: totalRequests ? Math.round(totalDurationMs / totalRequests) : 0,
      requestsPerMinute: totalRequests / (windowConfig.seconds / 60),
      requestsPerSecond: recentRateCount / 120,
      tokensPerSecond: totalTokens / windowConfig.seconds,
      successRate: totalRequests ? successCount / totalRequests : 0,
      p50LatencyMs: percentile(durations, 0.5),
      p95LatencyMs: percentile(durations, 0.95),
      maxDurationMs: Math.max(...durations, 0),
      streamingCount: logs.filter((x) => x.isStream).length,
      statusBreakdown: [...statusMap.entries()].sort((a, b) => a[0] - b[0]).map(([statusCode, count]) => ({ statusCode, count })),
      windowSeconds: windowConfig.seconds,
    },
    models,
    trends: [...trendMap.entries()].sort((a, b) => a[0] - b[0]).map(([, point]) => point),
    recentRequests,
    generatedAt: new Date().toISOString(),
    windowSeconds: windowConfig.seconds,
  };
  if (redis.status === "ready") {
    try { await redis.set(cacheKey, JSON.stringify(result), "PX", config.STATS_CACHE_TTL_MS); }
    catch (error) { logger.warn("[stats] cache write failed", error); }
  }
  return result;
}
