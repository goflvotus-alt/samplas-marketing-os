import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildActualProductsSold } from "../scripts/meta-actual-products-sold.mjs";
import { fromMetaAds, fromNaverAds } from "../scripts/advertising-canonical.mjs";

// Execute the real handler source (period validator + the new overview handler)
// without service startup. fetchMarketingOsJson and handleNaverAdsReadOnlyRoute
// are injected fakes so this test isolates Phase 3's own wiring (same since/until,
// canonical adapter reuse, per-channel failure isolation) from Meta/Naver's own
// internals, which already have their own test coverage.
const source = await readFile(new URL("../intelligence-service.mjs", import.meta.url), "utf8");
function section(start, end) {
  assert.ok(source.includes(start), `missing marker: ${start}`);
  assert.ok(source.includes(end), `missing marker: ${end}`);
  return source.slice(source.indexOf(start), source.indexOf(end));
}
const executable = [
  section("function naverAdsPerformancePeriod(url) {", "async function fetchNaverAdsReadOnly"),
  section("function capturingResponse() {", "function naverAdsCredentials() {")
].join("\n");

const period = { since: "2026-09-01", until: "2026-09-07" };
const metaOk = { source: "meta_marketing_api", ...period, totals: { spend: 100, impressions: 1000, clicks: 20, purchases: 2, purchaseValue: 400 } };
const naverOk = { ok: true, ...period, summary: { spend: 50, impressions: 500, clicks: 10, conversions: 1, conversionValue: 200, ctr: 2, conversionRate: 10, roas: 4 }, campaigns: [], metadata: { source: "naver-searchad-stats", timezone: "Asia/Seoul" } };

function harness({ meta, naver, readNaver } = {}) {
  const metaCalls = [], naverCalls = [];
  const context = {
    fromMetaAds, fromNaverAds, buildActualProductsSold, URL, AbortSignal,
    naverAdsCredentials: () => ({ ok: Boolean(readNaver) }),
    fetchNaverAdsReadOnly: readNaver,
    json: (res, payload, status = 200) => { res.writeHead(status); res.end(JSON.stringify(payload)); },
    fetchMarketingOsJson: async (path) => { metaCalls.push(path); return typeof meta === "function" ? meta(path) : meta; },
    handleNaverAdsReadOnlyRoute: async (kind, url, res) => {
      naverCalls.push({ kind, since: url.searchParams.get("since"), until: url.searchParams.get("until") });
      const body = typeof naver === "function" ? naver(url) : naver;
      if (body instanceof Error) throw body;
      res.writeHead(body?.ok ? 200 : 502);
      res.end(JSON.stringify(body));
    }
  };
  runInNewContext(executable, context);
  return {
    metaCalls, naverCalls,
    async request(query) {
      let status, body;
      const res = { writeHead(code) { status = code; }, end(text) { body = JSON.parse(text); } };
      const url = new URL("http://localhost/api/advertising/overview" + query);
      await context.handleAdvertisingOverviewRoute(url, res);
      return { status, body };
    }
  };
}

