// Instagram shopping product tags for published @samplaskr feed posts (Graph API, no browser).
// The token comes from the caller: server.mjs passes resolveMetaAccessToken, so the existing
// Production Meta connection is reused as is (no new OAuth, no separate token store).
//
// Flow per post: preflight -> resolveMedia (carousel children in manifest order) -> buildTagPlan
// (mapping from READY/<brand>/product-tags.json, catalog + Cafe24 checks, existing tags) ->
// applyTagPlan (POST, off unless explicitly enabled) -> verifyTagPlan (GET read-back).
// Publish state (QUEUED/SCHEDULED/PUBLISHED) is kept elsewhere; this module only owns the tag state.
//
// Meta rules used here (developers.facebook.com, product_tags reference, v26.0):
//   - POST /{ig-media-id}/product_tags is additive; an existing product_id only gets new x/y.
//     There is no delete, so a wrong tag cannot be removed through the API.
//   - x, y are 0..1 from the top-left of the image; only approved products show on the post.
//   - Carousel slides take up to 5 tags each and 20 per post.
import { parseMetaContentId } from "./meta-product-registry-link.mjs";
import { evaluateOption } from "./veil-found-soldout-audit.mjs";

export const TAG_STATES = ["PENDING", "PRODUCT_TAGGING", "TAG_VERIFIED", "TAG_REVIEW_REQUIRED", "POST_OUTCOME_UNKNOWN"];
export const MAX_TAGS_PER_SLIDE = 5;
export const MAX_TAGS_PER_POST = 20;
export const REQUIRED_PERMISSIONS = ["instagram_basic", "instagram_shopping_tag_products", "catalog_management"];
const COORD_TOLERANCE = 0.01;
// Transient Graph error classification; tag POSTs are never retried.
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export class GraphError extends Error {
  constructor(status, body) {
    const e = body?.error || {};
    super(e.message || `Graph HTTP ${status}`);
    Object.assign(this, { status, code: e.code ?? null, subcode: e.error_subcode ?? null });
  }
  get retryable() { return this.status === 0 || this.status >= 500 || RETRYABLE_CODES.has(this.code); }
}

// getToken: async () => token (server: resolveMetaAccessToken). The token never leaves this closure.
export function createGraphClient({ getToken, version = "v25.0", fetchImpl = fetch }) {
  const call = async (method, path, params = {}) => {
    const token = await getToken();
    if (!token) throw new GraphError(401, { error: { message: "Meta access token is missing" } });
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) (method === "GET" ? url.searchParams : body).set(k, typeof v === "string" ? v : JSON.stringify(v));
    (method === "GET" ? url.searchParams : body).set("access_token", token);
    let response;
    try {
      response = await fetchImpl(url, method === "GET" ? { method } : { method, body });
    } catch {
      throw new GraphError(0, { error: { message: "Graph request failed (network)" } });
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.error) throw new GraphError(response.status, json);
    return json;
  };
  return { get: (path, params) => call("GET", path, params), post: (path, params) => call("POST", path, params) };
}

// The only account this module may tag for. A different app, IG user, business or catalog means
// the token or ids point somewhere else, so everything stops before any tag request.
export const SAMPLAS_META = {
  appId: "1532479555032402", igUserId: "17841400194524814", username: "samplaskr",
  businessId: "459892487785528", catalogId: "593883097881439"
};

export async function preflight(graph, expected = SAMPLAS_META) {
  const problems = [];
  const app = await graph.get("app", { fields: "id" });
  if (String(app.id) !== expected.appId) problems.push("app_mismatch");
  const granted = new Set(((await graph.get("me/permissions")).data || []).filter((p) => p.status === "granted").map((p) => p.permission));
  for (const p of REQUIRED_PERMISSIONS) if (!granted.has(p)) problems.push(`permission_missing:${p}`);
  const ig = await graph.get(expected.igUserId, { fields: "id,username,shopping_product_tag_eligibility" });
  if (String(ig.id) !== expected.igUserId || ig.username !== expected.username) problems.push("ig_account_mismatch");
  if (ig.shopping_product_tag_eligibility !== true) problems.push("not_eligible");
  const catalog = await graph.get(expected.catalogId, { fields: "id,business" });
  if (String(catalog.id) !== expected.catalogId) problems.push("catalog_mismatch");
  if (String(catalog.business?.id) !== expected.businessId) problems.push("business_mismatch");
  const catalogs = (await graph.get(`${expected.igUserId}/available_catalogs`)).data || [];
  if (!catalogs.some((c) => String(c.catalog_id) === expected.catalogId)) problems.push("catalog_not_available");
  return { ok: problems.length === 0, problems };
}

