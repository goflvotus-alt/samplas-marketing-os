import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BATCH B (Per-SKU Sales + Stock Drill-down). Same source-extraction + Function() execution
// pattern already established by test/brand-intelligence-customer-purchase-detail.test.mjs
// (no jsdom in this repo) — the real function bodies are pulled out of
// outputs/samplas-marketing-os.js and run with injected free variables, not reimplemented.
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOfFunction(name) {
  const asyncMarker = `async function ${name}(`;
  const asyncStart = js.indexOf(asyncMarker);
  const marker = asyncStart !== -1 ? asyncMarker : `function ${name}(`;
  const start = asyncStart !== -1 ? asyncStart : js.indexOf(marker);
  assert.notEqual(start, -1, `${name} missing`);
  // Skip past the parameter list via paren-depth scan before brace-counting the body, so a
  // default-parameter object literal (e.g. `record = {}`) can't be mistaken for the body's
  // opening/closing brace.
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = start; index < js.length; index += 1) {
    if (js[index] === "(") parenDepth += 1;
    if (js[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { bodyStart = js.indexOf("{", index); break; }
    }
  }
  assert.notEqual(bodyStart, -1, `${name} body not found`);
  let depth = 0;
  let opened = false;
  for (let index = bodyStart; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(start, index + 1);
  }
  throw new Error(`${name} incomplete`);
}

// Extracts the value text of a `<key>: { ... }` object-literal property (brace-depth scan,
// same technique as sourceOfFunction but for an object member instead of a function decl).
function sourceOfObjectProperty(objectMarker, key) {
  const objectStart = js.indexOf(objectMarker);
  assert.notEqual(objectStart, -1, `${objectMarker} missing`);
  const propMarker = `${key}: {`;
  const start = js.indexOf(propMarker, objectStart);
  assert.notEqual(start, -1, `${key} missing inside ${objectMarker}`);
  const braceStart = start + key.length + 2;
  let depth = 0;
  let opened = false;
  for (let index = braceStart; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(braceStart, index + 1);
  }
  throw new Error(`${key} incomplete`);
}

const SKU_JOIN_SOURCE = [
  sourceOfFunction("hasApiValue"),
  sourceOfFunction("firstFiniteValue"),
  sourceOfFunction("canonicalPaidAmount"),
  sourceOfFunction("entitySkuStockFor"),
  sourceOfFunction("entityRegistryEntryByProdCd"),
  sourceOfFunction("entityEcountProdCdFor"),
  sourceOfFunction("entityEcountProductNameFor"),
  sourceOfFunction("loadEntityProductRegistryEntries"),
  sourceOfFunction("rebuildEntitySkuRows"),
  sourceOfFunction("refreshEntitySkuSales"),
  sourceOfFunction("refreshOpenEntitySkuDrawer")
].join("\n\n");

// Real product-registry entry shape confirmed live against /api/intelligence/product-registry
// this session (Phase 2): { cafe24: {productNo, productCode, productName}, ecount:
// {matchedProducts: [{prodCd, barcode, ...}]}, status, verified, confidence }.
function registryEntry(overrides = {}) {
  return {
    verified: true,
    status: "confirmed",
    cafe24: { productNo: "1001", productCode: "CAR-1001", productName: "CARNET ARCHIVE / Test Jacket" },
    ecount: { matchedProducts: [{ prodCd: "ECT-1001", barcode: "8800000001" }] },
    ...overrides
  };
}

// Real productSales entry shape confirmed live against /api/reports/monthly?month=2026-08
// (Phase 1): { productNo, productCode, productName, brand_code, brand_name, quantitySold,
// salesVelocityPerDay, orderCount, salesAmount, canonicalPaidAmount, sales: {paidAmount,...} }.
function saleRow(overrides = {}) {
  return {
    productNo: "1001",
    productCode: "CAR-1001",
    productName: "CARNET ARCHIVE / Test Jacket",
    brand_code: "B00000KU",
    brand_name: "카르넷 아카이브",
    quantitySold: 3,
    salesVelocityPerDay: 0.1,
    orderCount: 2,
    salesAmount: 126400,
    sales: { paidAmount: 126400 },
    ...overrides
  };
}

