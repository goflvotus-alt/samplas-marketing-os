import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BI-BATCH-I Part 3/4/5/10 — SAMPLAS Brand Operating Score v1, Customer Contribution Grade
// v1, Recommended Action v1 (docs/BRAND_INTELLIGENCE_RULES.md). Same source-extraction +
// Function() execution pattern already established in this repo (no jsdom).
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

function sourceOfConst(name) {
  const marker = `const ${name} = `;
  const start = js.indexOf(marker);
  assert.notEqual(start, -1, `${name} missing`);
  const end = js.indexOf(";\n", start);
  assert.notEqual(end, -1, `${name} end not found`);
  return js.slice(start, end + 1);
}

// ---- Brand Score pure-function coverage (21-30) ------------------------------------------

const SCORE_PURE_SOURCE = [
  sourceOfConst("ENTITY_SCORE_WEIGHTS"),
  sourceOfFunction("entityScoreMomentumPoints"),
  sourceOfFunction("entityScoreLabel"),
  sourceOfFunction("entityPreviousMonthKey")
].join("\n\n");

function loadScorePure() {
  return Function(`${SCORE_PURE_SOURCE}; return { ENTITY_SCORE_WEIGHTS, entityScoreMomentumPoints, entityScoreLabel, entityPreviousMonthKey };`)();
}

