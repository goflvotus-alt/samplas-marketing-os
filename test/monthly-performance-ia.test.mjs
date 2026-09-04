import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildStoreOfflineBrandSales } from "../server.mjs";
import { loadResolverContext } from "../scripts/unified-identity-resolver.mjs";

let js;
let html;
let css;

test.before(async () => {
  [js, html, css] = await Promise.all([
    readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8"),
    readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8"),
    readFile(new URL("../outputs/samplas-marketing-os.css", import.meta.url), "utf8")
  ]);
});

test("calendar is the first Monthly content and placeholder KPI is gone", () => {
  const reports = html.match(/<section id="Reports" class="view">[\s\S]*?<section id="Intelligence"/)[0];
  assert.ok(reports.indexOf('id="monthlyCalendarSlot"') < reports.indexOf('id="monthlyArchiveReport"'));
  assert.doesNotMatch(reports, /monthlyKpiSlot|Monthly Operations|이동 준비 영역/);
});

test("offline donut uses only APGUJEONG + VAIL as its denominator", () => {
  const fn = js.match(/function monthlyStoreDonutBlock\(offlineSnapshot\) \{[\s\S]*?\n}/)[0];
  assert.match(fn, /const total = byStore\.APGUJEONG \+ byStore\.VAIL;/);
  assert.match(fn, /share: monthlyReportRatio\(row\.amount, total\)/);
  assert.doesNotMatch(fn, /online|commerce|paidAmount/i);
});

test("store split never fabricates missing store values", () => {
  const fn = js.match(/function monthlyStorePerformanceBlock\(offlineSnapshot, previousOfflineSnapshot\) \{[\s\S]*?\n}/)[0];
  assert.match(fn, /current\.storesIncluded\.includes\(code\) && hasApiValue\(canonicalByStore\[code\]\)/);
  assert.match(fn, /included \? apiWon\(amount\) : "미분류"/);
  assert.match(fn, /previous\.storesIncluded\.includes\(code\)/);
  assert.match(fn, /"전월 비교 데이터 없음"/);
  assert.doesNotMatch(fn, /매장별 판매 데이터 업로드 후 표시됩니다/);
  assert.match(js, /getJson\(`\/api\/sales\/total\?since=\$\{monthStart\}&until=\$\{monthEnd\}`/);
  assert.match(js, /monthlyStorePerformanceBlock\(offlineSnapshot, previousOfflineSnapshot,[\s\S]*salesCoverageComplete\)/);
});

test("store TOP brands reuse canonical identity and never cross store boundaries", async () => {
  const identityContext = await loadResolverContext();
  const makeLine = (storeCode, salesAmount, productName, brandGroup) => ({
    storeCode, salesAmount, productName, brandGroup, date: "2026-08-13", quantity: 1,
    documentNo: `${storeCode}-${salesAmount}`, isOfflineRevenue: true
  });
  const result = buildStoreOfflineBrandSales({ salesLines: [
    makeLine("APGUJEONG", 97177900, "NAMILIA / Test Item", "NAM"),
    makeLine("VAIL", 70200, "PACOSPLY / WonderLand T-shirts BLACK", "PAC"),
    makeLine("APGUJEONG", 99, "UNKNOWN PRODUCT", "UNKNOWN")
  ] }, { since: "2026-08-01", until: "2026-08-31", identityContext });

  assert.equal(result.APGUJEONG.find((row) => row.brand_code === "B00000SK")?.offlineSalesAmount, 97177900);
  assert.equal(result.VAIL.find((row) => row.brand_code === "B00000ZT")?.offlineSalesAmount, 70200);
  assert.equal(result.APGUJEONG.find((row) => row.brand_code === "B00000ZT"), undefined);
  assert.equal(result.VAIL.find((row) => row.brand_code === "B00000SK"), undefined);
  assert.equal(result.APGUJEONG.find((row) => row.brand_code === "UNASSIGNED")?.offlineSalesAmount, 99);
  assert.equal(result.VAIL.length, 1, "one real VEIL brand renders as one row");
});

test("VEIL is display-only while the internal VAIL contract remains unchanged", () => {
  assert.match(html, /<option value="VAIL">VEIL<\/option>/);
  assert.match(js, /STORE_FILTER_LABELS = \{ APGUJEONG: "압구정", VAIL: "VEIL" \}/);
  assert.match(js, /storesIncluded\.includes\("VAIL"\)/);
  assert.match(js, /"VailIntelligence"/);
});

test("store and brand cards reuse existing Intelligence navigation", () => {
  assert.match(js, /data-jump-view="\$\{viewName\}"/);
  assert.match(js, /monthlyIntelBrandLabelHtml\(item, brandPerformancePaidAmount\(item\)/);
  assert.match(js, /data-monthly-intel-brand-code/);
});

test("online details are compact and route to Commerce", () => {
  assert.match(js, /<p class="eyebrow">Online Summary<\/p>/);
  assert.match(js, /data-jump-view="Sales">Commerce →/);
  assert.doesNotMatch(js.match(/async function renderMonthlyArchiveReport[\s\S]*?\n}\n\nfunction miniMetric/)[0], /결제수단 구성|상품 매출 TOP 5/);
});

test("responsive layout covers all new Monthly grids", () => {
  assert.match(css, /\.monthly-sales-structure-grid/);
  assert.match(css, /\.monthly-store-performance-grid/);
  assert.match(css, /\.monthly-online-summary/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.monthly-store-performance-grid/);
  assert.match(css, /@media \(min-width: 721px\) and \(max-width: 1020px\)[\s\S]*\.app-shell:has\(#Reports\.active\)/);
});
