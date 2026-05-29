# 部署入口

这份文档用来决定走 Cloudflare、Vercel 还是直连 GitHub。确定平台后，再进入对应的详细部署文档。

## 平台选择

| KIRARI 托管方式 | 推荐方案 | 你会得到什么 | 详细文档 |
| --- | --- | --- | --- |
| Cloudflare Pages | 私有 Worker + Pages Service Binding | 同源 `/ghc/*`、Cache API + Workers KV、GitHub 故障时持久 stale fallback | [Cloudflare 部署](CLOUDFLARE_DEPLOYMENT.md) |
| Vercel | 同项目 Function | 同源 `/ghc/*`、HTTP cache、可选 Runtime Cache | [Vercel 部署](VERCEL_DEPLOYMENT.md) |
| 纯静态托管 | 不启用 adapter | 直连 `https://api.github.com`，无缓存代理 | [KIRARI 对接](KIRARI_INTEGRATION.md) |

Cloudflare 是生产首选，因为 KV 可以保留 stale 数据。Vercel 路径更轻，适合 KIRARI 已经部署在 Vercel 的场景。

## 请求路径

```text
KIRARI card
  -> /ghc/repos/:owner/:repo
  -> /ghc/repos/:owner/:repo/contents/:path
  -> /ghc/repos/:owner/:repo/commits?path=:path
  -> /ghc/avatar/:owner?size=96
```

Cloudflare 和 Vercel 对 KIRARI 都暴露 `/ghc/*`。内部实现不同：

| 平台 | 内部入口 |
| --- | --- |
| Cloudflare | KIRARI Pages Function 通过 Service Binding 调用 Worker `/api/github/*` |
| Vercel | `vercel.json` 把 `/ghc/*` rewrite 到 `/api/ghc/*`，Function 内部再映射到 `/api/github/*` |

## 变量归属

| 名称 | 属于 | 配置位置 | 不要配置在 |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | 缓存代理运行时 | Cloudflare Worker Secret / Vercel Environment Variables | `kirari.config.toml`、GitHub Actions YAML、仓库文件 |
| `ALLOWED_ORIGINS` | Cloudflare Worker CORS | `wrangler.jsonc` vars 或 Worker env | KIRARI 配置 |
| `GHC_ALLOWED_ORIGINS` | Vercel Function CORS | Vercel Environment Variables | Cloudflare |
| `CACHE_NAMESPACE_VERSION` | 缓存 key 版本 | Worker vars / Vercel env | KIRARI 配置 |
| `PUBLIC_BASE_URL` | Cloudflare Cron prewarm | Worker vars | KIRARI 配置 |
| `PREWARM_TARGETS` | Cloudflare Cron prewarm | Worker vars | KIRARI 配置 |
| `CLOUDFLARE_ACCOUNT_ID` | CI 部署 | GitHub Repository Secrets | Worker Secret、Vercel |
| `CLOUDFLARE_API_TOKEN` | CI 部署 | GitHub Repository Secrets | Worker Secret、Vercel |
| `VERCEL_TOKEN` | CI 部署 | GitHub Repository Secrets | Cloudflare、KIRARI |

## Token 区分

| Token | 用途 | 什么时候需要 |
| --- | --- | --- |
| `GITHUB_TOKEN` | 运行时请求 GitHub REST API，把匿名 60 req/h 提升到 token rate limit | 生产推荐 |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions / Wrangler 部署 Worker 和管理 KV namespace | Cloudflare CI 部署需要 |
| `VERCEL_TOKEN` | GitHub Actions 调用 Vercel CLI 部署 | Vercel CI 部署需要 |

`GITHUB_TOKEN` 不用于 avatar 请求。头像走 `https://github.com/:owner.png` 公开图片地址，只经过缓存代理缓存图片。

## CORS 默认行为

代码会读取 allowlist：

| 平台 | 读取变量 |
| --- | --- |
| Cloudflare | `ALLOWED_ORIGINS` |
| Vercel | `GHC_ALLOWED_ORIGINS`，未设时回退 `ALLOWED_ORIGINS` |

行为：

| 配置 | 无 `Origin` 请求 | 带 `Origin` 且命中白名单 | 带 `Origin` 且未命中 |
| --- | --- | --- | --- |
| 空 allowlist | 允许 | 不适用 | 403 |
| 非空 allowlist | 允许 | 允许并回显 `Access-Control-Allow-Origin` | 403 |

生产站点建议配置为 KIRARI 站点 origin，例如：

```text
https://blog.example.com,http://localhost:4321
```

## CI 权限

Cloudflare CI 至少需要：

| 权限 | Scope | 用途 |
| --- | --- | --- |
| Workers Scripts Write | Account | `wrangler deploy` |
| Workers KV Storage Write | Account | `pnpm cf:prepare-config` 创建或复用 `GITHUB_CACHE` |

默认私有 Service Binding 方案不需要 Worker route 或 custom domain 权限。

## 验证命令

Cloudflare:

```bash
pnpm install
pnpm cf:types
pnpm cf:prepare-config
pnpm cf:config-check
pnpm type-check
pnpm test
pnpm deploy:dry
```

Vercel:

```bash
pnpm install
pnpm type-check
pnpm test
```

部署后：

```bash
curl -i https://YOUR_SITE.example/ghc/healthz
curl -i https://YOUR_SITE.example/ghc/repos/saicaca/fuwari
curl -I https://YOUR_SITE.example/ghc/avatar/saicaca?size=96
```

`/ghc/healthz` 返回 `ok: true`，业务接口响应有 `X-Cache`，浏览器 Network 中不再直连 `api.github.com`，才算接入完成。

## 下一步

- Cloudflare 路径：[Cloudflare 部署](CLOUDFLARE_DEPLOYMENT.md)
- Vercel 路径：[Vercel 部署](VERCEL_DEPLOYMENT.md)
- KIRARI 配置：[KIRARI 对接](KIRARI_INTEGRATION.md)
- 排障与回滚：[运维指南](OPERATIONS.md)
