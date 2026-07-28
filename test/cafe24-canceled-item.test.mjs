import assert from "node:assert/strict";
import {
  cafe24ItemAmount,
  cafe24ItemQuantity,
  cafe24OrderItems,
  isCafe24CanceledItem
} from "../scripts/cafe24-order-amount.mjs";

const cases = [
  {
    name: "C1 입금전취소는 제외",
    item: {
      status_code: "C1",
      status_text: "입금전취소"
    },
    expected: true
  },
  {
    name: "C2 취소신청은 제외",
    item: {
      status_code: "C2",
      status_text: "취소신청"
    },
    expected: true
  },
  {
    name: "C2 취소처리중은 제외",
    item: {
      status_code: "C2",
      status_text: "취소처리중"
    },
    expected: true
  },
  {
    name: "C2 취소완료는 제외",
    item: {
      status_code: "C2",
      status_text: "취소완료"
    },
    expected: true
  },
  {
    name: "CANCEL 상태는 제외",
    item: {
      status_code: "CANCEL"
    },
    expected: true
  },
  {
    name: "취소완료 문구는 제외",
    item: {
      status_text: "취소완료"
    },
    expected: true
  },
  {
    name: "영문 cancel 문구는 제외",
    item: {
      status_text: "Order cancelled"
    },
    expected: true
  },
  {
    name: "C3 반품신청은 판매 유지",
    item: {
      status_code: "C3",
      status_text: "반품신청"
    },
    expected: false
  },
  {
    name: "C3 반품완료는 제외",
    item: {
      status_code: "C3",
      status_text: "반품완료"
    },
    expected: true
  },
  {
    name: "E1 교환신청은 판매 유지",
    item: {
      status_code: "E1",
      status_text: "교환신청"
    },
    expected: false
  },
  {
    name: "E1 교환완료는 판매 유지",
    item: {
      status_code: "E1",
      status_text: "교환완료"
    },
    expected: false
  },
  {
    name: "N1 배송완료는 판매 유지",
    item: {
      status_code: "N1",
      status_text: "배송완료"
    },
    expected: false
  },
  {
    name: "N2 정상 배송 품목은 판매 유지",
    item: {
      status_code: "N2",
      status_text: "배송중"
    },
    expected: false
  }
];

for (const testCase of cases) {
  assert.equal(
    isCafe24CanceledItem(testCase.item),
    testCase.expected,
    testCase.name
  );
}

function activeItemTotals(order) {
  const items = cafe24OrderItems(order).filter((item) => !isCafe24CanceledItem(item));
  return {
    itemCount: items.length,
    quantity: items.reduce((total, item) => total + cafe24ItemQuantity(item), 0),
    amount: items.reduce((total, item) => total + cafe24ItemAmount(item, cafe24ItemQuantity(item)), 0)
  };
}

const normalItem = {
  product_name: "정상 품목",
  status_code: "N1",
  quantity: 1,
  actual_payment_amount: 10000
};

assert.deepEqual(
  activeItemTotals({
    items: [
      normalItem,
      { product_name: "취소 품목", status_code: "C2", status_text: "취소신청", quantity: 2, actual_payment_amount: 20000 }
    ]
  }),
  { itemCount: 1, quantity: 1, amount: 10000 },
  "부분취소 주문은 정상 품목과 주문을 유지하고 C2 품목만 제외"
);

assert.deepEqual(
  activeItemTotals({
    items: [
      normalItem,
      { product_name: "반품 완료 품목", status_code: "C3", status_text: "반품완료", quantity: 2, actual_payment_amount: 20000 }
    ]
  }),
  { itemCount: 1, quantity: 1, amount: 10000 },
  "반품완료 품목만 제외"
);

assert.deepEqual(
  activeItemTotals({
    items: [
      { product_name: "반품 신청 품목", status_code: "C3", status_text: "반품신청", quantity: 2, actual_payment_amount: 20000 }
    ]
  }),
  { itemCount: 1, quantity: 2, amount: 40000 },
  "반품신청 품목은 수량과 매출 유지"
);

assert.deepEqual(
  activeItemTotals({
    items: [
      { product_name: "교환 신청 품목", status_code: "E1", status_text: "교환신청", quantity: 1, actual_payment_amount: 10000 },
      { product_name: "교환 완료 품목", status_code: "E1", status_text: "교환완료", quantity: 2, actual_payment_amount: 20000 }
    ]
  }),
  { itemCount: 2, quantity: 3, amount: 50000 },
  "교환 품목은 수량과 매출 유지"
);

console.log("cafe24 canceled item tests passed");
