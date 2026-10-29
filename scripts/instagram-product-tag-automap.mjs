// Auto-mapping: per-slide visual findings -> a product-tags.json proposal for the tag runner.
//
// Visual findings come from the opt-in Render image adapter, or an outside analyzer (a person/Claude),
// and say, per garment, where it is on the
// slide and which Cafe24 products it looks like, with a confidence and the evidence. This module only checks
// those candidates against Meta and Cafe24 data. It never approves: every tag comes out approved:false, and
// a person approves tags with approveAutoTags(). Anything unclear stays TAG_REVIEW_REQUIRED.
//
// findings: { schemaVersion: 1, folderName, brand?, analyzer: "who/what looked at the images",
//   slides: [{ order, savedAsset, items: [{ label, x, y,
//     color?: "color seen, needed when the product has several colors",
//     candidates: [{ productNo, confidence: 0..1, evidence: "what matched (print, hardware, color, cut)" }] }] }] }
// A candidate below AUTO_CANDIDATE_FLOOR is a noted alternative, not a candidate. Two candidates at or above it
// are ambiguous and go to review.
import { parseMetaContentId } from "./meta-product-registry-link.mjs";
import { SAMPLAS_META } from "./instagram-product-tags.mjs";

export const AUTO_MIN_CONFIDENCE = 0.8;
export const AUTO_CANDIDATE_FLOOR = 0.5;

const list = (v) => (Array.isArray(v) ? v : []);
const validCoord = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export function validateFindings(findings, manifest) {
  const problems = [];
  if (findings?.schemaVersion !== 1) problems.push("schema_version");
  if (findings?.folderName !== manifest?.folderName) problems.push("folder_mismatch");
  if (!findings?.analyzer) problems.push("analyzer_missing");
  const items = new Map(list(manifest?.items).map((i, n) => [n + 1, i.savedAsset]));
  const orders = list(findings?.slides).map((s) => s.order);
  if (new Set(orders).size !== orders.length) problems.push("duplicate_slide_order");
  for (const s of list(findings?.slides)) if (items.get(s.order) !== s.savedAsset) problems.push(`asset_mismatch:${s.order}`);
  return problems;
}

// One garment -> one tag proposal (or a review entry when there is no single candidate).
async function proposeTag({ graph, item, brand, getCafe24Product, catalogId }) {
  const reasons = [];
  if (!validCoord(item.x) || !validCoord(item.y)) reasons.push("invalid_coordinates");
  const ranked = list(item.candidates).filter((c) => Number.isInteger(c?.productNo) && c.productNo > 0).sort((a, b) => b.confidence - a.confidence);
  const [top, second] = ranked;
  if (!top) return { review: { label: item.label, x: item.x, y: item.y, reason: "no_catalog_match", evidence: item.evidence ?? null } };
  if (!(top.confidence >= AUTO_MIN_CONFIDENCE)) reasons.push("visual_low_confidence");
  if (second && second.confidence >= AUTO_CANDIDATE_FLOOR) reasons.push("visual_ambiguous_candidates");
  const evidence = [`visual: ${top.evidence || "none given"}`];
  const rows = list((await graph.get(`${catalogId}/products`, {
    fields: "id,retailer_id,name,availability,color",
    filter: { retailer_product_group_id: { eq: String(top.productNo) } }, limit: "50"
  })).data).filter((r) => parseMetaContentId(r.retailer_id).cafe24ProductNo === top.productNo);
  // Brand narrows the search only. It is never the evidence that picks the product. Every row of the group
  // must carry the brand as the name's leading tag ("[TAEGLOBAL : ...] ..."), not just contain the word.
  const brandTag = new RegExp(`^\\[${brand.replace(/\s/g, "").replace(/[^A-Z0-9]/g, "\\$&")}(:|\\])`);
  if (!rows.length) reasons.push("meta_product_not_found");
  else if (!rows.every((r) => brandTag.test(String(r.name || "").toUpperCase().replace(/\s/g, "")))) reasons.push("brand_mismatch");
  const cafe24 = await getCafe24Product(top.productNo);
  if (!cafe24 || Number(cafe24.productNo) !== top.productNo) reasons.push("cafe24_not_found");
  else if (cafe24.selling !== "T" || cafe24.display !== "T") reasons.push("cafe24_not_selling_or_hidden");
  // Color: one color in the group, or exactly the color the analyzer saw. Size is not visible, so any
  // in-stock size of that color is the same product on the slide.
  const colors = [...new Set(rows.map((r) => String(r.color || "").trim().toUpperCase()).filter(Boolean))];
  const want = String(item.color || "").trim().toUpperCase();
  const color = colors.length <= 1 ? colors[0] ?? "" : colors.includes(want) ? want : null;
  if (color === null) reasons.push(want ? "color_not_in_product" : "color_unconfirmed");
  // In-stock options first: Meta "in stock" and the Cafe24 option available, in Cafe24 option order.
  const inStock = color === null ? [] : list(cafe24?.options).filter((o) => o.available === true)
    .map((o) => ({ o, row: rows.find((r) => parseMetaContentId(r.retailer_id).variantCode === o.variantCode && r.availability === "in stock" && (!color || String(r.color || "").trim().toUpperCase() === color)) }))
    .filter((x) => x.row && (!item.metaProductId || String(x.row.id) === item.metaProductId) && (!item.variantCode || x.o.variantCode === item.variantCode));
  if (color !== null && !reasons.includes("cafe24_not_found") && rows.length && !inStock.length) reasons.push("no_in_stock_option");
  const picked = inStock[0]?.row;
  if (picked) evidence.push(`meta: ${picked.retailer_id} "${picked.name}" in stock; ${inStock.length} in-stock option(s)`);
  if (second) evidence.push(`next candidate ${second.productNo} at ${second.confidence}`);
  return { tag: {
    productNo: top.productNo, metaProductId: picked ? String(picked.id) : null, retailerId: picked?.retailer_id ?? null,
    name: picked?.name ?? null, label: item.label ?? null, x: item.x, y: item.y, confidence: top.confidence, evidence: evidence.join(" | "),
    approved: false, status: reasons.length ? "TAG_REVIEW_REQUIRED" : "PROPOSED", reason: reasons.join(",") || null
  } };
}

