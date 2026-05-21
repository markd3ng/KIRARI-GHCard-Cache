# KIRARI-GHCard-Cache

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/markd3ng/KIRARI-GHCard-Cache)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarkd3ng%2FKIRARI-GHCard-Cache)

KIRARI-GHCard-Cache 是给 KIRARI GitHub 卡片使用的缓存代理。它代理 `::github` 和 `::githubfile` 会用到的 GitHub REST API 与头像请求，用来降低 GitHub rate limit 压力，并改善直接访问 GitHub API / 头像域名缓慢或不稳定的问题。

本仓库支持两条免费优先部署路径：

| 路径 | 适合场景 | 浏览器请求 | 运行时 | 缓存能力 | 暴露面 |
|------|----------|------------|--------|----------|--------|
| Cloudflare | KIRARI 部署在 Cloudflare Pages | KIRARI 同源 `/ghc/*` | Pages Function 通过 Service Binding 调用私有 Worker | Cache API + Workers KV + stale fallback | Worker 关闭 `workers.dev` 和 preview URL |
| Vercel | KIRARI 部署在 Vercel，或独立测试 GHC | 同源 `/ghc/*` | Vercel Function | HTTP cache headers，可用时尝试 Runtime Cache | 不需要单独业务域名 |

推荐生产链路：

```text
Browser -> KIRARI /ghc/* -> 平台运行时 route -> GHC cache -> GitHub API
```

## 功能范围

| 功能 | Cloudflare Worker | Vercel Function |
|------|-------------------|-----------------|
| Repo metadata 代理 | 支持 | 支持 |
| Repo contents 代理 | 支持 | 支持 |
| 文件最新 commit 代理 | 支持 | 支持 |
| GitHub avatar 代理 | 支持 | 支持 |
| 可选 GitHub API token | `GITHUB_TOKEN` 配在 Cloudflare Worker Secret | `GITHUB_TOKEN` 配在 Vercel Project Environment Variables |
| 持久 stale fallback | 支持，依赖 Workers KV | 有限支持，仅在 Runtime Cache 可用时生效 |
| 默认外部存储 | Workers KV | 不使用 |
| 是否需要付费 add-on | 不需要 | 不需要 |

这个项目不是通用 GitHub 代理，只开放 KIRARI GitHub 卡片需要的固定接口。

## API

Cloudflare Worker 内部 API：

| Method | Path | 用途 |
|--------|------|------|
| `GET` / `HEAD` | `/api/github/repos/:owner/:repo` | 仓库元数据 |
| `GET` / `HEAD` | `/api/github/repos/:owner/:repo/contents/:path?ref=:ref` | 文件卡片需要的 contents 数据 |
| `GET` / `HEAD` | `/api/github/repos/:owner/:repo/commits?path=:path&per_page=1&sha=:sha` | 文件路径的最新 commit |
| `GET` / `HEAD` | `/api/github/avatar/:owner?size=96` | GitHub 头像代理 |
| `GET` / `HEAD` | `/healthz` | Worker 健康检查 |
| `OPTIONS` | `*` | CORS preflight |

KIRARI 推荐对外路径：

| Method | Path | 转发目标 |
|--------|------|----------|
| `GET` / `HEAD` | `/ghc/repos/:owner/:repo` | `/api/github/repos/:owner/:repo` |
| `GET` / `HEAD` | `/ghc/repos/:owner/:repo/contents/:path?ref=:ref` | `/api/github/repos/:owner/:repo/contents/:path?ref=:ref` |
| `GET` / `HEAD` | `/ghc/repos/:owner/:repo/commits?path=:path&per_page=1&sha=:sha` | `/api/github/repos/:owner/:repo/commits?path=:path&per_page=1&sha=:sha` |
| `GET` / `HEAD` | `/ghc/avatar/:owner?size=96` | `/api/github/avatar/:owner?size=96` |
| `GET` / `HEAD` | `/ghc/healthz` | `/healthz` 或 Vercel health route |

