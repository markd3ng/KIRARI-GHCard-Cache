import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const rootDir = new URL("..", import.meta.url).pathname;
const configPath = new URL("../wrangler.jsonc", import.meta.url);
const binding = "GITHUB_CACHE";

let configText = readFileSync(configPath, "utf8");

const currentKvId = configText.match(/"id"\s*:\s*"([^"]+)"/)?.[1] ?? "";
if (currentKvId && !isPlaceholder(currentKvId)) {
  removePreviewId();
  writeFileSync(configPath, configText);
  console.log(`[cloudflare-config] KV namespace already configured: ${currentKvId}`);
  process.exit(0);
}

let kvId = "";
if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
  kvId = ensureKvNamespace(binding);
}

if (!kvId) {
  removePreviewId();
  writeFileSync(configPath, configText);
  console.log("[cloudflare-config] No KV namespace ID was injected.");
  console.log("[cloudflare-config] Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to let CI create or reuse the KV namespace automatically.");
  process.exit(0);
}

configText = configText.replace(/"id"\s*:\s*"[^"]*"/, `"id": "${kvId}"`);
removePreviewId();
writeFileSync(configPath, configText);
console.log(`[cloudflare-config] Configured ${binding} with KV namespace ${kvId}.`);

function ensureKvNamespace(title) {
  const existing = findNamespace(title);
  if (existing) {
    console.log(`[cloudflare-config] Reusing Workers KV namespace "${existing.title}" (${existing.id}).`);
    return existing.id;
  }

  console.log(`[cloudflare-config] Creating Workers KV namespace "${title}".`);
  const create = runWrangler(["kv", "namespace", "create", title]);
  if (create.status !== 0) {
    process.stderr.write(create.stderr);
    process.stdout.write(create.stdout);
    process.exit(create.status ?? 1);
  }

  const createdId = create.stdout.match(/"id"\s*:\s*"([^"]+)"/)?.[1];
  if (createdId) return createdId;

  const created = findNamespace(title);
  if (created) return created.id;

  console.error(`[cloudflare-config] Created namespace "${title}", but could not resolve its id from Wrangler output.`);
  process.exit(1);
}

function findNamespace(title) {
  const list = runWrangler(["kv", "namespace", "list"]);
  if (list.status !== 0) {
    process.stderr.write(list.stderr);
    process.stdout.write(list.stdout);
    process.exit(list.status ?? 1);
  }

  const namespaces = JSON.parse(list.stdout);
  return namespaces.find((namespace) => namespace.title === title || namespace.title.endsWith(`-${title}`));
}

function runWrangler(args) {
  return spawnSync(wranglerBin(), args, {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env,
  });
}

function wranglerBin() {
  const command = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
  return join(rootDir, "node_modules", ".bin", command);
}

function removePreviewId() {
  configText = configText.replace(/,\n\s*"preview_id"\s*:\s*"[^"]*"/, "");
}

function isPlaceholder(value) {
  return !value || /^<[^>]+>$/.test(value);
}
