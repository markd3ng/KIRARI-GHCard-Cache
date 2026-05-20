# Cloudflare 免费版部署

Cloudflare 是本项目的完整缓存代理方案，使用免费层可用能力：Workers、Cache API、Workers KV、Cron Triggers 和 Cloudflare Pages Service Binding。

## 请求链路

```text
Browser
  -> KIRARI Pages /ghc/*
    -> Pages Function
      -> Service Binding GHCARD_CACHE
        -> private kirari-ghcard-cache Worker
          -> GitHub API + Cache API + Workers KV
```

Worker 默认私有：

```jsonc
"workers_dev": false,
"preview_urls": false
```

## 前置条件

| 条件 | 说明 |
|------|------|
| Cloudflare account | 承载 Worker、KV namespace 和 Pages 项目 |
| Node.js + pnpm | 运行本地检查和 Wrangler |
| 本仓库脚本中的 Wrangler | 生成 Worker 类型并部署 |
| KIRARI 部署在 Cloudflare Pages | 私有 Service Binding 路径需要 Pages 项目 |

## Step 1. 安装并本地检查

```bash
pnpm install
pnpm cf:types
pnpm type-check
pnpm test
pnpm deploy:dry
```

## Step 2. 创建 Workers KV Namespace

创建生产和 preview namespace：

```bash
pnpm wrangler kv namespace create GITHUB_CACHE
pnpm wrangler kv namespace create GITHUB_CACHE --preview
```

把返回的 ID 写入 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  {
    "binding": "GITHUB_CACHE",
    "id": "<production-kv-id>",
    "preview_id": "<preview-kv-id>"
  }
]
```

部署前运行配置检查：

```bash
pnpm cf:config-check
```

如果 `wrangler.jsonc` 仍包含 `<production-kv-id>` 或 `<preview-kv-id>`，说明还没有把真实 KV namespace ID 写入配置。GitHub Actions 会在 deploy step 前执行同一个检查，避免 Cloudflare API 返回 `KV namespace '<production-kv-id>' is not valid` 这种不直观的错误。

## Step 3. 配置运行时 Secret

`GITHUB_TOKEN` 非必需，但生产推荐配置。它是部署后的 Worker 请求 GitHub REST API 时使用的 token。

配置为 Cloudflare Worker Secret：

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

不要把 `GITHUB_TOKEN` 放在：

| 错误位置 | 原因 |
|----------|------|
| GitHub Actions workflow YAML | 它是运行时 secret，不是 CI 部署 token |
| `kirari.config.toml` | KIRARI 不需要知道 GitHub token |
| `wrangler.jsonc` vars | vars 是提交到仓库的配置，不适合存放 secret |

## Step 4. 配置 GitHub Actions 部署 Secret

只有使用 GitHub Actions 自动部署 Worker 时才需要：

| GitHub Repository Secret | 是否必需 | 用途 |
|--------------------------|----------|------|
| `CLOUDFLARE_ACCOUNT_ID` | 是 | 指定 Wrangler 部署到哪个 Cloudflare account |
| `CLOUDFLARE_API_TOKEN` | 是 | 让 GitHub Actions 中的 Wrangler 通过 Cloudflare API 部署 |
| `CLOUDFLARE_KV_NAMESPACE_ID` | 推荐 | CI 部署前临时写入 `wrangler.jsonc` 的生产 KV namespace ID |
| `CLOUDFLARE_PREVIEW_KV_NAMESPACE_ID` | 推荐 | CI 部署前临时写入 `wrangler.jsonc` 的 preview KV namespace ID |

如果任意一个缺失，deploy workflow 仍会执行 install、type-check 和 test，然后跳过 `wrangler deploy`。

KV namespace ID 有两种配置方式：

| 方式 | 适合场景 | 说明 |
|------|----------|------|
| 直接替换 `wrangler.jsonc` | 个人部署，接受把资源 ID 提交进仓库 | 把 `<production-kv-id>` 和 `<preview-kv-id>` 替换成真实 ID |
| GitHub Repository Secrets | 不想把账号资源 ID 提交进仓库 | 设置 `CLOUDFLARE_KV_NAMESPACE_ID` 和 `CLOUDFLARE_PREVIEW_KV_NAMESPACE_ID`，workflow 会在 deploy 前临时注入 |

如果两种方式都没配置，`pnpm cf:config-check` 会在 deploy 前失败，并提示先创建 KV namespace。

在 Cloudflare Dashboard 创建 API token：

```text
Account API tokens
-> Create Token
-> Permission policies
-> Custom
-> Edit Cloudflare Workers
```

权限建议：

| 场景 | Dashboard 选择项 | API permissions reference 名称 | Scope | 是否必需 |
|------|------------------|--------------------------------|-------|----------|
| GitHub Actions 部署本 Worker | Edit Cloudflare Workers / Workers Scripts Edit | Workers Scripts Write | Account | 必需 |
| 同一个 token 创建或管理 KV namespace | Workers KV Storage Edit | Workers KV Storage Write | Account | 可选 |
| 同一个 token 管理 Worker routes 或 custom domain routes | Workers Routes Edit | Workers Routes Write | Zone | 可选 |

本仓库默认 workflow 只需要 account scope 的 `Edit Cloudflare Workers` / `Workers Scripts Write`。KV namespace 通常在部署前手动创建，所以 deploy workflow 不需要 KV edit 权限。

## Step 5. 部署 Worker

手动部署：

```bash
pnpm deploy
```

GitHub Actions 部署：

1. 在 GitHub Repository Secrets 添加 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。
2. push 到 `main`，或手动运行 `Deploy Worker` workflow。
3. 确认 deploy step 没有被跳过。

## Step 6. 绑定到 KIRARI Pages

在 KIRARI Cloudflare Pages 项目里添加 Service Binding：

| 字段 | 值 |
|------|----|
| Binding type | Service binding |
| Variable name | `GHCARD_CACHE` |
| Service | `kirari-ghcard-cache` |

Dashboard 路径：

```text
Workers & Pages
-> KIRARI Pages project
-> Settings
-> Bindings
-> Add binding
-> Service binding
```

## Step 7. 配置 KIRARI

KIRARI 配置：

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare"
route = "/ghc"
serviceBinding = "GHCARD_CACHE"
```

