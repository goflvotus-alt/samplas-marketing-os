import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir as fsReaddir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(".");
const outputDir = join(root, "outputs");
const env = await loadEnv();
const workDir = resolve(env.WORK_DIR || join(root, "work"));
const cafe24TokenStoreDir = resolve(env.CAFE24_TOKEN_STORE_DIR || join(workDir, "secrets"));
const cafe24TokenStoreFile = join(cafe24TokenStoreDir, "cafe24-token-store.json");
const port = Number(env.PORT || 8787);
const host = env.HOST || "127.0.0.1";
const graphVersion = env.GRAPH_VERSION || "v25.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/") {
      return serveFile(res, join(outputDir, "samplas-marketing-os.html"));
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/api/status") {
      const integrations = integrationStatus();
      const cafe24Token = await cafe24TokenDiagnostics();
      return json(res, {
        instagram: integrations.instagram.ok,
        metaAds: integrations.metaAds.ok,
        cafe24: integrations.cafe24.ok,
        instagramSync: {
          lastAttemptAt: instagramSyncScheduler.lastAttemptAt,
          lastSuccessAt: instagramSyncScheduler.lastSuccessAt,
          lastError: instagramSyncScheduler.lastError,
          intervalMs: instagramSyncScheduler.intervalMs
        },
        environment: integrations,
        pageId: env.FACEBOOK_PAGE_ID || null,
        instagramBusinessAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID || null,
        metaAdAccountId: cleanAdAccountId() || null,
        cafe24MallId: env.CAFE24_MALL_ID || null,
        cafe24Mode: env.CAFE24_PROXY_BASE_URL ? "proxy" : "local_oauth",
        cafe24ProxyBaseUrl: env.CAFE24_PROXY_BASE_URL || null,
        cafe24Token,
        username: env.SAMPLAS_INSTAGRAM_USERNAME || "samplaskr",
        graphVersion
      });
    }
    if (url.pathname === "/api/instagram/monthly") {
      const month = url.searchParams.get("month") || currentMonth();
      const refresh = url.searchParams.get("refresh") === "1";
      const data = await buildInstagramMonthlyDataWithCache(month, { refresh });
      return json(res, data);
    }
    if (url.pathname === "/api/instagram/stories") {
      const refresh = url.searchParams.get("refresh") === "1";
      const data = await buildInstagramStoriesDataWithCache({ refresh });
      return json(res, data);
    }
    if (url.pathname === "/api/meta-ads/summary") {
      const data = await buildMetaAdsSummaryWithCache(
        url.searchParams.get("since") || `${currentMonth()}-01`,
        url.searchParams.get("until") || todayKey(),
        { refresh: url.searchParams.get("refresh") === "1", level: url.searchParams.get("level") || "campaign" }
      );
      return json(res, data);
    }
    if (url.pathname === "/api/meta-ads/full-report") {
      const data = await buildMetaAdsFullReportWithCache(
        url.searchParams.get("since") || `${currentMonth()}-01`,
        url.searchParams.get("until") || todayKey(),
        { refresh: url.searchParams.get("refresh") === "1" }
      );
      return json(res, data);
    }
    if (url.pathname === "/api/meta-ads/score-weights") {
      if (req.method === "POST") {
        if (!isAuthorizedInternalRequest(req)) return json(res, { error: "Unauthorized" }, 401);
        const payload = await readJsonBody(req);
        const saved = await writeScoreWeights(payload.weights || payload || {});
        return json(res, { weights: saved, saved: true });
      }
      const weights = await readScoreWeights();
      return json(res, { weights });
    }
    if (url.pathname === "/api/contents/cardnews-status") {
      const data = await fetchContentsCardnewsStatus();
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/health") {
      const data = await checkCafe24Health();
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/orders") {
      const data = await fetchCafe24Orders(
        url.searchParams.get("start_date") || `${currentMonth()}-01`,
        url.searchParams.get("end_date") || todayKey(),
        { limit: url.searchParams.get("limit") || undefined }
      );
      return json(res, data);
    }
    if (url.pathname === "/api/products/dashboard") {
      const since = url.searchParams.get("since") || `${currentMonth()}-01`;
      const until = url.searchParams.get("until") || todayKey();
      const data = await buildProductDashboardWithCache(since, until, {
        refresh: url.searchParams.get("refresh") === "1",
        productLimit: url.searchParams.get("productLimit") ? Number(url.searchParams.get("productLimit")) : undefined,
        orderLimit: url.searchParams.get("orderLimit") ? Number(url.searchParams.get("orderLimit")) : undefined
      });
      return json(res, data);
    }
    if (url.pathname === "/api/brand-master") {
      if (req.method === "POST") {
        if (!isAuthorizedInternalRequest(req) && !isLocalRequest(req)) return json(res, { error: "Unauthorized" }, 401);
        const payload = await readJsonBody(req);
        const data = await saveBrandMasterUpdates(payload.brands || []);
        return json(res, data);
      }
      const data = await readBrandMasterWithSeed();
      return json(res, data);
    }
    if (url.pathname === "/api/diagnostics/brand-sales") {
      const since = url.searchParams.get("since") || "2026-07-01";
      const until = url.searchParams.get("until") || "2026-07-31";
      const data = await buildBrandSalesDiagnostics(since, until);
      return json(res, data);
    }
    if (url.pathname === "/api/diagnostics/product-join-report") {
      // 상품 Join 진단용 읽기 전용 API. 토큰/시크릿은 포함하지 않는다.
      // (2026-07-10 상품 Join 구조 개선)
      const data = await buildProductJoinReport(
        url.searchParams.get("since") || `${currentMonth()}-01`,
        url.searchParams.get("until") || todayKey()
      );
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/csv/import") {
      if (req.method !== "POST") return json(res, { error: "POST만 지원합니다." }, 405);
      if (!isAuthorizedInternalRequest(req)) return json(res, { error: "Unauthorized" }, 401);
      const payload = await readJsonBody(req);
      const data = await importCafe24Csv(payload.csvText || "", payload.csvFile || "cafe24-upload.csv");
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/refresh-token") {
      const data = await refreshCafe24Token();
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/oauth/start") {
      return redirect(res, buildCafe24AuthorizeUrl());
    }
    if (url.pathname === "/api/diagnostics/cafe24-oauth-config") {
      // redirect_uri 불일치("invalid_request: redirect_uri is invalid") 진단용 읽기 전용 API.
      // client_secret/access_token/refresh_token은 절대 포함하지 않는다.
      // buildCafe24AuthorizeUrl()을 직접 호출하지 않는다 — 그 함수는 매번 새 state를 생성해
      // env.CAFE24_OAUTH_STATE를 덮어쓰기 때문에(부작용), 실제 재인증 진행 중에 이 진단
      // endpoint를 호출하면 진행 중이던 재인증의 state 검증이 깨질 수 있다. 여기서는 미리보기용
      // authorize URL을 별도로, 부작용 없이 다시 조립한다. (2026-07-08 Cafe24 redirect_uri 진단)
      try {
        const required = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID"];
        const missing = required.filter((key) => !env[key]);
        if (missing.length) {
          throw new Error(`Cafe24 OAuth 시작에 필요한 값이 없습니다: ${missing.join(", ")}`);
        }
        const redirectUri = cafe24RedirectUri();
        const previewUrl = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/authorize`);
        previewUrl.searchParams.set("response_type", "code");
        previewUrl.searchParams.set("client_id", env.CAFE24_CLIENT_ID);
        previewUrl.searchParams.set("state", "(실제 요청마다 새로 생성됨 - 미리보기용 자리표시자)");
        previewUrl.searchParams.set("redirect_uri", redirectUri);
        if (env.CAFE24_SCOPES) previewUrl.searchParams.set("scope", env.CAFE24_SCOPES);
        return json(res, {
          ok: true,
          mallId: env.CAFE24_MALL_ID || null,
          clientId: env.CAFE24_CLIENT_ID || null,
          redirectUriSource: env.CAFE24_REDIRECT_URI ? "env.CAFE24_REDIRECT_URI" : "fallback (host:port from server)",
          redirectUriDecoded: redirectUri,
          redirectUriEncoded: encodeURIComponent(redirectUri),
          scopesConfigured: env.CAFE24_SCOPES || null,
          authorizeUrlPreview: previewUrl.toString(),
          note: "authorizeUrlPreview의 redirect_uri가 Cafe24 Developers Center에 등록된 값과 글자 하나까지 동일해야 합니다. state 값은 실제 재인증 클릭 시 매번 새로 생성되므로 여기서는 자리표시자입니다."
        });
      } catch (error) {
        return json(res, { ok: false, error: safeErrorMessage(error) }, 400);
      }
    }
    if (url.pathname === "/api/diagnostics/cafe24-token-store") {
      const token = await cafe24TokenDiagnostics();
      return json(res, {
        ok: true,
        mallId: env.CAFE24_MALL_ID || null,
        clientId: env.CAFE24_CLIENT_ID || null,
        redirectUri: cafe24RedirectUri(),
        token
      });
    }
    if (url.pathname === "/api/cafe24/oauth/callback") {
      // 재인증 성공/실패 어느 쪽이든 토큰/시크릿 값을 화면에 절대 노출하지 않는다.
      // 성공/실패 모두 "/"로 리다이렉트해서 대시보드 SPA가 쿼리스트링만 보고
      // 토스트 + Settings 오류 배너로 안내하도록 한다. (2026-07-08 Cafe24 재인증 흐름 개선)
      try {
        await handleCafe24OAuthCallback(url);
        return redirect(res, "/?cafe24_oauth=success");
      } catch (error) {
        await logApiError("cafe24_oauth_callback", error, {});
        return redirect(res, `/?cafe24_oauth=error&reason=${encodeURIComponent(safeErrorMessage(error))}`);
      }
    }
    if (url.pathname === "/api/diagnostics/logs") {
      const data = await readApiErrorLog(Number(url.searchParams.get("limit") || 50));
      return json(res, data);
    }
    if (url.pathname === "/api/diagnostics/cafe24-product-access") {
      const data = await diagnoseCafe24ProductAccess();
      return json(res, data);
    }
    if (url.pathname === "/api/diagnostics/cafe24-product-check") {
      const data = await diagnoseCafe24ProductAccess();
      return json(res, data);
    }
    if (url.pathname.startsWith("/outputs/")) {
      return serveFile(res, join(root, url.pathname));
    }
    return serveFile(res, join(outputDir, url.pathname.replace(/^\//, "")));
  } catch (error) {
    await logApiError("http_request", error, { path: req.url });
    return json(res, apiErrorPayload(error), error.status && Number(error.status) >= 400 ? Number(error.status) : 500);
  }
}).listen(port, host, () => {
  console.log(`SAMPLAS Marketing OS running at http://${host}:${port}`);
  // Instagram 자동 동기화 스케줄러 시작: 서버 부팅 시 1회 실행 후 6시간마다 반복.
  // (2026-07-08 Instagram 자동 동기화 기능 추가)
  runInstagramBackgroundSync();
  setInterval(runInstagramBackgroundSync, instagramSyncScheduler.intervalMs);
});

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

function safeErrorMessage(error) {
  return String(error?.message || "Unknown error")
    .replaceAll(env.META_ACCESS_TOKEN || "__NO_META_TOKEN__", "[META_ACCESS_TOKEN]")
    .replaceAll(env.CAFE24_ACCESS_TOKEN || "__NO_CAFE24_ACCESS__", "[CAFE24_ACCESS_TOKEN]")
    .replaceAll(env.CAFE24_REFRESH_TOKEN || "__NO_CAFE24_REFRESH__", "[CAFE24_REFRESH_TOKEN]")
    .replaceAll(env.CAFE24_CLIENT_SECRET || "__NO_CAFE24_SECRET__", "[CAFE24_CLIENT_SECRET]")
    .replaceAll(env.CAFE24_PROXY_BASIC_AUTH || "__NO_PROXY_AUTH__", "[CAFE24_PROXY_BASIC_AUTH]")
    .replaceAll(env.CAFE24_PROXY_SECRET || "__NO_PROXY_SECRET__", "[CAFE24_PROXY_SECRET]");
}

function apiErrorPayload(error) {
  const category = classifyApiError(error);
  return {
    error: safeErrorMessage(error),
    category,
    status: error?.status || null,
    code: error?.code || error?.body?.error?.code || error?.body?.error_code || null,
    type: error?.type || error?.body?.error?.type || null,
    loggedAt: new Date().toISOString()
  };
}

async function logApiError(source, error, context = {}) {
  const entry = {
    time: new Date().toISOString(),
    source,
    message: safeErrorMessage(error),
    category: classifyApiError(error),
    status: error?.status || null,
    code: error?.code || error?.body?.error?.code || error?.body?.error_code || null,
    type: error?.type || error?.body?.error?.type || null,
    context
  };
  console.error(`[SAMPLAS_API_ERROR] ${JSON.stringify(entry)}`);
  try {
    await mkdir(workDir, { recursive: true });
    const file = join(workDir, "samplas-api-errors.ndjson");
    const existing = existsSync(file) ? await readFile(file, "utf8") : "";
    const lines = existing.split(/\r?\n/).filter(Boolean).slice(-199);
    lines.push(JSON.stringify(entry));
    await writeFile(file, `${lines.join("\n")}\n`);
  } catch (logError) {
    console.error(`[SAMPLAS_API_LOG_WRITE_FAILED] ${safeErrorMessage(logError)}`);
  }
}

function classifyApiError(error) {
  const message = safeErrorMessage(error).toLowerCase();
  const code = String(error?.code || error?.body?.error?.code || error?.body?.error_code || "").toLowerCase();
  if (message.includes("api access blocked") || code === "200") return "permission_blocked";
  if (message.includes("invalid refresh_token") || message.includes("refresh token")) return "expired_refresh_token";
  if (message.includes("invalid_token") || message.includes("access_token")) return "invalid_access_token";
  return "api_error";
}

async function readApiErrorLog(limit = 50) {
  const file = join(workDir, "samplas-api-errors.ndjson");
  if (!existsSync(file)) return { source: "samplas_api_errors", logs: [] };
  const text = await readFile(file, "utf8");
  const logs = text.split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.min(Math.max(limit, 1), 200))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  return { source: "samplas_api_errors", logs };
}

