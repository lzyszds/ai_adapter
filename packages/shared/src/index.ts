/** 共享类型：API 与 Web 之间约定的数据结构，避免两端手写不一致。 */

/** 自定义模型 ID 格式：claude-v01、claude-v02 …（避免与 Anthropic 官方名冲突） */
export const MODEL_ID_PATTERN = /^claude-v\d{2}$/i;

function formatModelId(slot: number): string {
  return `claude-v${String(slot).padStart(2, "0")}`;
}

/** 默认兜底：claude-v01 → kimi-k3 */
export const DEFAULT_MAPPING = {
  claudeModel: formatModelId(1),
  label: "Kimi K3",
  upstreamModel: "kimi-k3",
  clientAlias: "claude-kimi-k3",
} as const;

/** @deprecated 使用 DEFAULT_MAPPING.upstreamModel */
export const DEFAULT_UPSTREAM_MODEL = DEFAULT_MAPPING.upstreamModel;

/** @deprecated 使用 DEFAULT_MAPPING.upstreamModel */
export const TARGET_MODEL = DEFAULT_MAPPING.upstreamModel;

export interface ModelMapping {
  /** 客户端填写的模型 ID，如 claude-v01 */
  claudeModel: string;
  /** 可读名称 */
  label: string;
  /** 发给上游的基础模型 ID，如 kimi-k3 */
  upstreamModel: string;
  /** 客户端可选别名（仅识别用，不转发上游），如 claude-kimi-k3 */
  clientAlias: string;
}

const SLOT_MODELS: Omit<ModelMapping, "claudeModel">[] = [
  { label: "Kimi K3", upstreamModel: "kimi-k3", clientAlias: "claude-kimi-k3" },
  { label: "GLM 5.3", upstreamModel: "glm-5.3", clientAlias: "claude-glm-5.3" },
  { label: "GLM 5.3 Flash", upstreamModel: "glm-5.3-flash", clientAlias: "claude-glm-5.3-flash" },
  { label: "GLM 5.2", upstreamModel: "glm-5.2", clientAlias: "claude-glm-5.2" },
  { label: "Qwen 3.8 Max (0902)", upstreamModel: "qwen3.8-max-0902", clientAlias: "claude-qwen3.8-max-0902" },
  { label: "Qwen 3.8 Max", upstreamModel: "qwen3.8-max", clientAlias: "claude-qwen3.8-max" },
  { label: "Kimi K2.7 Code", upstreamModel: "kimi-k2.7-code", clientAlias: "claude-kimi-k2.7-code" },
  { label: "Qwen 3.7 Max", upstreamModel: "qwen3.7-max", clientAlias: "claude-qwen3.7-max" },
  { label: "Qwen 3.6 Plus", upstreamModel: "qwen3.6-plus", clientAlias: "claude-qwen3.6-plus" },
  { label: "MiniMax M3", upstreamModel: "minimax-m3", clientAlias: "claude-minimax-m3" },
  { label: "Qwen 3.7 Plus", upstreamModel: "qwen3.7-plus", clientAlias: "claude-qwen3.7-plus" },
  { label: "Kimi K2.6", upstreamModel: "kimi-k2.6", clientAlias: "claude-kimi-k2.6" },
  { label: "DeepSeek V4 Pro", upstreamModel: "deepseek-v4-pro", clientAlias: "claude-deepseek-v4-pro" },
  { label: "DeepSeek V4 Pro (0813)", upstreamModel: "deepseek-v4-pro-0813", clientAlias: "claude-deepseek-v4-pro-0813" },
  { label: "DeepSeek V4 Flash", upstreamModel: "deepseek-v4-flash", clientAlias: "claude-deepseek-v4-flash" },
  { label: "DeepSeek V4 Flash (0731)", upstreamModel: "deepseek-v4-flash-0731", clientAlias: "claude-deepseek-v4-flash-0731" },
];

