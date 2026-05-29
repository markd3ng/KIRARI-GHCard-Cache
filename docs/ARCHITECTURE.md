# 架构与缓存流程

本文说明 KIRARI-GHCard-Cache 的运行时结构、路由限制、缓存策略和两个平台的差异。

## 模块图

```text
Cloudflare Worker
  src/index.ts
    -> src/cors.ts
    -> src/router.ts
    -> src/cache.ts
      -> src/github.ts
      -> src/normalize.ts
      -> src/env.ts
    -> src/response.ts

Vercel Function
  api/ghc/[...path].ts
    -> src/vercel.ts
      -> src/cors.ts
      -> src/router.ts
      -> src/github.ts
      -> src/normalize.ts
      -> src/response.ts
```

Cloudflare 路径依赖 `caches.default` 和 `env.GITHUB_CACHE`。Vercel 路径不依赖 Cloudflare binding，会动态探测 `@vercel/functions` Runtime Cache，失败时回退到直接请求 GitHub。

## 路由边界

只支持 KIRARI GitHub card 需要的接口：

| Route kind | 内部路径 | 关键校验 |
| --- | --- | --- |
| `repo` | `/api/github/repos/:owner/:repo` | owner/repo 只允许 `A-Z a-z 0-9 _ . -`，最长 100 |
| `contents` | `/api/github/repos/:owner/:repo/contents/:path?ref=:ref` | path 最长 512，拒绝空 segment、`.`、`..`、控制字符、反斜杠 |
| `commits` | `/api/github/repos/:owner/:repo/commits?path=:path&per_page=1&sha=:sha` | 只允许 `path`、`per_page`、`sha`，且 `per_page` 必须是 `1` |
| `avatar` | `/api/github/avatar/:owner?size=96` | size 必须是 16-256 的整数 |

不支持的 GitHub API 会返回 404。非法入参返回 400。

## Cloudflare 数据流

```text
Request
  -> evaluateCors()
  -> method check: GET / HEAD / OPTIONS
  -> /healthz short-circuit
  -> parseRoute()
  -> handleCachedRoute()
    -> L1 caches.default.match()
    -> L2 env.GITHUB_CACHE.get()
    -> fetchGithub()
    -> normalizeUpstreamBody()
    -> env.GITHUB_CACHE.put()
    -> caches.default.put()
  -> withCors()
```

缓存命中顺序：

| 阶段 | 命中 header | 行为 |
| --- | --- | --- |
| L1 Cache API | `X-Cache: HIT-L1` | 直接返回 |
| L2 KV fresh | `X-Cache: HIT-KV` | 返回 KV 数据，并后台写入 L1 |
| L2 KV stale | `X-Cache: STALE` | 返回 stale 数据，并后台刷新 |
| 未命中 | `X-Cache: MISS` | 请求 GitHub，写入 KV 和 L1 |

GitHub 超时、403/429、5xx 或 body 过大时，如果已有 stale 数据，Cloudflare 返回 stale；否则返回错误响应。

## Vercel 数据流

```text
Request
  -> getVercelEnv()
  -> evaluateCors()
  -> method check: GET / HEAD / OPTIONS
  -> /ghc/healthz short-circuit
  -> /ghc/* -> /api/github/*
  -> parseRoute()
  -> getRuntimeCache()
  -> fetch GitHub when cache miss
  -> normalizeUpstreamBody()
  -> set Cache-Control and optional Runtime Cache
```

Vercel cache 状态：

| Header | 行为 |
| --- | --- |
| `X-Cache: HIT-RUNTIME` | Runtime Cache fresh 命中 |
| `X-Cache: STALE-RUNTIME` | Runtime Cache stale 命中 |
| `X-Cache: MISS` | 请求 GitHub upstream |

如果 Runtime Cache 不存在或不可用，Function 仍返回 `Cache-Control: public, s-maxage=..., stale-while-revalidate=...`。

## GitHub 请求

| Route kind | Upstream |
| --- | --- |
| `repo` | `https://api.github.com/repos/:owner/:repo` |
| `contents` | `https://api.github.com/repos/:owner/:repo/contents/:path` |
| `commits` | `https://api.github.com/repos/:owner/:repo/commits?path=:path&per_page=1` |
| `avatar` | `https://github.com/:owner.png?size=:size` |

REST API 请求 header：

| Header | 值 |
| --- | --- |
| `Accept` | `application/vnd.github+json` |
| `X-GitHub-Api-Version` | `2022-11-28` |
| `Authorization` | `Bearer ${GITHUB_TOKEN}`，仅 token 存在且非 avatar 时设置 |

