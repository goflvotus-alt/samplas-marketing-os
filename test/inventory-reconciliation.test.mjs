import assert from "node:assert/strict";
import {
  DEFAULT_THRESHOLDS,
  normalizeInventoryValue,
  reconcileInventoryPair,
  summarizeItems
} from "../scripts/diagnose-inventory-reconciliation.mjs";

const baseMatch = {
  productId: "p1",
  brandId: "B1",
  canonicalProductName: "Sample",
  ecountProductCode: "E1",
  cafe24ProductId: "C1",
  cafe24VariantIds: ["V1"],
  matchStatus: "confirmed",
  matchMethod: "manual",
  matchConfidence: 1,
  sourcePath: "test"
};

function pair(ecount, cafe24, duplicateFlags = []) {
  return reconcileInventoryPair(
    baseMatch,
    ecount === undefined ? null : { inventory: normalizeInventoryValue(ecount), row: { productName: "Sample" } },
    cafe24 === undefined ? null : { inventory: normalizeInventoryValue(cafe24), product: { productName: "Sample" }, variantFlags: [] },
    duplicateFlags,
    DEFAULT_THRESHOLDS
  );
}

assert.equal(pair(3, 3).reconciliationStatus, "exact_match");
assert.equal(pair(3, 2).reconciliationStatus, "within_tolerance");
assert.equal(pair(100, 98).reconciliationStatus, "within_tolerance");
assert.equal(pair(10, 4).reconciliationStatus, "mismatch");
assert.equal(pair(undefined, 4).reconciliationStatus, "missing_ecount");
assert.equal(pair(4, undefined).reconciliationStatus, "missing_cafe24");
assert.equal(pair(0, 0).differenceRate, 0);
assert.equal(pair(0, 3).reconciliationStatus, "mismatch");
assert.equal(pair(-1, 3).reconciliationStatus, "invalid_value");
assert.equal(normalizeInventoryValue("1,234").value, 1234);
assert.equal(normalizeInventoryValue("(2)").value, -2);
assert.equal(normalizeInventoryValue("abc").status, "invalid");
assert.equal(pair(1, 1, ["duplicate_ecount_product_code"]).reconciliationStatus, "duplicate_mapping");

const summary = summarizeItems([
  pair(1, 1),
  pair(2, 1),
  pair(100, 98),
  pair(10, 5),
  pair(undefined, 1),
  pair(1, undefined),
  pair("bad", 1),
  pair(1, 1, ["duplicate_product_id"])
], 2);
assert.equal(summary.exactMatchCount, 1);
assert.equal(summary.withinToleranceCount, 2);
assert.equal(summary.mismatchCount, 1);
assert.equal(summary.missingEcountInventoryCount, 1);
assert.equal(summary.missingCafe24InventoryCount, 1);
assert.equal(summary.invalidInventoryValueCount, 1);
assert.equal(summary.duplicateMappingCount, 1);
assert.equal(summary.excludedUnconfirmedMatchCount, 2);

console.log("inventory reconciliation tests passed");
