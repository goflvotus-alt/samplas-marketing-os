import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BI-BATCH-H (Brand Intelligence UX Reorganization). Single-Brand 화면을
// 01 PERFORMANCE → 02 TREND → 03 CHANNEL → 04 CUSTOMER → 05 PRODUCT → 06
// INTELLIGENCE → 07 FUTURE/BLOCKED → SYSTEM STATUS 순서로 재배치한다. 모든 블록이
// 이미 #BrandDashboard의 직계 자식이라(STEP58-4C와 동일 원리) HTML 소스 순서를 옮기지
// 않고 flex `order`만 재배정했다 — 이 테스트는 그 order 값과, 새로 추가된 05 PRODUCT/
// 07 FUTURE-BLOCKED 마크업, 그리고 이번 배치에서 캐노니컬 계산을 손대지 않았음을
// 구조적으로 확인한다.
const html = await readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8");
const css = await readFile(new URL("../outputs/samplas-marketing-os.css", import.meta.url), "utf8");
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

// Selectors in this stylesheet are often grouped (comma-separated across lines) before the
// shared `{ order: N; }` block, so this finds the selector text then reads forward to the
// next `}` rather than assuming the selector is immediately followed by `{`.
function orderOf(selector) {
  const selectorIndex = css.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `selector ${selector} not found`);
  const blockEnd = css.indexOf("}", selectorIndex);
  const block = css.slice(selectorIndex, blockEnd);
  const match = block.match(/order:\s*(\d+);/);
  assert.notEqual(match, null, `order rule for ${selector} not found`);
  return Number(match[1]);
}

test("section order: 01 PERFORMANCE < 02 TREND < 03 CHANNEL < 04 CUSTOMER < 05 PRODUCT < 06 INTELLIGENCE < 07 FUTURE/BLOCKED < SYSTEM STATUS", () => {
  const performance = orderOf("#BrandDashboard > #entityComparePerformanceSection");
  const trend = orderOf("#BrandDashboard > .brand-monthly-trend-section");
  const channel = orderOf("#BrandDashboard > #entityHeroChannelSplit");
  const customer = orderOf("#BrandDashboard > .brand-customer-section");
  const product = orderOf("#BrandDashboard > #entityProductSection");
  const intelligence = orderOf("#BrandDashboard > #entityHeroContent");
  const category = orderOf("#BrandDashboard > .brand-category-section");
  const scoreBlock = orderOf("#BrandDashboard > #entityHeroScoreBlock");
  const futureBlockedStatus = orderOf("#BrandDashboard > #entityFutureBlockedStatus");
  const systemStatus = orderOf("#BrandDashboard > .brand-hero-status-row");
  assert.ok(performance < trend, "Performance must precede Trend");
  assert.ok(trend < channel, "Trend must precede Channel");
  assert.ok(channel < customer, "Channel must precede Customer");
  assert.ok(customer < product, "Customer must precede Product");
  assert.ok(product < intelligence, "Product must precede Intelligence");
  assert.ok(intelligence <= category, "Intelligence must precede or share the Future/Blocked zone boundary");
  assert.equal(category, scoreBlock, "Category and the relocated Score block must share the Future/Blocked order slot");
  assert.equal(category, futureBlockedStatus, "Category and the new Future/Blocked status list must share the same order slot");
  assert.ok(category < systemStatus, "Future/Blocked must precede System Status");
  assert.ok(systemStatus > performance && systemStatus > trend && systemStatus > channel && systemStatus > customer && systemStatus > product && systemStatus > intelligence, "System Status must be the last block");
});

test("KPI cards (#entityHeroKpiGrid) are ordered Revenue, Units, Orders, AOV, Inventory, Sell-through", () => {
  const gridStart = html.indexOf('<div id="entityHeroKpiGrid"');
  const gridEnd = html.indexOf("</div>", html.lastIndexOf('data-entity-hero-tooltip="sellthrough"', html.indexOf('id="entityHeroKpiGrid"', gridStart + 1) + 4000));
  const region = html.slice(gridStart, gridStart + 3000);
  const salesIdx = region.indexOf('id="entityHeroKpiSales"');
  const qtyIdx = region.indexOf('id="entityHeroKpiQty"');
  const ordersIdx = region.indexOf('id="entityHeroKpiOrders"');
  const aovIdx = region.indexOf('id="entityHeroKpiAov"');
  const stockIdx = region.indexOf('id="entityHeroInventoryValue"');
  const sellthroughIdx = region.indexOf('data-entity-hero-tooltip="sellthrough"');
  [salesIdx, qtyIdx, ordersIdx, aovIdx, stockIdx, sellthroughIdx].forEach((idx) => assert.notEqual(idx, -1));
  assert.ok(salesIdx < qtyIdx, "Revenue before Units");
  assert.ok(qtyIdx < ordersIdx, "Units before Orders");
  assert.ok(ordersIdx < aovIdx, "Orders before AOV");
  assert.ok(aovIdx < stockIdx, "AOV before Inventory");
  assert.ok(stockIdx < sellthroughIdx, "Inventory before Sell-through");
});

