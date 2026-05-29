# KIRARI 对接

KIRARI-GHCard-Cache 与 KIRARI 是两个独立仓库。KIRARI 通过 `githubCard` 配置决定是否生成 `/ghc` runtime route，并把 GitHub card 请求导向缓存代理。

## 三种模式

| 模式 | `githubCard.apiBase` | adapter | 生成文件 | 请求目标 |
| --- | --- | --- | --- | --- |
| 直连 GitHub | `https://api.github.com` | `enabled = false` | 不生成 | GitHub REST API |
| Cloudflare 缓存 | `/ghc` | `provider = "cloudflare"` | `functions/ghc/[[path]].ts` | Pages Service Binding -> Worker |
| Vercel 缓存 | `/ghc` | `provider = "vercel"` | `api/ghc/[...path].ts` | Vercel Function |

`route` 默认是 `/ghc`。adapter 关闭时，`route` 和 `serviceBinding` 不参与运行。

## 配置归属

| 配置或 Secret | 放在 | 不放在 |
| --- | --- | --- |
| `githubCard.apiBase` | KIRARI `kirari.config.toml` | 缓存仓库 |
| `githubCard.adapter.*` | KIRARI `kirari.config.toml` | 缓存仓库 |
| `GITHUB_TOKEN` | 缓存运行时：Worker Secret 或 Vercel Env | KIRARI 配置 |
| `CLOUDFLARE_API_TOKEN` | GHC 仓库 GitHub Secrets | KIRARI runtime |
| `VERCEL_TOKEN` | GHC 或 KIRARI 仓库 GitHub Secrets | Vercel runtime |

## 直连模式

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
route = "/ghc"
serviceBinding = "GHCARD_CACHE"
```

行为：

| 项目 | 结果 |
| --- | --- |
| Runtime route | 不生成 |
| 缓存 | 无 |
| Rate limit | GitHub 匿名 60 req/h，除非 KIRARI 自己另有实现 |
| 适合 | 临时回滚、静态环境、调试 |

## Cloudflare Pages 模式

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare"
route = "/ghc"
serviceBinding = "GHCARD_CACHE"
```

请求链路：

```text
Browser
  -> KIRARI Pages /ghc/repos/owner/repo
  -> functions/ghc/[[path]].ts
  -> env.GHCARD_CACHE.fetch(...)
  -> kirari-ghcard-cache Worker /api/github/repos/owner/repo
  -> GitHub
```

Cloudflare Dashboard 需要给 KIRARI Pages 项目添加：

| 字段 | 值 |
| --- | --- |
| Binding type | Service binding |
| Variable name | `GHCARD_CACHE` |
| Service | `kirari-ghcard-cache` |

生成的 Pages Function 会发送 `X-KIRARI-GHC-PUBLIC-BASE` header。Worker 读取该值后，把 repo JSON 里的 `owner.avatar_url` 改写为 KIRARI 同源头像路径。

Worker 解析公开 base 的优先级：

| 优先级 | 来源 | 使用场景 |
| --- | --- | --- |
| 1 | `X-KIRARI-GHC-PUBLIC-BASE` header | KIRARI Pages Service Binding 正常请求 |
| 2 | `PUBLIC_BASE_URL` env | Cloudflare Cron prewarm |
| 3 | `request.url` origin + `/api/github` | 兜底 |

## Vercel 模式

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "vercel"
route = "/ghc"
```

请求链路：

```text
Browser
  -> KIRARI Vercel /ghc/repos/owner/repo
  -> api/ghc/[...path].ts
  -> src/vercel.ts
  -> GitHub
```

Vercel 路径固定使用当前请求 origin + `/ghc` 改写 avatar URL，不读取 `X-KIRARI-GHC-PUBLIC-BASE`。

## CORS

同源 KIRARI 请求通常不会带跨站 CORS 压力，但浏览器、预览域或独立缓存项目会遇到 allowlist。

| 平台 | 变量 |
| --- | --- |
| Cloudflare | `ALLOWED_ORIGINS=https://your-kirari.example` |
| Vercel | `GHC_ALLOWED_ORIGINS=https://your-kirari.example` |

留空时，无 `Origin` 的服务端或同源请求允许；带 `Origin` 的浏览器跨站请求返回 403。

## 验收清单

KIRARI 构建后：

| 检查 | Cloudflare | Vercel |
| --- | --- | --- |
| Generated route | `functions/ghc/[[path]].ts` | `api/ghc/[...path].ts` |
| KIRARI config | `apiBase = "/ghc"` | `apiBase = "/ghc"` |
| provider | `cloudflare` | `vercel` |
| Service Binding | `GHCARD_CACHE` | 不需要 |

浏览器中：

| 检查 | 预期 |
| --- | --- |
| `::github{repo="owner/repo"}` | card 正常渲染 |
| `::githubfile{repo="owner/repo" file="README.md"}` | file card 正常渲染 |
| Network | 请求走 `/ghc/repos/...`、`/ghc/avatar/...` |
| Network | 没有直连 `api.github.com` 或 `github.com/*.png` |
| Response headers | 有 `X-Cache` |

KIRARI 验证命令：

```bash
pnpm type-check
pnpm astro check
pnpm build
```

## 回滚

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
```

重新构建 KIRARI。materializer 应删除已生成的 `/ghc` runtime route。回滚后浏览器 Network 会重新出现 `api.github.com` 请求，这是预期行为。

## KIRARI 涉及文件

| 文件 | 作用 |
| --- | --- |
| `kirari.config.toml` | 用户配置入口 |
| `src/utils/config-loader.ts` | 解析 `githubCard` 配置 |
| `src/types/config.ts` | 配置类型 |
| `scripts/materialize-ghc-adapter.mjs` | 构建前创建或删除 runtime route |
| `adapters/github-card/cloudflare/route.ts.template` | Cloudflare Pages Function 模板 |
| `adapters/github-card/vercel/route.ts.template` | Vercel Function 模板 |
| `src/plugins/rehype-component-github-card.mjs` | repo card 使用 `githubCard.apiBase` |
| `src/plugins/rehype-component-github-file-card.mjs` | file card 使用 `githubCard.apiBase` |
