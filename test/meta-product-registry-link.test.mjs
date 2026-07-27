import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichMetaProductBreakdown,
  parseMetaContentId,
  resolveMetaContentId,
  buildProductRegistryIndex
} from "../scripts/meta-product-registry-link.mjs";

const registry = {
  entries: [
    {
      canonicalProductId: "CP-C24-5860",
      brandName: "TOGA",
      canonicalProductName: "Metal Sabot",
      status: "confirmed",
      verified: true,
      confidence: 100,
      cafe24: { productNo: "5860", productCode: "P0000IRK", productName: "[TOGA] Metal Sabot", variants: [{ variantCode: "P0000IRK000B", optionName: "Black / 240" }] },
      ecount: { matchedProducts: [{ prodCd: "TOG001" }] }
    },
    {
      canonicalProductId: "CP-C24-6193",
      brandName: "GOOMHEO",
      canonicalProductName: "Tailored Jacket",
      status: "candidate",
      verified: false,
      cafe24: { productNo: "6193", productCode: "P0000JEF", productName: "[GOOMHEO] Tailored Jacket" },
      ecount: { matchedProducts: [] }
    },
    {
      canonicalProductId: "CP-RETAILER-MANUAL",
      brandName: "MANUAL",
      canonicalProductName: "Manual Catalog Item",
      status: "manual",
      retailerId: "manual-retailer-1",
      cafe24: { productNo: "9999" }
    }
  ]
};

test("parses Cafe24 product.variant content_id", () => {
  assert.deepEqual(parseMetaContentId("5860.P0000IRK000B"), {
    rawContentId: "5860.P0000IRK000B",
    cafe24ProductNo: 5860,
    variantCode: "P0000IRK000B",
    format: "cafe24_product_variant",
    valid: true
  });
  assert.deepEqual(parseMetaContentId("12072.P0000RWI000A, [p.l.n. : 피엘엔] big oilskin bag black"), {
    rawContentId: "12072.P0000RWI000A",
    cafe24ProductNo: 12072,
    variantCode: "P0000RWI000A",
    format: "cafe24_product_variant",
    valid: true
  });
});

test("does not coerce manual ids into Cafe24 ids", () => {
  assert.equal(parseMetaContentId("1005").format, "manual_numeric_id");
  assert.equal(parseMetaContentId("0jbl67j3tu").format, "manual_or_unknown_id");
  assert.equal(parseMetaContentId(null).format, "empty");
  assert.equal(parseMetaContentId("").format, "empty");
  assert.equal(parseMetaContentId("invalid.id.extra").valid, false);
  assert.equal(parseMetaContentId(["5860.P0000IRK000B"]).format, "array");
});

test("resolves by product_no + variant first", () => {
  const resolved = resolveMetaContentId("5860.P0000IRK000B", buildProductRegistryIndex(registry));
  assert.equal(resolved.matched, true);
  assert.equal(resolved.matchType, "product_no_variant_exact");
  assert.equal(resolved.product.brand, "TOGA");
  assert.equal(resolved.product.variantCode, "P0000IRK000B");
});

test("falls back to product_no exact when variant data is unavailable", () => {
  const resolved = resolveMetaContentId("6193.P0000JEF000B", buildProductRegistryIndex(registry));
  assert.equal(resolved.matched, true);
  assert.equal(resolved.matchType, "product_no_exact");
  assert.equal(resolved.product.brand, "GOOMHEO");
});

test("resolves retailer_id exact and leaves unknown ids unresolved", () => {
  const index = buildProductRegistryIndex(registry);
  assert.equal(resolveMetaContentId("manual-retailer-1", index).matchType, "retailer_id_exact");
  const unresolved = resolveMetaContentId("0jbl67j3tu", index);
  assert.equal(unresolved.matched, false);
  assert.equal(unresolved.matchType, "unresolved_manual_id");
});

test("enriches and aggregates duplicate content_id rows", () => {
  const result = enrichMetaProductBreakdown([
    { ad_id: "1", ad_name: "A", content_id: "5860.P0000IRK000B", actions: [{ action_type: "purchase", value: "2" }] },
    { ad_id: "1", ad_name: "A", product_id: "5860.P0000IRK000B", purchaseCount: 1 },
    { ad_id: "2", content_id: "0jbl67j3tu", purchaseCount: "3" },
    { ad_id: "3", content_id: null, purchaseCount: 9 }
  ], registry);
  assert.equal(result.summary.rowCount, 2);
  assert.equal(result.summary.attributedPurchases, 6);
  assert.equal(result.summary.matchedRows, 1);
  assert.equal(result.summary.unresolvedRows, 1);
  assert.equal(result.rows.find((row) => row.contentId === "5860.P0000IRK000B").purchaseCount, 3);
});

for (const id of ["6960.P0000KHS000B", "14338.P0000VFM000G"]) {
  test(`sample ${id} remains safe when registry has no match`, () => {
    const resolved = resolveMetaContentId(id, buildProductRegistryIndex(registry));
    assert.equal(resolved.matched, false);
    assert.equal(resolved.matchType, "unresolved_product_registry_miss");
  });
}
