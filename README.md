# KIRARI-GHCard-Cache

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/markd3ng/KIRARI-GHCard-Cache)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarkd3ng%2FKIRARI-GHCard-Cache)

KIRARI GitHub 卡片专用缓存代理。它为 KIRARI 的 `::github` 与 `::githubfile` 卡片代理 GitHub REST API 和头像资源，降低 GitHub rate limit 压力，并改善中国地区访问 GitHub API / 头像域名缓慢或不可达的问题。

生产首选 Cloudflare **私有 Service Binding 模式**：

```text
Browser -> KIRARI Pages /ghc/* -> Pages Function -> Service Binding -> private Worker -> GitHub API / KV / Cache API
```

Worker 默认关闭公网入口：

```jsonc
{
  "workers_dev": false,
  "preview_urls": false
}
```

## 功能

- 缓存 GitHub repo、contents、commits 和 avatar 请求。
- Cloudflare 版：L1 `caches.default` + L2 KV stale fallback。
- Vercel 免费版：同项目 `/ghc` Function + HTTP cache headers，可选 Runtime Cache。
- 可选 `GITHUB_TOKEN` 提升 GitHub REST API 限额。
- 可选 `ALLOWED_ORIGINS` 浏览器 Origin 白名单。
- 可选 cron 预热目标。
- 支持 KIRARI Pages `/ghc/*` 同源私有转发。
- 支持 Vercel `/ghc/*` rewrite 到同项目 Function。
- 支持 GitHub Actions 自动部署 Worker。

## API

Worker 内部 API 保持为：

```text
GET /api/github/repos/:owner/:repo
GET /api/github/repos/:owner/:repo/contents/:path?ref=:ref
GET /api/github/repos/:owner/:repo/commits?path=:path&per_page=1&sha=:sha
GET /api/github/avatar/:owner?size=96
GET /healthz
OPTIONS *
```

KIRARI 对外暴露的推荐路径是：

```text
GET /ghc/repos/:owner/:repo
GET /ghc/repos/:owner/:repo/contents/:path?ref=:ref
GET /ghc/repos/:owner/:repo/commits?path=:path&per_page=1&sha=:sha
GET /ghc/avatar/:owner?size=96
```

Pages Function 会把 `/ghc/*` 转发为 Worker 内部的 `/api/github/*`。

## 快速开始

Cloudflare Worker：

```bash
pnpm install
pnpm cf:types
pnpm type-check
pnpm test
pnpm deploy:dry
```

创建 KV namespace：

```bash
pnpm wrangler kv namespace create GITHUB_CACHE
pnpm wrangler kv namespace create GITHUB_CACHE --preview
```

把返回的 `id` 和 `preview_id` 写入 `wrangler.jsonc`。

配置 GitHub Token。这里的 `GITHUB_TOKEN` 是 Worker 运行时访问 GitHub API 用的 token，需要配置到 **Cloudflare Worker Secret**：

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

部署：

```bash
pnpm deploy
```

Vercel 免费版：

```bash
pnpm install
pnpm type-check
pnpm test
```

导入 Vercel 后，`vercel.json` 会把 `/ghc/*` rewrite 到 `/api/ghc/*`。生产建议在 **Vercel Project Environment Variables** 里配置 `GITHUB_TOKEN`。

## 配置

`wrangler.jsonc` 中只放非 secret 配置：

```jsonc
{
  "workers_dev": false,
  "preview_urls": false,
  "vars": {
    "CACHE_NAMESPACE_VERSION": "v1",
    "PUBLIC_BASE_URL": "",
    "ALLOWED_ORIGINS": "",
    "PREWARM_TARGETS": ""
  }
}
```

- `CACHE_NAMESPACE_VERSION`：批量失效缓存时递增，例如 `v2`。
- `PUBLIC_BASE_URL`：custom domain / 独立测试模式下用于改写头像 URL；Service Binding 模式由 KIRARI Pages Function 传入 `/ghc` base。
- `ALLOWED_ORIGINS`：逗号分隔的浏览器 Origin；空值表示 `Access-Control-Allow-Origin: *`。
- `PREWARM_TARGETS`：逗号分隔的预热目标，例如 `repo:saicaca/fuwari,content:saicaca/fuwari:README.md,commits:saicaca/fuwari:README.md,avatar:saicaca`。

真实 secret 不要写入仓库。不同平台的配置位置不同：

| 变量 | 用途 | 配置位置 |
|------|------|----------|
| `GITHUB_TOKEN` | 运行时访问 GitHub REST API，提高 rate limit | Cloudflare Worker Secret 或 Vercel Project Environment Variables |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions 部署 Cloudflare Worker | GitHub Repository Secrets |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions 指定部署目标 Cloudflare account | GitHub Repository Secrets |

