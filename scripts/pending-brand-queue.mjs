import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildBrandRegistry, resolveBrand, normalizeBrandKey, normalizeBrandName, parseBrandAliases, extractBracketBrandCandidate, extractSlashBrandCandidate } from "./brand-engine.mjs";
import { detectPersonalPayment } from "./load-ecount-offline-sales.mjs";
import { readEcountOfflineSalesSnapshot } from "./read-ecount-offline-sales-snapshot.mjs";
import { pendingBrandUiMetadata } from "./pending-brand-ui-metadata.mjs";
import { readWorkbenchSources, buildIdentityWorkbench } from "./brand-identity-workbench.mjs";
import { refreshBrandSourcingMaster, stripConsignmentPrefix } from "./build-brand-sourcing-master.mjs";
import { readEcountProductMaster } from "./ecount-product-master.mjs";
import { CODE_REUSE_REVIEW_REASON, cafe24CodeAudit, classifyCodeReuse } from "./cafe24-code-reuse.mjs";
import { SPLIT_ACTION, planCodeIdentitySplit } from "./code-identity-split.mjs";
import { planInternalRekey } from "./identity-rekey.mjs";
import { buildBrandSourcingMaster, loadInputs as loadSourcingInputs } from "./build-brand-sourcing-master.mjs";

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

export async function readPendingBrands(workDir, { reviewEligibility = false } = {}) {
  const queue = await readJson(join(workDir, "pending-brand-queue.json"), { version: 1, candidates: [] });
  if (queue.version !== 1 || !Array.isArray(queue.candidates) || queue.candidates.some(c => !c.id || !["PENDING", "APPROVED", "LINKED", "IGNORED"].includes(c.status))) throw new Error("Invalid pending brand queue");
  if (reviewEligibility) {
    const canonical = await readJson(join(workDir, "brand-master.json"), null);
    const aliases = await readJson(join(workDir, "intelligence/brand-aliases.json"), []);
    const workbenchSources = queue.candidates.some(c => c.reviewReason === "CODE_NAME_CONFLICT") ? await readWorkbenchSources(workDir) : null;
    return { ...queue, candidates: queue.candidates.map(candidate => {
      const response = { ...candidate, confirmExistingBrandCode: confirmExistingTarget(canonical, candidate, aliases)?.brand_code || null };
      return { ...response, uiReview: { ...pendingBrandUiMetadata(response, canonical, aliases), ...(workbenchSources ? { workbench: buildIdentityWorkbench(response, canonical, workbenchSources) } : {}) } };
    }) };
  }
  return queue;
}

function candidateFrom(row, source) {
  const productName = row.product_name || row.productName || row.name || "";
  const explicit = row.rawBrandName || row.brand_name || row.brandName || row.BRAND || "";
  const parsed = extractBracketBrandCandidate(explicit || productName) || extractSlashBrandCandidate(explicit || productName);
  const structured = Array.isArray(row.candidates) && row.candidates.length > 1 ? row.candidates.map(normalizeBrandName).join(" X ") : "";
  const raw = normalizeBrandName(structured || (parsed?.type === "collab" ? parsed.candidates.join(" X ") : parsed?.candidate) || explicit || "");
  const collaboration = extractBracketBrandCandidate(`[${raw}]`);
  return { source, rawBrandName: raw, sourceBrandCode: source === "CAFE24" ? String(row.brand_code || row.brandCode || row.code || "").trim() : null,
    productName, productId: String(row.product_no || row.productNo || row.productCode || row.ecountProdCd || productName),
    collabCandidates: collaboration?.type === "collab" ? collaboration.candidates : [] };
}

// Normalized names with non-collaboration ECOUNT evidence (sales lines + product master),
// built once per source arrays. The auto-safe check runs for every candidate; re-parsing all
// 14,842 product rows each time blocked the event loop past Render's 5 s health check (2026-10-06).
// ponytail: keyed by array identity; rebuild if a caller ever mutates the arrays in place.
const NO_ROWS = Object.freeze([]);
const ecountEvidenceCache = new WeakMap();
function ecountEvidenceNames(lines, products = NO_ROWS) {
  let byProducts = ecountEvidenceCache.get(lines);
  if (!byProducts) ecountEvidenceCache.set(lines, (byProducts = new WeakMap()));
  let names = byProducts.get(products);
  if (!names) {
    names = new Set();
    for (const row of [...lines, ...products]) {
      if (row.isPersonalPayment || detectPersonalPayment(row.customerName).isPersonalPayment || /^QQQ/i.test(String(row.productCode || row.ecountProdCd || ""))) continue;
      const c = candidateFrom(row, "ECOUNT");
      if (!c.collabCandidates.length) names.add(normalizeBrandKey(c.rawBrandName));
    }
    byProducts.set(products, names);
  }
  return names;
}

