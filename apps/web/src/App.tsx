import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { StatsResponse } from "@llm-shield/shared";
import { Activity, ArrowUpRight, Clock3, Database, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

const COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];
const EMPTY: StatsResponse = {
  summary: { totalRequests: 0, successCount: 0, failedCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, avgDurationMs: 0 },
  models: [], trends: [], generatedAt: "",
};

function formatNumber(value: number) { return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatPercent(value: number) { return `${Math.round(value * 100)}%`; }

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border bg-card p-5 shadow-sm ${className}`}>{children}</section>;
}

function StatCard({ icon: Icon, label, value, detail, color }: { icon: typeof Activity; label: string; value: string; detail: string; color: string }) {
  return <Card>
    <div className="flex items-start justify-between">
      <div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-2 text-xs text-muted-foreground">{detail}</p></div>
      <span className="rounded-lg p-2" style={{ backgroundColor: `${color}18`, color }}><Icon size={20} /></span>
    </div>
  </Card>;
}

function TrendChart({ stats }: { stats: StatsResponse }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = stats.trends;
  const max = Math.max(...points.map((p) => p.requestCount), 1);
  const width = 760, height = 180, padX = 12, padY = 18;
  const coords = points.map((point, i) => ({ x: padX + (points.length <= 1 ? 0 : i / (points.length - 1)) * (width - padX * 2), y: height - padY - (point.requestCount / max) * (height - padY * 2) }));
  const line = coords.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const area = coords.length ? `${line} L${coords[coords.length - 1].x},${height - padY} L${coords[0].x},${height - padY} Z` : "";
  return <Card className="min-h-[270px]">
    <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">请求趋势</h2><p className="mt-1 text-xs text-muted-foreground">最近 1 小时 · 5 分钟聚合</p></div><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-[#2a78d6]" />请求数</span></div>
    {points.length === 0 ? <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">暂无趋势数据</div> : <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[180px] w-full overflow-visible" role="img" aria-label="最近一小时请求趋势">
        {[0, .5, 1].map((ratio) => <line key={ratio} x1={padX} x2={width - padX} y1={height - padY - ratio * (height - padY * 2)} y2={height - padY - ratio * (height - padY * 2)} stroke="currentColor" className="text-border" strokeWidth="1" />)}
        <path d={area} fill="#2a78d6" fillOpacity=".1" />
        <path d={line} fill="none" stroke="#2a78d6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="5" fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />)}
        {hover !== null && <circle cx={coords[hover].x} cy={coords[hover].y} r="4" fill="#2a78d6" stroke="currentColor" strokeWidth="2" className="text-card" />}
      </svg>
      {hover !== null && <div className="pointer-events-none absolute right-2 top-0 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"><p className="font-medium">{new Date(points[hover].timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</p><p className="mt-1 text-muted-foreground">{points[hover].requestCount} 次请求 · {formatNumber(points[hover].totalTokens)} tokens</p></div>}
    </div>}
  </Card>;
}

function ModelBreakdown({ stats }: { stats: StatsResponse }) {
  const max = Math.max(...stats.models.map((m) => m.totalTokens), 1);
  return <Card><div className="mb-5"><h2 className="font-semibold">模型消耗</h2><p className="mt-1 text-xs text-muted-foreground">按映射后模型统计 Token 使用量</p></div>{stats.models.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">暂无模型数据</p> : <div className="space-y-5">{stats.models.map((model, index) => <div key={model.mappedModel}><div className="mb-2 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{model.mappedModel}</span><span className="tabular-nums text-muted-foreground">{formatNumber(model.totalTokens)}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(model.totalTokens / max) * 100}%`, backgroundColor: COLORS[index % COLORS.length] }} /></div><div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{model.requestCount} 次请求</span><span>成功率 {formatPercent(model.successRate)}</span></div></div>)}</div>}</Card>;
}

