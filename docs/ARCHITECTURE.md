# 架构与缓存流程

## 模块依赖图

```
                           ┌─────────────┐
                           │  src/index   │  Worker 入口：fetch + scheduled
                           │  (Cloudflare)│
                           └──────┬──────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
               ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
               │  cors   │  │  cache  │  │ router  │
               │(.ts)    │  │ (.ts)   │  │ (.ts)   │
               └─────────┘  └──┬──┬───┘  └─────────┘
                               │  │
                    ┌──────────┘  └──────────┐
                    │                        │
               ┌────▼────┐             ┌─────▼──────┐
               │ github  │             │  normalize  │
               │ (.ts)   │             │  (.ts)      │
               └─────────┘             └────────────┘
                    │
               ┌────▼────┐
               │  env    │
               │ (.ts)   │
               └─────────┘

┌──────────────┐
│  src/vercel  │  Vercel 入口（api/ghc/[...path].ts 引入）
│  (.ts)       │  独立模块，无 Cloudflare 依赖
│              │  重复 cache.ts 的 TTL/encode 逻辑
└──────┬───────┘
       │
  ┌────▼────┐
  │  cors   │
  │ github  │  ← 复用 src/ 模块
  │ router  │
  └─────────┘
```

## 数据流

### Cloudflare Worker 路径

```
Browser
  │  GET /ghc/repos/owner/repo
  ▼
KIRARI Cloudflare Pages
  │  Pages Function 通过 Service Binding 转发
  ▼
┌─────────────────────────────────────────────────────┐
│  Worker (src/index.ts → cache.ts)                    │
│                                                      │
│  1. evaluateCors()                                   │
│     └─ ALLOWED_ORIGINS 为空 → Access-Control-Allow-Origin: *       │
│     └─ Origin 在白名单内 → 回显特定 Origin                      │
│     └─ 拒绝 → 403                                     │
│                                                      │
│  2. parseRoute(url)                                  │
│     └─ 无效路径 → 400 + { error, message }             │
│     └─ 路径遍历 / 非法字符 → 400                       │
│                                                      │
│  3. handleCachedRoute()                              │
│     ├─ L1: caches.default.match(l1Request)           │
│     │  └─ 命中 → X-Cache: HIT-L1 → return            │
│     ├─ L2: env.GITHUB_CACHE.get(cacheKey)            │
│     │  ├─ 有效 (freshUntil > now)                     │
│     │  │  └─ X-Cache: HIT-KV → async L1 写入 → return │
│     │  ├─ 过期但在 stale 窗口内 (staleUntil > now)     │
│     │  │  └─ X-Cache: STALE → ctx.waitUntil(refresh) │
│     │  │  └─ 返回 stale 数据                           │
│     │  └─ 未命中 → refreshCache()                     │
│     └─ refreshCache()                                │
│        ├─ fetchGithub() → GitHub REST API            │
│        │  ├─ 超时 8s (AbortSignal.timeout)            │
│        │  ├─ 无 token → 60 req/h                     │
│        │  └─ 有 token → 5,000 req/h                  │
│        ├─ normalizeUpstreamBody()                    │
│        │  └─ repo JSON: owner.avatar_url 改写为      │
│        │    /api/github/avatar/{owner}?size=96       │
│        ├─ getTtlPolicy(route, status)                 │
│        ├─ upstreamToEnvelope()                        │
│        │  └─ body encoding: JSON → utf-8, 图片 → base64│
│        └─ putL1 + GITHUB_CACHE.put() → return         │
│                                                      │
│  4. withCors(response) → return                      │
└─────────────────────────────────────────────────────┘
```

### Vercel Function 路径

```
Browser
  │  GET /ghc/repos/owner/repo
  ▼
KIRARI Vercel (or standalone GHC project)
  │  vercel.json rewrite: /ghc/* → /api/ghc/*
  ▼
┌──────────────────────────────────────────────────────┐
│  Function (api/ghc/[...path].ts → src/vercel.ts)      │
│                                                       │
│  1. getVercelEnv() → process.env 读取                  │
│     └─ GHC_ALLOWED_ORIGINS || ALLOWED_ORIGINS          │
│                                                       │
│  2. URL 重写：/ghc/* → /api/github/*                   │
│                                                       │
│  3. evaluateCors() + parseRoute()                     │
│                                                       │
│  4. Runtime Cache 探测                                  │
│     ├─ getRuntimeCache() → import(@vercel/functions)   │
│     │  └─ 可用 → cache.get(key)                        │
│     │  │  ├─ 命中 → X-Cache: HIT-RUNTIME → return     │
│     │  │  └─ 未命中 → fetch → cache.set() → return    │
│     │  └─ 不可用 → 直接 fetch（仅 HTTP Cache）            │
│     └─ 包缺失或异常 → 静默回退                            │
│                                                       │
│  5. 响应设置 Cache-Control: s-maxage=N,                │
│      stale-while-revalidate=M                          │
└──────────────────────────────────────────────────────┘
```

## 缓存层对比

