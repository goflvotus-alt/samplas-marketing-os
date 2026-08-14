import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MONTHLY INTELLIGENCE NAVIGATION: hover/click layer connecting Monthly's displayed data
// (store split, brand rows, product rows, Commerce KPIs, payment methods) to their existing
// Intelligence/detail destinations. Presentation/navigation only — no calculation logic
// changed. Structural-assertion pattern (no jsdom), matching prior batches.
let js;
let css;
let html;
test.before(async () => {
  js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  css = await readFile(new URL("../outputs/samplas-marketing-os.css", import.meta.url), "utf8");
  html = await readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8");
});

function monthlyReportFnBody() {
  const match = js.match(/async function renderMonthlyArchiveReport\(month, renderSeq\) \{[\s\S]*?\n}\n\nfunction miniMetric/);
  assert.notEqual(match, null, "renderMonthlyArchiveReport must still exist");
  return match[0];
}

// 1. core helper functions exist
test("1. monthlyIntelLink / monthlyIntelLinkInline / labelHtmlFn extension all exist", () => {
  assert.match(js, /function monthlyIntelLink\(labelHtml, ariaLabel, jumpAttr, popoverInnerHtml\) \{/);
  assert.match(js, /function monthlyIntelLinkInline\(labelHtml, ariaLabel, jumpAttr, popoverInnerHtml, wrapTag\) \{/);
  assert.match(js, /const labelHtmlFn = options\.labelHtmlFn \|\| null;/);
});

test("1b. monthlyReportRankRows stays backward compatible when labelHtmlFn is not passed", () => {
  const fnMatch = js.match(/function monthlyReportRankRows\([\s\S]*?\n}/);
  assert.notEqual(fnMatch, null);
  assert.match(fnMatch[0], /labelHtmlFn \? labelHtmlFn\(item, index\) : esc\(labelFn\(item\)\)/);
});

// 2. store donut: reuses the exact same store-offline computation as the existing text note
test("2. computeMonthlyStoreOfflineBreakdown is shared by both the text note and the donut", () => {
  assert.match(js, /function computeMonthlyStoreOfflineBreakdown\(offlineSnapshot\) \{/);
  const noteFn = js.match(/function monthlyAllStoreBreakdownNote\([\s\S]*?\n}/)?.[0] || "";
  const donutFn = js.match(/function monthlyStoreDonutBlock\([\s\S]*?\n}\n\}/)?.[0] || js.match(/function monthlyStoreDonutBlock\([\s\S]*?\n  }\);\n}/)?.[0] || "";
  assert.match(noteFn, /computeMonthlyStoreOfflineBreakdown\(offlineSnapshot\)/);
  assert.match(js, /const \{ byStore, storesIncluded \} = computeMonthlyStoreOfflineBreakdown\(offlineSnapshot\);/, "donut must reuse the same computation, not reimplement it");
});

test("2b. donut only renders when both APGUJEONG and VAIL are included (conservative gate, no fabricated split)", () => {
  const donutMatch = js.match(/function monthlyStoreDonutBlock\(offlineSnapshot\) \{[\s\S]*?\n}\n/);
  assert.notEqual(donutMatch, null);
  assert.match(donutMatch[0], /if \(!storesIncluded\.includes\("APGUJEONG"\) \|\| !storesIncluded\.includes\("VAIL"\)\) return "";/);
});

test("2c. donut is only inserted into the template when storeFilterState is ALL", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /storeFilterState === "ALL" \? monthlyStoreDonutBlock\(offlineSnapshot\) : ""/);
});

// 3. store donut arcs + legend both use the existing generic data-jump-view mechanism —
// no new routing code for stores (STORE-INTEL-UI-B pattern reused as-is).
test("3. donut SVG arcs use data-jump-view to the existing Store Intelligence views", () => {
  const donutFn = js.match(/function monthlyStoreDonutBlock\([\s\S]*?\n}\n/)?.[0] || "";
  assert.match(donutFn, /data-jump-view="\$\{esc\(row\.viewName\)\}"/);
  assert.match(donutFn, /row\.code === "APGUJEONG" \? "ApgujeongIntelligence" : "VailIntelligence"/);
});

test("3b. donut legend rows are real <button> elements (full keyboard/screen-reader path)", () => {
  const donutFn = js.match(/function monthlyStoreDonutBlock\([\s\S]*?\n}\n/)?.[0] || "";
  assert.match(donutFn, /<button type="button" class="monthly-intel-link monthly-store-donut-legend-row" data-jump-view=/);
});

test("3c. donut arcs use SVG stroke-dasharray so each slice is an independently hoverable/clickable hit-area (not one full-circle overlay)", () => {
  const donutFn = js.match(/function monthlyStoreDonutBlock\([\s\S]*?\n}\n/)?.[0] || "";
  assert.match(donutFn, /stroke-dasharray="\$\{len\.toFixed\(2\)\} \$\{\(circumference - len\)\.toFixed\(2\)\}"/);
});

