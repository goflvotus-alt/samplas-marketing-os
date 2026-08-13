import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BI-BATCH-D (Brand Score + AI Summary + Recommended Action). Same source-extraction +
// Function() execution pattern already established by
// test/brand-intelligence-partial-period.test.mjs (no jsdom in this repo).
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOfFunction(name) {
  const asyncMarker = `async function ${name}(`;
  const asyncStart = js.indexOf(asyncMarker);
  const marker = asyncStart !== -1 ? asyncMarker : `function ${name}(`;
  const start = asyncStart !== -1 ? asyncStart : js.indexOf(marker);
  assert.notEqual(start, -1, `${name} missing`);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = start; index < js.length; index += 1) {
    if (js[index] === "(") parenDepth += 1;
    if (js[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { bodyStart = js.indexOf("{", index); break; }
    }
  }
  assert.notEqual(bodyStart, -1, `${name} body not found`);
  let depth = 0;
  let opened = false;
  for (let index = bodyStart; index < js.length; index += 1) {
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

const INSIGHT_SOURCE = [
  "const nf = new Intl.NumberFormat(\"ko-KR\");",
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

// BI-BATCH-I: renderEntityHeroInsight() now also reads entityScoreState/
// entityCompositionTypeStats/entitySkuRows/entityCategoryRows/entityCategoryCoverage/
// entityInventoryItemsState — all default to "not available" here so none of AI Summary
// v2's new sentences or Recommended Action v1's rules fire unless a test opts in
// (keeps every pre-existing BI-BATCH-D assertion valid).
function renderInsight(row, index, entityTrendMonths, entityHeroInventoryState, brandIdentityState, overrides = {}) {
  const { $, nodes } = makeFakeDom();
  const defaults = {
    entityScoreState: { status: "idle", brandCode: null, periodKey: null },
    entityCompositionTypeStats: {},
    entityCompositionTypeLabel: { stylist: "스타일리스트" },
    entityCompositionMode: "count",
    entitySkuRows: [],
    entityCategoryRows: [],
    entityCategoryCoverage: null,
    entityInventoryItemsState: { brandCode: null, brandKey: null, items: [], fetchFailed: false, ready: false }
  };
  const state = { ...defaults, ...overrides };
  const fn = Function(
    "$", "entityTrendMonths", "entityHeroInventoryState", "brandIdentityState",
    "entityScoreState", "entityCompositionTypeStats", "entityCompositionTypeLabel", "entityCompositionMode",
    "entitySkuRows", "entityCategoryRows", "entityCategoryCoverage", "entityInventoryItemsState",
    `${INSIGHT_SOURCE}; return renderEntityHeroInsight;`
  )(
    $, entityTrendMonths, entityHeroInventoryState, brandIdentityState,
    state.entityScoreState, state.entityCompositionTypeStats, state.entityCompositionTypeLabel, state.entityCompositionMode,
    state.entitySkuRows, state.entityCategoryRows, state.entityCategoryCoverage, state.entityInventoryItemsState
  );
  fn(row, index);
  return {
    summary: nodes.get("entityHeroAiSummary").textContent,
    note: nodes.get("entityHeroAiSummaryNote").textContent,
    action: nodes.get("entityHeroActionList").innerHTML
  };
}

const BRAND = "B00000KU";
function carnetRow(overrides = {}) {
  return {
    key: "2026-08", label: "8월", revenue: 10883059, quantitySold: 32, orderCount: 25,
    online: 1021959, offline: 9861100, skuCount: 3, aov: 435322, memo: "",
    archiveStatus: "saved", fetchFailed: false, ...overrides
  };
}
const IDLE_INVENTORY = { brandCode: null, ready: false, stock: null, fetchFailed: false };

// 7. AI Summary uses real metrics: real, already-computed SKU count (STEP67-6, no new formula)
test("7a. AI Summary includes a real SKU-count sentence from entityTrendMonths[].skuCount", () => {
  const { summary } = renderInsight(carnetRow({ skuCount: 3 }), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND });
  assert.match(summary, /온라인 판매가 확인된 상품은 3개입니다/);
});

test("4/9. genuine zero SKU count renders as real 0, not hidden or fabricated as unavailable", () => {
  const { summary } = renderInsight(carnetRow({ skuCount: 0 }), 0, [carnetRow({ skuCount: 0 })], IDLE_INVENTORY, { brandCode: BRAND });
  assert.match(summary, /온라인 판매가 확인된 상품은 0개입니다/);
});

// 7b. AI Summary uses real metrics: current stock, only once refreshEntityInventory has
// actually resolved a value for the currently-selected brand.
test("7b. AI Summary appends a real current-stock sentence once inventory is resolved for the selected brand", () => {
  const ready = { brandCode: BRAND, ready: true, stock: 272, fetchFailed: false };
  const { summary } = renderInsight(carnetRow(), 0, [carnetRow()], ready, { brandCode: BRAND });
  assert.match(summary, /현재 재고는 272개입니다/);
});

// 5/10. fetch failure / missing component != zero, never fabricated.
test("5/10a. stock sentence is omitted (not \"0개\") while inventory is still loading", () => {
  const { summary } = renderInsight(carnetRow(), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND });
  assert.doesNotMatch(summary, /현재 재고는/);
});

test("5/10b. stock sentence is omitted (not \"0개\") when the inventory fetch failed", () => {
  const failed = { brandCode: BRAND, ready: true, stock: null, fetchFailed: true };
  const { summary } = renderInsight(carnetRow(), 0, [carnetRow()], failed, { brandCode: BRAND });
  assert.doesNotMatch(summary, /현재 재고는/);
});

test("5/10c. stock sentence is omitted (not \"0개\") when no canonical ECOUNT match was found (ready, but stock null)", () => {
  const noMatch = { brandCode: BRAND, ready: true, stock: null, fetchFailed: false };
  const { summary } = renderInsight(carnetRow(), 0, [carnetRow()], noMatch, { brandCode: BRAND });
  assert.doesNotMatch(summary, /현재 재고는/);
});

// brand-switch stale guard: a resolved inventory value for a brand that is no longer selected
// must never leak into the new brand's AI Summary.
test("stock sentence is omitted when entityHeroInventoryState belongs to a different (stale) brand", () => {
  const staleForOtherBrand = { brandCode: "B0000OTHER", ready: true, stock: 999, fetchFailed: false };
  const { summary } = renderInsight(carnetRow(), 0, [carnetRow()], staleForOtherBrand, { brandCode: BRAND });
  assert.doesNotMatch(summary, /현재 재고는/, "a stock value resolved for a previously-selected brand must not appear under the newly-selected brand");
});

// BI-BATCH-I Part 6: AI Summary v2 is explicitly allowed (and required) to disclose Sell-
// through's deferred status with the exact approved sentence, and to mention a Category
// leader once coverage is adequate (entityCategoryCoverage.coveragePct >= 50) — but must
// never mention Sell-through any other way, and must never mention Category when coverage
// is inadequate or entityCategoryRows is empty.
test("8/9. AI Summary discloses Sell-through only via the exact approved deferred sentence, and never guesses at a Category leader without adequate coverage", () => {
  const cases = [
    renderInsight(carnetRow(), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND }),
    renderInsight(carnetRow({ fetchFailed: true, revenue: null, quantitySold: null, orderCount: null, online: null, offline: null, skuCount: 0 }), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND }),
    renderInsight(null, 0, [], IDLE_INVENTORY, { brandCode: null })
  ];
  for (const { summary } of cases) {
    assert.doesNotMatch(summary, /카테고리|상품군|Category/i, `AI Summary must not mention Category without adequate coverage: "${summary}"`);
  }
  const { summary: readySummary } = renderInsight(carnetRow(), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND });
  assert.match(readySummary, /Sell-through는 입고 데이터 확보 후 제공됩니다\./, "the exact approved Sell-through-deferred disclosure sentence must appear");
});

