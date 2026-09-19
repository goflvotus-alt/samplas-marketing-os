import { normalizeBrandKey, parseBrandAliases } from "./brand-engine.mjs";

// Read-only audit evidence approved for this UX batch. These records are not
// aliases, approvals, or attribution rules. Never consume them in a write/resolver.
export const reviewedProductEvidence = [
  {
    candidateId: "b5a86532a530e2c3cb10cfb1",
    ecountProductName: "LYM / ANARCHY WALLET WHITE",
    cafe24ProductNo: 10410,
    exactProductTitle: "ANARCHY WALLET WHITE",
    canonicalBrandCode: "B00000LI",
    canonicalNames: ["LIBERAL YOUTH MINISTRY"],
    source: "User-approved read-only exact-product audit, 2026-09-18"
  },
  {
    candidateId: "d505ee59f3ed9a36fad60ba2",
    ecountProductName: "CON - PACOSPLY / FALLING ANGEL SWEATPANTS NAVY",
    cafe24ProductNo: 15052,
    exactProductTitle: "FALLING ANGEL SWEATPANTS NAVY",
    canonicalBrandCode: "B00000ZT",
    canonicalNames: ["PACOSPLY", "파코서플라이"],
    source: "User-approved read-only exact-product audit, 2026-09-18"
  }
];

// Display hints only. Fail closed on changed identity, ambiguous evidence or
// unknown classifications. POST validation remains the sole write authority.
export function pendingBrandUiMetadata(candidate, canonical, aliases = [], evidence = reviewedProductEvidence) {
  const hint = operationalMetadata(candidate, canonical, aliases, evidence);
  const brands = Array.isArray(canonical) ? canonical : canonical?.brands;
  const names = [candidate.rawBrandName, candidate.cafe24Name, ...(candidate.cafe24Variants || []), ...(candidate.ecountVariants || [])].filter(Boolean).map(normalizeBrandKey);
  const identity = b => ({ brandCode: b.brand_code, canonicalName: b.brand_name });
  const codeMatches = (brands || []).filter(b => candidate.sourceBrandCode && [b.brand_code, ...(b.sourceCafe24Codes || [])].includes(candidate.sourceBrandCode));
  const exactNameMatches = (brands || []).filter(b => b.brand_name && names.includes(normalizeBrandKey(b.brand_name)));
  const exactAliasMatches = (brands || []).filter(b => parseBrandAliases(b.name_aliases).some(a => names.includes(normalizeBrandKey(a))));
  const identities = new Set([...codeMatches, ...exactNameMatches, ...exactAliasMatches].map(b => b.brand_code));
  const conflict = codeMatches.some(b => !names.includes(normalizeBrandKey(b.brand_name)) && !exactAliasMatches.includes(b));
  const result = !Array.isArray(brands) ? "UNKNOWN" : identities.size > 1 || codeMatches.length > 1 ? "DUPLICATE_IDENTITY" : conflict ? "CODE_NAME_CONFLICT" : exactNameMatches.length ? "EXACT_EXISTING" : exactAliasMatches.length ? "ALIAS_EXISTING" : codeMatches.length ? "EXACT_EXISTING" : "NO_EXISTING_IDENTITY";
  return { ...hint, masterComparison: {
    sourceBrandCode: candidate.sourceBrandCode || null,
    codeMatch: codeMatches.length > 0,
    codeMatchCanonicalName: codeMatches.length === 1 ? codeMatches[0].brand_name : null,
    codeMatches: codeMatches.map(identity),
    exactNameMatches: exactNameMatches.map(identity),
    exactAliasMatches: exactAliasMatches.map(identity),
    duplicateIdentityCount: identities.size,
    productEvidenceTarget: hint.reviewEvidence ? (brands || []).filter(b => b.brand_code === hint.reviewCanonicalTarget).map(identity) : [],
    result
  } };
}

