# KIRARI 对接指南

本项目保持独立缓存仓库，KIRARI 通过 opt-in `/ghc/*` adapter 消费它。Cloudflare 使用 Pages Function + Service Binding；Vercel 使用同项目 Function。

## 推荐链路

```text
Browser
  -> KIRARI Pages /ghc/*
    -> functions/ghc/[[path]].ts
      -> Service Binding: GHCARD_CACHE
        -> kirari-ghcard-cache Worker
```

## KIRARI 配置

KIRARI 默认直连 GitHub：

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
route = "/ghc"
```

启用 Cloudflare：

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "cloudflare"
route = "/ghc"
serviceBinding = "GHCARD_CACHE"
```

启用 Vercel：

```toml
[githubCard]
apiBase = "/ghc"

[githubCard.adapter]
enabled = true
provider = "vercel"
route = "/ghc"
```

这样未部署缓存服务的用户不会被破坏。

## KIRARI 关键改动

```text
kirari.config.toml
src/utils/config-loader.ts
src/types/config.ts
scripts/materialize-ghc-adapter.mjs
adapters/github-card/
src/plugins/rehype-component-github-card.mjs
src/plugins/rehype-component-github-file-card.mjs
README.md
CHANGELOG.md
```

## Cloudflare Pages Function

KIRARI adapter materializer 会按需生成：

```text
functions/ghc/[[path]].ts
```

核心逻辑：

```ts
type ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type PagesContext<Env> = {
  request: Request;
  env: Env;
};

interface Env {
  GHCARD_CACHE: ServiceBinding;
}

export const onRequest = async (context: PagesContext<Env>): Promise<Response> => {
  const url = new URL(context.request.url);
  url.pathname = url.pathname.replace(/^\/ghc/, "/api/github");

  const headers = new Headers(context.request.headers);
  headers.set("X-KIRARI-GHC-PUBLIC-BASE", `${new URL(context.request.url).origin}/ghc`);

  return context.env.GHCARD_CACHE.fetch(
    new Request(url, {
      method: context.request.method,
      headers,
      body: context.request.body,
      redirect: context.request.redirect,
    }),
  );
};
```

`X-KIRARI-GHC-PUBLIC-BASE` 用于让 Worker 把 repo JSON 中的 `owner.avatar_url` 改写为 `/ghc/avatar/:owner?size=96`。

## Cloudflare Pages Binding

Dashboard 配置路径：

```text
Cloudflare Dashboard
-> Workers & Pages
-> KIRARI Pages Project
-> Settings
-> Bindings
-> Add binding
-> Service binding
-> Variable name: GHCARD_CACHE
-> Service: kirari-ghcard-cache
```

如果 KIRARI 后续使用 Pages `wrangler.jsonc` 管理配置，可加入：

```jsonc
{
  "services": [
    {
      "binding": "GHCARD_CACHE",
      "service": "kirari-ghcard-cache"
    }
  ]
}
```

## 插件请求改造

Repo card：

```js
fetch(`${githubCardApiBase}/repos/${repo}`)
```

File card：

```js
fetch(`${githubCardApiBase}/repos/${repo}`)
fetch(`${githubCardApiBase}/repos/${repo}/contents/${encodedFilePath}${refQuery}`)
fetch(`${githubCardApiBase}/repos/${repo}/commits?path=${encodeURIComponent(filePath)}&per_page=1${commitRefQuery}`)
```

KIRARI 不处理 token，也不需要知道 KV/缓存策略。头像 URL 继续读取 `owner.avatar_url`，由 Worker 改写。

## 回滚

把 KIRARI 配置改回：

```toml
[githubCard]
apiBase = "https://api.github.com"

[githubCard.adapter]
enabled = false
provider = "none"
```

或删除 `[githubCard]` / `[githubCard.adapter]` 配置，回到默认值。

## 验收

- `::github{repo="owner/repo"}` 正常显示。
- `::githubfile{repo="owner/repo" file="README.md"}` 正常显示。
- Browser Network 看到 `/ghc/repos/...`。
- Browser Network 看到 `/ghc/avatar/...`。
- Browser Network 不直连 `api.github.com`。
- Browser Network 不直连 `github.com/*.png`。
- View Transition 后 GitHub card 仍能初始化。
- KIRARI 通过 `pnpm type-check`、`pnpm astro check`、`pnpm build`。
