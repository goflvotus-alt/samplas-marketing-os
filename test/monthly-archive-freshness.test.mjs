import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mergeOfflineBrandSales } from "../scripts/monthly-brand-sales.mjs";
import { buildBrandRegistry } from "../scripts/brand-engine.mjs";

// NEXT-MONTHLY-ARCHIVE-STALE-CACHE implementation: monthlyArchiveBrandSalesIsFresh()/
// enrichMonthlyArchiveBrandSales() are private to server.mjs, so this reuses the
// sourceOf() + Function() extraction pattern already established in
// test/cross-brand-period-cutoff.test.mjs. enrichMonthlyArchiveBrandSales() calls out to
// readEcountOfflineSalesSnapshot/loadResolverContext/mergeOfflineBrandSales/monthEndKey/
// workDir as free variables, so those are injected as Function() parameters — the tests
// run the real server.mjs source text (not a reimplementation), with the real
// mergeOfflineBrandSales() reused unmodified (test/monthly-brand-sales.test.mjs's
// synthetic-identityContext pattern) so the canonical merge logic itself is unchanged.
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

function sourceOf(name) {
  const asyncStart = serverSource.indexOf(`async function ${name}(`);
  const plainStart = serverSource.indexOf(`function ${name}(`);
  // "function name(" also matches inside "async function name(" one character later —
  // prefer the async form when both indexOf calls land on the same declaration.
  const start = asyncStart !== -1 && asyncStart + 6 === plainStart ? asyncStart : plainStart;
  assert.notEqual(start, -1, `${name} source missing from server.mjs`);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = start; index < serverSource.length; index += 1) {
    if (serverSource[index] === "(") parenDepth += 1;
    if (serverSource[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { paramsEnd = index; break; }
    }
  }
  assert.notEqual(paramsEnd, -1, `${name} parameter list incomplete`);
  const bodyStart = serverSource.indexOf("{", paramsEnd);
  let depth = 0;
  let opened = false;
  for (let index = bodyStart; index < serverSource.length; index += 1) {
    if (serverSource[index] === "{") { depth += 1; opened = true; }
    if (serverSource[index] === "}" && --depth === 0 && opened) return serverSource.slice(start, index + 1);
  }
  throw new Error(`${name} source incomplete`);
}

function loadMonthlyArchiveBrandSalesIsFresh() {
  return Function(`${sourceOf("monthlyArchiveBrandSalesIsFresh")}; return monthlyArchiveBrandSalesIsFresh;`)();
}

function loadEnrichMonthlyArchiveBrandSales({ readEcountOfflineSalesSnapshot, loadResolverContext, mergeOfflineBrandSales, workDir }) {
  const source = [
    sourceOf("monthlyArchiveBrandSalesIsFresh"),
    sourceOf("monthEndKey"),
    sourceOf("enrichMonthlyArchiveBrandSales")
  ].join("\n");
  return Function(
    "readEcountOfflineSalesSnapshot", "loadResolverContext", "mergeOfflineBrandSales", "workDir",
    `${source}; return enrichMonthlyArchiveBrandSales;`
  )(readEcountOfflineSalesSnapshot, loadResolverContext, mergeOfflineBrandSales, workDir);
}

// ---------------------------------------------------------------------------
// 1/2. monthlyArchiveBrandSalesIsFresh(): pure freshness decision.
// ---------------------------------------------------------------------------
test("1. archive newer than or equal to the source snapshot's import time is fresh", () => {
  const isFresh = loadMonthlyArchiveBrandSalesIsFresh();
  assert.equal(isFresh("2026-08-05T04:35:15.709Z", "2026-08-05T04:35:11.454Z"), true, "archive merged after the snapshot was imported");
  assert.equal(isFresh("2026-08-05T04:35:11.454Z", "2026-08-05T04:35:11.454Z"), true, "equal timestamps are fresh");
  assert.equal(isFresh(null, null), true, "no source snapshot exists — nothing to invalidate against");
});

test("2. archive older than the source snapshot, or missing its marker entirely, is stale", () => {
  const isFresh = loadMonthlyArchiveBrandSalesIsFresh();
  assert.equal(isFresh("2026-08-01T00:00:00.000Z", "2026-08-05T04:35:11.454Z"), false, "snapshot was re-imported after the archive was merged");
  assert.equal(isFresh(null, "2026-08-05T04:35:11.454Z"), false, "archive predates freshness tracking (e.g. the frozen 2026-07 archive) — must re-merge once");
});

