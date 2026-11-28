// Shape of GET /api/cafe24/brand-products rows. Pure functions so Production (direct Cafe24) and a local
// proxy instance return the same fields.
//
// created_date is Cafe24's first registration time; updated_date is the last product edit and is never a
// registration. Variant stock is reported raw: quantity and use_inventory as Cafe24 gives them, null when
// absent. Sold-out is not derived from display_soldout, which is a display setting, not the stock state.

export const MAX_VARIANT_PRODUCTS = 100;

export function projectBrandProduct(p = {}) {
  return {
    product_no: p.product_no, brand_code: p.brand_code, product_name: p.product_name,
    display: p.display, selling: p.selling, sold_out: p.sold_out,
    created_date: p.created_date ?? null, updated_date: p.updated_date ?? null
  };
}

export function projectVariant(v = {}) {
  const raw = v.inventories ?? v.inventory ?? null;
  const inv = (Array.isArray(raw) ? raw[0] : raw) || {};
  const quantity = inv.quantity ?? v.quantity;
  const useInventory = inv.use_inventory ?? v.use_inventory;
  return {
    variant_code: v.variant_code ?? null,
    options: (Array.isArray(v.options) ? v.options : []).map((o) => ({ name: o?.name ?? null, value: o?.value ?? null })),
    quantity: quantity === undefined || quantity === null || quantity === "" || !Number.isFinite(Number(quantity)) ? null : Number(quantity),
    use_inventory: useInventory ?? null,
    display: v.display ?? null, selling: v.selling ?? null
  };
}

// "include=variants&product_nos=1,2" -> [1, 2]. Variants cost one Cafe24 call per product, so they are only
// returned for listed products, at most MAX_VARIANT_PRODUCTS. Returns { ok, productNos } or { ok: false, error }.
export function parseVariantRequest(searchParams) {
  const include = String(searchParams.get("include") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!include.length) return { ok: true, productNos: [] };
  if (include.some((s) => s !== "variants")) return { ok: false, error: "include supports only variants" };
  const raw = String(searchParams.get("product_nos") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!raw.length) return { ok: false, error: "product_nos required with include=variants" };
  if (raw.some((s) => !/^[1-9]\d{0,9}$/.test(s))) return { ok: false, error: "product_nos must be positive integers" };
  const productNos = [...new Set(raw.map(Number))];
  if (productNos.length > MAX_VARIANT_PRODUCTS) return { ok: false, error: `product_nos max ${MAX_VARIANT_PRODUCTS}` };
  return { ok: true, productNos };
}

// Adds variants to the listed products. fetchVariants(productNo) -> raw Cafe24 variants. One failure marks
// that product (variants: null, variants_error) and keeps the rest. Sequential on purpose: Cafe24 rate limit.
export async function attachVariants(products, productNos, fetchVariants) {
  const want = new Set(productNos);
  const out = [];
  for (const p of products) {
    if (!want.has(Number(p.product_no))) { out.push(p); continue; }
    try { out.push({ ...p, variants: (await fetchVariants(p.product_no)).map(projectVariant) }); }
    catch (error) { out.push({ ...p, variants: null, variants_error: String(error?.message || error).slice(0, 200) }); }
  }
  return out;
}