// Slides in manifest order -> image media ids. A carousel must have exactly as many children as the
// manifest has items, in the same order; a single image post must have one item.
export async function resolveMedia(graph, mediaId, manifest, expected = SAMPLAS_META) {
  const items = [...(manifest?.items || [])].sort((a, b) => a.order - b.order);
  const media = await graph.get(mediaId, { fields: "id,media_type,permalink,username,owner" });
  if (String(media.owner?.id) !== expected.igUserId || media.username !== expected.username) return { ok: false, reason: "media_owner_mismatch", media };
  const children = media.media_type === "CAROUSEL_ALBUM"
    ? ((await graph.get(`${mediaId}/children`, { fields: "id,media_type" })).data || [])
    : [{ id: media.id, media_type: media.media_type }];
  if (children.some((c) => !c.id)) return { ok: false, reason: "child_without_id", media };
  if (children.length !== items.length) return { ok: false, reason: `slide_count_mismatch:${children.length}!=${items.length}`, media };
  if (children.some((c) => c.media_type !== "IMAGE")) return { ok: false, reason: "non_image_slide", media };
  return { ok: true, media, slides: items.map((item, i) => ({ order: item.order, savedAsset: item.savedAsset, mediaId: children[i].id })) };
}

// Wrong-typed list fields count as empty, so they block instead of throwing.
const list = (v) => (Array.isArray(v) ? v : []);

// Cafe24 data older than this is not used for a tag decision.
export const CAFE24_MAX_AGE_MS = 10 * 60 * 1000;

// What tagging needs from the raw Cafe24 product detail and variants (embed=inventories): per option only
// the variant code, its state and whether it can be sold now. Raw quantities stay on the server.
// The option state is evaluateOption() of the VEIL sold-out audit. display_soldout there is a shop setting
// (show "sold out" when stock hits 0), not the current state; normalizeCafe24ProductRow reads it as sold
// out, which marked in-stock options unavailable (15195 L, 2026-10-28), so that row is not used here.
// IN_STOCK (use_inventory T, quantity > 0) and UNLIMITED (use_inventory F) can be sold. SOLD_OUT and
// NOT_SELLING cannot, and UNKNOWN (missing inventory data) goes to review.
export function toTagCafe24View(detail, variants, fetchedAt = new Date().toISOString()) {
  return {
    productNo: Number(detail?.product_no) || null,
    selling: detail?.selling === "T" ? "T" : "F",
    display: detail?.display === "T" ? "T" : "F",
    fetchedAt,
    options: list(variants).filter((v) => v?.variant_code).map((v) => {
      let { state } = evaluateOption(v);
      // evaluateOption runs Number() on the quantity, so true or [] would count as stock. Tagging only trusts a numeric value.
      const raw = v.inventories ?? v.inventory;
      const q = (Array.isArray(raw) ? raw[0] : raw)?.quantity;
      if (state === "IN_STOCK" && !(typeof q === "number" || (typeof q === "string" && /^\d+$/.test(q.trim())))) state = "UNKNOWN";
      return { variantCode: String(v.variant_code), state, available: state === "IN_STOCK" || state === "UNLIMITED" };
    })
  };
}

