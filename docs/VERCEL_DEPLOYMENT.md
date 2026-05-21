# Vercel 免费版部署

Vercel 路径是轻量同源代理方案。默认不使用 Cloudflare Worker Secret、Cloudflare KV、Vercel KV、Upstash、Supabase、Firewall、Deployment Protection 或任何付费 add-on。

## 选择 Vercel 模式

| 模式 | `/ghc/*` 位于哪里 | 浏览器看到的路径 | 适合场景 |
|------|-------------------|------------------|----------|
| KIRARI 同项目 adapter | KIRARI Vercel 项目构建时生成 `api/ghc/[...path].ts` | KIRARI 同源 `/ghc/*` | KIRARI 生产部署在 Vercel |
| GHC 独立 Vercel 项目 | 本仓库作为单独 Vercel 项目导入 | 独立 GHC Vercel 项目的 `/ghc/*` URL | 测试或非 KIRARI 集成 |

如果 KIRARI 本身部署在 Vercel，生产更推荐同项目 adapter，因为浏览器不需要访问单独的 GHC 业务域名。

## 请求链路

KIRARI 同项目 adapter：

```text
Browser
  -> KIRARI Vercel /ghc/*
    -> KIRARI 同项目 Vercel Function
      -> GitHub API
```

GHC 独立 Vercel 项目：

```text
Browser or KIRARI
  -> standalone GHC Vercel project /ghc/*
    -> Vercel Function
      -> GitHub API
```

## 独立项目部署

使用 README 顶部的 Deploy with Vercel 按钮，或手动把本仓库导入 Vercel。

`vercel.json` 定义了这些 rewrite：

| Source | Destination |
|--------|-------------|
| `/ghc` | `/api/ghc/healthz` |
| `/ghc/:path*` | `/api/ghc/:path*` |

Function 入口：

```text
api/ghc/[...path].ts
```

## GitHub Actions 部署

仓库包含 `Deploy Vercel` workflow。配置 GitHub Repository Secrets 后，push 到 `main` 或手动触发 workflow 即可部署。

| Secret | 是否必需 | 用途 |
|--------|----------|------|
| `VERCEL_TOKEN` | 需要 | 允许 GitHub Actions 调用 Vercel CLI 部署 |
| `VERCEL_ORG_ID` | 可选 | 指定已有 Vercel team/user scope |
| `VERCEL_PROJECT_ID` | 可选 | 指定已有 Vercel project |

未配置 `VERCEL_TOKEN` 时，workflow 仍会执行 install、type-check 和 test，然后跳过 deploy。

## 环境变量

在这里配置：

```text
Vercel Project
-> Settings
-> Environment Variables
```

| 变量 | 是否必需 | 示例 | 用途 |
|------|----------|------|------|
| `GITHUB_TOKEN` | 非必需，生产推荐 | `github_pat_...` | Function 请求 GitHub REST API 时使用 |
| `GHC_ALLOWED_ORIGINS` | 非必需 | `https://example.com,http://localhost:4321` | Vercel 专用浏览器 Origin 白名单 |
| `ALLOWED_ORIGINS` | 非必需 | `https://example.com` | `GHC_ALLOWED_ORIGINS` 未设置时的回退白名单 |
| `CACHE_NAMESPACE_VERSION` | 非必需 | `v1` | Runtime Cache 可用时使用的缓存 key 版本 |

不要把这些 Vercel 运行时变量配置到 Cloudflare Worker Secret 或 GitHub Actions YAML。

## KIRARI 同项目配置

KIRARI 配置：

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "vercel"
route = "/ghc"
```

启用后，KIRARI 会在构建前生成：

```text
api/ghc/[...path].ts
```

关闭 adapter 后，KIRARI 会移除生成的 `/ghc` runtime route，并回退到 `https://api.github.com`。

## 缓存行为

Vercel 默认使用 HTTP `Cache-Control`：

| 资源 | `s-maxage` | `stale-while-revalidate` |
|------|------------|--------------------------|
| Repo metadata | 6 hours | 7 days |
| Contents metadata | 24 hours | 14 days |
| Latest commit by path | 1 hour | 7 days |
| Avatar | 7 days | 30 days |

如果运行环境提供 `@vercel/functions` Runtime Cache，handler 会自动尝试使用。若包不可用或 Runtime Cache 不可用，会回退到直接 upstream 请求和 HTTP cache headers。

这条路径弱于 Cloudflare KV 路径。如果需要 GitHub 故障期间仍有持久 stale fallback，使用 Cloudflare 部署。

## 验证

| 检查项 | 预期 |
|--------|------|
| `/ghc/healthz` | 返回 health JSON |
| `/ghc/repos/saicaca/fuwari` | 返回 repo JSON |
| `/ghc/avatar/saicaca?size=96` | 返回图片响应 |
| Browser Network | 请求停留在 `/ghc/*` |
| Browser Network | card 请求不直连 `api.github.com` |
| 响应 header | 存在 `X-Cache` |

## 免费版边界

| 功能 | 默认 Vercel 路径 |
|------|------------------|
| Vercel KV | 不使用 |
| Upstash | 不使用 |
| Supabase | 不使用 |
| Vercel Firewall | 不使用 |
| Deployment Protection | 不使用 |
| Custom domain | 不需要 |
| KV 级别持久 stale cache | 不保证 |

## 官方参考

| 主题 | 官方文档 |
|------|----------|
| Deploy with Vercel 按钮格式 | [Vercel Deploy Button](https://vercel.com/docs/deployments/deploy-button) |
| `vercel.json` rewrites | [Vercel rewrites](https://vercel.com/docs/routing/rewrites) |
