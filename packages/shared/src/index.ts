/** 共享类型：API 与 Web 之间约定的数据结构，避免两端手写不一致。 */

export const TARGET_MODEL = "glm-5.3";

/** 模型重写规则：按参考实现采用子串匹配（不区分大小写），命中即替换为 TARGET_MODEL。 */
export const MODEL_KEYWORDS = ["claude", "sonnet", "opus", "haiku"] as const;

export function rewriteModelName(model: string): string {
  const lower = model.toLowerCase();
  return MODEL_KEYWORDS.some((k) => lower.includes(k)) ? TARGET_MODEL : model;
}

export interface StatsSummary {
  totalRequests: number;
  successCount: number;
  failedCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number;
}

export interface ModelDetail {
  mappedModel: string;
  requestCount: number;
  successCount: number;
  successRate: number; // 0-1
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  originalModels: string[];
}

export interface TrendPoint {
  timestamp: string; // ISO 8601，整点/分钟刻度的起点
  requestCount: number;
  totalTokens: number;
}

export interface StatsResponse {
  summary: StatsSummary;
  models: ModelDetail[];
  trends: TrendPoint[];
  generatedAt: string;
}
