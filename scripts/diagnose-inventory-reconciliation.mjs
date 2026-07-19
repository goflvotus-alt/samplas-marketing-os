#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const defaultOutputPath = join(workDir, "inventory-intelligence-candidates.json");

export const DEFAULT_THRESHOLDS = Object.freeze({
  absoluteToleranceUnits: 1,
  relativeToleranceRate: 0.02,
  stockDifferenceFormula: "ecountStock - cafe24Stock",
  differenceRateFormula: "absoluteDifference / max(abs(ecountStock), abs(cafe24Stock))"
});

const CONFIRMED_MATCH_STATUSES = new Set([
  "confirmed",
  "matched",
  "approved",
  "manually_confirmed",
  "manual_confirmed",
  "verified"
]);

const STATUS_SORT_ORDER = {
  duplicate_mapping: 0,
  invalid_value: 1,
  missing_ecount: 2,
  missing_cafe24: 2,
  mismatch: 3,
  within_tolerance: 4,
  exact_match: 5,
  excluded: 6
};

function parseCliArgs(argv) {
  const options = { dryRun: false, output: defaultOutputPath, top: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--output") options.output = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--output=")) options.output = resolve(rootDir, arg.slice("--output=".length));
    else if (arg === "--top") options.top = Math.max(1, Number(argv[++index]) || 20);
    else if (arg.startsWith("--top=")) options.top = Math.max(1, Number(arg.slice("--top=".length)) || 20);
  }
  return options;
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return { exists: false, data: null, error: null, stat: null };
  try {
    const [text, fileStat] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    return { exists: true, data: JSON.parse(text), error: null, stat: fileStat };
  } catch (error) {
    return { exists: true, data: null, error: error.message, stat: null };
  }
}

function sourceMeta(filePath, loaded) {
  return {
    path: filePath.replace(`${rootDir}/`, ""),
    exists: loaded.exists,
    modifiedAt: loaded.stat ? loaded.stat.mtime.toISOString() : null,
    error: loaded.error || null
  };
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.mappings)) return payload.mappings;
  if (Array.isArray(payload?.Data?.Result)) return payload.Data.Result;
  if (payload?.products && typeof payload.products === "object") return Object.entries(payload.products).map(([key, value]) => ({ productId: key, ...value }));
  if (payload?.matches && typeof payload.matches === "object") return Object.entries(payload.matches).map(([key, value]) => ({ productId: key, ...value }));
  return [];
}

function firstNonEmpty(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

export function normalizeInventoryValue(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { value: null, status: "missing", raw };
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { value: raw, status: raw < 0 ? "negative" : "valid", raw } : { value: null, status: "invalid", raw };
  }
  const text = String(raw).trim().replace(/,/g, "");
  const negativeByParens = /^\(.+\)$/.test(text);
  const normalized = negativeByParens ? `-${text.slice(1, -1)}` : text;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return { value: null, status: "invalid", raw };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { value: null, status: "invalid", raw };
  return { value, status: value < 0 ? "negative" : "valid", raw };
}

function normalizeMatchStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isConfirmedMatch(entry) {
  const status = normalizeMatchStatus(firstNonEmpty(entry, ["matchStatus", "status", "state", "reviewStatus"]));
  return CONFIRMED_MATCH_STATUSES.has(status);
}

function matchStatus(entry) {
  return normalizeMatchStatus(firstNonEmpty(entry, ["matchStatus", "status", "state", "reviewStatus"])) || null;
}

