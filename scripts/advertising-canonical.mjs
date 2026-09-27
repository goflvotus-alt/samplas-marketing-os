// Pure response adapters: no imports, network calls, storage, or input mutation.
// Inputs are the existing Meta summary/full-report and Naver Phase 1 responses.
const BASE = ["spend", "impressions", "clicks", "platformConversions", "platformConversionValue"];
const RATES = ["ctr", "cpc", "cpm", "platformConversionRate", "platformCpa", "platformRoas"];

function numeric(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function quotient(numerator, denominator, scale = 1) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator * scale;
  return Number.isFinite(value) ? value : null;
}

function alias(row, primary, alternate, canonical, issues) {
  const a = numeric(row[primary]), b = numeric(row[alternate]);
  if (Object.hasOwn(row, primary) && Object.hasOwn(row, alternate) && a !== b) {
    issues.push(`alias_conflict:${canonical}`);
    return null;
  }
  return Object.hasOwn(row, primary) ? a : b;
}

function metrics(row, channel, issues) {
  return {
    spend: numeric(row?.spend), impressions: numeric(row?.impressions), clicks: numeric(row?.clicks),
    platformConversions: channel === "meta"
      ? alias(row || {}, "purchases", "metaPurchases", "platformConversions", issues) : numeric(row?.conversions),
    platformConversionValue: channel === "meta"
      ? alias(row || {}, "purchaseValue", "metaPurchaseValue", "platformConversionValue", issues) : numeric(row?.conversionValue)
  };
}

function sumMetrics(rows) {
  return Object.fromEntries(BASE.map(key => {
    const values = rows.map(row => numeric(row?.[key]));
    const total = values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
    return [key, total !== null && Number.isFinite(total) ? total : null];
  }));
}

function canonical(channel, input, base, options, issues, available, extensions = {}) {
  const missing = BASE.filter(key => base[key] === null);
  issues.push(...missing.map(key => `unavailable:${key}`));
  if (!options.currency) issues.push("currency_unverified");
  const timezone = input.metadata?.timezone ?? options.timezone ?? null;
  if (!timezone) issues.push("timezone_unverified");
  if (input.cacheWarning || input.cacheMode === "fallback_after_error") issues.push("cached_fallback");
  const period = { since: input.since ?? null, until: input.until ?? null, timezone };
  if (!period.since || !period.until) issues.push("period_unavailable");
  const partial = missing.length > 0 || issues.some(issue => ["cached_fallback", "period_unavailable", "incomplete_campaign_coverage"].includes(issue));
  return {
    schemaVersion: 1, channel, source: input.source ?? null, period,
    currency: options.currency ?? null,
    status: !available ? "unavailable" : partial ? "partial" : BASE.every(key => base[key] === 0) ? "empty" : "available",
    spend: base.spend, impressions: base.impressions, reach: null, clicks: base.clicks,
    ctr: quotient(base.clicks, base.impressions),
    cpc: quotient(base.spend, base.clicks),
    cpm: quotient(base.spend, base.impressions, 1000),
    platformConversions: base.platformConversions,
    platformConversionValue: base.platformConversionValue,
    platformConversionRate: quotient(base.platformConversions, base.clicks),
    platformCpa: quotient(base.spend, base.platformConversions),
    platformRoas: quotient(base.platformConversionValue, base.spend),
    attribution: {
      source: channel,
      conversionEvent: channel === "meta" ? "purchase" : "naver_reported_conversions",
      window: null,
      note: "Platform attribution only; not Cafe24 actual orders or revenue."
    },
    extensions: {
      metricOrigins: Object.fromEntries([...BASE.map(key => [key, "platform"]), ["reach", "unavailable"], ...RATES.map(key => [key, "derived"])]),
      ...extensions
    },
    issues: [...new Set(issues)]
  };
}

export function fromMetaAds(input = {}, options = {}) {
  const issues = ["reach_not_safely_aggregatable", "meta_legacy_zero_filled", "coverage_not_verified"];
  const totals = input.totals && typeof input.totals === "object" && !Array.isArray(input.totals) ? input.totals : null;
  const available = !input.error && input.ok !== false && Boolean(totals || Array.isArray(input.rows));
  const base = !available ? metrics({}, "meta", issues) : totals
    ? metrics(totals, "meta", issues)
    : sumMetrics(input.rows.map(row => metrics(row, "meta", issues)));
  const reconciliation = input.reconciliation;
  if (reconciliation && (numeric(reconciliation.unlistedCampaignCount) > 0 ||
      (reconciliation.spendDiff != null && Number(reconciliation.spendDiff) !== 0) ||
      (reconciliation.purchaseValueDiff != null && Number(reconciliation.purchaseValueDiff) !== 0))) issues.push("incomplete_campaign_coverage");
  return canonical("meta", input, base, options, issues, available, {
    scope: totals ? "summary_totals" : "listed_campaigns",
    reportedRates: {
      ctr: available && totals ? numeric(totals.ctr) : null,
      platformRoas: available && totals ? alias(totals, "roas", "metaRoas", "platformRoas", issues) : null
    }
  });
}

export function fromNaverAds(input = {}, options = {}) {
  const issues = ["reach_not_provided"];
  const available = input.ok === true && Boolean(input.summary) && typeof input.summary === "object" && !Array.isArray(input.summary);
  const summary = available ? input.summary : {};
  return canonical("naver", { ...input, source: input.metadata?.source ?? "naver-searchad-stats" },
    metrics(summary, "naver", issues), options, issues, available, {
      scope: "returned_campaigns",
      // Phase 1 reports percent rates; preserve them as ratios alongside the
      // canonical rates recalculated from base metrics. Never guess from magnitude.
      reportedRates: {
        ctr: quotient(numeric(summary.ctr), 100),
        platformConversionRate: quotient(numeric(summary.conversionRate), 100),
        platformRoas: numeric(summary.roas)
      }
    });
}

// Aggregate disjoint entity rows for one channel and one identical period.
// Different periods or channels require separate objects, not a combined ROAS.
export function aggregateAdvertising(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new TypeError("At least one canonical row is required");
  const first = rows[0];
  if (!first || !["meta", "naver"].includes(first.channel)) throw new TypeError("Invalid canonical channel");
  for (const row of rows) {
    if (row?.schemaVersion !== 1 || row.channel !== first.channel || row.currency !== first.currency ||
        !row.period?.since || !row.period?.until || row.period.since !== first.period?.since ||
        row.period.until !== first.period?.until || row.period.timezone !== first.period?.timezone ||
        row.attribution?.conversionEvent !== first.attribution?.conversionEvent ||
        row.attribution?.window !== first.attribution?.window) {
      throw new TypeError("Aggregation requires matching channel, currency, period and attribution");
    }
  }
  const issues = rows.flatMap(row => row.issues || []);
  issues.push("reach_not_safely_aggregatable");
  const unavailable = rows.some(row => row.status === "unavailable");
  if (rows.some(row => row.status === "partial")) issues.push("incomplete_campaign_coverage");
  const base = unavailable ? Object.fromEntries(BASE.map(key => [key, null])) : sumMetrics(rows);
  const sources = [...new Set(rows.map(row => row.source))];
  return canonical(first.channel, { source: sources.length === 1 ? first.source : "mixed", ...first.period },
    base, { currency: first.currency, timezone: first.period.timezone }, issues, !unavailable,
    { scope: "aggregate", sources });
}