// Fresh source rows, not persisted BOTH/eligibility hints, authorize onboarding.
export function isAutoSafePendingDecision(candidate, canonical, sources) {
  const brands = Array.isArray(canonical) ? canonical : canonical?.brands;
  if (!Array.isArray(brands) || !Array.isArray(sources?.cafe24Brands) || !Array.isArray(sources?.ecountLines) ||
      candidate.status !== "PENDING" || candidate.source !== "BOTH" || candidate.heldAt || candidate.requiresIdentitySplit ||
      candidate.collabCandidates?.length || candidate.relatedCandidateIds?.length ||
      !["UNRESOLVED", "CODE_NAME_CONFLICT", "INACTIVE_CODE_REUSED"].includes(candidate.reviewReason)) return null;
  const code = normalizeBrandKey(candidate.sourceBrandCode);
  const name = normalizeBrandKey(candidate.rawBrandName);
  if (!code || code === "B0000000" || !name || candidate.rawBrandName.length > 200 ||
      extractBracketBrandCandidate(`[${candidate.rawBrandName}]`)?.type === "collab") return null;
  const live = sources.cafe24Brands.map(row => candidateFrom({ ...row, brand_name: row.brand_name || row.brandName || row.name }, "CAFE24"));
  const current = live.filter(row => normalizeBrandKey(row.sourceBrandCode) === code);
  if (!current.length || current.some(row => normalizeBrandKey(row.rawBrandName) !== name || row.collabCandidates.length) ||
      live.some(row => normalizeBrandKey(row.rawBrandName) === name && normalizeBrandKey(row.sourceBrandCode) !== code)) return null;
  const products = (sources.products || []).map(row => candidateFrom(row, "CAFE24"));
  if (products.some(row => (normalizeBrandKey(row.sourceBrandCode) === code && normalizeBrandKey(row.rawBrandName) !== name) ||
      (normalizeBrandKey(row.rawBrandName) === name && normalizeBrandKey(row.sourceBrandCode) !== code))) return null;
  // Current ECOUNT product master counts as ECOUNT evidence; sales are optional.
  if (!ecountEvidenceNames(sources.ecountLines, sources.ecountProducts || NO_ROWS).has(name) ||
      [...(candidate.cafe24Variants || []), ...(candidate.ecountVariants || [])].some(n => normalizeBrandKey(n) !== name)) return null;
  const owners = brands.filter(b => normalizeBrandKey(b.brand_code) === code);
  if (owners.length > 1 || owners.some(b => b.active !== false || b.supersededBy)) return null;
  const legacy = owners[0];
  for (const b of brands) {
    const names = [b.brand_name, ...parseBrandAliases(b.name_aliases)].map(normalizeBrandKey);
    const codes = [b.brand_code, ...(b.sourceCafe24Codes || [])].map(normalizeBrandKey);
    if (names.includes(name) || codes.includes(name) || names.includes(code) || (b !== legacy && codes.includes(code))) return null;
  }
  if ((sources.aliases || []).some(a => normalizeBrandKey(a.alias) === name ||
      (normalizeBrandKey(a.alias) === code && a.brandId !== legacy?.brand_code)) ||
      (sources.compatibility || []).some(b => normalizeBrandKey(b.name) === name ||
        (normalizeBrandKey(b.id) === code && b.id !== legacy?.brand_code))) return null;
  return { action: legacy ? "REASSIGN_INACTIVE_CODE" : "NEW", ...(legacy ? { legacyBrandCode: legacy.brand_code } : {}) };
}