// Real inventory item shape confirmed live against /api/inventory/overview?brand=raw:carnet
// archive (Phase 1): { brandKey, brandName, prodCd, barcode, productName, stockQuantity, ... }.
function inventoryItem(overrides = {}) {
  return { brandKey: "raw:carnet archive", prodCd: "ECT-1001", barcode: "8800000001", productName: "CARNET ARCHIVE JACKET(ECOUNT)", stockQuantity: 12, ...overrides };
}

function loadSkuJoin({ brandCode, sharedJsonResponses = {}, drawerOpen = false }) {
  const renderCalls = { count: 0 };
  const getSharedJsonImpl = async (url) => sharedJsonResponses[url] ?? { entries: [] };
  const fn = Function(
    "brandIdentityState", "getSharedJson", "entityDrawerState", "renderEntityDrawerBody", "renderEntityProductSection",
    "loadEntityCategoryManualOverrides", "classifyEntityProductCategory", "rebuildEntityCategoryRows",
    "loadEntityColorMaster", "classifyEntityProductColor", "rebuildEntityColorRows",
    "refreshEntityScore", "currentEntityPeriodMonthKey",
    `
    let entitySkuSalesState = { brandCode: null, periodMonth: null, rows: [], fetchFailed: false };
    let entityInventoryItemsState = { brandCode: null, brandKey: null, items: [], fetchFailed: false, ready: false };
    let entityProductRegistryEntriesPromise = null;
    let entitySkuJoinDiagnostics = { matchedStock: 0, unmatchedStock: 0, salesRows: 0 };
    const entitySkuRows = [];
    ${SKU_JOIN_SOURCE}
    return {
      entitySkuRows,
      refreshEntitySkuSales,
      setInventoryState: (state) => { entityInventoryItemsState = state; },
      rebuildEntitySkuRows,
      getDiagnostics: () => entitySkuJoinDiagnostics,
      getRenderCallCount: () => renderCalls.count
    };
    `
  );
  return fn(
    { brandCode },
    getSharedJsonImpl,
    { open: drawerOpen, type: drawerOpen ? "sku" : null },
    () => { renderCalls.count += 1; },
    () => {},
    async () => new Map(),
    () => ({ code: "UNCLASSIFIED", subcategoryCode: null, source: "fallback" }),
    () => {},
    async () => null,
    () => ({ family: "UNKNOWN", raw: null, matchedAliases: [], source: "fallback" }),
    () => {},
    () => {},
    () => "2026-08"
  );
}

const CARNET = "B00000KU";
const OTHER = "B00000SA";

// 1. productSales selected-brand filtering
test("1. refreshEntitySkuSales filters productSales to the selected brand_code only", async () => {
  const ctx = loadSkuJoin({ brandCode: CARNET });
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow(), saleRow({ productNo: "2002", brand_code: OTHER })], false);
  assert.equal(ctx.entitySkuRows.length, 1);
  assert.equal(ctx.entitySkuRows[0].productNo, "1001");
});

// 2. productSales selected-period semantics: the caller passes only the selected month's
// archive (not the whole trend range) — confirmed structurally at the call site.
test("2. refreshEntityTrendMonths passes only the selected period's archive.commerce.productSales, not the whole trend range", () => {
  const fnSource = sourceOfFunction("refreshEntityTrendMonths");
  assert.match(fnSource, /const periodIndex = months\.indexOf\(periodMonth\);/);
  assert.match(fnSource, /const periodArchive = archives\[periodIndex\];/);
  assert.match(fnSource, /refreshEntitySkuSales\(brandCode, periodMonth, periodProductSales, Boolean\(periodArchive\?\.error\)\)/);
});

