import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPastKstDate, cafe24OrdersApiVersion, collectTrackingDay, saveTrackingReport, TRACKING_CODES } from "../scripts/tracking-test-run.mjs";

// Synthetic responses only; production never reads these values.
const NOW = () => new Date("2026-10-28T01:00:00Z"); // 10:00 KST
const env = { META_AD_ACCOUNT_ID: "act_1", INSTAGRAM_BUSINESS_ACCOUNT_ID: "ig1", CAFE24_MALL_ID: "mall", WORK_DIR: "/work", PORT: "10000" };
const fresh = { accessToken: "c24", expiresAt: "2026-10-28T03:00:00Z" };
const reply = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

function fakeFetch(overrides = {}) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, method: init.method || "GET" });
    for (const [match, fn] of Object.entries(overrides)) if (url.href.includes(match)) return fn(url);
    if (url.pathname.endsWith("/act_1/insights")) {
      const level = url.searchParams.get("level");
      if (level === "account") return reply({ data: [] }); // no delivery: real zero
      if (level === "campaign") return reply({ data: [] });
      return reply({ data: [{ ad_id: "a1", actions: [{ action_type: "purchase", "7d_click": "2", "1d_view": "1" }], action_values: [{ action_type: "purchase", "7d_click": "50000", "1d_view": "10000" }] }] });
    }
    if (url.pathname.endsWith("/act_1")) return reply({ timezone_name: "Asia/Seoul" });
    if (url.pathname.endsWith("/ig1/insights")) {
      const values = { reach: 1200, profile_views: 40, website_clicks: 5, views: 3000 };
      return reply({ data: url.searchParams.get("metric").split(",").map((name) => ({ name, total_value: { value: values[name] } })) });
    }
    if (url.pathname.endsWith("/ig1")) return reply({ followers_count: 5000, media_count: 10 });
    if (url.pathname === "/api/intelligence/naver/ads/performance") return reply({ ok: true, summary: { spend: 0, impressions: 0 }, campaigns: [] });
    if (url.pathname === "/api/cafe24/refresh-token") return reply({ ok: true });
    if (url.pathname === "/api/v2/admin/orders") {
      const code = url.searchParams.get("inflow_path");
      if (!code) return reply({ orders: [{ order_id: "o1", order_date: "2026-10-27T11:00:00+09:00", payment_amount: "30000" }, { order_id: "o2", payment_amount: "20000" }] });
      return reply({ orders: code === "meta_ssage" ? [{ order_id: "o1", payment_amount: "30000" }] : [] });
    }
    throw new Error(`unexpected ${url.href}`);
  };
  return { impl, calls };
}

const run = (fetchImpl, readJson = async (p) => (p.endsWith("cafe24-token-store.json") ? fresh : { accessToken: "meta" })) =>
  collectTrackingDay({ date: "2026-10-27", env, fetchImpl, readJson, now: NOW });
const byKey = (report) => Object.fromEntries(report.items.map((i) => [`${i.platform}:${i.item}`, i]));

test("only completed KST days are accepted", () => {
  assert.doesNotThrow(() => assertPastKstDate("2026-10-27", NOW()));
  assert.throws(() => assertPastKstDate("2026-10-28", NOW()), /not a completed KST day/);
  assert.throws(() => assertPastKstDate("2026-02-30", NOW()), /Invalid date/);
});

test("complete responses: zeros are OK, adgroups NOT_COLLECTED, tracking summed without mixing metrics", async () => {
  const { impl, calls } = fakeFetch();
  const report = await run(impl);
  const items = byKey(report);
  assert.equal(items["meta:account"].status, "OK");
  assert.equal(items["meta:account"].metrics.spend, 0);
  assert.match(items["meta:account"].basis, /Asia\/Seoul/);
  assert.equal(items["naver:campaigns"].status, "OK");
  assert.equal(items["naver:adgroups"].status, "NOT_COLLECTED");
  assert.deepEqual(items["cafe24:actual_orders"].metrics, { orderCount: 2, activeOrderCount: 2, canceledOrRefundedCount: 0, paidAmount: 50000 });
  for (const code of TRACKING_CODES) assert.equal(items[`cafe24:tracking:${code}`].status, "OK");
  assert.deepEqual(items["attribution:meta_vs_cafe24_tracking"].metrics, { metaClickPurchases: 2, metaViewPurchases: 1, metaClickValue: 50000, metaViewValue: 10000, cafe24TrackedActiveOrders: 1, cafe24TrackedPaidAmount: 30000 });
  assert.equal(report.result, "PARTIAL");
  // Only GETs leave the process; the server's caching Cafe24 route is never called; no refresh with a fresh token.
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.ok(!calls.some((c) => c.url.pathname === "/api/cafe24/orders" || c.url.pathname === "/api/cafe24/refresh-token"));
  // Instagram uses exact KST day boundaries.
  assert.deepEqual(items["instagram:account_reach"].metrics, { reach: 1200 });
  assert.deepEqual(items["instagram:account_totals"].metrics, { profile_views: 40, website_clicks: 5, views: 3000 });
  const ig = calls.find((c) => c.url.pathname.endsWith("/ig1/insights")).url.searchParams;
  assert.deepEqual([ig.get("since"), ig.get("until")], [String(Date.parse("2026-10-27T00:00:00+09:00") / 1000), String(Date.parse("2026-10-28T00:00:00+09:00") / 1000)]);
});

