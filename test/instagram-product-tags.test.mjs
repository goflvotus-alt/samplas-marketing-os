// Instagram product tags against a fake Graph API: account checks, plan, apply (off by default), read-back.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateOption } from "../scripts/veil-found-soldout-audit.mjs";
import { applyTagPlan, buildTagPlan, CAFE24_MAX_AGE_MS, createGraphClient, GraphError, preflight, SAMPLAS_META, toTagCafe24View, validateMapping, verifyTagPlan, withTagStatus } from "../scripts/instagram-product-tags.mjs";

const IG = SAMPLAS_META.igUserId;
const CATALOG = SAMPLAS_META.catalogId;
const WRITES = { INSTAGRAM_PRODUCT_TAG_WRITES: "on" };
const GO = { write: true, env: WRITES, acceptUnverifiedVariantApproval: true };
const manifest = { items: [{ order: 1, savedAsset: "01.jpg" }, { order: 2, savedAsset: "02.jpg" }] };

function fakeGraph({ owner = IG, username = "samplaskr", children = ["c1", "c2"], tags = {}, products = {}, search = SEARCH, postFailures = [] } = {}) {
  const state = { tags: { c1: [], c2: [], ...tags }, posts: [], gets: 0 };
  const failures = [...postFailures];
  const graph = {
    async get(path, params = {}) {
      state.gets++;
      if (path === "app") return { id: SAMPLAS_META.appId };
      if (path === "me/permissions") return { data: ["instagram_basic", "instagram_shopping_tag_products", "catalog_management"].map((permission) => ({ permission, status: "granted" })) };
      if (path === IG) return { id: IG, username: "samplaskr", shopping_product_tag_eligibility: true };
      if (path === CATALOG) return { id: CATALOG, business: { id: SAMPLAS_META.businessId } };
      if (path === `${IG}/available_catalogs`) return { data: [{ catalog_id: CATALOG }] };
      if (path === "m1") return { id: "m1", media_type: "CAROUSEL_ALBUM", permalink: "https://instagram.com/p/x", username, owner: { id: owner } };
      if (path === "m1/children") return { data: children.map((id) => ({ id, media_type: "IMAGE" })) };
      if (path.endsWith("/product_tags") && state.failTagGet) throw new GraphError(500, {});
      if (path.endsWith("/product_tags")) return { data: state.tags[path.split("/")[0]].map((t) => ({ ...t })) };
      if (path === `${IG}/catalog_product_search`) return { data: search[params.q] ? [search[params.q]] : [] };
      if (path === `${CATALOG}/products`) return { data: products[params.filter.retailer_product_group_id.eq] || [] };
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path, params) {
      const child = path.split("/")[0];
      state.posts.push({ child, tags: params.updated_tags.map((t) => t.product_id) });
      const failure = failures.shift();
      if (failure?.applyFirst) apply(child, params.updated_tags);
      if (failure?.applyOnly) apply(child, params.updated_tags.filter((t) => failure.applyOnly.includes(t.product_id)));
      if (failure) throw failure.error;
      apply(child, params.updated_tags);
      return { success: true };
    }
  };
  // Meta semantics: additive, an existing product id only moves.
  function apply(child, updated) {
    for (const t of updated) {
      const hit = state.tags[child].find((x) => x.product_id === t.product_id);
      if (hit) Object.assign(hit, { x: t.x, y: t.y });
      else state.tags[child].push({ product_id: t.product_id, x: t.x, y: t.y, review_status: "approved" });
    }
  }
  return { graph, state };
}
const row = (id, retailerId, availability = "in stock") => ({ id, retailer_id: retailerId, name: `item ${id}`, review_status: "", availability });
// Catalog rows as the live API returns them: review_status is "" everywhere (2026-10-28).
const PRODUCTS = {
  101: [row("P101", "101.BK"), row("P101S", "101.S", "out of stock")],
  102: [row("P102", "102.NV")],
  103: [row("P103", "103.GR")],
  104: [row("P104", "9104.BK")], // group hit whose retailer_id belongs to another product
  105: [row("P105", "105.BK")]
};
// IG catalog_product_search: one entry per product group, approval per group, variants without approval.
const group = (no, id, review, variants) => ({ product_id: id, retailer_id: `${no}.X`, review_status: review, product_variants: variants.map((v) => ({ product_id: v, variant_name: v })) });
const SEARCH = { 101: group(101, "P101S", "approved", ["P101S", "P101"]), 102: group(102, "P102", "approved", ["P102"]), 103: group(103, "P103", "rejected", ["P103"]), 105: group(105, "P105", "approved", ["P105"]) };
// Cafe24 as the tag route serves it: toTagCafe24View over raw detail + variants (embed=inventories).
// display_soldout "T" is the live SAMPLAS setting on every option (15195, 2026-10-28).
const variant = (code, quantity, inv = {}, over = {}) => ({ variant_code: code, selling: "T", display: "T", inventories: [{ use_inventory: "T", display_soldout: "T", quantity, ...inv }], ...over });
const view = (no, variants, over = {}) => ({ ...toTagCafe24View({ product_no: no, selling: "T", display: "T" }, variants), ...over });
const cafe24 = async (no) => view(no, (PRODUCTS[no] || []).map((r) => variant(r.retailer_id.split(".")[1], 3)), no === 105 ? { selling: "F" } : {});
const tag = (productNo, x, y, extra = {}) => ({ productNo, metaProductId: `P${productNo}`, x, y, approved: true, ...extra });
const mapping = (slides) => ({ schemaVersion: 1, slides: slides.map(([order, tags]) => ({ order, savedAsset: `0${order}.jpg`, tags })) });
const plan = (graph, slides, over = {}) => buildTagPlan({ graph, mapping: mapping(slides), manifest, mediaId: "m1", getCafe24Product: cafe24, ...over });
const states = (p) => p.slides.flatMap((s) => s.tags.map((t) => `${s.order}:${t.productNo}:${t.state}${t.reason ? `:${t.reason}` : ""}`));

