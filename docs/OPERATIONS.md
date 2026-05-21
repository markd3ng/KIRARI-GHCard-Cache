# 运维指南

本指南用于检查缓存行为、排查部署问题、处理 GitHub rate limit，以及安全回滚。

## 生产模式

| 模式 | 请求路径 | 缓存行为 | 说明 |
|------|----------|----------|------|
| Cloudflare Service Binding | KIRARI `/ghc/*` -> private Worker | Cache API + Workers KV + stale fallback | 推荐生产路径 |
| Vercel 同项目 Function | KIRARI `/ghc/*` -> Vercel Function | HTTP cache headers，可用时尝试 Runtime Cache | 免费版轻量路径 |
| 直连 GitHub | KIRARI -> `https://api.github.com` | 无 GHC 缓存 | 默认回退 |

## 缓存 Header

| Header | 值 | 含义 |
|--------|----|------|
| `X-Cache` | `HIT-L1` | Cloudflare Cache API 命中 |
| `X-Cache` | `HIT-KV` | Cloudflare Workers KV fresh 命中 |
| `X-Cache` | `MISS` | 请求了 GitHub upstream |
| `X-Cache` | `STALE` | 返回 Cloudflare KV stale 数据 |
| `X-Cache` | `HIT-RUNTIME` | Vercel Runtime Cache fresh 命中 |
| `X-Cache` | `STALE-RUNTIME` | 返回 Vercel Runtime Cache stale 数据 |
| `X-Cache-Key` | `ghcard:v1:...` | 归一化后的缓存 key |
| `X-Upstream-RateLimit-Remaining` | number | GitHub API 剩余额度，GitHub 返回时才有 |
| `X-Upstream-RateLimit-Reset` | timestamp | GitHub API reset 时间戳，GitHub 返回时才有 |

## TTL 策略

| 资源 | Fresh TTL | Stale TTL | 缓存状态 |
|------|-----------|-----------|----------|
| Repo metadata | 6 hours | 7 days | `200`，`404` 使用更短 TTL |
| Contents metadata | 24 hours | 14 days | `200`，`404` 使用更短 TTL |
| Latest commit by path | 1 hour | 7 days | `200`，`404` 使用更短 TTL |
| Avatar | 7 days | 30 days | `200`，`404` 使用更短 TTL |
| 404 | 10 minutes | 1 day | 缓存短时间，减少重复 miss |
| 403 / 429 / 5xx | 不长期写入 | 仅已有 stale 可用 | 有 stale 时优先返回 stale |

## 常见操作

### 批量失效缓存

递增 `CACHE_NAMESPACE_VERSION`：

```jsonc
"CACHE_NAMESPACE_VERSION": "v2"
```

缓存 key 中包含该版本。旧条目自然过期，新请求使用新前缀。

### 添加 Cloudflare 预热目标

在 `wrangler.jsonc` vars 或 Worker 环境变量中设置 `PREWARM_TARGETS`：

```jsonc
"PUBLIC_BASE_URL": "https://example.com/ghc",
"PREWARM_TARGETS": "repo:saicaca/fuwari,content:saicaca/fuwari:README.md,commits:saicaca/fuwari:README.md,avatar:saicaca"
```

| 目标类型 | 格式 |
|----------|------|
| Repo | `repo:owner/repo` |
| Contents | `content:owner/repo:path/to/file.md` |
| Commits | `commits:owner/repo:path/to/file.md` |
| Avatar | `avatar:owner` |

repo 预热需要 `PUBLIC_BASE_URL`，因为 repo JSON 中包含 `owner.avatar_url`，Worker 需要知道用哪个公开 base 改写头像 URL。

### 处理 GitHub 403 或 429

| Step | 检查 | 修复 |
|------|------|------|
| 1 | 运行时平台是否配置了 `GITHUB_TOKEN` | Cloudflare: `pnpm wrangler secret put GITHUB_TOKEN`；Vercel: Project Environment Variables |
| 2 | 响应是否包含 `X-Upstream-RateLimit-Remaining` | 如果额度低，等待 `X-Upstream-RateLimit-Reset` 或添加 token |
| 3 | KIRARI card 是否生成大量随机 ref/path 请求 | 避免在 Markdown card 中使用随机 ref |
| 4 | 是否有 stale cache 可用 | Cloudflare 应返回 `X-Cache: STALE`；Vercel 仅在 Runtime Cache 可用时支持 |

### 验证 Cloudflare Worker 私有暴露面

| 检查项 | 预期 |
|--------|------|
| `wrangler.jsonc` 中的 `workers_dev` | `false` |
| `wrangler.jsonc` 中的 `preview_urls` | `false` |
| 浏览器请求 URL | KIRARI 同源 `/ghc/*` |
| Worker 直接公开 URL | 不作为生产入口 |

### 回滚 KIRARI

KIRARI 改回直连 GitHub：

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
```

然后重新构建 KIRARI。生成的 `/ghc` runtime route 会被 materializer 删除。

## Troubleshooting

| 现象 | 可能原因 | 检查位置 | 修复 |
|------|----------|----------|------|
| 浏览器仍请求 `api.github.com` | KIRARI `githubCard.apiBase` 仍指向 GitHub | `kirari.config.toml` | 设置 `apiBase = "/ghc"` 并重新构建 |
| `/ghc/repos/...` 返回 404 | runtime adapter route 没有生成 | KIRARI adapter 配置和 build log | 设置 `githubCard.adapter.enabled = true`，provider 为 `cloudflare` 或 `vercel` |
| Cloudflare `/ghc/*` 返回 binding 错误 | Pages Service Binding 缺失或名称不一致 | Cloudflare Pages bindings | 添加名为 `GHCARD_CACHE` 的 binding，或让名称匹配 `serviceBinding` |
| 头像仍指向 GitHub | public base header 或 URL rewrite 未生效 | 响应 JSON 的 `owner.avatar_url` | 检查 KIRARI 生成 route 和 `X-KIRARI-GHC-PUBLIC-BASE` |
| GitHub rate limit 错误仍出现 | 运行时 `GITHUB_TOKEN` 缺失或无效 | 运行时平台 secret/env | 在对应运行时平台重新配置 `GITHUB_TOKEN` |
| GitHub Actions deploy 被跳过 | 缺少 `CLOUDFLARE_ACCOUNT_ID` 或 `CLOUDFLARE_API_TOKEN` | GitHub Repository Secrets | 添加两个 secrets |
| Vercel deploy 被跳过 | 缺少 `VERCEL_TOKEN` | GitHub Repository Secrets | 添加 `VERCEL_TOKEN`，已有项目可选添加 `VERCEL_ORG_ID` 和 `VERCEL_PROJECT_ID` |
| Deploy 报 `KV namespace '<production-kv-id>' is not valid` | deploy 前没有运行配置准备步骤，或 API token 缺少 KV 权限 | GitHub Actions 的 `pnpm cf:prepare-config` 日志和 Cloudflare API token 权限 | 确保 workflow 使用最新版，并给 `CLOUDFLARE_API_TOKEN` 配置 Workers Scripts Write 与 Workers KV Storage Write |
| Vercel 在 GitHub 故障时没有 stale fallback | Runtime Cache 不可用 | `X-Cache` header | 需要持久 stale fallback 时使用 Cloudflare 路径 |

## 日志命令

Cloudflare Worker 日志：

```bash
pnpm wrangler tail
```

本地验证：

```bash
pnpm type-check
pnpm test
pnpm cf:prepare-config
pnpm cf:config-check
pnpm deploy:dry
```