test("failures are FAILED, never 0: Graph error, Naver not ok, Cafe24 error; attribution FAILED when inputs fail", async () => {
  const { impl } = fakeFetch({
    "level=ad": () => reply({ error: { message: "Graph down" } }, 500),
    "/api/intelligence/naver": () => reply({ ok: false, error: "Naver timeout" }),
    "inflow_path=meta_adv_video": () => reply({ error: { message: "Cafe24 500" } }, 500)
  });
  const items = byKey(await run(impl));
  assert.deepEqual([items["meta:attribution"].status, items["meta:attribution"].metrics, items["meta:attribution"].reason], ["FAILED", null, "Graph down"]);
  assert.deepEqual([items["naver:campaigns"].status, items["naver:campaigns"].reason], ["FAILED", "Naver timeout"]);
  assert.equal(items["cafe24:tracking:meta_adv_video"].status, "FAILED");
  assert.equal(items["cafe24:tracking:meta_ssage"].status, "OK");
  assert.equal(items["attribution:meta_vs_cafe24_tracking"].status, "FAILED");
});

test("expiring Cafe24 token is refreshed only through the server loopback route", async () => {
  let refreshed = false;
  const { impl, calls } = fakeFetch({ "/api/cafe24/refresh-token": () => { refreshed = true; return reply({ ok: true }); } });
  // Cafe24 format without offset is KST: 10:05 KST = 5 minutes after NOW, so it must refresh.
  const readJson = async (p) => (p.endsWith("cafe24-token-store.json") ? (refreshed ? fresh : { accessToken: "old", expiresAt: "2026-10-28T10:05:00.000" }) : null);
  const items = byKey(await collectTrackingDay({ date: "2026-10-27", env: { ...env, META_ACCESS_TOKEN: "meta" }, fetchImpl: impl, readJson, now: NOW }));
  const refresh = calls.filter((c) => c.url.pathname === "/api/cafe24/refresh-token");
  assert.equal(refresh.length, 1);
  assert.equal(refresh[0].url.host, "127.0.0.1:10000");
  assert.equal(items["cafe24:actual_orders"].status, "OK");
});

test("an order page that fills the 1000 cap is FAILED as incomplete", async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ order_id: `o${i}`, payment_amount: "1" }));
  const { impl } = fakeFetch({ "/api/v2/admin/orders": () => reply({ orders: page }) });
  const items = byKey(await run(impl));
  assert.match(items["cafe24:actual_orders"].reason, /exceed 1000/);
});

test("save writes new local files only and refuses to overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tracking-test-"));
  const report = await run(fakeFetch().impl);
  const saved = await saveTrackingReport(report, { env: { TRACKING_TEST_DIR: dir }, upload: false });
  assert.deepEqual((await readdir(dir)).sort(), [...saved.files, saved.files[0].replace(".json", ".done")].sort());
  await assert.rejects(saveTrackingReport(report, { env: { TRACKING_TEST_DIR: dir }, upload: false }), /EEXIST/);
});

test("upload without Dropbox config fails and leaves no done marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tracking-nodbx-"));
  const report = await run(fakeFetch().impl);
  await assert.rejects(saveTrackingReport(report, { env: { TRACKING_TEST_DIR: dir }, upload: true }), /Dropbox is not configured/);
  assert.ok(!(await readdir(dir)).some((f) => f.endsWith(".done")));
});

test("Naver null totals are FAILED, not OK; Cafe24 orders API version follows the server minimum", async () => {
  const { impl, calls } = fakeFetch({ "/api/intelligence/naver": () => reply({ ok: true, summary: { spend: null, impressions: 10 }, campaigns: [] }) });
  const items = byKey(await run(impl));
  assert.deepEqual([items["naver:campaigns"].status, items["naver:campaigns"].reason], ["FAILED", "Naver summary incomplete (null: spend)"]);
  assert.equal(cafe24OrdersApiVersion({}), "2025-07-01");
  assert.equal(cafe24OrdersApiVersion({ CAFE24_API_VERSION: "2026-03-01" }), "2026-03-01");
  assert.equal(cafe24OrdersApiVersion({ CAFE24_ORDERS_API_VERSION: "2025-12-01", CAFE24_API_VERSION: "2026-03-01" }), "2025-12-01");
  assert.ok(calls.filter((c) => c.url.pathname === "/api/v2/admin/orders").length > 0);
});

test("a FAILED result is saved but not marked done", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tracking-failed-"));
  const { impl } = fakeFetch({ "/api/intelligence/naver": () => reply({ ok: false, error: "down" }) });
  const report = await run(impl);
  assert.equal(report.result, "FAILED");
  const saved = await saveTrackingReport(report, { env: { TRACKING_TEST_DIR: dir }, upload: false });
  assert.deepEqual((await readdir(dir)).sort(), saved.files.sort());
});
