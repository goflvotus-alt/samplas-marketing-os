import assert from "node:assert/strict";
import test from "node:test";
import { REVENUE_POLICY, readMasterDataCandidates } from "../scripts/master-data-phase1.mjs";

const expectedFields = {
  identity_master: ["aliases", "canonical_name", "client_type", "id", "status"],
  brand_master: ["aliases", "brand_codes", "brand_id", "canonical_name", "status"],
  product_master: ["brand_id", "cafe24_product_ids", "canonical_name", "ecount_codes", "product_id", "status"]
};

test("Phase 1 master candidates stay read-only and unapproved", async () => {
  const candidates = await readMasterDataCandidates();

  for (const [table, fields] of Object.entries(expectedFields)) {
    assert.ok(candidates[table].length > 0);
    for (const row of candidates[table]) {
      assert.deepEqual(Object.keys(row).sort(), fields);
      assert.equal(row.status, "review");
    }
  }

  assert.deepEqual(REVENUE_POLICY, {
    includeWhen: "isOfflineRevenue === true",
    includeGift: true,
    includeDelivery: true,
    includeBlankCustomer: true,
    includeNegativeReturns: true,
    unclassifiedClientType: "unassigned",
    personalPaymentExclusion: "proven_duplicate_only"
  });
});