// Tag candidate for one mapping entry. All must hold (decided 2026-10-28 on real data):
//  1. IG catalog_product_search lists the product group with review_status "approved". The catalog
//     API's own review_status was "" on every live item, so it is not used.
//  2. metaProductId (required, never guessed) is that group's product_id or one of its product_variants.
//  3. The catalog item exists in the group: retailer_id "<product_no>.<variant code>" parses back to productNo.
//  4. Stock: catalog availability "in stock", and exactly one Cafe24 option has the same variant code
//     and is available (IN_STOCK or UNLIMITED, see toTagCafe24View). Cafe24 data must be this product's and fresh.
// Approval is known per group only. Per-variant approval is not exposed by the API, so it is recorded
// as UNVERIFIED and only the read-back after tagging (product_tags review_status) confirms it.
// cafe24: toTagCafe24View() output { productNo, selling, display, fetchedAt, options: [{ variantCode, available }] }.
export async function checkTagCandidate(graph, { catalogId, igUserId, productNo, metaProductId, cafe24, now = Date.now() }) {
  if (!metaProductId) return { ok: false, reason: "meta_product_id_required" };
  const id = String(metaProductId);
  if (!cafe24) return { ok: false, reason: "cafe24_not_found" };
  if (Number(cafe24.productNo) !== Number(productNo)) return { ok: false, reason: "cafe24_product_mismatch" };
  const age = now - Date.parse(cafe24.fetchedAt);
  if (!(age >= 0 && age <= CAFE24_MAX_AGE_MS)) return { ok: false, reason: "cafe24_stale" };
  if (cafe24.selling !== "T" || cafe24.display !== "T") return { ok: false, reason: "cafe24_not_selling_or_hidden" };
  const rows = list((await graph.get(`${catalogId}/products`, {
    fields: "id,retailer_id,name,availability",
    filter: { retailer_product_group_id: { eq: String(productNo) } }, limit: "50"
  })).data);
  const item = rows.find((r) => String(r.id) === id && r.name && parseMetaContentId(r.retailer_id).cafe24ProductNo === Number(productNo));
  if (!item) return { ok: false, reason: "meta_product_id_not_in_group" };
  const found = list((await graph.get(`${igUserId}/catalog_product_search`, { catalog_id: catalogId, q: String(productNo) })).data)
    .filter((g) => parseMetaContentId(g.retailer_id).cafe24ProductNo === Number(productNo))
    .filter((g) => String(g.product_id) === id || list(g.product_variants).some((v) => String(v.product_id) === id));
  if (found.length !== 1) return { ok: false, reason: found.length ? "ambiguous_search_group" : "not_in_ig_search" };
  if (found[0].review_status !== "approved") return { ok: false, reason: `group_review_status:${found[0].review_status || "none"}` };
  if (item.availability !== "in stock") return { ok: false, reason: "meta_out_of_stock" };
  const variantCode = parseMetaContentId(item.retailer_id).variantCode;
  const options = list(cafe24.options).filter((o) => o?.variantCode === variantCode);
  if (!options.length) return { ok: false, reason: "cafe24_option_not_found" };
  if (options.length > 1) return { ok: false, reason: "cafe24_option_ambiguous" };
  if (options[0].available !== true) return { ok: false, reason: options[0].state === "UNKNOWN" ? "cafe24_option_uncertain" : "cafe24_option_out_of_stock" };
  return { ok: true, product: { id, retailerId: item.retailer_id, name: item.name, variantCode, approval: { group: "approved", variant: "UNVERIFIED" } } };
}

// A tag as Graph returns it: a product id and numeric coordinates. Anything else is treated as unknown.
const isReadableTag = (t) => Boolean(t?.product_id) && typeof t.x === "number" && typeof t.y === "number";
const validCoord = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

// READY/<brand>/product-tags.json, next to manifest.json (one slide entry per manifest item that has tags):
// { "schemaVersion": 1, "folderName": "TAEGLOBAL-26AW",
//   "post": { "mediaId": null, "permalink": null },
//   "slides": [{ "order": 1, "savedAsset": "assets/01.jpg",
//     "tags": [{ "productNo": 12345, "metaProductId": null, "name": "...", "color": "BLACK", "x": 0.5, "y": 0.6,
//       "evidence": "how the product was matched", "approved": true, "status": "PENDING" }] }] }
// order + savedAsset must match manifest.json. approved is set by a person; status is written back
// by withTagStatus(). Anything unclear ends as TAG_REVIEW_REQUIRED and the whole post waits.
export function validateMapping(mapping, manifest) {
  const problems = [];
  if (mapping?.schemaVersion !== 1) problems.push("schema_version");
  if (manifest?.folderName && mapping?.folderName !== manifest.folderName) problems.push("folder_mismatch");
  const orders = (mapping?.slides || []).map((s) => s.order);
  if (new Set(orders).size !== orders.length) problems.push("duplicate_slide_order");
  for (const slide of mapping?.slides || []) for (const tag of slide.tags || []) if (!Number.isInteger(tag.productNo) || tag.productNo <= 0) problems.push(`bad_product_no:${slide.order}`);
  return problems;
}

