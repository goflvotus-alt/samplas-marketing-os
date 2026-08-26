// Inventory Operations MVP(2026-08-26) — buildInventoryOverview()의 신규 operations 집계와
// 신규 per-item 필드(retailValue/slowWatch/daysOfSupply)를 검증한다.
// Cost Hard Gate: purchasePrice 기반 margin/profit은 이번 배치에서 절대 구현하지 않았다 —
// 이 테스트 스위트에도 그런 필드는 존재하지 않는다(의도적으로 없음을 확인하는 테스트 포함).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInventoryOverview,
  buildOfflineSalesIndex
} from "../scripts/inventory-overview-lib.mjs";

function offlineSales(rows) {
  return buildOfflineSalesIndex([{ month: "2026-08", rows }]);
}

function saleLine({ productName, specification, date, quantity }) {
  return { productName, specification, date, quantity, isOfflineRevenue: true };
}

const emptyRegistry = { brands: [], aliases: [] };

test("coverage: known/unknown stock + selling SKU denominator는 총 SKU 수 기준", () => {
  const ecountRows = [
    { productCode: "A1", productName: "BRAND1 / P1", specification: "S", stockQuantity: 10, salesPrice: 1000 },
    { productCode: "A2", productName: "BRAND1 / P2", specification: "M", stockQuantity: null },
    { productCode: "A3", productName: "BRAND1 / P3", specification: "L", stockQuantity: 5, salesPrice: 2000 }
  ];
  const salesIndex = offlineSales([saleLine({ productName: "BRAND1 / P1", specification: "S", date: "2026-08-20", quantity: 2 })]);
  const { operations } = buildInventoryOverview({ ecountRows, brandRegistry: emptyRegistry, salesIndex, registryProdCds: new Set() });

  assert.equal(operations.coverage.totalSkuCount, 3);
  assert.equal(operations.coverage.knownStockSkuCount, 2, "재고 null인 A2는 known에서 제외");
  assert.equal(operations.coverage.knownStockPct, 2 / 3);
  assert.equal(operations.coverage.sellingSkuCount, 1, "30일 내 판매 있는 SKU는 P1 하나");
  assert.equal(operations.coverage.sellingSkuPct, 1 / 3, "분모는 전체 SKU 수(3)여야 한다");
  assert.equal(operations.coverage.salesWindowDays, 30);
});

test("slow watch: 재고 있고 30일 판매 0인 SKU만 포함, 판매 있으면 제외", () => {
  const ecountRows = [
    { productCode: "A1", productName: "BRAND1 / P1", specification: "S", stockQuantity: 4 }, // 판매 없음 → slow watch
    { productCode: "A2", productName: "BRAND1 / P2", specification: "M", stockQuantity: 3 }  // 판매 있음 → 제외
  ];
  const salesIndex = offlineSales([saleLine({ productName: "BRAND1 / P2", specification: "M", date: "2026-08-20", quantity: 1 })]);
  const { items, operations } = buildInventoryOverview({ ecountRows, brandRegistry: emptyRegistry, salesIndex, registryProdCds: new Set() });

  const p1 = items.find((i) => i.prodCd === "A1");
  const p2 = items.find((i) => i.prodCd === "A2");
  assert.equal(p1.slowWatch, true);
  assert.equal(p2.slowWatch, false);
  assert.equal(operations.slowWatch.skuCount, 1);
  assert.equal(operations.slowWatch.pctOfInStock, 0.5, "in_stock 2개 중 1개");
});

test("negative inventory: SKU count/절대 units/브랜드 rollup 정확히 집계", () => {
  const ecountRows = [
    { productCode: "A1", productName: "BRAND1 / P1", specification: "S", stockQuantity: -3 },
    { productCode: "A2", productName: "BRAND1 / P2", specification: "M", stockQuantity: -7 },
    { productCode: "A3", productName: "BRAND2 / P3", specification: "L", stockQuantity: 5 }
  ];
  const salesIndex = offlineSales([saleLine({ productName: "BRAND1 / P1", specification: "S", date: "2026-08-20", quantity: 1 })]);
  const { operations, brandRollup } = buildInventoryOverview({ ecountRows, brandRegistry: emptyRegistry, salesIndex, registryProdCds: new Set() });

  assert.equal(operations.negativeInventory.skuCount, 2);
  assert.equal(operations.negativeInventory.totalNegativeUnits, 10, "abs(-3)+abs(-7)");
  assert.equal(operations.negativeInventory.recentlySellingCount, 1, "P1은 음수이면서 최근 판매 있음");
  assert.equal(operations.negativeInventory.topByUnits[0].prodCd, "A2", "units 큰 순 정렬");

  const brand1 = brandRollup.find((b) => b.brandName === "BRAND1");
  assert.equal(brand1.negativeReviewCount, 2);
  assert.equal(brand1.negativeUnits, 10);
});