/** claude-v01、claude-v02 … 编号 → 模型映射表 */
export const MODEL_MAPPINGS: ModelMapping[] = SLOT_MODELS.map((entry, index) => ({
  ...entry,
  claudeModel: formatModelId(index + 1),
}));

/** 首页展示的完整映射表。 */
export function getModelMappings(): ModelMapping[] {
  return MODEL_MAPPINGS.map((m) => ({ ...m }));
}

const BY_CLAUDE = new Map(MODEL_MAPPINGS.map((m) => [m.claudeModel.toLowerCase(), m]));
const BY_CLIENT_ALIAS = new Map(MODEL_MAPPINGS.map((m) => [m.clientAlias.toLowerCase(), m]));
const BY_UPSTREAM = new Map(MODEL_MAPPINGS.map((m) => [m.upstreamModel.toLowerCase(), m]));

const ALIAS_ORDER = [...MODEL_MAPPINGS].sort(
  (a, b) => b.clientAlias.length - a.clientAlias.length,
);

function isOurModelId(model: string): boolean {
  return MODEL_ID_PATTERN.test(model.trim());
}

function findMapping(model: string): ModelMapping | undefined {
  const lower = model.toLowerCase().trim();

  const exact =
    BY_CLAUDE.get(lower) ??
    BY_CLIENT_ALIAS.get(lower) ??
    BY_UPSTREAM.get(lower);
  if (exact) return exact;

  for (const m of ALIAS_ORDER) {
    if (lower.includes(m.clientAlias.toLowerCase())) return m;
  }

  return undefined;
}

/** 解析实际上游模型 ID（统计/仪表盘）。 */
export function rewriteModelName(model: string): string {
  return toUpstreamModelId(model);
}

/** 发给上游的 model 字段（基础模型 ID，如 kimi-k3）。 */
export function toUpstreamModelId(model: string): string {
  const mapped = findMapping(model);
  if (mapped) return mapped.upstreamModel;
  if (isOurModelId(model) || model.toLowerCase().includes("claude")) {
    return DEFAULT_MAPPING.upstreamModel;
  }
  return DEFAULT_MAPPING.upstreamModel;
}

/** @deprecated 使用 toUpstreamModelId */
export const toGatewayModelRoute = toUpstreamModelId;

export type StatsWindow = "1h" | "6h" | "24h";

export interface WindowConfig {
  seconds: number;
  bucketMs: number;
}

export function resolveStatsWindow(window: string | undefined): { key: StatsWindow; config: WindowConfig } {
  if (window === "6h") return { key: "6h", config: { seconds: 6 * 60 * 60, bucketMs: 30 * 60 * 1000 } };
  if (window === "24h") return { key: "24h", config: { seconds: 24 * 60 * 60, bucketMs: 60 * 60 * 1000 } };
  return { key: "1h", config: { seconds: 60 * 60, bucketMs: 5 * 60 * 1000 } };
}

export interface StatusBreakdown {
  statusCode: number;
  count: number;
}

export interface StatsSummary {
  totalRequests: number;
  successCount: number;
  failedCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  requestsPerMinute: number;
  requestsPerSecond: number;
  tokensPerSecond: number;
  successRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  maxDurationMs: number;
  streamingCount: number;
  statusBreakdown: StatusBreakdown[];
  windowSeconds: number;
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
  avgDurationMs: number;
  streamingCount: number;
}

export interface TrendPoint {
  timestamp: string; // ISO 8601，聚合桶起点
  requestCount: number;
  totalTokens: number;
  successCount: number;
  failedCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export interface RecentRequest {
  id: number;
  timestamp: string;
  originalModel: string;
  mappedModel: string;
  question: string | null;
  statusCode: number;
  duration: number;
  totalTokens: number;
  isStream: boolean;
}

export interface StatsResponse {
  summary: StatsSummary;
  models: ModelDetail[];
  trends: TrendPoint[];
  recentRequests: RecentRequest[];
  generatedAt: string;
  windowSeconds: number;
}
