import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runEcountSyncAndPublish, formatSummary, PUBLISH_FILES, PUBLISH_BATCHES } from "../scripts/run-ecount-product-sync-and-publish.mjs";
import { syncEcountInventory } from "../scripts/sync-ecount-inventory.mjs";
import * as queue from "../scripts/pending-brand-queue.mjs";

const env = { ECOUNT_COM_CODE: "c", ECOUNT_USER_ID: "u", ECOUNT_API_CERT_KEY: "k" };
const filler = n => Array.from({ length: n }, (_, i) => ({ PROD_CD: `P${String(i).padStart(6, "0")}`, PROD_DES: `FILLER / ${i}` }));
const named = [{ PROD_CD: "FRL001", PROD_DES: "Fresh Label / Coat" }, { PROD_CD: "NXT001", PROD_DES: "Next Season / Jacket" }];

// Offline ECOUNT: Zone, Login, PROD_CD-paged products (10,000 cap), inventory.
function ecount(rows, { loginError = false } = {}) {
  const sorted = [...rows].sort((a, b) => (a.PROD_CD < b.PROD_CD ? -1 : 1)).map(r => ({ IN_PRICE: "500", OUT_PRICE: "1000", ...r }));
  return async (url, body) => {
    if (url.includes("/Zone")) return { httpStatus: 200, body: { Data: { ZONE: "AC" } } };
    if (url.includes("/OAPILogin")) return { httpStatus: 200, body: loginError ? { Data: { Code: "205", Message: "허용되지 않은 IP입니다." } } : { Data: { Datas: { SESSION_ID: "s-1234" } } } };
    if (url.includes("GetBasicProductsList")) return { httpStatus: 200, body: { Data: { Result: sorted.filter(r => !body.FROM_PROD_CD || (r.PROD_CD >= body.FROM_PROD_CD && r.PROD_CD <= body.TO_PROD_CD)).slice(0, 10_000) } } };
    return { httpStatus: 200, body: { Data: { Result: [] } } };
  };
}

async function localWork(previous = 10_500) {
  const dir = await mkdtemp(join(tmpdir(), "sync-publish-local-"));
  await mkdir(join(dir, "ecount-inventory"));
  const out = join(dir, "ecount-inventory");
  // Seed canonical through a real sync so every file has the production shape.
  await syncEcountInventory({ env, outDir: out, request: ecount(filler(previous)), delayMs: 0 });
  return dir;
}

// A stand-in Production: files land in prodDir; refresh runs the real pending-brand code.
async function fakeProduction() {
  const prodDir = await mkdtemp(join(tmpdir(), "sync-publish-prod-"));
  for (const sub of ["ecount-inventory", "ecount-sales", "intelligence"]) await mkdir(join(prodDir, sub));
  const files = {
    "brand-master.json": { brands: [{ brand_code: "STALE7", brand_name: "Legacy Seven", active: false, name_aliases: [], nameSource: "suggested" }] },
    "intelligence/brand-master-list.json": [], "intelligence/brand-aliases.json": []
  };
  for (const [name, value] of Object.entries(files)) await writeFile(join(prodDir, name), JSON.stringify(value));
  const cafe24Brands = [{ brand_code: "STALE7", brand_name: "Next Season" }, { brand_code: "FRESH1", brand_name: "Fresh Label" }];
  const build = brands => ({ brands: brands.map(b => ({ id: b.brand_code, name: b.brand_name, active: b.active })), aliases: [] });
  const calls = [];
  const production = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "POST" && path.startsWith("/api/pending-brands/refresh")) {
      const load = async () => ({ ...(await queue.loadPendingBrandSources(prodDir, "2026-10")), cafe24Brands });
      return { ok: true, ...(await queue.refreshPendingBrands(prodDir, load, { dryRun: path.includes("dryRun=1"), autoApprove: body?.autoApprove === true, buildCompatibility: build })) };
    }
    if (path.startsWith("/api/inventory/overview")) throw new Error("inventory overview must not be called by the one-click run");
    if (path === "/api/pending-brands") return { ok: true, ...(await queue.readPendingBrands(prodDir)) };
    if (path === "/api/brand-master") return JSON.parse(await readFile(join(prodDir, "brand-master.json"), "utf8"));
    if (path === "/api/brands/new") return { count: 0, brands: [] };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { prodDir, calls, production };
}