function canonicalMatchEntry(entry, sourcePath) {
  const productId = firstNonEmpty(entry, ["productId", "canonicalProductId", "canonical_product_id", "id"]);
  const ecountProductCode = firstNonEmpty(entry, ["ecountProductCode", "ecount_product_code", "PROD_CD", "prodCd", "productCodeEcount"]);
  const cafe24ProductId = firstNonEmpty(entry, ["cafe24ProductId", "cafe24_product_id", "cafe24ProductNo", "productNo", "product_no"]);
  return {
    productId: productId === null ? null : String(productId),
    brandId: firstNonEmpty(entry, ["brandId", "brand_code", "brandCode", "brand"]),
    canonicalProductName: firstNonEmpty(entry, ["canonicalProductName", "productName", "product_name", "name"]),
    ecountProductCode: ecountProductCode === null ? null : String(ecountProductCode).trim(),
    cafe24ProductId: cafe24ProductId === null ? null : String(cafe24ProductId).trim(),
    cafe24VariantIds: normalizeVariantIds(firstNonEmpty(entry, ["cafe24VariantIds", "variantIds", "variants"])),
    matchStatus: matchStatus(entry),
    matchMethod: firstNonEmpty(entry, ["matchMethod", "method", "source"]),
    matchConfidence: firstNonEmpty(entry, ["matchConfidence", "confidence"]),
    raw: entry,
    sourcePath
  };
}

function normalizeVariantIds(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry?.variantCode || entry?.variant_code || entry?.id || entry)).filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

async function findMatchingRegistrySources() {
  const candidateFiles = [
    "work/inventory-matching-registry.json",
    "work/product-inventory-matching-registry.json",
    "work/canonical-product-registry.json",
    "work/canonical-product-matching-registry.json",
    "work/inventory-intelligence-matches.json",
    "work/product-matching-registry.json"
  ];
  const loaded = [];
  for (const relativePath of candidateFiles) {
    const absolutePath = join(rootDir, relativePath);
    const result = await readJsonIfExists(absolutePath);
    if (!result.exists) continue;
    loaded.push({ relativePath, result, entries: extractList(result.data).map((entry) => canonicalMatchEntry(entry, relativePath)) });
  }
  return loaded;
}

async function latestProductDashboardSource() {
  let files = [];
  try {
    files = (await readdir(workDir)).filter((name) => /^product-dashboard-proxy-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(name));
  } catch {
    return null;
  }
  const candidates = [];
  for (const file of files) {
    const absolutePath = join(workDir, file);
    const loaded = await readJsonIfExists(absolutePath);
    const products = extractList(loaded.data);
    if (products.length) candidates.push({ relativePath: `work/${file}`, loaded, products, mtimeMs: loaded.stat?.mtimeMs || 0 });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.relativePath.localeCompare(left.relativePath));
  return candidates[0] || null;
}

function buildEcountInventoryIndex(latestRows) {
  const index = new Map();
  for (const row of latestRows) {
    const code = firstNonEmpty(row, ["productCode", "PROD_CD", "prodCd"]);
    if (!code) continue;
    const normalized = normalizeInventoryValue(firstNonEmpty(row, ["stockQuantity", "BAL_QTY", "quantity"]));
    index.set(String(code).trim(), { row, inventory: normalized });
  }
  return index;
}

function buildCafe24ProductIndex(products) {
  const index = new Map();
  for (const product of products) {
    const productId = firstNonEmpty(product, ["productNo", "product_no", "cafe24ProductId", "id"]);
    if (productId === null) continue;
    const inventory = normalizeInventoryValue(product.inventoryQuantity);
    const variantFlags = variantInventoryFlags(product.options || product.variants || []);
    index.set(String(productId).trim(), { product, inventory, variantFlags });
  }
  return index;
}

function variantInventoryFlags(variants) {
  if (!Array.isArray(variants) || !variants.length) return [];
  let withValue = 0;
  let withoutValue = 0;
  for (const variant of variants) {
    const raw = firstNonEmpty(variant, ["quantity", "inventoryQuantity", "stockQuantity"]);
    const normalized = normalizeInventoryValue(raw);
    if (normalized.status === "missing" || normalized.status === "invalid") withoutValue += 1;
    else withValue += 1;
  }
  if (withValue > 0 && withoutValue > 0) return ["partial_variant_inventory"];
  if (withValue === 0 && withoutValue > 0) return ["missing_variant_inventory"];
  return [];
}

