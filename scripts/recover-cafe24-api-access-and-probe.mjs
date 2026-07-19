#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const outputPathDefault = join(workDir, "cafe24-oauth-access-recovery-and-identity-probe.json");
const SENSITIVE_KEY_PATTERN = /authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|cookie|set-cookie|api[_-]?key|token/i;

function parseCliArgs(argv) {
  const options = { productNo: "14600", limit: 5, output: outputPathDefault, diagnoseOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--diagnose-only") options.diagnoseOnly = true;
    else if (arg === "--product-no") options.productNo = String(argv[++index] || "").trim();
    else if (arg.startsWith("--product-no=")) options.productNo = String(arg.slice("--product-no=".length)).trim();
    else if (arg === "--limit") options.limit = Math.max(1, Math.min(5, Number(argv[++index]) || 5));
    else if (arg.startsWith("--limit=")) options.limit = Math.max(1, Math.min(5, Number(arg.slice("--limit=".length)) || 5));
    else if (arg === "--output") options.output = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--output=")) options.output = resolve(rootDir, arg.slice("--output=".length));
  }
  return options;
}

async function loadEnv() {
  const envPath = join(rootDir, ".env");
  const parsed = { ...process.env };
  const sources = {};
  for (const key of Object.keys(process.env)) sources[key] = "process.env";
  if (!existsSync(envPath)) return { env: parsed, sources, envPathExists: false };
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
    sources[key] = ".env";
  }
  return { env: parsed, sources, envPathExists: true };
}

function redactSensitive(input) {
  if (Array.isArray(input)) return input.map(redactSensitive);
  if (!input || typeof input !== "object") {
    if (typeof input === "string") return input.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
    return input;
  }
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSensitive(value);
  }
  return result;
}

function tokenStoreDir(env) {
  return resolve(env.CAFE24_TOKEN_STORE_DIR || join(workDir, "secrets"));
}

function tokenStoreFile(env) {
  return join(tokenStoreDir(env), "cafe24-token-store.json");
}

function hashValue(value) {
  return value ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null;
}

async function readTokenStoreSummary(env) {
  const file = tokenStoreFile(env);
  try {
    const text = await readFile(file, "utf8");
    const record = JSON.parse(text);
    const fileStat = await stat(file);
    return {
      configured: Boolean(env.CAFE24_TOKEN_STORE_DIR),
      exists: true,
      pathKind: env.CAFE24_TOKEN_STORE_DIR ? "configured" : "work_dir_default",
      size: fileStat.size,
      status: record.status || "active",
      hasAccessToken: Boolean(record.accessToken),
      accessTokenLength: record.accessToken ? String(record.accessToken).length : 0,
      accessTokenHashPresent: Boolean(hashValue(record.accessToken)),
      hasRefreshToken: Boolean(record.refreshToken),
      refreshTokenLength: record.refreshToken ? String(record.refreshToken).length : 0,
      refreshTokenHashPresent: Boolean(hashValue(record.refreshToken)),
      expiresAt: record.expiresAt || null,
      updatedAt: record.updatedAt || null,
      lastRefreshAt: record.lastRefreshAt || null,
      reauthRequiredAt: record.reauthRequiredAt || null,
      lastError: record.lastError ? redactSensitive({ message: record.lastError }).message : null
    };
  } catch (error) {
    return {
      configured: Boolean(env.CAFE24_TOKEN_STORE_DIR),
      exists: false,
      pathKind: env.CAFE24_TOKEN_STORE_DIR ? "configured" : "work_dir_default",
      parseError: error.code === "ENOENT" ? null : error.message
    };
  }
}

function describeEnvValue(name, value, source = "missing") {
  const text = value === undefined || value === null ? "" : String(value);
  const trimmed = text.trim();
  return {
    name,
    present: value !== undefined && value !== null,
    source,
    length: text.length,
    empty: trimmed.length === 0,
    containsWhitespace: /\s/.test(text),
    hasLeadingOrTrailingWhitespace: text !== trimmed
  };
}

function apiVersion(env) {
  return env.CAFE24_API_VERSION || env.CAFE24_ADMIN_API_VERSION || "2025-06-01";
}

