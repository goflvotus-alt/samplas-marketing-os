// STEP67 cross-brand-partial-period P1: 진행 중인(live) base 기간과 완결된 comparison
// 기간을 비교할 때 "같은 경과일" 기준으로 두 기간의 날짜 범위를 정규화하는 순수 함수.
// docs/reports/NEXT-CROSS-BRAND-PARTIAL-PERIOD-plan.md §6/§7의 계약을 그대로 구현한다.
// 판매 계산 로직은 전혀 포함하지 않는다 — 오직 날짜 범위만 계산한다(server.mjs의
// buildBrandSalesDiagnostics/mergeOfflineBrandSales가 그 범위로 실제 집계를 수행).

const monthKeyPattern = /^\d{4}-\d{2}$/;
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function assertMonthKey(value, label) {
  if (!monthKeyPattern.test(String(value || ""))) {
    throw new Error(`${label} must be YYYY-MM, got: ${value}`);
  }
}

function assertDateKey(value, label) {
  if (!dateKeyPattern.test(String(value || ""))) {
    throw new Error(`${label} must be YYYY-MM-DD, got: ${value}`);
  }
}

// server.mjs의 monthEndKey()와 동일한 Date.UTC(year, month, 0) 패턴 — 윤년/월별 일수를
// 정확히 계산하는 JS 내장 달력 연산을 그대로 재사용한다(새 달력 로직 발명 없음).
export function daysInMonth(monthKey) {
  assertMonthKey(monthKey, "monthKey");
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * base(현재 선택된 기간)와 comparison(비교 대상 기간)의 정규화된 날짜 범위를 계산한다.
 *
 * baseMonth === referenceDate의 월이면(진행 중인 현재 월) 두 기간 모두
 * "해당 월 1일 ~ 오늘과 같은 일(day)"로 clamp한다(비교 월이 더 짧으면 그 달의
 * 마지막 날로 clamp). 그렇지 않으면(완결된 과거 월 선택) 두 기간 모두 전체 월을
 * 그대로 사용하고 cutoffNormalized=false를 반환한다.
 */
export function resolveCrossBrandPeriodCutoff({ baseMonth, comparisonMonth, referenceDate }) {
  assertMonthKey(baseMonth, "baseMonth");
  assertMonthKey(comparisonMonth, "comparisonMonth");
  assertDateKey(referenceDate, "referenceDate");

  const referenceMonth = referenceDate.slice(0, 7);
  const isBaseLive = baseMonth === referenceMonth;

  if (!isBaseLive) {
    const baseDays = daysInMonth(baseMonth);
    const comparisonDays = daysInMonth(comparisonMonth);
    return {
      base: { month: baseMonth, startDate: `${baseMonth}-01`, endDate: `${baseMonth}-${pad2(baseDays)}`, isPartial: false },
      comparison: { month: comparisonMonth, startDate: `${comparisonMonth}-01`, endDate: `${comparisonMonth}-${pad2(comparisonDays)}`, isPartial: false },
      cutoffNormalized: false,
      elapsedDay: null
    };
  }

  const elapsedDay = Number(referenceDate.slice(8, 10));
  const baseDays = daysInMonth(baseMonth);
  const comparisonDays = daysInMonth(comparisonMonth);
  // baseMonth === referenceMonth이므로 elapsedDay는 항상 baseDays 이하이지만,
  // 방어적으로 동일한 clamp 규칙을 base/comparison 양쪽에 대칭 적용한다.
  const baseEndDay = Math.min(elapsedDay, baseDays);
  const comparisonEndDay = Math.min(elapsedDay, comparisonDays);

  return {
    base: { month: baseMonth, startDate: `${baseMonth}-01`, endDate: `${baseMonth}-${pad2(baseEndDay)}`, isPartial: true },
    comparison: { month: comparisonMonth, startDate: `${comparisonMonth}-01`, endDate: `${comparisonMonth}-${pad2(comparisonEndDay)}`, isPartial: true },
    cutoffNormalized: true,
    elapsedDay
  };
}
