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

把返回的 `id` 和 `preview_id` 写入 `wrangler.jsonc`。生产建议配置 GitHub token：

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

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