// 3. entitySkuRows populated (no longer the permanent [] placeholder)
test("3. entitySkuRows is populated from real sales rows, not left as an empty placeholder", async () => {
  const ctx = loadSkuJoin({ brandCode: CARNET });
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow()], false);
  assert.equal(ctx.entitySkuRows.length, 1);
  assert.equal(ctx.entitySkuRows[0].productName, "CARNET ARCHIVE / Test Jacket");
});

// 4. inventory item join: verified+confirmed registry entry links sales productNo to ecount prodCd
test("4. inventory items are joined via verified+confirmed Product Registry entries only", async () => {
  const ctx = loadSkuJoin({
    brandCode: CARNET,
    sharedJsonResponses: { "/api/intelligence/product-registry": { entries: [registryEntry()] } }
  });
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow()], false);
  ctx.setInventoryState({ brandCode: CARNET, brandKey: "raw:carnet archive", items: [inventoryItem()], fetchFailed: false, ready: true });
  await ctx.rebuildEntitySkuRows();
  assert.equal(ctx.entitySkuRows[0].stock, 12);
  assert.equal(ctx.entitySkuRows[0].stockMatched, true);
});

// 5. sales+stock joined row (Case A)
test("5. Case A — sales and stock both present -> one row with both real values", async () => {
  const ctx = loadSkuJoin({
    brandCode: CARNET,
    sharedJsonResponses: { "/api/intelligence/product-registry": { entries: [registryEntry()] } }
  });
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow()], false);
  ctx.setInventoryState({ brandCode: CARNET, brandKey: "raw:carnet archive", items: [inventoryItem()], fetchFailed: false, ready: true });
  await ctx.rebuildEntitySkuRows();
  assert.equal(ctx.entitySkuRows.length, 1);
  assert.equal(ctx.entitySkuRows[0].revenue, 126400);
  assert.equal(ctx.entitySkuRows[0].stock, 12);
  assert.equal(ctx.getDiagnostics().matchedStock, 1);
});

// 6. sales-only row (Case B) — no registry entry for this productNo -> stock stays "-", not 0
test("6. Case B — sales exists, no registry match -> stock is null (\"-\"), never a fabricated 0", async () => {
  const ctx = loadSkuJoin({
    brandCode: CARNET,
    sharedJsonResponses: { "/api/intelligence/product-registry": { entries: [] } }
  });
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow()], false);
  ctx.setInventoryState({ brandCode: CARNET, brandKey: "raw:carnet archive", items: [inventoryItem()], fetchFailed: false, ready: true });
  await ctx.rebuildEntitySkuRows();
  assert.equal(ctx.entitySkuRows.length, 1);
  assert.equal(ctx.entitySkuRows[0].revenue, 126400);
  assert.equal(ctx.entitySkuRows[0].stock, null);
  assert.equal(ctx.entitySkuRows[0].stockMatched, false);
});

// 7. stock-only row (Case C) — registry-confirmed item has stock but no online sales this period
test("7. Case C — stock exists, no online sales this period -> a stock-only row with real 0 sales fields (not null)", async () => {
  const ctx = loadSkuJoin({
    brandCode: CARNET,
    sharedJsonResponses: { "/api/intelligence/product-registry": { entries: [registryEntry()] } }
  });
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [], false); // nothing sold online this period
  ctx.setInventoryState({ brandCode: CARNET, brandKey: "raw:carnet archive", items: [inventoryItem()], fetchFailed: false, ready: true });
  await ctx.rebuildEntitySkuRows();
  assert.equal(ctx.entitySkuRows.length, 1);
  const row = ctx.entitySkuRows[0];
  assert.equal(row.stockOnly, true);
  assert.equal(row.stock, 12);
  assert.equal(row.revenue, 0, "confirmed real zero online sales this period, not null");
  assert.equal(row.quantitySold, 0);
});

