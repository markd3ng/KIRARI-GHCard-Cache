import { evaluateCors, withCors } from "./cors";
import { buildGithubUrl } from "./github";
import { normalizeUpstreamBody } from "./normalize";
import { errorResponse, headResponse, jsonResponse } from "./response";
import { parseRoute, routeToCacheParts, type Route } from "./router";

type RuntimeCache = {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }): Promise<void>;
};

type RuntimeCacheEnvelope = {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: "utf-8" | "base64";
  freshUntil: number;
  staleUntil: number;
};

const CACHE_NAMESPACE = "kirari-ghcard-cache";
const CACHE_TAG = "kirari-ghcard";
const USER_AGENT = "KIRARI-GHCard-Cache-Vercel";

export async function handleVercelRequest(request: Request): Promise<Response> {
  const env = getVercelEnv();
  const cors = evaluateCors(request, env);
  if (!cors.allowed) {
    return errorResponse(403, "Origin is not allowed.", "origin_not_allowed");
  }

  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }), cors);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return withCors(errorResponse(405, "Only GET, HEAD, and OPTIONS are supported.", "method_not_allowed"), cors);
  }

  const incomingUrl = new URL(request.url);
  if (isHealthRoute(incomingUrl.pathname)) {
    return withCors(jsonResponse({ ok: true, runtime: "vercel" }), cors);
  }

  const parsed = parseRoute(toInternalGithubUrl(incomingUrl));
  if (!parsed.ok) {
    return withCors(errorResponse(parsed.status, parsed.message), cors);
  }

  const cacheKey = buildRuntimeCacheKey(parsed.route);
  const runtimeCache = await getRuntimeCache();
  const cached = runtimeCache ? await runtimeCache.get<RuntimeCacheEnvelope>(cacheKey) : undefined;
  const now = Date.now();

  if (isRuntimeCacheEnvelope(cached) && cached.freshUntil > now) {
    return maybeHead(request, withCors(envelopeToResponse(cached, "HIT-RUNTIME", cacheKey), cors));
  }

  try {
    const refreshed = await fetchAndNormalize(request, parsed.route, cacheKey);
    if (!refreshed.envelope && isRuntimeCacheEnvelope(cached) && cached.staleUntil > now) {
      return maybeHead(request, withCors(envelopeToResponse(cached, "STALE-RUNTIME", cacheKey), cors));
    }
    if (runtimeCache && refreshed.envelope) {
      await runtimeCache.set(cacheKey, refreshed.envelope, {
        ttl: refreshed.ttlSeconds,
        tags: [CACHE_TAG],
      });
    }
    return maybeHead(request, withCors(refreshed.response, cors));
  } catch {
    if (isRuntimeCacheEnvelope(cached) && cached.staleUntil > now) {
      return maybeHead(request, withCors(envelopeToResponse(cached, "STALE-RUNTIME", cacheKey), cors));
    }

    return withCors(errorResponse(504, "GitHub upstream did not respond and no runtime cache is available.", "upstream_timeout"), cors);
  }
}

function getVercelEnv(): Record<string, string | undefined> {
  return {
    ALLOWED_ORIGINS: process.env.GHC_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS,
  };
}

function isHealthRoute(pathname: string): boolean {
  return pathname === "/ghc/healthz" || pathname === "/api/ghc/healthz" || pathname === "/healthz";
}

function toInternalGithubUrl(url: URL): URL {
  const next = new URL(url);
  if (next.pathname.startsWith("/api/ghc/")) {
    next.pathname = next.pathname.replace(/^\/api\/ghc/, "/api/github");
  } else if (next.pathname.startsWith("/ghc/")) {
    next.pathname = next.pathname.replace(/^\/ghc/, "/api/github");
  }
  return next;
}

async function fetchAndNormalize(
  request: Request,
  route: Route,
  cacheKey: string,
): Promise<{ response: Response; envelope?: RuntimeCacheEnvelope; ttlSeconds: number }> {
  const upstream = await fetch(buildGithubUrl(route), {
    method: "GET",
    headers: buildGithubHeaders(route),
    signal: AbortSignal.timeout(8000),
  });

  const policy = getTtlPolicy(route, upstream.status);
  if (!policy.cacheable) {
    return {
      response: upstreamErrorResponse(upstream.status),
      ttlSeconds: 0,
    };
  }

  const envelope = await upstreamToEnvelope(request, upstream, route, policy);
  return {
    response: envelopeToResponse(envelope, "MISS", cacheKey),
    envelope,
    ttlSeconds: policy.freshSeconds + policy.staleSeconds,
  };
}

function buildGithubHeaders(route: Route): Headers {
  const headers = new Headers();
  headers.set("User-Agent", USER_AGENT);

  if (route.kind === "avatar") {
    headers.set("Accept", "image/png,image/*;q=0.8,*/*;q=0.5");
  } else {
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    if (process.env.GITHUB_TOKEN) {
      headers.set("Authorization", `Bearer ${process.env.GITHUB_TOKEN}`);
    }
  }

  return headers;
}

