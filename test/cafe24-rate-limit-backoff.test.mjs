import test from "node:test";
import assert from "node:assert/strict";
import { cafe24RateLimitBackoffMs } from "../server.mjs";

// PHASE 5B / Blocker 1 (Store Intelligence reliability): Production logs
// (/api/diagnostics/logs, 2026-09-06) showed every recent cafe24_product_on_demand
// failure was status 429 "Too much requests occur. (40/40)" — the old cafe24FetchJson
// retried a 429 exactly once after 1.2s, which was proven too short for a burst of
// ~100 on-demand product lookups (ensureCatalogCoversOrderProducts) to clear Cafe24's
// rate-limit window, so a large fraction failed permanently on every request. This
// tests the extracted pure backoff decision directly — no fetch/token mocking needed.

test("first three 429s get an increasing backoff delay", () => {
  assert.equal(cafe24RateLimitBackoffMs(0), 1200);
  assert.equal(cafe24RateLimitBackoffMs(1), 2400);
  assert.equal(cafe24RateLimitBackoffMs(2), 3600);
});

test("gives up (returns null) after the max retry count, same as the prior single-retry behavior did after its one retry", () => {
  assert.equal(cafe24RateLimitBackoffMs(3), null);
  assert.equal(cafe24RateLimitBackoffMs(4), null);
  assert.equal(cafe24RateLimitBackoffMs(100), null);
});
