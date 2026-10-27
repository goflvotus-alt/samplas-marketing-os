import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProductionEcountAutoSync } from "../server.mjs";
import { readEcountAutoSyncStatus } from "../scripts/ecount-auto-sync.mjs";
import { runEcountSyncAndPublish } from "../scripts/run-ecount-product-sync-and-publish.mjs";
import { syncEcountInventory } from "../scripts/sync-ecount-inventory.mjs";
import * as queue from "../scripts/pending-brand-queue.mjs";

const kst = (text) => new Date(`${text}+09:00`);
const env = { ECOUNT_COM_CODE: "c", ECOUNT_USER_ID: "u", ECOUNT_API_CERT_KEY: "k" };
const rows = [
  ...Array.from({ length: 30 }, (_, i) => ({ PROD_CD: `P${String(i).padStart(6, "0")}`, PROD_DES: `FILLER / ${i}` })),
  { PROD_CD: "FRL001", PROD_DES: "Fresh Label / Coat" }, { PROD_CD: "NXT001", PROD_DES: "Next Season / Jacket" }
];

// Offline ECOUNT (same shape as test/ecount-sync-publish.test.mjs).
function ecount() {
  const sorted = [...rows].sort((a, b) => (a.PROD_CD < b.PROD_CD ? -1 : 1)).map((r) => ({ IN_PRICE: "500", OUT_PRICE: "1000", ...r }));
  return async (url, body) => {
    if (url.includes("/Zone")) return { httpStatus: 200, body: { Data: { ZONE: "AC" } } };
    if (url.includes("/OAPILogin")) return { httpStatus: 200, body: { Data: { Datas: { SESSION_ID: "s-1234" } } } };
    if (url.includes("GetBasicProductsList")) return { httpStatus: 200, body: { Data: { Result: sorted.filter((r) => !body.FROM_PROD_CD || (r.PROD_CD >= body.FROM_PROD_CD && r.PROD_CD <= body.TO_PROD_CD)) } } };
    return { httpStatus: 200, body: { Data: { Result: [] } } };
  };
}

