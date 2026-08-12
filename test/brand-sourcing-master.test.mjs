import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildBrandSourcingMaster,
  classifyBrandSourcing,
  isExactThirtyPercent,
  isOperationalCoGroup,
  stripConsignmentPrefix
} from "../scripts/build-brand-sourcing-master.mjs";

test("brand sourcing signals and conservative rollup", () => {
  assert.equal(isOperationalCoGroup("BON CO"), true);
  assert.equal(isOperationalCoGroup("BONNAE"), false);
  assert.equal(stripConsignmentPrefix("CON - BONNAE / Bag"), "BONNAE / Bag");
  assert.equal(stripConsignmentPrefix("SECOND / CON ITEM"), "SECOND / CON ITEM");
  assert.equal(isExactThirtyPercent("30", "100"), true);
  assert.equal(isExactThirtyPercent("30.01", "100"), false);
  assert.equal(classifyBrandSourcing({ co_sales_lines: 1, con_prefix_products: 0, exact_30_products: 0, resolved_sales_lines: 1, resolved_products: 0 }, "WHOLESALE"), "HYBRID");
  assert.equal(classifyBrandSourcing({ co_sales_lines: 0, con_prefix_products: 0, exact_30_products: 0, resolved_sales_lines: 1, resolved_products: 1 }, null), "UNKNOWN");
});

test("builder resolves canonical aliases without treating operational groups as brands", () => {
  const result = buildBrandSourcingMaster({
    brandMaster: {
      updatedAt: "2026-08-11T00:00:00.000Z",
      brands: [
        { brand_code: "B00000SA", brand_name: "본네", name_aliases: ["BONNAE"], active: true },
        { brand_code: "B00000HM", brand_name: "민타임", name_aliases: ["MEANTIME"], active: true },
        { brand_code: "B00000ZZ", brand_name: "UNKNOWN", name_aliases: [], active: true }
      ]
    },
    products: [{ PROD_DES: "CON-BONNAE / Bag", IN_PRICE: "0", OUT_PRICE: "0" }],
    salesSnapshots: [{ month: "2026-07", importedAt: "2026-08-10T00:00:00.000Z", salesLines: [{ productName: "BONNAE / Bag", brandGroup: "BON CO" }] }],
    candidates: [{ brand_code: "B00000SA", sourcing_type: "WHOLESALE" }]
  });
  assert.equal(result.brands.find((row) => row.brand_code === "B00000SA").sourcing_type, "HYBRID");
  assert.equal(result.brands.find((row) => row.brand_code === "B00000HM").sourcing_type, "OWN_PRODUCTION");
  assert.equal(result.brands.find((row) => row.brand_code === "B00000ZZ").sourcing_type, "UNKNOWN");
  assert.equal(result.sources.exact_30_percent_signal, "NOT_ACTIVE");
  assert.equal(result.brands.some((row) => row.brand_name === "BON CO"), false);
});
