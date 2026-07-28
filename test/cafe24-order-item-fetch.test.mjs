import assert from "node:assert/strict";
import test from "node:test";
import {
  attachCafe24OrderItemsWithRetry,
  fetchCafe24OrderItemsWithRetry
} from "../scripts/cafe24-order-item-fetch.mjs";
import {
  cafe24OrderAmount,
  cafe24OrderItems,
  isCafe24CanceledItem
} from "../scripts/cafe24-order-amount.mjs";

const recoveredItem = {
  product_no: 13744,
  product_code: "P0000UIQ",
  supplier_name: "BONNAE",
  quantity: 1,
  product_price: 100000,
  status_code: "N1"
};

test("first successful item fetch is not retried", async () => {
  let calls = 0;
  const order = { itemFetchError: "old failure" };
  const error = await attachCafe24OrderItemsWithRetry(order, async () => {
    calls += 1;
    return [recoveredItem];
  }, { wait: async () => assert.fail("successful fetch must not wait") });
  assert.equal(calls, 1);
  assert.equal(error, null);
  assert.deepEqual(order.items, [recoveredItem]);
  assert.equal("itemFetchError" in order, false);
});

test("temporary item fetch failure recovers on one retry", async () => {
  let calls = 0;
  const waits = [];
  const order = {};
  const error = await attachCafe24OrderItemsWithRetry(order, async () => {
    calls += 1;
    if (calls === 1) throw new Error("<html><body>접속이 지연되고 있습니다</body></html>");
    return [recoveredItem];
  }, { wait: async (delayMs) => waits.push(delayMs) });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1200]);
  assert.equal(error, null);
  assert.deepEqual(order.items, [recoveredItem]);
  assert.equal("itemFetchError" in order, false);
});

test("two item fetch failures stop after the retry and compact the error", async () => {
  let calls = 0;
  const order = {};
  const error = await attachCafe24OrderItemsWithRetry(order, async () => {
    calls += 1;
    throw new Error("<html><head><style>large css</style></head><body>접속이 지연되고 있습니다</body></html>");
  }, { wait: async () => {} });
  assert.equal(calls, 2);
  assert.deepEqual(order.items, []);
  assert.equal(order.itemFetchError, "Cafe24 order item fetch failed after retry: 접속이 지연되고 있습니다");
  assert.equal(error.message, order.itemFetchError);
});

test("recovered items remain valid Brand Sales allocation input", async () => {
  const order = {
    order_id: "20260706-0000056",
    order_date: "2026-07-06T12:00:00+09:00",
    payment_amount: 100000,
    items: await fetchCafe24OrderItemsWithRetry(async () => [recoveredItem], { wait: async () => {} })
  };
  const activeItems = cafe24OrderItems(order).filter((item) => !isCafe24CanceledItem(item));
  assert.equal(activeItems.length, 1);
  assert.equal(activeItems[0].product_no, 13744);
  assert.equal(cafe24OrderAmount(order), 100000);
});
