import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Brand Intelligence uses canonical product names and live ECOUNT inventory", async () => {
  const [js, html] = await Promise.all([
    readFile(new URL("outputs/samplas-marketing-os.js", root), "utf8"),
    readFile(new URL("outputs/samplas-marketing-os.html", root), "utf8")
  ]);
  assert.match(js, /registerProductRegistryCanonicalNames\(productRegistry/);
  assert.match(js, /\/api\/inventory\/overview\?limit=1/);
  assert.match(js, /resolveRawBrandCanonical\(rawName\) === brandIdentityState\.name/);
  assert.match(html, /id="entityHeroInventoryValue"/);
  assert.doesNotMatch(html, /data-entity-hero-tooltip="stock"[\s\S]{0,220}SOURCE NOT AVAILABLE/);
  assert.match(html, /BLOCKED · 공식 산식 필요/);
  assert.doesNotMatch(html, /id="entityCompareToggle"[^>]+(?:disabled|aria-disabled)/);
  // BI-BATCH-I: Category Intelligence는 더 이상 영구 BLOCKED가 아니다(SAMPLAS Category
  // Master v1) — 브랜드 미선택 상태의 empty 문구만 확인한다.
  assert.match(html, /브랜드를 선택하면 상품군 데이터를 확인할 수 있습니다/);
  assert.match(js, /getSharedJson\("\/api\/intelligence\/product-registry"/);
  assert.match(js, /const brandSelectorRecentNames = \[\];/);
  assert.match(js, /const entitySkuRows = \[\];/);
  assert.match(js, /const entityOrderRows = \[\];/);
  assert.match(js, /const entityClientRecentPurchases = \[\];/);
  assert.doesNotMatch(js, /const entitySkuRows = \[[\s\S]{0,800}SKU-CC01/);
  assert.doesNotMatch(js, /const entityClientRecentPurchases = \[[\s\S]{0,800}Classic Blazer/);
  assert.doesNotMatch(js, /function entityCompositionProfileHtml[\s\S]{0,2500}Top 5% 고객/);
  assert.match(html, /class="section-block brand-category-section">/);
  assert.match(html, /class="brand-hero-status-row">/);
  assert.match(js, /const entityCategoryRows = \[\];/);
  assert.match(js, /getSharedJson\("\/api\/status"/);
  assert.match(js, /\/api\/ecount-sales\/monthly\?month=/);
  assert.match(js, /brandIdentityState\.brandCode \? "선택한 기간에 고객 데이터가 없습니다"/);
  assert.match(js, /const periodArchive = archives\[periodIndex\];/);
  assert.match(js, /refreshEntitySkuSales\(brandCode, periodMonth, periodProductSales, Boolean\(periodArchive\?\.error\)\)/);
  assert.match(html, /id="entitySystemStatusCafe24"/);
  assert.match(html, /id="entitySystemStatusEcount"/);
  assert.doesNotMatch(html, /2분 전 동기화|5분 전 동기화|32분 전 동기화|09:00 동기화/);
  assert.match(js, /getSharedJson\(`\/api\/reports\/monthly\?month=/);
  assert.doesNotMatch(html, /<option value="prev">2026년 6월<\/option>/);
  assert.match(js, /return entityComparePeriodKeyForMode\(\$\("#entityCompareTarget"\)\?\.value \|\| "prev"\)/);
  assert.match(js, /current\[field\] - target\[field\]/);
  assert.match(js, /renderEntityCompareTargetPeriodKpis\(\)/);
  assert.match(js, /return refreshEntityCompareTargetPeriodData\(\)/);
  assert.match(js, /function entityCompareKpiRowFromArchive[\s\S]{0,350}if \(!row\) return null;[\s\S]{0,150}const revenue = canonicalPaidAmount\(row\)/);
  assert.equal((html.match(/class="entity-compare-performance-table"/g) || []).length, 4);
  assert.doesNotMatch(html, /entity-compare-kpi-tag/);
  assert.match(html, /data-entity-compare-current-period>현재 기간/);
  assert.match(html, /data-entity-compare-target-period>비교 대상/);
  assert.match(html, /현재 - 비교 대상/);
  assert.match(js, /rowHtml\(brandAName, entityCompareTargetPeriodData\.aCurrent, entityCompareTargetPeriodData\.aTarget\)/);
  assert.match(js, /rowHtml\(brandBName, entityCompareTargetPeriodData\.bCurrent, entityCompareTargetPeriodData\.bTarget\)/);
  // STEP67-10G-3: 고정 placeholder 문구 대신 renderEntityCompareSummary()가 결정론적
  // 결과로 채운다 — 정적 fallback만 여기서 확인(see test/brand-comparison-summary.test.mjs).
  assert.match(html, /id="entityCompareSummaryText"/);
  assert.match(html, /id="entityCompareCompositionDonutA"/);
  assert.match(html, /id="entityCompareCompositionDonutB"/);
  assert.doesNotMatch(html, /entity-compare-mini-label [ab]">(?:기준|비교) · <span id="entityCompareComposition/);
  assert.match(js, /let entityCompareCompositionState = \{[\s\S]{0,180}status: "unselected"/);
  assert.match(js, /function entityCompositionDataset[\s\S]{0,220}status: "error"[\s\S]{0,120}status: "empty"/);
  assert.match(js, /해당 기간 오프라인 고객 데이터 없음/);
  assert.match(js, /데이터 연결 실패/);
  assert.match(js, /if \(!entityCompareState\.enabled \|\| brandBName === "비교 브랜드 선택"\)[\s\S]{0,180}return;/);
  assert.match(js, /resolveBrandIdentity\(brandBName\)\.brandCode/);
  assert.match(js, /async function refreshEntityCompareCustomerComposition\(month = currentEntityPeriodMonthKey\(\)\)/);
  assert.match(js, /renderEntityCompositionSection\(\);[\s\S]{0,120}renderEntityCompareComposition\(\);/);
});
