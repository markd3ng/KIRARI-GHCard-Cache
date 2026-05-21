# KIRARI-GHCard-Cache 文档质量评估报告

> 评估范围：README.md + docs/ 下 6 份文档（ARCHITECTURE.md, CLOUDFLARE_DEPLOYMENT.md, VERCEL_DEPLOYMENT.md, KIRARI_INTEGRATION.md, OPERATIONS.md, DEPLOYMENT.md）+ CHANGELOG.md
> 对照代码：src/ 下 9 个源文件 + api/ghc/[...path].ts + wrangler.jsonc + vercel.json + package.json + tsconfig.json
> 评估日期：2026-05-21

---

## 📊 综合评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **准确性与代码一致性** | **4 / 5** | 整体高度一致，发现 5 处文档-代码偏差（1 处高优） |
| **易读性与结构化** | **4.5 / 5** | 表格化程度极高，层次清晰；可优化处极少 |
| **消除歧义性** | **4 / 5** | 变量归属表是亮点；少量隐式行为未显式说明 |
| **上下文完备性** | **4.5 / 5** | 新人友好度显著高于同类项目；仅缺贡献指南 |
| **综合均分** | **4.25 / 5** | |

**综合结论**：文档工程质量显著高于行业平均水平——表格化信息密度高、变量归属表消除了最常见的配置混淆、TTL 策略多文档交叉引用保持一致。主要扣分项集中在 healthz 响应字段不一致（Vercel 与 Cloudflare 返回不同 JSON 结构但文档未提及此差异），以及 Cron prewarm 内部 URL 构造逻辑未在文档中说明（属于边缘行为但可能误导调试）。

---

## 🔍 深度诊断与问题列表

### 问题 1：healthz 响应字段在两个平台不一致但文档未区分 [高优]

- **文档原文**：
  - README API 表格：`/healthz` → `{"ok":true,"runtime":"cloudflare"}`
  - VERCEL_DEPLOYMENT.md 验证表格：`/ghc/healthz` → `{"ok":true,"runtime":"vercel"}`
  - README KIRARI 对接表：`/ghc/healthz` → `/healthz`
- **代码现状**：
  - `src/index.ts:30`（Cloudflare）：`jsonResponse({ ok: true, service: "kirari-ghcard-cache" })` → 返回 `{"ok":true,"service":"kirari-ghcard-cache"}`
  - `src/vercel.ts:42`（Vercel）：`jsonResponse({ ok: true, runtime: "vercel" })` → 返回 `{"ok":true,"runtime":"vercel"}`
- **诊断分析**：
  - Cloudflare 实际返回的字段是 `service`，不是文档写的 `runtime`
  - Vercel 返回的字段是 `runtime`，与文档一致
  - 两个平台的响应 JSON 结构**不同**，但文档只分别给出了各自平台的示例，没有在同一处明确对比
  - 对编写跨平台监控脚本的开发者来说，可能误以为两个平台返回相同的字段名

### 问题 2：Cron prewarm URL 构造逻辑未文档化 [中优]

- **文档原文**：
  - ARCHITECTURE.md「Cron 预热」：仅描述频率、上限、目标格式，未说明预热请求的 URL 构造
  - OPERATIONS.md「配置 Cloudflare Cron 预热」：仅给出配置示例
- **代码现状**：
  - `src/index.ts:84-87`：
    ```typescript
    function prewarmUrlForTarget(publicBaseUrl: string, target: string): string {
      const baseUrl = publicBaseUrl || "https://prewarm.local/api/github";
      return `${baseUrl.replace(/\/$/, "")}/prewarm-placeholder?target=${encodeURIComponent(target)}`;
    }
    ```
  - `src/index.ts:63`：直接用 `prewarmUrlForTarget` 生成的 URL 构造 `new Request(...)` 然后传给 `handleCachedRoute`
- **诊断分析**：
  - 预热 URL 包含一个虚构路径 `/prewarm-placeholder?target=...`，然后 `handleCachedRoute` 内部使用 `request.url` 来确定 `publicBaseUrl`（`getPublicBaseUrl` 函数）
  - 如果 `PUBLIC_BASE_URL` 未设置且 Cron 触发，`baseUrl` 会 fallback 到 `https://prewarm.local/api/github`，这会导致 `publicBaseUrl` 解析为该虚假 origin，avatar URL 改写会指向一个不可达的地址
  - 这个 fallback 行为在代码中存在但文档完全没有提及，开发者在调试预热问题时可能被 `prewarm.local` 这个地址困惑

