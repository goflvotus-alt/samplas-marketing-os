import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productDashboardFlag = "--product-dashboard";
const productDashboardIndex = process.argv.indexOf(productDashboardFlag);
const productDashboardInput = productDashboardIndex >= 0 ? process.argv[productDashboardIndex + 1] : "";
if (!productDashboardInput || productDashboardInput.startsWith("--")) {
  throw new Error(`Usage: node scripts/build-brand-universe-candidates.mjs ${productDashboardFlag} <path>`);
}

const paths = {
  brandMaster: resolve(root, "work/brand-master.json"),
  productDashboard: resolve(productDashboardInput),
  ecountInventory: resolve(root, "work/ecount-inventory/raw-inventory.json"),
  productRegistry: resolve(root, "work/product-registry.json"),
  candidates: resolve(root, "work/brand-universe-candidates.json"),
  reviewQueue: resolve(root, "work/brand-universe-review-queue.json")
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const text = (value) => String(value ?? "").trim();
const number = (value) => Number(value || 0);
const productBrandCode = (product) => text(product?.brand || product?.brand_code || product?.brandCode || product?.mall_brand_code);
const isExcludedCafe24Product = (product) =>
  productBrandCode(product) === "B0000000" || /개인결제창|기프트/i.test(text(product?.productName || product?.product_name));
const isTrustedRegistryEntry = (entry) =>
  entry?.verified === true ||
  entry?.status === "confirmed" ||
  (entry?.confidence === 100 && Array.isArray(entry?.ecount?.matchedProducts) && entry.ecount.matchedProducts.length > 0);

function addToMap(map, key, value) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

function buildMasterIndex(brands) {
  const byCode = new Map();
  for (const brand of brands) {
    const code = text(brand?.brand_code);
    if (!code) continue;
    byCode.set(code, brand);
  }
  return { byCode };
}

function blankEvidence() {
  return {
    cafe24_sellable_product_count: 0,
    cafe24_inconsistent_stock_count: 0,
    ecount_positive_sku_count: 0,
    ecount_negative_sku_count: 0,
    ecount_zero_sku_count: 0
  };
}

const brandMaster = await readJson(paths.brandMaster);
const brands = Array.isArray(brandMaster) ? brandMaster : brandMaster?.brands;
if (!Array.isArray(brands)) throw new Error("brand-master.json brands array is required");
const master = buildMasterIndex(brands);

const cafe24Path = paths.productDashboard;
if (!existsSync(cafe24Path)) throw new Error(`Cafe24 product input is missing: ${cafe24Path}`);
const cafe24Data = await readJson(cafe24Path);
const products = Array.isArray(cafe24Data) ? cafe24Data : cafe24Data?.products;
if (!Array.isArray(products)) throw new Error("Cafe24 products array is required");
const requiredProductKeys = ["productNo", "productName", "display", "selling", "inventoryQuantity", "soldOut"];
for (const [index, product] of products.entries()) {
  if (!product || typeof product !== "object" || Array.isArray(product)) throw new Error(`Cafe24 product at index ${index} must be an object`);
  const missingKeys = requiredProductKeys.filter((key) => !(key in product));
  if (!productBrandCode(product)) missingKeys.push("brand");
  if (missingKeys.length) throw new Error(`Cafe24 product at index ${index} is missing required keys: ${missingKeys.join(", ")}`);
}

const inventoryData = await readJson(paths.ecountInventory);
const inventoryRows = inventoryData?.Data?.Result;
if (!Array.isArray(inventoryRows)) throw new Error("ECOUNT Data.Result array is required");

const registryData = await readJson(paths.productRegistry);
const registryEntries = registryData?.entries;
if (!Array.isArray(registryEntries)) throw new Error("product-registry entries array is required");

const generatedAt = new Date().toISOString();
const evidenceByBrand = new Map([...master.byCode].map(([code]) => [code, blankEvidence()]));
const sourcesByBrand = new Map([...master.byCode].map(([code]) => [code, new Set()]));
const reviewBrandCodes = new Set();
const stockWarningsByBrand = new Map();
const reviews = [];
const stats = {
  cafe24Excluded: 0,
  cafe24Sellable: 0,
  cafe24Inconsistent: 0,
  cafe24Canonical: 0,
  cafe24Unlinked: 0,
  ecountPositive: 0,
  ecountNegative: 0,
  ecountZero: 0,
  trustedRegistryMatches: 0,
  ecountUnmatched: 0,
  ecountNoExactMatch: 0,
  ecountUntrusted: 0,
  ecountConflicts: 0
};

function addReview({ sourceType, sourceKey, rawBrandName = "", candidateBrandCodes = [], reason, evidence = {}, blocking = true }) {
  const codes = [...new Set(candidateBrandCodes)].sort();
  if (blocking) for (const code of codes) if (master.byCode.has(code)) reviewBrandCodes.add(code);
  reviews.push({
    source_type: sourceType,
    source_key: text(sourceKey),
    raw_brand_name: text(rawBrandName),
    candidate_brand_codes: codes,
    reason,
    evidence,
    generated_at: generatedAt
  });
}

for (const product of products) {
  if (isExcludedCafe24Product(product)) {
    stats.cafe24Excluded += 1;
    continue;
  }
  const code = productBrandCode(product);
  const masterBrand = master.byCode.get(code);
  if (!masterBrand) {
    stats.cafe24Unlinked += 1;
    addReview({
      sourceType: "cafe24_product",
      sourceKey: product?.productNo,
      rawBrandName: code,
      reason: "missing_brand_master",
      evidence: { productNo: product?.productNo ?? null, productCode: product?.productCode ?? null, productName: product?.productName ?? null }
    });
    continue;
  }
  stats.cafe24Canonical += 1;
  const stock = number(product?.inventoryQuantity);
  const inconsistent = stock > 0 && product?.soldOut === true;
  const sellable = product?.display === "T" && product?.selling === "T" && stock > 0;
  if (inconsistent) {
    stats.cafe24Inconsistent += 1;
    evidenceByBrand.get(code).cafe24_inconsistent_stock_count += 1;
    addToMap(stockWarningsByBrand, code, product?.productNo);
  }
  if (sellable) {
    stats.cafe24Sellable += 1;
    evidenceByBrand.get(code).cafe24_sellable_product_count += 1;
    sourcesByBrand.get(code).add("cafe24_brand_code");
  }
}

for (const [code, productNos] of stockWarningsByBrand) {
  addReview({
    sourceType: "cafe24_brand",
    sourceKey: code,
    rawBrandName: master.byCode.get(code)?.brand_name,
    candidateBrandCodes: [code],
    reason: "inconsistent_stock_signal",
    evidence: {
      product_count: productNos.length,
      product_nos: [...new Set(productNos)].sort((left, right) => Number(left) - Number(right)),
      non_blocking: true
    },
    blocking: false
  });
}

const registryByProdCd = new Map();
for (const entry of registryEntries) {
  for (const matched of Array.isArray(entry?.ecount?.matchedProducts) ? entry.ecount.matchedProducts : []) {
    addToMap(registryByProdCd, text(matched?.prodCd), entry);
  }
}

for (const row of inventoryRows) {
  const prodCd = text(row?.PROD_CD);
  const quantity = number(row?.BAL_QTY);
  if (quantity > 0) stats.ecountPositive += 1;
  else if (quantity < 0) stats.ecountNegative += 1;
  else stats.ecountZero += 1;

  const entries = registryByProdCd.get(prodCd) || [];
  const trusted = entries.filter(isTrustedRegistryEntry);
  if (!trusted.length) {
    stats.ecountUnmatched += 1;
    const knownCodes = [...new Set(entries.map((entry) => text(entry?.brandId)).filter((code) => master.byCode.has(code)))];
    for (const code of knownCodes) reviewBrandCodes.add(code);
    if (entries.length) stats.ecountUntrusted += 1;
    else stats.ecountNoExactMatch += 1;
    continue;
  }

  const codes = [...new Set(trusted.map((entry) => text(entry?.brandId)).filter((code) => master.byCode.has(code)))];
  if (codes.length !== 1) {
    stats.ecountConflicts += 1;
    addReview({
      sourceType: "ecount_inventory",
      sourceKey: prodCd,
      rawBrandName: trusted.map((entry) => entry?.brandName).filter(Boolean).join(" | "),
      candidateBrandCodes: codes,
      reason: codes.length > 1 ? "conflicting_brand_mapping" : "missing_brand_master",
      evidence: { BAL_QTY: quantity, trustedEntryCount: trusted.length }
    });
    continue;
  }

  const code = codes[0];
  stats.trustedRegistryMatches += 1;
  const evidence = evidenceByBrand.get(code);
  if (quantity > 0) evidence.ecount_positive_sku_count += 1;
  else if (quantity < 0) evidence.ecount_negative_sku_count += 1;
  else evidence.ecount_zero_sku_count += 1;
  sourcesByBrand.get(code).add("product_registry");
}

const candidates = [...master.byCode].map(([code, brand]) => {
  const evidence = evidenceByBrand.get(code);
  const ecountInventory = evidence.ecount_positive_sku_count > 0
    ? "positive"
    : evidence.ecount_negative_sku_count > 0
      ? "negative_only"
      : evidence.ecount_zero_sku_count > 0
        ? "zero"
        : "unknown";
  const current = evidence.cafe24_sellable_product_count > 0 || ecountInventory === "positive";
  const review = ecountInventory === "negative_only" || reviewBrandCodes.has(code);
  if (!current && !review) return null;
  if (!current && ecountInventory === "negative_only") {
    addReview({
      sourceType: "ecount_inventory",
      sourceKey: code,
      rawBrandName: brand?.brand_name,
      candidateBrandCodes: [code],
      reason: "negative_only_inventory",
      evidence: {
        negative_sku_count: evidence.ecount_negative_sku_count,
        zero_sku_count: evidence.ecount_zero_sku_count
      }
    });
  }
  return {
    brand_code: code,
    canonical_brand: text(brand?.brand_name),
    proposed_status: current ? "CURRENT" : review ? "REVIEW" : "EXCLUDED",
    signals: {
      cafe24_sellable_product: evidence.cafe24_sellable_product_count > 0,
      ecount_inventory: ecountInventory
    },
    evidence,
    match_sources: [...sourcesByBrand.get(code)].sort(),
    review_status: "pending",
    generated_at: generatedAt
  };
}).filter(Boolean).sort((a, b) => a.brand_code.localeCompare(b.brand_code));

reviews.sort((a, b) => a.reason.localeCompare(b.reason) || a.source_key.localeCompare(b.source_key));
await mkdir(dirname(paths.candidates), { recursive: true });
await writeFile(paths.candidates, `${JSON.stringify(candidates, null, 2)}\n`, "utf8");
await writeFile(paths.reviewQueue, `${JSON.stringify(reviews, null, 2)}\n`, "utf8");

const countBy = (items, key) => Object.fromEntries([...items.reduce((map, item) => {
  const value = item[key];
  map.set(value, (map.get(value) || 0) + 1);
  return map;
}, new Map())]);

console.log(JSON.stringify({
  cafe24Input: cafe24Path,
  cafe24Source: cafe24Data?.source || cafe24Data?.catalogSource || "unknown",
  cafe24ProductCount: products.length,
  ecountSkuCount: inventoryRows.length,
  candidateCount: candidates.length,
  candidateStatuses: countBy(candidates, "proposed_status"),
  reviewCount: reviews.length,
  reviewReasons: countBy(reviews, "reason"),
  cafe24SignalBrandCount: candidates.filter((item) => item.signals.cafe24_sellable_product).length,
  ecountPositiveBrandCount: candidates.filter((item) => item.signals.ecount_inventory === "positive").length,
  ecountNegativeOnlyBrandCount: candidates.filter((item) => item.signals.ecount_inventory === "negative_only").length,
  stats
}, null, 2));