export function reconcileInventoryPair(match, ecountEntry, cafe24Entry, duplicateFlags = [], thresholds = DEFAULT_THRESHOLDS) {
  const flags = [...duplicateFlags];
  const ecount = ecountEntry?.inventory || { value: null, status: "missing", raw: null };
  const cafe24 = cafe24Entry?.inventory || { value: null, status: "missing", raw: null };
  if (ecount.status === "negative") flags.push("negative_ecount_inventory");
  if (cafe24.status === "negative") flags.push("negative_cafe24_inventory");
  flags.push(...(cafe24Entry?.variantFlags || []));

  let reconciliationStatus;
  let stockDifference = null;
  let absoluteDifference = null;
  let differenceRate = null;

  if (duplicateFlags.length) {
    reconciliationStatus = "duplicate_mapping";
  } else if (!ecountEntry || ecount.status === "missing") {
    reconciliationStatus = "missing_ecount";
    flags.push("missing_ecount_inventory");
  } else if (!cafe24Entry || cafe24.status === "missing") {
    reconciliationStatus = "missing_cafe24";
    flags.push("missing_cafe24_inventory");
  } else if ([ecount.status, cafe24.status].includes("invalid") || [ecount.status, cafe24.status].includes("negative")) {
    reconciliationStatus = "invalid_value";
    if (ecount.status === "invalid") flags.push("invalid_ecount_inventory");
    if (cafe24.status === "invalid") flags.push("invalid_cafe24_inventory");
  } else {
    stockDifference = ecount.value - cafe24.value;
    absoluteDifference = Math.abs(stockDifference);
    const denominator = Math.max(Math.abs(ecount.value), Math.abs(cafe24.value));
    differenceRate = denominator === 0 ? 0 : absoluteDifference / denominator;
    if (absoluteDifference === 0) reconciliationStatus = "exact_match";
    else if (absoluteDifference <= thresholds.absoluteToleranceUnits || differenceRate <= thresholds.relativeToleranceRate) reconciliationStatus = "within_tolerance";
    else reconciliationStatus = "mismatch";
  }

  return {
    productId: match.productId,
    brandId: match.brandId || cafe24Entry?.product?.brand || null,
    canonicalProductName: match.canonicalProductName || cafe24Entry?.product?.productName || ecountEntry?.row?.productName || null,
    ecountProductCode: match.ecountProductCode,
    cafe24ProductId: match.cafe24ProductId,
    cafe24VariantIds: match.cafe24VariantIds || [],
    matchStatus: match.matchStatus,
    matchMethod: match.matchMethod || null,
    matchConfidence: match.matchConfidence ?? null,
    ecountStock: ecount.value,
    cafe24Stock: cafe24.value,
    stockDifference,
    absoluteDifference,
    differenceRate,
    reconciliationStatus,
    dataQualityFlags: [...new Set(flags)].sort(),
    sourceRefs: {
      match: match.sourcePath || null,
      ecount: ecountEntry ? "work/ecount-inventory/latest.json" : null,
      cafe24: cafe24Entry?.product?.sourceRef || null
    },
    rawInventoryValues: {
      ecount: ecount.raw,
      cafe24: cafe24.raw
    }
  };
}

function duplicateFlagsForMatches(matches) {
  const byEcount = new Map();
  const byCafe24 = new Map();
  const byProductId = new Map();
  for (const match of matches) {
    pushMap(byEcount, match.ecountProductCode, match);
    pushMap(byCafe24, match.cafe24ProductId, match);
    pushMap(byProductId, match.productId, match);
  }
  const flags = new Map();
  for (const match of matches) flags.set(match, []);
  for (const [key, list] of byEcount) if (key && list.length > 1) for (const match of list) flags.get(match).push("duplicate_ecount_product_code");
  for (const [key, list] of byCafe24) if (key && list.length > 1) for (const match of list) flags.get(match).push("duplicate_cafe24_product_id");
  for (const [key, list] of byProductId) if (key && list.length > 1) for (const match of list) flags.get(match).push("duplicate_product_id");
  return flags;
}

function pushMap(map, key, value) {
  if (key === null || key === undefined || key === "") return;
  const normalized = String(key);
  const list = map.get(normalized) || [];
  list.push(value);
  map.set(normalized, list);
}