// Detection is deliberately separate from attribution: no resolver consumes this queue.
export function detectPendingBrands({ canonical, compatibility = [], aliases = [], cafe24Brands = [], products = [], ecountLines = [], ecountProducts = [], previous = { candidates: [] }, recentReview = null, now = new Date().toISOString() }) {
  if (!(Array.isArray(canonical) || Array.isArray(canonical?.brands)) ||
      [compatibility, aliases, cafe24Brands, products, ecountLines, ecountProducts, previous.candidates].some(value => !Array.isArray(value))) throw new Error("Invalid pending brand detection source");
  const registry = buildBrandRegistry(canonical);
  const compat = buildBrandRegistry({ brands: compatibility.map(b => ({ brand_code: b.id, brand_name: b.name, active: b.active, name_aliases: aliases.filter(a => a.brandId === b.id).map(a => a.alias) })) });
  const conflicts = new Set();
  const owners = new Map();
  for (const r of [registry, compat]) for (const b of r.brands) for (const name of [b.name, ...b.aliases]) {
    const key = normalizeBrandKey(name);
    if (!key) continue;
    if (owners.has(key) && owners.get(key) !== b.id) conflicts.add(key);
    else owners.set(key, b.id);
  }
  const knownCodes = new Set(registry.brands.map(b => normalizeBrandKey(b.id)));
  const activelyOwnedCodes = new Set(registry.brands.filter(b => b.active !== false).map(b => normalizeBrandKey(b.id)));
  const canonicalRows = Array.isArray(canonical) ? canonical : canonical.brands;
  const liveByCode = new Map(cafe24Brands.map(b => [normalizeBrandKey(b.brand_code || b.brandCode || b.code), b]));
  // Explicit, bounded audit input, not a permanent list or suggested-only rule.
  const validReviewDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (recentReview !== null && (!recentReview || !Array.isArray(recentReview.codes) || recentReview.codes.length > canonicalRows.length ||
      recentReview.codes.some(c => typeof c !== "string" || !knownCodes.has(normalizeBrandKey(c))) ||
      !validReviewDate(recentReview.since) || !validReviewDate(recentReview.through) || recentReview.since > recentReview.through ||
      typeof recentReview.evidence !== "string" || !recentReview.evidence.trim() || recentReview.evidence.length > 1000)) invalidDecision("Invalid recent review evidence");
  const codeEvidence = new Map();
  for (const [code, live] of liveByCode) {
    const b = canonicalRows.find(b => normalizeBrandKey(b.brand_code) === code && b.active !== false);
    if (!b || code === normalizeBrandKey("B0000000")) continue;
    const currentName = normalizeBrandName(live.brand_name || live.brandName || live.name || "");
    if (!currentName) continue;
    const key = normalizeBrandKey(currentName);
    const sameName = [b.brand_name, ...parseBrandAliases(b.name_aliases)].some(n => normalizeBrandKey(n) === key);
    const safe = sameName && !conflicts.has(key);
    const created = typeof live.created_date === "string" && Number.isFinite(Date.parse(live.created_date)) ? live.created_date : null;
    const reviewed = previous.candidates.some(c => c.status !== "PENDING" && normalizeBrandKey(c.sourceBrandCode) === code &&
      [c.rawBrandName, ...(c.cafe24Variants || [])].some(n => normalizeBrandKey(n) === key));
    const recent = !reviewed && b.nameSource === "suggested" && recentReview?.codes.some(c => normalizeBrandKey(c) === code) &&
      created && created.slice(0, 10) >= recentReview.since && created.slice(0, 10) <= recentReview.through;
    if (!safe || recent) codeEvidence.set(code, { reviewReason: !sameName ? "CODE_NAME_CONFLICT" : !safe ? "ALIAS_CONFLICT" : "RECENT_AUTO_SEEDED_REVIEW",
      canonicalName: b.brand_name, canonicalAliases: parseBrandAliases(b.name_aliases), cafe24Name: currentName,
      cafe24ProductCount: Number.isInteger(live.product_count) && live.product_count >= 0 ? live.product_count : null,
      sourceCreatedAt: created, ...(recent ? { recentReviewEvidence: { ...recentReview, codes: [b.brand_code] } } : {}) });
  }
  const observations = [];
  const excluded = [];
  // Built once per scan instead of per row: with 14,842 product-master rows the per-row
  // re-normalization of every previous candidate blocked the event loop for seconds on Render.
  const reviewedCafe24Codes = new Set(previous.candidates.map(p => normalizeBrandKey(p.sourceBrandCode)));
  const reviewedEcountNames = new Set(previous.candidates.flatMap(p => [p.rawBrandName, ...(p.ecountVariants || [])]).map(name => normalizeBrandKey(name)));
  const resolved = new Map();
  const resolveOnce = raw => {
    if (!resolved.has(raw)) resolved.set(raw, resolveBrand(raw, registry) || resolveBrand(raw, compat));
    return resolved.get(raw);
  };
  // Product master rows only corroborate a Cafe24 brand (sales-free BOTH). They never
  // open ECOUNT-only candidates: free-text PROD_DES would flood the queue with item names.
  for (const [source, rows, corroborateOnly] of [["CAFE24", cafe24Brands.map(b => ({ ...b, brand_name: b.brand_name || b.brandName || b.name }))], ["CAFE24", products], ["ECOUNT", ecountLines], ["ECOUNT", ecountProducts, true]]) {
    for (const row of rows) {
      const c = candidateFrom(row, source);
      const evidence = source === "CAFE24" ? codeEvidence.get(normalizeBrandKey(c.sourceBrandCode)) : null;
      if (evidence) c.rawBrandName = evidence.cafe24Name;
      const qqq = /^QQQ/i.test(String(row.productCode || row.ecountProdCd || "")) || /^QQQ(?:\s|$|\/)/i.test(c.rawBrandName || c.productName);
      if (qqq || (source === "ECOUNT" && (row.isPersonalPayment === true || detectPersonalPayment(row.customerName).isPersonalPayment))) {
        excluded.push({ source, reason: qqq ? "QQQ" : "PERSONAL_PAYMENT" }); continue;
      }
      const reviewedObservation = source === "CAFE24"
        ? reviewedCafe24Codes.has(normalizeBrandKey(c.sourceBrandCode))
        : reviewedEcountNames.has(normalizeBrandKey(c.rawBrandName));
      if (source === "CAFE24" && (!c.sourceBrandCode || c.sourceBrandCode === "B0000000" || (activelyOwnedCodes.has(normalizeBrandKey(c.sourceBrandCode)) && !reviewedObservation && !evidence))) continue;
      if (source === "ECOUNT" && !c.rawBrandName) continue;
      const key = normalizeBrandKey(c.rawBrandName);
      const hit = conflicts.has(key) ? null : resolveOnce(c.rawBrandName);
      // A grandfathered exact whole collaboration name is already accepted;
      // never resolve its individual participants to a single brand.
      if (source === "ECOUNT" && hit && !reviewedObservation) continue;
      observations.push({ ...c, ...(corroborateOnly ? { corroborateOnly } : {}), reviewReason: c.collabCandidates.length ? "COLLABORATION" : conflicts.has(key) ? "ALIAS_CONFLICT" : "UNRESOLVED", possibleExistingCanonical: hit && knownCodes.has(normalizeBrandKey(hit.brandId)) ? [hit.brandId] : [], ...(evidence || {}) });
    }
  }
  const cafe24Keys = new Set(observations.filter(c => c.source === "CAFE24").map(c => normalizeBrandKey(c.rawBrandName)));
  for (let i = observations.length - 1; i >= 0; i--) {
    if (observations[i].corroborateOnly && !cafe24Keys.has(normalizeBrandKey(observations[i].rawBrandName))) observations.splice(i, 1);
  }
  // A Cafe24 code is the stable key. Join ECOUNT spelling only when there is exactly
  // one such code; equal display names must not merge competing Cafe24 identities.
  const codesByName = new Map();
  const cafe24Names = observations.filter(c => c.source === "CAFE24");
  for (const c of previous.candidates) if (c.sourceBrandCode) {
    for (const rawBrandName of [c.rawBrandName, ...c.cafe24Variants, ...c.ecountVariants]) cafe24Names.push({ sourceBrandCode: c.sourceBrandCode, rawBrandName });
  }
  for (const c of cafe24Names) {
    const key = normalizeBrandKey(c.rawBrandName);
    if (!key) continue;
    if (!codesByName.has(key)) codesByName.set(key, new Set());
    codesByName.get(key).add(normalizeBrandKey(c.sourceBrandCode));
  }
  const candidates = new Map(previous.candidates.map(c => [c.id, structuredClone(c)]));
  const seenProducts = new Map();
  const observedIds = new Set();
  for (const c of observations) {
    const codes = codesByName.get(normalizeBrandKey(c.rawBrandName));
    const code = c.sourceBrandCode || (codes?.size === 1 ? [...codes][0] : null);
    const identity = code ? `cafe24:${normalizeBrandKey(code)}` : `ecount:${normalizeBrandKey(c.rawBrandName)}`;
    const prior = [...candidates.values()].filter(p => (p.status === "PENDING" ||
      [p.rawBrandName, ...(p.cafe24Variants || []), ...(p.ecountVariants || [])].some(n => normalizeBrandKey(n) === normalizeBrandKey(c.rawBrandName))) && (code ?
      normalizeBrandKey(p.sourceBrandCode) === normalizeBrandKey(code) || (!p.sourceBrandCode && codes?.size === 1 && normalizeBrandKey(p.rawBrandName) === normalizeBrandKey(c.rawBrandName)) :
      !p.sourceBrandCode && normalizeBrandKey(p.rawBrandName) === normalizeBrandKey(c.rawBrandName)));
    const priorCode = code && prior.find(p => normalizeBrandKey(p.sourceBrandCode) === normalizeBrandKey(code));
    const baseId = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    const id = prior.length === 1 ? prior[0].id : priorCode?.id || (candidates.has(baseId) && candidates.get(baseId).status !== "PENDING"
      ? createHash("sha256").update(`${identity}:${normalizeBrandKey(c.rawBrandName)}`).digest("hex").slice(0, 24) : baseId);
    observedIds.add(id);
    const candidate = candidates.get(id) || { id, detectedAt: now, source: c.source, rawBrandName: c.rawBrandName, sourceBrandCode: c.sourceBrandCode,
      cafe24Variants: [], ecountVariants: [], relatedProductCount: 0, relatedProductExamples: [], possibleExistingCanonical: [], status: "PENDING" };
    candidate.lastSeenAt = now;
    if (candidate.source !== c.source) candidate.source = "BOTH";
    candidate.sourceBrandCode ||= c.sourceBrandCode;
    candidate.rawBrandName ||= c.rawBrandName;
    const variants = c.source === "CAFE24" ? candidate.cafe24Variants : candidate.ecountVariants;
    if (c.rawBrandName && !variants.includes(c.rawBrandName)) variants.push(c.rawBrandName);
    if (candidate.status === "PENDING") {
      if (c.canonicalName !== undefined) {
        for (const field of ["canonicalName", "canonicalAliases", "cafe24Name", "cafe24ProductCount", "sourceCreatedAt", "recentReviewEvidence"]) {
          if (c[field] !== undefined) candidate[field] = structuredClone(c[field]);
        }
        candidate.reviewReason = c.reviewReason;
      } else if (!["CODE_NAME_CONFLICT", "RECENT_AUTO_SEEDED_REVIEW"].includes(candidate.reviewReason) && (!candidate.reviewReason || c.reviewReason !== "UNRESOLVED")) candidate.reviewReason = c.reviewReason;
    }
    candidate.collabCandidates = [...new Set([...(candidate.collabCandidates || []), ...c.collabCandidates])];
    candidate.possibleExistingCanonical = [...new Set([...candidate.possibleExistingCanonical, ...c.possibleExistingCanonical])];
    if (!seenProducts.has(id)) seenProducts.set(id, new Set());
    if (c.productName) {
      seenProducts.get(id).add(`${c.source}:${c.productId}`);
      if (candidate.relatedProductExamples.length < 5 && !candidate.relatedProductExamples.includes(c.productName)) candidate.relatedProductExamples.push(c.productName);
    }
    candidate.relatedProductCount = Math.max(candidate.relatedProductCount, seenProducts.get(id).size);
    candidates.set(id, candidate);
  }
  const all = [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id));
  // Do not merge ambiguous source-code ownership; expose exact-name relations.
  for (const candidate of all.filter(c => c.status === "PENDING")) {
    const names = new Set([candidate.rawBrandName, ...(candidate.cafe24Variants || []), ...(candidate.ecountVariants || [])].map(normalizeBrandKey));
    candidate.relatedCandidateIds = all.filter(c => c.id !== candidate.id &&
      ((candidate.sourceBrandCode && normalizeBrandKey(c.sourceBrandCode) === normalizeBrandKey(candidate.sourceBrandCode)) ||
      [c.rawBrandName, ...(c.cafe24Variants || []), ...(c.ecountVariants || [])].some(n => names.has(normalizeBrandKey(n))))).map(c => c.id);
  }
  for (const candidate of all.filter(c => observedIds.has(c.id))) {
    // A Cafe24 code owned by a different, inactive canonical identity is code reuse: it needs an
    // old/new identity split (manual), never an in-place reassignment. Re-evaluated every scan.
    const owners = candidate.status === "PENDING" && candidate.sourceBrandCode
      ? canonicalRows.filter(b => normalizeBrandKey(b.brand_code) === normalizeBrandKey(candidate.sourceBrandCode)) : [];
    const reuse = owners.length === 1 && owners[0].active === false && !owners[0].supersededBy
      ? classifyCodeReuse({ candidateName: candidate.rawBrandName, code: candidate.sourceBrandCode, owner: owners[0], cafe24Brands, products, ecountProducts, ecountLines }) : null;
    if (reuse) {
      Object.assign(candidate, reuse, { reviewReason: CODE_REUSE_REVIEW_REASON });
      for (const field of ["canonicalName", "canonicalAliases", "recentReviewEvidence"]) delete candidate[field];
      continue;
    }
    const decision = isAutoSafePendingDecision(candidate, canonical, { cafe24Brands, products, ecountLines, ecountProducts, aliases, compatibility });
    if (decision?.action === "REASSIGN_INACTIVE_CODE") {
      candidate.reviewReason = "INACTIVE_CODE_REUSED";
      for (const field of ["canonicalName", "canonicalAliases", "recentReviewEvidence"]) delete candidate[field];
    }
  }
  const observed = all.filter(c => observedIds.has(c.id));
  return { version: 1, updatedAt: now, candidates: all,
    ...(cafe24Brands.length ? { audit: cafe24CodeAuditSummary(cafe24CodeAudit(canonicalRows, cafe24Brands, { products, ecountProducts, ecountLines })) } : {}),
    scan: { observed: observed.length,
    cafe24: observed.filter(c => c.source === "CAFE24").length, ecount: observed.filter(c => c.source === "ECOUNT").length,
    both: observed.filter(c => c.source === "BOTH").length, review: observed.filter(c => c.reviewReason !== "UNRESOLVED").length,
    excluded: excluded.length, exclusions: excluded } };
}

