#!/usr/bin/env bash
# 对比「直连上游」与「经 LLM-Shield 代理」的延迟
# 用法：
#   export API_KEY=你的goaichat密钥
#   ./scripts/benchmark-latency.sh
# 可选：
#   UPSTREAM_URL=https://llm.goaichat.top
#   PROXY_URL=https://claude.lzyszds.cn
#   MODEL=claude-v01          # 代理侧模型 ID
#   UPSTREAM_MODEL=kimi-k3    # 直连上游模型 ID
#   RUNS=3

set -euo pipefail

API_KEY="${API_KEY:?请设置 API_KEY（goaichat 上游密钥）}"
UPSTREAM_URL="${UPSTREAM_URL:-https://llm.goaichat.top}"
PROXY_URL="${PROXY_URL:-https://claude.lzyszds.cn}"
MODEL="${MODEL:-claude-v01}"
UPSTREAM_MODEL="${UPSTREAM_MODEL:-kimi-k3}"
RUNS="${RUNS:-3}"

bench_once() {
  local name="$1" url="$2" model="$3" stream="$4"
  local payload out timing
  payload=$(printf '{"model":"%s","max_tokens":64,"stream":%s,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}' "$model" "$stream")
  out=$(mktemp)
  timing=$(curl -sS -o "$out" -w "%{time_starttransfer} %{time_total} %{http_code}" \
    -X POST "$url/v1/messages" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d "$payload" || echo "0 0 000")
  read -r ttfb total code <<< "$timing"
  printf "%-22s stream=%-5s ttfb=%8.3fs total=%8.3fs http=%s\n" "$name" "$stream" "$ttfb" "$total" "$code"
  rm -f "$out"
}

echo "=== LLM-Shield 延迟对比 ==="
echo "上游: $UPSTREAM_URL"
echo "代理: $PROXY_URL"
echo "模型: 代理=$MODEL  直连=$UPSTREAM_MODEL"
echo "次数: $RUNS"
echo

for i in $(seq 1 "$RUNS"); do
  echo "--- 第 $i 轮 ---"
  bench_once "直连上游" "$UPSTREAM_URL" "$UPSTREAM_MODEL" "false"
  bench_once "经代理" "$PROXY_URL" "$MODEL" "false"
  bench_once "直连上游(SSE)" "$UPSTREAM_URL" "$UPSTREAM_MODEL" "true"
  bench_once "经代理(SSE)" "$PROXY_URL" "$MODEL" "true"
  echo
done

cat <<'EOF'
解读：
  ttfb  = 首字节时间（模型开始响应），Claude Code 体感主要看这个
  total = 整包完成时间（非流式）或连接建立到首包（流式仅作参考）

  若「经代理」ttfb 只比「直连」多 50~200ms → 代理开销正常（Nginx + 映射）
  若多出 1s+ → 查 ECS 带宽/宝塔反代/代理是否未更新
  若两边 ttfb 都慢且接近 → 瓶颈在上游模型或网络，不是代理
EOF
