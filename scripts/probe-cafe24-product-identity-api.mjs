#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const outputPathDefault = join(workDir, "cafe24-product-identity-api-probe.json");

export const IDENTITY_ALIASES = Object.freeze([
  "barcode",
  "bar_code",
  "barCode",
  "ean",
  "ean13",
  "jan",
  "isbn",
  "upc",
  "gtin",
  "gtin8",
  "gtin12",
  "gtin13",
  "gtin14",
  "product_code",
  "productCode",
  "custom_product_code",
  "manufacturer_code",
  "manufacturerCode",
  "supplier_code",
  "supplierCode",
  "variant_code",
  "variantCode",
  "item_code",
  "itemCode",
  "sku",
  "model_number",
  "modelNumber"
]);

const SENSITIVE_KEYS = /token|secret|authorization|cookie|password|client_secret|refresh/i;
const BARCODE_LIKE_ALIASES = new Set(["barcode", "bar_code", "barCode", "ean", "ean13", "jan", "isbn", "upc", "gtin", "gtin8", "gtin12", "gtin13", "gtin14"]);

function parseCliArgs(argv) {
  const options = { limit: 10, productNos: [], dryRun: false, output: outputPathDefault };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--limit") options.limit = Math.min(10, Math.max(1, Number(argv[++index]) || 10));
    else if (arg.startsWith("--limit=")) options.limit = Math.min(10, Math.max(1, Number(arg.slice("--limit=".length)) || 10));
    else if (arg === "--product-no") options.productNos.push(String(argv[++index] || "").trim());
    else if (arg.startsWith("--product-no=")) options.productNos.push(String(arg.slice("--product-no=".length)).trim());
    else if (arg === "--output") options.output = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--output=")) options.output = resolve(rootDir, arg.slice("--output=".length));
  }
  options.productNos = [...new Set(options.productNos.filter(Boolean))];
  return options;
}

async function loadEnv() {
  const envPath = join(rootDir, ".env");
  const parsed = { ...process.env };
  if (!existsSync(envPath)) return parsed;
  const text = await readFile(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key]) continue;
    parsed[key] = value;
  }
  return parsed;
}

function tokenStoreDir(env) {
  return resolve(env.CAFE24_TOKEN_STORE_DIR || join(workDir, "secrets"));
}

function tokenStoreFile(env) {
  return join(tokenStoreDir(env), "cafe24-token-store.json");
}

async function readTokenRecord(env) {
  try {
    const text = await readFile(tokenStoreFile(env), "utf8");
    const record = JSON.parse(text);
    if (record.accessToken) env.CAFE24_ACCESS_TOKEN = record.accessToken;
    if (record.refreshToken) env.CAFE24_REFRESH_TOKEN = record.refreshToken;
    if (record.expiresAt) env.CAFE24_ACCESS_TOKEN_EXPIRES_AT = record.expiresAt;
    return record;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function ensureAccessToken(env) {
  const record = await readTokenRecord(env);
  if (!record?.accessToken && !env.CAFE24_ACCESS_TOKEN) throw Object.assign(new Error("missing_access_token"), { category: "authentication_failed" });
  if (record?.status === "reauth_required") throw Object.assign(new Error("reauth_required"), { category: "authentication_failed" });
  return env.CAFE24_ACCESS_TOKEN || record?.accessToken;
}

function apiVersion(env) {
  return env.CAFE24_API_VERSION || env.CAFE24_ADMIN_API_VERSION || "2025-06-01";
}

async function cafe24Get(env, path, params = {}) {
  if (!env.CAFE24_MALL_ID) throw Object.assign(new Error("missing_mall_id"), { category: "environment_missing" });
  await ensureAccessToken(env);
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.CAFE24_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": apiVersion(env)
    }
  });
  const text = await response.text();
  const body = JSON.parse(text || "{}");
  if (!response.ok || body.error) {
    const message = body.error?.message || body.error_description || body.message || `Cafe24 API error ${response.status}`;
    const category = response.status === 401 ? "authentication_failed" : response.status === 403 ? "endpoint_access_denied" : response.status === 404 ? "endpoint_not_found" : response.status === 429 ? "rate_limited" : "api_error";
    throw Object.assign(new Error(message), { category, httpStatus: response.status, body: compactErrorBody(body) });
  }
  return { body, httpStatus: response.status, rateLimitInfo: rateLimitInfo(response.headers), topLevelKeys: Object.keys(body) };
}

