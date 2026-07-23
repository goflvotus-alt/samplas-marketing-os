// SAMPLAS Inventory Overview (Phase 3A / Phase 3A-2) — scripts/inventory-overview-lib.mjs 테스트.
// ECOUNT stockQuantity를 유일한 재고 기준으로 하는 순수 계산 로직만 검증한다.
// (intelligence-service.mjs의 HTTP 라우팅/파일 I/O는 여기서 다루지 않음.)
//
// Phase 3A-2 정책: 일반 상품과 QQQ 상품의 재고 해석 규칙이 서로 다르며 KPI도 절대 섞이지 않는다.
// null(재고 미수신)과 0(재고 소진)은 서로 다른 상태다. QQQ는 더 이상 집계에서 제외되지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  splitEcountBrandProduct,
  parseQqqBrandProduct,
  normalizeBrandKey,
  resolveEcountBrand,
  resolveDisplayBrand,
  isQqqProductCode,
  classifyGeneralStock,
  classifyQqqStock,
  estimatedQqqSoldQuantity,
  isLowStockCandidate,
  buildLocationInfo,
  buildOfflineSalesIndex,
  lookupOfflineSales,
  buildInventoryOverview,
  filterAndSortItems,
  LOCATION_DISPLAY_NAMES
} from "../scripts/inventory-overview-lib.mjs";

test("splitEcountBrandProduct: 표준 '브랜드 / 상품명' 형태", () => {
  const result = splitEcountBrandProduct("ANOTHERUSE / leather patch beanie");
  assert.equal(result.brandRaw, "ANOTHERUSE");
  assert.equal(result.nameRaw, "leather patch beanie");
});

test("splitEcountBrandProduct: 슬래시 앞 공백이 없는 실제 케이스도 처리", () => {
  const result = splitEcountBrandProduct("AAH MIDNIGHT/ Flow Flared Jeans");
  assert.equal(result.brandRaw, "AAH MIDNIGHT");
  assert.equal(result.nameRaw, "Flow Flared Jeans");
});

test("splitEcountBrandProduct: 슬래시가 없는 관리용 코드는 brandRaw가 빈 문자열", () => {
  const result = splitEcountBrandProduct("할인");
  assert.equal(result.brandRaw, "");
  assert.equal(result.nameRaw, "할인");
});

test("isQqqProductCode: QQQ로 시작하는 productCode만 true", () => {
  assert.equal(isQqqProductCode("QQQ00002"), true);
  assert.equal(isQqqProductCode("qqq0001"), true);
  assert.equal(isQqqProductCode("ANO261AC00100"), false);
});

test("parseQqqBrandProduct: 대괄호 표기 + 가격 접미사 제거", () => {
  const result = parseQqqBrandProduct("[604SERVICE : 604서비스] EMBROIDERED LEATHER JACKET IN CHARCOAL / 420,000");
  assert.equal(result.brandRaw, "604SERVICE");
  assert.equal(result.nameRaw, "EMBROIDERED LEATHER JACKET IN CHARCOAL");
  assert.equal(result.parseConfidence, "bracket");
});

test("parseQqqBrandProduct: 표준 슬래시 형식도 처리", () => {
  const result = parseQqqBrandProduct("EMOSTANCECLUB / SPANDEX VEGAN LEATHER BOMBER JACKET BLACK");
  assert.equal(result.brandRaw, "EMOSTANCECLUB");
  assert.equal(result.parseConfidence, "slash");
});

test("parseQqqBrandProduct: 파싱 불가하면 원문 보존(브랜드 억지 생성 금지)", () => {
  const result = parseQqqBrandProduct("퀵비-1");
  assert.equal(result.brandRaw, "");
  assert.equal(result.nameRaw, "퀵비-1");
  assert.equal(result.parseConfidence, "raw");
});

test("normalizeBrandKey: 공백/대소문자/특수문자 정규화", () => {
  assert.equal(normalizeBrandKey("  Another   Use "), normalizeBrandKey("another use"));
});

test("resolveEcountBrand: 이름/아이디/별칭으로 정확히 매칭", () => {
  const registry = {
    brands: [{ id: "B0001", name: "어나더유스", active: true }],
    aliases: [{ alias: "ANOTHERUSE", brandId: "B0001" }]
  };
  assert.deepEqual(resolveEcountBrand("어나더유스", registry), { brandId: "B0001", name: "어나더유스", source: "registry_name" });
  assert.deepEqual(resolveEcountBrand("B0001", registry), { brandId: "B0001", name: "어나더유스", source: "registry_id" });
  assert.deepEqual(resolveEcountBrand("anotheruse", registry), { brandId: "B0001", name: "어나더유스", source: "registry_alias" });
  assert.equal(resolveEcountBrand("NOT_A_BRAND", registry), null);
});

