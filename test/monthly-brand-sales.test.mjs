import assert from "node:assert/strict";
import { mergeOfflineBrandSales } from "../scripts/monthly-brand-sales.mjs";

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

const merged = mergeOfflineBrandSales({
  brandSales: online,
  productSales: [{
    brand_code: "B00000HD",
    productName: "[SUNDAYOFFCLUB : 선데이오프클럽] Product"
  }],
  onlinePaidAmount: 100000,
  offlineLines: offline,
  since: "2026-06-01",
  until: "2026-06-30"
});
const sunday = merged.find((brand) => brand.brand_code === "B00000HD");
const unassigned = merged.find((brand) => brand.brand_code === "UNASSIGNED");

assert.equal(sunday.offlineSalesAmount, 21981400, "SUNDAY OFF CLUB ECOUNT 매출을 기존 canonical 브랜드에 합산");
assert.equal(sunday.sales.paidAmount, 22076400, "온라인과 오프라인 매출 합산");
assert.equal(sunday.quantitySold, 3, "온라인과 오프라인 수량 합산");
assert.equal(sunday.orderCount, 2, "오프라인 전표를 브랜드 주문수에 한 번만 합산");
assert.equal(unassigned.sales.paidAmount, 6000, "온라인 미배분액과 미매칭 오프라인을 UNASSIGNED에 보존");
assert.equal(
  merged.reduce((total, brand) => total + brand.sales.paidAmount, 0),
  22082400,
  "브랜드 전체 합계가 온라인 총매출과 오프라인 총매출 합계와 일치"
);
assert.equal(online[0].sales.paidAmount, 95000, "입력 데이터는 변경하지 않음");

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
  productSales: [{
    brand_code: "B-KOIN",
    productName: "KOIN SEOUL x MEANTIME collaboration"
  }, {
    brand_code: "B00000SA",
    productName: "[BONNAE : 본네] Lace-up corset top (Black)"
  }, {
    brand_code: "B-OTHER",
    productName: "OTHER BRAND special item"
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
  until: "2026-07-31"
});

assert.equal(operationalGroups.find((brand) => brand.brand_code === "B00000SA").offlineSalesAmount, 354600, "QQQ 퀵과 BON CO가 아니라 상품명 기준으로 BONNAE에 합산");
assert.equal(operationalGroups.find((brand) => brand.brand_code === "B-KOIN").offlineSalesAmount, 100000, "POP CO 대신 정확한 상품 매핑 사용");
assert.equal(operationalGroups.find((brand) => brand.brand_code === "B-OTHER").offlineSalesAmount, 200000, "SUN CO의 서로 다른 상품은 각 상품 매핑 유지");
assert.equal(operationalGroups.find((brand) => brand.brand_code === "UNASSIGNED").offlineSalesAmount, 300000, "브랜드 신호가 없는 QQQ 행은 임의 할당하지 않음");
assert.equal(operationalGroups.some((brand) => ["QQQ", "QQQ 퀵", "BON CO", "SUN CO", "POP CO"].includes(brand.brand_code)), false, "운영 품목그룹은 브랜드 key로 생성하지 않음");
assert.equal(operationalGroups.reduce((total, brand) => total + brand.sales.paidAmount, 0), 954600, "모든 행을 중복 없이 정확히 한 번 합산");

console.log("monthly brand sales tests passed");
