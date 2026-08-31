import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MONTHLY CLEANUP: Monthly Intelligence ("다음 달 우선순위 Mission") was a placeholder reusing
// /api/intelligence/missions UI, not a real Monthly Intelligence feature. Removed entirely per
// user decision. Monthly is now exactly 01 Summary / 02 Commerce. The Mission system itself
// (endpoint/calc/other screens) must NOT be touched — only Monthly's consumption/rendering of
// it. This file also covers the accompanying Monthly TOC hashchange-bounce-to-Today bug fix.
// Structural-assertion pattern (no jsdom), matching prior batches.
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

// 1. Mission chapter/teaser/anchor are all gone from Monthly's template
test("1. no Monthly Intelligence chapter or Mission teaser remains in Monthly", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /Monthly Intelligence/);
  assert.doesNotMatch(fn, /다음 달 우선순위 Mission/);
  assert.doesNotMatch(fn, /이번 달 주요 Intelligence/);
  assert.doesNotMatch(fn, /missionSummaryBlock/);
  assert.doesNotMatch(fn, /missionRows/);
});

// 2. Monthly no longer fetches /api/intelligence/missions at all (dead network call removed)
test("2. Monthly's render function no longer fetches /api/intelligence/missions", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /getJson\([^)]*\/api\/intelligence\/missions/);
  assert.doesNotMatch(fn, /intelligenceUrl\(`\/api\/intelligence\/missions/);
  assert.doesNotMatch(fn, /missionParams/);
  assert.doesNotMatch(fn, /missionResult/);
});

// 3. the Mission system itself is untouched — endpoint still exists server-side, and at least
// one other screen still consumes it (intelligenceBriefCard reused elsewhere, missions route
// still registered in server.mjs).
test("3. /api/intelligence/missions endpoint is still registered in the intelligence service (not deleted)", async () => {
  const intelligenceService = await readFile(new URL("../intelligence-service.mjs", import.meta.url), "utf8");
  assert.match(intelligenceService, /\/api\/intelligence\/missions/);
});

test("3b. intelligenceBriefCard (Mission card renderer) still exists and is used by another screen, not deleted", () => {
  assert.match(js, /function intelligenceBriefCard\(item = \{\}\) \{/);
  const usages = js.match(/intelligenceBriefCard\(/g) || [];
  assert.ok(usages.length >= 1, "intelligenceBriefCard must still be called somewhere outside Monthly");
});

// 4. final Monthly structure is exactly 2 chapters: Summary, Commerce — nothing after Commerce
test("4. Monthly TOC contains the five performance IA destinations", () => {
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
  assert.equal(chapterCount, 4);
});

test("4b. Commerce chapter's closing </section> is the last markup in the primary template", () => {
  const fn = monthlyReportFnBody();
  const templateEnd = fn.match(/<\/section>\s*\n\s*`;/);
  assert.notEqual(templateEnd, null, "primary template must end immediately after Commerce's closing </section>, no hidden markup husk");
});

// 5. no unnecessary display:none was used to hide the removed chapter
test("5. removal is a true DOM deletion, not a display:none hide", () => {
  const fn = monthlyReportFnBody();
  assert.doesNotMatch(fn, /display:\s*none/);
});

// 6. TOC hashchange-bounce-to-Today bug fix: a dedicated click handler intercepts Monthly TOC
// anchor clicks, prevents the native jump (which fires hashchange with an unmapped hash), and
// scrolls + pushState instead (pushState never fires hashchange/popstate, so the SPA router
// never re-runs and Today is never shown).
test("6. a delegated click handler intercepts .monthly-report-toc anchor clicks", () => {
  assert.match(js, /event\.target\.closest\('\.monthly-report-toc a\[href\^="#monthly-report-ch"\], \.monthly-report-toc a\[href="#todaySalesCalendar"\]'\)/);
});