test("resolveDisplayBrand: 레지스트리에 없으면 원문 브랜드명을 정보 손실 없이 그대로 사용", () => {
  const registry = { brands: [], aliases: [] };
  const display = resolveDisplayBrand("SOME ENGLISH BRAND", registry);
  assert.equal(display.canonical, false);
  assert.equal(display.name, "SOME ENGLISH BRAND");
  assert.equal(display.key, `raw:${normalizeBrandKey("SOME ENGLISH BRAND")}`);
});

// ---- Section 12 필수 테스트 1~4: 일반 상품 재고 해석 ----

test("[필수1] 일반 상품 재고 2 → 재고 있음(in_stock)", () => {
  assert.equal(classifyGeneralStock(2), "in_stock");
});

test("[필수2] 일반 상품 재고 0 → 재고 소진 후보(depleted_candidate), 오류 아님", () => {
  assert.equal(classifyGeneralStock(0), "depleted_candidate");
});

test("[필수3] 일반 상품 재고 -1 → 음수 확인 필요(negative_review)", () => {
  assert.equal(classifyGeneralStock(-1), "negative_review");
});

test("[필수4] 일반 상품 null → 재고 미수신(unknown), 0과 다름", () => {
  assert.equal(classifyGeneralStock(null), "unknown");
  assert.notEqual(classifyGeneralStock(null), classifyGeneralStock(0));
});

// ---- Section 12 필수 테스트 5~8: QQQ 상품 재고 해석 ----

test("[필수5] QQQ -1 → 추정 판매 1개", () => {
  assert.equal(classifyQqqStock(-1), "qqq_estimated_sale");
  assert.equal(estimatedQqqSoldQuantity(-1), 1);
});

test("[필수6] QQQ -3 → 추정 판매 3개", () => {
  assert.equal(classifyQqqStock(-3), "qqq_estimated_sale");
  assert.equal(estimatedQqqSoldQuantity(-3), 3);
});

test("[필수7] QQQ 음수가 일반 Negative Stock(negative_review) KPI와 절대 섞이지 않음", () => {
  const ecountRows = [
    { productCode: "GEN001", productName: "BRAND1 / P1", specification: "S", stockQuantity: -5 },
    { productCode: "QQQ0001", productName: "BRAND2 / P2", specification: "S", stockQuantity: -5 }
  ];
  const { summary, items } = buildInventoryOverview({
    ecountRows,
    brandRegistry: { brands: [], aliases: [] },
    salesIndex: buildOfflineSalesIndex([]),
    registryProdCds: new Set()
  });
  assert.equal(summary.negativeReviewSkuCount, 1); // GEN001만
  assert.equal(summary.qqqEstimatedSoldSkuCount, 1); // QQQ0001만
  assert.equal(items.find((i) => i.prodCd === "GEN001").status, "negative_review");
  assert.equal(items.find((i) => i.prodCd === "QQQ0001").status, "qqq_estimated_sale");
});

test("[필수8] QQQ 0을 판매 1개로 임의 계산하지 않음", () => {
  assert.equal(classifyQqqStock(0), "qqq_depleted_record");
  assert.equal(estimatedQqqSoldQuantity(0), 0);
});

// ---- Section 12 필수 테스트 9~11: null 처리 / 위치 데이터 ----

test("[필수9] null을 0으로 취급하지 않음(일반/QQQ 모두)", () => {
  assert.notEqual(classifyGeneralStock(null), classifyGeneralStock(0));
  assert.notEqual(classifyQqqStock(null), classifyQqqStock(0));
  assert.equal(estimatedQqqSoldQuantity(null), null);
  assert.notEqual(estimatedQqqSoldQuantity(null), estimatedQqqSoldQuantity(0));
});

test("[필수10] 위치별 데이터 없음 → STORE_1/OFFSITE/UNKNOWN 모두 null (0 아님)", () => {
  const location = buildLocationInfo();
  assert.equal(location.locations.STORE_1, null);
  assert.equal(location.locations.OFFSITE, null);
  assert.equal(location.locations.UNKNOWN, null);
  assert.equal(location.locationCoverageStatus, "unavailable");
  assert.notEqual(location.locations.STORE_1, 0);
});

test("[필수11] 위치 이동 가능성을 입고/판매로 계산하지 않음 — buildLocationInfo는 재고 수치를 변경하지 않는다", () => {
  const before = { stockQuantity: 7 };
  const location = buildLocationInfo(before);
  assert.equal(before.stockQuantity, 7); // 원본 재고 수치는 그대로
  assert.equal(location.locations.STORE_1, null);
});

// ---- 브랜드 파싱 제외 없음 확인 (QQQ/관리코드 모두 포함되어야 함) ----