// 8. unmatched identity does not fuzzy-match (productName text match is never used as the join key)
test("8. unmatched identity never falls back to productName text matching", async () => {
  const ctx = loadSkuJoin({
    brandCode: CARNET,
    sharedJsonResponses: {
      "/api/intelligence/product-registry": {
        entries: [registryEntry({ cafe24: { productNo: "9999", productCode: "CAR-9999", productName: "CARNET ARCHIVE / Test Jacket" } })]
      }
    }
  });
  // Same productName as the registry entry, but a *different* productNo — a text match would
  // wrongly link these; the exact-productNo join must not.
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow({ productNo: "1001", productName: "CARNET ARCHIVE / Test Jacket" })], false);
  ctx.setInventoryState({ brandCode: CARNET, brandKey: "raw:carnet archive", items: [inventoryItem()], fetchFailed: false, ready: true });
  await ctx.rebuildEntitySkuRows();
  const salesRow = ctx.entitySkuRows.find((r) => r.productNo === "1001");
  assert.equal(salesRow.stock, null, "same productName but different productNo must not match");
  assert.equal(salesRow.stockMatched, false);
});

// 9. sales failure != zero
test("9. sales fetch failure produces no rows (not a fabricated empty-but-zero sales state)", async () => {
  const ctx = loadSkuJoin({ brandCode: CARNET });
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow()], true); // fetchFailed = true
  assert.equal(ctx.entitySkuRows.length, 0);
  assert.equal(ctx.getDiagnostics().salesRows, 0);
});

// 10. inventory failure != zero
test("10. inventory fetch failure marks rows stockUnavailable, stock stays null, never a fabricated 0", async () => {
  const ctx = loadSkuJoin({ brandCode: CARNET });
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow()], false);
  ctx.setInventoryState({ brandCode: CARNET, brandKey: "raw:carnet archive", items: [], fetchFailed: true, ready: true });
  await ctx.rebuildEntitySkuRows();
  assert.equal(ctx.entitySkuRows[0].stock, null);
  assert.equal(ctx.entitySkuRows[0].stockUnavailable, true);
});

// 11. actual zero preserved (genuine zero quantitySold in a real productSales row stays 0)
test("11. a real productSales row with genuine zero quantity/orders is preserved as 0, not hidden", async () => {
  const ctx = loadSkuJoin({ brandCode: CARNET });
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow({ quantitySold: 0, orderCount: 0, salesAmount: 0, sales: { paidAmount: 0 } })], false);
  assert.equal(ctx.entitySkuRows[0].quantitySold, 0);
  assert.equal(ctx.entitySkuRows[0].orderCount, 0);
  assert.equal(ctx.entitySkuRows[0].revenue, 0);
});

// 12. brand switch stale guard: rows for the old brand must not leak into the new brand's list
test("12. brand switch — SKU rows are cleared, not leaked, when the active brand no longer matches", async () => {
  const ctx = loadSkuJoin({ brandCode: OTHER }); // brandIdentityState is already on OTHER
  await ctx.refreshEntitySkuSales(CARNET, "2026-08", [saleRow()], false); // stale response for the old brand
  assert.equal(ctx.entitySkuRows.length, 0, "a sales response for a brand that is no longer selected must not populate entitySkuRows");
});

// 13. period switch stale guard: refreshEntityTrendMonths recomputes the period-scoped sales
// slice fresh on every call (no residual state carried across periods) and closes any open
// SKU Drawer at the very start, mirroring BATCH A's clientOrders guard exactly.
test("13. refreshEntityTrendMonths closes an open SKU Drawer at its very start (brand/period switch stale-data guard)", () => {
  const fnSource = sourceOfFunction("refreshEntityTrendMonths");
  const guardIndex = fnSource.indexOf('if (entityDrawerState.open && ["sku", "order"].includes(entityDrawerState.type)) closeEntityDrawer();');
  const brandCheckIndex = fnSource.indexOf("if (!brandIdentityState.brandCode)");
  assert.notEqual(guardIndex, -1);
  assert.ok(guardIndex < brandCheckIndex, "the SKU stale-data guard must run before any brand/period branching, i.e. on every single invocation");
});