// getCafe24Product(productNo) -> toTagCafe24View() output or null.
// now: optional fixed clock for tests; by default the time of each check (after the Cafe24 read).
export async function buildTagPlan({ graph, mapping, manifest, mediaId, getCafe24Product, expected = SAMPLAS_META, now }) {
  const { catalogId, igUserId } = expected;
  const review = (reason, extra = {}) => ({ state: "TAG_REVIEW_REQUIRED", reason, ...extra });
  const problems = validateMapping(mapping, manifest);
  if (problems.length) return { state: "TAG_REVIEW_REQUIRED", reason: `mapping:${problems.join(",")}`, slides: [] };
  const check = await preflight(graph, expected);
  if (!check.ok) return { state: "TAG_REVIEW_REQUIRED", reason: `preflight:${check.problems.join(",")}`, slides: [] };
  const media = await resolveMedia(graph, mediaId, manifest, expected);
  if (!media.ok) return { state: "TAG_REVIEW_REQUIRED", reason: media.reason, slides: [] };
  const byOrder = new Map((mapping?.slides || []).map((s) => [s.order, s]));
  const slides = [];
  let total = 0;
  for (const slide of media.slides) {
    const mapped = byOrder.get(slide.order);
    const existing = (await graph.get(`${slide.mediaId}/product_tags`)).data || [];
    const existingIds = new Set(existing.map((t) => String(t.product_id)));
    const out = { ...slide, existing, tags: [] };
    if (!existing.every(isReadableTag)) out.tags.push(review("unreadable_existing_tags"));
    if (mapped && mapped.savedAsset !== slide.savedAsset) out.tags.push(review("asset_mismatch"));
    const seen = new Set();
    for (const tag of mapped?.tags || []) {
      const base = { productNo: tag.productNo, x: tag.x, y: tag.y };
      if (tag.approved !== true) { out.tags.push({ ...base, ...review("not_approved_by_operator") }); continue; }
      if (!validCoord(tag.x) || !validCoord(tag.y)) { out.tags.push({ ...base, ...review("invalid_coordinates") }); continue; }
      if (!tag.metaProductId) { out.tags.push({ ...base, ...review("meta_product_id_required") }); continue; }
      const id = String(tag.metaProductId);
      if (seen.has(id)) { out.tags.push({ ...base, ...review("duplicate_in_mapping") }); continue; }
      seen.add(id);
      // Re-run safety: a product already on the slide is never sent again (its position is left as is).
      // It counts as verified only when Graph shows it approved at the mapped position.
      if (existingIds.has(id)) {
        const got = existing.find((t) => String(t.product_id) === id);
        const ok = isReadableTag(got) && got.review_status === "approved" && Math.abs(got.x - tag.x) <= COORD_TOLERANCE && Math.abs(got.y - tag.y) <= COORD_TOLERANCE;
        out.tags.push({ ...base, productId: id, ...(ok ? { state: "TAG_VERIFIED", reason: "already_tagged", approval: { group: "approved", variant: "APPROVED_IN_READBACK" } } : review(got?.review_status === "approved" ? "existing_tag_position_differs" : "existing_tag_not_approved")) });
        continue;
      }
      const product = await checkTagCandidate(graph, { catalogId, igUserId, productNo: tag.productNo, metaProductId: id, cafe24: await getCafe24Product(tag.productNo), now: now ?? Date.now() });
      if (!product.ok) { out.tags.push({ ...base, productId: id, ...review(product.reason) }); continue; }
      out.tags.push({ ...base, productId: id, name: product.product.name, approval: product.product.approval, state: "PENDING" });
    }
    const pending = out.tags.filter((t) => t.state === "PENDING");
    if (existing.length + pending.length > MAX_TAGS_PER_SLIDE) for (const t of pending) Object.assign(t, review("slide_tag_limit"));
    total += existing.length + out.tags.filter((t) => t.state === "PENDING").length;
    slides.push(out);
  }
  if (total > MAX_TAGS_PER_POST) for (const s of slides) for (const t of s.tags) if (t.state === "PENDING") Object.assign(t, review("post_tag_limit"));
  for (const [order] of byOrder) if (!media.slides.some((s) => s.order === order)) slides.push({ order, tags: [review("slide_not_in_post")] });
  return { state: planState(slides), mediaId, slides };
}

