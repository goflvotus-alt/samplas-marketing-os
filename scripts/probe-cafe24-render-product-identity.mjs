#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareBarcodeValues,
  findIdentityFields,
  summarizeIdentityFields
} from "./probe-cafe24-product-identity-api.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const outputPathDefault = join(workDir, "cafe24-render-product-identity-probe.json");
const DEFAULT_PRODUCT_NOS = ["14600", "14595", "14599", "14598", "14597"];

function parseCliArgs(argv) {
  const options = { productNos: [], limit: 5, output: outputPathDefault, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--product-no") options.productNos.push(String(argv[++index] || "").trim());
    else if (arg.startsWith("--product-no=")) options.productNos.push(String(arg.slice("--product-no=".length)).trim());
    else if (arg === "--limit") options.limit = Math.max(1, Math.min(5, Number(argv[++index]) || 5));
    else if (arg.startsWith("--limit=")) options.limit = Math.max(1, Math.min(5, Number(arg.slice("--limit=".length)) || 5));
    else if (arg === "--output") options.output = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--output=")) options.output = resolve(rootDir, arg.slice("--output=".length));
  }
  options.productNos = [...new Set(options.productNos.filter(Boolean))];
  if (!options.productNos.length) options.productNos = DEFAULT_PRODUCT_NOS.slice(0, options.limit);
  else options.productNos = options.productNos.slice(0, options.limit);
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
    if (process.env[key] !== undefined) continue;
    parsed[key] = value;
  }
  return parsed;
}

function proxyHeaders(env) {
  const headers = {};
  if (env.CAFE24_PROXY_SECRET) headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
  if (env.CAFE24_PROXY_BASIC_AUTH) headers.Authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
  return headers;
}

function safeProxyEnvironment(env) {
  return {
    proxyBaseUrlPresent: Boolean(env.CAFE24_PROXY_BASE_URL),
    proxyBaseUrlHost: env.CAFE24_PROXY_BASE_URL ? new URL(env.CAFE24_PROXY_BASE_URL).hostname : null,
    hasProxySecret: Boolean(env.CAFE24_PROXY_SECRET),
    hasProxyBasicAuth: Boolean(env.CAFE24_PROXY_BASIC_AUTH),
    tokenValuesLogged: false
  };
}

async function fetchJson(baseUrl, path, env) {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const response = await fetch(url, {
    method: "GET",
    headers: proxyHeaders(env),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    body = { message: text.slice(0, 300) };
  }
  return { ok: response.ok && !body.error, status: response.status, body };
}

function compactProductResponse(productNo, result) {
  const product = result.body?.product || null;
  const identityHits = product ? findIdentityFields({ product }) : [];
  return {
    productNo,
    endpointName: "render_product_detail",
    requestMethod: "GET",
    path: `/api/cafe24/products/${productNo}`,
    ok: result.ok,
    httpStatus: result.status,
    topLevelKeys: Object.keys(result.body || {}),
    responseShape: product ? { productKeys: Object.keys(product).slice(0, 80) } : null,
    identityLikePathCount: identityHits.length,
    identityHits,
    error: result.ok ? null : result.body?.error || result.body?.message || `HTTP ${result.status}`
  };
}

async function readEcountBarcodeUniverse() {
  const candidates = [
    join(workDir, "ecount-inventory", "latest.json"),
    join(workDir, "ecount-inventory", "raw-products.json"),
    join(workDir, "ecount-inventory", "raw-inventory.json"),
    join(workDir, "inventory-reconciliation-diagnostic.json"),
    join(workDir, "canonical-product-matching-diagnostic.json")
  ];
  const values = new Set();
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(await readFile(file, "utf8"));
      collectBarcodeValues(data, values);
    } catch {
      // Ignore unavailable or large malformed diagnostic sources.
    }
  }
  return values;
}

function collectBarcodeValues(value, values) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectBarcodeValues(item, values);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(BAR_CODE|barCode|barcode|bar_code)$/i.test(key) && child !== null && child !== undefined && String(child).trim()) values.add(String(child).trim());
    if (child && typeof child === "object") collectBarcodeValues(child, values);
  }
}

