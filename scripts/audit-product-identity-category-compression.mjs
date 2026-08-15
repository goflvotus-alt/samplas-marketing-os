#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyProductCategory, isExcludedProductCode } from "./category-classification-rules.mjs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const output = resolve(root, process.argv[2] || "work/category-unclassified-model-audit.json");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
// 결제/운영 편의성 라인(할인, 퀵비 등)은 실제 상품 identity가 아니므로 감사/리뷰 대상에서
// 아예 제외한다(category-classification-rules.mjs의 EXCLUDED_PRODUCT_CODES 참고).
const inventory = (await readJson("work/ecount-inventory/latest.json")).filter((row) => !isExcludedProductCode(row.productCode));
const registry = await readJson("work/product-registry.json");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizedText = (value) => String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9가-힣]+/g, "");
const normalizedIdentifier = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/[\s-]+/g, "");

// scripts/category-classification-rules.mjs가 SAMPLAS Category Master v1 정책의 단일
// source다(runtime outputs/samplas-marketing-os.js는 브라우저 plain script라 이 모듈을
// import할 수 없어 동일 로직을 수동 이식한 사본을 갖는다 — 두 사본은
// test/category-classification-parity.test.mjs로 정합성을 검증한다). 여기서는 그 모듈의
// classifyProductCategory()를 그대로 호출하고, UNCLASSIFIED일 때만 기존의 세분화된 실패
// 사유(failureReasons 리포트용)를 이 스크립트에서 보강한다.
function classify(row) {
  const result = classifyProductCategory({ productNo: row.productCode, productName: row.productName, prodCd: row.productCode, overrides: new Map() });
  if (result.code !== "UNCLASSIFIED") return { category: result.code, subcategoryCode: result.subcategoryCode, reason: result.source };
  if (!String(row.productName || "").trim()) return { category: "UNCLASSIFIED", reason: "missing_product_name" };
  const suffix = String(row.productCode || "").match(/([A-Za-z]+)(\d+)$/)?.[1]?.toUpperCase();
  if (!suffix) return { category: "UNCLASSIFIED", reason: "unsupported_prodcd_structure" };
  return { category: "UNCLASSIFIED", reason: `unsupported_suffix:${suffix}` };
}

function brandFromName(productName) {
  const [brand, rest] = String(productName || "").split("/");
  return rest === undefined ? "UNASSIGNED" : brand.trim() || "UNASSIGNED";
}

function modelBaseName(row) {
  let value = String(row.productName || "").normalize("NFKC").trim();
  const specification = String(row.specification || "").normalize("NFKC").trim();
  if (specification) value = value.replace(new RegExp(`(?:\\s*[/|-]\\s*|\\s+)${escapeRegex(specification)}(?:\\s+SIZE)?\\s*$`, "i"), "");
  return normalizedText(value);
}

function buildConservativeModels(rows) {
  const provisional = new Map();
  for (const row of rows) {
    const code = String(row.productCode || "");
    const prefix = row.specification && /^[A-Za-z0-9]{8,}$/.test(code) && /\d{2}$/.test(code) ? code.slice(0, -2) : null;
    const key = prefix ? `CODE_PREFIX:${prefix}` : `SKU:${code}`;
    const group = provisional.get(key) || [];
    group.push(row);
    provisional.set(key, group);
  }
  const safe = [];
  const rejected = [];
  for (const [key, group] of provisional) {
    const baseNames = new Set(group.map(modelBaseName));
    if (group.length === 1 || (key.startsWith("CODE_PREFIX:") && baseNames.size === 1 && !baseNames.has(""))) safe.push(group);
    else {
      rejected.push({ key, skuCount: group.length, productNames: [...new Set(group.map((row) => row.productName))] });
      group.forEach((row) => safe.push([row]));
    }
  }
  const models = safe.map((group) => ({
    modelKey: group.length > 1 ? `CODE_PREFIX:${String(group[0].productCode).slice(0, -2)}` : `SKU:${group[0].productCode}`,
    brand: brandFromName(group[0].productName),
    productName: group[0].productName,
    skuCount: group.length,
    productCodes: group.map((row) => row.productCode),
    barcodes: [...new Set(group.map((row) => row.barcode).filter(Boolean))],
    options: [...new Set(group.map((row) => row.specification).filter(Boolean))],
    currentStockQuantity: group.reduce((sum, row) => sum + (Number.isFinite(row.stockQuantity) ? row.stockQuantity : 0), 0),
    classifierFailureReasons: [...new Set(group.map((row) => row.reason))]
  }));
  return { models, rejectedUnsafeGroups: rejected };
}

function identifierIndex(field) {
  const index = new Map();
  for (const entry of registry.entries || []) {
    for (const product of entry.ecount?.matchedProducts || []) {
      const value = product?.[field];
      if (!value) continue;
      const owners = index.get(String(value)) || new Map();
      owners.set(entry.canonicalProductId, entry);
      index.set(String(value), owners);
    }
  }
  return index;
}

