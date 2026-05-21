# KIRARI-GHCard-Cache

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/markd3ng/KIRARI-GHCard-Cache)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarkd3ng%2FKIRARI-GHCard-Cache)

GitHub REST API 与头像的缓存代理，为 KIRARI 的 `::github` / `::githubfile` 提供同源 `/ghc/*` 接口。将 GitHub rate limit 由 60 req/h（匿名）提升至 5,000 req/h（带 token），并消除因直连 `api.github.com` / `github.com/*.png` 导致的 DNS 解析延迟与跨国连接不稳定。

两条免费部署路径：

| 路径 | 缓存 | 持久 stale fallback | 适用于 |
|------|------|---------------------|--------|
| **Cloudflare Worker** | Cache API (L1) + Workers KV (L2) | ✅ KV 持久化 | KIRARI 部署在 Cloudflare Pages |
| **Vercel Function** | HTTP `Cache-Control` + 可选 Runtime Cache | ❌ 无持久 fallback | KIRARI 部署在 Vercel |

> **非通用 GitHub 代理** — 仅开放 KIRARI GitHub 卡片所需的固定接口：repo metadata、contents、commits、avatar。

---

## API

Cloudflare Worker 内部路径（Vercel 通过 `vercel.json` rewrite `/ghc/*` → `/api/ghc/*`）：

| Method | Path | Response | TTL (fresh) |
|--------|------|----------|-------------|
| `GET`/`HEAD` | `/api/github/repos/:owner/:repo` | repo JSON（`owner.avatar_url` 已改写） | 6 h |
| `GET`/`HEAD` | `/api/github/repos/:owner/:repo/contents/:path?ref=:ref` | contents JSON | 24 h |
| `GET`/`HEAD` | `/api/github/repos/:owner/:repo/commits?path=:path&per_page=1&sha=:sha` | commit JSON（仅最新一条） | 1 h |
| `GET`/`HEAD` | `/api/github/avatar/:owner?size=96` | 头像图片（size: 16-256） | 7 d |
| `GET`/`HEAD` | `/healthz` | `{"ok":true,"service":"kirari-ghcard-cache"}` | — |
| `OPTIONS` | `*` | CORS preflight (204) | — |

> **`/healthz` 跨平台差异**：Cloudflare 返回 `service` 字段，Vercel 返回 `runtime` 字段。仅 `ok` 字段在两个平台保持一致，适合作为通用健康判据。

KIRARI 推荐对外路径（`/ghc/*`）：

| Browser | Target |
|---------|--------|
| `/ghc/repos/:owner/:repo` | `/api/github/repos/:owner/:repo` |
| `/ghc/repos/:owner/:repo/contents/:path?ref=:ref` | `/api/github/repos/:owner/:repo/contents/:path?ref=:ref` |
| `/ghc/repos/:owner/:repo/commits?path=:path` | `/api/github/repos/:owner/:repo/commits?path=:path&per_page=1` |
| `/ghc/avatar/:owner?size=96` | `/api/github/avatar/:owner?size=96` |
| `/ghc/healthz` | `/healthz` |

---

## 快速开始

### Cloudflare Worker

```bash
pnpm install
pnpm cf:types && pnpm type-check && pnpm test
pnpm wrangler kv namespace create GITHUB_CACHE
# 将返回的 id 写入 wrangler.jsonc -> kv_namespaces[0].id
pnpm wrangler secret put GITHUB_TOKEN  # 可选，生产推荐
pnpm deploy
```

在 KIRARI Cloudflare Pages 项目添加 Service Binding：`GHCARD_CACHE` → `kirari-ghcard-cache`。详见 [Cloudflare 部署](docs/CLOUDFLARE_DEPLOYMENT.md)。

### Vercel Function

```bash
pnpm install
pnpm type-check && pnpm test
# 将本仓库导入 Vercel，或作为 KIRARI 同项目部署
```

在 Vercel Project → Settings → Environment Variables 配置 `GITHUB_TOKEN`（可选）。详见 [Vercel 部署](docs/VERCEL_DEPLOYMENT.md)。

