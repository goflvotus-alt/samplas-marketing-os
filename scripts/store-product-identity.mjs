import { resolveBrand } from "./brand-engine.mjs";
import {
  normalizeProductName,
  splitEcountProductName,
  stripConsignmentToken
} from "./diagnose-cafe24-ecount-product-matching.mjs";

const DETERMINISTIC_DIAGNOSTICS = new Set(["exact_one_to_one", "exact_one_to_many"]);

export function storeProductIdentityKey(productName, size) {
  return `${normalizeProductName(productName)}\0${normalizeProductName(size)}`;
}

export function buildStoreProductIdentityIndex(productRegistry = {}) {
  const byExactKey = new Map();
  for (const entry of productRegistry?.entries || []) {
    const confirmed = entry?.verified === true && entry?.status === "confirmed";
    const deterministic = (entry?.matching?.diagnosticType || []).some((type) => DETERMINISTIC_DIAGNOSTICS.has(type));
    if (!confirmed && !deterministic) continue;
    for (const product of entry?.ecount?.matchedProducts || []) {
      const key = storeProductIdentityKey(product?.productName, product?.size);
      if (!key.replace("\0", "")) continue;
      const candidates = byExactKey.get(key) || new Map();
      candidates.set(entry.canonicalProductId, { entry, confirmed });
      byExactKey.set(key, candidates);
    }
  }
  return { byExactKey };
}

export function resolveStoreProductIdentity(line, index, brandRegistry) {
  if (!line?.productName) return { status: "unresolved", reason: "insufficient_identity", candidates: [] };
  const candidates = [...(index?.byExactKey?.get(storeProductIdentityKey(line.productName, line.specification))?.values() || [])];
  if (!candidates.length) return { status: "unresolved", reason: "unknown_product", candidates: [] };
  if (candidates.length > 1) {
    return { status: "unresolved", reason: "ambiguous", candidates: candidates.map(({ entry }) => entry) };
  }

  const candidate = candidates[0];
  const rawBrand = stripConsignmentToken(splitEcountProductName(line.productName).brandRaw);
  const resolvedBrand = rawBrand && brandRegistry ? resolveBrand(rawBrand, brandRegistry) : null;
  if (resolvedBrand && resolvedBrand.brandId !== candidate.entry.brandId) {
    return { status: "unresolved", reason: "brand_conflict", candidates: [candidate.entry] };
  }

  return {
    status: "resolved",
    entry: candidate.entry,
    method: candidate.confirmed ? "exact_confirmed" : "deterministic_registry_alias",
    evidence: ["exact_normalized_product_name", "exact_normalized_size", resolvedBrand ? "brand_registry_match" : "existing_registry_identity"]
  };
}