## Usage

### 1. 选择部署路径

| KIRARI 托管平台 | 推荐方式 | 下一步 |
|-----------------|----------|--------|
| Cloudflare Pages | 将本仓库部署为私有 Worker，然后在 KIRARI Pages 里通过 Service Binding 调用 | [Cloudflare 部署](docs/CLOUDFLARE_DEPLOYMENT.md) |
| Vercel | 使用 KIRARI 同项目 Vercel adapter，或把本仓库单独导入 Vercel 测试 | [Vercel 部署](docs/VERCEL_DEPLOYMENT.md) |
| 纯静态托管，无运行时 route | 不启用 adapter，KIRARI 继续直连 `https://api.github.com` | [KIRARI 对接](docs/KIRARI_INTEGRATION.md) |

### 2. 配置 KIRARI

默认直连 GitHub：

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
```

启用同源缓存 route：

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare" # or "vercel"
route = "/ghc"
```

Cloudflare 还需要 Service Binding 名称：

```toml
[githubCard.adapter]
serviceBinding = "GHCARD_CACHE"
```

### 3. 浏览器验证

部署后打开包含 `::github` 或 `::githubfile` 的 KIRARI 页面，在浏览器 Network 面板检查：

| 预期 | 说明 |
|------|------|
| 请求走 `/ghc/repos/...` | KIRARI 已使用同源 adapter |
| 请求走 `/ghc/avatar/...` | 头像 URL 已由缓存层改写 |
| 不再请求 `api.github.com` | repo/file card API 已被代理 |
| 不再请求 `github.com/*.png` | 头像已被代理 |
| 响应包含 `X-Cache` | 请求经过缓存层 |

## 配置项

### 运行时变量

| 变量 | 是否必需 | 平台 | 配置位置 | 用途 |
|------|----------|------|----------|------|
| `GITHUB_TOKEN` | 非必需，生产推荐 | Cloudflare | Cloudflare Worker Secret | Worker 请求 GitHub REST API 时使用 |
| `GITHUB_TOKEN` | 非必需，生产推荐 | Vercel | Vercel Project Environment Variables | Vercel Function 请求 GitHub REST API 时使用 |
| `CACHE_NAMESPACE_VERSION` | 非必需 | Cloudflare / Vercel | `wrangler.jsonc` vars 或 Vercel 环境变量 | 缓存 key 版本，递增后批量失效旧缓存 |
| `ALLOWED_ORIGINS` | 非必需 | Cloudflare | `wrangler.jsonc` vars 或 Worker 环境变量 | 浏览器 Origin 白名单，逗号分隔 |
| `GHC_ALLOWED_ORIGINS` | 非必需 | Vercel | Vercel Project Environment Variables | Vercel 专用 Origin 白名单；未设置时回退到 `ALLOWED_ORIGINS` |
| `PUBLIC_BASE_URL` | 仅 Cloudflare repo 预热需要 | Cloudflare | `wrangler.jsonc` vars | cron prewarm 改写头像 URL 时使用的公开 API base |
| `PREWARM_TARGETS` | 非必需 | Cloudflare | `wrangler.jsonc` vars | cron 预热目标，逗号分隔 |

`GITHUB_TOKEN` 不通过 GitHub Actions 明文传递。它属于运行时平台：

| 部署方式 | `GITHUB_TOKEN` 正确位置 |
|----------|-------------------------|
| Cloudflare Worker | Cloudflare Worker Secret，命令是 `pnpm wrangler secret put GITHUB_TOKEN` |
| Vercel Function | Vercel Project Environment Variables |
| KIRARI adapter 关闭 | 不需要 |

### Cloudflare GitHub Actions Secrets

下面两个 Secret 用于 GitHub Actions 一键部署 Worker：

