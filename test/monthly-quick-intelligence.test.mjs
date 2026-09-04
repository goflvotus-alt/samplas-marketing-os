import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MONTHLY QUICK INTELLIGENCE HOVER: expands the existing Monthly hover popovers (from
// MONTHLY-INTELLIGENCE-HOVER-NAVIGATION) from a simple "this data goes here" badge into a
// small analysis card (title / key-value rows / destination CTA). No new navigation, no new
// canonical calculations — only richer popover content built from data already computed
// elsewhere in the same render. Structural-assertion pattern (no jsdom).
let js;
let css;
let html;
test.before(async () => {
  js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  css = await readFile(new URL("../outputs/samplas-marketing-os.css", import.meta.url), "utf8");
  html = await readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8");
});

function fn(name, endMarker) {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n}` + (endMarker || ""));
  const match = js.match(re);
  assert.notEqual(match, null, `${name} must exist`);
  return match[0];
}

// 1. core card-builder helpers exist
test("1. monthlyIntelDeltaParts and monthlyIntelPopoverCard exist as shared, reusable helpers", () => {
  assert.match(js, /function monthlyIntelDeltaParts\(current, previous\) \{/);
  assert.match(js, /function monthlyIntelPopoverCard\(titleHtml, rows, ctaLabel\) \{/);
});

test("1b. monthlyIntelDeltaParts uses the exact same diff = current - previous math as monthlyReportDelta (no new calculation)", () => {
  const body = fn("monthlyIntelDeltaParts");
  assert.match(body, /const diff = currentValue - previousValue;/);
  assert.match(body, /!hasApiValue\(current\) \|\| !hasApiValue\(previous\)\) return null/);
});

// 2. NO hard-coded brand/product names anywhere in the popover-building code — every value
// must come from the row/item passed in at render time (dynamic per row).
test("2. no hard-coded brand or product name literals in the Quick Intelligence helpers", () => {
  const brandFn = fn("monthlyIntelBrandLabelHtml");
  const productFn = fn("monthlyIntelProductLabelHtml");
  const cardFn = fn("monthlyIntelPopoverCard");
  const suspiciousNamePattern = /TROUBLED WATERS|AESIR STUDIOS|ROCK STEADY|GOOMHEO|LSOUL|CARNET ARCHIVE|PHTMNE/;
  assert.doesNotMatch(brandFn, suspiciousNamePattern);
  assert.doesNotMatch(productFn, suspiciousNamePattern);
  assert.doesNotMatch(cardFn, suspiciousNamePattern);
});

// 3. brand Quick Intelligence card — priority-ordered rows, each conditionally included only
// when the underlying value actually exists (no fabricated data)
test("3. brand card includes 이번 달 매출 always, and 전월/증감/증감률/판매수량/순위 only when available", () => {
  const body = fn("monthlyIntelBrandLabelHtml");
  assert.match(body, /rows = \[\["이번 달 매출", esc\(apiWon\(currentAmount\)\)\]\]/);
  assert.match(body, /if \(deltaParts\) \{/);
  assert.match(body, /rows\.push\(\["전월 매출", esc\(apiWon\(previousAmount\)\)\]\);/);
  assert.match(body, /rows\.push\(\["증감", `\$\{deltaParts\.sign\}\$\{esc\(apiWon\(deltaParts\.diff\)\)\}`, deltaParts\.tone\]\);/);
  assert.match(body, /if \(deltaParts\.percent !== null\) rows\.push\(\["성장률",/);
  assert.match(body, /if \(hasApiValue\(quantitySold\)\) rows\.push\(\["판매수량",/);
  assert.match(body, /if \(Number\.isInteger\(rank\)\) rows\.push\(\["현재 순위", `\$\{rank \+ 1\}위`\]\);/);
});

test("3b. brand card values are pulled from function parameters (item/currentAmount/previousAmount/quantitySold/rank), not literals", () => {
  const body = fn("monthlyIntelBrandLabelHtml");
  assert.match(body, /function monthlyIntelBrandLabelHtml\(item, currentAmount, previousAmount, quantitySold, rank\) \{/);
  assert.match(body, /const code = monthlyReportBrandCode\(item\);/);
  assert.match(body, /const name = brandPerformanceDisplayName\(item\);/);
});

// 4. dynamic brand connection: rising/falling TOP3 and TOP5 all pass the row's own
// quantitySold/index through to the card builder — no shared/fixed value across rows
test("4. rising/falling brand rows pass their own item.quantitySold and row index (rank) into the card", () => {
  assert.match(js, /labelHtmlFn: \(item, index\) => monthlyIntelBrandLabelHtml\(item, item\.currentSales, item\.previousSales, item\.quantitySold, index\)/g);
  const occurrences = (js.match(/labelHtmlFn: \(item, index\) => monthlyIntelBrandLabelHtml\(item, item\.currentSales, item\.previousSales, item\.quantitySold, index\)/g) || []).length;
  assert.equal(occurrences, 2, "both rising and falling TOP3 rank-row calls must pass per-row quantitySold/index");
});

test("4b. overall brand TOP5 passes its own canonical total and previous row, not a fixed value", () => {
  assert.match(js, /monthlyIntelBrandLabelHtml\(item, brandPerformancePaidAmount\(item\), previous \? brandPerformancePaidAmount\(previous\) : undefined, item\.quantitySold, index\)/);
});

// 5. dynamic Brand Intelligence navigation is preserved end-to-end: click-time resolution by
// canonical brand_code (not name matching), no per-brand hardcoding in the click handler
test("5. resolveBrandCodeToSelectorName + brand click handler are unchanged (dynamic per-row navigation preserved)", () => {
  const resolverBody = fn("resolveBrandCodeToSelectorName");
  assert.match(resolverBody, /monthlyReportBrandCode\(entry\)/);
  assert.match(resolverBody, /\.trim\(\)\.toUpperCase\(\) === normalized/);
  const handlerMatch = js.match(/const brandLink = event\.target\.closest\("\[data-monthly-intel-brand-code\]"\);\s*\n\s*if \(brandLink\) \{([\s\S]*?)\n\s*\}\s*\n\s*return;\s*\n\s*\}/);
  assert.notEqual(handlerMatch, null);
  assert.match(handlerMatch[1], /resolveBrandCodeToSelectorName\(brandLink\.dataset\.monthlyIntelBrandCode\)/);
  assert.match(handlerMatch[1], /setActiveView\("BrandDashboard", \{ routeHash: "brand-dashboard" \}\);/);
  assert.match(handlerMatch[1], /selectBrandSelectorName\(name\);/);
});

test("5b. brand_code is read from the row's own canonical field, never a raw operational name (BON CO/POP CO/SUN CO style)", () => {
  const body = fn("monthlyIntelBrandLabelHtml");
  assert.doesNotMatch(body, /brand_name/);
  assert.match(body, /monthlyReportBrandCode\(item\)/);
});

// 6. product Quick Intelligence card
test("6. product card shows 브랜드/이번 달 매출/판매수량(있으면)/매출 순위(있으면), no fabricated previous-month comparison", () => {
  const body = fn("monthlyIntelProductLabelHtml");
  assert.match(body, /rows = \[\["브랜드", esc\(brandName\)\], \["이번 달 매출", esc\(apiWon\(canonicalPaidAmount\(item\)\)\)\]\];/);
  assert.match(body, /if \(hasApiValue\(item\.quantitySold\)\) rows\.push\(\["판매수량",/);
  assert.match(body, /if \(Number\.isInteger\(rank\)\) rows\.push\(\["매출 순위", `\$\{rank \+ 1\}위`\]\);/);
  assert.doesNotMatch(body, /전월/, "Monthly does not compute previous-month product sales — must not fabricate a comparison row");
});

test("6b. product destination is still the existing Product dashboard (data-jump-view=\"Product\"), no fabricated per-item route", () => {
  const body = fn("monthlyIntelProductLabelHtml");
  assert.match(body, /data-jump-view="Product"/);
});

test("6c. product detail was removed from Monthly but its reusable helper remains intact", () => {
  const monthly = js.match(/async function renderMonthlyArchiveReport[\s\S]*?\n}\n\nfunction miniMetric/)[0];
  assert.doesNotMatch(monthly, /monthlyIntelProductLabelHtml/);
  assert.match(js, /function monthlyIntelProductLabelHtml/);
});

// 7. Commerce/Sales KPI cards — 총매출/온라인 매출 show 증감액+증감률, 주문수/객단가 show
// 증감률만 (per spec section 6), all reusing monthlyIntelDeltaParts (no new math)
test("7. monthlyIntelKpiPopoverRows supports the includeAmountDelta flag (총매출/온라인매출=true, 주문수/객단가=false)", () => {
  const fnMatch = js.match(/function monthlyIntelKpiPopoverRows\([\s\S]*?\n {2}\}/);
  assert.notEqual(fnMatch, null);
  assert.match(fnMatch[0], /includeAmountDelta = true/);
  assert.match(fnMatch[0], /if \(includeAmountDelta\) rows\.push\(\["증감",/);
});

test("7b. order count and AOV popovers pass includeAmountDelta=false (no amount-diff row for counts)", () => {
  const orderCalls = (js.match(/monthlyIntelKpiPopoverRows\("이번 달 주문", commerce\.orderCount, comparablePreviousCommerce\.orderCount, apiNum, false\)/g) || []).length;
  const aovCalls = (js.match(/monthlyIntelKpiPopoverRows\("이번 달 객단가", commerce\.averageOrderValue, comparablePreviousCommerce\.averageOrderValue, apiWon, false\)/g) || []).length;
  assert.ok(orderCalls >= 1, "order count KPI card must exist with includeAmountDelta=false");
  assert.ok(aovCalls >= 1, "AOV KPI card must exist with includeAmountDelta=false");
});

test("7c. total sales / online sales KPI cards use includeAmountDelta default (true, both amount+percent rows)", () => {
  assert.match(js, /monthlyIntelKpiPopoverRows\("이번 달", totalSalesAmountForLink, totalSalesPreviousForLink, apiWon\)/);
  assert.match(js, /monthlyIntelKpiPopoverRows\("이번 달", salesOnlineAmount, comparablePreviousCommerce\.paidAmount, apiWon\)/);
});

test("7d. offline sales (ALL-mode combined) still has no click destination — hover-only, no fabricated store-specific data", () => {
  const offlineMatch = js.match(/const offlineSalesHover = hasOfflineSales[\s\S]*?: `<strong>데이터 없음<\/strong>`;/);
  assert.notEqual(offlineMatch, null);
  assert.match(offlineMatch[0], /monthly-intel-hover-only/);
  assert.doesNotMatch(offlineMatch[0], /data-jump-view/);
});

// 8. payment method card
test("8. payment method detail is no longer duplicated in Monthly", () => {
  const monthly = js.match(/async function renderMonthlyArchiveReport[\s\S]*?\n}\n\nfunction miniMetric/)[0];
  assert.doesNotMatch(monthly, /paymentMethods\.map|Commerce 결제수단/);
  assert.match(monthly, /결제수단 · 브랜드 · 상품 상세는 Commerce에서 확인합니다/);
});

// 9. store donut Quick Intelligence — only shows fields that actually exist right now
// (매출/비중); does NOT fabricate 전월/주문수/객단가 since no store-specific fetch for those
// exists (store upload/attribution is explicitly out of scope for this batch)
test("9. store donut popover only includes 매출/오프라인 내 비중 — no fabricated 전월/주문수/객단가", () => {
  const donutFn = fn("monthlyStoreDonutBlock");
  assert.match(donutFn, /\["매출", esc\(won\(row\.amount\)\)\]/);
  assert.match(donutFn, /\["오프라인 내 비중", esc\(pct\(row\.share\)\)\]/);
  assert.doesNotMatch(donutFn, /\["주문수",/);
  assert.doesNotMatch(donutFn, /\["객단가",/);
  assert.doesNotMatch(donutFn, /\["전월",/);
});

test("9b. donut rendering gate is unchanged (both APGUJEONG and VAIL must be in storesIncluded) — not relaxed to force a demo", () => {
  const donutFn = fn("monthlyStoreDonutBlock");
  assert.match(donutFn, /if \(!storesIncluded\.includes\("APGUJEONG"\) \|\| !storesIncluded\.includes\("VAIL"\)\) return "";/);
});

// 10. visual design: Daily Calendar의 white-card language를 공유하고, 기존 --green/--red
// semantic tokens are reused for delta tone (no new color system), popover width within the 260-300px range
// !important is required here: .monthly-report-hero-main/.side-row/.legend-row already style
// bare <strong>/<span> broadly (e.g. the giant hero clamp() font-size) with equal selector
// specificity — without !important those ambient rules silently leak into the popover
// (found live during this batch's own QA, fixed by pinning font-size/color explicitly).
test("10. delta tone classes reuse the existing --green/--red tokens (no new color system)", () => {
  assert.match(css, /\.monthly-intel-popover-row strong\.monthly-intel-delta-positive\s*\{\s*color:\s*var\(--green\) !important;/);
  assert.match(css, /\.monthly-intel-popover-row strong\.monthly-intel-delta-negative\s*\{\s*color:\s*var\(--red\) !important;/);
});

test("10b. popover uses the Daily Calendar white-card visual contract", () => {
  const block = css.match(/\.monthly-intel-popover\s*\{([^}]*)\}/)[1];
  assert.match(block, /background:\s*rgba\(255, 255, 255, 0\.98\)/);
  assert.match(block, /border:\s*1px solid rgba\(23, 23, 23, 0\.08\)/);
  assert.match(block, /box-shadow:\s*0 18px 42px rgba\(25, 25, 20, 0\.16\)/);
  assert.match(block, /color:\s*var\(--ink\)/);
});

// Regression guard for a real bug found+fixed during this batch's live QA: popover row
// text was rendering at the ambient hero's giant clamp(34px,5vw,62px) font-size because
// .monthly-intel-popover-row strong never declared its own font-size (per-property CSS
// cascade lets an unrelated same-specificity rule "win" a property one's own rule never
// touches). Both row span/strong must pin font-size explicitly so this can't regress.
test("10c. popover row span/strong explicitly pin font-size (prevents ambient hero/side-row font-size from leaking in)", () => {
  const spanMatch = css.match(/\.monthly-intel-popover-row span\s*\{([^}]*)\}/);
  const strongMatch = css.match(/\.monthly-intel-popover-row strong\s*\{([^}]*)\}/);
  assert.notEqual(spanMatch, null);
  assert.notEqual(strongMatch, null);
  assert.match(spanMatch[1], /font-size:\s*\d+px\s*!important/);
  assert.match(strongMatch[1], /font-size:\s*\d+px\s*!important/);
});

// 11. zero layout shift mechanism preserved exactly (position:absolute + opacity toggle,
// pointer-events:none — no new DOM-mutation-based show/hide, no separate clickable CTA button
// that would add complexity/regression risk per "안정성 우선" decision)
test("11. popover remains position:absolute + opacity-toggled + pointer-events:none (stability-first CTA, not a separate clickable button)", () => {
  assert.match(css, /\.monthly-intel-popover\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.monthly-intel-popover\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.monthly-intel-popover\s*\{[^}]*pointer-events:\s*none/);
  assert.doesNotMatch(js, /monthly-intel-popover-cta|monthly-intel-cta-button/, "CTA must stay a plain destination indicator, not a new separate interactive element");
});

test("11b. no new DOM-mutation-based hover state — CSS :hover/:focus-visible only (same as storeIntelJumpLink's proven mechanism)", () => {
  assert.match(css, /\.monthly-intel-link:hover \.monthly-intel-popover,/);
  assert.match(css, /\.monthly-intel-link-inline:hover \.monthly-intel-popover,/);
  assert.match(css, /\.monthly-intel-hover-only:hover \.monthly-intel-popover,/);
});

// 12. accessibility: existing :focus-visible mechanism preserved (no new keyboard system)
test("12. :focus-visible reveals the popover exactly like :hover (existing mechanism, not new)", () => {
  assert.match(css, /\.monthly-intel-link:focus-visible \.monthly-intel-popover,/);
  assert.match(css, /\.monthly-intel-link-inline:focus-visible \.monthly-intel-popover,/);
});

// 13. Store/Product/Commerce navigation destinations all still exist and are unchanged
test("13. Store Intelligence, Product dashboard, and Commerce/Sales destinations are all still reachable exactly as before", () => {
  assert.match(html, /<section id="ApgujeongIntelligence" class="view store-intel-accent-apgujeong">/);
  assert.match(html, /<section id="VailIntelligence" class="view store-intel-accent-vail">/);
  assert.match(html, /id="commerceSummaryPayments"/);
  assert.match(js, /data-jump-view="Sales"/);
  assert.match(js, /data-jump-view="Product"/);
});

// 14. Today/Annual untouched, server.mjs untouched (data safety)
test("14. Today view markup/functions untouched", () => {
  assert.match(js, /async function renderOverviewLiveData\(data, renderSeq\) \{/);
  assert.match(html, /<section id="Overview" class="view active">/);
});

test("14b. Annual's own render function and DOM toggle are untouched", () => {
  assert.match(js, /async function renderAnnualArchiveFlow\(/);
  assert.match(js, /\$\("#annualArchiveFlow"\)\?\.toggleAttribute\("hidden", routeHash !== "annual-report"\)/);
});

test("14c. server.mjs is completely untouched by this batch (presentation layer only)", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /function buildCanonicalTotalSales/);
  assert.match(server, /async function buildMonthlyArchive\(month\)/);
  assert.match(server, /function aggregateCafe24BrandSalesByBrandCode/);
});

// 15. Commerce chapter figures unchanged (regression guard)
test("15. compact Online Summary still reads the same online/order/AOV fields", () => {
  assert.match(js, /salesOnlineAmount/);
  assert.match(js, /apiNum\(commerce\.orderCount\)/);
  assert.match(js, /apiWon\(commerce\.averageOrderValue\)/);
  const monthly = js.match(/async function renderMonthlyArchiveReport[\s\S]*?\n}\n\nfunction miniMetric/)[0];
  assert.doesNotMatch(monthly, /apiNum\(commerce\.excludedOrderCount\)/);
});
