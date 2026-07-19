#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");

const OUTPUTS = Object.freeze({
  registry: join(workDir, "canonical-product-matching-registry.json"),
  diagnostic: join(workDir, "canonical-product-matching-diagnostic.json"),
  candidates: join(workDir, "canonical-product-matching-candidates.json")
});

const CONFIRMED_STATUS = new Set(["confirmed", "matched", "approved", "manually_confirmed", "manual_confirmed", "verified"]);
const REJECTED_STATUS = new Set(["rejected", "unmatched"]);

export const MATCH_STATUS_VALUES = Object.freeze([
  "confirmed",
  "candidate",
  "ambiguous",
  "duplicate",
  "rejected",
  "unresolved",
  "missing_ecount",
  "missing_cafe24"
]);

const CONFIDENCE_FORMULA = "manual/existing=1.0; unique barcode=0.98; unique product code=0.92; exact normalized name=0.72; normalized name=0.62; brand bonus +0.05; option bonus +0.03; brand conflict cap 0.49; multiple candidate cap 0.69";
const CONFIRMED_POLICY = "Only existing manual/registry mappings, unique barcode matches, or unique product-code matches can be auto-confirmed. Name-only and brand-only matches remain candidate or ambiguous.";

function parseCliArgs(argv) {
  const options = { dryRun: false, top: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
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
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.items)) return payload.items;
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

function normalizeKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeProductName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\[\](){}:：,._/\\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactName(value) {
  return normalizeProductName(value).replace(/\s+/g, "");
}

function extractCafe24BrandTokens(product) {
  const name = String(product?.productName || "");
  const bracket = name.match(/^\s*\[([^\]]+)\]/);
  if (!bracket) return [];
  return bracket[1].split(/[:：/|]/).map((part) => normalizeProductName(part)).filter(Boolean);
}

function normalizeEcountProduct(row) {
  return {
    productCode: String(firstNonEmpty(row, ["productCode", "PROD_CD", "prodCd"]) ?? "").trim(),
    productName: firstNonEmpty(row, ["productName", "PROD_DES", "prodDes"]),
    specification: firstNonEmpty(row, ["specification", "SIZE_DES", "SPEC_DES"]),
    barcode: String(firstNonEmpty(row, ["barcode", "BAR_CODE", "BARCODE"]) ?? "").trim() || null,
    raw: row
  };
}

function normalizeCafe24Product(product) {
  const productNo = String(firstNonEmpty(product, ["productNo", "product_no", "id"]) ?? "").trim();
  const options = Array.isArray(product.options) ? product.options : Array.isArray(product.variants) ? product.variants : [];
  return {
    productNo,
    productCode: String(firstNonEmpty(product, ["productCode", "product_code", "custom_product_code"]) ?? "").trim() || null,
    productName: firstNonEmpty(product, ["productName", "product_name", "eng_product_name"]),
    brandId: firstNonEmpty(product, ["brand", "brand_code", "brandCode"]),
    manufacturerCode: String(firstNonEmpty(product, ["manufacturer_code", "manufacturerCode", "supplierCode"]) ?? "").trim() || null,
    variantIds: options.map((option) => String(firstNonEmpty(option, ["variantCode", "variant_code", "id"]) ?? "").trim()).filter(Boolean),
    optionSummaries: options.map((option) => String(firstNonEmpty(option, ["optionSummary", "option_summary", "name"]) ?? "").trim()).filter(Boolean),
    raw: product
  };
}

function addIndex(index, key, value) {
  if (!key) return;
  const normalized = normalizeKey(key);
  if (!normalized) return;
  const list = index.get(normalized) || [];
  list.push(value);
  index.set(normalized, list);
}

