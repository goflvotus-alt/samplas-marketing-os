// VEIL FOUND sold-out caption audit (read only).
// Compares each "VEIL FOUND #NNN" block of the real @samplas_veil captions with the current Cafe24
// state of exactly one product of the same brand. Nothing here writes to Instagram, Cafe24, Dropbox
// or WORK_DIR: every dependency is an injected read function.
import { buildBrandRegistry, resolveBrand } from "./brand-engine.mjs";
import { classifyAiAuditCafe24Error } from "./ai-audit.mjs";

const PRICE_RE = /([\d][\d,]*(?:\.\d+)?)\s*(?:KRW|원)\s*$/i;
const SOLD_OUT_RE = /SOLD\s*OUT\s*$/i;
const CAFE24_BRAND_CODE_RE = /^B[0-9A-Z]{7}$/;

// One caption can hold several items (the weekly carousel). Each block is
// "VEIL FOUND #NNN" / brand / product name, followed by "<price> KRW" or "SOLD OUT"
// either at the end of the product line or on its own line.
export function parseVeilFoundCaption(caption) {
  const text = String(caption || "").replace(/\r\n/g, "\n");
  const heads = [...text.matchAll(/VEIL FOUND\s*#0*(\d{1,4})\b/gi)];
  return heads.map((head, i) => {
    const body = text.slice(head.index + head[0].length, heads[i + 1]?.index ?? text.length);
    const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
    const item = { number: Number(head[1]), brand: lines[0] || null, productName: null, price: null, soldOutMarked: false, parsed: false };
    let rest = lines.slice(1).join(" ").replace(/\s+/g, " ").trim();
    const price = rest.match(PRICE_RE);
    if (price) {
      item.price = Number(price[1].replace(/,/g, ""));
      rest = rest.slice(0, price.index).trim();
    } else if (SOLD_OUT_RE.test(rest)) {
      item.soldOutMarked = true;
      rest = rest.replace(SOLD_OUT_RE, "").trim();
    }
    item.productName = rest || null;
    item.parsed = Boolean(item.brand && item.productName && (item.price !== null || item.soldOutMarked));
    if (!item.parsed) item.reason = !item.brand || !item.productName ? "brand_or_product_missing" : "price_or_sold_out_missing";
    return item;
  });
}

// Exact comparison key: case, width, spacing and punctuation are folded, a leading "[BRAND]" prefix
// on the Cafe24 name is dropped. Nothing else (no fuzzy distance, no token reordering).
export function productNameKey(name) {
  return String(name || "").normalize("NFKC").toUpperCase()
    .replace(/^\s*\[[^\]]*\]\s*/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function matchCafe24Product(productName, brandProducts) {
  const key = productNameKey(productName);
  const exact = brandProducts.filter((p) => productNameKey(p.product_name) === key);
  if (exact.length === 1) return { status: "MATCHED", product: exact[0] };
  const brief = (p) => ({ productNo: p.product_no, productName: p.product_name });
  if (exact.length > 1) return { status: "AMBIGUOUS", candidates: exact.map(brief) };
  // Similar names are shown for manual review only, never confirmed automatically.
  const similar = key ? brandProducts.filter((p) => {
    const other = productNameKey(p.product_name);
    return other && (other.includes(key) || key.includes(other));
  }) : [];
  return { status: "NOT_FOUND", candidates: similar.slice(0, 3).map(brief) };
}

function firstInventory(variant) {
  const raw = variant?.inventories ?? variant?.inventory ?? null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

export function evaluateOption(variant) {
  const inv = firstInventory(variant);
  const option = {
    variantCode: variant?.variant_code || null,
    option: (variant?.options || []).map((o) => `${o.name}:${o.value}`).join(", ") || null,
    useInventory: inv?.use_inventory ?? null,
    quantity: inv?.quantity === undefined || inv?.quantity === null ? null : Number(inv.quantity),
    displaySoldOut: inv?.display_soldout ?? null
  };
  if (variant?.display === "F" || variant?.selling === "F") return { ...option, state: "NOT_SELLING" };
  if (!inv || !["T", "F"].includes(inv.use_inventory)) return { ...option, state: "UNKNOWN", reason: "inventory_settings_missing" };
  if (inv.use_inventory === "F") return { ...option, state: "UNLIMITED" };
  if (!Number.isFinite(option.quantity)) return { ...option, state: "UNKNOWN", reason: "quantity_missing" };
  if (option.quantity > 0) return { ...option, state: "IN_STOCK" };
  // Stock 0 with the sold-out display turned off: Cafe24 behaviour is not certain, so no verdict.
  return inv.display_soldout === "T" ? { ...option, state: "SOLD_OUT" } : { ...option, state: "UNKNOWN", reason: "zero_stock_without_sold_out_display" };
}

// SELLABLE | SOLD_OUT | NOT_SELLABLE (product display/selling off) | UNCERTAIN
export function evaluateCafe24Stock(product, variants) {
  const options = (variants || []).map(evaluateOption);
  const base = { display: product.display ?? null, selling: product.selling ?? null, productSoldOut: product.sold_out ?? null, options };
  if (!["T", "F"].includes(product.display) || !["T", "F"].includes(product.selling)) return { ...base, stock: "UNCERTAIN", reason: "display_or_selling_unknown" };
  if (product.display === "F" || product.selling === "F") return { ...base, stock: "NOT_SELLABLE", reason: product.display === "F" ? "not_displayed" : "selling_off" };
  if (!options.length) return { ...base, stock: "UNCERTAIN", reason: "no_variant_data" };
  const sellable = options.filter((o) => o.state === "IN_STOCK" || o.state === "UNLIMITED");
  const unknown = options.filter((o) => o.state === "UNKNOWN");
  let stock = sellable.length ? "SELLABLE" : unknown.length ? "UNCERTAIN" : "SOLD_OUT";
  let reason = stock === "UNCERTAIN" ? unknown[0].reason : null;
  if (product.sold_out === "T" && stock === "SELLABLE") { stock = "UNCERTAIN"; reason = "product_sold_out_flag_conflicts_with_options"; }
  if (product.sold_out === "F" && stock === "SOLD_OUT") { stock = "UNCERTAIN"; reason = "product_sold_out_flag_conflicts_with_options"; }
  return {
    ...base, stock, reason,
    unlimited: options.some((o) => o.state === "UNLIMITED"),
    sellableOptions: sellable.length, soldOutOptions: options.filter((o) => o.state === "SOLD_OUT" || o.state === "NOT_SELLING").length
  };
}

export function classifyItem(item, stock) {
  if (stock.stock === "UNCERTAIN") return "STOCK_UNCERTAIN";
  const available = stock.stock === "SELLABLE";
  if (!available && item.price !== null) return "SOLD_OUT_BUT_PRICED";
  if (available && item.soldOutMarked) return "SELLING_BUT_MARKED_SOLD_OUT";
  return "OK";
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); }
  }));
  return out;
}

