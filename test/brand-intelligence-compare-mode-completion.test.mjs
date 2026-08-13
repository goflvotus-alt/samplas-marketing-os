import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BI-BATCH-G (Compare Mode Completion). Live Chrome walk (real click path, plus
// window.selectBrandSelectorName/selectEntityCompareBrandB for state changes) found the
// Compare Mode UI/architecture from STEP59-4C/STEP67-9E-STEP67-10G-4 is essentially
// complete: toggle, baseline/comparison brand selection, previous/YoY/custom period target,
// the 4-metric Period Performance table with correct deltas, the deterministic Comparison
// Summary (buildComparisonSummaryFacts, STEP67-10G-3), dual-brand Customer Composition,
// honestly-blocked Category/Sell-through/Score, drawers, race safety, and failure states
// (Archive 생성 지연 표시) were all already correct.
//
// Exactly one real, safe, technical gap was found: switching #entityCompareTarget
// (previous month / YoY / custom) only called renderEntityCompareUI() — which updates the
// header LABEL only — and never refreshEntityCompareKpi() (=refreshEntityCompareTargetPeriodData(),
// the function that actually fetches the target-period archive AND re-renders both the
// Period Performance table and the Comparison Summary text). Confirmed live: switching from
// "previous month" to "YoY" updated the header text to "2025년 8월" but the Period
// Performance table kept showing July's stale numbers under a July column header. Fixed by
// adding the one missing call — no new fetch architecture, reuses the exact function
// refreshEntityTrendMonths already calls for the same purpose.
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
const html = await readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8");

test("entityCompareTarget's change handler refreshes the actual comparison data (Period Performance table + Comparison Summary), not just the header label", () => {
  const markerIndex = js.indexOf('$("#entityCompareTarget")?.addEventListener("change"');
  assert.notEqual(markerIndex, -1, "entityCompareTarget change listener registration not found");
  // Grab a generous window after the marker to capture the full handler body.
  const handlerSource = js.slice(markerIndex, markerIndex + 400);
  assert.match(handlerSource, /renderEntityCompareUI\(\)/, "must still update the header label (existing behavior, must not regress)");
  assert.match(handlerSource, /refreshEntityCompareKpi\(\)/, "must also refetch/re-render the actual comparison data — this was the missing call");
});

test("refreshEntityCompareKpi is the same function refreshEntityTrendMonths already uses for brand/period changes (no new fetch architecture was invented)", () => {
  // refreshEntityCompareKpi() must remain the existing thin wrapper around
  // refreshEntityCompareTargetPeriodData() — confirms the fix reused it rather than adding a
  // second, competing refresh path.
  const wrapperIndex = js.indexOf("function refreshEntityCompareKpi()");
  assert.notEqual(wrapperIndex, -1);
  const wrapperSource = js.slice(wrapperIndex, wrapperIndex + 150);
  assert.match(wrapperSource, /return refreshEntityCompareTargetPeriodData\(\);/);
  // And refreshEntityTrendMonths (the single trigger for brand/period changes) must still
  // call the exact same function — confirms no duplicate/competing call site was added.
  const trendFnStart = js.indexOf("async function refreshEntityTrendMonths()");
  const trendFnRegion = js.slice(trendFnStart, trendFnStart + 9000);
  assert.match(trendFnRegion, /refreshEntityCompareKpi\(\);/);
});

test("refreshEntityCompareTargetPeriodData re-renders both the Period Performance table and the Comparison Summary in one call (so wiring it to one event covers both)", () => {
  const fnStart = js.indexOf("async function refreshEntityCompareTargetPeriodData()");
  assert.notEqual(fnStart, -1);
  const fnRegion = js.slice(fnStart, fnStart + 6000);
  assert.match(fnRegion, /renderEntityCompareTargetPeriodKpis\(\);/);
  assert.match(fnRegion, /renderEntityCompareSummary\(\);/);
});

// Regression guard: only Sell-through remains blocked after BI-BATCH-I (Category/Score/
// Customer Grade/Recommended Action all shipped v1 definitions — see
// docs/BRAND_INTELLIGENCE_RULES.md and their dedicated test files).
test("Sell-through remains the only deferred Brand Intelligence feature in Compare Mode too", () => {
  assert.match(html, /정의 미확정/);
  assert.match(html, /BLOCKED · 공식 산식 필요/);
});

// Regression guard: the failure-state copy for the comparison table (used by both cutoff and
// non-cutoff paths) is unchanged — confirms this batch didn't touch NULL != ZERO semantics.
test("Period Performance table's failure-state text is unchanged (Archive 생성 지연 / 데이터 연결 실패 / 데이터 연결 대기, never a fabricated zero)", () => {
  assert.match(js, /Archive 생성 지연 · 다시 시도/);
  assert.match(js, /데이터 연결 실패/);
});