const uploader = (localDir, prodDir, uploads, { fail = false, failOn = 0 } = {}) => async relativePaths => {
  uploads.push(relativePaths);
  if (fail || uploads.length === failOn) throw new Error("upload 502");
  for (const p of relativePaths) await copyFile(join(localDir, p), join(prodDir, p));
  return { ok: true, uploaded: relativePaths };
};
const canonical = async dir => Promise.all(["raw-products.json", "latest.json", "diagnostic.json", "product-master.json"].map(f => readFile(join(dir, "ecount-inventory", f), "utf8")));

test("success: local sync → upload of exactly 3 files → NEW-only onboarding; reassignment stays for review; re-run is a no-op", async () => {
  const local = await localWork();
  const { prodDir, calls, production } = await fakeProduction();
  try {
    const uploads = [];
    const run = () => runEcountSyncAndPublish({ workDir: local, sync: () => syncEcountInventory({ env, outDir: join(local, "ecount-inventory"), request: ecount([...filler(10_600), ...named]), delayMs: 0 }), upload: uploader(local, prodDir, uploads), production });
    const first = await run();
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(uploads, [["ecount-inventory/latest.json", "ecount-inventory/diagnostic.json"], ["ecount-inventory/product-master.json"]], "two proven-size requests, product-master last");
    assert.deepEqual(PUBLISH_BATCHES.flat(), [...PUBLISH_FILES]);
    assert.deepEqual(PUBLISH_FILES, ["ecount-inventory/latest.json", "ecount-inventory/diagnostic.json", "ecount-inventory/product-master.json"]);
    assert.equal(first.productMaster.totalProducts, 10_602);
    assert.equal(first.newProducts, 102);
    assert.deepEqual(calls.filter(c => c.method === "POST").map(c => [c.path, c.body]), [["/api/pending-brands/refresh", { autoApprove: true }]]);
    assert.ok(!calls.some(c => c.path.includes("/review")), "never calls the manual reassignment route");
    assert.deepEqual(first.onboarding.approved.map(a => [a.brandName, a.action]), [["Fresh Label", "NEW"]]);
    assert.deepEqual(first.onboarding.needsReview.map(c => c.brandName), ["Next Season"]);
    assert.equal(first.onboarding.provenance.ecountProductSource, "ecount-inventory/product-master.json");
    assert.deepEqual(first.verification.provenance, { ok: true, source: "ecount-inventory/product-master.json", count: 10_602, at: first.productMaster.fetchedAt });
    assert.deepEqual(first.verification.failures, []);
    assert.deepEqual(first.verification.pending.needsReview.map(c => c.brandName), ["Next Season"]);
    assert.equal(first.verification.brandMaster.brands, 2);
    assert.ok(!calls.some(c => c.path.startsWith("/api/inventory/overview")), "inventory overview is never requested");
    assert.deepEqual(calls.filter(c => c.method === "GET").map(c => c.path), ["/api/brand-master", "/api/brands/new", "/api/pending-brands"]);
    const master = JSON.parse(await readFile(join(prodDir, "brand-master.json"), "utf8"));
    assert.deepEqual(master.brands.map(b => b.brand_code).sort(), ["FRESH1", "STALE7"]);
    assert.equal(master.brands.find(b => b.brand_code === "STALE7").supersededBy, undefined);
    assert.match(formatSummary(first), /ECOUNT SYNC COMPLETE[\s\S]*New brands onboarded: 1[\s\S]*Fresh Label[\s\S]*Needs review:\n- Next Season — inactive code reassignment/);

    const second = await run();
    assert.equal(second.ok, true);
    assert.equal(second.onboarding.approved.length, 0, "no duplicate onboarding");
    assert.equal(second.newProducts, 0);
    assert.equal(JSON.parse(await readFile(join(prodDir, "brand-master.json"), "utf8")).brands.length, 2);
  } finally { for (const d of [local, prodDir]) await rm(d, { recursive: true, force: true }); }
});