export async function loadPendingBrandSources(workDir, month) {
  const canonical = await readJson(join(workDir, "brand-master.json"), { brands: [] });
  const compatibility = await readJson(join(workDir, "intelligence/brand-master-list.json"), []);
  const aliases = await readJson(join(workDir, "intelligence/brand-aliases.json"), []);
  const catalog = await readJson(join(workDir, "cafe24-product-catalog.json"), {});
  const products = Array.isArray(catalog) ? catalog : Array.isArray(catalog.products) ? catalog.products : Object.values(catalog.products || {});
  const snapshot = await readEcountOfflineSalesSnapshot(month, { workDir });
  const ecountMaster = await readEcountProductMaster(workDir);
  const ecountProducts = (ecountMaster?.products || []).map(p => ({ productName: stripConsignmentPrefix(p.productName), productCode: p.productCode }));
  return { canonical, compatibility, aliases, products, ecountLines: snapshot?.salesLines || [], ecountProducts, provenance: { month, productCount: products.length, ecountLineCount: snapshot?.salesLines?.length || 0,
    ecountProductCount: ecountProducts.length, ecountProductsAt: ecountMaster?.fetchedAt || null, ecountProductSource: ecountMaster?.source || null, ecountAvailable: Boolean(snapshot), catalogGeneratedAt: catalog.generatedAt || catalog.updatedAt || null, ecountSources: snapshot?.sources || [], ecountImportedAt: snapshot?.importedAt || null } };
}

// Serialize refresh and review writes. Queue-only is the default; explicit
// onboarding uses the same decision transaction. ponytail: single-process writer; use a
// cross-process lock if multiple server processes ever share this work directory.
let refreshTail = Promise.resolve();
export function withPendingBrandWrite(task) {
  const result = refreshTail.catch(() => {}).then(task);
  refreshTail = result;
  return result;
}
// Every bulk/automatic approval (refresh autoApprove, ECOUNT import hook, daily auto-sync)
// approves NEW only. Inactive-code reassignment and every other action need an explicit
// per-candidate POST /api/pending-brands/review. Enforced inside refreshPendingBrands.
export const UNATTENDED_AUTO_APPROVE_ACTIONS = Object.freeze(["NEW"]);
export function refreshPendingBrandsUnattended(workDir, loadSources, { buildCompatibility } = {}) {
  return refreshPendingBrands(workDir, loadSources, { autoApprove: true, buildCompatibility });
}

