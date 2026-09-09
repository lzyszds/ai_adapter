import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  getModelMappings,
  type StatsResponse,
  type StatsWindow,
  type TrendPoint,
} from "@llm-shield/shared";
import {
  Activity,
  ArrowUpRight,
  Clock3,
  Database,
  Gauge,
  LogOut,
  Radio,
  RefreshCw,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Zap,
} from "lucide-react";

const COLORS = ["#FF466B", "#F43F5E", "#FF758C", "#E11D48", "#BE123C"];
const ROSE = "#FF466B";
const UPSTREAM_API_KEY_STORAGE = "llm-shield-upstream-api-key";
const EMPTY: StatsResponse = {
  summary: {
    totalRequests: 0, successCount: 0, failedCount: 0, promptTokens: 0, completionTokens: 0,
    totalTokens: 0, avgDurationMs: 0, requestsPerMinute: 0, requestsPerSecond: 0, tokensPerSecond: 0,
    successRate: 0, p50LatencyMs: 0, p95LatencyMs: 0, maxDurationMs: 0, streamingCount: 0,
    statusBreakdown: [], windowSeconds: 3600,
  },
  models: [], trends: [], recentRequests: [], generatedAt: "", windowSeconds: 3600,
};

function formatNumber(value: number) { return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatPercent(value: number) { return `${Math.round(value * 100)}%`; }
function isSuccess(code: number) { return code >= 200 && code < 300; }
function statusTone(code: number): { text: string; bg: string } {
  if (isSuccess(code)) return { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" };
  if (code >= 400 && code < 500) return { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" };
  if (code >= 500) return { text: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10" };
  return { text: "text-slate-500", bg: "bg-slate-500/10" };
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[#efd5dc]/70 bg-card/80 p-5 shadow-[0_8px_30px_-18px_rgba(122,66,88,0.45)] backdrop-blur ${className}`}>{children}</section>;
}

function Kpi({ icon: Icon, label, value, detail, color }: { icon: typeof Activity; label: string; value: string; detail: ReactNode; color: string }) {
  return <Card>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight sm:text-[28px]">{value}</p>
        <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
      </div>
      <span className="shrink-0 rounded-xl p-2.5" style={{ backgroundColor: `${color}18`, color }}><Icon size={20} /></span>
    </div>
  </Card>;
}

/* ---------- 交互式趋势图 ---------- */
type MetricKey = "requests" | "tokens" | "latency" | "success";
const METRICS: { key: MetricKey; label: string }[] = [
  { key: "requests", label: "请求数" },
  { key: "tokens", label: "Token" },
  { key: "latency", label: "延迟" },
  { key: "success", label: "成功率" },
];

function metricValue(p: TrendPoint, key: MetricKey): number {
  switch (key) {
    case "requests": return p.requestCount;
    case "tokens": return p.totalTokens;
    case "latency": return p.avgDurationMs;
    case "success": return p.requestCount ? (p.successCount / p.requestCount) * 100 : 0;
  }
}

function formatAxisTime(ts: string, windowSeconds: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return windowSeconds > 6 * 3600 ? `${hh}:00` : `${hh}:${mm}`;
}

function TrendChart({ stats, windowSeconds }: { stats: StatsResponse; windowSeconds: number }) {
  const [metric, setMetric] = useState<MetricKey>("requests");
  const [hover, setHover] = useState<number | null>(null);
  const points = stats.trends;

  const width = 760, height = 220, padX = 48, padY = 20, padBottom = 26;
  const chartW = width - padX * 2, chartH = height - padY - padBottom;

  const values = points.map((p) => metricValue(p, metric));
  const rawMax = Math.max(...values, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = rawMax <= 1 ? 1 : Math.ceil(rawMax / magnitude) * magnitude;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({ y: padY + chartH - r * chartH, val: r * niceMax }));

  const coords = points.map((p, i) => ({
    x: padX + (points.length <= 1 ? 0 : i / (points.length - 1)) * chartW,
    y: padY + chartH - (metricValue(p, metric) / niceMax) * chartH,
  }));
  const line = coords.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const area = coords.length ? `${line} L${coords[coords.length - 1].x},${padY + chartH} L${coords[0].x},${padY + chartH} Z` : "";

  const tickCount = Math.max(1, Math.floor(chartW / 90));
  const timeTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round((i / tickCount) * Math.max(points.length - 1, 0)),
  );

  const active = hover != null && points[hover];

  return <Card className="min-h-[320px]">
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-semibold">请求趋势</h2>
        <p className="mt-1 text-xs text-muted-foreground">按 {windowSeconds > 6 * 3600 ? "小时" : windowSeconds > 3600 ? "半小时" : "5 分钟"}聚合</p>
      </div>
      <div className="flex flex-wrap gap-1 rounded-xl bg-muted/70 p-1" role="group" aria-label="趋势指标">
        {METRICS.map((m) => (
          <button key={m.key} onClick={() => { setMetric(m.key); setHover(null); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${metric === m.key ? "bg-[#FF466B] text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {m.label}
          </button>
        ))}
      </div>
    </div>
    {points.length === 0
      ? <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">暂无趋势数据</div>
      : <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-label={`${METRICS.find((m) => m.key === metric)?.label}趋势`}
          onMouseLeave={() => setHover(null)}>
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padX} x2={padX + chartW} y1={t.y} y2={t.y} stroke="currentColor" strokeWidth="1" className="text-border" />
              <text x={padX - 8} y={t.y + 3} textAnchor="end" fontSize="10" className="fill-muted-foreground">{Math.round(t.val) >= 10000 ? formatNumber(t.val) : Math.round(t.val)}</text>
            </g>
          ))}
          {timeTicks.map((idx) => (
            <text key={idx} x={coords[idx]?.x ?? padX} y={height - 8} textAnchor="middle" fontSize="10" className="fill-muted-foreground">
              {points[idx] ? formatAxisTime(points[idx].timestamp, windowSeconds) : ""}
            </text>
          ))}
          <path d={area} fill={ROSE} fillOpacity=".12" />
          <path d={line} fill="none" stroke={ROSE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {coords.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="9" fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
          {active && <line x1={coords[hover!].x} x2={coords[hover!].x} y1={padY} y2={padY + chartH} stroke={ROSE} strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />}
          {active && <circle cx={coords[hover!].x} cy={coords[hover!].y} r="4.5" fill={ROSE} stroke="currentColor" strokeWidth="2" className="text-card" />}
        </svg>
        {active && (
          <div className="pointer-events-none absolute right-0 top-1 z-10 min-w-[200px] rounded-xl border bg-popover/95 px-3.5 py-2.5 text-xs shadow-xl backdrop-blur">
            <p className="font-semibold">{new Date(active.timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
            <div className="mt-2 space-y-1.5">
              <p className="flex justify-between gap-6"><span className="text-muted-foreground">请求</span><span className="font-medium tabular-nums">{active.requestCount} 次</span></p>
              <p className="flex justify-between gap-6"><span className="text-muted-foreground">成功率</span><span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{active.requestCount ? formatPercent(active.successCount / active.requestCount) : "—"}</span></p>
              <p className="flex justify-between gap-6"><span className="text-muted-foreground">Token</span><span className="font-medium tabular-nums">{formatNumber(active.totalTokens)}</span></p>
              <p className="flex justify-between gap-6"><span className="text-muted-foreground">平均延迟</span><span className="font-medium tabular-nums">{active.avgDurationMs} ms</span></p>
            </div>
          </div>
        )}
      </div>}
  </Card>;
}

/* ---------- 状态码分布 ---------- */
function StatusDistribution({ stats }: { stats: StatsResponse }) {
  const buckets = useMemo(() => {
    const map: Record<string, { code: number; count: number; tone: string; bar: string }> = {};
    for (const s of stats.summary.statusBreakdown) {
      const key = isSuccess(s.statusCode) ? "2xx" : s.statusCode >= 500 ? "5xx" : "4xx";
      const tone = statusTone(s.statusCode);
      if (!map[key]) map[key] = { code: key === "2xx" ? 2 : key === "4xx" ? 4 : 5, count: 0, tone: tone.text, bar: key === "2xx" ? "bg-emerald-500" : key === "4xx" ? "bg-amber-500" : "bg-rose-600" };
      map[key].count += s.count;
    }
    const list = (["2xx", "4xx", "5xx"] as const).filter((k) => map[k]).map((k) => map[k]);
    const max = Math.max(...list.map((x) => x.count), 1);
    return { list, max };
  }, [stats]);
  const total = stats.summary.statusBreakdown.reduce((n, s) => n + s.count, 0);

  return <Card>
    <div className="mb-5 flex items-start justify-between">
      <div><h2 className="font-semibold">状态码分布</h2><p className="mt-1 text-xs text-muted-foreground">按响应类别统计</p></div>
      <ArrowUpRight size={17} className="text-muted-foreground" />
    </div>
    {total === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">暂无数据</p> : (
      <div className="space-y-4">
        {buckets.list.map((b) => (
          <div key={b.code}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium">{b.code}xx</span>
              <span className="tabular-nums text-muted-foreground">{formatNumber(b.count)} · {formatPercent(b.count / total)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${b.bar}`} style={{ width: `${(b.count / buckets.max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    )}
  </Card>;
}

/* ---------- 模型消耗 ---------- */
function ModelBreakdown({ stats }: { stats: StatsResponse }) {
  const max = Math.max(...stats.models.map((m) => m.totalTokens), 1);
  return <Card>
    <div className="mb-5"><h2 className="font-semibold">模型消耗</h2><p className="mt-1 text-xs text-muted-foreground">按映射后模型统计 Token 与延迟</p></div>
    {stats.models.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">暂无模型数据</p> : (
      <div className="space-y-5">
        {stats.models.map((model, index) => (
          <div key={model.mappedModel}>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{model.mappedModel}</span>
              <span className="tabular-nums text-muted-foreground">{formatNumber(model.totalTokens)} tokens</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${(model.totalTokens / max) * 100}%`, backgroundColor: COLORS[index % COLORS.length] }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              <span>{model.requestCount} 次请求</span>
              <span>成功率 {formatPercent(model.successRate)}</span>
              <span>平均 {model.avgDurationMs}ms</span>
              {model.streamingCount > 0 && <span className="flex items-center gap-1"><Radio size={11} />{model.streamingCount} 流式</span>}
            </div>
          </div>
        ))}
      </div>
    )}
  </Card>;
}

/* ---------- 最近请求日志 ---------- */
function RecentRequests({ stats }: { stats: StatsResponse }) {
  const list = stats.recentRequests;
  return <Card className="overflow-hidden">
    <div className="mb-4"><h2 className="font-semibold">最近请求</h2><p className="mt-1 text-xs text-muted-foreground">最新 {list.length} 条调用记录与问题摘要</p></div>
    {list.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">暂无请求记录</p> : (
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-card/95 backdrop-blur">
            <tr className="border-b text-xs text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">时间</th>
              <th className="pb-2 pr-3 font-medium">模型</th>
              <th className="pb-2 pr-3 font-medium">问题摘要</th>
              <th className="pb-2 text-right font-medium">状态</th>
              <th className="pb-2 pl-3 text-right font-medium">耗时</th>
              <th className="pb-2 pl-3 text-right font-medium">Token</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const tone = statusTone(r.statusCode);
              return <tr key={r.id} className="border-b last:border-0 align-top">
                <td className="whitespace-nowrap py-2.5 pr-3 text-xs tabular-nums text-muted-foreground">{new Date(r.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-xs">{r.mappedModel}</td>
                <td className="max-w-[300px] py-2.5 pr-3 text-xs text-muted-foreground">
                  <span className="flex items-start gap-1.5">
                    {r.isStream && <Radio size={12} className="mt-0.5 shrink-0 text-rose-400" />}
                    <span className="line-clamp-2">{r.question ?? "—"}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap py-2.5 text-right"><span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}>{r.statusCode}</span></td>
                <td className="whitespace-nowrap py-2.5 pl-3 text-right text-xs tabular-nums text-muted-foreground">{r.duration}ms</td>
                <td className="whitespace-nowrap py-2.5 pl-3 text-right text-xs tabular-nums">{formatNumber(r.totalTokens)}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    )}
  </Card>;
}

/* ---------- 模型映射表 ---------- */
function ModelMappingTable() {
  const mappings = getModelMappings();
  return <Card className="overflow-hidden">
    <div className="mb-5"><h2 className="font-semibold">模型映射表</h2><p className="mt-1 text-xs text-muted-foreground">填入 <span className="font-mono">claude-v01</span>、<span className="font-mono">claude-v02</span> …；未知 Claude 名默认走 <span className="font-mono">claude-v01</span>（Kimi K3）</p></div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3 font-medium">模型 ID</th><th className="pb-3 font-medium">对应模型</th></tr></thead>
        <tbody>{mappings.map((mapping) => <tr key={mapping.claudeModel} className="border-b last:border-0"><td className="py-2.5 font-mono text-xs">{mapping.claudeModel}</td><td className="py-2.5 text-sm">{mapping.label}</td></tr>)}</tbody>
      </table>
    </div>
  </Card>;
}

/* ---------- 登录页 ---------- */
function AdminLogin({ onLogin }: { onLogin: (apiKey: string) => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const apiKey = input.trim();
    if (!apiKey) { setError("请输入上游 API Key"); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/stats", {
        headers: { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey },
      });
      if (response.status === 401) { setError("上游 API Key 无效，请检查密钥后重试"); return; }
      if (!response.ok) { setError(`服务暂不可用（HTTP ${response.status}），请确认 API 服务已启动`); return; }
      sessionStorage.setItem(UPSTREAM_API_KEY_STORAGE, apiKey);
      onLogin(apiKey);
    } catch {
      setError("无法连接 API 服务，请确认测试环境地址和后端服务已启动");
    } finally {
      setBusy(false);
    }
  };
  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#fdf5f3] px-5 dark:bg-background">
    <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#FF466B]/10 blur-3xl" />
    <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-[#FF758C]/10 blur-3xl" />
    <form onSubmit={(e) => void submit(e)} className="w-full max-w-md">
      <Card>
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-[#FF466B] to-[#E11D48] p-2 text-white shadow-[0_8px_20px_-6px_rgba(255,70,107,0.6)]"><ShieldCheck size={22} /></div>
          <div><h1 className="text-xl font-semibold">LLM-Shield</h1><p className="text-sm text-muted-foreground">请输入上游 API Key 查看仪表盘（与 Claude 填入相同）</p></div>
        </div>
        <input type="password" value={input} onChange={(e) => setInput(e.target.value)} autoFocus
          placeholder="上游 API Key" className="mb-3 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-primary focus:ring-2" />
        {error && <p className="mb-3 flex items-center gap-1.5 text-sm text-amber-600"><TriangleAlert size={14} />{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-gradient-to-br from-[#FF466B] to-[#E11D48] px-3 py-2 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgba(255,70,107,0.5)] transition hover:brightness-105 disabled:opacity-60">
          {busy ? "验证中…" : "进入仪表盘"}
        </button>
      </Card>
    </form>
  </main>;
}

/* ---------- 主应用 ---------- */
export default function App() {
  const [upstreamApiKey, setUpstreamApiKey] = useState(() => sessionStorage.getItem(UPSTREAM_API_KEY_STORAGE) ?? "");
  const [statsWindow, setStatsWindow] = useState<StatsWindow>("1h");
  const [stats, setStats] = useState<StatsResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const fetchStats = useCallback(async () => {
    if (!upstreamApiKey) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/stats?window=${statsWindow}`, {
        headers: { Authorization: `Bearer ${upstreamApiKey}`, "x-api-key": upstreamApiKey },
      });
      if (response.status === 401) {
        sessionStorage.removeItem(UPSTREAM_API_KEY_STORAGE);
        setUpstreamApiKey("");
        setError("API Key 已失效，请重新登录");
        return;
      }
      if (!response.ok) throw new Error("stats request failed");
      const data = await response.json() as StatsResponse;
      setStats(data);
      setLastUpdated(new Date().toLocaleTimeString("zh-CN"));
      setError("");
    } catch {
      setError("无法连接 API 服务，请确认后端已启动");
    } finally {
      setLoading(false);
    }
  }, [upstreamApiKey, statsWindow]);

  useEffect(() => {
    if (!upstreamApiKey) return;
    void fetchStats();
    const timer = globalThis.setInterval(() => void fetchStats(), 5000);
    return () => globalThis.clearInterval(timer);
  }, [fetchStats, upstreamApiKey]);

  if (!upstreamApiKey) return <AdminLogin onLogin={setUpstreamApiKey} />;

  const { summary } = stats;
  return <main className="relative min-h-screen overflow-hidden bg-[#fdf5f3] dark:bg-background">
    <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[#FF466B]/10 blur-3xl dark:bg-[#FF466B]/[0.06]" />
    <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -left-40 h-[30rem] w-[30rem] rounded-full bg-[#FF758C]/10 blur-3xl dark:bg-[#FF758C]/[0.05]" />
    <div className="relative z-10 mx-auto max-w-7xl px-5 py-8 sm:px-8">
      <header className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-[#FF466B] to-[#E11D48] p-2 text-white shadow-[0_8px_20px_-6px_rgba(255,70,107,0.6)]"><ShieldCheck size={24} /></div>
          <div><h1 className="text-2xl font-semibold tracking-tight">LLM-Shield</h1><p className="text-sm text-muted-foreground">LLM 代理与分析平台</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-muted/70 p-1" role="group" aria-label="时间范围">
            {(["1h", "6h", "24h"] as StatsWindow[]).map((w) => (
              <button key={w} onClick={() => setStatsWindow(w)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${statsWindow === w ? "bg-[#FF466B] text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{w}</button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{lastUpdated ? `更新于 ${lastUpdated}` : "等待数据"}</span>
          <button onClick={() => void fetchStats()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm font-medium shadow-sm transition hover:bg-accent disabled:opacity-50">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />刷新
          </button>
          <button onClick={() => { sessionStorage.removeItem(UPSTREAM_API_KEY_STORAGE); setUpstreamApiKey(""); }} className="inline-flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm transition hover:bg-accent">
            <LogOut size={15} />退出
          </button>
        </div>
      </header>

      {error && <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"><TriangleAlert size={17} />{error}</div>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Activity} label="总请求次数" value={formatNumber(summary.totalRequests)} detail={<span>{summary.successCount} 成功 · {summary.failedCount} 失败</span>} color={ROSE} />
        <Kpi icon={Gauge} label="请求速率" value={`${summary.requestsPerSecond.toFixed(2)} /s`} detail={<span>{summary.requestsPerMinute.toFixed(1)} 次/分</span>} color="#F43F5E" />
        <Kpi icon={Timer} label="平均延迟" value={`${summary.avgDurationMs} ms`} detail={<span>p50 {summary.p50LatencyMs} · p95 {summary.p95LatencyMs}</span>} color="#E11D48" />
        <Kpi icon={Database} label="Token 消耗" value={formatNumber(summary.totalTokens)} detail={<span>输入 {formatNumber(summary.promptTokens)} · 输出 {formatNumber(summary.completionTokens)}</span>} color="#BE123C" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
        <TrendChart stats={stats} windowSeconds={summary.windowSeconds} />
        <div className="grid gap-6">
          <StatusDistribution stats={stats} />
          <Card>
            <div className="mb-4 flex items-start justify-between">
              <div><h2 className="font-semibold">服务状态</h2><p className="mt-1 text-xs text-muted-foreground">代理运行概览</p></div>
              <Zap size={17} className="text-muted-foreground" />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">请求成功率</span>
                <span className={`font-semibold ${summary.totalRequests ? (summary.successRate >= 0.9 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600") : ""}`}>{summary.totalRequests ? formatPercent(summary.successRate) : "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">流式请求</span>
                <span className="text-sm font-medium tabular-nums">{summary.streamingCount} 次</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">峰值延迟</span>
                <span className="text-sm font-medium tabular-nums">{summary.maxDurationMs}ms</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">统计窗口</span>
                <span className="flex items-center gap-2 text-sm font-medium"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />最近 {statsWindow}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className="mb-6"><RecentRequests stats={stats} /></div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ModelBreakdown stats={stats} />
        <ModelMappingTable />
      </div>

      <footer className="mt-8 flex items-center justify-between text-xs text-muted-foreground">
        <span>LLM-Shield · production-ready observability</span>
        <span>{stats.generatedAt ? "数据已同步" : "等待同步"}</span>
      </footer>
    </div>
  </main>;
}