// product-tags.json with each tag's status (and resolved Meta id) from a plan or a verified result.
// Tags keep their place: slide order, then position in the slide's tag list.
export function withTagStatus(mapping, plan) {
  const bySlide = new Map((plan.slides || []).map((s) => [s.order, s]));
  return {
    ...mapping,
    post: { ...mapping.post, mediaId: plan.mediaId ?? mapping.post?.mediaId ?? null },
    slides: mapping.slides.map((slide) => {
      const planned = (bySlide.get(slide.order)?.tags || []).filter((t) => t.productNo !== undefined);
      return { ...slide, tags: slide.tags.map((tag, i) => {
        const t = planned[i];
        return t ? { ...tag, metaProductId: t.productId ?? tag.metaProductId ?? null, status: t.state, reason: t.reason ?? null, approval: t.approval ?? null } : { ...tag, status: "TAG_REVIEW_REQUIRED", reason: "not_planned" };
      }) };
    })
  };
}

function planState(slides) {
  const tags = slides.flatMap((s) => s.tags);
  if (tags.some((t) => t.state === "POST_OUTCOME_UNKNOWN")) return "POST_OUTCOME_UNKNOWN";
  if (tags.some((t) => t.state === "TAG_REVIEW_REQUIRED")) return "TAG_REVIEW_REQUIRED";
  if (tags.some((t) => t.state === "PENDING")) return "PENDING";
  return "TAG_VERIFIED";
}

// Off unless the caller passes write: true and acceptUnverifiedVariantApproval: true, and the server
// env says INSTAGRAM_PRODUCT_TAG_WRITES=on.
// The plan is not trusted as is: right before writing, the account checks run again, the media must
// still belong to @samplaskr with the slide as its child, and the slide's current tags are read.
// Only product ids absent right now are sent, so an existing tag is never re-sent (which would move it).
// If the slide changed since planning, or a limit or duplicate shows up, the slide goes to review.
// After a POST error the slide is read back; ids already present count as applied, only the absent
// ones are held. No POST is retried, even for temporary errors or a failed read-back.
// beforePost persists the runner's hold before a request can leave the process.
export async function applyTagPlan(graph, plan, { write = false, env = process.env, acceptUnverifiedVariantApproval = false, beforePost = async () => {}, expected = SAMPLAS_META } = {}) {
  if (write !== true || env.INSTAGRAM_PRODUCT_TAG_WRITES !== "on") return { applied: false, reason: "writes_disabled", plan };
  // Per-variant approval is never known before tagging; a person must accept that for each run.
  if (acceptUnverifiedVariantApproval !== true) return { applied: false, reason: "variant_approval_unverified", plan };
  if (plan.state !== "PENDING") return { applied: false, reason: `plan_state:${plan.state}`, plan };
  const check = await preflight(graph, expected);
  if (!check.ok) return { applied: false, reason: `preflight:${check.problems.join(",")}`, plan };
  const media = await graph.get(plan.mediaId, { fields: "id,media_type,username,owner" });
  if (String(media.owner?.id) !== expected.igUserId || media.username !== expected.username) return { applied: false, reason: "media_owner_mismatch", plan };
  const childIds = new Set(media.media_type === "CAROUSEL_ALBUM"
    ? ((await graph.get(`${plan.mediaId}/children`, { fields: "id" })).data || []).map((c) => String(c.id))
    : [String(media.id)]);
  const currentIds = async (slide) => new Set(((await graph.get(`${slide.mediaId}/product_tags`)).data || []).map((t) => String(t.product_id)));
  const review = (tags, reason, state = "TAG_REVIEW_REQUIRED") => { for (const t of tags) Object.assign(t, { state, reason }); };
  // Post-wide limit on the live state: every child's current tags plus everything still to send.
  let postTotal = 0;
  for (const id of childIds) postTotal += ((await graph.get(`${id}/product_tags`)).data || []).length;
  const toSend = plan.slides.flatMap((s) => s.tags.filter((t) => t.state === "PENDING"));
  if (postTotal + toSend.length > MAX_TAGS_PER_POST) { review(toSend, "post_tag_limit"); return { applied: false, reason: "post_tag_limit", plan }; }
  let attempted = false;
  for (const slide of plan.slides) {
    const pending = slide.tags.filter((t) => t.state === "PENDING");
    if (!pending.length) continue;
    if (!childIds.has(String(slide.mediaId))) { review(pending, "slide_not_in_media"); continue; }
    const ids = pending.map((t) => t.productId);
    if (new Set(ids).size !== ids.length || pending.some((t) => !validCoord(t.x) || !validCoord(t.y))) { review(pending, "invalid_plan"); continue; }
    let present;
    try { present = await currentIds(slide); } catch { review(pending, "readback_failed"); continue; }
    const planned = new Set((slide.existing || []).map((t) => String(t.product_id)));
    if (present.size !== planned.size || [...planned].some((id) => !present.has(id)) || present.size + pending.length > MAX_TAGS_PER_SLIDE) { review(pending, "slide_changed_or_full"); continue; }
    // ponytail: Graph has no conditional write, so a tag added by someone else between this GET and the
    // POST (milliseconds) would be moved to our x/y. Not closable via the API; tag posts from one runner only.
    for (const t of pending) t.state = "PRODUCT_TAGGING";
    await beforePost(plan);
    attempted = true;
    try {
      await graph.post(`${slide.mediaId}/product_tags`, { updated_tags: pending.map((t) => ({ product_id: t.productId, x: t.x, y: t.y })) });
    } catch (error) {
      try { present = await currentIds(slide); } catch { review(pending, "readback_failed", "POST_OUTCOME_UNKNOWN"); continue; }
      const allowed = new Set([...planned, ...ids]);
      const changed = [...planned].some((id) => !present.has(id)) || [...present].some((id) => !allowed.has(id));
      review(pending.filter((t) => !present.has(t.productId)), changed ? "slide_changed_or_full" : `post_failed:${error.code ?? error.status ?? "unknown"}`, "POST_OUTCOME_UNKNOWN");
    }
  }
  return { applied: attempted, plan };
}

