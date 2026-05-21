# KIRARI 对接

KIRARI 与 KIRARI-GHCard-Cache 独立仓库，无需 monorepo。KIRARI 通过 adapter 模式选择缓存路径。

## 三种对接模式

| 模式 | KIRARI `apiBase` | adapter 状态 | 生成 route | 缓存服务 |
|------|-----------------|-------------|-----------|----------|
| 直连 GitHub | `https://api.github.com` | `enabled=false` | 不生成 | 无 |
| Cloudflare 缓存 | `/ghc` | `provider=cloudflare` | `functions/ghc/[[path]].ts` | Service Binding → 私有 Worker |
| Vercel 缓存 | `/ghc` | `provider=vercel` | `api/ghc/[...path].ts` | 同项目 Vercel Function |

> **直连模式**下 KIRARI card 直接调用 GitHub REST API（60 req/h 匿名限制）。adapter 禁用时 `route` / `serviceBinding` 配置被忽略。

## 配置归属表

| 配置项 | 配在 | 不配在 |
|--------|------|--------|
| `githubCard.apiBase` | KIRARI `kirari.config.toml` | 缓存仓库 |
| `githubCard.adapter.enabled` | KIRARI `kirari.config.toml` | 缓存仓库 |
| `githubCard.adapter.provider` | KIRARI `kirari.config.toml` | 缓存仓库 |
| `githubCard.adapter.serviceBinding` | KIRARI `kirari.config.toml` | 缓存仓库 |
| 缓存用 `GITHUB_TOKEN` | Cloudflare Worker Secret / Vercel Env | KIRARI `kirari.config.toml` |
| `CLOUDFLARE_API_TOKEN` / `_ACCOUNT_ID` | GHC 仓库 GitHub Repository Secrets | KIRARI 项目 |

## 默认配置（直连）

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
route = "/ghc"
serviceBinding = "GHCARD_CACHE"
```

行为：不生成 runtime route，card API 直连 `https://api.github.com`。KIRARI 无需 token，无需运行时平台。

## Cloudflare Pages 对接

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare"
route = "/ghc"
serviceBinding = "GHCARD_CACHE"
```

```
请求链路：
Browser → KIRARI Pages /ghc/*
  → generated functions/ghc/[[path]].ts
    → Service Binding GHCARD_CACHE
      → kirari-ghcard-cache Worker /api/github/*
        → GitHub API
```

**Service Binding 配置**（Cloudflare Dashboard）：

| 字段 | 值 |
|------|----|
| Type | Service binding |
| Variable name | `GHCARD_CACHE` |
| Service | `kirari-ghcard-cache` |

生成的 Pages Function 发送 `X-KIRARI-GHC-PUBLIC-BASE` header，值为 KIRARI 的 `githubCard.route`（`/ghc`），告知 Worker 使用同源路径改写 avatar URL。

Worker 端 `publicBaseUrl` 三级解析优先级：

1. **`X-KIRARI-GHC-PUBLIC-BASE` header** — Cloudflare Service Binding 模式由 KIRARI Pages Function 自动注入
2. **`PUBLIC_BASE_URL` 环境变量** — `wrangler.jsonc` vars 配置，用于 Cron prewarm 等无 header 场景
3. **`request.url` 的 origin + `/api/github`** — 兜底 fallback（`new URL(request.url).origin`）

> Vercel 路径硬编码使用 `{request.origin}/ghc`，不读取此 header。

**Token 归属**：
| Token | 位置 |
|-------|------|
| `GITHUB_TOKEN` | GHC Worker Secret（`pnpm wrangler secret put`） |
| `CLOUDFLARE_API_TOKEN` | GHC 仓库 GitHub Secret（仅 CI） |
| `CLOUDFLARE_ACCOUNT_ID` | GHC 仓库 GitHub Secret（仅 CI） |

KIRARI 本身**不需要**任何 token。

## Vercel 同项目对接

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "vercel"
route = "/ghc"
```

```
请求链路：
Browser → KIRARI Vercel /ghc/*
  → generated api/ghc/[...path].ts
    → GitHub API
```

**Token 归属**：
| Token | 位置 |
|-------|------|
| `GITHUB_TOKEN` | KIRARI Vercel Project Environment Variables |
| `CLOUDFLARE_API_TOKEN` | 不使用 |
| `CLOUDFLARE_ACCOUNT_ID` | 不使用 |

Vercel 路径默认使用 HTTP cache headers，不依赖 Vercel KV / Upstash / Supabase / Firewall / Deployment Protection / custom domain。

## 回滚到直连

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
```

重新构建 KIRARI。materializer 自动删除已生成的 `/ghc` runtime route。

## KIRARI 涉及文件

| 文件 | 用途 |
|------|------|
| `kirari.config.toml` | 用户配置入口 |
| `src/utils/config-loader.ts` | 解析 `githubCard` 配置 |
| `src/types/config.ts` | 配置类型定义 |
| `scripts/materialize-ghc-adapter.mjs` | 构建前创建/删除 runtime route |
| `adapters/github-card/cloudflare/route.ts.template` | Cloudflare Pages Function 模板 |
| `adapters/github-card/vercel/route.ts.template` | Vercel Function 模板 |
| `src/plugins/rehype-component-github-card.mjs` | Repo card 使用 `githubCard.apiBase` |
| `src/plugins/rehype-component-github-file-card.mjs` | File card 使用 `githubCard.apiBase` |

## 验收清单

| 检查项 | 预期 |
|--------|------|
| KIRARI adapter 关闭 | 不生成 `functions/ghc` 或 `api/ghc` |
| KIRARI Cloudflare 构建 | 生成 `functions/ghc/[[path]].ts` |
| KIRARI Vercel 构建 | 生成 `api/ghc/[...path].ts` |
| `::github{repo="owner/repo"}` | card 正常渲染 |
| `::githubfile{repo="owner/repo" file="README.md"}` | file card 正常渲染 |
| Browser Network | 请求走 `/ghc/repos/...` |
| Browser Network | 头像请求走 `/ghc/avatar/...` |
| Browser Network | 无 `api.github.com` 请求 |
| 响应 header | 存在 `X-Cache` |

验证命令：

```bash
pnpm type-check
pnpm astro check
pnpm build
```
