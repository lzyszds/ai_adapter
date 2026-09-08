/** Token 抓取解析：支持完整 JSON（非流）与 SSE 流式两种形态。 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function normalizeUsage(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, number>;
  const promptTokens = u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? 0;
  const completionTokens = u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? 0;
  const totalTokens =
    u.total_tokens ?? u.totalTokens ?? (promptTokens + completionTokens);
  return { promptTokens, completionTokens, totalTokens };
}

/** 非流响应：解析完整 JSON body 中的 usage。 */
export function parseNonStreamUsage(bodyText: string): TokenUsage {
  try {
    const data = JSON.parse(bodyText);
    return normalizeUsage(data.usage);
  } catch {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

/**
 * 流式响应：SSE 每行形如 `data: {...}`，usage 通常出现在最后的
 * `stream_options.include_usage` 输出块中；若缺失则退化为 0。
 */
export function parseStreamUsage(chunks: string[]): TokenUsage {
  for (const chunk of chunks) {
    const line = chunk.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const data = JSON.parse(payload);
      if (data.usage) return normalizeUsage(data.usage);
    } catch {
      // 忽略无法解析的行
    }
  }
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}
