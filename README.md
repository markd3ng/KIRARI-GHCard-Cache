# KIRARI-GHCard-Cache

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/markd3ng/KIRARI-GHCard-Cache)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarkd3ng%2FKIRARI-GHCard-Cache)

KIRARI-GHCard-Cache 是给 KIRARI `::github` / `::githubfile` 卡片使用的 GitHub REST API 与头像缓存代理。部署后，站点可以通过同源 `/ghc/*` 读取仓库信息、文件内容、最新提交和头像，减少直连 `api.github.com` 与 `github.com/*.png` 的跨境延迟，并把 GitHub REST API 的匿名 60 req/h 限制提升到 token 模式下的 5,000 req/h。

它不是通用 GitHub 代理，只开放 KIRARI 卡片需要的固定接口。

## 选择部署方式

| KIRARI 托管平台 | 推荐方案 | 缓存能力 | 适合 |
| --- | --- | --- | --- |
| Cloudflare Pages | 独立 Worker + Pages Service Binding | Cache API + Workers KV + 持久 stale fallback | 生产首选，需要更稳定的故障兜底 |
| Vercel | 同项目 Function 或独立 Vercel 项目 | HTTP cache + 可选 Runtime Cache | 轻量部署，KIRARI 本身在 Vercel |
| 无运行时平台 | 不启用 adapter，直连 GitHub | 无 | 静态托管或临时回滚 |

推荐阅读路径：

1. 不确定选哪种：先看 [部署入口](docs/DEPLOYMENT.md)。
2. KIRARI 在 Cloudflare Pages：看 [Cloudflare 部署](docs/CLOUDFLARE_DEPLOYMENT.md)。
3. KIRARI 在 Vercel：看 [Vercel 部署](docs/VERCEL_DEPLOYMENT.md)。
4. 已有 KIRARI 项目要接入：看 [KIRARI 对接](docs/KIRARI_INTEGRATION.md)。

## 快速开始

### Cloudflare Worker

```bash
pnpm install
pnpm cf:types
pnpm type-check
pnpm test
pnpm wrangler kv namespace create GITHUB_CACHE
pnpm wrangler secret put GITHUB_TOKEN
pnpm deploy
```

把 `wrangler kv namespace create` 返回的 `id` 写入 `wrangler.jsonc` 的 `kv_namespaces[0].id`，替换 `<production-kv-id>`。`GITHUB_TOKEN` 可选但生产推荐。

部署后，在 KIRARI 的 Cloudflare Pages 项目里添加 Service Binding：

| 字段 | 值 |
| --- | --- |
| Type | Service binding |
| Variable name | `GHCARD_CACHE` |
| Service | `kirari-ghcard-cache` |

### Vercel Function

```bash
pnpm install
pnpm type-check
pnpm test
```

然后把本仓库导入 Vercel，或把 Vercel adapter route 集成进 KIRARI 同项目部署。`vercel.json` 已把 `/ghc/*` rewrite 到 `/api/ghc/*`。

## KIRARI 配置

Cloudflare Pages:

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare"
route = "/ghc"
serviceBinding = "GHCARD_CACHE"
```

Vercel:

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "vercel"
route = "/ghc"
```

