// SPLIT_CODE_IDENTITY (Phase 2): pure planner for separating a Cafe24 code reused by a different
// identity into two canonical identities. Nothing here reads or writes files; the executor in
// pending-brand-queue.mjs applies the plan atomically, and only when the operator enables writes.
//
// Old identity  : leaves the Cafe24 namespace -> SPL_ code, keeps name/aliases/active/explicit policy,
//                 records formerCodes. New identity: owns the Cafe24 code from cafe24Since.
import { createHash } from "node:crypto";
import { normalizeBrandKey, normalizeBrandName, parseBrandAliases, extractBracketBrandCandidate, extractSlashBrandCandidate } from "./brand-engine.mjs";
import { CODE_REUSE_REVIEW_REASON, classifyCodeReuse, internalIdentityCode } from "./cafe24-code-reuse.mjs";

export const SPLIT_ACTION = "SPLIT_CODE_IDENTITY";
const EXECUTABLE = new Set(["MINTED_CODE_COLLISION", "CAFE24_CODE_REUSED", "REVIEW_REQUIRED"]);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function splitError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

const brandsOf = (canonical) => (Array.isArray(canonical) ? canonical : canonical?.brands || []);
const withBrands = (canonical, brands) => (Array.isArray(canonical) ? brands : { ...canonical, brands });
const previousMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const nameKeyOf = (text) => {
  const parsed = extractBracketBrandCandidate(String(text || "")) || extractSlashBrandCandidate(String(text || ""));
  return parsed?.candidate ? normalizeBrandKey(parsed.candidate) : "";
};

// Everything the operator saw in the dry-run; execution refuses if any of it changed.
export function splitPreconditions({ candidate, owner, live }) {
  return {
    pendingId: candidate.id,
    code: candidate.sourceBrandCode,
    previousCanonicalCode: owner?.brand_code ?? null,
    previousCanonicalBrand: owner?.brand_name ?? null,
    currentCafe24Brand: live ? normalizeBrandName(live.brand_name || live.brandName || "") : null,
    classification: candidate.codeReuseClassification ?? null,
    suggestedEffectiveMonth: candidate.suggestedEffectiveMonth ?? null
  };
}
export const splitVersion = (preconditions) => createHash("sha256").update(JSON.stringify(preconditions)).digest("hex").slice(0, 16);

// Registry entries keep the Cafe24 code unless every product name on them names the old identity.
function belongsToOldIdentity(entry, oldKeys, newKey) {
  const names = [entry.canonicalProductName, entry.productName, entry.cafe24?.productName,
    ...(Array.isArray(entry.ecount?.matchedProducts) ? entry.ecount.matchedProducts.map((p) => p.productName) : [])].filter(Boolean);
  const keys = names.map(nameKeyOf).filter(Boolean);
  return keys.length > 0 && keys.every((key) => oldKeys.has(key)) && !keys.includes(newKey);
}

/**
 * @returns {{ status: "ALREADY_SPLIT", ... } | { status: "PLANNED", version, preconditions, canonical, policies, productRegistry, queue, diff, oldIdentity, newIdentity }}
 */