test("preflight passes only for the SAMPLAS app, IG user, business and catalog", async () => {
  assert.deepEqual(await preflight(fakeGraph().graph), { ok: true, problems: [] });
  const g = fakeGraph().graph;
  const wrong = { ...g, get: async (path, params) => path === "app" ? { id: "1" } : path === CATALOG ? { business: { id: "2" } } : g.get(path, params) };
  assert.deepEqual((await preflight(wrong)).problems, ["app_mismatch", "catalog_mismatch", "business_mismatch"]);
  const blockedPlan = await buildTagPlan({ graph: wrong, mapping: mapping([[1, [tag(101, 0.5, 0.5)]]]), manifest, mediaId: "m1", getCafe24Product: cafe24 });
  assert.deepEqual([blockedPlan.state, blockedPlan.reason], ["TAG_REVIEW_REQUIRED", "preflight:app_mismatch,catalog_mismatch,business_mismatch"]);
});

test("post owned by another account: plan blocked, nothing can be sent", async () => {
  for (const over of [{ owner: "17840000000000000" }, { username: "other" }]) {
    const { graph, state } = fakeGraph({ ...over, products: PRODUCTS });
    const p = await plan(graph, [[1, [tag(101, 0.5, 0.5)]]]);
    assert.deepEqual([p.state, p.reason], ["TAG_REVIEW_REQUIRED", "media_owner_mismatch"]);
    assert.equal((await applyTagPlan(graph, p, GO)).applied, false);
    assert.equal(state.posts.length, 0);
  }
});

test("carousel children follow manifest order; slide count mismatch goes to review", async () => {
  const { graph } = fakeGraph({ products: PRODUCTS });
  const p = await plan(graph, [[1, [tag(101, 0.2, 0.3)]], [2, [tag(102, 0.6, 0.7)]]]);
  assert.deepEqual(p.slides.map((s) => [s.order, s.mediaId, s.tags[0].productId]), [[1, "c1", "P101"], [2, "c2", "P102"]]);
  assert.equal(p.state, "PENDING");
  const short = await plan(fakeGraph({ children: ["c1"], products: PRODUCTS }).graph, [[1, [tag(101, 0.5, 0.5)]]]);
  assert.equal(short.reason, "slide_count_mismatch:1!=2");
});

test("exact product id: retailer_id must parse to the product_no, metaProductId must be in the group, unapproved group excluded", async () => {
  const { graph } = fakeGraph({ products: PRODUCTS });
  const p = await plan(graph, [[1, [tag(101, 0.1, 0.1), tag(104, 0.2, 0.2), tag(103, 0.3, 0.3), tag(105, 0.4, 0.4)]],
    [2, [tag(102, 0.5, 0.5, { metaProductId: "P101" }), tag(102, 0.6, 0.6, { approved: false })]]]);
  assert.equal(p.slides[0].tags[0].productId, "P101");
  assert.deepEqual(p.slides[0].tags[0].approval, { group: "approved", variant: "UNVERIFIED" });
  assert.deepEqual(states(p), ["1:101:PENDING", "1:104:TAG_REVIEW_REQUIRED:meta_product_id_not_in_group", "1:103:TAG_REVIEW_REQUIRED:group_review_status:rejected",
    "1:105:TAG_REVIEW_REQUIRED:cafe24_not_selling_or_hidden", "2:102:TAG_REVIEW_REQUIRED:meta_product_id_not_in_group", "2:102:TAG_REVIEW_REQUIRED:not_approved_by_operator"]);
  assert.equal(p.state, "TAG_REVIEW_REQUIRED");
});

