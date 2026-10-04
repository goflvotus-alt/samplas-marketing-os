import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createLocalEcountProductSyncRoute, uiResult, LOCAL_ACTION_HEADER, LOCAL_ACTION_VALUE } from "../scripts/local-ecount-helper.mjs";
import { runEcountSyncAndPublish, formatSummary } from "../scripts/run-ecount-product-sync-and-publish.mjs";

const ORIGINS = ["http://127.0.0.1:8787", "http://localhost:8787", "https://samplas-marketing-os.onrender.com"];
const okResult = {
  ok: true, stage: "done", productMaster: { totalProducts: 14_746 }, newProducts: 0, upload: { uploaded: ["a", "b", "c"] },
  onboarding: { approved: [], needsReview: [{ brandName: "PERSONSOUL" }, { brandName: "UNDER THE SIGN" }, { brandName: "PRAYING" }], blocked: { COLLABORATION: 4 } },
  verification: { failures: [] }
};

function call(handler, { method = "POST", origin, host = "127.0.0.1:8787", local = true, header = LOCAL_ACTION_VALUE } = {}) {
  return new Promise(resolve => {
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { resolve({ status: this.status, headers: this.headers || {}, body: body ? JSON.parse(body) : null }); } };
    const headers = { host, ...(origin ? { origin } : {}), ...(header ? { [LOCAL_ACTION_HEADER]: header } : {}) };
    handler({ method, headers }, res, { isLocal: local });
  });
}

test("disabled on Render: never runs ECOUNT there", async () => {
  let runs = 0;
  const route = createLocalEcountProductSyncRoute({ enabled: false, allowedOrigins: ORIGINS, run: async () => { runs += 1; } });
  const r = await call(route);
  assert.equal(r.status, 404);
  assert.match(r.body.error, /local-only/);
  assert.equal(runs, 0);
});

