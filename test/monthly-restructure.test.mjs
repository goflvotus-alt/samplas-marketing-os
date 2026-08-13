import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MONTHLY UI RESTRUCTURE: advertising UI removed from Monthly, Monthly/Annual visually
// separated, Monthly re-chaptered into 01 Summary / 02 Commerce / 03 Content /
// 04 Monthly Intelligence. Structural-assertion pattern (no jsdom), matching prior batches.
let js;
let html;
test.before(async () => {
  js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  html = await readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8");
});

function monthlyReportFnBody() {
  const match = js.match(/async function renderMonthlyArchiveReport\(month, renderSeq\) \{[\s\S]*?\n}\n\nfunction miniMetric/);
  assert.notEqual(match, null, "renderMonthlyArchiveReport must still exist");
  return match[0];
}

// 1. advertising UI fully removed from Monthly's rendered template
test("1. Monthly report chapter no longer contains a Marketing/advertising chapter", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /월간 광고 스냅샷/);
  assert.doesNotMatch(fn, /data-jump-view="Advertising"/);
  assert.doesNotMatch(fn, /<p class="eyebrow">Marketing<\/p>/);
  assert.doesNotMatch(fn, /광고비 \/ 실제 매출/);
  assert.doesNotMatch(fn, /일치검증/);
});

test("2. Monthly report no longer references archive.marketing fields in its template", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /marketing\.spend/);
  assert.doesNotMatch(fn, /marketing\.purchaseValue/);
  assert.doesNotMatch(fn, /marketing\.adSpendShare/);
  assert.doesNotMatch(fn, /"광고비는"/);
});

test("3. Monthly Goal Progress card list (#nextActions) no longer includes an advertising goal", () => {
  const fnMatch = js.match(/function homeGoalCards\([\s\S]*?\n}/);
  assert.notEqual(fnMatch, null);
  assert.doesNotMatch(fnMatch[0], /label: "광고"/);
});

// 4. archive.marketing fetch/API contract itself is untouched — ad data/calc must remain
// reusable later (only the Monthly UI rendering of it was removed).
test("4. the underlying /api/reports/monthly fetch (archive.marketing source) is unchanged", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /getJson\(`\/api\/reports\/monthly\?month=\$\{month\}`, 8000\)/);
});

// 5. monthlyReportBrandSignalsBlock no longer takes/renders a reconciliation (ad) label
test("5. monthlyReportBrandSignalsBlock signature drops reconciliationLabel and its markup", () => {
  assert.match(js, /function monthlyReportBrandSignalsBlock\(currentRows, previousRows, trendRows = \[\]\) \{/);
  const fnMatch = js.match(/function monthlyReportBrandSignalsBlock\([\s\S]*?\n}/);
  assert.notEqual(fnMatch, null);
  assert.doesNotMatch(fnMatch[0], /데이터 일치검증/);
  assert.doesNotMatch(fnMatch[0], /reconciliationLabel/);
});

test("5b. the one call site passes only (currentRows, previousRows, trendRows)", () => {
  assert.match(js, /monthlyReportBrandSignalsBlock\(performanceBrandSales, previousBrandSales, monthlyBrandTrendRows\)/);
});

// 6. chapter renumbering / TOC correctness
test("6. Monthly report TOC is 01 Summary / 02 Commerce / 03 Content / 04 Monthly Intelligence", () => {
  const fn = monthlyReportFnBody();
  const tocMatch = fn.match(/<nav class="monthly-report-toc"[\s\S]*?<\/nav>/);
  assert.notEqual(tocMatch, null);
  const toc = tocMatch[0];
  assert.match(toc, /<a href="#monthly-report-ch1">01 Summary<\/a>/);
  assert.match(toc, /<a href="#monthly-report-ch2">02 Commerce<\/a>/);
  assert.match(toc, /<a href="#monthly-report-ch3">03 Content<\/a>/);
  assert.match(toc, /<a href="#monthly-report-ch4">04 Monthly Intelligence<\/a>/);
  assert.doesNotMatch(toc, /Marketing/);
});

test("7. chapter section ids/numbers match the new structure", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /<section id="monthly-report-ch1" class="monthly-report-chapter">[\s\S]{0,200}<span>01<\/span>[\s\S]{0,120}<p class="eyebrow">Summary<\/p>/);
  assert.match(fn, /<section id="monthly-report-ch2" class="monthly-report-chapter">[\s\S]{0,200}<span>02<\/span>[\s\S]{0,120}<p class="eyebrow">Commerce<\/p>/);
  assert.match(fn, /<section id="monthly-report-ch3" class="monthly-report-chapter">[\s\S]{0,200}<span>03<\/span>[\s\S]{0,120}<p class="eyebrow">Content<\/p>/);
  assert.match(fn, /<section id="monthly-report-ch4" class="monthly-report-chapter">[\s\S]{0,200}<span>04<\/span>[\s\S]{0,120}<p class="eyebrow">Monthly Intelligence<\/p>/);
});

// 8. existing Commerce/Content data fields are preserved verbatim (only removed = ad UI)
test("8. Commerce chapter still shows payment methods / brand TOP5 / product TOP5 (unchanged data)", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /결제수단 구성/);
  assert.match(fn, /브랜드 매출 TOP 5/);
  assert.match(fn, /상품 매출 TOP 5/);
  assert.match(fn, /apiWon\(commerce\.paidAmount\)/);
});

