import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = await loadEnv();
const baseUrl = (env.RENDER_DASHBOARD_URL || "https://samplas-marketing-os.onrender.com").replace(/\/$/, "");
const headers = {};

if (env.CAFE24_PROXY_BASIC_AUTH) {
  headers.authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
}

const checks = [
  ["/api/status", "status"],
  ["/api/cafe24/orders?start_date=2026-06-01&end_date=2026-06-30&limit=500", "cafe24June"]
];

for (const [path, label] of checks) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  console.log(JSON.stringify({
    label,
    status: response.status,
    source: body.source || null,
    cacheMode: body.cacheMode || null,
    totals: body.totals || null,
    error: body.error || body.detail || null
  }, null, 2));
}

async function loadEnv() {
  const envPath = resolve(root, ".env");
  const parsed = { ...process.env };
  let text = "";
  try {
    text = await readFile(envPath, "utf8");
  } catch {
    return parsed;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!parsed[key]) parsed[key] = value;
  }
  return parsed;
}
