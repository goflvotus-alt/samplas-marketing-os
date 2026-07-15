import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { URL } from "node:url";

const root = resolve(".");
const env = await loadEnv();
const host = env.INTELLIGENCE_HOST || env.HOST || "127.0.0.1";
const port = Number(env.INTELLIGENCE_PORT || 8797);
const workRoot = resolve(env.WORK_DIR || join(root, "work"));
const intelligenceWorkDir = join(workRoot, "intelligence");

await mkdir(intelligenceWorkDir, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname === "/api/intelligence/health") {
      return json(res, {
        ok: true,
        service: "samplas-intelligence-service",
        timestamp: new Date().toISOString(),
        workDir: intelligenceWorkDir
      });
    }
    return json(res, {
      ok: false,
      error: "Not Found"
    }, 404);
  } catch {
    return json(res, {
      ok: false,
      error: "Internal Server Error"
    }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`SAMPLAS Intelligence Service running at http://${host}:${port}`);
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`SAMPLAS Intelligence Service cannot start: http://${host}:${port} is already in use.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

function json(res, payload, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return { ...process.env };
  const text = await readFile(envPath, "utf8");
  const parsed = { ...process.env };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key]) continue;
    parsed[key] = value;
  }
  return parsed;
}
