# 运维指南

这份文档用于上线后的诊断、缓存失效、预热、回滚和常见故障处理。

## 快速判断当前路径

| 现象 | 说明 |
| --- | --- |
| `/ghc/healthz` 返回 `service: "kirari-ghcard-cache"` | Cloudflare Worker |
| `/ghc/healthz` 返回 `runtime: "vercel"` | Vercel Function |
| 响应没有 `X-Cache`，Network 里直连 `api.github.com` | KIRARI 未走缓存代理 |

跨平台健康检查只判断 `ok === true`，不要依赖 `service` 或 `runtime` 字段名。

## Header 速查

| Header | 值 | 含义 |
| --- | --- | --- |
| `X-Cache` | `HIT-L1` | Cloudflare Cache API 命中 |
| `X-Cache` | `HIT-KV` | Cloudflare KV fresh 命中 |
| `X-Cache` | `MISS` | 本次请求访问 GitHub upstream |
| `X-Cache` | `STALE` | Cloudflare KV stale 命中，后台刷新 |
| `X-Cache` | `HIT-RUNTIME` | Vercel Runtime Cache fresh 命中 |
| `X-Cache` | `STALE-RUNTIME` | Vercel Runtime Cache stale 命中 |
| `X-Cache-Key` | `ghcard:v1:...` | 当前缓存 key |
| `X-Upstream-RateLimit-Remaining` | 数字 | GitHub 剩余额度，只在 upstream 返回该 header 时出现 |
| `X-Upstream-RateLimit-Reset` | Unix timestamp | GitHub rate limit reset 时间 |

`X-Upstream-*` 缺失不一定是错误，通常表示请求命中了缓存，没有访问 GitHub。

## 常用检查命令

```bash
curl -i https://YOUR_SITE.example/ghc/healthz
curl -i https://YOUR_SITE.example/ghc/repos/saicaca/fuwari
curl -I https://YOUR_SITE.example/ghc/avatar/saicaca?size=96
```

Cloudflare 实时日志：

```bash
pnpm wrangler tail
```

部署前本地检查：

```bash
pnpm type-check
pnpm test
pnpm cf:config-check
pnpm deploy:dry
```

## 缓存失效

批量失效推荐递增 `CACHE_NAMESPACE_VERSION`：

```jsonc
"vars": {
  "CACHE_NAMESPACE_VERSION": "v2"
}
```

新请求会使用 `ghcard:v2:...` key，旧 key 留在 KV 或 Runtime Cache 中自然过期。

适合这样做的场景：

| 场景 | 是否递增 |
| --- | --- |
| 修改 `normalizeUpstreamBody()` 导致响应结构变化 | 是 |
| 修改 TTL 策略但希望旧数据立刻避开 | 是 |
| 单个 repo 内容更新 | 通常不需要，等待 TTL 或请求 commits 路径 |
| GitHub token 轮换 | 不需要 |

## Cloudflare 预热

`wrangler.jsonc`:

```jsonc
"PUBLIC_BASE_URL": "https://blog.example.com/ghc",
"PREWARM_TARGETS": "repo:saicaca/fuwari,content:saicaca/fuwari:README.md,commits:saicaca/fuwari:README.md,avatar:saicaca"
```

target 格式：

| 类型 | 格式 |
| --- | --- |
| Repo | `repo:owner/repo` |
| Contents | `content:owner/repo:path` |
| Commits | `commits:owner/repo:path` |
| Avatar | `avatar:owner` |

注意：

| 条件 | 行为 |
| --- | --- |
| `PUBLIC_BASE_URL` 为空且 target 是 repo | 跳过，并记录 `prewarm_skip` |
| target 非法 | 跳过，并记录原因 |
| target 超过 50 个 | 只处理前 50 个 |

## 处理 GitHub rate limit

1. 确认运行时配置了 `GITHUB_TOKEN`。
2. 看响应 header 是否有 `X-Upstream-RateLimit-Remaining`。
3. Cloudflare 路径检查是否返回 `X-Cache: STALE`。
4. 检查 Markdown 卡片是否生成大量随机 `ref`、`sha` 或 `path`，这会绕开缓存 key。

配置方式：

| 平台 | 命令或位置 |
| --- | --- |
| Cloudflare | `pnpm wrangler secret put GITHUB_TOKEN` |
| Vercel | Project -> Settings -> Environment Variables -> `GITHUB_TOKEN` |

## CORS 排查

| 现象 | 原因 | 修复 |
| --- | --- | --- |
| 浏览器返回 403，curl 无 `Origin` 正常 | allowlist 为空或未包含站点 origin | 设置 `ALLOWED_ORIGINS` 或 `GHC_ALLOWED_ORIGINS` |
| 预览域可用，生产域 403 | 只配置了 preview origin | 把生产 origin 加入逗号分隔列表 |
| 响应缺少 `Access-Control-Allow-Origin` | 当前请求没有命中 allowlist | 检查 `Origin` header 和配置值是否完全一致 |

配置值要包含协议，不要带 path：

```text
https://blog.example.com,http://localhost:4321
```

## Troubleshooting

| 现象 | 根因 | 修复 |
| --- | --- | --- |
| 浏览器仍请求 `api.github.com` | KIRARI `apiBase` 仍是 GitHub 或 adapter 未启用 | 设置 `apiBase = "/ghc"`，启用 provider 后重新构建 |
| `/ghc/repos/...` 返回 404 | generated route 缺失或 rewrite 缺失 | 检查 KIRARI build 输出、`vercel.json` 或 Pages Function |
| Cloudflare binding 错误 | Pages Service Binding 缺失或变量名不是 `GHCARD_CACHE` | 在 KIRARI Pages 项目添加 Service Binding |
| 头像 URL 指向 GitHub | repo JSON 没有被正确归一化 | 检查 Cloudflare route 是否发送 `X-KIRARI-GHC-PUBLIC-BASE` |
| Cloudflare deploy 报 KV id placeholder | `wrangler.jsonc` 未注入真实 KV id | 运行 `pnpm cf:prepare-config && pnpm cf:config-check` |
| GitHub Actions deploy 被跳过 | 缺少 CI secret | 配置 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` 或 `VERCEL_TOKEN` |
| Vercel GitHub 故障时无 stale | Runtime Cache 不可用或没有旧数据 | 需要稳定兜底时迁移到 Cloudflare |
| `HEAD` 请求有 header 无 body | 代码按规范把 GET 响应转为 HEAD | 正常 |

## 回滚

KIRARI 回滚到直连：

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
```

重新构建 KIRARI。回滚后：

| 检查 | 预期 |
| --- | --- |
| generated route | 被移除或不再使用 |
| Browser Network | 重新出现 `api.github.com` 请求 |
| `X-Cache` | 不再出现 |

Cloudflare Worker 可以保留部署，不影响 KIRARI 直连模式。

## 安全检查

| 检查 | 预期 |
| --- | --- |
| `GITHUB_TOKEN` | 只存在于 Worker Secret 或 Vercel Env |
| `CLOUDFLARE_API_TOKEN` | 只存在于 GitHub Repository Secrets |
| `wrangler.jsonc` | 不包含真实 secret，只包含非敏感 vars 和 KV namespace id |
| Cloudflare Worker | `workers_dev = false`，`preview_urls = false` |
| CORS | 生产配置明确 allowlist |

## 相关文档

- [部署入口](DEPLOYMENT.md)
- [Cloudflare 部署](CLOUDFLARE_DEPLOYMENT.md)
- [Vercel 部署](VERCEL_DEPLOYMENT.md)
- [架构与缓存流程](ARCHITECTURE.md)