export function summarizeItems(items, excludedUnconfirmedMatchCount = 0) {
  const comparable = items.filter((item) => !["duplicate_mapping", "invalid_value", "missing_ecount", "missing_cafe24", "excluded"].includes(item.reconciliationStatus));
  const exactMatchCount = items.filter((item) => item.reconciliationStatus === "exact_match").length;
  const withinToleranceCount = items.filter((item) => item.reconciliationStatus === "within_tolerance").length;
  const mismatchCount = items.filter((item) => item.reconciliationStatus === "mismatch").length;
  const missingEcountInventoryCount = items.filter((item) => item.reconciliationStatus === "missing_ecount").length;
  const missingCafe24InventoryCount = items.filter((item) => item.reconciliationStatus === "missing_cafe24").length;
  const invalidInventoryValueCount = items.filter((item) => item.reconciliationStatus === "invalid_value").length;
  const duplicateMappingCount = items.filter((item) => item.reconciliationStatus === "duplicate_mapping").length;
  const totalEcountStock = comparable.reduce((total, item) => total + (Number.isFinite(item.ecountStock) ? item.ecountStock : 0), 0);
  const totalCafe24Stock = comparable.reduce((total, item) => total + (Number.isFinite(item.cafe24Stock) ? item.cafe24Stock : 0), 0);
  const totalAbsoluteDifference = comparable.reduce((total, item) => total + (Number.isFinite(item.absoluteDifference) ? item.absoluteDifference : 0), 0);
  const comparedCount = comparable.length;
  return {
    confirmedMatchCount: items.length,
    comparedCount,
    exactMatchCount,
    withinToleranceCount,
    mismatchCount,
    missingEcountInventoryCount,
    missingCafe24InventoryCount,
    invalidInventoryValueCount,
    duplicateMappingCount,
    excludedUnconfirmedMatchCount,
    totalEcountStock,
    totalCafe24Stock,
    totalAbsoluteDifference,
    exactMatchRate: comparedCount ? exactMatchCount / comparedCount : null,
    withinToleranceRate: comparedCount ? (exactMatchCount + withinToleranceCount) / comparedCount : null,
    mismatchRate: comparedCount ? mismatchCount / comparedCount : null
  };
}

function sortItems(items) {
  return [...items].sort((left, right) => {
    const statusDiff = (STATUS_SORT_ORDER[left.reconciliationStatus] ?? 99) - (STATUS_SORT_ORDER[right.reconciliationStatus] ?? 99);
    if (statusDiff) return statusDiff;
    return (right.absoluteDifference ?? -1) - (left.absoluteDifference ?? -1);
  });
}

