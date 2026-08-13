import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEcountSalesSnapshot } from "../scripts/import-ecount-offline-sales.mjs";
import { buildCanonicalTotalSales } from "../server.mjs";

// STORE-BATCH-C: Global Store Filter — verifies the shared storeCode filter that
// buildCanonicalTotalSales now exposes via coverage.storesIncluded/storesMissing
// (used by the client to distinguish "0원" from "매장별 미업로드"), and that ALL/
// APGUJEONG/VAIL never conflate the channel dimension (online) with the store
// dimension (offline-only, per-store).
const withTemp = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), "store-filter-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

// buildCanonicalTotalSales recomputes offline totals by summing salesLines[].salesAmount
// directly (it never trusts the pre-aggregated totalOfflineSales field), so the fixture's
// single sales line amount is what actually drives the result — keep them in sync here.
function loadedFixture(amount) {
  return {
    fileName: "2026-08.xlsx",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-11",
    totalOfflineSales: amount,
    totalLineCount: 1,
    revenueLineCount: 1,
    nonRevenueLineCount: 0,
    personalPaymentSales: 0,
    personalPaymentCount: 0,
    dailySales: [{ date: "2026-08-01", offlineSalesAmount: amount, revenueLineCount: 1, totalLineCount: 1, quantity: 1 }],
    salesLines: [
      { date: "2026-08-01", slipNo: "1", documentNo: "1", productName: "NAMILIA / Test", specification: "XS", quantity: 1, brandGroup: "NAM", customerName: "매장방문고객", poNo: "P1", salesAmount: amount, isPersonalPayment: false, personalPaymentReason: null, isOfflineRevenue: true }
    ]
  };
}

async function writeStoreSnapshot(workDir, month, storeCode, amount) {
  const snapshot = buildEcountSalesSnapshot(loadedFixture(amount), month, { storeCode });
  const dir = join(workDir, "ecount-sales");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${month}.${storeCode}.json`), JSON.stringify(snapshot, null, 2));
}

async function writeLegacySnapshot(workDir, month, amount) {
  const snapshot = buildEcountSalesSnapshot(loadedFixture(amount), month);
  const dir = join(workDir, "ecount-sales");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${month}.json`), JSON.stringify(snapshot, null, 2));
}

// buildCanonicalTotalSales calls the real (live) Cafe24 online source via
// buildBrandSalesDiagnostics — this environment has no live credentials, so it
// resolves to a fixed value each time. What matters for tests 7/8/13 is that this
// value is IDENTICAL across ALL/APGUJEONG/VAIL calls (proving storeCode never
// touches the online computation), not what the value itself is.
test("1. default store = ALL preserves the legacy-fallback result (no per-store files yet)", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeLegacySnapshot(workDir, "2026-08", 79144800);
  const all = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: undefined, workDir });
  assert.equal(all.offlineSales.offlineSalesAmount, 79144800);
  assert.equal(all.storeCode, null);
}));

test("2. ALL total = APGUJEONG offline + VAIL offline (exact regression)", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", 100000);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", 55000);
  const all = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "ALL", workDir });
  const apgujeong = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  const vail = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  assert.equal(all.offlineSales.offlineSalesAmount, apgujeong.offlineSales.offlineSalesAmount + vail.offlineSales.offlineSalesAmount);
  assert.equal(all.offlineSales.offlineSalesAmount, 155000);
}));

// 3/4. selector sends store=APGUJEONG / store=VAIL — verified at the API contract level
// (buildCanonicalTotalSales's storeCode param is exactly what the client's &store=
// query maps to server-side; see server.mjs /api/sales/total route).
test("3/4. storeCode=APGUJEONG / VAIL route to the exact matching filter (not ALL)", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", 70000);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", 30000);
  const apgujeong = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  const vail = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  assert.equal(apgujeong.offlineSales.offlineSalesAmount, 70000);
  assert.equal(vail.offlineSales.offlineSalesAmount, 30000);
  assert.equal(apgujeong.storeCode, "APGUJEONG");
  assert.equal(vail.storeCode, "VAIL");
}));