async function fetchContentsCardnewsStatus() {
  const baseUrl = (env.SAMPLAS_CONTENTS_DASHBOARD_URL || "http://127.0.0.1:8790").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/api/cardnews-status`;
  try {
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `작업보드 응답을 읽지 못했습니다: ${text.slice(0, 120)}` };
    }
    if (!response.ok) {
      return {
        ok: false,
        source: "samplas_dashboard_proxy",
        dashboardUrl: baseUrl,
        error: body.error || `작업보드 API 오류 ${response.status}`,
        status: response.status,
        items: []
      };
    }
    return {
      ...body,
      ok: body.ok !== false,
      source: "samplas_dashboard_proxy",
      dashboardUrl: baseUrl,
      items: Array.isArray(body.items) ? body.items : []
    };
  } catch (error) {
    return {
      ok: false,
      source: "samplas_dashboard_proxy",
      dashboardUrl: baseUrl,
      error: safeErrorMessage(error),
      items: []
    };
  }
}

async function buildMetaAdsSummary(since, until, options = {}) {
  const adAccountId = cleanAdAccountId();
  if (!adAccountId) throw new Error(".env에 META_AD_ACCOUNT_ID가 없습니다.");
  const level = metaAdsLevel(options.level);
  const body = await graphGet(`${adAccountId}/insights`, {
    fields: metaAdsFieldsForLevel(level).join(","),
    level,
    time_range: JSON.stringify({ since, until }),
    limit: 100
  });
  await logMetaAdsDiagnostic(body.data || [], { since, until, level });
  const campaignIds = [...new Set((body.data || []).map((row) => row.campaign_id).filter(Boolean))];
  const campaignMeta = await fetchCampaignObjectives(campaignIds);
  const rows = (body.data || []).map((row) => {
    const spend = Number(row.spend || 0);
    const purchaseValue = actionValue(row.action_values, "purchase");
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const purchases = actionValue(row.actions, "purchase");
    const roas = spend ? purchaseValue / spend : null;
    const meta = campaignMeta[row.campaign_id] || {};
    const objectiveRaw = meta.objective || null;
    const frequency = Number(row.frequency || 0);
    const landingPageViews = actionValue(row.actions, ["landing_page_view"]);
    const postEngagement = actionValue(row.actions, ["post_engagement"]);
    const likes = actionValue(row.actions, ["like", "post_reaction"]);
    const saves = actionValue(row.actions, ["onsite_conversion.post_save", "save"]);
    const shares = actionValue(row.actions, ["post", "onsite_conversion.post_share"]);
    const profileVisits = actionValue(row.actions, ["onsite_conversion.profile_visit", "ig_profile_visit"]);
    const videoViews = actionValue(row.actions, ["video_view"]);
    const videoWatchTime = actionValue(row.video_avg_time_watched_actions, ["video_view"]);
    const videoCompletion = actionValue(row.video_p100_watched_actions, ["video_view"]);
    const thruplayViews = actionValue(row.video_thruplay_watched_actions, ["video_view"]);
    return {
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      adsetId: row.adset_id || "",
      adsetName: row.adset_name || "",
      adId: row.ad_id || "",
      adName: row.ad_name || "",
      label: metaAdsLabelForLevel(row, level),
      spend,
      reach: Number(row.reach || 0),
      impressions,
      clicks,
      frequency,
      cpc: clicks ? spend / clicks : 0,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      ctr: impressions ? clicks / impressions : 0,
      purchases,
      metaPurchases: purchases,
      purchaseValue,
      metaPurchaseValue: purchaseValue,
      roas,
      metaRoas: roas,
      cpa: purchases ? spend / purchases : null,
      objectiveRaw,
      objective: normalizeMetaObjective(objectiveRaw),
      status: metaCampaignStatusLabel(meta.effective_status),
      landingPageViews,
      postEngagement,
      likes,
      saves,
      shares,
      profileVisits,
      videoViews,
      videoWatchTime,
      videoCompletion,
      thruplayViews
    };
  });
  const result = {
    source: "meta_marketing_api",
    syncedAt: new Date().toISOString(),
    since,
    until,
    level,
    rows,
    campaigns: level === "campaign" ? rows : [],
    adsets: level === "adset" ? rows : [],
    ads: level === "ad" ? rows : [],
    topAds: buildMetaAdsTopRows(rows),
    lowAds: buildMetaAdsLowRows(rows),
    totals: summarizeMetaAdsRows(rows)
  };
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, metaAdsCacheFileName(level, since, until)), JSON.stringify(result, null, 2));
  return result;
}

// Performance Score Rule Engine의 기본 가중치입니다. Settings 화면에서 사용자가 수정할 수 있고,
// 수정한 값은 work/meta-ads-score-weights.json에 저장됩니다. 실제 점수 계산(0~100 정규화 로직)은
// 프론트엔드(samplas-marketing-os.js)에 있고, 서버는 가중치 값만 읽고 씁니다.
const DEFAULT_SCORE_WEIGHTS = {
  sales: { roas: 50, purchase: 30, cpa: 20 },
  traffic: { ctr: 35, landingPageView: 35, cpc: 30 },
  video: { thruplay: 50, completionRate: 50 },
  engagement: { engagementRate: 70, ctr: 30 },
  awareness: { reach: 35, frequency: 35, cpm: 30 }
};

function scoreWeightsFilePath() {
  return join(workDir, "meta-ads-score-weights.json");
}

function mergeScoreWeights(defaults, saved = {}) {
  const merged = {};
  for (const [objective, factors] of Object.entries(defaults)) {
    const savedFactors = saved[objective] || {};
    // factor 구조가 바뀌어도(예: traffic의 profileVisit → cpc) 예전 저장값에 남아있는
    // 더 이상 쓰이지 않는 key는 무시하고, 지금 정의된 key만 덮어씁니다.
    const next = { ...factors };
    for (const factorKey of Object.keys(factors)) {
      if (savedFactors[factorKey] !== undefined) next[factorKey] = savedFactors[factorKey];
    }
    merged[objective] = next;
  }
  return merged;
}

async function readScoreWeights() {
  try {
    const file = scoreWeightsFilePath();
    if (existsSync(file)) {
      const saved = JSON.parse(await readFile(file, "utf8"));
      return mergeScoreWeights(DEFAULT_SCORE_WEIGHTS, saved);
    }
  } catch {
    // 저장된 파일이 손상됐으면 기본값으로 폴백합니다.
  }
  return DEFAULT_SCORE_WEIGHTS;
}

async function writeScoreWeights(next) {
  const merged = mergeScoreWeights(DEFAULT_SCORE_WEIGHTS, next);
  await mkdir(workDir, { recursive: true });
  await writeFile(scoreWeightsFilePath(), JSON.stringify(merged, null, 2));
  return merged;
}

// Meta Ads Manager처럼 "전체 캠페인"(집행 이력이 없는 캠페인 포함)을 보여주기 위한 리포트.
// buildMetaAdsSummary()는 Insights에 잡히는(=집행 이력이 있는) 캠페인만 반환하므로,
// 별도로 계정의 전체 캠페인 목록(/campaigns)을 가져와 Insights와 LEFT JOIN 합니다.
// 캠페인명이나 생성일이 아니라 이번 기간 Insights 값만으로 "실제 집행됐는지"를 판단합니다.
// (클라이언트의 metaAdsIsExecuted와 동일한 기준을 서버에서도 그대로 씁니다.)
function isMetaAdsExecutedRow(row) {
  return Number(row.spend || 0) > 0 || Number(row.impressions || 0) > 0 || Number(row.reach || 0) > 0;
}

function subtractMonthsFromDateKey(dateKey, months) {
  const [year, month] = String(dateKey).split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 - months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// 캠페인명("...2026. 5. 31. 캠페인")이나 생성일은 실제 집행 기간과 다를 수 있습니다(예: 이름은
// 5/31 하루짜리처럼 보이지만 실제로는 6월에도 계속 집행비가 발생). 그래서 Meta Insights의
// 일별(time_increment=1) 데이터를 직접 훑어서 spend/impressions/reach가 하나라도 발생한
// 첫날과 마지막날을 "실제 집행 기간"으로 계산합니다. 비용을 아끼기 위해 이번 기간에 실제로
// 집행된 캠페인에 한해서만(보통 47개 중 몇 개뿐) 조회하고, 조회 범위도 선택한 기간 기준
// 3개월 전까지로만 넉넉하게 잡습니다(무제한 과거 조회는 하지 않음 — 정확한 "최초 집행일"이
// 아니라 "선택한 기간에 이 캠페인이 왜 보이는지 이해하기 위한 근처 실제 구간" 목적입니다).
async function fetchCampaignExecutionWindows(adAccountId, campaignIds, until) {
  if (!campaignIds.length) return {};
  const lookbackSince = subtractMonthsFromDateKey(until, 3);
  try {
    const dailyRows = await graphGetAllPages(`${adAccountId}/insights`, {
      level: "campaign",
      time_increment: 1,
      time_range: JSON.stringify({ since: lookbackSince, until }),
      fields: "campaign_id,spend,impressions,reach",
      filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]),
      limit: 500
    }, { maxPages: 20 });
    const windows = {};
    dailyRows.forEach((row) => {
      if (!isMetaAdsExecutedRow(row)) return;
      const date = row.date_start;
      if (!date) return;
      const existing = windows[row.campaign_id];
      if (!existing) {
        windows[row.campaign_id] = { first: date, last: date };
      } else {
        if (date < existing.first) existing.first = date;
        if (date > existing.last) existing.last = date;
      }
    });
    return windows;
  } catch (error) {
    await logApiError("meta_ads_execution_window", error, { since: lookbackSince, until, campaignCount: campaignIds.length });
    return {};
  }
}

async function buildMetaAdsFullReport(since, until) {
  const adAccountId = cleanAdAccountId();
  if (!adAccountId) throw new Error(".env에 META_AD_ACCOUNT_ID가 없습니다.");

  const [campaigns, insightsRows, accountTotals] = await Promise.all([
    fetchAllCampaignsList(adAccountId),
    fetchAllCampaignInsights(adAccountId, since, until),
    fetchMetaAccountTotals(adAccountId, since, until)
  ]);

  await logMetaAdsDiagnostic(insightsRows, { since, until, level: "campaign_full_report" });

  const insightsByCampaign = new Map();
  insightsRows.forEach((row) => insightsByCampaign.set(row.campaign_id, row));

  const rows = campaigns.map((campaign) => {
    const insight = insightsByCampaign.get(campaign.id) || {};
    const spend = Number(insight.spend || 0);
    const impressions = Number(insight.impressions || 0);
    const clicks = Number(insight.clicks || 0);
    const reach = Number(insight.reach || 0);
    const frequency = Number(insight.frequency || (reach ? impressions / reach : 0));
    const purchaseValue = actionValue(insight.action_values, "purchase");
    const purchases = actionValue(insight.actions, "purchase");
    const landingPageViews = actionValue(insight.actions, ["landing_page_view"]);
    const profileVisits = actionValue(insight.actions, ["onsite_conversion.profile_visit", "ig_profile_visit"]);
    const postEngagement = actionValue(insight.actions, ["post_engagement"]);
    const videoViews = actionValue(insight.actions, ["video_view"]);
    const videoWatchTime = actionValue(insight.video_avg_time_watched_actions, ["video_view"]);
    const videoCompletion = actionValue(insight.video_p100_watched_actions, ["video_view"]);
    const thruplayViews = actionValue(insight.video_thruplay_watched_actions, ["video_view"]);
    const roas = spend ? purchaseValue / spend : null;
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      objectiveRaw: campaign.objective || null,
      objective: normalizeMetaObjective(campaign.objective),
      bidStrategyRaw: campaign.bid_strategy || null,
      campaignStrategy: metaBidStrategyLabel(campaign.bid_strategy),
      effectiveStatus: campaign.effective_status || null,
      status: metaCampaignDisplayStatus(campaign.effective_status, spend),
      spend,
      reach,
      impressions,
      clicks,
      frequency,
      cpc: clicks ? spend / clicks : 0,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      ctr: impressions ? clicks / impressions : 0,
      landingPageViews,
      profileVisits,
      postEngagement,
      videoViews,
      videoWatchTime,
      videoCompletion,
      thruplayViews,
      purchases,
      purchaseValue,
      roas,
      cpa: purchases ? spend / purchases : null,
      conversionRate: clicks ? purchases / clicks : 0
    };
  });

  const executedCampaignIds = rows.filter(isMetaAdsExecutedRow).map((row) => row.campaignId);
  const executionWindows = await fetchCampaignExecutionWindows(adAccountId, executedCampaignIds, until);
  rows.forEach((row) => {
    const w = executionWindows[row.campaignId];
    if (w) {
      row.executionStart = w.first;
      row.executionEnd = w.last;
    } else if (isMetaAdsExecutedRow(row)) {
      // 일별 조회가 실패했거나 조회 범위 밖일 때의 대체값: 최소한 "이 기간 안에서 집행됨"은
      // 확실하므로 선택한 기간 자체를 보여줍니다(정확한 첫날/마지막날은 아닐 수 있음).
      row.executionStart = since;
      row.executionEnd = until;
    } else {
      row.executionStart = null;
      row.executionEnd = null;
    }
  });

  const campaignIdSet = new Set(campaigns.map((campaign) => campaign.id));
  const unmatched = insightsRows.filter((row) => !campaignIdSet.has(row.campaign_id));
  const unlistedSpend = sum(unmatched.map((row) => ({ spend: Number(row.spend || 0) })), "spend");
  const unlistedPurchaseValue = sum(unmatched.map((row) => ({ purchaseValue: actionValue(row.action_values, "purchase") })), "purchaseValue");

  const tableSpend = sum(rows, "spend");
  const tablePurchaseValue = sum(rows, "purchaseValue");

  const reconciliation = {
    metaAccountSpend: accountTotals.spend,
    metaAccountPurchaseValue: accountTotals.purchaseValue,
    metaAccountRoas: accountTotals.roas,
    tableSpend,
    tablePurchaseValue,
    tableRoas: tableSpend ? tablePurchaseValue / tableSpend : null,
    unlistedCampaignCount: unmatched.length,
    unlistedSpend,
    unlistedPurchaseValue,
    spendDiff: accountTotals.spend - (tableSpend + unlistedSpend),
    purchaseValueDiff: accountTotals.purchaseValue - (tablePurchaseValue + unlistedPurchaseValue)
  };

  const result = {
    source: "meta_marketing_api",
    syncedAt: new Date().toISOString(),
    since,
    until,
    rows,
    reconciliation
  };
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, metaAdsFullReportCacheFileName(since, until)), JSON.stringify(result, null, 2));
  return result;
}

// 과거 Meta Ads Insights도 Meta API에 그대로 남아있는 실데이터이므로(계정이 존재하는 한
// 캐시가 없다고 0원을 지어내지 않고), 이번 달이든 지난 달이든 캐시가 없으면 항상 먼저
// 라이브 API를 한 번 시도합니다. 캐시는 "속도를 위한 우선 사용"일 뿐, "지난 달이라 API를
// 아예 부르지 않는다"는 정책은 Cafe24 CSV 워크플로우에만 해당하며 Meta Ads에는 적용하지 않습니다.
async function buildMetaAdsFullReportWithCache(since, until, options = {}) {
  if (!options.refresh) {
    const cached = await readCachedMetaAdsFullReport(since, until);
    if (cached) {
      return decorateCachedSource(cached, "meta_marketing_api", isCurrentMonth(monthFromDate(since)) ? "cached_first" : "past_month_cached");
    }
  }

  try {
    return await buildMetaAdsFullReport(since, until);
  } catch (error) {
    await logApiError("meta_ads_full_report", error, { since, until });
    const cached = await readCachedMetaAdsFullReport(since, until);
    if (cached) {
      return {
        ...cached,
        source: cached.source?.endsWith("_cached") ? cached.source : `${cached.source || "meta_marketing_api"}_cached`,
        cacheMode: "fallback_after_error",
        cacheWarning: error.message
      };
    }
    throw error;
  }
}

function metaAdsFullReportCacheFileName(since, until) {
  return `meta-ads-full-report-${since}_${until}.json`;
}

async function readCachedMetaAdsFullReport(since, until) {
  const file = join(workDir, metaAdsFullReportCacheFileName(since, until));
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  return null;
}

// buildMetaAdsFullReportWithCache와 동일한 원칙: 캐시가 없으면(지난 달이라도) 항상 라이브 API를
// 먼저 시도합니다. 이전에는 지난 달 캐시가 없으면 API를 아예 호출하지 않고 광고비 0원짜리
// 응답을 반환했는데, 이는 "데이터가 없다"가 아니라 "한 번도 조회한 적이 없다"였던 버그였습니다.
const META_ADS_SUMMARY_TTL_MS = Math.max(60000, Number(env.META_ADS_SUMMARY_TTL_MS || 6 * 60 * 60 * 1000));
const metaAdsSummaryRefreshInFlight = new Set();

function metaAdsSummaryCacheKey(level, since, until) {
  return `${level}:${since}:${until}`;
}

function metaAdsSummaryCacheAgeMs(cached = {}) {
  const time = Date.parse(cached.syncedAt || cached.updatedAt || 0);
  return Number.isFinite(time) ? Date.now() - time : Number.POSITIVE_INFINITY;
}

function isCurrentMonthMetaAdsSummaryRequest(since) {
  return isCurrentMonth(monthFromDate(since));
}

function isUsableMetaAdsSummaryCache(cached, since, until) {
  if (!cached) return false;
  if (isCurrentMonthMetaAdsSummaryRequest(since) && cached.until !== until) return false;
  return true;
}

function decorateMetaAdsSummaryCache(cached, since, until) {
  const currentMonth = isCurrentMonthMetaAdsSummaryRequest(since);
  const decorated = decorateCachedSource(cached, "meta_marketing_api", currentMonth ? "cached_first" : "past_month_cached");
  decorated.cacheAgeMs = metaAdsSummaryCacheAgeMs(cached);
  decorated.ttlMs = META_ADS_SUMMARY_TTL_MS;
  if (cached.cacheFile) decorated.cacheFile = cached.cacheFile;
  if (cached.requestedSince) decorated.requestedSince = cached.requestedSince;
  if (cached.requestedUntil) decorated.requestedUntil = cached.requestedUntil;
  return decorated;
}

function scheduleMetaAdsSummaryBackgroundRefresh(since, until, options = {}) {
  const level = metaAdsLevel(options.level);
  const key = metaAdsSummaryCacheKey(level, since, until);
  if (metaAdsSummaryRefreshInFlight.has(key)) return false;
  metaAdsSummaryRefreshInFlight.add(key);
  (async () => {
    try {
      await buildMetaAdsSummary(since, until, { level });
    } catch (error) {
      await logApiError("meta_ads", error, { since, until, level, stage: "summary_background_ttl_refresh" });
    } finally {
      metaAdsSummaryRefreshInFlight.delete(key);
    }
  })();
  return true;
}

async function buildMetaAdsSummaryWithCache(since, until, options = {}) {
  const level = metaAdsLevel(options.level);

  if (!options.refresh) {
    const cached = await readCachedMetaAdsSummary(since, until, { level });
    if (cached) {
      const decorated = decorateMetaAdsSummaryCache(cached, since, until);
      if (isCurrentMonthMetaAdsSummaryRequest(since) && decorated.cacheAgeMs > META_ADS_SUMMARY_TTL_MS) {
        decorated.staleRefreshTriggered = scheduleMetaAdsSummaryBackgroundRefresh(since, until, { level });
      }
      return decorated;
    }
  }

  try {
    return await buildMetaAdsSummary(since, until, { level });
  } catch (error) {
    await logApiError("meta_ads", error, { since, until, level });
    const cached = await readCachedMetaAdsSummary(since, until, { level });
    if (cached) {
      return {
        ...cached,
        source: cached.source?.endsWith("_cached") ? cached.source : `${cached.source || "meta_marketing_api"}_cached`,
        cacheMode: "fallback_after_error",
        cacheWarning: error.message
      };
    }
    throw error;
  }
}

async function readCachedMetaAdsSummary(since, until, options = {}) {
  const level = metaAdsLevel(options.level);
  const exactFile = join(workDir, metaAdsCacheFileName(level, since, until));
  if (existsSync(exactFile)) {
    const cached = normalizeMetaAdsCachedResult(JSON.parse(await readFile(exactFile, "utf8")), level);
    return isUsableMetaAdsSummaryCache(cached, since, until) ? cached : null;
  }
  if (level === "campaign") {
    const legacyFile = join(workDir, `meta-ads-${since}_${until}.json`);
    if (existsSync(legacyFile)) {
      const cached = normalizeMetaAdsCachedResult(JSON.parse(await readFile(legacyFile, "utf8")), level);
      return isUsableMetaAdsSummaryCache(cached, since, until) ? cached : null;
    }
  }

  const monthPrefix = `meta-ads-${level}-${since}_`;
  const candidates = await readdirSafe(workDir);
  const latest = candidates
    .filter((name) => name.startsWith(monthPrefix) && name.endsWith(".json"))
    .sort()
    .at(-1);
  if (!latest && level === "campaign") {
    const legacyLatest = candidates
      .filter((name) => name.startsWith(`meta-ads-${since}_`) && name.endsWith(".json"))
      .sort()
      .at(-1);
    if (!legacyLatest) return null;
    const legacyCached = JSON.parse(await readFile(join(workDir, legacyLatest), "utf8"));
    const normalized = normalizeMetaAdsCachedResult(legacyCached, level);
    if (!isUsableMetaAdsSummaryCache(normalized, since, until)) return null;
    return {
      ...normalized,
      requestedSince: since,
      requestedUntil: until,
      cacheFile: legacyLatest
    };
  }
  if (!latest) return null;
  const cached = JSON.parse(await readFile(join(workDir, latest), "utf8"));
  const normalized = normalizeMetaAdsCachedResult(cached, level);
  if (!isUsableMetaAdsSummaryCache(normalized, since, until)) return null;
  return {
    ...normalized,
    requestedSince: since,
    requestedUntil: until,
    cacheFile: latest
  };
}

function metaAdsLevel(value) {
  return ["campaign", "adset", "ad"].includes(value) ? value : "campaign";
}

function metaAdsFieldsForLevel(level) {
  const fields = {
    campaign: ["campaign_id", "campaign_name"],
    adset: ["campaign_id", "campaign_name", "adset_id", "adset_name"],
    ad: ["campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name"]
  };
  return [
    ...fields[level],
    "spend", "reach", "impressions", "clicks", "frequency",
    "actions", "action_values",
    "video_avg_time_watched_actions", "video_p100_watched_actions", "video_thruplay_watched_actions"
  ];
}

// campaign_id별 objective/effective_status는 Insights가 아니라 Campaign 노드 필드라서
// 별도의 가벼운 배치 조회 한 번으로 가져옵니다. 실패해도 전체 응답은 깨지지 않게 처리합니다.
async function fetchCampaignObjectives(campaignIds = []) {
  if (!campaignIds.length) return {};
  try {
    const body = await graphGet("", { ids: campaignIds.join(","), fields: "objective,effective_status" });
    return body || {};
  } catch {
    return {};
  }
}

function normalizeMetaObjective(raw) {
  const value = String(raw || "").toUpperCase();
  if (!value) return "unknown";
  if (value.includes("SALES") || value.includes("CONVERSION") || value.includes("LEAD")) return "sales";
  if (value.includes("TRAFFIC") || value.includes("LINK_CLICK") || value.includes("APP")) return "traffic";
  if (value.includes("ENGAGEMENT") || value.includes("MESSAGE")) return "engagement";
  if (value.includes("VIDEO")) return "video";
  if (value.includes("AWARENESS") || value.includes("REACH") || value.includes("BRAND")) return "awareness";
  return "unknown";
}

function metaCampaignStatusLabel(effectiveStatus) {
  const map = {
    ACTIVE: "진행중",
    PAUSED: "일시중지",
    ARCHIVED: "보관됨",
    DELETED: "삭제됨",
    IN_PROCESS: "검토중",
    WITH_ISSUES: "문제 있음",
    CAMPAIGN_PAUSED: "일시중지",
    ADSET_PAUSED: "일시중지"
  };
  return map[effectiveStatus] || (effectiveStatus ? effectiveStatus : "확인 필요");
}

function metaAdsLabelForLevel(row, level) {
  if (level === "ad") return row.ad_name || row.ad_id || "광고";
  if (level === "adset") return row.adset_name || row.adset_id || "광고세트";
  return row.campaign_name || row.campaign_id || "캠페인";
}

function summarizeMetaAdsRows(rows = []) {
  const totals = {
    spend: sum(rows, "spend"),
    reach: sum(rows, "reach"),
    impressions: sum(rows, "impressions"),
    clicks: sum(rows, "clicks"),
    purchases: sum(rows, "purchases"),
    metaPurchases: sum(rows, "metaPurchases"),
    purchaseValue: sum(rows, "purchaseValue"),
    metaPurchaseValue: sum(rows, "metaPurchaseValue"),
    landingPageViews: sum(rows, "landingPageViews"),
    postEngagement: sum(rows, "postEngagement"),
    likes: sum(rows, "likes"),
    saves: sum(rows, "saves"),
    shares: sum(rows, "shares"),
    profileVisits: sum(rows, "profileVisits"),
    videoViews: sum(rows, "videoViews")
  };
  totals.cpc = totals.clicks ? totals.spend / totals.clicks : 0;
  totals.cpm = totals.impressions ? (totals.spend / totals.impressions) * 1000 : 0;
  totals.ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
  totals.roas = totals.spend ? totals.purchaseValue / totals.spend : null;
  totals.metaRoas = totals.roas;
  totals.cpa = totals.purchases ? totals.spend / totals.purchases : null;
  totals.frequency = totals.reach ? totals.impressions / totals.reach : 0;
  return totals;
}

function normalizeMetaAdsCachedResult(data = {}, level = "campaign") {
  const rows = (data.rows || data.campaigns || data.adsets || data.ads || []).map((row) => {
    const spend = Number(row.spend || 0);
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const purchaseValue = Number(row.purchaseValue || row.metaPurchaseValue || 0);
    const purchases = Number(row.purchases || row.metaPurchases || 0);
    const roas = row.roas === null ? null : Number(row.roas || (spend ? purchaseValue / spend : 0));
    return {
      ...row,
      label: row.label || row.adName || row.adsetName || row.campaignName || row.adId || row.adsetId || row.campaignId || "-",
      cpc: Number(row.cpc || (clicks ? spend / clicks : 0)),
      cpm: Number(row.cpm || (impressions ? (spend / impressions) * 1000 : 0)),
      ctr: Number(row.ctr || (impressions ? clicks / impressions : 0)),
      purchases,
      metaPurchases: Number(row.metaPurchases || purchases),
      purchaseValue,
      metaPurchaseValue: Number(row.metaPurchaseValue || purchaseValue),
      roas,
      metaRoas: row.metaRoas === null ? null : Number(row.metaRoas || roas || 0)
    };
  });
  return {
    ...data,
    level: data.level || level,
    rows,
    campaigns: level === "campaign" ? rows : data.campaigns || [],
    adsets: level === "adset" ? rows : data.adsets || [],
    ads: level === "ad" ? rows : data.ads || [],
    topAds: data.topAds || buildMetaAdsTopRows(rows),
    lowAds: data.lowAds || buildMetaAdsLowRows(rows),
    totals: {
      ...summarizeMetaAdsRows(rows),
      ...(data.totals || {})
    }
  };
}

function buildMetaAdsTopRows(rows = []) {
  return [...rows]
    .filter((row) => Number(row.spend || 0) > 0)
    .sort((left, right) => Number(right.roas || 0) - Number(left.roas || 0) || Number(right.purchaseValue || 0) - Number(left.purchaseValue || 0))
    .slice(0, 5);
}

function buildMetaAdsLowRows(rows = []) {
  return [...rows]
    .filter((row) => Number(row.spend || 0) > 0)
    .sort((left, right) => Number(left.roas || 0) - Number(right.roas || 0) || Number(right.spend || 0) - Number(left.spend || 0))
    .slice(0, 5);
}

function metaAdsCacheFileName(level, since, until) {
  return `meta-ads-${level}-${since}_${until}.json`;
}

async function readdirSafe(dir) {
  try {
    return await fsReaddir(dir);
  } catch {
    return [];
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function readCafe24TokenRecord() {
  try {
    const text = await readFile(cafe24TokenStoreFile, "utf8");
    const record = JSON.parse(text);
    hydrateCafe24EnvFromTokenRecord(record);
    return record;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeCafe24TokenRecord(record) {
  await mkdir(cafe24TokenStoreDir, { recursive: true });
  const payload = {
    schema: 1,
    status: record.status || "active",
    accessToken: record.accessToken || "",
    refreshToken: record.refreshToken || "",
    expiresAt: record.expiresAt || null,
    updatedAt: record.updatedAt || new Date().toISOString(),
    lastRefreshAt: record.lastRefreshAt || null,
    reauthRequiredAt: record.reauthRequiredAt || null,
    lastError: record.lastError || null
  };
  const tempFile = join(cafe24TokenStoreDir, `.cafe24-token-store.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tempFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await rename(tempFile, cafe24TokenStoreFile);
  hydrateCafe24EnvFromTokenRecord(payload);
  return payload;
}

function hydrateCafe24EnvFromTokenRecord(record = {}) {
  if (record.accessToken) env.CAFE24_ACCESS_TOKEN = record.accessToken;
  if (record.refreshToken) env.CAFE24_REFRESH_TOKEN = record.refreshToken;
  if (record.expiresAt) env.CAFE24_ACCESS_TOKEN_EXPIRES_AT = record.expiresAt;
}

function cafe24TokenStoreKind() {
  const configuredDir = env.CAFE24_TOKEN_STORE_DIR || "";
  if (configuredDir.startsWith("/var/data")) return "render_persistent_disk";
  if (configuredDir) return "configured_file_store";
  return "work_dir_file_store";
}

