import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildBrandRegistry, resolveBrand, normalizeBrandKey, normalizeBrandName, parseBrandAliases, extractBracketBrandCandidate, extractSlashBrandCandidate } from "./brand-engine.mjs";
import { detectPersonalPayment } from "./load-ecount-offline-sales.mjs";
import { readEcountOfflineSalesSnapshot } from "./read-ecount-offline-sales-snapshot.mjs";
import { pendingBrandUiMetadata } from "./pending-brand-ui-metadata.mjs";

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
    return { ...queue, candidates: queue.candidates.map(candidate => {
      const response = { ...candidate, confirmExistingBrandCode: confirmExistingTarget(canonical, candidate, aliases)?.brand_code || null };
      return { ...response, uiReview: pendingBrandUiMetadata(response, canonical, aliases) };
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

// Detection is deliberately separate from attribution: no resolver consumes this queue.
export function detectPendingBrands({ canonical, compatibility = [], aliases = [], cafe24Brands = [], products = [], ecountLines = [], previous = { candidates: [] }, recentReview = null, now = new Date().toISOString() }) {
  if (!(Array.isArray(canonical) || Array.isArray(canonical?.brands)) ||
      [compatibility, aliases, cafe24Brands, products, ecountLines, previous.candidates].some(value => !Array.isArray(value))) throw new Error("Invalid pending brand detection source");
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
    const b = canonicalRows.find(b => normalizeBrandKey(b.brand_code) === code);
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
  for (const [source, rows] of [["CAFE24", cafe24Brands.map(b => ({ ...b, brand_name: b.brand_name || b.brandName || b.name }))], ["CAFE24", products], ["ECOUNT", ecountLines]]) {
    for (const row of rows) {
      const c = candidateFrom(row, source);
      const evidence = source === "CAFE24" ? codeEvidence.get(normalizeBrandKey(c.sourceBrandCode)) : null;
      if (evidence) c.rawBrandName = evidence.cafe24Name;
      const qqq = /^QQQ/i.test(String(row.productCode || row.ecountProdCd || "")) || /^QQQ(?:\s|$|\/)/i.test(c.rawBrandName || c.productName);
      if (qqq || (source === "ECOUNT" && (row.isPersonalPayment === true || detectPersonalPayment(row.customerName).isPersonalPayment))) {
        excluded.push({ source, reason: qqq ? "QQQ" : "PERSONAL_PAYMENT" }); continue;
      }
      const reviewedObservation = previous.candidates.some(p => source === "CAFE24"
        ? normalizeBrandKey(p.sourceBrandCode) === normalizeBrandKey(c.sourceBrandCode)
        : [p.rawBrandName, ...(p.ecountVariants || [])].some(name => normalizeBrandKey(name) === normalizeBrandKey(c.rawBrandName)));
      if (source === "CAFE24" && (!c.sourceBrandCode || c.sourceBrandCode === "B0000000" || (knownCodes.has(normalizeBrandKey(c.sourceBrandCode)) && !reviewedObservation && !evidence))) continue;
      if (source === "ECOUNT" && !c.rawBrandName) continue;
      const key = normalizeBrandKey(c.rawBrandName);
      const hit = conflicts.has(key) ? null : resolveBrand(c.rawBrandName, registry) || resolveBrand(c.rawBrandName, compat);
      // A grandfathered exact whole collaboration name is already accepted;
      // never resolve its individual participants to a single brand.
      if (source === "ECOUNT" && hit && !reviewedObservation) continue;
      observations.push({ ...c, reviewReason: c.collabCandidates.length ? "COLLABORATION" : conflicts.has(key) ? "ALIAS_CONFLICT" : "UNRESOLVED", possibleExistingCanonical: hit && knownCodes.has(normalizeBrandKey(hit.brandId)) ? [hit.brandId] : [], ...(evidence || {}) });
    }
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
  const observed = all.filter(c => observedIds.has(c.id));
  return { version: 1, updatedAt: now, candidates: all, scan: { observed: observed.length,
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
  return { canonical, compatibility, aliases, products, ecountLines: snapshot?.salesLines || [], provenance: { month, productCount: products.length, ecountLineCount: snapshot?.salesLines?.length || 0, ecountAvailable: Boolean(snapshot), catalogGeneratedAt: catalog.generatedAt || catalog.updatedAt || null, ecountSources: snapshot?.sources || [], ecountImportedAt: snapshot?.importedAt || null } };
}

// Serialize local refreshes and atomically replace only the queue. Failed scans
// leave its previous contents intact. ponytail: single-process writer; use a
// cross-process lock if multiple server processes ever share this work directory.
let refreshTail = Promise.resolve();
export function withPendingBrandWrite(task) {
  const result = refreshTail.catch(() => {}).then(task);
  refreshTail = result;
  return result;
}
export function refreshPendingBrands(workDir, loadSources, { dryRun = false } = {}) {
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
    return { ...result, dryRun };
  });
}

function invalidDecision(message) { throw Object.assign(new Error(message), { status: 400 }); }

export function approvedCafe24BrandCode(code, canonical) {
  const brands = Array.isArray(canonical) ? canonical : canonical?.brands || [];
  // Existing primary keys always win. Only explicit approval metadata can map a
  // new source code; ordinary name aliases never reinterpret Cafe24 keys.
  if (brands.some(b => b.brand_code === code)) return code;
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
export function planPendingBrandDecision(canonical, queue, input, now = new Date().toISOString(), aliases = []) {
  if (!input || !["NEW", "LINK", "IGNORE", "HOLD", "CONFIRM_EXISTING"].includes(input.action) || typeof input.id !== "string") invalidDecision("Invalid pending brand decision");
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
  if (input.action === "CONFIRM_EXISTING") {
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
  Object.assign(candidate, { status: { NEW: "APPROVED", LINK: "LINKED", IGNORE: "IGNORED", CONFIRM_EXISTING: "APPROVED" }[input.action], approvalAction: input.action,
    approvedAt: now, canonicalBrandCode: target?.brand_code || null, note: input.note || "" });
  nextQueue.updatedAt = now;
  return { canonical: nextCanonical, queue: nextQueue, candidate };
}

export function reviewPendingBrand(workDir, input, buildCompatibility, { replace = rename } = {}) {
  return withPendingBrandWrite(async () => {
    const canonicalFile = join(workDir, "brand-master.json");
    const canonical = await readJson(canonicalFile, null);
    const aliases = input?.action === "CONFIRM_EXISTING" ? await readJson(join(workDir, "intelligence/brand-aliases.json"), []) : [];
    const result = planPendingBrandDecision(canonical, await readPendingBrands(workDir), input, new Date().toISOString(), aliases);
    const files = [];
    if (!["IGNORE", "HOLD", "CONFIRM_EXISTING"].includes(input.action) && result.candidate.reviewReason !== "CODE_NAME_CONFLICT") {
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
        await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
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
    return { ok: true, candidate: result.candidate };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // CLI is intentionally dry-run only; persistence requires the authenticated API.
  const workDir = resolve(process.argv[2] || "work");
  const month = process.argv[3] || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
  const result = await refreshPendingBrands(workDir, () => loadPendingBrandSources(workDir, month), { dryRun: true });
  console.log(JSON.stringify(result, null, 2));
}
