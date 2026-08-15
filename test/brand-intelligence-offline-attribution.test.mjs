import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildBrandCustomerComposition } from "../server.mjs";

const root = resolve(".");
const js = await readFile(resolve(root, "outputs/samplas-marketing-os.js"), "utf8");

function sourceOfFunction(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} missing`);
  const brace = js.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < js.length; i += 1) {
    if (js[i] === "{") depth += 1;
    if (js[i] === "}") depth -= 1;
    if (depth === 0) return js.slice(start, i + 1);
  }
  throw new Error(`${name} source incomplete`);
}

function runAggregation(name, offlineState) {
  const rows = [];
  let coverage = null;
  const category = name === "rebuildEntityCategoryRows";
  const fn = Function(
    "brandIdentityState", "entitySkuSalesState", "entitySkuRows", "entityTrendMonths",
    "currentEntityPeriodMonthKey", "entityOfflineAttributionState", "CATEGORY_MASTER_V1",
    category ? "entityCategoryRows" : "entityColorRows",
    category ? "renderEntityCategorySection" : "renderEntityColorSection",
    `${category ? "let entityCategoryCoverage" : "let entityColorCoverage"} = null;
     ${sourceOfFunction(name)}
     ${name}();
     return { rows: ${category ? "entityCategoryRows" : "entityColorRows"}, coverage: ${category ? "entityCategoryCoverage" : "entityColorCoverage"} };`
  )(
    { brandCode: "B1" }, { brandCode: "B1", fetchFailed: false },
    [{ categoryCode: "TOP", colorFamily: "WHITE", colorRaw: "WHITE", revenue: 100, quantitySold: 1 }],
    [{ key: "2026-08", revenue: 400, quantitySold: 3 }], () => "2026-08", offlineState,
    [{ code: "TOP", name: "상의" }, { code: "UNCLASSIFIED", name: "미분류" }], rows, () => {}
  );
  coverage = fn.coverage;
  return { rows: fn.rows, coverage };
}

test("Category and Color add canonical offline attribution without changing online SKU count", () => {
  const state = {
    brandCode: "B1", periodMonth: "2026-08", ready: true, fetchFailed: false,
    rows: [{ categoryCode: "TOP", colorFamily: "WHITE", colorRaw: "OIL WHITE", revenue: 300, quantitySold: 2 }]
  };
  const category = runAggregation("rebuildEntityCategoryRows", state);
  assert.deepEqual(category.rows[0], { code: "TOP", name: "상의", revenue: 400, quantitySold: 3, skuCount: 1 });
  assert.equal(category.coverage.attributedRevenue, 400);
  assert.equal(category.coverage.coveragePct, 100);

  const color = runAggregation("rebuildEntityColorRows", state);
  assert.equal(color.rows[0].family, "WHITE");
  assert.equal(color.rows[0].revenue, 400);
  assert.equal(color.rows[0].quantitySold, 3);
  assert.equal(color.rows[0].skuCount, 1);
  assert.deepEqual(color.rows[0].rawExpressions.sort(), ["OIL WHITE", "WHITE"]);
  assert.equal(color.coverage.coveragePct, 100);
});

test("offline fetch failure is not presented as zero coverage", () => {
  const failed = { brandCode: "B1", periodMonth: "2026-08", ready: false, fetchFailed: true, rows: [] };
  assert.equal(runAggregation("rebuildEntityCategoryRows", failed).coverage.totalRevenue, null);
  assert.equal(runAggregation("rebuildEntityColorRows", failed).coverage.totalRevenue, null);
});

test("real CARNET August offline lines are canonical-resolved once on the server", async () => {
  const result = await buildBrandCustomerComposition("B00000KU", "2026-08", {
    brands: [{ brand_code: "B00000KU", brand_name: "카르넷 아카이브" }],
    products: [{ brand_code: "B00000KU", productName: "[CARNET ARCHIVE] catalog evidence" }]
  }, null, resolve(root, "work"));
  assert.ok(result.offlineAttributionRows.length > 0);
  assert.ok(result.offlineAttributionRows.some((row) => row.productName.includes("A Soldier’s Dog Tag OIL BLACK")));
  assert.ok(result.offlineAttributionRows.some((row) => row.productName.includes("Unearthed Fragment Chain OIL BLACK")));
  assert.ok(
    result.offlineAttributionRows.reduce((sum, row) => sum + row.revenue, 0)
      <= result.revenueByStore.APGUJEONG + result.revenueByStore.VAIL,
    "attribution keeps refunds while customer/store purchase metrics remain positive-sale only"
  );
  assert.ok(result.offlineAttributionRows.every((row) => row.productName !== "퀵비-1"));
});
