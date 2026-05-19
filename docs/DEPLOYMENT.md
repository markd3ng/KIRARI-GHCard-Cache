# 部署指南

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

Worker 可以无 token 运行，但生产建议配置：

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
CLOUDFLARE_API_TOKEN
```

Cloudflare API Token 最小权限建议：

```text
Account: Workers Scripts Edit
Account: Workers KV Storage Edit
Account: Account Settings Read
Zone: Zone Read   # 只有 custom domain / route 场景需要
```

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

如果仓库还没有配置 `CLOUDFLARE_API_TOKEN`，Deploy 工作流会跳过 `wrangler deploy`，但仍保留前置检查。这适合刚初始化仓库或还没完成 Cloudflare 授权的阶段；配置 Secret 后无需修改 workflow，重新触发即可发布。

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
