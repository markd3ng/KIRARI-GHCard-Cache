# Cloudflare 部署

Cloudflare 路径提供完整缓存：Worker Cache API 作为 L1，Workers KV 作为 L2，KV 中的 stale 数据可在 GitHub rate limit、超时或 5xx 时继续兜底。

## 最终链路

```text
Browser
  -> KIRARI Pages /ghc/*
  -> generated Pages Function
  -> Service Binding GHCARD_CACHE
  -> kirari-ghcard-cache Worker /api/github/*
  -> GitHub REST API / github.com avatar
```

`wrangler.jsonc` 默认关闭 Worker 公共入口：

```jsonc
"workers_dev": false,
"preview_urls": false
```

生产入口应是 KIRARI 同源 `/ghc/*`，不是 `*.workers.dev`。

## 前置条件

| 条件 | 说明 |
| --- | --- |
| Cloudflare account | Worker、KV、Pages 项目需要在同一个 account 下 |
| Node.js 24 + pnpm | 与 GitHub Actions 保持一致 |
| Wrangler 登录或 CI token | 本地部署用 `wrangler login`，CI 用 `CLOUDFLARE_API_TOKEN` |
| KIRARI 部署在 Cloudflare Pages | Pages Service Binding 需要 Pages runtime |

不需要 Durable Objects、R2、D1、Queues、Worker custom domain 或付费 WAF。

## 1. 安装与本地检查

```bash
pnpm install
pnpm cf:types
pnpm type-check
pnpm test
pnpm deploy:dry
```

预期：

| 命令 | 成功标志 |
| --- | --- |
| `pnpm cf:types` | 生成或更新 `worker-configuration.d.ts` |
| `pnpm type-check` | TypeScript 无错误 |
| `pnpm test` | Vitest 全部通过 |
| `pnpm deploy:dry` | Wrangler 能解析配置，但如果 KV 仍是占位符会失败 |

## 2. 创建 Workers KV namespace

本地手动部署：

```bash
pnpm wrangler kv namespace create GITHUB_CACHE
```

Wrangler 会返回类似：

```json
{
  "id": "abc123...",
  "title": "GITHUB_CACHE"
}
```

把 `id` 写入 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  {
    "binding": "GITHUB_CACHE",
    "id": "abc123..."
  }
]
```

CI 部署时，如果 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` 已配置，`pnpm cf:prepare-config` 会自动创建或复用 `GITHUB_CACHE` 并把 id 注入 `wrangler.jsonc`。随后 `pnpm cf:config-check` 会阻止占位符配置继续部署。

## 3. 配置运行时 `GITHUB_TOKEN`

生产推荐配置：

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

输入 GitHub token 后，Worker 的 repo、contents、commits 请求会带 `Authorization: Bearer ...`。avatar 请求不会使用 token。

不要把这个 token 放在：

| 位置 | 原因 |
| --- | --- |
| `wrangler.jsonc` vars | 会提交到仓库 |
| `kirari.config.toml` | KIRARI 不需要知道 token |
| GitHub Actions YAML | 运行时 secret 和 CI deploy token 是两件事 |

## 4. 配置 CORS 与可选预热

在 `wrangler.jsonc` 的 `vars` 或 Cloudflare Dashboard 环境变量中配置：

```jsonc
"vars": {
  "CACHE_NAMESPACE_VERSION": "v1",
  "PUBLIC_BASE_URL": "https://blog.example.com/ghc",
  "ALLOWED_ORIGINS": "https://blog.example.com,http://localhost:4321",
  "PREWARM_TARGETS": "repo:saicaca/fuwari,avatar:saicaca"
}
```

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `CACHE_NAMESPACE_VERSION` | 否 | 缓存 key 版本，递增后旧 key 自然过期 |
| `ALLOWED_ORIGINS` | 生产推荐 | 浏览器跨站请求白名单；留空时带 `Origin` 请求返回 403 |
| `PUBLIC_BASE_URL` | repo 预热需要 | Cron 预热 repo JSON 时用它改写 `owner.avatar_url` |
| `PREWARM_TARGETS` | 否 | 逗号分隔，最多处理 50 个 target |

预热 target 格式：