test("Category leader sentence appears only when entityCategoryCoverage.coveragePct >= 50 (adequate coverage), using real entityCategoryRows", () => {
  const highCoverage = {
    entityCategoryCoverage: { totalRevenue: 100, totalUnits: 10, attributedRevenue: 60, unattributedRevenue: 40, attributedUnits: 6, unattributedUnits: 4, coveragePct: 60 },
    entityCategoryRows: [{ code: "TOP", name: "상의", revenue: 60, quantitySold: 6, skuCount: 2 }]
  };
  const { summary: withCategory } = renderInsight(carnetRow(), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND }, highCoverage);
  assert.match(withCategory, /상품군 매출 1위는 상의입니다\./);

  const lowCoverage = {
    entityCategoryCoverage: { totalRevenue: 100, totalUnits: 10, attributedRevenue: 20, unattributedRevenue: 80, attributedUnits: 2, unattributedUnits: 8, coveragePct: 20 },
    entityCategoryRows: [{ code: "TOP", name: "상의", revenue: 20, quantitySold: 2, skuCount: 1 }]
  };
  const { summary: withoutCategory } = renderInsight(carnetRow(), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND }, lowCoverage);
  assert.doesNotMatch(withoutCategory, /상품군 매출 1위/, "low coverage must not produce a misleading category-leader claim");
});

// BI-BATCH-I Part 5: SAMPLAS Recommended Action v1 — a threshold-based operational
// checklist, never a marketing/business recommendation (discount/promotion/reorder/ad).
test("11/12. Recommended Action v1: no triggered rule falls back to the honest 'no urgent items' sentence, never an invented recommendation", () => {
  const { action } = renderInsight(carnetRow(), 0, [carnetRow()], { brandCode: BRAND, ready: true, stock: 272, fetchFailed: false }, { brandCode: BRAND });
  assert.match(action, /현재 기준 긴급 점검 항목이 없습니다/);
  assert.doesNotMatch(action, /할인|프로모션|재입고|발주|광고/, "no invented marketing/business action rule may appear");
});

