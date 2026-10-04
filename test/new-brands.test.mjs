import test from "node:test";
import assert from "node:assert/strict";
import { buildNewBrands, daysSince, onboardingDates } from "../scripts/new-brands.mjs";

const asOf = new Date("2026-10-04T12:00:00+09:00");
// approvedAt N KST calendar days before asOf (late evening, to exercise the KST day boundary).
const daysAgo = n => new Date(Date.parse("2026-10-04T23:30:00+09:00") - n * 86_400_000).toISOString();
const approved = (code, approvedAt, approvalAction = "NEW") => ({ id: code, status: "APPROVED", approvalAction, canonicalBrandCode: code, approvedAt });
const brand = (code, name, extra = {}) => ({ brand_code: code, brand_name: name, active: true, sourcing_type: "WHOLESALE", ...extra });

test("day boundaries: approval day is 0, day 89 is the last NEW day, 90 and later are not NEW", () => {
  assert.equal(daysSince("2026-10-04T00:10:00+09:00", asOf), 0);
  assert.equal(daysSince("2026-10-03T23:59:00+09:00", asOf), 1, "KST calendar day, not 24h windows");
  const brands = [0, 1, 89, 90, 91].map(n => brand(`B${n}`, `Brand ${n}`));
  const queue = { candidates: [0, 1, 89, 90, 91].map(n => approved(`B${n}`, daysAgo(n))) };
  const result = buildNewBrands({ brands, queue, asOf });
  assert.deepEqual(result.brands.map(b => [b.brandCode, b.daysSinceOnboarding]), [["B0", 0], ["B1", 1], ["B89", 89]]);
  assert.equal(result.windowDays, 90);
  assert.equal(result.asOf, "2026-10-04");
  assert.equal(result.dateSource, "pending-brand-queue.approvedAt");
});

test("inactive brands and brands without an approvedAt are never NEW", () => {
  const brands = [brand("B1", "Inactive", { active: false }), brand("B2", "No record"), brand("B3", "Bad date"), brand("B4", "Linked only"), brand("B5", "Pending")];
  const queue = { candidates: [approved("B1", daysAgo(1)), approved("B3", "not-a-date"), { ...approved("B4", daysAgo(1)), approvalAction: "LINK", status: "LINKED" },
    { ...approved("B4", daysAgo(1)), approvalAction: "CONFIRM_EXISTING" }, { ...approved("B5", daysAgo(1)), status: "PENDING" }] };
  assert.equal(buildNewBrands({ brands, queue, asOf }).count, 0);
});

test("earliest creating approval wins; inactive-code reassignment counts as onboarding", () => {
  const dates = onboardingDates({ candidates: [approved("B1", daysAgo(3)), approved("B1", daysAgo(10)), approved("MANUAL_x", daysAgo(2), "REASSIGN_INACTIVE_CODE")] });
  assert.equal(dates.get("B1").approvedAt, daysAgo(10));
  assert.equal(dates.get("MANUAL_x").approvalAction, "REASSIGN_INACTIVE_CODE");
});

test("rows carry naver-ready identifiers and the existing commercial-policy result", () => {
  const policies = new Map([["B0000BDV", { status: "SOURCING_DEFAULT", discountPercent: 20 }], ["B00000MT", { status: "EXPLICIT_POLICY", discountPercent: 10 }]]);
  const result = buildNewBrands({ brands: [brand("B0000BDV", "RECORDS INC"), brand("B00000MT", "AE SYNCTX", { sourcing_type: "HYBRID" })],
    queue: { candidates: [approved("B0000BDV", "2026-10-04T05:38:15.499Z"), approved("B00000MT", daysAgo(5))] }, asOf, policies });
  assert.deepEqual(result.brands[0], {
    brandCode: "B0000BDV", brandName: "RECORDS INC", normalizedBrandName: "records inc", approvedAt: "2026-10-04T05:38:15.499Z", approvalAction: "NEW",
    daysSinceOnboarding: 0, isNew: true, active: true, sourcingType: "WHOLESALE", commercialPolicyStatus: "SOURCING_DEFAULT", stylistDiscountPercent: 20
  });
  assert.deepEqual([result.brands[1].commercialPolicyStatus, result.brands[1].stylistDiscountPercent, result.brands[1].sourcingType], ["EXPLICIT_POLICY", 10, "HYBRID"]);
});