### KIRARI 配置

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare"   # 或 "vercel"
route = "/ghc"
# Cloudflare 专用：
serviceBinding = "GHCARD_CACHE"
```

---

## 配置项

### 运行时变量

| 变量 | 平台 | 必需 | 配置位置 | 说明 |
|------|------|------|----------|------|
| `GITHUB_TOKEN` | 全部 | 推荐 | Cloudflare Worker Secret / Vercel Env | 匿名 60 req/h → 5,000 req/h |
| `ALLOWED_ORIGINS` | Cloudflare | 否 | `wrangler.jsonc` vars | CORS 白名单，逗号分隔；空则 `*` |
| `GHC_ALLOWED_ORIGINS` | Vercel | 否 | Vercel Env | Vercel CORS 白名单；未设则回退 `ALLOWED_ORIGINS` |
| `CACHE_NAMESPACE_VERSION` | 全部 | 否 | vars / Vercel Env | 批量失效缓存（递增即生效） |
| `PUBLIC_BASE_URL` | Cloudflare | prewarm 需要 | `wrangler.jsonc` vars | 预热时改写 avatar URL 的公开 base |
| `PREWARM_TARGETS` | Cloudflare | 否 | `wrangler.jsonc` vars | Cron 预热目标（`repo:o/r,avatar:o,...`） |

> **`GITHUB_TOKEN` 只属于运行时平台** — 不写入 `kirari.config.toml`、GitHub Actions YAML 或任何版本控制文件。配置方式：Cloudflare 用 `pnpm wrangler secret put`，Vercel 用 Project → Environment Variables。
> **Token 不作用于 avatar 请求** — avatar 图片通过 `github.com/*.png` 公开 CDN 获取，无需认证。REST API（repo/contents/commits）配 token 后升为 5,000 req/h，avatar 仍走匿名访问。

### CI Secrets

| Secret | 必需 | 用于 |
|--------|------|------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 部署 | `wrangler deploy` 目标 account |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 部署 | CI 中 Wrangler 调用 Cloudflare API |
| `VERCEL_TOKEN` | Vercel 部署 | CI 中 Vercel CLI 部署 |

缺少时 workflow 跳过 deploy 步骤，仍执行 install → type-check → test。

---

## 缓存策略

| 资源 | Fresh TTL | Stale TTL | 不可缓存 |
|------|-----------|-----------|----------|
| Repo metadata | 6 h | 7 d | 403/429/5xx |
| Contents | 24 h | 14 d | 同上 |
| Latest commit | 1 h | 7 d | 同上 |
| Avatar | 7 d | 30 d | 同上 |
| 404 | 10 min | 1 d | — |

Cloudflare 路径：L1（Cache API，内存级）→ L2（Workers KV，持久化）。KV 命中返回 `HIT-KV` 并异步写入 L1；KV 过期但未超 stale TTL 返回 `STALE` 并后台刷新。

Vercel 路径：HTTP `Cache-Control`（`s-maxage` + `stale-while-revalidate`）。`@vercel/functions` Runtime Cache 可用时自动启用，不可用时回退直连。

### 调试 Header

| Header | 值 | 含义 |
|--------|----|------|
| `X-Cache` | `HIT-L1` / `HIT-KV` / `MISS` / `STALE` / `HIT-RUNTIME` / `STALE-RUNTIME` | 缓存层级状态 |
| `X-Cache-Key` | `ghcard:v1:{kind}:{owner}:{repo}:...` | 归一化缓存 key |
| `X-Upstream-RateLimit-Remaining` | `number` | GitHub 剩余额度（仅 upstream 返回时） |
| `X-Upstream-RateLimit-Reset` | `timestamp` | GitHub rate limit reset Unix 时间戳 |

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [架构与缓存流程](docs/ARCHITECTURE.md) | 模块依赖图、双平台数据流、错误处理策略 |
| [Cloudflare 部署](docs/CLOUDFLARE_DEPLOYMENT.md) | Worker → KV → Service Binding 完整流程 |
| [Vercel 部署](docs/VERCEL_DEPLOYMENT.md) | Function → HTTP Cache 轻量方案 |
| [KIRARI 对接](docs/KIRARI_INTEGRATION.md) | 三种 adapter 模式与 token 归属 |
| [运维指南](docs/OPERATIONS.md) | Header 解读、TTL 策略、预热、回滚与 Troubleshooting |
| [部署入口](docs/DEPLOYMENT.md) | 平台选择、变量归属总表、CI 权限 |

---

## 开发流程

```text
1. 修改 src/ 或 api/
2. 更新 README.md / docs/ / CHANGELOG.md
3. pnpm type-check
4. pnpm test
5. Cloudflare 变更后运行 pnpm cf:types
6. 发布前 pnpm deploy:dry
7. Conventional Commits 提交
```

---

## 官方参考

| 主题 | 链接 |
|------|------|
| Cloudflare Workers GitHub Actions | https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ |
| Cloudflare API Token 权限 | https://developers.cloudflare.com/fundamentals/api/reference/permissions/ |
| Workers KV 限制 | https://developers.cloudflare.com/kv/platform/limits/ |
| Deploy to Cloudflare 按钮 | https://developers.cloudflare.com/changelog/2025-04-08-deploy-to-cloudflare-button/ |
| Vercel Deploy Button | https://vercel.com/docs/deployments/deploy-button |
| Vercel Rewrites | https://vercel.com/docs/routing/rewrites |
| Vercel Functions Duration | https://vercel.com/docs/functions/configuring-functions/duration |
| GitHub REST API Rate Limits | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
