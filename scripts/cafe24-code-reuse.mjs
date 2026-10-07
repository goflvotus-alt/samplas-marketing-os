// Cafe24 brand code reuse: detection, identity metadata and internal identity codes (Phase 1).
// Background (2026-10): Marketing OS gave ECOUNT-only brands codes in the Cafe24 namespace and Cafe24
// later issued the same codes to new brands. A code owned by a different canonical identity must be
// split into old/new identities, never reassigned in place. This module only classifies and models;
// it never changes Brand Master, policies or archives.
import { createHash } from "node:crypto";
import { normalizeBrandKey, normalizeBrandName, parseBrandAliases, extractBracketBrandCandidate, extractSlashBrandCandidate } from "./brand-engine.mjs";

export const CAFE24_CODE_PATTERN = /^B[0-9A-Z]{7}$/;
export const CODE_REUSE_REVIEW_REASON = "CODE_REUSE_SPLIT_REQUIRED";
export const CODE_REUSE_CLASSIFICATIONS = Object.freeze(["MINTED_CODE_COLLISION", "CAFE24_CODE_REUSED", "REVIEW_REQUIRED"]);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Stable internal key for an identity that must leave the Cafe24 namespace (old side of a split):
// SPL_ + sha256("<formerCode>|<normalized brand key>")[0..10]. Same brand spelled differently
// (case/spacing) yields the same key.
export function internalIdentityCode(formerCode, canonicalName) {
  return `SPL_${createHash("sha256").update(`${String(formerCode).trim().toUpperCase()}|${normalizeBrandKey(canonicalName)}`).digest("hex").slice(0, 10)}`;
}

function month(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !MONTH.test(value)) throw new Error(`${field} must be a YYYY-MM month`);
  return value;
}

// Additive identity metadata. Legacy entries (no metadata) derive it from brand_code, so existing
// Brand Master files keep working unchanged.
export function parseIdentityMetadata(entry = {}) {
  const brandCode = String(entry.brand_code || "");
  const explicit = entry.externalCodes?.cafe24;
  const cafe24 = explicit !== undefined
    ? explicit && { code: String(explicit.code || ""), since: month(explicit.since, "externalCodes.cafe24.since"), until: month(explicit.until, "externalCodes.cafe24.until") }
    : CAFE24_CODE_PATTERN.test(brandCode) ? { code: brandCode, since: null, until: null } : null;
  const formerCodes = (Array.isArray(entry.formerCodes) ? entry.formerCodes : []).map((f) => ({ code: String(f.code || ""), source: f.source ?? null, until: month(f.until, "formerCodes.until") }));
  return { brandCode, identityCode: entry.identityCode || brandCode, externalCodes: { cafe24 }, formerCodes };
}

const KST_MONTH = (iso) => {
  const time = Date.parse(iso || "");
  return Number.isFinite(time) ? new Date(time).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7) : null;
};
const parsedBrandKey = (name) => {
  const text = String(name || "");
  const parsed = extractBracketBrandCandidate(text) || extractSlashBrandCandidate(text);
  return parsed?.type === "single" || parsed?.candidate ? normalizeBrandKey(parsed.candidate) : "";
};

