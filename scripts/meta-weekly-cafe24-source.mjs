// Read-only Cafe24 source for rehearsing the Meta weekly report away from Production (Mac).
// It only calls the scheduler's own Cafe24 fetchers (no canonical order cache, token refresh stays in
// this server process) and returns an allowlisted copy: fields the report logic reads, nothing personal.
import { seoulDateKey } from "./naver-ads-weekly-report.mjs";

export const CAFE24_SOURCE_KINDS = ["actual", "analytics", "refund"];
// Oldest week a kind may read, in days before today (KST). actual/analytics match the weekly
// tracking query limit; refund covers the 8 issued weeks the refund tracking re-reads.
const MAX_AGE_DAYS = { actual: 35, analytics: 35, refund: 63 };
const MIN_INTERVAL_MS = 10000;

// Every field the weekly report reads from Cafe24 (cafe24-order-amount, meta-actual-products-sold,
// meta-issued-report, weekly-data-completeness). Unknown fields are dropped, never passed through.
const MONEY = ["order_price_amount", "payment_amount", "actual_payment_amount", "shipping_fee", "ship_fee", "shipping_fee_amount", "points_spent_amount", "credits_spent_amount",
  "membership_discount_amount", "set_product_discount_amount", "coupon_discount_price", "app_discount_amount", "market_other_discount_amount"];
const ORDER_KEYS = new Set([...MONEY, "order_id", "order_date", "payment_date", "paid_date", "ordered_date", "created_date", "order_timestamp", "paid", "canceled", "cancelled",
  "cancel_date", "cancel_status", "return_confirmed_date", "return_status", "refund_date", "refund_status", "refunded", "returned", "status", "order_status", "order_amount",
  "actual_shipping_fee", "total_price", "total_shipping_fee", "delivery_fee", "payment_method", "payment_method_name", "payment_methods", "market_id", "inflow_path",
  "ghost_mall_id", "itemFetchError", "_metaTrackingCode"]);
const AMOUNT_KEYS = new Set(MONEY);
const ITEM_KEYS = new Set(["order_item_code", "item_no", "product_no", "product_code", "variant_code", "product_name", "name", "option_value", "option_name", "option", "sku",
  "quantity", "qty", "product_quantity", "order_quantity", "product_price", "price", "option_price", "sale_price", "supply_price", "order_price_amount", "actual_payment_amount",
  "payment_amount", "additional_discount_price", "coupon_discount_price", "app_item_discount_amount", "market_discount_amount", "order_status", "status", "status_code",
  "status_text", "statusText", "claim_type", "claim_status", "cancel_date", "cancel_request_date", "exchange_request_date", "return_request_date", "return_confirmed_date",
  "refund_date", "shipped_date", "delivered_date"]);
const REFUND_KEYS = new Set(["order_id", "refund_date", "actual_refund_amount", "refund_code", "refund_status"]);
const ANALYTICS_KEYS = new Set(["order_id", "order_date", "ad", "medium", "campaign", "content", "keyword", "order_amount"]);
const ITEM_LISTS = ["items", "order_items", "products", "order_item"];

const plain = v => v === null || ["string", "number", "boolean"].includes(typeof v) || (Array.isArray(v) && v.every(x => x === null || ["string", "number", "boolean"].includes(typeof x)));
function pick(source, keys) {
  const out = {};
  if (!source || typeof source !== "object") return out;
  for (const key of keys) if (Object.hasOwn(source, key) && plain(source[key])) out[key] = source[key];
  return out;
}
function order(o) {
  if (!o || typeof o !== "object") return o;
  const out = pick(o, ORDER_KEYS);
  for (const key of ["actual_order_amount", "initial_order_amount"]) if (o[key] && typeof o[key] === "object") out[key] = pick(o[key], AMOUNT_KEYS);
  for (const key of ITEM_LISTS) if (Array.isArray(o[key])) out[key] = o[key].map(i => pick(i, ITEM_KEYS));
  if (Array.isArray(o.refunds)) out.refunds = o.refunds.map(r => pick(r, REFUND_KEYS));
  return out;
}
const orders = list => Array.isArray(list) ? list.map(order) : list;
// Coverage objects are built by weekly-data-completeness: scope, status and counts only.
const coverage = c => c === undefined ? undefined : JSON.parse(JSON.stringify(c));

