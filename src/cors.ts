import { getStringBinding } from "./env";

export type CorsDecision =
  | {
      allowed: true;
      allowOrigin?: string;
    }
  | {
      allowed: false;
      allowOrigin?: string;
    };

export function evaluateCors(request: Request, env: object): CorsDecision {
  const configuredOrigins = parseAllowedOrigins(getStringBinding(env, "ALLOWED_ORIGINS"));
  const origin = request.headers.get("Origin") ?? undefined;

  if (!origin) {
    return { allowed: true };
  }

  if (configuredOrigins.length === 0) {
    return { allowed: false };
  }

  if (configuredOrigins.includes(origin)) {
    return { allowed: true, allowOrigin: origin };
  }

  return { allowed: false };
}

export function corsHeaders(decision: CorsDecision): Headers {
  const headers = new Headers();
  if (decision.allowOrigin) {
    headers.set("Access-Control-Allow-Origin", decision.allowOrigin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, If-None-Match, If-Modified-Since");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

export function withCors(response: Response, decision: CorsDecision): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(decision)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