// Returns null when the candidate is the owner's own identity (same name or alias), otherwise the
// reuse classification with the evidence behind it.
export function classifyCodeReuse({ candidateName, code, owner, cafe24Brands = [], products = [], ecountProducts = [], ecountLines = [] }) {
  const candidateKey = normalizeBrandKey(candidateName);
  const ownerKeys = new Set([owner.brand_name, ...parseBrandAliases(owner.name_aliases)].map(normalizeBrandKey).filter(Boolean));
  if (!candidateKey || ownerKeys.has(candidateKey)) return null;
  const codeKey = normalizeBrandKey(code);
  const live = cafe24Brands.find((b) => normalizeBrandKey(b.brand_code || b.brandCode || b.code) === codeKey) || null;
  const underCode = products.filter((p) => normalizeBrandKey(p.brand_code || p.brandCode) === codeKey).map((p) => ({ key: parsedBrandKey(p.product_name || p.productName), createdAt: p.created_date || null }));
  const ownerCafe24 = underCode.filter((p) => ownerKeys.has(p.key));
  const currentCafe24 = underCode.filter((p) => p.key === candidateKey);
  const count = (rows, keys) => rows.filter((r) => keys.has(parsedBrandKey(r.productName))).length;
  const createdAt = Number.isFinite(Date.parse(live?.created_date || "")) ? live.created_date : null;
  const currentDates = currentCafe24.map((p) => p.createdAt).filter((d) => Number.isFinite(Date.parse(d || ""))).sort((a, b) => Date.parse(a) - Date.parse(b));

  let classification = "REVIEW_REQUIRED";
  let suggestedEffectiveMonth = null;
  if (!ownerCafe24.length && createdAt) {
    classification = "MINTED_CODE_COLLISION";
    suggestedEffectiveMonth = KST_MONTH(createdAt);
  } else if (ownerCafe24.length && currentDates.length) {
    classification = "CAFE24_CODE_REUSED";
    suggestedEffectiveMonth = KST_MONTH(currentDates[0]);
  }
  return {
    codeReuseClassification: classification,
    suggestedEffectiveMonth,
    previousCanonicalBrand: owner.brand_name,
    previousCanonicalCode: owner.brand_code,
    currentCafe24Brand: normalizeBrandName(live?.brand_name || live?.brandName || candidateName),
    requiresIdentitySplit: true,
    evidenceSummary: {
      cafe24Code: owner.brand_code,
      cafe24Name: live ? normalizeBrandName(live.brand_name || live.brandName || "") : null,
      cafe24CreatedAt: createdAt,
      earliestCurrentProductAt: currentDates[0] || null,
      previousOwnerCafe24Evidence: ownerCafe24.length > 0,
      previousOwnerCafe24Products: ownerCafe24.length,
      currentCafe24Products: currentCafe24.length,
      previousOwnerEcountProducts: count(ecountProducts, ownerKeys),
      previousOwnerEcountSalesLines: count(ecountLines, ownerKeys),
      currentEcountProducts: count(ecountProducts, new Set([candidateKey])),
      currentEcountSalesLines: count(ecountLines, new Set([candidateKey]))
    }
  };
}

// Cafe24 code audit. Every Brand Master entry whose *current* brand_code is in the Cafe24 namespace is
// classified; formerCodes are history, never ownership, so a re-keyed or split old code is not audited.
// Cafe24 issues codes in strictly increasing order (verified 2026-10-07: 175/175 live brands), so a
// missing code below the live maximum is a deleted Cafe24 brand and one above it is not issued yet.
// Audit only: nothing here creates pending candidates or changes Brand Master.
//
// Order: 1 VALID_CONFIRMED_CAFE24_IDENTITY (live owner, same name/alias or confirmed externalCodes)
//        2 CODE_REUSE_SPLIT_REQUIRED (live owner is a different identity; classified like pending splits)
//        3 CODE_AHEAD_OF_CAFE24 / PREEMPTIVE_REKEY_REQUIRED (no live owner, above the maximum)
//        4 RETIRED_CAFE24_CODE (no live owner, below the maximum, no remaining evidence of use)
//        5 REVIEW_REQUIRED (anything else, including no live list to compare against)
export const CAFE24_CODE_AUDIT_STATUSES = Object.freeze(["VALID_CONFIRMED_CAFE24_IDENTITY", "CODE_REUSE_SPLIT_REQUIRED", "CODE_AHEAD_OF_CAFE24",
  "PREEMPTIVE_REKEY_REQUIRED", "RETIRED_CAFE24_CODE", "REVIEW_REQUIRED"]);
// Findings worth an operator's attention; retired codes are recorded but not surfaced as work.
const ACTIONABLE = new Set(["CODE_REUSE_SPLIT_REQUIRED", "CODE_AHEAD_OF_CAFE24", "PREEMPTIVE_REKEY_REQUIRED", "REVIEW_REQUIRED"]);

