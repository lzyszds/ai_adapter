#!/usr/bin/env bash
# 测试所有 claude-vXX 模型速度，按首字节时间 (ttfb) 排序
#
# 用法：
#   export API_KEY=你的goaichat密钥
#   ./scripts/benchmark-models.sh
#
# 可选环境变量：
#   PROXY_URL=https://claude.lzyszds.cn   # 默认经代理（与 Claude Code 一致）
#   TARGET=proxy|direct|both              # 默认 proxy
#   RUNS=1                                # 每个模型测几次（默认 1，16 模型已较慢）
#   STREAM=true                           # 默认流式（Claude Code 实际用法）
#   MAX_TOKENS=32
#   SLEEP=0.5                             # 每个请求间隔，避免限流

set -euo pipefail

API_KEY="${API_KEY:?请设置 API_KEY}"
PROXY_URL="${PROXY_URL:-https://claude.lzyszds.cn}"
UPSTREAM_URL="${UPSTREAM_URL:-https://llm.goaichat.top}"
TARGET="${TARGET:-proxy}"
RUNS="${RUNS:-1}"
STREAM="${STREAM:-true}"
MAX_TOKENS="${MAX_TOKENS:-32}"
SLEEP="${SLEEP:-0.5}"

# claude-vXX | 显示名 | 上游 model id
read -r -d '' MODEL_TABLE << 'EOF' || true
claude-v01|Kimi K3|kimi-k3
claude-v02|GLM 5.3|glm-5.3
claude-v03|GLM 5.3 Flash|glm-5.3-flash
claude-v04|GLM 5.2|glm-5.2
claude-v05|Qwen 3.8 Max (0902)|qwen3.8-max-0902
claude-v06|Qwen 3.8 Max|qwen3.8-max
claude-v07|Kimi K2.7 Code|kimi-k2.7-code
claude-v08|Qwen 3.7 Max|qwen3.7-max
claude-v09|Qwen 3.6 Plus|qwen3.6-plus
claude-v10|MiniMax M3|minimax-m3
claude-v11|Qwen 3.7 Plus|qwen3.7-plus
claude-v12|Kimi K2.6|kimi-k2.6
claude-v13|DeepSeek V4 Pro|deepseek-v4-pro
claude-v14|DeepSeek V4 Pro (0813)|deepseek-v4-pro-0813
claude-v15|DeepSeek V4 Flash|deepseek-v4-flash
claude-v16|DeepSeek V4 Flash (0731)|deepseek-v4-flash-0731
EOF

RESULTS=$(mktemp)
trap 'rm -f "$RESULTS"' EXIT

bench_one() {
  local mode="$1" url="$2" model_id="$3"
  local payload out ttfb total code
  payload=$(printf '{"model":"%s","max_tokens":%s,"stream":%s,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}' \
    "$model_id" "$MAX_TOKENS" "$STREAM")
  out=$(mktemp)
  if ! timing=$(curl -sS -o "$out" -w "%{time_starttransfer} %{time_total} %{http_code}" \
    --max-time 120 \
    -X POST "$url/v1/messages" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d "$payload" 2>/dev/null); then
    ttfb="999"; total="999"; code="ERR"
  else
    read -r ttfb total code <<< "$timing"
  fi
  rm -f "$out"
  if [[ "$code" != "200" ]]; then
    ttfb="999"
    total="999"
  fi
  printf "%s\n" "$ttfb $total $code"
}

