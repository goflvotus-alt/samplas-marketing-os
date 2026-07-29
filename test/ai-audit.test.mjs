import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAiAuditHealth,
  buildAiAuditOrder,
  buildAiAuditRevenueReconciliation,
  isAiAuditAuthorized,
  resolveAiAuditSecret,
  validateAiAuditRange
} from "../scripts/ai-audit.mjs";
import {
  cafe24GrossOrderAmount,
  cafe24OrderAmount,
  cafe24PointsUsedAmount,
  cafe24ShippingFee,
  isCafe24CanceledItem,
  isCafe24CanceledOrRefunded
} from "../scripts/cafe24-order-amount.mjs";

const activeItem = {
  product_no: 13744,
  product_code: "P0000UIQ",
  variant_code: "P0000UIQ000A",
  quantity: 1,
  product_price: 1000,
  status_code: "N1"
};

const privateOrder = {
  order_id: "20260729-0000001",
  order_date: "2026-07-29T10:00:00+09:00",
  payment_date: "2026-07-29T10:01:00+09:00",
  order_status: "N20",
  payment_amount: 900,
  order_price_amount: 1000,
  points_spent_amount: 50,
  shipping_fee: 0,
  billing_name: "비공개",
  receiver_name: "비공개",
  member_email: "private@example.com",
  phone: "010-0000-0000",
  address1: "비공개 주소",
  items: [activeItem]
};

function allocateOrder(order) {
  const activeItems = order.items.filter((item) => !isCafe24CanceledItem(item)).map((item) => ({
    item,
    grossAmount: Number(item.product_price) * Number(item.quantity),
    paidAmount: cafe24OrderAmount(order)
  }));
  return {
    activeItems,
    orderPaidAmount: cafe24OrderAmount(order),
    shippingAmount: cafe24ShippingFee(order)
  };
}

function buildOrder(order = privateOrder) {
  return buildAiAuditOrder({
    order,
    items: order.items,
    allocateOrder,
    orderAmount: cafe24OrderAmount,
    grossOrderAmount: cafe24GrossOrderAmount,
    pointsUsedAmount: cafe24PointsUsedAmount,
    shippingFee: cafe24ShippingFee,
    isCanceledItem: isCafe24CanceledItem
  });
}

function allKeys(value, keys = []) {
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    allKeys(child, keys);
  }
  return keys;
}

test("AI audit authentication requires the configured internal token", () => {
  assert.equal(resolveAiAuditSecret({ AI_AUDIT_SECRET: "audit", CAFE24_PROXY_SECRET: "proxy" }), "audit");
  assert.equal(resolveAiAuditSecret({ CAFE24_PROXY_SECRET: "proxy" }), "proxy");
  assert.equal(isAiAuditAuthorized({ headers: {} }, { AI_AUDIT_SECRET: "audit" }), false);
  assert.equal(isAiAuditAuthorized({ headers: { "x-samplas-internal-token": "wrong" } }, { AI_AUDIT_SECRET: "audit" }), false);
  assert.equal(isAiAuditAuthorized({ headers: { "x-samplas-internal-token": "audit" } }, { AI_AUDIT_SECRET: "audit" }), true);
});

test("AI audit health normalizes Cafe24 success and failures without exposing errors", async () => {
  const success = await buildAiAuditHealth({
    probe: async () => {},
    now: () => "2026-07-29T00:00:00.000Z"
  });
  assert.equal(success.status, "OK");
  assert.equal(success.cafe24.code, "OK");

  const cases = [
    [Object.assign(new Error("Unauthorized"), { status: 401 }), "AUTH_FAILED"],
    [new Error("Cafe24 token refresh failed"), "TOKEN_REFRESH_FAILED"],
    [Object.assign(new Error("aborted"), { name: "TimeoutError" }), "UPSTREAM_TIMEOUT"],
    [Object.assign(new Error("rate limit"), { status: 429 }), "RATE_LIMITED"],
    [Object.assign(new Error("upstream"), { status: 503 }), "CAFE24_UNAVAILABLE"],
    [new Error("unexpected"), "INTERNAL_ERROR"]
  ];
  for (const [error, code] of cases) {
    const result = await buildAiAuditHealth({ probe: async () => { throw error; } });
    assert.equal(result.status, "DEGRADED");
    assert.equal(result.cafe24.code, code);
    assert.equal(result.cafe24.status, "ERROR");
  }

  const privateFailure = await buildAiAuditHealth({
    probe: async () => { throw new Error("secret-value Authorization cookie"); }
  });
  assert.deepEqual(allKeys(privateFailure).filter((key) => /token|secret|authorization|cookie/i.test(key)), []);
  assert.doesNotMatch(JSON.stringify(privateFailure), /secret-value|authorization|cookie/i);
});