test("coordinates, duplicates in the mapping and the per-slide limit", async () => {
  const { graph } = fakeGraph({ products: PRODUCTS, tags: { c1: [1, 2, 3, 4].map((i) => ({ product_id: `E${i}`, x: 0.1, y: 0.1, review_status: "approved" })) } });
  const p = await plan(graph, [[1, [tag(102, 0.5, 0.5), tag(101, 0.6, 0.6)]], [2, [tag(101, 1.2, 0.5), tag(101, 0.2, 0.2), tag(101, 0.3, 0.3), tag(102, 0.4, 0.8)]]]);
  assert.deepEqual(states(p), ["1:102:TAG_REVIEW_REQUIRED:slide_tag_limit", "1:101:TAG_REVIEW_REQUIRED:slide_tag_limit",
    "2:101:TAG_REVIEW_REQUIRED:invalid_coordinates", "2:101:PENDING", "2:101:TAG_REVIEW_REQUIRED:duplicate_in_mapping", "2:102:PENDING"]);
});

test("writes are off by default: need write:true, INSTAGRAM_PRODUCT_TAG_WRITES=on and acceptUnverifiedVariantApproval", async () => {
  const { graph, state } = fakeGraph({ products: PRODUCTS });
  const p = await plan(graph, [[1, [tag(101, 0.5, 0.5)]]]);
  assert.equal((await applyTagPlan(graph, p)).reason, "writes_disabled");
  assert.equal((await applyTagPlan(graph, p, { write: true, env: {} })).reason, "writes_disabled");
  assert.equal((await applyTagPlan(graph, p, { env: WRITES })).reason, "writes_disabled");
  assert.equal((await applyTagPlan(graph, p, { write: true, env: WRITES })).reason, "variant_approval_unverified");
  assert.equal(state.posts.length, 0);
});

test("existing tags kept, multi-product coordinates applied, verified by read-back; re-run sends nothing", async () => {
  const existing = { product_id: "E1", x: 0.9, y: 0.9, review_status: "approved" };
  const { graph, state } = fakeGraph({ products: PRODUCTS, tags: { c1: [existing] } });
  const slides = [[1, [tag(101, 0.25, 0.4), tag(102, 0.75, 0.6)]], [2, [tag(102, 0.5, 0.5)]]];
  const p = await plan(graph, slides);
  await applyTagPlan(graph, p, GO);
  assert.deepEqual(state.posts, [{ child: "c1", tags: ["P101", "P102"] }, { child: "c2", tags: ["P102"] }]);
  const v = await verifyTagPlan(graph, p);
  assert.equal(v.state, "TAG_VERIFIED");
  assert.deepEqual(state.tags.c1.map((t) => [t.product_id, t.x, t.y]), [["E1", 0.9, 0.9], ["P101", 0.25, 0.4], ["P102", 0.75, 0.6]]);
  // Second run: everything already there, no POST. A changed mapping position is review, never a move.
  const again = await plan(graph, slides);
  assert.equal(again.state, "TAG_VERIFIED");
  assert.equal((await applyTagPlan(graph, again, GO)).reason, "plan_state:TAG_VERIFIED");
  const moved = await plan(graph, [[1, [tag(101, 0.3, 0.3), tag(102, 0.75, 0.6)]], [2, [tag(102, 0.5, 0.5)]]]);
  assert.equal(moved.slides[0].tags[0].reason, "existing_tag_position_differs");
  assert.equal((await applyTagPlan(graph, moved, GO)).reason, "plan_state:TAG_REVIEW_REQUIRED");
  assert.equal(state.posts.length, 2);
  assert.equal(state.tags.c1[1].x, 0.25);
});

test("ambiguous response (applied, then error) is resolved by re-GET without a second POST", async () => {
  const { graph, state } = fakeGraph({ products: PRODUCTS, postFailures: [{ applyFirst: true, error: new GraphError(0, {}) }] });
  const p = await plan(graph, [[1, [tag(101, 0.5, 0.5)]]]);
  await applyTagPlan(graph, p, GO);
  assert.equal(state.posts.length, 1);
  assert.equal((await verifyTagPlan(graph, p)).state, "TAG_VERIFIED");
  assert.equal(state.tags.c1.length, 1);
});