// 14. SKU drawer real rows (row template uses real field names, not the old id/name/mom placeholder shape)
test("14. entityDrawerSkuRowHtml renders real fields, not the old id/name/mom placeholder shape", () => {
  const source = [
    sourceOfFunction("esc"),
    "const nf = new Intl.NumberFormat(\"ko-KR\");",
    sourceOfFunction("hasApiValue"),
    sourceOfFunction("apiNum"),
    sourceOfFunction("apiWon"),
    sourceOfFunction("entityProductDisplayName"),
    sourceOfFunction("entityDrawerSkuRowHtml")
  ].join("\n\n");
  const fn = Function("brandSelectorActiveName", `${source}; return entityDrawerSkuRowHtml;`)("CARNET ARCHIVE");
  const matched = fn({ productNo: "1001", productCode: "CAR-1001", productName: "Test Jacket", revenue: 126400, quantitySold: 3, orderCount: 2, stock: 12 }, 0);
  assert.match(matched, /Test Jacket/);
  assert.match(matched, /126,400원/);
  assert.match(matched, /12개/);
  assert.doesNotMatch(matched, /undefined/);
  const unmatched = fn({ productNo: "1002", productCode: "CAR-1002", productName: "No Stock Item", revenue: 50000, quantitySold: 1, orderCount: 1, stock: null }, 1);
  assert.match(unmatched, />-<\/strong>/, "missing stock renders as \"-\", never \"0개\"");
});

// 15/16. search + sort reuse the existing drawer config's real field names (matchesQuery/sortFns)
const SKU_CONFIG_SOURCE = sourceOfObjectProperty("const entityDrawerConfig = {", "sku");
function loadSkuConfig() {
  return Function("entitySkuRows", "entityDrawerSkuRowHtml", `return ${SKU_CONFIG_SOURCE};`)([], () => "");
}

test("15. SKU drawer search matches productName or productCode (not the old row.name/row.id placeholder fields)", () => {
  const config = loadSkuConfig();
  const row = { productName: "CARNET ARCHIVE / Test Jacket", productCode: "CAR-1001" };
  assert.ok(config.matchesQuery(row, "test jacket"));
  assert.ok(config.matchesQuery(row, "car-1001"));
  assert.ok(!config.matchesQuery(row, "no match"));
});

test("16. SKU drawer sort options operate on real revenue/quantitySold/orderCount/stock fields", () => {
  const config = loadSkuConfig();
  const rows = [
    { revenue: 100, quantitySold: 5, orderCount: 1, stock: 10 },
    { revenue: 300, quantitySold: 2, orderCount: 4, stock: null }
  ];
  assert.deepEqual([...rows].sort(config.sortFns.revenue_desc).map((r) => r.revenue), [300, 100]);
  assert.deepEqual([...rows].sort(config.sortFns.qty_desc).map((r) => r.quantitySold), [5, 2]);
  assert.deepEqual([...rows].sort(config.sortFns.orders_desc).map((r) => r.orderCount), [4, 1]);
  assert.deepEqual([...rows].sort(config.sortFns.stock_desc).map((r) => r.stock), [10, null], "unmatched (null) stock sorts to the bottom, not treated as 0");
});

// No new sales fetch / no duplicate inventory fetch (Phase 10) — structural checks.
test("fetch architecture: SKU sales reuses the already-fetched archive.commerce.productSales (no new sales endpoint)", () => {
  assert.doesNotMatch(js, /fetch\(`\/api\/(sku|product)-sales/);
  assert.match(js, /const periodProductSales = Array\.isArray\(periodArchive\?\.commerce\?\.productSales\)/);
});

test("fetch architecture: SKU stock reuses refreshEntityInventory's already-resolved row.brandKey (one inventory items request per brand, not a second rollup fetch)", () => {
  const fnSource = sourceOfFunction("refreshEntityInventory");
  const itemsFetchCount = (fnSource.match(/getJson\(intelligenceUrl\([`"]\/api\/inventory\/overview/g) || []).length;
  assert.equal(itemsFetchCount, 2, "exactly one rollup fetch (?limit=1) + one brand-filtered items fetch, not more");
  assert.match(fnSource, /\/api\/inventory\/overview\?brand=\$\{encodeURIComponent\(row\.brandKey\)\}/);
});