function cafe24TokenNeedsRefresh(record, skewMs = 10 * 60 * 1000) {
  if (!record?.accessToken) return true;
  if (!record.expiresAt) return false;
  const expiresAt = new Date(record.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt - Date.now() <= skewMs;
}

function safeCafe24TokenRecord(record) {
  const status = record?.status || (record ? "active" : "missing");
  return {
    source: cafe24TokenStoreKind(),
    configured: Boolean(env.CAFE24_TOKEN_STORE_DIR),
    status,
    hasAccessToken: Boolean(record?.accessToken),
    hasRefreshToken: Boolean(record?.refreshToken),
    accessTokenLength: record?.accessToken ? String(record.accessToken).length : 0,
    refreshTokenLength: record?.refreshToken ? String(record.refreshToken).length : 0,
    expiresAt: record?.expiresAt || null,
    updatedAt: record?.updatedAt || null,
    lastRefreshAt: record?.lastRefreshAt || null,
    reauthRequiredAt: record?.reauthRequiredAt || null,
    needsRefresh: cafe24TokenNeedsRefresh(record),
    reauthRequired: status === "reauth_required",
    lastError: record?.lastError || null
  };
}

async function cafe24TokenDiagnostics() {
  return safeCafe24TokenRecord(await readCafe24TokenRecord());
}

async function markCafe24ReauthRequired(error) {
  const existing = await readCafe24TokenRecord();
  const record = await writeCafe24TokenRecord({
    ...(existing || {}),
    status: "reauth_required",
    reauthRequiredAt: new Date().toISOString(),
    updatedAt: existing?.updatedAt || new Date().toISOString(),
    lastError: safeErrorMessage(error)
  });
  return safeCafe24TokenRecord(record);
}

// (2026-07-10 상품 Join 구조 개선) 상품 조회에 동시성 3을 도입하면서, 여러 요청이 동시에
// 만료된 토큰을 만나면 refresh가 중복 실행될 수 있다. Cafe24는 refresh 시 refresh token을
// 회전시키므로 동시 refresh는 토큰 무효화 위험이 있다. in-flight promise 하나로 직렬화만
// 하고, refreshCafe24Token 내부 로직(토큰 저장/갱신)은 일절 건드리지 않는다.
let cafe24RefreshInFlightPromise = null;
async function refreshCafe24TokenSingleFlight() {
  if (!cafe24RefreshInFlightPromise) {
    cafe24RefreshInFlightPromise = (async () => {
      try {
        return await refreshCafe24Token();
      } finally {
        cafe24RefreshInFlightPromise = null;
      }
    })();
  }
  return cafe24RefreshInFlightPromise;
}

async function ensureCafe24AccessToken() {
  const record = await readCafe24TokenRecord();
  if (!record?.accessToken || !record?.refreshToken) {
    throw new Error("Cafe24 토큰 저장소에 access token 또는 refresh token이 없습니다. 재인증 필요");
  }
  if (record.status === "reauth_required") {
    throw new Error("Cafe24 token 상태가 reauth_required입니다. 재인증 필요");
  }
  if (cafe24TokenNeedsRefresh(record)) {
    await refreshCafe24TokenSingleFlight();
  } else {
    hydrateCafe24EnvFromTokenRecord(record);
  }
  return env.CAFE24_ACCESS_TOKEN;
}

function isAuthorizedInternalRequest(req) {
  if (!env.CAFE24_PROXY_SECRET && !env.CAFE24_PROXY_BASIC_AUTH) return host === "127.0.0.1" || host === "localhost";
  if (env.CAFE24_PROXY_SECRET && req.headers["x-samplas-internal-token"] === env.CAFE24_PROXY_SECRET) return true;
  const auth = req.headers.authorization || "";
  if (env.CAFE24_PROXY_BASIC_AUTH && auth.startsWith("Basic ")) {
    return auth.slice("Basic ".length) === Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64");
  }
  return false;
}

function isLocalRequest(req) {
  const requestHost = String(req.headers.host || "").split(":")[0];
  return requestHost === "127.0.0.1" || requestHost === "localhost" || requestHost === "::1";
}

async function fetchCafe24Orders(startDate, endDate, options = {}) {
  await logCafe24OrdersDebug("flow_start", {
    startDate,
    endDate,
    requestedLimit: options.limit || null,
    isCurrentMonth: isCurrentMonth(monthFromDate(startDate)),
    mode: env.CAFE24_PROXY_BASE_URL ? "proxy" : "direct",
    mallId: env.CAFE24_MALL_ID || null,
    configuredScopes: env.CAFE24_SCOPES || null,
    hasAccessToken: Boolean(env.CAFE24_ACCESS_TOKEN),
    hasRefreshToken: Boolean(env.CAFE24_REFRESH_TOKEN),
    accessTokenExpiresAt: env.CAFE24_ACCESS_TOKEN_EXPIRES_AT || null,
    hasProxyBaseUrl: Boolean(env.CAFE24_PROXY_BASE_URL),
    hasProxySecret: Boolean(env.CAFE24_PROXY_SECRET),
    hasProxyBasicAuth: Boolean(env.CAFE24_PROXY_BASIC_AUTH)
  });
  if (!isCurrentMonth(monthFromDate(startDate))) {
    const cached = await readCachedCafe24Orders(startDate, endDate);
    if (cached) return decorateCachedSource(cached, "cafe24_orders", "past_month_cache_only");
    return pastMonthCsvRequired("cafe24_orders", monthFromDate(startDate), {
      startDate,
      endDate,
      orders: [],
      totals: { orderCount: 0, orderAmount: 0 }
    });
  }

  if (env.CAFE24_PROXY_BASE_URL) {
    return await fetchCafe24OrdersFromProxy(startDate, endDate, options);
  }
  if (!env.CAFE24_MALL_ID) {
    throw new Error("Cafe24 API 호출에 CAFE24_MALL_ID가 필요합니다.");
  }
  await ensureCafe24AccessToken();
  let body;
  try {
    body = await cafe24GetOrders(startDate, endDate, options);
  } catch (error) {
    await logCafe24OrdersDebug("orders_error", {
      startDate,
      endDate,
      message: safeErrorMessage(error),
      statusCode: error.status || null,
      request: error.cafe24OrdersDebug || null
    });
    await logApiError("cafe24_orders", error, { startDate, endDate, stage: "orders" });
    if (!isCafe24InvalidToken(error)) return await fallbackCafe24OrdersAfterError(startDate, endDate, error);
    try {
      await refreshCafe24Token();
    } catch (refreshError) {
      await logCafe24OrdersDebug("refresh_error", {
        startDate,
        endDate,
        message: safeErrorMessage(refreshError),
        statusCode: refreshError.status || null
      });
      await logApiError("cafe24_refresh", refreshError, { startDate, endDate, stage: "refresh" });
      return await fallbackCafe24OrdersAfterError(startDate, endDate, refreshError);
    }
    try {
      body = await cafe24GetOrders(startDate, endDate, options);
    } catch (retryError) {
      await logCafe24OrdersDebug("orders_after_refresh_error", {
        startDate,
        endDate,
        message: safeErrorMessage(retryError),
        statusCode: retryError.status || null,
        request: retryError.cafe24OrdersDebug || null
      });
      await logApiError("cafe24_orders", retryError, { startDate, endDate, stage: "orders_after_refresh" });
      return await fallbackCafe24OrdersAfterError(startDate, endDate, retryError);
    }
  }
  const orders = body.orders || [];
  const summary = summarizeCafe24Orders(orders);
  const result = {
    source: "cafe24_admin_api",
    syncedAt: new Date().toISOString(),
    startDate,
    endDate,
    orders,
    ...summary
  };
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, `cafe24-orders-${startDate}_${endDate}.json`), JSON.stringify(result, null, 2));
  return result;
}

async function fallbackCafe24OrdersAfterError(startDate, endDate, error) {
  const cached = await readCachedCafe24Orders(startDate, endDate);
  if (cached) {
    return {
      ...decorateCachedSource(cached, "cafe24_orders", "fallback_after_error"),
      cacheWarning: error.message
    };
  }
  throw error;
}

async function fetchCafe24OrdersFromProxy(startDate, endDate, options = {}) {
  const base = env.CAFE24_PROXY_BASE_URL.replace(/\/$/, "");
  const path = env.CAFE24_PROXY_ORDERS_PATH || "/api/cafe24/orders";
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  if (!url.searchParams.has("limit")) url.searchParams.set("limit", options.limit || env.CAFE24_PROXY_ORDER_LIMIT || "10");
  const headers = {};
  if (env.CAFE24_PROXY_SECRET) headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
  if (env.CAFE24_PROXY_BASIC_AUTH) {
    headers.Authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
  }
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Cafe24 proxy가 JSON이 아닌 응답을 보냈습니다: ${response.status} ${text.slice(0, 80)}`);
  }
  if (!response.ok || body.error) {
    await logCafe24OrdersDebug("proxy_response_error", {
      proxyBaseUrl: base,
      proxyPath: path,
      requestUrl: url.toString(),
      statusCode: response.status,
      ok: response.ok,
      responseBody: compactCafe24Body(body),
      hasProxySecret: Boolean(env.CAFE24_PROXY_SECRET),
      hasProxyBasicAuth: Boolean(env.CAFE24_PROXY_BASIC_AUTH)
    });
    throw new Error(body.error || body.message || `Cafe24 proxy error ${response.status}`);
  }
  await logCafe24OrdersDebug("proxy_response_ok", {
    proxyBaseUrl: base,
    proxyPath: path,
    requestUrl: url.toString(),
    statusCode: response.status,
    ok: response.ok,
    responseBody: compactCafe24Body(body),
    hasProxySecret: Boolean(env.CAFE24_PROXY_SECRET),
    hasProxyBasicAuth: Boolean(env.CAFE24_PROXY_BASIC_AUTH)
  });
  const orders = body.orders || body.data || [];
  const result = {
    source: "cafe24_proxy",
    proxyBaseUrl: base,
    startDate,
    endDate,
    orders,
    totals: body.totals || {
      orderCount: orders.length,
      orderAmount: orders.reduce((total, order) => total + Number(order.order_price_amount || order.actual_payment_amount || 0), 0)
    }
  };
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, `cafe24-proxy-orders-${startDate}_${endDate}.json`), JSON.stringify(result, null, 2));
  return result;
}

async function readCachedCafe24Orders(startDate, endDate) {
  const exactFiles = [
    join(workDir, `cafe24-csv-orders-${startDate}_${endDate}.json`),
    join(workDir, `cafe24-proxy-orders-${startDate}_${endDate}.json`),
    join(workDir, `cafe24-orders-${startDate}_${endDate}.json`)
  ];
  for (const file of exactFiles) {
    if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  }

  const candidates = await readdirSafe(workDir);
  const prefixes = [`cafe24-csv-orders-${startDate}_`, `cafe24-proxy-orders-${startDate}_`, `cafe24-orders-${startDate}_`];
  let latest = null;
  for (const prefix of prefixes) {
    latest = candidates
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .sort()
      .at(-1);
    if (latest) break;
  }
  if (!latest) return null;
  const cached = JSON.parse(await readFile(join(workDir, latest), "utf8"));
  return {
    ...cached,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    cacheFile: latest
  };
}

function summarizeCafe24Orders(orders = []) {
  const productMap = new Map();
  const paymentMap = new Map();
  let itemCount = 0;
  let quantity = 0;
  let itemAmount = 0;
  let grossOrderAmount = 0;
  let initialOrderAmount = 0;
  let excludedOrderCount = 0;
  const activeOrders = [];

  for (const order of orders) {
    if (isCafe24CanceledOrRefunded(order)) {
      excludedOrderCount += 1;
      continue;
    }

    activeOrders.push(order);
    const paymentMethod = normalizeCafe24PaymentMethod(order);
    const orderAmount = cafe24OrderAmount(order);
    grossOrderAmount += cafe24GrossOrderAmount(order);
    initialOrderAmount += cafe24InitialOrderAmount(order);
    const payment = paymentMap.get(paymentMethod) || { paymentMethod, orderCount: 0, orderAmount: 0 };
    payment.orderCount += 1;
    payment.orderAmount += orderAmount;
    paymentMap.set(paymentMethod, payment);

    const items = cafe24OrderItems(order);
    for (const item of items) {
      const productName = item.product_name || item.productName || item.product_name_default || item.name || "상품명 없음";
      const productNo = item.product_no || item.productNo || item.product_code || "";
      const qty = cafe24ItemQuantity(item);
      const amount = cafe24ItemAmount(item, qty);
      itemCount += 1;
      quantity += qty;
      itemAmount += amount;
      const key = productName || productNo || "상품명 없음";
      const product = productMap.get(key) || { productName: key, productNo, quantity: 0, itemAmount: 0, itemCount: 0 };
      product.quantity += qty;
      product.itemAmount += amount;
      product.itemCount += 1;
      productMap.set(key, product);
    }
  }

  const orderAmount = activeOrders.reduce((total, order) => total + cafe24OrderAmount(order), 0);
  return {
    totals: {
      orderCount: activeOrders.length,
      rawOrderCount: orders.length,
      excludedOrderCount,
      itemCount,
      quantity,
      orderAmount,
      grossOrderAmount,
      initialOrderAmount,
      itemAmount,
      averageOrderAmount: activeOrders.length ? Math.round(orderAmount / activeOrders.length) : 0
    },
    topProducts: [...productMap.values()].sort((left, right) => right.itemAmount - left.itemAmount).slice(0, 50),
    paymentMethods: [...paymentMap.values()].sort((left, right) => right.orderAmount - left.orderAmount)
  };
}

function cafe24OrderAmount(order = {}) {
  if (isCafe24CanceledOrRefunded(order)) return 0;
  return firstCafe24Money([
    order.actual_order_amount?.payment_amount,
    order.actual_payment_amount,
    order.payment_amount,
    order.actual_order_amount?.order_price_amount,
    order.order_price_amount,
    order.initial_order_amount?.payment_amount,
    order.initial_order_amount?.order_price_amount,
    order.order_amount,
    order.total_price
  ]);
}

function cafe24GrossOrderAmount(order = {}) {
  if (isCafe24CanceledOrRefunded(order)) return 0;
  return firstCafe24Money([
    order.actual_order_amount?.order_price_amount,
    order.order_price_amount,
    order.initial_order_amount?.order_price_amount,
    order.initial_order_amount?.payment_amount,
    order.payment_amount
  ]);
}

function cafe24InitialOrderAmount(order = {}) {
  if (isCafe24CanceledOrRefunded(order)) return 0;
  return firstCafe24Money([
    order.initial_order_amount?.order_price_amount,
    order.initial_order_amount?.payment_amount,
    order.order_price_amount,
    order.payment_amount
  ]);
}

function firstCafe24Money(values = []) {
  for (const value of values) {
    const parsed = parseCafe24Money(value);
    if (parsed !== null) return parsed;
  }
  return 0;
}

function parseCafe24Money(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function isCafe24CanceledOrRefunded(order = {}) {
  const flags = [
    order.canceled,
    order.cancelled,
    order.refunded,
    order.returned,
    order.cancel_status,
    order.return_status,
    order.refund_status
  ].map((value) => String(value || "").toLowerCase());
  if (flags.some((value) => ["t", "true", "y", "yes", "cancel", "canceled", "cancelled", "refund", "refunded", "return", "returned"].includes(value))) return true;
  return Boolean(order.cancel_date || order.return_confirmed_date || order.refund_date);
}

function normalizeCafe24PaymentMethod(order = {}) {
  const raw = order.payment_method_name || order.payment_method || order.payment_methods?.[0]?.payment_method || "미확인";
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((value) => String(value || "").trim()).filter(Boolean).join(" + ") || "미확인";
}

function cafe24OrderItems(order = {}) {
  const candidates = [order.items, order.order_items, order.products, order.order_item];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function cafe24ItemQuantity(item = {}) {
  const quantity = Number(item.quantity || item.qty || item.product_quantity || item.order_quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function cafe24ItemAmount(item = {}, quantity = 1) {
  const amount = firstCafe24Money([
    item.actual_payment_amount,
    item.order_price_amount,
    item.product_price,
    item.price,
    item.sale_price,
    item.supply_price
  ]);
  return amount * quantity;
}

// ============================================================================
// Product Dashboard v1 (Sales 탭 확장) — Cafe24 Orders + Products 기반.
// mall.read_product 스코프 하나만 필요. Product Sales Report(mall.read_salesreport)는
// v1에서 사용하지 않음. 상품별 ROAS는 만들지 않고, Meta 광고비/ROAS는 기간 참고치로만
// 별도 표시한다. 기존 fetchCafe24Orders/buildMetaAdsSummaryWithCache 등 기존 로직은
// 전혀 건드리지 않고, 아래는 전부 새로 추가되는 함수/라우트다.
// ============================================================================

function isCafe24InsufficientScope(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.body?.error?.code ?? error?.body?.error_code ?? "").toLowerCase();
  return status === 403 || message.includes("insufficient_scope") || message.includes("permission necessary") || code === "403";
}

const CAFE24_PRODUCT_SCOPE_MESSAGE = "Cafe24 상품 데이터 접근 권한이 부족합니다. Cafe24 개발자센터에서 mall.read_product 스코프를 추가한 뒤 OAuth 재인증을 진행해주세요.";

async function fetchCafe24ProductList(options = {}) {
  const limit = Math.min(Number(options.limit || 60) || 60, 200);
  const pageSize = Math.min(100, limit);
  const products = [];
  for (let offset = 0; offset < limit; offset += pageSize) {
    const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/products`);
    url.searchParams.set("limit", String(Math.min(pageSize, limit - offset)));
    url.searchParams.set("offset", String(offset));
    const body = await cafe24FetchJson(url);
    if (body.error) throw body.error;
    const page = body.products || [];
    products.push(...page);
    if (page.length < pageSize) break;
  }
  return products;
}

async function fetchCafe24ProductDetail(productNo) {
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/products/${productNo}`);
  const body = await cafe24FetchJson(url);
  if (body.error) throw body.error;
  return body.product || {};
}

async function fetchCafe24ProductVariantsWithInventory(productNo) {
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/products/${productNo}/variants`);
  url.searchParams.set("limit", "100");
  url.searchParams.set("embed", "inventories");
  const body = await cafe24FetchJson(url);
  if (body.error) throw body.error;
  return body.variants || [];
}

function firstCafe24Inventory(variant = {}) {
  const raw = variant.inventories ?? variant.inventory ?? null;
  if (!raw) return {};
  return Array.isArray(raw) ? raw[0] || {} : raw;
}

function normalizeCafe24ProductRow(item = {}, detail = {}, variants = []) {
  const merged = { ...item, ...detail };
  const options = variants.map((variant) => {
    const inv = firstCafe24Inventory(variant);
    return {
      variantCode: variant.variant_code || "",
      optionSummary: (variant.options || []).map((option) => `${option.name}:${option.value}`).join(", "),
      quantity: Number(inv.quantity ?? variant.quantity ?? 0),
      soldOut: String(inv.display_soldout ?? variant.sold_out ?? "F").toUpperCase() === "T"
    };
  });
  const inventoryQuantity = options.reduce((total, option) => total + (Number.isFinite(option.quantity) ? option.quantity : 0), 0);
  const soldOut = options.length > 0
    ? options.every((option) => option.soldOut || option.quantity <= 0)
    : String(merged.sold_out || "F").toUpperCase() === "T";
  return {
    productNo: merged.product_no,
    productCode: merged.product_code || merged.custom_product_code || "",
    productName: merged.product_name || merged.eng_product_name || "상품명 없음",
    brand: merged.brand_code || merged.brand || "",
    categoryNos: (merged.category || []).map((category) => category.category_no).filter((no) => no !== undefined),
    mainImage: merged.list_image || merged.small_image || merged.tiny_image || merged.detail_image || "",
    display: merged.display || "F",
    selling: merged.selling || "F",
    createdDate: merged.created_date || merged.regist_date || null,
    options,
    inventoryQuantity,
    soldOut
  };
}

// ============================================================================
// (2026-07-10 상품 Join 구조 개선) 카탈로그 캐시 공통 헬퍼.
// - TTL: 기본 6시간. 지나면 Dashboard는 기존 캐시를 즉시 쓰고 백그라운드에서만 갱신한다.
// - 저장은 항상 tmp 파일에 쓴 뒤 rename하는 atomic 방식만 사용한다.
// - 주문에 등장한 product_no 중 캐시에 없는 것만 추가 조회해 병합한다(온디맨드).
// ============================================================================
const CAFE24_CATALOG_TTL_MS = Math.max(60000, Number(env.CAFE24_CATALOG_TTL_MS || 6 * 60 * 60 * 1000));
const CAFE24_PRODUCT_FETCH_CONCURRENCY = 3;
const cafe24ProductCatalogFile = () => join(workDir, "cafe24-product-catalog.json");
const productSalesHistoryFile = () => join(workDir, "product-sales-history.json");
const brandMasterFile = () => join(workDir, "brand-master.json");
const productBrandMapFile = () => join(workDir, "product-brand-map.json");

async function writeJsonAtomic(file, data) {
  await mkdir(workDir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

function normalizeBrandCode(value) {
  return String(value ?? "").trim();
}

function normalizeBrandName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseBrandAliases(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeBrandName).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[\n,]/)
    .map(normalizeBrandName)
    .filter(Boolean);
}

function suggestBrandNameFromProductName(productName) {
  const match = String(productName || "").match(/^\s*\[([^\]:\]]+)(?:\s*:\s*([^\]]+))?\]/);
  return normalizeBrandName(match?.[2] || match?.[1] || "");
}

function normalizeBrandMasterEntry(entry = {}, fallbackCode = "") {
  const brand_code = normalizeBrandCode(entry.brand_code || fallbackCode);
  if (!brand_code) return null;
  return {
    brand_code,
    brand_name: normalizeBrandName(entry.brand_name),
    name_aliases: parseBrandAliases(entry.name_aliases),
    instagram_tag: normalizeBrandName(entry.instagram_tag),
    active: entry.active === undefined ? true : Boolean(entry.active),
    nameSource: entry.nameSource === "confirmed" ? "confirmed" : "suggested"
  };
}

function brandMasterEntriesToMap(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    const normalized = normalizeBrandMasterEntry(entry);
    if (normalized) map.set(normalized.brand_code, normalized);
  }
  return map;
}

async function readBrandMasterFile() {
  const file = brandMasterFile();
  if (!existsSync(file)) return { updatedAt: null, brands: [] };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    const brands = Array.isArray(parsed) ? parsed : Array.isArray(parsed.brands) ? parsed.brands : [];
    return {
      updatedAt: parsed.updatedAt || null,
      brands: brands.map((entry) => normalizeBrandMasterEntry(entry)).filter(Boolean)
    };
  } catch {
    return { updatedAt: null, brands: [] };
  }
}

async function writeBrandMasterFile(brands) {
  const normalized = brands
    .map((entry) => normalizeBrandMasterEntry(entry))
    .filter(Boolean)
    .sort((left, right) => left.brand_code.localeCompare(right.brand_code));
  await writeJsonAtomic(brandMasterFile(), {
    updatedAt: new Date().toISOString(),
    brands: normalized
  });
  return normalized;
}

function extractProductsFromCatalogPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.items)) return payload.items;
  if (payload?.products && typeof payload.products === "object") return Object.values(payload.products);
  return [];
}

async function readBrandSeedProducts() {
  const catalogFile = cafe24ProductCatalogFile();
  if (existsSync(catalogFile)) {
    try {
      const parsed = JSON.parse(await readFile(catalogFile, "utf8"));
      const products = extractProductsFromCatalogPayload(parsed);
      if (products.length) return { products, source: "cafe24-product-catalog" };
    } catch {
      // Fall through to the dashboard cache. A corrupt cache should not block seed generation.
    }
  }

  try {
    const files = (await fsReaddir(workDir))
      .filter((name) => /^product-dashboard-proxy-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort()
      .reverse();
    for (const file of files) {
      try {
        const parsed = JSON.parse(await readFile(join(workDir, file), "utf8"));
        if (Array.isArray(parsed.products) && parsed.products.length) {
          return { products: parsed.products, source: file };
        }
      } catch {
        // Ignore invalid dashboard caches and continue looking for a usable cache.
      }
    }
  } catch {
    // No readable work directory yet.
  }

  return { products: [], source: null };
}

function productBrandCode(product = {}) {
  return normalizeBrandCode(product.brand_code || product.brandCode || product.brand || product.mall_brand_code);
}

function productDisplayName(product = {}) {
  return product.product_name || product.productName || product.name || "";
}

function buildSuggestedBrandMaster(products = []) {
  const byCode = new Map();
  for (const product of products) {
    const brand_code = productBrandCode(product);
    if (!brand_code) continue;
    const bucket = byCode.get(brand_code) || { brand_code, productCount: 0, candidates: new Map() };
    bucket.productCount += 1;
    const candidate = suggestBrandNameFromProductName(productDisplayName(product));
    if (candidate) bucket.candidates.set(candidate, (bucket.candidates.get(candidate) || 0) + 1);
    byCode.set(brand_code, bucket);
  }

  return Array.from(byCode.values())
    .map((bucket) => {
      const candidates = Array.from(bucket.candidates.entries()).sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return left[0].localeCompare(right[0]);
      });
      return {
        brand_code: bucket.brand_code,
        brand_name: candidates[0]?.[0] || "",
        name_aliases: [],
        instagram_tag: "",
        active: true,
        nameSource: "suggested"
      };
    })
    .sort((left, right) => left.brand_code.localeCompare(right.brand_code));
}