test("retryable error is retried once; permanent error goes to review without retry", async () => {
  const transient = fakeGraph({ products: PRODUCTS, postFailures: [{ error: new GraphError(500, { error: { code: 2 } }) }] });
  const p1 = await plan(transient.graph, [[1, [tag(101, 0.5, 0.5)]]]);
  await applyTagPlan(transient.graph, p1, GO);
  assert.equal(transient.state.posts.length, 2);
  assert.equal((await verifyTagPlan(transient.graph, p1)).state, "TAG_VERIFIED");

  const permanent = fakeGraph({ products: PRODUCTS, postFailures: [{ error: new GraphError(400, { error: { code: 100, message: "Invalid parameter" } }) }] });
  const p2 = await plan(permanent.graph, [[1, [tag(101, 0.5, 0.5)]]]);
  await applyTagPlan(permanent.graph, p2, GO);
  assert.equal(permanent.state.posts.length, 1);
  assert.deepEqual(states(await verifyTagPlan(permanent.graph, p2)), ["1:101:TAG_REVIEW_REQUIRED:post_failed:100"]);
});

test("a tag already on the slide is verified only when approved at the mapped position", async () => {
  const at = (x, review_status = "approved") => fakeGraph({ products: PRODUCTS, tags: { c1: [{ product_id: "P101", x, y: 0.5, review_status }] } }).graph;
  assert.deepEqual(states(await plan(at(0.5), [[1, [tag(101, 0.5, 0.5)]]])), ["1:101:TAG_VERIFIED:already_tagged"]);
  assert.deepEqual((await plan(at(0.5), [[1, [tag(101, 0.5, 0.5)]]])).slides[0].tags[0].approval, { group: "approved", variant: "APPROVED_IN_READBACK" });
  assert.deepEqual(states(await plan(at(0.5, "pending"), [[1, [tag(101, 0.5, 0.5)]]])), ["1:101:TAG_REVIEW_REQUIRED:existing_tag_not_approved"]);
  assert.deepEqual(states(await plan(at(0.8), [[1, [tag(101, 0.5, 0.5)]]])), ["1:101:TAG_REVIEW_REQUIRED:existing_tag_position_differs"]);
});

test("read-back catches a lost pre-existing tag and a moved tag", async () => {
  const { graph, state } = fakeGraph({ products: PRODUCTS, tags: { c1: [{ product_id: "E1", x: 0.9, y: 0.9, review_status: "approved" }] } });
  const p = await plan(graph, [[1, [tag(101, 0.5, 0.5)]]]);
  await applyTagPlan(graph, p, GO);
  state.tags.c1 = state.tags.c1.filter((t) => t.product_id !== "E1").map((t) => ({ ...t, x: 0.7 }));
  const v = await verifyTagPlan(graph, p);
  assert.equal(v.state, "TAG_REVIEW_REQUIRED");
  assert.deepEqual(v.slides[0].lostExisting, ["E1"]);
  assert.equal(v.slides[0].tags[0].reason, "readback_mismatch");
});

test("graph client: GET puts the token only in the request, errors never carry it", async () => {
  const seen = [];
  const client = createGraphClient({ getToken: async () => "TOKEN-123", fetchImpl: async (url, init) => {
    seen.push([init.method, String(url), init.body ? String(init.body) : ""]);
    return { ok: false, status: 400, json: async () => ({ error: { message: "bad", code: 100 } }) };
  } });
  const error = await client.get("m1", { fields: "id" }).catch((e) => e);
  assert.equal(error instanceof GraphError && error.code === 100 && !error.retryable, true);
  assert.equal(JSON.stringify({ ...error, message: error.message }).includes("TOKEN-123"), false);
  await client.post("c1/product_tags", { updated_tags: [{ product_id: "P1", x: 0.5, y: 0.5 }] }).catch(() => {});
  assert.equal(seen[1][1].includes("TOKEN-123"), false, "POST keeps the token out of the URL");
  assert.equal(seen[1][2].includes("updated_tags"), true);
});

test("partial batch: after an ambiguous error only the absent product is retried", async () => {
  const { graph, state } = fakeGraph({ products: PRODUCTS, postFailures: [{ applyOnly: ["P101"], error: new GraphError(503, {}) }] });
  const p = await plan(graph, [[1, [tag(101, 0.2, 0.2), tag(102, 0.8, 0.8)]]]);
  await applyTagPlan(graph, p, GO);
  assert.deepEqual(state.posts.map((x) => x.tags), [["P101", "P102"], ["P102"]]);
  assert.equal((await verifyTagPlan(graph, p)).state, "TAG_VERIFIED");
});