// Read-back: every planned tag present with the planned position and approved, and every tag that was
// there before is still there. Unconfirmed attempted tags stay POST_OUTCOME_UNKNOWN.
export async function verifyTagPlan(graph, plan) {
  for (const slide of plan.slides) {
    if (!slide.mediaId) continue;
    let now;
    try { now = (await graph.get(`${slide.mediaId}/product_tags`)).data || []; }
    catch {
      for (const t of slide.tags) if (["PRODUCT_TAGGING", "POST_OUTCOME_UNKNOWN"].includes(t.state)) Object.assign(t, { state: "POST_OUTCOME_UNKNOWN", reason: "readback_failed" });
      slide.unreadable = true;
      continue;
    }
    slide.unreadable = !now.every(isReadableTag);
    const byId = new Map(now.map((t) => [String(t.product_id), t]));
    const lost = (slide.existing || []).filter((t) => !byId.has(String(t.product_id)));
    slide.lostExisting = lost.map((t) => String(t.product_id));
    for (const t of slide.tags) {
      if (!["PRODUCT_TAGGING", "POST_OUTCOME_UNKNOWN"].includes(t.state)) continue;
      const got = byId.get(t.productId);
      const ok = got && isReadableTag(got) && got.review_status === "approved" && Math.abs(got.x - t.x) <= COORD_TOLERANCE && Math.abs(got.y - t.y) <= COORD_TOLERANCE;
      // A tag shown as approved after tagging is the only per-variant approval evidence there is.
      Object.assign(t, ok ? { state: "TAG_VERIFIED", reason: null, approval: { ...t.approval, variant: "APPROVED_IN_READBACK" } } : { state: "POST_OUTCOME_UNKNOWN", reason: t.reason ?? (got ? "readback_mismatch" : "readback_missing") });
    }
  }
  const tagState = planState(plan.slides);
  const state = tagState === "POST_OUTCOME_UNKNOWN" ? tagState : plan.slides.some((s) => s.lostExisting?.length || s.unreadable) ? "TAG_REVIEW_REQUIRED" : tagState;
  return { ...plan, state };
}
