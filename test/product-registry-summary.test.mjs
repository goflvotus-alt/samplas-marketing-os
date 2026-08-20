import test from "node:test";
import assert from "node:assert/strict";
import { recomputeProductRegistrySummary } from "../scripts/product-registry-summary.mjs";

test("Product Registry summary recomputes entry-derived aggregates and preserves external-semantics fields", () => {
  const entries = [
    {
      brandName: "Brand A",
      status: "confirmed",
      verified: true,
      confidence: 100
    },
    {
      brandName: "Brand A",
      status: "ambiguous",
      verified: false,
      confidence: 95
    },
    {
      brandId: "B-B",
      status: "ambiguous",
      verified: false,
      confidence: 78
    },
    {
      status: "unmatched",
      verified: false,
      confidence: 0
    }
  ];

  const summary = recomputeProductRegistrySummary(entries, {
    registryCount: 999,
    verifiedCount: 999,
    reviewQueueCount: 727,
    cafe24AnchorCoverage: {
      cafe24AnchorCount: 824,
      registryAnchorCount: 824,
      missingCafe24Anchors: [],
      duplicateCafe24Anchors: []
    }
  });

  assert.equal(summary.registryCount, 4);
  assert.equal(summary.verifiedCount, 1);

  assert.deepEqual(summary.confidenceDistribution, {
    "100": 1,
    "95-99": 1,
    "80-94": 0,
    "60-79": 1,
    "0-59": 1
  });

  assert.deepEqual(summary.brandCounts, [
    { brandName: "Brand A", count: 2 },
    { brandName: "B-B", count: 1 },
    { brandName: "UNASSIGNED", count: 1 }
  ]);

  // These fields come from separate source semantics and must not be invented
  // from entries alone.
  assert.equal(summary.reviewQueueCount, 727);
  assert.deepEqual(summary.cafe24AnchorCoverage, {
    cafe24AnchorCount: 824,
    registryAnchorCount: 824,
    missingCafe24Anchors: [],
    duplicateCafe24Anchors: []
  });
});
