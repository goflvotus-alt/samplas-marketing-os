import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createHash, createHmac } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { URL } from "node:url";
import {
  buildInventoryOverview,
  filterAndSortItems,
  buildOfflineSalesIndex,
  DEFAULTS as INVENTORY_OVERVIEW_DEFAULTS
} from "./scripts/inventory-overview-lib.mjs";
import { bootstrapProductRegistryFiles } from "./scripts/bootstrap-product-registry.mjs";
import { bootstrapCommercialPolicyFiles } from "./scripts/bootstrap-commercial-policy.mjs";
import { loadCanonicalCafe24OrderCache } from "./scripts/cafe24-order-cache.mjs";
import {
  normalizeBrandCode,
  normalizeBrandName,
  normalizeBrandKey,
  buildBrandRegistry,
  resolveBrand as resolveBrandFromEngine
} from "./scripts/brand-engine.mjs";
// STEP63-3: Clients purchaseDetails에 canonical brand identity를 "추가 필드"로만 붙이기
// 위해 STEP63-2/62-2B의 Integrated Identity Pipeline을 그대로 재사용한다(새 Resolver
// 작성 금지). 이 모듈은 work/brand-master.json, work/product-registry.json을 읽기만
// 하고 절대 쓰지 않는다.
import { resolveIdentity, loadResolverContext } from "./scripts/unified-identity-resolver.mjs";
import {
  cafe24OrderAmount,
  cafe24OrderItems,
  cafe24ItemQuantity,
  isCafe24CanceledItem,
  isCafe24CanceledOrRefunded,
  cafe24ShippingFee,
  cafe24PointsUsedAmount,
  trustedCafe24OrderDate
} from "./scripts/cafe24-order-amount.mjs";
// STORE-BATCH-B: loadEcountClientLines()가 work/ecount-sales/를 직접 readdir하던 것을
// 이 공용 리더로 교체한다 — 매장별 분리 스냅샷을 병합해 기존과 동일한 ALL 라인 집합을
// 얻는 로직(그리고 storeCode 보존)을 여기서 새로 구현하지 않고 그대로 재사용한다.
import { readEcountOfflineSalesSnapshot, KNOWN_STORE_CODES } from "./scripts/read-ecount-offline-sales-snapshot.mjs";
import {
  loadCategoryReviewWorkspace,
  saveCategoryReviewAssignment
} from "./scripts/category-review.mjs";
import {
  approveRevenueReviewItem,
  buildRevenueReviewQueue,
  inventoryCandidatesForSale
} from "./scripts/product-registry-revenue-review.mjs";

const root = resolve(".");
const env = await loadEnv();
const host = env.INTELLIGENCE_HOST || env.HOST || "127.0.0.1";
const port = Number(env.INTELLIGENCE_PORT || 8797);
const workRoot = resolve(env.WORK_DIR || join(root, "work"));
const intelligenceWorkDir = join(workRoot, "intelligence");
const marketingBrandMasterFile = join(workRoot, "brand-master.json");
const brandMasterListFile = join(intelligenceWorkDir, "brand-master-list.json");
const brandAliasesFile = join(intelligenceWorkDir, "brand-aliases.json");
const brandRegistryBuildMetaFile = join(intelligenceWorkDir, "brand-registry-build-meta.json");
// canonical work/brand-master.json 변경 감지용 stat 캐시 + 동시 요청 rebuild dedupe.
// 반드시 아래 top-level await ensureBrandRegistryFiles() 호출보다 먼저 선언되어야 한다.
let brandRegistryStatCache = null; // `${mtimeMs}:${size}` — 마지막으로 확인 완료한 canonical stat
let brandRegistryRefreshPromise = null; // 동시 요청이 겹쳐도 rebuild가 한 번만 실행되도록 dedupe
const naverSearchSnapshotsFile = join(intelligenceWorkDir, "naver-search-snapshots.json");
const brandTimelineFile = join(intelligenceWorkDir, "brand-timeline.json");
const decisionHistoryFile = join(intelligenceWorkDir, "decision-history.json");
const learningDbFile = join(intelligenceWorkDir, "learning-db.json");
const missionCacheFile = join(intelligenceWorkDir, "mission-cache.json");
const productRegistryFile = join(workRoot, "product-registry.json");
// TODAY 온라인 ↔ ECOUNT 가격 Audit. scripts/build-price-audit.mjs가 미리 계산해 저장한
// 결과를 그대로 읽기만 한다(work/brand-commercial-policy.json과 동일한 "script가 빌드 →
// GET route가 캐시 파일만 읽는다" 패턴, TODAY 로드마다 Cafe24를 수백 번 호출하지 않기 위함).
const priceAuditFile = join(workRoot, "price-audit.json");
const todayProductSyncIssuesFile = join(workRoot, "today-product-sync-issues.json");
const productRegistryReviewQueueFile = join(workRoot, "product-registry-review-queue.json");
const categoryMasterFile = join(workRoot, "category-master.json");
const colorMasterFile = join(workRoot, "color-master.json");
const brandCommercialPolicyFile = join(workRoot, "brand-commercial-policy.json");
const brandSourcingMasterFile = join(workRoot, "brand-sourcing-master.json");
const categoryReviewAuditFile = join(workRoot, "category-unclassified-model-audit.json");
const inventoryIntelligenceCandidatesFile = join(workRoot, "inventory-intelligence-candidates.json");
// Phase 3A — Inventory Overview: ECOUNT stockQuantity를 유일한 재고 기준(Source of Truth)으로 사용한다.
// Cafe24 inventoryQuantity는 이 라우트의 어떤 계산에도 사용하지 않는다.
const ecountInventoryDir = join(workRoot, "ecount-inventory");
const ecountInventoryLatestFile = join(ecountInventoryDir, "latest.json");
const ecountInventoryDiagnosticFile = join(ecountInventoryDir, "diagnostic.json");
const ecountSalesDir = join(workRoot, "ecount-sales");
const naverAdsBaseUrl = env.NAVER_ADS_BASE_URL || "https://api.searchad.naver.com";
const naverAdsTimeoutMs = 10000;
// SAMPLAS DESK Today OPS 연동 — READ ONLY. DESK 저장/실시간 동기화 로직은 절대 건드리지
// 않고, DESK가 자체 노출하는 read-only 서버리스 endpoint(api/ops-summary.js)만 호출한다.
// 토큰은 서버 환경변수에서만 읽고 프런트엔드로 절대 전달하지 않는다.
const deskOpsBaseUrl = env.DESK_OPS_BASE_URL || "https://samplas-desk-recovery.vercel.app";
const deskOpsApiToken = env.DESK_OPS_API_TOKEN || "";
const deskOpsTimeoutMs = 10000;
const marketingOsBaseUrl = env.INTELLIGENCE_MARKETING_OS_BASE_URL || env.MARKETING_OS_BASE_URL || `http://127.0.0.1:${env.PORT || 8787}`;
const marketingOsTimeoutMs = 12000;
const missionCacheTtlMs = 30000;
const missionResultCache = new Map();
const missionRefreshPromises = new Map();
let categoryReviewWriteQueue = Promise.resolve();
let productRegistryReviewWriteQueue = Promise.resolve();
// STEP 47A — Intelligence Service Dependency Hardening: 이 값은 프런트엔드가 이미 사용 중인
// 가장 긴 클라이언트 타임아웃(brief/missions = 40000ms, samplas-marketing-os.js getJson 호출부
// 참고)보다 반드시 커야 한다. 정상적으로 느린 응답을 여기서 먼저 끊어버리면 안 되고, 이 값은
// "정상적으로는 절대 도달하지 않아야 하는" 최후 안전장치(무한 대기 방지)로만 동작해야 한다.
const intelligenceRequestTimeoutMs = Number(env.INTELLIGENCE_REQUEST_TIMEOUT_MS || 45000);

await bootstrapProductRegistryFiles({ projectRoot: root, workDir: workRoot });
await bootstrapCommercialPolicyFiles({ projectRoot: root, workDir: workRoot });
await mkdir(intelligenceWorkDir, { recursive: true });
await ensureBrandRegistryFiles();
await ensureNaverSnapshotsFile();
await ensureTimelineFile();
await ensureDecisionHistoryFile();
await ensureLearningDbFile();
await ensureMissionCacheFile();