test("AI audit date range requires valid dates and allows at most 31 inclusive days", () => {
  assert.throws(() => validateAiAuditRange(null, "2026-07-29"), { status: 400 });
  assert.throws(() => validateAiAuditRange("2026-02-30", "2026-03-01"), { status: 400 });
  assert.throws(() => validateAiAuditRange("2026-07-02", "2026-07-01"), { status: 400 });
  assert.throws(() => validateAiAuditRange("2026-06-29", "2026-07-30"), { status: 400 });
  assert.deepEqual(validateAiAuditRange("2026-07-01", "2026-07-31"), {
    since: "2026-07-01",
    until: "2026-07-31"
  });
});

test("revenue reconciliation uses the existing canonical diagnostic total", () => {
  const canonical = cafe24OrderAmount(privateOrder);
  const result = buildAiAuditRevenueReconciliation({
    since: "2026-07-01",
    until: "2026-07-29",
    orders: [privateOrder],
    diagnostics: { totals: { paidAmount: canonical, orderCount: 1 }, excludedOrderCount: 0 },
    allocateOrder,
    orderAmount: cafe24OrderAmount,
    grossOrderAmount: cafe24GrossOrderAmount,
    pointsUsedAmount: cafe24PointsUsedAmount,
    isCanceledOrRefunded: isCafe24CanceledOrRefunded
  });
  assert.equal(result.marketingOs.canonicalRevenue, canonical);
  assert.deepEqual(result.difference, { amount: 0, status: "MATCHED" });
  assert.deepEqual(result.mismatchedOrders, []);
});

test("single-order audit returns only allowlisted fields and no private keys", () => {
  const result = buildOrder();
  assert.deepEqual(Object.keys(result).sort(), [
    "applied_rules", "cancel_amount", "difference", "discount_amount", "gross_amount",
    "items", "marketing_os_amount", "order_date", "order_id", "order_status", "paid_amount",
    "payment_date", "points_used_amount", "refund_amount", "shipping_amount"
  ]);
  assert.deepEqual(Object.keys(result.items[0]).sort(), [
    "applied_rules", "discount_amount", "gross_amount", "paid_amount",
    "product_code", "product_no", "quantity", "variant_code"
  ]);
  const forbidden = /name|phone|email|address|postcode|memo|member|token|secret|cookie|authorization/i;
  assert.deepEqual(allKeys(result).filter((key) => forbidden.test(key)), []);

  const canceled = buildOrder({ ...privateOrder, items: [{ ...activeItem, status_code: "C2" }] });
  assert.equal(canceled.marketing_os_amount, 0);
  assert.deepEqual(canceled.items[0].applied_rules, ["CANCELED_ITEM_EXCLUDED"]);
});

test("AI audit routes explicitly return 401 and missing orders return 404", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../server.mjs", import.meta.url), "utf8"));
  assert.equal(source.includes('if (url.pathname.startsWith("/api/ai-audit/") && !isAiAuditAuthorized(req, env)) {'), true);
  assert.equal(source.includes('return json(res, { error: "Unauthorized" }, 401);'), true);
  assert.equal(source.includes('if (url.pathname === "/api/ai-audit/health") {'), true);
  assert.equal(source.includes("return json(res, data);"), true);
  assert.equal(source.includes('if (!orderId || orderId.length > 100) return json(res, { error: "Invalid order ID" }, 400);'), true);
  assert.equal(source.includes('if (!order) return json(res, { error: "Order Not Found" }, 404);'), true);
});