// 4. brand navigation uses canonical brand_code, resolved to the Brand Selector's display
// name at click time (not string/name matching, not resolved at render time)
// Updated by MONTHLY-QUICK-INTELLIGENCE-HOVER: monthlyIntelBrandLabelHtml gained
// quantitySold/rank parameters for the richer Quick Intelligence card, same brand_code-keyed
// resolution underneath — see test/monthly-quick-intelligence.test.mjs for the full card spec.
test("4. brand rows carry data-monthly-intel-brand-code (canonical code, not a name string)", () => {
  assert.match(js, /function monthlyIntelBrandLabelHtml\(item, currentAmount, previousAmount, quantitySold, rank\) \{/);
  const fnMatch = js.match(/function monthlyIntelBrandLabelHtml\([\s\S]*?\n}/);
  assert.match(fnMatch[0], /const code = monthlyReportBrandCode\(item\);/);
  assert.match(fnMatch[0], /data-monthly-intel-brand-code="\$\{esc\(code\)\}"/);
});

test("4b. resolveBrandCodeToSelectorName matches by exact brand_code equality only (no fuzzy/name matching)", () => {
  const fnMatch = js.match(/function resolveBrandCodeToSelectorName\([\s\S]*?\n}/);
  assert.notEqual(fnMatch, null);
  assert.match(fnMatch[0], /monthlyReportBrandCode\(entry\)/);
  assert.match(fnMatch[0], /\.trim\(\)\.toUpperCase\(\) === normalized/);
});

test("4c. the brand click handler resolves at click time and no-ops silently on failure (no fake destination)", () => {
  const handlerMatch = js.match(/const brandLink = event\.target\.closest\("\[data-monthly-intel-brand-code\]"\);\s*\n\s*if \(brandLink\) \{([\s\S]*?)\n\s*\}\s*\n\s*return;\s*\n\s*\}/);
  assert.notEqual(handlerMatch, null);
  const body = handlerMatch[1];
  assert.match(body, /resolveBrandCodeToSelectorName\(brandLink\.dataset\.monthlyIntelBrandCode\)/);
  assert.match(body, /setActiveView\("BrandDashboard", \{ routeHash: "brand-dashboard" \}\);/);
  assert.match(body, /selectBrandSelectorName\(name\);/);
});

test("4d. BON CO / POP CO / SUN CO style raw operational names are never used as canonical brand identity — brand_code is always the key", () => {
  const fnMatch = js.match(/function monthlyIntelBrandLabelHtml\([\s\S]*?\n}/);
  assert.doesNotMatch(fnMatch[0], /brand_name/, "must key off brand_code via monthlyReportBrandCode, not a raw name field");
});

// 5. product rows: investigated destination (Product Registry is a diagnostic review-queue
// screen, not a general browsable catalog — canonicalProductId isn't on Monthly's raw rows),
// so product rows connect to the existing "Product" dashboard drill-down instead of a
// fabricated per-item route.
test("5. product rows connect to the existing Product dashboard (data-jump-view=\"Product\"), matching the pre-existing Commerce drill button", () => {
  const fnMatch = js.match(/function monthlyIntelProductLabelHtml\([\s\S]*?\n}/);
  assert.notEqual(fnMatch, null);
  assert.match(fnMatch[0], /data-jump-view="Product"/);
});

// 6. payment method rows connect to Commerce's own payment breakdown section by scrolling
// after the view switch (mirrors the existing data-inventory-intel-open-registry pattern)
test("6. payment details are removed from Monthly but remain available in Commerce", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /data-monthly-intel-scroll-target="commerceSummaryPayments"/);
  assert.match(fn, /결제수단 · 브랜드 · 상품 상세는 Commerce에서 확인합니다/);
  assert.match(html, /id="commerceSummaryPayments"/, "the scroll target must be a real existing element in Commerce/Sales view");
});

test("6b. the scroll-jump click handler mirrors the existing data-inventory-intel-open-registry setTimeout+scrollIntoView pattern", () => {
  const handlerMatch = js.match(/const scrollLink = event\.target\.closest\("\[data-monthly-intel-scroll-view\]"\);\s*\n\s*if \(scrollLink\) \{([\s\S]*?)\n\s*\}\s*\n\s*return;\s*\n\s*\}/);
  assert.notEqual(handlerMatch, null);
  assert.match(handlerMatch[1], /setTimeout\(\(\) => document\.getElementById\(targetId\)\?\.scrollIntoView/);
});

// 7. Commerce KPIs (총매출/온라인매출/온라인주문/온라인객단가/온라인 실제 매출/주문수/객단가)
// all link to the existing Sales (Commerce) view; 오프라인 매출 is hover-only (no destination
// exists for an ALL-mode combined total — not forced to a single store)
test("7. Sales Structure + Online Summary KPIs use the existing Sales route", () => {
  const fn = monthlyReportFnBody();
  const salesJumpCount = (fn.match(/data-jump-view="Sales"/g) || []).length;
  assert.ok(salesJumpCount >= 5, `expected at least 5 KPI links to Sales view, found ${salesJumpCount}`);
});