async function upstreamToEnvelope(
  request: Request,
  upstream: Response,
  route: Route,
  ttl: { freshSeconds: number; staleSeconds: number },
): Promise<RuntimeCacheEnvelope> {
  const rawBody = new Uint8Array(await upstream.arrayBuffer());
  const contentType = upstream.headers.get("Content-Type") ?? (route.kind === "avatar" ? "image/png" : "application/json; charset=utf-8");
  const publicBaseUrl = `${new URL(request.url).origin}/ghc`;
  const body = normalizeUpstreamBody(route, rawBody, contentType, publicBaseUrl);
  const now = Date.now();
  const headers: Record<string, string> = {
    "Content-Type": contentType,
  };

  const rateLimitRemaining = upstream.headers.get("X-RateLimit-Remaining");
  const rateLimitReset = upstream.headers.get("X-RateLimit-Reset");
  if (rateLimitRemaining) headers["X-Upstream-RateLimit-Remaining"] = rateLimitRemaining;
  if (rateLimitReset) headers["X-Upstream-RateLimit-Reset"] = rateLimitReset;

  return {
    status: upstream.status,
    headers,
    body: encodeBody(body, route.kind === "avatar" ? "base64" : "utf-8"),
    bodyEncoding: route.kind === "avatar" ? "base64" : "utf-8",
    freshUntil: now + ttl.freshSeconds * 1000,
    staleUntil: now + (ttl.freshSeconds + ttl.staleSeconds) * 1000,
  };
}

function envelopeToResponse(envelope: RuntimeCacheEnvelope, status: string, cacheKey: string): Response {
  const headers = new Headers(envelope.headers);
  const freshSeconds = Math.max(0, Math.floor((envelope.freshUntil - Date.now()) / 1000));
  const staleSeconds = Math.max(0, Math.floor((envelope.staleUntil - Math.max(Date.now(), envelope.freshUntil)) / 1000));
  headers.set("Cache-Control", `public, s-maxage=${freshSeconds}, stale-while-revalidate=${staleSeconds}`);
  headers.set("X-Cache", status);
  headers.set("X-Cache-Key", cacheKey);
  return new Response(decodeBody(envelope), {
    status: envelope.status,
    headers,
  });
}

function getTtlPolicy(route: Route, status: number): { freshSeconds: number; staleSeconds: number; cacheable: boolean } {
  if (status === 404) return { freshSeconds: 600, staleSeconds: 86_400, cacheable: true };
  if (status !== 200) return { freshSeconds: 0, staleSeconds: 0, cacheable: false };
  if (route.kind === "repo") return { freshSeconds: 21_600, staleSeconds: 604_800, cacheable: true };
  if (route.kind === "contents") return { freshSeconds: 86_400, staleSeconds: 1_209_600, cacheable: true };
  if (route.kind === "commits") return { freshSeconds: 3_600, staleSeconds: 604_800, cacheable: true };
  return { freshSeconds: 604_800, staleSeconds: 2_592_000, cacheable: true };
}

function upstreamErrorResponse(status: number): Response {
  if (status === 403 || status === 429) {
    return errorResponse(status, "GitHub rate limit or access restriction was returned and no runtime cache is available.", "upstream_rate_limited");
  }
  if (status >= 500) {
    return errorResponse(502, "GitHub upstream returned a temporary error and no runtime cache is available.", "upstream_error");
  }
  return errorResponse(status, "GitHub upstream returned an uncached response.", "upstream_error");
}

function buildRuntimeCacheKey(route: Route): string {
  const version = process.env.CACHE_NAMESPACE_VERSION || "v1";
  return ["ghcard", version, ...routeToCacheParts(route)].map(encodeURIComponent).join(":");
}

async function getRuntimeCache(): Promise<RuntimeCache | undefined> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
      getCache?: (options?: { namespace?: string }) => RuntimeCache;
    }>;
    const mod = await dynamicImport("@vercel/functions");
    return typeof mod.getCache === "function" ? mod.getCache({ namespace: CACHE_NAMESPACE }) : undefined;
  } catch {
    return undefined;
  }
}

function maybeHead(request: Request, response: Response): Response {
  return request.method === "HEAD" ? headResponse(response) : response;
}

function encodeBody(body: Uint8Array, encoding: RuntimeCacheEnvelope["bodyEncoding"]): string {
  if (encoding === "utf-8") return new TextDecoder().decode(body);

  let binary = "";
  for (const byte of body) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBody(envelope: RuntimeCacheEnvelope): Uint8Array | string {
  if (envelope.bodyEncoding === "utf-8") return envelope.body;

  const binary = atob(envelope.body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isRuntimeCacheEnvelope(value: unknown): value is RuntimeCacheEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Partial<RuntimeCacheEnvelope>;
  return (
    typeof envelope.status === "number" &&
    typeof envelope.body === "string" &&
    (envelope.bodyEncoding === "utf-8" || envelope.bodyEncoding === "base64") &&
    typeof envelope.freshUntil === "number" &&
    typeof envelope.staleUntil === "number" &&
    typeof envelope.headers === "object" &&
    envelope.headers !== null
  );
}