async function readBrandMasterWithSeed() {
  const existing = await readBrandMasterFile();
  const existingMap = brandMasterEntriesToMap(existing.brands);
  const seed = await readBrandSeedProducts();
  const suggested = buildSuggestedBrandMaster(seed.products);
  let changed = !existsSync(brandMasterFile());

  for (const entry of suggested) {
    if (!existingMap.has(entry.brand_code)) {
      existingMap.set(entry.brand_code, entry);
      changed = true;
    }
  }

  const brands = Array.from(existingMap.values()).sort((left, right) => left.brand_code.localeCompare(right.brand_code));
  const savedBrands = changed ? await writeBrandMasterFile(brands) : brands;
  const withBrandCode = seed.products.filter((product) => productBrandCode(product)).length;
  const confirmedCount = savedBrands.filter((brand) => brand.nameSource === "confirmed").length;

  return {
    ok: true,
    updatedAt: changed ? new Date().toISOString() : existing.updatedAt,
    source: "brand-master",
    seedSource: seed.source,
    brandCount: savedBrands.length,
    suggestedCount: savedBrands.length - confirmedCount,
    confirmedCount,
    brandCodeCoverage: {
      productCount: seed.products.length,
      withBrandCode,
      missingBrandCode: seed.products.length - withBrandCode
    },
    brands: savedBrands
  };
}

async function saveBrandMasterUpdates(updates = []) {
  const current = await readBrandMasterWithSeed();
  const map = brandMasterEntriesToMap(current.brands);

  for (const update of updates) {
    const brand_code = normalizeBrandCode(update.brand_code);
    if (!brand_code || !map.has(brand_code)) continue;
    const existing = map.get(brand_code);
    map.set(brand_code, {
      ...existing,
      brand_name: normalizeBrandName(update.brand_name),
      name_aliases: parseBrandAliases(update.name_aliases),
      instagram_tag: normalizeBrandName(update.instagram_tag),
      active: update.active === undefined ? existing.active : Boolean(update.active),
      nameSource: "confirmed"
    });
  }

  const brands = await writeBrandMasterFile(Array.from(map.values()));
  const confirmedCount = brands.filter((brand) => brand.nameSource === "confirmed").length;
  return {
    ok: true,
    saved: true,
    updatedAt: new Date().toISOString(),
    source: "brand-master",
    brandCount: brands.length,
    suggestedCount: brands.length - confirmedCount,
    confirmedCount,
    brands
  };
}

async function readProductBrandMap() {
  const file = productBrandMapFile();
  if (!existsSync(file)) return { updatedAt: null, products: {}, negative: {} };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return {
      updatedAt: parsed.updatedAt || null,
      products: parsed.products && typeof parsed.products === "object" ? parsed.products : {},
      negative: parsed.negative && typeof parsed.negative === "object" ? parsed.negative : {}
    };
  } catch {
    return { updatedAt: null, products: {}, negative: {} };
  }
}

async function writeProductBrandMap(productBrandMap) {
  await writeJsonAtomic(productBrandMapFile(), {
    updatedAt: new Date().toISOString(),
    products: productBrandMap.products || {},
    negative: productBrandMap.negative || {}
  });
}

function productBrandMapCode(productBrandMap, productNo) {
  const entry = productBrandMap?.products?.[String(productNo || "").trim()];
  if (!entry) return "";
  return normalizeBrandCode(typeof entry === "string" ? entry : entry.brand_code);
}

function isCafe24ProductNotFound(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.body?.error?.code ?? error?.body?.error_code ?? "").toLowerCase();
  return status === 404 || message.includes("not found") || message.includes("not_exist") || code === "404";
}

function collectMissingBrandMapProductNos(orders = [], catalog = [], productBrandMap = {}) {
  const catalogProductNos = new Set(catalog.map((product) => String(product.productNo || "")).filter(Boolean));
  const wanted = new Set();
  for (const order of orders) {
    if (isCafe24CanceledOrRefunded(order)) continue;
    for (const item of cafe24OrderItems(order)) {
      const productNo = String(item.product_no || item.productNo || "").trim();
      if (!productNo || catalogProductNos.has(productNo)) continue;
      if (productBrandMap.products?.[productNo] || productBrandMap.negative?.[productNo]) continue;
      wanted.add(productNo);
    }
  }
  return [...wanted];
}

async function backfillProductBrandMap(orders = [], catalog = []) {
  const productBrandMap = await readProductBrandMap();
  const targets = collectMissingBrandMapProductNos(orders, catalog, productBrandMap);
  const diagnostics = {
    targetCount: targets.length,
    successCount: 0,
    negativeCount: 0,
    failedCount: 0
  };
  if (!targets.length) return { productBrandMap, diagnostics };

  await mapWithConcurrency(targets, CAFE24_PRODUCT_FETCH_CONCURRENCY, async (productNo) => {
    try {
      const detail = await fetchCafe24ProductDetail(productNo);
      const brand_code = normalizeBrandCode(detail.brand_code || detail.brand || "");
      if (brand_code) {
        productBrandMap.products[productNo] = {
          brand_code,
          updatedAt: new Date().toISOString()
        };
        diagnostics.successCount += 1;
      } else {
        productBrandMap.negative[productNo] = {
          status: "missing_brand_code",
          updatedAt: new Date().toISOString()
        };
        diagnostics.negativeCount += 1;
      }
    } catch (error) {
      if (isCafe24ProductNotFound(error)) {
        productBrandMap.negative[productNo] = {
          status: "not_found",
          updatedAt: new Date().toISOString()
        };
        diagnostics.negativeCount += 1;
      } else {
        diagnostics.failedCount += 1;
      }
    }
  });

  if (diagnostics.successCount || diagnostics.negativeCount || !existsSync(productBrandMapFile())) await writeProductBrandMap(productBrandMap);
  return { productBrandMap, diagnostics };
}

function validIsoDateOrNull(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function maxIsoDate(left, right) {
  const leftIso = validIsoDateOrNull(left);
  const rightIso = validIsoDateOrNull(right);
  if (!leftIso) return rightIso;
  if (!rightIso) return leftIso;
  return rightIso > leftIso ? rightIso : leftIso;
}

function productSalesHistoryKey(product = {}) {
  if (product.productNo !== undefined && product.productNo !== null && String(product.productNo).trim()) return String(product.productNo);
  if (product.productCode) return String(product.productCode);
  return null;
}

async function readProductSalesHistoryCache() {
  const file = productSalesHistoryFile();
  if (!existsSync(file)) {
    return { updatedAt: null, seededFromOrderCaches: false, products: {} };
  }
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return {
      updatedAt: parsed.updatedAt || null,
      seededFromOrderCaches: Boolean(parsed.seededFromOrderCaches),
      seededAt: parsed.seededAt || null,
      products: parsed.products && typeof parsed.products === "object" ? parsed.products : {}
    };
  } catch {
    return { updatedAt: null, seededFromOrderCaches: false, products: {} };
  }
}

async function writeProductSalesHistoryCache(history) {
  await writeJsonAtomic(productSalesHistoryFile(), {
    updatedAt: new Date().toISOString(),
    seededFromOrderCaches: Boolean(history.seededFromOrderCaches),
    seededAt: history.seededAt || null,
    products: history.products || {}
  });
}

function mergeProductSalesHistoryDate(history, key, dateValue) {
  if (!key) return false;
  const nextDate = validIsoDateOrNull(dateValue);
  if (!nextDate) return false;
  const products = history.products || (history.products = {});
  const existing = products[key] || {};
  const merged = maxIsoDate(existing.lastSaleDate, nextDate);
  if (!merged || merged === existing.lastSaleDate) return false;
  products[key] = { ...existing, lastSaleDate: merged };
  return true;
}

function productHistoryLookupMaps(catalog = []) {
  const byNo = new Map();
  const byCode = new Map();
  for (const product of catalog) {
    const key = productSalesHistoryKey(product);
    if (!key) continue;
    if (product.productNo !== undefined && product.productNo !== null) byNo.set(String(product.productNo), key);
    if (product.productCode) byCode.set(String(product.productCode), key);
  }
  return { byNo, byCode };
}

function productHistoryKeyFromOrderItem(item = {}, maps = {}) {
  const productNo = item.product_no || item.productNo || "";
  const productCode = item.product_code || item.productCode || "";
  return (productNo && maps.byNo?.get(String(productNo))) || (productCode && maps.byCode?.get(String(productCode))) || null;
}

function cafe24OrderCacheFileName(name = "") {
  return /^(cafe24-orders|cafe24-proxy-orders|cafe24-csv-orders)-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(name);
}

async function seedProductSalesHistoryFromOrderCaches(history, catalog = []) {
  if (history.seededFromOrderCaches) {
    return { scanned: false, scannedFiles: 0, updatedProducts: 0, skippedInvalidJson: 0 };
  }
  const maps = productHistoryLookupMaps(catalog);
  const files = (await readdirSafe(workDir)).filter(cafe24OrderCacheFileName).sort();
  let updatedProducts = 0;
  let skippedInvalidJson = 0;
  for (const fileName of files) {
    let cached;
    try {
      cached = JSON.parse(await readFile(join(workDir, fileName), "utf8"));
    } catch {
      skippedInvalidJson += 1;
      continue;
    }
    const orders = cached.orders || cached.data || [];
    for (const order of orders) {
      if (isCafe24CanceledOrRefunded(order)) continue;
      const orderDate = trustedCafe24OrderDate(order);
      if (!orderDate) continue;
      for (const item of cafe24OrderItems(order)) {
        const key = productHistoryKeyFromOrderItem(item, maps);
        if (mergeProductSalesHistoryDate(history, key, orderDate)) updatedProducts += 1;
      }
    }
  }
  history.seededFromOrderCaches = true;
  history.seededAt = new Date().toISOString();
  return { scanned: true, scannedFiles: files.length, updatedProducts, skippedInvalidJson };
}

function mergeCurrentSalesIntoProductHistory(history, salesByProduct = new Map()) {
  let updatedProducts = 0;
  for (const [key, sales] of salesByProduct.entries()) {
    if (mergeProductSalesHistoryDate(history, key, sales.lastSaleDate)) updatedProducts += 1;
  }
  return { updatedProducts };
}

// 동시성 실행은 기존 mapWithConcurrency() 헬퍼(Instagram 경로에서 사용 중)를 그대로 재사용한다.

async function readCafe24ProductCatalogCache() {
  const cacheFile = cafe24ProductCatalogFile();
  if (!existsSync(cacheFile)) return null;
  try {
    return JSON.parse(await readFile(cacheFile, "utf8"));
  } catch {
    return null;
  }
}

async function fetchCafe24ProductCatalogRow(item) {
  const productNo = item.product_no;
  let detail = {};
  let variants = [];
  try {
    detail = await fetchCafe24ProductDetail(productNo);
  } catch (error) {
    await logApiError("cafe24_product_detail", error, { productNo });
  }
  try {
    variants = await fetchCafe24ProductVariantsWithInventory(productNo);
  } catch (error) {
    await logApiError("cafe24_product_variants", error, { productNo });
  }
  return normalizeCafe24ProductRow(item, detail, variants);
}

async function buildCafe24ProductCatalog(options = {}) {
  const list = await fetchCafe24ProductList(options);
  // 상품별 detail+variants 조회를 동시성 3으로 병렬화한다. Cafe24 rate limit(초당 리필 2,
  // 버킷 40)을 넘지 않는 보수적 수준이고, 429가 나면 cafe24FetchJson이 1회 재시도한다.
  const products = await mapWithConcurrency(list, CAFE24_PRODUCT_FETCH_CONCURRENCY, (item) => fetchCafe24ProductCatalogRow(item));
  // 전체 리빌드가 온디맨드로 병합된 옛 상품/negative cache를 지우지 않도록 이전 캐시와 병합한다.
  // 온디맨드 상품은 TTL 안쪽 것만 유지 — TTL이 지나면 다음 Dashboard 빌드에서 재조회돼 재고가 갱신된다.
  const previous = await readCafe24ProductCatalogCache();
  const listedNos = new Set(products.map((product) => String(product.productNo)));
  const now = Date.now();
  if (previous) {
    for (const old of previous.products || []) {
      if (!old.fetchedOnDemand || listedNos.has(String(old.productNo))) continue;
      const age = now - (Date.parse(old.onDemandSyncedAt || 0) || 0);
      if (age < CAFE24_CATALOG_TTL_MS) products.push(old);
    }
  }
  const result = {
    ok: true,
    source: "cafe24_product_api",
    syncedAt: new Date().toISOString(),
    productCount: products.length,
    missingProducts: previous?.missingProducts || {},
    products
  };
  await writeJsonAtomic(cafe24ProductCatalogFile(), result);
  return result;
}

let cafe24CatalogRefreshInFlight = false;
function scheduleCafe24CatalogBackgroundRefresh(options = {}) {
  if (cafe24CatalogRefreshInFlight) return false;
  cafe24CatalogRefreshInFlight = true;
  (async () => {
    try {
      await buildCafe24ProductCatalog({ limit: options.limit });
    } catch (error) {
      await logApiError("cafe24_product_catalog", error, { stage: "background_ttl_refresh" });
    } finally {
      cafe24CatalogRefreshInFlight = false;
    }
  })();
  return true;
}

async function buildCafe24ProductCatalogWithCache(options = {}) {
  const readCache = readCafe24ProductCatalogCache;

  if (!options.refresh) {
    const cached = await readCache();
    if (cached) {
      // TTL 안이면 캐시 그대로. TTL이 지나도 사용자는 기다리지 않는다 — 기존 캐시를 즉시
      // 돌려주고 백그라운드에서 한 번만 전체 갱신을 돌린다. (2026-07-10 Cache TTL)
      const ageMs = Date.now() - (Date.parse(cached.syncedAt || 0) || 0);
      const decorated = decorateCachedSource(cached, "cafe24_product_api", "cached_first");
      decorated.cacheAgeMs = ageMs;
      decorated.ttlMs = CAFE24_CATALOG_TTL_MS;
      if (ageMs > CAFE24_CATALOG_TTL_MS) {
        decorated.staleRefreshTriggered = scheduleCafe24CatalogBackgroundRefresh(options);
      }
      return decorated;
    }
  }

  try {
    return await buildCafe24ProductCatalog(options);
  } catch (error) {
    await logApiError("cafe24_product_catalog", error, {});
    if (isCafe24InsufficientScope(error)) {
      return {
        ok: false,
        reason: "insufficient_scope",
        message: CAFE24_PRODUCT_SCOPE_MESSAGE,
        source: "cafe24_product_api",
        products: []
      };
    }
    const cached = await readCache();
    if (cached) {
      return {
        ...cached,
        source: cached.source?.endsWith("_cached") ? cached.source : `${cached.source || "cafe24_product_api"}_cached`,
        cacheMode: "fallback_after_error",
        cacheWarning: error.message
      };
    }
    throw error;
  }
}

// 주문에 등장했지만 카탈로그 캐시에 없는 product_no만 Cafe24에서 추가 조회해 캐시에 병합한다.
// 이미 캐시에 있는 상품은 절대 다시 조회하지 않고, 404(삭제/비공개)는 negative cache
// (missingProducts)에 기록해 TTL 동안 재조회하지 않는다. 읽기 전용 GET만 사용한다.
// (2026-07-10 상품 Join 구조 개선: Orders → product_no Set → Cache Lookup → 추가 조회 → Merge)
async function ensureCatalogCoversOrderProducts(catalogResult, orders = []) {
  const summary = {
    attempted: 0,
    added: 0,
    deletedOrPrivate: 0,
    failed: 0,
    addedProductNos: [],
    deletedProductNos: [],
    failedProductNos: []
  };
  if (!catalogResult || catalogResult.ok === false) return summary;
  if (!Array.isArray(catalogResult.products)) catalogResult.products = [];
  const products = catalogResult.products;
  const known = new Set(products.map((product) => String(product.productNo)));
  if (!catalogResult.missingProducts || typeof catalogResult.missingProducts !== "object") catalogResult.missingProducts = {};
  const negative = catalogResult.missingProducts;
  const now = Date.now();
  const wanted = new Set();
  for (const order of orders) {
    if (isCafe24CanceledOrRefunded(order)) continue;
    for (const item of cafe24OrderItems(order)) {
      const productNo = String(item.product_no || item.productNo || "").trim();
      if (!productNo || known.has(productNo) || wanted.has(productNo)) continue;
      const neg = negative[productNo];
      if (neg && now - (Date.parse(neg.checkedAt || 0) || 0) < CAFE24_CATALOG_TTL_MS) continue;
      wanted.add(productNo);
    }
  }
  if (!wanted.size) return summary;
  const productNos = [...wanted];
  summary.attempted = productNos.length;
  await mapWithConcurrency(productNos, CAFE24_PRODUCT_FETCH_CONCURRENCY, async (productNo) => {
    try {
      const detail = await fetchCafe24ProductDetail(productNo);
      let variants = [];
      try {
        variants = await fetchCafe24ProductVariantsWithInventory(productNo);
      } catch (variantError) {
        await logApiError("cafe24_product_variants", variantError, { productNo, stage: "on_demand" });
      }
      const row = normalizeCafe24ProductRow({ product_no: detail.product_no ?? Number(productNo) }, detail, variants);
      row.fetchedOnDemand = true;
      row.onDemandSyncedAt = new Date().toISOString();
      products.push(row);
      delete negative[productNo];
      summary.added += 1;
      summary.addedProductNos.push(productNo);
    } catch (error) {
      const status = Number(error?.status || error?.body?.error?.code || 0);
      if (status === 404) {
        negative[productNo] = { reason: "deleted_or_private", checkedAt: new Date().toISOString() };
        summary.deletedOrPrivate += 1;
        summary.deletedProductNos.push(productNo);
      } else {
        summary.failed += 1;
        summary.failedProductNos.push(productNo);
        await logApiError("cafe24_product_on_demand", error, { productNo });
      }
    }
  });
  if (summary.added || summary.deletedOrPrivate) {
    try {
      // 캐시 파일에는 decorate 필드(source 접미사, cacheMode 등)를 제외한 원형만 저장한다.
      const toSave = {
        ok: true,
        source: "cafe24_product_api",
        syncedAt: catalogResult.syncedAt || new Date().toISOString(),
        onDemandSyncedAt: new Date().toISOString(),
        productCount: products.length,
        missingProducts: negative,
        products
      };
      await writeJsonAtomic(cafe24ProductCatalogFile(), toSave);
      catalogResult.productCount = products.length;
    } catch (error) {
      await logApiError("cafe24_product_catalog_save", error, { stage: "on_demand_merge" });
    }
  }
  return summary;
}

const CAFE24_JOIN_REASON_LABELS = {
  missing_identifier: "상품번호 없음 (수기/개인결제 등)",
  deleted_or_private: "삭제되었거나 조회 불가한 상품",
  fetch_failed: "추가 조회 실패 (일시 오류)",
  not_in_catalog: "카탈로그 미동기화"
};

function matchCafe24OrdersToProducts(orders = [], catalog = [], context = {}) {
  const byNo = new Map();
  const byCode = new Map();
  for (const product of catalog) {
    if (product.productNo) byNo.set(String(product.productNo), product);
    if (product.productCode) byCode.set(String(product.productCode), product);
  }
  const negative = context.negativeProducts || {};
  const failed = new Set((context.failedProductNos || []).map(String));
  const salesByProduct = new Map();
  let orderCount = 0;
  let itemCount = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;
  let unmatchedAmount = 0;
  const unmatchedItems = [];
  const reasonTotals = new Map();
  for (const order of orders) {
    if (isCafe24CanceledOrRefunded(order)) continue;
    orderCount += 1;
    for (const item of cafe24OrderItems(order)) {
      itemCount += 1;
      const quantity = cafe24ItemQuantity(item);
      const amount = cafe24ItemAmount(item, quantity);
      const productNo = item.product_no || item.productNo || "";
      const productCode = item.product_code || item.productCode || "";
      const product = (productNo && byNo.get(String(productNo))) || (productCode && byCode.get(String(productCode)));
      if (!product) {
        let reason = "not_in_catalog";
        if (!productNo && !productCode) reason = "missing_identifier";
        else if (negative[String(productNo)]) reason = "deleted_or_private";
        else if (failed.has(String(productNo))) reason = "fetch_failed";
        unmatchedCount += 1;
        unmatchedAmount += amount;
        const entry = reasonTotals.get(reason) || { reason, label: CAFE24_JOIN_REASON_LABELS[reason] || reason, count: 0, amount: 0 };
        entry.count += 1;
        entry.amount += amount;
        reasonTotals.set(reason, entry);
        if (unmatchedItems.length < 100) {
          unmatchedItems.push({
            productNo: productNo ? String(productNo) : null,
            productCode: productCode ? String(productCode) : null,
            variantCode: item.variant_code || item.variantCode || null,
            productName: item.product_name || item.productName || item.item_name || null,
            quantity,
            amount,
            reason
          });
        }
        continue;
      }
      matchedCount += 1;
      const key = product.productNo;
      const entry = salesByProduct.get(key) || { quantity: 0, amount: 0, orderIds: new Set(), lastSaleDate: null };
      entry.quantity += quantity;
      entry.amount += amount;
      const orderId = order.order_id || order.orderId || order.order_no || order.id || "";
      if (orderId) entry.orderIds.add(String(orderId));
      const orderDate = trustedCafe24OrderDate(order);
      if (orderDate && (!entry.lastSaleDate || orderDate > entry.lastSaleDate)) entry.lastSaleDate = orderDate;
      salesByProduct.set(key, entry);
    }
  }
  return {
    salesByProduct,
    unmatchedCount,
    unmatchedAmount,
    orderCount,
    itemCount,
    matchedCount,
    unmatchedItems,
    unmatchedReasons: [...reasonTotals.values()].sort((a, b) => b.amount - a.amount)
  };
}

