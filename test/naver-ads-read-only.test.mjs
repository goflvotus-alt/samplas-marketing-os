import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { normalizeBrandName } from "../scripts/brand-engine.mjs";

// Execute the real router and Naver functions without service startup (which writes
// work files and loads .env). Only the external transport and clock are replaced.
const source = await readFile(new URL("../intelligence-service.mjs", import.meta.url), "utf8");
function section(start, end) {
  assert.ok(source.includes(start) && source.includes(end));
  return source.slice(source.indexOf(start), source.indexOf(end));
}
const executable = [
  section("export async function handleIntelligenceRequest", "const isDirectRun").replace("export ", ""),
  section("function json(", "async function readProductRegistryJson"),
  // handleNaverAdsReadOnlyRoute/capturingResponse are now also exported (reused by
  // scripts/naver-ads-weekly-report.mjs) — same "export " strip already used above for
  // handleIntelligenceRequest, since vm.runInNewContext executes this as a plain script,
  // not an ES module, and can't parse the `export` keyword.
  section("async function handleNaverSearchRoute", "function brandIntelligencePeriod").replaceAll("export ", "")
].join("\n");
const credentials = {
  NAVER_ADS_API_KEY: "test-key-private",
  NAVER_ADS_SECRET_KEY: "test-secret-private",
  NAVER_ADS_CUSTOMER_ID: "987654321"
};
const campaign = { nccCampaignId: "cmp-1", name: "SAMPLAS", campaignTp: "WEB_SITE", status: "ELIGIBLE", deliveryMethod: "STANDARD", dailyBudget: 999, customerId: "987654321" };
const row = { id: "cmp-1", impCnt: 1000, clkCnt: 20, salesAmt: 10000, ccnt: 4, convAmt: 50000 };
const zero = { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0, ctr: null, cpc: null, conversionRate: null, cpa: null, roas: null };
const jsonResponse = value => new Response(JSON.stringify(value));
function harness({ configured = true, upstream, baseUrl = "https://api.searchad.naver.com" } = {}) {
  const calls = [], logs = [], signatures = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ["2026-09-25T16:00:00Z"])); }
    static now() { return Date.parse("2026-09-25T16:00:00Z"); }
  }
  const context = {
    env: configured ? credentials : {}, host: "localhost", port: 8797,
    naverAdsBaseUrl: baseUrl, naverAdsTimeoutMs: 20, intelligenceRequestTimeoutMs: 1000,
    createHmac, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, Date: Clock,
    normalizeBrandName, safeErrorMessage: e => String(e?.message || e),
    console: { error: (...args) => logs.push(args.join(" ")) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      signatures.push(options.headers["X-Signature"]);
      return upstream ? upstream(url, options) : jsonResponse(url.pathname === "/ncc/campaigns" ? [campaign] : { data: [row] });
    }
  };
  runInNewContext(executable, context);
  return {
    calls, logs,
    async request(path, method = "GET") {
      let status, body;
      const res = { writeHead(code) { status = code; }, end(text) { body = JSON.parse(text); } };
      await context.handleIntelligenceRequest({ url: path, method, headers: { host: "localhost" } }, res);
      // Assert outside the production catch, so a signing/method assertion cannot
      // be swallowed and mistaken for the safe upstream failure being tested.
      for (const { url, options } of calls) {
        assert.equal(options.method, "GET");
        assert.ok(["/ncc/campaigns", "/stats", "/keywordstool"].includes(url.pathname));
        if (url.pathname !== "/keywordstool") assert.equal(options.redirect, "error");
        const h = options.headers;
        assert.equal(h["X-API-KEY"], credentials.NAVER_ADS_API_KEY);
        assert.equal(h["X-Customer"], credentials.NAVER_ADS_CUSTOMER_ID);
        assert.equal(h["X-Signature"], createHmac("sha256", credentials.NAVER_ADS_SECRET_KEY)
          .update(`${h["X-Timestamp"]}.GET.${url.pathname}`).digest("base64"));
      }
      const output = JSON.stringify({ body, logs });
      for (const secret of [...Object.values(credentials), ...signatures]) assert.ok(!output.includes(secret), "credential or signature leaked");
      return { status, body };
    }
  };
}
const prefix = "/api/intelligence/naver/ads/";

test("health masks customer and campaigns expose only normalized fields", async () => {
  const h = harness();
  assert.deepEqual(await h.request(prefix + "health"), { status: 200, body: { ok: true, configured: true, connected: true, customerId: "******4321", campaignCount: 1 } });
  assert.deepEqual(await h.request(prefix + "campaigns"), { status: 200, body: { ok: true, count: 1, campaigns: [{ id: "cmp-1", name: "SAMPLAS", campaignType: "WEB_SITE", status: "ELIGIBLE", deliveryMethod: "STANDARD" }] } });
});

