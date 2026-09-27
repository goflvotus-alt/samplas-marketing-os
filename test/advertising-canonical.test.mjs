import test from "node:test";
import assert from "node:assert/strict";
import { fromMetaAds, fromNaverAds, aggregateAdvertising } from "../scripts/advertising-canonical.mjs";

const period = { since: "2026-09-19", until: "2026-09-25" };
const metaRow = { spend: 100, impressions: 1000, reach: 700, clicks: 20, purchases: 2, purchaseValue: 400 };
const naverRow = { spend: 100, impressions: 1000, clicks: 20, conversions: 2, conversionValue: 400, ctr: 2, conversionRate: 10, roas: 4 };
const meta = row => ({ source: "meta_marketing_api", ...period, totals: row });
const naver = row => ({ ok: true, ...period, summary: row, campaigns: [], metadata: { source: "naver-searchad-stats", timezone: "Asia/Seoul" } });
const options = { currency: "KRW", timezone: "Asia/Seoul" };

test("Meta summary and full-report map platform purchases and values", () => {
  const a = fromMetaAds(meta(metaRow), options);
  const b = fromMetaAds({ source: "meta_marketing_api", ...period, rows: [metaRow] }, options);
  for (const row of [a, b]) {
    assert.equal(row.schemaVersion, 1); assert.equal(row.channel, "meta");
    assert.equal(row.platformConversions, 2); assert.equal(row.platformConversionValue, 400);
    assert.equal(row.ctr, 0.02); assert.equal(row.cpc, 5); assert.equal(row.cpm, 100);
    assert.equal(row.platformConversionRate, 0.1); assert.equal(row.platformCpa, 50); assert.equal(row.platformRoas, 4);
    assert.equal(row.currency, "KRW"); assert.equal(row.attribution.source, "meta");
  }
  assert.equal(fromMetaAds(meta(metaRow)).currency, null);
});

test("Naver performance maps its summary without summing summary and campaigns", () => {
  const input = naver(naverRow); input.campaigns = [{ ...naverRow, campaignId: "one" }];
  const row = fromNaverAds(input, options);
  assert.equal(row.channel, "naver"); assert.equal(row.source, "naver-searchad-stats");
  assert.equal(row.spend, 100); assert.equal(row.platformConversions, 2);
  assert.equal(row.platformConversionValue, 400); assert.equal(row.cpm, 100);
  assert.equal(row.reach, null); assert.equal(row.period.timezone, "Asia/Seoul");
});

test("zero stays zero, missing/invalid values stay null, and failed input is unavailable", () => {
  const zero = fromNaverAds(naver({ ...naverRow, conversions: 0, conversionValue: 0 }), options);
  assert.equal(zero.platformConversions, 0); assert.equal(zero.platformConversionValue, 0);
  assert.equal(zero.platformRoas, 0);
  const missing = fromNaverAds(naver({ ...naverRow, conversions: null, conversionValue: "" }), options);
  assert.equal(missing.platformConversions, null); assert.equal(missing.platformConversionValue, null);
  assert.equal(missing.platformRoas, null); assert.equal(missing.status, "partial");
  for (const value of [true, {}, "bad", Infinity]) assert.equal(fromNaverAds(naver({ ...naverRow, spend: value }), options).spend, null);
  assert.equal(fromNaverAds(naver({ ...naverRow, spend: "100.50" }), options).spend, 100.5);
  assert.equal(fromMetaAds({ error: "upstream error" }).status, "unavailable");
  assert.equal(fromNaverAds({ ok: false, summary: naverRow }).spend, null);
  assert.equal(fromMetaAds({ ...period, rows: [] }, options).status, "empty");
});

