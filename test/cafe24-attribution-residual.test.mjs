import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cafe24OrderAmount } from "../scripts/cafe24-order-amount.mjs";
import { allocateCanonicalPaidSalesForOrder } from "../server.mjs";

const item = (price, discount = 0, extra = {}) => ({ order_status: "N40", product_no: 1, quantity: 1, product_price: String(price), additional_discount_price: String(discount), ...extra });
const order = (paid, items, shipping = 0) => ({ canceled: "F", actual_order_amount: { payment_amount: String(paid), shipping_fee: String(shipping) }, items });
const paid = (allocation) => allocation.activeItems.map((row) => row.paidAmount);
const residual = (allocation) => allocation.orderPaidAmount - allocation.shippingAmount - allocation.allocatedProductPaidAmount;

test("direct net > 0: proportional split and rounding residue to the largest item are unchanged", () => {
  assert.deepEqual(paid(allocateCanonicalPaidSalesForOrder(order(100, [item(100), item(100), item(100)]))), [34, 33, 33]);
  assert.deepEqual(paid(allocateCanonicalPaidSalesForOrder(order(23000, [item(10000), item(20000, 5000)], 3000))), [8000, 12000]);
});

test("direct net sums to 0 (or below, clamped) with money left: surviving gross weights", () => {
  const zero = allocateCanonicalPaidSalesForOrder(order(8000, [item(30000, 30000), item(10000, 10000)]));
  assert.deepEqual(paid(zero), [6000, 2000]);
  assert.deepEqual([zero.difference, zero.matched], [0, true]);
  const over = allocateCanonicalPaidSalesForOrder(order(4000, [item(30000, 90000), item(10000, 20000)]));
  assert.deepEqual(paid(over), [3000, 1000]);
});

test("gross sums to 0: the last surviving item takes the whole allocatable amount", () => {
  assert.deepEqual(paid(allocateCanonicalPaidSalesForOrder(order(5000, [item(0), item(0)]))), [0, 5000]);
});

test("claimed C40/R40 items never receive money, also in the fallback", () => {
  const allocation = allocateCanonicalPaidSalesForOrder({ ...order(9600, [item(48000, 76800), item(48000, 0, { order_status: "R40" }), item(68000, 0, { order_status: "C40" })]), canceled: "M" });
  assert.deepEqual(allocation.activeItems.map((row) => [row.item.order_status, row.paidAmount]), [["N40", 9600]]);
});

test("difference is computed on every path, never asserted", () => {
  const nothing = allocateCanonicalPaidSalesForOrder(order(3000, [item(10000, 10000)], 3000));
  assert.deepEqual([paid(nothing), nothing.difference, nothing.matched], [[0], 0, true]);
  const noItems = allocateCanonicalPaidSalesForOrder(order(5000, []));
  assert.deepEqual([noItems.difference, noItems.matched], [5000, false]);
  // Invariants over many small shapes: exact sum, no negative item, difference = allocatable - allocated.
  let seed = 7;
  const next = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
  for (let run = 0; run < 2000; run += 1) {
    const items = Array.from({ length: 1 + next(5) }, () => item(next(4) * 1000, next(3) * 1000));
    const allocation = allocateCanonicalPaidSalesForOrder(order(next(5000), items, next(2) * 1000));
    assert.equal(residual(allocation), 0);
    assert.equal(allocation.difference, residual(allocation));
    assert.ok(allocation.activeItems.every((row) => row.paidAmount >= 0));
  }
});

test("April 2026 Production orders: 16,800 + 9,600 residual is now attributed; order paid unchanged", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/cafe24-attribution-residual-2026-04.json", import.meta.url), "utf8"));
  const [o088, o041] = fixture.orders;
  const a088 = allocateCanonicalPaidSalesForOrder(o088);
  assert.deepEqual([a088.orderPaidAmount, a088.shippingAmount, paid(a088), a088.difference], [19800, 3000, [16800], 0]);
  const a041 = allocateCanonicalPaidSalesForOrder(o041);
  assert.deepEqual(a041.activeItems.map((row) => [row.item.order_status, row.paidAmount]), [["N40", 9600]], "R40 gets nothing");
  assert.deepEqual([a041.orderPaidAmount, a041.difference], [9600, 0]);
  // Before the fix both allocated 0 while reporting difference 0: 26,400 lost from product/brand sales.
  const products = a088.allocatedProductPaidAmount + a041.allocatedProductPaidAmount;
  assert.equal(products - 0, 26400, "product/brand attribution +26,400");
  assert.equal(residual(a088) + residual(a041), 0, "residual 26,400 -> 0");
  for (const o of fixture.orders) assert.equal(allocateCanonicalPaidSalesForOrder(o).orderPaidAmount, cafe24OrderAmount(o), "canonical order amount is untouched");
});

test("audited 2026 partial-claim orders still reconcile exactly", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/cafe24-partial-claims-2026.json", import.meta.url), "utf8"));
  for (const { order: o } of fixture.orders) {
    const allocation = allocateCanonicalPaidSalesForOrder(o);
    if (!allocation.activeItems.length) continue;
    assert.equal(allocation.difference, 0, o.order_id);
    assert.equal(residual(allocation), 0, o.order_id);
  }
});
