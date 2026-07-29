import assert from "node:assert/strict";
import { cafe24OrderAmount } from "../scripts/cafe24-order-amount.mjs";

function order(overrides = {}) {
  return {
    payment_method_name: ["선불금"],
    actual_order_amount: {
      payment_amount: "0.00",
      order_price_amount: "98000.00"
    },
    items: [{
      status_code: "N1",
      quantity: 1,
      product_price: "98000.00"
    }],
    ...overrides
  };
}

assert.equal(cafe24OrderAmount(order()), 98000, "선불금 할인 없음");

assert.equal(cafe24OrderAmount(order({
  actual_order_amount: {
    payment_amount: "0.00",
    order_price_amount: "228000.00"
  },
  items: [{
    status_code: "N1",
    quantity: 1,
    product_price: "228000.00",
    additional_discount_price: "171000.00"
  }]
})), 57000, "선불금 품목 할인 반영");

assert.equal(cafe24OrderAmount(order({
  payment_method_name: ["적립금"],
  actual_order_amount: {
    payment_amount: "0.00",
    order_price_amount: "179000.00",
    membership_discount_amount: "26000.00",
    points_spent_amount: "153000.00"
  },
  initial_order_amount: {
    order_price_amount: "179000.00",
    membership_discount_amount: "26000.00",
    points_spent_amount: "153000.00"
  },
  items: [{
    status_code: "N1",
    quantity: 1,
    product_price: "179000.00"
  }]
})), 153000, "적립금은 차감하지 않고 중복 주문 할인은 한 번만 반영");

assert.equal(cafe24OrderAmount(order({
  actual_order_amount: {
    payment_amount: "0.00",
    order_price_amount: "50000.00",
    membership_discount_amount: "60000.00"
  }
})), 0, "fallback은 음수가 되지 않음");

assert.equal(cafe24OrderAmount(order({
  payment_method_name: ["카드"],
  actual_order_amount: {
    payment_amount: "75000.00",
    order_price_amount: "98000.00",
    membership_discount_amount: "23000.00"
  }
})), 75000, "일반 결제 계산은 변경하지 않음");

console.log("cafe24 order amount tests passed");