function compactErrorBody(body) {
  if (!body || typeof body !== "object") return null;
  const compact = {};
  for (const key of ["error", "error_description", "message", "errors", "trace_id"]) if (body[key] !== undefined) compact[key] = body[key];
  return redactSensitive(compact);
}

function rateLimitInfo(headers) {
  const result = {};
  for (const key of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after"]) {
    const value = headers.get(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

function isPopulated(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(isPopulated);
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function aliasKey(key) {
  return String(key || "").replace(/[_-]/g, "").toLowerCase();
}

export function findIdentityFields(input, aliases = IDENTITY_ALIASES) {
  const aliasMap = new Map();
  for (const alias of aliases) {
    const key = aliasKey(alias);
    if (!aliasMap.has(key)) aliasMap.set(key, alias);
  }
  const found = [];
  function visit(value, path) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEYS.test(key)) continue;
      const nextPath = path ? `${path}.${key}` : key;
      const alias = aliasMap.get(aliasKey(key));
      if (alias) {
        found.push({ alias, jsonPath: nextPath, value: child, populated: isPopulated(child) });
      }
      if (child && typeof child === "object") visit(child, nextPath);
    }
  }
  visit(input, "");
  return found;
}

export function maskedSample(value) {
  if (!isPopulated(value)) return { populated: false };
  const text = typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(redactSensitive(value));
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return {
    populated: true,
    length: text.length,
    numeric: /^\d+$/.test(text),
    prefix: text.slice(0, 2),
    suffix: text.slice(-2),
    hash
  };
}

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.test(key)) result[key] = "[REDACTED]";
    else result[key] = redactSensitive(child);
  }
  return result;
}

export function summarizeIdentityFields(endpointRows, ecountBarcodes = new Set()) {
  const map = new Map();
  for (const row of endpointRows) {
    for (const hit of row.identityHits || []) {
      const normalizedPath = hit.jsonPath.replace(/\[\d+\]/g, "[]");
      const key = `${hit.alias}@@${normalizedPath}@@${row.endpointName}`;
      const entry = map.get(key) || {
        alias: hit.alias,
        jsonPath: normalizedPath,
        sourceEndpoint: row.endpointName,
        populatedCount: 0,
        distinctValues: new Set(),
        sampleFormats: [],
        scope: inferScope(row.endpointName, hit.jsonPath),
        ecountExactMatches: 0
      };
      if (hit.populated) {
        entry.populatedCount += 1;
        const valueText = String(hit.value);
        entry.distinctValues.add(valueText);
        if (entry.sampleFormats.length < 3) entry.sampleFormats.push(maskedSample(hit.value));
        if (ecountBarcodes.has(valueText)) entry.ecountExactMatches += 1;
      }
      map.set(key, entry);
    }
  }
  return [...map.values()].map((entry) => {
    const distinctCount = entry.distinctValues.size;
    const uniquenessRate = entry.populatedCount ? distinctCount / entry.populatedCount : null;
    return {
      alias: entry.alias,
      jsonPath: entry.jsonPath,
      sourceEndpoint: entry.sourceEndpoint,
      populatedCount: entry.populatedCount,
      distinctCount,
      uniquenessRate,
      sampleFormat: entry.sampleFormats[0] || { populated: false },
      sampleFormats: entry.sampleFormats,
      scope: entry.scope,
      strength: classifyStrength(entry.alias, entry.populatedCount, uniquenessRate),
      ecountCompatibility: ecountCompatibility(entry.alias, entry.ecountExactMatches),
      ecountExactMatches: entry.ecountExactMatches,
      notes: notesForField(entry.alias, entry.populatedCount)
    };
  }).sort((left, right) => strengthRank(left.strength) - strengthRank(right.strength) || right.populatedCount - left.populatedCount || left.alias.localeCompare(right.alias));
}