test("05 PRODUCT section reuses existing online SKU and offline attribution rows without a new fetch", () => {
  const fnStart = js.indexOf("function entityProductRowsForChannel(");
  const fnEnd = js.indexOf("\n}\n", fnStart) + 3;
  const fnRegion = js.slice(fnStart, fnEnd);
  assert.match(fnRegion, /entitySkuRows/);
  assert.match(fnRegion, /entityOfflineAttributionState\.rows/);
  assert.doesNotMatch(fnRegion, /fetch\(|getSharedJson\(/);
});

test("05 PRODUCT section is explicitly labeled online-only", () => {
  const sectionStart = html.indexOf('id="entityProductSection"');
  assert.notEqual(sectionStart, -1);
  const region = html.slice(sectionStart, sectionStart + 900);
  assert.match(region, /Online Only|온라인/);
});

test("05 PRODUCT row current-stock semantics: null stays '-' (NULL != ZERO), never a fabricated 0", () => {
  const fnStart = js.indexOf("function renderEntityProductSection()");
  const fnRegion = js.slice(fnStart, fnStart + 3000);
  assert.match(fnRegion, /row\.stock == null \? "-" : /);
});

test("05 PRODUCT row click and '전체 보기' pass the selected channel to the existing SKU Drawer", () => {
  assert.match(js, /entityProductDrawerBtn[\s\S]*?openEntityDrawer\("sku", \{[\s\S]*?productChannel: entityProductChannelState/);
  assert.match(js, /entityProductList[\s\S]*?openEntityDrawer\("sku", \{[\s\S]*?productChannel: entityProductChannelState/);
});

test("rebuildEntitySkuRows() renders the new Product section at both of its existing exit points (mirrors the established refreshOpenEntitySkuDrawer dual-call-site pattern)", () => {
  const fnStart = js.indexOf("async function rebuildEntitySkuRows()");
  assert.notEqual(fnStart, -1);
  const fnRegion = js.slice(fnStart, js.indexOf("\n}\n", fnStart) + 3);
  const occurrences = fnRegion.match(/renderEntityProductSection\(\);/g) || [];
  assert.equal(occurrences.length, 2, "renderEntityProductSection() must be called from both the early-return and populated branches");
});

test("06 INTELLIGENCE: AI Summary sentences are joined with a newline and rendered as pre-line (short scannable statements, same facts, no new analysis)", () => {
  assert.match(js, /summaryEl\.textContent = sentences\.length \? sentences\.join\("\\n"\) : /);
  assert.match(css, /#entityHeroAiSummary\s*\{[^}]*white-space:\s*pre-line;/);
});

// BI-BATCH-I superseded BATCH-H's Category compacting: Category Intelligence gained a real
// source (SAMPLAS Category Master v1) and is no longer permanently blocked, so the CSS-only
// hide and the "always both empty+content visible" guard no longer apply — see
// test/brand-intelligence-category-master.test.mjs for the new real-data coverage.

test("BI-BATCH-I: FUTURE/BLOCKED status list now names only Sell-through (Category/Score/Grade/Action all shipped v1 definitions)", () => {
  const sectionStart = html.indexOf('id="entityFutureBlockedStatus"');
  assert.notEqual(sectionStart, -1);
  const region = html.slice(sectionStart, html.indexOf("</div>\n\n        <div class=\"section-block brand-category-section\">", sectionStart));
  assert.match(region, /Sell-through/);
  assert.doesNotMatch(region, /Category Intelligence/);
  assert.doesNotMatch(region, /Brand Score/);
  assert.doesNotMatch(region, /추천 Action/);
  const blockedCount = (region.match(/BLOCKED|DEFERRED/g) || []).length;
  assert.equal(blockedCount, 1);
});

test("Score block split: #entityHeroScoreBlock is a standalone hidden panel toggled by renderEntityHeroState() the same way #entityHeroContent is", () => {
  assert.match(html, /<div id="entityHeroScoreBlock" class="brand-hero" hidden>/);
  const fnStart = js.indexOf("function renderEntityHeroState()");
  const fnRegion = js.slice(fnStart, fnStart + 1200);
  assert.match(fnRegion, /\$\("#entityHeroContent"\)\?\.toggleAttribute\("hidden", !selected\);/);
  assert.match(fnRegion, /\$\("#entityHeroScoreBlock"\)\?\.toggleAttribute\("hidden", !selected\);/);
});

test("02 TREND: Monthly Trend chart card gets a wider grid ratio; entityTrendChartSvg/SVG markup is unchanged (CSS-only widening)", () => {
  assert.match(css, /\.brand-monthly-trend-main\s*\{\s*\n\s*display: grid;\s*\n\s*grid-template-columns: 3fr 1fr;/);
  const fnStart = js.indexOf("function entityTrendChartSvg(");
  assert.notEqual(fnStart, -1);
  const fnRegion = js.slice(fnStart, fnStart + 3000);
  assert.match(fnRegion, /viewBox="0 0 \$\{width\} \$\{height\}"/, "chart SVG viewBox template must be unchanged (no JS/SVG edits, CSS-only widening)");
});

// Regression guard (BI-BATCH-H scope): core sales/customer/SKU join semantics were not
// touched by the UX reorganization itself. BI-BATCH-I later approved and implemented
// Category/Score/Grade/Action v1 definitions — see docs/BRAND_INTELLIGENCE_RULES.md.
test("canonical sales/customer/SKU join semantics are untouched by the UX reorganization", () => {
  assert.match(js, /function canonicalPaidAmount\(/);
  assert.match(js, /function entitySkuStockFor\(/);
});
