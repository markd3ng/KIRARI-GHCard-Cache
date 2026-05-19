# 运维指南

## 推荐生产模式

```text
KIRARI Pages /ghc/*
  -> Service Binding GHCARD_CACHE
    -> private kirari-ghcard-cache Worker
```

Worker 配置：

```jsonc
"workers_dev": false,
"preview_urls": false
```

Vercel 免费版是轻量同源代理：

```text
KIRARI Vercel /ghc/*
  -> same-project Function
    -> GitHub API
```

Vercel 版默认不使用外部 KV/Redis/Supabase；stale fallback 能力弱于 Cloudflare KV 版。

## 缓存 Header

观察：

```text
X-Cache: HIT-L1 | HIT-KV | MISS | STALE | HIT-RUNTIME | STALE-RUNTIME
X-Cache-Key: ghcard:v1:...
```

含义：

- `HIT-L1`：Cloudflare edge Cache API 命中。
- `HIT-KV`：KV fresh 命中，并后台回填 L1。
- `MISS`：请求了 GitHub upstream。
- `STALE`：返回 stale KV，并后台尝试刷新。
- `HIT-RUNTIME`：Vercel Runtime Cache fresh 命中。
- `STALE-RUNTIME`：Vercel Runtime Cache stale fallback。
- `MISS`：请求了 GitHub upstream，并依赖对应平台缓存写入或 HTTP cache headers。

## TTL

```text
repo metadata: fresh 6h, stale 7d
contents metadata: fresh 24h, stale 14d
commits latest-by-path: fresh 1h, stale 7d
avatar: fresh 7d, stale 30d
404: fresh 10m, stale 1d
403/429/5xx: 不写长期缓存，优先 stale fallback
```

## 批量失效缓存

修改：

```jsonc
"CACHE_NAMESPACE_VERSION": "v2"
```

旧 KV 条目会自然过期，新请求使用新 key 前缀。

## 处理 GitHub 403 / 429

1. 确认 Cloudflare Worker Secret 或 Vercel Environment Variable `GITHUB_TOKEN` 已配置。
2. 检查响应 header：`X-Upstream-RateLimit-Remaining` 与 `X-Upstream-RateLimit-Reset`。
3. 确认 KIRARI 没有生成大量随机 ref/path 请求。
4. 如果 KV 有 stale，用户应收到 `X-Cache: STALE`。

## 验证私有 Worker

部署后确认：

- `*.workers.dev` 入口不可访问。
- KIRARI `/ghc/repos/...` 可访问。
- KIRARI `/ghc/avatar/...` 可访问。
- Network 不直连 `api.github.com`。
- Network 不直连 `github.com/*.png`。

## 临时回滚

KIRARI 改回：

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
```

或删除 `[githubCard]` 配置，使用默认值。

## 预热目标

设置：

```jsonc
"PUBLIC_BASE_URL": "https://example.com/ghc",
"PREWARM_TARGETS": "repo:saicaca/fuwari,content:saicaca/fuwari:README.md,commits:saicaca/fuwari:README.md,avatar:saicaca"
```

cron 默认每 6 小时执行一次。