| Secret | deploy workflow 是否需要 | 配置位置 | 用途 |
|--------|---------------------------|----------|------|
| `CLOUDFLARE_ACCOUNT_ID` | 需要 | GitHub Repository Secrets | 指定 Wrangler 部署到哪个 Cloudflare account |
| `CLOUDFLARE_API_TOKEN` | 需要 | GitHub Repository Secrets | 让 CI 中的 Wrangler 通过 Cloudflare API 部署 |

如果其中任意一个缺失，Deploy workflow 仍会执行 install、type-check 和 test，然后跳过 `wrangler deploy`。

不需要配置 KV namespace ID。workflow 会在 deploy 前自动查找名为 `GITHUB_CACHE` 的 Workers KV namespace；如果不存在，会自动创建，并把真实 ID 临时注入 `wrangler.jsonc`。

Cloudflare API token 权限表：

| 场景 | Dashboard 选择项 | API permissions reference 名称 | Scope | 是否必需 |
|------|------------------|--------------------------------|-------|----------|
| GitHub Actions 执行 `wrangler deploy` | Edit Cloudflare Workers / Workers Scripts Edit | Workers Scripts Write | Account | 必需 |
| GitHub Actions 自动创建或复用 `GITHUB_CACHE` KV namespace | Workers KV Storage Edit | Workers KV Storage Write | Account | 必需 |
| 同一个 token 管理 Worker routes 或 custom domain routes | Workers Routes Edit | Workers Routes Write | Zone | 可选 |

默认私有 Service Binding 方案不需要 Worker custom domain，也不需要 zone-level Worker route。

## Cloudflare 快速开始

本地安装和检查：

```bash
pnpm install
pnpm cf:types
pnpm type-check
pnpm test
pnpm deploy:dry
```

手动部署时创建 KV namespace：

```bash
pnpm wrangler kv namespace create GITHUB_CACHE
```