// STEP 47A — Intelligence Service Dependency Hardening.
// 기존에는 이 함수 하나가 전체 라우팅과 에러 처리를 함께 했고, 내부 로직이 멈춰버리면(예:
// 파일 I/O가 끝나지 않는 경우) 응답이 영원히 지연되어 프런트엔드가 무한 skeleton 상태로 남는
// 위험이 있었다(클라이언트 쪽 getJson()의 AbortController 타임아웃은 이미 있었지만, 서버 쪽에는
// 요청을 강제로 마무리하는 장치가 없었다). 아래처럼 라우팅 본문을 routeIntelligenceRequest로
// 분리하고, handleIntelligenceRequest는 그 위에 "최후 타임아웃 안전장치"만 추가한다.
// - API 경로/응답 스키마는 변경하지 않는다(라우팅 분기 내용은 그대로 이동만 함).
// - 정상 응답 흐름은 전혀 바뀌지 않는다(타임아웃보다 먼저 끝나면 그대로 반환).
// - 타임아웃이 실제로 발생하면(비정상 상황에서만) 클라이언트에는 "Intelligence Service
//   연결 안 됨"에 해당하는 오류 응답을 보내고, 서버 로그에 원인을 남긴다.
export async function handleIntelligenceRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  let timer;
  let timedOut = false;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve("timeout");
    }, intelligenceRequestTimeoutMs);
  });
  const routePromise = routeIntelligenceRequest(url, req, res).then(() => "done");
  let outcome;
  try {
    outcome = await Promise.race([routePromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
  if (outcome === "timeout") {
    console.error(
      `[intelligence] TIMEOUT ${req.method} ${url.pathname} — ${intelligenceRequestTimeoutMs}ms 초과. ` +
      `클라이언트에는 "Intelligence Service 연결 안 됨"으로 응답합니다.`
    );
    json(res, {
      ok: false,
      error: "Intelligence Service Timeout",
      message: `${intelligenceRequestTimeoutMs}ms 내에 응답하지 못했습니다. Intelligence Service 상태를 확인해주세요.`
    }, 504);
    // 뒤늦게 원래 요청이 끝나더라도(성공/실패 무관) 이미 위에서 응답을 보냈으므로,
    // json()의 res.headersSent 가드 덕분에 이중 응답으로 서버가 죽지 않는다. 다만 원인
    // 파악을 위해 지연 이후 발생한 오류는 로그로만 남긴다.
    routePromise.catch((error) => {
      console.error(`[intelligence] TIMEOUT-AFTER ${url.pathname} 지연 이후 추가 오류: ${safeErrorMessage(error)}`);
    });
  }
}


async function handleBrandCommercialPolicyGet(url, res) {
  if (!existsSync(brandCommercialPolicyFile)) {
    return json(res, {
      ok: false,
      error: "Commercial Policy Not Found"
    }, 404);
  }

  const store = JSON.parse(await readFile(brandCommercialPolicyFile, "utf8"));
  const policies = Array.isArray(store?.policies) ? store.policies : [];

  const brandCode = (url.searchParams.get("brand_code") || "").trim();
  const brandName = (url.searchParams.get("name") || "").trim();
  const productName = (url.searchParams.get("product_name") || "").trim();

  if (!brandCode && !brandName) {
    return json(res, {
      ok: true,
      count: policies.length,
      summary: store.summary || null,
      policies
    });
  }

  let policy = null;
  let brand = null;

  if (brandCode) {
    policy = policies.find((item) => item.brand_code === brandCode) || null;

    brand = {
      brandId: brandCode,
      name: policy?.canonical_brand_name || policy?.source_brand_name || null,
      matchedBy: "brand_code"
    };
  }

  if (!policy && brandName) {
    const master = JSON.parse(await readFile(marketingBrandMasterFile, "utf8"));
    const registry = buildBrandRegistry(master);

    const resolved = resolveBrandFromEngine(brandName, registry);

    if (resolved?.brandId) {
      brand = {
        brandId: resolved.brandId,
        name: resolved.name,
        matchedBy: resolved.matchedBy
      };

      policy =
        policies.find((item) => item.brand_code === resolved.brandId) ||
        null;
    }
  }

  let fallback = null;

  if (!policy && brand?.brandId && existsSync(brandSourcingMasterFile)) {
    const sourcingStore = JSON.parse(
      await readFile(brandSourcingMasterFile, "utf8")
    );

    const sourcingRows = Array.isArray(sourcingStore?.brands)
      ? sourcingStore.brands
      : [];

    const sourcing = sourcingRows.find(
      (item) => item.brand_code === brand.brandId
    ) || null;

    if (sourcing) {
      const defaults = {
        CONSIGNMENT: 10,
        WHOLESALE: 20,
        OWN_PRODUCTION: 10
      };

      const discount =
        Object.prototype.hasOwnProperty.call(defaults, sourcing.sourcing_type)
          ? defaults[sourcing.sourcing_type]
          : null;

      fallback = {
        brand_code: sourcing.brand_code,
        canonical_brand_name: sourcing.brand_name,
        sourcing_type: sourcing.sourcing_type,
        stylist_discount_percent: discount,
        policy_status: discount === null
          ? "REVIEW_REQUIRED"
          : "SOURCING_DEFAULT",
        policy_source: "brand-sourcing-master",
        warning: discount === null
          ? "Commercial Policy가 없고 sourcing만 판별되었습니다. 할인율 확인이 필요합니다."
          : "Commercial Policy 미등록 브랜드입니다. sourcing 기반 기본 권장 할인율입니다.",
        evidence: sourcing.evidence || null,
        coverage: sourcing.coverage || null
      };
    }
  }

  let effectivePolicy = null;

  if (policy) {
    const baseDiscount = policy.stylist_discount_percent ?? null;
    const rules = Array.isArray(policy.product_rules)
      ? policy.product_rules
      : [];

    let matchedRule = null;

    if (productName) {
      matchedRule =
        rules.find((rule) => {
          if (rule?.type !== "PRODUCT_NAME_PREFIX") return false;

          const prefix = String(rule.value || "").trim();
          if (!prefix) return false;

          return productName
            .trim()
            .toUpperCase()
            .startsWith(prefix.toUpperCase());
        }) || null;
    }

    effectivePolicy = {
      base_discount_percent: baseDiscount,
      effective_discount_percent:
        matchedRule?.stylist_discount_percent ?? baseDiscount,
      matched_product_rule: matchedRule,
      product_name: productName || null,
      decision_source: matchedRule
        ? "PRODUCT_RULE"
        : "BRAND_POLICY"
    };
  } else if (fallback) {
    effectivePolicy = {
      base_discount_percent:
        fallback.stylist_discount_percent ?? null,
      effective_discount_percent:
        fallback.stylist_discount_percent ?? null,
      matched_product_rule: null,
      product_name: productName || null,
      decision_source: "SOURCING_FALLBACK"
    };
  }

  const onlinePrice =
    productName && brand?.brandId
      ? await resolveCommercialPolicyOnlinePrice(
          brand.brandId,
          productName
        )
      : null;

  return json(res, {
    ok: true,
    query: {
      brand_code: brandCode || null,
      name: brandName || null,
      product_name: productName || null
    },
    brand,
    found: Boolean(policy),
    policy_status: policy
      ? "EXPLICIT_POLICY"
      : fallback?.policy_status || "UNRESOLVED",
    policy,
    fallback,
    effective_policy: effectivePolicy,
    online_price: onlinePrice
  });
}

async function routeIntelligenceRequest(url, req, res) {
  try {
    if (url.pathname === "/api/intelligence/health") {
      return json(res, {
        ok: true,
        service: "samplas-intelligence-service",
        timestamp: new Date().toISOString(),
        workDir: intelligenceWorkDir
      });
    }
    if (url.pathname === "/api/intelligence/brands") {
      const registry = await readBrandRegistry();
      return json(res, {
        ok: true,
        count: registry.brands.length,
        aliasCount: registry.aliases.length,
        brands: registry.brands
      });
    }
    if (url.pathname === "/api/intelligence/brands/resolve") {
      const registry = await readBrandRegistry();
      return json(res, {
        ok: true,
        query: url.searchParams.get("name") || "",
        brand: resolveBrand(url.searchParams.get("name") || "", registry)
      });
    }
    if (url.pathname === "/api/intelligence/missions") {
      return handleMissionsRoute(url, res);
    }
    if (url.pathname === "/api/intelligence/brief") {
      return handleBriefRoute(url, res);
    }
    if (url.pathname === "/api/intelligence/decisions") {
      if (req.method === "GET") return handleDecisionsGet(url, res);
      if (req.method === "POST") return handleDecisionPost(req, res);
      return json(res, {
        ok: false,
        error: "Method Not Allowed"
      }, 405);
    }
    const decisionMatch = url.pathname.match(/^\/api\/intelligence\/decisions\/([^/]+)$/);
    if (decisionMatch) {
      if (req.method === "PATCH") return handleDecisionPatch(decisionMatch[1], req, res);
      return json(res, {
        ok: false,
        error: "Method Not Allowed"
      }, 405);
    }
    if (url.pathname === "/api/intelligence/timeline") {
      return handleTimelineGet(url, res);
    }
    if (url.pathname === "/api/intelligence/learning") {
      if (req.method === "GET") return handleLearningGet(url, res);
      if (req.method === "POST") return handleLearningPost(req, res);
      return json(res, {
        ok: false,
        error: "Method Not Allowed"
      }, 405);
    }
    if (url.pathname === "/api/intelligence/learning/similar") {
      return handleLearningSimilarGet(url, res);
    }
    const brandInputMatch = url.pathname.match(/^\/api\/intelligence\/brand\/([^/]+)\/input$/);
    if (brandInputMatch) {
      return handleBrandIntelligenceInputRoute(brandInputMatch[1], url, res);
    }
    const brandIntelligenceMatch = url.pathname.match(/^\/api\/intelligence\/brand\/([^/]+)$/);
    if (brandIntelligenceMatch) {
      return handleBrandIntelligenceRoute(brandIntelligenceMatch[1], url, res);
    }
    if (url.pathname === "/api/intelligence/clients") {
      return handleClientsOverviewRoute(url, res);
    }
    if (url.pathname === "/api/intelligence/product-registry") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handleProductRegistryGet(res);
    }
    if (url.pathname === "/api/intelligence/product-registry/review-queue") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handleProductRegistryReviewQueueGet(res);
    }
    if (url.pathname === "/api/intelligence/product-registry/revenue-review") {
      if (req.method === "GET") return await handleProductRegistryRevenueReviewGet(url, res);
      if (req.method === "PATCH") return await handleProductRegistryRevenueReviewPatch(req, res);
      return json(res, { ok: false, error: "Method Not Allowed" }, 405);
    }
    if (url.pathname === "/api/intelligence/price-audit") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handlePriceAuditGet(res);
    }
    if (url.pathname === "/api/intelligence/desk-ops") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handleDeskOpsGet(res);
    }
    if (url.pathname === "/api/intelligence/product-sync-issues") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handleProductSyncIssuesGet(res);
    }
    if (url.pathname === "/api/intelligence/category-master") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handleCategoryMasterGet(res);
    }
    if (url.pathname === "/api/intelligence/color-master") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handleColorMasterGet(res);
    }
    if (url.pathname === "/api/intelligence/commercial-policy") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handleBrandCommercialPolicyGet(url, res);
    }
    if (url.pathname === "/api/intelligence/category-review") {
      if (req.method === "GET") return handleCategoryReviewGet(res);
      if (req.method === "PATCH") return await handleCategoryReviewPatch(req, res);
      return json(res, { ok: false, error: "Method Not Allowed" }, 405);
    }
    if (url.pathname === "/api/inventory/intelligence/health") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handleInventoryIntelligenceHealthGet(res);
    }
    if (url.pathname === "/api/inventory/overview") {
      if (req.method !== "GET") return json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return handleInventoryOverviewGet(url, res);
    }
    if (url.pathname === "/api/intelligence/naver/search") {
      return handleNaverSearchRoute(url, res);
    }
    if (url.pathname === "/api/intelligence/naver/snapshots") {
      if (req.method === "GET") return handleNaverSnapshotsGet(url, res);
      if (req.method === "POST") return handleNaverSnapshotsPost(req, url, res);
      return json(res, {
        ok: false,
        error: "Method Not Allowed"
      }, 405);
    }
    return json(res, {
      ok: false,
      error: "Not Found"
    }, 404);
  } catch (error) {
    // STEP 47A — 실패 원인을 서버 로그에 남긴다(이전에는 클라이언트 응답만 있었고 서버
    // 콘솔에는 아무 기록도 남지 않았다).
    console.error(`[intelligence] ERROR ${req.method} ${url.pathname}: ${safeErrorMessage(error)}`);
    if (error?.stack) console.error(error.stack);
    return json(res, {
      ok: false,
      error: "Internal Server Error",
      message: safeErrorMessage(error)
    }, 500);
  }
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const server = createServer(handleIntelligenceRequest);
  server.listen(port, host, () => {
    console.log(`SAMPLAS Intelligence Service running at http://${host}:${port}`);
  });

  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      console.error(`SAMPLAS Intelligence Service cannot start: http://${host}:${port} is already in use.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
}

function json(res, payload, status = 200) {
  // STEP 47A — 타임아웃 응답을 먼저 보낸 뒤 원래 처리가 뒤늦게 끝나 다시 json()을 호출해도
  // 안전하도록 가드한다. 이 가드가 없으면 "Cannot set headers after they are sent" 오류로
  // 요청이 죽고, 최악의 경우 다른 요청 처리에도 영향을 줄 수 있다.
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

async function readProductRegistryJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizeCommercialProductName(value) {
  return String(value || "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

async function resolveCommercialPolicyOnlinePrice(brandId, productName) {
  if (!brandId || !productName) return null;

  try {
    const registryStore = await readProductRegistryJson(productRegistryFile);
    const entries = Array.isArray(registryStore?.entries)
      ? registryStore.entries
      : [];

    const targetName = normalizeCommercialProductName(productName);

    const matches = entries.filter((entry) =>
      String(entry?.brandId || "") === String(brandId) &&
      normalizeCommercialProductName(entry?.canonicalProductName) === targetName &&
      entry?.cafe24?.productNo
    );

    if (matches.length !== 1) {
      return null;
    }

    const entry = matches[0];
    const productNo = String(entry.cafe24.productNo);

    const headers = {
      Accept: "application/json"
    };

    if (env.CAFE24_PROXY_SECRET) {
      headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
    }

    if (env.CAFE24_PROXY_BASIC_AUTH) {
      headers.Authorization =
        "Basic " +
        Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64");
    }

    const detailUrl = new URL(
      `/api/cafe24/products/${encodeURIComponent(productNo)}`,
      marketingOsBaseUrl
    );

    const discountUrl = new URL(
      `/api/cafe24/products/${encodeURIComponent(productNo)}/discountprice`,
      marketingOsBaseUrl
    );

    const [detailResponse, discountResponse] = await Promise.all([
      fetch(detailUrl, { headers }),
      fetch(discountUrl, { headers })
    ]);

    if (!detailResponse.ok || !discountResponse.ok) {
      return null;
    }

    const detailBody = await detailResponse.json();
    const discountBody = await discountResponse.json();

    if (detailBody?.error || discountBody?.error) {
      return null;
    }

    const product = detailBody?.product || {};
    const discountprice = discountBody?.discountprice || {};

    const retailPrice = Number(
      product.retail_price ??
      product.price ??
      0
    );

    const rawSalePrice = Number(
      discountprice.pc_discount_price ??
      discountprice.mobile_discount_price ??
      product.price ??
      retailPrice
    );

    if (!Number.isFinite(retailPrice) || retailPrice <= 0) {
      return null;
    }

    const salePrice =
      Number.isFinite(rawSalePrice) && rawSalePrice >= 0
        ? Math.round(rawSalePrice)
        : Math.round(retailPrice);

    const discountAmount = Math.max(
      0,
      Math.round(retailPrice - salePrice)
    );

    const discountPercent = Math.round(
      (discountAmount / retailPrice) * 100
    );

    return {
      product_no: productNo,
      retail_price: Math.round(retailPrice),
      discount_amount: discountAmount,
      sale_price: salePrice,
      discount_percent: discountPercent,
      registry_status: entry.status || null,
      registry_verified: Boolean(entry.verified)
    };
  } catch (error) {
    console.warn(
      "[intelligence][commercial-policy] online price unavailable:",
      safeErrorMessage(error)
    );
    return null;
  }
}

async function handleProductRegistryGet(res) {
  const registry = await readProductRegistryJson(productRegistryFile);
  return json(res, { ok: true, registry });
}

async function handlePriceAuditGet(res) {
  if (!existsSync(priceAuditFile)) {
    return json(res, { ok: false, error: "Price Audit Not Found", hint: "run scripts/build-price-audit.mjs first" }, 404);
  }
  const audit = await readProductRegistryJson(priceAuditFile);
  return json(res, { ok: true, audit });
}

// SAMPLAS DESK read-only api/ops-summary를 호출한다(fetchNaverKeywordSearch()와 동일한
// AbortController+timeout+try/catch 패턴). DESK가 죽어 있거나(401/timeout/network/5xx/
// invalid JSON) 토큰이 아직 설정 안 됐어도 절대 throw하지 않고 항상 { ok:false, error }
// 형태로 정상 반환한다 — 이 실패가 TODAY의 다른 카드(매출/Price Audit/Product Sync)
// 렌더링을 막으면 안 된다.
async function fetchDeskOpsSummary() {
  if (!deskOpsApiToken) {
    return { ok: false, error: "desk_ops_token_not_configured" };
  }
  const endpoint = new URL("/api/ops-summary", deskOpsBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deskOpsTimeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { "X-Desk-Ops-Token": deskOpsApiToken },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: "desk_unreachable", status: response.status };
    }
    try {
      const parsed = text ? JSON.parse(text) : null;
      if (!parsed || !parsed.stores) {
        return { ok: false, error: "desk_unreachable" };
      }
      return { ok: true, ops: parsed };
    } catch {
      return { ok: false, error: "desk_unreachable" };
    }
  } catch {
    return { ok: false, error: "desk_unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleDeskOpsGet(res) {
  const result = await fetchDeskOpsSummary();
  if (!result.ok) {
    return json(res, { ok: false, error: result.error });
  }
  return json(res, { ok: true, ops: result.ops });
}

async function handleProductSyncIssuesGet(res) {
  if (!existsSync(todayProductSyncIssuesFile)) {
    return json(res, { ok: false, error: "Product Sync Issues Not Found" }, 404);
  }
  const issues = await readProductRegistryJson(todayProductSyncIssuesFile);
  return json(res, { ok: true, issues });
}

async function handleProductRegistryReviewQueueGet(res) {
  const reviewQueue = await readProductRegistryJson(productRegistryReviewQueueFile);
  return json(res, { ok: true, reviewQueue });
}

async function handleProductRegistryRevenueReviewGet(url, res) {
  const month = String(url.searchParams.get("month") || todayKey().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json(res, { ok: false, error: "Bad Request", message: "month must be YYYY-MM" }, 400);
  const [registry, reviewQueue, report, inventoryProducts] = await Promise.all([
    readProductRegistryJson(productRegistryFile),
    readProductRegistryJson(productRegistryReviewQueueFile),
    fetchMarketingOsJson(`/api/reports/monthly?month=${encodeURIComponent(month)}`),
    readProductRegistryJson(ecountInventoryLatestFile).catch(() => [])
  ]);
  if (!report.ok) return json(res, { ok: false, error: "Source Unavailable", message: report.message }, 503);
  const queue = buildRevenueReviewQueue({ productSales: report.data?.commerce?.productSales || [], registry, reviewQueue, inventoryProducts });
  return json(res, { ok: true, month, ...queue });
}

async function handleProductRegistryRevenueReviewPatch(req, res) {
  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return json(res, { ok: false, error: "Bad Request", message: parsedBody.message }, 400);
  const body = parsedBody.value || {};
  const operation = productRegistryReviewWriteQueue.then(async () => {
    const [report, inventoryProducts] = await Promise.all([
      fetchMarketingOsJson(`/api/reports/monthly?month=${encodeURIComponent(String(body.month || todayKey().slice(0, 7)))}`),
      readProductRegistryJson(ecountInventoryLatestFile)
    ]);
    if (!report.ok) throw new Error(report.message);
    const product = (report.data?.commerce?.productSales || []).find((item) => String(item.productNo) === String(body.productNo));
    const candidates = inventoryCandidatesForSale(product, inventoryProducts);
    return approveRevenueReviewItem({ registryPath: productRegistryFile, productNo: body.productNo, prodCds: body.prodCds, product, candidateProducts: candidates });
  });
  productRegistryReviewWriteQueue = operation.catch(() => {});
  const result = await operation;
  return json(res, { ok: true, entry: result.entry });
}

// BI-BATCH-I: SAMPLAS Category Master v1의 manualOverrides만 읽어 노출한다(읽기 전용).
// 파일이 아직 없으면 빈 override 목록으로 취급 — 결정론적 규칙(이름/ECOUNT suffix)은
// 이 파일에 저장하지 않고 outputs/samplas-marketing-os.js에 코드로 존재한다.
async function handleCategoryMasterGet(res) {
  let master;
  try {
    master = await readProductRegistryJson(categoryMasterFile);
  } catch {
    master = { version: "v1", manualOverrides: [] };
  }
  return json(res, { ok: true, categoryMaster: master });
}

// SAMPLAS Color Master v1.
// Canonical deterministic color-family policy를 읽기 전용으로 노출한다.
// 이 API는 분류를 수행하거나 master 파일을 수정하지 않는다.
async function handleColorMasterGet(res) {
  let master;
  try {
    master = await readProductRegistryJson(colorMasterFile);
  } catch {
    master = {
      version: "v1",
      families: [],
      aliases: {},
      policy: {}
    };
  }
  return json(res, { ok: true, colorMaster: master });
}

async function handleCategoryReviewGet(res) {
  const workspace = await loadCategoryReviewWorkspace({
    auditPath: categoryReviewAuditFile,
    masterPath: categoryMasterFile
  });
  return json(res, { ok: true, workspace });
}

async function handleCategoryReviewPatch(req, res) {
  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return json(res, { ok: false, error: "Bad Request", message: parsedBody.message }, 400);
  const body = parsedBody.value || {};
  const operation = categoryReviewWriteQueue.then(() => saveCategoryReviewAssignment({
    auditPath: categoryReviewAuditFile,
    masterPath: categoryMasterFile,
    modelKey: String(body?.modelKey || ""),
    categoryCode: String(body?.categoryCode || "")
  }));
  categoryReviewWriteQueue = operation.catch(() => {});
  const result = await operation;
  return json(res, { ok: true, assignment: result.assignment });
}

// Phase 2A(scripts/diagnose-inventory-reconciliation.mjs)가 생성한
// work/inventory-intelligence-candidates.json을 읽기 전용으로 노출한다.
// 이 라우트는 GET만 지원하며, 진단 파일을 재실행/재생성하지 않는다.
function sanitizeInventoryIntelligenceMeta(meta) {
  if (!meta || typeof meta !== "object") return meta;
  const clone = { ...meta };
  if (typeof clone.registryPath === "string") clone.registryPath = basename(clone.registryPath);
  if (typeof clone.ecountPath === "string") clone.ecountPath = basename(clone.ecountPath);
  if (clone.cafe24Source && typeof clone.cafe24Source === "object") {
    const cafe24Source = { ...clone.cafe24Source };
    if (cafe24Source.primary && typeof cafe24Source.primary === "object") {
      cafe24Source.primary = {
        ...cafe24Source.primary,
        file: cafe24Source.primary.file ? basename(cafe24Source.primary.file) : cafe24Source.primary.file
      };
    }
    if (Array.isArray(cafe24Source.excludedSyntheticFiles)) {
      cafe24Source.excludedSyntheticFiles = cafe24Source.excludedSyntheticFiles.map((entry) => ({
        ...entry,
        file: entry.file ? basename(entry.file) : entry.file
      }));
    }
    clone.cafe24Source = cafe24Source;
  }
  return clone;
}

async function handleInventoryIntelligenceHealthGet(res) {
  if (!existsSync(inventoryIntelligenceCandidatesFile)) {
    return json(res, {
      ok: true,
      available: false,
      reason: "not_found",
      source: basename(inventoryIntelligenceCandidatesFile)
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(inventoryIntelligenceCandidatesFile, "utf8"));
  } catch (error) {
    return json(res, {
      ok: false,
      available: false,
      error: "invalid_json",
      message: safeErrorMessage(error)
    }, 500);
  }
  return json(res, {
    ok: true,
    available: true,
    source: basename(inventoryIntelligenceCandidatesFile),
    schemaVersion: parsed.schemaVersion ?? null,
    generatedAt: parsed.generatedAt ?? null,
    mode: parsed.mode ?? null,
    meta: sanitizeInventoryIntelligenceMeta(parsed.meta),
    summary: parsed.summary ?? null,
    conflicts: parsed.conflicts ?? null,
    items: Array.isArray(parsed.items) ? parsed.items : []
  });
}

// Phase 3A — Inventory Overview (실제 매장 운영 화면).
// 운영 정책: ECOUNT stockQuantity가 유일한 재고 기준이다. Cafe24는 참고용 판매 분석에만 쓰이며
// (이 라우트에서는 아예 읽지도 않는다), 재고 계산에는 절대 사용하지 않는다.
// 기존 /api/inventory/intelligence/health (ECOUNT↔Cafe24 데이터 정합성/품질 진단, Phase 2A/2B)와는
// 역할이 다르며, 이 라우트를 추가하면서 그 라우트/로직은 전혀 수정하지 않았다.
async function handleInventoryOverviewGet(url, res) {
  if (!existsSync(ecountInventoryLatestFile)) {
    return json(res, {
      ok: true,
      available: false,
      reason: "not_found",
      source: basename(ecountInventoryLatestFile)
    });
  }

  let ecountRows;
  try {
    ecountRows = JSON.parse(await readFile(ecountInventoryLatestFile, "utf8"));
  } catch (error) {
    return json(res, {
      ok: false,
      available: false,
      error: "invalid_json",
      message: safeErrorMessage(error)
    }, 500);
  }
  if (!Array.isArray(ecountRows)) {
    return json(res, {
      ok: false,
      available: false,
      error: "invalid_shape",
      message: "ecount-inventory/latest.json must be an array"
    }, 500);
  }

  const lowStockThresholdRaw = url.searchParams.get("lowStockThreshold");
  const lowStockThreshold = lowStockThresholdRaw !== null && Number.isFinite(Number(lowStockThresholdRaw)) && Number(lowStockThresholdRaw) >= 0
    ? Math.floor(Number(lowStockThresholdRaw))
    : INVENTORY_OVERVIEW_DEFAULTS.DEFAULT_LOW_STOCK_THRESHOLD;

  const [brandRegistry, salesIndex, registryProdCds, diagnostic] = await Promise.all([
    readBrandRegistry().catch(() => ({ brands: [], aliases: [] })),
    buildEcountOfflineSalesIndexFromDisk(),
    loadProductRegistryProdCds(),
    readEcountInventoryDiagnostic()
  ]);

  const { items, summary, brandRollup } = buildInventoryOverview({
    ecountRows,
    brandRegistry,
    salesIndex,
    registryProdCds,
    lowStockThreshold
  });

  const filtered = filterAndSortItems(items, {
    brand: url.searchParams.get("brand"),
    status: url.searchParams.get("status"),
    search: url.searchParams.get("search"),
    sort: url.searchParams.get("sort")
  });

  const limitRaw = Number(url.searchParams.get("limit"));
  const offsetRaw = Number(url.searchParams.get("offset"));
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : filtered.length;
  const page = filtered.slice(offset, offset + limit);

  // Phase 3A-2: 운영 정책과 데이터 커버리지를 명시적으로 노출한다(하위 호환 — 기존 필드는
  // 그대로 두고 이 두 필드만 추가함). locationMode는 현재 ECOUNT 응답에 위치(창고) 정보가
  // 전혀 없어("조사 결과" 참고, scripts/inventory-overview-lib.mjs 상단 주석) 항상 "unavailable".
  const inventoryPolicy = {
    sourceOfTruth: "ECOUNT",
    cafe24InventoryUsed: false,
    qqqNegativeMeansEstimatedSales: true,
    zeroStockMeaning: "depleted_candidate",
    locationMode: summary.locationKnownItems > 0 ? "available" : "unavailable"
  };
  const coverage = {
    totalItems: summary.totalSkuCount,
    stockKnownItems: summary.totalSkuCount - summary.unknownStockSkuCount - summary.qqqUnknownSkuCount,
    stockUnknownItems: summary.unknownStockSkuCount + summary.qqqUnknownSkuCount,
    locationKnownItems: summary.locationKnownItems,
    locationUnknownItems: summary.locationUnknownItems
  };

  return json(res, {
    ok: true,
    available: true,
    source: basename(ecountInventoryLatestFile),
    generatedAt: diagnostic?.finishedAt ?? null,
    lowStockThreshold,
    inventoryPolicy,
    coverage,
    summary,
    brandRollup,
    itemsTotal: filtered.length,
    offset,
    limit,
    items: page
  });
}

async function readEcountInventoryDiagnostic() {
  try {
    return JSON.parse(await readFile(ecountInventoryDiagnosticFile, "utf8"));
  } catch {
    return null;
  }
}

// Product Registry(work/product-registry.json)의 ecount.matchedProducts[].prodCd 전체를 모은다.
// 확정(verified) 여부와 무관하게, Registry가 해당 ECOUNT 코드를 "인지"하고 있는지만 본다.
// 읽기 전용 참조이며, Product Registry 파일이나 구조는 절대 수정하지 않는다.
async function loadProductRegistryProdCds() {
  const prodCds = new Set();
  try {
    const data = JSON.parse(await readFile(productRegistryFile, "utf8"));
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    for (const entry of entries) {
      const matched = Array.isArray(entry?.ecount?.matchedProducts) ? entry.ecount.matchedProducts : [];
      for (const product of matched) {
        const prodCd = String(product?.prodCd || "").trim();
        if (prodCd) prodCds.add(prodCd);
      }
    }
  } catch {
    return prodCds;
  }
  return prodCds;
}

// work/ecount-sales/*.json(월별 오프라인 매출)을 전부 읽어 순수 계산 함수(buildOfflineSalesIndex)에 넘긴다.
// STORE-BATCH-B 이후: 파일을 직접 파싱하지 않고 readEcountOfflineSalesSnapshot()(매장별
// 분리 스냅샷 병합 + 레거시 단일 파일 fallback + double-count 방지를 이미 처리하는 공용
// 리더)을 월별로 호출한다 — loadEcountClientLines()와 동일한 패턴(어떤 월이 존재하는지만
// 디렉터리에서 찾고, 실제 라인 읽기/병합/precedence는 전부 그 공용 리더에 위임).
// 과거에는 정확히 "{month}.json"만 인식하는 자체 정규식을 썼는데, warehouse-routing 이후
// "{month}.{storeCode}.json"만 있는 달(예: 2026-09)의 오프라인 매출을 전부 놓치는
// pipeline gap이었다(docs/reports/inventory-intelligence-v2-preaudit-2026-08-26.md 참고).
export async function buildEcountOfflineSalesIndexFromDisk(workDirOverride) {
  const effectiveWorkDir = workDirOverride || workRoot;
  const dir = join(effectiveWorkDir, "ecount-sales");
  const names = await safeReaddir(dir);
  const months = new Set();
  for (const name of names) {
    const match = name.match(/^(\d{4}-\d{2})(?:\.[A-Z0-9_]+)?\.json$/);
    if (match) months.add(match[1]);
  }
  const monthlyFiles = [];
  for (const month of [...months].sort()) {
    const snapshot = await readEcountOfflineSalesSnapshot(month, { workDir: effectiveWorkDir });
    if (!snapshot) continue;
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : Array.isArray(snapshot?.salesLines) ? snapshot.salesLines : [];
    monthlyFiles.push({ month: snapshot?.month ?? month, rows });
  }
  return buildOfflineSalesIndex(monthlyFiles);
}

async function handleBrandIntelligenceInputRoute(rawBrandId, url, res) {
  const brandId = decodeURIComponent(rawBrandId || "").trim();
  const period = brandIntelligencePeriod(url);
  if (!period.ok) {
    return json(res, {
      ok: false,
      error: "Bad Request",
      message: period.message
    }, 400);
  }
  try {
    const data = await buildBrandIntelligenceInput(brandId, {
      since: period.since,
      until: period.until
    });
    return json(res, { ok: true, data });
  } catch (error) {
    if (error?.code === "UNKNOWN_BRAND") {
      return json(res, {
        ok: false,
        error: "Not Found",
        message: `Unknown brandId: ${brandId}`
      }, 404);
    }
    throw error;
  }
}

async function handleBrandIntelligenceRoute(rawBrandId, url, res) {
  const brandId = decodeURIComponent(rawBrandId || "").trim();
  const period = brandIntelligencePeriod(url);
  if (!period.ok) {
    return json(res, {
      ok: false,
      error: "Bad Request",
      message: period.message
    }, 400);
  }
  try {
    const input = await buildBrandIntelligenceInput(brandId, {
      since: period.since,
      until: period.until
    });
    return json(res, {
      ok: true,
      data: buildBrandIntelligence(input)
    });
  } catch (error) {
    if (error?.code === "UNKNOWN_BRAND") {
      return json(res, {
        ok: false,
        error: "Not Found",
        message: `Unknown brandId: ${brandId}`
      }, 404);
    }
    throw error;
  }
}

async function handleMissionsRoute(url, res) {
  const parsed = missionsRequestOptions(url);
  if (!parsed.ok) {
    return json(res, {
      ok: false,
      error: "Bad Request",
      message: parsed.message
    }, 400);
  }
  const result = await getMissionsResult(parsed);
  return json(res, result);
}

// Clients v1 (Stage 6 데이터 엔진의 기간 기반 버전). buildClientSummaries()는 "이번 달/전체"
// 고정 기준이라 화면의 "기간 변경 시 전체 갱신" 요구를 만족하지 못해, 같은 판별 로직
// (classifyClientType/buildClientDisplayName/extractClientMatchKey/loadEcountClientLines/
// loadCafe24PersonalPaymentOrders)을 그대로 재사용하는 별도 함수로 둔다.
async function handleClientsOverviewRoute(url, res) {
  const period = brandIntelligencePeriod(url);
  if (!period.ok) {
    return json(res, { ok: false, error: "Bad Request", message: period.message }, 400);
  }
  // STORE-BATCH-D: store 쿼리가 없거나 ALL이면 기존 동작과 완전히 동일하다.
  const storeParam = url.searchParams.get("store");
  const storeCode = storeParam && storeParam !== "ALL" ? storeParam : null;
  try {
    const overview = await buildClientsOverview({ since: period.since, until: period.until, storeCode });
    return json(res, { ok: true, ...overview });
  } catch (error) {
    return json(res, { ok: false, error: "Internal Server Error", message: safeErrorMessage(error) }, 500);
  }
}

async function handleBriefRoute(url, res) {
  const parsed = missionsRequestOptions(url);
  if (!parsed.ok) {
    return json(res, {
      ok: false,
      error: "Bad Request",
      message: parsed.message
    }, 400);
  }
  const missions = await getMissionsResult(parsed);
  const items = missions.missions.map((mission) => ({
    brand: mission.brand,
    priority: mission.priority,
    title: mission.title,
    reason: mission.reason
  }));
  const response = {
    ok: true,
    generatedAt: missions.meta.generatedAt,
    missionCount: missions.count,
    headline: missions.count ? `오늘 우선 확인할 Mission ${missions.count}건` : "현재 우선 확인할 Mission이 없습니다",
    items
  };
  if (missions.meta.cached) {
    response.cached = true;
    response.refreshing = Boolean(missions.meta.refreshing);
    response.cacheUpdatedAt = missions.meta.cacheUpdatedAt || null;
  }
  return json(res, response);
}

async function handleDecisionPost(req, res) {
  const body = await readJsonBody(req);
  if (!body.ok) return json(res, { ok: false, error: "Bad Request", message: body.message }, 400);
  const validation = await validateDecisionCreateInput(body.value || {});
  if (!validation.ok) return json(res, { ok: false, error: validation.error, message: validation.message }, validation.status);
  const now = new Date().toISOString();
  const decisionStore = await readDecisionHistoryStore();
  const timelineStore = await readTimelineStore();
  const decision = {
    id: createDecisionId(validation.brand.id, now, decisionStore.decisions.length),
    brandId: validation.brand.id,
    missionId: validation.missionId,
    sourceActionId: validation.sourceActionId,
    signalIds: validation.signalIds,
    actionTitle: validation.actionTitle,
    decision: validation.decision,
    status: validation.status,
    reason: validation.reason,
    createdAt: now,
    updatedAt: now,
    result: null
  };
  const event = createTimelineEvent({
    brandId: validation.brand.id,
    type: "decision_recorded",
    occurredAt: now,
    title: "Decision recorded",
    description: validation.decision,
    source: "decision-history",
    relatedIds: relatedDecisionIds(decision)
  });
  decisionStore.decisions.push(decision);
  decisionStore.updatedAt = now;
  timelineStore.events.push(event);
  timelineStore.updatedAt = now;
  await writeDecisionAndTimelineStores(decisionStore, timelineStore);
  return json(res, { ok: true, decision });
}

async function handleDecisionPatch(rawId, req, res) {
  const id = decodeURIComponent(rawId || "").trim();
  const body = await readJsonBody(req);
  if (!body.ok) return json(res, { ok: false, error: "Bad Request", message: body.message }, 400);
  const patch = validateDecisionPatchInput(body.value || {});
  if (!patch.ok) return json(res, { ok: false, error: "Bad Request", message: patch.message }, 400);
  const decisionStore = await readDecisionHistoryStore();
  const timelineStore = await readTimelineStore();
  const decision = decisionStore.decisions.find((item) => item.id === id);
  if (!decision) return json(res, { ok: false, error: "Not Found", message: `Unknown decision: ${id}` }, 404);
  const previousStatus = decision.status;
  const previousResult = JSON.stringify(decision.result ?? null);
  let changed = false;
  if (patch.status !== undefined && patch.status !== decision.status) {
    decision.status = patch.status;
    changed = true;
  }
  if (patch.reason !== undefined && patch.reason !== decision.reason) {
    decision.reason = patch.reason;
    changed = true;
  }
  if (patch.result !== undefined && JSON.stringify(patch.result) !== previousResult) {
    decision.result = patch.result;
    changed = true;
  }
  if (!changed) return json(res, { ok: true, decision, timelineEvent: null });
  const now = new Date().toISOString();
  decision.updatedAt = now;
  const timelineEvent = decisionPatchTimelineEvent(decision, { previousStatus, previousResult, now });
  if (timelineEvent) {
    timelineStore.events.push(timelineEvent);
    timelineStore.updatedAt = now;
  }
  decisionStore.updatedAt = now;
  await writeDecisionAndTimelineStores(decisionStore, timelineStore);
  return json(res, { ok: true, decision, timelineEvent });
}

async function handleDecisionsGet(url, res) {
  const filter = await decisionsFilter(url);
  if (!filter.ok) return json(res, { ok: false, error: filter.error, message: filter.message }, filter.status);
  const store = await readDecisionHistoryStore();
  let decisions = sortDecisionsLatestFirst(store.decisions);
  if (filter.brandId) decisions = decisions.filter((decision) => decision.brandId === filter.brandId);
  if (filter.statusFilter) decisions = decisions.filter((decision) => decision.status === filter.statusFilter);
  if (filter.limit) decisions = decisions.slice(0, filter.limit);
  return json(res, { ok: true, count: decisions.length, decisions });
}

async function handleTimelineGet(url, res) {
  const filter = await timelineFilter(url);
  if (!filter.ok) return json(res, { ok: false, error: filter.error, message: filter.message }, filter.status);
  const store = await readTimelineStore();
  let events = sortTimelineLatestFirst(store.events);
  if (filter.brandId) events = events.filter((event) => event.brandId === filter.brandId);
  if (filter.type) events = events.filter((event) => event.type === filter.type);
  if (filter.limit) events = events.slice(0, filter.limit);
  return json(res, { ok: true, count: events.length, events });
}

async function handleLearningPost(req, res) {
  const body = await readJsonBody(req);
  if (!body.ok) return json(res, { ok: false, error: "Bad Request", message: body.message }, 400);
  const decisionId = normalizeOptionalText(body.value?.decisionId);
  if (!decisionId) return json(res, { ok: false, error: "Bad Request", message: "decisionId is required" }, 400);
  const decisionStore = await readDecisionHistoryStore();
  const decision = decisionStore.decisions.find((item) => item.id === decisionId);
  if (!decision) return json(res, { ok: false, error: "Not Found", message: `Unknown decision: ${decisionId}` }, 404);
  const validation = validateLearningDecision(decision);
  if (!validation.ok) return json(res, { ok: false, error: "Bad Request", message: validation.message }, 400);
  const learningStore = await readLearningDbStore();
  const existing = learningStore.cases.find((item) => item.decisionId === decision.id);
  if (existing) return json(res, { ok: true, duplicate: true, case: existing });
  const now = new Date().toISOString();
  const learningCase = await createLearningCase(decision, now);
  learningStore.cases.push(learningCase);
  learningStore.updatedAt = now;
  await writeLearningDbStore(learningStore);
  return json(res, { ok: true, duplicate: false, case: learningCase });
}

async function handleLearningGet(url, res) {
  const filter = await learningFilter(url);
  if (!filter.ok) return json(res, { ok: false, error: filter.error, message: filter.message }, filter.status);
  const store = await readLearningDbStore();
  let cases = sortLearningCasesLatestFirst(store.cases);
  if (filter.brandId) cases = cases.filter((item) => item.brandId === filter.brandId);
  if (filter.sourceActionId) cases = cases.filter((item) => item.sourceActionId === filter.sourceActionId);
  if (filter.signalId) cases = cases.filter((item) => item.signalIds.includes(filter.signalId));
  if (filter.limit) cases = cases.slice(0, filter.limit);
  return json(res, { ok: true, count: cases.length, cases });
}

async function handleLearningSimilarGet(url, res) {
  const filter = await learningSimilarFilter(url);
  if (!filter.ok) return json(res, { ok: false, error: filter.error, message: filter.message }, filter.status);
  const store = await readLearningDbStore();
  const cases = sortSimilarLearningCases(store.cases, filter)
    .map(({ item, matchedBy }) => ({ ...item, matchedBy }))
    .filter((item) => item.matchedBy.length > 0);
  const limited = filter.limit ? cases.slice(0, filter.limit) : cases;
  return json(res, { ok: true, count: limited.length, cases: limited });
}

async function buildBrandIntelligenceInput(brandId, options = {}) {
  const registry = await readBrandRegistry();
  const brand = registry.brands.find((item) => item.id === brandId);
  if (!brand) {
    const error = new Error(`Unknown brandId: ${brandId}`);
    error.code = "UNKNOWN_BRAND";
    throw error;
  }
  const period = {
    since: options.since || currentMonthStartKey(),
    until: options.until || todayKey()
  };
  const context = { brand, registry, period, sourceData: options.sourceData || null };
  const [commerce, marketing, content, search] = await Promise.all([
    buildCommerceBrandInput(context),
    buildMarketingBrandInput(context),
    buildContentBrandInput(context),
    buildSearchBrandInput(context)
  ]);
  const sources = { commerce, marketing, content, search };
  const unavailableSources = Object.entries(sources)
    .filter(([, source]) => source.status === "unavailable")
    .map(([name]) => name);
  return {
    brand,
    period,
    commerce,
    marketing,
    content,
    search,
    meta: {
      partial: unavailableSources.length > 0,
      unavailableSources,
      generatedAt: new Date().toISOString()
    }
  };
}

function buildBrandIntelligence(input) {
  const signals = buildBrandSignals(input);
  const actions = buildBrandActions(input, signals);
  return {
    brand: input.brand,
    period: input.period,
    sources: {
      commerce: sourceState(input.commerce),
      marketing: sourceState(input.marketing),
      content: sourceState(input.content),
      search: sourceState(input.search)
    },
    signals,
    actions,
    summary: buildBrandSummary(input, signals, actions),
    meta: {
      ...input.meta,
      inputModel: "brand-intelligence-input",
      ruleSet: "phase-4b-explainable-minimum"
    }
  };
}

async function buildMissions(options) {
  const registry = await readBrandRegistry();
  const activeBrands = registry.brands.filter((brand) => brand.active);
  const sourceData = await readMissionSourceData(options);
  const generatedAt = new Date().toISOString();
  const missions = [];
  let partial = false;
  for (const brand of activeBrands) {
    const input = await buildBrandIntelligenceInput(brand.id, {
      since: options.since,
      until: options.until,
      sourceData
    });
    const intelligence = buildBrandIntelligence(input);
    if (intelligence.meta.partial) partial = true;
    for (const action of intelligence.actions) {
      missions.push({
        id: `mission:${brand.id}:${action.id}:${options.since}:${options.until}`,
        priority: action.priority,
        brand: {
          id: brand.id,
          name: brand.name
        },
        title: action.title,
        reason: action.reason,
        signalIds: action.signalIds,
        sourceActionId: action.id,
        generatedAt
      });
    }
  }
  const sorted = sortMissions(missions);
  const limited = sorted.slice(0, options.limit);
  return {
    ok: true,
    count: limited.length,
    missions: limited,
    meta: {
      generatedAt,
      brandCount: activeBrands.length,
      partial
    }
  };
}

async function getMissionsResult(options) {
  const key = missionCacheKey(options);
  const cached = missionResultCache.get(key);
  const now = Date.now();
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.promise) return cached.promise;
  const fileEntry = await readMissionCacheEntry(key);
  if (fileEntry) {
    refreshMissionResultInBackground(options, key);
    return cachedMissionResult(fileEntry, true);
  }
  const promise = buildAndStoreMissionResult(options, key).catch((error) => {
    if (missionResultCache.get(key)?.promise === promise) missionResultCache.delete(key);
    throw error;
  });
  missionResultCache.set(key, { promise });
  return promise;
}

async function buildAndStoreMissionResult(options, key) {
  const result = await buildMissions(options);
  missionResultCache.set(key, {
    value: result,
    expiresAt: Date.now() + missionCacheTtlMs
  });
  await writeMissionCacheEntry(key, options, result);
  return result;
}

function refreshMissionResultInBackground(options, key) {
  if (missionRefreshPromises.has(key)) return missionRefreshPromises.get(key);
  const refresh = buildAndStoreMissionResult(options, key).catch(() => null).finally(() => {
    missionRefreshPromises.delete(key);
  });
  missionRefreshPromises.set(key, refresh);
  return refresh;
}

function cachedMissionResult(entry, refreshing) {
  return {
    ...entry.result,
    meta: {
      ...entry.result.meta,
      cached: true,
      refreshing,
      cacheUpdatedAt: entry.updatedAt
    }
  };
}

function missionCacheKey(options) {
  return `${options.since}|${options.until}|${options.limit}`;
}

function clearMissionCache() {
  missionResultCache.clear();
}

async function readMissionSourceData(options) {
  const [commerce, marketing, content, naverStore] = await Promise.all([
    fetchMarketingOsJson(`/api/diagnostics/brand-sales?since=${encodeURIComponent(options.since)}&until=${encodeURIComponent(options.until)}`),
    fetchMarketingOsJson(`/api/meta-ads/full-report?since=${encodeURIComponent(options.since)}&until=${encodeURIComponent(options.until)}`),
    fetchMarketingOsJson(`/api/instagram/range?since=${encodeURIComponent(options.since)}&until=${encodeURIComponent(options.until)}`),
    readNaverSnapshotsStore()
  ]);
  return { commerce, marketing, content, naverStore };
}

function buildBrandSignals(input) {
  const signals = [];
  const commerce = input.commerce;
  const search = input.search;
  if (commerce.status === "matched") {
    const paidAmount = finiteOrNull(commerce.data?.paidAmount ?? commerce.data?.salesAmount);
    const orderCount = finiteOrNull(commerce.data?.orderCount);
    const quantitySold = finiteOrNull(commerce.data?.quantitySold);
    if (paidAmount !== null && paidAmount > 0) {
      signals.push({
        id: "commerce_sales_present",
        type: "commerce",
        priority: "medium",
        title: "선택 기간 실제 결제 매출 확인됨",
        evidence: { paidAmount, source: commerce.data?.source || null }
      });
    } else if (paidAmount === 0) {
      signals.push({
        id: "commerce_sales_zero",
        type: "commerce",
        priority: "medium",
        title: "선택 기간 실제 결제 매출 0으로 확인됨",
        evidence: { paidAmount, source: commerce.data?.source || null }
      });
    }
    if (orderCount !== null && orderCount > 0) {
      signals.push({
        id: "commerce_orders_present",
        type: "commerce",
        priority: "low",
        title: "선택 기간 주문이 확인됨",
        evidence: { orderCount }
      });
    }
    if (quantitySold !== null && quantitySold > 0) {
      signals.push({
        id: "commerce_quantity_present",
        type: "commerce",
        priority: "low",
        title: "선택 기간 판매 수량이 확인됨",
        evidence: { quantitySold }
      });
    }
  }
  if (commerce.status === "unmatched") {
    signals.push({
      id: "commerce_unmatched",
      type: "commerce",
      priority: "low",
      title: "선택 기간 Cafe24 브랜드 매출 매칭 없음",
      evidence: { reason: commerce.data?.reason || null }
    });
  }
  if (search.status === "matched") {
    const queryCounts = (search.data?.rows || []).map((row) => ({
      keyword: row.keyword,
      monthlyPcQueryCount: row.monthlyPcQueryCount,
      monthlyMobileQueryCount: row.monthlyMobileQueryCount
    }));
    signals.push({
      id: "search_snapshot_present",
      type: "search",
      priority: "medium",
      title: "Naver 검색 snapshot이 확인됨",
      evidence: {
        keyword: search.data?.keyword || null,
        collectedAt: search.data?.collectedAt || null,
        pointInTime: true,
        queryCounts
      }
    });
    const hasSearchDemand = queryCounts.some((row) => Number(row.monthlyPcQueryCount || 0) > 0 || Number(row.monthlyMobileQueryCount || 0) > 0);
    if (hasSearchDemand) {
      signals.push({
        id: "search_demand_present",
        type: "search",
        priority: "medium",
        title: "Naver 검색 수요가 확인됨",
        evidence: { queryCounts }
      });
    } else {
      signals.push({
        id: "search_demand_inconclusive",
        type: "search",
        priority: "low",
        title: "Naver 검색 수요 비교 불가",
        evidence: { reason: "검색 수요 숫자가 0 또는 null로만 확인됨" }
      });
    }
  }
  if (search.status === "unmatched") {
    signals.push({
      id: "search_snapshot_missing",
      type: "search",
      priority: "low",
      title: "Naver 검색 snapshot 없음",
      evidence: { reason: search.data?.reason || null }
    });
  }
  for (const [sourceName, source] of Object.entries({ commerce: input.commerce, marketing: input.marketing, content: input.content, search: input.search })) {
    if (source.status === "unavailable") {
      signals.push({
        id: `${sourceName}_unavailable`,
        type: "source",
        priority: "medium",
        title: `${sourceName} 데이터 확인 불가`,
        evidence: { source: sourceName, reason: source.data?.reason || null }
      });
    }
  }
  if (hasSignal(signals, "search_demand_present") && hasSignal(signals, "commerce_sales_zero")) {
    signals.push({
      id: "search_demand_without_sales",
      type: "cross-source",
      priority: "high",
      title: "검색 수요는 있으나 선택 기간 판매는 0으로 확인됨",
      evidence: {
        signalIds: ["search_demand_present", "commerce_sales_zero"]
      }
    });
  }
  if (hasSignal(signals, "commerce_sales_present") && hasSignal(signals, "search_snapshot_missing")) {
    signals.push({
      id: "sales_without_search_snapshot",
      type: "cross-source",
      priority: "medium",
      title: "판매는 있으나 Naver 검색 snapshot이 없음",
      evidence: {
        signalIds: ["commerce_sales_present", "search_snapshot_missing"]
      }
    });
  }
  if (input.meta?.partial) {
    signals.push({
      id: "source_availability_limited",
      type: "source",
      priority: "medium",
      title: "일부 source를 확인할 수 없어 판단이 제한됨",
      evidence: { unavailableSources: input.meta.unavailableSources || [] }
    });
  }
  return signals;
}

function buildBrandActions(input, signals) {
  const actions = [];
  if (hasSignal(signals, "search_demand_without_sales")) {
    actions.push({
      id: "check_product_or_exposure_status",
      priority: "high",
      title: "상품/노출 상태 점검 후보",
      reason: "Naver 검색 수요가 확인됐지만 선택 기간 Cafe24 판매는 0으로 확인됐습니다.",
      signalIds: ["search_demand_without_sales", "search_demand_present", "commerce_sales_zero"]
    });
  }
  if (hasSignal(signals, "sales_without_search_snapshot")) {
    actions.push({
      id: "collect_search_snapshot",
      priority: "medium",
      title: "검색 데이터 수집 후보",
      reason: "선택 기간 판매는 확인됐지만 이 브랜드의 Naver 검색 snapshot이 없습니다.",
      signalIds: ["sales_without_search_snapshot", "commerce_sales_present", "search_snapshot_missing"]
    });
  }
  if (hasSignal(signals, "source_availability_limited")) {
    actions.push({
      id: "check_data_source_connection",
      priority: "medium",
      title: "데이터 연결 상태 점검 후보",
      reason: "일부 source가 unavailable이라 현재 판단 가능한 데이터가 제한적입니다.",
      signalIds: ["source_availability_limited"]
    });
  }
  return actions.filter((action) => action.signalIds.every((signalId) => hasSignal(signals, signalId)));
}

function buildBrandSummary(input, signals, actions) {
  const parts = [];
  if (hasSignal(signals, "commerce_sales_present")) parts.push("선택 기간 실제 결제 매출이 확인됐습니다");
  else if (hasSignal(signals, "commerce_sales_zero")) parts.push("선택 기간 판매는 0으로 확인됐습니다");
  else if (input.commerce.status === "unmatched") parts.push("선택 기간 Cafe24 브랜드 매출 매칭은 없습니다");
  else if (input.commerce.status === "unavailable") parts.push("Cafe24 데이터 확인이 제한됩니다");

  if (hasSignal(signals, "search_demand_present")) parts.push("Naver 검색 수요가 확인됩니다");
  else if (hasSignal(signals, "search_snapshot_present")) parts.push("Naver 검색 snapshot은 있으나 수요 비교는 제한적입니다");
  else if (input.search.status === "unmatched") parts.push("Naver 검색 snapshot은 없습니다");
  else if (input.search.status === "unavailable") parts.push("Naver 검색 snapshot 확인이 제한됩니다");

  if (input.meta?.partial) parts.push("일부 source가 unavailable이라 판단 가능한 데이터가 제한적입니다");
  if (!parts.length) parts.push("현재 판단 가능한 브랜드 데이터가 제한적입니다");

  const actionText = actions.length ? `검토 후보 ${actions.length}건이 있습니다.` : "추가 행동 후보는 생성하지 않았습니다.";
  return `${parts.join(". ")}. ${actionText}`;
}

function sourceState(source) {
  return {
    status: source.status,
    matched: source.status === "matched",
    unavailable: source.status === "unavailable"
  };
}

function hasSignal(signals, id) {
  return signals.some((signal) => signal.id === id);
}

function missionsRequestOptions(url) {
  const period = brandIntelligencePeriod(url);
  if (!period.ok) return period;
  const limit = parseMissionLimit(url.searchParams.get("limit"));
  if (!limit.ok) return { ok: false, message: "limit must be a positive integer" };
  return {
    ok: true,
    since: period.since,
    until: period.until,
    limit: limit.value
  };
}

function parseMissionLimit(value) {
  if (value === null || value === "") return { ok: true, value: 5 };
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) return { ok: false };
  return { ok: true, value: limit };
}

function sortMissions(missions) {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  return [...missions].sort((left, right) => {
    const priorityDiff = (priorityRank[left.priority] ?? 99) - (priorityRank[right.priority] ?? 99);
    if (priorityDiff) return priorityDiff;
    const brandDiff = left.brand.name.localeCompare(right.brand.name, "ko");
    if (brandDiff) return brandDiff;
    return left.sourceActionId.localeCompare(right.sourceActionId);
  });
}

async function validateDecisionCreateInput(input) {
  const registry = await readBrandRegistry();
  const brandId = normalizeBrandCode(input.brandId);
  const brand = registry.brands.find((item) => item.id === brandId);
  if (!brand) return { ok: false, status: 404, error: "Not Found", message: `Unknown brandId: ${brandId}` };
  const decision = normalizeRequiredText(input.decision);
  if (!decision) return { ok: false, status: 400, error: "Bad Request", message: "decision is required" };
  const reason = normalizeRequiredText(input.reason);
  if (!reason) return { ok: false, status: 400, error: "Bad Request", message: "reason is required" };
  const status = input.status === undefined ? "planned" : normalizeBrandName(input.status);
  if (!validDecisionStatus(status)) return { ok: false, status: 400, error: "Bad Request", message: "Invalid decision status" };
  const reference = await validateDecisionReference({
    brandId,
    missionId: normalizeOptionalText(input.missionId),
    sourceActionId: normalizeOptionalText(input.sourceActionId)
  });
  if (!reference.ok) return reference;
  return {
    ok: true,
    brand,
    decision,
    reason,
    status,
    missionId: reference.missionId,
    sourceActionId: reference.sourceActionId,
    signalIds: reference.signalIds,
    actionTitle: reference.actionTitle
  };
}

async function validateDecisionReference({ brandId, missionId, sourceActionId }) {
  if (!missionId && !sourceActionId) return { ok: true, missionId: null, sourceActionId: null };
  let period = { since: currentMonthStartKey(), until: todayKey() };
  let actionId = sourceActionId;
  if (missionId) {
    const parsed = parseMissionId(missionId);
    if (!parsed || parsed.brandId !== brandId) return { ok: false, status: 400, error: "Bad Request", message: "missionId does not match this brand" };
    period = { since: parsed.since, until: parsed.until };
    actionId = actionId || parsed.sourceActionId;
    if (actionId !== parsed.sourceActionId) return { ok: false, status: 400, error: "Bad Request", message: "sourceActionId does not match missionId" };
  }
  if (actionId) {
    const input = await buildBrandIntelligenceInput(brandId, period);
    const intelligence = buildBrandIntelligence(input);
    const action = intelligence.actions.find((item) => item.id === actionId);
    if (!action) return { ok: false, status: 404, error: "Not Found", message: `Action is not available for this brand: ${actionId}` };
    return { ok: true, missionId: missionId || null, sourceActionId: actionId || null, signalIds: action.signalIds, actionTitle: action.title };
  }
  return { ok: true, missionId: missionId || null, sourceActionId: actionId || null, signalIds: [], actionTitle: null };
}

function validateDecisionPatchInput(input) {
  const result = {};
  if (input.status !== undefined) {
    const status = normalizeBrandName(input.status);
    if (!validDecisionStatus(status)) return { ok: false, message: "Invalid decision status" };
    result.status = status;
  }
  if (input.reason !== undefined) {
    const reason = normalizeRequiredText(input.reason);
    if (!reason) return { ok: false, message: "reason must not be empty" };
    result.reason = reason;
  }
  if (input.result !== undefined) result.result = input.result === null ? null : input.result;
  if (result.status === undefined && result.reason === undefined && result.result === undefined) return { ok: false, message: "No supported fields to update" };
  return { ok: true, ...result };
}

async function decisionsFilter(url) {
  const registry = await readBrandRegistry();
  const brandId = normalizeOptionalText(url.searchParams.get("brandId"));
  if (brandId && !registry.brands.some((brand) => brand.id === brandId)) return { ok: false, status: 404, error: "Not Found", message: `Unknown brandId: ${brandId}` };
  const statusFilter = normalizeOptionalText(url.searchParams.get("status"));
  if (statusFilter && !validDecisionStatus(statusFilter)) return { ok: false, status: 400, error: "Bad Request", message: "Invalid decision status" };
  const limit = parseHistoryLimit(url.searchParams.get("limit"));
  if (!limit.ok) return { ok: false, status: 400, error: "Bad Request", message: "limit must be a positive integer" };
  return { ok: true, brandId, statusFilter, limit: limit.value };
}

async function timelineFilter(url) {
  const registry = await readBrandRegistry();
  const brandId = normalizeOptionalText(url.searchParams.get("brandId"));
  if (brandId && !registry.brands.some((brand) => brand.id === brandId)) return { ok: false, status: 404, error: "Not Found", message: `Unknown brandId: ${brandId}` };
  const type = normalizeOptionalText(url.searchParams.get("type"));
  if (type && !validTimelineType(type)) return { ok: false, status: 400, error: "Bad Request", message: "Invalid timeline type" };
  const limit = parseHistoryLimit(url.searchParams.get("limit"));
  if (!limit.ok) return { ok: false, status: 400, error: "Bad Request", message: "limit must be a positive integer" };
  return { ok: true, brandId, type, limit: limit.value };
}

async function learningFilter(url) {
  const registry = await readBrandRegistry();
  const brandId = normalizeOptionalText(url.searchParams.get("brandId"));
  if (brandId && !registry.brands.some((brand) => brand.id === brandId)) return { ok: false, status: 404, error: "Not Found", message: `Unknown brandId: ${brandId}` };
  const sourceActionId = normalizeOptionalText(url.searchParams.get("sourceActionId"));
  const signalId = normalizeOptionalText(url.searchParams.get("signalId"));
  const limit = parseHistoryLimit(url.searchParams.get("limit"));
  if (!limit.ok) return { ok: false, status: 400, error: "Bad Request", message: "limit must be a positive integer" };
  return { ok: true, brandId, sourceActionId, signalId, limit: limit.value };
}

async function learningSimilarFilter(url) {
  const base = await learningFilter(url);
  if (!base.ok) return base;
  const signalIds = parseSignalIds(url.searchParams.get("signalIds"));
  if (!signalIds.ok) return { ok: false, status: 400, error: "Bad Request", message: "signalIds must be a comma-separated list" };
  return { ...base, signalIds: signalIds.value };
}

function validateLearningDecision(decision) {
  if (decision.status !== "completed") return { ok: false, message: "decision must be completed" };
  if (decision.status === "cancelled") return { ok: false, message: "cancelled decision cannot be learned" };
  if (!hasLearningResult(decision.result)) return { ok: false, message: "decision result is required" };
  return { ok: true };
}

async function createLearningCase(decision, createdAt) {
  const preservedSignalIds = Array.isArray(decision.signalIds) ? decision.signalIds.filter(Boolean) : [];
  const action = preservedSignalIds.length ? null : await resolveDecisionAction(decision);
  return {
    id: `learning:${decision.id}`,
    brandId: decision.brandId,
    decisionId: decision.id,
    missionId: decision.missionId || null,
    sourceActionId: decision.sourceActionId || null,
    signalIds: preservedSignalIds.length ? preservedSignalIds : action?.signalIds || [],
    actionTitle: decision.actionTitle || action?.title || null,
    decision: decision.decision,
    reason: decision.reason || null,
    result: decision.result,
    completedAt: decision.updatedAt,
    createdAt
  };
}

async function resolveDecisionAction(decision) {
  if (!decision.sourceActionId) return null;
  const parsed = parseMissionId(decision.missionId);
  const period = parsed ? { since: parsed.since, until: parsed.until } : { since: currentMonthStartKey(), until: todayKey() };
  const input = await buildBrandIntelligenceInput(decision.brandId, period);
  const intelligence = buildBrandIntelligence(input);
  return intelligence.actions.find((action) => action.id === decision.sourceActionId) || null;
}

function hasLearningResult(result) {
  if (result === null || result === undefined) return false;
  if (typeof result === "string") return result.trim().length > 0;
  if (Array.isArray(result)) return result.length > 0;
  if (typeof result === "object") return Object.keys(result).length > 0;
  return true;
}

function createDecisionId(brandId, createdAt, index) {
  return `decision:${brandId}:${createdAt}:${index + 1}`;
}

function createTimelineEvent({ brandId, type, occurredAt, title, description, source, relatedIds }) {
  return {
    id: `event:${type}:${brandId}:${occurredAt}:${relatedIds.filter(Boolean).join("|")}`,
    brandId,
    type,
    occurredAt,
    title,
    description,
    source,
    relatedIds: relatedIds.filter(Boolean)
  };
}

function decisionPatchTimelineEvent(decision, { previousStatus, previousResult, now }) {
  if (decision.status === "completed" && JSON.stringify(decision.result ?? null) !== previousResult) {
    return createTimelineEvent({
      brandId: decision.brandId,
      type: "result_recorded",
      occurredAt: now,
      title: "Decision result recorded",
      description: "Decision result was recorded",
      source: "decision-history",
      relatedIds: relatedDecisionIds(decision)
    });
  }
  if (decision.status !== previousStatus) {
    return createTimelineEvent({
      brandId: decision.brandId,
      type: "action_started",
      occurredAt: now,
      title: "Decision status updated",
      description: `Decision status changed to ${decision.status}`,
      source: "decision-history",
      relatedIds: relatedDecisionIds(decision)
    });
  }
  if (JSON.stringify(decision.result ?? null) !== previousResult) {
    return createTimelineEvent({
      brandId: decision.brandId,
      type: "result_recorded",
      occurredAt: now,
      title: "Decision result recorded",
      description: "Decision result was recorded",
      source: "decision-history",
      relatedIds: relatedDecisionIds(decision)
    });
  }
  return null;
}

function relatedDecisionIds(decision) {
  return [decision.id, decision.missionId, decision.sourceActionId];
}

function parseMissionId(missionId) {
  const parts = String(missionId || "").split(":");
  if (parts.length !== 5 || parts[0] !== "mission" || !isDateKey(parts[3]) || !isDateKey(parts[4])) return null;
  return {
    brandId: parts[1],
    sourceActionId: parts[2],
    since: parts[3],
    until: parts[4]
  };
}

function validDecisionStatus(status) {
  return ["planned", "in_progress", "completed", "cancelled"].includes(status);
}

function validTimelineType(type) {
  return ["decision_recorded", "action_started", "result_recorded"].includes(type);
}

function parseHistoryLimit(value) {
  if (value === null || value === "") return { ok: true, value: null };
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) return { ok: false };
  return { ok: true, value: limit };
}

function parseSignalIds(value) {
  if (value === null || value === "") return { ok: true, value: [] };
  const ids = String(value).split(",").map((item) => normalizeOptionalText(item)).filter(Boolean);
  if (!ids.length) return { ok: false };
  return { ok: true, value: [...new Set(ids)] };
}

function sortDecisionsLatestFirst(decisions) {
  return [...decisions].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function sortTimelineLatestFirst(events) {
  return [...events].sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
}

function sortLearningCasesLatestFirst(cases) {
  return [...cases].sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)));
}

function sortSimilarLearningCases(cases, filter) {
  return cases.map((item) => {
    const signalOverlap = filter.signalIds.filter((id) => item.signalIds.includes(id));
    const matchedBy = [];
    if (filter.sourceActionId && item.sourceActionId === filter.sourceActionId) matchedBy.push("sourceActionId");
    if (signalOverlap.length) matchedBy.push("signalIds");
    if (filter.brandId && item.brandId === filter.brandId) matchedBy.push("brandId");
    return { item, matchedBy, signalOverlapCount: signalOverlap.length };
  }).sort((left, right) => {
    const sourceDiff = Number(right.matchedBy.includes("sourceActionId")) - Number(left.matchedBy.includes("sourceActionId"));
    if (sourceDiff) return sourceDiff;
    const signalDiff = right.signalOverlapCount - left.signalOverlapCount;
    if (signalDiff) return signalDiff;
    const brandDiff = Number(right.matchedBy.includes("brandId")) - Number(left.matchedBy.includes("brandId"));
    if (brandDiff) return brandDiff;
    return String(right.item.completedAt).localeCompare(String(left.item.completedAt));
  });
}

function normalizeRequiredText(value) {
  return normalizeBrandName(value).slice(0, 1000);
}

function normalizeOptionalText(value) {
  const text = normalizeBrandName(value);
  return text || null;
}

async function buildCommerceBrandInput({ brand, registry, period, sourceData }) {
  const response = sourceData?.commerce || await fetchMarketingOsJson(`/api/diagnostics/brand-sales?since=${encodeURIComponent(period.since)}&until=${encodeURIComponent(period.until)}`);
  if (!response.ok) return unavailableSource("commerce", response.message);
  const brands = Array.isArray(response.data?.brands) ? response.data.brands : [];
  const products = Array.isArray(response.data?.products) ? response.data.products : [];
  const matchedBrand = brands.find((item) => resolveSourceBrandId(item.brand_code || item.brand_name, registry) === brand.id);
  const matchedProducts = products.filter((item) => resolveSourceBrandId(item.brand_code || item.brand_name, registry) === brand.id);
  if (!matchedBrand && !matchedProducts.length) {
    return {
      status: "unmatched",
      data: {
        source: response.data?.source || null,
        reason: "No Cafe24 brand sales row matched this canonical brandId"
      }
    };
  }
  return {
    status: "matched",
    data: {
      source: response.data?.source || null,
      salesAmount: finiteOrNull(matchedBrand?.salesAmount),
      paidAmount: finiteOrNull(matchedBrand?.sales?.paidAmount ?? matchedBrand?.canonicalPaidAmount ?? matchedBrand?.salesAmount),
      orderCount: finiteOrNull(matchedBrand?.orderCount),
      quantitySold: finiteOrNull(matchedBrand?.quantitySold),
      productCount: finiteOrNull(matchedBrand?.soldProductCount ?? matchedProducts.length),
      products: matchedProducts.map((product) => ({
        productNo: product.productNo || null,
        productCode: product.productCode || null,
        productName: product.productName || null,
        salesAmount: finiteOrNull(product.salesAmount),
        paidAmount: finiteOrNull(product?.sales?.paidAmount ?? product?.canonicalPaidAmount ?? product?.salesAmount),
        orderCount: finiteOrNull(product.orderCount),
        quantitySold: finiteOrNull(product.quantitySold)
      }))
    }
  };
}

async function buildMarketingBrandInput({ brand, registry, period, sourceData }) {
  const response = sourceData?.marketing || await fetchMarketingOsJson(`/api/meta-ads/full-report?since=${encodeURIComponent(period.since)}&until=${encodeURIComponent(period.until)}`);
  if (!response.ok) return unavailableSource("marketing", response.message);
  const rows = Array.isArray(response.data?.rows) ? response.data.rows : [];
  const matchedRows = rows.filter((row) => {
    const candidates = [
      row.brandId,
      row.brand_id,
      row.brandName,
      row.brand_name,
      row.campaignName,
      row.adsetName,
      row.adName,
      row.name
    ];
    return candidates.some((value) => resolveSourceBrandId(value, registry) === brand.id);
  });
  if (!matchedRows.length) {
    return {
      status: "unmatched",
      data: {
        reason: "No Meta campaign/ad/adset field exactly matched this canonical brand"
      }
    };
  }
  return {
    status: "matched",
    data: {
      spend: sumField(matchedRows, "spend"),
      purchaseValue: sumField(matchedRows, "purchaseValue"),
      campaignCount: new Set(matchedRows.map((row) => row.campaignId || row.campaignName || row.name).filter(Boolean)).size,
      rows: matchedRows.map((row) => ({
        campaignId: row.campaignId || null,
        campaignName: row.campaignName || row.name || null,
        spend: finiteOrNull(row.spend),
        purchaseValue: finiteOrNull(row.purchaseValue)
      }))
    }
  };
}

async function buildContentBrandInput({ brand, registry, period, sourceData }) {
  const response = sourceData?.content || await fetchMarketingOsJson(`/api/instagram/range?since=${encodeURIComponent(period.since)}&until=${encodeURIComponent(period.until)}`);
  if (!response.ok) return unavailableSource("content", response.message);
  const posts = Array.isArray(response.data?.posts) ? response.data.posts : [];
  const matchedPosts = posts.filter((post) => instagramPostBrandCandidates(post).some((value) => resolveSourceBrandId(value, registry) === brand.id));
  if (!matchedPosts.length) {
    return {
      status: "unmatched",
      data: {
        reason: "No structured Instagram brand/tag field exactly matched this canonical brand"
      }
    };
  }
  return {
    status: "matched",
    data: {
      postCount: matchedPosts.length,
      totalViews: sumField(matchedPosts, "views"),
      totalLikes: sumField(matchedPosts, "likes"),
      totalSaves: sumField(matchedPosts, "saves"),
      totalShares: sumField(matchedPosts, "shares"),
      posts: matchedPosts.map((post) => ({
        id: post.id || post.mediaId || post.permalink || null,
        caption: post.caption ? String(post.caption).slice(0, 120) : null,
        timestamp: post.timestamp || post.date || null,
        views: finiteOrNull(post.views),
        saves: finiteOrNull(post.saves),
        likes: finiteOrNull(post.likes),
        shares: finiteOrNull(post.shares)
      }))
    }
  };
}

async function buildSearchBrandInput({ brand, registry, sourceData }) {
  const store = sourceData?.naverStore || await readNaverSnapshotsStore();
  const candidates = brandSearchKeywords(brand, registry);
  const snapshot = sortSnapshotsLatestFirst(store.snapshots).find((item) => candidates.some((keyword) => resolveSourceBrandId(item.keyword, registry) === brand.id && normalizeBrandKey(item.keyword) === normalizeBrandKey(keyword)));
  if (!snapshot) {
    return {
      status: "unmatched",
      data: {
        pointInTime: true,
        reason: "No Naver snapshot keyword matched this canonical brand or alias"
      }
    };
  }
  return {
    status: "matched",
    data: {
      pointInTime: true,
      keyword: snapshot.keyword,
      collectedAt: snapshot.collectedAt,
      source: snapshot.source,
      rows: snapshot.rows
    }
  };
}

async function handleNaverSearchRoute(url, res) {
  const keyword = normalizeBrandName(url.searchParams.get("keyword") || url.searchParams.get("query") || "");
  if (!keyword) {
    return json(res, {
      ok: false,
      error: "Bad Request",
      message: "keyword query is required"
    }, 400);
  }
  const credentials = naverAdsCredentials();
  if (!credentials.ok) {
    return json(res, {
      ok: false,
      error: "Naver Search Ads credentials are not configured",
      missing: credentials.missing
    }, 503);
  }
  const result = await fetchNaverKeywordSearch(keyword, credentials);
  if (!result.ok) {
    return json(res, {
      ok: false,
      error: result.error,
      status: result.status,
      message: result.message
    }, result.httpStatus);
  }
  return json(res, {
    ok: true,
    source: "naver-searchad-keywordstool",
    query: keyword,
    count: result.rows.length,
    rows: result.rows
  });
}

async function handleNaverSnapshotsGet(url, res) {
  const keyword = normalizeBrandName(url.searchParams.get("keyword") || "");
  const limit = parseSnapshotLimit(url.searchParams.get("limit"));
  if (!limit.ok) {
    return json(res, {
      ok: false,
      error: "Bad Request",
      message: "limit must be a positive integer"
    }, 400);
  }
  const store = await readNaverSnapshotsStore();
  let snapshots = sortSnapshotsLatestFirst(store.snapshots);
  if (keyword) {
    const keywordKey = normalizeBrandKey(keyword);
    snapshots = snapshots.filter((snapshot) => normalizeBrandKey(snapshot.keyword) === keywordKey);
  }
  if (limit.value) snapshots = snapshots.slice(0, limit.value);
  return json(res, {
    ok: true,
    count: snapshots.length,
    snapshots
  });
}

async function handleNaverSnapshotsPost(req, url, res) {
  const body = await readJsonBody(req);
  if (!body.ok) {
    return json(res, {
      ok: false,
      error: "Bad Request",
      message: body.message
    }, 400);
  }
  const keyword = normalizeBrandName(body.value.keyword || url.searchParams.get("keyword") || "");
  if (!keyword) {
    return json(res, {
      ok: false,
      error: "Bad Request",
      message: "keyword is required"
    }, 400);
  }
  const credentials = naverAdsCredentials();
  if (!credentials.ok) {
    return json(res, {
      ok: false,
      error: "Naver Search Ads credentials are not configured",
      missing: credentials.missing
    }, 503);
  }
  const result = await fetchNaverKeywordSearch(keyword, credentials);
  if (!result.ok) {
    return json(res, {
      ok: false,
      error: result.error,
      status: result.status,
      message: result.message
    }, result.httpStatus);
  }
  const store = await readNaverSnapshotsStore();
  const collectedAt = new Date().toISOString();
  const snapshot = createNaverSearchSnapshot({ keyword, collectedAt, rows: result.rows });
  const duplicate = findRecentDuplicateSnapshot(store.snapshots, snapshot);
  if (duplicate) {
    return json(res, {
      ok: true,
      duplicate: true,
      snapshot: duplicate
    });
  }
  store.snapshots.push(snapshot);
  store.updatedAt = collectedAt;
  await writeNaverSnapshotsStore(store);
  clearMissionCache();
  return json(res, {
    ok: true,
    duplicate: false,
    snapshot
  });
}

function naverAdsCredentials() {
  const values = {
    apiKey: env.NAVER_ADS_API_KEY,
    secretKey: env.NAVER_ADS_SECRET_KEY,
    customerId: env.NAVER_ADS_CUSTOMER_ID
  };
  const missing = [];
  if (!values.apiKey) missing.push("NAVER_ADS_API_KEY");
  if (!values.secretKey) missing.push("NAVER_ADS_SECRET_KEY");
  if (!values.customerId) missing.push("NAVER_ADS_CUSTOMER_ID");
  return missing.length ? { ok: false, missing } : { ok: true, ...values };
}

async function fetchNaverKeywordSearch(keyword, credentials) {
  const canonicalKeyword = String(keyword || "").trim();
  const requestKeyword = canonicalKeyword.replace(/\s+/g, "");
  const method = "GET";
  const uri = "/keywordstool";
  const endpoint = new URL(uri, naverAdsBaseUrl);
  endpoint.searchParams.set("hintKeywords", requestKeyword);
  endpoint.searchParams.set("showDetail", "1");
  const timestamp = String(Date.now());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), naverAdsTimeoutMs);
  try {
    const response = await fetch(endpoint, {
      method,
      headers: naverSearchAdsHeaders({ method, uri, timestamp, credentials }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        httpStatus: 502,
        status: response.status,
        error: "Naver Search Ads request failed",
        message: safeNaverErrorMessage(text) || `Naver Search Ads returned HTTP ${response.status}`
      };
    }
    try {
      const parsed = text ? JSON.parse(text) : {};
      return {
        ok: true,
        rows: normalizeNaverKeywordRows(parsed)
      };
    } catch {
      return {
        ok: false,
        httpStatus: 502,
        status: response.status,
        error: "Naver Search Ads response was not valid JSON",
        message: "Naver Search Ads returned an unreadable response"
      };
    }
  } catch (error) {
    return {
      ok: false,
      httpStatus: 502,
      status: null,
      error: error?.name === "AbortError" ? "Naver Search Ads request timed out" : "Naver Search Ads network error",
      message: error?.name === "AbortError" ? "Naver Search Ads did not respond in time" : "Unable to reach Naver Search Ads"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function naverSearchAdsHeaders({ method, uri, timestamp, credentials }) {
  return {
    "X-Timestamp": timestamp,
    "X-API-KEY": credentials.apiKey,
    "X-Customer": credentials.customerId,
    "X-Signature": createNaverSearchAdsSignature({ method, uri, timestamp, secretKey: credentials.secretKey })
  };
}

function createNaverSearchAdsSignature({ method, uri, timestamp, secretKey }) {
  return createHmac("sha256", secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest("base64");
}

function normalizeNaverKeywordRows(payload) {
  const rows = Array.isArray(payload?.keywordList) ? payload.keywordList : [];
  return rows.map((row) => ({
    keyword: normalizeBrandName(row.relKeyword),
    monthlyPcQueryCount: parseNaverNumber(row.monthlyPcQcCnt),
    monthlyMobileQueryCount: parseNaverNumber(row.monthlyMobileQcCnt),
    monthlyPcClickCount: parseNaverNumber(row.monthlyAvePcClkCnt),
    monthlyMobileClickCount: parseNaverNumber(row.monthlyAveMobileClkCnt),
    monthlyPcClickRate: parseNaverNumber(row.monthlyAvePcCtr),
    monthlyMobileClickRate: parseNaverNumber(row.monthlyAveMobileCtr),
    competitionIndex: row.compIdx == null ? null : String(row.compIdx),
    averageExposureRank: parseNaverNumber(row.plAvgDepth)
  }));
}

function parseNaverNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text || text.includes("<")) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function safeNaverErrorMessage(text) {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return String(parsed.title || parsed.message || parsed.error || "").slice(0, 200);
  } catch {
    return String(text).slice(0, 200);
  }
}

function brandIntelligencePeriod(url) {
  const since = url.searchParams.get("since") || currentMonthStartKey();
  const until = url.searchParams.get("until") || todayKey();
  if (!isDateKey(since) || !isDateKey(until)) return { ok: false, message: "since and until must be YYYY-MM-DD" };
  if (since > until) return { ok: false, message: "since must be before or equal to until" };
  return { ok: true, since, until };
}

async function fetchMarketingOsJson(path) {
  const endpoint = new URL(path, marketingOsBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), marketingOsTimeoutMs);
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, message: "Marketing OS returned unreadable JSON" };
    }
    if (!response.ok || data?.error) {
      return { ok: false, message: safeSourceErrorMessage(data?.error || data?.message || `Marketing OS HTTP ${response.status}`) };
    }
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message: error?.name === "AbortError" ? "Marketing OS request timed out" : "Marketing OS is unavailable"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function unavailableSource(source, reason) {
  return {
    status: "unavailable",
    data: {
      source,
      reason: safeSourceErrorMessage(reason)
    }
  };
}

function resolveSourceBrandId(value, registry) {
  const resolved = resolveBrand(value, registry);
  return resolved?.brandId || null;
}

function brandSearchKeywords(brand, registry) {
  const values = [brand.name];
  for (const alias of registry.aliases) {
    if (alias.brandId === brand.id) values.push(alias.alias);
  }
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeBrandKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function instagramPostBrandCandidates(post) {
  const values = [
    post.brandId,
    post.brand_id,
    post.brandName,
    post.brand_name,
    post.brand,
    post.productBrand,
    post.product_brand
  ];
  for (const field of [post.tags, post.hashtags, post.brandTags, post.brand_tags, post.mentions]) {
    if (Array.isArray(field)) values.push(...field);
  }
  return values.filter((value) => typeof value === "string" && value.trim());
}

function sumField(rows, field) {
  return rows.reduce((total, row) => total + (finiteOrNull(row?.[field]) ?? 0), 0);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function currentMonthStartKey() {
  return `${todayKey().slice(0, 7)}-01`;
}

function safeSourceErrorMessage(value) {
  return String(value || "Source unavailable").slice(0, 200);
}

async function ensureNaverSnapshotsFile() {
  if (existsSync(naverSearchSnapshotsFile)) {
    await readNaverSnapshotsStore();
    return;
  }
  await writeNaverSnapshotsStore({
    updatedAt: new Date().toISOString(),
    snapshots: []
  });
}

async function readNaverSnapshotsStore() {
  const parsed = JSON.parse(await readFile(naverSearchSnapshotsFile, "utf8"));
  validateNaverSnapshotsStore(parsed);
  return {
    updatedAt: parsed.updatedAt || null,
    snapshots: parsed.snapshots
  };
}

function validateNaverSnapshotsStore(store) {
  if (!store || typeof store !== "object") throw new Error("naver-search-snapshots.json must be an object");
  if (!Array.isArray(store.snapshots)) throw new Error("naver-search-snapshots.json snapshots must be an array");
  const ids = new Set();
  for (const snapshot of store.snapshots) {
    if (!snapshot?.id || !snapshot?.keyword || !snapshot?.collectedAt || !snapshot?.source) throw new Error("Naver snapshot id, keyword, collectedAt, and source are required");
    if (!Array.isArray(snapshot.rows)) throw new Error(`Naver snapshot rows must be an array: ${snapshot.id}`);
    if (ids.has(snapshot.id)) throw new Error(`Duplicate Naver snapshot id: ${snapshot.id}`);
    ids.add(snapshot.id);
  }
}

function createNaverSearchSnapshot({ keyword, collectedAt, rows }) {
  return {
    id: `naver-searchad-keywordstool:${normalizeBrandKey(keyword)}:${collectedAt}`,
    keyword,
    collectedAt,
    source: "naver-searchad-keywordstool",
    rows
  };
}

function findRecentDuplicateSnapshot(snapshots, snapshot) {
  const keywordKey = normalizeBrandKey(snapshot.keyword);
  const rowsText = JSON.stringify(snapshot.rows);
  const collectedAt = Date.parse(snapshot.collectedAt);
  return sortSnapshotsLatestFirst(snapshots).find((item) => {
    if (normalizeBrandKey(item.keyword) !== keywordKey) return false;
    if (JSON.stringify(item.rows) !== rowsText) return false;
    const itemTime = Date.parse(item.collectedAt);
    return Number.isFinite(itemTime) && Number.isFinite(collectedAt) && Math.abs(collectedAt - itemTime) <= 5000;
  }) || null;
}

function sortSnapshotsLatestFirst(snapshots) {
  return [...snapshots].sort((left, right) => String(right.collectedAt).localeCompare(String(left.collectedAt)));
}

function latestNaverSnapshotForKeyword(snapshots, keyword) {
  const keywordKey = normalizeBrandKey(keyword);
  return sortSnapshotsLatestFirst(snapshots).find((snapshot) => normalizeBrandKey(snapshot.keyword) === keywordKey) || null;
}

function parseSnapshotLimit(value) {
  if (value === null || value === "") return { ok: true, value: null };
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) return { ok: false };
  return { ok: true, value: limit };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, message: "Request body must be valid JSON" };
  }
}

async function writeNaverSnapshotsStore(store) {
  validateNaverSnapshotsStore(store);
  await writeJsonAtomic(naverSearchSnapshotsFile, store);
}

async function ensureMissionCacheFile() {
  if (existsSync(missionCacheFile)) {
    await readMissionCacheStore();
    return;
  }
  await writeMissionCacheStore({
    updatedAt: new Date().toISOString(),
    entries: []
  });
}

async function readMissionCacheStore() {
  const parsed = JSON.parse(await readFile(missionCacheFile, "utf8"));
  validateMissionCacheStore(parsed);
  return {
    updatedAt: parsed.updatedAt || null,
    entries: parsed.entries
  };
}

function validateMissionCacheStore(store) {
  if (!store || typeof store !== "object") throw new Error("mission-cache.json must be an object");
  if (!Array.isArray(store.entries)) throw new Error("mission-cache.json entries must be an array");
  const keys = new Set();
  for (const entry of store.entries) {
    if (!entry?.key || !entry?.since || !entry?.until || !Number.isInteger(entry.limit) || !entry?.updatedAt || !entry?.result) throw new Error("Mission cache key, since, until, limit, updatedAt, and result are required");
    if (keys.has(entry.key)) throw new Error(`Duplicate mission cache key: ${entry.key}`);
    if (entry.result.ok !== true || !Array.isArray(entry.result.missions) || !entry.result.meta || typeof entry.result.meta !== "object") throw new Error(`Invalid mission cache result: ${entry.key}`);
    keys.add(entry.key);
  }
}

async function readMissionCacheEntry(key) {
  const store = await readMissionCacheStore();
  return store.entries.find((entry) => entry.key === key) || null;
}

async function writeMissionCacheEntry(key, options, result) {
  const store = await readMissionCacheStore();
  const now = new Date().toISOString();
  const entry = {
    key,
    since: options.since,
    until: options.until,
    limit: options.limit,
    updatedAt: now,
    result
  };
  store.entries = [entry, ...store.entries.filter((item) => item.key !== key)];
  store.updatedAt = now;
  await writeMissionCacheStore(store);
}

async function writeMissionCacheStore(store) {
  validateMissionCacheStore(store);
  await writeJsonAtomic(missionCacheFile, store);
}

async function ensureTimelineFile() {
  if (existsSync(brandTimelineFile)) {
    await readTimelineStore();
    return;
  }
  await writeTimelineStore({
    updatedAt: new Date().toISOString(),
    events: []
  });
}

async function ensureDecisionHistoryFile() {
  if (existsSync(decisionHistoryFile)) {
    await readDecisionHistoryStore();
    return;
  }
  await writeDecisionHistoryStore({
    updatedAt: new Date().toISOString(),
    decisions: []
  });
}

async function ensureLearningDbFile() {
  if (existsSync(learningDbFile)) {
    await readLearningDbStore();
    return;
  }
  await writeLearningDbStore({
    updatedAt: new Date().toISOString(),
    cases: []
  });
}

async function readTimelineStore() {
  const parsed = JSON.parse(await readFile(brandTimelineFile, "utf8"));
  validateTimelineStore(parsed);
  return {
    updatedAt: parsed.updatedAt || null,
    events: parsed.events
  };
}

async function readDecisionHistoryStore() {
  const parsed = JSON.parse(await readFile(decisionHistoryFile, "utf8"));
  validateDecisionHistoryStore(parsed);
  return {
    updatedAt: parsed.updatedAt || null,
    decisions: parsed.decisions
  };
}

async function readLearningDbStore() {
  const parsed = JSON.parse(await readFile(learningDbFile, "utf8"));
  validateLearningDbStore(parsed);
  return {
    updatedAt: parsed.updatedAt || null,
    cases: parsed.cases
  };
}

function validateTimelineStore(store) {
  if (!store || typeof store !== "object") throw new Error("brand-timeline.json must be an object");
  if (!Array.isArray(store.events)) throw new Error("brand-timeline.json events must be an array");
  const ids = new Set();
  for (const event of store.events) {
    if (!event?.id || !event?.brandId || !event?.type || !event?.occurredAt || !event?.title || !event?.source) throw new Error("Timeline event id, brandId, type, occurredAt, title, and source are required");
    if (!validTimelineType(event.type)) throw new Error(`Invalid timeline event type: ${event.type}`);
    if (!Array.isArray(event.relatedIds)) throw new Error(`Timeline event relatedIds must be an array: ${event.id}`);
    if (ids.has(event.id)) throw new Error(`Duplicate timeline event id: ${event.id}`);
    ids.add(event.id);
  }
}

function validateDecisionHistoryStore(store) {
  if (!store || typeof store !== "object") throw new Error("decision-history.json must be an object");
  if (!Array.isArray(store.decisions)) throw new Error("decision-history.json decisions must be an array");
  const ids = new Set();
  for (const decision of store.decisions) {
    if (!decision?.id || !decision?.brandId || !decision?.decision || !decision?.status || !decision?.createdAt || !decision?.updatedAt) throw new Error("Decision id, brandId, decision, status, createdAt, and updatedAt are required");
    if (!validDecisionStatus(decision.status)) throw new Error(`Invalid decision status: ${decision.status}`);
    if (decision.result === undefined) throw new Error(`Decision result field is required: ${decision.id}`);
    if (ids.has(decision.id)) throw new Error(`Duplicate decision id: ${decision.id}`);
    ids.add(decision.id);
  }
}

function validateLearningDbStore(store) {
  if (!store || typeof store !== "object") throw new Error("learning-db.json must be an object");
  if (!Array.isArray(store.cases)) throw new Error("learning-db.json cases must be an array");
  const ids = new Set();
  const decisionIds = new Set();
  for (const item of store.cases) {
    if (!item?.id || !item?.brandId || !item?.decisionId || !item?.decision || !item?.completedAt || !item?.createdAt) throw new Error("Learning case id, brandId, decisionId, decision, completedAt, and createdAt are required");
    if (item.result === undefined || item.result === null) throw new Error(`Learning case result is required: ${item.id}`);
    if (!Array.isArray(item.signalIds)) throw new Error(`Learning case signalIds must be an array: ${item.id}`);
    if (ids.has(item.id)) throw new Error(`Duplicate learning case id: ${item.id}`);
    if (decisionIds.has(item.decisionId)) throw new Error(`Duplicate learning case decisionId: ${item.decisionId}`);
    ids.add(item.id);
    decisionIds.add(item.decisionId);
  }
}

async function writeTimelineStore(store) {
  validateTimelineStore(store);
  await writeJsonAtomic(brandTimelineFile, store);
}

async function writeDecisionHistoryStore(store) {
  validateDecisionHistoryStore(store);
  await writeJsonAtomic(decisionHistoryFile, store);
}

async function writeLearningDbStore(store) {
  validateLearningDbStore(store);
  await writeJsonAtomic(learningDbFile, store);
}

async function writeDecisionAndTimelineStores(decisionStore, timelineStore) {
  validateDecisionHistoryStore(decisionStore);
  validateTimelineStore(timelineStore);
  const decisionTemp = tempJsonFile(decisionHistoryFile);
  const timelineTemp = tempJsonFile(brandTimelineFile);
  await writeFile(decisionTemp, `${JSON.stringify(decisionStore, null, 2)}\n`);
  await writeFile(timelineTemp, `${JSON.stringify(timelineStore, null, 2)}\n`);
  await rename(decisionTemp, decisionHistoryFile);
  await rename(timelineTemp, brandTimelineFile);
}

// canonical work/brand-master.json의 mtime+size(빠른 1차 필터)와 content hash(정확한
// 2차 확인)를 함께 써서, 매 요청마다 파일을 다시 읽지 않고도(대부분은 stat 1회로 끝남)
// canonical이 실제로 바뀐 순간 derived 파일(brand-master-list.json/brand-aliases.json)을
// 자동으로 재생성한다 — 과거의 bootstrap-once(`if (!existsSync(...))`) 설계를 대체.
async function ensureBrandRegistryFresh() {
  if (brandRegistryRefreshPromise) return brandRegistryRefreshPromise;
  brandRegistryRefreshPromise = ensureBrandRegistryFreshInner().finally(() => {
    brandRegistryRefreshPromise = null;
  });
  return brandRegistryRefreshPromise;
}

async function ensureBrandRegistryFreshInner() {
  await mkdir(intelligenceWorkDir, { recursive: true });

  let sourceStat = null;
  try {
    sourceStat = await stat(marketingBrandMasterFile);
  } catch {
    sourceStat = null;
  }
  // ponytail: mtime+size 동일 파일을 같은 초 안에 같은 크기로 다시 쓰면 이론상 놓칠 수
  // 있음 — 실사용 편집 주기(수동 편집, 분 단위)에서는 무해한 근사, 완벽한 보장이
  // 필요해지면 매 호출마다 content hash를 계산하도록 승격.
  const statKey = sourceStat ? `${sourceStat.mtimeMs}:${sourceStat.size}` : "missing";

  const derivedFilesExist = existsSync(brandMasterListFile) && existsSync(brandAliasesFile);
  if (derivedFilesExist && brandRegistryStatCache === statKey) {
    return; // fast path: canonical stat 불변 확인, 재계산 없음
  }

  try {
    const source = await readMarketingBrandMaster();
    const sourceHash = createHash("sha256").update(JSON.stringify(source.brands)).digest("hex");

    let meta = null;
    if (existsSync(brandRegistryBuildMetaFile)) {
      try {
        meta = JSON.parse(await readFile(brandRegistryBuildMetaFile, "utf8"));
      } catch {
        meta = null;
      }
    }

    if (derivedFilesExist && meta?.sourceHash === sourceHash) {
      brandRegistryStatCache = statKey; // 내용은 그대로 — stat만 갱신하고 재작성 없음
      return;
    }

    const { brands, aliases } = buildIntelligenceBrandRegistry(source.brands);
    // 두 derived 파일을 각각 temp에 먼저 쓰고 마지막에만 rename — 중간에 실패해도
    // partial(한쪽만 새 값) 상태가 절대 남지 않는다.
    const brandsTemp = tempJsonFile(brandMasterListFile);
    const aliasesTemp = tempJsonFile(brandAliasesFile);
    await writeFile(brandsTemp, `${JSON.stringify(brands, null, 2)}\n`);
    await writeFile(aliasesTemp, `${JSON.stringify(aliases, null, 2)}\n`);
    await rename(brandsTemp, brandMasterListFile);
    await rename(aliasesTemp, brandAliasesFile);
    await writeJsonAtomic(brandRegistryBuildMetaFile, {
      sourceHash,
      generatedAt: new Date().toISOString(),
      brandCount: brands.length,
      aliasCount: aliases.length
    });
    brandRegistryStatCache = statKey;
  } catch (error) {
    if (!derivedFilesExist) throw error; // 대체할 기존 derived가 없으면 그대로 실패시킨다(과거 동일)
    console.warn(
      "[intelligence][brand-registry] canonical brand-master.json을 읽거나 재생성하는 데 실패해 기존 derived 파일을 그대로 유지합니다:",
      safeErrorMessage(error)
    );
    // brandRegistryStatCache를 갱신하지 않음 — 다음 호출에서 다시 재시도한다.
  }
}

async function ensureBrandRegistryFiles() {
  await ensureBrandRegistryFresh();
  await readBrandRegistry();
}

async function readMarketingBrandMaster() {
  if (!existsSync(marketingBrandMasterFile)) return { brands: [] };
  const parsed = JSON.parse(await readFile(marketingBrandMasterFile, "utf8"));
  return {
    brands: Array.isArray(parsed) ? parsed : Array.isArray(parsed.brands) ? parsed.brands : []
  };
}

export function buildIntelligenceBrandRegistry(sourceBrands = []) {
  const sources = [];
  const seenIds = new Set();
  for (const source of sourceBrands) {
    const id = normalizeBrandCode(source.brand_code);
    const name = normalizeBrandName(source.brand_name);
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);
    sources.push({
      id,
      name,
      active: source.active !== false,
      aliases: parseBrandAliases(source.name_aliases),
      instagramTag: normalizeBrandName(source.instagram_tag)
    });
  }

  const canonicalGroups = Map.groupBy(sources, (source) => normalizeBrandKey(source.name));
  const canonicalOwners = new Map();
  for (const [key, candidates] of canonicalGroups) {
    canonicalOwners.set(key, selectBrandOwner(key, candidates));
  }

  const claims = new Map();
  const addClaim = (value, source, kind) => {
    const key = normalizeBrandKey(value);
    const owner = canonicalOwners.get(normalizeBrandKey(source.name));
    if (!key || !owner) return;
    const candidates = claims.get(key) || [];
    candidates.push({ ...owner, value, kind });
    claims.set(key, candidates);
  };
  for (const source of sources) {
    addClaim(source.name, source, "canonical");
    for (const alias of source.aliases) addClaim(alias, source, "name_alias");
    if (source.instagramTag) addClaim(source.instagramTag, source, "instagram_tag");
  }

  const keyOwners = new Map();
  for (const [key, candidates] of claims) keyOwners.set(key, selectBrandOwner(key, candidates));
  const brands = [...canonicalOwners.entries()]
    .filter(([key, owner]) => keyOwners.get(key)?.id === owner.id)
    .map(([, owner]) => ({ id: owner.id, name: owner.name, active: owner.active }));
  const aliases = [];
  for (const source of sources) {
    const canonicalOwner = keyOwners.get(normalizeBrandKey(source.name));
    aliases.push({ alias: source.id, brandId: canonicalOwner.id, source: canonicalOwner.id === source.id ? "cafe24_brand_code" : "duplicate_cafe24_brand_code" });
    for (const [value, kind] of [...source.aliases.map((alias) => [alias, "name_alias"]), [source.instagramTag, "instagram_tag"]]) {
      const owner = keyOwners.get(normalizeBrandKey(value));
      if (value && owner && normalizeBrandKey(value) !== normalizeBrandKey(owner.name)) aliases.push({ alias: value, brandId: owner.id, source: kind });
    }
  }
  return {
    brands: brands.sort((left, right) => left.name.localeCompare(right.name, "ko")),
    aliases: dedupeAliases(aliases)
  };
}

function selectBrandOwner(key, candidates) {
  const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  const active = unique.filter((candidate) => candidate.active !== false);
  if (active.length > 1) throw new Error(`Active brand key conflict: ${key}`);
  if (active.length === 1) return active[0];
  return unique.sort((left, right) => left.id.localeCompare(right.id))[0];
}

export async function readBrandRegistry() {
  await ensureBrandRegistryFresh();
  const brands = JSON.parse(await readFile(brandMasterListFile, "utf8"));
  const aliases = JSON.parse(await readFile(brandAliasesFile, "utf8"));
  validateBrandRegistry(brands, aliases);
  return {
    brands: [...brands].sort((left, right) => left.name.localeCompare(right.name, "ko")),
    aliases
  };
}

export function validateBrandRegistry(brands, aliases) {
  if (!Array.isArray(brands)) throw new Error("brand-master-list.json must be an array");
  if (!Array.isArray(aliases)) throw new Error("brand-aliases.json must be an array");
  const ids = new Set();
  const names = new Set();
  for (const brand of brands) {
    if (!brand?.id || !brand?.name) throw new Error("Brand id and name are required");
    if (typeof brand.active !== "boolean") throw new Error(`Brand active must be boolean: ${brand.id}`);
    if (ids.has(brand.id)) throw new Error(`Duplicate brand id: ${brand.id}`);
    ids.add(brand.id);
    const nameKey = normalizeBrandKey(brand.name);
    if (names.has(nameKey)) throw new Error(`Duplicate brand name: ${brand.name}`);
    names.add(nameKey);
  }
  const aliasKeys = new Set();
  for (const entry of aliases) {
    if (!entry?.alias || !entry?.brandId) throw new Error("Alias and brandId are required");
    if (!ids.has(entry.brandId)) throw new Error(`Alias references missing brandId: ${entry.brandId}`);
    const aliasKey = normalizeBrandKey(entry.alias);
    const canonicalOwner = brands.find((brand) => normalizeBrandKey(brand.name) === aliasKey);
    if (canonicalOwner && canonicalOwner.id !== entry.brandId) throw new Error(`Canonical/alias conflict: ${entry.alias}`);
    if (aliasKeys.has(aliasKey)) throw new Error(`Duplicate alias: ${entry.alias}`);
    aliasKeys.add(aliasKey);
  }
}

function resolveBrand(input, registry) {
  const resolved = resolveBrandFromEngine(input, registry);
  return resolved ? { brandId: resolved.brandId, name: resolved.name } : null;
}

function parseBrandAliases(value) {
  if (Array.isArray(value)) return value.map(normalizeBrandName).filter(Boolean);
  return String(value ?? "")
    .split(/[\n,]/)
    .map(normalizeBrandName)
    .filter(Boolean);
}

function dedupeAliases(aliases) {
  const seen = new Set();
  const result = [];
  for (const alias of aliases) {
    const key = normalizeBrandKey(alias.alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result.sort((left, right) => left.alias.localeCompare(right.alias, "ko"));
}

async function writeJson(file, data) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeJsonAtomic(file, data) {
  const tempFile = tempJsonFile(file);
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tempFile, file);
}

function tempJsonFile(file) {
  return `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeErrorMessage(error) {
  return error?.message ? String(error.message) : "Unknown error";
}

// ==== Clients Intelligence (Stage 6) — Client Summary Engine ====
// buildClientSummaries(): ECOUNT 거래처명(customerName)을 client 단위로 묶고, Cafe24 개인결제창
// 주문을 텍스트 매칭해 monthlySales/lifetimeSales/purchaseCount/latestPurchaseDate를 연결한다.
// 이번 단계는 데이터 엔진만 구현한다 — API/UI는 추가하지 않는다.
//
// 설계 전제(중요, 보고서 참고):
// - ECOUNT customerName은 "매장방문고객"/"택배"처럼 Cafe24 온라인 주문과 무관한 값이 대부분이다.
//   Cafe24와 연결 가능한 것은 개인결제창(브랜드코드 B0000000) 거래뿐이며, 이 거래의 Cafe24 상품명에는
//   "이름 [실장님] 개인결제창 [날짜]" 형태로 담당자/고객 이름이 그대로 노출되어 있다(Phase 1 진단 #259/#260에서
//   확인). buildClientSummaries()는 이 상품명 텍스트에서 이름을 추출해 ECOUNT customerName과 매칭한다.
//   매칭되지 않는 client(매장방문고객/택배 등)는 monthlySales/lifetimeSales/purchaseCount가 0이고
//   latestPurchaseDate는 null이 되는데, 이는 버그가 아니라 Cafe24 온라인 거래 자체가 없다는 뜻이다.
// - "다인 주문"(예: "박지연 박상욱 실장님 김희섭님 개인결제창")은 첫 번째 이름에만 귀속되는 한계가 있다.
// - Brand(recentItems.brand)는 ECOUNT brandGroup 원문(예: "AVA", "PRO")을 그대로 사용한다. 현재 코드베이스에는
//   ECOUNT brandGroup을 work/brand-master.json의 canonical brand_code로 매핑하는 로직이 존재하지 않는다
//   (직접 확인함). "현재 canonical brand 사용" 지시를 반영하되, 없는 매핑을 새로 만들지는 않았다.

const CLIENT_TYPE_RULE3_EXACT_NAMES = [
  "윤재님 판매",
  "영은님 판매",
  "애림님 판매",
  "민철님 판매",
  "우혁님 판매",
  "준희님 판매"
];
const CLIENT_LOGISTICS_NAMES = new Set(["택배"]);

// ---- 2026-07-17 고객 분류 정정(사용자 실측 확인 반영) ----
// 아래 4개 규칙은 classifyClientType()의 우선순위 맨 앞(TAXFREE보다도 먼저 검사해야 하는
// "온라인 첫가입" 예외 제외)에 최소 추가된 것으로, 기존 실장님/팀/RULE3/매장방문고객 규칙은
// 그대로 두고 새 규칙이 먼저 가로채도록만 구성했다(전체 분류 체계 재설계 아님).

// TASK1: "일반 고객"/"매장방문고객" 계열 변형(공백 유무만 다름)을 하나의 대표 고객으로 병합하기
// 위한 판별. 공백만 제거해 비교하므로 "매장 방문 고"처럼 글자 자체가 다른(축약/오타) 변형이나
// "매장방문고객 (현금)"처럼 부가 정보가 붙은 변형은 의도적으로 포함하지 않는다 — 사용자가 제시한
// 6개 변형(일반 고객/일반고객/매장 방문 고객/매장방문고객/매장 방문고객/매장방문 고객)만 정확히
// 커버하며, 다른 개인 고객 이름을 잘못 합치지 않기 위해 이 이상으로 확장하지 않았다.
const CLIENT_TYPE_GENERIC_CUSTOMER_KEYS = new Set(["일반고객", "매장방문고객"]);
function isGenericCustomerRawName(rawName) {
  const compact = String(rawName || "").replace(/\s+/g, "");
  return CLIENT_TYPE_GENERIC_CUSTOMER_KEYS.has(compact);
}

// 2026-07-17 보완: 사용자가 "일반 고객 완전 통합"에서 명시적으로 지정한 RULE3 판매명
// (윤재/영은 님 판매)도 위의 매장방문고객 계열과 동일한 고정 mergeKey로 합친다.
// 애림/우혁/준희/민철은 RULE3 목록에는 있지만 이보다 먼저 실행되는 foreign 명시 규칙에서
// 가로채져 이 시점(RULE3 분기)에는 절대 도달하지 않으므로 여기 포함하지 않는다 — 혹시
// 나중에 RULE3 목록이 바뀌더라도 실수로 다른 이름까지 통합되지 않도록 이름을 명시적으로
// 검사한다. (2026-07-17 추가 보완: 민철도 foreign으로 이동하며 이 Set에서 제외했다 —
// 사용자가 "customer:generic_customer에 포함되면 안 됨"이라고 명시했다.)
const CLIENT_TYPE_GENERIC_CUSTOMER_STAFF_NAMES = new Set(["윤재", "영은"]);

// 2026-07-17 마지막 정정(alias 화이트리스트로 되돌림): 이전 단계에서 "한글 이름 + 님(선택) + 판매"
// 전체를 일반화하는 정규식(/^[가-힣]{2,8}님?\s*판매$/)을 썼으나, 사용자가 향후 데이터가 추가될 때
// 오분류 위험이 있다는 이유로 일반화를 명시적으로 철회하고 "실제 확인된 alias만" 일반 고객으로
// 처리하도록 요청했다. 정규식 대신 실측으로 확인된 9개 이름의 "OO님 판매" 문자열만 정확히
// 화이트리스트로 등록한다 — 향후 새로운 "OO님 판매"가 들어와도 이 목록에 없으면 자동으로 일반
// 고객으로 가지 않고 기존 fallback(샘플라스 프레스 등)을 그대로 따른다. 새 이름을 일반 고객으로
// 편입하려면 이 배열에 문자열을 하나씩 수동으로 추가해야 한다(사용자가 명시한 운영 방식).
// TAXFREE 검사가 이 함수보다 먼저 실행되므로 "OO님 판매 TAXFREE"류는 항상 foreign이 먼저 가로챈다.
const CLIENT_TYPE_GENERIC_CUSTOMER_SALES_ALIASES = [
  "애림님 판매",
  "민철님 판매",
  "우혁님 판매",
  "준희님 판매",
  "윤재님 판매",
  "영은님 판매",
  "서빈님 판매",
  "서현님 판매",
  "동환님 판매"
];
function isGenericCustomerSalesRawName(rawName) {
  const text = String(rawName || "").replace(/\s+/g, " ").trim();
  return CLIENT_TYPE_GENERIC_CUSTOMER_SALES_ALIASES.includes(text);
}

// TASK3: "우혁 판매 온라인 첫 가입 / 제품 하자"류 예외. 공백/슬래시 표기 차이를 무시하기 위해
// 공백과 슬래시를 모두 제거한 뒤 "온라인첫가입" 포함 여부만 본다. 이 검사는 TASK2의 외국인
// 명시 규칙(우혁 판매 포함)보다 먼저 실행해야 "우혁님 판매(온라인 첫 가입 / 제품 하자)"가
// 외국인으로 먼저 판정되지 않는다(사용자가 명시한 "중요 예외" 요구사항).
function isOnlineFirstSignupRawName(rawName) {
  const compact = String(rawName || "").replace(/[\s/]+/g, "");
  return compact.includes("온라인첫가입");
}

// TASK3(2026-07-17 최종 정정): 기프트 판정은 거래처명/고객 엔티티 단위가 아니라 "판매행 자신"의
// 실제 필드로만 한다. work/ecount-sales/2026-0{1..7}.json 전체(8,405개 라인)를 전수 조사한 결과
// "기프트"라는 문자열이 등장하는 필드는 customerName 하나뿐이었다(productName/specification/poNo/
// personalPaymentReason에는 단 한 건도 없음) — 이 스키마에는애초에 별도의 "적요/판매적요/비고" 필드
// 자체가 존재하지 않는다. 따라서 이 판매행 자신의 customerName에 "기프트"가 포함된 경우에만 그
// 판매행 1건을 제외하고, 같은 mergeKey/같은 사람의 다른 정상 판매행(다른 customerName)에는
// 전혀 영향을 주지 않는다 — 거래처/고객/주문 전체를 지우는 것이 아니라 판매행 단위 필터다.
// STEP67-6: Brand Intelligence Customer Composition이 이 판정을 그대로 재사용한다
// (export만 추가, 판정 로직 변경 없음 — 새 Customer Pipeline을 만들지 않기 위함).
export function isGiftSalesLine(line) {
  return String(line?.customerName || "").includes("기프트");
}

// Store-separated snapshots can accidentally contain the same original ECOUNT line in
// more than one store file. Clients ALL counts that source once, while repeated rows in
// one store and distinct slips remain separate purchases.
function dedupeCrossStoreEcountSourceLines(lines = []) {
  const storesBySource = new Map();
  const sourceKey = (line) => {
    const documentNo = String(line?.slipNo || line?.documentNo || "").trim();
    const storeCode = String(line?.storeCode || "").trim();
    if (!documentNo || !storeCode) return null;
    return JSON.stringify([
      line?.date || "", documentNo, line?.poNo || "", line?.customerName || "",
      line?.productName || "", line?.specification || "",
      Number.isFinite(Number(line?.quantity)) ? Number(line.quantity) : null,
      Number.isFinite(Number(line?.salesAmount)) ? Number(line.salesAmount) : null
    ]);
  };

  for (const line of lines) {
    const key = sourceKey(line);
    if (!key) continue;
    const storeCode = String(line.storeCode).trim();
    const stores = storesBySource.get(key) || new Map();
    stores.set(storeCode, (stores.get(storeCode) || 0) + 1);
    storesBySource.set(key, stores);
  }

  const ownerBySource = new Map();
  for (const [key, stores] of storesBySource) {
    if (stores.size > 1) ownerBySource.set(key, [...stores].sort((a, b) => b[1] - a[1])[0][0]);
  }

  return lines.filter((line) => {
    const key = sourceKey(line);
    return !key || !ownerBySource.has(key) || ownerBySource.get(key) === String(line.storeCode).trim();
  });
}

// TASK4: 이름 끝에 직책으로 "이사"(또는 "이사님")가 붙은 경우만 스타일리스트로 인정한다.
// 전체 문자열이 "이름 + (공백) + 이사(님)?" 형태일 때만 매치되도록 앵커(^...$)를 둬서
// "대표 지인 이전 시즌이라 수수료 20%" 같은 일반 문장이나 회사명이 섞인 텍스트는 걸리지 않는다.
function isStylistTitleRawName(rawName) {
  return /^[가-힣]{2,8}\s?이사님?$/.test(String(rawName || "").trim());
}

// TASK4: 대표 표시명에서 끝의 "이사(님)?" 직책만 제거한다(실장님/팀원 등 기존 처리와 동일하게
// 보수적으로 — 패턴에 매치된 경우에만 제거하고, 그 외에는 원문을 그대로 둔다).
function stripStylistTitleSuffix(rawName) {
  const text = String(rawName || "").trim();
  if (!isStylistTitleRawName(text)) return text;
  return text.replace(/\s?이사님?$/, "").trim();
}

// Clients v1 화면용 기간 기반 집계. 원천 로딩/판별 함수는 buildClientSummaries()와 완전히 동일한
// 것을 재사용하고, 여기서는 "이번 달 고정"이 아니라 임의의 since~until 구간으로 온라인(Cafe24
// 개인결제창 매칭)/오프라인(ECOUNT isOfflineRevenue) 금액·건수를 다시 합산한다.
//
// "정상 구매"의 정의(추정이 아니라 이미 존재하는 필드만으로 판단):
// - 온라인: 매칭된 Cafe24 개인결제창 주문 중 paidAmount > 0 인 것만 카운트한다(0원 주문 제외).
// - 오프라인: ECOUNT 라인 중 isOfflineRevenue === true 인 것을 매출 합계에는 그대로 반영하고
//   (반품 등 음수 라인이 있으면 자연스럽게 상쇄됨 — 기존 canonical offlineSales 계산과 동일 방식),
//   "건수"는 salesAmount > 0인 라인만 센다(반품 라인 자체를 하나의 "구매"로 세지 않기 위함).
// 기간 내 purchaseCount가 0인 고객(즉 이 기간에 실제 거래가 없는 고객)은 요약/목록에서 제외한다 —
// "전체 고객 수"가 "현재 기간 내 고객 식별 가능한 고유 고객 수"이기 때문에 이 필터와 일치해야 한다.
// STEP67-6: Brand Intelligence Customer Composition이 Clients 화면과 동일한 라벨을
// 그대로 쓰도록 export한다(값 변경 없음, 새 라벨 발명 금지).
export const CLIENT_TYPE_LABELS = {
  stylist: "스타일리스트",
  samplas_press: "프레스",
  customer: "일반 손님",
  foreign: "외국인",
  online_first_signup: "온라인 첫가입",
  ff: "직원 구매"
};
const CLIENT_TYPE_ORDER = ["stylist", "samplas_press", "customer", "foreign", "online_first_signup", "ff"];
const CLIENT_TYPE_FF_NAMES = new Set(["관우", "동환", "명석", "서빈", "서현", "애림", "영은", "우혁", "윤재", "준희", "진규"]);
const CLIENT_TYPE_EXPLICIT_OVERRIDES = new Map([
  ["전예린", { type: "stylist", salesStaff: null, override: "explicit_name" }]
]);

function normalizeClientOverrideKey(rawName) {
  return String(rawName || "")
    .normalize("NFKC")
    .replace(/개인\s*결제창|개인결제창|개인결제/g, " ")
    .replace(/실장님|실장|스타일리스트/g, " ")
    .replace(/[()[\]{}·,._-]/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

function explicitClientTypeOverride(rawName) {
  const key = normalizeClientOverrideKey(rawName);
  return CLIENT_TYPE_EXPLICIT_OVERRIDES.get(key) || null;
}

function isFfPurchaseRawName(rawName) {
  const match = /^([가-힣]{2,8})님\s*구매(?:\s|[(/]|$)/.exec(String(rawName || "").trim());
  return Boolean(match && CLIENT_TYPE_FF_NAMES.has(match[1]));
}

export function assignCafe24OrdersToClientGroups(mergedClients, orders) {
  const selectedGroups = new Map();
  for (const group of mergedClients.values()) {
    const orderMatchKey = clientOrderMatchKey(group.classification, group.matchKey);
    if (!orderMatchKey) continue;
    for (const order of orders) {
      if (order.matchKey !== orderMatchKey) continue;
      const dedupeKey = clientOrderDedupeKey(order);
      const selected = selectedGroups.get(dedupeKey);
      if (!selected || (
        selected.classification.type === "samplas_press" &&
        group.classification.type === "stylist"
      )) selectedGroups.set(dedupeKey, group);
    }
  }
  for (const [dedupeKey, group] of selectedGroups) {
    group.orders.set(dedupeKey, orders.find((order) => clientOrderDedupeKey(order) === dedupeKey));
  }
  return new Set(selectedGroups.keys());
}

export async function buildClientsOverview(options = {}) {
  const since = isDateKey(options.since) ? options.since : currentMonthStartKey();
  const until = isDateKey(options.until) ? options.until : todayKey();
  const now = options.now ? new Date(options.now) : new Date();
  const currentMonth = options.currentMonth || clientsIntelligenceMonthKey(now);
  // STORE-BATCH-D: storeCode가 있으면 Store Focus Mode다. Client identity는 절대 매장별로
  // 복제하지 않는다(Store는 purchase activity의 dimension) — 아래에서도 "고객을 다시
  // 그룹핑"하지 않고, 이미 그룹핑된 고객의 offline 구매 라인만 storeCode로 필터하고
  // online 주문은 전부 제외한다(온라인은 physical store에 귀속하지 않는다는 절대 원칙).
  const storeCode = options.storeCode && options.storeCode !== "ALL" ? String(options.storeCode) : null;

  // STEP63-3: Brand Master/Product Registry는 로컬 파일이라 새 API 호출 없이 읽을 수 있다
  // (work/brand-master.json, work/product-registry.json). 온라인 Cafe24 카탈로그 기반
  // 2차 조회(STEP63-2B의 onlineCatalog 옵션)는 이번 STEP에서 의도적으로 연결하지 않았다 —
  // 그 값을 얻으려면 buildBrandSalesDiagnostics()를 추가로 호출해야 하는데, 이는 Clients
  // 요청마다 새로운 Cafe24 상품 카탈로그 조회를 발생시켜 "불필요한 새 API 반복 호출 금지"
  // 지시사항과 충돌한다(work/reports/STEP63-3.md 4번 항목에 이 판단 근거를 상세히 기록).
  const identityResolverContext = await loadResolverContext();

  const ecountClients = await loadEcountClientLines(options.workDir);
  // STEP49-2A-2: 주입 경로도 canonicalizeCafe24ClientOrders()로 기존 캐시 경로와 동일한
  // 정규화/기간 필터/order_id dedupe를 거친 뒤에만 matchKey를 붙인다(디스크 캐시와 병합하지 않음).
  const cafe24PersonalPaymentOrders = Array.isArray(options.cafe24Orders)
    ? canonicalizeCafe24ClientOrders(options.cafe24Orders, { since, until })
      .map((order) => ({
        ...order,
        matchKey: order.isPersonalPayment ? extractClientMatchKey(order.personalPaymentProductName) : ""
      }))
    : await loadCafe24PersonalPaymentOrders({ currentMonth, since, until });

  // buildClientSummaries()와 동일한 병합 로직(alias/mergeKey)을 그대로 재사용한다 — 같은 사람이
  // "최재은 실장님"/"최재은실장님"/"개인결제창 (최재은 실장님)" 등 여러 rawName으로 흩어지는 문제를
  // 여기서도 동일하게 해소해야 요약·TOP10·목록 수치가 buildClientSummaries와 어긋나지 않는다.
  const mergedClients = new Map();
  // STEP19-C(2026-07-27): 어떤 Cafe24 온라인 주문이 아래 루프에서 기존 ECOUNT 고객 그룹에
  // 실제로 매칭됐는지 추적한다 — 매칭되지 않은 주문(개인결제창이 아닌 일반 주문 전부 +
  // ECOUNT 쪽에 대응하는 이름이 없는 개인결제창 주문)을 뒤에서 "온라인 고객(일반)" 가상
  // 그룹으로 묶어 누락 없이 집계에 포함시키기 위함이다.
  for (const [rawName, lines] of ecountClients) {
    const entity = classifyClientEntity(rawName);
    if (entity.entityType !== "client") continue;
    const classification = classifyClientType(rawName);
    const matchKey = extractClientMatchKey(rawName);
    const mergeKey = clientMergeKey(rawName, classification, matchKey);
    if (!mergedClients.has(mergeKey)) {
      mergedClients.set(mergeKey, {
        mergeKey,
        classification,
        matchKey,
        aliases: [],
        aliasSet: new Set(),
        lines: [],
        orders: new Map()
      });
    }
    const group = mergedClients.get(mergeKey);
    if (!group.aliasSet.has(rawName)) {
      group.aliasSet.add(rawName);
      group.aliases.push(rawName);
    }
    group.lines.push(...lines);
  }
  const consumedOnlineOrderKeys = assignCafe24OrdersToClientGroups(mergedClients, cafe24PersonalPaymentOrders);

  // STEP19-C 정책(어떤 온라인 주문도 Clients 집계에서 제외되지 않는다): 위 루프에서 기존
  // ECOUNT 고객 그룹에 매칭되지 않은 Cafe24 온라인 주문 전부(일반 주문 + 매칭 실패한
  // 개인결제창 주문)를 "existing customer 유형"(신규 유형 발명 금지, 정책10)으로 한 개의
  // 가상 그룹에 모아 total/typeBreakdown에 반드시 포함시킨다. 개별 고객 신원을 알 수
  // 없는 거래이므로 개인별로 쪼개지 않고 "온라인 고객(일반)" 한 행으로 표시한다 — 이미
  // 존재하는 "foreign:generic_foreign"(외국인 대표 엔티티 통합) 패턴과 동일한 방식이다.
  const unmatchedOnlineOrders = cafe24PersonalPaymentOrders.filter((order) => !consumedOnlineOrderKeys.has(clientOrderDedupeKey(order)));
  if (unmatchedOnlineOrders.length) {
    const syntheticMergeKey = "customer:online_general_unmatched";
    const syntheticGroup = {
      mergeKey: syntheticMergeKey,
      classification: { type: "customer", salesStaff: null },
      matchKey: "",
      aliases: ["온라인 고객(일반)"],
      aliasSet: new Set(["온라인 고객(일반)"]),
      lines: [],
      orders: new Map()
    };
    for (const order of unmatchedOnlineOrders) {
      syntheticGroup.orders.set(clientOrderDedupeKey(order), order);
    }
    mergedClients.set(syntheticMergeKey, syntheticGroup);
  }

  let excludedGiftCount = 0;
  let excludedGiftSalesAmount = 0;

  const clients = [];
  for (const group of mergedClients.values()) {
    const representativeRawName = selectRepresentativeClientRawName(group.aliases);
    const classification = group.classification;

    // STORE-BATCH-D: Store Focus Mode(storeCode 지정)에서는 온라인 주문을 아예 집계하지
    // 않는다 — 절대 원칙(온라인은 물리 매장에 귀속하지 않음)을 "이 고객의 온라인 매출을
    // 0으로 만드는" 방식이 아니라 "이 필터에서는 온라인이 대상이 아니다"로 구현한다.
    const onlineOrdersInPeriod = storeCode ? [] : [...group.orders.values()].filter((order) => (
      order.paidAmount > 0 &&
      order.orderDate >= since &&
      order.orderDate <= until
    ));
    const onlineSales = onlineOrdersInPeriod.reduce((sum, order) => sum + order.paidAmount, 0);
    const onlinePurchaseCount = onlineOrdersInPeriod.length;

    // storeCode 지정 시 그 매장 라인만 남긴다. 레거시(store-unclassified, storeCode:null)
    // 라인은 어느 storeCode와도 일치하지 않아 자연히 제외된다(추정 귀속 없음).
    const offlineLinesInPeriodRaw = dedupeCrossStoreEcountSourceLines(group.lines.filter((line) => (
      line?.isOfflineRevenue === true &&
      String(line?.date || "") >= since &&
      String(line?.date || "") <= until &&
      (!storeCode || line?.storeCode === storeCode)
    )));
    // TASK3(2026-07-17 최종 정정): 기프트는 거래처/고객 단위가 아니라 "판매행 자신"의 실제 필드
    // (이 데이터 스키마에서는 customerName 하나뿐 — 실측 확인, 아래 isGiftSalesLine 주석 참고)로만
    // 판정해 그 판매행 1건만 집계에서 제외한다. 같은 그룹(mergeKey)에 속한 다른 정상 판매행에는
    // 영향을 주지 않는다.
    const giftLinesInPeriod = offlineLinesInPeriodRaw.filter((line) => isGiftSalesLine(line));
    const giftPurchaseLinesInPeriod = giftLinesInPeriod.filter((line) => Number(line.salesAmount) > 0);
    excludedGiftCount += giftPurchaseLinesInPeriod.length;
    excludedGiftSalesAmount += giftPurchaseLinesInPeriod.reduce((sum, line) => sum + Number(line.salesAmount), 0);
    const offlineLinesInPeriod = offlineLinesInPeriodRaw.filter((line) => !isGiftSalesLine(line));
    const offlineSales = offlineLinesInPeriod.reduce((sum, line) => {
      const amount = Number(line.salesAmount);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
    const offlinePositiveLines = offlineLinesInPeriod.filter((line) => Number(line.salesAmount) > 0);
    const offlinePurchaseCount = offlinePositiveLines.length;

    const purchaseCount = onlinePurchaseCount + offlinePurchaseCount;
    if (purchaseCount <= 0) continue;

    const totalSales = onlineSales + offlineSales;
    const latestDates = [
      ...onlineOrdersInPeriod.map((order) => order.orderDate),
      ...offlinePositiveLines.map((line) => line.date)
    ].filter(Boolean).sort();

    // 스타일리스트 "대분류" 표시명: 이미 계산된 group.matchKey(=extractClientMatchKey 결과, 실장님/
    // 스타일리스트/팀/팀원 등 직책·조직 표현을 안전하게 제거한 뒤 남는 첫 토큰)를 그대로 쓴다.
    // representativeRawName(가장 긴 alias)을 그대로 쓰면 "김협 강유림팀원7/13픽업"처럼 조직/메모
    // 텍스트가 붙은 별칭이 표시명이 되는 문제가 있었다 — matchKey는 이미 병합 키로 쓰이고 있어
    // 같은 그룹의 모든 alias가 동일한 값을 공유하므로, 새로운 병합 규칙을 추가하지 않고 표시명만
    // 정정한다. matchKey가 비어있는 예외(그룹이 raw 정규화 키로 묶인 경우)만 기존 로직을 유지한다.
    const displayName = (classification.type === "stylist" && group.matchKey)
      ? group.matchKey
      : buildClientDisplayName(representativeRawName, classification);

    const purchaseDetails = [
      ...offlinePositiveLines.map((line) => {
        // STEP63-3: 원본 brand(ECOUNT brandGroup, operational metadata)는 절대 덮어쓰지
        // 않는다 — STEP63-2/62-2B의 Integrated Identity Pipeline을 productName 기준으로만
        // 돌려서 canonical 필드를 "추가"한다. Priority 3(Reviewed Brand Alias)는 아직 승인된
        // alias가 없어 사실상 항상 통과하지 못하고, Priority 2(Product Name Resolver)는
        // 온라인 카탈로그 2차 조회 없이 Brand Master 직접 일치만 시도한다(불필요한 Cafe24
        // API 재호출을 피하기 위한 의도적 축소 — work/reports/STEP63-3.md 4번 항목 참고).
        // 그 결과 confidence는 대부분 "CANDIDATE"이며, STEP63-1 Confidence Contract에 따라
        // 프론트엔드는 VERIFIED/REVIEWED가 아니면 이 canonical 값을 화면에 표시하지 않는다
        // (표시 여부 판단은 UI 책임 — 여기서는 판정 결과를 있는 그대로 전달만 한다).
        const identity = resolveIdentity(
          { productName: line.productName, brandGroup: line.brandGroup || null },
          identityResolverContext
        );
        return {
          date: line.date || null,
          orderId: line.slipNo || line.documentNo || null,
          productName: line.productName || null,
          // STEP62-1: ECOUNT 판매 라인이 이미 갖고 있는 brandGroup 필드를 그대로 노출한다(새 계산/
          // 추론 없음 — line.productName을 파싱해 브랜드를 추측하지 않는다). STEP63-3에서도 이
          // 필드는 원본 그대로 유지한다(canonical 값으로 덮어쓰지 않음).
          brand: line.brandGroup || null,
          canonicalBrandCode: identity.resolved ? identity.brand.brandCode : null,
          canonicalBrandName: identity.resolved ? identity.brand.canonicalName : null,
          brandConfidence: identity.resolved ? identity.brand.confidence : null,
          operationalBrandGroup: identity.operational.brandGroup,
          quantity: Number.isFinite(line.quantity) ? line.quantity : null,
          salesAmount: Number.isFinite(Number(line.salesAmount)) ? Number(line.salesAmount) : 0,
          source: "offline",
          // TASK5(2026-07-17 최종 정정): aliasStats(원본 판매명별 건수/매출/최근구매일) 계산을 위해
          // 이 판매행 자신의 실제 원본 거래처명(ECOUNT customerName)을 그대로 보존한다 — 추측하지
          // 않고 실제 필드값만 사용한다는 요구사항에 따름.
          rawName: line.customerName || null
        };
      }),
      ...onlineOrdersInPeriod.map((order) => ({
        date: order.orderDate || null,
        orderId: order.orderId || null,
        // Cafe24 개인결제창 주문의 상품명은 "이름 개인결제창 [날짜]" 형태의 결제 식별용 텍스트일 뿐
        // 실제 구매 제품명이 아니다(intelligence-service.mjs 상단 설계 전제 참고) — 실제 제품 데이터가
        // 없는 거래이므로 추측하지 않고 productName은 null로 두고(화면에서 "제품 정보 없음" 표시),
        // 거래 자체는 버리지 않는다.
        productName: null,
        // Cafe24 개인결제창 주문 원본에는 브랜드 필드가 없다(정규화 함수 normalizeCafe24ProxyOrder/
        // normalizeCafe24CsvOrder 확인) — 추측하지 않고 null로 둔다(화면 "브랜드 정보 없음" 표시).
        brand: null,
        // STEP63-3: 온라인(개인결제창) 주문은 실제 물리 상품 정보 자체가 없어(Cafe24 placeholder
        // 상품, STEP62-3에서 이미 확인) canonical 조회를 시도하지 않는다 — 새 추론 금지.
        canonicalBrandCode: null,
        canonicalBrandName: null,
        brandConfidence: null,
        operationalBrandGroup: null,
        quantity: Number.isFinite(order.quantity) ? order.quantity : null,
        salesAmount: Number.isFinite(order.paidAmount) ? order.paidAmount : 0,
        source: "online",
        // 온라인 개인결제창 주문의 "원본명"은 결제 식별 텍스트(personalPaymentProductName) 그대로다.
        rawName: order.personalPaymentProductName || null
      }))
    ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    const products = summarizeClientProducts(purchaseDetails);
    const purchaseDateCounts = summarizePurchaseDateCounts(purchaseDetails);

    clients.push({
      clientId: clientIdFromMatchKey(group.mergeKey),
      name: displayName,
      clientType: classification.type,
      salesStaff: classification.salesStaff || null,
      contact: null,
      latestPurchaseDate: latestDates.length ? latestDates.at(-1) : null,
      purchaseCount,
      onlineSales,
      offlineSales,
      totalSales,
      avgOrderValue: purchaseCount > 0 ? totalSales / purchaseCount : null,
      aliases: [...group.aliases],
      purchaseDetails,
      purchaseDateCounts,
      products
    });
  }

  const totalClients = clients.length;
  const totalPurchaseCount = clients.reduce((sum, client) => sum + client.purchaseCount, 0);
  const totalSalesAmount = clients.reduce((sum, client) => sum + client.totalSales, 0);
  const avgOrderValue = totalPurchaseCount > 0 ? totalSalesAmount / totalPurchaseCount : null;
  const totalOnlineSalesAmount = clients.reduce((sum, client) => sum + client.onlineSales, 0);
  const totalOfflineSalesAmount = clients.reduce((sum, client) => sum + client.offlineSales, 0);

  // STEP19-C(2026-07-27): Today와 동일한 정의로 온라인 주문수/판매수량을 계산한다 —
  // "매칭된 고객" 여부와 무관하게 기간 내 전체 Cafe24 온라인 주문(취소/환불 제외, 이미
  // normalizeCafe24CsvOrder/normalizeCafe24ProxyOrder에서 제외됨) 기준. 정책7: 온라인
  // 주문수 = Cafe24 order_id 고유 개수. 정책8: 온라인 판매수량 = 품목별 수량 합.
  // STORE-BATCH-D: Store Focus Mode에서는 온라인 요약 지표(주문수/수량/적립금/배송비) 전체가
  // 대상 밖이다 — 0으로 확정하지 않고 아예 빈 윈도우로 둔다(meta.storeCode로 UI가 구분).
  const onlineOrdersInWindow = storeCode ? [] : cafe24PersonalPaymentOrders.filter((order) => order.orderDate >= since && order.orderDate <= until);
  const onlineOrderIdSet = new Set(onlineOrdersInWindow.map((order) => String(order.orderId ?? clientOrderDedupeKey(order))));
  const onlineOrderCount = onlineOrderIdSet.size;
  const onlineQuantity = onlineOrdersInWindow.reduce((sum, order) => sum + (Number.isFinite(order.quantity) ? order.quantity : 0), 0);

  // 정책1/2: 적립금 사용액은 매출에서 차감하지 않고 별도 부가 지표로만 제공한다. 정책4: 배송비도
  // 매출과 분리해 별도 집계한다. 두 값 모두 "실제 원본 필드가 있는 주문에서만" 합산하고, 필드
  // 자체가 없는 주문(과거월 CSV — 실측으로 확인된 데이터 공백)은 unavailable 건수로만 카운트해
  // 추측/기본값 처리를 하지 않는다.
  let pointsUsedAmount = 0;
  let pointsUsedOrderCount = 0;
  let pointsUsedFieldUnavailableOrderCount = 0;
  let shippingAmount = 0;
  let shippingFieldUnavailableOrderCount = 0;
  for (const order of onlineOrdersInWindow) {
    if (order.pointsUsedAmount === null || order.pointsUsedAmount === undefined) {
      pointsUsedFieldUnavailableOrderCount += 1;
    } else if (order.pointsUsedAmount > 0) {
      pointsUsedAmount += order.pointsUsedAmount;
      pointsUsedOrderCount += 1;
    }
    if (order.shippingAmount === null || order.shippingAmount === undefined) {
      shippingFieldUnavailableOrderCount += 1;
    } else if (order.shippingAmount > 0) {
      shippingAmount += order.shippingAmount;
    }
  }

  // 정책5/6: 오프라인 주문수 = ECOUNT 고유(날짜+전표번호) 조합 개수, 오프라인 판매수량 = 라인별
  // 수량 합. Clients의 고객별 집계(위 for-loop)는 기프트 판매행을 표시 목적상 제외하지만, 이
  // 전체 합계는 Today의 offlineSales 계산 기준(isOfflineRevenue 플래그만)과 동일하게 맞춰
  // Today와 정확히 대조 가능하도록 별도로 계산한다.
  const offlineOrderKeySet = new Set();
  let offlineQuantity = 0;
  for (const [, lines] of ecountClients) {
    for (const line of lines) {
      if (line?.isOfflineRevenue !== true) continue;
      if (storeCode && line?.storeCode !== storeCode) continue;
      const date = String(line?.date || "");
      if (!(date >= since && date <= until)) continue;
      offlineOrderKeySet.add(`${date}::${line?.slipNo || line?.documentNo || ""}`);
      if (Number.isFinite(line.quantity)) offlineQuantity += line.quantity;
    }
  }
  const offlineOrderCount = offlineOrderKeySet.size;

  // STORE-BATCH-D: storeCode 지정 시, 이 기간에 그 매장의 분리 업로드가 실제로 있었는지
  // 알려준다 — 없으면 위 집계 결과(0명/0원)가 "진짜 0"이 아니라 "미업로드"일 수 있다는
  // 신호를 UI가 받아 정직하게 "데이터 없음"으로 보여줄 수 있게 한다.
  let storeCoverage = null;
  if (storeCode) {
    const monthKeys = new Set();
    for (let cursor = since.slice(0, 7); cursor <= until.slice(0, 7);) {
      monthKeys.add(cursor);
      const [year, month] = cursor.split("-").map(Number);
      const next = new Date(year, month, 1);
      cursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    }
    const includedMonths = [];
    const missingMonths = [];
    for (const month of [...monthKeys].sort()) {
      const snapshot = await readEcountOfflineSalesSnapshot(month, { workDir: options.workDir || workRoot, storeCode });
      if (snapshot) includedMonths.push(month);
      else missingMonths.push(month);
    }
    storeCoverage = { storesIncluded: includedMonths.length ? [storeCode] : [], includedMonths, missingMonths };
  }

  const typeBreakdown = CLIENT_TYPE_ORDER.map((type) => {
    const rows = clients.filter((client) => client.clientType === type);
    const purchaseCount = rows.reduce((sum, client) => sum + client.purchaseCount, 0);
    const salesAmount = rows.reduce((sum, client) => sum + client.totalSales, 0);
    return {
      type,
      label: CLIENT_TYPE_LABELS[type],
      clientCount: rows.length,
      purchaseCount,
      salesAmount,
      ratioPct: totalPurchaseCount > 0 ? (purchaseCount / totalPurchaseCount) * 100 : 0
    };
  });

  const rankSort = (a, b) => (
    (b.totalSales - a.totalSales) ||
    (b.purchaseCount - a.purchaseCount) ||
    a.name.localeCompare(b.name, "ko")
  );
  const toTop10Row = (client) => ({
    clientId: client.clientId,
    name: client.name,
    purchaseCount: client.purchaseCount,
    salesAmount: client.totalSales,
    purchaseDateCounts: client.purchaseDateCounts,
    products: client.products
  });
  const stylistTop10 = clients.filter((client) => client.clientType === "stylist").sort(rankSort).slice(0, 10).map(toTop10Row);
  const pressTop10 = clients.filter((client) => client.clientType === "samplas_press").sort(rankSort).slice(0, 10).map(toTop10Row);
  const ffTop10 = clients.filter((client) => client.clientType === "ff").sort(rankSort).slice(0, 10).map(toTop10Row);

  return {
    periodStart: since,
    periodEnd: until,
    storeCode,
    storeCoverage,
    summary: {
      totalClients,
      totalPurchaseCount,
      totalSalesAmount,
      avgOrderValue,
      // STEP19-C(2026-07-27) 추가 필드: Today와 동일 기간에 대해 대조 가능한 온라인/오프라인
      // 분리 매출, 주문수, 판매수량, 그리고 매출과 분리된 적립금/배송비 부가 지표.
      onlineSalesAmount: totalOnlineSalesAmount,
      offlineSalesAmount: totalOfflineSalesAmount,
      orderCount: onlineOrderCount + offlineOrderCount,
      onlineOrderCount,
      offlineOrderCount,
      quantity: onlineQuantity + offlineQuantity,
      onlineQuantity,
      offlineQuantity,
      pointsUsedAmount,
      shippingAmount
    },
    typeBreakdown,
    stylistTop10,
    pressTop10,
    ffTop10,
    clients,
    // TASK3(2026-07-17 최종 정정): 내부 검증용 — 기프트로 판정되어 이번 기간 집계(구매 건수/매출)에서
    // 제외된 판매행 수와 금액. Clients 화면/이 API 전용 필드이며 다른 화면 매출에는 전혀 영향 없다.
    // STEP19-C 추가: 적립금/배송비 원본 필드가 없는(과거월 CSV) 주문 건수 — 정책상 추측하지 않고
    // 있는 그대로 노출해 어떤 기간의 어떤 부가지표가 불완전한지 투명하게 드러낸다.
    meta: {
      excludedGiftCount,
      excludedGiftSalesAmount,
      pointsUsedOrderCount,
      pointsUsedFieldUnavailableOrderCount,
      shippingFieldUnavailableOrderCount
    }
  };
}

export async function buildClientSummaries(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const currentMonth = options.currentMonth || clientsIntelligenceMonthKey(now);

  const ecountClients = await loadEcountClientLines();
  const cafe24PersonalPaymentOrders = await loadCafe24PersonalPaymentOrders({ currentMonth });

  const mergedClients = new Map();
  for (const [rawName, lines] of ecountClients) {
    const entity = classifyClientEntity(rawName);
    if (entity.entityType !== "client") continue;
    const classification = classifyClientType(rawName);
    const matchKey = extractClientMatchKey(rawName);
    const mergeKey = clientMergeKey(rawName, classification, matchKey);
    if (!mergedClients.has(mergeKey)) {
      mergedClients.set(mergeKey, {
        mergeKey,
        classification,
        matchKey,
        aliases: [],
        aliasSet: new Set(),
        lines: [],
        orders: new Map()
      });
    }
    const group = mergedClients.get(mergeKey);
    if (!group.aliasSet.has(rawName)) {
      group.aliasSet.add(rawName);
      group.aliases.push(rawName);
    }
    group.lines.push(...lines);
  }
  assignCafe24OrdersToClientGroups(mergedClients, cafe24PersonalPaymentOrders);

  const summaries = [...mergedClients.values()].map((group) => {
    const representativeRawName = selectRepresentativeClientRawName(group.aliases);
    const classification = group.classification;
    const matchedOrders = [...group.orders.values()];
    const monthlySales = matchedOrders
      .filter((order) => order.monthKey === currentMonth)
      .reduce((sum, order) => sum + order.paidAmount, 0);
    const lifetimeSales = matchedOrders.reduce((sum, order) => sum + order.paidAmount, 0);
    const purchaseCount = matchedOrders.length;
    const latestPurchaseDate = matchedOrders.reduce(
      (latest, order) => (!latest || order.orderDate > latest ? order.orderDate : latest),
      null
    );
    return {
      clientId: clientIdFromMatchKey(group.mergeKey),
      rawName: representativeRawName,
      aliases: group.aliases,
      displayName: buildClientDisplayName(representativeRawName, classification),
      clientType: classification.type,
      salesStaff: classification.salesStaff || null,
      monthlySales,
      lifetimeSales,
      purchaseCount,
      latestPurchaseDate,
      recentItems: buildClientRecentItems(group.lines)
    };
  });

  summaries.sort((a, b) => (b.monthlySales || 0) - (a.monthlySales || 0));
  return summaries;
}

function clientsIntelligenceMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function clientIdFromMatchKey(matchKey) {
  return `client_${createHash("sha1").update(String(matchKey || "")).digest("hex").slice(0, 12)}`;
}

// 제품 TOP N(구매 상세 호버)용 집계: 수량 내림차순 -> 매출액 내림차순 -> 제품명 오름차순.
// productName이 없는 거래(Cafe24 개인결제창 온라인 거래는 실제 제품명이 없음)는 버리지 않고
// "제품 정보 없음" 한 항목으로 합산한다.
function summarizeClientProducts(purchaseDetails = []) {
  const map = new Map();
  for (const detail of purchaseDetails) {
    const key = detail.productName || "__NONE__";
    if (!map.has(key)) {
      map.set(key, { productName: detail.productName || "제품 정보 없음", quantity: 0, purchaseCount: 0, salesAmount: 0, sources: new Set() });
    }
    const row = map.get(key);
    row.quantity += Number.isFinite(detail.quantity) ? detail.quantity : 0;
    row.purchaseCount += 1;
    row.salesAmount += Number.isFinite(detail.salesAmount) ? detail.salesAmount : 0;
    if (detail.source) row.sources.add(detail.source);
  }
  return [...map.values()]
    .map((row) => ({
      productName: row.productName,
      quantity: row.quantity,
      purchaseCount: row.purchaseCount,
      salesAmount: row.salesAmount,
      // 이 제품이 온라인/오프라인 한쪽에서만 발생했으면 표시하고, 두 경로 모두에서 섞여
      // 발생했으면(드묾) 어느 한쪽으로 단정하지 않고 null로 둔다.
      source: row.sources.size === 1 ? [...row.sources][0] : null
    }))
    .sort((a, b) => (
      (b.quantity - a.quantity) ||
      (b.salesAmount - a.salesAmount) ||
      a.productName.localeCompare(b.productName, "ko")
    ));
}

// TOP10/목록 호버의 "구매일" 표시용: 날짜별 구매 건수를 오름차순으로 반환한다.
// 프론트엔드에서 최근 5개만 남기고 나머지는 "외 N일"로 축약한다.
function summarizePurchaseDateCounts(purchaseDetails = []) {
  const map = new Map();
  for (const detail of purchaseDetails) {
    const date = detail.date;
    if (!date) continue;
    map.set(date, (map.get(date) || 0) + 1);
  }
  return [...map.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

// STEP67-6: Brand Intelligence Customer Composition이 이 두 분류 함수를 그대로 재사용한다
// (export만 추가, 분류 규칙 변경 없음 — Clients 화면과 동일한 canonical classification).
export function classifyClientEntity(rawName) {
  const text = String(rawName || "").trim();
  if (CLIENT_LOGISTICS_NAMES.has(text)) return { entityType: "logistics" };
  return { entityType: "client" };
}

// Client Type 규칙 (2026-07-17 마지막 정정 — alias 화이트리스트로 되돌림, 우선순위 순서대로 검사):
// 1) 물류 등 고객이 아닌 엔티티는 classifyClientEntity()에서 이미 제외됨(이 함수 호출 전)
// 2) "온라인 첫가입" 정확 예외(우혁 판매 온라인 첫 가입 / 제품 하자류) -> online_first_signup
//    (TAXFREE, "OO님 판매" 화이트리스트 규칙보다 반드시 먼저 판정)
// 3) 기프트 판매행 제외는 classifyClientType() 밖(buildClientsOverview의 isGiftSalesLine 필터,
//    판매행 단위)에서 처리한다 — 엔티티 유형 판정과는 독립적인 라인 필터라 여기 포함하지 않는다.
// 4) 거래처명에 "TAXFREE" 포함 -> foreign (같은 이름이라도 TAXFREE가 있으면 무조건 이 규칙이 이김)
// 5) CLIENT_TYPE_GENERIC_CUSTOMER_SALES_ALIASES 화이트리스트(9개 "OO님 판매" 문자열, 정확히 일치)
//    -> customer(일반 고객). 정규식 일반화가 아니라 실제 확인된 이름만 등록한 목록이라, 목록에 없는
//    새로운 "OO님 판매"는 이 규칙에 걸리지 않고 아래 fallback(9번, samplas_press)으로 그대로 빠진다
//    — 향후 새 이름을 일반 고객으로 편입하려면 이 배열에 문자열을 수동으로 추가해야 한다.
// 6) "일반 고객"/"매장방문고객" 계열 변형(공백 차이만) -> customer로 통합
// 7) 거래처명에 "실장"/"스타일리스트"/"팀"/"어시" 포함, 또는 "이름 + 이사(님)?" 직책 패턴 -> stylist
// 8) 거래처명이 RULE3 문자열과 정확히 일치 -> customer (salesStaff는 이름만 별도 저장; 5번 화이트
//    리스트가 같은 9개 문자열을 먼저 가로채므로 RULE3 목록의 "OO님 판매" 항목들은 사실상 도달하지
//    않는다 — 죽은 코드지만 안전을 위해 그대로 남겨둔다)
// 9) 그 외 -> samplas_press (fallback, 화이트리스트에 없는 새 "OO님 판매"도 여기로 떨어짐)
export function classifyClientType(rawName) {
  const text = String(rawName || "");
  const explicit = explicitClientTypeOverride(text);
  if (explicit) return explicit;
  if (isOnlineFirstSignupRawName(text)) return { type: "online_first_signup", salesStaff: null };
  if (text.includes("TAXFREE")) return { type: "foreign", salesStaff: null };
  // 2026-07-17 마지막 정정: "OO님 판매" 일반화 정규식을 철회하고, 실제 확인된 9개 alias만
  // 정확히 일치하는 경우에만 일반 고객으로 분류한다(오분류 위험 방지, 사용자 명시 요청).
  // TAXFREE가 붙은 경우는 위에서 이미 foreign으로 확정되어 여기 도달하지 않는다.
  if (isGenericCustomerSalesRawName(text)) return { type: "customer", salesStaff: null, genericCustomer: true };
  if (isGenericCustomerRawName(text)) return { type: "customer", salesStaff: null, genericCustomer: true };
  // 2026-07-17 최종 정정(실장 규칙 강화): 기존에는 "실장님"(님 포함)만 검사해 "전예린 실장"처럼
  // 님이 생략된 실제 표기가 프레스로 새는 문제가 있었다(실측 확인: "개인결제창 전예린 실장",
  // "오주현 실장", "최제윤 실장" 3건 실제 존재, 전부 인명+직책 형태이고 문장형 메모와 혼동될 여지 없음).
  // "실장" 하나로 검사하면 "실장님"도 당연히 포함되므로 별도 분기 없이 통합한다. "어시/어시스턴트"는
  // 사용자가 요청한 동일 계층 직책이나 현재 실데이터에는 해당 문자열이 없어(실측 확인) 영향 없이
  // 안전하게 추가만 해 둔다.
  if (text.includes("실장") || text.includes("스타일리스트") || text.includes("팀") || text.includes("어시")) {
    return { type: "stylist", salesStaff: null };
  }
  if (isStylistTitleRawName(text)) return { type: "stylist", salesStaff: null };
  if (CLIENT_TYPE_RULE3_EXACT_NAMES.includes(text)) {
    const match = text.match(/^(.+?)님\s*판매$/);
    const salesStaff = match ? match[1] : null;
    // 2026-07-17 보완: 윤재/영은/민철 판매명은 "일반 고객" 통합 대상이므로 매장방문고객
    // 계열과 동일한 genericCustomer 플래그를 붙여 clientMergeKey/buildClientDisplayName이
    // 하나의 고정 키·표시명으로 병합하도록 한다(애림/우혁/준희는 이 분기에 도달하지 않음).
    const isGenericStaff = Boolean(salesStaff && CLIENT_TYPE_GENERIC_CUSTOMER_STAFF_NAMES.has(salesStaff));
    return { type: "customer", salesStaff, genericCustomer: isGenericStaff };
  }
  if (text === "매장방문고객") return { type: "customer", salesStaff: null };
  if (isFfPurchaseRawName(text)) return { type: "ff", salesStaff: null };
  return { type: "samplas_press", salesStaff: null };
}

function clientMergeKey(rawName, classification, matchKey) {
  // TASK1: "일반 고객"/"매장방문고객" 계열은 공백 차이 때문에 extractClientMatchKey()의
  // 첫 토큰이 서로 달라질 수 있어(예: "매장 방문 고객" -> "매장") matchKey에 의존하지 않고
  // 고정된 병합 키 하나로 강제 통합한다.
  if (classification.genericCustomer) return "customer:generic_customer";
  // 2026-07-17 최종 정정(외국인 대표 엔티티 통합): classifyClientType()이 "foreign"으로 판정한
  // 모든 rawName(TAXFREE 계열 전체 + 준희/애림/우혁/민철 판매 명시 규칙)을 개인별 매칭키와
  // 무관하게 고정 mergeKey 하나로 강제 병합한다 — 온라인 첫가입(online_first_signup)과 기프트는
  // classifyClientType()에서 이미 별도 유형/버킷으로 분리되어 이 분기에 도달하지 않으므로 영향 없다.
  if (classification.type === "foreign") return "foreign:generic_foreign";
  if (classification.salesStaff) return `${classification.type}:staff:${normalizeClientIdentityKey(classification.salesStaff)}`;
  if (matchKey) return `${classification.type}:${matchKey}`;
  return `${classification.type}:raw:${normalizeClientIdentityKey(rawName)}`;
}

function clientOrderMatchKey(classification, matchKey) {
  if (classification.salesStaff) return "";
  if (classification.type === "customer" && !matchKey) return "";
  return matchKey;
}

function clientOrderDedupeKey(order) {
  return String(order?.orderId || `${order?.orderDate || ""}:${order?.paidAmount || 0}:${order?.personalPaymentProductName || ""}`);
}

// 2026-07-17 최종 정정(TASK3 보완, 실측으로 발견): 같은 그룹(mergeKey) 안에 "위뎀보이즈 바타
// 기프트"처럼 기프트 라인의 rawName과 "위뎀보이즈"/"위뎀보이즈 호준님" 등 정상 판매 rawName이
// 함께 alias로 섞여 있으면, 기존에는 "더 긴 문자열"을 대표로 뽑다 보니 "기프트"라는 글자가
// 붙어 더 길어진 기프트 쪽 이름이 대표 표시명으로 잘못 선택됐다(집계 금액/건수 자체는 이미
// TASK3에서 그 판매행만 정확히 제외돼 있었지만, 화면에 보이는 이름이 "OOO 기프트"로 나와
// "기프트가 그대로 남아있다"는 오해를 줄 수 있었다). aliases 배열 자체(요구사항상 보존 대상)는
// 건드리지 않고, 대표 이름 선택 시에만 기프트 표기가 아닌 alias를 우선한다 — 모든 alias가
// 기프트뿐인 경우(이론상 존재해도 그 그룹은 purchaseCount 0으로 이미 걸러짐)에 한해 원래
// 로직(전체 중 최장 문자열)으로 안전하게 폴백한다.
function selectRepresentativeClientRawName(aliases = []) {
  const byLengthDesc = (left, right) => (
    String(right || "").length - String(left || "").length ||
    String(left || "").localeCompare(String(right || ""))
  );
  const nonGiftAliases = aliases.filter((alias) => !String(alias || "").includes("기프트"));
  const pool = nonGiftAliases.length ? nonGiftAliases : aliases;
  return [...pool].sort(byLengthDesc)[0] || "";
}

function buildClientDisplayName(rawName, classification = classifyClientType(rawName)) {
  // TASK1: "일반 고객"/"매장방문고객" 계열 변형은 원본 표기와 무관하게 대표 이름을 "일반 고객"
  // 하나로 고정한다(기존에는 "매장방문고객"만 원문 그대로 표시하던 특례가 있었으나, 이번 정정으로
  // 두 계열 모두 동일한 대표 고객 한 행으로 병합되므로 표시명도 통일한다).
  if (classification.genericCustomer) return "일반 고객";
  if (classification.type === "customer") {
    if (String(rawName || "").trim() === "매장방문고객") return "매장방문고객";
    if (classification.salesStaff) return "일반 고객";
  }
  let text = String(rawName || "");
  if (classification.type === "online_first_signup") {
    text = cleanClientNameText(text);
    return text || "온라인 첫가입 고객";
  }
  if (classification.type === "foreign") {
    // 2026-07-17 최종 정정: 애림/민철/준희/우혁 등 개인별 이름을 남기지 않고 대표 표시명을
    // "외국인" 하나로 고정한다(clientMergeKey도 동일하게 foreign:generic_foreign 고정 키를 쓰므로
    // 표시명과 병합 키가 항상 일치한다). 원본 이름은 aliases에 그대로 보존되어 상세 창/검색에서 확인 가능.
    return "외국인";
  }
  if (classification.type === "stylist") {
    // TASK4: "이름 + 이사(님)?" 패턴에 매치된 경우에만 끝의 직책을 제거한다(패턴 밖의 텍스트에는
    // 영향 없음 — isStylistTitleRawName()이 내부에서 다시 검사하므로 여기서 무조건 치환하지 않는다).
    // 2026-07-17 최종 정정: "실장님"보다 "실장"을 먼저 매치하면 "님"이 남을 수 있어 알파벳(문자)
    // 순서가 아니라 긴 패턴("실장님"/"어시스턴트")을 짧은 패턴("실장"/"어시")보다 먼저 두어
    // 정규식 대체가 항상 전체 직책을 제거하도록 한다.
    text = stripStylistTitleSuffix(text);
    text = cleanClientNameText(text.replace(/실장님|실장|스타일리스트|어시스턴트|어시/g, " "));
    return text || "Stylist Client";
  }
  text = cleanClientNameText(text);
  return text || "SAMPLAS PRESS";
}

function cleanClientNameText(value) {
  return String(value || "")
    .replace(/개인\s*결제창|개인결제창|개인결제/g, " ")
    .replace(/[()]/g, " ")
    .replace(/님/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeClientIdentityKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
}

function buildClientRecentItems(lines = []) {
  const seen = new Set();
  const rows = [];
  for (const line of [...lines].sort((a, b) => String(b?.date || "").localeCompare(String(a?.date || "")))) {
    const key = [
      line?.date || "",
      line?.productName || "",
      line?.specification || "",
      line?.brandGroup || "",
      Number.isFinite(line?.quantity) ? line.quantity : "",
      Number.isFinite(line?.salesAmount) ? line.salesAmount : ""
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      brand: line?.brandGroup || null,
      product: line?.productName || null,
      size: line?.specification || null,
      quantity: Number.isFinite(line?.quantity) ? line.quantity : null,
      date: line?.date || null
    });
    if (rows.length >= 5) break;
  }
  return rows;
}

// ECOUNT customerName과 Cafe24 개인결제창 상품명을 같은 인물로 매칭하기 위한 정규화 키.
// 괄호/날짜(YY.MM.DD)/개인결제창 관련 단어/조사(님)를 제거한 뒤 첫 토큰(이름)을 매칭 키로 쓴다.
function extractClientMatchKey(text) {
  let value = String(text || "");
  // 괄호는 "괄호 안에 실제 이름이 들어있는" 표기(예: "개인결제창 (최재은 실장님)")가 실제로 존재하므로
  // 내용째 지우지 않고 괄호 문자만 제거해 안쪽 텍스트를 남긴다("이름 (지점명)" 형태에서도 첫 토큰은
  // 항상 이름이므로 안전하다).
  value = value.replace(/[()]/g, " ");
  value = value.replace(/\d{2}\.\d{2}\.\d{2}(-\d+)?/g, " ");
  value = value.replace(/개인\s*결제창|개인결제/g, " ");
  value = value.replace(/실장님|스타일리스트|팀장님|팀원|TAXFREE|판매|구매|지인|기프트|픽업|팀/g, " ");
  value = value.replace(/님/g, " ");
  value = value.replace(/[/\-,]/g, " ");
  value = value.replace(/\s+/g, " ").trim();
  const firstToken = value.split(" ")[0] || "";
  return firstToken.length >= 2 ? firstToken : "";
}

// work/ecount-sales/*.json 전체를 읽어 customerName(거래처명) 문자열 그대로를 client 그룹 키로 사용한다.
// STORE-BATCH-B: 파일을 직접 파싱하지 않고 readEcountOfflineSalesSnapshot()(매장별 분리
// 스냅샷 병합 + 레거시 단일 파일 fallback을 이미 처리하는 공용 리더)을 월별로 호출한다 —
// 어떤 월이 존재하는지만 디렉터리에서 찾고(레거시 "{month}.json"과 신규
// "{month}.{storeCode}.json" 파일명 둘 다에서 월을 추출), 실제 라인 읽기/병합/storeCode
// 보존은 전부 그 공용 리더에 위임한다(로직 중복 없음).
// STORE-BATCH-D: workDirOverride는 테스트 격리용(생략 시 기존과 동일하게 workRoot 사용) —
// readEcountOfflineSalesSnapshot/buildCanonicalTotalSales와 같은 패턴.
async function loadEcountClientLines(workDirOverride) {
  const effectiveWorkDir = workDirOverride || workRoot;
  const dir = join(effectiveWorkDir, "ecount-sales");
  const names = await safeReaddir(dir);
  const months = new Set();
  for (const name of names) {
    const match = name.match(/^(\d{4}-\d{2})(?:\.[A-Z0-9_]+)?\.json$/);
    if (match) months.add(match[1]);
  }
  const clients = new Map();
  for (const month of [...months].sort()) {
    const snapshot = await readEcountOfflineSalesSnapshot(month, { workDir: effectiveWorkDir });
    if (!snapshot) continue;
    const lines = Array.isArray(snapshot?.salesLines)
      ? snapshot.salesLines
      : Array.isArray(snapshot?.rows)
        ? snapshot.rows
        : [];
    for (const line of lines) {
      const rawName = String(line?.customerName ?? "").trim();
      if (!rawName) continue;
      if (!clients.has(rawName)) clients.set(rawName, []);
      clients.get(rawName).push(line);
    }
  }
  return clients;
}

// STEP19-C(2026-07-27) 이전에는 "개인결제창" 상품명이 포함된 주문만 추출했다(함수명 그대로).
// STEP19-C 정책("Clients는 Cafe24 온라인 주문 전체를 커버해야 하고 어떤 온라인 주문도 제외될 수
// 없다")에 따라 이제는 취소/환불이 아닌 모든 Cafe24 온라인 주문을 추출하도록 역할을 최소 확장했다
// (함수명은 기존 호출부를 깨지 않기 위해 그대로 유지). 개인결제창 여부(isPersonalPayment)는 여전히
// 판별해 반환하므로, 기존 "개인결제창 주문 -> 기존 ECOUNT 고객 매칭" 로직(clientOrderMatchKey 등)은
// 전혀 변경하지 않고 그대로 재사용할 수 있다.
//
// STEP20(2026-07-27) Clients Cafe24 캐시 소스 통합 — 실측 확인된 문제: Render는
// cafe24Mode: "local_oauth"(직접 모드)로 동작하고, 직접 모드에서 실시간으로 가져온 당월
// 주문은 server.mjs의 fetchCafe24Orders()가 "cafe24-orders-{start}_{end}.json"으로
// 저장한다(server.mjs 1406행). 반면 이 함수는 지금까지 "cafe24-proxy-orders-{월}-01_*"
// 접두사만 찾았기 때문에, 직접 모드에서 만들어진 "cafe24-orders-" 캐시를 전혀 읽지 못해
// Clients 온라인 매출이 0으로 보이는 문제가 있었다. 두 접두사("cafe24-proxy-orders-",
// "cafe24-orders-")가 담는 주문 원본 JSON 구조는 동일하다 — 실측 확인(work/cafe24-proxy-orders-
// 2026-07-01_2026-07-27.json 샘플): order_id/order_date/billing_name/member_id/
// actual_order_amount.{points_spent_amount,credits_spent_amount,shipping_fee}/items 등
// 필드가 모두 동일한 Cafe24 Admin Orders API 원본 형태다("cafe24-proxy-orders-"는 로컬
// 개발 환경이 Render의 /api/cafe24/orders를 호출해 받은 응답을 그대로 캐싱한 것이고, 그
// /api/cafe24/orders 라우트 자체가 내부적으로 fetchCafe24Orders()의 직접 모드 결과를 그대로
// 반환하기 때문이다 — server.mjs 147-154행). 따라서 정규화 함수는 기존 normalizeCafe24ProxyOrder
// 하나만 그대로 재사용하고, 새 정규화 로직을 추가하지 않는다.
//
// 캐시 탐색·기간 필터·중복 제거·최신 레코드 선택은 server.mjs와 같은 canonical loader를
// 사용하고, 여기서는 Clients 전용 정규화만 수행한다.
async function loadCafe24PersonalPaymentOrders({ currentMonth, since, until } = {}) {
  const hasExplicitRange = isDateKey(since) && isDateKey(until);
  const rangeStart = hasExplicitRange ? since : null;
  const rangeEnd = hasExplicitRange ? until : null;
  const cached = await loadCanonicalCafe24OrderCache({ workDir: workRoot, since: rangeStart, until: rangeEnd });
  const orders = cached.records
    .map(({ order, type }) => type === "csv" ? normalizeCafe24CsvOrder(order) : normalizeCafe24ProxyOrder(order))
    .filter(Boolean);

  // matchKey: 개인결제창 주문에만 의미가 있다(기존 로직 그대로). 일반 주문은 matchKey가
  // 빈 문자열이며, 더 이상 여기서 걸러내지 않는다(과거에는 matchKey가 없으면 통째로
  // 버렸다 — 이것이 바로 "일반 온라인 주문이 Clients에서 전부 누락되는" 근본 원인이었다).
  return orders.map((order) => ({
    ...order,
    matchKey: order.isPersonalPayment ? extractClientMatchKey(order.personalPaymentProductName) : ""
  }));
}

// STEP49-2A-2 — options.cafe24Orders로 주입되는 라이브 주문(server.mjs fetchCafe24Orders() 결과)에도
// 위 캐시 경로가 이미 적용하는 canonical 전처리(정규화 → 유효 날짜 검사 → since~until 기간 필터 →
// order_id 기준 dedupe)를 그대로 적용해, 두 경로가 항상 같은 주문 집합을 계산하도록 맞춘다.
// - 정규화/유효 날짜 검사: normalizeCafe24ProxyOrder를 그대로 재사용한다(취소·환불 제외, 활성
//   품목 없는 주문 제외, 유효하지 않은 날짜 제외가 이미 이 함수 안에서 처리됨 — 새로 만들지 않음).
// - 기간 필터: loadCanonicalCafe24OrderCache가 파일 스캔 중 적용하는 것과 동일한
//   `orderDate < since` / `orderDate > until` 배제 규칙을 그대로 재사용한다.
// - dedupe: loadCanonicalCafe24OrderCache의 order_id dedupe는 "여러 캐시 파일 중 어느 파일이
//   더 최신인가"(fileEnd/mtimeMs/completeness)를 비교하는 다중 파일 전용 우선순위다. 이 주입
//   경로는 fetchCafe24Orders() 한 번의 결과(단일 소스)만 받으므로 비교할 파일이 없다 — 새
//   우선순위 정책을 만들지 않고, 같은 order_id가 두 번 나오면 나중 항목이 앞 항목을 덮어쓰는
//   최소 동작만 적용한다(key 없는 레코드는 기존 loadCanonicalCafe24OrderCache의 unkeyed 처리와
//   동일하게 dedupe 없이 그대로 둔다).
//
// [알려진 제한 — 이번 STEP 범위에서 해결하지 않음] 캐시 경로는 파일명 접두사(cafe24-csv-orders-
// vs cafe24-(proxy-)orders-)로 CSV 원본과 API/proxy 원본을 구분해 서로 다른 정규화 함수를 쓴다
// (바로 위 loadCafe24PersonalPaymentOrders의 `type === "csv" ? normalizeCafe24CsvOrder : ...`).
// fetchCafe24Orders()가 라이브 성공 시 반환하는 orders는 API/proxy 원본 하나뿐이라 문제없지만,
// fetchCafe24Orders()가 과거월이거나 라이브 실패로 디스크 캐시에 폴백하면(server.mjs
// readCachedCafe24Orders) 그 캐시에 CSV 원본이 섞여 있을 수 있다 — 다만 그 시점엔 이미 파일
// 단위 type 태그가 소실된 뒤라(server.mjs readCachedCafe24Orders가 raw order만 반환) 여기서는
// 어느 주문이 CSV 원본이었는지 알 방법이 없다. 이 정보를 살리려면 server.mjs가 type을 함께
// 넘기도록 고쳐야 하는데, 이번 STEP은 server.mjs 수정이 범위 밖이라 새 타입 감지 로직을
// 추측으로 만들지 않았다. normalizeCafe24ProxyOrder를 CSV 원본에 적용해도 실제 계산에 쓰이는
// paidAmount/orderDate/quantity/isPersonalPayment는 cafe24OrderAmount 등 공유 함수로 동일하게
// 나오지만, meta.shippingFieldUnavailableOrderCount(적립금/배송비 원본 필드가 없는 과거월 CSV
// 주문 건수 표시용) 하나만 그 좁은 경우에 부정확해질 수 있다 — 매출/주문수/고객 목록에는 영향 없음.
function canonicalizeCafe24ClientOrders(rawOrders = [], { since, until } = {}) {
  const deduped = new Map();
  const unkeyed = [];
  for (const rawOrder of rawOrders) {
    const normalized = normalizeCafe24ProxyOrder(rawOrder);
    if (!normalized) continue;
    if (since && normalized.orderDate < since) continue;
    if (until && normalized.orderDate > until) continue;
    if (normalized.orderId) {
      deduped.set(String(normalized.orderId), normalized);
    } else {
      unkeyed.push(normalized);
    }
  }
  return [...deduped.values(), ...unkeyed];
}

function safeReaddir(dir) {
  return readdir(dir).catch(() => []);
}

// cafe24-csv-orders-*.json 스키마: {order_id, order_date(YYYY-MM-DD), actual_payment_amount, items:[{productName, quantity}]}.
// 과거월 CSV 원본은 정확히 8개 컬럼만 담고 있어(실측 확인) member_id/email/points_spent_amount/
// credits_spent_amount/shipping_fee 등의 필드가 전혀 없다 — 없는 값을 추측하지 않고 null로 둔다.
export function normalizeCafe24CsvOrder(order) {
  if (isCafe24CanceledOrRefunded(order)) return null;
  const orderDate = trustedCafe24OrderDate(order) || String(order?.order_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) return null;
  const items = cafe24OrderItems(order);
  const activeItems = items.filter((item) => !isCafe24CanceledItem(item));
  if (!activeItems.length) return null;
  const ppItem = activeItems.find((item) => String(item?.productName || item?.product_name || "").includes("개인결제"));
  const paidAmount = cafe24OrderAmount(order);
  const quantity = activeItems.reduce((sum, item) => sum + cafe24ItemQuantity(item), 0);
  return {
    orderId: order?.order_id || null,
    orderDate,
    monthKey: orderDate.slice(0, 7),
    paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    isPersonalPayment: Boolean(ppItem),
    personalPaymentProductName: ppItem ? (ppItem.productName || ppItem.product_name || "") : "",
    // CSV 원본에는 이 필드들이 없다(실측 확인) — 추측/기본값 대신 명시적으로 unavailable 처리.
    pointsUsedAmount: null,
    shippingAmount: null,
    rawCustomerText: null
  };
}

// cafe24-proxy-orders-*.json 스키마: {order_id, order_date(ISO+TZ), payment_amount, member_id, member_email,
// billing_name, actual_order_amount:{points_spent_amount, credits_spent_amount, shipping_fee, ...}, items:[{product_name, quantity}]}
export function normalizeCafe24ProxyOrder(order) {
  if (isCafe24CanceledOrRefunded(order)) return null;
  const orderDate = trustedCafe24OrderDate(order) || String(order?.order_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) return null;
  const items = cafe24OrderItems(order);
  const activeItems = items.filter((item) => !isCafe24CanceledItem(item));
  if (!activeItems.length) return null;
  const ppItem = activeItems.find((item) => String(item?.product_name || item?.productName || "").includes("개인결제"));
  const paidAmount = cafe24OrderAmount(order);
  const quantity = activeItems.reduce((sum, item) => sum + cafe24ItemQuantity(item), 0);
  return {
    orderId: order?.order_id || null,
    orderDate,
    monthKey: orderDate.slice(0, 7),
    paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    isPersonalPayment: Boolean(ppItem),
    personalPaymentProductName: ppItem ? (ppItem.product_name || ppItem.productName || "") : "",
    pointsUsedAmount: cafe24PointsUsedAmount(order),
    shippingAmount: cafe24ShippingFee(order),
    // 일반 온라인 주문(개인결제창이 아닌 주문)의 실제 주문자 식별용 — 실측으로 확인된 필드만 사용,
    // 추측하지 않는다. 현재는 표시/향후 분류 참고용으로만 보존하고, 기존 분류 로직(classifyClientType)에는
    // 아직 연결하지 않는다(정책10: 기존 분류 정책을 임의로 바꾸지 않는다).
    rawCustomerText: order?.billing_name || order?.member_id || order?.member_email || null
  };
}

async function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return { ...process.env };
  const text = await readFile(envPath, "utf8");
  const parsed = { ...process.env };
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