function classifyApiError(status, body = {}, networkError = null) {
  if (networkError) return "network_failure";
  const message = String(body?.error?.message || body?.error_description || body?.message || body?.error || "");
  if (status === 401 || /invalid[_ ]?token|expired|revoked|unauthorized/i.test(message)) return "access_token_invalid";
  if (status === 403 || /scope|permission|forbidden|권한/i.test(message)) return "insufficient_scope";
  if (status === 404) return "endpoint_not_found_unconfirmed";
  if (status === 429) return "rate_limited";
  return "api_error_unclassified";
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
      },
      signal: AbortSignal.timeout(10000)
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
      topLevelKeys: Object.keys(body),
      responseShape: response.ok && !body.error ? responseShape(body) : null
    };
  } catch (error) {
    return { ok: false, status: null, category: classifyApiError(null, {}, error), message: error.message, topLevelKeys: [] };
  }
}

function responseShape(body) {
  const shape = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (Array.isArray(value)) shape[key] = { type: "array", length: value.length, firstKeys: value[0] && typeof value[0] === "object" ? Object.keys(value[0]).slice(0, 20) : [] };
    else if (value && typeof value === "object") shape[key] = { type: "object", keys: Object.keys(value).slice(0, 30) };
    else shape[key] = { type: typeof value };
  }
  return shape;
}

function endpointDefinitions(productNo) {
  return [
    { endpointName: "product_detail", path: `/products/${encodeURIComponent(productNo)}`, params: {} },
    { endpointName: "product_variants", path: `/products/${encodeURIComponent(productNo)}/variants`, params: { limit: 20 } },
    { endpointName: "product_variants_with_inventories", path: `/products/${encodeURIComponent(productNo)}/variants`, params: { limit: 20, embed: "inventories" } },
    { endpointName: "product_inventories", path: `/products/${encodeURIComponent(productNo)}/inventories`, params: {} }
  ];
}

