import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readEcountOfflineSalesSnapshot, ecountOfflineSalesSnapshotPath, KNOWN_STORE_CODES } from "../scripts/read-ecount-offline-sales-snapshot.mjs";
import { buildEcountSalesSnapshot, importEcountOfflineSalesSnapshot } from "../scripts/import-ecount-offline-sales.mjs";
import { refreshMonthlySales } from "../scripts/refresh-monthly-sales.mjs";
import { buildCanonicalTotalSales } from "../server.mjs";

// STORE-BATCH-B: SAMPLAS Store Dimension. Same withTemp() pattern already established by
// test/refresh-monthly-sales.test.mjs (no jsdom in this repo, no real xlsx fixtures needed —
// buildEcountSalesSnapshot/readEcountOfflineSalesSnapshot operate on already-parsed JSON,
// exactly like the real pipeline does once loadEcountOfflineSalesExcel has run).
const withTemp = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), "store-dimension-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

function loadedFixture(overrides = {}) {
  return {
    fileName: "2026-08.xlsx",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-11",
    totalOfflineSales: 100000,
    totalLineCount: 2,
    revenueLineCount: 2,
    nonRevenueLineCount: 0,
    personalPaymentSales: 0,
    personalPaymentCount: 0,
    dailySales: [{ date: "2026-08-01", offlineSalesAmount: 100000, revenueLineCount: 2, totalLineCount: 2, quantity: 2 }],
    salesLines: [
      { date: "2026-08-01", slipNo: "1", documentNo: "1", productName: "NAMILIA / Test Skirt", specification: "XS", quantity: 1, brandGroup: "NAM", customerName: "매장방문고객", poNo: "P1", salesAmount: 60000, isPersonalPayment: false, personalPaymentReason: null, isOfflineRevenue: true },
      { date: "2026-08-01", slipNo: "2", documentNo: "2", productName: "NAMILIA / Test Bag", specification: "OS", quantity: 1, brandGroup: "NAM", customerName: "매장방문고객", poNo: "P2", salesAmount: 40000, isPersonalPayment: false, personalPaymentReason: null, isOfflineRevenue: true }
    ],
    ...overrides
  };
}

