// SAMPLAS Inventory Snapshot (Phase 3A-2) — scripts/save-inventory-snapshot.mjs 테스트.
// 스냅샷 항목 빌드(순수 함수)만 검증한다. 파일 쓰기/CLI 동작은 여기서 다루지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSnapshotItem, classifyProductType } from "../scripts/save-inventory-snapshot.mjs";

test("classifyProductType: QQQ/일반/관리코드 구분", () => {
  assert.equal(classifyProductType({ productCode: "QQQ0001", productName: "BRAND / X" }), "qqq");
  assert.equal(classifyProductType({ productCode: "ANO261AC00100", productName: "ANOTHERUSE / beanie" }), "general");
  assert.equal(classifyProductType({ productCode: "00000", productName: "할인" }), "admin_code");
});

test("buildSnapshotItem: stockQuantity/locations/productType만 남기고 원본 재고 해석은 하지 않음", () => {
  const item = buildSnapshotItem({ productCode: "QQQ0002", productName: "BRAND / Y", stockQuantity: -3 });
  assert.equal(item.productCode, "QQQ0002");
  assert.equal(item.stockQuantity, -3);
  assert.equal(item.productType, "qqq");
  assert.deepEqual(item.locations, { STORE_1: null, OFFSITE: null, UNKNOWN: null });
  assert.equal(Object.prototype.hasOwnProperty.call(item, "status"), false); // 상태 해석은 스냅샷에 포함하지 않음
});

test("buildSnapshotItem: stockQuantity null은 0으로 바뀌지 않음", () => {
  const item = buildSnapshotItem({ productCode: "GEN1", productName: "BRAND / Z", stockQuantity: null });
  assert.equal(item.stockQuantity, null);
  assert.notEqual(item.stockQuantity, 0);
});