test("plan is re-checked at write time: changed slide, forged owner, failed read-back", async () => {
  const changed = fakeGraph({ products: PRODUCTS });
  const p1 = await plan(changed.graph, [[1, [tag(101, 0.5, 0.5)]]]);
  changed.state.tags.c1.push({ product_id: "P101", x: 0.1, y: 0.1, review_status: "approved" });
  await applyTagPlan(changed.graph, p1, GO);
  assert.deepEqual([changed.state.posts.length, changed.state.tags.c1[0].x, p1.slides[0].tags[0].reason], [0, 0.1, "slide_changed_or_full"]);

  const forged = fakeGraph({ products: PRODUCTS, owner: "17840000000000000" });
  const p2 = { state: "PENDING", mediaId: "m1", slides: [{ mediaId: "c1", existing: [], tags: [{ productId: "P101", x: 0.5, y: 0.5, state: "PENDING" }] }] };
  assert.equal((await applyTagPlan(forged.graph, p2, GO)).reason, "media_owner_mismatch");
  const foreignSlide = fakeGraph({ products: PRODUCTS });
  const p3 = { ...p2, slides: [{ ...p2.slides[0], mediaId: "x9", tags: [{ productId: "P101", x: 0.5, y: 0.5, state: "PENDING" }] }] };
  await applyTagPlan(foreignSlide.graph, p3, GO);
  assert.equal(p3.slides[0].tags[0].reason, "slide_not_in_media");
  assert.equal(forged.state.posts.length + foreignSlide.state.posts.length, 0);

  const blind = fakeGraph({ products: PRODUCTS, postFailures: [{ error: new GraphError(500, {}) }] });
  const p4 = await plan(blind.graph, [[1, [tag(101, 0.5, 0.5)]]]);
  const post = blind.graph.post;
  blind.graph.post = async (...a) => { blind.state.failTagGet = true; return post(...a); };
  await applyTagPlan(blind.graph, p4, GO);
  assert.deepEqual([blind.state.posts.length, p4.slides[0].tags[0].state, p4.slides[0].tags[0].reason], [1, "TAG_REVIEW_REQUIRED", "readback_failed"]);
});

test("write-time post limit counts live tags on every slide; slide changed during retry stops", async () => {
  const many = (n, p) => Array.from({ length: n }, (_, i) => ({ product_id: `${p}${i}`, x: 0.1, y: 0.1, review_status: "approved" }));
  const full = fakeGraph({ products: PRODUCTS, tags: { c1: many(4, "A"), c2: many(4, "B") } });
  const p1 = await plan(full.graph, [[1, [tag(101, 0.5, 0.5)]], [2, [tag(102, 0.5, 0.5)]]]);
  full.state.tags.c2.push(...many(1, "C")); // someone tags in the app between plan and write
  const extra = Array.from({ length: 11 }, (_, i) => ({ product_id: `Z${i}` }));
  const get = full.graph.get;
  full.graph.get = async (path, params) => path === "c2/product_tags" && params === undefined && full.state.inflate ? { data: [...full.state.tags.c2, ...extra] } : get(path, params);
  full.state.inflate = true;
  assert.equal((await applyTagPlan(full.graph, p1, GO)).reason, "post_tag_limit");
  assert.equal(full.state.posts.length, 0);

  const racing = fakeGraph({ products: PRODUCTS, postFailures: [{ error: new GraphError(503, {}) }] });
  const p2 = await plan(racing.graph, [[1, [tag(101, 0.5, 0.5)]]]);
  const post = racing.graph.post;
  racing.graph.post = async (...a) => { racing.state.tags.c1.push({ product_id: "OTHER", x: 0.3, y: 0.3, review_status: "approved" }); return post(...a); };
  await applyTagPlan(racing.graph, p2, GO);
  assert.deepEqual([racing.state.posts.length, p2.slides[0].tags[0].reason], [1, "slide_changed_or_full"]);
});

test("approval rule: IG search group approved, id in group variants, Meta and Cafe24 stock, exact id required", async () => {
  const products = { 201: [row("S1", "201.M"), row("S2", "201.L"), row("S3", "201.XL", "out of stock"), row("S4", "201.XS"), row("S5", "201.XXL")] };
  const search = { 201: group(201, "S1", "approved", ["S1", "S2", "S3", "S4"]) };
  const c24 = async () => view(201, [variant("M", 1), variant("L", 0), variant("XL", 2), variant("XXL", 2)]);
  const { graph } = fakeGraph({ products, search });
  const t = (id, x) => tag(201, x, x, { metaProductId: id });
  const p = await plan(graph, [[1, [tag(201, 0.1, 0.1, { metaProductId: null }), t("S1", 0.2), t("S2", 0.3), t("S3", 0.4), t("S4", 0.5)]], [2, [t("S5", 0.6)]]], { getCafe24Product: c24 });
  assert.deepEqual(states(p), ["1:201:TAG_REVIEW_REQUIRED:meta_product_id_required", "1:201:PENDING", "1:201:TAG_REVIEW_REQUIRED:cafe24_option_out_of_stock",
    "1:201:TAG_REVIEW_REQUIRED:meta_out_of_stock", "1:201:TAG_REVIEW_REQUIRED:cafe24_option_not_found", "2:201:TAG_REVIEW_REQUIRED:not_in_ig_search"]);
  assert.deepEqual(p.slides[0].tags[1].approval, { group: "approved", variant: "UNVERIFIED" });
});

