import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request, createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isApiRequestAllowed } from "../server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const basic = (value) => `Basic ${Buffer.from(value).toString("base64")}`;
const fakeReq = (headers = {}, remoteAddress = "10.0.0.5") => ({ headers, socket: { remoteAddress } });

test("gate decision: public allowlist, AI audit prefix, loopback needs a loopback socket, rollback switch", () => {
  for (const path of ["/api/operator/session", "/api/cafe24/oauth/callback", "/api/meta/oauth/callback", "/api/ai-audit/health"]) {
    assert.equal(isApiRequestAllowed(fakeReq(), path, { readAuth: undefined }), true, path);
  }
  for (const path of ["/api/sales/total", "/api/intelligence/clients", "/api/brand-master", "/api/status", "/api/cafe24/oauth/start"]) {
    assert.equal(isApiRequestAllowed(fakeReq(), path, { readAuth: undefined }), false, path);
  }
  // A forged local Host header from a remote socket is not local.
  assert.equal(isApiRequestAllowed(fakeReq({ host: "localhost" }), "/api/sales/total", { readAuth: undefined }), false);
  assert.equal(isApiRequestAllowed(fakeReq({ host: "127.0.0.1:8787" }, "127.0.0.1"), "/api/sales/total", { readAuth: undefined }), true);
  assert.equal(isApiRequestAllowed(fakeReq({ "x-samplas-internal-token": "anything" }), "/api/sales/total", { readAuth: undefined }), false);
  assert.equal(isApiRequestAllowed(fakeReq(), "/api/sales/total", { readAuth: "off" }), true);
});

function call(port, path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: "production.example", ...headers } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("HTTP: anonymous reads are refused; Basic, operator session and /healthz work; wrong credentials do not", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "api-read-auth-"));
  await writeFile(join(dir, "brand-master.json"), JSON.stringify({ brands: [{ brand_code: "B0000001", brand_name: "ONE", active: true }] }));
  for (const name of ["product-registry.json", "product-registry-review-queue.json", "brand-commercial-policy.json", "brand-sourcing-master.json"]) await writeFile(join(dir, name), JSON.stringify({ entries: [], brands: [], policies: [] }));
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [join(root, "server.mjs")], { cwd: dir, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WORK_DIR: dir, HOST: "127.0.0.1", PORT: String(port), CAFE24_PROXY_BASIC_AUTH: "proxy:correct", SAMPLAS_OPERATOR_BASIC_AUTH: "op:correct",
      API_READ_AUTH: "", CAFE24_PROXY_BASE_URL: "", META_ACCESS_TOKEN: "", INSTAGRAM_ACCESS_TOKEN: "", DROPBOX_REFRESH_TOKEN: "", NAVER_ADS_API_KEY: "" } });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
      child.stdout.on("data", (c) => { if (String(c).includes("running at")) { clearTimeout(timer); resolve(); } });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exit ${code}`)); });
    });
    assert.equal((await call(port, "/healthz")).status, 200);
    for (const path of ["/api/brand-master", "/api/intelligence/clients?since=2026-09-01&until=2026-09-30", "/api/status", "/api/sales/total"]) {
      assert.equal((await call(port, path)).status, 401, `anonymous ${path}`);
    }
    assert.equal((await call(port, "/api/brand-master", { headers: { authorization: basic("proxy:wrong") } })).status, 401);
    assert.equal((await call(port, "/api/brand-master", { headers: { cookie: "samplas_operator=forged" } })).status, 401);
    const viaBasic = await call(port, "/api/brand-master", { headers: { authorization: basic("proxy:correct") } });
    assert.equal(viaBasic.status, 200);
    assert.equal(JSON.parse(viaBasic.body).brands.length, 1);
    // The proxy credential is not an operator login; the operator login yields an HttpOnly session cookie.
    assert.equal((await call(port, "/api/operator/session", { method: "POST", headers: { authorization: basic("proxy:correct") } })).status, 401);
    const login = await call(port, "/api/operator/session", { method: "POST", headers: { authorization: basic("op:correct") } });
    assert.equal(login.status, 200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    assert.match(String(login.headers["set-cookie"]), /HttpOnly; SameSite=Strict/);
    assert.equal((await call(port, "/api/brand-master", { headers: { cookie } })).status, 200);
    // The AI audit prefix keeps its own secret: neither the session nor Basic opens it.
    assert.equal((await call(port, "/api/ai-audit/health", { headers: { cookie } })).status, 401);
    assert.equal((await call(port, "/api/ai-audit/health", { headers: { authorization: basic("proxy:correct") } })).status, 401);
  } finally {
    child.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser bundle: every API helper goes through the operator-session retry and holds no credential", async () => {
  const frontend = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  for (const helper of ["fetchJson", "postJson", "patchJson"]) {
    const body = frontend.slice(frontend.indexOf(`async function ${helper}(`), frontend.indexOf(`async function ${helper}(`) + 400);
    assert.match(body, /fetchWithOperatorSession\(url,/, helper);
  }
  assert.doesNotMatch(frontend, /CAFE24_PROXY_BASIC_AUTH|SAMPLAS_OPERATOR_BASIC_AUTH|AI_AUDIT_SECRET/);
});
