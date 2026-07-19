#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const outputPathDefault = join(workDir, "cafe24-api-access-diagnostic.json");

const SENSITIVE_KEY_PATTERN = /authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|cookie|set-cookie|api[_-]?key|token/i;
const PLACEHOLDER_PATTERN = /^(changeme|replace|placeholder|your_|xxx+|test|dummy|sample|none|null)$/i;

function parseCliArgs(argv) {
  const options = { productNo: "", output: outputPathDefault, dryRun: false, maxCalls: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--product-no") options.productNo = String(argv[++index] || "").trim();
    else if (arg.startsWith("--product-no=")) options.productNo = String(arg.slice("--product-no=".length)).trim();
    else if (arg === "--output") options.output = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--output=")) options.output = resolve(rootDir, arg.slice("--output=".length));
    else if (arg === "--max-calls") options.maxCalls = Math.max(1, Math.min(5, Number(argv[++index]) || 5));
    else if (arg.startsWith("--max-calls=")) options.maxCalls = Math.max(1, Math.min(5, Number(arg.slice("--max-calls=".length)) || 5));
  }
  return options;
}

async function loadEnvWithSources() {
  const envPath = join(rootDir, ".env");
  const values = { ...process.env };
  const sources = {};
  for (const key of Object.keys(process.env)) sources[key] = "process.env";
  if (existsSync(envPath)) {
    const text = await readFile(envPath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (process.env[key] !== undefined) continue;
      values[key] = value;
      sources[key] = ".env";
    }
  }
  return { values, sources, envPathExists: existsSync(envPath) };
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
    return { exists: true, record, error: null };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, record: null, error: null };
    return { exists: true, record: null, error: error.message };
  }
}

export function describeEnvValue(name, value, source = "missing") {
  const stringValue = value === undefined || value === null ? "" : String(value);
  const trimmed = stringValue.trim();
  return {
    name,
    present: value !== undefined && value !== null,
    source,
    length: stringValue.length,
    empty: trimmed.length === 0,
    containsWhitespace: /\s/.test(stringValue),
    hasLeadingOrTrailingWhitespace: stringValue !== trimmed,
    looksPlaceholder: PLACEHOLDER_PATTERN.test(trimmed)
  };
}

export function redactSensitive(input) {
  if (Array.isArray(input)) return input.map(redactSensitive);
  if (!input || typeof input !== "object") {
    if (typeof input === "string") return input.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
    return input;
  }
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactSensitive(value);
    }
  }
  return result;
}

