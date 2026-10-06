import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ALLOWED_UPSTREAM_PATHS, ToolError, assertSafeUpstreamRequest, capPayload, createUpstream, envelope } from "../scripts/mcp/upstream.mjs";

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}
const send = (res, status, body, type = "application/json") => { res.writeHead(status, { "Content-Type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
async function errorOf(promise) { try { await promise; } catch (e) { return e; } assert.fail("expected rejection"); }

test("only GET to allowlisted paths; no arbitrary URL or path", () => {
  assert.equal(ALLOWED_UPSTREAM_PATHS.size, 10);
  assert.doesNotThrow(() => assertSafeUpstreamRequest("GET", "/api/sales/total"));
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.throws(() => assertSafeUpstreamRequest(method, "/api/sales/total"), /GET only/);
  for (const path of ["/api/pending-brands/review", "/api/ecount/product-sync", "https://evil.example/api/sales/total", "/api/sales/total/../brand-master", "//evil.example/x"]) {
    assert.throws(() => assertSafeUpstreamRequest("GET", path), /not allowed/, path);
  }
});

test("getJson passes query params, maps statuses and never forwards HTML", async () => {
  await withServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/api/sales/total") return send(res, 200, { echo: Object.fromEntries(u.searchParams), method: req.method });
    if (u.pathname === "/api/reports/monthly") return send(res, 400, { error: "Invalid month" });
    if (u.pathname === "/api/brand-master") return send(res, 404, { ok: false, error: "nope" });
    if (u.pathname === "/api/pending-brands") return send(res, 502, "<html><body>Bad Gateway</body></html>", "text/html");
    if (u.pathname === "/api/brands/new") return send(res, 200, "<html>oops</html>", "text/html");
    if (u.pathname === "/api/inventory/overview") return; // hang -> timeout
  }, async (base) => {
    const up = createUpstream({ baseUrl: base, timeoutMs: 300 });
    const ok = await up.getJson("/api/sales/total", { since: "2026-09-01", until: "2026-09-30", store: undefined });
    assert.deepEqual(ok, { echo: { since: "2026-09-01", until: "2026-09-30" }, method: "GET" });
    const bad = await errorOf(up.getJson("/api/reports/monthly", { month: "x" }));
    assert.equal(bad.code, "VALIDATION_FAILED"); assert.equal(bad.message, "Invalid month");
    assert.equal((await errorOf(up.getJson("/api/brand-master"))).code, "NOT_FOUND");
    for (const path of ["/api/pending-brands", "/api/brands/new"]) {
      const e = await errorOf(up.getJson(path));
      assert.equal(e.code, "UPSTREAM_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(e.toJSON()), /html/i);
    }
    const slow = await errorOf(up.getJson("/api/inventory/overview", { limit: 1 }));
    assert.equal(slow.code, "UPSTREAM_UNAVAILABLE"); assert.equal(slow.retryable, true); assert.match(slow.message, /timed out/);
  });
});

test("connection refused maps to UPSTREAM_UNAVAILABLE", async () => {
  const up = createUpstream({ baseUrl: "http://127.0.0.1:1", timeoutMs: 500 });
  const e = await errorOf(up.getJson("/api/sales/total"));
  assert.equal(e.code, "UPSTREAM_UNAVAILABLE");
});

test("envelope adds COVERAGE_INCOMPLETE note unless complete", () => {
  const full = envelope("t", { a: 1 }, { source: "/api/x", completeness: "COMPLETE" });
  assert.deepEqual(full.meta.notes, []);
  assert.equal(full.ok, true);
  const part = envelope("t", {}, { source: "/api/x", completeness: "PARTIAL", notes: ["partial months: 2026-09"] });
  assert.match(part.meta.notes[0], /^COVERAGE_INCOMPLETE/);
  assert.equal(part.meta.dataAsOf, null);
  assert.deepEqual(new ToolError("NOT_FOUND", "x").toJSON(), { ok: false, error: { code: "NOT_FOUND", message: "x", retryable: false, details: {} } });
});

test("capPayload trims the largest array under the byte limit and says so", () => {
  const big = envelope("t", { items: Array.from({ length: 14746 }, (_, i) => ({ i, name: "x".repeat(40) })), small: [1, 2] }, { source: "/api/x", completeness: "COMPLETE" });
  const out = capPayload(big, 200_000);
  assert.ok(JSON.stringify(out).length <= 200_000);
  assert.ok(out.data.items.length < 14746);
  assert.deepEqual(out.data.small, [1, 2]);
  assert.match(out.meta.notes.at(-1), /^truncated: items \d+ of 14746/);
});
