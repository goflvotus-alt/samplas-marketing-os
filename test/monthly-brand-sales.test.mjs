import assert from "node:assert/strict";
import { mergeOfflineBrandSales } from "../scripts/monthly-brand-sales.mjs";
import { buildBrandRegistry } from "../scripts/brand-engine.mjs";

// STEP67-3: 오프라인 브랜드 귀속이 Unified Identity Pipeline(resolveIdentity)에 위임되므로,
// identityContext를 실제 프로덕션과 같은 모양으로 직접 구성해 전달한다(파일 I/O 없이
// test/unified-identity-resolver.test.mjs의 synthetic 패턴과 동일한 방식).

const online = [{
  brand_code: "B00000HD",
  brand_name: "선데이오프클럽",
  quantitySold: 1,
  orderCount: 1,
  sales: { grossAmount: 100000, paidAmount: 95000, discountAmount: 5000 }
}];
const offline = [{
  date: "2026-06-01",
  documentNo: "1",
  productName: "SUNDAYOFFCLUB / Product",
  quantity: 2,
  salesAmount: 21981400,
  isOfflineRevenue: true
}, {
  date: "2026-06-01",
  documentNo: "2",
  productName: "UNKNOWN / Product",
  quantity: 1,
  salesAmount: 1000,
  isOfflineRevenue: true
}, {
  date: "2026-06-01",
  documentNo: "3",
  productName: "SUNDAYOFFCLUB / Excluded",
  quantity: 1,
  salesAmount: 9999,
  isOfflineRevenue: false
}];

// Brand Master 표기명은 한글("선데이오프클럽")이라 ECOUNT productName의 영문 후보
// ("SUNDAYOFFCLUB")와 정확히 일치하지 않는다 — 실제 프로덕션에서는 그 기간 온라인
// 카탈로그(productSales의 "[SUNDAYOFFCLUB : 선데이오프클럽]" 표기)로 2차 조회해 이
// 간극을 메운다(scripts/unified-identity-resolver.mjs의 STEP63-2B 온라인 카탈로그
// 2차 조회원과 동일한 개념). 이 identityContext는 그 결과를 미리 계산해 넣은 것이다.
const identityContext1 = {
  brandMaster: { brands: online },
  brandRegistry: buildBrandRegistry({ brands: online }),
  productRegistry: { entries: [] },
  reviewQueue: null,
  onlineCatalogRegistry: buildBrandRegistry({
    brands: [{ brand_code: "B00000HD", brand_name: "선데이오프클럽", name_aliases: ["SUNDAYOFFCLUB"] }]
  })
};

const merged = mergeOfflineBrandSales({
  brandSales: online,
  onlinePaidAmount: 100000,
  offlineLines: offline,
  since: "2026-06-01",
  until: "2026-06-30",
  identityContext: identityContext1
});
const sunday = merged.find((brand) => brand.brand_code === "B00000HD");
const unassigned = merged.find((brand) => brand.brand_code === "UNASSIGNED");

assert.equal(sunday.offlineSalesAmount, 21981400, "SUNDAY OFF CLUB ECOUNT 매출을 Unified Identity로 기존 canonical 브랜드에 합산");
assert.equal(sunday.sales.paidAmount, 22076400, "온라인과 오프라인 매출 합산");
assert.equal(sunday.quantitySold, 3, "온라인과 오프라인 수량 합산");
assert.equal(sunday.orderCount, 2, "오프라인 전표를 브랜드 주문수에 한 번만 합산");
assert.equal(unassigned.sales.paidAmount, 6000, "온라인 미배분액과 미매칭(UNKNOWN) 오프라인을 UNASSIGNED에 보존");
assert.equal(
  merged.reduce((total, brand) => total + brand.sales.paidAmount, 0),
  22082400,
  "브랜드 전체 합계가 온라인 총매출과 오프라인 총매출 합계와 일치(Revenue Preservation)"
);
assert.equal(online[0].sales.paidAmount, 95000, "입력 데이터는 변경하지 않음");
assert.throws(() => mergeOfflineBrandSales({ brandSales: online, offlineLines: offline }), /identityContext/, "identityContext 없이는 실행하지 않는다(임의 귀속 방지)");