function aggregateCafe24BrandSalesByBrandCode(catalog = [], salesByProduct = new Map(), brandMasterResult = {}, productBrandMap = {}) {
  const masterMap = brandMasterEntriesToMap(brandMasterResult.brands || []);
  const brandBuckets = new Map();

  for (const product of catalog) {
    const productNo = product.productNo === undefined || product.productNo === null ? "" : String(product.productNo);
    if (!productNo) continue;
    const sales = salesByProduct.get(product.productNo) || salesByProduct.get(productNo);
    if (!sales) continue;

    const quantitySold = Number(sales.quantity || 0);
    const salesAmount = Number(sales.amount || 0);
    const orderIds = sales.orderIds instanceof Set ? sales.orderIds : new Set();
    const hasSales = quantitySold > 0 || salesAmount > 0 || orderIds.size > 0;
    if (!hasSales) continue;

    const brand_code = productBrandCode(product) || productBrandMapCode(productBrandMap, productNo) || "UNASSIGNED";
    const master = masterMap.get(brand_code);
    const bucket = brandBuckets.get(brand_code) || {
      brand_code,
      brand_name: master?.brand_name || brand_code,
      salesAmount: 0,
      quantitySold: 0,
      orderIds: new Set(),
      soldProductNos: new Set()
    };

    bucket.salesAmount += salesAmount;
    bucket.quantitySold += quantitySold;
    for (const orderId of orderIds) bucket.orderIds.add(orderId);
    bucket.soldProductNos.add(productNo);
    brandBuckets.set(brand_code, bucket);
  }

  return Array.from(brandBuckets.values())
    .map((bucket) => ({
      brand_code: bucket.brand_code,
      brand_name: bucket.brand_name || bucket.brand_code,
      salesAmount: bucket.salesAmount,
      quantitySold: bucket.quantitySold,
      orderCount: bucket.orderIds.size,
      soldProductCount: bucket.soldProductNos.size
    }))
    .sort((left, right) => {
      if (right.salesAmount !== left.salesAmount) return right.salesAmount - left.salesAmount;
      return left.brand_code.localeCompare(right.brand_code);
    });
}

function cafe24BrandSalesItemAmount(item = {}, quantity = 1) {
  const fixedAmount = firstCafe24Money([
    item.itemAmount,
    item.item_amount,
    item.total_item_amount
  ]);
  if (fixedAmount) return fixedAmount;
  const unitAmount = firstCafe24Money([
    item.actual_payment_amount,
    item.order_price_amount,
    item.product_price,
    item.price,
    item.salePrice,
    item.sale_price,
    item.supply_price
  ]);
  return unitAmount * quantity;
}

function buildBrandSalesInputsFromOrders(orders = [], catalog = []) {
  const catalogForBrandSales = [...catalog];
  const byProductNo = new Map();
  for (const product of catalogForBrandSales) {
    const productNo = product.productNo === undefined || product.productNo === null ? "" : String(product.productNo);
    if (productNo) byProductNo.set(productNo, product);
  }

  const salesByProduct = new Map();
  const unassignedProducts = new Map();
  for (const order of orders) {
    if (isCafe24CanceledOrRefunded(order)) continue;
    const orderId = order.order_id || order.orderId || order.order_no || order.id || "";
    for (const item of cafe24OrderItems(order)) {
      const productNo = String(item.product_no || item.productNo || "").trim();
      if (!productNo) continue;
      const product = byProductNo.get(productNo);
      const productKey = product ? product.productNo : productNo;
      if (!product) {
        if (!unassignedProducts.has(productKey)) {
          unassignedProducts.set(productKey, {
            productNo,
            productCode: item.product_code || item.productCode || "",
            productName: item.product_name || item.productName || item.item_name || ""
          });
        }
      }
      const quantity = cafe24ItemQuantity(item);
      const amount = cafe24BrandSalesItemAmount(item, quantity);
      const entry = salesByProduct.get(productKey) || { quantity: 0, amount: 0, orderIds: new Set() };
      entry.quantity += quantity;
      entry.amount += amount;
      if (orderId) entry.orderIds.add(String(orderId));
      salesByProduct.set(productKey, entry);
    }
  }

  return {
    catalog: [...catalogForBrandSales, ...unassignedProducts.values()],
    salesByProduct
  };
}

async function buildBrandSalesDiagnostics(since, until) {
  if (env.CAFE24_PROXY_BASE_URL) {
    const [dashboard, ordersResult, brandMaster] = await Promise.all([
      buildProductDashboardWithCache(since, until, {}),
      fetchCafe24Orders(since, until, { limit: 500 }).catch((error) => ({ error: error.message, orders: [], totals: {} })),
      readBrandMasterWithSeed()
    ]);
    const catalog = dashboard.products || [];
    let orders = ordersResult.orders || ordersResult.data || [];
    if (!orders.length) {
      const cachedOrders = await readCachedCafe24Orders(since, until);
      orders = cachedOrders?.orders || cachedOrders?.data || [];
    }
    const { productBrandMap, diagnostics: productBrandBackfill } = await backfillProductBrandMap(orders, catalog);
    const brandSalesInput = buildBrandSalesInputsFromOrders(orders, catalog);
    const brands = aggregateCafe24BrandSalesByBrandCode(brandSalesInput.catalog, brandSalesInput.salesByProduct, brandMaster, productBrandMap);
    const productsWithBrandCode = catalog.filter((product) => productBrandCode(product)).length;
    const matchedOrderIds = new Set();
    for (const sales of brandSalesInput.salesByProduct.values()) {
      if (sales.orderIds instanceof Set) {
        for (const orderId of sales.orderIds) matchedOrderIds.add(orderId);
      }
    }
    const totals = brands.reduce((acc, brand) => {
      acc.salesAmount += Number(brand.salesAmount || 0);
      acc.quantitySold += Number(brand.quantitySold || 0);
      acc.soldProductCount += Number(brand.soldProductCount || 0);
      return acc;
    }, { salesAmount: 0, quantitySold: 0, orderCount: matchedOrderIds.size, soldProductCount: 0 });
    return {
      period: { since, until },
      brandCodeCoverage: {
        totalProducts: catalog.length,
        productsWithBrandCode,
        productsWithoutBrandCode: catalog.length - productsWithBrandCode
      },
      brandMaster: {
        totalBrands: brandMaster.brandCount || 0,
        suggestedCount: brandMaster.suggestedCount || 0,
        confirmedCount: brandMaster.confirmedCount || 0
      },
      totals,
      productBrandBackfill,
      brands
    };
  }

  const [ordersResult, catalogResult, brandMaster] = await Promise.all([
    fetchCafe24Orders(since, until, { limit: 500 }).catch((error) => ({ error: error.message, orders: [], totals: {} })),
    buildCafe24ProductCatalogWithCache({ refresh: false }),
    readBrandMasterWithSeed()
  ]);
  let orders = ordersResult.orders || ordersResult.data || [];
  if (!orders.length) {
    const cachedOrders = await readCachedCafe24Orders(since, until);
    orders = cachedOrders?.orders || cachedOrders?.data || [];
  }
  const catalog = catalogResult.products || [];
  const { productBrandMap, diagnostics: productBrandBackfill } = await backfillProductBrandMap(orders, catalog);
  const brandSalesInput = buildBrandSalesInputsFromOrders(orders, catalog);
  const brands = aggregateCafe24BrandSalesByBrandCode(brandSalesInput.catalog, brandSalesInput.salesByProduct, brandMaster, productBrandMap);
  const productsWithBrandCode = catalog.filter((product) => productBrandCode(product)).length;
  const matchedOrderIds = new Set();
  for (const sales of brandSalesInput.salesByProduct.values()) {
    if (sales.orderIds instanceof Set) {
      for (const orderId of sales.orderIds) matchedOrderIds.add(orderId);
    }
  }
  const totals = brands.reduce((acc, brand) => {
    acc.salesAmount += Number(brand.salesAmount || 0);
    acc.quantitySold += Number(brand.quantitySold || 0);
    acc.soldProductCount += Number(brand.soldProductCount || 0);
    return acc;
  }, { salesAmount: 0, quantitySold: 0, orderCount: matchedOrderIds.size, soldProductCount: 0 });

  return {
    period: { since, until },
    brandCodeCoverage: {
      totalProducts: catalog.length,
      productsWithBrandCode,
      productsWithoutBrandCode: catalog.length - productsWithBrandCode
    },
    brandMaster: {
      totalBrands: brandMaster.brandCount || 0,
      suggestedCount: brandMaster.suggestedCount || 0,
      confirmedCount: brandMaster.confirmedCount || 0
    },
    totals,
    productBrandBackfill,
    brands
  };
}

function daysBetweenDateKeys(since, until) {
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  const days = Math.round((end - start) / 86400000) + 1;
  return Math.max(1, days);
}

const PRODUCT_ACTION_THRESHOLDS = {
  salesWindowDays: 30,
  recentWindowDays: 7,
  criticalStockUnits: 0,
  lowStockUnits: 3,
  healthyStockUnits: 6,
  noSalesDays: 30,
  minimumSalesForPush: 2,
  minimumRevenueForPush: 150000,
  minimumSalesForObserve: 1,
  minimumRoasForPush: 2,
  minimumCtrForInterest: 1,
  minimumSpendForStop: 30000
};

const PRODUCT_ACTION_LABELS = {
  push_now: "Push Now",
  observe: "Observe",
  hold: "Hold",
  stop_promotion: "Stop Promotion"
};

function trustedCafe24OrderDate(order = {}) {
  const candidates = [
    order.order_date,
    order.orderDate,
    order.ordered_date,
    order.order_timestamp,
    order.payment_date,
    order.paid_date,
    order.created_date
  ];
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text) && Number.isFinite(new Date(text).getTime())) return text.slice(0, 10);
  }
  return null;
}

function daysSinceDate(dateText, now = new Date()) {
  if (!dateText) return null;
  const time = new Date(`${String(dateText).slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / 86400000));
}

function productAgeDays(row) {
  if (!row.createdDate) return null;
  const time = new Date(row.createdDate).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function productActionBase(action, confidence, reasons = [], warnings = [], subReason = null) {
  return {
    action,
    label: PRODUCT_ACTION_LABELS[action] || action,
    confidence,
    subReason,
    reasons,
    warnings,
    dataQuality: {
      cafe24: "confirmed",
      meta: "unavailable"
    }
  };
}

function productStockRisk(inventoryQuantity, thresholds = PRODUCT_ACTION_THRESHOLDS) {
  if (inventoryQuantity <= thresholds.criticalStockUnits) return "out_of_stock";
  if (inventoryQuantity <= thresholds.lowStockUnits) return "low";
  if (inventoryQuantity >= thresholds.healthyStockUnits) return "healthy";
  return "limited";
}

function formatKrwShort(value) {
  return `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
}

function computeProductAction(row, thresholds = PRODUCT_ACTION_THRESHOLDS) {
  const inventoryQuantity = Number(row.inventoryQuantity || 0);
  const quantitySold = Number(row.quantitySold || 0);
  const salesAmount = Number(row.salesAmount || 0);
  const orderCount = Number(row.orderCount || 0);
  const daysOfStockLeft = row.daysOfStockLeft === null || row.daysOfStockLeft === undefined ? null : Number(row.daysOfStockLeft);
  const options = Array.isArray(row.options) ? row.options : [];
  const hasOptions = options.length > 0;
  const allOptionQuantitiesZero = hasOptions && options.every((option) => Number(option.quantity || 0) <= 0);
  const soldOutFlagConflict = (row.soldOut === true && inventoryQuantity > 0)
    || options.some((option) => option.soldOut === true && Number(option.quantity || 0) > 0);
  const warnings = [];
  if (soldOutFlagConflict) warnings.push("옵션 품절 플래그와 실제 재고 수량이 일치하지 않습니다.");

  const baseReasons = [
    `선택 기간 ${quantitySold.toLocaleString("ko-KR")}개 판매`,
    `매출 ${formatKrwShort(salesAmount)}`,
    `현재 재고 ${inventoryQuantity.toLocaleString("ko-KR")}개`
  ];

  if (row.display === "F") {
    return productActionBase("stop_promotion", "high", ["진열 중지 상태", ...baseReasons.slice(0, 2)], warnings);
  }
  if (row.selling === "F") {
    return productActionBase("stop_promotion", "high", ["판매 중지 상태", ...baseReasons.slice(0, 2)], warnings);
  }
  if (inventoryQuantity <= thresholds.criticalStockUnits) {
    return productActionBase("stop_promotion", "high", ["실제 총재고 0개", ...baseReasons.slice(0, 2)], warnings);
  }
  if (allOptionQuantitiesZero) {
    return productActionBase("stop_promotion", "high", ["모든 옵션 수량 0개", ...baseReasons.slice(0, 2)], warnings);
  }

  if (quantitySold >= 1 && inventoryQuantity <= thresholds.lowStockUnits) {
    return productActionBase("hold", "high", [
      `선택 기간 ${quantitySold.toLocaleString("ko-KR")}개 판매`,
      `현재 재고 ${inventoryQuantity.toLocaleString("ko-KR")}개`,
      "판매는 있으나 재고 부족"
    ], warnings);
  }
  if (Number.isFinite(daysOfStockLeft) && daysOfStockLeft <= thresholds.recentWindowDays) {
    return productActionBase("hold", "high", [
      `소진 예상 ${daysOfStockLeft.toLocaleString("ko-KR")}일`,
      `현재 재고 ${inventoryQuantity.toLocaleString("ko-KR")}개`,
      "품절 위험 높음"
    ], warnings);
  }

  if (
    quantitySold >= thresholds.minimumSalesForPush
    && salesAmount >= thresholds.minimumRevenueForPush
    && inventoryQuantity >= thresholds.healthyStockUnits
  ) {
    return productActionBase("push_now", "medium", [
      `선택 기간 ${quantitySold.toLocaleString("ko-KR")}개 판매`,
      `매출 ${formatKrwShort(salesAmount)}`,
      `현재 재고 ${inventoryQuantity.toLocaleString("ko-KR")}개`
    ], warnings);
  }

  const ageDays = productAgeDays(row);
  const isNewProduct = ageDays !== null && ageDays <= thresholds.salesWindowDays;
  if (quantitySold >= thresholds.minimumSalesForObserve) {
    return productActionBase("observe", "medium", [
      `선택 기간 ${quantitySold.toLocaleString("ko-KR")}개 판매`,
      `주문 ${orderCount.toLocaleString("ko-KR")}건`,
      "Push 기준에는 아직 미달"
    ], warnings, "single_sale");
  }
  if (isNewProduct) {
    return productActionBase("observe", "low", [
      `신규 상품 (${ageDays.toLocaleString("ko-KR")}일 경과)`,
      `현재 재고 ${inventoryQuantity.toLocaleString("ko-KR")}개`,
      "판매 데이터 축적 필요"
    ], warnings, "new_product");
  }

  const daysSinceLastSale = daysSinceDate(row.lastSaleDate);
  if (
    quantitySold === 0
    && inventoryQuantity >= thresholds.healthyStockUnits
    && daysSinceLastSale !== null
    && daysSinceLastSale >= thresholds.noSalesDays
    && !isNewProduct
  ) {
    return productActionBase("stop_promotion", "medium", [
      `${daysSinceLastSale.toLocaleString("ko-KR")}일 이상 판매 없음`,
      `현재 재고 ${inventoryQuantity.toLocaleString("ko-KR")}개`,
      "재고 충분하나 장기간 무판매"
    ], warnings);
  }

  return productActionBase("observe", "low", [
    "판매 이력 부족",
    `현재 재고 ${inventoryQuantity.toLocaleString("ko-KR")}개`,
    row.lastSaleDate ? `마지막 판매일 ${row.lastSaleDate}` : "마지막 판매일 확인 불가"
  ], warnings, row.lastSaleDate ? null : "no_history");
}

function computeCafe24ProductAiAction(row) {
  const productAction = row.productAction || computeProductAction(row);
  const legacy = {
    push_now: "Push",
    observe: "Observe",
    hold: "Hold",
    stop_promotion: "Stop"
  };
  return {
    action: legacy[productAction.action] || productAction.label,
    reason: productAction.reasons?.[0] || productAction.label
  };
}

function emptyProductActionSummary() {
  return { push_now: 0, observe: 0, hold: 0, stop_promotion: 0 };
}

function summarizeProductActions(products = []) {
  const summary = emptyProductActionSummary();
  for (const product of products) {
    const action = product.productAction?.action;
    if (Object.prototype.hasOwnProperty.call(summary, action)) summary[action] += 1;
  }
  return summary;
}

function metaReferenceFromSummary(meta = {}) {
  const totals = meta.totals || {};
  return {
    error: meta.error || null,
    spend: Number(totals.spend || 0),
    roas: totals.roas === null || totals.roas === undefined ? null : Number(totals.roas),
    purchases: Number(totals.purchases || totals.metaPurchases || 0),
    purchaseValue: Number(totals.purchaseValue || 0),
    ctr: Number(totals.ctr || 0),
    cpc: Number(totals.cpc || 0),
    note: "기간 참고치입니다 — 상품별로 배분된 값이 아닙니다."
  };
}

// 로컬(proxy 모드)에서는 상품 카탈로그를 Cafe24에 직접 요청하지 않는다 — 로컬 .env의
// Cafe24 토큰은 재인증(콜백이 Render로 감) 이후 더 이상 갱신되지 않아 invalid_token이 난다.
// Orders와 동일하게 CAFE24_PROXY_BASE_URL(Render)로 위임하고, 실패 시에만 로컬 캐시로
// 폴백한다. (2026-07-10 Product Dashboard invalid_token 수정)
async function fetchProductDashboardFromProxy(since, until, options = {}) {
  const base = env.CAFE24_PROXY_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}/api/products/dashboard`);
  url.searchParams.set("since", since);
  url.searchParams.set("until", until);
  if (options.refresh) url.searchParams.set("refresh", "1");
  if (options.productLimit) url.searchParams.set("productLimit", String(options.productLimit));
  if (options.orderLimit) url.searchParams.set("orderLimit", String(options.orderLimit));
  const cacheFile = join(workDir, `product-dashboard-proxy-${since}_${until}.json`);
  try {
    const response = await fetch(url, { headers: cafe24ProxyHeaders() });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      const hint = response.status === 404
        ? "Render 배포본에 /api/products/dashboard가 아직 없습니다. 최신 코드를 push/배포하세요."
        : text.slice(0, 80);
      throw Object.assign(new Error(`Product Dashboard proxy가 JSON이 아닌 응답을 보냈습니다: ${response.status} ${hint}`), { status: response.status });
    }
    if (!response.ok || body.error) {
      const error = new Error(body.error || body.message || `Product Dashboard proxy error ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    const result = { ...body, source: "product_dashboard_proxy", proxyBaseUrl: base };
    await mkdir(workDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    await logApiError("product_dashboard_proxy", error, { since, until });
    if (existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(await readFile(cacheFile, "utf8"));
        return {
          ...cached,
          source: "product_dashboard_proxy_cached",
          cacheMode: "fallback_after_error",
          cacheWarning: safeErrorMessage(error)
        };
      } catch {
        // 캐시 파일이 깨졌으면 원 오류를 그대로 던진다.
      }
    }
    throw error;
  }
}

async function buildProductDashboardWithCache(since, until, options = {}) {
  if (env.CAFE24_PROXY_BASE_URL) {
    return await fetchProductDashboardFromProxy(since, until, options);
  }
  const days = daysBetweenDateKeys(since, until);
  const [ordersResult, catalogResult, metaResult] = await Promise.all([
    fetchCafe24Orders(since, until, { limit: options.orderLimit || 500 }).catch((error) => ({ error: error.message, orders: [], totals: {} })),
    buildCafe24ProductCatalogWithCache({ refresh: options.refresh, limit: options.productLimit }),
    buildMetaAdsSummaryWithCache(since, until, { refresh: false }).catch((error) => ({ error: error.message, totals: {} }))
  ]);

  if (catalogResult.ok === false && catalogResult.reason === "insufficient_scope") {
    return {
      ok: false,
      reason: "insufficient_scope",
      message: catalogResult.message,
      since,
      until,
      metaReference: metaReferenceFromSummary(metaResult),
      actionSummary: emptyProductActionSummary(),
      products: [],
      unmatched: { count: 0, amount: 0 }
    };
  }

  const orders = ordersResult.orders || ordersResult.data || [];
  // (2026-07-10 상품 Join 구조 개선) Orders → product_no Set → Cache Lookup →
  // 캐시에 없는 product만 추가 조회 → Merge → Join 순서로 수행한다.
  const onDemand = await ensureCatalogCoversOrderProducts(catalogResult, orders);
  const catalog = catalogResult.products || [];
  const {
    salesByProduct,
    unmatchedCount,
    unmatchedAmount,
    orderCount,
    itemCount,
    matchedCount,
    unmatchedItems,
    unmatchedReasons
  } = matchCafe24OrdersToProducts(orders, catalog, {
    negativeProducts: catalogResult.missingProducts || {},
    failedProductNos: onDemand.failedProductNos
  });
  let salesHistoryDiagnostics = { source: "product_sales_history", cacheFile: "product-sales-history.json", seeded: null, currentPeriodMerge: null };
  let productSalesHistory = await readProductSalesHistoryCache();
  try {
    const seeded = await seedProductSalesHistoryFromOrderCaches(productSalesHistory, catalog);
    const currentPeriodMerge = mergeCurrentSalesIntoProductHistory(productSalesHistory, salesByProduct);
    if (seeded.scanned || currentPeriodMerge.updatedProducts > 0) {
      await writeProductSalesHistoryCache(productSalesHistory);
    }
    salesHistoryDiagnostics = { ...salesHistoryDiagnostics, seeded, currentPeriodMerge };
  } catch (error) {
    salesHistoryDiagnostics = { ...salesHistoryDiagnostics, error: safeErrorMessage(error) };
    await logApiError("product_sales_history", error, { stage: "merge" });
  }

  const products = catalog.map((product) => {
    const sales = salesByProduct.get(product.productNo) || { quantity: 0, amount: 0, orderIds: new Set(), lastSaleDate: null };
    const historyKey = productSalesHistoryKey(product);
    const historyLastSaleDate = historyKey ? productSalesHistory.products?.[historyKey]?.lastSaleDate || null : null;
    const lastSaleDate = maxIsoDate(historyLastSaleDate, sales.lastSaleDate);
    const salesVelocityPerDay = sales.quantity / days;
    const daysOfStockLeft = salesVelocityPerDay > 0 ? Math.round(product.inventoryQuantity / salesVelocityPerDay) : null;
    const row = {
      ...product,
      quantitySold: sales.quantity,
      salesAmount: sales.amount,
      orderCount: sales.orderIds?.size || 0,
      lastSaleDate,
      salesVelocityPerDay,
      daysOfStockLeft,
      stockRisk: productStockRisk(Number(product.inventoryQuantity || 0))
    };
    row.productAction = computeProductAction(row);
    const ai = computeCafe24ProductAiAction(row);
    row.aiAction = ai.action;
    row.aiActionReason = ai.reason;
    return row;
  });
  const actionSummary = summarizeProductActions(products);

  return {
    ok: true,
    since,
    until,
    catalogSource: catalogResult.source,
    catalogSyncedAt: catalogResult.syncedAt || null,
    cacheMode: catalogResult.cacheMode || null,
    catalogTtl: {
      ttlMs: CAFE24_CATALOG_TTL_MS,
      ageMs: catalogResult.cacheAgeMs ?? null,
      staleRefreshTriggered: catalogResult.staleRefreshTriggered || false
    },
    onDemandFetch: onDemand,
    join: {
      orderCount,
      itemCount,
      matched: matchedCount,
      unmatched: unmatchedCount,
      successRate: itemCount ? Math.round((matchedCount / itemCount) * 1000) / 10 : null
    },
    metaReference: metaReferenceFromSummary(metaResult),
    salesHistory: salesHistoryDiagnostics,
    actionSummary,
    products,
    unmatched: { count: unmatchedCount, amount: unmatchedAmount },
    unmatchedDetail: {
      count: unmatchedCount,
      amount: unmatchedAmount,
      reasons: unmatchedReasons,
      items: unmatchedItems
    },
    ordersError: ordersResult.error || null
  };
}

