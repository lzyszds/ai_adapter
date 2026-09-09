import { rewriteModelName, toUpstreamModelId, TARGET_MODEL } from "@llm-shield/shared";
import { config } from "../config";
import { CLIENT_KEY_HEADERS, apiKeyRequiredResponse, getClientApiKey } from "../lib/auth";
import { enqueue } from "../services/buffer";
import { parseNonStreamUsage, parseStreamUsage, type TokenUsage } from "../services/tokenParser";
import { logger } from "../lib/logger";
import type { RequestRecord } from "../types";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]);

/** 不转发给上游；另由代理强制 Accept-Encoding: identity */
const STRIP_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP,
  "accept-encoding",
]);

const STRIP_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP,
  "content-encoding",
  "content-length",
]);

function rewriteModel(model: string): { originalModel: string; mappedModel: string } {
  const mappedModel = rewriteModelName(model);
  return { originalModel: model, mappedModel };
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "content-type": "application/json" } });
}

function copyResponseHeaders(source: Headers, strip = STRIP_RESPONSE_HEADERS): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (strip.has(lower)) return;
    headers.set(key, value);
  });
  // 禁止 CDN/宝塔等中间层对 SSE/JSON 二次压缩（否则会标 zstd 但正文未压缩 → ZstdDecompressionError）
  headers.delete("content-encoding");
  headers.set("Cache-Control", "no-transform");
  headers.set("X-Accel-Buffering", "no");
  return headers;
}

async function consumeStream(stream: ReadableStream<Uint8Array>): Promise<{ text: string; usage: TokenUsage }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      text += decoded;
      lines.push(...decoded.split(/\r?\n/));
    }
    text += decoder.decode();
    return { text, usage: parseStreamUsage(lines) };
  } finally {
    reader.releaseLock();
  }
}

function record(originalModel: string, mappedModel: string, usage: TokenUsage, statusCode: number, duration: number): RequestRecord {
  return {
    originalModel,
    mappedModel: mappedModel === "unknown" ? TARGET_MODEL : mappedModel,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    statusCode,
    duration,
    timestamp: new Date(),
  };
}

function enqueueRecord(r: RequestRecord) {
  void enqueue(r).catch((error) => logger.error("[proxy] request log failed", error));
}

/** Elysia/Bun 可能只给相对路径（如 /v1/chat/completions），不能直接 new URL(request.url) */
function getIncomingPath(request: Request): string {
  const raw = request.url;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function isStreamRequest(body: Record<string, unknown> | null, responseHeaders: Headers): boolean {
  if (body?.stream === true) return true;
  const ct = responseHeaders.get("content-type")?.toLowerCase() ?? "";
  return ct.includes("text/event-stream") || ct.includes("application/x-ndjson");
}

export async function proxyRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  let originalModel = "unknown";
  let mappedModel = "unknown";

  try {
    const rawBody = await request.text();
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(rawBody); } catch { /* non-JSON requests are forwarded unchanged */ }

    if (body && typeof body.model === "string") {
      ({ originalModel, mappedModel } = rewriteModel(body.model));
      body.model = toUpstreamModelId(body.model);
      if (body.stream === true) body.stream_options = { ...(body.stream_options as object ?? {}), include_usage: true };
    }

    const upstreamBase = config.UPSTREAM_URL.replace(/\/$/, "");
    const upstreamUrl = `${upstreamBase}${getIncomingPath(request)}`;
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (STRIP_REQUEST_HEADERS.has(lower)) return;
      if (config.UPSTREAM_API_KEY && (lower === "authorization" || CLIENT_KEY_HEADERS.includes(lower as typeof CLIENT_KEY_HEADERS[number]))) return;
      headers.set(key, value);
    });
    // 强制上游返回明文，避免 zstd 响应被中间层错误解码
    headers.set("Accept-Encoding", "identity");

    if (config.UPSTREAM_API_KEY) {
      headers.set("authorization", `Bearer ${config.UPSTREAM_API_KEY}`);
    } else {
      const clientKey = getClientApiKey(request);
      if (!clientKey) return apiKeyRequiredResponse();
      if (!headers.get("authorization")) headers.set("authorization", `Bearer ${clientKey}`);
    }

    // decompress: false — 上游偶发「明文 body + content-encoding: zstd」时，Bun 默认解压会留下错误头
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: body ? JSON.stringify(body) : (rawBody || undefined),
      signal: AbortSignal.timeout(config.STREAM_IDLE_TIMEOUT_MS),
      decompress: false,
    } as RequestInit & { decompress?: boolean });
    const statusCode = upstreamResponse.status;
    const responseHeaders = copyResponseHeaders(upstreamResponse.headers);
    const isStream = isStreamRequest(body, upstreamResponse.headers);

    if (!upstreamResponse.body) {
      return new Response(null, { status: statusCode, headers: responseHeaders });
    }

    // 流式：原样透传，审计在副本流上异步进行
    if (isStream) {
      const [clientStream, auditStream] = upstreamResponse.body.tee();
      void consumeStream(auditStream).then(({ usage }) => {
        enqueueRecord(record(originalModel, mappedModel, usage, statusCode, Date.now() - startedAt));
      }).catch((error) => logger.warn("[proxy] stream parse failed", error));
      return new Response(clientStream, { status: statusCode, headers: responseHeaders });
    }

    // 非流式：读二进制再返回，去掉 content-encoding 头
    const bytes = await upstreamResponse.arrayBuffer();
    try {
      const text = new TextDecoder().decode(bytes);
      enqueueRecord(record(originalModel, mappedModel, parseNonStreamUsage(text), statusCode, Date.now() - startedAt));
    } catch (error) {
      logger.warn("[proxy] non-stream parse failed", error);
    }
    return new Response(bytes, { status: statusCode, headers: responseHeaders });
  } catch (error) {
    logger.error("[proxy] upstream request failed", error);
    return jsonResponse({ error: "Upstream request failed" }, 502);
  }
}