test("buildInventoryOverview: QQQ와 관리코드 모두 items에 포함(제외하지 않음)", () => {
  const ecountRows = [
    { productCode: "00000", productName: "할인", specification: null, barcode: null, purchasePrice: 0, salesPrice: 0, stockQuantity: -500 },
    { productCode: "QQQ00009", productName: "[CARNET ARCHIVE : 카르넷 아카이브] MASS DENIM JACKET DARK GREY", specification: "OS", barcode: null, purchasePrice: 0, salesPrice: 0, stockQuantity: -1 },
    { productCode: "ANO261AC00100", productName: "ANOTHERUSE / leather patch beanie", specification: "OS", barcode: "BC1", purchasePrice: 1000, salesPrice: 2000, stockQuantity: 3 }
  ];
  const registry = { brands: [{ id: "B0001", name: "어나더유스", active: true }], aliases: [{ alias: "ANOTHERUSE", brandId: "B0001" }] };
  const { items, summary } = buildInventoryOverview({
    ecountRows,
    brandRegistry: registry,
    salesIndex: buildOfflineSalesIndex([]),
    registryProdCds: new Set(["ANO261AC00100"]),
    lowStockThreshold: 3
  });
  assert.equal(items.length, 3); // 아무것도 제외되지 않음
  assert.equal(summary.totalSkuCount, 3);
  assert.equal(summary.adminCodeSkuCount, 1);
  assert.equal(summary.qqqSkuCount, 1);
  assert.equal(summary.generalSkuCount, 1);

  const admin = items.find((i) => i.prodCd === "00000");
  assert.equal(admin.productType, "admin_code");
  assert.equal(admin.status, "negative_review"); // 관리코드도 일반 규칙 적용

  const qqq = items.find((i) => i.prodCd === "QQQ00009");
  assert.equal(qqq.productType, "qqq");
  assert.equal(qqq.status, "qqq_estimated_sale");
  assert.equal(qqq.estimatedSoldQuantity, 1);
  assert.equal(qqq.brandName, "CARNET ARCHIVE"); // 대괄호 파싱 성공

  const general = items.find((i) => i.prodCd === "ANO261AC00100");
  assert.equal(general.brandName, "어나더유스");
  assert.equal(general.status, "in_stock");
  assert.equal(general.lowStockCandidate, true); // 3 <= threshold(3)이지만 KPI에는 미포함, 보조 플래그만
  assert.equal(general.registryLinked, true);
});

test("isLowStockCandidate: in_stock이면서 임계값 이하일 때만 true, KPI 핵심 집계와 분리된 보조 플래그", () => {
  assert.equal(isLowStockCandidate("in_stock", 3, 3), true);
  assert.equal(isLowStockCandidate("in_stock", 10, 3), false);
  assert.equal(isLowStockCandidate("depleted_candidate", 0, 3), false);
  assert.equal(isLowStockCandidate("negative_review", -1, 3), false);
});

test("buildInventoryOverview: summary KPI 집계 — 일반/QQQ 완전 분리", () => {
  const ecountRows = [
    { productCode: "A1", productName: "BRAND1 / P1", specification: "S", stockQuantity: 10 },
    { productCode: "A2", productName: "BRAND1 / P2", specification: "M", stockQuantity: 0 },
    { productCode: "A3", productName: "BRAND2 / P3", specification: "L", stockQuantity: -2 },
    { productCode: "A4", productName: "BRAND2 / P4", specification: "S", stockQuantity: 2 },
    { productCode: "A5", productName: "BRAND2 / P5", specification: "S", stockQuantity: null },
    { productCode: "QQQ1", productName: "BRAND3 / Q1", specification: "S", stockQuantity: -4 },
    { productCode: "QQQ2", productName: "BRAND3 / Q2", specification: "S", stockQuantity: null }
  ];
  const { summary, brandRollup } = buildInventoryOverview({
    ecountRows,
    brandRegistry: { brands: [], aliases: [] },
    salesIndex: buildOfflineSalesIndex([]),
    registryProdCds: new Set(),
    lowStockThreshold: 3
  });
  assert.equal(summary.totalSkuCount, 7);
  assert.equal(summary.generalSkuCount, 5);
  assert.equal(summary.qqqSkuCount, 2);
  assert.equal(summary.totalKnownStock, 12); // 10 + 2 (in_stock만, 0/음수/null 제외)
  assert.equal(summary.inStockSkuCount, 2);
  assert.equal(summary.depletedSkuCount, 1);
  assert.equal(summary.negativeReviewSkuCount, 1);
  assert.equal(summary.unknownStockSkuCount, 1);
  assert.equal(summary.qqqEstimatedSoldSkuCount, 1);
  assert.equal(summary.qqqEstimatedSoldQuantity, 4);
  assert.equal(summary.qqqUnknownSkuCount, 1);
  assert.equal(brandRollup.length, 3);
});

