# 运维指南

缓存行为诊断、部署问题排查、GitHub rate limit 处理、安全回滚。

## 生产模式一览

| 模式 | 请求路径 | 缓存层 | 持久 stale |
|------|----------|--------|-----------|
| Cloudflare Service Binding | KIRARI `/ghc/*` → 私有 Worker | Cache API + Workers KV + stale | ✅ |
| Vercel 同项目 Function | KIRARI `/ghc/*` → Vercel Function | HTTP Cache + 可选 Runtime Cache | ❌ |
| 直连 GitHub | KIRARI → `https://api.github.com` | 无 | N/A |

---

## 缓存 Header

| Header | 可能值 | 含义 |
|--------|--------|------|
| `X-Cache` | `HIT-L1` | Cloudflare Cache API 内存命中 |
| `X-Cache` | `HIT-KV` | Workers KV fresh 命中 |
| `X-Cache` | `MISS` | 直连 GitHub upstream |
| `X-Cache` | `STALE` | KV 过期但未超 stale TTL，后台异步刷新 |
| `X-Cache` | `HIT-RUNTIME` | Vercel Runtime Cache 命中 |
| `X-Cache` | `STALE-RUNTIME` | Vercel Runtime Cache 过期数据 |
| `X-Cache-Key` | `ghcard:v1:{kind}:{owner}:{repo}:{...}` | 归一化缓存 key |
| `X-Upstream-RateLimit-Remaining` | `number` | GitHub 剩余额度（仅 upstream 携带时出现） |
| `X-Upstream-RateLimit-Reset` | `timestamp` | GitHub rate limit reset Unix 时间戳 |

> **`X-Cache` 缺失** = 请求未经过缓存层（直连 GitHub 或 route 未命中）。**`X-Upstream-*` 缺失** = 命中缓存，未请求 upstream。

### `/healthz` 响应对比

| 平台 | 响应体字段 | 示例 |
|------|-----------|------|
| Cloudflare Worker | `ok`, `service` | `{"ok":true,"service":"kirari-ghcard-cache"}` |
| Vercel Function | `ok`, `runtime` | `{"ok":true,"runtime":"vercel"}` |

> 两个平台字段名不同。编写跨平台健康检查时，仅使用 `ok` 字段作为通用判据。

## TTL 策略

| 资源 | Fresh TTL | Stale TTL | 不可缓存 |
|------|-----------|-----------|----------|
| Repo metadata | 6 h | 7 d | 403/429/5xx |
| Contents | 24 h | 14 d | 同上 |
| Latest commit | 1 h | 7 d | 同上 |
| Avatar | 7 d | 30 d | 同上 |
| 404 | 10 min | 1 d | — |

不可缓存响应（403/429/5xx）仅在已有 stale 数据时返回 stale；否则直接返回 upstream 错误。

---

## 常见操作

### 批量失效缓存

递增 `CACHE_NAMESPACE_VERSION`：

```jsonc
// wrangler.jsonc vars
"CACHE_NAMESPACE_VERSION": "v2"   // 之前是 v1
```

缓存 key 格式：`ghcard:{version}:{kind}:...`。递增后旧 key 自然过期，无需手动删除。

### 配置 Cloudflare Cron 预热

```jsonc
// wrangler.jsonc vars
"PUBLIC_BASE_URL": "https://example.com/ghc",
"PREWARM_TARGETS": "repo:saicaca/fuwari,content:saicaca/fuwari:README.md,commits:saicaca/fuwari:README.md,avatar:saicaca"
```

目标格式：

| 类型 | 格式 | 示例 |
|------|------|------|
| Repo | `repo:owner/repo` | `repo:saicaca/fuwari` |
| Contents | `content:owner/repo:path` | `content:saicaca/fuwari:README.md` |
| Commits | `commits:owner/repo:path` | `commits:saicaca/fuwari:README.md` |
| Avatar | `avatar:owner` | `avatar:saicaca` |

> Repo 预热需要 `PUBLIC_BASE_URL` — repo JSON 包含 `owner.avatar_url`，Worker 须知道用哪个公开 base 改写头像 URL。

### Prewarm URL 构造与 Fallback

预热请求内部使用 `PUBLIC_BASE_URL` 拼接 URL，路径为一个虚构的 `/prewarm-placeholder`（仅用于代码内部路由解析，不会产生实际外部请求）：