const failure = (error) => ({ errorCode: classifyAiAuditCafe24Error(error), status: Number(error?.status) || null });

// fetchFeed(): Instagram media [{id, caption, permalink, timestamp}] (whole feed or throws)
// loadBrandMaster(): Brand Master { brands: [...] }
// listBrandProducts(brandCode): Cafe24 products [{product_no, brand_code, product_name, display, selling, sold_out}]
// listVariants(productNo): Cafe24 variants with embedded inventories
export async function runVeilSoldOutAudit({ fetchFeed, loadBrandMaster, listBrandProducts, listVariants, number, concurrency = 3, now = () => new Date() }) {
  const feed = await fetchFeed();
  const registry = buildBrandRegistry(await loadBrandMaster());
  const items = [];
  for (const media of feed) {
    for (const item of parseVeilFoundCaption(media.caption)) {
      items.push({ ...item, mediaId: media.id, permalink: media.permalink || null, postedAt: media.timestamp || null });
    }
  }
  const counts = new Map();
  for (const item of items) counts.set(item.number, (counts.get(item.number) || 0) + 1);
  const numbers = [...counts.keys()].sort((a, b) => a - b);
  const maxNumber = numbers.at(-1) || 0;
  const coverage = {
    postsScanned: feed.length,
    itemsFound: items.length,
    numberRange: numbers.length ? `#${String(numbers[0]).padStart(3, "0")}-#${String(maxNumber).padStart(3, "0")}` : null,
    missingNumbers: Array.from({ length: maxNumber }, (_, i) => i + 1).filter((n) => !counts.has(n)),
    duplicateNumbers: numbers.filter((n) => counts.get(n) > 1)
  };
  const selected = number === undefined ? items : items.filter((item) => item.number === number);

  const brandProducts = new Map();
  const productsFor = (brandCode) => {
    if (!brandProducts.has(brandCode)) brandProducts.set(brandCode, listBrandProducts(brandCode));
    return brandProducts.get(brandCode);
  };

  const rows = await mapLimit(selected, concurrency, async (item) => {
    const row = { number: item.number, permalink: item.permalink, postedAt: item.postedAt, caption: { brand: item.brand, productName: item.productName, price: item.price, soldOutMarked: item.soldOutMarked } };
    if (!item.parsed) return { ...row, verdict: "CAPTION_UNPARSED", reason: item.reason };
    if (counts.get(item.number) > 1) return { ...row, verdict: "UNCERTAIN_MATCH", reason: "duplicate_number_in_feed" };
    const brand = resolveBrand(item.brand, registry);
    if (!brand) return { ...row, verdict: "UNCERTAIN_MATCH", reason: "brand_not_resolved" };
    row.brandCode = brand.brandId;
    // Split identities (SPL_...) are internal codes, not Cafe24 brand codes: no lookup, no guess.
    if (!CAFE24_BRAND_CODE_RE.test(brand.brandId)) return { ...row, verdict: "UNCERTAIN_MATCH", reason: "brand_has_no_cafe24_brand_code" };
    let products;
    try { products = await productsFor(brand.brandId); } catch (error) { return { ...row, verdict: "LOOKUP_FAILED", stage: "brand_products", ...failure(error) }; }
    const match = matchCafe24Product(item.productName, products);
    if (match.status !== "MATCHED") return { ...row, verdict: "UNCERTAIN_MATCH", reason: match.status === "AMBIGUOUS" ? "several_exact_name_matches" : "no_exact_name_match", candidates: match.candidates };
    row.cafe24 = { productNo: match.product.product_no, productName: match.product.product_name };
    let variants;
    try { variants = await listVariants(match.product.product_no); } catch (error) { return { ...row, verdict: "LOOKUP_FAILED", stage: "variants", ...failure(error) }; }
    const stock = evaluateCafe24Stock(match.product, variants);
    return { ...row, cafe24: { ...row.cafe24, ...stock }, verdict: classifyItem(item, stock) };
  });

  const verdictCounts = {};
  for (const row of rows) verdictCounts[row.verdict] = (verdictCounts[row.verdict] || 0) + 1;
  const failures = rows.filter((row) => row.verdict === "LOOKUP_FAILED").map((row) => ({ number: row.number, stage: row.stage, errorCode: row.errorCode, status: row.status }));
  const complete = failures.length === 0 && (number === undefined || rows.length > 0);
  return {
    // A partial Cafe24 result is never reported as a successful audit.
    ok: complete,
    auditStatus: complete ? "COMPLETE" : "INCOMPLETE",
    checkedAt: now().toISOString(),
    ...(number === undefined ? {} : { number, ...(rows.length ? {} : { error: "number_not_found_in_feed" }) }),
    coverage,
    counts: verdictCounts,
    notChecked: failures.length,
    failures,
    rows
  };
}