test("days of supply: 판매 이력 있을 때만 값, 없거나 재고 미수신이면 항상 null(Infinity 노출 금지)", () => {
  const ecountRows = [
    { productCode: "A1", productName: "BRAND1 / P1", specification: "S", stockQuantity: 30 }, // 판매 있음
    { productCode: "A2", productName: "BRAND1 / P2", specification: "M", stockQuantity: 10 }, // 판매 0
    { productCode: "A3", productName: "BRAND1 / P3", specification: "L", stockQuantity: null } // 재고 미수신
  ];
  const salesIndex = offlineSales([saleLine({ productName: "BRAND1 / P1", specification: "S", date: "2026-08-20", quantity: 3 })]);
  const { items } = buildInventoryOverview({ ecountRows, brandRegistry: emptyRegistry, salesIndex, registryProdCds: new Set() });

  const p1 = items.find((i) => i.prodCd === "A1");
  const p2 = items.find((i) => i.prodCd === "A2");
  const p3 = items.find((i) => i.prodCd === "A3");
  assert.equal(p1.daysOfSupply, 30 / (3 / 30), "30 / (일평균판매 0.1) = 300일");
  assert.equal(p2.daysOfSupply, null, "판매 0이면 N/A여야 하고 Infinity가 아니어야 한다");
  assert.equal(p3.daysOfSupply, null, "재고 미수신이면 N/A");
});

test("retail inventory value: 양수 재고만 포함, 음수/가격없음/재고미수신은 제외", () => {
  const ecountRows = [
    { productCode: "A1", productName: "BRAND1 / P1", specification: "S", stockQuantity: 4, salesPrice: 10000 },
    { productCode: "A2", productName: "BRAND1 / P2", specification: "M", stockQuantity: -5, salesPrice: 10000 }, // 음수 제외
    { productCode: "A3", productName: "BRAND1 / P3", specification: "L", stockQuantity: 2 }, // 가격 없음
    { productCode: "A4", productName: "BRAND1 / P4", specification: "XL", stockQuantity: null, salesPrice: 5000 } // 재고 미수신
  ];
  const salesIndex = offlineSales([]);
  const { items, operations } = buildInventoryOverview({ ecountRows, brandRegistry: emptyRegistry, salesIndex, registryProdCds: new Set() });

  const p1 = items.find((i) => i.prodCd === "A1");
  const p2 = items.find((i) => i.prodCd === "A2");
  const p3 = items.find((i) => i.prodCd === "A3");
  assert.equal(p1.retailValue, 40000);
  assert.equal(p2.retailValue, null, "음수 재고는 value에 포함하지 않는다");
  assert.equal(p3.retailValue, null, "가격 없으면 N/A");

  assert.equal(operations.inventoryValue.label, "retail_inventory_value");
  assert.equal(operations.inventoryValue.totalRetailValue, 40000, "P1만 포함되어야 한다");
  assert.equal(operations.inventoryValue.valuedSkuCount, 1);
  assert.equal(operations.inventoryValue.missingPriceInStockSkuCount, 1, "P3(재고 있고 가격 없음)만 해당");
  assert.equal(operations.inventoryValue.negativeStockExcludedUnits, 5);
});

test("Cost Hard Gate: margin/profit/cost 관련 필드가 절대 존재하지 않는다", () => {
  const ecountRows = [
    { productCode: "A1", productName: "BRAND1 / P1", specification: "S", stockQuantity: 4, purchasePrice: 3000, salesPrice: 10000 }
  ];
  const { items, operations } = buildInventoryOverview({ ecountRows, brandRegistry: emptyRegistry, salesIndex: offlineSales([]), registryProdCds: new Set() });
  const forbidden = ["margin", "profit", "grossProfit", "profitPercent", "stockProfitValue", "costValue"];
  for (const key of forbidden) {
    assert.equal(Object.hasOwn(items[0], key), false, `items에 ${key} 필드가 있으면 안 된다`);
    assert.equal(Object.hasOwn(operations.inventoryValue, key), false, `operations.inventoryValue에 ${key} 필드가 있으면 안 된다`);
  }
  // purchasePrice 자체는 기존 필드로 계속 노출되지만(원본 데이터 보존), 그것으로부터
  // margin을 계산한 새 필드는 만들지 않는다.
  assert.equal(items[0].purchasePrice, 3000);
});

console.log("inventory operations MVP tests passed");