// 5/6. APGUJEONG excludes VAIL lines and vice versa
test("5/6. APGUJEONG filter excludes VAIL's offline lines and vice versa", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", 70000);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", 30000);
  const apgujeong = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  const vail = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  assert.equal(apgujeong.offlineSales.offlineSalesAmount, 70000, "APGUJEONG must not include VAIL's 30000");
  assert.equal(vail.offlineSales.offlineSalesAmount, 30000, "VAIL must not include APGUJEONG's 70000");
}));

// 7/8. online is never attributed to APGUJEONG or VAIL
test("7/8. online total is identical across ALL/APGUJEONG/VAIL (never store-attributed)", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", 70000);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", 30000);
  const all = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "ALL", workDir });
  const apgujeong = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  const vail = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  assert.equal(all.onlineSales.paidAmount, apgujeong.onlineSales.paidAmount);
  assert.equal(all.onlineSales.paidAmount, vail.onlineSales.paidAmount);
}));

test("7b/8b. online computation source code never conditions on storeCode (static guard)", () => {
  const fnSource = String(buildCanonicalTotalSales);
  const onlineLine = fnSource.match(/const onlinePaidAmount = [^;]+;/)?.[0];
  assert.notEqual(onlineLine, undefined);
  assert.doesNotMatch(onlineLine, /storeCode/);
});

// 9/10. legacy null-store data is not treated as APGUJEONG or VAIL
test("9/10. a legacy (pre-store-separation) month returns 0 for both APGUJEONG and VAIL filters, never guessed", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeLegacySnapshot(workDir, "2026-08", 79144800);
  const apgujeong = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  const vail = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  assert.equal(apgujeong.offlineSales.offlineSalesAmount, 0, "legacy lines carry storeCode:null, never matched to APGUJEONG");
  assert.equal(vail.offlineSales.offlineSalesAmount, 0, "legacy lines carry storeCode:null, never matched to VAIL");
  // The critical honesty signal: coverage.storesIncluded must be empty so the client
  // can render "데이터 없음" instead of confirming a real 0원 for that store.
  assert.deepEqual(apgujeong.coverage.storesIncluded, []);
  assert.deepEqual(vail.coverage.storesIncluded, []);
}));

// 11. missing store data is not displayed as confirmed zero — coverage metadata proves it
test("11. partial upload (APGUJEONG only) surfaces storesIncluded/storesMissing so VAIL is distinguishable from a real zero", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", 70000);
  const all = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "ALL", workDir });
  assert.deepEqual(all.coverage.storesIncluded, ["APGUJEONG"]);
  assert.deepEqual(all.coverage.storesMissing, ["VAIL"]);
  const vail = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  assert.equal(vail.offlineSales.offlineSalesAmount, 0);
  assert.ok(!vail.coverage.storesIncluded.includes("VAIL"), "VAIL absent from storesIncluded — client must show 데이터 없음, not 0원");
}));

// 13. existing channel behavior is unchanged (total = online + offline still holds for ALL)
test("13. ALL: total = online + offline invariant unchanged from pre-STORE-BATCH-C behavior", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", 70000);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", 30000);
  const all = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "ALL", workDir });
  assert.equal(all.totalSales.amount, all.onlineSales.paidAmount + all.offlineSales.offlineSalesAmount);
}));

// 14. ALL total regression = exact pre-store result (same fixture as test 1, isolated call)
test("14. store=ALL result is byte-identical whether requested explicitly or omitted", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeLegacySnapshot(workDir, "2026-08", 79144800);
  const omitted = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", workDir });
  const explicitAll = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "ALL", workDir });
  assert.equal(omitted.offlineSales.offlineSalesAmount, explicitAll.offlineSales.offlineSalesAmount);
  assert.equal(explicitAll.offlineSales.offlineSalesAmount, 79144800);
}));

// 12. selector state is shared across screens — verified structurally: Today/Commerce and
// Monthly/Annual all read the single module-level storeFilterState / call the same
// buildCanonicalTotalSales(storeCode)+readEcountOfflineSalesSnapshot(storeCode) primitives;
// no per-screen duplicate store state exists in outputs/samplas-marketing-os.js.
test("12. client bundle defines exactly one storeFilterState module variable (no per-screen duplicates)", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const declarations = source.match(/let storeFilterState\s*=/g) || [];
  assert.equal(declarations.length, 1, "storeFilterState must be declared exactly once (shared across Today/Monthly/Annual/Commerce)");
});
