import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNaverAttributionReport as report, previousPeriod } from "../scripts/naver-attribution-report.mjs";

const since = "2026-11-20";
const pilot = { groupId: "pilot", brandCode: "B0604", brandName: "604SERVICE", content: "604service_test", startDay: "2026-11-15", oldAdId: "old", newAdId: "new" };
const analytics = { order_id: "order-test", order_date: "2026-11-19T16:00:00Z", ad: "네이버", medium: "cpc", campaign: "powerlink", content: pilot.content, order_amount: 700000 };
const admin = { order_id: analytics.order_id, order_date: analytics.order_date, member_id: "private-id", paid: "T", canceled: "F", actual_order_amount: { payment_amount: "380000.00" }, items: [{ product_no: 7, product_name: "상품", quantity: 2 }] };
const stats = { id: "new", day: since, spend: 1000, clicks: 5, impressions: 50, platformRevenue: 500000 };
const base = {
  since, until: since, generatedAt: "2026-11-24T00:00:00Z", mapping: [pilot],
  adRows: [stats], adCoverage: [since], ordersCoverage: [since],
  analyticsBatches: [{ since, until: since, ok: true, completeness: "COMPLETE", rows: [analytics, analytics] }],
  orders: [admin, admin], customerTypes: { "order-test": "NEW" }, catalog: { 7: { brandName: "구매 브랜드" } }
};

test("deduplicates the 380,000 won pilot and uses Admin payment instead of platform or Analytics revenue", () => {
  const result = report({ ...base, adRows: [stats, stats, { ...stats, id: "old", spend: 500 }] });
  assert.equal(result.trackingStatus, "VERIFIED");
  assert.equal(result.totals.orders, 1);
  assert.equal(result.totals.paid, 380000);
  assert.equal(result.totals.net, 380000);
  assert.equal(result.totals.refund, 0);
  assert.equal(result.totals.spend, 1500);
  assert.equal(result.totals.newCustomers, 1);
  assert.equal(result.totals.platformRevenue, 1000000);
  assert.equal(result.totals.roas, 380000 / 1500);
  assert.equal(result.totals.ctr, 0.1);
  assert.equal(result.orders[0].day, "2026-11-20");
  assert.equal(result.orders[0].acquisitionBrand, "604SERVICE");
  assert.deepEqual(result.orders[0].purchaseBrands, ["구매 브랜드"]);
  assert.equal(result.orders[0].items[0].quantity, 2);
  assert.equal(Object.hasOwn(result.orders[0], "memberId"), false);
});

test("uses latest Admin observation and applies a Cafe24 partial claim once", () => {
  const before = { ...admin, observedAt: "2026-11-21" };
  const after = { ...admin, observedAt: "2026-11-22", canceled: "M", initial_order_amount: { payment_amount: 380000 }, actual_order_amount: { payment_amount: 250000 }, refund_amount: 130000 };
  const result = report({ ...base, orders: [before, after] });
  assert.equal(result.totals.paid, 380000);
  assert.equal(result.totals.refund, 130000);
  assert.equal(result.totals.net, 250000);
  assert.equal(result.orders[0].status, "PARTIAL_REFUND");
});

test("zero requires closed-day Analytics and Admin coverage with no unmatched payment", () => {
  const noMatches = { ...base, orders: [], analyticsBatches: [{ ...base.analyticsBatches[0], rows: [] }] };
  assert.equal(report(noMatches).totals.net, 0);
  assert.equal(report({ ...noMatches, ordersCoverage: [] }).totals.net, null);
  assert.equal(report({ ...noMatches, orders: [admin] }).trackingStatus, "UNVERIFIED");
  const staleToday = report({ ...noMatches, generatedAt: "2026-11-19T17:00:00Z" });
  assert.equal(staleToday.totals.net, null);
});

test("holds conflicting tags and excludes pre-application attribution", () => {
  const second = { ...pilot, content: "second", oldAdId: null, newAdId: "other" };
  const conflicted = report({ ...base, mapping: [pilot, second], analyticsBatches: [{ ...base.analyticsBatches[0], rows: [analytics, { ...analytics, content: "second" }] }] });
  assert.equal(conflicted.totals.net, null);
  assert.deepEqual(conflicted.orders, []);
  const pre = report({ ...base, mapping: [{ ...pilot, startDay: "2026-11-21" }] });
  assert.equal(pre.trackingStatus, "UNVERIFIED");
  assert.deepEqual(pre.orders, []);
});

test("preserves known evidence and withholds missing-stat ROAS", () => {
  const missing = report({ ...base, adRows: [], adCoverage: [], ordersCoverage: [], grain: "week" });
  assert.equal(missing.totals.spend, null);
  assert.equal(missing.totals.roas, null);
  assert.equal(missing.totals.net, null);
  assert.equal(missing.totals.known.net, 380000);
  assert.equal(missing.rows[0].key, "2026-11-16");
  assert.equal(missing.brandRows[0].brandCode, pilot.brandCode);
  assert.deepEqual(previousPeriod("2026-11-01", "2026-11-03"), { since: "2026-10-29", until: "2026-10-31" });
});

test("keeps campaign and group data grains separate and leaves unconfirmed revenue partial", () => {
  const result = report({
    ...base, adRows: [{ ...stats, id: "group", brandCode: pilot.brandCode }], adCoverage: [{ since, until: since, ok: true, completeness: "COMPLETE", brandCode: pilot.brandCode }],
    totalAdRows: [{ ...stats, id: "campaign", spend: 3000 }], totalAdCoverage: [since]
  });
  assert.equal(result.totals.spend, 3000);
  assert.equal(result.brandRows[0].spend, 1000);
  assert.equal(result.brandRows[0].roas, 380);
  assert.equal(result.rows[0].since, since);
  assert.equal(result.rows[0].until, since);
});