export function planCodeIdentitySplit({ canonical, policies = { policies: [] }, productRegistry = { entries: [] }, queue, input, sources, now = new Date().toISOString() }) {
  const brands = brandsOf(canonical);
  const candidate = (queue?.candidates || []).find((c) => c.id === input?.id);
  if (!candidate) throw splitError("NOT_FOUND", "Pending candidate not found", 404);
  const code = candidate.sourceBrandCode;
  const newName = normalizeBrandName(candidate.rawBrandName);

  const splitOld = brands.find((b) => (b.formerCodes || []).some((f) => f.code === code));
  const owner = brands.find((b) => b.brand_code === code);
  if ((candidate.status === "APPROVED" && candidate.approvalAction === SPLIT_ACTION) ||
      (splitOld && owner && normalizeBrandKey(owner.brand_name) === normalizeBrandKey(newName) && owner.externalCodes?.cafe24?.code === code)) {
    return { status: "ALREADY_SPLIT", code, oldBrandCode: splitOld?.brand_code ?? null, newBrandCode: owner?.brand_code ?? null };
  }

  if (candidate.status !== "PENDING" || candidate.reviewReason !== CODE_REUSE_REVIEW_REASON || candidate.requiresIdentitySplit !== true || !EXECUTABLE.has(candidate.codeReuseClassification)) {
    throw splitError("NOT_ELIGIBLE", "Only pending CODE_REUSE_SPLIT_REQUIRED candidates can be split");
  }
  const owners = brands.filter((b) => normalizeBrandKey(b.brand_code) === normalizeBrandKey(code));
  if (owners.length !== 1 || owners[0].active !== false || owners[0].supersededBy) throw splitError("VERSION_CONFLICT", "Cafe24 code ownership changed since the scan; refresh first", 409);
  const live = (sources?.cafe24Brands || []).find((b) => normalizeBrandKey(b.brand_code || b.brandCode || b.code) === normalizeBrandKey(code));
  const fresh = classifyCodeReuse({ candidateName: candidate.rawBrandName, code, owner: owners[0], cafe24Brands: sources?.cafe24Brands || [], products: sources?.products || [], ecountProducts: sources?.ecountProducts || [], ecountLines: sources?.ecountLines || [] });
  if (!fresh || fresh.codeReuseClassification !== candidate.codeReuseClassification || fresh.suggestedEffectiveMonth !== candidate.suggestedEffectiveMonth ||
      normalizeBrandKey(live?.brand_name || live?.brandName || "") !== normalizeBrandKey(newName)) {
    throw splitError("VERSION_CONFLICT", "Code reuse evidence changed since the scan; refresh and dry-run again", 409);
  }
  const preconditions = splitPreconditions({ candidate, owner: owners[0], live });
  const version = splitVersion(preconditions);
  if (input.expectedVersion !== undefined && input.expectedVersion !== version) throw splitError("VERSION_CONFLICT", "State changed since the dry-run", 409);

  let effectiveMonth = candidate.suggestedEffectiveMonth;
  if (candidate.codeReuseClassification === "REVIEW_REQUIRED") {
    if (!MONTH.test(input.effectiveMonth || "") || !String(input.evidenceNote || "").trim()) {
      throw splitError("REVIEW_REQUIRED", "REVIEW_REQUIRED needs an explicit effectiveMonth (YYYY-MM) and evidenceNote");
    }
    effectiveMonth = input.effectiveMonth;
  }

  const old = owners[0];
  const splCode = internalIdentityCode(code, old.brand_name);
  if (brands.some((b) => b.brand_code === splCode)) throw splitError("VERSION_CONFLICT", `Internal code ${splCode} already exists`, 409);
  const oldKeys = new Set([old.brand_name, ...parseBrandAliases(old.name_aliases)].map(normalizeBrandKey).filter(Boolean));
  const newKey = normalizeBrandKey(newName);
  const claimant = brands.find((b) => b !== old && [b.brand_name, ...parseBrandAliases(b.name_aliases)].some((n) => normalizeBrandKey(n) === newKey));
  if (claimant) throw splitError("NAME_CONFLICT", `${newName} is already claimed by ${claimant.brand_code}`, 409);

  const minted = candidate.codeReuseClassification === "MINTED_CODE_COLLISION";
  const oldIdentity = {
    ...old,
    brand_code: splCode,
    name_aliases: parseBrandAliases(old.name_aliases).filter((alias) => normalizeBrandKey(alias) !== normalizeBrandKey(code)),
    identityCode: splCode,
    externalCodes: { cafe24: null },
    formerCodes: [...(old.formerCodes || []), { code, source: minted ? "MARKETING_OS_MINTED" : candidate.codeReuseClassification === "CAFE24_CODE_REUSED" ? "CAFE24" : "OPERATOR_REVIEWED", until: minted ? null : previousMonth(effectiveMonth) }]
  };
  const newIdentity = {
    brand_code: code, brand_name: newName, name_aliases: [], instagram_tag: "", active: true, nameSource: "confirmed",
    identityCode: code, externalCodes: { cafe24: { code, since: effectiveMonth, until: null } }, formerCodes: []
  };
  const nextBrands = [...brands.filter((b) => b !== old), oldIdentity, newIdentity];

  const policyRows = Array.isArray(policies?.policies) ? policies.policies : [];
  const movedPolicies = policyRows.filter((p) => p.brand_code === code);
  const nextPolicies = { ...policies, policies: policyRows.map((p) => (p.brand_code === code ? { ...p, brand_code: splCode, identity_rekey: { fromBrandCode: code, splitAt: now } } : p)) };

  const entries = Array.isArray(productRegistry?.entries) ? productRegistry.entries : [];
  const movedEntries = entries.filter((e) => e.brandId === code && belongsToOldIdentity(e, oldKeys, newKey));
  const nextRegistry = { ...productRegistry, entries: entries.map((e) => (movedEntries.includes(e) ? { ...e, brandId: splCode } : e)) };

  const nextCandidate = { ...candidate, status: "APPROVED", approvalAction: SPLIT_ACTION, approvedAt: now, canonicalBrandCode: code, note: input.note || "",
    splitIdentity: { oldBrandCode: splCode, oldBrandName: old.brand_name, newBrandCode: code, newBrandName: newName, effectiveMonth, classification: candidate.codeReuseClassification, ...(input.evidenceNote ? { evidenceNote: input.evidenceNote } : {}) } };
  const nextQueue = { ...queue, candidates: queue.candidates.map((c) => (c.id === candidate.id ? nextCandidate : c)) };

  return {
    status: "PLANNED", version, preconditions, effectiveMonth,
    canonical: withBrands(canonical, nextBrands), policies: nextPolicies, productRegistry: nextRegistry, queue: nextQueue,
    oldIdentity, newIdentity,
    diff: {
      brandMaster: { before: [old], after: [oldIdentity, newIdentity] },
      commercialPolicy: { before: movedPolicies, after: movedPolicies.map((p) => ({ ...p, brand_code: splCode })) },
      productRegistry: { moved: movedEntries.map((e) => ({ id: e.id ?? e.canonicalProductId ?? null, from: code, to: splCode })), unchangedOnCode: entries.filter((e) => e.brandId === code).length - movedEntries.length },
      pendingQueue: { before: { id: candidate.id, status: candidate.status, reviewReason: candidate.reviewReason }, after: { id: candidate.id, status: "APPROVED", approvalAction: SPLIT_ACTION, canonicalBrandCode: code } }
    }
  };
}