// Join 진단용 읽기 전용 리포트. 조회 주문/품목/상품 수, Join 성공·실패, 누락 product_no/
// variant_code, 누락 이유를 한 번에 보여준다. proxy 모드(로컬)에서는 Render의 동일
// endpoint로 위임한다. (2026-07-10 상품 Join 구조 개선)
async function buildProductJoinReport(since, until) {
  if (env.CAFE24_PROXY_BASE_URL) {
    const base = env.CAFE24_PROXY_BASE_URL.replace(/\/$/, "");
    const url = new URL(`${base}/api/diagnostics/product-join-report`);
    url.searchParams.set("since", since);
    url.searchParams.set("until", until);
    const response = await fetch(url, { headers: cafe24ProxyHeaders() });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      const hint = response.status === 404
        ? "Render 배포본에 /api/diagnostics/product-join-report가 아직 없습니다. 최신 코드를 push/배포하세요."
        : text.slice(0, 80);
      throw Object.assign(new Error(`Join report proxy가 JSON이 아닌 응답을 보냈습니다: ${response.status} ${hint}`), { status: response.status });
    }
    if (!response.ok || body.error) {
      throw Object.assign(new Error(body.error || body.message || `Join report proxy error ${response.status}`), { status: response.status });
    }
    return { ...body, source: "product_join_report_proxy", proxyBaseUrl: base };
  }
  const dashboard = await buildProductDashboardWithCache(since, until, {});
  if (dashboard.ok === false) return dashboard;
  const items = dashboard.unmatchedDetail?.items || [];
  return {
    ok: true,
    source: "product_join_report",
    since,
    until,
    orderCount: dashboard.join?.orderCount ?? null,
    itemCount: dashboard.join?.itemCount ?? null,
    productCount: (dashboard.products || []).length,
    joinMatched: dashboard.join?.matched ?? null,
    joinUnmatched: dashboard.join?.unmatched ?? null,
    joinSuccessRatePercent: dashboard.join?.successRate ?? null,
    unmatchedAmount: dashboard.unmatched?.amount ?? null,
    reasons: dashboard.unmatchedDetail?.reasons || [],
    missingProductNos: [...new Set(items.map((item) => item.productNo).filter(Boolean))],
    missingVariantCodes: [...new Set(items.map((item) => item.variantCode).filter(Boolean))],
    unmatchedItems: items,
    onDemandFetch: dashboard.onDemandFetch || null,
    catalogTtl: dashboard.catalogTtl || null,
    catalogSyncedAt: dashboard.catalogSyncedAt || null
  };
}

async function importCafe24Csv(csvText, csvFile = "cafe24-upload.csv") {
  if (!csvText.trim()) throw new Error("CSV 내용이 비어 있습니다.");
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("CSV 행을 읽지 못했습니다.");
  const headers = rows[0].map(cleanCsvHeader);
  const data = rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  const grouped = new Map();

  for (const row of data) {
    const date = cafe24CsvOrderDate(row);
    if (!date) continue;
    const month = date.slice(0, 7);
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month).push({ ...row, _orderDate: date });
  }

  await mkdir(workDir, { recursive: true });
  const imported = [];
  for (const [month, rows] of [...grouped.entries()].sort()) {
    const result = buildCafe24CsvMonth(month, rows, csvFile);
    const file = join(workDir, `cafe24-csv-orders-${result.startDate}_${result.endDate}.json`);
    await writeFile(file, JSON.stringify(result, null, 2));
    imported.push({
      month,
      file: file.split("/").at(-1),
      totals: result.totals
    });
  }

  return {
    ok: true,
    source: "cafe24_csv_import",
    csvFile,
    imported,
    message: `${imported.length}개월 Cafe24 CSV 데이터를 저장했습니다.`
  };
}

function buildCafe24CsvMonth(month, rows, csvFile) {
  const ordersById = new Map();
  const productMap = new Map();
  const paymentMap = new Map();

  for (const row of rows) {
    const orderId = row["주문번호"];
    const quantity = Number(row["수량"] || 0);
    const salePrice = parseMoney(row["판매가"]);
    const itemAmount = salePrice * quantity;
    const item = {
      itemOrderId: row["품목별 주문번호"],
      productNo: row["상품번호"],
      productName: row["주문상품명"],
      productNameWithOption: row["주문상품명(옵션포함)"],
      quantity,
      salePrice,
      itemAmount
    };

    if (!ordersById.has(orderId)) {
      ordersById.set(orderId, {
        order_id: orderId,
        order_date: row._orderDate,
        order_price_amount: parseMoney(row["총 주문금액"]),
        actual_payment_amount: parseMoney(row["총 결제금액"]),
        payment_method: row["결제수단"],
        payment_type: row["결제구분"],
        mall: row["쇼핑몰"],
        items: []
      });
    }
    ordersById.get(orderId).items.push(item);

    const productKey = row["주문상품명"] || row["상품번호"] || "상품명 없음";
    const product = productMap.get(productKey) || { productName: productKey, productNo: row["상품번호"], quantity: 0, itemAmount: 0, itemCount: 0 };
    product.quantity += quantity;
    product.itemAmount += itemAmount;
    product.itemCount += 1;
    productMap.set(productKey, product);
  }

  const orders = [...ordersById.values()].sort((a, b) => String(a.order_date).localeCompare(String(b.order_date)) || String(a.order_id).localeCompare(String(b.order_id)));
  for (const order of orders) {
    const paymentMethod = order.payment_method || "미확인";
    const payment = paymentMap.get(paymentMethod) || { paymentMethod, orderCount: 0, orderAmount: 0 };
    payment.orderCount += 1;
    payment.orderAmount += Number(order.actual_payment_amount || 0);
    paymentMap.set(paymentMethod, payment);
  }

  const startDate = `${month}-01`;
  const endDate = csvMonthEnd(month, rows);
  const orderAmount = orders.reduce((total, order) => total + Number(order.actual_payment_amount || 0), 0);
  const itemAmount = rows.reduce((total, row) => total + parseMoney(row["판매가"]) * Number(row["수량"] || 0), 0);

  return {
    source: "cafe24_csv_import",
    csvFile,
    syncedAt: new Date().toISOString(),
    startDate,
    endDate,
    orders,
    totals: {
      orderCount: orders.length,
      itemCount: rows.length,
      quantity: rows.reduce((total, row) => total + Number(row["수량"] || 0), 0),
      orderAmount,
      grossOrderAmount: orders.reduce((total, order) => total + Number(order.order_price_amount || 0), 0),
      itemAmount,
      averageOrderAmount: orders.length ? Math.round(orderAmount / orders.length) : 0
    },
    topProducts: [...productMap.values()].sort((left, right) => right.itemAmount - left.itemAmount).slice(0, 50),
    paymentMethods: [...paymentMap.values()].sort((left, right) => right.orderAmount - left.orderAmount)
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((csvRow) => csvRow.some((value) => String(value).trim() !== ""));
}

function cleanCsvHeader(header) {
  return String(header || "").replace(/^\uFEFF/, "").trim();
}

function parseMoney(value) {
  return Math.round(Number(String(value || "0").replace(/,/g, "")) || 0);
}

function cafe24CsvOrderDate(row) {
  const placedAt = String(row["발주일"] || "").trim();
  if (placedAt) return placedAt.slice(0, 10);
  const orderId = String(row["주문번호"] || "");
  if (/^\d{8}/.test(orderId)) return `${orderId.slice(0, 4)}-${orderId.slice(4, 6)}-${orderId.slice(6, 8)}`;
  return "";
}

function csvMonthEnd(month, rows) {
  const dates = rows.map((row) => row._orderDate).filter(Boolean).sort();
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return dates.at(-1) || `${month}-${String(lastDay).padStart(2, "0")}`;
}

async function checkCafe24Health() {
  if (env.CAFE24_PROXY_BASE_URL) {
    const base = env.CAFE24_PROXY_BASE_URL.replace(/\/$/, "");
    const url = new URL(`${base}/api/status`);
    const headers = cafe24ProxyHeaders();
    const response = await fetch(url, { headers });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return {
        ok: false,
        source: "cafe24_proxy_status",
        message: `Render 상태 응답을 읽지 못했습니다: ${response.status}`
      };
    }
    if (!response.ok || body.error) {
      return {
        ok: false,
        source: "cafe24_proxy_status",
        message: body.error || body.message || `Render 상태 확인 실패: ${response.status}`
      };
    }
    const token = body.cafe24Token || {};
    const ready = Boolean(token.hasAccessToken && token.hasRefreshToken && !token.reauthRequired);
    return {
      ok: ready,
      source: "cafe24_proxy_status",
      message: ready ? "Render Cafe24 토큰 확인" : token.reauthRequired ? "Render Cafe24 재인증 필요" : "Render Cafe24 토큰 정보 부족",
      detail: {
        tokenSource: token.source || null,
        status: token.status || null,
        updatedAt: token.updatedAt || null,
        expiresAt: token.expiresAt || null,
        needsRefresh: Boolean(token.needsRefresh),
        reauthRequired: Boolean(token.reauthRequired)
      }
    };
  }

  const token = await cafe24TokenDiagnostics();
  const ready = Boolean(env.CAFE24_MALL_ID && token.hasAccessToken && token.hasRefreshToken && !token.reauthRequired);
  return {
    ok: ready,
    source: "token_store",
    message: ready ? "Cafe24 토큰 저장소 확인" : token.reauthRequired ? "Cafe24 재인증 필요" : "Cafe24 토큰 정보 부족",
    detail: token
  };
}

function cafe24ProxyHeaders() {
  const headers = {};
  if (env.CAFE24_PROXY_SECRET) headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
  if (env.CAFE24_PROXY_BASIC_AUTH) {
    headers.Authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
  }
  return headers;
}

async function cafe24GetOrders(startDate, endDate, options = {}) {
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/orders`);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("embed", "items");
  const requestedLimit = Math.min(Number(options.limit || 500) || 500, 1000);
  const pageSize = Math.min(100, requestedLimit);
  const orders = [];
  for (let offset = 0; offset < requestedLimit; offset += pageSize) {
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    const body = await cafe24FetchOrdersPage(url);
    const pageOrders = body.orders || [];
    orders.push(...pageOrders);
    if (pageOrders.length < pageSize) break;
  }
  await attachCafe24OrderItems(orders);
  return { orders };
}

async function cafe24FetchOrdersPage(url) {
  const body = await cafe24FetchJson(url);
  if (!body.error) return body;
  if (url.searchParams.has("embed")) {
    url.searchParams.delete("embed");
    const fallbackBody = await cafe24FetchJson(url);
    if (!fallbackBody.error) return fallbackBody;
    throw fallbackBody.error;
  }
  throw body.error;
}

function cafe24ApiVersion() {
  return env.CAFE24_API_VERSION || env.CAFE24_ADMIN_API_VERSION || "2025-06-01";
}

function cafe24OrdersHeaders() {
  return {
    Authorization: `Bearer ${env.CAFE24_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    "X-Cafe24-Api-Version": cafe24ApiVersion()
  };
}

function safeCafe24OrdersUrl(url) {
  const safeUrl = new URL(url.toString());
  return safeUrl.toString();
}

function cafe24OrdersDebugContext(url, extra = {}) {
  const headers = cafe24OrdersHeaders();
  return {
    mallId: env.CAFE24_MALL_ID || null,
    configuredScopes: env.CAFE24_SCOPES || null,
    requestUrl: safeCafe24OrdersUrl(url),
    apiVersion: headers["X-Cafe24-Api-Version"],
    authorizationHeader: headers.Authorization ? `Bearer token present (${String(env.CAFE24_ACCESS_TOKEN || "").length} chars)` : "missing",
    contentType: headers["Content-Type"],
    hasClientId: Boolean(env.CAFE24_CLIENT_ID),
    hasClientSecret: Boolean(env.CAFE24_CLIENT_SECRET),
    hasAccessToken: Boolean(env.CAFE24_ACCESS_TOKEN),
    hasRefreshToken: Boolean(env.CAFE24_REFRESH_TOKEN),
    accessTokenExpiresAt: env.CAFE24_ACCESS_TOKEN_EXPIRES_AT || null,
    ...extra
  };
}

function compactCafe24Body(body) {
  if (!body || typeof body !== "object") return body;
  const compact = {};
  for (const key of ["error", "error_description", "message", "errors", "trace_id", "orders", "items", "order_items"]) {
    if (body[key] === undefined) continue;
    if (Array.isArray(body[key])) {
      compact[key] = key === "orders" || key === "items" || key === "order_items" ? `[array:${body[key].length}]` : body[key].slice(0, 3);
    } else {
      compact[key] = body[key];
    }
  }
  return Object.keys(compact).length ? compact : Object.keys(body).slice(0, 12);
}

async function logCafe24OrdersDebug(stage, data = {}) {
  const entry = {
    time: new Date().toISOString(),
    source: "cafe24_orders_debug",
    stage,
    ...data
  };
  console.info(`[CAFE24_ORDERS_DEBUG] ${JSON.stringify(entry)}`);
  try {
    await mkdir(workDir, { recursive: true });
    const file = join(workDir, "cafe24-orders-debug.ndjson");
    const existing = existsSync(file) ? await readFile(file, "utf8") : "";
    const lines = existing.split(/\r?\n/).filter(Boolean).slice(-199);
    lines.push(JSON.stringify(entry));
    await writeFile(file, `${lines.join("\n")}\n`);
  } catch (logError) {
    console.error(`[CAFE24_ORDERS_DEBUG_WRITE_FAILED] ${safeErrorMessage(logError)}`);
  }
}

async function cafe24FetchJson(url, options = {}) {
  await ensureCafe24AccessToken();
  await logCafe24OrdersDebug("request", cafe24OrdersDebugContext(url));
  const response = await fetch(url, {
    headers: cafe24OrdersHeaders()
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 500) };
  }
  await logCafe24OrdersDebug("response", cafe24OrdersDebugContext(url, {
    statusCode: response.status,
    ok: response.ok,
    responseBody: compactCafe24Body(body)
  }));
  if (!response.ok || body.error) {
    const message = body.error?.message || body.error_description || body.message || `Cafe24 API error ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    error.cafe24OrdersDebug = cafe24OrdersDebugContext(url, {
      statusCode: response.status,
      responseBody: compactCafe24Body(body)
    });
    // Cafe24 rate limit(429)이면 1.2초 대기 후 정확히 1회만 재시도한다. 읽기 전용 GET이라
    // 재시도해도 부작용이 없다. (2026-07-10 동시성 3 도입에 따른 안전장치)
    if (!options.retriedAfterRateLimit && response.status === 429) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1200));
      return await cafe24FetchJson(url, { ...options, retriedAfterRateLimit: true });
    }
    // invalid_token(401)이면 refresh 후 원 요청을 정확히 1회만 재시도한다.
    // retriedAfterRefresh 플래그로 재귀를 1단계로 제한 — 무한 재시도 금지.
    // (2026-07-10 Cafe24 401 refresh-retry — Products 경로에도 동일 적용)
    if (!options.retriedAfterRefresh && isCafe24InvalidToken(error)) {
      try {
        await refreshCafe24TokenSingleFlight();
        return await cafe24FetchJson(url, { ...options, retriedAfterRefresh: true });
      } catch (refreshError) {
        await logApiError("cafe24_refresh", refreshError, { stage: "cafe24_fetch_json_refresh" });
      }
    }
    return { error };
  }
  return body;
}

async function attachCafe24OrderItems(orders = []) {
  const activeOrders = orders.filter((order) => !isCafe24CanceledOrRefunded(order));
  const ordersNeedingItems = activeOrders.filter((order) => cafe24OrderItems(order).length === 0 && order.order_id);
  for (const order of ordersNeedingItems) {
    try {
      order.items = await cafe24GetOrderItems(order.order_id);
    } catch (error) {
      await logApiError("cafe24_order_items", error, { orderId: order.order_id });
      order.items = [];
      order.itemFetchError = error.message;
    }
  }
}

async function cafe24GetOrderItems(orderId) {
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/orders/${encodeURIComponent(orderId)}/items`);
  await ensureCafe24AccessToken();
  await logCafe24OrdersDebug("items_request", cafe24OrdersDebugContext(url, { orderId }));
  const response = await fetch(url, {
    headers: cafe24OrdersHeaders()
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 500) };
  }
  await logCafe24OrdersDebug("items_response", cafe24OrdersDebugContext(url, {
    orderId,
    statusCode: response.status,
    ok: response.ok,
    responseBody: compactCafe24Body(body)
  }));
  if (!response.ok || body.error) {
    const message = body.error?.message || body.error_description || body.message || `Cafe24 order item API error ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body.items || body.order_items || [];
}

// Product Dashboard를 만들기 전에 필요한 Cafe24 API 8종을 한 번에 점검합니다.
// 응답은 각 API마다 { apiName, ok, httpStatus, errorCode, message }만 담고(토큰/secret/
// Authorization 헤더는 어디에도 노출하지 않음), 마지막에 dashboardReady로 무엇이 준비됐고
// 무엇이 아직 안 됐는지 한눈에 보여줍니다.
async function diagnoseCafe24ProductAccess() {
  const mallId = env.CAFE24_MALL_ID || null;
  if (!mallId) {
    return {
      mallId,
      apiChecks: [],
      requestedFieldCheck: {},
      dashboardReady: {},
      message: "CAFE24_MALL_ID가 없습니다."
    };
  }
  try {
    await ensureCafe24AccessToken();
  } catch (error) {
    return {
      mallId,
      apiChecks: [],
      requestedFieldCheck: {},
      dashboardReady: {},
      message: safeErrorMessage(error)
    };
  }

  // Cafe24 에러 응답은 엔드포인트에 따라 { error: { code, message } } (리소스 API)와
  // { error, error_description } (OAuth 토큰 API) 두 형태가 섞여 있어 둘 다 처리합니다.
  const cafe24ErrorCode = (body) => body?.error?.code ?? body?.error_code ?? (typeof body?.error === "string" ? body.error : null);
  const cafe24ErrorMessage = (body) => body?.error?.message || body?.error_description || (typeof body?.error === "string" ? body.error : null) || body?.message || null;

  const call = async (path, params = {}) => {
    const url = new URL(`https://${mallId}.cafe24api.com/api/v2/admin${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    await ensureCafe24AccessToken();
    const response = await fetch(url, { headers: cafe24OrdersHeaders() });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  };

  // apiName/ok/httpStatus/errorCode/message만 apiChecks에 쌓고, 응답 본문(body)은
  // requestedFieldCheck 계산에만 내부적으로 쓰고 최종 응답에는 포함하지 않습니다.
  const apiChecks = [];
  const runCheck = async (apiName, path, params = {}) => {
    let r = await call(path, params);
    if (!r.ok && isCafe24InvalidToken({ message: cafe24ErrorMessage(r.body) || "", body: r.body })) {
      try {
        await refreshCafe24Token();
        r = await call(path, params);
      } catch (_refreshError) {
        // 재발급 실패 사유는 토큰 관련 문자열이 섞일 수 있어 응답/로그에 남기지 않습니다.
      }
    }
    apiChecks.push({ apiName, ok: r.ok, httpStatus: r.status, errorCode: cafe24ErrorCode(r.body), message: cafe24ErrorMessage(r.body) });
    return r;
  };

  const skip = (apiName, reason) => {
    apiChecks.push({ apiName, ok: false, httpStatus: null, errorCode: null, message: reason });
    return null;
  };

  const productsResult = await runCheck("products_list (GET /admin/products)", "/products", { limit: 3 });
  const firstProduct = productsResult.ok ? productsResult.body?.products?.[0] : null;

  let detailResult = null;
  let variantsResult = null;
  let imagesResult = null;
  let categoriesResult = null;
  let inventoriesResult = null;

  if (firstProduct?.product_no) {
    const no = firstProduct.product_no;
    detailResult = await runCheck("product_detail (GET /admin/products/{no})", `/products/${no}`, {});
    variantsResult = await runCheck("product_variants (GET /admin/products/{no}/variants)", `/products/${no}/variants`, { limit: 20 });
    imagesResult = await runCheck("product_images (GET /admin/products/{no}/images)", `/products/${no}/images`, {});
    categoriesResult = await runCheck("product_categories (GET /admin/products/{no}/categories)", `/products/${no}/categories`, {});
    inventoriesResult = await runCheck("product_inventories (GET /admin/products/{no}/inventories)", `/products/${no}/inventories`, {});
  } else {
    const reason = "products_list에서 product_no를 얻지 못해 시도하지 않음";
    detailResult = skip("product_detail (GET /admin/products/{no})", reason);
    variantsResult = skip("product_variants (GET /admin/products/{no}/variants)", reason);
    imagesResult = skip("product_images (GET /admin/products/{no}/images)", reason);
    categoriesResult = skip("product_categories (GET /admin/products/{no}/categories)", reason);
    inventoriesResult = skip("product_inventories (GET /admin/products/{no}/inventories)", reason);
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const salesReportResult = await runCheck("sales_products_report (GET /admin/reports/salesproducts)", "/reports/salesproducts", { start_date: monthAgo, end_date: today, shop_no: 1 });
  const ordersResult = await runCheck("orders (GET /admin/orders)", "/orders", { start_date: monthAgo, end_date: today, limit: 3 });

  // 요청하신 13개 필드가 products_list/product_detail/product_variants 세 응답 중
  // 어디에 실제로 존재하는지 재귀적으로 훑어 확인합니다. 정확한 이름뿐 아니라 Cafe24가
  // 흔히 쓰는 동의어(별칭)도 함께 찾되, 별칭으로 찾은 경우를 구분해 과장하지 않습니다.
  const FIELD_ALIASES = {
    product_no: ["product_no"],
    product_code: ["product_code"],
    product_name: ["product_name"],
    brand: ["brand", "brand_code", "brand_name"],
    category: ["category", "category_no", "categories"],
    option_name: ["option_name", "options"],
    option_value: ["option_value", "variants", "option_values"],
    inventory_quantity: ["inventory_quantity", "quantity", "stock_quantity", "safety_inventory_quantity"],
    sold_out: ["sold_out", "soldout"],
    display: ["display"],
    selling: ["selling"],
    created_date: ["created_date", "regist_date"],
    updated_date: ["updated_date", "modified_date"]
  };

  function deepFind(obj, keys, depth = 0, path = "") {
    if (depth > 4 || obj === null || typeof obj !== "object") return null;
    for (const key of Object.keys(obj)) {
      if (keys.includes(key)) return { path: path ? `${path}.${key}` : key };
    }
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value && typeof value === "object") {
        const nested = Array.isArray(value)
          ? deepFind(value[0] || {}, keys, depth + 1, `${path ? `${path}.` : ""}${key}[0]`)
          : deepFind(value, keys, depth + 1, `${path ? `${path}.` : ""}${key}`);
        if (nested) return nested;
      }
    }
    return null;
  }

  const sources = [
    { label: "products_list", body: firstProduct || null },
    { label: "product_detail", body: detailResult?.ok ? (detailResult.body?.product || detailResult.body) : null },
    { label: "product_variants", body: variantsResult?.ok ? (variantsResult.body?.variants?.[0] || variantsResult.body) : null }
  ];

  const requestedFieldCheck = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let hit = null;
    for (const source of sources) {
      if (!source.body) continue;
      const found = deepFind(source.body, aliases);
      if (found) { hit = { found: true, foundIn: source.label, path: found.path }; break; }
    }
    requestedFieldCheck[field] = hit || { found: false };
  }

  // Product Dashboard 구현에 필요한 6개 기능 단위로 묶어서 한눈에 보이게 합니다.
  // ✅ 정상 / ⚠ 일부만 됨(대체 경로 있음) / ❌ 전혀 안 됨.
  const dashboardReady = {
    Product: productsResult.ok && detailResult?.ok ? "✅" : (productsResult.ok || detailResult?.ok ? "⚠" : "❌"),
    Inventory: (variantsResult?.ok || inventoriesResult?.ok) ? (variantsResult?.ok && inventoriesResult?.ok ? "✅" : "⚠") : "❌",
    Sales: ordersResult.ok ? "✅" : "❌",
    Images: imagesResult?.ok ? "✅" : "❌",
    Categories: categoriesResult?.ok ? "✅" : "❌",
    "Product Sales Report": salesReportResult.ok ? "✅" : "❌"
  };

  return { mallId, apiChecks, requestedFieldCheck, dashboardReady };
}