export function refreshPendingBrands(workDir, loadSources, { dryRun = false, autoApprove = false, buildCompatibility } = {}) {
  return withPendingBrandWrite(async () => {
    const sources = await loadSources();
    const result = detectPendingBrands({ ...sources, previous: await readPendingBrands(workDir) });
    result.provenance = sources.provenance || null;
    if (!dryRun) {
      await mkdir(workDir, { recursive: true });
      const file = join(workDir, "pending-brand-queue.json");
      const temp = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temp, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" }); await rename(temp, file); }
      finally { await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    }
    if (!dryRun && autoApprove) {
      const onboarding = [];
      for (const candidate of result.candidates) {
        const canonical = await readJson(join(workDir, "brand-master.json"), null);
        const decision = isAutoSafePendingDecision(candidate, canonical, sources);
        if (!decision || !UNATTENDED_AUTO_APPROVE_ACTIONS.includes(decision.action)) continue;
        try {
          onboarding.push(await reviewPendingBrandUnlocked(workDir, { id: candidate.id, action: decision.action, brandName: candidate.rawBrandName }, buildCompatibility, { sources }));
        } catch (error) {
          onboarding.push({ ok: false, id: candidate.id, error: error.message });
        }
      }
      return { ...result, ...(await readPendingBrands(workDir)), onboarding, dryRun };
    }
    return { ...result, dryRun };
  });
}

function invalidDecision(message) { throw Object.assign(new Error(message), { status: 400 }); }

export function approvedCafe24BrandCode(code, canonical, period = null) {
  const brands = Array.isArray(canonical) ? canonical : canonical?.brands || [];
  const owners = brands.filter(b => b.brand_code === code);
  // Split identities (SPLIT_CODE_IDENTITY): the new owner holds the code from externalCodes.cafe24.since;
  // earlier periods go to the former owner whose formerCodes interval covers them, crossings are UNASSIGNED.
  const since = owners.length === 1 ? owners[0].externalCodes?.cafe24?.since : null;
  if (since && period?.since && period?.until) {
    if (period.until.slice(0, 7) < since) {
      const former = brands.filter(b => (b.formerCodes || []).some(f => f.code === code && f.until && period.until.slice(0, 7) <= f.until));
      return former.length === 1 ? former[0].brand_code : "UNASSIGNED";
    }
    if (period.since.slice(0, 7) < since) return "UNASSIGNED";
  }
  if (owners.length) {
    const owner = owners[0];
    const transition = owner.supersededBy;
    const matches = brands.filter(b => b.active !== false && b.sourceCafe24Codes?.includes(code));
    if (owners.length !== 1 || owner.active !== false || !transition ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(transition.effectiveMonth || "") || matches.length !== 1 ||
        matches[0].brand_code !== transition.brandCode) return code;
    // Saved prior months keep their original identity. A cross-boundary range
    // cannot safely attribute one product total to either identity.
    if (period) {
      if (!period.since || !period.until) return code;
      if (period.until.slice(0, 7) < transition.effectiveMonth) return code;
      if (period.since.slice(0, 7) < transition.effectiveMonth) return "UNASSIGNED";
    }
    return matches[0].brand_code;
  }
  const matches = brands.filter(b => b.sourceCafe24Codes?.includes(code));
  return matches.length === 1 ? matches[0].brand_code : code;
}

// Shared by read-only UI eligibility and write-time validation. No new aliases.
function confirmExistingTarget(canonical, candidate, aliases) {
  const brands = Array.isArray(canonical) ? canonical : canonical?.brands || [];
  if (candidate.status !== "PENDING" || candidate.reviewReason !== "RECENT_AUTO_SEEDED_REVIEW" ||
      !candidate.sourceBrandCode || candidate.relatedCandidateIds?.length || candidate.collabCandidates?.length) return null;
  const targets = brands.filter(b => normalizeBrandKey(b.brand_code) === normalizeBrandKey(candidate.sourceBrandCode));
  if (targets.length !== 1) return null;
  const target = targets[0];
  const accepted = new Set([target.brand_name, ...parseBrandAliases(target.name_aliases)].map(normalizeBrandKey).filter(Boolean));
  const names = [candidate.rawBrandName, candidate.cafe24Name, ...(candidate.cafe24Variants || []), ...(candidate.ecountVariants || [])];
  if (!candidate.rawBrandName || !candidate.cafe24Name || names.some(name => !accepted.has(normalizeBrandKey(name)) ||
      extractBracketBrandCandidate(`[${name}]`)?.type === "collab")) return null;
  for (const name of names) {
    const key = normalizeBrandKey(name);
    if (brands.some(b => b !== target && [b.brand_code, b.brand_name, ...parseBrandAliases(b.name_aliases), ...(b.sourceCafe24Codes || [])].some(n => normalizeBrandKey(n) === key)) ||
        aliases.some(a => normalizeBrandKey(a.alias) === key && a.brandId !== target.brand_code)) return null;
  }
  return target;
}

// Pure prevalidation: no source file is touched until every alias/target is valid.
export function planPendingBrandDecision(canonical, queue, input, now = new Date().toISOString(), aliases = [], sources = null) {
  if (!input || !["NEW", "LINK", "IGNORE", "HOLD", "CONFIRM_EXISTING", "REASSIGN_INACTIVE_CODE"].includes(input.action) || typeof input.id !== "string") invalidDecision("Invalid pending brand decision");
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 1000)) invalidDecision("Invalid review note");
  const nextQueue = structuredClone(queue);
  const candidate = nextQueue.candidates.find(c => c.id === input.id);
  if (!candidate) invalidDecision("Pending brand candidate not found");
  if (candidate.status !== "PENDING") invalidDecision("Candidate already reviewed");
  const nextCanonical = structuredClone(canonical);
  const brands = Array.isArray(nextCanonical) ? nextCanonical : nextCanonical.brands;
  if (!Array.isArray(brands)) invalidDecision("Invalid canonical Brand Master");
  const codeConflict = candidate.reviewReason === "CODE_NAME_CONFLICT";
  if (codeConflict && input.action === "NEW") invalidDecision("Code reassignment requires a separate historical identity review");
  if (input.action === "HOLD") {
    Object.assign(candidate, { heldAt: now, note: input.note || "" });
    nextQueue.updatedAt = now;
    return { canonical: nextCanonical, queue: nextQueue, candidate };
  }
  let target;
  if (input.action === "REASSIGN_INACTIVE_CODE") {
    if (candidate.requiresIdentitySplit) invalidDecision("Cafe24 code reuse requires an identity split, not REASSIGN_INACTIVE_CODE");
    const decision = isAutoSafePendingDecision(candidate, canonical, sources && { ...sources, aliases });
    if (decision?.action !== input.action) invalidDecision("Current source evidence is not eligible for inactive code reassignment");
    const code = `MANUAL_${candidate.id}`;
    if (brands.some(b => normalizeBrandKey(b.brand_code) === normalizeBrandKey(code))) invalidDecision("Canonical code already exists");
    target = { brand_code: code, brand_name: normalizeBrandName(candidate.rawBrandName), name_aliases: [], instagram_tag: "", active: true, nameSource: "confirmed", sourceCafe24Codes: [candidate.sourceBrandCode] };
    const legacy = brands.find(b => b.brand_code === decision.legacyBrandCode);
    legacy.supersededBy = { brandCode: code, effectiveMonth: new Date(now).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7) };
    brands.push(target);
    if (!Array.isArray(nextCanonical)) nextCanonical.updatedAt = now;
  } else if (input.action === "CONFIRM_EXISTING") {
    target = confirmExistingTarget(canonical, candidate, aliases);
    if (!target || input.canonicalBrandCode !== target.brand_code) invalidDecision("Candidate is not eligible for CONFIRM_EXISTING or canonical target mismatched");
  } else if (input.action !== "IGNORE") {
    const name = typeof input.brandName === "string" ? normalizeBrandName(input.brandName) : "";
    if (input.action === "NEW" && (!name || name.length > 200)) invalidDecision("Canonical brand name required (max 200 characters)");
    if (input.action === "LINK") {
      target = brands.find(b => b.brand_code === input.canonicalBrandCode);
      if (!target) invalidDecision("Canonical target not found");
      if (codeConflict && normalizeBrandKey(target.brand_code) === normalizeBrandKey(candidate.sourceBrandCode)) invalidDecision("Cannot alias a changed identity onto its conflicting code owner");
    } else {
      const code = candidate.sourceBrandCode || `MANUAL_${candidate.id}`;
      if (brands.some(b => normalizeBrandKey(b.brand_code) === normalizeBrandKey(code))) invalidDecision("Canonical code already exists");
      target = { brand_code: code, brand_name: name, name_aliases: [], instagram_tag: "", active: true, nameSource: "confirmed" };
    }
    const aliases = [...new Set([candidate.rawBrandName, ...(candidate.cafe24Variants || []), ...(candidate.ecountVariants || []), codeConflict ? null : candidate.sourceBrandCode].filter(Boolean))];
    if (codeConflict) {
      const accepted = new Set([target.brand_name, ...parseBrandAliases(target.name_aliases)].map(normalizeBrandKey));
      if (aliases.some(name => !accepted.has(normalizeBrandKey(name)))) invalidDecision("New aliases for code conflicts require a separate historical identity review");
    }
    // Compare all claims, including inactive/grandfathered entries. Never pick a
    // preferred owner or let a registry's ambiguity fallback approve a conflict.
    for (const value of [target.brand_name, ...aliases]) {
      const key = normalizeBrandKey(value);
      for (const brand of brands) {
        if (brand.brand_code === target.brand_code) continue;
        const claims = [brand.brand_code, brand.brand_name, ...parseBrandAliases(brand.name_aliases), ...(brand.sourceCafe24Codes || [])];
        if (claims.some(claim => normalizeBrandKey(claim) === key)) invalidDecision(`Alias conflict: ${value}`);
      }
    }
    if (!codeConflict) target.name_aliases = [...new Set([...parseBrandAliases(target.name_aliases), ...aliases])];
    if (!codeConflict && candidate.sourceBrandCode && candidate.sourceBrandCode !== target.brand_code) {
      target.sourceCafe24Codes = [...new Set([...(target.sourceCafe24Codes || []), candidate.sourceBrandCode])];
    }
    if (input.action === "NEW") brands.push(target);
    if (!codeConflict && !Array.isArray(nextCanonical)) nextCanonical.updatedAt = now;
  }
  Object.assign(candidate, { status: { NEW: "APPROVED", REASSIGN_INACTIVE_CODE: "APPROVED", LINK: "LINKED", IGNORE: "IGNORED", CONFIRM_EXISTING: "APPROVED" }[input.action], approvalAction: input.action,
    approvedAt: now, canonicalBrandCode: target?.brand_code || null, note: input.note || "" });
  nextQueue.updatedAt = now;
  return { canonical: nextCanonical, queue: nextQueue, candidate };
}