test("9. Content chapter still shows organic metrics only (views/saves/likes/shares/follower/format mix), no paid metrics", () => {
  const fn = monthlyReportFnBody();
  const ch3Match = fn.match(/<section id="monthly-report-ch3"[\s\S]*?<\/section>\s*\$\{missionSummaryBlock\}/);
  assert.notEqual(ch3Match, null);
  const ch3 = ch3Match[0];
  assert.match(ch3, /content\.totalViews/);
  assert.match(ch3, /content\.totalSaves/);
  assert.match(ch3, /content\.totalLikes/);
  assert.match(ch3, /content\.totalShares/);
  assert.match(ch3, /Format Mix/);
  assert.doesNotMatch(ch3, /marketing\./);
});

// 10. new Summary chapter uses only already-fetched data (no mock/placeholder values)
test("10. Summary chapter reuses existing salesSummaryBlock/brandSignalsBlock, no new mock data", () => {
  const fn = monthlyReportFnBody();
  const ch1Match = fn.match(/<section id="monthly-report-ch1"[\s\S]*?<section id="monthly-report-ch2"/);
  assert.notEqual(ch1Match, null);
  const ch1 = ch1Match[0];
  assert.match(ch1, /\$\{salesSummaryBlock\}/);
  assert.match(ch1, /\$\{brandSignalsBlock\}/);
  assert.doesNotMatch(ch1, /MOCK_/);
});

test("10b. Summary total-sales hero reuses the existing monthlyReportDelta helper (no new calculation)", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /monthlyReportDelta\(hasCanonicalTotalSales \? salesTotalAmount : salesOnlineAmount, hasCanonicalTotalSales \? previousSalesTotalAmount : summaryPreviousCommerce\.paidAmount, apiWon\)/);
});

// 11. Annual/Monthly visibility separation
test("11. setActiveView toggles #annualArchiveFlow / #monthlyArchiveReport / #monthlyFreshnessHeader by route", () => {
  const fnMatch = js.match(/function setActiveView\(view, options = \{\}\) \{[\s\S]*?\n}/);
  assert.notEqual(fnMatch, null);
  const fn = fnMatch[0];
  assert.match(fn, /\$\("#annualArchiveFlow"\)\?\.toggleAttribute\("hidden", routeHash !== "annual-report"\)/);
  assert.match(fn, /\$\("#monthlyArchiveReport"\)\?\.toggleAttribute\("hidden", routeHash === "annual-report"\)/);
  assert.match(fn, /\$\("#monthlyFreshnessHeader"\)\?\.toggleAttribute\("hidden", routeHash === "annual-report"\)/);
});

test("11b. renderReportsMonth's dual-render call (Monthly + Annual) is unchanged (visibility is CSS-only, not a fetch change)", () => {
  const fnMatch = js.match(/function renderReportsMonth\([\s\S]*?\n}/);
  assert.notEqual(fnMatch, null);
  assert.match(fnMatch[0], /renderMonthlyArchiveReport\(month, renderSeq\)/);
  assert.match(fnMatch[0], /renderAnnualArchiveFlow\(month, renderSeq\)/);
});

// 12. Monthly/Annual DOM order — Goal Progress no longer sits above the report,
// and moved after the whole Monthly report (Summary...Intelligence), before Annual.
test("12. HTML: monthlyDestinationLayout comes after monthlyArchiveReport and before annualArchiveFlow", () => {
  const reportsMatch = html.match(/<section id="Reports" class="view">[\s\S]*?<\/section>/);
  assert.notEqual(reportsMatch, null);
  const section = reportsMatch[0];
  const archiveIdx = section.indexOf('id="monthlyArchiveReport"');
  const destinationIdx = section.indexOf('id="monthlyDestinationLayout"');
  const annualIdx = section.indexOf('id="annualArchiveFlow"');
  assert.ok(archiveIdx > -1 && destinationIdx > -1 && annualIdx > -1);
  assert.ok(archiveIdx < destinationIdx, "monthlyArchiveReport must come before monthlyDestinationLayout");
  assert.ok(destinationIdx < annualIdx, "monthlyDestinationLayout must come before annualArchiveFlow");
});

// 13. Today's own render path is completely untouched by this batch
test("13. Today view functions/markup are unchanged (renderOverviewLiveData, todayViewActive, #Overview)", () => {
  assert.match(js, /async function renderOverviewLiveData\(data, renderSeq\) \{/);
  assert.match(js, /function todayViewActive\(\) \{\s*\n\s*return Boolean\(\$\("#Overview"\)\?\.classList\.contains\("active"\)\);\s*\n}/);
  assert.match(html, /<section id="Overview" class="view active">/);
});

test("13b. Today's own briefing/summary rendering calls are untouched", () => {
  assert.match(js, /setTodayHtml\("#todayBriefing", `<article class="today-brief-card warning">/);
  assert.match(js, /setTodayHtml\("#todaySummaryBriefing", `<article class="action-item"><strong>오늘 요약 확인 중<\/strong>/);
});

// 14. canonical sales calculation is untouched by this UI-only batch
test("14. buildCanonicalTotalSales exists and is untouched in server.mjs (no calc change)", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /function buildCanonicalTotalSales/);
});

// 15. existing Store Intelligence structure (STORE-INTEL-UI-A/B) is untouched
test("15. Store Intelligence locked view section ids remain unchanged", () => {
  assert.match(html, /<section id="ApgujeongIntelligence" class="view store-intel-accent-apgujeong">/);
  assert.match(html, /<section id="VailIntelligence" class="view store-intel-accent-vail">/);
});

test("15b. Monthly store selector / ALL-mode store breakdown note helper is unchanged", () => {
  assert.match(js, /function monthlyAllStoreBreakdownNote\(offlineSnapshot, archive\) \{/);
  assert.match(js, /function monthlyStoreScopeNote\(month, storeCode\) \{/);
});