// STEP67-3: 운영 품목그룹(QQQ 퀵/BON CO/POP CO/SUN CO)을 canonical brand로 쓰지 않는다는
// 기존 정책은 그대로 유지된다. 다만 Unified Identity Pipeline은 Resolver F가 갖고 있던
// "오프라인 productName과 온라인 상품명이 완전히 문자열 일치할 때"(대괄호/슬래시 표기가
// 전혀 없는 경우, 예: "KOIN SEOUL x MEANTIME collaboration")의 전체 문자열 매칭 tier가
// 없다 — 대괄호/슬래시로 후보를 추출할 수 있는 표기만 판정한다(STEP67-3 Report 6번
// 항목 "Resolver F vs Unified Differences"에 동일하게 기록됨). 이 테스트는 그 실제
// 동작 차이를 정확히 반영한다(추측으로 옛 결과에 맞추지 않는다).
const identityContext2 = {
  brandMaster: {
    brands: [
      { brand_code: "B00000SA", brand_name: "BONNAE" },
      { brand_code: "B-KOIN", brand_name: "KOIN SEOUL" },
      { brand_code: "B-OTHER", brand_name: "OTHER BRAND" }
    ]
  },
  brandRegistry: buildBrandRegistry({
    brands: [
      { brand_code: "B00000SA", brand_name: "BONNAE" },
      { brand_code: "B-KOIN", brand_name: "KOIN SEOUL" },
      { brand_code: "B-OTHER", brand_name: "OTHER BRAND" }
    ]
  }),
  productRegistry: { entries: [] },
  reviewQueue: null,
  onlineCatalogRegistry: null
};

const operationalGroups = mergeOfflineBrandSales({
  brandSales: [{
    brand_code: "B00000SA",
    brand_name: "BONNAE",
    sales: { paidAmount: 0 }
  }, {
    brand_code: "B-KOIN",
    brand_name: "KOIN SEOUL",
    sales: { paidAmount: 0 }
  }, {
    brand_code: "B-OTHER",
    brand_name: "OTHER BRAND",
    sales: { paidAmount: 0 }
  }],
  offlineLines: [{
    date: "2026-07-01",
    documentNo: "1",
    productName: "[BONNAE : 본네] Lace-up corset top (Black)",
    brandGroup: "QQQ 퀵",
    quantity: 1,
    salesAmount: 189000,
    isOfflineRevenue: true
  }, {
    date: "2026-07-01",
    documentNo: "2",
    productName: "BONNAE / Pleated mini dress (Black)",
    brandGroup: "BON CO",
    quantity: 1,
    salesAmount: 165600,
    isOfflineRevenue: true
  }, {
    date: "2026-07-01",
    documentNo: "3",
    productName: "KOIN SEOUL x MEANTIME collaboration",
    brandGroup: "POP CO",
    quantity: 1,
    salesAmount: 100000,
    isOfflineRevenue: true
  }, {
    date: "2026-07-01",
    documentNo: "4",
    productName: "OTHER BRAND special item",
    brandGroup: "SUN CO",
    quantity: 1,
    salesAmount: 200000,
    isOfflineRevenue: true
  }, {
    date: "2026-07-01",
    documentNo: "5",
    productName: "Unknown item",
    brandGroup: "QQQ",
    quantity: 1,
    salesAmount: 300000,
    isOfflineRevenue: true
  }],
  since: "2026-07-01",
  until: "2026-07-31",
  identityContext: identityContext2
});

assert.equal(operationalGroups.find((brand) => brand.brand_code === "B00000SA").offlineSalesAmount, 354600, "대괄호/슬래시로 후보 추출 가능한 두 줄은 QQQ 퀵/BON CO가 아니라 BONNAE로 정확히 귀속");
assert.equal(operationalGroups.find((brand) => brand.brand_code === "B-KOIN").offlineSalesAmount, 0, "대괄호/슬래시 표기가 없는 완전일치 라인은 Unified Identity 기준 UNRESOLVED(Resolver F와의 차이, Report 6번 항목)");
assert.equal(operationalGroups.find((brand) => brand.brand_code === "B-OTHER").offlineSalesAmount, 0, "위와 동일한 이유로 UNRESOLVED");
assert.equal(operationalGroups.find((brand) => brand.brand_code === "UNASSIGNED").offlineSalesAmount, 600000, "완전일치 2건 + 브랜드 신호 없는 1건 = UNASSIGNED로 보존(임의 할당 없음)");
assert.equal(operationalGroups.some((brand) => ["QQQ", "QQQ 퀵", "BON CO", "SUN CO", "POP CO"].includes(brand.brand_code)), false, "운영 품목그룹은 브랜드 key로 생성하지 않음");
assert.equal(operationalGroups.reduce((total, brand) => total + brand.sales.paidAmount, 0), 954600, "귀속 결과가 달라져도 전체 매출 합계는 변하지 않음(Revenue Preservation)");

console.log("monthly brand sales tests passed");
