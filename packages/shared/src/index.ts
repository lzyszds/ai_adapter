/** 共享类型：API 与 Web 之间约定的数据结构，避免两端手写不一致。 */

/** 默认兜底：claude-1 → Kimi K3 */
export const DEFAULT_MAPPING = {
  claudeModel: "claude-1",
  label: "Kimi K3",
  upstreamModel: "kimi-k3",
  gatewayModel: "claude-kimi-k3",
} as const;

/** @deprecated 使用 DEFAULT_MAPPING.upstreamModel */
export const DEFAULT_UPSTREAM_MODEL = DEFAULT_MAPPING.upstreamModel;

/** @deprecated 使用 DEFAULT_MAPPING.upstreamModel */
export const TARGET_MODEL = DEFAULT_MAPPING.upstreamModel;

export interface ModelMapping {
  /** 客户端填写的 Claude 编号 ID，如 claude-1 */
  claudeModel: string;
  /** 可读名称 */
  label: string;
  /** 实际上游模型（统计用） */
  upstreamModel: string;
  /** 发给 gateway 的 claude-* 路由名 */
  gatewayModel: string;
}

/** claude-1、claude-2 … 编号 → 模型映射表 */
export const MODEL_MAPPINGS: ModelMapping[] = [
  { claudeModel: "claude-1", label: "Kimi K3", upstreamModel: "kimi-k3", gatewayModel: "claude-kimi-k3" },
  { claudeModel: "claude-2", label: "GLM 5.3", upstreamModel: "glm-5.3", gatewayModel: "claude-glm-5.3" },
  { claudeModel: "claude-3", label: "GLM 5.3 Flash", upstreamModel: "glm-5.3-flash", gatewayModel: "claude-glm-5.3-flash" },
  { claudeModel: "claude-4", label: "GLM 5.2", upstreamModel: "glm-5.2", gatewayModel: "claude-glm-5.2" },
  { claudeModel: "claude-5", label: "Qwen 3.8 Max (0902)", upstreamModel: "qwen3.8-max-0902", gatewayModel: "claude-qwen3.8-max-0902" },
  { claudeModel: "claude-6", label: "Qwen 3.8 Max", upstreamModel: "qwen3.8-max", gatewayModel: "claude-qwen3.8-max" },
  { claudeModel: "claude-7", label: "Kimi K2.7 Code", upstreamModel: "kimi-k2.7-code", gatewayModel: "claude-kimi-k2.7-code" },
  { claudeModel: "claude-8", label: "Qwen 3.7 Max", upstreamModel: "qwen3.7-max", gatewayModel: "claude-qwen3.7-max" },
  { claudeModel: "claude-9", label: "Qwen 3.6 Plus", upstreamModel: "qwen3.6-plus", gatewayModel: "claude-qwen3.6-plus" },
  { claudeModel: "claude-10", label: "MiniMax M3", upstreamModel: "minimax-m3", gatewayModel: "claude-minimax-m3" },
  { claudeModel: "claude-11", label: "Qwen 3.7 Plus", upstreamModel: "qwen3.7-plus", gatewayModel: "claude-qwen3.7-plus" },
  { claudeModel: "claude-12", label: "Kimi K2.6", upstreamModel: "kimi-k2.6", gatewayModel: "claude-kimi-k2.6" },
  { claudeModel: "claude-13", label: "DeepSeek V4 Pro", upstreamModel: "deepseek-v4-pro", gatewayModel: "claude-deepseek-v4-pro" },
  { claudeModel: "claude-14", label: "DeepSeek V4 Pro (0813)", upstreamModel: "deepseek-v4-pro-0813", gatewayModel: "claude-deepseek-v4-pro-0813" },
  { claudeModel: "claude-15", label: "DeepSeek V4 Flash", upstreamModel: "deepseek-v4-flash", gatewayModel: "claude-deepseek-v4-flash" },
  { claudeModel: "claude-16", label: "DeepSeek V4 Flash (0731)", upstreamModel: "deepseek-v4-flash-0731", gatewayModel: "claude-deepseek-v4-flash-0731" },
];

/** 首页展示的完整映射表。 */
export function getModelMappings(): ModelMapping[] {
  return MODEL_MAPPINGS.map((m) => ({ ...m }));
}

const BY_CLAUDE = new Map(MODEL_MAPPINGS.map((m) => [m.claudeModel.toLowerCase(), m]));
const BY_GATEWAY = new Map(MODEL_MAPPINGS.map((m) => [m.gatewayModel.toLowerCase(), m]));
const BY_UPSTREAM = new Map(MODEL_MAPPINGS.map((m) => [m.upstreamModel.toLowerCase(), m]));

/** 长 ID 优先；claude 编号按数字降序，避免 claude-1 误匹配 claude-10 */
const CLAUDE_NUM_ORDER = [...MODEL_MAPPINGS].sort((a, b) => {
  const na = Number(a.claudeModel.replace(/^claude-/i, ""));
  const nb = Number(b.claudeModel.replace(/^claude-/i, ""));
  return nb - na;
});

const GATEWAY_ORDER = [...MODEL_MAPPINGS].sort(
  (a, b) => b.gatewayModel.length - a.gatewayModel.length,
);

function findMapping(model: string): ModelMapping | undefined {
  const lower = model.toLowerCase().trim();
  const exact = BY_CLAUDE.get(lower) ?? BY_GATEWAY.get(lower) ?? BY_UPSTREAM.get(lower);
  if (exact) return exact;

  for (const m of GATEWAY_ORDER) {
    if (lower.includes(m.gatewayModel.toLowerCase())) return m;
  }

  for (const m of CLAUDE_NUM_ORDER) {
    if (lower.includes(m.claudeModel.toLowerCase())) return m;
  }

  return undefined;
}

/** 解析实际上游模型 ID（统计/仪表盘）。 */
export function rewriteModelName(model: string): string {
  const mapped = findMapping(model);
  if (mapped) return mapped.upstreamModel;
  if (model.toLowerCase().includes("claude")) return DEFAULT_MAPPING.upstreamModel;
  return DEFAULT_MAPPING.upstreamModel;
}

/** 发给上游 gateway 的 model 字段（claude-* 路由）。 */
export function toGatewayModelRoute(model: string): string {
  const mapped = findMapping(model);
  if (mapped) return mapped.gatewayModel;
  if (model.toLowerCase().includes("claude")) return DEFAULT_MAPPING.gatewayModel;
  return DEFAULT_MAPPING.gatewayModel;
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
