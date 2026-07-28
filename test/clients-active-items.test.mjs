import assert from "node:assert/strict";
import {
  assignCafe24OrdersToClientGroups,
  normalizeCafe24CsvOrder,
  normalizeCafe24ProxyOrder
} from "../intelligence-service.mjs";

function order(items, paymentAmount = 158000) {
  return {
    order_id: "20260728-0000065",
    order_date: "2026-07-28T12:00:00+09:00",
    actual_order_amount: { payment_amount: paymentAmount },
    items
  };
}

const canceled = { status_code: "C2", status_text: "취소완료", quantity: 1 };
const normal = { status_code: "N1", status_text: "배송완료", quantity: 1 };

assert.equal(normalizeCafe24ProxyOrder(order([canceled])), null, "활성 품목 없는 API 주문 제외");
assert.equal(normalizeCafe24CsvOrder(order([canceled])), null, "활성 품목 없는 CSV 주문 제외");

assert.deepEqual(
  normalizeCafe24ProxyOrder(order([canceled, normal], 100000)),
  {
    orderId: "20260728-0000065",
    orderDate: "2026-07-28",
    monthKey: "2026-07",
    paidAmount: 100000,
    quantity: 1,
    isPersonalPayment: false,
    personalPaymentProductName: "",
    pointsUsedAmount: null,
    shippingAmount: 0,
    rawCustomerText: null
  },
  "부분취소 주문은 정상 품목만 수량에 반영"
);

assert.equal(normalizeCafe24ProxyOrder(order([normal]))?.quantity, 1, "정상 주문 유지");
assert.equal(
  normalizeCafe24ProxyOrder(order([{ status_code: "C3", status_text: "반품신청", quantity: 2 }]))?.quantity,
  2,
  "반품신청 주문 유지"
);
assert.equal(
  normalizeCafe24ProxyOrder(order([{ status_code: "C3", status_text: "반품완료", quantity: 1 }])),
  null,
  "반품완료 주문 제외"
);
assert.equal(
  normalizeCafe24ProxyOrder(order([
    { status_code: "E1", status_text: "교환신청", quantity: 1 },
    { status_code: "E1", status_text: "교환완료", quantity: 2 }
  ]))?.quantity,
  3,
  "교환신청·완료 주문 유지"
);

function group(type, matchKey) {
  return { classification: { type }, matchKey, orders: new Map() };
}

const stylist = group("stylist", "김영만");
const press = group("samplas_press", "김영만");
const customer = group("customer", "일반고객");
const duplicateOrder = { orderId: "20260124-0000056", matchKey: "김영만", paidAmount: 364800, quantity: 1 };
const normalOrder = { orderId: "normal-order", matchKey: "일반고객", paidAmount: 100000, quantity: 1 };
const consumed = assignCafe24OrdersToClientGroups(
  new Map([["press", press], ["stylist", stylist], ["customer", customer]]),
  [duplicateOrder, normalOrder]
);

assert.deepEqual([...stylist.orders.keys()], ["20260124-0000056"], "Stylist가 Press보다 우선");
assert.equal(press.orders.size, 0, "동일 주문은 Press에 중복 반영하지 않음");
assert.deepEqual([...customer.orders.keys()], ["normal-order"], "일반 고객 주문은 기존 그룹 유지");
assert.deepEqual([...consumed].sort(), ["20260124-0000056", "normal-order"], "고유 order_id 모집합 유지");
