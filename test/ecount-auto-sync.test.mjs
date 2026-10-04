import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEcountAutoSync, isEcountAutoSyncDue, nextEcountAutoSyncAt, readEcountAutoSyncStatus } from "../scripts/ecount-auto-sync.mjs";
import { syncEcountInventory } from "../scripts/sync-ecount-inventory.mjs";

const kst = text => new Date(`${text}+09:00`);
const env = { ECOUNT_COM_CODE: "c", ECOUNT_USER_ID: "u", ECOUNT_API_CERT_KEY: "k" };
const codes = n => Array.from({ length: n }, (_, i) => `P${String(i).padStart(6, "0")}`);

// Offline ECOUNT: Zone → Login → paged products (FROM/TO inclusive, 10,000 cap) → inventory.
function ecount({ products = codes(12_000), loginError = false, failProductPage = 0 } = {}) {
  let page = 0;
  return async (url, body) => {
    if (url.includes("/Zone")) return { httpStatus: 200, body: { Data: { ZONE: "AC" } } };
    if (url.includes("/OAPILogin")) return { httpStatus: 200, body: loginError ? { Data: { Code: "205", Datas: {}, Message: "허용되지 않은 IP입니다." } } : { Data: { Datas: { SESSION_ID: "session-1234" } } } };
    if (url.includes("GetBasicProductsList")) {
      page += 1;
      if (page === failProductPage) throw new Error("page failure");
      const rows = products.filter(c => !body.FROM_PROD_CD || (c >= body.FROM_PROD_CD && c <= body.TO_PROD_CD)).slice(0, 10_000);
      return { httpStatus: 200, body: { Data: { Result: rows.map(c => ({ PROD_CD: c, PROD_DES: `BRAND / ${c}`, IN_PRICE: "500", OUT_PRICE: "1000" })) } } };
    }
    if (url.includes("GetListInventoryBalanceStatus")) return { httpStatus: 200, body: { Data: { Result: [{ PROD_CD: "P000001", BAL_QTY: "2" }] } } };
    throw new Error(`unexpected ${url}`);
  };
}

async function workDir(previousCount = 11_000) {
  const dir = await mkdtemp(join(tmpdir(), "ecount-auto-sync-"));
  await mkdir(join(dir, "ecount-inventory"));
  const productMaster = { schemaVersion: 1, fetchedAt: "2026-10-03T00:00:00.000Z", totalProducts: previousCount, complete: true, pageCount: 2, duplicateCount: 1, firstProdCd: "P000000", lastProdCd: "x",
    products: codes(previousCount).map(c => ({ productCode: c, productName: `BRAND / ${c}`, inPrice: "500", outPrice: "1000" })) };
  const files = { "raw-products.json": { Data: { Result: [] } }, "raw-inventory.json": { Data: { Result: [] } }, "latest.json": [], "diagnostic.json": { startedAt: "s", finishedAt: "2026-10-03T00:00:00.000Z" }, "product-master.json": productMaster };
  for (const [name, value] of Object.entries(files)) await writeFile(join(dir, "ecount-inventory", name), JSON.stringify(value));
  return dir;
}
const canonical = async dir => Object.fromEntries(await Promise.all(["raw-products.json", "raw-inventory.json", "latest.json", "diagnostic.json", "product-master.json"]
  .map(async f => [f, await readFile(join(dir, "ecount-inventory", f), "utf8")])));

function pipeline(dir, { request = ecount(), at = kst("2026-10-04T04:00:30"), onboard, calls = [] } = {}) {
  return createEcountAutoSync({
    workDir: dir,
    now: () => at,
    sync: async () => { calls.push("sync"); return syncEcountInventory({ env, outDir: join(dir, "ecount-inventory"), request, delayMs: 0 }); },
    onboard: onboard || (async () => { calls.push("onboard"); return { approvedCount: 2, approved: [{ brandCode: "B1", brandName: "One" }, { brandCode: "B2", brandName: "Two" }] }; }),
    refreshSourcing: async () => { calls.push("sourcing"); return { generatedAt: "2026-10-04T00:00:00.000Z" }; }
  });
}

test("due exactly from 04:00 KST, once per KST day; next run time is reported", () => {
  assert.equal(isEcountAutoSyncDue(kst("2026-10-04T03:59:59"), {}), false);
  assert.equal(isEcountAutoSyncDue(kst("2026-10-04T04:00:00"), {}), true);
  assert.equal(isEcountAutoSyncDue(kst("2026-10-04T23:59:00"), { lastAttemptDate: "2026-10-03" }), true);
  assert.equal(isEcountAutoSyncDue(kst("2026-10-04T10:00:00"), { lastAttemptDate: "2026-10-04" }), false);
  assert.equal(isEcountAutoSyncDue(kst("2026-10-05T00:30:00"), { lastAttemptDate: "2026-10-04" }), false, "after midnight KST but before 04:00");
  assert.equal(nextEcountAutoSyncAt(kst("2026-10-04T02:00:00"), {}), "2026-10-03T19:00:00.000Z");
  assert.equal(nextEcountAutoSyncAt(kst("2026-10-04T10:00:00"), { lastAttemptDate: "2026-10-04" }), "2026-10-04T19:00:00.000Z");
});

