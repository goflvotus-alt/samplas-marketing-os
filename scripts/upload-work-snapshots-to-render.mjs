import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RENDER_SNAPSHOT_EXPLICIT_PATHS,
  RENDER_SNAPSHOT_MONTHLY_PATTERN,
  isAllowedRenderSnapshotPath
} from "./render-snapshot-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monthlyPathPattern = RENDER_SNAPSHOT_MONTHLY_PATTERN;
const explicitPaths = RENDER_SNAPSHOT_EXPLICIT_PATHS;
const allowedPath = isAllowedRenderSnapshotPath;

export async function discoverWorkSnapshotPaths(workDir = join(root, "work")) {
  const found = [...explicitPaths];
  for (const directory of ["ecount-sales", "monthly"]) {
    const entries = await readdir(join(workDir, directory), { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const relativePath = `${directory}/${entry.name}`;
      if (entry.isFile() && monthlyPathPattern.test(relativePath)) found.push(relativePath);
    }
  }
  const existing = [];
  for (const relativePath of [...new Set(found)].sort()) {
    try {
      await readFile(join(workDir, ...relativePath.split("/")), "utf8");
      existing.push(relativePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return existing;
}

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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const overwrite = process.argv.includes("--overwrite");
  const requested = process.argv.slice(2).filter((arg) => !["--dry-run", "--overwrite"].includes(arg));
  if (requested.some((relativePath) => !allowedPath(relativePath))) throw new Error("허용되지 않은 work 데이터 경로가 포함되어 있습니다.");
  const discovered = await discoverWorkSnapshotPaths();
  const relativePaths = requested.length
    ? discovered.filter((relativePath) => requested.includes(relativePath)).sort()
    : discovered;
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, files: relativePaths }, null, 2));
    return;
  }

  const files = await Promise.all(relativePaths.map(async (relativePath) => ({
    relativePath,
    jsonText: await readFile(join(root, "work", ...relativePath.split("/")), "utf8")
  })));
  const env = await loadEnv();
  const baseUrl = (env.RENDER_DASHBOARD_URL || "https://samplas-marketing-os.onrender.com").replace(/\/$/, "");
  const headers = { "content-type": "application/json" };
  if (env.CAFE24_PROXY_SECRET) headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
  if (env.CAFE24_PROXY_BASIC_AUTH) headers.authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;

  const response = await fetch(`${baseUrl}/api/work-data/upload`, {
    method: "POST",
    headers,
    body: JSON.stringify({ overwrite, files })
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  if (!response.ok || body.error) throw new Error(JSON.stringify({ status: response.status, body }, null, 2));
  console.log(JSON.stringify(body, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