test("variant approval stays UNVERIFIED until the read-back shows the tag approved", async () => {
  const { graph, state } = fakeGraph({ products: PRODUCTS });
  const p = await plan(graph, [[1, [tag(101, 0.5, 0.5)]]]);
  await applyTagPlan(graph, p, GO);
  state.tags.c1[0].review_status = "pending";
  let v = await verifyTagPlan(graph, structuredClone(p));
  assert.deepEqual([v.state, v.slides[0].tags[0].reason, v.slides[0].tags[0].approval.variant], ["TAG_REVIEW_REQUIRED", "readback_mismatch", "UNVERIFIED"]);
  state.tags.c1[0].review_status = "approved";
  v = await verifyTagPlan(graph, p);
  assert.deepEqual([v.state, v.slides[0].tags[0].approval], ["TAG_VERIFIED", { group: "approved", variant: "APPROVED_IN_READBACK" }]);
});

test("product-tags.json: validated against manifest, statuses written back in place", async () => {
  const m = { ...mapping([[1, [tag(101, 0.5, 0.5)]]]), folderName: "TEST-26AW" };
  const man = { ...manifest, folderName: "TEST-26AW" };
  assert.deepEqual(validateMapping(m, man), []);
  assert.deepEqual(validateMapping({ ...m, folderName: "OTHER" }, man), ["folder_mismatch"]);
  assert.deepEqual(validateMapping({ ...m, slides: [...m.slides, m.slides[0]] }, man), ["duplicate_slide_order"]);
  assert.deepEqual(validateMapping(mapping([[1, [tag("101", 0.5, 0.5)]]]), manifest), ["bad_product_no:1"]);
  const bad = await buildTagPlan({ graph: fakeGraph({ products: PRODUCTS }).graph, mapping: { ...m, schemaVersion: 2 }, manifest: man, mediaId: "m1", getCafe24Product: cafe24 });
  assert.equal(bad.reason, "mapping:schema_version");

  const { graph } = fakeGraph({ products: PRODUCTS });
  const two = { ...mapping([[1, [tag(101, 0.5, 0.5), tag(103, 0.2, 0.2)]], [2, [{ ...tag(102, 0.5, 0.5), savedAsset: "x" }]]]), post: { mediaId: null } };
  two.slides[1].savedAsset = "wrong.jpg";
  const p = await buildTagPlan({ graph, mapping: two, manifest, mediaId: "m1", getCafe24Product: cafe24 });
  const out = withTagStatus(two, p);
  assert.equal(out.post.mediaId, "m1");
  assert.deepEqual(out.slides.flatMap((s) => s.tags.map((t) => [t.productNo, t.metaProductId, t.status, t.reason])), [
    [101, "P101", "PENDING", null], [103, "P103", "TAG_REVIEW_REQUIRED", "group_review_status:rejected"], [102, "P102", "PENDING", null]]);
  assert.equal(p.state, "TAG_REVIEW_REQUIRED", "asset mismatch on slide 2 holds the whole post");
});

test("real-response shape is enforced: catalog id, child ids, product ids, numeric x/y", async () => {
  const g = fakeGraph({ products: PRODUCTS }).graph;
  const wrongCatalog = { ...g, get: async (path, params) => path === CATALOG ? { id: "1", business: { id: SAMPLAS_META.businessId } } : g.get(path, params) };
  assert.deepEqual((await preflight(wrongCatalog)).problems, ["catalog_mismatch"]);
  const noChildId = { ...g, get: async (path, params) => path === "m1/children" ? { data: [{ media_type: "IMAGE" }, { id: "c2", media_type: "IMAGE" }] } : g.get(path, params) };
  assert.equal((await plan(noChildId, [[1, [tag(101, 0.5, 0.5)]]])).reason, "child_without_id");
  const nameless = fakeGraph({ products: { 101: [{ id: "P101", retailer_id: "101.BK", review_status: "", availability: "in stock" }] } }).graph;
  assert.deepEqual(states(await plan(nameless, [[1, [tag(101, 0.5, 0.5)]]])), ["1:101:TAG_REVIEW_REQUIRED:meta_product_id_not_in_group"]);
  const odd = fakeGraph({ products: PRODUCTS, tags: { c1: [{ x: 0.1, y: 0.1, review_status: "approved" }] } }).graph;
  assert.equal((await plan(odd, [[1, [tag(101, 0.5, 0.5)]]])).state, "TAG_REVIEW_REQUIRED");

  const { graph, state } = fakeGraph({ products: PRODUCTS });
  const p = await plan(graph, [[1, [tag(101, 0.5, 0.5)]]]);
  await applyTagPlan(graph, p, GO);
  state.tags.c1[0].x = "0.5";
  const v = await verifyTagPlan(graph, p);
  assert.deepEqual([v.state, v.slides[0].tags[0].reason], ["TAG_REVIEW_REQUIRED", "readback_mismatch"]);
});

