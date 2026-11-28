// brand-products row shape for NEW ARRIVALS: dates pass through, variants are raw and opt-in. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { attachVariants, parseVariantRequest, projectBrandProduct, projectVariant } from "../scripts/cafe24-brand-products.mjs";

test("product row keeps the five existing fields and adds created_date/updated_date (null when absent)", () => {
  const row = { product_no: 16393, brand_code: "B00000YF", product_name: "[GROSSI] JACKET", display: "T", selling: "T", sold_out: "F",
    created_date: "2026-11-25T10:01:02+09:00", updated_date: "2026-11-27T09:00:00+09:00", price: "1", detail_image: "x" };
  assert.deepEqual(projectBrandProduct(row), { product_no: 16393, brand_code: "B00000YF", product_name: "[GROSSI] JACKET", display: "T", selling: "T", sold_out: "F",
    created_date: "2026-11-25T10:01:02+09:00", updated_date: "2026-11-27T09:00:00+09:00" });
  assert.deepEqual([projectBrandProduct({ product_no: 1 }).created_date, projectBrandProduct({ product_no: 1 }).updated_date], [null, null]);
});

test("variant stock is raw: quantity/use_inventory from inventories, null when unknown, display_soldout ignored", () => {
  const v = projectVariant({ variant_code: "P0000X0A", options: [{ name: "SIZE", value: "M" }], display: "T", selling: "T",
    inventories: [{ quantity: 2, use_inventory: "T", display_soldout: "T" }] });
  assert.deepEqual(v, { variant_code: "P0000X0A", options: [{ name: "SIZE", value: "M" }], quantity: 2, use_inventory: "T", display: "T", selling: "T" });
  assert.equal("sold_out" in v || "soldOut" in v, false);
  assert.deepEqual([projectVariant({ variant_code: "A" }).quantity, projectVariant({ variant_code: "A" }).use_inventory], [null, null]);
  assert.equal(projectVariant({ variant_code: "A", inventories: { quantity: "0", use_inventory: "F" } }).quantity, 0);
});

test("include=variants needs product_nos, positive integers, capped at 100; no include = no variants", () => {
  const q = (s) => parseVariantRequest(new URLSearchParams(s));
  assert.deepEqual(q("brand_code=B1"), { ok: true, productNos: [] });
  assert.deepEqual(q("include=variants&product_nos=3,1,3"), { ok: true, productNos: [3, 1] });
  assert.equal(q("include=variants").ok, false);
  assert.equal(q("include=variants&product_nos=1,x").ok, false);
  assert.equal(q("include=variants&product_nos=0").ok, false);
  assert.equal(q("include=images&product_nos=1").ok, false);
  assert.equal(q(`include=variants&product_nos=${Array.from({ length: 101 }, (_, i) => i + 1).join(",")}`).ok, false);
  assert.equal(q(`include=variants&product_nos=${Array.from({ length: 100 }, (_, i) => i + 1).join(",")}`).ok, true);
});

test("variants only for listed products, one failure marks only that product", async () => {
  const calls = [];
  const out = await attachVariants([{ product_no: 1 }, { product_no: 2 }, { product_no: 3 }], [1, 3], async (no) => {
    calls.push(no);
    if (no === 3) throw new Error("Cafe24 429");
    return [{ variant_code: "A", inventories: [{ quantity: 1, use_inventory: "T" }] }];
  });
  assert.deepEqual(calls, [1, 3]);
  assert.equal(out[0].variants[0].quantity, 1);
  assert.equal("variants" in out[1], false);
  assert.deepEqual([out[2].variants, out[2].variants_error], [null, "Cafe24 429"]);
});
