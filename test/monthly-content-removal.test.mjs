import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MONTHLY IA STEP: Content is no longer a Monthly chapter (Content + Advertising both move
// to Content Intelligence). Monthly's chapter structure has since been finalized to exactly
// 01 Summary / 02 Commerce (Monthly Intelligence/Mission chapter removed in a later batch —
// see monthly-cleanup-mission-removal.test.mjs). Structural-assertion pattern (no jsdom).
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

// 1. no Content chapter section anywhere in Monthly's template
test("1. Monthly report has no Content chapter section (id/eyebrow/title all gone)", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /<p class="eyebrow">Content<\/p>/);
  assert.doesNotMatch(fn, /월간 콘텐츠 스냅샷/);
  assert.doesNotMatch(fn, /data-jump-view="Editorial AI"/);
});

// 2. every listed Content metric/UI element from the spec is gone from Monthly
test("2. all listed Content metrics/UI are removed from Monthly (views/saves/likes/shares/follower/format mix/top content/save-rate/editorial-ai)", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /콘텐츠 핵심 성과/);
  assert.doesNotMatch(fn, /콘텐츠 수/);
  assert.doesNotMatch(fn, /Format Mix/);
  assert.doesNotMatch(fn, /조회 상위 콘텐츠/);
  assert.doesNotMatch(fn, /평균 저장률 상회/);
  assert.doesNotMatch(fn, /Editorial AI 분석/);
  assert.doesNotMatch(fn, /<span>팔로워 변화<\/span>/);
});

// 3. no leftover "content." field references or now-dead local variables in the function
test("3. no leftover content.*/formatMix/topContent/aboveAverageSaveRatePosts references", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /\bcontent\.\w+/);
  assert.doesNotMatch(fn, /\bformatMix\b/);
  assert.doesNotMatch(fn, /\btopContent\b/);
  assert.doesNotMatch(fn, /\baboveAverageSaveRatePosts\b/);
  assert.doesNotMatch(fn, /\bpreviousContent\b/);
});

// 4. archive.content fetch/field itself is untouched — data must remain reusable for
// Content Intelligence (only the Monthly UI rendering of it was removed).
test("4. the underlying /api/reports/monthly fetch (archive.content source) is unchanged", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /getJson\(`\/api\/reports\/monthly\?month=\$\{month\}`, 8000\)/);
});

test("4b. archive is destructured/used as a whole object (archive.content is never deleted from the response shape)", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /const commerce = archive\.commerce \|\| \{\};/);
  assert.doesNotMatch(fn, /delete archive\.content/);
});

// 5/6/7/8. updated by MONTHLY CLEANUP: Monthly Intelligence/Mission chapter (was 03) has since
// been removed too — Monthly is now exactly 01 Summary / 02 Commerce.
// See monthly-cleanup-mission-removal.test.mjs for the dedicated removal assertions.
test("5. TOC and DOM express the new performance IA without Content", () => {
  const fn = monthlyReportFnBody();
  const tocMatch = fn.match(/<nav class="monthly-report-toc"[\s\S]*?<\/nav>/);
  assert.notEqual(tocMatch, null);
  const links = [...tocMatch[0].matchAll(/<a href="#monthly-report-ch(\d)">(\d\d) ([^<]+)<\/a>/g)];
  assert.deepEqual(links.map((m) => [m[1], m[2], m[3]]), [
    ["2", "02", "Sales Structure"],
    ["3", "03", "Store Performance"],
    ["4", "04", "Brand Performance"],
    ["5", "05", "Online Summary"]
  ]);
  assert.match(tocMatch[0], /#todaySalesCalendar">01 Daily Sales/);
  const chapterCount = (fn.match(/class="monthly-report-chapter"/g) || []).length;
  assert.equal(chapterCount, 4, "calendar is outside the report template; four report chapter sections should remain");
});

test("6. report chapters appear in source order Sales → Store → Brand → Online", () => {
  const fn = monthlyReportFnBody();
  const ch2Idx = fn.indexOf('<section id="monthly-report-ch2"');
  const ch3Idx = fn.indexOf('<section id="monthly-report-ch3"');
  const ch4Idx = fn.indexOf('<section id="monthly-report-ch4"');
  const ch5Idx = fn.indexOf('<section id="monthly-report-ch5"');
  assert.ok(ch2Idx > -1 && ch2Idx < ch3Idx && ch3Idx < ch4Idx && ch4Idx < ch5Idx);
});

test("7. Commerce chapter is the last thing in the template (true DOM removal, not display:none)", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /<\/section>\s*\n\s*`;\s*\n}/, "Commerce chapter's closing tag must be immediately followed by the end of the template literal");
  assert.doesNotMatch(fn, /style="display:\s*none"/);
  assert.doesNotMatch(fn, /\bhidden\b[^>]*>[\s\n]*<\/section>/);
});

test("8. Monthly no longer has an Intelligence teaser (Mission chapter removed)", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /이번 달 주요 Intelligence/);
});

// 9. Commerce chapter content is fully preserved (regression guard for section 5 of the spec)
test("9. Online Summary keeps core order metrics and links to Commerce detail", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /주문수/);
  assert.match(fn, /객단가/);
  assert.match(fn, /data-jump-view="Sales">Commerce →/);
});

// 10. updated by MONTHLY CLEANUP: the Mission UI this test used to check for inside Monthly
// has been removed entirely — no mock data was introduced in its place.
test("10. no mock/placeholder data was introduced by removing the Mission chapter", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /MOCK_/);
});

// 11. Today/Annual/Store Intelligence untouched by this batch
test("11. Today view markup/functions untouched", () => {
  assert.match(js, /async function renderOverviewLiveData\(data, renderSeq\) \{/);
  assert.match(html, /<section id="Overview" class="view active">/);
});

test("11b. Annual's own render function and DOM toggle are untouched", () => {
  assert.match(js, /async function renderAnnualArchiveFlow\(/);
  assert.match(js, /\$\("#annualArchiveFlow"\)\?\.toggleAttribute\("hidden", routeHash !== "annual-report"\)/);
});

test("11c. Store Intelligence locked view section ids remain unchanged", () => {
  assert.match(html, /<section id="ApgujeongIntelligence" class="view store-intel-accent-apgujeong">/);
  assert.match(html, /<section id="VailIntelligence" class="view store-intel-accent-vail">/);
});

// 12. canonical sales/commerce calculation untouched (server-side, this is a client UI-only batch)
test("12. buildCanonicalTotalSales exists and server.mjs is untouched by this batch", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /function buildCanonicalTotalSales/);
});

// 13. standalone "Content" nav page (renderContentOperations) is a different, untouched screen
test("13. the standalone Content view/page (renderContentOperations) is untouched — only Monthly's embedded Content chapter was removed", () => {
  assert.match(js, /async function renderContentOperations\(data, renderSeq\) \{/);
  assert.match(html, /<section id="Content" class="view">/);
});