export function cafe24CodeAudit(brands = [], cafe24Brands = [], { products = [], ecountProducts = [], ecountLines = [] } = {}) {
  const codeOf = (b) => String(b.brand_code || b.brandCode || b.code || "").trim().toUpperCase();
  const live = new Map(cafe24Brands.map((b) => [codeOf(b), b]));
  const liveNames = new Map(cafe24Brands.map((b) => [normalizeBrandKey(b.brand_name || b.brandName || ""), codeOf(b)]));
  const maxCode = [...live.keys()].filter((c) => CAFE24_CODE_PATTERN.test(c)).sort().at(-1) || null;
  const productCodes = new Map();
  for (const p of products) { const c = codeOf(p); productCodes.set(c, (productCodes.get(c) || 0) + 1); }
  const countByKey = (rows) => { const m = new Map(); for (const r of rows) { const k = parsedBrandKey(r.productName); if (k) m.set(k, (m.get(k) || 0) + 1); } return m; };
  const ecountProductKeys = countByKey(ecountProducts);
  const ecountLineKeys = countByKey(ecountLines);
  const summary = Object.fromEntries(CAFE24_CODE_AUDIT_STATUSES.map((s) => [s, 0]));
  const findings = [];
  for (const brand of brands) {
    const code = String(brand.brand_code || "");
    if (!CAFE24_CODE_PATTERN.test(code)) continue;
    const current = live.get(code) || null;
    const keys = [brand.brand_name, ...parseBrandAliases(brand.name_aliases)].map(normalizeBrandKey).filter(Boolean);
    const cafe24Name = current ? normalizeBrandName(current.brand_name || current.brandName || "") : null;
    const confirmedExternal = brand.externalCodes?.cafe24?.code === code && brand.nameSource === "confirmed";
    let status;
    let evidence = {};
    if (current && (keys.includes(normalizeBrandKey(cafe24Name)) || confirmedExternal)) {
      summary.VALID_CONFIRMED_CAFE24_IDENTITY += 1;
      continue;
    }
    if (current) {
      status = "CODE_REUSE_SPLIT_REQUIRED";
      const reuse = classifyCodeReuse({ candidateName: cafe24Name, code, owner: brand, cafe24Brands, products, ecountProducts, ecountLines });
      evidence = { codeReuseClassification: reuse?.codeReuseClassification ?? "REVIEW_REQUIRED", suggestedEffectiveMonth: reuse?.suggestedEffectiveMonth ?? null };
    } else {
      const sameNameLive = keys.map((k) => liveNames.get(k)).find(Boolean) || null;
      evidence = { cafe24MaxCode: maxCode, catalogProducts: productCodes.get(code) || 0, sameNameLiveCode: sameNameLive,
        ecountProducts: keys.reduce((s, k) => s + (ecountProductKeys.get(k) || 0), 0), ecountSalesLines: keys.reduce((s, k) => s + (ecountLineKeys.get(k) || 0), 0) };
      if (!maxCode) status = "REVIEW_REQUIRED";
      else if (code > maxCode) {
        // Minted by Marketing OS: Cafe24 never issued it and no Cafe24 ownership is recorded.
        const minted = !brand.externalCodes?.cafe24 && evidence.catalogProducts === 0;
        status = minted ? "PREEMPTIVE_REKEY_REQUIRED" : "CODE_AHEAD_OF_CAFE24";
        if (minted) summary.CODE_AHEAD_OF_CAFE24 += 1;
      } else if (brand.active === false && evidence.catalogProducts === 0 && !sameNameLive && evidence.ecountProducts === 0 && evidence.ecountSalesLines === 0) {
        status = "RETIRED_CAFE24_CODE";
      } else status = "REVIEW_REQUIRED";
    }
    summary[status] += 1;
    findings.push({ rule: "UNCONFIRMED_CAFE24_CODE", status, actionable: ACTIONABLE.has(status), brandCode: code, brandName: brand.brand_name, active: brand.active !== false, cafe24Name, ...evidence });
  }
  return { cafe24MaxCode: maxCode, summary, findings };
}

// Back-compatible list form: every non-valid Cafe24-namespace code with its status.
export function auditUnconfirmedCafe24Codes(brands = [], cafe24Brands = [], evidence = {}) {
  return cafe24CodeAudit(brands, cafe24Brands, evidence).findings;
}