async function setFetchedAt(dir, fetchedAt) {
  const file = join(dir, "ecount-inventory", "product-master.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), fetchedAt }));
}

async function localWork() {
  const dir = await mkdtemp(join(tmpdir(), "ecount-prod-auto-local-"));
  await mkdir(join(dir, "ecount-inventory"));
  await syncEcountInventory({ env, outDir: join(dir, "ecount-inventory"), request: ecount(), delayMs: 0 });
  await setFetchedAt(dir, "2026-10-03T00:00:00.000Z");
  return dir;
}

// Stand-in Production running the real pending-brand code: Fresh Label is NEW, Next Season reuses
// the inactive code STALE7 (reassignment = review only).
async function fakeProduction() {
  const prodDir = await mkdtemp(join(tmpdir(), "ecount-prod-auto-prod-"));
  for (const sub of ["ecount-inventory", "ecount-sales", "intelligence"]) await mkdir(join(prodDir, sub));
  await writeFile(join(prodDir, "brand-master.json"), JSON.stringify({ brands: [{ brand_code: "STALE7", brand_name: "Legacy Seven", active: false, name_aliases: [], nameSource: "suggested" }] }));
  await writeFile(join(prodDir, "intelligence/brand-master-list.json"), "[]");
  await writeFile(join(prodDir, "intelligence/brand-aliases.json"), "[]");
  const cafe24Brands = [{ brand_code: "STALE7", brand_name: "Next Season" }, { brand_code: "FRESH1", brand_name: "Fresh Label" }];
  const build = (brands) => ({ brands: brands.map((b) => ({ id: b.brand_code, name: b.brand_name, active: b.active })), aliases: [] });
  const calls = [];
  const production = async (method, path, body) => {
    calls.push(`${method} ${path}${body?.autoApprove ? " autoApprove" : ""}`);
    if (method === "POST" && path.startsWith("/api/pending-brands/refresh")) {
      const load = async () => ({ ...(await queue.loadPendingBrandSources(prodDir, "2026-10")), cafe24Brands });
      return { ok: true, ...(await queue.refreshPendingBrands(prodDir, load, { autoApprove: body?.autoApprove === true, buildCompatibility: build })) };
    }
    if (path === "/api/pending-brands") return { ok: true, ...(await queue.readPendingBrands(prodDir)) };
    if (path === "/api/brand-master") return JSON.parse(await readFile(join(prodDir, "brand-master.json"), "utf8"));
    if (path === "/api/brands/new?coverage=0") return { count: 0, brands: [] };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { prodDir, calls, production };
}

// The real runner (file lock + 5 stages) with ECOUNT and Render replaced; gate pauses the sync.
function realRunner(local, prod, { uploads = [], gate = null } = {}) {
  return (options = {}) => runEcountSyncAndPublish({
    workDir: local,
    sync: async () => { if (gate) await gate; return syncEcountInventory({ env, outDir: join(local, "ecount-inventory"), request: ecount(), delayMs: 0 }); },
    upload: async (paths) => { uploads.push(paths); for (const p of paths) await copyFile(join(local, p), join(prod.prodDir, p)); },
    production: prod.production,
    verifyAttempts: 1,
    ...options
  }).then((result) => ({ result }));
}

const stub = (calls, result = { ok: true, stage: "done", productMaster: { totalProducts: 32, pageCount: 1, duplicateCount: 0 }, onboarding: { approved: [], failed: [] } }) => async () => { calls.push("runner"); return { result }; };
const scheduler = (dir, runPublish, at) => createProductionEcountAutoSync({ workDir: dir, runPublish, refreshSourcing: async () => ({ generatedAt: "x" }), now: () => at });

test("04:00 run uses the shared runner: Production upload, pending refresh (NEW only) and verification", async () => {
  const local = await localWork();
  const prod = await fakeProduction();
  const uploads = [];
  const result = await scheduler(local, realRunner(local, prod, { uploads }), kst("2026-10-04T04:00:30")).check();
  assert.equal(result.ok, true);
  assert.deepEqual(uploads, [["ecount-inventory/latest.json", "ecount-inventory/diagnostic.json"], ["ecount-inventory/product-master.json"]], "publish stage");
  assert.ok(prod.calls.includes("POST /api/pending-brands/refresh autoApprove"), "Production pending refresh");
  for (const path of ["GET /api/brand-master", "GET /api/brands/new?coverage=0", "GET /api/pending-brands"]) assert.ok(prod.calls.includes(path), `verification ${path}`);
  const brands = JSON.parse(await readFile(join(prod.prodDir, "brand-master.json"), "utf8")).brands;
  assert.ok(brands.some((b) => b.brand_name === "Fresh Label" && b.active !== false), "NEW brand onboarded on Production");
  assert.deepEqual(brands.find((b) => b.brand_code === "STALE7"), { brand_code: "STALE7", brand_name: "Legacy Seven", active: false, name_aliases: [], nameSource: "suggested" }, "inactive-code reassignment is not auto-approved; canonical untouched");
  assert.deepEqual(queue.UNATTENDED_AUTO_APPROVE_ACTIONS, ["NEW"]);
  const status = await readEcountAutoSyncStatus(local);
  assert.deepEqual([status.lastSuccessDate, status.lastTrigger, status.lastOnboardingApprovedCount, status.lastError], ["2026-10-04", "schedule", 1, null]);
});

test("auto and manual share the file lock: the second run writes nothing", async () => {
  const local = await localWork();
  const prod = await fakeProduction();
  const uploads = [];
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const auto = scheduler(local, realRunner(local, prod, { uploads, gate }), kst("2026-10-04T04:00:30")).check();
  await new Promise((resolve) => setTimeout(resolve, 50));
  // The runner rejects before any stage; the button route reports it as a failed run.
  await assert.rejects(realRunner(local, prod)(), /이미 실행 중/);
  open();
  assert.equal((await auto).ok, true);
  assert.equal(uploads.length, 2, "only the auto run uploaded");
  // The reverse: a manual run holds the lock when the scheduler fires.
  const local2 = await localWork();
  let open2;
  const gate2 = new Promise((resolve) => { open2 = resolve; });
  const uploads2 = [];
  const manual2 = realRunner(local2, prod, { uploads: uploads2, gate: gate2 })();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const auto2 = await scheduler(local2, realRunner(local2, prod, { uploads: uploads2 }), kst("2026-10-04T04:00:30")).check();
  assert.equal(auto2.ok, false);
  assert.match(auto2.error, /이미 실행 중/);
  open2();
  assert.equal((await manual2).result.ok, true);
  assert.equal(uploads2.length, 2, "only the manual run uploaded");
});

test("a sync already done today (button or .command) stops the scheduler for that day only", async () => {
  const local = await localWork();
  await setFetchedAt(local, "2026-10-09T10:09:49.828Z"); // 19:09 KST manual success
  const calls = [];
  const evening = scheduler(local, stub(calls), kst("2026-10-09T20:00:00"));
  assert.deepEqual(await evening.check(), { ok: false, skipped: "synced-today" });
  const status = await evening.getStatus();
  assert.equal(status.nextScheduledAt, "2026-10-09T19:00:00.000Z", "next run = tomorrow 04:00 KST");
  assert.equal(status.syncedTodayBy, "product-master");
  assert.deepEqual(await scheduler(local, stub(calls), kst("2026-10-10T03:59:00")).check(), { ok: false, skipped: "not-due" });
  assert.equal(calls.length, 0);
  assert.equal((await scheduler(local, stub(calls), kst("2026-10-10T04:00:30")).check()).ok, true, "next day 04:00 runs");
  assert.deepEqual(calls, ["runner"]);
  // The button is never blocked by the scheduler: the runner has no day check.
  assert.equal((await realRunner(local, await fakeProduction())()).result.ok, true);
});

test("sleep through 04:00: the first check after wake catches up once; later checks that day do not", async () => {
  const local = await localWork();
  const calls = [];
  assert.equal((await scheduler(local, stub(calls), kst("2026-10-10T13:15:00")).check()).ok, true);
  assert.deepEqual(await scheduler(local, stub(calls), kst("2026-10-10T13:30:00")).check(), { ok: false, skipped: "not-due" });
  assert.deepEqual(calls, ["runner"]);
});

test("failure is recorded, not retried the same day, and retried the next day", async () => {
  const local = await localWork();
  const calls = [];
  const failing = stub(calls, { ok: false, stage: "upload", error: "upload 502", upload: { uploaded: [] } });
  const failed = await scheduler(local, failing, kst("2026-10-10T04:00:30")).check();
  assert.equal(failed.ok, false);
  const status = await readEcountAutoSyncStatus(local);
  assert.equal(status.lastError, "upload: upload 502");
  assert.equal(status.lastSuccessDate, undefined);
  assert.deepEqual(await scheduler(local, failing, kst("2026-10-10T10:00:00")).check(), { ok: false, skipped: "not-due" });
  const verifyFailed = stub(calls, { ok: false, stage: "done", onboarding: {}, verification: { failures: ["Production 상품 수 1 ≠ 로컬 2"] } });
  const next = await scheduler(local, verifyFailed, kst("2026-10-11T04:00:30")).check();
  assert.equal(next.ok, false, "verification failure is a failed run");
  assert.match((await readEcountAutoSyncStatus(local)).lastError, /Production 상품 수/);
  assert.equal(calls.length, 2);
});

test("wiring: server scheduler, button and .command all call runEcountProductSyncFromEnv", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(source, /const runEcountRunner = async \(options\) => \{\s*if \(!ecountRunnerAllowed\) throw[^\n]*\n\s*return \(await import\("\.\/scripts\/run-ecount-product-sync-and-publish\.mjs"\)\)\.runEcountProductSyncFromEnv\(options\);/);
  assert.match(source, /const ecountAutoSync = createProductionEcountAutoSync\(\{\s*workDir,\s*runPublish: \(\) => runEcountRunner\(/);
  assert.match(source, /const result = await ecountAutoSync\.check\(\);/);
  assert.match(source, /run: \(options\) => runEcountRunner\(options\)/, "button route uses the same guarded runner");
  assert.match(await readFile(new URL("../outputs/ECOUNT 상품 최신화.command", import.meta.url), "utf8"), /node scripts\/run-ecount-product-sync-and-publish\.mjs/);
});