function tokenNeedsRefresh(record, skewMs = 10 * 60 * 1000) {
  if (!record?.accessToken) return null;
  if (!record.expiresAt) return false;
  const expiresAt = new Date(record.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt - Date.now() <= skewMs;
}

function safeTokenRecord(recordResult, env, sources) {
  const record = recordResult.record;
  return {
    tokenStore: {
      pathKind: env.CAFE24_TOKEN_STORE_DIR ? "configured" : "work_dir_default",
      configured: Boolean(env.CAFE24_TOKEN_STORE_DIR),
      exists: recordResult.exists,
      parseError: recordResult.error || null
    },
    record: {
      status: record?.status || (record ? "active" : "missing"),
      hasAccessToken: Boolean(record?.accessToken),
      accessTokenLength: record?.accessToken ? String(record.accessToken).length : 0,
      hasRefreshToken: Boolean(record?.refreshToken),
      refreshTokenLength: record?.refreshToken ? String(record.refreshToken).length : 0,
      expiresAt: record?.expiresAt || null,
      updatedAt: record?.updatedAt || null,
      lastRefreshAt: record?.lastRefreshAt || null,
      reauthRequiredAt: record?.reauthRequiredAt || null,
      needsRefresh: tokenNeedsRefresh(record),
      lastError: record?.lastError ? redactSensitive({ message: record.lastError }).message : null
    },
    effectiveAccessToken: describeEnvValue("CAFE24_ACCESS_TOKEN", env.CAFE24_ACCESS_TOKEN, record?.accessToken ? "token_store" : sources.CAFE24_ACCESS_TOKEN || "missing")
  };
}

function apiVersion(env) {
  return env.CAFE24_API_VERSION || env.CAFE24_ADMIN_API_VERSION || "2025-06-01";
}

function cafe24Headers(env) {
  return {
    Authorization: env.CAFE24_ACCESS_TOKEN ? "Bearer [REDACTED]" : "missing",
    "Content-Type": "application/json",
    "X-Cafe24-Api-Version": apiVersion(env)
  };
}

function classifyApiError(status, body = {}, networkError = null) {
  if (networkError) return "network_failure";
  const message = String(body?.error?.message || body?.error_description || body?.message || body?.error || "");
  const code = String(body?.error?.code || body?.error_code || "");
  if (status === 401 || /invalid[_ ]?token|expired|revoked|unauthorized/i.test(message)) return "access_token_invalid";
  if (status === 403 || /scope|permission|forbidden|권한/i.test(`${message} ${code}`)) return "insufficient_scope";
  if (status === 404) return "endpoint_not_found_unconfirmed";
  if (status === 429) return "rate_limited";
  return "api_error_unclassified";
}

export function classifyEndpointResult(result) {
  if (result.ok) return "supported";
  if (result.category === "endpoint_not_found_unconfirmed" && result.authPrerequisiteFailed) return "cannot_confirm_until_auth_succeeds";
  if (result.category === "endpoint_not_found_unconfirmed") return "endpoint_path_invalid_or_unsupported";
  return result.category || "unable_to_determine";
}

async function cafe24GetNoRefresh(env, path, params = {}) {
  if (!env.CAFE24_MALL_ID) return { ok: false, status: null, category: "env_not_loaded", message: "CAFE24_MALL_ID missing", topLevelKeys: [] };
  if (!env.CAFE24_ACCESS_TOKEN) return { ok: false, status: null, category: "access_token_missing", message: "CAFE24_ACCESS_TOKEN missing", topLevelKeys: [] };
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin${path}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.CAFE24_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": apiVersion(env)
      }
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text || "{}");
    } catch {
      body = { message: text.slice(0, 300) };
    }
    const message = body?.error?.message || body?.error_description || body?.message || (response.ok ? null : `HTTP ${response.status}`);
    return {
      ok: response.ok && !body.error,
      status: response.status,
      category: response.ok && !body.error ? null : classifyApiError(response.status, body),
      message,
      errorCode: body?.error?.code || body?.error_code || null,
      topLevelKeys: Object.keys(body),
      bodyShape: response.ok && !body.error ? responseShape(body) : null,
      body: response.ok && !body.error ? body : null,
      compactErrorBody: response.ok && !body.error ? null : redactSensitive(compactBody(body))
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      category: classifyApiError(null, {}, error),
      message: error.message,
      topLevelKeys: [],
      compactErrorBody: null
    };
  }
}

function compactBody(body) {
  if (!body || typeof body !== "object") return body;
  const compact = {};
  for (const key of ["error", "error_description", "message", "errors", "trace_id"]) if (body[key] !== undefined) compact[key] = body[key];
  return Object.keys(compact).length ? compact : Object.keys(body).slice(0, 8);
}

function responseShape(body) {
  const result = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (Array.isArray(value)) result[key] = { type: "array", length: value.length, firstKeys: value[0] && typeof value[0] === "object" ? Object.keys(value[0]).slice(0, 20) : [] };
    else if (value && typeof value === "object") result[key] = { type: "object", keys: Object.keys(value).slice(0, 30) };
    else result[key] = { type: typeof value };
  }
  return result;
}

function normalizePath(path) {
  return String(path || "").replace(/\[\d+\]/g, "[]");
}

const IDENTITY_ALIASES = ["barcode", "bar_code", "barCode", "ean", "ean13", "jan", "isbn", "upc", "gtin", "gtin8", "gtin12", "gtin13", "gtin14", "product_code", "productCode", "custom_product_code", "manufacturer_code", "manufacturerCode", "supplier_code", "supplierCode", "variant_code", "variantCode", "item_code", "itemCode", "sku", "model_number", "modelNumber"];