test("Recommended Action v1: negative-inventory rule fires with a real count (priority 1)", () => {
  const items = { brandCode: BRAND, ready: true, fetchFailed: false, items: [{ stockQuantity: -3 }, { stockQuantity: 5 }, { stockQuantity: -1 }] };
  const { action } = renderInsight(carnetRow(), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND }, { entityInventoryItemsState: items });
  assert.match(action, /음수 재고 SKU를 확인하세요\. \(2개\)/);
});

test("Recommended Action v1: revenue/orders/customers rules fire only when their Score component is <= 50 points, using the real score state", () => {
  const lowEverything = {
    status: "ready", brandCode: BRAND, periodKey: "2026-08",
    revenue: { pct: -25, points: 30 }, orders: { pct: -15, points: 50 }, customers: { pct: -40, points: 10 },
    inventory: { points: 100 }, overall: 40, label: "WATCH", coveragePct: 100
  };
  const { action } = renderInsight(carnetRow(), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND }, { entityScoreState: lowEverything });
  assert.match(action, /매출 하락 구간을 점검하세요/);
  assert.match(action, /주문수 감소 구간을 점검하세요/);
  assert.match(action, /구매 고객 수 감소를 점검하세요/);
});

test("Recommended Action v1: at most 3 actions, priority order is inventory > revenue > orders > customers", () => {
  const items = { brandCode: BRAND, ready: true, fetchFailed: false, items: [{ stockQuantity: -1 }] };
  const allTriggered = {
    status: "ready", brandCode: BRAND, periodKey: "2026-08",
    revenue: { pct: -25, points: 30 }, orders: { pct: -15, points: 50 }, customers: { pct: -40, points: 10 },
    inventory: { points: 0 }, overall: 20, label: "RISK", coveragePct: 100
  };
  const { action } = renderInsight(carnetRow(), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND }, { entityScoreState: allTriggered, entityInventoryItemsState: items });
  const items_ = (action.match(/<li>/g) || []).length;
  assert.equal(items_, 3, "max 3 actions even when 4 rules would trigger");
  const invIdx = action.indexOf("음수 재고");
  const revIdx = action.indexOf("매출 하락");
  const ordIdx = action.indexOf("주문수 감소");
  assert.ok(invIdx !== -1 && invIdx < revIdx && revIdx < ordIdx, "inventory > revenue > orders priority order");
  assert.doesNotMatch(action, /구매 고객 수 감소/, "4th-priority customer rule must be dropped by the max-3 cap");
});

// 10. AI Summary failure state stays safe with the new sentences too (BI-CORE-4 regression).
test("10. fetch-failed row still renders only the existing neutral fallback — new sentences do not leak through the early return", () => {
  const failedRow = carnetRow({ fetchFailed: true, revenue: null, quantitySold: null, orderCount: null, online: null, offline: null });
  const { summary } = renderInsight(failedRow, 0, [failedRow], { brandCode: BRAND, ready: true, stock: 272, fetchFailed: false }, { brandCode: BRAND });
  assert.equal(summary, "이번 기간 판단 가능한 데이터가 부족합니다.");
});

// BI-BATCH-I superseded BI-BATCH-D's "Brand Score has no approved formula" guard: SAMPLAS
// Brand Operating Score v1 is now approved and implemented (docs/BRAND_INTELLIGENCE_RULES.md).
// See test/brand-intelligence-score-grade-action.test.mjs for its coverage. Category also
// gained a real source (SAMPLAS Category Master v1) — see
// test/brand-intelligence-category-master.test.mjs.

// Brand/period stale guard: refreshEntityTrendMonths resets entityHeroInventoryState when the
// brand is deselected, so a stale stock number from a previous brand can never linger.
test("refreshEntityTrendMonths resets entityHeroInventoryState when no brand is selected", () => {
  const fnSource = sourceOfFunction("refreshEntityTrendMonths");
  const resetIndex = fnSource.indexOf("entityHeroInventoryState = { brandCode: null, ready: false, stock: null, fetchFailed: false };");
  const brandCheckIndex = fnSource.indexOf("if (!brandIdentityState.brandCode)");
  assert.notEqual(resetIndex, -1);
  assert.ok(resetIndex > brandCheckIndex, "the reset must be inside the no-brand-selected branch");
});

// No new fetch was introduced for the new AI Summary sentences (Phase 7's own inputs: skuCount
// is already computed synchronously by refreshEntityTrendMonths; stock reuses
// refreshEntityInventory's already-resolved value).
test("no new network fetch was introduced for the AI Summary additions (reuses entityTrendMonths.skuCount + refreshEntityInventory's resolved stock)", () => {
  const fnSource = sourceOfFunction("renderEntityHeroInsight");
  assert.doesNotMatch(fnSource, /getJson\(|getSharedJson\(|fetch\(/);
});