export function reviewPendingBrand(workDir, input, buildCompatibility, options = {}) {
  return withPendingBrandWrite(() => reviewPendingBrandUnlocked(workDir, input, buildCompatibility, options));
}

async function reviewPendingBrandUnlocked(workDir, input, buildCompatibility, { replace = rename, sources = null } = {}) {
    const canonicalFile = join(workDir, "brand-master.json");
    const canonical = await readJson(canonicalFile, null);
    const aliases = await readJson(join(workDir, "intelligence/brand-aliases.json"), []);
    const result = planPendingBrandDecision(canonical, await readPendingBrands(workDir), input, new Date().toISOString(), aliases, sources);
    const files = [];
    if (!["IGNORE", "HOLD", "CONFIRM_EXISTING"].includes(input.action) && (input.action === "REASSIGN_INACTIVE_CODE" || result.candidate.reviewReason !== "CODE_NAME_CONFLICT")) {
      const existingAliases = await readJson(join(workDir, "intelligence/brand-aliases.json"), []);
      const target = (Array.isArray(result.canonical) ? result.canonical : result.canonical.brands).find(b => b.brand_code === result.candidate.canonicalBrandCode);
      const claims = new Set([target.brand_name, ...parseBrandAliases(target.name_aliases)].map(normalizeBrandKey));
      for (const alias of existingAliases) {
        if (claims.has(normalizeBrandKey(alias.alias)) && alias.brandId !== target.brand_code) invalidDecision(`Compatibility alias conflict: ${alias.alias}`);
      }
      // Reuse the existing canonical -> compatibility builder; do not introduce
      // another approval authority or a derived alias that disappears on restart.
      const derived = buildCompatibility(Array.isArray(result.canonical) ? result.canonical : result.canonical.brands);
      files.push([join(workDir, "intelligence/brand-master-list.json"), derived.brands],
        [join(workDir, "intelligence/brand-aliases.json"), derived.aliases], [canonicalFile, result.canonical]);
    }
    files.push([join(workDir, "pending-brand-queue.json"), result.queue]);
    await writeFilesAtomically(files, { replace });
    let sourcingRefresh;
    if (["NEW", "REASSIGN_INACTIVE_CODE"].includes(input.action)) {
      try {
        const sourcing = await refreshBrandSourcingMaster(workDir);
        sourcingRefresh = { ok: true, brands: sourcing.brands.length, generatedAt: sourcing.generatedAt };
      } catch (error) {
        sourcingRefresh = { ok: false, error: error.message };
      }
    }
    return { ok: true, candidate: result.candidate, ...(sourcingRefresh ? { sourcingRefresh } : {}) };
}

