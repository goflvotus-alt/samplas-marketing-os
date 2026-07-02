import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = await loadEnv();
const csvPath = process.argv[2];

if (!csvPath) {
  console.error("Usage: node scripts/upload-cafe24-csv-to-render.mjs /path/to/cafe24.csv");
  process.exit(1);
}

const baseUrl = (env.RENDER_DASHBOARD_URL || "https://samplas-marketing-os.onrender.com").replace(/\/$/, "");
const csvText = await readFile(csvPath, "utf8");
const headers = { "content-type": "application/json" };

if (env.CAFE24_PROXY_SECRET) {
  headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
}

if (env.CAFE24_PROXY_BASIC_AUTH) {
  headers.authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
}

const response = await fetch(`${baseUrl}/api/cafe24/csv/import`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    csvFile: basename(csvPath),
    csvText
  })
});

const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text };
}

if (!response.ok || body.error) {
  console.error(JSON.stringify({ status: response.status, body }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(body, null, 2));

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