test("missing credentials return 503 without upstream calls", async () => {
  const h = harness({ configured: false });
  for (const endpoint of ["health", "campaigns", "performance"]) {
    const result = await h.request(prefix + endpoint);
    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
    if (endpoint === "health") { assert.equal(result.body.configured, false); assert.equal(result.body.connected, false); }
  }
  assert.equal(h.calls.length, 0);
});

test("invalid, empty, duplicate, reversed and over-92-day periods return 400", async () => {
  const h = harness();
  for (const query of ["since=bad", "since=2026-02-30", "since=2026-2-01", "since=", "until=", "since=2026-09-02&until=2026-09-01", "since=2026-01-01&until=2026-04-03", "since=2026-09-01&since=2026-09-02", "until=2026-13-01"]) {
    assert.equal((await h.request(prefix + "performance?" + query)).status, 400, query);
  }
  assert.equal(h.calls.length, 0);
});

test("performance uses KST dates, requested fields and weighted summary ratios", async () => {
  const h = harness({ upstream: url => jsonResponse(url.pathname === "/ncc/campaigns" ? [campaign, { ...campaign, nccCampaignId: "cmp-2", name: "Second" }] : { data: [row, { id: "cmp-2", impCnt: "1000", clkCnt: "80", salesAmt: "30000", ccnt: "6", convAmt: "70000" }] }) });
  const { status, body } = await h.request(prefix + "performance");
  assert.equal(status, 200);
  assert.equal(body.since, "2026-09-01"); assert.equal(body.until, "2026-09-26");
  assert.deepEqual(body.summary, { impressions: 2000, clicks: 100, spend: 40000, conversions: 10, conversionValue: 120000, ctr: 5, cpc: 400, conversionRate: 10, cpa: 4000, roas: 3 });
  assert.deepEqual(body.campaigns[0], { campaignId: "cmp-1", campaignName: "SAMPLAS", impressions: 1000, clicks: 20, spend: 10000, conversions: 4, conversionValue: 50000, ctr: 2, cpc: 500, conversionRate: 20, cpa: 2500, roas: 5 });
  const query = h.calls[1].url.searchParams;
  assert.equal(query.get("ids"), "cmp-1,cmp-2");
  assert.deepEqual(JSON.parse(query.get("timeRange")), { since: "2026-09-01", until: "2026-09-26" });
  assert.deepEqual(JSON.parse(query.get("fields")), ["impCnt", "clkCnt", "salesAmt", "ccnt", "convAmt"]);
  assert.equal(query.get("timeIncrement"), "allDays");
  assert.equal(body.metadata.timezone, "Asia/Seoul");
  assert.ok(body.metadata.conversionAttribution);
});

test("zero denominators are null and empty accounts need no stats request", async () => {
  const h = harness({ upstream: url => jsonResponse(url.pathname === "/ncc/campaigns" ? [campaign] : { data: [{ id: "cmp-1", impCnt: 0, clkCnt: 0, salesAmt: 0, ccnt: 0, convAmt: 0 }] }) });
  assert.deepEqual((await h.request(prefix + "performance?since=2026-09-01&until=2026-09-01")).body.summary, zero);
  const empty = harness({ upstream: () => jsonResponse([]) });
  const result = await empty.request(prefix + "performance");
  assert.equal(result.status, 200); assert.deepEqual(result.body.summary, zero); assert.deepEqual(result.body.campaigns, []);
  assert.equal(empty.calls.length, 1);
});

test("missing metrics stay null; malformed statistics cannot silently become zero", async () => {
  const h = harness({ upstream: url => jsonResponse(url.pathname === "/ncc/campaigns" ? [campaign] : { data: [{ id: "cmp-1", impCnt: 10, clkCnt: 1, salesAmt: 100 }] }) });
  const result = await h.request(prefix + "performance");
  assert.equal(result.status, 200);
  for (const key of ["conversions", "conversionValue", "cpa", "conversionRate", "roas"]) assert.equal(result.body.summary[key], null);
  for (const payload of [{}, { data: [] }, { data: [row, row] }, { data: [{ ...row, impCnt: "bad" }] }]) {
    const broken = harness({ upstream: url => jsonResponse(url.pathname === "/ncc/campaigns" ? [campaign] : payload) });
    assert.equal((await broken.request(prefix + "performance")).status, 502);
  }
});

test("upstream 401/403/5xx and echoed secrets are safely contained on every route", async () => {
  for (const code of [401, 403, 500, 503]) for (const endpoint of ["health", "campaigns", "performance"]) {
    const h = harness({ upstream: (_url, options) => new Response(JSON.stringify({ message: Object.values(credentials).join(" ") + options.headers["X-Signature"] }), { status: code }) });
    const result = await h.request(prefix + endpoint);
    assert.equal(result.status, 502); assert.equal(result.body.ok, false);
    if (endpoint === "health") { assert.equal(result.body.configured, true); assert.equal(result.body.connected, false); }
    assert.deepEqual(h.logs, []);
  }
});