### 问题 3：`X-KIRARI-GHC-PUBLIC-BASE` header 仅在文档中提及一次，缺乏规范说明 [低优]

- **文档原文**：
  - KIRARI_INTEGRATION.md 第 71 行：「生成的 Pages Function 发送 `X-KIRARI-GHC-PUBLIC-BASE` header，告知 Worker 使用同源 `/ghc/avatar/:owner?size=96` 改写头像 URL。」
- **代码现状**：
  - `src/cache.ts:269-274`：
    ```typescript
    function getPublicBaseUrl(request: Request, env: Env): string {
      return (
        request.headers.get("X-KIRARI-GHC-PUBLIC-BASE") ||
        getStringBinding(env, "PUBLIC_BASE_URL") ||
        `${new URL(request.url).origin}/api/github`
      );
    }
    ```
  - 三级 fallback：Header → Env → request origin
- **诊断分析**：
  - 文档仅在一处简要提及该 header，但没有说明其值的格式要求（是否需要包含 `/ghc` 后缀？是否需要 trailing slash？）
  - `Vercel` 路径的 `publicBaseUrl` 是硬编码 `${new URL(request.url).origin}/ghc`（`src/vercel.ts:152`），不读取此 header，这个差异未在文档中说明
  - 开发者如果尝试手动测试该 header，可能不知道应该传入什么格式的值

### 问题 4：`MAX_JSON_BYTES` / `MAX_AVATAR_BYTES` 上限未文档化 [低优]

- **文档原文**：
  - ARCHITECTURE.md 缓存层对比表：KV 值上限 25 MiB
  - 无处提及请求体大小限制
- **代码现状**：
  - `src/cache.ts:23-24`：
    ```typescript
    const MAX_JSON_BYTES = 1_000_000;   // ~1 MB
    const MAX_AVATAR_BYTES = 512_000;    // 512 KB
    ```
  - `src/cache.ts:153-165`：`readBoundedBody` 函数在 `Content-Length` 和实际 body 两层校验大小
- **诊断分析**：
  - 这些是应用层限制，远低于 KV 的 25 MiB 上限
  - 对于超大 README 或复杂 repo metadata（虽然罕见），GitHub 返回超过 1 MB 的 JSON 会导致 cache 写入失败并抛异常
  - 异常被 `refreshCache` 的 `catch` 捕获后会返回 stale 数据或 504，但错误信息不区分「超时」和「body 过大」，文档也没有说明此限制

### 问题 5：`GITHUB_TOKEN` 对 avatar 请求的行为未显式说明 [低优]

- **文档原文**：
  - README 配置项表：「匿名 60 req/h → 5,000 req/h」
  - 多处文档均暗示 token 对所有请求生效
- **代码现状**：
  - `src/github.ts:45-55`（Cloudflare）：avatar 请求**不设置 Authorization header**
    ```typescript
    if (route.kind === "avatar") {
      headers.set("Accept", "image/png,image/*;q=0.8,*/*;q=0.5");
    } else {
      // ... token 逻辑仅在 else 分支
    }
    ```
  - `src/vercel.ts:131-139`（Vercel）：相同行为，avatar 不附带 token
- **诊断分析**：
  - `GITHUB_TOKEN` 对 API 请求有效，但**对 avatar 图片请求无效**（avatar 图片走 `github.com/*.png`，不属于 REST API，不需要认证）
  - 文档描述的「5,000 req/h」实际只适用于 REST API 调用（repo/contents/commits），avatar 图片仍走匿名访问
  - 这在实际上不影响功能（GitHub 头像不需要认证），但文档的表述可能让开发者误以为 token 对所有请求类型都提升了额度

---

## 💡 落地改进建议

### 建议 1：统一并显式对比 healthz 响应差异 [高优]

在 README.md 的 API 表格和 OPERATIONS.md 的 Header 章节中增加跨平台对比：

```markdown
### `/healthz` 响应对比

| 平台 | 响应体字段 | 示例 |
|------|-----------|------|
| Cloudflare Worker | `ok`, `service` | `{"ok":true,"service":"kirari-ghcard-cache"}` |
| Vercel Function | `ok`, `runtime` | `{"ok":true,"runtime":"vercel"}` |

> 两个平台的字段名不同。编写跨平台健康检查时，仅使用 `ok` 字段作为通用判据。
```