test("ECOUNT failure or invalid product-master: nothing uploaded, Production untouched", async () => {
  for (const scenario of ["login", "drop", "invalid-master"]) {
    const local = await localWork();
    const { prodDir, calls, production } = await fakeProduction();
    try {
      const before = await canonical(local);
      const uploads = [];
      const sync = scenario === "invalid-master"
        ? async () => { await writeFile(join(local, "ecount-inventory/product-master.json"), JSON.stringify({ schemaVersion: 1, complete: false, totalProducts: 0, products: [] })); return { productCount: 0 }; }
        : () => syncEcountInventory({ env, outDir: join(local, "ecount-inventory"), request: scenario === "login" ? ecount(filler(10_600), { loginError: true }) : ecount(filler(4_000)), delayMs: 0 });
      const result = await runEcountSyncAndPublish({ workDir: local, sync, upload: uploader(local, prodDir, uploads), production });
      assert.equal(result.ok, false, scenario);
      assert.ok(result.error, scenario);
      assert.deepEqual(uploads, [], `${scenario}: no upload`);
      assert.deepEqual(calls, [], `${scenario}: no Production call`);
      if (scenario !== "invalid-master") assert.deepEqual(await canonical(local), before, `${scenario}: local canonical kept`);
      assert.match(formatSummary(result), /Production에는 아무것도 반영하지 않았습니다/);
    } finally { for (const d of [local, prodDir]) await rm(d, { recursive: true, force: true }); }
  }
});

test("upload failure (first or second request): onboarding is not attempted, partial upload is reported", async () => {
  for (const [failOn, uploaded, message] of [[1, [], /아무것도 반영하지 않았습니다/], [2, ["ecount-inventory/latest.json", "ecount-inventory/diagnostic.json"], /일부 파일만 반영됐습니다[\s\S]*onboarding 미실행/]]) {
    const local = await localWork();
    const { prodDir, calls, production } = await fakeProduction();
    try {
      const result = await runEcountSyncAndPublish({ workDir: local, sync: () => syncEcountInventory({ env, outDir: join(local, "ecount-inventory"), request: ecount([...filler(10_600), ...named]), delayMs: 0 }), upload: uploader(local, prodDir, [], { failOn }), production });
      assert.equal(result.ok, false);
      assert.equal(result.stage, "upload");
      assert.deepEqual(result.upload.uploaded, uploaded);
      assert.deepEqual(calls, []);
      assert.match(formatSummary(result), message);
    } finally { for (const d of [local, prodDir]) await rm(d, { recursive: true, force: true }); }
  }
});

test("onboarding failure keeps the published inventory and is reported", async () => {
  const local = await localWork();
  const { prodDir } = await fakeProduction();
  try {
    const uploads = [];
    const result = await runEcountSyncAndPublish({ workDir: local, sync: () => syncEcountInventory({ env, outDir: join(local, "ecount-inventory"), request: ecount([...filler(10_600), ...named]), delayMs: 0 }),
      upload: uploader(local, prodDir, uploads), production: async (method, path) => { if (method === "POST") throw new Error("refresh 500"); return {}; } });
    assert.equal(result.ok, false);
    assert.equal(uploads.length, 2);
    assert.equal(result.onboarding.error, "refresh 500");
    assert.match(formatSummary(result), /ONBOARDING FAILED[\s\S]*상품 마스터 업로드는 반영된 상태/);
  } finally { for (const d of [local, prodDir]) await rm(d, { recursive: true, force: true }); }
});

test("dry run: no ECOUNT call, no upload, Production refresh with dryRun=1 only", async () => {
  const local = await localWork();
  const { prodDir, calls, production } = await fakeProduction();
  try {
    for (const f of PUBLISH_FILES) await copyFile(join(local, f), join(prodDir, f));
    const masterBefore = await readFile(join(prodDir, "brand-master.json"), "utf8");
    let synced = false; const uploads = [];
    const result = await runEcountSyncAndPublish({ workDir: local, dryRun: true, sync: async () => { synced = true; }, upload: uploader(local, prodDir, uploads), production });
    assert.equal(result.ok, true, result.error);
    assert.equal(synced, false);
    assert.deepEqual(uploads, []);
    assert.deepEqual(calls.filter(c => c.method === "POST").map(c => [c.path, c.body]), [["/api/pending-brands/refresh?dryRun=1", {}]]);
    assert.equal(await readFile(join(prodDir, "brand-master.json"), "utf8"), masterBefore);
  } finally { for (const d of [local, prodDir]) await rm(d, { recursive: true, force: true }); }
});

