// NEW BRANDS: active brands onboarded within the last 90 days. The onboarding date is the
// pending-brand-queue approval (`approvedAt`) that created the canonical brand; Brand Master
// itself stores no per-brand date. Brands without such a record are never guessed as NEW.
import { normalizeBrandKey } from "./brand-engine.mjs";

export const NEW_BRAND_WINDOW_DAYS = 90;
const CREATING_ACTIONS = new Set(["NEW", "REASSIGN_INACTIVE_CODE"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const kstDay = date => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);

// Earliest creating approval per canonical brand code.
export function onboardingDates(queue) {
  const dates = new Map();
  for (const c of queue?.candidates || []) {
    if (c.status !== "APPROVED" || !CREATING_ACTIONS.has(c.approvalAction) || !c.canonicalBrandCode) continue;
    if (Number.isNaN(Date.parse(c.approvedAt))) continue;
    const prior = dates.get(c.canonicalBrandCode);
    if (!prior || c.approvedAt < prior.approvedAt) dates.set(c.canonicalBrandCode, { approvedAt: c.approvedAt, approvalAction: c.approvalAction });
  }
  return dates;
}

// Calendar days in KST: approval day = 0. NEW while 0 <= days < windowDays (day 89 is the last).
export function daysSince(approvedAt, asOf) {
  return Math.round((Date.parse(kstDay(asOf)) - Date.parse(kstDay(new Date(approvedAt)))) / DAY_MS);
}

export function buildNewBrands({ brands = [], queue, asOf = new Date(), windowDays = NEW_BRAND_WINDOW_DAYS, policies = new Map() }) {
  const dates = onboardingDates(queue);
  const rows = [];
  for (const brand of brands) {
    const onboarding = dates.get(brand.brand_code);
    if (!onboarding || brand.active === false) continue;
    const daysSinceOnboarding = daysSince(onboarding.approvedAt, asOf);
    if (daysSinceOnboarding < 0 || daysSinceOnboarding >= windowDays) continue;
    const policy = policies.get(brand.brand_code) || {};
    rows.push({
      brandCode: brand.brand_code,
      brandName: brand.brand_name,
      normalizedBrandName: normalizeBrandKey(brand.brand_name),
      approvedAt: onboarding.approvedAt,
      approvalAction: onboarding.approvalAction,
      daysSinceOnboarding,
      isNew: true,
      active: brand.active !== false,
      sourcingType: brand.sourcing_type ?? policy.sourcingType ?? null,
      commercialPolicyStatus: policy.status ?? null,
      stylistDiscountPercent: policy.discountPercent ?? null
    });
  }
  rows.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt) || a.brandName.localeCompare(b.brandName));
  return { asOf: kstDay(asOf), windowDays, dateSource: "pending-brand-queue.approvedAt", count: rows.length, brands: rows };
}