run_suite() {
  local mode="$1" url="$2" model_field="$3" # model_field: 1=proxy id, 3=upstream id
  echo ">>> 测试模式: $mode ($url)"
  echo

  while IFS='|' read -r proxy_id label upstream_id; do
    [[ -z "$proxy_id" ]] && continue
    local model_id
    if [[ "$model_field" == "proxy" ]]; then
      model_id="$proxy_id"
    else
      model_id="$upstream_id"
    fi

    local sum_ttfb=0 sum_total=0 ok=0
    for ((r = 1; r <= RUNS; r++)); do
      read -r ttfb total code <<< "$(bench_one "$mode" "$url" "$model_id")"
      if [[ "$code" == "200" ]]; then
        sum_ttfb=$(awk -v a="$sum_ttfb" -v b="$ttfb" 'BEGIN{printf "%.6f", a+b}')
        sum_total=$(awk -v a="$sum_total" -v b="$total" 'BEGIN{printf "%.6f", a+b}')
        ok=$((ok + 1))
      fi
      printf "  %-12s %-22s run=%d ttfb=%6.3fs total=%6.3fs http=%s\n" \
        "$proxy_id" "$label" "$r" "$ttfb" "$total" "$code"
      sleep "$SLEEP"
    done

    if [[ "$ok" -gt 0 ]]; then
      avg_ttfb=$(awk -v s="$sum_ttfb" -v n="$ok" 'BEGIN{printf "%.6f", s/n}')
      avg_total=$(awk -v s="$sum_total" -v n="$ok" 'BEGIN{printf "%.6f", s/n}')
      printf "%s|%s|%s|%.3f|%.3f|%d\n" "$mode" "$proxy_id" "$label" "$avg_ttfb" "$avg_total" "$ok" >> "$RESULTS"
    else
      printf "%s|%s|%s|999.000|999.000|0\n" "$mode" "$proxy_id" "$label" >> "$RESULTS"
    fi
    echo
  done <<< "$MODEL_TABLE"
}

print_ranking() {
  local mode="$1"
  echo "=========================================="
  echo "  排名 ($mode) — 按平均 ttfb 升序"
  echo "=========================================="
  printf "%-4s %-12s %-26s %10s %10s %s\n" "排名" "模型ID" "名称" "avg_ttfb" "avg_total" "成功"
  echo "------------------------------------------"

  local rank=0
  while IFS='|' read -r m id label ttfb total ok; do
    [[ "$m" != "$mode" ]] && continue
    rank=$((rank + 1))
    if awk -v t="$ttfb" 'BEGIN{exit !(t>=999)}'; then
      printf "%-4s %-12s %-26s %10s %10s %s\n" "$rank" "$id" "$label" "FAIL" "FAIL" "$ok/$RUNS"
    else
      printf "%-4s %-12s %-26s %9.3fs %9.3fs %s\n" "$rank" "$id" "$label" "$ttfb" "$total" "$ok/$RUNS"
    fi
  done < <(sort -t'|' -k4 -n "$RESULTS")

  echo
  local best
  best=$(awk -F'|' -v mode="$mode" '$1==mode && $4<999 {print; exit}' <(sort -t'|' -k4 -n "$RESULTS") || true)
  if [[ -n "$best" ]]; then
    IFS='|' read -r _ bid blabel bttfb _ _ <<< "$best"
    echo "🏆 最快: $bid ($blabel) — 平均 ttfb ${bttfb}s"
    echo "   Claude Code 可设: ANTHROPIC_MODEL=$bid"
  else
    echo "⚠️  无成功请求，请检查 API_KEY 或账号模型权限"
  fi
  echo
}

echo "=== LLM-Shield 全模型速度测试 ==="
echo "stream=$STREAM  runs=$RUNS  max_tokens=$MAX_TOKENS"
echo

case "$TARGET" in
  proxy)
    run_suite "proxy" "$PROXY_URL" "proxy"
    print_ranking "proxy"
    ;;
  direct)
    run_suite "direct" "$UPSTREAM_URL" "upstream"
    print_ranking "direct"
    ;;
  both)
    run_suite "proxy" "$PROXY_URL" "proxy"
    run_suite "direct" "$UPSTREAM_URL" "upstream"
    print_ranking "proxy"
    print_ranking "direct"
    ;;
  *)
    echo "TARGET 只能是 proxy / direct / both" >&2
    exit 1
    ;;
esac

cat <<'EOF'
说明：
  ttfb      = 首字节时间（模型开始输出），排名依据，越小越快
  avg_total = 整段请求耗时（流式时通常略大于 ttfb）
  测的是短回复 "OK"，反映冷启动+首 token 速度，长对话会再慢一些
EOF