test("guards: foreign origin, non-loopback host and missing local header are rejected; preflight only for allowlisted origins", async () => {
  let runs = 0;
  const route = createLocalEcountProductSyncRoute({ enabled: true, allowedOrigins: ORIGINS, run: async () => { runs += 1; return { result: okResult, summary: "" }; } });
  assert.equal((await call(route, { origin: "https://evil.example" })).status, 403);
  assert.equal((await call(route, { origin: "https://evil.example", method: "OPTIONS" })).status, 403);
  assert.equal((await call(route, { local: false })).status, 403, "Host must be loopback");
  assert.equal((await call(route, { header: null })).status, 403, "custom header required");
  assert.equal(runs, 0);
  const preflight = await call(route, { method: "OPTIONS", origin: "https://samplas-marketing-os.onrender.com" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["Access-Control-Allow-Origin"], "https://samplas-marketing-os.onrender.com");
  assert.equal(preflight.headers["Access-Control-Allow-Private-Network"], "true");
  assert.match(preflight.headers["Access-Control-Allow-Headers"], new RegExp(LOCAL_ACTION_HEADER));
});

test("POST runs once, concurrent clicks get 409, GET reports running and the last summary", async () => {
  let release, runs = 0;
  const route = createLocalEcountProductSyncRoute({ enabled: true, allowedOrigins: ORIGINS, run: () => { runs += 1; return new Promise(r => { release = r; }); } });
  const first = call(route, { origin: "http://127.0.0.1:8787" });
  await new Promise(r => setTimeout(r, 10));
  assert.equal((await call(route, { method: "GET" })).body.running, true);
  const second = await call(route);
  assert.equal(second.status, 409);
  release({ result: okResult, summary: "ECOUNT SYNC COMPLETE" });
  const done = await first;
  assert.equal(done.status, 200);
  assert.equal(done.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:8787");
  assert.deepEqual([done.body.last.ok, done.body.last.products, done.body.last.newProducts, done.body.last.approvedCount, done.body.last.needsReviewCount], [true, 14_746, 0, 0, 3]);
  assert.equal(runs, 1);
  const status = await call(route, { method: "GET" });
  assert.deepEqual([status.body.available, status.body.running, status.body.last.summary], [true, false, "ECOUNT SYNC COMPLETE"]);
});

test("failures are reported, including a lock held by the .command run", async () => {
  const locked = createLocalEcountProductSyncRoute({ enabled: true, allowedOrigins: ORIGINS, run: async () => { throw new Error("이미 실행 중입니다 (pid 1)."); } });
  const r = await call(locked);
  assert.equal(r.body.ok, false);
  assert.match(r.body.last.error, /이미 실행 중/);

  // Real orchestrator with a failing ECOUNT sync: nothing uploaded, failure surfaces in the UI shape.
  const calls = [];
  const result = await runEcountSyncAndPublish({ workDir: await (await import("node:fs/promises")).mkdtemp((await import("node:path")).join((await import("node:os")).tmpdir(), "helper-")),
    sync: async () => { throw new Error("[Login 실패] 허용되지 않은 IP입니다."); }, upload: async () => calls.push("upload"), production: async () => calls.push("production") });
  const ui = uiResult(result, formatSummary(result));
  assert.deepEqual([ui.ok, ui.stage, calls.length], [false, "sync", 0]);
  assert.match(ui.error, /허용되지 않은 IP/);
});

test("server wiring: route is local-only, reuses the one-click runner, and is not the Render ECOUNT path", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const block = server.slice(server.indexOf("const localEcountProductSync = createLocalEcountProductSyncRoute"), server.indexOf("});", server.indexOf("const localEcountProductSync = createLocalEcountProductSyncRoute")));
  assert.match(block, /enabled: !env\.RENDER/);
  assert.match(block, /runEcountProductSyncFromEnv\(options\)/);
  assert.match(server, /url\.pathname === "\/api\/ecount\/product-sync"\) \{\n\s+return localEcountProductSync\(req, res, \{ isLocal: isLocalRequest\(req\) \}\);/);
});

// ---- browser button (outputs/ecount-product-sync.js) in a fake DOM ----
// Timers are shortened (4 s permission wait, 2 s polling) so the tests stay fast.
async function loadButton({ hostname = "127.0.0.1", fetchImpl }) {
  const source = await readFile(new URL("../outputs/ecount-product-sync.js", import.meta.url), "utf8");
  const listeners = {};
  const button = { disabled: false, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const status = { className: "", textContent: "", dataset: {} };
  const window = {};
  runInNewContext(source, { window, location: { hostname }, fetch: fetchImpl, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 30)), clearTimeout,
    document: { readyState: "complete", getElementById: id => ({ ecountProductSyncBtn: button, ecountProductSyncStatus: status })[id] || null } });
  await new Promise(r => setTimeout(r, 60));
  return { api: window.SamplasEcountSync, button, status, click: () => listeners.click() };
}
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const idleStatus = () => Promise.resolve(reply(200, { ok: true, available: true, running: false, last: null }));

