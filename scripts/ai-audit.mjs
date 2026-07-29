const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function dateValue(value) {
  if (!DATE_KEY.test(String(value || ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time : null;
}

function money(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function firstMoney(values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "" || typeof value === "object") continue;
    const parsed = Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return 0;
}

function orderId(order = {}) {
  return String(order.order_id || order.orderId || order.order_no || order.id || "");
}

function itemQuantity(item = {}) {
  const value = Number(item.quantity || item.qty || item.product_quantity || item.order_quantity || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function canceledAmount(order = {}) {
  return firstMoney([
    order.cancel_amount,
    order.canceled_amount,
    order.cancelled_amount,
    order.cancellation_amount,
    order.actual_order_amount?.cancel_amount
  ]);
}

function refundAmount(order = {}) {
  return firstMoney([
    order.refund_amount,
    order.refunded_amount,
    order.return_amount,
    order.actual_order_amount?.refund_amount
  ]);
}

export function resolveAiAuditSecret(env = {}) {
  return env.AI_AUDIT_SECRET || env.CAFE24_PROXY_SECRET || "";
}

export function isAiAuditAuthorized(req, env = {}) {
  const secret = resolveAiAuditSecret(env);
  return Boolean(secret && req?.headers?.["x-samplas-internal-token"] === secret);
}

export function classifyAiAuditCafe24Error(error = {}) {
  const status = Number(error.status || 0);
  const code = String(error.code || error.name || error.body?.error?.code || "").toLowerCase();
  const message = String(error.message || error.body?.error_description || "").toLowerCase();
  if (status === 429 || code.includes("rate_limit")) return "RATE_LIMITED";
  if (code === "aborterror" || code === "timeouterror" || code === "etimedout" || message.includes("timeout")) return "UPSTREAM_TIMEOUT";
  if (message.includes("refresh token") || message.includes("refresh_token") || message.includes("token refresh")) return "TOKEN_REFRESH_FAILED";
  if (status === 401 || status === 403 || code.includes("invalid_token") || message.includes("unauthorized")) return "AUTH_FAILED";
  if (status >= 500 || code === "econnreset" || code === "enotfound" || message.includes("fetch failed")) return "CAFE24_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

export async function buildAiAuditHealth({ probe, now = () => new Date().toISOString() }) {
  const startedAt = Date.now();
  let code = "OK";
  try {
    await probe();
  } catch (error) {
    code = classifyAiAuditCafe24Error(error);
  }
  const ok = code === "OK";
  return {
    status: ok ? "OK" : "DEGRADED",
    marketingOs: { status: "OK" },
    cafe24: {
      status: ok ? "OK" : "ERROR",
      code,
      responseTimeMs: Date.now() - startedAt
    },
    checkedAt: now()
  };
}

export function buildAiAuditClientsOverview(overview = {}) {
  const topRows = (rows = []) => rows.map((row) => ({
    clientId: row.clientId,
    name: row.name,
    purchaseCount: row.purchaseCount,
    salesAmount: row.salesAmount
  }));
  return {
    periodStart: overview.periodStart,
    periodEnd: overview.periodEnd,
    summary: {
      totalClients: overview.summary?.totalClients,
      totalPurchaseCount: overview.summary?.totalPurchaseCount,
      totalSalesAmount: overview.summary?.totalSalesAmount,
      avgOrderValue: overview.summary?.avgOrderValue,
      onlineSalesAmount: overview.summary?.onlineSalesAmount,
      offlineSalesAmount: overview.summary?.offlineSalesAmount,
      orderCount: overview.summary?.orderCount,
      onlineOrderCount: overview.summary?.onlineOrderCount,
      offlineOrderCount: overview.summary?.offlineOrderCount,
      quantity: overview.summary?.quantity,
      onlineQuantity: overview.summary?.onlineQuantity,
      offlineQuantity: overview.summary?.offlineQuantity,
      pointsUsedAmount: overview.summary?.pointsUsedAmount,
      shippingAmount: overview.summary?.shippingAmount
    },
    typeBreakdown: (overview.typeBreakdown || []).map((row) => ({
      type: row.type,
      label: row.label,
      clientCount: row.clientCount,
      purchaseCount: row.purchaseCount,
      salesAmount: row.salesAmount,
      ratioPct: row.ratioPct
    })),
    stylistTop10: topRows(overview.stylistTop10),
    pressTop10: topRows(overview.pressTop10),
    ffTop10: topRows(overview.ffTop10),
    meta: {
      excludedGiftCount: overview.meta?.excludedGiftCount,
      excludedGiftSalesAmount: overview.meta?.excludedGiftSalesAmount,
      pointsUsedOrderCount: overview.meta?.pointsUsedOrderCount,
      pointsUsedFieldUnavailableOrderCount: overview.meta?.pointsUsedFieldUnavailableOrderCount,
      shippingFieldUnavailableOrderCount: overview.meta?.shippingFieldUnavailableOrderCount
    }
  };
}

export function validateAiAuditRange(since, until) {
  const start = dateValue(since);
  const end = dateValue(until);
  if (start === null || end === null) throw Object.assign(new Error("since and until must be valid YYYY-MM-DD dates"), { status: 400 });
  if (end < start) throw Object.assign(new Error("until must not be before since"), { status: 400 });
  if ((end - start) / 86400000 > 30) throw Object.assign(new Error("date range must not exceed 31 days"), { status: 400 });
  return { since, until };
}

export function buildAiAuditRevenueReconciliation({
  since,
  until,
  orders = [],
  diagnostics = {},
  allocateOrder,
  orderAmount,
  grossOrderAmount,
  pointsUsedAmount,
  isCanceledOrRefunded
}) {
  const mismatchedOrders = [];
  let grossAmount = 0;
  let paidAmount = 0;
  let pointsAmount = 0;
  let cancelTotal = 0;
  let refundTotal = 0;

  for (const order of orders) {
    const cafe24Amount = money(orderAmount(order));
    const allocation = allocateOrder(order);
    const marketingOsAmount = allocation.activeItems.length ? money(allocation.orderPaidAmount) : 0;
    const difference = cafe24Amount - marketingOsAmount;
    const rules = [];
    if (isCanceledOrRefunded(order)) rules.push("CANCELED_OR_REFUNDED_ORDER_EXCLUDED");
    else if (!allocation.activeItems.length) rules.push("NO_ACTIVE_ITEMS_EXCLUDED");
    else rules.push("ACTIVE_ITEMS_INCLUDED");
    if (allocation.shippingAmount > 0) rules.push("SHIPPING_EXCLUDED_FROM_PRODUCT_ALLOCATION");

    grossAmount += money(grossOrderAmount(order));
    paidAmount += cafe24Amount;
    const points = pointsUsedAmount(order);
    if (points !== null && points !== undefined) pointsAmount += money(points);
    cancelTotal += canceledAmount(order);
    refundTotal += refundAmount(order);
    if (difference !== 0 && mismatchedOrders.length < 100) {
      mismatchedOrders.push({
        order_id: orderId(order),
        cafe24Amount,
        marketingOsAmount,
        difference,
        rules
      });
    }
  }

  const canonicalRevenue = money(diagnostics?.totals?.paidAmount);
  const amountDifference = paidAmount - canonicalRevenue;
  return {
    range: { since, until },
    cafe24: {
      orderCount: new Set(orders.map(orderId).filter(Boolean)).size,
      grossAmount,
      paidAmount,
      discountAmount: grossAmount - paidAmount,
      pointsUsedAmount: pointsAmount,
      cancelAmount: cancelTotal,
      refundAmount: refundTotal
    },
    marketingOs: {
      canonicalRevenue,
      includedOrderCount: money(diagnostics?.totals?.orderCount),
      excludedOrderCount: money(diagnostics?.excludedOrderCount)
    },
    difference: {
      amount: amountDifference,
      status: amountDifference === 0 ? "MATCHED" : "MISMATCHED"
    },
    mismatchedOrders
  };
}

export function buildAiAuditOrder({
  order,
  items = [],
  allocateOrder,
  orderAmount,
  grossOrderAmount,
  pointsUsedAmount,
  shippingFee,
  isCanceledItem
}) {
  const calculationOrder = Object.create(order);
  calculationOrder.items = items;
  const allocation = allocateOrder(calculationOrder);
  const paidAmount = money(orderAmount(calculationOrder));
  const marketingOsAmount = allocation.activeItems.length ? money(allocation.orderPaidAmount) : 0;
  const allocationByItem = new Map(allocation.activeItems.map((row) => [row.item, row]));
  const appliedRules = allocation.activeItems.length ? ["ACTIVE_ITEMS_INCLUDED"] : ["NO_ACTIVE_ITEMS_EXCLUDED"];
  if (allocation.shippingAmount > 0) appliedRules.push("SHIPPING_EXCLUDED_FROM_PRODUCT_ALLOCATION");

  return {
    order_id: orderId(order),
    order_date: String(order.order_date || order.created_date || "").slice(0, 10) || null,
    payment_date: String(order.payment_date || order.paid_date || "").slice(0, 10) || null,
    order_status: order.order_status || order.status || null,
    gross_amount: money(grossOrderAmount(calculationOrder)),
    paid_amount: paidAmount,
    discount_amount: money(grossOrderAmount(calculationOrder)) - paidAmount,
    points_used_amount: pointsUsedAmount(calculationOrder),
    shipping_amount: money(shippingFee(calculationOrder)),
    cancel_amount: canceledAmount(order),
    refund_amount: refundAmount(order),
    marketing_os_amount: marketingOsAmount,
    applied_rules: appliedRules,
    difference: paidAmount - marketingOsAmount,
    items: items.map((item) => {
      const allocationRow = allocationByItem.get(item);
      const quantity = itemQuantity(item);
      const gross = allocationRow ? money(allocationRow.grossAmount) : firstMoney([
        item.product_price,
        item.order_price_amount,
        item.actual_payment_amount,
        item.price
      ]) * quantity;
      const itemPaid = allocationRow ? money(allocationRow.paidAmount) : 0;
      return {
        product_no: item.product_no ?? item.productNo ?? null,
        product_code: item.product_code ?? item.productCode ?? null,
        variant_code: item.variant_code ?? item.variantCode ?? null,
        quantity,
        gross_amount: gross,
        paid_amount: itemPaid,
        discount_amount: gross - itemPaid,
        applied_rules: isCanceledItem(item) ? ["CANCELED_ITEM_EXCLUDED"] : ["ACTIVE_ITEM_ALLOCATED"]
      };
    })
  };
}
