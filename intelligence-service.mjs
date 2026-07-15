import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { URL } from "node:url";

const root = resolve(".");
const env = await loadEnv();
const host = env.INTELLIGENCE_HOST || env.HOST || "127.0.0.1";
const port = Number(env.INTELLIGENCE_PORT || 8797);
const workRoot = resolve(env.WORK_DIR || join(root, "work"));
const intelligenceWorkDir = join(workRoot, "intelligence");
const marketingBrandMasterFile = join(workRoot, "brand-master.json");
const brandMasterListFile = join(intelligenceWorkDir, "brand-master-list.json");
const brandAliasesFile = join(intelligenceWorkDir, "brand-aliases.json");
const naverSearchSnapshotsFile = join(intelligenceWorkDir, "naver-search-snapshots.json");
const brandTimelineFile = join(intelligenceWorkDir, "brand-timeline.json");
const decisionHistoryFile = join(intelligenceWorkDir, "decision-history.json");
const naverAdsBaseUrl = env.NAVER_ADS_BASE_URL || "https://api.searchad.naver.com";
const naverAdsTimeoutMs = 10000;
const marketingOsBaseUrl = env.INTELLIGENCE_MARKETING_OS_BASE_URL || env.MARKETING_OS_BASE_URL || `http://127.0.0.1:${env.PORT || 8787}`;
const marketingOsTimeoutMs = 12000;

await mkdir(intelligenceWorkDir, { recursive: true });
await ensureBrandRegistryFiles();
await ensureNaverSnapshotsFile();
await ensureTimelineFile();
await ensureDecisionHistoryFile();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
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
    const brandInputMatch = url.pathname.match(/^\/api\/intelligence\/brand\/([^/]+)\/input$/);
    if (brandInputMatch) {
      return handleBrandIntelligenceInputRoute(brandInputMatch[1], url, res);
    }
    const brandIntelligenceMatch = url.pathname.match(/^\/api\/intelligence\/brand\/([^/]+)$/);
    if (brandIntelligenceMatch) {
      return handleBrandIntelligenceRoute(brandIntelligenceMatch[1], url, res);
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
    return json(res, {
      ok: false,
      error: "Internal Server Error",
      message: safeErrorMessage(error)
    }, 500);
  }
});

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

