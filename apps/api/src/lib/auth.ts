import { config } from "../config";

export const CLIENT_KEY_HEADERS = ["x-api-key", "x-goog-api-key"] as const;

export function getClientApiKey(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  for (const name of CLIENT_KEY_HEADERS) {
    const value = request.headers.get(name);
    if (value?.trim()) return value.trim();
  }
  return null;
}

/** 仪表盘 /api/stats：与代理相同，使用上游 API Key（Bearer 或 x-api-key） */
export function isStatsAuthorized(request: Request): boolean {
  const clientKey = getClientApiKey(request);
  if (!clientKey) return false;
  if (config.UPSTREAM_API_KEY) return clientKey === config.UPSTREAM_API_KEY;
  return true;
}

export function apiKeyRequiredResponse(): Response {
  return Response.json({
    code: "API_KEY_REQUIRED",
    message: "API key is required in Authorization header (Bearer scheme), x-api-key header, or x-goog-api-key header",
  }, { status: 401, headers: { "content-type": "application/json" } });
}