async function refreshCafe24Token() {
  const record = await readCafe24TokenRecord();
  const required = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Cafe24 token refresh에 필요한 값이 없습니다: ${missing.join(", ")}`);
  }
  if (!record?.refreshToken) {
    throw new Error("Cafe24 token refresh에 필요한 refresh token이 저장소에 없습니다. 재인증 필요");
  }

  const url = `https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/token`;
  const credentials = Buffer.from(`${env.CAFE24_CLIENT_ID}:${env.CAFE24_CLIENT_SECRET}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: record.refreshToken
  });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    const body = await response.json();
    if (!response.ok || body.error) {
      const message = body.error_description || body.error?.message || body.message || `Cafe24 token refresh failed ${response.status}`;
      throw new Error(`${message} refresh token도 만료됐으면 Cafe24 OAuth 재인증이 필요합니다.`);
    }

    if (!body.access_token) {
      throw new Error("Cafe24 refresh 응답에 access_token이 없습니다.");
    }

    const updatedAt = new Date().toISOString();
    const saved = await writeCafe24TokenRecord({
      schema: 1,
      status: "active",
      accessToken: body.access_token,
      refreshToken: body.refresh_token || record.refreshToken,
      expiresAt: body.expires_at || record.expiresAt || null,
      updatedAt,
      lastRefreshAt: updatedAt,
      reauthRequiredAt: null,
      lastError: null
    });

    return {
      ok: true,
      updated: ["access_token", body.refresh_token ? "refresh_token" : null, body.expires_at ? "expires_at" : null].filter(Boolean),
      token: safeCafe24TokenRecord(saved)
    };
  } catch (error) {
    await markCafe24ReauthRequired(error);
    throw error;
  }
}

function buildCafe24AuthorizeUrl() {
  const required = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Cafe24 OAuth 시작에 필요한 값이 없습니다: ${missing.join(", ")}`);
  }
  const state = randomUUID();
  env.CAFE24_OAUTH_STATE = state;
  const redirectUri = cafe24RedirectUri();
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.CAFE24_CLIENT_ID);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  if (env.CAFE24_SCOPES) url.searchParams.set("scope", env.CAFE24_SCOPES);
  // 진단용 로그: redirect_uri 불일치("invalid_request: redirect_uri is invalid")를 추적하기 위해
  // 인코딩 전/후 redirect_uri와 전체 authorize URL을 출력한다. 토큰/시크릿은 포함하지 않는다.
  // (2026-07-08 Cafe24 redirect_uri 불일치 진단)
  console.log("[CAFE24_OAUTH_START]", {
    mallId: env.CAFE24_MALL_ID,
    redirectUriSource: env.CAFE24_REDIRECT_URI ? "env.CAFE24_REDIRECT_URI" : `fallback(http://${host}:${port}/...)`,
    redirectUriDecoded: redirectUri,
    redirectUriEncoded: encodeURIComponent(redirectUri),
    scopes: env.CAFE24_SCOPES || "(empty)",
    authorizeUrl: url.toString()
  });
  return url.toString();
}

async function handleCafe24OAuthCallback(callbackUrl) {
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const error = callbackUrl.searchParams.get("error");
  if (error) throw new Error(`Cafe24 OAuth error: ${error}`);
  if (!code) throw new Error("Cafe24 OAuth callback에 code가 없습니다.");
  if (env.CAFE24_OAUTH_STATE && state !== env.CAFE24_OAUTH_STATE) {
    throw new Error("Cafe24 OAuth state가 일치하지 않습니다. 재인증을 다시 시작하세요.");
  }

  const required = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Cafe24 OAuth token 교환에 필요한 값이 없습니다: ${missing.join(", ")}`);
  }

  const tokenUrl = `https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/token`;
  const credentials = Buffer.from(`${env.CAFE24_CLIENT_ID}:${env.CAFE24_CLIENT_SECRET}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cafe24RedirectUri()
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const message = body.error_description || body.error?.message || body.message || `Cafe24 OAuth token exchange failed ${response.status}`;
    throw new Error(message);
  }
  if (!body.access_token || !body.refresh_token) {
    throw new Error("Cafe24 OAuth 응답에 access_token 또는 refresh_token이 없습니다.");
  }

  const saved = await writeCafe24TokenRecord({
    schema: 1,
    status: "active",
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at || null,
    updatedAt: new Date().toISOString(),
    lastRefreshAt: null,
    reauthRequiredAt: null,
    lastError: null
  });

  return {
    ok: true,
    token: safeCafe24TokenRecord(saved)
  };
}

// cafe24OAuthSuccessHtml()은 이 자리에 있었으나 화면에 access_token/refresh_token 원문을
// 그대로 노출했다("Render Environment Variables에 그대로 업데이트하세요" 텍스트와 함께).
// 토큰/시크릿 값을 화면이나 로그에 노출하지 않는다는 요구사항에 따라 제거했다. 재인증 성공/실패는
// 이제 위 /api/cafe24/oauth/callback에서 "/"로 리다이렉트해 대시보드 SPA가 안내한다.
// (2026-07-08 Cafe24 재인증 흐름 개선 — 토큰 노출 제거)

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cafe24RedirectUri() {
  return env.CAFE24_REDIRECT_URI || `http://${host}:${port}/api/cafe24/oauth/callback`;
}

