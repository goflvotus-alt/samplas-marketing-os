import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ECOUNT_RUNNER_WORK_DIR, isCanonicalEcountRuntime } from "../server.mjs";

const realLock = join(ECOUNT_RUNNER_WORK_DIR, "ecount-inventory", ".sync-publish.lock");
// The real runner's lock: these tests must never create, replace or remove it.
const lockState = async () => {
  try { return `${(await stat(realLock)).mtimeMs}|${await readFile(realLock, "utf8")}`; } catch (error) { if (error.code === "ENOENT") return "absent"; throw error; }
};

test("only the repo work dir is the canonical ECOUNT runtime", () => {
  assert.equal(ECOUNT_RUNNER_WORK_DIR, fileURLToPath(new URL("../work", import.meta.url)));
  assert.equal(isCanonicalEcountRuntime(ECOUNT_RUNNER_WORK_DIR), true);
  assert.equal(isCanonicalEcountRuntime(`${ECOUNT_RUNNER_WORK_DIR}/`), true);
  assert.equal(isCanonicalEcountRuntime(join(tmpdir(), "scratch-work")), false);
});

function call(port, path, method = "GET") {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, method, headers: { host: "127.0.0.1" } }, (res) => {
      let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on("error", reject).end();
  });
}

// A server on a temp WORK_DIR whose own .env says ECOUNT_AUTO_SYNC=on. Even if the guard failed,
// the child could not reach ECOUNT or Render: credentials and the Render URL point nowhere.
async function withTempServer(childOverrides, run) {
  const dir = await mkdtemp(join(tmpdir(), "ecount-isolation-"));
  await mkdir(join(dir, "ecount-inventory"), { recursive: true });
  for (const name of ["product-registry.json", "product-registry-review-queue.json", "brand-commercial-policy.json", "brand-sourcing-master.json"]) await writeFile(join(dir, name), JSON.stringify({ entries: [], brands: [], policies: [] }));
  await writeFile(join(dir, "brand-master.json"), JSON.stringify({ brands: [] }));
  await writeFile(join(dir, ".env"), "ECOUNT_AUTO_SYNC=on\n");
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const env = { ...process.env, WORK_DIR: dir, HOST: "127.0.0.1", PORT: String(port), RENDER_DASHBOARD_URL: "http://127.0.0.1:9",
    ECOUNT_COM_CODE: "isolation-test", ECOUNT_USER_ID: "isolation-test", ECOUNT_API_CERT_KEY: "isolation-test", CAFE24_PROXY_BASE_URL: "", META_ACCESS_TOKEN: "", INSTAGRAM_ACCESS_TOKEN: "", ...childOverrides };
  delete env.ECOUNT_AUTO_SYNC;
  if (childOverrides.ECOUNT_AUTO_SYNC) env.ECOUNT_AUTO_SYNC = childOverrides.ECOUNT_AUTO_SYNC;
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (c) => { output += c; });
  child.stderr.on("data", (c) => { output += c; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
      child.stdout.on("data", (c) => { if (String(c).includes("running at")) { clearTimeout(timer); resolve(); } });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exit ${code}`)); });
    });
    await new Promise((resolve) => setTimeout(resolve, 1500)); // the boot-time scheduler check has run by now
    await run(port, () => output);
  } finally {
    child.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  }
}

test("temp WORK_DIR with ECOUNT_AUTO_SYNC=on in .env: scheduler, button and forced run never reach the runner", { timeout: 60000 }, async () => {
  const before = await lockState();
  await withTempServer({}, async (port, output) => {
    const status = (await call(port, "/api/ecount/inventory/sync")).body;
    assert.deepEqual([status.configured, status.canonicalRuntime, status.enabled], [true, false, false]);
    const forced = await call(port, "/api/ecount/inventory/sync", "POST");
    assert.equal(forced.body.ok, false);
    assert.match(forced.body.error, /non-canonical runtime/);
    assert.equal((await call(port, "/api/ecount/product-sync")).status, 404, "button route disabled");
    assert.equal((await call(port, "/api/ecount/product-sync", "POST")).status, 404);
    assert.doesNotMatch(output(), /\[ECOUNT_AUTO_SYNC\] \[1\/5\]|ECOUNT 전체 상품 sync/, "runner never logged a stage");
  });
  assert.equal(await lockState(), before, "real .sync-publish.lock untouched (stale lock left to the runner's own handling)");
});

test("test env ECOUNT_AUTO_SYNC=off beats the .env value", { timeout: 60000 }, async () => {
  const before = await lockState();
  await withTempServer({ ECOUNT_AUTO_SYNC: "off" }, async (port) => {
    const status = (await call(port, "/api/ecount/inventory/sync")).body;
    assert.deepEqual([status.configured, status.enabled], [false, false]);
  });
  assert.equal(await lockState(), before);
});

test("every test that spawns server.mjs pins ECOUNT_AUTO_SYNC=off", async () => {
  const { readdir } = await import("node:fs/promises");
  const dir = fileURLToPath(new URL(".", import.meta.url));
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".test.mjs") && f !== "ecount-runtime-isolation.test.mjs")) {
    const source = await readFile(join(dir, name), "utf8");
    if (!/spawn\(process\.execPath, \[[^\]]*server\.mjs/.test(source)) continue;
    assert.match(source, /ECOUNT_AUTO_SYNC: "off"/, name);
  }
});