```typescript
// src/index.ts:84-87  实际代码
const baseUrl = publicBaseUrl || "https://prewarm.local/api/github";
// → `${baseUrl}/prewarm-placeholder?target=${encodeURIComponent(target)}`
```

| 场景 | 行为 |
|------|------|
| `PUBLIC_BASE_URL` 已设置 | 使用其值构造请求 URL，avatar 改写指向该 base |
| `PUBLIC_BASE_URL` 未设置 + repo 目标 | 跳过该目标，输出 `prewarm_skip` 日志 |
| `PUBLIC_BASE_URL` 未设置 + 非 repo 目标 | 使用 fallback `https://prewarm.local/api/github`（仅内部，avatar 改写不可达） |

> **Warning**：`prewarm.local` 是纯内部 fallback，不会实际发出网络请求到此域名。repo 类型的预热目标缺少 `PUBLIC_BASE_URL` 时会被跳过；非 repo 目标虽不报错，但 avatar URL 改写会指向不可达的 origin。

### 处理 GitHub 403 / Rate Limit

| 步骤 | 检查 | 修复 |
|------|------|------|
| 1 | 运行时平台是否配置了 `GITHUB_TOKEN` | Cloudflare: `pnpm wrangler secret put GITHUB_TOKEN`；Vercel: Project Env |
| 2 | 响应是否携带 `X-Upstream-RateLimit-Remaining` | 余额低时等待 reset 或添加 token |
| 3 | KIRARI card 是否生成大量随机 ref/path 请求 | 避免在 Markdown card 中使用随机 ref |
| 4 | 是否有 stale cache 可用 | Cloudflare 应返回 `X-Cache: STALE`；Vercel 仅 Runtime Cache 可用时支持 |

### 验证 Worker 私有暴露面

| 检查项 | 预期 |
|--------|------|
| `wrangler.jsonc` → `workers_dev` | `false` |
| `wrangler.jsonc` → `preview_urls` | `false` |
| 浏览器请求 URL | KIRARI 同源 `/ghc/*` |
| Worker 直接 URL | 不作为生产入口 |

### 回滚 KIRARI 到直连 GitHub

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
```

重新构建 KIRARI，materializer 删除已生成的 `/ghc` runtime route。

---

## Troubleshooting

| 现象 | 根因 | 诊断 | 修复 |
|------|------|------|------|
| 浏览器仍请求 `api.github.com` | KIRARI `apiBase` 未改为 `/ghc` | 检查 `kirari.config.toml` | 设置 `apiBase = "/ghc"` 并重新构建 |
| `/ghc/repos/...` 返回 404 | adapter route 未生成 | 检查 adapter 配置和 build log | 设置 `enabled=true`，provider 为 `cloudflare`/`vercel` |
| Cloudflare `/ghc/*` 返回 binding 错误 | Pages Service Binding 缺失或名称不一致 | Cloudflare Dashboard → Bindings | 添加名为 `GHCARD_CACHE` 的 Service Binding |
| 头像 URL 仍指向 GitHub | avatar URL 改写未生效 | 检查响应 JSON 的 `owner.avatar_url` | 确认 KIRARI 生成 route 发送了 `X-KIRARI-GHC-PUBLIC-BASE` |
| GitHub rate limit 错误 | `GITHUB_TOKEN` 缺失或无效 | 检查运行时平台 secret/env | 重新配置 token |
| GitHub Actions deploy 被跳过 | `CLOUDFLARE_ACCOUNT_ID` 或 `CLOUDFLARE_API_TOKEN` 缺失 | GitHub Repository Secrets | 添加两个 secrets |
| Vercel deploy 被跳过 | `VERCEL_TOKEN` 缺失 | GitHub Repository Secrets | 添加 `VERCEL_TOKEN` |
| Deploy 报 `KV namespace '<production-kv-id>' is not valid` | 部署前未运行 config prepare，或 API token 缺少 KV 权限 | 检查 workflow 日志和 Cloudflare API token 权限 | 确保 `CLOUDFLARE_API_TOKEN` 包含 Workers Scripts Write + Workers KV Storage Write |
| Vercel 在 GitHub 故障时无响应 | Runtime Cache 不可用 | 检查 `X-Cache` header | 需要持久 stale fallback 时改用 Cloudflare 路径 |

---

## 日志

```bash
# Cloudflare Worker 实时日志
pnpm wrangler tail

# 本地验证（部署前）
pnpm type-check && pnpm test && pnpm cf:prepare-config && pnpm cf:config-check && pnpm deploy:dry
```
