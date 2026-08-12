import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMergeHistory,
  buildApprovalPreview,
  transitionMasterCandidate
} from "../scripts/master-data-phase1.mjs";

const candidate = {
  id: "client_example",
  canonical_name: "홍길동",
  aliases: ["홍길동님"],
  client_type: "stylist",
  status: "review"
};
const reviewedAt = "2026-07-29T01:00:00.000Z";
const mergedAt = "2026-07-29T02:00:00.000Z";

test("review -> approved -> merged appends immutable history", () => {
  const approved = transitionMasterCandidate(candidate, "approved", { actor: "병구", timestamp: reviewedAt });
  assert.equal(approved.candidate.status, "approved");
  assert.equal(approved.candidate.approvedBy, "병구");

  const merged = transitionMasterCandidate(approved.candidate, "merged", {
    actor: "병구",
    timestamp: mergedAt,
    entityType: "identity",
    currentCanonical: "홍길동 통합",
    mergeReason: "승인된 동일 인물"
  });
  const original = [];
  const history = appendMergeHistory(original, merged.history);

  assert.equal(merged.candidate.status, "merged");
  assert.equal(original.length, 0);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0], {
    entityType: "identity",
    entityId: "client_example",
    previousCanonical: "홍길동",
    currentCanonical: "홍길동 통합",
    timestamp: mergedAt,
    approvedBy: "병구",
    mergeReason: "승인된 동일 인물"
  });
  assert.ok(Object.isFrozen(history));
});

test("approval snapshot clones and freezes master arrays", () => {
  const source = { ...candidate, aliases: [...candidate.aliases] };
  const approved = transitionMasterCandidate(source, "approved", { actor: "병구", timestamp: reviewedAt }).candidate;

  assert.notEqual(approved.aliases, source.aliases);
  assert.ok(Object.isFrozen(approved.aliases));
  source.aliases.push("변경된 원본");
  assert.deepEqual(approved.aliases, ["홍길동님"]);
});

test("review -> rejected remains compatible with Phase 1 candidates", () => {
  const rejected = transitionMasterCandidate(candidate, "rejected", { actor: "병구", timestamp: reviewedAt });
  assert.equal(rejected.candidate.status, "rejected");
  assert.equal(rejected.candidate.reviewedBy, "병구");
  assert.equal(rejected.candidate.approvedAt, null);
  assert.equal(rejected.history, null);
});

test("merge validates entity type, matching identifier, target, and approver", () => {
  const approved = transitionMasterCandidate(candidate, "approved", { actor: "병구", timestamp: reviewedAt }).candidate;
  const merge = (overrides = {}) => transitionMasterCandidate(approved, "merged", {
    actor: "병구",
    timestamp: mergedAt,
    entityType: "identity",
    currentCanonical: "홍길동 통합",
    mergeReason: "승인된 동일 인물",
    ...overrides
  });

  assert.throws(() => merge({ entityType: undefined }), /entityType/);
  assert.throws(() => merge({ entityType: "client" }), /entityType/);
  assert.throws(() => merge({ entityType: "brand" }), /brand_id/);
  assert.throws(() => merge({ currentCanonical: "홍길동" }), /itself/);
  assert.throws(
    () => transitionMasterCandidate({ ...approved, approvedBy: null }, "merged", {
      actor: "병구",
      timestamp: mergedAt,
      entityType: "identity",
      currentCanonical: "홍길동 통합",
      mergeReason: "승인자 누락"
    }),
    /approvedBy/
  );
});

test("approval preview deduplicates affected entities without changing source data", () => {
  const input = {
    orders: [
      { orderId: "A", revenue: 1000 },
      { orderId: "A", revenue: 1000 },
      { orderId: "B", revenue: 2500 }
    ],
    products: [{ productId: "P1" }, { productId: "P1" }, { productId: "P2" }],
    customers: [{ customerId: "C1" }, { customerId: "C2" }, { customerId: "C2" }]
  };

  assert.deepEqual(buildApprovalPreview(input), {
    affectedOrders: 2,
    affectedRevenue: 3500,
    affectedProducts: 2,
    affectedCustomers: 2
  });
  assert.equal(input.orders.length, 3);
});

test("approval preview ignores empty identifiers", () => {
  assert.deepEqual(buildApprovalPreview({
    orders: [{ orderId: null, revenue: 1000 }, { orderId: "", revenue: 2000 }, { orderId: "A", revenue: 3000 }],
    products: [{ productId: undefined }, { productId: " " }, { productId: "P1" }],
    customers: [{ customerId: null }, { customerId: "" }, { customerId: "C1" }]
  }), {
    affectedOrders: 1,
    affectedRevenue: 3000,
    affectedProducts: 1,
    affectedCustomers: 1
  });
});
