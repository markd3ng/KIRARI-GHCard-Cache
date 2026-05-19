# 部署指南

本文件保留 Cloudflare Worker 主路径。免费版 Vercel 路径见 `docs/VERCEL_DEPLOYMENT.md`，Cloudflare 精简版说明见 `docs/CLOUDFLARE_DEPLOYMENT.md`。

## 安装

```bash
pnpm install
pnpm cf:types
```

## KV Namespace

创建生产和 preview namespace：

```bash
pnpm wrangler kv namespace create GITHUB_CACHE
pnpm wrangler kv namespace create GITHUB_CACHE --preview
```

将返回的 `id` 与 `preview_id` 写入 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  {
    "binding": "GITHUB_CACHE",
    "id": "<production-kv-id>",
    "preview_id": "<preview-kv-id>"
  }
]
```

## 私有 Worker 模式

生产默认关闭公开入口：

```jsonc
"workers_dev": false,
"preview_urls": false
```

这意味着浏览器不能直接访问 Worker，只能通过 KIRARI Pages 的 Service Binding 间接调用。

## GitHub Token

Worker 可以无 token 运行，但生产建议配置 `GITHUB_TOKEN`。这个 token 是运行时访问 GitHub REST API 用的，不是 GitHub Actions 部署 token。

Cloudflare Worker 配置位置：**Worker Secret**。

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

建议使用 fine-grained PAT 或 GitHub App token，只授予公开仓库读取元数据所需权限。

## GitHub Actions

仓库内置：

```text
.github/workflows/ci.yml
.github/workflows/deploy.yml
```

需要在 GitHub 仓库 Secrets 配置：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

`CLOUDFLARE_API_TOKEN` 只用于 GitHub Actions 调用 Cloudflare API 执行 `wrangler deploy`，不要和运行时的 `GITHUB_TOKEN` 混用。

Cloudflare 当前推荐在 Dashboard 的 **Account API tokens → Create Token → Permission policies → Custom → Edit Cloudflare Workers** 创建 CI token，并尽量只授权到部署目标 account。

权限建议：

| 场景 | Dashboard 权限名 | API 权限名 | Scope | 是否必需 | 说明 |
|------|------------------|------------|-------|----------|------|
| GitHub Actions 执行 `wrangler deploy` | Edit Cloudflare Workers | Workers Scripts Write/Edit | Account | 必需 | Cloudflare 官方 GitHub Actions 文档推荐使用该预设。 |
| 用同一个 token 创建/管理 KV namespace | Workers KV Storage Edit | Workers KV Storage Write/Edit | Account | 可选 | 仅当 CI 或脚本会运行 `wrangler kv namespace create` 时需要；本仓库 workflow 只 deploy，KV ID 预先写入 `wrangler.jsonc`。 |
| 用同一个 token 管理 Worker routes/custom domain | Workers Routes Edit | Workers Routes Write/Edit | Zone | 可选 | 仅当同一个 token 要写入 zone-level Worker routes 时需要；默认 Service Binding 私有模式不需要。 |

CI 会执行：

```bash
pnpm install --frozen-lockfile
pnpm type-check
pnpm test
pnpm cf:types
pnpm deploy:dry
```

Deploy 工作流会执行：

```bash
pnpm install --frozen-lockfile
pnpm type-check
pnpm test
wrangler deploy
```

如果仓库还没有配置 `CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_ACCOUNT_ID`，Deploy 工作流会跳过 `wrangler deploy`，但仍保留前置检查。这适合刚初始化仓库或还没完成 Cloudflare 授权的阶段；两个 Secret 都配置后无需修改 workflow，重新触发即可发布。

## Token 配置对照

| 变量 | 用途 | 配置位置 |
|------|------|----------|
| `GITHUB_TOKEN` | Worker 运行时请求 GitHub API，提高 GitHub rate limit | Cloudflare Worker Secret |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions 部署 Worker | GitHub Repository Secrets |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions 指定 Cloudflare 部署账号 | GitHub Repository Secrets |

## KIRARI Pages Service Binding

在 Cloudflare Dashboard 配置：

```text
Variable name: GHCARD_CACHE
Service: kirari-ghcard-cache
```

KIRARI 前端配置：

```toml
[githubCard]
apiBase = "/ghc"
```

## Origin Allowlist

Service Binding 私有模式下通常不需要 CORS 白名单，因为浏览器访问的是 KIRARI 同源 `/ghc/*`。如果同时启用 custom domain / 测试公网入口，可以设置：

```jsonc
"ALLOWED_ORIGINS": "https://example.com,https://www.example.com,http://localhost:4321"
```

## 预热

如果使用 `repo:` 预热目标，建议设置 `PUBLIC_BASE_URL`：

```jsonc
"PUBLIC_BASE_URL": "https://example.com/ghc"
```

Service Binding 正常请求会由 KIRARI Pages Function 传入 `X-KIRARI-GHC-PUBLIC-BASE`，不依赖该变量。

## 部署命令

```bash
pnpm type-check
pnpm test
pnpm cf:types
pnpm deploy:dry
pnpm deploy
```

## 日志

```bash
pnpm wrangler tail
```
