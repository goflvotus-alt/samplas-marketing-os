import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
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

function harness({ meta, naver } = {}) {
  const metaCalls = [], naverCalls = [];
  const context = {
    fromMetaAds, fromNaverAds,
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
  assert.equal(body.actualCommerce, null);
  assert.deepEqual(body.notes, []);
});

test("Meta fails, Naver stays available", async () => {
  const h = harness({ meta: { ok: false, message: "internal upstream detail" }, naver: naverOk });
  const { body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(body.channels[0].channel, "meta"); assert.equal(body.channels[0].status, "unavailable");
  assert.equal(body.channels[1].channel, "naver"); assert.equal(body.channels[1].status, "available");
  assert.equal(body.actualCommerce, null);
});

test("Naver fails (thrown), Meta stays available", async () => {
  const h = harness({ meta: { ok: true, data: metaOk }, naver: () => { throw new Error("secret-token-abc123 leaked path"); } });
  const { body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(body.channels[0].channel, "meta"); assert.equal(body.channels[0].status, "available");
  assert.equal(body.channels[1].channel, "naver"); assert.equal(body.channels[1].status, "unavailable");
  assert.ok(!JSON.stringify(body).includes("secret-token-abc123"), "thrown error text must never reach the response");
  assert.equal(body.actualCommerce, null);
});

test("both channels fail: overview still returns 200 with two unavailable channels", async () => {
  const h = harness({ meta: { ok: false, message: "x" }, naver: { ok: false, error: "Naver Search Ads credentials are not configured" } });
  const { status, body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(status, 200);
  assert.equal(body.channels[0].status, "unavailable");
  assert.equal(body.channels[1].status, "unavailable");
  assert.equal(body.actualCommerce, null);
});

test("Meta and Naver receive the identical since/until", async () => {
  const h = harness({ meta: { ok: true, data: metaOk }, naver: naverOk });
  await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(h.metaCalls.length, 1);
  assert.ok(h.metaCalls[0].includes("since=2026-09-01") && h.metaCalls[0].includes("until=2026-09-07"));
  assert.equal(h.naverCalls.length, 1);
  assert.equal(h.naverCalls[0].since, "2026-09-01"); assert.equal(h.naverCalls[0].until, "2026-09-07");
});

test("Cafe24 actual commerce is not connected in this Phase", async () => {
  const h = harness({ meta: { ok: true, data: metaOk }, naver: naverOk });
  const { body } = await h.request("?since=2026-09-01&until=2026-09-07");
  assert.equal(body.actualCommerce, null);
  assert.ok(!("cafe24" in body));
});

test("invalid period is rejected before either channel is called", async () => {
  const h = harness({ meta: { ok: true, data: metaOk }, naver: naverOk });
  const { status, body } = await h.request("?since=bad&until=2026-09-07");
  assert.equal(status, 400); assert.equal(body.ok, false);
  assert.equal(h.metaCalls.length, 0); assert.equal(h.naverCalls.length, 0);
});

test("route dispatch is GET-only and the handler itself takes no request body", () => {
  assert.match(source, /if \(url\.pathname === "\/api\/advertising\/overview"\) \{\s*\n\s*if \(req\.method !== "GET"\) return json\(res, \{ ok: false, error: "Method Not Allowed" \}, 405\);/);
  // handleAdvertisingOverviewRoute(url, res) — no req/body parameter to mutate from.
  assert.match(source, /async function handleAdvertisingOverviewRoute\(url, res\) \{/);
});
