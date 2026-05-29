# 文档重写审查记录

评估日期：2026-05-29

本记录对应当前 README 与 `docs/` 文档重写后的状态。旧版报告中提到的 healthz 字段差异、Cron prewarm fallback、`X-KIRARI-GHC-PUBLIC-BASE`、body 大小限制、avatar 不使用 `GITHUB_TOKEN` 等问题，已合并进正式文档。

## 覆盖范围

| 文件 | 状态 |
| --- | --- |
| `README.md` | 已重写为入口指南 |
| `docs/DEPLOYMENT.md` | 已重写为平台选择与变量归属指南 |
| `docs/CLOUDFLARE_DEPLOYMENT.md` | 已重写为 Cloudflare Worker + KV + Service Binding 部署流程 |
| `docs/VERCEL_DEPLOYMENT.md` | 已重写为 Vercel Function 部署流程 |
| `docs/KIRARI_INTEGRATION.md` | 已重写为 KIRARI adapter 对接指南 |
| `docs/ARCHITECTURE.md` | 已重写为架构、路由、缓存与错误处理说明 |
| `docs/OPERATIONS.md` | 已重写为运维、排障、回滚指南 |

## 已修正的旧问题

| 旧问题 | 当前处理 |
| --- | --- |
| Cloudflare 与 Vercel `/healthz` 字段不同 | README、架构和运维文档均说明跨平台只依赖 `ok` 字段 |
| Cron prewarm fallback 不清楚 | Cloudflare、架构、运维文档均说明 repo 预热需要 `PUBLIC_BASE_URL` |
| `X-KIRARI-GHC-PUBLIC-BASE` 说明不足 | KIRARI 对接和架构文档说明优先级与 Vercel 差异 |
| body 大小限制未文档化 | 架构文档记录 JSON 1 MB、avatar 512 KB |
| `GITHUB_TOKEN` 被误解为对 avatar 生效 | README、部署入口、Cloudflare、Vercel 文档均说明 token 仅用于 REST API 请求 |

## 当前文档原则

| 原则 | 体现 |
| --- | --- |
| 先部署路径，后参考细节 | README 和 DEPLOYMENT 先帮助选择平台 |
| 变量按归属分开 | runtime secret、CI secret、KIRARI 配置分表说明 |
| 平台差异显式写出 | Cloudflare 持久 stale，Vercel 可选 Runtime Cache |
| 每条主路径可验证 | 各部署文档包含 `curl` 检查和浏览器 Network 预期 |
| 排障映射到代码行为 | OPERATIONS 以 header、状态码和配置错误组织 |

## 后续维护建议

1. 改动路由、TTL、env 或 cache envelope 时，同步检查 `README.md`、`docs/ARCHITECTURE.md` 和 `docs/OPERATIONS.md`。
2. 改动 Cloudflare 或 Vercel 部署流程时，同步检查 `docs/DEPLOYMENT.md` 和对应平台文档。
3. 改动 KIRARI adapter 输出文件或配置字段时，同步检查 `docs/KIRARI_INTEGRATION.md`。
4. 外部平台权限、rate limit、Deploy Button 行为可能变化，发布前应按官方文档复核。