// ---------------------------------------------------------------------------
// 3. stale archive invokes canonical enrichment; fresh archive short-circuits.
// ---------------------------------------------------------------------------
test("3. stale archive calls mergeOfflineBrandSales; fresh archive returns the same reference untouched", async () => {
  const calls = [];
  const spyMerge = (args) => { calls.push(args); return [{ brand_code: "SPY", offlineSalesAmount: 1 }]; };
  const enrich = loadEnrichMonthlyArchiveBrandSales({
    readEcountOfflineSalesSnapshot: async () => ({ importedAt: "2026-08-05T04:35:11.454Z", salesLines: [] }),
    loadResolverContext: async () => ({}),
    mergeOfflineBrandSales: spyMerge,
    workDir: "/tmp/unused"
  });

  const staleArchive = { month: "2026-07", commerce: { brandSalesBasis: "online_offline", brandSales: [] } };
  const staleResult = await enrich(staleArchive, "2026-07");
  assert.equal(calls.length, 1, "stale archive (missing brandSalesSourceImportedAt) must trigger a re-merge");
  assert.notEqual(staleResult, staleArchive, "a rebuilt archive is a new object");
  assert.equal(staleResult.commerce.brandSalesSourceImportedAt, "2026-08-05T04:35:11.454Z");

  const freshArchive = { month: "2026-07", commerce: { brandSalesBasis: "online_offline", brandSalesSourceImportedAt: "2026-08-05T04:35:15.709Z", brandSales: [] } };
  const freshResult = await enrich(freshArchive, "2026-07");
  assert.equal(calls.length, 1, "fresh archive must not trigger another merge");
  assert.equal(freshResult, freshArchive, "fresh archive is returned by reference (no rebuild)");
});