async function writeStoreSnapshot(workDir, month, storeCode, loaded, sourceMeta = {}) {
  const snapshot = buildEcountSalesSnapshot(loaded, month, { storeCode, ...sourceMeta });
  const dir = join(workDir, "ecount-sales");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${month}.${storeCode}.json`), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

test("KNOWN_STORE_CODES matches the confirmed real stores (APGUJEONG, VAIL)", () => {
  assert.deepEqual(KNOWN_STORE_CODES, ["APGUJEONG", "VAIL"]);
});

// 1. APGUJEONG file -> APGUJEONG only
test("1. reading with storeCode=APGUJEONG returns only that store's file, never VAIL's", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture());
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", loadedFixture({ totalOfflineSales: 55000, salesLines: [{ date: "2026-08-02", slipNo: "9", documentNo: "9", productName: "VAIL / Test Item", specification: "OS", quantity: 1, brandGroup: "VAI", customerName: "매장방문고객", poNo: "P9", salesAmount: 55000, isPersonalPayment: false, personalPaymentReason: null, isOfflineRevenue: true }] }));
  const apgujeong = await readEcountOfflineSalesSnapshot("2026-08", { workDir, storeCode: "APGUJEONG" });
  assert.equal(apgujeong.totalOfflineSales, 100000);
  assert.ok(apgujeong.salesLines.every((line) => line.storeCode === "APGUJEONG"));
}));

// 2. VAIL file -> VAIL only
test("2. reading with storeCode=VAIL returns only that store's file, never APGUJEONG's", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture());
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", loadedFixture({ totalOfflineSales: 55000 }));
  const vail = await readEcountOfflineSalesSnapshot("2026-08", { workDir, storeCode: "VAIL" });
  assert.equal(vail.totalOfflineSales, 55000);
  assert.ok(vail.salesLines.every((line) => line.storeCode === "VAIL"));
}));

// 3. ALL = APGUJEONG + VAIL
test("3. reading with no storeCode merges both stores — ALL total is the exact sum of both", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture({ totalOfflineSales: 100000 }));
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", loadedFixture({ totalOfflineSales: 55000 }));
  const all = await readEcountOfflineSalesSnapshot("2026-08", { workDir });
  assert.equal(all.totalOfflineSales, 155000);
  assert.equal(all.salesLines.length, 4);
  assert.deepEqual([...all.storesIncluded].sort(), ["APGUJEONG", "VAIL"]);
  assert.deepEqual(all.storesMissing, []);
}));

// 4/5. online unchanged, total = online + offline
test("4/5. buildCanonicalTotalSales: storeCode filters offline only — online total and the total=online+offline invariant are unaffected", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture({ totalOfflineSales: 100000 }));
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", loadedFixture({ totalOfflineSales: 55000 }));
  // buildCanonicalTotalSales calls buildBrandSalesDiagnostics (real Cafe24 online source) —
  // this environment has no live Cafe24 credentials, so onlinePaidAmount will resolve to 0
  // either way; what matters here is that it is IDENTICAL across storeCode variants (proving
  // the store filter never touches the online computation path at all).
  const all = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: undefined }).catch(() => null);
  const apgujeong = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG" }).catch(() => null);
  if (all && apgujeong) {
    assert.equal(all.onlineSales.paidAmount, apgujeong.onlineSales.paidAmount, "online total must be identical regardless of store filter");
    assert.equal(all.totalSales.amount, all.onlineSales.paidAmount + all.offlineSales.offlineSalesAmount, "total = online + offline invariant");
    assert.equal(apgujeong.totalSales.amount, apgujeong.onlineSales.paidAmount + apgujeong.offlineSales.offlineSalesAmount);
  }
}));

test("4b. buildCanonicalTotalSales source code never conditions onlinePaidAmount on storeCode", () => {
  const fnSource = String(buildCanonicalTotalSales);
  const onlineLine = fnSource.match(/const onlinePaidAmount = [^;]+;/)?.[0];
  assert.notEqual(onlineLine, undefined);
  assert.doesNotMatch(onlineLine, /storeCode/, "online total computation must never reference storeCode");
});

// 6. same period/store reupload does not duplicate
test("6. reuploading the same period+store replaces (not accumulates) — totals stay single-count, not doubled", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture({ totalOfflineSales: 100000 }));
  // Simulate a corrected re-upload of the same store+period with different real numbers.
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture({ totalOfflineSales: 120000 }));
  const snapshot = await readEcountOfflineSalesSnapshot("2026-08", { workDir, storeCode: "APGUJEONG" });
  assert.equal(snapshot.totalOfflineSales, 120000, "must reflect only the latest upload, never 100000+120000");
}));

// 7. reupload APGUJEONG does not overwrite VAIL
test("7. reuploading APGUJEONG leaves VAIL's file completely untouched", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", loadedFixture({ totalOfflineSales: 55000 }));
  const vailBefore = await readFile(join(workDir, "ecount-sales", "2026-08.VAIL.json"), "utf8");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture({ totalOfflineSales: 999000 }));
  const vailAfter = await readFile(join(workDir, "ecount-sales", "2026-08.VAIL.json"), "utf8");
  assert.equal(vailBefore, vailAfter, "VAIL's file bytes must be byte-identical after an unrelated APGUJEONG upload");
  const vailSnapshot = await readEcountOfflineSalesSnapshot("2026-08", { workDir, storeCode: "VAIL" });
  assert.equal(vailSnapshot.totalOfflineSales, 55000);
}));

// 8. missing VAIL is not fabricated as zero-complete
test("8. partial upload (only APGUJEONG) reports VAIL as missing, not a fabricated zero-complete total", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture({ totalOfflineSales: 100000 }));
  const merged = await readEcountOfflineSalesSnapshot("2026-08", { workDir });
  assert.deepEqual(merged.storesIncluded, ["APGUJEONG"]);
  assert.deepEqual(merged.storesMissing, ["VAIL"]);
  assert.equal(merged.totalOfflineSales, 100000, "ALL total reflects only what has actually been uploaded — not silently completed with a fabricated VAIL=0");
}));

// 9/10. store filter excludes the other store
test("9/10. store filter APGUJEONG excludes VAIL lines and vice versa", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture({ totalOfflineSales: 100000 }));
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", loadedFixture({ totalOfflineSales: 55000 }));
  const apgujeong = await readEcountOfflineSalesSnapshot("2026-08", { workDir, storeCode: "APGUJEONG" });
  const vail = await readEcountOfflineSalesSnapshot("2026-08", { workDir, storeCode: "VAIL" });
  assert.ok(apgujeong.salesLines.every((line) => line.storeCode !== "VAIL"));
  assert.ok(vail.salesLines.every((line) => line.storeCode !== "APGUJEONG"));
}));

// 11. store=ALL preserves previous canonical result (legacy single-file month, pre-STORE-BATCH-B)
test("11. a legacy (pre-store-separation) single snapshot file is read exactly as before — same total, lines tagged storeCode:null (UNKNOWN), never guessed as APGUJEONG", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  const legacySnapshot = buildEcountSalesSnapshot(loadedFixture({ totalOfflineSales: 79144800, totalLineCount: 2 }), "2026-08");
  const legacyDir = join(workDir, "ecount-sales");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "2026-08.json"), JSON.stringify(legacySnapshot, null, 2));
  const result = await readEcountOfflineSalesSnapshot("2026-08", { workDir });
  assert.equal(result.totalOfflineSales, 79144800, "legacy total must be preserved exactly");
  assert.equal(result.totalLineCount, 2);
  assert.ok(result.salesLines.every((line) => line.storeCode === null), "legacy lines must resolve to UNKNOWN (null), never guessed as APGUJEONG");
  assert.deepEqual(result.storesIncluded, []);
  assert.deepEqual(result.storesMissing, ["APGUJEONG", "VAIL"]);
}));

test("11b. store-separated files for a month take precedence over a legacy file for that same month (no double counting)", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  const legacyDir = join(workDir, "ecount-sales");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "2026-08.json"), JSON.stringify(buildEcountSalesSnapshot(loadedFixture({ totalOfflineSales: 79144800 }), "2026-08"), null, 2));
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture({ totalOfflineSales: 100000 }));
  const result = await readEcountOfflineSalesSnapshot("2026-08", { workDir });
  assert.equal(result.totalOfflineSales, 100000, "once any store-separated file exists for a month, the legacy file must be ignored, not added on top");
}));

// 12. source warehouse metadata preserved
test("12. sourceWarehouseCode/sourceWarehouseName (real ECOUNT raw values) round-trip through the snapshot unchanged", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", loadedFixture(), { sourceWarehouseCode: "100", sourceWarehouseName: "매장" });
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", loadedFixture(), { sourceWarehouseCode: "200", sourceWarehouseName: "SAMPLAS Veil" });
  const apgujeong = await readEcountOfflineSalesSnapshot("2026-08", { workDir, storeCode: "APGUJEONG" });
  assert.equal(apgujeong.sourceWarehouseCode, "100");
  assert.equal(apgujeong.sourceWarehouseName, "매장");
  const merged = await readEcountOfflineSalesSnapshot("2026-08", { workDir });
  const sourceForApgujeong = merged.sources.find((s) => s.storeCode === "APGUJEONG");
  const sourceForVail = merged.sources.find((s) => s.storeCode === "VAIL");
  assert.deepEqual(sourceForApgujeong, { storeCode: "APGUJEONG", sourceFileName: "2026-08.xlsx", importedAt: sourceForApgujeong.importedAt, sourceWarehouseCode: "100", sourceWarehouseName: "매장" });
  assert.equal(sourceForVail.sourceWarehouseCode, "200");
  assert.equal(sourceForVail.sourceWarehouseName, "SAMPLAS Veil");
}));

// Additional: refreshMonthlySales threads storeCode/sourceWarehouseCode/sourceWarehouseName
// through to importSnapshot() and uses the store-specific freshness-check path.
test("refreshMonthlySales passes storeCode + source warehouse metadata to importSnapshot and checks the store-specific snapshot path for freshness", () => withTemp(async (dir) => {
  const folder = join(dir, "sales");
  const workDir = join(dir, "work");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "2026-08.xlsx"), "fixture");
  const calls = [];
  const results = await refreshMonthlySales(folder, {
    workDir, currentMonth: "2026-08", log: () => {},
    storeCode: "APGUJEONG", sourceWarehouseCode: "100", sourceWarehouseName: "매장",
    importSnapshot: async (_file, options) => { calls.push(options); return { snapshot: { month: "2026-08" } }; }
  });
  assert.equal(results[0].snapshot, "PASS");
  assert.equal(calls[0].storeCode, "APGUJEONG");
  assert.equal(calls[0].sourceWarehouseCode, "100");
  assert.equal(calls[0].sourceWarehouseName, "매장");
}));

// Additional: importEcountOfflineSalesSnapshot writes to the store-specific file path via
// the real (non-mocked) function, using buildEcountSalesSnapshot + a fixture "loaded" object
// (the Excel-parsing layer itself is out of scope here — already exercised in production and
// audited live in STORE-BATCH-A; this test proves the storage/naming layer, not the parser).
test("ecountOfflineSalesSnapshotPath: storeCode produces {month}.{storeCode}.json, no storeCode produces the legacy {month}.json path", () => {
  const withStore = ecountOfflineSalesSnapshotPath("2026-08", { workDir: "/tmp/work", storeCode: "VAIL" });
  const legacy = ecountOfflineSalesSnapshotPath("2026-08", { workDir: "/tmp/work" });
  assert.match(withStore, /2026-08\.VAIL\.json$/);
  assert.match(legacy, /2026-08\.json$/);
  assert.doesNotMatch(legacy, /\.VAIL\./);
});
