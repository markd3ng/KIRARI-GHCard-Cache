# Vercel 部署

Vercel 路径提供轻量同源代理：`/ghc/*` rewrite 到 Vercel Function，Function 请求 GitHub 并设置 HTTP cache headers。如果 `@vercel/functions` 的 Runtime Cache 在运行时可用，代码会自动启用；不可用时静默回退到纯 HTTP cache。

## 部署模式

| 模式 | `/ghc/*` 在哪里 | 适合 |
| --- | --- | --- |
| KIRARI 同项目 Function | KIRARI Vercel 项目内 | KIRARI 本身部署在 Vercel，推荐 |
| 独立 Vercel 项目 | 本仓库单独导入 Vercel | 测试、预览或给非同项目站点调用 |

Cloudflare 的 KV stale fallback 在 Vercel 路径不存在。需要 GitHub 故障期间仍稳定返回旧数据时，选 Cloudflare。

## 请求链路

同项目：

```text
Browser
  -> KIRARI Vercel /ghc/*
  -> generated api/ghc/[...path].ts
  -> src/vercel.ts
  -> GitHub REST API / github.com avatar
```

独立项目：

```text
Browser
  -> https://YOUR_GHC_PROJECT.vercel.app/ghc/*
  -> api/ghc/[...path].ts
  -> src/vercel.ts
  -> GitHub
```

## 1. 本地检查

```bash
pnpm install
pnpm type-check
pnpm test
```

Vercel 不需要 `wrangler.jsonc`、KV namespace、Cloudflare Account ID 或 Cloudflare API token。

## 2. 确认 rewrite

本仓库的 `vercel.json` 已配置：

```json
{
  "rewrites": [
    {
      "source": "/ghc",
      "destination": "/api/ghc/healthz"
    },
    {
      "source": "/ghc/:path*",
      "destination": "/api/ghc/:path*"
    }
  ]
}
```

Function 入口：

```typescript
import { handleVercelRequest } from "../../src/vercel";

export default {
  fetch: handleVercelRequest,
};
```

## 3. 配置环境变量

Vercel Project -> Settings -> Environment Variables：

| 变量 | 必需 | 示例 | 说明 |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | 推荐 | `github_pat_...` | repo、contents、commits 请求使用 |
| `GHC_ALLOWED_ORIGINS` | 生产推荐 | `https://blog.example.com,http://localhost:4321` | CORS 白名单 |
| `ALLOWED_ORIGINS` | 否 | `https://blog.example.com` | `GHC_ALLOWED_ORIGINS` 未设时回退 |
| `CACHE_NAMESPACE_VERSION` | 否 | `v2` | Runtime Cache key 版本 |

`GITHUB_TOKEN` 是运行时变量，不是 `VERCEL_TOKEN`。前者给 Function 请求 GitHub，后者给 CI 部署 Vercel。

## 4. 独立项目部署

可以使用 README 顶部的 Deploy with Vercel 按钮，也可以手动导入本仓库。

导入时保留：

| Vercel 设置 | 值 |
| --- | --- |
| Framework Preset | Other / None |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm type-check` |

部署成功后测试：

```bash
curl -i https://YOUR_GHC_PROJECT.vercel.app/ghc/healthz
curl -i https://YOUR_GHC_PROJECT.vercel.app/ghc/repos/saicaca/fuwari
```

## 5. GitHub Actions 部署

`.github/workflows/deploy-vercel.yml` 会在 push 到 `main` 或手动触发时执行。

GitHub Repository Secrets：

| Secret | 必需 | 用途 |
| --- | --- | --- |
| `VERCEL_TOKEN` | 是 | `pnpm dlx vercel@latest deploy --prod --yes` |
| `VERCEL_ORG_ID` | 可选 | 指定 team/user scope |
| `VERCEL_PROJECT_ID` | 可选 | 指定 project |

缺少 `VERCEL_TOKEN` 时 workflow 会完成 install、type-check、test，然后跳过部署。

## 6. KIRARI 同项目配置

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "vercel"
route = "/ghc"
```

KIRARI 构建时应生成 `api/ghc/[...path].ts`。关闭 adapter 后，materializer 会移除该 route，KIRARI 回到直连 GitHub。

## 缓存行为

| 资源 | `s-maxage` | `stale-while-revalidate` |
| --- | --- | --- |
| Repo metadata | 6 h | 7 d |
| Contents | 24 h | 14 d |
| Latest commit | 1 h | 7 d |
| Avatar | 7 d | 30 d |
| 404 | 10 min | 1 d |

响应 header：

| Header | 含义 |
| --- | --- |
| `X-Cache: MISS` | 本次请求访问 GitHub upstream |
| `X-Cache: HIT-RUNTIME` | Runtime Cache fresh 命中 |
| `X-Cache: STALE-RUNTIME` | Runtime Cache stale 命中 |
| `Cache-Control` | 供 Vercel/CDN 使用的 `s-maxage` 和 `stale-while-revalidate` |

如果 Runtime Cache 不可用，`X-Cache` 通常是 `MISS`，但响应仍会带 HTTP cache headers。

## 验证

```bash
curl -i https://YOUR_KIRARI_SITE/ghc/healthz
curl -i https://YOUR_KIRARI_SITE/ghc/repos/saicaca/fuwari
curl -I https://YOUR_KIRARI_SITE/ghc/avatar/saicaca?size=96
```

预期：

| 检查 | 结果 |
| --- | --- |
| `/ghc/healthz` | `{"ok":true,"runtime":"vercel"}` |
| repo JSON | `owner.avatar_url` 指向同源 `/ghc/avatar/...` |
| 业务响应 | 有 `X-Cache` 和 `Cache-Control` |
| 浏览器 Network | KIRARI card 请求走 `/ghc/*` |

## 常见失败

| 现象 | 原因 | 修复 |
| --- | --- | --- |
| `/ghc/*` 返回 404 | rewrite 或 generated route 缺失 | 确认 `vercel.json` 和 `api/ghc/[...path].ts` 存在 |
| 浏览器请求返回 403 | `GHC_ALLOWED_ORIGINS` 未包含站点 origin | 添加当前 KIRARI origin |
| GitHub rate limit | `GITHUB_TOKEN` 缺失或无效 | 在 Vercel Project Env 重新配置 |
| GitHub 故障时无 stale 响应 | Runtime Cache 不可用或没有旧数据 | 需要持久 stale 时改用 Cloudflare |

## 相关文档

- [部署入口](DEPLOYMENT.md)
- [KIRARI 对接](KIRARI_INTEGRATION.md)
- [运维指南](OPERATIONS.md)
