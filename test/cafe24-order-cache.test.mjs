import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCanonicalCafe24OrderCache } from "../scripts/cafe24-order-cache.mjs";
import {
  cafe24ItemAmount,
  cafe24ItemQuantity,
  cafe24OrderAmount,
  cafe24OrderItems,
  isCafe24CanceledItem
} from "../scripts/cafe24-order-amount.mjs";

async function withCacheFiles(files, run) {
  const dir = await mkdtemp(join(tmpdir(), "samplas-cafe24-cache-"));
  try {
    for (const [name, orders] of Object.entries(files)) {
      await writeFile(join(dir, name), JSON.stringify({ orders }));
    }
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const order = (id, date, amount = 100, extra = {}) => ({
  order_id: id,
  order_date: `${date}T12:00:00+09:00`,
  payment_amount: amount,
  items: [{ product_name: id, quantity: 1, payment_amount: amount }],
  ...extra
});

test("A: exact single cache keeps its orders", () => withCacheFiles({
  "cafe24-orders-2026-07-01_2026-07-28.json": [order("A", "2026-07-01")]
}, async (dir) => {
  const result = await loadCanonicalCafe24OrderCache({ workDir: dir, since: "2026-07-01", until: "2026-07-28" });
  assert.deepEqual(result.orders.map((item) => item.order_id), ["A"]);
}));

test("B/C: overlapping caches merge and deduplicate orders", () => withCacheFiles({
  "cafe24-orders-2026-07-01_2026-07-15.json": [order("A", "2026-07-02"), order("B", "2026-07-10")],
  "cafe24-proxy-orders-2026-07-10_2026-07-28.json": [order("B", "2026-07-10"), order("C", "2026-07-20")]
}, async (dir) => {
  const result = await loadCanonicalCafe24OrderCache({ workDir: dir, since: "2026-07-01", until: "2026-07-28" });
  assert.deepEqual(result.orders.map((item) => item.order_id), ["A", "B", "C"]);
}));

test("D: the newer cache record wins for the same order", () => withCacheFiles({
  "cafe24-orders-2026-07-01_2026-07-15.json": [order("A", "2026-07-02", 100)],
  "cafe24-orders-2026-07-01_2026-07-28.json": [order("A", "2026-07-02", 80, { canceled: "T" })]
}, async (dir) => {
  const result = await loadCanonicalCafe24OrderCache({ workDir: dir, since: "2026-07-01", until: "2026-07-28" });
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].payment_amount, 80);
  assert.equal(result.orders[0].canceled, "T");
}));

test("E: canonical amount and quantity exclude only canceled items", () => withCacheFiles({
  "cafe24-orders-2026-07-01_2026-07-28.json": [{
    ...order("A", "2026-07-02", 200),
    items: [
      { product_name: "keep", quantity: 2, actual_payment_amount: 100, status_code: "N1" },
      { product_name: "cancel", quantity: 1, actual_payment_amount: 100, status_code: "C2" }
    ]
  }]
}, async (dir) => {
  const { orders } = await loadCanonicalCafe24OrderCache({ workDir: dir, since: "2026-07-01", until: "2026-07-28" });
  const activeItems = cafe24OrderItems(orders[0]).filter((item) => !isCafe24CanceledItem(item));
  assert.equal(cafe24OrderAmount(orders[0]), 200);
  assert.equal(activeItems.reduce((sum, item) => sum + cafe24ItemAmount(item, cafe24ItemQuantity(item)), 0), 200);
  assert.equal(activeItems.reduce((sum, item) => sum + cafe24ItemQuantity(item), 0), 2);
}));

test("F: repeated loads are deterministic", () => withCacheFiles({
  "cafe24-orders-2026-07-01_2026-07-15.json": [order("B", "2026-07-10", 200)],
  "cafe24-orders-2026-07-01_2026-07-28.json": [order("A", "2026-07-02", 100), order("B", "2026-07-10", 180)]
}, async (dir) => {
  const load = async () => {
    const { orders } = await loadCanonicalCafe24OrderCache({ workDir: dir, since: "2026-07-01", until: "2026-07-28" });
    return {
      amount: orders.reduce((sum, item) => sum + cafe24OrderAmount(item), 0),
      orderCount: orders.length,
      quantity: orders.reduce((sum, item) => sum + cafe24OrderItems(item).filter((product) => !isCafe24CanceledItem(product)).reduce((value, product) => value + cafe24ItemQuantity(product), 0), 0),
      ids: orders.map((item) => item.order_id)
    };
  };
  assert.deepEqual(await load(), await load());
}));

test("G: orders outside the requested range are excluded", () => withCacheFiles({
  "cafe24-orders-2026-06-01_2026-07-28.json": [
    order("JUNE", "2026-06-30"),
    order("JULY", "2026-07-01"),
    order("AUGUST", "2026-08-01")
  ]
}, async (dir) => {
  const result = await loadCanonicalCafe24OrderCache({ workDir: dir, since: "2026-07-01", until: "2026-07-28" });
  assert.deepEqual(result.orders.map((item) => item.order_id), ["JULY"]);
}));