test("filterAndSortItems: QQQ 검색/필터 정상 동작", () => {
  const items = [
    { brandKey: "b1", brandName: "가나다", productName: "P1", prodCd: "C1", barcode: "", productType: "general", status: "in_stock", stockQuantity: 10, recentSalesQty: 0, locationCoverageStatus: "unavailable" },
    { brandKey: "b2", brandName: "QBRAND", productName: "QQQ item", prodCd: "QQQ1", barcode: "", productType: "qqq", status: "qqq_estimated_sale", stockQuantity: -2, recentSalesQty: 0, locationCoverageStatus: "unavailable" }
  ];
  const qqqOnly = filterAndSortItems(items, { status: "qqq_estimated_sale" });
  assert.equal(qqqOnly.length, 1);
  assert.equal(qqqOnly[0].prodCd, "QQQ1");

  const searched = filterAndSortItems(items, { search: "QQQ item" });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].prodCd, "QQQ1");

  const locationFilter = filterAndSortItems(items, { status: "location_unknown" });
  assert.equal(locationFilter.length, 2); // 현재는 전부 unavailable
});

test("filterAndSortItems: 기존 필터(brand/search/sort) 호환성 유지", () => {
  const items = [
    { brandKey: "b1", brandName: "가나다", productName: "P1", prodCd: "C1", barcode: "", productType: "general", status: "in_stock", stockQuantity: 10, recentSalesQty: 0, locationCoverageStatus: "unavailable" },
    { brandKey: "b1", brandName: "가나다", productName: "P2", prodCd: "C2", barcode: "", productType: "general", status: "depleted_candidate", stockQuantity: 0, recentSalesQty: 5, locationCoverageStatus: "unavailable" },
    { brandKey: "b2", brandName: "마바사", productName: "P3", prodCd: "C3", barcode: "", productType: "general", status: "negative_review", stockQuantity: -1, recentSalesQty: 1, locationCoverageStatus: "unavailable" }
  ];
  const filteredByBrand = filterAndSortItems(items, { brand: "b1" });
  assert.equal(filteredByBrand.length, 2);

  const bySales = filterAndSortItems(items, { sort: "recent-sales-desc" });
  assert.deepEqual(bySales.map((i) => i.prodCd), ["C2", "C3", "C1"]);

  const sorted = filterAndSortItems(items, {});
  assert.equal(sorted[0].prodCd, "C3"); // negative_review가 최우선
});

test("buildOfflineSalesIndex: isOfflineRevenue=false(택배 등)는 집계에서 제외", () => {
  const monthlyFiles = [
    {
      month: "2026-07",
      rows: [
        { date: "2026-07-01", productName: "A / X", specification: "OS", quantity: 2, isOfflineRevenue: true },
        { date: "2026-07-02", productName: "A / X", specification: "OS", quantity: -1, isOfflineRevenue: true },
        { date: "2026-07-03", productName: "A / X", specification: "OS", quantity: 100, isOfflineRevenue: false }
      ]
    }
  ];
  const { index, latestDataDate } = buildOfflineSalesIndex(monthlyFiles);
  assert.equal(latestDataDate, "2026-07-02");
  const sales = lookupOfflineSales({ index }, "A / X", "OS");
  assert.equal(sales.recentQty, 1);
  assert.equal(sales.lastSaleDate, "2026-07-02");
});

test("buildOfflineSalesIndex: 30일 lookback 밖의 판매는 recentQty에서 제외", () => {
  const monthlyFiles = [
    { month: "2026-01", rows: [{ date: "2026-01-01", productName: "A / X", specification: "OS", quantity: 50, isOfflineRevenue: true }] },
    { month: "2026-07", rows: [{ date: "2026-07-15", productName: "A / X", specification: "OS", quantity: 3, isOfflineRevenue: true }] }
  ];
  const { index } = buildOfflineSalesIndex(monthlyFiles);
  const sales = lookupOfflineSales({ index }, "A / X", "OS");
  assert.equal(sales.recentQty, 3);
  assert.equal(sales.lastSaleDate, "2026-07-15");
});

test("lookupOfflineSales: 매칭 안 되면 0/null 반환", () => {
  const { index } = buildOfflineSalesIndex([]);
  const sales = lookupOfflineSales({ index }, "없는상품", "OS");
  assert.deepEqual(sales, { recentQty: 0, lastSaleDate: null });
});

test("LOCATION_DISPLAY_NAMES: 내부 코드와 표시명이 분리되어 있음(향후 STORE_2 확장 가능)", () => {
  assert.equal(LOCATION_DISPLAY_NAMES.STORE_1, "현 매장");
  assert.equal(LOCATION_DISPLAY_NAMES.OFFSITE, "3PL");
  assert.equal(LOCATION_DISPLAY_NAMES.UNKNOWN, "확인 불가");
});