function inferScope(endpointName, jsonPath) {
  if (/variant/i.test(endpointName) || /variants/i.test(jsonPath)) return "variant";
  if (/inventor/i.test(endpointName) || /inventories/i.test(jsonPath)) return "inventory";
  if (/custom|additional/i.test(jsonPath)) return "custom";
  return "product";
}

function classifyStrength(alias, populatedCount, uniquenessRate) {
  if (!populatedCount) return "unusable";
  if (BARCODE_LIKE_ALIASES.has(alias)) return uniquenessRate !== null && uniquenessRate >= 0.95 ? "strong" : "medium";
  if (["product_code", "productCode", "custom_product_code", "manufacturer_code", "manufacturerCode", "supplier_code", "supplierCode", "variant_code", "variantCode", "item_code", "itemCode", "sku", "model_number", "modelNumber"].includes(alias)) return "medium";
  return "weak";
}

function ecountCompatibility(alias, matches) {
  if (BARCODE_LIKE_ALIASES.has(alias)) return matches > 0 ? "direct_barcode_exact_match_found" : "direct_barcode_comparable_no_sample_match";
  if (["product_code", "productCode", "custom_product_code", "manufacturer_code", "manufacturerCode", "variant_code", "variantCode", "sku"].includes(alias)) return "code_comparable_requires_rule_validation";
  return "not_directly_comparable";
}

function strengthRank(value) {
  return { strong: 0, medium: 1, weak: 2, unusable: 3 }[value] ?? 9;
}

function notesForField(alias, populatedCount) {
  if (!populatedCount) return "not populated in sampled responses";
  if (BARCODE_LIKE_ALIASES.has(alias)) return "barcode-like field; candidate for strong identity if stable and unique";
  return "identity-like code; do not auto-confirm without business rule validation";
}

export function compareBarcodeValues(identityFields, ecountBarcodes = new Set()) {
  const barcodeRows = identityFields.filter((row) => BARCODE_LIKE_ALIASES.has(row.alias) && row.populatedCount > 0);
  const populated = barcodeRows.reduce((total, row) => total + row.populatedCount, 0);
  const exact = barcodeRows.reduce((total, row) => total + row.ecountExactMatches, 0);
  const duplicate = barcodeRows.reduce((total, row) => total + Math.max(0, row.populatedCount - row.distinctCount), 0);
  return {
    cafe24BarcodeLikePopulatedCount: populated,
    ecountExactBarcodeMatchCount: exact,
    duplicateBarcodeCount: duplicate,
    oneToOneMatchCount: exact,
    oneToManyMatchCount: duplicate,
    unmatchedCount: Math.max(0, populated - exact),
    ecountBarcodeUniverseCount: ecountBarcodes.size
  };
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

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.Data?.Result)) return payload.Data.Result;
  return [];
}

function chooseSampleProducts(products, options) {
  const byNo = new Map(products.map((product) => [String(product.productNo || product.product_no || ""), product]));
  const selected = [];
  for (const no of options.productNos || []) {
    if (byNo.has(no)) selected.push(byNo.get(no));
    else selected.push({ productNo: no, productName: null, reason: "explicit_product_no_not_in_cache" });
  }
  const predicates = [
    (p) => Array.isArray(p.options) && p.options.length <= 1,
    (p) => Array.isArray(p.options) && p.options.length > 1,
    (p) => String(p.manufacturer_code || "").trim(),
    (p) => String(p.productCode || "").trim(),
    (p) => Number(p.inventoryQuantity || 0) > 0,
    (p) => Number(p.inventoryQuantity || 0) === 0,
    (p) => /개인결제창/.test(String(p.productName || "")) === false
  ];
  for (const predicate of predicates) {
    const hit = products.find((product) => !selected.some((item) => String(item.productNo) === String(product.productNo)) && predicate(product));
    if (hit) selected.push(hit);
    if (selected.length >= options.limit) break;
  }
  for (const product of products) {
    if (selected.length >= options.limit) break;
    if (!selected.some((item) => String(item.productNo) === String(product.productNo))) selected.push(product);
  }
  return selected.slice(0, options.limit);
}