test("Meta and Naver both healthy: canonical adapter actually computes both channels", async () => {
  const h = harness({ meta: { ok: true, data: metaOk }, naver: naverOk });
  const { status, body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(status, 200);
  assert.equal(body.since, "2026-09-01"); assert.equal(body.until, "2026-09-07");
  assert.equal(body.channels.length, 2);
  const [meta, naver] = body.channels;
  assert.equal(meta.schemaVersion, 1); assert.equal(meta.channel, "meta");
  assert.equal(meta.status, "available");
  assert.equal(meta.ctr, 0.02); // 20/1000 — proves real fromMetaAds math, not hand-rolled
  assert.equal(meta.platformConversions, 2); assert.equal(meta.platformConversionValue, 400);
  assert.equal(naver.channel, "naver"); assert.equal(naver.status, "available");
  assert.equal(naver.platformConversions, 1);
  assert.equal(body.actualCommerce.available, false);
  assert.deepEqual(body.notes, []);
});

test("Meta fails, Naver stays available", async () => {
  const h = harness({ meta: { ok: false, message: "internal upstream detail" }, naver: naverOk });
  const { body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(body.channels[0].channel, "meta"); assert.equal(body.channels[0].status, "unavailable");
  assert.equal(body.channels[1].channel, "naver"); assert.equal(body.channels[1].status, "available");
  assert.equal(body.actualCommerce.available, false);
});

test("Naver fails (thrown), Meta stays available", async () => {
  const h = harness({ meta: { ok: true, data: metaOk }, naver: () => { throw new Error("secret-token-abc123 leaked path"); } });
  const { body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(body.channels[0].channel, "meta"); assert.equal(body.channels[0].status, "available");
  assert.equal(body.channels[1].channel, "naver"); assert.equal(body.channels[1].status, "unavailable");
  assert.ok(!JSON.stringify(body).includes("secret-token-abc123"), "thrown error text must never reach the response");
  assert.equal(body.actualCommerce.available, false);
});

test("both channels fail: overview still returns 200 with two unavailable channels", async () => {
  const h = harness({ meta: { ok: false, message: "x" }, naver: { ok: false, error: "Naver Search Ads credentials are not configured" } });
  const { status, body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(status, 200);
  assert.equal(body.channels[0].status, "unavailable");
  assert.equal(body.channels[1].status, "unavailable");
  assert.equal(body.actualCommerce.available, false);
});

test("Meta and Naver receive the identical since/until", async () => {
  const h = harness({ meta: { ok: true, data: metaOk }, naver: naverOk });
  await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(h.metaCalls.length, 3);
  assert.ok(h.metaCalls[0].includes("since=2026-09-01") && h.metaCalls[0].includes("until=2026-09-07"));
  assert.equal(h.naverCalls.length, 1);
  assert.equal(h.naverCalls[0].since, "2026-09-01"); assert.equal(h.naverCalls[0].until, "2026-09-07");
});

test("Cafe24 actual commerce remains unavailable without order evidence", async () => {
  const h = harness({ meta: { ok: true, data: metaOk }, naver: naverOk });
  const { body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(body.actualCommerce.available, false);
  assert.ok(!("cafe24" in body));
});

test("invalid period is rejected before either channel is called", async () => {
  const h = harness({ meta: { ok: true, data: metaOk }, naver: naverOk });
  const { status, body } = await h.request("?since=bad&until=2026-09-07");
  assert.equal(status, 400); assert.equal(body.ok, false);
  assert.equal(h.metaCalls.length, 0); assert.equal(h.naverCalls.length, 0);
});

test('actual commerce reuses Analytics exact order join and never replaces platform values',async()=>{
  const order={order_id:'verified',order_date:'2026-09-03',payment_amount:198000,items:[{product_name:'Real jeans',quantity:1,product_price:198000}]};
  const h=harness({meta:path=>({ok:true,data:path.includes('/api/cafe24/orders')?{source:'cafe24_admin_api',orders:[order]}:path.includes('analytics-orderdetails')?{ok:true,data:{orderdetails:[{order_id:'verified',ad:'ig',medium:'paid',content:'exact-ad'}]}}:metaOk}),naver:naverOk});
  const {body}=await h.request('?since=2026-09-01&until=2026-09-07');
  assert.equal(body.actualCommerce.available,true);assert.equal(body.actualCommerce.summary.metaPaidRevenue,198000);assert.equal(body.actualCommerce.rows[0].order_id,'verified');assert.equal(body.channels[0].platformConversionValue,400);
});

test("route dispatch is GET-only and the handler itself takes no request body", () => {
  assert.match(source, /if \(url\.pathname === "\/api\/advertising\/overview"\) \{\s*\n\s*if \(req\.method !== "GET"\) return json\(res, \{ ok: false, error: "Method Not Allowed" \}, 405\);/);
  // handleAdvertisingOverviewRoute(url, res) — no req/body parameter to mutate from.
  assert.match(source, /async function handleAdvertisingOverviewRoute\(url, res\) \{/);
});

test("order evidence keeps paid channels, unclear orders and platform values independently auditable", async () => {
  const base = { order_date: "2026-09-03", paid: "T", payment_date: "2026-09-03T09:00:00+09:00",
    payment_method: ["card"], payment_amount: 70000, items: [{ product_name: "Jeans", quantity: 1, product_price: 70000 }] };
  const orders = [
    { ...base, order_id: "meta" }, { ...base, order_id: "meta" },
    { ...base, order_id: "naver", payment_amount: 72000 },
    { ...base, order_id: "npay", order_place_id: "NCHECKOUT" },
    { ...base, order_id: "conflict" }
  ];
  const orderdetails = [
    { order_id: "meta", ad: "meta", medium: "paid", campaign: "Catalog", content: "Label only" },
    { order_id: "naver", ad: "naver", medium: "cpc" },
    { order_id: "npay", ad: "", medium: "" },
    { order_id: "conflict", ad: "meta", medium: "paid" },
    { order_id: "conflict", ad: "naver", medium: "cpc" }
  ];
  const h = harness({
    meta: path => ({ ok: true, data: path.includes("/api/cafe24/orders")
      ? { source: "cafe24_admin_api", orders }
      : path.includes("analytics-orderdetails") ? { ok: true, data: { orderdetails } } : metaOk }),
    naver: naverOk
  });
  const { body } = await h.request("?since=2026-09-01&until=2026-09-07");
  const proof = body.actualCommerce.orderEvidence;
  assert.deepEqual(proof.summary.meta, { orderCount: 1, paidAmount: 70000 });
  assert.deepEqual(proof.summary.naver, { orderCount: 1, paidAmount: 72000 });
  assert.deepEqual(proof.summary.unverified, { orderCount: 2, paidAmount: 140000 });
  assert.equal(proof.orders.find(o => o.orderId === "npay").channel, null);
  assert.equal(proof.orders.find(o => o.orderId === "meta").adId, null);
  assert.equal(proof.orders.find(o => o.orderId === "meta").paymentDate, base.payment_date);
  assert.deepEqual(proof.orders.find(o => o.orderId === "meta").paymentMethods, ["card"]);
  assert.equal(body.channels[0].platformConversionValue, 400);
});

test("ad-ID revenue counts duplicate events once and uses the remaining payment for partial refunds", async () => {
  const adId = "120251126012190277";
  const campaignId = "120251125882930277";
  const paid = { order_date: "2026-09-03", paid: "T", payment_amount: 70000,
    items: [{ product_name: "Jeans", quantity: 1, product_price: 70000 }] };
  const orders = [
    { ...paid, order_id: "kept", canceled: "M", actual_order_amount: { payment_amount: 50000 } },
    { ...paid, order_id: "refunded", refunded: "T" },
    { ...paid, order_id: "missing", canceled: "M" },
    { ...paid, order_id: "wrong-campaign" }
  ];
  const rows = orders.map(({ order_id }) => ({ order_id, ad: "meta", medium: "paid", content: adId,
    campaign: order_id === "wrong-campaign" ? "120251125882930278" : campaignId }));
  const h = harness({
    meta: path => ({ ok: true, data: path.includes("/api/cafe24/orders") ? { source: "cafe24_admin_api", orders }
      : path.includes("analytics-orderdetails") ? { ok: true, data: { orderdetails: [...rows, rows[0]] } }
      : path.includes("level=ad") ? { source: "meta_marketing_api", ads: [{ adId, campaignId, adName: "Catalogue" }] }
      : metaOk }),
    naver: naverOk
  });
  const { body } = await h.request("?since=2026-09-01&until=2026-09-07");
  const proof = body.actualCommerce.orderEvidence;
  assert.equal(proof.orders.some(o => o.orderId === "refunded"), false);
  assert.equal(proof.orders.find(o => o.orderId === "missing").paidAmount, null);
  assert.equal(proof.orders.find(o => o.orderId === "wrong-campaign").adId, null);
  assert.equal(proof.verifiedAds[0].adId, adId);
  assert.equal(proof.verifiedAds[0].orderCount, 1);
  assert.equal(proof.verifiedAds[0].paidAmount, 50000);
});

test("registered Naver Powerlink tags verify checkout orders at tag level and never guess a delivery ad ID", async () => {
  const checkout = {
    order_id: "npay", order_date: "2026-09-03", paid: "T", order_place_id: "NCHECKOUT",
    payment_amount: 380000, items: [{ product_name: "Test", quantity: 1, product_price: 380000 }]
  };
  const tag = "604service_test";
  const duplicate = { order_id: "npay", ad: "네이버", medium: "cpc", campaign: "powerlink", content: tag };
  const report = buildActualProductsSold({
    data: { orders: [checkout] }, analytics: { data: { orderdetails: [duplicate, duplicate] } },
    naverVerifiedTags: new Set([tag]), since: "2026-09-01", until: "2026-09-07", includeOrderEvidence: true
  }).orderEvidence;
  assert.equal(report.orders[0].evidence, "MATCHED_NAVER_TRACKING_TAG");
  assert.equal(report.orders[0].adId, null);
  assert.equal(report.orders[0].orderPlace, "NCHECKOUT");
  assert.deepEqual(report.verifiedNaverTags, [{ tag, orderCount: 1, paidAmount: 380000 }]);
  assert.deepEqual(report.verifiedAds, []);
});

test("overview corroborates an order tag with the registered landing and rejects conflicting URL parameters", async () => {
  const group = "grp-a001-01-000000001140168";
  const tag = group + "~nad-a001-01-000000401998705";
  const other = group + "~nad-a001-01-000000401998706";
  const tagged = (value) => `http://samplas.co.kr/?utm_source=naver&utm_medium=cpc&utm_campaign=powerlink&utm_content=${value}`;
  const analytics = [tag, other].map((content, index) => ({
    order_id: `order-${index}`, ad: "naver", medium: "cpc", campaign: "powerlink", content
  }));
  const orders = analytics.map(({ order_id }) => ({
    order_id, order_date: "2026-09-03", paid: "T", payment_amount: 3000,
    items: [{ product_name: "Test", quantity: 1 }]
  }));
  const reads = [];
  const h = harness({
    meta: path => ({ ok: true, data: path.includes("/api/cafe24/orders") ? { source: "cafe24_admin_api", orders }
      : path.includes("analytics-orderdetails") ? { ok: true, data: { orderdetails: analytics } } : metaOk }),
    naver: naverOk,
    readNaver: async (path, { nccAdgroupId }) => {
      reads.push(path);
      assert.equal(nccAdgroupId, group);
      return [
        { nccAdgroupId, ad: { mobile: { final: tagged(tag) } } },
        { nccAdgroupId, ad: { pc: { final: tagged(other) + "&utm_content=conflict" } } }
      ];
    }
  });
  const { body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.deepEqual(reads, ["/ncc/ads"]);
  assert.deepEqual(body.actualCommerce.orderEvidence.verifiedNaverTags, [{ tag, orderCount: 1, paidAmount: 3000 }]);
  assert.equal(body.actualCommerce.orderEvidence.orders[1].evidence, "PAID_CHANNEL");
});

test("five evidence levels: ad ID confirmed, tag confirmed, channel only, name estimate and unverified stay separate", async () => {
  const order = (id) => ({ order_id: id, order_date: "2026-11-20", paid: "T", payment_amount: 10000, items: [{ product_name: "Test", quantity: 1, product_price: 10000 }] });
  const ids = ["a", "b", "c", "d", "e"];
  const rows = [
    { order_id: "a", ad: "meta", medium: "paid", campaign: "c1", content: "120251125886880277" },
    { order_id: "b", ad: "네이버", medium: "cpc", campaign: "powerlink", content: "604service_test" },
    { order_id: "c", ad: "meta", medium: "paid", campaign: "c1", content: "unknown" },
    { order_id: "d", ad: "meta", medium: "paid", campaign: "c1", content: "MAIN AD" }
  ];
  const report = buildActualProductsSold({
    data: { orders: ids.map(order) }, analytics: { data: { orderdetails: rows } },
    metaAds: [{ adId: "120251125886880277", adName: "MAIN AD", campaignId: "c1" }],
    naverVerifiedTags: new Set(["604service_test"]), since: "2026-11-17", until: "2026-11-23", includeOrderEvidence: true
  }).orderEvidence;
  assert.deepEqual(report.orders.map((o) => [o.orderId, o.evidence, o.adId, o.estimatedAdId]), [
    ["a", "MATCHED_AD_ID", "120251125886880277", null], ["b", "MATCHED_NAVER_TRACKING_TAG", null, null],
    ["c", "PAID_CHANNEL", null, null], ["d", "ESTIMATED_AD_NAME", null, "120251125886880277"], ["e", "NO_VERIFIED_PAID_CHANNEL", null, null]]);
  // Only the confirmed ad ID counts as ad revenue; the name estimate never does.
  assert.deepEqual(report.verifiedAds.map((a) => [a.adId, a.orderCount, a.paidAmount]), [["120251125886880277", 1, 10000]]);
});