同时修正 README API 表格中 Cloudflare healthz 的示例值：
```
- 文档当前：`{"ok":true,"runtime":"cloudflare"}`
- 应改为：`{"ok":true,"service":"kirari-ghcard-cache"}`
```

### 建议 2：在 OPERATIONS.md 补充 prewarm fallback 行为说明 [中优]

在「配置 Cloudflare Cron 预热」章节增加：

```markdown
### Prewarm URL 构造与 Fallback

预热请求内部使用 `PUBLIC_BASE_URL` 构造请求 URL。当 `PUBLIC_BASE_URL` 未设置时，代码
会 fallback 到 `https://prewarm.local/api/github`（仅用于内部 URL 解析，不会实际请求该地址）。

**重要**：repo 类型的预热需要设置 `PUBLIC_BASE_URL`，否则 avatar URL 改写将使用不可达的
fallback origin。代码中遇到缺少 `PUBLIC_BASE_URL` 的 repo 预热目标时会跳过并输出警告日志。
```

### 建议 3：在 ARCHITECTURE.md 增加 body 大小限制说明 [低优]

在「缓存层对比」表格后增加一节：

```markdown
### 应用层 body 大小限制

| 资源类型 | 上限 | 超限行为 |
|---------|------|---------|
| JSON（repo/contents/commits） | 1 MB | 抛出异常，返回 stale 或 504 |
| 图片（avatar） | 512 KB | 同上 |

> 此限制远低于 Workers KV 的 25 MiB 值上限，旨在避免缓存超大响应。
```

### 建议 4：补充 `X-KIRARI-GHC-PUBLIC-BASE` header 规范 [低优]

在 KIRARI_INTEGRATION.md 的 Cloudflare Pages 对接章节中，将第 71 行展开为：

```markdown
生成的 Pages Function 发送 `X-KIRARI-GHC-PUBLIC-BASE` header（值为 KIRARI 的
`githubCard.route`，例如 `/ghc`），告知 Worker 使用同源路径改写 avatar URL。

Worker 的 `publicBaseUrl` 解析优先级：
1. `X-KIRARI-GHC-PUBLIC-BASE` header（仅 Cloudflare Service Binding 模式由 KIRARI 自动发送）
2. `PUBLIC_BASE_URL` 环境变量（用于 Cron prewarm 等无 KIRARI header 的场景）
3. `request.url` 的 origin + `/api/github`（兜底）

> Vercel 路径硬编码使用 `{request.origin}/ghc`，不读取此 header。
```

### 建议 5：明确 token 对 avatar 请求不生效 [低优]

在 README 配置项 `GITHUB_TOKEN` 说明处增加一行：

```markdown
> `GITHUB_TOKEN` 仅用于 GitHub REST API 请求（repo metadata、contents、commits）。
> avatar 图片通过 `github.com` 公开 CDN 获取，无需认证。
```

---

## 📝 附加观察（非问题，供参考）

1. **文档-代码同步率极高**：6 份文档中提到的所有 API 路径、TTL 数值、环境变量名称、KV binding 名称均与 `wrangler.jsonc`、`package.json` scripts 和源码实现完全吻合。这在 v0.1.0 的项目上非常少见，说明文档和代码很可能是同步编写的。

2. **变量归属表是最佳实践**：DEPLOYMENT.md 和 KIRARI_INTEGRATION.md 中的「变量归属总表」和「配置归属表」有效消除了多平台部署时最常见的 token 配置混淆问题。建议其他项目参考此模式。

3. **TTL 策略在 3 份文档中重复出现**（README、ARCHITECTURE、OPERATIONS），内容完全一致。这是有意的冗余（不同上下文各自完整），但建议在 ARCHITECTURE.md 中标注为主参考源，其他位置注明「同 ARCHITECTURE.md TTL 策略」。

4. **`vercel.ts` 独立复制了 `cache.ts` 的 TTL 逻辑**（`getTtlPolicy`、`encodeBody`/`decodeBody`），ARCHITECTURE.md 已正确记录「重复 cache.ts 的 TTL/encode 逻辑」，属于有意的设计决策，文档描述准确。