// All-or-nothing replacement of several JSON files: every target is staged first, then replaced;
// any failure restores the files already replaced from their backups.
async function writeFilesAtomically(files, { replace = rename } = {}) {
    const prepared = [];
    const replaced = [];
    let rollbackFailed = false;
    try {
      for (const [file, data] of files) {
        const before = await readFile(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
        const temp = `${file}.${randomUUID()}.tmp`;
        const backup = `${file}.${randomUUID()}.rollback`;
        const entry = { file, temp, backup, before };
        prepared.push(entry);
        await mkdir(resolve(file, ".."), { recursive: true });
        if (before !== null) await writeFile(backup, before, { flag: "wx" });
        await writeFile(temp, Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
      }
      for (const entry of prepared) { await replace(entry.temp, entry.file); replaced.push(entry); }
    } catch (error) {
      const rollbackErrors = [];
      for (const entry of replaced.reverse()) {
        try {
          if (entry.before === null) await unlink(entry.file);
          else await rename(entry.backup, entry.file);
        } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
      rollbackFailed = rollbackErrors.length > 0;
      if (rollbackFailed) throw new AggregateError([error, ...rollbackErrors], "Brand review rollback failed; preserved recovery files require operator recovery");
      throw error;
    } finally {
      for (const entry of prepared) for (const file of rollbackFailed ? [entry.temp] : [entry.temp, entry.backup]) {
        await unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // CLI is intentionally dry-run only; persistence requires the authenticated API.
  const workDir = resolve(process.argv[2] || "work");
  const month = process.argv[3] || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
  const result = await refreshPendingBrands(workDir, () => loadPendingBrandSources(workDir, month), { dryRun: true });
  console.log(JSON.stringify(result, null, 2));
}

// SPLIT_CODE_IDENTITY executor. dryRun computes the full plan (plus compatibility and sourcing previews)
// and writes nothing. A real run writes Brand Master, commercial policy, product registry, compatibility
// and the pending queue in one atomic step, then rebuilds sourcing (same post-commit rule as NEW).
export function splitCodeIdentity(workDir, input, buildCompatibility, { replace = rename, sources = null, dryRun = true, preview = null } = {}) {
  return withPendingBrandWrite(async () => {
    const files = {
      canonical: join(workDir, "brand-master.json"),
      policies: join(workDir, "brand-commercial-policy.json"),
      productRegistry: join(workDir, "product-registry.json"),
      compatibility: join(workDir, "intelligence/brand-master-list.json"),
      aliases: join(workDir, "intelligence/brand-aliases.json"),
      queue: join(workDir, "pending-brand-queue.json")
    };
    const canonical = await readJson(files.canonical, null);
    const policies = await readJson(files.policies, { policies: [] });
    const productRegistry = await readJson(files.productRegistry, { entries: [] });
    const queue = await readPendingBrands(workDir);
    const plan = planCodeIdentitySplit({ canonical, policies, productRegistry, queue, input, sources, now: new Date().toISOString() });
    if (plan.status === "ALREADY_SPLIT") return { ok: true, ...plan, dryRun };
    const brandsAfter = Array.isArray(plan.canonical) ? plan.canonical : plan.canonical.brands;
    const derived = buildCompatibility(brandsAfter);
    const codes = new Set([plan.newIdentity.brand_code, plan.oldIdentity.brand_code]);
    const compatBefore = await readJson(files.compatibility, []);
    const compatibility = {
      before: (Array.isArray(compatBefore) ? compatBefore : []).filter(b => codes.has(b.id)),
      after: derived.brands.filter(b => codes.has(b.id))
    };
    const summary = { status: "PLANNED", version: plan.version, preconditions: plan.preconditions, effectiveMonth: plan.effectiveMonth,
      oldIdentity: plan.oldIdentity, newIdentity: plan.newIdentity, diff: { ...plan.diff, compatibility } };
    if (dryRun) {
      let sourcing = null;
      try {
        const preview = buildBrandSourcingMaster({ ...(await loadSourcingInputs(workDir)), brandMaster: plan.canonical });
        const pick = code => preview.brands.find(b => b.brand_code === code) || null;
        sourcing = { old: pick(plan.oldIdentity.brand_code), new: pick(plan.newIdentity.brand_code) };
      } catch (error) {
        sourcing = { error: error.message };
      }
      const attribution = preview ? await preview(plan, canonical) : null;
      return { ok: true, dryRun: true, ...summary, diff: { ...summary.diff, sourcing }, ...(attribution ? { attribution } : {}) };
    }
    if (input.expectedVersion === undefined) throw Object.assign(new Error("expectedVersion from the dry-run is required"), { code: "VERSION_REQUIRED", status: 409 });
    // Exact pre-write copy of everything this split touches plus the archives a later
    // brand-attribution rebuild may change; restoreIdentitySplitBackup() reverts to it byte for byte.
    const backup = await backupWorkFiles(workDir, [...SPLIT_BACKUP_FILES, ...archiveMonthsFrom(plan.effectiveMonth).map(month => `monthly/${month}.json`)], `split-${plan.preconditions.pendingId.slice(0, 8)}`);
    try {
      await writeFilesAtomically([[files.canonical, plan.canonical], [files.policies, plan.policies], [files.productRegistry, plan.productRegistry],
        [files.compatibility, derived.brands], [files.aliases, derived.aliases], [files.queue, plan.queue]], { replace });
    } catch (error) {
      throw Object.assign(error, { backup });
    }
    let sourcingRefresh;
    try {
      const sourcing = await refreshBrandSourcingMaster(workDir);
      sourcingRefresh = { ok: true, brands: sourcing.brands.length, generatedAt: sourcing.generatedAt };
    } catch (error) {
      sourcingRefresh = { ok: false, error: error.message };
    }
    return { ok: true, dryRun: false, ...summary, sourcingRefresh, backup };
  });
}

// REKEY_INTERNAL_IDENTITY executor. Re-plans under the write lock with the dry-run version, backs up
// (same manifest/restore as identity splits) Brand Master, policy, registry, compatibility, sourcing and
// the archives that will be rebuilt, then writes the four identity files atomically and rebuilds sourcing.
export function rekeyInternalIdentity(workDir, input, buildCompatibility, { cafe24Brands = [], archiveMonths = [], replace = rename } = {}) {
  return withPendingBrandWrite(async () => {
    if (input?.expectedVersion === undefined) throw Object.assign(new Error("expectedVersion from the dry-run is required"), { code: "VERSION_REQUIRED", status: 409 });
    const files = {
      canonical: join(workDir, "brand-master.json"),
      policies: join(workDir, "brand-commercial-policy.json"),
      productRegistry: join(workDir, "product-registry.json"),
      compatibility: join(workDir, "intelligence/brand-master-list.json"),
      aliases: join(workDir, "intelligence/brand-aliases.json")
    };
    const plan = planInternalRekey({ canonical: await readJson(files.canonical, null), policies: await readJson(files.policies, { policies: [] }),
      productRegistry: await readJson(files.productRegistry, { entries: [] }), cafe24Brands, pendingCandidates: (await readPendingBrands(workDir)).candidates, input });
    if (plan.status !== "PLANNED") throw Object.assign(new Error(`Nothing to re-key (${plan.status})`), { code: plan.status, status: 409 });
    const derived = buildCompatibility(Array.isArray(plan.canonical) ? plan.canonical : plan.canonical.brands);
    const backup = await backupWorkFiles(workDir, [...SPLIT_BACKUP_FILES, ...archiveMonths.map(month => `monthly/${month}.json`)], `rekey-${plan.preconditions.code}`);
    try {
      await writeFilesAtomically([[files.canonical, plan.canonical], [files.policies, plan.policies], [files.productRegistry, plan.productRegistry],
        [files.compatibility, derived.brands], [files.aliases, derived.aliases]], { replace });
    } catch (error) {
      throw Object.assign(error, { backup });
    }
    let sourcingRefresh;
    try {
      const sourcing = await refreshBrandSourcingMaster(workDir);
      sourcingRefresh = { ok: true, brands: sourcing.brands.length, generatedAt: sourcing.generatedAt };
    } catch (error) {
      sourcingRefresh = { ok: false, error: error.message };
    }
    return { ok: true, version: plan.version, identity: plan.identity, sourcingRefresh, backup };
  });
}

// Read-only audit block on the pending scan. Only actionable findings stay in unconfirmedCafe24Codes;
// retired (deleted Cafe24 brand) codes are listed by code for debugging and never become work items.
function cafe24CodeAuditSummary(audit) {
  return {
    unconfirmedCafe24Codes: audit.findings.filter(f => f.actionable),
    cafe24CodeSummary: { cafe24MaxCode: audit.cafe24MaxCode, ...audit.summary },
    retiredCafe24Codes: audit.findings.filter(f => f.status === "RETIRED_CAFE24_CODE").map(f => f.brandCode)
  };
}

export { SPLIT_ACTION };

const SPLIT_BACKUP_FILES = Object.freeze(["brand-master.json", "brand-commercial-policy.json", "product-registry.json", "intelligence/brand-master-list.json",
  "intelligence/brand-aliases.json", "pending-brand-queue.json", "brand-sourcing-master.json"]);
const BACKUP_ID = /^[0-9A-Za-z_-]{1,80}$/;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// Closed months from `fromMonth` up to the month before the current KST month.
function archiveMonthsFrom(fromMonth, now = new Date()) {
  const current = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
  const months = [];
  for (let month = fromMonth; month && month < current;) {
    months.push(month);
    const [y, m] = month.split("-").map(Number);
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return months;
}

async function backupWorkFiles(workDir, relativePaths, label) {
  const backupId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}`;
  const dir = join(workDir, "backups", "identity-split", backupId);
  await mkdir(dir, { recursive: true });
  const files = [];
  for (const relativePath of relativePaths) {
    const bytes = await readFile(join(workDir, relativePath)).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (bytes !== null) {
      await mkdir(dirname(join(dir, relativePath)), { recursive: true });
      await writeFile(join(dir, relativePath), bytes, { flag: "wx" });
    }
    files.push({ relativePath, existed: bytes !== null, bytes: bytes?.length ?? 0, sha256: bytes ? sha256(bytes) : null });
  }
  const manifest = { backupId, createdAt: new Date().toISOString(), label, files };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

export async function readIdentitySplitBackup(workDir, backupId) {
  if (!BACKUP_ID.test(String(backupId || ""))) throw Object.assign(new Error("Invalid backupId"), { code: "VALIDATION_FAILED", status: 400 });
  const dir = join(workDir, "backups", "identity-split", backupId);
  const manifest = await readJson(join(dir, "manifest.json"), null);
  if (!manifest) throw Object.assign(new Error("Backup not found"), { code: "NOT_FOUND", status: 404 });
  return { dir, manifest };
}

// Byte-exact atomic restore of a split backup (files that did not exist before are removed).
export function restoreIdentitySplitBackup(workDir, backupId, { replace = rename } = {}) {
  return withPendingBrandWrite(async () => {
    const { dir, manifest } = await readIdentitySplitBackup(workDir, backupId);
    const restore = [];
    for (const file of manifest.files.filter(f => f.existed)) {
      const bytes = await readFile(join(dir, file.relativePath));
      if (sha256(bytes) !== file.sha256) throw Object.assign(new Error(`Backup checksum mismatch: ${file.relativePath}`), { code: "BACKUP_CORRUPT", status: 409 });
      restore.push([join(workDir, file.relativePath), bytes]);
    }
    await writeFilesAtomically(restore, { replace });
    for (const file of manifest.files.filter(f => !f.existed)) await unlink(join(workDir, file.relativePath)).catch(error => { if (error.code !== "ENOENT") throw error; });
    const verified = [];
    for (const file of manifest.files.filter(f => f.existed)) verified.push({ relativePath: file.relativePath, ok: sha256(await readFile(join(workDir, file.relativePath))) === file.sha256 });
    return { ok: verified.every(v => v.ok), backupId, restored: verified };
  });
}

