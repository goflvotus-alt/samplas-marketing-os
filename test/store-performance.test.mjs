import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEcountSalesSnapshot } from "../scripts/import-ecount-offline-sales.mjs";
import { buildCanonicalTotalSales, buildBrandCustomerComposition } from "../server.mjs";
import { buildClientsOverview } from "../intelligence-service.mjs";

// STORE-BATCH-D: Store Performance UX + Clients + Brand Intelligence. Covers the batch's
// 30 required scenarios where they are server-side/testable; ALL-mode exact regression for
// each screen and visual behavior is verified live in Chrome (see report) since it depends
// on real Cafe24/Meta data this environment can reach live.
const withTemp = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), "store-perf-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

function offlineLineFixture({ date, storeCode, amount, customerName, slipNo, brandProductName = "NAMILIA / Test Item" }) {
  return {
    date, slipNo, documentNo: slipNo, productName: brandProductName, specification: "OS",
    quantity: 1, brandGroup: "NAM", customerName, poNo: slipNo,
    salesAmount: amount, isPersonalPayment: false, personalPaymentReason: null, isOfflineRevenue: true,
    storeCode
  };
}

async function writeStoreSnapshot(workDir, month, storeCode, lines) {
  const total = lines.reduce((sum, l) => sum + l.salesAmount, 0);
  const loaded = {
    fileName: `${month}.xlsx`, periodStart: lines[0]?.date || `${month}-01`, periodEnd: lines.at(-1)?.date || `${month}-01`,
    totalOfflineSales: total, totalLineCount: lines.length, revenueLineCount: lines.length, nonRevenueLineCount: 0,
    personalPaymentSales: 0, personalPaymentCount: 0,
    dailySales: [{ date: lines[0]?.date || `${month}-01`, offlineSalesAmount: total, revenueLineCount: lines.length, totalLineCount: lines.length, quantity: lines.length }],
    salesLines: lines
  };
  const snapshot = buildEcountSalesSnapshot(loaded, month, { storeCode });
  const dir = join(workDir, "ecount-sales");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${month}.${storeCode}.json`), JSON.stringify(snapshot, null, 2));
}

// --- PART 10/11/12: ALL breakdown = online + APGUJEONG + VAIL, share denominator ---

test("10. ALL offlineSales.byStore sums to offlineSalesAmount when both stores complete", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", [offlineLineFixture({ date: "2026-08-01", storeCode: "APGUJEONG", amount: 70000, customerName: "매장방문고객", slipNo: "1" })]);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", [offlineLineFixture({ date: "2026-08-02", storeCode: "VAIL", amount: 30000, customerName: "매장방문고객", slipNo: "2" })]);
  const all = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "ALL", workDir });
  assert.equal(all.offlineSales.byStore.APGUJEONG, 70000);
  assert.equal(all.offlineSales.byStore.VAIL, 30000);
  assert.equal(all.offlineSales.byStore.APGUJEONG + all.offlineSales.byStore.VAIL, all.offlineSales.offlineSalesAmount);
  assert.equal(all.totalSales.amount, all.onlineSales.paidAmount + all.offlineSales.offlineSalesAmount);
}));

test("11/12. byStore is present and consistent regardless of storeCode filter (usable as canonical ALL share denominator)", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", [offlineLineFixture({ date: "2026-08-01", storeCode: "APGUJEONG", amount: 70000, customerName: "매장방문고객", slipNo: "1" })]);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", [offlineLineFixture({ date: "2026-08-02", storeCode: "VAIL", amount: 30000, customerName: "매장방문고객", slipNo: "2" })]);
  const apgujeong = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  const vail = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  // byStore must be the same real per-store split no matter which storeCode is requested —
  // this is exactly what lets the client compute "share of canonical ALL" without a second
  // API call, and guarantees APGUJEONG's UI and VAIL's UI would compute the identical
  // denominator (byStore.APGUJEONG + byStore.VAIL + online) for their respective shares.
  assert.deepEqual(apgujeong.offlineSales.byStore, vail.offlineSales.byStore);
  assert.equal(apgujeong.offlineSales.byStore.APGUJEONG, 70000);
  assert.equal(apgujeong.offlineSales.byStore.VAIL, 30000);
}));

// --- PART 7/8/9: store isolation + online exclusion (extends STORE-BATCH-C coverage) ---

test("7/8/9. APGUJEONG revenue excludes VAIL, VAIL excludes APGUJEONG, both exclude online", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", [offlineLineFixture({ date: "2026-08-01", storeCode: "APGUJEONG", amount: 70000, customerName: "매장방문고객", slipNo: "1" })]);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", [offlineLineFixture({ date: "2026-08-02", storeCode: "VAIL", amount: 30000, customerName: "매장방문고객", slipNo: "2" })]);
  const apgujeong = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  const vail = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  const all = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "ALL", workDir });
  assert.equal(apgujeong.offlineSales.offlineSalesAmount, 70000);
  assert.equal(vail.offlineSales.offlineSalesAmount, 30000);
  assert.equal(apgujeong.onlineSales.paidAmount, all.onlineSales.paidAmount, "physical store filter must never change the online figure");
  assert.equal(vail.onlineSales.paidAmount, all.onlineSales.paidAmount);
}));

// --- PART 13/14/15: legacy + missing store handling ---

test("13/14/15. legacy null-store is neither APGUJEONG nor VAIL; missing store is not a fabricated zero", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  const legacyDir = join(workDir, "ecount-sales");
  await mkdir(legacyDir, { recursive: true });
  const legacySnapshot = buildEcountSalesSnapshot({
    fileName: "2026-08.xlsx", periodStart: "2026-08-01", periodEnd: "2026-08-01", totalOfflineSales: 79144800,
    totalLineCount: 1, revenueLineCount: 1, nonRevenueLineCount: 0, personalPaymentSales: 0, personalPaymentCount: 0,
    dailySales: [{ date: "2026-08-01", offlineSalesAmount: 79144800, revenueLineCount: 1, totalLineCount: 1, quantity: 1 }],
    salesLines: [offlineLineFixture({ date: "2026-08-01", storeCode: undefined, amount: 79144800, customerName: "매장방문고객", slipNo: "1" })]
  }, "2026-08");
  await writeFile(join(legacyDir, "2026-08.json"), JSON.stringify(legacySnapshot, null, 2));
  const apgujeong = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  const vail = await buildCanonicalTotalSales({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  assert.equal(apgujeong.offlineSales.offlineSalesAmount, 0);
  assert.equal(vail.offlineSales.offlineSalesAmount, 0);
  assert.ok(!apgujeong.coverage.storesIncluded.includes("APGUJEONG"), "legacy data must never be silently attributed to APGUJEONG");
  assert.ok(!vail.coverage.storesIncluded.includes("VAIL"), "legacy data must never be silently attributed to VAIL");
}));

// --- PART E: Clients (16-19) ---

test("16. Clients identity is not duplicated per store — one client, offline lines from both stores merge into one group", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", [offlineLineFixture({ date: "2026-08-01", storeCode: "APGUJEONG", amount: 50000, customerName: "김협 실장님", slipNo: "1" })]);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", [offlineLineFixture({ date: "2026-08-02", storeCode: "VAIL", amount: 40000, customerName: "김협 실장님", slipNo: "2" })]);
  const all = await buildClientsOverview({ since: "2026-08-01", until: "2026-08-11", workDir });
  const matches = all.clients.filter((c) => c.aliases.includes("김협 실장님"));
  assert.equal(matches.length, 1, "same customerName across two stores must remain a single client identity, not duplicated per store");
  assert.equal(matches[0].totalSales, 90000);
}));

test("Clients ALL removes only cross-store copies of the same ECOUNT source lines", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  const sourceLines = [
    offlineLineFixture({ date: "2026-08-09", storeCode: "APGUJEONG", amount: 222400, customerName: "인규님", slipNo: "7", brandProductName: "TROUBLED WATERS / Void Henley Shirt Washed Black" }),
    offlineLineFixture({ date: "2026-08-09", storeCode: "APGUJEONG", amount: 318400, customerName: "인규님", slipNo: "7", brandProductName: "TROUBLED WATERS / Nomad Vest Washed Black" }),
    offlineLineFixture({ date: "2026-08-09", storeCode: "APGUJEONG", amount: 374400, customerName: "인규님", slipNo: "7", brandProductName: "TROUBLED WATERS / Hybrid Pants Black" })
  ];
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", sourceLines);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", sourceLines.map((line) => ({ ...line, storeCode: "VAIL" })));

  const all = await buildClientsOverview({ since: "2026-08-01", until: "2026-08-31", workDir });
  const ingyu = all.clients.find((client) => client.aliases.includes("인규님"));
  assert.equal(ingyu.purchaseDetails.length, 3);
  assert.deepEqual(ingyu.purchaseDetails.map((line) => [line.productName, line.quantity, line.salesAmount]), [
    ["TROUBLED WATERS / Void Henley Shirt Washed Black", 1, 222400],
    ["TROUBLED WATERS / Nomad Vest Washed Black", 1, 318400],
    ["TROUBLED WATERS / Hybrid Pants Black", 1, 374400]
  ]);
}));

test("Clients ALL preserves same product/date/amount purchases when ECOUNT slips differ", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  const product = "TROUBLED WATERS / Void Henley Shirt Washed Black";
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", [offlineLineFixture({ date: "2026-08-09", storeCode: "APGUJEONG", amount: 222400, customerName: "인규님", slipNo: "7", brandProductName: product })]);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", [offlineLineFixture({ date: "2026-08-09", storeCode: "VAIL", amount: 222400, customerName: "인규님", slipNo: "8", brandProductName: product })]);

  const all = await buildClientsOverview({ since: "2026-08-01", until: "2026-08-31", workDir });
  const ingyu = all.clients.find((client) => client.aliases.includes("인규님"));
  assert.equal(ingyu.purchaseDetails.length, 2);
  assert.deepEqual(ingyu.purchaseDetails.map((line) => line.orderId).sort(), ["7", "8"]);
}));

test("17/18. Clients APGUJEONG/VAIL filters offline activity to that store only", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", [offlineLineFixture({ date: "2026-08-01", storeCode: "APGUJEONG", amount: 50000, customerName: "김협 실장님", slipNo: "1" })]);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", [offlineLineFixture({ date: "2026-08-02", storeCode: "VAIL", amount: 40000, customerName: "김협 실장님", slipNo: "2" })]);
  const apgujeong = await buildClientsOverview({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  const vail = await buildClientsOverview({ since: "2026-08-01", until: "2026-08-11", storeCode: "VAIL", workDir });
  assert.equal(apgujeong.clients.find((c) => c.aliases.includes("김협 실장님"))?.totalSales, 50000);
  assert.equal(vail.clients.find((c) => c.aliases.includes("김협 실장님"))?.totalSales, 40000);
}));

test("19. Clients physical store excludes online — onlineSalesAmount is 0 and onlineOrderCount is 0 for Store Focus Mode", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", [offlineLineFixture({ date: "2026-08-01", storeCode: "APGUJEONG", amount: 50000, customerName: "매장방문고객", slipNo: "1" })]);
  const apgujeong = await buildClientsOverview({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  assert.equal(apgujeong.summary.onlineSalesAmount, 0);
  assert.equal(apgujeong.summary.onlineOrderCount, 0);
}));

test("Clients storeCoverage distinguishes missing upload from a real zero", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await mkdir(join(workDir, "ecount-sales"), { recursive: true });
  const apgujeong = await buildClientsOverview({ since: "2026-08-01", until: "2026-08-11", storeCode: "APGUJEONG", workDir });
  assert.equal(apgujeong.summary.totalClients, 0);
  assert.deepEqual(apgujeong.storeCoverage.includedMonths, []);
  assert.deepEqual(apgujeong.storeCoverage.missingMonths, ["2026-08"]);
}));

// --- PART F: Brand Intelligence (20, 21, 25) — B00000SK ("나밀리아"/NAMILIA) is a real,
// stable Brand Master entry (work/brand-master.json), reused here instead of a synthetic
// brand so resolveIdentity() resolves through the real (unmodified) identity pipeline.

test("20/21. Brand APGUJEONG/VAIL offline revenue is correct and store-isolated", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "brand-master.json"), await readFile(new URL("../work/brand-master.json", import.meta.url)));
  await writeStoreSnapshot(workDir, "2026-08", "APGUJEONG", [offlineLineFixture({ date: "2026-08-01", storeCode: "APGUJEONG", amount: 60000, customerName: "매장방문고객", slipNo: "1" })]);
  await writeStoreSnapshot(workDir, "2026-08", "VAIL", [offlineLineFixture({ date: "2026-08-02", storeCode: "VAIL", amount: 25000, customerName: "매장방문고객", slipNo: "2" })]);
  const apgujeong = await buildBrandCustomerComposition("B00000SK", "2026-08", {}, "APGUJEONG", workDir);
  const vail = await buildBrandCustomerComposition("B00000SK", "2026-08", {}, "VAIL", workDir);
  assert.equal(apgujeong.revenueByStore.APGUJEONG, 60000);
  assert.equal(apgujeong.revenueByStore.VAIL, 25000, "revenueByStore always reflects real per-store split regardless of the storeCode filter applied");
  assert.equal(vail.revenueByStore.APGUJEONG, 60000);
  assert.equal(vail.revenueByStore.VAIL, 25000);
  assert.equal(apgujeong.topCustomers.reduce((s, c) => s + c.sales, 0), 60000, "APGUJEONG-filtered customer stats only include APGUJEONG lines");
  assert.equal(vail.topCustomers.reduce((s, c) => s + c.sales, 0), 25000);
}));

test("25. unsupported metric (brand customer composition) never silently reuses ALL when store data is missing", () => withTemp(async (dir) => {
  const workDir = join(dir, "work");
  await mkdir(join(workDir, "ecount-sales"), { recursive: true });
  const apgujeong = await buildBrandCustomerComposition("B00000SK", "2026-08", {}, "APGUJEONG", workDir);
  assert.equal(apgujeong.storeHasData, false);
  assert.equal(apgujeong.topCustomers.length, 0);
}));

// --- PART F Brand Score: Inventory Integrity must be unavailable (not company-wide ALL
// silently reused) when a physical store is selected. This guard lives in client JS
// (outputs/samplas-marketing-os.js, refreshEntityScore) which isn't unit-testable via the
// Node test runner (DOM/module-global coupled) — verified structurally instead. ---

test("26. Inventory Integrity guard: inventoryPoints computation is gated on storeFilterState === \"ALL\"", async () => {
  const source = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const match = source.match(/let inventoryPoints = null;\s*\n\s*if \(([^)]+)\)/);
  assert.notEqual(match, null, "inventoryPoints guard not found");
  assert.match(match[1], /storeFilterState === "ALL"/, "Inventory Integrity must be gated on ALL — a physical store's Score must not silently reuse company-wide inventory");
});

test("27. partial coverage normalization rule (availableWeight >= 60) is unchanged", async () => {
  const source = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  assert.match(source, /availableWeight >= 60/, "Score formula's partial-coverage threshold must not be changed by this batch");
});

// --- PART G: shared store state across all supported screens ---

test("28. showStoreFilter includes all 6 target screens sharing the single storeFilterState", async () => {
  const source = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  const match = source.match(/const showStoreFilter = \[([^\]]+)\]/);
  assert.notEqual(match, null);
  for (const view of ["Overview", "Reports", "Sales", "Clients", "BrandDashboard"]) {
    assert.match(match[1], new RegExp(`"${view}"`), `${view} must share the global Store selector`);
  }
  const declarations = source.match(/let storeFilterState\s*=/g) || [];
  assert.equal(declarations.length, 1, "storeFilterState must still be declared exactly once");
});

// --- PART 29/30: existing channel semantics / other selectors unchanged ---

test("29. buildCanonicalTotalSales online computation still never references storeCode (unchanged since STORE-BATCH-C)", () => {
  const fnSource = String(buildCanonicalTotalSales);
  const onlineLine = fnSource.match(/const onlinePaidAmount = [^;]+;/)?.[0];
  assert.notEqual(onlineLine, undefined);
  assert.doesNotMatch(onlineLine, /storeCode/);
});

test("30. existing operationsRange/monthSelect selectors are untouched by this batch", async () => {
  const source = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  assert.match(source, /let operationsRange = "month";/);
  assert.match(source, /function renderMonthSelect\(\)/);
});
