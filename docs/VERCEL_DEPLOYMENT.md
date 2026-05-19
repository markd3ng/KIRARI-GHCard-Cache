# Vercel 免费版部署指南

Vercel 版是轻量同源代理方案，目标是让浏览器只访问 `/ghc/*`，默认不依赖 Vercel KV、Upstash、Supabase 或其它 Marketplace 存储。

## 部署链路

```text
Browser -> Vercel /ghc/* -> same-project Vercel Function -> GitHub API
```

## 一键部署

README 中的 Deploy with Vercel badge 会导入本仓库。`vercel.json` 会把 `/ghc/*` rewrite 到 `/api/ghc/*`。

## 环境变量

建议配置：

```text
GITHUB_TOKEN=<fine-grained public repo read token>
GHC_ALLOWED_ORIGINS=
CACHE_NAMESPACE_VERSION=v1
```

`GITHUB_TOKEN` 可选，但建议生产配置以降低 GitHub API rate limit 风险。

## 缓存行为

Vercel 版默认使用 HTTP `Cache-Control`：

```text
repo metadata: s-maxage 6h, stale-while-revalidate 7d
contents metadata: s-maxage 24h, stale-while-revalidate 14d
commits latest-by-path: s-maxage 1h, stale-while-revalidate 7d
avatar: s-maxage 7d, stale-while-revalidate 30d
```

如果运行环境提供 `@vercel/functions` Runtime Cache，handler 会自动尝试使用它；没有该包或不可用时会静默回退到 HTTP 缓存头。

## KIRARI 配置

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "vercel"
route = "/ghc"
```

## 免费版边界

- 不默认使用 Vercel KV、Upstash、Supabase。
- 不要求 Vercel Firewall、Deployment Protection 或 custom domain。
- Stale fallback 能力弱于 Cloudflare KV 版；完整 stale fallback 推荐 Cloudflare 路径。