// ---------------------------------------------------------------------------
// 4. the route persists a corrected archive only when a rebuild actually happened.
// ---------------------------------------------------------------------------
test("4. GET /api/reports/monthly persists the archive only when enrichMonthlyArchiveBrandSales rebuilt it", () => {
  const routeSource = serverSource.slice(
    serverSource.indexOf('if (url.pathname === "/api/reports/monthly")'),
    serverSource.indexOf('if (url.pathname === "/api/reports/monthly-comparison-cutoff")')
  );
  assert.match(routeSource, /const enriched = await enrichMonthlyArchiveBrandSales\(cached, month\);/);
  assert.match(routeSource, /if \(enriched !== cached\) \{/, "must only persist when the reference changed (a real rebuild), not on every fresh-cache request");
  assert.match(routeSource, /await writeMonthlyArchive\(month, \{ \.\.\.enriched, archiveStatus: "saved" \}\);/);
});

// ---------------------------------------------------------------------------
// 5-13. Real production functions (mergeOfflineBrandSales + a synthetic identityContext
// shaped exactly like test/monthly-brand-sales.test.mjs's working recipe). Fixture mirrors
// the real July bug: an offline-only brand entirely missing from the online catalog
// (TROUBLED WATERS-shaped, same 6 line amounts/dates as the real ECOUNT snapshot, renamed
// SUNDAYOFFCLUB to reuse the exact working alias-resolution recipe) plus a brand that
// already has online sales and must keep them while offline is correctly added on top
// (CARNET-shaped — live verification found the frozen archive was ALSO under-reporting
// this brand by omitting its offline portion entirely, not only missing the offline-only
// brand's row; see docs/reports/NEXT-MONTHLY-ARCHIVE-STALE-CACHE-implementation.md §5/§6).
// ---------------------------------------------------------------------------
const offlineOnlyBrandMaster = { brand_code: "B00000HD", brand_name: "선데이오프클럽" };
const existingOnlineBrandMaster = { brand_code: "B00000KU", brand_name: "카르넷 아카이브" };

async function loadResolverContextFixture() {
  return {
    brandMaster: { brands: [offlineOnlyBrandMaster, existingOnlineBrandMaster] },
    brandRegistry: buildBrandRegistry({ brands: [offlineOnlyBrandMaster, existingOnlineBrandMaster] }),
    productRegistry: { entries: [] },
    reviewQueue: null,
    onlineCatalogRegistry: buildBrandRegistry({
      brands: [
        { brand_code: "B00000HD", brand_name: "선데이오프클럽", name_aliases: ["SUNDAYOFFCLUB"] },
        { brand_code: "B00000KU", brand_name: "카르넷 아카이브", name_aliases: ["CARNET"] }
      ]
    })
  };
}

const snapshotFixture = {
  importedAt: "2026-08-05T04:35:11.454Z",
  salesLines: [
    // offline-only brand — same 6 lines/amounts as the real TROUBLED WATERS July snapshot,
    // renamed to reuse the already-working SUNDAYOFFCLUB alias-resolution recipe.
    { date: "2026-07-01", documentNo: "1", productName: "SUNDAYOFFCLUB / Product A", brandGroup: "TRO", quantity: 1, salesAmount: 358000, isOfflineRevenue: true },
    { date: "2026-07-01", documentNo: "2", productName: "SUNDAYOFFCLUB / Product B", brandGroup: "TRO", quantity: 1, salesAmount: 382400, isOfflineRevenue: true },
    { date: "2026-07-07", documentNo: "4", productName: "SUNDAYOFFCLUB / Product C", brandGroup: "TRO", quantity: 1, salesAmount: 334600, isOfflineRevenue: true },
    { date: "2026-07-12", documentNo: "2", productName: "SUNDAYOFFCLUB / Product D", brandGroup: "TRO", quantity: 1, salesAmount: 798400, isOfflineRevenue: true },
    { date: "2026-07-12", documentNo: "8", productName: "SUNDAYOFFCLUB / Product E", brandGroup: "TRO", quantity: 1, salesAmount: 230400, isOfflineRevenue: true },
    { date: "2026-07-13", documentNo: "18", productName: "SUNDAYOFFCLUB / Product F", brandGroup: "TRO", quantity: 1, salesAmount: 310400, isOfflineRevenue: true },
    // existing online brand's offline lines — must be ADDED to its online baseline, not replace it.
    { date: "2026-07-05", documentNo: "9", productName: "CARNET / Existing Online Product", brandGroup: "CAR", quantity: 1, salesAmount: 500000, isOfflineRevenue: true }
  ]
};

const staleArchiveFixture = {
  month: "2026-07",
  commerce: {
    // brandSalesBasis already set (mirrors the real frozen July archive), but no
    // brandSalesSourceImportedAt — this is exactly the shape of the bug being repaired.
    brandSalesBasis: "online_offline",
    brandSales: [{
      brand_code: "B00000KU",
      brand_name: "카르넷 아카이브",
      quantitySold: 4,
      orderCount: 3,
      sales: { grossAmount: 1200000, paidAmount: 1000000, discountAmount: 200000 }
    }],
    paidAmount: 1000000
  }
};

async function buildFixtureResult() {
  const enrich = loadEnrichMonthlyArchiveBrandSales({
    readEcountOfflineSalesSnapshot: async () => snapshotFixture,
    loadResolverContext: loadResolverContextFixture,
    mergeOfflineBrandSales,
    workDir: "/tmp/unused"
  });
  return enrich(staleArchiveFixture, "2026-07");
}

test("5. missing canonical brand row (offline-only brand) is restored by the rebuild", async () => {
  const result = await buildFixtureResult();
  const offlineOnly = result.commerce.brandSales.find((row) => row.brand_code === "B00000HD");
  assert.ok(offlineOnly, "offline-only brand row must exist after rebuild — it was entirely absent from the stale archive");
});

test("6-11. Revenue/Units/Orders/AOV/Online/Offline are all preserved correctly for the restored brand", async () => {
  const result = await buildFixtureResult();
  const row = result.commerce.brandSales.find((r) => r.brand_code === "B00000HD");
  assert.equal(row.sales.paidAmount, 2414200, "Revenue");
  assert.equal(row.quantitySold, 6, "Units");
  assert.equal(row.orderCount, 6, "Orders");
  assert.equal(Math.round(row.sales.paidAmount / row.orderCount), 402367, "AOV = revenue / orders");
  assert.equal(row.onlinePaidAmount, 0, "Online — this brand has no online presence");
  assert.equal(row.offlineSalesAmount, 2414200, "Offline");
});

test("12. TROUBLED WATERS-shaped July regression: exact canonical figures reproduced by the real merge function", async () => {
  const result = await buildFixtureResult();
  const row = result.commerce.brandSales.find((r) => r.brand_code === "B00000HD");
  assert.deepEqual(
    { revenue: row.sales.paidAmount, units: row.quantitySold, orders: row.orderCount, online: row.onlinePaidAmount, offline: row.offlineSalesAmount },
    { revenue: 2414200, units: 6, orders: 6, online: 0, offline: 2414200 },
    "matches the canonical July TROUBLED WATERS values verified 3x independently in docs/reports/NEXT-MONTHLY-ARCHIVE-STALE-CACHE-plan.md §5 (Units 6, not the previously-assumed 7)"
  );
});

test("13. CARNET-shaped regression: an existing online brand keeps its online baseline and gets offline correctly added on top (not replaced, not double-counted)", async () => {
  const result = await buildFixtureResult();
  const row = result.commerce.brandSales.find((r) => r.brand_code === "B00000KU");
  assert.equal(row.onlinePaidAmount, 1000000, "online baseline preserved unchanged");
  assert.equal(row.offlineSalesAmount, 500000, "offline portion merged in");
  assert.equal(row.sales.paidAmount, 1500000, "online 1,000,000 baseline + offline 500,000 = 1,500,000 — this is exactly the shape of the bug live-verified against CARNET ARCHIVE's real July archive (23,303,130 online-only before repair -> 44,157,830 combined after, see implementation report §6)");
});

// ---------------------------------------------------------------------------
// 14/15. Completed-month cross-brand comparison and the STEP67 current-month
// partial-period cutoff endpoint never read/write work/monthly/*.json, so they are
// structurally immune to this whole class of bug and untouched by this fix.
// ---------------------------------------------------------------------------
test("14/15. buildCrossBrandComparisonPeriodPayload()/the cutoff endpoint never call the monthly archive cache", () => {
  const source = sourceOf("buildCrossBrandComparisonPeriodPayload");
  assert.doesNotMatch(source, /readMonthlyArchive\(/);
  assert.doesNotMatch(source, /writeMonthlyArchive\(/);
  assert.doesNotMatch(source, /enrichMonthlyArchiveBrandSales\(/);
});
