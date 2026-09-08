import { rewriteModelName, TARGET_MODEL } from "@llm-shield/shared";
import { config } from "../config";
import { enqueue } from "../services/buffer";
import { parseNonStreamUsage, parseStreamUsage, type TokenUsage } from "../services/tokenParser";
import { logger } from "../lib/logger";
import type { RequestRecord } from "../types";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]);

function rewriteModel(model: string): { originalModel: string; mappedModel: string } {
  const mappedModel = rewriteModelName(model);
  return { originalModel: model, mappedModel };
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "content-type": "application/json" } });
}

function copyResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
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

export async function proxyRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  let originalModel = "unknown";
  let mappedModel = "unknown";

  try {
    if (config.PROXY_API_KEY) {
      const authorization = request.headers.get("authorization");
      if (authorization !== `Bearer ${config.PROXY_API_KEY}`) return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const rawBody = await request.text();
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(rawBody); } catch { /* non-JSON requests are forwarded unchanged */ }

    if (body && typeof body.model === "string") {
      ({ originalModel, mappedModel } = rewriteModel(body.model));
      body.model = mappedModel;
      if (body.stream === true) body.stream_options = { ...(body.stream_options as object ?? {}), include_usage: true };
    }

    const incomingUrl = new URL(request.url);
    const upstreamBase = config.UPSTREAM_URL.replace(/\/$/, "");
    const upstreamUrl = `${upstreamBase}${incomingUrl.pathname}${incomingUrl.search}`;
    const headers = new Headers();
    request.headers.forEach((value, key) => { if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "authorization") headers.set(key, value); });
    if (config.UPSTREAM_API_KEY) headers.set("authorization", `Bearer ${config.UPSTREAM_API_KEY}`);

    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: body ? JSON.stringify(body) : (rawBody || undefined),
      signal: AbortSignal.timeout(config.STREAM_IDLE_TIMEOUT_MS),
    });
    const statusCode = upstreamResponse.status;
    const isStream = body?.stream === true || upstreamResponse.headers.get("content-type")?.includes("text/event-stream");

    if (!upstreamResponse.body) {
      const text = await upstreamResponse.text();
      enqueueRecord(record(originalModel, mappedModel, parseNonStreamUsage(text), statusCode, Date.now() - startedAt));
      return new Response(text, { status: statusCode, headers: copyResponseHeaders(upstreamResponse.headers) });
    }

    const [clientStream, auditStream] = upstreamResponse.body.tee();

    if (isStream) {
      void consumeStream(auditStream).then(({ usage }) => {
        enqueueRecord(record(originalModel, mappedModel, usage, statusCode, Date.now() - startedAt));
      }).catch((error) => logger.warn("[proxy] stream parse failed", error));
      return new Response(clientStream, { status: statusCode, headers: copyResponseHeaders(upstreamResponse.headers) });
    }

    const { text } = await consumeStream(auditStream);
    enqueueRecord(record(originalModel, mappedModel, parseNonStreamUsage(text), statusCode, Date.now() - startedAt));
    return new Response(text, { status: statusCode, headers: copyResponseHeaders(upstreamResponse.headers) });
  } catch (error) {
    logger.error("[proxy] upstream request failed", error);
    return jsonResponse({ error: "Upstream request failed" }, 502);
  }
}
