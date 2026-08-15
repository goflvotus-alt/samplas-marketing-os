#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrandRegistry } from "./brand-engine.mjs";
import { normalizeProductName, splitEcountProductName } from "./diagnose-cafe24-ecount-product-matching.mjs";
import {
  buildStoreProductIdentityIndex,
  resolveStoreProductIdentity,
  storeProductIdentityKey
} from "./store-product-identity.mjs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const work = join(root, "work");
const stores = ["APGUJEONG", "VAIL"];

const readJson = (path) => readFile(path, "utf8").then(JSON.parse);
const productRegistry = await readJson(join(work, "product-registry.json"));
const brandRegistry = buildBrandRegistry(await readJson(join(work, "brand-master.json")));
const confirmedRegistry = { entries: productRegistry.entries.filter((entry) => entry?.verified === true && entry?.status === "confirmed") };
const beforeIndex = buildStoreProductIdentityIndex(confirmedRegistry);
const afterIndex = buildStoreProductIdentityIndex(productRegistry);

const allExact = new Map();
const allCanonical = new Map();
const add = (map, key, entry) => {
  if (!key) return;
  const values = map.get(key) || new Map();
  values.set(entry.canonicalProductId, entry);
  map.set(key, values);
};
for (const entry of productRegistry.entries) {
  for (const product of entry?.ecount?.matchedProducts || []) add(allExact, storeProductIdentityKey(product.productName, product.size), entry);
  add(allCanonical, normalizeProductName(entry.canonicalProductName), entry);
}

function candidatesFor(line) {
  const exact = [...(allExact.get(storeProductIdentityKey(line.productName, line.specification))?.values() || [])];
  if (exact.length) return exact;
  const { nameRaw } = splitEcountProductName(line.productName);
  return [...(allCanonical.get(normalizeProductName(nameRaw))?.values() || [])];
}

function classify(line, resolution, candidates) {
  if (!line?.productName || !line?.specification) return "insufficient_identity";
  if (resolution.reason === "ambiguous" || candidates.length > 1) return "ambiguous";
  if (resolution.reason === "brand_conflict") return "other";
  if (candidates.length === 1) return "missing_ecount_identity";
  return "registry_missing";
}

const reviewRows = [];
const summaries = {};
for (const store of stores) {
  const snapshot = await readJson(join(work, "ecount-sales", `2026-08.${store}.json`));
  const lines = snapshot.salesLines.filter((line) => line?.isOfflineRevenue === true);
  const before = { total: lines.length, resolved: 0, unresolved: 0 };
  const after = { total: lines.length, resolved: 0, unresolved: 0, resolvedBy: {}, unresolvedBy: {} };
  const aggregate = new Map();
  for (const line of lines) {
    const beforeResult = resolveStoreProductIdentity(line, beforeIndex, brandRegistry);
    before[beforeResult.status === "resolved" ? "resolved" : "unresolved"] += 1;
    const result = resolveStoreProductIdentity(line, afterIndex, brandRegistry);
    if (result.status === "resolved") {
      after.resolved += 1;
      after.resolvedBy[result.method] = (after.resolvedBy[result.method] || 0) + 1;
      continue;
    }
    after.unresolved += 1;
    const candidates = candidatesFor(line);
    const reason = classify(line, result, candidates);
    after.unresolvedBy[reason] = (after.unresolvedBy[reason] || 0) + 1;
    const key = `${line.productName}\0${line.specification || ""}`;
    const row = aggregate.get(key) || {
      store,
      rawBrand: line.brandGroup || splitEcountProductName(line.productName).brandRaw || null,
      rawProductName: line.productName,
      rawSize: line.specification || null,
      normalizedIdentity: storeProductIdentityKey(line.productName, line.specification).replace("\0", " | "),
      salesQuantity: 0,
      salesRevenue: 0,
      salesLines: 0,
      candidateCanonicalProducts: candidates.map((entry) => ({
        canonicalProductId: entry.canonicalProductId,
        productName: entry.canonicalProductName,
        brandId: entry.brandId,
        brandName: entry.brandName,
        status: entry.status,
        verified: entry.verified,
        diagnosticType: entry.matching?.diagnosticType || []
      })),
      candidateEvidence: candidates.length ? ["normalized canonical or ECOUNT identity"] : [],
      unresolvedReason: reason,
      suggestedAction: candidates.length === 1 ? "Review existing Product Registry candidate" : candidates.length > 1 ? "Resolve canonical ambiguity manually" : "Create or source canonical product identity"
    };
    row.salesQuantity += Number(line.quantity || 0);
    row.salesRevenue += Number(line.salesAmount || 0);
    row.salesLines += 1;
    aggregate.set(key, row);
  }
  reviewRows.push(...aggregate.values());
  summaries[store] = { before, after };
}

