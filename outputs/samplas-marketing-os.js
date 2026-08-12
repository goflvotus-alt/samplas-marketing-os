const navItems = [
  { view: "Overview", label: "Today", hash: "today", group: "public", hidden: false },
  { view: "Reports", label: "Monthly", hash: "monthly-report", group: "public", hidden: false },
  { view: "Reports", label: "Annual", hash: "annual-report", group: "public", hidden: false },
  { view: "Clients", label: "Clients", hash: "clients", group: "public", hidden: false },
  { view: "InventoryOverview", label: "Inventory", hash: "inventory-overview", group: "public", hidden: false },
  // STEP65-6 수정: "Intelligence"(Mission Brief 통합 화면)를 rename하는 건 잘못된
  // 연결이었다 — 실제 "Brand Selector로 브랜드를 골라 상세 분석을 보는" 화면은
  // BrandDashboard(719행이 아니라 1227행, hash: brand-dashboard)이며 지금까지 계속
  // hidden 상태였다. Sidebar "Brand Intelligence"는 이 화면으로 연결한다(새 화면 아님,
  // 기존 hidden 진입을 노출만 함 — STEP65-5가 PromotionSummary에 한 것과 동일 패턴).
  { view: "BrandDashboard", label: "Brand Intelligence", hash: "brand-dashboard", group: "management", hidden: false },
  // STEP65-5: Navigation Integration. hidden 진입(URL 직접 입력)만 있던 STEP65-3/65-4를
  // 대체해 Sidebar에 정식 노출한다 — 직원이 클릭만으로 진입 가능해야 한다는 지시대로.
  { view: "PromotionSummary", label: "Promotion Intelligence", hash: "promotion-summary", group: "management", hidden: false },
  { view: "Sales", label: "Commerce", hash: "commerce", group: "management", hidden: false },
  { view: "Content", label: "Content", hash: "content", group: "management", hidden: false },
  { view: "ProductRegistry", label: "Product Registry", hash: "product-registry", group: "management", hidden: false },
  { view: "Settings", label: "Master Data", hash: "master-data", group: "management", hidden: false },
  { view: "Settings", label: "Settings", hash: "settings", group: "management", hidden: false },
  { view: "Calendar", label: "Calendar", hash: "calendar", hidden: true },
  { view: "Advertising", label: "Marketing", hash: "marketing", hidden: true },
  { view: "InventoryIntelligence", label: "Inventory Intelligence", hash: "inventory-intelligence", hidden: true },
  { view: "Product", label: "Product", hash: "product", hidden: true },
  { view: "Editorial AI", label: "Editorial AI", hash: "editorial-ai", hidden: true },
  // STEP65-6 수정: 기존 통합 Intelligence(Mission Brief) 화면은 삭제하지 않고 hidden
  // 처리만 한다 — URL(#intelligence) 직접 접근은 계속 가능하다.
  { view: "Intelligence", label: "Intelligence", hash: "intelligence", hidden: true },
  { view: "EntityOverview", label: "Brand Overview", hash: "brands", hidden: true }
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
let todayViewDirty = true;
// Calendar x Sales Heatmap Phase 1(2026-07-17): 신규 Calendar 화면 상태. Today의
// todaySalesCalendar*와 완전히 별개 화면(별도 nav)이라 렌더 시퀀스/선택 월을 독립적으로 갖되,
// 데이터 로딩 로직(월별 온라인/오프라인/Instagram)은 최대한 재사용한다(아래 함수 주석 참고).
let calendarViewMonth = `${todaySalesCalendarInitialDate.getFullYear()}-${String(todaySalesCalendarInitialDate.getMonth() + 1).padStart(2, "0")}`;
let calendarRenderSeq = 0;
// 월 단위 데이터 캐시: 월 이동 시 이미 받아온 데이터를 재사용하고 불필요한 재호출을 막기 위함
// (요구사항 "월 이동 시 불필요한 재호출 금지"). key = monthKey, value = { onlineData, offlineData, instagramByDate }.
let calendarMonthDataCache = new Map();
// 날짜 단위 상세 캐시(광고비/ROAS/TOP 브랜드/TOP 상품/TOP 고객): hover/클릭으로 실제 조회된 날짜만
// on-demand로 채워지고, 이후 같은 날짜를 다시 hover/클릭해도 재요청하지 않는다. key = date(YYYY-MM-DD).
let calendarDayDetailCache = new Map();
let calendarSelectedDate = null;
let calendarDayOverviewRenderSeq = 0;
let calendarHoverTimer = null;
let calendarHoverDate = null;
let campaignPeriodComparisonState = { comparisonMode: "month", manualRange: null, manualComparisonRange: null, monthBase: "", monthTarget: "", settingsOpen: false, loading: false };
let reportsMonth = "";
let reportsRenderSeq = 0;
let annualBrandPerformanceRows = [];
let brandTrendDetailStore = new Map();
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
// Clients v1 (2026-07-17 Clients 화면 구현). 기존 renderSeq stale-guard 패턴을 그대로 따라
// Clients 탭에서만 독립적으로 갱신한다 — Overview/Sales/Advertising/Content의 공용
// renderOperationsSections() 파이프라인에는 얹지 않는다(기존 화면 동작 변경 금지).
let clientsRenderSeq = 0;
let clientsOverviewState = null;
const clientsRequestsInFlight = new Map();
let clientsListSearch = "";
let clientsListTypeFilter = "all";
let clientsListSort = "recent_desc";
let clientsListVisibleCount = 20;
let clientsListSearchTimer = null;
let selectedClientId = null;
let productRegistryRenderSeq = 0;
let productRegistryState = { registry: null, reviewQueue: null, items: [], activeTab: "all", selectedId: null };
let productRegistryFilters = { search: "", brand: "all", confidence: "all", status: "all", diagnostic: "all", candidateCount: "all" };
let inventoryIntelRenderSeq = 0;
let inventoryIntelState = { raw: null, items: [], activeTab: "all", selectedId: null };
let inventoryIntelFilters = { search: "", brand: "all", sort: "priority" };
let inventoryOverviewRenderSeq = 0;
let inventoryOverviewState = { raw: null };
let inventoryOverviewFilters = { search: "", brand: "all", status: "all", sort: "priority", lowStockThreshold: 3 };
let inventoryOverviewPage = { offset: 0, limit: 50 };
let inventoryOverviewSearchDebounceTimer = null;
let inventoryWorkspaceTab = "today";
const inventoryWorkspaceTabs = new Set(["today", "store", "completed"]);

const nf = new Intl.NumberFormat("ko-KR");
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const intelligenceBaseUrl = window.samplasIntelligenceBaseUrl || "";
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

function brandPerformancePaidAmount(record = {}) {
  return canonicalPaidAmount(record);
}

// HOTFIX(2026-07-30) — Monthly Report > 01 Commerce > 브랜드 매출 TOP5 카드 전용 헬퍼.
// commerce.brandSales는 scripts/monthly-brand-sales.mjs의 mergeOfflineBrandSales()가
// 오프라인(ECOUNT) 매출을 합산하면서도, 브랜드별 온라인(Cafe24 canonical 실제 결제)
// 금액을 record.onlinePaidAmount 필드에 그대로 보존해 둔다. 이 함수는 그 값을 그대로
// 읽기만 하며, 필드가 없는 예외 상황에서만 canonicalPaidAmount(온라인+오프라인 합산)로
// 폴백한다. brandPerformancePaidAmount(기존, 온라인+오프라인 합산 기준)는 다른 카드/화면이
// 계속 그대로 사용하므로 이 함수는 건드리지 않는다.
function brandPerformanceOnlinePaidAmount(record = {}) {
  return firstFiniteValue(record?.onlinePaidAmount, canonicalPaidAmount(record), 0);
}

function brandPerformanceCode(record = {}) {
  return String(record?.brand_code || record?.brandCode || "").trim();
}

function isExcludedBrandPerformance(record = {}) {
  const code = brandPerformanceCode(record).toUpperCase();
  const name = String(record?.brand_name || record?.brandName || record?.manufacturer_name || "").trim().toUpperCase();
  return code === "B0000000" || code === "UNASSIGNED" || name.includes("개인결제창".toUpperCase()) || name.includes("UNASSIGNED");
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

// STEP48 — Data Freshness Header: 계산 로직은 전혀 건드리지 않고, 각 화면이 이미 받고 있는
// 응답의 타임스탬프/상태 값만으로 "이 데이터가 언제 기준인지"를 표시하는 공용 컴포넌트.
// Today/Commerce/Clients/Monthly가 renderFreshnessHeader()를, Product Registry/Inventory
// Intelligence(운영 기능 아님)가 renderBetaFreshnessBadge()를 재사용한다 — 화면마다 중복
// 구현하지 않는다.
//
// STEP48A(2026-07-31) — 화면 전체를 LIVE/CACHE/ARCHIVE 단일 상태로 표시하면, 서로 다른
// 최신성을 가진 데이터가 한 화면에 섞여 있을 때 사용자가 "전체가 실시간"이라고 오해할 수
// 있다는 지적에 따라 MIXED 상태를 추가했다. 실제 데이터 소스 재추적 결과(계산 로직 변경 없음,
// 표시 문구만 재검토):
//   - Today: `#todaySummarySections`의 "총매출" 카드가 Cafe24 LIVE 온라인 매출과 ECOUNT
//     오프라인 SNAPSHOT을 합산해 하나의 숫자로 보여준다(todaySummarySalesInfo). 광고비/ROAS는
//     Meta Ads 캐시, 콘텐츠 지표는 Instagram 캐시 기준이라 화면 전체가 이미 다중 소스 혼합이다.
//     → status: "mixed"
//   - Commerce: 화면 하단 매출 요약(Hero/Compare/결제수단, #commerceSummaryHero 등)은
//     오프라인/ECOUNT를 전혀 포함하지 않는 Cafe24 온라인 실결제 LIVE 값만 사용함을 재확인했다
//     (totalSales는 fetch만 되고 화면에는 렌더링되지 않는 미사용 상태값). 다만 화면 상단
//     KPI(#kpiGrid, #overviewLiveData/#overviewLiveSupport)에는 Meta Ads 캐시·Instagram
//     캐시 기준 카드가 함께 있어 완전한 단일 LIVE 화면은 아니다 → status는 "live"로 유지하되
//     note에 이 사실을 명시한다.
//   - Clients: Cafe24 온라인 주문은 디스크 캐시(loadCanonicalCafe24OrderCache, 파일 mtime
//     기준)를, 오프라인은 ECOUNT 수동 업로드 스냅샷(importedAt)을 쓴다. Cafe24 캐시 쪽 생성
//     시각은 intelligence-service.mjs 내부에서만 계산되고 API 응답에 노출되지 않아(이번 STEP은
//     intelligence-service.mjs 수정 금지) 실제 값을 가져올 수 없다 — 추측값을 넣는 대신 ECOUNT
//     importedAt만 표시하고, Cafe24 캐시 시각은 "현재 API로 확인 불가"임을 note에 명시한다.
//   - Monthly: archive.sales.totalSales가 Cafe24 온라인 + ECOUNT 오프라인을 합산한다
//     (buildMonthlyArchiveSales, server.mjs). archiveStatus "saved"(저장된 과거월)만 더 이상
//     바뀌지 않는 ARCHIVE이고, "live"(당월)/"draft"(미저장 과거월)는 매 요청마다 이 혼합 계산을
//     다시 수행하므로 LIVE가 아니라 MIXED다.
//
// LIVE/CACHE/ARCHIVE/MIXED 기준 정의:
//   LIVE    = 화면을 열 때마다 원본 소스(Cafe24 API 등)를 다시 조회해 즉석 계산한 값
//   CACHE   = 자동 재동기화 없이 이미 저장된 스냅샷/캐시 파일을 읽은 값
//   ARCHIVE = 특정 과거 시점에 저장되어 더 이상 바뀌지 않는 기록
//             (Monthly의 저장된 과거월 archiveStatus === "saved")
//   MIXED   = 서로 다른 최신성을 가진 데이터 소스(예: LIVE 온라인 + SNAPSHOT 오프라인)를
//             하나의 화면·카드에서 함께 사용하는 경우
//             (Today 전체, Monthly의 당월/미저장 과거월)
const FRESHNESS_STATUS_LABEL = { live: "LIVE", cache: "CACHE", archive: "ARCHIVE", mixed: "MIXED" };

function freshnessTimestampLabel(value) {
  if (!value) return "확인 불가";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인 불가";
  return date.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function renderFreshnessHeader(targetId, { status, dataAsOf, lastUpdated, note } = {}) {
  const target = $(`#${targetId}`);
  if (!target) return;
  const statusKey = String(status || "").toLowerCase();
  const statusLabel = FRESHNESS_STATUS_LABEL[statusKey] || "-";
  target.innerHTML = `<div class="freshness-header">
    <span class="freshness-badge freshness-badge-${esc(statusKey || "unknown")}">${esc(statusLabel)}</span>
    <span class="freshness-item"><strong>Data As Of</strong><em>${esc(dataAsOf || "-")}</em></span>
    <span class="freshness-item"><strong>Last Updated</strong><em>${esc(freshnessTimestampLabel(lastUpdated))}</em></span>
    ${note ? `<span class="freshness-note">${esc(note)}</span>` : ""}
  </div>`;
}

function renderBetaFreshnessBadge(targetId, { lastUpdated, note } = {}) {
  const target = $(`#${targetId}`);
  if (!target) return;
  target.innerHTML = `<div class="freshness-header freshness-header-beta">
    <span class="freshness-badge freshness-badge-beta">BETA</span>
    <span class="freshness-item"><strong>Last Updated</strong><em>${esc(freshnessTimestampLabel(lastUpdated))}</em></span>
    ${note ? `<span class="freshness-note">${esc(note)}</span>` : ""}
  </div>`;
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
  const monthUntil = boundedMonthUntil(data.month);
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
    // 2026-07-18 Brand Display Name 통일: 이 API 응답(주로 /api/diagnostics/brand-sales)에
    // products[]가 있으면, 상품명의 "[영문 : 한글]" 대괄호 표기에서 영문 Canonical Name을
    // 추출해 전역 캐시에 채웁니다. 새 API를 추가하지 않고 이미 호출 중인 응답만 재사용합니다.
    registerBrandCanonicalNames(body?.products);
    registerBrandCanonicalNames(body?.commerce?.productSales);
    registerBrandCanonicalNames(body?.archive?.commerce?.productSales);
    registerBrandMasterResponse(body);
    return body;
  } catch (error) {
    return { error: error.name === "AbortError" ? "응답 지연" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

// 브랜드 코드 → 영문 Canonical Name 전역 캐시. 세션 동안 여러 화면이 /api/diagnostics/
// brand-sales를 호출할 때마다 getJson()이 자동으로 채웁니다(위 참고).
const brandCanonicalNameCache = new Map();
const brandRegistryEnglishNameCache = new Map();

function registerBrandCanonicalNames(products) {
  if (!Array.isArray(products)) return;
  products.forEach((product) => {
    const code = String(product?.brand_code || "").trim();
    if (!code) return;
    const english = intelligenceBrandNameFromProductName(product?.productName);
    if (english) brandCanonicalNameCache.set(code, english);
  });
}

function registerBrandRegistryNames(brands) {
  if (!Array.isArray(brands)) return;
  brands.forEach((brand) => {
    const code = String(brand?.brand_code || brand?.brandCode || brand?.code || "").trim();
    const english = String(brand?.brand_name || brand?.brandName || brand?.name || "").trim();
    if (code && english && english !== code && /[A-Za-z]/.test(english) && !/[가-힣]/.test(english)) {
      brandRegistryEnglishNameCache.set(code, english);
    }
  });
}

function registerBrandMasterResponse(body) {
  registerBrandRegistryNames(body?.brands);
}

function registerProductRegistryCanonicalNames(entries) {
  if (!Array.isArray(entries)) return;
  entries.forEach((entry) => {
    const code = String(entry?.brandId || "").trim();
    const english = intelligenceBrandNameFromProductName(entry?.cafe24?.productName);
    if (code && english && !brandCanonicalNameCache.has(code)) brandCanonicalNameCache.set(code, english);
  });
}

// 프로젝트 전체에서 브랜드명을 출력하는 단일 공통 함수입니다. 화면마다 displayName/
// localizedName/한글 alias를 직접 쓰지 않고, 이 함수 하나만 거칩니다.
// 순서: ① brandCanonicalNameCache에 있는 영문 Canonical Name(Cafe24 상품명의
// "[영문 : 한글]" 표기에서 추출) → ② 없으면 기존 이름(brand_name/brandName/name, 한글일
// 수 있음) → ③ 그마저 없으면(코드와 동일하거나 빈 값) "미분류".
function brandCanonicalDisplayName(brandLike = {}) {
  if (brandLike == null) return "미분류";
  if (typeof brandLike === "string") {
    const trimmed = brandLike.trim();
    // B0000000은 미분류 브랜드가 아니라 Cafe24 "개인결제창" 코드입니다. 영문 Canonical
    // Name fallback보다 먼저 판정합니다.
    if (trimmed === "B0000000") return "개인결제창";
    return trimmed || "미분류";
  }
  const code = String(brandLike.brand_code || brandLike.brandCode || brandLike.code || brandLike.id || "").trim();
  if (code === "B0000000") return "개인결제창";
  const rawName = String(brandLike.brand_name || brandLike.brandName || brandLike.name || "").trim();
  if (code && brandRegistryEnglishNameCache.has(code)) return brandRegistryEnglishNameCache.get(code);
  if (code && brandCanonicalNameCache.has(code)) return brandCanonicalNameCache.get(code);
  if (rawName && rawName !== code) return rawName;
  return "미분류";
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
  Calendar: "calendar",
  Sales: "commerce",
  Advertising: "marketing",
  Content: "content",
  Reports: "monthly-report",
  Intelligence: "intelligence",
  Clients: "clients",
  ProductRegistry: "product-registry",
  InventoryOverview: "inventory-overview",
  InventoryIntelligence: "inventory-intelligence",
  Settings: "settings",
  Product: "product",
  "Editorial AI": "editorial-ai",
  BrandDashboard: "brand-dashboard",
  EntityOverview: "brands",
  PromotionSummary: "promotion-summary"
};

const hashViewMap = {
  ...Object.fromEntries(Object.entries(viewHashMap).map(([view, hash]) => [hash, view])),
  "annual-report": "Reports",
  "master-data": "Settings"
};

function currentRouteHash() {
  return decodeURIComponent(String(window.location.hash || "").replace(/^#/, ""));
}

function viewFromHash() {
  return hashViewMap[currentRouteHash()] || "Overview";
}

function updateViewHash(view, routeHash = "") {
  const hash = routeHash || viewHashMap[view];
  if (!hash) return;
  const next = `#${hash}`;
  if (window.location.hash === next) return;
  window.history.pushState(null, "", next);
}

function setActiveView(view, options = {}) {
  const targetView = navItems.some((item) => item.view === view) ? view : "Overview";
  const locationHash = currentRouteHash();
  const routeHash = options.routeHash || (hashViewMap[locationHash] === targetView ? locationHash : viewHashMap[targetView]);
  $$(".nav button").forEach((node) => node.classList.toggle("active", node.dataset.route === routeHash));
  $$(".view").forEach((panel) => panel.classList.toggle("active", panel.id === targetView));
  $("#monthlyDestinationLayout")?.toggleAttribute("hidden", routeHash === "annual-report");
  setTopbarTitle(targetView, routeHash);
  updateTopbarControls(targetView);
  if (targetView === "Intelligence") refreshActiveIntelligencePanel();
  if (targetView === "Content" && monthlyData.length) renderContentOperations(selectedMonth());
  if (targetView === "Clients") refreshClientsView();
  if (targetView === "ProductRegistry") renderProductRegistryView();
  if (targetView === "InventoryOverview") renderInventoryWorkspaceView({ reset: true });
  if (targetView === "InventoryIntelligence") renderInventoryIntelligenceView();
  if (targetView === "Calendar") renderCalendarView();
  if (targetView === "PromotionSummary") renderPromotionSummaryView();
  if (targetView === "Overview" && todayViewDirty && monthlyData.length) renderTodayView(selectedMonth());
  if (targetView === "Intelligence" && monthlyData.length) renderActiveDestinationCards(selectedMonth());
  if (options.updateHash === false && ["Reports", "Sales", "Settings"].includes(targetView) && monthlyData.length) renderActiveDestinationCards(selectedMonth());
  if (options.updateHash !== false) updateViewHash(targetView, routeHash);
  if (options.scroll !== false) window.scrollTo({ top: 0, behavior: options.smooth === false ? "auto" : "smooth" });
  const aliasTarget = routeHash === "annual-report"
    ? $("#annualArchiveFlow")
    : routeHash === "master-data"
      ? $("#brandMasterSummary")?.closest(".section-block")
      : null;
  if (aliasTarget) {
    const scrollToAlias = () => aliasTarget.scrollIntoView({ behavior: options.smooth === false ? "auto" : "smooth" });
    requestAnimationFrame(scrollToAlias);
    window.setTimeout(scrollToAlias, 800);
  }
  // STEP60-2: Cross Entity Navigation. Workspace를 전환할 때마다 Brand/Period/Compare
  // Context Bar를 다시 그린다 — 새 상태는 만들지 않고 이미 있는 값을 다시 표시할 뿐이다.
  renderWorkspaceContextBar();
}

function renderNav() {
  const nav = $("#nav");
  const groups = [
    { key: "public", label: "공용 운영" },
    { key: "management", label: "관리 · 분석" }
  ];
  nav.innerHTML = groups.map((group) => `
    <div class="nav-group">
      <p class="nav-group-label">${esc(group.label)}</p>
      ${navItems.filter((item) => item.group === group.key).map((item) => (
        `<button type="button" data-view="${esc(item.view)}" data-route="${esc(item.hash)}">${esc(item.label)}</button>`
      )).join("")}
    </div>
  `).join('<div class="nav-group-divider" aria-hidden="true"></div>') + navItems.filter((item) => item.hidden).map((item) => (
    `<button type="button" data-view="${esc(item.view)}" data-route="${esc(item.hash)}" hidden>${esc(item.label)}</button>`
  )).join("");
  setActiveView(viewFromHash(), { routeHash: currentRouteHash(), updateHash: false, scroll: false });
  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    setActiveView(button.dataset.view, { routeHash: button.dataset.route });
  });
  window.addEventListener("popstate", () => setActiveView(viewFromHash(), { routeHash: currentRouteHash(), updateHash: false, smooth: false }));
  window.addEventListener("hashchange", () => setActiveView(viewFromHash(), { routeHash: currentRouteHash(), updateHash: false, smooth: false }));
}

// Topbar used to repeat "MONTHLY INTELLIGENCE / Marketing Director / SAMPLAS"
// on every tab (already shown once in the sidebar brand block). Replaced with
// a single line reflecting which tab is actually open right now.
function setTopbarTitle(view, routeHash = "") {
  const target = $("#topbarTitle");
  const routeItem = navItems.find((item) => item.hash === routeHash);
  if (target) target.textContent = routeItem?.label || view;
}

function updateTopbarControls(view) {
  const controls = $(".topbar .controls");
  const monthSelect = $("#monthSelect");
  const operationsSelect = $("#operationsRange");
  const customRange = $("#operationsCustomRange");
  const showOperations = ["Overview", "Sales", "Advertising", "Content", "Clients"].includes(view);
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
  renderActiveDestinationCards(selectedMonth());
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

function todayViewActive() {
  return Boolean($("#Overview")?.classList.contains("active"));
}

function monthlyDestinationViewActive() {
  return Boolean($("#Reports")?.classList.contains("active") && !$("#monthlyDestinationLayout")?.hidden);
}

function commerceDestinationViewActive() {
  return Boolean($("#Sales")?.classList.contains("active"));
}

function intelligenceDestinationViewActive() {
  return Boolean($("#Intelligence")?.classList.contains("active"));
}

function destinationViewActive() {
  return Boolean(monthlyDestinationViewActive() || commerceDestinationViewActive() || intelligenceDestinationViewActive() || $("#Settings")?.classList.contains("active"));
}

function setTodayHtml(selector, html) {
  const target = $(selector);
  if (target) target.innerHTML = html;
}

function renderActiveDestinationCards(data = selectedMonth()) {
  const modeBadge = $("#dataModeBadge");
  if (modeBadge) modeBadge.textContent = sourceLabel(data);
  if (monthlyDestinationViewActive()) renderTodaySalesCalendar(data.month || todaySalesCalendarMonth);
  if (commerceDestinationViewActive()) renderKpis(data);
  if (destinationViewActive()) renderOverviewLiveData(data);
}

function renderTodayView(data = selectedMonth()) {
  if (!todayViewActive()) {
    todayViewDirty = true;
    return;
  }
  todayViewDirty = false;
  renderOverviewLiveData(data);
}

function renderKpis(data) {
  const target = $("#kpiGrid");
  if (!target) return;
  if (data.error) {
    const status = statusTextForError(data);
    target.innerHTML = [
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
  target.innerHTML = items.map(([label, value, delta]) => (
    `<article class="kpi"><span>${label}</span><strong>${value}</strong><p class="delta">${delta}</p></article>`
  )).join("");
}

// STEP65-3/STEP65-4: Promotion Intelligence. GET /api/promotion/:categoryNo/summary
// (STEP65-2)를 그대로 표시만 한다 — 새 계산/저장 없음.
//
// categoryNo -> 이름 매핑(PROMOTION_CATALOG)은 추측/하드코딩이 아니다: 실제 SAMPLAS
// 공개 스토어(https://scause.cafe24.com) 상단 메뉴를 STEP65-4 조사 중 직접 열어
// "ONLINE GARAGE" 링크의 href가 `/product/list.html?cate_no=425`, "이런 ㅅㅂ" 링크의
// href가 `?cate_no=437`임을 확인했고, 두 카테고리 페이지를 각각 열어 REMAGINE(437,
// 20% 할인)/TOGA(437, 50% 할인) 등 사용자가 언급한 실제 할인율과 일치하는 상품이
// 진열돼 있음까지 재확인했다(work/reports/STEP65-4.md 2번 항목). Category API가 아직
// 배포되지 않아 서버가 이름을 못 줄 뿐, 이 두 값 자체는 실측된 사실이다. 새 카테고리를
// 추가하려면(가상 프로모션 금지) 반드시 동일한 방식으로 실측 확인해야 한다.
const PROMOTION_CATALOG = [
  { id: "online-garage", name: "ONLINE GARAGE", categoryNo: "425" },
  { id: "irun-ssb", name: "이런 ㅅㅂ", categoryNo: "437" }
];

let promotionSummaryRenderSeq = 0;
let promotionSelectorOpen = false;

function promotionCatalogEntry(id) {
  return PROMOTION_CATALOG.find((entry) => entry.id === id) || null;
}

function promotionIdentifierFromQuery() {
  const raw = (new URLSearchParams(window.location.search).get("promotion") || "").trim();
  return promotionCatalogEntry(raw) ? raw : "";
}

// PART G: URL state. hash(#promotion-summary)는 그대로 두고 쿼리(?promotion=<id>)만
// 갱신한다 — 새로고침해도 URL에 그대로 남아 선택이 유지된다. categoryNo 숫자는 URL에
// 전혀 등장하지 않는다. replace:true는 STEP65-5의 "첫 진입 시 기본 Promotion 자동
// 선택"에 쓴다 — pushState를 쓰면 "선택 안 됨" 상태가 별도 뒤로가기 히스토리 항목으로
// 남아 뒤로가기를 눌러도 Promotion 화면에 갇히므로, 자동 선택은 replaceState로
// 히스토리를 늘리지 않는다. 사람이 Selector에서 직접 고를 때만 pushState를 쓴다
// (selectPromotion).
function updatePromotionQuery(id, options = {}) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("promotion", id);
  else url.searchParams.delete("promotion");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (options.replace) window.history.replaceState(null, "", nextUrl);
  else window.history.pushState(null, "", nextUrl);
}

function renderPromotionSelectorList() {
  const list = $("#promotionSelectorList");
  if (!list) return;
  const activeId = promotionIdentifierFromQuery();
  list.innerHTML = PROMOTION_CATALOG.map((entry) => (
    `<li class="${entry.id === activeId ? "active" : ""}" data-promotion-id="${esc(entry.id)}" tabindex="0">${esc(entry.name)}</li>`
  )).join("");
}

function openPromotionSelector() {
  promotionSelectorOpen = true;
  const dropdown = $("#promotionSelectorDropdown");
  dropdown?.removeAttribute("hidden");
  // .brand-selector-dropdown은 opacity:0이 기본값이라 hidden 해제만으로는 안 보인다 —
  // 기존 Brand Selector와 동일하게 .is-visible을 함께 토글해야 실제로 나타난다.
  dropdown?.classList.add("is-visible");
  $("#promotionSelectorTrigger")?.setAttribute("aria-expanded", "true");
}

function closePromotionSelector() {
  promotionSelectorOpen = false;
  const dropdown = $("#promotionSelectorDropdown");
  dropdown?.classList.remove("is-visible");
  dropdown?.setAttribute("hidden", "");
  $("#promotionSelectorTrigger")?.setAttribute("aria-expanded", "false");
}

function selectPromotion(id) {
  if (!promotionCatalogEntry(id)) return;
  updatePromotionQuery(id);
  closePromotionSelector();
  renderPromotionSummaryView();
}

// Brand Selector(브랜드 291개, 검색/최근/비교 포함)와 같은 CSS를 쓰지만 별도의 작은
// 독립 토글로 구현한다 — entitySelectorInstances 프레임워크는 291개 브랜드용으로 만든
// 장치라 고정 2개 프로모션에는 과하다(지시사항 "동일 패턴 재사용", 동일 CSS 클래스로
// 충족, JS 프레임워크 강제 결합은 하지 않음).
function initPromotionSelector() {
  const trigger = $("#promotionSelectorTrigger");
  const dropdown = $("#promotionSelectorDropdown");
  const list = $("#promotionSelectorList");
  if (!trigger || !dropdown || !list) return;
  renderPromotionSelectorList();
  trigger.addEventListener("click", () => {
    if (promotionSelectorOpen) closePromotionSelector();
    else openPromotionSelector();
  });
  list.addEventListener("click", (event) => {
    const li = event.target.closest("[data-promotion-id]");
    if (li) selectPromotion(li.dataset.promotionId);
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const li = event.target.closest("[data-promotion-id]");
    if (!li) return;
    event.preventDefault();
    selectPromotion(li.dataset.promotionId);
  });
  document.addEventListener("click", (event) => {
    if (!promotionSelectorOpen) return;
    if (event.target.closest(".promotion-selector")) return;
    closePromotionSelector();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && promotionSelectorOpen) closePromotionSelector();
  });
}

function promotionCoverageBarRow({ rank, label, sublabel, headline, share, desc }) {
  const barHtml = share === null ? "" : `<div class="inventory-intel-coverage-bar-track"><div class="inventory-intel-coverage-bar-fill" style="width:${Math.min(100, Math.max(0, share)).toFixed(2)}%"></div></div>`;
  return `<div class="inventory-intel-coverage-bar">
    <div class="inventory-intel-coverage-bar-head">
      <span><strong>${rank}.</strong> ${esc(label)}${sublabel ? ` <span class="muted">${esc(sublabel)}</span>` : ""}</span>
      <strong>${headline}</strong>
    </div>
    ${barHtml}
    <p class="inventory-intel-coverage-bar-desc">${desc}</p>
  </div>`;
}

// STEP66-1 SECTION 1: Hero Status Badge 색 매핑. docs/DESIGN_SYSTEM.md 8번(Status
// Color)과 동일한 규칙 재사용 — 새 상태 계산이 아니라 API가 이미 준 status 문자열을
// good/warn/error 세 클래스 중 하나로 보여주기만 한다. 현재 API는 항상 "UNKNOWN"만
// 반환하므로(Benefit API 미배포, STEP64-6) 실질적으로 항상 neutral(클래스 없음, 기본
// 회색 dot)이 된다 — 실데이터가 오면 이 매핑이 자동으로 색을 입힌다.
function promotionStatusBadgeClass(status) {
  const value = String(status || "").toUpperCase();
  if (value.includes("진행") || value === "ACTIVE") return "good";
  if (value.includes("종료임박") || value === "ENDING_SOON") return "warn";
  if (value.includes("종료") || value === "ENDED") return "";
  return "";
}

async function renderPromotionSummaryView() {
  const nameTarget = $("#promotionSummaryName");
  const statusBadge = $("#promotionSummaryStatusBadge");
  const statusBadgeText = $("#promotionSummaryStatusBadgeText");
  const metaTarget = $("#promotionSummaryMeta");
  const periodBadge = $("#promotionSummaryPeriodBadge");
  const productBadge = $("#promotionSummaryProductBadge");
  const brandBadge = $("#promotionSummaryBrandBadge");
  const bannerTarget = $("#promotionSummaryStatusBanner");
  const insightBlock = $("#promotionSummaryInsight");
  const insightText = $("#promotionSummaryInsightText");
  const tierOneBlock = $("#promotionSummaryTierOneBlock");
  const tierOneTarget = $("#promotionSummaryTierOne");
  const tierTwoBlock = $("#promotionSummaryTierTwoBlock");
  const tierTwoTarget = $("#promotionSummaryTierTwo");
  const brandsBlock = $("#promotionSummaryBrandsBlock");
  const topBrandsTarget = $("#promotionSummaryTopBrandsList");
  const productsBlock = $("#promotionSummaryProductsBlock");
  const topProductsTarget = $("#promotionSummaryTopProductsList");
  if (!nameTarget || !bannerTarget || !tierOneTarget || !tierTwoTarget || !topBrandsTarget || !topProductsTarget) return;

  const identifier = promotionIdentifierFromQuery();
  let entry = promotionCatalogEntry(identifier);
  // STEP65-5 PART 4: 첫 진입 시 기본 Promotion 자동 선택. Sidebar 클릭 등 URL에
  // ?promotion=이 없는 정상 진입 경로에서 "프로모션을 선택하세요" 빈 상태를 보여주지
  // 않고, PROMOTION_CATALOG의 첫 항목(ONLINE GARAGE)을 바로 보여준다. 사람이 URL을
  // 직접 편집할 필요가 없어야 한다는 지시 그대로.
  if (!entry && PROMOTION_CATALOG.length) {
    entry = PROMOTION_CATALOG[0];
    updatePromotionQuery(entry.id, { replace: true });
  }
  renderPromotionSelectorList();
  const renderSeq = ++promotionSummaryRenderSeq;

  const triggerLabel = $("#promotionSelectorTriggerLabel");
  if (triggerLabel) triggerLabel.textContent = entry ? entry.name : "프로모션 선택";

  // SECTION 7: Empty State. 빈 화면을 두지 않고 항상 안내 문구를 보여준다.
  const hideDetailBlocks = () => {
    metaTarget?.setAttribute("hidden", "");
    insightBlock?.setAttribute("hidden", "");
    tierOneBlock?.setAttribute("hidden", "");
    tierTwoBlock?.setAttribute("hidden", "");
    brandsBlock?.setAttribute("hidden", "");
    productsBlock?.setAttribute("hidden", "");
  };

  if (!entry) {
    nameTarget.textContent = "프로모션을 선택하세요";
    if (statusBadge) statusBadge.className = "brand-hero-status-badge";
    if (statusBadgeText) statusBadgeText.textContent = "상태 확인 중";
    hideDetailBlocks();
    bannerTarget.removeAttribute("hidden");
    bannerTarget.className = "ad-status-banner error";
    bannerTarget.innerHTML = `<span class="status-dot"></span><strong>프로모션을 선택해주세요.</strong><span class="note">상단 Promotion Selector에서 ONLINE GARAGE 또는 이런 ㅅㅂ를 선택하세요.</span>`;
    return;
  }

  nameTarget.textContent = entry.name;
  hideDetailBlocks();
  bannerTarget.removeAttribute("hidden");
  bannerTarget.className = "ad-status-banner loading";
  bannerTarget.innerHTML = `<span class="status-dot"></span><strong>${esc(entry.name)} 데이터를 불러오고 있습니다.</strong>`;
  tierOneTarget.innerHTML = `<article class="action-item ad-summary-card ad-core-kpi-card"><span>불러오는 중</span><strong>-</strong></article>`.repeat(2);
  tierTwoTarget.innerHTML = `<article class="kpi"><span>불러오는 중</span><strong>-</strong></article>`.repeat(4);
  topBrandsTarget.innerHTML = "";
  topProductsTarget.innerHTML = "";

  const data = await getJson(`/api/promotion/${encodeURIComponent(entry.categoryNo)}/summary`, 10000);
  if (renderSeq !== promotionSummaryRenderSeq) return;

  if (!data || !data.ok || data.error) {
    bannerTarget.className = "ad-status-banner error";
    bannerTarget.innerHTML = `<span class="status-dot"></span><strong>${esc(entry.name)} 데이터를 불러오지 못했습니다.</strong><span class="note">${esc((data && (data.error || data.message)) || "API 연결을 확인해주세요.")}</span>`;
    return;
  }

  bannerTarget.setAttribute("hidden", "");

  // SECTION 1: Hero. Name/Status/기간/Products/Brands를 한 카드(#promotionSummaryHero)
  // 안에서 표현한다. 기간은 API가 실제 조회한 since/until을 그대로 쓴다(새 계산 아님,
  // buildPromotionSummary의 기존 입력 파라미터를 노출한 것 — STEP65-4 server.mjs 수정
  // 참고). status는 여전히 UNKNOWN이 기본값이라 "상태 확인 중"으로 중립 표시한다.
  const statusLabel = !data.status || data.status === "UNKNOWN" ? "상태 확인 중" : String(data.status);
  if (statusBadge) statusBadge.className = `brand-hero-status-badge ${promotionStatusBadgeClass(data.status)}`.trim();
  if (statusBadgeText) statusBadgeText.textContent = statusLabel;
  metaTarget?.removeAttribute("hidden");
  if (periodBadge) periodBadge.textContent = data.since && data.until ? `${data.since} ~ ${data.until}` : "기간 확인 중";
  if (productBadge) productBadge.textContent = `상품 ${apiNum(data.productCount)}개`;
  if (brandBadge) brandBadge.textContent = `브랜드 ${apiNum(data.brandCount)}개`;

  // SECTION 2: Primary KPI(매출/주문 수) -> ad-core-kpi-card. 전부 API 값 그대로,
  // 새 계산 없음.
  tierOneBlock?.removeAttribute("hidden");
  tierOneTarget.innerHTML = [
    ["매출", won(data.revenue)],
    ["주문 수", apiNum(data.orderCount)]
  ].map(([label, value]) => `<article class="action-item ad-summary-card ad-core-kpi-card"><span>${esc(label)}</span><strong>${value}</strong></article>`).join("");

  // SECTION 3: Secondary KPI(판매수량/객단가/브랜드 수/상품 수) -> kpi. 브랜드/상품
  // 수는 이전에는 헤더 아래 텍스트 한 줄이었으나, 이번 STEP에서 정식 KPI 카드로
  // 승격했다(Hero의 뱃지와 값은 같지만 표현 형태가 다르다 — 뱃지는 빠른 스캔용,
  // 카드는 다른 KPI와 같은 비중으로 비교하기 위한 용도).
  tierTwoBlock?.removeAttribute("hidden");
  tierTwoTarget.innerHTML = [
    ["판매 수량", apiNum(data.quantity)],
    ["객단가", won(data.averageOrderValue)],
    ["브랜드 수", apiNum(data.brandCount)],
    ["상품 수", apiNum(data.productCount)]
  ].map(([label, value]) => `<article class="kpi"><span>${esc(label)}</span><strong>${value}</strong></article>`).join("");

  // SECTION 4: Performance Summary. 전부 API가 이미 준 값(topBrands[0]/topProducts[0]/
  // productCount)의 문장 조합일 뿐 새 추론/계산이 아니다.
  const topBrands = Array.isArray(data.topBrands) ? data.topBrands : [];
  const topProducts = Array.isArray(data.topProducts) ? data.topProducts : [];
  const revenue = Number(data.revenue || 0);
  if (insightBlock && insightText) {
    if (!topBrands.length && !topProducts.length) {
      insightBlock.removeAttribute("hidden");
      insightText.textContent = `${entry.name}에 판매 실적이 있는 상품이 아직 없습니다.`;
    } else {
      const topBrand = topBrands[0];
      const topProduct = topProducts[0];
      const topBrandShare = topBrand && revenue > 0 ? `${(Number(topBrand.salesAmount || 0) / revenue * 100).toFixed(1)}%` : null;
      const parts = [];
      if (topBrand) parts.push(`매출 1위 브랜드는 ${brandCanonicalDisplayName(topBrand)}${topBrandShare ? `(기여도 ${topBrandShare})` : ""}`);
      if (topProduct) parts.push(`1위 상품은 "${topProduct.productName || "상품명 없음"}"`);
      parts.push(`총 ${apiNum(data.productCount)}개 상품, ${apiNum(data.brandCount)}개 브랜드가 참여 중`);
      insightBlock.removeAttribute("hidden");
      insightText.textContent = `${parts.join(", ")}입니다.`;
    }
  }

  // SECTION 5: Brand Performance. 기존 .inventory-intel-coverage-bar 패턴(Inventory
  // Intelligence 화면)을 그대로 재사용 — 새 CSS 없음. 기여도 %는 STEP65-3과 동일한
  // 비율 계산(salesAmount/revenue)이다.
  brandsBlock?.removeAttribute("hidden");
  topBrandsTarget.innerHTML = topBrands.length ? topBrands.map((brand, index) => {
    const share = revenue > 0 ? Number(brand.salesAmount || 0) / revenue * 100 : null;
    const shareLabel = share === null ? "-" : `${share.toFixed(1)}%`;
    return promotionCoverageBarRow({
      rank: index + 1,
      label: brand.brand_name || brand.brand_code || "-",
      sublabel: brand.brand_code || "",
      headline: `${won(brand.salesAmount)} (${shareLabel})`,
      share,
      desc: `판매수량 ${apiNum(brand.quantitySold)} · 주문수 ${apiNum(brand.orderCount)}`
    });
  }).join("") : `<p class="hint-text">데이터 없음</p>`;

  // SECTION 6: Top Products. 표 대신 같은 rank row 컴포넌트를 막대 없이 재사용한다.
  productsBlock?.removeAttribute("hidden");
  topProductsTarget.innerHTML = topProducts.length ? topProducts.map((product, index) => (
    promotionCoverageBarRow({
      rank: index + 1,
      label: product.productName || "상품명 없음",
      sublabel: "",
      headline: won(product.salesAmount),
      share: null,
      desc: `${esc(product.brand_name || product.brand_code || "-")} · 판매수량 ${apiNum(product.quantitySold)}`
    })
  )).join("") : `<p class="hint-text">데이터 없음</p>`;
}

async function renderOverviewLiveData(data, renderSeq) {
  const renderToday = todayViewActive();
  const renderCommerce = commerceDestinationViewActive();
  if (!renderToday && !destinationViewActive()) {
    todayViewDirty = true;
    return;
  }
  if (!renderToday) todayViewDirty = true;
  if (renderCommerce) {
    setTodayHtml("#overviewLiveData", `<article class="action-item"><strong>선택 기간 KPI 확인 중</strong><p>매출 데이터를 정리합니다.</p></article>`);
    setTodayHtml("#overviewLiveSupport", "");
  }
  if (renderToday) {
    setTodayHtml("#todayBriefProgress", todayBriefProgressBar([]));
    setTodayHtml("#todayBriefing", `<article class="today-brief-card warning"><div class="today-brief-head"><span>!</span><strong>오늘 해야 할 일을 정리 중입니다.</strong></div><p>연결 상태와 성과 데이터를 확인하고 있습니다.</p></article>`);
    setTodayHtml("#todaySummaryBriefing", `<article class="action-item"><strong>오늘 요약 확인 중</strong><p>검증된 Commerce / Marketing 데이터를 정리합니다.</p></article>`);
    setTodayHtml("#todaySummarySections", `<article class="action-item"><strong>섹션 요약 확인 중</strong><p>대표 숫자를 불러오고 있습니다.</p></article>`);
    setTodayHtml("#actions", `<article class="home-action-card warn"><span>!</span><div><strong>확인 중</strong><p>중요 알림을 정리합니다.</p></div></article>`);
  }
  setTodayHtml("#nextActions", homeGoalCards());
  setTodayHtml("#insightList", homeActivityCards({ status: {}, meta: {}, cafe: {}, data }));
  setTodayHtml("#settingsCacheStatus", `<article class="home-activity-card neutral"><div><strong>캐시 상태 확인 중</strong><p>연결 데이터를 확인하고 있습니다.</p></div></article>`);

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
  if (!todayViewActive() && !destinationViewActive()) {
    todayViewDirty = true;
    return;
  }
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
  todayOverviewState = { data, meta, cafe, contentData, contentRangeError, posts, topProduct, avgSaveRate, followerDelta, range };
  renderSettingsCacheStatus({ instagram: contentData, meta, cafe });

  if (todayViewActive()) {
    // STEP48A: "총매출" 카드(todaySummarySalesInfo)가 Cafe24 LIVE 온라인 매출과 ECOUNT
    // 오프라인 SNAPSHOT을 합산하고, 광고비/ROAS는 Meta 캐시, 콘텐츠 지표는 Instagram 캐시
    // 기준이라 화면 전체를 LIVE 단일 상태로 표시하면 오해를 줄 수 있어 MIXED로 표시한다.
    renderFreshnessHeader("todayFreshnessHeader", {
      status: "mixed",
      dataAsOf: range.label || "오늘",
      lastUpdated: new Date().toISOString(),
      note: "온라인 매출·광고·콘텐츠는 지금 다시 조회한 값이지만, 광고비는 Meta 캐시, 콘텐츠는 Instagram 캐시, 총매출은 여기에 오프라인(매장) ECOUNT 스냅샷까지 합산한 값입니다. 오프라인 매출은 Commerce/Clients 화면의 ECOUNT 동기화 시각까지만 반영됩니다."
    });
  }

  if (commerceDestinationViewActive()) {
    const rangeEyebrow = $("#overviewRangeEyebrow");
    const rangeTitle = $("#overviewRangeTitle");
    if (rangeEyebrow) rangeEyebrow.textContent = range.label;
    if (rangeTitle) rangeTitle.textContent = `${range.label} KPI`;
    renderTodayOverviewCards();
  }
  if (todayViewActive() || intelligenceDestinationViewActive()) {
    renderTodaySummary({ data: contentData, cafe, meta, comparison, totalSales });
    currentTodayBriefingItems = buildTodayBriefing({ data, meta, cafe, cardnewsStatus, account: a, topSaved, topCampaign, topProduct, roas });
    if (todayViewActive()) renderTodayBriefing();
    if (intelligenceDestinationViewActive()) renderIntelligenceDestinationCards();
  }
  if (todayViewActive()) {
    const actions = buildOverviewActions({ data, meta, cafe, account: a, topSaved, roas });
    setTodayHtml("#actions", actions.map((item) => homeActionCard(item)).join(""));
  }
  setTodayHtml("#nextActions", homeGoalCards({ cafeTotals: { ...cafeTotals, orderAmount: cafeTotals.paidAmount }, metaTotals: { ...metaTotals, spend: metaCanonical.reportingSpend, purchaseValue: metaCanonical.reportingPurchaseValue }, postCount, followerDelta }));
  setTodayHtml("#insightList", homeActivityCards({ status, meta, cafe, data }));
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
  if (!commerceDestinationViewActive()) {
    todayViewDirty = true;
    return;
  }
  const { data, meta, cafe, contentData, contentRangeError, posts, topProduct, avgSaveRate, followerDelta, range } = todayOverviewState;
  const metaCanonical = todayCanonicalMetaTotals(meta, `${range.since} ~ ${range.until}`);
  const roas = metaCanonical.reportingSpend > 0 ? metaCanonical.reportingPurchaseValue / metaCanonical.reportingSpend : null;
  const cafeTotals = cafe.totals || {};
  const a = contentData.account || {};
  const postCount = posts.length;
  setTodayHtml("#kpiGrid", [
    homeTopMetric("선택 기간 광고비", meta.error ? "확인 필요" : apiWon(metaCanonical.reportingSpend), meta.error ? "Meta 연결 후 표시" : "Marketing canonical 기준", cardBadge("meta", meta, hasApiValue(metaCanonical.reportingSpend))),
    homeTopMetric("선택 기간 주문", cafe.error ? "데이터 없음" : `${apiNum(cafeTotals.orderCount)}건`, cafe.error ? "Cafe24 연결 후 표시" : "정상 주문", cardBadge("cafe24", cafe, hasApiValue(cafeTotals.orderCount))),
    homeTopMetric("선택 기간 인기상품", topProduct?.productName || "데이터 없음", topProduct ? `${apiNum(topProduct.quantity)}개 · ${apiWon(topProduct.itemAmount)}` : "판매 상품 데이터 없음", cardBadge("cafe24", cafe, Boolean(topProduct)))
  ].join(""));

  setTodayHtml("#overviewLiveData", [
    homeMonthPrimaryCard("매출", cafe.error ? "연결 필요" : apiWon(cafeTotals.paidAmount), cafe.error ? "Cafe24 확인 필요" : `주문 ${apiNum(cafeTotals.orderCount)}건`, cardBadge("cafe24", cafe, hasApiValue(cafeTotals.paidAmount))),
    homeMonthPrimaryCard("ROAS", roas === null ? "확인 중" : multiple(roas), "Meta canonical 구매값 / 광고비", cardBadge("meta", meta, roas !== null)),
    homeMonthPrimaryCard("평균 저장률", contentRangeError ? "확인 필요" : posts.length ? pct(avgSaveRate) : "데이터 없음", contentRangeError ? "Instagram 게시물 데이터 오류" : posts.length ? "콘텐츠 평균" : "콘텐츠 데이터 없음", cardBadge("instagram", contentData, posts.length > 0 && !contentRangeError))
  ].join(""));

  setTodayHtml("#overviewLiveSupport", [
    homeMonthSupportCard("광고비", meta.error ? "확인 필요" : apiWon(metaCanonical.reportingSpend), meta.error ? "Meta 확인 필요" : "Marketing canonical 기준", cardBadge("meta", meta, hasApiValue(metaCanonical.reportingSpend))),
    homeMonthSupportCard("팔로워 증가", hasApiValue(followerDelta) ? `${apiNum(followerDelta)}명` : "계산 불가", `현재 ${apiNum(a.followers)}명`, cardBadge("instagram", contentData, hasApiValue(followerDelta))),
    homeMonthSupportCard("콘텐츠 개수", contentRangeError ? "확인 필요" : `${apiNum(postCount)}개`, contentRangeError ? "선택 기간 게시물 데이터 오류" : data.postsScope === "recent_media_fallback" ? "최근 미디어 기준" : "선택 기간 기준", cardBadge("instagram", contentData, postCount > 0 && !contentRangeError))
  ].join(""));
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
      projectKey: "advertising",
      analysisDestination: "ai"
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
      projectKey: "content",
      analysisDestination: "ai"
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
    projectKey: "editorial",
    analysisDestination: "brand"
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
  const items = currentTodayBriefingItems.filter((item) => !item.analysisDestination);
  target.innerHTML = items.map((item) => todayBriefCard(item)).join("");
  setTodayHtml("#todayBriefProgress", todayBriefProgressBar(items));
}

function renderIntelligenceDestinationCards() {
  const renderItems = (selector, title, destination) => {
    const items = currentTodayBriefingItems.filter((item) => item.analysisDestination === destination);
    setTodayHtml(selector, `<strong>${title}</strong>${items.length ? items.map((item) => todayBriefCard(item)).join("") : "<span>현재 추천 없음</span>"}`);
  };
  renderItems("#intelligenceBrandSlot", "Brand Intelligence", "brand");
  renderItems("#intelligenceAiRecommendationSlot", "AI Recommendation", "ai");
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
  const target = $("#insightList");
  if (!target) return;
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
  target.innerHTML = notes.map((note) => `<div class="insight">${note}</div>`).join("");
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
  if (!$("#Content")?.classList.contains("active")) return;
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
    const brandName = brandCanonicalDisplayName(row);
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
  const attrsFn = options.attrsFn || (() => "");
  const extraFn = options.extraFn || (() => "");
  const base = Math.max(...rows.map((item) => Number(valueFn(item) || 0)), 1);
  return rows.map((item, index) => {
    const value = valueFn(item);
    const attrs = attrsFn(item, index);
    return `<div class="monthly-report-rank-row"${attrs ? ` ${attrs}` : ""}>
      <span class="monthly-report-rank-no">${String(index + 1).padStart(2, "0")}</span>
      <div class="monthly-report-rank-main">
        <strong>${esc(labelFn(item))}</strong>
        <span>${esc(subFn(item))}</span>
        ${options.withBar ? `<div class="monthly-report-rank-bar"><i style="width:${monthlyReportRatio(value, base)}%"></i></div>` : ""}
        ${extraFn(item, index)}
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

function monthlyReportTrendMonths(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match) return [];
  const year = match[1];
  const lastMonth = Number(match[2]);
  return Array.from({ length: lastMonth }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
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
  return brandCanonicalDisplayName(row);
}

function brandPerformanceDisplayName(row = {}) {
  const code = monthlyReportBrandCode(row);
  const direct = [
    row?.canonicalEnglishName,
    row?.canonicalNameEn,
    row?.englishName,
    row?.nameEn,
    row?.brandEnglishName,
    row?.brand_name_en,
    row?.manufacturer_name_en,
    row?.manufacturerNameEn,
    row?.canonicalName
  ].map((value) => String(value || "").trim()).find(Boolean);
  if (code && brandRegistryEnglishNameCache.has(code)) return brandRegistryEnglishNameCache.get(code);
  if (code && brandCanonicalNameCache.has(code)) return brandCanonicalNameCache.get(code);
  if (direct && direct !== code) return direct;
  return monthlyReportBrandName(row);
}

function monthlyReportBrandSignals(currentRows = [], previousRows = []) {
  const previousByCode = new Map();
  previousRows.filter((row) => !isExcludedBrandPerformance(row)).forEach((row) => {
    const code = monthlyReportBrandCode(row);
    if (code) previousByCode.set(code, row);
  });
  return currentRows.filter((row) => !isExcludedBrandPerformance(row)).map((row) => {
    const code = monthlyReportBrandCode(row);
    if (!code || !previousByCode.has(code)) return null;
    const currentSales = brandPerformancePaidAmount(row);
    const previousSales = brandPerformancePaidAmount(previousByCode.get(code));
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

function monthlyReportBrandTrendFromRows(rows = [], brandCode = "") {
  const code = String(brandCode || "").trim();
  return rows.map((row) => {
    const brandRows = row.archive?.commerce?.brandSales;
    const hasArchiveData = !row.failed && Array.isArray(brandRows);
    const brand = (brandRows || []).find((item) => monthlyReportBrandCode(item) === code);
    return {
      month: row.month || "",
      value: brand ? brandPerformancePaidAmount(brand) : 0,
      available: hasArchiveData,
      hasBrand: !!brand,
      archiveStatus: row.archiveStatus || row.archive?.archiveStatus || "",
      orderCount: brand ? Number(brand.orderCount || 0) : null,
      quantitySold: brand ? Number(brand.quantitySold || 0) : null
    };
  }).filter((item) => item.month);
}

function monthlyReportBrandTrendFromPair(currentMonth, currentBrand, previousMonth, previousBrand) {
  return [
    { month: previousMonth || "이전", value: previousBrand ? brandPerformancePaidAmount(previousBrand) : 0, available: !!previousBrand, orderCount: previousBrand ? Number(previousBrand.orderCount || 0) : null, quantitySold: previousBrand ? Number(previousBrand.quantitySold || 0) : null },
    { month: currentMonth || "현재", value: currentBrand ? brandPerformancePaidAmount(currentBrand) : 0, available: !!currentBrand, orderCount: currentBrand ? Number(currentBrand.orderCount || 0) : null, quantitySold: currentBrand ? Number(currentBrand.quantitySold || 0) : null }
  ];
}

function monthlyReportBrandTrendSummary(series = []) {
  const points = series.filter((item) => item.available);
  if (!points.length) return "표시할 월별 실결제 매출 데이터가 없습니다.";
  return points.map((item) => {
    const monthNumber = /^\d{4}-\d{2}$/.test(item.month) ? `${Number(item.month.slice(5, 7))}월` : item.month;
    return `${monthNumber} ${apiWon(item.value)}`;
  }).join(" → ");
}

function monthlyReportBrandSparkline(series = []) {
  const points = series.filter((item) => item.month);
  if (!points.length) return "";
  const width = 150;
  const height = 34;
  const values = points.map((item) => Number(item.value || 0));
  const max = Math.max(...values, 1);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coordinates = points.map((item, index) => {
    const x = points.length > 1 ? index * step : width / 2;
    const y = height - (Number(item.value || 0) / max * (height - 6)) - 3;
    return { ...item, x, y };
  });
  const path = coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return `<div class="monthly-report-brand-trend" aria-label="${esc(monthlyReportBrandTrendSummary(points))}">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-hidden="false">
      <polyline points="${esc(path)}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"></polyline>
      ${coordinates.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.available ? 3 : 2}" class="${point.available ? "" : "is-missing"}"><title>${esc(point.month)} · ${point.available ? apiWon(point.value) : "데이터 없음"}</title></circle>`).join("")}
    </svg>
    <small>${esc(monthlyReportBrandTrendSummary(points))}</small>
  </div>`;
}

function monthlyReportBrandTrendKey(prefix, brandCode) {
  return `${prefix}:${String(brandCode || "").trim()}`;
}

function monthlyReportBrandTrendCallout(series = []) {
  const points = series.filter((item) => item.available);
  if (points.length < 2) return "확보된 월별 데이터 기준으로 확인";
  const first = points[0];
  const last = points[points.length - 1];
  const diff = Number(last.value || 0) - Number(first.value || 0);
  if (!diff) return "최근 구간 실결제 매출 보합";
  return `최근 구간 ${diff > 0 ? "증가" : "감소"} 흐름`;
}

function monthlyReportBrandTrendInlineSummary(series = []) {
  const rows = series.filter((item) => item.month);
  if (!rows.length) return "";
  const label = (month) => /^\d{4}-\d{2}$/.test(month) ? `${Number(month.slice(5, 7))}월` : String(month || "-");
  return rows.map((item) => `${label(item.month)} ${item.available ? apiWon(item.value || 0) : "데이터 없음"}`).join(" · ");
}

function brandTrendDetailRows(series = []) {
  const rows = series.slice(-7);
  return rows.map((item, index) => {
    const previous = index > 0 ? rows[index - 1] : null;
    const value = Number(item.value || 0);
    const previousValue = previous && previous.available ? Number(previous.value || 0) : null;
    const diff = item.available && previousValue !== null ? value - previousValue : null;
    const diffPct = diff !== null && previousValue ? diff / previousValue * 100 : null;
    return { ...item, value, diff, diffPct };
  });
}

function brandTrendDetailPanelHtml(data = {}) {
  const rows = brandTrendDetailRows(data.series || []);
  const values = rows.map((item) => item.available ? Number(item.value || 0) : 0);
  const max = Math.max(1, ...values);
  const width = 520;
  const height = 150;
  const step = rows.length > 1 ? width / (rows.length - 1) : width;
  const coordinates = rows.map((item, index) => {
    const x = rows.length > 1 ? index * step : width / 2;
    const y = height - (Number(item.value || 0) / max * (height - 22)) - 12;
    return { ...item, x, y };
  });
  const path = coordinates.filter((item) => item.available).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const monthLabel = (month) => /^\d{4}-\d{2}$/.test(month) ? month : String(month || "-");
  const diffText = (item) => item.diff === null
    ? "전월 대비 비교 불가"
    : `${item.diff > 0 ? "+" : item.diff < 0 ? "-" : ""}${apiWon(Math.abs(item.diff))}${item.diffPct === null ? "" : ` · ${item.diffPct > 0 ? "+" : item.diffPct < 0 ? "-" : ""}${Math.abs(item.diffPct).toFixed(1)}%`}`;
  const body = `<section class="brand-order-popover-order">
    <h4>${esc(data.title || "월별 실결제 추세")}</h4>
    <p class="hint-text">${esc(data.note || "canonical paid 기준 · 최근 확보 월 최대 7개월")}</p>
    <div class="brand-trend-detail-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${data.name || "브랜드"} 월별 실결제 추세`)}">
        <polyline points="${esc(path)}" fill="none" stroke="currentColor" stroke-width="2.4" vector-effect="non-scaling-stroke"></polyline>
        ${coordinates.map((point) => `<circle tabindex="0" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.available ? 4 : 3}" class="${point.available ? "" : "is-missing"}">
          <title>${esc(`${monthLabel(point.month)} · ${point.available ? apiWon(point.value) : "데이터 미확보"} · ${diffText(point)} · 주문 ${point.orderCount ?? "-"}건 · 수량 ${point.quantitySold ?? "-"}개 · ${point.archiveStatus || "상태 없음"}`)}</title>
        </circle>`).join("")}
      </svg>
    </div>
    <div class="brand-trend-detail-table">
      ${rows.map((item) => `<div class="brand-trend-detail-row ${item.available ? "" : "is-missing"}">
        <span>${esc(monthLabel(item.month))}</span>
        <strong>${item.available ? apiWon(item.value) : "데이터 미확보"}</strong>
        <em>${esc(diffText(item))}</em>
        <small>주문 ${item.orderCount ?? "-"}건 · 수량 ${item.quantitySold ?? "-"}개 · ${esc(item.archiveStatus || "상태 없음")}</small>
      </div>`).join("")}
    </div>
  </section>`;
  if (data.embedded) return body;
  return `<div class="brand-order-popover-head">
    <strong>${esc(data.name || "브랜드 추세")}</strong>
    <button type="button" class="brand-panel-close" data-brand-panel-close aria-label="닫기">×</button>
  </div>
  ${body}`;
}

function showBrandFixedPanel(trigger, html, code, options = {}) {
  const popover = $("#productBrandOrderPopover");
  if (!trigger || !popover) return;
  popover.innerHTML = html;
  popover.hidden = false;
  activeBrandOrderPopoverCode = code;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(options.width || 560, window.innerWidth - 24);
  popover.style.width = `${width}px`;
  const height = Math.min(popover.offsetHeight || 0, window.innerHeight - 24);
  let left = rect.right + 12;
  if (left + width + 12 > window.innerWidth) left = rect.left - width - 12;
  if (left < 12) left = 12;
  let top = rect.top;
  if (top + height + 12 > window.innerHeight) top = window.innerHeight - height - 12;
  if (top < 12) top = 12;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.querySelector("[data-brand-panel-close]")?.addEventListener("click", closeProductBrandOrderPopover, { once: true });
}

function showBrandTrendDetailPanel(trigger) {
  const key = trigger?.dataset.brandTrendDetail || "";
  const data = brandTrendDetailStore.get(key);
  if (!data) return;
  showBrandFixedPanel(trigger, brandTrendDetailPanelHtml(data), `trend:${key}`, { width: 580 });
}

function brandTrendDetailTriggerHtml(item, series, prefix, title) {
  const code = monthlyReportBrandCode(item);
  if (!code) return "";
  const key = monthlyReportBrandTrendKey(prefix, code);
  brandTrendDetailStore.set(key, {
    name: brandPerformanceDisplayName(item),
    title,
    note: monthlyReportBrandTrendCallout(series),
    series
  });
  return `<button type="button" class="monthly-report-brand-trend-trigger" data-brand-trend-detail="${esc(key)}" aria-label="${esc(`${brandPerformanceDisplayName(item)} 월별 추세 상세 보기`)}">${esc(monthlyReportBrandTrendCallout(series))}</button>
    <small class="monthly-report-brand-trend-months">${esc(monthlyReportBrandTrendInlineSummary(series))}</small>`;
}

function monthlyReportBrandSignalsBlock(currentRows, previousRows, reconciliationLabel, trendRows = []) {
  const signals = monthlyReportBrandSignals(currentRows, previousRows);
  if (!signals.length) return "";
  const previousByCode = new Map(previousRows.map((row) => [monthlyReportBrandCode(row), row]));
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
            labelFn: brandPerformanceDisplayName,
            subFn: (item) => monthlyReportDelta(item.currentSales, item.previousSales, apiWon),
            extraFn: (item) => {
              const code = monthlyReportBrandCode(item);
              const series = trendRows.length ? monthlyReportBrandTrendFromRows(trendRows, code) : monthlyReportBrandTrendFromPair("이번", item, "전월", previousByCode.get(code));
              return brandTrendDetailTriggerHtml(item, series, "monthly-rising", "상승 브랜드 월별 실결제 추세");
            },
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
            labelFn: brandPerformanceDisplayName,
            subFn: (item) => monthlyReportDelta(item.currentSales, item.previousSales, apiWon),
            extraFn: (item) => {
              const code = monthlyReportBrandCode(item);
              const series = trendRows.length ? monthlyReportBrandTrendFromRows(trendRows, code) : monthlyReportBrandTrendFromPair("이번", item, "전월", previousByCode.get(code));
              return brandTrendDetailTriggerHtml(item, series, "monthly-falling", "하락 브랜드 월별 실결제 추세");
            },
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
      if (!code || isExcludedBrandPerformance(brand)) return;
      const salesAmount = brandPerformancePaidAmount(brand);
      if (!Number.isFinite(salesAmount)) return;
      const previous = totals.get(code) || {
        brand_code: code,
        brand_name: brandPerformanceDisplayName(brand),
        salesAmount: 0,
        sales: { paidAmount: 0 }
      };
      previous.salesAmount += salesAmount;
      previous.sales.paidAmount += salesAmount;
      totals.set(code, previous);
    });
  });
  return [...totals.values()];
}

function annualArchiveBrandDetailRows(rows = [], brandCode = "") {
  const code = String(brandCode || "").trim();
  const details = [];
  rows.forEach((row) => {
    if (row.failed) return;
    const brand = (row.archive?.commerce?.brandSales || []).find((item) => monthlyReportBrandCode(item) === code);
    const usesSavedSalesFallback = brand && firstFiniteValue(brand?.sales?.paidAmount, brand?.canonicalPaidAmount, brand?.paidAmount) === null;
    (brand?.orderHistory || []).forEach((order) => {
      (order.products || []).forEach((product) => {
        const grossAmount = canonicalGrossAmount(product);
        const discountAmount = canonicalDiscountAmount(product);
        const quantity = Number(product.quantity || 0);
        const productPaidAmount = firstFiniteValue(product?.sales?.paidAmount, product?.canonicalPaidAmount, product?.paidAmount);
        const amountAvailable = !(usesSavedSalesFallback && productPaidAmount === 0 && quantity > 0);
        const paidAmount = amountAvailable ? canonicalPaidAmount(product) : null;
        const discountRate = grossAmount > 0 ? discountAmount / grossAmount * 100 : 0;
        details.push({
          month: row.month,
          orderId: order.orderId || product.orderId || "",
          orderDate: product.orderDate || order.orderDate || "",
          productName: product.productName || product.product_name || "상품명 없음",
          optionName: product.optionName || product.option_name || product.optionText || product.option || "",
          size: product.size || product.optionSize || product.variantSize || "",
          quantity,
          grossAmount,
          discountAmount,
          discountRate,
          paidAmount,
          amountAvailable,
          paymentMethod: product.paymentMethod || ""
        });
      });
    });
  });
  return details
    .filter((item) => item.amountAvailable || item.quantity > 0 || item.orderId)
    .sort((left, right) => {
      const dateDiff = new Date(right.orderDate || 0).getTime() - new Date(left.orderDate || 0).getTime();
      return dateDiff || Number(right.paidAmount || 0) - Number(left.paidAmount || 0);
    });
}

function productOptionLabel(product = {}) {
  const direct = [
    product.optionName,
    product.option_name,
    product.optionText,
    product.option,
    Array.isArray(product.options) ? product.options.map((item) => item?.value || item?.name || item).filter(Boolean).join(" / ") : ""
  ].map((value) => String(value || "").trim()).find(Boolean);
  return direct || "옵션 정보 없음";
}

function productSizeLabel(product = {}) {
  const direct = [
    product.size,
    product.optionSize,
    product.variantSize,
    product.sizeName
  ].map((value) => String(value || "").trim()).find(Boolean);
  return direct || "사이즈 정보 없음";
}

function annualArchiveBrandMonthlySummaries(rows = [], brandCode = "") {
  return rows.map((row) => {
    const details = annualArchiveBrandDetailRows([row], brandCode);
    const brand = (row.archive?.commerce?.brandSales || []).find((item) => monthlyReportBrandCode(item) === brandCode);
    const canonicalAmount = brand ? firstFiniteValue(brand?.sales?.paidAmount, brand?.canonicalPaidAmount, brand?.paidAmount) : null;
    const grossAmount = details.reduce((sum, item) => sum + Number(item.grossAmount || 0), 0);
    const discountAmount = details.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0);
    const paidAmount = brand ? brandPerformancePaidAmount(brand) : 0;
    const quantity = brand ? Number(brand.quantitySold || 0) : details.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const orderCount = brand ? Number(brand.orderCount || 0) : new Set(details.map((item) => item.orderId).filter(Boolean)).size;
    return {
      month: row.month,
      archiveStatus: row.archiveStatus || row.archive?.archiveStatus || "",
      hasData: !row.failed && Array.isArray(row.archive?.commerce?.brandSales),
      hasBrand: !!brand,
      details,
      orderCount,
      quantity,
      grossAmount,
      discountAmount,
      paidAmount,
      amountBasis: canonicalAmount === null ? "saved-sales" : "canonical-paid",
      avgDiscountRate: grossAmount > 0 ? discountAmount / grossAmount * 100 : 0
    };
  });
}

function annualBrandMonthlyTrendSeries(rows = []) {
  return rows.map((row) => ({
    month: row.month,
    value: row.paidAmount,
    available: row.hasData,
    hasBrand: row.hasBrand,
    archiveStatus: row.archiveStatus,
    orderCount: row.orderCount,
    quantitySold: row.quantity
  }));
}

function annualArchiveBrandDetailPopoverHtml(rows = [], brandCode = "") {
  const brand = annualArchiveAggregateBrandSales(rows).find((item) => monthlyReportBrandCode(item) === brandCode) || { brand_code: brandCode };
  const monthlyRows = annualArchiveBrandMonthlySummaries(rows, brandCode);
  const totals = monthlyRows.reduce((summary, item) => {
    summary.orderCount += Number(item.orderCount || 0);
    summary.quantity += Number(item.quantity || 0);
    summary.paidAmount += Number(item.paidAmount || 0);
    return summary;
  }, { orderCount: 0, quantity: 0, paidAmount: 0 });
  return `<div class="brand-order-popover-head"><strong>${esc(brandPerformanceDisplayName(brand))}</strong><span>월별 요약 ${apiNum(monthlyRows.length)}개월</span><button type="button" class="brand-panel-close" data-brand-panel-close aria-label="닫기">×</button></div>
    <section class="brand-order-popover-order">
      <h4>선택 연간 범위</h4>
      <div class="brand-performance-detail-summary">
        <span>누적 브랜드 매출 ${apiWon(totals.paidAmount)}</span>
        <span>확보 데이터 기준</span>
        <span>주문 ${apiNum(totals.orderCount)}건</span>
        <span>수량 ${apiNum(totals.quantity)}개</span>
      </div>
    </section>
    ${brandTrendDetailPanelHtml({
      name: brandPerformanceDisplayName(brand),
      title: "연간 월별 매출 추세",
      note: "월별 실제 결제 또는 저장본 매출 기준",
      series: annualBrandMonthlyTrendSeries(monthlyRows),
      embedded: true
    })}
    <section class="brand-order-popover-order">
      <h4>월별 Drill-down</h4>
      <div class="annual-brand-month-list">
        ${monthlyRows.map((row) => `<button type="button" class="annual-brand-month-row ${row.hasData ? "" : "is-missing"}" data-annual-brand-month-detail="${esc(`${brandCode}|${row.month}`)}">
          <strong>${esc(row.month || "-")}</strong>
          <span>주문 ${apiNum(row.orderCount)}건 · 수량 ${apiNum(row.quantity)}개</span>
          <span>정상가 ${apiWon(row.grossAmount)} · 할인 ${apiWon(row.discountAmount)} · 평균 ${Number(row.avgDiscountRate || 0).toFixed(1)}%</span>
          <em>${row.hasData ? `${row.amountBasis === "canonical-paid" ? "실제 결제 기준" : "저장본 매출 기준"} ${apiWon(row.paidAmount)}${row.amountBasis === "saved-sales" ? " · 실제 결제 상세 미확보" : ""} · ${esc(row.archiveStatus || "archive")}` : "데이터 없음"}</em>
        </button>`).join("")}
      </div>
    </section>`;
}

function annualArchiveBrandMonthDetailPopoverHtml(rows = [], brandCode = "", month = "") {
  const brand = annualArchiveAggregateBrandSales(rows).find((item) => monthlyReportBrandCode(item) === brandCode) || { brand_code: brandCode };
  const monthlyRows = annualArchiveBrandMonthlySummaries(rows, brandCode);
  const summary = monthlyRows.find((item) => item.month === month) || { month, details: [], orderCount: 0, quantity: 0, grossAmount: 0, discountAmount: 0, paidAmount: 0 };
  const details = summary.details || [];
  return `<div class="brand-order-popover-head"><strong>${esc(brandPerformanceDisplayName(brand))}</strong><span>${esc(month || "-")} 상세</span><button type="button" class="brand-panel-close" data-brand-panel-close aria-label="닫기">×</button></div>
    <button type="button" class="monthly-report-brand-trend-trigger" data-annual-brand-summary-back="${esc(brandCode)}">월별 요약으로 돌아가기</button>
    <section class="brand-order-popover-order">
      <h4>${esc(month || "-")} 합계</h4>
      <div class="brand-performance-detail-summary">
        <span>주문 ${apiNum(summary.orderCount)}건</span>
        <span>수량 ${apiNum(summary.quantity)}개</span>
        <span>정상가 ${apiWon(summary.grossAmount)}</span>
        <span>할인 ${apiWon(summary.discountAmount)}</span>
        <span>${summary.amountBasis === "canonical-paid" ? "실제 결제 기준" : "저장본 매출 기준"} ${apiWon(summary.paidAmount)}${summary.amountBasis === "saved-sales" ? " · 실제 결제 상세 미확보" : ""}</span>
      </div>
    </section>
    ${details.length ? details.map((item) => `<section class="brand-order-popover-order">
      <h4>${esc(item.orderDate || "날짜 없음")} · ${esc(item.orderId || "주문 식별값 없음")}</h4>
      <div class="brand-order-popover-product">
        <strong>${esc(item.productName)}</strong>
        <span>옵션 ${esc(productOptionLabel(item))}</span>
        <span>사이즈 ${esc(productSizeLabel(item))}</span>
        <span>수량 ${apiNum(item.quantity)}개 · ${esc(item.paymentMethod || "결제수단 없음")}</span>
        <p>정상 판매금액 ${item.grossAmount === null ? "-" : apiWon(item.grossAmount)}</p>
        <p>할인액 ${item.discountAmount === null ? "-" : apiWon(item.discountAmount)} · ${Number.isFinite(item.discountRate) ? `${item.discountRate.toFixed(1)}%` : "0%"}</p>
        <p>상품 금액 ${item.amountAvailable ? apiWon(item.paidAmount) : "상세 금액 미확보"}</p>
      </div>
    </section>`).join("") : `<p class="hint-text">이 월에는 상세 주문 데이터가 없습니다.</p>`}`;
}

function replaceBrandPanelContent(html) {
  const popover = $("#productBrandOrderPopover");
  if (!popover) return;
  popover.innerHTML = html;
  popover.querySelector("[data-brand-panel-close]")?.addEventListener("click", closeProductBrandOrderPopover, { once: true });
}

function showAnnualBrandMonthDetail(token = "") {
  const [brandCode, month] = String(token || "").split("|");
  if (!brandCode || !month) return;
  activeBrandOrderPopoverCode = `annual:${brandCode}`;
  replaceBrandPanelContent(annualArchiveBrandMonthDetailPopoverHtml(annualBrandPerformanceRows, brandCode, month));
}

function hideAnnualBrandDetailPopover() {
  if (activeBrandOrderPopoverCode && !String(activeBrandOrderPopoverCode).startsWith("annual:")) return;
  closeProductBrandOrderPopover();
}

function showAnnualBrandDetailPopover(trigger) {
  const brandCode = trigger?.dataset.annualBrandDetail || "";
  if (!brandCode) return;
  showBrandFixedPanel(trigger, annualArchiveBrandDetailPopoverHtml(annualBrandPerformanceRows, brandCode), `annual:${brandCode}`, { width: 560 });
}

function bindAnnualBrandDetailTriggers(scope = document) {
  scope.querySelectorAll?.("[data-annual-brand-detail]").forEach((trigger) => {
    if (trigger.dataset.annualBrandBound === "1") return;
    trigger.dataset.annualBrandBound = "1";
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showAnnualBrandDetailPopover(trigger);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      showAnnualBrandDetailPopover(trigger);
    });
  });
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
  annualBrandPerformanceRows = rows;
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
          labelFn: brandPerformanceDisplayName,
          subFn: (item) => annualArchiveComparisonDelta(item.currentSales, item.previousSales),
          extraFn: (item) => {
            const series = monthlyReportBrandTrendFromRows(rows, monthlyReportBrandCode(item));
            return brandTrendDetailTriggerHtml(item, series, "annual-rising", "Annual 상승 브랜드 월별 실결제 추세");
          },
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
          labelFn: brandPerformanceDisplayName,
          subFn: (item) => annualArchiveComparisonDelta(item.currentSales, item.previousSales),
          extraFn: (item) => {
            const series = monthlyReportBrandTrendFromRows(rows, monthlyReportBrandCode(item));
            return brandTrendDetailTriggerHtml(item, series, "annual-falling", "Annual 하락 브랜드 월별 실결제 추세");
          },
          formatValue: (value) => apiWon(value)
        })}
      </div>
    </section>
    <p class="monthly-report-fnote">비교 기준: ${esc(comparisonLabel)} · Saved Archive만 사용하며 Live Draft는 제외합니다.</p>
  ` : "";
  return `<section class="monthly-report-block" data-annual-category="commerce">
    <div class="monthly-report-block-head"><h4>Brand Performance</h4><span>canonical brand · 온라인 + 오프라인 기준</span></div>
    <div class="monthly-report-block-head"><h4>연간 브랜드 매출 TOP5</h4><span>확보 데이터 기준</span></div>
    <div class="monthly-report-rank">
      ${monthlyReportRankRows(annualBrands.slice(0, 5), {
        withBar: true,
        valueFn: (item) => item.salesAmount,
        labelFn: brandPerformanceDisplayName,
        subFn: (item) => monthlyReportBrandCode(item),
        attrsFn: (item) => `tabindex="0" role="button" data-annual-brand-detail="${esc(monthlyReportBrandCode(item))}" aria-label="${esc(`${brandPerformanceDisplayName(item)} 판매 상세 보기`)}"`,
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
  const [settled, brandMasterResult] = await Promise.all([
    Promise.allSettled(months.map((item) => getJson(`/api/reports/monthly?month=${item}`, 8000))),
    getSharedJson("/api/brand-master", 12000)
  ]);
  if (renderSeq !== undefined && renderSeq !== reportsRenderSeq) return;
  registerBrandMasterResponse(brandMasterResult);
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
  bindAnnualBrandDetailTriggers(target);
}

async function renderMonthlyArchiveReport(month, renderSeq) {
  const target = $("#monthlyArchiveReport");
  if (!target) return;

  target.innerHTML = `<article class="action-item"><strong>Monthly Report 확인 중</strong><p>저장된 월간 리포트를 불러오고 있습니다.</p></article>`;

  const previousMonth = previousMonthKey(month);
  const trendMonths = monthlyReportTrendMonths(month);
  const { monthStart, monthEnd } = monthlyReportMonthRange(month);
  const missionParams = new URLSearchParams({ since: monthStart, until: monthEnd, limit: "3" });
  const [archive, previousArchive, missionResult, trendArchiveResults, brandMasterResult, offlineSnapshot] = await Promise.all([
    getJson(`/api/reports/monthly?month=${month}`, 8000),
    previousMonth ? getJson(`/api/reports/monthly?month=${previousMonth}`, 8000) : Promise.resolve({ error: "직전 월 없음" }),
    monthStart && monthEnd ? getJson(intelligenceUrl(`/api/intelligence/missions?${missionParams.toString()}`), 12000) : Promise.resolve({ error: "월 범위 없음" }),
    Promise.allSettled(trendMonths.map((item) => getJson(`/api/reports/monthly?month=${item}`, 8000))),
    getSharedJson("/api/brand-master", 12000),
    getJson(`/api/ecount-sales/monthly?month=${month}`, 8000)
  ]);
  if (renderSeq !== undefined && renderSeq !== reportsRenderSeq) return;
  registerBrandMasterResponse(brandMasterResult);

  if (archive.error) {
    target.innerHTML = `<article class="action-item"><strong>Monthly Report 생성 실패</strong><p>${esc(archive.error)}</p></article>`;
    return;
  }

  // STEP48: archiveStatus는 서버가 이미 계산해 응답에 포함하는 값이다(live=당월 즉석 재계산,
  // saved=저장된 과거 월, draft=아직 저장되지 않은 과거 월). 새 필드를 만들지 않고 그대로 매핑한다.
  // STEP48A: archive.sales.totalSales(server.mjs buildMonthlyArchiveSales)는 Cafe24 온라인
  // LIVE 재계산 값과 ECOUNT 오프라인 SNAPSHOT을 합산한다. "saved"(저장된 과거월)만 더 이상
  // 바뀌지 않는 ARCHIVE이고, "live"/"draft"는 요청마다 이 혼합 계산을 다시 수행하므로 LIVE가
  // 아니라 MIXED로 표시한다(계산 로직은 변경하지 않음, 표시 상태만 재분류).
  const monthlyIsSavedArchive = archive.archiveStatus === "saved";
  renderFreshnessHeader("monthlyFreshnessHeader", {
    status: monthlyIsSavedArchive ? "archive" : "mixed",
    dataAsOf: monthlyIsSavedArchive ? `${month} · 저장된 아카이브` : `${month} · 지금 재계산됨`,
    lastUpdated: archive.generatedAt,
    note: monthlyIsSavedArchive
      ? "저장 시점에 Cafe24 온라인 매출과 ECOUNT 오프라인 매출이 합산되어 더 이상 바뀌지 않습니다."
      : (offlineSnapshot && !offlineSnapshot.error
        ? `Cafe24 온라인 매출은 지금 다시 계산되지만, 오프라인(ECOUNT) 매출은 ${freshnessTimestampLabel(offlineSnapshot.importedAt)} 업로드분까지만 반영되며 자동 동기화되지 않습니다.`
        : "Cafe24 온라인 매출은 지금 다시 계산되지만, 오프라인(ECOUNT) 매출 스냅샷을 확인하지 못했습니다.")
  });

  const commerce = archive.commerce || {};
  const marketing = archive.marketing || {};
  const content = archive.content || {};
  const previousCommerce = previousArchive.error ? {} : previousArchive.commerce || {};
  const previousMarketing = previousArchive.error ? {} : previousArchive.marketing || {};
  const previousContent = previousArchive.error ? {} : previousArchive.content || {};
  const previousBrandSales = previousArchive.error ? [] : previousCommerce.brandSales || [];
  const monthlyBrandTrendRows = trendMonths.map((item, index) => {
    const result = trendArchiveResults[index];
    const trendArchive = result?.status === "fulfilled" ? result.value : {};
    return { month: item, archive: trendArchive, archiveStatus: trendArchive.archiveStatus || "", failed: result?.status !== "fulfilled" || Boolean(trendArchive.error) };
  });
  const paymentMethods = commerce.paymentMethods || [];
  const brandSales = commerce.brandSales || [];
  const productSales = commerce.productSales || [];
  const performanceBrandSales = brandSales
    .filter((item) => !isExcludedBrandPerformance(item))
    .sort((left, right) => brandPerformancePaidAmount(right) - brandPerformancePaidAmount(left));
  // HOTFIX(2026-07-30) — "브랜드 매출 TOP 5" 카드 전용 정렬(온라인 Cafe24 canonical 실제 결제 기준).
  // performanceBrandSales(온라인+오프라인 합산 기준)는 위 브랜드 매출 시그널 블록 등 다른 카드가
  // 그대로 사용하므로 변경하지 않고, TOP5 카드에서만 쓰는 별도 배열을 추가한다.
  const performanceBrandSalesOnline = brandSales
    .filter((item) => !isExcludedBrandPerformance(item))
    .sort((left, right) => brandPerformanceOnlinePaidAmount(right) - brandPerformanceOnlinePaidAmount(left));
  const canonicalProductSales = [...productSales].sort((left, right) => canonicalPaidAmount(right) - canonicalPaidAmount(left));
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
    monthlyReportDirectionText("온라인 실제 매출은", commerce.paidAmount, summaryPreviousCommerce.paidAmount, { formatter: apiWon }),
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
  const offlinePeriodEnd = !offlineSnapshot?.error && /^\d{4}-\d{2}-\d{2}$/.test(String(offlineSnapshot?.periodEnd || ""))
    ? String(offlineSnapshot.periodEnd)
    : "";
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
      ${offlinePeriodEnd ? `<p class="monthly-report-fnote">오프라인 데이터 · ${esc(offlinePeriodEnd)} 기준</p>` : ""}
      <p class="monthly-report-fnote ${hasCanonicalTotalSales && salesCoverageComplete ? "" : "monthly-report-muted"}">${esc(salesCoverageNote)}</p>
    </section>
  ` : "";
  const brandSignalsBlock = brandSales.length && previousBrandSales.length
    ? monthlyReportBrandSignalsBlock(performanceBrandSales, previousBrandSales, reconciliationLabel, monthlyBrandTrendRows)
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
          <span>온라인 실제 매출 · Cafe24 실제 결제 기준</span>
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
          <div class="monthly-report-block-head"><h4>브랜드 매출 TOP 5</h4><span>온라인 실결제 기준</span></div>
          <div class="monthly-report-rank">
            ${monthlyReportRankRows(performanceBrandSalesOnline.slice(0, 5), {
              withBar: true,
              valueFn: brandPerformanceOnlinePaidAmount,
              labelFn: brandPerformanceDisplayName,
              subFn: (item) => item.brand_code || "",
              formatValue: (value) => apiWon(value)
            })}
          </div>
        </section>
      </div>
      <section class="monthly-report-block">
        <div class="monthly-report-block-head"><h4>상품 매출 TOP 5</h4><span>온라인 실결제 기준</span></div>
        <div class="monthly-report-rank">
          ${monthlyReportRankRows(canonicalProductSales.slice(0, 5), {
            withBar: false,
            valueFn: canonicalPaidAmount,
            labelFn: (item) => item.productName || item.product_name || "-",
            subFn: (item) => brandCanonicalDisplayName(item),
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
  $("#metaProductPerformanceSummary").innerHTML = `<article class="action-item"><strong>Meta Product Performance 확인 중</strong><p>Meta 구매 상품을 Cafe24와 연결하고 있습니다.</p></article>`;
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

function renderSettingsCacheStatus({ instagram = {}, meta = {}, cafe = {} } = {}) {
  const target = $("#settingsCacheStatus");
  if (!target) return;
  target.innerHTML = [
    ["Instagram", instagram, "instagram"],
    ["Meta Ads", meta, "meta"],
    ["Cafe24", cafe, "cafe24"]
  ].map(([label, data, kind]) => {
    const state = healthBannerState(data, kind);
    return homeActivityCard(label, state.label, state.reason || "상태 확인 필요", formatSyncStamp(data.syncedAt) || "-", state.tone);
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
  const decisionCenterTarget = $("#adDecisionCenter");
  const salesAnalysisTarget = $("#adCampaignSalesAnalysis");
  const fullReportTargets = {
    active: $("#adFullReportActiveRows"),
    other: $("#adFullReportOtherRows")
  };
  bindAdFullReportToggles();
  if (!briefingTarget || !statusTarget || !coreKpiTarget || !summaryTarget || !campaignTarget || !contentTarget || !tableTarget || !reconTarget || !decisionCenterTarget || !salesAnalysisTarget || !fullReportTargets.active || !fullReportTargets.other) return;
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
    decisionCenterTarget.innerHTML = `<article class="action-item"><strong>Decision Center 확인 불가</strong><p>Meta API 오류가 해결되면 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    salesAnalysisTarget.innerHTML = `<article class="action-item"><strong>Campaign Sales Analysis 확인 불가</strong><p>Meta API 오류가 해결되면 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    const metaProductPerformanceSummaryTarget = $("#metaProductPerformanceSummary");
    const metaProductPerformanceRowsTarget = $("#metaProductPerformanceRows");
    if (metaProductPerformanceSummaryTarget) metaProductPerformanceSummaryTarget.innerHTML = `<article class="action-item"><strong>Meta Product Performance 확인 불가</strong><p>Meta API 오류가 해결되면 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    if (metaProductPerformanceRowsTarget) metaProductPerformanceRowsTarget.innerHTML = `<tr><td colspan="4">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    const metaBrandContributionSummaryTarget = $("#metaBrandContributionSummary");
    const metaBrandContributionRowsTarget = $("#metaBrandContributionRows");
    if (metaBrandContributionSummaryTarget) metaBrandContributionSummaryTarget.innerHTML = `<article class="action-item"><strong>Brand Contribution 확인 불가</strong><p>Meta API 오류가 해결되면 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    if (metaBrandContributionRowsTarget) metaBrandContributionRowsTarget.innerHTML = `<tr><td colspan="6">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    summaryTarget.innerHTML = [
      `<article class="action-item"><strong>Meta API 상태</strong><span>${esc(status)}</span><p>${esc(meta.error)}</p></article>`,
      `<article class="action-item"><strong>권한 오류 안내</strong><p>Meta API 권한 또는 토큰 권한이 막히면 광고 성과를 불러올 수 없습니다. Settings의 Meta Ads 연결 상태를 확인하세요. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`
    ].join("");
    campaignTarget.innerHTML = `<article class="action-item"><strong>캠페인별 성과</strong><p>Meta API 오류가 해결되면 캠페인 기준 성과가 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    tableTarget.innerHTML = `<tr><td colspan="11">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    reconTarget.innerHTML = `<article class="action-item"><strong>검증 불가</strong><p>Meta API 오류가 해결되면 표시됩니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    fullReportTargets.active.innerHTML = `<tr><td colspan="18">Meta 광고 데이터를 불러오지 못했습니다.</td></tr>`;
    fullReportTargets.other.innerHTML = "";
    contentTarget.innerHTML = "";
    renderMarketingSummary({ meta, fullReport, commerce, adSpendShare: null, briefingTarget, reconTarget, periodLabel: `${startDate} ~ ${endDate}` });
    return;
  }

  const briefingCount = renderAdAiBriefing(fullReport, scoreWeights, briefingTarget);
  renderAdDecisionCenter(decisionCenterTarget, fullReport, scoreWeights, startDate, endDate);
  renderCampaignSalesAnalysis(salesAnalysisTarget, fullReport, renderSeq);
  renderMetaProductPerformance(startDate, endDate, renderSeq);

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
      brandName: brandCanonicalDisplayName({ brand_code: code, brand_name: current.brand_name || previous.brand_name }),
      salesDelta: currentSales - previousSales,
      orderDelta: Number(current.orderCount || 0) - Number(previous.orderCount || 0),
      quantityDelta: Number(current.quantitySold || 0) - Number(previous.quantitySold || 0)
    };
  }).filter((row) => !isExcludedCommerceBrandPerformanceCode(row.brandCode) && (row.salesDelta || row.orderDelta || row.quantityDelta));
  const increaseTop = brandRows.filter((row) => row.salesDelta > 0).sort((left, right) => right.salesDelta - left.salesDelta).slice(0, 5);
  const decreaseTop = brandRows.filter((row) => row.salesDelta < 0).sort((left, right) => left.salesDelta - right.salesDelta).slice(0, 5);
  const executionTotals = execution.totals || {};
  const comparisonTotals = comparison.totals || {};
  const basePaidAmount = hasApiValue(comparisonTotals.paidAmount) ? Number(comparisonTotals.paidAmount) : null;
  const targetPaidAmount = hasApiValue(executionTotals.paidAmount) ? Number(executionTotals.paidAmount) : null;
  if (!Number.isFinite(basePaidAmount) || !Number.isFinite(targetPaidAmount)) {
    target.innerHTML = `<article class="action-item"><strong>기간 비교 확인 불가</strong><p>실제 결제액 데이터를 불러오지 못해 기간 비교를 표시할 수 없습니다. 기간을 바꾸거나 잠시 후 다시 시도해주세요.</p></article>`;
    return;
  }
  const salesDelta = targetPaidAmount - basePaidAmount;
  const orderDelta = Number(executionTotals.orderCount || 0) - Number(comparisonTotals.orderCount || 0);
  const quantityDelta = Number(executionTotals.quantitySold || 0) - Number(comparisonTotals.quantitySold || 0);
  const salesTone = salesDelta > 0 ? "good" : salesDelta < 0 ? "urgent" : "neutral";
  const salesDirection = salesDelta > 0 ? "증가" : salesDelta < 0 ? "감소" : "변화 없음";
  const comparisonSales = basePaidAmount;
  const executionSales = targetPaidAmount;
  const salesNarrative = `${baseLabel}에 비해 ${targetLabel} 매출이 ${campaignComparisonRate(salesDelta, comparisonSales)} ${salesDirection}했습니다.`;
  const executionMetaTotals = executionMeta?.totals || {};
  const comparisonMetaTotals = comparisonMeta?.totals || {};
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

// ===== Advertising Decision Center · Phase M1 =====
// 목표: "지금 이 광고를 어떻게 운영해야 하는가"를 이번 기간 실제 집행 캠페인끼리의
// 상대 비교(중앙값/분위수)로만 판단합니다. 업계 고정 기준값을 쓰지 않고, 이미
// renderAdvertising()이 받아온 fullReport를 그대로 재사용합니다(새 API 호출 없음).
// 캠페인 모집단 정의는 metaAdsIsExecuted()를 그대로 재사용합니다.
//
// Phase M1-3: Objective(sales/traffic/awareness)별로 비교 모집단과 핵심 지표를
// 분리합니다. "광고 중단"은 각 Objective 판단 체인의 가장 마지막에만 등장하는
// 보수적 결론이고, Traffic/Awareness는 Purchase·ROAS를 판단 근거로 쓰지 않습니다.

const AD_DECISION_CENTER_MIN_PEERS = 3;
const AD_DECISION_CENTER_MAX_CARDS = 5;

// 카드 정렬/요약 카운트에 쓰는 우선순위(급한 것부터).
const AD_DECISION_CENTER_PRIORITY = ["광고 중단", "광고 소재 교체", "광고 개선", "관찰", "유지", "확대"];
const AD_DECISION_CENTER_TONE = {
  "확대": "good",
  "유지": "good",
  "관찰": "warn",
  "광고 소재 교체": "warn",
  "광고 개선": "warn",
  "광고 중단": "urgent"
};

// Objective별로 비교에 쓰는 핵심 지표 목록. 여기 없는 objective(engagement/video/
// unknown 등)는 지원 대상이 아니라고 보고 보수적으로 "관찰" 처리합니다.
const AD_DECISION_CENTER_OBJECTIVE_METRICS = {
  sales: ["roas", "ctr", "frequency", "conversionRate", "spend"],
  traffic: ["ctr", "frequency", "cpc", "lpvRate", "spend"],
  awareness: ["reach", "cpm", "frequency", "ctr", "spend"]
};

function adDecisionCenterValues(rows, selector) {
  return rows.map(selector).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
}

function adDecisionCenterQuantile(sortedValues, q) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedValues[base + 1];
  return next !== undefined ? sortedValues[base] + rest * (next - sortedValues[base]) : sortedValues[base];
}

function adDecisionCenterMedian(sortedValues) {
  return adDecisionCenterQuantile(sortedValues, 0.5);
}

// row에서 지표 하나를 안전하게 읽습니다. roas/lpvRate는 계산이 필요하거나 null이 될
// 수 있어 별도 분기로 처리합니다.
function adDecisionCenterMetricValue(row, metric) {
  if (metric === "roas") return row.roas === null || row.roas === undefined ? NaN : Number(row.roas);
  if (metric === "lpvRate") {
    const clicks = Number(row.clicks || 0);
    return clicks > 0 ? Number(row.landingPageViews || 0) / clicks : NaN;
  }
  return Number(row[metric] || 0);
}

// 값이 그 지표의 중앙값/분위수 대비 어디에 있는지 판정합니다. 비교할 중앙값 자체가
// 없거나(모집단 부족) 값이 계산 불가(NaN)면 전부 false로 안전하게 처리합니다.
function adDecisionCenterCompare(value, stat) {
  if (!stat || stat.median === null || !Number.isFinite(value)) {
    return { belowMedian: false, aboveMedian: false, topTier: false, bottomTier: false };
  }
  return {
    belowMedian: value < stat.median,
    aboveMedian: value > stat.median,
    topTier: stat.p75 !== null && value >= stat.p75,
    bottomTier: stat.p25 !== null && value <= stat.p25
  };
}

// 캠페인 집합 하나(같은 objective끼리)의 지표별 중앙값/P25/P75 — 고정 업계 기준값이
// 아니라 그때그때 실제 데이터로 다시 계산됩니다.
function adDecisionCenterBuildStats(rows, metrics) {
  const stats = { count: rows.length };
  metrics.forEach((metric) => {
    const values = adDecisionCenterValues(rows, (row) => adDecisionCenterMetricValue(row, metric));
    stats[metric] = {
      median: adDecisionCenterMedian(values),
      p25: adDecisionCenterQuantile(values, 0.25),
      p75: adDecisionCenterQuantile(values, 0.75)
    };
  });
  return stats;
}

// 전체 캠페인을 한 모집단으로 섞지 않고, sales/traffic/awareness별로 나눠 각자의
// Peer Stats를 계산합니다. 같은 objective끼리만 상대 비교하기 위함입니다.
function adDecisionCenterPeerStatsByObjective(executedRows) {
  const groups = { sales: [], traffic: [], awareness: [] };
  executedRows.forEach((row) => {
    if (groups[row.objective]) groups[row.objective].push(row);
  });
  const result = {};
  Object.keys(groups).forEach((objective) => {
    result[objective] = adDecisionCenterBuildStats(groups[objective], AD_DECISION_CENTER_OBJECTIVE_METRICS[objective]);
  });
  return result;
}

// 데이터 부족(=관찰) 우선 판정. 여기 해당하면 아래 objective별 성과 비교 로직은
// 아예 적용하지 않습니다 — spend가 적다는 이유만으로, 또는 동일 objective 표본이
// 부족한 상태로 "중단"이 나오는 것을 구조적으로 막습니다.
function adDecisionCenterExecutionDays(row, periodStart, periodEnd) {
  if (
    !campaignComparisonIsValidDateKey(row.executionStart)
    || !campaignComparisonIsValidDateKey(row.executionEnd)
    || !campaignComparisonIsValidDateKey(periodStart)
    || !campaignComparisonIsValidDateKey(periodEnd)
  ) return null;
  const overlapStart = row.executionStart > periodStart ? row.executionStart : periodStart;
  const overlapEnd = row.executionEnd < periodEnd ? row.executionEnd : periodEnd;
  return overlapStart > overlapEnd ? 0 : campaignComparisonInclusiveDays(overlapStart, overlapEnd);
}

function adDecisionCenterInsufficiency(row, statsByObjective, periodDays, execDays) {
  const reasons = [];
  const objective = row.objective;
  const objectiveLabel = metaAdsObjectiveLabel(row);
  if (!AD_DECISION_CENTER_OBJECTIVE_METRICS[objective]) {
    reasons.push(`지원 대상 Objective(Sales/Traffic/Awareness)가 아니어서(${objectiveLabel}) 보수적으로 판단을 보류합니다.`);
    return reasons;
  }
  const objStats = statsByObjective[objective];
  if (!objStats || objStats.count < AD_DECISION_CENTER_MIN_PEERS) {
    reasons.push(`동일 Objective(${objectiveLabel}) 집행 캠페인이 3개 미만이라 상대 비교 신뢰도가 낮습니다.`);
    return reasons;
  }
  if (execDays !== null && periodDays > 0 && execDays / periodDays < 0.3) {
    reasons.push(`집행 기간이 ${execDays}일로 짧습니다(선택 기간 ${periodDays}일 중).`);
  }
  const spend = Number(row.spend || 0);
  if (objStats.spend.p25 !== null && spend <= objStats.spend.p25) {
    reasons.push(`광고비가 동일 Objective(${objectiveLabel}) 집행 캠페인 중 하위권입니다.`);
  }
  return reasons;
}

// Sales: ROAS/Purchase/전환율을 판단 근거로 씁니다. "광고 중단"은 CTR·전환율·ROAS·
// 구매가 동시에 부진할 때만 최후에 등장합니다.
function adDecisionCenterClassifySales(row, stats) {
  const ctr = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "ctr"), stats.ctr);
  const freq = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "frequency"), stats.frequency);
  const roasVal = adDecisionCenterMetricValue(row, "roas");
  const roas = adDecisionCenterCompare(roasVal, stats.roas);
  const cvr = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "conversionRate"), stats.conversionRate);
  const spend = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "spend"), stats.spend);
  const purchasesPositive = Number(row.purchases || 0) > 0;
  const roasKnown = Number.isFinite(roasVal);

  if (ctr.belowMedian && freq.aboveMedian) {
    return {
      label: "광고 소재 교체",
      reasons: [
        "CTR이 동일 목적(Sales) 캠페인 중앙값보다 낮습니다.",
        "Frequency가 동일 목적 캠페인 중앙값보다 높습니다.",
        "반복 노출로 소재 피로 가능성이 있습니다."
      ],
      action: "첫 이미지 또는 영상 오프닝을 교체하거나 후킹 카피를 바꿔보세요."
    };
  }
  if (!ctr.belowMedian && (cvr.belowMedian || !purchasesPositive)) {
    const reasons = ["클릭 반응(CTR)은 나쁘지 않습니다."];
    if (cvr.belowMedian) reasons.push("전환율(Conversion Rate)이 동일 목적 캠페인 중앙값보다 낮습니다.");
    if (!purchasesPositive) reasons.push("클릭 이후 구매로 이어지지 않고 있습니다.");
    reasons.push("소재보다 랜딩페이지·구매 퍼널 점검이 우선입니다.");
    return { label: "광고 개선", reasons: reasons.slice(0, 3), action: "랜딩페이지 또는 구매 퍼널을 점검하세요." };
  }
  if (roas.topTier && purchasesPositive && !ctr.belowMedian && !freq.aboveMedian) {
    return {
      label: "확대",
      reasons: [
        "ROAS가 동일 목적(Sales) 캠페인 중 상위권입니다.",
        "구매가 꾸준히 발생하고 있습니다.",
        "CTR과 Frequency가 모두 안정적인 범위입니다."
      ],
      action: "예산 확대를 검토하세요."
    };
  }
  if (!ctr.belowMedian && !freq.aboveMedian && (purchasesPositive || roasKnown)) {
    return {
      label: "유지",
      reasons: [
        "CTR·Frequency가 동일 목적(Sales) 캠페인 범위 안에서 안정적입니다.",
        purchasesPositive ? "구매가 발생하고 있습니다." : "ROAS 기준으로 특별한 이상 신호가 없습니다."
      ],
      action: "현재 운영을 유지하세요."
    };
  }
  const roasBad = !roasKnown || roas.belowMedian;
  if (spend.topTier && !purchasesPositive && roasBad && ctr.belowMedian && cvr.belowMedian) {
    return {
      label: "광고 중단",
      reasons: [
        "충분한 기간과 예산이 사용되었습니다.",
        "동일 목적(Sales) 캠페인 대비 CTR·전환율·ROAS가 전반적으로 낮고 구매가 없습니다.",
        "소재 교체 또는 랜딩 개선만으로 회복될 신호도 부족합니다."
      ],
      action: "현재 집행 중단을 검토하고 남은 예산을 성과 우수 캠페인으로 이동하세요."
    };
  }
  return {
    label: "관찰",
    reasons: ["성과 신호가 애매해 단정하기 이릅니다.", "중단을 확정할 만큼 근거가 충분하지 않습니다."],
    action: "조금 더 데이터를 확보하세요."
  };
}

// Traffic: Purchase/ROAS를 전혀 쓰지 않습니다. CTR/CPC/랜딩페이지 도달 비율/
// Frequency로만 판단합니다.
function adDecisionCenterClassifyTraffic(row, stats) {
  const ctr = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "ctr"), stats.ctr);
  const freq = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "frequency"), stats.frequency);
  const cpc = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "cpc"), stats.cpc);
  const lpv = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "lpvRate"), stats.lpvRate);
  const spend = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "spend"), stats.spend);

  if (ctr.belowMedian && freq.aboveMedian) {
    return {
      label: "광고 소재 교체",
      reasons: [
        "CTR이 동일 목적(Traffic) 캠페인 중앙값보다 낮습니다.",
        "Frequency가 동일 목적 캠페인 중앙값보다 높습니다.",
        "반복 노출로 소재 피로 가능성이 있습니다."
      ],
      action: "첫 이미지 또는 영상 오프닝을 교체하거나 새 비주얼 소재를 테스트하세요."
    };
  }
  if (!ctr.belowMedian && (lpv.belowMedian || cpc.topTier)) {
    const reasons = ["클릭 반응(CTR)은 나쁘지 않습니다."];
    if (lpv.belowMedian) reasons.push("클릭 대비 랜딩페이지 도달 비율이 동일 목적 캠페인 중앙값보다 낮습니다.");
    if (cpc.topTier) reasons.push("CPC가 동일 목적 캠페인 중 상위권(비쌈)입니다.");
    reasons.push("소재보다 링크·랜딩·타겟 점검이 우선입니다.");
    return { label: "광고 개선", reasons: reasons.slice(0, 3), action: "링크·랜딩페이지·타겟 설정을 점검하세요." };
  }
  if (ctr.topTier && cpc.bottomTier && !lpv.belowMedian && !freq.aboveMedian) {
    return {
      label: "확대",
      reasons: [
        "CTR이 동일 목적(Traffic) 캠페인 중 상위권입니다.",
        "CPC가 동일 목적 캠페인 중 하위권(저렴)입니다.",
        "랜딩페이지 도달 비율과 Frequency도 안정적입니다."
      ],
      action: "예산 확대를 검토하세요."
    };
  }
  if (!ctr.belowMedian && !cpc.topTier && !lpv.belowMedian && !freq.aboveMedian) {
    return {
      label: "유지",
      reasons: [
        "CTR·CPC·랜딩페이지 도달 비율이 동일 목적(Traffic) 캠페인 범위 안에서 안정적입니다.",
        "Frequency도 특별히 높지 않습니다."
      ],
      action: "현재 운영을 유지하세요."
    };
  }
  if (spend.topTier && ctr.belowMedian && cpc.topTier && lpv.belowMedian) {
    return {
      label: "광고 중단",
      reasons: [
        "충분한 기간과 예산이 사용되었습니다.",
        "동일 목적(Traffic) 캠페인 대비 CTR·CPC·랜딩페이지 도달 비율이 전반적으로 낮습니다.",
        "소재 교체 또는 랜딩 개선만으로 설명되지 않는 전반적 부진입니다."
      ],
      action: "현재 집행 중단을 검토하고 남은 예산을 성과 우수 캠페인으로 이동하세요."
    };
  }
  return {
    label: "관찰",
    reasons: ["성과 신호가 애매해 단정하기 이릅니다.", "중단을 확정할 만큼 근거가 충분하지 않습니다."],
    action: "조금 더 데이터를 확보하세요."
  };
}

// Awareness: Purchase/ROAS를 전혀 쓰지 않습니다. Reach/CPM/Frequency/CTR로만
// 판단합니다.
function adDecisionCenterClassifyAwareness(row, stats) {
  const ctr = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "ctr"), stats.ctr);
  const freq = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "frequency"), stats.frequency);
  const cpm = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "cpm"), stats.cpm);
  const reach = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "reach"), stats.reach);
  const spend = adDecisionCenterCompare(adDecisionCenterMetricValue(row, "spend"), stats.spend);

  if (freq.aboveMedian && ctr.belowMedian) {
    return {
      label: "광고 소재 교체",
      reasons: [
        "Frequency가 동일 목적(Awareness) 캠페인 중앙값보다 높습니다.",
        "CTR이 동일 목적 캠페인 중앙값보다 낮습니다.",
        "반복 노출로 소재 피로 가능성이 있습니다."
      ],
      action: "새 비주얼 소재로 교체하거나 노출 빈도를 조정하세요."
    };
  }
  if (reach.topTier && !cpm.topTier && !freq.aboveMedian) {
    return {
      label: "확대",
      reasons: [
        "Reach가 동일 목적(Awareness) 캠페인 중 상위권입니다.",
        "CPM이 상대적으로 효율적입니다.",
        "Frequency도 과도하지 않습니다."
      ],
      action: "예산 확대를 검토하세요."
    };
  }
  if (!reach.bottomTier && !cpm.topTier && !freq.aboveMedian) {
    return {
      label: "유지",
      reasons: [
        "Reach와 CPM이 동일 목적(Awareness) 캠페인 범위 안에서 안정적입니다.",
        "Frequency도 특별히 높지 않습니다."
      ],
      action: "현재 운영을 유지하세요."
    };
  }
  if (spend.topTier && reach.bottomTier && cpm.topTier && ctr.belowMedian) {
    return {
      label: "광고 중단",
      reasons: [
        "충분한 기간과 예산이 사용되었습니다.",
        "동일 목적(Awareness) 캠페인 대비 Reach 효율·CPM·CTR이 전반적으로 낮습니다.",
        "단순 소재 피로만으로 설명되지 않는 전반적 부진입니다."
      ],
      action: "현재 집행 중단을 검토하고 남은 예산을 성과 우수 캠페인으로 이동하세요."
    };
  }
  return {
    label: "관찰",
    reasons: ["성과 신호가 애매해 단정하기 이릅니다.", "중단을 확정할 만큼 근거가 충분하지 않습니다."],
    action: "조금 더 데이터를 확보하세요."
  };
}

// Objective별 판단 함수로 분기합니다(우선순위: 소재 교체 → 개선 → 확대 → 유지 →
// 관찰 → 중단[최후]는 각 objective 함수 내부에 이 순서로 구현돼 있습니다).
function adDecisionCenterClassify(row, stats) {
  if (row.objective === "sales") return adDecisionCenterClassifySales(row, stats);
  if (row.objective === "traffic") return adDecisionCenterClassifyTraffic(row, stats);
  if (row.objective === "awareness") return adDecisionCenterClassifyAwareness(row, stats);
  return {
    label: "관찰",
    reasons: ["지원 대상 Objective가 아니어서 판단을 보류합니다."],
    action: "Objective를 확인한 뒤 다시 검토하세요."
  };
}

function adDecisionCenterConfidence(periodDays, execDays, insufficiencyReasons) {
  if (insufficiencyReasons.length) return { label: "낮음", note: insufficiencyReasons[0] };
  const coverage = execDays !== null && periodDays > 0 ? execDays / periodDays : null;
  if (coverage !== null && coverage >= 0.6) return { label: "높음", note: `선택 기간 중 ${execDays}일 집행` };
  return { label: "보통", note: coverage !== null ? `선택 기간 중 ${execDays}일 집행` : "집행 기간 확인 필요" };
}

// 캠페인 단위 판단 1건 계산. metaAdsIsExecuted()로 이미 걸러진 executed 캠페인만
// 넘겨받는다고 가정합니다.
function adDecisionCenterEvaluate(row, statsByObjective, periodDays, periodStart, periodEnd) {
  const execDays = adDecisionCenterExecutionDays(row, periodStart, periodEnd);
  const insufficiencyReasons = adDecisionCenterInsufficiency(row, statsByObjective, periodDays, execDays);
  const dataInsufficient = insufficiencyReasons.length > 0;
  const decision = dataInsufficient
    ? { label: "관찰", reasons: insufficiencyReasons.slice(0, 3), action: "조금 더 데이터를 확보하세요." }
    : adDecisionCenterClassify(row, statsByObjective[row.objective]);

  const reasons = decision.reasons.slice(0, 3);
  if (reasons.length < 3) {
    // metaAdsNarrative()를 그대로 재사용해 근거가 부족한 경우(주로 "유지")만 보충합니다.
    const narrative = metaAdsNarrative(row);
    if (narrative && !reasons.includes(narrative)) reasons.push(narrative);
  }

  return {
    row,
    label: decision.label,
    tone: AD_DECISION_CENTER_TONE[decision.label] || "warn",
    reasons: reasons.slice(0, 3),
    action: decision.action,
    confidence: adDecisionCenterConfidence(periodDays, execDays, insufficiencyReasons),
    dataInsufficient
  };
}

// fullReport(이미 renderAdvertising()이 받아온 데이터)만으로 Decision Center 카드
// 목록을 계산합니다. 새 API 호출이 없습니다.
function adDecisionCenterCompute(fullReport = {}, scoreWeights = {}, periodStart = "", periodEnd = "") {
  if (fullReport.error) return { error: fullReport.error, empty: false, cards: [], counts: {} };
  const executed = (fullReport.rows || []).filter((row) => metaAdsIsExecuted(row));
  if (!executed.length) return { error: null, empty: true, cards: [], counts: {} };

  const periodDays = campaignComparisonIsValidDateKey(periodStart) && campaignComparisonIsValidDateKey(periodEnd)
    ? campaignComparisonInclusiveDays(periodStart, periodEnd)
    : 0;
  const statsByObjective = adDecisionCenterPeerStatsByObjective(executed);

  const cards = executed
    .map((row) => adDecisionCenterEvaluate(row, statsByObjective, periodDays, periodStart, periodEnd))
    .map((card) => ({ ...card, score: metaAdsPerformanceScore(card.row, scoreWeights) }));

  cards.sort((left, right) => {
    const priorityDiff = AD_DECISION_CENTER_PRIORITY.indexOf(left.label) - AD_DECISION_CENTER_PRIORITY.indexOf(right.label);
    if (priorityDiff !== 0) return priorityDiff;
    return Number(right.row.spend || 0) - Number(left.row.spend || 0);
  });

  const counts = AD_DECISION_CENTER_PRIORITY.reduce((acc, label) => {
    acc[label] = cards.filter((card) => card.label === label).length;
    return acc;
  }, {});

  return { error: null, empty: false, cards, counts };
}

function adDecisionCenterCardHtml(card) {
  const reasonItems = card.reasons.map((reason) => `<li>${esc(reason)}</li>`).join("");
  return `<article class="ad-ai-briefing-card ad-decision-card ${esc(card.tone)}">
    <div class="ad-ai-briefing-head">
      <span class="ad-judgment-pill ${esc(card.tone)}">${esc(card.label)}</span>
      <strong class="ad-decision-card-name" title="${esc(card.row.campaignName || "-")}">${esc(card.row.campaignName || "-")}</strong>
    </div>
    <ul class="ad-decision-reasons">${reasonItems}</ul>
    <p class="ad-decision-action"><span>권장 행동</span>${esc(card.action)}</p>
    <p class="ad-decision-meta">
      <span>신뢰도 ${esc(card.confidence.label)}${card.confidence.note ? ` · ${esc(card.confidence.note)}` : ""}</span>
      <span>데이터 부족 ${card.dataInsufficient ? "예" : "아니오"}</span>
      ${card.score === null || card.score === undefined ? "" : `<span title="Meta 자체 귀속 지표 기준, Commerce 매출 미반영">참고 성과 점수 ${card.score}점</span>`}
    </p>
  </article>`;
}

function adDecisionCenterSummaryHtml(counts = {}) {
  return AD_DECISION_CENTER_PRIORITY
    .filter((label) => counts[label] > 0)
    .map((label) => `<span class="badge ${esc(AD_DECISION_CENTER_TONE[label] || "warn")}">${esc(label)} ${counts[label]}건</span>`)
    .join("");
}

function renderAdDecisionCenter(target, fullReport, scoreWeights, periodStart, periodEnd) {
  if (!target) return;
  const result = adDecisionCenterCompute(fullReport, scoreWeights, periodStart, periodEnd);
  if (result.error) {
    target.innerHTML = `<article class="action-item"><strong>Decision Center 확인 불가</strong><p>${esc(result.error)}</p></article>`;
    return;
  }
  if (result.empty) {
    target.innerHTML = `<p class="hint-text">이번 기간에 집행된 캠페인이 없습니다.</p>`;
    return;
  }
  const shown = result.cards.slice(0, AD_DECISION_CENTER_MAX_CARDS);
  target.innerHTML = `
    <div class="ad-decision-summary">${adDecisionCenterSummaryHtml(result.counts)}</div>
    <div class="ad-ai-briefing">${shown.map((card) => adDecisionCenterCardHtml(card)).join("")}</div>
    ${result.cards.length > shown.length ? `<p class="hint-text">우선순위 상위 ${shown.length}개만 표시합니다. 전체 캠페인은 아래 Campaign Full Report에서 확인하세요.</p>` : ""}
  `;
}

// ===== Campaign Sales Analysis · Phase A =====
// 광고 효과를 증명(Attribution)하지 않습니다. 이미 renderAdvertising()이 받아온 fullReport의
// 캠페인별 실제 집행 기간(executionStart~executionEnd)과 겹치는 Cafe24 실제 판매를 함께
// 관찰하는 참고 자료입니다. 새 API는 추가하지 않고, Commerce 기간 비교(renderCampaignPeriodComparison)
// 에서 이미 쓰고 있는 /api/diagnostics/brand-sales?since=&until=를 캠페인별 날짜로 재호출합니다
// (campaignComparison* 헬퍼도 그대로 재사용). 문장은 항상 관찰 기반으로만 씁니다 — "때문에",
// "효과", "만들었습니다" 같은 인과 단정 표현은 쓰지 않습니다.
const AD_SALES_ANALYSIS_MAX_CAMPAIGNS = 5;
const AD_SALES_ANALYSIS_TOP_PRODUCTS = 10;
const AD_SALES_ANALYSIS_CONCENTRATION_THRESHOLD = 0.2;
const AD_SALES_ANALYSIS_BRAND_THRESHOLD = 0.35;

// 광고비 상위 N개 집행 캠페인만 분석합니다(Decision Center의 AD_DECISION_CENTER_MAX_CARDS와
// 같은 원칙 — 캠페인 하나마다 Cafe24 조회가 추가로 발생하므로 무제한으로 늘리지 않습니다).
// 실제 집행 기간(executionStart/executionEnd)이 유효한 캠페인만 대상으로 합니다.
function adSalesAnalysisSelectCampaigns(fullReport = {}) {
  const rows = Array.isArray(fullReport.rows) ? fullReport.rows : [];
  return rows
    .filter((row) => metaAdsIsExecuted(row))
    .filter((row) => campaignComparisonIsValidDateKey(row.executionStart) && campaignComparisonIsValidDateKey(row.executionEnd))
    .sort((left, right) => Number(right.spend || 0) - Number(left.spend || 0))
    .slice(0, AD_SALES_ANALYSIS_MAX_CAMPAIGNS);
}

function adSalesAnalysisAvgLabel(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${Number(value).toFixed(1)}개`;
}

// Cafe24 brand-sales의 products[] 한 행을 카드/표에 쓸 형태로 정리합니다. 브랜드명은 새 로직을
// 만들지 않고 이미 있는 brandCanonicalDisplayName() 공통 함수를 그대로 재사용합니다.
function adSalesAnalysisProductRow(product = {}) {
  const quantitySold = Number(product.quantitySold || 0);
  const salesAmount = canonicalPaidAmount(product);
  const orderCount = Number(product.orderCount || 0);
  return {
    key: String(product.productNo || product.productCode || product.productName || ""),
    productName: product.productName || "상품명 확인 불가",
    brandName: brandCanonicalDisplayName(product),
    quantitySold,
    salesAmount,
    orderCount,
    avgPrice: quantitySold > 0 ? salesAmount / quantitySold : null
  };
}

// 판매금액 기준 TOP N. "많이 팔렸다"를 판매수량이 아니라 판매금액 기준으로 줄 세우는 이유는,
// 이 프로젝트 전반(Commerce/Monthly Report TOP 브랜드 등)이 이미 salesAmount를 canonical
// 랭킹 기준으로 쓰고 있어 화면마다 기준이 갈리지 않도록 통일한 것입니다.
function adSalesAnalysisTopProducts(products = [], limit = AD_SALES_ANALYSIS_TOP_PRODUCTS) {
  return products
    .filter((p) => Number(p.quantitySold || 0) > 0 || canonicalPaidAmount(p) > 0)
    .map((p) => adSalesAnalysisProductRow(p))
    .sort((a, b) => b.salesAmount - a.salesAmount)
    .slice(0, limit);
}

// 판매가 특정 상품/브랜드에 집중되었는지, 여러 상품에 분산되었는지 판단하기 위한 집중도 계산.
// 고정 업계 기준이 아니라 이번 집행 기간 실제 판매 데이터 안에서의 비중(%)만 봅니다.
function adSalesAnalysisConcentration(products = []) {
  const totalSales = products.reduce((sum, p) => sum + canonicalPaidAmount(p), 0);
  if (!totalSales || !products.length) {
    return { totalSales: 0, top1: null, top1Share: null, topBrandName: null, topBrandShare: null };
  }
  const sorted = [...products].sort((a, b) => canonicalPaidAmount(b) - canonicalPaidAmount(a));
  const top1 = adSalesAnalysisProductRow(sorted[0]);
  const top1Share = canonicalPaidAmount(sorted[0]) / totalSales;
  const brandTotals = new Map();
  products.forEach((p) => {
    const name = brandCanonicalDisplayName(p);
    brandTotals.set(name, (brandTotals.get(name) || 0) + canonicalPaidAmount(p));
  });
  let topBrandName = null;
  let topBrandShare = null;
  brandTotals.forEach((amount, name) => {
    const share = amount / totalSales;
    if (topBrandShare === null || share > topBrandShare) {
      topBrandShare = share;
      topBrandName = name;
    }
  });
  return { totalSales, top1, top1Share, topBrandName, topBrandShare };
}

// 광고 시작 이전(같은 길이의 직전 기간, campaignComparisonRangeFromExecution 재사용) 대비
// 일평균 판매량 변화. 비교 데이터를 불러오지 못했거나(csv_required 등) 기간이 없으면 null을
// 반환해 "비교 가능한 데이터가 충분할 때만 표시" 규칙을 지킵니다.
function adSalesAnalysisComparisonStats(executionTotals = {}, comparisonTotals = {}, executionDays, comparisonDays, topProduct = null, comparisonProducts = []) {
  if (!Number(executionDays) || !Number(comparisonDays)) return null;
  const afterQty = Number(executionTotals.quantitySold || 0);
  const beforeQty = Number(comparisonTotals.quantitySold || 0);
  const afterAvg = afterQty / executionDays;
  const beforeAvg = beforeQty / comparisonDays;
  const direction = afterAvg > beforeAvg ? "증가" : afterAvg < beforeAvg ? "감소" : "변화 없음";
  let topProductBeforeQty = null;
  if (topProduct && Array.isArray(comparisonProducts)) {
    const match = comparisonProducts.find((p) => String(p.productNo || p.productCode || p.productName || "") === topProduct.key);
    if (match) topProductBeforeQty = Number(match.quantitySold || 0);
  }
  return {
    beforeAvg,
    afterAvg,
    beforeQty,
    afterQty,
    direction,
    rateLabel: campaignComparisonRate(afterQty - beforeQty, beforeQty),
    topProductBeforeQty
  };
}

// AI 분석 문단. 지시받은 금지 표현("~때문에 판매되었습니다", "광고 효과입니다", "광고가 매출을
// 만들었습니다")을 쓰지 않고, 항상 관찰 사실만 서술합니다("판매가 집중되었습니다", "동기간
// 판매량이 증가했습니다", "같은 기간 가장 많이 판매되었습니다", "함께 관찰되었습니다").
function adSalesAnalysisNarrative({ topProducts = [], concentration = {}, comparison = null } = {}) {
  if (!topProducts.length) {
    return "광고 집행 기간 동안 Cafe24에서 확인되는 판매 데이터가 없습니다.";
  }
  const sentences = [];
  const top = topProducts[0];
  // productName이 이미 Cafe24 "[영문 : 한글]" 표기로 브랜드를 포함하는 경우(대부분) 브랜드명을
  // 중복해서 앞에 붙이지 않습니다.
  const topLabel = /^\s*\[/.test(top.productName) ? top.productName : `${top.brandName} ${top.productName}`.trim();
  if (concentration.top1Share !== null && concentration.top1Share >= AD_SALES_ANALYSIS_CONCENTRATION_THRESHOLD) {
    sentences.push(`광고 집행 기간 동안 ${topLabel} 판매가 가장 높았습니다(같은 기간 판매금액의 ${pct(concentration.top1Share * 100)}).`);
    sentences.push("직접적인 광고 귀속은 확인되지 않지만, 동기간 판매가 집중된 상품으로 확인됩니다.");
  } else {
    sentences.push("광고 집행 기간 동안 특정 상품으로 판매 집중은 확인되지 않았습니다. 판매가 여러 상품에 분산되었습니다.");
  }
  if (concentration.topBrandName && concentration.topBrandShare !== null && concentration.topBrandShare >= AD_SALES_ANALYSIS_BRAND_THRESHOLD && concentration.topBrandName !== top.brandName) {
    sentences.push(`브랜드 기준으로는 ${concentration.topBrandName} 판매 비중이 가장 높게 관찰되었습니다(${pct(concentration.topBrandShare * 100)}).`);
  }
  if (comparison) {
    if (comparison.direction === "증가") {
      sentences.push(`광고 집행 기간 이전(일평균 ${adSalesAnalysisAvgLabel(comparison.beforeAvg)})과 비교하면 광고 집행 기간(일평균 ${adSalesAnalysisAvgLabel(comparison.afterAvg)}) 동안 판매량이 증가한 것으로 관찰되었습니다. 광고 집행 기간과 판매 증가가 함께 관찰되었을 뿐, 인과관계를 단정하지 않습니다.`);
    } else if (comparison.direction === "감소") {
      sentences.push(`광고 집행 기간 이전(일평균 ${adSalesAnalysisAvgLabel(comparison.beforeAvg)})과 비교하면 광고 집행 기간(일평균 ${adSalesAnalysisAvgLabel(comparison.afterAvg)}) 동안 판매량은 감소한 것으로 관찰되었습니다.`);
    } else {
      sentences.push("광고 집행 기간 전후 일평균 판매량에 뚜렷한 차이는 관찰되지 않았습니다.");
    }
    if (comparison.topProductBeforeQty !== null && top.quantitySold > comparison.topProductBeforeQty) {
      sentences.push(`${topLabel}은(는) 광고 집행 기간 이전(${apiNum(comparison.topProductBeforeQty)}개) 대비 이번 기간(${apiNum(top.quantitySold)}개) 판매수량이 늘어난 것으로 관찰되었습니다.`);
    }
  }
  return sentences.join(" ");
}

function adSalesAnalysisProductRowHtml(product, rank) {
  return `<tr>
    <td>${rank}</td>
    <td>${esc(product.productName)}</td>
    <td>${esc(product.brandName)}</td>
    <td>${apiNum(product.quantitySold)}개</td>
    <td>${apiWon(product.salesAmount)}</td>
    <td>${apiNum(product.orderCount)}건</td>
    <td>${product.avgPrice === null ? "-" : apiWon(product.avgPrice)}</td>
  </tr>`;
}

function adSalesAnalysisCardHtml(result) {
  const { row, executionStart, executionEnd, executionDays } = result;
  const campaignName = row.campaignName || row.campaignId || "캠페인";
  const objectiveLabel = metaAdsObjectiveLabel(row);
  const headHtml = `<div class="ad-ai-briefing-head">
    <strong class="ad-decision-card-name" title="${esc(campaignName)}">${esc(campaignName)}</strong>
    <span class="badge warn">${esc(objectiveLabel)}</span>
  </div>
  <p class="ad-decision-meta">
    <span>집행기간 ${esc(executionStart)} ~ ${esc(executionEnd)} (${apiNum(executionDays)}일)</span>
    <span>광고비 ${apiWon(row.spend)}</span>
    <span>Meta 구매값 ${apiWon(row.purchaseValue)}</span>
  </p>`;

  if (result.error) {
    return `<article class="ad-ai-briefing-card ad-sales-analysis-card">
      ${headHtml}
      <p class="hint-text">${esc(result.error)}</p>
    </article>`;
  }

  const { topProducts, comparison } = result;
  const tableHtml = topProducts.length ? `<div class="table-wrap ad-table-wrap">
    <table>
      <thead><tr><th>#</th><th>상품명</th><th>브랜드</th><th>판매수량</th><th>실제 결제금액</th><th>주문수</th><th>평균 실결제</th></tr></thead>
      <tbody>${topProducts.map((product, index) => adSalesAnalysisProductRowHtml(product, index + 1)).join("")}</tbody>
    </table>
  </div>` : `<p class="hint-text">이 캠페인 집행 기간 동안 확인되는 Cafe24 판매 데이터가 없습니다.</p>`;

  const compareHtml = comparison
    ? `<div class="campaign-period-meta">
        <span>광고 전 일평균 판매</span><strong>${adSalesAnalysisAvgLabel(comparison.beforeAvg)}</strong>
        <span>광고 기간 일평균 판매</span><strong>${adSalesAnalysisAvgLabel(comparison.afterAvg)} · ${esc(comparison.direction)} ${esc(comparison.rateLabel)}</strong>
      </div>`
    : `<p class="hint-text">비교 가능한 이전 기간 데이터가 충분하지 않아 전후 비교는 생략합니다.</p>`;

  return `<article class="ad-ai-briefing-card ad-sales-analysis-card">
    ${headHtml}
    ${tableHtml}
    <p class="ad-ai-briefing-narrative">${esc(result.narrative)}</p>
    ${topProducts.length ? compareHtml : ""}
  </article>`;
}

// 캠페인 하나의 집행 기간·직전 비교 기간 Cafe24 판매를 함께 불러와 카드 하나 분량의 결과로
// 정리합니다. renderCampaignPeriodComparison()과 동일하게 getSharedJson()으로 같은
// /api/diagnostics/brand-sales 엔드포인트를 캠페인별 날짜로 재호출합니다(새 API 아님).
async function adSalesAnalysisBuildCampaign(row) {
  const executionStart = row.executionStart;
  const executionEnd = row.executionEnd;
  const executionDays = campaignComparisonInclusiveDays(executionStart, executionEnd);
  const cmpRange = campaignComparisonRangeFromExecution(executionStart, executionEnd);
  const base = { row, executionStart, executionEnd, executionDays };

  const [executionResult, comparisonResult] = await Promise.allSettled([
    getSharedJson(`/api/diagnostics/brand-sales?since=${executionStart}&until=${executionEnd}`, 15000),
    getSharedJson(`/api/diagnostics/brand-sales?since=${cmpRange.comparisonStart}&until=${cmpRange.comparisonEnd}`, 15000)
  ]);

  const execution = executionResult.status === "fulfilled" ? executionResult.value : { error: executionResult.reason?.message || "판매 데이터 오류" };
  if (execution.error) {
    return { ...base, error: "이 캠페인 집행 기간의 Cafe24 판매 데이터를 확인할 수 없습니다.", topProducts: [], comparison: null, narrative: "" };
  }
  if (execution.source === "csv_required") {
    return { ...base, error: "이 캠페인 집행 기간의 Cafe24 데이터가 아직 준비되지 않았습니다(과거 데이터 CSV 업로드 필요).", topProducts: [], comparison: null, narrative: "" };
  }
  if (!Array.isArray(execution.products)) {
    return { ...base, error: "이 캠페인 집행 기간의 Cafe24 상품 판매 데이터가 없습니다.", topProducts: [], comparison: null, narrative: "" };
  }

  const topProducts = adSalesAnalysisTopProducts(execution.products);
  const concentration = adSalesAnalysisConcentration(execution.products);

  const comparison = comparisonResult.status === "fulfilled" ? comparisonResult.value : null;
  let comparisonStats = null;
  if (comparison && !comparison.error && comparison.source !== "csv_required" && cmpRange.days >= 1) {
    comparisonStats = adSalesAnalysisComparisonStats(
      execution.totals || {},
      comparison.totals || {},
      executionDays,
      cmpRange.days,
      topProducts[0] || null,
      Array.isArray(comparison.products) ? comparison.products : []
    );
  }

  const narrative = adSalesAnalysisNarrative({ topProducts, concentration, comparison: comparisonStats });

  return { ...base, error: null, topProducts, concentration, comparison: comparisonStats, narrative };
}

async function renderCampaignSalesAnalysis(target, fullReport, renderSeq) {
  if (!target) return;
  if (fullReport.error) {
    target.innerHTML = `<article class="action-item"><strong>Campaign Sales Analysis 확인 불가</strong><p>${esc(fullReport.error)}</p></article>`;
    return;
  }
  const executedCount = (fullReport.rows || []).filter((row) => metaAdsIsExecuted(row)).length;
  const campaigns = adSalesAnalysisSelectCampaigns(fullReport);
  if (!campaigns.length) {
    target.innerHTML = `<p class="hint-text">이번 기간에 집행 기간이 확인되는 캠페인이 없습니다.</p>`;
    return;
  }
  target.innerHTML = `<article class="action-item"><strong>Campaign Sales Analysis 계산 중</strong><p>캠페인 집행 기간과 겹치는 Cafe24 판매 데이터를 불러오고 있습니다.</p></article>`;
  const results = await Promise.all(campaigns.map((row) => adSalesAnalysisBuildCampaign(row)));
  if (renderSeq !== undefined && renderSeq !== operationsRenderSeq) return;
  target.innerHTML = `
    <div class="ad-sales-analysis-list">${results.map((result) => adSalesAnalysisCardHtml(result)).join("")}</div>
    ${executedCount > campaigns.length ? `<p class="hint-text">광고비 상위 ${campaigns.length}개 집행 캠페인만 분석합니다. 전체 캠페인은 아래 Campaign Full Report에서 확인하세요.</p>` : ""}
  `;
}

// ============================================================================
// Meta Product Performance · Phase 1 (2026-07-23) — Marketing 화면(#Advertising view)
// 전용 신규 카드. 새 API를 만들지 않고 기존 GET /api/meta-ads/products만 재사용한다.
// 이 endpoint는 이미 content_id parser → Product Registry resolver → Registry miss일 때
// Runtime Auto Enrichment(Cafe24 Detail API로 그 자리에서 조회, Registry 파일은 쓰지 않음)
// 까지 서버에서 전부 처리해 rows[].product/matchType으로 내려준다. 이 화면은 그 결과를
// 그대로 표/배지/detail로 보여주기만 한다 — Meta API, Registry, Cafe24 API 어느 것도
// 수정하지 않는다.
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
    metaAdsSummaryCard("Runtime", apiNum(summary.runtimeEnrichedCount), "Registry에 없어 Cafe24 상품 상세 조회로 그 자리에서 보강된 상품 수"),
    metaAdsSummaryCard("Unresolved", apiNum(summary.unresolvedRows), "아직 Cafe24 상품으로 특정하지 못한 content_id 수")
  ].join("");
}

// Runtime 상품(product.source === "runtime")은 노란 배지, Registry에서 바로 resolve된
// 상품은 초록 배지 — 기존 .badge/.badge.good/.badge.warn CSS를 그대로 재사용한다(신규
// CSS 클래스 추가 없음).
function metaProductPerformanceRegistrySourceLabel(row = {}) {
  if (row.product?.source === "runtime") return "Runtime";
  if (row.matched) return "Verified";
  return "Unresolved";
}

function metaProductPerformanceRegistryBadge(row = {}) {
  const label = metaProductPerformanceRegistrySourceLabel(row);
  if (label === "Runtime") return `<span class="badge warn">Runtime</span>`;
  if (label === "Verified") return `<span class="badge good">Verified</span>`;
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
  const isRuntime = product.source === "runtime";
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
    <div><dt>Runtime 여부</dt><dd>${isRuntime ? "Runtime" : "Registry"}</dd></div>
    <div><dt>content_id</dt><dd>${esc(row.contentId || "-")}</dd></div>
    <div><dt>matchType</dt><dd>${esc(row.matchType || "-")}</dd></div>
    <div><dt>실매출(Cafe24)</dt><dd>${salesProduct ? apiWon(salesProduct.canonicalPaidAmount) : salesUnavailableNote}</dd></div>
    <div><dt>주문수</dt><dd>${salesProduct ? apiNum(salesProduct.orderCount) : "-"}</dd></div>
    <div><dt>평균 판매가</dt><dd>${avgPrice === null ? "-" : apiWon(avgPrice)}</dd></div>
    <div><dt>할인율 평균</dt><dd>${discountRate === null || discountRate === undefined ? "-" : pct(discountRate)}</dd></div>
    <div><dt>판매된 옵션 수</dt><dd>데이터 없음(옵션 단위 필드 미제공)</dd></div>
  </dl>${isRuntime ? `<span class="badge warn meta-product-performance-detail-badge">Runtime Product</span>` : ""}
  <div class="meta-product-performance-orders">
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
    metaAdsSummaryCard("Runtime 브랜드 수", apiNum(runtimeBrandCount), "Runtime 상품이 1개 이상 있는 브랜드 수"),
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
      <td><strong>${esc(group.brand)}</strong>${group.runtimeCount > 0 ? `<span class="meta-brand-runtime-dot" title="Runtime 상품 포함"></span>` : ""}</td>
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
  // STEP48A: 매출 요약(Hero/Compare/결제수단) 카드는 재확인 결과 오프라인/ECOUNT를 전혀
  // 포함하지 않는 Cafe24 LIVE 값만 사용해 status는 "live"를 유지한다. 다만 화면 상단 KPI
  // 카드(광고비·콘텐츠 저장률)는 Meta/Instagram 캐시 기준이라 전체가 100% LIVE는 아니라는
  // 점을 note로 명시한다(계산 로직/데이터 소스는 변경하지 않음).
  renderFreshnessHeader("commerceFreshnessHeader", {
    status: "live",
    dataAsOf: range.label || `${startDate} ~ ${endDate}`,
    lastUpdated: new Date().toISOString(),
    note: "매출 요약(Hero/결제수단)은 Cafe24 온라인 실결제 기준으로 지금 다시 조회한 값이며 오프라인(매장) 매출은 포함하지 않습니다. 상단 KPI의 광고비는 Meta 캐시, 콘텐츠 저장률은 Instagram 캐시 기준이라 갱신 주기가 다를 수 있습니다."
  });
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
  const onlineOrderPaidAmount = firstFiniteValue(totals.sales?.orderPaidAmount, sales.reconciliation?.orderPaidAmount, totals.paidAmount, 0);
  const paidAmount = Number(onlineOrderPaidAmount || 0);
  const productPaidAmount = firstFiniteValue(totals.sales?.paidAmount, sales.reconciliation?.allocatedProductPaidAmount, totals.paidAmount, 0);
  const shippingAmount = firstFiniteValue(totals.sales?.shippingAmount, sales.reconciliation?.shippingAmount, 0);
  heroTarget.innerHTML = `<section class="ops-summary-hero">
    <div class="ops-summary-hero-main">
      <span>온라인 결제액</span>
      <strong class="ops-summary-hero-num">${apiWon(onlineOrderPaidAmount)}</strong>
      <p class="ops-summary-hero-sub">Cafe24 canonical 결제 기준</p>
    </div>
    <div class="ops-summary-side">
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
  renderCommercePrimaryKpi();
  renderCommerceSecondaryKpi();
  renderCommerceChannelCards();
  renderCommerceSalesSummary();
}

// STEP66-2 SECTION 2/3/5: 새 계산이 아니라 todaySummarySalesInfo()(6876행, 기존
// Today 요약이 이미 쓰던 순수 함수)와 commerceSummaryState.totals가 이미 갖고 있는
// 값을 다시 읽어 카드로만 보여준다. onlineSales/offlineSales/totalSales 필드는
// todaySummarySalesInfo와 완전히 동일한 fallback 체인을 쓴다.
function commerceOnlineOfflineSplit() {
  const totalSales = commerceSummaryState.totalSales || {};
  const cafeTotals = commerceSummaryState.cafe?.totals || {};
  const onlineRaw = hasApiValue(totalSales?.onlineSales?.paidAmount) ? totalSales.onlineSales.paidAmount : cafeTotals.paidAmount;
  const offlineRaw = totalSales?.offlineSales?.offlineSalesAmount;
  const totalRaw = totalSales?.totalSales?.amount;
  const online = hasApiValue(onlineRaw) ? Number(onlineRaw) : null;
  const offline = hasApiValue(offlineRaw) ? Number(offlineRaw) : null;
  const total = hasApiValue(totalRaw) ? Number(totalRaw) : (Number.isFinite(online) && Number.isFinite(offline) ? online + offline : (Number.isFinite(online) ? online : null));
  return { online, offline, total, cafeTotals };
}

function renderCommercePrimaryKpi() {
  const target = $("#commercePrimaryKpi");
  if (!target) return;
  const { online, offline, total } = commerceOnlineOfflineSplit();
  target.innerHTML = [
    ["총매출", total],
    ["온라인", online],
    ["오프라인", offline]
  ].map(([label, value]) => `<article class="action-item ad-summary-card ad-core-kpi-card"><span>${esc(label)}</span><strong>${value === null ? "-" : apiWon(value)}</strong></article>`).join("");
}

function renderCommerceSecondaryKpi() {
  const target = $("#commerceSecondaryKpi");
  if (!target) return;
  const { online, offline, cafeTotals } = commerceOnlineOfflineSplit();
  const shareBase = (Number.isFinite(online) ? online : 0) + (Number.isFinite(offline) ? offline : 0);
  const onlineShare = shareBase > 0 && Number.isFinite(online) ? `${(online / shareBase * 100).toFixed(1)}%` : "-";
  const offlineShare = shareBase > 0 && Number.isFinite(offline) ? `${(offline / shareBase * 100).toFixed(1)}%` : "-";
  target.innerHTML = [
    ["주문수", `${apiNum(cafeTotals.orderCount)}건`],
    ["객단가", apiWon(cafeTotals.averageOrderValue)],
    ["온라인 비중", onlineShare],
    ["오프라인 비중", offlineShare]
  ].map(([label, value]) => `<article class="kpi"><span>${esc(label)}</span><strong>${value}</strong></article>`).join("");
}

function renderCommerceChannelCards() {
  const target = $("#commerceChannelCards");
  if (!target) return;
  const { online, offline } = commerceOnlineOfflineSplit();
  const shareBase = (Number.isFinite(online) ? online : 0) + (Number.isFinite(offline) ? offline : 0);
  const rows = [
    { label: "Online", value: online, note: "Cafe24 canonical 실결제 기준" },
    { label: "Offline", value: offline, note: "ECOUNT 매장 매출 기준" }
  ];
  target.innerHTML = rows.map((row) => {
    const share = shareBase > 0 && Number.isFinite(row.value) ? `${(row.value / shareBase * 100).toFixed(1)}%` : "-";
    return `<article class="action-item ad-summary-card"><span>${esc(row.label)} · ${share}</span><strong>${row.value === null ? "-" : apiWon(row.value)}</strong><p>${esc(row.note)}</p></article>`;
  }).join("");
}

// STEP66-2 SECTION 4: Sales Summary. todaySummarySalesInfo()(총매출/온라인/오프라인
// 문장, 기존 Today 요약과 동일 함수)와 salesDecisionState()가 이미 만든 "대표 이슈"
// (renderAdComparison의 decision, healthBanner와 같은 값)를 한 카드에 합친다 — 새
// 판단 로직 없음.
function renderCommerceSalesSummary() {
  const block = $("#commerceSalesSummary");
  const text = $("#commerceSalesSummaryText");
  if (!block || !text) return;
  const totalSales = commerceSummaryState.totalSales || {};
  const cafeTotals = commerceSummaryState.cafe?.totals || {};
  const decision = commerceSummaryState.decision || null;
  const salesInfo = todaySummarySalesInfo(totalSales, cafeTotals);
  const issue = decision ? `${decision.label} — ${decision.reason}` : "이슈 확인 중";
  block.removeAttribute("hidden");
  text.textContent = `${salesInfo.label} ${salesInfo.value}(${salesInfo.note}). 대표 이슈: ${issue}`;
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
  if (!todayViewActive() && !intelligenceDestinationViewActive()) {
    todayViewDirty = true;
    return;
  }

  const briefingTarget = $("#todaySummaryBriefing");
  const sectionsTarget = $("#todaySummarySections");
  const marketingTarget = $("#intelligenceMarketingSlot");
  if (!briefingTarget && !sectionsTarget && !marketingTarget) return;

  const state = todaySummaryState;
  const cafeTotals = state.cafe?.totals || {};
  const comparisonState = state.comparison || {};
  const marketingState = state.marketing || {};
  const totalSalesState = state.totalSales || {};
  const metaAge = relativeAgeText(cacheAgeMinutes(state.meta || {}));
  const salesInfo = todaySummarySalesInfo(totalSalesState, cafeTotals);
  const marketingValue = marketingState.adSpendShare === null || marketingState.adSpendShare === undefined ? "확인 필요" : pct(marketingState.adSpendShare);
  const marketingBriefingValue = marketingState.briefingCount === null || marketingState.briefingCount === undefined
    ? "확인 필요"
    : `관리 필요 캠페인 ${apiNum(marketingState.briefingCount)}건`;

  if (briefingTarget && todayViewActive()) briefingTarget.innerHTML = [
    salesCompareCard("Commerce", comparisonState.comparable ? `오차 ${comparisonState.mismatchRate < 1 ? comparisonState.mismatchRate.toFixed(1) : Math.round(comparisonState.mismatchRate)}%` : "비교 불가", "기존 Sales 비교 결과", { status: !comparisonState.comparable, badge: { label: "Commerce", tone: "neutral" } }),
    salesCompareCard("Meta Ads Cache", metaAge || "확인 필요", "기존 cache freshness 기준", { status: !metaAge, badge: { label: "Meta", tone: "cache" } })
  ].join("");

  if (sectionsTarget && todayViewActive()) sectionsTarget.innerHTML = [
    `<article class="action-item sales-compare-card"><span>${esc(salesInfo.label)}</span><strong>${esc(salesInfo.value)}</strong><p>${esc(salesInfo.note)}</p><button class="today-jump-button" type="button" data-jump-view="Sales">Commerce 보기</button></article>`,
    `<article class="action-item sales-compare-card"><span>Reports</span><strong>Monthly Report</strong><p>월간 확정 스냅샷</p><button class="today-jump-button" type="button" data-jump-view="Reports">월간 리포트 보기</button></article>`
  ].join("");

  if (marketingTarget && intelligenceDestinationViewActive()) marketingTarget.innerHTML = [
    "<strong>Marketing Intelligence</strong>",
    salesCompareCard("Marketing", marketingBriefingValue, marketingState.narrative || "관리 필요 캠페인 결과를 확인 중입니다.", { badge: { label: "Marketing", tone: "neutral" } }),
    `<article class="action-item sales-compare-card"><span>Marketing</span><strong>${marketingValue}</strong><p>광고비 / 실제 매출</p><button class="today-jump-button" type="button" data-jump-view="Advertising">Marketing 보기</button></article>`
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

// 2026-07-17 버그수정: Cafe24 온라인 매출 API(/api/diagnostics/brand-sales)에 until을 오늘보다
// 미래인 날짜로 보내면, 그 요청 range 전체가 아니라 최근 3~4일치 주문만 돌아오는 프록시 쪽
// 버그가 있다(실측 근거는 완료 보고서 참고). 이번 달을 조회할 때 until=월말을 그대로 보내면
// 항상 이 버그에 걸리므로, "온라인 매출 조회에 쓸 안전한 until"을 한 곳에서 계산해 Today
// 매출 달력과 Calendar가 동일하게 재사용한다: until = min(해당 월 말일, 오늘).
// - 과거 달: monthEnd가 이미 오늘보다 이전이라 그대로 반환(영향 없음)
// - 이번 달: 오늘로 고정
// - 미래 달: 그 달 진입 자체가 기존 UI 정책(월 스위처 disabled 등)으로 막혀 있으므로 monthEnd를
//   그대로 반환한다(호출된다 해도 실제로 존재하지 않는 미래 데이터를 요청하는 것뿐이라 안전).
function boundedMonthUntil(monthKey) {
  const start = `${monthKey}-01`;
  const rawEnd = monthEnd(monthKey);
  const today = todayDateKey();
  if (start > today) return rawEnd;
  return rawEnd > today ? today : rawEnd;
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

// 2026-07-17 버그수정(TASK3 검증 중 발견): row.onlineSales/offlineSales가 null일 때
// todaySalesCalendarCell()의 data-* 속성은 esc(value ?? "")로 빈 문자열("")을 심는다.
// 기존에는 Number("") === 0 이 유한(finite)해 "미확인"이 아니라 "0원"으로 잘못 표시됐다
// (예: 오프라인 스냅샷이 없는 날 온라인만 있는 상태에서 오프라인이 실제로 0원인 것처럼
// 보였다). 빈 문자열/undefined/null은 값이 없는 것으로 명시적으로 처리해 미확인과 실제
// 0원을 구분한다.
function finiteTooltipNumber(value) {
  if (value === "" || value === undefined || value === null) return null;
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
  // 2026-07-17 버그수정: until을 monthEnd(월말) 그대로 보내면 이번 달일 때 미래 날짜가 되어
  // Cafe24 프록시가 최근 며칠치만 반환한다(Calendar와 동일한 원인). boundedMonthUntil()로
  // 이번 달은 오늘까지만 요청하도록 고정한다 — Calendar(loadCalendarMonthData)와 동일한 helper.
  const end = boundedMonthUntil(monthKey);
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

// ============================================================
// Calendar x Sales Heatmap Phase 1 (2026-07-17)
// 새 nav 화면. UI + 데이터 연결만 구현하며 새 API는 만들지 않는다 — 아래 함수들은
// todaySalesCalendar*가 이미 쓰고 있는 것과 동일한 기존 엔드포인트만 호출한다:
//   - /api/diagnostics/brand-sales (Cafe24 온라인 매출 + TOP 브랜드/상품, 이미 Today 캘린더가 사용)
//   - /api/ecount-sales/monthly (ECOUNT 오프라인 일별 매출, 이미 Today 캘린더가 사용)
//   - /api/instagram/range (게시물별 조회/저장/공유 + 팔로워, Monthly helper와 동일 소스)
//   - /api/meta-ads/summary (광고비/ROAS) — Meta Graph API의 time_range는 since=until=하루도
//     그대로 지원하므로 서버 코드를 전혀 건드리지 않고 "하루짜리 기간 조회"로 재사용한다.
//   - intelligenceUrl('/api/intelligence/clients') — Clients 화면과 동일한 엔드포인트를
//     since=until=하루로 호출해 그날의 TOP 고객만 뽑는다.
// 월별 데이터(온라인/오프라인/Instagram)는 월 이동 시 calendarMonthDataCache에서 재사용하고,
// 날짜별 상세(광고비/ROAS/TOP 브랜드/상품/고객)는 실제로 hover/클릭된 날짜만 calendarDayDetailCache에
// 채워 넣는다 — 둘 다 "불필요한 재호출 금지" 요구사항을 만족시키기 위함이다.
// ============================================================

// Instagram range 응답의 posts[]를 날짜별로 묶어 그날의 게시물 수/조회/저장/공유 합계를 만든다.
// buildInstagramRangeData()가 이미 date 필터링을 마친 posts만 돌려주므로 여기서는 집계만 한다.
function calendarInstagramByDate(posts = []) {
  const map = new Map();
  for (const post of posts || []) {
    const date = String(post?.timestamp || post?.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!map.has(date)) map.set(date, { count: 0, views: 0, saves: 0, shares: 0 });
    const row = map.get(date);
    row.count += 1;
    row.views += Number(post.views || post.reach || 0);
    row.saves += Number(post.saves || 0);
    row.shares += Number(post.shares || 0);
  }
  return map;
}

// 월별 데이터 로딩(온라인/오프라인/Instagram) — 캐시에 있으면 그대로 재사용하고, 없을 때만
// 3개 기존 API를 병렬 호출한다. Today 캘린더의 온라인/오프라인 호출과 완전히 동일한 엔드포인트다.
//
// 2026-07-17 버그수정: /api/diagnostics/brand-sales를 until=월말(예: 2026-07-31)처럼 "오늘보다
// 미래인 날짜"로 호출하면 Cafe24 프록시가 해당 월의 dailySales 전체가 아니라 최근 3~4일치만
// 돌려주는 것을 실측으로 확인했다(같은 since로 until=오늘까지는 정상, until=오늘 이후는 항상
// 최근 며칠로 잘림 — 실측 근거는 완료 보고서 TASK1/TASK2 참고). 이 때문에 이번 달(current month)의
// 앞쪽 날짜들이 onlineMap에서 아예 빠져 normalizeDailySalesMap()이 기본값 0을 채워 넣었고,
// 그 결과 Calendar 셀/Hover/Day Overview의 온라인 매출이 실제로는 존재하는데도 0원으로 보였다.
// 서버(server.mjs)나 프록시를 고칠 수 없는 범위이므로, 프런트에서 이번 달을 불러올 때만 online
// 조회의 until을 "오늘"로 고정해 미래 날짜가 절대 전달되지 않게 한다. Today 매출 달력
// (renderTodaySalesCalendar)도 같은 boundedMonthUntil() 헬퍼를 재사용한다 — 각자 따로 clamp
// 코드를 갖지 않도록 공통화했다. offline(ECOUNT)/Instagram 호출은 이 버그와 무관해 그대로 둔다.
async function loadCalendarMonthData(monthKey) {
  if (calendarMonthDataCache.has(monthKey)) return calendarMonthDataCache.get(monthKey);
  const start = `${monthKey}-01`;
  const end = monthEnd(monthKey);
  const onlineUntil = boundedMonthUntil(monthKey);
  const [onlineData, offlineData, instagramData] = await Promise.all([
    getJson(`/api/diagnostics/brand-sales?since=${start}&until=${onlineUntil}`, 12000),
    getJson(`/api/ecount-sales/monthly?month=${monthKey}`, 8000),
    getJson(`/api/instagram/range?since=${start}&until=${end}`, 12000)
  ]);
  const instagramByDate = calendarInstagramByDate(instagramData?.posts || []);
  const result = { onlineData, offlineData, instagramData, instagramByDate };
  calendarMonthDataCache.set(monthKey, result);
  return result;
}

// 날짜별 상세(광고비/ROAS/TOP 브랜드/TOP 상품) — hover 또는 클릭으로 실제 조회된 날짜만
// on-demand로 채운다. TOP 고객(Clients)은 Day Overview 전용이라 이 함수에는 포함하지 않는다
// (hover 툴팁에는 TOP 고객이 필요 없음 — 요구사항의 hover/클릭 항목이 서로 다르기 때문).
async function loadCalendarDayDetail(date) {
  if (calendarDayDetailCache.has(date)) return calendarDayDetailCache.get(date);
  const promise = (async () => {
    const [brandDay, metaDay] = await Promise.all([
      getJson(`/api/diagnostics/brand-sales?since=${date}&until=${date}`, 10000),
      getJson(`/api/meta-ads/summary?since=${date}&until=${date}&level=campaign`, 10000)
    ]);
    const topBrand = !brandDay?.error && Array.isArray(brandDay.brands)
      ? [...brandDay.brands].sort((a, b) => canonicalBrandPaidAmount(b) - canonicalBrandPaidAmount(a))[0] || null
      : null;
    const topProduct = !brandDay?.error && Array.isArray(brandDay.products) ? brandDay.products[0] || null : null;
    return { brandDay, metaDay, topBrand, topProduct };
  })();
  calendarDayDetailCache.set(date, promise);
  return promise;
}

// Clients 화면과 동일한 엔드포인트를 since=until=하루로 호출해 TOP 고객만 뽑는다.
// Day Overview에서만 쓰이므로 클릭 시 별도로 로드한다(hover에는 불필요, 위 주석 참고).
async function loadCalendarDayTopClient(date) {
  const cacheKey = `client:${date}`;
  if (calendarDayDetailCache.has(cacheKey)) return calendarDayDetailCache.get(cacheKey);
  const promise = (async () => {
    const data = await getJson(intelligenceUrl(`/api/intelligence/clients?since=${date}&until=${date}`), 15000);
    if (data?.error || !data?.ok || !Array.isArray(data.clients)) return { error: data?.error || "고객 데이터를 불러오지 못했습니다.", topClient: null };
    const topClient = [...data.clients].sort((a, b) => Number(b.totalSales || 0) - Number(a.totalSales || 0))[0] || null;
    return { topClient };
  })();
  calendarDayDetailCache.set(cacheKey, promise);
  return promise;
}

function calendarMonths() {
  return todaySalesCalendarMonths();
}

function normalizeCalendarMonth(monthKey) {
  return normalizeTodaySalesCalendarMonth(monthKey);
}

function shiftCalendarMonth(monthKey, offset) {
  return shiftTodaySalesCalendarMonth(monthKey, offset);
}

function calendarMonthSwitchHtml(monthKey) {
  const options = calendarMonths();
  const current = normalizeCalendarMonth(monthKey);
  const currentIndex = options.indexOf(current);
  const olderDisabled = currentIndex === -1 || currentIndex >= options.length - 1;
  const newerDisabled = currentIndex <= 0;
  return `<div class="today-sales-calendar-month-switch calendar-month-switch" aria-label="Calendar 월 선택">
    <button class="month-nav-btn" type="button" data-calendar-nav="-1" ${olderDisabled ? "disabled" : ""} aria-label="이전 달">◀</button>
    <strong class="calendar-month-label">${esc(salesCalendarMonthLabel(current))}</strong>
    <button class="month-nav-btn" type="button" data-calendar-nav="1" ${newerDisabled ? "disabled" : ""} aria-label="다음 달">▶</button>
  </div>`;
}

// 셀 마크업. 히트맵 레벨/색상은 todaySalesCalendarCell과 동일한 salesHeatLevel()·sales-heat-*
// 클래스를 그대로 재사용한다(요구사항: "기존 색상 시스템 재사용, 새 CSS 최소화"). 클릭으로 Day
// Overview를 여는 data-calendar-day 속성만 추가로 붙인다.
// 2026-07-17 버그수정(TASK5): 이전에는 온라인/오프라인 중 "하나라도" 미확인이면 그날 전체를
// noData(회색 "-")로 처리했다. 이 때문에 예를 들어 ECOUNT 오프라인 snapshot이 7월 15일까지만
// 있는 경우, 온라인 매출은 실제로 존재하는 7월 16~17일까지도 "-"로 가려졌다. 아래처럼 5가지
// 상태를 분리한다: A(둘 다 확보) / B(온라인만 확보) / C(오프라인만 확보) / D(둘 다 확보+0원) /
// E(둘 다 미확인, 또는 미래 날짜) — noData(회색 "-")는 오직 E일 때만이다. B/C는 확인된 금액을
// 그대로 표시하고, 이미 있던 소스 점(dot, is-muted) 표시로 어느 쪽이 비어있는지 계속 구분한다.
function calendarCellHtml(row, maxDailySales, instagramByDate) {
  if (!row) return `<div class="today-sales-calendar-cell is-outside" aria-hidden="true"></div>`;
  const level = salesHeatLevel(row.totalSales, maxDailySales);
  const bothMissing = !row.onlineAvailable && !row.offlineAvailable;
  const noData = row.future || bothMissing; // 상태 E (또는 미래 날짜)
  const partialOnlineOnly = !noData && row.onlineAvailable && !row.offlineAvailable; // 상태 B
  const partialOfflineOnly = !noData && !row.onlineAvailable && row.offlineAvailable; // 상태 C
  const partial = partialOnlineOnly || partialOfflineOnly;
  const zero = !noData && !partial && Number(row.totalSales || 0) === 0; // 상태 D
  const isToday = row.date === todayDateKey();
  const isSelected = row.date === calendarSelectedDate;
  const ig = instagramByDate?.get(row.date) || { count: 0 };
  const classes = [
    "today-sales-calendar-cell",
    "calendar-day-cell",
    `sales-heat-${level}`,
    row.future ? "is-future" : "",
    isToday ? "is-today" : "",
    zero ? "is-zero" : "",
    partial ? "is-unavailable" : "",
    noData ? "is-nodata" : "",
    isSelected ? "is-selected" : ""
  ].filter(Boolean).join(" ");
  const dataAttrs = [
    `data-calendar-day="${esc(row.date)}"`,
    `data-date="${esc(row.date)}"`,
    `data-total="${esc(row.totalSales)}"`,
    `data-online="${esc(row.onlineSales ?? "")}"`,
    `data-offline="${esc(row.offlineSales ?? "")}"`,
    `data-post-count="${esc(ig.count || 0)}"`,
    `data-nodata="${noData ? "1" : ""}"`
  ].join(" ");
  const partialNote = partialOnlineOnly ? "오프라인 미반영" : partialOfflineOnly ? "온라인 확인 불가" : "";
  const label = noData
    ? `${row.date} 데이터 없음`
    : partial
      ? `${row.date} 확인된 매출 ${apiWon(row.totalSales)}(${partialNote})`
      : `${row.date} 총매출 ${apiWon(row.totalSales)}`;
  return `<div class="${classes}" tabindex="0" role="button" aria-label="${esc(label)}" ${dataAttrs}>
    <div class="today-sales-calendar-dayline">${isToday ? `<b>TODAY</b>` : ""}<span>${apiNum(row.day)}</span></div>
    ${noData ? `<strong class="calendar-cell-nodata">-</strong>` : `<strong>${krw(row.totalSales)}</strong>`}
    <div class="today-sales-source-dots">
      <i class="today-sales-source-dot is-online ${row.onlineAvailable ? "" : "is-muted"}"></i>
      <i class="today-sales-source-dot is-offline ${row.offlineAvailable ? "" : "is-muted"}"></i>
    </div>
  </div>`;
}

function calendarLoadingHtml(monthKey) {
  const cells = Array.from({ length: 35 }, () => `<div class="today-sales-calendar-cell today-sales-calendar-skeleton"></div>`).join("");
  return `<section class="today-sales-calendar calendar-grid-block monthly-report-block is-loading">
    <div class="monthly-report-block-head">
      <div><h4>월별 매출 캘린더</h4></div>
      ${calendarMonthSwitchHtml(monthKey)}
    </div>
    <div class="today-sales-calendar-weekdays">
      ${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="today-sales-calendar-grid">${cells}</div>
    <div class="today-sales-calendar-loading-overlay" aria-hidden="true"><span></span></div>
  </section>`;
}

function calendarDayOverviewEmptyHtml() {
  return `<div class="calendar-day-overview-empty">
    <p>날짜를 클릭하면<br>그날의 마케팅 현황이 여기에 표시됩니다.</p>
  </div>`;
}

function calendarDayOverviewLoadingHtml(date) {
  return `<div class="calendar-day-overview-panel is-loading">
    <div class="calendar-day-overview-head">
      <h4>${esc(salesCalendarLongDate(date))}</h4>
      <button type="button" class="calendar-day-overview-close" data-calendar-close aria-label="닫기">✕</button>
    </div>
    <p class="monthly-report-muted">불러오는 중...</p>
  </div>`;
}

function calendarDayOverviewRow(label, value, sub = "") {
  return `<div class="monthly-report-side-row calendar-overview-row"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub ? `<p class="monthly-report-fnote">${esc(sub)}</p>` : ""}</div>`;
}

function calendarDayOverviewHtml(date, monthCache, dayDetail, topClientResult) {
  const rows = buildTodaySalesCalendarRows(date.slice(0, 7), monthCache.onlineData, monthCache.offlineData);
  const dayRow = rows.find((row) => row.date === date) || null;
  const online = dayRow?.onlineAvailable ? dayRow.onlineSales : null;
  const offline = dayRow?.offlineAvailable ? dayRow.offlineSales : null;
  // 2026-07-17 버그수정(TASK5): 온라인/오프라인 중 하나만 확보돼도 확인된 금액을 합산해 보여준다.
  // total은 항상 "현재까지 확인된 금액의 합"이며, 부분 상태일 때는 아래 partialNote로 그 사실을
  // 밝힌다(총매출을 실제보다 낮은 값처럼 조용히 보여주지 않기 위함).
  const total = (online || 0) + (offline || 0);
  const orderCount = dayRow?.onlineAvailable ? dayRow.onlineOrderCount : null;
  const ig = monthCache.instagramByDate?.get(date) || { count: 0, views: 0, saves: 0, shares: 0 };
  const followers = monthCache.instagramData?.account?.followers;
  const metaFailed = Boolean(dayDetail && dayDetail.metaDay?.error);
  const spend = dayDetail?.metaDay && !dayDetail.metaDay.error ? dayDetail.metaDay.totals?.spend : null;
  const roas = dayDetail?.metaDay && !dayDetail.metaDay.error ? dayDetail.metaDay.totals?.roas : null;
  const topBrand = dayDetail?.topBrand;
  const topProduct = dayDetail?.topProduct;
  const topClient = topClientResult?.topClient;
  const bothMissing = !dayRow || (!dayRow.onlineAvailable && !dayRow.offlineAvailable);
  const noData = bothMissing || dayRow?.future; // 상태 E, 또는 미래 날짜
  const partialOnlineOnly = !noData && dayRow.onlineAvailable && !dayRow.offlineAvailable; // 상태 B
  const partialOfflineOnly = !noData && !dayRow.onlineAvailable && dayRow.offlineAvailable; // 상태 C
  const partialNote = partialOnlineOnly
    ? "오프라인 매출이 아직 반영되지 않았습니다. 위 금액은 온라인만 반영된 확인된 금액입니다."
    : partialOfflineOnly
      ? "온라인 매출을 확인하지 못했습니다. 위 금액은 오프라인만 반영된 확인된 금액입니다."
      : "";
  const spendText = metaFailed ? "확인 불가" : (spend === null || spend === undefined ? "확인 중" : apiWon(spend));
  const roasText = metaFailed ? "-" : (roas === null || roas === undefined ? "-" : multiple(roas));
  return `<div class="calendar-day-overview-panel">
    <div class="calendar-day-overview-head">
      <h4>${esc(salesCalendarLongDate(date))}</h4>
      <button type="button" class="calendar-day-overview-close" data-calendar-close aria-label="닫기">✕</button>
    </div>
    ${noData ? `<p class="monthly-report-muted">이 날짜는 확인 가능한 데이터가 없습니다(데이터 없음).</p>` : `
    <div class="monthly-report-hero-main calendar-overview-total">
      <span>${partialOnlineOnly || partialOfflineOnly ? "확인된 매출" : "총매출"}</span>
      <strong>${apiWon(total)}</strong>
      <p class="monthly-report-muted">${partialNote || "온라인 + 오프라인 합산"}</p>
    </div>
    <div class="calendar-overview-grid">
      ${calendarDayOverviewRow("온라인", online === null ? "미확인" : apiWon(online))}
      ${calendarDayOverviewRow("오프라인", offline === null ? "미확인" : apiWon(offline))}
      ${calendarDayOverviewRow("주문수", orderCount === null ? "미확인" : `${apiNum(orderCount)}건`)}
      ${calendarDayOverviewRow("광고비", spendText)}
      ${calendarDayOverviewRow("ROAS", roasText)}
      ${calendarDayOverviewRow("인스타 조회", apiNum(ig.views))}
      ${calendarDayOverviewRow("저장", apiNum(ig.saves))}
      ${calendarDayOverviewRow("공유", apiNum(ig.shares))}
      ${calendarDayOverviewRow("팔로워", hasApiValue(followers) ? `${apiNum(followers)}명` : "-")}
    </div>
    <p class="calendar-overview-subhead">TOP 브랜드</p>
    <p class="calendar-overview-top-line">${topBrand ? `${esc(brandCanonicalDisplayName(topBrand))} · ${apiWon(canonicalBrandPaidAmount(topBrand))}` : (dayDetail ? "데이터 없음" : "불러오는 중...")}</p>
    <p class="calendar-overview-subhead">TOP 상품</p>
    <p class="calendar-overview-top-line">${topProduct ? `${esc(topProduct.productName || "-")} · ${apiWon(topProduct.salesAmount)}` : (dayDetail ? "데이터 없음" : "불러오는 중...")}</p>
    <p class="calendar-overview-subhead">TOP 고객</p>
    <p class="calendar-overview-top-line">${topClient ? `${esc(topClient.name || "-")} · ${apiWon(topClient.totalSales)}` : (topClientResult ? "데이터 없음" : "불러오는 중...")}</p>
    `}
  </div>`;
}

async function openCalendarDayOverview(date) {
  calendarSelectedDate = date;
  hideCalendarTooltip();
  $$(".calendar-day-cell").forEach((cell) => cell.classList.toggle("is-selected", cell.dataset.calendarDay === date));
  const panel = $("#calendarDayOverview");
  if (!panel) return;
  const renderSeq = ++calendarDayOverviewRenderSeq;
  panel.innerHTML = calendarDayOverviewLoadingHtml(date);
  const monthKey = date.slice(0, 7);
  const monthCache = await loadCalendarMonthData(monthKey);
  if (renderSeq !== calendarDayOverviewRenderSeq) return;
  panel.innerHTML = calendarDayOverviewHtml(date, monthCache, null, null);
  const [dayDetail, topClientResult] = await Promise.all([
    loadCalendarDayDetail(date),
    loadCalendarDayTopClient(date)
  ]);
  if (renderSeq !== calendarDayOverviewRenderSeq || calendarSelectedDate !== date) return;
  panel.innerHTML = calendarDayOverviewHtml(date, monthCache, dayDetail, topClientResult);
}

function closeCalendarDayOverview() {
  calendarSelectedDate = null;
  calendarDayOverviewRenderSeq += 1;
  $$(".calendar-day-cell").forEach((cell) => cell.classList.remove("is-selected"));
  const panel = $("#calendarDayOverview");
  if (panel) panel.innerHTML = calendarDayOverviewEmptyHtml();
}

// Hover 툴팁 — Today 캘린더의 positionTodaySalesCalendarTooltip()을 그대로 재사용한다(범용
// anchor/tooltip 위치 계산 함수라 새로 만들 필요가 없다). 노드/HTML만 Calendar 전용으로 따로 둔다.
function calendarTooltipNode() {
  let tooltip = $("#calendarTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "calendarTooltip";
    tooltip.className = "today-sales-calendar-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

// 2026-07-17 Hover UX 개선: "그날 무슨 일이 있었는지"를 5초 안에 읽히게 하는 Rule Base(비-AI)
// 한 줄 인사이트. 지정된 우선순위(1 오프라인 비중≥80% → 2 온라인 비중≥80% → 3 광고비>0 →
// 4 게시물>0 → 5 게시물==0 → 6 그 달 매출 TOP20%)를 순서대로 검사해 처음 매칭되는 규칙 하나만
// 반환한다. 광고비(spend)가 아직 debounce 로딩 중(undefined)이면 3번 규칙만 자연히 건너뛰고,
// loadCalendarDayDetail()이 완료돼 showCalendarTooltip()이 다시 그릴 때 반영된다 — 별도 재계산
// 로직 없이 기존 재렌더 흐름을 그대로 재사용한다.
function calendarTodayInsight(row, spend, postCount, monthCache) {
  const total = Number(row?.totalSales || 0);
  if (total > 0) {
    const offlineRatio = row.offlineAvailable ? Number(row.offlineSales || 0) / total : 0;
    const onlineRatio = row.onlineAvailable ? Number(row.onlineSales || 0) / total : 0;
    if (offlineRatio >= 0.8) return "오프라인 중심 판매";
    if (onlineRatio >= 0.8) return "온라인 중심 판매";
  }
  if (Number(spend) > 0) return "광고 집행일";
  if (Number(postCount) > 0) return "게시물 발행일";
  if (Number(postCount) === 0) return "게시물 업로드 없음";
  if (calendarIsTopRevenueDay(row?.date, monthCache)) return "고매출일";
  return "";
}

// 규칙6("총매출이 해당 월 TOP20%") 판정 — buildTodaySalesCalendarRows()가 이미 만든 rows를
// 그대로 재사용해 그 달의 확인 가능한 날짜들(미래 제외) 중 매출 상위 20%에 드는지 계산한다.
// 새 API 호출 없음(월 데이터는 이미 monthCache에 있음).
function calendarIsTopRevenueDay(date, monthCache) {
  if (!date || !monthCache) return false;
  const monthKey = date.slice(0, 7);
  const rows = buildTodaySalesCalendarRows(monthKey, monthCache.onlineData, monthCache.offlineData);
  const known = rows.filter((item) => !item.future && (item.onlineAvailable || item.offlineAvailable));
  if (known.length < 5) return false; // 표본이 너무 적으면 상위 20% 판정이 의미가 없다
  const sorted = [...known].sort((a, b) => Number(b.totalSales || 0) - Number(a.totalSales || 0));
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.2));
  return sorted.slice(0, topCount).some((item) => item.date === date);
}

// 2026-07-17 버그수정(TASK5): 온라인/오프라인 중 하나만 미확인이어도 "데이터 없음"으로 전체를
// 가리지 않는다. 둘 다 없거나 미래 날짜일 때만 완전한 데이터 없음으로 처리하고, 한쪽만 없으면
// 확인된 쪽 금액은 그대로 보여주고 나머지는 "미확인"으로 명시한다.
//
// 2026-07-17 Hover UX 개선: Today와 중복되는 KPI 나열이 아니라 "총매출(최상단, 가장 크게) →
// 온라인/오프라인 → Today's Insight(Rule Base 한 줄) → TOP 브랜드(표시명+매출) → 광고비(ROAS
// 제거) → 게시물 건수(상세는 Day Overview)" 순서로 재구성했다. 섹션 마크업은 기존
// todaySalesTooltipSection()을 그대로 재사용하고, 총매출만 tone="total"로 강조(CSS 최소 추가).
function calendarTooltipHtml(date, row, monthCache, dayDetail) {
  const bothMissing = !row || (!row.onlineAvailable && !row.offlineAvailable);
  const noData = bothMissing || row?.future;
  if (noData) {
    return `<div class="today-sales-tooltip-card">
      <h5>${esc(salesCalendarLongDate(date))}</h5>
      ${todaySalesTooltipSection("데이터 없음", "-")}
    </div>`;
  }
  const ig = monthCache?.instagramByDate?.get(date) || { count: 0 };
  const metaFailed = Boolean(dayDetail && dayDetail.metaDay?.error);
  const spend = dayDetail?.metaDay && !dayDetail.metaDay.error ? dayDetail.metaDay.totals?.spend : undefined;
  const spendText = metaFailed ? "확인 불가" : (spend === undefined ? "확인 중" : apiWon(spend));
  const topBrand = dayDetail?.topBrand;
  // 대표 표시명: 프로젝트 전체 공통 함수 brandCanonicalDisplayName()을 그대로 재사용한다
  // (영문 Canonical Name 우선 → 없으면 기존 이름 → 그마저 없으면 "미분류").
  const topBrandName = topBrand ? brandCanonicalDisplayName(topBrand) : "";
  const insight = calendarTodayInsight(row, spend, ig.count, monthCache);
  return `<div class="today-sales-tooltip-card">
    <h5>${esc(salesCalendarLongDate(date))}</h5>
    ${todaySalesTooltipSection("총매출", apiWon(row.totalSales), [], "total")}
    ${todaySalesTooltipSection("온라인", row.onlineAvailable ? apiWon(row.onlineSales) : "미확인", [], "online")}
    ${todaySalesTooltipSection("오프라인", row.offlineAvailable ? apiWon(row.offlineSales) : "미확인", [], "offline")}
    ${insight ? `<hr>${todaySalesTooltipSection("💡 Today's Insight", insight)}` : ""}
    <hr>
    ${todaySalesTooltipSection("TOP 브랜드", topBrand ? topBrandName : (dayDetail ? "데이터 없음" : "확인 중"), topBrand ? [apiWon(canonicalBrandPaidAmount(topBrand))] : [])}
    <hr>
    ${todaySalesTooltipSection("광고비", spendText)}
    <hr>
    ${todaySalesTooltipSection("게시물", `${apiNum(ig.count)}건`)}
  </div>`;
}

async function showCalendarTooltip(date, anchor) {
  if (!date || !anchor) return;
  calendarHoverDate = date;
  const monthKey = date.slice(0, 7);
  const monthCache = calendarMonthDataCache.get(monthKey);
  if (!monthCache) return;
  const rows = buildTodaySalesCalendarRows(monthKey, monthCache.onlineData, monthCache.offlineData);
  const row = rows.find((item) => item.date === date) || null;
  const tooltip = calendarTooltipNode();
  tooltip.innerHTML = calendarTooltipHtml(date, row, monthCache, calendarDayDetailCache.get(date) && await calendarDayDetailCache.get(date));
  if (calendarHoverDate !== date) return;
  tooltip.hidden = false;
  tooltip.classList.remove("is-visible");
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  positionTodaySalesCalendarTooltip(anchor, tooltip);
  requestAnimationFrame(() => tooltip.classList.add("is-visible"));
  // noData가 아닌 날짜만, 그리고 아직 상세를 불러온 적 없는 날짜만 debounce 후 day-scoped 호출을
  // 트리거한다(요구사항: hover 시 광고비/TOP 브랜드 필요하지만 마우스가 스쳐 지나가는 셀마다
  // 매번 호출하면 불필요한 재호출이 되므로 300ms 정지 후에만, 그리고 날짜당 한 번만 로드한다).
  const rowHasAnyData = row && (row.onlineAvailable || row.offlineAvailable) && !row.future;
  if (rowHasAnyData && !calendarDayDetailCache.has(date)) {
    clearTimeout(calendarHoverTimer);
    calendarHoverTimer = setTimeout(async () => {
      if (calendarHoverDate !== date) return;
      const detail = await loadCalendarDayDetail(date);
      if (calendarHoverDate !== date) return;
      const liveTooltip = $("#calendarTooltip");
      if (liveTooltip && !liveTooltip.hidden) liveTooltip.innerHTML = calendarTooltipHtml(date, row, monthCache, detail);
    }, 300);
  }
}

function hideCalendarTooltip() {
  calendarHoverDate = null;
  clearTimeout(calendarHoverTimer);
  const tooltip = $("#calendarTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("is-visible");
  tooltip.hidden = true;
}

async function renderCalendarMonth(monthKey = calendarViewMonth) {
  const target = $("#calendarGridContainer");
  if (!target) return;
  monthKey = normalizeCalendarMonth(monthKey);
  calendarViewMonth = monthKey;
  const renderSeq = ++calendarRenderSeq;
  const existing = target.querySelector(".calendar-grid-block");
  hideCalendarTooltip();
  const alreadyCached = calendarMonthDataCache.has(monthKey);
  if (existing) {
    if (!alreadyCached) existing.classList.add("is-loading");
    const switchTarget = existing.querySelector(".calendar-month-switch");
    if (switchTarget) switchTarget.outerHTML = calendarMonthSwitchHtml(monthKey);
  } else if (!alreadyCached) {
    target.innerHTML = calendarLoadingHtml(monthKey);
  }
  const { onlineData, offlineData, instagramByDate } = await loadCalendarMonthData(monthKey);
  if (renderSeq !== calendarRenderSeq) return;
  const rows = buildTodaySalesCalendarRows(monthKey, onlineData, offlineData);
  const maxDailySales = rows.reduce((max, row) => Math.max(max, Number(row.totalSales || 0)), 0);
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const leading = Array.from({ length: firstDay }, () => null);
  const cells = [...leading, ...rows];
  target.innerHTML = `<section class="today-sales-calendar calendar-grid-block monthly-report-block">
    <div class="monthly-report-block-head">
      <div><h4>월별 매출 캘린더</h4><p class="monthly-report-muted">금액은 온라인+오프라인 총매출, 색이 진할수록 그 달 안에서 매출이 높은 날입니다.</p></div>
      ${calendarMonthSwitchHtml(monthKey)}
    </div>
    ${todaySalesCalendarCoverageNote(monthKey, onlineData, offlineData)}
    <div class="today-sales-calendar-weekdays">
      ${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="today-sales-calendar-grid">
      ${cells.map((row) => calendarCellHtml(row, maxDailySales, instagramByDate)).join("")}
    </div>
    <div class="today-sales-calendar-loading-overlay" aria-hidden="true"><span></span></div>
  </section>`;
  requestAnimationFrame(() => target.querySelector(".calendar-grid-block")?.classList.add("is-ready"));
}

function renderCalendarView() {
  if (!$("#calendarDayOverview").innerHTML.trim()) $("#calendarDayOverview").innerHTML = calendarDayOverviewEmptyHtml();
  if (calendarSelectedDate) $$(".calendar-day-cell").forEach((cell) => cell.classList.toggle("is-selected", cell.dataset.calendarDay === calendarSelectedDate));
  renderCalendarMonth(calendarViewMonth);
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
  // STEP66-2: decision을 commerceSummaryState에 실어 보내야 renderCommerceSummary()가
  // (renderOperationsLiveData 쪽 호출을 포함해) 항상 최신 totalSales와 함께
  // renderCommerceSalesSummary()를 다시 그릴 수 있다 — 두 호출 경로 중 하나가 먼저
  // 끝나도 Sales Summary가 stale한 totalSales를 쓰지 않는다(실측으로 발견한 타이밍
  // 버그 수정).
  commerceSummaryState.decision = decision;
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
    return `${row.brand_name || ""} ${row.brand_code || ""} ${brandCanonicalDisplayName(row)}`.toLowerCase().includes(query);
  }).sort((left, right) => {
    if (productBrandSalesSort === "brand_desc") return (right.manufacturer_name || brandCanonicalDisplayName(right)).localeCompare(left.manufacturer_name || brandCanonicalDisplayName(left));
    if (productBrandSalesSort === "salesAmount_desc") return canonicalBrandPaidAmount(right) - canonicalBrandPaidAmount(left);
    if (productBrandSalesSort === "salesAmount_asc") return canonicalBrandPaidAmount(left) - canonicalBrandPaidAmount(right);
    if (productBrandSalesSort === "quantity_desc") return Number(right.quantitySold || 0) - Number(left.quantitySold || 0);
    if (productBrandSalesSort === "quantity_asc") return Number(left.quantitySold || 0) - Number(right.quantitySold || 0);
    if (productBrandSalesSort === "orders_desc") return Number(right.orderCount || 0) - Number(left.orderCount || 0);
    if (productBrandSalesSort === "orders_asc") return Number(left.orderCount || 0) - Number(right.orderCount || 0);
    return (left.manufacturer_name || brandCanonicalDisplayName(left)).localeCompare(right.manufacturer_name || brandCanonicalDisplayName(right));
  });
  const range = productBrandSalesDateRange(selectedMonth());
  metaTarget.textContent = `${range.label} · ${range.since} ~ ${range.until} · ${apiNum(rows.length)}개 브랜드 표시`;
  rowsTarget.innerHTML = rows.length ? rows.map((row) => {
    const brandName = brandCanonicalDisplayName(row);
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
  const brandName = brandCanonicalDisplayName(brand);
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
    const brandName = brandCanonicalDisplayName(product);
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
    if (productSoldSort === "brand_asc") return brandCanonicalDisplayName(left).localeCompare(brandCanonicalDisplayName(right));
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
  const brandOptions = [...new Set(allRows.map((product) => brandCanonicalDisplayName(product)))].sort((left, right) => left.localeCompare(right));
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
    const brandName = brandCanonicalDisplayName(product);
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
  renderMonthRail();
  if (todayViewActive()) renderTodayView(data);
  else todayViewDirty = true;
  renderActiveDestinationCards(data);
  renderReportsMonth(reportsMonth);
  renderContentTabs();
  renderContentOperations(data);
  renderEditorialAi(data);
  renderOtherSections(data);
  updateSync(data);
  // 2026-07-17 버그 수정: 상단 #monthSelect(연/월 드롭다운)의 onchange가 이 renderAll()
  // 하나로만 연결되어 있는데, 지금까지 여기에 Clients 갱신이 빠져 있었다 — operationsRange가
  // 기본값 "month"일 때 operationsDateRange()는 selectedMonth()의 month를 그대로 쓰므로
  // 월을 바꾸면 since/until도 당연히 바뀌어야 하지만, refreshClientsView()가 호출되지 않아
  // Clients 탭이 계속 이전 월 데이터를 보여주고 있었다. 다른 3곳(#operationsRange/Since/Until)과
  // 동일한 가드를 그대로 재사용해, Clients 탭이 활성 상태일 때만 다시 불러온다.
  if ($("#Clients")?.classList.contains("active")) refreshClientsView();
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

// ===== Business Intelligence · Cross Intelligence Phase A =====
// 새 데이터를 만들지 않습니다. 이미 존재하는 4개 기존 엔드포인트(모두 다른 화면이 이미
// 쓰고 있는 것과 동일)를 선택 기간·직전 비교 기간으로 각각 호출해, 브랜드 하나에 대해
// Commerce/Marketing/Content/Clients 값을 나란히 모아 보여줄 뿐입니다. 새 API도, 새
// AI 모델도 추가하지 않았습니다 — 브랜드 매칭은 문자열 정규화/포함 비교만 사용합니다.
const BUSINESS_INTELLIGENCE_WINDOW_DAYS = 14;
const BUSINESS_INTELLIGENCE_MAX_CARDS = 5;
// 광고비 매칭에 쓰는 campaignComparisonNormalize 문자열이 너무 짧으면(2~3자) 아무 캠페인
// 이름에나 우연히 포함될 위험이 커서, 이 길이 미만이면 광고비는 "매칭 안 됨" 처리합니다.
const BUSINESS_INTELLIGENCE_MARKETING_MIN_TOKEN_LEN = 4;

function businessIntelligenceNormalize(value = "") {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// brandFromProduct()와 같은 방식(첫 단어만)으로 Content 게시물 쪽 브랜드 토큰을 추립니다.
// 새 파싱 규칙을 만들지 않고, Content 화면이 이미 쓰는 brandFromProduct()와 동일한
// "첫 단어" 기준을 브랜드 canonical name에도 똑같이 적용해 양쪽을 비교합니다.
function businessIntelligenceFirstToken(value = "") {
  const trimmed = String(value || "").trim();
  return trimmed.split(/\s+/)[0] || "";
}

// 선택 기간(최근 14일)과, 그 직전 같은 길이의 비교 기간. Campaign Sales Analysis에서
// 쓴 campaignComparisonRangeFromExecution()을 그대로 재사용합니다(새 기간 계산 로직 아님).
function businessIntelligenceRange() {
  const currentEnd = campaignComparisonTodayKey();
  const currentStart = campaignComparisonAddDays(currentEnd, -(BUSINESS_INTELLIGENCE_WINDOW_DAYS - 1));
  const cmp = campaignComparisonRangeFromExecution(currentStart, currentEnd);
  return { currentStart, currentEnd, comparisonStart: cmp.comparisonStart, comparisonEnd: cmp.comparisonEnd };
}

// Commerce: /api/diagnostics/brand-sales의 brands[]를 brand_code -> canonical paidAmount로 정리.
// B0000000(개인결제창)과 UNASSIGNED는 실제 브랜드가 아니라 "아직 브랜드로 분류되지 않은
// 상품들을 모아놓은 묶음 코드"라 제외합니다. 실측으로 확인한 근거: brand_code가
// "UNASSIGNED"인 행 하나의 주문 내역에 REMAGINE·PACOSPLY처럼 서로 다른 실제 브랜드
// 상품이 함께 섞여 있었습니다 — 이 코드를 브랜드 하나로 표시하면 두 브랜드의 판매가
// 엉뚱한 브랜드 이름 아래 합쳐져 표시되는 오류가 생깁니다.
function businessIntelligenceCommerceTotals(brandSalesResult) {
  const map = new Map();
  const rows = Array.isArray(brandSalesResult?.brands) ? brandSalesResult.brands : [];
  rows.forEach((row) => {
    const code = String(row.brand_code || "").trim();
    if (!code || code === "B0000000" || code.toUpperCase() === "UNASSIGNED") return;
    map.set(code, (map.get(code) || 0) + canonicalBrandPaidAmount(row));
  });
  return map;
}

// Marketing: /api/meta-ads/full-report의 캠페인명에 브랜드 canonical name이 포함되는
// 캠페인만 골라 광고비를 합산합니다(실제 데이터로 확인: BONNAE POP UP AD 캠페인, CARNET
// ARCHIVE POP-UP처럼 브랜드명이 캠페인명에 그대로 들어간 사례가 다수 있습니다). 매칭되는
// 캠페인이 하나도 없으면(=이 브랜드 광고를 특정할 수 없으면) null을 반환해 카드에 "-"로
// 표시하고, 사실과 다른 0%를 보여주지 않습니다.
function businessIntelligenceMarketingSpend(fullReportResult, normalizedBrand) {
  if (!normalizedBrand || normalizedBrand.length < BUSINESS_INTELLIGENCE_MARKETING_MIN_TOKEN_LEN) return null;
  const rows = Array.isArray(fullReportResult?.rows) ? fullReportResult.rows : [];
  let spend = 0;
  let matched = false;
  rows.forEach((row) => {
    const name = businessIntelligenceNormalize(row.campaignName || "");
    if (name.includes(normalizedBrand)) {
      matched = true;
      spend += Number(row.spend || 0);
    }
  });
  return matched ? spend : null;
}

// Content: /api/instagram/range의 posts[]를 대상으로, Content 화면의 기존 브랜드 식별
// 순서(post.brand || post.tag || brandFromProduct(post.title))를 그대로 재사용해 브랜드
// 토큰을 뽑고, saves(저장) 합계를 냅니다. 매칭되는 게시물이 없으면 null(카드에 "-").
function businessIntelligenceContentSaves(postsResult, brandFirstTokenNormalized) {
  if (!brandFirstTokenNormalized) return null;
  const posts = Array.isArray(postsResult?.posts) ? postsResult.posts : [];
  let saves = 0;
  let matched = false;
  posts.forEach((post) => {
    const key = post.brand || post.tag || brandFromProduct(post.title || "");
    const token = businessIntelligenceNormalize(businessIntelligenceFirstToken(key || ""));
    if (token && token === brandFirstTokenNormalized) {
      matched = true;
      saves += Number(post.saves || 0);
    }
  });
  return matched ? saves : null;
}

// Clients: intelligenceUrl('/api/intelligence/clients')의 clients[].purchaseDetails[]는
// productName이 "브랜드 / 상품 설명" 형태(Cafe24 온라인 상품명과는 다른 오프라인 표기
// 규칙)라, " / " 앞부분을 브랜드 토큰으로 봅니다. clientType이 stylist/foreign인 구매만
// 각각 따로 합산합니다(Clients Intelligence가 이미 분류해 둔 clientType을 그대로 재사용).
function businessIntelligenceClientsTotals(clientsResult) {
  const stylistMap = new Map();
  const foreignMap = new Map();
  const clients = Array.isArray(clientsResult?.clients) ? clientsResult.clients : [];
  clients.forEach((client) => {
    const type = client.clientType;
    if (type !== "stylist" && type !== "foreign") return;
    const map = type === "stylist" ? stylistMap : foreignMap;
    (Array.isArray(client.purchaseDetails) ? client.purchaseDetails : []).forEach((item) => {
      const name = String(item.productName || "");
      const sepIndex = name.indexOf(" / ");
      if (sepIndex === -1) return;
      const brandToken = businessIntelligenceNormalize(name.slice(0, sepIndex));
      if (!brandToken) return;
      map.set(brandToken, (map.get(brandToken) || 0) + Number(item.salesAmount || 0));
    });
  });
  return { stylistMap, foreignMap };
}

// "▲38%"/"▼12%"/"신규"/"-" 형태의 표시 라벨. campaignComparisonRate()와 같은 계산에
// 방향 화살표만 얹었습니다.
function businessIntelligenceRateLabel(current, comparison, matched) {
  if (!matched || current === null || current === undefined) return "-";
  const delta = Number(current || 0) - Number(comparison || 0);
  if (Number(comparison || 0) > 0) {
    const rate = pct(Math.abs(delta) / Number(comparison) * 100);
    if (delta > 0) return `▲${rate}`;
    if (delta < 0) return `▼${rate}`;
    return "변화 없음";
  }
  if (Number(current || 0) > 0) return "신규";
  return "-";
}

function businessIntelligenceDirection(current, comparison, matched) {
  if (!matched || current === null || current === undefined) return null;
  const delta = Number(current || 0) - Number(comparison || 0);
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

// AI Summary. metrics[0]은 항상 매출(기준 지표)입니다. 절대 "광고 때문에"/"콘텐츠
// 때문에"/"매출이 발생했다" 같은 인과 표현을 쓰지 않고, 지시받은 "함께 증가했습니다",
// "같은 기간 관찰되었습니다", "동시에 변화했습니다" 표현만 사용합니다. 최대 5줄(매출 1줄
// + 나머지 지표 최대 3줄 + 마지막 인과관계 아님 고지 1줄)로 구성합니다.
function businessIntelligenceNarrative(brandName, metrics) {
  const sales = metrics[0];
  const salesDirection = businessIntelligenceDirection(sales.current, sales.comparison, sales.matched);
  const salesRate = businessIntelligenceRateLabel(sales.current, sales.comparison, sales.matched);
  const salesVerb = salesDirection === "up" ? "증가" : salesDirection === "down" ? "감소" : "변화 없음";
  const lines = [`${brandName} 매출은 이번 기간 ${salesRate === "-" ? "" : salesRate + " "}${salesVerb}한 것으로 관찰되었습니다.`];

  for (const metric of metrics.slice(1)) {
    if (lines.length >= 4) break;
    if (!metric.matched) {
      lines.push(`${metric.label} 데이터는 이 브랜드와 매칭되지 않아 이번 분석에서 제외했습니다.`);
      continue;
    }
    const direction = businessIntelligenceDirection(metric.current, metric.comparison, metric.matched);
    if (direction === "flat") {
      lines.push(`${metric.label}은(는) 같은 기간 뚜렷한 변화 없이 관찰되었습니다.`);
    } else if (direction === salesDirection) {
      lines.push(`${metric.label}도 매출과 함께 ${direction === "up" ? "증가" : "감소"}했습니다.`);
    } else {
      lines.push(`${metric.label}은(는) 매출과 다른 방향으로 동시에 변화했습니다(${direction === "up" ? "증가" : "감소"}).`);
    }
  }
  lines.push("위 지표는 같은 기간 함께 관찰된 변화이며, 인과관계를 의미하지 않습니다.");
  return lines.join(" ");
}

function businessIntelligenceCardHtml(card, index) {
  const metricsHtml = card.metrics.map((metric) => {
    const rate = businessIntelligenceRateLabel(metric.current, metric.comparison, metric.matched);
    return `<div class="intelligence-issue-metric"><em>${esc(metric.label)}</em><b>${esc(rate)}</b></div>`;
  }).join("");
  return `<article class="intelligence-issue-card">
    <div class="intelligence-issue-card-header">
      <span class="intelligence-issue-rank">${String(index + 1).padStart(2, "0")}</span>
      <div class="intelligence-issue-badges"><small class="intelligence-source-badge">Cross Intelligence</small></div>
    </div>
    <div class="intelligence-issue-title"><strong class="intelligence-issue-brand">${esc(card.brandName)}</strong></div>
    <div class="intelligence-issue-body"><p class="intelligence-issue-copy">${esc(card.narrative)}</p></div>
    <div class="intelligence-issue-metrics">${metricsHtml}</div>
  </article>`;
}

// 4개 기존 엔드포인트를 선택 기간·비교 기간으로 각각 호출(getSharedJson이라 다른 화면이
// 같은 기간을 이미 불러왔다면 재사용됩니다). Commerce 데이터를 브랜드 후보 목록의
// 기준으로 삼고(가장 신뢰도 높은 브랜드 식별자 = brand_code), 나머지 3개 도메인은 이
// 브랜드 목록에 매칭을 "시도"만 합니다 — 매칭 안 되면 해당 지표만 "-"로 빠집니다.
async function businessIntelligenceCompute() {
  const range = businessIntelligenceRange();
  const { currentStart, currentEnd, comparisonStart, comparisonEnd } = range;
  const [
    currentCommerce, comparisonCommerce,
    currentMarketing, comparisonMarketing,
    currentContent, comparisonContent,
    currentClients, comparisonClients
  ] = await Promise.all([
    getSharedJson(`/api/diagnostics/brand-sales?since=${currentStart}&until=${currentEnd}`, 15000),
    getSharedJson(`/api/diagnostics/brand-sales?since=${comparisonStart}&until=${comparisonEnd}`, 15000),
    getSharedJson(`/api/meta-ads/full-report?since=${currentStart}&until=${currentEnd}`, 15000),
    getSharedJson(`/api/meta-ads/full-report?since=${comparisonStart}&until=${comparisonEnd}`, 15000),
    getSharedJson(`/api/instagram/range?since=${currentStart}&until=${currentEnd}`, 15000),
    getSharedJson(`/api/instagram/range?since=${comparisonStart}&until=${comparisonEnd}`, 15000),
    getSharedJson(intelligenceUrl(`/api/intelligence/clients?since=${currentStart}&until=${currentEnd}`), 20000),
    getSharedJson(intelligenceUrl(`/api/intelligence/clients?since=${comparisonStart}&until=${comparisonEnd}`), 20000)
  ]);

  if (currentCommerce.error || !Array.isArray(currentCommerce.brands)) {
    return { error: currentCommerce.error || "Commerce 데이터를 확인할 수 없습니다.", cards: [] };
  }

  const currentCommerceMap = businessIntelligenceCommerceTotals(currentCommerce);
  const comparisonCommerceMap = businessIntelligenceCommerceTotals(comparisonCommerce.error ? {} : comparisonCommerce);

  const candidates = [...currentCommerceMap.keys()]
    .map((code) => {
      const current = currentCommerceMap.get(code) || 0;
      const comparison = comparisonCommerceMap.get(code) || 0;
      return { code, current, comparison, delta: current - comparison };
    })
    .filter((row) => row.current > 0 || row.comparison > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, BUSINESS_INTELLIGENCE_MAX_CARDS);

  const currentClientsMaps = currentClients.error ? null : businessIntelligenceClientsTotals(currentClients);
  const comparisonClientsMaps = comparisonClients.error ? null : businessIntelligenceClientsTotals(comparisonClients);

  const cards = candidates.map((row) => {
    const brandName = brandCanonicalDisplayName({ brand_code: row.code });
    const normalizedBrand = businessIntelligenceNormalize(brandName);
    const brandFirstTokenNormalized = businessIntelligenceNormalize(businessIntelligenceFirstToken(brandName));

    const salesMetric = { label: "매출", current: row.current, comparison: row.comparison, matched: true };

    const spendCurrent = businessIntelligenceMarketingSpend(currentMarketing, normalizedBrand);
    const spendComparison = businessIntelligenceMarketingSpend(comparisonMarketing, normalizedBrand);
    const spendMetric = { label: "광고비", current: spendCurrent || 0, comparison: spendComparison || 0, matched: spendCurrent !== null || spendComparison !== null };

    const savesCurrent = businessIntelligenceContentSaves(currentContent, brandFirstTokenNormalized);
    const savesComparison = businessIntelligenceContentSaves(comparisonContent, brandFirstTokenNormalized);
    const contentMetric = { label: "콘텐츠 저장", current: savesCurrent || 0, comparison: savesComparison || 0, matched: savesCurrent !== null || savesComparison !== null };

    const stylistCurrent = currentClientsMaps ? currentClientsMaps.stylistMap.get(normalizedBrand) : undefined;
    const stylistComparison = comparisonClientsMaps ? comparisonClientsMaps.stylistMap.get(normalizedBrand) : undefined;
    const stylistMetric = { label: "스타일리스트 구매", current: stylistCurrent || 0, comparison: stylistComparison || 0, matched: stylistCurrent !== undefined || stylistComparison !== undefined };

    const foreignCurrent = currentClientsMaps ? currentClientsMaps.foreignMap.get(normalizedBrand) : undefined;
    const foreignComparison = comparisonClientsMaps ? comparisonClientsMaps.foreignMap.get(normalizedBrand) : undefined;
    const foreignMetric = { label: "외국인 구매", current: foreignCurrent || 0, comparison: foreignComparison || 0, matched: foreignCurrent !== undefined || foreignComparison !== undefined };

    const metrics = [salesMetric, spendMetric, contentMetric, stylistMetric, foreignMetric];
    return { brandCode: row.code, brandName, metrics, narrative: businessIntelligenceNarrative(brandName, metrics) };
  });

  return { error: null, cards, range };
}

async function renderBusinessIntelligence(target, renderSeq) {
  if (!target) return;
  target.innerHTML = `<article class="action-item"><strong>Business Intelligence 계산 중</strong><p>Commerce·Marketing·Content·Clients 데이터를 함께 불러오고 있습니다.</p></article>`;
  const result = await businessIntelligenceCompute();
  if (renderSeq !== undefined && renderSeq !== intelligenceRenderSeq) return;
  if (result.error) {
    target.innerHTML = `<article class="action-item"><strong>Business Intelligence 확인 불가</strong><p>${esc(result.error)}</p></article>`;
    return;
  }
  if (!result.cards.length) {
    target.innerHTML = `<p class="hint-text">이번 기간에 비교할 수 있는 브랜드 매출 데이터가 없습니다.</p>`;
    return;
  }
  target.innerHTML = result.cards.map((card, index) => businessIntelligenceCardHtml(card, index)).join("");
}

async function renderIntelligenceDashboard() {
  const statusTarget = $("#intelligenceStatus");
  const briefTarget = $("#intelligenceBrief");
  const missionTarget = $("#intelligenceMissions");
  if (!statusTarget || !briefTarget || !missionTarget) return;
  const renderSeq = ++intelligenceRenderSeq;
  renderBusinessIntelligence($("#businessIntelligenceCards"), renderSeq);
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
  // 2026-07-18 Brand Display Name 통일: 이 브랜드 상세 화면 자체가 방금 받아온 product
  // 데이터에서 못 찾으면, 프로젝트 전역 공통 캐시(brandCanonicalNameCache, 다른 화면들이
  // /api/diagnostics/brand-sales를 부를 때마다 채워짐)를 마지막으로 한 번 더 확인합니다.
  return intelligenceCafe24BrandDisplayName(input)
    || intelligenceCafe24BrandDisplayName(detail)
    || intelligenceRepresentativeEnglishAlias(input)
    || intelligenceRepresentativeEnglishAlias(detail)
    || (brand?.id && brandCanonicalNameCache.has(brand.id) ? brandCanonicalNameCache.get(brand.id) : "")
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
    if (metrics.length < 3 && Number.isFinite(Number(evidence.paidAmount ?? evidence.salesAmount))) metrics.push({ label: "온라인 매출", value: apiWon(evidence.paidAmount ?? evidence.salesAmount) });
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
    <span>${esc(brandCanonicalDisplayName(item.brand))}</span>
    <strong>${esc(item.title || "Mission")}</strong>
    <p>${esc(item.reason || "Mission 근거 없음")}</p>
  </article>`;
}

function intelligenceMissionCard(mission = {}) {
  const signalIds = Array.isArray(mission.signalIds) ? mission.signalIds.join(",") : "";
  return `<article class="action-item sales-list-card"
    data-mission-id="${esc(mission.id || "")}"
    data-brand-id="${esc(mission.brand?.id || "")}"
    data-brand-name="${esc(brandCanonicalDisplayName(mission.brand))}"
    data-priority="${esc(mission.priority || "")}"
    data-source-action-id="${esc(mission.sourceActionId || "")}"
    data-signal-ids="${esc(signalIds)}">
    ${intelligencePriorityBadge(mission.priority)}
    <span>${esc(brandCanonicalDisplayName(mission.brand))}</span>
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
  if (Number.isFinite(Number(commerce.paidAmount ?? commerce.salesAmount))) {
    addEvent({
      category: "commerce",
      type: "sales",
      title: "온라인 매출 확인",
      description: `최근 온라인 매출 ${apiWon(commerce.paidAmount ?? commerce.salesAmount)} · 주문 ${apiNum(commerce.orderCount)}건 · 판매수량 ${apiNum(commerce.quantitySold)}개`
    });
  }
  if (Array.isArray(commerce.products)) {
    commerce.products.slice(0, 3).forEach((product) => addEvent({
      category: "commerce",
      type: "product",
      title: product.productName || "판매 상품",
      description: `온라인 매출 ${apiWon(product.paidAmount ?? product.salesAmount)} · 주문 ${apiNum(product.orderCount)}건 · 수량 ${apiNum(product.quantitySold)}개`
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
  if (Number.isFinite(Number(evidence.paidAmount ?? evidence.salesAmount))) parts.push(`온라인 매출 ${apiWon(evidence.paidAmount ?? evidence.salesAmount)}`);
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
    { label: "브랜드 온라인 매출", value: Number.isFinite(Number(commerce.paidAmount ?? commerce.salesAmount)) ? apiWon(commerce.paidAmount ?? commerce.salesAmount) : "데이터 없음", note: "Cafe24 실제 결제 기준" },
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
    <span>${esc(brandCanonicalDisplayName({ brand_code: decision.brandId, brand_name: intelligenceBrandLabel(decision.brandId, brands) }))}</span>
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
      summary: "선택 기간 실제 결제 매출이 확인되었습니다.",
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
  if (Number.isFinite(Number(input?.commerce?.data?.paidAmount ?? input?.commerce?.data?.salesAmount))) return "선택 기간 실제 결제 매출이 확인되었습니다.";
  return event.description || event.title || "Intelligence 이벤트가 기록되었습니다.";
}

function intelligenceTimelineSalesBrandName(row = null) {
  if (!row) return "";
  const name = brandCanonicalDisplayName(row);
  return name === "미분류" ? "" : name;
}

function intelligenceTimelineMetrics(detail = {}, input = {}, salesRecord = null) {
  const commerce = input?.commerce?.data || {};
  const metrics = [];
  if (Number.isFinite(Number(commerce.paidAmount ?? commerce.salesAmount))) metrics.push({ label: "최근 판매", value: apiWon(commerce.paidAmount ?? commerce.salesAmount) });
  if (Number.isFinite(Number(commerce.orderCount))) metrics.push({ label: "주문", value: `${apiNum(commerce.orderCount)}건` });
  if (Number.isFinite(Number(commerce.quantitySold))) metrics.push({ label: "판매수량", value: `${apiNum(commerce.quantitySold)}개` });
  if (!metrics.length && salesRecord) {
    if (Number.isFinite(Number(salesRecord?.sales?.paidAmount ?? salesRecord.canonicalPaidAmount ?? salesRecord.salesAmount))) metrics.push({ label: "최근 판매", value: apiWon(salesRecord?.sales?.paidAmount ?? salesRecord.canonicalPaidAmount ?? salesRecord.salesAmount) });
    if (Number.isFinite(Number(salesRecord.orderCount))) metrics.push({ label: "주문", value: `${apiNum(salesRecord.orderCount)}건` });
    if (Number.isFinite(Number(salesRecord.quantitySold))) metrics.push({ label: "판매수량", value: `${apiNum(salesRecord.quantitySold)}개` });
  }
  if (!metrics.length && Array.isArray(detail.signals)) {
    for (const signal of detail.signals) {
      const evidence = signal.evidence || {};
      if (metrics.length < 3 && Number.isFinite(Number(evidence.paidAmount ?? evidence.salesAmount))) metrics.push({ label: "최근 판매", value: apiWon(evidence.paidAmount ?? evidence.salesAmount) });
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
    <span>${esc(brandCanonicalDisplayName({ brand_code: item.brandId, brand_name: intelligenceBrandLabel(item.brandId, brands) }))}</span>
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
    <span>${esc(brandCanonicalDisplayName({ brand_code: item.brandId, brand_name: intelligenceBrandLabel(item.brandId, brands) }))}</span>
    <strong>${esc(item.decision || "Learning Case")}</strong>
    <p>${esc((item.matchedBy || []).join(", ") || "matchedBy 없음")}</p>
    <small>${esc(item.sourceActionId || "-")}</small>
  </article>`;
}

// ---------------------------------------------------------------------------
// Clients v1 (2026-07-17). intelligence-service.mjs의 /api/intelligence/clients
// (buildClientsOverview)를 호출해 상단 공용 기간 선택(operationsRange 등)에
// 맞춰 고객 현황을 표시한다. 기존 renderOperationsSections() 파이프라인에는
// 얹지 않고, Clients 탭이 활성 상태일 때만 자체 renderSeq로 갱신한다.
// ---------------------------------------------------------------------------

const CLIENTS_TYPE_LABELS = {
  stylist: "스타일리스트",
  samplas_press: "프레스",
  customer: "일반 손님",
  foreign: "외국인",
  online_first_signup: "온라인 첫가입",
  ff: "직원 구매"
};
const CLIENTS_LIST_PAGE_SIZE = 20;
// TOP10/목록/도넛 호버에 쓰는 데이터 저장소. key -> {kind, ...}. kind는 "top10"/"list"/"donut".
// 렌더될 때마다 채워지고, DOM에 없는 키는 그냥 참조되지 않아 문제되지 않는다(탭 전환/재조회 시 자연 교체).
let clientsTooltipData = new Map();
// 도넛 조각 hover용 상태 (2026-07-17 UI 개선). 도넛은 단일 conic-gradient div라 개별 조각이
// DOM으로 쪼개져 있지 않다 — 새 SVG나 차트 라이브러리를 추가하지 않고 기존 구현을 유지하기 위해,
// pointermove 시 중심 기준 각도를 계산해 어느 유형 구간인지 판정하는 방식으로 최소 구현한다.
let clientsDonutRanges = [];
let clientsDonutActiveType = null;
let clientsTooltipHideTimer = null;
// 2026-07-17 최종 정정(TASK4/5): TOP10/고객 목록의 "고객 상세"는 hover tooltip을 완전히 그만두고
// 클릭 시 여는 모달로 전환한다. 도넛/범례는 사용자가 명시한 대로 "가벼운 비율 안내"만 남기고
// 계속 hover(clientsTooltipData/showClientsTooltipForKey)를 쓰므로, 고객 상세용 데이터는 별도
// Map(clientsDetailStore)에 저장해 두 상호작용 모델이 서로 섞이지 않게 한다.
let clientsDetailStore = new Map();
let clientsDetailActiveKey = null;
let clientsDetailShowAllDates = false;
let clientsDetailShowAllAliasStats = false;
let clientsDetailShowAllTimeline = false;
let clientsDetailPreviousFocus = null;
let clientsDetailDateHideTimer = null;

function getClientsOverviewJson(url, requestKey, timeoutMs = 60000) {
  if (clientsRequestsInFlight.has(requestKey)) return clientsRequestsInFlight.get(requestKey);
  const promise = getJson(url, timeoutMs);
  clientsRequestsInFlight.set(requestKey, promise);
  promise.finally(() => {
    if (clientsRequestsInFlight.get(requestKey) === promise) clientsRequestsInFlight.delete(requestKey);
  });
  return promise;
}

async function refreshClientsView() {
  const statusTarget = $("#clientsStatus");
  const summaryTarget = $("#clientsSummaryCards");
  const breakdownTarget = $("#clientsTypeBreakdown");
  const top10Target = $("#clientsTop10");
  if (!statusTarget || !summaryTarget || !breakdownTarget || !top10Target) return;
  const renderSeq = ++clientsRenderSeq;
  clientsListVisibleCount = CLIENTS_LIST_PAGE_SIZE;
  statusTarget.className = "ad-status-banner loading";
  statusTarget.innerHTML = `<span class="status-dot"></span><strong>고객 데이터를 불러오고 있습니다.</strong><span class="note">ECOUNT/Cafe24 데이터를 집계하는 중입니다.</span>`;
  if (!clientsOverviewState) {
    summaryTarget.innerHTML = `<article class="action-item sales-kpi-card is-disabled"><span>불러오는 중</span><strong>-</strong><p>-</p></article>`.repeat(5);
    breakdownTarget.innerHTML = "";
    top10Target.innerHTML = "";
  }
  const range = operationsDateRange();
  const query = `?since=${encodeURIComponent(range.since)}&until=${encodeURIComponent(range.until)}`;
  // STEP48: ECOUNT 동기화 시각 표시용. 새 API를 만들지 않고, Monthly/Today가 이미 쓰는
  // /api/ecount-sales/monthly를 재사용해 importedAt만 함께 읽는다(계산에는 쓰지 않음).
  const ecountFreshnessMonth = String(range.until || "").slice(0, 7);
  const [data, ecountFreshnessSnapshot] = await Promise.all([
    getClientsOverviewJson(
      intelligenceUrl(`/api/intelligence/clients${query}`),
      `${range.since}|${range.until}`
    ),
    /^\d{4}-\d{2}$/.test(ecountFreshnessMonth) ? getJson(`/api/ecount-sales/monthly?month=${ecountFreshnessMonth}`, 6000) : Promise.resolve(null)
  ]);
  if (renderSeq !== clientsRenderSeq) return;
  if (data.error || !data.ok) {
    statusTarget.className = "ad-status-banner error";
    statusTarget.innerHTML = `<span class="status-dot"></span><strong>고객 데이터를 불러오지 못했습니다.</strong><span class="note">${esc(data.error || data.message || "Intelligence Service 연결을 확인해주세요.")}</span>`;
    summaryTarget.innerHTML = `<article class="action-item sales-empty-card"><strong>Clients 데이터를 불러오지 못했습니다.</strong><p>Intelligence Service 상태를 확인한 뒤 다시 시도해주세요.</p></article>`;
    breakdownTarget.innerHTML = "";
    top10Target.innerHTML = "";
    clientsOverviewState = null;
    renderClientsList();
    return;
  }
  statusTarget.className = "ad-status-banner good";
  statusTarget.innerHTML = `<span class="status-dot"></span><strong>고객 데이터 연결됨</strong><span class="note">${esc(range.label)} · ${esc(data.periodStart || range.since)} ~ ${esc(data.periodEnd || range.until)}</span>`;
  clientsOverviewState = data;
  renderClientsSummaryCards(data.summary || {}, (data.typeBreakdown || []).find((row) => row.type === "ff") || {});
  renderClientsTypeBreakdown(data.typeBreakdown || [], data.summary || {});
  renderClientsTop10(data.stylistTop10 || [], data.pressTop10 || [], data.ffTop10 || []);
  renderClientsList();
  // STEP48A: Cafe24 온라인 주문은 디스크 캐시(파일 mtime 기준)를, 오프라인은 ECOUNT 수동
  // 업로드 스냅샷(importedAt)을 쓴다. Cafe24 캐시 쪽 생성 시각은 intelligence-service.mjs
  // 내부에서만 계산되고 API 응답에 노출되지 않는다(이번 STEP은 intelligence-service.mjs
  // 수정 금지) — 존재하지 않는 값을 추측해 넣지 않고, ECOUNT 시각만 표시하며 Cafe24 캐시
  // 시각은 확인 불가임을 note에 명시한다.
  renderFreshnessHeader("clientsFreshnessHeader", {
    status: "cache",
    dataAsOf: `${data.periodStart || range.since} ~ ${data.periodEnd || range.until}`,
    lastUpdated: ecountFreshnessSnapshot && !ecountFreshnessSnapshot.error ? ecountFreshnessSnapshot.importedAt : null,
    note: "Cafe24 온라인 전체 주문(캐시)과 오프라인(ECOUNT 스냅샷) 데이터를 합산합니다. 두 소스 모두 자동 재동기화되지 않습니다. 'Last Updated'는 오프라인(ECOUNT) 마지막 업로드 시각이며, 온라인(Cafe24) 캐시 생성 시각은 현재 API로 노출되지 않아 별도 표시하지 못합니다."
  });
}

function renderClientsSummaryCards(summary = {}, ff = {}) {
  const target = $("#clientsSummaryCards");
  if (!target) return;
  target.innerHTML = [
    salesKpiCard("전체 고객 수", `${apiNum(summary.totalClients)}명`, "기간 내 구매가 발생한 고객 기준"),
    salesKpiCard("전체 구매 건수", `${apiNum(summary.totalPurchaseCount)}건`, "온라인(개인결제창) + 오프라인 합산"),
    salesKpiCard("전체 매출", apiWon(summary.totalSalesAmount), "온라인(개인결제창) + 오프라인 합산"),
    salesKpiCard("평균 구매금액", apiWon(summary.avgOrderValue), "전체 매출 / 전체 구매 건수"),
    salesKpiCard("FF · 직원 구매", `${apiNum(ff.purchaseCount)}건`, `${apiNum(ff.clientCount)}명 · ${apiWon(ff.salesAmount)}`)
  ].join("");
}

// hex(#rrggbb) 색을 흰색 쪽으로 amount(0~1)만큼 섞는다. 새 색상을 추가하는 게 아니라
// 기존 모노크롬 팔레트 안에서 "비활성 조각을 옅게" 만드는 용도로만 쓴다.
function lightenHex(hex, amount) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return hex;
  const num = parseInt(match[1], 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const mix = (channel) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// 도넛 conic-gradient 문자열을 만든다. activeType이 있으면 그 유형만 원래 색을 유지하고
// 나머지는 옅게 처리해 hover 강조를 표현한다(새 색상 추가 없이 기존 팔레트만 사용).
function clientsDonutGradient(ranges, activeType) {
  if (!ranges.length) return "#dedbd2 0% 100%";
  return ranges.map((row) => {
    const color = activeType && row.type !== activeType ? lightenHex(row.color, 0.55) : row.color;
    return `${color} ${row.start}% ${row.end}%`;
  }).join(", ");
}

// pointermove 좌표를 도넛 중심 기준 각도(0~360, 12시 방향이 0, 시계방향)로 바꾼 뒤
// conic-gradient와 동일한 퍼센트 기준으로 어느 유형 구간에 속하는지 찾는다.
function clientsDonutAngleToType(ranges, event, donutEl) {
  if (!ranges.length) return null;
  const rect = donutEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const radius = Math.min(rect.width, rect.height) / 2;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // 도넛 중앙 구멍(.clients-donut-center, inset 18px ≈ 반지름의 27%) 위에서는 조각으로 치지 않는다.
  if (dist > radius || dist < radius * 0.3) return null;
  let deg = Math.atan2(dx, -dy) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  const pctPos = (deg / 360) * 100;
  const found = ranges.find((row) => pctPos >= row.start && pctPos < row.end);
  return found ? found.type : (ranges[ranges.length - 1]?.type || null);
}

// 도넛 조각 hover와 범례 행 hover가 같은 강조 상태를 공유하도록 하는 단일 진입점.
// (Task 3/4: "동일한 hover 상태를 공유" — 렌더 함수도, 강조 갱신 함수도 하나만 둔다.)
function setActiveDonutType(type) {
  clientsDonutActiveType = type || null;
  const donut = $("#Clients .clients-donut");
  if (donut) {
    donut.style.background = `conic-gradient(${clientsDonutGradient(clientsDonutRanges, clientsDonutActiveType)})`;
    donut.classList.toggle("is-hovering", Boolean(clientsDonutActiveType));
  }
  $$("#Clients .clients-donut-legend li").forEach((li) => {
    li.classList.toggle("is-active", Boolean(clientsDonutActiveType) && li.dataset.clientsType === clientsDonutActiveType);
  });
}

// 도넛/범례 hover 툴팁 내용 계산. typeBreakdown에 이미 있는 값(비율/건수/고객수/매출)은
// 그대로 쓰고, 유형별 TOP3(구매건수/매출)는 API 응답에 없으므로 스펙에서 명시적으로 허용한 대로
// clientsOverviewState.clients를 유형별로 필터링해 프론트에서 계산한다(새 서버 필드 추가 없음).
function clientsTypeDetail(row, summary) {
  const type = row.type;
  const totalSalesAmount = Number(summary?.totalSalesAmount || 0);
  const salesAmount = Number(row.salesAmount || 0);
  const purchaseCount = Number(row.purchaseCount || 0);
  const salesRatioPct = totalSalesAmount > 0 ? (salesAmount / totalSalesAmount) * 100 : 0;
  const avgOrderValue = purchaseCount > 0 ? salesAmount / purchaseCount : null;
  const clientsOfType = (Array.isArray(clientsOverviewState?.clients) ? clientsOverviewState.clients : [])
    .filter((client) => client.clientType === type);
  const byCount = (a, b) => (Number(b.purchaseCount || 0) - Number(a.purchaseCount || 0))
    || (Number(b.totalSales || 0) - Number(a.totalSales || 0))
    || String(a.name || "").localeCompare(String(b.name || ""), "ko");
  const bySales = (a, b) => (Number(b.totalSales || 0) - Number(a.totalSales || 0))
    || (Number(b.purchaseCount || 0) - Number(a.purchaseCount || 0))
    || String(a.name || "").localeCompare(String(b.name || ""), "ko");
  return {
    kind: "donut",
    type,
    label: row.label || CLIENTS_TYPE_LABELS[type] || type,
    ratioPct: Number(row.ratioPct || 0),
    purchaseCount,
    clientCount: Number(row.clientCount || 0),
    salesAmount,
    avgOrderValue,
    salesRatioPct,
    top3ByCount: clientsOfType.slice().sort(byCount).slice(0, 3),
    top3BySales: clientsOfType.slice().sort(bySales).slice(0, 3)
  };
}

function renderClientsTypeBreakdown(typeBreakdown = [], summary = {}) {
  const target = $("#clientsTypeBreakdown");
  if (!target) return;
  const totalSalesAmount = Number(summary.totalSalesAmount || 0);
  clientsDonutRanges = [];
  clientsDonutActiveType = null;
  if (!typeBreakdown.length || totalSalesAmount <= 0) {
    target.innerHTML = `<article class="action-item sales-empty-card"><strong>해당 기간 구매 데이터가 없습니다.</strong><p>기간을 변경해 다시 확인해주세요.</p></article>`;
    return;
  }
  const rows = typeBreakdown.map((row) => ({
    ...row,
    salesRatioPct: (Number(row.salesAmount || 0) / totalSalesAmount) * 100
  }));
  const donutColors = ["#171717", "#6d6a62", "#b7b2a4", "#dedbd2", "#376fe3", "#c76a35"];
  let cursor = 0;
  clientsDonutRanges = rows.map((row, index) => {
    const ratio = Number(row.salesRatioPct || 0);
    const start = cursor;
    const end = cursor + ratio;
    cursor = end;
    return { type: row.type, start, end, color: donutColors[index % donutColors.length] };
  });
  const gradientStops = clientsDonutGradient(clientsDonutRanges, null);
  const donutAriaLabel = rows.map((row) => `${row.label || CLIENTS_TYPE_LABELS[row.type] || row.type} ${pct(row.salesRatioPct)}`).join(", ");
  target.innerHTML = `<section class="ops-summary-hero">
    <div class="ops-summary-hero-main clients-donut-card">
      <div class="clients-donut" style="background: conic-gradient(${gradientStops})" role="img" aria-label="고객 유형별 매출 비율: ${esc(donutAriaLabel)}">
        <div class="clients-donut-center">
          <strong>${apiWon(summary.totalSalesAmount)}</strong>
          <span>전체 실제 매출</span>
        </div>
      </div>
      <ul class="clients-donut-legend">
        ${rows.map((row, index) => {
          const key = `donut-${row.type}`;
          clientsTooltipData.set(key, clientsTypeDetail(row, summary));
          const muted = Number(row.purchaseCount || 0) ? "" : "is-muted";
          return `<li class="${muted}" data-clients-type="${esc(row.type)}" data-clients-tooltip="${esc(key)}" aria-describedby="clientsHoverTooltip" tabindex="0">
            <i style="background:${donutColors[index % donutColors.length]}"></i>
            <span class="clients-legend-label">${esc(row.label || CLIENTS_TYPE_LABELS[row.type] || row.type)}</span>
            <span class="clients-legend-stats">${pct(row.salesRatioPct)} · ${apiWon(row.salesAmount)} · ${apiNum(row.purchaseCount)}건</span>
          </li>`;
        }).join("")}
      </ul>
    </div>
  </section>`;
}

function renderClientsTop10(stylistTop10 = [], pressTop10 = [], ffTop10 = []) {
  const target = $("#clientsTop10");
  if (!target) return;
  // 서버 TOP10 응답 자체에는 aliases가 없다(데이터 집계/서버 로직은 이번 작업 범위 밖) — 같은 응답에
  // 이미 들어있는 clientsOverviewState.clients를 clientId로 매칭해 aliases만 프론트에서 보충한다.
  const fullClientsById = new Map(
    (Array.isArray(clientsOverviewState?.clients) ? clientsOverviewState.clients : []).map((client) => [client.clientId, client])
  );
  const toRow = (client, index, type) => {
    const key = `top10-${type}-${index}`;
    const full = fullClientsById.get(client.clientId) || {};
    // TASK4: TOP10 행은 이제 hover tooltip이 아니라 클릭 시 여는 고객 상세 모달의 트리거다.
    // 모달에는 서버 TOP10 응답에 없는 필드(onlineSales/offlineSales/avgOrderValue/
    // latestPurchaseDate/purchaseDetails)도 필요해서, aliases와 동일한 방식으로
    // clientsOverviewState.clients에서 clientId로 원본 레코드를 찾아 보충한다.
    clientsDetailStore.set(key, {
      clientId: client.clientId,
      name: client.name,
      clientType: type,
      typeLabel: CLIENTS_TYPE_LABELS[type] || type,
      purchaseCount: client.purchaseCount,
      salesAmount: client.salesAmount,
      onlineSales: full.onlineSales,
      offlineSales: full.offlineSales,
      avgOrderValue: full.avgOrderValue,
      latestPurchaseDate: full.latestPurchaseDate,
      // TASK4(2026-07-17 최종 정정): "선택 기간"은 이 응답을 만든 Clients since/until 그대로다
      // (buildClientsOverview()가 periodStart/periodEnd로 그대로 돌려준다) — 새로 계산하지 않는다.
      periodStart: clientsOverviewState?.periodStart || null,
      periodEnd: clientsOverviewState?.periodEnd || null,
      aliases: Array.isArray(full.aliases) ? full.aliases : [],
      products: Array.isArray(client.products) ? client.products : [],
      purchaseDetails: Array.isArray(full.purchaseDetails) ? full.purchaseDetails : []
    });
    return `<div class="ops-summary-rank-row" data-clients-detail="${esc(key)}" role="button" aria-haspopup="dialog" tabindex="0">
      <span class="ops-summary-rank-no">${String(index + 1).padStart(2, "0")}</span>
      <strong>${esc(client.name || "-")}</strong>
      <em>${esc(`${apiNum(client.purchaseCount)}건 · ${apiWon(client.salesAmount)}`)}</em>
    </div>`;
  };
  target.innerHTML = `<section class="ops-summary-cols clients-top10-cols">
    <div class="ops-summary-block">
      <div class="ops-summary-block-head"><h4>스타일리스트 TOP 10</h4><span>매출액 desc · 구매건수 desc · 이름 asc</span></div>
      ${stylistTop10.length ? stylistTop10.map((client, index) => toRow(client, index, "stylist")).join("") : `<p class="hint-text">해당 기간 스타일리스트 구매 데이터가 없습니다.</p>`}
    </div>
    <div class="ops-summary-block">
      <div class="ops-summary-block-head"><h4>프레스 TOP 10</h4><span>매출액 desc · 구매건수 desc · 이름 asc</span></div>
      ${pressTop10.length ? pressTop10.map((client, index) => toRow(client, index, "samplas_press")).join("") : `<p class="hint-text">해당 기간 프레스 구매 데이터가 없습니다.</p>`}
    </div>
    <div class="ops-summary-block">
      <div class="ops-summary-block-head"><h4>FF TOP 10</h4><span>매출액 desc · 구매건수 desc · 이름 asc</span></div>
      ${ffTop10.length ? ffTop10.map((client, index) => toRow(client, index, "ff")).join("") : `<p class="hint-text">해당 기간 직원 구매 데이터가 없습니다.</p>`}
    </div>
  </section>`;
}

function filterAndSortClientsList() {
  const source = Array.isArray(clientsOverviewState?.clients) ? clientsOverviewState.clients : [];
  const query = clientsListSearch.trim().toLocaleLowerCase("ko-KR");
  let rows = source.filter((client) => {
    if (clientsListTypeFilter !== "all" && client.clientType !== clientsListTypeFilter) return false;
    if (!query) return true;
    const name = String(client.name || "").toLocaleLowerCase("ko-KR");
    const contact = String(client.contact || "").toLocaleLowerCase("ko-KR");
    const aliases = Array.isArray(client.aliases) ? client.aliases : [];
    const aliasMatch = aliases.some((alias) => String(alias || "").toLocaleLowerCase("ko-KR").includes(query));
    return name.includes(query) || contact.includes(query) || aliasMatch;
  });
  const sorters = {
    recent_desc: (a, b) => String(b.latestPurchaseDate || "").localeCompare(String(a.latestPurchaseDate || "")),
    sales_desc: (a, b) => Number(b.totalSales || 0) - Number(a.totalSales || 0),
    sales_asc: (a, b) => Number(a.totalSales || 0) - Number(b.totalSales || 0),
    count_desc: (a, b) => Number(b.purchaseCount || 0) - Number(a.purchaseCount || 0),
    name_asc: (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko")
  };
  const sorter = sorters[clientsListSort] || sorters.recent_desc;
  rows = rows.slice().sort(sorter);
  return rows;
}

function renderClientsList() {
  const rowsTarget = $("#clientsListRows");
  const emptyTarget = $("#clientsListEmpty");
  const moreBtn = $("#clientsListMoreBtn");
  const countNote = $("#clientsListCountNote");
  if (!rowsTarget) return;
  const filtered = filterAndSortClientsList();
  const visible = filtered.slice(0, clientsListVisibleCount);
  if (emptyTarget) emptyTarget.hidden = filtered.length > 0;
  rowsTarget.innerHTML = visible.map((client) => {
    const key = `list-${client.clientId}`;
    // TASK4: 목록 행 전체가 고객 상세 모달의 트리거다(hover tooltip 아님). 목록 API 응답에는
    // 이미 onlineSales/offlineSales/avgOrderValue/purchaseDetails가 전부 들어있어 별도 조회 없이
    // 그대로 저장한다.
    clientsDetailStore.set(key, {
      clientId: client.clientId,
      name: client.name,
      clientType: client.clientType,
      typeLabel: CLIENTS_TYPE_LABELS[client.clientType] || client.clientType,
      aliases: Array.isArray(client.aliases) ? client.aliases : [],
      purchaseCount: client.purchaseCount,
      salesAmount: client.totalSales,
      onlineSales: client.onlineSales,
      offlineSales: client.offlineSales,
      avgOrderValue: client.avgOrderValue,
      latestPurchaseDate: client.latestPurchaseDate,
      periodStart: clientsOverviewState?.periodStart || null,
      periodEnd: clientsOverviewState?.periodEnd || null,
      products: Array.isArray(client.products) ? client.products : [],
      purchaseDetails: Array.isArray(client.purchaseDetails) ? client.purchaseDetails : []
    });
    return `<tr data-client-row data-client-id="${esc(client.clientId)}" data-clients-detail="${esc(key)}" role="button" aria-haspopup="dialog" tabindex="0">
    <td><span class="clients-name-cell">${esc(client.name || "-")}</span></td>
    <td>${esc(CLIENTS_TYPE_LABELS[client.clientType] || client.clientType || "-")}</td>
    <td>${esc(client.contact || "-")}</td>
    <td>${esc(client.latestPurchaseDate || "-")}</td>
    <td>${apiNum(client.purchaseCount)}건</td>
    <td>${apiWon(client.onlineSales)}</td>
    <td>${apiWon(client.offlineSales)}</td>
    <td>${apiWon(client.totalSales)}</td>
    <td>${apiWon(client.avgOrderValue)}</td>
  </tr>`;
  }).join("");
  if (moreBtn) moreBtn.hidden = visible.length >= filtered.length;
  if (countNote) countNote.textContent = filtered.length ? `${nf.format(visible.length)} / ${nf.format(filtered.length)}명 표시 중` : "";
}

function scheduleClientsListRefresh() {
  clearTimeout(clientsListSearchTimer);
  clientsListSearchTimer = setTimeout(() => {
    clientsListVisibleCount = CLIENTS_LIST_PAGE_SIZE;
    renderClientsList();
  }, 300);
}

// ---------------------------------------------------------------------------
// TOP10/고객 목록 구매 제품 호버 (2026-07-17). 기존 today-sales-calendar-tooltip
// (todaySalesCalendarTooltipNode/positionTodaySalesCalendarTooltip/show·hide, line 4909-4957)의
// "공용 tooltip 엘리먼트 하나를 body에 붙여두고, anchor 기준으로 위치를 계산해 뷰포트 안쪽으로
// clamp한다" 패턴을 도넛 hover와 아래 고객 상세 모달의 날짜별 제품 popover 양쪽에서 그대로 재사용한다.
// 2026-07-17 최종 정정(TASK4): TOP10/목록의 "구매일"/"헤더" 전용 렌더러(clientsTooltipDatesHtml/
// clientsTooltipHeaderHtml/clientsTooltipDateLabel)는 hover tooltip 폐기와 함께 제거했다(clientsDetailModalBodyHtml/
// groupPurchaseDetailsByDate로 대체 — 구매일별 매출까지 함께 보여줘야 해서 구조가 달라졌다). 제품 목록
// 렌더러(clientsTooltipProductsHtml)는 구조가 그대로 재사용 가능해 limit 매개변수만 추가해 유지한다.
// STEP62-1: Purchase Timeline. purchaseDetails(개별 거래 라인, 서버에서 이미 날짜 내림차순
// 정렬됨)을 그대로 개별 항목으로 나열한다 — 날짜별로 묶지 않고(groupPurchaseDetailsByDate와는
// 다른 용도) 거래 하나하나를 "구매일/브랜드/상품명/결제금액/온라인·오프라인/개인결제창 여부"로
// 보여준다. 새 계산 없음: brand/productName/salesAmount/source 전부 서버가 이미 채워 준 필드
// 그대로 쓰고, 없으면(온라인 개인결제창 주문의 brand/productName처럼) 기존 관례와 동일하게
// "정보 없음"으로 정직하게 표시한다. orderId는 화면에 표시하지 않고 data 속성에만 담아 Order
// Detail Drawer 연결(placeholder)에 대비해 내부적으로 유지한다.
// STEP62-1B: "온라인 고객 일반"에는 개인결제창이 아닌 일반 온라인 주문도 섞여 있어(rawName
// 비어있음) source==="online"만으로는 개인결제창 여부를 판별할 수 없다(STEP62-1A Audit로 확인) —
// 서버가 이미 채워 준 rawName(personalPaymentProductName) 유무를 그대로 재사용한다(새 판별 로직 아님).
// STEP62-2: Order Detail Drawer(공용 컴포넌트, openOrderDetailDrawer 참고)를 열 때 필요한 값을
// data-* 속성에 그대로 실어 둔다 — 별도 store/Map을 새로 만들지 않고, 클릭 시 dataset만 읽어
// openOrderDetailDrawer(plain object)를 호출한다(Drawer 자체는 Clients 상태를 전혀 모른다).
// STEP63-3: Identity Pipeline(STEP63-2/62-2B, intelligence-service.mjs가 purchaseDetails에
// 이미 채워 준 canonicalBrandName/brandConfidence) 결과를 우선 쓰되, Confidence Contract
// (work/reports/STEP63-1-resolver-spec.md 8번 항목)에 따라 confidence가 VERIFIED/REVIEWED일
// 때만 표시를 허용한다. 그렇지 않으면(CANDIDATE/UNRESOLVED) STEP62-3의 기존 표시 로직
// (resolveRawBrandCanonical, Brand Master 정확 일치)으로 그대로 fallback한다 — 임의 승격
// 없음, Card/Drawer가 동일한 판단을 쓰도록 한 함수로 통일한다(중복 방지).
function clientsTimelineBrandDisplay(item) {
  if (!item.brand) return null;
  if ((item.brandConfidence === "VERIFIED" || item.brandConfidence === "REVIEWED") && item.canonicalBrandName) {
    return item.canonicalBrandName;
  }
  return resolveRawBrandCanonical(item.brand) || item.brand;
}

// STEP62-3: Card는 대표 정보만 보여준다 — 원본 코드(item.brand)를 canonical 표시명으로
// 바꿔 보여주고, 일치하는 항목이 없으면 원본 코드를 그대로 쓴다("기존 표시 유지").
// Developer 정보(원본 코드 자체)는 Card에 노출하지 않고 Drawer에서만 함께 보여준다
// (orderDetailDrawerBodyHtml 참고).
function clientsPurchaseTimelineItemHtml(item, clientName) {
  const sourceLabel = { online: "온라인", offline: "오프라인" };
  const brandDisplay = clientsTimelineBrandDisplay(item);
  return `<li class="clients-detail-alias-stats-row" data-clients-timeline-item tabindex="0" role="button"
    data-order-id="${esc(item.orderId || "")}"
    data-order-date="${esc(item.date || "")}"
    data-order-client-name="${esc(clientName || "")}"
    data-order-brand="${esc(item.brand || "")}"
    data-order-canonical-brand-name="${esc(item.canonicalBrandName || "")}"
    data-order-brand-confidence="${esc(item.brandConfidence || "")}"
    data-order-product-name="${esc(item.productName || "")}"
    data-order-quantity="${esc(item.quantity ?? "")}"
    data-order-sales-amount="${esc(item.salesAmount ?? "")}"
    data-order-source="${esc(item.source || "")}"
    data-order-raw-name="${esc(item.rawName || "")}">
    <span class="clients-detail-alias-stats-name">${esc(item.date || "-")} · ${esc(brandDisplay || "브랜드 정보 없음")}</span>
    <span class="clients-detail-alias-stats-meta">
      ${esc(item.productName || "제품 정보 없음")} · ${apiWon(item.salesAmount)}
      <b class="clients-tooltip-source-badge is-${esc(item.source || "")}">${esc(sourceLabel[item.source] || item.source || "-")}</b>
      ${item.source === "online" && item.rawName ? `<b class="clients-tooltip-source-badge">개인결제창</b>` : ""}
    </span>
  </li>`;
}

function clientsPurchaseTimelineHtml(purchaseDetails = [], clientName, limit = 10) {
  if (!purchaseDetails.length) return `<p class="clients-tooltip-empty">구매 내역 없음</p>`;
  const shown = clientsDetailShowAllTimeline ? purchaseDetails : purchaseDetails.slice(0, limit);
  const overflow = purchaseDetails.length - shown.length;
  return `<ul class="clients-detail-alias-stats-list">${shown.map((item) => clientsPurchaseTimelineItemHtml(item, clientName)).join("")}</ul>
    ${overflow > 0 ? `<button type="button" class="clients-detail-more-dates-btn" data-clients-detail-more-timeline>더보기 (외 ${nf.format(overflow)}건)</button>` : ""}`;
}

// ---------------------------------------------------------------------------
// Order Detail Drawer (STEP62-2/62-3, STEP63-3에서 브랜드 표시 갱신). Marketing OS 공용
// 컴포넌트 — 어느 화면(Clients Purchase Timeline 등)에서 열렸는지 전혀 모른 채, 호출자가
// 넘겨준 순수 데이터 객체(order)만으로 그려진다. 새 API 호출 없음 — 이미 purchaseDetails에
// 있는 값만 사용하고, 없는 값은 "정보 없음"으로 정직하게 표시한다. 브랜드는
// "대표명"(clientsTimelineBrandDisplay — Confidence Contract 만족 시 STEP63-3 Identity
// Pipeline의 canonicalBrandName, 아니면 STEP62-3의 Brand Master 정확 일치 fallback)과
// "원본 그룹"(order.brand, ECOUNT brandGroup 원본 그대로, 절대 덮어쓰지 않음) 두 항목을
// 함께 보여준다. 옵션은
// purchaseDetails에 담겨 오는 필드가 없어(스키마 확장은 이번 STEP 범위 밖, API 변경 금지)
// "옵션 정보 없음"으로 고정 표시한다. 단가는 금액/수량의 단순 화면 계산(기존 avgOrderValue와
// 같은 방식의 표시용 나눗셈)일 뿐 새 비즈니스 로직이 아니다.
// ---------------------------------------------------------------------------
let orderDetailDrawerPreviousFocus = null;

function orderFromTimelineItemDataset(dataset) {
  return {
    orderId: dataset.orderId || null,
    date: dataset.orderDate || null,
    clientName: dataset.orderClientName || null,
    brand: dataset.orderBrand || null,
    // STEP63-3: Timeline Card와 동일한 Confidence Contract 판단을 Drawer도 쓸 수 있도록
    // canonical 값/confidence를 그대로 넘긴다(원본 brand는 절대 건드리지 않음).
    canonicalBrandName: dataset.orderCanonicalBrandName || null,
    brandConfidence: dataset.orderBrandConfidence || null,
    productName: dataset.orderProductName || null,
    quantity: dataset.orderQuantity === "" ? null : Number(dataset.orderQuantity),
    salesAmount: dataset.orderSalesAmount === "" ? null : Number(dataset.orderSalesAmount),
    source: dataset.orderSource || null,
    rawName: dataset.orderRawName || null
  };
}

function orderDetailDrawerModeLabel(order) {
  if (order.source === "offline") return "오프라인 판매";
  if (order.source === "online") return order.rawName ? "온라인 개인결제창" : "온라인 일반 주문";
  return "-";
}

// 새 CSS를 만들지 않는다 — 이미 있는 entity-drawer-*(우측 슬라이드 패널, z-index 2100으로
// clients-detail-modal의 2000보다 위에 뜬다)와 clients-detail-period-*(label/value 행) 클래스를
// 그대로 재사용한다.
function orderDetailDrawerNode() {
  let el = $("#orderDetailDrawer");
  if (!el) {
    el = document.createElement("div");
    el.id = "orderDetailDrawer";
    el.className = "entity-drawer-modal";
    el.hidden = true;
    el.innerHTML = `
      <div class="entity-drawer-backdrop" data-order-detail-drawer-close></div>
      <div class="entity-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="orderDetailDrawerTitle" tabindex="-1">
        <div class="entity-drawer-header">
          <div>
            <strong id="orderDetailDrawerTitle" class="entity-drawer-title">주문 상세</strong>
            <p class="entity-drawer-description">Order Detail</p>
          </div>
          <button type="button" class="entity-drawer-close-btn" data-order-detail-drawer-close aria-label="닫기">×</button>
        </div>
        <div class="entity-drawer-body" id="orderDetailDrawerBody"></div>
      </div>`;
    document.body.appendChild(el);
  }
  return el;
}

function orderDetailDrawerBodyHtml(order) {
  const sourceLabel = { online: "온라인", offline: "오프라인" };
  const quantity = Number(order.quantity);
  const salesAmount = Number(order.salesAmount);
  const unitPrice = Number.isFinite(quantity) && quantity > 0 && Number.isFinite(salesAmount)
    ? Math.round(salesAmount / quantity)
    : null;
  return `
    <div class="clients-detail-period-block">
      <div class="clients-detail-period-row"><span>주문번호</span><strong>${esc(order.orderId || "주문번호 정보 없음")}</strong></div>
      <div class="clients-detail-period-row"><span>결제일</span><strong>${esc(order.date || "-")}</strong></div>
      <div class="clients-detail-period-row"><span>고객명</span><strong>${esc(order.clientName || "-")}</strong></div>
      <div class="clients-detail-period-row"><span>주문방식</span><strong>${esc(orderDetailDrawerModeLabel(order))}</strong></div>
      <div class="clients-detail-period-row">
        <span>구분</span>
        <strong>
          <b class="clients-tooltip-source-badge is-${esc(order.source || "")}">${esc(sourceLabel[order.source] || order.source || "-")}</b>
          ${order.source === "online" && order.rawName ? `<b class="clients-tooltip-source-badge">개인결제창</b>` : ""}
        </strong>
      </div>
    </div>
    <p class="clients-tooltip-subhead">브랜드</p>
    <div class="clients-detail-period-block">
      <div class="clients-detail-period-row"><span>대표명</span><strong>${esc(clientsTimelineBrandDisplay(order) || "브랜드 정보 없음")}</strong></div>
      <div class="clients-detail-period-row"><span>원본 그룹</span><strong>${esc(order.brand || "원본 정보 없음")}</strong></div>
    </div>
    <p class="clients-tooltip-subhead">상품</p>
    <div class="clients-detail-period-block">
      <div class="clients-detail-period-row"><span>상품명</span><strong>${esc(order.productName || "제품 정보 없음")}</strong></div>
      <div class="clients-detail-period-row"><span>옵션</span><strong>옵션 정보 없음</strong></div>
      <div class="clients-detail-period-row"><span>수량</span><strong>${Number.isFinite(quantity) ? apiNum(quantity) : "-"}</strong></div>
      <div class="clients-detail-period-row"><span>단가</span><strong>${unitPrice == null ? "-" : apiWon(unitPrice)}</strong></div>
      <div class="clients-detail-period-row"><span>금액</span><strong>${apiWon(order.salesAmount)}</strong></div>
    </div>
    <p class="clients-tooltip-subhead">향후 영역</p>
    <div class="clients-detail-period-block">
      <div class="clients-detail-period-row"><span>Category</span><strong>연결 예정 (Placeholder)</strong></div>
      <div class="clients-detail-period-row"><span>Promotion</span><strong>연결 예정 (Placeholder)</strong></div>
    </div>
  `;
}

function openOrderDetailDrawer(order) {
  if (!order) return;
  const drawer = orderDetailDrawerNode();
  const body = $("#orderDetailDrawerBody");
  if (body) body.innerHTML = orderDetailDrawerBodyHtml(order);
  orderDetailDrawerPreviousFocus = document.activeElement;
  drawer.hidden = false;
  requestAnimationFrame(() => {
    drawer.classList.add("is-visible");
    drawer.querySelector(".entity-drawer-panel")?.focus();
  });
}

function closeOrderDetailDrawer() {
  const drawer = $("#orderDetailDrawer");
  if (!drawer || drawer.hidden) return;
  drawer.classList.remove("is-visible");
  drawer.hidden = true;
  const toFocus = orderDetailDrawerPreviousFocus;
  orderDetailDrawerPreviousFocus = null;
  if (toFocus && typeof toFocus.focus === "function" && document.contains(toFocus)) toFocus.focus();
}

function clientsTooltipProductsHtml(products = [], limit = 5) {
  if (!products.length) return `<p class="clients-tooltip-empty">구매 제품 데이터 없음</p>`;
  const shown = products.slice(0, limit);
  const sourceLabel = { online: "온라인", offline: "오프라인" };
  return `<ul class="clients-tooltip-products">
    ${shown.map((row) => `<li class="clients-tooltip-product-row">
      <span class="clients-tooltip-product-name">${esc(row.productName || "제품 정보 없음")}</span>
      <span class="clients-tooltip-product-meta">
        <strong>${apiNum(row.quantity)}개</strong>
        <em>${apiWon(row.salesAmount)}</em>
        ${row.source ? `<b class="clients-tooltip-source-badge is-${esc(row.source)}">${esc(sourceLabel[row.source] || row.source)}</b>` : ""}
      </span>
    </li>`).join("")}
  </ul>`;
}

// TOP10/고객목록 공용 본문. kind에 따라 구매일 섹션(TOP10만) / 포함 이름 전체 목록(목록만) 여부만 갈린다.
// 도넛/범례 호버는 완전히 다른 지표 구조라 별도 clientsTooltipDonutHtml()을 쓰지만, 같은 tooltip
// DOM 노드·위치계산·show/hide 함수를 공유한다(중복 렌더 함수 금지 요건은 이 공용 파이프라인으로 충족).
// 2026-07-17 최종 정정(TASK4): TOP10/고객 목록은 더 이상 이 hover tooltip을 쓰지 않는다(클릭 시
// 여는 고객 상세 모달로 전환 — clientsDetailStore/openClientsDetailModal 참고). 도넛/범례만
// 여전히 clientsTooltipData에 "donut" kind로 값을 채우므로, 이 함수는 그 경우만 남긴다.
function clientsTooltipHtml(key) {
  const data = clientsTooltipData.get(key);
  if (!data) return "";
  if (data.kind === "donut") return clientsTooltipDonutHtml(data);
  return "";
}

// 도넛 조각/범례 hover 전용 내용. typeBreakdown에 이미 있는 값(비율/건수/고객수/매출)은 그대로 쓰고
// TOP3 2종은 clientsTypeDetail()에서 clientsOverviewState.clients를 필터링해 미리 계산해둔 값을 그대로 표시한다.
function clientsTooltipDonutHtml(data) {
  const top3Html = (rows, valueHtml) => {
    if (!rows.length) return `<p class="clients-tooltip-empty">데이터 없음</p>`;
    return `<ul class="clients-tooltip-list">${rows.map((client, index) => `<li>${index + 1}. ${esc(client.name || "-")} <strong>${valueHtml(client)}</strong></li>`).join("")}</ul>`;
  };
  return `<div class="clients-tooltip-body">
    <div class="clients-tooltip-head"><strong class="clients-tooltip-title">${esc(data.label || "-")}</strong></div>
    <div class="clients-tooltip-stats clients-tooltip-stats-donut">
      <div class="clients-tooltip-stat"><span>구매 비율</span><strong>${pct(data.ratioPct)}</strong></div>
      <div class="clients-tooltip-stat"><span>구매 건수</span><strong>${apiNum(data.purchaseCount)}건</strong></div>
      <div class="clients-tooltip-stat"><span>고객 수</span><strong>${apiNum(data.clientCount)}명</strong></div>
      <div class="clients-tooltip-stat"><span>총매출</span><strong>${apiWon(data.salesAmount)}</strong></div>
      <div class="clients-tooltip-stat"><span>평균 구매금액</span><strong>${data.avgOrderValue == null ? "-" : apiWon(data.avgOrderValue)}</strong></div>
      <div class="clients-tooltip-stat"><span>매출 비율</span><strong>${pct(data.salesRatioPct)}</strong></div>
    </div>
    <p class="clients-tooltip-subhead">구매건수 TOP 3</p>
    ${top3Html(data.top3ByCount, (client) => `${apiNum(client.purchaseCount)}건`)}
    <p class="clients-tooltip-subhead">매출 TOP 3</p>
    ${top3Html(data.top3BySales, (client) => apiWon(client.totalSales))}
  </div>`;
}

function clientsTooltipNode() {
  let tooltip = $("#clientsHoverTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "clientsHoverTooltip";
    tooltip.className = "clients-hover-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

// 뷰포트 4면 16px 마진을 지키면서, 기본 위치(anchor 아래·왼쪽 정렬)가 오른쪽/아래로 넘치면
// 각각 왼쪽/위로 뒤집는다. 헤더·사이드바보다 z-index가 높고(.clients-hover-tooltip 참고),
// 카드의 overflow에 영향받지 않도록 body에 fixed로 붙여둔 노드를 그대로 옮겨 쓴다.
function positionClientsTooltip(anchor, tooltip) {
  const margin = 16;
  const gap = 10;
  const rect = anchor.getBoundingClientRect();
  const size = tooltip.getBoundingClientRect();
  const width = size.width || tooltip.offsetWidth || 320;
  const height = size.height || tooltip.offsetHeight || 160;
  const overflowsRight = rect.left + width + margin > window.innerWidth;
  let left = overflowsRight ? rect.right - width : rect.left;
  const overflowsBottom = rect.bottom + gap + height + margin > window.innerHeight;
  let top = overflowsBottom ? rect.top - height - gap : rect.bottom + gap;
  left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin));
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function cancelHideClientsTooltip() {
  clearTimeout(clientsTooltipHideTimer);
  clientsTooltipHideTimer = null;
}

// 즉시 닫지 않고 약간의 지연을 둔 뒤 닫는다 — anchor와 tooltip 사이의 gap(10px)을 마우스가
// 지나가는 짧은 순간에 깜빡이며 닫히는 것을 막기 위함이다. anchor나 tooltip 자체로 다시
// 들어오면 cancelHideClientsTooltip()으로 취소된다.
function scheduleHideClientsTooltip() {
  cancelHideClientsTooltip();
  clientsTooltipHideTimer = setTimeout(() => hideClientsTooltip(), 120);
}

function showClientsTooltipForKey(key, anchor) {
  if (!key || !anchor) return;
  const tooltip = clientsTooltipNode();
  const html = clientsTooltipHtml(key);
  if (!html) return;
  cancelHideClientsTooltip();
  const reused = tooltip.dataset.activeKey === key && !tooltip.hidden;
  tooltip.innerHTML = html;
  tooltip.dataset.activeKey = key;
  if (!reused) {
    tooltip.classList.remove("is-visible");
    tooltip.hidden = false;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
  } else {
    tooltip.hidden = false;
  }
  positionClientsTooltip(anchor, tooltip);
  requestAnimationFrame(() => tooltip.classList.add("is-visible"));
}

function showClientsTooltip(target) {
  const key = target?.dataset?.clientsTooltip;
  if (!key) return;
  showClientsTooltipForKey(key, target);
}

function hideClientsTooltip() {
  cancelHideClientsTooltip();
  const tooltip = $("#clientsHoverTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("is-visible");
  tooltip.hidden = true;
  delete tooltip.dataset.activeKey;
}

// ---------------------------------------------------------------------------
// Clients 고객 상세 모달 (2026-07-17 최종 정정, TASK4/5). TOP10/고객 목록의 상세는 더 이상
// hover tooltip이 아니라 클릭 시 여는 모달이다. 도넛/범례의 가벼운 비율 안내(hover tooltip)는
// 그대로 두고, 고객 상세에는 쓰지 않는다(clientsTooltipHtml 참고 — donut kind만 남김).
// ---------------------------------------------------------------------------

// purchaseDetails(개별 거래 라인)를 날짜별로 묶어 건수/매출을 합산한다. 날짜별 "구매일별 내역"
// 표시와, 그 안의 각 날짜 hover/focus 시 보여줄 "그 날짜만의 제품 목록"(items) 둘 다 이 결과
// 하나로 충당한다 — 다른 날짜 제품이 섞이지 않도록 날짜별로 완전히 분리해 둔다.
function groupPurchaseDetailsByDate(purchaseDetails = []) {
  const map = new Map();
  for (const detail of purchaseDetails) {
    const date = detail?.date;
    if (!date) continue;
    if (!map.has(date)) map.set(date, { date, count: 0, salesAmount: 0, items: [] });
    const row = map.get(date);
    row.count += 1;
    const amount = Number(detail.salesAmount);
    row.salesAmount += Number.isFinite(amount) ? amount : 0;
    row.items.push(detail);
  }
  const sortItems = (items) => items.slice().sort((a, b) => (
    (Number(b.salesAmount || 0) - Number(a.salesAmount || 0)) ||
    (Number(b.quantity || 0) - Number(a.quantity || 0)) ||
    String(a.productName || "").localeCompare(String(b.productName || ""), "ko")
  ));
  return [...map.values()]
    .map((row) => ({ ...row, items: sortItems(row.items) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// TASK5(2026-07-17 최종 정정): "포함 이름 N개"를 문자열 나열이 아니라 원본 판매명(rawName)별
// 건수/매출/최근 구매일로 집계해 보여준다(aliasStats). purchaseDetails에 서버가 추가해 준 rawName
// 필드를 그대로 쓰며, 추측하지 않는다 — 기프트로 제외된 판매행은 애초에 purchaseDetails 자체에
// 들어있지 않으므로(백엔드 isGiftSalesLine 필터가 먼저 적용됨) 이 집계에도 자연히 포함되지 않는다.
// rawName이 없는 거래(드묾, 예: 온라인 주문에 결제 식별 텍스트가 비어있는 경우)는 "원본명 미상"으로 묶는다.
function groupPurchaseDetailsByRawName(purchaseDetails = []) {
  const map = new Map();
  for (const detail of purchaseDetails) {
    const rawName = detail?.rawName || "원본명 미상";
    if (!map.has(rawName)) map.set(rawName, { rawName, count: 0, salesAmount: 0, latestDate: null });
    const row = map.get(rawName);
    row.count += 1;
    const amount = Number(detail.salesAmount);
    row.salesAmount += Number.isFinite(amount) ? amount : 0;
    if (detail.date && (!row.latestDate || detail.date > row.latestDate)) row.latestDate = detail.date;
  }
  return [...map.values()].sort((a, b) => (
    (b.count - a.count) ||
    (b.salesAmount - a.salesAmount) ||
    a.rawName.localeCompare(b.rawName, "ko")
  ));
}

function clientsDetailModalNode() {
  let modal = $("#clientsDetailModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "clientsDetailModal";
    modal.className = "clients-detail-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="clients-detail-backdrop" data-clients-detail-close></div>
      <div class="clients-detail-panel" role="dialog" aria-modal="true" aria-labelledby="clientsDetailModalTitle" tabindex="-1">
        <button type="button" class="clients-detail-close-btn" data-clients-detail-close aria-label="닫기">×</button>
        <div class="clients-detail-body" id="clientsDetailModalBody"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  return modal;
}

// 상세 창 기본 내용: 대표 고객명/유형/aliases/선택 기간 구매 건수/총매출/평균 구매금액/최근
// 구매일/온라인·오프라인 매출/구매 제품 TOP10/구매일별 내역(TASK5) 순서로 구성한다.
function clientsDetailModalBodyHtml(data) {
  if (!data) return "";
  const dateGroups = groupPurchaseDetailsByDate(data.purchaseDetails);
  const shownDates = clientsDetailShowAllDates ? dateGroups : dateGroups.slice(0, 10);
  const dateOverflow = dateGroups.length - shownDates.length;
  const products = Array.isArray(data.products) ? data.products : [];
  const shownProducts = products.slice(0, 10);
  const productOverflow = Math.max(0, products.length - shownProducts.length);
  const badge = data.typeLabel ? `<span class="clients-tooltip-badge">${esc(data.typeLabel)}</span>` : "";

  // TASK4(2026-07-17 최종 정정): "선택 기간"(Clients since/until, 서버 periodStart/periodEnd 그대로)과
  // "구매 발생 기간"(이 엔티티의 purchaseDetails 중 실제 최소~최대 날짜, 선택 기간을 벗어나지 않음 —
  // purchaseDetails 자체가 이미 선택 기간으로 필터링된 값이기 때문)을 명확히 구분해 표시한다.
  const selectedPeriodLabel = (data.periodStart && data.periodEnd)
    ? `${data.periodStart} ~ ${data.periodEnd}`
    : "-";
  const purchaseDates = dateGroups.map((row) => row.date).filter(Boolean).sort();
  const purchaseSpanLabel = purchaseDates.length
    ? (purchaseDates[0] === purchaseDates[purchaseDates.length - 1]
      ? purchaseDates[0]
      : `${purchaseDates[0]} ~ ${purchaseDates[purchaseDates.length - 1]}`)
    : "-";

  // TASK5(2026-07-17 최종 정정): "포함 이름 N개" 단순 나열 대신 원본 판매명별 건수/매출/최근
  // 구매일(aliasStats)을 보여준다. purchaseDetails는 "정상 판매행"(salesAmount > 0)만 담고 있어
  // (반품/음수 라인은 구매 건수에 넣지 않는 기존 설계 — buildClientsOverview의 offlinePositiveLines
  // 참고, 이번 작업 범위 밖이라 변경하지 않음) 순수 판매명별 매출 합계가 반품이 포함된 엔티티
  // 총매출(data.salesAmount)보다 클 수 있다(실측 확인: 2026-07 "영은님 판매"에 반품 4건 -498,950원
  // 존재). 개별 판매명에 반품을 억지로 귀속시켜 추측하지 않고, 그 차액을 "기타 조정" 한 줄로
  // 투명하게 보여줘 화면에 표시되는 합계가 항상 총매출과 일치하도록 한다.
  const aliasStats = groupPurchaseDetailsByRawName(data.purchaseDetails);
  const shownAliasStats = clientsDetailShowAllAliasStats ? aliasStats : aliasStats.slice(0, 10);
  const aliasStatsOverflow = aliasStats.length - shownAliasStats.length;
  const aliasStatsSalesSum = aliasStats.reduce((sum, row) => sum + row.salesAmount, 0);
  const reconcileDelta = Math.round((Number(data.salesAmount || 0) - aliasStatsSalesSum) * 100) / 100;
  const reconcileRow = reconcileDelta !== 0
    ? `<li class="clients-detail-alias-stats-row is-adjustment">
        <span class="clients-detail-alias-stats-name">기타 조정 (반품/환불 등, 특정 판매명에 귀속되지 않음)</span>
        <span class="clients-detail-alias-stats-meta">${apiWon(reconcileDelta)}</span>
      </li>`
    : "";

  return `
    <div class="clients-tooltip-head">
      <strong class="clients-tooltip-title" id="clientsDetailModalTitle">${esc(data.name || "-")}</strong>
      ${badge}
    </div>
    <div class="clients-tooltip-stats clients-detail-stats-grid">
      <div class="clients-tooltip-stat"><span>구매 건수</span><strong>${apiNum(data.purchaseCount)}건</strong></div>
      <div class="clients-tooltip-stat"><span>총매출</span><strong>${apiWon(data.salesAmount)}</strong></div>
      <div class="clients-tooltip-stat"><span>평균 구매금액</span><strong>${data.avgOrderValue == null ? "-" : apiWon(data.avgOrderValue)}</strong></div>
      <div class="clients-tooltip-stat"><span>온라인 매출</span><strong>${apiWon(data.onlineSales)}</strong></div>
      <div class="clients-tooltip-stat"><span>오프라인 매출</span><strong>${apiWon(data.offlineSales)}</strong></div>
    </div>
    <div class="clients-detail-period-block">
      <div class="clients-detail-period-row"><span>선택 기간</span><strong>${esc(selectedPeriodLabel)}</strong></div>
      <div class="clients-detail-period-row"><span>구매 발생 기간</span><strong>${esc(purchaseSpanLabel)}</strong></div>
      <div class="clients-detail-period-row"><span>최근 구매일</span><strong>${esc(data.latestPurchaseDate || "-")}</strong></div>
    </div>
    <p class="clients-tooltip-subhead">최근 구매</p>
    ${clientsPurchaseTimelineHtml(data.purchaseDetails, data.name)}
    <p class="clients-tooltip-subhead">원본 판매명별 내역 (${nf.format(aliasStats.length)}개) · 선택 기간 내 확인된 원본 판매명</p>
    ${shownAliasStats.length ? `<ul class="clients-detail-alias-stats-list">${shownAliasStats.map((row) => `<li class="clients-detail-alias-stats-row">
        <span class="clients-detail-alias-stats-name">${esc(row.rawName)}</span>
        <span class="clients-detail-alias-stats-meta">${apiNum(row.count)}건 · ${apiWon(row.salesAmount)} · 최근 ${esc(row.latestDate || "-")}</span>
      </li>`).join("")}${reconcileRow}</ul>` : (reconcileRow ? `<ul class="clients-detail-alias-stats-list">${reconcileRow}</ul>` : `<p class="clients-tooltip-empty">선택 기간 내 구매 데이터 없음</p>`)}
    ${aliasStatsOverflow > 0 ? `<button type="button" class="clients-detail-more-dates-btn" data-clients-detail-more-alias-stats>더보기 (외 ${nf.format(aliasStatsOverflow)}개)</button>` : ""}
    <p class="clients-tooltip-subhead">구매 제품 TOP 10</p>
    ${clientsTooltipProductsHtml(products, 10)}
    ${productOverflow > 0 ? `<p class="clients-tooltip-more">외 ${nf.format(productOverflow)}개 제품</p>` : ""}
    <p class="clients-tooltip-subhead">구매일별 내역</p>
    ${shownDates.length ? `<ul class="clients-detail-date-list">${shownDates.map((row) => `<li class="clients-detail-date-row" data-clients-detail-date="${esc(row.date)}" tabindex="0">
        <span>${esc(row.date)}</span>
        <strong>${apiNum(row.count)}건</strong>
        <em>${apiWon(row.salesAmount)}</em>
      </li>`).join("")}</ul>` : `<p class="clients-tooltip-empty">구매일 데이터 없음</p>`}
    ${dateOverflow > 0 ? `<button type="button" class="clients-detail-more-dates-btn" data-clients-detail-more-dates>더보기 (외 ${nf.format(dateOverflow)}일)</button>` : ""}
  `;
}

function rerenderClientsDetailModalBody() {
  const data = clientsDetailStore.get(clientsDetailActiveKey);
  const body = $("#clientsDetailModalBody");
  if (data && body) body.innerHTML = clientsDetailModalBodyHtml(data);
}

function clientsDetailFocusableEls(panel) {
  return [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
}

function openClientsDetailModal(key) {
  const data = clientsDetailStore.get(key);
  if (!data) return;
  clientsDetailActiveKey = key;
  clientsDetailShowAllDates = false;
  clientsDetailShowAllAliasStats = false;
  clientsDetailShowAllTimeline = false;
  hideClientsTooltip();
  const modal = clientsDetailModalNode();
  const body = $("#clientsDetailModalBody");
  if (body) body.innerHTML = clientsDetailModalBodyHtml(data);
  clientsDetailPreviousFocus = document.activeElement;
  modal.hidden = false;
  document.body.classList.add("clients-detail-modal-open");
  requestAnimationFrame(() => {
    modal.classList.add("is-visible");
    modal.querySelector(".clients-detail-panel")?.focus();
  });
}

// 닫힌 후 원래 클릭/포커스했던 행으로 포커스를 복귀시킨다(요구사항 — 포커스 복귀).
function closeClientsDetailModal() {
  const modal = $("#clientsDetailModal");
  if (!modal || modal.hidden) return;
  modal.classList.remove("is-visible");
  modal.hidden = true;
  document.body.classList.remove("clients-detail-modal-open");
  hideClientsDetailDatePopover();
  clientsDetailActiveKey = null;
  const toFocus = clientsDetailPreviousFocus;
  clientsDetailPreviousFocus = null;
  if (toFocus && typeof toFocus.focus === "function" && document.contains(toFocus)) toFocus.focus();
}

// 구매일별 내역의 각 날짜 행에 hover/focus하면 그 날짜의 purchaseDetails만 필터링해 작은
// popover로 보여준다(TASK5) — 다른 날짜 제품이 섞이지 않도록 clientsDetailActiveKey로 현재
// 열려 있는 고객의 데이터에서만 찾는다.
function clientsDetailDatePopoverNode() {
  let node = $("#clientsDetailDatePopover");
  if (!node) {
    node = document.createElement("div");
    node.id = "clientsDetailDatePopover";
    node.className = "clients-hover-tooltip clients-detail-date-popover";
    node.setAttribute("role", "tooltip");
    node.hidden = true;
    document.body.appendChild(node);
  }
  return node;
}

// 2026-07-17 최종 정정(TASK3): 날짜별 popover 전용 제품 목록 렌더러. 기존 clientsTooltipProductsHtml()은
// TOP10/도넛 호버에서 이미 쓰고 있어(제품명/수량/매출/온라인·오프라인만 표시) 그대로 재사용하면
// 이번 요구사항(원본 판매명/주문번호 표시, 10개 초과 시 "외 N개 제품")을 만족할 수 없다 — 공용 함수를
// 건드려 다른 화면에 영향을 주지 않도록 이 popover 전용 함수를 별도로 둔다. 같은 CSS 클래스
// (.clients-tooltip-products/.clients-tooltip-product-row 등)를 그대로 재사용해 스타일은 통일한다.
function clientsDetailDateProductsHtml(items = []) {
  if (!items.length) return `<p class="clients-tooltip-empty">구매 제품 데이터 없음</p>`;
  const shown = items.slice(0, 10);
  const overflow = items.length - shown.length;
  const sourceLabel = { online: "온라인", offline: "오프라인" };
  return `<ul class="clients-tooltip-products">
    ${shown.map((row) => `<li class="clients-tooltip-product-row">
      <span class="clients-tooltip-product-name">${esc(row.productName || "제품 정보 없음")}</span>
      <span class="clients-tooltip-product-meta">
        <strong>${apiNum(row.quantity)}개</strong>
        <em>${apiWon(row.salesAmount)}</em>
        ${row.source ? `<b class="clients-tooltip-source-badge is-${esc(row.source)}">${esc(sourceLabel[row.source] || row.source)}</b>` : ""}
        <span class="clients-detail-date-product-sub">${esc(row.rawName || "원본명 미상")}${row.orderId ? ` · ${esc(row.orderId)}` : ""}</span>
      </span>
    </li>`).join("")}
  </ul>${overflow > 0 ? `<p class="clients-tooltip-more">외 ${nf.format(overflow)}개 제품</p>` : ""}`;
}

function clientsDetailDatePopoverHtml(dateKey) {
  const data = clientsDetailStore.get(clientsDetailActiveKey);
  if (!data) return "";
  const group = groupPurchaseDetailsByDate(data.purchaseDetails).find((row) => row.date === dateKey);
  const items = group ? group.items : [];
  return `<div class="clients-tooltip-body">
    <p class="clients-tooltip-subhead">${esc(dateKey)} 구매 제품 (${nf.format(items.length)}건)</p>
    ${clientsDetailDateProductsHtml(items)}
  </div>`;
}

function showClientsDetailDatePopover(dateKey, anchor) {
  if (!dateKey || !anchor) return;
  const popover = clientsDetailDatePopoverNode();
  const html = clientsDetailDatePopoverHtml(dateKey);
  if (!html) return;
  clearTimeout(clientsDetailDateHideTimer);
  popover.innerHTML = html;
  popover.hidden = false;
  popover.classList.add("is-visible");
  positionClientsTooltip(anchor, popover);
}

function hideClientsDetailDatePopover() {
  clearTimeout(clientsDetailDateHideTimer);
  const popover = $("#clientsDetailDatePopover");
  if (!popover) return;
  popover.classList.remove("is-visible");
  popover.hidden = true;
}

function scheduleHideClientsDetailDatePopover() {
  clearTimeout(clientsDetailDateHideTimer);
  clientsDetailDateHideTimer = setTimeout(() => hideClientsDetailDatePopover(), 120);
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

// Sidebar Data Refresh Center 카드(Cafe24/Meta Ads/Instagram)의 Refresh 버튼.
// 새 API/판정 로직을 만들지 않고 기존 함수(getCafe24Status/getJson refresh=1/
// refreshInstagramMonthlyData)만 호출해 카드의 배지·시각만 다시 그린다.
// (STEP53-2D Refresh Center 기능 연결)
const refreshCardInFlight = new Set();

// 이 세션에서 실제로 완료된 Refresh 실행 결과만 보관한다(서버 저장/localStorage 없음,
// 새로고침하면 사라지는 것이 의도된 동작). 최신 항목이 앞에 오도록 unshift 후 5개로 자른다.
// (STEP53-3 Recent Activity Live Wiring)
const refreshActivityLabel = { cafe24: "Cafe24 Refresh", meta: "Meta Ads Refresh", instagram: "Instagram Refresh" };
let sessionRefreshActivities = [];

function renderRefreshActivities() {
  const list = $("#refreshActivityList");
  if (!list) return;
  if (!sessionRefreshActivities.length) {
    list.innerHTML = `<p class="refresh-activity-empty">아직 이 세션에서 실행된 갱신이 없습니다.</p>`;
    return;
  }
  list.innerHTML = sessionRefreshActivities.map((item) => `
    <div class="refresh-activity-item">
      <span class="refresh-activity-time">${esc(item.time)}</span>
      <span class="refresh-activity-label">${esc(refreshActivityLabel[item.service] || item.service)}</span>
      <span class="refresh-activity-result${item.ok ? "" : " failed"}">${item.ok ? "Success" : "Failed"}</span>
    </div>
  `).join("");
}

function addRefreshActivity(service, ok) {
  sessionRefreshActivities = [{ service, ok, time: healthTime() }, ...sessionRefreshActivities].slice(0, 5);
  renderRefreshActivities();
}

async function refreshDataCenterCard(service) {
  if (refreshCardInFlight.has(service)) return;
  const button = $(`[data-refresh="${service}"]`);
  const card = button?.closest(".refresh-card");
  const badge = card?.querySelector(".refresh-badge");
  const time = card?.querySelector(".refresh-card-time");
  if (!button || !card || !badge || !time) return;

  refreshCardInFlight.add(service);
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "새로고침 중...";
  try {
    const data = selectedMonth();
    const since = `${data.month}-01`;
    const until = monthEnd(data.month);
    let ok = false;
    if (service === "cafe24") {
      ok = (await getCafe24Status(since, until)).ok;
    } else if (service === "meta") {
      const meta = await getJson(`/api/meta-ads/summary?since=${since}&until=${until}&refresh=1`, 8000);
      ok = !meta.error;
    } else if (service === "instagram") {
      await refreshInstagramMonthlyData();
      ok = !selectedMonth().error;
    }
    badge.classList.remove("good", "warn", "error", "unknown");
    badge.classList.add(ok ? "good" : "error");
    badge.innerHTML = `<i></i>${ok ? "Healthy" : "Error"}`;
    time.textContent = healthTime();
    addRefreshActivity(service, ok);
  } finally {
    refreshCardInFlight.delete(service);
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

// ECOUNT Offline Refresh Wizard (STEP53-4 UI, STEP67-2B Data Apply 구현). "대상 월"은
// scripts/refresh-monthly-sales.mjs의 파일명 규칙(YYYY-MM.xlsx / YYYY.MM.xlsx)을 미리보기
// 표시 목적으로 클라이언트에서 재해석한 것이다. Data Apply는 선택된 XLSX 원본 바이트를
// POST /api/ecount-sales/import로 전송하고, 서버가 기존 importEcountOfflineSalesSnapshot()/
// refreshMonthlySales() 정책을 그대로 재사용해 처리한다(새 파서/파이프라인 없음).
let ecountWizardPreviousFocus = null;
let ecountWizardSelectedFile = null;

function ecountWizardModalNode() {
  let modal = $("#ecountWizardModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "ecountWizardModal";
    modal.className = "ecount-wizard-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="ecount-wizard-backdrop" data-ecount-wizard-close></div>
      <div class="ecount-wizard-panel" role="dialog" aria-modal="true" aria-labelledby="ecountWizardTitle" tabindex="-1">
        <button type="button" class="ecount-wizard-close-btn" data-ecount-wizard-close aria-label="닫기">×</button>
        <strong id="ecountWizardTitle" class="ecount-wizard-title">ECOUNT Offline Refresh</strong>
        <p class="ecount-wizard-desc">엑셀 파일을 선택하면 예상 처리 내용을 미리 볼 수 있습니다. 이 화면에서는 실제 처리가 실행되지 않습니다.</p>
        <div class="ecount-wizard-step">
          <label for="ecountWizardFile">파일 선택 (.xlsx)</label>
          <input type="file" id="ecountWizardFile" accept=".xlsx">
        </div>
        <div id="ecountWizardPreview" hidden>
          <div class="ecount-wizard-row"><span>선택 파일</span><strong id="ecountWizardFileName">-</strong></div>
          <div class="ecount-wizard-row"><span>대상 월</span><strong id="ecountWizardMonth">-</strong></div>
          <div class="ecount-wizard-row"><span>Snapshot</span><strong id="ecountWizardSnapshot">-</strong></div>
          <div class="ecount-wizard-row"><span>Monthly Archive</span><strong id="ecountWizardArchive">-</strong></div>
        </div>
        <p class="ecount-wizard-note">Data Apply 실행 시 처리 순서: XLSX 업로드 → Snapshot 생성 → (과거월인 경우) Monthly Archive 갱신. 로컬 Marketing OS(127.0.0.1:8787)에만 반영되며, Render 운영 배포는 별도로 진행합니다.</p>
        <button type="button" class="button primary ecount-wizard-apply-btn" id="ecountWizardApplyBtn" disabled>Data Apply</button>
        <p id="ecountWizardApplyStatus" class="ecount-wizard-apply-status" hidden></p>
      </div>`;
    document.body.appendChild(modal);
  }
  return modal;
}

function ecountWizardMonthFromFileName(name) {
  const match = String(name || "").match(/^(\d{4})[.-](\d{2})\.xlsx$/i);
  return match ? `${match[1]}-${match[2]}` : "";
}

function ecountWizardHandleFileChange(event) {
  const file = event.target.files?.[0] || null;
  ecountWizardSelectedFile = file;
  const preview = $("#ecountWizardPreview");
  const applyBtn = $("#ecountWizardApplyBtn");
  const applyStatus = $("#ecountWizardApplyStatus");
  if (applyStatus) applyStatus.hidden = true;
  if (!file) {
    if (preview) preview.hidden = true;
    if (applyBtn) applyBtn.disabled = true;
    return;
  }
  const month = ecountWizardMonthFromFileName(file.name);
  $("#ecountWizardFileName").textContent = file.name;
  $("#ecountWizardMonth").textContent = month || "파일명에서 확인 불가 (예: 2026-08.xlsx)";
  $("#ecountWizardSnapshot").textContent = month ? `work/ecount-sales/${month}.json (예정)` : "-";
  $("#ecountWizardArchive").textContent = month ? `work/monthly/${month}.json (예정)` : "-";
  if (preview) preview.hidden = false;
  if (applyBtn) applyBtn.disabled = false;
}

// XLSX 원본 바이트를 그대로 POST body로 보낸다(multipart 불필요) — 파일명은 헤더로 전달.
async function postEcountOfflineFile(file, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/ecount-sales/import", {
      method: "POST",
      headers: { "X-Ecount-File-Name": encodeURIComponent(file.name) },
      body: file,
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

async function ecountWizardHandleApplyClick() {
  const status = $("#ecountWizardApplyStatus");
  const applyBtn = $("#ecountWizardApplyBtn");
  if (!status || !applyBtn) return;
  const file = ecountWizardSelectedFile;
  if (!file) {
    status.textContent = "파일을 먼저 선택하세요.";
    status.hidden = false;
    return;
  }
  const originalLabel = applyBtn.textContent;
  applyBtn.disabled = true;
  applyBtn.textContent = "처리 중...";
  status.textContent = "업로드 및 반영 중...";
  status.hidden = false;
  status.classList.remove("is-error");
  try {
    const result = await postEcountOfflineFile(file);
    if (result?.error) {
      status.textContent = `적용 실패: ${result.error}`;
      status.classList.add("is-error");
      return;
    }
    const periodLabel = result.periodStart && result.periodEnd
      ? `${result.periodStart} ~ ${result.periodEnd}`
      : "-";
    status.textContent = [
      `반영 월 ${result.month || "-"}`,
      `데이터 기간 ${periodLabel}`,
      `오프라인 매출 ${hasApiValue(result.totalOfflineSales) ? won(result.totalOfflineSales) : "-"}`,
      `처리 행 수 ${hasApiValue(result.totalLineCount) ? apiNum(result.totalLineCount) : "-"}`,
      "적용 완료"
    ].join(" · ");
    await refreshEcountOfflineCard(result.month);
  } catch (error) {
    status.textContent = `적용 실패: ${error.message}`;
    status.classList.add("is-error");
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = originalLabel;
  }
}

// Data Apply 성공 후 사이드바 ECOUNT Offline 카드를 GET /api/ecount-sales/monthly로
// 재조회해 갱신한다 — Cafe24/Meta/Instagram 카드가 쓰는 refreshDataCenterCard()와 같은
// 배지/시각 갱신 방식을 재사용하되, ECOUNT 카드는 Refresh 버튼이 아니라 Upload 완료
// 시점에 갱신되므로 별도의 [data-refresh] 클릭 배선에는 연결하지 않는다.
async function refreshEcountOfflineCard(month) {
  const card = $("#ecountOfflineRefreshCard");
  if (!card || !month) return;
  const badge = card.querySelector(".refresh-badge");
  const time = card.querySelector(".refresh-card-time");
  const data = await getJson(`/api/ecount-sales/monthly?month=${encodeURIComponent(month)}`, 8000);
  const ok = !data?.error;
  if (badge) {
    badge.classList.remove("good", "warn", "error", "unknown");
    badge.classList.add(ok ? "good" : "error");
    badge.innerHTML = `<i></i>${ok ? "Healthy" : "Error"}`;
  }
  if (time) time.textContent = ok ? (data.periodEnd || month) : month;
}

function openEcountWizard() {
  const modal = ecountWizardModalNode();
  const fileInput = $("#ecountWizardFile");
  if (fileInput) fileInput.value = "";
  ecountWizardSelectedFile = null;
  $("#ecountWizardPreview")?.setAttribute("hidden", "");
  $("#ecountWizardApplyBtn")?.setAttribute("disabled", "");
  const status = $("#ecountWizardApplyStatus");
  if (status) {
    status.hidden = true;
    status.classList.remove("is-error");
  }
  ecountWizardPreviousFocus = document.activeElement;
  modal.hidden = false;
  requestAnimationFrame(() => modal.querySelector(".ecount-wizard-panel")?.focus());
}

function closeEcountWizard() {
  const modal = $("#ecountWizardModal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  const toFocus = ecountWizardPreviousFocus;
  ecountWizardPreviousFocus = null;
  if (toFocus && typeof toFocus.focus === "function" && document.contains(toFocus)) toFocus.focus();
}

// Brand Intelligence Dashboard Hero Section (STEP54-2A). UI/Hover 전용 — 값은 전부
// placeholder이며 어떤 API도 호출하지 않는다. Clients 탭의 hover tooltip 데이터/저장소는
// 건드리지 않고, 동일한 뷰포트 인지 포지셔닝 방식만 독립적인 헬퍼로 재구성했다.
const entityHeroTooltipText = {
  score: "공식 Health Score 산식이 연결되기 전까지 점수를 표시하지 않습니다.",
  "score-sales": "매출 성장 점수 산식 연결 대기",
  "score-inventory": "재고 건전성 점수 산식 연결 대기",
  "score-turnover": "판매 회전율 점수 산식 연결 대기",
  "score-customer": "고객 성장 점수 산식 연결 대기",
  sales: "선택 기간 온라인+오프라인 합산 매출입니다.",
  qty: "선택 기간 판매된 총 수량입니다.",
  sellthrough: "공식 Sell-through 산식이 확정되지 않아 계산하지 않습니다.",
  stock: "ECOUNT 현재 재고 중 canonical brand_code로 확인된 잔여 수량입니다.",
  sku: "선택 기간 판매가 확인된 상품 수입니다.",
  aov: "선택 기간 총매출을 주문수로 나눈 객단가입니다."
};

function entityHeroTooltipNode() {
  let tooltip = $("#entityHeroTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "entityHeroTooltip";
    tooltip.className = "brand-hero-hover-tooltip";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function positionEntityHeroTooltip(anchor, tooltip) {
  const margin = 16;
  const gap = 10;
  const rect = anchor.getBoundingClientRect();
  const width = tooltip.offsetWidth || 260;
  const height = tooltip.offsetHeight || 60;
  const overflowsRight = rect.left + width + margin > window.innerWidth;
  let left = overflowsRight ? rect.right - width : rect.left;
  const overflowsBottom = rect.bottom + gap + height + margin > window.innerHeight;
  let top = overflowsBottom ? rect.top - height - gap : rect.bottom + gap;
  left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin));
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// anchor 옆에 임의 HTML을 띄운다 — showEntityHeroTooltip(정적 텍스트)와 Customer
// Composition의 동적 tooltip(도넛 조각/TOP5 행)이 이 함수 하나를 공유한다.
function showEntityHeroTooltipContent(anchor, html) {
  if (!anchor || !html) return;
  const tooltip = entityHeroTooltipNode();
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  positionEntityHeroTooltip(anchor, tooltip);
  requestAnimationFrame(() => tooltip.classList.add("is-visible"));
}

function showEntityHeroTooltip(anchor) {
  const key = anchor?.dataset?.entityHeroTooltip;
  const text = entityHeroTooltipText[key];
  if (!text) return;
  showEntityHeroTooltipContent(anchor, esc(text));
}

function hideEntityHeroTooltip() {
  const tooltip = $("#entityHeroTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("is-visible");
  tooltip.hidden = true;
}

// STEP58-1/58-2: Brand Selector (Real Brand List UI, Compact UX). Placeholder 브랜드를
// 만들지 않고 실제 canonical Brand Master(/api/brand-master — renderBrandMasterSettings/
// Annual·Monthly Report가 쓰는 것과 동일한 엔드포인트+getSharedJson 캐시)만 사용한다.
// 평소에는 선택된 브랜드명만 보이는 트리거 버튼이고, 클릭 시 absolute overlay Dropdown이
// 열린다(레이아웃을 밀지 않음 — position:relative인 .brand-selector 안에서 .brand-selector
// -dropdown만 absolute). 선택 시 Hero 제목(#entityHeroName)만 바꾸고 KPI/Customer/
// Monthly Trend/Category Intelligence는 이번 STEP 범위 밖(실데이터 연결 없음, 그대로 유지).
const brandSelectorRecentNames = [];
let brandSelectorAllBrands = [];
let brandSelectorActiveName = null;
// STEP61-1: Brand Identity Layer. initBrandSelector()가 /api/brand-master에서 받은 brand
// 원본 항목(brand_code/name_aliases 포함)을 지금까지는 표시용 이름만 뽑고 버렸다 — 그
// 이름(brandCanonicalDisplayName 결과, Selector 목록/선택에 실제로 쓰이는 값)을 키로 원본
// 항목을 그대로 보관해두면, 선택된 이름에서 되돌아가 brand_code를 찾을 수 있다. 새 alias
// 테이블이 아니라 이미 fetch한 응답을 버리지 않고 재사용하는 것뿐이다.
let brandSelectorIdentityByName = new Map();
let brandIdentityState = { name: null, brandCode: null, aliases: [], sourcingType: null };
const entitySourcingLabels = {
  WHOLESALE: "사입",
  CONSIGNMENT: "위탁",
  HYBRID: "하이브리드",
  OWN_PRODUCTION: "제작"
};

// STEP59-4C: Unified Entity Selector. 기존 Brand Selector(검색/최근/전체 목록/열기·닫기
// 애니메이션/hover/키보드)를 "brand entity" 전용 함수 세트에서 instance(기준 "primary"/
// 비교 "compare")를 받는 공용 함수 세트로 승격한다. primary의 DOM id·동작은 100% 그대로
// 유지하고(#brandSelectorTrigger 등 기존 id 무변경), compare는 같은 함수를 새 DOM id
// 세트로만 재사용한다 — Selector를 복사 생성하지 않는다. entityType까지는 아직 없고
// instance만 분기한다(향후 Client/Category/SKU 등 entityType 축 추가 여지).
const entitySelectorInstances = {
  primary: {
    dom: {
      trigger: "#brandSelectorTrigger", triggerLabel: "#brandSelectorTriggerLabel",
      dropdown: "#brandSelectorDropdown", search: "#brandSelectorSearch",
      recent: "#brandSelectorRecent", all: "#brandSelectorAll", wrapper: ".brand-selector"
    },
    getActive: () => brandSelectorActiveName,
    onSelect: (name) => selectBrandSelectorName(name),
    isDisabled: () => false
  },
  compare: {
    dom: {
      trigger: "#entityCompareBrandBTrigger", triggerLabel: "#entityCompareBrandBTriggerLabel",
      dropdown: "#entityCompareBrandBDropdown", search: "#entityCompareBrandBSearch",
      recent: "#entityCompareBrandBRecent", all: "#entityCompareBrandBAll", wrapper: ".entity-compare-brand-selector"
    },
    // entityCompareBrandBSelection(사용자가 명시적으로 고른 값)이 아니라
    // entityCompareBrandB()(fallback 포함 최종 표시값)를 기준으로 active 표시해야,
    // 아직 선택하지 않은 상태에서도 트리거 라벨과 목록 강조가 항상 일치한다.
    getActive: () => entityCompareBrandB(),
    onSelect: (name) => selectEntityCompareBrandB(name),
    // STEP59-4B에서 정한 규칙 그대로: 기준 브랜드와 같은 이름은 비교 목록에서 선택 불가.
    isDisabled: (name) => name === entityCompareBrandA()
  },
  // STEP67-8D: Comparison Brand A Local Selector. "기준 브랜드"는 Comparison 전용
  // 상태가 아니라 메인 브랜드(brandSelectorActiveName) 그 자체다 — primary와 동일한
  // getActive/onSelect를 재사용해 이 selector에서 고른 값이 곧 메인 Brand Intelligence
  // 브랜드가 되도록 한다(새 Comparison 전용 상태를 만들지 않음). isDisabled는 이번
  // STEP에서 항상 false — Brand B와 같은 브랜드라는 이유로 메인 브랜드 선택 자체를
  // 막는 새 제약을 추가하지 않는다(사용자 확정).
  compareA: {
    dom: {
      trigger: "#entityCompareBrandATrigger", triggerLabel: "#entityCompareBrandAName",
      dropdown: "#entityCompareBrandADropdown", search: "#entityCompareBrandASearch",
      recent: "#entityCompareBrandARecent", all: "#entityCompareBrandAAll", wrapper: ".entity-compare-brand-selector"
    },
    getActive: () => brandSelectorActiveName,
    onSelect: (name) => selectBrandSelectorName(name),
    isDisabled: () => false
  }
};
const entitySelectorState = {
  primary: { query: "", open: false, closeTimer: null },
  compare: { query: "", open: false, closeTimer: null },
  compareA: { query: "", open: false, closeTimer: null }
};

function entitySelectorRowHtml(instanceKey, name) {
  const inst = entitySelectorInstances[instanceKey];
  const isActive = name === inst.getActive();
  const isDisabled = inst.isDisabled(name);
  return `<li data-entity-selector-name="${esc(name)}" data-entity-selector-instance="${instanceKey}" class="${isActive ? "active" : ""}${isDisabled ? " is-disabled" : ""}" aria-disabled="${isDisabled}" tabindex="0">${esc(name)}</li>`;
}

function renderEntitySelectorRecent(instanceKey) {
  const list = $(entitySelectorInstances[instanceKey].dom.recent);
  if (!list) return;
  list.closest(".brand-selector-group")?.toggleAttribute("hidden", !brandSelectorRecentNames.length);
  list.innerHTML = brandSelectorRecentNames.map((name) => entitySelectorRowHtml(instanceKey, name)).join("");
}

function renderEntitySelectorAll(instanceKey) {
  const list = $(entitySelectorInstances[instanceKey].dom.all);
  if (!list) return;
  const query = entitySelectorState[instanceKey].query.trim().toLowerCase();
  const filtered = query ? brandSelectorAllBrands.filter((name) => name.toLowerCase().includes(query)) : brandSelectorAllBrands;
  list.innerHTML = filtered.length
    ? filtered.map((name) => entitySelectorRowHtml(instanceKey, name)).join("")
    : `<li class="brand-selector-empty">검색 결과가 없습니다.</li>`;
}

function openEntitySelectorDropdown(instanceKey) {
  const inst = entitySelectorInstances[instanceKey];
  const state = entitySelectorState[instanceKey];
  const dropdown = $(inst.dom.dropdown);
  const trigger = $(inst.dom.trigger);
  if (!dropdown || state.open) return;
  clearTimeout(state.closeTimer);
  state.open = true;
  dropdown.hidden = false;
  trigger?.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => dropdown.classList.add("is-visible"));
  $(inst.dom.search)?.focus();
}

function closeEntitySelectorDropdown(instanceKey) {
  const inst = entitySelectorInstances[instanceKey];
  const state = entitySelectorState[instanceKey];
  const dropdown = $(inst.dom.dropdown);
  const trigger = $(inst.dom.trigger);
  if (!dropdown || !state.open) return;
  state.open = false;
  dropdown.classList.remove("is-visible");
  trigger?.setAttribute("aria-expanded", "false");
  clearTimeout(state.closeTimer);
  state.closeTimer = setTimeout(() => {
    dropdown.hidden = true;
  }, 150);
  // 다음에 열 때는 항상 전체 목록부터 보이도록 검색어를 초기화한다.
  state.query = "";
  const searchInput = $(inst.dom.search);
  if (searchInput) searchInput.value = "";
  renderEntitySelectorAll(instanceKey);
}

function toggleEntitySelectorDropdown(instanceKey) {
  if (entitySelectorState[instanceKey].open) closeEntitySelectorDropdown(instanceKey);
  else openEntitySelectorDropdown(instanceKey);
}

function selectBrandSelectorName(name) {
  if (!name) return;
  brandSelectorActiveName = name;
  const recentIndex = brandSelectorRecentNames.indexOf(name);
  if (recentIndex >= 0) brandSelectorRecentNames.splice(recentIndex, 1);
  brandSelectorRecentNames.unshift(name);
  brandSelectorRecentNames.splice(5);
  const heroName = $("#entityHeroName");
  if (heroName) heroName.textContent = name;
  const triggerLabel = $("#brandSelectorTriggerLabel");
  if (triggerLabel) triggerLabel.textContent = name;
  renderEntitySelectorRecent("primary");
  renderEntitySelectorAll("primary");
  closeEntitySelectorDropdown("primary");
  renderEntityHeroState();
  // STEP59-4: entityCompareBrandA()가 brandSelectorActiveName을 그대로 읽는 파생값이라
  // 브랜드가 바뀔 때마다 Compare Header 표시도 함께 새로고침한다(새 state 결합 아님 —
  // 이미 있는 값을 다시 그리는 것뿐). 비교 목록의 disabled 표시도 같이 갱신되도록
  // compare 목록도 다시 그린다(비교 목록 전용 선택 로직은 아님).
  renderEntityCompareUI();
  renderEntitySelectorRecent("compare");
  renderEntitySelectorAll("compare");
  // STEP67-8D: compareA(Comparison "기준 브랜드" 로컬 selector)도 primary와 동일한
  // brandSelectorActiveName을 읽으므로(getActive), 목록의 active 표시를 갱신하고
  // 선택이 끝났으면 이 함수를 호출한 쪽이 primary든 compareA든 자기 자신의 드롭다운을
  // 닫는다(이미 닫혀 있으면 closeEntitySelectorDropdown이 조용히 반환 — 새 로직 아님).
  renderEntitySelectorRecent("compareA");
  renderEntitySelectorAll("compareA");
  closeEntitySelectorDropdown("compareA");
  // STEP61-1: Brand Identity Layer. Hero/KPI/Composition 등 화면은 그대로 두고, 선택된
  // 이름 뒤에서 brand_code를 확정한 뒤 Monthly Archive와의 매핑만 확인한다(UI 반영 없음).
  applyBrandIdentity(name);
}

// STEP58-4C: "← 전체 브랜드 보기" — 선택된 브랜드를 해제하고 Empty State로 되돌린다. 새
// 상태 변수를 만들지 않고 selectBrandSelectorName의 반대 동작을 그대로 재사용한다
// (brandSelectorActiveName을 비우고 renderEntityHeroState()만 다시 호출).
function clearBrandSelectorSelection() {
  brandSelectorActiveName = null;
  const heroName = $("#entityHeroName");
  if (heroName) heroName.textContent = "브랜드를 선택하세요";
  const triggerLabel = $("#brandSelectorTriggerLabel");
  if (triggerLabel) triggerLabel.textContent = "브랜드 선택";
  renderEntitySelectorRecent("primary");
  renderEntitySelectorAll("primary");
  closeEntitySelectorDropdown("primary");
  renderEntityHeroState();
  renderEntityCompareUI();
  renderEntitySelectorRecent("compare");
  renderEntitySelectorAll("compare");
  // STEP67-8D: selectBrandSelectorName()과 동일하게 compareA 목록/드롭다운도 함께 정리한다.
  renderEntitySelectorRecent("compareA");
  renderEntitySelectorAll("compareA");
  closeEntitySelectorDropdown("compareA");
  applyBrandIdentity(null);
}

// STEP61-1: Brand Identity Layer. brandSelectorIdentityByName은 initBrandSelector()가
// /api/brand-master 응답에서 이미 fetch한 원본 항목을 이름별로 보관해둔 것이다 — 여기서는
// 그 항목에서 monthlyReportBrandCode()(Monthly/Annual Report가 이미 쓰는 동일 함수)로
// brand_code만 뽑는다. Master Data가 아직 로딩 전이라 항목을 못 찾으면 brandCode는 null로
// 남고, 이후 Master Data가 로딩되면 initBrandSelector()가 다시 resolveBrandIdentity를
// 호출해 갱신한다.
function resolveBrandIdentity(name) {
  if (!name) return { name: null, brandCode: null, aliases: [], sourcingType: null };
  const entry = brandSelectorIdentityByName.get(name);
  return {
    name,
    brandCode: entry ? monthlyReportBrandCode(entry) : null,
    aliases: entry ? (entry.name_aliases || []) : [],
    sourcingType: entry?.sourcing_type || null
  };
}

function renderEntitySourcingBadge() {
  const badge = $("#entityHeroSourcingBadge");
  if (badge) badge.textContent = `운영 방식 · ${entitySourcingLabels[brandIdentityState.sourcingType] || "데이터 연결 대기"}`;
}

// STEP62-3: Identity Layer. ECOUNT brandGroup 등 원본 코드(예: "424", "BON CO")를 Brand
// Master의 canonical 표시명(브랜드 선택기가 이미 fetch해 둔 brandSelectorIdentityByName,
// STEP61-1)과 대소문자/공백만 정규화해 정확히 일치하는 항목이 있는지 확인한다. 부분/추론
// 매칭은 하지 않는다 — 정확히 일치하지 않으면 반드시 null을 반환해 호출부가 원본 값을 그대로
// 쓰게 한다("Brand Master에 없는 경우 기존 표시 유지"). Brand Master는 읽기만 하고 절대
// 수정하지 않는다.
function resolveRawBrandCanonical(rawCode) {
  const normalized = String(rawCode || "").trim().toUpperCase();
  if (!normalized) return null;
  for (const [displayName, entry] of brandSelectorIdentityByName) {
    const candidates = [displayName, entry?.brand_name, ...(entry?.name_aliases || [])];
    if (candidates.some((candidate) => String(candidate || "").trim().toUpperCase() === normalized)) {
      return displayName;
    }
  }
  return null;
}

// STEP61-1: Brand Selector가 확정한 Identity를 Monthly Archive의 commerce.brandSales와
// 대조해 같은 canonical brand로 이어지는지 확인한다(콘솔 로그만 — Hero/Monthly UI는 이번
// STEP에서 손대지 않는다). Entity Period Control이 이미 갖고 있는 entityPeriodState(연/월)를
// 그대로 재사용해 "지금 보고 있는 기간" 기준으로 확인한다(새 기간 상태를 만들지 않음).
async function verifyBrandIdentityMonthlyMapping() {
  if (!brandIdentityState.brandCode) {
    if (brandIdentityState.name) {
      console.log(`[Brand Identity] "${brandIdentityState.name}" → brand_code 미확인(Brand Master 응답에 없음). Monthly 매핑 확인을 건너뜁니다.`, brandIdentityState);
    }
    return;
  }
  if (entityPeriodState.mode !== "monthly") {
    console.log(`[Brand Identity] 현재 기간 모드가 "${entityPeriodState.mode}"라 월별 brandSales 매핑 확인은 monthly 모드에서만 수행합니다.`);
    return;
  }
  const month = `${entityPeriodState.year}-${String(entityPeriodState.month).padStart(2, "0")}`;
  const archive = await getSharedJson(`/api/reports/monthly?month=${month}`, 8000);
  if (archive?.error) {
    console.log(`[Brand Identity] ${month} Monthly Archive 조회 실패:`, archive.error);
    return;
  }
  const brandSales = archive?.commerce?.brandSales || [];
  const match = brandSales.find((row) => monthlyReportBrandCode(row) === brandIdentityState.brandCode);
  console.log(
    `[Brand Identity] "${brandIdentityState.name}" (brand_code=${brandIdentityState.brandCode}) → ${month} Monthly brandSales 매핑: ${match ? "FOUND" : "NOT FOUND"}`,
    match || { checkedRowCount: brandSales.length }
  );
}

function applyBrandIdentity(name) {
  brandIdentityState = resolveBrandIdentity(name);
  renderEntitySourcingBadge();
  verifyBrandIdentityMonthlyMapping();
  // STEP61-2: Brand 변경/해제는 전부 이 함수 하나를 거치므로(selectBrandSelectorName/
  // clearBrandSelectorSelection/initBrandSelector 3곳), Monthly Intelligence 갱신도 여기
  // 한 곳에만 연결하면 "Brand 변경 → Monthly 값 변경" 요구사항이 세 진입점 모두에서 자동으로
  // 충족된다(진입점마다 갱신 호출을 중복 작성하지 않음).
  refreshEntityTrendMonths();
}

// STEP59-4C: 비교 브랜드 선택 커밋 — entityCompareBrandBSelection 하나만 바꾸고 공용
// render 함수만 재사용한다(섹션별 개별 반영 로직 없음, STEP59-4B의 select onchange와
// 동일한 2줄 의도를 Entity Selector 버전으로 옮긴 것뿐).
function selectEntityCompareBrandB(name) {
  if (!name || entitySelectorInstances.compare.isDisabled(name)) return;
  entityCompareBrandBSelection = name;
  const recentIndex = brandSelectorRecentNames.indexOf(name);
  if (recentIndex >= 0) brandSelectorRecentNames.splice(recentIndex, 1);
  brandSelectorRecentNames.unshift(name);
  brandSelectorRecentNames.splice(5);
  const triggerLabel = $("#entityCompareBrandBTriggerLabel");
  if (triggerLabel) triggerLabel.textContent = name;
  renderEntitySelectorRecent("compare");
  renderEntitySelectorAll("compare");
  closeEntitySelectorDropdown("compare");
  renderEntityCompareUI();
  refreshEntityTrendMonths();
}

// STEP59-2: Entity Period Control Foundation. 화면 전체가 바라보는 기간을 명확히 하는
// 상태 기반만 만든다 — 실데이터 연결도, 기간별 숫자 계산도 하지 않는다. Customer/
// Category/Trend별로 기간 변수를 따로 만들지 않고 단일 entityPeriodState 하나만 두고,
// Brand Selector의 brandSelectorActiveName과는 절대 결합하지 않는다(브랜드를 선택/해제
// 해도 기간은 그대로 유지). 브라우저 현재 날짜를 쓰지 않고 요구된 기본값(월간·2026·7)만
// 사용한다.
const entityInitialDate = new Date();
let entityPeriodState = { mode: "monthly", year: entityInitialDate.getFullYear(), month: entityInitialDate.getMonth() + 1 };
// STEP59-3: Compare Mode UI. entityCompareState.enabled만 실제로 켜고 끈다 — 비교
// 대상 기간 계산/증감 계산/실데이터 연결은 하지 않는다. 켜졌을 때 보이는 모든 요소는
// entity-compare-only 클래스 + body.entity-compare-on 조합의 CSS 표시 전환뿐이라
// 섹션(Customer/Category/Trend/Drawer)마다 개별 토글 로직을 추가하지 않는다.
let entityCompareState = { enabled: false };

function entityPeriodLabel() {
  if (entityPeriodState.mode === "monthly") return `${entityPeriodState.year}년 ${entityPeriodState.month}월`;
  if (entityPeriodState.mode === "annual") return `${entityPeriodState.year}년 전체`;
  return "전체 기간";
}

// Hero/Customer/Category/Trend 보조 문구 + Hero 배지를 이 함수 하나로만 갱신한다(섹션별
// 개별 기간 갱신 로직 없음). 실제 숫자는 전혀 바꾸지 않고 문구만 갱신한다.
function applyEntityPeriodContext() {
  const label = entityPeriodLabel();
  const labelEl = $("#entityPeriodLabel");
  if (labelEl) labelEl.textContent = label;
  // STEP67-6: "월간" 모드는 이제 매출/판매수량/객단가/주문수/MoM/Channel Mix/SKU/
  // Customer Composition/AI Insight가 전부 실데이터로 연결돼 있어 "Placeholder UI" 표기가
  // 더 이상 정확하지 않다. 연간/전체 모드는 여전히 문구만 바뀌고 실제 재계산이 없으므로
  // (이번 STEP 범위 밖 — 새 화면/새 계산 금지) 그 두 모드에서만 라벨을 유지한다.
  const heroBadge = $("#entityHeroPeriodBadge");
  if (heroBadge) {
    heroBadge.textContent = entityPeriodState.mode === "monthly" ? label : `${label} · Placeholder UI`;
  }
  const compositionNote = $("#entityCompositionPeriodNote");
  if (compositionNote) compositionNote.textContent = `기준 기간: ${label}`;
  const categoryNote = $("#entityCategoryPeriodNote");
  if (categoryNote) categoryNote.textContent = `기준 기간: ${label}`;
  const trendNote = $("#entityTrendPeriodNote");
  if (trendNote) {
    trendNote.textContent = entityPeriodState.mode === "monthly"
      ? "선택 월을 포함한 최근 월별 흐름"
      : entityPeriodState.mode === "annual"
        ? "선택 연도의 월별 흐름"
        : "전체 기간의 연도별 흐름";
  }
  // STEP59-4: Compare Header의 "현재 기간"도 이 함수가 유일하게 갱신한다(기간이 바뀔
  // 때마다 호출되는 지점이 이미 여기뿐이므로, renderEntityCompareUI()에 별도 리스너를
  // 추가하지 않고 여기서 한 줄만 더한다).
  const compareHeaderCurrentPeriod = $("#entityCompareHeaderCurrentPeriod");
  if (compareHeaderCurrentPeriod) compareHeaderCurrentPeriod.textContent = label;
  // STEP60-2: Cross Entity Navigation. 기간이 바뀔 때도 Workspace Context Bar가 같은
  // 함수 하나로 갱신되도록 여기서 한 줄만 더한다(전용 리스너 추가 없음).
  renderWorkspaceContextBar();
}

// 활성 기간 모드 표시 + 연도/월 Select 노출 제어 + Context 갱신을 한 곳에서 처리한다.
function renderEntityPeriodControl() {
  $$("[data-entity-period-mode]").forEach((btn) => {
    const active = btn.dataset.entityPeriodMode === entityPeriodState.mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  const yearSelect = $("#entityPeriodYear");
  const monthSelect = $("#entityPeriodMonth");
  if (yearSelect) {
    yearSelect.toggleAttribute("hidden", entityPeriodState.mode === "all");
    yearSelect.value = String(entityPeriodState.year);
  }
  if (monthSelect) {
    monthSelect.toggleAttribute("hidden", entityPeriodState.mode !== "monthly");
    monthSelect.value = String(entityPeriodState.month);
  }
  applyEntityPeriodContext();
}

// 실제 current period에서 계산한 target key를 표시한다. custom은 입력 UI가 없으므로
// 임의 날짜 대신 미확정 상태를 유지한다.
function entityCompareTargetLabel() {
  const select = $("#entityCompareTarget");
  if (select) {
    const prev = select.querySelector('option[value="prev"]');
    const yoy = select.querySelector('option[value="yoy"]');
    if (prev) prev.textContent = entityCompareMonthKeyLabel(entityComparePeriodKeyForMode("prev"));
    if (yoy) yoy.textContent = entityCompareMonthKeyLabel(entityComparePeriodKeyForMode("yoy"));
  }
  const key = entityCompareTargetPeriodKey();
  return key ? entityCompareMonthKeyLabel(key) : select?.value === "custom" ? "사용자 지정 · 미확정" : "비교 대상 미확정";
}

// STEP59-4: Compare Mode UX Refinement. 새 Entity State를 만들지 않고 기존
// brandSelectorActiveName만 읽어 "기준 브랜드"를 파생한다. "비교 브랜드"는 실제 비교
// 대상 선택 기능이 아직 없으므로(다음 STEP 범위) 이미 화면 다른 곳(Brand Overview)에서
// 써온 placeholder 브랜드명 중 기준 브랜드와 겹치지 않는 하나만 고정 반환한다 — 실제
// 데이터 연결/계산 없이 화면 표현(브랜드명 텍스트)만 통일하기 위한 헬퍼다.
function entityCompareBrandA() {
  return brandSelectorActiveName || "기준 브랜드 선택";
}

// STEP59-4B/STEP59-4C: Compare Brand Selector. 사용자가 비교 브랜드 Entity Selector
// (entitySelectorInstances.compare)에서 고른 값을 이 변수 하나에만 저장한다(섹션별
// 선택 상태 없음). 아직 선택하지 않았거나, 선택값이
// 기준 브랜드와 같아진 경우(기준을 나중에 바꿔서 겹치게 된 경우 포함)에는 STEP59-4의
// 기존 fallback 로직으로 되돌아간다 — 동일 브랜드가 절대 반환되지 않는다.
let entityCompareBrandBSelection = null;

function entityCompareBrandB() {
  if (entityCompareBrandBSelection && entityCompareBrandBSelection !== entityCompareBrandA()) {
    return entityCompareBrandBSelection;
  }
  return "비교 브랜드 선택";
}

// Compare 토글 버튼 하나의 상태(entityCompareState.enabled)를 body 클래스 하나로만
// 반영한다. Hero 증감 Chip/Customer·Category TOP5 증감 Chip/Trend 두 번째 선/
// Comparison Summary 카드/Drawer 비교 기간 줄은 전부 CSS(.entity-compare-only +
// body.entity-compare-on)로만 표시가 전환되므로, 섹션별 렌더 함수를 다시 호출하지
// 않아도 된다(공용 함수 1개로 전체 화면이 즉시 반응). Compare Header의 브랜드/기간
// 텍스트도 이 함수 하나에서만 채운다(섹션별 개별 갱신 로직 없음).
function renderEntityCompareUI() {
  document.body.classList.toggle("entity-compare-on", entityCompareState.enabled);
  const toggle = $("#entityCompareToggle");
  if (toggle) toggle.setAttribute("aria-pressed", String(entityCompareState.enabled));
  const toggleLabel = $("#entityCompareToggleLabel");
  if (toggleLabel) toggleLabel.textContent = entityCompareState.enabled ? "비교 모드 ON" : "비교 모드 OFF";
  const brandAEl = $("#entityCompareBrandAName");
  if (brandAEl) brandAEl.textContent = entityCompareBrandA();
  const targetPeriodEl = $("#entityCompareHeaderTargetPeriod");
  if (targetPeriodEl) targetPeriodEl.textContent = entityCompareTargetLabel();
  // STEP59-4: Customer Composition compare 블록의 브랜드명도 같은 두 헬퍼를 재사용한다
  // (섹션 전용 브랜드 표시 로직을 새로 만들지 않음).
  const compositionBrandA = $("#entityCompareCompositionBrandA");
  if (compositionBrandA) compositionBrandA.textContent = entityCompareBrandA();
  const compositionBrandB = $("#entityCompareCompositionBrandB");
  if (compositionBrandB) compositionBrandB.textContent = entityCompareBrandB();
  const categoryBrandA = $("#entityCompareCategoryBrandA");
  if (categoryBrandA) categoryBrandA.textContent = entityCompareBrandA();
  const categoryBrandB = $("#entityCompareCategoryBrandB");
  if (categoryBrandB) categoryBrandB.textContent = entityCompareBrandB();
  const trendBrandA = $("#entityCompareTrendBrandA");
  if (trendBrandA) trendBrandA.textContent = entityCompareBrandA();
  const trendBrandB = $("#entityCompareTrendBrandB");
  if (trendBrandB) trendBrandB.textContent = entityCompareBrandB();
  // STEP59-4C: Unified Entity Selector. 비교 브랜드 트리거 라벨은 entityCompareBrandB()의
  // 최종 결과로 맞추고(기준과 겹쳐 자동 대체된 경우 포함), Recent/All 목록도 다시 그려
  // disabled 표시(entitySelectorInstances.compare.isDisabled)가 항상 최신 기준 브랜드를
  // 반영하도록 한다 — 목록 렌더 로직 자체는 새로 만들지 않고 기존 함수만 재호출한다.
  const brandBTriggerLabel = $("#entityCompareBrandBTriggerLabel");
  if (brandBTriggerLabel) brandBTriggerLabel.textContent = entityCompareBrandB();
  if ($("#entityCompareBrandBRecent")) {
    renderEntitySelectorRecent("compare");
    renderEntitySelectorAll("compare");
  }
  renderWorkspaceContextBar();
  // STEP67-9E-1: Comparison Monthly Core KPI. Brand B 변경/비교 모드 토글/종료는 전부 이
  // 함수를 거치므로(selectEntityCompareBrandB/entityCompareToggle 클릭/종료 버튼), 별도
  // 트리거를 추가하지 않고 여기서 한 번만 더 호출한다. Brand A 변경 경로는
  // refreshEntityTrendMonths() 쪽에서 이미 호출한다.
  refreshEntityCompareKpi();
  if (entityCompareState.enabled) {
    // STEP67-9H-3: Comparison OFF 상태에서 Primary Brand가 이미 empty(#entityCompositionContent
    // hidden=true)였다면, 이 토글 경로는 Brand A를 재조회하지 않으므로(Brand A는 이미
    // entityCompareCompositionState.a에 정확한 값을 갖고 있다 — refreshEntityCustomerComposition()이
    // 이전에 채워둠) 그 hidden 상태가 그대로 남아 방금 그릴 Comparison 블록까지 함께 가려진다.
    // renderEntityCompositionEmpty()는 이미 비교 모드일 때 content를 항상 visible로 두도록
    // 되어 있으므로(STEP67-9H-2) 여기서 한 번 더 불러 visibility만 정리한다 — 새 fetch 없음.
    renderEntityCompositionEmpty();
    refreshEntityCompareCustomerComposition();
  } else {
    // STEP67-9H-3: 반대 방향(Comparison ON → OFF) 회귀. 비교 모드 진입 시 위에서 content를
    // 강제로 visible 처리했으므로, 종료할 때도 Primary 상태를 다시 확인해 정확히 복원해야
    // 한다 — 그냥 renderEntityCompositionSection()만 부르면(기존 코드) Primary가 실제로는
    // empty인데 content가 계속 visible로 남는다. entityCompareCompositionState.a는 이미
    // refreshEntityCustomerComposition()이 채워둔 정확한 값이므로 새 fetch 없이 그 status만
    // 읽어 단일 브랜드 Empty State 정책을 그대로 재적용한다.
    if (entityCompareCompositionState.a.status === "ready") {
      const empty = $("#entityCompositionEmpty");
      const content = $("#entityCompositionContent");
      if (empty) empty.hidden = true;
      if (content) content.hidden = false;
    } else if (["empty", "error"].includes(entityCompareCompositionState.a.status)) {
      renderEntityCompositionEmpty();
    }
    renderEntityCompositionSection();
  }
}

// STEP60-2: Cross Entity Navigation. 새 Global State를 만들지 않고 이미 있는
// brandSelectorActiveName/entityPeriodState/entityCompareState 3개만 읽는 작은 고정
// 배지다. Brand Dashboard 밖(Inventory/Monthly/Clients 등 다른 Workspace)으로 이동해도
// 어떤 .view 섹션에도 속하지 않는 document.body 직속 엘리먼트라 항상 보인다 — Workspace
// Header Preview 요구사항을 topbar 구조를 건드리지 않고 만족한다.
function workspaceContextBarNode() {
  let el = $("#workspaceContextBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "workspaceContextBar";
    el.className = "workspace-context-bar";
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function renderWorkspaceContextBar() {
  const el = workspaceContextBarNode();
  if (!brandSelectorActiveName) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `
    <span class="workspace-context-bar-label">Context</span>
    <strong class="workspace-context-bar-brand">${esc(brandSelectorActiveName)}</strong>
    <span class="workspace-context-bar-period">${esc(entityPeriodLabel())}</span>
    <span class="workspace-context-bar-compare ${entityCompareState.enabled ? "on" : "off"}">비교 ${entityCompareState.enabled ? "ON" : "OFF"}</span>
  `;
}

// STEP58-4/58-4B: 브랜드 미선택 시 Hero의 Health Score/AI Summary/추천 Action/KPI와
// EntityComposition/EntityTrend/EntityCategory의 placeholder 데이터(도넛/TOP5/차트/AI
// Insight)를 실제 분석처럼 보여주지 않는다. 계산 로직은 전혀 추가하지 않고, 기존
// placeholder 콘텐츠 블록과 섹션별 Empty State 카드를 hidden 속성으로만 토글하는 단일
// 함수로 처리한다(동일 상태 로직을 여러 함수에 중복 작성하지 않음) — 새 상태 변수를
// 만들지 않고 Brand Selector가 이미 갖고 있는 brandSelectorActiveName(선택된 브랜드
// 유무)만 참조한다. Content 래퍼가 hidden이면 내부 토글/hover 대상 DOM 자체가 화면에서
// 사라지므로, 이벤트 리스너에 별도 분기(조건문)를 추가하지 않아도 hover/토글 호출이
// 자연히 발생하지 않는다(DOM이 숨겨져 이벤트 진입 불가).
function renderEntityHeroState() {
  const selected = Boolean(brandSelectorActiveName);
  $("#brandSelectorClearBtn")?.toggleAttribute("hidden", !selected);
  $("#entityHeroMeta")?.toggleAttribute("hidden", !selected);
  $("#entityHeroEmptyPanel")?.toggleAttribute("hidden", selected);
  $("#entityHeroContent")?.toggleAttribute("hidden", !selected);
  $("#entityHeroEmptyKpi")?.toggleAttribute("hidden", selected);
  $("#entityHeroKpiGrid")?.toggleAttribute("hidden", !selected);
  $("#entityHeroSkuLine")?.toggleAttribute("hidden", !selected);

  $("#entityCompositionToggle")?.toggleAttribute("hidden", !selected);
  $("#entityCompositionEmpty")?.toggleAttribute("hidden", selected);
  $("#entityCompositionContent")?.toggleAttribute("hidden", !selected);

  $("#entityTrendEmpty")?.toggleAttribute("hidden", selected);
  $("#entityTrendContent")?.toggleAttribute("hidden", !selected);

  $("#entityCategoryToggle")?.toggleAttribute("hidden", false);
  $("#entityCategoryEmpty")?.toggleAttribute("hidden", false);
  $("#entityCategoryContent")?.toggleAttribute("hidden", false);
}

function renderEntitySystemStatusItem(id, label, ok, updatedAt) {
  const item = $(`#${id}`);
  if (!item) return;
  const badge = item.querySelector(".brand-hero-status-badge");
  const note = item.querySelector("em");
  const state = ok === true ? "Healthy" : ok === false ? "Unavailable" : "확인 불가";
  if (badge) {
    badge.classList.toggle("good", ok === true);
    badge.classList.toggle("warn", ok !== true);
    badge.innerHTML = `<i></i>${esc(label)} · ${state}`;
  }
  if (note) note.textContent = updatedAt ? freshnessTimestampLabel(updatedAt) : "실제 동기화 시각 확인 불가";
}

async function refreshEntitySystemStatus() {
  const month = currentEntityPeriodMonthKey();
  const [status, ecount] = await Promise.all([
    getSharedJson("/api/status", 8000),
    getJson(`/api/ecount-sales/monthly?month=${encodeURIComponent(month)}`, 8000)
  ]);
  renderEntitySystemStatusItem("entitySystemStatusCafe24", "Cafe24", status?.environment?.cafe24?.ok === true && status?.cafe24 === true, null);
  renderEntitySystemStatusItem("entitySystemStatusMeta", "Meta Ads", status?.environment?.metaAds?.ok === true && status?.metaAds === true, null);
  renderEntitySystemStatusItem("entitySystemStatusInstagram", "Instagram", status?.environment?.instagram?.ok === true && status?.instagram === true, status?.instagramSync?.lastSuccessAt);
  renderEntitySystemStatusItem("entitySystemStatusEcount", "ECOUNT", !ecount?.error && Boolean(ecount?.importedAt), ecount?.importedAt);
}

// STEP59-4C: brandSelectorAllBrands는 primary/compare 두 인스턴스가 공유하는 단일
// 데이터(같은 /api/brand-master 응답)라, 로딩 완료 후 두 인스턴스의 목록을 모두 다시
// 그린다(API를 두 번 호출하지 않음 — 기존 호출 1회 그대로).
async function initBrandSelector() {
  const allList = $("#brandSelectorAll");
  if (!allList) return;
  renderEntitySelectorRecent("primary");
  renderEntitySelectorRecent("compare");
  allList.innerHTML = `<li class="brand-selector-empty">브랜드 목록을 불러오는 중...</li>`;
  const [result, productRegistry] = await Promise.all([
    getSharedJson("/api/brand-master", 12000),
    getSharedJson("/api/intelligence/product-registry", 12000)
  ]);
  registerProductRegistryCanonicalNames(productRegistry?.registry?.entries || productRegistry?.entries);
  registerBrandMasterResponse(result);
  const brands = Array.isArray(result?.brands) ? result.brands : [];
  const activeBrands = brands.filter((brand) => brand?.active !== false && String(brand?.brand_code || "").trim() !== "B0000000");
  // STEP61-1: Brand Identity Layer. 이름만 뽑아 버리던 것을, brandCanonicalDisplayName()
  // 결과를 키로 원본 항목까지 함께 보관한다(같은 표시 이름이 여러 brand_code에 걸리는
  // 경우는 첫 항목을 canonical로 채택 — 기존 names 배열의 Set 중복 제거와 동일한 규칙).
  const identityByName = new Map();
  activeBrands.forEach((brand) => {
    const name = brandCanonicalDisplayName(brand);
    if (name && name !== "미분류" && !identityByName.has(name)) identityByName.set(name, brand);
  });
  brandSelectorIdentityByName = identityByName;
  brandSelectorAllBrands = [...identityByName.keys()].sort((a, b) => a.localeCompare(b, "ko"));
  renderEntitySelectorAll("primary");
  renderEntitySelectorAll("compare");
  // Master Data가 이 fetch보다 늦게 도착했을 수 있으므로(초기 로드 경합), 이미 선택된
  // 브랜드가 있다면 지금 막 채워진 identityByName으로 다시 확인한다.
  if (brandSelectorActiveName) applyBrandIdentity(brandSelectorActiveName);
}

// Entity Composition (STEP55, STEP58-3에서 Entity Intelligence Framework 명명 규칙에 맞춰
// brandCustomer* → entityComposition*로 리네임. UI/동작은 리네임 이전과 100% 동일).
// Clients 탭의 실제 상태(clientsDonutRanges 등)나
// API는 전혀 참조하지 않는 완전히 독립된 placeholder 모듈이다. 도넛 conic-gradient/각도
// 판정 "기법"만 Clients 탭과 동일하게 재구성했다(js:10396-10424 clientsDonutGradient/
// clientsDonutAngleToType 참고, 대상 데이터와 상태는 별개).
// STEP67-6: Customer Composition. Clients 화면과 동일한 canonical 유형/라벨을 쓴다
// (intelligence-service.mjs의 CLIENT_TYPE_LABELS와 값 동일 — 새 라벨 발명 금지). 색상은
// 이 프로젝트가 이미 쓰는 Category Intelligence 팔레트를 재사용한다(entityCategoryColors와
// 동일 값, 새 색상 발명 없음).
const entityCompositionTypeLabel = {
  stylist: "스타일리스트",
  samplas_press: "프레스",
  customer: "일반 손님",
  foreign: "외국인",
  online_first_signup: "온라인 첫가입",
  ff: "직원 구매"
};
const entityCompositionColors = {
  stylist: "#171717",
  samplas_press: "#c76a35",
  customer: "#6d6a62",
  foreign: "#4fb082",
  online_first_signup: "#8d6ecf",
  ff: "#d7a642"
};
// STEP67-6: 브랜드/기간이 바뀔 때마다 refreshEntityCustomerComposition()이 실제 API 응답으로
// 다시 채운다(fetch 전까지는 빈 상태) — 이전에는 하드코딩된 가짜 고객 8명이 항상 표시됐다.
let entityCompositionTypeStats = {};
let entityCompositionRows = [];
let entityCompositionSeq = 0;
let entityCompositionMode = "count";
let entityCompositionActiveType = null;
let entityCompareCompositionSeq = 0;
let entityCompareCompositionState = {
  a: { key: null, status: "pending", stats: {} },
  b: { key: null, status: "unselected", stats: {} }
};

function entityCompositionDataset(data, key) {
  if (data?.error || !Array.isArray(data?.typeStats)) return { key, status: "error", stats: {} };
  if (!data.typeStats.length) return { key, status: "empty", stats: {} };
  return {
    key,
    status: "ready",
    stats: Object.fromEntries(data.typeStats.map((row) => [row.type, { count: row.count, sales: row.sales }]))
  };
}

// STEP67-customer-composition-retry-fix: Customer Composition endpoint(/api/brand-
// intelligence/:code/customer-composition)이 STEP67-10G-1이 /api/reports/monthly에
// 이미 적용한 것과 정확히 같은 8초 실패 시 30초 1회 재시도 패턴을 쓰지 않아, 진행 중인
// 현재 월처럼 실시간 계산이 오래 걸리는 조합에서 고정 8초 타임아웃에 걸리면 무한 재시도
// 없이 바로 "데이터 연결 실패"로 확정돼 버렸다(NEXT-CROSS-BRAND-PARTIAL-PERIOD-diagnosis
// §4). getEntityCompareMonthlyArchive()와 동일하게 "응답 지연"일 때만 정확히 1회, 30초로
// 재시도한다 — 그 외 에러는 재시도하지 않고 그대로 반환한다(무한 반복 금지).
const ENTITY_COMPOSITION_TIMEOUT_MS = 8000;
const ENTITY_COMPOSITION_RETRY_TIMEOUT_MS = 30000;

async function getEntityCompositionJson(url) {
  const first = await getJson(url, ENTITY_COMPOSITION_TIMEOUT_MS);
  if (first?.error !== "응답 지연") return first;
  return getJson(url, ENTITY_COMPOSITION_RETRY_TIMEOUT_MS);
}

function entityCompositionRatiosForStats(stats) {
  const total = Object.values(stats).reduce((sum, row) => sum + Number(row[entityCompositionMode] || 0), 0);
  if (!total) return [];
  return Object.entries(stats).map(([type, row]) => ({
    type,
    ratioPct: (Number(row[entityCompositionMode] || 0) / total) * 100
  }));
}

function entityCompositionRatios() {
  return entityCompositionRatiosForStats(entityCompositionTypeStats);
}

function entityCompositionRanges() {
  let cursor = 0;
  return entityCompositionRatios().map((row) => {
    const start = cursor;
    cursor += row.ratioPct;
    return { type: row.type, start, end: cursor };
  });
}

function entityCompositionGradient(activeType) {
  const ranges = entityCompositionRanges();
  if (!ranges.length) return "#dedbd2 0% 100%";
  return ranges.map((row) => {
    const color = activeType && row.type !== activeType ? "#e5e2d8" : entityCompositionColors[row.type];
    return `${color} ${row.start}% ${row.end}%`;
  }).join(", ");
}

function entityCompareCompositionGradient(stats) {
  let cursor = 0;
  const ranges = entityCompositionRatiosForStats(stats).map((row) => {
    const start = cursor;
    cursor += row.ratioPct;
    return { ...row, start, end: cursor };
  });
  return ranges.map((row) => `${entityCompositionColors[row.type]} ${row.start}% ${row.end}%`).join(", ");
}

function renderEntityCompareCompositionDonut(id, dataset, brandName) {
  const donut = $(id);
  if (!donut) return;
  const label = donut.querySelector("span");
  const statusText = dataset.status === "unselected"
    ? "비교 브랜드를 선택하세요"
    : dataset.status === "empty"
      ? "해당 기간 오프라인 고객 데이터 없음"
      : dataset.status === "error"
        ? "데이터 연결 실패"
        : dataset.status === "pending"
          ? "데이터 연결 대기"
          : "";
  if (statusText) {
    donut.style.background = "var(--line)";
    donut.classList.add("is-unavailable");
    if (label) label.textContent = statusText;
    donut.setAttribute("aria-label", `${brandName} · ${statusText}`);
    return;
  }
  const gradient = entityCompareCompositionGradient(dataset.stats);
  const total = Object.values(dataset.stats).reduce((sum, row) => sum + Number(row[entityCompositionMode] || 0), 0);
  donut.classList.remove("is-unavailable");
  donut.style.background = `conic-gradient(${gradient})`;
  if (label) label.textContent = entityCompositionMode === "count" ? `${apiNum(total)}건` : apiWon(total);
  donut.setAttribute("aria-label", `${brandName} · ${currentEntityPeriodMonthKey()} · ${entityCompositionMode === "count" ? "건수" : "매출"} 기준 고객 구성`);
}

// STEP67-9H-2: 두 브랜드의 legend가 항상 같은 유형 목록(둘 중 하나라도 그 유형을 가지면
// 포함)을 같은 순서로 보여준다 — 한쪽에만 있는 유형이 있어도 그 브랜드 쪽에는 0%로
// 표시해 두 column의 행 수가 어긋나지 않게 한다(요구사항 6, 레이아웃 흔들림 방지).
// 단, 그 브랜드 자체가 "데이터 없음"(status !== ready, 도넛이 이미 그 사실을 정직하게
// 보여줌)이면 0%로 채운 행을 만들지 않는다 — 실제로 측정한 0%처럼 보이면 안 되므로
// legend를 비워 둔다(도넛의 unavailable 문구가 유일한 근거).
// entityCompositionColors/entityCompositionTypeLabel/entityCompositionRatiosForStats는
// 전부 기존 단일 브랜드 legend가 이미 쓰는 것을 그대로 재사용한다(새 분류/새 색 없음).
function renderEntityCompareCompositionLegend(id, dataset, types) {
  const legend = $(id);
  if (!legend) return;
  if (dataset.status !== "ready") {
    legend.innerHTML = "";
    return;
  }
  const ratioByType = Object.fromEntries(entityCompositionRatiosForStats(dataset.stats).map((row) => [row.type, row.ratioPct]));
  legend.innerHTML = types.map((type) => `
    <li><i style="background:${entityCompositionColors[type]}"></i><span class="clients-legend-label">${esc(entityCompositionTypeLabel[type] || type)}</span><em>${(ratioByType[type] || 0).toFixed(0)}%</em></li>`).join("");
}

function renderEntityCompareComposition() {
  if (!entityCompareState.enabled) return;
  renderEntityCompareCompositionDonut("#entityCompareCompositionDonutA", entityCompareCompositionState.a, entityCompareBrandA());
  renderEntityCompareCompositionDonut("#entityCompareCompositionDonutB", entityCompareCompositionState.b, entityCompareBrandB());
  const types = [...new Set([
    ...Object.keys(entityCompareCompositionState.a.stats),
    ...Object.keys(entityCompareCompositionState.b.stats)
  ])];
  renderEntityCompareCompositionLegend("#entityCompareCompositionLegendA", entityCompareCompositionState.a, types);
  renderEntityCompareCompositionLegend("#entityCompareCompositionLegendB", entityCompareCompositionState.b, types);
  // STEP67-10G-3: 고객 구성이 이 함수를 거쳐 최종 확정될 때마다 Comparison Summary도
  // 다시 그린다(정의는 renderEntityCompareTargetPeriodData 근처, 아래에 위치).
  renderEntityCompareSummary();
}

async function refreshEntityCompareCustomerComposition(month = currentEntityPeriodMonthKey()) {
  const brandBName = entityCompareBrandB();
  if (!entityCompareState.enabled || brandBName === "비교 브랜드 선택") {
    entityCompareCompositionState.b = { key: null, status: "unselected", stats: {} };
    renderEntityCompareComposition();
    return;
  }
  const brandBCode = resolveBrandIdentity(brandBName).brandCode;
  const key = `${brandBCode || ""}|${month || ""}`;
  if (!brandBCode || !month) {
    entityCompareCompositionState.b = { key, status: "error", stats: {} };
    renderEntityCompareComposition();
    return;
  }
  if (entityCompareCompositionState.b.key === key && ["ready", "empty"].includes(entityCompareCompositionState.b.status)) {
    renderEntityCompareComposition();
    return;
  }
  const seq = ++entityCompareCompositionSeq;
  entityCompareCompositionState.b = { key, status: "pending", stats: {} };
  renderEntityCompareComposition();
  const data = await getEntityCompositionJson(`/api/brand-intelligence/${encodeURIComponent(brandBCode)}/customer-composition?month=${encodeURIComponent(month)}`);
  if (seq !== entityCompareCompositionSeq) return;
  entityCompareCompositionState.b = entityCompositionDataset(data, key);
  renderEntityCompareComposition();
}

function entityCompositionAngleToType(ranges, event, donutEl) {
  if (!ranges.length) return null;
  const rect = donutEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const radius = Math.min(rect.width, rect.height) / 2;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > radius || dist < radius * 0.3) return null;
  let deg = Math.atan2(dx, -dy) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  const pctPos = (deg / 360) * 100;
  const found = ranges.find((row) => pctPos >= row.start && pctPos < row.end);
  return found ? found.type : (ranges[ranges.length - 1]?.type || null);
}

function entityCompositionDonutTooltipHtml(type) {
  const stats = entityCompositionTypeStats[type];
  if (!stats) return "";
  const ratio = entityCompositionRatios().find((row) => row.type === type);
  return `<strong>${esc(entityCompositionTypeLabel[type])}</strong><br>비율 ${(ratio?.ratioPct || 0).toFixed(1)}% · 건수 ${apiNum(stats.count)}건 · 매출 ${apiWon(stats.sales)}`;
}

function sortedEntityCompositionRows() {
  return [...entityCompositionRows]
    .sort((a, b) => (entityCompositionMode === "count" ? b.count - a.count : b.sales - a.sales))
    .slice(0, 5);
}

// STEP55-2: TOP5 hover를 기존 검은 tooltip 대신 Quick Profile Card로 보여준다. Pie/범례/
// KPI/Score hover는 그대로 showEntityHeroTooltip*(검은 tooltip)을 쓰고, 이 카드는 TOP5
// 전용 신규 컴포넌트다. 표시 위치는 anchor 오른쪽 우선, 공간 부족 시 왼쪽으로 뒤집는다.
let entityCompositionProfileShowTimer = null;
let entityCompositionProfileHideTimer = null;
// STEP60-3: Client Workspace Foundation. 마지막으로 카드를 띄운 row를 기억해두었다가
// "고객 분석 열기" 클릭 시 그대로 Workspace로 넘긴다 — 클릭 시점에 별도 조회 없이
// 이미 hover 중이던 고객 데이터를 그대로 재사용한다.
let entityCompositionProfileActiveRow = null;

function cancelEntityCompositionProfileHide() {
  clearTimeout(entityCompositionProfileHideTimer);
  entityCompositionProfileHideTimer = null;
}

function scheduleEntityCompositionProfileHide() {
  clearTimeout(entityCompositionProfileShowTimer);
  cancelEntityCompositionProfileHide();
  entityCompositionProfileHideTimer = setTimeout(() => {
    const card = $("#entityCompositionProfileCard");
    if (!card) return;
    card.classList.remove("is-visible");
    card.hidden = true;
  }, 120);
}

function entityCompositionProfileNode() {
  let card = $("#entityCompositionProfileCard");
  if (!card) {
    card = document.createElement("div");
    card.id = "entityCompositionProfileCard";
    card.className = "brand-customer-profile-card";
    card.hidden = true;
    // 카드 위로 커서가 이동해도 유지되고, 카드를 벗어나면 다시 사라지도록 자체 hover도 관리한다.
    card.addEventListener("mouseenter", cancelEntityCompositionProfileHide);
    card.addEventListener("mouseleave", scheduleEntityCompositionProfileHide);
    document.body.appendChild(card);
  }
  return card;
}

function positionEntityCompositionProfileCard(anchor, card) {
  const margin = 16;
  const gap = 14;
  const rect = anchor.getBoundingClientRect();
  const width = card.offsetWidth || 345;
  const height = card.offsetHeight || 300;
  const fitsRight = rect.right + gap + width + margin <= window.innerWidth;
  let left = fitsRight ? rect.right + gap : rect.left - gap - width;
  left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin));
  let top = rect.top - (height - rect.height) / 2;
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

// STEP60-2B: Client Quick Profile. Header → KPI → 최근 Activity → Related → Explore 패턴.
// BATCH A: "최근 주문" 섹션은 entityClientPurchaseLinesFor(row)의 실제 데이터를 최대
// 3건만 압축해서 보여준다(호버 카드는 좁은 공간이라 전체 목록은 여전히 아래 "최근 주문
// 보기" 버튼이 여는 clientOrders Drawer가 담당 — 새 UI를 만들지 않음).
function entityCompositionProfileHtml(row) {
  const aov = row.count ? Math.round(row.sales / row.count) : 0;
  const brandLines = entityClientPurchaseLinesFor(row);
  const recentHtml = entityClientPurchaseStateHtml(brandLines) || brandLines.slice(0, 3).map((line) => (
    `<div class="brand-customer-profile-row"><span>${esc(line.date || "-")}</span><strong>${esc(line.productName || "제품 정보 없음")} · ${apiWon(line.salesAmount)}</strong></div>`
  )).join("");
  return `
    <div class="brand-customer-profile-head">
      <div class="brand-customer-profile-heading">
        <strong>${esc(row.name)}</strong>
        <span class="clients-tooltip-badge brand-customer-type-badge" style="border-color:${entityCompositionColors[row.type]}22;color:${entityCompositionColors[row.type]}">${esc(entityCompositionTypeLabel[row.type] || "-")}</span>
      </div>
      <div class="brand-customer-profile-vip-ring" style="--score:0" aria-label="고객 등급 산식 연결 대기">
        <div class="brand-customer-profile-vip-ring-inner">--</div>
      </div>
    </div>
    <div class="brand-customer-profile-rows">
      <div class="brand-customer-profile-row"><span>총매출</span><strong>${apiWon(row.sales)}</strong></div>
      <div class="brand-customer-profile-row"><span>주문</span><strong>${apiNum(row.count)}건</strong></div>
      <div class="brand-customer-profile-row"><span>객단가</span><strong>${apiWon(aov)}</strong></div>
      <div class="brand-customer-profile-row"><span>최근 구매일</span><strong>${esc(row.lastPurchase || "데이터 없음")}</strong></div>
    </div>
    <p class="brand-customer-profile-section-title">최근 주문</p>
    ${recentHtml}
    <button type="button" class="brand-customer-profile-orders-btn" data-entity-drawer-quick-orders>최근 주문 보기</button>
    <div class="brand-customer-profile-mini-chips" aria-label="관련 상세 탐색">
      <button type="button" data-entity-drawer-quick-jump="sku">SKU</button>
      <button type="button" data-entity-drawer-quick-jump="order">Orders</button>
    </div>
    <button type="button" class="brand-customer-profile-footer-btn" data-entity-drawer-quick-client>고객 상세 Workspace 열기</button>
  `;
}

function showEntityCompositionProfileCard(anchor, row) {
  entityCompositionProfileActiveRow = row;
  clearTimeout(entityCompositionProfileShowTimer);
  entityCompositionProfileShowTimer = setTimeout(() => {
    cancelEntityCompositionProfileHide();
    const card = entityCompositionProfileNode();
    card.innerHTML = entityCompositionProfileHtml(row);
    card.hidden = false;
    card.style.left = "0px";
    card.style.top = "0px";
    positionEntityCompositionProfileCard(anchor, card);
    requestAnimationFrame(() => card.classList.add("is-visible"));
  }, 180);
}

function hideEntityCompositionProfileCardSoon() {
  scheduleEntityCompositionProfileHide();
}

// STEP60-3: Client Workspace Foundation. Quick Profile의 "고객 분석 열기"가 여는 첫 번째
// Workspace다. Marketing OS 철학(질문→답→다음 질문→다음 Workspace)에 맞춰 Drawer(좁은
// 슬라이드 패널)가 아니라 clientsDetailModal과 같은 중앙 정렬 오버레이 패턴(배경 스크림 +
// 포커스 트랩, z-index 2050 — clients-detail-modal 2000과 entity-drawer-modal 2100 사이)을
// 재사용해 "운영 공간"에 맞는 더 넓은 패널로 만든다. 실제 고객별 계산은 하지 않고 Quick
// Profile Card와 동일한 entityCompositionRows row 객체를 그대로 재사용한다(새 데이터 없음).
let clientWorkspaceRow = null;
let clientWorkspacePreviousFocus = null;

// STEP60-1 Entity Drawer의 전역 행 클릭 리스너는 ".entity-drawer-row" 클래스와
// entityDrawerState.type만으로 동작을 결정한다(bind() 참고) — 같은 클래스를 여기서
// 재사용하면 Workspace가 열려 있고 Drawer는 닫혀 있는 상태에서 클릭이 그 리스너에 잘못
// 걸릴 수 있다. 시각 스타일(entity-drawer-rank/name/stat)은 그대로 재사용하되 바깥 li만
// 별도 클래스(client-workspace-order-row, 리스너 없음)를 써서 그 결합을 피한다.
// BATCH A: row는 실제 purchaseDetails 라인(entityDrawerClientOrderRowHtml과 동일한 필드
// 이름/의미 — 옛 product/amount/variant placeholder 필드는 실제 payload에 없어 제거).
function clientWorkspaceOrderRowHtml(row, index) {
  const productLabel = row.productName || "제품 정보 없음";
  const channelLabel = row.source === "online" ? "온라인" : row.source === "offline" ? "오프라인" : "-";
  return `
    <li class="client-workspace-order-row">
      <span class="entity-drawer-rank">${index + 1}</span>
      <span class="entity-drawer-name">${esc(productLabel)}<i class="entity-drawer-code">${esc(channelLabel)}</i></span>
      <span class="entity-drawer-stat"><span>구매일</span><strong>${esc(row.date || "-")}</strong></span>
      <span class="entity-drawer-stat"><span>금액</span><strong>${apiWon(row.salesAmount)}</strong></span>
    </li>`;
}

function clientWorkspaceModalNode() {
  let modal = $("#clientWorkspace");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "clientWorkspace";
    modal.className = "client-workspace-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="client-workspace-backdrop" data-client-workspace-close></div>
      <div class="client-workspace-panel" role="dialog" aria-modal="true" aria-labelledby="clientWorkspaceTitle" tabindex="-1">
        <button type="button" class="client-workspace-close-btn" data-client-workspace-close aria-label="닫기">×</button>
        <div class="client-workspace-body" id="clientWorkspaceBody"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  return modal;
}

// Header(이름/Client Type/VIP) → Breadcrumb → Hero KPI → Brand → Category → 최근 주문 →
// Insight → Related → Explore 순서(Marketing OS 철학의 질문→답→다음 질문 흐름). Header/
// Related/Explore는 Quick Profile Card·Entity Drawer가 이미 쓰는 클래스(brand-customer-
// profile-*/entity-drawer-related*)를 그대로 재사용하고, Hero KPI/Insight는 Brand
// Dashboard의 기존 KPI 카드(.ad-core-kpi-card)를 재사용한다 — 새 카드 컴포넌트를 만들지
// 않는다.
// BATCH A: Brand/Recent Orders 섹션은 entityClientPurchaseLinesFor(row)(선택된 브랜드로
// 필터링된 실제 purchaseDetails)를 읽는다 — Category 섹션은 이번 BATCH 범위 밖이라
// 그대로 둔다(Category Intelligence 자체에 canonical source가 없음, BI-GAP-1 §4).
function clientWorkspaceBodyHtml(row) {
  const aov = row.count ? Math.round(row.sales / row.count) : 0;
  const brandLines = entityClientPurchaseLinesFor(row);
  const brandStateHtml = entityClientPurchaseStateHtml(brandLines);
  const brandSectionHtml = brandStateHtml || (() => {
    const totalSales = brandLines.reduce((sum, line) => sum + Number(line.salesAmount || 0), 0);
    const totalQuantity = brandLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    const latestDate = brandLines.reduce((latest, line) => (!latest || String(line.date || "") > latest ? line.date : latest), null);
    return `
      <div class="cards brand-hero-kpi-grid">
        <article class="action-item ad-summary-card ad-core-kpi-card"><span>이 브랜드 구매금액</span><strong>${apiWon(totalSales)}</strong></article>
        <article class="action-item ad-summary-card ad-core-kpi-card"><span>구매 수량</span><strong>${apiNum(totalQuantity)}개</strong></article>
        <article class="action-item ad-summary-card ad-core-kpi-card"><span>구매 건수</span><strong>${apiNum(brandLines.length)}건</strong></article>
        <article class="action-item ad-summary-card ad-core-kpi-card"><span>최근 구매일</span><strong>${esc(latestDate || "-")}</strong></article>
      </div>`;
  })();
  const recentOrdersHtml = brandStateHtml || brandLines.slice(0, 5).map((line, index) => clientWorkspaceOrderRowHtml(line, index)).join("");
  return `
    <div class="client-workspace-breadcrumb entity-drawer-breadcrumb">
      <button type="button" class="entity-drawer-breadcrumb-crumb" data-client-workspace-breadcrumb-brand>${esc(entityCompareBrandA())}</button>
      <span class="entity-drawer-breadcrumb-sep" aria-hidden="true">›</span>
      <span class="entity-drawer-breadcrumb-current">${esc(row.name)}</span>
    </div>
    <div class="brand-customer-profile-head">
      <div class="brand-customer-profile-heading">
        <strong id="clientWorkspaceTitle">${esc(row.name)}</strong>
        <span class="clients-tooltip-badge brand-customer-type-badge" style="border-color:${entityCompositionColors[row.type]}22;color:${entityCompositionColors[row.type]}">${esc(entityCompositionTypeLabel[row.type] || "-")}</span>
      </div>
      <div class="brand-customer-profile-vip-ring" style="--score:0" aria-label="고객 등급 산식 연결 대기"><div class="brand-customer-profile-vip-ring-inner">--</div></div>
    </div>
    <div class="client-workspace-section">
      <p class="eyebrow">Customer</p>
      <div class="cards brand-hero-kpi-grid">
        <article class="action-item ad-summary-card ad-core-kpi-card"><span>총 구매금액</span><strong>${apiWon(row.sales)}</strong></article>
        <article class="action-item ad-summary-card ad-core-kpi-card"><span>주문 수</span><strong>${apiNum(row.count)}건</strong></article>
        <article class="action-item ad-summary-card ad-core-kpi-card"><span>객단가</span><strong>${apiWon(aov)}</strong></article>
        <article class="action-item ad-summary-card ad-core-kpi-card"><span>최근 구매일</span><strong>${esc(row.lastPurchase)}</strong></article>
      </div>
    </div>
    <div class="client-workspace-section">
      <p class="eyebrow">Brand</p>
      ${brandSectionHtml}
    </div>
    <div class="client-workspace-section">
      <p class="eyebrow">Category</p>
      <div class="entity-detail-empty"><p>고객별 상품군 데이터 연결 대기</p></div>
    </div>
    <div class="client-workspace-section">
      <p class="eyebrow">Recent Orders</p>
      ${recentOrdersHtml}
      <button type="button" class="entity-drawer-open-btn" data-client-workspace-related="clientOrders">최근 주문 Drawer 열기</button>
    </div>
    <article class="intelligence-action-summary brand-hero-action-box brand-customer-insight-card">
      <span>AI Insight</span>
      <p>공식 고객 상세 분석 규칙 연결 대기</p>
    </article>
    <div class="entity-drawer-related">
      <p class="entity-drawer-related-title">Related</p>
      <div class="entity-drawer-related-chips">
        <button type="button" class="entity-drawer-related-chip" data-client-workspace-related="sku">🧵 SKU</button>
        <button type="button" class="entity-drawer-related-chip" data-client-workspace-related="order">🧾 Orders</button>
      </div>
    </div>
    <div class="entity-drawer-related">
      <p class="entity-drawer-related-title">Explore</p>
      <div class="entity-drawer-related-chips">
        <button type="button" class="entity-drawer-related-chip" data-client-workspace-workspace="inventory">📦 Inventory</button>
        <button type="button" class="entity-drawer-related-chip" data-client-workspace-workspace="monthly">📅 Monthly</button>
      </div>
    </div>
  `;
}

function clientWorkspaceFocusableEls(panel) {
  return [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
}

function openClientWorkspace(row) {
  if (!row) return;
  clientWorkspaceRow = row;
  const modal = clientWorkspaceModalNode();
  const body = $("#clientWorkspaceBody");
  if (body) body.innerHTML = clientWorkspaceBodyHtml(row);
  clientWorkspacePreviousFocus = document.activeElement;
  modal.hidden = false;
  document.body.classList.add("client-workspace-open");
  requestAnimationFrame(() => {
    modal.classList.add("is-visible");
    modal.querySelector(".client-workspace-panel")?.focus();
  });
}

function closeClientWorkspace() {
  const modal = $("#clientWorkspace");
  if (!modal || modal.hidden) return;
  modal.classList.remove("is-visible");
  modal.hidden = true;
  document.body.classList.remove("client-workspace-open");
  clientWorkspaceRow = null;
  const toFocus = clientWorkspacePreviousFocus;
  clientWorkspacePreviousFocus = null;
  if (toFocus && typeof toFocus.focus === "function" && document.contains(toFocus)) toFocus.focus();
}

function setEntityCompositionActiveType(type) {
  entityCompositionActiveType = type || null;
  const donut = $("#entityCompositionDonut");
  if (donut) donut.style.background = `conic-gradient(${entityCompositionGradient(entityCompositionActiveType)})`;
  $$("#entityCompositionLegend li").forEach((li) => {
    li.classList.toggle("is-active", Boolean(entityCompositionActiveType) && li.dataset.entityCompositionType === entityCompositionActiveType);
  });
}

// STEP67-6: refreshEntityCustomerComposition()이 채운 실제 typeStats/topCustomers를 그대로
// 그린다. rankChange는 기간 간 순위 비교 데이터가 없어 항상 "-"(실제 비교 데이터가 없으면
// 표시하지 않는다는 원칙)다. 데이터가 아예 없을 때(브랜드는 선택됐지만 이 기간 해당 브랜드
// 오프라인 구매 고객이 없는 경우)는 renderEntityCompositionEmpty()가 별도로 처리한다.
function renderEntityCompositionSection() {
  const donut = $("#entityCompositionDonut");
  if (!donut) return;
  const ratios = entityCompositionRatios();
  if (!ratios.length) return;
  donut.style.background = `conic-gradient(${entityCompositionGradient(entityCompositionActiveType)})`;
  const totalCount = Object.values(entityCompositionTypeStats).reduce((sum, row) => sum + row.count, 0);
  const centerLabel = donut.querySelector(".brand-customer-donut-center strong");
  if (centerLabel) centerLabel.textContent = `${apiNum(totalCount)}건`;

  const legend = $("#entityCompositionLegend");
  if (legend) {
    legend.innerHTML = ratios.map((row) => `
      <li data-entity-composition-type="${esc(row.type)}" tabindex="0">
        <i style="background:${entityCompositionColors[row.type]}"></i>
        <span class="clients-legend-label">${esc(entityCompositionTypeLabel[row.type] || row.type)}</span>
        <em>${row.ratioPct.toFixed(0)}%</em>
      </li>`).join("");
  }

  const top5 = $("#entityCompositionTop5");
  if (top5) {
    const rows = sortedEntityCompositionRows();
    const maxValue = Math.max(1, ...rows.map((row) => (entityCompositionMode === "count" ? row.count : row.sales)));
    top5.innerHTML = rows.map((row, index) => {
      const value = entityCompositionMode === "count" ? row.count : row.sales;
      const barPct = Math.max(4, Math.round((value / maxValue) * 100));
      return `
      <li data-entity-composition-row="${index}" tabindex="0">
        <div class="brand-customer-top5-row-head">
          <span class="brand-customer-top5-rank">${index + 1}</span>
          <span class="brand-customer-top5-name">${esc(row.name)}</span>
          <span class="clients-tooltip-badge brand-customer-type-badge" style="border-color:${entityCompositionColors[row.type]}22;color:${entityCompositionColors[row.type]}">${esc(entityCompositionTypeLabel[row.type] || row.type)}</span>
          <strong>${entityCompositionMode === "count" ? `${apiNum(row.count)}건` : apiWon(row.sales)}</strong>
        </div>
        <i class="brand-customer-top5-bar"><b style="width:${barPct}%;background:${entityCompositionColors[row.type]}"></b></i>
      </li>`;
    }).join("");
  }

  const insight = $("#entityCompositionInsight");
  if (insight) {
    const top = [...ratios].sort((a, b) => b.ratioPct - a.ratioPct)[0];
    insight.innerHTML = `
      <div class="brand-customer-insight-ratio">
        <span>핵심 비율</span>
        <strong>${top.ratioPct.toFixed(0)}%</strong>
      </div>
      <div class="brand-customer-insight-text">
        <p class="brand-customer-insight-main">${esc(entityCompositionTypeLabel[top.type] || top.type)} 구매 비중이 가장 높습니다.</p>
        <p class="brand-customer-insight-sub">오프라인 구매 고객(ECOUNT) 기준 · 온라인 개인결제창 주문은 제품 정보가 없어 브랜드별 집계에서 제외됩니다.</p>
      </div>`;
  }
}

// STEP67-6: 브랜드는 선택됐지만 이 기간 해당 브랜드로 식별 가능한 고객 구매가 없는 경우
// (예: 이번 달 온라인에서만 팔렸거나 오프라인 판매가 전혀 없는 브랜드) 가짜 도넛 대신
// Empty State로 되돌린다 — renderEntityHeroState()의 브랜드 선택 여부 토글과는 별개로,
// "브랜드는 선택됐지만 이 데이터만 없음"을 구분해서 보여준다.
function renderEntityCompositionEmpty() {
  const empty = $("#entityCompositionEmpty");
  const content = $("#entityCompositionContent");
  // STEP67-9H-2: 비교 모드에서는 Brand A(Primary)에 이번 기간 데이터가 없어도 전체를
  // 숨기지 않는다 — #entityCompositionCompareBlock이 Brand A/B 각자의 상태를 이미
  // 독립적으로 정직하게 보여주므로(renderEntityCompareComposition, 이 함수보다 먼저
  // 호출됨), 여기서 content 전체를 hidden 처리하면 Brand B의 유효한 데이터까지 함께
  // 사라진다. 단일 브랜드 큰 도넛/TOP5/AI Insight는 비교 모드 CSS
  // (body.entity-compare-on #entityCompositionContent > .brand-customer-grid 등)로
  // 항상 숨겨지므로 content를 visible로 둬도 잘못 노출되지 않는다.
  if (entityCompareState.enabled) {
    if (empty) empty.hidden = true;
    if (content) content.hidden = false;
    return;
  }
  if (empty) empty.hidden = false;
  if (content) content.hidden = true;
}

// STEP67-6: Customer Composition. 새 Customer Pipeline이 아니라 server.mjs의
// buildBrandCustomerComposition()(Clients 화면이 이미 쓰는 classifyClientType/
// classifyClientEntity/isGiftSalesLine + STEP67-3의 Unified Identity를 그대로 재사용,
// intelligence-service.mjs 참고) 결과를 옮겨 그리기만 한다.
async function refreshEntityCustomerComposition(brandCode, month) {
  const seq = ++entityCompositionSeq;
  const compareKey = `${brandCode || ""}|${month || ""}`;
  entityCompareCompositionState.a = { key: compareKey, status: "pending", stats: {} };
  renderEntityCompareComposition();
  const data = await getEntityCompositionJson(`/api/brand-intelligence/${encodeURIComponent(brandCode)}/customer-composition?month=${encodeURIComponent(month)}`);
  if (seq !== entityCompositionSeq) return; // 더 최근 브랜드/기간 변경이 이미 진행 중이면 이 결과는 버린다.
  const compareDataset = entityCompositionDataset(data, compareKey);
  entityCompareCompositionState.a = compareDataset;
  renderEntityCompareComposition();
  // STEP67-6: 오프라인 판매 상품 수는 Customer Composition과 같은 응답을 재사용한다(새 API 없음).
  const skuOfflineEl = $("#entityHeroSkuOfflineValue");
  if (skuOfflineEl) skuOfflineEl.textContent = data?.error ? "-" : `${apiNum(data.offlineProductCount || 0)}개`;
  if (data?.error || !Array.isArray(data?.typeStats) || !data.typeStats.length) {
    entityCompositionTypeStats = {};
    entityCompositionRows = [];
    renderEntityCompositionEmpty();
    return;
  }
  entityCompositionTypeStats = compareDataset.stats;
  entityCompositionRows = data.topCustomers.map((row) => ({
    name: row.name,
    type: row.type,
    count: row.count,
    sales: row.sales,
    lastPurchase: row.lastPurchase || "-",
    rankChange: "-"
  }));
  const empty = $("#entityCompositionEmpty");
  const content = $("#entityCompositionContent");
  if (empty) empty.hidden = true;
  if (content) content.hidden = false;
  renderEntityCompositionSection();
}

// STEP56-1: Entity Trend(Monthly Trend Intelligence). STEP58-3에서 Entity Intelligence
// Framework 명명 규칙에 맞춰 brandMonthlyTrend* → entityTrend*로 리네임(UI/동작 동일).
// 좌표 계산은 기존 brandTrendDetailPanelHtml(js:2494)의 SVG polyline+circle 기법을 그대로
// 본떠 독립 구현했다.
// STEP61-2: Monthly Intelligence Data Connection. 당시 주석대로 entityTrendMonths를 API
// 응답으로 교체한다(좌표 계산/렌더/hover 등 나머지는 무변경) — refreshEntityTrendMonths()가
// 채운다. 브랜드 미선택/Master Data 미확인 시에는 빈 배열이며, renderEntityTrendSection()이
// 이 경우를 별도로 처리한다(Empty 배열에 대한 reduce 등 크래시 방지).
let entityTrendMonths = [];

// STEP67-10G-4: Partial-Period Consistency. entityTrendMonths 각 행의 archiveStatus
// (위 refreshEntityTrendMonths가 서버 응답에서 그대로 옮긴 필드)로 "이번 달이 아직
// 진행 중인가"를 판정하는 단일 지점. Hero KPI/AI Summary/Trend Summary가 전부 이
// 함수 하나를 공유해, 화면 안에서 서로 다른 "진행 중" 정의가 생기지 않게 한다.
function entityIsLiveMonthRow(row) {
  return !!row && row.archiveStatus === "live";
}

// STEP61-2: 기존 /api/reports/monthly(getSharedJson 캐시)와 STEP61-1의 brandIdentityState
// (brand_code)만 사용한다 — 새 API 없음. monthlyReportTrendMonths()는 Monthly Report가 이미
// "그 해 1월~선택월" 구간을 만드는 데 쓰는 함수이며, 같은 구간 정의를 그대로 재사용해 Monthly
// Report 화면과 Brand Dashboard가 같은 개월 수를 비교하게 한다. 브랜드 매출 금액은
// canonicalPaidAmount()(Monthly Report의 브랜드 매출 TOP5/브랜드 매출 시그널이 이미 쓰는
// 동일 함수)로 뽑아 두 화면의 숫자가 어긋나지 않게 한다.
let entityTrendRefreshSeq = 0;
let entityInventoryRefreshSeq = 0;
// STEP61-3: Hero/KPI Data Binding. entityPeriodState(year/month)를 "YYYY-MM" 문자열로 바꾸는
// 계산이 refreshEntityTrendMonths 안에 있던 것을 그대로 뽑아낸 것뿐이다(문자열 조합 방식은
// 무변경) — Hero KPI 바인딩도 정확히 같은 월을 가리켜야 하므로 두 곳에서 같은 계산을 각자
// 반복하지 않도록 이름 붙여 공유한다.
function currentEntityPeriodMonthKey() {
  return `${entityPeriodState.year}-${String(entityPeriodState.month).padStart(2, "0")}`;
}

async function refreshEntityTrendMonths() {
  const seq = ++entityTrendRefreshSeq;
  // BATCH A: 브랜드/기간이 바뀌는 시점(이 함수가 유일한 트리거)에 이전 브랜드/기간의
  // Customer Detail 데이터가 화면에 남지 않도록 열려 있는 Workspace/clientOrders Drawer를
  // 닫는다(Phase 10 stale-data 방지) — 아직 새 브랜드의 purchase 데이터가 없는 시점에
  // 이전 브랜드 내용을 그대로 보여주는 것보다 명시적으로 닫는 편이 안전하다.
  if (clientWorkspaceRow) closeClientWorkspace();
  if (entityDrawerState.open && entityDrawerState.type === "clientOrders") closeEntityDrawer();
  // BATCH B: SKU Drawer가 열려 있는 상태로 브랜드/기간이 바뀌면 이전 브랜드의 SKU 목록이
  // 그대로 보이지 않도록 닫는다(entitySkuRows는 rebuildEntitySkuRows가 곧 다시 채운다).
  if (entityDrawerState.open && entityDrawerState.type === "sku") closeEntityDrawer();
  if (!brandIdentityState.brandCode) {
    entityTrendMonths = [];
    entityTrendCompareMonths = [];
    // BI-BATCH-D: 브랜드 선택이 해제되면 AI Summary의 "현재 재고는 N개입니다" 문장이
    // 이전 브랜드 값을 들고 있지 않도록 함께 비운다.
    entityHeroInventoryState = { brandCode: null, ready: false, stock: null, fetchFailed: false };
    renderEntityTrendSection();
    renderEntityHeroKpiFromMonthlyState();
    renderEntityCompositionEmpty();
    entitySkuSalesState = { brandCode: null, periodMonth: null, rows: [], fetchFailed: false };
    rebuildEntitySkuRows();
    return;
  }
  const periodMonth = currentEntityPeriodMonthKey();
  const months = monthlyReportTrendMonths(periodMonth);
  const brandCode = brandIdentityState.brandCode;
  const compareBrandName = entityCompareState.enabled ? entityCompareBrandB() : "비교 브랜드 선택";
  const compareBrandCode = compareBrandName === "비교 브랜드 선택" ? null : resolveBrandIdentity(compareBrandName).brandCode;
  const archives = await Promise.all(months.map((month) => getSharedJson(`/api/reports/monthly?month=${month}`, 8000)));
  if (seq !== entityTrendRefreshSeq) return; // 더 최근 브랜드/기간 변경이 이미 진행 중이면 이 결과는 버린다.
  entityTrendMonths = months.map((month, index) => {
    const archive = archives[index];
    // BI-CORE-4: NULL != ZERO. getJson()의 timeout/네트워크 오류 폴백(error 필드만 있는
    // 객체)을 "그 달 매출이 실제로 0원"인 것과 구분한다 — fetchFailed=true인 달은 revenue/
    // quantitySold/orderCount/online/offline/aov를 0으로 합성하지 않고 null로 남겨(row가
    // 없을 때와 동일한 표현) Hero KPI/AI Summary/Trend Chart가 "-"/공백으로 처리하게 한다.
    // 재시도 로직은 이번 STEP 범위 밖(BI-CORE-3에서 실제 timeout이 재현되지 않아 보류).
    const fetchFailed = Boolean(archive?.error);
    if (fetchFailed) {
      console.warn(`[Brand Intelligence] monthly fetch failure — month=${month}, reason=${archive.error}`);
    }
    const brandSales = archive?.commerce?.brandSales || [];
    const row = brandSales.find((item) => monthlyReportBrandCode(item) === brandCode);
    const revenue = row ? canonicalPaidAmount(row) : null;
    const quantitySold = row ? Number(row.quantitySold || 0) : null;
    const orderCount = row ? Number(row.orderCount || 0) : null;
    // STEP67-4: Channel Sales Breakdown. row가 이미 갖고 있는 onlinePaidAmount/
    // offlineSalesAmount를 그대로 옮긴다(새 계산 없음, mergeOfflineBrandSales가
    // 이미 revenue = online + offline이 되도록 채워 넣은 값이다).
    const online = row ? Number(row.onlinePaidAmount || 0) : null;
    const offline = row ? Number(row.offlineSalesAmount || 0) : null;
    // STEP67-6: SKU(이번 기간 판매 상품 수). archive.commerce.productSales는 이미 이 fetch로
    // 받아온 데이터다(새 API 호출 없음) — 이 브랜드의 canonical brand_code와 일치하는 distinct
    // product_no 개수만 센다. "전체 등록 SKU"가 아니라 "이번 기간 판매 상품 수"임을 명확히
    // 구분한다(Report 9번 항목 참고, 전체 등록 SKU를 셀 수 있는 canonical source는 없음).
    const productSales = Array.isArray(archive?.commerce?.productSales) ? archive.commerce.productSales : [];
    const skuCount = new Set(
      productSales
        .filter((product) => String(product?.brand_code || "").trim() === brandCode)
        .map((product) => String(product?.productNo || product?.product_no || product?.productCode || ""))
        .filter(Boolean)
    ).size;
    // STEP67-10G-4: 서버가 이미 응답에 포함하는 archiveStatus(당월="live"/저장된 과거월=
    // "saved"/즉석 빌드된 과거월="draft", server.mjs:390/400/403, STEP67-10G-3이 이미
    // entityCompareTargetPeriodData에 같은 방식으로 옮긴 필드)를 그대로 옮긴다. 새 계산 없음
    // — Hero KPI/AI Summary/Trend Summary가 모두 이 필드 하나로 "진행 중" 여부를 판정한다.
    const archiveStatus = archive?.archiveStatus || null;
    return {
      key: month,
      label: `${Number(month.slice(5, 7))}월`,
      revenue,
      quantitySold,
      orderCount,
      online,
      offline,
      skuCount,
      aov: row ? (orderCount ? Math.round(revenue / orderCount) : 0) : null,
      memo: "",
      archiveStatus,
      fetchFailed
    };
  });
  // Brand A와 같은 archive/identity/금액 함수를 그대로 사용한다. 월별 행이 없으면 null로
  // 남겨 실제 0원으로 오해되지 않게 하고, 비교 OFF/미선택/미해결 상태에서는 비운다.
  entityTrendCompareMonths = compareBrandCode ? months.map((month, index) => {
    const row = (archives[index]?.commerce?.brandSales || [])
      .find((item) => monthlyReportBrandCode(item) === compareBrandCode);
    if (!row) return null;
    const revenue = canonicalPaidAmount(row);
    const orderCount = Number(row.orderCount || 0);
    return {
      key: month,
      label: `${Number(month.slice(5, 7))}월`,
      revenue,
      orderCount,
      aov: orderCount ? Math.round(revenue / orderCount) : 0
    };
  }) : [];
  renderEntityTrendSection();
  // STEP61-3: Hero/KPI Data Binding. Monthly State(entityTrendMonths)가 갱신될 때마다 Hero
  // KPI도 같은 시점에 다시 읽는다 — Brand/Period 변경은 이미 이 함수 하나로 모이므로(applyBrandIdentity/
  // bind()의 기간 핸들러 3곳) 별도 트리거를 새로 추가하지 않는다.
  renderEntityHeroKpiFromMonthlyState();
  // STEP67-6: Customer Composition도 같은 트리거(브랜드/기간 변경)에 묶는다 — 별도 호출부를
  // 새로 추가하지 않는다. Trend fetch와 별개 네트워크 호출이라 fire-and-forget으로 둔다.
  refreshEntityCustomerComposition(brandCode, periodMonth);
  refreshEntityCompareCustomerComposition(periodMonth);
  refreshEntityInventory(brandCode);
  // BATCH B: SKU Sales. archive.commerce.productSales는 이미 위 archives 배열에 들어있다
  // (새 fetch 없음) — 선택된 기간(periodMonth)의 archive 하나만 골라 브랜드로 필터링한다.
  const periodIndex = months.indexOf(periodMonth);
  const periodArchive = archives[periodIndex];
  const periodProductSales = Array.isArray(periodArchive?.commerce?.productSales) ? periodArchive.commerce.productSales : [];
  refreshEntitySkuSales(brandCode, periodMonth, periodProductSales, Boolean(periodArchive?.error));
  // BATCH A: Customer Purchase Detail. 브랜드와 무관하게 기간 단위로만 fetch하고(Phase 4),
  // 브랜드 필터링은 읽는 시점(entityClientPurchaseLinesFor)에 수행한다 — 여기서는 다른
  // 보조 fetch들과 동일하게 트리거만 공유한다(별도 트리거 추가 없음).
  refreshEntityClientsOverview(periodMonth);
  // STEP67-9E-1: Comparison Monthly Core KPI. 브랜드/기간이 바뀔 때도 이 트리거 하나로
  // Compare KPI가 함께 갱신되도록 여기서 호출한다(별도 트리거 추가 없음).
  refreshEntityCompareKpi();
}

// STEP67-9E-1: Comparison Monthly Core KPI. entityTrendMonths(브랜드 A, 이미 계산됨,
// 새 fetch 없음)와 동일한 월의 /api/reports/monthly 응답(getSharedJson 캐시 — 이미
// refreshEntityTrendMonths가 이 정확히 같은 월을 fetch했으므로 새 네트워크 요청 없이
// 캐시를 재사용한다)에서 Brand B의 row만 같은 방식으로 추출한다. 새 계산식/새 resolver
// 없음 — refreshEntityTrendMonths가 이미 쓰는 monthlyReportBrandCode()/canonicalPaidAmount()
// 그대로 재사용.
function entityCompareKpiRowFromArchive(archive, brandCode) {
  if (!brandCode) return null;
  const brandSales = archive?.commerce?.brandSales || [];
  const row = brandSales.find((item) => monthlyReportBrandCode(item) === brandCode);
  if (!row) return null;
  const revenue = canonicalPaidAmount(row);
  const quantitySold = Number(row.quantitySold || 0);
  const orderCount = Number(row.orderCount || 0);
  // STEP67-10G-3: Comparison Summary가 채널 비중을 쓰기 위해 row가 이미 갖고 있는
  // onlinePaidAmount/offlineSalesAmount를 그대로 옮긴다(entityTrendMonths가 Brand A에
  // 이미 하는 것과 동일한 필드, 새 계산/새 API 없음) — Brand A/B 둘 다 이 함수를 거치므로
  // 별도 분기 없이 양쪽에 자동으로 채워진다.
  const online = Number(row.onlinePaidAmount || 0);
  const offline = Number(row.offlineSalesAmount || 0);
  return { revenue, quantitySold, orderCount, aov: orderCount ? Math.round(revenue / orderCount) : 0, online, offline };
}

// STEP67-9E-2: Comparison Target Period Data. #entityCompareTarget는 실제 날짜 계산이
// 없는 정적 select였다("prev"/"yoy"/"custom", 과거의 고정 월 표시 문구도
// 하드코딩 텍스트일 뿐 계산값이 아님 — 코드 확인 결과, Architecture Review에 없던 사실).
// 새 독립 기간 시스템을 만들지 않고, 기존 entityPeriodState(현재 기간)를 기준으로 그
// select의 값만 실제 YYYY-MM으로 변환한다. "custom"은 실제 날짜 입력 UI가 없어 임의
// 값을 만들지 않고 null(미확정)로 둔다.
function entityComparePeriodKeyForMode(mode) {
  if (entityPeriodState.mode !== "monthly") return null;
  const year = entityPeriodState.year;
  const month = entityPeriodState.month;
  if (mode === "prev") {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  }
  if (mode === "yoy") return `${year - 1}-${String(month).padStart(2, "0")}`;
  return null;
}

function entityCompareTargetPeriodKey() {
  return entityComparePeriodKeyForMode($("#entityCompareTarget")?.value || "prev");
}

function entityCompareMonthKeyLabel(key) {
  if (!/^\d{4}-\d{2}$/.test(key || "")) return "비교 대상 미확정";
  return `${Number(key.slice(0, 4))}년 ${Number(key.slice(5, 7))}월`;
}

// STEP67 cross-brand-partial-period P2: 서버가 이미 계산한 cutoff 날짜 범위
// ({startDate,endDate}, docs/reports/STEP67-cross-brand-partial-period-p1.md §6)를
// "8/1~8/11" 형태로만 옮긴다 — 날짜 계산은 전혀 하지 않는다(문자열 절단뿐).
function entityCompareCutoffRangeLabel(range) {
  if (!range?.startDate || !range?.endDate) return "";
  const startMonth = Number(range.startDate.slice(5, 7));
  const startDay = Number(range.startDate.slice(8, 10));
  const endMonth = Number(range.endDate.slice(5, 7));
  const endDay = Number(range.endDate.slice(8, 10));
  return `${startMonth}/${startDay}~${endMonth}/${endDay}`;
}

let entityCompareTargetPeriodRefreshSeq = 0;
// STEP67-9E-2/3: A_current/A_target/B_current/B_target 4개 row를
// entityCompareKpiRowFromArchive()(STEP67-9E-1, 재사용)로 채우고 같은 state를 렌더한다.
// STEP67 cross-brand-partial-period P2: cutoff(동일 경과일 정규화 메타데이터, P1
// resolveCrossBrandPeriodCutoff() 그대로) 필드 추가 — 정규화가 적용되지 않았으면 null.
let entityCompareTargetPeriodData = {
  currentKey: null, targetKey: null, currentStatus: "idle", targetStatus: "idle",
  currentArchiveStatus: null, targetArchiveStatus: null, cutoff: null,
  aCurrent: null, aTarget: null, bCurrent: null, bTarget: null
};

const ENTITY_COMPARE_ARCHIVE_TIMEOUT_MS = 8000;
const ENTITY_COMPARE_ARCHIVE_RETRY_TIMEOUT_MS = 30000;

async function getEntityCompareMonthlyArchive(month) {
  const url = `/api/reports/monthly?month=${month}`;
  const first = await getSharedJson(url, ENTITY_COMPARE_ARCHIVE_TIMEOUT_MS);
  if (first?.error !== "응답 지연") return { archive: first, status: first?.error ? "error" : "success" };
  const retry = await getSharedJson(url, ENTITY_COMPARE_ARCHIVE_RETRY_TIMEOUT_MS);
  return {
    archive: retry,
    status: retry?.error === "응답 지연" ? "timeout" : retry?.error ? "error" : "success"
  };
}

// STEP67 cross-brand-partial-period P2: base가 진행 중인 현재 월일 때만 쓰는 단일
// endpoint 호출 — base/comparison 두 기간을 한 번의 응답으로 받는다(P1 §5). 기존
// getEntityCompareMonthlyArchive()와 완전히 동일한 8초 실패 시 30초 1회 재시도
// 구조를 재사용한다(STEP67-10G-1/Customer-Composition-retry-fix와 세 번째로 같은
// 패턴 — 새로 발명하지 않음).
async function getEntityCompareMonthlyArchiveCutoff(baseMonth, comparisonMonth) {
  const url = `/api/reports/monthly-comparison-cutoff?base=${baseMonth}&compare=${comparisonMonth}`;
  const first = await getSharedJson(url, ENTITY_COMPARE_ARCHIVE_TIMEOUT_MS);
  if (first?.error !== "응답 지연") return { payload: first, status: first?.error ? "error" : "success" };
  const retry = await getSharedJson(url, ENTITY_COMPARE_ARCHIVE_RETRY_TIMEOUT_MS);
  return {
    payload: retry,
    status: retry?.error === "응답 지연" ? "timeout" : retry?.error ? "error" : "success"
  };
}

// STEP67 cross-brand-partial-period P2: cutoff endpoint의 payload(P1 §6, 이미
// {revenue,quantitySold,orderCount,aov,onlineRevenue,offlineRevenue}로 투영된 행)에서
// 브랜드 하나를 뽑아 entityCompareKpiRowFromArchive()와 동일한 필드 이름(online/offline)
// 으로 맞춘다 — 이후 렌더러/Comparison Summary 엔진은 이 함수가 아니라 저 함수가
// 만든 row인지 전혀 구분할 필요가 없다(같은 shape, 새 계산 없음).
function entityCompareKpiRowFromCutoffPayload(payload, periodKey, brandCode) {
  if (!brandCode) return null;
  const brandSales = payload?.[periodKey]?.brandSales || [];
  const row = brandSales.find((item) => item.brand_code === brandCode);
  if (!row) return null;
  return {
    revenue: Number(row.revenue || 0),
    quantitySold: Number(row.quantitySold || 0),
    orderCount: Number(row.orderCount || 0),
    aov: Number(row.aov || 0),
    online: Number(row.onlineRevenue || 0),
    offline: Number(row.offlineRevenue || 0)
  };
}

async function refreshEntityCompareTargetPeriodData() {
  const seq = ++entityCompareTargetPeriodRefreshSeq;
  const targetPeriodEl = $("#entityCompareHeaderTargetPeriod");
  if (targetPeriodEl) targetPeriodEl.textContent = entityCompareTargetLabel();
  const currentKey = entityPeriodState.mode === "monthly" ? currentEntityPeriodMonthKey() : null;
  const targetKey = entityCompareTargetPeriodKey();
  const brandACode = brandIdentityState.brandCode || null;
  const brandBName = entityCompareBrandB();
  const brandBCode = brandBName !== "비교 브랜드 선택" ? resolveBrandIdentity(brandBName).brandCode : null;

  // STEP67 cross-brand-partial-period P2: currentKey가 실제 진행 중인(live) 월이면
  // target도 같은 경과일로 정규화한 새 endpoint 하나로 두 기간을 한 번에 받는다
  // (docs/reports/STEP67-cross-brand-partial-period-p1.md). entityTrendMonths는
  // STEP67-10G-4부터 이미 각 행에 archiveStatus를 들고 있으므로 새 fetch 없이
  // entityIsLiveMonthRow()로 판정한다 — 새 판정 로직을 또 만들지 않는다.
  const currentTrendRow = currentKey ? entityTrendMonths.find((row) => row.key === currentKey) : null;
  const useCutoff = Boolean(currentKey && targetKey && entityIsLiveMonthRow(currentTrendRow));

  if (useCutoff) {
    const cutoffResult = await getEntityCompareMonthlyArchiveCutoff(currentKey, targetKey);
    if (seq !== entityCompareTargetPeriodRefreshSeq) return;
    // 실패 시(timeout/error) payload가 없으므로 아래 네 row 전부 null이 된다 — 기존
    // "데이터 연결 대기/지연/실패" 표시가 그대로 나온다. 절대로 전체월 fetch로
    // 조용히 되돌아가지 않는다(요구사항: 잘못된 의미의 fallback 금지).
    const payload = cutoffResult.status === "success" ? cutoffResult.payload : null;
    entityCompareTargetPeriodData = {
      currentKey,
      targetKey,
      currentStatus: cutoffResult.status,
      targetStatus: cutoffResult.status,
      currentArchiveStatus: "live",
      targetArchiveStatus: payload ? "cutoff" : null,
      cutoff: payload ? payload.cutoff : null,
      aCurrent: payload ? entityCompareKpiRowFromCutoffPayload(payload, "base", brandACode) : null,
      aTarget: payload ? entityCompareKpiRowFromCutoffPayload(payload, "comparison", brandACode) : null,
      bCurrent: payload ? entityCompareKpiRowFromCutoffPayload(payload, "base", brandBCode) : null,
      bTarget: payload ? entityCompareKpiRowFromCutoffPayload(payload, "comparison", brandBCode) : null
    };
  } else {
    // 두 기간 모두 기존 getSharedJson 캐시를 그대로 쓴다 — currentKey는 refreshEntityTrendMonths/
    // refreshEntityCompareKpi가 이미 fetch한 것과 정확히 같은 URL이라 새 요청이 없고,
    // targetKey는 A/B 브랜드 조회에 archive를 한 번만 fetch해 공유한다(브랜드별로 두 번
    // fetch하지 않음).
    const [currentResult, targetResult] = await Promise.all([
      currentKey ? getEntityCompareMonthlyArchive(currentKey) : Promise.resolve({ archive: null, status: "idle" }),
      targetKey ? getEntityCompareMonthlyArchive(targetKey) : Promise.resolve({ archive: null, status: "idle" })
    ]);
    if (seq !== entityCompareTargetPeriodRefreshSeq) return;
    // archive 자체가 없거나 error면(월 범위 밖 등) row를 만들지 않는다 — 실제 0과 "그 달
    // 데이터를 아예 조회할 수 없음"을 구분한다(row가 있는데 값이 0인 경우는
    // entityCompareKpiRowFromArchive 내부에서 이미 정직한 0으로 처리됨, STEP67-9E-1과 동일).
    const usable = (archive) => (archive && !archive.error) ? archive : null;
    const cur = usable(currentResult.archive);
    const tgt = usable(targetResult.archive);
    entityCompareTargetPeriodData = {
      currentKey,
      targetKey,
      currentStatus: currentResult.status,
      targetStatus: targetResult.status,
      // STEP67-10G-3: Comparison Summary의 진행 중 기간(partial period) 가드에 필요한
      // 신호. 서버가 이미 응답에 포함하는 필드를 그대로 옮길 뿐이다(server.mjs:390/400/403
      // — 당월="live", 저장된 과거월="saved", 즉석 빌드된 과거월="draft"). 새 계산 없음.
      currentArchiveStatus: cur ? (cur.archiveStatus || null) : null,
      targetArchiveStatus: tgt ? (tgt.archiveStatus || null) : null,
      cutoff: null,
      aCurrent: cur ? entityCompareKpiRowFromArchive(cur, brandACode) : null,
      aTarget: tgt ? entityCompareKpiRowFromArchive(tgt, brandACode) : null,
      bCurrent: cur ? entityCompareKpiRowFromArchive(cur, brandBCode) : null,
      bTarget: tgt ? entityCompareKpiRowFromArchive(tgt, brandBCode) : null
    };
  }

  // STEP67 cross-brand-partial-period P2: cutoff가 실제 적용됐을 때만 기존 헤더
  // 배지 2개(현재 기간/비교 대상, 새 DOM 없음)에 "동일 경과일" 범위를 덧붙인다.
  // 완결 기간 비교(cutoffNormalized=false 또는 cutoff 자체가 없음)에서는 문구를
  // 전혀 바꾸지 않는다(오해 소지 있는 부분기간 언어를 새로 만들지 않음).
  const cutoff = entityCompareTargetPeriodData.cutoff;
  const headerCurrentEl = $("#entityCompareHeaderCurrentPeriod");
  const headerTargetEl = $("#entityCompareHeaderTargetPeriod");
  if (cutoff?.cutoffNormalized) {
    if (headerCurrentEl) headerCurrentEl.textContent = `${entityPeriodLabel()} · ${entityCompareCutoffRangeLabel(cutoff.base)}`;
    if (headerTargetEl) headerTargetEl.textContent = `${entityCompareMonthKeyLabel(entityCompareTargetPeriodData.targetKey)} · 동일 경과일 기준 ${entityCompareCutoffRangeLabel(cutoff.comparison)}`;
  } else if (headerTargetEl) {
    headerTargetEl.textContent = entityCompareTargetLabel();
  }

  renderEntityCompareTargetPeriodKpis();
  // STEP67-10G-3: KPI/채널/archiveStatus가 여기서 최종 확정되므로 Comparison Summary도
  // 같은 시점에 다시 그린다(고객 구성은 renderEntityCompareComposition() 쪽에서 별도로
  // 다시 그림 — 두 fetch가 서로 다른 타이밍에 끝나기 때문에 두 지점 모두에서 재렌더한다).
  renderEntityCompareSummary();
}

function entityCompareDeltaTone(delta) {
  return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
}

function entityCompareDeltaText(delta, formatMagnitude) {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${formatMagnitude(Math.abs(delta))}`;
}

// STEP67-9G-1: 기존 네 KPI 카드 안에서 행=canonical 브랜드, 열=current/target/delta인
// 최종 Period Performance 표를 렌더한다. 데이터와 계산은 기존 state만 재사용한다.
function renderEntityCompareKpiValue(tooltip, field, formatValue, formatDelta) {
  const block = document.querySelector(`[data-entity-compare-kpi="${tooltip}"]`);
  const body = block?.querySelector("tbody");
  if (!block || !body) return;
  const currentLabel = entityCompareMonthKeyLabel(entityCompareTargetPeriodData.currentKey);
  const targetLabel = entityCompareMonthKeyLabel(entityCompareTargetPeriodData.targetKey);
  block.querySelectorAll("[data-entity-compare-current-period]").forEach((el) => { el.textContent = currentLabel; });
  block.querySelectorAll("[data-entity-compare-target-period]").forEach((el) => { el.textContent = targetLabel; });
  const unavailableHtml = (status) => `<span class="brand-hero-delta flat">${status === "timeout" ? "Archive 생성 지연 · 다시 시도" : status === "error" ? "데이터 연결 실패" : "데이터 연결 대기"}</span>`;
  const valueHtml = (row, status) => row ? esc(formatValue(row[field])) : unavailableHtml(status);
  const deltaHtml = (current, target) => {
    if (!current || !target) return unavailableHtml(entityCompareTargetPeriodData.targetStatus !== "success" ? entityCompareTargetPeriodData.targetStatus : entityCompareTargetPeriodData.currentStatus);
    const delta = current[field] - target[field];
    return `<span class="brand-hero-delta ${entityCompareDeltaTone(delta)}">${esc(entityCompareDeltaText(delta, formatDelta))}</span>`;
  };
  const rowHtml = (name, current, target) => `<tr>
    <th scope="row" title="${esc(name)}">${esc(name)}</th>
    <td>${valueHtml(current, entityCompareTargetPeriodData.currentStatus)}</td>
    <td>${valueHtml(target, entityCompareTargetPeriodData.targetStatus)}</td>
    <td>${deltaHtml(current, target)}</td>
  </tr>`;
  const rows = [];
  const brandAName = entityCompareBrandA();
  const brandBName = entityCompareBrandB();
  if (brandAName !== "기준 브랜드 선택") rows.push(rowHtml(brandAName, entityCompareTargetPeriodData.aCurrent, entityCompareTargetPeriodData.aTarget));
  if (brandBName !== "비교 브랜드 선택") rows.push(rowHtml(brandBName, entityCompareTargetPeriodData.bCurrent, entityCompareTargetPeriodData.bTarget));
  else rows.push('<tr class="entity-compare-performance-empty"><td colspan="4">비교 브랜드를 선택하세요</td></tr>');
  body.innerHTML = rows.join("");
}

function renderEntityCompareTargetPeriodKpis() {
  renderEntityCompareKpiValue("sales", "revenue", apiWon, apiWon);
  renderEntityCompareKpiValue("qty", "quantitySold", (value) => `${apiNum(value)}개`, (value) => `${apiNum(value)}개`);
  renderEntityCompareKpiValue("orders", "orderCount", (value) => `${apiNum(value)}건`, (value) => `${apiNum(value)}건`);
  renderEntityCompareKpiValue("aov", "aov", apiWon, apiWon);
}

function refreshEntityCompareKpi() {
  return refreshEntityCompareTargetPeriodData();
}

// =============================================================================
// STEP67-10G-3: Comparison Summary Deterministic Rule Engine
// (work/reports/STEP67-10G-2-COMPARISON-SUMMARY-INTERPRETATION-ARCHITECTURE.md)
//
// buildComparisonSummaryFacts(input)는 순수 함수다 — 네트워크 호출, DOM 조회,
// Date.now() 의존이 전혀 없다. 같은 input은 항상 같은 결과를 반환한다. LLM/AI
// 없음, 새 지표 계산 없음(entityCompareTargetPeriodData/entityTrendMonths/
// entityCompareCompositionState가 이미 계산해 둔 값만 읽는다).
//
// 인과 표현 금지(STEP67-10G-3 지시사항의 STEP67-10G-2 §13 정정 반영): 현재 AOV
// 정의가 revenue/orderCount이지 revenue/quantitySold가 아니므로
// revenue = quantitySold × AOV는 이 시스템에서 성립하는 항등식이 아니다.
// "견인", "상쇄", "~로 인해", "~덕분에", "driven by", "because of" 등 인과적
// 표현은 예외 없이 전부 금지 — 신호가 충돌해도 나열형 관찰 문장만 만든다.
// =============================================================================

// text는 순수 관찰 문장만 만들고 실제 숫자는 넣지 않는다(§15 wording contract가
// 요구하는 "측정 가능한 차이 서술"에 이미 raw values가 fact.values로 별도 제공됨,
// STEP67-10G-2 §23) — 그래서 여기 서식(format) 함수는 두지 않는다(unused 방지).
const ENTITY_COMPARE_SUMMARY_METRICS = [
  { key: "revenue", label: "매출", topic: "매출은", subject: "매출이", floor: 100000 },
  { key: "quantitySold", label: "판매수량", topic: "판매수량은", subject: "판매수량이", floor: 2 },
  { key: "orderCount", label: "주문수", topic: "주문수는", subject: "주문수가", floor: 2 },
  { key: "aov", label: "객단가", topic: "객단가는", subject: "객단가가", floor: 10000 }
];
const ENTITY_COMPARE_SUMMARY_STABLE_PCT = 0.05;
const ENTITY_COMPARE_SUMMARY_STRONG_PCT = 0.20;
const ENTITY_COMPARE_SUMMARY_CROSS_BRAND_MATERIAL_PCT = 0.20;
const ENTITY_COMPARE_SUMMARY_CHANNEL_DOMINANT_SHARE = 0.70;
const ENTITY_COMPARE_SUMMARY_CHANNEL_MATERIAL_PP = 0.20;
const ENTITY_COMPARE_SUMMARY_CUSTOMER_DOMINANT_SHARE = 0.60;
const ENTITY_COMPARE_SUMMARY_CUSTOMER_MATERIAL_PP = 0.20;
const ENTITY_COMPARE_SUMMARY_MAX_FACTS = 3;

// 5단계 등급(§7): 절대값 바닥(floor) 미만이면 비율이 크더라도 STABLE로 강등한다
// (초저모수 소수점 왜곡 방지). target이 0/null/undefined면 비율 계산 자체를
// 하지 않는다(0으로 나누기 금지 — Infinity%를 만들지 않는다, §7/Phase E).
function entityCompareSummaryPctTier(current, target, floor) {
  if (target === null || target === undefined || target === 0) return null;
  if (current === null || current === undefined) return null;
  const diff = current - target;
  if (Math.abs(diff) < floor) return "STABLE";
  const pct = Math.abs(diff / target);
  if (pct < ENTITY_COMPARE_SUMMARY_STABLE_PCT) return "STABLE";
  if (pct < ENTITY_COMPARE_SUMMARY_STRONG_PCT) return diff > 0 ? "GROWTH" : "DECLINE";
  return diff > 0 ? "STRONG_GROWTH" : "STRONG_DECLINE";
}

// LOW_BASE(§7): 비교 대상 기간의 표본이 너무 적으면(주문 3건 미만 또는 매출
// 50만원 미만) 그 브랜드의 그 기간에 대한 퍼센트 기반 해석을 만들지 않는다.
// 브랜드별로 독립 판정한다(한쪽만 저모수여도 다른 쪽 fact는 살린다).
function entityCompareSummaryIsLowBase(row) {
  if (!row) return false;
  return row.orderCount < 3 || row.revenue < 500000;
}

function entityCompareSummaryDirectionBucket(tier) {
  if (tier === "GROWTH" || tier === "STRONG_GROWTH") return "UP";
  if (tier === "DECLINE" || tier === "STRONG_DECLINE") return "DOWN";
  if (tier === "STABLE") return "STABLE";
  return null;
}

function entityCompareSummaryPeriodChangeText(brandName, metric, tier) {
  const strong = tier === "STRONG_GROWTH" || tier === "STRONG_DECLINE";
  const dir = (tier === "GROWTH" || tier === "STRONG_GROWTH") ? "증가" : "감소";
  return `${brandName}의 ${metric.topic} 비교 대상 기간 대비 ${strong ? "큰 폭으로 " : ""}${dir}했습니다.`;
}

// §13/정정: 인과 표현 없이 세 지표(매출/판매수량/객단가)를 나열만 한다. 신호가
// 실제로 엇갈릴 때만 호출된다(전부 같은 방향이면 이 fact 자체를 만들지 않음).
function entityCompareSummaryConflictingClause(bucket, position) {
  const word = bucket === "UP" ? "증가" : bucket === "DOWN" ? "감소" : null;
  if (!word) {
    if (position === "end") return "큰 변화가 없었습니다";
    if (position === "contrast") return "큰 변화가 없었지만";
    return "큰 변화가 없었고";
  }
  if (position === "end") return `${word}했습니다`;
  if (position === "contrast") return `${word}했지만`;
  return `${word}했고`;
}

function entityCompareSummaryConflictingText(brandName, buckets) {
  return `${brandName}의 매출은 ${entityCompareSummaryConflictingClause(buckets.revenue, "contrast")} `
    + `판매수량은 ${entityCompareSummaryConflictingClause(buckets.quantitySold, "mid")} `
    + `객단가는 ${entityCompareSummaryConflictingClause(buckets.aov, "end")}`;
}

// CROSS_BRAND(§9): brand_code가 이미 canonical하게 resolve된 두 값만 비교한다.
// "우수/더 낫다" 같은 전체 우열 표현은 절대 만들지 않는다 — 측정된 지표 하나의
// 높낮이만 서술한다. brand 이름 뒤에는 "의"/"보다"만 써서(둘 다 받침 유무와
// 무관하게 항상 안전) 임의 브랜드명(영문/한글 혼용)에도 조사가 깨지지 않는다.
function entityCompareSummaryCrossBrandFact(metric, aValue, bValue, brandAName, brandBName) {
  if (aValue === null || aValue === undefined || bValue === null || bValue === undefined) return null;
  if (aValue === 0 && bValue === 0) return null;
  const base = Math.max(Math.abs(aValue), Math.abs(bValue));
  if (base === 0) return null;
  const diff = aValue - bValue;
  const pct = Math.abs(diff) / base;
  const materiality = pct >= ENTITY_COMPARE_SUMMARY_CROSS_BRAND_MATERIAL_PCT ? "MATERIAL" : "SIMILAR";
  let direction;
  let text;
  if (materiality === "SIMILAR") {
    direction = "SIMILAR";
    text = `${brandAName}의 ${metric.topic} ${brandBName}의 ${metric.topic.replace(/은$|는$/, "")}와 유사합니다.`;
  } else {
    direction = diff > 0 ? "A_HIGHER" : "B_HIGHER";
    text = direction === "A_HIGHER"
      ? `${brandAName}의 ${metric.subject} ${brandBName}보다 높습니다.`
      : `${brandBName}의 ${metric.subject} ${brandAName}보다 높습니다.`;
  }
  return {
    type: `${metric.key.toUpperCase()}_LEADER`,
    axis: "CROSS_BRAND",
    metric: metric.key,
    direction,
    materiality,
    values: { a: aValue, b: bValue },
    text
  };
}

function entityCompareSummaryChannelShare(row) {
  if (!row) return null;
  const total = Number(row.online || 0) + Number(row.offline || 0);
  if (total <= 0) return null;
  return Number(row.offline || 0) / total;
}

// CHANNEL_MIX(§10): 단일 브랜드 판정(오프라인/온라인 70% 이상)과 브랜드 간
// 구조 차이(20%p 이상)만 서술한다. "왜"에 대한 인과 설명은 절대 만들지 않는다.
function entityCompareSummaryChannelFact(aRow, bRow, brandAName, brandBName) {
  const aShare = entityCompareSummaryChannelShare(aRow);
  const bShare = entityCompareSummaryChannelShare(bRow);
  if (aShare === null || bShare === null) return null;
  const diffPp = Math.abs(aShare - bShare);
  if (diffPp < ENTITY_COMPARE_SUMMARY_CHANNEL_MATERIAL_PP) return null;
  const aHigherOffline = aShare > bShare;
  const text = aHigherOffline
    ? `${brandAName}의 오프라인 비중이 ${brandBName}의 오프라인 비중보다 높습니다.`
    : `${brandBName}의 오프라인 비중이 ${brandAName}의 오프라인 비중보다 높습니다.`;
  return {
    type: "CHANNEL_STRUCTURE_DIFF",
    axis: "CHANNEL_MIX",
    metric: "offlineShare",
    direction: aHigherOffline ? "A_HIGHER_OFFLINE" : "B_HIGHER_OFFLINE",
    materiality: "MATERIAL",
    values: { a: aShare, b: bShare },
    text
  };
}

// NEXT-CROSS-BRAND-FACT: 단일 브랜드 채널 dominance 분류(§10 원 설계,
// STEP67-10G-2). 두 브랜드의 구조 차이(위 CHANNEL_STRUCTURE_DIFF)가 임계값
// 미달이어도, 각 브랜드가 개별적으로는 70% 이상 한 채널에 쏠려 있을 수 있다
// (실측: CARNET ARCHIVE 89.2%/TROUBLED WATERS 100% 오프라인 — 차이 10.8%p는
// 미달이지만 둘 다 개별적으로 OFFLINE_DOMINANT). 인과 설명 없이 "비중이
// 높습니다"만 재사용한다. 브랜드명 옆에는 "의"만 써서 조사 안전성을 유지한다.
function entityCompareSummaryChannelDominance(share) {
  if (share === null) return null;
  if (share >= ENTITY_COMPARE_SUMMARY_CHANNEL_DOMINANT_SHARE) return "OFFLINE_DOMINANT";
  if (share <= 1 - ENTITY_COMPARE_SUMMARY_CHANNEL_DOMINANT_SHARE) return "ONLINE_DOMINANT";
  return "BALANCED_CHANNEL";
}

function entityCompareSummaryChannelDominantFact(aRow, bRow, brandAName, brandBName) {
  const aShare = entityCompareSummaryChannelShare(aRow);
  const bShare = entityCompareSummaryChannelShare(bRow);
  const aClass = entityCompareSummaryChannelDominance(aShare);
  const bClass = entityCompareSummaryChannelDominance(bShare);
  const labelOf = (cls) => (cls === "OFFLINE_DOMINANT" ? "오프라인" : "온라인");
  const aDominant = aClass && aClass !== "BALANCED_CHANNEL";
  const bDominant = bClass && bClass !== "BALANCED_CHANNEL";
  if (!aDominant && !bDominant) return null;
  let text;
  let direction;
  if (aDominant && bDominant && aClass === bClass) {
    text = `${brandAName}의 ${labelOf(aClass)} 비중이 높고, ${brandBName}의 ${labelOf(bClass)} 비중도 높습니다.`;
    direction = "SAME_DOMINANT";
  } else if (aDominant && bDominant) {
    text = `${brandAName}의 ${labelOf(aClass)} 비중이 높고, ${brandBName}의 ${labelOf(bClass)} 비중이 높습니다.`;
    direction = "DIFFERENT_DOMINANT";
  } else if (aDominant) {
    text = `${brandAName}의 ${labelOf(aClass)} 비중이 높습니다.`;
    direction = "A_ONLY";
  } else {
    text = `${brandBName}의 ${labelOf(bClass)} 비중이 높습니다.`;
    direction = "B_ONLY";
  }
  return {
    type: "CHANNEL_DOMINANT",
    axis: "CHANNEL_MIX",
    metric: "offlineShare",
    direction,
    materiality: "MATERIAL",
    values: { a: aShare, b: bShare, aClass, bClass },
    text
  };
}

// CUSTOMER_MIX(§11): entityCompositionTypeLabel(기존 canonical 라벨)만 쓴다.
// 새 고객 유형을 만들지 않는다. 건수(count) 기준 비중만 쓴다(entityCompositionMode
// 전역 상태에 의존하지 않는다 — 순수 함수 원칙 유지, count가 "고객 구성"의
// 자연스러운 단위이기도 하다).
function entityCompareSummaryCompositionRatios(stats) {
  const total = Object.values(stats || {}).reduce((sum, row) => sum + Number(row?.count || 0), 0);
  if (!total) return {};
  const ratios = {};
  for (const [type, row] of Object.entries(stats)) ratios[type] = Number(row?.count || 0) / total;
  return ratios;
}

function entityCompareSummaryCustomerMixFact(compositionA, compositionB, brandAName, brandBName) {
  if (!compositionA || compositionA.status !== "ready" || !compositionB || compositionB.status !== "ready") return null;
  const ratiosA = entityCompareSummaryCompositionRatios(compositionA.stats);
  const ratiosB = entityCompareSummaryCompositionRatios(compositionB.stats);
  const types = new Set([...Object.keys(ratiosA), ...Object.keys(ratiosB)]);
  let best = null;
  for (const type of types) {
    const a = ratiosA[type] || 0;
    const b = ratiosB[type] || 0;
    const diffPp = Math.abs(a - b);
    if (diffPp >= ENTITY_COMPARE_SUMMARY_CUSTOMER_MATERIAL_PP && (!best || diffPp > best.diffPp)) {
      best = { type, a, b, diffPp };
    }
  }
  if (!best) return null;
  const label = entityCompositionTypeLabel[best.type] || best.type;
  const aHigher = best.a > best.b;
  const text = aHigher
    ? `${brandAName}의 ${label} 비중이 ${brandBName}의 ${label} 비중보다 높습니다.`
    : `${brandBName}의 ${label} 비중이 ${brandAName}의 ${label} 비중보다 높습니다.`;
  return {
    type: "CUSTOMER_MIX_DIVERGENCE",
    axis: "CUSTOMER_MIX",
    metric: `customer_${best.type}`,
    direction: aHigher ? "A_HIGHER" : "B_HIGHER",
    materiality: "MATERIAL",
    values: { a: best.a, b: best.b },
    text
  };
}

// TREND(§12): 완결된(진행 중이 아닌) 연속 3개월만 본다. 중간에 null이 있으면
// 건너뛰어 잇지 않고(연속성을 억지로 만들지 않음) 그냥 판단하지 않는다.
// Brand A(기준 브랜드) 매출만 대상으로 한다(§21 아키텍처 범위와 동일).
function entityCompareSummaryTrendFact(trendA, currentArchiveStatus, brandAName) {
  if (!Array.isArray(trendA) || trendA.length < 3) return null;
  const series = currentArchiveStatus === "live" ? trendA.slice(0, -1) : trendA.slice();
  if (series.length < 3) return null;
  const lastThree = series.slice(-3);
  if (lastThree.some((row) => !row || row.revenue === null || row.revenue === undefined)) return null;
  const [m1, m2, m3] = lastThree;
  if (m1.revenue === 0 || m2.revenue === 0) return null; // 0 분모 방지, Infinity% 금지
  const change1 = (m2.revenue - m1.revenue) / Math.abs(m1.revenue);
  const change2 = (m3.revenue - m2.revenue) / Math.abs(m2.revenue);
  const isUp = (v) => v >= ENTITY_COMPARE_SUMMARY_STABLE_PCT;
  const isDown = (v) => v <= -ENTITY_COMPARE_SUMMARY_STABLE_PCT;
  const isFlat = (v) => !isUp(v) && !isDown(v);
  let direction;
  let label;
  if (isUp(change1) && isUp(change2)) { direction = "UP"; label = "상승"; }
  else if (isDown(change1) && isDown(change2)) { direction = "DOWN"; label = "하락"; }
  else if (isFlat(change1) && isFlat(change2)) { direction = "FLAT"; label = "횡보"; }
  else { direction = "MIXED"; label = "변동성 큰"; }
  return {
    type: "RECENT_TREND",
    axis: "TREND",
    metric: "revenue",
    direction,
    materiality: direction === "FLAT" ? "STABLE" : "MATERIAL",
    values: { months: lastThree.map((row) => ({ key: row.key, revenue: row.revenue })) },
    text: `${brandAName}의 최근 매출은 ${label} 흐름입니다.`
  };
}

// 순수 오케스트레이터. input은 이미 fetch/계산된 상태 객체를 그대로 흉내낸
// plain object다(네트워크/DOM 없음) — 그대로 테스트 fixture로 재사용 가능하다.
function buildComparisonSummaryFacts(input) {
  const {
    brandAName, brandBName,
    currentArchiveStatus,
    currentStatus, targetStatus,
    targetPeriodBasis,
    aCurrent, aTarget, bCurrent, bTarget,
    compositionA, compositionB,
    trendA
  } = input || {};

  if (!brandAName || !brandBName) return { status: "insufficient_data", facts: [], caveats: [] };

  const caveats = [];
  const isLive = currentArchiveStatus === "live";
  // STEP67 cross-brand-partial-period P2: 서버(P1)가 이미 base/comparison을 같은
  // 경과일로 정규화했을 때만 true — 이 값은 renderEntityCompareSummary()가
  // entityCompareTargetPeriodData.targetArchiveStatus === "cutoff"에서 그대로
  // 옮겨 담을 뿐이다. 이 함수는 날짜 계산을 전혀 하지 않는다(순수 함수 원칙 유지).
  const isCutoffNormalized = isLive && targetPeriodBasis === "cutoff";
  const candidates = []; // { priority, fact }

  // ---- PERIOD_CHANGE + CONFLICTING(§8/§13, Brand A만 — 기준 브랜드) ----
  if (isLive && !isCutoffNormalized) {
    caveats.push({ type: "PARTIAL_PERIOD", text: "이번 기간은 진행 중이라 완결된 기간과 직접 비교하지 않았습니다." });
  } else if (!aCurrent || !aTarget) {
    if (targetStatus === "timeout") caveats.push({ type: "MISSING_DATA", text: "비교 대상 기간 archive 생성이 지연되고 있습니다." });
    else if (targetStatus === "error" || currentStatus === "error") caveats.push({ type: "MISSING_DATA", text: "비교 기간 데이터 연결에 실패했습니다." });
    else if (!aTarget) caveats.push({ type: "MISSING_DATA", text: `${brandAName}의 비교 대상 기간 데이터가 없습니다.` });
  } else if (entityCompareSummaryIsLowBase(aTarget)) {
    caveats.push({ type: "LOW_BASE", text: `${brandAName}의 비교 대상 기간은 표본이 적어(주문 ${apiNum(aTarget.orderCount)}건) 비교 의미가 제한적입니다.` });
  } else {
    // STEP67 cross-brand-partial-period P2: cutoff 정규화가 실제로 적용됐을 때는
    // "완결된 기간과 비교하지 않았습니다"가 더 이상 사실이 아니다 — 두 기간이 같은
    // 경과일로 정규화돼 실제로 비교되기 때문이다(P1 §6). 이 caveat로 교체한다.
    if (isCutoffNormalized) {
      caveats.push({ type: "CUTOFF_NORMALIZED", text: "진행 중인 기간은 동일 경과일 기준으로 비교했습니다." });
    }
    const tiers = {};
    for (const metric of ENTITY_COMPARE_SUMMARY_METRICS) {
      tiers[metric.key] = entityCompareSummaryPctTier(aCurrent[metric.key], aTarget[metric.key], metric.floor);
    }
    const buckets = {
      revenue: entityCompareSummaryDirectionBucket(tiers.revenue),
      quantitySold: entityCompareSummaryDirectionBucket(tiers.quantitySold),
      aov: entityCompareSummaryDirectionBucket(tiers.aov)
    };
    const directional = [buckets.revenue, buckets.quantitySold, buckets.aov].filter((b) => b === "UP" || b === "DOWN");
    const conflicting = directional.length >= 2 && new Set(directional).size > 1;
    if (conflicting) {
      candidates.push({
        priority: 1,
        fact: {
          type: "CONFLICTING_PERIOD_SIGNAL",
          axis: "PERIOD_CHANGE",
          metric: "revenue_units_aov",
          direction: "MIXED",
          materiality: "MATERIAL",
          values: { current: aCurrent, target: aTarget },
          text: entityCompareSummaryConflictingText(brandAName, buckets)
        }
      });
    } else if (tiers.revenue && tiers.revenue !== "STABLE") {
      candidates.push({
        priority: 1,
        fact: {
          type: "REVENUE_PERIOD_CHANGE",
          axis: "PERIOD_CHANGE",
          metric: "revenue",
          direction: entityCompareSummaryDirectionBucket(tiers.revenue),
          materiality: tiers.revenue.startsWith("STRONG") ? "STRONG" : "MATERIAL",
          values: { current: aCurrent.revenue, target: aTarget.revenue },
          text: entityCompareSummaryPeriodChangeText(brandAName, ENTITY_COMPARE_SUMMARY_METRICS[0], tiers.revenue)
        }
      });
    }
  }

  // ---- CROSS_BRAND(§9, 현재 기간 — live 여부와 무관하게 동일 시점이라 허용) ----
  // entityCompareSummaryCrossBrandFact()는 4개 지표(매출/판매수량/주문수/객단가)
  // 전부에 재사용 가능한 범용 함수다(Phase F) — 우선순위(§14)가 "매출 cross-brand"만
  // 명시하므로 V1 후보 목록에는 매출만 넣는다(다른 지표는 함수 자체는 이미 준비됨).
  // STEP67 cross-brand-partial-period P2: 진행 중인 현재 기간에서는 CROSS_BRAND
  // 문장이 "동일 경과일 기준"임을 명시한다 — aCurrent/bCurrent는 항상 같은
  // 기간(둘 다 같은 만큼만 누적)에서 나오므로 이 비교 자체는 cutoff 정규화
  // 여부와 무관하게 이미 유효하다(§9 원 설계) — 문구만 명확히 한다. 다른
  // 어떤 계산도 하지 않는다(entityCompareSummaryCrossBrandFact 무수정 재사용).
  const withLivePrefix = (fact) => (fact && isLive) ? { ...fact, text: `동일 경과일 기준 ${fact.text}` } : fact;
  if (aCurrent && bCurrent) {
    const fact = withLivePrefix(entityCompareSummaryCrossBrandFact(ENTITY_COMPARE_SUMMARY_METRICS[0], aCurrent.revenue, bCurrent.revenue, brandAName, brandBName));
    if (fact && fact.materiality === "MATERIAL") candidates.push({ priority: 2, fact });
    // NEXT-CROSS-BRAND-FACT: 판매수량/주문수/AOV도 같은 CROSS_BRAND axis,
    // 같은 범용 함수로 확장한다 — 우선순위를 revenue(2)보다 낮게(5~7) 둬서,
    // 이미 3-fact 슬롯이 채워지는 기존 실측 케이스(예: STEP67-10G-3 §21의
    // CARNET ARCHIVE vs TROUBLED WATERS)의 출력을 그대로 보존한다(회귀 없음).
    const unitsFact = withLivePrefix(entityCompareSummaryCrossBrandFact(ENTITY_COMPARE_SUMMARY_METRICS[1], aCurrent.quantitySold, bCurrent.quantitySold, brandAName, brandBName));
    if (unitsFact && unitsFact.materiality === "MATERIAL") candidates.push({ priority: 5, fact: unitsFact });
    const ordersFact = withLivePrefix(entityCompareSummaryCrossBrandFact(ENTITY_COMPARE_SUMMARY_METRICS[2], aCurrent.orderCount, bCurrent.orderCount, brandAName, brandBName));
    if (ordersFact && ordersFact.materiality === "MATERIAL") candidates.push({ priority: 6, fact: ordersFact });
    const aovFact = withLivePrefix(entityCompareSummaryCrossBrandFact(ENTITY_COMPARE_SUMMARY_METRICS[3], aCurrent.aov, bCurrent.aov, brandAName, brandBName));
    if (aovFact && aovFact.materiality === "MATERIAL") candidates.push({ priority: 7, fact: aovFact });
  } else if (!bCurrent) {
    caveats.push({ type: "MISSING_DATA", text: `${brandBName}의 현재 기간 데이터가 없습니다.` });
  }

  // ---- CHANNEL_MIX / CUSTOMER_MIX(§10/§11, 구조적 차이 — channel 우선) ----
  const channelFact = entityCompareSummaryChannelFact(aCurrent, bCurrent, brandAName, brandBName);
  if (channelFact) candidates.push({ priority: 3, fact: channelFact });
  else {
    const customerFact = entityCompareSummaryCustomerMixFact(compositionA, compositionB, brandAName, brandBName);
    if (customerFact) candidates.push({ priority: 3, fact: customerFact });
    // NEXT-CROSS-BRAND-FACT: 구조 차이(CHANNEL_STRUCTURE_DIFF)가 임계값
    // 미달일 때만, 각 브랜드의 개별 채널 dominance를 가장 낮은 우선순위(8)
    // 보조 fact로 추가한다(중복 방지 — 구조 차이가 이미 material하면 그것이
    // 더 정보량이 크므로 그쪽만 노출).
    const channelDominantFact = entityCompareSummaryChannelDominantFact(aCurrent, bCurrent, brandAName, brandBName);
    if (channelDominantFact) candidates.push({ priority: 8, fact: channelDominantFact });
  }

  // ---- TREND(§12) ----
  const trendFact = entityCompareSummaryTrendFact(trendA, currentArchiveStatus, brandAName);
  if (trendFact && trendFact.direction !== "FLAT") candidates.push({ priority: 4, fact: trendFact });

  // ---- 우선순위 절단(§14): 최대 3개, 빈 슬롯을 억지로 채우지 않는다 ----
  candidates.sort((a, b) => a.priority - b.priority);
  const facts = candidates.slice(0, ENTITY_COMPARE_SUMMARY_MAX_FACTS).map((c) => c.fact);

  return {
    status: facts.length || caveats.length ? "ready" : "insufficient_data",
    facts,
    caveats
  };
}

// DOM/state 연결부(비순수) — 실제 브라우저 state를 순수 함수 input 모양으로
// 옮겨 담기만 한다. 계산은 전혀 하지 않는다(위 buildComparisonSummaryFacts만
// 계산을 수행).
function renderEntityCompareSummary() {
  const textEl = $("#entityCompareSummaryText");
  if (!textEl) return;
  if (!entityCompareState.enabled) return;
  const brandAName = entityCompareBrandA();
  const brandBName = entityCompareBrandB();
  if (brandAName === "기준 브랜드 선택" || brandBName === "비교 브랜드 선택") {
    textEl.textContent = "비교 브랜드를 선택하면 비교 요약을 확인할 수 있습니다.";
    return;
  }
  const result = buildComparisonSummaryFacts({
    brandAName,
    brandBName,
    currentArchiveStatus: entityCompareTargetPeriodData.currentArchiveStatus,
    currentStatus: entityCompareTargetPeriodData.currentStatus,
    targetStatus: entityCompareTargetPeriodData.targetStatus,
    // STEP67 cross-brand-partial-period P2: targetArchiveStatus==="cutoff"는 P1
    // endpoint가 base/comparison을 이미 같은 경과일로 정규화했다는 뜻이다(§6) —
    // 이 값을 그대로 옮길 뿐, 엔진은 날짜 계산을 하지 않는다.
    targetPeriodBasis: entityCompareTargetPeriodData.targetArchiveStatus === "cutoff" ? "cutoff" : "full_month",
    aCurrent: entityCompareTargetPeriodData.aCurrent,
    aTarget: entityCompareTargetPeriodData.aTarget,
    bCurrent: entityCompareTargetPeriodData.bCurrent,
    bTarget: entityCompareTargetPeriodData.bTarget,
    compositionA: entityCompareCompositionState.a,
    compositionB: entityCompareCompositionState.b,
    trendA: entityTrendMonths
  });
  if (result.status === "insufficient_data" || (!result.facts.length && !result.caveats.length)) {
    textEl.textContent = "비교 가능한 데이터가 아직 없습니다.";
    return;
  }
  const sentences = [...result.facts.map((f) => f.text), ...result.caveats.map((c) => c.text)];
  textEl.textContent = sentences.join(" ");
}

// BI-BATCH-D: AI Summary(renderEntityHeroInsight)가 "현재 재고는 N개입니다" 문장을
// 붙이려면 refreshEntityInventory()가 이미 resolve한 knownStock을 알아야 한다 — 새 fetch를
// 만들지 않고 이 값만 별도 state에 남긴다. ready:false(조회 중)와 ready:true+stock:null
// (조회 완료, 그러나 canonical 재고 없음)을 구분해야 "아직 모름"과 "확인된 재고 없음"이
// 섞이지 않는다(NULL != ZERO와 동일한 원칙). Inventory는 Trend/AI Summary와 별개 비동기
// fetch라 늦게 도착할 수 있으므로, 값이 준비되면 renderEntityHeroKpiFromMonthlyState()를
// 다시 호출해 이미 그려진 AI Summary에도 반영한다(BATCH A/B의 refreshOpen* 재렌더 패턴과
// 동일 — 새 렌더 경로를 만들지 않고 기존 idempotent 렌더 함수를 재사용).
let entityHeroInventoryState = { brandCode: null, ready: false, stock: null, fetchFailed: false };

async function refreshEntityInventory(brandCode) {
  const seq = ++entityInventoryRefreshSeq;
  const valueEl = $("#entityHeroInventoryValue");
  const noteEl = $("#entityHeroInventoryNote");
  entityHeroInventoryState = { brandCode, ready: false, stock: null, fetchFailed: false };
  if (!valueEl || !noteEl) return;
  valueEl.textContent = "불러오는 중";
  noteEl.textContent = "ECOUNT 현재 재고 조회 중";
  const data = await getJson(intelligenceUrl("/api/inventory/overview?limit=1"), 15000);
  if (seq !== entityInventoryRefreshSeq) return;
  const rows = Array.isArray(data?.brandRollup) ? data.brandRollup : [];
  const exact = rows.find((item) => item.brandCanonical === true && item.brandKey === brandCode);
  const rawMatches = rows.filter((item) => {
    if (item.brandCanonical === true) return false;
    const rawName = item.brandName || String(item.brandKey || "").replace(/^raw:/, "");
    return resolveRawBrandCanonical(rawName) === brandIdentityState.name;
  });
  const row = exact || (rawMatches.length === 1 ? rawMatches[0] : null);
  if (data?.error || data?.available === false || !row) {
    valueEl.textContent = "데이터 없음";
    noteEl.textContent = "canonical brand_code로 확인된 ECOUNT 재고 없음";
    // BATCH B: brandKey를 못 찾았으면 SKU Stock도 알 수 없다 — 이전 브랜드 items가
    // 남아있지 않도록 명시적으로 비운다(0 재고로 오해되지 않게 null 유지, Phase 9).
    entityInventoryItemsState = { brandCode, brandKey: null, items: [], fetchFailed: Boolean(data?.error), ready: true };
    rebuildEntitySkuRows();
    entityHeroInventoryState = { brandCode, ready: true, stock: null, fetchFailed: Boolean(data?.error) };
    renderEntityHeroKpiFromMonthlyState();
    return;
  }
  valueEl.textContent = `${apiNum(row.knownStock || 0)}개`;
  noteEl.textContent = `현재 재고 · ECOUNT · ${exact ? "canonical brand_code" : "exact canonical name"} · SKU ${apiNum(row.totalSku || 0)}개 · 확인 필요 ${apiNum(row.negativeReviewCount || 0)}개`;
  entityHeroInventoryState = { brandCode, ready: true, stock: Number(row.knownStock || 0), fetchFailed: false };
  renderEntityHeroKpiFromMonthlyState();
  // BATCH B: 이 브랜드의 SKU별 재고 items를 받아온다. row.brandKey는 위에서 이미 정확히
  // resolve된 ECOUNT 키(canonical brand_code 또는 "raw:..." 형태)이므로 같은 brandKey에
  // 대해 rollup fetch와 별개로 딱 한 번만 더 요청한다(동일 brand 중복 요청 금지, Phase 10).
  const itemsData = await getJson(intelligenceUrl(`/api/inventory/overview?brand=${encodeURIComponent(row.brandKey)}&limit=5000`), 15000);
  if (seq !== entityInventoryRefreshSeq) return;
  entityInventoryItemsState = {
    brandCode,
    brandKey: row.brandKey,
    items: Array.isArray(itemsData?.items) ? itemsData.items : [],
    fetchFailed: Boolean(itemsData?.error),
    ready: true
  };
  rebuildEntitySkuRows();
}

// STEP61-3: Hero/KPI Data Binding. 새 계산 없이 entityTrendMonths(STEP61-2가 만든 Monthly
// State)에서 현재 선택된 기간(currentEntityPeriodMonthKey)에 해당하는 한 행만 읽어 그대로
// 표시한다. 매출 MoM만 기존 entityTrendMoMPct()를 재사용해 함께 보여주고(이미 있는 계산),
// 판매수량/객단가/주문수는 대응하는 MoM 계산 함수가 없으므로 새로 만들지 않고 값만 표시한다.
function renderEntityHeroKpiFromMonthlyState() {
  const salesEl = $("#entityHeroKpiSales");
  const salesMomEl = $("#entityHeroKpiSalesMom");
  const qtyEl = $("#entityHeroKpiQty");
  const aovEl = $("#entityHeroKpiAov");
  const ordersEl = $("#entityHeroKpiOrders");
  if (!salesEl || !qtyEl || !aovEl || !ordersEl) return;
  const index = entityTrendMonths.findIndex((row) => row.key === currentEntityPeriodMonthKey());
  const row = index >= 0 ? entityTrendMonths[index] : null;
  if (!row) {
    salesEl.textContent = "-";
    qtyEl.textContent = "-";
    aovEl.textContent = "-";
    ordersEl.textContent = "-";
    if (salesMomEl) { salesMomEl.textContent = ""; salesMomEl.className = "brand-hero-delta flat"; }
    renderEntityHeroChannelSplit(null);
    return;
  }
  // BI-CORE-4: apiWon()은 null을 이미 "-"로 처리하지만(hasApiValue), apiNum()의 "개"/"건"
  // 접미사는 호출부에서 문자열로 이어붙이므로 null일 때 "-개"/"-건"이 되는 것을 막아야 한다.
  salesEl.textContent = apiWon(row.revenue);
  qtyEl.textContent = row.quantitySold == null ? "-" : `${apiNum(row.quantitySold)}개`;
  aovEl.textContent = apiWon(row.aov);
  ordersEl.textContent = row.orderCount == null ? "-" : `${apiNum(row.orderCount)}건`;
  if (salesMomEl) {
    // STEP67-10G-4: 진행 중인(archiveStatus="live") 이번 달은 완결된 지난달과
    // 직접 % 비교하지 않는다(Comparison Summary의 PARTIAL_PERIOD 가드와 동일한
    // 원칙 — entityIsLiveMonthRow 하나로 판정 공유). "▼59% MoM" 같은 왜곡된
    // 표시 대신 기존 flat 톤을 재사용해 "진행 중"만 표시한다(새 시각 언어 없음).
    if (entityIsLiveMonthRow(row)) {
      salesMomEl.textContent = "진행 중";
      salesMomEl.className = "brand-hero-delta flat";
    } else {
    const momPct = entityTrendMoMPct(index);
    if (momPct === null) {
      salesMomEl.textContent = "";
      salesMomEl.className = "brand-hero-delta flat";
    } else {
      const tone = momPct > 0 ? "up" : momPct < 0 ? "down" : "flat";
      const arrow = momPct > 0 ? "▲" : momPct < 0 ? "▼" : "—";
      salesMomEl.textContent = `${arrow} ${Math.abs(momPct).toFixed(0)}% MoM`;
      salesMomEl.className = `brand-hero-delta ${tone}`;
    }
    }
  }
  renderEntityHeroChannelSplit(row);
  renderEntityHeroSku(row, index);
  renderEntityHeroInsight(row, index);
}

// STEP67-6: SKU(이번 기간 판매 상품 수) + 실제 MoM. entityTrendMonths가 이미 각 월의
// skuCount를 갖고 있으므로(위 refreshEntityTrendMonths 참고) entityTrendMoMPct와 동일한
// 방식으로 전월 대비 증감을 계산한다 — 새 API 호출 없음.
function renderEntityHeroSku(row, index) {
  const valueEl = $("#entityHeroSkuValue");
  const momEl = $("#entityHeroSkuMom");
  const offlineEl = $("#entityHeroSkuOfflineValue");
  if (!valueEl) return;
  if (!row) {
    valueEl.textContent = "-";
    if (momEl) { momEl.textContent = ""; momEl.className = "brand-hero-delta flat"; }
    if (offlineEl) offlineEl.textContent = "-";
    return;
  }
  valueEl.textContent = `${apiNum(row.skuCount)}개`;
  if (momEl) {
    // STEP67-10G-4: Sales MoM과 같은 위젯 계열(같은 Hero 카드, 같은 archiveStatus
    // 신호) — 진행 중인 달을 완결된 지난달과 % MoM으로 비교하지 않는다.
    if (entityIsLiveMonthRow(row)) {
      momEl.textContent = "진행 중";
      momEl.className = "brand-hero-delta flat";
    } else {
    const prev = index > 0 ? entityTrendMonths[index - 1].skuCount : null;
    if (!index || prev === null || prev === undefined) {
      momEl.textContent = "";
      momEl.className = "brand-hero-delta flat";
    } else {
      const delta = row.skuCount - prev;
      const tone = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
      const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "—";
      momEl.textContent = delta === 0 ? "변동 없음" : `${arrow} ${Math.abs(delta)}개 MoM`;
      momEl.className = `brand-hero-delta ${tone}`;
    }
    }
  }
}

// STEP67-6: AI Insight & Recommended Action. 새 LLM 시스템이 아니라, 이미 연결된
// 데이터(매출/MoM/Channel Mix/Trend)만으로 증명 가능한 문장을 조합한다 — 원인 추론
// ("인기가 떨어지고 있다" 류) 없음. Recommended Action은 이 프로젝트에 매출 급감/온라인
// 비중 관련 기존 threshold가 전혀 없어(재고 관련 threshold만 존재, Inventory는 SOURCE NOT
// AVAILABLE) 새 threshold를 만드는 대신 정직하게 "추천 기준 미확정"을 표시한다.
function renderEntityHeroInsight(row, index) {
  const summaryEl = $("#entityHeroAiSummary");
  const noteEl = $("#entityHeroAiSummaryNote");
  const actionListEl = $("#entityHeroActionList");
  if (!summaryEl) return;
  if (!row) {
    summaryEl.textContent = "-";
    if (noteEl) noteEl.textContent = "";
    if (actionListEl) actionListEl.innerHTML = "";
    return;
  }
  // BI-CORE-4: NULL != ZERO. fetch 실패(row.revenue 등이 null)로 이번 달을 완결 월과
  // 비교해 "전월 대비 100% 감소" 같은 허위 문장을 만들지 않는다 — 기존 데이터 부족
  // 문구를 그대로 재사용한다(새 문구를 만들지 않음).
  if (row.fetchFailed) {
    summaryEl.textContent = "이번 기간 판단 가능한 데이터가 부족합니다.";
    if (noteEl) noteEl.textContent = "";
    if (actionListEl) actionListEl.innerHTML = "";
    return;
  }
  const sentences = [];
  const isLive = entityIsLiveMonthRow(row);
  // STEP67-10G-4: 진행 중인 달은 완결된 지난달과의 MoM % 문장을 만들지 않는다(Comparison
  // Summary의 PARTIAL_PERIOD 규칙과 동일). 대신 "현재까지 누적 매출" 같은, 완결 여부와
  // 무관하게 참인 스냅샷 문장만 남긴다 — 억지 대체 문장을 새로 만들지 않는다.
  if (isLive) {
    sentences.push(`${row.label} 현재 누적 매출은 ${apiWon(row.revenue)}입니다.`);
  } else {
    const momPct = entityTrendMoMPct(index);
    if (momPct !== null) {
      const dir = momPct > 0 ? "증가" : momPct < 0 ? "감소" : "변동 없이 유지";
      sentences.push(`${row.label} 매출은 전월 대비 ${Math.abs(momPct).toFixed(0)}% ${dir}했습니다.`);
    }
  }
  const channelTotal = Number(row.online || 0) + Number(row.offline || 0);
  if (channelTotal > 0) {
    const offlinePct = (Number(row.offline || 0) / channelTotal) * 100;
    const dominant = offlinePct >= 50 ? "오프라인" : "온라인";
    const dominantPct = offlinePct >= 50 ? offlinePct : 100 - offlinePct;
    sentences.push(`매출의 ${dominantPct.toFixed(1)}%가 ${dominant}에서 발생했습니다.`);
  }
  // STEP67-10G-4: 진행 중인 달 자신을 완결된 달들과 최저/최고로 순위 매기지 않는다 —
  // 완결 월만 모은 배열로 판정한다(진행 중인 달이면 이 문장 자체를 만들지 않음, Rule 6).
  if (!isLive) {
    // BI-CORE-4: fetch 실패 달(revenue null)이 섞이면 Math.min/max가 null을 0으로
    // 취급해 최저/최고 판정을 왜곡한다 — 완결 + 실제 값이 있는 달만 남긴다.
    const completedRevenues = entityTrendMonths.filter((item) => !entityIsLiveMonthRow(item) && item.revenue !== null).map((item) => item.revenue);
    if (completedRevenues.length > 1 && row.revenue === Math.min(...completedRevenues)) {
      sentences.push(`최근 ${completedRevenues.length}개월 중 이번 달 매출이 가장 낮습니다.`);
    } else if (completedRevenues.length > 1 && row.revenue === Math.max(...completedRevenues)) {
      sentences.push(`최근 ${completedRevenues.length}개월 중 이번 달 매출이 가장 높습니다.`);
    }
  }
  // BI-BATCH-D: skuCount는 entityTrendMonths가 이 함수 호출 전에 이미 계산해 둔 값이다
  // (STEP67-6, archive.commerce.productSales에서 distinct product_no만 센 것, 새 계산
  // 없음) — row가 fetchFailed가 아니면 항상 실수(0 포함)이므로 그대로 문장화한다.
  sentences.push(`이번 기간 온라인 판매가 확인된 상품은 ${apiNum(row.skuCount)}개입니다.`);
  // BI-BATCH-D: 현재 재고는 refreshEntityInventory()가 이미 resolve해 둔 값만 쓴다(새
  // fetch 없음). ready가 아니거나(아직 조회 중) stock이 null이면(canonical 재고 확인 불가)
  // 문장 자체를 만들지 않는다 — "재고 0개"로 오해되게 하지 않는다(NULL != ZERO).
  // brandCode가 다르면(막 브랜드를 바꿔 이전 브랜드 값이 남아있는 상태) 역시 생략한다.
  if (entityHeroInventoryState.brandCode === brandIdentityState.brandCode && entityHeroInventoryState.ready && entityHeroInventoryState.stock !== null) {
    sentences.push(`현재 재고는 ${apiNum(entityHeroInventoryState.stock)}개입니다.`);
  }
  summaryEl.textContent = sentences.length ? sentences.join(" ") : "이번 기간 판단 가능한 데이터가 부족합니다.";
  if (noteEl) noteEl.textContent = "매출/Channel Mix/Monthly Trend 실데이터 기반";
  if (actionListEl) {
    actionListEl.innerHTML = `<li>공식 추천 규칙 미확정 — 현재 재고는 참고 정보이며 Sell-through 산식과 Action threshold가 확정되기 전에는 행동을 자동 추천하지 않습니다.</li>`;
  }
}

// STEP67-4: Channel Sales Breakdown. entityTrendMonths 행의 online/offline(둘 다
// /api/reports/monthly의 브랜드 행에서 이미 계산된 값을 그대로 옮긴 것, 새 계산 없음)로
// 총매출 카드 안의 채널 구성(금액+비중+conic-gradient 도넛)을 채운다. 도넛은 이 프로젝트가
// 이미 쓰는 단일 div conic-gradient 기법(.clients-donut/.brand-hero-score-ring과 동일
// 패턴)만 재사용하고 새 차트 라이브러리는 쓰지 않는다.
// STEP67-5: Final UX — Section 2 Channel Mix. 도넛 대신 가로 100% composition bar로
// 바꿨다(같은 online/offline 값, 새 계산 없음). bar-fill의 width%만 online 비중으로
// 채운다.
function renderEntityHeroChannelSplit(row) {
  const block = $("#entityHeroChannelSplit");
  const bar = $("#entityHeroChannelOnlineBar");
  const onlineAmountEl = $("#entityHeroChannelOnlineAmount");
  const onlineShareEl = $("#entityHeroChannelOnlineShare");
  const offlineAmountEl = $("#entityHeroChannelOfflineAmount");
  const offlineShareEl = $("#entityHeroChannelOfflineShare");
  if (!block || !bar || !onlineAmountEl || !onlineShareEl || !offlineAmountEl || !offlineShareEl) return;
  const online = Number(row?.online || 0);
  const offline = Number(row?.offline || 0);
  const total = online + offline;
  if (!row || total <= 0) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  const onlinePct = (online / total) * 100;
  const offlinePct = 100 - onlinePct;
  onlineAmountEl.textContent = apiWon(online);
  offlineAmountEl.textContent = apiWon(offline);
  onlineShareEl.textContent = `${onlinePct.toFixed(1)}%`;
  offlineShareEl.textContent = `${offlinePct.toFixed(1)}%`;
  bar.style.width = `${onlinePct}%`;
}

function entityTrendMoMPct(index) {
  if (index <= 0) return null;
  const prev = entityTrendMonths[index - 1].revenue;
  const current = entityTrendMonths[index].revenue;
  // BI-CORE-4: NULL != ZERO. prev/current 어느 쪽이든 null(fetch 실패 또는 브랜드 행 없음)이면
  // null을 0으로 착각해 허위 -100%/+100% 같은 MoM%를 만들지 않는다.
  if (!prev || current === null) return null;
  return ((current - prev) / prev) * 100;
}

let entityTrendCompareMonths = [];

function entityTrendCompactWon(value) {
  const millions = value / 1000000;
  return `${millions >= 100 ? Math.round(millions) : millions.toFixed(1)}M`;
}

function entityTrendPointTooltipHtml(index) {
  const row = entityTrendMonths[index];
  const momPct = entityTrendMoMPct(index);
  const momText = momPct === null ? "-" : `${momPct > 0 ? "+" : momPct < 0 ? "" : "±"}${momPct.toFixed(0)}%`;
  let html = `<strong>${esc(row.label)}</strong> ${entityTrendCompactWon(row.revenue)} <span style="color:${momPct === null ? "inherit" : momPct >= 0 ? "#8ed8b2" : "#ff9d9d"}">${esc(momText)}</span><br>AOV ${Math.round(row.aov / 1000)}k`;
  if (row.memo) html += `<br>Memo: ${esc(row.memo)}`;
  if (entityCompareState.enabled) {
    const compareRow = entityTrendCompareMonths[index];
    html += compareRow
      ? `<br><br><strong>${esc(entityCompareBrandB())}</strong> ${entityTrendCompactWon(compareRow.revenue)}<br>AOV ${Math.round(compareRow.aov / 1000)}k`
      : `<br><br><strong>${esc(entityCompareBrandB())}</strong> · 해당 월 데이터 없음`;
  }
  return html;
}

function entityTrendChartSvg() {
  const width = 560;
  const height = 170;
  // BI-CORE-4: NULL != ZERO. fetch 실패 달(row.revenue === null)은 축 범위(min/max)
  // 계산에서 제외한다 — 안 그러면 null이 0으로 취급돼 축이 왜곡된다.
  const values = [
    ...entityTrendMonths.filter((row) => row.revenue !== null).map((row) => row.revenue),
    ...entityTrendCompareMonths.filter(Boolean).map((row) => row.revenue)
  ];
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const step = entityTrendMonths.length > 1 ? width / (entityTrendMonths.length - 1) : width;
  const coordinates = entityTrendMonths.map((row, index) => {
    const x = entityTrendMonths.length > 1 ? index * step : width / 2;
    // BI-CORE-4: fetch 실패 달은 y를 null로 남긴다 — 0원 지점으로 그려 넣으면(NULL을 ZERO로
    // 오인하는 것과 동일한 문제) 그 달이 실제로 매출 0인 것처럼 보인다. 아래에서 좌표 없는
    // 지점은 선을 끊고(비교선의 기존 segment 분리 패턴과 동일) 점도 찍지 않는다.
    if (row.revenue === null) return { ...row, x, y: null, index };
    // 최소~최댓값 구간을 차트 높이에 꽉 채워 월별 굴곡이 잘 보이게 한다(에디토리얼 느낌).
    const y = height - ((row.revenue - min) / span) * (height - 28) - 14;
    return { ...row, x, y, index };
  });
  const pathSegments = [];
  let pathSegment = [];
  coordinates.forEach((point) => {
    if (point.y !== null) pathSegment.push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    else if (pathSegment.length) {
      pathSegments.push(pathSegment.join(" "));
      pathSegment = [];
    }
  });
  if (pathSegment.length) pathSegments.push(pathSegment.join(" "));
  // STEP59-3: Compare Mode UI. 기존 min/max/span/step을 그대로 재사용해 두 번째(비교)
  // 선의 좌표만 추가 계산한다(축 재계산 없음 — 원래 선의 좌표/모양은 완전히 그대로).
  const compareCoordinates = entityTrendCompareMonths.map((row, index) => {
    if (!row) return null;
    const x = entityTrendMonths.length > 1 ? index * step : width / 2;
    const y = height - ((row.revenue - min) / span) * (height - 28) - 14;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const comparePaths = [];
  let compareSegment = [];
  compareCoordinates.forEach((point) => {
    if (point) compareSegment.push(point);
    else if (compareSegment.length) {
      comparePaths.push(compareSegment.join(" "));
      compareSegment = [];
    }
  });
  if (compareSegment.length) comparePaths.push(compareSegment.join(" "));
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="최근 7개월 매출 추세" class="brand-monthly-trend-svg">
    <line x1="0" y1="${height - 14}" x2="${width}" y2="${height - 14}" class="brand-monthly-trend-baseline"></line>
    ${comparePaths.map((points) => `<polyline points="${esc(points)}" fill="none" class="entity-trend-compare-polyline entity-compare-only"></polyline>`).join("")}
    ${pathSegments.map((points) => `<polyline points="${esc(points)}" fill="none" class="brand-monthly-trend-line"></polyline>`).join("")}
    ${coordinates.filter((point) => point.y !== null).map((point) => `<circle data-entity-trend-point="${point.index}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" class="brand-monthly-trend-point" tabindex="0"></circle>`).join("")}
    ${coordinates.map((point) => `<text x="${point.x.toFixed(1)}" y="${height - 1}" class="brand-monthly-trend-axis-label">${esc(point.label)}</text>`).join("")}
  </svg>`;
}

function entityTrendIndicatorHtml(label, direction) {
  const tone = direction > 0 ? "up" : direction < 0 ? "down" : "flat";
  const arrow = direction > 0 ? "▲" : direction < 0 ? "▼" : "—";
  return `<span class="brand-monthly-trend-indicator ${tone}"><i></i>${esc(label)} ${arrow}</span>`;
}

function renderEntityTrendSection() {
  const chart = $("#entityTrendChart");
  if (!chart) return;
  // STEP61-2: 브랜드 미선택/Master Data 미확인 시 entityTrendMonths가 빈 배열이다 —
  // renderEntityHeroState()가 이 경우 #entityTrendContent 자체를 숨기지만, 숨김은 CSS일
  // 뿐 이 함수는 여전히 호출될 수 있으므로 reduce(초깃값 없음)/인덱스 접근이 빈 배열에서
  // 터지지 않도록 여기서 먼저 처리한다.
  const rangeLabel = $("#entityTrendRangeLabel");
  if (!entityTrendMonths.length) {
    chart.innerHTML = "";
    if (rangeLabel) rangeLabel.textContent = "-";
    // 이전 브랜드/기간의 값이 화면에 그대로 남아있으면 다른 브랜드의 숫자처럼 보일 수
    // 있다(실측으로 발견) — Trend Summary 쪽도 함께 비워 낸다.
    const recentLabelEl = $("#entityTrendRecentLabel");
    if (recentLabelEl) { recentLabelEl.textContent = "-"; recentLabelEl.className = ""; }
    if ($("#entityTrendAvgAov")) $("#entityTrendAvgAov").textContent = "-";
    if ($("#entityTrendMax")) $("#entityTrendMax").innerHTML = "-";
    if ($("#entityTrendMin")) $("#entityTrendMin").innerHTML = "-";
    if ($("#entityTrendState")) $("#entityTrendState").textContent = "-";
    if ($("#entityTrendIndicators")) $("#entityTrendIndicators").innerHTML = "";
    if ($("#entityTrendInsight")) $("#entityTrendInsight").textContent = "";
    return;
  }
  if (rangeLabel) rangeLabel.textContent = `${entityTrendMonths[0].key} ~ ${entityTrendMonths[entityTrendMonths.length - 1].key}`;
  // STEP67-10G-4: 차트는 진행 중인 달을 그대로 시각적으로 포함한다(Rule 5, 팩트 정보라
  // 유용함) — 여기 통계(Max/Min/평균 AOV/최근 추세)만 완결 월 기준으로 분리한다.
  chart.innerHTML = entityTrendChartSvg();
  requestAnimationFrame(() => chart.querySelector(".brand-monthly-trend-svg")?.classList.add("is-visible"));

  // STEP67-10G-4: Max/Min/평균 AOV/최근 3개월 추세/Revenue·Units·AOV 인디케이터는 전부
  // "완결된 기간" 통계다 — 진행 중인 달(archiveStatus="live")이 최저/최고로 뽑히거나
  // 추세 방향 계산에 섞이면 §12(STEP67-10G-2)와 같은 왜곡이 재현된다. entityTrendMonths는
  // (있다면) 진행 중인 달이 항상 마지막 한 개뿐이므로 필터링해도 나머지 달의 순서/인접
  // 관계는 그대로 유지된다.
  // BI-CORE-4: NULL != ZERO. fetch 실패 달(revenue null)도 완결 월 통계(Max/Min/평균 AOV/
  // 인디케이터)에서 제외한다 — 안 그러면 null이 산술에서 0으로 취급돼 최저/최고/평균이
  // 왜곡된다(entityTrendMoMPct와 동일한 원칙).
  const completedMonths = entityTrendMonths.filter((row) => !entityIsLiveMonthRow(row) && !row.fetchFailed);
  const insight = $("#entityTrendInsight");
  if (!completedMonths.length) {
    // 완결된 달이 하나도 없음(신규 브랜드의 첫 달이 마침 진행 중인 경우 등) — 억지로
    // 판단하지 않는다(Comparison Summary의 "데이터가 부족해 판단하지 않습니다"와 같은 원칙).
    const recentLabelEl = $("#entityTrendRecentLabel");
    if (recentLabelEl) { recentLabelEl.textContent = "판단 보류"; recentLabelEl.className = ""; }
    if ($("#entityTrendAvgAov")) $("#entityTrendAvgAov").textContent = "-";
    if ($("#entityTrendMax")) $("#entityTrendMax").innerHTML = "-";
    if ($("#entityTrendMin")) $("#entityTrendMin").innerHTML = "-";
    if ($("#entityTrendState")) $("#entityTrendState").textContent = "진행 중";
    if ($("#entityTrendIndicators")) $("#entityTrendIndicators").innerHTML = "";
    if (insight) insight.textContent = "완결된 월 데이터가 부족해 최근 추세를 판단하지 않습니다.";
    return;
  }

  const maxRow = completedMonths.reduce((best, row) => (row.revenue > best.revenue ? row : best));
  const minRow = completedMonths.reduce((worst, row) => (row.revenue < worst.revenue ? row : worst));
  const avgAov = Math.round(completedMonths.reduce((sum, row) => sum + row.aov, 0) / completedMonths.length);
  const completedMoMPct = (index) => {
    if (index <= 0) return null;
    const prev = completedMonths[index - 1].revenue;
    if (!prev) return null;
    return ((completedMonths[index].revenue - prev) / prev) * 100;
  };
  const last3 = completedMonths.slice(-3);
  const last3AvgMoM = last3
    .map((_, offset) => completedMoMPct(completedMonths.length - last3.length + offset))
    .filter((value) => value !== null)
    .reduce((sum, value, _, arr) => sum + value / arr.length, 0);
  const trendState = last3AvgMoM > 3 ? { label: "▲ 성장", tone: "up" } : last3AvgMoM < -3 ? { label: "▼ 하락", tone: "down" } : { label: "Stable", tone: "flat" };

  $("#entityTrendRecentLabel").textContent = trendState.label;
  $("#entityTrendRecentLabel").className = `brand-monthly-trend-tone-${trendState.tone}`;
  $("#entityTrendAvgAov").textContent = apiWon(avgAov);
  $("#entityTrendMax").innerHTML = `${apiWon(maxRow.revenue)} <small>${esc(maxRow.key)}</small>`;
  $("#entityTrendMin").innerHTML = `${apiWon(minRow.revenue)} <small>${esc(minRow.key)}</small>`;
  $("#entityTrendState").textContent = trendState.label === "Stable" ? "Stable" : trendState.label;

  // STEP61-2: monthlyReportTrendMonths()가 반환하는 개월 수는 선택 기간에 따라 1~12개로
  // 달라진다(1월 선택 시 1개월치뿐). 직전 달이 없는 경우(lastIndex가 0) 증감 계산을 건너뛴다.
  const lastCompletedIndex = completedMonths.length - 1;
  const hasPrevCompletedMonth = lastCompletedIndex > 0;
  const revenueDir = hasPrevCompletedMonth ? Math.sign(completedMoMPct(lastCompletedIndex) || 0) : 0;
  const unitsDir = hasPrevCompletedMonth ? Math.sign(completedMonths[lastCompletedIndex].quantitySold - completedMonths[lastCompletedIndex - 1].quantitySold) : 0;
  const aovDir = hasPrevCompletedMonth ? Math.sign(completedMonths[lastCompletedIndex].aov - completedMonths[lastCompletedIndex - 1].aov) : 0;
  $("#entityTrendIndicators").innerHTML = [
    entityTrendIndicatorHtml("Revenue", revenueDir),
    entityTrendIndicatorHtml("Units", unitsDir),
    entityTrendIndicatorHtml("AOV", aovDir)
  ].join("");

  if (insight) {
    const lastRow = entityTrendMonths[entityTrendMonths.length - 1];
    // STEP67-10G-4: 마지막 달이 진행 중이면(archiveStatus="live") "회복 시도/상승세"처럼
    // 그 달의 흐름을 서술하는 절을 만들지 않는다(Phase H) — 완결 월 기준 최고점 문장만
    // 남긴다. 마지막 달이 완결 상태면 기존 문장을 그대로 유지한다(회귀 없음).
    insight.textContent = entityIsLiveMonthRow(lastRow)
      ? `최근 3개월은 ${trendState.tone === "up" ? "안정적인 성장세" : trendState.tone === "down" ? "조정 국면" : "안정적인 흐름"}입니다. ${maxRow.label}이 최고점입니다.`
      : `최근 3개월은 ${trendState.tone === "up" ? "안정적인 성장세" : trendState.tone === "down" ? "조정 국면" : "안정적인 흐름"}입니다. ${maxRow.label}이 최고점이며 ${lastRow.label}도 ${revenueDir >= 0 ? "상승세" : "회복 시도"}를 유지하고 있습니다.`;
  }
}

// STEP57-4C: Entity Category(Category Intelligence). STEP58-3에서 Entity Intelligence
// Framework 명명 규칙에 맞춰 brandCategory* → entityCategory*로 리네임(UI/동작 동일).
// STEP57-4B-A 진단에서 확정된 ECOUNT 카테고리
// 코드(BG=Bag/OT=Outer/ST=Top/BT=Bottom/AC=Accessory)만 사용한다 — 실제 상품분류 API는
// 연결하지 않고, Hero KPI 카드의 매출(34,466,777원)/판매수량(592개)/재고(1,204개) 합계와
// 정확히 일치하도록 카테고리별로 분해한 placeholder 값이다(실데이터 연결 시 이 배열만
// API 응답으로 교체). 대표 SKU는 실제 상품명을 지어내지 않고 "대표 SKU" 고정 텍스트만 쓴다.
const entityCategoryRows = [];
const entityCategoryColors = { BG: "#171717", OT: "#6d6a62", ST: "#c76a35", BT: "#4fb082", AC: "#8d6ecf" };
let entityCategoryMode = "revenue";

// STEP59-4: Compare Mode UX Refinement. entityTrendCompareMonths와 동일한 패턴 —
// entityCategoryRows와 같은 code 폭에 맞춘 순수 하드코딩 Placeholder 매출(계산/API
// 연결 없음). 카테고리별 기준/비교 값을 코드별로 매칭하기 위한 용도로만 쓴다.
const entityCategoryCompareRevenue = {};

function entityCategoryStockStatus(stock) {
  if (stock < 150) return { label: "Critical", color: "#a9423d" };
  if (stock < 200) return { label: "Low", color: "#d7a642" };
  if (stock < 260) return { label: "Healthy", color: "#206f54" };
  return { label: "Watch", color: "#d7a642" };
}

function entityCategoryRevenueSharePct(code) {
  const total = entityCategoryRows.reduce((sum, row) => sum + row.revenue, 0);
  const row = entityCategoryRows.find((r) => r.code === code);
  return total && row ? (row.revenue / total) * 100 : 0;
}

function entityCategoryShares() {
  const key = entityCategoryMode === "revenue" ? "revenue" : "quantitySold";
  const total = entityCategoryRows.reduce((sum, row) => sum + row[key], 0);
  const maxValue = Math.max(1, ...entityCategoryRows.map((row) => row[key]));
  return entityCategoryRows.map((row) => ({
    ...row,
    sharePct: total ? (row[key] / total) * 100 : 0,
    barPct: (row[key] / maxValue) * 100
  }));
}

function entityCategoryGradient() {
  let cursor = 0;
  return entityCategoryShares().map((row) => {
    const start = cursor;
    cursor += row.sharePct;
    return `${entityCategoryColors[row.code]} ${start}% ${cursor}%`;
  }).join(", ");
}

function entityCategoryProfileHtml(row) {
  if (!row) return `
    <div class="brand-customer-profile-head">
      <div class="brand-customer-profile-heading"><strong>상품군 상세</strong><span class="clients-tooltip-badge brand-customer-type-badge">연결 대기</span></div>
    </div>
    <div class="entity-detail-empty"><p>공식 상품군 매핑이 연결되면 상세 지표를 표시합니다.</p></div>`;
  const aov = row.quantitySold ? Math.round(row.revenue / row.quantitySold) : 0;
  const stockStatus = entityCategoryStockStatus(row.stock);
  const revenueSharePct = entityCategoryRevenueSharePct(row.code);
  const momTone = row.mom > 0 ? "up" : row.mom < 0 ? "down" : "flat";
  const momArrow = row.mom > 0 ? "▲" : row.mom < 0 ? "▼" : "—";
  return `
    <div class="brand-customer-profile-head">
      <div class="brand-customer-profile-heading">
        <strong>${esc(row.name)}</strong>
        <span class="clients-tooltip-badge brand-customer-type-badge">${esc(row.code)}</span>
      </div>
    </div>
    <div class="brand-customer-profile-rows">
      <div class="brand-customer-profile-row"><span>매출</span><strong>${apiWon(row.revenue)}</strong></div>
      <div class="brand-customer-profile-row"><span>매출 비중</span><strong>${revenueSharePct.toFixed(0)}%</strong></div>
      <div class="brand-customer-profile-row"><span>판매수량</span><strong>${apiNum(row.quantitySold)}개</strong></div>
      <div class="brand-customer-profile-row"><span>객단가</span><strong>${apiWon(aov)}</strong></div>
      <div class="brand-customer-profile-row"><span>대표 SKU</span><strong>대표 SKU</strong></div>
    </div>
    <div class="brand-customer-profile-rows">
      <div class="brand-customer-profile-row"><span>재고 상태</span><strong style="color:${stockStatus.color}">${esc(stockStatus.label)}</strong></div>
      <div class="brand-customer-profile-row"><span>전월</span><strong class="brand-hero-delta ${momTone}">${momArrow} ${Math.abs(row.mom)}%</strong></div>
    </div>
    <div class="brand-customer-profile-rows brand-mix-profile-ai-summary">
      <p><span>AI Summary</span> ${esc(stockStatus.label)} 재고로 ${momTone === "up" ? "안정적인 성장세" : momTone === "down" ? "주의가 필요한 흐름" : "보합 흐름"}입니다. (Placeholder)</p>
    </div>
  `;
}

let entityCategoryProfileShowTimer = null;
let entityCategoryProfileHideTimer = null;

function cancelEntityCategoryProfileHide() {
  clearTimeout(entityCategoryProfileHideTimer);
  entityCategoryProfileHideTimer = null;
}

function scheduleEntityCategoryProfileHide() {
  clearTimeout(entityCategoryProfileShowTimer);
  cancelEntityCategoryProfileHide();
  entityCategoryProfileHideTimer = setTimeout(() => {
    const card = $("#entityCategoryProfileCard");
    if (!card) return;
    card.classList.remove("is-visible");
    card.hidden = true;
  }, 120);
}

function entityCategoryProfileNode() {
  let card = $("#entityCategoryProfileCard");
  if (!card) {
    card = document.createElement("div");
    card.id = "entityCategoryProfileCard";
    card.className = "brand-customer-profile-card";
    card.hidden = true;
    card.addEventListener("mouseenter", cancelEntityCategoryProfileHide);
    card.addEventListener("mouseleave", scheduleEntityCategoryProfileHide);
    document.body.appendChild(card);
  }
  return card;
}

function positionEntityCategoryProfileCard(anchor, card) {
  const margin = 16;
  const gap = 14;
  const rect = anchor.getBoundingClientRect();
  const width = card.offsetWidth || 345;
  const height = card.offsetHeight || 300;
  const fitsRight = rect.right + gap + width + margin <= window.innerWidth;
  let left = fitsRight ? rect.right + gap : rect.left - gap - width;
  left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin));
  let top = rect.top - (height - rect.height) / 2;
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function showEntityCategoryProfileCard(anchor, row) {
  clearTimeout(entityCategoryProfileShowTimer);
  entityCategoryProfileShowTimer = setTimeout(() => {
    cancelEntityCategoryProfileHide();
    const card = entityCategoryProfileNode();
    card.innerHTML = entityCategoryProfileHtml(row);
    card.hidden = false;
    card.style.left = "0px";
    card.style.top = "0px";
    positionEntityCategoryProfileCard(anchor, card);
    requestAnimationFrame(() => card.classList.add("is-visible"));
  }, 180);
}

function hideEntityCategoryProfileCardSoon() {
  scheduleEntityCategoryProfileHide();
}

function renderEntityCategorySection() {
  const donut = $("#entityCategoryDonut");
  if (!donut) return;
  if (!entityCategoryRows.length) {
    $("#entityCategoryEmpty")?.toggleAttribute("hidden", false);
    $("#entityCategoryContent")?.toggleAttribute("hidden", false);
    $("#entityCategoryToggle")?.toggleAttribute("hidden", false);
    donut.style.background = "none";
    if ($("#entityCategoryDonutCenter")) $("#entityCategoryDonutCenter").textContent = "--";
    if ($("#entityCategoryList")) $("#entityCategoryList").innerHTML = `
      <li data-category-unavailable tabindex="0">
        <div class="brand-mix-row-head">
          <span class="brand-mix-name">상품군 상세</span>
          <strong>데이터 연결 대기</strong>
        </div>
      </li>`;
    if ($("#entityCategoryCompareTopA")) $("#entityCategoryCompareTopA").textContent = "데이터 연결 대기";
    if ($("#entityCategoryCompareTopB")) $("#entityCategoryCompareTopB").textContent = "데이터 연결 대기";
    if ($("#entityCategoryInsight")) $("#entityCategoryInsight").innerHTML = `<p class="brand-customer-insight-main">공식 상품군 매핑 연결 대기</p><p class="brand-customer-insight-sub">UI와 상세 탐색 구조는 유지됩니다.</p>`;
    return;
  }
  donut.style.background = `conic-gradient(${entityCategoryGradient()})`;

  const centerLabel = $("#entityCategoryDonutCenter");
  if (centerLabel) {
    centerLabel.textContent = entityCategoryMode === "revenue"
      ? apiWon(entityCategoryRows.reduce((sum, row) => sum + row.revenue, 0))
      : `${apiNum(entityCategoryRows.reduce((sum, row) => sum + row.quantitySold, 0))}개`;
  }

  const shares = entityCategoryShares();
  const list = $("#entityCategoryList");
  if (list) {
    list.innerHTML = shares.map((row) => {
      const momTone = row.mom > 0 ? "up" : row.mom < 0 ? "down" : "flat";
      const momArrow = row.mom > 0 ? "▲" : row.mom < 0 ? "▼" : "—";
      // STEP59-4: Compare Mode UX Refinement. entityCategoryCompareRevenue(하드코딩
      // Placeholder)를 code로 매칭해 기준/비교/차이를 한 줄에 함께 보여준다 — 기존
      // TOP5 행 구조·클릭 단서(brand-mix-row-head)는 그대로 유지하고 아래에 한 줄만
      // 추가한다.
      const compareRevenue = entityCategoryCompareRevenue[row.code] || 0;
      const revenueDiff = row.revenue - compareRevenue;
      const diffTone = revenueDiff > 0 ? "up" : revenueDiff < 0 ? "down" : "flat";
      const diffArrow = revenueDiff > 0 ? "▲" : revenueDiff < 0 ? "▼" : "—";
      return `
      <li data-category-code="${esc(row.code)}" tabindex="0">
        <div class="brand-mix-row-head">
          <span class="brand-mix-name">${esc(row.name)}</span>
          <span class="brand-mix-pct">${row.sharePct.toFixed(0)}%</span>
          <strong>${entityCategoryMode === "revenue" ? apiWon(row.revenue) : `${apiNum(row.quantitySold)}개`}</strong>
          <span class="entity-compare-chip entity-compare-only brand-hero-delta ${momTone}">${momArrow} ${Math.abs(row.mom)}%</span>
        </div>
        <i class="brand-mix-bar"><b style="width:${Math.max(4, row.barPct)}%;background:${entityCategoryColors[row.code]}"></b></i>
        <div class="entity-compare-category-row entity-compare-only">
          <span class="entity-compare-mini-tag a">기준 ${apiWon(row.revenue)}</span>
          <span class="entity-compare-mini-tag b">비교 ${apiWon(compareRevenue)}</span>
          <span class="entity-compare-mini-tag diff ${diffTone}">차이 ${diffArrow} ${apiWon(Math.abs(revenueDiff))}</span>
        </div>
      </li>`;
    }).join("");
  }

  // STEP59-4: Compare Mode UX Refinement. entityCategoryRows(기준)/entityCategoryCompareRevenue
  // (비교, 하드코딩 Placeholder)에서 각각 1위만 뽑아 보여준다 — 실제 데이터 연결/새 계산
  // 로직 없이 이미 있는 두 배열을 정렬해서 읽는 것뿐이다.
  const topA = [...entityCategoryRows].sort((a, b) => b.revenue - a.revenue)[0];
  const topBCode = Object.keys(entityCategoryCompareRevenue).sort((a, b) => entityCategoryCompareRevenue[b] - entityCategoryCompareRevenue[a])[0];
  const topBRow = entityCategoryRows.find((row) => row.code === topBCode);
  const topAEl = $("#entityCategoryCompareTopA");
  if (topAEl && topA) topAEl.textContent = `${topA.name} ${apiWon(topA.revenue)}`;
  const topBEl = $("#entityCategoryCompareTopB");
  if (topBEl && topBRow) topBEl.textContent = `${topBRow.name} ${apiWon(entityCategoryCompareRevenue[topBCode])}`;

  const insight = $("#entityCategoryInsight");
  if (insight) {
    const topRevenue = [...entityCategoryRows].sort((a, b) => b.revenue - a.revenue)[0];
    const topRevenueSharePct = entityCategoryRevenueSharePct(topRevenue.code);
    const worstMom = [...entityCategoryRows].sort((a, b) => a.mom - b.mom)[0];
    insight.innerHTML = `
      <p class="brand-customer-insight-main">${esc(topRevenue.name)} 비중이 브랜드 매출의 ${topRevenueSharePct.toFixed(0)}%입니다.</p>
      <p class="brand-customer-insight-sub">${esc(worstMom.name)}은 전월대비 ${worstMom.mom < 0 ? "감소" : "증가"}했습니다. (Placeholder)</p>`;
  }
}

// STEP59-1: Entity Full List Drawer. Customer/Category TOP5의 "전체 보기" 공용 Drawer —
// 새 상태 변수를 최소화해 단일 객체(entityDrawerState)만 쓰고, Customer/Category 전용
// open/close/render 함수를 따로 만들지 않는다(entityDrawerConfig로 타입별 차이만 분리).
// 기존 clientsDetailModal(고객 상세 모달)과 동일한 fixed 오버레이/backdrop/포커스 트랩/
// body 스크롤 잠금 패턴을 그대로 재사용하되, 위치만 중앙이 아니라 오른쪽 슬라이드로 바꿨다.
// Drawer 내부에서는 기존 Quick Profile Card(hover)를 띄우지 않고 행 자체의 hover 강조만
// 쓴다(요구사항 — Drawer 밖 hover 로직은 전혀 수정하지 않았으니 충돌하지 않는다). 실제
// Client/Category Intelligence 상세 화면은 만들지 않고 기존 toast() 안내만 표시한다
// (data-entity-type/data-entity-id 속성만 부여). Category 전체 목록은 STEP57-4B-A에서
// 확정된 코드만 추가로 사용(entityCategoryRows 자체는 수정하지 않고 별도 배열로 확장 —
// 기존 TOP5/Hero KPI 합계와 연동된 placeholder 숫자를 건드리지 않는다).
const entityCategoryDrawerRows = [];

let entityDrawerState = { type: null, open: false, query: "", sort: "" };
// STEP60-1: Entity Navigation Foundation. Drawer가 "한 번 열리고 끝나는" 목록이 아니라
// Brand→Category→SKU→Order→Client로 계속 이동할 수 있도록 방문 경로만 배열로 쌓는다.
// entityDrawerState는 여전히 "현재 레벨"만 담당하고(기존 검색/정렬 로직 무변경), 이
// 배열은 Breadcrumb 표시/뒤로가기 전용이다 — 새 렌더러를 타입별로 만들지 않는다.
let entityDrawerStack = [];
let entityDrawerPreviousFocus = null;

function entityDrawerCustomerRowHtml(row, index) {
  const aov = row.count ? Math.round(row.sales / row.count) : 0;
  return `
    <li class="entity-drawer-row" data-entity-type="client" data-entity-id="${esc(row.name)}" data-entity-label="${esc(row.name)}" tabindex="0">
      <span class="entity-drawer-rank">${index + 1}</span>
      <span class="entity-drawer-name">${esc(row.name)}</span>
      <span class="clients-tooltip-badge brand-customer-type-badge" style="border-color:${entityCompositionColors[row.type]}22;color:${entityCompositionColors[row.type]}">${esc(entityCompositionTypeLabel[row.type] || "-")}</span>
      <span class="entity-drawer-stat"><span>구매건수</span><strong>${apiNum(row.count)}건</strong></span>
      <span class="entity-drawer-stat"><span>총매출</span><strong>${apiWon(row.sales)}</strong></span>
      <span class="entity-drawer-stat"><span>객단가</span><strong>${apiWon(aov)}</strong></span>
      <span class="entity-drawer-stat"><span>최근구매일</span><strong>${esc(row.lastPurchase)}</strong></span>
    </li>`;
}

function entityDrawerCategoryRowHtml(row, index) {
  const aov = row.quantitySold ? Math.round(row.revenue / row.quantitySold) : 0;
  const stockStatus = entityCategoryStockStatus(row.stock);
  const momTone = row.mom > 0 ? "up" : row.mom < 0 ? "down" : "flat";
  const momArrow = row.mom > 0 ? "▲" : row.mom < 0 ? "▼" : "—";
  return `
    <li class="entity-drawer-row" data-entity-type="category" data-entity-id="${esc(row.code)}" data-entity-label="${esc(row.name)}" tabindex="0">
      <span class="entity-drawer-rank">${index + 1}</span>
      <span class="entity-drawer-name">${esc(row.name)}<i class="entity-drawer-code">${esc(row.code)}</i></span>
      <span class="entity-drawer-stat"><span>매출</span><strong>${apiWon(row.revenue)}</strong></span>
      <span class="entity-drawer-stat"><span>판매수량</span><strong>${apiNum(row.quantitySold)}개</strong></span>
      <span class="entity-drawer-stat"><span>객단가</span><strong>${apiWon(aov)}</strong></span>
      <span class="entity-drawer-stat"><span>재고상태</span><strong style="color:${stockStatus.color}">${esc(stockStatus.label)}</strong></span>
      <span class="entity-drawer-stat"><span>전월</span><strong class="brand-hero-delta ${momTone}">${momArrow} ${Math.abs(row.mom)}%</strong></span>
    </li>`;
}

// STEP60-1: Entity Navigation Foundation. Category → SKU → Order → Client 탐색 체인의
// SKU/Order 단계만 새로 추가한다(Client은 기존 'customer' 타입을 터미널 노드로 그대로
// 재사용 — 새 데이터 구조를 만들지 않는다). Category 자체는 여전히 source가 없으므로
// 어떤 Category에서 진입해도 같은 (브랜드 전체) SKU 목록을 보여준다 — Category별 분리는
// 하지 않는다(out of scope).
//
// BATCH B: entitySkuRows는 더 이상 Placeholder가 아니다. Sales는
// archive.commerce.productSales(refreshEntityTrendMonths가 이미 받아온 Monthly 응답, 새
// fetch 없음)를 brand_code로 필터링한 것이고, Stock은 refreshEntityInventory가 이미
// resolve한 ECOUNT brandKey로 브랜드 전용 items를 받아온 것이다(역시 새 rollup fetch
// 없음 — 같은 brandKey를 두 번 요청하지 않는다). 두 소스를 잇는 join key는 Product
// Registry의 verified===true && status==="confirmed" 항목(cafe24.productNo →
// ecount.matchedProducts[].prodCd)뿐이다 — productName 텍스트 매칭은 primary/fallback
// 어느 쪽으로도 쓰지 않는다(join 실패 시 재고는 그냥 "-"로 남긴다, Phase 5 Case D).
let entitySkuSalesState = { brandCode: null, periodMonth: null, rows: [], fetchFailed: false };
let entityInventoryItemsState = { brandCode: null, brandKey: null, items: [], fetchFailed: false, ready: false };
let entityProductRegistryEntriesPromise = null;
let entitySkuJoinDiagnostics = { matchedStock: 0, unmatchedStock: 0, salesRows: 0 };
const entitySkuRows = [];

// Product Registry는 initBrandSelector()가 페이지 로드 시 이미 한 번 받아오지만 entries
// 전체를 버린다(canonical name만 등록) — getSharedJson의 URL 캐시를 그대로 재사용하므로
// 여기서 다시 호출해도 새 네트워크 요청은 발생하지 않는다.
function loadEntityProductRegistryEntries() {
  if (!entityProductRegistryEntriesPromise) {
    entityProductRegistryEntriesPromise = getSharedJson("/api/intelligence/product-registry", 12000).then((data) => (
      Array.isArray(data?.registry?.entries) ? data.registry.entries : Array.isArray(data?.entries) ? data.entries : []
    ));
  }
  return entityProductRegistryEntriesPromise;
}

// BATCH B — Phase 5 join: verified+confirmed 항목의 cafe24.productNo가 정확히 일치할
// 때만 그 항목의 ecount.matchedProducts[].prodCd로 현재 브랜드 재고 items를 찾는다.
// 일치하는 registry 항목이 없거나, 있어도 그 prodCd가 이 브랜드 재고 items에 없으면
// (Case D) 재고를 알 수 없는 것으로 남긴다 — 0으로 합성하지 않는다.
function entitySkuStockFor(productNo, registryEntries, inventoryItems) {
  const entry = registryEntries.find((item) => (
    item?.verified === true && item?.status === "confirmed" && String(item?.cafe24?.productNo || "") === String(productNo || "")
  ));
  if (!entry) return { stock: null, matched: false };
  const codes = new Set((entry.ecount?.matchedProducts || []).map((p) => p?.prodCd).filter(Boolean));
  if (!codes.size) return { stock: null, matched: false };
  const matchedItems = inventoryItems.filter((item) => codes.has(item?.prodCd));
  if (!matchedItems.length) return { stock: null, matched: false };
  return { stock: matchedItems.reduce((sum, item) => sum + Number(item?.stockQuantity || 0), 0), matched: true };
}

// Case C 전용 역인덱스: verified+confirmed 항목의 ecount.matchedProducts[].prodCd →
// registry 항목. 이 브랜드 재고 items 중 이 브랜드의 이번 기간 온라인 판매 목록에는
// 없지만 registry로 confirmed 연결된 것이 있으면(재고는 있는데 이번 기간 온라인 판매가
// 없는 SKU) 그 항목도 행으로 보여준다 — productName 매칭이 아니라 여전히 같은
// verified+confirmed prodCd 연결만 사용한다.
function entityRegistryEntryByProdCd(registryEntries) {
  const map = new Map();
  registryEntries.forEach((entry) => {
    if (entry?.verified !== true || entry?.status !== "confirmed") return;
    (entry.ecount?.matchedProducts || []).forEach((p) => { if (p?.prodCd) map.set(p.prodCd, entry); });
  });
  return map;
}

// Sales(refreshEntityTrendMonths)와 Stock(refreshEntityInventory)은 서로 다른 비동기
// 흐름이라 각자 끝나는 시점에 이 함수를 호출해 entitySkuRows를 다시 만든다 — 브랜드가
// 아직 두 상태 모두에서 같은 값으로 안 맞춰졌으면(예: 방금 브랜드를 바꿔 Sales만 먼저
// 도착) Stock은 "조회 중" 취급(Case B와 동일하게 "-")하고 Sales가 도착하지 않았으면
// 목록 자체를 비운다 — 이전 브랜드 SKU가 남아 있지 않게 한다(Phase 9 stale guard).
async function rebuildEntitySkuRows() {
  const brandCode = brandIdentityState.brandCode;
  entitySkuRows.length = 0;
  if (!brandCode || entitySkuSalesState.brandCode !== brandCode || entitySkuSalesState.fetchFailed) {
    entitySkuJoinDiagnostics = { matchedStock: 0, unmatchedStock: 0, salesRows: 0 };
    refreshOpenEntitySkuDrawer();
    return;
  }
  const stockReady = entityInventoryItemsState.ready && entityInventoryItemsState.brandCode === brandCode;
  const inventoryItems = stockReady ? entityInventoryItemsState.items : [];
  const registryEntries = stockReady ? await loadEntityProductRegistryEntries() : [];
  if (brandIdentityState.brandCode !== brandCode || entitySkuSalesState.brandCode !== brandCode) return; // 대기 중 브랜드가 또 바뀌었으면 이 결과는 버린다.
  let matchedStock = 0;
  let unmatchedStock = 0;
  const rows = entitySkuSalesState.rows.map((p) => {
    let stock = null;
    let stockMatched = false;
    if (stockReady) {
      const result = entitySkuStockFor(p.productNo, registryEntries, inventoryItems);
      stock = result.stock;
      stockMatched = result.matched;
      if (stockMatched) matchedStock += 1; else unmatchedStock += 1;
    }
    return {
      productNo: p.productNo,
      productCode: p.productCode || p.productNo,
      productName: p.productName || "-",
      revenue: canonicalPaidAmount(p),
      quantitySold: Number(p.quantitySold || 0),
      orderCount: Number(p.orderCount || 0),
      salesVelocityPerDay: Number(p.salesVelocityPerDay || 0),
      stock,
      stockMatched,
      stockUnavailable: !stockReady || entityInventoryItemsState.fetchFailed
    };
  });
  // Case C: 재고는 있지만 이번 기간 온라인 판매가 없는(=productSales에 없는) SKU.
  // 이번 기간 온라인 판매가 0건이라는 것은 실제로 확인된 사실(그 기간 productSales
  // 응답에 이 productNo가 없음)이므로 null이 아니라 real 0으로 표시한다 — fetch 실패와
  // 다르다(Phase 9: 확인된 진짜 0은 그대로 0).
  const salesProductNos = new Set(entitySkuSalesState.rows.map((p) => String(p?.productNo || "")));
  const caseCRows = [];
  if (stockReady) {
    const byProdCd = entityRegistryEntryByProdCd(registryEntries);
    const seen = new Set();
    inventoryItems.forEach((item) => {
      const entry = byProdCd.get(item?.prodCd);
      if (!entry) return;
      const productNo = String(entry.cafe24?.productNo || "");
      if (!productNo || salesProductNos.has(productNo) || seen.has(productNo)) return;
      seen.add(productNo);
      const result = entitySkuStockFor(productNo, registryEntries, inventoryItems);
      if (result.matched) matchedStock += 1;
      caseCRows.push({
        productNo,
        productCode: entry.cafe24?.productCode || productNo,
        productName: entry.cafe24?.productName || item.productName || "-",
        revenue: 0,
        quantitySold: 0,
        orderCount: 0,
        salesVelocityPerDay: 0,
        stock: result.stock,
        stockMatched: result.matched,
        stockUnavailable: false,
        stockOnly: true
      });
    });
  }
  entitySkuJoinDiagnostics = { matchedStock, unmatchedStock, salesRows: rows.length, stockOnlyRows: caseCRows.length };
  entitySkuRows.push(...rows, ...caseCRows);
  refreshOpenEntitySkuDrawer();
}

// BATCH B: Sales(archive.commerce.productSales, 이미 fetch됨)만 이 브랜드/기간으로
// 필터링해 저장한다 — Stock 조인은 rebuildEntitySkuRows()가 별도로 수행한다.
function refreshEntitySkuSales(brandCode, periodMonth, productSales, fetchFailed) {
  entitySkuSalesState = {
    brandCode,
    periodMonth,
    fetchFailed,
    rows: fetchFailed ? [] : productSales.filter((p) => String(p?.brand_code || "").trim() === brandCode)
  };
  return rebuildEntitySkuRows();
}

// fetch가 끝났을 때 이미 열려 있는 SKU Drawer가 있으면 최신 데이터로 다시 그린다
// (refreshOpenEntityCustomerDetailViews와 동일한 stale-data 방지 패턴).
function refreshOpenEntitySkuDrawer() {
  if (entityDrawerState.open && entityDrawerState.type === "sku") renderEntityDrawerBody();
}

function entityDrawerSkuRowHtml(row, index) {
  const aov = row.quantitySold ? Math.round(row.revenue / row.quantitySold) : 0;
  const stockText = row.stock == null ? "-" : `${apiNum(row.stock)}개`;
  return `
    <li class="entity-drawer-row" data-entity-type="sku" data-entity-id="${esc(row.productNo)}" data-entity-label="${esc(row.productName)}" tabindex="0">
      <span class="entity-drawer-rank">${index + 1}</span>
      <span class="entity-drawer-name">${esc(row.productName)}<i class="entity-drawer-code">${esc(row.productCode)}</i></span>
      <span class="entity-drawer-stat"><span>온라인 매출</span><strong>${apiWon(row.revenue)}</strong></span>
      <span class="entity-drawer-stat"><span>온라인 판매수량</span><strong>${apiNum(row.quantitySold)}개</strong></span>
      <span class="entity-drawer-stat"><span>온라인 객단가</span><strong>${apiWon(aov)}</strong></span>
      <span class="entity-drawer-stat"><span>현재 재고</span><strong>${stockText}</strong></span>
    </li>`;
}

// 어떤 SKU에서 진입해도 동일한 Placeholder 주문 3건(#24015/#24018/#24103)을 보여준다.
// 고객명은 entityCompositionRows에 이미 존재하는 이름만 재사용해(새 인물 발명 금지)
// Order → Client 진입 시 'customer' 타입(entityCompositionRows)과 자연스럽게 연결되게
// 했다.
const entityOrderRows = [];

function entityDrawerOrderRowHtml(row, index) {
  return `
    <li class="entity-drawer-row" data-entity-type="order" data-entity-id="${esc(row.id)}" data-entity-label="${esc(row.clientName)}" tabindex="0">
      <span class="entity-drawer-rank">${index + 1}</span>
      <span class="entity-drawer-name">#${esc(row.id)}<i class="entity-drawer-code">${esc(row.date)}</i></span>
      <span class="entity-drawer-stat"><span>고객</span><strong>${esc(row.clientName)}</strong></span>
      <span class="clients-tooltip-badge brand-customer-type-badge" style="border-color:${entityCompositionColors[row.clientType]}22;color:${entityCompositionColors[row.clientType]}">${esc(entityCompositionTypeLabel[row.clientType] || "-")}</span>
      <span class="entity-drawer-stat"><span>수량</span><strong>${apiNum(row.quantity)}개</strong></span>
      <span class="entity-drawer-stat"><span>금액</span><strong>${apiWon(row.amount)}</strong></span>
      <span class="entity-drawer-stat"><span>상태</span><strong>${esc(row.status)}</strong></span>
    </li>`;
}

// BATCH A (Customer Purchase Detail): entityOrderRows(SKU 기준 "누가 샀나")와 반대 방향인
// "이 고객이 이 브랜드에서 실제로 무엇을 샀나"용 배열. 더 이상 Placeholder가 아니다 —
// openEntityDrawer("clientOrders", ...) 직전에 entityClientPurchaseLinesFor(row)의 실제
// 결과로 채워진다(구매 없음/불러오는 중/실패 상태는 이 배열이 아니라 clientWorkspaceBodyHtml/
// entityCompositionProfileHtml이 렌더링 시점에 별도로 표시한다).
const entityClientRecentPurchases = [];

// BATCH A: /api/intelligence/clients(Clients 화면이 이미 쓰는 buildClientsOverview(), 새
// 계산 없음)를 브랜드와 무관하게 "선택된 기간" 단위로 한 번만 가져와 Quick Profile/Client
// Workspace/clientOrders Drawer가 모두 공유한다 — 고객을 클릭할 때마다 새 fetch를 만들지
// 않는다(Phase 4). 브랜드 필터링(canonicalBrandCode)은 이 데이터를 읽는 시점에 매번
// 계산한다(entityClientPurchaseLinesFor) — 브랜드를 바꿔도 새 네트워크 요청이 필요 없다.
let entityClientsOverviewData = null;
let entityClientsOverviewFetchFailed = false;
let entityClientsOverviewRefreshSeq = 0;

async function refreshEntityClientsOverview(month) {
  const seq = ++entityClientsOverviewRefreshSeq;
  const { monthStart, monthEnd } = monthlyReportMonthRange(month);
  const data = await getSharedJson(intelligenceUrl(`/api/intelligence/clients?since=${monthStart}&until=${monthEnd}`), 15000);
  if (seq !== entityClientsOverviewRefreshSeq) return; // 더 최근 브랜드/기간 변경이 이미 진행 중이면 이 결과는 버린다.
  // BI-CORE-4와 동일한 NULL != ZERO 원칙: fetch 실패를 "구매 없음"으로 위장하지 않는다.
  if (data?.error || data?.ok !== true || !Array.isArray(data?.clients)) {
    if (data?.error) {
      console.warn(`[Brand Intelligence] clients fetch failure — month=${month}, reason=${data.error}`);
    }
    entityClientsOverviewData = null;
    entityClientsOverviewFetchFailed = true;
  } else {
    entityClientsOverviewData = data;
    entityClientsOverviewFetchFailed = false;
  }
  refreshOpenEntityCustomerDetailViews();
}

// BATCH A — Phase 3 (Customer Identity Matching): row.name은 buildBrandCustomerComposition()이
// 그대로 쓰는 원본 ECOUNT customerName이다(server.mjs:4141-4151). buildClientsOverview()는
// 이미 이 원본 이름들을 clientMergeKey()로 병합해 clients[].aliases에 전부 보존해 둔다 —
// 새 정규화 규칙을 만들지 않고, 그 병합 결과에 원본 이름이 포함되는 그룹을 찾는 것으로
// 충분하다(정확 일치만 사용, fuzzy 매칭 없음).
function entityClientOverviewMatchFor(row) {
  if (!row || !entityClientsOverviewData) return null;
  return entityClientsOverviewData.clients.find((client) => (
    client.name === row.name || (client.aliases || []).includes(row.name)
  )) || null;
}

// BATCH A — Phase 5 (Brand Filter): canonicalBrandCode === 선택된 brand_code인 라인만
// 남긴다. 온라인(개인결제창) 라인은 실제 상품 정보가 없어 canonicalBrandCode가 항상
// null이다(intelligence-service.mjs의 기존 설계 그대로 — 새 추론을 추가하지 않는다).
// 즉 이 목록은 구조적으로 오프라인 구매만 보여준다 — 데이터를 숨기는 것이 아니라 원천
// 데이터 자체에 온라인 라인의 브랜드 귀속 정보가 없기 때문이다.
function entityClientPurchaseLinesFor(row) {
  const brandCode = brandIdentityState.brandCode;
  const match = entityClientOverviewMatchFor(row);
  if (!brandCode || !match) return [];
  return (match.purchaseDetails || []).filter((line) => line.canonicalBrandCode === brandCode);
}

// BATCH A: fetch가 늦게 끝났을 때 이미 열려 있는 Client Workspace/clientOrders Drawer가
// 있으면 최신 데이터로 다시 그린다(Phase 10 stale-data 방지). Quick Profile 호버 카드는
// 180ms 지연 후 표시되고 mouseleave 시 즉시 사라지는 짧은 생명주기라 별도 재렌더 없이
// 다음 hover에서 최신 데이터를 그대로 읽는다 — fetch는 이미 브랜드/기간이 바뀌는 시점에
// 시작되므로 실제로 뒤처지는 경우는 드물다.
function refreshOpenEntityCustomerDetailViews() {
  if (clientWorkspaceRow) {
    const body = $("#clientWorkspaceBody");
    if (body) body.innerHTML = clientWorkspaceBodyHtml(clientWorkspaceRow);
  }
  if (entityDrawerState.open && entityDrawerState.type === "clientOrders" && entityDrawerState.context?.row) {
    entityClientRecentPurchases.length = 0;
    entityClientRecentPurchases.push(...entityClientPurchaseLinesFor(entityDrawerState.context.row));
    renderEntityDrawerBody();
  }
}

// BATCH A: 세 가지 state(불러오는 중/실패/성공)를 구분하는 공용 empty-state 조각 —
// Quick Profile/Client Workspace가 동일한 텍스트 규칙을 공유한다(Phase 10, BI-CORE-4의
// NULL != ZERO 원칙과 동일하게 "실패"를 "구매 없음"으로 위장하지 않는다).
function entityClientPurchaseStateHtml(brandLines) {
  if (entityClientsOverviewFetchFailed) return `<div class="entity-detail-empty"><p>구매 내역을 불러오지 못했습니다.</p></div>`;
  if (!entityClientsOverviewData) return `<div class="entity-detail-empty"><p>불러오는 중...</p></div>`;
  if (!brandLines.length) return `<div class="entity-detail-empty"><p>이 브랜드 구매 내역이 없습니다.</p></div>`;
  return null;
}

// STEP60-3: Client Workspace Foundation. 최근 주문 5건 — 위 3건을 그대로 펼치고, 이미
// entityOverviewRows에 존재하는 브랜드명(SUNDAY OFF CLUB/CLUB CULTURE)만 재사용해 2건을
// 더해 5건을 채운다 — 새 브랜드명을 지어내지 않는다.
const entityClientWorkspaceOrders = [];

// BATCH A: row는 이제 buildClientsOverview()의 실제 purchaseDetails 라인(date/orderId/
// productName/brand/quantity/salesAmount/source)이다 — 옛 Placeholder의 product/amount/
// variant 필드명은 실제 payload에 없으므로 제거하고(Phase 2 실측 필드명), 없는 값(옵션 등)을
// 지어내지 않는다. source(online/offline)는 실제로 존재하는 채널 정보라 대신 표시한다.
function entityDrawerClientOrderRowHtml(row, index) {
  const productLabel = row.productName || "제품 정보 없음";
  const channelLabel = row.source === "online" ? "온라인" : row.source === "offline" ? "오프라인" : "-";
  return `
    <li class="entity-drawer-row" data-entity-type="clientOrders" data-entity-id="${esc(String(row.orderId ?? index))}" data-entity-label="${esc(productLabel)}" tabindex="0">
      <span class="entity-drawer-rank">${index + 1}</span>
      <span class="entity-drawer-name">${esc(productLabel)}<i class="entity-drawer-code">${esc(channelLabel)}</i></span>
      <span class="entity-drawer-stat"><span>구매일</span><strong>${esc(row.date || "-")}</strong></span>
      <span class="entity-drawer-stat"><span>수량</span><strong>${apiNum(row.quantity)}개</strong></span>
      <span class="entity-drawer-stat"><span>금액</span><strong>${apiWon(row.salesAmount)}</strong></span>
    </li>`;
}

// STEP59-2: Brand Overview Full List Drawer. entityOverviewRows/entityOverviewShares/
// entityOverviewHealthGrade/entityOverviewStockStatus는 파일 뒤쪽(STEP57-1/57-2)에 정의된
// 함수 선언이라 호이스팅되므로 여기서 화살표 함수로 참조해도 안전하다(Drawer가 실제로 열릴
// 때만 호출됨). "Brand E~F~G~H" 같은 임시 이름은 Drawer 목록에서 제외한다(실제 확인된
// 브랜드만 표시 — 가짜 이름으로 행 수를 채우지 않는다). 매출 비중은 기존 entityOverviewShares()
// 계산을 그대로 재사용해(전체 8개 기준 분모) 필터링 후에도 값이 왜곡되지 않게 한다.
function entityDrawerOverviewRowHtml(row, index) {
  const grade = entityOverviewHealthGrade(row.health);
  const stockStatus = entityOverviewStockStatus(row.stock);
  const momTone = row.mom > 0 ? "up" : row.mom < 0 ? "down" : "flat";
  const momArrow = row.mom > 0 ? "▲" : row.mom < 0 ? "▼" : "—";
  return `
    <li class="entity-drawer-row" data-entity-type="brand" data-entity-id="${esc(row.name)}" tabindex="0">
      <span class="entity-drawer-rank">${index + 1}</span>
      <span class="entity-drawer-name">${esc(row.name)}<i class="entity-drawer-code" style="color:${grade.color}">${esc(grade.label)}</i></span>
      <span class="entity-drawer-stat"><span>Health</span><strong>${esc(String(row.health))}</strong></span>
      <span class="entity-drawer-stat"><span>매출</span><strong>${apiWon(row.revenue)}</strong></span>
      <span class="entity-drawer-stat"><span>매출비중</span><strong>${row.sharePct.toFixed(0)}%</strong></span>
      <span class="entity-drawer-stat"><span>판매수량</span><strong>${apiNum(row.quantitySold)}개</strong></span>
      <span class="entity-drawer-stat"><span>객단가</span><strong>${apiWon(row.aov)}</strong></span>
      <span class="entity-drawer-stat"><span>재고상태</span><strong style="color:${stockStatus.color}">${esc(stockStatus.label)}</strong></span>
      <span class="entity-drawer-stat"><span>Sell-through</span><strong>${row.sellThrough}%</strong></span>
      <span class="entity-drawer-stat"><span>전월</span><strong class="brand-hero-delta ${momTone}">${momArrow} ${Math.abs(row.mom)}%</strong></span>
    </li>`;
}

const entityDrawerConfig = {
  customer: {
    title: "전체 고객",
    description: "선택한 브랜드를 구매한 고객 전체 목록",
    searchPlaceholder: "고객명 검색",
    sortOptions: [
      { value: "count_desc", label: "구매 건수 높은 순" },
      { value: "sales_desc", label: "매출 높은 순" },
      { value: "aov_desc", label: "객단가 높은 순" },
      { value: "recent_desc", label: "최근 구매일 순" }
    ],
    rows: () => entityCompositionRows,
    matchesQuery: (row, query) => row.name.toLowerCase().includes(query),
    sortFns: {
      count_desc: (a, b) => b.count - a.count,
      sales_desc: (a, b) => b.sales - a.sales,
      aov_desc: (a, b) => (b.sales / (b.count || 1)) - (a.sales / (a.count || 1)),
      recent_desc: (a, b) => (b.lastPurchase || "").localeCompare(a.lastPurchase || "")
    },
    rowHtml: entityDrawerCustomerRowHtml,
    clickToast: "Client Intelligence 연결 예정",
    // BI-BATCH-E: "전체 고객" 목록은 이미 entityCompositionRows(실데이터)를 보여주면서도
    // 행 클릭은 여전히 옛 toast만 띄웠다 — 같은 고객이 TOP5에서는 이미 BATCH A의 실제 Client
    // Workspace(구매 내역 포함)로 연결돼 있다. 새 매칭 로직을 만들지 않고 그 자리에서 이미
    // 쓰는 identity(row.name)로 entityCompositionRows에서 같은 행을 찾아 openClientWorkspace로
    // 그대로 넘긴다(openEntityWorkspace가 이미 하는 것처럼 Drawer는 먼저 닫는다).
    onRowClick: (rowEl) => {
      const name = rowEl.dataset.entityLabel;
      const match = entityCompositionRows.find((row) => row.name === name);
      if (!match) return;
      closeEntityDrawer();
      openClientWorkspace(match);
    },
    emptyText: "검색 조건에 맞는 고객이 없습니다."
  },
  category: {
    title: "전체 상품군",
    description: "선택한 브랜드의 상품군 전체 목록",
    searchPlaceholder: "상품군명 또는 코드 검색",
    sortOptions: [
      { value: "revenue_desc", label: "매출 높은 순" },
      { value: "qty_desc", label: "판매수량 높은 순" },
      { value: "aov_desc", label: "객단가 높은 순" },
      { value: "stock_desc", label: "재고 많은 순" },
      { value: "mom_desc", label: "전월 증감 높은 순" }
    ],
    rows: () => entityCategoryDrawerRows,
    matchesQuery: (row, query) => row.name.toLowerCase().includes(query) || row.code.toLowerCase().includes(query),
    sortFns: {
      revenue_desc: (a, b) => b.revenue - a.revenue,
      qty_desc: (a, b) => b.quantitySold - a.quantitySold,
      aov_desc: (a, b) => (b.revenue / (b.quantitySold || 1)) - (a.revenue / (a.quantitySold || 1)),
      stock_desc: (a, b) => b.stock - a.stock,
      mom_desc: (a, b) => b.mom - a.mom
    },
    rowHtml: entityDrawerCategoryRowHtml,
    clickToast: "Category Intelligence 연결 예정",
    // STEP60-1: Entity Navigation Foundation. next가 있으면 행 클릭 시 toast 대신
    // 다음 Entity 레벨로 이동한다(pushEntityDrawerLevel). overview/customer처럼 next가
    // 없는 타입은 기존 clickToast 동작을 그대로 유지한다(회귀 없음).
    next: "sku"
  },
  sku: {
    title: "SKU",
    description: "선택한 브랜드의 온라인 판매 SKU 목록 (매출/수량/주문 · 재고는 항상 현재 시점 스냅샷)",
    searchPlaceholder: "상품명 또는 상품코드 검색",
    sortOptions: [
      { value: "revenue_desc", label: "온라인 매출 높은 순" },
      { value: "qty_desc", label: "온라인 판매수량 높은 순" },
      { value: "orders_desc", label: "온라인 주문수 높은 순" },
      { value: "stock_desc", label: "재고 많은 순" }
    ],
    rows: () => entitySkuRows,
    matchesQuery: (row, query) => row.productName.toLowerCase().includes(query) || String(row.productCode || "").toLowerCase().includes(query),
    sortFns: {
      revenue_desc: (a, b) => b.revenue - a.revenue,
      qty_desc: (a, b) => b.quantitySold - a.quantitySold,
      orders_desc: (a, b) => b.orderCount - a.orderCount,
      stock_desc: (a, b) => (b.stock ?? -1) - (a.stock ?? -1)
    },
    rowHtml: entityDrawerSkuRowHtml,
    clickToast: "SKU Intelligence 연결 예정",
    // BI-BATCH-E: SKU는 BATCH B로 이미 연결됐다 — 이번 기간 온라인 판매/재고가 실제로
    // 없거나 검색 결과가 없을 때도 "데이터 연결 대기"(=아직 안 만들어짐)로 보이면
    // 오해된다. 정직하게 "이번 기간에는 없다"로 구분하되, sales fetch 자체가 실패한
    // 경우는 "없다"가 아니라 "확인 실패"로 명확히 구분한다(entitySkuSalesState.fetchFailed,
    // NULL != ZERO와 동일 원칙 — fetch 실패를 확정된 빈 상태로 보여주지 않는다).
    emptyText: () => (entitySkuSalesState.fetchFailed
      ? "이번 기간 매출 데이터를 불러오지 못했습니다."
      : "이번 기간 온라인 판매 또는 확인된 재고가 없습니다."),
    next: "order"
  },
  order: {
    title: "Orders",
    description: "선택한 SKU의 최근 주문 목록",
    searchPlaceholder: "주문번호 또는 고객명 검색",
    sortOptions: [
      { value: "date_desc", label: "최근 주문일 순" },
      { value: "amount_desc", label: "금액 높은 순" },
      { value: "quantity_desc", label: "수량 높은 순" }
    ],
    rows: () => entityOrderRows,
    matchesQuery: (row, query) => row.id.toLowerCase().includes(query) || row.clientName.toLowerCase().includes(query),
    sortFns: {
      date_desc: (a, b) => (b.date || "").localeCompare(a.date || ""),
      amount_desc: (a, b) => b.amount - a.amount,
      quantity_desc: (a, b) => b.quantity - a.quantity
    },
    rowHtml: entityDrawerOrderRowHtml,
    clickToast: "Order Intelligence 연결 예정",
    // Order → Client은 새 타입을 만들지 않고 기존 'customer'(entityCompositionRows)를
    // 터미널 노드로 그대로 재사용한다.
    next: "customer"
  },
  // STEP60-2B: Client Quick Profile의 "최근 주문 보기" 버튼이 여는 Recent Order Drawer.
  // 기존 Entity Drawer 컴포넌트(같은 CSS/열기·닫기·포커스 트랩)를 그대로 재사용하고
  // config 타입 하나만 추가한다 — 새 Drawer를 만들지 않는다. 상품명 클릭 시 next:"sku"로
  // 기존 SKU Drawer로 그대로 이동한다("SKU Navigation" 요구사항).
  // BATCH A: rows()는 openEntityDrawer("clientOrders", { row })/refreshOpenEntityCustomerDetailViews()가
  // 그 시점의 entityClientPurchaseLinesFor(row) 결과로 채워 넣는 entityClientRecentPurchases를
  // 그대로 읽는다(config 자체는 여전히 어떤 고객인지 모른다 — 기존 구조 그대로).
  clientOrders: {
    title: "최근 주문",
    description: "선택한 고객의 이 브랜드 구매 내역",
    searchPlaceholder: "상품명 검색",
    sortOptions: [
      { value: "date_desc", label: "최근 구매일 순" },
      { value: "amount_desc", label: "금액 높은 순" }
    ],
    rows: () => entityClientRecentPurchases,
    matchesQuery: (row, query) => String(row.productName || "").toLowerCase().includes(query),
    sortFns: {
      date_desc: (a, b) => (b.date || "").localeCompare(a.date || ""),
      amount_desc: (a, b) => b.salesAmount - a.salesAmount
    },
    rowHtml: entityDrawerClientOrderRowHtml,
    // BI-BATCH-E: next가 있어 클릭 시 실제로는 pushEntityDrawerLevel("sku", ...)만 타므로
    // 이 clickToast는 호출되지 않는다 — 그래도 이전 값이 다른 타입(SKU) 문구를 잘못
    // 복사해 온 것이었어서 맞는 문구로 고친다.
    clickToast: "Client Intelligence 연결 예정",
    // BI-BATCH-E: entityClientPurchaseLinesFor()는 fetch 실패 시에도 빈 배열을 반환하므로
    // (entityClientOverviewMatchFor가 null을 돌려줌) sku와 동일하게 "정말 없음"과 "확인
    // 실패"를 구분해야 한다 — entityClientsOverviewFetchFailed로 판정(BATCH A가 이미 이
    // 플래그로 Workspace 본문의 실패 상태를 구분하던 것과 같은 값, 새 상태 아님).
    emptyText: () => (entityClientsOverviewFetchFailed
      ? "구매 내역을 불러오지 못했습니다."
      : "이 고객의 이 브랜드 구매 내역이 없습니다."),
    next: "sku"
  },
  overview: {
    title: "전체 브랜드",
    description: "전체 브랜드의 매출과 운영 상태를 비교합니다.",
    searchPlaceholder: "브랜드명 검색",
    sortOptions: [
      { value: "revenue_desc", label: "매출 높은 순" },
      { value: "share_desc", label: "매출 비중 높은 순" },
      { value: "qty_desc", label: "판매수량 높은 순" },
      { value: "aov_desc", label: "객단가 높은 순" },
      { value: "sellthrough_desc", label: "Sell-through 높은 순" },
      { value: "stock_desc", label: "재고 많은 순" },
      { value: "mom_desc", label: "전월 성장률 높은 순" },
      { value: "health_desc", label: "Health Score 높은 순" }
    ],
    rows: () => entityOverviewShares().filter((row) => !/^Brand [A-Z]$/.test(row.name)),
    matchesQuery: (row, query) => row.name.toLowerCase().includes(query),
    sortFns: {
      revenue_desc: (a, b) => b.revenue - a.revenue,
      share_desc: (a, b) => b.sharePct - a.sharePct,
      qty_desc: (a, b) => b.quantitySold - a.quantitySold,
      aov_desc: (a, b) => b.aov - a.aov,
      sellthrough_desc: (a, b) => b.sellThrough - a.sellThrough,
      stock_desc: (a, b) => b.stock - a.stock,
      mom_desc: (a, b) => b.mom - a.mom,
      health_desc: (a, b) => b.health - a.health
    },
    rowHtml: entityDrawerOverviewRowHtml,
    clickToast: "Brand Intelligence 연결 예정"
  }
};

function entityDrawerFocusableEls(panel) {
  return [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
}

function entityDrawerNode() {
  let el = $("#entityDrawer");
  if (!el) {
    el = document.createElement("div");
    el.id = "entityDrawer";
    el.className = "entity-drawer-modal";
    el.hidden = true;
    el.innerHTML = `
      <div class="entity-drawer-backdrop" data-entity-drawer-close></div>
      <div class="entity-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="entityDrawerTitle" tabindex="-1">
        <div class="entity-drawer-header">
          <div>
            <!-- STEP60-1: Entity Navigation Foundation. Breadcrumb는 Header 최상단에
                 항상 노출한다(현재 Entity/기간/Compare 상태와 함께). 새 상태를 만들지
                 않고 entityDrawerStack만 읽어서 그린다. -->
            <div id="entityDrawerBreadcrumb" class="entity-drawer-breadcrumb"></div>
            <strong id="entityDrawerTitle" class="entity-drawer-title"></strong>
            <p id="entityDrawerDescription" class="entity-drawer-description"></p>
            <p id="entityDrawerComparePeriod" class="entity-drawer-description entity-compare-only entity-drawer-compare-line"></p>
          </div>
          <button type="button" id="entityDrawerBackBtn" class="entity-drawer-back-btn" aria-label="이전 단계로">← 뒤로</button>
          <button type="button" class="entity-drawer-close-btn" data-entity-drawer-close aria-label="닫기">×</button>
        </div>
        <div class="entity-drawer-toolbar">
          <input id="entityDrawerSearch" type="search" class="entity-drawer-search" placeholder="검색">
          <select id="entityDrawerSort" class="entity-drawer-sort"></select>
        </div>
        <ul id="entityDrawerBody" class="entity-drawer-body"></ul>
        <div class="entity-drawer-footer" id="entityDrawerFooter"></div>
        <!-- STEP60-2B: Related + Explore. 실제 연관 데이터 계산 없이 같은 Entity Drawer
             체인(Related)과 실제 Workspace(Explore, Inventory/Monthly/Health)로 이동하는
             탐색 단축키만 제공한다(Placeholder, 아이콘 + 짧은 텍스트, "Open" 문구 없음).
             STEP60-1의 Next Question과 STEP60-2의 Workspace 5항목 섹션은 이 두 블록으로
             통합/정리했다. -->
        <div id="entityDrawerRelated" class="entity-drawer-related"></div>
        <div id="entityDrawerExplore" class="entity-drawer-related"></div>
      </div>`;
    document.body.appendChild(el);
  }
  return el;
}

function entityDrawerFilteredSortedRows() {
  const config = entityDrawerConfig[entityDrawerState.type];
  if (!config) return [];
  const query = entityDrawerState.query.trim().toLowerCase();
  let rows = config.rows();
  if (query) rows = rows.filter((row) => config.matchesQuery(row, query));
  const sortFn = config.sortFns[entityDrawerState.sort];
  if (sortFn) rows = [...rows].sort(sortFn);
  return rows;
}

function renderEntityDrawerBody() {
  const config = entityDrawerConfig[entityDrawerState.type];
  const body = $("#entityDrawerBody");
  const footer = $("#entityDrawerFooter");
  if (!config || !body) return;
  const rows = entityDrawerFilteredSortedRows();
  const context = entityDrawerState.context || { sourceType: entityDrawerState.type, label: `${config.title} 데이터 연결 대기` };
  // BI-BATCH-E: 기본 문구 "데이터 연결 대기"는 아직 실제로 연결되지 않은 타입(category/
  // order)에는 맞지만, 이미 실데이터에 연결된 타입(sku/customer)이 이번 기간/검색 조건에
  // 맞는 행이 없을 때도 그대로 쓰면 "기능이 아직 안 만들어졌다"처럼 오해된다 — 타입별
  // emptyText가 있으면 그것을, 없으면(=여전히 미연결) 기존 문구를 그대로 쓴다(회귀 없음).
  // emptyText가 함수면(fetch 실패와 "진짜 없음"을 구분해야 하는 타입, 예: sku) 호출해서
  // 쓴다 — fetch 실패를 "이번 기간엔 없다"는 확정 문장으로 오인시키지 않기 위함(Phase 11
  // NULL != ZERO와 동일한 원칙).
  const emptyText = typeof config.emptyText === "function" ? config.emptyText() : (config.emptyText || "데이터 연결 대기");
  body.innerHTML = rows.length
    ? rows.map((row, index) => config.rowHtml(row, index)).join("")
    : `<li class="entity-drawer-empty">${esc(emptyText)}${config.next ? `<br><button type="button" class="entity-drawer-related-chip" data-entity-drawer-jump="${esc(config.next)}">${esc(entityDrawerConfig[config.next].title)} 구조 보기</button>` : ""}</li>`;
  if (footer) footer.textContent = `${rows.length}건 표시 중`;
}

// STEP60-1: Entity Navigation Foundation. openEntityDrawer(첫 진입)/pushEntityDrawerLevel
// (다음 Entity로 이동)/popEntityDrawerTo(Breadcrumb·뒤로가기)가 전부 이 함수 하나만
// 공유한다 — "현재 레벨을 화면에 그린다"는 로직을 세 번 복제하지 않는다. 모달을
// 열고/닫는 것과는 분리되어 있어 이미 열려 있는 Drawer 안에서 레벨만 바꿀 때도 그대로
// 재사용된다.
function applyEntityDrawerLevel() {
  const config = entityDrawerConfig[entityDrawerState.type];
  if (!config) return;
  $("#entityDrawerTitle").textContent = config.title;
  // STEP59-2: Drawer 전용 기간 state를 새로 만들지 않고 entityPeriodState를 그대로 읽어
  // Header 설명에 기준 기간을 덧붙인다(Customer/Category/Overview 공통, 타입별 분기 없음).
  $("#entityDrawerDescription").textContent = `${config.description} · 기준 기간: ${entityPeriodLabel()}`;
  // STEP59-3/STEP59-4: Drawer 전용 비교 state를 새로 만들지 않고 entityCompareState/
  // entityPeriodState/entityCompareTargetLabel()/entityCompareBrandA()·B()를 그대로
  // 읽는다 — 표시 여부는 CSS(entity-compare-only)가 담당하므로 여기서는 텍스트만 채운다.
  // 기준/비교 브랜드명을 함께 표시해 Compare Header와 동일한 표현 규칙을 유지한다.
  const comparePeriodEl = $("#entityDrawerComparePeriod");
  if (comparePeriodEl) {
    comparePeriodEl.textContent = `기준: ${entityCompareBrandA()} · 비교: ${entityCompareBrandB()} · 현재 기간: ${entityPeriodLabel()} · 비교 대상 기간: ${entityCompareTargetLabel()}`;
  }
  const searchInput = $("#entityDrawerSearch");
  if (searchInput) {
    searchInput.value = "";
    searchInput.placeholder = config.searchPlaceholder;
  }
  const sortSelect = $("#entityDrawerSort");
  if (sortSelect) {
    sortSelect.innerHTML = config.sortOptions.map((opt) => `<option value="${esc(opt.value)}">${esc(opt.label)}</option>`).join("");
    sortSelect.value = entityDrawerState.sort;
  }
  renderEntityDrawerBody();
  renderEntityDrawerBreadcrumb();
  renderEntityDrawerRelated();
  renderEntityDrawerExplore();
  const backBtn = $("#entityDrawerBackBtn");
  if (backBtn) backBtn.hidden = entityDrawerStack.length <= 1;
  return searchInput;
}

// Breadcrumb 첫 칸은 이미 선택되어 있는 브랜드(entityCompareBrandA() — 새 state 없이
// 재사용)이고, 그 뒤로 entityDrawerStack이 지나온 Entity 이름을 그대로 이어붙인다.
// 마지막 칸(현재 위치)만 클릭 불가 텍스트이고, 나머지는 popEntityDrawerTo로 그 위치까지
// 되돌아간다.
function renderEntityDrawerBreadcrumb() {
  const el = $("#entityDrawerBreadcrumb");
  if (!el) return;
  const crumbs = [{ label: entityCompareBrandA(), index: -1 }, ...entityDrawerStack.map((item, index) => ({ label: item.label, index }))];
  el.innerHTML = crumbs.map((crumb, position) => {
    const isLast = position === crumbs.length - 1;
    const separator = position === 0 ? "" : `<span class="entity-drawer-breadcrumb-sep" aria-hidden="true">›</span>`;
    const crumbHtml = isLast
      ? `<span class="entity-drawer-breadcrumb-current">${esc(crumb.label)}</span>`
      : `<button type="button" class="entity-drawer-breadcrumb-crumb" data-entity-drawer-breadcrumb-index="${crumb.index}">${esc(crumb.label)}</button>`;
    return `${separator}${crumbHtml}`;
  }).join("");
}

// STEP60-1/STEP60-2B: Related Entity. 실제 연관 계산 없이 같은 체인의 다른 타입으로
// 바로 이동하는 탐색 단축키만 제공한다(Placeholder). STEP60-2B에서 목록을 SKU/Client/
// Orders 3개로 좁히고(Category 제외) 아이콘 + 짧은 텍스트만 쓰도록 정리했다 — 어떤
// 레벨에 있든 현재 타입만 제외하고 노출된다.
const entityDrawerRelatedLabels = {
  sku: { icon: "🧵", label: "SKU" },
  customer: { icon: "👤", label: "Client" },
  order: { icon: "🧾", label: "Orders" }
};
function renderEntityDrawerRelated() {
  const el = $("#entityDrawerRelated");
  if (!el) return;
  const currentType = entityDrawerState.type;
  const chips = Object.keys(entityDrawerRelatedLabels)
    .filter((type) => type !== currentType)
    .map((type) => `<button type="button" class="entity-drawer-related-chip" data-entity-drawer-jump="${type}">${entityDrawerRelatedLabels[type].icon} ${esc(entityDrawerRelatedLabels[type].label)}</button>`)
    .join("");
  el.innerHTML = chips ? `<p class="entity-drawer-related-title">Related</p><div class="entity-drawer-related-chips">${chips}</div>` : "";
}

// STEP60-2B: Explore. STEP60-2의 "Workspace"(Open Brand/Inventory/Monthly/Clients/Health,
// Preview 문구 포함) 섹션과 STEP60-1의 "Next Question" 섹션을 이 하나로 통합/정리했다 —
// Brand/Clients는 Related의 Client 칩과 중복이라 제거하고, 남은 Inventory/Monthly/Health만
// 아이콘 + 짧은 텍스트로 보여준다("Open" 문구 금지). 이동 로직은 새로 만들지 않고 기존
// openEntityWorkspace()/setActiveView()를 그대로 재사용한다.
const entityWorkspaceRoutes = {
  inventory: { icon: "📦", label: "Inventory", view: "InventoryOverview", routeHash: "inventory-overview" },
  monthly: { icon: "📅", label: "Monthly", view: "Reports", routeHash: "monthly-report" },
  health: { icon: "💚", label: "Health", view: null, routeHash: null }
};

function renderEntityDrawerExplore() {
  const el = $("#entityDrawerExplore");
  if (!el) return;
  const chips = Object.entries(entityWorkspaceRoutes)
    .map(([key, route]) => `<button type="button" class="entity-drawer-related-chip" data-entity-drawer-workspace="${key}">${route.icon} ${esc(route.label)}</button>`)
    .join("");
  el.innerHTML = `<p class="entity-drawer-related-title">Explore</p><div class="entity-drawer-related-chips">${chips}</div>`;
}

// Drawer를 닫고 실제 Workspace로 전환한다(기존 사이드바 nav 버튼과 동일하게
// setActiveView()만 호출 — 새 라우팅 로직 없음). "health"는 라우트가 없으므로 Brand
// Dashboard로 이동한 뒤 기존 Health Score 카드로 스크롤만 한다.
function openEntityWorkspace(key, context = null) {
  const route = entityWorkspaceRoutes[key];
  if (!route) return;
  closeEntityDrawer();
  if (route.view) {
    setActiveView(route.view, { routeHash: route.routeHash, entityContext: context });
    return;
  }
  setActiveView("BrandDashboard", { routeHash: "brand-dashboard" });
  requestAnimationFrame(() => {
    $("[data-entity-hero-tooltip=\"score\"]")?.closest(".brand-hero-score-block")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function openEntityDrawer(type, context = null) {
  const config = entityDrawerConfig[type];
  if (!config) return;
  entityDrawerState = { type, open: true, query: "", sort: config.sortOptions[0].value, context };
  entityDrawerStack = [{ type, label: context?.label || config.title, context }];
  const el = entityDrawerNode();
  const searchInput = applyEntityDrawerLevel();
  entityDrawerPreviousFocus = document.activeElement;
  el.hidden = false;
  document.body.classList.add("entity-drawer-open");
  requestAnimationFrame(() => {
    el.classList.add("is-visible");
    searchInput?.focus();
  });
}

// STEP60-1: 이미 열려 있는 Drawer 안에서 다음 Entity 레벨로 이동한다(새로고침 없음,
// 모달을 다시 열지 않음). config.next가 없는 타입(예: customer)에서는 호출되지 않는다
// (행 클릭 핸들러가 next 유무로 이미 분기함).
function pushEntityDrawerLevel(type, label, context = null) {
  const config = entityDrawerConfig[type];
  if (!config) return;
  const nextContext = context || entityDrawerState.context || { sourceType: entityDrawerState.type, label: label || config.title };
  entityDrawerStack.push({ type, label: label || config.title, context: nextContext });
  entityDrawerState = { type, open: true, query: "", sort: config.sortOptions[0].value, context: nextContext };
  const searchInput = applyEntityDrawerLevel();
  searchInput?.focus();
}

// Breadcrumb 클릭 시 그 위치까지 스택을 되돌린다(-1은 Brand 루트 — Drawer를 닫고 상단
// Brand Selector로 포커스를 돌려준다. 실제로는 이미 선택된 브랜드이므로 별도 이동
// 로직 없이 Drawer만 닫는다).
function popEntityDrawerTo(index) {
  if (index < 0) {
    closeEntityDrawer();
    return;
  }
  entityDrawerStack = entityDrawerStack.slice(0, index + 1);
  const top = entityDrawerStack[entityDrawerStack.length - 1];
  const config = entityDrawerConfig[top.type];
  if (!config) return;
  entityDrawerState = { type: top.type, open: true, query: "", sort: config.sortOptions[0].value, context: top.context || null };
  const searchInput = applyEntityDrawerLevel();
  searchInput?.focus();
}

// 닫힌 뒤에는 원래 "전체 보기" 버튼으로 포커스를 되돌린다(요구사항 — 포커스 복귀). 검색어/
// 정렬은 entityDrawerState 자체를 리셋하고, 다음에 열 때 openEntityDrawer()가 입력값을
// 새로 채워 넣으므로 DOM을 별도로 지우지 않아도 된다. entityDrawerStack도 함께 비워
// 다음 Drawer가 항상 새 Breadcrumb으로 시작하게 한다.
function closeEntityDrawer() {
  const el = $("#entityDrawer");
  if (!el || el.hidden) return;
  el.classList.remove("is-visible");
  el.hidden = true;
  document.body.classList.remove("entity-drawer-open");
  entityDrawerState = { type: null, open: false, query: "", sort: "" };
  entityDrawerStack = [];
  const toFocus = entityDrawerPreviousFocus;
  entityDrawerPreviousFocus = null;
  if (toFocus && typeof toFocus.focus === "function" && document.contains(toFocus)) toFocus.focus();
}

// STEP57-1: Entity Overview(Brand Mix Analysis). STEP58-3에서 Entity Intelligence
// Framework 명명 규칙에 맞춰 brandMix* → entityOverview*로 리네임(UI/동작 동일).
// 실제 co-purchase 집계 API 없이 상위 8개 브랜드
// placeholder로 좌측 progress list + 우측 Summary/AI Insight를 구현한다. Brand Master
// 미등록 브랜드명을 지어내지 않기 위해, 이미 이 대시보드(Entity Composition recentBrand)
// 에서 사용해 온 BONNAE/SUNDAY OFF CLUB/AAH MIDNIGHT/CLUB CULTURE 4개와 이번 STEP
// 프롬프트가 직접 준 이름만 쓰고, 나머지는 "Brand E~H" 같은 명백한 자리표시자로 채운다
// (실존 여부를 알 수 없는 브랜드명을 새로 만들어내지 않는다).
const entityOverviewRows = [
  { name: "BONNAE", revenue: 42000000, quantitySold: 720, aov: 58300, stock: 340, sellThrough: 68, mom: 9, health: 82, rotation: 3.2 },
  { name: "SUNDAY OFF CLUB", revenue: 34000000, quantitySold: 610, aov: 55700, stock: 210, sellThrough: 74, mom: 14, health: 88, rotation: 3.8 },
  { name: "AAH MIDNIGHT", revenue: 28000000, quantitySold: 480, aov: 58900, stock: 410, sellThrough: 52, mom: -4, health: 61, rotation: 1.9 },
  { name: "CLUB CULTURE", revenue: 22000000, quantitySold: 390, aov: 56400, stock: 280, sellThrough: 65, mom: 6, health: 75, rotation: 2.7 },
  { name: "Brand E", revenue: 17000000, quantitySold: 300, aov: 56700, stock: 190, sellThrough: 60, mom: 2, health: 70, rotation: 2.4 },
  { name: "Brand F", revenue: 13000000, quantitySold: 240, aov: 54200, stock: 260, sellThrough: 45, mom: -8, health: 42, rotation: 1.6 },
  { name: "Brand G", revenue: 9000000, quantitySold: 160, aov: 56300, stock: 130, sellThrough: 58, mom: 3, health: 66, rotation: 2.1 },
  { name: "Brand H", revenue: 7000000, quantitySold: 125, aov: 56000, stock: 95, sellThrough: 71, mom: 18, health: 79, rotation: 3.1 }
];

function entityOverviewShares() {
  const total = entityOverviewRows.reduce((sum, row) => sum + row.revenue, 0);
  const maxRevenue = Math.max(...entityOverviewRows.map((row) => row.revenue));
  return entityOverviewRows.map((row) => ({
    ...row,
    sharePct: total ? (row.revenue / total) * 100 : 0,
    barPct: maxRevenue ? (row.revenue / maxRevenue) * 100 : 0
  }));
}

// STEP57-2: Health Score(0~100)를 5단계 등급으로, 재고 수량을 4단계 상태로 요약한다.
// 둘 다 화면 표시용 분류일 뿐 재고/건강도 산식 자체(Business Logic)를 새로 만드는 것이
// 아니다 — placeholder 필드(health/stock)에 대한 단순 구간 매핑이다.
function entityOverviewHealthGrade(score) {
  if (score >= 85) return { label: "Excellent", color: "#206f54" };
  if (score >= 70) return { label: "Strong", color: "#4fb082" };
  if (score >= 55) return { label: "Healthy", color: "#6d6a62" };
  if (score >= 40) return { label: "Watch", color: "#d7a642" };
  return { label: "Risk", color: "#a9423d" };
}

function entityOverviewStockStatus(stock) {
  if (stock < 100) return { label: "Critical", color: "#a9423d" };
  if (stock < 150) return { label: "Low", color: "#d7a642" };
  if (stock < 300) return { label: "Healthy", color: "#206f54" };
  return { label: "Watch", color: "#d7a642" };
}

function entityOverviewProfileHtml(row) {
  const grade = entityOverviewHealthGrade(row.health);
  const stockStatus = entityOverviewStockStatus(row.stock);
  const momTone = row.mom > 0 ? "up" : row.mom < 0 ? "down" : "flat";
  const momArrow = row.mom > 0 ? "▲" : row.mom < 0 ? "▼" : "—";
  return `
    <div class="brand-customer-profile-head">
      <div class="brand-customer-profile-heading">
        <strong>${esc(row.name)}</strong>
        <span class="clients-tooltip-badge brand-customer-type-badge" style="border-color:${grade.color}22;color:${grade.color}">${esc(grade.label)}</span>
      </div>
      <div class="brand-customer-profile-vip-ring" style="--score:${Number(row.health) || 0}" aria-label="Health Score ${esc(String(row.health))}, ${esc(grade.label)}">
        <div class="brand-customer-profile-vip-ring-inner">${esc(String(row.health))}</div>
      </div>
    </div>
    <div class="brand-customer-profile-rows">
      <div class="brand-customer-profile-row"><span>매출</span><strong>${apiWon(row.revenue)}</strong></div>
      <div class="brand-customer-profile-row"><span>매출 비중</span><strong>${row.sharePct.toFixed(0)}%</strong></div>
      <div class="brand-customer-profile-row"><span>판매수량</span><strong>${apiNum(row.quantitySold)}개</strong></div>
      <div class="brand-customer-profile-row"><span>객단가</span><strong>${apiWon(row.aov)}</strong></div>
    </div>
    <div class="brand-customer-profile-rows">
      <div class="brand-customer-profile-row"><span>재고 상태</span><strong style="color:${stockStatus.color}">${esc(stockStatus.label)}</strong></div>
      <div class="brand-customer-profile-row"><span>Sell-through</span><strong>${row.sellThrough}%</strong></div>
      <div class="brand-customer-profile-row"><span>전월</span><strong class="brand-hero-delta ${momTone}">${momArrow} ${Math.abs(row.mom)}%</strong></div>
    </div>
    <div class="brand-customer-profile-rows brand-mix-profile-ai-summary">
      <p><span>AI Summary</span> ${esc(grade.label)} 등급 · ${esc(stockStatus.label)} 재고로 ${momTone === "up" ? "안정적인 성장세" : momTone === "down" ? "주의가 필요한 흐름" : "보합 흐름"}입니다. (Placeholder)</p>
    </div>
  `;
}

let entityOverviewProfileShowTimer = null;
let entityOverviewProfileHideTimer = null;

function cancelEntityOverviewProfileHide() {
  clearTimeout(entityOverviewProfileHideTimer);
  entityOverviewProfileHideTimer = null;
}

function scheduleEntityOverviewProfileHide() {
  clearTimeout(entityOverviewProfileShowTimer);
  cancelEntityOverviewProfileHide();
  entityOverviewProfileHideTimer = setTimeout(() => {
    const card = $("#entityOverviewProfileCard");
    if (!card) return;
    card.classList.remove("is-visible");
    card.hidden = true;
  }, 120);
}

function entityOverviewProfileNode() {
  let card = $("#entityOverviewProfileCard");
  if (!card) {
    card = document.createElement("div");
    card.id = "entityOverviewProfileCard";
    card.className = "brand-customer-profile-card brand-mix-profile-card";
    card.hidden = true;
    card.addEventListener("mouseenter", cancelEntityOverviewProfileHide);
    card.addEventListener("mouseleave", scheduleEntityOverviewProfileHide);
    document.body.appendChild(card);
  }
  return card;
}

function positionEntityOverviewProfileCard(anchor, card) {
  const margin = 16;
  const gap = 14;
  const rect = anchor.getBoundingClientRect();
  const width = card.offsetWidth || 400;
  const height = card.offsetHeight || 320;
  const fitsRight = rect.right + gap + width + margin <= window.innerWidth;
  let left = fitsRight ? rect.right + gap : rect.left - gap - width;
  left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin));
  let top = rect.top - (height - rect.height) / 2;
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function showEntityOverviewProfileCard(anchor, row) {
  clearTimeout(entityOverviewProfileShowTimer);
  entityOverviewProfileShowTimer = setTimeout(() => {
    cancelEntityOverviewProfileHide();
    const card = entityOverviewProfileNode();
    card.innerHTML = entityOverviewProfileHtml(row);
    card.hidden = false;
    card.style.left = "0px";
    card.style.top = "0px";
    positionEntityOverviewProfileCard(anchor, card);
    requestAnimationFrame(() => card.classList.add("is-visible"));
  }, 180);
}

function hideEntityOverviewProfileCardSoon() {
  scheduleEntityOverviewProfileHide();
}

function renderEntityOverviewSection() {
  const list = $("#entityOverviewList");
  if (!list) return;
  const rows = entityOverviewShares();
  list.innerHTML = rows.map((row, index) => `
    <li data-entity-overview-row="${index}" tabindex="0">
      <div class="brand-mix-row-head">
        <span class="brand-mix-name">${esc(row.name)}</span>
        <span class="brand-mix-pct">${row.sharePct.toFixed(0)}%</span>
        <strong>${apiWon(row.revenue)}</strong>
      </div>
      <i class="brand-mix-bar"><b style="width:${Math.max(4, row.barPct)}%"></b></i>
    </li>`).join("");

  const byHighest = (key) => [...rows].sort((a, b) => b[key] - a[key])[0];
  const topGrowth = byHighest("mom");
  const topRevenue = byHighest("revenue");
  const topAov = byHighest("aov");
  const topRotation = byHighest("rotation");
  const topSellThrough = byHighest("sellThrough");

  const summary = $("#entityOverviewSummary");
  if (summary) {
    summary.innerHTML = [
      ["Top Growth", topGrowth.name, `▲ ${topGrowth.mom}%`],
      ["Highest Revenue", topRevenue.name, apiWon(topRevenue.revenue)],
      ["Highest AOV", topAov.name, apiWon(topAov.aov)],
      ["Highest Rotation", topRotation.name, `${topRotation.rotation.toFixed(1)}회전`],
      ["Highest Sell-through", topSellThrough.name, `${topSellThrough.sellThrough}%`]
    ].map(([label, name, value]) => `
      <div class="brand-monthly-trend-summary-row">
        <span>${esc(label)}</span>
        <strong>${esc(name)}<small>${esc(value)}</small></strong>
      </div>`).join("");
  }

  const insight = $("#entityOverviewInsight");
  if (insight) {
    insight.textContent = `${topRevenue.name}이 매출 1위, ${topSellThrough.name}이 재고 회전과 판매 전환 모두 가장 우수합니다. (Placeholder)`;
  }
}

function bind() {
  $("#instagramRefreshBtn")?.addEventListener("click", refreshInstagramMonthlyData);
  $$("[data-refresh]").forEach((button) => {
    button.addEventListener("click", () => refreshDataCenterCard(button.dataset.refresh));
  });
  $("[data-ecount-wizard-open]")?.addEventListener("click", openEcountWizard);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-ecount-wizard-close]")) closeEcountWizard();
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "ecountWizardFile") ecountWizardHandleFileChange(event);
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#ecountWizardApplyBtn")) ecountWizardHandleApplyClick();
  });
  document.addEventListener("keydown", (event) => {
    const modal = $("#ecountWizardModal");
    if (!modal || modal.hidden || event.key !== "Escape") return;
    event.preventDefault();
    closeEcountWizard();
  });
  $$("[data-entity-hero-tooltip]").forEach((el) => {
    el.addEventListener("mouseenter", () => showEntityHeroTooltip(el));
    el.addEventListener("mouseleave", hideEntityHeroTooltip);
    el.addEventListener("focus", () => showEntityHeroTooltip(el));
    el.addEventListener("blur", hideEntityHeroTooltip);
  });
  $$("[data-entity-composition-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (entityCompositionMode === button.dataset.entityCompositionMode) return;
      entityCompositionMode = button.dataset.entityCompositionMode;
      $$("[data-entity-composition-mode]").forEach((btn) => btn.classList.toggle("active", btn === button));
      // 값이 순간적으로 바뀌는 느낌을 줄이기 위한 짧은 opacity crossfade(200ms)만 적용한다 —
      // conic-gradient 자체를 애니메이션하지 않는다(브라우저 간 보간이 불안정함).
      const grid = $(".brand-customer-grid");
      grid?.classList.add("is-updating");
      renderEntityCompositionSection();
      renderEntityCompareComposition();
      requestAnimationFrame(() => grid?.classList.remove("is-updating"));
    });
  });
  const entityCompositionDonutEl = $("#entityCompositionDonut");
  entityCompositionDonutEl?.addEventListener("mousemove", (event) => {
    const type = entityCompositionAngleToType(entityCompositionRanges(), event, entityCompositionDonutEl);
    if (type !== entityCompositionActiveType) setEntityCompositionActiveType(type);
    if (type) showEntityHeroTooltipContent(entityCompositionDonutEl, entityCompositionDonutTooltipHtml(type));
    else hideEntityHeroTooltip();
  });
  entityCompositionDonutEl?.addEventListener("mouseleave", () => {
    setEntityCompositionActiveType(null);
    hideEntityHeroTooltip();
  });
  $("#entityCompositionLegend")?.addEventListener("mouseover", (event) => {
    const li = event.target.closest("[data-entity-composition-type]");
    if (!li) return;
    setEntityCompositionActiveType(li.dataset.entityCompositionType);
    showEntityHeroTooltipContent(li, entityCompositionDonutTooltipHtml(li.dataset.entityCompositionType));
  });
  $("#entityCompositionLegend")?.addEventListener("mouseout", (event) => {
    if (!event.target.closest("[data-entity-composition-type]")) return;
    setEntityCompositionActiveType(null);
    hideEntityHeroTooltip();
  });
  $("#entityCompositionTop5")?.addEventListener("mouseover", (event) => {
    const li = event.target.closest("[data-entity-composition-row]");
    if (!li) return;
    const row = sortedEntityCompositionRows()[Number(li.dataset.entityCompositionRow)];
    if (row) showEntityCompositionProfileCard(li, row);
  });
  $("#entityCompositionTop5")?.addEventListener("mouseout", (event) => {
    const li = event.target.closest("[data-entity-composition-row]");
    if (!li) return;
    if (event.relatedTarget?.closest?.("#entityCompositionProfileCard")) return;
    hideEntityCompositionProfileCardSoon();
  });
  $("#entityCompositionTop5")?.addEventListener("focusin", (event) => {
    const li = event.target.closest("[data-entity-composition-row]");
    if (!li) return;
    const row = sortedEntityCompositionRows()[Number(li.dataset.entityCompositionRow)];
    if (row) showEntityCompositionProfileCard(li, row);
  });
  $("#entityCompositionTop5")?.addEventListener("focusout", (event) => {
    if (!event.target.closest("[data-entity-composition-row]")) return;
    hideEntityCompositionProfileCardSoon();
  });
  // STEP60-2B: Client Quick Profile. 카드 안의 모든 액션 버튼이 기존 함수(openEntityDrawer/
  // openEntityWorkspace/toast)만 호출한다 — 전용 이동 로직을 새로 만들지 않는다. 액션을
  // 누르면 hover 카드는 즉시 숨긴다(호버 아티팩트가 다른 화면 위에 남아있지 않도록).
  document.addEventListener("click", (event) => {
    const card = event.target.closest("#entityCompositionProfileCard");
    if (!card) return;
    const hideCard = () => {
      card.classList.remove("is-visible");
      card.hidden = true;
    };
    if (event.target.closest("[data-entity-drawer-quick-sku]")) {
      hideCard();
      openEntityDrawer("sku");
      return;
    }
    if (event.target.closest("[data-entity-drawer-quick-orders]")) {
      hideCard();
      // BATCH A: 이 고객의 브랜드 필터링된 실제 구매 내역으로 채운 뒤 연다(config.rows()가
      // entityClientRecentPurchases를 그대로 읽으므로 여기서 미리 채워야 한다).
      const activeRow = entityCompositionProfileActiveRow;
      entityClientRecentPurchases.length = 0;
      entityClientRecentPurchases.push(...entityClientPurchaseLinesFor(activeRow));
      openEntityDrawer("clientOrders", { row: activeRow });
      return;
    }
    const jumpBtn = event.target.closest("[data-entity-drawer-quick-jump]");
    if (jumpBtn) {
      hideCard();
      openEntityDrawer(jumpBtn.dataset.entityDrawerQuickJump);
      return;
    }
    const workspaceBtn = event.target.closest("[data-entity-drawer-quick-workspace]");
    if (workspaceBtn) {
      hideCard();
      openEntityWorkspace(workspaceBtn.dataset.entityDrawerQuickWorkspace);
      return;
    }
    if (event.target.closest("[data-entity-drawer-quick-client]")) {
      hideCard();
      openClientWorkspace(entityCompositionProfileActiveRow);
    }
  });
  // STEP60-3: Client Workspace Foundation. Related는 같은 Entity Drawer 체인을 그대로
  // 여는 것뿐이라(openEntityDrawer) Workspace는 닫지 않는다 — Drawer가 위에 겹쳐 열리고,
  // Drawer를 닫으면 Workspace가 그대로 남아있다. Explore는 실제 페이지 전환이라 Workspace도
  // 함께 닫는다(Entity Drawer의 Explore가 closeEntityDrawer()로 자기 자신을 닫는 것과 동일한
  // 원칙). Breadcrumb의 Brand 칸과 닫기 버튼/배경 클릭은 전부 closeClientWorkspace() 하나만
  // 호출한다.
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#clientWorkspace")) return;
    if (event.target.closest("[data-client-workspace-close]") || event.target.closest("[data-client-workspace-breadcrumb-brand]")) {
      closeClientWorkspace();
      return;
    }
    const relatedBtn = event.target.closest("[data-client-workspace-related]");
    if (relatedBtn) {
      const type = relatedBtn.dataset.clientWorkspaceRelated;
      // BATCH A: clientOrders는 Workspace가 이미 열려 있는 고객(clientWorkspaceRow) 기준으로
      // entityClientRecentPurchases를 채운 뒤 연다 — sku/order 등 다른 타입은 기존 동작 그대로.
      if (type === "clientOrders" && clientWorkspaceRow) {
        entityClientRecentPurchases.length = 0;
        entityClientRecentPurchases.push(...entityClientPurchaseLinesFor(clientWorkspaceRow));
        openEntityDrawer(type, { row: clientWorkspaceRow });
      } else {
        openEntityDrawer(type);
      }
      return;
    }
    const workspaceBtn = event.target.closest("[data-client-workspace-workspace]");
    if (workspaceBtn) {
      closeClientWorkspace();
      openEntityWorkspace(workspaceBtn.dataset.clientWorkspaceWorkspace);
    }
  });
  // 닫기(ESC)/포커스 트랩은 clientsDetailModal/entityDrawer와 동일한 패턴을 그대로 따른다.
  // Related에서 연 Entity Drawer가 Workspace 위에 겹쳐 있을 때는(§7 참고) 그 Drawer가
  // "가장 위" 레이어이므로 ESC/Tab을 넘겨준다 — 이 리스너가 함께 반응하면 ESC 한 번에
  // Drawer와 Workspace가 동시에 닫혀버린다(실측으로 발견, 의도한 "한 겹씩 닫힘"이 아님).
  document.addEventListener("keydown", (event) => {
    const modal = $("#clientWorkspace");
    if (!modal || modal.hidden) return;
    const drawerEl = $("#entityDrawer");
    if (drawerEl && !drawerEl.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeClientWorkspace();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = modal.querySelector(".client-workspace-panel");
    if (!panel) return;
    const focusable = clientWorkspaceFocusableEls(panel);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  renderEntityCompositionSection();
  // STEP59-4C: Unified Entity Selector. 기존 Brand Selector 전용 리스너(트리거/바깥
  // 클릭/ESC/검색/목록 클릭·키보드)를 instance 루프 하나로 승격한다 — primary/compare
  // 둘 다 같은 코드 경로를 타므로 Selector 상호작용 로직이 두 벌 존재하지 않는다.
  $("#brandSelectorTrigger")?.addEventListener("click", () => {
    toggleEntitySelectorDropdown("primary");
  });
  $("#brandSelectorClearBtn")?.addEventListener("click", () => {
    clearBrandSelectorSelection();
  });
  document.addEventListener("click", (event) => {
    Object.entries(entitySelectorInstances).forEach(([key, inst]) => {
      if (!entitySelectorState[key].open) return;
      if (event.target.closest(inst.dom.wrapper)) return;
      closeEntitySelectorDropdown(key);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    Object.entries(entitySelectorInstances).forEach(([key, inst]) => {
      if (!entitySelectorState[key].open) return;
      closeEntitySelectorDropdown(key);
      $(inst.dom.trigger)?.focus();
    });
  });
  Object.entries(entitySelectorInstances).forEach(([key, inst]) => {
    $(inst.dom.search)?.addEventListener("input", (event) => {
      entitySelectorState[key].query = event.target.value || "";
      renderEntitySelectorAll(key);
    });
    [inst.dom.recent, inst.dom.all].forEach((listSelector) => {
      $(listSelector)?.addEventListener("click", (event) => {
        const li = event.target.closest("[data-entity-selector-name]");
        if (li && !li.classList.contains("is-disabled")) inst.onSelect(li.dataset.entitySelectorName);
      });
      $(listSelector)?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const li = event.target.closest("[data-entity-selector-name]");
        if (!li || li.classList.contains("is-disabled")) return;
        event.preventDefault();
        inst.onSelect(li.dataset.entitySelectorName);
      });
    });
  });
  initBrandSelector();
  refreshEntitySystemStatus();
  initPromotionSelector();
  renderEntityHeroState();
  // STEP59-2: Entity Period Control Foundation. 브랜드 선택 상태와 무관하게 항상 동작
  // 가능해야 하므로 renderEntityHeroState()와는 독립적으로 초기화한다.
  $$("[data-entity-period-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (entityPeriodState.mode === btn.dataset.entityPeriodMode) return;
      entityPeriodState.mode = btn.dataset.entityPeriodMode;
      renderEntityPeriodControl();
      // STEP61-2: "Period 변경 → Monthly 값 변경" — entityPeriodState를 바꾸는 세 지점
      // (모드/연도/월) 모두에서 동일하게 재조회한다(브랜드 미선택이면 refreshEntityTrendMonths
      // 내부에서 조용히 빈 배열로 정리됨).
      refreshEntityTrendMonths();
    });
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "entityPeriodYear") {
      entityPeriodState.year = Number(event.target.value);
      renderEntityPeriodControl();
      refreshEntityTrendMonths();
    }
    if (event.target.id === "entityPeriodMonth") {
      entityPeriodState.month = Number(event.target.value);
      renderEntityPeriodControl();
      refreshEntityTrendMonths();
    }
  });
  renderEntityPeriodControl();
  // STEP59-3: Compare Mode UI. Period Control과 마찬가지로 브랜드 선택 상태와 무관하게
  // 항상 동작한다. 토글 클릭은 entityCompareState.enabled만 뒤집고 renderEntityCompareUI()
  // 하나만 호출한다(실데이터/증감 계산 없음).
  $("#entityCompareToggle")?.addEventListener("click", () => {
    entityCompareState.enabled = !entityCompareState.enabled;
    renderEntityCompareUI();
    refreshEntityTrendMonths();
  });
  // STEP59-4: Compare Header의 종료 버튼도 같은 state/같은 render 함수만 사용한다(종료
  // 전용 로직을 따로 만들지 않음 — 토글 클릭과 완전히 동일한 2줄).
  $("#entityCompareHeaderCloseBtn")?.addEventListener("click", () => {
    entityCompareState.enabled = false;
    renderEntityCompareUI();
    refreshEntityTrendMonths();
  });
  // BI-BATCH-G: 이전에는 이 change 핸들러가 renderEntityCompareUI()만 호출해 헤더의
  // "비교 대상" 라벨(prev/yoy/custom)만 바뀌고, 실제 Period Performance 표/Comparison
  // Summary는 refreshEntityCompareTargetPeriodData()가 다시 fetch해야만 갱신되는데 그
  // 호출이 전혀 없었다 — prev→YoY로 바꿔도 지난달 숫자가 그대로 남아있던 원인. 새 fetch
  // 함수를 만들지 않고 이미 존재하는 refreshEntityCompareKpi()(=refreshEntityTrendMonths가
  // 브랜드/기간 변경 시 쓰는 것과 동일한 함수)를 그대로 재사용한다.
  $("#entityCompareTarget")?.addEventListener("change", () => {
    renderEntityCompareUI();
    refreshEntityCompareKpi();
  });
  // STEP67-8D: Comparison Brand A Local Selector. 기존에는 이 트리거가 상단 Primary
  // Selector로 스크롤 후 그 드롭다운을 여는 방식이었다(STEP59-4B~STEP67-8D 중간
  // 수정까지) — 사용자 Chrome QA에서 "버튼 바로 아래가 아니라 엉뚱한 곳이 열린다"는
  // 문제로 반려됐다. "비교 브랜드" 트리거와 동일하게 자기 자신의 인스턴스
  // (compareA)만 토글한다(별도 열기/닫기 로직 없음, 선택 시 실제 반영은 여전히
  // compareA.onSelect → selectBrandSelectorName() 한 곳에서만 일어난다).
  $("#entityCompareBrandATrigger")?.addEventListener("click", () => {
    toggleEntitySelectorDropdown("compareA");
  });
  $("#entityCompareBrandBTrigger")?.addEventListener("click", () => {
    toggleEntitySelectorDropdown("compare");
  });
  renderEntityCompareUI();
  // STEP59-1: Entity Full List Drawer. 검색/정렬 input은 entityDrawerNode()가 처음 열릴
  // 때만 DOM에 생성되므로(지연 생성) bind() 시점에 직접 addEventListener하면 리스너가
  // 붙지 않는다 — ecountWizardFile과 동일하게 document 위임(id 매칭)으로 처리한다.
  $("#entityCompositionDrawerBtn")?.addEventListener("click", () => openEntityDrawer("customer"));
  $("#entityCategoryDrawerBtn")?.addEventListener("click", () => openEntityDrawer("category"));
  $("#entityOverviewDrawerBtn")?.addEventListener("click", () => openEntityDrawer("overview"));
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-entity-drawer-close]")) closeEntityDrawer();
  });
  // STEP60-1: Entity Navigation Foundation. config.next가 있으면(category/sku/order)
  // 행 클릭이 다음 Entity 레벨로 이동한다 — 없으면(customer/overview) 기존 toast
  // 그대로다(회귀 없음). 새 클릭 핸들러를 타입별로 만들지 않고 한 곳에서 분기한다.
  document.addEventListener("click", (event) => {
    const row = event.target.closest(".entity-drawer-row");
    if (!row) return;
    const config = entityDrawerConfig[entityDrawerState.type];
    if (!config) return;
    if (config.next) pushEntityDrawerLevel(config.next, row.dataset.entityLabel, {
      sourceType: row.dataset.entityContextSource || entityDrawerState.type,
      label: row.dataset.entityLabel || entityDrawerState.context?.label || config.title
    });
    else if (config.onRowClick) config.onRowClick(row);
    else toast(config.clickToast);
  });
  // Breadcrumb 크럼(뒤로가기 포함) + Related Entity/Next Question 단축 이동은 전부
  // popEntityDrawerTo/pushEntityDrawerLevel 두 함수만 호출한다(전용 로직 없음).
  document.addEventListener("click", (event) => {
    const crumb = event.target.closest("[data-entity-drawer-breadcrumb-index]");
    if (crumb) {
      popEntityDrawerTo(Number(crumb.dataset.entityDrawerBreadcrumbIndex));
      return;
    }
    if (event.target.closest("#entityDrawerBackBtn")) {
      popEntityDrawerTo(entityDrawerStack.length - 2);
      return;
    }
    const jumpBtn = event.target.closest("[data-entity-drawer-jump]");
    if (jumpBtn) {
      const type = jumpBtn.dataset.entityDrawerJump;
      if (type === entityDrawerState.type) {
        toast("이미 보고 있는 화면입니다.");
      } else if (entityDrawerConfig[type]) {
        pushEntityDrawerLevel(type, jumpBtn.dataset.entityContextLabel || entityDrawerConfig[type].title, {
          sourceType: jumpBtn.dataset.entityContextSource || entityDrawerState.type,
          label: jumpBtn.dataset.entityContextLabel || entityDrawerState.context?.label || entityDrawerConfig[type].title
        });
      }
      return;
    }
    // STEP60-2: Cross Entity Navigation. Next Question의 Inventory/Monthly 버튼과
    // Workspace Navigation 섹션의 5개 버튼이 전부 이 한 줄(openEntityWorkspace)만
    // 호출한다 — Workspace 전환 로직을 두 곳에 나눠 만들지 않는다.
    const workspaceBtn = event.target.closest("[data-entity-drawer-workspace]");
    if (workspaceBtn) {
      openEntityWorkspace(workspaceBtn.dataset.entityDrawerWorkspace, {
        sourceType: workspaceBtn.dataset.entityContextSource || entityDrawerState.type,
        label: workspaceBtn.dataset.entityContextLabel || entityDrawerState.context?.label || entityDrawerConfig[entityDrawerState.type]?.title
      });
    }
  });
  document.addEventListener("input", (event) => {
    if (event.target.id !== "entityDrawerSearch") return;
    entityDrawerState.query = event.target.value || "";
    renderEntityDrawerBody();
  });
  document.addEventListener("change", (event) => {
    if (event.target.id !== "entityDrawerSort") return;
    entityDrawerState.sort = event.target.value;
    renderEntityDrawerBody();
  });
  // 닫기(ESC)/포커스 트랩은 clientsDetailModal과 동일한 패턴을 그대로 따른다.
  document.addEventListener("keydown", (event) => {
    const row = event.target.closest?.(".entity-drawer-row");
    if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const config = entityDrawerConfig[entityDrawerState.type];
      if (!config) return;
      if (config.next) pushEntityDrawerLevel(config.next, row.dataset.entityLabel, {
        sourceType: row.dataset.entityContextSource || entityDrawerState.type,
        label: row.dataset.entityLabel || entityDrawerState.context?.label || config.title
      });
      else if (config.onRowClick) config.onRowClick(row);
      else toast(config.clickToast);
      return;
    }
    const el = $("#entityDrawer");
    if (!el || el.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeEntityDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = el.querySelector(".entity-drawer-panel");
    if (!panel) return;
    const focusable = entityDrawerFocusableEls(panel);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  $("#entityTrendChart")?.addEventListener("mouseover", (event) => {
    const point = event.target.closest("[data-entity-trend-point]");
    if (!point) return;
    point.classList.add("is-active");
    showEntityHeroTooltipContent(point, entityTrendPointTooltipHtml(Number(point.dataset.entityTrendPoint)));
  });
  $("#entityTrendChart")?.addEventListener("mouseout", (event) => {
    const point = event.target.closest("[data-entity-trend-point]");
    if (!point) return;
    point.classList.remove("is-active");
    hideEntityHeroTooltip();
  });
  $("#entityTrendChart")?.addEventListener("focusin", (event) => {
    const point = event.target.closest("[data-entity-trend-point]");
    if (!point) return;
    point.classList.add("is-active");
    showEntityHeroTooltipContent(point, entityTrendPointTooltipHtml(Number(point.dataset.entityTrendPoint)));
  });
  $("#entityTrendChart")?.addEventListener("focusout", (event) => {
    const point = event.target.closest("[data-entity-trend-point]");
    if (!point) return;
    point.classList.remove("is-active");
    hideEntityHeroTooltip();
  });
  renderEntityTrendSection();
  $$("[data-entity-category-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (entityCategoryMode === button.dataset.entityCategoryMode) return;
      entityCategoryMode = button.dataset.entityCategoryMode;
      $$("[data-entity-category-mode]").forEach((btn) => btn.classList.toggle("active", btn === button));
      const grid = $(".brand-category-grid");
      grid?.classList.add("is-updating");
      renderEntityCategorySection();
      requestAnimationFrame(() => grid?.classList.remove("is-updating"));
    });
  });
  $("#entityCategoryList")?.addEventListener("mouseover", (event) => {
    const li = event.target.closest("[data-category-code]");
    const unavailable = event.target.closest("[data-category-unavailable]");
    if (unavailable) return showEntityCategoryProfileCard(unavailable, null);
    if (!li) return;
    const row = entityCategoryRows.find((r) => r.code === li.dataset.categoryCode);
    if (row) showEntityCategoryProfileCard(li, row);
  });
  $("#entityCategoryList")?.addEventListener("mouseout", (event) => {
    const li = event.target.closest("[data-category-code], [data-category-unavailable]");
    if (!li) return;
    if (event.relatedTarget?.closest?.("#entityCategoryProfileCard")) return;
    hideEntityCategoryProfileCardSoon();
  });
  $("#entityCategoryList")?.addEventListener("focusin", (event) => {
    const li = event.target.closest("[data-category-code]");
    const unavailable = event.target.closest("[data-category-unavailable]");
    if (unavailable) return showEntityCategoryProfileCard(unavailable, null);
    if (!li) return;
    const row = entityCategoryRows.find((r) => r.code === li.dataset.categoryCode);
    if (row) showEntityCategoryProfileCard(li, row);
  });
  $("#entityCategoryList")?.addEventListener("focusout", (event) => {
    if (!event.target.closest("[data-category-code], [data-category-unavailable]")) return;
    hideEntityCategoryProfileCardSoon();
  });
  renderEntityCategorySection();
  $("#entityOverviewList")?.addEventListener("mouseover", (event) => {
    const li = event.target.closest("[data-entity-overview-row]");
    if (!li) return;
    const row = entityOverviewShares()[Number(li.dataset.entityOverviewRow)];
    if (row) showEntityOverviewProfileCard(li, row);
  });
  $("#entityOverviewList")?.addEventListener("mouseout", (event) => {
    const li = event.target.closest("[data-entity-overview-row]");
    if (!li) return;
    if (event.relatedTarget?.closest?.("#entityOverviewProfileCard")) return;
    hideEntityOverviewProfileCardSoon();
  });
  $("#entityOverviewList")?.addEventListener("focusin", (event) => {
    const li = event.target.closest("[data-entity-overview-row]");
    if (!li) return;
    const row = entityOverviewShares()[Number(li.dataset.entityOverviewRow)];
    if (row) showEntityOverviewProfileCard(li, row);
  });
  $("#entityOverviewList")?.addEventListener("focusout", (event) => {
    if (!event.target.closest("[data-entity-overview-row]")) return;
    hideEntityOverviewProfileCardSoon();
  });
  renderEntityOverviewSection();
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
    if (todayViewActive() || commerceDestinationViewActive()) renderOverviewLiveData(selectedMonth(), renderSeq);
    else todayViewDirty = true;
    if ($("#Clients")?.classList.contains("active")) refreshClientsView();
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
      if (todayViewActive() || commerceDestinationViewActive()) renderOverviewLiveData(selectedMonth(), renderSeq);
      else todayViewDirty = true;
      if ($("#Clients")?.classList.contains("active")) refreshClientsView();
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
      if (todayViewActive() || commerceDestinationViewActive()) renderOverviewLiveData(selectedMonth(), renderSeq);
      else todayViewDirty = true;
      if ($("#Clients")?.classList.contains("active")) refreshClientsView();
    }
  });
  $("#clientsListSearch")?.addEventListener("input", (event) => {
    clientsListSearch = event.target.value || "";
    scheduleClientsListRefresh();
  });
  $("#clientsListTypeFilter")?.addEventListener("change", (event) => {
    clientsListTypeFilter = event.target.value || "all";
    clientsListVisibleCount = CLIENTS_LIST_PAGE_SIZE;
    renderClientsList();
  });
  $("#clientsListSort")?.addEventListener("change", (event) => {
    clientsListSort = event.target.value || "recent_desc";
    clientsListVisibleCount = CLIENTS_LIST_PAGE_SIZE;
    renderClientsList();
  });
  $("#clientsListMoreBtn")?.addEventListener("click", () => {
    clientsListVisibleCount += CLIENTS_LIST_PAGE_SIZE;
    renderClientsList();
  });
  $("#clientsListRows")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-client-row]");
    if (!row) return;
    // 2026-07-17 최종 정정(TASK4): 행 선택(강조 표시) 동작은 그대로 두고, 같은 클릭으로
    // 고객 상세 모달도 함께 연다(요구사항 — "고객 목록 행" 클릭 시 상세 창).
    selectedClientId = row.dataset.clientId || null;
    $$("#clientsListRows tr").forEach((node) => node.classList.toggle("is-selected", node === row));
    if (row.dataset.clientsDetail) openClientsDetailModal(row.dataset.clientsDetail);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("#clientsListRows [data-client-row]");
    if (!row) return;
    event.preventDefault();
    selectedClientId = row.dataset.clientId || null;
    $$("#clientsListRows tr").forEach((node) => node.classList.toggle("is-selected", node === row));
    if (row.dataset.clientsDetail) openClientsDetailModal(row.dataset.clientsDetail);
  });
  // 2026-07-17 최종 정정(TASK4): 스타일리스트/프레스 TOP10 행 클릭 시 고객 상세 모달을 연다.
  // 고객 목록 행은 위의 #clientsListRows 전용 핸들러가 이미 처리하므로([data-client-row]),
  // 여기서는 그 행을 제외한 나머지 [data-clients-detail] 트리거(TOP10)만 다룬다 — 같은 클릭이
  // 두 핸들러에서 중복으로 모달을 열지 않게 하기 위함이다.
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("#Clients [data-clients-detail]");
    if (!trigger || trigger.closest("[data-client-row]")) return;
    openClientsDetailModal(trigger.dataset.clientsDetail);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const trigger = event.target.closest("#Clients [data-clients-detail]");
    if (!trigger || trigger.closest("[data-client-row]")) return;
    event.preventDefault();
    openClientsDetailModal(trigger.dataset.clientsDetail);
  });
  // 고객 상세 모달: 닫기 버튼/배경 클릭/ESC로 닫고, Tab은 모달 안에서만 순환시킨다(포커스 트랩).
  // 닫힌 뒤에는 openClientsDetailModal()이 기억해 둔 원래 트리거 엘리먼트로 포커스를 되돌린다.
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-clients-detail-close]")) closeClientsDetailModal();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-clients-detail-more-dates]")) {
      clientsDetailShowAllDates = true;
      rerenderClientsDetailModalBody();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-clients-detail-more-alias-stats]")) {
      clientsDetailShowAllAliasStats = true;
      rerenderClientsDetailModalBody();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-clients-detail-more-timeline]")) {
      clientsDetailShowAllTimeline = true;
      rerenderClientsDetailModalBody();
    }
  });
  // STEP62-2: Purchase Timeline 항목 클릭 → 공용 Order Detail Drawer를 연다. dataset에 이미
  // 담아 둔 값만 읽어 순수 데이터 객체를 만들고, Clients 상태(clientsDetailStore 등)는 전혀
  // 참조하지 않는다(Drawer가 어느 화면에서 열렸는지 몰라도 되도록).
  document.addEventListener("click", (event) => {
    const item = event.target.closest("[data-clients-timeline-item]");
    if (!item) return;
    openOrderDetailDrawer(orderFromTimelineItemDataset(item.dataset));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest("[data-clients-timeline-item]");
    if (!item) return;
    event.preventDefault();
    openOrderDetailDrawer(orderFromTimelineItemDataset(item.dataset));
  });
  // STEP62-2: Order Detail Drawer가 clients-detail-modal 위에 열려 있으면 ESC는 Drawer가 먼저
  // 처리해야 한다(STEP60-3 ESC 레이어링 가드와 동일한 원칙). 이 가드는 반드시 Order Detail
  // Drawer 자신의 ESC-close 핸들러보다 먼저 등록해야 한다 — keydown 리스너는 등록 순서대로
  // 실행되는데, Drawer가 먼저 스스로를 닫아 hidden을 true로 바꿔버리면 이 가드가 나중에 실행될
  // 때는 이미 "닫혀 있음"으로 보여 가드가 무력화된다(실제로 이 순서로 두었다가 한 번의 ESC로
  // 두 레이어가 함께 닫히는 버그를 발견해 순서를 바로잡았다).
  document.addEventListener("keydown", (event) => {
    const modal = $("#clientsDetailModal");
    if (!modal || modal.hidden) return;
    const orderDrawerEl = $("#orderDetailDrawer");
    if (orderDrawerEl && !orderDrawerEl.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeClientsDetailModal();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = modal.querySelector(".clients-detail-panel");
    if (!panel) return;
    const focusable = clientsDetailFocusableEls(panel);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  // Order Detail Drawer 자신의 닫기(버튼/배경 클릭/ESC)와 Tab 포커스 트랩 — 위 가드보다 반드시
  // 뒤에 등록해야 레이어링이 올바르게 동작한다(바로 위 주석 참고).
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-order-detail-drawer-close]")) closeOrderDetailDrawer();
  });
  document.addEventListener("keydown", (event) => {
    const drawer = $("#orderDetailDrawer");
    if (!drawer || drawer.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeOrderDetailDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = drawer.querySelector(".entity-drawer-panel");
    if (!panel) return;
    const focusable = clientsDetailFocusableEls(panel);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  // 구매일별 내역의 각 날짜 행 hover/focus 시 그 날짜만의 제품 popover를 보여준다(TASK5).
  document.addEventListener("pointerover", (event) => {
    const dateRow = event.target.closest("#clientsDetailModal [data-clients-detail-date]");
    if (!dateRow) return;
    showClientsDetailDatePopover(dateRow.dataset.clientsDetailDate, dateRow);
  });
  document.addEventListener("pointermove", (event) => {
    const dateRow = event.target.closest("#clientsDetailModal [data-clients-detail-date]");
    const popover = $("#clientsDetailDatePopover");
    if (dateRow && popover && !popover.hidden) positionClientsTooltip(dateRow, popover);
  });
  document.addEventListener("pointerout", (event) => {
    // 2026-07-17 최종 정정(TASK3): 날짜 행 -> popover 방향뿐 아니라 popover -> 바깥 방향으로
    // 마우스가 나갈 때도 닫히도록 양쪽을 모두 처리한다. popover는 #clientsDetailModal 밖(body
    // 직속)에 붙어 있어 기존 코드는 "popover에서 날짜 행이 아닌 곳으로 마우스가 나가는 경우"를
    // 전혀 감지하지 못해 popover가 계속 열려 있는 채로 남는 문제가 있었다.
    const dateRow = event.target.closest("#clientsDetailModal [data-clients-detail-date]");
    if (dateRow) {
      if (dateRow.contains(event.relatedTarget)) return;
      if (event.relatedTarget && event.relatedTarget.closest?.(".clients-detail-date-popover")) return;
      scheduleHideClientsDetailDatePopover();
      return;
    }
    const fromPopover = event.target.closest(".clients-detail-date-popover");
    if (fromPopover) {
      if (fromPopover.contains(event.relatedTarget)) return;
      if (event.relatedTarget && event.relatedTarget.closest?.("#clientsDetailModal [data-clients-detail-date]")) return;
      scheduleHideClientsDetailDatePopover();
    }
  });
  document.addEventListener("focusin", (event) => {
    const dateRow = event.target.closest("#clientsDetailModal [data-clients-detail-date]");
    if (dateRow) showClientsDetailDatePopover(dateRow.dataset.clientsDetailDate, dateRow);
  });
  document.addEventListener("focusout", (event) => {
    const dateRow = event.target.closest("#clientsDetailModal [data-clients-detail-date]");
    if (!dateRow || dateRow.contains(event.relatedTarget)) return;
    scheduleHideClientsDetailDatePopover();
  });
  window.addEventListener("scroll", () => hideClientsDetailDatePopover(), { passive: true, capture: true });
  // TOP10/도넛 범례 구매 제품·유형 호버. today-sales-calendar-tooltip과 동일하게 pointerover/
  // pointermove/pointerout(마우스) + focusin/focusout(키보드) 둘 다 바인딩한다. 2026-07-17 최종
  // 정정(TASK4) 이후 이 [data-clients-tooltip] 셀렉터는 도넛/범례 행에만 남아 있다(TOP10/목록은
  // [data-clients-detail]로 분리돼 클릭 모달을 쓴다) — 그래서 아래 hover 로직은 이제 "도넛의
  // 가벼운 비율 안내"에만 자연스럽게 적용된다. anchor를 벗어나도 바로 닫지 않고
  // scheduleHideClientsTooltip()으로 지연시킨 뒤, tooltip 자체로 마우스가 들어오면
  // cancelHideClientsTooltip()으로 취소한다 — 이렇게 해야 anchor와 tooltip 사이 gap을 지나갈 때
  // 깜빡이며 닫히지 않고, tooltip 위에서는 계속 열려 있는다.
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest("#Clients [data-clients-tooltip]");
    if (!target) return;
    showClientsTooltip(target);
  });
  document.addEventListener("pointermove", (event) => {
    const target = event.target.closest("#Clients [data-clients-tooltip]");
    const tooltip = $("#clientsHoverTooltip");
    if (target && tooltip && !tooltip.hidden) positionClientsTooltip(target, tooltip);
  });
  document.addEventListener("pointerout", (event) => {
    const target = event.target.closest("#Clients [data-clients-tooltip]");
    if (!target || target.contains(event.relatedTarget)) return;
    if (event.relatedTarget && event.relatedTarget.closest?.(".clients-hover-tooltip")) return;
    scheduleHideClientsTooltip();
  });
  document.addEventListener("focusin", (event) => {
    const target = event.target.closest("#Clients [data-clients-tooltip]");
    if (target) showClientsTooltip(target);
  });
  document.addEventListener("focusout", (event) => {
    const target = event.target.closest("#Clients [data-clients-tooltip]");
    if (!target || target.contains(event.relatedTarget)) return;
    scheduleHideClientsTooltip();
  });
  // Enter/Space로 열기(접근성 Task 8) — focusin에서 이미 열리지만, 탭 이동 없이 재확인하는
  // 브라우저/스크린리더 조합을 위해 명시적으로도 처리한다.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest("#Clients [data-clients-tooltip]");
    if (!target) return;
    event.preventDefault();
    showClientsTooltip(target);
  });
  // 스크롤하면 anchor가 화면상 다른 위치로 움직이는데(포인터는 그대로) fixed 위치 tooltip은
  // 따라가지 않아 엉뚱한 내용을 계속 보여주게 된다 — 스크롤 시작 시 그냥 닫는다.
  window.addEventListener("scroll", () => hideClientsTooltip(), { passive: true, capture: true });
  // tooltip 자체 위로 마우스가 올라와도 닫히지 않도록: 진입 시 예약된 닫기를 취소하고,
  // tooltip을 완전히 벗어나면(그리고 활성 anchor로 돌아간 게 아니면) 다시 닫기를 예약한다.
  document.addEventListener("pointerover", (event) => {
    if (event.target.closest(".clients-hover-tooltip")) cancelHideClientsTooltip();
  });
  document.addEventListener("pointerout", (event) => {
    const tooltipEl = event.target.closest(".clients-hover-tooltip");
    if (!tooltipEl || tooltipEl.contains(event.relatedTarget)) return;
    if (event.relatedTarget && event.relatedTarget.closest?.("#Clients [data-clients-tooltip]")) return;
    scheduleHideClientsTooltip();
  });
  // 도넛 조각 hover: 별도 DOM 슬라이스가 없는 단일 conic-gradient div라, 중심 기준 각도를 계산해
  // 어떤 유형 구간인지 판정한다(clientsDonutAngleToType). 범례 hover와 동일한 setActiveDonutType() +
  // showClientsTooltipForKey()를 그대로 재사용해 강조/툴팁 로직이 하나로 유지되게 한다.
  document.addEventListener("pointermove", (event) => {
    const donut = event.target.closest("#Clients .clients-donut");
    if (!donut) return;
    cancelHideClientsTooltip();
    const type = clientsDonutAngleToType(clientsDonutRanges, event, donut);
    if (type !== clientsDonutActiveType) {
      setActiveDonutType(type);
      if (type) showClientsTooltipForKey(`donut-${type}`, donut);
      else scheduleHideClientsTooltip();
    } else if (type) {
      const tooltip = $("#clientsHoverTooltip");
      if (tooltip && !tooltip.hidden) positionClientsTooltip(donut, tooltip);
    }
  });
  document.addEventListener("pointerout", (event) => {
    const donut = event.target.closest("#Clients .clients-donut");
    if (!donut || donut.contains(event.relatedTarget)) return;
    if (event.relatedTarget && event.relatedTarget.closest?.(".clients-hover-tooltip")) return;
    setActiveDonutType(null);
    scheduleHideClientsTooltip();
  });
  // 범례 행 hover는 위의 공용 pointerover/focusin 핸들러가 이미 tooltip을 열어주므로,
  // 여기서는 도넛 조각 강조만 동기화한다(같은 강조 상태를 공유 — Task 3/4 요건).
  document.addEventListener("pointerover", (event) => {
    const legendRow = event.target.closest("#Clients .clients-donut-legend li");
    if (legendRow?.dataset?.clientsType) setActiveDonutType(legendRow.dataset.clientsType);
  });
  document.addEventListener("focusin", (event) => {
    const legendRow = event.target.closest("#Clients .clients-donut-legend li");
    if (legendRow?.dataset?.clientsType) setActiveDonutType(legendRow.dataset.clientsType);
  });
  document.addEventListener("pointerout", (event) => {
    const legendRow = event.target.closest("#Clients .clients-donut-legend li");
    if (!legendRow || legendRow.contains(event.relatedTarget)) return;
    setActiveDonutType(null);
  });
  document.addEventListener("focusout", (event) => {
    const legendRow = event.target.closest("#Clients .clients-donut-legend li");
    if (!legendRow || legendRow.contains(event.relatedTarget)) return;
    setActiveDonutType(null);
  });
  // 모바일 등 hover가 없는 환경을 위한 최소 대응: 탭하면 열리고, 같은 항목을 다시 탭하거나
  // 다른 곳을 탭하면 닫힌다. 부모의 data-client-row 클릭(행 선택)은 그대로 함께 동작해도 무방하다.
  // tooltip 자신을 탭한 경우는 닫지 않는다(터치 환경에서 tooltip 안 내용을 보는 도중 닫히지 않게).
  document.addEventListener("click", (event) => {
    if (event.target.closest(".clients-hover-tooltip")) return;
    const target = event.target.closest("#Clients [data-clients-tooltip]");
    const tooltip = $("#clientsHoverTooltip");
    if (target) {
      if (tooltip && !tooltip.hidden && tooltip.dataset.activeKey === target.dataset.clientsTooltip) {
        hideClientsTooltip();
      } else {
        showClientsTooltip(target);
      }
      return;
    }
    if (tooltip && !tooltip.hidden) hideClientsTooltip();
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
    if (event.key === "Escape") {
      hideTodaySalesCalendarTooltip();
      hideClientsTooltip();
      hideCalendarTooltip();
      closeProductBrandOrderPopover();
    }
    if (event.key === "Enter" || event.key === " ") {
      const trendDetail = event.target.closest?.("[data-brand-trend-detail]");
      if (trendDetail) {
        event.preventDefault();
        showBrandTrendDetailPanel(trendDetail);
      }
      const annualMonthDetail = event.target.closest?.("[data-annual-brand-month-detail]");
      if (annualMonthDetail) {
        event.preventDefault();
        showAnnualBrandMonthDetail(annualMonthDetail.dataset.annualBrandMonthDetail || "");
      }
    }
  });
  document.addEventListener("click", (event) => {
    const brandPanel = $("#productBrandOrderPopover");
    if (
      !brandPanel ||
      brandPanel.hidden ||
      !/^(annual|trend):/.test(String(activeBrandOrderPopoverCode || "")) ||
      brandPanel.contains(event.target) ||
      event.target.closest?.("[data-annual-brand-detail], [data-brand-trend-detail]")
    ) return;
    closeProductBrandOrderPopover();
  }, true);
  // Calendar x Sales Heatmap Phase 1: 월 이동 버튼, 날짜 셀 hover/클릭, Day Overview 닫기 버튼.
  // Today 캘린더와 동일한 이벤트 패턴(pointerover/pointermove/pointerout + focusin/focusout +
  // click)을 그대로 재사용하되 셀렉터만 Calendar 전용(data-calendar-nav/data-calendar-day)으로 둔다.
  document.addEventListener("click", (event) => {
    const navButton = event.target.closest("[data-calendar-nav]");
    if (navButton) {
      const offset = Number(navButton.dataset.calendarNav || 0);
      if (Number.isFinite(offset) && offset !== 0) renderCalendarMonth(shiftCalendarMonth(calendarViewMonth, offset));
      return;
    }
    const closeButton = event.target.closest("[data-calendar-close]");
    if (closeButton) {
      closeCalendarDayOverview();
      return;
    }
    const dayCell = event.target.closest(".calendar-day-cell");
    if (dayCell && dayCell.dataset.nodata !== "1" && dayCell.dataset.calendarDay) {
      openCalendarDayOverview(dayCell.dataset.calendarDay);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const dayCell = event.target.closest?.(".calendar-day-cell");
    if (!dayCell || dayCell.dataset.nodata === "1" || !dayCell.dataset.calendarDay) return;
    event.preventDefault();
    openCalendarDayOverview(dayCell.dataset.calendarDay);
  });
  document.addEventListener("pointerover", (event) => {
    const cell = event.target.closest("#calendarGridContainer .calendar-day-cell");
    if (!cell || !cell.dataset.calendarDay) return;
    showCalendarTooltip(cell.dataset.calendarDay, cell);
  });
  document.addEventListener("pointermove", (event) => {
    const cell = event.target.closest("#calendarGridContainer .calendar-day-cell");
    const tooltip = $("#calendarTooltip");
    if (cell && tooltip && !tooltip.hidden) positionTodaySalesCalendarTooltip(cell, tooltip);
  });
  document.addEventListener("pointerout", (event) => {
    const cell = event.target.closest("#calendarGridContainer .calendar-day-cell");
    if (!cell || cell.contains(event.relatedTarget)) return;
    hideCalendarTooltip();
  });
  document.addEventListener("focusin", (event) => {
    const cell = event.target.closest("#calendarGridContainer .calendar-day-cell");
    if (cell && cell.dataset.calendarDay) showCalendarTooltip(cell.dataset.calendarDay, cell);
  });
  document.addEventListener("focusout", (event) => {
    const cell = event.target.closest("#calendarGridContainer .calendar-day-cell");
    if (!cell || cell.contains(event.relatedTarget)) return;
    hideCalendarTooltip();
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
    const brandDetail = event.target.closest("[data-annual-brand-detail]");
    if (brandDetail) return;
    const trendDetail = event.target.closest("[data-brand-trend-detail]");
    if (trendDetail) return;
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
    const brandDetail = event.target.closest("[data-annual-brand-detail]");
    if (brandDetail) return;
    const trendDetail = event.target.closest("[data-brand-trend-detail]");
    if (trendDetail) return;
    const bar = event.target.closest(".annual-flow-bar");
    if (!bar) return;
    const tooltip = bar.closest("#annualArchiveFlow")?.querySelector(".annual-flow-tooltip");
    if (tooltip && !tooltip.hidden) positionAnnualFlowTooltip(event, tooltip);
  });
  document.addEventListener("pointerout", (event) => {
    const brandDetail = event.target.closest("[data-annual-brand-detail]");
    if (brandDetail && !brandDetail.contains(event.relatedTarget)) return;
    const trendDetail = event.target.closest("[data-brand-trend-detail]");
    if (trendDetail && !trendDetail.contains(event.relatedTarget)) return;
    const bar = event.target.closest(".annual-flow-bar");
    if (!bar || bar.contains(event.relatedTarget)) return;
    const tooltip = bar.closest("#annualArchiveFlow")?.querySelector(".annual-flow-tooltip");
    if (!tooltip) return;
    tooltip.hidden = true;
    tooltip.classList.remove("is-visible");
  });
  document.addEventListener("focusin", (event) => {
    const brandDetail = event.target.closest("[data-annual-brand-detail]");
    if (brandDetail) return;
  });
  document.addEventListener("focusout", (event) => {
    const brandDetail = event.target.closest("[data-annual-brand-detail]");
    if (!brandDetail || brandDetail.contains(event.relatedTarget)) return;
  });
  document.addEventListener("click", (event) => {
    const trendDetail = event.target.closest("[data-brand-trend-detail]");
    if (trendDetail) {
      event.preventDefault();
      event.stopPropagation();
      showBrandTrendDetailPanel(trendDetail);
      return;
    }
    const annualMonthDetail = event.target.closest("[data-annual-brand-month-detail]");
    if (annualMonthDetail) {
      event.preventDefault();
      event.stopPropagation();
      showAnnualBrandMonthDetail(annualMonthDetail.dataset.annualBrandMonthDetail || "");
      return;
    }
    const annualSummaryBack = event.target.closest("[data-annual-brand-summary-back]");
    if (annualSummaryBack) {
      event.preventDefault();
      event.stopPropagation();
      replaceBrandPanelContent(annualArchiveBrandDetailPopoverHtml(annualBrandPerformanceRows, annualSummaryBack.dataset.annualBrandSummaryBack || ""));
      return;
    }
    const annualBrandDetail = event.target.closest("[data-annual-brand-detail]");
    if (annualBrandDetail) {
      event.preventDefault();
      event.stopPropagation();
      showAnnualBrandDetailPopover(annualBrandDetail);
      return;
    }
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
    const brandPanel = $("#productBrandOrderPopover");
    if (
      brandPanel &&
      !brandPanel.hidden &&
      /^(annual|trend):/.test(String(activeBrandOrderPopoverCode || "")) &&
      !brandPanel.contains(event.target)
    ) {
      closeProductBrandOrderPopover();
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
  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-inventory-intel-tab]");
    if (!tab) return;
    inventoryIntelState.activeTab = tab.dataset.inventoryIntelTab || "all";
    renderInventoryIntelTabs();
    renderInventoryIntelList();
  });
  $("#inventoryIntelSearch")?.addEventListener("input", (event) => {
    inventoryIntelFilters.search = event.target.value || "";
    renderInventoryIntelList();
  });
  $("#inventoryIntelBrandFilter")?.addEventListener("change", (event) => {
    inventoryIntelFilters.brand = event.target.value || "all";
    renderInventoryIntelList();
  });
  $("#inventoryIntelSortSelect")?.addEventListener("change", (event) => {
    inventoryIntelFilters.sort = event.target.value || "priority";
    renderInventoryIntelList();
  });
  document.addEventListener("click", (event) => {
    const card = event.target.closest("[data-inventory-intel-card]");
    if (!card) return;
    inventoryIntelState.selectedId = card.dataset.inventoryIntelCard || null;
    renderInventoryIntelList();
  });
  document.addEventListener("keydown", (event) => {
    const card = event.target.closest("[data-inventory-intel-card]");
    if (!card || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    inventoryIntelState.selectedId = card.dataset.inventoryIntelCard || null;
    renderInventoryIntelList();
  });
  document.addEventListener("click", (event) => {
    const priorityCard = event.target.closest("[data-inventory-intel-priority-jump]");
    if (!priorityCard) return;
    event.preventDefault();
    inventoryIntelState.selectedId = priorityCard.dataset.inventoryIntelPriorityJump || null;
    inventoryIntelState.activeTab = "all";
    inventoryIntelFilters.search = "";
    renderInventoryIntelTabs();
    renderInventoryIntelList();
    $("#inventoryIntelDetail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.addEventListener("click", (event) => {
    const goToRegistryBtn = event.target.closest("[data-inventory-intel-open-registry]");
    if (!goToRegistryBtn) return;
    event.preventDefault();
    const canonicalId = goToRegistryBtn.dataset.inventoryIntelOpenRegistry || null;
    const productName = goToRegistryBtn.dataset.inventoryIntelOpenRegistryName || "";
    if (canonicalId) productRegistryState.selectedId = canonicalId;
    setActiveView("ProductRegistry");
    setTimeout(() => {
      renderProductRegistryList();
      const selectedCard = document.querySelector(`[data-product-registry-card="${canonicalId}"]`);
      if (selectedCard) selectedCard.scrollIntoView({ behavior: "smooth", block: "center" });
      toast(productName ? `Product Registry에서 "${productName}"를 선택했습니다.` : "Product Registry로 이동했습니다.");
    }, 60);
  });
  $("#inventoryIntelReloadBtn")?.addEventListener("click", () => {
    renderInventoryIntelligenceView();
  });
  $("#inventoryIntelRerunBtn")?.addEventListener("click", () => {
    toast("재고 진단 재실행은 다음 Phase에서 제공됩니다.");
  });
  document.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-inventory-workspace-tab]");
    if (!tabButton) return;
    event.preventDefault();
    setInventoryWorkspaceTab(tabButton.dataset.inventoryWorkspaceTab);
  });
  $("#inventoryOverviewReloadBtn")?.addEventListener("click", () => {
    if (inventoryWorkspaceTab !== "store") setInventoryWorkspaceTab("store");
    else renderInventoryOverviewView();
  });
  $("#inventoryOverviewThresholdInput")?.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    inventoryOverviewFilters.lowStockThreshold = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 3;
    inventoryOverviewPage.offset = 0;
    renderInventoryOverviewView();
  });
  $("#inventoryOverviewSearch")?.addEventListener("input", (event) => {
    const value = event.target.value || "";
    clearTimeout(inventoryOverviewSearchDebounceTimer);
    inventoryOverviewSearchDebounceTimer = setTimeout(() => {
      inventoryOverviewFilters.search = value;
      inventoryOverviewPage.offset = 0;
      renderInventoryOverviewView();
    }, 300);
  });
  $("#inventoryOverviewBrandFilter")?.addEventListener("change", (event) => {
    inventoryOverviewFilters.brand = event.target.value || "all";
    inventoryOverviewPage.offset = 0;
    renderInventoryOverviewView();
  });
  $("#inventoryOverviewStatusFilter")?.addEventListener("change", (event) => {
    inventoryOverviewFilters.status = event.target.value || "all";
    inventoryOverviewPage.offset = 0;
    renderInventoryOverviewView();
  });
  $("#inventoryOverviewSortSelect")?.addEventListener("change", (event) => {
    inventoryOverviewFilters.sort = event.target.value || "priority";
    inventoryOverviewPage.offset = 0;
    renderInventoryOverviewView();
  });
  document.addEventListener("click", (event) => {
    const brandRow = event.target.closest("[data-inventory-overview-brand-jump]");
    if (!brandRow) return;
    event.preventDefault();
    inventoryOverviewFilters.brand = brandRow.dataset.inventoryOverviewBrandJump || "all";
    inventoryOverviewPage.offset = 0;
    const brandSelect = $("#inventoryOverviewBrandFilter");
    if (brandSelect) brandSelect.value = inventoryOverviewFilters.brand;
    if (inventoryWorkspaceTab !== "store") setInventoryWorkspaceTab("store");
    else renderInventoryOverviewView();
    $("#inventoryOverviewItemRows")?.closest(".section-block")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.addEventListener("click", (event) => {
    const pageBtn = event.target.closest("[data-inventory-overview-page]");
    if (!pageBtn) return;
    event.preventDefault();
    const direction = pageBtn.dataset.inventoryOverviewPage;
    if (direction === "prev") inventoryOverviewPage.offset = Math.max(0, inventoryOverviewPage.offset - inventoryOverviewPage.limit);
    if (direction === "next") inventoryOverviewPage.offset += inventoryOverviewPage.limit;
    renderInventoryOverviewView();
  });
  // Meta Product Performance · Phase 1: 상품 행 클릭 → accordion으로 상세 펼치기/접기.
  document.addEventListener("click", (event) => {
    const row = event.target.closest("[data-meta-product-toggle]");
    if (!row) return;
    toggleMetaProductPerformanceRow(row.dataset.metaProductToggle || "");
  });
  // Marketing Analytics Phase 2: Brand Contribution 행 클릭 → 위 Meta Product
  // Performance 표를 해당 브랜드로 필터링(다시 클릭하면 해제). 필터 배너의 "필터 해제"
  // 버튼으로도 해제할 수 있다.
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
  document.addEventListener("mouseover", (event) => {
    const trigger = event.target.closest("[data-brand-order-history]");
    if (trigger) showProductBrandOrderPopover(trigger);
  });
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-brand-order-history]");
    const popover = $("#productBrandOrderPopover");
    if (event.target.closest("[data-brand-trend-detail], [data-annual-brand-detail], [data-annual-brand-month-detail], [data-annual-brand-summary-back]")) return;
    if (event.target.closest("[data-brand-panel-close]")) {
      closeProductBrandOrderPopover();
      return;
    }
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
    renderBetaFreshnessBadge("productRegistryFreshnessHeader", {
      lastUpdated: registryResp.registry?.generatedAt,
      note: "Phase 1 진단 전용 화면입니다. 승인/저장 기능이 없어 운영 데이터로 사용하지 않습니다."
    });
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

// ---------------------------------------------------------------------------
// Inventory Intelligence (Phase 2B) — Read Only.
// scripts/diagnose-inventory-reconciliation.mjs가 생성한 work/inventory-intelligence-
// candidates.json을 intelligence-service.mjs의 /api/inventory/intelligence/health를 통해
// 읽기만 한다. 이 화면은 재고를 직접 수정하지 않는다.
// ---------------------------------------------------------------------------

function inventoryIntelPercent(numerator, denominator) {
  if (!denominator) return "-";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

const INVENTORY_INTEL_STATUS_META = {
  exact_match: { label: "Exact", tone: "good" },
  near_match: { label: "Near", tone: "informational" },
  mismatch: { label: "Mismatch", tone: "urgent" },
  one_source_missing: { label: "ECOUNT 재고값 누락", tone: "neutral" },
  invalid_data: { label: "Invalid", tone: "urgent" }
};

function inventoryIntelStatusMeta(status) {
  return INVENTORY_INTEL_STATUS_META[status] || { label: status || "-", tone: "neutral" };
}

const INVENTORY_INTEL_FLAG_LABELS = {
  multiple_cafe24_variants: "복수 Cafe24 옵션",
  multiple_ecount_sizes: "복수 ECOUNT 사이즈",
  cafe24_from_fallback_cache: "Cafe24 fallback 캐시 사용",
  missing_ecount_item: "ECOUNT 품목 누락",
  missing_cafe24_product: "Cafe24 상품 누락",
  ecount_stock_partial_or_full_null: "ECOUNT 재고값 누락",
  negative_ecount_stock: "ECOUNT 음수 재고",
  negative_cafe24_stock: "Cafe24 음수 재고",
  qqq_product: "QQQ(브랜드 직송)",
  consignment_product: "CON 위탁",
  verified_without_ecount_prodcd: "ECOUNT 연결 없음"
};

const INVENTORY_INTEL_TABS = [
  { key: "all", label: "전체" },
  { key: "exact_match", label: "Exact" },
  { key: "near_match", label: "Near" },
  { key: "mismatch", label: "Mismatch" },
  { key: "one_source_missing", label: "ECOUNT 재고 누락" },
  { key: "invalid_data", label: "Invalid" }
];

function inventoryIntelPriorityRank(item) {
  if (item.status === "invalid_data") return 0;
  if (item.status === "mismatch") return 1;
  if (item.status === "one_source_missing") return 2;
  if (item.hasDuplicateFlag || (item.flags || []).some((flag) => flag.includes("negative"))) return 3;
  return 4;
}

function inventoryIntelRecommendedCheck(item) {
  if (item.status === "mismatch") return "Cafe24 옵션 재고 및 ECOUNT 실재고를 확인하세요.";
  if (item.status === "one_source_missing") return "ECOUNT 재고 조회 응답 또는 API 수집 상태를 확인하세요.";
  if (item.status === "invalid_data") return "연결 정보 또는 수치 데이터를 확인하세요.";
  if (item.hasDuplicateFlag) return "동일 코드가 여러 Canonical Product에 연결되어 있는지 확인하세요.";
  if ((item.flags || []).some((flag) => flag.includes("negative"))) return "음수 재고 데이터를 ECOUNT/Cafe24 원본에서 확인하세요.";
  if (item.status === "near_match") return "2개 이하 또는 10% 이하의 차이입니다.";
  return "두 시스템 재고가 일치합니다.";
}

function inventoryIntelIssueType(item) {
  if (item.status === "mismatch") return "재고 불일치";
  if (item.status === "one_source_missing") return "ECOUNT 재고 누락";
  if (item.status === "invalid_data") return "데이터 오류";
  if (item.hasDuplicateFlag) return "중복 연결";
  if ((item.flags || []).some((flag) => flag.includes("negative"))) return "음수 재고";
  return "정상";
}

function inventoryIntelBuildItems(raw) {
  const conflicts = raw?.conflicts || {};
  const duplicateIds = new Set([
    ...(conflicts.duplicateEcountProdCdsAffectingVerified || []).flatMap((entry) => entry.canonicalProductIds || []),
    ...(conflicts.duplicateCafe24ProductsAffectingVerified || []).flatMap((entry) => entry.canonicalProductIds || [])
  ]);
  return (raw?.items || []).map((item) => {
    const flags = item.flags || [];
    const hasDuplicateFlag = duplicateIds.has(item.canonicalProductId);
    const searchText = [
      item.canonicalBrandName,
      item.canonicalProductName,
      item.cafe24?.cafe24ProductNo,
      item.cafe24?.cafe24ProductCode,
      ...(item.ecount?.ecountProdCds || []),
      ...(item.ecount?.ecountItems || []).map((row) => row.barcode)
    ].filter(Boolean).join(" ").toLowerCase();
    const enriched = { ...item, flags, hasDuplicateFlag, searchText };
    enriched.priorityRank = inventoryIntelPriorityRank(enriched);
    return enriched;
  });
}

function inventoryIntelMatchesFilters(item) {
  const tab = inventoryIntelState.activeTab || "all";
  if (tab !== "all" && item.status !== tab) return false;
  const brand = inventoryIntelFilters.brand || "all";
  if (brand !== "all" && item.canonicalBrandName !== brand) return false;
  const search = (inventoryIntelFilters.search || "").trim().toLowerCase();
  if (search && !item.searchText.includes(search)) return false;
  return true;
}

function inventoryIntelSortItems(items) {
  const sorted = [...items];
  const sortMode = inventoryIntelFilters.sort || "priority";
  if (sortMode === "diff-desc") {
    sorted.sort((a, b) => (b.comparison?.absoluteDifference ?? -1) - (a.comparison?.absoluteDifference ?? -1));
  } else if (sortMode === "status") {
    sorted.sort((a, b) => a.priorityRank - b.priorityRank || (a.canonicalBrandName || "").localeCompare(b.canonicalBrandName || ""));
  } else {
    sorted.sort((a, b) => {
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
      return (b.comparison?.absoluteDifference ?? -1) - (a.comparison?.absoluteDifference ?? -1);
    });
  }
  return sorted;
}

function renderInventoryIntelSummaryCards(raw) {
  const target = $("#inventoryIntelSummaryCards");
  if (!target) return;
  const summary = raw?.summary || {};
  const meta = raw?.meta || {};
  const validCompared = (summary.exactMatchCount || 0) + (summary.nearMatchCount || 0) + (summary.mismatchCount || 0);
  const reconciled = (summary.exactMatchCount || 0) + (summary.nearMatchCount || 0);
  const verifiedCount = meta.verifiedEntryCount || 0;
  const registryCount = meta.registryEntryCount || 0;
  const needsAttention = (summary.mismatchCount || 0) + (summary.oneSourceMissingCount || 0);
  const cards = [
    { label: "Inventory Match", value: inventoryIntelPercent(reconciled, validCompared), sub: `${apiNum(reconciled)} / ${apiNum(validCompared)} products`, tone: "good" },
    { label: "Comparison Coverage", value: inventoryIntelPercent(validCompared, verifiedCount), sub: `${apiNum(validCompared)} / ${apiNum(verifiedCount)} products`, tone: "informational" },
    { label: "Product Registry Coverage", value: inventoryIntelPercent(verifiedCount, registryCount), sub: `${apiNum(verifiedCount)} / ${apiNum(registryCount)} products`, tone: "neutral" },
    { label: "Needs Attention", value: apiNum(needsAttention), sub: `mismatch ${apiNum(summary.mismatchCount || 0)} + missing ${apiNum(summary.oneSourceMissingCount || 0)}`, tone: needsAttention > 0 ? "urgent" : "good" }
  ];
  target.innerHTML = cards.map((card) => (
    `<div class="action-item sales-kpi-card ${card.tone}"><span>${esc(card.label)}</span><strong>${esc(card.value)}</strong><small>${esc(card.sub)}</small></div>`
  )).join("");
}

function renderInventoryIntelStatusBreakdown(summary) {
  const target = $("#inventoryIntelStatusBreakdown");
  if (!target) return;
  const rows = [
    { key: "exact_match", count: summary.exactMatchCount || 0 },
    { key: "near_match", count: summary.nearMatchCount || 0 },
    { key: "mismatch", count: summary.mismatchCount || 0 },
    { key: "one_source_missing", count: summary.oneSourceMissingCount || 0 },
    { key: "invalid_data", count: summary.invalidDataCount || 0 }
  ];
  const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;
  const bar = rows.map((row) => {
    if (!row.count) return "";
    const meta = inventoryIntelStatusMeta(row.key);
    const width = ((row.count / total) * 100).toFixed(2);
    return `<span class="inventory-intel-stack-seg ${meta.tone}" style="width:${width}%" title="${esc(meta.label)} ${row.count}"></span>`;
  }).join("");
  const legend = rows.map((row) => {
    const meta = inventoryIntelStatusMeta(row.key);
    const desc = row.key === "one_source_missing" ? "품목 연결은 존재하지만 stockQuantity가 제공되지 않았습니다." : "";
    return `<div class="inventory-intel-legend-item ${meta.tone}"><span class="inventory-intel-dot"></span><strong>${esc(meta.label)}</strong><b>${apiNum(row.count)}</b>${desc ? `<small>${esc(desc)}</small>` : ""}</div>`;
  }).join("");
  target.innerHTML = `<div class="inventory-intel-stack-bar">${bar}</div><div class="inventory-intel-legend">${legend}</div>`;
}

function renderInventoryIntelCoverageBars(raw) {
  const target = $("#inventoryIntelCoverageBars");
  if (!target) return;
  const summary = raw?.summary || {};
  const meta = raw?.meta || {};
  const validCompared = (summary.exactMatchCount || 0) + (summary.nearMatchCount || 0) + (summary.mismatchCount || 0);
  const reconciled = (summary.exactMatchCount || 0) + (summary.nearMatchCount || 0);
  const rows = [
    { label: "Product Registry Verified", num: meta.verifiedEntryCount || 0, den: meta.registryEntryCount || 0, desc: "Cafe24와 ECOUNT 상품 연결이 확인된 비율" },
    { label: "Inventory Comparable", num: validCompared, den: meta.verifiedEntryCount || 0, desc: "양쪽 재고 숫자가 모두 존재하는 비율" },
    { label: "Reconciled Among Comparable", num: reconciled, den: validCompared, desc: "비교 가능한 상품 중 Exact 또는 Near인 비율" }
  ];
  target.innerHTML = rows.map((row) => {
    const pct = row.den ? (row.num / row.den) * 100 : 0;
    return `<div class="inventory-intel-coverage-bar">
      <div class="inventory-intel-coverage-bar-head"><span>${esc(row.label)}</span><strong>${apiNum(row.num)} / ${apiNum(row.den)} (${pct.toFixed(1)}%)</strong></div>
      <div class="inventory-intel-coverage-bar-track"><div class="inventory-intel-coverage-bar-fill" style="width:${Math.min(100, pct).toFixed(2)}%"></div></div>
      <p class="inventory-intel-coverage-bar-desc">${esc(row.desc)}</p>
    </div>`;
  }).join("");
}

function renderInventoryIntelPriorityIssues(items) {
  const target = $("#inventoryIntelPriorityList");
  if (!target) return;
  const issues = items
    .filter((item) => item.priorityRank <= 3)
    .sort((a, b) => {
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
      return (b.comparison?.absoluteDifference ?? -1) - (a.comparison?.absoluteDifference ?? -1);
    })
    .slice(0, 20);
  if (!issues.length) {
    target.innerHTML = `<div class="sales-empty-card"><strong>확인이 필요한 데이터가 없습니다.</strong></div>`;
    return;
  }
  target.innerHTML = issues.map((item) => {
    const meta = inventoryIntelStatusMeta(item.status);
    const cafe24Stock = item.cafe24?.cafe24InventoryQuantity;
    const ecountStock = item.ecount?.ecountStockQuantity;
    const diff = item.comparison?.difference;
    const priorityLabel = item.priorityRank <= 1 ? 1 : item.priorityRank === 2 ? 2 : 3;
    return `<article class="action-item inventory-intel-priority-card ${meta.tone}">
      <div class="inventory-intel-priority-head">
        <span class="inventory-intel-priority-rank">Priority ${priorityLabel}</span>
        <span>${esc(item.canonicalBrandName || "-")}</span>
      </div>
      <strong>${esc(item.canonicalProductName || "-")}</strong>
      <div class="inventory-intel-priority-meta">
        <span>${esc(inventoryIntelIssueType(item))}</span>
        <span>Cafe24 ${cafe24Stock ?? "-"}</span>
        <span>ECOUNT ${ecountStock ?? "-"}</span>
        <span>Diff ${diff ?? "-"}</span>
      </div>
      <p class="inventory-intel-priority-desc">${esc(inventoryIntelRecommendedCheck(item))}</p>
      <button type="button" class="today-jump-button" data-inventory-intel-priority-jump="${esc(item.canonicalProductId)}">상세 보기</button>
    </article>`;
  }).join("");
}

function renderInventoryIntelTabs() {
  const target = $("#inventoryIntelTabs");
  if (!target) return;
  const items = inventoryIntelState.items || [];
  target.innerHTML = INVENTORY_INTEL_TABS.map((tab) => {
    const count = tab.key === "all" ? items.length : items.filter((item) => item.status === tab.key).length;
    return `<button type="button" class="product-action-filter ${inventoryIntelState.activeTab === tab.key ? "active" : ""}" data-inventory-intel-tab="${tab.key}">${esc(tab.label)} (${apiNum(count)})</button>`;
  }).join("");
}

function renderInventoryIntelFilterOptions(items) {
  const brandSelect = $("#inventoryIntelBrandFilter");
  if (!brandSelect) return;
  const brands = [...new Set(items.map((item) => item.canonicalBrandName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const current = inventoryIntelFilters.brand || "all";
  brandSelect.innerHTML = [`<option value="all">브랜드 전체</option>`, ...brands.map((brand) => `<option value="${esc(brand)}">${esc(brand)}</option>`)].join("");
  brandSelect.value = brands.includes(current) ? current : "all";
  inventoryIntelFilters.brand = brandSelect.value;
}

function inventoryIntelListCardHtml(item) {
  const meta = inventoryIntelStatusMeta(item.status);
  const selected = inventoryIntelState.selectedId === item.canonicalProductId ? " is-selected" : "";
  const cafe24Stock = item.cafe24?.cafe24InventoryQuantity;
  const ecountStock = item.ecount?.ecountStockQuantity;
  const diff = item.comparison?.difference;
  return `<article class="product-registry-card inventory-intel-card${selected}" tabindex="0" role="button" data-inventory-intel-card="${esc(item.canonicalProductId)}">
    <div class="product-registry-card-head">
      <div><span class="product-registry-brand">${esc(item.canonicalBrandName || "-")}</span><strong>${esc(item.canonicalProductName || "-")}</strong></div>
      <span class="inventory-intel-status-pill ${meta.tone}">${esc(meta.label)}</span>
    </div>
    <div class="product-registry-row-meta">
      <span>Cafe24 ${cafe24Stock ?? "-"}</span>
      <span>ECOUNT ${ecountStock ?? "-"}</span>
      <span>Diff ${diff ?? "-"}</span>
    </div>
  </article>`;
}

function renderInventoryIntelList() {
  const listTarget = $("#inventoryIntelList");
  const emptyTarget = $("#inventoryIntelEmpty");
  if (!listTarget) return;
  const filtered = inventoryIntelSortItems((inventoryIntelState.items || []).filter(inventoryIntelMatchesFilters));
  if (!filtered.some((item) => item.canonicalProductId === inventoryIntelState.selectedId)) {
    inventoryIntelState.selectedId = filtered[0]?.canonicalProductId || null;
  }
  listTarget.innerHTML = filtered.map(inventoryIntelListCardHtml).join("");
  if (emptyTarget) emptyTarget.hidden = filtered.length > 0;
  renderInventoryIntelDetail();
}

function renderInventoryIntelDetail() {
  const target = $("#inventoryIntelDetail");
  if (!target) return;
  const item = (inventoryIntelState.items || []).find((row) => row.canonicalProductId === inventoryIntelState.selectedId);
  if (!item) {
    target.innerHTML = `<div class="sales-empty-card"><strong>선택된 상품이 없습니다.</strong></div>`;
    return;
  }
  const meta = inventoryIntelStatusMeta(item.status);
  const cafe24 = item.cafe24 || {};
  const ecount = item.ecount || {};
  const comparison = item.comparison || {};
  const variantsHtml = (cafe24.cafe24Variants || []).length
    ? cafe24.cafe24Variants.map((v) => `<li class="product-registry-candidate-row"><strong>${esc(v.variantCode || "-")}</strong><span>${esc(v.optionName || "-")}</span><span>수량 ${v.quantity ?? "-"}</span></li>`).join("")
    : `<li class="product-registry-candidate-row is-empty"><strong>옵션 정보가 없습니다.</strong></li>`;
  const ecountItemsHtml = (ecount.ecountItems || []).length
    ? ecount.ecountItems.map((row) => `<li class="product-registry-candidate-row"><strong>${esc(row.prodCd || "-")}</strong><span>${esc(row.productName || "-")}</span><span>사이즈 ${esc(row.size || "-")}</span><span>재고 ${row.stockQuantity ?? "누락"}</span></li>`).join("")
    : `<li class="product-registry-candidate-row is-empty"><strong>연결된 ECOUNT 품목이 없습니다.</strong></li>`;
  const flagsHtml = (item.flags || []).length
    ? item.flags.map((flag) => `<span>${esc(INVENTORY_INTEL_FLAG_LABELS[flag] || flag)}</span>`).join("")
    : `<span>없음</span>`;
  target.innerHTML = `
    <div class="product-registry-detail-head">
      <div><span class="product-registry-brand">${esc(item.canonicalBrandName || "-")}</span><h3>${esc(item.canonicalProductName || "-")}</h3></div>
      <span class="inventory-intel-status-pill ${meta.tone}">${esc(meta.label)}</span>
    </div>
    <div class="product-registry-detail-section">
      <p class="hint-text">canonicalProductId: ${esc(item.canonicalProductId || "-")} · Cafe24 productNo ${esc(cafe24.cafe24ProductNo || "-")} / productCode ${esc(cafe24.cafe24ProductCode || "-")} · ECOUNT PROD_CD ${esc((ecount.ecountProdCds || []).join(", ") || "-")}</p>
    </div>
    <div class="clients-tooltip-stats clients-detail-stats-grid product-registry-detail-kpis">
      <div><span>Cafe24 재고</span><strong>${cafe24.cafe24InventoryQuantity ?? "-"}</strong></div>
      <div><span>ECOUNT 재고</span><strong>${ecount.ecountStockQuantity ?? "-"}</strong></div>
      <div><span>차이</span><strong>${comparison.difference ?? "-"}</strong></div>
      <div><span>차이 비율</span><strong>${comparison.differenceRate != null ? (comparison.differenceRate * 100).toFixed(1) + "%" : "-"}</strong></div>
    </div>
    <div class="product-registry-detail-section">
      <h4>Cafe24 Variants</h4>
      <ul class="product-registry-candidate-list">${variantsHtml}</ul>
    </div>
    <div class="product-registry-detail-section">
      <h4>ECOUNT Items</h4>
      <ul class="product-registry-candidate-list">${ecountItemsHtml}</ul>
    </div>
    <div class="product-registry-detail-section">
      <h4>Flags</h4>
      <div class="product-registry-diags">${flagsHtml}</div>
    </div>
    <div class="product-registry-detail-section">
      <p class="inventory-intel-recommend"><strong>권장 확인:</strong> ${esc(inventoryIntelRecommendedCheck(item))}</p>
    </div>
    <div class="product-registry-detail-section">
      <button type="button" class="today-jump-button" data-inventory-intel-open-registry="${esc(item.canonicalProductId)}" data-inventory-intel-open-registry-name="${esc(item.canonicalProductName || "")}">Product Registry에서 보기</button>
    </div>
  `;
}

function renderInventoryIntelDiagnosticMeta(raw) {
  const target = $("#inventoryIntelDiagnosticMeta");
  if (!target) return;
  const meta = raw?.meta || {};
  const cafe24Source = meta.cafe24Source || {};
  const primary = cafe24Source.primary || {};
  const rows = [
    ["ECOUNT source", meta.ecountPath || "-"],
    ["Cafe24 source", primary.file || "-"],
    ["Cafe24 source 선택 규칙", cafe24Source.selectionRule || cafe24Source.mode || "-"],
    ["임계값(절대)", meta.thresholds?.nearMatchAbsoluteUnits ?? "-"],
    ["임계값(비율)", meta.thresholds?.nearMatchRate != null ? `${(meta.thresholds.nearMatchRate * 100).toFixed(0)}%` : "-"],
    ["schemaVersion", raw?.schemaVersion ?? "-"],
    ["mode", raw?.mode || "-"]
  ];
  target.innerHTML = rows.map(([label, value]) => `<div class="inventory-intel-meta-row"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`).join("");
}

function inventoryIntelIsStale(generatedAt) {
  if (!generatedAt) return false;
  const ts = new Date(generatedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > 48 * 60 * 60 * 1000;
}

function inventoryIntelClearPanels() {
  ["#inventoryIntelMeta", "#inventoryIntelSummaryCards", "#inventoryIntelStatusBreakdown", "#inventoryIntelCoverageBars", "#inventoryIntelPriorityList", "#inventoryIntelTabs", "#inventoryIntelList", "#inventoryIntelDetail", "#inventoryIntelDiagnosticMeta"].forEach((selector) => {
    const node = $(selector);
    if (node) node.innerHTML = "";
  });
}

async function renderInventoryIntelligenceView() {
  const seq = ++inventoryIntelRenderSeq;
  const status = $("#inventoryIntelStatus");
  const staleBanner = $("#inventoryIntelStaleBanner");
  if (status) {
    status.className = "ad-status-banner loading";
    status.textContent = "Inventory Intelligence 로딩 중...";
  }
  if (staleBanner) staleBanner.hidden = true;
  try {
    const resp = await getJson(intelligenceUrl("/api/inventory/intelligence/health"), 12000);
    if (seq !== inventoryIntelRenderSeq) return;
    if (resp.error) throw new Error(resp.message || resp.error);
    if (resp.ok === false) throw new Error(resp.message || "Inventory Intelligence 데이터를 불러오지 못했습니다.");
    if (resp.available === false) {
      if (status) {
        status.className = "ad-status-banner warn";
        status.textContent = "진단 데이터가 아직 없습니다. Phase 2A 진단(scripts/diagnose-inventory-reconciliation.mjs)을 먼저 실행해야 합니다.";
      }
      inventoryIntelClearPanels();
      return;
    }
    inventoryIntelState.raw = resp;
    inventoryIntelState.items = inventoryIntelBuildItems(resp);
    if (!inventoryIntelState.activeTab) inventoryIntelState.activeTab = "all";

    const itemCount = inventoryIntelState.items.length;
    if (status) {
      status.className = "ad-status-banner good";
      status.textContent = itemCount ? `Read-only · 비교 대상 ${apiNum(itemCount)}개` : "비교 가능한 상품이 아직 없습니다.";
    }
    renderBetaFreshnessBadge("inventoryIntelFreshnessHeader", {
      lastUpdated: resp.generatedAt,
      note: "Diagnostic Only 화면입니다. 재고를 직접 수정하지 않으며 운영 판단의 최종 근거로 사용하지 않습니다."
    });
    const metaTarget = $("#inventoryIntelMeta");
    if (metaTarget) {
      const cafe24Source = resp.meta?.cafe24Source?.primary?.file || "-";
      const ecountSource = resp.meta?.ecountPath || "-";
      metaTarget.innerHTML = `
        <span>마지막 생성 ${resp.generatedAt ? new Date(resp.generatedAt).toLocaleString("ko-KR") : "-"}</span>
        <span>ECOUNT source: ${esc(ecountSource)}</span>
        <span>Cafe24 source: ${esc(cafe24Source)}</span>
      `;
    }
    if (staleBanner) staleBanner.hidden = !inventoryIntelIsStale(resp.generatedAt);

    renderInventoryIntelSummaryCards(resp);
    renderInventoryIntelStatusBreakdown(resp.summary || {});
    renderInventoryIntelCoverageBars(resp);
    renderInventoryIntelPriorityIssues(inventoryIntelState.items);
    renderInventoryIntelTabs();
    renderInventoryIntelFilterOptions(inventoryIntelState.items);
    renderInventoryIntelList();
    renderInventoryIntelDiagnosticMeta(resp);
  } catch (error) {
    if (seq !== inventoryIntelRenderSeq) return;
    if (status) {
      status.className = "ad-status-banner urgent";
      status.textContent = `Inventory Intelligence를 불러오지 못했습니다. ${error.message || ""}`;
    }
    $("#inventoryIntelList") && ($("#inventoryIntelList").innerHTML = "");
    $("#inventoryIntelDetail") && ($("#inventoryIntelDetail").innerHTML = `<div class="sales-empty-card"><strong>오류</strong><p>${esc(error.message || "데이터 로딩 실패")}</p></div>`);
  }
}

// ---------------------------------------------------------------------------
// Inventory Overview (Phase 3A) — 실제 매장 운영 재고 화면.
// intelligence-service.mjs의 GET /api/inventory/overview만 읽는다(Read Only).
// ECOUNT stockQuantity만을 유일한 재고 기준으로 사용하며, Cafe24 재고는 이 화면의 어떤
// 계산에도 쓰지 않는다("최근 판매량"은 ECOUNT 오프라인 매출 기준으로 서버에서 이미 계산되어 온다).
// Inventory Intelligence(데이터 품질 진단, Phase 2A/2B)와는 역할이 다른 별개 화면이다.
// ---------------------------------------------------------------------------

// Phase 3A-2: SAMPLAS는 시즌 상품 위주 매장이라 재고 0을 "품절 오류"로 취급하지 않는다.
// 일반 상품과 QQQ(미등록 외부 판매/임시 상품)의 상태값은 서로 다른 의미이므로 라벨/톤도 분리한다.
// 재사용: .inventory-intel-status-pill의 기존 tone 클래스(good/informational/urgent/neutral)만 사용한다.
const INVENTORY_OVERVIEW_STATUS_META = {
  in_stock: { label: "재고 있음", tone: "good" },
  depleted_candidate: { label: "재고 소진(완판 후보)", tone: "neutral" },
  negative_review: { label: "음수 확인 필요", tone: "urgent" },
  unknown: { label: "재고 미수신", tone: "neutral" },
  qqq_remaining: { label: "QQQ 잔여", tone: "informational" },
  qqq_depleted_record: { label: "QQQ 소진 기록", tone: "neutral" },
  qqq_estimated_sale: { label: "QQQ 판매 추정", tone: "informational" },
  qqq_unknown: { label: "QQQ 데이터 미수신", tone: "neutral" }
};
const INVENTORY_OVERVIEW_PRODUCT_TYPE_LABELS = { general: "일반", qqq: "QQQ", admin_code: "관리코드" };
const INVENTORY_OVERVIEW_LOCATION_DISPLAY_NAMES = { STORE_1: "현 매장", OFFSITE: "3PL", UNKNOWN: "확인 불가" };

function renderInventoryWorkspaceTabs() {
  $$('[data-inventory-workspace-tab]').forEach((button) => {
    const active = button.dataset.inventoryWorkspaceTab === inventoryWorkspaceTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function renderInventoryWorkspacePanels() {
  $$('[data-inventory-workspace-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.inventoryWorkspacePanel !== inventoryWorkspaceTab;
  });
  if (inventoryWorkspaceTab === "store") renderInventoryOverviewView();
}

function setInventoryWorkspaceTab(tab) {
  inventoryWorkspaceTab = inventoryWorkspaceTabs.has(tab) ? tab : "today";
  renderInventoryWorkspaceTabs();
  renderInventoryWorkspacePanels();
}

function renderInventoryWorkspaceView(options = {}) {
  if (options.reset) inventoryWorkspaceTab = "today";
  setInventoryWorkspaceTab(inventoryWorkspaceTab);
}

function inventoryOverviewStatusMeta(status) {
  return INVENTORY_OVERVIEW_STATUS_META[status] || { label: status || "-", tone: "neutral" };
}

function inventoryOverviewLocationValueLabel(value) {
  // null(확인 불가)과 0(재고 없음 확인됨)을 절대 같은 표기로 섞지 않는다.
  if (value === null || value === undefined) return "확인 불가";
  return apiNum(value);
}

function inventoryOverviewQueryUrl() {
  const params = new URLSearchParams();
  params.set("lowStockThreshold", String(inventoryOverviewFilters.lowStockThreshold ?? 3));
  if (inventoryOverviewFilters.brand && inventoryOverviewFilters.brand !== "all") params.set("brand", inventoryOverviewFilters.brand);
  if (inventoryOverviewFilters.status && inventoryOverviewFilters.status !== "all") params.set("status", inventoryOverviewFilters.status);
  if (inventoryOverviewFilters.search) params.set("search", inventoryOverviewFilters.search);
  if (inventoryOverviewFilters.sort) params.set("sort", inventoryOverviewFilters.sort);
  params.set("limit", String(inventoryOverviewPage.limit));
  params.set("offset", String(inventoryOverviewPage.offset));
  return intelligenceUrl(`/api/inventory/overview?${params.toString()}`);
}

function renderInventoryOverviewSummaryCards(resp) {
  const target = $("#inventoryOverviewSummaryCards");
  if (!target) return;
  const summary = resp.summary || {};
  // Section 5 권장 KPI 7종. Low Stock은 핵심 KPI에서 제거하고 카드 2번 아래 보조 문구로만 노출한다.
  const cards = [
    { label: "확인 가능한 총 잔여 재고", value: apiNum(summary.totalKnownStock), sub: "재고 있음(in_stock) 상품 합계", tone: "" },
    { label: "재고 보유 SKU", value: apiNum(summary.inStockSkuCount), sub: `참고: Low Stock 후보 ${apiNum(summary.lowStockCandidateCount)}건(발주 신호 아님)`, tone: "good" },
    { label: "재고 소진 SKU", value: apiNum(summary.depletedSkuCount), sub: "품절 오류 아님 · 완판 후보", tone: "neutral" },
    { label: "일반 상품 음수 재고 확인 필요", value: apiNum(summary.negativeReviewSkuCount), sub: "QQQ 음수와 별도 집계", tone: (summary.negativeReviewSkuCount || 0) > 0 ? "urgent" : "good" },
    { label: "재고 미수신 SKU", value: apiNum(summary.unknownStockSkuCount), sub: "stockQuantity가 null인 상품", tone: "neutral" },
    { label: "QQQ 판매 추정 수량", value: apiNum(summary.qqqEstimatedSoldQuantity), sub: `QQQ 판매 기록 SKU ${apiNum(summary.qqqEstimatedSoldSkuCount)}건`, tone: "informational" },
    { label: "QQQ 판매 기록 SKU", value: apiNum(summary.qqqEstimatedSoldSkuCount), sub: `QQQ 전체 ${apiNum(summary.qqqSkuCount)}건 중`, tone: "informational" }
  ];
  target.innerHTML = cards.map((card) => (
    `<div class="action-item sales-kpi-card ${esc(card.tone)}"><span>${esc(card.label)}</span><strong>${card.value}</strong><small>${esc(card.sub)}</small></div>`
  )).join("");
}

function renderInventoryOverviewBrandRows(resp) {
  const target = $("#inventoryOverviewBrandRows");
  if (!target) return;
  const rows = resp.brandRollup || [];
  if (!rows.length) {
    target.innerHTML = `<tr><td colspan="7">브랜드 데이터가 없습니다.</td></tr>`;
    return;
  }
  target.innerHTML = rows.map((row) => `
    <tr>
      <td><a href="#" data-inventory-overview-brand-jump="${esc(row.brandKey)}">${esc(row.brandName)}</a>${row.brandCanonical ? "" : ` <span class="hint-text">(미등록 브랜드명)</span>`}</td>
      <td>${apiNum(row.totalSku)}</td>
      <td>${apiNum(row.knownStock)}</td>
      <td>${apiNum(row.depletedCount)}</td>
      <td>${apiNum(row.negativeReviewCount)}</td>
      <td>${row.qqqSkuCount ? apiNum(row.qqqEstimatedSoldQuantity) : "-"}</td>
      <td>${apiNum(row.recentSalesQty)}</td>
    </tr>
  `).join("");
}

function renderInventoryOverviewFilterOptions(resp) {
  const brandSelect = $("#inventoryOverviewBrandFilter");
  if (!brandSelect) return;
  const rows = resp.brandRollup || [];
  const current = inventoryOverviewFilters.brand || "all";
  brandSelect.innerHTML = `<option value="all">브랜드 전체</option>${rows.map((row) => `<option value="${esc(row.brandKey)}">${esc(row.brandName)}</option>`).join("")}`;
  brandSelect.value = rows.some((row) => row.brandKey === current) ? current : "all";
}

function renderInventoryOverviewItemRows(resp) {
  const target = $("#inventoryOverviewItemRows");
  const emptyTarget = $("#inventoryOverviewEmpty");
  if (!target) return;
  const items = resp.items || [];
  if (emptyTarget) emptyTarget.hidden = items.length > 0;
  target.innerHTML = items.map((item) => {
    const meta = inventoryOverviewStatusMeta(item.status);
    const typeLabel = INVENTORY_OVERVIEW_PRODUCT_TYPE_LABELS[item.productType] || item.productType || "-";
    const locations = item.locations || {};
    const locationStatusLabel = item.locationCoverageStatus === "unavailable" ? "확인 불가" : "확인됨";
    return `
      <tr>
        <td>${esc(item.brandName)}</td>
        <td>${esc(item.productName)}${item.specification ? ` <span class="hint-text">${esc(item.specification)}</span>` : ""}</td>
        <td>${esc(item.prodCd)}</td>
        <td>${esc(typeLabel)}</td>
        <td>${apiNum(item.stockQuantity)}</td>
        <td>${inventoryOverviewLocationValueLabel(locations.STORE_1)}</td>
        <td>${inventoryOverviewLocationValueLabel(locations.OFFSITE)}</td>
        <td>${esc(locationStatusLabel)}</td>
        <td><span class="inventory-intel-status-pill ${esc(meta.tone)}">${esc(meta.label)}</span></td>
        <td>${item.productType === "qqq" ? apiNum(item.estimatedSoldQuantity) : "-"}</td>
        <td>${apiWon(item.purchasePrice)}</td>
        <td>${apiWon(item.salesPrice)}</td>
        <td>${item.registryLinked ? "연결됨" : "-"}</td>
      </tr>
    `;
  }).join("");
}

function renderInventoryOverviewPagination(resp) {
  const target = $("#inventoryOverviewPagination");
  if (!target) return;
  const total = resp.itemsTotal || 0;
  const limit = resp.limit || inventoryOverviewPage.limit;
  const offset = resp.offset || 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  target.innerHTML = `
    <button type="button" class="today-jump-button" data-inventory-overview-page="prev" ${offset <= 0 ? "disabled" : ""}>이전</button>
    <span>${apiNum(from)}-${apiNum(to)} / ${apiNum(total)}</span>
    <button type="button" class="today-jump-button" data-inventory-overview-page="next" ${offset + limit >= total ? "disabled" : ""}>다음</button>
  `;
}

function inventoryOverviewClearPanels() {
  ["#inventoryOverviewMeta", "#inventoryOverviewSummaryCards", "#inventoryOverviewBrandRows", "#inventoryOverviewItemRows", "#inventoryOverviewPagination"].forEach((selector) => {
    const node = $(selector);
    if (node) node.innerHTML = "";
  });
}

async function renderInventoryOverviewView() {
  const seq = ++inventoryOverviewRenderSeq;
  const status = $("#inventoryOverviewStatus");
  if (status) {
    status.className = "ad-status-banner loading";
    status.textContent = "Inventory Overview 로딩 중...";
  }
  try {
    const resp = await getJson(inventoryOverviewQueryUrl(), 15000);
    if (seq !== inventoryOverviewRenderSeq) return;
    if (resp.error) throw new Error(resp.message || resp.error);
    if (resp.ok === false) throw new Error(resp.message || "Inventory Overview 데이터를 불러오지 못했습니다.");
    if (resp.available === false) {
      if (status) {
        status.className = "ad-status-banner warn";
        status.textContent = "ECOUNT 재고 데이터(work/ecount-inventory/latest.json)가 아직 없습니다.";
      }
      inventoryOverviewClearPanels();
      return;
    }
    inventoryOverviewState.raw = resp;
    if (status) {
      status.className = "ad-status-banner good";
      status.textContent = `Read-only · ECOUNT 기준 SKU ${apiNum(resp.summary?.totalSkuCount ?? 0)}개 (일반 ${apiNum(resp.summary?.generalSkuCount ?? 0)} · QQQ ${apiNum(resp.summary?.qqqSkuCount ?? 0)} · 관리코드 ${apiNum(resp.summary?.adminCodeSkuCount ?? 0)})`;
    }
    const metaTarget = $("#inventoryOverviewMeta");
    if (metaTarget) {
      const policy = resp.inventoryPolicy || {};
      metaTarget.innerHTML = `
        <span>ECOUNT 동기화 ${resp.generatedAt ? new Date(resp.generatedAt).toLocaleString("ko-KR") : "-"}</span>
        <span>ECOUNT source: ${esc(resp.source || "-")}</span>
        <span>재고 기준: ${esc(policy.sourceOfTruth || "ECOUNT")} (Cafe24 재고 미사용)</span>
        <span>위치 데이터: ${policy.locationMode === "available" ? "확인 가능" : "확인 불가(현재 ECOUNT 응답에 창고 구분 없음)"}</span>
      `;
    }
    renderInventoryOverviewSummaryCards(resp);
    renderInventoryOverviewBrandRows(resp);
    renderInventoryOverviewFilterOptions(resp);
    renderInventoryOverviewItemRows(resp);
    renderInventoryOverviewPagination(resp);
  } catch (error) {
    if (seq !== inventoryOverviewRenderSeq) return;
    if (status) {
      status.className = "ad-status-banner urgent";
      status.textContent = `Inventory Overview를 불러오지 못했습니다. ${error.message || ""}`;
    }
    $("#inventoryOverviewItemRows") && ($("#inventoryOverviewItemRows").innerHTML = "");
  }
}

renderNav();
bind();
handleCafe24OAuthRedirect();
loadMonths();
renderStoryInsights();
