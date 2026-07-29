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

console.log("monthly brand sales tests passed");