test("success: full fetch replaces canonical incl. product-master, then onboarding and sourcing; status recorded", async () => {
  const dir = await workDir();
  try {
    const calls = [];
    const result = await pipeline(dir, { calls }).run();
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["sync", "onboard", "sourcing"]);
    const pm = JSON.parse(await readFile(join(dir, "ecount-inventory/product-master.json"), "utf8"));
    assert.equal(pm.totalProducts, 12_000);
    assert.equal(pm.complete, true);
    assert.equal((await readdir(join(dir, "ecount-inventory"))).filter(f => f.startsWith(".")).length, 0, "no staging leftovers");
    const status = await readEcountAutoSyncStatus(dir);
    assert.deepEqual({ date: status.lastSuccessDate, products: status.lastProductCount, pages: status.lastPageCount, dup: status.lastDuplicateCount, err: status.lastError, onboarded: status.lastOnboardingApprovedCount, trigger: status.lastTrigger },
      { date: "2026-10-04", products: 12_000, pages: 2, dup: 1, err: null, onboarded: 2, trigger: "schedule" });
    const view = await pipeline(dir).getStatus();
    assert.equal(view.running, false);
    assert.equal(view.schedule, "daily 04:00 KST");
    assert.equal(view.nextScheduledAt, "2026-10-04T19:00:00.000Z");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("same day: no second scheduled run, and a manual trigger after success is refused", async () => {
  const dir = await workDir();
  try {
    const calls = [];
    await pipeline(dir, { calls }).run();
    assert.equal((await pipeline(dir, { calls, at: kst("2026-10-04T16:00:00") }).run()).skipped, "not-due");
    assert.equal((await pipeline(dir, { calls, at: kst("2026-10-04T16:00:00") }).run({ force: true })).skipped, "already-succeeded-today");
    assert.equal(calls.filter(c => c === "sync").length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("restart catch-up runs once after 04:00; a failed attempt is not repeated by restarts", async () => {
  const dir = await workDir();
  try {
    const calls = [];
    assert.equal((await pipeline(dir, { calls, at: kst("2026-10-04T03:00:00") }).run()).skipped, "not-due");
    const failed = await pipeline(dir, { calls, at: kst("2026-10-04T11:00:00"), request: ecount({ loginError: true }) }).run();
    assert.equal(failed.ok, false);
    for (const hour of ["11:30", "12:00", "18:00"]) assert.equal((await pipeline(dir, { calls, at: kst(`2026-10-04T${hour}:00`) }).run()).skipped, "not-due");
    const manual = await pipeline(dir, { calls, at: kst("2026-10-04T18:05:00") }).run({ force: true });
    assert.equal(manual.ok, true, "explicit manual retry is allowed after a failure");
    assert.equal(calls.filter(c => c === "sync").length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("IP auth failure, partial fetch, product drop: canonical kept, no onboarding, error recorded", async () => {
  for (const [request, pattern, previous] of [
    [ecount({ loginError: true }), /Login 실패.*허용되지 않은 IP/, 11_000],
    [ecount({ failProductPage: 2 }), /page failure/, 11_000],
    [ecount({ products: codes(5_000) }), /급감/, 11_000]
  ]) {
    const dir = await workDir(previous);
    try {
      const before = await canonical(dir);
      const calls = [];
      const result = await pipeline(dir, { request, calls }).run();
      assert.equal(result.ok, false);
      assert.match(result.error, pattern);
      assert.deepEqual(calls, ["sync"]);
      assert.deepEqual(await canonical(dir), before);
      const status = await readEcountAutoSyncStatus(dir);
      assert.match(status.lastError, pattern);
      assert.equal(status.lastSuccessDate, undefined);
      assert.equal(status.lastAttemptDate, "2026-10-04");
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test("onboarding failure keeps the new verified inventory and is reported", async () => {
  const dir = await workDir();
  try {
    const result = await pipeline(dir, { onboard: async () => { throw new Error("cafe24 down"); } }).run();
    assert.equal(result.ok, true);
    assert.equal(JSON.parse(await readFile(join(dir, "ecount-inventory/product-master.json"), "utf8")).totalProducts, 12_000);
    const status = await readEcountAutoSyncStatus(dir);
    assert.equal(status.lastSuccessDate, "2026-10-04");
    assert.equal(status.lastOnboardingError, "cafe24 down");
    assert.equal(status.lastOnboardingApprovedCount, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("concurrent runs are rejected while one is in flight", async () => {
  const dir = await workDir();
  try {
    let release;
    const auto = createEcountAutoSync({ workDir: dir, now: () => kst("2026-10-04T05:00:00"),
      sync: () => new Promise(resolve => { release = () => resolve({ productCount: 1, productPagination: { pageCount: 1, duplicateCount: 0 } }); }),
      onboard: async () => ({ approvedCount: 0 }), refreshSourcing: async () => ({}) });
    const first = auto.run();
    await new Promise(r => setTimeout(r, 20));
    assert.equal((await auto.getStatus()).running, true);
    assert.equal((await auto.run({ force: true })).skipped, "running");
    release();
    assert.equal((await first).ok, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