reviewRows.sort((left, right) => right.salesRevenue - left.salesRevenue || right.salesQuantity - left.salesQuantity || left.rawProductName.localeCompare(right.rawProductName));
const generatedAt = new Date().toISOString();
const queue = {
  generatedAt,
  mode: "store_product_mapping_review_queue",
  source: stores.map((store) => `work/ecount-sales/2026-08.${store}.json`),
  summary: { stores: summaries, identities: reviewRows.length },
  entries: reviewRows
};
await writeFile(join(work, "store-product-mapping-review-queue.json"), `${JSON.stringify(queue, null, 2)}\n`);

const pct = (part, total) => total ? `${(part / total * 100).toFixed(2)}%` : "0.00%";
const reasonKeys = ["registry_missing", "missing_ecount_identity", "normalization_gap", "ambiguous", "insufficient_identity", "other"];
const topRows = reviewRows.slice(0, 30).map((row) => `| ${row.store} | ${row.rawBrand || "-"} | ${row.rawProductName.replaceAll("|", "\\|")} | ${row.rawSize || "-"} | ${row.salesQuantity} | ${row.salesRevenue} | ${row.candidateCanonicalProducts.map((item) => item.canonicalProductId).join(", ") || "-"} | ${row.candidateCanonicalProducts.length} | ${row.unresolvedReason} | ${row.suggestedAction} |`).join("\n");
const report = `# Store Product Mapping Coverage Diagnosis

- Generated: ${generatedAt}
- Product Registry는 읽기 전용이며 수정하지 않았다.
- BEFORE는 verified:true + confirmed exact identity만 사용한다.
- AFTER는 동일 exact identity와 규격이 하나의 canonical product로만 수렴하는 기존 exact_one_to_one/exact_one_to_many evidence를 추가 허용한다.

## 전체 현황

| Store | Revenue lines | BEFORE resolved | BEFORE unresolved | BEFORE coverage | AFTER resolved | AFTER unresolved | AFTER coverage |
|---|---:|---:|---:|---:|---:|---:|---:|
${stores.map((store) => { const { before, after } = summaries[store]; return `| ${store} | ${before.total} | ${before.resolved} | ${before.unresolved} | ${pct(before.resolved, before.total)} | ${after.resolved} | ${after.unresolved} | ${pct(after.resolved, after.total)} |`; }).join("\n")}

## AFTER unresolved 원인

| reason | APGUJEONG | VAIL |
|---|---:|---:|
${reasonKeys.map((reason) => `| ${reason} | ${summaries.APGUJEONG.after.unresolvedBy[reason] || 0} | ${summaries.VAIL.after.unresolvedBy[reason] || 0} |`).join("\n")}

## 영향도가 큰 unresolved identity

| store | raw brand | raw product name | size | quantity | revenue | candidate | count | reason | proposed action |
|---|---|---|---|---:|---:|---|---:|---|---|
${topRows}

## PACOSPLY / WonderLand T-shirts BLACK

Product Registry의 CP-C24-14086 하나에만 연결되고, size 2가 existing matchedProducts의 PAC261ST00202와 exact normalized match다. 같은 exact key를 소유한 다른 canonical product가 없고 Brand Master의 PACOSPLY가 B00000ZT로 일치하므로 AFTER에서는 deterministic_registry_alias로 안전하게 연결한다. Product Registry 자체의 ambiguous/verified 상태는 변경하지 않는다.

## Review queue

- Path: work/store-product-mapping-review-queue.json
- Aggregated unresolved identities: ${reviewRows.length}
- 동일 상품/규격 반복 판매는 한 entry로 집계했다.
`;
await writeFile(join(root, "docs", "reports", "STORE-PRODUCT-MAPPING-COVERAGE-DIAGNOSIS.md"), report);

console.log(JSON.stringify({ generatedAt, summaries, reviewQueueEntries: reviewRows.length }, null, 2));
