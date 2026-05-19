# KIRARI-GHCard-Cache

KIRARI GitHub 卡片专用 Cloudflare Worker 缓存代理。它为 KIRARI 的 `::github` 与 `::githubfile` 卡片缓存 GitHub REST API 和头像资源，降低 GitHub rate limit 压力，并改善中国地区访问 GitHub API / 头像域名缓慢或不可达的问题。

生产推荐部署为 **私有 Service Binding 模式**：

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
- L1 `caches.default` + L2 KV stale fallback。
- 可选 `GITHUB_TOKEN` 提升 GitHub REST API 限额。
- 可选 `ALLOWED_ORIGINS` 浏览器 Origin 白名单。
- 可选 cron 预热目标。
- 支持 KIRARI Pages `/ghc/*` 同源私有转发。
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

配置 GitHub Token：

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

部署：

```bash
pnpm deploy
```

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

真实 secret 不要写入仓库：

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

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
CLOUDFLARE_API_TOKEN
```

Cloudflare API Token 最小权限建议：

```text
Account: Workers Scripts Edit
Account: Workers KV Storage Edit
Account: Account Settings Read
Zone: Zone Read   # 仅 custom domain / route 场景需要
```

`GITHUB_TOKEN` 仍通过 Cloudflare Worker Secret 配置，不通过 GitHub Actions 明文传递。

如果 `CLOUDFLARE_API_TOKEN` 尚未配置，Deploy 工作流仍会完成安装、类型检查和测试，但会跳过真正的 Worker 发布步骤，避免仓库初始化阶段出现无意义的红灯。配置该 Secret 后，下一次推送或手动触发会执行 `wrangler deploy`。

## KIRARI 对接

KIRARI 推荐配置：

```toml
[githubCard]
apiBase = "/ghc"
```

KIRARI Pages 项目需要 Service Binding：

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

不是。CORS 只约束浏览器调用。真正防滥用应使用 Cloudflare WAF / Rate Limiting。

### 是否必须配置 GitHub Token？

不是。无 token 可以运行，但生产推荐配置 `GITHUB_TOKEN`，避免匿名 GitHub REST API 限额过低。

### 是否需要 custom domain？

不需要。custom domain 是备选方案；生产主方案是 KIRARI Pages `/ghc/*` + Service Binding。
