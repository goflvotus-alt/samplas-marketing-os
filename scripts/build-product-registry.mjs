#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const defaultInputPath = join(workDir, "cafe24-ecount-product-matching-diagnostic.json");
const defaultRegistryPath = join(workDir, "product-registry.json");
const defaultReviewQueuePath = join(workDir, "product-registry-review-queue.json");

const MATCHABLE_TYPES = new Set([
  "exact_one_to_one",
  "exact_one_to_many",
  "fuzzy_high_confidence",
  "fuzzy_ambiguous"
]);

function parseArgs(argv) {
  const options = {
    input: defaultInputPath,
    registry: defaultRegistryPath,
    reviewQueue: defaultReviewQueuePath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") options.input = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--input=")) options.input = resolve(rootDir, arg.slice("--input=".length));
    else if (arg === "--registry") options.registry = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--registry=")) options.registry = resolve(rootDir, arg.slice("--registry=".length));
    else if (arg === "--review-queue") options.reviewQueue = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--review-queue=")) options.reviewQueue = resolve(rootDir, arg.slice("--review-queue=".length));
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function slugPart(value) {
  const slug = String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "UNASSIGNED";
}

function confidenceForDiagnostic(result, group) {
  if (result.classification === "exact_one_to_one") return 100;
  if (result.classification === "exact_one_to_many") return group.ecountProducts.size > 1 ? 78 : 95;
  if (result.classification === "fuzzy_high_confidence") return Math.max(80, Math.min(94, Math.round((result.confidence || 0.8) * 100)));
  if (result.classification === "fuzzy_ambiguous") return Math.max(60, Math.min(79, Math.round((result.confidence || 0.6) * 100)));
  return 0;
}

function statusForGroup(group) {
  if (group.diagnosticTypes.size === 1 && group.diagnosticTypes.has("exact_one_to_one") && group.ecountProducts.size === 1) return "confirmed";
  if (group.diagnosticTypes.has("fuzzy_ambiguous") || group.diagnosticTypes.has("exact_one_to_many")) return "ambiguous";
  return "candidate";
}

function priorityForEntry(entry) {
  if (entry.status === "confirmed" && entry.verified) return null;
  if (entry.matching.diagnosticType.includes("exact_one_to_many")) return "HIGH";
  if (entry.matching.diagnosticType.includes("fuzzy_high_confidence")) return "HIGH";
  if (entry.confidence >= 80) return "MEDIUM";
  return "LOW";
}

function reasonForEntry(entry) {
  if (entry.matching.diagnosticType.includes("exact_one_to_many")) return "normalized brand and product name matched, but multiple ECOUNT candidates exist";
  if (entry.matching.diagnosticType.includes("fuzzy_ambiguous")) return "token similarity produced multiple review candidates";
  if (entry.matching.diagnosticType.includes("fuzzy_high_confidence")) return "high-confidence fuzzy match still requires human verification";
  return "manual review required";
}

function ecountProductFromResult(result) {
  return {
    prodCd: result.ecount?.productCode || null,
    barcode: result.ecount?.barcode || null,
    productName: result.ecount?.rawName || result.ecount?.productName || null,
    size: result.ecount?.specification || null,
    supplier: null,
    consignment: Boolean(result.ecount?.consignmentCandidate)
  };
}

function groupDiagnosticResults(diagnostic) {
  const groups = new Map();
  for (const result of diagnostic.results || []) {
    if (!MATCHABLE_TYPES.has(result.classification) || !result.cafe24?.productNo) continue;
    const key = result.cafe24.productNo;
    if (!groups.has(key)) {
      groups.set(key, {
        cafe24: result.cafe24,
        rows: [],
        ecountProducts: new Map(),
        diagnosticTypes: new Set(),
        evidence: new Set(),
        pendingReasons: new Set()
      });
    }
    const group = groups.get(key);
    group.rows.push(result);
    group.diagnosticTypes.add(result.classification);
    for (const item of result.evidence || []) group.evidence.add(item);
    for (const item of result.pendingReasons || []) group.pendingReasons.add(item);
    if (result.ecount?.productCode && !group.ecountProducts.has(result.ecount.productCode)) {
      group.ecountProducts.set(result.ecount.productCode, ecountProductFromResult(result));
    }
  }
  return groups;
}