function endpointResult(endpointName, path, productNo, callResult, error = null) {
  if (error) {
    return {
      endpointName,
      requestMethod: "GET",
      productNo: String(productNo),
      path,
      ok: false,
      httpStatus: error.httpStatus || null,
      category: error.category || "api_error",
      message: String(error.message || "Unknown error").slice(0, 240),
      responseTopLevelKeys: [],
      identityHits: [],
      rateLimitInfo: {},
      errorBody: error.body || null
    };
  }
  const body = callResult.body;
  const hits = findIdentityFields(body).map((hit) => ({ ...hit, sample: maskedSample(hit.value), value: hit.populated ? String(hit.value) : null }));
  return {
    endpointName,
    requestMethod: "GET",
    productNo: String(productNo),
    path,
    ok: true,
    httpStatus: callResult.httpStatus,
    category: null,
    message: null,
    responseTopLevelKeys: callResult.topLevelKeys,
    identityHits: hits,
    rateLimitInfo: callResult.rateLimitInfo || {},
    errorBody: null
  };
}

async function probeEndpoint(env, endpointName, path, productNo, params = {}) {
  try {
    const result = await cafe24Get(env, path, params);
    return endpointResult(endpointName, path, productNo, result, null);
  } catch (error) {
    return endpointResult(endpointName, path, productNo, null, error);
  }
}

export async function buildCafe24ProductIdentityApiProbe(options = {}) {
  const env = await loadEnv();
  const dashboard = await readJsonIfExists(join(workDir, "product-dashboard-proxy-2026-06-24_2026-07-18.json"));
  const fallbackDashboard = dashboard.exists ? dashboard : await readJsonIfExists(join(workDir, "product-dashboard-proxy-2026-07-01_2026-07-18.json"));
  const products = extractList(fallbackDashboard.data);
  const samples = chooseSampleProducts(products, { limit: options.limit || 10, productNos: options.productNos || [] });
  const ecount = await readJsonIfExists(join(workDir, "ecount-inventory/latest.json"));
  const ecountBarcodes = new Set(extractList(ecount.data).map((row) => String(row.barcode || row.BAR_CODE || "").trim()).filter(Boolean));
  const endpointRows = [];

  for (const sample of samples) {
    const productNo = String(sample.productNo || sample.product_no || "").trim();
    if (!productNo) continue;
    endpointRows.push(await probeEndpoint(env, "product_detail", `/products/${encodeURIComponent(productNo)}`, productNo, {}));
    endpointRows.push(await probeEndpoint(env, "product_variants", `/products/${encodeURIComponent(productNo)}/variants`, productNo, { limit: 100 }));
    endpointRows.push(await probeEndpoint(env, "product_variants_with_inventories", `/products/${encodeURIComponent(productNo)}/variants`, productNo, { limit: 100, embed: "inventories" }));
    endpointRows.push(await probeEndpoint(env, "product_inventories", `/products/${encodeURIComponent(productNo)}/inventories`, productNo, {}));
  }

  const identityFields = summarizeIdentityFields(endpointRows, ecountBarcodes);
  const barcodeComparison = compareBarcodeValues(identityFields, ecountBarcodes);
  const endpoints = summarizeEndpoints(endpointRows);
  const failures = endpointRows.filter((row) => !row.ok);
  const barcodeLikeExists = identityFields.some((row) => BARCODE_LIKE_ALIASES.has(row.alias) && row.populatedCount > 0);
  const mediumExists = identityFields.some((row) => row.strength === "medium" && row.populatedCount > 0);
  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only_api_probe",
    apiCalls: {
      method: "GET only",
      attempted: endpointRows.length,
      success: endpointRows.filter((row) => row.ok).length,
      failure: failures.length,
      tokenValuesLogged: false,
      usedStoredToken: Boolean(env.CAFE24_ACCESS_TOKEN),
      mallIdConfigured: Boolean(env.CAFE24_MALL_ID)
    },
    sample: {
      requestedLimit: options.limit || 10,
      actualCount: samples.length,
      productNos: samples.map((product) => String(product.productNo || product.product_no || "")).filter(Boolean),
      criteria: ["explicit product-no if provided", "single/no option", "multi variant", "manufacturer_code", "productCode", "stock > 0", "stock = 0"]
    },
    endpoints,
    endpointRows: endpointRows.map((row) => ({ ...row, identityHits: row.identityHits.map(({ value, ...safe }) => safe) })),
    identityFields,
    summary: {
      barcodeLikeExists,
      mediumCodeExists: mediumExists,
      barcodeComparison,
      failureCategories: countBy(failures.map((row) => row.category || "unknown")),
      conclusion: conclusion({ barcodeLikeExists, mediumExists, failures, endpointRows })
    },
    recommendation: recommendation({ barcodeLikeExists, mediumExists, failures, endpointRows })
  };
}