function RuleTable({ stats }: { stats: StatsResponse }) {
  return <Card className="overflow-hidden"><div className="mb-5"><h2 className="font-semibold">转换规则明细</h2><p className="mt-1 text-xs text-muted-foreground">原始模型与目标模型的调用表现</p></div>{stats.models.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">暂无规则数据</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3 font-medium">原始模型</th><th className="pb-3 font-medium">目标模型</th><th className="pb-3 text-right font-medium">调用次数</th><th className="pb-3 text-right font-medium">成功率</th></tr></thead><tbody>{stats.models.map((model) => <tr key={model.mappedModel} className="border-b last:border-0"><td className="py-3 font-mono text-xs">{model.originalModels.join(", ") || "unknown"}</td><td className="py-3 font-mono text-xs text-primary">{model.mappedModel}</td><td className="py-3 text-right tabular-nums">{model.requestCount}</td><td className="py-3 text-right"><span className={model.successRate >= .9 ? "text-emerald-600" : "text-amber-600"}>{formatPercent(model.successRate)}</span></td></tr>)}</tbody></table></div>}</Card>;
}

export default function App() {
  const [stats, setStats] = useState<StatsResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const fetchStats = useCallback(async () => { setLoading(true); try { const response = await fetch("/api/stats"); if (!response.ok) throw new Error("stats request failed"); const data = await response.json() as StatsResponse; setStats(data); setLastUpdated(new Date().toLocaleTimeString("zh-CN")); setError(""); } catch { setError("无法连接 API 服务，请确认后端已启动"); } finally { setLoading(false); } }, []);
  useEffect(() => { void fetchStats(); const timer = window.setInterval(() => void fetchStats(), 5000); return () => window.clearInterval(timer); }, [fetchStats]);
  const { summary } = stats;
  return <main className="min-h-screen bg-slate-50/70 dark:bg-background"><div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
    <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><div className="flex items-center gap-3"><div className="rounded-xl bg-primary p-2 text-primary-foreground"><ShieldCheck size={24} /></div><div><h1 className="text-2xl font-semibold tracking-tight">LLM-Shield</h1><p className="text-sm text-muted-foreground">LLM 代理与分析平台</p></div></div></div><div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{lastUpdated ? `更新于 ${lastUpdated}` : "等待数据"}</span><button onClick={() => void fetchStats()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm transition hover:bg-accent disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />刷新</button></div></header>
    {error && <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><TriangleAlert size={17} />{error}</div>}
    <div className="mb-6 grid gap-4 md:grid-cols-3"><StatCard icon={Activity} label="总请求次数" value={formatNumber(summary.totalRequests)} detail={`${summary.successCount} 成功 · ${summary.failedCount} 失败`} color="#2a78d6" /><StatCard icon={Database} label="总消耗 Token" value={formatNumber(summary.totalTokens)} detail={`${formatNumber(summary.promptTokens)} 输入 · ${formatNumber(summary.completionTokens)} 输出`} color="#1baf7a" /><StatCard icon={Clock3} label="平均响应时间" value={`${summary.avgDurationMs} ms`} detail="基于最近 1 小时请求" color="#eb6834" /></div>
    <div className="mb-6 grid gap-6 lg:grid-cols-[1.25fr_.75fr]"><TrendChart stats={stats} /><Card><div className="mb-5 flex items-start justify-between"><div><h2 className="font-semibold">服务状态</h2><p className="mt-1 text-xs text-muted-foreground">代理运行概览</p></div><ArrowUpRight size={17} className="text-muted-foreground" /></div><div className="space-y-4"><div className="flex items-center justify-between rounded-lg bg-muted/60 p-3"><span className="text-sm text-muted-foreground">请求成功率</span><span className="font-semibold text-emerald-600">{summary.totalRequests ? formatPercent(summary.successCount / summary.totalRequests) : "—"}</span></div><div className="flex items-center justify-between rounded-lg bg-muted/60 p-3"><span className="text-sm text-muted-foreground">数据刷新</span><span className="flex items-center gap-2 text-sm font-medium"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />每 5 秒</span></div><div className="flex items-center justify-between rounded-lg bg-muted/60 p-3"><span className="text-sm text-muted-foreground">统计窗口</span><span className="text-sm font-medium">最近 1 小时</span></div></div></Card></div>
    <div className="grid gap-6 lg:grid-cols-2"><ModelBreakdown stats={stats} /><RuleTable stats={stats} /></div>
    <footer className="mt-8 flex items-center justify-between text-xs text-muted-foreground"><span>LLM-Shield · production-ready observability</span><span>{stats.generatedAt ? "数据已同步" : "等待同步"}</span></footer>
  </div></main>;
}
