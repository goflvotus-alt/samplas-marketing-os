import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MONTHLY IA STEP: Content is no longer a Monthly chapter (Content + Advertising both move
// to Content Intelligence). Monthly is limited to 01 Summary / 02 Commerce /
// 03 Monthly Intelligence. Structural-assertion pattern (no jsdom), matching prior batches.
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

// 5. final chapter/nav structure is exactly 01 Summary / 02 Commerce / 03 Monthly Intelligence
test("5. TOC and DOM both express exactly 3 chapters: Summary, Commerce, Monthly Intelligence", () => {
  const fn = monthlyReportFnBody();
  const tocMatch = fn.match(/<nav class="monthly-report-toc"[\s\S]*?<\/nav>/);
  assert.notEqual(tocMatch, null);
  const links = [...tocMatch[0].matchAll(/<a href="#monthly-report-ch(\d)">(\d\d) ([^<]+)<\/a>/g)];
  assert.deepEqual(links.map((m) => [m[1], m[2], m[3]]), [
    ["1", "01", "Summary"],
    ["2", "02", "Commerce"],
    ["3", "03", "Monthly Intelligence"]
  ]);
  const chapterCount = (fn.match(/class="monthly-report-chapter"/g) || []).length;
  assert.equal(chapterCount, 3, "exactly 3 chapter sections should exist in the rendered template");
});

// 6. DOM order reads Summary -> Commerce -> Monthly Intelligence (no chapter left in between)
test("6. chapters appear in source order Summary, Commerce, then Monthly Intelligence (missionSummaryBlock)", () => {
  const fn = monthlyReportFnBody();
  const ch1Idx = fn.indexOf('<section id="monthly-report-ch1"');
  const ch2Idx = fn.indexOf('<section id="monthly-report-ch2"');
  const missionBlockUseIdx = fn.lastIndexOf("${missionSummaryBlock}");
  assert.ok(ch1Idx > -1 && ch2Idx > -1 && missionBlockUseIdx > -1);
  assert.ok(ch1Idx < ch2Idx, "Summary must come before Commerce");
  assert.ok(ch2Idx < missionBlockUseIdx, "Commerce must come before Monthly Intelligence");
});

// 7. no stray empty section/divider left where Content used to be — the ch2 Commerce
// section's closing tag is immediately followed by the Monthly Intelligence block, with no
// intervening empty <section> (this would indicate a leftover display:none-style husk
// instead of a true DOM removal).
test("7. no leftover empty section between Commerce's close and Monthly Intelligence (true DOM removal, not display:none)", () => {
  const fn = monthlyReportFnBody();
  const between = fn.match(/<\/section>\s*\n\s*\$\{missionSummaryBlock\}/);
  assert.notEqual(between, null, "Commerce chapter's closing tag must be immediately followed by the Monthly Intelligence block");
  assert.doesNotMatch(fn, /style="display:\s*none"/);
  assert.doesNotMatch(fn, /\bhidden\b[^>]*>[\s\n]*<\/section>/);
});

// 8. Summary's Intelligence teaser now points at chapter 03 (not the old 04)
test("8. Summary chapter's Intelligence teaser links to #monthly-report-ch3 / 03 Monthly Intelligence", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /<a href="#monthly-report-ch3">03 Monthly Intelligence 전체 보기<\/a>/);
  assert.doesNotMatch(fn, /monthly-report-ch4/);
});

// 9. Commerce chapter content is fully preserved (regression guard for section 5 of the spec)
test("9. Commerce chapter still shows payment methods / brand TOP5 / product TOP5 / order metrics (unchanged)", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /결제수단 구성/);
  assert.match(fn, /브랜드 매출 TOP 5/);
  assert.match(fn, /상품 매출 TOP 5/);
  assert.match(fn, /주문수/);
  assert.match(fn, /객단가/);
  assert.match(fn, /apiWon\(commerce\.paidAmount\)/);
});

// 10. Monthly Intelligence chapter reuses the existing Mission UI, no new mock data
test("10. Monthly Intelligence chapter reuses existing missionRows/intelligenceBriefCard, empty state is real (not mock numbers)", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /missionRows\.map\(\(mission\) => intelligenceBriefCard\(mission\)\)/);
  assert.match(fn, /이번 달 저장된 Mission이 없습니다/);
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
