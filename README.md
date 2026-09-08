# LLM-Shield

生产级 LLM 代理与分析平台：使用 Bun + Elysia 提供代理服务，Redis 缓冲请求统计，MySQL + Prisma 持久化，Vite + React 提供仪表盘。

## 技术栈

- API：Bun、ElysiaJS、Prisma、MySQL 8、Redis 7
- Web：Vite、React、TypeScript、Tailwind CSS、Lucide React
- Monorepo：pnpm Workspaces

## 快速开始

### 1. 准备环境变量

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

`UPSTREAM_URL` 配置上游服务根地址。参考项目使用 `https://llm.goaichat.top`；如果上游要求固定密钥，可设置 `UPSTREAM_API_KEY`，否则客户端的 `Authorization` 会被安全地透传。

### 2. 启动依赖服务

```bash
docker compose up -d mysql redis
```

### 3. 初始化 Prisma

```bash
pnpm install
pnpm db:generate
pnpm db:push
```

### 4. 启动 API 和 Web

```bash
pnpm dev
```

- 仪表盘：http://localhost:5173
- API 健康检查：http://localhost:3000/health
- 统计接口：http://localhost:3000/api/stats
- 代理地址：http://localhost:3000

## 代理行为

- JSON 请求中的 `claude`、`sonnet`、`opus`、`haiku` 模型名按子串匹配并映射为 `glm-5.3`。
- 流式请求自动注入 `stream_options.include_usage=true`。
- 流式响应通过 `ReadableStream.tee()` 透传给客户端，同时异步解析 SSE usage，不阻塞首字节响应。
- 请求记录优先写入 Redis 队列，每 5 秒批量写入 MySQL；Redis 不可用时降级直写 MySQL。
- `/api/stats` 使用 10 秒 Redis 缓存，查询失败或缓存不可用时仍可从 MySQL 计算。

## 生产注意事项

- 将 `PROXY_API_KEY` 设置为随机高强度密钥，并通过反向代理启用 HTTPS。
- 不要把 `.env`、数据库密码或 API Key 提交到 Git。
- 生产环境使用 `pnpm db:migrate` 管理迁移，不建议使用 `db:push`。
- 为 MySQL、Redis 和 API 配置持久化卷、备份、日志采集和进程监控。
- 根据上游 SLA 调整 `STREAM_IDLE_TIMEOUT_MS`、数据库连接池和 Redis 队列告警。

## 校验

```bash
pnpm typecheck
pnpm --filter @llm-shield/web build
```