| 类型 | 格式 | 示例 |
| --- | --- | --- |
| Repo | `repo:owner/repo` | `repo:saicaca/fuwari` |
| Contents | `content:owner/repo:path` | `content:saicaca/fuwari:README.md` |
| Commits | `commits:owner/repo:path` | `commits:saicaca/fuwari:README.md` |
| Avatar | `avatar:owner` | `avatar:saicaca` |

## 5. 配置 GitHub Actions Secrets

仓库 Settings -> Secrets and variables -> Actions：

| Secret | 必需 | 用途 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 是 | 指定 Wrangler 部署 account |
| `CLOUDFLARE_API_TOKEN` | 是 | 允许 CI 调用 Cloudflare API |

API token 最小权限：

| 权限 | Scope | 用途 |
| --- | --- | --- |
| Workers Scripts Write | Account | 部署 Worker |
| Workers KV Storage Write | Account | 创建、复用或读取 KV namespace |

缺少其中任意一个 secret 时，`.github/workflows/deploy.yml` 会完成 install、type-check、test，然后跳过部署。

## 6. 部署 Worker

本地：

```bash
pnpm cf:config-check
pnpm deploy
```

CI：

```text
push to main
  -> Deploy Worker workflow
  -> install
  -> type-check
  -> test
  -> cf:prepare-config
  -> cf:config-check
  -> wrangler deploy
```

## 7. 添加 KIRARI Pages Service Binding

Cloudflare Dashboard：

```text
Workers & Pages
  -> KIRARI Pages project
  -> Settings
  -> Bindings
  -> Add binding
  -> Service binding
```

字段：

| 字段 | 值 |
| --- | --- |
| Variable name | `GHCARD_CACHE` |
| Service | `kirari-ghcard-cache` |

## 8. 配置 KIRARI

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare"
route = "/ghc"
serviceBinding = "GHCARD_CACHE"
```

KIRARI 构建时应生成 `functions/ghc/[[path]].ts`。该 Pages Function 会向 Worker 发送 `X-KIRARI-GHC-PUBLIC-BASE`，让 repo JSON 中的 `owner.avatar_url` 改写成同源 `/ghc/avatar/...`。

## 9. 验证

```bash
curl -i https://YOUR_KIRARI_SITE/ghc/healthz
curl -i https://YOUR_KIRARI_SITE/ghc/repos/saicaca/fuwari
curl -I https://YOUR_KIRARI_SITE/ghc/avatar/saicaca?size=96
```

预期：

| 检查 | 结果 |
| --- | --- |
| `/ghc/healthz` | `{"ok":true,"service":"kirari-ghcard-cache"}` |
| repo JSON | `owner.avatar_url` 指向 `/ghc/avatar/...` |
| 响应 header | 有 `X-Cache` 和 `X-Cache-Key` |
| 浏览器 Network | KIRARI card 不直连 `api.github.com` |
| Worker 公开地址 | 不作为生产入口 |

## 常见失败

| 现象 | 原因 | 修复 |
| --- | --- | --- |
| `wrangler deploy` 报 KV id 无效 | `wrangler.jsonc` 仍是 `<production-kv-id>` | 运行 `pnpm cf:prepare-config` 或手动填入 KV id |
| `/ghc/*` 返回 binding 错误 | KIRARI Pages 未添加 Service Binding 或名称不一致 | 添加 `GHCARD_CACHE` |
| 浏览器请求返回 403 | `ALLOWED_ORIGINS` 未包含当前站点 origin | 设置 `ALLOWED_ORIGINS=https://YOUR_KIRARI_SITE` |
| repo JSON 中头像仍是 GitHub URL | KIRARI generated route 没有传 `X-KIRARI-GHC-PUBLIC-BASE` | 检查 KIRARI adapter 生成文件和构建版本 |
| GitHub rate limit | 未配置或 token 无效 | 重新执行 `pnpm wrangler secret put GITHUB_TOKEN` |

## 相关文档

- [部署入口](DEPLOYMENT.md)
- [KIRARI 对接](KIRARI_INTEGRATION.md)
- [架构与缓存流程](ARCHITECTURE.md)
- [运维指南](OPERATIONS.md)