// -> { ok, problems?, mapping } where mapping is product-tags.json plus per-slide review entries and source info.
export async function buildAutoMapping({ graph, findings, manifest, getCafe24Product, expected = SAMPLAS_META, now = Date.now() }) {
  const problems = validateFindings(findings, manifest);
  if (problems.length) return { ok: false, problems };
  const brand = String(findings.brand || findings.folderName.split("-")[0]).toUpperCase();
  const slides = [];
  for (const s of findings.slides) {
    const out = { order: s.order, savedAsset: s.savedAsset, tags: [], review: [] };
    for (const item of list(s.items)) {
      const p = await proposeTag({ graph, item, brand, getCafe24Product, catalogId: expected.catalogId });
      if (p.tag) out.tags.push(p.tag); else out.review.push(p.review);
    }
    // The same product twice on one slide is one tag; keep the first, send the rest to review.
    const seen = new Set();
    out.tags = out.tags.filter((t) => (seen.has(t.productNo) ? (out.review.push({ label: t.label, x: t.x, y: t.y, reason: "duplicate_product_on_slide" }), false) : seen.add(t.productNo)));
    slides.push(out);
  }
  const tags = slides.flatMap((s) => s.tags);
  const state = tags.length && tags.every((t) => t.status === "PROPOSED") && slides.every((s) => !s.review.length) ? "PROPOSED" : "TAG_REVIEW_REQUIRED";
  return { ok: true, mapping: {
    schemaVersion: 1, folderName: findings.folderName, post: { mediaId: null, permalink: null },
    source: { kind: "auto", analyzer: findings.analyzer, builtAt: new Date(now).toISOString(), state }, slides
  } };
}

// A person's decision on an auto mapping: the listed tags ({ order, productNo }) are approved, every other
// tag is dropped from this post (kept under slide.skipped). Only PROPOSED tags can be approved, at least one
// must be picked (a post without tags uses an empty product-tags.json), and builtAt must name the mapping
// the person looked at, so a newer mapping is never approved by mistake.
export function approveAutoTags(mapping, picks, { by, builtAt, now = Date.now() } = {}) {
  if (!by) return { ok: false, problems: ["approver_required"] };
  if (!builtAt || builtAt !== mapping?.source?.builtAt) return { ok: false, problems: ["mapping_changed"] };
  if (!list(picks).length) return { ok: false, problems: ["no_tags_selected"] };
  const want = new Set(list(picks).map((p) => `${p.order}:${p.productNo}`));
  const found = new Set();
  const problems = [];
  const slides = list(mapping?.slides).map((s) => {
    const tags = [], skipped = [...list(s.skipped)];
    for (const t of list(s.tags)) {
      const key = `${s.order}:${t.productNo}`;
      if (!want.has(key)) { skipped.push({ ...t, approved: false, status: "SKIPPED", reason: "not_selected_by_operator" }); continue; }
      found.add(key);
      if (t.status !== "PROPOSED" || !t.metaProductId) problems.push(`not_proposed:${key}`);
      else tags.push({ ...t, approved: true, status: "PENDING", approvedBy: by, approvedAt: new Date(now).toISOString() });
    }
    return { ...s, tags, skipped };
  });
  for (const key of want) if (!found.has(key)) problems.push(`unknown_tag:${key}`);
  if (problems.length) return { ok: false, problems };
  return { ok: true, mapping: { ...mapping, source: { ...mapping.source, state: "APPROVED" }, slides } };
}
