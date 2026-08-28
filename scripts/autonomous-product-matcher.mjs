#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { recomputeProductRegistrySummary } from "./product-registry-summary.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const VERSION = "autonomous_exact_brand_title_family_v1";

const text = (value) => String(value ?? "").trim();
const codeOf = (row) => text(row?.PROD_CD ?? row?.prodCd ?? row?.productCode);
const nameOf = (row) => text(row?.PROD_DES ?? row?.productName ?? row?.product_name);
const sizeOf = (row) => text(row?.SIZE_DES ?? row?.size);
const familyOf = (code) => text(code).replace(/\d{2}$/, "");

export function normalizeIdentity(value) {
  return text(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[×✕]/g, "X")
    .replace(/[／]/g, "/")
    .replace(/[\[\]{}()_\\|,:;+/'"]/g, " ")
    .replace(/[^A-Z0-9가-힣%+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractStrongModelTokens(value) {
  return normalizeIdentity(value)
    .split(" ")
    .filter((token) =>
      /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(token) &&
      !/^\d{2}(?:SS|FW|AW)$/.test(token)
    );
}

export function parseEcountIdentity(row) {
  let productName = nameOf(row);
  const slash = productName.indexOf("/");
  const brand = slash >= 0 ? productName.slice(0, slash) : "";
  if (slash >= 0) productName = productName.slice(slash + 1);
  const size = sizeOf(row);
  if (size) {
    const escaped = size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    productName = productName.replace(new RegExp(`(?:\\s*/\\s*|\\s+)${escaped}(?:\\s*SIZE)?\\s*$`, "i"), "");
  }
  return { brand: normalizeIdentity(brand), title: normalizeIdentity(productName) };
}

export function buildTrustedBrandAliases(entries, brands = []) {
  const aliases = new Map();
  for (const brand of brands) {
    if (!brand?.brand_code || brand?.active === false) continue;
    aliases.set(brand.brand_code, new Set(
      [brand.brand_name, ...(brand.name_aliases || [])].map(normalizeIdentity).filter(Boolean)
    ));
  }
  for (const entry of entries) {
    if (!entry?.verified || entry?.status !== "confirmed" || !entry?.brandId) continue;
    for (const match of entry?.ecount?.matchedProducts || []) {
      const brand = parseEcountIdentity(match).brand;
      if (!brand) continue;
      if (!aliases.has(entry.brandId)) aliases.set(entry.brandId, new Set());
      aliases.get(entry.brandId).add(brand);
    }
  }
  return aliases;
}

export function buildExactIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const identity = parseEcountIdentity(row);
    const key = `${identity.brand}|${identity.title}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

const codesEqual = (left, right) =>
  left.map(codeOf).sort().join(",") === right.map(codeOf).sort().join(",");

export function decideEntry(entry, aliases, index) {
  if (!entry?.verified && entry?.resolutionTerminal) {
    return { tier: "NO_CANDIDATE", reason: "explicit_terminal_resolution_state", candidates: [] };
  }
  if (!entry || !entry.canonicalProductName || entry.canonicalProductName === "상품명 없음") {
    return { tier: "DATA_ISSUE", reason: "missing_product_identity", candidates: [] };
  }
  const candidates = [];
  const normalizedTitle = normalizeIdentity(entry.canonicalProductName);
  if (normalizedTitle.split(" ").filter(Boolean).length < 2) {
    return { tier: "SAFE_REVIEW", reason: "generic_single_token_title", candidates };
  }
  for (const brand of aliases.get(entry.brandId) || []) {
    candidates.push(...(index.get(`${brand}|${normalizedTitle}`) || []));
  }
  if (!candidates.length) return { tier: "NO_CANDIDATE", reason: "no_exact_trusted_brand_title_candidate", candidates };
  const families = new Set(candidates.map((row) => familyOf(codeOf(row))));
  if (families.size !== 1) return { tier: "AMBIGUOUS", reason: "multiple_exact_product_families", candidates };
  const modelTokens = extractStrongModelTokens(entry.canonicalProductName);
  if (modelTokens.length) {
    return {
      tier: "AUTO_SAFE",
      reason: "trusted_brand_exact_title_model_unique_family",
      candidates,
      replaceCandidateSet: !codesEqual(candidates, entry?.ecount?.matchedProducts || []),
      evidence: ["trusted_brand_alias", "exact_normalized_product_title", "exact_model_style_code", "unique_ecount_family"],
      negativeChecks: ["no_brand_conflict", "no_title_conflict", "no_model_conflict", "no_family_ambiguity"]
    };
  }
  const evidence = new Set(entry?.matching?.evidence || []);
  if (!evidence.has("normalized_brand") || !evidence.has("normalized_product_name")) {
    return { tier: "SAFE_REVIEW", reason: "existing_diagnostic_lacks_independent_exact_evidence", candidates };
  }
  if (!codesEqual(candidates, entry?.ecount?.matchedProducts || [])) {
    return { tier: "SAFE_REVIEW", reason: "regenerated_family_differs_from_existing_candidates", candidates };
  }
  return {
    tier: "AUTO_SAFE",
    reason: "trusted_brand_alias_exact_title_unique_family_existing_candidates_equal",
    candidates,
    evidence: ["trusted_brand_alias", "exact_normalized_product_title", "unique_ecount_family", "existing_candidate_set_equal"],
    negativeChecks: ["no_brand_conflict", "no_title_conflict", "no_family_ambiguity", "no_candidate_set_drift"]
  };
}

export function auditRegistry(registry, priceAudit, fullProducts, brandMaster = { brands: [] }) {
  const aliases = buildTrustedBrandAliases(registry.entries || [], brandMaster.brands || brandMaster);
  const index = buildExactIndex(fullProducts);
  const byId = new Map((registry.entries || []).map((entry) => [entry.canonicalProductId, entry]));
  const rows = (priceAudit.rows || []).filter((row) => [
    "MATCH_REQUIRED", "REVIEW_REQUIRED", "HUMAN_REVIEW_REQUIRED", "GENUINE_AMBIGUOUS",
    "SPECIAL_PRODUCT", "HISTORICAL", "NO_COUNTERPART", "DATA_ISSUE"
  ].includes(row.status));
  const decisions = rows.map((row) => {
    const entry = byId.get(row.canonicalProductId);
    if (entry?.verified) return { row, entry, decision: { tier: "DATA_ISSUE", reason: row.reason, candidates: [] } };
    const decision = decideEntry(entry, aliases, index);
    if (
      decision.tier === "AUTO_SAFE" &&
      row.reason !== "low_confidence_registry_match_with_price_diff" &&
      decision.reason !== "trusted_brand_exact_title_model_unique_family"
    ) {
      decision.tier = "DATA_ISSUE";
      decision.reason = row.reason;
    }
    return { row, entry, decision };
  });
  const summary = { AUTO_SAFE: 0, SAFE_REVIEW: 0, AMBIGUOUS: 0, NO_CANDIDATE: 0, DATA_ISSUE: 0 };
  for (const item of decisions) summary[item.decision.tier] += 1;
  return { aliases, index, decisions, summary };
}

export function backtestRegistry(registry, fullProducts, brandMaster = { brands: [] }) {
  const trusted = (registry.entries || []).filter((entry) => entry?.verified && entry?.status === "confirmed" && entry?.brandId && entry?.ecount?.matchedProducts?.length);
  const index = buildExactIndex(fullProducts);
  let autoSafe = 0;
  let correct = 0;
  let wrong = 0;
  for (const entry of trusted) {
    const holdoutAliases = buildTrustedBrandAliases(trusted.filter((candidate) => candidate !== entry), brandMaster.brands || brandMaster);
    const decision = decideEntry(entry, holdoutAliases, index);
    if (decision.tier !== "AUTO_SAFE") continue;
    autoSafe += 1;
    if (codesEqual(decision.candidates, entry.ecount.matchedProducts)) correct += 1;
    else wrong += 1;
  }
  return { total: trusted.length, autoSafe, correct, wrong, abstained: trusted.length - autoSafe, precision: autoSafe ? correct / autoSafe : null };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const [registryText, priceAuditText, fullText, brandMasterText] = await Promise.all([
    readFile(join(workDir, "product-registry.json"), "utf8"),
    readFile(join(workDir, "price-audit.json"), "utf8"),
    readFile(join(workDir, "ecount-inventory", "full-products-candidate.json"), "utf8"),
    readFile(join(workDir, "brand-master.json"), "utf8")
  ]);
  const registry = JSON.parse(registryText);
  const priceAudit = JSON.parse(priceAuditText);
  const fullRaw = JSON.parse(fullText);
  const brandMaster = JSON.parse(brandMasterText);
  const fullProducts = Array.isArray(fullRaw) ? fullRaw : fullRaw.products || fullRaw.rows || fullRaw.items || [];
  const audit = auditRegistry(registry, priceAudit, fullProducts, brandMaster);
  const backtest = backtestRegistry(registry, fullProducts, brandMaster);
  console.log(JSON.stringify({ version: VERSION, backtest, unresolved: audit.decisions.length, tiers: audit.summary }, null, 2));
  if (!apply) return;
  const proposals = audit.decisions.filter((item) => item.decision.tier === "AUTO_SAFE");
  if (!proposals.length) {
    console.log("applied=0");
    return;
  }
  const now = new Date().toISOString();
  for (const { entry, decision } of proposals) {
    if (decision.replaceCandidateSet) {
      entry.ecount.matchedProducts = decision.candidates.map((candidate) => ({
        prodCd: codeOf(candidate),
        productName: nameOf(candidate),
        size: sizeOf(candidate) || null
      }));
    }
    entry.status = "confirmed";
    entry.confidence = 100;
    entry.verified = true;
    entry.matching = {
      ...entry.matching,
      strategy: VERSION,
      evidence: decision.evidence,
      pendingReasons: [],
      autonomous: { version: VERSION, confidenceTier: "AUTO_SAFE", positiveEvidence: decision.evidence, negativeChecks: decision.negativeChecks }
    };
    entry.updatedAt = now;
  }
  registry.summary = recomputeProductRegistrySummary(registry.entries || []);
  registry.generatedAt = now;
  const path = join(workDir, "product-registry.json");
  const temp = `${path}.tmp-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`);
  await rename(temp, path);
  console.log(`applied=${proposals.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