export async function buildInventoryReconciliationDiagnostic(options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const ecountLatestPath = join(rootDir, "work/ecount-inventory/latest.json");
  const rawInventoryPath = join(rootDir, "work/ecount-inventory/raw-inventory.json");
  const rawProductsPath = join(rootDir, "work/ecount-inventory/raw-products.json");
  const ecountDiagnosticPath = join(rootDir, "work/ecount-inventory/diagnostic.json");
  const [ecountLatest, rawInventory, rawProducts, ecountDiagnostic, matchingSources, dashboardSource] = await Promise.all([
    readJsonIfExists(ecountLatestPath),
    readJsonIfExists(rawInventoryPath),
    readJsonIfExists(rawProductsPath),
    readJsonIfExists(ecountDiagnosticPath),
    findMatchingRegistrySources(),
    latestProductDashboardSource()
  ]);

  const allMatchEntries = matchingSources.flatMap((source) => source.entries);
  const confirmedMatches = allMatchEntries.filter((entry) => isConfirmedMatch(entry) && entry.ecountProductCode && entry.cafe24ProductId);
  const excludedUnconfirmedMatchCount = allMatchEntries.length - confirmedMatches.length;
  const duplicateFlags = duplicateFlagsForMatches(confirmedMatches);
  const ecountIndex = buildEcountInventoryIndex(extractList(ecountLatest.data));
  const cafe24Products = (dashboardSource?.products || []).map((product) => ({ ...product, sourceRef: dashboardSource.relativePath }));
  const cafe24Index = buildCafe24ProductIndex(cafe24Products);

  const items = sortItems(confirmedMatches.map((match) => reconcileInventoryPair(
    match,
    ecountIndex.get(match.ecountProductCode),
    cafe24Index.get(match.cafe24ProductId),
    duplicateFlags.get(match) || [],
    thresholds
  )));

  const summary = summarizeItems(items, excludedUnconfirmedMatchCount);
  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only_diagnostic",
    sources: {
      schema: { path: "config/inventory-intelligence-schema.json" },
      ecountLatest: sourceMeta(ecountLatestPath, ecountLatest),
      ecountRawInventory: sourceMeta(rawInventoryPath, rawInventory),
      ecountRawProducts: sourceMeta(rawProductsPath, rawProducts),
      ecountSyncDiagnostic: sourceMeta(ecountDiagnosticPath, ecountDiagnostic),
      cafe24ProductDashboard: dashboardSource ? sourceMeta(join(rootDir, dashboardSource.relativePath), dashboardSource.loaded) : { exists: false, error: "No product-dashboard-proxy cache found" },
      matchingRegistries: matchingSources.map((source) => ({ ...sourceMeta(join(rootDir, source.relativePath), source.result), entryCount: source.entries.length })),
      matchingRegistryStatus: matchingSources.length ? "loaded" : "not_found"
    },
    summary,
    thresholds,
    items
  };
}

function printSummary(result, top) {
  const s = result.summary;
  const pct = (value) => value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
  console.log("Inventory reconciliation diagnostic");
  console.log(`- 확정 매칭 수: ${s.confirmedMatchCount}`);
  console.log(`- 실제 비교 성공 수: ${s.comparedCount}`);
  console.log(`- 완전 일치: ${s.exactMatchCount} (${pct(s.exactMatchRate)})`);
  console.log(`- 허용 오차 내 일치: ${s.exactMatchCount + s.withinToleranceCount} (${pct(s.withinToleranceRate)})`);
  console.log(`- 불일치: ${s.mismatchCount} (${pct(s.mismatchRate)})`);
  console.log(`- 누락: ECOUNT ${s.missingEcountInventoryCount}, Cafe24 ${s.missingCafe24InventoryCount}`);
  console.log(`- 비정상 값: ${s.invalidInventoryValueCount}`);
  console.log(`- 중복 매핑: ${s.duplicateMappingCount}`);
  console.log(`- ECOUNT 총재고: ${s.totalEcountStock}`);
  console.log(`- Cafe24 총재고: ${s.totalCafe24Stock}`);
  console.log(`- 총 절대 차이: ${s.totalAbsoluteDifference}`);
  if (result.sources.matchingRegistryStatus === "not_found") {
    console.log("- Matching Registry: 확인 불가(not_found). 자동 추정 매칭은 수행하지 않았습니다.");
  }
  const mismatches = result.items.filter((item) => ["duplicate_mapping", "invalid_value", "missing_ecount", "missing_cafe24", "mismatch"].includes(item.reconciliationStatus)).slice(0, top);
  console.log(`- 차이가 큰 상품 TOP ${top}:`);
  if (!mismatches.length) {
    console.log("  (표시할 상품 없음)");
  } else {
    for (const item of mismatches) {
      console.log(`  ${item.reconciliationStatus} | ${item.canonicalProductName || item.productId || item.cafe24ProductId || item.ecountProductCode} | ECOUNT ${item.ecountStock ?? "n/a"} / Cafe24 ${item.cafe24Stock ?? "n/a"} / diff ${item.absoluteDifference ?? "n/a"}`);
    }
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await buildInventoryReconciliationDiagnostic(options);
  printSummary(result, options.top);
  if (!options.dryRun) {
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`- output: ${options.output.replace(`${rootDir}/`, "")}`);
  } else {
    console.log("- dry-run: 결과 파일을 쓰지 않았습니다.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