test("wrong-typed list fields block instead of throwing", async () => {
  const weird = (over) => fakeGraph({ products: PRODUCTS, ...over }).graph;
  const g1 = weird({});
  const odd = { ...g1, get: async (path, params) => path.endsWith("/catalog_product_search") ? { data: { 0: SEARCH[101] } } : g1.get(path, params) };
  assert.deepEqual(states(await plan(odd, [[1, [tag(101, 0.5, 0.5)]]])), ["1:101:TAG_REVIEW_REQUIRED:not_in_ig_search"]);
  const noVariants = weird({ search: { 101: { ...SEARCH[101], product_id: "OTHER", product_variants: "P101" } } });
  assert.deepEqual(states(await plan(noVariants, [[1, [tag(101, 0.5, 0.5)]]])), ["1:101:TAG_REVIEW_REQUIRED:not_in_ig_search"]);
  const p = await plan(weird({}), [[1, [tag(101, 0.5, 0.5)]]], { getCafe24Product: async () => view(101, [], { options: { BK: 1 } }) });
  assert.deepEqual(states(p), ["1:101:TAG_REVIEW_REQUIRED:cafe24_option_not_found"]);
});

test("Cafe24 option view: 15195 live shape, display_soldout is a setting, only code/state/sellability leave the server", () => {
  // Shape of the live 15195 read (2026-10-28): use_inventory T and display_soldout T on all four options,
  // stock only on L. Quantities here are placeholders; the real ones were never printed.
  const detail = { product_no: 15195, product_name: "x", selling: "T", display: "T", sold_out: "F" };
  const live = [variant("P0000WML000A", 0), variant("P0000WML000B", 0), variant("P0000WML000C", 2), variant("P0000WML000D", 0)];
  const v = toTagCafe24View(detail, live, "2026-10-28T09:00:00.000Z");
  assert.deepEqual(v, { productNo: 15195, selling: "T", display: "T", fetchedAt: "2026-10-28T09:00:00.000Z", options: [
    { variantCode: "P0000WML000A", state: "SOLD_OUT", available: false }, { variantCode: "P0000WML000B", state: "SOLD_OUT", available: false },
    { variantCode: "P0000WML000C", state: "IN_STOCK", available: true }, { variantCode: "P0000WML000D", state: "SOLD_OUT", available: false }] });
  assert.equal(JSON.stringify(v).includes("quantity"), false);
  const odd = [variant("U", 0, { use_inventory: "F" }), variant("Z", 0, { display_soldout: "F" }), { variant_code: "N", selling: "T", display: "T" },
    variant("Q", null), variant("H", 5, {}, { display: "F" }), variant("", 9), variant("S", "3")];
  const states = toTagCafe24View(detail, odd, "t").options;
  assert.deepEqual(states.map((o) => [o.variantCode, o.state, o.available]), [["U", "UNLIMITED", true], ["Z", "UNKNOWN", false], ["N", "UNKNOWN", false], ["Q", "UNKNOWN", false], ["H", "NOT_SELLING", false], ["S", "IN_STOCK", true]]);
  // Same verdict as the VEIL sold-out audit for every option.
  for (const raw of [...live, ...odd].filter((x) => x.variant_code)) assert.equal(toTagCafe24View(detail, [raw], "t").options[0].state, evaluateOption(raw).state);
  // Except non-numeric quantities, which evaluateOption counts as stock (Number(true) is 1).
  for (const q of [true, [1], "1x"]) assert.deepEqual(toTagCafe24View(detail, [variant("W", q)], "t").options[0], { variantCode: "W", state: "UNKNOWN", available: false });
  assert.deepEqual(toTagCafe24View({}, undefined, "t"), { productNo: null, selling: "F", display: "F", fetchedAt: "t", options: [] });
});

