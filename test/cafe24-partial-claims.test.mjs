import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cafe24OrderAmount, isCafe24CanceledOrRefunded, isCafe24CanceledItem } from "../scripts/cafe24-order-amount.mjs";
import { allocateCanonicalPaidSalesForOrder } from "../server.mjs";

// Real Production orders (2026-01..10, whitelisted non-personal fields, synthetic ids): the 19 partially
// claimed orders Cafe24 marks canceled "M" with order-level claim dates, plus controls.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/cafe24-partial-claims-2026.json", import.meta.url), "utf8"));
const byKind = (kind) => fixture.orders.filter((row) => row.kind === kind).map((row) => row.order);
const sample = fixture.orders.find((row) => row.order.order_id === "SAMPLE-20260825-048").order;
// What the pre-fix rule did: any order-level claim date excluded the whole order.
const before = (order) => (order.cancel_date || order.return_confirmed_date || order.refund_date || String(order.canceled).toUpperCase() === "T" ? 0 : cafe24OrderAmount(order));

test("item level: C40 취소완료 and R40 반품완료 are claimed, N40 is kept", () => {
  assert.equal(isCafe24CanceledItem({ order_status: "C40", status_text: "취소완료" }), true);
  assert.equal(isCafe24CanceledItem({ order_status: "R40", status_text: "반품완료" }), true);
  assert.equal(isCafe24CanceledItem({ order_status: "N40", status_text: "배송완료" }), false);
});

test("20260825…048: canceled M with claim dates counts the remaining 238,000; only the two N40 items carry it", () => {
  assert.equal(sample.canceled, "M");
  assert.equal(sample.items.length, 6);
  assert.deepEqual(sample.items.map((i) => i.order_status).sort(), ["N40", "N40", "R40", "R40", "R40", "R40"]);
  assert.equal(Number(sample.initial_order_amount.payment_amount), 840200);
  assert.ok(sample.cancel_date && sample.return_confirmed_date, "Cafe24 stamps order-level claim dates on a partial order");
  assert.equal(isCafe24CanceledOrRefunded(sample), false);
  assert.equal(cafe24OrderAmount(sample), 238000);
  const allocation = allocateCanonicalPaidSalesForOrder(sample);
  assert.deepEqual(allocation.activeItems.map((row) => row.item.order_status), ["N40", "N40"]);
  const allocated = allocation.activeItems.reduce((sum, row) => sum + row.paidAmount, 0);
  assert.equal(allocated + allocation.shippingAmount, 238000, "products + shipping reconcile to the order paid amount");
  assert.equal(allocation.shippingAmount, 8000);
});

test("full claims stay excluded: canceled T (even with a payment left) and an all-claimed order", () => {
  for (const order of [...byKind("T_ANOMALY"), ...byKind("T_FULL")]) {
    assert.equal(isCafe24CanceledOrRefunded(order), true, order.order_id);
    assert.equal(cafe24OrderAmount(order), 0, order.order_id);
  }
  assert.ok(Number(byKind("T_ANOMALY")[0].actual_order_amount.payment_amount) > 0, "the anomaly still has a payment Cafe24 calls cancelled");
});

test("unchanged orders: M without claim dates and a normal order keep their amount", () => {
  for (const order of [...byKind("M_NODATE"), ...byKind("NORMAL")]) {
    assert.equal(isCafe24CanceledOrRefunded(order), false, order.order_id);
    assert.equal(cafe24OrderAmount(order), before(order), order.order_id);
  }
  // Returned items of an already-counted partial order are no longer allocated at item level.
  for (const order of byKind("M_NODATE")) {
    assert.equal(allocateCanonicalPaidSalesForOrder(order).activeItems.some((row) => ["C40", "R40"].includes(row.item.order_status)), false);
  }
});

test("2026 impact: the 19 partial orders add exactly the audited monthly deltas (+12,436,840)", () => {
  const partial = fixture.orders.filter((row) => row.kind === "M_DATE");
  assert.equal(partial.length, 19);
  const delta = {};
  for (const { month, order } of partial) {
    assert.equal(before(order), 0, `${order.order_id} was dropped before the fix`);
    assert.equal(cafe24OrderAmount(order), Math.round(Number(order.actual_order_amount.payment_amount)), `${order.order_id} now counts Cafe24's remaining payment`);
    delta[month] = (delta[month] || 0) + cafe24OrderAmount(order) - before(order);
    assert.equal(allocateCanonicalPaidSalesForOrder(order).activeItems.some((row) => ["C40", "R40"].includes(row.item.order_status)), false, `${order.order_id} claimed items stay out of product sales`);
  }
  for (const [month, expected] of Object.entries(fixture.expectedMonthlyDelta)) assert.equal(delta[month] || 0, expected, month);
  assert.equal(Object.values(delta).reduce((a, b) => a + b, 0), 12436840);
});