function identifierStats(field, source = "ecount") {
  const values = [];
  for (const entry of registry.entries || []) {
    if (source === "ecount") {
      for (const item of entry.ecount?.matchedProducts || []) if (item?.[field]) values.push({ value: String(item[field]), owner: entry.canonicalProductId });
    } else if (entry.cafe24?.[field]) {
      values.push({ value: String(entry.cafe24[field]), owner: entry.canonicalProductId });
    }
  }
  const groups = new Map();
  for (const item of values) {
    const owners = groups.get(item.value) || new Set();
    owners.add(item.owner);
    groups.set(item.value, owners);
  }
  return { populated: values.length, unique: groups.size, duplicateRows: values.length - groups.size, collisionValues: [...groups.values()].filter((owners) => owners.size > 1).length };
}

const classified = inventory.map((row) => ({ ...row, ...classify(row) }));
const unclassified = classified.filter((row) => row.category === "UNCLASSIFIED");
const { models, rejectedUnsafeGroups } = buildConservativeModels(unclassified);
const { models: allModels } = buildConservativeModels(classified);
const byBrand = new Map();
for (const model of models) {
  const current = byBrand.get(model.brand) || { brand: model.brand, unclassifiedSku: 0, uniqueProductModels: 0, currentStockQuantity: 0 };
  current.unclassifiedSku += model.skuCount;
  current.uniqueProductModels += 1;
  current.currentStockQuantity += model.currentStockQuantity;
  byBrand.set(model.brand, current);
}

const prodCdIndex = identifierIndex("prodCd");
const barcodeIndex = identifierIndex("barcode");
const normalizedBarcodeIndex = new Map();
for (const [value, owners] of barcodeIndex) {
  const merged = normalizedBarcodeIndex.get(normalizedIdentifier(value)) || new Map();
  owners.forEach((entry, id) => merged.set(id, entry));
  normalizedBarcodeIndex.set(normalizedIdentifier(value), merged);
}
const ownerCount = (index, key) => index.get(String(key || ""))?.size || 0;
const trustedOwnerCount = (index, key) => [...(index.get(String(key || ""))?.values() || [])].filter((entry) => entry.verified === true && entry.status === "confirmed").length;
const currentJoin = inventory.filter((row) => trustedOwnerCount(prodCdIndex, row.productCode) === 1).length;
const barcodeDirect = inventory.filter((row) => row.barcode && ownerCount(barcodeIndex, row.barcode) === 1).length;
const prodCdBridge = inventory.filter((row) => ownerCount(prodCdIndex, row.productCode) === 1).length;
const safeUnion = inventory.filter((row) => ownerCount(barcodeIndex, row.barcode) === 1 || ownerCount(prodCdIndex, row.productCode) === 1).length;
const formattingOnly = inventory.filter((row) => row.barcode && ownerCount(barcodeIndex, row.barcode) === 0 && (normalizedBarcodeIndex.get(normalizedIdentifier(row.barcode))?.size || 0) === 1).length;

const collisionRows = [...prodCdIndex.entries()].filter(([, owners]) => owners.size > 1).map(([identifier, owners]) => {
  const entries = [...owners.values()];
  const names = new Set(entries.map((entry) => normalizedText(entry.canonicalProductName)));
  const brands = new Set(entries.map((entry) => normalizedText(entry.brandName || entry.brandId)));
  const trusted = entries.filter((entry) => entry.verified === true && entry.status === "confirmed");
  const type = names.size === 1 && brands.size === 1 ? "SAME_PRODUCT_DUPLICATE" : trusted.length > 1 ? "TRUE_IDENTIFIER_COLLISION" : "UNKNOWN";
  return {
    identifier,
    type,
    inventoryPresent: inventory.some((row) => row.productCode === identifier || row.barcode === identifier),
    owners: entries.map((entry) => ({ canonicalProductId: entry.canonicalProductId, brand: entry.brandName || entry.brandId, productName: entry.canonicalProductName, status: entry.status, verified: entry.verified }))
  };
});
const safeDuplicateIdentifiers = new Set(collisionRows.filter((row) => row.type === "SAME_PRODUCT_DUPLICATE").map((row) => row.identifier));
const safelyJoinable = (row) => ownerCount(barcodeIndex, row.barcode) === 1 || ownerCount(prodCdIndex, row.productCode) === 1 || safeDuplicateIdentifiers.has(row.productCode) || safeDuplicateIdentifiers.has(row.barcode);
const afterSafeCleanup = inventory.filter(safelyJoinable).length;
const safeCategoryIntersection = classified.filter((row) => safelyJoinable(row) && row.category !== "UNCLASSIFIED").length;

