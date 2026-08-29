import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveCrossBrandPeriodCutoff, daysInMonth } from "../scripts/cross-brand-period-cutoff.mjs";

// STEP67 cross-brand-partial-period P1: resolveCrossBrandPeriodCutoff()/daysInMonth()는
// 새 독립 모듈(scripts/cross-brand-period-cutoff.mjs)의 named export라 직접 import해서
// 테스트한다(test/unified-identity-resolver.test.mjs와 동일한 방식). crossBrandPeriodBrandRow()
// 는 server.mjs 내부 비공개 함수라, 이 저장소가 이미 쓰는 소스 추출(sourceOf) + Function()
// 실행 패턴(test/brand-comparison-yoy-timeout.test.mjs와 동일)으로 격리해서 검증한다.
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

function sourceOf(name) {
  const start = serverSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} source missing from server.mjs`);
  // 매개변수가 구조분해 할당({...})이면 그 자체의 중괄호를 함수 본문 시작으로
  // 착각할 수 있다 — 괄호 깊이로 매개변수 목록이 끝나는 지점을 먼저 찾고,
  // 그 뒤에 나오는 첫 "{"부터 중괄호 깊이 매칭을 시작한다.
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = start; index < serverSource.length; index += 1) {
    if (serverSource[index] === "(") parenDepth += 1;
    if (serverSource[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { paramsEnd = index; break; }
    }
  }
  assert.notEqual(paramsEnd, -1, `${name} parameter list incomplete`);
  const bodyStart = serverSource.indexOf("{", paramsEnd);
  let depth = 0;
  let opened = false;
  for (let index = bodyStart; index < serverSource.length; index += 1) {
    if (serverSource[index] === "{") { depth += 1; opened = true; }
    if (serverSource[index] === "}" && --depth === 0 && opened) return serverSource.slice(start, index + 1);
  }
  throw new Error(`${name} source incomplete`);
}

function loadCrossBrandPeriodBrandRow() {
  return Function(`${sourceOf("crossBrandPeriodBrandRow")}; return crossBrandPeriodBrandRow;`)();
}

function loadCrossBrandPeriodIdentityCoverage() {
  return Function(`${sourceOf("crossBrandPeriodIdentityCoverage")}; return crossBrandPeriodIdentityCoverage;`)();
}

// ---------------------------------------------------------------------------
// 1. Aug 11 vs Jul 11
// ---------------------------------------------------------------------------
test("1. live base 2026-08 (today=2026-08-11) vs comparison 2026-07 normalizes to 8/1~8/11 and 7/1~7/11", () => {
  const cutoff = resolveCrossBrandPeriodCutoff({ baseMonth: "2026-08", comparisonMonth: "2026-07", referenceDate: "2026-08-11" });
  assert.deepEqual(cutoff.base, { month: "2026-08", startDate: "2026-08-01", endDate: "2026-08-11", isPartial: true });
  assert.deepEqual(cutoff.comparison, { month: "2026-07", startDate: "2026-07-01", endDate: "2026-07-11", isPartial: true });
  assert.equal(cutoff.cutoffNormalized, true);
  assert.equal(cutoff.elapsedDay, 11);
});

// ---------------------------------------------------------------------------
// 2. Aug 11 vs YoY 2025-08-11
// ---------------------------------------------------------------------------
test("2. live base 2026-08 vs YoY comparison 2025-08 normalizes to 8/1~8/11 both years", () => {
  const cutoff = resolveCrossBrandPeriodCutoff({ baseMonth: "2026-08", comparisonMonth: "2025-08", referenceDate: "2026-08-11" });
  assert.deepEqual(cutoff.base, { month: "2026-08", startDate: "2026-08-01", endDate: "2026-08-11", isPartial: true });
  assert.deepEqual(cutoff.comparison, { month: "2025-08", startDate: "2025-08-01", endDate: "2025-08-11", isPartial: true });
  assert.equal(cutoff.cutoffNormalized, true);
});

// ---------------------------------------------------------------------------
// 3. March 31 vs February clamp (non-leap year)
// ---------------------------------------------------------------------------
test("3. base 2026-03-31 (live) vs comparison 2026-02 clamps to the last valid February day (28)", () => {
  const cutoff = resolveCrossBrandPeriodCutoff({ baseMonth: "2026-03", comparisonMonth: "2026-02", referenceDate: "2026-03-31" });
  assert.equal(daysInMonth("2026-02"), 28, "2026 is not a leap year");
  assert.deepEqual(cutoff.base, { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31", isPartial: true });
  assert.deepEqual(cutoff.comparison, { month: "2026-02", startDate: "2026-02-01", endDate: "2026-02-28", isPartial: true });
  assert.equal(cutoff.elapsedDay, 31);
});

// ---------------------------------------------------------------------------
// 4. Leap-year February clamp
// ---------------------------------------------------------------------------
test("4. base 2028-03-31 (live) vs comparison 2028-02 clamps to the leap-year last day (29)", () => {
  assert.equal(daysInMonth("2028-02"), 29, "2028 is a leap year");
  const cutoff = resolveCrossBrandPeriodCutoff({ baseMonth: "2028-03", comparisonMonth: "2028-02", referenceDate: "2028-03-31" });
  assert.equal(cutoff.comparison.endDate, "2028-02-29");
});

// ---------------------------------------------------------------------------
// 5. Completed June vs completed May remains full-month
// ---------------------------------------------------------------------------
test("5. completed base month (not the real current month) compares full month vs full month", () => {
  const cutoff = resolveCrossBrandPeriodCutoff({ baseMonth: "2026-06", comparisonMonth: "2026-05", referenceDate: "2026-08-11" });
  assert.deepEqual(cutoff.base, { month: "2026-06", startDate: "2026-06-01", endDate: "2026-06-30", isPartial: false });
  assert.deepEqual(cutoff.comparison, { month: "2026-05", startDate: "2026-05-01", endDate: "2026-05-31", isPartial: false });
  assert.equal(cutoff.cutoffNormalized, false);
  assert.equal(cutoff.elapsedDay, null);
});

// ---------------------------------------------------------------------------
// 6/7. Brand A and Brand B share the identical base/comparison window
// ---------------------------------------------------------------------------
test("6/7. the resolved base and comparison windows are brand-agnostic (same window applies to every brand)", () => {
  // resolveCrossBrandPeriodCutoff는 브랜드 파라미터를 아예 받지 않는다 — 반환된
  // base/comparison range는 구조적으로 모든 브랜드에 동일하게 적용된다(Brand A/B
  // 분기가 코드에 존재하지 않음, plan.md §9). 같은 입력으로 두 번 호출해도 완전히
  // 동일한 결과가 나옴을 통해 이 대칭성을 확인한다(순수 함수, 숨은 브랜드별 상태 없음).
  const first = resolveCrossBrandPeriodCutoff({ baseMonth: "2026-08", comparisonMonth: "2026-07", referenceDate: "2026-08-11" });
  const second = resolveCrossBrandPeriodCutoff({ baseMonth: "2026-08", comparisonMonth: "2026-07", referenceDate: "2026-08-11" });
  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------------
// 8-13. crossBrandPeriodBrandRow — Revenue/Units/Orders/AOV/onlineRevenue/offlineRevenue
// ---------------------------------------------------------------------------
test("8-13. crossBrandPeriodBrandRow projects revenue/units/orders/aov/online/offline from a single row", () => {
  const projectRow = loadCrossBrandPeriodBrandRow();
  const row = projectRow({
    brand_code: "B00000KU",
    brand_name: "카르넷 아카이브",
    canonicalPaidAmount: 6482990,
    quantitySold: 19,
    orderCount: 17,
    onlinePaidAmount: 161290,
    offlineSalesAmount: 6320700
  });
  assert.equal(row.revenue, 6482990, "8. revenue uses the row's canonicalPaidAmount, i.e. the cutoff window's aggregate");
  assert.equal(row.quantitySold, 19, "9. units uses the cutoff window's quantitySold");
  assert.equal(row.orderCount, 17, "10. orders uses the cutoff window's orderCount");
  assert.equal(row.aov, Math.round(6482990 / 17), "11. AOV = cutoff revenue / cutoff orders from the exact same row");
  assert.equal(row.onlineRevenue, 161290, "12. onlineRevenue uses the cutoff window's onlinePaidAmount");
  assert.equal(row.offlineRevenue, 6320700, "13. offlineRevenue uses the cutoff window's offlineSalesAmount");
});

// ---------------------------------------------------------------------------
// 14. zero-order AOV policy
// ---------------------------------------------------------------------------
test("14. zero orders in the cutoff window yields AOV=0, not null, not NaN, not Infinity (existing policy)", () => {
  const projectRow = loadCrossBrandPeriodBrandRow();
  const row = projectRow({
    brand_code: "B00000WW",
    brand_name: "TROUBLED WATERS",
    canonicalPaidAmount: 0,
    quantitySold: 0,
    orderCount: 0,
    onlinePaidAmount: 0,
    offlineSalesAmount: 0
  });
  assert.equal(row.aov, 0);
  assert.notEqual(row.aov, null);
  assert.ok(Number.isFinite(row.aov));
});

// ---------------------------------------------------------------------------
// 15. brand with no rows in the cutoff window never becomes a fake row
// ---------------------------------------------------------------------------
test("15. a brand absent from the cutoff window's brandSales array is simply not represented (Null != Zero, inherited from mergeOfflineBrandSales)", () => {
  // crossBrandPeriodBrandRow()는 이미 존재하는 행만 매핑한다 — "행이 아예 없음"은
  // 이 함수가 만드는 것이 아니라 mergeOfflineBrandSales()/aggregateCafe24BrandSalesByBrandCode()
  // 가 그 브랜드의 라인이 cutoff 범위 안에 하나도 없을 때 이미 보장하는 것이다(기존 동작,
  // scripts/monthly-brand-sales.mjs 재사용 — 새 null/zero 정책을 만들지 않았음을 구조로 확인).
  const brandSales = [{ brand_code: "B00000KU", canonicalPaidAmount: 100, orderCount: 1, quantitySold: 1 }];
  assert.equal(brandSales.find((row) => row.brand_code === "B00000WW"), undefined);
});

test("cutoff identity coverage is complete only when no revenue is UNASSIGNED", () => {
  const coverage = loadCrossBrandPeriodIdentityCoverage();
  assert.deepEqual(coverage([
    { brand_code: "B00000SA", revenue: 100 },
    { brand_code: "B00000KU", revenue: 200 }
  ]), {
    totalRevenue: 300,
    assignedRevenue: 300,
    unassignedRevenue: 0,
    status: "COMPLETE",
    complete: true
  });
  assert.deepEqual(coverage([
    { brand_code: "B00000SA", revenue: 100 },
    { brand_code: "UNASSIGNED", revenue: 200 }
  ]), {
    totalRevenue: 300,
    assignedRevenue: 100,
    unassignedRevenue: 200,
    status: "INCOMPLETE",
    complete: false
  });
});

// ---------------------------------------------------------------------------
// Invalid input hygiene
// ---------------------------------------------------------------------------
test("resolver rejects malformed month/date inputs instead of silently producing wrong ranges", () => {
  assert.throws(() => resolveCrossBrandPeriodCutoff({ baseMonth: "2026-8", comparisonMonth: "2026-07", referenceDate: "2026-08-11" }));
  assert.throws(() => resolveCrossBrandPeriodCutoff({ baseMonth: "2026-08", comparisonMonth: "not-a-month", referenceDate: "2026-08-11" }));
  assert.throws(() => resolveCrossBrandPeriodCutoff({ baseMonth: "2026-08", comparisonMonth: "2026-07", referenceDate: "2026/08/11" }));
});

// ---------------------------------------------------------------------------
// Server wiring: endpoint exists, uses the resolver + existing canonical aggregators,
// does not read/write the monthly archive cache (stale-archive independence, structural).
// ---------------------------------------------------------------------------
test("server route wires the new endpoint to the resolver and existing canonical aggregators only", () => {
  assert.match(serverSource, /url\.pathname === "\/api\/reports\/monthly-comparison-cutoff"/);
  assert.match(serverSource, /resolveCrossBrandPeriodCutoff\(/);
  const payloadFnSource = sourceOf("buildCrossBrandComparisonPeriodPayload");
  assert.match(payloadFnSource, /buildCrossBrandPeriodWindow\(cutoff\.base\)/);
  assert.match(payloadFnSource, /buildCrossBrandPeriodWindow\(cutoff\.comparison\)/);
  const windowFnSource = sourceOf("buildCrossBrandPeriodWindow");
  assert.match(windowFnSource, /buildBrandSalesDiagnostics\(range\.startDate, range\.endDate\)/);
  assert.match(windowFnSource, /buildMonthlyArchiveBrandSales\(range\.startDate, range\.endDate, commerceSource\)/);
  assert.match(windowFnSource, /coverage: crossBrandPeriodIdentityCoverage\(rows\)/);
  // 16. work/monthly 캐시(readMonthlyArchive/writeMonthlyArchive)를 이 경로가 전혀
  // 참조하지 않는지 구조적으로 확인 — stale-archive 캐시와 무관함을 보증한다.
  assert.doesNotMatch(payloadFnSource, /readMonthlyArchive|writeMonthlyArchive/);
  assert.doesNotMatch(windowFnSource, /readMonthlyArchive|writeMonthlyArchive/);
});
