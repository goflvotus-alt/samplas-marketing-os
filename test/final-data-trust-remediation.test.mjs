import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildBrandClientCross, reconcileHistoricalClientsSummary } from "../server.mjs";

const frontend = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

test("current lifecycle month wins initial selection and keeps ECOUNT badge in sync", () => {
  assert.match(frontend, /const lifecycleMonth = todayDateKey\(\)\.slice\(0, 7\)/);
  assert.match(frontend, /rows\.some\(\(item\) => item\.month === lifecycleMonth\) \? lifecycleMonth/);
  assert.match(frontend, /refreshEcountOfflineCard\(select\.value\)/);
  assert.match(frontend, /String\(data\.periodEnd \|\| ""\) < expectedEnd/);
});

test("Monthly initial navigation renders Daily and historical consumers request saved archive", () => {
  assert.match(frontend, /targetView === "Reports" && routeHash === "monthly-report"[\s\S]*renderActiveDestinationCards\(selectedMonth\(\)\)/);
  assert.match(frontend, /historicalMonth \? getJson\(`\/api\/reports\/monthly\?month=\$\{monthKey\}`/);
  assert.match(frontend, /onlineData = historicalArchiveDailyOnline\(historicalArchive\) \|\| onlineData/);
  assert.match(frontend, /Saved Archive 월 합계/);
  assert.match(frontend, /일별 귀속[\s\S]*미배분/);
  assert.match(frontend, /historicalArchive\?\.archiveStatus === "saved"[\s\S]*sales = \{ \.\.\.historicalArchive\.commerce/);
});

test("historical Clients preserves canonical aggregate and explicit unassigned accounting", () => {
  const result = reconcileHistoricalClientsSummary(
    { totalPurchaseCount: 10 },
    { totalSalesAmount: 286230120 },
    { sales: { onlineSales: { paidAmount: 34332620 }, offlineSales: { offlineSalesAmount: 253583500 }, totalSales: { amount: 287916120 } } }
  );
  assert.equal(result.summary.totalSalesAmount, 287916120);
  assert.equal(result.accounting.attributedRevenue + result.accounting.unassignedRevenue, 287916120);
  assert.equal(result.accounting.unassignedRevenue, 1686000);
});

test("partial UI shows facts without unequal-scope comparisons or false empty state", () => {
  assert.match(frontend, /PARTIAL TOTAL/);
  assert.match(frontend, /비교 불가 · 부분 집계/);
  assert.match(frontend, /executionDays !== comparisonDays/);
  assert.match(frontend, /확인된 상세 매출 · 부분 집계/);
  assert.match(frontend, /확인된 부분 매출/);
  assert.match(frontend, /const comparablePreviousCommerce = salesCoverageComplete \? summaryPreviousCommerce : \{\}/);
  assert.match(frontend, /const totalSalesPreviousForLink = salesCoverageComplete \?/);
  assert.doesNotMatch(frontend, /salesCoverageComplete \?[^;]+: 0;/);
  assert.match(frontend, /monthlyIntelKpiPopoverRows\("이번 달", totalSalesAmountForLink, totalSalesPreviousForLink, apiWon\)/);
});

test("Brand x Stylist rejects gross detail overcount and reconciles to canonical net", () => {
  const result = buildBrandClientCross([{
    clientId: "stylist-1",
    name: "스타일리스트",
    clientType: "stylist",
    totalSales: 81000,
    purchaseDetails: [{ canonicalBrandCode: "B1", canonicalBrandName: "BRAND", salesAmount: 3309400 }]
  }], 5596000);
  assert.deepEqual(result.items, []);
  assert.equal(result.coverage.assignedRevenue, 0);
  assert.equal(result.coverage.unassignedRevenue, 5596000);
  assert.equal(result.coverage.assignedRevenue + result.coverage.unassignedRevenue, result.coverage.totalRevenue);
});
