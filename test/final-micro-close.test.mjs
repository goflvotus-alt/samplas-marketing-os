import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const frontend = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function functionBody(name, nextName) {
  const start = frontend.indexOf(`function ${name}(`);
  const end = frontend.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} must exist`);
  return frontend.slice(start, end);
}

test("historical month transitions drive Daily from reportsMonth and retain stale-response guards", () => {
  const setMonth = functionBody("setReportsMonth", "renderMonthRail");
  assert.match(setMonth, /renderReportsMonth\(reportsMonth, options\)/);
  assert.match(setMonth, /renderTodaySalesCalendar\(reportsMonth\)/);
  assert.doesNotMatch(setMonth, /renderActiveDestinationCards\(selectedMonth\(\)\)/);
  assert.match(frontend, /if \(renderSeq !== undefined && renderSeq !== reportsRenderSeq\) return;/);
  assert.match(frontend, /if \(renderSeq !== todaySalesCalendarRenderSeq\) return;/);
});

test("Today uses partial semantics even when API supplies a canonical total field", () => {
  const body = functionBody("todaySummarySalesInfo", "renderTodaySummary");
  assert.match(body, /if \(totalAvailable\) \{\s*const partial = totalSales\?\.coverage\?\.complete !== true;/);
  assert.match(body, /label: partial \? "확인된 부분 매출" : "총매출"/);
  assert.match(body, /label: partial \? "확인된 부분 매출" : "총매출", value: apiWon\(canonicalTotal\)/);
  assert.match(body, /const partial = totalSales\?\.coverage\?\.complete !== true;/);
});

test("Monthly Structure binds combined partial and online-only values to distinct labels", () => {
  assert.match(frontend, /const totalSalesLabel = salesCoverageComplete\s*\? "이번 달 총매출"\s*: hasPartialOfflineSales \? "확인된 부분 매출" : "이번 달 온라인 매출"/);
  assert.match(frontend, /monthlyIntelPopoverCard\(esc\(totalSalesLabel\), monthlyIntelKpiPopoverRows\("이번 달", totalSalesAmountForLink/);
  assert.match(frontend, /monthlyIntelPopoverCard\("이번 달 온라인 매출", monthlyIntelKpiPopoverRows\("이번 달", salesOnlineAmount/);
  assert.match(frontend, /\["상태", hasOfflineSales \? "완료" : "부분 집계"\]/);
});

test("historical Clients renders explicit attributed plus unassigned accounting", () => {
  assert.match(frontend, /renderClientsSummaryCards\([^\n]*data\.accounting \|\| null\)/);
  assert.match(frontend, /salesKpiCard\("미귀속 매출", apiWon\(accounting\.unassignedRevenue\)/);
  assert.match(frontend, /고객 귀속 \$\{apiWon\(accounting\.attributedRevenue\)\} \+ 미귀속 \$\{apiWon\(accounting\.unassignedRevenue\)\} = 전체 \$\{apiWon\(summary\.totalSalesAmount\)\}/);
});

test("Brand Performance drill-down keeps exact canonical lookup, inactive identity, month, and existing route", () => {
  assert.match(frontend, /brands\.filter\(\(brand\) => String\(brand\?\.brand_code \|\| ""\)\.trim\(\) !== "B0000000"\)\.forEach/);
  assert.match(frontend, /brandSelectorAllBrands = \[\.\.\.new Set\(selectableBrands\.map/);
  const open = functionBody("openBrandIntelligenceByCode", "verifyBrandIdentityMonthlyMapping");
  assert.match(open, /resolveBrandCodeToSelectorName\(brandCode\)/);
  assert.match(open, /entityPeriodState\.mode = "monthly"/);
  assert.match(open, /entityPeriodState\.year = year/);
  assert.match(open, /entityPeriodState\.month = month/);
  assert.match(open, /setActiveView\("BrandDashboard", \{ routeHash: "brand-dashboard" \}\)/);
  assert.match(open, /selectBrandSelectorName\(name\)/);
  assert.match(frontend, /openBrandIntelligenceByCode\(brandLink\.dataset\.monthlyIntelBrandCode, reportsMonth \|\| selectedMonth\(\)\.month\)/);
});