| 维度 | Cloudflare L1 (Cache API) | Cloudflare L2 (KV) | Vercel Runtime Cache |
|------|--------------------------|-------------------|---------------------|
| 存储位置 | Worker 内存/边缘节点 | 全球 KV 持久存储 | Vercel Edge Network |
| 读延迟 | <5ms | ~50ms | 同区域 <10ms |
| 过期后 | 立即清除，无 stale | 可配置 stale 窗口 | 取决于 `stale-while-revalidate` |
| 持久性 | 进程级，不保证 | 持久化，跨版本 | 不保证（archived 48h idle） |
| 写入策略 | 同步 + 后台写入 | `ctx.waitUntil` | 同步 |
| 免费层限制 | 无单独限制 | 100k 读/天，1k 写/天 | Hobby: 最大 10s 执行时间 |
| KV 值上限 | 25 MiB | 25 MiB | — |
| KV key 上限 | — | 512 B | — |

## TTL 策略

```typescript
// src/cache.ts 实现
getTtlPolicy(route, status): { freshTtl, staleTtl, cacheable }
```

| status | route kind | freshTtl | staleTtl | cacheable |
|--------|-----------|----------|----------|-----------|
| 200 | repo | 6 h (21600s) | 7 d (604800s) | ✅ |
| 200 | contents | 24 h (86400s) | 14 d (1209600s) | ✅ |
| 200 | commits | 1 h (3600s) | 7 d (604800s) | ✅ |
| 200 | avatar | 7 d (604800s) | 30 d (2592000s) | ✅ |
| 404 | any | 10 min (600s) | 1 d (86400s) | ✅ |
| 403/429/5xx | any | 0 | 0 | ❌ |

> **不可缓存响应**仅在已有 stale 数据时返回 stale；否则直接返回 upstream 错误。

## Cache Key 格式

```
ghcard:{CACHE_NAMESPACE_VERSION}:{kind}:{owner}:{repo}:{optional}:{ref|sha|size}
```

示例：

| Route | Cache Key |
|-------|-----------|
| `repo:saicaca/fuwari` | `ghcard:v1:repo:saicaca:fuwari` |
| `contents:saicaca/fuwari:README.md?ref=main` | `ghcard:v1:contents:saicaca:fuwari:README.md:main` |
| `commits:saicaca/fuwari:README.md?sha=abc` | `ghcard:v1:commits:saicaca/fuwari:README.md:abc` |
| `avatar:saicaca?size=96` | `ghcard:v1:avatar:saicaca:96` |

递增 `CACHE_NAMESPACE_VERSION` 使所有旧 key 自然过期（不主动删除）。

## 错误处理策略

| 故障场景 | Cloudflare | Vercel |
|----------|-----------|--------|
| GitHub 超时 (8s) | 返回 stale（如有）或 504 | 返回 stale（Runtime Cache 有数据时）或 504 |
| GitHub 403/429 | 返回 403（无 stale 时） | 同左 |
| GitHub 5xx | 返回 502（无 stale 时） | 同左 |
| KV 写入失败 | catch 静默，仅丢失该次缓存 | N/A |
| KV 读取失败 | 回退直连 GitHub | N/A |
| 入参校验失败 | 400 + JSON error | 同左 |
| 路径遍历攻击 | 400，拒绝 `..`、控制字符、空 segment | 同左 |

## Cron 预热

```typescript
// src/index.ts
scheduled(controller, env, ctx) {
  ctx.waitUntil(prewarmTargets(env, ctx));
}
```

- **频率**：每 6 小时（`17 */6 * * *`）
- **上限**：每次最多 50 个 target
- **repo 目标**需要 `PUBLIC_BASE_URL`（用于 avatar URL 改写）
- **不等待**所有预热完成（`ctx.waitUntil`，不阻塞响应）

目标格式：

| 类型 | 格式 | 示例 |
|------|------|------|
| Repo | `repo:owner/repo` | `repo:saicaca/fuwari` |
| Contents | `content:owner/repo:path` | `content:saicaca/fuwari:README.md` |
| Commits | `commits:owner/repo:path` | `commits:saicaca/fuwari:README.md` |
| Avatar | `avatar:owner` | `avatar:saicaca` |

## 关键限制（免费层）

### Cloudflare Workers KV
- 读：100,000 次/天
- 写（不同 key）：1,000 次/天
- 写（同 key）：1 次/秒
- 存储：1 GB / account
- 值上限：25 MiB
- key 上限：512 B

### Vercel Hobby
- Function 最大执行时间：300s（默认 10s）
- 并发：30,000
- 每个 deployment Function 数：12（非框架模式）
- VM 临时存储 (`/tmp`)：500 MB
- 无 Vercel KV / Upstash / Supabase 依赖

### 应用层 body 大小限制

| 资源类型 | 上限 | 超限行为 |
|---------|------|---------|
| JSON（repo/contents/commits） | 1 MB（`MAX_JSON_BYTES`） | 抛出异常 → 返回 stale 或 504 |
| 图片（avatar） | 512 KB（`MAX_AVATAR_BYTES`） | 同上 |

> 此限制远低于 Workers KV 的 25 MiB 值上限，旨在避免缓存超大响应。GitHub 返回的 body 超过限制时，`refreshCache` 的 `catch` 捕获异常后优先返回 stale 数据，错误日志不区分「超时」与「body 过大」。

---

**相关文档**：[运维指南](OPERATIONS.md) | [Cloudflare 部署](CLOUDFLARE_DEPLOYMENT.md) | [Vercel 部署](VERCEL_DEPLOYMENT.md)