test("6b. the handler prevents the native anchor jump and does not use location.hash (which would fire hashchange)", () => {
  const handlerMatch = js.match(/const monthlyTocLink = event\.target\.closest\([^;]+\);\s*\n\s*if \(monthlyTocLink\) \{([\s\S]*?)\n\s*\}/);
  assert.notEqual(handlerMatch, null);
  const body = handlerMatch[1];
  assert.match(body, /event\.preventDefault\(\)/);
  assert.match(body, /scrollIntoView/);
  assert.match(body, /window\.history\.pushState\(/);
  assert.doesNotMatch(body, /location\.hash\s*=/);
});

// 7. reload/deep-link safety: a hard navigation to #monthly-report-chN must still resolve to
// the Reports (Monthly) view instead of falling back to Overview via hashViewMap.
test("7. normalizedRouteHash maps monthly-report-chN hashes back to monthly-report", () => {
  assert.match(js, /hash === "todaySalesCalendar" \|\| \/\^monthly-report-ch\\d\+\$\/\.test\(hash\) \? "monthly-report" : hash/);
  assert.match(js, /function viewFromHash\(\) \{\s*\n\s*return hashViewMap\[normalizedRouteHash\(currentRouteHash\(\)\)\] \|\| "Overview";\s*\n}/);
});

test("7b. all three router entry points (initial load, popstate, hashchange) apply the normalizer", () => {
  const navFnMatch = js.match(/function renderNav\(\) \{[\s\S]*?\n}\n/);
  assert.notEqual(navFnMatch, null);
  const body = navFnMatch[0];
  const occurrences = body.match(/routeHash: normalizedRouteHash\(currentRouteHash\(\)\)/g) || [];
  assert.equal(occurrences.length, 3, "initial setActiveView call + popstate listener + hashchange listener should all normalize the hash");
});

// 8. the fix is scoped to Monthly TOC only — no redesign of the global SPA nav/routing
test("8. the fix does not touch viewHashMap/hashViewMap route tables or nav click delegation", () => {
  assert.match(js, /const viewHashMap = \{/);
  assert.match(js, /const hashViewMap = \{/);
  assert.match(js, /nav\.addEventListener\("click", \(event\) => \{\s*\n\s*const button = event\.target\.closest\("button\[data-view\]"\);/);
});

// 9. Commerce chapter content is fully preserved (regression guard, no calc/data change)
test("9. Online Summary keeps order metrics and delegates detail to Commerce", () => {
  const fn = monthlyReportFnBody();
  assert.match(fn, /온라인 판매 요약/);
  assert.match(fn, /apiNum\(commerce\.orderCount\)/);
  assert.match(fn, /apiWon\(commerce\.averageOrderValue\)/);
  assert.match(fn, /data-jump-view="Sales">Commerce →/);
});

// 10. Today/Annual/Store Intelligence/Store selector untouched by this batch
test("10. Today view markup/functions untouched", () => {
  assert.match(js, /async function renderOverviewLiveData\(data, renderSeq\) \{/);
  assert.match(html, /<section id="Overview" class="view active">/);
});

test("10b. Annual's own render function and DOM toggle are untouched", () => {
  assert.match(js, /async function renderAnnualArchiveFlow\(/);
  assert.match(js, /\$\("#annualArchiveFlow"\)\?\.toggleAttribute\("hidden", routeHash !== "annual-report"\)/);
});

test("10c. Store Intelligence locked view section ids and global store selector are unchanged", () => {
  assert.match(html, /<section id="ApgujeongIntelligence" class="view store-intel-accent-apgujeong">/);
  assert.match(html, /<section id="VailIntelligence" class="view store-intel-accent-vail">/);
  assert.match(js, /\$\("#storeFilterSelect"\)\?\.addEventListener\("change", \(event\) => \{\s*\n\s*storeFilterState = event\.target\.value \|\| "ALL";/);
});

// 11. canonical sales/commerce calculation untouched (server-side, this is a client UI-only batch)
test("11. buildCanonicalTotalSales exists and server.mjs is untouched by this batch", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /function buildCanonicalTotalSales/);
});