回滚直连 GitHub:

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
```

## API

Worker 内部使用 `/api/github/*`。对 KIRARI 暴露时推荐统一使用 `/ghc/*`，Cloudflare 由 KIRARI Pages Function 转发，Vercel 由 `vercel.json` rewrite。

| Method | 对外路径 | 内部路径 | 说明 | Fresh TTL |
| --- | --- | --- | --- | --- |
| `GET` / `HEAD` | `/ghc/repos/:owner/:repo` | `/api/github/repos/:owner/:repo` | repo JSON，`owner.avatar_url` 会改写到缓存头像路径 | 6 h |
| `GET` / `HEAD` | `/ghc/repos/:owner/:repo/contents/:path?ref=:ref` | `/api/github/repos/:owner/:repo/contents/:path?ref=:ref` | GitHub contents JSON | 24 h |
| `GET` / `HEAD` | `/ghc/repos/:owner/:repo/commits?path=:path&sha=:sha` | `/api/github/repos/:owner/:repo/commits?path=:path&per_page=1&sha=:sha` | 指定文件最新一条 commit | 1 h |
| `GET` / `HEAD` | `/ghc/avatar/:owner?size=96` | `/api/github/avatar/:owner?size=96` | GitHub 头像，`size` 允许 16-256 | 7 d |
| `GET` / `HEAD` | `/ghc/healthz` | `/healthz` 或 `/api/ghc/healthz` | 健康检查 | 不缓存 |
| `OPTIONS` | `*` | `*` | CORS preflight | 不缓存 |

跨平台健康检查只依赖 `ok` 字段：

| 平台 | 示例 |
| --- | --- |
| Cloudflare | `{"ok":true,"service":"kirari-ghcard-cache"}` |
| Vercel | `{"ok":true,"runtime":"vercel"}` |

## 配置与 Secret

### 运行时变量

| 名称 | 平台 | 必需 | 配置位置 | 作用 |
| --- | --- | --- | --- | --- |
| `GITHUB_TOKEN` | Cloudflare / Vercel | 推荐 | Worker Secret / Vercel Environment Variables | REST API token；repo、contents、commits 请求使用，avatar 不使用 |
| `ALLOWED_ORIGINS` | Cloudflare | 生产推荐 | `wrangler.jsonc` vars 或 Worker env | CORS 白名单，逗号分隔 |
| `GHC_ALLOWED_ORIGINS` | Vercel | 生产推荐 | Vercel Environment Variables | Vercel CORS 白名单；未设时回退 `ALLOWED_ORIGINS` |
| `CACHE_NAMESPACE_VERSION` | Cloudflare / Vercel | 否 | Worker vars / Vercel env | 缓存 key 版本，递增可批量失效 |
| `PUBLIC_BASE_URL` | Cloudflare | prewarm repo 时必需 | Worker vars | Cron 预热时用于改写 repo JSON 里的头像 URL |
| `PREWARM_TARGETS` | Cloudflare | 否 | Worker vars | Cron 预热目标列表 |

`ALLOWED_ORIGINS` / `GHC_ALLOWED_ORIGINS` 留空时，代码只允许没有 `Origin` header 的请求；浏览器跨站请求会返回 403。生产站点建议显式配置 KIRARI 的 origin，例如 `https://blog.example.com`。

### CI Secrets

| Secret | 用于 | 配置位置 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions 部署 Worker | GitHub Repository Secrets |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions 调用 Wrangler | GitHub Repository Secrets |
| `VERCEL_TOKEN` | GitHub Actions 部署 Vercel | GitHub Repository Secrets |
| `VERCEL_ORG_ID` | 指定 Vercel scope，可选 | GitHub Repository Secrets |
| `VERCEL_PROJECT_ID` | 指定 Vercel project，可选 | GitHub Repository Secrets |

不要把 `GITHUB_TOKEN` 写入 `kirari.config.toml`、GitHub Actions YAML、`wrangler.jsonc` 或任何会提交到仓库的文件。

## 缓存策略

| 资源 | Fresh TTL | Stale TTL | 可缓存状态 |
| --- | --- | --- | --- |
| Repo metadata | 6 h | 7 d | `200`, `404` |
| Contents | 24 h | 14 d | `200`, `404` |
| Latest commit | 1 h | 7 d | `200`, `404` |
| Avatar | 7 d | 30 d | `200`, `404` |

`403`、`429`、`5xx` 不写入缓存。Cloudflare 如果已有 stale KV 数据会返回 stale；否则返回 upstream 错误。Vercel 只有 Runtime Cache 可用且已有数据时才可能返回 `STALE-RUNTIME`。

调试 header：

| Header | 说明 |
| --- | --- |
| `X-Cache` | `HIT-L1`、`HIT-KV`、`MISS`、`STALE`、`HIT-RUNTIME`、`STALE-RUNTIME` |
| `X-Cache-Key` | 归一化缓存 key，例如 `ghcard:v1:repo:saicaca:fuwari` |
| `X-Upstream-RateLimit-Remaining` | GitHub 剩余额度，只有本次请求命中 upstream 且 GitHub 返回该 header 时出现 |
| `X-Upstream-RateLimit-Reset` | GitHub rate limit reset Unix 时间戳 |

## 本地开发

```bash
pnpm install
pnpm cf:types
pnpm type-check
pnpm test
pnpm dev
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动 Wrangler 本地 Worker |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm test` | 运行 Vitest |
| `pnpm cf:types` | 生成 Cloudflare binding 类型 |
| `pnpm cf:prepare-config` | 在 CI 中创建/复用 KV namespace 并注入 `wrangler.jsonc` |
| `pnpm cf:config-check` | 检查 `wrangler.jsonc` 是否还有 KV 占位符 |
| `pnpm deploy:dry` | Wrangler dry run |
| `pnpm deploy` | 部署 Cloudflare Worker |

## 验证

部署后至少检查这些结果：

```bash
curl -i https://YOUR_SITE.example/ghc/healthz
curl -i https://YOUR_SITE.example/ghc/repos/saicaca/fuwari
curl -I https://YOUR_SITE.example/ghc/avatar/saicaca?size=96
```

预期：

| 检查 | 结果 |
| --- | --- |
| `/ghc/healthz` | JSON 中 `ok` 为 `true` |
| `/ghc/repos/...` | 返回 repo JSON，响应 header 有 `X-Cache` |
| `/ghc/avatar/...` | 返回图片，响应 header 有 `X-Cache` |
| 浏览器 Network | KIRARI card 请求走同源 `/ghc/*` |
| 浏览器 Network | 不再直接请求 `api.github.com` 或 `github.com/*.png` |

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [部署入口](docs/DEPLOYMENT.md) | 平台选择、变量归属、CI 权限与验证命令 |
| [Cloudflare 部署](docs/CLOUDFLARE_DEPLOYMENT.md) | Worker、KV、Secret、Service Binding 完整路径 |
| [Vercel 部署](docs/VERCEL_DEPLOYMENT.md) | Vercel Function、rewrite、环境变量与缓存行为 |
| [KIRARI 对接](docs/KIRARI_INTEGRATION.md) | KIRARI adapter 配置、请求链路、回滚方式 |
| [架构与缓存流程](docs/ARCHITECTURE.md) | 模块图、路由、缓存、TTL、预热和限制 |
| [运维指南](docs/OPERATIONS.md) | Header 解读、排障、缓存失效、日志与回滚 |

## 官方参考

- [Cloudflare API Token 权限](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Workers KV 文档](https://developers.cloudflare.com/kv/)
- [Vercel Deploy Button](https://vercel.com/docs/deployments/deploy-button)
- [Vercel Rewrites](https://vercel.com/docs/routing/rewrites)
- [GitHub REST API Rate Limits](https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api)
