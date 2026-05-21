import { readFileSync } from "node:fs";

const configPath = new URL("../wrangler.jsonc", import.meta.url);
const configText = readFileSync(configPath, "utf8");

const kvId = configText.match(/"id"\s*:\s*"([^"]+)"/)?.[1] ?? "";

if (!kvId || /^<[^>]+>$/.test(kvId)) {
  console.error("[cloudflare-config] Invalid Workers KV namespace configuration.");
  console.error("");
  console.error(`wrangler.jsonc still contains a placeholder KV namespace id: ${kvId || "<missing>"}`);
  console.error("");
  console.error("For GitHub Actions one-click deploy, set only these repository secrets:");
  console.error("  CLOUDFLARE_ACCOUNT_ID");
  console.error("  CLOUDFLARE_API_TOKEN");
  console.error("");
  console.error("The deploy workflow runs pnpm cf:prepare-config before this check.");
  console.error("That step creates or reuses the GITHUB_CACHE KV namespace and injects its id into wrangler.jsonc.");
  console.error("");
  console.error("For manual deploy, either run pnpm cf:prepare-config with Cloudflare credentials in the environment,");
  console.error("or replace <production-kv-id> in wrangler.jsonc yourself.");
  process.exit(1);
}

console.log(`[cloudflare-config] Cloudflare KV namespace id is configured: ${kvId}`);