function makeIndexes(ecountProducts, cafe24Products) {
  const ecount = { byCode: new Map(), byBarcode: new Map(), byName: new Map(), byCompactName: new Map() };
  const cafe24 = { byProductNo: new Map(), byProductCode: new Map(), byManufacturer: new Map(), byVariant: new Map(), byName: new Map(), byCompactName: new Map() };
  for (const item of ecountProducts) {
    addIndex(ecount.byCode, item.productCode, item);
    addIndex(ecount.byBarcode, item.barcode, item);
    addIndex(ecount.byName, normalizeProductName(item.productName), item);
    addIndex(ecount.byCompactName, compactName(item.productName), item);
  }
  for (const item of cafe24Products) {
    addIndex(cafe24.byProductNo, item.productNo, item);
    addIndex(cafe24.byProductCode, item.productCode, item);
    addIndex(cafe24.byManufacturer, item.manufacturerCode, item);
    for (const variantId of item.variantIds) addIndex(cafe24.byVariant, variantId, item);
    addIndex(cafe24.byName, normalizeProductName(item.productName), item);
    addIndex(cafe24.byCompactName, compactName(item.productName), item);
  }
  return { ecount, cafe24 };
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
    const loaded = await readJsonIfExists(join(workDir, file));
    const products = extractList(loaded.data);
    if (products.length) candidates.push({ relativePath: `work/${file}`, loaded, products, mtimeMs: loaded.stat?.mtimeMs || 0 });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.relativePath.localeCompare(left.relativePath));
  return candidates[0] || null;
}

async function findExistingRegistrySources() {
  const paths = [
    "work/canonical-product-matching-registry.json",
    "work/product-matching-registry.json",
    "work/inventory-matching-registry.json",
    "work/product-inventory-matching-registry.json",
    "work/canonical-product-registry.json",
    "work/inventory-intelligence-matches.json"
  ];
  const sources = [];
  for (const relativePath of paths) {
    const absolutePath = join(rootDir, relativePath);
    const loaded = await readJsonIfExists(absolutePath);
    if (!loaded.exists) continue;
    sources.push({ relativePath, loaded, entries: extractList(loaded.data) });
  }
  return sources;
}

function existingRegistryMatch(entry, sourcePath) {
  const status = normalizeKey(firstNonEmpty(entry, ["matchStatus", "status", "state", "reviewStatus"])).toLowerCase();
  const ecountProductCode = String(firstNonEmpty(entry, ["ecountProductCode", "ecount_product_code", "PROD_CD", "prodCd"]) ?? "").trim();
  const cafe24ProductId = String(firstNonEmpty(entry, ["cafe24ProductId", "cafe24_product_id", "productNo", "product_no"]) ?? "").trim();
  if (!ecountProductCode || !cafe24ProductId) return null;
  return {
    productId: String(firstNonEmpty(entry, ["productId", "canonicalProductId", "id"]) ?? `${ecountProductCode}__${cafe24ProductId}`),
    brandId: firstNonEmpty(entry, ["brandId", "brand_code", "brand"]),
    canonicalProductName: firstNonEmpty(entry, ["canonicalProductName", "productName", "name"]),
    ecountProductCode,
    cafe24ProductId,
    variantIds: normalizeArray(firstNonEmpty(entry, ["variantIds", "cafe24VariantIds", "variants"])),
    matchStatus: CONFIRMED_STATUS.has(status) ? "confirmed" : REJECTED_STATUS.has(status) ? "rejected" : "candidate",
    matchMethod: "existing_registry",
    confidence: CONFIRMED_STATUS.has(status) ? 1 : 0.7,
    evidence: [{ type: "existing_registry", source: sourcePath, value: status || null, weight: 1 }],
    pendingReasons: CONFIRMED_STATUS.has(status) ? [] : ["existing_registry_not_confirmed"],
    sourceRefs: { existingRegistry: sourcePath }
  };
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry?.variantCode || entry?.variant_code || entry?.id || entry)).filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

function hasBrandConflict(ecountProduct, cafe24Product) {
  const ecountName = normalizeProductName(ecountProduct.productName);
  const brandTokens = extractCafe24BrandTokens(cafe24Product);
  if (!brandTokens.length) return false;
  return !brandTokens.some((token) => ecountName.includes(token));
}

