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

## Docker 部署（amd64 服务器）

将 API 代理、Web 仪表盘、MySQL、Redis 全部打包进容器，一条命令拉起。仅对外暴露一个特殊端口 **8088**（可在 `docker-compose.yml` 的 `web.ports` 中修改），全部服务通过 `http://<服务器>:8088` 访问。

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env：UPSTREAM_URL、PROXY_API_KEY、MYSQL_ROOT_PASSWORD 等
```

`.env` 中的 `DATABASE_URL` / `REDIS_URL` 会被 compose 覆盖为内部服务名地址（`mysql` / `redis`），无需自行修改。

### 2. 构建、推送并启动

登录 Docker Hub 后，在项目根目录执行：

```bash
docker login
pnpm docker:publish
```

`docker:publish` 会依次执行 `docker compose build api web` 和 `docker compose push api web`，推送以下 amd64 应用镜像：

- `lzyszds/ai_adapter-api:v1`
- `lzyszds/ai_adapter-web:v1`

需要发布新版本时，在 `.env` 中设置 `DOCKER_TAG=v2`（或自定义 `DOCKER_REGISTRY`），再执行 `pnpm docker:publish`。

在服务器上部署：

```bash
git clone https://github.com/lzyszds/ai_adapter.git
cd ai_adapter
cp .env.example .env
# 编辑 .env，至少设置 UPSTREAM_URL、PROXY_API_KEY、MYSQL_ROOT_PASSWORD
docker compose pull api web
docker compose up -d
```

服务器只需要拉取已推送的 api/web 镜像，MySQL 与 Redis 会自动拉取官方镜像。

### 3. 访问

- 仪表盘：http://<服务器>:8088/
- 统计接口：http://<服务器>:8088/api/stats
- 健康检查：http://<服务器>:8088/health
- 代理地址：http://<服务器>:8088 （客户端把 base URL 指向这里即可，路径透传至上游）

### 4. 常用运维命令

```bash
docker compose ps              # 查看服务状态（应为 healthy）
docker compose logs -f api     # 跟踪 API 日志
docker compose logs -f web     # 跟踪 nginx 日志
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
