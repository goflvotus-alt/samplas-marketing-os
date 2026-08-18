// SAMPLAS Product Registry 리팩터링 — Cafe24 전체 상품 조회 전용 스탠드얼론 클라이언트.
//
// 목적: CLI 스크립트(server.mjs 실행 프로세스 밖)에서 Cafe24 admin/products를 Pagination
// 끝까지(끝 페이지까지) 순회해 "Cafe24 전체 상품"을 얻는다. display/selling 값으로 걸러내지
// 않는다 — 이 함수는 단순히 있는 그대로의 전체 상품을 반환하고, 걸러내는 판단은 호출부(또는
// 그 이후 단계)에 맡긴다.
//
// 인증 패턴은 scripts/probe-cafe24-product-identity-api.mjs / scripts/diagnose-cafe24-api-access.mjs
// 와 동일하다(work/secrets/cafe24-token-store.json 또는 .env의 CAFE24_ACCESS_TOKEN). 이 파일은
// 그 두 스크립트의 인증 흐름을 새로 발명하지 않고 동일하게 재사용한다.
//
// 이 모듈은 fetch 구현을 주입받을 수 있어(옵션 fetchImpl) 실제 네트워크 없이 테스트 가능하다.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");

export async function loadCafe24ScriptEnv() {
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
  if (!record?.accessToken && !env.CAFE24_ACCESS_TOKEN) {
    throw Object.assign(new Error("missing_access_token"), { category: "authentication_failed" });
  }
  if (record?.status === "reauth_required") {
    throw Object.assign(new Error("reauth_required"), { category: "authentication_failed" });
  }
  return env.CAFE24_ACCESS_TOKEN || record?.accessToken;
}

function apiVersion(env) {
  return env.CAFE24_API_VERSION || env.CAFE24_ADMIN_API_VERSION || "2025-06-01";
}

function cafe24ProxyHeaders(env) {
  const headers = {};
  if (env.CAFE24_PROXY_SECRET) {
    headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
  }
  if (env.CAFE24_PROXY_BASIC_AUTH) {
    headers.Authorization =
      `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
  }
  return headers;
}

async function cafe24GetFullCatalogPageFromProxy(
  env,
  { limit, offset },
  { fetchImpl = fetch } = {}
) {
  const base = String(env.CAFE24_PROXY_BASE_URL || "").replace(/\/$/, "");
  if (!base) {
    throw Object.assign(
      new Error("missing_proxy_base_url"),
      { category: "environment_missing" }
    );
  }

  const url = new URL(`${base}/api/cafe24/products/full-catalog`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const response = await fetchImpl(url, {
    method: "GET",
    headers: cafe24ProxyHeaders(env)
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    body = { message: text.slice(0, 500) };
  }

  if (!response.ok || body.error) {
    const message =
      body.error?.message ||
      body.error ||
      body.message ||
      `Cafe24 full catalog proxy error ${response.status}`;

    const category =
      response.status === 401
        ? "authentication_failed"
        : response.status === 403
          ? "endpoint_access_denied"
          : response.status === 404
            ? "endpoint_not_found"
            : response.status === 429
              ? "rate_limited"
              : "api_error";

    throw Object.assign(
      new Error(String(message)),
      { category, httpStatus: response.status }
    );
  }

  return body;
}

async function cafe24Get(env, path, params = {}, { fetchImpl = fetch } = {}) {
  if (!env.CAFE24_MALL_ID) throw Object.assign(new Error("missing_mall_id"), { category: "environment_missing" });
  const accessToken = await ensureAccessToken(env);
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": apiVersion(env)
    }
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    body = { message: text.slice(0, 500) };
  }
  if (!response.ok || body.error) {
    const message = body.error?.message || body.error_description || body.message || `Cafe24 API error ${response.status}`;
    const category = response.status === 401 ? "authentication_failed" : response.status === 403 ? "endpoint_access_denied" : response.status === 404 ? "endpoint_not_found" : response.status === 429 ? "rate_limited" : "api_error";
    throw Object.assign(new Error(message), { category, httpStatus: response.status });
  }
  return body;
}

// Cafe24 admin/products를 offset 기반으로 끝까지 순회한다. display/selling 파라미터를 전혀
// 지정하지 않으므로 Cafe24가 기본으로 내려주는 전체 상태의 상품을 그대로 받는다(진열/판매
// 여부로 걸러내지 않음). 페이지가 pageSize보다 적게 오면(또는 0건이면) 끝으로 판단한다.
// maxPages는 무한 루프 방지용 안전장치일 뿐 실질적인 상한이 아니다(기본 500페이지 ×
// pageSize 100 = 50,000개 — 실제 카탈로그 규모를 넉넉히 초과하는 값).
export async function fetchAllCafe24ProductsFullCatalog(options = {}) {
  const env = options.env || await loadCafe24ScriptEnv();
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || 100));
  const maxPages = Math.max(1, Number(options.maxPages) || 500);
  const fetchImpl = options.fetchImpl || fetch;
  const products = [];
  let pagesFetched = 0;
  let stoppedReason = "empty_page";
  for (let offset = 0; pagesFetched < maxPages; offset += pageSize) {
    const body = env.CAFE24_PROXY_BASE_URL
      ? await cafe24GetFullCatalogPageFromProxy(
          env,
          { limit: pageSize, offset },
          { fetchImpl }
        )
      : await cafe24Get(
          env,
          "/products",
          { limit: pageSize, offset },
          { fetchImpl }
        );

    const page = body.products || [];
    pagesFetched += 1;
    products.push(...page);

    if (page.length < pageSize) {
      stoppedReason = page.length === 0 ? "empty_page" : "partial_page";
      break;
    }

    if (pagesFetched >= maxPages) {
      stoppedReason = "max_pages_reached";
    }
  }
  return { products, pagesFetched, pageSize, stoppedReason };
}