function scoreCandidate({ method, evidence, pendingReasons }) {
  let score = 0;
  if (method === "manual_mapping" || method === "existing_registry") score = 1;
  else if (evidence.some((item) => item.type === "barcode")) score = 0.98;
  else if (evidence.some((item) => item.type === "product_code")) score = 0.92;
  else if (evidence.some((item) => item.type === "exact_name")) score = 0.72;
  else if (evidence.some((item) => item.type === "normalized_name")) score = 0.62;
  if (evidence.some((item) => item.type === "brand")) score += 0.05;
  if (evidence.some((item) => item.type === "option")) score += 0.03;
  if (pendingReasons.includes("brand_conflict")) score = Math.min(score, 0.49);
  if (pendingReasons.includes("multiple_candidates")) score = Math.min(score, 0.69);
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

function makeMatch(ecountProduct, cafe24Product, details) {
  const now = details.now;
  const pendingReasons = [...new Set(details.pendingReasons || [])];
  const evidence = details.evidence || [];
  const confidence = details.confidence ?? scoreCandidate({ method: details.method, evidence, pendingReasons });
  return {
    productId: `ecount:${ecountProduct?.productCode || "missing"}|cafe24:${cafe24Product?.productNo || "missing"}`,
    brandId: cafe24Product?.brandId || null,
    canonicalProductName: cafe24Product?.productName || ecountProduct?.productName || null,
    ecountProductCode: ecountProduct?.productCode || null,
    cafe24ProductId: cafe24Product?.productNo || null,
    variantIds: cafe24Product?.variantIds || [],
    matchStatus: details.status,
    matchMethod: details.method,
    confidence,
    evidence,
    pendingReasons,
    createdAt: now,
    updatedAt: now,
    sourceRefs: {
      ecount: ecountProduct ? "work/ecount-inventory/latest.json" : null,
      cafe24: cafe24Product?.sourceRef || null
    }
  };
}

function uniquePairCandidates(ecountList, cafe24List, method, evidenceType, now) {
  if (ecountList.length !== 1 || cafe24List.length !== 1) return [];
  const ecountProduct = ecountList[0];
  const cafe24Product = cafe24List[0];
  const pendingReasons = [];
  const evidence = [{ type: evidenceType, value: evidenceType.includes("name") ? normalizeProductName(cafe24Product.productName) : null, weight: evidenceType === "barcode" ? 1 : evidenceType === "product_code" ? 0.92 : 0.72 }];
  if (hasBrandConflict(ecountProduct, cafe24Product)) pendingReasons.push("brand_conflict");
  else if (extractCafe24BrandTokens(cafe24Product).length) evidence.push({ type: "brand", value: extractCafe24BrandTokens(cafe24Product), weight: 0.05 });
  const status = (evidenceType === "barcode" || evidenceType === "product_code") && !pendingReasons.includes("brand_conflict") ? "confirmed" : "candidate";
  if (status === "candidate" && evidenceType.includes("name")) pendingReasons.push("name_similarity_only", "manual_review_required");
  return [makeMatch(ecountProduct, cafe24Product, { now, status, method, evidence, pendingReasons })];
}

function ambiguousCandidates(ecountList, cafe24List, method, evidenceType, now) {
  if (ecountList.length <= 1 && cafe24List.length <= 1) return [];
  const matches = [];
  for (const ecountProduct of ecountList.slice(0, 10)) {
    for (const cafe24Product of cafe24List.slice(0, 10)) {
      matches.push(makeMatch(ecountProduct, cafe24Product, {
        now,
        status: "ambiguous",
        method,
        evidence: [{ type: evidenceType, value: evidenceType.includes("name") ? normalizeProductName(cafe24Product.productName) : null, weight: 0.4 }],
        pendingReasons: ["multiple_candidates", "manual_review_required"]
      }));
    }
  }
  return matches;
}

export function buildCandidateMatches({ ecountProducts, cafe24Products, existingRegistryEntries = [], now = new Date().toISOString() }) {
  const indexes = makeIndexes(ecountProducts, cafe24Products);
  const matches = [];
  const seenPairs = new Set();
  const matchedEcount = new Set();
  const matchedCafe24 = new Set();

  for (const existing of existingRegistryEntries) {
    if (!existing) continue;
    const ecountProduct = (indexes.ecount.byCode.get(normalizeKey(existing.ecountProductCode)) || [])[0] || { productCode: existing.ecountProductCode, productName: existing.canonicalProductName };
    const cafe24Product = (indexes.cafe24.byProductNo.get(normalizeKey(existing.cafe24ProductId)) || [])[0] || { productNo: existing.cafe24ProductId, productName: existing.canonicalProductName, brandId: existing.brandId, variantIds: existing.variantIds };
    matches.push({ ...existing, createdAt: now, updatedAt: now });
    matchedEcount.add(ecountProduct.productCode);
    matchedCafe24.add(cafe24Product.productNo);
    seenPairs.add(`${existing.ecountProductCode}__${existing.cafe24ProductId}`);
  }

  const signalPasses = [
    { ecount: indexes.ecount.byBarcode, cafe24: indexes.cafe24.byProductCode, method: "barcode_to_product_code", evidenceType: "barcode" },
    { ecount: indexes.ecount.byBarcode, cafe24: indexes.cafe24.byManufacturer, method: "barcode_to_supplier_code", evidenceType: "barcode" },
    { ecount: indexes.ecount.byBarcode, cafe24: indexes.cafe24.byVariant, method: "barcode_to_variant", evidenceType: "barcode" },
    { ecount: indexes.ecount.byCode, cafe24: indexes.cafe24.byProductCode, method: "product_code", evidenceType: "product_code" },
    { ecount: indexes.ecount.byCode, cafe24: indexes.cafe24.byManufacturer, method: "product_code_to_supplier_code", evidenceType: "product_code" },
    { ecount: indexes.ecount.byName, cafe24: indexes.cafe24.byName, method: "exact_name", evidenceType: "exact_name" },
    { ecount: indexes.ecount.byCompactName, cafe24: indexes.cafe24.byCompactName, method: "normalized_name", evidenceType: "normalized_name" }
  ];

  for (const pass of signalPasses) {
    for (const [key, ecountList] of pass.ecount) {
      const cafe24List = pass.cafe24.get(key) || [];
      if (!cafe24List.length) continue;
      const generated = [
        ...uniquePairCandidates(ecountList, cafe24List, pass.method, pass.evidenceType, now),
        ...ambiguousCandidates(ecountList, cafe24List, pass.method, pass.evidenceType, now)
      ];
      for (const match of generated) {
        const pairKey = `${match.ecountProductCode}__${match.cafe24ProductId}`;
        if (seenPairs.has(pairKey)) continue;
        matches.push(match);
        seenPairs.add(pairKey);
        matchedEcount.add(match.ecountProductCode);
        matchedCafe24.add(match.cafe24ProductId);
      }
    }
  }

  for (const ecountProduct of ecountProducts) {
    if (matchedEcount.has(ecountProduct.productCode)) continue;
    matches.push(makeMatch(ecountProduct, null, {
      now,
      status: "missing_cafe24",
      method: "discovery",
      evidence: [{ type: "ecount_product", value: ecountProduct.productCode, weight: 0.1 }],
      pendingReasons: ["missing_cafe24", "manual_review_required"],
      confidence: 0
    }));
  }
  for (const cafe24Product of cafe24Products) {
    if (matchedCafe24.has(cafe24Product.productNo)) continue;
    matches.push(makeMatch(null, cafe24Product, {
      now,
      status: "missing_ecount",
      method: "discovery",
      evidence: [{ type: "cafe24_product", value: cafe24Product.productNo, weight: 0.1 }],
      pendingReasons: ["missing_ecount", "manual_review_required"],
      confidence: 0
    }));
  }

  return applyDuplicateStatus(matches);
}

function applyDuplicateStatus(matches) {
  const byEcount = new Map();
  const byCafe24 = new Map();
  const byProductId = new Map();
  for (const match of matches) {
    addDup(byEcount, match.ecountProductCode, match);
    addDup(byCafe24, match.cafe24ProductId, match);
    addDup(byProductId, match.productId, match);
  }
  const duplicateSet = new Set();
  for (const map of [byEcount, byCafe24, byProductId]) {
    for (const list of map.values()) if (list.length > 1) for (const match of list) duplicateSet.add(match);
  }
  return matches.map((match) => {
    if (!duplicateSet.has(match)) return match;
    const pendingReasons = [...new Set([...match.pendingReasons, "duplicate_mapping", "manual_review_required"])]
    if (match.matchStatus === "ambiguous") return { ...match, pendingReasons };
    return {
      ...match,
      matchStatus: "duplicate",
      pendingReasons
    };
  });
}

function addDup(map, key, match) {
  if (!key) return;
  const normalized = String(key);
  const list = map.get(normalized) || [];
  list.push(match);
  map.set(normalized, list);
}

function summarize(matches, ecountProducts, cafe24Products) {
  const byStatus = Object.fromEntries(MATCH_STATUS_VALUES.map((status) => [status, 0]));
  const byBrand = new Map();
  for (const match of matches) {
    byStatus[match.matchStatus] = (byStatus[match.matchStatus] || 0) + 1;
    const brandKey = match.brandId || "UNASSIGNED";
    const brand = byBrand.get(brandKey) || { brandId: brandKey, total: 0, confirmed: 0, candidate: 0, ambiguous: 0, duplicate: 0, missing: 0 };
    brand.total += 1;
    if (match.matchStatus === "confirmed") brand.confirmed += 1;
    else if (match.matchStatus === "candidate") brand.candidate += 1;
    else if (match.matchStatus === "ambiguous") brand.ambiguous += 1;
    else if (match.matchStatus === "duplicate") brand.duplicate += 1;
    else if (match.matchStatus === "missing_ecount" || match.matchStatus === "missing_cafe24") brand.missing += 1;
    byBrand.set(brandKey, brand);
  }
  const duplicateEcountProductCodes = duplicateKeys(matches.map((match) => match.ecountProductCode).filter(Boolean));
  const duplicateCafe24ProductIds = duplicateKeys(matches.map((match) => match.cafe24ProductId).filter(Boolean));
  const duplicateProductIds = duplicateKeys(matches.map((match) => match.productId).filter(Boolean));
  const confirmed = byStatus.confirmed || 0;
  return {
    ecountProductCount: ecountProducts.length,
    cafe24ProductCount: cafe24Products.length,
    totalMatchRows: matches.length,
    ...byStatus,
    coverage: {
      confirmedEcountCoverageRate: ecountProducts.length ? confirmed / ecountProducts.length : null,
      confirmedCafe24CoverageRate: cafe24Products.length ? confirmed / cafe24Products.length : null
    },
    duplicateDiagnostics: {
      ecountProductCodeCount: duplicateEcountProductCodes.length,
      cafe24ProductIdCount: duplicateCafe24ProductIds.length,
      productIdCount: duplicateProductIds.length,
      ecountProductCodes: duplicateEcountProductCodes.slice(0, 50),
      cafe24ProductIds: duplicateCafe24ProductIds.slice(0, 50),
      productIds: duplicateProductIds.slice(0, 50)
    },
    brandCoverage: [...byBrand.values()].sort((left, right) => right.total - left.total || left.brandId.localeCompare(right.brandId))
  };
}

function duplicateKeys(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function sortMatches(matches) {
  const order = { duplicate: 0, ambiguous: 1, candidate: 2, missing_ecount: 3, missing_cafe24: 3, unresolved: 4, rejected: 5, confirmed: 6 };
  return [...matches].sort((left, right) => (order[left.matchStatus] ?? 99) - (order[right.matchStatus] ?? 99) || right.confidence - left.confidence || String(left.canonicalProductName || "").localeCompare(String(right.canonicalProductName || "")));
}

export async function buildCanonicalProductMatchingRegistry() {
  const generatedAt = new Date().toISOString();
  const ecountLatestPath = join(rootDir, "work/ecount-inventory/latest.json");
  const rawProductsPath = join(rootDir, "work/ecount-inventory/raw-products.json");
  const inventoryPath = join(rootDir, "work/ecount-inventory/raw-inventory.json");
  const productBrandMapPath = join(rootDir, "work/product-brand-map.json");
  const brandMasterPath = join(rootDir, "work/brand-master.json");
  const [ecountLatest, rawProducts, rawInventory, productBrandMap, brandMaster, dashboardSource, existingSources] = await Promise.all([
    readJsonIfExists(ecountLatestPath),
    readJsonIfExists(rawProductsPath),
    readJsonIfExists(inventoryPath),
    readJsonIfExists(productBrandMapPath),
    readJsonIfExists(brandMasterPath),
    latestProductDashboardSource(),
    findExistingRegistrySources()
  ]);
  const ecountProducts = extractList(ecountLatest.data).map(normalizeEcountProduct).filter((item) => item.productCode);
  const cafe24Products = (dashboardSource?.products || []).map((product) => ({ ...normalizeCafe24Product(product), sourceRef: dashboardSource.relativePath })).filter((item) => item.productNo);
  const existingEntries = existingSources.flatMap((source) => source.entries.map((entry) => existingRegistryMatch(entry, source.relativePath)).filter(Boolean));
  const matches = sortMatches(buildCandidateMatches({ ecountProducts, cafe24Products, existingRegistryEntries: existingEntries, now: generatedAt }));
  const summary = summarize(matches, ecountProducts, cafe24Products);
  const sources = {
    schema: { path: "config/canonical-product-matching-registry-schema.json" },
    ecountLatest: sourceMeta(ecountLatestPath, ecountLatest),
    ecountRawProducts: sourceMeta(rawProductsPath, rawProducts),
    ecountRawInventory: sourceMeta(inventoryPath, rawInventory),
    cafe24ProductDashboard: dashboardSource ? sourceMeta(join(rootDir, dashboardSource.relativePath), dashboardSource.loaded) : { exists: false, error: "No product-dashboard-proxy cache found" },
    productBrandMap: sourceMeta(productBrandMapPath, productBrandMap),
    brandMaster: sourceMeta(brandMasterPath, brandMaster),
    existingRegistries: existingSources.map((source) => ({ ...sourceMeta(join(rootDir, source.relativePath), source.loaded), entryCount: source.entries.length }))
  };
  const registry = {
    generatedAt,
    mode: "read_only_discovery",
    metadata: {
      confidenceFormula: CONFIDENCE_FORMULA,
      confirmedPolicy: CONFIRMED_POLICY,
      statusValues: MATCH_STATUS_VALUES,
      evidenceTypes: ["barcode", "product_code", "supplier_code", "variant_code", "exact_name", "normalized_name", "brand", "option", "existing_registry", "manual_mapping", "ecount_product", "cafe24_product"]
    },
    sources,
    summary,
    matches
  };
  const candidates = {
    generatedAt,
    mode: "read_only_candidate_review",
    sources,
    summary: {
      candidate: summary.candidate,
      ambiguous: summary.ambiguous,
      duplicate: summary.duplicate,
      missingEcount: summary.missing_ecount,
      missingCafe24: summary.missing_cafe24
    },
    candidates: matches.filter((match) => match.matchStatus !== "confirmed")
  };
  const diagnostic = {
    generatedAt,
    mode: "read_only_diagnostic",
    sources,
    summary,
    availableSignals: inspectAvailableSignals(ecountProducts, cafe24Products),
    duplicate: summary.duplicate,
    brandCoverage: summary.brandCoverage,
    dataQuality: inspectDataQuality(ecountProducts, cafe24Products, existingSources)
  };
  return { registry, candidates, diagnostic };
}

function inspectAvailableSignals(ecountProducts, cafe24Products) {
  return {
    ecount: {
      productCodeCount: ecountProducts.filter((item) => item.productCode).length,
      barcodeCount: ecountProducts.filter((item) => item.barcode).length,
      productNameCount: ecountProducts.filter((item) => item.productName).length
    },
    cafe24: {
      productNoCount: cafe24Products.filter((item) => item.productNo).length,
      productCodeCount: cafe24Products.filter((item) => item.productCode).length,
      manufacturerCodeCount: cafe24Products.filter((item) => item.manufacturerCode).length,
      variantIdCount: cafe24Products.reduce((total, item) => total + item.variantIds.length, 0),
      productNameCount: cafe24Products.filter((item) => item.productName).length,
      brandIdCount: cafe24Products.filter((item) => item.brandId).length
    }
  };
}

function inspectDataQuality(ecountProducts, cafe24Products, existingSources) {
  return {
    existingRegistryCount: existingSources.length,
    ecountMissingBarcodeCount: ecountProducts.filter((item) => !item.barcode).length,
    cafe24MissingManufacturerCodeCount: cafe24Products.filter((item) => !item.manufacturerCode).length,
    cafe24MultipleVariantProductCount: cafe24Products.filter((item) => item.variantIds.length > 1).length
  };
}

function printSummary(result, top) {
  const s = result.registry.summary;
  const pct = (value) => value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
  console.log("Canonical product matching discovery");
  console.log(`- ECOUNT 상품: ${s.ecountProductCount}`);
  console.log(`- Cafe24 상품: ${s.cafe24ProductCount}`);
  console.log(`- confirmed: ${s.confirmed}`);
  console.log(`- candidate: ${s.candidate}`);
  console.log(`- ambiguous: ${s.ambiguous}`);
  console.log(`- duplicate: ${s.duplicate}`);
  console.log(`- missing_ecount: ${s.missing_ecount}`);
  console.log(`- missing_cafe24: ${s.missing_cafe24}`);
  console.log(`- ECOUNT confirmed coverage: ${pct(s.coverage.confirmedEcountCoverageRate)}`);
  console.log(`- Cafe24 confirmed coverage: ${pct(s.coverage.confirmedCafe24CoverageRate)}`);
  console.log(`- duplicate ECOUNT/Cafe24/productId: ${s.duplicateDiagnostics.ecountProductCodeCount}/${s.duplicateDiagnostics.cafe24ProductIdCount}/${s.duplicateDiagnostics.productIdCount}`);
  console.log(`- Candidate review TOP ${top}:`);
  const review = result.candidates.candidates.slice(0, top);
  if (!review.length) console.log("  (표시할 후보 없음)");
  for (const item of review) {
    console.log(`  ${item.matchStatus} ${item.confidence} | ${item.canonicalProductName || item.ecountProductCode || item.cafe24ProductId} | ${item.matchMethod} | ${item.pendingReasons.join(",") || "-"}`);
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await buildCanonicalProductMatchingRegistry();
  printSummary(result, options.top);
  if (options.dryRun) {
    console.log("- dry-run: 결과 파일을 쓰지 않았습니다.");
    return;
  }
  await writeFile(OUTPUTS.registry, `${JSON.stringify(result.registry, null, 2)}\n`, "utf8");
  await writeFile(OUTPUTS.diagnostic, `${JSON.stringify(result.diagnostic, null, 2)}\n`, "utf8");
  await writeFile(OUTPUTS.candidates, `${JSON.stringify(result.candidates, null, 2)}\n`, "utf8");
  console.log("- output: work/canonical-product-matching-registry.json");
  console.log("- output: work/canonical-product-matching-diagnostic.json");
  console.log("- output: work/canonical-product-matching-candidates.json");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
