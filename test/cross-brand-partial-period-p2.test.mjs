import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// STEP67 cross-brand-partial-period P2: frontend wiring for the P1 cutoff contract.
// Same source-extraction + Function() pattern this repo already uses
// (test/brand-comparison-yoy-timeout.test.mjs, test/entity-composition-retry.test.mjs).
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOf(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} source missing`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(start, index + 1);
  }
  throw new Error(`${name} source incomplete`);
}

function loadEntityCompareKpiRowFromCutoffPayload() {
  return Function(`${sourceOf("entityCompareKpiRowFromCutoffPayload")}; return entityCompareKpiRowFromCutoffPayload;`)();
}

function loadEntityCompareCutoffRangeLabel() {
  return Function(`${sourceOf("entityCompareCutoffRangeLabel")}; return entityCompareCutoffRangeLabel;`)();
}

// 실측 payload(docs/reports/STEP67-cross-brand-partial-period-p1.md §14, 2026-08-11
// 기준, base=2026-08 vs compare=2026-07, cutoff 8/1~8/11 vs 7/1~7/11).
const CUTOFF_PAYLOAD = {
  cutoff: {
    base: { month: "2026-08", startDate: "2026-08-01", endDate: "2026-08-11", isPartial: true },
    comparison: { month: "2026-07", startDate: "2026-07-01", endDate: "2026-07-11", isPartial: true },
    cutoffNormalized: true,
    elapsedDay: 11
  },
  base: {
    brandSales: [
      { brand_code: "B00000KU", brand_name: "카르넷 아카이브", revenue: 10883059, quantitySold: 32, orderCount: 25, aov: 435322, onlineRevenue: 1021959, offlineRevenue: 9861100 },
      { brand_code: "B00000WW", brand_name: "TROUBLED WATERS", revenue: 8274400, quantitySold: 26, orderCount: 21, aov: 394019, onlineRevenue: 0, offlineRevenue: 8274400 }
    ]
  },
  comparison: {
    brandSales: [
      { brand_code: "B00000KU", brand_name: "카르넷 아카이브", revenue: 6481990, quantitySold: 19, orderCount: 17, aov: 381294, onlineRevenue: 161290, offlineRevenue: 6320700 },
      { brand_code: "B00000WW", brand_name: "TROUBLED WATERS", revenue: 1075000, quantitySold: 3, orderCount: 3, aov: 358333, onlineRevenue: 0, offlineRevenue: 1075000 }
    ]
  }
};

// ---------------------------------------------------------------------------
// 1-4. Revenue/Units/Orders/AOV render from the cutoff payload, mapped into the
// exact same row shape entityCompareKpiRowFromArchive() already produces (online/
// offline field names) so downstream renderers/Comparison Summary need no changes.
// ---------------------------------------------------------------------------
test("1-4. entityCompareKpiRowFromCutoffPayload extracts revenue/units/orders/aov/online/offline for the base period", () => {
  const extractRow = loadEntityCompareKpiRowFromCutoffPayload();
  const row = extractRow(CUTOFF_PAYLOAD, "base", "B00000KU");
  assert.deepEqual(row, { revenue: 10883059, quantitySold: 32, orderCount: 25, aov: 435322, online: 1021959, offline: 9861100 });
});

test("entityCompareKpiRowFromCutoffPayload extracts the comparison period using the same field shape", () => {
  const extractRow = loadEntityCompareKpiRowFromCutoffPayload();
  const row = extractRow(CUTOFF_PAYLOAD, "comparison", "B00000KU");
  assert.deepEqual(row, { revenue: 6481990, quantitySold: 19, orderCount: 17, aov: 381294, online: 161290, offline: 6320700 });
});

// ---------------------------------------------------------------------------
// 5. delta/difference columns automatically use normalized values because both
// current and target rows now come from the same cutoff payload (no separate
// delta calculation to test — entityCompareDeltaText() already just subtracts
// current[field] - target[field], unchanged).
// ---------------------------------------------------------------------------
test("5. base and comparison rows for the same brand come from the same cutoff window family, so deltas are normalized by construction", () => {
  const extractRow = loadEntityCompareKpiRowFromCutoffPayload();
  const base = extractRow(CUTOFF_PAYLOAD, "base", "B00000KU");
  const comparison = extractRow(CUTOFF_PAYLOAD, "comparison", "B00000KU");
  assert.equal(base.revenue - comparison.revenue, 10883059 - 6481990);
  assert.equal(base.orderCount - comparison.orderCount, 25 - 17);
});

// ---------------------------------------------------------------------------
// 6/7. Cutoff context label renders from server metadata, no hardcoded dates.
// ---------------------------------------------------------------------------
test("6/7. entityCompareCutoffRangeLabel renders the server-provided range, not a hardcoded date", () => {
  const rangeLabel = loadEntityCompareCutoffRangeLabel();
  assert.equal(rangeLabel(CUTOFF_PAYLOAD.cutoff.base), "8/1~8/11");
  assert.equal(rangeLabel(CUTOFF_PAYLOAD.cutoff.comparison), "7/1~7/11");
  // 다른 날짜를 넣으면 다른 라벨이 나와야 한다 — 하드코딩 텍스트가 아님을 증명.
  assert.equal(rangeLabel({ startDate: "2028-03-01", endDate: "2028-03-31" }), "3/1~3/31");
  assert.equal(rangeLabel(null), "");
});

// ---------------------------------------------------------------------------
// 8. Completed-month comparison does not show partial/cutoff context.
// ---------------------------------------------------------------------------
test("8. refreshEntityCompareTargetPeriodData only overwrites the header period labels when cutoffNormalized is true", () => {
  const source = sourceOf("refreshEntityCompareTargetPeriodData");
  assert.match(source, /if \(cutoff\?\.cutoffNormalized\) \{/);
  assert.match(source, /else if \(headerTargetEl\) \{\s*\n\s*headerTargetEl\.textContent = entityCompareTargetLabel\(\);/);
});

// ---------------------------------------------------------------------------
// 12-14. Switching comparison month / Brand A / Brand B does not retain stale
// facts — verified structurally: the existing entityCompareTargetPeriodRefreshSeq
// guard still runs immediately after both the cutoff fetch and the plain fetch.
// ---------------------------------------------------------------------------
test("12-14. the stale-response seq guard runs after both the cutoff branch and the plain-fetch branch", () => {
  const source = sourceOf("refreshEntityCompareTargetPeriodData");
  const matches = [...source.matchAll(/if \(seq !== entityCompareTargetPeriodRefreshSeq\) return;/g)];
  assert.equal(matches.length, 2, "expected the stale-guard in both the cutoff branch and the existing full-month branch");
});

// ---------------------------------------------------------------------------
// 15. Endpoint failure does not silently display a full-month comparison —
// verified structurally: the cutoff branch never calls getEntityCompareMonthlyArchive
// (the full-month fetch) as a fallback; it only ever nulls out the rows.
// ---------------------------------------------------------------------------
test("15. cutoff fetch failure nulls out all four rows instead of silently falling back to a full-month fetch", () => {
  const source = sourceOf("refreshEntityCompareTargetPeriodData");
  const cutoffBranchStart = source.indexOf("if (useCutoff) {");
  const cutoffBranchEnd = source.indexOf("} else {", cutoffBranchStart);
  assert.notEqual(cutoffBranchStart, -1);
  assert.notEqual(cutoffBranchEnd, -1);
  const cutoffBranch = source.slice(cutoffBranchStart, cutoffBranchEnd);
  assert.doesNotMatch(cutoffBranch, /getEntityCompareMonthlyArchive\(/, "the cutoff branch must never call the full-month archive fetch as a fallback");
  assert.match(cutoffBranch, /const payload = cutoffResult\.status === "success" \? cutoffResult\.payload : null;/);
});

// ---------------------------------------------------------------------------
// atomic update: entityCompareTargetPeriodData is replaced as one object in a
// single assignment in both branches (no partial field-by-field mutation that
// could leave e.g. revenue updated while orders/aov remain stale).
// ---------------------------------------------------------------------------
test("entityCompareTargetPeriodData is replaced atomically as a single object in both branches", () => {
  const source = sourceOf("refreshEntityCompareTargetPeriodData");
  const assignments = [...source.matchAll(/entityCompareTargetPeriodData = \{/g)];
  assert.equal(assignments.length, 2, "expected exactly one atomic assignment per branch (cutoff, full-month)");
});

// ---------------------------------------------------------------------------
// live-detection reuses the existing STEP67-10G-4 helper, no new "is live" logic.
// ---------------------------------------------------------------------------
test("cutoff-mode decision reuses entityIsLiveMonthRow() and entityTrendMonths, no new live-detection logic", () => {
  const source = sourceOf("refreshEntityCompareTargetPeriodData");
  assert.match(source, /entityTrendMonths\.find\(\(row\) => row\.key === currentKey\)/);
  assert.match(source, /entityIsLiveMonthRow\(currentTrendRow\)/);
});

// ---------------------------------------------------------------------------
// 16/17. Customer Composition and its retry fix are untouched by this STEP.
// ---------------------------------------------------------------------------
test("16/17. Customer Composition fetch/retry code is untouched by this STEP", () => {
  assert.match(js, /async function getEntityCompositionJson\(url\) \{/, "existing retry helper must still exist, unmodified");
  assert.match(js, /getEntityCompositionJson\(`\/api\/brand-intelligence\/\$\{encodeURIComponent\(brandBCode\)\}/);
  assert.match(js, /getEntityCompositionJson\(`\/api\/brand-intelligence\/\$\{encodeURIComponent\(brandCode\)\}/);
});

// ---------------------------------------------------------------------------
// 18. Category Intelligence remains untouched.
// ---------------------------------------------------------------------------
test("18. Category Intelligence code is untouched by this STEP", () => {
  assert.match(js, /const entityCategoryRows = \[\];/);
});
