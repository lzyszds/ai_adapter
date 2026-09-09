/** 落库前的请求记录结构，同时用于 Redis 队列序列化。 */
export interface RequestRecord {
  originalModel: string;
  mappedModel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  statusCode: number;
  duration: number;
  timestamp: Date | string;
  /** 用户问题摘要（截断，可能为 null） */
  question?: string | null;
  /** 是否为流式请求 */
  isStream?: boolean;
}
