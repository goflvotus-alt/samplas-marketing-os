import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// STORE-INTEL-UI-A: Locked UI Shell for 압구정 Intelligence / VAIL Intelligence.
// This batch is UI-only (no data connection), so the established structural-assertion
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

test("2. VAIL Intelligence nav entry exists (navItems)", () => {
  assert.match(js, /view:\s*"VailIntelligence".*label:\s*"VAIL Intelligence"/);
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

// 5/6. exactly 5 KPI cards per screen (from the MOCK data driving the render, since the
// DOM is only populated at runtime — checking the fixture length is the correct level
// for a structural test and matches what renderApgujeongIntelligenceView/
// renderVailIntelligenceView will actually render, 1:1, with no filtering in between).
test("5. Apgujeong KPI count = 5", () => {
  const match = js.match(/const MOCK_APGUJEONG_INTELLIGENCE = \{\s*kpis: \[([\s\S]*?)\]/);
  assert.notEqual(match, null);
  const count = [...match[1].matchAll(/\{ label:/g)].length;
  assert.equal(count, 5);
});

test("6. VAIL KPI count = 5", () => {
  const match = js.match(/const MOCK_VAIL_INTELLIGENCE = \{\s*kpis: \[([\s\S]*?)\]/);
  assert.notEqual(match, null);
  const count = [...match[1].matchAll(/\{ label:/g)].length;
  assert.equal(count, 5);
});

// 7-10. Apgujeong locked sections
test("7. Apgujeong stylist performance section exists (donut + ranking + customer bars)", () => {
  assert.match(html, /스타일리스트 매출 성과/);
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
  assert.match(html, /<th>고객명<\/th><th>최근 구매일<\/th><th>구매 횟수<\/th><th>총 구매 금액<\/th><th>담당 스타일리스트<\/th>/);
});

test("10. Apgujeong today's insight section exists", () => {
  assert.match(html, /오늘의 인사이트/);
  assert.match(html, /id="apgujeongIntelInsightList"/);
});

// 11-17. VAIL locked sections
test("11. VAIL TOP product section exists with exactly 5 mock products", () => {
  assert.match(html, /TOP 상품 \(판매 수량\)/);
  assert.match(html, /id="vailIntelTopProductRow"/);
  const match = js.match(/const MOCK_VAIL_INTELLIGENCE = \{[\s\S]*?topProducts: \[([\s\S]*?)\]/);
  assert.notEqual(match, null);
  const count = [...match[1].matchAll(/\{ rank:/g)].length;
  assert.equal(count, 5);
});

test("12. VAIL brand performance section exists", () => {
  assert.match(html, /브랜드 성과 \(매출\)/);
  assert.match(html, /id="vailIntelBrandRanking"/);
});

test("13. VAIL category composition section exists", () => {
  assert.match(html, /카테고리 구성 \(매출 비중\)/);
  assert.match(html, /id="vailIntelCategoryDonut"/);
});

test("14. VAIL Sell-through shell exists (3 KPI, placeholder only)", () => {
  assert.match(html, /Sell-through \(입고 후 경과일\)/);
  assert.match(html, /id="vailIntelSellThroughKpi"/);
  const match = js.match(/sellThrough: \[([\s\S]*?)\]/);
  assert.notEqual(match, null);
  const count = [...match[1].matchAll(/\{ label:/g)].length;
  assert.equal(count, 3);
});

test("15. VAIL inventory shell exists (3 KPI, placeholder only)", () => {
  assert.match(html, /재고 현황/);
  assert.match(html, /id="vailIntelInventoryKpi"/);
  const match = js.match(/inventory: \[([\s\S]*?)\]/);
  assert.notEqual(match, null);
  const count = [...match[1].matchAll(/\{ label:/g)].length;
  assert.equal(count, 3);
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
  assert.match(js, /function renderApgujeongIntelligenceView\(\)/);
  assert.match(js, /function renderVailIntelligenceView\(\)/);
  assert.doesNotMatch(js, /function renderApgujeongIntelligenceView\(\)[\s\S]{0,20}renderVailIntelligenceView/);
});

test("data policy: both MOCK sources are clearly named/commented as UI-shell mock data, not written to production data files", () => {
  assert.match(js, /UI SHELL FIRST, DATA SECOND/);
  assert.match(js, /const MOCK_APGUJEONG_INTELLIGENCE = /);
  assert.match(js, /const MOCK_VAIL_INTELLIGENCE = /);
  assert.doesNotMatch(js, /writeFile.*MOCK_APGUJEONG_INTELLIGENCE/);
  assert.doesNotMatch(js, /writeFile.*MOCK_VAIL_INTELLIGENCE/);
});

// 18-20. existing screens' markup untouched
test("18. existing Today (Overview) view markup preserved", () => {
  assert.match(html, /<section id="Overview" class="view active">/);
  assert.match(html, /오늘 운영 홈/);
});

test("19. existing Monthly (Reports) view markup preserved", () => {
  assert.match(html, /<section id="Reports" class="view">/);
  assert.match(html, /월간 운영/);
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
