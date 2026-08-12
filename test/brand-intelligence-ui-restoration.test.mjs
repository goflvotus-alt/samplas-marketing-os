import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, js] = await Promise.all([
  readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8"),
  readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8")
]);

test("Brand Intelligence preserves approved UI shells without fabricated values", () => {
  assert.match(html, /id="entityCompareToggle"(?![^>]*(?:disabled|aria-disabled))/);
  assert.match(html, /class="brand-hero-score-block">/);
  assert.match(html, /지역 · 데이터 연결 대기/);
  assert.match(html, /id="entityCategoryToggle"[^>]*>/);
  assert.match(html, /id="entityCategoryContent">/);
  assert.match(html, /id="entitySystemStatusCafe24"/);
  assert.match(js, /brandSelectorRecentNames\.unshift\(name\)/);
  assert.match(js, /data-entity-drawer-quick-orders/);
  assert.match(js, /data-entity-drawer-quick-client/);
  assert.match(js, /data-client-workspace-related="clientOrders"/);
  // STEP67-8B baseline shells (STEP67-8D added pending-card/context variants that were
  // rejected on user Chrome QA and reverted — these assertions lock the approved 8B shells
  // and guard against the 8D variants silently coming back).
  assert.match(html, /entity-compare-mini-donut" role="img"/);
  assert.doesNotMatch(html, /entity-compare-mini-donut is-pending/);
  assert.doesNotMatch(js, /entity-trend-compare-pending/);
  assert.match(js, /data-category-unavailable/);
  assert.doesNotMatch(js, /data-category-pending-index/);
  assert.match(js, /class="entity-drawer-empty"/);
  assert.doesNotMatch(js, /entity-drawer-row entity-drawer-row-pending/);
  assert.doesNotMatch(js, /data-entity-context-source/);
  assert.doesNotMatch(js, /openEntityDrawer\("category", \{ sourceType: "category"/);
  assert.match(js, /\.filter\(\(type\) => type !== currentType\)/);

  for (const fabricated of [
    "34,466,777원", "31,120,000원", "3,346,777원", "스타일리스트 63%",
    "일반 고객 45%", "스타일리스트 +22%p"
  ]) assert.doesNotMatch(html, new RegExp(fabricated.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(js, /let entityTrendCompareMonths = \[\];/);
  assert.match(js, /const compareBrandName = entityCompareState\.enabled \? entityCompareBrandB\(\) : "비교 브랜드 선택"/);
  assert.match(js, /entityTrendCompareMonths = compareBrandCode \? months\.map/);
  assert.match(js, /monthlyReportBrandCode\(item\) === compareBrandCode/);
  assert.match(js, /const revenue = canonicalPaidAmount\(row\)/);
  assert.match(js, /if \(!row\) return null/);
  assert.match(js, /entityTrendCompareMonths\[index\]/);
  assert.match(js, /해당 월 데이터 없음/);
  assert.match(js, /comparePaths\.map/);
  assert.doesNotMatch(html, /BRAND COMPARISON\s*<span[^>]*>DATA CONNECTION PENDING<\/span>/);
  assert.doesNotMatch(html, /Comparison Summary\s*<span[^>]*>DATA CONNECTION PENDING<\/span>/);
  // STEP67-10G-3: 고정 placeholder 문구는 사라졌다 — renderEntityCompareSummary()가
  // buildComparisonSummaryFacts()의 결정론적 결과로 매번 다시 채운다(see
  // test/brand-comparison-summary.test.mjs). 여기서는 정적 fallback 문구만 확인한다.
  assert.match(html, /id="entityCompareSummaryText"[^>]*>기간 성과 수치는 위 표에서 확인할 수 있습니다\./);
  assert.match(js, /const entityCategoryRows = \[\];/);
  assert.match(html, /Sell-through[\s\S]*?공식 산식 필요/);
  assert.match(html, /Health Score/);
});
