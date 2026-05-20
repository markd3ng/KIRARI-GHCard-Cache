# 部署指南

本页是部署入口。先根据 KIRARI 的托管平台选择路径，再阅读对应平台文档。

## 选择部署路径

| 托管目标 | 推荐设置 | 缓存强度 | 是否需要公开业务域名 | 文档 |
|----------|----------|----------|----------------------|------|
| KIRARI 部署在 Cloudflare Pages | KIRARI `/ghc/*` Pages Function 通过 Service Binding 调用私有 `kirari-ghcard-cache` Worker | 强：Cache API + Workers KV + stale fallback | 不需要 | [Cloudflare 部署](CLOUDFLARE_DEPLOYMENT.md) |
| KIRARI 部署在 Vercel | KIRARI 构建同项目 `/ghc/*` Vercel Function | 基础：HTTP cache headers，可用时尝试 Runtime Cache | 不需要 | [Vercel 部署](VERCEL_DEPLOYMENT.md) |
| GHC 单独部署在 Vercel | 将本仓库导入 Vercel，KIRARI 调用该项目 `/ghc/*` | 基础：HTTP cache headers，可用时尝试 Runtime Cache | 使用 Vercel 项目 URL | [Vercel 部署](VERCEL_DEPLOYMENT.md) |
| KIRARI 纯静态部署且无运行时 route | 不启用 adapter | 无 GHC 缓存 | 不需要 | KIRARI 直连 `https://api.github.com` |

## 变量归属

| 名称 | 谁使用 | 配置位置 | 不要配置在 | 用途 |
|------|--------|----------|------------|------|
| `GITHUB_TOKEN` | 缓存代理运行时 | Cloudflare Worker Secret 或 Vercel Project Environment Variables | GitHub Actions YAML、`kirari.config.toml`、任何提交到仓库的文件 | 提高 GitHub REST API rate limit |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions 部署任务 | GitHub Repository Secrets | Cloudflare Worker Secret、Vercel、`kirari.config.toml` | 指定 `wrangler deploy` 的 Cloudflare account |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions 部署任务 | GitHub Repository Secrets | Cloudflare Worker Secret、Vercel、`kirari.config.toml` | 让 CI 中的 Wrangler 调用 Cloudflare API |
| `CLOUDFLARE_KV_NAMESPACE_ID` | GitHub Actions 部署任务 | GitHub Repository Secrets | Cloudflare Worker Secret、Vercel、`kirari.config.toml` | CI deploy 前临时注入生产 KV namespace ID |
| `CLOUDFLARE_PREVIEW_KV_NAMESPACE_ID` | GitHub Actions 部署任务 | GitHub Repository Secrets | Cloudflare Worker Secret、Vercel、`kirari.config.toml` | CI deploy 前临时注入 preview KV namespace ID |
| `ALLOWED_ORIGINS` | Cloudflare Worker CORS | `wrangler.jsonc` vars 或 Cloudflare Worker 环境变量 | KIRARI 配置 | 浏览器 Origin 白名单 |
| `GHC_ALLOWED_ORIGINS` | Vercel Function CORS | Vercel Project Environment Variables | Cloudflare Worker Secret | Vercel 专用 Origin 白名单 |
| `PUBLIC_BASE_URL` | Cloudflare cron prewarm | `wrangler.jsonc` vars | KIRARI 配置 | 预热时改写头像 URL 的公开 API base |
| `PREWARM_TARGETS` | Cloudflare cron prewarm | `wrangler.jsonc` vars | KIRARI 配置 | 预热目标列表 |

## Cloudflare 部署摘要

1. 安装依赖。
2. 创建生产和 preview Workers KV namespace。
3. 将 KV ID 写入 `wrangler.jsonc`。
4. 将 KV ID 写入 `wrangler.jsonc`，或配置 `CLOUDFLARE_KV_NAMESPACE_ID` / `CLOUDFLARE_PREVIEW_KV_NAMESPACE_ID` GitHub Secrets 让 CI 临时注入。
5. 运行 `pnpm cf:config-check`，确认 `wrangler.jsonc` 不再包含 KV ID 占位符。
6. 可选：把运行时 `GITHUB_TOKEN` 配成 Cloudflare Worker Secret。
7. 可选：如果要用 GitHub Actions 部署，配置 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。
8. 部署 Worker。
9. 在 KIRARI Cloudflare Pages 项目中绑定 `GHCARD_CACHE` Service Binding。
10. KIRARI 设置 `githubCard.apiBase = "/ghc"` 并启用 Cloudflare adapter。

完整步骤见 [Cloudflare 部署](CLOUDFLARE_DEPLOYMENT.md)。

## Vercel 部署摘要

1. 决定 `/ghc/*` Function 放在 KIRARI 项目里，还是作为本仓库的独立 Vercel 项目。
2. 如果需要提高 GitHub rate limit，在 Vercel Project Environment Variables 配置 `GITHUB_TOKEN`。
3. KIRARI 设置 `githubCard.apiBase = "/ghc"`。
4. 验证浏览器请求停留在 `/ghc/*`。

完整步骤见 [Vercel 部署](VERCEL_DEPLOYMENT.md)。

## Cloudflare GitHub Actions 权限

本项目中有两个容易混淆的 token：

| Token | 属于哪里 | 用途 |
|-------|----------|------|
| `GITHUB_TOKEN` | Worker 运行时 | 让部署后的 Worker 请求 GitHub API |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions | 让 CI 里的 Wrangler 部署 Worker |

`CLOUDFLARE_API_TOKEN` 的权限建议：

| 场景 | Dashboard 选择项 | API permissions reference 名称 | Scope | 是否必需 |
|------|------------------|--------------------------------|-------|----------|
| GitHub Actions 执行 `wrangler deploy` | Edit Cloudflare Workers / Workers Scripts Edit | Workers Scripts Write | Account | 必需 |
| 同一个 token 创建或管理 KV namespace | Workers KV Storage Edit | Workers KV Storage Write | Account | 可选 |
| 同一个 token 管理 Worker routes 或 custom domain routes | Workers Routes Edit | Workers Routes Write | Zone | 可选 |

默认私有 Service Binding 方案不需要 zone-level route，也不需要 Worker custom domain。

## 验证命令

Cloudflare 路径：

```bash
pnpm install
pnpm cf:types
pnpm cf:config-check
pnpm type-check
pnpm test
pnpm deploy:dry
```

Vercel 路径：

```bash
pnpm install
pnpm type-check
pnpm test
```

## 官方参考

| 主题 | 官方文档 |
|------|----------|
| Cloudflare GitHub Actions 认证和 secrets | [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) |
| Cloudflare API token 权限名称 | [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) |
| `vercel.json` rewrites | [Vercel rewrites](https://vercel.com/docs/routing/rewrites) |
