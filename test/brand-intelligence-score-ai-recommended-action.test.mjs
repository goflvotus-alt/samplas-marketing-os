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
  sourceOfFunction("entityIsLiveMonthRow"),
  sourceOfFunction("entityTrendMoMPct"),
  sourceOfFunction("renderEntityHeroInsight")
].join("\n\n");

function renderInsight(row, index, entityTrendMonths, entityHeroInventoryState, brandIdentityState) {
  const { $, nodes } = makeFakeDom();
  const fn = Function(
    "$", "entityTrendMonths", "entityHeroInventoryState", "brandIdentityState",
    `${INSIGHT_SOURCE}; return renderEntityHeroInsight;`
  )($, entityTrendMonths, entityHeroInventoryState, brandIdentityState);
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

// 8/9. AI Summary never interprets missing Category/Sell-through as a performance judgment —
// in fact it must never mention them at all (they are out of this function's real inputs).
test("8/9. AI Summary never mentions Category or Sell-through in any state", () => {
  const cases = [
    renderInsight(carnetRow(), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND }),
    renderInsight(carnetRow({ fetchFailed: true, revenue: null, quantitySold: null, orderCount: null, online: null, offline: null, skuCount: 0 }), 0, [carnetRow()], IDLE_INVENTORY, { brandCode: BRAND }),
    renderInsight(null, 0, [], IDLE_INVENTORY, { brandCode: null })
  ];
  for (const { summary } of cases) {
    assert.doesNotMatch(summary, /카테고리|Category|셀스루|Sell-?through/i, `AI Summary must never mention Category/Sell-through: "${summary}"`);
  }
});

// 11/12. Recommended Action only uses the existing, already-approved honest disclosure — no
// invented business rule (discount/promotion/reorder/ad recommendations).
test("11/12. Recommended Action stays the existing honest 'rule not defined' disclosure, never an invented recommendation", () => {
  const { action } = renderInsight(carnetRow(), 0, [carnetRow()], { brandCode: BRAND, ready: true, stock: 272, fetchFailed: false }, { brandCode: BRAND });
  assert.match(action, /추천 규칙 미확정/);
  assert.doesNotMatch(action, /할인 추천|프로모션 추천|재입고 추천|발주 추천|광고 추천/, "no invented marketing/business action rule may appear");
});

// 10. AI Summary failure state stays safe with the new sentences too (BI-CORE-4 regression).
test("10. fetch-failed row still renders only the existing neutral fallback — new sentences do not leak through the early return", () => {
  const failedRow = carnetRow({ fetchFailed: true, revenue: null, quantitySold: null, orderCount: null, online: null, offline: null });
  const { summary } = renderInsight(failedRow, 0, [failedRow], { brandCode: BRAND, ready: true, stock: 272, fetchFailed: false }, { brandCode: BRAND });
  assert.equal(summary, "이번 기간 판단 가능한 데이터가 부족합니다.");
});

// Phase 1/2/4: Brand Score has zero approved formula for any of its 4 sub-components or the
// overall value anywhere in the repository (confirmed via docs/ROADMAP.md's own explicit
// "likely a new formula, needs STEP0 design first" note) — this batch must not invent one.
// Structural guard: no JS anywhere computes/assigns a Brand Score value.
test("Brand Score: no JS code computes or assigns .brand-hero-score-value (still a static, honest 'unavailable' shell)", () => {
  assert.doesNotMatch(js, /brand-hero-score-value["']?\)?\s*\.\s*textContent\s*=/, "no function may assign a computed value to the Brand Score display");
  assert.doesNotMatch(js, /entityHeroScoreValue|brand-hero-score-ring["']?\)?\s*\.\s*style/, "no function may compute a dynamic Brand Score ring value");
});

test("Brand Score: existing tooltip copy still honestly discloses 'formula not connected' for all 4 sub-components and the overall score", () => {
  assert.match(js, /공식 Health Score 산식이 연결되기 전까지 점수를 표시하지 않습니다/);
  assert.match(js, /매출 성장 점수 산식 연결 대기/);
  assert.match(js, /재고 건전성 점수 산식 연결 대기/);
  assert.match(js, /판매 회전율 점수 산식 연결 대기/);
  assert.match(js, /고객 성장 점수 산식 연결 대기/);
});

// Category remains untouched/still blocked this batch (BI-BATCH-C PATH B) — structural guard
// against accidental scope creep.
test("Category remains blocked/unimplemented — entityCategoryRows is still the literal empty array", () => {
  assert.match(js, /const entityCategoryRows = \[\];/);
});

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
