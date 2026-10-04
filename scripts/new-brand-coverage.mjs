// NEW BRANDS operation status: exactly three states, in this order.
//   no sellable Cafe24 product            → NEW_BRAND_ARRIVED ("새브랜드 입고")
//   sellable, no active NAVER ad group     → NAVER_MISSING    ("NAVER 미등록")
//   sellable and active NAVER ad group     → COMPLETE         ("완료")
// Sellable = Cafe24 display=T, selling=T and not sold out (what a shopper can buy now).
// Unknown data never upgrades a brand: an unchecked Cafe24 counts as "not sellable" and an
// unchecked NAVER counts as "not registered".
import { normalizeBrandKey, parseBrandAliases } from "./brand-engine.mjs";

export const OPERATION_STATUS = Object.freeze({
  NEW_BRAND_ARRIVED: "새브랜드 입고",
  NAVER_MISSING: "NAVER 미등록",
  COMPLETE: "완료"
});

export function summarizeCafe24Products(products, brandCode) {
  const own = (products || []).filter((p) => p.brand_code === brandCode);
  const displayed = own.filter((p) => p.display === "T" && p.selling === "T");
  const sellable = displayed.filter((p) => p.sold_out !== "T");
  return { productCount: own.length, displayedProductCount: displayed.length, sellableProductCount: sellable.length, hasSellableProducts: sellable.length > 0 };
}

// Whole-name equality under the project's normalizeBrandKey (case, spacing, quote/dash
// variants). No substring matching: "RECORDS" inside another ad group name never counts.
export function matchNaverRegistration({ brandName, aliases = [] }, adgroups) {
  const names = [brandName, ...parseBrandAliases(aliases)].map(normalizeBrandKey).filter(Boolean);
  const canonical = normalizeBrandKey(brandName);
  const hits = (adgroups || []).filter((g) => names.includes(normalizeBrandKey(g.name)));
  const active = hits.find((g) => !g.paused);
  if (active) return { registered: true, matchedBy: normalizeBrandKey(active.name) === canonical ? "adgroup" : "adgroup-alias", adgroupName: active.name.trim(), pausedOnly: false };
  return { registered: false, matchedBy: null, adgroupName: hits[0]?.name.trim() ?? null, pausedOnly: hits.length > 0 };
}

export function operationStatus(cafe24, naver) {
  const code = !cafe24?.hasSellableProducts ? "NEW_BRAND_ARRIVED" : !naver?.registered ? "NAVER_MISSING" : "COMPLETE";
  return { operationStatus: code, operationStatusLabel: OPERATION_STATUS[code] };
}

// cafe24ByCode: Map brandCode → summary | { error }; naverIndex: { ok, adgroups } | { ok: false, error }.
export function attachCoverage(newBrands, { cafe24ByCode = new Map(), naverIndex = { ok: false, adgroups: [] }, aliasesByCode = new Map() }) {
  const brands = newBrands.brands.map((brand) => {
    const c = cafe24ByCode.get(brand.brandCode);
    const cafe24 = c && !c.error
      ? { ...c, checked: true }
      : { productCount: null, displayedProductCount: null, sellableProductCount: null, hasSellableProducts: false, checked: false, error: c?.error || "Cafe24 not checked" };
    // NAVER is only relevant once something is on sale.
    const naver = !cafe24.hasSellableProducts
      ? { registered: null, matchedBy: null, checked: false, skipped: "no sellable Cafe24 products" }
      : naverIndex.ok
        ? { ...matchNaverRegistration({ brandName: brand.brandName, aliases: aliasesByCode.get(brand.brandCode) || [] }, naverIndex.adgroups), checked: true }
        : { registered: false, matchedBy: null, checked: false, error: naverIndex.error || "NAVER not checked" };
    return { ...brand, cafe24, naver, ...operationStatus(cafe24, naver) };
  });
  const counts = Object.fromEntries(Object.keys(OPERATION_STATUS).map((code) => [code, brands.filter((b) => b.operationStatus === code).length]));
  return { ...newBrands, brands, statusCounts: counts, coverage: { naverCheckedAt: naverIndex.fetchedAt || null, naverError: naverIndex.ok ? null : naverIndex.error || null } };
}
