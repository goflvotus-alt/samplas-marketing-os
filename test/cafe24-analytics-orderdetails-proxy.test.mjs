import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function fetchCafe24AnalyticsOrderDetailsForDiagnostics(");
assert.notEqual(start, -1, "Analytics diagnostics proxy helper is missing");
const end = source.indexOf("\nasync function fetchCafe24AnalyticsOrderDetails(", start);
const env = { CAFE24_PROXY_BASE_URL: "https://marketing-os.example" };
const cafe24ProxyHeaders = () => ({ Authorization: "Basic test" });
const direct = async (params) => ({ direct: params });
const fetchCafe24AnalyticsOrderDetailsForDiagnostics = new Function(
  "env", "cafe24ProxyHeaders", "fetchCafe24AnalyticsOrderDetails",
  source.slice(start, end) + "\nreturn fetchCafe24AnalyticsOrderDetailsForDiagnostics;"
)(env, cafe24ProxyHeaders, direct);

test("Analytics diagnostics uses configured proxy and safely maps upstream failures", async (t) => {
  const params = { startDate: "2026-11-27", endDate: "2026-11-27", orderId: "20261127-0000042" };
  const payload = { ok: true, data: { orderdetails: [{ order_id: params.orderId, ad: "meta" }] } };
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.origin, "https://marketing-os.example");
    assert.equal(url.pathname, "/api/diagnostics/cafe24-analytics-orderdetails");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      start_date: params.startDate, end_date: params.endDate, order_id: params.orderId
    });
    assert.equal(options.headers.Authorization, "Basic test");
    assert.equal(options.redirect, "error");
    return Response.json(payload);
  });
  assert.deepEqual(await fetchCafe24AnalyticsOrderDetailsForDiagnostics(params), payload);
  fetch.mock.mockImplementation(async () => Response.json({ error: "private value" }, { status: 401 }));
  await assert.rejects(fetchCafe24AnalyticsOrderDetailsForDiagnostics(params), {
    status: 401, message: "Cafe24 Analytics proxy returned HTTP 401"
  });
  fetch.mock.mockImplementation(async () => new Response("private response"));
  await assert.rejects(fetchCafe24AnalyticsOrderDetailsForDiagnostics(params), {
    status: 502, message: "Cafe24 Analytics proxy returned an invalid response"
  });
  delete env.CAFE24_PROXY_BASE_URL;
  assert.deepEqual(await fetchCafe24AnalyticsOrderDetailsForDiagnostics(params), { direct: params });
});
