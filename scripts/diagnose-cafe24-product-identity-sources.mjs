#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const outputPath = join(workDir, "cafe24-product-identity-source-diagnostic.json");

export const IDENTITY_FIELD_GROUPS = Object.freeze({
  barcode: ["barcode", "bar_code", "BAR_CODE", "BARCODE"],
  ean: ["ean", "EAN"],
  jan: ["jan", "JAN"],
  isbn: ["isbn", "ISBN"],
  upc: ["upc", "UPC"],
  gtin: ["gtin", "GTIN"],
  productCode: ["productCode", "product_code", "custom_product_code", "PROD_CD"],
  productNo: ["productNo", "product_no", "product_number"],
  manufacturerCode: ["manufacturer_code", "manufacturerCode"],
  supplierCode: ["supplier_code", "supplierCode"],
  variantCode: ["variantCode", "variant_code"],
  variantId: ["variantId", "variant_id"],
  optionCode: ["optionCode", "option_code"],
  optionValue: ["optionValue", "option_value", "optionSummary", "options"],
  customFields: ["custom_field", "customFields", "additional_information", "CONT1", "CONT2", "CONT3", "CONT4", "CONT5", "CONT6"]
});

const SIGNAL_GRADES = Object.freeze({
  barcode: "Strong",
  ean: "Strong",
  jan: "Strong",
  isbn: "Strong",
  upc: "Strong",
  gtin: "Strong",
  productCode: "Medium",
  productNo: "Medium",
  manufacturerCode: "Medium",
  supplierCode: "Medium",
  variantCode: "Medium",
  variantId: "Medium",
  optionCode: "Weak",
  optionValue: "Weak",
  customFields: "Weak"
});

