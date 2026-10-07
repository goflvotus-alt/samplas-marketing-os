import test from "node:test";
import assert from "node:assert/strict";
import { internalIdentityCode } from "../scripts/cafe24-code-reuse.mjs";
import { planInternalRekey } from "../scripts/identity-rekey.mjs";

const live = [{ brand_code: "B0000BDM", brand_name: "PRAYING" }, { brand_code: "B0000BEI", brand_name: "BLUEMARBLE" }];
const collab = { brand_code: "B0000COL", brand_name: "MEANTIME X SUNDAYOFFCLUB", name_aliases: ["SOC X MEANTIME", "선데이오프클럽 X 민타임"], instagram_tag: "", active: false, nameSource: "confirmed", sourcing_type: "WHOLESALE" };
const other = { brand_code: "B00000HM", brand_name: "민타임", name_aliases: ["MEANTIME"], active: true, nameSource: "suggested" };
const base = () => ({
  canonical: { updatedAt: "x", brands: [other, collab] },
  policies: { policies: [{ brand_code: "B0000COL", stylist_discount_percent: 10 }, { brand_code: "B00000HM", stylist_discount_percent: 20 }] },
  productRegistry: { entries: [{ id: "p1", brandId: "B0000COL" }, { id: "p2", brandId: "B00000HM" }] },
  cafe24Brands: live,
  input: { code: "B0000COL" },
  now: "2026-10-07T00:00:00.000Z"
});

test("re-keys a minted code above the Cafe24 maximum, keeping everything but the key", () => {
  const plan = planInternalRekey(base());
  const spl = internalIdentityCode("B0000COL", "MEANTIME X SUNDAYOFFCLUB");
  assert.equal(plan.status, "PLANNED");
  assert.equal(plan.identity.brand_code, spl);
  for (const field of ["brand_name", "name_aliases", "active", "nameSource", "sourcing_type"]) assert.deepEqual(plan.identity[field], collab[field]);
  assert.deepEqual(plan.identity.externalCodes, { cafe24: null });
  assert.deepEqual(plan.identity.formerCodes, [{ code: "B0000COL", source: "MARKETING_OS_MINTED", until: null }]);
  assert.deepEqual(plan.canonical.brands[0], other);
  assert.equal(plan.canonical.brands.length, 2);
  assert.deepEqual(plan.policies.policies.map((p) => [p.brand_code, p.stylist_discount_percent]), [[spl, 10], ["B00000HM", 20]]);
  assert.deepEqual(plan.productRegistry.entries.map((e) => e.brandId), [spl, "B00000HM"]);
  // Re-planning the result is a no-op.
  assert.deepEqual(planInternalRekey({ ...base(), canonical: plan.canonical }), { status: "ALREADY_REKEYED", code: "B0000COL", brandCode: spl });
});

test("refuses codes Cafe24 owns or has already passed, and open collisions", () => {
  const issued = { ...base(), cafe24Brands: [...live, { brand_code: "B0000COL", brand_name: "NEW" }] };
  assert.throws(() => planInternalRekey(issued), { code: "CAFE24_OWNED" });
  const passed = { ...base(), cafe24Brands: [...live, { brand_code: "B0000CZZ", brand_name: "LATER" }] };
  assert.throws(() => planInternalRekey(passed), { code: "NOT_AHEAD_OF_CAFE24" });
  assert.throws(() => planInternalRekey({ ...base(), cafe24Brands: [] }), { code: "CAFE24_UNAVAILABLE" });
  assert.throws(() => planInternalRekey({ ...base(), pendingCandidates: [{ status: "PENDING", sourceBrandCode: "B0000COL" }] }), { code: "COLLISION_PENDING" });
  assert.throws(() => planInternalRekey({ ...base(), input: { code: "B0000COL", expectedVersion: "stale" } }), { code: "VERSION_CONFLICT" });
});