const result = {
  generatedAt: new Date().toISOString(),
  mode: "read_only_audit",
  sources: ["work/ecount-inventory/latest.json", "work/product-registry.json", "work/category-master.json", "outputs/samplas-marketing-os.js"],
  inventory: {
    skuTotal: inventory.length,
    barcodeSku: inventory.filter((row) => row.barcode).length,
    barcodeCoverage: inventory.filter((row) => row.barcode).length / inventory.length,
    barcodeEqualsProductCode: inventory.filter((row) => row.barcode && row.barcode === row.productCode).length,
    fields: [...new Set(inventory.flatMap((row) => Object.keys(row)))].sort()
  },
  category: {
    classifiedSku: classified.length - unclassified.length,
    unclassifiedSku: unclassified.length,
    unclassifiedUniqueModels: models.length,
    allUniqueModels: allModels.length,
    autoClassifiedUniqueModels: allModels.filter((model) => model.classifierFailureReasons.some((reason) => ["name_rule", "ecount_suffix", "model_exception", "resurrection13_internal_code"].includes(reason))).length,
    averageSkuPerModel: unclassified.length / models.length,
    modelDistribution: {
      oneSku: models.filter((model) => model.skuCount === 1).length,
      twoToThreeSku: models.filter((model) => model.skuCount >= 2 && model.skuCount <= 3).length,
      fourToFiveSku: models.filter((model) => model.skuCount >= 4 && model.skuCount <= 5).length,
      sixPlusSku: models.filter((model) => model.skuCount >= 6).length
    },
    failureReasons: Object.fromEntries([...Map.groupBy(unclassified, (row) => row.reason)].map(([reason, rows]) => [reason, rows.length]).sort((left, right) => right[1] - left[1])),
    topBrands: [...byBrand.values()].sort((left, right) => right.unclassifiedSku - left.unclassifiedSku || left.brand.localeCompare(right.brand)).slice(0, 50),
    rejectedUnsafeModelGroups: rejectedUnsafeGroups.length,
    models
  },
  productIdentity: {
    registryEntries: registry.entries?.length || 0,
    identifierStats: {
      ecountProdCd: identifierStats("prodCd"),
      ecountBarcode: identifierStats("barcode"),
      cafe24ProductNo: identifierStats("productNo", "cafe24"),
      cafe24ProductCode: identifierStats("productCode", "cafe24"),
      variantCode: { populated: 0, unique: 0, duplicateRows: 0, collisionValues: 0 },
      itemCode: { populated: 0, unique: 0, duplicateRows: 0, collisionValues: 0 }
    },
    currentTrustedProductJoin: currentJoin,
    barcodeDirectPotential: barcodeDirect,
    prodCdInventoryBridgePotential: prodCdBridge,
    deterministicUnionPotential: safeUnion,
    formattingDifferenceRecoverable: formattingOnly,
    afterSafeCollisionCleanupPotential: afterSafeCleanup,
    safeProductAndCategoryPotential: safeCategoryIntersection,
    unresolvedAfterAllDeterministicRoutes: inventory.length - afterSafeCleanup,
    inventoryBarcodeWithoutRegistryBarcodeMatch: inventory.filter((row) => row.barcode && ownerCount(barcodeIndex, row.barcode) === 0).length,
    inventoryMissingBarcode: inventory.filter((row) => !row.barcode).length,
    registryMatchedProductBarcodeMissing: (registry.entries || []).flatMap((entry) => entry.ecount?.matchedProducts || []).filter((row) => !row.barcode).length,
    collisions: {
      total: collisionRows.length,
      sameProductDuplicate: collisionRows.filter((row) => row.type === "SAME_PRODUCT_DUPLICATE").length,
      variantRecordDuplication: 0,
      trueIdentifierCollision: collisionRows.filter((row) => row.type === "TRUE_IDENTIFIER_COLLISION").length,
      legacyStaleRecord: 0,
      unknown: collisionRows.filter((row) => row.type === "UNKNOWN").length,
      rows: collisionRows
    }
  },
  bridgeAssessment: {
    inventoryProductCodeToBarcodeDeterministic: inventory.filter((row) => row.productCode && row.barcode).length,
    barcodeMostlyDuplicatesProductCode: inventory.filter((row) => row.barcode && row.barcode === row.productCode).length,
    salesSnapshotHasProdCd: false,
    salesSnapshotHasBarcode: false,
    conclusion: "Current sales snapshot omits prodCd/barcode, so sales prodCd -> inventory -> barcode cannot be used without changing the loader/snapshot contract."
  }
};

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, inventory: result.inventory, category: { ...result.category, models: undefined, topBrands: result.category.topBrands.slice(0, 15) }, productIdentity: { ...result.productIdentity, collisions: { ...result.productIdentity.collisions, rows: undefined } }, bridgeAssessment: result.bridgeAssessment }, null, 2));
