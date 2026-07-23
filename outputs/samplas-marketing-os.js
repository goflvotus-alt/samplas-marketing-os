const navItems = [
  { view: "Overview", label: "Today", hidden: false },
  { view: "Sales", label: "Commerce", hidden: false },
  { view: "Advertising", label: "Marketing", hidden: false },
  { view: "Content", label: "Content", hidden: false },
  { view: "Reports", label: "Monthly Report", hidden: false },
  { view: "Intelligence", label: "Intelligence", hidden: false },
  { view: "ProductRegistry", label: "Product Registry", hidden: false },
  { view: "Settings", label: "Settings", hidden: false },
  { view: "Product", label: "Product", hidden: true },
  { view: "Editorial AI", label: "Editorial AI", hidden: true }
];

function buildRecentMonthKeys(referenceDate = new Date(), count = 7) {
  const keys = [];
  const startYear = referenceDate.getFullYear();
  const startMonth = referenceDate.getMonth();
  for (let index = 0; index < count; index += 1) {
    const date = new Date(startYear, startMonth - index, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

const months = buildRecentMonthKeys();
let monthlyData = [];
let storyData = { stories: [], totals: {} };
let activeContentTab = "All";
let activeAdLevel = "campaign";
let activeProductActionFilter = "all";
let activeProductScopeFilter = "sold";
let activeProductStockFilter = "all";
let activeProductSort = "salesAmount_desc";
let productBrandSalesRows = [];
let productBrandSalesProducts = [];
let productBrandSalesCacheKey = "";
let productBrandSalesRange = "month";
let productBrandSalesCustomSince = "";
let productBrandSalesCustomUntil = "";
let productBrandSalesRenderSeq = 0;
let operationsRange = "month";
let operationsRangeCustomSince = "";
let operationsRangeCustomUntil = "";
let operationsRenderSeq = 0;
let productBrandSalesSort = "brand_asc";
let productBrandSalesSearch = "";
let productSoldFilterBrand = "all";
let productSoldFilterQty = "all";
let productSoldFilterAmount = "all";
let productSoldSearch = "";
let productSoldSort = "amount_desc";
let activeBrandOrderPopoverCode = "";
let commerceSummaryState = { cafe: null, comparison: null, totalSales: null };
let todaySummaryState = { data: null, cafe: null, meta: null, comparison: null, marketing: null, totalSales: null };
const todaySalesCalendarInitialDate = new Date();
let todaySalesCalendarMonth = `${todaySalesCalendarInitialDate.getFullYear()}-${String(todaySalesCalendarInitialDate.getMonth() + 1).padStart(2, "0")}`;
let todaySalesCalendarRenderSeq = 0;
let todayOverviewState = null;
let campaignPeriodComparisonState = { comparisonMode: "month", manualRange: null, manualComparisonRange: null, monthBase: "", monthTarget: "", settingsOpen: false, loading: false };
let reportsMonth = "";
let reportsRenderSeq = 0;
let intelligenceRenderSeq = 0;
let intelligenceBrandRenderSeq = 0;
// Meta Product Performance · Phase 1 (2026-07-23): Marketing 화면(#Advertising view)에 새로
// 추가된 카드 전용 상태. GET /api/meta-ads/products(신규 endpoint 없음, 기존 API 재사용)의
// rows를 그대로 보관하고, 클릭한 행의 content_id만 열어(accordion) 상세를 보여준다.
let metaProductPerformanceRows = [];
let metaProductPerformanceOpenContentId = null;
let metaProductPerformanceRenderSeq = 0;
// Marketing Analytics Phase 2 (2026-07-23): Product → Brand → Order drill-down 전용 상태.
// GET /api/diagnostics/brand-sales(기존 API, 새 API 아님) 응답을 productNo/brand_code로
// 인덱싱해 재사용한다. 이 두 Map은 Registry나 Meta Product Performance rows를 수정하지
// 않고 순수 조인(join) 캐시로만 쓰인다.
let metaProductPerformanceSalesByProductNo = new Map();
let metaProductPerformanceBrandsByCode = new Map();
let metaProductPerformanceSalesFetchFailed = false;
let metaProductPerformanceBrandFilter = null;
let intelligenceDecisionsRenderSeq = 0;
let intelligenceTimelineRenderSeq = 0;
let intelligenceLearningRenderSeq = 0;
let intelligenceSubmitInFlight = false;
let activeIntelligencePanel = "overview";
let selectedIntelligenceMission = null;
let intelligenceBrandCache = null;
let intelligenceOverviewState = { missions: [], brief: null, details: new Map(), cached: false, refreshing: false };
let intelligenceSearchTimer = null;
let intelligenceSearchRenderSeq = 0;
let intelligenceTimelineBrandNameCache = new Map();
let apiHealthRefreshInFlight = false;
let currentTodayBriefingItems = [];
// Cafe24 재인증 콜백이 실패로 돌아왔을 때만 채워진다(handleCafe24OAuthRedirect() 참고).
// (2026-07-08 Cafe24 재인증 흐름 개선)
let cafe24OAuthErrorReason = null;
// Brand Master "의심 항목만 보기" 토글 상태. 서버 값이 아니라 화면 표시 필터일 뿐이므로
// 클라이언트에만 보관하고, 저장/재조회 후 다시 렌더링될 때도 이전 선택을 유지한다.
// (2026-07-10 Brand Master 승인 UX 최소 구현)
let brandMasterSuspectOnly = false;
let brandMasterCatalogOnly = true;

let productRegistryRenderSeq = 0;
let productRegistryState = { registry: null, reviewQueue: null, items: [], activeTab: "all", selectedId: null };
let productRegistryFilters = { search: "", brand: "all", confidence: "all", status: "all", diagnostic: "all", candidateCount: "all" };
const nf = new Intl.NumberFormat("ko-KR");
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const intelligenceBaseUrl = window.samplasIntelligenceBaseUrl || "http://127.0.0.1:8797";
const defaultProjectLinks = {
  cafe24: "",
  advertising: "",
  content: "",
  cardnews: "",
  editorial: "",
  overview: ""
};

function num(value) {
  return nf.format(Number(value || 0));
}

function krw(value) {
  return `${nf.format(Math.round(Number(value || 0) / 10000))}만원`;
}

function won(value) {
  return `${nf.format(Math.round(Number(value || 0)))}원`;
}

function hasApiValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function apiNum(value) {
  return hasApiValue(value) ? nf.format(Number(value)) : "-";
}

function apiWon(value) {
  return hasApiValue(value) ? `${nf.format(Math.round(Number(value)))}원` : "-";
}

function firstFiniteValue(...values) {
  for (const value of values) {
    if (!hasApiValue(value) || typeof value === "object") continue;
    const parsed = Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function canonicalPaidAmount(record = {}) {
  return firstFiniteValue(record?.sales?.paidAmount, record?.canonicalPaidAmount, record?.paidAmount, record?.salesAmount, 0);
}

function canonicalBrandPaidAmount(record = {}) {
  return firstFiniteValue(record?.sales?.paidAmount, record?.paidAmount, record?.salesAmount, 0);
}

function canonicalGrossAmount(record = {}) {
  return firstFiniteValue(record?.sales?.grossAmount, record?.grossAmount, record?.rrpAmount);
}

function canonicalDiscountAmount(record = {}) {
  return firstFiniteValue(record?.sales?.discountAmount, record?.canonicalDiscountAmount, record?.discountAmount);
}

function isExcludedCommerceBrandPerformanceCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return normalized === "B0000000" || normalized === "UNASSIGNED";
}

function cafe24MoneyValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "object") return 0;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function instagramApiErrors(data = {}) {
  const errors = data.apiErrors || [];
  const account = errors.find((item) => item.source === "instagram_account_insights")?.message || "";
  const media = errors.find((item) => item.source === "instagram_media_insights")?.message || "";
  return {
    account: account ? `데이터 오류: ${account}` : "",
    media: media ? `데이터 오류: ${media}` : ""
  };
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "-";
}

function multiple(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}x` : "-";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function monthEnd(month) {
  const [year, m] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function operationsDateRange(data = selectedMonth()) {
  const today = new Date();
  const dateKey = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
  const addDays = (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };
  const monthSince = `${data.month}-01`;
  const monthUntil = monthEnd(data.month);
  if (operationsRange === "today") {
    const day = dateKey(today);
    return { since: day, until: day, label: "오늘" };
  }
  if (operationsRange === "7d") return { since: dateKey(addDays(today, -6)), until: dateKey(today), label: "최근 7일" };
  if (operationsRange === "30d") return { since: dateKey(addDays(today, -29)), until: dateKey(today), label: "최근 30일" };
  if (operationsRange === "prev_month") {
    const [year, month] = String(data.month || selectedMonth().month).split("-").map(Number);
    const prev = new Date(year, month - 2, 1);
    const monthKey = dateKey(prev).slice(0, 7);
    return { since: `${monthKey}-01`, until: monthEnd(monthKey), label: "지난 달" };
  }
  if (operationsRange === "custom") {
    const validSince = /^\d{4}-\d{2}-\d{2}$/.test(operationsRangeCustomSince);
    const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(operationsRangeCustomUntil);
    if (validSince && validUntil && operationsRangeCustomSince <= operationsRangeCustomUntil) {
      return { since: operationsRangeCustomSince, until: operationsRangeCustomUntil, label: "직접 선택" };
    }
    return { since: monthSince, until: monthUntil, label: "이번 달" };
  }
  return { since: monthSince, until: monthUntil, label: "이번 달" };
}

async function getJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `응답을 읽지 못했습니다: ${text.slice(0, 100)}` };
    }
    if (!response.ok && !body.error) body.error = `API 오류 ${response.status}`;
    return body;
  } catch (error) {
    return { error: error.name === "AbortError" ? "응답 지연" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

let sharedJsonRequests = new Map();

function resetSharedJsonRequests() {
  sharedJsonRequests = new Map();
}

function getSharedJson(url, timeoutMs = 8000) {
  const key = url;
  if (sharedJsonRequests.has(key)) return sharedJsonRequests.get(key);
  const request = getJson(url, timeoutMs).then((body) => {
    if (body?.error) sharedJsonRequests.delete(key);
    return body;
  }, (error) => {
    sharedJsonRequests.delete(key);
    throw error;
  });
  sharedJsonRequests.set(key, request);
  return request;
}

async function postJson(url, payload, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `응답을 읽지 못했습니다: ${text.slice(0, 100)}` };
    }
    if (!response.ok && !body.error) body.error = `API 오류 ${response.status}`;
    return body;
  } catch (error) {
    return { error: error.name === "AbortError" ? "응답 지연" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function patchJson(url, payload, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `응답을 읽지 못했습니다: ${text.slice(0, 100)}` };
    }
    if (!response.ok && !body.error) body.error = `API 오류 ${response.status}`;
    return body;
  } catch (error) {
    return { error: error.name === "AbortError" ? "응답 지연" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

function selectedMonth() {
  const value = $("#monthSelect")?.value;
  const rows = uniqueMonthlyDataRows();
  return rows.find((item) => item.month === value) || rows[0] || emptyMonth("2026-07");
}

function emptyMonth(month) {
  return {
    month,
    source: "disconnected",
    account: {
      followers: 0,
      followerDelta: 0,
      reach: 0,
      reachDelta: 0,
      views: 0,
      viewsDelta: 0,
      profileVisits: 0,
      profileVisitDelta: 0,
      websiteClicks: 0,
      websiteClickDelta: 0,
      accountEngagement: 0,
      growthRate: 0
    },
    posts: []
  };
}

function errorMonth(month, error) {
  return {
    ...emptyMonth(month),
    source: "api_error",
    error: error || "API 오류",
    cacheWarning: error || "API 오류"
  };
}

function sourceLabel(data) {
  if (!data) return "-";
  if (data.source === "csv_required") return "업로드 필요";
  if (String(data.source || "").startsWith("csv_import")) return "저장 데이터";
  if (String(data.source || "").includes("_cached")) return "저장 데이터";
  if (String(data.source || "").includes("graph_api")) return "자동 갱신";
  return data.source || "-";
}

function sourceText(data) {
  if (isPermissionBlocked(data)) return "Meta 권한 차단: 토큰 권한 또는 앱 권한 확인 필요";
  if (data.source === "csv_required") return data.message || "지난 달은 CSV 업로드 후 표시";
  if (String(data.source || "").startsWith("csv_import")) return "CSV 고정 월간 데이터";
  if (String(data.source || "").includes("_cached")) return "저장된 API 캐시 데이터";
  if (String(data.source || "").includes("graph_api")) return "Instagram Graph API 데이터";
  return "연결 확인 필요";
}

function isPermissionBlocked(data) {
  const text = `${data?.error || ""} ${data?.category || ""}`.toLowerCase();
  return text.includes("api access blocked") || text.includes("permission_blocked");
}

function statusTextForError(data) {
  if (isPermissionBlocked(data)) return "권한 차단";
  if (String(data?.error || "").toLowerCase().includes("refresh_token")) return "토큰 만료";
  return "오류";
}

// 지금 보고 있는 Meta Ads 데이터가 실시간인지/캐시인지/조회 실패인지 한눈에 보이도록 하는 배지입니다.
// - 🔴 No Data: API 호출 자체가 실패했고 저장된 캐시도 없는 경우 (숫자를 지어내지 않고 실패를 그대로 보여줌)
// - 🟡 Cache: 캐시를 사용 중 (정상적으로 저장된 값을 우선 사용했거나, 실시간 조회 실패 후 대체한 경우)
// - 🟢 Live Meta API: 지금 이 요청에서 Meta API를 직접 호출해 받은 값
function metaAdsSourceBadge(meta = {}) {
  if (meta.error) {
    return { icon: "🔴", label: "No Data", tone: "error", detail: meta.error };
  }
  const source = String(meta.source || "");
  const cacheMode = meta.cacheMode || "";
  if (source.includes("_cached") || cacheMode) {
    const syncedMs = meta.syncedAt ? new Date(meta.syncedAt).getTime() : null;
    let agoText = "";
    if (syncedMs) {
      const minutes = Math.max(0, Math.round((Date.now() - syncedMs) / 60000));
      agoText = minutes < 1 ? " · 방금 전 저장" : minutes < 60 ? ` · ${minutes}분 전 저장` : ` · ${Math.round(minutes / 60)}시간 전 저장`;
    }
    const fallbackNote = cacheMode === "fallback_after_error" ? ` · 실시간 조회 실패로 저장된 값 표시(${meta.cacheWarning || ""})` : "";
    return { icon: "🟡", label: "Cache", tone: "warn", detail: `${agoText}${fallbackNote}` };
  }
  return { icon: "🟢", label: "Live Meta API", tone: "good", detail: "" };
}

// Sidebar is a persistent "traffic light" visible on every tab, so it only
// carries dot color + a 4-word badge (정상 / Cache / 실패 / 재인증 필요).
// Full reasons/actions live in the Overview Health Banner and the Settings
// API Health Center — kept out of this function on purpose.
function setSyncRow(id, tone, label, badge, detail = "") {
  const row = $(`#${id}`);
  if (!row) return;
  row.classList.remove("loading", "good", "warn", "error");
  row.classList.add(tone);
  row.innerHTML = `<span></span><strong>${esc(label)}</strong><em>${esc(badge)}</em>${detail ? `<small>${esc(detail)}</small>` : ""}`;
}

// Condenses the richer bannerState() classification (used by the Overview
// Health Banner) down to the sidebar's 4-word vocabulary. Reuses the same
// classification instead of re-deriving status, so sidebar and banner never
// disagree.
function sidebarBadgeFromState(state) {
  if (state.tone === "good") return { tone: "good", badge: "정상" };
  if (state.tone === "error") {
    const isReauth = state.label === "토큰 만료" || state.label === "권한 만료";
    return { tone: "error", badge: isReauth ? "재인증 필요" : "실패" };
  }
  return { tone: "warn", badge: "Cache" };
}

function toast(message) {
  const node = $("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}

const viewHashMap = {
  Overview: "today",
  Sales: "commerce",
  Advertising: "marketing",
  Content: "content",
  Reports: "monthly-report",
  ProductRegistry: "product-registry",
  Intelligence: "intelligence",
  Settings: "settings"
};

const hashViewMap = Object.fromEntries(Object.entries(viewHashMap).map(([view, hash]) => [hash, view]));

function viewFromHash() {
  const key = decodeURIComponent(String(window.location.hash || "").replace(/^#/, ""));
  return hashViewMap[key] || "Overview";
}

function updateViewHash(view) {
  const hash = viewHashMap[view];
  if (!hash) return;
  const next = `#${hash}`;
  if (window.location.hash === next) return;
  window.history.pushState(null, "", next);
}

function setActiveView(view, options = {}) {
  const targetView = navItems.some((item) => item.view === view) ? view : "Overview";
  $$(".nav button").forEach((node) => node.classList.toggle("active", node.dataset.view === targetView));
  $$(".view").forEach((panel) => panel.classList.toggle("active", panel.id === targetView));
  setTopbarTitle(targetView);
  updateTopbarControls(targetView);
  if (targetView === "Intelligence") refreshActiveIntelligencePanel();
  if (targetView === "ProductRegistry") renderProductRegistryView();
  if (options.updateHash !== false) updateViewHash(targetView);
  if (options.scroll !== false) window.scrollTo({ top: 0, behavior: options.smooth === false ? "auto" : "smooth" });
}

function renderNav() {
  const nav = $("#nav");
  nav.innerHTML = navItems.map((item, index) => (
    `<button type="button" class="${index === 0 ? "active" : ""}" data-view="${esc(item.view)}" ${item.hidden ? "hidden" : ""}>${esc(item.label)}</button>`
  )).join("");
  setActiveView(viewFromHash(), { updateHash: false, scroll: false });
  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    setActiveView(button.dataset.view);
  });
  window.addEventListener("popstate", () => setActiveView(viewFromHash(), { updateHash: false, smooth: false }));
  window.addEventListener("hashchange", () => setActiveView(viewFromHash(), { updateHash: false, smooth: false }));
}

// Topbar used to repeat "MONTHLY INTELLIGENCE / Marketing Director / SAMPLAS"
// on every tab (already shown once in the sidebar brand block). Replaced with
// a single line reflecting which tab is actually open right now.
function setTopbarTitle(view) {
  const target = $("#topbarTitle");
  if (target) target.textContent = view;
}

function updateTopbarControls(view) {
  const controls = $(".topbar .controls");
  const monthSelect = $("#monthSelect");
  const operationsSelect = $("#operationsRange");
  const customRange = $("#operationsCustomRange");
  const showOperations = ["Overview", "Sales", "Advertising", "Content"].includes(view);
  if (monthSelect) monthSelect.hidden = !showOperations;
  if (operationsSelect) operationsSelect.hidden = !showOperations;
  if (customRange) customRange.hidden = !showOperations || operationsRange !== "custom";
  if (controls) controls.hidden = !showOperations;
}

function renderContentTabs() {
  $$("[data-content-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.contentTab === activeContentTab);
  });
  $$("[data-content-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.contentPanel === activeContentTab);
  });
}

function uniqueMonthlyDataRows() {
  const seen = new Set();
  return monthlyData.filter((item) => {
    const month = item?.month;
    if (!month || seen.has(month)) return false;
    seen.add(month);
    return true;
  });
}

function renderMonthSelect() {
  const select = $("#monthSelect");
  const rows = uniqueMonthlyDataRows();
  const current = select.value;
  select.innerHTML = "";
  select.innerHTML = rows.map((item) => `<option value="${item.month}">${item.month}</option>`).join("");
  const bestMonth = rows.find((item) => (item.posts || []).length || Number(item.account?.reach || 0) || Number(item.account?.views || 0));
  select.value = rows.some((item) => item.month === current) ? current : bestMonth?.month || rows[0]?.month || "2026-07";
  select.onchange = renderAll;
}

function setSelectedMonthValue(month) {
  const select = $("#monthSelect");
  if (select && uniqueMonthlyDataRows().some((item) => item.month === month)) select.value = month;
}

function setReportsMonth(month, options = {}) {
  if (!uniqueMonthlyDataRows().some((item) => item.month === month)) return;
  reportsMonth = month;
  if (options.syncGlobal !== false) setSelectedMonthValue(month);
  renderMonthRail();
  renderReportsMonth(reportsMonth, options);
}

// Reports used to list every month as a row of pills (its own month picker,
// duplicating the topbar's #monthSelect) under two stacked "Reports /
// 월간 보고서 / Monthly Summary / 월간 요약" headers. Director-mode pass:
// one compact "‹ [month] ›" switcher, no repeated titles, so the report's
// own headline ("2026-07 SAMPLAS MONTHLY REPORT" from renderMonthlyDashboard)
// is what the operator actually sees first.
function renderMonthRail() {
  const rail = $("#monthRail");
  if (!rail) return;
  const rows = uniqueMonthlyDataRows();
  const fallback = selectedMonth();
  if (!reportsMonth) reportsMonth = fallback.month;
  let data = rows.find((item) => item.month === reportsMonth) || fallback;
  if (reportsMonth !== data.month) reportsMonth = data.month;
  const index = rows.findIndex((item) => item.month === data.month);
  const older = index >= 0 ? rows[index + 1] : null;
  const newer = index > 0 ? rows[index - 1] : null;
  rail.innerHTML = `
    <button type="button" class="month-nav-btn" data-nav="prev" ${older ? "" : "disabled"} aria-label="이전 달">‹</button>
    <select id="monthRailSelect" aria-label="리포트 월 선택">
      ${rows.map((item) => `<option value="${esc(item.month)}" ${item.month === data.month ? "selected" : ""}>${esc(item.month)}</option>`).join("")}
    </select>
    <button type="button" class="month-nav-btn" data-nav="next" ${newer ? "" : "disabled"} aria-label="다음 달">›</button>
    <span class="month-rail-source">${esc(sourceLabel(data))}</span>
  `;
  rail.querySelector('[data-nav="prev"]')?.addEventListener("click", () => {
    if (!older) return;
    setReportsMonth(older.month);
  });
  rail.querySelector('[data-nav="next"]')?.addEventListener("click", () => {
    if (!newer) return;
    setReportsMonth(newer.month);
  });
  rail.querySelector("#monthRailSelect")?.addEventListener("change", (event) => {
    setReportsMonth(event.target.value);
  });
}

function renderReportsMonth(month, options = {}) {
  const renderSeq = ++reportsRenderSeq;
  renderMonthlyArchiveReport(month, renderSeq).then(() => {
    if (options.scrollToReport && renderSeq === reportsRenderSeq) {
      $("#monthlyArchiveReport")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  renderAnnualArchiveFlow(month, renderSeq);
}

function renderKpis(data) {
  if (data.error) {
    const status = statusTextForError(data);
    $("#kpiGrid").innerHTML = [
      ["데이터 오류", status, data.error],
      ["월", data.month || "-", "연결 상태를 확인하세요"],
      ["표시 상태", "0으로 대체 안 함", "실제 데이터가 없으면 원인을 표시합니다."]
    ].map(([label, value, delta]) => (
      `<article class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><p class="delta">${esc(delta)}</p></article>`
    )).join("");
    return;
  }
  const a = data.account || {};
  const postCount = (data.posts || []).length;
  const instagramErrors = instagramApiErrors(data);
  const items = [
    ["선택 기간 광고비", "확인 중", "Meta Ads 확인 중"],
    ["선택 기간 주문", "확인 중", "Cafe24 확인 중"],
    ["선택 기간 인기상품", "-", "Cafe24 확인 중"]
  ];
  $("#kpiGrid").innerHTML = items.map(([label, value, delta]) => (
    `<article class="kpi"><span>${label}</span><strong>${value}</strong><p class="delta">${delta}</p></article>`
  )).join("");
}

async function renderOverviewLiveData(data, renderSeq) {
  const target = $("#overviewLiveData");
  const supportTarget = $("#overviewLiveSupport");
  if (!target || !supportTarget) return;
  target.innerHTML = `<article class="action-item"><strong>선택 기간 KPI 확인 중</strong><p>매출, 광고, 팔로워, 콘텐츠를 정리합니다.</p></article>`;
  supportTarget.innerHTML = "";
  $("#todayBriefProgress").innerHTML = todayBriefProgressBar([]);
  $("#todayBriefing").innerHTML = `<article class="today-brief-card warning"><div class="today-brief-head"><span>!</span><strong>오늘 해야 할 일을 정리 중입니다.</strong></div><p>연결 상태와 성과 데이터를 확인하고 있습니다.</p></article>`;
  $("#todaySummaryBriefing").innerHTML = `<article class="action-item"><strong>오늘 요약 확인 중</strong><p>검증된 Commerce / Marketing 데이터를 정리합니다.</p></article>`;
  $("#todaySummarySections").innerHTML = `<article class="action-item"><strong>섹션 요약 확인 중</strong><p>대표 숫자를 불러오고 있습니다.</p></article>`;
  $("#actions").innerHTML = `<article class="home-action-card warn"><span>!</span><div><strong>확인 중</strong><p>중요 알림을 정리합니다.</p></div></article>`;
  $("#nextActions").innerHTML = homeGoalCards();
  $("#insightList").innerHTML = homeActivityCards({ status: {}, meta: {}, cafe: {}, data });

  const range = operationsDateRange(data);
  const startDate = range.since;
  const endDate = range.until;
  const [status, meta, cafe, totalSales, contentRange, cardnewsStatus] = await Promise.all([
    getJson("/api/status", 6000),
    getSharedJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}`, 7000),
    getSharedJson(`/api/diagnostics/brand-sales?since=${startDate}&until=${endDate}`, 7000),
    getJson(`/api/sales/total?since=${startDate}&until=${endDate}`, 10000),
    getJson(`/api/instagram/range?since=${startDate}&until=${endDate}`, 7000),
    getJson("/api/contents/cardnews-status", 6000)
  ]);
  if (renderSeq !== undefined && renderSeq !== operationsRenderSeq) return;
  const contentData = {
    ...data,
    source: contentRange.error ? data.source : contentRange.source || data.source,
    syncedAt: contentRange.error ? data.syncedAt : contentRange.syncedAt || data.syncedAt,
    account: contentRange.error ? data.account || {} : contentRange.account || {},
    posts: contentRange.error ? data.posts || [] : contentRange.posts || [],
    contentRangeError: contentRange.error || ""
  };
  const contentRangeError = contentRange.error || "";

  const a = contentData.account || {};
  const metaTotals = meta.totals || {};
  const cafeTotals = cafe.totals || {};
  const instagramErrors = instagramApiErrors(contentData);
  const posts = contentData.posts || [];
  const postCount = posts.length;
  const topContent = topPosts(posts, purposeScore, 1)[0];
  const topSaved = topPosts(posts, (post) => postMetrics(post).saveRate, 1)[0];
  const topCampaign = [...(meta.campaigns || [])].sort((left, right) => Number(right.purchaseValue || 0) - Number(left.purchaseValue || 0))[0];
  const topProduct = normalizeCafe24TopProducts((cafe.products || []).map((product) => ({ productName: product.productName, quantity: product.quantitySold, itemAmount: product.salesAmount })), [])[0];
  const avgSaveRate = avg(posts.map((post) => postMetrics(post).saveRate));
  const parsedFollowerDelta = Number(a.followerDelta);
  const followerDelta = hasApiValue(a.followerDelta) && Number.isFinite(parsedFollowerDelta) ? parsedFollowerDelta : null;
  const metaCanonical = todayCanonicalMetaTotals(meta, `${startDate} ~ ${endDate}`);
  const roas = metaCanonical.reportingSpend > 0 ? metaCanonical.reportingPurchaseValue / metaCanonical.reportingSpend : null;
  const comparison = commerceMetaComparisonState(meta, cafe);

  renderHealthBanner({ instagram: contentData, meta, cafe });
  renderTodaySummary({ data: contentData, cafe, meta, comparison, totalSales });
  todayOverviewState = { data, meta, cafe, contentData, contentRangeError, posts, topProduct, avgSaveRate, followerDelta, range };
  $("#overviewRangeEyebrow").textContent = range.label;
  $("#overviewRangeTitle").textContent = `${range.label} KPI`;
  renderTodayOverviewCards();

  currentTodayBriefingItems = buildTodayBriefing({ data, meta, cafe, cardnewsStatus, account: a, topSaved, topCampaign, topProduct, roas });
  renderTodayBriefing();

  const actions = buildOverviewActions({ data, meta, cafe, account: a, topSaved, roas });
  $("#actions").innerHTML = actions.map((item) => homeActionCard(item)).join("");
  $("#nextActions").innerHTML = homeGoalCards({ cafeTotals: { ...cafeTotals, orderAmount: cafeTotals.paidAmount }, metaTotals: { ...metaTotals, spend: metaCanonical.reportingSpend, purchaseValue: metaCanonical.reportingPurchaseValue }, postCount, followerDelta });
  $("#insightList").innerHTML = homeActivityCards({ status, meta, cafe, data });
}

function todayCanonicalMetaTotals(meta = {}, rangeLabel = "") {
  const rawTotals = meta.totals || {};
  const marketing = todaySummaryState.marketing || {};
  const samePeriod = !marketing.periodLabel || !rangeLabel || marketing.periodLabel === rangeLabel;
  const reportingSpend = samePeriod && Number.isFinite(Number(marketing.reportingSpend))
    ? Number(marketing.reportingSpend)
    : Number(rawTotals.spend || 0);
  const reportingPurchaseValue = samePeriod && Number.isFinite(Number(marketing.reportingPurchaseValue))
    ? Number(marketing.reportingPurchaseValue)
    : Number(rawTotals.purchaseValue || 0);
  return { reportingSpend, reportingPurchaseValue };
}

function renderTodayOverviewCards() {
  if (!todayOverviewState) return;
  const { data, meta, cafe, contentData, contentRangeError, posts, topProduct, avgSaveRate, followerDelta, range } = todayOverviewState;
  const metaCanonical = todayCanonicalMetaTotals(meta, `${range.since} ~ ${range.until}`);
  const roas = metaCanonical.reportingSpend > 0 ? metaCanonical.reportingPurchaseValue / metaCanonical.reportingSpend : null;
  const cafeTotals = cafe.totals || {};
  const a = contentData.account || {};
  const postCount = posts.length;
  $("#kpiGrid").innerHTML = [
    homeTopMetric("선택 기간 광고비", meta.error ? "확인 필요" : apiWon(metaCanonical.reportingSpend), meta.error ? "Meta 연결 후 표시" : "Marketing canonical 기준", cardBadge("meta", meta, hasApiValue(metaCanonical.reportingSpend))),
    homeTopMetric("선택 기간 주문", cafe.error ? "데이터 없음" : `${apiNum(cafeTotals.orderCount)}건`, cafe.error ? "Cafe24 연결 후 표시" : "정상 주문", cardBadge("cafe24", cafe, hasApiValue(cafeTotals.orderCount))),
    homeTopMetric("선택 기간 인기상품", topProduct?.productName || "데이터 없음", topProduct ? `${apiNum(topProduct.quantity)}개 · ${apiWon(topProduct.itemAmount)}` : "판매 상품 데이터 없음", cardBadge("cafe24", cafe, Boolean(topProduct)))
  ].join("");

  $("#overviewLiveData").innerHTML = [
    homeMonthPrimaryCard("매출", cafe.error ? "연결 필요" : apiWon(cafeTotals.paidAmount), cafe.error ? "Cafe24 확인 필요" : `주문 ${apiNum(cafeTotals.orderCount)}건`, cardBadge("cafe24", cafe, hasApiValue(cafeTotals.paidAmount))),
    homeMonthPrimaryCard("ROAS", roas === null ? "확인 중" : multiple(roas), "Meta canonical 구매값 / 광고비", cardBadge("meta", meta, roas !== null)),
    homeMonthPrimaryCard("평균 저장률", contentRangeError ? "확인 필요" : posts.length ? pct(avgSaveRate) : "데이터 없음", contentRangeError ? "Instagram 게시물 데이터 오류" : posts.length ? "콘텐츠 평균" : "콘텐츠 데이터 없음", cardBadge("instagram", contentData, posts.length > 0 && !contentRangeError))
  ].join("");

  $("#overviewLiveSupport").innerHTML = [
    homeMonthSupportCard("광고비", meta.error ? "확인 필요" : apiWon(metaCanonical.reportingSpend), meta.error ? "Meta 확인 필요" : "Marketing canonical 기준", cardBadge("meta", meta, hasApiValue(metaCanonical.reportingSpend))),
    homeMonthSupportCard("팔로워 증가", hasApiValue(followerDelta) ? `${apiNum(followerDelta)}명` : "계산 불가", `현재 ${apiNum(a.followers)}명`, cardBadge("instagram", contentData, hasApiValue(followerDelta))),
    homeMonthSupportCard("콘텐츠 개수", contentRangeError ? "확인 필요" : `${apiNum(postCount)}개`, contentRangeError ? "선택 기간 게시물 데이터 오류" : data.postsScope === "recent_media_fallback" ? "최근 미디어 기준" : "선택 기간 기준", cardBadge("instagram", contentData, postCount > 0 && !contentRangeError))
  ].join("");
}

function buildTodayBriefing({ data, meta, cafe, cardnewsStatus, account, topSaved, topCampaign, topProduct, roas }) {
  const items = [];
  if (cafe.error) {
    items.push({
      level: "critical",
      icon: "!",
      title: "Cafe24 연결 확인",
      why: "실제 매출과 주문 데이터를 불러오지 못했습니다.",
      evidence: cafe.error || "Cafe24 주문 API 확인 필요",
      score: 98,
      basis: ["Cafe24 오류", "매출 카드 연결 필요", "주문 데이터 확인 불가"],
      expected: { reach: "-", saves: "-", shares: "-" },
      view: "Sales",
      cta: "Sales 보기",
      projectKey: "cafe24"
    });
  }
  if (meta.error) {
    items.push({
      level: "critical",
      icon: "!",
      title: "Meta API 오류 확인",
      why: "광고비와 구매값을 확인할 수 없어 ROAS 판단이 막힙니다.",
      evidence: meta.error || "Meta Ads API 확인 필요",
      score: 95,
      basis: ["Meta API 오류", "광고비 확인 불가", "ROAS 판단 불가"],
      expected: { reach: "-", saves: "-", shares: "-" },
      view: "Advertising",
      cta: "광고 보기",
      projectKey: "advertising"
    });
  }
  if (roas !== null && roas < 1) {
    items.push({
      level: "warning",
      icon: "!",
      title: "ROAS 낮은 광고 점검",
      why: "광고비 대비 Meta 기준 구매값이 낮습니다.",
      evidence: `ROAS ${multiple(roas)} · 광고비 ${apiWon(meta.totals?.spend)} · 구매값 ${apiWon(meta.totals?.purchaseValue)}`,
      score: recommendationScore(86, roas < 0.5 ? 10 : 0),
      basis: [`ROAS ${multiple(roas)}`, `광고비 ${apiWon(meta.totals?.spend)}`, `구매값 ${apiWon(meta.totals?.purchaseValue)}`],
      expected: { reach: apiNum(meta.totals?.reach), saves: "-", shares: "-" },
      view: "Advertising",
      cta: "광고 점검",
      projectKey: "advertising"
    });
  }
  if (topSaved) {
    const m = postMetrics(topSaved);
    items.push({
      level: "opportunity",
      icon: "+",
      title: "저장률 높은 콘텐츠 재활용",
      why: "저장률이 높은 콘텐츠는 다시 볼 이유가 있어 다음 카드뉴스 소재로 확장하기 좋습니다.",
      evidence: `${topSaved.title || "성과 좋은 콘텐츠"} · 저장률 ${pct(m.saveRate)} · 저장 ${apiNum(topSaved.saves)}`,
      score: recommendationScore(72, m.saveRate * 3),
      basis: [`저장률 ${pct(m.saveRate)}`, `Reach ${apiNum(topSaved.reach)}`, `최근 게시 ${topSaved.date || "-"}`],
      expected: {
        reach: apiNum(Math.round(Number(topSaved.reach || topSaved.views || 0) * 0.85)),
        saves: apiNum(Math.round(Number(topSaved.saves || 0) * 0.9)),
        shares: apiNum(Math.round(Number(topSaved.shares || 0) * 0.9))
      },
      view: "Content",
      cta: "콘텐츠 보기",
      projectKey: "content"
    });
  }
  const cardnewsProject = activeCardnewsProject(cardnewsStatus);
  if (cardnewsProject) {
    const pngCount = Number(cardnewsProject.outputPngCount || 0);
    items.push({
      level: pngCount ? "opportunity" : "idea",
      icon: pngCount ? "✓" : "i",
      title: `${cardnewsProject.brandName || cardnewsProject.projectName} 카드뉴스 진행 확인`,
      why: pngCount ? "출력 파일이 있어 업로드 또는 검수 단계로 넘길 수 있습니다." : "진행 중인 카드뉴스 프로젝트를 이어서 정리할 수 있습니다.",
      evidence: `${cardnewsProject.projectName || "CARD NEWS"} · ${cardnewsProject.status || "진행 중"} · PNG ${apiNum(pngCount)}개 · ${cardnewsProject.modifiedLabel || "-"}`,
      score: recommendationScore(pngCount ? 82 : 70, pngCount ? Math.min(pngCount, 10) : 0),
      basis: [`상태 ${cardnewsProject.status || "진행 중"}`, `마지막 수정 ${cardnewsProject.modifiedLabel || "-"}`, `출력 PNG ${apiNum(pngCount)}개`],
      expected: { reach: "-", saves: "-", shares: "-" },
      view: "Content",
      cta: "콘텐츠 보기",
      projectKey: "cardnews",
      projectUrl: cardnewsLauncherUrl(cardnewsProject)
    });
  }
  const editorialBrand = editorialBriefBrand(data);
  const avgReach = Math.round(avg((data.posts || []).map((post) => Number(post.reach || post.views || 0))));
  const avgSaves = Math.round(avg((data.posts || []).map((post) => Number(post.saves || 0))));
  const avgShares = Math.round(avg((data.posts || []).map((post) => Number(post.shares || 0))));
  items.push({
    level: "idea",
    icon: "i",
    title: `${editorialBrand} 카드뉴스 제작 추천`,
    why: "브랜드 히스토리와 제품 디테일은 저장/공유를 만들기 좋은 정보형 소재입니다.",
    evidence: topProduct ? `인기상품 ${topProduct.productName} · ${apiNum(topProduct.quantity)}개 판매` : `팔로워 변화 ${apiNum(account.followerDelta)}명 · 콘텐츠 ${apiNum((data.posts || []).length)}개`,
    score: recommendationScore(78, topProduct ? 8 : 0),
    basis: [`추천 브랜드 ${editorialBrand}`, `평균 Reach ${apiNum(avgReach)}`, `최근 콘텐츠 ${(data.posts || []).length}개`],
    expected: { reach: apiNum(Math.round(avgReach * 1.12)), saves: apiNum(Math.round(avgSaves * 1.18)), shares: apiNum(Math.round(avgShares * 1.12)) },
    view: "Editorial AI",
    cta: "전략 보기",
    projectKey: "editorial"
  });
  return items
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 4)
    .map((item) => ({
    ...item,
    id: todayBriefId(item)
  }));
}

function activeCardnewsProject(cardnewsStatus = {}) {
  const items = Array.isArray(cardnewsStatus.items) ? cardnewsStatus.items : [];
  return items.find((item) => item.status === "진행 중") || items[0] || null;
}

function cardnewsLauncherUrl(project = {}) {
  const url = new URL("http://127.0.0.1:8789/");
  const projectName = project.projectName || project.brandName || "";
  if (projectName) url.searchParams.set("project", projectName);
  if (project.projectName) url.searchParams.set("projectName", project.projectName);
  if (project.projectPath) url.searchParams.set("projectPath", project.projectPath);
  if (project.folderOpenUrl) url.searchParams.set("folderOpenUrl", project.folderOpenUrl);
  return url.toString();
}

function todayBriefId(item) {
  return String(`${item.view}-${item.title}`)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
}

function recommendationScore(base, bonus = 0) {
  return Math.max(0, Math.min(100, Math.round(Number(base || 0) + Number(bonus || 0))));
}

function editorialBriefBrand(data) {
  const posts = data.posts || [];
  const rows = editorialBrandRows(posts);
  const candidates = editorialOpportunityBrands(rows);
  return candidates[0] || rows[0]?.brand || "GOOMHEO";
}

function todayStorageKey() {
  return `samplas.todayBriefing.${new Date().toISOString().slice(0, 10)}`;
}

function readTodayBriefingState() {
  try {
    return JSON.parse(localStorage.getItem(todayStorageKey()) || "{}");
  } catch {
    return {};
  }
}

function writeTodayBriefingState(state) {
  localStorage.setItem(todayStorageKey(), JSON.stringify(state || {}));
}

function todayBriefState(item) {
  const state = readTodayBriefingState()[item.id] || {};
  return {
    status: state.status || "todo",
    doneAt: state.doneAt || ""
  };
}

function nextTodayStatus(status) {
  if (status === "todo") return "progress";
  if (status === "progress") return "done";
  return "todo";
}

function todayStatusLabel(status) {
  if (status === "progress") return "진행 중";
  if (status === "done") return "완료됨";
  return "진행 전";
}

function todayStatusIcon(status) {
  if (status === "progress") return "⏳";
  if (status === "done") return "✓";
  return "□";
}

function renderTodayBriefing() {
  const target = $("#todayBriefing");
  if (!target) return;
  target.innerHTML = currentTodayBriefingItems.map((item) => todayBriefCard(item)).join("");
  $("#todayBriefProgress").innerHTML = todayBriefProgressBar(currentTodayBriefingItems);
}

function todayBriefProgressBar(items) {
  const total = items.length || 0;
  const done = items.filter((item) => todayBriefState(item).status === "done").length;
  const percent = total ? Math.round(done / total * 100) : 0;
  return `<div class="today-progress-card">
    <div><span>오늘 업무</span><strong>${done} / ${total} 완료</strong></div>
    <i><b style="width:${percent}%"></b></i>
    <em>${percent}%</em>
  </div>`;
}

// Legacy priority helper kept for compatibility with older local state.
function starRating(score) {
  const stars = Math.max(1, Math.min(5, Math.round(Number(score || 0) / 20)));
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

function todayBriefCard(item) {
  const state = todayBriefState(item);
  const done = state.status === "done";
  return `<article class="today-brief-card ${esc(item.level)} ${esc(state.status)}" data-brief-id="${esc(item.id)}">
    <div class="today-brief-top">
      <div class="today-brief-head"><span>${done ? "✓" : esc(item.icon)}</span><div class="today-brief-title-row"><strong>${esc(item.title)}</strong></div></div>
      <button class="today-status-button" type="button" data-brief-status="${esc(item.id)}">${todayStatusIcon(state.status)} ${todayStatusLabel(state.status)}</button>
    </div>
    <p>${esc(item.why)}</p>
    <small>${esc(item.evidence)}</small>
    <div class="today-brief-basis">
      ${(item.basis || []).slice(0, 3).map((value) => `<span>${esc(value)}</span>`).join("")}
    </div>
    ${done ? `<time>완료 시간 ${esc(state.doneAt)}</time>` : ""}
    <div class="today-brief-buttons">
      <button class="today-jump-button" type="button" data-jump-view="${esc(item.view)}">${esc(item.cta)}</button>
      <button class="today-project-button" type="button" data-project-key="${esc(item.projectKey || "")}" data-project-url="${esc(item.projectUrl || "")}">프로젝트 열기</button>
    </div>
  </article>`;
}

function readProjectLinks() {
  try {
    return { ...defaultProjectLinks, ...JSON.parse(localStorage.getItem("samplas.projectLinks") || "{}") };
  } catch {
    return { ...defaultProjectLinks };
  }
}

function projectLinkFor(key) {
  return readProjectLinks()[key] || "";
}

function buildOverviewActions({ data, meta, cafe, account, topSaved, roas }) {
  const urgent = [
    cafe.error ? { level: "urgent", category: "Critical", icon: "!", title: "Cafe24 연결 오류", text: "실제 매출을 불러오지 못했습니다." } : null,
    meta.error ? { level: "urgent", category: "Critical", icon: "!", title: "Meta API 오류", text: "광고 성과를 불러오지 못했습니다." } : null,
    data.error ? { level: "urgent", category: "Critical", icon: "!", title: "Instagram 오류", text: "콘텐츠 성과를 불러오지 못했습니다." } : null
  ].filter(Boolean);
  const watch = [
    roas !== null && roas < 1 ? { level: "warn", category: "Warning", icon: "!", title: "ROAS 감소", text: "광고비 대비 구매 신호가 약합니다." } : null,
    Number(account.reachDelta) < 0 ? { level: "warn", category: "Warning", icon: "↓", title: "도달 감소", text: `Reach가 ${pct(Math.abs(Number(account.reachDelta)))} 감소했습니다.` } : null,
    Number(account.websiteClickDelta) < 0 ? { level: "warn", category: "Warning", icon: "↓", title: "클릭 감소", text: `웹사이트 클릭이 ${pct(Math.abs(Number(account.websiteClickDelta)))} 감소했습니다.` } : null
  ].filter(Boolean);
  const good = [
    topSaved ? { level: "good", category: "Opportunity", icon: "★", title: "저장률 높은 릴스", text: `"${topSaved.title || "성과 좋은 콘텐츠"}" 반응이 좋습니다.` } : null,
    hasApiValue(account.followerDelta) && Number(account.followerDelta) > 0 ? { level: "good", category: "Opportunity", icon: "+", title: "팔로우 증가", text: `${apiNum(account.followerDelta)}명 증가했습니다.` } : null,
    !urgent.length && !watch.length ? { level: "good", category: "Opportunity", icon: "✓", title: "운영 상태 양호", text: "큰 오류 없이 주요 데이터를 볼 수 있습니다." } : null
  ].filter(Boolean);
  return [...urgent, ...watch, ...good].slice(0, 4);
}

function homeTopMetric(label, value, note, badge) {
  return `<article class="kpi home-kpi">${dataBadgeHtml(badge)}<span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong><p class="delta">${esc(note)}</p></article>`;
}

function homeMonthCard(label, value, note, badge) {
  return `<article class="home-month-card">${dataBadgeHtml(badge)}<span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

// Overview "이번 달 KPI" now follows the same 대표/보조 visual language as
// Reports/Content/Advertising/Sales: 3 emphasized primary cards (green accent,
// reused from Advertising's ad-core-kpi-card) + a compact supporting row
// (reused from Reports' report-support-row).
function homeMonthPrimaryCard(label, value, note, badge) {
  return `<article class="action-item ad-summary-card ad-core-kpi-card">${dataBadgeHtml(badge)}<span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function homeMonthSupportCard(label, value, note, badge) {
  return `<div class="report-support-item">${dataBadgeHtml(badge)}<span>${esc(label)}</span><strong>${esc(value)}</strong><em>${esc(note)}</em></div>`;
}

function homeActionCard(item) {
  return `<article class="home-action-card ${esc(item.level)}"><span>${esc(item.icon || "•")}</span><div><em>${esc(item.category || "")}</em><strong>${esc(item.title)}</strong><p>${esc(item.text)}</p></div></article>`;
}

function homeGoalCards({ cafeTotals = {}, metaTotals = {}, postCount = 0, followerDelta = null } = {}) {
  const items = [
    { label: "매출", value: goalPercent(Number(cafeTotals.orderAmount || 0), 5000000), note: "월 목표 500만원" },
    { label: "광고", value: goalPercent(Number(metaTotals.spend || 0), 1500000), note: "월 예산 150만원" },
    { label: "콘텐츠", value: goalPercent(Number(postCount || 0), 20), note: "월 목표 20개" },
    { label: "팔로워", value: hasApiValue(followerDelta) ? goalPercent(Math.max(0, Number(followerDelta)), 300) : null, note: hasApiValue(followerDelta) ? "월 목표 +300명" : "월 목표 +300명 · 계산 불가" }
  ];
  return items.map((item) => `<article class="home-goal-card">
    <div><span>${esc(item.label)}</span><strong>${item.value === null ? "-" : `${item.value}%`}</strong></div>
    <i><b style="width:${item.value === null ? 0 : item.value}%"></b></i>
    <p>${esc(item.note)}</p>
  </article>`).join("");
}

function goalPercent(value, target) {
  if (!target) return 0;
  const percent = Math.round((Number(value || 0) / target) * 100);
  return Math.max(0, Math.min(100, percent || 0));
}

function homeActivityCards({ status = {}, meta = {}, cafe = {}, data = {} }) {
  const instagramOk = !data.error && status.instagram !== false;
  // 진단용 로그 (2026-07-08). data는 /api/instagram/monthly 응답, status는 /api/status 응답이다.
  // instagramOk가 false인데 data.error가 비어있다면 status.instagram이 원인이고,
  // data.error가 채워져 있다면 loadMonths()가 받아온 시점의 실제 값이 원인이다.
  console.log({ data, status, instagramOk });
  const metaOk = !meta.error && status.metaAds !== false;
  const cafeOk = !cafe.error && status.cafe24 !== false;
  return [
    homeActivityCard("Cafe24 동기화", cafeOk ? "완료" : "확인 필요", cafeOk ? "주문 데이터를 불러왔습니다." : "주문 연결을 확인하세요.", syncStatusText(cafe), cafeOk ? "good" : "warn"),
    homeActivityCard("Meta 광고 업데이트", metaOk ? "완료" : "확인 필요", metaOk ? "광고 데이터를 불러왔습니다." : "광고 연결을 확인하세요.", syncStatusText(meta), metaOk ? "good" : "warn"),
    homeActivityCard("Instagram 캐시 저장", instagramOk ? "완료" : "확인 필요", instagramOk ? "콘텐츠 데이터를 불러왔습니다." : "연결 상태를 확인하세요.", syncStatusText(data), instagramOk ? "good" : "warn"),
    homeActivityCard("월간 보고서", "대기", "Reports에서 월간 정리를 확인할 수 있습니다.", "-", "neutral")
  ].join("");
}

function homeActivityCard(label, value, note, time, level) {
  return `<article class="home-activity-card ${esc(level)}"><div><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></div><time>${esc(time)}</time></article>`;
}

function brandFromProduct(productName = "") {
  const cleaned = String(productName || "").trim();
  if (!cleaned) return "-";
  return cleaned.split(/\s+/)[0] || cleaned;
}

function interaction(post) {
  return Number(post.totalInteractions || 0) || Number(post.likes || 0) + Number(post.comments || 0) + Number(post.saves || 0) + Number(post.shares || 0);
}

function postInteractionValue(post) {
  if (hasApiValue(post.totalInteractions)) return post.totalInteractions;
  const values = [post.likes, post.comments, post.saves, post.shares].filter(hasApiValue);
  return values.length ? values.reduce((total, value) => total + Number(value), 0) : null;
}

function sum(items, key) {
  return (items || []).reduce((total, item) => total + Number(item?.[key] || 0), 0);
}

function avg(values) {
  const usable = (values || []).filter((value) => Number.isFinite(Number(value)));
  return usable.length ? usable.reduce((total, value) => total + Number(value), 0) / usable.length : 0;
}

function rate(value, base) {
  const denominator = Number(base || 0);
  return denominator ? Number(value || 0) / denominator * 100 : 0;
}

function postMetrics(post) {
  const reach = Number(post.reach || 0);
  const views = Number(post.views || 0);
  const clicks = Number(post.websiteClicks || 0);
  const sales = Number(post.cafe24Sales7d || 0);
  const spend = Number(post.adSpend || 0);
  return {
    engagementRate: rate(interaction(post), reach || views),
    saveRate: rate(post.saves, reach || views),
    shareRate: rate(post.shares, reach || views),
    commentRate: rate(post.comments, reach || views),
    likeRate: rate(post.likes, reach || views),
    clickRate: rate(clicks, reach || views),
    sales,
    roas: spend ? sales / spend : 0
  };
}

function purposeScore(post) {
  const m = postMetrics(post);
  const reachScore = Math.min(35, Number(post.reach || 0) / 850);
  const viewScore = Math.min(20, Number(post.views || 0) / 1500);
  const saveScore = Math.min(18, m.saveRate * 4);
  const shareScore = Math.min(12, m.shareRate * 8);
  const clickScore = Math.min(10, m.clickRate * 3);
  const salesScore = Math.min(5, Number(post.cafe24Sales7d || 0) / 200000);
  return reachScore + viewScore + saveScore + shareScore + clickScore + salesScore;
}

function topPosts(posts, selector, count = 5) {
  return [...(posts || [])].sort((left, right) => Number(selector(right) || 0) - Number(selector(left) || 0)).slice(0, count);
}

function summarizeByType(posts) {
  const groups = new Map();
  for (const post of posts || []) {
    const type = post.type || "기타";
    const group = groups.get(type) || [];
    group.push(post);
    groups.set(type, group);
  }
  return [...groups.entries()].map(([type, group]) => ({
    type,
    count: group.length,
    reach: sum(group, "reach"),
    saves: sum(group, "saves"),
    shares: sum(group, "shares"),
    avgSaveRate: avg(group.map((post) => postMetrics(post).saveRate))
  })).sort((left, right) => right.count - left.count);
}

function explainPost(post) {
  const m = postMetrics(post);
  if (post.type === "카드뉴스") return `저장 ${num(post.saves)} / 공유 ${num(post.shares)} / 저장률 ${pct(m.saveRate)}. 카드뉴스는 저장과 공유를 핵심으로 봅니다.`;
  if (post.type === "릴스") return `도달 ${num(post.reach)} / 조회 ${num(post.views)} / 참여율 ${pct(m.engagementRate)}. 릴스는 신규 유입과 조회 효율을 봅니다.`;
  if (Number(post.websiteClicks || 0)) return `웹사이트 클릭 ${num(post.websiteClicks)} / 클릭률 ${pct(m.clickRate)}. 구매 유입 후보 콘텐츠입니다.`;
  return `좋아요 ${num(post.likes)}, 댓글 ${num(post.comments)}, 저장 ${num(post.saves)}, 공유 ${num(post.shares)}를 함께 봅니다.`;
}

function renderInsights(data) {
  const posts = data.posts || [];
  const a = data.account || {};
  const topReach = topPosts(posts, (post) => post.reach, 1)[0];
  const topSave = topPosts(posts, (post) => post.saves, 1)[0];
  const cardAvgSave = avg(posts.filter((post) => post.type === "카드뉴스").map((post) => postMetrics(post).saveRate));
  const notes = [
    `${data.month} 기준 도달 ${num(a.reach)}회, 조회 ${num(a.views)}회입니다.`,
    `프로필 방문 ${num(a.profileVisits)}회, 웹사이트 클릭 ${num(a.websiteClicks)}회입니다.`,
    topReach ? `도달 1위는 "${esc(topReach.title)}"입니다. 도달 ${num(topReach.reach)}회입니다.` : "게시물별 데이터가 없는 월입니다.",
    topSave ? `저장 1위는 "${esc(topSave.title)}"입니다. 저장 ${num(topSave.saves)}회, 카드뉴스 평균 저장률 ${pct(cardAvgSave)}입니다.` : "저장/공유 분석은 게시물 데이터가 필요합니다."
  ];
  $("#insightList").innerHTML = notes.map((note) => `<div class="insight">${note}</div>`).join("");
}

function renderPurposeRadar(posts) {
  const target = $("#purposeRadar");
  if (!target) return;
  const groups = new Map();
  for (const post of posts || []) {
    const key = post.tag || post.type || "기타";
    const current = groups.get(key) || { label: key, score: 0 };
    current.score += Math.round(Number(post.reach || 0) / 100 + interaction(post));
    groups.set(key, current);
  }
  const rows = [...groups.values()].sort((a, b) => b.score - a.score).slice(0, 7);
  const max = Math.max(1, ...rows.map((row) => row.score));
  target.innerHTML = rows.length ? rows.map((row) => (
    `<div class="bar-row"><span>${esc(row.label)}</span><div class="bar"><i style="width:${Math.max(6, row.score / max * 100)}%"></i></div><em>${num(row.score)}</em></div>`
  )).join("") : `<div class="insight">게시물별 데이터가 없습니다.</div>`;
}

function renderContentTable(posts, data = selectedMonth()) {
  renderContentSummary(data);
  renderContentPerformanceCenter(posts || [], data);
  const legacyRows = $("#contentRows");
  if (!legacyRows) return;
  legacyRows.innerHTML = (posts || []).slice(0, 80).map((post) => {
    const metrics = postMetrics(post);
    return `<tr>
      <td>${esc(post.date || "-")}</td>
      <td><strong>${esc(post.title || "-")}</strong><br>${esc(post.tag || "-")}</td>
      <td>${esc(post.type || "-")}</td>
      <td>${apiNum(post.reach)}</td>
      <td>${apiNum(post.views)}</td>
      <td>${apiNum(post.likes)}</td>
      <td>${apiNum(post.comments)}</td>
      <td>${apiNum(post.saves)}</td>
      <td>${apiNum(post.shares)}</td>
      <td>${pct(metrics.engagementRate)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="10">게시물별 데이터가 없습니다.</td></tr>`;
}

async function renderContentOperations(data, renderSeq) {
  const setPending = (selector, html) => {
    const target = $(selector);
    if (target) target.innerHTML = html;
  };
  setPending("#contentSummaryHero", `<article class="action-item"><strong>Content 데이터 확인 중</strong><p>선택 기간 게시물 지표를 불러오고 있습니다.</p></article>`);
  setPending("#contentSummaryPerformance", `<article class="action-item"><strong>콘텐츠 성과 확인 중</strong><p>저장과 공유 상위 콘텐츠를 정리합니다.</p></article>`);
  setPending("#contentSummaryFormat", `<article class="action-item"><strong>Format Mix 확인 중</strong><p>콘텐츠 유형별 구성을 불러오고 있습니다.</p></article>`);
  setPending("#contentKpiGrid", `<article class="action-item"><strong>콘텐츠 KPI 확인 중</strong><p>선택 기간 콘텐츠 지표를 불러오고 있습니다.</p></article>`);
  setPending("#contentTopGrid", `<article class="action-item"><strong>TOP 콘텐츠 확인 중</strong><p>선택 기간 상위 콘텐츠를 정리합니다.</p></article>`);
  setPending("#contentTypeGrid", `<article class="action-item"><strong>콘텐츠 유형 확인 중</strong><p>Format Mix를 불러오고 있습니다.</p></article>`);
  setPending("#contentHeatmap", `<article class="action-item"><strong>게시시간 확인 중</strong><p>시간대별 성과를 정리합니다.</p></article>`);
  setPending("#contentBrandGrid", `<article class="action-item"><strong>브랜드별 성과 확인 중</strong><p>콘텐츠 브랜드 신호를 정리합니다.</p></article>`);
  setPending("#contentAiGrid", `<article class="action-item"><strong>AI 추천 확인 중</strong><p>콘텐츠 추천 근거를 정리합니다.</p></article>`);
  const range = operationsDateRange(data);
  const rangeData = await getJson(`/api/instagram/range?since=${range.since}&until=${range.until}`, 9000);
  if (renderSeq !== undefined && renderSeq !== operationsRenderSeq) return;
  if (rangeData.error) {
    const message = rangeData.error || "이전 월 데이터는 유지되지만 선택 기간 게시물 지표를 확인할 수 없습니다.";
    const heroTarget = $("#contentSummaryHero");
    const performanceTarget = $("#contentSummaryPerformance");
    const formatTarget = $("#contentSummaryFormat");
    const rowsTarget = $("#contentRows");
    const errorCard = `<article class="action-item"><strong>Instagram 게시물 데이터를 불러오지 못했습니다.</strong><p>${esc(message)} 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    if (heroTarget) heroTarget.innerHTML = errorCard;
    if (performanceTarget) performanceTarget.innerHTML = `<article class="action-item"><strong>선택 기간 성과 확인 불가</strong><p>이전 월 데이터는 유지되지만 선택 기간 게시물 지표를 확인할 수 없습니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    if (formatTarget) formatTarget.innerHTML = `<article class="action-item"><strong>Format Mix 확인 불가</strong><p>선택 기간 게시물 데이터를 불러오지 못했습니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    [
      "#contentKpiGrid",
      "#contentTopGrid",
      "#contentTypeGrid",
      "#contentHeatmap",
      "#contentBrandGrid",
      "#contentAiGrid"
    ].forEach((selector) => {
      const target = $(selector);
      if (target) target.innerHTML = `<article class="action-item"><strong>Content 데이터 확인 불가</strong><p>Instagram 선택 기간 데이터를 불러오지 못했습니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    });
    if (rowsTarget) rowsTarget.innerHTML = `<tr><td colspan="10">Instagram 게시물 데이터를 불러오지 못했습니다.</td></tr>`;
    return;
  }
  const contentData = {
    ...data,
    source: rangeData.source || data.source,
    syncedAt: rangeData.syncedAt || data.syncedAt,
    account: rangeData.account || {},
    posts: rangeData.posts || []
  };
  renderContentTable(contentData.posts || [], contentData);
}

function renderContentSummary(data = {}) {
  const posts = data.posts || [];
  const account = data.account || {};
  const heroTarget = $("#contentSummaryHero");
  const performanceTarget = $("#contentSummaryPerformance");
  const formatTarget = $("#contentSummaryFormat");
  if (!heroTarget || !performanceTarget || !formatTarget) return;

  const totalViews = sum(posts, "views");
  const totalSaves = sum(posts, "saves");
  const totalShares = sum(posts, "shares");
  const totalLikes = sum(posts, "likes");
  const avgSaveRate = posts.length ? avg(posts.map((post) => postMetrics(post).saveRate)) : null;
  const followerDelta = Number(account.followerDelta);
  const followerLabel = hasApiValue(account.followerDelta) && Number.isFinite(followerDelta)
    ? `${followerDelta > 0 ? "+" : ""}${apiNum(followerDelta)}명`
    : "계산 불가";

  heroTarget.innerHTML = `<section class="ops-summary-hero">
    <div class="ops-summary-hero-main">
      <span>조회 합산</span>
      <strong class="ops-summary-hero-num">${apiNum(totalViews)}</strong>
      <p class="ops-summary-hero-sub">전체 게시물 views 합계</p>
    </div>
    <div class="ops-summary-hero-main">
      <span>저장</span>
      <strong class="ops-summary-hero-num">${apiNum(totalSaves)}</strong>
      <p class="ops-summary-hero-sub">전체 게시물 saves 합계</p>
    </div>
    <div class="ops-summary-side">
      ${opsStatRow("공유", apiNum(totalShares))}
      ${opsStatRow("좋아요", apiNum(totalLikes))}
      ${opsStatRow("게시물", `${apiNum(posts.length)}개`)}
      ${opsStatRow("팔로워 증가", followerLabel, { muted: true, note: "월별 snapshot 기준" })}
    </div>
  </section>`;

  const savedTop = topPosts(posts, (post) => post.saves, 3);
  const sharedTop = topPosts(posts, (post) => post.shares, 3);
  const aboveAverage = avgSaveRate === null ? [] : posts
    .filter((post) => postMetrics(post).saveRate > avgSaveRate)
    .sort((a, b) => postMetrics(b).saveRate - postMetrics(a).saveRate)
    .slice(0, 3);
  performanceTarget.innerHTML = `<section class="ops-summary-cols">
    <div class="ops-summary-block">
      <div class="ops-summary-block-head"><h4>저장 TOP 3</h4><span>postMetrics saveRate</span></div>
      ${savedTop.length ? savedTop.map((post, index) => opsRankRow(index, post.title || "-", `저장 ${apiNum(post.saves)} · 저장률 ${pct(postMetrics(post).saveRate)}`)).join("") : opsRankRow(0, "데이터 없음", "-")}
      <p class="ops-summary-obs">평균 저장률 상회 ${apiNum(aboveAverage.length)}개 · ${avgSaveRate === null ? "저장률 데이터 없음" : `평균 ${pct(avgSaveRate)}`}</p>
      ${aboveAverage.length ? aboveAverage.map((post, index) => opsRankRow(index, post.title || "-", `저장률 ${pct(postMetrics(post).saveRate)}`)).join("") : ""}
    </div>
    <div class="ops-summary-block">
      <div class="ops-summary-block-head"><h4>공유 TOP 3</h4><span>postMetrics shareRate</span></div>
      ${sharedTop.length ? sharedTop.map((post, index) => opsRankRow(index, post.title || "-", `공유 ${apiNum(post.shares)} · 공유율 ${pct(postMetrics(post).shareRate)}`)).join("") : opsRankRow(0, "데이터 없음", "-")}
    </div>
  </section>`;

  const summary = summarizeByType(posts);
  const totalPosts = Math.max(1, posts.length);
  const formatTypes = [
    { label: "릴스", source: "릴스" },
    { label: "카드뉴스", source: "카드뉴스" },
    { label: "피드", source: "피드" }
  ];
  const formatRows = formatTypes.map(({ label, source }) => {
    const item = summary.find((row) => row.type === source) || { count: 0, reach: 0, saves: 0, shares: 0, avgSaveRate: 0 };
    const ratio = Number(item.count || 0) / totalPosts * 100;
    return { label, item, ratio };
  });
  const lead = formatRows.reduce((best, row) => Number(row.item.count || 0) > Number(best.item.count || 0) ? row : best, formatRows[0] || { label: "데이터 없음", item: { count: 0 }, ratio: 0 });
  const unused = formatRows.filter((row) => !Number(row.item.count || 0)).map((row) => `${row.label} 0개`);
  formatTarget.innerHTML = `<section class="ops-summary-block">
    <div class="ops-summary-block-head"><h4>Format Mix</h4><span>콘텐츠 유형별 구성</span></div>
    <div class="ops-summary-lead">
      <strong>${esc(lead.label)} ${pct(lead.ratio)}</strong>
      <div class="ops-summary-bar"><i style="width:${monthlyReportRatio(lead.ratio, 100)}%"></i></div>
      <p>${apiNum(lead.item.count)}개 · Reach ${apiNum(lead.item.reach)} · 저장 ${apiNum(lead.item.saves)} · 공유 ${apiNum(lead.item.shares)} · 저장률 ${pct(lead.item.avgSaveRate)}</p>
    </div>
    ${formatRows.map((row) => `<div class="ops-summary-srow ${Number(row.item.count || 0) ? "" : "is-muted"}">
      <span>${esc(row.label)}</span>
      <strong>${pct(row.ratio)}</strong>
      <em>${apiNum(row.item.count)}개 · 저장 ${apiNum(row.item.saves)} · 공유 ${apiNum(row.item.shares)}</em>
    </div>`).join("")}
    ${unused.length ? `<p class="ops-summary-fnote">${esc(unused.join(" · "))} — 이번 기간 미사용</p>` : ""}
  </section>`;
}

function renderContentPerformanceCenter(posts, data = {}) {
  const account = data.account || {};
  const targetKpis = $("#contentKpiGrid");
  if (!targetKpis) return;
  const totalReach = sum(posts, "reach");
  const totalLikes = sum(posts, "likes");
  const totalShares = sum(posts, "shares");
  const avgSaveRate = posts.length ? avg(posts.map((post) => postMetrics(post).saveRate)) : null;
  // Information-density pass: 저장률/Reach stay as the two highlighted
  // numbers a director actually judges content by; 게시물 수/Likes/Shares/
  // 팔로우 증가 move into one compact secondary row instead of 6 equal-weight
  // 128px cards. Same underlying data as before (postMetrics/sum), no new
  // calculation source.
  targetKpis.innerHTML = `
    <article class="content-kpi-highlight">
      <span>저장률</span>
      <strong>${avgSaveRate === null ? "데이터 없음" : pct(avgSaveRate)}</strong>
      <p>선택 기간 평균 저장률</p>
    </article>
    <article class="content-kpi-highlight">
      <span>Reach</span>
      <strong>${apiNum(totalReach)}</strong>
      <p>게시물 합산 도달</p>
    </article>
    <div class="content-kpi-row">
      ${contentKpiRowItem("게시물 수", `${apiNum(posts.length)}개`)}
      ${contentKpiRowItem("Likes", apiNum(totalLikes))}
      ${contentKpiRowItem("Shares", apiNum(totalShares))}
      ${contentKpiRowItem("팔로우 증가", hasApiValue(account.followerDelta) ? `${apiNum(account.followerDelta)}명` : "-")}
    </div>
  `;

  $("#contentTopGrid").innerHTML = [
    contentRankingCard("조회수 TOP 5", topPosts(posts, (post) => post.views || post.reach, 5), (post) => `조회 ${apiNum(post.views)} · Reach ${apiNum(post.reach)}`),
    contentRankingCard("저장률 TOP 5", topPosts(posts, (post) => postMetrics(post).saveRate, 5), (post) => `저장률 ${pct(postMetrics(post).saveRate)} · 저장 ${apiNum(post.saves)}`),
    contentRankingCard("공유 TOP 5", topPosts(posts, (post) => post.shares, 5), (post) => `공유 ${apiNum(post.shares)} · 공유율 ${pct(postMetrics(post).shareRate)}`),
    contentRankingCard("프로필·클릭 반응 TOP 5", topPosts(posts, (post) => post.follows || post.profileVisits || post.websiteClicks || postMetrics(post).engagementRate, 5), (post) => `프로필 ${apiNum(post.profileVisits)} · 클릭 ${apiNum(post.websiteClicks)}`)
  ].join("");

  $("#contentHeatmap").innerHTML = contentHeatmapCards(posts);
  $("#contentBrandGrid").innerHTML = contentBrandCards(posts);
  $("#contentAiGrid").innerHTML = contentRecommendationCards(posts);
}

function contentKpiCard(label, value, note) {
  return `<article class="content-kpi-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function contentKpiRowItem(label, value) {
  return `<div class="content-kpi-row-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function contentRankingCard(title, rows, helper) {
  return `<article class="content-rank-card">
    <h4>${esc(title)}</h4>
    ${rows.length ? `<ol>${rows.map((post, index) => `<li>
      <mark>${index + 1}</mark>
      <div><strong title="${esc(post.title || "-")}">${esc(post.title || "-")}</strong><p>${esc(helper(post))}</p></div>
    </li>`).join("")}</ol>` : contentEmpty("콘텐츠 데이터가 없습니다.")}
  </article>`;
}

function contentTypeCards(posts) {
  const summary = summarizeByType(posts);
  const total = Math.max(1, posts.length);
  const expected = ["릴스", "카드뉴스", "피드"];
  const rows = expected.map((type) => summary.find((item) => item.type === type) || { type, count: 0, reach: 0, avgSaveRate: 0, shares: 0 });
  return rows.map((item) => {
    const share = Math.round(Number(item.count || 0) / total * 100);
    return `<article class="content-type-card">
      <div><span>${esc(item.type)}</span><strong>${share}%</strong></div>
      <i><b style="width:${Math.max(4, share)}%"></b></i>
      <p>${apiNum(item.count)}개 · Reach ${apiNum(item.reach)} · 저장률 ${pct(item.avgSaveRate)}</p>
    </article>`;
  }).join("");
}

function contentHeatmapCards(posts) {
  const dayRows = contentTimeGroups(posts, "day");
  const hourRows = contentTimeGroups(posts, "hour");
  return [
    contentHeatmapGroup("요일별 성과", dayRows),
    contentHeatmapGroup("시간대별 성과", hourRows)
  ].join("");
}

function contentTimeGroups(posts, mode) {
  const labels = mode === "day" ? ["월", "화", "수", "목", "금", "토", "일"] : ["오전", "점심", "오후", "저녁"];
  const groups = new Map(labels.map((label) => [label, []]));
  for (const post of posts) {
    const key = mode === "day" ? contentDayLabel(post.date) : contentHourLabel(post.date || post.createdAt || post.timestamp);
    groups.set(key, [...(groups.get(key) || []), post]);
  }
  return [...groups.entries()].map(([label, group]) => ({
    label,
    count: group.length,
    score: Math.round(avg(group.map((post) => Number(post.reach || 0) + interaction(post) * 10)))
  }));
}

function contentDayLabel(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "월";
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
}

function contentHourLabel(value) {
  const date = new Date(value || "");
  const hour = Number.isNaN(date.getTime()) ? 12 : date.getHours();
  if (hour < 11) return "오전";
  if (hour < 14) return "점심";
  if (hour < 18) return "오후";
  return "저녁";
}

function contentHeatmapGroup(title, rows) {
  const max = Math.max(1, ...rows.map((row) => row.score));
  return `<article class="content-heat-card"><h4>${esc(title)}</h4><div>
    ${rows.map((row) => `<span style="opacity:${Math.max(0.28, row.score / max)}"><b>${esc(row.label)}</b><em>${apiNum(row.count)}개</em></span>`).join("")}
  </div></article>`;
}

function contentBrandCards(posts) {
  const groups = new Map();
  for (const post of posts) {
    const brand = post.brand || post.tag || brandFromProduct(post.title || "") || "기타";
    const group = groups.get(brand) || [];
    group.push(post);
    groups.set(brand, group);
  }
  const rows = [...groups.entries()].map(([brand, group]) => ({
    brand,
    count: group.length,
    reach: avg(group.map((post) => Number(post.reach || 0))),
    saveRate: avg(group.map((post) => postMetrics(post).saveRate)),
    shares: avg(group.map((post) => Number(post.shares || 0)))
  })).sort((left, right) => right.reach - left.reach).slice(0, 8);
  return rows.length ? rows.map((row) => `<article class="content-brand-card">
    <strong>${esc(row.brand)}</strong>
    <span>${apiNum(row.count)} posts</span>
    <p>평균 Reach ${apiNum(Math.round(row.reach))}</p>
    <p>평균 저장률 ${pct(row.saveRate)} · 평균 공유 ${apiNum(Math.round(row.shares))}</p>
  </article>`).join("") : contentEmpty("브랜드별 성과 데이터가 없습니다.");
}

function contentRecommendationCards(posts) {
  const best = topPosts(posts, purposeScore, 1)[0];
  const saved = topPosts(posts, (post) => postMetrics(post).saveRate, 1)[0];
  const brand = saved ? (saved.brand || saved.tag || brandFromProduct(saved.title || "")) : "";
  return [
    contentAiCard("가장 성과가 좋았던 콘텐츠", best ? best.title || "Untitled" : "데이터 없음", best ? explainPost(best) : "콘텐츠 데이터가 쌓이면 표시됩니다."),
    contentAiCard("저장률이 높은 이유", saved ? saved.title || "Untitled" : "데이터 없음", saved ? "저장률이 높은 콘텐츠는 다시 볼 이유가 명확한 정보형 구성이 많습니다." : "저장률 판단 데이터가 없습니다."),
    contentAiCard("다음 콘텐츠 추천", saved ? `${saved.type || "콘텐츠"} 포맷 반복` : "릴스/카드뉴스 테스트", saved ? "성과가 나온 포맷을 같은 브랜드 또는 유사 상품으로 반복하세요." : "이번 주에는 릴스와 카드뉴스를 각각 1개씩 테스트하세요."),
    renderContentBrandSalesTop3()
  ].join("");
}

function renderContentBrandSalesTop3() {
  const rows = [...productBrandSalesRows]
    .sort((left, right) => Number(right.salesAmount || 0) - Number(left.salesAmount || 0))
    .slice(0, 3);
  const html = `<article id="contentBrandSalesCard" class="content-ai-card"><span>브랜드 실매출</span>${rows.length ? `<ol>${rows.map((row, index) => {
    const brandName = row.brand_name && row.brand_name !== row.brand_code ? row.brand_name : "미분류";
    return `<li><mark>${index + 1}</mark><strong>${esc(brandName)}</strong><em>${apiWon(row.salesAmount)}</em></li>`;
  }).join("")}</ol>` : `<strong>데이터 없음</strong>`}<p>선택 월 · 매출 기준</p></article>`;
  const target = $("#contentBrandSalesCard");
  if (target) target.outerHTML = html;
  return html;
}

function contentAiCard(title, value, note) {
  return `<article class="content-ai-card"><span>${esc(title)}</span><strong title="${esc(value)}">${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function contentEmpty(message) {
  return `<div class="content-empty">${esc(message)}</div>`;
}

function renderEditorialAi(data) {
  const posts = data.posts || [];
  const account = data.account || {};
  const brandRows = editorialBrandRows(posts);
  const topSaved = topPosts(posts, (post) => postMetrics(post).saveRate, 1)[0];
  const topShared = topPosts(posts, (post) => post.shares, 1)[0];
  const topViewed = topPosts(posts, (post) => post.views || post.reach, 1)[0];
  const avgScore = avg(posts.map(purposeScore));
  const highPosts = posts.filter((post) => purposeScore(post) > avgScore);
  const best = topPosts(posts, purposeScore, 1)[0];
  const bestType = editorialBestType(posts);
  const bestBrand = brandRows[0];
  const bestDay = editorialBestTime(posts, "day");
  const bestHour = editorialBestTime(posts, "hour");
  const avgSaveRate = avg(posts.map((post) => postMetrics(post).saveRate));
  const titleLength = Math.round(avg(posts.map((post) => String(post.title || "").length)));
  const recommendedBrands = editorialOpportunityBrands(brandRows);
  const discoverRows = editorialDiscoverRows({ posts, brandRows, bestType, bestDay, bestHour });
  hideEditorialUnreadySections();

  $("#editorialInsightGrid").innerHTML = [
    editorialInsightCard("저장률 최고", topSaved?.title || "데이터 없음", topSaved ? `저장률 ${pct(postMetrics(topSaved).saveRate)} · 저장 ${apiNum(topSaved.saves)}` : "콘텐츠 데이터가 필요합니다."),
    editorialInsightCard("공유 최고", topShared?.title || "데이터 없음", topShared ? `공유 ${apiNum(topShared.shares)} · 공유율 ${pct(postMetrics(topShared).shareRate)}` : "공유 데이터가 필요합니다."),
    editorialInsightCard("조회수 TOP", topViewed?.title || "데이터 없음", topViewed ? `조회 ${apiNum(topViewed.views)} · Reach ${apiNum(topViewed.reach)}` : "조회 데이터가 필요합니다."),
    editorialInsightCard("평균 이상 게시물", posts.length ? `${apiNum(highPosts.length)}개` : "데이터 없음", posts.length ? `전체 ${apiNum(posts.length)}개 중 성과 평균 이상` : "게시물 데이터가 필요합니다.")
  ].join("");

  $("#editorialWhyGrid").innerHTML = [
    editorialWhyCard("카드뉴스 비중", editorialTypeShare(posts, "카드뉴스"), "저장형 콘텐츠 비중"),
    editorialWhyCard("릴스 비중", editorialTypeShare(posts, "릴스"), "조회와 신규 도달 비중"),
    editorialWhyCard("브랜드", bestBrand?.brand || "데이터 없음", bestBrand ? `평균 Reach ${apiNum(Math.round(bestBrand.reach))}` : "브랜드 태그가 필요합니다."),
    editorialWhyCard("제목 길이", titleLength ? `${apiNum(titleLength)}자` : "데이터 없음", "콘텐츠 제목 평균"),
    editorialWhyCard("평균 저장률", posts.length ? pct(avgSaveRate) : "데이터 없음", "이번 달 콘텐츠 평균")
  ].join("");

  $("#editorialRecommendGrid").innerHTML = editorialPendingNotice();

  $("#editorialBrandGrid").innerHTML = `${editorialMeasuredNote()}${brandRows.length ? brandRows.slice(0, 8).map((row) => `<article class="editorial-brand-card">
    <strong>${esc(row.brand)}</strong>
    <span>${apiNum(row.count)} posts</span>
    <p>평균 Reach ${apiNum(Math.round(row.reach))}</p>
    <p>Saves ${apiNum(Math.round(row.saves))} · Shares ${apiNum(Math.round(row.shares))}</p>
    <p>저장률 ${pct(row.saveRate)}</p>
  </article>`).join("") : editorialEmpty("브랜드별 분석 데이터가 없습니다.")}`;

  $("#editorialOpportunityGrid").innerHTML = "";

  $("#editorialDiscoverRadar").innerHTML = "";

  $("#editorialContentStrategy").innerHTML = editorialPendingNotice();

  $("#editorialSummary").innerHTML = editorialPendingNotice();
}

function editorialPendingNotice() {
  return `<div class="content-empty">브랜드 마스터 등록 후 제공</div>`;
}

function editorialMeasuredNote() {
  return `<p class="hint-text">포스트 제목 기반 자동 분류</p>`;
}

function hideEditorialUnreadySections() {
  ["#editorialRecommendGrid", "#editorialOpportunityGrid", "#editorialDiscoverRadar", "#editorialContentStrategy", "#editorialSummary"].forEach((selector) => {
    const block = $(selector)?.closest(".section-block");
    if (block) block.hidden = true;
  });
}

function editorialBrandRows(posts) {
  const groups = new Map();
  for (const post of posts || []) {
    const brand = post.brand || post.tag || brandFromProduct(post.title || "") || "기타";
    const group = groups.get(brand) || [];
    group.push(post);
    groups.set(brand, group);
  }
  return [...groups.entries()].map(([brand, group]) => ({
    brand,
    count: group.length,
    reach: avg(group.map((post) => Number(post.reach || 0))),
    saves: avg(group.map((post) => Number(post.saves || 0))),
    shares: avg(group.map((post) => Number(post.shares || 0))),
    saveRate: avg(group.map((post) => postMetrics(post).saveRate)),
    score: avg(group.map(purposeScore))
  })).sort((left, right) => right.score - left.score);
}

function editorialBestType(posts) {
  const rows = summarizeByType(posts || []);
  const best = [...rows].sort((left, right) => Number(right.avgSaveRate || 0) - Number(left.avgSaveRate || 0))[0];
  return best ? { type: best.type, note: `저장률 ${pct(best.avgSaveRate)} · ${apiNum(best.count)}개 게시` } : { type: "", note: "" };
}

function editorialTypeShare(posts, type) {
  const total = Math.max(1, (posts || []).length);
  const count = (posts || []).filter((post) => post.type === type).length;
  return `${Math.round(count / total * 100)}%`;
}

function editorialBestTime(posts, mode) {
  const rows = contentTimeGroups(posts || [], mode).sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  return rows[0] || { label: "데이터 없음", score: 0 };
}

function editorialOpportunityBrands(brandRows) {
  const candidates = ["GOOMHEO", "AE SYNCTX", "RAVE", "MEANTIME"];
  const existing = new Set((brandRows || []).map((row) => String(row.brand || "").toUpperCase()));
  const underused = candidates.filter((brand) => !existing.has(brand));
  return [...underused, ...(brandRows || []).slice(0, 2).map((row) => row.brand)].slice(0, 4);
}

function editorialDiscoverRows({ posts = [], brandRows = [], bestType = {}, bestDay = {}, bestHour = {} }) {
  const candidates = ["GOOMHEO", "AE SYNCTX", "RAVE", "MEANTIME"];
  const existingMap = new Map((brandRows || []).map((row) => [String(row.brand || "").toUpperCase(), row]));
  const bestPost = topPosts(posts, purposeScore, 1)[0];
  const reachBase = Math.max(1200, Math.round(avg(posts.map((post) => Number(post.reach || post.views || 0))) || 0));
  const saveBase = Math.max(0.8, avg(posts.map((post) => postMetrics(post).saveRate)) || 0);
  return candidates.map((brand, index) => {
    const existing = existingMap.get(brand);
    const score = existing ? Math.min(5, 3 + Math.round(existing.score / 30)) : Math.max(3, 5 - index % 3);
    const estimatedReach = existing ? Math.round(existing.reach * 1.12) : Math.round(reachBase * (1.18 - index * 0.05));
    const estimatedSaveRate = existing ? existing.saveRate * 1.08 : saveBase + (0.6 - index * 0.08);
    return {
      brand,
      score,
      reason: existing ? "이미 반응이 검증된 브랜드라 확장 가치가 있습니다." : "아직 노출이 적어 신규 테스트 여지가 큽니다.",
      format: bestType.type || (index % 2 ? "릴스" : "카드뉴스"),
      estimatedReach,
      estimatedSaveRate,
      similar: bestPost?.title || brandRows[0]?.brand || "상위 성과 콘텐츠",
      day: bestDay.label || "금",
      hour: bestHour.label || "저녁"
    };
  }).sort((left, right) => right.score - left.score);
}

function editorialDiscoverCard(row) {
  return `<article class="editorial-discover-card">
    <div class="editorial-discover-head">
      <div><span>Brand</span><strong>${esc(row.brand)}</strong></div>
      <em>${"★".repeat(row.score)}${"☆".repeat(Math.max(0, 5 - row.score))}</em>
    </div>
    <p>${esc(row.reason)}</p>
    <dl>
      <div><dt>추천 형식</dt><dd>${esc(row.format)}</dd></div>
      <div><dt>예상 Reach</dt><dd>${apiNum(row.estimatedReach)}</dd></div>
      <div><dt>예상 저장률</dt><dd>${pct(row.estimatedSaveRate)}</dd></div>
      <div><dt>성공 사례</dt><dd title="${esc(row.similar)}">${esc(row.similar)}</dd></div>
      <div><dt>요일</dt><dd>${esc(row.day)}</dd></div>
      <div><dt>시간</dt><dd>${esc(row.hour)}</dd></div>
    </dl>
  </article>`;
}

function editorialStrategyLines({ posts, bestType, bestBrand, bestDay, bestHour, best, discoverRows, avgSaveRate }) {
  if (!posts.length) {
    return [
      "이번 달 콘텐츠 데이터가 아직 부족해 명확한 승리 패턴을 판단하기 어렵습니다.",
      "다음 달에는 릴스와 카드뉴스를 각각 최소 2개 이상 업로드해 비교 기준을 만들어야 합니다.",
      "브랜드 히스토리, 소재 디테일, 스타일링 제안처럼 저장할 이유가 있는 콘텐츠를 우선 추천합니다.",
      "GOOMHEO, AE SYNCTX, RAVE, MEANTIME은 Discover Radar 테스트 후보로 유지합니다.",
      "게시 후 Reach보다 Saves와 Shares를 함께 보면서 다음 콘텐츠 방향을 조정하세요."
    ];
  }
  const radar = discoverRows[0];
  return [
    `이번 달에는 ${bestType.type || "상위 포맷"} 콘텐츠가 저장률 ${bestType.note ? bestType.note.replace(/^저장률 /, "").split(" · ")[0] : pct(avgSaveRate)} 기준으로 가장 좋은 신호를 보였습니다.`,
    `${bestBrand?.brand || "상위 브랜드"} 관련 콘텐츠가 평균 Reach와 저장 반응에서 가장 강했습니다.`,
    best ? `"${best.title || "대표 콘텐츠"}"는 다음 달 콘텐츠 구조를 잡을 때 참고할 성공 사례입니다.` : "대표 콘텐츠는 추가 데이터가 쌓이면 더 명확하게 선정할 수 있습니다.",
    `${bestDay.label}요일과 ${bestHour.label} 업로드가 현재 데이터에서 가장 좋은 반응을 보였습니다.`,
    `다음 달에는 ${radar?.brand || "RAVE"}와 ${discoverRows[1]?.brand || "AE SYNCTX"}를 중심으로 브랜드 히스토리와 제품 디테일 콘텐츠를 추천합니다.`,
    `추천 형식은 ${radar?.format || bestType.type || "카드뉴스"}이며, 저장 가능한 정보형 구성을 우선 적용하는 것이 좋습니다.`,
    "릴스는 신규 도달, 카드뉴스는 저장과 공유를 담당하도록 역할을 분리해서 운영하세요."
  ];
}

function editorialSummaryLines({ posts, bestType, bestBrand, bestDay, bestHour, best, recommendedBrands, account }) {
  if (!posts.length) {
    return [
      "이번 달 콘텐츠 데이터가 아직 충분하지 않습니다.",
      "먼저 릴스와 카드뉴스를 균형 있게 업로드해 비교 기준을 만드는 것이 좋습니다.",
      "브랜드 태그와 게시 시간 데이터가 쌓이면 추천 정확도가 올라갑니다.",
      "다음 달에는 브랜드 히스토리와 제품 디테일 콘텐츠를 우선 테스트하세요.",
      "Cafe24 매출 분석과 함께 보면 콘텐츠의 판매 기여도를 더 명확히 볼 수 있습니다."
    ];
  }
  return [
    `이번 달에는 ${bestType.type || "성과 좋은 포맷"} 콘텐츠가 저장률 측면에서 가장 좋은 신호를 보였습니다.`,
    `${bestBrand?.brand || "상위 브랜드"} 관련 게시물이 가장 높은 평균 성과를 기록했습니다.`,
    `${bestHour.label} 업로드와 ${bestDay.label}요일 콘텐츠가 상대적으로 좋은 반응을 얻었습니다.`,
    best ? `"${best.title || "대표 콘텐츠"}"는 다음 콘텐츠 기획의 기준으로 삼을 만합니다.` : "대표 콘텐츠를 추가로 확인할 필요가 있습니다.",
    `다음 달에는 ${recommendedBrands[0] || "GOOMHEO"} 중심의 브랜드 히스토리/디테일 콘텐츠를 추천합니다. 팔로워 변화는 ${apiNum(account.followerDelta)}명입니다.`
  ];
}

function editorialInsightCard(title, value, note) {
  return `<article class="editorial-card"><span>${esc(title)}</span><strong title="${esc(value)}">${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function editorialWhyCard(title, value, note) {
  return `<article class="editorial-why-card"><span>${esc(title)}</span><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function editorialRecommendCard(title, value, note) {
  return `<article class="editorial-recommend-card"><span>${esc(title)}</span><strong title="${esc(value)}">${esc(value)}</strong><p>${esc(note)}</p></article>`;
}

function editorialEmpty(message) {
  return `<div class="content-empty">${esc(message)}</div>`;
}

function metricCard(post) {
  const metrics = postMetrics(post);
  return `<article class="report-panel">
    <h4>${esc(post.title || "Untitled")}</h4>
    <p>${esc(post.date || "-")} · ${esc(post.tag || post.type || "-")}</p>
    <div class="report-metrics">
      <span>Reach <strong>${apiNum(post.reach)}</strong></span>
      <span>Views <strong>${apiNum(post.views)}</strong></span>
      <span>Likes <strong>${apiNum(post.likes)}</strong></span>
      <span>Comments <strong>${apiNum(post.comments)}</strong></span>
      <span>Saves <strong>${apiNum(post.saves)}</strong></span>
      <span>Shares <strong>${apiNum(post.shares)}</strong></span>
      <span>Engagement Rate <strong>${pct(metrics.engagementRate)}</strong></span>
    </div>
    ${post.unavailableReason ? `<p class="delta">API 오류: ${esc(post.unavailableReason)}</p>` : ""}
  </article>`;
}

function feedStat(label, value) {
  return `<div class="feed-stat"><span>${label}</span><strong>${value}</strong></div>`;
}

// 2026-07-08 Reports 썸네일 실제 이미지 교체: 서버 normalizePost()가 media_type별
// 규칙(IMAGE→media_url, CAROUSEL_ALBUM→children 첫 장, VIDEO/REELS→thumbnail_url
// 우선)으로 계산한 coverImageUrl을 최우선으로 쓰고, coverImageUrl이 아직 없는(=이
// 필드가 추가되기 전에 저장된 과거 캐시) 게시물은 기존 thumbnailUrl/mediaUrl로
// 폴백한다. 이미지가 전혀 없으면 기존 Gradient Placeholder(.feed-media의 CSS
// background)가 그대로 보인다.
function feedCoverImageUrl(post) {
  return post.coverImageUrl || post.thumbnailUrl || post.mediaUrl || "";
}

function feedCard(post, options = {}) {
  const m = postMetrics(post);
  const imageUrl = feedCoverImageUrl(post);
  const permalink = post.permalink || "";
  const stats = [
    ["Reach", apiNum(post.reach)],
    ["Views", apiNum(post.views)],
    ["Likes", apiNum(post.likes)],
    ["Comments", apiNum(post.comments)],
    ["Saves", apiNum(post.saves)],
    ["Shares", apiNum(post.shares)]
  ];
  // 이미지 <img>는 CSS background가 아니라 실제 <img> 엘리먼트로 렌더링하고
  // object-fit: cover로 채운다. loading="lazy"로 지연 로딩하고, 로드 실패 시
  // onerror가 자신을 제거해 .feed-media의 has-image 클래스만 해제하면 기존
  // Gradient Placeholder(CSS background)가 자동으로 다시 보인다.
  const imgHtml = imageUrl
    ? `<img class="feed-media-img" src="${esc(imageUrl)}" alt="${esc(post.title || "Instagram 게시물")}" loading="lazy" onerror="this.closest('.feed-media')?.classList.remove('has-image');this.remove();">`
    : "";
  return `<article class="feed-card">
    <a class="feed-media${imageUrl ? " has-image" : ""}" href="${esc(permalink || "#")}" target="_blank" rel="noreferrer">
      ${imgHtml}
      <span class="feed-type">${esc(post.type || "POST")}</span>
      <strong>${esc(post.title || "Untitled")}</strong>
      ${permalink ? `<span class="feed-media-hover">▶ Instagram 보기</span>` : ""}
    </a>
    <div class="feed-body">
      <div class="chip-row">
        <span class="chip">${esc(post.tag || "Untitled")}</span>
        <span class="chip">${esc(post.date || "-")}</span>
      </div>
      <p class="feed-caption">${esc(post.caption || "캡션 없음")}</p>
      ${post.unavailableReason ? `<p class="delta">API 오류: ${esc(post.unavailableReason)}</p>` : ""}
      <div class="feed-stats">${stats.map(([label, value]) => feedStat(label, value)).join("")}</div>
      <div class="chip-row">
        <span class="chip">Engagement Rate ${pct(m.engagementRate)}</span>
        <span class="chip">저장률 ${pct(m.saveRate)}</span>
      </div>
    </div>
  </article>`;
}

function renderCards(id, posts, mode = "metric") {
  const target = $(`#${id}`);
  if (!target) return;
  if (mode === "feed" || mode === "cardnews") {
    target.classList.add("instagram-feed");
    target.classList.remove("cards");
    target.innerHTML = posts.length ? posts.map((post) => feedCard(post)).join("") : `<article class="feed-card"><div class="feed-body"><h4>데이터 없음</h4><p class="feed-caption">해당 월에 표시할 콘텐츠가 없습니다.</p></div></article>`;
    return;
  }
  target.classList.add("cards");
  target.classList.remove("instagram-feed");
  target.innerHTML = posts.length ? posts.map(metricCard).join("") : `<div class="action-item">해당 콘텐츠 데이터가 없습니다.</div>`;
}

function renderMonthlyDashboard(data) {
  const a = data.account || {};
  const posts = data.posts || [];
  const topByScore = topPosts(posts, purposeScore, 5);
  const topSaved = topPosts(posts, (post) => post.saves, 4);
  const topShared = topPosts(posts, (post) => post.shares, 4);
  const topReach = topPosts(posts, (post) => post.reach, 4);
  const typeSummary = summarizeByType(posts);
  const totalSaves = sum(posts, "saves");
  const totalShares = sum(posts, "shares");
  const totalLikes = sum(posts, "likes");
  const totalComments = sum(posts, "comments");
  const totalClicks = sum(posts, "websiteClicks") || Number(a.websiteClicks || 0);
  const totalSales = sum(posts, "cafe24Sales7d");
  const totalSpend = sum(posts, "adSpend");
  const topContent = topByScore[0];
  $("#monthlyDashboard").innerHTML = `
    <div class="executive-summary">
      <section class="executive-hero">
        <p class="eyebrow">${esc(sourceText(data))}</p>
        <h4>${esc(data.month)} SAMPLAS MONTHLY REPORT</h4>
        <strong>${topContent ? esc(topContent.title) : "게시물 데이터 없음"}</strong>
        <span>${topContent ? `이번 달 대표 콘텐츠 · ${esc(topContent.tag || topContent.type)} · 점수 ${Math.round(purposeScore(topContent))}` : "월간 KPI 중심으로 표시합니다."}</span>
      </section>
      <section class="executive-kpis">
        <p class="report-tier-label">Business</p>
        <div class="executive-kpis-grid">
          ${miniMetric("도달", num(a.reach), `${pct(a.reachDelta)} 전월 대비`)}
          ${miniMetric("웹사이트 클릭", num(totalClicks), "구매 유입 후보")}
          ${miniMetric(totalSales ? "Cafe24 7일 매출" : "Meta 광고비", totalSales ? krw(totalSales) : krw(totalSpend), totalSales ? "실제 주문 기준" : "광고 캐시 기준")}
          ${miniMetric("팔로워 증가", `+${num(a.followerDelta)}`, `현재 ${num(a.followers)}명`)}
        </div>
      </section>
    </div>

    <p class="report-tier-label report-support-label">Content · Supporting KPI</p>
    <div class="report-support-row">
      ${supportMetric("콘텐츠 수", num(posts.length), "이번 달 분석 대상")}
      ${supportMetric("좋아요", num(totalLikes), "반응 신호")}
      ${supportMetric("댓글", num(totalComments), "대화 신호")}
      ${supportMetric("저장 / 공유", `${num(totalSaves)} / ${num(totalShares)}`, "카드뉴스 핵심")}
    </div>

    <p class="report-tier-label">Analysis</p>
    <div class="report-lanes executive-lanes">
      ${reportLane("종합 TOP", topByScore, (post) => `${post.tag || post.type} · 점수 ${Math.round(purposeScore(post))}`)}
      ${reportLane("저장 TOP", topSaved, (post) => `저장 ${num(post.saves)} · 저장률 ${pct(postMetrics(post).saveRate)}`)}
      ${reportLane("공유 TOP", topShared, (post) => `공유 ${num(post.shares)} · 공유율 ${pct(postMetrics(post).shareRate)}`)}
      ${reportLane("도달 TOP", topReach, (post) => `도달 ${num(post.reach)} · 조회 ${num(post.views)}`)}
    </div>

    <section class="report-panel format-panel">
      <div class="feed-toolbar">
        <div>
          <p class="eyebrow">Format Mix</p>
          <h4>콘텐츠 유형별 성과 비교</h4>
        </div>
        <span class="badge">저장률 / 도달 / 콘텐츠 수</span>
      </div>
      <div class="format-bars">
        ${typeSummary.length ? typeSummary.map((item) => formatBar(item, posts)).join("") : `<div class="compact-row"><strong>데이터 없음</strong><span>콘텐츠 유형별 데이터가 없습니다.</span></div>`}
      </div>
    </section>

    <section class="feed-section">
      <div class="feed-toolbar">
        <div>
          <p class="eyebrow">Content Board</p>
          <h4>${esc(data.month)} 콘텐츠 보드</h4>
        </div>
        <span class="badge">${posts.length ? `${num(posts.length)} posts` : "No posts"}</span>
      </div>
      <div class="instagram-feed">
        ${posts.length ? posts.map((post) => feedCard(post)).join("") : `<article class="feed-card"><div class="feed-body"><h4>표시할 콘텐츠가 없습니다</h4><p class="feed-caption">해당 월의 게시물 데이터가 아직 없습니다.</p></div></article>`}
      </div>
    </section>`;
}

function monthlyReportRatio(value, base) {
  const numerator = Number(value || 0);
  const denominator = Number(base || 0);
  if (!denominator || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  return Math.max(0, Math.min(100, numerator / denominator * 100));
}

function monthlyReportRankRows(items, options = {}) {
  const rows = items || [];
  if (!rows.length) return `<div class="monthly-report-rank-row monthly-report-muted"><strong>데이터 없음</strong><span>저장된 항목이 없습니다.</span></div>`;
  const valueFn = options.valueFn || (() => 0);
  const labelFn = options.labelFn || (() => "-");
  const subFn = options.subFn || (() => "");
  const base = Math.max(...rows.map((item) => Number(valueFn(item) || 0)), 1);
  return rows.map((item, index) => {
    const value = valueFn(item);
    return `<div class="monthly-report-rank-row">
      <span class="monthly-report-rank-no">${String(index + 1).padStart(2, "0")}</span>
      <div class="monthly-report-rank-main">
        <strong>${esc(labelFn(item))}</strong>
        <span>${esc(subFn(item))}</span>
        ${options.withBar ? `<div class="monthly-report-rank-bar"><i style="width:${monthlyReportRatio(value, base)}%"></i></div>` : ""}
      </div>
      <em>${esc(options.formatValue ? options.formatValue(value, item) : apiNum(value))}</em>
    </div>`;
  }).join("");
}

function previousMonthKey(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match) return "";
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const previous = new Date(year, monthIndex - 1, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
}

function monthlyReportMonthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match) return { monthStart: "", monthEnd: "" };
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    monthStart: `${month}-01`,
    monthEnd: `${month}-${String(lastDay).padStart(2, "0")}`
  };
}

function monthlyReportDateTimeLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function monthlyReportDelta(current, previous, formatter = apiNum, options = {}) {
  if (!hasApiValue(current) || !hasApiValue(previous)) return "전월 대비 비교 불가";
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return "전월 대비 비교 불가";
  const diff = currentValue - previousValue;
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  const diffText = `${sign}${formatter(Math.abs(diff))}`;
  if (options.noPercent || !previousValue) return `전월 대비 ${diffText}`;
  return `전월 대비 ${diffText} · ${sign}${Math.abs(diff / previousValue * 100).toFixed(1)}%`;
}

function monthlyReportBrandCode(row = {}) {
  return String(row.brand_code || row.brandCode || "").trim();
}

function monthlyReportBrandName(row = {}) {
  return row.brand_name || row.brandName || row.name || monthlyReportBrandCode(row) || "-";
}

function monthlyReportBrandSignals(currentRows = [], previousRows = []) {
  const previousByCode = new Map();
  previousRows.filter((row) => monthlyReportBrandCode(row) !== "B0000000").forEach((row) => {
    const code = monthlyReportBrandCode(row);
    if (code) previousByCode.set(code, row);
  });
  return currentRows.filter((row) => monthlyReportBrandCode(row) !== "B0000000").map((row) => {
    const code = monthlyReportBrandCode(row);
    if (!code || !previousByCode.has(code)) return null;
    const currentSales = Number(row.salesAmount);
    const previousSales = Number(previousByCode.get(code)?.salesAmount);
    if (!Number.isFinite(currentSales) || !Number.isFinite(previousSales) || previousSales <= 0) return null;
    const diffRate = (currentSales - previousSales) / previousSales * 100;
    if (!Number.isFinite(diffRate)) return null;
    return {
      ...row,
      currentSales,
      previousSales,
      diffRate
    };
  }).filter(Boolean);
}

function monthlyReportBrandSignalsBlock(currentRows, previousRows, reconciliationLabel) {
  const signals = monthlyReportBrandSignals(currentRows, previousRows);
  if (!signals.length) return "";
  const rising = signals
    .filter((item) => item.diffRate > 0)
    .sort((left, right) => right.diffRate - left.diffRate)
    .slice(0, 3);
  const falling = signals
    .filter((item) => item.diffRate < 0)
    .sort((left, right) => left.diffRate - right.diffRate)
    .slice(0, 3);
  return `<section class="monthly-report-block">
    <div class="monthly-report-block-head"><h4>브랜드 신호</h4><span>데이터 일치검증 ${esc(reconciliationLabel)}</span></div>
    <div class="monthly-report-grid2">
      <div>
        <div class="monthly-report-block-head"><h4>상승 브랜드 TOP3</h4><span>이번 달 판매금액</span></div>
        <div class="monthly-report-rank">
          ${monthlyReportRankRows(rising, {
            withBar: true,
            valueFn: (item) => item.currentSales,
            labelFn: monthlyReportBrandName,
            subFn: (item) => monthlyReportDelta(item.currentSales, item.previousSales, apiWon),
            formatValue: (value) => apiWon(value)
          })}
        </div>
      </div>
      <div>
        <div class="monthly-report-block-head"><h4>하락 브랜드 TOP3</h4><span>이번 달 판매금액</span></div>
        <div class="monthly-report-rank">
          ${monthlyReportRankRows(falling, {
            withBar: true,
            valueFn: (item) => item.currentSales,
            labelFn: monthlyReportBrandName,
            subFn: (item) => monthlyReportDelta(item.currentSales, item.previousSales, apiWon),
            formatValue: (value) => apiWon(value)
          })}
        </div>
      </div>
    </div>
    <p class="monthly-report-fnote">브랜드 신호는 현재 월과 전월 archive의 brand_code가 일치하는 항목만 비교합니다.</p>
  </section>`;
}

function monthlyReportDirectionText(subject, current, previous, options = {}) {
  if (!hasApiValue(current) || !hasApiValue(previous)) return `${subject} 비교 불가입니다`;
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return `${subject} 비교 불가입니다`;
  const diff = currentValue - previousValue;
  if (diff === 0) return `${subject} 전월과 동일합니다`;
  const direction = diff > 0 ? "증가" : "감소";
  if (options.noPercent || !previousValue) {
    const formatter = options.formatter || apiNum;
    return `${subject} 전월 대비 ${formatter(Math.abs(diff))} ${direction}했습니다`;
  }
  return `${subject} 전월 대비 ${Math.abs(diff / previousValue * 100).toFixed(1)}% ${direction}했습니다`;
}

function monthlyReportFollowerDirectionText(current, previous) {
  if (!hasApiValue(current) || !hasApiValue(previous)) return "팔로워 증감은 비교 불가입니다";
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return "팔로워 증감은 비교 불가입니다";
  const diff = currentValue - previousValue;
  if (diff === 0) return "팔로워 증가폭은 전월과 동일합니다";
  return diff > 0
    ? `팔로워 증가폭은 전월보다 ${apiNum(Math.abs(diff))}명 확대됐습니다`
    : `팔로워 증가폭은 전월보다 ${apiNum(Math.abs(diff))}명 축소됐습니다`;
}

function annualArchiveMonths(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match) return [];
  const year = Number(match[1]);
  const todayMonth = campaignComparisonTodayKey().slice(0, 7);
  const currentYear = Number(todayMonth.slice(0, 4));
  const currentMonth = Number(todayMonth.slice(5, 7));
  const lastMonth = year === currentYear ? currentMonth : year < currentYear ? 12 : 0;
  return Array.from({ length: lastMonth }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function annualArchiveSalesInfo(archive = {}) {
  const totalRaw = archive.sales?.totalSales?.amount;
  const onlineRaw = hasApiValue(archive.sales?.onlineSales?.paidAmount)
    ? archive.sales.onlineSales.paidAmount
    : archive.commerce?.paidAmount;
  const offlineRaw = archive.sales?.offlineSales?.offlineSalesAmount;
  if (hasApiValue(totalRaw)) {
    const value = Number(totalRaw);
    return {
      hasValue: Number.isFinite(value),
      value,
      valueType: "total",
      label: "총매출",
      onlineSales: hasApiValue(onlineRaw) ? Number(onlineRaw) : null,
      offlineSales: hasApiValue(offlineRaw) ? Number(offlineRaw) : null,
      offlineAvailable: hasApiValue(offlineRaw)
    };
  }
  if (hasApiValue(onlineRaw)) {
    const value = Number(onlineRaw);
    return {
      hasValue: Number.isFinite(value),
      value,
      valueType: "online-fallback",
      label: "온라인 매출",
      onlineSales: value,
      offlineSales: null,
      offlineAvailable: false
    };
  }
  return {
    hasValue: false,
    value: NaN,
    valueType: "unavailable",
    label: "매출",
    onlineSales: null,
    offlineSales: null,
    offlineAvailable: false
  };
}

function annualArchiveValue(archive, key) {
  if (key === "totalSales") return annualArchiveSalesInfo(archive).value;
  if (key === "onlineSales") return Number(hasApiValue(archive.sales?.onlineSales?.paidAmount) ? archive.sales.onlineSales.paidAmount : archive.commerce?.paidAmount);
  if (key === "offlineSales") return Number(archive.sales?.offlineSales?.offlineSalesAmount);
  if (key === "paidAmount") return Number(archive.commerce?.paidAmount);
  if (key === "spend") return Number(archive.marketing?.spend);
  if (key === "purchaseValue") return Number(archive.marketing?.purchaseValue);
  if (key === "totalViews") return Number(archive.content?.totalViews);
  if (key === "totalSaves") return Number(archive.content?.totalSaves);
  if (key === "followerDelta") {
    const value = archive.content?.followerDelta;
    return hasApiValue(value) ? Number(value) : NaN;
  }
  return NaN;
}

function annualArchiveFormat(value, type) {
  if (!Number.isFinite(value)) return "-";
  if (type === "money") return apiWon(value);
  if (type === "follower") return `${value > 0 ? "+" : ""}${apiNum(value)}명`;
  return apiNum(value);
}

function annualArchiveRawValue(archive, key) {
  if (key === "totalSales") {
    const salesInfo = annualArchiveSalesInfo(archive);
    return salesInfo.hasValue ? salesInfo.value : undefined;
  }
  if (key === "onlineSales") return hasApiValue(archive.sales?.onlineSales?.paidAmount) ? archive.sales.onlineSales.paidAmount : archive.commerce?.paidAmount;
  if (key === "offlineSales") return archive.sales?.offlineSales?.offlineSalesAmount;
  if (key === "paidAmount") return archive.commerce?.paidAmount;
  if (key === "spend") return archive.marketing?.spend;
  if (key === "purchaseValue") return archive.marketing?.purchaseValue;
  if (key === "totalViews") return archive.content?.totalViews;
  if (key === "totalSaves") return archive.content?.totalSaves;
  if (key === "followerDelta") return archive.content?.followerDelta;
  return undefined;
}

function annualArchiveHasValue(archive, key) {
  return hasApiValue(annualArchiveRawValue(archive, key));
}

function annualArchiveSum(rows, key) {
  return rows.reduce((total, row) => {
    if (row.failed || !annualArchiveHasValue(row.archive, key)) return total;
    const value = annualArchiveValue(row.archive, key);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

const annualArchiveMetrics = [
  { key: "totalSales", title: "총매출", kpiTitle: "누적 총매출", chartTitle: "월별 총매출 흐름", category: "commerce", type: "money", coverage: "offline" },
  { key: "onlineSales", title: "온라인 매출", kpiTitle: "누적 온라인 매출", category: "commerce", type: "money" },
  { key: "offlineSales", title: "오프라인 매출", kpiTitle: "누적 오프라인 매출", category: "commerce", type: "money", coverage: "offline" },
  { key: "paidAmount", title: "실제 매출", category: "commerce", type: "money" },
  { key: "spend", title: "광고비", category: "marketing", type: "money" },
  { key: "purchaseValue", title: "Meta 추정 구매값", category: "marketing", type: "money" },
  { key: "totalViews", title: "콘텐츠 조회", category: "content", type: "number" },
  { key: "totalSaves", title: "콘텐츠 저장", category: "content", type: "number" },
  { key: "followerDelta", title: "팔로워 증감", category: "content", type: "follower" }
];

function annualArchiveSalesCoverageText(rows) {
  const salesRows = rows.filter((row) => !row.failed && row.archive?.sales);
  if (!salesRows.length) return "통합 매출 데이터 없음";
  const covered = salesRows.filter((row) => row.archive.sales?.coverage?.offline === true).length;
  const needsReview = rows.length - covered;
  if (!needsReview) return `${covered}개월 확보`;
  return `${covered}개월 확보 · ${needsReview}개월 확인 필요`;
}

function annualArchiveYearLabel(year, rows) {
  const todayMonth = campaignComparisonTodayKey().slice(0, 7);
  const currentYear = todayMonth.slice(0, 4);
  if (String(year) === currentYear) return `YTD ${rows.length}월까지`;
  return rows.length >= 12 ? "12개월 완료" : `${rows.length}개월 기준`;
}

function annualArchiveKpi(metric, rows) {
  const total = annualArchiveSum(rows, metric.key);
  const note = metric.coverage === "offline" ? annualArchiveSalesCoverageText(rows) : "연간 누적";
  return `<article class="annual-flow-kpi" data-annual-category="${esc(metric.category)}">
    <span>${esc(metric.kpiTitle || metric.title)}</span>
    <strong>${esc(annualArchiveFormat(total, metric.type))}</strong>
    <em>${esc(note)}</em>
  </article>`;
}

function annualArchiveMetricBlock(metric, rows) {
  const values = rows
    .map((row) => row.failed || !annualArchiveHasValue(row.archive, metric.key) ? NaN : annualArchiveValue(row.archive, metric.key))
    .filter((value) => Number.isFinite(value));
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const total = annualArchiveSum(rows, metric.key);
  return `<section class="annual-flow-card" data-annual-category="${esc(metric.category)}">
    <div class="annual-flow-card-head">
      <div><h4>${esc(metric.chartTitle || metric.title)}</h4><span>월별 archive 기준</span></div>
      <strong>${esc(annualArchiveFormat(total, metric.type))}</strong>
    </div>
    <div class="annual-flow-bars">
      ${rows.map((row, index) => {
        const missing = row.failed || !annualArchiveHasValue(row.archive, metric.key);
        const value = missing ? NaN : annualArchiveValue(row.archive, metric.key);
        const salesInfo = metric.key === "totalSales" ? annualArchiveSalesInfo(row.archive) : null;
        const width = Number.isFinite(value) ? Math.max(value === 0 ? 0 : 4, Math.min(100, Math.abs(value) / max * 100)) : 0;
        const label = `${Number(row.month.slice(5, 7))}월`;
        const formatted = missing ? "-" : annualArchiveFormat(value, metric.type);
    const statusText = row.failed
          ? "상태 확인 불가"
          : {
            saved: "Saved Archive",
            live: "Live Draft",
            draft: "Unsaved Draft"
          }[row.archiveStatus] || String(row.archive?.status || "Draft");
        const coverageText = metric.coverage === "offline" && !missing
          ? metric.key === "totalSales" && salesInfo?.valueType === "online-fallback"
            ? "오프라인 데이터 없음"
            : row.archive?.sales?.coverage?.offline === true
              ? "오프라인 확보"
              : "오프라인 확인 필요"
          : "";
        const previousRow = rows[index - 1];
        const previousMissing = !previousRow || previousRow.failed || !annualArchiveHasValue(previousRow.archive, metric.key);
        const previousValue = previousMissing ? null : annualArchiveValue(previousRow.archive, metric.key);
        const previousSalesInfo = metric.key === "totalSales" && previousRow ? annualArchiveSalesInfo(previousRow.archive) : null;
        const differentSalesBasis = metric.key === "totalSales"
          && !missing
          && !previousMissing
          && salesInfo?.valueType !== previousSalesInfo?.valueType;
        const deltaText = index === 0 || missing || previousMissing
          ? "전월 대비 비교 불가"
          : differentSalesBasis
            ? "전월 대비 기준 상이"
          : metric.key === "followerDelta"
            ? Number(value - previousValue) > 0
              ? `전월보다 증가폭 ${apiNum(Math.abs(value - previousValue))}명 확대`
              : Number(value - previousValue) < 0
                ? `전월보다 증가폭 ${apiNum(Math.abs(value - previousValue))}명 축소`
                : "전월과 증가폭 동일"
            : monthlyReportDelta(value, previousValue, metric.type === "money" ? apiWon : apiNum);
        const tooltip = metric.key === "totalSales"
          ? salesInfo?.valueType === "online-fallback"
            ? `${label} · 온라인 매출 ${missing ? "데이터 없음" : formatted} · 오프라인 매출 데이터 없음 · ${statusText}${coverageText ? ` · ${coverageText}` : ""} · ${deltaText}`
            : `${label} · ${missing ? "매출 데이터 없음" : `${salesInfo.label} ${formatted}`} · 온라인 매출 ${!missing && hasApiValue(salesInfo.onlineSales) ? apiWon(salesInfo.onlineSales) : "데이터 없음"} · 오프라인 매출 ${!missing && salesInfo.offlineAvailable ? apiWon(salesInfo.offlineSales) : "데이터 없음"} · ${statusText}${coverageText ? ` · ${coverageText}` : ""} · ${deltaText}`
          : `${label} · ${metric.title} ${missing ? "데이터 없음" : formatted} · ${statusText}${coverageText ? ` · ${coverageText}` : ""} · ${deltaText}`;
        return `<div class="annual-flow-bar" data-annual-month="${esc(row.month)}" data-empty="${missing ? "true" : "false"}" data-tooltip="${esc(tooltip)}">
          <i style="height:${width}%"></i>
          <span>${esc(label)}</span>
        </div>`;
      }).join("")}
    </div>
    <div class="annual-flow-axis" style="grid-template-columns:repeat(${rows.length}, minmax(0, 1fr))">
      ${rows.map((row) => `<span>${Number(row.month.slice(5, 7))}</span>`).join("")}
    </div>
  </section>`;
}

function annualArchiveAggregateBrandSales(rows) {
  const totals = new Map();
  rows.forEach((row) => {
    if (row.failed) return;
    (row.archive?.commerce?.brandSales || []).forEach((brand) => {
      const code = monthlyReportBrandCode(brand);
      if (!code || code === "B0000000") return;
      const salesAmount = Number(brand.salesAmount);
      if (!Number.isFinite(salesAmount)) return;
      const previous = totals.get(code) || {
        brand_code: code,
        brand_name: monthlyReportBrandName(brand),
        salesAmount: 0
      };
      previous.salesAmount += salesAmount;
      totals.set(code, previous);
    });
  });
  return [...totals.values()];
}

function annualArchiveSavedComparisonRows(rows) {
  const savedRows = rows.filter((row) => !row.failed && row.archiveStatus === "saved" && (row.archive?.commerce?.brandSales || []).length);
  if (savedRows.length < 6) return null;
  const firstRows = savedRows.slice(0, 3);
  const recentRows = savedRows.slice(-3);
  if (firstRows.length < 3 || recentRows.length < 3) return null;
  return { firstRows, recentRows };
}

function annualArchiveMonthRangeLabel(rows) {
  if (!rows?.length) return "";
  return `${rows[0].month}~${rows[rows.length - 1].month.slice(5)}`;
}

function annualArchiveComparisonDelta(current, previous) {
  return monthlyReportDelta(current, previous, apiWon).replace("전월 대비", "첫 3개월 대비");
}

function annualArchiveBrandPerformanceBlock(rows) {
  const annualBrands = annualArchiveAggregateBrandSales(rows)
    .sort((left, right) => Number(right.salesAmount || 0) - Number(left.salesAmount || 0));
  if (!annualBrands.length) return "";
  const comparisonRows = annualArchiveSavedComparisonRows(rows);
  const comparisonSignals = comparisonRows
    ? monthlyReportBrandSignals(
      annualArchiveAggregateBrandSales(comparisonRows.recentRows),
      annualArchiveAggregateBrandSales(comparisonRows.firstRows)
    )
    : [];
  const rising = comparisonSignals
    .filter((item) => item.diffRate > 0)
    .sort((left, right) => right.diffRate - left.diffRate)
    .slice(0, 3);
  const falling = comparisonSignals
    .filter((item) => item.diffRate < 0)
    .sort((left, right) => left.diffRate - right.diffRate)
    .slice(0, 3);
  const comparisonLabel = comparisonRows
    ? `${annualArchiveMonthRangeLabel(comparisonRows.firstRows)} vs ${annualArchiveMonthRangeLabel(comparisonRows.recentRows)}`
    : "";
  const comparisonBlock = comparisonRows && comparisonSignals.length ? `
    <section class="monthly-report-block">
      <div class="monthly-report-block-head"><h4>상승 브랜드 TOP3</h4><span>첫 3개월 대비 최근 3개월</span></div>
      <div class="monthly-report-rank">
        ${monthlyReportRankRows(rising, {
          withBar: true,
          valueFn: (item) => item.currentSales,
          labelFn: monthlyReportBrandName,
          subFn: (item) => annualArchiveComparisonDelta(item.currentSales, item.previousSales),
          formatValue: (value) => apiWon(value)
        })}
      </div>
    </section>
    <section class="monthly-report-block">
      <div class="monthly-report-block-head"><h4>하락 브랜드 TOP3</h4><span>첫 3개월 대비 최근 3개월</span></div>
      <div class="monthly-report-rank">
        ${monthlyReportRankRows(falling, {
          withBar: true,
          valueFn: (item) => item.currentSales,
          labelFn: monthlyReportBrandName,
          subFn: (item) => annualArchiveComparisonDelta(item.currentSales, item.previousSales),
          formatValue: (value) => apiWon(value)
        })}
      </div>
    </section>
    <p class="monthly-report-fnote">비교 기준: ${esc(comparisonLabel)} · Saved Archive만 사용하며 Live Draft는 제외합니다.</p>
  ` : "";
  return `<section class="monthly-report-block" data-annual-category="commerce">
    <div class="monthly-report-block-head"><h4>Brand Performance</h4><span>brand_code 기준</span></div>
    <div class="monthly-report-block-head"><h4>연간 누적 브랜드 매출 TOP5</h4><span>이번 연도 누적</span></div>
    <div class="monthly-report-rank">
      ${monthlyReportRankRows(annualBrands.slice(0, 5), {
        withBar: true,
        valueFn: (item) => item.salesAmount,
        labelFn: monthlyReportBrandName,
        subFn: (item) => monthlyReportBrandCode(item),
        formatValue: (value) => apiWon(value)
      })}
    </div>
    ${comparisonBlock ? `<div class="monthly-report-block-head"><h4>첫 3개월 대비 최근 3개월 브랜드 변화</h4><span>Saved Archive 기준</span></div>` : ""}
    ${comparisonBlock}
  </section>`;
}

async function renderAnnualArchiveFlow(month, renderSeq) {
  const target = $("#annualArchiveFlow");
  if (!target) return;
  const months = annualArchiveMonths(month);
  const year = String(month || "").slice(0, 4);
  if (!months.length) {
    target.innerHTML = `<article class="action-item"><strong>연간 흐름을 불러오지 못했습니다.</strong><p>선택된 월의 연도를 확인할 수 없습니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    return;
  }
  target.innerHTML = `<article class="action-item"><strong>연간 흐름 확인 중</strong><p>${esc(year)}년 월별 아카이브를 불러오고 있습니다.</p></article>`;
  const settled = await Promise.allSettled(months.map((item) => getJson(`/api/reports/monthly?month=${item}`, 8000)));
  if (renderSeq !== undefined && renderSeq !== reportsRenderSeq) return;
  const rows = months.map((item, index) => {
    const result = settled[index];
    const archive = result.status === "fulfilled" ? result.value : {};
    return { month: item, archive, archiveStatus: archive.archiveStatus || "", failed: result.status !== "fulfilled" || Boolean(archive.error) };
  });
  if (rows.every((row) => row.failed)) {
    target.innerHTML = `<article class="action-item"><strong>연간 흐름을 불러오지 못했습니다.</strong><p>${esc(year)}년 월별 아카이브를 확인할 수 없습니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    return;
  }
  const yearLabel = annualArchiveYearLabel(year, rows);
  const salesMetrics = annualArchiveMetrics.filter((metric) => ["totalSales", "onlineSales", "offlineSales"].includes(metric.key));
  const remainingMetrics = annualArchiveMetrics.filter((metric) => !["totalSales", "onlineSales", "offlineSales"].includes(metric.key));
  const brandPerformanceBlock = annualArchiveBrandPerformanceBlock(rows);
  target.innerHTML = `<section class="monthly-report-chapter annual-flow">
    <div class="monthly-report-chapter-head">
      <span>Y</span>
      <div><p class="eyebrow">Annual Flow</p><h3>${esc(year)}년 누적 흐름 · ${esc(yearLabel)}</h3></div>
    </div>
    <p class="monthly-report-fnote">월별 아카이브 기준입니다. 현재월은 Live Draft가 포함될 수 있으며 Saved Archive와 계산 시점이 다를 수 있습니다. 총매출은 Cafe24 온라인 매출과 확보된 ECOUNT 오프라인 매출의 합계입니다. 팔로워 증감은 조회 시점 스냅샷 기준입니다.</p>
    <div class="annual-flow-filters" aria-label="Annual Flow filter">
      <button class="segment active" type="button" data-annual-filter="all">전체</button>
      <button class="segment" type="button" data-annual-filter="commerce">Commerce</button>
      <button class="segment" type="button" data-annual-filter="marketing">Marketing</button>
      <button class="segment" type="button" data-annual-filter="content">Content</button>
    </div>
    <div class="annual-flow-kpis">
      ${annualArchiveMetrics.map((metric) => annualArchiveKpi(metric, rows)).join("")}
    </div>
    <div class="annual-flow-grid">
      ${salesMetrics.map((metric) => annualArchiveMetricBlock(metric, rows)).join("")}
    </div>
    ${brandPerformanceBlock}
    <div class="annual-flow-grid">
      ${remainingMetrics.map((metric) => annualArchiveMetricBlock(metric, rows)).join("")}
    </div>
    <div class="annual-flow-tooltip" role="tooltip" hidden></div>
  </section>`;
}

async function renderMonthlyArchiveReport(month, renderSeq) {
  const target = $("#monthlyArchiveReport");
  if (!target) return;

  target.innerHTML = `<article class="action-item"><strong>Monthly Report 확인 중</strong><p>저장된 월간 리포트를 불러오고 있습니다.</p></article>`;

  const previousMonth = previousMonthKey(month);
  const { monthStart, monthEnd } = monthlyReportMonthRange(month);
  const missionParams = new URLSearchParams({ since: monthStart, until: monthEnd, limit: "3" });
  const [archive, previousArchive, missionResult] = await Promise.all([
    getJson(`/api/reports/monthly?month=${month}`, 8000),
    previousMonth ? getJson(`/api/reports/monthly?month=${previousMonth}`, 8000) : Promise.resolve({ error: "직전 월 없음" }),
    monthStart && monthEnd ? getJson(intelligenceUrl(`/api/intelligence/missions?${missionParams.toString()}`), 12000) : Promise.resolve({ error: "월 범위 없음" })
  ]);
  if (renderSeq !== undefined && renderSeq !== reportsRenderSeq) return;

  if (archive.error) {
    target.innerHTML = `<article class="action-item"><strong>Monthly Report 생성 실패</strong><p>${esc(archive.error)}</p></article>`;
    return;
  }

  const commerce = archive.commerce || {};
  const marketing = archive.marketing || {};
  const content = archive.content || {};
  const previousCommerce = previousArchive.error ? {} : previousArchive.commerce || {};
  const previousMarketing = previousArchive.error ? {} : previousArchive.marketing || {};
  const previousContent = previousArchive.error ? {} : previousArchive.content || {};
  const previousBrandSales = previousArchive.error ? [] : previousCommerce.brandSales || [];
  const paymentMethods = commerce.paymentMethods || [];
  const brandSales = commerce.brandSales || [];
  const productSales = commerce.productSales || [];
  const formatMix = content.formatMix || [];
  const topContent = content.topContent || [];
  const aboveAverageSaveRatePosts = content.aboveAverageSaveRatePosts || [];
  const reconciliationLabel = marketing.reconciliationStatus === "matched"
    ? "일치"
    : marketing.reconciliationStatus === "mismatch"
      ? "불일치"
      : "확인 불가";
  const archiveStatusLabel = {
    live: "Live Draft",
    saved: "Saved Archive",
    draft: "Unsaved Draft"
  }[archive.archiveStatus] || String(archive.status || "Draft");
  const archiveStatusDescription = {
    live: "현재 시점 계산값",
    saved: "저장 시점 고정값",
    draft: "저장되지 않은 계산값"
  }[archive.archiveStatus] || "저장 데이터";
  const archiveReference = archive.archiveReference || {};
  const archiveGeneratedAtLabel = monthlyReportDateTimeLabel(archive.generatedAt) || archive.generatedAt || "-";
  const savedGeneratedAtLabel = monthlyReportDateTimeLabel(archiveReference.savedGeneratedAt);
  const savedReferenceNote = archive.archiveStatus === "live"
    ? archiveReference.unavailable
      ? "저장본 확인 불가 · 현재는 Live Draft 표시 중"
      : archiveReference.savedExists
      ? [
        "저장본 있음",
        "현재는 Live Draft 표시 중",
        savedGeneratedAtLabel ? `저장 시각 ${savedGeneratedAtLabel}` : ""
      ].filter(Boolean).join(" · ")
      : "저장된 snapshot 없음"
    : "";
  const archiveSaveButton = archive.archiveStatus === "draft" || archive.archiveStatus === "saved"
    ? `<button type="button" class="button secondary" data-archive-save="${esc(month)}" data-archive-status="${esc(archive.archiveStatus)}">${archive.archiveStatus === "saved" ? "최신 값으로 다시 저장" : "아카이브 저장"}</button>`
    : "";
  const paymentTotal = Number(commerce.paidAmount || 0);
  const compareBase = Math.max(Number(marketing.spend || 0), Number(marketing.purchaseValue || 0), 1);
  const hasMonthlySummaryPrevious = months.includes(previousMonth) && !previousArchive.error;
  const summaryPreviousCommerce = hasMonthlySummaryPrevious ? previousCommerce : {};
  const summaryPreviousMarketing = hasMonthlySummaryPrevious ? previousMarketing : {};
  const summaryPreviousContent = hasMonthlySummaryPrevious ? previousContent : {};
  const monthlySummary = [
    monthlyReportDirectionText("실제 매출은", commerce.paidAmount, summaryPreviousCommerce.paidAmount, { formatter: apiWon }),
    monthlyReportDirectionText("광고비는", marketing.spend, summaryPreviousMarketing.spend, { formatter: apiWon }),
    monthlyReportDirectionText("콘텐츠 조회는", content.totalViews, summaryPreviousContent.totalViews),
    monthlyReportFollowerDirectionText(content.followerDelta, summaryPreviousContent.followerDelta)
  ].join(". ");
  const liveDraftNotice = archive.archiveStatus === "live"
    ? "현재 화면은 Live Draft 기준입니다."
    : "";
  const reportBasisNote = `기간 ${monthStart} ~ ${monthEnd} · 계산 시각 ${archiveGeneratedAtLabel}`;
  const sales = archive.sales || null;
  const salesCoverage = sales?.coverage || {};
  const salesTotalAmount = sales?.totalSales?.amount;
  const salesOnlineAmount = hasApiValue(sales?.onlineSales?.paidAmount)
    ? sales.onlineSales.paidAmount
    : commerce.paidAmount;
  const salesOfflineAmount = sales?.offlineSales?.offlineSalesAmount;
  const hasCanonicalTotalSales = hasApiValue(salesTotalAmount);
  const hasOnlineSales = hasApiValue(salesOnlineAmount);
  const hasOfflineSales = hasApiValue(salesOfflineAmount);
  const hasSalesSummary = hasCanonicalTotalSales || hasOnlineSales || hasOfflineSales;
  const salesCoverageComplete = salesCoverage.complete === true;
  const salesCoverageLabel = salesCoverageComplete ? "통합 매출 기준 완료" : "확보 데이터 기준";
  const salesCoverageNote = hasCanonicalTotalSales
    ? salesCoverageComplete
      ? "Cafe24 온라인 매출과 ECOUNT 오프라인 매출을 함께 합산했습니다."
      : "ECOUNT 확인 범위 기준으로 합산된 매출입니다. 일부 월 범위 확인 필요."
    : "이 archive에는 통합 매출 필드가 없어 Cafe24 온라인 매출만 표시합니다.";
  const salesSummaryBlock = hasSalesSummary ? `
    <section class="monthly-report-block">
      <div class="monthly-report-block-head"><h4>Sales Summary</h4><span>${esc(hasCanonicalTotalSales ? salesCoverageLabel : "온라인 매출 기준")}</span></div>
      <div class="monthly-report-hero">
        <div class="monthly-report-hero-main">
          <span>${hasCanonicalTotalSales ? "총매출" : "온라인 매출"}</span>
          <strong>${apiWon(hasCanonicalTotalSales ? salesTotalAmount : salesOnlineAmount)}</strong>
          <em>${hasCanonicalTotalSales ? "Cafe24 온라인 + ECOUNT 오프라인" : "Cafe24 온라인 실제 결제 매출"}</em>
        </div>
        <div class="monthly-report-side">
          <div class="monthly-report-side-row"><span>온라인 매출</span><strong>${apiWon(salesOnlineAmount)}</strong></div>
          <div class="monthly-report-side-row ${hasOfflineSales ? "" : "monthly-report-muted"}"><span>오프라인 매출</span><strong>${hasOfflineSales ? apiWon(salesOfflineAmount) : "데이터 없음"}</strong></div>
          <div class="monthly-report-side-row"><span>온라인 주문</span><strong>${apiNum(commerce.orderCount)}</strong></div>
          <div class="monthly-report-side-row"><span>온라인 객단가</span><strong>${apiWon(commerce.averageOrderValue)}</strong></div>
          ${hasCanonicalTotalSales ? `<div class="monthly-report-side-row ${salesCoverageComplete ? "" : "monthly-report-muted"}"><span>Coverage</span><strong>${esc(salesCoverageLabel)}</strong></div>` : ""}
        </div>
      </div>
      <p class="monthly-report-fnote ${hasCanonicalTotalSales && salesCoverageComplete ? "" : "monthly-report-muted"}">${esc(salesCoverageNote)}</p>
    </section>
  ` : "";
  const brandSignalsBlock = brandSales.length && previousBrandSales.length
    ? monthlyReportBrandSignalsBlock(brandSales, previousBrandSales, reconciliationLabel)
    : "";
  const missionRows = !missionResult?.error && missionResult?.ok && Array.isArray(missionResult.missions)
    ? missionResult.missions.slice(0, 3)
    : [];
  const missionSummaryBlock = missionRows.length ? `
    <section class="monthly-report-block">
      <div class="monthly-report-block-head"><h4>다음 달 우선순위 Mission</h4><span>현재 시점 기준</span></div>
      <div class="monthly-report-grid2">
        ${missionRows.map((mission) => intelligenceBriefCard(mission)).join("")}
      </div>
      <p class="monthly-report-fnote">Mission은 저장된 월간 archive가 아니라 현재 Intelligence Service 기준으로 표시됩니다.</p>
    </section>
  ` : "";

  target.innerHTML = `
    <header class="monthly-report-header">
      <div>
        <p class="eyebrow">Monthly Report</p>
        <h3>${esc(String(month || "").replace("-", " / "))}</h3>
      </div>
      <div class="monthly-report-stat">
        <strong>${esc(archiveStatusLabel)}</strong>
        <span>계산 시각 ${esc(archiveGeneratedAtLabel)}</span>
        <em>${esc(archiveStatusDescription)}</em>
        ${savedReferenceNote ? `<em class="monthly-report-muted">${esc(savedReferenceNote)}</em>` : ""}
        ${archiveSaveButton}
      </div>
    </header>
    <p class="monthly-report-fnote">${esc(monthlySummary)}. ${esc(reportBasisNote)}.${liveDraftNotice ? ` ${esc(liveDraftNotice)}` : ""}</p>
    <nav class="monthly-report-toc" aria-label="Monthly report chapters">
      <a href="#monthly-report-ch1">01 Commerce</a>
      <a href="#monthly-report-ch2">02 Marketing</a>
      <a href="#monthly-report-ch3">03 Content</a>
    </nav>
    ${salesSummaryBlock}
    ${brandSignalsBlock}

    <section id="monthly-report-ch1" class="monthly-report-chapter">
      <div class="monthly-report-chapter-head">
        <span>01</span>
        <div><p class="eyebrow">Commerce</p><h3>월간 판매 스냅샷</h3></div>
      </div>
      <div class="monthly-report-hero">
        <div class="monthly-report-hero-main">
          <span>월 실제 판매</span>
          <strong>${apiWon(commerce.paidAmount)}</strong>
          <em>${esc(monthlyReportDelta(commerce.paidAmount, previousCommerce.paidAmount, apiWon))}</em>
        </div>
        <div class="monthly-report-side">
          <div class="monthly-report-side-row"><span>주문수</span><strong>${apiNum(commerce.orderCount)}</strong></div>
          <div class="monthly-report-side-row"><span>객단가</span><strong>${apiWon(commerce.averageOrderValue)}</strong></div>
          <div class="monthly-report-side-row"><span>제외 주문</span><strong>${apiNum(commerce.excludedOrderCount)}</strong></div>
        </div>
      </div>
      <div class="monthly-report-drill">
        <span>Commerce ▸ Product</span>
        <button class="today-jump-button" type="button" data-jump-view="Product">상품별 판매 보기</button>
      </div>
      <div class="monthly-report-grid2">
        <section class="monthly-report-block">
          <div class="monthly-report-block-head"><h4>결제수단 구성</h4><span>orderAmount 기준</span></div>
          <div class="monthly-report-stack">
            ${paymentMethods.length ? paymentMethods.map((item) => `<span class="${Number(item.orderAmount || 0) ? "" : "monthly-report-muted"}" style="width:${monthlyReportRatio(item.orderAmount, paymentTotal)}%"></span>`).join("") : `<span class="monthly-report-muted" style="width:100%"></span>`}
          </div>
          <div class="monthly-report-legend">
            ${paymentMethods.length ? paymentMethods.map((item) => `<div class="monthly-report-legend-row ${Number(item.orderAmount || 0) ? "" : "monthly-report-muted"}"><strong>${esc(item.paymentMethod || "-")}</strong><span>${apiWon(item.orderAmount)} · 주문 ${apiNum(item.orderCount)}</span></div>`).join("") : `<div class="monthly-report-legend-row monthly-report-muted"><strong>데이터 없음</strong><span>저장된 결제수단 정보가 없습니다.</span></div>`}
          </div>
        </section>
        <section class="monthly-report-block">
          <div class="monthly-report-block-head"><h4>브랜드 매출 TOP 5</h4><span>salesAmount</span></div>
          <div class="monthly-report-rank">
            ${monthlyReportRankRows(brandSales.slice(0, 5), {
              withBar: true,
              valueFn: (item) => item.salesAmount,
              labelFn: (item) => item.brand_name || item.brand_code || "-",
              subFn: (item) => item.brand_code || "",
              formatValue: (value) => apiWon(value)
            })}
          </div>
        </section>
      </div>
      <section class="monthly-report-block">
        <div class="monthly-report-block-head"><h4>상품 매출 TOP 5</h4><span>salesAmount</span></div>
        <div class="monthly-report-rank">
          ${monthlyReportRankRows(productSales.slice(0, 5), {
            withBar: false,
            valueFn: (item) => item.salesAmount,
            labelFn: (item) => item.productName || item.product_name || "-",
            subFn: (item) => item.brand_name || item.brand_code || "",
            formatValue: (value) => apiWon(value)
          })}
        </div>
      </section>
    </section>

    <section id="monthly-report-ch2" class="monthly-report-chapter">
      <div class="monthly-report-chapter-head">
        <span>02</span>
        <div><p class="eyebrow">Marketing</p><h3>월간 광고 스냅샷</h3></div>
      </div>
      <div class="monthly-report-hero">
        <div class="monthly-report-hero-main">
          <span>광고비</span>
          <strong>${apiWon(marketing.spend)}</strong>
          <em>${esc(monthlyReportDelta(marketing.spend, previousMarketing.spend, apiWon))}</em>
        </div>
        <div class="monthly-report-side">
          <div class="monthly-report-side-row"><span>광고비 / 실제 매출</span><strong>${hasApiValue(marketing.adSpendShare) ? pct(marketing.adSpendShare) : "-"}</strong><em>광고비가 실제 매출에서 차지하는 비중</em></div>
          <div class="monthly-report-side-row"><span>오차율</span><strong>${marketing.comparable === false ? "비교 불가" : hasApiValue(marketing.mismatchRate) ? pct(marketing.mismatchRate) : "-"}</strong></div>
          <div class="monthly-report-side-row"><span>일치검증</span><strong>${reconciliationLabel}</strong></div>
        </div>
      </div>
      <section class="monthly-report-block">
        <div class="monthly-report-block-head"><h4>광고비와 Meta 구매값</h4><span>Meta 광고 귀속 기준 · 실제 매출 아님</span></div>
        <div class="monthly-report-compare">
          <div class="monthly-report-compare-row">
            <span>광고비</span>
            <div><i style="width:${monthlyReportRatio(marketing.spend, compareBase)}%"></i></div>
            <strong>${apiWon(marketing.spend)}</strong>
            <em>${esc(monthlyReportDelta(marketing.spend, previousMarketing.spend, apiWon))}</em>
          </div>
          <div class="monthly-report-compare-row monthly-report-attributed">
            <span>구매값</span>
            <div><i style="width:${monthlyReportRatio(marketing.purchaseValue, compareBase)}%"></i></div>
            <strong>${apiWon(marketing.purchaseValue)}</strong>
            <em>${esc(monthlyReportDelta(marketing.purchaseValue, previousMarketing.purchaseValue, apiWon))}</em>
          </div>
        </div>
      </section>
      <div class="monthly-report-strip">
        <div><span>집행</span><strong>${apiNum(marketing.activeCampaignCount)}</strong></div>
        <div><span>미집행</span><strong>${apiNum(marketing.inactiveCampaignCount)}</strong></div>
        <div><span>누락</span><strong>${apiNum(marketing.unlistedCampaignCount)}</strong></div>
        <div><span>일치검증</span><strong>${reconciliationLabel}</strong></div>
        <div><span>오차율</span><strong>${marketing.comparable === false ? "비교 불가" : hasApiValue(marketing.mismatchRate) ? pct(marketing.mismatchRate) : "-"}</strong></div>
      </div>
      <div class="monthly-report-drill">
        <span>Marketing ▸ Advertising</span>
        <button class="today-jump-button" type="button" data-jump-view="Advertising">광고 데이터 보기</button>
      </div>
    </section>

    <section id="monthly-report-ch3" class="monthly-report-chapter">
      <div class="monthly-report-chapter-head">
        <span>03</span>
        <div><p class="eyebrow">Content</p><h3>월간 콘텐츠 스냅샷</h3></div>
      </div>
      <div class="monthly-report-hero">
        <div class="monthly-report-hero-main">
          <span>조회수</span>
          <strong>${apiNum(content.totalViews)}</strong>
          <em>${esc(monthlyReportDelta(content.totalViews, previousContent.totalViews, apiNum))}</em>
        </div>
        <div class="monthly-report-hero-main">
          <span>저장</span>
          <strong>${apiNum(content.totalSaves)}</strong>
          <em>${esc(monthlyReportDelta(content.totalSaves, previousContent.totalSaves, apiNum))}</em>
        </div>
        <div class="monthly-report-side">
          <div class="monthly-report-side-row"><span>콘텐츠 수</span><strong>${apiNum(content.postCount)}</strong></div>
          <div class="monthly-report-side-row"><span>좋아요</span><strong>${apiNum(content.totalLikes)}</strong></div>
          <div class="monthly-report-side-row"><span>공유</span><strong>${apiNum(content.totalShares)}</strong></div>
          <div class="monthly-report-side-row monthly-report-muted"><span>팔로워 변화</span><strong>${hasApiValue(content.followerDelta) ? `${Number(content.followerDelta) > 0 ? "+" : ""}${apiNum(content.followerDelta)}명` : "-"}</strong><em>${esc(monthlyReportDelta(content.followerDelta, previousContent.followerDelta, (value) => `${apiNum(value)}명`, { noPercent: true }))}</em></div>
        </div>
      </div>
      <p class="monthly-report-fnote">팔로워 변화는 월말 확정 증감이 아니라 조회 시점 스냅샷 기준입니다.</p>
      <section class="monthly-report-block">
        <div class="monthly-report-block-head"><h4>Format Mix</h4><span>archive percentage 기준</span></div>
        <div class="monthly-report-fmix">
          ${formatMix.length ? formatMix.map((item) => {
            const width = monthlyReportRatio(item.percentage, 100);
            return `<article class="monthly-report-fmix-row">
              <div>
                <strong>${esc(item.type || "-")}</strong>
                <span>${apiNum(item.count)}개 · ${hasApiValue(item.percentage) ? pct(item.percentage) : "-"} · Reach ${apiNum(item.reach)} · 저장 ${apiNum(item.saves)} · 공유 ${apiNum(item.shares)} · 저장률 ${hasApiValue(item.avgSaveRate) ? pct(item.avgSaveRate) : "-"}</span>
              </div>
              <div><i style="width:${width}%"></i></div>
            </article>`;
          }).join("") : `<div class="monthly-report-fmix-row monthly-report-muted"><strong>데이터 없음</strong><span>저장된 Format Mix가 없습니다.</span></div>`}
        </div>
      </section>
      <div class="monthly-report-grid2">
        <section class="monthly-report-block">
          <div class="monthly-report-block-head">
            <h4>조회 상위 콘텐츠</h4>
            <span>views</span>
          </div>
          <div class="monthly-report-rank">
            ${monthlyReportRankRows(topContent.slice(0, 3), {
              withBar: true,
              valueFn: (item) => item.views,
              labelFn: (item) => item.title || item.caption || "-",
              subFn: (item) => item.date || item.type || "",
              formatValue: (value) => apiNum(value)
            })}
          </div>
        </section>
        <section class="monthly-report-block">
          <div class="monthly-report-block-head">
            <h4>평균 저장률 상회</h4>
            <span>saves / reach</span>
          </div>
          <div class="monthly-report-rank">
            ${monthlyReportRankRows(aboveAverageSaveRatePosts.slice(0, 3), {
              withBar: false,
              valueFn: (item) => item.saves,
              labelFn: (item) => item.title || item.caption || "-",
              subFn: (item) => `저장 ${apiNum(item.saves)} · Reach ${apiNum(item.reach || item.views)}`,
              formatValue: () => ""
            })}
          </div>
        </section>
      </div>
      <div class="monthly-report-drill">
        <span>Content ▸ Editorial AI</span>
        <button class="today-jump-button" type="button" data-jump-view="Editorial AI">Editorial AI 분석</button>
      </div>
    </section>
    ${missionSummaryBlock}
  `;
}

function miniMetric(label, value, helper) {
  return `<div class="mini-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(helper)}</p></div>`;
}

function signalCard(label, value, helper) {
  return `<article class="signal-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><p>${esc(helper)}</p></article>`;
}

function supportMetric(label, value, helper) {
  return `<div class="report-support-item"><span>${esc(label)}</span><strong>${esc(value)}</strong><em>${esc(helper)}</em></div>`;
}

function reportLane(title, posts, helper) {
  return `<section class="report-panel report-lane">
    <h4>${esc(title)}</h4>
    <div class="compact-list">
      ${posts.length ? posts.map((post) => `<div class="compact-row"><strong>${esc(post.title || "-")}</strong><span>${esc(helper(post))}</span></div>`).join("") : `<div class="compact-row"><strong>데이터 없음</strong><span>해당 월에 표시할 콘텐츠가 없습니다.</span></div>`}
    </div>
  </section>`;
}

function positionAnnualFlowTooltip(event, tooltip) {
  const margin = 12;
  const gap = 14;
  const width = tooltip.offsetWidth || 180;
  const height = tooltip.offsetHeight || 34;
  let left = event.clientX + gap;
  let top = event.clientY + gap;
  if (left + width + margin > window.innerWidth) left = event.clientX - width - gap;
  if (top + height + margin > window.innerHeight) top = event.clientY - height - gap;
  tooltip.style.left = `${Math.max(margin, left)}px`;
  tooltip.style.top = `${Math.max(margin, top)}px`;
}

function formatBar(item, posts) {
  const maxCount = Math.max(...summarizeByType(posts).map((entry) => entry.count), 1);
  const width = Math.max(8, Math.round(item.count / maxCount * 100));
  return `<article class="format-row">
    <div>
      <strong>${esc(item.type)}</strong>
      <span>${num(item.count)}개 · 도달 ${num(item.reach)} · 저장률 ${pct(item.avgSaveRate)}</span>
    </div>
    <div class="format-track"><span style="width:${width}%"></span></div>
  </article>`;
}

function renderGrowthChart() {
  const rows = [...monthlyData].reverse();
  const max = Math.max(1, ...rows.map((item) => Number(item.account?.followerDelta || 0)));
  $("#growthChart").innerHTML = rows.map((item) => (
    `<div class="bar-row"><span>${item.month}</span><div class="bar"><i style="width:${Math.max(4, Number(item.account?.followerDelta || 0) / max * 100)}%"></i></div><em>+${num(item.account?.followerDelta)}</em></div>`
  )).join("");
}

function renderOtherSections(data) {
  const posts = data.posts || [];
  renderCards("reelsReport", posts.filter((post) => post.type === "릴스"), "feed");
  renderCards("cardnewsReport", posts.filter((post) => post.type === "카드뉴스"), "cardnews");
  renderCards("conversionGrid", [...posts].sort((a, b) => Number(b.websiteClicks || 0) - Number(a.websiteClicks || 0)).slice(0, 6));
  $("#adAiBriefing").innerHTML = `<article class="action-item"><strong>관리 필요 캠페인 확인 중</strong><p>Meta 자체 귀속 지표 기준으로 확인하고 있습니다.</p></article>`;
  $("#marketingSummaryHero").innerHTML = `<article class="action-item"><strong>Marketing 데이터 확인 중</strong><p>Meta Ads와 Commerce 매출을 불러오고 있습니다.</p></article>`;
  $("#marketingSummaryBriefing").innerHTML = `<article class="action-item"><strong>관리 필요 캠페인 확인 중</strong><p>Meta 자체 귀속 지표 기준으로 확인하고 있습니다.</p></article>`;
  $("#marketingSummaryStatus").innerHTML = `<article class="action-item"><strong>광고 상태 확인 중</strong><p>집행·미집행·일치 검증 결과를 정리합니다.</p></article>`;
  $("#adTodayStatus").innerHTML = `<span class="status-dot"></span><strong>오늘 광고 상태 확인 중</strong><span class="note">Meta Ads 데이터를 불러오고 있습니다.</span>`;
  $("#adCoreKpi").innerHTML = `<article class="action-item"><strong>핵심 지표 확인 중</strong><p>광고비, ROAS, 실매출을 확인합니다.</p></article>`;
  $("#advertisingSummary").innerHTML = `<article class="action-item"><strong>Meta 광고 데이터 확인 중</strong><p>광고비, 도달, 클릭, 구매값, ROAS를 확인합니다.</p></article>`;
  $("#campaignPerformance").innerHTML = `<article class="action-item"><strong>캠페인 성과 확인 중</strong><p>Meta 캠페인 기준으로 불러옵니다.</p></article>`;
  $("#adReconciliationSummary").innerHTML = `<article class="action-item"><strong>데이터 일치 검증 확인 중</strong><p>Meta 계정 전체 합계와 비교하고 있습니다.</p></article>`;
  $("#adFullReportActiveRows").innerHTML = `<tr><td colspan="18">전체 캠페인 데이터를 확인하고 있습니다.</td></tr>`;
  $("#metaProductPerformanceSummary").innerHTML = `<article class="action-item"><strong>Meta Product Performance 확인 중</strong><p>Meta 구매 상품을 content_id 기준으로 확인하고 있습니다.</p></article>`;
  $("#metaProductPerformanceRows").innerHTML = `<tr><td colspan="4">데이터를 불러오고 있습니다.</td></tr>`;
  $("#metaBrandContributionSummary").innerHTML = `<article class="action-item"><strong>Brand Contribution 확인 중</strong><p>브랜드별 광고 기여를 집계하고 있습니다.</p></article>`;
  $("#metaBrandContributionRows").innerHTML = `<tr><td colspan="6">데이터를 불러오고 있습니다.</td></tr>`;
  hideAdOrganicSection();
  renderAdvertising(data);
  $("#salesHealthBanner").innerHTML = `<span class="status-dot"></span><strong>Sales Health 확인 중</strong><span class="note">Meta · Cafe24 데이터를 불러오고 있습니다.</span>`;
  commerceSummaryState = { cafe: null, comparison: null, totalSales: null };
  $("#commerceSummaryHero").innerHTML = `<article class="action-item"><strong>Commerce 데이터 확인 중</strong><p>Cafe24 canonical 데이터를 불러오고 있습니다.</p></article>`;
  $("#commerceSummaryCompare").innerHTML = `<article class="action-item"><strong>Meta 비교 확인 중</strong><p>Meta 구매값과 Cafe24 실제 판매를 비교합니다.</p></article>`;
  $("#commerceSummaryPayments").innerHTML = `<article class="action-item"><strong>결제수단 확인 중</strong><p>결제수단 구성을 불러오고 있습니다.</p></article>`;
  renderCafe24Sales(data);
  renderAdComparison(data);
  $("#productDashboardBanner").innerHTML = `<span class="status-dot"></span><strong>상품 Dashboard 확인 중</strong><span class="note">Cafe24 Orders · Products 데이터를 불러오고 있습니다.</span>`;
  $("#productDashboardRows").innerHTML = `<tr><td colspan="7">상품 데이터를 불러오고 있습니다.</td></tr>`;
  renderProductDashboard(data);
  renderApiHealthCenter(data);
  renderScoreWeightsSettings();
  renderCafe24ProductDiagnostics();
  renderBrandMasterSettings();
}

const SCORE_FACTOR_LABELS = {
  roas: "ROAS",
  purchase: "Purchase",
  cpa: "CPA",
  ctr: "CTR",
  landingPageView: "Landing Page View",
  cpc: "CPC",
  thruplay: "ThruPlay",
  completionRate: "Completion Rate",
  engagementRate: "Engagement Rate",
  frequency: "Frequency",
  reach: "Reach",
  cpm: "CPM"
};

const SCORE_OBJECTIVE_LABELS = {
  sales: "Sales",
  traffic: "Traffic",
  video: "Video",
  engagement: "Engagement",
  awareness: "Awareness"
};

// Preset은 저희가 만든 출발점입니다. Balanced는 기본값과 동일하고, Sales/Traffic/Aggressive는
// 각각 매출 전환, 트래픽/유입, 효율보다 규모(볼륨)를 우선하는 쪽으로 가중치를 옮긴 것입니다.
// Preset을 고르면 값만 채워지고, 실제 저장은 "저장" 버튼을 눌러야 반영됩니다.
const SCORE_PRESETS = {
  balanced: {
    sales: { roas: 50, purchase: 30, cpa: 20 },
    traffic: { ctr: 35, landingPageView: 35, cpc: 30 },
    video: { thruplay: 50, completionRate: 50 },
    engagement: { engagementRate: 70, ctr: 30 },
    awareness: { reach: 35, frequency: 35, cpm: 30 }
  },
  sales: {
    sales: { roas: 60, purchase: 25, cpa: 15 },
    traffic: { ctr: 25, landingPageView: 50, cpc: 25 },
    video: { thruplay: 40, completionRate: 60 },
    engagement: { engagementRate: 50, ctr: 50 },
    awareness: { reach: 30, frequency: 40, cpm: 30 }
  },
  traffic: {
    sales: { roas: 40, purchase: 40, cpa: 20 },
    traffic: { ctr: 45, landingPageView: 30, cpc: 25 },
    video: { thruplay: 60, completionRate: 40 },
    engagement: { engagementRate: 40, ctr: 60 },
    awareness: { reach: 45, frequency: 25, cpm: 30 }
  },
  aggressive: {
    sales: { roas: 30, purchase: 50, cpa: 20 },
    traffic: { ctr: 30, landingPageView: 20, cpc: 50 },
    video: { thruplay: 70, completionRate: 30 },
    engagement: { engagementRate: 80, ctr: 20 },
    awareness: { reach: 60, frequency: 15, cpm: 25 }
  }
};

function renderScoreWeightsForm(weights) {
  const formTarget = $("#scoreWeightsForm");
  if (!formTarget) return;
  formTarget.innerHTML = Object.entries(weights).map(([objective, factors]) => `
    <div class="score-weights-group">
      <h4>${esc(SCORE_OBJECTIVE_LABELS[objective] || objective)}</h4>
      ${Object.entries(factors).map(([factorKey, value]) => `
        <label class="score-weights-field">
          <span>${esc(SCORE_FACTOR_LABELS[factorKey] || factorKey)}</span>
          <input type="number" min="0" max="100" data-objective="${esc(objective)}" data-factor="${esc(factorKey)}" value="${esc(value)}" />
        </label>
      `).join("")}
    </div>
  `).join("");
}

async function renderScoreWeightsSettings() {
  const formTarget = $("#scoreWeightsForm");
  const saveBtn = $("#scoreWeightsSaveBtn");
  const presetSelect = $("#scoreWeightsPreset");
  if (!formTarget) return;
  const resp = await getJson("/api/meta-ads/score-weights", 5000);
  const weights = resp.weights || {};
  renderScoreWeightsForm(weights);

  if (presetSelect && !presetSelect.dataset.bound) {
    presetSelect.dataset.bound = "1";
    presetSelect.addEventListener("change", () => {
      const preset = SCORE_PRESETS[presetSelect.value];
      if (!preset) return;
      renderScoreWeightsForm(preset);
      toast("Preset 값을 채웠습니다. 저장을 눌러야 실제로 반영됩니다.");
    });
  }

  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", async () => {
      const inputs = $$("#scoreWeightsForm input[data-objective]");
      const next = {};
      inputs.forEach((input) => {
        const objective = input.dataset.objective;
        const factor = input.dataset.factor;
        next[objective] = next[objective] || {};
        next[objective][factor] = Number(input.value || 0);
      });
      saveBtn.disabled = true;
      const originalLabel = saveBtn.textContent;
      saveBtn.textContent = "저장 중...";
      const result = await postJson("/api/meta-ads/score-weights", { weights: next }, 5000);
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
      toast(result.error ? "저장에 실패했습니다." : "가중치를 저장했습니다.");
    });
  }
}

async function renderApiHealthCenter(data) {
  const target = $("#apiSetup");
  if (!target) return;
  target.innerHTML = `<article class="api-health-card"><strong>연동 상태 확인 중</strong><p>Instagram, Meta Ads, Cafe24 상태를 확인합니다.</p></article>`;
  $("#apiHealthActions").innerHTML = apiHealthActionCards();

  const startDate = `${data.month}-01`;
  const endDate = monthEnd(data.month);
  const [status, meta, cafeStatus] = await Promise.all([
    getJson("/api/status", 6000),
    getJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}`, 7000),
    getCafe24Status(startDate, endDate)
  ]);
  const instagramOk = !data.error && status.instagram !== false;
  // 진단용 로그 (2026-07-08). renderApiHealthCenter()는 renderOtherSections(data)에서
  // selectedMonth()가 반환한 data를 그대로 받는다 — 여기 찍히는 data가 실제
  // /api/instagram/monthly 최신 응답과 같은지 이 로그로 확인한다.
  console.log("renderApiHealthCenter", { data, status, instagramOk });
  const metaOk = !meta.error && status.metaAds !== false;
  target.innerHTML = [
    apiHealthCard({
      title: "Instagram",
      ok: instagramOk,
      status: instagramOk ? "연결됨" : statusTextForError(data),
      source: integrationSource(data.source),
      updatedAt: syncStatusText(data),
      rows: [
        ["데이터 소스", sourceLabel(data)],
        ["마지막 성공 여부", instagramOk ? "성공" : "실패"],
        ["재인증 필요", instagramOk ? "아니오" : "확인 필요"],
        ["계정", data.account?.username || status.username || "samplaskr"],
        ["자동 동기화(6시간)", instagramSyncStatusLabel(status.instagramSync)]
      ],
      // data.error/data.cacheWarning는 이 페이지 요청 자체가 실패했을 때만 채워진다.
      // 서버 백그라운드 스케줄러(6시간 주기)가 조용히 실패한 경우는 이 값들에 잡히지
      // 않으므로, /api/status의 instagramSync.lastError도 함께 보여준다 — 캐시는
      // 깨지지 않지만 "에러는 health 상태에 표시"라는 요구를 만족시키기 위함.
      // (2026-07-08 Instagram 자동 동기화 기능 추가)
      detail: data.error || data.cacheWarning || status.instagramSync?.lastError || sourceText(data)
    }),
    apiHealthCard({
      title: "Meta Ads",
      ok: metaOk,
      status: metaOk ? "연결됨" : statusTextForError(meta),
      source: integrationSource(meta.source),
      updatedAt: syncStatusText(meta),
      rows: [
        ["데이터 소스", String(meta.source || "").includes("_cached") ? "캐시" : "API"],
        ["캠페인 수", `${apiNum((meta.campaigns || meta.rows || []).length)}개`],
        ["마지막 성공 여부", metaOk ? "성공" : "실패"],
        ["광고 계정", status.metaAdAccountId || "-"]
      ],
      detail: meta.error || `광고비 ${apiWon(meta.totals?.spend)} · 구매값 ${apiWon(meta.totals?.purchaseValue)}`
    }),
    apiHealthCard({
      title: "Cafe24",
      ok: cafeStatus.ok,
      status: cafeStatus.status,
      source: cafeStatus.source,
      updatedAt: cafeStatus.updatedAt,
      rows: [
        ["마지막 주문 조회", cafeStatus.lastOrderCheck],
        ["주문 API 상태", cafeStatus.orderApiStatus],
        ["proxyBaseUrl", status.cafe24ProxyBaseUrl || "-"],
        ["조회 주문 수", cafeStatus.orderCount],
        ["연결 기준", cafeStatus.basis]
      ],
      detail: cafeStatus.detail
    })
  ].join("");
  // Cafe24 재인증 콜백이 실패로 돌아온 경우, alert 대신 Settings의 이 패널 맨 위에
  // 계속 보이는 경고 카드로 안내한다(요청: Overview 또는 Settings에 오류 메시지 표시,
  // alert 금지). Cafe24 상태가 다시 정상이 되면 자동으로 사라진다.
  // (2026-07-08 Cafe24 재인증 흐름 개선)
  if (cafeStatus.ok) {
    cafe24OAuthErrorReason = null;
  } else if (cafe24OAuthErrorReason) {
    target.innerHTML = `<article class="api-health-card warn">
      <div class="api-health-head">
        <div><span>Cafe24</span><strong>재인증 실패</strong></div>
        <em>확인 필요</em>
      </div>
      <p>${esc(cafe24OAuthErrorReason)}</p>
    </article>` + target.innerHTML;
  }
}

async function getCafe24Status(startDate, endDate) {
  const [health, orders] = await Promise.all([
    getJson("/api/cafe24/health", 6000),
    getJson(`/api/cafe24/orders?start_date=${startDate}&end_date=${endDate}&limit=20`, 8000)
  ]);
  const ordersOk = !orders.error && orders.ok !== false;
  const orderCount = orders?.totals?.orderCount ?? orders?.orders?.length ?? orders?.orderCount;
  const sourceData = ordersOk ? orders : health;
  return {
    ok: ordersOk,
    status: ordersOk ? "연결됨" : "확인 필요",
    badge: ordersOk ? "정상" : "오류",
    tone: ordersOk ? "good" : "error",
    source: cafe24SourceLabel(sourceData),
    updatedAt: syncStatusText(sourceData),
    lastOrderCheck: ordersOk ? "성공" : "실패",
    orderApiStatus: ordersOk ? "정상" : "확인 필요",
    orderCount: hasApiValue(orderCount) ? `${apiNum(orderCount)}건` : "-",
    basis: health.ok === true && !health.error ? "Health 정상" : "주문 API 기준",
    detail: ordersOk
      ? `연결됨 · 주문 API가 정상 응답했습니다${hasApiValue(orderCount) ? ` · 주문 ${apiNum(orderCount)}건` : ""}.`
      : orders.error || health.error || health.message || "Cafe24 주문 API 확인 필요"
  };
}

function integrationSource(source) {
  const text = String(source || "");
  if (!text) return "-";
  if (text.includes("csv")) return "CSV";
  if (text.includes("cached")) return "캐시";
  if (text.includes("api") || text.includes("graph")) return "API";
  return source;
}

// 서버가 6시간마다 자동으로 돌리는 Instagram 백그라운드 동기화(runInstagramBackgroundSync)의
// 마지막 상태를 사람이 읽을 수 있는 문구로 바꾼다. (2026-07-08 Instagram 자동 동기화 기능 추가)
function instagramSyncStatusLabel(instagramSync) {
  if (!instagramSync || !instagramSync.lastAttemptAt) return "대기 중 (곧 첫 실행)";
  if (instagramSync.lastError) return `오류 (${relativeAgeText(cacheAgeMinutes({ syncedAt: instagramSync.lastAttemptAt }))} 전 시도) · 기존 캐시 유지`;
  if (instagramSync.lastSuccessAt) return `정상 (${relativeAgeText(cacheAgeMinutes({ syncedAt: instagramSync.lastSuccessAt }))} 전)`;
  return "확인 중";
}

function healthTime() {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function setApiHealthRefreshLoading(loading) {
  const buttons = [$("#healthRefreshBtn"), ...$$(`[data-health-action="refresh"]`)];
  buttons.filter(Boolean).forEach((button) => {
    button.disabled = loading;
    button.textContent = loading ? "동기화 중..." : "지금 동기화";
  });
}

async function refreshApiHealthCenter() {
  if (apiHealthRefreshInFlight) return;
  apiHealthRefreshInFlight = true;
  setApiHealthRefreshLoading(true);
  toast("연동 상태를 다시 확인합니다.");
  try {
    await renderApiHealthCenter(selectedMonth());
  } finally {
    apiHealthRefreshInFlight = false;
    setApiHealthRefreshLoading(false);
  }
}

// --- Real sync-time / cache-vs-live helpers (1차 신뢰도 패치) ---
// Data payloads from server.mjs already carry a real syncedAt (when the cache
// file was last written by a live fetch). Previously the UI ignored that and
// showed healthTime() (the browser's current clock) instead, which always
// looked like "just synced" even when serving hours/days-old cache. These
// helpers read the real timestamp so "마지막 동기화" reflects reality.
function formatSyncStamp(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// true = live API response, false = cache/CSV, null = unknown (no source info yet)
function isLiveSource(data = {}) {
  const source = String(data.source || "");
  if (!source) return null;
  if (source.includes("cached") || source.includes("csv") || data.cacheMode) return false;
  if (source.includes("graph_api") || source.includes("marketing_api") || source.includes("admin_api")) return true;
  return null;
}

function syncStatusText(data = {}) {
  const stamp = formatSyncStamp(data.syncedAt);
  if (!stamp) return "동기화 기록 없음";
  const live = isLiveSource(data);
  if (live === null) return stamp;
  return `${live ? "Live" : "Cache"} · ${stamp}`;
}

// How many minutes old is this payload's syncedAt? null = unknown.
function cacheAgeMinutes(data = {}) {
  const iso = data.syncedAt;
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60000));
}

// "Cache 사용 중" alone doesn't tell a director whether the number can be
// trusted right now. Show relative age instead: 최신 / N분 전 / N시간 전 / N일 전.
function cacheFreshnessLabel(data = {}) {
  const minutes = cacheAgeMinutes(data);
  if (minutes === null) return "Cache";
  if (minutes < 15) return "Cache (최신)";
  if (minutes < 60) return `Cache (${minutes}분 전)`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Cache (${hours}시간 전)`;
  const days = Math.floor(hours / 24);
  return `Cache (${days}일 전)`;
}

function cacheFreshnessTone(data = {}) {
  const minutes = cacheAgeMinutes(data);
  if (minutes === null) return "warn";
  return minutes >= 1440 ? "error" : "warn";
}

// One-line health classification shared by the Overview banner. Failures
// carry a concrete reason + next action (not just "실패"), and cache carries
// a freshness read so a director can judge whether to trust the number.
// kind is "instagram" | "meta" | "cafe24" — only Cafe24 has an in-app
// re-auth link (/api/cafe24/oauth/start); Instagram/Meta tokens are rotated
// manually in .env, so those show the required action as plain text.
function bannerState(data = {}, kind = "") {
  if (data.error) {
    const lower = String(data.error).toLowerCase();
    const category = String(data.category || "").toLowerCase();
    if (lower.includes("refresh_token") || category.includes("expired_refresh_token") || lower.includes("재인증")) {
      return {
        tone: "error",
        label: "토큰 만료",
        reason: "Refresh Token 만료",
        action: "재인증 필요",
        actionHref: kind === "cafe24" ? "/api/cafe24/oauth/start" : null
      };
    }
    if (isPermissionBlocked(data) || category.includes("permission_blocked")) {
      return { tone: "error", label: "권한 만료", reason: "앱 권한 차단", action: "다시 로그인 필요", actionHref: null };
    }
    if (lower.includes("access_token") || lower.includes("invalid_token") || category.includes("invalid_access_token")) {
      return { tone: "error", label: "토큰 오류", reason: "Access Token 오류", action: "토큰 재발급 필요", actionHref: null };
    }
    return { tone: "error", label: "API 실패", reason: data.error, action: "연결 상태 확인 필요", actionHref: null };
  }
  if (data.source === "csv_required") {
    return { tone: "warn", label: "캐시 사용 중", reason: "지난 달 데이터(CSV)", action: "", actionHref: null };
  }
  const live = isLiveSource(data);
  if (live === false) {
    return { tone: cacheFreshnessTone(data), label: cacheFreshnessLabel(data), reason: "", action: "", actionHref: null };
  }
  return { tone: "good", label: "정상", reason: "", action: "", actionHref: null };
}

// Small "출처 배지" for individual data cards: which service the number came
// from (확정 매출 vs 추정 vs 콘텐츠 신호), and whether it's Live or Cache right
// now. Falls back to "데이터 없음" so a real zero is never silently shown the
// same way as a missing/blocked value.
function cardBadge(kind, data = {}, hasValue = true) {
  if (data.error || !hasValue) return { label: "데이터 없음", tone: "muted" };
  const kindLabel = { cafe24: "Cafe24 확정", meta: "Meta 추정", instagram: "Instagram 콘텐츠 신호" }[kind] || "";
  const live = isLiveSource(data);
  const modeLabel = live === false ? "Cache" : live === true ? "Live API" : "";
  return {
    label: [kindLabel, modeLabel].filter(Boolean).join(" · "),
    tone: live === false ? "cache" : live === true ? "live" : "neutral"
  };
}

function dataBadgeHtml(badge) {
  if (!badge || !badge.label) return "";
  return `<i class="data-badge ${esc(badge.tone || "")}">${esc(badge.label)}</i>`;
}

// 상대 시간 텍스트만("최신"/"N분 전"/"N시간 전"/"N일 전") 반환한다. cacheFreshnessLabel()은
// "Cache (N일 전)"처럼 "Cache" 접두어가 고정되어 있어 Instagram의 "정상 (N일 전)" 문구에는
// 재사용할 수 없어 별도로 뺐다. (2026-07-08 Health Banner 색상/문구 보정)
function relativeAgeText(minutes) {
  if (minutes === null) return "";
  if (minutes < 15) return "최신";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

// Overview 상단 Health Banner 전용 색상/문구 보정.
// bannerState()/cacheFreshnessTone()는 Sidebar(updateSync)와 Sales 판단(salesDecisionState)
// 등 다른 화면에서도 쓰이므로 그대로 두고, 이 함수는 Health Banner 렌더링에서만 쓴다.
//
// 문제였던 지점: bannerState()는 data.error가 없어도(=API 자체는 정상) 서버가 온디스크
// 캐시를 서빙 중이면(source에 "_cached") cacheFreshnessTone()으로 넘어가고, 캐시가
// 24시간(1440분) 넘게 오래됐으면 tone:"error"를 반환했다 — Sidebar는 이미 지난 수정에서
// data.error 유무만으로 판정하도록 바꿨지만, Health Banner는 여전히 bannerState()의 원본
// tone을 그대로 써서 Sidebar(정상)와 Health Banner(빨간 점)가 서로 모순되어 보였다.
//
// 기준: 빨간색 = 실제 오류/재인증 필요, 노란색 = Cache/동기화 필요/최신 아님, 초록색 = API 정상.
// 캐시가 오래됐다는 이유만으로는(=data.error 없음) 절대 빨간색을 쓰지 않는다.
function healthBannerState(data = {}, kind = "") {
  const base = bannerState(data, kind);
  if (data.error) {
    // 실제 오류: Cafe24는 재인증성 오류를 요청하신 문구("재인증 필요")로 통일한다.
    // Instagram/Meta는 기존 라벨(토큰 오류/API 실패 등)을 그대로 유지한다.
    if (kind === "meta") {
      const needsReauth = base.label === "토큰 만료" || base.label === "권한 만료";
      return { ...base, tone: "error", label: needsReauth ? "재인증 필요" : "실패" };
    }
    if (kind === "cafe24" && (base.label === "토큰 만료" || base.label === "권한 만료" || base.label === "토큰 오류")) {
      return { ...base, tone: "error", label: "재인증 필요" };
    }
    return { ...base, tone: "error" };
  }
  // data.error가 없는데 base.tone이 "error"라면 원인은 오직 "캐시가 오래됐다"는 것뿐이다
  // (bannerState()의 cacheFreshnessTone() 분기) — 이건 실패가 아니라 정상/동기화 필요다.
  if (kind === "instagram") {
    const minutes = cacheAgeMinutes(data);
    const ageText = relativeAgeText(minutes);
    // 방금 동기화된 경우("최신")까지 괄호로 덧붙이면 중복스러우니 그때는 "정상"만 표시한다.
    return {
      tone: "good",
      label: ageText && ageText !== "최신" ? `정상 (마지막 동기화 ${ageText})` : "정상",
      reason: "",
      action: "",
      actionHref: null
    };
  }
  if (kind === "meta") {
    const live = isLiveSource(data);
    return {
      tone: "good",
      label: "정상",
      reason: live === false ? cacheFreshnessLabel(data) : live === true ? "Live" : base.reason,
      action: "",
      actionHref: null
    };
  }
  const live = isLiveSource(data);
  if (live === false || data.source === "csv_required") {
    const minutes = cacheAgeMinutes(data);
    return {
      tone: "warn",
      label: minutes === null ? "동기화 필요" : "Cache",
      reason: base.reason,
      action: base.action,
      actionHref: base.actionHref
    };
  }
  return { tone: "good", label: "정상", reason: base.reason, action: base.action, actionHref: base.actionHref };
}

// Reference UI status-banner language: Overview/Advertising/Sales all answer
// "지금 데이터를 믿어도 되는가" with the exact same visual grammar (dot +
// bold label + muted note, reusing .ad-status-banner). Overview needs 3
// source rows (Instagram/Meta/Cafe24) instead of Advertising/Sales' single
// synthesized row, so it stacks 3 of the same banner instead of one.
function renderHealthBanner({ instagram = {}, meta = {}, cafe = {} } = {}) {
  const target = $("#apiHealthBanner");
  if (!target) return;
  target.classList.remove("loading");
  const rows = [
    ["Instagram", instagram, "instagram"],
    ["Meta Ads", meta, "meta"],
    ["Cafe24", cafe, "cafe24"]
  ];
  target.innerHTML = rows.map(([label, data, kind]) => {
    const state = healthBannerState(data, kind);
    const stamp = formatSyncStamp(data.syncedAt) || "동기화 기록 없음";
    const reasonText = [state.reason, stamp].filter(Boolean).join(" · ");
    // Cafe24 재인증 링크는 새 탭이 아니라 같은 탭에서 이동한다 — Cafe24 로그인/동의 화면을
    // 거친 뒤 서버가 "/"로 리다이렉트하므로, 같은 탭에서 그대로 대시보드로 돌아오게 하기 위함이다.
    // (2026-07-08 Cafe24 재인증 흐름 개선)
    const actionHtml = !state.action ? "" : state.actionHref
      ? `<a class="health-action" href="${esc(state.actionHref)}">${esc(state.action)}</a>`
      : `<span class="health-action" title="${esc(kind === "cafe24" ? "" : "META_ACCESS_TOKEN / .env에서 수동 갱신 필요")}">${esc(state.action)}</span>`;
    return `<div class="ad-status-banner ${esc(state.tone)}">
      <span class="status-dot"></span>
      <strong>${esc(label)} · ${esc(state.label)}</strong>
      <span class="note">${esc(reasonText)}</span>
      ${actionHtml}
    </div>`;
  }).join("");
}

function apiHealthCard({ title, ok, status, source, updatedAt, rows, detail }) {
  return `<article class="api-health-card ${ok ? "good" : "warn"}">
    <div class="api-health-head">
      <div><span>${esc(title)}</span><strong>${esc(status)}</strong></div>
      <em>${ok ? "정상" : "확인 필요"}</em>
    </div>
    <p>${esc(detail || "-")}</p>
    <dl>
      <div><dt>데이터 소스</dt><dd>${esc(source || "-")}</dd></div>
      <div><dt>마지막 동기화</dt><dd>${esc(updatedAt || "-")}</dd></div>
      ${(rows || []).map(([label, value]) => `<div><dt>${esc(label)}</dt><dd title="${esc(value)}">${esc(value)}</dd></div>`).join("")}
    </dl>
  </article>`;
}

function apiHealthActionCards() {
  return [
    ["지금 동기화", "현재 화면의 데이터를 다시 불러옵니다.", "", "refresh", false],
    // Cafe24 재인증은 같은 탭에서 이동해야 Cafe24 로그인/동의 후 서버가 "/"로 리다이렉트할 때
    // 같은 탭으로 돌아온다 — 새 탭(target="_blank")이면 새 탭에만 결과가 남는다.
    // (2026-07-08 Cafe24 재인증 흐름 개선)
    ["재인증 안내", "Cafe24 토큰 만료 시 OAuth 재인증을 시작합니다.", "/api/cafe24/oauth/start", "", false],
    ["상세 보기", "최근 진단 로그를 확인합니다.", "/api/diagnostics/logs", "", true]
  ].map(([title, note, href, action, newTab]) => `<article class="api-health-action">
    <strong>${esc(title)}</strong>
    <p>${esc(note)}</p>
    ${href ? `<a class="button secondary" href="${href}"${newTab ? ' target="_blank" rel="noreferrer"' : ""}>${esc(title)}</a>` : `<button class="button secondary" type="button" data-health-action="${esc(action)}"${apiHealthRefreshInFlight && action === "refresh" ? " disabled" : ""}>${esc(apiHealthRefreshInFlight && action === "refresh" ? "동기화 중..." : title)}</button>`}
  </article>`).join("");
}

async function renderAdvertising(data, renderSeq) {
  const briefingTarget = $("#adAiBriefing");
  const statusTarget = $("#adTodayStatus");
  const coreKpiTarget = $("#adCoreKpi");
  const summaryTarget = $("#advertisingSummary");
  const campaignTarget = $("#campaignPerformance");
  const contentTarget = $("#adOrganicContent");
  const tableTarget = $("#adPerformanceRows");
  const reconTarget = $("#adReconciliationSummary");
  const fullReportTargets = {
    active: $("#adFullReportActiveRows"),
    other: $("#adFullReportOtherRows")
  };
  bindAdFullReportToggles();
  if (!briefingTarget || !statusTarget || !coreKpiTarget || !summaryTarget || !campaignTarget || !contentTarget || !tableTarget || !reconTarget || !fullReportTargets.active || !fullReportTargets.other) return;
  hideAdOrganicSection();

  const range = operationsDateRange(data);
  const startDate = range.since;
  const endDate = range.until;
  renderAdLevelTabs();
  const [meta, fullReport, weightsResp, commerce] = await Promise.all([
    getSharedJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}&level=${activeAdLevel}`, 9000),
    getJson(`/api/meta-ads/full-report?since=${startDate}&until=${endDate}`, 12000),
    getJson("/api/meta-ads/score-weights", 5000),
    getSharedJson(`/api/diagnostics/brand-sales?since=${startDate}&until=${endDate}`, 9000)
  ]);
  if (renderSeq !== undefined && renderSeq !== operationsRenderSeq) return;
  const scoreWeights = weightsResp.weights || {};
  const posts = data.posts || [];
  const adPosts = posts.filter((post) => Number(post.adSpend || 0));
  const organicPosts = posts.filter((post) => !Number(post.adSpend || 0));
  logAdExecutionDebug(fullReport, data.month);

  if (meta.error) {
    const status = statusTextForError(meta);
    const badge = metaAdsSourceBadge(meta);
    briefingTarget.innerHTML = `<article class="action-item"><strong>브리핑 확인 불가</strong><p>Meta API 오류가 해결되면 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    statusTarget.className = "ad-status-banner error";
    statusTarget.innerHTML = `<span class="status-dot"></span><strong>${esc(badge.icon)} ${esc(badge.label)} · ${esc(status)}</strong><span class="note">${esc(startDate)} ~ ${esc(endDate)} · ${esc(meta.error)}</span>`;
    coreKpiTarget.innerHTML = `<article class="action-item"><strong>핵심 지표 확인 불가</strong><p>Meta API 오류가 해결되면 광고비 · ROAS · 실매출이 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    summaryTarget.innerHTML = [
      `<article class="action-item"><strong>Meta API 상태</strong><span>${esc(status)}</span><p>${esc(meta.error)}</p></article>`,
      `<article class="action-item"><strong>권한 오류 안내</strong><p>Meta API 권한 또는 토큰 권한이 막히면 광고 성과를 불러올 수 없습니다. Settings의 Meta Ads 연결 상태를 확인하세요. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`
    ].join("");
    campaignTarget.innerHTML = `<article class="action-item"><strong>캠페인별 성과</strong><p>Meta API 오류가 해결되면 캠페인 기준 성과가 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    tableTarget.innerHTML = `<tr><td colspan="11">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    reconTarget.innerHTML = `<article class="action-item"><strong>검증 불가</strong><p>Meta API 오류가 해결되면 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    fullReportTargets.active.innerHTML = `<tr><td colspan="18">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    fullReportTargets.other.innerHTML = "";
    const metaProductPerformanceSummaryTarget = $("#metaProductPerformanceSummary");
    const metaProductPerformanceRowsTarget = $("#metaProductPerformanceRows");
    if (metaProductPerformanceSummaryTarget) metaProductPerformanceSummaryTarget.innerHTML = `<article class="action-item"><strong>Meta Product Performance 확인 불가</strong><p>Meta API 오류가 해결되면 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    if (metaProductPerformanceRowsTarget) metaProductPerformanceRowsTarget.innerHTML = `<tr><td colspan="4">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    const metaBrandContributionSummaryTarget = $("#metaBrandContributionSummary");
    const metaBrandContributionRowsTarget = $("#metaBrandContributionRows");
    if (metaBrandContributionSummaryTarget) metaBrandContributionSummaryTarget.innerHTML = `<article class="action-item"><strong>Brand Contribution 확인 불가</strong><p>Meta API 오류가 해결되면 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    if (metaBrandContributionRowsTarget) metaBrandContributionRowsTarget.innerHTML = `<tr><td colspan="6">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    contentTarget.innerHTML = "";
    renderMarketingSummary({ meta, fullReport, commerce, adSpendShare: null, briefingTarget, reconTarget, periodLabel: `${startDate} ~ ${endDate}` });
    return;
  }

  const briefingCount = renderAdAiBriefing(fullReport, scoreWeights, briefingTarget);

  const totals = meta.totals || {};
  const tableSpend = Number(fullReport?.reconciliation?.tableSpend);
  const reportingSpend = Number.isFinite(tableSpend) ? tableSpend : Number(totals.spend || 0);
  const tablePurchaseValue = Number(fullReport?.reconciliation?.tablePurchaseValue);
  const reportingPurchaseValue = Number.isFinite(tablePurchaseValue) ? tablePurchaseValue : Number(totals.purchaseValue || 0);
  const purchaseValue = Number(totals.purchaseValue || 0);
  const roas = reportingSpend ? purchaseValue / reportingSpend : null;
  const commerceTotals = commerce?.totals || {};
  const commercePaidAmount = Number(commerceTotals.paidAmount || 0);
  const adSpendShare = commercePaidAmount > 0 ? reportingSpend / commercePaidAmount * 100 : null;
  const badge = metaAdsSourceBadge(meta);

  statusTarget.className = `ad-status-banner ${badge.tone}`;
  statusTarget.innerHTML = `<span class="status-dot"></span><strong>${esc(badge.icon)} ${esc(badge.label)}</strong><span class="note">${esc(startDate)} ~ ${esc(endDate)}${badge.detail ? " " + esc(badge.detail) : ""}</span>`;

  coreKpiTarget.innerHTML = [
    metaAdsSummaryCard("광고비", apiWon(reportingSpend), "선택 기간 집행 금액", true),
    metaAdsSummaryCard("ROAS", roas === null ? "-" : multiple(roas), "Meta 구매값 / 광고비", true),
    metaAdsSummaryCard("실제 매출(Commerce)", apiWon(commerceTotals.paidAmount), "Cafe24 canonical 기준", true),
    metaAdsSummaryCard("광고비 비중", adSpendShare === null ? "-" : pct(adSpendShare), "광고비 / 실제 매출", true)
  ].join("");

  summaryTarget.innerHTML = [
    metaAdsSummaryCard("노출", apiNum(totals.impressions), "광고가 표시된 횟수"),
    metaAdsSummaryCard("도달", apiNum(totals.reach), "광고를 본 계정 수"),
    metaAdsSummaryCard("클릭", apiNum(totals.clicks), "Meta 클릭 합계"),
    metaAdsSummaryCard("CTR", pct(Number(totals.ctr || 0) * 100), "클릭 / 노출"),
    metaAdsSummaryCard("CPC", apiWon(totals.cpc), "광고비 / 클릭"),
    metaAdsSummaryCard("CPM", apiWon(totals.cpm), "1,000회 노출 비용"),
    metaAdsSummaryCard("Meta 구매수", apiNum(totals.purchases || totals.metaPurchases), "Meta 기준 구매 이벤트"),
    metaAdsSummaryCard("Meta 구매값", apiWon(totals.purchaseValue), "Meta 기준 추정 구매값")
  ].join("");

  const rows = metaAdsRowsForLevel(meta)
    .sort((left, right) => Number(right.spend || 0) - Number(left.spend || 0))
    .slice(0, 6);
  campaignTarget.innerHTML = rows.length ? rows.map((campaign) => metaAdsPerformanceCard(campaign)).join("") : `<article class="action-item"><strong>${esc(metaAdsLevelLabel(activeAdLevel))} 데이터 없음</strong><p>선택 월에 표시할 Meta 광고 데이터가 없습니다.</p></article>`;

  tableTarget.innerHTML = renderMetaAdsRows(metaAdsRowsForLevel(meta));
  renderMetaAdsReconciliation(fullReport, reconTarget);
  renderMetaAdsFullReportGroups(fullReport, scoreWeights, fullReportTargets);
  renderMetaProductPerformance(startDate, endDate, renderSeq);
  renderMarketingSummary({ meta, fullReport, commerce, adSpendShare, briefingTarget, reconTarget, briefingCount, reportingSpend, reportingPurchaseValue, periodLabel: `${startDate} ~ ${endDate}` });
  contentTarget.innerHTML = "";
}

function campaignComparisonAddDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function campaignComparisonInclusiveDays(startDate, endDate) {
  return Math.floor((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1;
}

function campaignComparisonTodayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function campaignComparisonRate(delta, base) {
  if (base > 0) return pct(delta / base * 100);
  if (delta > 0) return "신규";
  return "-";
}

function campaignComparisonSignedWon(value) {
  const amount = Number(value || 0);
  if (amount > 0) return `+${apiWon(amount)}`;
  if (amount < 0) return `-${apiWon(Math.abs(amount))}`;
  return apiWon(0);
}

function campaignComparisonSignedNum(value) {
  const amount = Number(value || 0);
  if (amount > 0) return `+${apiNum(amount)}`;
  return apiNum(amount);
}

function campaignComparisonDeltaText(value, unit) {
  const amount = Number(value || 0);
  if (amount > 0) return `${apiNum(amount)}${unit} 증가`;
  if (amount < 0) return `${apiNum(Math.abs(amount))}${unit} 감소`;
  return `변화 없음`;
}

function campaignComparisonShortDate(dateKey = "") {
  const [, month, day] = String(dateKey).match(/^\d{4}-(\d{2})-(\d{2})$/) || [];
  return month && day ? `${Number(month)}/${day}` : dateKey;
}

function campaignComparisonIsValidDateKey(dateKey = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const date = new Date(`${dateKey}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateKey;
}

function campaignComparisonAutoRange(selectedCampaign = {}) {
  const executionStart = selectedCampaign.executionStart;
  const today = campaignComparisonTodayKey();
  const executionEnd = selectedCampaign.executionEnd && selectedCampaign.executionEnd < today ? selectedCampaign.executionEnd : today;
  return campaignComparisonRangeFromExecution(executionStart, executionEnd);
}

function campaignComparisonRangeFromExecution(executionStart, executionEnd) {
  const days = campaignComparisonInclusiveDays(executionStart, executionEnd);
  const comparisonEnd = campaignComparisonAddDays(executionStart, -1);
  const comparisonStart = campaignComparisonAddDays(comparisonEnd, -(days - 1));
  return { executionStart, executionEnd, comparisonStart, comparisonEnd, days };
}

function campaignComparisonPreviousMonth(monthKey = "") {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return "";
  const [year, month] = monthKey.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return previous.toISOString().slice(0, 7);
}

function campaignComparisonMonthLabel(monthKey = "") {
  const [, year, month] = String(monthKey).match(/^(\d{4})-(\d{2})$/) || [];
  if (!year || !month) return monthKey;
  const currentYear = campaignComparisonTodayKey().slice(0, 4);
  return year === currentYear ? `${Number(month)}월` : `${year}년 ${Number(month)}월`;
}

function campaignComparisonRangeLabel(startDate = "", endDate = "") {
  return `${startDate} ~ ${endDate}`;
}

function campaignComparisonMonthRange(monthKey = "") {
  const today = campaignComparisonTodayKey();
  if (!/^\d{4}-\d{2}$/.test(monthKey) || monthKey > today.slice(0, 7)) return null;
  const start = `${monthKey}-01`;
  const end = monthKey === today.slice(0, 7) ? today : monthEnd(monthKey);
  return { start, end };
}

function campaignComparisonDefaultMonths() {
  const target = selectedMonth().month || campaignComparisonTodayKey().slice(0, 7);
  const safeTarget = target > campaignComparisonTodayKey().slice(0, 7) ? campaignComparisonTodayKey().slice(0, 7) : target;
  return { base: campaignComparisonPreviousMonth(safeTarget), target: safeTarget };
}

function campaignComparisonValidateManualRange(startDate, endDate) {
  const today = campaignComparisonTodayKey();
  if (!campaignComparisonIsValidDateKey(startDate) || !campaignComparisonIsValidDateKey(endDate)) return "유효한 날짜를 선택해주세요.";
  if (startDate > endDate) return "시작일은 종료일보다 늦을 수 없습니다.";
  if (startDate > today || endDate > today) return "미래 날짜는 선택할 수 없습니다.";
  return "";
}

function campaignComparisonValidateMonthRange(baseMonth, targetMonth) {
  const todayMonth = campaignComparisonTodayKey().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(baseMonth) || !/^\d{4}-\d{2}$/.test(targetMonth)) return "유효한 월을 선택해주세요.";
  if (baseMonth > todayMonth || targetMonth > todayMonth) return "미래 월은 선택할 수 없습니다.";
  if (baseMonth === targetMonth) return "서로 다른 월을 선택해 주세요.";
  return "";
}

function campaignComparisonSettingsHtml(range) {
  if (!campaignPeriodComparisonState.settingsOpen) return "";
  const disabled = campaignPeriodComparisonState.loading ? " disabled" : "";
  const mode = campaignPeriodComparisonState.comparisonMode === "custom" ? "custom" : "month";
  const defaultMonths = campaignComparisonDefaultMonths();
  const baseMonth = campaignPeriodComparisonState.monthBase || defaultMonths.base;
  const targetMonth = campaignPeriodComparisonState.monthTarget || defaultMonths.target;
  const startValue = campaignPeriodComparisonState.manualRange?.executionStart || range.executionStart;
  const endValue = campaignPeriodComparisonState.manualRange?.executionEnd || range.executionEnd;
  const comparisonStartValue = campaignPeriodComparisonState.manualComparisonRange?.comparisonStart || range.comparisonStart;
  const comparisonEndValue = campaignPeriodComparisonState.manualComparisonRange?.comparisonEnd || range.comparisonEnd;
  const executionError = campaignComparisonValidateManualRange(startValue, endValue);
  const comparisonError = campaignComparisonValidateManualRange(comparisonStartValue, comparisonEndValue);
  const monthError = campaignComparisonValidateMonthRange(baseMonth, targetMonth);
  const executionDays = executionError ? 0 : campaignComparisonInclusiveDays(startValue, endValue);
  const comparisonDays = comparisonError ? 0 : campaignComparisonInclusiveDays(comparisonStartValue, comparisonEndValue);
  const mismatchNote = !executionError && !comparisonError && executionDays !== comparisonDays
    ? `두 기간의 길이가 다릅니다. 집행기간 ${apiNum(executionDays)}일 · 비교기간 ${apiNum(comparisonDays)}일`
    : "";
  const formNote = mode === "month"
    ? monthError || `${campaignComparisonMonthLabel(baseMonth)}에 비해 ${campaignComparisonMonthLabel(targetMonth)}이 어떻게 달라졌는지 비교합니다.`
    : executionError || comparisonError || mismatchNote || "비교 기준 기간과 비교 대상 기간의 실제 매출을 비교합니다.";
  return `<article class="campaign-period-settings">
    <div class="campaign-period-mode">
      <button class="button secondary${mode === "month" ? " active" : ""}" type="button" data-campaign-period-mode="month"${disabled}>월별 비교</button>
      <button class="button secondary${mode === "custom" ? " active" : ""}" type="button" data-campaign-period-mode="custom"${disabled}>직접 기간 선택</button>
    </div>
    ${mode === "month" ? `<div class="campaign-period-months">
      <label><span>비교 기준</span><input id="campaignBaseMonth" type="month" value="${esc(baseMonth)}" max="${esc(campaignComparisonTodayKey().slice(0, 7))}"></label>
      <span class="campaign-period-arrow">→</span>
      <label><span>비교 대상</span><input id="campaignTargetMonth" type="month" value="${esc(targetMonth)}" max="${esc(campaignComparisonTodayKey().slice(0, 7))}"></label>
    </div>` : `<div class="campaign-period-setting-row">
      <label><span>비교 기준 기간</span><input id="campaignComparisonSince" type="date" value="${esc(comparisonStartValue)}" max="${esc(campaignComparisonTodayKey())}"></label>
      <span class="campaign-period-tilde">~</span>
      <label><span>종료일</span><input id="campaignComparisonUntil" type="date" value="${esc(comparisonEndValue)}" max="${esc(campaignComparisonTodayKey())}"></label>
    </div>
    <div class="campaign-period-preview">
      <span>비교 대상 기간</span>
      <div class="campaign-period-setting-row">
        <label><span>시작일</span><input id="campaignPeriodSince" type="date" value="${esc(startValue)}" max="${esc(campaignComparisonTodayKey())}"></label>
        <span class="campaign-period-tilde">~</span>
        <label><span>종료일</span><input id="campaignPeriodUntil" type="date" value="${esc(endValue)}" max="${esc(campaignComparisonTodayKey())}"></label>
      </div>
      <em id="campaignPeriodPreviewNote">${executionError || comparisonError ? esc(executionError || comparisonError) : `비교 기준 ${apiNum(comparisonDays)}일 · 비교 대상 ${apiNum(executionDays)}일`}</em>
    </div>`}
    <div class="campaign-period-actions">
      <button class="button secondary" type="button" data-campaign-period-apply${disabled}>${campaignPeriodComparisonState.loading ? "적용 중..." : mode === "month" ? "비교하기" : "적용"}</button>
      ${mode === "custom" ? `<button class="button secondary" type="button" data-campaign-period-sync-comparison${disabled}>비교 기준을 직전 동일 기간으로 설정</button>` : ""}
    </div>
    <p id="campaignPeriodFormError" class="hint-text">${esc(formNote)}</p>
  </article>`;
}

function campaignComparisonLoadingHtml(executionStart, executionEnd, comparisonStart, comparisonEnd) {
  return `<article class="campaign-period-loading" aria-busy="true">
    <div>
      <strong>기간 비교 계산 중</strong>
      <p>${esc(executionStart)} ~ ${esc(executionEnd)}와 ${esc(comparisonStart)} ~ ${esc(comparisonEnd)}의 Cafe24 브랜드 매출을 불러오고 있습니다.</p>
    </div>
    <span></span>
  </article>`;
}

function campaignComparisonPaintFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 16);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function campaignComparisonWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function updateCampaignPeriodPreview() {
  if ((campaignPeriodComparisonState.comparisonMode || "month") === "month") {
    const baseMonth = $("#campaignBaseMonth")?.value || "";
    const targetMonth = $("#campaignTargetMonth")?.value || "";
    const errorTarget = $("#campaignPeriodFormError");
    if (!errorTarget) return;
    const error = campaignComparisonValidateMonthRange(baseMonth, targetMonth);
    errorTarget.textContent = error || `${campaignComparisonMonthLabel(baseMonth)}에 비해 ${campaignComparisonMonthLabel(targetMonth)}이 어떻게 달라졌는지 비교합니다.`;
    return;
  }
  const since = $("#campaignPeriodSince")?.value || "";
  const until = $("#campaignPeriodUntil")?.value || "";
  const comparisonSince = $("#campaignComparisonSince")?.value || "";
  const comparisonUntil = $("#campaignComparisonUntil")?.value || "";
  const noteTarget = $("#campaignPeriodPreviewNote");
  const errorTarget = $("#campaignPeriodFormError");
  if (!noteTarget || !errorTarget) return;
  const executionError = campaignComparisonValidateManualRange(since, until);
  const comparisonError = campaignComparisonValidateManualRange(comparisonSince, comparisonUntil);
  if (executionError || comparisonError) {
    noteTarget.textContent = executionError || comparisonError;
    errorTarget.textContent = executionError || comparisonError;
    return;
  }
  const executionDays = campaignComparisonInclusiveDays(since, until);
  const comparisonDays = campaignComparisonInclusiveDays(comparisonSince, comparisonUntil);
  noteTarget.textContent = `비교 기준 ${apiNum(comparisonDays)}일 · 비교 대상 ${apiNum(executionDays)}일`;
  if (executionDays !== comparisonDays) {
    errorTarget.textContent = `두 기간의 길이가 다릅니다. 비교 기준 ${apiNum(comparisonDays)}일 · 비교 대상 ${apiNum(executionDays)}일`;
    return;
  }
  errorTarget.textContent = "기준 캠페인은 그대로 유지하고 Cafe24 비교 기간만 바꿉니다.";
}

function campaignComparisonTopCard(title, rows = []) {
  return `<article class="campaign-period-rank"><strong>${esc(title)}</strong>${rows.length ? `<ol>${rows.slice(0, 3).map((row, index) => `<li><mark>${index + 1}</mark><strong>${esc(row.brandName)}</strong><em>${esc(campaignComparisonSignedWon(row.salesDelta))}</em></li>`).join("")}</ol>` : `<p>표시할 브랜드가 없습니다.</p>`}</article>`;
}

function campaignComparisonMetaCard(title, baseValue, targetValue, deltaValue, formatter = apiWon) {
  const hasValues = Number.isFinite(baseValue) && Number.isFinite(targetValue) && Number.isFinite(deltaValue);
  return `<article class="action-item"><span>${esc(title)}</span><strong>${hasValues ? esc(campaignComparisonSignedWon(deltaValue)) : "-"}</strong><p>${hasValues ? `${esc(formatter(baseValue))} → ${esc(formatter(targetValue))}` : "Meta 데이터 확인 필요"}</p></article>`;
}

async function renderCampaignPeriodComparison(target, renderSeq) {
  if (!target) return;
  const defaultMonths = campaignComparisonDefaultMonths();
  const defaultBaseRange = campaignComparisonMonthRange(defaultMonths.base);
  const defaultTargetRange = campaignComparisonMonthRange(defaultMonths.target);
  const autoRange = {
    executionStart: defaultTargetRange?.start || campaignComparisonTodayKey(),
    executionEnd: defaultTargetRange?.end || campaignComparisonTodayKey(),
    comparisonStart: defaultBaseRange?.start || campaignComparisonTodayKey(),
    comparisonEnd: defaultBaseRange?.end || campaignComparisonTodayKey()
  };
  target.innerHTML = `<article class="action-item"><strong>기간 비교 계산 중</strong><p>Cafe24 실제 매출 기준으로 기준 기간과 대상 기간을 비교합니다.</p></article>`;
  const mode = campaignPeriodComparisonState.comparisonMode === "custom" ? "custom" : "month";
  const baseMonth = campaignPeriodComparisonState.monthBase || defaultMonths.base;
  const targetMonth = campaignPeriodComparisonState.monthTarget || defaultMonths.target;
  let executionRange;
  let comparisonRange;
  let baseLabel = campaignComparisonRangeLabel(autoRange.comparisonStart, autoRange.comparisonEnd);
  let targetLabel = campaignComparisonRangeLabel(autoRange.executionStart, autoRange.executionEnd);
  let rangeModeLabel = "월별 비교";
  if (mode === "month") {
    const monthError = campaignComparisonValidateMonthRange(baseMonth, targetMonth);
    const baseMonthRange = campaignComparisonMonthRange(baseMonth);
    const targetMonthRange = campaignComparisonMonthRange(targetMonth);
    if (monthError || !baseMonthRange || !targetMonthRange) {
      target.innerHTML = [
        campaignComparisonSettingsHtml(autoRange),
        `<article class="action-item"><strong>기간 비교 확인 불가</strong><p>${esc(monthError || "유효한 월을 선택해주세요.")} 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`
      ].join("");
      return;
    }
    executionRange = { executionStart: targetMonthRange.start, executionEnd: targetMonthRange.end };
    comparisonRange = { comparisonStart: baseMonthRange.start, comparisonEnd: baseMonthRange.end };
    baseLabel = campaignComparisonMonthLabel(baseMonth);
    targetLabel = campaignComparisonMonthLabel(targetMonth);
    rangeModeLabel = "월별 비교";
  } else {
    const manualRange = campaignPeriodComparisonState.manualRange;
    const manualComparisonRange = campaignPeriodComparisonState.manualComparisonRange;
    executionRange = manualRange ? { executionStart: manualRange.executionStart, executionEnd: manualRange.executionEnd } : { executionStart: autoRange.executionStart, executionEnd: autoRange.executionEnd };
    const autoComparison = campaignComparisonRangeFromExecution(executionRange.executionStart, executionRange.executionEnd);
    comparisonRange = manualComparisonRange || { comparisonStart: autoComparison.comparisonStart, comparisonEnd: autoComparison.comparisonEnd };
    baseLabel = campaignComparisonRangeLabel(comparisonRange.comparisonStart, comparisonRange.comparisonEnd);
    targetLabel = campaignComparisonRangeLabel(executionRange.executionStart, executionRange.executionEnd);
    rangeModeLabel = "직접 선택";
  }
  const range = {
    executionStart: executionRange.executionStart,
    executionEnd: executionRange.executionEnd,
    comparisonStart: comparisonRange.comparisonStart,
    comparisonEnd: comparisonRange.comparisonEnd
  };
  const { executionStart, executionEnd, comparisonStart, comparisonEnd } = range;
  const executionDays = campaignComparisonInclusiveDays(executionStart, executionEnd);
  const comparisonDays = campaignComparisonInclusiveDays(comparisonStart, comparisonEnd);

  campaignPeriodComparisonState.loading = true;
  const loadingStartedAt = Date.now();
  target.innerHTML = [
    campaignComparisonSettingsHtml(range),
    campaignComparisonLoadingHtml(executionStart, executionEnd, comparisonStart, comparisonEnd)
  ].join("");
  await campaignComparisonPaintFrame();

  let execution;
  let comparison;
  let executionMeta = null;
  let comparisonMeta = null;
  try {
    const [executionResult, comparisonResult, executionMetaResult, comparisonMetaResult] = await Promise.allSettled([
      getSharedJson(`/api/diagnostics/brand-sales?since=${executionStart}&until=${executionEnd}`, 15000),
      getSharedJson(`/api/diagnostics/brand-sales?since=${comparisonStart}&until=${comparisonEnd}`, 15000),
      getSharedJson(`/api/meta-ads/summary?since=${executionStart}&until=${executionEnd}`, 9000),
      getSharedJson(`/api/meta-ads/summary?since=${comparisonStart}&until=${comparisonEnd}`, 9000)
    ]);
    if (renderSeq !== undefined && renderSeq !== operationsRenderSeq) return;
    execution = executionResult.status === "fulfilled" ? executionResult.value : { error: executionResult.reason?.message || "실행 기간 데이터 오류" };
    comparison = comparisonResult.status === "fulfilled" ? comparisonResult.value : { error: comparisonResult.reason?.message || "비교 기간 데이터 오류" };
    executionMeta = executionMetaResult.status === "fulfilled" && !executionMetaResult.value?.error ? executionMetaResult.value : null;
    comparisonMeta = comparisonMetaResult.status === "fulfilled" && !comparisonMetaResult.value?.error ? comparisonMetaResult.value : null;
  } finally {
    await campaignComparisonWait(350 - (Date.now() - loadingStartedAt));
    if (renderSeq === undefined || renderSeq === operationsRenderSeq) {
      campaignPeriodComparisonState.loading = false;
    }
  }
  if (execution.error || comparison.error) {
    target.innerHTML = `<article class="action-item"><strong>기간 비교 확인 불가</strong><p>일부 데이터를 불러오지 못해 기간 비교를 표시할 수 없습니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    return;
  }
  if (execution.source === "csv_required" || comparison.source === "csv_required") {
    target.innerHTML = `<article class="action-item"><strong>기간 비교 준비 필요</strong><p>비교 기간의 Cafe24 데이터가 아직 준비되지 않았습니다. 과거 데이터 CSV 업로드가 필요할 수 있습니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    return;
  }
  if (!Array.isArray(execution.brands) || !Array.isArray(comparison.brands) || (!execution.brands.length && !comparison.brands.length)) {
    target.innerHTML = `<article class="action-item"><strong>브랜드 매출 데이터 없음</strong><p>비교 대상 기간에 브랜드 매출 데이터가 없습니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    return;
  }

  const executionMap = new Map(execution.brands.map((row) => [row.brand_code || "UNASSIGNED", row]));
  const comparisonMap = new Map(comparison.brands.map((row) => [row.brand_code || "UNASSIGNED", row]));
  const brandRows = [...new Set([...executionMap.keys(), ...comparisonMap.keys()])].map((code) => {
    const current = executionMap.get(code) || {};
    const previous = comparisonMap.get(code) || {};
    const currentSales = Number(current.salesAmount || 0);
    const previousSales = Number(previous.salesAmount || 0);
    return {
      brandCode: code,
      brandName: current.brand_name || previous.brand_name || code,
      salesDelta: currentSales - previousSales,
      orderDelta: Number(current.orderCount || 0) - Number(previous.orderCount || 0),
      quantityDelta: Number(current.quantitySold || 0) - Number(previous.quantitySold || 0)
    };
  }).filter((row) => !isExcludedCommerceBrandPerformanceCode(row.brandCode) && (row.salesDelta || row.orderDelta || row.quantityDelta));
  const increaseTop = brandRows.filter((row) => row.salesDelta > 0).sort((left, right) => right.salesDelta - left.salesDelta).slice(0, 5);
  const decreaseTop = brandRows.filter((row) => row.salesDelta < 0).sort((left, right) => left.salesDelta - right.salesDelta).slice(0, 5);
  const executionTotals = execution.totals || {};
  const comparisonTotals = comparison.totals || {};
  const salesDelta = Number(executionTotals.salesAmount || 0) - Number(comparisonTotals.salesAmount || 0);
  const orderDelta = Number(executionTotals.orderCount || 0) - Number(comparisonTotals.orderCount || 0);
  const quantityDelta = Number(executionTotals.quantitySold || 0) - Number(comparisonTotals.quantitySold || 0);
  const salesTone = salesDelta > 0 ? "good" : salesDelta < 0 ? "urgent" : "neutral";
  const salesDirection = salesDelta > 0 ? "증가" : salesDelta < 0 ? "감소" : "변화 없음";
  const comparisonSales = Number(comparisonTotals.salesAmount || 0);
  const executionSales = Number(executionTotals.salesAmount || 0);
  const salesNarrative = `${baseLabel}에 비해 ${targetLabel} 매출이 ${campaignComparisonRate(salesDelta, comparisonSales)} ${salesDirection}했습니다.`;
  const executionMetaTotals = executionMeta?.totals || {};
  const comparisonMetaTotals = comparisonMeta?.totals || {};
  const basePaidAmount = hasApiValue(comparisonTotals.paidAmount) ? Number(comparisonTotals.paidAmount) : null;
  const targetPaidAmount = hasApiValue(executionTotals.paidAmount) ? Number(executionTotals.paidAmount) : null;
  const baseSpend = hasApiValue(comparisonMetaTotals.spend) ? Number(comparisonMetaTotals.spend) : null;
  const targetSpend = hasApiValue(executionMetaTotals.spend) ? Number(executionMetaTotals.spend) : null;
  const basePurchaseValue = hasApiValue(comparisonMetaTotals.purchaseValue) ? Number(comparisonMetaTotals.purchaseValue) : null;
  const targetPurchaseValue = hasApiValue(executionMetaTotals.purchaseValue) ? Number(executionMetaTotals.purchaseValue) : null;
  const baseGap = Number.isFinite(basePurchaseValue) && Number.isFinite(basePaidAmount) ? basePurchaseValue - basePaidAmount : null;
  const targetGap = Number.isFinite(targetPurchaseValue) && Number.isFinite(targetPaidAmount) ? targetPurchaseValue - targetPaidAmount : null;

  target.innerHTML = [
    campaignComparisonSettingsHtml(range),
    `<article class="campaign-period-hero ${esc(salesTone)}">
      <div class="campaign-period-result">
        <span>매출</span>
        <strong>${esc(campaignComparisonRate(salesDelta, comparisonSales))}</strong>
        <p>${esc(salesNarrative)}</p>
        <em>${apiWon(comparisonSales)} → ${apiWon(executionSales)}</em>
      </div>
      <div class="campaign-period-window">
        <div><span>비교 기준</span><strong>${esc(campaignComparisonShortDate(comparisonStart))} ~ ${esc(campaignComparisonShortDate(comparisonEnd))}</strong></div>
        <div><span>비교 대상</span><strong>${esc(campaignComparisonShortDate(executionStart))} ~ ${esc(campaignComparisonShortDate(executionEnd))}</strong></div>
      </div>
      <div class="campaign-period-delta">
        <strong>${esc(campaignComparisonSignedWon(salesDelta))}</strong>
        <span>${esc(salesDirection)} 금액</span>
      </div>
    </article>`,
    `<div class="campaign-period-kpis">
      <article class="action-item"><span>주문수</span><strong>${apiNum(comparisonTotals.orderCount)} → ${apiNum(executionTotals.orderCount)}</strong><p>${esc(campaignComparisonDeltaText(orderDelta, "건"))}</p></article>
      <article class="action-item"><span>판매수량</span><strong>${apiNum(comparisonTotals.quantitySold)} → ${apiNum(executionTotals.quantitySold)}</strong><p>${esc(campaignComparisonDeltaText(quantityDelta, "개"))}</p></article>
      ${campaignComparisonMetaCard("광고비 변화", baseSpend, targetSpend, Number.isFinite(baseSpend) && Number.isFinite(targetSpend) ? targetSpend - baseSpend : null)}
      ${campaignComparisonMetaCard("Meta 추정 구매값 변화", basePurchaseValue, targetPurchaseValue, Number.isFinite(basePurchaseValue) && Number.isFinite(targetPurchaseValue) ? targetPurchaseValue - basePurchaseValue : null)}
      ${campaignComparisonMetaCard("Meta ↔ Cafe24 차이 변화", baseGap, targetGap, Number.isFinite(baseGap) && Number.isFinite(targetGap) ? targetGap - baseGap : null)}
    </div>`,
    `<div class="campaign-period-ranks">${campaignComparisonTopCard(`${baseLabel}에 비해 가장 많이 증가한 브랜드 TOP 3`, increaseTop)}${campaignComparisonTopCard(`${baseLabel}에 비해 가장 많이 감소한 브랜드 TOP 3`, decreaseTop)}</div>`,
    `<article class="campaign-period-meta">
      <span>기간 기준</span><strong>${esc(rangeModeLabel)}</strong>
      <span>비교 대상</span><strong>${esc(executionStart)} ~ ${esc(executionEnd)} (${apiNum(executionDays)}일)</strong>
      <span>비교 기준</span><strong>${esc(comparisonStart)} ~ ${esc(comparisonEnd)} (${apiNum(comparisonDays)}일)</strong>
    </article>`,
    `<p class="hint-text">이 데이터는 Cafe24 실제 매출과 Meta 자체 추정값의 기간 비교입니다. Meta ↔ Cafe24 차이는 같은 기간·다른 집계 기준 비교이며, 광고와 매출의 인과관계를 의미하지 않습니다.</p>`
  ].join("");
}

function renderMarketingSummary({ meta = {}, fullReport = {}, commerce = {}, adSpendShare = null, briefingTarget = null, reconTarget = null, briefingCount = null, reportingSpend = null, reportingPurchaseValue = null, periodLabel = "" } = {}) {
  const heroTarget = $("#marketingSummaryHero");
  const briefingSummaryTarget = $("#marketingSummaryBriefing");
  const statusSummaryTarget = $("#marketingSummaryStatus");
  if (!heroTarget || !briefingSummaryTarget || !statusSummaryTarget) return;

  const commerceTotals = commerce?.totals || {};
  const spend = reportingSpend === null || reportingSpend === undefined ? Number(meta.totals?.spend || 0) : Number(reportingSpend || 0);
  const purchaseValue = reportingPurchaseValue === null || reportingPurchaseValue === undefined ? Number(meta.totals?.purchaseValue || 0) : Number(reportingPurchaseValue || 0);
  const paidAmount = Number(commerceTotals.paidAmount || 0);
  const purchaseCommerceDiff = purchaseValue - paidAmount;
  heroTarget.innerHTML = [
    metaAdsSummaryCard("광고비 / 실제 매출", adSpendShare === null ? "-" : pct(adSpendShare), "기존 Advertising 계산값", true),
    metaAdsSummaryCard("광고비", apiWon(spend), "Meta Ads 기준", true),
    metaAdsSummaryCard("Meta 추정 구매값", apiWon(purchaseValue), "Meta 자체 귀속 기준", true),
    metaAdsSummaryCard("실제 매출", apiWon(paidAmount), "Commerce canonical 기준", true),
    metaAdsSummaryCard("Meta ↔ Cafe24 차이", campaignComparisonSignedWon(purchaseCommerceDiff), "같은 기간·다른 집계 기준 비교, 인과관계 아님", true)
  ].join("");

  const briefingCards = briefingTarget ? [...briefingTarget.querySelectorAll(".ad-ai-briefing-card")] : [];
  const totalBriefingCount = briefingCount === null || briefingCount === undefined ? briefingCards.length : Number(briefingCount || 0);
  const firstNarrative = briefingCards[0]?.querySelector(".ad-ai-briefing-narrative")?.textContent?.trim() || "관리 필요 캠페인이 확인되지 않았습니다.";
  renderTodaySummary({ marketing: { adSpendShare, briefingCount: totalBriefingCount, narrative: firstNarrative, reportingSpend: spend, reportingPurchaseValue: purchaseValue, periodLabel } });
  renderTodayOverviewCards();
  briefingSummaryTarget.innerHTML = [
    salesCompareCard("관리 필요 캠페인", `${apiNum(totalBriefingCount)}건`, "관리가 필요한 순서로 표시됩니다.")
  ].join("");

  const groups = { active: [], other: [] };
  if (!fullReport.error) {
    (fullReport.rows || []).forEach((row) => groups[metaAdsStatusGroup(row)].push(row));
  }
  const reconciliationText = reconTarget?.textContent || "";
  const reconciliationLabel = fullReport.error ? "검증 불가" : reconciliationText.includes("차이 발생") ? "차이 발생" : reconciliationText.includes("일치") ? "일치" : "확인 필요";
  const unlistedCount = Number(fullReport.reconciliation?.unlistedCampaignCount || 0);
  statusSummaryTarget.innerHTML = [
    salesCompareCard("조회 기간", periodLabel || "-", "Marketing Summary 기준"),
    salesCompareCard("집행", `${apiNum(groups.active.length)}건`, "기존 full report 그룹 기준"),
    salesCompareCard("미집행", `${apiNum(groups.other.length)}건`, "기존 full report 그룹 기준"),
    salesCompareCard("누락", `${apiNum(unlistedCount)}건`, "기존 reconciliation 기준"),
    salesCompareCard("일치 검증", reconciliationLabel, "기존 reconciliation 판정 결과")
  ].join("");
}

function hideAdOrganicSection() {
  const block = $("#adOrganicContent")?.closest(".section-block");
  if (block) block.hidden = true;
}

function metaAdsSummaryCard(label, value, note, emphasize = false) {
  return `<article class="action-item ad-summary-card${emphasize ? " ad-core-kpi-card" : ""}">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
    <p>${esc(note)}</p>
  </article>`;
}

function metaAdsPerformanceCard(row = {}) {
  return `<article class="action-item ad-performance-card">
    <strong title="${esc(metaAdsRowName(row))}">${esc(metaAdsRowName(row))}</strong>
    <span>${apiWon(row.spend)}</span>
    <div class="ad-card-metrics">
      ${metaAdsMiniMetric("노출", apiNum(row.impressions))}
      ${metaAdsMiniMetric("도달", apiNum(row.reach))}
      ${metaAdsMiniMetric("클릭", apiNum(row.clicks))}
      ${metaAdsMiniMetric("CTR", pct(Number(row.ctr || 0) * 100))}
      ${metaAdsMiniMetric("CPC", apiWon(row.cpc))}
      ${metaAdsMiniMetric("ROAS", row.roas === null ? "-" : multiple(row.roas || row.metaRoas))}
    </div>
  </article>`;
}

function metaAdsMiniMetric(label, value) {
  return `<em><small>${esc(label)}</small><b>${esc(value)}</b></em>`;
}

function renderAdLevelTabs() {
  $$("[data-ad-level]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adLevel === activeAdLevel);
  });
}

function metaAdsRowsForLevel(meta = {}) {
  if (Array.isArray(meta.rows) && meta.rows.length) return meta.rows;
  if (activeAdLevel === "ad") return meta.ads || [];
  if (activeAdLevel === "adset") return meta.adsets || [];
  return meta.campaigns || [];
}

function metaAdsLevelLabel(level) {
  return { campaign: "캠페인", adset: "광고세트", ad: "광고" }[level] || "캠페인";
}

function metaAdsRowName(row = {}) {
  if (activeAdLevel === "ad") return row.adName || row.adId || row.label || "광고";
  if (activeAdLevel === "adset") return row.adsetName || row.adsetId || row.label || "광고세트";
  return row.campaignName || row.campaignId || row.label || "캠페인";
}

function renderMetaAdsRows(rows = []) {
  return rows.length ? rows
    .sort((left, right) => Number(right.spend || 0) - Number(left.spend || 0))
    .map((row) => (
      `<tr>
        <td class="ad-name-cell" title="${esc(metaAdsRowName(row))}">${esc(metaAdsRowName(row))}</td>
        <td>${apiWon(row.spend)}</td>
        <td>${apiNum(row.impressions)}</td>
        <td>${apiNum(row.reach)}</td>
        <td>${apiNum(row.clicks)}</td>
        <td>${pct(Number(row.ctr || 0) * 100)}</td>
        <td>${apiWon(row.cpc)}</td>
        <td>${apiWon(row.cpm)}</td>
        <td>${apiNum(row.purchases || row.metaPurchases)}</td>
        <td>${apiWon(row.purchaseValue || row.metaPurchaseValue)}</td>
        <td>${row.roas === null ? "-" : multiple(row.roas || row.metaRoas)}</td>
      </tr>`
    )).join("") : `<tr><td colspan="11">선택 월에 표시할 Meta 광고 데이터가 없습니다.</td></tr>`;
}

const META_OBJECTIVE_LABEL = {
  sales: "Sales",
  traffic: "Traffic",
  engagement: "Engagement",
  video: "Video",
  awareness: "Awareness",
  unknown: "확인 필요"
};

function metaAdsObjectiveLabel(row = {}) {
  return META_OBJECTIVE_LABEL[row.objective] || "확인 필요";
}

// AI Reason: "중지 검토" 같은 태그가 아니라 마케팅 팀장이 코멘트하듯 자연스러운 한두 문장으로
// 근거를 설명합니다. Objective마다 보는 지표가 다르고, 같은 지표라도 다른 지표와 조합되면
// 결론이 달라집니다(예: CTR은 좋아도 Frequency가 높으면 피로도 경고로 바뀝니다).
function metaAdsNarrative(row = {}) {
  const objective = row.objective || "unknown";
  const impressions = Number(row.impressions || 0);
  const frequency = Number(row.frequency || 0);
  const suffix = " Meta 자체 귀속 지표 기준, Commerce 매출 미반영";

  if (objective === "sales") {
    const purchases = Number(row.purchases || 0);
    const roas = Number(row.roas || 0);
    if (purchases <= 0) return `Meta 기준 구매 전환이 아직 확인되지 않았습니다.${suffix}`;
    if (roas >= 8) return `Meta 기준 ROAS가 높게 집계되고 있습니다.${suffix}`;
    if (roas >= 3) return `Meta 기준 구매 성과가 확인되고 있습니다.${suffix}`;
    if (roas >= 1) return `Meta 기준 구매 효율이 낮게 집계되고 있습니다.${suffix}`;
    return `Meta 기준 구매 효율이 매우 낮게 집계되고 있습니다.${suffix}`;
  }

  if (objective === "traffic") {
    const ctr = Number(row.ctr || 0);
    if (ctr >= 0.02 && frequency > 3.5) return `CTR은 높지만 Frequency도 높게 집계되어 추가 확인이 필요합니다.${suffix}`;
    if (ctr >= 0.02) return `CTR이 높게 집계되고 있습니다.${suffix}`;
    if (ctr >= 0.01) return `CTR이 보통 수준으로 집계되고 있습니다.${suffix}`;
    return `CTR이 낮게 집계되고 있어 추가 확인이 필요합니다.${suffix}`;
  }

  if (objective === "engagement") {
    const rate = impressions ? Number(row.postEngagement || 0) / impressions : 0;
    if (rate >= 0.05) return `참여율이 높게 집계되고 있습니다.${suffix}`;
    if (rate >= 0.02) return `참여율이 보통 수준으로 집계되고 있습니다.${suffix}`;
    return `참여율이 낮게 집계되어 추가 확인이 필요합니다.${suffix}`;
  }

  if (objective === "video") {
    const videoViews = Number(row.videoViews || 0);
    if (!videoViews) return `Video 조회 데이터가 아직 확인되지 않았습니다.${suffix}`;
    const completionRate = Number(row.videoCompletion || 0) / videoViews;
    if (completionRate >= 0.3) return `완주율이 높게 집계되고 있습니다.${suffix}`;
    if (completionRate >= 0.15) return `완주율이 보통 수준으로 집계되고 있습니다.${suffix}`;
    return `완주율이 낮게 집계되어 추가 확인이 필요합니다.${suffix}`;
  }

  if (objective === "awareness") {
    const cpm = Number(row.cpm || 0);
    if (frequency > 4) return `Frequency가 높게 집계되어 추가 확인이 필요합니다.${suffix}`;
    if (cpm > 12000) return `CPM이 높게 집계되어 노출 효율 추가 확인이 필요합니다.${suffix}`;
    return `Reach가 안정적으로 집계되고 있습니다.${suffix}`;
  }

  return `Objective 정보를 확인할 수 없어 추가 확인이 필요합니다.${suffix}`;
}

// 표에서 보여줄 핵심 지표 한 줄(스캔용). 문장형 근거(metaAdsNarrative)와 함께 씁니다.
function metaAdsKeyMetricLine(row = {}) {
  const objective = row.objective || "unknown";
  if (objective === "sales") return `ROAS ${row.roas === null ? "-" : multiple(row.roas)} · 구매 ${apiNum(row.purchases)}건`;
  if (objective === "traffic") return `CTR ${pct(Number(row.ctr || 0) * 100)} · CPC ${apiWon(row.cpc)}`;
  if (objective === "engagement") return `참여율 ${pct((Number(row.impressions || 0) ? Number(row.postEngagement || 0) / Number(row.impressions || 0) : 0) * 100)}`;
  if (objective === "video") return `완주율 ${pct((Number(row.videoViews || 0) ? Number(row.videoCompletion || 0) / Number(row.videoViews || 0) : 0) * 100)}`;
  if (objective === "awareness") return `Frequency ${Number(row.frequency || 0).toFixed(1)} · Reach ${apiNum(row.reach)}`;
  return "";
}

// 내부 decision label을 사용자에게 보이는 중립 상태 문구로 바꿉니다.
function metaAdsDecisionActionText(label) {
  const map = {
    확대: "Meta 성과 높음",
    유지: "Meta 성과 안정",
    관찰: "Meta 성과 보통",
    점검: "Meta 성과 낮음",
    중지: "Meta 성과 매우 낮음"
  };
  return map[label] || label;
}

// "이번 기간에 실제로 집행되었는지"를 Meta Ads Manager와 동일한 기준(광고비/노출/도달 중
// 하나라도 0보다 큼)으로 판단합니다. 캠페인의 계정 상태(진행중/종료/초안)는 선택한 기간에
// 실제로 돈이 나갔는지와 다를 수 있어(예: 이번 달엔 멈췄지만 상태는 "진행중"), Marketing
// Director는 상태가 아니라 이 실행 여부를 기본 표시 기준으로 삼습니다.
function metaAdsIsExecuted(row = {}) {
  return Number(row.spend || 0) > 0 || Number(row.impressions || 0) > 0 || Number(row.reach || 0) > 0;
}

// 캠페인 전체 표를 집행 / 미집행 2그룹으로 나눕니다.
// 기본 화면은 이번 기간에 실제로 운영된 광고만 보는 것이 목적이라, 미집행 캠페인은 하나로
// 묶어 접어둡니다. 기간을 바꾸면 이 판단도 그 기간의 데이터로 다시 계산됩니다.
function metaAdsStatusGroup(row) {
  return metaAdsIsExecuted(row) ? "active" : "other";
}

// 특정 캠페인이 왜 이번 달 "집행 캠페인"에 보이는지/안 보이는지를 콘솔에서 바로 확인할 수 있게
// 해주는 디버그 로그입니다. 상태(진행중 등)·생성일·이름은 판단에 전혀 쓰지 않고, 오직 선택한
// 기간의 Insights 값(spend/impressions/reach)만으로 isVisible을 계산합니다.
function logAdExecutionDebug(fullReport = {}, month) {
  const rows = fullReport.rows || [];
  const debugRows = rows.map((row) => {
    const isVisible = metaAdsIsExecuted(row);
    return {
      campaign_name: row.campaignName,
      selected_month: month,
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      reach: Number(row.reach || 0),
      isVisible,
      hideReason: isVisible ? "" : "이 기간 spend/impressions/reach가 모두 0 (status/생성일/이름은 판단에 사용 안 함)"
    };
  });
  console.groupCollapsed(`[Ad Execution Debug] ${month} · 캠페인 ${debugRows.length}개 (집행 ${debugRows.filter((r) => r.isVisible).length}개 / 미집행 ${debugRows.filter((r) => !r.isVisible).length}개)`);
  if (console.table) console.table(debugRows);
  else debugRows.forEach((r) => console.log(r));
  console.groupEnd();
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Objective별 factor를 0~100으로 정규화하는 기준선(벤치마크)입니다. Settings에서 바꿀 수 있는
// 것은 이 factor들 사이의 "가중치"이고, 정규화 기준선 자체는 코드에 고정되어 있습니다
// (계정 성과가 쌓이면 조정이 필요할 수 있습니다).
const SCORE_FACTOR_FNS = {
  sales: {
    roas: (row) => {
      const purchases = Number(row.purchases || 0);
      const roas = Number(row.roas || 0);
      if (!purchases) return 0;
      if (roas < 3) return clampScore(10 + (roas / 3) * 40);
      if (roas < 8) return clampScore(50 + ((roas - 3) / 5) * 40);
      return clampScore(90 + Math.min(10, ((roas - 8) / 8) * 10));
    },
    purchase: (row) => clampScore((Number(row.purchases || 0) / 5) * 100),
    cpa: (row) => {
      const purchases = Number(row.purchases || 0);
      if (!purchases) return 0;
      const aov = Number(row.purchaseValue || 0) / purchases;
      if (!aov) return 0;
      const ratio = Number(row.cpa || 0) / aov;
      if (ratio <= 0.3) return 100;
      if (ratio >= 1) return 0;
      return clampScore(100 * (1 - (ratio - 0.3) / 0.7));
    }
  },
  traffic: {
    ctr: (row) => clampScore((Number(row.ctr || 0) / 0.02) * 100),
    landingPageView: (row) => {
      const clicks = Number(row.clicks || 0);
      const rate = clicks ? Number(row.landingPageViews || 0) / clicks : 0;
      return clampScore((rate / 0.7) * 100);
    },
    cpc: (row) => {
      const cpc = Number(row.cpc || 0);
      if (!cpc) return 0;
      if (cpc <= 200) return 100;
      if (cpc >= 800) return 0;
      return clampScore(100 * (1 - (cpc - 200) / 600));
    }
  },
  video: {
    thruplay: (row) => {
      const impressions = Number(row.impressions || 0);
      const rate = impressions ? Number(row.thruplayViews || 0) / impressions : 0;
      return clampScore((rate / 0.3) * 100);
    },
    completionRate: (row) => {
      const videoViews = Number(row.videoViews || 0);
      if (!videoViews) return 0;
      return clampScore((Number(row.videoCompletion || 0) / videoViews / 0.3) * 100);
    }
  },
  engagement: {
    engagementRate: (row) => {
      const impressions = Number(row.impressions || 0);
      const rate = impressions ? Number(row.postEngagement || 0) / impressions : 0;
      return clampScore((rate / 0.05) * 100);
    },
    ctr: (row) => clampScore((Number(row.ctr || 0) / 0.02) * 100)
  },
  awareness: {
    frequency: (row) => clampScore(100 - Math.max(0, Number(row.frequency || 0) - 3) * 25),
    reach: (row) => {
      const reach = Number(row.reach || 0);
      const spend = Number(row.spend || 0);
      if (!reach) return 0;
      const cpr = spend / reach;
      if (cpr <= 15) return 100;
      if (cpr >= 50) return 0;
      return clampScore(100 * (1 - (cpr - 15) / 35));
    },
    cpm: (row) => {
      const cpm = Number(row.cpm || 0);
      if (!cpm) return 0;
      if (cpm <= 5000) return 100;
      if (cpm >= 15000) return 0;
      return clampScore(100 * (1 - (cpm - 5000) / 10000));
    }
  }
};

// Performance Score(0~100) Rule Engine. Objective별 factor의 0~100 정규화 점수를
// Settings에서 설정한 가중치로 가중평균합니다. 가중치 합이 100이 아니어도 자동으로
// 정규화되고, 가중치가 0/비어있는 factor는 계산에서 제외됩니다.
function metaAdsPerformanceScore(row = {}, weights = {}) {
  const objective = row.objective || "unknown";
  const factorFns = SCORE_FACTOR_FNS[objective];
  if (!factorFns) return null;
  const objectiveWeights = weights[objective] || {};
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [factorKey, fn] of Object.entries(factorFns)) {
    const weight = Number(objectiveWeights[factorKey] || 0);
    if (!weight) continue;
    weightedSum += fn(row) * weight;
    weightTotal += weight;
  }
  if (!weightTotal) return null;
  return Math.round(weightedSum / weightTotal);
}

// AI Decision: Objective와 무관하게 Score 하나로 통일한 5단계 신뢰도 표시입니다.
function metaAdsStarDecision(score) {
  if (score === null || score === undefined) return { stars: "-", label: "확인 필요", tone: "warn" };
  if (score >= 80) return { stars: "★★★★★", label: "확대", tone: "good" };
  if (score >= 60) return { stars: "★★★★", label: "유지", tone: "good" };
  if (score >= 40) return { stars: "★★★", label: "관찰", tone: "warn" };
  if (score >= 20) return { stars: "★★", label: "점검", tone: "warn" };
  return { stars: "★", label: "중지", tone: "urgent" };
}

function metaAdsDecisionCellHtml(row, weights) {
  const score = metaAdsPerformanceScore(row, weights);
  const decision = metaAdsStarDecision(score);
  const needsManagement = Number(row.spend || 0) > 0 && (AD_DECISION_URGENCY[decision.label] ?? 5) <= 2;
  return `<div class="ad-decision-cell ${esc(decision.tone)}">
    <span class="ad-decision-stars">${esc(metaAdsDecisionActionText(decision.label))}</span>
    <span class="ad-decision-line">${esc(metaAdsNarrative(row))}</span>
    ${needsManagement ? `<span class="ad-decision-action">관리 필요</span>` : ""}
  </div>`;
}

function metaAdsFullReportRowHtml(row, weights) {
  const score = metaAdsPerformanceScore(row, weights);
  return `<tr>
    <td class="ad-name-cell" title="${esc(row.campaignName || "-")}">${esc(row.campaignName || "-")}</td>
    <td>${esc(row.status || "확인 필요")}</td>
    <td>${esc(metaAdsObjectiveLabel(row))}</td>
    <td>${apiWon(row.spend)}</td>
    <td>${apiNum(row.purchases)}</td>
    <td>${apiWon(row.purchaseValue)}</td>
    <td>${row.roas === null ? "-" : multiple(row.roas)}</td>
    <td>${score === null ? "-" : `<span title="Meta 자체 귀속 지표 기준">Meta 성과 점수(참고) ${score}점</span>`}</td>
    <td>${metaAdsDecisionCellHtml(row, weights)}</td>
    <td class="ad-detail-col">${pct(Number(row.ctr || 0) * 100)}</td>
    <td class="ad-detail-col">${apiWon(row.cpc)}</td>
    <td class="ad-detail-col">${apiWon(row.cpm)}</td>
    <td class="ad-detail-col">${Number(row.frequency || 0).toFixed(1)}</td>
    <td class="ad-detail-col">${apiNum(row.landingPageViews)}</td>
    <td class="ad-detail-col">${apiNum(row.profileVisits)}</td>
    <td class="ad-detail-col">${pct(Number(row.conversionRate || 0) * 100)}</td>
    <td class="ad-detail-col">${hasApiValue(row.cpa) ? apiWon(row.cpa) : "-"}</td>
    <td class="ad-detail-col">${row.executionStart && row.executionEnd ? `${esc(row.executionStart)} ~ ${esc(row.executionEnd)}` : "-"}</td>
  </tr>`;
}

function renderMetaAdsFullReportGroups(fullReport = {}, weights = {}, targets = {}) {
  const groups = { active: [], other: [] };
  if (!fullReport.error) {
    (fullReport.rows || []).forEach((row) => {
      groups[metaAdsStatusGroup(row)].push(row);
    });
  }
  Object.values(groups).forEach((rows) => {
    rows.sort((left, right) => Number(right.spend || 0) - Number(left.spend || 0));
  });

  const emptyRow = (label) => `<tr><td colspan="18">${esc(label)}</td></tr>`;
  if (targets.active) {
    targets.active.innerHTML = fullReport.error
      ? emptyRow(fullReport.error)
      : groups.active.length ? groups.active.map((row) => metaAdsFullReportRowHtml(row, weights)).join("") : emptyRow("이 기간에 집행된 캠페인이 없습니다.");
  }
  if (targets.other) {
    targets.other.innerHTML = fullReport.error ? "" : groups.other.length ? groups.other.map((row) => metaAdsFullReportRowHtml(row, weights)).join("") : emptyRow("미집행 캠페인이 없습니다.");
  }

  const otherHeader = $("#adGroupOtherHeader");
  if (otherHeader) otherHeader.textContent = `미집행 캠페인 (${groups.other.length})`;
}

// 상세 보기 토글은 DOM이 다시 그려져도 유지되도록 document 레벨에서 한 번만 바인딩합니다
// (event delegation). 진행중/종료·보관·초안 표 2개 모두에 동시에 적용됩니다.
let adFullReportTogglesBound = false;
function bindAdFullReportToggles() {
  if (adFullReportTogglesBound) return;
  adFullReportTogglesBound = true;
  document.addEventListener("click", (event) => {
    const detailBtn = event.target.closest("#adDetailToggleBtn");
    if (!detailBtn) return;
    const wraps = $$(".ad-full-report-wrap");
    if (!wraps.length) return;
    const show = !wraps[0].classList.contains("show-detail");
    wraps.forEach((wrap) => wrap.classList.toggle("show-detail", show));
    $$(".ad-detail-panel").forEach((panel) => panel.toggleAttribute("hidden", !show));
    detailBtn.textContent = show ? "기본만 보기" : "상세 보기";
  });
}

// 오늘 확인해야 할 우선순위: 중지 > 점검 > 관찰 > 유지 > 확대 순으로 급한 것부터,
// 같은 등급이면 광고비가 큰 캠페인(=금액이 걸린 위험이 큰 캠페인)을 먼저 보여줍니다.
const AD_DECISION_URGENCY = { 중지: 0, 점검: 1, 관찰: 2, 유지: 3, 확대: 4 };

// 매일 아침 3분 안에 볼 화면이라 카운트 집계 없이 "지금 확인할 3개"만 카드로 보여줍니다.
function renderAdAiBriefing(fullReport = {}, weights = {}, target) {
  if (!target) return 0;
  if (fullReport.error) {
    target.innerHTML = `<article class="action-item"><strong>브리핑 확인 불가</strong><p>${esc(fullReport.error)}</p></article>`;
    return 0;
  }
  const rows = (fullReport.rows || []).filter((row) => Number(row.spend || 0) > 0);
  const scored = rows.map((row) => {
    const score = metaAdsPerformanceScore(row, weights);
    const decision = metaAdsStarDecision(score);
    return { row, score, decision };
  });
  const managementCount = scored.filter((item) => (AD_DECISION_URGENCY[item.decision.label] ?? 5) <= 2).length;

  const priority = [...scored]
    .sort((left, right) => {
      const urgencyDiff = (AD_DECISION_URGENCY[left.decision.label] ?? 5) - (AD_DECISION_URGENCY[right.decision.label] ?? 5);
      if (urgencyDiff !== 0) return urgencyDiff;
      return Number(right.row.spend || 0) - Number(left.row.spend || 0);
    })
    .slice(0, 3);

  if (!priority.length) {
    target.innerHTML = `<p class="hint-text">이번 기간에 광고비가 집행된 캠페인이 없습니다.</p>`;
    return managementCount;
  }

  target.innerHTML = priority.map(({ row, decision }, index) => `
    <article class="ad-ai-briefing-card ${esc(decision.tone)}">
      <div class="ad-ai-briefing-head">
        <span class="ad-ai-briefing-rank">${index + 1}</span>
        <strong>${Number(row.spend || 0) > 0 && (AD_DECISION_URGENCY[decision.label] ?? 5) <= 2 ? "관리 필요 캠페인" : "우선 확인 캠페인"}</strong>
      </div>
      <p class="ad-ai-briefing-name" title="${esc(row.campaignName || "-")}">${esc(row.campaignName || "-")}</p>
      <p class="ad-ai-briefing-narrative">${esc(metaAdsNarrative(row))}</p>
      <p class="ad-ai-briefing-metric">관리가 필요한 순서로 표시됩니다. · ${esc(metaAdsKeyMetricLine(row))} · 광고비 ${apiWon(row.spend)}</p>
    </article>
  `).join("");
  return managementCount;
}
// ============================================================================
// Meta Product Performance · Phase 1 (2026-07-23) — Marketing 화면(#Advertising view)
// 전용 신규 카드. GET /api/meta-ads/products가 내려주는 content_id 파싱 결과를 표/배지/detail로
// 보여준다. Product Registry나 Cafe24 runtime 조회에 의존하지 않는 Phase 1 최소 화면이다.
// ============================================================================
async function renderMetaProductPerformance(since, until, renderSeq) {
  const summaryTarget = $("#metaProductPerformanceSummary");
  const rowsTarget = $("#metaProductPerformanceRows");
  if (!summaryTarget || !rowsTarget) return;
  const localSeq = ++metaProductPerformanceRenderSeq;
  const result = await getJson(`/api/meta-ads/products?since=${since}&until=${until}`, 12000);
  if (localSeq !== metaProductPerformanceRenderSeq) return;
  if (renderSeq !== undefined && renderSeq !== operationsRenderSeq) return;
  if (result.error || !Array.isArray(result.rows)) {
    metaProductPerformanceRows = [];
    metaProductPerformanceOpenContentId = null;
    metaProductPerformanceBrandFilter = null;
    metaProductPerformanceSalesByProductNo = new Map();
    metaProductPerformanceBrandsByCode = new Map();
    summaryTarget.innerHTML = `<article class="action-item"><strong>Meta Product Performance 확인 불가</strong><p>${esc(result.error || "데이터 없음")}</p></article>`;
    rowsTarget.innerHTML = `<tr><td colspan="4">${esc(result.error || "데이터 없음")}</td></tr>`;
    renderMetaProductPerformanceBrandContribution();
    return;
  }
  metaProductPerformanceRows = result.rows;
  metaProductPerformanceOpenContentId = null;
  metaProductPerformanceBrandFilter = null;
  renderMetaProductPerformanceSummary(result.summary || {});
  // eslint / 회귀 방지 주석: renderMetaProductPerformanceSummary 내부에서
  // metaProductPerformanceRows를 기준으로 "구매 수"를 다시 계산하므로(matched 행만
  // 합산), 여기서는 result.summary를 그대로 전달해도 실제 표시값은 항상 아래 표와
  // 일치한다. (QA Sprint 2026-07-23 Bug #1 수정)
  renderMetaProductPerformanceTable();
  renderMetaProductPerformanceBrandContribution();
  // Phase 2: Cafe24 실제 판매/주문 데이터(GET /api/diagnostics/brand-sales, 기존 API)를
  // 별도로 조인한다. Meta Product Performance 표 자체는 이미 위에서 렌더된 상태이므로,
  // 이 조회가 늦어져도 Phase 1 표시는 지연되지 않는다. 완료되면 Detail(실매출 등)과
  // Brand Contribution만 다시 그린다.
  await loadMetaProductPerformanceBrandSales(since, until);
  if (localSeq !== metaProductPerformanceRenderSeq) return;
  if (renderSeq !== undefined && renderSeq !== operationsRenderSeq) return;
  renderMetaProductPerformanceTable();
  renderMetaProductPerformanceBrandContribution();
}

// GET /api/diagnostics/brand-sales는 이미 Marketing 화면의 다른 카드(Commerce/Sales
// Health 등)가 같은 기간으로 호출 중인 기존 API다. getSharedJson()을 그대로 재사용하므로
// 동일 since/until이면 새 네트워크 요청 없이 진행 중이거나 완료된 응답을 공유한다 — 새
// endpoint를 만들지 않고, 이 화면이 별도로 추가 호출을 만들지도 않는다(요청 재사용).
async function loadMetaProductPerformanceBrandSales(since, until) {
  const result = await getSharedJson(`/api/diagnostics/brand-sales?since=${since}&until=${until}`, 12000);
  const productByProductNo = new Map();
  const brandsByCode = new Map();
  if (!result.error) {
    for (const product of Array.isArray(result.products) ? result.products : []) {
      if (product?.productNo !== undefined && product?.productNo !== null && product.productNo !== "") {
        productByProductNo.set(String(product.productNo), product);
      }
    }
    for (const brand of Array.isArray(result.brands) ? result.brands : []) {
      if (brand?.brand_code) brandsByCode.set(brand.brand_code, brand);
    }
  }
  metaProductPerformanceSalesByProductNo = productByProductNo;
  metaProductPerformanceBrandsByCode = brandsByCode;
  metaProductPerformanceSalesFetchFailed = Boolean(result.error);
}

// STEP1 Product Detail 확장 + STEP3 Order Drill-down이 공유하는 조인 헬퍼. 서버가 이미
// 계산해둔 canonicalPaidAmount/discountRate/orderCount를 그대로 사용하고, 클라이언트에서는
// "평균 판매가"(canonicalPaidAmount ÷ quantitySold) 하나만 두 실측값의 단순 비율로
// 계산한다 — 기존 화면의 ROAS/광고비 비중 계산과 동일한 방식이다.
function metaProductPerformanceSalesForRow(row = {}) {
  const cafe24ProductNo = row.product?.cafe24ProductNo;
  if (cafe24ProductNo === null || cafe24ProductNo === undefined) return null;
  return metaProductPerformanceSalesByProductNo.get(String(cafe24ProductNo)) || null;
}

function metaProductPerformanceOrdersForRow(row = {}) {
  const salesProduct = metaProductPerformanceSalesForRow(row);
  if (!salesProduct) return [];
  const brand = metaProductPerformanceBrandsByCode.get(salesProduct.brand_code);
  const orderHistory = Array.isArray(brand?.orderHistory) ? brand.orderHistory : [];
  const productNo = String(salesProduct.productNo);
  const orders = [];
  for (const order of orderHistory) {
    for (const item of Array.isArray(order.products) ? order.products : []) {
      if (String(item.productNo) === productNo) {
        orders.push({ orderId: order.orderId, orderDate: order.orderDate, ...item });
      }
    }
  }
  // 주문 정렬 기준은 최신순(내림차순) 하나로 통일한다.
  orders.sort((left, right) => String(right.orderDate || "").localeCompare(String(left.orderDate || "")));
  return orders;
}

// QA Sprint (2026-07-23) Bug #1 수정: 서버가 내려주는 summary.attributedPurchases는
// Unresolved 행의 구매 수까지 합산한 값이라, 실제로 화면에 보이는 상품 표(matched 행만
// 표시)의 구매 수 합계와 달랐다("전체 합계 ≠ 화면에 보이는 합계" 신뢰도 문제). 여기서는
// 이미 로드된 metaProductPerformanceRows에서 matched 행만 다시 더해 "구매 수" 카드가
// 항상 아래 표(그리고 Brand Contribution의 총 구매수)와 정확히 일치하도록 한다. 서버
// 응답 자체나 summary 객체의 다른 필드(matchedRows/runtimeEnrichedCount/unresolvedRows)는
// 그대로 사용한다 — 이 값들은 원래도 표와 일치하는 "행 개수" 기준이라 문제가 없었다.
function renderMetaProductPerformanceSummary(summary = {}) {
  const target = $("#metaProductPerformanceSummary");
  if (!target) return;
  const visiblePurchaseTotal = metaProductPerformanceRows
    .filter((row) => row.matched)
    .reduce((sum, row) => sum + Number(row.purchaseCount || 0), 0);
  target.innerHTML = [
    metaAdsSummaryCard("귀속 상품", apiNum(summary.matchedRows), "Meta 구매 상품 중 Cafe24 상품으로 연결된 content_id 수", true),
    metaAdsSummaryCard("구매 수", apiNum(visiblePurchaseTotal), "아래 상품 표(귀속된 상품)의 구매 수 합계"),
    metaAdsSummaryCard("Parsed", apiNum(summary.matchedRows), "content_id에서 상품번호와 옵션 코드를 파싱한 행 수"),
    metaAdsSummaryCard("Unresolved", apiNum(summary.unresolvedRows), "아직 Cafe24 상품으로 특정하지 못한 content_id 수")
  ].join("");
}

function metaProductPerformanceRegistrySourceLabel(row = {}) {
  if (row.product?.source === "runtime") return "Runtime";
  if (row.matchType === "content_id_parsed_no_registry" || row.product?.registryStatus === "no_registry_lookup") return "Parsed";
  if (row.matched && row.product?.verified) return "Verified";
  return "Unresolved";
}

function metaProductPerformanceRegistryBadge(row = {}) {
  const label = metaProductPerformanceRegistrySourceLabel(row);
  if (label === "Runtime") return `<span class="badge warn">Runtime</span>`;
  if (label === "Verified") return `<span class="badge good">Verified</span>`;
  if (label === "Parsed") return `<span class="badge">Parsed</span>`;
  return `<span class="badge">Unresolved</span>`;
}

// Hover: Registry Source / Match Type / Cafe24 Product No / Product Code를 네이티브
// title 속성(줄바꿈 지원)으로 보여준다. 별도 tooltip 컴포넌트를 새로 만들지 않는
// Phase 1 최소 구현이다.
function metaProductPerformanceHoverTitle(row = {}) {
  const product = row.product || {};
  return [
    `Registry Source: ${metaProductPerformanceRegistrySourceLabel(row)}`,
    `Match Type: ${row.matchType || "-"}`,
    `Cafe24 Product No: ${product.cafe24ProductNo ?? "-"}`,
    `Product Code: ${product.productCode ?? "-"}`
  ].join("\n");
}

// STEP1 Product Detail 확장: 실매출/주문수/평균 판매가/할인율 평균은 GET
// /api/diagnostics/brand-sales의 products[] 항목(canonicalPaidAmount/orderCount/
// sales.discountRate)을 그대로 쓴다. "평균 판매가"만 canonicalPaidAmount ÷ quantitySold의
// 단순 나눗셈이다(다른 값을 새로 만들지 않음). "판매된 옵션 수"는 이 API 응답에 옵션 단위
// 필드가 없어(Registry 구조 변경 없이는 확보 불가) 있는 그대로 "데이터 없음"으로 표시한다.
function metaProductPerformanceOrderRowHtml(order = {}) {
  const discountRate = order.canonicalDiscountRate ?? order.discountRate;
  return `<tr>
    <td>${esc(order.orderDate || "-")}</td>
    <td>${esc(order.orderId || "-")}</td>
    <td>${esc(order.productName || "-")}</td>
    <td>-</td>
    <td>${apiNum(order.quantity)}</td>
    <td>${discountRate === null || discountRate === undefined ? "-" : pct(discountRate)}</td>
    <td>${apiWon(order.canonicalPaidAmount ?? order.paidAmount)}</td>
    <td>결제 완료</td>
  </tr>`;
}

function metaProductPerformanceOrderListHtml(row = {}, salesProduct) {
  if (metaProductPerformanceSalesFetchFailed) {
    return `<p class="hint-text">Cafe24 판매 데이터를 불러오지 못해 주문 내역을 표시할 수 없습니다.</p>`;
  }
  if (!salesProduct) {
    return `<p class="hint-text">이 기간 Cafe24 판매 데이터가 없어 주문 내역을 표시할 수 없습니다(Meta 구매 이벤트만 존재).</p>`;
  }
  const orders = metaProductPerformanceOrdersForRow(row);
  if (!orders.length) {
    return `<p class="hint-text">이 기간에 조회된 주문이 없습니다.</p>`;
  }
  return `<div class="table-wrap"><table class="meta-product-performance-order-table">
    <thead><tr><th>날짜</th><th>주문번호</th><th>상품</th><th>옵션</th><th>수량</th><th>할인율</th><th>실결제금액</th><th>상태</th></tr></thead>
    <tbody>${orders.map(metaProductPerformanceOrderRowHtml).join("")}</tbody>
  </table></div>`;
}

function metaProductPerformanceDetailHtml(row = {}) {
  const product = row.product || {};
    const salesProduct = metaProductPerformanceSalesForRow(row);
  const discountRate = salesProduct?.sales?.discountRate;
  const avgPrice = salesProduct && Number(salesProduct.quantitySold) > 0
    ? Math.round(Number(salesProduct.canonicalPaidAmount || 0) / Number(salesProduct.quantitySold))
    : null;
  const salesUnavailableNote = metaProductPerformanceSalesFetchFailed
    ? "Cafe24 판매 데이터 확인 불가"
    : "데이터 없음(이 기간 Cafe24 판매 없음)";
  return `<dl class="meta-product-performance-detail">
    <div><dt>브랜드</dt><dd>${esc(product.brand || "-")}</dd></div>
    <div><dt>상품명</dt><dd>${esc(product.productName || "-")}</dd></div>
    <div><dt>Cafe24 Product No</dt><dd>${esc(product.cafe24ProductNo ?? "-")}</dd></div>
    <div><dt>Product Code</dt><dd>${esc(product.productCode || "-")}</dd></div>
    <div><dt>구매 수</dt><dd>${apiNum(row.purchaseCount)}</dd></div>
    <div><dt>Registry Status</dt><dd>${esc(product.registryStatus || "-")}</dd></div>
    <div><dt>확인 방식</dt><dd>${metaProductPerformanceRegistrySourceLabel(row)}</dd></div>
    <div><dt>content_id</dt><dd>${esc(row.contentId || "-")}</dd></div>
    <div><dt>matchType</dt><dd>${esc(row.matchType || "-")}</dd></div>
    <div><dt>실매출(Cafe24)</dt><dd>${salesProduct ? apiWon(salesProduct.canonicalPaidAmount) : salesUnavailableNote}</dd></div>
    <div><dt>주문수</dt><dd>${salesProduct ? apiNum(salesProduct.orderCount) : "-"}</dd></div>
    <div><dt>평균 판매가</dt><dd>${avgPrice === null ? "-" : apiWon(avgPrice)}</dd></div>
    <div><dt>할인율 평균</dt><dd>${discountRate === null || discountRate === undefined ? "-" : pct(discountRate)}</dd></div>
    <div><dt>판매된 옵션 수</dt><dd>데이터 없음(옵션 단위 필드 미제공)</dd></div>
  </dl>  <div class="meta-product-performance-orders">
    <h5>Order List <span>· 최신순</span></h5>
    ${metaProductPerformanceOrderListHtml(row, salesProduct)}
  </div>`;
}

// 기본 정렬: 구매 수 내림차순. 아직 상품을 특정하지 못한(Unresolved) 행은 이 표에는
// 표시하지 않는다(브랜드/상품명이 없어 표 자체가 의미가 없음) — summary의 Unresolved
// 카운트로만 노출한다. STEP2에서 Brand Contribution 행을 클릭하면
// metaProductPerformanceBrandFilter가 설정되어 여기서도 해당 브랜드만 남긴다.
function renderMetaProductPerformanceTable() {
  const rowsTarget = $("#metaProductPerformanceRows");
  if (!rowsTarget) return;
  renderMetaProductPerformanceFilterBanner();
  let rows = metaProductPerformanceRows.filter((row) => row.matched);
  if (metaProductPerformanceBrandFilter) {
    rows = rows.filter((row) => (row.product?.brand || "미분류") === metaProductPerformanceBrandFilter);
  }
  rows = rows.sort((left, right) => Number(right.purchaseCount || 0) - Number(left.purchaseCount || 0));
  if (!rows.length) {
    rowsTarget.innerHTML = `<tr><td colspan="4">${metaProductPerformanceBrandFilter ? "이 브랜드에 귀속된 상품이 없습니다." : "귀속된 상품이 없습니다."}</td></tr>`;
    return;
  }
  rowsTarget.innerHTML = rows.map((row) => {
    const product = row.product || {};
    const isOpen = metaProductPerformanceOpenContentId === row.contentId;
    return `<tr class="meta-product-performance-row" data-meta-product-toggle="${esc(row.contentId)}" title="${esc(metaProductPerformanceHoverTitle(row))}">
      <td><strong>${esc(product.brand || "-")}</strong></td>
      <td>${esc(product.productName || "-")}</td>
      <td>구매 ${apiNum(row.purchaseCount)}건</td>
      <td>${metaProductPerformanceRegistryBadge(row)}</td>
    </tr><tr class="meta-product-performance-detail-row"${isOpen ? "" : " hidden"}><td colspan="4">${metaProductPerformanceDetailHtml(row)}</td></tr>`;
  }).join("");
}

function toggleMetaProductPerformanceRow(contentId) {
  metaProductPerformanceOpenContentId = metaProductPerformanceOpenContentId === contentId ? null : contentId;
  renderMetaProductPerformanceTable();
}

function renderMetaProductPerformanceFilterBanner() {
  const target = $("#metaProductPerformanceFilterBanner");
  if (!target) return;
  if (!metaProductPerformanceBrandFilter) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  target.hidden = false;
  target.innerHTML = `<span>브랜드 필터: <strong>${esc(metaProductPerformanceBrandFilter)}</strong></span><button type="button" class="button secondary" data-meta-brand-filter-clear>필터 해제</button>`;
}

// ============================================================================
// STEP2/STEP5 Brand Contribution — Meta Product Performance rows를 product.brand로
// 그룹핑하고, cafe24ProductNo당 1회만 Cafe24 실매출(canonicalPaidAmount)을 더한다(같은
// 상품이 여러 content_id/광고 소재로 나와도 매출이 중복 합산되지 않도록 productNo로
// dedupe). ROAS는 이 API들에 상품별 광고비가 없어 계산하지 않고 "-"로 표시한다.
// ============================================================================
function metaProductPerformanceBrandGroups() {
  const groups = new Map();
  for (const row of metaProductPerformanceRows) {
    if (!row.matched) continue;
    const brandName = row.product?.brand || "미분류";
    const cafe24ProductNo = row.product?.cafe24ProductNo;
    const isRuntime = row.product?.source === "runtime";
    const group = groups.get(brandName) || {
      brand: brandName,
      purchaseCount: 0,
      productNos: new Set(),
      runtimeProductNos: new Set(),
      salesAmount: 0
    };
    group.purchaseCount += Number(row.purchaseCount || 0);
    if (cafe24ProductNo !== null && cafe24ProductNo !== undefined) {
      if (!group.productNos.has(cafe24ProductNo)) {
        group.productNos.add(cafe24ProductNo);
        const salesProduct = metaProductPerformanceSalesByProductNo.get(String(cafe24ProductNo));
        if (salesProduct) group.salesAmount += Number(salesProduct.canonicalPaidAmount || 0);
      }
      if (isRuntime) group.runtimeProductNos.add(cafe24ProductNo);
    }
    groups.set(brandName, group);
  }
  return [...groups.values()].map((group) => ({
    brand: group.brand,
    purchaseCount: group.purchaseCount,
    productCount: group.productNos.size,
    runtimeCount: group.runtimeProductNos.size,
    salesAmount: group.salesAmount
  })).sort((left, right) => right.salesAmount - left.salesAmount);
}

// QA Sprint (2026-07-23) Bug #2 수정: Cafe24 판매 데이터(brand-sales) 조회 자체가
// 실패했을 때(metaProductPerformanceSalesFetchFailed) 이전에는 이 함수가 그대로 진행되어
// 모든 브랜드의 실매출이 "0원"으로 표시됐다 — 실제로는 "매출이 0원"이 아니라 "매출 데이터를
// 가져오지 못함"인데 화면에서는 구분이 안 되는 오표시였다. 이제 이 경우 숫자 대신 명확한
// 오류 상태를 보여준다(브랜드 수/구매수 등 Meta 쪽 데이터는 정상이므로 상품 표는 계속
// 정상 표시되고, 이 섹션만 "확인 불가"로 표시한다).
function renderMetaProductPerformanceBrandContribution() {
  const summaryTarget = $("#metaBrandContributionSummary");
  const rowsTarget = $("#metaBrandContributionRows");
  if (!summaryTarget || !rowsTarget) return;
  if (metaProductPerformanceSalesFetchFailed) {
    summaryTarget.innerHTML = `<article class="action-item"><strong>Brand Contribution 확인 불가</strong><p>Cafe24 판매 데이터(brand-sales)를 불러오지 못해 실매출을 계산할 수 없습니다. 아래 "0원"이 아니라 데이터 확인 불가 상태입니다. 잠시 후 다시 시도해주세요.</p></article>`;
    rowsTarget.innerHTML = `<tr><td colspan="6">Cafe24 판매 데이터를 불러오지 못했습니다.</td></tr>`;
    return;
  }
  const groups = metaProductPerformanceBrandGroups();
  const totalPurchases = groups.reduce((sum, group) => sum + group.purchaseCount, 0);
  const totalSales = groups.reduce((sum, group) => sum + group.salesAmount, 0);
  const totalProducts = groups.reduce((sum, group) => sum + group.productCount, 0);
  const runtimeBrandCount = groups.filter((group) => group.runtimeCount > 0).length;
  summaryTarget.innerHTML = [
    metaAdsSummaryCard("브랜드 수", apiNum(groups.length), "귀속 상품이 있는 브랜드 수", true),
    metaAdsSummaryCard("광고 상품 수", apiNum(totalProducts), "브랜드별 귀속 상품 수 합계(productNo 중복 제거)"),
    metaAdsSummaryCard("Parsed 브랜드 수", apiNum(runtimeBrandCount), "content_id 파싱으로 확인된 상품이 1개 이상 있는 브랜드 수"),
    metaAdsSummaryCard("총 구매수", apiNum(totalPurchases), "전체 브랜드 귀속 구매 이벤트 합계"),
    metaAdsSummaryCard("총 실매출", apiWon(totalSales), "Meta 귀속 상품만의 실매출 합계 — 브랜드 전체 매출 아님, Commerce 화면과 다를 수 있음")
  ].join("");
  if (!groups.length) {
    rowsTarget.innerHTML = `<tr><td colspan="6">귀속된 브랜드가 없습니다.</td></tr>`;
    return;
  }
  rowsTarget.innerHTML = groups.map((group) => {
    const isActive = metaProductPerformanceBrandFilter === group.brand;
    return `<tr class="meta-brand-contribution-row${isActive ? " active" : ""}" data-meta-brand-toggle="${esc(group.brand)}">
      <td><strong>${esc(group.brand)}</strong>${group.runtimeCount > 0 ? `<span class="meta-brand-runtime-dot" title="Parsed 상품 포함"></span>` : ""}</td>
      <td>${apiWon(group.salesAmount)}</td>
      <td>${apiNum(group.purchaseCount)}</td>
      <td>${apiNum(group.productCount)}</td>
      <td>${apiNum(group.runtimeCount)}</td>
      <td>-</td>
    </tr>`;
  }).join("");
}

function toggleMetaProductPerformanceBrandFilter(brand) {
  metaProductPerformanceBrandFilter = metaProductPerformanceBrandFilter === brand ? null : brand;
  renderMetaProductPerformanceTable();
  renderMetaProductPerformanceBrandContribution();
  if (metaProductPerformanceBrandFilter) {
    $("#metaProductPerformanceFilterBanner")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function clearMetaProductPerformanceBrandFilter() {
  metaProductPerformanceBrandFilter = null;
  renderMetaProductPerformanceTable();
  renderMetaProductPerformanceBrandContribution();
}

// Meta 계정 전체 합계(level=account)와 표에 실제로 보이는 캠페인 합계를 대조합니다.
// 차이가 있으면 삭제/보관되어 캠페인 목록에는 없지만 과거 집행 이력이 insights에는
// 남아있는 경우일 가능성이 큽니다(누락 캠페인 수로 표시).
// Meta 값과 Marketing Director 값이 다를 때 "왜 다른지"를 사람이 바로 이해하도록 원인을 추정합니다.
// 우선순위: 삭제/보관 캠페인(수치로 확인 가능) > 캐시 데이터 기준(source/cacheMode로 확인 가능) > 기간/Attribution(그 외 잔여 원인, 확정할 수 없어 가능성으로만 안내).
function metaAdsReconciliationDiffReason(fullReport = {}, unlistedCount) {
  if (unlistedCount > 0) {
    return `삭제되었거나 보관 처리된 캠페인 ${unlistedCount}개의 과거 광고비가 Meta 전체 합계에는 남아있어 발생한 차이입니다.`;
  }
  const source = fullReport.source || "";
  if (source.includes("_cached") || fullReport.cacheMode) {
    return "저장된 캐시 데이터 기준으로 계산되어 Meta의 실시간 값과 약간의 시간차가 있을 수 있습니다. 동기화 점검으로 최신화해보세요.";
  }
  return "집계 기간 경계 또는 Meta의 Attribution(전환 인정 기준) 차이로 인한 것일 수 있습니다.";
}

function metaAdsReconciliationCard(label, metaValue, mdValue, formatFn, tolerance, reasonText) {
  const ok = Math.abs(Number(metaValue || 0) - Number(mdValue || 0)) <= tolerance;
  return `<article class="action-item ad-summary-card ad-core-kpi-card">
    <span>${esc(label)}</span>
    <strong>${ok ? "✔ 일치" : "⚠ 차이 발생"}</strong>
    <p>Meta Total ${esc(formatFn(metaValue))} · Marketing Director Total ${esc(formatFn(mdValue))}</p>
    ${ok ? "" : `<p>${esc(reasonText)}</p>`}
  </article>`;
}

function renderMetaAdsReconciliation(fullReport = {}, target) {
  if (!target) return;
  if (fullReport.error) {
    target.innerHTML = `<article class="action-item"><strong>검증 불가</strong><p>${esc(fullReport.error)}</p></article>`;
    return;
  }
  const r = fullReport.reconciliation || {};
  const mdSpend = Number(r.tableSpend || 0);
  const mdPurchaseValue = Number(r.tablePurchaseValue || 0);
  const mdRoas = mdSpend ? mdPurchaseValue / mdSpend : null;
  const metaRoas = hasApiValue(r.metaAccountRoas) ? Number(r.metaAccountRoas) : null;
  const unlistedCount = Number(r.unlistedCampaignCount || 0);
  const roasFormat = (value) => (value === null || value === undefined ? "-" : multiple(value));
  // 부동소수점 합산 순서 차이로 생기는 몇 원 단위 오차까지 "차이 발생"으로 잡지 않도록
  // 절대 오차(100원) 또는 Meta 합계의 0.5% 중 더 큰 값을 금액 허용 오차로 둡니다.
  // ROAS는 배율이라 금액과 같은 기준을 쓸 수 없어 0.05x를 허용 오차로 둡니다.
  const spendTolerance = Math.max(100, Math.abs(Number(r.metaAccountSpend || 0)) * 0.005);
  const purchaseValueTolerance = Math.max(100, Math.abs(Number(r.metaAccountPurchaseValue || 0)) * 0.005);
  const diffReason = metaAdsReconciliationDiffReason(fullReport, unlistedCount);
  target.innerHTML = [
    metaAdsReconciliationCard("총 광고비", r.metaAccountSpend, mdSpend, apiWon, spendTolerance, diffReason),
    metaAdsReconciliationCard("총 구매값", r.metaAccountPurchaseValue, mdPurchaseValue, apiWon, purchaseValueTolerance, diffReason),
    metaAdsReconciliationCard("총 ROAS", metaRoas, mdRoas, roasFormat, 0.05, diffReason),
    `<article class="action-item ad-summary-card ad-core-kpi-card">
      <span>누락 캠페인 수</span>
      <strong>${apiNum(unlistedCount)}</strong>
      <p>${unlistedCount ? `삭제/보관 캠페인 광고비 ${apiWon(r.unlistedSpend)} 별도 집계` : "전체 캠페인이 표에 반영됨"}</p>
    </article>`
  ].join("");
}

function renderAdOrganicCards(adPosts, organicPosts) {
  const adReach = sum(adPosts, "reach");
  const organicReach = sum(organicPosts, "reach");
  const adClicks = sum(adPosts, "websiteClicks");
  const organicClicks = sum(organicPosts, "websiteClicks");
  return [
    `<article class="action-item"><strong>광고 집행 콘텐츠</strong><span>${apiNum(adPosts.length)}개</span><p>도달 ${apiNum(adReach)} · 클릭 ${apiNum(adClicks)}</p></article>`,
    `<article class="action-item"><strong>유기 콘텐츠</strong><span>${apiNum(organicPosts.length)}개</span><p>도달 ${apiNum(organicReach)} · 클릭 ${apiNum(organicClicks)}</p></article>`
  ].join("");
}

async function renderCafe24Sales(data, renderSeq) {
  const range = operationsDateRange(data);
  const startDate = range.since;
  const endDate = range.until;
  const [sales, totalSales] = await Promise.all([
    getSharedJson(`/api/diagnostics/brand-sales?since=${startDate}&until=${endDate}`, 8000),
    getJson(`/api/sales/total?since=${startDate}&until=${endDate}`, 10000)
  ]);
  if (renderSeq !== undefined && renderSeq !== operationsRenderSeq) return;
  if (sales.error) {
    renderCommerceSummary(sales, null, totalSales);
    await renderCampaignPeriodComparison($("#campaignPeriodComparison"), renderSeq);
    return;
  }
  renderCommerceSummary(sales, null, totalSales);
  await renderCampaignPeriodComparison($("#campaignPeriodComparison"), renderSeq);
}

function renderCommerceSummary(cafe, comparisonResult, totalSales) {
  if (cafe !== undefined && cafe !== null) commerceSummaryState.cafe = cafe;
  if (comparisonResult !== undefined && comparisonResult !== null) commerceSummaryState.comparison = comparisonResult;
  if (totalSales !== undefined && totalSales !== null) commerceSummaryState.totalSales = totalSales;
  const heroTarget = $("#commerceSummaryHero");
  const compareTarget = $("#commerceSummaryCompare");
  const paymentsTarget = $("#commerceSummaryPayments");
  if (!heroTarget || !compareTarget || !paymentsTarget) return;

  const sales = commerceSummaryState.cafe || {};
  const totals = sales.totals || {};
  const totalSalesState = commerceSummaryState.totalSales || {};
  const payments = sales.paymentMethods || [];
  const paidAmount = Number(totals.paidAmount || 0);
  const productPaidAmount = firstFiniteValue(totals.sales?.paidAmount, totals.paidAmount, 0);
  const shippingAmount = firstFiniteValue(totals.sales?.shippingAmount, 0);
  const salesInfo = todaySummarySalesInfo(totalSalesState, totals);
  heroTarget.innerHTML = `<section class="ops-summary-hero">
    <div class="ops-summary-hero-main">
      <span>${esc(salesInfo.label)}</span>
      <strong class="ops-summary-hero-num">${esc(salesInfo.value)}</strong>
      <p class="ops-summary-hero-sub">${esc(salesInfo.note)}</p>
    </div>
    <div class="ops-summary-side">
      ${opsStatRow("온라인 결제액", apiWon(totals.paidAmount), { note: "상품 실결제 + 배송비" })}
      ${opsStatRow("상품 실결제", apiWon(productPaidAmount), { note: "브랜드·상품 성과 기준" })}
      ${shippingAmount ? opsStatRow("배송비", apiWon(shippingAmount), { note: "브랜드·상품 성과 제외" }) : ""}
      ${opsStatRow("온라인 주문", `${apiNum(totals.orderCount)}건`)}
      ${opsStatRow("온라인 객단가", apiWon(totals.averageOrderValue))}
      ${opsStatRow("온라인 제외 주문", `${apiNum(sales.excludedOrderCount)}건`, { note: "Cafe24 canonical 집계 제외" })}
    </div>
  </section>`;

  const comparison = commerceSummaryState.comparison || {};
  const cafeOrderAmount = hasApiValue(comparison.cafeOrderAmount) ? Number(comparison.cafeOrderAmount) : paidAmount;
  const metaPurchaseValue = hasApiValue(comparison.metaPurchaseValue) ? Number(comparison.metaPurchaseValue) : null;
  const compareBase = Math.max(cafeOrderAmount || 0, metaPurchaseValue || 0, 1);
  const mismatchText = comparison.comparable
    ? `${comparison.mismatchRate < 1 ? comparison.mismatchRate.toFixed(1) : Math.round(comparison.mismatchRate)}%`
    : "비교 불가";
  compareTarget.innerHTML = `<section class="ops-summary-block">
    <div class="ops-summary-block-head">
      <h4>Commerce vs Meta</h4>
      <span>오차율 ${esc(mismatchText)} · 상품 단위 비교 아님</span>
    </div>
    ${opsCompareRow("Cafe24 실제 판매", "canonical Commerce 기준", apiWon(cafeOrderAmount), monthlyReportRatio(cafeOrderAmount, compareBase))}
    ${opsCompareRow("Meta 구매값", "Meta 광고 귀속 기준 · 실제 매출 아님", comparison.metaReady === false ? "확인 필요" : apiWon(metaPurchaseValue), monthlyReportRatio(metaPurchaseValue, compareBase), { estimated: true })}
  </section>`;

  const paymentRows = payments.map((item) => {
    const percentage = paidAmount > 0 ? Number(item.orderAmount || 0) / paidAmount * 100 : 0;
    return { ...item, percentage };
  });
  const paymentRowsTotal = paymentRows.reduce((total, item) => total + Number(item.orderAmount || 0), 0);
  const leadPayment = paymentRows.reduce((best, item) => Number(item.percentage || 0) > Number(best.percentage || 0) ? item : best, paymentRows[0] || null);
  paymentsTarget.innerHTML = paymentRows.length ? `<section class="ops-summary-block">
    <div class="ops-summary-block-head"><h4>결제수단</h4><span>orderAmount / 온라인 매출</span></div>
    <div class="ops-summary-lead">
      <strong>${esc(leadPayment?.paymentMethod || "미확인")} ${pct(leadPayment?.percentage)}</strong>
      <div class="ops-summary-bar"><i style="width:${monthlyReportRatio(leadPayment?.percentage, 100)}%"></i></div>
      <p>${apiWon(leadPayment?.orderAmount)} · 주문 ${apiNum(leadPayment?.orderCount)}건</p>
    </div>
    ${paymentRows.map((item) => `<div class="ops-summary-srow ${Number(item.orderAmount || 0) ? "" : "is-muted"}">
      <span>${esc(item.paymentMethod || "미확인")}</span>
      <strong>${apiWon(item.orderAmount)}</strong>
      <em>${apiNum(item.orderCount)}건 · ${pct(item.percentage)}</em>
    </div>`).join("")}
    <div class="ops-summary-srow">
      <span>합계</span>
      <strong>${apiWon(paymentRowsTotal)}</strong>
      <em>결제수단 합계</em>
    </div>
  </section>` : `<article class="action-item sales-empty-card"><strong>결제수단 데이터 없음</strong><p>Commerce 데이터가 쌓이면 표시됩니다.</p></article>`;
  renderTodaySummary({ cafe: commerceSummaryState.cafe, comparison: commerceSummaryState.comparison });
}

function todaySummarySalesInfo(totalSales = {}, cafeTotals = {}) {
  const onlineRaw = hasApiValue(totalSales?.onlineSales?.paidAmount)
    ? totalSales.onlineSales.paidAmount
    : cafeTotals.paidAmount;
  const offlineRaw = totalSales?.offlineSales?.offlineSalesAmount;
  const totalRaw = totalSales?.totalSales?.amount;
  const onlineSales = hasApiValue(onlineRaw) ? Number(onlineRaw) : null;
  const offlineSales = hasApiValue(offlineRaw) ? Number(offlineRaw) : null;
  const canonicalTotal = hasApiValue(totalRaw) ? Number(totalRaw) : null;
  const onlineAvailable = Number.isFinite(onlineSales);
  const offlineAvailable = Number.isFinite(offlineSales);
  const totalAvailable = Number.isFinite(canonicalTotal);
  if (totalAvailable) {
    return {
      label: "총매출",
      value: apiWon(canonicalTotal),
      note: `온라인 ${onlineAvailable ? apiWon(onlineSales) : "데이터 없음"} · 오프라인 ${offlineAvailable ? apiWon(offlineSales) : "데이터 없음"}`,
      ready: true
    };
  }
  if (onlineAvailable && offlineAvailable) {
    return {
      label: "총매출",
      value: apiWon(onlineSales + offlineSales),
      note: `온라인 ${apiWon(onlineSales)} · 오프라인 ${apiWon(offlineSales)}`,
      ready: true
    };
  }
  if (onlineAvailable) {
    return {
      label: "온라인 매출",
      value: apiWon(onlineSales),
      note: "오프라인 매출 데이터 없음",
      ready: true
    };
  }
  if (offlineAvailable) {
    return {
      label: "오프라인 매출",
      value: apiWon(offlineSales),
      note: "온라인 매출 확인 필요",
      ready: true
    };
  }
  return {
    label: "매출",
    value: "확인 필요",
    note: totalSales?.error || "온라인 / 오프라인 매출 확인 필요",
    ready: false
  };
}

function renderTodaySummary({ data, cafe, meta, comparison, marketing, totalSales } = {}) {
  if (data !== undefined && data !== null) todaySummaryState.data = data;
  if (cafe !== undefined && cafe !== null) todaySummaryState.cafe = cafe;
  if (meta !== undefined && meta !== null) todaySummaryState.meta = meta;
  if (comparison !== undefined && comparison !== null) todaySummaryState.comparison = comparison;
  if (marketing !== undefined && marketing !== null) todaySummaryState.marketing = marketing;
  if (totalSales !== undefined && totalSales !== null) todaySummaryState.totalSales = totalSales;

  const briefingTarget = $("#todaySummaryBriefing");
  const sectionsTarget = $("#todaySummarySections");
  if (!briefingTarget || !sectionsTarget) return;

  const state = todaySummaryState;
  const cafeTotals = state.cafe?.totals || {};
  const comparisonState = state.comparison || {};
  const marketingState = state.marketing || {};
  const totalSalesState = state.totalSales || {};
  const posts = state.data?.posts || [];
  const contentViews = sum(posts, "views");
  const metaAge = relativeAgeText(cacheAgeMinutes(state.meta || {}));
  const salesInfo = todaySummarySalesInfo(totalSalesState, cafeTotals);
  const marketingValue = marketingState.adSpendShare === null || marketingState.adSpendShare === undefined ? "확인 필요" : pct(marketingState.adSpendShare);
  const marketingBriefingValue = marketingState.briefingCount === null || marketingState.briefingCount === undefined
    ? "확인 필요"
    : `관리 필요 캠페인 ${apiNum(marketingState.briefingCount)}건`;

  briefingTarget.innerHTML = [
    salesCompareCard("Commerce", comparisonState.comparable ? `오차 ${comparisonState.mismatchRate < 1 ? comparisonState.mismatchRate.toFixed(1) : Math.round(comparisonState.mismatchRate)}%` : "비교 불가", "기존 Sales 비교 결과", { status: !comparisonState.comparable, badge: { label: "Commerce", tone: "neutral" } }),
    salesCompareCard("Marketing", marketingBriefingValue, marketingState.narrative || "관리 필요 캠페인 결과를 확인 중입니다.", { badge: { label: "Marketing", tone: "neutral" } }),
    salesCompareCard("Meta Ads Cache", metaAge || "확인 필요", "기존 cache freshness 기준", { status: !metaAge, badge: { label: "Meta", tone: "cache" } })
  ].join("");

  sectionsTarget.innerHTML = [
    `<article class="action-item sales-compare-card"><span>${esc(salesInfo.label)}</span><strong>${esc(salesInfo.value)}</strong><p>${esc(salesInfo.note)}</p><button class="today-jump-button" type="button" data-jump-view="Sales">Commerce 보기</button></article>`,
    `<article class="action-item sales-compare-card"><span>Marketing</span><strong>${marketingValue}</strong><p>광고비 / 실제 매출</p><button class="today-jump-button" type="button" data-jump-view="Advertising">Marketing 보기</button></article>`,
    `<article class="action-item sales-compare-card"><span>Content</span><strong>${apiNum(contentViews)}</strong><p>전체 게시물 조회 합산</p><button class="today-jump-button" type="button" data-jump-view="Content">Content 보기</button></article>`,
    `<article class="action-item sales-compare-card"><span>Reports</span><strong>Monthly Report</strong><p>월간 확정 스냅샷</p><button class="today-jump-button" type="button" data-jump-view="Reports">월간 리포트 보기</button></article>`
  ].join("");
}

function shiftMonthKey(monthKey, offset) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function todayDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function salesCalendarMonthLabel(monthKey) {
  const [year, month] = String(monthKey || "").split("-");
  return `${year}년 ${Number(month)}월`;
}

function todaySalesCalendarMonths() {
  return Array.from(new Set(months));
}

function normalizeTodaySalesCalendarMonth(monthKey) {
  const options = todaySalesCalendarMonths();
  return options.includes(monthKey) ? monthKey : options[0] || monthKey;
}

function shiftTodaySalesCalendarMonth(monthKey, offset) {
  const options = todaySalesCalendarMonths();
  const currentIndex = Math.max(0, options.indexOf(normalizeTodaySalesCalendarMonth(monthKey)));
  const nextIndex = currentIndex - Number(offset || 0);
  return options[nextIndex] || options[currentIndex] || monthKey;
}

function todaySalesCalendarMonthSwitchHtml(monthKey) {
  const options = todaySalesCalendarMonths();
  const current = normalizeTodaySalesCalendarMonth(monthKey);
  const currentIndex = options.indexOf(current);
  const olderDisabled = currentIndex === -1 || currentIndex >= options.length - 1;
  const newerDisabled = currentIndex <= 0;
  return `<div class="today-sales-calendar-month-switch" aria-label="캘린더 월 선택">
    <button class="month-nav-btn" type="button" data-sales-calendar-nav="-1" ${olderDisabled ? "disabled" : ""} aria-label="이전 달">◀</button>
    <select data-sales-calendar-month aria-label="캘린더 월 선택">
      ${options.map((month) => `<option value="${esc(month)}" ${month === current ? "selected" : ""}>${esc(salesCalendarMonthLabel(month))}</option>`).join("")}
    </select>
    <button class="month-nav-btn" type="button" data-sales-calendar-nav="1" ${newerDisabled ? "disabled" : ""} aria-label="다음 달">▶</button>
  </div>`;
}

function salesCalendarLongDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return String(dateKey || "");
  const date = new Date(`${dateKey}T00:00:00`);
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
  return `${dateKey} (${weekday})`;
}

function normalizeDailySalesMap(rows = [], amountKey = "paidAmount") {
  const map = new Map();
  for (const row of rows || []) {
    const date = String(row?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const amount = Number(row?.[amountKey]);
    const orderCount = Number(row?.orderCount);
    const revenueLineCount = Number(row?.revenueLineCount);
    const totalLineCount = Number(row?.totalLineCount);
    const quantity = Number(row?.quantity);
    map.set(date, {
      amount: Number.isFinite(amount) ? amount : 0,
      orderCount: Number.isFinite(orderCount) ? orderCount : 0,
      revenueLineCount: Number.isFinite(revenueLineCount) ? revenueLineCount : 0,
      totalLineCount: Number.isFinite(totalLineCount) ? totalLineCount : 0,
      quantity: Number.isFinite(quantity) ? quantity : 0
    });
  }
  return map;
}

function buildTodaySalesCalendarRows(monthKey, onlineData = {}, offlineData = {}) {
  const start = `${monthKey}-01`;
  const end = monthEnd(monthKey);
  const today = todayDateKey();
  const onlineOk = !onlineData.error && Array.isArray(onlineData.dailySales);
  const offlineOk = !offlineData.error && Array.isArray(offlineData.dailySales);
  const onlineMap = normalizeDailySalesMap(onlineData.dailySales, "paidAmount");
  const offlineMap = normalizeDailySalesMap(offlineData.dailySales, "offlineSalesAmount");
  const offlinePeriodStart = offlineOk ? String(offlineData.periodStart || "") : "";
  const offlinePeriodEnd = offlineOk ? String(offlineData.periodEnd || "") : "";
  const rows = [];
  const dayCount = Number(end.slice(-2));
  for (let day = 1; day <= dayCount; day += 1) {
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    const onlineRow = onlineMap.get(date) || { amount: 0, orderCount: 0 };
    const offlineRow = offlineMap.get(date) || { amount: 0, orderCount: 0 };
    const future = date > today;
    const offlineAvailable = offlineOk && (!offlinePeriodStart || offlinePeriodStart <= date) && (!offlinePeriodEnd || date <= offlinePeriodEnd);
    rows.push({
      date,
      day,
      future,
      onlineSales: onlineOk ? onlineRow.amount : null,
      offlineSales: offlineAvailable ? offlineRow.amount : null,
      totalSales: (onlineOk ? onlineRow.amount : 0) + (offlineAvailable ? offlineRow.amount : 0),
      onlineOrderCount: onlineOk ? onlineRow.orderCount : null,
      offlineRevenueLineCount: offlineAvailable ? offlineRow.revenueLineCount : null,
      offlineTotalLineCount: offlineAvailable ? offlineRow.totalLineCount : null,
      offlineQuantity: offlineAvailable ? offlineRow.quantity : null,
      onlineAvailable: onlineOk,
      offlineAvailable
    });
  }
  return rows;
}

function salesHeatLevel(value, maxValue) {
  const amount = Number(value || 0);
  const max = Number(maxValue || 0);
  if (!max || amount <= 0) return 0;
  return Math.max(1, Math.min(5, Math.ceil((amount / max) * 5)));
}

function todaySalesCalendarCell(row, maxDailySales) {
  if (!row) return `<div class="today-sales-calendar-cell is-outside" aria-hidden="true"></div>`;
  const level = salesHeatLevel(row.totalSales, maxDailySales);
  const unavailable = !row.onlineAvailable || !row.offlineAvailable;
  const zero = !row.future && !unavailable && Number(row.totalSales || 0) === 0;
  const isToday = row.date === todayDateKey();
  const classes = [
    "today-sales-calendar-cell",
    `sales-heat-${level}`,
    row.future ? "is-future" : "",
    isToday ? "is-today" : "",
    zero ? "is-zero" : "",
    unavailable ? "is-unavailable" : ""
  ].filter(Boolean).join(" ");
  const status = row.future
    ? "미래 날짜"
    : unavailable
      ? `${row.onlineAvailable ? "" : "온라인 미확인"}${!row.onlineAvailable && !row.offlineAvailable ? " · " : ""}${row.offlineAvailable ? "" : "오프라인 미확인"}`
      : zero ? "매출 0원" : "정상 데이터";
  const dataAttrs = [
    `data-date="${esc(row.date)}"`,
    `data-total="${esc(row.totalSales)}"`,
    `data-online="${esc(row.onlineSales ?? "")}"`,
    `data-offline="${esc(row.offlineSales ?? "")}"`,
    `data-online-orders="${esc(row.onlineOrderCount ?? "")}"`,
    `data-offline-revenue-lines="${esc(row.offlineRevenueLineCount ?? "")}"`,
    `data-offline-total-lines="${esc(row.offlineTotalLineCount ?? "")}"`,
    `data-offline-quantity="${esc(row.offlineQuantity ?? "")}"`,
    `data-status="${esc(status)}"`
  ].join(" ");
  return `<div class="${classes}" tabindex="0" aria-label="${esc(`${row.date} 총매출 ${apiWon(row.totalSales)} ${status}`)}" data-sales-calendar-tooltip="day" ${dataAttrs}>
    <div class="today-sales-calendar-dayline">${isToday ? `<b>TODAY</b>` : ""}<span>${apiNum(row.day)}</span></div>
    <strong>${krw(row.totalSales)}</strong>
    <div class="today-sales-source-dots">
      <i class="today-sales-source-dot is-online ${row.onlineAvailable ? "" : "is-muted"}" tabindex="0" data-sales-calendar-tooltip="online" ${dataAttrs}></i>
      <i class="today-sales-source-dot is-offline ${row.offlineAvailable ? "" : "is-muted"}" tabindex="0" data-sales-calendar-tooltip="offline" ${dataAttrs}></i>
    </div>
  </div>`;
}

function finiteTooltipNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finitePositiveDayCount(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end || ""))) return null;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const diff = Math.round((endDate - startDate) / 86400000) + 1;
  return Number.isFinite(diff) && diff > 0 ? diff : null;
}

function todaySalesTooltipSection(title, value, details = [], tone = "") {
  return `<section class="today-sales-tooltip-section ${tone ? `is-${esc(tone)}` : ""}">
    <span>${esc(title)}</span>
    <strong>${esc(value)}</strong>
    ${details.length ? `<p>${details.map(esc).join(" · ")}</p>` : ""}
  </section>`;
}

function todaySalesCalendarTooltipHtml(target) {
  const mode = target?.dataset?.salesCalendarTooltip || "day";
  const date = target?.dataset?.date || "";
  const total = finiteTooltipNumber(target?.dataset?.total);
  const online = finiteTooltipNumber(target?.dataset?.online);
  const offline = finiteTooltipNumber(target?.dataset?.offline);
  const onlineOrders = finiteTooltipNumber(target?.dataset?.onlineOrders);
  const offlineRevenueLines = finiteTooltipNumber(target?.dataset?.offlineRevenueLines);
  const offlineTotalLines = finiteTooltipNumber(target?.dataset?.offlineTotalLines);
  const offlineQuantity = finiteTooltipNumber(target?.dataset?.offlineQuantity);
  const onlineQuantity = finiteTooltipNumber(target?.dataset?.onlineQuantity);
  const onlineExcludedOrders = finiteTooltipNumber(target?.dataset?.onlineExcludedOrders);
  const onlineCheckedOrders = finiteTooltipNumber(target?.dataset?.onlineCheckedOrders);
  const onlinePaymentMethods = target?.dataset?.onlinePaymentMethods || "";
  const offlineNonRevenueLines = finiteTooltipNumber(target?.dataset?.offlineNonRevenueLines);
  const offlineAverageRevenueLines = finiteTooltipNumber(target?.dataset?.offlineAverageRevenueLines);
  const offlinePeriod = target?.dataset?.offlinePeriod || "";
  const status = target?.dataset?.status || "상태 확인";
  if (mode === "summary-online-sales") {
    const averageOrder = online !== null && onlineOrders > 0 ? online / onlineOrders : null;
    return `<div class="today-sales-tooltip-card">
      <h5>온라인 판매 요약</h5>
      ${todaySalesTooltipSection("매출", online === null ? "미확인" : apiWon(online), [
        `정상 주문 ${onlineOrders === null ? "미확인" : `${apiNum(onlineOrders)}건`}`,
        `객단가 ${averageOrder === null ? "-" : apiWon(averageOrder)}`,
        `판매수량 ${onlineQuantity === null ? "미확인" : `${apiNum(onlineQuantity)}개`}`,
        `제외 주문 ${onlineExcludedOrders === null ? "미확인" : `${apiNum(onlineExcludedOrders)}건`}`
      ], "online")}
      <p>Cafe24 Canonical 기준</p>
    </div>`;
  }
  if (mode === "summary-online-orders") {
    return `<div class="today-sales-tooltip-card">
      <h5>온라인 주문 요약</h5>
      ${todaySalesTooltipSection("Cafe24 canonical 기준", onlineOrders === null ? "미확인" : `정상 주문 ${apiNum(onlineOrders)}건`, [
        `제외 주문 ${onlineExcludedOrders === null ? "미확인" : `${apiNum(onlineExcludedOrders)}건`}`,
        `전체 확인 주문 ${onlineCheckedOrders === null ? "미확인" : `${apiNum(onlineCheckedOrders)}건`}`,
        `판매수량 ${onlineQuantity === null ? "미확인" : `${apiNum(onlineQuantity)}개`}`
      ], "online")}
    </div>`;
  }
  if (mode === "summary-offline-sales") {
    return `<div class="today-sales-tooltip-card">
      <h5>오프라인 판매 요약</h5>
      ${todaySalesTooltipSection("매출", offline === null ? "미확인" : apiWon(offline), [
        `매출 Line ${offlineRevenueLines === null ? "미확인" : `${apiNum(offlineRevenueLines)}건`}`,
        `전체 Line ${offlineTotalLines === null ? "미확인" : `${apiNum(offlineTotalLines)}건`}`,
        `판매수량 ${offlineQuantity === null ? "미확인" : `${apiNum(offlineQuantity)}개`}`,
        offlinePeriod ? `반영 범위 ${offlinePeriod}` : "ECOUNT 데이터 없음"
      ], "offline")}
    </div>`;
  }
  if (mode === "summary-offline-lines") {
    return `<div class="today-sales-tooltip-card">
      <h5>오프라인 거래 요약</h5>
      ${todaySalesTooltipSection("매출 Line", offlineRevenueLines === null ? "미확인" : `${apiNum(offlineRevenueLines)}건`, [
        `전체 Line ${offlineTotalLines === null ? "미확인" : `${apiNum(offlineTotalLines)}건`}`,
        `비매출 Line ${offlineNonRevenueLines === null ? "미확인" : `${apiNum(offlineNonRevenueLines)}건`}`,
        `판매수량 ${offlineQuantity === null ? "미확인" : `${apiNum(offlineQuantity)}개`}`,
        `일평균 매출 Line ${offlineAverageRevenueLines === null ? "미확인" : `${offlineAverageRevenueLines.toFixed(1)}건`}`
      ], "offline")}
    </div>`;
  }
  if (mode === "online") {
    const averageOrder = online !== null && onlineOrders > 0 ? online / onlineOrders : null;
    return `<div class="today-sales-tooltip-card">
      <h5>온라인 요약</h5>
      ${todaySalesTooltipSection("매출", online === null ? "미확인" : apiWon(online), [
        `주문 ${onlineOrders === null ? "미확인" : `${apiNum(onlineOrders)}건`}`,
        `객단가 ${averageOrder === null ? "-" : apiWon(averageOrder)}`
      ], "online")}
    </div>`;
  }
  if (mode === "offline") {
    return `<div class="today-sales-tooltip-card">
      <h5>오프라인 요약</h5>
      ${todaySalesTooltipSection("매출", offline === null ? "미확인" : apiWon(offline), [
        `매출 Line ${offlineRevenueLines === null ? "미확인" : `${apiNum(offlineRevenueLines)}건`}`,
        `전체 Line ${offlineTotalLines === null ? "미확인" : `${apiNum(offlineTotalLines)}건`}`,
        `판매수량 ${offlineQuantity === null ? "미확인" : apiNum(offlineQuantity)}`
      ], "offline")}
    </div>`;
  }
  return `<div class="today-sales-tooltip-card">
    <h5>${esc(salesCalendarLongDate(date))}</h5>
    ${todaySalesTooltipSection("총매출", total === null ? "미확인" : apiWon(total))}
    <hr>
    ${todaySalesTooltipSection("온라인", online === null ? "미확인" : apiWon(online), [
      `주문 ${onlineOrders === null ? "미확인" : `${apiNum(onlineOrders)}건`}`
    ], "online")}
    <hr>
    ${todaySalesTooltipSection("오프라인", offline === null ? "미확인" : apiWon(offline), [
      `매출 Line ${offlineRevenueLines === null ? "미확인" : `${apiNum(offlineRevenueLines)}건`}`,
      `판매수량 ${offlineQuantity === null ? "미확인" : apiNum(offlineQuantity)}`
    ], "offline")}
    <p>${esc(status)}</p>
  </div>`;
}

function todaySalesCalendarTooltipNode() {
  let tooltip = $("#todaySalesCalendarTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "todaySalesCalendarTooltip";
    tooltip.className = "today-sales-calendar-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function positionTodaySalesCalendarTooltip(anchor, tooltip) {
  const margin = 14;
  const gap = 10;
  const rect = anchor.getBoundingClientRect();
  const size = tooltip.getBoundingClientRect();
  const width = size.width || tooltip.offsetWidth || 240;
  const height = size.height || tooltip.offsetHeight || 180;
  let left = rect.left + (rect.width / 2) - (width / 2);
  let top = rect.bottom + gap;
  if (left + width + margin > window.innerWidth) left = rect.right - width;
  if (left < margin) left = rect.left;
  if (top + height + margin > window.innerHeight) top = rect.top - height - gap;
  left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin));
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showTodaySalesCalendarTooltip(target, event) {
  const tooltip = todaySalesCalendarTooltipNode();
  if (!tooltip) return;
  tooltip.innerHTML = todaySalesCalendarTooltipHtml(target);
  tooltip.classList.remove("is-visible");
  tooltip.hidden = false;
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  positionTodaySalesCalendarTooltip(target, tooltip, event);
  requestAnimationFrame(() => tooltip.classList.add("is-visible"));
}

function hideTodaySalesCalendarTooltip() {
  const tooltip = $("#todaySalesCalendarTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("is-visible");
  tooltip.hidden = true;
}

function todaySalesCalendarLoadingHtml(monthKey) {
  const cells = Array.from({ length: 35 }, () => `<div class="today-sales-calendar-cell today-sales-calendar-skeleton"></div>`).join("");
  return `<section class="today-sales-calendar monthly-report-block is-loading">
    <div class="monthly-report-block-head">
      <div>
        <h4>월간 일별 매출 캘린더</h4>
      </div>
      ${todaySalesCalendarMonthSwitchHtml(monthKey)}
    </div>
    <div class="monthly-report-hero today-sales-calendar-summary">
      <div class="monthly-report-hero-main"><span>월 누적 총매출</span><strong>확인 중</strong><p class="monthly-report-muted">일별 온라인 + 오프라인 합산</p></div>
      <div class="monthly-report-side">
        <div class="monthly-report-side-row"><span>온라인</span><strong>확인 중</strong></div>
        <div class="monthly-report-side-row"><span>오프라인</span><strong>확인 중</strong></div>
        <div class="monthly-report-side-row"><span>온라인 주문</span><strong>확인 중</strong></div>
        <div class="monthly-report-side-row"><span>오프라인 매출 건수</span><strong>확인 중</strong></div>
      </div>
    </div>
    <div class="today-sales-calendar-weekdays">
      ${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="today-sales-calendar-grid">${cells}</div>
    <div class="today-sales-calendar-loading-overlay" aria-hidden="true"><span></span></div>
  </section>`;
}

function todaySalesCalendarSummaryHtml(rows = [], onlineData = {}, offlineData = {}) {
  const onlineTotal = rows.reduce((sumValue, row) => sumValue + (row.onlineAvailable ? Number(row.onlineSales || 0) : 0), 0);
  const offlineTotal = rows.reduce((sumValue, row) => sumValue + (row.offlineAvailable ? Number(row.offlineSales || 0) : 0), 0);
  const total = onlineTotal + offlineTotal;
  const onlineOrderCount = rows.reduce((sumValue, row) => sumValue + (row.onlineAvailable ? Number(row.onlineOrderCount || 0) : 0), 0);
  const onlineQuantity = Number(onlineData?.totals?.quantitySold);
  const onlineExcludedOrders = Number(onlineData?.excludedOrderCount);
  const onlineCheckedOrders = Number.isFinite(onlineExcludedOrders) ? onlineOrderCount + onlineExcludedOrders : null;
  const onlinePaymentMethods = Array.isArray(onlineData?.paymentMethods)
    ? onlineData.paymentMethods
      .filter((item) => Number(item?.orderAmount || 0) > 0)
      .slice(0, 4)
      .map((item) => `${item.paymentMethod || "기타"} ${apiWon(item.orderAmount)}`)
      .join(" · ")
    : "";
  const offlineRevenueLineCount = rows.reduce((sumValue, row) => sumValue + (row.offlineAvailable ? Number(row.offlineRevenueLineCount || 0) : 0), 0);
  const offlineTotalLineCount = rows.reduce((sumValue, row) => sumValue + (row.offlineAvailable ? Number(row.offlineTotalLineCount || 0) : 0), 0);
  const offlineQuantity = rows.reduce((sumValue, row) => sumValue + (row.offlineAvailable ? Number(row.offlineQuantity || 0) : 0), 0);
  const offlineNonRevenueLineCount = Number.isFinite(offlineTotalLineCount) && Number.isFinite(offlineRevenueLineCount)
    ? Math.max(0, offlineTotalLineCount - offlineRevenueLineCount)
    : null;
  const reflectedDayCount = finitePositiveDayCount(offlineData?.periodStart, offlineData?.periodEnd);
  const offlineAverageRevenueLines = reflectedDayCount ? offlineRevenueLineCount / reflectedDayCount : null;
  const offlinePeriod = offlineData?.periodStart && offlineData?.periodEnd ? `${offlineData.periodStart} ~ ${offlineData.periodEnd}` : "";
  const onlineApiTotal = Number(onlineData?.totals?.paidAmount);
  const offlineApiTotal = Number(offlineData?.totalOfflineSales);
  if (!onlineData.error && Number.isFinite(onlineApiTotal) && onlineApiTotal !== onlineTotal) {
    console.warn("Today sales calendar online total mismatch", { api: onlineApiTotal, daily: onlineTotal });
  }
  if (!offlineData.error && Number.isFinite(offlineApiTotal) && offlineApiTotal !== offlineTotal) {
    console.warn("Today sales calendar offline total mismatch", { api: offlineApiTotal, daily: offlineTotal });
  }
  const summaryAttrs = [
    `data-online="${esc(onlineData.error ? "" : onlineTotal)}"`,
    `data-online-orders="${esc(onlineData.error ? "" : onlineOrderCount)}"`,
    `data-online-quantity="${esc(Number.isFinite(onlineQuantity) ? onlineQuantity : "")}"`,
    `data-online-excluded-orders="${esc(Number.isFinite(onlineExcludedOrders) ? onlineExcludedOrders : "")}"`,
    `data-online-checked-orders="${esc(onlineCheckedOrders ?? "")}"`,
    `data-online-payment-methods="${esc(onlinePaymentMethods)}"`,
    `data-offline="${esc(offlineData.error ? "" : offlineTotal)}"`,
    `data-offline-revenue-lines="${esc(offlineData.error ? "" : offlineRevenueLineCount)}"`,
    `data-offline-total-lines="${esc(offlineData.error ? "" : offlineTotalLineCount)}"`,
    `data-offline-non-revenue-lines="${esc(offlineData.error ? "" : (offlineNonRevenueLineCount ?? ""))}"`,
    `data-offline-quantity="${esc(offlineData.error ? "" : offlineQuantity)}"`,
    `data-offline-average-revenue-lines="${esc(offlineData.error ? "" : (offlineAverageRevenueLines ?? ""))}"`,
    `data-offline-period="${esc(offlineData.error ? "" : offlinePeriod)}"`
  ].join(" ");
  const summaryRow = (label, value, mode) => (
    `<div class="monthly-report-side-row today-sales-summary-trigger" tabindex="0" role="button" aria-label="${esc(`${label} 상세 보기`)}" data-sales-calendar-tooltip="${esc(mode)}" ${summaryAttrs}><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`
  );
  return `<div class="monthly-report-hero today-sales-calendar-summary">
    <div class="monthly-report-hero-main">
      <span>월 누적 총매출</span>
      <strong>${apiWon(total)}</strong>
      <p class="monthly-report-muted">일별 온라인 + 오프라인 합산</p>
    </div>
    <div class="monthly-report-side">
      ${summaryRow("온라인 매출", onlineData.error ? "미확인" : apiWon(onlineTotal), "summary-online-sales")}
      ${summaryRow("오프라인 매출", offlineData.error ? "미확인" : apiWon(offlineTotal), "summary-offline-sales")}
      ${summaryRow("온라인 주문", onlineData.error ? "미확인" : `${apiNum(onlineOrderCount)}건`, "summary-online-orders")}
      ${summaryRow("오프라인 매출 건수", offlineData.error ? "미확인" : `${apiNum(offlineRevenueLineCount)}건`, "summary-offline-lines")}
    </div>
  </div>`;
}

function todaySalesCalendarCoverageNote(monthKey, onlineData = {}, offlineData = {}) {
  const notes = [];
  if (onlineData.error) notes.push(`온라인 매출을 확인하지 못했습니다: ${onlineData.error}`);
  if (offlineData.error) {
    notes.push(`오프라인 매출 snapshot이 없거나 확인되지 않았습니다.`);
  } else if (offlineData.periodStart && offlineData.periodEnd) {
    const start = `${monthKey}-01`;
    const end = monthEnd(monthKey);
    if (offlineData.periodStart > start || offlineData.periodEnd < end) {
      notes.push(`오프라인 매출은 ${offlineData.periodStart} ~ ${offlineData.periodEnd} 범위까지 반영되었습니다.`);
    } else {
      notes.push(`오프라인 매출은 ${offlineData.periodStart} ~ ${offlineData.periodEnd} 기준으로 반영되었습니다.`);
    }
  }
  return notes.length ? `<p class="monthly-report-fnote">${notes.map(esc).join(" · ")}</p>` : "";
}

async function renderTodaySalesCalendar(monthKey = todaySalesCalendarMonth) {
  const target = $("#todaySalesCalendar");
  if (!target) return;
  monthKey = normalizeTodaySalesCalendarMonth(monthKey);
  todaySalesCalendarMonth = monthKey;
  const renderSeq = ++todaySalesCalendarRenderSeq;
  const start = `${monthKey}-01`;
  const end = monthEnd(monthKey);
  const existingCalendar = target.querySelector(".today-sales-calendar");
  hideTodaySalesCalendarTooltip();
  if (existingCalendar) {
    existingCalendar.classList.add("is-loading");
    const switchTarget = existingCalendar.querySelector(".today-sales-calendar-month-switch");
    if (switchTarget) switchTarget.outerHTML = todaySalesCalendarMonthSwitchHtml(monthKey);
  } else {
    target.innerHTML = todaySalesCalendarLoadingHtml(monthKey);
  }
  const [onlineData, offlineData] = await Promise.all([
    getJson(`/api/diagnostics/brand-sales?since=${start}&until=${end}`, 12000),
    getJson(`/api/ecount-sales/monthly?month=${monthKey}`, 8000)
  ]);
  if (renderSeq !== todaySalesCalendarRenderSeq) return;
  const rows = buildTodaySalesCalendarRows(monthKey, onlineData, offlineData);
  const maxDailySales = rows.reduce((max, row) => Math.max(max, Number(row.totalSales || 0)), 0);
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const leading = Array.from({ length: firstDay }, () => null);
  const cells = [...leading, ...rows];
  target.innerHTML = `<section class="today-sales-calendar monthly-report-block">
    <div class="monthly-report-block-head">
      <div>
        <h4>월간 일별 매출 캘린더</h4>
      </div>
      ${todaySalesCalendarMonthSwitchHtml(monthKey)}
    </div>
    ${todaySalesCalendarSummaryHtml(rows, onlineData, offlineData)}
    ${todaySalesCalendarCoverageNote(monthKey, onlineData, offlineData)}
    <div class="today-sales-calendar-weekdays">
      ${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="today-sales-calendar-grid">
      ${cells.map((row) => todaySalesCalendarCell(row, maxDailySales)).join("")}
    </div>
    <div class="today-sales-calendar-loading-overlay" aria-hidden="true"><span></span></div>
  </section>`;
  requestAnimationFrame(() => target.querySelector(".today-sales-calendar")?.classList.add("is-ready"));
}

function salesConnectionState(error) {
  const raw = String(error || "Cafe24 연결 상태를 확인할 수 없습니다.");
  const lowered = raw.toLowerCase();
  if (lowered.includes("refresh_token") || lowered.includes("invalid_token") || lowered.includes("access_token")) {
    return {
      title: "Cafe24 연결이 만료되었습니다.",
      note: "다시 인증하면 Sales 데이터가 자동 복구됩니다.",
      detail: raw
    };
  }
  return {
    title: "Cafe24 데이터를 불러오지 못했습니다.",
    note: "연결 상태를 확인한 뒤 다시 불러와 주세요.",
    detail: raw
  };
}

function salesWarningCard(state) {
  return `<article class="action-item urgent sales-warning-card">
    <span>연결 필요</span>
    <strong>${esc(state.title)}</strong>
    <p>${esc(state.note)}</p>
    <small>${esc(state.detail)}</small>
  </article>`;
}

function opsStatRow(label, value, { muted = false, note = "" } = {}) {
  return `<div class="ops-summary-srow ${muted ? "is-muted" : ""}">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
    ${note ? `<em>${esc(note)}</em>` : ""}
  </div>`;
}

function opsCompareRow(label, note, amountHtml, ratioPct, { estimated = false } = {}) {
  return `<div class="ops-summary-compare-row ${estimated ? "is-estimated" : ""}">
    <div><strong>${esc(label)}</strong><span>${esc(note)}</span></div>
    <div class="ops-summary-bar"><i style="width:${monthlyReportRatio(ratioPct, 100)}%"></i></div>
    <em>${esc(amountHtml)}</em>
  </div>`;
}

function opsRankRow(index, title, valueHtml) {
  return `<div class="ops-summary-rank-row">
    <span class="ops-summary-rank-no">${String(index + 1).padStart(2, "0")}</span>
    <strong>${esc(title || "-")}</strong>
    <em>${esc(valueHtml || "-")}</em>
  </div>`;
}

function salesKpiCard(title, value, note, className = "") {
  return `<article class="action-item sales-kpi-card ${esc(className)}">
    <span>${esc(title)}</span>
    <strong>${esc(value)}</strong>
    <p>${esc(note)}</p>
  </article>`;
}

function salesPaymentCard(payments = [], totalAmount = 0) {
  const empty = !payments.length;
  return `<article class="action-item sales-list-card ${empty ? "sales-empty-card" : ""}">
    <span>결제수단</span>
    ${empty ? "" : `<strong>${esc(payments[0]?.paymentMethod || "-")}</strong>`}
    ${payments.length ? `<ul>${payments.slice(0, 5).map((item) => {
      const share = totalAmount ? `${Math.round((Number(item.orderAmount || 0) / totalAmount) * 100)}%` : `${apiNum(item.orderCount)}건`;
      return `<li>
        <div><b>${esc(item.paymentMethod || "미확인")}</b><small>${apiNum(item.orderCount)}건 · ${share}</small></div>
        <em>${apiWon(item.orderAmount)}</em>
      </li>`;
    }).join("")}</ul>` : `<p>데이터가 없습니다.</p>`}
  </article>`;
}

function salesTopProductsCard(products = []) {
  const empty = !products.length;
  return `<article class="action-item sales-list-card sales-products-card ${empty ? "sales-empty-card" : ""}">
    <span>TOP 상품</span>
    ${empty ? "" : `<strong>${esc(products[0]?.productName || "-")}</strong>`}
    ${products.length ? `<ol>${products.slice(0, 5).map((item, index) => (
      `<li>
        <mark>${index + 1}</mark>
        <div>
          <small>${esc(brandFromProduct(item.productName || ""))}</small>
          <b title="${esc(item.productName || "-")}">${esc(item.productName || "-")}</b>
          <p>판매수량 ${apiNum(item.quantity)}개</p>
        </div>
        <em>${apiWon(item.itemAmount)}</em>
      </li>`
    )).join("")}</ol>` : `<p>데이터가 없습니다.</p>`}
  </article>`;
}

function normalizeCafe24PaymentMethods(paymentMethods = [], orders = []) {
  const normalized = paymentMethods
    .map((item) => ({
      paymentMethod: item.paymentMethod || item.payment_method_name || item.payment_method || item.name || "미확인",
      orderCount: Number(item.orderCount || item.order_count || item.count || 0),
      orderAmount: Number(item.orderAmount || item.order_amount || item.amount || 0)
    }))
    .filter((item) => item.paymentMethod && item.paymentMethod !== "-");
  if (normalized.length) return normalized;
  const map = new Map();
  for (const order of orders) {
    const method = cafe24PaymentMethodName(order);
    const current = map.get(method) || { paymentMethod: method, orderCount: 0, orderAmount: 0 };
    current.orderCount += 1;
    current.orderAmount += cafe24OrderDisplayAmount(order);
    map.set(method, current);
  }
  return [...map.values()].sort((left, right) => right.orderAmount - left.orderAmount);
}

function normalizeCafe24TopProducts(topProducts = [], orders = []) {
  const normalized = topProducts
    .map((item) => ({
      productName: item.productName || item.product_name || item.item_name || item.name || "",
      quantity: Number(item.quantity || item.qty || item.product_quantity || 0),
      itemAmount: Number(item.itemAmount || item.item_amount || item.orderAmount || item.amount || 0)
    }))
    .filter((item) => item.productName && item.productName !== "-");
  if (normalized.length) return normalized;
  const map = new Map();
  for (const order of orders) {
    for (const item of cafe24OrderDisplayItems(order)) {
      const productName = item.product_name || item.productName || item.product_name_default || item.item_name || item.name || "";
      if (!productName) continue;
      const quantity = cafe24ItemDisplayQuantity(item);
      const current = map.get(productName) || { productName, quantity: 0, itemAmount: 0 };
      current.quantity += quantity;
      current.itemAmount += cafe24ItemDisplayAmount(item, quantity);
      map.set(productName, current);
    }
  }
  return [...map.values()].sort((left, right) => right.itemAmount - left.itemAmount);
}

function cafe24PaymentMethodName(order = {}) {
  const raw = order.payment_method_name || order.payment_method || order.payment_methods?.[0]?.payment_method || "미확인";
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((value) => String(value || "").trim()).filter(Boolean).join(" + ") || "미확인";
}

function cafe24OrderDisplayAmount(order = {}) {
  return cafe24MoneyValue(order.actual_order_amount?.payment_amount)
    || cafe24MoneyValue(order.actual_payment_amount)
    || cafe24MoneyValue(order.payment_amount)
    || cafe24MoneyValue(order.actual_order_amount?.order_price_amount)
    || cafe24MoneyValue(order.order_price_amount)
    || cafe24MoneyValue(order.initial_order_amount?.payment_amount)
    || cafe24MoneyValue(order.initial_order_amount?.order_price_amount)
    || cafe24MoneyValue(order.order_amount)
    || cafe24MoneyValue(order.total_price);
}

function cafe24OrderDisplayItems(order = {}) {
  for (const candidate of [order.items, order.order_items, order.products, order.order_item]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function cafe24ItemDisplayQuantity(item = {}) {
  const quantity = Number(item.quantity || item.qty || item.product_quantity || item.order_quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function cafe24ItemDisplayAmount(item = {}, quantity = 1) {
  const amount = cafe24MoneyValue(item.actual_payment_amount)
    || cafe24MoneyValue(item.order_price_amount)
    || cafe24MoneyValue(item.product_price)
    || cafe24MoneyValue(item.price)
    || cafe24MoneyValue(item.sale_price)
    || cafe24MoneyValue(item.supply_price);
  return amount * quantity;
}

async function renderAdComparison(data, renderSeq) {
  const healthTarget = $("#salesHealthBanner");
  if (!healthTarget) return;
  const range = operationsDateRange(data);
  const startDate = range.since;
  const endDate = range.until;
  const [meta, cafe] = await Promise.all([
    getSharedJson(`/api/meta-ads/summary?since=${startDate}&until=${endDate}`, 7000),
    getSharedJson(`/api/diagnostics/brand-sales?since=${startDate}&until=${endDate}`, 8000)
  ]);
  if (renderSeq !== undefined && renderSeq !== operationsRenderSeq) return;
  const comparison = commerceMetaComparisonState(meta, cafe);

  const decision = salesDecisionState({ meta, cafe, ...comparison });
  renderCommerceSummary(cafe, comparison);

  healthTarget.className = `ad-status-banner ${esc(decision.tone)}`;
  healthTarget.innerHTML = `<span class="status-dot"></span><strong>Sales Health · ${esc(decision.label)}</strong><span class="note">${esc(decision.reason)}</span>`;
}

function commerceMetaComparisonState(meta = {}, cafe = {}) {
  const metaTotals = meta.totals || {};
  const cafeTotals = cafe.totals || {};
  const metaPurchaseValue = hasApiValue(metaTotals.purchaseValue) ? Number(metaTotals.purchaseValue) : null;
  const cafeOrderAmount = hasApiValue(cafeTotals.paidAmount) ? Number(cafeTotals.paidAmount) : null;
  // source readiness 판정: 라이브 데이터가 정상으로 왔을 때만 Meta↔Cafe24 비교를 계산한다.
  // Cafe24가 실패했거나(error) 오류 후 캐시 폴백(cacheWarning)이면 값을 0으로 간주하거나
  // 오차율을 만들지 않는다 — "오차 100%" 오경보 방지. Meta 구매값이 0이어도 오차율은
  // 자동으로 100%가 되므로 계산하지 않고 판단 보류로 안내한다. (2026-07-10)
  const cafeReady = !cafe.error && !cafe.cacheWarning && cafeOrderAmount !== null;
  const metaReady = !meta.error && metaPurchaseValue !== null;
  const comparable = cafeReady && metaReady && cafeOrderAmount > 0 && metaPurchaseValue > 0;
  const mismatchRate = comparable
    ? Math.abs(metaPurchaseValue - cafeOrderAmount) / cafeOrderAmount * 100
    : null;
  return { metaPurchaseValue, cafeOrderAmount, mismatchRate, comparable, metaReady, cafeReady };
}

// ============================================================================
// Product Dashboard v1 — Cafe24 Orders + Products 기반 상품 의사결정 Dashboard.
// 상품별 ROAS는 만들지 않고, Meta 광고비/ROAS는 기간 전체 참고치로만 표시한다.
// mall.read_product 스코프가 없으면 서버가 insufficient_scope를 반환하며,
// 이 경우 고정 문구 배너만 보여주고 나머지 카드/테이블은 비활성 처리한다.
// ============================================================================
const PRODUCT_SCOPE_BANNER_TEXT = "Cafe24 상품 데이터 접근 권한이 부족합니다. Cafe24 개발자센터에서 mall.read_product 스코프를 추가한 뒤 OAuth 재인증을 진행해주세요.";

async function renderProductDashboard(data) {
  const bannerTarget = $("#productDashboardBanner");
  const metaRefTarget = $("#productDashboardMetaRef");
  const actionTarget = $("#productDashboardActions");
  const filterTarget = $("#productDashboardFilters");
  const rowsTarget = $("#productDashboardRows");
  if (!bannerTarget || !rowsTarget) return;
  bannerTarget.className = "ad-status-banner loading";
  bannerTarget.innerHTML = `<span class="status-dot"></span><strong>판매 현황 확인 중</strong><span class="note">선택 기간의 브랜드별 매출과 판매 제품을 불러오고 있습니다.</span>`;
  if (metaRefTarget) metaRefTarget.innerHTML = "";
  if (actionTarget) actionTarget.innerHTML = "";
  if (filterTarget) filterTarget.innerHTML = "";
  rowsTarget.innerHTML = `<tr><td colspan="6">판매 제품 데이터를 불러오고 있습니다.</td></tr>`;
  await renderProductBrandSales(data);
}

function productBrandSalesDateRange(data = selectedMonth()) {
  const today = new Date();
  const dateKey = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
  const addDays = (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };
  if (productBrandSalesRange === "today") {
    const day = dateKey(today);
    return { since: day, until: day, label: "오늘" };
  }
  if (productBrandSalesRange === "7d") return { since: dateKey(addDays(today, -6)), until: dateKey(today), label: "최근 7일" };
  if (productBrandSalesRange === "30d") return { since: dateKey(addDays(today, -29)), until: dateKey(today), label: "최근 30일" };
  if (productBrandSalesRange === "prev_month") {
    const [year, month] = String(data.month || selectedMonth().month).split("-").map(Number);
    const prev = new Date(year, month - 2, 1);
    const monthKey = dateKey(prev).slice(0, 7);
    return { since: `${monthKey}-01`, until: monthEnd(monthKey), label: "지난 달" };
  }
  if (productBrandSalesRange === "custom") {
    const fallbackSince = `${data.month}-01`;
    const fallbackUntil = monthEnd(data.month);
    return { since: productBrandSalesCustomSince || fallbackSince, until: productBrandSalesCustomUntil || fallbackUntil, label: "직접 선택" };
  }
  return { since: `${data.month}-01`, until: monthEnd(data.month), label: "이번 달" };
}

async function renderProductBrandSales(data) {
  const rowsTarget = $("#productBrandSalesRows");
  const metaTarget = $("#productBrandSalesMeta");
  if (!rowsTarget || !metaTarget) return;
  const renderSeq = ++productBrandSalesRenderSeq;
  const range = productBrandSalesDateRange(data);
  const cacheKey = `${range.since}_${range.until}`;
  if (productBrandSalesCacheKey === cacheKey && productBrandSalesRows.length) {
    renderProductBrandSalesTable();
    renderProductSoldProductsTable();
    return;
  }
  rowsTarget.innerHTML = `<tr><td colspan="5">브랜드 매출 데이터를 불러오고 있습니다.</td></tr>`;
  metaTarget.textContent = `${range.label} · ${range.since} ~ ${range.until} · 확인 중`;
  const result = await getJson(`/api/diagnostics/brand-sales?since=${range.since}&until=${range.until}`, 12000);
  if (renderSeq !== productBrandSalesRenderSeq) return;
  if (result.error || !Array.isArray(result.brands)) {
    productBrandSalesRows = [];
    productBrandSalesProducts = [];
    productBrandSalesCacheKey = cacheKey;
    rowsTarget.innerHTML = `<tr><td colspan="5">${esc(result.error || "데이터 없음")}</td></tr>`;
    $("#productDashboardRows").innerHTML = `<tr><td colspan="7">${esc(result.error || "데이터 없음")}</td></tr>`;
    metaTarget.textContent = `${range.label} · ${range.since} ~ ${range.until} · 데이터 없음`;
    renderContentBrandSalesTop3();
    return;
  }
  productBrandSalesRows = result.brands;
  productBrandSalesProducts = Array.isArray(result.products) ? result.products : [];
  productBrandSalesCacheKey = cacheKey;
  renderProductBrandSalesTable();
  renderProductSoldProductsTable();
  renderContentBrandSalesTop3();
}

function renderProductBrandSalesTable() {
  closeProductBrandOrderPopover();
  const rowsTarget = $("#productBrandSalesRows");
  const metaTarget = $("#productBrandSalesMeta");
  if (!rowsTarget || !metaTarget) return;
  const query = productBrandSalesSearch.trim().toLowerCase();
  const rows = productBrandSalesRows.filter((row) => {
    if (!query) return true;
    return `${row.brand_name || ""} ${row.brand_code || ""}`.toLowerCase().includes(query);
  }).sort((left, right) => {
    if (productBrandSalesSort === "brand_desc") return (right.manufacturer_name || right.brand_name || right.brand_code || "").localeCompare(left.manufacturer_name || left.brand_name || left.brand_code || "");
    if (productBrandSalesSort === "salesAmount_desc") return canonicalBrandPaidAmount(right) - canonicalBrandPaidAmount(left);
    if (productBrandSalesSort === "salesAmount_asc") return canonicalBrandPaidAmount(left) - canonicalBrandPaidAmount(right);
    if (productBrandSalesSort === "quantity_desc") return Number(right.quantitySold || 0) - Number(left.quantitySold || 0);
    if (productBrandSalesSort === "quantity_asc") return Number(left.quantitySold || 0) - Number(right.quantitySold || 0);
    if (productBrandSalesSort === "orders_desc") return Number(right.orderCount || 0) - Number(left.orderCount || 0);
    if (productBrandSalesSort === "orders_asc") return Number(left.orderCount || 0) - Number(right.orderCount || 0);
    return (left.manufacturer_name || left.brand_name || left.brand_code || "").localeCompare(right.manufacturer_name || right.brand_name || right.brand_code || "");
  });
  const range = productBrandSalesDateRange(selectedMonth());
  metaTarget.textContent = `${range.label} · ${range.since} ~ ${range.until} · ${apiNum(rows.length)}개 브랜드 표시`;
  rowsTarget.innerHTML = rows.length ? rows.map((row) => {
    const brandName = row.brand_name && row.brand_name !== row.brand_code ? row.brand_name : "미분류";
    const paidAmount = canonicalBrandPaidAmount(row);
    return `<tr>
      <td><strong>${esc(brandName)}</strong><br><span class="muted">${esc(row.brand_code || "-")}</span></td>
      <td>${apiWon(paidAmount)}</td>
      <td>${apiNum(row.quantitySold)}</td>
      <td><button class="brand-order-history-trigger" type="button" data-brand-order-history="${esc(row.brand_code || "")}">${apiNum(row.orderCount)}</button></td>
      <td>${apiNum(row.soldProductCount)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="5">데이터 없음</td></tr>`;
}

function closeProductBrandOrderPopover() {
  const popover = $("#productBrandOrderPopover");
  if (!popover) return;
  popover.hidden = true;
  popover.innerHTML = "";
  activeBrandOrderPopoverCode = "";
}

function productBrandOrderHistoryHtml(brand = {}) {
  const brandName = brand.brand_name && brand.brand_name !== brand.brand_code ? brand.brand_name : "미분류";
  const orders = Array.isArray(brand.orderHistory) ? brand.orderHistory : [];
  return `<div class="brand-order-popover-head"><strong>${esc(brandName)}</strong><span>주문 ${apiNum(orders.length)}건</span></div>${orders.length ? orders.map((order) => `<section class="brand-order-popover-order">
    <h4>${esc(order.orderDate || "날짜 없음")}</h4>
    ${(order.products || []).map((product) => {
      const paidAmount = canonicalPaidAmount(product);
      const grossAmount = canonicalGrossAmount(product);
      const discountAmount = canonicalDiscountAmount(product);
      return `<div class="brand-order-popover-product">
      <strong>${esc(product.productName || "상품명 없음")}</strong>
      <span>${apiNum(product.quantity)}개</span>
      <p>정상 판매금액 ${grossAmount === null ? "-" : apiWon(grossAmount)}</p>
      <p>할인액 ${discountAmount === null ? "-" : apiWon(discountAmount)}</p>
      <p>상품 실결제 ${apiWon(paidAmount)}</p>
      ${product.paymentMethod ? `<p>결제수단 ${esc(product.paymentMethod)}</p>` : ""}
      ${product.canceled ? `<p>취소됨</p>` : ""}
    </div>`;
    }).join("")}
  </section>`).join("") : `<p class="hint-text">주문 이력이 없습니다.</p>`}`;
}

function showProductBrandOrderPopover(trigger) {
  const brandCode = trigger?.dataset.brandOrderHistory || "";
  const popover = $("#productBrandOrderPopover");
  if (!brandCode || !popover) return;
  const brand = productBrandSalesRows.find((row) => row.brand_code === brandCode);
  if (!brand) return;
  popover.innerHTML = productBrandOrderHistoryHtml(brand);
  popover.hidden = false;
  activeBrandOrderPopoverCode = brandCode;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 24);
  popover.style.width = `${width}px`;
  let left = rect.left;
  if (left + width + 12 > window.innerWidth) left = Math.max(12, rect.right - width);
  const height = Math.min(popover.offsetHeight || 0, window.innerHeight - 24);
  let top = rect.bottom + 8;
  if (top + height + 12 > window.innerHeight) top = rect.top - height - 8;
  if (top < 12) top = 12;
  popover.style.left = `${Math.max(12, left)}px`;
  popover.style.top = `${top}px`;
}

function filterAndSortSoldProducts(products) {
  const search = productSoldSearch.trim().toLowerCase();
  return products.filter((product) => {
    const quantity = Number(product.quantitySold || 0);
    const amount = canonicalPaidAmount(product);
    const brandName = product.brand_name && product.brand_name !== product.brand_code ? product.brand_name : "미분류";
    if (quantity <= 0) return false;
    if (productSoldFilterBrand !== "all" && brandName !== productSoldFilterBrand) return false;
    if (productSoldFilterQty === "1" && quantity !== 1) return false;
    if (productSoldFilterQty === "2_3" && (quantity < 2 || quantity > 3)) return false;
    if (productSoldFilterQty === "4_plus" && quantity < 4) return false;
    if (productSoldFilterAmount === "300000" && amount < 300000) return false;
    if (productSoldFilterAmount === "500000" && amount < 500000) return false;
    if (productSoldFilterAmount === "1000000" && amount < 1000000) return false;
    if (search && !`${product.productName || ""} ${product.productCode || ""}`.toLowerCase().includes(search)) return false;
    return true;
  }).sort((left, right) => {
    if (productSoldSort === "quantity_desc") return Number(right.quantitySold || 0) - Number(left.quantitySold || 0);
    if (productSoldSort === "orders_desc") return Number(right.orderCount || 0) - Number(left.orderCount || 0);
    if (productSoldSort === "brand_asc") return (left.brand_name || left.brand_code || "").localeCompare(right.brand_name || right.brand_code || "");
    if (productSoldSort === "amount_asc") return canonicalPaidAmount(left) - canonicalPaidAmount(right);
    return canonicalPaidAmount(right) - canonicalPaidAmount(left);
  });
}

function renderProductSoldProductsTable() {
  const rowsTarget = $("#productDashboardRows");
  const bannerTarget = $("#productDashboardBanner");
  const filterTarget = $("#productSoldFilters");
  if (!rowsTarget) return;
  const allRows = productBrandSalesProducts.filter((product) => Number(product.quantitySold || 0) > 0);
  const brandOptions = [...new Set(allRows.map((product) => product.brand_name && product.brand_name !== product.brand_code ? product.brand_name : "미분류"))].sort((left, right) => left.localeCompare(right));
  if (filterTarget) {
    filterTarget.querySelector("#productSoldFilterBrand").innerHTML = `<option value="all">브랜드 전체</option>${brandOptions.map((brand) => `<option value="${esc(brand)}" ${productSoldFilterBrand === brand ? "selected" : ""}>${esc(brand)}</option>`).join("")}`;
  }
  const rows = filterAndSortSoldProducts(productBrandSalesProducts);
  if (bannerTarget) {
    const range = productBrandSalesDateRange(selectedMonth());
    bannerTarget.className = "ad-status-banner good";
    bannerTarget.innerHTML = `<span class="status-dot"></span><strong>판매 현황</strong><span class="note">${range.label} · ${range.since} ~ ${range.until} · ${apiNum(rows.length)}개 상품</span>`;
  }
  rowsTarget.innerHTML = rows.length ? rows.map((product) => {
    const brandName = product.brand_name && product.brand_name !== product.brand_code ? product.brand_name : "미분류";
    const velocity = Number(product.salesVelocityPerDay || 0);
    const velocityLabel = Number.isFinite(velocity) ? Number(velocity.toFixed(2)).toString() : "0";
    const paidAmount = canonicalPaidAmount(product);
    return `<tr>
      <td>${esc(brandName)}</td>
      <td><strong>${esc(product.productName || "상품명 없음")}</strong></td>
      <td>${esc(product.productCode || product.productNo || "-")}</td>
      <td>${apiNum(product.quantitySold)}</td>
      <td>${velocityLabel}개/일</td>
      <td>${apiNum(product.orderCount)}</td>
      <td>${apiWon(paidAmount)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="7">조건에 맞는 판매 상품이 없습니다.</td></tr>`;
}

function productHasSales(product = {}) {
  return Number(product.quantitySold || 0) > 0 || Number(product.orderCount || 0) > 0 || canonicalPaidAmount(product) > 0;
}

function productActionKey(product = {}) {
  return product.productAction?.action || "observe";
}

function productHasStock(product = {}) {
  return Number(product.inventoryQuantity || 0) > 0;
}

function productMatchesSalesScope(product = {}) {
  if (activeProductScopeFilter === "sold") return productHasSales(product);
  if (activeProductScopeFilter === "no_orders") return !productHasSales(product);
  return true;
}

function productMatchesStockScope(product = {}) {
  const stock = Number(product.inventoryQuantity || 0);
  if (activeProductStockFilter === "in_stock") return stock > 0;
  if (activeProductStockFilter === "low_stock") return stock > 0 && stock <= 3;
  if (activeProductStockFilter === "out_stock") return stock <= 0;
  return true;
}

function productFilterBase(products = []) {
  return products.filter((product) => productMatchesSalesScope(product) && productMatchesStockScope(product));
}

function productSortRows(products = []) {
  const dateValue = (value) => {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };
  const sorters = {
    salesAmount_desc: (a, b) => canonicalPaidAmount(b) - canonicalPaidAmount(a),
    quantity_desc: (a, b) => Number(b.quantitySold || 0) - Number(a.quantitySold || 0),
    orders_desc: (a, b) => Number(b.orderCount || 0) - Number(a.orderCount || 0),
    lastSale_desc: (a, b) => dateValue(b.lastSaleDate) - dateValue(a.lastSaleDate),
    stock_asc: (a, b) => Number(a.inventoryQuantity || 0) - Number(b.inventoryQuantity || 0)
  };
  const sorter = sorters[activeProductSort] || sorters.salesAmount_desc;
  return [...products].sort((a, b) => sorter(a, b) || canonicalPaidAmount(b) - canonicalPaidAmount(a));
}

function productSalesSummary(products = [], result = {}) {
  const soldProducts = products.filter(productHasSales);
  return {
    orderCount: Number(result.join?.orderCount || 0),
    soldProductCount: soldProducts.length,
    quantitySold: soldProducts.reduce((total, product) => total + Number(product.quantitySold || 0), 0),
    salesAmount: soldProducts.reduce((total, product) => total + canonicalPaidAmount(product), 0)
  };
}

function renderProductSalesSummary(result = {}, products = []) {
  const target = $("#salesImpact");
  if (!target) return;
  const ordersError = result.ordersError || null;
  const summary = productSalesSummary(products, result);
  target.dataset.productSalesLocked = "1";
  target.classList.add("cards");
  target.classList.remove("instagram-feed");
  target.innerHTML = [
    ordersError ? salesWarningCard({
      title: "주문 데이터 확인 필요",
      note: "주문 데이터를 불러오지 못해 판매 수치가 0으로 보일 수 있습니다.",
      detail: ordersError
    }) : "",
    salesKpiCard("총 주문 수", ordersError ? "확인 필요" : `${apiNum(summary.orderCount)}건`, "Cafe24 결제 완료 주문 기준", ordersError ? "is-disabled" : ""),
    salesKpiCard("판매 상품 수", ordersError ? "확인 필요" : `${apiNum(summary.soldProductCount)}개`, "판매 발생 상품 기준", ordersError ? "is-disabled" : ""),
    salesKpiCard("총 판매 수량", ordersError ? "확인 필요" : `${apiNum(summary.quantitySold)}개`, "상품별 quantitySold 합계", ordersError ? "is-disabled" : ""),
    salesKpiCard("총 상품 실결제 매출", ordersError ? "확인 필요" : apiWon(summary.salesAmount), "상품별 canonical paid 합계 · 배송비 제외", ordersError ? "is-disabled" : "")
  ].filter(Boolean).join("");
}

function productScopeFiltersHtml(products = []) {
  const soldCount = products.filter(productHasSales).length;
  const noOrderCount = products.length - soldCount;
  return `<button class="product-action-filter ${activeProductScopeFilter === "sold" ? "active" : ""}" type="button" data-product-scope-filter="sold">
    판매 발생 <span>${apiNum(soldCount)}</span>
  </button>
  <button class="product-action-filter ${activeProductScopeFilter === "no_orders" ? "active" : ""}" type="button" data-product-scope-filter="no_orders">
    주문 없음 <span>${apiNum(noOrderCount)}</span>
  </button>
  <button class="product-action-filter ${activeProductScopeFilter === "all" ? "active" : ""}" type="button" data-product-scope-filter="all">
    전체 카탈로그 <span>${apiNum(products.length)}</span>
  </button>`;
}

function productStockFiltersHtml(products = []) {
  const inStock = products.filter(productHasStock).length;
  const lowStock = products.filter((product) => {
    const stock = Number(product.inventoryQuantity || 0);
    return stock > 0 && stock <= 3;
  }).length;
  const outStock = products.length - inStock;
  const filters = [
    ["all", "재고 전체", products.length],
    ["in_stock", "재고 있음", inStock],
    ["low_stock", "재고 부족", lowStock],
    ["out_stock", "재고 없음", outStock]
  ];
  return filters.map(([value, label, count]) => `<button class="product-action-filter ${activeProductStockFilter === value ? "active" : ""}" type="button" data-product-stock-filter="${esc(value)}">
    ${esc(label)} <span>${apiNum(count)}</span>
  </button>`).join("");
}

function productSortControlsHtml() {
  const sorts = [
    ["salesAmount_desc", "실결제 매출순"],
    ["quantity_desc", "판매수량"],
    ["orders_desc", "주문수"],
    ["lastSale_desc", "마지막 판매일"],
    ["stock_asc", "재고 적은 순"]
  ];
  return sorts.map(([value, label]) => `<button class="product-action-filter ${activeProductSort === value ? "active" : ""}" type="button" data-product-sort="${esc(value)}">
    ${esc(label)}
  </button>`).join("");
}

const PRODUCT_ACTIONS = [
  ["push_now", "Push Now"],
  ["observe", "Observe"],
  ["hold", "Hold"],
  ["stop_promotion", "재고 소진"]
];

function productActionTone(action) {
  return { push_now: "good", observe: "", hold: "warn", stop_promotion: "urgent" }[action] || "";
}

function productActionSummaryFromProducts(products = []) {
  return products.reduce((summary, product) => {
    const action = productActionKey(product);
    summary[action] = (summary[action] || 0) + 1;
    return summary;
  }, { push_now: 0, observe: 0, hold: 0, stop_promotion: 0 });
}

function observeSubReasonCounts(products = []) {
  return products.reduce((summary, product) => {
    const action = productActionKey(product);
    if (action !== "observe") return summary;
    const subReason = product.productAction?.subReason || null;
    if (subReason === "new_product") summary.new_product += 1;
    if (subReason === "single_sale") summary.single_sale += 1;
    if (subReason === "no_history") summary.no_history += 1;
    return summary;
  }, { new_product: 0, single_sale: 0, no_history: 0 });
}

function observeSubReasonText(products = []) {
  const counts = observeSubReasonCounts(products);
  return `신규 ${apiNum(counts.new_product)} · 판매 신호 ${apiNum(counts.single_sale)} · 이력 없음 ${apiNum(counts.no_history)}`;
}

function productActionSummaryHtml(summary = {}, products = []) {
  const counts = { ...productActionSummaryFromProducts(products), ...summary };
  const observeDetail = observeSubReasonText(products);
  return PRODUCT_ACTIONS.map(([action, label]) => {
    const tone = productActionTone(action);
    const active = activeProductActionFilter === action ? " active" : "";
    return `<button class="action-item sales-kpi-card product-action-card ${esc(tone)}${active}" type="button" data-product-action-filter="${esc(action)}">
      <span>${esc(label)}</span>
      <strong>${apiNum(counts[action] || 0)}</strong>
      <p>${esc(productActionNote(action))}</p>
      ${action === "observe" ? `<small class="product-action-subreason">${esc(observeDetail)}</small>` : ""}
    </button>`;
  }).join("");
}

function productActionFiltersHtml(products = []) {
  const baseProducts = productFilterBase(products);
  const counts = productActionSummaryFromProducts(baseProducts);
  const filters = [["all", "All", baseProducts.length], ...PRODUCT_ACTIONS.map(([action, label]) => [action, label, counts[action] || 0])];
  const buttons = filters.map(([action, label, count]) => (
    `<button class="product-action-filter ${activeProductActionFilter === action ? "active" : ""}" type="button" data-product-action-filter="${esc(action)}">
      ${esc(label)} <span>${apiNum(count)}</span>
    </button>`
  )).join("");
  return `${productScopeFiltersHtml(products)}${productStockFiltersHtml(products)}${buttons}${productSortControlsHtml()}<small class="product-action-filter-note">${esc(observeSubReasonText(baseProducts))}</small>`;
}

function productActionNote(action) {
  return {
    push_now: "노출 확대 가능",
    observe: "추가 관찰",
    hold: "재고 주의",
    stop_promotion: "광고 상태 미확인"
  }[action] || "";
}

// 미매칭 주문항목이 "왜" 미매칭인지 사유별로 보여주는 카드. (2026-07-10 상품 Join 구조 개선)
// 서버 응답에 unmatchedDetail이 없으면(구버전 Render 배포본) 안내 문구로 폴백한다.
function productUnmatchedCardHtml(result = {}) {
  const count = result.unmatchedDetail?.count ?? result.unmatched?.count ?? 0;
  if (!count) {
    return `<article class="action-item sales-list-card sales-empty-card">
      <span>미매칭 주문항목</span>
      <strong>0건</strong>
      <p>모든 주문 품목이 상품 카탈로그와 연결되었습니다.</p>
    </article>`;
  }
  const amount = result.unmatchedDetail?.amount ?? result.unmatched?.amount ?? 0;
  const reasons = result.unmatchedDetail?.reasons || [];
  const onDemand = result.onDemandFetch || null;
  const onDemandNote = onDemand && onDemand.attempted
    ? `<p>추가 조회 ${apiNum(onDemand.attempted)}건 → 병합 ${apiNum(onDemand.added)} · 삭제/비공개 ${apiNum(onDemand.deletedOrPrivate)} · 실패 ${apiNum(onDemand.failed)}</p>`
    : "";
  return `<article class="action-item sales-list-card">
    <span>미매칭 주문항목 · 사유</span>
    <strong>${apiNum(count)}건 · ${apiWon(amount)}</strong>
    ${reasons.length ? `<ul>${reasons.slice(0, 5).map((item) => `<li>
        <div><b>${esc(item.label || item.reason || "기타")}</b><small>${apiNum(item.count)}건</small></div>
        <em>${apiWon(item.amount)}</em>
      </li>`).join("")}</ul>` : `<p>사유 분석 데이터가 없습니다. Render 배포본이 최신인지 확인하세요.</p>`}
    ${onDemandNote}
  </article>`;
}

function productDashboardRowHtml(row, options = {}) {
  const productAction = row.productAction || { action: "observe", label: row.aiAction || "Observe", confidence: "low", reasons: [row.aiActionReason || ""], warnings: [], dataQuality: { meta: "unavailable" } };
  const actionClass = productActionTone(productAction.action);
  const reasons = (productAction.reasons || []).filter(Boolean).slice(0, 3);
  const warnings = (productAction.warnings || []).filter(Boolean).slice(0, 2);
  const lastSaleDate = row.lastSaleDate ? String(row.lastSaleDate).slice(0, 10) : "";
  const salesWarning = options.ordersError ? '<div class="hint-text urgent">주문 데이터 확인 필요</div>' : "";
  const paidAmount = canonicalPaidAmount(row);
  return `<tr>
    <td>${esc(row.productName)}<div class="hint-text">${esc(row.productCode || "")}</div></td>
    <td><span class="badge ${actionClass}">${esc(productAction.label)}</span><div class="hint-text">Confidence · ${esc(productAction.confidence || "-")}</div></td>
    <td>${apiNum(row.inventoryQuantity)}<div class="hint-text">${row.daysOfStockLeft === null || row.daysOfStockLeft === undefined ? "소진일 미확인" : `소진 예상 ${apiNum(row.daysOfStockLeft)}일`}</div>${row.soldOut ? '<div class="hint-text">품절 플래그 있음</div>' : ""}</td>
    <td>${apiNum(row.quantitySold)}개<div class="hint-text">주문 ${apiNum(row.orderCount)}건 · 일 평균 ${Number(row.salesVelocityPerDay || 0).toFixed(2)}개</div>${salesWarning}</td>
    <td>${apiWon(paidAmount)}</td>
    <td>${lastSaleDate ? esc(lastSaleDate) : "-"}</td>
    <td><span class="badge">Unavailable</span><div class="hint-text">상품 단위 광고 귀속 확인 불가</div></td>
    <td>
      <ul class="product-action-reasons">${reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul>
      ${warnings.length ? `<div class="product-action-warnings">${warnings.map((warning) => `<span>${esc(warning)}</span>`).join("")}</div>` : ""}
    </td>
  </tr>`;
}

function formatRelativeMinutes(isoTime) {
  const then = new Date(isoTime).getTime();
  if (!Number.isFinite(then)) return "확인 불가";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

// ============================================================================
// Settings 탭 — Cafe24 상품 API 진단 위젯. 로컬 서버 자체 진단
// (/api/diagnostics/cafe24-product-access)을 호출해 dashboardReady를 보여준다.
// 이 위젯은 로컬 8787의 Cafe24 토큰 상태를 반영하며, Render 배포본의 진단
// (/api/diagnostics/cafe24-product-check)과는 별개다.
// ============================================================================
async function renderCafe24ProductDiagnostics() {
  const target = $("#cafe24ProductDiagnostics");
  if (!target) return;
  target.innerHTML = `<article class="action-item"><strong>Cafe24 상품 API 진단 확인 중</strong><p>로컬 서버 기준으로 확인하고 있습니다.</p></article>`;
  const result = await getJson("/api/diagnostics/cafe24-product-access", 15000);
  const ready = result.dashboardReady || {};
  const keys = Object.keys(ready);
  if (keys.length === 0) {
    target.innerHTML = `<article class="action-item"><strong>직접 진단 확인 불가</strong><p>${esc(result.message || "진단 API 응답을 확인할 수 없습니다.")}</p><p class="hint-text">현재 Commerce/Product 데이터는 기존 캐시 또는 프록시 경로로 표시될 수 있습니다. 이 메시지는 로컬 Product Dashboard 직접 진단이 실행되지 않았다는 의미이며 전체 Product 기능 장애를 뜻하지 않습니다.</p></article>`;
    return;
  }
  target.innerHTML = `<div class="cafe24-diagnostics-grid">${keys.map((key) => (
    `<article class="action-item"><strong>${ready[key]} ${esc(key)}</strong></article>`
  )).join("")}</div>
  <p class="hint-text">이 결과는 로컬 8787 서버 기준입니다. mall.read_product 스코프 추가 후 재인증했다면, Render 배포본(samplas-marketing-os.onrender.com/api/diagnostics/cafe24-product-check)도 함께 확인해보세요.</p>`;
}

// Brand Master "의심 항목만 보기"용 의심 판정. 서버 데이터는 건드리지 않고 화면에서만
// 계산한다. 조건: 이름 비어있음 / HTML entity가 남아있음 / 같은 이름 중복 / trim 기준
// 2자 이하 / 숫자·기호 비중이 50% 이상. (2026-07-10 Brand Master 승인 UX 최소 구현)
const BRAND_MASTER_ENTITY_RE = /&[#A-Za-z0-9]+;/;

function brandMasterSymbolRatio(name) {
  const noSpace = name.replace(/\s/g, "");
  if (!noSpace.length) return 0;
  const symbolCount = (noSpace.match(/[^\p{L}]/gu) || []).length;
  return symbolCount / noSpace.length;
}

function computeBrandMasterSuspectSet(brands) {
  const nameCounts = new Map();
  for (const brand of brands) {
    const name = String(brand.brand_name || "").trim();
    if (!name) continue;
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  const suspects = new Set();
  for (const brand of brands) {
    const rawName = String(brand.brand_name || "");
    const name = rawName.trim();
    const isBlank = !name;
    const hasEntity = BRAND_MASTER_ENTITY_RE.test(rawName);
    const isDuplicate = !isBlank && nameCounts.get(name) > 1;
    const isTooShort = !isBlank && name.length <= 2;
    const isSymbolHeavy = !isBlank && brandMasterSymbolRatio(name) >= 0.5;
    if (isBlank || hasEntity || isDuplicate || isTooShort || isSymbolHeavy) {
      suspects.add(brand.brand_code);
    }
  }
  return suspects;
}

function applyBrandMasterSuspectFilter() {
  $$("#brandMasterTable tr[data-brand-code]").forEach((row) => {
    const isSuspect = row.dataset.suspect === "1";
    const isInCatalog = row.dataset.inCatalog === "1";
    row.style.display = ((brandMasterSuspectOnly && !isSuspect) || (brandMasterCatalogOnly && !isInCatalog)) ? "none" : "";
  });
}

function applyBrandMasterCatalogFilter() {
  applyBrandMasterSuspectFilter();
}

function brandMasterRowHtml(brand, isSuspect, isInCatalog) {
  const aliases = Array.isArray(brand.name_aliases) ? brand.name_aliases.join(", ") : "";
  return `<tr data-brand-code="${esc(brand.brand_code)}" data-original-name="${esc(brand.brand_name || "")}" data-original-aliases="${esc(aliases)}" data-original-instagram="${esc(brand.instagram_tag || "")}" data-original-active="${brand.active === false ? "0" : "1"}" data-name-source="${esc(brand.nameSource || "suggested")}" data-suspect="${isSuspect ? "1" : "0"}" data-in-catalog="${isInCatalog ? "1" : "0"}">
    <td><code>${esc(brand.brand_code)}</code></td>
    <td><input type="text" data-field="brand_name" value="${esc(brand.brand_name || "")}" placeholder="${esc(brand.brand_code)}" /></td>
    <td><textarea data-field="name_aliases" rows="2" placeholder="쉼표 또는 줄바꿈">${esc(aliases)}</textarea></td>
    <td><input type="text" data-field="instagram_tag" value="${esc(brand.instagram_tag || "")}" placeholder="@instagram" /></td>
    <td><span class="badge ${brand.nameSource === "confirmed" ? "good" : "warn"}">${esc(brand.nameSource || "suggested")}</span>${isSuspect ? ' <span class="badge warn" title="의심 항목">CHECK</span>' : ""}</td>
    <td><label class="brand-master-active"><input type="checkbox" data-field="active" ${brand.active === false ? "" : "checked"} /> active</label></td>
  </tr>`;
}

async function renderBrandMasterSettings() {
  const summaryTarget = $("#brandMasterSummary");
  const tableTarget = $("#brandMasterTable");
  const saveBtn = $("#brandMasterSaveBtn");
  if (!summaryTarget || !tableTarget) return;
  summaryTarget.innerHTML = `<article class="action-item"><strong>브랜드 마스터 확인 중</strong><p>Cafe24 brand_code 기준으로 불러오고 있습니다.</p></article>`;
  tableTarget.innerHTML = "";
  const month = selectedMonth();
  const [result, dashboard] = await Promise.all([
    getJson("/api/brand-master", 12000),
    getJson(`/api/products/dashboard?since=${month.month}-01&until=${monthEnd(month.month)}`, 15000)
  ]);
  if (result.error) {
    summaryTarget.innerHTML = `<article class="action-item"><strong>브랜드 마스터 오류</strong><p>${esc(result.error)}</p></article>`;
    return;
  }
  const brands = Array.isArray(result.brands) ? result.brands : [];
  const catalogBrandSet = new Set((dashboard.products || []).map((product) => product.brand).filter(Boolean));
  const suggestedBrands = brands.filter((brand) => brand.nameSource === "suggested");
  const suspectSet = computeBrandMasterSuspectSet(brands);
  summaryTarget.innerHTML = `<div class="mini-kpi-grid">
    ${miniMetric("브랜드", apiNum(result.brandCount || brands.length), "brand_code 기준")}
    ${miniMetric("suggested", apiNum(result.suggestedCount || 0), "자동 후보")}
    ${miniMetric("confirmed", apiNum(result.confirmedCount || 0), "사용자 확정")}
    ${miniMetric("coverage", `${apiNum(result.brandCodeCoverage?.withBrandCode || 0)}/${apiNum(result.brandCodeCoverage?.productCount || 0)}`, "상품 brand_code")}
  </div>
  <div class="brand-master-bulk-controls" style="display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap;">
    <button id="brandMasterBulkConfirmBtn" class="button secondary" type="button">SUGGESTED 일괄 확정 (${suggestedBrands.length})</button>
    <label style="display:inline-flex;align-items:center;gap:6px;">
      <input type="checkbox" id="brandMasterCatalogToggle" ${brandMasterCatalogOnly ? "checked" : ""} />
      카탈로그 외 브랜드 숨기기 (${catalogBrandSet.size})
    </label>
    <label style="display:inline-flex;align-items:center;gap:6px;">
      <input type="checkbox" id="brandMasterSuspectToggle" ${brandMasterSuspectOnly ? "checked" : ""} />
      의심 항목만 보기 (${suspectSet.size})
    </label>
  </div>`;
  tableTarget.innerHTML = `<div class="brand-master-table-wrap">
    <table class="brand-master-table">
      <thead>
        <tr>
          <th>brand_code</th>
          <th>brand_name</th>
          <th>name_aliases</th>
          <th>instagram_tag</th>
          <th>nameSource</th>
          <th>active</th>
        </tr>
      </thead>
      <tbody>${brands.map((brand) => brandMasterRowHtml(brand, suspectSet.has(brand.brand_code), catalogBrandSet.has(brand.brand_code))).join("")}</tbody>
    </table>
  </div>`;
  applyBrandMasterSuspectFilter();

  // SUGGESTED 일괄 확정: nameSource가 "suggested"인 행 전체를 changed 여부와 무관하게
  // 현재 화면(DOM)에 표시 중인 값 그대로 POST한다. 기존 "저장 / 확정" 버튼의 changed
  // 비교 로직은 건드리지 않고 그대로 둔다. 이 버튼/토글은 매 렌더링마다 새로 생성되는
  // 요소라(#brandMasterSaveBtn과 달리 HTML에 고정 배치된 요소가 아님) dataset.bound
  // 가드 없이 매번 새로 바인딩한다. (2026-07-10 Brand Master 승인 UX 최소 구현)
  const bulkConfirmBtn = $("#brandMasterBulkConfirmBtn");
  if (bulkConfirmBtn) {
    bulkConfirmBtn.addEventListener("click", async () => {
      const rows = $$("#brandMasterTable tr[data-brand-code]").filter((row) => row.dataset.nameSource === "suggested");
      if (!rows.length) {
        toast("SUGGESTED 상태인 브랜드가 없습니다.");
        return;
      }
      if (!confirm(`SUGGESTED ${rows.length}개 브랜드를 현재 이름 그대로 확정합니다.`)) return;
      const payload = rows.map((row) => {
        const brand_name = row.querySelector('[data-field="brand_name"]')?.value || "";
        const name_aliases = row.querySelector('[data-field="name_aliases"]')?.value || "";
        const instagram_tag = row.querySelector('[data-field="instagram_tag"]')?.value || "";
        const active = Boolean(row.querySelector('[data-field="active"]')?.checked);
        // changed 여부를 확인하지 않는다 — 이 버튼의 목적 자체가 "값이 바뀌었든 아니든
        // 현재 값 그대로 확정"이므로 기존 저장 핸들러의 changed 필터를 의도적으로 생략한다.
        return { brand_code: row.dataset.brandCode, brand_name, name_aliases, instagram_tag, active };
      });
      bulkConfirmBtn.disabled = true;
      const label = bulkConfirmBtn.textContent;
      bulkConfirmBtn.textContent = "확정 중...";
      const saved = await postJson("/api/brand-master", { brands: payload }, 12000);
      bulkConfirmBtn.disabled = false;
      bulkConfirmBtn.textContent = label;
      toast(saved.error ? "일괄 확정에 실패했습니다." : `SUGGESTED ${rows.length}개를 확정했습니다.`);
      if (!saved.error) renderBrandMasterSettings();
    });
  }


  const catalogToggle = $("#brandMasterCatalogToggle");
  if (catalogToggle) {
    catalogToggle.addEventListener("change", () => {
      brandMasterCatalogOnly = catalogToggle.checked;
      applyBrandMasterCatalogFilter();
    });
  }

  const suspectToggle = $("#brandMasterSuspectToggle");
  if (suspectToggle) {
    suspectToggle.addEventListener("change", () => {
      brandMasterSuspectOnly = suspectToggle.checked;
      applyBrandMasterSuspectFilter();
    });
  }

  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", async () => {
      const rows = $$("#brandMasterTable tr[data-brand-code]");
      const payload = rows.map((row) => {
        const brand_name = row.querySelector('[data-field="brand_name"]')?.value || "";
        const name_aliases = row.querySelector('[data-field="name_aliases"]')?.value || "";
        const instagram_tag = row.querySelector('[data-field="instagram_tag"]')?.value || "";
        const active = Boolean(row.querySelector('[data-field="active"]')?.checked);
        const changed = brand_name !== (row.dataset.originalName || "")
          || name_aliases !== (row.dataset.originalAliases || "")
          || instagram_tag !== (row.dataset.originalInstagram || "")
          || (active ? "1" : "0") !== (row.dataset.originalActive || "1");
        return changed ? { brand_code: row.dataset.brandCode, brand_name, name_aliases, instagram_tag, active } : null;
      }).filter(Boolean);
      if (!payload.length) {
        toast("변경된 브랜드가 없습니다.");
        return;
      }
      saveBtn.disabled = true;
      const label = saveBtn.textContent;
      saveBtn.textContent = "저장 중...";
      const saved = await postJson("/api/brand-master", { brands: payload }, 12000);
      saveBtn.disabled = false;
      saveBtn.textContent = label;
      toast(saved.error ? "브랜드 마스터 저장에 실패했습니다." : "브랜드 마스터를 저장했습니다.");
      if (!saved.error) renderBrandMasterSettings();
    });
  }
}

function salesDecisionState({ meta, cafe, mismatchRate, cafeReady, metaReady, metaPurchaseValue, cafeOrderAmount }) {
  if (cafe.error) {
    const state = bannerState(cafe, "cafe24");
    return { tone: state.tone === "error" ? "error" : state.tone, label: state.label, reason: state.reason || "Cafe24 데이터를 불러오지 못했습니다.", action: state.action || "Cafe24 연결을 확인하세요." };
  }
  // Cafe24가 라이브로 오지 않은 상태(오류 후 캐시 폴백 등)에서는 오차율을 만들지 않는다.
  if (cafeReady === false) {
    return {
      tone: "warn",
      label: "비교 불가",
      reason: "Cafe24 데이터를 불러오지 못해 비교할 수 없습니다.",
      action: cafe.cacheWarning ? "현재 캐시 데이터가 표시 중입니다. Cafe24 연결 복구 후 새로고침하세요." : "Cafe24 연결을 확인하세요."
    };
  }
  if (meta.error) {
    const state = bannerState(meta, "meta");
    return { tone: state.tone === "error" ? "error" : state.tone, label: state.label, reason: state.reason || "Meta 데이터를 불러오지 못했습니다.", action: state.action || "Meta Ads 연결을 확인하세요." };
  }
  if (metaReady === false) {
    return { tone: "warn", label: "비교 불가", reason: "Meta 구매값 데이터를 불러오지 못해 비교할 수 없습니다.", action: "Meta Ads 연결을 확인하세요." };
  }
  if (mismatchRate === null) {
    // 여기 도달 = 양쪽 API는 정상이지만 비교 가능한 값이 아직 없음 (구매값/매출 0 등).
    if (metaPurchaseValue === 0) {
      return { tone: "warn", label: "판단 보류", reason: "Meta 구매값이 0이라 오차율을 계산하지 않습니다.", action: "Meta 전환(픽셀) 설정 또는 기여 기간을 확인하세요." };
    }
    if (cafeOrderAmount === 0) {
      return { tone: "warn", label: "판단 보류", reason: "Cafe24 매출이 0이라 오차율을 계산하지 않습니다.", action: "이번 달 주문이 쌓이면 다시 확인하세요." };
    }
    return { tone: "warn", label: "판단 보류", reason: "비교할 매출 데이터가 아직 부족합니다.", action: "이번 달 주문이 쌓이면 다시 확인하세요." };
  }
  const rounded = mismatchRate < 1 ? mismatchRate.toFixed(1) : Math.round(mismatchRate);
  if (mismatchRate <= 10) {
    return { tone: "good", label: "정상", reason: `Meta와 Cafe24 오차 ${rounded}%`, action: "Meta 데이터를 참고해도 됩니다." };
  }
  if (mismatchRate <= 25) {
    return { tone: "warn", label: "주의", reason: `Meta와 Cafe24 오차 ${rounded}%`, action: "광고 기여 기간 차이를 먼저 확인하세요." };
  }
  return { tone: "error", label: "주의", reason: `Meta와 Cafe24 오차 ${rounded}%`, action: "광고 귀속 또는 API 상태를 점검하세요." };
}

function salesActionCard(decision) {
  const tone = decision.tone === "error" ? "urgent" : decision.tone === "warn" ? "warn" : "good";
  const icon = decision.tone === "error" ? "\u{1F534}" : decision.tone === "warn" ? "\u{1F7E1}" : "\u{1F7E2}";
  return `<article class="action-item ${esc(tone)} sales-compare-card">
    <span>${icon} ${esc(decision.label)}</span>
    <strong>${esc(decision.reason)}</strong>
    <p>${esc(decision.action)}</p>
  </article>`;
}

function salesCompareCard(title, value, note, options = {}) {
  return `<article class="action-item sales-compare-card">
    ${dataBadgeHtml(options.badge)}
    <span>${esc(title)}</span>
    ${options.status ? `<b class="sales-status-badge ${esc(options.tone || "")}">${esc(value)}</b>` : `<strong>${esc(value)}</strong>`}
    <p>${esc(note)}</p>
  </article>`;
}

function cafe24SourceLabel(data = {}) {
  if (data.source === "csv_required") return "지난 월 CSV 업로드 필요";
  if (data.cacheMode === "fallback_after_error") return `저장된 Cafe24 데이터로 표시${data.cacheWarning ? ` · ${data.cacheWarning}` : ""}`;
  if (String(data.source || "").includes("csv")) return "Cafe24 CSV";
  if (String(data.source || "").includes("admin_api")) return "Cafe24 주문 API";
  if (String(data.source || "").includes("cached")) return "Cafe24 캐시";
  return data.source || "Cafe24";
}

async function renderStoryInsights() {
  storyData = await getJson("/api/instagram/stories", 6000);
  const stories = storyData.stories || [];
  const totals = storyData.totals || {};
  const replyRate = hasApiValue(totals.replyRate) ? totals.replyRate : 0;
  $("#storyStatus").innerHTML = [
    ["Stories", `${num(stories.length)}개`, storyData.source || "-"],
    ["Reach", num(totals.reach), storyData.cacheWarning || "스토리 인사이트 기준"],
    ["Engagement Rate", pct(replyRate), "답장 / 도달 기준"]
  ].map(([title, value, note]) => `<article class="action-item"><strong>${title}</strong><span>${value}</span><p>${esc(note)}</p></article>`).join("");
  $("#storyBoard").innerHTML = stories.slice(0, 12).map((story) => (
    `<article class="report-panel">
      <h4>${esc(story.date || "-")}</h4>
      <div class="report-metrics">
        <span>Reach <strong>${apiNum(story.reach)}</strong></span>
        <span>Views <strong>-</strong></span>
        <span>Likes <strong>-</strong></span>
        <span>Comments <strong>${apiNum(story.replies)}</strong></span>
        <span>Saves <strong>-</strong></span>
        <span>Shares <strong>-</strong></span>
        <span>Engagement Rate <strong>${pct(rate(story.replies, story.reach))}</strong></span>
      </div>
    </article>`
  )).join("") || `<div class="action-item">스토리 데이터가 없습니다.</div>`;
}

// loadMonths()가 데이터를 가져온 "그 순간"의 HTTP 응답 하나로만 성공/실패가 결정되고,
// 이후에는 아무 코드도 그 결과를 다시 검증하지 않는다(getJson()의 108행이 유일하게 .error를
// 세팅하는 지점). 그래서 화면을 이미 열어둔 상태에서 토큰이 재발급되는 등 원인이 해소돼도
// Overview는 새로고침 전까지 예전 실패 상태를 계속 보여준다. 현재 달에 한해 세션당 1회만
// 조용히 재확인해서, 실제로는 해결된 실패를 화면에 계속 남겨두지 않도록 한다.
// (2026-07-08 Instagram Data Sync stale-error 자동 복구)
const instagramRetriedMonths = new Set();

async function updateSync(data) {
  const instagramState = bannerState(data, "instagram");
  // 근본 원인: bannerState()는 data.error가 없어도(=API 자체는 정상) source에 "_cached"가
  // 붙어 있으면(서버가 온디스크 캐시를 서빙 중일 때 항상 이렇게 붙는다, server.mjs의
  // decorateCachedSource()) isLiveSource()가 live=false로 판정하고, cacheFreshnessTone()이
  // 캐시가 24시간(1440분) 넘게 오래됐으면 tone:"error"를 반환한다. sidebarBadgeFromState()는
  // 그 tone을 그대로 "실패"로 표시해왔다. 반면 renderApiHealthCenter/homeActivityCards의
  // instagramOk는 캐시 최신성을 전혀 보지 않고 오직 data.error 유무만 본다 — 그래서
  // renderApiHealthCenter는 "정상", Sidebar는 "실패"로 서로 어긋났다.
  // 수정: Sidebar도 renderApiHealthCenter와 동일하게 data.error 유무만으로 판정한다.
  // (2026-07-08 Sidebar/HealthCenter 판정 불일치 수정)
  const instagramSidebar = data.error
    ? {
        tone: "error",
        badge: instagramState.label === "토큰 만료" || instagramState.label === "권한 만료" ? "재인증 필요" : "실패"
      }
    : { tone: "good", badge: "정상" };
  console.log("sidebar", { bannerState: instagramState, instagramSidebar, dataError: data.error || null, dataSource: data.source });

  if (data.error && data.month === months[0] && !instagramRetriedMonths.has(data.month)) {
    instagramRetriedMonths.add(data.month);
    const fresh = await getJson(`/api/instagram/monthly?month=${data.month}`, 20000);
    if (!fresh.error) {
      const index = monthlyData.findIndex((item) => item.month === data.month);
      if (index !== -1) monthlyData[index] = fresh;
      if (selectedMonth().month === data.month) {
        renderAll();
        return;
      }
    }
  }
  setSyncRow("instagramSyncRow", instagramSidebar.tone, "Instagram", instagramSidebar.badge);

  const meta = await getJson(`/api/meta-ads/summary?since=${data.month}-01&until=${monthEnd(data.month)}`, 5000);
  const metaState = bannerState(meta, "meta");
  const metaSidebar = meta.error
    ? {
        tone: "error",
        badge: metaState.label === "토큰 만료" || metaState.label === "권한 만료" ? "재인증 필요" : "실패"
      }
    : { tone: "good", badge: "정상" };
  const metaDetail = meta.error ? "" : (isLiveSource(meta) ? "Live" : cacheFreshnessLabel(meta));
  setSyncRow("metaAdsSyncRow", metaSidebar.tone, "Meta Ads", metaSidebar.badge, metaDetail);

  const cafeStatus = await getCafe24Status(`${data.month}-01`, monthEnd(data.month));
  const cafeReauth = /refresh_token|재인증|reauth_required/i.test(String(cafeStatus.detail || ""));
  const cafeSidebar = cafeStatus.ok ? { tone: "good", badge: "정상" } : { tone: "error", badge: cafeReauth ? "재인증 필요" : "실패" };
  setSyncRow("cafe24SyncRow", cafeSidebar.tone, "Cafe24", cafeSidebar.badge);
  // Sidebar에도 재인증 버튼을 노출한다(요청: Sidebar Cafe24 상태 배지 또는 관련 영역에서
  // 재인증 시작 URL로 이동 가능해야 함). 버튼 자체는 HTML에 이미 있었지만 항상 숨겨져 있었고
  // 클릭해도 toast만 띄우고 실제로는 아무 데도 이동하지 않았다 — 여기서 조건부로 보이게 하고,
  // 클릭 동작은 bind()에서 /api/cafe24/oauth/start로 실제 이동하도록 고쳤다.
  // (2026-07-08 Cafe24 재인증 흐름 개선)
  const fixBtn = $("#syncFixBtn");
  if (fixBtn) {
    fixBtn.classList.toggle("hidden", !cafeReauth);
    if (cafeReauth) fixBtn.textContent = "Cafe24 재인증하기";
  }
}

function renderAll() {
  resetSharedJsonRequests();
  const data = selectedMonth();
  reportsMonth = data.month;
  $("#dataModeBadge").textContent = sourceLabel(data);
  renderMonthRail();
  renderKpis(data);
  renderTodaySalesCalendar(todaySalesCalendarMonth);
  renderOverviewLiveData(data);
  renderReportsMonth(reportsMonth);
  renderContentTabs();
  renderContentOperations(data);
  renderEditorialAi(data);
  renderOtherSections(data);
  updateSync(data);
}

function renderOperationsSections() {
  resetSharedJsonRequests();
  const renderSeq = ++operationsRenderSeq;
  const data = selectedMonth();
  const setPending = (selector, html) => {
    const target = $(selector);
    if (target) target.innerHTML = html;
  };
  setPending("#adAiBriefing", `<article class="action-item"><strong>관리 필요 캠페인 확인 중</strong><p>Meta 자체 귀속 지표 기준으로 확인하고 있습니다.</p></article>`);
  setPending("#marketingSummaryHero", `<article class="action-item"><strong>Marketing 데이터 확인 중</strong><p>Meta Ads와 Commerce 매출을 불러오고 있습니다.</p></article>`);
  setPending("#marketingSummaryBriefing", `<article class="action-item"><strong>관리 필요 캠페인 확인 중</strong><p>Meta 자체 귀속 지표 기준으로 확인하고 있습니다.</p></article>`);
  setPending("#marketingSummaryStatus", `<article class="action-item"><strong>광고 상태 확인 중</strong><p>집행·미집행·일치 검증 결과를 정리합니다.</p></article>`);
  setPending("#adTodayStatus", `<span class="status-dot"></span><strong>오늘 광고 상태 확인 중</strong><span class="note">Meta Ads 데이터를 불러오고 있습니다.</span>`);
  setPending("#adCoreKpi", `<article class="action-item"><strong>핵심 지표 확인 중</strong><p>광고비, ROAS, 실매출을 확인합니다.</p></article>`);
  setPending("#advertisingSummary", `<article class="action-item"><strong>Meta 광고 데이터 확인 중</strong><p>광고비, 도달, 클릭, 구매값, ROAS를 확인합니다.</p></article>`);
  setPending("#campaignPerformance", `<article class="action-item"><strong>캠페인 성과 확인 중</strong><p>Meta 캠페인 기준으로 불러옵니다.</p></article>`);
  setPending("#adReconciliationSummary", `<article class="action-item"><strong>데이터 일치 검증 확인 중</strong><p>Meta 계정 전체 합계와 비교하고 있습니다.</p></article>`);
  setPending("#adFullReportActiveRows", `<tr><td colspan="18">전체 캠페인 데이터를 확인하고 있습니다.</td></tr>`);
  commerceSummaryState = { cafe: null, comparison: null, totalSales: null };
  setPending("#salesHealthBanner", `<span class="status-dot"></span><strong>Sales Health 확인 중</strong><span class="note">Meta · Cafe24 데이터를 불러오고 있습니다.</span>`);
  setPending("#commerceSummaryHero", `<article class="action-item"><strong>Commerce 데이터 확인 중</strong><p>Cafe24 canonical 데이터를 불러오고 있습니다.</p></article>`);
  setPending("#commerceSummaryCompare", `<article class="action-item"><strong>Meta 비교 확인 중</strong><p>Meta 구매값과 Cafe24 실제 판매를 비교합니다.</p></article>`);
  setPending("#commerceSummaryPayments", `<article class="action-item"><strong>결제수단 확인 중</strong><p>결제수단 구성을 불러오고 있습니다.</p></article>`);
  setPending("#campaignPeriodComparison", `<article class="action-item"><strong>기간 비교 계산 중</strong><p>Cafe24 실제 매출 기준으로 기준 기간과 대상 기간을 비교합니다.</p></article>`);
  renderCafe24Sales(data, renderSeq);
  renderAdComparison(data, renderSeq);
  renderAdvertising(data, renderSeq);
  renderContentOperations(data, renderSeq);
  return renderSeq;
}

function intelligenceUrl(path) {
  return `${intelligenceBaseUrl}${path}`;
}

function setIntelligencePanel(panel = "overview") {
  if (panel === "decisions" || panel === "learning") panel = "overview";
  activeIntelligencePanel = panel;
  if (panel !== "overview") intelligenceRenderSeq += 1;
  if (panel !== "brand") intelligenceBrandRenderSeq += 1;
  if (panel !== "decisions") intelligenceDecisionsRenderSeq += 1;
  if (panel !== "timeline") intelligenceTimelineRenderSeq += 1;
  if (panel !== "learning") intelligenceLearningRenderSeq += 1;
  $$("[data-intelligence-panel]").forEach((node) => node.toggleAttribute("hidden", node.dataset.intelligencePanel !== panel));
  $$("[data-intelligence-panel-tab]").forEach((button) => button.classList.toggle("active", button.dataset.intelligencePanelTab === panel));
  refreshActiveIntelligencePanel();
}

// data-intelligence-panel-tab="brand"를 mission 카드의 "상세" 버튼 없이 직접 클릭하면
// selectedIntelligenceMission이 비어 있어 renderIntelligenceBrandDetail의
// `if (!target || !mission?.brandId) return;` 가드에 걸려 아무것도 렌더되지 않고
// #intelligenceBrandDetail이 HTML 초기 상태(빈 div) 그대로 남아 탭은 active인데
// 콘텐츠만 공백으로 보이는 회귀가 있었다. 이 래퍼가 그 경우를 명시적 안내 문구로 채운다.
function renderIntelligenceBrandPanel() {
  if (selectedIntelligenceMission?.brandId) {
    renderIntelligenceBrandDetail(selectedIntelligenceMission);
    return;
  }
  const target = $("#intelligenceBrandDetail");
  if (!target) return;
  const titleTarget = $("#intelligenceBrandTitle");
  if (titleTarget) titleTarget.textContent = "브랜드 상세";
  target.innerHTML = `<article class="action-item sales-list-card sales-empty-card"><span>Brand Intelligence</span><strong>선택된 브랜드가 없습니다</strong><p>Mission 카드의 "상세 / Decision 기록" 버튼을 눌러 브랜드를 선택해주세요.</p></article>`;
}

// 헤더의 새로고침 버튼이 항상 Overview만 새로고침해서, Decisions/Timeline/Learning/Brand
// 탭을 보는 중에는 눌러도 화면상 아무 변화가 없어 "동작하지 않는다"로 보이는 문제가 있었다.
// 현재 활성 탭 기준으로 재요청하도록 dispatch만 추가한다(API/데이터 계약 변경 없음).
function refreshActiveIntelligencePanel() {
  if (activeIntelligencePanel === "decisions") return renderIntelligenceDecisions();
  if (activeIntelligencePanel === "timeline") return renderIntelligenceTimeline();
  if (activeIntelligencePanel === "learning") return renderIntelligenceLearning();
  if (activeIntelligencePanel === "brand") return renderIntelligenceBrandPanel();
  return renderIntelligenceDashboard();
}

async function renderIntelligenceDashboard() {
  const statusTarget = $("#intelligenceStatus");
  const briefTarget = $("#intelligenceBrief");
  const missionTarget = $("#intelligenceMissions");
  if (!statusTarget || !briefTarget || !missionTarget) return;
  const renderSeq = ++intelligenceRenderSeq;
  const searchInput = $("#intelligenceBrandSearch");
  const searchState = $("#intelligenceSearchState");
  if (searchInput) searchInput.value = "";
  if (searchState) searchState.textContent = "TOP5 브랜드 이슈를 우선 표시합니다.";
  statusTarget.className = "ad-status-banner loading";
  statusTarget.innerHTML = `<span class="status-dot"></span><strong>브랜드 이슈를 분석하고 있습니다.</strong><span class="note">검색창은 먼저 사용할 수 있습니다.</span>`;
  briefTarget.innerHTML = "";
  missionTarget.innerHTML = intelligenceOverviewSkeletonHtml();
  const loadingTimer = setTimeout(() => {
    if (renderSeq !== intelligenceRenderSeq) return;
    statusTarget.innerHTML = `<span class="status-dot"></span><strong>여러 데이터 소스를 확인하고 있어 시간이 조금 걸리고 있습니다.</strong><span class="note">마지막 성공 결과가 있으면 먼저 표시됩니다.</span>`;
  }, 5000);
  const [health, brief, missions] = await Promise.all([
    getJson(intelligenceUrl("/api/intelligence/health"), 5000),
    getJson(intelligenceUrl("/api/intelligence/brief"), 40000),
    getJson(intelligenceUrl("/api/intelligence/missions?limit=5"), 40000)
  ]);
  clearTimeout(loadingTimer);
  if (renderSeq !== intelligenceRenderSeq) return;
  renderIntelligenceStatus(health);
  if (missions.error || !missions.ok) {
    briefTarget.innerHTML = "";
    missionTarget.innerHTML = `<article class="action-item sales-empty-card"><strong>Intelligence 데이터를 불러오지 못했습니다.</strong><p>서비스 상태를 확인한 뒤 다시 시도해주세요.</p><button class="today-jump-button" type="button" data-intelligence-refresh>다시 시도</button></article>`;
    return;
  }
  const rows = Array.isArray(missions.missions) ? missions.missions : [];
  const detailPairs = await Promise.all(rows.map(async (mission) => {
    const brandId = mission?.brand?.id;
    if (!brandId) return [brandId, null];
    return [brandId, await fetchIntelligenceBrandOverviewRecord(brandId)];
  }));
  if (renderSeq !== intelligenceRenderSeq) return;
  intelligenceOverviewState = {
    missions: rows,
    brief,
    details: new Map(detailPairs),
    cached: Boolean(missions.meta?.cached || brief?.cached),
    refreshing: Boolean(missions.meta?.refreshing || brief?.refreshing)
  };
  renderIntelligenceOverviewMeta(brief, missions.meta || {});
  renderIntelligenceIssueCards(rows, intelligenceOverviewState.details, { mode: "top" });
}

function renderIntelligenceStatus(health = {}) {
  const target = $("#intelligenceStatus");
  if (!target) return;
  if (health.error || !health.ok) {
    target.className = "ad-status-banner error";
    target.innerHTML = `<span class="status-dot"></span><strong>Intelligence Service 연결 불가</strong><span class="note">서비스를 실행한 뒤 다시 확인해주세요.</span>`;
    return;
  }
  target.className = "ad-status-banner good";
  target.innerHTML = `<span class="status-dot"></span><strong>Intelligence Service 연결됨</strong><span class="note">마지막 확인 ${esc(intelligenceTimeLabel(health.timestamp))}</span>`;
}

function renderIntelligenceBrief(brief = {}) {
  const target = $("#intelligenceBrief");
  if (!target) return;
  if (brief.error || !brief.ok) {
    target.innerHTML = `<article class="action-item"><strong>Brief 확인 불가</strong><p>Intelligence Service 응답을 확인할 수 없습니다.</p></article>`;
    return;
  }
  const items = Array.isArray(brief.items) ? brief.items : [];
  if (!items.length) {
    target.innerHTML = `<article class="action-item"><strong>${esc(brief.headline || "현재 우선 확인할 Mission이 없습니다")}</strong><p>Mission이 생성되면 이곳에 표시됩니다.</p></article>`;
    return;
  }
  target.innerHTML = [
    `<article class="action-item ad-summary-card ad-core-kpi-card"><span>Brief</span><strong>${esc(brief.headline || `Mission ${items.length}건`)}</strong><p>Mission ${apiNum(brief.missionCount ?? items.length)}건</p></article>`,
    ...items.map((item) => intelligenceBriefCard(item))
  ].join("");
}

function renderIntelligenceMissions(missions = {}) {
  const target = $("#intelligenceMissions");
  if (!target) return;
  if (missions.error || !missions.ok) {
    target.innerHTML = `<article class="action-item"><strong>Mission 확인 불가</strong><p>Intelligence Service 응답을 확인할 수 없습니다.</p></article>`;
    return;
  }
  const rows = Array.isArray(missions.missions) ? missions.missions : [];
  target.innerHTML = rows.length
    ? rows.map((mission) => intelligenceMissionCard(mission)).join("")
    : `<article class="action-item"><strong>현재 우선 확인할 Mission이 없습니다</strong><p>Brand Intelligence action이 생성되면 이곳에 표시됩니다.</p></article>`;
}

function intelligenceOverviewSkeletonHtml() {
  return Array.from({ length: 5 }, (_, index) => `<article class="intelligence-issue-card intelligence-skeleton-card">
    <div class="intelligence-issue-card-header"><span class="intelligence-issue-rank">TOP ${index + 1}</span></div>
    <div class="intelligence-issue-title"><strong></strong></div>
    <div class="intelligence-issue-body"><p></p></div>
  </article>`).join("");
}

function renderIntelligenceOverviewMeta(brief = {}, meta = {}) {
  const target = $("#intelligenceBrief");
  if (!target) return;
  const count = Number(meta?.missionCount ?? brief?.missionCount ?? intelligenceOverviewState.missions.length ?? 0);
  const cacheState = meta.cached
    ? (meta.refreshing ? "cached · refreshing" : "cached")
    : (meta.refreshing ? "refreshing" : "live");
  const checkedAt = meta.cacheUpdatedAt || meta.generatedAt || brief.generatedAt || new Date().toISOString();
  target.innerHTML = `<article class="action-item intelligence-overview-note">
    <span>오늘 확인할 브랜드</span>
    <strong>${apiNum(Number.isFinite(count) ? count : 0)}건</strong>
    <p>Mission · ${esc(cacheState)} · 마지막 확인 ${esc(intelligenceTimeLabel(checkedAt))}</p>
  </article>`;
}

function renderIntelligenceIssueCards(missions = [], details = new Map(), options = {}) {
  const target = $("#intelligenceMissions");
  if (!target) return;
  if (!missions.length) {
    target.innerHTML = `<article class="intelligence-empty-card sales-empty-card"><strong>${options.mode === "search" ? "검색 결과가 없습니다" : "현재 우선 확인할 브랜드 이슈가 없습니다"}</strong><p>${options.mode === "search" ? "브랜드명 또는 alias를 다시 확인해주세요." : "Mission이 생성되면 이곳에 표시됩니다."}</p></article>`;
    return;
  }
  target.innerHTML = missions.map((mission, index) => intelligenceIssueCard(mission, details.get(mission?.brand?.id), index)).join("");
}

function intelligenceIssueCard(mission = {}, detailRecord = {}, index = 0) {
  const detail = intelligenceOverviewDetail(detailRecord);
  const input = intelligenceOverviewInput(detailRecord);
  const signalIds = Array.isArray(mission.signalIds) ? mission.signalIds.join(",") : "";
  const brandName = intelligenceBrandDisplayName(mission.brand, detailRecord);
  const issue = intelligenceIssueSentence(mission, detail);
  const metrics = intelligenceEvidenceMetrics(detail);
  const action = mission.title || (Array.isArray(detail?.actions) && detail.actions[0]?.title) || "상세 확인";
  const source = intelligenceSourceSummary(detail?.sources || input?.sources);
  return `<article class="intelligence-issue-card"
    tabindex="0"
    role="button"
    aria-label="${esc(`${brandName} 상세 보기`)}"
    data-mission-id="${esc(mission.id || `search:${mission.brand?.id || ""}`)}"
    data-brand-id="${esc(mission.brand?.id || "")}"
    data-brand-name="${esc(brandName)}"
    data-priority="${esc(mission.priority || "")}"
    data-source-action-id="${esc(mission.sourceActionId || "")}"
    data-signal-ids="${esc(signalIds)}"
    data-intelligence-brand-detail>
    <div class="intelligence-issue-card-header">
      <span class="intelligence-issue-rank">${String(index + 1).padStart(2, "0")}</span>
      <div class="intelligence-issue-badges">${intelligencePriorityBadge(mission.priority)}<small class="intelligence-source-badge">${esc(source)}</small></div>
    </div>
    <div class="intelligence-issue-title"><strong class="intelligence-issue-brand">${esc(brandName)}</strong></div>
    <div class="intelligence-issue-body"><p class="intelligence-issue-copy">${esc(issue)}</p></div>
    <div class="intelligence-issue-metrics">${metrics.map((item) => `<div class="intelligence-issue-metric"><em>${esc(item.label)}</em><b>${esc(item.value)}</b></div>`).join("")}</div>
    <footer class="intelligence-issue-action"><em>지금 할 일</em><b>${esc(action)}</b></footer>
  </article>`;
}

async function fetchIntelligenceBrandOverviewRecord(brandId) {
  const [detail, input] = await Promise.all([
    getJson(intelligenceUrl(`/api/intelligence/brand/${encodeURIComponent(brandId)}`), 40000),
    getJson(intelligenceUrl(`/api/intelligence/brand/${encodeURIComponent(brandId)}/input`), 40000)
  ]);
  return {
    detail: detail?.ok ? detail.data : null,
    input: input?.ok ? input.data : null
  };
}

function intelligenceOverviewDetail(record = {}) {
  return record?.detail || (record?.brand && record?.signals ? record : {}) || {};
}

function intelligenceOverviewInput(record = {}) {
  return record?.input || {};
}

function intelligenceBrandDisplayName(brand = {}, record = {}) {
  const detail = intelligenceOverviewDetail(record);
  const input = intelligenceOverviewInput(record);
  const canonicalName = intelligenceBrandName(detail?.brand || input?.brand || brand);
  return intelligenceCafe24BrandDisplayName(input)
    || intelligenceCafe24BrandDisplayName(detail)
    || intelligenceRepresentativeEnglishAlias(input)
    || intelligenceRepresentativeEnglishAlias(detail)
    || canonicalName;
}

function intelligenceCafe24BrandDisplayName(source = {}) {
  const commerce = source?.commerce?.data || source?.commerce || {};
  const candidates = [
    commerce.brandName,
    commerce.brand_name,
    commerce.cafe24BrandName,
    commerce.displayName,
    commerce.name
  ];
  const products = Array.isArray(commerce.products) ? commerce.products : [];
  for (const product of products) {
    const parsed = intelligenceBrandNameFromProductName(product?.productName);
    if (parsed) candidates.push(parsed);
  }
  return candidates.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function intelligenceBrandNameFromProductName(productName = "") {
  const match = String(productName || "").match(/^\s*\[\s*([^:\]]+?)\s*:\s*[^\]]+?\]\s*/);
  return match?.[1]?.trim() || "";
}

function intelligenceRepresentativeEnglishAlias(source = {}) {
  const aliasCandidates = [
    source?.brand?.englishName,
    source?.brand?.alias,
    source?.brand?.nameEn,
    ...(Array.isArray(source?.brand?.aliases) ? source.brand.aliases : []),
    ...(Array.isArray(source?.aliases) ? source.aliases.map((alias) => alias?.alias || alias?.name || alias) : [])
  ];
  return aliasCandidates
    .map((value) => String(value || "").trim())
    .find((value) => /[A-Za-z]/.test(value)) || "";
}

function intelligenceIssueSentence(mission = {}, detail = {}) {
  const ids = new Set([...(Array.isArray(mission.signalIds) ? mission.signalIds : []), ...(Array.isArray(detail?.signals) ? detail.signals.map((signal) => signal.id) : [])]);
  const sources = detail?.sources || {};
  if (Object.values(sources).some((source) => source?.status === "unavailable" || source?.unavailable)) return "일부 데이터 연결을 확인해야 합니다.";
  if (ids.has("search_demand_without_sales") || ids.has("search_demand_no_sales")) return "검색 수요는 있지만 최근 온라인 판매가 없습니다.";
  if (ids.has("sales_without_search_snapshot") || ids.has("search_snapshot_missing")) return "온라인 판매는 있지만 검색 데이터가 없습니다.";
  return mission.reason || detail?.summary || "브랜드 상태를 확인해야 합니다.";
}

function intelligenceEvidenceMetrics(detail = {}) {
  const signals = Array.isArray(detail?.signals) ? detail.signals : [];
  const metrics = [];
  for (const signal of signals) {
    const evidence = signal?.evidence || {};
    if (metrics.length < 3 && Number.isFinite(Number(evidence.salesAmount))) metrics.push({ label: "온라인 매출", value: apiWon(evidence.salesAmount) });
    if (metrics.length < 3 && Number.isFinite(Number(evidence.orderCount))) metrics.push({ label: "주문", value: `${apiNum(evidence.orderCount)}건` });
    if (metrics.length < 3 && Number.isFinite(Number(evidence.quantitySold))) metrics.push({ label: "판매수량", value: `${apiNum(evidence.quantitySold)}개` });
    if (metrics.length < 3 && Number.isFinite(Number(evidence.pcSearchVolume))) metrics.push({ label: "PC 검색", value: apiNum(evidence.pcSearchVolume) });
    if (metrics.length < 3 && Number.isFinite(Number(evidence.mobileSearchVolume))) metrics.push({ label: "모바일 검색", value: apiNum(evidence.mobileSearchVolume) });
    if (metrics.length >= 3) break;
  }
  return metrics.length ? metrics : [{ label: "근거", value: "상세 확인" }];
}

function intelligenceSourceSummary(sources = {}) {
  const entries = Object.entries(sources || {});
  if (!entries.length) return "source 상태 확인 중";
  const matched = entries.filter(([, source]) => source?.status === "matched" || source?.matched).map(([key]) => key);
  const unavailable = entries.filter(([, source]) => source?.status === "unavailable" || source?.unavailable).map(([key]) => key);
  if (unavailable.length) return `확인 필요: ${unavailable.join(", ")}`;
  return matched.length ? `연결됨: ${matched.join(", ")}` : "일부 source 미매칭";
}

function scheduleIntelligenceBrandSearch() {
  clearTimeout(intelligenceSearchTimer);
  intelligenceSearchTimer = setTimeout(renderIntelligenceBrandSearch, 300);
}

async function renderIntelligenceBrandSearch() {
  const input = $("#intelligenceBrandSearch");
  const state = $("#intelligenceSearchState");
  const target = $("#intelligenceMissions");
  const query = input?.value?.trim() || "";
  const searchSeq = ++intelligenceSearchRenderSeq;
  if (!target) return;
  if (!query) {
    if (state) state.textContent = "TOP5 브랜드 이슈를 우선 표시합니다.";
    renderIntelligenceIssueCards(intelligenceOverviewState.missions, intelligenceOverviewState.details, { mode: "top" });
    return;
  }
  if (state) state.textContent = "브랜드를 찾고 있습니다.";
  target.innerHTML = intelligenceOverviewSkeletonHtml();
  const registry = await readIntelligenceBrands();
  const normalized = query.toLowerCase();
  const localMatch = (registry.brands || []).find((brand) => String(brand.name || "").toLowerCase().includes(normalized) || String(brand.id || "").toLowerCase() === normalized);
  const resolved = await getJson(intelligenceUrl(`/api/intelligence/brands/resolve?name=${encodeURIComponent(query)}`), 10000);
  if (searchSeq !== intelligenceSearchRenderSeq) return;
  if (!($("#intelligenceBrandSearch")?.value?.trim() || "")) {
    if (state) state.textContent = "TOP5 브랜드 이슈를 우선 표시합니다.";
    renderIntelligenceIssueCards(intelligenceOverviewState.missions, intelligenceOverviewState.details, { mode: "top" });
    return;
  }
  const brandId = resolved?.brand?.brandId || localMatch?.id || "";
  const brandName = resolved?.brand?.name || localMatch?.name || query;
  if (!brandId) {
    if (state) state.textContent = "검색 결과가 없습니다.";
    renderIntelligenceIssueCards([], new Map(), { mode: "search" });
    return;
  }
  const detailRecord = await fetchIntelligenceBrandOverviewRecord(brandId);
  if (searchSeq !== intelligenceSearchRenderSeq) return;
  if (!($("#intelligenceBrandSearch")?.value?.trim() || "")) {
    if (state) state.textContent = "TOP5 브랜드 이슈를 우선 표시합니다.";
    renderIntelligenceIssueCards(intelligenceOverviewState.missions, intelligenceOverviewState.details, { mode: "top" });
    return;
  }
  const data = intelligenceOverviewDetail(detailRecord);
  if (!data?.brand) {
    if (state) state.textContent = "브랜드 데이터를 확인하지 못했습니다.";
    target.innerHTML = `<article class="action-item sales-empty-card"><strong>브랜드 데이터를 확인하지 못했습니다</strong><p>${esc(brandName)} 응답을 다시 확인해주세요.</p></article>`;
    return;
  }
  const action = Array.isArray(data.actions) ? data.actions[0] : null;
  const displayName = intelligenceBrandDisplayName({ id: brandId, name: data.brand?.name || brandName }, detailRecord);
  const mission = {
    id: `search:${brandId}`,
    priority: action?.priority || "low",
    brand: { id: brandId, name: data.brand?.name || brandName },
    title: action?.title || "상세 확인",
    reason: action?.reason || data.summary || "브랜드 상태를 확인하세요.",
    signalIds: Array.isArray(action?.signalIds) ? action.signalIds : [],
    sourceActionId: action?.id || ""
  };
  if (state) state.textContent = `${displayName} 검색 결과`;
  renderIntelligenceIssueCards([mission], new Map([[brandId, detailRecord]]), { mode: "search" });
}

function intelligenceBriefCard(item = {}) {
  return `<article class="action-item sales-compare-card">
    ${intelligencePriorityBadge(item.priority)}
    <span>${esc(intelligenceBrandName(item.brand))}</span>
    <strong>${esc(item.title || "Mission")}</strong>
    <p>${esc(item.reason || "Mission 근거 없음")}</p>
  </article>`;
}

function intelligenceMissionCard(mission = {}) {
  const signalIds = Array.isArray(mission.signalIds) ? mission.signalIds.join(",") : "";
  return `<article class="action-item sales-list-card"
    data-mission-id="${esc(mission.id || "")}"
    data-brand-id="${esc(mission.brand?.id || "")}"
    data-brand-name="${esc(intelligenceBrandName(mission.brand))}"
    data-priority="${esc(mission.priority || "")}"
    data-source-action-id="${esc(mission.sourceActionId || "")}"
    data-signal-ids="${esc(signalIds)}">
    ${intelligencePriorityBadge(mission.priority)}
    <span>${esc(intelligenceBrandName(mission.brand))}</span>
    <strong>${esc(mission.title || "Mission")}</strong>
    <p>${esc(mission.reason || "Mission 근거 없음")}</p>
    <small>${esc(mission.sourceActionId || "source action 없음")}</small>
    <button class="today-jump-button" type="button" data-intelligence-brand-detail>상세 / Decision 기록</button>
  </article>`;
}

function intelligencePriorityBadge(priority = "") {
  const tone = priority === "high" ? "urgent" : priority === "medium" ? "warn" : "good";
  const label = priority || "low";
  return `<span class="badge ${esc(tone)}">${esc(label)}</span>`;
}

function intelligenceBrandName(brand) {
  if (typeof brand === "string") return brand;
  return brand?.name || brand?.id || "브랜드";
}

function intelligenceTimeLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function readMissionDataset(node) {
  if (!node) return null;
  const signalIds = (node.dataset.signalIds || "").split(",").map((item) => item.trim()).filter(Boolean);
  return {
    id: node.dataset.missionId || "",
    brandId: node.dataset.brandId || "",
    brandName: node.dataset.brandName || "",
    priority: node.dataset.priority || "",
    sourceActionId: node.dataset.sourceActionId || "",
    signalIds
  };
}

async function readIntelligenceBrands() {
  if (intelligenceBrandCache) return intelligenceBrandCache;
  const result = await getJson(intelligenceUrl("/api/intelligence/brands"), 10000);
  if (result.error || !result.ok) return { brands: [] };
  intelligenceBrandCache = result;
  return result;
}

function intelligenceBrandLabel(brandId, brands = []) {
  return brands.find((brand) => brand.id === brandId)?.name || brandId || "브랜드";
}

async function renderIntelligenceBrandDetail(mission) {
  const target = $("#intelligenceBrandDetail");
  if (!target || !mission?.brandId) return;
  const renderSeq = ++intelligenceBrandRenderSeq;
  $("#intelligenceBrandTitle").textContent = mission.brandName || mission.brandId;
  target.innerHTML = `<article class="action-item"><strong>Brand Intelligence 확인 중</strong><p>${esc(mission.brandName || mission.brandId)} 데이터를 불러오고 있습니다.</p></article>`;
  const [detail, input] = await Promise.all([
    getJson(intelligenceUrl(`/api/intelligence/brand/${encodeURIComponent(mission.brandId)}`), 40000),
    getJson(intelligenceUrl(`/api/intelligence/brand/${encodeURIComponent(mission.brandId)}/input`), 40000)
  ]);
  if (renderSeq !== intelligenceBrandRenderSeq) return;
  if (detail.error || !detail.ok) {
    target.innerHTML = `<article class="action-item"><strong>Brand Intelligence 확인 불가</strong><p>Intelligence Service 응답을 확인할 수 없습니다.</p></article>`;
    return;
  }
  const data = detail.data || {};
  const inputData = input?.data || {};
  const displayName = intelligenceBrandDisplayName(
    { id: mission.brandId, name: data.brand?.name || mission.brandName || mission.brandId },
    { detail: data, input: inputData }
  );
  const canonicalName = intelligenceBrandName(data.brand || { id: mission.brandId, name: mission.brandName });
  $("#intelligenceBrandTitle").textContent = displayName;
  const sources = data.sources || {};
  const signals = Array.isArray(data.signals) ? data.signals : [];
  const actions = Array.isArray(data.actions) ? data.actions : [];
  target.innerHTML = [
    `<div class="cards intelligence-brand-priority-grid">
      <article class="action-item ad-summary-card ad-core-kpi-card"><span>Brand</span><strong>${esc(displayName)}</strong><p>${canonicalName !== displayName ? `${esc(canonicalName)} · ` : ""}${esc(data.period?.since || inputData.period?.since || "-")} ~ ${esc(data.period?.until || inputData.period?.until || "-")}</p></article>
      <article class="action-item sales-list-card"><span>Summary</span><strong>${esc(data.summary || "요약 없음")}</strong><p>API rule 기반 요약</p></article>
    </div>`,
    intelligenceActionSummaryCard(actions),
    renderBrandTimelineSection(buildBrandTimeline({ detail: data, input: inputData, mission })),
    intelligenceDecisionForm(mission),
    `<div class="cards intelligence-source-grid">${["commerce", "marketing", "content", "search"].map((key) => intelligenceSourceCard(key, sources[key])).join("")}</div>`,
    `<div class="cards intelligence-evidence-grid">${intelligenceEvidenceCards(data, inputData).join("")}</div>`,
    intelligenceRawSignalsBlock(signals)
  ].join("");
}

function buildBrandTimeline(brand = {}) {
  const detail = brand.detail || brand.data || brand || {};
  const input = brand.input || {};
  const mission = brand.mission || {};
  const generatedAt = detail?.meta?.generatedAt || input?.meta?.generatedAt || new Date().toISOString();
  const events = [];
  const addEvent = (event) => {
    if (!event?.title) return;
    events.push({
      date: event.date || generatedAt,
      category: event.category || "ai",
      type: event.type || "event",
      title: event.title,
      description: event.description || ""
    });
  };
  const commerce = input?.commerce?.data || {};
  if (Number.isFinite(Number(commerce.salesAmount ?? commerce.paidAmount))) {
    addEvent({
      category: "commerce",
      type: "sales",
      title: "온라인 매출 확인",
      description: `최근 온라인 매출 ${apiWon(commerce.salesAmount ?? commerce.paidAmount)} · 주문 ${apiNum(commerce.orderCount)}건 · 판매수량 ${apiNum(commerce.quantitySold)}개`
    });
  }
  if (Array.isArray(commerce.products)) {
    commerce.products.slice(0, 3).forEach((product) => addEvent({
      category: "commerce",
      type: "product",
      title: product.productName || "판매 상품",
      description: `온라인 매출 ${apiWon(product.salesAmount)} · 주문 ${apiNum(product.orderCount)}건 · 수량 ${apiNum(product.quantitySold)}개`
    }));
  }
  const marketing = input?.marketing || {};
  const marketingData = marketing.data || {};
  if (marketing.status === "matched" && (Number.isFinite(Number(marketingData.spend)) || Number.isFinite(Number(marketingData.campaignCount)) || (Array.isArray(marketingData.campaigns) && marketingData.campaigns.length))) {
    addEvent({
      category: "marketing",
      type: "matched",
      title: "광고 데이터 연결",
      description: [
        Number.isFinite(Number(marketingData.spend)) ? `광고비 ${apiWon(marketingData.spend)}` : "",
        Number.isFinite(Number(marketingData.campaignCount)) ? `캠페인 ${apiNum(marketingData.campaignCount)}건` : ""
      ].filter(Boolean).join(" · ") || "Meta source 데이터가 연결됐습니다."
    });
  }
  const content = input?.content || {};
  const contentData = content.data || {};
  const contentPosts = Array.isArray(contentData.posts) ? contentData.posts : [];
  if (content.status === "matched" && contentPosts.length) {
    addEvent({
      category: "content",
      type: "matched",
      title: "콘텐츠 데이터 연결",
      description: `Instagram 콘텐츠 ${apiNum(contentPosts.length)}건`
    });
  }
  const search = input?.search || {};
  const searchData = search.data || {};
  const searchRows = Array.isArray(searchData.rows) ? searchData.rows : [];
  if (search.status === "matched" && searchRows.length) {
    const firstRow = searchRows[0] || {};
    const queryTotal = [firstRow.monthlyPcQueryCount, firstRow.monthlyMobileQueryCount]
      .map((value) => Number(value))
      .filter(Number.isFinite)
      .reduce((sum, value) => sum + value, 0);
    addEvent({
      date: searchData.collectedAt || generatedAt,
      category: "search",
      type: "snapshot",
      title: "검색 Snapshot 수집",
      description: [
        searchData.keyword ? `키워드 ${searchData.keyword}` : "",
        Number.isFinite(queryTotal) && queryTotal > 0 ? `월 검색 ${apiNum(queryTotal)}회` : "",
        firstRow.competitionIndex ? `경쟁 ${firstRow.competitionIndex}` : ""
      ].filter(Boolean).join(" · ") || "Naver Search Ads snapshot이 연결됐습니다."
    });
  }
  const excludedTimelineActionIds = new Set(["collect_search_snapshot"]);
  (Array.isArray(detail.actions) ? detail.actions : []).filter((action) => !excludedTimelineActionIds.has(action?.id)).forEach((action) => addEvent({
    category: "ai",
    type: action.id || "action",
    title: intelligenceActionHumanLabel(action),
    description: action.reason || action.title || ""
  }));
  if (mission?.title && !excludedTimelineActionIds.has(mission.sourceActionId)) {
    addEvent({
      category: "ai",
      type: mission.sourceActionId || "mission",
      title: mission.title,
      description: mission.reason || ""
    });
  }
  return events.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));
}

function intelligenceSignalDescription(signal = {}) {
  const evidence = signal.evidence || {};
  const parts = [];
  if (Number.isFinite(Number(evidence.salesAmount))) parts.push(`온라인 매출 ${apiWon(evidence.salesAmount)}`);
  if (Number.isFinite(Number(evidence.orderCount))) parts.push(`주문 ${apiNum(evidence.orderCount)}건`);
  if (Number.isFinite(Number(evidence.quantitySold))) parts.push(`판매수량 ${apiNum(evidence.quantitySold)}개`);
  if (evidence.reason) parts.push(evidence.reason);
  return parts.join(" · ") || signal.id || "";
}

function renderBrandTimelineSection(events = []) {
  const categories = [
    ["all", "ALL"],
    ["commerce", "Commerce"],
    ["marketing", "Marketing"],
    ["content", "Content"],
    ["search", "Search"],
    ["ai", "AI"]
  ];
  const rows = events.length
    ? events.map((event) => brandTimelineEventHtml(event)).join("")
    : "";
  return `<section class="monthly-report-block" data-brand-timeline>
    <div class="monthly-report-block-head"><div><span>Brand Timeline</span><strong>Unified Brand Timeline</strong></div></div>
    <div class="product-action-filters">${categories.map(([value, label]) => `<button class="product-action-filter ${value === "all" ? "active" : ""}" type="button" data-brand-timeline-filter="${value}">${label}</button>`).join("")}</div>
    <div class="cards" data-brand-timeline-events>${rows}<article class="action-item sales-list-card" data-brand-timeline-empty ${events.length ? "hidden" : ""}><span>Timeline</span><strong>${events.length ? "이 카테고리에 표시할 실제 이벤트가 없습니다." : "표시할 실제 브랜드 이벤트가 없습니다."}</strong><p>Source 상태와 raw signal은 아래 섹션에서 확인할 수 있습니다.</p></article></div>
  </section>`;
}

function brandTimelineEventHtml(event = {}) {
  return `<article class="action-item sales-list-card" data-brand-timeline-event="${esc(event.category || "ai")}">
    <span>● ${esc(brandTimelineDateLabel(event.date))}</span>
    <strong>${esc(event.title || "Timeline Event")}</strong>
    <p>${esc(event.description || "")}</p>
  </article>`;
}

function brandTimelineDateLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

function intelligenceSourceCard(name, source = {}) {
  const status = source?.status || "unknown";
  const tone = status === "matched" ? "good" : status === "unavailable" ? "urgent" : "warn";
  const label = {
    commerce: "Commerce",
    marketing: "Marketing",
    content: "Content",
    search: "Search"
  }[name] || name;
  return `<article class="action-item sales-list-card intelligence-source-card ${esc(tone)}"><span>${esc(label)}</span><strong>${esc(intelligenceSourceHumanStatus(name, source))}</strong><p>${esc(intelligenceSourceHelpText(name, source))}</p></article>`;
}

function intelligenceSourceHumanStatus(name, source = {}) {
  const status = source?.status || "unknown";
  if (status === "matched" || source?.matched) return "데이터 연결됨";
  if (status === "unavailable" || source?.unavailable) return "확인 필요";
  if (name === "search") return "Snapshot 없음";
  return "데이터 없음";
}

function intelligenceSourceHelpText(name, source = {}) {
  const status = source?.status || "unknown";
  if (status === "matched" || source?.matched) return "현재 브랜드와 연결된 source입니다.";
  if (status === "unavailable" || source?.unavailable) return "source 응답을 다시 확인해야 합니다.";
  if (name === "search") return "Naver 검색 snapshot이 아직 없습니다.";
  return "현재 기간에 매칭된 데이터가 없습니다.";
}

function intelligenceActionSummaryCard(actions = []) {
  const actionItems = actions.length
    ? actions.map(intelligenceActionHumanLabel)
    : ["현재 즉시 실행할 권장 행동이 없습니다."];
  return `<article class="intelligence-action-summary">
    <span>지금 해야 할 일</span>
    <ul>${actionItems.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
  </article>`;
}

function intelligenceActionHumanLabel(action = {}) {
  const source = `${action.id || ""} ${action.title || ""} ${action.reason || ""}`.toLowerCase();
  if (source.includes("search") || source.includes("naver") || source.includes("snapshot")) return "Naver 검색 Snapshot 수집";
  if (source.includes("ad") || source.includes("campaign") || source.includes("marketing") || source.includes("meta")) return "광고 캠페인 상태 확인";
  if (source.includes("content") || source.includes("instagram")) return "콘텐츠 업로드 상태 검토";
  if (source.includes("mapping") || source.includes("brand")) return "브랜드 매핑 확인";
  return action.title || action.reason || "브랜드 상태 확인";
}

function intelligenceEvidenceCards(data = {}, inputData = {}) {
  const commerce = inputData?.commerce?.data || {};
  const marketing = inputData?.marketing || {};
  const content = inputData?.content || {};
  const search = inputData?.search || {};
  const evidence = [
    { label: "브랜드 온라인 매출", value: Number.isFinite(Number(commerce.salesAmount ?? commerce.paidAmount)) ? apiWon(commerce.salesAmount ?? commerce.paidAmount) : "데이터 없음", note: "Cafe24 온라인" },
    { label: "주문", value: Number.isFinite(Number(commerce.orderCount)) ? `${apiNum(commerce.orderCount)}건` : "데이터 없음", note: "정상 주문 기준" },
    { label: "판매수량", value: Number.isFinite(Number(commerce.quantitySold)) ? `${apiNum(commerce.quantitySold)}개` : "데이터 없음", note: "주문 item 기준" },
    { label: "검색 snapshot", value: intelligenceSourceHumanStatus("search", data?.sources?.search || search), note: "Naver Search Ads" },
    { label: "Meta", value: intelligenceSourceHumanStatus("marketing", data?.sources?.marketing || marketing), note: "광고 source" },
    { label: "Instagram", value: intelligenceSourceHumanStatus("content", data?.sources?.content || content), note: "콘텐츠 source" }
  ];
  return evidence.map((item) => `<article class="intelligence-evidence-card"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><p>${esc(item.note)}</p></article>`);
}

function intelligenceRawSignalsBlock(signals = []) {
  return `<details class="intelligence-raw-signals">
    <summary>Raw signal</summary>
    <div class="cards">${signals.length ? signals.map(intelligenceSignalCard).join("") : `<article class="action-item"><strong>Signal 없음</strong><p>현재 선택 기간에 표시할 signal이 없습니다.</p></article>`}</div>
  </details>`;
}

function intelligenceSignalCard(signal = {}) {
  return `<article class="action-item sales-list-card">
    ${intelligencePriorityBadge(signal.priority)}
    <span>${esc(signal.type || "signal")}</span>
    <strong>${esc(signal.title || signal.id || "Signal")}</strong>
    <p>${esc(signal.id || "")}</p>
  </article>`;
}

function intelligenceDecisionForm(mission) {
  return `<article class="action-item sales-list-card">
    <span>Decision</span>
    <strong>Mission 판단 기록</strong>
    <p>${esc(mission.brandName || mission.brandId)} · ${esc(mission.sourceActionId || "")}</p>
    <textarea id="intelligenceDecisionText" rows="3" placeholder="Decision 내용"></textarea>
    <textarea id="intelligenceDecisionReason" rows="3" placeholder="이유"></textarea>
    <select id="intelligenceDecisionStatus">
      <option value="planned">planned</option>
      <option value="in_progress">in_progress</option>
      <option value="completed">completed</option>
      <option value="cancelled">cancelled</option>
    </select>
    <button class="today-jump-button" type="button" data-intelligence-decision-save>Decision 저장</button>
    <div id="intelligenceDecisionFeedback" class="hint-text"></div>
  </article>`;
}

async function saveIntelligenceDecision() {
  if (intelligenceSubmitInFlight || !selectedIntelligenceMission?.brandId) return;
  const decision = $("#intelligenceDecisionText")?.value?.trim() || "";
  const reason = $("#intelligenceDecisionReason")?.value?.trim() || "";
  const status = $("#intelligenceDecisionStatus")?.value || "planned";
  const feedback = $("#intelligenceDecisionFeedback");
  if (!decision || !reason) {
    if (feedback) feedback.textContent = "Decision 내용과 이유를 입력해주세요.";
    return;
  }
  intelligenceSubmitInFlight = true;
  const button = $("[data-intelligence-decision-save]");
  if (button) button.disabled = true;
  const result = await postJson(intelligenceUrl("/api/intelligence/decisions"), {
    brandId: selectedIntelligenceMission.brandId,
    missionId: selectedIntelligenceMission.id,
    sourceActionId: selectedIntelligenceMission.sourceActionId,
    decision,
    reason,
    status
  }, 15000);
  intelligenceSubmitInFlight = false;
  if (button) button.disabled = false;
  if (result.error || !result.ok) {
    if (feedback) feedback.textContent = `저장 실패: ${result.message || result.error || "응답 확인 필요"}`;
    return;
  }
  if (feedback) feedback.textContent = `저장 완료: ${result.decision?.status || status}`;
  renderIntelligenceDecisions();
  renderIntelligenceTimeline();
}

async function renderIntelligenceDecisions() {
  const target = $("#intelligenceDecisions");
  if (!target) return;
  const renderSeq = ++intelligenceDecisionsRenderSeq;
  target.innerHTML = `<article class="action-item"><strong>Decision 확인 중</strong><p>Decision History를 불러오고 있습니다.</p></article>`;
  const [result, registry] = await Promise.all([
    getJson(intelligenceUrl("/api/intelligence/decisions?limit=20"), 15000),
    readIntelligenceBrands()
  ]);
  if (renderSeq !== intelligenceDecisionsRenderSeq) return;
  if (result.error || !result.ok) {
    target.innerHTML = `<article class="action-item"><strong>Decision 확인 불가</strong><p>Intelligence Service 응답을 확인할 수 없습니다.</p></article>`;
    return;
  }
  const decisions = Array.isArray(result.decisions) ? result.decisions : [];
  target.innerHTML = decisions.length ? decisions.map((decision) => intelligenceDecisionRow(decision, registry.brands || [])).join("") : `<article class="action-item"><strong>Decision 없음</strong><p>Mission에서 Decision을 저장하면 이곳에 표시됩니다.</p></article>`;
}

function intelligenceDecisionRow(decision = {}, brands = []) {
  const resultText = decision.result ? JSON.stringify(decision.result) : "결과 없음";
  return `<article class="action-item sales-list-card" data-decision-id="${esc(decision.id || "")}">
    <span>${esc(intelligenceBrandLabel(decision.brandId, brands))}</span>
    <strong>${esc(decision.decision || "Decision")}</strong>
    <p>${esc(decision.reason || "")}</p>
    <small>${esc(decision.status || "-")} · ${esc(intelligenceTimeLabel(decision.updatedAt))}</small>
    <p class="hint-text">${esc(resultText)}</p>
    <select data-decision-status="${esc(decision.id || "")}">
      ${["planned", "in_progress", "completed", "cancelled"].map((status) => `<option value="${status}" ${decision.status === status ? "selected" : ""}>${status}</option>`).join("")}
    </select>
    <textarea rows="2" data-decision-result="${esc(decision.id || "")}" placeholder="result JSON 또는 텍스트"></textarea>
    <button class="today-jump-button" type="button" data-decision-update="${esc(decision.id || "")}">상태 / 결과 저장</button>
    ${decision.status === "completed" && decision.result ? `<button class="today-jump-button" type="button" data-learning-create="${esc(decision.id || "")}">Learning Case로 등록</button>` : ""}
  </article>`;
}

async function updateIntelligenceDecision(id) {
  if (intelligenceSubmitInFlight || !id) return;
  const status = $(`[data-decision-status="${CSS.escape(id)}"]`)?.value;
  const resultValue = $(`[data-decision-result="${CSS.escape(id)}"]`)?.value?.trim() || "";
  const payload = { status };
  if (resultValue) payload.result = parseDecisionResultInput(resultValue);
  intelligenceSubmitInFlight = true;
  const result = await patchJson(intelligenceUrl(`/api/intelligence/decisions/${encodeURIComponent(id)}`), payload, 15000);
  intelligenceSubmitInFlight = false;
  if (result.error || !result.ok) {
    toast(`Decision 저장 실패: ${result.message || result.error || "응답 확인 필요"}`);
    return;
  }
  toast("Decision을 저장했습니다.");
  renderIntelligenceDecisions();
  renderIntelligenceTimeline();
}

function parseDecisionResultInput(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { summary: value };
  }
}

async function renderIntelligenceTimeline() {
  const target = $("#intelligenceTimeline");
  if (!target) return;
  const renderSeq = ++intelligenceTimelineRenderSeq;
  target.classList.add("is-loading");
  if (!target.innerHTML.trim()) target.innerHTML = intelligenceTimelineSkeletonHtml();
  const registry = await readIntelligenceBrands();
  renderIntelligenceTimelineFilter(registry.brands || []);
  const brandId = $("#intelligenceTimelineBrandFilter")?.value || "";
  const query = brandId ? `?brandId=${encodeURIComponent(brandId)}&limit=30` : "?limit=30";
  const [result, missionsResult, salesMap] = await Promise.all([
    getJson(intelligenceUrl(`/api/intelligence/timeline${query}`), 15000),
    brandId ? Promise.resolve({ missions: [] }) : getJson(intelligenceUrl("/api/intelligence/missions?limit=5"), 40000),
    readIntelligenceTimelineSalesMap()
  ]);
  if (renderSeq !== intelligenceTimelineRenderSeq) return;
  if (result.error || !result.ok) {
    target.classList.remove("is-loading");
    target.innerHTML = `<article class="action-item"><strong>Timeline 확인 불가</strong><p>Intelligence Service 응답을 확인할 수 없습니다.</p></article>`;
    return;
  }
  const events = Array.isArray(result.events) ? result.events : [];
  const missions = Array.isArray(missionsResult.missions) ? missionsResult.missions : [];
  const fallbackBrandIds = brandId ? [] : intelligenceTimelineFallbackBrandIds(events, missions, registry.brands || [], salesMap);
  const detailMap = await readIntelligenceTimelineDetails(events, brandId, missions, fallbackBrandIds);
  if (renderSeq !== intelligenceTimelineRenderSeq) return;
  renderIntelligenceTimelineFilter(registry.brands || []);
  const sortedEvents = [...events].sort((a, b) => {
    const left = new Date(a.occurredAt).getTime() || 0;
    const right = new Date(b.occurredAt).getTime() || 0;
    return brandId ? left - right : right - left;
  });
  const rows = intelligenceTimelineDisplayRows(sortedEvents, missions, registry.brands || [], detailMap, brandId, fallbackBrandIds, salesMap);
  target.classList.remove("is-loading");
  target.innerHTML = rows.length
    ? intelligenceTimelineContent(rows, registry.brands || [], brandId)
    : intelligenceTimelineEmptyState(brandId);
}

function renderIntelligenceTimelineFilter(brands = []) {
  const select = $("#intelligenceTimelineBrandFilter");
  if (!select) return;
  const currentValue = select.value || "";
  const deduped = [];
  const seen = new Set();
  for (const brand of brands) {
    if (!brand?.id || seen.has(brand.id)) continue;
    seen.add(brand.id);
    deduped.push(brand);
  }
  select.innerHTML = `<option value="">브랜드 전체</option>${deduped.map((brand) => `<option value="${esc(brand.id)}">${esc(intelligenceTimelineBrandDisplay(brand))}</option>`).join("")}`;
  select.value = seen.has(currentValue) ? currentValue : "";
}

function intelligenceTimelineBrandDisplay(brand = {}) {
  return intelligenceTimelineBrandNameCache.get(brand.id) || intelligenceBrandName(brand);
}

async function readIntelligenceTimelineSalesMap() {
  const today = new Date();
  const dateKey = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
  const until = dateKey(today);
  const since = `${until.slice(0, 7)}-01`;
  const result = await getJson(`/api/diagnostics/brand-sales?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`, 20000);
  const rows = Array.isArray(result.brandSales) ? result.brandSales : [];
  return new Map(rows.map((row) => [row.brand_code, row]).filter(([code]) => code));
}

function intelligenceTimelineFallbackBrandIds(events = [], missions = [], brands = [], salesMap = new Map()) {
  const ids = [...events.map((event) => event.brandId)].filter(Boolean);
  for (const id of salesMap.keys()) {
    if (ids.length >= 5) break;
    ids.push(id);
  }
  for (const id of missions.map((mission) => mission?.brand?.id).filter(Boolean)) {
    if (ids.length >= 5) break;
    ids.push(id);
  }
  for (const brand of brands) {
    if (ids.length >= 5) break;
    if (brand?.active !== false && brand?.id) ids.push(brand.id);
  }
  return [...new Set(ids)].slice(0, 5);
}

async function readIntelligenceTimelineDetails(events = [], selectedBrandId = "", missions = [], fallbackBrandIds = []) {
  const missionBrandIds = missions.map((mission) => mission?.brand?.id).filter(Boolean);
  const brandIds = [...new Set([selectedBrandId, ...events.map((event) => event.brandId), ...missionBrandIds, ...fallbackBrandIds].filter(Boolean))].slice(0, 12);
  const pairs = await Promise.all(brandIds.map(async (brandId) => {
    const record = await fetchIntelligenceBrandOverviewRecord(brandId);
    const displayName = intelligenceBrandDisplayName({ id: brandId }, record);
    if (displayName) intelligenceTimelineBrandNameCache.set(brandId, displayName);
    return [brandId, record];
  }));
  return new Map(pairs);
}

function intelligenceTimelineContent(rows = [], brands = [], selectedBrandId = "") {
  const selectedDisplayName = intelligenceTimelineHeaderName(rows, selectedBrandId, brands);
  const header = selectedBrandId
    ? `<div class="intelligence-timeline-head"><span>Brand Timeline</span><strong>${esc(selectedDisplayName)}</strong><p>최근 이벤트 ${apiNum(rows.length)}건</p></div>`
    : `<div class="intelligence-timeline-head"><span>Brand Timeline</span><strong>브랜드 전체</strong><p>최근 주요 이벤트 ${apiNum(rows.length)}건</p></div>`;
  return `${header}<div class="intelligence-timeline-list">${rows.map((row) => intelligenceTimelineRow(row)).join("")}</div>`;
}

function intelligenceTimelineHeaderName(rows = [], selectedBrandId = "", brands = []) {
  const rowName = rows.find((row) => row.brandId === selectedBrandId && /[A-Za-z]/.test(row.brandName || ""))?.brandName
    || rows.find((row) => row.brandId === selectedBrandId)?.brandName;
  return rowName || intelligenceTimelineBrandDisplay({ id: selectedBrandId, name: intelligenceBrandLabel(selectedBrandId, brands) });
}

function intelligenceTimelineEmptyState(brandId = "") {
  return `<article class="intelligence-empty-card"><strong>${brandId ? "이 브랜드에 기록된 이벤트가 없습니다." : "아직 기록된 Intelligence 이벤트가 없습니다."}</strong><p>Decision이나 Learning 이력이 생기면 Timeline에 표시됩니다.</p></article>`;
}

function intelligenceTimelineSkeletonHtml() {
  return `<div class="intelligence-timeline-list">${Array.from({ length: 3 }, () => `<article class="intelligence-timeline-item intelligence-skeleton-card"><div class="intelligence-timeline-dot"></div><div class="intelligence-timeline-card"><strong></strong><p></p></div></article>`).join("")}</div>`;
}

function intelligenceTimelineDisplayRows(events = [], missions = [], brands = [], detailMap = new Map(), selectedBrandId = "", fallbackBrandIds = [], salesMap = new Map()) {
  const eventRows = events.map((event) => intelligenceTimelineRowFromEvent(event, brands, detailMap.get(event.brandId), salesMap.get(event.brandId)));
  const brandRows = selectedBrandId
    ? intelligenceTimelineRowsFromBrand(selectedBrandId, detailMap.get(selectedBrandId), null, brands, salesMap.get(selectedBrandId))
    : [
      ...missions.flatMap((mission) => intelligenceTimelineRowsFromBrand(mission?.brand?.id, detailMap.get(mission?.brand?.id), mission, brands, salesMap.get(mission?.brand?.id))),
      ...fallbackBrandIds.flatMap((id) => intelligenceTimelineRowsFromBrand(id, detailMap.get(id), null, brands, salesMap.get(id)))
    ];
  const rows = [...eventRows, ...brandRows].filter(Boolean);
  const seen = new Set();
  const deduped = rows.filter((row) => {
    const key = `${row.brandId}|${row.type}|${row.summary}|${row.action || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.sort((a, b) => {
    const left = new Date(a.occurredAt).getTime() || 0;
    const right = new Date(b.occurredAt).getTime() || 0;
    return selectedBrandId ? left - right : right - left;
  });
}

function intelligenceTimelineRowFromEvent(event = {}, brands = [], detailRecord = {}, salesRecord = null) {
  const detail = intelligenceOverviewDetail(detailRecord || {});
  const input = intelligenceOverviewInput(detailRecord || {});
  const displayName = intelligenceTimelineSalesBrandName(salesRecord) || intelligenceBrandDisplayName({ id: event.brandId, name: intelligenceBrandLabel(event.brandId, brands) }, detailRecord || {});
  return {
    brandId: event.brandId || "",
    brandName: displayName,
    occurredAt: event.occurredAt,
    type: event.type,
    summary: intelligenceTimelineSummary(event, detail, input),
    metrics: intelligenceTimelineMetrics(detail, input, salesRecord),
    action: intelligenceTimelineAction(event, detail),
    sourceText: intelligenceTimelineSourceText(detail?.sources || {}),
    rawText: intelligenceTimelineRawText(event)
  };
}

function intelligenceTimelineRowsFromBrand(brandId = "", detailRecord = {}, mission = null, brands = [], salesRecord = null) {
  if (!brandId || !detailRecord) return [];
  const detail = intelligenceOverviewDetail(detailRecord);
  const input = intelligenceOverviewInput(detailRecord);
  const displayName = intelligenceTimelineSalesBrandName(salesRecord) || intelligenceBrandDisplayName({ id: brandId, name: intelligenceBrandLabel(brandId, brands) }, detailRecord);
  if (displayName) intelligenceTimelineBrandNameCache.set(brandId, displayName);
  const occurredAt = detail?.meta?.generatedAt || input?.meta?.generatedAt || mission?.generatedAt || new Date().toISOString();
  const rows = [];
  const metrics = intelligenceTimelineMetrics(detail, input, salesRecord);
  if (metrics.length) {
    rows.push({
      brandId,
      brandName: displayName,
      occurredAt,
      type: "commerce_sales_present",
      summary: "선택 기간 판매가 확인되었습니다.",
      metrics,
      action: intelligenceTimelineAction(mission || {}, detail),
      sourceText: intelligenceTimelineSourceText(detail?.sources || {}),
      rawText: intelligenceTimelineBrandRawText(detail, input)
    });
  }
  const signals = new Set(Array.isArray(detail?.signals) ? detail.signals.map((signal) => signal.id) : []);
  const sources = detail?.sources || {};
  if (signals.has("search_snapshot_missing") || signals.has("sales_without_search_snapshot") || sources.search?.status === "unmatched") {
    rows.push({
      brandId,
      brandName: displayName,
      occurredAt,
      type: signals.has("sales_without_search_snapshot") ? "sales_without_search_snapshot" : "search_snapshot_missing",
      summary: signals.has("sales_without_search_snapshot") ? "판매는 확인됐지만 Naver 검색 Snapshot이 없습니다." : "Naver 검색 Snapshot이 없습니다.",
      metrics: [],
      action: "Naver 검색 Snapshot 수집",
      sourceText: intelligenceTimelineSourceText({ search: sources.search }),
      rawText: intelligenceTimelineBrandRawText(detail, input)
    });
  }
  if (sources.marketing?.status === "unmatched") {
    rows.push({
      brandId,
      brandName: displayName,
      occurredAt,
      type: "unmatched",
      summary: "Meta 데이터가 연결되지 않았습니다.",
      metrics: [],
      action: "광고 캠페인 상태 확인",
      sourceText: intelligenceTimelineSourceText({ marketing: sources.marketing }),
      rawText: intelligenceTimelineBrandRawText(detail, input)
    });
  }
  if (sources.content?.status === "unmatched") {
    rows.push({
      brandId,
      brandName: displayName,
      occurredAt,
      type: "unmatched",
      summary: "Instagram 데이터가 연결되지 않았습니다.",
      metrics: [],
      action: "콘텐츠 업로드 상태 검토",
      sourceText: intelligenceTimelineSourceText({ content: sources.content }),
      rawText: intelligenceTimelineBrandRawText(detail, input)
    });
  }
  return rows;
}

function intelligenceTimelineRow(row = {}) {
  const when = intelligenceTimelineDateLabel(row.occurredAt);
  const typeLabel = intelligenceTimelineTypeLabel(row.type);
  const metrics = Array.isArray(row.metrics) ? row.metrics : [];
  const action = row.action || "";
  const sourceText = row.sourceText || "";
  return `<article class="intelligence-timeline-item">
    <div class="intelligence-timeline-dot" aria-hidden="true"></div>
    <div class="intelligence-timeline-card">
      <div class="intelligence-timeline-meta"><span>${esc(when)}</span><small>${esc(row.brandName || row.brandId || "브랜드")}</small></div>
      <strong class="intelligence-timeline-type">${esc(typeLabel)}</strong>
      <p class="intelligence-timeline-summary">${esc(row.summary || "Intelligence 이벤트가 기록되었습니다.")}</p>
      ${metrics.length ? `<div class="intelligence-timeline-metrics">${metrics.map((item) => `<div><em>${esc(item.label)}</em><b>${esc(item.value)}</b></div>`).join("")}</div>` : ""}
      ${action ? `<div class="intelligence-timeline-action"><em>지금 할 일</em><b>${esc(action)}</b></div>` : ""}
      ${sourceText ? `<p class="intelligence-timeline-source">${esc(sourceText)}</p>` : ""}
      <details class="intelligence-timeline-raw"><summary>원본 정보 보기</summary><p>${esc(row.rawText || "")}</p></details>
    </div>
  </article>`;
}

function intelligenceTimelineTypeLabel(type = "") {
  return {
    decision_recorded: "운영 결정 기록",
    action_started: "Action 시작",
    result_recorded: "Result 기록",
    commerce_sales_present: "판매 확인",
    commerce_orders_present: "주문 확인",
    commerce_quantity_present: "판매수량 확인",
    search_snapshot_missing: "검색 Snapshot 없음",
    sales_without_search_snapshot: "판매는 있으나 검색 Snapshot 없음",
    source_unavailable: "데이터 연결 확인 필요",
    matched: "데이터 연결됨",
    unmatched: "데이터 없음"
  }[type] || type || "이벤트";
}

function intelligenceTimelineDateLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function intelligenceTimelineSummary(event = {}, detail = {}, input = {}) {
  if (event.type === "decision_recorded") return event.description || "운영 결정이 기록되었습니다.";
  const ids = new Set([...(Array.isArray(detail.signals) ? detail.signals.map((signal) => signal.id) : [])]);
  if (ids.has("sales_without_search_snapshot")) return "판매는 확인됐지만 Naver 검색 Snapshot이 없습니다.";
  if (ids.has("search_snapshot_missing")) return "Naver 검색 Snapshot이 없습니다.";
  if (Number.isFinite(Number(input?.commerce?.data?.salesAmount ?? input?.commerce?.data?.paidAmount))) return "선택 기간 판매가 확인되었습니다.";
  return event.description || event.title || "Intelligence 이벤트가 기록되었습니다.";
}

function intelligenceTimelineSalesBrandName(row = null) {
  return String(row?.brand_name || "").trim();
}

function intelligenceTimelineMetrics(detail = {}, input = {}, salesRecord = null) {
  const commerce = input?.commerce?.data || {};
  const metrics = [];
  if (Number.isFinite(Number(commerce.salesAmount ?? commerce.paidAmount))) metrics.push({ label: "최근 판매", value: apiWon(commerce.salesAmount ?? commerce.paidAmount) });
  if (Number.isFinite(Number(commerce.orderCount))) metrics.push({ label: "주문", value: `${apiNum(commerce.orderCount)}건` });
  if (Number.isFinite(Number(commerce.quantitySold))) metrics.push({ label: "판매수량", value: `${apiNum(commerce.quantitySold)}개` });
  if (!metrics.length && salesRecord) {
    if (Number.isFinite(Number(salesRecord.salesAmount))) metrics.push({ label: "최근 판매", value: apiWon(salesRecord.salesAmount) });
    if (Number.isFinite(Number(salesRecord.orderCount))) metrics.push({ label: "주문", value: `${apiNum(salesRecord.orderCount)}건` });
    if (Number.isFinite(Number(salesRecord.quantitySold))) metrics.push({ label: "판매수량", value: `${apiNum(salesRecord.quantitySold)}개` });
  }
  if (!metrics.length && Array.isArray(detail.signals)) {
    for (const signal of detail.signals) {
      const evidence = signal.evidence || {};
      if (metrics.length < 3 && Number.isFinite(Number(evidence.salesAmount))) metrics.push({ label: "최근 판매", value: apiWon(evidence.salesAmount) });
      if (metrics.length < 3 && Number.isFinite(Number(evidence.orderCount))) metrics.push({ label: "주문", value: `${apiNum(evidence.orderCount)}건` });
      if (metrics.length < 3 && Number.isFinite(Number(evidence.quantitySold))) metrics.push({ label: "판매수량", value: `${apiNum(evidence.quantitySold)}개` });
    }
  }
  return metrics.slice(0, 3);
}

function intelligenceTimelineAction(event = {}, detail = {}) {
  const action = Array.isArray(detail.actions) ? detail.actions[0] : null;
  if (action) return intelligenceActionHumanLabel(action);
  const related = Array.isArray(event.relatedIds) ? event.relatedIds.join(" ") : "";
  if (/search|snapshot|collect/i.test(related)) return "Naver 검색 Snapshot 수집";
  if (/campaign|meta|ad/i.test(related)) return "광고 캠페인 상태 확인";
  return "";
}

function intelligenceTimelineSourceText(sources = {}) {
  const entries = Object.entries(sources || {});
  if (!entries.length) return "";
  return entries.map(([key, source]) => `${key}: ${intelligenceSourceHumanStatus(key, source)}`).join(" · ");
}

function intelligenceTimelineRawText(event = {}) {
  const related = Array.isArray(event.relatedIds) && event.relatedIds.length ? ` · related: ${event.relatedIds.join(", ")}` : "";
  return `${event.type || "event"} · ${event.id || "id 없음"}${related}`;
}

function intelligenceTimelineBrandRawText(detail = {}, input = {}) {
  const signalIds = Array.isArray(detail?.signals) ? detail.signals.map((signal) => signal.id).join(", ") : "";
  const actionIds = Array.isArray(detail?.actions) ? detail.actions.map((action) => action.id).join(", ") : "";
  return `brand: ${detail?.brand?.id || input?.brand?.id || "unknown"} · signals: ${signalIds || "none"} · actions: ${actionIds || "none"}`;
}

async function renderIntelligenceLearning() {
  const target = $("#intelligenceLearning");
  if (!target) return;
  const renderSeq = ++intelligenceLearningRenderSeq;
  target.innerHTML = `<article class="action-item"><strong>Learning Case 확인 중</strong><p>Learning DB를 불러오고 있습니다.</p></article>`;
  const [result, registry] = await Promise.all([
    getJson(intelligenceUrl("/api/intelligence/learning?limit=20"), 15000),
    readIntelligenceBrands()
  ]);
  if (renderSeq !== intelligenceLearningRenderSeq) return;
  if (result.error || !result.ok) {
    target.innerHTML = `<article class="action-item"><strong>Learning 확인 불가</strong><p>Intelligence Service 응답을 확인할 수 없습니다.</p></article>`;
    return;
  }
  const cases = Array.isArray(result.cases) ? result.cases : [];
  target.innerHTML = cases.length ? cases.map((item) => intelligenceLearningRow(item, registry.brands || [])).join("") : `<article class="action-item"><strong>Learning Case 없음</strong><p>완료된 Decision을 Learning Case로 등록하면 표시됩니다.</p></article>`;
  const similar = $("#intelligenceSimilar");
  if (similar && !cases.length) similar.innerHTML = "";
}

function intelligenceLearningRow(item = {}, brands = []) {
  return `<article class="action-item sales-list-card"
    data-learning-brand-id="${esc(item.brandId || "")}"
    data-learning-source-action-id="${esc(item.sourceActionId || "")}"
    data-learning-signal-ids="${esc((item.signalIds || []).join(","))}">
    <span>${esc(intelligenceBrandLabel(item.brandId, brands))}</span>
    <strong>${esc(item.decision || "Learning Case")}</strong>
    <p>${esc(item.reason || "")}</p>
    <p class="hint-text">${esc(item.result ? JSON.stringify(item.result) : "result 없음")}</p>
    <small>${esc(item.sourceActionId || "-")} · ${esc(intelligenceTimeLabel(item.completedAt))}</small>
    <button class="today-jump-button" type="button" data-learning-similar>유사 사례 보기</button>
  </article>`;
}

async function createLearningCase(decisionId) {
  if (intelligenceSubmitInFlight || !decisionId) return;
  intelligenceSubmitInFlight = true;
  const result = await postJson(intelligenceUrl("/api/intelligence/learning"), { decisionId }, 15000);
  intelligenceSubmitInFlight = false;
  if (result.error || !result.ok) {
    toast(`Learning 등록 실패: ${result.message || result.error || "응답 확인 필요"}`);
    return;
  }
  toast(result.duplicate ? "이미 등록된 Learning Case입니다." : "Learning Case를 등록했습니다.");
  setIntelligencePanel("learning");
}

async function renderSimilarLearningFromCase(node) {
  const target = $("#intelligenceSimilar");
  if (!target || !node) return;
  target.innerHTML = `<article class="action-item"><strong>유사 사례 확인 중</strong><p>matchedBy 기준으로 조회합니다.</p></article>`;
  const params = new URLSearchParams();
  if (node.dataset.learningBrandId) params.set("brandId", node.dataset.learningBrandId);
  if (node.dataset.learningSourceActionId) params.set("sourceActionId", node.dataset.learningSourceActionId);
  if (node.dataset.learningSignalIds) params.set("signalIds", node.dataset.learningSignalIds);
  params.set("limit", "5");
  const [result, registry] = await Promise.all([
    getJson(intelligenceUrl(`/api/intelligence/learning/similar?${params.toString()}`), 15000),
    readIntelligenceBrands()
  ]);
  if (result.error || !result.ok) {
    target.innerHTML = `<article class="action-item"><strong>유사 사례 확인 불가</strong><p>Intelligence Service 응답을 확인할 수 없습니다.</p></article>`;
    return;
  }
  const cases = Array.isArray(result.cases) ? result.cases : [];
  target.innerHTML = `<div class="section-title compact"><div><p class="eyebrow">Similar</p><h3>matchedBy 기준 유사 사례</h3></div></div>${cases.length ? cases.map((item) => intelligenceSimilarRow(item, registry.brands || [])).join("") : `<article class="action-item"><strong>유사 사례 없음</strong><p>같은 기준으로 매칭된 Learning Case가 없습니다.</p></article>`}`;
}

function intelligenceSimilarRow(item = {}, brands = []) {
  return `<article class="action-item sales-list-card">
    <span>${esc(intelligenceBrandLabel(item.brandId, brands))}</span>
    <strong>${esc(item.decision || "Learning Case")}</strong>
    <p>${esc((item.matchedBy || []).join(", ") || "matchedBy 없음")}</p>
    <small>${esc(item.sourceActionId || "-")}</small>
  </article>`;
}

// options.forceRefresh (2026-07-08 Instagram 자동 동기화 기능 추가): "지금 동기화"
// 버튼은 캐시를 다시 읽는 것만으로는 새 게시물을 반영할 수 없었다 — 서버의
// buildInstagramMonthlyDataWithCache()는 기본적으로 캐시 우선이라 이 함수가
// refresh=1을 보내지 않으면 항상 같은 on-disk 캐시만 돌려줬다. forceRefresh가 true면
// 실제 API를 다시 호출해야 하는 이번 달(months[0])에 한해 refresh=1을 붙인다.
// 지난 달들은 서버가 어차피 CSV/저장 캐시 전용으로 처리하므로 붙이지 않는다.
async function loadMonths(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  monthlyData = [];
  for (const month of months) {
    const refreshQuery = forceRefresh && month === months[0] ? "&refresh=1" : "";
    const data = await getJson(`/api/instagram/monthly?month=${month}${refreshQuery}`, 20000);
    monthlyData.push(data.error ? errorMonth(month, data.error) : data);
  }
  monthlyData.sort((a, b) => b.month.localeCompare(a.month));
  monthlyData = uniqueMonthlyDataRows();
  renderMonthSelect();
  renderAll();
}

async function refreshInstagramMonthlyData() {
  toast("Instagram 최신 게시물을 다시 확인합니다.");
  await loadMonths({ forceRefresh: true });
  await renderStoryInsights();
  toast("Instagram 최신 게시물을 다시 확인했습니다.");
}

function bind() {
  $("#instagramRefreshBtn")?.addEventListener("click", refreshInstagramMonthlyData);
  $("#refreshStoriesBtn")?.addEventListener("click", renderStoryInsights);
  // 같은 탭에서 이동한다 — Cafe24 로그인/동의 후 서버가 "/"로 리다이렉트하므로 그대로
  // 이 탭으로 돌아온다. (2026-07-08 Cafe24 재인증 흐름 개선)
  $("#syncFixBtn")?.addEventListener("click", () => {
    window.location.href = "/api/cafe24/oauth/start";
  });
  $("#healthRefreshBtn")?.addEventListener("click", refreshApiHealthCenter);
  $("#operationsRange")?.addEventListener("change", (event) => {
    operationsRange = event.target.value || "month";
    const isCustom = operationsRange === "custom";
    $("#operationsCustomRange")?.toggleAttribute("hidden", !isCustom);
    const renderSeq = renderOperationsSections();
    renderOverviewLiveData(selectedMonth(), renderSeq);
  });
  $("#operationsSince")?.addEventListener("change", (event) => {
    const nextSince = event.target.value || "";
    const validSince = /^\d{4}-\d{2}-\d{2}$/.test(nextSince) && event.target.validity?.valid !== false;
    if (operationsRange === "custom" && !validSince) {
      event.target.value = operationsRangeCustomSince;
      toast("날짜를 확인해주세요.");
      return;
    }
    if (operationsRange === "custom" && operationsRangeCustomUntil && nextSince > operationsRangeCustomUntil) {
      event.target.value = operationsRangeCustomSince;
      toast("시작일이 종료일보다 늦을 수 없습니다.");
      return;
    }
    operationsRangeCustomSince = nextSince;
    if (operationsRange === "custom" && operationsRangeCustomSince && operationsRangeCustomUntil && operationsRangeCustomSince <= operationsRangeCustomUntil) {
      const renderSeq = renderOperationsSections();
      renderOverviewLiveData(selectedMonth(), renderSeq);
    }
  });
  $("#operationsUntil")?.addEventListener("change", (event) => {
    const nextUntil = event.target.value || "";
    const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(nextUntil) && event.target.validity?.valid !== false;
    if (operationsRange === "custom" && !validUntil) {
      event.target.value = operationsRangeCustomUntil;
      toast("날짜를 확인해주세요.");
      return;
    }
    if (operationsRange === "custom" && operationsRangeCustomSince && operationsRangeCustomSince > nextUntil) {
      event.target.value = operationsRangeCustomUntil;
      toast("시작일이 종료일보다 늦을 수 없습니다.");
      return;
    }
    operationsRangeCustomUntil = nextUntil;
    if (operationsRange === "custom" && operationsRangeCustomSince && operationsRangeCustomUntil && operationsRangeCustomSince <= operationsRangeCustomUntil) {
      const renderSeq = renderOperationsSections();
      renderOverviewLiveData(selectedMonth(), renderSeq);
    }
  });
  $("#todayBriefReset")?.addEventListener("click", () => {
    localStorage.removeItem(todayStorageKey());
    renderTodayBriefing();
    toast("오늘 업무 상태를 초기화했습니다.");
  });
  document.addEventListener("click", (event) => {
    const calendarButton = event.target.closest("[data-sales-calendar-nav]");
    if (!calendarButton) return;
    const offset = Number(calendarButton.dataset.salesCalendarNav || 0);
    if (!Number.isFinite(offset) || offset === 0) return;
    renderTodaySalesCalendar(shiftTodaySalesCalendarMonth(todaySalesCalendarMonth, offset));
  });
  document.addEventListener("change", (event) => {
    const calendarMonth = event.target.closest("[data-sales-calendar-month]");
    if (!calendarMonth) return;
    renderTodaySalesCalendar(calendarMonth.value);
  });
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest("#todaySalesCalendar [data-sales-calendar-tooltip]");
    if (!target) return;
    showTodaySalesCalendarTooltip(target, event);
  });
  document.addEventListener("pointermove", (event) => {
    const target = event.target.closest("#todaySalesCalendar [data-sales-calendar-tooltip]");
    const tooltip = $("#todaySalesCalendarTooltip");
    if (target && tooltip && !tooltip.hidden) positionTodaySalesCalendarTooltip(target, tooltip);
  });
  document.addEventListener("pointerout", (event) => {
    const target = event.target.closest("#todaySalesCalendar [data-sales-calendar-tooltip]");
    if (!target || target.contains(event.relatedTarget)) return;
    hideTodaySalesCalendarTooltip();
  });
  document.addEventListener("focusin", (event) => {
    const target = event.target.closest("#todaySalesCalendar [data-sales-calendar-tooltip]");
    if (target) showTodaySalesCalendarTooltip(target);
  });
  document.addEventListener("focusout", (event) => {
    const target = event.target.closest("#todaySalesCalendar [data-sales-calendar-tooltip]");
    if (!target || target.contains(event.relatedTarget)) return;
    hideTodaySalesCalendarTooltip();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideTodaySalesCalendarTooltip();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-brief-status]");
    if (!button) return;
    const id = button.dataset.briefStatus;
    const state = readTodayBriefingState();
    const current = state[id]?.status || "todo";
    const next = nextTodayStatus(current);
    state[id] = {
      status: next,
      doneAt: next === "done" ? new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""
    };
    writeTodayBriefingState(state);
    renderTodayBriefing();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-brand-timeline-filter]");
    if (!button) return;
    const section = button.closest("[data-brand-timeline]");
    const category = button.dataset.brandTimelineFilter || "all";
    section?.querySelectorAll("[data-brand-timeline-filter]").forEach((node) => node.classList.toggle("active", node === button));
    let visibleCount = 0;
    section?.querySelectorAll("[data-brand-timeline-event]").forEach((node) => {
      const visible = category === "all" || node.dataset.brandTimelineEvent === category;
      node.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    const empty = section?.querySelector("[data-brand-timeline-empty]");
    if (empty) {
      empty.hidden = visibleCount > 0;
      const message = category === "all" ? "표시할 실제 브랜드 이벤트가 없습니다." : "이 카테고리에 표시할 실제 이벤트가 없습니다.";
      const title = empty.querySelector("strong");
      if (title) title.textContent = message;
    }
  });
  document.addEventListener("pointerover", (event) => {
    const bar = event.target.closest(".annual-flow-bar");
    if (!bar) return;
    const flow = bar.closest("#annualArchiveFlow");
    const tooltip = flow?.querySelector(".annual-flow-tooltip");
    if (!tooltip) return;
    tooltip.textContent = bar.dataset.tooltip || bar.title || "";
    tooltip.hidden = false;
    tooltip.classList.add("is-visible");
    positionAnnualFlowTooltip(event, tooltip);
  });
  document.addEventListener("pointermove", (event) => {
    const bar = event.target.closest(".annual-flow-bar");
    if (!bar) return;
    const tooltip = bar.closest("#annualArchiveFlow")?.querySelector(".annual-flow-tooltip");
    if (tooltip && !tooltip.hidden) positionAnnualFlowTooltip(event, tooltip);
  });
  document.addEventListener("pointerout", (event) => {
    const bar = event.target.closest(".annual-flow-bar");
    if (!bar || bar.contains(event.relatedTarget)) return;
    const tooltip = bar.closest("#annualArchiveFlow")?.querySelector(".annual-flow-tooltip");
    if (!tooltip) return;
    tooltip.hidden = true;
    tooltip.classList.remove("is-visible");
  });
  document.addEventListener("click", (event) => {
    const annualBar = event.target.closest("[data-annual-month]");
    if (annualBar) {
      const month = annualBar.dataset.annualMonth || "";
      setReportsMonth(month, { scrollToReport: true });
      return;
    }
    const annualFilter = event.target.closest("[data-annual-filter]");
    if (annualFilter) {
      const flow = annualFilter.closest("#annualArchiveFlow");
      if (!flow) return;
      const filter = annualFilter.dataset.annualFilter || "all";
      flow.querySelectorAll("[data-annual-filter]").forEach((button) => button.classList.toggle("active", button === annualFilter));
      flow.querySelectorAll("[data-annual-category]").forEach((item) => {
        item.classList.toggle("annual-flow-hidden", filter !== "all" && item.dataset.annualCategory !== filter);
      });
      return;
    }
    const button = event.target.closest("[data-jump-view]");
    if (!button) return;
    document.querySelector(`[data-view="${button.dataset.jumpView}"]`)?.click();
  });
  document.addEventListener("click", async (event) => {
    const toggle = event.target.closest("[data-campaign-period-toggle]");
    if (toggle) {
      if (campaignPeriodComparisonState.loading) return;
      campaignPeriodComparisonState.settingsOpen = !campaignPeriodComparisonState.settingsOpen;
      await renderCampaignPeriodComparison($("#campaignPeriodComparison"));
      return;
    }
    const modeButton = event.target.closest("[data-campaign-period-mode]");
    if (modeButton) {
      if (campaignPeriodComparisonState.loading || modeButton.disabled) return;
      campaignPeriodComparisonState.comparisonMode = modeButton.dataset.campaignPeriodMode || "month";
      await renderCampaignPeriodComparison($("#campaignPeriodComparison"));
      return;
    }
    const apply = event.target.closest("[data-campaign-period-apply]");
    if (apply) {
      if (campaignPeriodComparisonState.loading || apply.disabled) return;
      apply.disabled = true;
      if ((campaignPeriodComparisonState.comparisonMode || "month") === "month") {
        const baseMonth = $("#campaignBaseMonth")?.value || "";
        const targetMonth = $("#campaignTargetMonth")?.value || "";
        const error = campaignComparisonValidateMonthRange(baseMonth, targetMonth);
        const baseRange = campaignComparisonMonthRange(baseMonth);
        const targetRange = campaignComparisonMonthRange(targetMonth);
        if (error || !baseRange || !targetRange) {
          apply.disabled = false;
          const target = $("#campaignPeriodFormError");
          if (target) target.textContent = error || "유효한 월을 선택해주세요.";
          updateCampaignPeriodPreview();
          return;
        }
        campaignPeriodComparisonState.monthBase = baseMonth;
        campaignPeriodComparisonState.monthTarget = targetMonth;
        campaignPeriodComparisonState.manualComparisonRange = { comparisonStart: baseRange.start, comparisonEnd: baseRange.end };
        campaignPeriodComparisonState.manualRange = { executionStart: targetRange.start, executionEnd: targetRange.end };
      } else {
        const since = $("#campaignPeriodSince")?.value || "";
        const until = $("#campaignPeriodUntil")?.value || "";
        const comparisonSince = $("#campaignComparisonSince")?.value || "";
        const comparisonUntil = $("#campaignComparisonUntil")?.value || "";
        const error = campaignComparisonValidateManualRange(since, until) || campaignComparisonValidateManualRange(comparisonSince, comparisonUntil);
        if (error) {
          apply.disabled = false;
          const target = $("#campaignPeriodFormError");
          if (target) target.textContent = error;
          updateCampaignPeriodPreview();
          return;
        }
        campaignPeriodComparisonState.manualRange = { executionStart: since, executionEnd: until };
        campaignPeriodComparisonState.manualComparisonRange = { comparisonStart: comparisonSince, comparisonEnd: comparisonUntil };
      }
      await renderCampaignPeriodComparison($("#campaignPeriodComparison"));
      return;
    }
    const syncComparison = event.target.closest("[data-campaign-period-sync-comparison]");
    if (syncComparison) {
      if (campaignPeriodComparisonState.loading || syncComparison.disabled) return;
      const since = $("#campaignPeriodSince")?.value || "";
      const until = $("#campaignPeriodUntil")?.value || "";
      const error = campaignComparisonValidateManualRange(since, until);
      if (error) {
        const target = $("#campaignPeriodFormError");
        if (target) target.textContent = error;
        updateCampaignPeriodPreview();
        return;
      }
      const range = campaignComparisonRangeFromExecution(since, until);
      const comparisonSince = $("#campaignComparisonSince");
      const comparisonUntil = $("#campaignComparisonUntil");
      if (comparisonSince) comparisonSince.value = range.comparisonStart;
      if (comparisonUntil) comparisonUntil.value = range.comparisonEnd;
      updateCampaignPeriodPreview();
      return;
    }
    const reset = event.target.closest("[data-campaign-period-reset]");
    if (reset) {
      if (campaignPeriodComparisonState.loading || reset.disabled) return;
      reset.disabled = true;
      campaignPeriodComparisonState.comparisonMode = "month";
      campaignPeriodComparisonState.manualRange = null;
      campaignPeriodComparisonState.manualComparisonRange = null;
      await renderCampaignPeriodComparison($("#campaignPeriodComparison"));
    }
  });
  document.addEventListener("input", (event) => {
    if (!event.target.closest("#campaignPeriodSince, #campaignPeriodUntil, #campaignComparisonSince, #campaignComparisonUntil, #campaignBaseMonth, #campaignTargetMonth")) return;
    updateCampaignPeriodPreview();
  });
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-archive-save]");
    if (!button) return;
    const month = button.dataset.archiveSave || "";
    if (button.dataset.archiveStatus === "saved" && !window.confirm(`${month} 저장본을 최신 데이터로 다시 계산해 덮어씁니다. 계속할까요?`)) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "저장 중...";
    const result = await postJson("/api/reports/monthly/archive", { month }, 30000);
    if (result.error) {
      button.disabled = false;
      button.textContent = originalText;
      toast(`아카이브 저장 실패: ${result.error}`);
      return;
    }
    toast("아카이브를 저장했습니다.");
    renderReportsMonth(month);
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-project-key]");
    if (!button) return;
    const url = button.dataset.projectUrl || projectLinkFor(button.dataset.projectKey);
    if (!url) {
      toast("프로젝트 경로가 아직 설정되지 않았습니다. samplas.projectLinks 설정값에 연결할 수 있습니다.");
      return;
    }
    window.open(url, "_blank", "noopener");
  });
  $("#intelligenceRefreshBtn")?.addEventListener("click", refreshActiveIntelligencePanel);
  $("#intelligenceBrandSearch")?.addEventListener("input", scheduleIntelligenceBrandSearch);
  $("#intelligenceBrandSearch")?.addEventListener("keyup", scheduleIntelligenceBrandSearch);
  $("#intelligenceBrandSearch")?.addEventListener("search", scheduleIntelligenceBrandSearch);
  $("#intelligenceBrandSearch")?.addEventListener("change", scheduleIntelligenceBrandSearch);
  $("#intelligenceBrandSearch")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clearTimeout(intelligenceSearchTimer);
    renderIntelligenceBrandSearch();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-intelligence-refresh]")) return;
    refreshActiveIntelligencePanel();
  });
  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-intelligence-panel-tab]");
    if (!tab) return;
    setIntelligencePanel(tab.dataset.intelligencePanelTab || "overview");
  });
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-intelligence-brand-detail]");
    if (!trigger) return;
    const mission = readMissionDataset(trigger.closest("[data-mission-id]"));
    if (!mission?.brandId) {
      toast("Mission의 브랜드 정보를 확인할 수 없습니다.");
      return;
    }
    selectedIntelligenceMission = mission;
    setIntelligencePanel("brand");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const trigger = event.target.closest("[data-intelligence-brand-detail]");
    if (!trigger) return;
    event.preventDefault();
    trigger.click();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-intelligence-decision-save]")) return;
    saveIntelligenceDecision();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-intelligence-decisions-refresh]")) return;
    renderIntelligenceDecisions();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-intelligence-learning-refresh]")) return;
    renderIntelligenceLearning();
  });
  $("#intelligenceTimelineBrandFilter")?.addEventListener("change", renderIntelligenceTimeline);
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-decision-update]");
    if (!button) return;
    updateIntelligenceDecision(button.dataset.decisionUpdate || "");
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-learning-create]");
    if (!button) return;
    createLearningCase(button.dataset.learningCreate || "");
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-learning-similar]");
    if (!button) return;
    renderSimilarLearningFromCase(button.closest("[data-learning-brand-id]"));
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-health-action]");
    if (!button) return;
    if (button.dataset.healthAction === "refresh") {
      refreshApiHealthCenter();
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-product-action-filter]");
    if (!button) return;
    activeProductActionFilter = button.dataset.productActionFilter || "all";
    renderProductDashboard(selectedMonth());
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-product-scope-filter]");
    if (!button) return;
    activeProductScopeFilter = button.dataset.productScopeFilter || "sold";
    renderProductDashboard(selectedMonth());
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-product-stock-filter]");
    if (!button) return;
    activeProductStockFilter = button.dataset.productStockFilter || "all";
    renderProductDashboard(selectedMonth());
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-product-sort]");
    if (!button) return;
    activeProductSort = button.dataset.productSort || "salesAmount_desc";
    renderProductDashboard(selectedMonth());
  });
  $("#productBrandSalesSort")?.addEventListener("change", (event) => {
    productBrandSalesSort = event.target.value || "brand_asc";
    renderProductBrandSalesTable();
  });
  $("#productBrandSalesSearch")?.addEventListener("input", (event) => {
    productBrandSalesSearch = event.target.value || "";
    renderProductBrandSalesTable();
  });
  $("#productBrandSalesRange")?.addEventListener("change", (event) => {
    productBrandSalesRange = event.target.value || "month";
    const isCustom = productBrandSalesRange === "custom";
    $("#productBrandSalesCustomRange")?.toggleAttribute("hidden", !isCustom);
    renderProductBrandSales(selectedMonth());
  });
  $("#productBrandSalesSince")?.addEventListener("change", (event) => {
    productBrandSalesCustomSince = event.target.value || "";
    if (productBrandSalesRange === "custom") renderProductBrandSales(selectedMonth());
  });
  $("#productBrandSalesUntil")?.addEventListener("change", (event) => {
    productBrandSalesCustomUntil = event.target.value || "";
    if (productBrandSalesRange === "custom") renderProductBrandSales(selectedMonth());
  });

  $("#productSoldFilterBrand")?.addEventListener("change", (event) => {
    productSoldFilterBrand = event.target.value || "all";
    renderProductSoldProductsTable();
  });
  $("#productSoldFilterQty")?.addEventListener("change", (event) => {
    productSoldFilterQty = event.target.value || "all";
    renderProductSoldProductsTable();
  });
  $("#productSoldFilterAmount")?.addEventListener("change", (event) => {
    productSoldFilterAmount = event.target.value || "all";
    renderProductSoldProductsTable();
  });
  $("#productSoldSearch")?.addEventListener("input", (event) => {
    productSoldSearch = event.target.value || "";
    renderProductSoldProductsTable();
  });
  $("#productSoldSort")?.addEventListener("change", (event) => {
    productSoldSort = event.target.value || "amount_desc";
    renderProductSoldProductsTable();
  });
  document.addEventListener("mouseover", (event) => {
    const trigger = event.target.closest("[data-brand-order-history]");
    if (trigger) showProductBrandOrderPopover(trigger);
  });
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-brand-order-history]");
    const popover = $("#productBrandOrderPopover");
    if (trigger) {
      event.preventDefault();
      if (!popover?.hidden && activeBrandOrderPopoverCode === trigger.dataset.brandOrderHistory) closeProductBrandOrderPopover();
      else showProductBrandOrderPopover(trigger);
      return;
    }
    if (popover && !popover.hidden && !popover.contains(event.target)) closeProductBrandOrderPopover();
  });
  $$("[data-content-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeContentTab = button.dataset.contentTab || "All";
      renderContentTabs();
    });
  });
  $$("[data-ad-level]").forEach((button) => {
    button.addEventListener("click", () => {
      activeAdLevel = button.dataset.adLevel || "campaign";
      const rows = uniqueMonthlyDataRows();
      const current = rows.find((item) => item.month === $("#monthSelect")?.value) || rows[0];
      if (current) renderAdvertising(current);
    });
  });
  // Meta Product Performance · Phase 1: 상품 행 클릭 → accordion으로 상세 펼치기/접기.
  document.addEventListener("click", (event) => {
    const row = event.target.closest("[data-meta-product-toggle]");
    if (!row) return;
    toggleMetaProductPerformanceRow(row.dataset.metaProductToggle || "");
  });
  // Brand Contribution 행 클릭 → Meta Product Performance 표를 해당 브랜드로 필터링.
  document.addEventListener("click", (event) => {
    const clearBtn = event.target.closest("[data-meta-brand-filter-clear]");
    if (clearBtn) {
      clearMetaProductPerformanceBrandFilter();
      return;
    }
    const brandRow = event.target.closest("[data-meta-brand-toggle]");
    if (!brandRow) return;
    toggleMetaProductPerformanceBrandFilter(brandRow.dataset.metaBrandToggle || "");
  });
  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-product-registry-tab]");
    if (!tab) return;
    productRegistryState.activeTab = tab.dataset.productRegistryTab || "all";
    renderProductRegistryTabs(productRegistryState.items);
    renderProductRegistryList();
  });
  $("#productRegistrySearch")?.addEventListener("input", (event) => {
    productRegistryFilters.search = event.target.value || "";
    renderProductRegistryList();
  });
  $("#productRegistryBrandFilter")?.addEventListener("change", (event) => {
    productRegistryFilters.brand = event.target.value || "all";
    renderProductRegistryList();
  });
  $("#productRegistryConfidenceFilter")?.addEventListener("change", (event) => {
    productRegistryFilters.confidence = event.target.value || "all";
    renderProductRegistryList();
  });
  $("#productRegistryStatusFilter")?.addEventListener("change", (event) => {
    productRegistryFilters.status = event.target.value || "all";
    renderProductRegistryList();
  });
  $("#productRegistryDiagnosticFilter")?.addEventListener("change", (event) => {
    productRegistryFilters.diagnostic = event.target.value || "all";
    renderProductRegistryList();
  });
  $("#productRegistryCandidateFilter")?.addEventListener("change", (event) => {
    productRegistryFilters.candidateCount = event.target.value || "all";
    renderProductRegistryList();
  });
  document.addEventListener("click", (event) => {
    const card = event.target.closest("[data-product-registry-card]");
    if (!card) return;
    productRegistryState.selectedId = card.dataset.productRegistryCard || null;
    renderProductRegistryList();
  });
  document.addEventListener("keydown", (event) => {
    const card = event.target.closest("[data-product-registry-card]");
    if (!card || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    productRegistryState.selectedId = card.dataset.productRegistryCard || null;
    renderProductRegistryList();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-product-registry-readonly]");
    if (!button) return;
    event.preventDefault();
    toast("승인 기능은 Phase 2B에서 제공됩니다.");
  });
}

// server.mjs의 /api/cafe24/oauth/callback은 성공/실패 모두 "/"로 리다이렉트하며
// 결과를 쿼리스트링으로만 전달한다(토큰 값은 절대 URL에 담지 않는다 — 실패 시 reason은
// safeErrorMessage()로 이미 마스킹된 짧은 사유 문구뿐). 여기서 그 쿼리스트링을 읽어
// toast + Settings 오류 배너로 안내하고, 새로고침 시 같은 메시지가 반복 표시되지 않도록
// 주소창에서 즉시 제거한다. (2026-07-08 Cafe24 재인증 흐름 개선)
function handleCafe24OAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get("cafe24_oauth");
  if (!result) return;
  const reason = params.get("reason") || "";
  window.history.replaceState(null, "", window.location.pathname);
  if (result === "success") {
    toast("Cafe24 재인증이 완료되었습니다. 동기화 상태를 확인합니다.");
    cafe24OAuthErrorReason = null;
  } else if (result === "error") {
    toast("Cafe24 재인증에 실패했습니다. Settings에서 자세한 내용을 확인하세요.");
    cafe24OAuthErrorReason = reason || "원인을 확인할 수 없습니다.";
  }
}


function productRegistryDiagnosticTypes(item) {
  return Array.isArray(item?.diagnosticType) ? item.diagnosticType : Array.isArray(item?.entry?.matching?.diagnosticType) ? item.entry.matching.diagnosticType : [];
}

function productRegistryCandidates(item) {
  return item?.entry?.ecount?.matchedProducts || item?.recommendedCandidate?.ecount || [];
}

function productRegistryTabKind(item) {
  const types = productRegistryDiagnosticTypes(item);
  const candidates = productRegistryCandidates(item);
  if (types.includes("cafe24_only") || candidates.length === 0) return "none";
  if (types.includes("exact_one_to_many") || candidates.length >= 2) return "family";
  if (types.includes("fuzzy_high_confidence") || types.includes("fuzzy_ambiguous") || (Number(item.confidence) > 0 && Number(item.confidence) < 95)) return "similar";
  return "similar";
}

function productRegistryBadgeLabel(item) {
  const entry = item.entry || {};
  const kind = productRegistryTabKind(item);
  if (entry.verified) return "Verified";
  if (kind === "family") return "상품군 후보";
  if (kind === "similar") return "유사 후보";
  if (kind === "none") return "후보 없음";
  return entry.status || "Review";
}

function productRegistryReason(item) {
  const types = productRegistryDiagnosticTypes(item);
  if (item.reason) return item.reason;
  if (types.includes("cafe24_only")) return "ECOUNT 후보 없음";
  return (item.entry?.matching?.pendingReasons || []).join(", ") || "검토 필요";
}

function productRegistryConfidenceVisual(item) {
  const confidence = Number(item.confidence || 0);
  const noCandidate = productRegistryTabKind(item) === "none";
  if (noCandidate) return { stars: "☆☆☆☆☆", label: "후보 없음", tone: "none" };
  if (confidence >= 100) return { stars: "★★★★★", label: "100", tone: "high" };
  if (confidence >= 80) return { stars: "★★★★☆", label: "80+", tone: "medium" };
  if (confidence >= 60) return { stars: "★★★☆☆", label: "60+", tone: "low" };
  return { stars: "☆☆☆☆☆", label: "후보 없음", tone: "none" };
}

function productRegistryCandidatePreview(candidates) {
  const sizes = [...new Set(candidates.map((candidate) => candidate.size).filter(Boolean))];
  if (!sizes.length) return "";
  const visible = sizes.slice(0, 5);
  return `${visible.map((size) => `<span>${esc(size)}</span>`).join("")}${sizes.length > visible.length ? `<small>+${apiNum(sizes.length - visible.length)}</small>` : ""}`;
}

function productRegistryBuildItems(registry, reviewQueue) {
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const entryById = new Map(entries.map((entry) => [entry.canonicalProductId, entry]));
  return (reviewQueue?.items || []).map((item) => {
    const entry = entryById.get(item.canonicalProductId) || {};
    const candidate = item.recommendedCandidate || {};
    return {
      ...item,
      entry,
      brandName: candidate.brandName || entry.brandName || "-",
      productName: candidate.canonicalProductName || entry.canonicalProductName || entry.cafe24?.productName || "-",
      cafe24: candidate.cafe24 || entry.cafe24 || {},
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : Number(entry.confidence || 0)
    };
  });
}

function productRegistryTabCounts(items) {
  return {
    all: items.length,
    family: items.filter((item) => productRegistryTabKind(item) === "family").length,
    similar: items.filter((item) => productRegistryTabKind(item) === "similar").length,
    none: items.filter((item) => productRegistryTabKind(item) === "none").length
  };
}

function productRegistryMatchesFilters(item) {
  const filters = productRegistryFilters;
  const text = `${item.brandName} ${item.productName} ${item.cafe24?.productCode || ""} ${item.cafe24?.productNo || ""}`.toLowerCase();
  if (filters.search && !text.includes(filters.search.toLowerCase())) return false;
  if (filters.brand !== "all" && item.brandName !== filters.brand) return false;
  if (filters.status !== "all" && (item.entry?.status || "") !== filters.status) return false;
  if (filters.diagnostic !== "all" && !productRegistryDiagnosticTypes(item).includes(filters.diagnostic)) return false;
  const confidence = Number(item.confidence || 0);
  if (filters.confidence === "100" && confidence !== 100) return false;
  if (filters.confidence === "80-94" && (confidence < 80 || confidence > 94)) return false;
  if (filters.confidence === "60-79" && (confidence < 60 || confidence > 79)) return false;
  if (filters.confidence === "0-59" && (confidence < 0 || confidence > 59)) return false;
  const candidateCount = productRegistryCandidates(item).length;
  if (filters.candidateCount === "none" && candidateCount !== 0) return false;
  if (filters.candidateCount === "one" && candidateCount !== 1) return false;
  if (filters.candidateCount === "multi" && candidateCount < 2) return false;
  const tab = productRegistryState.activeTab || "all";
  if (tab !== "all" && productRegistryTabKind(item) !== tab) return false;
  return true;
}

function productRegistrySortItems(items) {
  const kindRank = { none: 0, similar: 1, family: 2 };
  const diagnosticRank = (item) => {
    const types = productRegistryDiagnosticTypes(item);
    if (types.includes("cafe24_only")) return 0;
    if (types.includes("fuzzy_ambiguous")) return 1;
    if (types.includes("exact_one_to_many")) return 2;
    if (types.includes("fuzzy_high_confidence")) return 3;
    return 4;
  };
  return items.slice().sort((a, b) => (
    (kindRank[productRegistryTabKind(a)] - kindRank[productRegistryTabKind(b)]) ||
    (diagnosticRank(a) - diagnosticRank(b)) ||
    (Number(b.confidence || 0) - Number(a.confidence || 0)) ||
    String(a.brandName || "").localeCompare(String(b.brandName || ""), "ko") ||
    String(a.productName || "").localeCompare(String(b.productName || ""), "ko")
  ));
}

function renderProductRegistrySummary(registry, queue) {
  const target = $("#productRegistrySummary");
  if (!target) return;
  const summary = registry?.summary || {};
  const items = productRegistryBuildItems(registry, queue);
  const counts = productRegistryTabCounts(items);
  const total = Number(summary.registryCount || 0);
  const verified = Number(summary.verifiedCount || 0);
  const review = Number(summary.reviewQueueCount || 0);
  const verifiedPct = total > 0 ? Math.floor((verified / total) * 100) : null;
  const reviewPct = verifiedPct == null ? null : Math.max(0, 100 - verifiedPct);
  target.innerHTML = [
    ["전체 상품", apiNum(total), ""],
    ["자동 완료", apiNum(verified), verifiedPct == null ? "-" : `${verifiedPct}%`],
    ["검토 필요", apiNum(review), reviewPct == null ? "-" : `${reviewPct}%`],
    ["후보 없음", apiNum(counts.none || 0), ""]
  ].map(([label, value, sub]) => `<div class="action-item sales-kpi-card product-registry-summary-card"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`).join("");
}

function renderProductRegistryTabs(items) {
  const target = $("#productRegistryTabs");
  if (!target) return;
  const counts = productRegistryTabCounts(items);
  const tabs = [
    ["all", "자동 연결 가능"],
    ["family", "상품군 후보"],
    ["similar", "애매한 후보"],
    ["none", "후보 없음"]
  ];
  target.innerHTML = tabs.map(([key, label]) => (
    `<button type="button" class="product-action-filter ${productRegistryState.activeTab === key ? "active" : ""}" data-product-registry-tab="${key}">
      ${esc(label)} <span>${apiNum(counts[key] || 0)}</span>
    </button>`
  )).join("");
}

function renderProductRegistryFilterOptions(items) {
  const brandSelect = $("#productRegistryBrandFilter");
  const statusSelect = $("#productRegistryStatusFilter");
  const diagnosticSelect = $("#productRegistryDiagnosticFilter");
  if (brandSelect) {
    const brands = [...new Set(items.map((item) => item.brandName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    brandSelect.innerHTML = `<option value="all">브랜드 전체</option>${brands.map((brand) => `<option value="${esc(brand)}">${esc(brand)}</option>`).join("")}`;
    brandSelect.value = brands.includes(productRegistryFilters.brand) ? productRegistryFilters.brand : "all";
    productRegistryFilters.brand = brandSelect.value;
  }
  if (statusSelect) {
    const statuses = [...new Set(items.map((item) => item.entry?.status).filter(Boolean))].sort();
    statusSelect.innerHTML = `<option value="all">상태 전체</option>${statuses.map((status) => `<option value="${esc(status)}">${esc(status)}</option>`).join("")}`;
    statusSelect.value = statuses.includes(productRegistryFilters.status) ? productRegistryFilters.status : "all";
    productRegistryFilters.status = statusSelect.value;
  }
  if (diagnosticSelect) {
    const diagnostics = [...new Set(items.flatMap((item) => productRegistryDiagnosticTypes(item)))].sort();
    diagnosticSelect.innerHTML = `<option value="all">Diagnostic 전체</option>${diagnostics.map((type) => `<option value="${esc(type)}">${esc(type)}</option>`).join("")}`;
    diagnosticSelect.value = diagnostics.includes(productRegistryFilters.diagnostic) ? productRegistryFilters.diagnostic : "all";
    productRegistryFilters.diagnostic = diagnosticSelect.value;
  }
}

function productRegistryCardHtml(item) {
  const candidates = productRegistryCandidates(item);
  const types = productRegistryDiagnosticTypes(item);
  const selected = productRegistryState.selectedId === item.canonicalProductId ? " is-selected" : "";
  const consignment = candidates.some((candidate) => candidate.consignment);
  const confidence = productRegistryConfidenceVisual(item);
  const preview = productRegistryCandidatePreview(candidates);
  return `
    <article class="product-registry-card${selected}" tabindex="0" role="button" data-product-registry-card="${esc(item.canonicalProductId)}">
      <div class="product-registry-card-head">
        <div>
          <span class="product-registry-brand">${esc(item.brandName)}</span>
          <strong>${esc(item.productName)}</strong>
        </div>
        <span class="sales-status-badge">${esc(productRegistryBadgeLabel(item))}</span>
      </div>
      <div class="product-registry-row-meta">
        <span class="product-registry-confidence ${esc(confidence.tone)}"><b>${esc(confidence.stars)}</b><small>${esc(confidence.label)}</small></span>
        <span>후보 ${apiNum(candidates.length)}</span>
        <span>${esc(item.entry?.status || "-")}</span>
      </div>
      ${preview ? `<div class="product-registry-size-preview">${preview}</div>` : `<p class="product-registry-candidate-summary">ECOUNT 후보가 아직 없습니다.</p>`}
      <div class="product-registry-diags">${types.slice(0, 2).map((type) => `<span>${esc(type)}</span>`).join("")}${consignment ? `<span>위탁 후보</span>` : ""}</div>
      <p class="hint-text">${esc(productRegistryReason(item))}</p>
    </article>`;
}

function renderProductRegistryList() {
  const list = $("#productRegistryList");
  const empty = $("#productRegistryEmpty");
  if (!list || !empty) return;
  const filtered = productRegistrySortItems(productRegistryState.items.filter(productRegistryMatchesFilters));
  list.innerHTML = filtered.map(productRegistryCardHtml).join("");
  empty.hidden = filtered.length > 0;
  if (!filtered.some((item) => item.canonicalProductId === productRegistryState.selectedId)) {
    productRegistryState.selectedId = filtered[0]?.canonicalProductId || null;
  }
  renderProductRegistryDetail();
}

function productRegistryCandidateSort(a, b) {
  return String(a.size || "").localeCompare(String(b.size || ""), "ko", { numeric: true }) ||
    String(a.prodCd || "").localeCompare(String(b.prodCd || ""));
}

function renderProductRegistryDetail() {
  const target = $("#productRegistryDetail");
  if (!target) return;
  const item = productRegistryState.items.find((row) => row.canonicalProductId === productRegistryState.selectedId);
  if (!item) {
    target.innerHTML = `<div class="sales-empty-card"><strong>상품을 선택하세요</strong><p>왼쪽 후보 카드를 선택하면 상세 비교가 표시됩니다.</p></div>`;
    return;
  }
  const entry = item.entry || {};
  const candidates = productRegistryCandidates(item).slice().sort(productRegistryCandidateSort);
  const confidence = productRegistryConfidenceVisual(item);
  const candidateHtml = candidates.length ? candidates.map((candidate) => `
    <li class="product-registry-candidate-row">
      <strong>${esc(candidate.size || "-")}</strong>
      <span>${esc(candidate.productName || "-")}</span>
      <small>prodCd ${esc(candidate.prodCd || "-")} · BAR_CODE ${esc(candidate.barcode || "-")} · supplier ${esc(candidate.supplier || "-")}</small>
      <em>${candidate.consignment ? "위탁 후보" : "일반 후보"} · ${esc(productRegistryReason(item))}</em>
    </li>
  `).join("") : `<li class="product-registry-candidate-row is-empty"><strong>ECOUNT 후보가 아직 없습니다.</strong><span>Review Queue에서 직접 검색이 필요한 Cafe24 상품입니다.</span></li>`;
  target.innerHTML = `
    <div class="product-registry-detail-head">
      <div>
        <span class="product-registry-brand">${esc(item.brandName)}</span>
        <h3>${esc(item.productName)}</h3>
      </div>
      <span class="sales-status-badge">${esc(productRegistryBadgeLabel(item))}</span>
    </div>
    <div class="clients-tooltip-stats clients-detail-stats-grid product-registry-detail-kpis">
      <div class="clients-tooltip-stat"><span>Confidence</span><strong>${esc(confidence.stars)}</strong><small>${esc(confidence.label)}</small></div>
      <div class="clients-tooltip-stat"><span>후보 수</span><strong>${apiNum(candidates.length)}</strong></div>
      <div class="clients-tooltip-stat"><span>Status</span><strong>${esc(entry.status || "-")}</strong></div>
    </div>
    <div class="product-registry-detail-section">
      <p class="clients-tooltip-subhead">Cafe24</p>
      <div class="clients-detail-period-block">
        <div class="clients-detail-period-row"><span>브랜드</span><strong>${esc(item.brandName)}</strong></div>
        <div class="clients-detail-period-row"><span>상품명</span><strong>${esc(item.cafe24?.productName || item.productName || "-")}</strong></div>
        <div class="clients-detail-period-row"><span>productCode</span><strong>${esc(item.cafe24?.productCode || "-")}</strong></div>
        <div class="clients-detail-period-row"><span>productNo</span><strong>${esc(item.cafe24?.productNo || "-")}</strong></div>
      </div>
    </div>
    <div class="product-registry-detail-section">
      <p class="clients-tooltip-subhead">ECOUNT 후보</p>
      <ul class="product-registry-candidate-list">${candidateHtml}</ul>
    </div>
    <div class="product-registry-detail-section">
      <p class="clients-tooltip-subhead">진단</p>
      <div class="clients-detail-period-block">
        <div class="clients-detail-period-row"><span>Confidence</span><strong>${apiNum(item.confidence)}</strong></div>
        <div class="clients-detail-period-row"><span>Matching 이유</span><strong>${esc(productRegistryReason(item))}</strong></div>
        <div class="clients-detail-period-row"><span>Diagnostic</span><strong>${productRegistryDiagnosticTypes(item).map(esc).join(", ") || "-"}</strong></div>
      </div>
    </div>
    <div class="product-registry-detail-section">
      <p class="clients-tooltip-subhead">Phase 2B Actions</p>
      <div class="product-registry-actions">
        ${["상품군으로 승인", "선택 후보 승인", "온라인 전용", "직접 검색", "보류"].map((label) => `<button class="button secondary" type="button" data-product-registry-readonly>${esc(label)}</button>`).join("")}
      </div>
      <p class="hint-text">승인 기능은 Phase 2B에서 제공됩니다.</p>
    </div>`;
}

async function renderProductRegistryView() {
  const seq = ++productRegistryRenderSeq;
  const status = $("#productRegistryStatus");
  if (status) {
    status.className = "ad-status-banner loading";
    status.textContent = "Product Registry 로딩 중...";
  }
  try {
    const [registryResp, queueResp] = await Promise.all([
      getJson(intelligenceUrl("/api/intelligence/product-registry"), 12000),
      getJson(intelligenceUrl("/api/intelligence/product-registry/review-queue"), 12000)
    ]);
    if (seq !== productRegistryRenderSeq) return;
    if (registryResp.error || queueResp.error || registryResp.ok === false || queueResp.ok === false) throw new Error(registryResp.message || queueResp.message || registryResp.error || queueResp.error || "Product Registry 로딩 실패");
    productRegistryState.registry = registryResp.registry;
    productRegistryState.reviewQueue = queueResp.reviewQueue;
    productRegistryState.items = productRegistryBuildItems(registryResp.registry, queueResp.reviewQueue);
    if (!productRegistryState.activeTab) productRegistryState.activeTab = "all";
    if (status) {
      status.className = "ad-status-banner good";
      status.textContent = `Read-only · Review Queue ${apiNum(productRegistryState.items.length)}개`;
    }
    renderProductRegistrySummary(registryResp.registry, queueResp.reviewQueue);
    renderProductRegistryTabs(productRegistryState.items);
    renderProductRegistryFilterOptions(productRegistryState.items);
    renderProductRegistryList();
  } catch (error) {
    if (seq !== productRegistryRenderSeq) return;
    if (status) {
      status.className = "ad-status-banner urgent";
      status.textContent = `Product Registry를 불러오지 못했습니다. ${error.message || ""}`;
    }
    $("#productRegistryList") && ($("#productRegistryList").innerHTML = "");
    $("#productRegistryDetail") && ($("#productRegistryDetail").innerHTML = `<div class="sales-empty-card"><strong>오류</strong><p>${esc(error.message || "데이터 로딩 실패")}</p></div>`);
  }
}

renderNav();
bind();
handleCafe24OAuthRedirect();
loadMonths();
renderStoryInsights();
