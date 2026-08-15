import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrandRegistry } from "../scripts/brand-engine.mjs";
import { buildStoreProductIdentityIndex, resolveStoreProductIdentity } from "../scripts/store-product-identity.mjs";

const brands = buildBrandRegistry({ brands: [
  { brand_code: "B-1", brand_name: "BRAND", name_aliases: ["Brand Co"], active: true },
  { brand_code: "B-2", brand_name: "OTHER", name_aliases: [], active: true }
] });

function entry(overrides = {}) {
  return {
    canonicalProductId: "CP-1", brandId: "B-1", brandName: "BRAND", canonicalProductName: "Product Black",
    status: "ambiguous", verified: false,
    matching: { diagnosticType: ["exact_one_to_many"] },
    ecount: { matchedProducts: [{ productName: "BRAND / Product-Black", size: "M" }] },
    ...overrides
  };
}

test("exact confirmed match remains resolved", () => {
  const index = buildStoreProductIdentityIndex({ entries: [entry({ status: "confirmed", verified: true })] });
  assert.equal(resolveStoreProductIdentity({ productName: "BRAND / Product-Black", specification: "M" }, index, brands).method, "exact_confirmed");
});

test("case, whitespace and punctuation normalization resolve one deterministic candidate", () => {
  const index = buildStoreProductIdentityIndex({ entries: [entry()] });
  const result = resolveStoreProductIdentity({ productName: " brand   / product black ", specification: "m" }, index, brands);
  assert.equal(result.status, "resolved");
  assert.equal(result.method, "deterministic_registry_alias");
});

test("size conflict and unknown products remain unresolved", () => {
  const index = buildStoreProductIdentityIndex({ entries: [entry()] });
  assert.equal(resolveStoreProductIdentity({ productName: "BRAND / Product Black", specification: "L" }, index, brands).reason, "unknown_product");
  assert.equal(resolveStoreProductIdentity({ productName: "BRAND / Missing", specification: "M" }, index, brands).reason, "unknown_product");
});

test("duplicate canonical candidates remain ambiguous", () => {
  const index = buildStoreProductIdentityIndex({ entries: [entry(), entry({ canonicalProductId: "CP-2" })] });
  assert.equal(resolveStoreProductIdentity({ productName: "BRAND / Product Black", specification: "M" }, index, brands).reason, "ambiguous");
});

test("a resolved conflicting brand blocks the product match", () => {
  const index = buildStoreProductIdentityIndex({ entries: [entry({ ecount: { matchedProducts: [{ productName: "OTHER / Product Black", size: "M" }] } })] });
  assert.equal(resolveStoreProductIdentity({ productName: "OTHER / Product Black", specification: "M" }, index, brands).reason, "brand_conflict");
});

test("name-only candidates without ECOUNT identity remain unresolved", () => {
  const index = buildStoreProductIdentityIndex({ entries: [entry({ ecount: { matchedProducts: [] } })] });
  assert.equal(resolveStoreProductIdentity({ productName: "BRAND / Product Black", specification: "M" }, index, brands).reason, "unknown_product");
  assert.equal(resolveStoreProductIdentity({ productName: "", specification: "M" }, index, brands).reason, "insufficient_identity");
});
