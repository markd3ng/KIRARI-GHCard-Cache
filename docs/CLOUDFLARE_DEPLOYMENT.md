# Cloudflare 免费版部署指南

Cloudflare 是本项目的完整缓存代理主方案，默认使用免费层可用能力：Worker、Cache API、Workers KV、Cron Triggers 和 Pages Service Binding。

## 部署链路

```text
Browser -> KIRARI Pages /ghc/* -> Pages Function -> Service Binding -> private Worker -> GitHub API + KV + Cache API
```

## 步骤

```bash
pnpm install
pnpm cf:types
pnpm type-check
pnpm test
pnpm deploy:dry
```

创建 KV：

```bash
pnpm wrangler kv namespace create GITHUB_CACHE
pnpm wrangler kv namespace create GITHUB_CACHE --preview
```

把返回的 `id` 和 `preview_id` 写入 `wrangler.jsonc`。

生产建议配置 GitHub token。这里的 `GITHUB_TOKEN` 是 Worker 运行时访问 GitHub REST API 用的，需要配置到 **Cloudflare Worker Secret**：

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

如果使用 GitHub Actions 自动部署，还需要在 **GitHub Repository Secrets** 配置：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

`CLOUDFLARE_API_TOKEN` 只负责部署权限，不会用于请求 GitHub API。Cloudflare 当前推荐在 Dashboard 的 **Account API tokens → Create Token → Permission policies → Custom → Edit Cloudflare Workers** 创建 CI token。

权限建议：

| 场景 | Dashboard 权限名 | API 权限名 | Scope | 是否必需 | 说明 |
|------|------------------|------------|-------|----------|------|
| GitHub Actions 执行 `wrangler deploy` | Edit Cloudflare Workers | Workers Scripts Write/Edit | Account | 必需 | 官方 GitHub Actions 文档推荐使用该预设。 |
| 创建/管理 KV namespace | Workers KV Storage Edit | Workers KV Storage Write/Edit | Account | 可选 | 仅当 CI 或脚本会创建 KV 时需要。 |
| 管理 Worker routes/custom domain | Workers Routes Edit | Workers Routes Write/Edit | Zone | 可选 | 默认 Service Binding 私有模式不需要。 |

部署：

```bash
pnpm deploy
```

## KIRARI 绑定

Cloudflare Pages 里添加 Service Binding：

```text
Variable name: GHCARD_CACHE
Service: kirari-ghcard-cache
```

KIRARI 配置：

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare"
route = "/ghc"
serviceBinding = "GHCARD_CACHE"
```

## 免费版边界

- 不需要 custom domain。
- 不需要 Cloudflare 付费 WAF / Rate Limiting。
- 不使用 Durable Objects、D1、R2、Queues。
- `ALLOWED_ORIGINS` 只是浏览器 CORS 控制，不是强安全边界。