function json(res, payload, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
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
  const result = await buildMissions(parsed);
  return json(res, result);
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
  const missions = await buildMissions(parsed);
  const items = missions.missions.map((mission) => ({
    brand: mission.brand,
    priority: mission.priority,
    title: mission.title,
    reason: mission.reason
  }));
  return json(res, {
    ok: true,
    generatedAt: missions.meta.generatedAt,
    missionCount: missions.count,
    headline: missions.count ? `오늘 우선 확인할 Mission ${missions.count}건` : "현재 우선 확인할 Mission이 없습니다",
    items
  });
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
    const salesAmount = finiteOrNull(commerce.data?.salesAmount);
    const orderCount = finiteOrNull(commerce.data?.orderCount);
    const quantitySold = finiteOrNull(commerce.data?.quantitySold);
    if (salesAmount !== null && salesAmount > 0) {
      signals.push({
        id: "commerce_sales_present",
        type: "commerce",
        priority: "medium",
        title: "선택 기간 판매가 확인됨",
        evidence: { salesAmount, source: commerce.data?.source || null }
      });
    } else if (salesAmount === 0) {
      signals.push({
        id: "commerce_sales_zero",
        type: "commerce",
        priority: "medium",
        title: "선택 기간 판매가 0으로 확인됨",
        evidence: { salesAmount, source: commerce.data?.source || null }
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
  if (hasSignal(signals, "commerce_sales_present")) parts.push("선택 기간 판매가 확인됐습니다");
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
    sourceActionId: reference.sourceActionId
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
    if (!intelligence.actions.some((action) => action.id === actionId)) return { ok: false, status: 404, error: "Not Found", message: `Action is not available for this brand: ${actionId}` };
  }
  return { ok: true, missionId: missionId || null, sourceActionId: actionId || null };
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

function sortDecisionsLatestFirst(decisions) {
  return [...decisions].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function sortTimelineLatestFirst(events) {
  return [...events].sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
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
      paidAmount: finiteOrNull(matchedBrand?.salesAmount),
      orderCount: finiteOrNull(matchedBrand?.orderCount),
      quantitySold: finiteOrNull(matchedBrand?.quantitySold),
      productCount: finiteOrNull(matchedBrand?.soldProductCount ?? matchedProducts.length),
      products: matchedProducts.map((product) => ({
        productNo: product.productNo || null,
        productCode: product.productCode || null,
        productName: product.productName || null,
        salesAmount: finiteOrNull(product.salesAmount),
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
  const method = "GET";
  const uri = "/keywordstool";
  const endpoint = new URL(uri, naverAdsBaseUrl);
  endpoint.searchParams.set("hintKeywords", keyword);
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

async function writeTimelineStore(store) {
  validateTimelineStore(store);
  await writeJsonAtomic(brandTimelineFile, store);
}

async function writeDecisionHistoryStore(store) {
  validateDecisionHistoryStore(store);
  await writeJsonAtomic(decisionHistoryFile, store);
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

async function ensureBrandRegistryFiles() {
  await mkdir(intelligenceWorkDir, { recursive: true });
  if (!existsSync(brandMasterListFile) || !existsSync(brandAliasesFile)) {
    const source = await readMarketingBrandMaster();
    const { brands, aliases } = buildIntelligenceBrandRegistry(source.brands);
    if (!existsSync(brandMasterListFile)) await writeJson(brandMasterListFile, brands);
    if (!existsSync(brandAliasesFile)) await writeJson(brandAliasesFile, aliases);
  }
  await readBrandRegistry();
}

async function readMarketingBrandMaster() {
  if (!existsSync(marketingBrandMasterFile)) return { brands: [] };
  const parsed = JSON.parse(await readFile(marketingBrandMasterFile, "utf8"));
  return {
    brands: Array.isArray(parsed) ? parsed : Array.isArray(parsed.brands) ? parsed.brands : []
  };
}

function buildIntelligenceBrandRegistry(sourceBrands = []) {
  const brands = [];
  const aliases = [];
  const seenIds = new Set();
  const seenNames = new Map();
  for (const source of sourceBrands) {
    const id = normalizeBrandCode(source.brand_code);
    const name = normalizeBrandName(source.brand_name);
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);
    const nameKey = normalizeBrandKey(name);
    const existingBrandId = seenNames.get(nameKey);
    if (existingBrandId) {
      aliases.push({ alias: id, brandId: existingBrandId, source: "duplicate_cafe24_brand_code" });
      continue;
    }
    seenNames.set(nameKey, id);
    brands.push({
      id,
      name,
      active: source.active === undefined ? true : Boolean(source.active)
    });
    aliases.push({ alias: id, brandId: id, source: "cafe24_brand_code" });
    for (const alias of parseBrandAliases(source.name_aliases)) {
      if (normalizeBrandKey(alias) !== normalizeBrandKey(name)) aliases.push({ alias, brandId: id, source: "name_alias" });
    }
    const instagramTag = normalizeBrandName(source.instagram_tag);
    if (instagramTag && normalizeBrandKey(instagramTag) !== normalizeBrandKey(name)) aliases.push({ alias: instagramTag, brandId: id, source: "instagram_tag" });
  }
  return {
    brands: brands.sort((left, right) => left.name.localeCompare(right.name, "ko")),
    aliases: dedupeAliases(aliases)
  };
}

async function readBrandRegistry() {
  const brands = JSON.parse(await readFile(brandMasterListFile, "utf8"));
  const aliases = JSON.parse(await readFile(brandAliasesFile, "utf8"));
  validateBrandRegistry(brands, aliases);
  return {
    brands: [...brands].sort((left, right) => left.name.localeCompare(right.name, "ko")),
    aliases
  };
}

function validateBrandRegistry(brands, aliases) {
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
    if (aliasKeys.has(aliasKey)) throw new Error(`Duplicate alias: ${entry.alias}`);
    aliasKeys.add(aliasKey);
  }
}

function resolveBrand(input, registry) {
  const key = normalizeBrandKey(input);
  if (!key) return null;
  const byName = new Map(registry.brands.map((brand) => [normalizeBrandKey(brand.name), brand]));
  const direct = byName.get(key);
  if (direct) return { brandId: direct.id, name: direct.name };
  const byId = new Map(registry.brands.map((brand) => [normalizeBrandKey(brand.id), brand]));
  const idMatch = byId.get(key);
  if (idMatch) return { brandId: idMatch.id, name: idMatch.name };
  const alias = registry.aliases.find((entry) => normalizeBrandKey(entry.alias) === key);
  if (!alias) return null;
  const brand = registry.brands.find((item) => item.id === alias.brandId);
  return brand ? { brandId: brand.id, name: brand.name } : null;
}

function normalizeBrandCode(value) {
  return String(value ?? "").trim();
}

function normalizeBrandName(value) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    Ccedil: "Ç",
    ccedil: "ç",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return String(value ?? "")
    .replace(/&(#(\d+)|#x([0-9a-fA-F]+)|[A-Za-z][A-Za-z0-9]+);/g, (entity, name, decimal, hex) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return namedEntities[name] || entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function parseBrandAliases(value) {
  if (Array.isArray(value)) return value.map(normalizeBrandName).filter(Boolean);
  return String(value ?? "")
    .split(/[\n,]/)
    .map(normalizeBrandName)
    .filter(Boolean);
}

function normalizeBrandKey(value) {
  return normalizeBrandName(value)
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
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