Cloudflare Service Binding 路径下，KIRARI 本身不需要 `GITHUB_TOKEN`。可选 GitHub API token 属于本 Worker，应配置为 Cloudflare Worker Secret。

## Step 8. 验证

打开包含 GitHub card 的 KIRARI 页面，检查：

| 检查项 | 预期 |
|--------|------|
| `https://<your-site>/ghc/repos/owner/repo` | 返回 GitHub repo JSON |
| `https://<your-site>/ghc/avatar/owner?size=96` | 返回头像图片 |
| Browser Network | GitHub card 不直连 `api.github.com` |
| Browser Network | 头像不直连 `github.com/*.png` |
| 响应 header | 存在 `X-Cache` |
| Worker 公开 URL | `*.workers.dev` 不作为生产入口 |

## 可选变量

| 变量 | 位置 | 示例 | 用途 |
|------|------|------|------|
| `ALLOWED_ORIGINS` | `wrangler.jsonc` vars 或 Worker env | `https://example.com,http://localhost:4321` | 浏览器 CORS 白名单 |
| `PUBLIC_BASE_URL` | `wrangler.jsonc` vars 或 Worker env | `https://example.com/ghc` | cron prewarm 改写头像 URL 时使用 |
| `PREWARM_TARGETS` | `wrangler.jsonc` vars 或 Worker env | `repo:saicaca/fuwari,avatar:saicaca` | cron 预热目标列表 |
| `CACHE_NAMESPACE_VERSION` | `wrangler.jsonc` vars 或 Worker env | `v2` | 缓存 key 版本，用于批量失效 |

## 免费版边界

| 项目 | 是否需要 |
|------|----------|
| Worker custom domain | 不需要 |
| Cloudflare 付费 WAF / Rate Limiting | 不需要 |
| Durable Objects | 不需要 |
| D1 | 不需要 |
| R2 | 不需要 |
| Queues | 不需要 |

## 官方参考

| 主题 | 官方文档 |
|------|----------|
| Cloudflare GitHub Actions 认证和 secrets | [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) |
| Cloudflare API token 权限名称 | [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) |
| Deploy to Cloudflare 按钮格式 | [Cloudflare Deploy to Cloudflare changelog](https://developers.cloudflare.com/changelog/2025-04-08-deploy-to-cloudflare-button/) |