把返回的 `id` 写入 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  {
    "binding": "GITHUB_CACHE",
    "id": "<production-kv-id>"
  }
]
```

GitHub Actions 不需要手动执行这一步；workflow 会自动创建或复用 `GITHUB_CACHE`。本地手动部署前可以运行：

```bash
pnpm cf:prepare-config
pnpm cf:config-check
```

如果 `id` 仍是 `<production-kv-id>`，`pnpm cf:config-check` 会在真正调用 `wrangler deploy` 前失败，并给出明确提示。

配置可选 GitHub API token：

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

部署：

```bash
pnpm deploy
```

然后在 KIRARI Cloudflare Pages 项目里添加 Service Binding：

| 字段 | 值 |
|------|----|
| Variable name | `GHCARD_CACHE` |
| Service | `kirari-ghcard-cache` |

## Vercel 快速开始

本地安装和检查：

```bash
pnpm install
pnpm type-check
pnpm test
```

导入本仓库到 Vercel，或使用 README 顶部的 Deploy with Vercel 按钮。`vercel.json` 定义了同项目 rewrite：

| Source | Destination |
|--------|-------------|
| `/ghc` | `/api/ghc/healthz` |
| `/ghc/:path*` | `/api/ghc/:path*` |

在 Vercel 配置可选 GitHub API token：

```text
Project -> Settings -> Environment Variables -> GITHUB_TOKEN
```

Vercel 路径不使用 Cloudflare Worker Secret、`CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_ACCOUNT_ID`。

### Vercel GitHub Actions 部署

仓库包含 `Deploy Vercel` workflow。只想用 Vercel 托管这个缓存服务时，在 GitHub Repository Secrets 添加：

| Secret | 是否必需 | 用途 |
|--------|----------|------|
| `VERCEL_TOKEN` | 需要 | 允许 GitHub Actions 调用 Vercel CLI 部署 |
| `VERCEL_ORG_ID` | 可选 | 指定已有 Vercel team/user scope |
| `VERCEL_PROJECT_ID` | 可选 | 指定已有 Vercel project |

未配置 `VERCEL_TOKEN` 时，workflow 仍会执行 install、type-check 和 test，然后跳过 Vercel deploy。

## 缓存策略

| 资源 | Fresh TTL | Stale TTL | 说明 |
|------|-----------|-----------|------|
| Repo metadata | 6 hours | 7 days | 缓存 JSON，并改写头像 URL |
| Contents metadata | 24 hours | 14 days | 缓存 JSON |
| Latest commit by path | 1 hour | 7 days | 缓存 JSON |
| Avatar | 7 days | 30 days | 缓存图片响应 |
| 404 | 10 minutes | 1 day | 缓存短时间，减少重复 miss |
| 403 / 429 / 5xx | 不长期写入 | 仅已有 stale 可用 | 有 stale 时优先返回 stale |

调试 header：

| Header | 含义 |
|--------|------|
| `X-Cache` | 缓存结果，例如 `HIT-L1`、`HIT-KV`、`MISS`、`STALE`、`HIT-RUNTIME`、`STALE-RUNTIME` |
| `X-Cache-Key` | 归一化后的缓存 key |
| `X-Upstream-RateLimit-Remaining` | GitHub 返回的剩余 rate limit 次数 |
| `X-Upstream-RateLimit-Reset` | GitHub 返回的 rate limit reset 时间戳 |

## 文档索引

| 文档 | 内容 |
|------|------|
| [Cloudflare 部署](docs/CLOUDFLARE_DEPLOYMENT.md) | 私有 Worker、KV、Worker Secret、GitHub Actions、Service Binding |
| [Vercel 部署](docs/VERCEL_DEPLOYMENT.md) | 免费版 Vercel Function 路径和 rewrite |
| [KIRARI 对接](docs/KIRARI_INTEGRATION.md) | KIRARI 配置和平台 adapter 行为 |
| [运维指南](docs/OPERATIONS.md) | 缓存 header、stale fallback、rate limit、回滚、预热 |

## 官方参考

| 主题 | 官方文档 |
|------|----------|
| Cloudflare GitHub Actions 认证和 secrets | [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) |
| Cloudflare API token 权限名称 | [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) |
| Deploy to Cloudflare 按钮格式 | [Cloudflare Deploy to Cloudflare changelog](https://developers.cloudflare.com/changelog/2025-04-08-deploy-to-cloudflare-button/) |
| Deploy with Vercel 按钮格式 | [Vercel Deploy Button](https://vercel.com/docs/deployments/deploy-button) |
| `vercel.json` rewrites | [Vercel rewrites](https://vercel.com/docs/routing/rewrites) |

## 开发流程

1. 修改 Worker 或 Function 行为。
2. 同步更新 `README.md`、`docs/`、`CHANGELOG.md`。
3. 运行 `pnpm type-check`。
4. 运行 `pnpm test`。
5. Cloudflare 相关变更运行 `pnpm cf:types`。
6. Cloudflare 发布前运行 `pnpm deploy:dry`。
7. 使用 Conventional Commits 提交。

## FAQ

### 需要 custom domain 吗？

不需要。推荐生产方案是 KIRARI 同源 `/ghc/*`。Cloudflare 上 KIRARI Pages 通过 Service Binding 调用私有 Worker；Vercel 上通过同项目 rewrite 调用本项目 Function。

### `ALLOWED_ORIGINS` 是安全边界吗？

不是。CORS 只约束浏览器调用。更重要的限制是本项目不是任意 URL 代理，只接受固定 GitHub card route。Cloudflare 生产路径下，Worker 还会关闭 `workers_dev` 和 preview URL。

### 必须配置 `GITHUB_TOKEN` 吗？

不是。项目可以匿名请求 GitHub API，但生产建议配置 `GITHUB_TOKEN`，降低 GitHub REST API rate limit 造成失败的概率。

### Vercel 需要 Vercel KV、Upstash、Supabase 或 Marketplace add-on 吗？

不需要。默认 Vercel 路径不使用外部存储。Runtime Cache 仅在环境提供时尝试使用；不可用时回退到 HTTP cache headers 和直接 upstream 请求。