function buildRegistryEntry(group, now) {
  const confidence = Math.max(...group.rows.map((result) => confidenceForDiagnostic(result, group)));
  const status = statusForGroup(group);
  const verified = status === "confirmed" && confidence === 100;
  const cafe24 = group.cafe24;
  return {
    canonicalProductId: `CP-C24-${cafe24.productNo}`,
    brandId: cafe24.brandCode || null,
    brandName: cafe24.brandName || null,
    canonicalProductName: cafe24.productName || cafe24.rawName || null,
    status,
    confidence,
    verified,
    cafe24: {
      productNo: cafe24.productNo,
      productCode: cafe24.productCode || null,
      productName: cafe24.rawName || cafe24.productName || null
    },
    ecount: {
      matchedProducts: [...group.ecountProducts.values()].sort((a, b) => String(a.prodCd).localeCompare(String(b.prodCd)))
    },
    matching: {
      strategy: verified ? "normalized_brand_product_exact" : "diagnostic_candidate_review",
      diagnosticType: [...group.diagnosticTypes].sort(),
      evidence: [...group.evidence].sort(),
      pendingReasons: [...group.pendingReasons].sort()
    },
    createdAt: now,
    updatedAt: now
  };
}

function buildReviewItem(entry) {
  const priority = priorityForEntry(entry);
  if (!priority) return null;
  return {
    canonicalProductId: entry.canonicalProductId,
    priority,
    recommendedCandidate: {
      brandId: entry.brandId,
      brandName: entry.brandName,
      canonicalProductName: entry.canonicalProductName,
      cafe24: entry.cafe24,
      ecount: entry.ecount.matchedProducts.slice(0, 10),
      confidence: entry.confidence
    },
    confidence: entry.confidence,
    reason: reasonForEntry(entry),
    diagnosticType: entry.matching.diagnosticType,
    pendingReasons: entry.matching.pendingReasons
  };
}

function confidenceBucket(confidence) {
  if (confidence === 100) return "100";
  if (confidence >= 95) return "95-99";
  if (confidence >= 80) return "80-94";
  if (confidence >= 60) return "60-79";
  return "0-59";
}

function summarizeRegistry(entries, reviewQueue) {
  const confidenceDistribution = { "100": 0, "95-99": 0, "80-94": 0, "60-79": 0, "0-59": 0 };
  const byBrand = new Map();
  for (const entry of entries) {
    confidenceDistribution[confidenceBucket(entry.confidence)] += 1;
    const brand = entry.brandName || entry.brandId || "UNASSIGNED";
    byBrand.set(brand, (byBrand.get(brand) || 0) + 1);
  }
  return {
    registryCount: entries.length,
    verifiedCount: entries.filter((entry) => entry.verified).length,
    reviewQueueCount: reviewQueue.length,
    confidenceDistribution,
    brandCounts: [...byBrand.entries()]
      .map(([brandName, count]) => ({ brandName, count }))
      .sort((a, b) => b.count - a.count || a.brandName.localeCompare(b.brandName))
  };
}

export function buildProductRegistryFromDiagnostic(diagnostic, options = {}) {
  const now = options.now || new Date().toISOString();
  const groups = groupDiagnosticResults(diagnostic);
  const entries = [...groups.values()]
    .map((group) => buildRegistryEntry(group, now))
    .sort((a, b) => slugPart(a.brandName).localeCompare(slugPart(b.brandName)) || a.canonicalProductName.localeCompare(b.canonicalProductName) || a.canonicalProductId.localeCompare(b.canonicalProductId));
  const reviewQueue = entries
    .map(buildReviewItem)
    .filter(Boolean)
    .sort((a, b) => {
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority] || b.confidence - a.confidence || a.canonicalProductId.localeCompare(b.canonicalProductId);
    });
  return {
    registry: {
      generatedAt: now,
      mode: "product_registry_phase1_diagnostic_only",
      source: {
        diagnostic: "work/cafe24-ecount-product-matching-diagnostic.json",
        generatedAt: diagnostic.generatedAt || null
      },
      policy: {
        productionLinked: false,
        verifiedRule: "Only exact_one_to_one entries are verified in Phase 1.",
        auxiliaryCodes: "manufacturer_code and supplier_code are retained as evidence only; they are not standalone match keys."
      },
      summary: summarizeRegistry(entries, reviewQueue),
      entries
    },
    reviewQueue: {
      generatedAt: now,
      mode: "product_registry_phase1_review_queue",
      source: "work/product-registry.json",
      summary: summarizeRegistry(entries, reviewQueue),
      items: reviewQueue
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const diagnostic = await readJson(options.input);
  const { registry, reviewQueue } = buildProductRegistryFromDiagnostic(diagnostic);
  await writeFile(options.registry, `${JSON.stringify(registry, null, 2)}\n`);
  await writeFile(options.reviewQueue, `${JSON.stringify(reviewQueue, null, 2)}\n`);
  console.log("SAMPLAS Product Registry Phase 1");
  console.log(`- registry: ${options.registry}`);
  console.log(`- registry count: ${registry.summary.registryCount}`);
  console.log(`- verified count: ${registry.summary.verifiedCount}`);
  console.log(`- review queue count: ${registry.summary.reviewQueueCount}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Product registry build failed: ${error.message}`);
    process.exitCode = 1;
  });
}