test("a second concurrent run is refused; a stale lock from a dead process is cleared", async () => {
  const local = await localWork();
  const { prodDir, production } = await fakeProduction();
  try {
    let release;
    const slow = runEcountSyncAndPublish({ workDir: local, sync: () => new Promise(r => { release = r; }), upload: async () => ({}), production });
    await new Promise(r => setTimeout(r, 20));
    await assert.rejects(runEcountSyncAndPublish({ workDir: local, sync: async () => ({}), upload: async () => ({}), production }), /이미 실행 중/);
    release({ productCount: 10_500 });
    await slow;
    await writeFile(join(local, "ecount-inventory/.sync-publish.lock"), JSON.stringify({ pid: 999999, startedAt: "old" }));
    const after = await runEcountSyncAndPublish({ workDir: local, dryRun: true, sync: async () => ({}), upload: async () => ({}), production });
    assert.equal(after.stage, "done");
  } finally { for (const d of [local, prodDir]) await rm(d, { recursive: true, force: true }); }
});

test("verification fails when Production does not read exactly the uploaded product-master", async () => {
  for (const [label, tamper, pattern] of [
    ["count mismatch", p => ({ ...p, ecountProductCount: p.ecountProductCount - 1 }), /상품 수 .* ≠ 로컬/],
    ["wrong source", p => ({ ...p, ecountProductSource: "ecount-inventory/raw-products.json" }), /출처가 다릅니다/],
    ["missing timestamp", p => ({ ...p, ecountProductsAt: null }), /ecountProductsAt/]
  ]) {
    const local = await localWork();
    const { prodDir, calls, production } = await fakeProduction();
    try {
      const tampered = async (method, path, body) => {
        const response = await production(method, path, body);
        return method === "POST" ? { ...response, provenance: tamper(response.provenance) } : response;
      };
      const result = await runEcountSyncAndPublish({ workDir: local, sync: () => syncEcountInventory({ env, outDir: join(local, "ecount-inventory"), request: ecount([...filler(10_600), ...named]), delayMs: 0 }), upload: uploader(local, prodDir, []), production: tampered });
      assert.equal(result.ok, false, label);
      assert.equal(result.verification.provenance.ok, false, label);
      assert.match(result.verification.failures.join("\n"), pattern, label);
      assert.match(formatSummary(result), /VERIFICATION FAILED[\s\S]*Verification failed:/, label);
      assert.ok(!calls.some(c => c.path.startsWith("/api/inventory/overview")), label);
    } finally { for (const d of [local, prodDir]) await rm(d, { recursive: true, force: true }); }
  }
});

test("verification GETs retry transient 502/503/504 and network errors; auth errors fail at once; messages carry no HTML", async () => {
  const html = "<!DOCTYPE html><html><head><title>502</title></head><body>bad gateway</body></html>";
  const httpError = status => Object.assign(new Error(`GET → HTTP ${status}`), { status, body: html });
  for (const [label, failures, expectOk, pattern, expectedCalls] of [
    ["502 then success", [httpError(502)], true, null, 2],
    ["network error then success", [new TypeError("fetch failed")], true, null, 2],
    ["502 three times", [httpError(502), httpError(503), httpError(504)], false, /\/api\/brands\/new: Production 확인 실패 \(HTTP 504\)/, 3],
    ["401 is not retried", [httpError(401)], false, /\/api\/brands\/new: Production 확인 실패 \(HTTP 401\)/, 1]
  ]) {
    const local = await localWork();
    const { prodDir, production } = await fakeProduction();
    try {
      const queueOfFailures = [...failures];
      let brandsNewCalls = 0;
      const logs = [];
      const flaky = async (method, path, body) => {
        if (method === "GET" && path === "/api/brands/new") {
          brandsNewCalls += 1;
          if (queueOfFailures.length) throw queueOfFailures.shift();
        }
        return production(method, path, body);
      };
      const result = await runEcountSyncAndPublish({ workDir: local, retryDelayMs: 0, log: l => logs.push(l),
        sync: () => syncEcountInventory({ env, outDir: join(local, "ecount-inventory"), request: ecount([...filler(10_600), ...named]), delayMs: 0 }), upload: uploader(local, prodDir, []), production: flaky });
      assert.equal(result.ok, expectOk, label);
      assert.equal(brandsNewCalls, expectedCalls, label);
      const summary = formatSummary(result);
      assert.doesNotMatch(summary, /<!DOCTYPE|<html|<body/i, `${label}: no HTML in the summary`);
      if (expectOk) {
        assert.match(summary, /^ECOUNT SYNC COMPLETE/, label);
        assert.match(logs.join("\n"), /Production 반영 확인 중 · 재시도 \(시도 2\/3/, label);
      } else assert.match(result.verification.failures.join("\n"), pattern, label);
    } finally { for (const d of [local, prodDir]) await rm(d, { recursive: true, force: true }); }
  }
});