export function minimizeCafe24Source(kind, result) {
  if (!result || typeof result !== "object") return result;
  if (kind === "actual") return { source: result.source, orders: orders(result.orders), coverage: coverage(result.coverage),
    trackingQueries: Array.isArray(result.trackingQueries) ? result.trackingQueries.map(q => ({ ...pick(q, ["code", "ok", "complete", "count"]), ...(q?.coverage ? { coverage: coverage(q.coverage) } : {}) })) : result.trackingQueries,
    ...("analyticsOrders" in result ? { analyticsOrders: orders(result.analyticsOrders), analyticsOrdersComplete: result.analyticsOrdersComplete, analyticsOrdersCoverage: coverage(result.analyticsOrdersCoverage) } : {}) };
  if (kind === "analytics") {
    const rows = result.data?.orderdetails;
    return { ok: result.ok, coverage: coverage(result.coverage),
      data: { orderdetails: Array.isArray(rows) ? rows.map(r => pick(r, ANALYTICS_KEYS)) : rows, ...(result.data && "total_count" in result.data ? { total_count: result.data.total_count } : {}) } };
  }
  return { orders: orders(result.orders), coverage: coverage(result.coverage) };
}

const dayMs = d => Date.parse(`${d}T00:00:00Z`);
const validDay = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(dayMs(d)) && new Date(dayMs(d)).toISOString().slice(0, 10) === d;
export function validateCafe24SourceQuery(params, now = new Date()) {
  const kind = params.get("kind"), since = params.get("since"), until = params.get("until");
  if (!CAFE24_SOURCE_KINDS.includes(kind)) return { error: "invalid_kind" };
  if (![since, until].every(validDay)) return { error: "invalid_date" };
  if (dayMs(until) - dayMs(since) !== 6 * 86400000) return { error: "period_must_be_7_days" };
  const today = seoulDateKey(now);
  if (until >= today) return { error: "period_not_finished" };
  if (dayMs(since) < dayMs(today) - MAX_AGE_DAYS[kind] * 86400000) return { error: "period_too_old" };
  return { kind, since, until };
}

// Tuesday 10:00-10:59 KST: the scheduled Meta report window, never shared with this route.
export function inMetaWeeklyWindow(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  return kst.getUTCDay() === 2 && kst.getUTCHours() === 10;
}

export function createMetaWeeklyCafe24SourceHandler({ authorized, json, fetchers, isReportRunning, now = () => new Date(), minIntervalMs = MIN_INTERVAL_MS }) {
  let busy = false, lastAt = -Infinity;
  return async (req, res, url) => {
    if (req.method !== "GET") return json(res, { ok: false, error: "method_not_allowed" }, 405);
    if (!authorized(req)) return json(res, { ok: false, error: "Unauthorized" }, 401);
    const at = now();
    const query = validateCafe24SourceQuery(url.searchParams, at);
    if (query.error) return json(res, { ok: false, error: query.error }, 400);
    if (inMetaWeeklyWindow(at) || isReportRunning()) return json(res, { ok: false, error: "meta_weekly_report_window" }, 503);
    if (busy || at.getTime() - lastAt < minIntervalMs) return json(res, { ok: false, error: "rate_limited" }, 429);
    busy = true; lastAt = at.getTime();
    try {
      const result = await fetchers[query.kind](query.since, query.until);
      return json(res, { ok: true, kind: query.kind, since: query.since, until: query.until, result: minimizeCafe24Source(query.kind, result) });
    } catch {
      // Upstream messages can carry request details; only a fixed code leaves this route.
      return json(res, { ok: false, error: "cafe24_source_failed" }, 502);
    } finally { busy = false; }
  };
}