export async function buildRenderProductIdentityProbe(options = {}) {
  const env = await loadEnv();
  if (!env.CAFE24_PROXY_BASE_URL) throw new Error("CAFE24_PROXY_BASE_URL is required for Render product identity probe");
  const baseUrl = env.CAFE24_PROXY_BASE_URL.replace(/\/$/, "");
  const productNos = options.productNos?.length ? options.productNos : DEFAULT_PRODUCT_NOS.slice(0, options.limit || 5);
  const tokenStoreResult = await fetchJson(baseUrl, "/api/diagnostics/cafe24-token-store", env).catch((error) => ({ ok: false, status: null, body: { error: error.message } }));
  const accessResult = await fetchJson(baseUrl, "/api/diagnostics/cafe24-product-access", env).catch((error) => ({ ok: false, status: null, body: { error: error.message } }));
  const endpointRows = [];
  for (const productNo of productNos) {
    const response = await fetchJson(baseUrl, `/api/cafe24/products/${encodeURIComponent(productNo)}`, env).catch((error) => ({ ok: false, status: null, body: { error: error.message } }));
    endpointRows.push(compactProductResponse(productNo, response));
  }
  const ecountBarcodes = await readEcountBarcodeUniverse();
  const identityFields = summarizeIdentityFields(endpointRows.map((row) => ({
    endpointName: row.endpointName,
    identityHits: row.identityHits
  })), ecountBarcodes);
  const barcodeComparison = compareBarcodeValues(identityFields, ecountBarcodes);
  const accessChecks = accessResult.body?.apiChecks || [];
  const result = {
    generatedAt: new Date().toISOString(),
    mode: "render_authenticated_product_identity_probe",
    proxy: safeProxyEnvironment(env),
    tokenStoreDiagnostic: {
      ok: tokenStoreResult.ok,
      httpStatus: tokenStoreResult.status,
      source: tokenStoreResult.body?.token?.source || null,
      configured: tokenStoreResult.body?.token?.configured ?? null,
      status: tokenStoreResult.body?.token?.status || null,
      hasAccessToken: tokenStoreResult.body?.token?.hasAccessToken ?? null,
      hasRefreshToken: tokenStoreResult.body?.token?.hasRefreshToken ?? null,
      needsRefresh: tokenStoreResult.body?.token?.needsRefresh ?? null,
      reauthRequired: tokenStoreResult.body?.token?.reauthRequired ?? null,
      lastError: tokenStoreResult.body?.token?.lastError || null
    },
    accessDiagnostic: {
      ok: accessResult.ok,
      httpStatus: accessResult.status,
      dashboardReady: accessResult.body?.dashboardReady || null,
      apiChecks: accessChecks.map((item) => ({
        apiName: item.apiName,
        ok: item.ok,
        httpStatus: item.httpStatus,
        errorCode: item.errorCode || null,
        message: item.message || null
      }))
    },
    sample: {
      actualCount: productNos.length,
      productNos
    },
    endpoints: [
      {
        endpointName: "render_token_store_diagnostic",
        requestMethod: "GET",
        path: "/api/diagnostics/cafe24-token-store",
        ok: tokenStoreResult.ok,
        httpStatus: tokenStoreResult.status
      },
      {
        endpointName: "render_product_access_diagnostic",
        requestMethod: "GET",
        path: "/api/diagnostics/cafe24-product-access",
        ok: accessResult.ok,
        httpStatus: accessResult.status
      },
      ...endpointRows
    ],
    identityFields,
    summary: {
      productDetailSuccess: endpointRows.some((row) => row.productNo === "14600" && row.ok),
      productDetailSuccessCount: endpointRows.filter((row) => row.ok).length,
      productDetailFailureCount: endpointRows.filter((row) => !row.ok).length,
      barcodeLikeExists: barcodeComparison.cafe24BarcodeLikePopulatedCount > 0,
      mediumCodeExists: identityFields.some((item) => item.strength === "medium" && item.populatedCount > 0),
      barcodeComparison,
      unavailableScopes: [
        "raw product variants through Render product detail endpoint",
        "raw product inventories through Render product detail endpoint",
        "raw custom/additional field endpoint unless included in product detail response"
      ],
      tokenValuesLogged: false,
      mutationRequestsMade: false
    },
    recommendation: null
  };
  result.recommendation = result.summary.barcodeLikeExists
    ? { case: "A", nextStep: "Extend Cafe24 normalization/cache schema in a later phase to retain discovered barcode-like fields." }
    : result.summary.mediumCodeExists
      ? { case: "B", nextStep: "Proceed to code-combination matching diagnostic using populated medium identity fields." }
      : { case: "C", nextStep: "No barcode-like or medium identity field was observed through existing Render product detail endpoint; use manual review or expose additional read-only variant/custom endpoints in a later phase." };
  return result;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await buildRenderProductIdentityProbe(options);
  if (!options.dryRun) await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log("Cafe24 Render product identity probe");
  console.log(`- product detail 14600: ${result.summary.productDetailSuccess ? "success" : "failed"}`);
  console.log(`- product detail calls: ${result.summary.productDetailSuccessCount}/${result.sample.actualCount} succeeded`);
  console.log(`- barcode-like populated: ${result.summary.barcodeComparison.cafe24BarcodeLikePopulatedCount}`);
  console.log(`- medium code exists: ${result.summary.mediumCodeExists}`);
  console.log(`- ECOUNT exact matches: ${result.summary.barcodeComparison.ecountExactBarcodeMatchCount}`);
  if (!options.dryRun) console.log(`- output: ${options.output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Cafe24 Render product identity probe failed: ${error.message}`);
    process.exitCode = 1;
  });
}
