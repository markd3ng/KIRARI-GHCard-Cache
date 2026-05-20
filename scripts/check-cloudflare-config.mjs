import { readFileSync } from "node:fs";

const configPath = new URL("../wrangler.jsonc", import.meta.url);
const configText = readFileSync(configPath, "utf8");

const placeholderPattern = /<[^>]+>/;
const kvIdPattern = /"id"\s*:\s*"([^"]+)"/;
const previewKvIdPattern = /"preview_id"\s*:\s*"([^"]+)"/;

const kvId = configText.match(kvIdPattern)?.[1] ?? "";
const previewKvId = configText.match(previewKvIdPattern)?.[1] ?? "";
const invalidValues = [
  ["id", kvId],
  ["preview_id", previewKvId],
].filter(([, value]) => !value || placeholderPattern.test(value));

if (invalidValues.length > 0) {
  console.error("[cloudflare-config] Invalid Workers KV namespace configuration.");
  console.error("");
  console.error("wrangler.jsonc still contains placeholder KV namespace IDs:");
  for (const [field, value] of invalidValues) {
    console.error(`- kv_namespaces[0].${field}: ${value || "<missing>"}`);
  }
  console.error("");
  console.error("Create real KV namespaces and replace the placeholders before deploying:");
  console.error("  pnpm wrangler kv namespace create GITHUB_CACHE");
  console.error("  pnpm wrangler kv namespace create GITHUB_CACHE --preview");
  console.error("");
  console.error("Then copy the returned id and preview_id into wrangler.jsonc.");
  process.exit(1);
}

console.log("[cloudflare-config] Cloudflare KV namespace IDs are configured.");