test("button: offline helper and pending local-network permission are told apart; Production page targets loopback only", async () => {
  const offline = await loadButton({ hostname: "samplas-marketing-os.onrender.com", fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(offline.api.ENDPOINT, "http://127.0.0.1:8787/api/ecount/product-sync");
  assert.equal(offline.status.dataset.state, "offline");
  assert.match(offline.status.textContent, /로컬 ECOUNT 서비스가 실행 중이 아닙니다/);

  const methods = [];
  const pending = await loadButton({ hostname: "samplas-marketing-os.onrender.com", fetchImpl: (url, opts) => { methods.push(opts.method); return new Promise(() => {}); } });
  assert.equal(pending.status.dataset.state, "permission");
  assert.equal(pending.status.textContent, "Chrome에서 로컬 네트워크 접근 허용이 필요합니다. 주소창 또는 브라우저 권한 요청에서 허용한 뒤 다시 눌러주세요.");
  await pending.click();
  assert.equal(pending.status.dataset.state, "permission");
  assert.ok(!methods.includes("POST"), "no sync starts while the permission is pending");

  const local = await loadButton({ fetchImpl: idleStatus });
  assert.equal(local.api.ENDPOINT, "/api/ecount/product-sync");
  assert.equal(local.status.dataset.state, "idle");
});

test("button: 상태 확인 → 최신화 중 → Production 반영 확인 중 (retry shown) → 완료; double clicks send one POST", async () => {
  const requests = [];
  let release, progress = "[1/5] ECOUNT 전체 상품 sync…";
  const btn = await loadButton({ fetchImpl: (url, opts) => {
    requests.push(opts.method);
    if (opts.method === "GET") return Promise.resolve(reply(200, { ok: true, available: true, running: Boolean(release), progress, last: null }));
    assert.equal(opts.headers["x-samplas-local-action"], "ecount-product-sync");
    return new Promise(r => { release = r; });
  } });
  const running = btn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(btn.status.dataset.state, "running");
  assert.equal(btn.button.disabled, true);
  await btn.click();
  progress = "[5/5] Production 반영 확인 중 · 재시도 (시도 2/3, /api/brands/new, HTTP 502)";
  await new Promise(r => setTimeout(r, 80));
  assert.equal(btn.status.textContent, "Production 반영 확인 중 · 재시도 1/2");
  release(reply(200, { ok: true, last: uiResult({ ...okResult, verification: { failures: [], retries: 1 } }, "", "2026-10-04T09:40:00.000Z") }));
  await running;
  assert.equal(requests.filter(m => m === "POST").length, 1, "second click while running sends nothing");
  assert.equal(btn.button.disabled, false);
  assert.equal(btn.status.dataset.state, "done");
  assert.match(btn.status.textContent, /^14,746개 최신화 완료 · 신규 상품 \+0 · 신규 브랜드 0 · 검토 필요 3 · /);
});

test("button and helper never show an HTML error page", async () => {
  const html = "GET /api/brand-master → 502 <!DOCTYPE html><html><head><title>502</title></head></html>";
  const ui = uiResult({ ok: false, stage: "done", verification: { failures: [`/api/brand-master: ${html}`] } }, `ECOUNT SYNC — VERIFICATION FAILED\n${html}`);
  assert.deepEqual(ui.verificationFailures, ["Production 응답 오류 (HTTP 502)"]);
  assert.doesNotMatch(JSON.stringify(ui), /<!DOCTYPE|<html/i);
  const failing = await loadButton({ fetchImpl: async (url, opts) => opts.method === "GET"
    ? reply(200, { ok: true, running: false, last: null })
    : reply(200, { ok: false, last: { ok: false, stage: "verify-production", error: html, finishedAt: "2026-10-04T09:40:00.000Z" } }) });
  await failing.click();
  assert.equal(failing.status.dataset.state, "failed");
  assert.match(failing.status.textContent, /^실패 \(verify-production\): Production 응답 오류 \(HTTP 502\) · /);
  assert.doesNotMatch(failing.status.textContent, /</);
  const sync = await loadButton({ fetchImpl: async (url, opts) => opts.method === "GET"
    ? reply(200, { ok: true, running: false, last: null })
    : reply(200, { ok: false, last: uiResult({ ok: false, stage: "sync", error: "[Login 실패] 허용되지 않은 IP입니다." }, "") }) });
  await sync.click();
  assert.match(sync.status.textContent, /^실패 \(sync\): \[Login 실패\] 허용되지 않은 IP/);
});

test("helper exposes the runner's progress line (HTML-free) while a run is in flight", async () => {
  let release;
  const route = createLocalEcountProductSyncRoute({ enabled: true, allowedOrigins: ORIGINS, run: ({ log }) => {
    log("[5/5] Production 반영 확인 중 · 재시도 (시도 2/3, /api/brands/new, HTTP 502)");
    return new Promise(r => { release = r; });
  } });
  const post = call(route);
  await new Promise(r => setTimeout(r, 10));
  const during = await call(route, { method: "GET" });
  assert.equal(during.body.running, true);
  assert.match(during.body.progress, /^\[5\/5\] Production 반영 확인 중 · 재시도/);
  release({ result: okResult, summary: "" });
  await post;
  assert.equal((await call(route, { method: "GET" })).body.progress, null);
});
