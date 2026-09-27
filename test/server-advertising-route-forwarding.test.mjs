import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Minimal, source-extraction-based check (same technique already used across this repo's
// test suite) for the production forwarding guard in server.mjs that decides which paths
// reach handleIntelligenceRequest. This does not start the real HTTP server or touch
// intelligence-service.mjs — it evaluates the REAL guard expression text as written in
// server.mjs, so a future edit to this condition is caught here even if nobody remembers
// to update a hand-written duplicate.
const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

const start = source.indexOf('url.pathname.startsWith("/api/intelligence/")');
assert.notEqual(start, -1, "forwarding guard start marker missing");
const end = source.indexOf('"/api/advertising/overview"', start) + '"/api/advertising/overview"'.length;
assert.ok(end > start, "forwarding guard end marker missing");
const guardExpression = source.slice(start, end);

const matchesGuard = new Function("url", `return (${guardExpression});`);

test("GET /api/advertising/overview is forwarded to handleIntelligenceRequest", () => {
  assert.equal(matchesGuard({ pathname: "/api/advertising/overview" }), true);
});

test("existing /api/inventory/overview forwarding is unchanged", () => {
  assert.equal(matchesGuard({ pathname: "/api/inventory/overview" }), true);
});

test("existing /api/intelligence/* and /api/inventory/intelligence/* forwarding is unchanged", () => {
  assert.equal(matchesGuard({ pathname: "/api/intelligence/store" }), true);
  assert.equal(matchesGuard({ pathname: "/api/inventory/intelligence/anything" }), true);
});

test("unrelated paths are not newly swept into the guard", () => {
  assert.equal(matchesGuard({ pathname: "/api/advertising" }), false);
  assert.equal(matchesGuard({ pathname: "/api/advertising/overview/extra" }), false);
  assert.equal(matchesGuard({ pathname: "/api/meta-ads/summary" }), false);
});