avatar 请求不带 GitHub token，`Accept` 使用图片类型。

所有 upstream fetch 使用 8 秒超时。

## 响应归一化

`src/normalize.ts` 负责让 KIRARI 继续使用同源缓存路径。

| 资源 | 归一化 |
| --- | --- |
| repo JSON | 将 `owner.avatar_url` 改写为公开 base 下的 `/avatar/:owner?size=96` |
| contents JSON | 保持 GitHub body，按 UTF-8 缓存 |
| commits JSON | 保持 GitHub body，按 UTF-8 缓存 |
| avatar 图片 | 以 base64 存入缓存 envelope，返回时解码成二进制 |

Cloudflare 的公开 base 优先级：

1. `X-KIRARI-GHC-PUBLIC-BASE` request header
2. `PUBLIC_BASE_URL` env
3. 当前 request origin + `/api/github`

Vercel 使用当前 request origin + `/ghc`。

## TTL 策略

| Status | Route kind | Fresh TTL | Stale TTL | Cacheable |
| --- | --- | --- | --- | --- |
| `200` | `repo` | 6 h | 7 d | 是 |
| `200` | `contents` | 24 h | 14 d | 是 |
| `200` | `commits` | 1 h | 7 d | 是 |
| `200` | `avatar` | 7 d | 30 d | 是 |
| `404` | any | 10 min | 1 d | 是 |
| `403` / `429` / `5xx` | any | 0 | 0 | 否 |

不可缓存响应不会写入缓存。若已有 stale envelope，则优先返回 stale。

## Cache Key

格式：

```text
ghcard:{CACHE_NAMESPACE_VERSION}:{kind}:{owner}:{repo}:{path/ref/sha/size}
```

示例：

| 请求 | Cache key |
| --- | --- |
| `/api/github/repos/saicaca/fuwari` | `ghcard:v1:repo:saicaca:fuwari` |
| `/api/github/repos/saicaca/fuwari/contents/README.md?ref=main` | `ghcard:v1:contents:saicaca:fuwari:README.md:main` |
| `/api/github/repos/saicaca/fuwari/commits?path=README.md&sha=main` | `ghcard:v1:commits:saicaca:fuwari:README.md:main` |
| `/api/github/avatar/saicaca?size=96` | `ghcard:v1:avatar:saicaca:96` |

递增 `CACHE_NAMESPACE_VERSION` 会让新请求使用新 key。旧 key 不主动删除，会自然过期。

## Body 大小限制

| 类型 | 上限 | 超限行为 |
| --- | --- | --- |
| JSON | 1 MB | 抛出异常，优先返回 stale，否则 504 |
| Avatar | 512 KB | 抛出异常，优先返回 stale，否则 504 |

这些限制低于 Workers KV 单值上限，目的是避免缓存异常大的 GitHub 响应。

## Cloudflare Cron 预热

`wrangler.jsonc` 中配置：

```jsonc
"triggers": {
  "crons": ["17 */6 * * *"]
}
```

Worker 每 6 小时读取 `PREWARM_TARGETS`，最多处理 50 个 target。

| Target | 示例 |
| --- | --- |
| `repo:owner/repo` | `repo:saicaca/fuwari` |
| `content:owner/repo:path` | `content:saicaca/fuwari:README.md` |
| `commits:owner/repo:path` | `commits:saicaca/fuwari:README.md` |
| `avatar:owner` | `avatar:saicaca` |

repo 预热必须配置 `PUBLIC_BASE_URL`，否则 Worker 无法正确改写 repo JSON 中的头像 URL，会跳过该 target 并输出 `prewarm_skip` 日志。

## 错误响应

| 场景 | 状态 | message |
| --- | --- | --- |
| CORS Origin 不允许 | 403 | `Origin is not allowed...` |
| Method 不支持 | 405 | `Only GET, HEAD, and OPTIONS are supported.` |
| 不支持的 endpoint | 404 | `Unsupported endpoint.` 或 `Unsupported GitHub cache endpoint.` |
| 非法 path/ref/size | 400 | 对应校验错误 |
| GitHub rate limit 且无 stale | 403 / 429 | `GitHub rate limit or access restriction...` |
| GitHub 5xx 且无 stale | 502 | `GitHub upstream returned a temporary error...` |
| GitHub 超时且无 stale | 504 | `GitHub upstream did not respond...` |

## 相关文档

- [部署入口](DEPLOYMENT.md)
- [Cloudflare 部署](CLOUDFLARE_DEPLOYMENT.md)
- [Vercel 部署](VERCEL_DEPLOYMENT.md)
- [运维指南](OPERATIONS.md)