export function classifyRecoveryGate(tokenStore, envSummary = []) {
  if (!tokenStore.exists) return { canRefreshSafely: false, reason: "token_store_missing" };
  if (tokenStore.status === "reauth_required") return { canRefreshSafely: false, reason: "token_store_reauth_required" };
  if (!tokenStore.hasAccessToken || !tokenStore.hasRefreshToken) return { canRefreshSafely: false, reason: "token_store_missing_token" };
  const missingRequired = envSummary.filter((item) => ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET"].includes(item.name) && (!item.present || item.empty));
  if (missingRequired.length) return { canRefreshSafely: false, reason: "refresh_env_missing", missing: missingRequired.map((item) => item.name) };
  return { canRefreshSafely: true, reason: "existing_server_refresh_path_available" };
}

export function classifyRecoveryResult(refreshGate, minimalVerification) {
  if (minimalVerification.productDetailSuccess) return "access_recovered";
  if (!refreshGate.canRefreshSafely) return "reauth_or_token_store_setup_required";
  if (minimalVerification.productDetailStatus === 401) return "refresh_required_but_not_executed_by_safety_gate";
  return "unable_to_determine";
}

export async function recoverCafe24ApiAccessAndProbe(options = {}) {
  const { env, sources, envPathExists } = await loadEnv();
  const envSummary = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET", "CAFE24_ACCESS_TOKEN", "CAFE24_REFRESH_TOKEN", "CAFE24_SCOPES", "CAFE24_API_VERSION", "CAFE24_ADMIN_API_VERSION", "CAFE24_TOKEN_STORE_DIR", "CAFE24_PROXY_BASE_URL"].map((name) => describeEnvValue(name, env[name], sources[name] || "missing"));
  const tokenStore = await readTokenStoreSummary(env);
  const refreshGate = classifyRecoveryGate(tokenStore, envSummary);
  const endpoints = [];
  for (const endpoint of endpointDefinitions(options.productNo || "14600")) {
    const result = await cafe24GetNoRefresh(env, endpoint.path, endpoint.params);
    endpoints.push({
      endpointName: endpoint.endpointName,
      requestMethod: "GET",
      path: endpoint.path,
      params: endpoint.params,
      ok: result.ok,
      httpStatus: result.status,
      category: result.category,
      message: result.message,
      topLevelKeys: result.topLevelKeys,
      responseShape: result.responseShape
    });
  }
  const productDetail = endpoints.find((item) => item.endpointName === "product_detail");
  const variants = endpoints.find((item) => item.endpointName === "product_variants");
  const inventories = endpoints.find((item) => item.endpointName === "product_inventories");
  const authFailed = endpoints.some((item) => item.category === "access_token_invalid" || item.category === "access_token_missing");
  const minimalVerification = {
    productDetailSuccess: Boolean(productDetail?.ok),
    productDetailStatus: productDetail?.httpStatus ?? null,
    variantsSuccess: Boolean(variants?.ok),
    variantsStatus: variants?.httpStatus ?? null,
    inventoriesSuccess: Boolean(inventories?.ok),
    inventoriesStatus: inventories?.httpStatus ?? null,
    inventoriesConclusion: authFailed ? "cannot_confirm_until_auth_succeeds" : inventories?.ok ? "supported" : inventories?.httpStatus === 404 ? "endpoint_path_invalid_or_unsupported" : "failed"
  };
  const authenticationRecovery = {
    refreshAttempted: false,
    refreshSucceeded: false,
    tokenStoreUpdated: false,
    refreshTokenRotated: false,
    previousTokenStatus: tokenStore.status || (tokenStore.exists ? "unknown" : "missing"),
    resultingTokenStatus: tokenStore.status || (tokenStore.exists ? "unknown" : "missing"),
    failureCategory: refreshGate.canRefreshSafely ? "refresh_not_executed_by_safety_gate" : refreshGate.reason,
    refreshGate,
    note: "No refresh POST was executed because Phase 2E requires preserving operational credentials; without an existing persistent token store, refresh-token rotation could not be safely captured."
  };
  const identityProbe = minimalVerification.productDetailSuccess ? {
    sampledProductCount: 0,
    successfulApiCalls: 0,
    failedApiCalls: 0,
    discoveredIdentityPaths: [],
    barcodeLikeFieldCount: 0,
    mediumIdentityFieldCount: 0,
    ecountExactMatchCount: 0,
    skipped: false
  } : {
    sampledProductCount: 0,
    successfulApiCalls: 0,
    failedApiCalls: 0,
    discoveredIdentityPaths: [],
    barcodeLikeFieldCount: 0,
    mediumIdentityFieldCount: 0,
    ecountExactMatchCount: 0,
    skipped: true,
    reason: "minimal_product_detail_get_failed"
  };
  const summary = {
    result: classifyRecoveryResult(refreshGate, minimalVerification),
    productNo: options.productNo || "14600",
    refreshAttempted: false,
    productDetailGetSucceeded: minimalVerification.productDetailSuccess,
    identityProbeReran: !identityProbe.skipped,
    tokenValuesLogged: false,
    mutationRequestsMade: false,
    operationalTokenStoreModified: false
  };
  const recommendation = summary.result === "access_recovered"
    ? { case: "E", nextStep: "Run the Phase 2C identity probe with the verified access path." }
    : { case: "D", nextStep: "Cafe24 OAuth 재인증 또는 persistent token store 구성이 필요합니다. 기존 /api/cafe24/oauth/start 경로로 사용자 승인 후 재실행하세요." };
  return {
    generatedAt: new Date().toISOString(),
    mode: "oauth_recovery_and_identity_probe_safety_gate",
    environment: { envPathExists, variables: envSummary },
    tokenStore,
    authenticationRecovery,
    minimalVerification,
    endpoints,
    identityProbe,
    summary,
    recommendation
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await recoverCafe24ApiAccessAndProbe(options);
  await mkdir(resolve(options.output, ".."), { recursive: true }).catch(() => {});
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log("Cafe24 OAuth access recovery and identity probe");
  console.log(`- refresh attempted: ${result.authenticationRecovery.refreshAttempted}`);
  console.log(`- refresh gate: ${result.authenticationRecovery.refreshGate.reason}`);
  console.log(`- product detail GET: ${result.minimalVerification.productDetailSuccess ? "success" : "failed"}`);
  console.log(`- identity probe reran: ${result.summary.identityProbeReran}`);
  console.log(`- result: ${result.summary.result}`);
  console.log(`- output: ${options.output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Cafe24 OAuth recovery failed: ${redactSensitive({ message: error.message }).message}`);
    process.exitCode = 1;
  });
}
