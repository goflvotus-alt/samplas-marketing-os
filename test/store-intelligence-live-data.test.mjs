import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBrandRegistry } from "../scripts/brand-engine.mjs";
import { buildStoreProductIntelligence, composeStoreIntelligencePayload } from "../server.mjs";

const brandMaster = {
  brands: [{ brand_code: "B-PAC", brand_name: "PACOSPLY", name_aliases: [], active: true }]
};
const identityContext = {
  brandMaster,
  brandRegistry: buildBrandRegistry(brandMaster),
  productRegistry: { entries: [] },
  reviewQueue: null
};

function vailPayload() {
  return composeStoreIntelligencePayload({
    store: { storeCode: "VAIL", displayName: "SAMPLAS VAIL" },
    since: "2026-08-01",
    until: "2026-08-14",
    snapshots: [{
      month: "2026-08",
      periodStart: "2026-08-03",
      periodEnd: "2026-08-13",
      importedAt: "2026-08-14T00:00:00.000Z",
      sourceFileName: "2026-08.xlsx",
      dailySales: [{ date: "2026-08-13", offlineSalesAmount: 70200 }],
      salesLines: [{
        date: "2026-08-13", documentNo: "12", slipNo: "12", productName: "PACOSPLY / WonderLand T-shirts BLACK",
        brandGroup: "PAC", specification: "2", quantity: 1, salesAmount: 70200, isOfflineRevenue: true, storeCode: "VAIL"
      }]
    }],
    canonicalSales: { offlineSales: { offlineSalesAmount: 70200 } },
    clients: {
      summary: { totalClients: 1, offlineQuantity: 1, offlineOrderCount: 1, avgOrderValue: 70200 },
      typeBreakdown: [{ type: "samplas_press", label: "SAMPLAS PRESS", clientCount: 1, salesAmount: 70200 }],
      stylistTop10: [],
      clients: [{ clientId: "1", name: "고객", clientType: "samplas_press", latestPurchaseDate: "2026-08-13", purchaseCount: 1, totalSales: 70200 }]
    },
    identityContext
  });
}

test("VEIL oracle is composed only from canonical helper results", () => {
  const payload = vailPayload();
  assert.equal(payload.store.code, "VAIL");
  assert.equal(payload.store.displayName, "VEIL");
  assert.equal(payload.sales.periodSales, 70200);
  assert.equal(payload.sales.latestDaySales, 70200);
  assert.equal(payload.sales.quantity, 1);
  assert.equal(payload.sales.orderCount, 1);
  assert.equal(payload.sales.avgOrderValue, 70200);
  assert.equal(payload.brands.items.length, 1);
  assert.equal(payload.brands.items[0].brand_name, "PACOSPLY");
  assert.equal(payload.brands.items[0].salesAmount, 70200);
});

test("unsupported sections are unavailable, never fabricated zero arrays", () => {
  const payload = vailPayload();
  assert.equal(payload.products.available, true);
  assert.equal(payload.products.items.length, 0);
  assert.equal(payload.products.coverage.unresolvedLines, 1);
  assert.equal(payload.categories.items[0].name, "미분류");
  assert.equal(payload.categories.items[0].salesAmount, 70200);
  for (const key of ["inventory", "sellThrough", "newBrands", "insights", "relationships", "brandClientCross"]) {
    assert.equal(payload[key].available, false, key);
    assert.ok(payload[key].reason, key);
  }
});

test("store products use exact confirmed Product Registry matches", () => {
  const registry = { entries: [{
    canonicalProductId: "CP-1", brandId: "B-1", brandName: "BRAND", canonicalProductName: "CANONICAL",
    verified: true, status: "confirmed", ecount: { matchedProducts: [{ productName: "BRAND / Product", size: "M" }] }
  }] };
  const result = buildStoreProductIntelligence([
    { isOfflineRevenue: true, productName: "BRAND / Product", specification: "M", quantity: 2, salesAmount: 100, date: "2026-08-01", documentNo: "1" },
    { isOfflineRevenue: true, productName: "BRAND / Product", specification: "M", quantity: 1, salesAmount: 50, date: "2026-08-01", documentNo: "1" },
    { isOfflineRevenue: true, productName: "BRAND / Product typo", specification: "M", quantity: 9, salesAmount: 900, date: "2026-08-01", documentNo: "2" },
    { isOfflineRevenue: false, productName: "BRAND / Product", specification: "M", quantity: 9, salesAmount: 900, date: "2026-08-01", documentNo: "3" }
  ], registry);
  assert.deepEqual(result.items, [{
    product_code: "CP-1", product_name: "CANONICAL", brand_code: "B-1", brand_name: "BRAND",
    quantitySold: 3, salesAmount: 150, orderCount: 1,
    matchingEvidence: ["exact_normalized_product_name", "exact_normalized_size", "existing_registry_identity"]
  }]);
  assert.deepEqual(result.coverage, {
    resolvedLines: 2, unresolvedLines: 1,
    resolvedBy: { exact_confirmed: 2 }, unresolvedBy: { unknown_product: 1 }
  });
});

test("ambiguous exact product keys stay unresolved", () => {
  const entry = (id) => ({ canonicalProductId: id, verified: true, status: "confirmed", ecount: { matchedProducts: [{ productName: "SAME", size: "OS" }] } });
  const result = buildStoreProductIntelligence([
    { isOfflineRevenue: true, productName: "SAME", specification: "OS", quantity: 1, salesAmount: 10 }
  ], { entries: [entry("CP-1"), entry("CP-2")] });
  assert.equal(result.items.length, 0);
  assert.deepEqual(result.coverage, {
    resolvedLines: 0, unresolvedLines: 1,
    resolvedBy: {}, unresolvedBy: { ambiguous: 1 }
  });
});

test("Store Intelligence excludes sales lines tagged for another store", () => {
  const mixed = vailPayload();
  const baseSnapshot = {
    month: "2026-08", periodStart: "2026-08-01", periodEnd: "2026-08-14",
    salesLines: [
      { date: "2026-08-13", productName: "PACOSPLY / WonderLand T-shirts BLACK", specification: "2", quantity: 1, salesAmount: 70200, isOfflineRevenue: true, storeCode: "VAIL" },
      { date: "2026-08-13", productName: "PACOSPLY / WonderLand T-shirts BLACK", specification: "2", quantity: 99, salesAmount: 999999, isOfflineRevenue: true, storeCode: "APGUJEONG" }
    ]
  };
  const result = composeStoreIntelligencePayload({
    store: { storeCode: "VAIL", displayName: "SAMPLAS VAIL" }, since: "2026-08-01", until: "2026-08-14",
    snapshots: [baseSnapshot], canonicalSales: { offlineSales: { offlineSalesAmount: 70200 } }, clients: mixed.clients,
    identityContext
  });
  assert.equal(result.products.coverage.unresolvedLines, 1);
});

test("Store Intelligence source contains no former mock objects or fabricated values", async () => {
  const source = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  for (const forbidden of [
    "MOCK_APGUJEONG_INTELLIGENCE", "MOCK_VAIL_INTELLIGENCE", "8,420,000원", "5,180,000원",
    "382,700원", "167,100원", "Archive Wool Coat", "Signature Knit Top", "1,240개", "182,600,000원"
  ]) assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), forbidden);
});