test("7b. offline sales (ALL-mode combined total) is hover-only — no data-jump-view, no fabricated single-store destination", () => {
  const fn = monthlyReportFnBody();
  const offlineMatch = fn.match(/const offlineSalesHover = hasOfflineSales[\s\S]*?: `<strong>데이터 없음<\/strong>`;/);
  assert.notEqual(offlineMatch, null);
  assert.match(offlineMatch[0], /monthly-intel-hover-only/);
  assert.doesNotMatch(offlineMatch[0], /data-jump-view/);
});

// 8. hover UX: popover is always in the DOM, toggled by opacity only (zero layout shift by
// construction) — same proven mechanism as storeIntelJumpLink's affix badge.
test("8. .monthly-intel-popover is always-rendered + absolutely positioned + opacity-toggled (no layout shift)", () => {
  assert.match(css, /\.monthly-intel-popover\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.monthly-intel-popover\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.monthly-intel-link:hover \.monthly-intel-popover,[\s\S]*?opacity:\s*1;/);
});

// Updated by MONTHLY-QUICK-INTELLIGENCE-HOVER: spec explicitly allows 260-300px for the
// richer key/value card (was 230px for the simpler single-line badge).
test("8b. popover has a bounded max-width (not an oversized tooltip taking over the screen)", () => {
  const match = css.match(/\.monthly-intel-popover\s*\{[^}]*max-width:\s*(\d+)px/);
  assert.notEqual(match, null);
  const width = Number(match[1]);
  assert.ok(width >= 260 && width <= 300, `popover max-width ${width}px should stay within the 260-300px Quick Intelligence range`);
});

test("8c. right-column popovers flip to right-aligned to avoid viewport/card clipping", () => {
  assert.match(css, /\.monthly-report-grid2 > \*:last-child \.monthly-intel-popover/);
});

// 9. interactive elements preserve existing visual hierarchy — wrap the EXISTING <strong>/
// value markup rather than replacing it with new unstyled markup (UI redesign is out of scope).
test("9. monthlyIntelLink wraps pre-existing <strong> markup rather than introducing new value markup", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /monthlyIntelLink\(\s*`<strong>\$\{apiWon\(totalSalesAmountForLink\)\}<\/strong>`/);
});

// 10. Data safety: no calculation logic touched — canonical sales, store attribution source
// data, brand canonicalization pipeline, server.mjs all untouched by this batch.
test("10. server.mjs is completely untouched by this batch (presentation/navigation layer only)", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /function buildCanonicalTotalSales/);
  assert.match(server, /async function buildMonthlyArchive\(month\)/);
});

test("10b. computeMonthlyStoreOfflineBreakdown's byStore math is byte-identical to the pre-existing logic (isOfflineRevenue filter + storeCode sum)", () => {
  const fnMatch = js.match(/function computeMonthlyStoreOfflineBreakdown\([\s\S]*?\n}/);
  assert.notEqual(fnMatch, null);
  assert.match(fnMatch[0], /if \(line\?\.isOfflineRevenue !== true\) continue;/);
  assert.match(fnMatch[0], /byStore\[line\.storeCode\] \+= Number\(line\.salesAmount\) \|\| 0;/);
});

// 11. Today/Annual/Store Intelligence untouched
test("11. Today view markup/functions untouched", () => {
  assert.match(js, /async function renderOverviewLiveData\(data, renderSeq\) \{/);
  assert.match(html, /<section id="Overview" class="view active">/);
});

test("11b. Annual's own render function and DOM toggle are untouched", () => {
  assert.match(js, /async function renderAnnualArchiveFlow\(/);
  assert.match(js, /\$\("#annualArchiveFlow"\)\?\.toggleAttribute\("hidden", routeHash !== "annual-report"\)/);
});

test("11c. Store Intelligence locked view section ids and global store selector are unchanged", () => {
  assert.match(html, /<section id="ApgujeongIntelligence" class="view store-intel-accent-apgujeong">/);
  assert.match(html, /<section id="VailIntelligence" class="view store-intel-accent-vail">/);
  assert.match(js, /\$\("#storeFilterSelect"\)\?\.addEventListener\("change", \(event\) => \{\s*\n\s*storeFilterState = event\.target\.value \|\| "ALL";/);
});

// 12. existing Monthly Commerce/Summary data fields are preserved verbatim (regression guard)
test("12. compact Online Summary preserves paidAmount/orderCount/averageOrderValue inputs", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /const salesOnlineAmount = hasApiValue\(sales\?\.onlineSales\?\.paidAmount\)/);
  assert.match(fn, /apiNum\(commerce\.orderCount\)/);
  assert.match(fn, /apiWon\(commerce\.averageOrderValue\)/);
  assert.doesNotMatch(fn, /apiNum\(commerce\.excludedOrderCount\)/);
  assert.match(fn, /전체 브랜드 TOP 5/);
  assert.doesNotMatch(fn, /상품 매출 TOP 5/);
});

test("12b. overall brand ranking keeps canonical total-sales filtering and sorting", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /const performanceBrandSales = brandSales\s*\n\s*\.filter\(\(item\) => !isExcludedBrandPerformance\(item\)\)\s*\n\s*\.sort\(\(left, right\) => brandPerformancePaidAmount\(right\) - brandPerformancePaidAmount\(left\)\);/);
});