test("Naver percent rates become ratios and reported values retain provenance", () => {
  const row = fromNaverAds(naver(naverRow), options);
  assert.equal(row.ctr, 0.02); assert.equal(row.platformConversionRate, 0.1);
  assert.equal(row.extensions.reportedRates.ctr, 0.02);
  assert.equal(row.extensions.reportedRates.platformConversionRate, 0.1);
  assert.equal(row.extensions.metricOrigins.ctr, "derived");
  assert.equal(row.extensions.metricOrigins.spend, "platform");
});

test("zero denominators yield null rates and costs", () => {
  const row = fromNaverAds(naver({ spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }), options);
  for (const key of ["ctr", "cpc", "cpm", "platformConversionRate", "platformCpa", "platformRoas"]) assert.equal(row[key], null, key);
});

test("aggregation sums base metrics and recalculates rates instead of averaging", () => {
  const a = fromMetaAds(meta(metaRow), options);
  const b = fromMetaAds(meta({ ...metaRow, spend: 900, impressions: 9000, clicks: 30, purchases: 3, purchaseValue: 600 }), options);
  const result = aggregateAdvertising([a, b]);
  assert.equal(result.spend, 1000); assert.equal(result.ctr, 0.005); assert.equal(result.cpc, 20);
  assert.equal(result.cpm, 100); assert.equal(result.platformCpa, 200); assert.equal(result.platformRoas, 1);
  assert.equal(aggregateAdvertising([a, { ...b, platformConversionValue: null }]).platformConversionValue, null);
  assert.throws(() => aggregateAdvertising([a, fromNaverAds(naver(naverRow), options)]));
  assert.throws(() => aggregateAdvertising([a, { ...b, currency: "USD" }]));
  assert.throws(() => aggregateAdvertising([a, { ...b, period: { ...b.period, until: "2026-09-26" } }]));
  assert.throws(() => aggregateAdvertising([]));
});

test("reach is never summed or mistaken for channel unique reach", () => {
  const a = fromMetaAds(meta(metaRow), options);
  const b = fromMetaAds({ ...period, rows: [metaRow, metaRow] }, options);
  assert.equal(a.reach, null); assert.equal(b.reach, null);
  assert.equal(aggregateAdvertising([a, a]).reach, null);
});

test("Meta conflicting aliases raise an issue instead of choosing silently", () => {
  const row = fromMetaAds(meta({ ...metaRow, metaPurchases: 3, metaPurchaseValue: 500 }), options);
  assert.equal(row.platformConversions, null); assert.equal(row.platformConversionValue, null);
  assert.ok(row.issues.includes("alias_conflict:platformConversions"));
  assert.ok(row.issues.includes("alias_conflict:platformConversionValue"));
  const aliases = fromMetaAds(meta({ spend: 100, impressions: 1000, clicks: 20, metaPurchases: 0, metaPurchaseValue: 0 }), options);
  assert.equal(aliases.platformConversions, 0); assert.equal(aliases.platformConversionValue, 0);
});

test("actual commerce cannot enter platform conversion values or ROAS", () => {
  const row = fromMetaAds(meta({ ...metaRow, actualRevenue: 900000, revenue: 800000, actualOrders: 500 }), options);
  assert.equal(row.platformConversionValue, 400); assert.equal(row.platformRoas, 4);
  assert.equal("actualRevenue" in row, false); assert.equal("revenue" in row, false);
  assert.equal(fromMetaAds(meta({ spend: 100, actualRevenue: 900000 }), options).platformConversionValue, null);
});

test("adapters and aggregation do not mutate inputs", () => {
  function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const m = freeze(meta(metaRow)), n = freeze(naver(naverRow));
  const before = JSON.stringify([m, n]);
  const a = freeze(fromMetaAds(m, freeze({ ...options })));
  fromNaverAds(n, options);
  const canonicalBefore = JSON.stringify(a);
  const result = aggregateAdvertising([a, a]); result.issues.push("caller-change"); result.period.since = "changed";
  assert.equal(JSON.stringify([m, n]), before); assert.equal(JSON.stringify(a), canonicalBefore);
});
