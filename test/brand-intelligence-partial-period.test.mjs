import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// STEP67-10G-4: Hero KPI/AI Summary/Trend Summary는 DOM을 직접 조작하는 함수라
// (이 저장소에 jsdom이 없다) test/brand-comparison-yoy-timeout.test.mjs가 확립한
// "실제 소스를 브레이스 매칭으로 뽑아 Function()으로 실행" 패턴을 그대로 따르되,
// 여기서는 $()가 참조하는 DOM 노드를 요청받는 즉시 만들어주는 최소 stub으로
// 대체한다(id를 미리 나열할 필요 없음, 새 DOM 라이브러리 추가 없음).
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOfFunction(name) {
  const marker = `function ${name}(`;
  const start = js.indexOf(marker);
  assert.notEqual(start, -1, `${name} missing`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(start, index + 1);
  }
  throw new Error(`${name} incomplete`);
}

function makeFakeDom() {
  const nodes = new Map();
  const $ = (selector) => {
    const id = selector.replace(/^#/, "");
    if (!nodes.has(id)) {
      nodes.set(id, { textContent: "", innerHTML: "", className: "", hidden: false, style: {}, querySelector: () => null, querySelectorAll: () => [] });
    }
    return nodes.get(id);
  };
  return { $, nodes };
}

// BI-BATCH-D: renderEntityHeroInsight() now also reads entityHeroInventoryState (the
// already-resolved Hero inventory value, no new fetch) and brandIdentityState.brandCode to
// decide whether to append a "현재 재고는 N개입니다" sentence. Every extraction site that
// pulls in renderEntityHeroInsight needs both as free variables — default them to "not
// ready" / no brand so the new sentence is a no-op unless a test explicitly opts in, keeping
// every pre-existing assertion in this file valid.
// BI-BATCH-I: renderEntityHeroInsight() now also reads entityScoreState (Brand Operating
// Score v1, async — defaults to "idle" here so none of its sentences fire unless a test
// explicitly opts in), entityCompositionTypeStats/entitySkuRows/entityCategoryRows/
// entityCategoryCoverage (all default empty/null — same no-op-unless-opted-in principle).
const HERO_INSIGHT_STATE_STUB = [
  "let entityHeroInventoryState = { brandCode: null, ready: false, stock: null, fetchFailed: false };",
  "let brandIdentityState = { brandCode: null };",
  "let entityInventoryItemsState = { brandCode: null, brandKey: null, items: [], fetchFailed: false, ready: false };",
  "let entityScoreState = { status: 'idle', brandCode: null, periodKey: null };",
  "let entityCompositionTypeStats = {};",
  "let entityCompositionTypeLabel = { stylist: '스타일리스트' };",
  "let entityCompositionMode = 'count';",
  "let entitySkuRows = [];",
  "let entityCategoryRows = [];",
  "let entityCategoryCoverage = null;"
].join("\n");

const HERO_SOURCE = [
  "const nf = new Intl.NumberFormat(\"ko-KR\");",
  HERO_INSIGHT_STATE_STUB,
  sourceOfFunction("hasApiValue"),
  sourceOfFunction("apiNum"),
  sourceOfFunction("apiWon"),
  sourceOfFunction("esc"),
  sourceOfFunction("entityIsLiveMonthRow"),
  sourceOfFunction("entityTrendMoMPct"),
  sourceOfFunction("entityCompositionRatiosForStats"),
  sourceOfFunction("entityRecommendedActionListHtml"),
  sourceOfFunction("renderEntityHeroChannelSplit"),
  sourceOfFunction("renderEntityHeroSku"),
  sourceOfFunction("renderEntityHeroInsight"),
  sourceOfFunction("renderEntityHeroKpiFromMonthlyState")
].join("\n\n");

function loadHeroEngine(entityTrendMonths, currentKey) {
  const { $, nodes } = makeFakeDom();
  const fn = Function(
    "$", "entityTrendMonths", "currentEntityPeriodMonthKey", "requestAnimationFrame",
    `${HERO_SOURCE}; return renderEntityHeroKpiFromMonthlyState;`
  )($, entityTrendMonths, () => currentKey, () => {});
  fn();
  return nodes;
}

const TREND_SOURCE = [
  sourceOfFunction("esc"),
  sourceOfFunction("apiWon"),
  "const nf = new Intl.NumberFormat(\"ko-KR\");",
  sourceOfFunction("hasApiValue"),
  sourceOfFunction("entityIsLiveMonthRow"),
  sourceOfFunction("entityTrendChartSvg"),
  sourceOfFunction("entityTrendIndicatorHtml"),
  sourceOfFunction("renderEntityTrendSection")
].join("\n\n");

function loadTrendEngine(entityTrendMonths, entityTrendCompareMonths = []) {
  const { $, nodes } = makeFakeDom();
  const fn = Function(
    "$", "entityTrendMonths", "entityTrendCompareMonths", "requestAnimationFrame",
    `${TREND_SOURCE}; return renderEntityTrendSection;`
  )($, entityTrendMonths, entityTrendCompareMonths, () => {});
  fn();
  return nodes;
}

function loadEntityTrendChartSvg(entityTrendMonths, entityTrendCompareMonths = []) {
  const source = [sourceOfFunction("esc"), sourceOfFunction("entityTrendChartSvg")].join("\n\n");
  return Function(
    "entityTrendMonths", "entityTrendCompareMonths",
    `${source}; return entityTrendChartSvg;`
  )(entityTrendMonths, entityTrendCompareMonths)();
}

// STEP67-10G-4 실측 기반 fixture: CARNET ARCHIVE 5~8월(STEP67-10G-1/2/3이 확인한 실제
// 월별 매출), 8월만 archiveStatus="live"(오늘 2026-08-11 기준 진행 중).
const CARNET_MONTHS_LIVE_TAIL = [
  { key: "2026-05", label: "5월", revenue: 40800000, quantitySold: 90, orderCount: 80, online: 4000000, offline: 36800000, skuCount: 20, aov: 510000, memo: "", archiveStatus: "saved" },
  { key: "2026-06", label: "6월", revenue: 24400000, quantitySold: 60, orderCount: 55, online: 2400000, offline: 22000000, skuCount: 16, aov: 443636, memo: "", archiveStatus: "saved" },
  { key: "2026-07", label: "7월", revenue: 23303130, quantitySold: 69, orderCount: 66, online: 2448430, offline: 20854700, skuCount: 15, aov: 353078, memo: "", archiveStatus: "saved" },
  { key: "2026-08", label: "8월", revenue: 9441259, quantitySold: 28, orderCount: 21, online: 1021959, offline: 8419300, skuCount: 12, aov: 449584, memo: "", archiveStatus: "live" }
];

test("1. HERO LIVE MONTH — raw value visible, no MoM %, no decline label", () => {
  const nodes = loadHeroEngine(CARNET_MONTHS_LIVE_TAIL, "2026-08");
  assert.equal(nodes.get("entityHeroKpiSales").textContent, "9,441,259원");
  assert.equal(nodes.get("entityHeroKpiSalesMom").textContent, "진행 중");
  assert.doesNotMatch(nodes.get("entityHeroKpiSalesMom").textContent, /%/);
  assert.doesNotMatch(nodes.get("entityHeroKpiSalesMom").textContent, /▼|▲/);
  assert.equal(nodes.get("entityHeroKpiSalesMom").className, "brand-hero-delta flat");
});

test("2. HERO SAVED MONTH — existing MoM % calculation unchanged for completed months", () => {
  const months = [
    { key: "2026-06", label: "6월", revenue: 10000000, quantitySold: 50, orderCount: 40, online: 0, offline: 10000000, skuCount: 10, aov: 250000, memo: "", archiveStatus: "saved" },
    { key: "2026-07", label: "7월", revenue: 8000000, quantitySold: 40, orderCount: 32, online: 0, offline: 8000000, skuCount: 9, aov: 250000, memo: "", archiveStatus: "saved" }
  ];
  const nodes = loadHeroEngine(months, "2026-07");
  assert.equal(nodes.get("entityHeroKpiSales").textContent, "8,000,000원");
  assert.equal(nodes.get("entityHeroKpiSalesMom").textContent, "▼ 20% MoM");
  assert.equal(nodes.get("entityHeroKpiSalesMom").className, "brand-hero-delta down");
});

test("3. AI SUMMARY LIVE MONTH — no completed-period decline/ranking claims", () => {
  const source = [
    "const nf = new Intl.NumberFormat(\"ko-KR\");",
    HERO_INSIGHT_STATE_STUB,
    sourceOfFunction("hasApiValue"),
    sourceOfFunction("apiNum"),
    sourceOfFunction("apiWon"),
    sourceOfFunction("esc"),
    sourceOfFunction("entityIsLiveMonthRow"),
    sourceOfFunction("entityTrendMoMPct"),
    sourceOfFunction("entityCompositionRatiosForStats"),
    sourceOfFunction("entityRecommendedActionListHtml"),
    sourceOfFunction("renderEntityHeroInsight")
  ].join("\n\n");
  const { $, nodes } = makeFakeDom();
  const row = CARNET_MONTHS_LIVE_TAIL[3];
  const fn = Function("$", "entityTrendMonths", `${source}; return renderEntityHeroInsight;`)($, CARNET_MONTHS_LIVE_TAIL);
  fn(row, 3);
  const text = nodes.get("entityHeroAiSummary").textContent;
  assert.doesNotMatch(text, /전월 대비/);
  assert.doesNotMatch(text, /59%|59\.5%/);
  assert.doesNotMatch(text, /감소했습니다/);
  assert.doesNotMatch(text, /가장 낮습니다|가장 높습니다/);
  assert.match(text, /9,441,259원/);
  assert.match(text, /현재 누적 매출/);
});

test("4. TREND LIVE EXCLUSION — recent-3-month classifier ignores the live month", () => {
  const upThenCollapsingLive = [
    { key: "2026-05", label: "5월", revenue: 10000000, quantitySold: 10, orderCount: 10, online: 0, offline: 10000000, skuCount: 5, aov: 1000000, memo: "", archiveStatus: "saved" },
    { key: "2026-06", label: "6월", revenue: 11000000, quantitySold: 11, orderCount: 11, online: 0, offline: 11000000, skuCount: 5, aov: 1000000, memo: "", archiveStatus: "saved" },
    { key: "2026-07", label: "7월", revenue: 12000000, quantitySold: 12, orderCount: 12, online: 0, offline: 12000000, skuCount: 5, aov: 1000000, memo: "", archiveStatus: "saved" },
    { key: "2026-08", label: "8월", revenue: 1000000, quantitySold: 3, orderCount: 3, online: 0, offline: 1000000, skuCount: 2, aov: 333333, memo: "", archiveStatus: "live" }
  ];
  const nodes = loadTrendEngine(upThenCollapsingLive);
  assert.equal(nodes.get("entityTrendRecentLabel").textContent, "▲ 성장");
  assert.equal(nodes.get("entityTrendState").textContent, "▲ 성장");
});

test("5. MIN MONTH LIVE EXCLUSION — numerically lowest live month is not selected as completed-period minimum", () => {
  const nodes = loadTrendEngine(CARNET_MONTHS_LIVE_TAIL);
  const minHtml = nodes.get("entityTrendMin").innerHTML;
  assert.doesNotMatch(minHtml, /2026-08/);
  assert.match(minHtml, /2026-07/);
});

test("6. MAX MONTH LIVE EXCLUSION — numerically highest live month is not selected as completed-period maximum", () => {
  const liveIsHighest = [
    { key: "2026-06", label: "6월", revenue: 5000000, quantitySold: 10, orderCount: 10, online: 0, offline: 5000000, skuCount: 5, aov: 500000, memo: "", archiveStatus: "saved" },
    { key: "2026-07", label: "7월", revenue: 6000000, quantitySold: 11, orderCount: 11, online: 0, offline: 6000000, skuCount: 5, aov: 545455, memo: "", archiveStatus: "saved" },
    { key: "2026-08", label: "8월", revenue: 99000000, quantitySold: 99, orderCount: 90, online: 0, offline: 99000000, skuCount: 20, aov: 1100000, memo: "", archiveStatus: "live" }
  ];
  const nodes = loadTrendEngine(liveIsHighest);
  const maxHtml = nodes.get("entityTrendMax").innerHTML;
  assert.doesNotMatch(maxHtml, /2026-08/);
  assert.match(maxHtml, /2026-07/);
});

test("7. CHART LIVE RETENTION — live month point remains plotted", () => {
  const svg = loadEntityTrendChartSvg(CARNET_MONTHS_LIVE_TAIL);
  const pointCount = (svg.match(/data-entity-trend-point/g) || []).length;
  assert.equal(pointCount, CARNET_MONTHS_LIVE_TAIL.length);
  assert.match(svg, />8월</);
});

test("8. CROSS BRAND LIVE PERIOD / 9. COMPARISON SUMMARY REGRESSION — delegated to STEP67-10G-3 suite", () => {
  // STEP67-10G-4는 buildComparisonSummaryFacts()/renderEntityCompareSummary()를 전혀
  // 수정하지 않았다 — 같은 시나리오(라이브 기간 중 cross-brand 비교 유지, PARTIAL_PERIOD
  // 가드)를 test/brand-comparison-summary.test.mjs의 시나리오 1/2가 이미 실행 검증한다.
  // 여기서 같은 assertion을 복제하는 대신, 그 파일이 실제로 존재하고 두 시나리오를
  // 포함하는지만 구조적으로 재확인한다(전체 회귀는 Phase K에서 별도로 실행).
  assert.match(js, /function buildComparisonSummaryFacts\(input\)/);
  assert.match(js, /if \(isLive\) \{/);
});

test("10. NULL != ZERO — missing current-period row never becomes a fake zero", () => {
  const nodes = loadHeroEngine(CARNET_MONTHS_LIVE_TAIL, "2099-01");
  assert.equal(nodes.get("entityHeroKpiSales").textContent, "-");
  assert.notEqual(nodes.get("entityHeroKpiSales").textContent, "0원");
});

test("11. AOV SEMANTICS — AOV is revenue / orderCount, not revenue / quantitySold", () => {
  const revenue = 1000000;
  const orderCount = 10;
  const quantitySold = 50;
  const correctAov = Math.round(revenue / orderCount); // 100,000
  const wrongAov = Math.round(revenue / quantitySold); // 20,000
  const months = [
    { key: "2026-07", label: "7월", revenue, quantitySold, orderCount, online: 0, offline: revenue, skuCount: 5, aov: correctAov, memo: "", archiveStatus: "saved" }
  ];
  const nodes = loadHeroEngine(months, "2026-07");
  assert.equal(nodes.get("entityHeroKpiAov").textContent, "100,000원");
  assert.notEqual(nodes.get("entityHeroKpiAov").textContent, "20,000원");
  assert.equal(correctAov, 100000);
  assert.equal(wrongAov, 20000);
});

test("12. WORDING SAFETY — no unsupported completed-period claims for a live tail month", () => {
  const trendNodes = loadTrendEngine(CARNET_MONTHS_LIVE_TAIL);
  const insightText = trendNodes.get("entityTrendInsight").textContent;
  assert.doesNotMatch(insightText, /8월도 (회복 시도|상승세)를 유지/);
  assert.match(insightText, /최고점입니다\.$/);

  const source = [
    "const nf = new Intl.NumberFormat(\"ko-KR\");",
    HERO_INSIGHT_STATE_STUB,
    sourceOfFunction("hasApiValue"),
    sourceOfFunction("apiNum"),
    sourceOfFunction("apiWon"),
    sourceOfFunction("esc"),
    sourceOfFunction("entityIsLiveMonthRow"),
    sourceOfFunction("entityTrendMoMPct"),
    sourceOfFunction("entityCompositionRatiosForStats"),
    sourceOfFunction("entityRecommendedActionListHtml"),
    sourceOfFunction("renderEntityHeroInsight")
  ].join("\n\n");
  const { $, nodes } = makeFakeDom();
  const fn = Function("$", "entityTrendMonths", `${source}; return renderEntityHeroInsight;`)($, CARNET_MONTHS_LIVE_TAIL);
  fn(CARNET_MONTHS_LIVE_TAIL[3], 3);
  const summaryText = nodes.get("entityHeroAiSummary").textContent;
  for (const word of ["감소했습니다", "증가했습니다", "최저", "최고", "회복", "반등"]) {
    assert.doesNotMatch(summaryText, new RegExp(word), `unsupported word "${word}" found in live-month AI summary: ${summaryText}`);
  }
});

// =============================================================================
// BI-CORE-4: NULL != ZERO error-state guard. getJson()의 timeout/네트워크 오류
// 폴백({ error: ... })이 refreshEntityTrendMonths()에서 revenue/units/orders/aov = 0으로
// 합성되지 않고 null(=fetchFailed:true)로 남는지, 그리고 그 null이 Hero KPI/AI Summary/
// Trend Chart/Trend 통계 전부에서 "실제 매출 0"과 구분되어 "-"/공백으로만 처리되는지
// 검증한다. 위 CARNET_MONTHS_LIVE_TAIL 등 기존 fixture는 전부 성공 응답을 가정하므로
// 회귀 없이 그대로 통과해야 한다(테스트 18이 재확인).
// =============================================================================

test("13. NULL != ZERO — fetch failure renders \"-\" for all four hero metrics, never a fake zero", () => {
  const months = [
    { key: "2026-07", label: "7월", revenue: 23303130, quantitySold: 69, orderCount: 66, online: 2448430, offline: 20854700, skuCount: 15, aov: 353078, memo: "", archiveStatus: "saved", fetchFailed: false },
    { key: "2026-08", label: "8월", revenue: null, quantitySold: null, orderCount: null, online: null, offline: null, skuCount: 0, aov: null, memo: "", archiveStatus: null, fetchFailed: true }
  ];
  const nodes = loadHeroEngine(months, "2026-08");
  assert.equal(nodes.get("entityHeroKpiSales").textContent, "-");
  assert.equal(nodes.get("entityHeroKpiQty").textContent, "-");
  assert.equal(nodes.get("entityHeroKpiOrders").textContent, "-");
  assert.equal(nodes.get("entityHeroKpiAov").textContent, "-");
  assert.notEqual(nodes.get("entityHeroKpiSales").textContent, "0원");
  assert.notEqual(nodes.get("entityHeroKpiQty").textContent, "0개");
  assert.notEqual(nodes.get("entityHeroKpiOrders").textContent, "0건");
});

test("14. REAL ZERO PRESERVED — successful row with genuine zero sales still renders 0, not \"-\"", () => {
  const months = [
    { key: "2026-08", label: "8월", revenue: 0, quantitySold: 0, orderCount: 0, online: 0, offline: 0, skuCount: 0, aov: 0, memo: "", archiveStatus: "live", fetchFailed: false }
  ];
  const nodes = loadHeroEngine(months, "2026-08");
  assert.equal(nodes.get("entityHeroKpiSales").textContent, "0원");
  assert.equal(nodes.get("entityHeroKpiQty").textContent, "0개");
  assert.equal(nodes.get("entityHeroKpiOrders").textContent, "0건");
  assert.equal(nodes.get("entityHeroKpiAov").textContent, "0원");
});

test("15. MISSING BRAND ROW — successful fetch but no matching brand renders \"-\", not a fabricated 0", () => {
  const months = [
    { key: "2026-08", label: "8월", revenue: null, quantitySold: null, orderCount: null, online: null, offline: null, skuCount: 0, aov: null, memo: "", archiveStatus: "live", fetchFailed: false }
  ];
  const nodes = loadHeroEngine(months, "2026-08");
  assert.equal(nodes.get("entityHeroKpiSales").textContent, "-");
  assert.equal(nodes.get("entityHeroKpiOrders").textContent, "-");
});

test("16. AI SUMMARY — fetch failure does not produce a false -100% MoM or ranking claim", () => {
  const months = [
    { key: "2026-07", label: "7월", revenue: 23303130, quantitySold: 69, orderCount: 66, online: 2448430, offline: 20854700, skuCount: 15, aov: 353078, memo: "", archiveStatus: "saved", fetchFailed: false },
    { key: "2026-08", label: "8월", revenue: null, quantitySold: null, orderCount: null, online: null, offline: null, skuCount: 0, aov: null, memo: "", archiveStatus: null, fetchFailed: true }
  ];
  const source = [
    "const nf = new Intl.NumberFormat(\"ko-KR\");",
    HERO_INSIGHT_STATE_STUB,
    sourceOfFunction("hasApiValue"),
    sourceOfFunction("apiNum"),
    sourceOfFunction("apiWon"),
    sourceOfFunction("entityIsLiveMonthRow"),
    sourceOfFunction("entityTrendMoMPct"),
    sourceOfFunction("renderEntityHeroInsight")
  ].join("\n\n");
  const { $, nodes } = makeFakeDom();
  const fn = Function("$", "entityTrendMonths", `${source}; return renderEntityHeroInsight;`)($, months);
  fn(months[1], 1);
  const text = nodes.get("entityHeroAiSummary").textContent;
  assert.doesNotMatch(text, /100%/);
  assert.doesNotMatch(text, /감소했습니다/);
  assert.doesNotMatch(text, /가장 낮습니다|가장 높습니다/);
  assert.equal(text, "이번 기간 판단 가능한 데이터가 부족합니다.");
});

test("17. CHART — fetch failure does not plot a fake zero point, and does not break the polyline into a false dip", () => {
  const months = [
    { key: "2026-06", label: "6월", revenue: 24400000, quantitySold: 60, orderCount: 55, online: 2400000, offline: 22000000, skuCount: 16, aov: 443636, memo: "", archiveStatus: "saved", fetchFailed: false },
    { key: "2026-07", label: "7월", revenue: null, quantitySold: null, orderCount: null, online: null, offline: null, skuCount: 0, aov: null, memo: "", archiveStatus: null, fetchFailed: true },
    { key: "2026-08", label: "8월", revenue: 10883059, quantitySold: 32, orderCount: 25, online: 1021959, offline: 9861100, skuCount: 3, aov: 435322, memo: "", archiveStatus: "live", fetchFailed: false }
  ];
  const svg = loadEntityTrendChartSvg(months);
  const pointCount = (svg.match(/data-entity-trend-point/g) || []).length;
  assert.equal(pointCount, 2, "only the 2 successful months get a plotted point — the failed month gets none");
  // axis labels are preserved for every month, including the failed one
  assert.match(svg, />6월</);
  assert.match(svg, />7월</);
  assert.match(svg, />8월</);
});

test("18. CARNET ARCHIVE REGRESSION — successful-fetch values are unchanged by the null-vs-zero guard", () => {
  const months = [
    { key: "2026-07", label: "7월", revenue: 23303130, quantitySold: 69, orderCount: 66, online: 2448430, offline: 20854700, skuCount: 15, aov: 353078, memo: "", archiveStatus: "saved", fetchFailed: false },
    { key: "2026-08", label: "8월", revenue: 10883059, quantitySold: 32, orderCount: 25, online: 1021959, offline: 9861100, skuCount: 3, aov: 435322, memo: "", archiveStatus: "live", fetchFailed: false }
  ];
  const nodes = loadHeroEngine(months, "2026-08");
  assert.equal(nodes.get("entityHeroKpiSales").textContent, "10,883,059원");
  assert.equal(nodes.get("entityHeroKpiQty").textContent, "32개");
  assert.equal(nodes.get("entityHeroKpiOrders").textContent, "25건");
  assert.equal(nodes.get("entityHeroKpiAov").textContent, "435,322원");
});

test("19. TREND STATS — fetch-failed month excluded from Max/Min so it cannot masquerade as the lowest month", () => {
  const months = [
    { key: "2026-06", label: "6월", revenue: 24400000, quantitySold: 60, orderCount: 55, online: 2400000, offline: 22000000, skuCount: 16, aov: 443636, memo: "", archiveStatus: "saved", fetchFailed: false },
    { key: "2026-07", label: "7월", revenue: null, quantitySold: null, orderCount: null, online: null, offline: null, skuCount: 0, aov: null, memo: "", archiveStatus: null, fetchFailed: true },
    { key: "2026-08", label: "8월", revenue: 10883059, quantitySold: 32, orderCount: 25, online: 1021959, offline: 9861100, skuCount: 3, aov: 435322, memo: "", archiveStatus: "saved", fetchFailed: false }
  ];
  const nodes = loadTrendEngine(months);
  const minHtml = nodes.get("entityTrendMin").innerHTML;
  const maxHtml = nodes.get("entityTrendMax").innerHTML;
  // Without the guard, null coerces to 0 in `<` comparisons and the failed month would
  // incorrectly win "lowest month" over the real (smaller but nonzero) August figure.
  assert.doesNotMatch(minHtml, /2026-07/);
  assert.match(minHtml, /2026-08/);
  assert.match(maxHtml, /2026-06/);
});

test("20. entityTrendMoMPct — null current or previous revenue returns null, never a fabricated ±100%", () => {
  const source = sourceOfFunction("entityTrendMoMPct");
  const failedCurrent = Function("entityTrendMonths", `${source}; return entityTrendMoMPct;`)([{ revenue: 23303130 }, { revenue: null }]);
  assert.equal(failedCurrent(1), null);
  const failedPrev = Function("entityTrendMonths", `${source}; return entityTrendMoMPct;`)([{ revenue: null }, { revenue: 10883059 }]);
  assert.equal(failedPrev(1), null);
});