function parseCliArgs(argv) {
  const options = { dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
  }
  return options;
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return { exists: false, data: null, stat: null, error: null };
  try {
    const [text, fileStat] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    return { exists: true, data: JSON.parse(text), stat: fileStat, error: null };
  } catch (error) {
    return { exists: true, data: null, stat: null, error: error.message };
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
  if (Array.isArray(payload?.Data?.Result)) return payload.Data.Result;
  return [];
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

function valueAtPath(record, key) {
  if (!record || typeof record !== "object") return [];
  const values = [];
  if (Object.prototype.hasOwnProperty.call(record, key)) values.push(record[key]);
  for (const nestedKey of ["options", "variants", "inventories", "inventory"]) {
    const nested = record[nestedKey];
    if (Array.isArray(nested)) {
      for (const child of nested) if (child && typeof child === "object" && Object.prototype.hasOwnProperty.call(child, key)) values.push(child[key]);
    } else if (nested && typeof nested === "object" && Object.prototype.hasOwnProperty.call(nested, key)) {
      values.push(nested[key]);
    }
  }
  return values;
}

export function scanIdentityFields(records, fieldGroups = IDENTITY_FIELD_GROUPS) {
  const result = {};
  for (const [group, aliases] of Object.entries(fieldGroups)) {
    const samples = [];
    let recordCount = 0;
    let valueCount = 0;
    const observedAliases = new Set();
    for (const record of records) {
      let recordHasValue = false;
      for (const alias of aliases) {
        for (const value of valueAtPath(record, alias)) {
          if (value === undefined || value === null || String(value).trim() === "") continue;
          valueCount += 1;
          recordHasValue = true;
          observedAliases.add(alias);
          if (samples.length < 5) samples.push(String(value).slice(0, 120));
        }
      }
      if (recordHasValue) recordCount += 1;
    }
    result[group] = {
      grade: SIGNAL_GRADES[group] || "Not usable",
      recordCount,
      valueCount,
      aliases: aliases.filter((alias) => observedAliases.has(alias)),
      sampleValues: samples,
      usable: recordCount > 0
    };
  }
  return result;
}

function scanServerImplementation(serverText) {
  const normalizeStart = serverText.indexOf("function normalizeCafe24ProductRow");
  const normalizeEnd = normalizeStart >= 0 ? serverText.indexOf("// ============================================================================", normalizeStart) : -1;
  const normalizeBlock = normalizeStart >= 0 && normalizeEnd > normalizeStart ? serverText.slice(normalizeStart, normalizeEnd) : "";
  const productAccessStart = serverText.indexOf("async function diagnoseCafe24ProductAccess");
  const productAccessEnd = productAccessStart >= 0 ? serverText.indexOf("async function", productAccessStart + 20) : -1;
  const productAccessBlock = productAccessStart >= 0 && productAccessEnd > productAccessStart ? serverText.slice(productAccessStart, productAccessEnd) : "";
  const fetches = {
    productsList: serverText.includes("/api/v2/admin/products`)" ) || serverText.includes("/api/v2/admin/products"),
    productDetail: serverText.includes("/api/v2/admin/products/${productNo}"),
    variants: serverText.includes("/api/v2/admin/products/${productNo}/variants"),
    inventories: productAccessBlock.includes("/inventories")
  };
  const retainedFields = [
    "productNo",
    "productCode",
    "productName",
    "brand",
    "manufacturer_code",
    "categoryNos",
    "mainImage",
    "display",
    "selling",
    "createdDate",
    "options.variantCode",
    "options.optionSummary",
    "options.quantity",
    "options.soldOut",
    "inventoryQuantity",
    "soldOut"
  ].filter((field) => normalizeBlock.includes(field.split(".")[0]));
  const droppedIdentitySignals = ["barcode", "ean", "jan", "isbn", "upc", "gtin", "supplier_code", "variant_id", "option_code", "option_value"].filter((field) => !normalizeBlock.toLowerCase().includes(field));
  return {
    apiCallsInCode: fetches,
    normalizeCafe24ProductRowFound: Boolean(normalizeBlock),
    retainedDashboardFields: retainedFields,
    droppedIdentitySignals,
    productAccessDiagnosticEndpoint: "/api/diagnostics/cafe24-product-access",
    productAccessDiagnosticChecksBarcodeAliases: /barcode|ean|jan|isbn|upc|gtin/i.test(productAccessBlock)
  };
}

function evaluateConnection(ecountFields, cafe24Fields) {
  const rows = [];
  const add = (label, ecountGroup, cafe24Group, grade, verdict) => {
    rows.push({ label, ecountAvailable: ecountFields[ecountGroup]?.recordCount || 0, cafe24CacheAvailable: cafe24Fields[cafe24Group]?.recordCount || 0, grade, verdict });
  };
  add("ECOUNT BAR_CODE ↔ Cafe24 barcode/ean/upc/gtin", "barcode", "barcode", "Strong", cafe24Fields.barcode.recordCount ? "possible_from_cache" : "not_available_in_current_cache");
  add("ECOUNT PROD_CD ↔ Cafe24 productCode", "productCode", "productCode", "Medium", cafe24Fields.productCode.recordCount ? "possible_but_not_unique_enough_without_review" : "not_available");
  add("ECOUNT PROD_CD ↔ Cafe24 manufacturer_code", "productCode", "manufacturerCode", "Medium", cafe24Fields.manufacturerCode.recordCount ? "possible_but_current_values_do_not_match_ecount_codes_reliably" : "not_available");
  add("ECOUNT PROD_DES/SIZE_DES ↔ Cafe24 productName/options", "productCode", "optionValue", "Weak", "candidate_only_manual_review_required");
  return rows;
}

export async function buildCafe24ProductIdentitySourceDiagnostic() {
  const generatedAt = new Date().toISOString();
  const dashboardSource = await latestProductDashboardSource();
  const ecountLatestPath = join(rootDir, "work/ecount-inventory/latest.json");
  const ecountRawProductsPath = join(rootDir, "work/ecount-inventory/raw-products.json");
  const serverPath = join(rootDir, "server.mjs");
  const [ecountLatest, ecountRawProducts, serverSource] = await Promise.all([
    readJsonIfExists(ecountLatestPath),
    readJsonIfExists(ecountRawProductsPath),
    readFile(serverPath, "utf8").then((text) => ({ exists: true, text, stat: null, error: null })).catch((error) => ({ exists: false, text: "", stat: null, error: error.message }))
  ]);
  const cafe24Products = dashboardSource?.products || [];
  const ecountLatestRows = extractList(ecountLatest.data);
  const ecountRawRows = extractList(ecountRawProducts.data);
  const cafe24CacheFields = scanIdentityFields(cafe24Products);
  const ecountLatestFields = scanIdentityFields(ecountLatestRows);
  const ecountRawFields = scanIdentityFields(ecountRawRows);
  const serverImplementation = scanServerImplementation(serverSource.text || "");
  const apiSurfaces = [
    {
      api: "GET /api/v2/admin/products",
      codeFunction: "fetchCafe24ProductList",
      currentCacheRole: "base product list",
      identityFieldsRetained: ["product_no", "product_code/custom_product_code", "product_name", "brand_code", "manufacturer_code"],
      barcodeVerified: false,
      note: "Current diagnostic did not call external Cafe24 API; existing cache has no barcode/ean/upc/gtin field."
    },
    {
      api: "GET /api/v2/admin/products/{productNo}",
      codeFunction: "fetchCafe24ProductDetail",
      currentCacheRole: "detail merge before normalization",
      identityFieldsRetained: ["product_no", "product_code/custom_product_code", "product_name", "brand_code", "manufacturer_code"],
      barcodeVerified: false,
      note: "normalizeCafe24ProductRow would drop barcode-like fields if they exist unless explicitly retained."
    },
    {
      api: "GET /api/v2/admin/products/{productNo}/variants?embed=inventories",
      codeFunction: "fetchCafe24ProductVariantsWithInventory",
      currentCacheRole: "variant inventory and options",
      identityFieldsRetained: ["variant_code", "options.name/value", "inventory.quantity", "sold_out"],
      barcodeVerified: false,
      note: "Current cache retains variantCode and optionSummary only; variant barcode/ean fields are not retained if present."
    },
    {
      api: "GET /api/v2/admin/products/{productNo}/inventories",
      codeFunction: "diagnoseCafe24ProductAccess only",
      currentCacheRole: "diagnostic check, not dashboard cache source",
      identityFieldsRetained: [],
      barcodeVerified: false,
      note: "Existing access diagnostic checks inventory readiness but not barcode aliases."
    }
  ];
  const identityFieldTable = Object.entries(cafe24CacheFields).map(([field, info]) => ({
    field,
    grade: info.grade,
    cafe24CacheRecordCount: info.recordCount,
    cafe24CacheAliases: info.aliases,
    cafe24CacheSamples: info.sampleValues,
    ecountLatestRecordCount: ecountLatestFields[field]?.recordCount || 0,
    ecountRawRecordCount: ecountRawFields[field]?.recordCount || 0,
    identityUsability: classifyUsability(field, info)
  }));
  return {
    generatedAt,
    mode: "read_only_identity_source_diagnostic",
    sources: {
      cafe24ProductDashboard: dashboardSource ? sourceMeta(join(rootDir, dashboardSource.relativePath), dashboardSource.loaded) : { exists: false, error: "No product-dashboard-proxy cache found" },
      ecountLatest: sourceMeta(ecountLatestPath, ecountLatest),
      ecountRawProducts: sourceMeta(ecountRawProductsPath, ecountRawProducts),
      server: { path: "server.mjs", exists: serverSource.exists, error: serverSource.error || null }
    },
    summary: {
      cafe24ProductCount: cafe24Products.length,
      ecountLatestProductCount: ecountLatestRows.length,
      ecountRawProductCount: ecountRawRows.length,
      cafe24BarcodeLikeFieldCount: ["barcode", "ean", "jan", "isbn", "upc", "gtin"].reduce((total, field) => total + (cafe24CacheFields[field]?.recordCount || 0), 0),
      ecountBarcodeCount: ecountLatestFields.barcode?.recordCount || ecountRawFields.barcode?.recordCount || 0,
      barcodeConclusion: "not_present_in_current_cafe24_dashboard_cache",
      apiConclusion: "not_verified_from_external_api_in_this_read_only_run; existing loader would drop barcode-like fields if returned because normalizeCafe24ProductRow does not retain them"
    },
    apiSurfaces,
    loaderDataFlow: [
      "fetchCafe24ProductList() → base product fields",
      "fetchCafe24ProductDetail(productNo) → detail merge",
      "fetchCafe24ProductVariantsWithInventory(productNo) → variants + inventories",
      "normalizeCafe24ProductRow(item, detail, variants) → Product Dashboard row",
      "buildProductDashboardWithCache() → work/product-dashboard-proxy-*.json"
    ],
    serverImplementation,
    identityFields: identityFieldTable,
    ecountConnection: evaluateConnection(ecountLatestFields, cafe24CacheFields),
    discardedOrUnverifiedFields: {
      definitelyAbsentFromCurrentCache: identityFieldTable.filter((row) => row.cafe24CacheRecordCount === 0).map((row) => row.field),
      retainedInCurrentCache: identityFieldTable.filter((row) => row.cafe24CacheRecordCount > 0).map((row) => row.field),
      loaderDropsIfApiReturns: serverImplementation.droppedIdentitySignals,
      apiDiagnosticGap: serverImplementation.productAccessDiagnosticChecksBarcodeAliases ? [] : ["barcode/ean/jan/isbn/upc/gtin aliases are not checked by /api/diagnostics/cafe24-product-access"]
    },
    recommendations: [
      "Do not confirm ECOUNT↔Cafe24 matches from current Product Dashboard cache alone; barcode-like Cafe24 identity is absent.",
      "Next read-only API probe should extend /api/diagnostics/cafe24-product-access or add a separate diagnostic to inspect barcode/ean/upc/gtin fields in product detail, variant, inventory, and custom/additional fields.",
      "If Cafe24 API returns barcode-like fields, update the cache loader in a later approved phase to retain them before rebuilding matching candidates.",
      "Until barcode is verified, productCode/manufacturer_code/name signals should remain candidate or manual-review evidence only."
    ]
  };
}

export function classifyUsability(field, info) {
  if (!info.recordCount) return "Not usable in current cache";
  if (["barcode", "ean", "jan", "isbn", "upc", "gtin"].includes(field)) return "Strong if API provenance is confirmed";
  if (["productCode", "productNo", "manufacturerCode", "supplierCode", "variantCode", "variantId"].includes(field)) return "Medium";
  if (["optionCode", "optionValue", "customFields"].includes(field)) return "Weak";
  return "Not usable";
}

function printSummary(result) {
  console.log("Cafe24 product identity source diagnostic");
  console.log(`- Cafe24 cache products: ${result.summary.cafe24ProductCount}`);
  console.log(`- ECOUNT products: ${result.summary.ecountLatestProductCount}`);
  console.log(`- ECOUNT barcode count: ${result.summary.ecountBarcodeCount}`);
  console.log(`- Cafe24 barcode-like cache count: ${result.summary.cafe24BarcodeLikeFieldCount}`);
  console.log(`- barcode conclusion: ${result.summary.barcodeConclusion}`);
  console.log("- retained Cafe24 cache identity fields:");
  for (const row of result.identityFields.filter((item) => item.cafe24CacheRecordCount > 0)) {
    console.log(`  ${row.field}: ${row.cafe24CacheRecordCount} (${row.grade})`);
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await buildCafe24ProductIdentitySourceDiagnostic();
  printSummary(result);
  if (options.dryRun) {
    console.log("- dry-run: 결과 파일을 쓰지 않았습니다.");
    return;
  }
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`- output: ${outputPath.replace(`${rootDir}/`, "")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
