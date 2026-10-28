// Auto mapping from visual findings against fake Meta catalog rows and Cafe24 views. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { SAMPLAS_META } from "../scripts/instagram-product-tags.mjs";
import { approveAutoTags, buildAutoMapping } from "../scripts/instagram-product-tag-automap.mjs";

const manifest = { folderName: "TAEGLOBAL-26AW", items: [{ savedAsset: "assets/01.jpg" }, { savedAsset: "assets/02.jpg" }] };
// Meta rows per product group. 15567: M sold out on Meta, L in stock. 15568: other brand name. 15569: all sold out.
// 15571: two colors, BLACK only in stock.
const rows = {
  15571: [["A", "M", "in stock", "RED"], ["B", "M", "in stock", "BLACK"]],
  15567: [["A", "M", "in stock"], ["B", "L", "in stock"]],
  15568: [["A", "M", "in stock"]],
  15569: [["A", "M", "out of stock"]],
  15570: [["A", "M", "in stock"]]
};
const graph = { async get(path, params) {
  assert.equal(path, `${SAMPLAS_META.catalogId}/products`);
  const no = params.filter.retailer_product_group_id.eq;
  return { data: (rows[no] || []).map(([code, size, availability, color]) => ({ id: `${no}${code}`, retailer_id: `${no}.${code}`, name: `${no === "15568" ? "[OTHER] TAEGLOBAL" : "[TAEGLOBAL : 타에글로벌]"} ${no} ${size}`, availability, color })) };
} };
const cafe24 = async (no) => ({ productNo: no, selling: "T", display: "T", fetchedAt: "x",
  options: [{ variantCode: "A", available: no !== 15567 && no !== 15571 }, { variantCode: "B", available: true }] });
const item = (candidates, over = {}) => ({ label: "jacket", x: 0.5, y: 0.4, candidates, ...over });
const findings = (items, over = {}) => ({ schemaVersion: 1, folderName: "TAEGLOBAL-26AW", analyzer: "test",
  slides: [{ order: 1, savedAsset: "assets/01.jpg", items }], ...over });
const map = (items, over) => buildAutoMapping({ graph, findings: findings(items, over), manifest, getCafe24Product: cafe24, now: 0 });
const tag = async (c, over) => (await map([item(c, over)])).mapping.slides[0].tags[0];

test("one clear candidate: first option in stock on both Meta and Cafe24, never approved", async () => {
  const t = await tag([{ productNo: 15567, confidence: 0.92, evidence: "olive mesh vest, grey buckles" }, { productNo: 15568, confidence: 0.3 }]);
  assert.deepEqual([t.status, t.approved, t.metaProductId, t.retailerId, t.x, t.y], ["PROPOSED", false, "15567B", "15567.B", 0.5, 0.4]);
  assert.match(t.evidence, /olive mesh vest.*15567\.B.*next candidate 15568/);
});

test("unclear match or stock goes to review, never another product", async () => {
  const reason = async (c, over) => (await tag(c, over)).reason;
  assert.equal(await reason([{ productNo: 15567, confidence: 0.7 }]), "visual_low_confidence");
  assert.equal(await reason([{ productNo: 15567, confidence: 0.95 }, { productNo: 15570, confidence: 0.5 }]), "visual_ambiguous_candidates");
  assert.equal(await reason([{ productNo: 15571, confidence: 0.9 }]), "color_unconfirmed");
  assert.equal(await reason([{ productNo: 15571, confidence: 0.9 }], { color: "green" }), "color_not_in_product");
  assert.equal(await reason([{ productNo: 15571, confidence: 0.9 }], { color: "red" }), "no_in_stock_option");
  assert.equal((await tag([{ productNo: 15571, confidence: 0.9 }], { color: "black" })).metaProductId, "15571B");
  assert.equal(await reason([{ productNo: 15568, confidence: 0.9 }]), "brand_mismatch");
  assert.equal(await reason([{ productNo: 15569, confidence: 0.9 }]), "no_in_stock_option");
  assert.equal(await reason([{ productNo: 99999, confidence: 0.9 }]), "meta_product_not_found");
  assert.equal(await reason([{ productNo: 15570, confidence: 0.9 }], { x: 2 }), "invalid_coordinates");
  const m = await map([item([]), item([{ productNo: 15570, confidence: 0.9 }]), item([{ productNo: 15570, confidence: 0.95 }])]);
  assert.deepEqual(m.mapping.slides[0].review.map((r) => r.reason), ["no_catalog_match", "duplicate_product_on_slide"]);
  assert.equal(m.mapping.source.state, "TAG_REVIEW_REQUIRED");
});

test("findings must match the manifest and name the analyzer", async () => {
  assert.deepEqual((await map([], { analyzer: "", slides: [{ order: 2, savedAsset: "assets/01.jpg" }] })).problems, ["analyzer_missing", "asset_mismatch:2"]);
});

test("approval: a named person picks proposed tags; the rest are skipped", async () => {
  const { mapping } = await map([item([{ productNo: 15567, confidence: 0.9 }]), item([{ productNo: 15570, confidence: 0.6 }])]);
  const builtAt = mapping.source.builtAt;
  assert.deepEqual(approveAutoTags(mapping, [{ order: 1, productNo: 15567 }], { builtAt }).problems, ["approver_required"]);
  assert.deepEqual(approveAutoTags(mapping, [{ order: 1, productNo: 15567 }], { by: "op", builtAt: "older" }).problems, ["mapping_changed"]);
  assert.deepEqual(approveAutoTags(mapping, [], { by: "op", builtAt }).problems, ["no_tags_selected"]);
  assert.deepEqual(approveAutoTags(mapping, [{ order: 1, productNo: 15570 }], { by: "op", builtAt }).problems, ["not_proposed:1:15570"]);
  assert.deepEqual(approveAutoTags(mapping, [{ order: 1, productNo: 1 }], { by: "op", builtAt }).problems, ["unknown_tag:1:1"]);
  const ok = approveAutoTags(mapping, [{ order: 1, productNo: 15567 }], { by: "op", builtAt, now: 0 });
  assert.deepEqual(ok.mapping.slides[0].tags.map((t) => [t.productNo, t.approved, t.status, t.approvedBy]), [[15567, true, "PENDING", "op"]]);
  assert.deepEqual(ok.mapping.slides[0].skipped.map((t) => [t.productNo, t.status]), [[15570, "SKIPPED"]]);
  assert.equal(ok.mapping.source.state, "APPROVED");
});
