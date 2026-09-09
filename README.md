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

- Claude / Claude Code 客户端使用伪装 Claude 模型 ID 发起请求，代理按映射表转发至真实上游模型（Kimi、GLM、Qwen、DeepSeek 等）；完整规则见仪表盘「模型映射表」。
- 流式请求自动注入 `stream_options.include_usage=true`。
- 流式响应通过 `ReadableStream.tee()` 透传给客户端，同时异步解析 SSE usage，不阻塞首字节响应。
- 请求记录优先写入 Redis 队列，每 5 秒批量写入 MySQL；Redis 不可用时降级直写 MySQL。
- `/api/stats` 使用 10 秒 Redis 缓存，查询失败或缓存不可用时仍可从 MySQL 计算。

## Docker 部署（amd64 服务器）

单镜像 `lzyszds/ai_adapter:v2`（Nginx + Bun API），对外端口 **8088**。

### 服务器一键部署

**只上传 `docker-compose.yml` 到服务器**，然后：

```bash
docker compose pull
docker compose up -d
```

无需 `.env`、无需源码。改密码/上游地址：直接编辑 yml 里 `environment` 的值（MySQL 密码与 `DATABASE_URL` 保持一致）。

### 本机构建推送

```bash
docker login
export DOCKER_DEFAULT_PLATFORM=linux/amd64
pnpm docker:publish
```

使用 `docker-compose.dev.yml` 本地构建；服务器用根目录 `docker-compose.yml`。

### 访问

- 仪表盘：http://<服务器>:8088/
- 统计接口：http://<服务器>:8088/api/stats
- 健康检查：http://<服务器>:8088/health
- 代理地址：http://<服务器>:8088 （客户端把 base URL 指向这里即可，路径透传至上游）

### 5. 常用运维命令

```bash
docker compose ps              # 查看服务状态（应为 healthy）
docker compose logs -f app     # 跟踪应用日志
docker compose down            # 停止（保留数据卷）
docker compose down -v         # 停止并清除数据卷
```

> 首次启动由 `apps/api/docker-entrypoint.sh` 执行 `prisma db push` 幂等同步 schema 到 MySQL。构建在 linux/amd64 容器内重新生成 Prisma Client，避免平台 engine 不匹配。

## 生产注意事项

- 将 `PROXY_API_KEY` 设置为随机高强度密钥，并通过反向代理启用 HTTPS。
- 不要把 `.env`、数据库密码或 API Key 提交到 Git。
- 生产环境建议直接使用本仓库的 `docker compose` 部署（容器启动时以 `prisma db push` 同步 schema）。若后续引入 migration 文件，可将 `apps/api/docker-entrypoint.sh` 中的 `db:push` 改为 `prisma migrate deploy`。
- 为 MySQL、Redis 和 API 配置持久化卷、备份、日志采集和进程监控。
- 根据上游 SLA 调整 `STREAM_IDLE_TIMEOUT_MS`、数据库连接池和 Redis 队列告警。

## 校验

```bash
pnpm typecheck
pnpm --filter @llm-shield/web build
```
