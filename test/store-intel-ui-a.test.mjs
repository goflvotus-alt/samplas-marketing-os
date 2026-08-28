import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Locked UI Shell for 압구정 Intelligence / VEIL Intelligence, now backed by live data.
// The established structural-assertion
// pattern for client JS/HTML (grep the source, no jsdom execution) is used throughout —
// same approach as test/store-filter.test.mjs and test/store-performance.test.mjs's
// structural tests.
const htmlPromise = readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8");
const jsPromise = readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
let html;
let js;
test.before(async () => {
  html = await htmlPromise;
  js = await jsPromise;
});

// 1/2. nav entries exist
test("1. Apgujeong Intelligence nav entry exists (navItems)", () => {
  assert.match(js, /view:\s*"ApgujeongIntelligence".*label:\s*"압구정 Intelligence"/);
});

test("2. VEIL Intelligence display label keeps the VailIntelligence route contract", () => {
  assert.match(js, /view:\s*"VailIntelligence".*label:\s*"VEIL Intelligence"/);
});

test("2b. both nav entries are grouped under the new store-intelligence section (not mixed into existing groups)", () => {
  assert.match(js, /view: "ApgujeongIntelligence".*group: "store-intelligence"/);
  assert.match(js, /view: "VailIntelligence".*group: "store-intelligence"/);
  assert.match(js, /key: "store-intelligence", label: "STORE INTELLIGENCE"/);
});