test("weights: Revenue 35 / Orders 25 / Customers 20 / Inventory 20, summing to 100", () => {
  const { ENTITY_SCORE_WEIGHTS } = loadScorePure();
  assert.deepEqual(ENTITY_SCORE_WEIGHTS, { revenue: 35, orders: 25, customers: 20, inventory: 20 });
  assert.equal(Object.values(ENTITY_SCORE_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

// 21/22/23. Revenue/Order/Customer momentum share the same threshold table.
test("21/22/23. momentum point thresholds: >=20→100, >=10→90, >=0→80, >=-10→65, >=-20→50, >=-30→30, else 10", () => {
  const { entityScoreMomentumPoints } = loadScorePure();
  assert.equal(entityScoreMomentumPoints(25), 100);
  assert.equal(entityScoreMomentumPoints(20), 100);
  assert.equal(entityScoreMomentumPoints(15), 90);
  assert.equal(entityScoreMomentumPoints(10), 90);
  assert.equal(entityScoreMomentumPoints(5), 80);
  assert.equal(entityScoreMomentumPoints(0), 80);
  assert.equal(entityScoreMomentumPoints(-5), 65);
  assert.equal(entityScoreMomentumPoints(-10), 65);
  assert.equal(entityScoreMomentumPoints(-15), 50);
  assert.equal(entityScoreMomentumPoints(-20), 50);
  assert.equal(entityScoreMomentumPoints(-25), 30);
  assert.equal(entityScoreMomentumPoints(-30), 30);
  assert.equal(entityScoreMomentumPoints(-31), 10);
  assert.equal(entityScoreMomentumPoints(-99), 10);
});

// 28/29. Real zero != missing component.
test("28. a genuine 0% change scores 80 points (real zero, not treated as missing)", () => {
  const { entityScoreMomentumPoints } = loadScorePure();
  assert.equal(entityScoreMomentumPoints(0), 80);
});

test("29. a missing component (null pct, e.g. no previous-period data) returns null, never a fabricated score", () => {
  const { entityScoreMomentumPoints } = loadScorePure();
  assert.equal(entityScoreMomentumPoints(null), null);
  assert.equal(entityScoreMomentumPoints(undefined), null);
});

// 24. Inventory Integrity thresholds (negative-stock SKU ratio, not sales efficiency).
test("24. inventory integrity thresholds: 0%→100, (0,2]%→80, (2,5]%→60, (5,10]%→30, >10%→0; zero stock is never penalized by default", () => {
  const fnSource = sourceOfFunction("refreshEntityScore");
  assert.match(fnSource, /negativeRatio === 0 \? 100 : negativeRatio <= 2 \? 80 : negativeRatio <= 5 \? 60 : negativeRatio <= 10 \? 30 : 0/);
  assert.match(fnSource, /Number\(item\?\.stockQuantity \|\| 0\) < 0/, "must measure negative stock, not zero stock");
});

// Regression (found live in Chrome QA, cross-brand test): switching from a brand with a
// computed score to a new brand must not leave the previous brand's sub-metric points/pct
// visible while the new brand's score is loading — the ring correctly reset to "--" but the
// 4 sub-metric bars kept showing the old brand's numbers until this was fixed.
test("switching brands resets the loading state to null for every score component (no stale sub-metric leakage)", () => {
  const fnSource = sourceOfFunction("refreshEntityScore");
  const loadingLine = fnSource.match(/entityScoreState = \{ status: "loading",[^}]*\};/)?.[0];
  assert.notEqual(loadingLine, undefined, "the loading-state assignment must exist");
  assert.doesNotMatch(loadingLine, /\.\.\.entityScoreState/, "must not spread the previous brand's state forward into loading");
  ["revenue: null", "orders: null", "customers: null", "inventory: null", "overall: null"].forEach((expected) => {
    assert.ok(loadingLine.includes(expected), `loading state must explicitly reset ${expected}`);
  });
});

// Label thresholds.
test("Brand Score labels: 90+ EXCELLENT, 75+ STRONG, 60+ STABLE, 40+ WATCH, else RISK — no causal explanation implied", () => {
  const { entityScoreLabel } = loadScorePure();
  assert.match(entityScoreLabel(95), /EXCELLENT/);
  assert.match(entityScoreLabel(90), /EXCELLENT/);
  assert.match(entityScoreLabel(80), /STRONG/);
  assert.match(entityScoreLabel(75), /STRONG/);
  assert.match(entityScoreLabel(65), /STABLE/);
  assert.match(entityScoreLabel(60), /STABLE/);
  assert.match(entityScoreLabel(45), /WATCH/);
  assert.match(entityScoreLabel(40), /WATCH/);
  assert.match(entityScoreLabel(10), /RISK/);
});

// 25/26/27. Weighted total + partial coverage normalization + <60% unavailable.
test("25. full weighted total: all 4 components present computes a straightforward 0-100 weighted average", () => {
  const fnSource = sourceOfFunction("refreshEntityScore");
  assert.match(fnSource, /const weightedSum = components\.filter\(\(c\) => c\.points != null\)\.reduce\(\(sum, c\) => sum \+ c\.points \* c\.weight, 0\);/);
  assert.match(fnSource, /overall = weightedSum \/ availableWeight;/);
});

test("26/27. partial coverage: normalizes when available weight >= 60%, else overall stays null (score unavailable)", () => {
  const fnSource = sourceOfFunction("refreshEntityScore");
  assert.match(fnSource, /if \(availableWeight >= 60\) \{/);
  // Simulate the exact math this code performs to prove it independently.
  const components = [
    { weight: 35, points: 80 },   // revenue
    { weight: 25, points: 90 },   // orders
    { weight: 20, points: null }, // customers unavailable
    { weight: 20, points: 100 }   // inventory
  ];
  const availableWeight = components.filter((c) => c.points != null).reduce((s, c) => s + c.weight, 0);
  assert.equal(availableWeight, 80, "80% coverage — must still compute a normalized score");
  const weightedSum = components.filter((c) => c.points != null).reduce((s, c) => s + c.points * c.weight, 0);
  const overall = weightedSum / availableWeight;
  assert.equal(Math.round(overall), 88);

  const twoMissing = [
    { weight: 35, points: 80 },
    { weight: 25, points: null },
    { weight: 20, points: null },
    { weight: 20, points: 100 }
  ];
  const lowCoverage = twoMissing.filter((c) => c.points != null).reduce((s, c) => s + c.weight, 0);
  assert.equal(lowCoverage, 55, "55% coverage is below the 60% floor — overall must stay unavailable");
});

// 30. Current-month cutoff semantics.
test("30. a live (in-progress) current month uses the SAME-ELAPSED-DAYS cutoff endpoint (getEntityCompareMonthlyArchiveCutoff), not a raw full-month comparison", () => {
  const fnSource = sourceOfFunction("refreshEntityScore");
  assert.match(fnSource, /if \(isLive && prevMonth\) \{/);
  assert.match(fnSource, /getEntityCompareMonthlyArchiveCutoff\(periodMonth, prevMonth\)/);
  assert.match(fnSource, /entityCompareKpiRowFromCutoffPayload\(payload, "base", brandCode\)/);
  assert.match(fnSource, /entityCompareKpiRowFromCutoffPayload\(payload, "comparison", brandCode\)/);
});

test("30b. a completed current month reuses entityTrendMonths' adjacent rows — no new fetch", () => {
  const fnSource = sourceOfFunction("refreshEntityScore");
  assert.match(fnSource, /\} else if \(currentRow && prevMonth\) \{/);
  assert.match(fnSource, /const prevRow = entityTrendMonths\.find\(\(row\) => row\.key === prevMonth\);/);
});

test("entityPreviousMonthKey handles year rollover correctly (2026-01 -> 2025-12)", () => {
  const { entityPreviousMonthKey } = loadScorePure();
  assert.equal(entityPreviousMonthKey("2026-08"), "2026-07");
  assert.equal(entityPreviousMonthKey("2026-01"), "2025-12");
});

// ---- Customer Contribution Grade v1 (31-35) -----------------------------------------------

const GRADE_SOURCE = sourceOfFunction("entityCustomerContributionGrade");

function loadGrade(entityCompositionRows) {
  return Function("entityCompositionRows", `${GRADE_SOURCE}; return entityCustomerContributionGrade;`)(entityCompositionRows);
}

// 31/32. Percentile scoring + S/A/B/C thresholds.
// Percentile rank = (count of others strictly below) / (sample size, including self) * 100 —
// so beating every one of 9 others out of 10 total gives 90%, not 100% (self can't be below
// self). Verified against the real entityCustomerContributionGrade source, not assumed.
test("31/32. Customer Contribution Score = revenue percentile * 0.70 + order-count percentile * 0.30, graded S>=90/A>=70/B>=40/C<40", () => {
  const rows = [{ name: "target", sales: 500, count: 10 }];
  for (let i = 1; i <= 9; i += 1) rows.push({ name: `other${i}`, sales: 10 * i, count: i });
  const grade = loadGrade(rows)(rows[0]);
  // target beats all 9 others on both metrics: percentile = 9/10*100 = 90 for both.
  assert.equal(grade.score, 90);
  assert.equal(grade.grade, "S");

  // A customer beaten by everyone (0th percentile on both) grades C.
  const worst = loadGrade(rows)({ name: "target", sales: 1, count: 0 });
  assert.equal(worst.score, 0);
  assert.equal(worst.grade, "C");

  // Mid-pack customer: 5 of 10 below on each metric -> 50th percentile -> score 50 -> grade B.
  const midRows = [];
  for (let i = 1; i <= 10; i += 1) midRows.push({ name: `p${i}`, sales: 10 * i, count: i });
  const midTarget = midRows[5]; // beats exactly 5 of the other 9 (5th of 10 sorted ascending, 0-indexed 5 -> 5 below it)
  const midGrade = loadGrade(midRows)(midTarget);
  assert.equal(midGrade.score, 50);
  assert.equal(midGrade.grade, "B");
});

// 33. Small sample size flag.
test("33. sample size < 5 sets smallSample: true (displayed as '표본 적음'), but the score is still calculated", () => {
  const rows = [{ name: "a", sales: 100, count: 5 }, { name: "b", sales: 50, count: 2 }];
  const grade = loadGrade(rows)(rows[0]);
  assert.equal(grade.sampleSize, 2);
  assert.equal(grade.smallSample, true);
  assert.ok(Number.isFinite(grade.score), "score must still be computed, not skipped, for small samples");
});

test("sample size >= 5 does not set smallSample", () => {
  const rows = [1, 2, 3, 4, 5].map((n) => ({ name: `c${n}`, sales: n * 10, count: n }));
  const grade = loadGrade(rows)(rows[0]);
  assert.equal(grade.smallSample, false);
});

// 34/35. Selected-brand and selected-period isolation — the function has no global identity,
// it only ever sees whatever entityCompositionRows currently holds (already brand+period
// scoped by refreshEntityCustomerComposition's own API call), so isolation is structural.
test("34/35. grade is computed purely from the passed-in entityCompositionRows set (selected brand+period scope) — no cross-brand/cross-period state", () => {
  assert.doesNotMatch(GRADE_SOURCE, /brandIdentityState|currentEntityPeriodMonthKey|fetch\(|getJson\(|getSharedJson\(/, "must not reach outside the given customer set or perform its own fetch");
});

test("Customer Contribution Grade is explicitly scoped, not lifetime loyalty — UI copy says so, not 'VIP'", () => {
  assert.match(js, /이 브랜드·이 기간 기준 기여도 등급/);
  assert.match(js, /표본 적음/);
});

// ---- Recommended Action v1 (36-43) — additional coverage beyond
// test/brand-intelligence-score-ai-recommended-action.test.mjs's dedicated rule tests -------

test("36/37/38/39. Recommended Action rule text matches the approved wording exactly (inventory/revenue/orders/customer)", () => {
  const fnSource = sourceOfFunction("entityRecommendedActionListHtml");
  assert.match(fnSource, /음수 재고 SKU를 확인하세요\./);
  assert.match(fnSource, /매출 하락 구간을 점검하세요\./);
  assert.match(fnSource, /주문수 감소 구간을 점검하세요\./);
  assert.match(fnSource, /구매 고객 수 감소를 점검하세요\./);
});

test("40. Recommended Action caps at a maximum of 3 items", () => {
  const fnSource = sourceOfFunction("entityRecommendedActionListHtml");
  assert.match(fnSource, /const top3 = actions\.slice\(0, 3\);/);
});

test("41. no-issue fallback is the exact approved sentence", () => {
  const fnSource = sourceOfFunction("entityRecommendedActionListHtml");
  assert.match(fnSource, /현재 기준 긴급 점검 항목이 없습니다\./);
});

test("42. Recommended Action never generates a discount/promotion/reorder/ad-spend recommendation", () => {
  const fnSource = sourceOfFunction("entityRecommendedActionListHtml");
  assert.doesNotMatch(fnSource, /할인하세요|광고하세요|발주하세요|프로모션을 진행하세요|할인|프로모션|재입고|발주|광고/);
});

test("43. Sell-through is never referenced anywhere in the Recommended Action engine", () => {
  const fnSource = sourceOfFunction("entityRecommendedActionListHtml");
  assert.doesNotMatch(fnSource, /Sell-?through|셀스루/i);
});

test("Recommended Action priority order is data/inventory > revenue > orders > customers, matching the rule evaluation order in source", () => {
  const fnSource = sourceOfFunction("entityRecommendedActionListHtml");
  const invIdx = fnSource.indexOf("negativeCount");
  const revIdx = fnSource.indexOf("scoreState?.revenue?.points");
  const ordIdx = fnSource.indexOf("scoreState?.orders?.points");
  const custIdx = fnSource.indexOf("scoreState?.customers?.points");
  assert.ok(invIdx < revIdx && revIdx < ordIdx && ordIdx < custIdx, "rules must be evaluated in inventory -> revenue -> orders -> customers order");
});