test("invalid JSON, invalid campaign payload and network errors are safe", async () => {
  for (const upstream of [() => new Response("not json " + credentials.NAVER_ADS_SECRET_KEY), () => jsonResponse({}), () => jsonResponse([{}]), () => { throw new Error(credentials.NAVER_ADS_SECRET_KEY); }]) {
    const h = harness({ upstream });
    assert.equal((await h.request(prefix + "campaigns")).status, 502);
    assert.deepEqual(h.logs, []);
  }
  const h = harness({ baseUrl: "invalid " + credentials.NAVER_ADS_SECRET_KEY });
  assert.equal((await h.request(prefix + "health")).status, 502);
  assert.deepEqual(h.logs, []);
});

test("timeout aborts transport and body read without exposing exception details", async () => {
  for (const bodyTimeout of [false, true]) {
    const h = harness({ upstream: (_url, options) => {
      const pending = () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error(credentials.NAVER_ADS_SECRET_KEY), { name: "AbortError" })), { once: true }));
      return bodyTimeout ? { ok: true, status: 200, text: pending } : pending();
    } });
    const result = await h.request(prefix + "health");
    assert.equal(result.status, 502); assert.match(result.body.error, /timed out/);
    assert.equal(h.calls[0].options.signal.aborted, true); assert.deepEqual(h.logs, []);
  }
});

test("new routes reject non-GET methods before contacting Naver", async () => {
  const h = harness();
  for (const endpoint of ["health", "campaigns", "performance"]) for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
    assert.equal((await h.request(prefix + endpoint, method)).status, 405);
  }
  assert.equal(h.calls.length, 0);
});

test("existing keyword search keeps normalization, signing and error behavior", async () => {
  const h = harness({ upstream: () => jsonResponse({ keywordList: [{ relKeyword: "SAMPLAS", monthlyPcQcCnt: "1,200", monthlyMobileQcCnt: "< 10", monthlyAvePcClkCnt: 3 }] }) });
  const result = await h.request("/api/intelligence/naver/search?keyword=SAM%20PLAS");
  assert.equal(result.status, 200); assert.equal(result.body.source, "naver-searchad-keywordstool");
  assert.equal(result.body.rows[0].monthlyPcQueryCount, 1200); assert.equal(result.body.rows[0].monthlyMobileQueryCount, null);
  assert.equal(h.calls[0].url.searchParams.get("hintKeywords"), "SAMPLAS");
  assert.equal(h.calls[0].url.searchParams.get("showDetail"), "1");
  assert.equal((await h.request("/api/intelligence/naver/search")).status, 400);
  assert.equal((await harness({ configured: false }).request("/api/intelligence/naver/search?keyword=x")).status, 503);
  assert.equal((await harness({ upstream: () => new Response("bad", { status: 403 }) }).request("/api/intelligence/naver/search?keyword=x")).status, 502);
});


test("100-ID batches include all campaigns and stats failure never returns partial totals", async () => {
  const list = Array.from({ length: 101 }, (_, i) => ({ ...campaign, nccCampaignId: `cmp-${i}` }));
  for (const failure of [false, true]) {
    const h = harness({ upstream: (url, options) => {
      if (url.pathname === "/ncc/campaigns") return jsonResponse(list);
      if (failure && url.searchParams.get("ids") === "cmp-100") return new Response(credentials.NAVER_ADS_SECRET_KEY + options.headers["X-Signature"], { status: 403 });
      return jsonResponse({ data: url.searchParams.get("ids").split(",").map(id => ({ ...row, id })) });
    } });
    const result = await h.request(prefix + "performance");
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls[1].url.searchParams.get("ids").split(",").length, 100);
    assert.equal(h.calls[2].url.searchParams.get("ids"), "cmp-100");
    assert.equal(result.status, failure ? 502 : 200);
    if (failure) assert.equal(result.body.summary, undefined);
    else { assert.equal(result.body.campaigns.length, 101); assert.equal(result.body.summary.spend, 1010000); }
  }
});

test("valid leap dates and the inclusive 92-day boundary are accepted", async () => {
  const h = harness();
  for (const query of ["since=2024-02-29&until=2024-02-29", "since=2026-07-01&until=2026-09-30"]) {
    const result = await h.request(prefix + "performance?" + query);
    assert.equal(result.status, 200);
    const params = new URLSearchParams(query);
    assert.equal(result.body.since, params.get("since")); assert.equal(result.body.until, params.get("until"));
  }
});