Cloudflare Worker 配置 `GITHUB_TOKEN`：

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

Vercel 配置 `GITHUB_TOKEN`：进入 **Vercel Project → Settings → Environment Variables**，新增 `GITHUB_TOKEN`，选择 Production / Preview 环境。

## 缓存策略

```text
repo metadata: fresh 6h, stale 7d
contents metadata: fresh 24h, stale 14d
commits latest-by-path: fresh 1h, stale 7d
avatar: fresh 7d, stale 30d
404: fresh 10m, stale 1d
403/429/5xx: 不写长期缓存，优先返回 stale
```

调试 header：

```text
X-Cache: HIT-L1 | HIT-KV | MISS | STALE
X-Cache-Key: ghcard:v1:...
X-Upstream-RateLimit-Remaining: ...
X-Upstream-RateLimit-Reset: ...
```

## GitHub Actions 部署

仓库包含：

```text
.github/workflows/ci.yml
.github/workflows/deploy.yml
```

需要在 GitHub Secrets 配置：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

Cloudflare 当前推荐在 Dashboard 的 **Account API tokens → Create Token → Permission policies → Custom → Edit Cloudflare Workers** 创建 CI token，并尽量只授权到部署目标 account。

权限建议：

| 场景 | Dashboard 权限名 | API 权限名 | Scope | 是否必需 | 说明 |
|------|------------------|------------|-------|----------|------|
| GitHub Actions 执行 `wrangler deploy` | Edit Cloudflare Workers | Workers Scripts Write/Edit | Account | 必需 | Cloudflare 官方 GitHub Actions 文档推荐使用该预设。 |
| 用同一个 token 创建/管理 KV namespace | Workers KV Storage Edit | Workers KV Storage Write/Edit | Account | 可选 | 仅当 CI 或脚本会运行 `wrangler kv namespace create` 时需要；本仓库 workflow 只 deploy，KV ID 预先写入 `wrangler.jsonc`。 |
| 用同一个 token 管理 Worker routes/custom domain | Workers Routes Edit | Workers Routes Write/Edit | Zone | 可选 | 仅当同一个 token 要写入 zone-level Worker routes 时需要；默认 Service Binding 私有模式不需要。 |

注意：`CLOUDFLARE_API_TOKEN` 只给 GitHub Actions 用来执行 `wrangler deploy`。它不是 GitHub API token，也不会被 Worker/Vercel Function 用来请求 GitHub。

如果部署 Cloudflare Worker，`GITHUB_TOKEN` 要配置在 Cloudflare Worker Secret；如果部署 Vercel，`GITHUB_TOKEN` 要配置在 Vercel Project Environment Variables。不要把真实 `GITHUB_TOKEN` 写进仓库或 workflow YAML。

如果 `CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_ACCOUNT_ID` 尚未配置，Deploy 工作流仍会完成安装、类型检查和测试，但会跳过真正的 Worker 发布步骤，避免仓库初始化阶段出现无意义的红灯。两个 Secret 都配置后，下一次推送或手动触发会执行 `wrangler deploy`。

## KIRARI 对接

KIRARI 默认直连 GitHub。启用 Cloudflare 或 Vercel adapter 后使用：

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare" # or "vercel"
route = "/ghc"
```

Cloudflare Pages 项目需要 Service Binding：

```text
binding: GHCARD_CACHE
service: kirari-ghcard-cache
```

完整对接说明见 `docs/KIRARI_INTEGRATION.md`。

## 开发流程

1. 修改 Worker 行为。
2. 同步更新 `README.md`、`docs/`、`CHANGELOG.md`。
3. 运行 `pnpm type-check`。
4. 运行 `pnpm test`。
5. 运行 `pnpm cf:types`。
6. 运行 `pnpm deploy:dry`。
7. 使用 Conventional Commits 提交。

## FAQ

### 为什么不用公开 Worker 域名？

生产首选 Pages Function + Service Binding。浏览器只访问 KIRARI 自己的 `/ghc/*`，Worker 关闭 `workers.dev` 和 preview URL，暴露面更小。

### CORS 白名单是不是安全边界？

不是。CORS 只约束浏览器调用。免费版默认不依赖平台付费防护；如果公开部署，建议保持接口只支持固定 GitHub card 路由、配置 GitHub token，并观察请求量。

### 是否必须配置 GitHub Token？

不是。无 token 可以运行，但生产推荐配置 `GITHUB_TOKEN`，避免匿名 GitHub REST API 限额过低。Cloudflare 部署时配置为 Worker Secret；Vercel 部署时配置为 Project Environment Variable。

### 是否需要 custom domain？

不需要。custom domain 是备选方案；生产主方案是 KIRARI Pages `/ghc/*` + Service Binding。