async function updateEnvFile(values) {
  const envPath = join(root, ".env");
  const current = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  const lines = current.split(/\r?\n/);
  const seen = new Set();
  const next = lines.map((line) => {
    const index = line.indexOf("=");
    if (index === -1 || line.trim().startsWith("#")) return line;
    const key = line.slice(0, index);
    if (!Object.prototype.hasOwnProperty.call(values, key)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  await writeFile(envPath, next.join("\n"));
}

function isCafe24InvalidToken(error) {
  const message = String(error.message || "").toLowerCase();
  const code = String(error.body?.error || error.body?.error_code || "").toLowerCase();
  return message.includes("invalid_token") || message.includes("access_token") || code.includes("invalid_token");
}

function cleanAdAccountId() {
  const id = env.META_AD_ACCOUNT_ID || "";
  return id && id !== "act_" ? id : "";
}

function missingEnv(keys) {
  return keys.filter((key) => !env[key] || (key === "META_AD_ACCOUNT_ID" && !cleanAdAccountId()));
}

function integrationStatus() {
  const instagramRequired = ["META_ACCESS_TOKEN", "FACEBOOK_PAGE_ID", "INSTAGRAM_BUSINESS_ACCOUNT_ID"];
  const metaAdsRequired = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"];
  const cafe24Required = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET", "CAFE24_TOKEN_STORE_DIR"];
  const cafe24ProxyRequired = ["CAFE24_PROXY_BASE_URL", "CAFE24_PROXY_ORDERS_PATH"];
  const cafe24DirectMissing = missingEnv(cafe24Required);
  const cafe24ProxyMissing = missingEnv(cafe24ProxyRequired);
  const cafe24Mode = cafe24ProxyMissing.length === 0 ? "proxy" : cafe24DirectMissing.length === 0 ? "local_oauth" : "not_configured";

  return {
    instagram: {
      ok: missingEnv(instagramRequired).length === 0,
      required: instagramRequired,
      missing: missingEnv(instagramRequired)
    },
    metaAds: {
      ok: missingEnv(metaAdsRequired).length === 0,
      required: metaAdsRequired,
      missing: missingEnv(metaAdsRequired)
    },
    cafe24: {
      ok: cafe24Mode !== "not_configured",
      mode: cafe24Mode,
      required: cafe24Mode === "proxy" ? cafe24ProxyRequired : cafe24Required,
      missing: cafe24Mode === "proxy" ? [] : cafe24DirectMissing
    }
  };
}

function actionValue(items = [], type) {
  const candidates = Array.isArray(type) ? type : [type];
  const expanded = candidates.flatMap((name) => [name, `offsite_conversion.fb_pixel_${name}`]);
  const found = (items || []).find((item) => expanded.includes(item.action_type));
  return Number(found?.value || 0);
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SAMPLAS Dashboard</title>
  <style>
    :root { color-scheme: dark; --bg:#111; --panel:#1b1b1b; --line:#333; --text:#f4f2ee; --muted:#aaa39b; --green:#5bd39b; --yellow:#ffc84a; --red:#ff6363; }
    * { box-sizing: border-box; }
    body { margin:0; background:#111; color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif; }
    .app { min-height:100vh; display:grid; grid-template-columns:320px 1fr; }
    aside { border-right:1px solid var(--line); padding:26px 22px; background:#151515; }
    main { padding:30px; }
    h1,h2,h3,p { margin:0; }
    .eyebrow { color:var(--muted); font-size:12px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
    h1 { margin-top:8px; font-size:28px; line-height:1.05; }
    .sync { margin-top:28px; display:grid; gap:15px; }
    .sync-row { display:grid; grid-template-columns:14px 1fr auto; gap:12px; align-items:center; }
    .dot { width:14px; height:14px; border-radius:50%; background:var(--yellow); }
    .sync-row.good .dot { background:var(--green); }
    .sync-row.bad .dot { background:var(--red); }
    .sync-row strong { display:block; font-size:22px; }
    .sync-row small { display:block; color:var(--muted); margin-top:4px; font-size:14px; line-height:1.35; }
    .pill { border:1px solid var(--line); border-radius:999px; padding:8px 12px; color:var(--muted); font-weight:900; }
    .sync-row.good .pill { color:var(--green); border-color:rgba(91,211,155,.55); }
    .sync-row.bad .pill { color:var(--red); border-color:rgba(255,99,99,.55); }
    .top { display:flex; justify-content:space-between; align-items:flex-start; gap:18px; margin-bottom:24px; }
    .top h2 { margin-top:8px; font-size:34px; letter-spacing:-.02em; }
    select,button { border:1px solid var(--line); border-radius:12px; background:#181818; color:var(--text); font:inherit; font-weight:800; padding:12px 14px; }
    button { cursor:pointer; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
    .card { border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:18px; min-height:116px; }
    .card span { color:var(--muted); font-size:13px; font-weight:800; }
    .card strong { display:block; margin-top:12px; font-size:30px; letter-spacing:-.02em; }
    .card p { margin-top:8px; color:var(--muted); font-size:13px; line-height:1.45; }
    .panel { margin-top:14px; border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:18px; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    th,td { border-bottom:1px solid var(--line); padding:12px 8px; text-align:left; vertical-align:top; }
    th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .notice { margin-top:14px; color:var(--muted); line-height:1.55; }
    @media (max-width:900px) { .app { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid var(--line); } .grid { grid-template-columns:1fr 1fr; } }
    @media (max-width:560px) { .grid { grid-template-columns:1fr; } .top { display:grid; } }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <p class="eyebrow">SAMPLAS</p>
      <h1>Instagram Marketing OS</h1>
      <div class="sync">
        <div id="instagramStatus" class="sync-row"><span class="dot"></span><div><strong>Instagram</strong><small>확인 중</small></div><em class="pill">...</em></div>
        <div id="metaStatus" class="sync-row"><span class="dot"></span><div><strong>Meta Ads</strong><small>확인 중</small></div><em class="pill">...</em></div>
        <div id="cafeStatus" class="sync-row"><span class="dot"></span><div><strong>Cafe24</strong><small>확인 중</small></div><em class="pill">...</em></div>
      </div>
    </aside>
    <main>
      <section class="top">
        <div>
          <p class="eyebrow">Monthly intelligence for @samplaskr</p>
          <h2>Instagram Dashboard</h2>
          <p class="notice">과거 월은 CSV 고정 데이터, 현재 월은 API/캐시 기준으로 표시합니다.</p>
        </div>
        <div>
          <select id="month"></select>
          <button id="reload" type="button">새로고침</button>
        </div>
      </section>
      <section id="kpis" class="grid"></section>
      <section class="panel">
        <p class="eyebrow">Meta Ads</p>
        <h3>광고 요약</h3>
        <div id="metaPanel" class="notice">확인 중</div>
      </section>
      <section class="panel">
        <p class="eyebrow">Monthly Posts</p>
        <h3>게시물 데이터</h3>
        <div id="posts"></div>
      </section>
    </main>
  </div>
  <script>
    const months = ["2026-07","2026-06","2026-05","2026-04","2026-03","2026-02","2026-01"];
    const monthSelect = document.querySelector("#month");
    monthSelect.innerHTML = months.map((month) => '<option value="' + month + '">' + month + '</option>').join("");
    document.querySelector("#reload").addEventListener("click", () => load({ forceRefresh: true }));
    monthSelect.addEventListener("change", () => load());
    const num = (value) => Number(value || 0).toLocaleString("ko-KR");
    const krw = (value) => Math.round(Number(value || 0) / 10000).toLocaleString("ko-KR") + "만원";
    const pct = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(1) + "%" : "-";

    function setStatus(id, ok, label, detail, badge) {
      const row = document.querySelector(id);
      row.classList.toggle("good", ok);
      row.classList.toggle("bad", ok === false);
      row.querySelector("small").textContent = detail;
      row.querySelector(".pill").textContent = badge || label;
    }

    async function readJson(url) {
      const response = await fetch(url, { cache: "no-store" });
      const text = await response.text();
      try { return JSON.parse(text); }
      catch { return { error: text.slice(0, 120) }; }
    }

    function renderKpis(data) {
      const account = data.account || {};
      const cards = [
        ["팔로워", num(account.followers), "순증 +" + num(account.followerDelta)],
        ["도달", num(account.reach), "전월 대비 " + pct(account.reachDelta)],
        ["조회수", num(account.views), "전월 대비 " + pct(account.viewsDelta)],
        ["프로필 방문", num(account.profileVisits), "전월 대비 " + pct(account.profileVisitDelta)],
        ["링크 클릭", num(account.websiteClicks), "전월 대비 " + pct(account.websiteClickDelta)],
        ["상호작용", num(account.accountEngagement), data.source === "csv_import" ? "CSV 반영" : "API/캐시"],
        ["게시물", num((data.posts || []).length) + "개", "게시물별 캐시 유지"],
        ["데이터 출처", data.source || "-", data.cacheWarning ? data.cacheWarning.slice(0, 80) : "정상 표시"]
      ];
      document.querySelector("#kpis").innerHTML = cards.map(([label, value, note]) =>
        '<article class="card"><span>' + label + '</span><strong>' + value + '</strong><p>' + note + '</p></article>'
      ).join("");
    }

    function renderPosts(data) {
      const posts = (data.posts || []).slice(0, 12);
      if (!posts.length) {
        document.querySelector("#posts").innerHTML = '<p class="notice">이 월에는 게시물별 데이터가 없습니다.</p>';
        return;
      }
      document.querySelector("#posts").innerHTML = '<table><thead><tr><th>날짜</th><th>콘텐츠</th><th>도달</th><th>조회</th><th>상호작용</th></tr></thead><tbody>' +
        posts.map((post) => '<tr><td>' + (post.date || '-') + '</td><td>' + (post.title || '-') + '</td><td>' + num(post.reach) + '</td><td>' + num(post.views) + '</td><td>' + num(post.totalInteractions || post.likes + post.comments + post.saves + post.shares) + '</td></tr>').join("") +
        '</tbody></table>';
    }

    async function load(options) {
      const month = monthSelect.value;
      const refreshQuery = (options && options.forceRefresh) ? '&refresh=1' : '';
      const data = await readJson('/api/instagram/monthly?month=' + month + refreshQuery);
      setStatus("#instagramStatus", !data.error, "캐시", data.error ? data.error : (data.source === "csv_import" ? "CSV 고정 데이터 기준" : "API/캐시 기준"), data.source === "csv_import" ? "CSV" : "캐시");
      renderKpis(data.error ? { account: {}, posts: [], source: "오류" } : data);
      renderPosts(data.error ? { posts: [] } : data);

      const meta = await readJson('/api/meta-ads/summary?since=' + month + '-01&until=' + monthEnd(month));
      setStatus("#metaStatus", !meta.error, "캐시", meta.error ? meta.error : (meta.source && meta.source.includes("_cached") ? "저장된 광고 데이터 기준" : "연결 확인"), meta.source && meta.source.includes("_cached") ? "캐시" : "100%");
      document.querySelector("#metaPanel").textContent = meta.error ? meta.error : "광고비 " + krw(meta.totals && meta.totals.spend) + " / 캠페인 " + num((meta.campaigns || []).length) + "개 / 출처 " + (meta.source || "-");

      const cafe = await readJson('/api/cafe24/health');
      setStatus("#cafeStatus", cafe.ok === true || !cafe.error, "100%", cafe.message || cafe.error || "Cafe24 확인", cafe.ok === true || !cafe.error ? "100%" : "오류");
    }

    function monthEnd(month) {
      const [year, m] = month.split("-").map(Number);
      return new Date(year, m, 0).toISOString().slice(0, 10);
    }

    load();
  </script>
</body>
</html>`;
}

function html(res, text, status = 200) {
  const encoded = Buffer.from(text);
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": encoded.length
  });
  res.end(encoded);
}

async function serveFile(res, filePath) {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(outputDir) && !resolved.startsWith(root)) {
    return json(res, { error: "Forbidden" }, 403);
  }
  if (!existsSync(resolved)) {
    return json(res, { error: "Not found" }, 404);
  }
  const content = await readFile(resolved);
  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(resolved)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  res.end(content);
}

function json(res, value, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(value, null, 2));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function graphGet(path, params = {}) {
  if (!env.META_ACCESS_TOKEN) {
    throw new Error(".env에 META_ACCESS_TOKEN이 없습니다.");
  }
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", env.META_ACCESS_TOKEN);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message || `Graph API error ${response.status}`);
    error.status = response.status;
    error.body = body;
    error.code = body.error?.code;
    error.type = body.error?.type;
    throw error;
  }
  return body;
}

// Meta의 paging.next는 access_token까지 포함된 완전한 URL이라 그대로 fetch합니다.
async function graphGetRawUrl(fullUrl) {
  const response = await fetch(fullUrl);
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message || `Graph API error ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

// 캠페인 목록/Insights처럼 계정 규모에 따라 여러 페이지로 나뉠 수 있는 응답을 모두 모읍니다.
// 안전장치로 최대 페이지 수를 제한합니다(계정이 비정상적으로 커도 무한 루프에 빠지지 않도록).
async function graphGetAllPages(path, params = {}, { maxPages = 10 } = {}) {
  const results = [];
  let body = await graphGet(path, params);
  results.push(...(body.data || []));
  let pages = 1;
  while (body.paging?.next && pages < maxPages) {
    body = await graphGetRawUrl(body.paging.next);
    results.push(...(body.data || []));
    pages += 1;
  }
  return results;
}

async function fetchAllCampaignsList(adAccountId) {
  return graphGetAllPages(`${adAccountId}/campaigns`, {
    fields: "id,name,objective,effective_status,status,bid_strategy",
    limit: 200
  });
}

async function fetchAllCampaignInsights(adAccountId, since, until) {
  return graphGetAllPages(`${adAccountId}/insights`, {
    fields: metaAdsFieldsForLevel("campaign").join(","),
    level: "campaign",
    time_range: JSON.stringify({ since, until }),
    limit: 200
  });
}

// Meta Ads Manager가 보여주는 계정 전체 합계와 대조하기 위한 level=account 집계.
async function fetchMetaAccountTotals(adAccountId, since, until) {
  const body = await graphGet(`${adAccountId}/insights`, {
    fields: "spend,actions,action_values",
    level: "account",
    time_range: JSON.stringify({ since, until }),
    limit: 1
  });
  const row = (body.data || [])[0] || {};
  const spend = Number(row.spend || 0);
  const purchaseValue = actionValue(row.action_values, "purchase");
  const purchases = actionValue(row.actions, "purchase");
  return { spend, purchaseValue, purchases, roas: spend ? purchaseValue / spend : null };
}

function metaBidStrategyLabel(raw) {
  const map = {
    LOWEST_COST_WITHOUT_CAP: "최고 성과 우선",
    LOWEST_COST_WITH_BID_CAP: "입찰가 상한",
    LOWEST_COST_WITH_MIN_ROAS: "최소 ROAS 목표",
    COST_CAP: "비용 한도",
    TARGET_COST: "목표 비용"
  };
  return map[raw] || (raw ? raw : "확인 필요");
}

// Meta API에는 "초안(Draft)" 상태가 없어(광고관리자 UI 임시 저장은 API 객체로 생성되지 않는
// 경우가 많음) 완전히 정확하지는 않은 근사치입니다. effective_status + 기간 내 집행 여부로
// 진행중/종료/초안/비활성 4가지로 근사해서 분류합니다.
function metaCampaignDisplayStatus(effectiveStatus, spend) {
  if (effectiveStatus === "ACTIVE") return "진행중";
  if (spend > 0) {
    if (effectiveStatus === "ARCHIVED" || effectiveStatus === "DELETED") return "종료";
    return "비활성";
  }
  if (effectiveStatus === "ARCHIVED" || effectiveStatus === "DELETED") return "종료";
  if (effectiveStatus === "PAUSED" || effectiveStatus === "CAMPAIGN_PAUSED") return "초안";
  return "비활성";
}

async function buildInstagramMonthlyData(month) {
  const igId = env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!igId) throw new Error(".env에 INSTAGRAM_BUSINESS_ACCOUNT_ID가 없습니다.");

  const account = await graphGet(igId, {
    fields: "id,username,name,followers_count,media_count"
  });
  const media = await fetchMedia(igId, { maxPages: 2 });
  const monthMedia = media.filter((item) => monthKeyInReportTimezone(item.timestamp) === month);
  const postMedia = monthMedia.length ? monthMedia : isCurrentMonth(month) ? media.slice(0, 12) : monthMedia;
  const errors = [];
  const posts = await mapWithConcurrency(postMedia, 6, async (item) => {
    const insights = await fetchMediaInsights(item.id);
    if (insights.unavailableReason) {
      errors.push({ source: "instagram_media_insights", mediaId: item.id, message: insights.unavailableReason });
    }
    return normalizePost(item, insights);
  });
  const accountInsights = await fetchInstagramAccountInsights(igId, month);
  if (accountInsights.unavailableReason) {
    errors.push({ source: "instagram_account_insights", message: accountInsights.unavailableReason });
  }

  const result = {
    month,
    source: "instagram_graph_api",
    syncedAt: new Date().toISOString(),
    graphVersion,
    apiStatus: errors.length ? "partial" : "ok",
    apiErrors: errors,
    accountIdentity: {
      id: account.id,
      username: account.username || env.SAMPLAS_INSTAGRAM_USERNAME || "",
      name: account.name || "",
      followerCount: account.followers_count ?? null,
      mediaCount: account.media_count ?? null
    },
    mediaFetched: media.length,
    monthMediaCount: monthMedia.length,
    postsScope: monthMedia.length ? "selected_month" : isCurrentMonth(month) ? "recent_media_fallback" : "selected_month",
    account: {
      username: account.username || env.SAMPLAS_INSTAGRAM_USERNAME || "",
      mediaCount: account.media_count ?? null,
      followers: account.followers_count ?? null,
      followerDelta: 0,
      reach: hasMetric(accountInsights.reach) ? Number(accountInsights.reach) : sumMetricOrNull(posts, "reach"),
      reachDelta: 0,
      views: hasMetric(accountInsights.views) ? Number(accountInsights.views) : sumMetricOrNull(posts, "views"),
      viewsDelta: 0,
      profileVisits: hasMetric(accountInsights.profile_views) ? Number(accountInsights.profile_views) : null,
      profileVisitDelta: 0,
      websiteClicks: hasMetric(accountInsights.website_clicks) ? Number(accountInsights.website_clicks) : null,
      websiteClickDelta: 0,
      accountEngagement: sumPostInteractionsOrNull(posts),
      growthRate: 0
    },
    previous: {},
    posts
  };

  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, `instagram-${month}.json`), JSON.stringify(result, null, 2));
  return result;
}

function hasMetric(value) {
  return value !== null && value !== undefined && value !== "";
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildInstagramMonthlyDataWithCache(month, options = {}) {
  if (!isCurrentMonth(month)) {
    const cached = await readCachedInstagramMonth(month);
    if (cached) return decorateCachedSource(cached, "instagram_csv", "past_month_cache_only");
    return pastMonthCsvRequired("instagram", month, {
      month,
      account: emptyInstagramAccount(),
      previous: {},
      posts: []
    });
  }

  if (!options.refresh) {
    const cached = await readCachedInstagramMonth(month);
    if (cached && !isEmptyInstagramMonth(cached) && !isStaleCurrentMonthCache(cached)) {
      await logInstagramDiagnostic("cache_hit_fresh", month, {
        postsScope: cached.postsScope,
        monthMediaCount: cached.monthMediaCount,
        syncedAt: cached.syncedAt
      });
      return decorateCachedSource(cached, "instagram_graph_api", "cached_first");
    }
    if (cached && isStaleCurrentMonthCache(cached)) {
      await logInstagramDiagnostic("cache_stale_fallback_refetching", month, {
        postsScope: cached.postsScope,
        monthMediaCount: cached.monthMediaCount,
        syncedAt: cached.syncedAt
      });
    }
  }
  try {
    const fresh = await buildInstagramMonthlyData(month);
    await logInstagramDiagnostic("live_fetch_ok", month, {
      monthMediaCount: fresh.monthMediaCount,
      postsScope: fresh.postsScope
    });
    return fresh;
  } catch (error) {
    await logApiError("instagram_monthly", error, { month });
    const cached = await readCachedInstagramMonth(month);
    if (cached) {
      cached.source = `${cached.source || "instagram_graph_api"}_cached`;
      cached.cacheWarning = error.message;
      await logInstagramDiagnostic("live_fetch_failed_used_cache", month, { message: error.message });
      return cached;
    }
    await logInstagramDiagnostic("live_fetch_failed_no_cache", month, { message: error.message });
    throw error;
  }
}

// A current-month cache is only trustworthy if the last live sync actually
// found media for that month. If it fell back to showing older posts
// ("recent_media_fallback" / monthMediaCount 0), "cached_first" would
// otherwise keep serving that stale, empty-for-this-month snapshot forever,
// even after new posts are uploaded — this was the cause of July 1-6 posts
// never appearing. Treat that state as stale so a live re-fetch is retried.
function isStaleCurrentMonthCache(cached) {
  return cached?.postsScope === "recent_media_fallback" || Number(cached?.monthMediaCount || 0) === 0;
}

// Instagram 자동 동기화 스케줄러 (2026-07-08): 서버 시작 시 1회, 이후 6시간마다
// buildInstagramMonthlyDataWithCache(currentMonth(), {refresh:true})를 호출해 실제
// Graph API에서 최신 게시물을 가져와 work/instagram-<month>.json 캐시를 갱신한다.
// 실패해도 기존 on-disk 캐시는 그대로 유지된다 — buildInstagramMonthlyDataWithCache의
// catch 분기가 라이브 호출 실패 시 기존 캐시로 폴백하고 절대 파일을 지우지 않기
// 때문이다. 이 객체는 마지막 시도/성공/에러만 기록하며 /api/status에서 노출된다
// (에러 메시지는 safeErrorMessage()로 토큰/시크릿을 마스킹한 뒤에만 저장한다).
const instagramSyncScheduler = {
  intervalMs: 6 * 60 * 60 * 1000, // 6시간
  running: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null
};

async function runInstagramBackgroundSync() {
  if (instagramSyncScheduler.running) return;
  instagramSyncScheduler.running = true;
  instagramSyncScheduler.lastAttemptAt = new Date().toISOString();
  const month = currentMonth();
  try {
    const result = await buildInstagramMonthlyDataWithCache(month, { refresh: true });
    if (result?.cacheWarning) {
      // 라이브 Graph API 호출은 실패했지만 기존 캐시로 안전하게 폴백된 상태.
      instagramSyncScheduler.lastError = safeErrorMessage({ message: result.cacheWarning });
      await logInstagramDiagnostic("background_sync_fallback_cache", month, {
        message: instagramSyncScheduler.lastError
      });
    } else {
      instagramSyncScheduler.lastError = null;
      instagramSyncScheduler.lastSuccessAt = new Date().toISOString();
      await logInstagramDiagnostic("background_sync_ok", month, {
        monthMediaCount: result?.monthMediaCount,
        postsScope: result?.postsScope
      });
    }
  } catch (error) {
    // 캐시조차 없는 완전 실패인 경우에만 여기로 온다 — 이 경우도 기존 파일을 지우지
    // 않으므로 다음 페이지 로드는 여전히 이전 상태(빈 화면이 아니라 마지막 성공 캐시가
    // 있었다면 그 캐시)를 그대로 보여준다.
    instagramSyncScheduler.lastError = safeErrorMessage(error);
    await logApiError("instagram_background_sync", error, { month });
  } finally {
    instagramSyncScheduler.running = false;
  }
}

// TEMPORARY diagnostic (requested to debug Meta purchase_value/ROAS showing
// 0 while spend is fine). Logs ONLY the fields needed to see which
// action_type Meta is actually returning for this ad account — never the
// access token, request URL, or any auth header. Safe to remove once the
// actionValue() mapping is fixed for the real action_type name.
async function logMetaAdsDiagnostic(rows = [], extra = {}) {
  try {
    await mkdir(workDir, { recursive: true });
    const safeRows = rows.map((row) => ({
      campaign_id: row.campaign_id ?? null,
      campaign_name: row.campaign_name ?? null,
      spend: row.spend ?? null,
      frequency: row.frequency ?? null,
      actions: row.actions ?? null,
      action_values: row.action_values ?? null,
      video_avg_time_watched_actions: row.video_avg_time_watched_actions ?? null,
      video_p100_watched_actions: row.video_p100_watched_actions ?? null
    }));
    const line = `${JSON.stringify({
      time: new Date().toISOString(),
      source: "meta_ads_raw_diagnostic",
      rowCount: safeRows.length,
      rows: safeRows,
      ...extra
    })}\n`;
    await writeFile(join(workDir, "meta-ads-debug.ndjson"), line, { flag: "a" });
  } catch {
    // diagnostics must never break the main request
  }
}

async function logInstagramDiagnostic(status, month, extra = {}) {
  try {
    await mkdir(workDir, { recursive: true });
    const line = `${JSON.stringify({
      time: new Date().toISOString(),
      source: "instagram_monthly_diagnostic",
      status,
      month,
      ...extra
    })}\n`;
    await writeFile(join(workDir, "instagram-insights-debug.ndjson"), line, { flag: "a" });
  } catch {
    // diagnostics must never break the main request
  }
}

async function readCachedInstagramMonth(month) {
  const file = join(workDir, `instagram-${month}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

function emptyInstagramAccount() {
  return {
    username: env.SAMPLAS_INSTAGRAM_USERNAME || "",
    mediaCount: null,
    followers: null,
    followerDelta: 0,
    reach: null,
    reachDelta: 0,
    views: null,
    viewsDelta: 0,
    profileVisits: null,
    profileVisitDelta: 0,
    websiteClicks: null,
    websiteClickDelta: 0,
    accountEngagement: 0,
    growthRate: 0
  };
}

function isEmptyInstagramMonth(data) {
  return !(data?.posts || []).length
    && !Number(data?.account?.reach || 0)
    && !Number(data?.account?.views || 0)
    && !Number(data?.account?.profileVisits || 0)
    && !Number(data?.account?.websiteClicks || 0);
}

async function buildInstagramStoriesDataWithCache(options = {}) {
  if (!options.refresh) {
    const cached = await readCachedStories();
    if (cached) {
      return { ...cached, source: `${cached.source || "instagram_graph_api"}_cached`, cacheMode: "cached_first" };
    }
  }
  try {
    return await buildInstagramStoriesData();
  } catch (error) {
    const cached = await readCachedStories();
    if (cached) {
      return { ...cached, source: `${cached.source || "instagram_graph_api"}_cached`, cacheWarning: error.message };
    }
    return {
      source: "disconnected",
      syncedAt: new Date().toISOString(),
      cacheWarning: error.message,
      stories: [],
      totals: emptyStoryTotals()
    };
  }
}

async function readCachedStories() {
  const file = join(workDir, "instagram-stories.json");
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

async function buildInstagramStoriesData() {
  const igId = env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!igId) throw new Error(".env에 INSTAGRAM_BUSINESS_ACCOUNT_ID가 없습니다.");
  const fields = ["id", "media_type", "media_url", "thumbnail_url", "permalink", "timestamp"].join(",");
  const body = await graphGet(`${igId}/stories`, { fields, limit: 100 });
  const activeStories = [];
  for (const item of body.data || []) {
    const insights = await fetchStoryInsights(item.id);
    activeStories.push(normalizeStory(item, insights));
  }

  const previous = await readCachedStories();
  const byId = new Map((previous?.stories || []).map((story) => [story.id, story]));
  for (const story of activeStories) byId.set(story.id, story);
  const stories = [...byId.values()].sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const result = {
    source: "instagram_graph_api",
    syncedAt: new Date().toISOString(),
    activeCount: activeStories.length,
    stories,
    totals: summarizeStories(stories)
  };
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "instagram-stories.json"), JSON.stringify(result, null, 2));
  return result;
}

async function fetchStoryInsights(storyId) {
  const normal = await fetchInsightGroup(`${storyId}/insights`, "instagram_story_insights", { storyId }, [
    { metric: "reach,replies,taps_forward,taps_back,exits" },
    { metric: "reach,replies,exits" },
    { metric: "reach,replies" }
  ], { emptyOnNotEnoughViewers: true });
  return normal;
}

function normalizeStory(item, insights) {
  return {
    id: item.id,
    timestamp: item.timestamp || "",
    date: String(item.timestamp || "").slice(0, 10),
    time: String(item.timestamp || "").slice(11, 16),
    mediaType: item.media_type || "",
    mediaUrl: item.media_url || "",
    thumbnailUrl: item.thumbnail_url || item.media_url || "",
    permalink: item.permalink || "",
    reach: insights.reach || 0,
    replies: insights.replies || 0,
    tapsForward: insights.taps_forward || 0,
    tapsBack: insights.taps_back || 0,
    exits: insights.exits || 0,
    unavailableReason: insights.unavailableReason || ""
  };
}

function emptyStoryTotals() {
  return { count: 0, reach: 0, replies: 0, tapsForward: 0, tapsBack: 0, exits: 0, exitRate: 0, replyRate: 0 };
}

function summarizeStories(stories) {
  const totals = {
    count: stories.length,
    reach: sum(stories, "reach"),
    replies: sum(stories, "replies"),
    tapsForward: sum(stories, "tapsForward"),
    tapsBack: sum(stories, "tapsBack"),
    exits: sum(stories, "exits")
  };
  return {
    ...totals,
    exitRate: totals.reach ? (totals.exits / totals.reach) * 100 : 0,
    replyRate: totals.reach ? (totals.replies / totals.reach) * 100 : 0
  };
}

async function fetchMedia(igId, options = {}) {
  const fields = [
    "id",
    "caption",
    "media_type",
    "media_product_type",
    "media_url",
    "thumbnail_url",
    "timestamp",
    "permalink",
    "like_count",
    "comments_count",
    // children은 CAROUSEL_ALBUM의 첫 번째 이미지를 정확히 찾기 위해 필요하다 —
    // 앨범 자체의 media_url은 API/게시물에 따라 비어 있을 수 있어 신뢰할 수 없고,
    // 실제 첫 장 이미지는 children의 첫 항목에서 가져와야 한다.
    // (2026-07-08 Reports 썸네일 실제 이미지 교체)
    "children{media_type,media_url,thumbnail_url}"
  ].join(",");
  const items = [];
  let after = "";
  const maxPages = Number(options.maxPages || 10);
  for (let page = 0; page < maxPages; page += 1) {
    const body = await graphGet(`${igId}/media`, { fields, limit: 100, after });
    items.push(...(body.data || []));
    after = body.paging?.cursors?.after || "";
    if (!body.paging?.next || !after) break;
  }
  return items;
}

async function fetchMediaInsights(mediaId) {
  const normal = await fetchInsightGroup(`${mediaId}/insights`, "instagram_media_insights", { mediaId }, [
    { metric: "reach,saved,shares,total_interactions,likes,comments" },
    { metric: "reach,saved,shares,total_interactions" },
    { metric: "reach,saved,total_interactions" },
    { metric: "reach,total_interactions" },
    { metric: "reach" }
  ]);
  const totalValue = await fetchInsightGroup(`${mediaId}/insights`, "instagram_media_insights_total_value", { mediaId }, [
    { metric: "views", metric_type: "total_value" }
  ]);
  return { ...normal, ...totalValue };
}

async function fetchInstagramAccountInsights(igId, month) {
  const since = `${month}-01`;
  const until = monthEndKey(month);
  const reach = await fetchInsightGroup(`${igId}/insights`, "instagram_account_insights", { month }, [
    { metric: "reach", period: "day", since, until }
  ], { sumSeries: true });
  const totals = await fetchInsightGroup(`${igId}/insights`, "instagram_account_insights_total_value", { month }, [
    { metric: "profile_views,website_clicks,views", metric_type: "total_value", period: "day", since, until },
    { metric: "profile_views,website_clicks", metric_type: "total_value", period: "day", since, until },
    { metric: "views", metric_type: "total_value", period: "day", since, until }
  ], { sumSeries: true });
  const unavailableReason = [reach.unavailableReason, totals.unavailableReason].filter(Boolean).join(" / ");
  return { ...reach, ...totals, unavailableReason: unavailableReason || "" };
}

async function fetchInsightGroup(path, source, context, attempts, options = {}) {
  for (const params of attempts) {
    try {
      const body = await graphGet(path, params);
      return options.sumSeries ? sumInsightSeries(body.data || []) : parseInsights(body.data || []);
    } catch (error) {
      if (options.emptyOnNotEnoughViewers && isNotEnoughViewersError(error)) {
        return { unavailableReason: safeErrorMessage(error) };
      }
      await logApiError(source, error, { ...context, params });
      if (params === attempts.at(-1)) return { unavailableReason: safeErrorMessage(error) };
    }
  }
  return {};
}

function isNotEnoughViewersError(error) {
  return safeErrorMessage(error).toLowerCase().includes("not enough viewers");
}

function parseInsights(items) {
  const result = {};
  for (const item of items) {
    const value = item.total_value?.value ?? item.values?.[0]?.value;
    result[item.name] = typeof value === "number" ? value : Number(value || 0);
  }
  return result;
}

function sumInsightSeries(items) {
  const result = {};
  for (const item of items) {
    if (item.total_value && Object.prototype.hasOwnProperty.call(item.total_value, "value")) {
      result[item.name] = Number(item.total_value.value || 0);
    } else {
      result[item.name] = (item.values || []).reduce((total, value) => total + Number(value.value || 0), 0);
    }
  }
  return result;
}

// Reports 카드 상단 썸네일 규칙 (2026-07-08 Reports 썸네일 실제 이미지 교체):
//   IMAGE            → media_url
//   CAROUSEL_ALBUM    → 첫 번째 children 항목의 이미지 (children이 없으면 앨범 자체의
//                        media_url/thumbnail_url로 폴백)
//   VIDEO/REELS       → thumbnail_url 우선, 없으면 media_url
// 이미지가 전혀 없으면 빈 문자열을 반환하고, 프론트가 그 경우에만 기존 Gradient
// Placeholder를 그대로 사용한다.
function resolveCoverImage(item) {
  const mediaType = item.media_type || "";
  if (mediaType === "CAROUSEL_ALBUM") {
    const firstChild = item.children?.data?.[0];
    if (firstChild) {
      return firstChild.media_type === "VIDEO"
        ? (firstChild.thumbnail_url || firstChild.media_url || "")
        : (firstChild.media_url || firstChild.thumbnail_url || "");
    }
    return item.media_url || item.thumbnail_url || "";
  }
  if (mediaType === "VIDEO" || item.media_product_type === "REELS") {
    return item.thumbnail_url || item.media_url || "";
  }
  // IMAGE 및 그 외 알 수 없는 타입은 media_url을 우선한다.
  return item.media_url || item.thumbnail_url || "";
}

function normalizePost(item, insights) {
  const caption = item.caption || "";
  const title = caption.split(/\r?\n/).find(Boolean)?.slice(0, 64) || "Untitled content";
  const type = contentType(item);
  const tag = classifyTag(item, caption);
  return {
    id: item.id,
    date: String(item.timestamp || "").slice(0, 10),
    title,
    type,
    tag,
    objective: objectiveFor(tag, type),
    caption,
    permalink: item.permalink,
    mediaUrl: item.media_url || "",
    thumbnailUrl: item.thumbnail_url || item.media_url || "",
    coverImageUrl: resolveCoverImage(item),
    reach: metricOrNull(insights.reach),
    views: metricOrNull(insights.views),
    likes: metricOrNull(item.like_count),
    comments: metricOrNull(item.comments_count),
    saves: metricOrNull(insights.saved),
    shares: metricOrNull(insights.shares),
    totalInteractions: metricOrNull(insights.total_interactions),
    plays: item.media_product_type === "REELS" ? metricOrNull(insights.views) : null,
    profileVisits: 0,
    follows: 0,
    websiteClicks: 0,
    adSpend: 0,
    cafe24Sales1d: 0,
    cafe24Sales3d: 0,
    cafe24Sales7d: 0,
    salesLift7d: 0,
    unavailableReason: insights.unavailableReason
  };
}

function metricOrNull(value) {
  return hasMetric(value) ? Number(value) : null;
}

function sumMetricOrNull(items, key) {
  const values = items.map((item) => item[key]).filter(hasMetric);
  return values.length ? values.reduce((total, value) => total + Number(value), 0) : null;
}

function sumPostInteractionsOrNull(posts) {
  const values = posts.map((post) => {
    if (hasMetric(post.totalInteractions)) return post.totalInteractions;
    const metrics = [post.likes, post.comments, post.saves, post.shares].filter(hasMetric);
    return metrics.length ? metrics.reduce((total, value) => total + Number(value), 0) : null;
  }).filter(hasMetric);
  return values.length ? values.reduce((total, value) => total + Number(value), 0) : null;
}

function contentType(item) {
  if (item.media_product_type === "REELS") return "릴스";
  if (item.media_type === "CAROUSEL_ALBUM") return "카드뉴스";
  if (item.media_type === "VIDEO") return "릴스";
  return "피드";
}

function classifyTag(item, caption) {
  const text = caption.toLowerCase();
  if (item.media_product_type === "REELS") return "Reels";
  if (text.includes("sale") || text.includes("세일")) return "Event / Sale";
  if (text.includes("lookbook") || text.includes("룩북")) return "Lookbook";
  if (text.includes("new brand") || text.includes("새로운 브랜드")) return "Brand Discovery";
  if (text.includes("release") || text.includes("released") || text.includes("입고")) return "Product Focus";
  if (item.media_type === "CAROUSEL_ALBUM") return "Editorial Cardnews";
  return "Archive / Culture";
}

function objectiveFor(tag, type) {
  if (tag === "Product Focus") return "제품 발견/사이트 유입";
  if (tag === "Event / Sale") return "단기 도달/구매 전환";
  if (tag === "Reels" || type === "릴스") return "도달/신규 유입";
  if (tag === "Lookbook") return "브랜드 무드/저장";
  return "저장/공유/팔로우 증가";
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function monthEndKey(month) {
  const [year, m] = String(month).split("-").map(Number);
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.REPORT_TIMEZONE || "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function monthFromDate(dateText) {
  return String(dateText || "").slice(0, 7);
}

// Meta's media "timestamp" is not guaranteed to line up with the report
// timezone (Asia/Seoul). A naive string prefix match against a KST-computed
// month key can mis-bucket posts made near the midnight boundary (e.g. a
// post at 08:00 KST is still the previous day in UTC). Always resolve the
// month through the same timezone used by currentMonth() to classify posts.
function monthKeyInReportTimezone(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.REPORT_TIMEZONE || "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).format(date);
}

function isCurrentMonth(month) {
  return month === currentMonth();
}

function decorateCachedSource(cached, fallbackSource, cacheMode) {
  return {
    ...cached,
    source: cached.source?.endsWith("_cached") ? cached.source : `${cached.source || fallbackSource}_cached`,
    cacheMode
  };
}

function pastMonthCsvRequired(kind, month, extra = {}) {
  return {
    ...extra,
    source: "csv_required",
    cacheMode: "past_month_cache_only",
    month,
    message: `${month}은 지난 달 데이터라 API를 호출하지 않습니다. CSV를 업로드하면 이 위치에 고정됩니다.`,
    apiPolicy: {
      kind,
      currentMonth: currentMonth(),
      pastMonths: "csv_or_saved_cache_only",
      currentMonthApi: true
    }
  };
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.REPORT_TIMEZONE || "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