function summarizeEndpoints(rows) {
  const by = new Map();
  for (const row of rows) {
    const entry = by.get(row.endpointName) || {
      endpointName: row.endpointName,
      requestMethod: "GET",
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      responseTopLevelKeys: new Set(),
      discoveredIdentityPaths: new Set(),
      rateLimitInfo: {},
      errors: []
    };
    entry.sampleCount += 1;
    if (row.ok) entry.successCount += 1;
    else {
      entry.failureCount += 1;
      if (entry.errors.length < 5) entry.errors.push({ productNo: row.productNo, category: row.category, httpStatus: row.httpStatus, message: row.message });
    }
    for (const key of row.responseTopLevelKeys || []) entry.responseTopLevelKeys.add(key);
    for (const hit of row.identityHits || []) entry.discoveredIdentityPaths.add(`${hit.alias}:${hit.jsonPath.replace(/\[\d+\]/g, "[]")}`);
    Object.assign(entry.rateLimitInfo, row.rateLimitInfo || {});
    by.set(row.endpointName, entry);
  }
  return [...by.values()].map((entry) => ({
    ...entry,
    responseTopLevelKeys: [...entry.responseTopLevelKeys].sort(),
    discoveredIdentityPaths: [...entry.discoveredIdentityPaths].sort()
  })).sort((left, right) => left.endpointName.localeCompare(right.endpointName));
}

function countBy(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
}

function conclusion({ barcodeLikeExists, mediumExists, failures, endpointRows }) {
  if (!endpointRows.length) return "no_sample_products";
  if (failures.length === endpointRows.length) return "api_probe_failed_no_field_absence_conclusion";
  if (barcodeLikeExists) return "case_a_or_b_strong_barcode_like_identifier_found";
  if (mediumExists) return "case_c_no_barcode_like_identifier_but_medium_codes_present";
  return "case_d_no_strong_or_medium_identifier_found_in_sample";
}

function recommendation(input) {
  const c = conclusion(input);
  if (c === "case_a_or_b_strong_barcode_like_identifier_found") {
    return { case: "A/B", nextStep: "Extend cache schema in a later approved phase to retain discovered barcode-like fields, then rebuild matching diagnostic." };
  }
  if (c === "case_c_no_barcode_like_identifier_but_medium_codes_present") {
    return { case: "C", nextStep: "Run code-combination matching diagnostic using product_code/manufacturer_code/variant_code with manual review safeguards." };
  }
  if (c === "api_probe_failed_no_field_absence_conclusion") {
    return { case: "inconclusive", nextStep: "Resolve authentication/permission/API path failure before concluding whether Cafe24 has barcode-like fields." };
  }
  return { case: "D", nextStep: "Build Candidate Review Queue and manual confirmed workflow." };
}

function printSummary(result) {
  console.log("Cafe24 product identity API probe");
  console.log(`- sample products: ${result.sample.actualCount}`);
  console.log(`- API calls: ${result.apiCalls.success}/${result.apiCalls.attempted} succeeded`);
  console.log(`- barcode-like exists: ${result.summary.barcodeLikeExists}`);
  console.log(`- medium code exists: ${result.summary.mediumCodeExists}`);
  console.log(`- conclusion: ${result.summary.conclusion}`);
  for (const row of result.identityFields.slice(0, 12)) {
    console.log(`  ${row.strength} ${row.alias} ${row.jsonPath} populated=${row.populatedCount} unique=${row.distinctCount}`);
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await buildCafe24ProductIdentityApiProbe(options);
  printSummary(result);
  if (options.dryRun) {
    console.log("- dry-run: 결과 파일을 쓰지 않았습니다.");
    return;
  }
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`- output: ${options.output.replace(`${rootDir}/`, "")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