// 3/4. views render (section shell present in HTML + route wiring in JS)
test("3. Apgujeong Intelligence view section exists in HTML", () => {
  assert.match(html, /<section id="ApgujeongIntelligence" class="view/);
});

test("4. VAIL Intelligence view section exists in HTML", () => {
  assert.match(html, /<section id="VailIntelligence" class="view/);
});

test("3b/4b. both views are wired into the route maps (viewHashMap) and render on activation (setActiveView)", () => {
  assert.match(js, /ApgujeongIntelligence: "store-apgujeong-intelligence"/);
  assert.match(js, /VailIntelligence: "store-vail-intelligence"/);
  assert.match(js, /if \(targetView === "ApgujeongIntelligence"\) renderApgujeongIntelligenceView\(\);/);
  assert.match(js, /if \(targetView === "VailIntelligence"\) renderVailIntelligenceView\(\);/);
});

// 5/6. exactly 5 KPI cards per screen from each live renderer.
test("5. Apgujeong KPI count = 5", () => {
  const match = js.match(/async function renderApgujeongIntelligenceView\(\) \{[\s\S]*?const kpis = \[([\s\S]*?)\];/);
  assert.notEqual(match, null);
  const count = [...match[1].matchAll(/\{ label:/g)].length;
  assert.equal(count, 5);
});

test("6. VAIL KPI count = 5", () => {
  const match = js.match(/async function renderVailIntelligenceView\(\) \{[\s\S]*?const kpis = \[([\s\S]*?)\];/);
  assert.notEqual(match, null);
  const count = [...match[1].matchAll(/\{ label:/g)].length;
  assert.equal(count, 5);
});

// 7-10. Apgujeong locked sections
test("7. Apgujeong stylist performance section exists (donut + ranking + customer bars)", () => {
  assert.match(html, /스타일리스트 유형 고객 매출 성과/);
  assert.match(html, /id="apgujeongIntelStylistDonut"/);
  assert.match(html, /id="apgujeongIntelStylistRanking"/);
  assert.match(html, /id="apgujeongIntelStylistCustomerBars"/);
});

test("8. Apgujeong brand x stylist section exists (table + customer type donut)", () => {
  assert.match(html, /브랜드 × 스타일리스트 성과/);
  assert.match(html, /id="apgujeongIntelStylistBrandTable"/);
  assert.match(html, /id="apgujeongIntelCustomerTypeDonut"/);
});

test("9. Apgujeong recent customers section exists (5-column table)", () => {
  assert.match(html, /최근 구매 고객 \(상위 5명\)/);
  assert.match(html, /id="apgujeongIntelRecentCustomersTable"/);
  assert.match(html, /<th>고객명<\/th><th>최근 구매일<\/th><th>구매 횟수<\/th><th>총 구매 금액<\/th><th>고객 유형<\/th>/);
});

test("10. Apgujeong today's insight section exists", () => {
  assert.match(html, /오늘의 인사이트/);
  assert.match(html, /id="apgujeongIntelInsightList"/);
});

// 11-17. VAIL locked sections
test("11. VEIL TOP product shell renders canonical API products without mock products", () => {
  assert.match(html, /TOP 상품 \(판매 수량\)/);
  assert.match(html, /id="vailIntelTopProductRow"/);
  assert.match(js, /const products = data\.products\?\.items \|\| \[\]/);
  assert.match(js, /product\.product_name \|\| product\.product_code/);
});

test("12. VAIL brand performance section exists", () => {
  assert.match(html, /브랜드 성과 \(매출\)/);
  assert.match(html, /id="vailIntelBrandRanking"/);
});

test("13. VAIL category composition section exists", () => {
  assert.match(html, /카테고리 구성 \(매출 비중\)/);
  assert.match(html, /id="vailIntelCategoryDonut"/);
});

test("14. VAIL Sell-through shell exists with explicit unavailable state", () => {
  assert.match(html, /Sell-through \(입고 후 경과일\)/);
  assert.match(html, /id="vailIntelSellThroughKpi"/);
  assert.match(js, /vailIntelSellThroughKpi"\)\.innerHTML = storeIntelUnavailableHtml\(data\.sellThrough\.reason\)/);
});

test("15. VAIL inventory shell exists with explicit unavailable state", () => {
  assert.match(html, /재고 현황/);
  assert.match(html, /id="vailIntelInventoryKpi"/);
  assert.match(js, /vailIntelInventoryKpi"\)\.innerHTML = storeIntelUnavailableHtml\(data\.inventory\.reason\)/);
});

test("16. VAIL new-brand reaction section exists (4-column table)", () => {
  assert.match(html, /신규 입점 브랜드 반응/);
  assert.match(html, /id="vailIntelNewBrandTable"/);
  assert.match(html, /<th>브랜드<\/th><th>입점일<\/th><th>7일 매출<\/th><th>Sell-through\(7일\)<\/th>/);
});

test("17. VAIL MD insight section exists", () => {
  assert.match(html, /오늘의 MD 인사이트/);
  assert.match(html, /id="vailIntelInsightList"/);
});

// Both screens are locked to their own distinct information priority, not the same
// template with only the title swapped (the batch's core requirement).
test("Apgujeong and VAIL render functions are structurally distinct (not a shared template)", () => {
  assert.match(js, /async function renderApgujeongIntelligenceView\(\)/);
  assert.match(js, /async function renderVailIntelligenceView\(\)/);
  assert.doesNotMatch(js, /async function renderApgujeongIntelligenceView\(\)[\s\S]{0,20}renderVailIntelligenceView/);
});

test("data policy: both renderers use the shared live endpoint and no MOCK source remains", () => {
  assert.match(js, /\/api\/intelligence\/store\?store=/);
  assert.doesNotMatch(js, /MOCK_APGUJEONG_INTELLIGENCE/);
  assert.doesNotMatch(js, /MOCK_VAIL_INTELLIGENCE/);
});

// 18-20. existing screens' markup untouched
test("18. existing Today (Overview) view markup preserved", () => {
  assert.match(html, /<section id="Overview" class="view active">/);
  assert.match(html, /오늘 운영 홈/);
});

test("19. existing Monthly (Reports) view markup preserved", () => {
  assert.match(html, /<section id="Reports" class="view">/);
  assert.match(html, /id="monthlyCalendarSlot"/);
  assert.match(html, /id="monthlyArchiveReport"/);
});

test("20. existing Brand Intelligence (BrandDashboard) view markup preserved", () => {
  assert.match(html, /<section id="BrandDashboard" class="view">/);
});

test("20b. existing Clients view markup preserved (also checked live in Chrome QA)", () => {
  assert.match(html, /<section id="Clients" class="view">/);
});

test("sidebar: new store-intelligence group does not remove or reorder existing public/management groups", () => {
  const match = js.match(/const groups = \[([\s\S]*?)\];/);
  assert.notEqual(match, null);
  const order = [...match[1].matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["public", "management", "store-intelligence"]);
});