test("Cafe24 data must be this product's, fresh, and name exactly one sellable option", async () => {
  const { graph } = fakeGraph({ products: PRODUCTS });
  const one = (getCafe24Product, over = {}) => plan(graph, [[1, [tag(101, 0.5, 0.5)]]], { getCafe24Product, ...over });
  const old = new Date(Date.now() - CAFE24_MAX_AGE_MS - 1000).toISOString();
  const bk = (quantity = 1, inv, over) => variant("BK", quantity, inv, over);
  assert.deepEqual(states(await one(async () => view(102, [bk()]))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_product_mismatch"]);
  assert.deepEqual(states(await one(async () => view(101, [bk()], { fetchedAt: old }))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_stale"]);
  assert.deepEqual(states(await one(async () => view(101, [bk()], { fetchedAt: "not a date" }))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_stale"]);
  assert.deepEqual(states(await one(async () => view(101, [bk()], { fetchedAt: new Date(Date.now() + 60000).toISOString() }))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_stale"]);
  assert.deepEqual(states(await one(async () => view(101, [bk(), bk()]))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_option_ambiguous"]);
  assert.deepEqual(states(await one(async () => view(101, [bk(0)]))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_option_out_of_stock"]);
  assert.deepEqual(states(await one(async () => view(101, [bk(1, {}, { selling: "F" })]))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_option_out_of_stock"]);
  assert.deepEqual(states(await one(async () => view(101, [bk(1, { use_inventory: undefined })]))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_option_uncertain"]);
  assert.deepEqual(states(await one(async () => view(101, [bk(0, { display_soldout: "F" })]))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_option_uncertain"]);
  assert.deepEqual(states(await one(async () => view(101, [bk(0, { use_inventory: "F" })]))), ["1:101:PENDING"]);
  assert.deepEqual(states(await one(async () => view(101, [variant("S", 4)]))), ["1:101:TAG_REVIEW_REQUIRED:cafe24_option_not_found"]);
  assert.deepEqual(states(await one(async () => null)), ["1:101:TAG_REVIEW_REQUIRED:cafe24_not_found"]);
  assert.deepEqual(states(await one(async () => view(101, [bk()]))), ["1:101:PENDING"]);
});

test("server route: GET only, internal auth, raw detail + variants, existing Cafe24 routes untouched", async () => {
  const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const start = src.indexOf('if (url.pathname.startsWith("/api/instagram-product-tags/cafe24/"))');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('if (url.pathname === "/api/cafe24/brands")', start));
  assert.match(block, /if \(!isAuthorizedInternalRequest\(req\)\) return json\(res, \{ error: "Unauthorized" \}, 401\);/);
  assert.match(block, /req\.method !== "GET"/);
  assert.match(block, /return json\(res, await fetchTagCafe24View\(productNo\)\);/);
  const fn = src.slice(src.indexOf("async function fetchTagCafe24View("), src.indexOf("async function fetchCafe24ProductDiscountPrice("));
  assert.match(fn, /Promise\.all\(\[fetchCafe24ProductDetail\(Number\(productNo\)\), fetchCafe24ProductVariantsWithInventory\(Number\(productNo\)\)\]\)/);
  assert.match(fn, /return toTagCafe24View\(detail, variants\);/);
  assert.equal(fn.includes("fetchCafe24ProductCatalogRow("), false);
  assert.match(fn, /if \(env\.CAFE24_PROXY_BASE_URL\)[\s\S]*\/api\/instagram-product-tags\/cafe24\/\$\{encodeURIComponent\(productNo\)\}`, \{ headers: cafe24ProxyHeaders\(\) \}/, "proxy mode asks the Render route, not Cafe24 directly");
  assert.match(fn, /Number\(body\.productNo\) === Number\(productNo\) && Array\.isArray\(body\.options\)\) return body;\s*throw Object\.assign\([^\n]*\{ status: 502 \}\);/, "only a tag view for this product passes; anything else is 502");
  assert.match(src, /soldOut: String\(inv\.display_soldout \?\? variant\.sold_out \?\? "F"\)\.toUpperCase\(\) === "T"/, "shared normalizeCafe24ProductRow unchanged");
  assert.match(block, /\^\\d\+\$/);
  assert.equal(src.includes('return json(res, { product });'), true, "/api/cafe24/products/<no> response unchanged");
  process.env.CAFE24_PROXY_BASIC_AUTH ??= "FAKE_TEST:FAKE_TEST";
  const { isApiRequestAllowed } = await import("../server.mjs");
  assert.equal(isApiRequestAllowed({ headers: {}, socket: { remoteAddress: "10.0.0.5" } }, "/api/instagram-product-tags/cafe24/15195", { readAuth: undefined }), false, "not public");
});
