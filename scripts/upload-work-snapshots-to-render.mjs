import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = await loadEnv();
const overwrite = process.argv.includes("--overwrite");
const requested = process.argv.slice(2).filter((arg) => arg !== "--overwrite");
const relativePaths = requested.length ? requested : [
  ...Array.from({ length: 7 }, (_, index) => `ecount-sales/2026-${String(index + 1).padStart(2, "0")}.json`),
  "ecount-inventory/latest.json",
  "ecount-inventory/diagnostic.json"
];

const files = await Promise.all(relativePaths.map(async (relativePath) => ({
  relativePath,
  jsonText: await readFile(join(root, "work", ...relativePath.split("/")), "utf8")
})));

const baseUrl = (env.RENDER_DASHBOARD_URL || "https://samplas-marketing-os.onrender.com").replace(/\/$/, "");
const headers = { "content-type": "application/json" };
if (env.CAFE24_PROXY_SECRET) headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
if (env.CAFE24_PROXY_BASIC_AUTH) {
  headers.authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
}

const response = await fetch(`${baseUrl}/api/work-data/upload`, {
  method: "POST",
  headers,
  body: JSON.stringify({ overwrite, files })
});
const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 500) };
}
if (!response.ok || body.error) {
  console.error(JSON.stringify({ status: response.status, body }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));

async function loadEnv() {
  const parsed = { ...process.env };
  try {
    const text = await readFile(join(root, ".env"), "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      if (!parsed[key]) parsed[key] = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  return parsed;
}