function aliasKey(key) {
  return String(key || "").replace(/[_-]/g, "").toLowerCase();
}

function findIdentityPaths(input) {
  const aliases = new Map();
  for (const alias of IDENTITY_ALIASES) {
    const key = aliasKey(alias);
    if (!aliases.has(key)) aliases.set(key, alias);
  }
  const hits = [];
  function visit(value, path) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      const nextPath = path ? `${path}.${key}` : key;
      const alias = aliases.get(aliasKey(key));
      if (alias) hits.push({ alias, jsonPath: normalizePath(nextPath), populated: child !== null && child !== undefined && String(child).trim() !== "" });
      if (child && typeof child === "object") visit(child, nextPath);
    }
  }
  visit(input, "");
  return hits.sort((a, b) => `${a.alias}:${a.jsonPath}`.localeCompare(`${b.alias}:${b.jsonPath}`));
}

async function latestProductDashboardCache() {
  let files = [];
  try {
    files = (await readdir(workDir)).filter((name) => /^product-dashboard-proxy-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(name));
  } catch {
    return null;
  }
  const rows = [];
  for (const name of files) {
    const filePath = join(workDir, name);
    try {
      const fileStat = await stat(filePath);
      rows.push({ name, path: filePath, mtimeMs: fileStat.mtimeMs, size: fileStat.size });
    } catch {
      // ignore disappearing files
    }
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  const latest = rows[0];
  if (!latest) return null;
  try {
    const data = JSON.parse(await readFile(latest.path, "utf8"));
    return {
      relativePath: `work/${latest.name}`,
      size: latest.size,
      modifiedAt: new Date(latest.mtimeMs).toISOString(),
      productCount: (data.products || []).length,
      source: data.source || null,
      syncedAt: data.syncedAt || data.generatedAt || null,
      firstProductNo: data.products?.[0]?.productNo || data.products?.[0]?.product_no || null
    };
  } catch (error) {
    return { relativePath: `work/${latest.name}`, size: latest.size, modifiedAt: new Date(latest.mtimeMs).toISOString(), error: error.message };
  }
}

function buildPathComparison(env, sources) {
  const base = env.CAFE24_MALL_ID ? `https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin` : null;
  const existing = {
    tokenSource: "readCafe24TokenRecord() -> hydrateCafe24EnvFromTokenRecord()",
    envLoading: "server.mjs process env + existing server bootstrap",
    tokenRefreshBehavior: "ensureCafe24AccessToken() refreshes expired/invalid tokens and retries GET once",
    baseUrl: base,
    apiVersion: apiVersion(env),
    headers: cafe24Headers(env),
    productList: "GET /products?limit&offset",
    productDetail: "GET /products/{productNo}",
    variants: "GET /products/{productNo}/variants?limit=100&embed=inventories",
    diagnosticsEndpoint: "/api/diagnostics/cafe24-product-access"
  };
  const probe = {
    tokenSource: "scripts/probe-cafe24-product-identity-api.mjs -> token store or env access token",
    envLoading: ".env parsed from repository root, process.env wins",
    tokenRefreshBehavior: "no refresh; GET-only product API probe after Phase 2C adjustment",
    baseUrl: base,
    apiVersion: apiVersion(env),
    headers: cafe24Headers(env),
    productDetail: "GET /products/{productNo}",
    variants: "GET /products/{productNo}/variants",
    variantsWithInventories: "GET /products/{productNo}/variants?embed=inventories",
    inventories: "GET /products/{productNo}/inventories"
  };
  const compareKeys = ["tokenSource", "envLoading", "tokenRefreshBehavior", "baseUrl", "apiVersion"];
  const differences = compareKeys
    .filter((key) => existing[key] !== probe[key])
    .map((key) => ({ field: key, existing: existing[key], probe: probe[key] }));
  if (sources.CAFE24_ACCESS_TOKEN === "process.env") {
    differences.push({ field: "accessTokenPrecedence", existing: "server token store hydrates env before request", probe: "process.env CAFE24_ACCESS_TOKEN can override .env but token store then hydrates if present" });
  }
  return { existing, probe, differences };
}

function chooseProductNo(options, cache) {
  if (options.productNo) return options.productNo;
  if (cache?.firstProductNo) return String(cache.firstProductNo);
  return "14600";
}

function endpointDefinitions(productNo) {
  return [
    { endpointName: "product_detail", path: `/products/${encodeURIComponent(productNo)}`, params: {}, existingCodeUses: true, priority: 1 },
    { endpointName: "product_variants", path: `/products/${encodeURIComponent(productNo)}/variants`, params: { limit: 20 }, existingCodeUses: true, priority: 2 },
    { endpointName: "product_variants_with_inventories", path: `/products/${encodeURIComponent(productNo)}/variants`, params: { limit: 20, embed: "inventories" }, existingCodeUses: true, priority: 3 },
    { endpointName: "product_inventories", path: `/products/${encodeURIComponent(productNo)}/inventories`, params: {}, existingCodeUses: true, priority: 4 }
  ];
}

function hashString(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

export function compareAccessPaths(existing, probe) {
  const keys = [...new Set([...Object.keys(existing || {}), ...Object.keys(probe || {})])].sort();
  return keys
    .filter((key) => JSON.stringify(existing?.[key]) !== JSON.stringify(probe?.[key]))
    .map((key) => ({ field: key, existing: existing?.[key] ?? null, probe: probe?.[key] ?? null }));
}

export async function buildCafe24ApiAccessDiagnostic(options = {}) {
  const { values: env, sources, envPathExists } = await loadEnvWithSources();
  const tokenRecord = await readTokenRecord(env);
  const cache = await latestProductDashboardCache();
  const productNo = chooseProductNo(options, cache);
  const pathComparison = buildPathComparison(env, sources);
  const environmentKeys = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET", "CAFE24_SCOPES", "CAFE24_API_VERSION", "CAFE24_ADMIN_API_VERSION", "CAFE24_TOKEN_STORE_DIR", "CAFE24_ACCESS_TOKEN", "CAFE24_REFRESH_TOKEN", "CAFE24_PROXY_BASE_URL"];
  const environment = {
    cwd: process.cwd() === rootDir ? "repo_root" : "non_repo_cwd",
    repoRoot: rootDir,
    envPathExists,
    variables: environmentKeys.map((name) => describeEnvValue(name, env[name], sources[name] || (tokenRecord.record?.accessToken && name === "CAFE24_ACCESS_TOKEN" ? "token_store" : "missing")))
  };
  const endpoints = [];
  const authPrerequisiteFailed = !env.CAFE24_ACCESS_TOKEN || tokenRecord.record?.status === "reauth_required";
  let calls = 0;
  for (const endpoint of endpointDefinitions(productNo)) {
    if (calls >= (options.maxCalls || 5)) break;
    calls += 1;
    const result = await cafe24GetNoRefresh(env, endpoint.path, endpoint.params);
    const identityHits = result.ok ? findIdentityPaths(result.body) : [];
    endpoints.push({
      endpointName: endpoint.endpointName,
      requestMethod: "GET",
      path: endpoint.path,
      params: endpoint.params,
      existingCodeUses: endpoint.existingCodeUses,
      ok: result.ok,
      httpStatus: result.status,
      category: result.category,
      conclusion: classifyEndpointResult({ ...result, authPrerequisiteFailed: authPrerequisiteFailed || result.category === "access_token_invalid" }),
      message: result.message || null,
      errorCode: result.errorCode || null,
      topLevelKeys: result.topLevelKeys || [],
      responseShape: result.bodyShape,
      identityLikePathCount: identityHits.length,
      identityLikePaths: identityHits,
      compactErrorBody: result.compactErrorBody
    });
  }
  const firstSuccess = endpoints.find((item) => item.ok);
  const authFailures = endpoints.filter((item) => ["access_token_invalid", "access_token_missing"].includes(item.category)).length;
  if (authFailures) {
    for (const endpoint of endpoints) {
      if (endpoint.category === "endpoint_not_found_unconfirmed") endpoint.conclusion = "cannot_confirm_until_auth_succeeds";
    }
  }
  const endpointFailures = endpoints.filter((item) => item.category === "endpoint_not_found_unconfirmed").length;
  const authStatus = firstSuccess
    ? "valid_for_at_least_one_product_get"
    : authFailures
      ? "access_token_invalid_or_expired"
      : tokenRecord.record?.status === "reauth_required"
        ? "reauth_required"
        : "unable_to_determine";
  const summary = {
    productNo,
    attemptedGetCalls: endpoints.length,
    successCount: endpoints.filter((item) => item.ok).length,
    failureCount: endpoints.filter((item) => !item.ok).length,
    authenticationStatus: authStatus,
    endpointNotFoundCount: endpointFailures,
    endpointNotFoundConclusion: authFailures ? "cannot_confirm_endpoint_absence_until_auth_succeeds" : "review_endpoint_paths",
    minimalProductDetailGetSucceeded: Boolean(endpoints.find((item) => item.endpointName === "product_detail" && item.ok)),
    tokenValuesLogged: false,
    mutationRequestsMade: false
  };
  const recommendation = firstSuccess
    ? { case: "E", nextStep: "Re-run Cafe24 Product Identity API Probe with the working access path." }
    : authFailures
      ? { case: "B", nextStep: "Cafe24 OAuth 재인증 또는 기존 server refresh 경로 확인이 필요합니다. 이번 진단은 refresh token 재발급을 실행하지 않았습니다." }
      : { case: "unable_to_determine", nextStep: "Review env, token store, and endpoint support before repeating the read-only probe." };
  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only_access_diagnostic",
    environment,
    token: safeTokenRecord(tokenRecord, env, sources),
    existingProductDashboardCache: cache,
    existingAccessPath: pathComparison.existing,
    probeAccessPath: pathComparison.probe,
    differences: pathComparison.differences,
    authentication: {
      status: authStatus,
      evidence: endpoints.map((item) => ({ endpointName: item.endpointName, httpStatus: item.httpStatus, category: item.category, messageHash: item.message ? hashString(item.message) : null })),
      confidence: firstSuccess ? 0.9 : authFailures ? 0.8 : 0.4,
      unresolvedReasons: firstSuccess ? [] : ["No successful product GET response in this diagnostic run", endpointFailures ? "404 endpoint responses may be masked or secondary while authentication is failing" : null].filter(Boolean)
    },
    scopes: {
      configured: env.CAFE24_SCOPES ? String(env.CAFE24_SCOPES).split(/[\s,]+/).filter(Boolean) : [],
      productReadScopeVisible: env.CAFE24_SCOPES ? /mall\.read_product|read_product|product/i.test(env.CAFE24_SCOPES) : null,
      note: "Stored OAuth token scopes are not introspected by this diagnostic unless exposed through CAFE24_SCOPES."
    },
    endpoints,
    minimalVerification: {
      productNo,
      productDetail: endpoints.find((item) => item.endpointName === "product_detail") || null,
      variants: endpoints.find((item) => item.endpointName === "product_variants") || null,
      variantsWithInventories: endpoints.find((item) => item.endpointName === "product_variants_with_inventories") || null,
      inventories: endpoints.find((item) => item.endpointName === "product_inventories") || null
    },
    summary,
    recommendation
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await buildCafe24ApiAccessDiagnostic(options);
  if (!options.dryRun) {
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log("Cafe24 API access diagnostic");
  console.log(`- productNo: ${result.summary.productNo}`);
  console.log(`- GET calls: ${result.summary.successCount}/${result.summary.attemptedGetCalls} succeeded`);
  console.log(`- auth status: ${result.summary.authenticationStatus}`);
  console.log(`- endpoint 404 count: ${result.summary.endpointNotFoundCount}`);
  console.log(`- conclusion: ${result.recommendation.case}`);
  if (!options.dryRun) console.log(`- output: ${options.output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Cafe24 API access diagnostic failed: ${error.message}`);
    process.exitCode = 1;
  });
}