function operationalMetadata(candidate, canonical, aliases = [], evidence = reviewedProductEvidence) {
  const brands = Array.isArray(canonical) ? canonical : canonical?.brands || [];
  const none = operationalClass => ({ operationalClass, recommendedUiAction: null, reviewCanonicalTarget: null });
  if (!Array.isArray(canonical) && !Array.isArray(canonical?.brands)) return none("UNKNOWN");
  if (candidate.status !== "PENDING") return none("REVIEWED");
  if (candidate.heldAt) return none("HOLD");
  if (candidate.reviewReason === "CODE_NAME_CONFLICT") return none("CODE_NAME_CONFLICT");
  if (candidate.relatedCandidateIds?.length || candidate.reviewReason === "DUPLICATE_IDENTITY_CONFLICT") return none("DUPLICATE_IDENTITY_CONFLICT");
  if (candidate.collabCandidates?.length || ["COLLABORATION", "COLLAB_REVIEW"].includes(candidate.reviewReason)) return none("COLLAB_REVIEW");
  if (candidate.reviewReason === "ALIAS_CONFLICT") return none("ALIAS_CONFLICT");
  if (candidate.reviewReason === "RECENT_AUTO_SEEDED_REVIEW") return {
    ...none("RECENT_AUTO_SEEDED_REVIEW"),
    recommendedUiAction: candidate.confirmExistingBrandCode ? "CONFIRM_EXISTING" : null,
    reviewCanonicalTarget: candidate.confirmExistingBrandCode || null
  };
  if (candidate.reviewReason !== "UNRESOLVED" || candidate.canonicalName !== undefined) return none("UNKNOWN");
  const names = [candidate.rawBrandName, ...(candidate.cafe24Variants || []), ...(candidate.ecountVariants || [])].filter(Boolean);
  const claims = brand => [brand.brand_code, brand.brand_name, ...parseBrandAliases(brand.name_aliases), ...(brand.sourceCafe24Codes || [])].map(normalizeBrandKey);
  const verified = evidence.filter(item => item.candidateId === candidate.id && item.source &&
    Number.isInteger(item.cafe24ProductNo) && item.cafe24ProductNo > 0 &&
    normalizeBrandKey(item.ecountProductName) === normalizeBrandKey(`${candidate.rawBrandName} / ${item.exactProductTitle}`) &&
    candidate.relatedProductExamples?.some(name => normalizeBrandKey(name) === normalizeBrandKey(item.ecountProductName)));
  if (candidate.source === "ECOUNT" && !candidate.sourceBrandCode && verified.length === 1 &&
      names.every(name => normalizeBrandKey(name) === normalizeBrandKey(candidate.rawBrandName))) {
    const proof = verified[0];
    const targets = brands.filter(b => b.brand_code === proof.canonicalBrandCode);
    const possible = candidate.possibleExistingCanonical || [];
    if (targets.length === 1 && proof.canonicalNames.some(n => claims(targets[0]).includes(normalizeBrandKey(n))) &&
        possible.every(code => code === proof.canonicalBrandCode) &&
        !brands.some(b => b !== targets[0] && names.some(n => claims(b).includes(normalizeBrandKey(n)))) &&
        !aliases.some(a => names.some(n => normalizeBrandKey(n) === normalizeBrandKey(a.alias)) && a.brandId !== proof.canonicalBrandCode)) {
      return { operationalClass: "ECOUNT_ALIAS_GAP", recommendedUiAction: "LINK", reviewCanonicalTarget: proof.canonicalBrandCode, reviewEvidence: { ...proof } };
    }
  }
  const code = candidate.sourceBrandCode;
  const newClaims = [...names, code].filter(Boolean).map(normalizeBrandKey);
  if (["CAFE24", "BOTH"].includes(candidate.source) && code && code !== "B0000000" && names.length &&
      candidate.cafe24Variants?.length && !candidate.possibleExistingCanonical?.length &&
      !brands.some(b => claims(b).some(value => newClaims.includes(value))) &&
      !aliases.some(a => newClaims.includes(normalizeBrandKey(a.alias)))) {
    return { ...none("TRUE_NEW_BRAND"), recommendedUiAction: "NEW" };
  }
  return none("UNKNOWN");
}
