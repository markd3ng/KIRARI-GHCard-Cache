import { readFileSync, writeFileSync } from "node:fs";

const configPath = new URL("../wrangler.jsonc", import.meta.url);
let configText = readFileSync(configPath, "utf8");

const replacements = [
  ["<production-kv-id>", process.env.CLOUDFLARE_KV_NAMESPACE_ID],
  ["<preview-kv-id>", process.env.CLOUDFLARE_PREVIEW_KV_NAMESPACE_ID],
];

let changed = false;
for (const [placeholder, value] of replacements) {
  if (value && configText.includes(placeholder)) {
    configText = configText.replaceAll(placeholder, value);
    changed = true;
  }
}

if (changed) {
  writeFileSync(configPath, configText);
  console.log("[cloudflare-config] Injected KV namespace IDs from environment variables.");
} else {
  console.log("[cloudflare-config] No KV namespace IDs were injected from environment variables.");
}
