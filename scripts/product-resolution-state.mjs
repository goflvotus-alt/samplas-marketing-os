#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditRegistry } from "./autonomous-product-matcher.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");

export function classifyOperationalResolution({ entry, decision, cafe24Product, priceAuditRow }) {
  if (decision.tier === "DATA_ISSUE") return { state: "DATA_QUALITY_ISSUE", terminal: false, reason: decision.reason || priceAuditRow?.reason || "source_data_error" };
  if (decision.tier === "SAFE_REVIEW") return { state: "HUMAN_REVIEW_REQUIRED", terminal: false, reason: decision.reason };
  if (decision.tier === "AMBIGUOUS") return { state: "GENUINE_AMBIGUOUS", terminal: false, reason: decision.reason };
  if (entry?.brandId === "B0000000") return { state: "SPECIAL_PRODUCT", terminal: true, reason: "operational_cafe24_record" };
  if (cafe24Product && (cafe24Product.display !== "T" || cafe24Product.selling !== "T")) return { state: "HISTORICAL_OR_INACTIVE", terminal: true, reason: "cafe24_display_or_selling_inactive" };
  if (entry?.ecount?.matchedProducts?.length) return { state: "HUMAN_REVIEW_REQUIRED", terminal: false, reason: "product_name_identity_failure" };
  return { state: "TRUE_NO_COUNTERPART", terminal: true, reason: "no_ecount_candidate_after_complete_catalog" };
}

export function resolutionSummary(entries) {
  const summary = {};
  for (const entry of entries) if (entry.resolutionState) summary[entry.resolutionState] = (summary[entry.resolutionState] || 0) + 1;
  return summary;
}

async function main() {
  const [registry, priceAudit, fullRaw, brandMaster, catalogRaw] = await Promise.all([
    readFile(join(workDir, "product-registry.json"), "utf8").then(JSON.parse),
    readFile(join(workDir, "price-audit.json"), "utf8").then(JSON.parse),
    readFile(join(workDir, "ecount-inventory", "full-products-candidate.json"), "utf8").then(JSON.parse),
    readFile(join(workDir, "brand-master.json"), "utf8").then(JSON.parse),
    readFile(join(workDir, "cafe24-full-catalog.json"), "utf8").then(JSON.parse)
  ]);
  const fullProducts = Array.isArray(fullRaw) ? fullRaw : fullRaw.products || [];
  const catalog = Array.isArray(catalogRaw) ? catalogRaw : catalogRaw.products || [];
  const catalogByNo = new Map(catalog.map((product) => [String(product.product_no), product]));
  const audit = auditRegistry(registry, priceAudit, fullProducts, brandMaster);
  let changed = 0;
  for (const { entry, decision, row } of audit.decisions) {
    const resolution = classifyOperationalResolution({ entry, decision, priceAuditRow: row, cafe24Product: catalogByNo.get(String(entry?.cafe24?.productNo)) });
    if (entry.resolutionState !== resolution.state || entry.resolutionReason !== resolution.reason || entry.resolutionTerminal !== resolution.terminal || entry.resolutionSource !== "batch13_operational_normalization_v1") changed += 1;
    entry.resolutionState = resolution.state;
    entry.resolutionReason = resolution.reason;
    entry.resolutionTerminal = resolution.terminal;
    entry.resolutionSource = "batch13_operational_normalization_v1";
  }
  registry.resolutionSummary = resolutionSummary(registry.entries || []);
  if (changed || !registry.resolutionClassifiedAt) registry.resolutionClassifiedAt = new Date().toISOString();
  const count = Object.values(registry.resolutionSummary).reduce((sum, value) => sum + value, 0);
  if (count !== audit.decisions.length) throw new Error(`resolution_count_mismatch:${count}:${audit.decisions.length}`);
  console.log(JSON.stringify({ unresolved: audit.decisions.length, changed, resolutionSummary: registry.resolutionSummary }, null, 2));
  if (!process.argv.includes("--apply") || !changed) {
    if (process.argv.includes("--apply")) console.log("applied=0");
    return;
  }
  const path = join(workDir, "product-registry.json");
  const temp = `${path}.tmp-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`);
  await rename(temp, path);
  console.log(`applied=${changed}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
