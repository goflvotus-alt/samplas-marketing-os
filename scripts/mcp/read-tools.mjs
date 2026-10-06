// Phase 1 read tools for the ChatGPT MCP plugin. Every number comes from an existing Marketing OS
// GET route; tools only validate input, trim, select by equality on returned fields and wrap the
// result (spec §6, plan §4). No sales, coverage, status, sellable, NAVER or discount logic lives here.
import { ToolError, capPayload, envelope } from "./upstream.mjs";

// Input schemas are plain JSON Schema (served as-is in tools/list) and validated by
// validateArgs() below, which supports exactly the keywords used here. No runtime schema library.
const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const date = (description) => ({ type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description });
const int = (minimum, maximum, extra = {}) => ({ type: "integer", minimum, ...(maximum === undefined ? {} : { maximum }), ...extra });
const oneOf = (values, extra = {}) => ({ type: "string", enum: values, ...extra });
const text = (maxLength, extra = {}) => ({ type: "string", maxLength, ...extra });
const store = oneOf(["APGUJEONG", "VAIL"], { description: "Offline store filter; omit for all stores" });
const period = { since: date("Start date YYYY-MM-DD (KST)"), until: date("End date YYYY-MM-DD inclusive (KST)") };

function checkValue(rule, value) {
  if (rule.type === "integer") {
    if (!Number.isInteger(value)) return "must be an integer";
    if (value < rule.minimum) return `must be >= ${rule.minimum}`;
    if (rule.maximum !== undefined && value > rule.maximum) return `must be <= ${rule.maximum}`;
    return null;
  }
  if (typeof value !== "string") return "must be a string";
  const v = value.trim();
  if (rule.minLength !== undefined && v.length < rule.minLength) return `must be at least ${rule.minLength} characters`;
  if (rule.maxLength !== undefined && v.length > rule.maxLength) return `must be at most ${rule.maxLength} characters`;
  if (rule.enum && !rule.enum.includes(v)) return `must be one of ${rule.enum.join(", ")}`;
  if (rule.pattern && !new RegExp(rule.pattern).test(v)) return `must match ${rule.pattern}`;
  if (rule.format === "date") {
    const parsed = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v) return "is not a valid date";
  }
  return null;
}

export function validateArgs(schema, args) {
  const input = args ?? {};
  if (typeof input !== "object" || Array.isArray(input)) return { error: "arguments: must be an object" };
  const errors = Object.keys(input).filter((key) => !(key in schema.properties)).map((key) => `${key}: unknown argument`);
  const value = {};
  for (const [key, rule] of Object.entries(schema.properties)) {
    if (input[key] === undefined) {
      if (schema.required.includes(key)) errors.push(`${key}: required`);
      else if ("default" in rule) value[key] = rule.default;
      continue;
    }
    const problem = checkValue(rule, input[key]);
    if (problem) errors.push(`${key}: ${problem}`);
    else value[key] = typeof input[key] === "string" ? input[key].trim() : input[key];
  }
  return errors.length ? { error: errors.join("; ") } : { value };
}
const NO_TIMESTAMP = "source returns no data timestamp; figures are as of the latest Marketing OS import";

function checkPeriod(since, until, label = "period") {
  if (since > until) throw new ToolError("VALIDATION_FAILED", `${label}: since must be on or before until`);
}

function monthNotes({ partialMonths = [], missingMonths = [], storesMissing = [] } = {}) {
  const notes = [];
  if (partialMonths.length) notes.push(`partial months: ${partialMonths.join(", ")}`);
  if (missingMonths.length) notes.push(`missing months: ${missingMonths.join(", ")}`);
  if (storesMissing.length) notes.push(`stores missing: ${storesMissing.join(", ")}`);
  return notes;
}

// /api/sales/total coverage: { online: bool, offline: bool, complete: bool, ... }
function salesCompleteness(coverage) {
  if (!coverage) return "UNKNOWN";
  if (coverage.complete === true) return "COMPLETE";
  return coverage.online || coverage.offline ? "PARTIAL" : "UNAVAILABLE";
}

// Offline month coverage from /api/intelligence/clients. `available` is deliberately ignored:
// it read false for 2026-09 while includedMonths held 2026-09 (plan §6).
export function offlineMonthsCompleteness(offline) {
  const included = offline?.includedMonths || [];
  if (!included.length) return "UNAVAILABLE";
  return (offline.partialMonths || []).length || (offline.missingMonths || []).length ? "PARTIAL" : "COMPLETE";
}

const RANK = { COMPLETE: 0, UNKNOWN: 1, PARTIAL: 2, UNAVAILABLE: 3 };
const worst = (...values) => values.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "COMPLETE");
const slice = (list, n) => (Array.isArray(list) ? list.slice(0, n) : list);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));

export const READ_TOOLS = [
  {
    name: "get_sales_summary",
    title: "Sales summary",
    description: "Online (Cafe24), offline (ECOUNT, by store) and total sales for a date range from Marketing OS. Always state meta.completeness and partial/missing months; never present partial data as complete.",
    input: object({ ...period, store }, ["since", "until"]),
    async run({ since, until, store: storeCode }, up) {
      checkPeriod(since, until);
      const body = await up.getJson("/api/sales/total", { since, until, store: storeCode });
      const coverage = body.coverage || null;
      return envelope("get_sales_summary", { online: body.onlineSales, offline: body.offlineSales, total: body.totalSales, storeCode: body.storeCode ?? null }, {
        source: "/api/sales/total", coverage, completeness: salesCompleteness(coverage),
        requestedPeriod: { since, until }, availablePeriod: { since: body.periodStart, until: body.periodEnd },
        notes: [...monthNotes(coverage || {}), NO_TIMESTAMP]
      });
    }
  },
  {
    name: "get_monthly_report",
    title: "Monthly report",
    description: "Saved monthly report headline (sales, commerce, marketing, content) for one month. Long lists are capped. status 'draft' means the month is not final.",
    input: object({ month: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$", description: "Month YYYY-MM" } }, ["month"]),
    async run({ month }, up) {
      const body = await up.getJson("/api/reports/monthly", { month });
      const { provenance: _salesProvenance, ...sales } = body.sales || {};
      // orderHistory carries order ids and personal-payment line names: never leaves the server.
      const brandSales = (body.commerce?.brandSales || []).slice(0, 10).map(({ orderHistory: _orders, ...brand }) => brand);
      const commerce = body.commerce && { ...body.commerce, brandSales, productSales: slice(body.commerce.productSales, 10) };
      const marketing = body.marketing && { ...body.marketing, attentionCampaigns: slice(body.marketing.attentionCampaigns, 10) };
      // Media/thumbnail URLs are signed CDN links; keep the public permalink and metrics only.
      const topContent = (body.content?.topContent || []).slice(0, 5).map((post) => pick(post, ["id", "date", "title", "type", "permalink", "reach", "views", "likes", "saves", "shares"]));
      const content = body.content && (({ aboveAverageSaveRatePosts: _drop, ...rest }) => ({ ...rest, topContent }))(body.content);
      const coverage = body.sales?.coverage || null;
      const notes = monthNotes(coverage || {});
      if (body.status === "draft") notes.push("report status is draft (not final)");
      return envelope("get_monthly_report", { month: body.month, status: body.status, archiveStatus: body.archiveStatus, sales, commerce, marketing, content }, {
        source: "/api/reports/monthly", dataAsOf: body.generatedAt || null, coverage, completeness: salesCompleteness(coverage), notes
      });
    }
  },
  {
    name: "get_clients_summary",
    title: "Clients summary",
    description: "Client totals and type breakdown (stylist, press, customer, foreign, online first signup, staff) for a date range. Aggregates only: no client names, records, contacts or orders.",
    input: object({ ...period, store }, ["since", "until"]),
    async run({ since, until, store: storeCode }, up) {
      checkPeriod(since, until);
      const body = await up.getJson("/api/intelligence/clients", { since, until, store: storeCode, view: "summary" });
      const offline = body.coverage?.offline;
      const completeness = body.coverage?.complete === true ? "COMPLETE"
        : body.coverage?.online?.available || (offline?.includedMonths || []).length ? "PARTIAL" : "UNAVAILABLE";
      return envelope("get_clients_summary", {
        summary: body.summary, typeBreakdown: body.typeBreakdown, accounting: body.accounting ?? null
      }, {
        source: "/api/intelligence/clients?view=summary", coverage: { ...body.coverage, storeCoverage: body.storeCoverage }, completeness,
        requestedPeriod: { since, until }, availablePeriod: { since: body.periodStart, until: body.periodEnd },
        notes: [...monthNotes(offline || {}), NO_TIMESTAMP]
      });
    }
  },
  {
    name: "get_foreign_sales",
    title: "Foreign customer sales",
    description: "Foreign (외국인) customer sales exactly as Marketing OS classifies them (typeBreakdown type 'foreign' of /api/intelligence/clients), optionally against a comparison period. If a period has no offline data, its amounts are null (unavailable), never 0; growthRate is only given when both periods are complete.",
    input: object({ ...period, compareSince: date("Comparison start YYYY-MM-DD"), compareUntil: date("Comparison end YYYY-MM-DD"), store }, ["since", "until"]),
    async run({ since, until, compareSince, compareUntil, store: storeCode }, up) {
      checkPeriod(since, until);
      if (Boolean(compareSince) !== Boolean(compareUntil)) throw new ToolError("VALIDATION_FAILED", "compareSince and compareUntil must be given together");
      if (compareSince) checkPeriod(compareSince, compareUntil, "comparison period");
      const current = await foreignPeriod(up, since, until, storeCode);
      const comparison = compareSince ? await foreignPeriod(up, compareSince, compareUntil, storeCode) : null;
      const notes = [...current.notes.map((n) => `current: ${n}`), ...(comparison ? comparison.notes.map((n) => `comparison: ${n}`) : []), NO_TIMESTAMP];
      let growth = null;
      if (comparison) {
        const bothComplete = current.completeness === "COMPLETE" && comparison.completeness === "COMPLETE" && comparison.foreign.salesAmount > 0;
        growth = { comparable: bothComplete, growthRate: bothComplete ? (current.foreign.salesAmount - comparison.foreign.salesAmount) / comparison.foreign.salesAmount : null };
        if (!bothComplete) notes.push("growthRate not computed: at least one period is partial or unavailable");
      }
      const strip = ({ notes: _n, ...rest }) => rest;
      return envelope("get_foreign_sales", { current: strip(current), comparison: comparison && strip(comparison), growth }, {
        source: "/api/intelligence/clients?view=summary#typeBreakdown[type=foreign]",
        coverage: { current: current.coverage, comparison: comparison?.coverage ?? null },
        completeness: worst(current.completeness, comparison?.completeness ?? "COMPLETE"),
        requestedPeriod: { since, until, ...(compareSince ? { compareSince, compareUntil } : {}) },
        notes
      });
    }
  },
  {
    name: "get_brand",
    title: "Brand status",
    description: "One brand by name or brand code: canonical identity, sourcing, commercial policy, NEW-brand status with Cafe24 sellable counts and NAVER ad group (only for brands in the 90-day NEW window) and related pending candidates.",
    input: object({ brand: text(100, { minLength: 1, description: "Brand name, alias or brand code (e.g. B0000BDV)" }) }, ["brand"]),
    async run({ brand }, up) {
      const resolved = await up.getJson("/api/intelligence/brands/resolve", { name: brand });
      const code = resolved.brand?.brandId;
      if (!code) throw new ToolError("NOT_FOUND", `No canonical brand for "${brand}". New or unregistered brands may be in get_pending_brands.`);
      const master = await up.getJson("/api/brand-master");
      const entry = (master.brands || []).find((b) => b.brand_code === code);
      if (!entry) throw new ToolError("NOT_FOUND", `Brand ${code} is not in Brand Master`);
      const policy = await up.getJson("/api/intelligence/commercial-policy", { brand_code: code });
      const fresh = await up.getJson("/api/brands/new");
      const pending = await up.getJson("/api/pending-brands");
      const row = (fresh.brands || []).find((b) => b.brandCode === code) || null;
      const notes = [];
      if (!row) notes.push("Cafe24 sellable and NAVER ad group checks are only computed for brands in the 90-day NEW window");
      if (fresh.coverage?.naverError) notes.push(`NAVER check unavailable: ${fresh.coverage.naverError}`);
      return envelope("get_brand", {
        brandCode: code,
        canonicalName: entry.brand_name || resolved.brand.name,
        aliases: entry.name_aliases || [],
        active: entry.active,
        sourcingType: policy.policy?.sourcing_type ?? entry.sourcing_type ?? null,
        commercialPolicy: {
          policyStatus: policy.policy_status ?? null,
          stylistDiscountPercent: policy.policy?.stylist_discount_percent ?? null,
          discountStatus: policy.policy?.discount_status ?? null,
          policySource: policy.policy?.source ?? null,
          effectivePolicy: policy.effective_policy ?? null,
          fallback: policy.fallback ?? null
        },
        isNew: Boolean(row),
        newBrand: row && pick(row, ["approvedAt", "daysSinceOnboarding", "operationStatus", "operationStatusLabel"]),
        cafe24: row?.cafe24 ?? null,
        naver: row?.naver ?? null,
        pendingCandidates: (pending.candidates || []).filter((c) => c.sourceBrandCode === code).map((c) => pick(c, ["id", "rawBrandName", "status", "reviewReason"]))
      }, {
        source: "/api/intelligence/brands/resolve + /api/brand-master + /api/intelligence/commercial-policy + /api/brands/new + /api/pending-brands",
        dataAsOf: master.updatedAt || null,
        coverage: { newBrandsAsOf: fresh.asOf ?? null, naverCheckedAt: fresh.coverage?.naverCheckedAt ?? null, pendingUpdatedAt: pending.updatedAt ?? null },
        completeness: fresh.coverage?.naverError ? "PARTIAL" : "COMPLETE",
        notes
      });
    }
  },
  {
    name: "get_pending_brands",
    title: "Pending brand candidates",
    description: "Brand onboarding candidates and their review reasons, read-only. Automatic approval is NEW-only inside Marketing OS; INACTIVE_CODE_REUSED and other blocked reasons need individual manual review.",
    input: object({
      status: oneOf(["PENDING", "APPROVED", "all"], { default: "PENDING" }),
      reviewReason: text(60, { description: "Exact reviewReason, e.g. INACTIVE_CODE_REUSED" }),
      limit: int(1, 50, { default: 50 })
    }),
    async run({ status, reviewReason, limit }, up) {
      const body = await up.getJson("/api/pending-brands");
      const rows = (body.candidates || [])
        .filter((c) => (status === "all" || c.status === status) && (!reviewReason || c.reviewReason === reviewReason));
      const byReason = {};
      for (const c of rows) byReason[c.reviewReason || "NONE"] = (byReason[c.reviewReason || "NONE"] || 0) + 1;
      const notes = [];
      if (body.provenance && body.provenance.ecountAvailable === false) notes.push("ECOUNT evidence unavailable for the last scan");
      return envelope("get_pending_brands", {
        total: rows.length,
        countsByReviewReason: byReason,
        candidates: rows.slice(0, limit).map((c) => ({
          ...pick(c, ["id", "rawBrandName", "sourceBrandCode", "status", "reviewReason", "relatedProductCount", "lastSeenAt"]),
          operationalClass: c.uiReview?.operationalClass ?? null,
          recommendedUiAction: c.uiReview?.recommendedUiAction ?? null
        }))
      }, {
        source: "/api/pending-brands", dataAsOf: body.updatedAt || null,
        coverage: pick(body.provenance || {}, ["ecountAvailable", "ecountProductsAt", "cafe24BrandsFetchedAt"]),
        completeness: body.provenance?.ecountAvailable === false ? "PARTIAL" : "COMPLETE", notes
      });
    }
  },
  {
    name: "get_new_brands",
    title: "New brands (90 days)",
    description: "Brands onboarded in the last 90 days with their operation status: 새브랜드 입고 (NEW_BRAND_ARRIVED), NAVER 미등록 (NAVER_MISSING), 완료 (COMPLETE), plus Cafe24 sellable counts and NAVER ad group match.",
    input: object({ operationStatus: oneOf(["NEW_BRAND_ARRIVED", "NAVER_MISSING", "COMPLETE"]) }),
    async run({ operationStatus }, up) {
      const body = await up.getJson("/api/brands/new");
      const rows = (body.brands || []).filter((b) => !operationStatus || b.operationStatus === operationStatus);
      const notes = [];
      if (body.coverage?.naverError) notes.push(`NAVER 확인 불가: ${body.coverage.naverError}`);
      const unchecked = rows.filter((b) => b.cafe24 && b.cafe24.checked === false).map((b) => b.brandName);
      if (unchecked.length) notes.push(`Cafe24 확인 불가: ${unchecked.join(", ")}`);
      return envelope("get_new_brands", { count: body.count, statusCounts: body.statusCounts, windowDays: body.windowDays, brands: rows }, {
        source: "/api/brands/new", dataAsOf: body.asOf || null, coverage: body.coverage || null,
        completeness: notes.length ? "PARTIAL" : "COMPLETE", notes
      });
    }
  },
  {
    name: "get_inventory",
    title: "Store inventory",
    description: "ECOUNT store inventory overview. view=summary (default) gives totals, coverage and negative inventory; view=items gives a page of SKUs; view=brands gives the per-brand rollup (with status=negative_review: brands that have negative stock, most negative units first). Use brandKey values from view=brands to filter items.",
    input: object({
      view: oneOf(["summary", "items", "brands"], { default: "summary" }),
      status: oneOf(["in_stock", "depleted_candidate", "negative_review", "unknown", "qqq_estimated_sale", "location_unknown"]),
      brandKey: text(200, { description: "brandKey exactly as returned by view=brands" }),
      search: text(100),
      sort: oneOf(["stock-asc", "stock-desc", "recent-sales-desc"]),
      limit: int(1, 100, { default: 20 }),
      offset: int(0, undefined, { default: 0 })
    }),
    async run({ view, status, brandKey, search, sort, limit, offset }, up) {
      const upstreamLimit = view === "items" ? limit : 1;
      const body = await up.getJson("/api/inventory/overview", { status, brand: brandKey, search, sort, limit: upstreamLimit, offset: view === "items" ? offset : 0 });
      const cov = body.coverage || {};
      const notes = [];
      if (cov.stockUnknownItems) notes.push(`stock known for ${cov.stockKnownItems} of ${cov.totalItems} items; ${cov.stockUnknownItems} unknown`);
      if (cov.locationUnknownItems) notes.push("store location is not available for inventory items");
      let data;
      if (view === "summary") {
        const negative = body.operations?.negativeInventory;
        data = { summary: body.summary, itemsTotal: body.itemsTotal, negativeInventory: negative && { ...negative, topByUnits: slice(negative.topByUnits, 10) } };
      } else if (view === "items") {
        data = {
          itemsTotal: body.itemsTotal, offset: body.offset, limit: body.limit,
          items: (body.items || []).map((i) => pick(i, ["brandKey", "brandName", "productName", "prodCd", "stockQuantity", "status", "recentSalesQty", "lastSaleDate", "salesPrice", "daysOfSupply"]))
        };
      } else {
        let rows = body.brandRollup || [];
        if (status === "negative_review") rows = rows.filter((b) => b.negativeReviewCount > 0).sort((a, b) => b.negativeUnits - a.negativeUnits);
        data = { brandsTotal: rows.length, offset, limit, brands: rows.slice(offset, offset + limit) };
        if (status === "negative_review") data.negativeInventory = pick(body.operations?.negativeInventory || {}, ["skuCount", "totalNegativeUnits", "recentlySellingCount"]);
      }
      return envelope("get_inventory", data, {
        source: "/api/inventory/overview", dataAsOf: body.generatedAt || null, coverage: { ...cov, salesDataAsOf: body.salesDataAsOf ?? null },
        completeness: cov.stockUnknownItems ? "PARTIAL" : "COMPLETE", notes
      });
    }
  },
  {
    name: "get_advertising_summary",
    title: "Advertising summary",
    description: "Meta and NAVER search ads platform metrics (spend, impressions, clicks, CTR, CPC, conversions, ROAS) for a date range. Platform-reported conversions, not actual commerce sales.",
    input: object(period, ["since", "until"]),
    async run({ since, until }, up) {
      checkPeriod(since, until);
      const body = await up.getJson("/api/advertising/overview", { since, until });
      const fields = ["channel", "status", "source", "period", "spend", "impressions", "clicks", "ctr", "cpc", "cpm", "platformConversions", "platformConversionValue", "platformConversionRate", "platformCpa", "platformRoas", "issues"];
      const channels = (body.channels || []).map((c) => pick(c, fields));
      const notes = [...(body.notes || [])];
      const unavailable = channels.filter((c) => c.status !== "available" || (c.issues || []).length);
      for (const c of unavailable) notes.push(`${c.channel}: status ${c.status}${(c.issues || []).length ? `, ${c.issues.length} issue(s)` : ""}`);
      const completeness = !channels.length ? "UNAVAILABLE" : unavailable.length === channels.length && channels.every((c) => c.status !== "available") ? "UNAVAILABLE" : unavailable.length ? "PARTIAL" : "COMPLETE";
      return envelope("get_advertising_summary", { channels, actualCommerce: body.actualCommerce ?? null }, {
        source: "/api/advertising/overview", coverage: Object.fromEntries(channels.map((c) => [c.channel, c.status])), completeness,
        requestedPeriod: { since, until }, availablePeriod: { since: body.since, until: body.until }, notes: [...notes, NO_TIMESTAMP]
      });
    }
  },
  {
    name: "get_commercial_policy",
    title: "Commercial policy",
    description: "Stylist discount policy. With brand: the effective policy for that brand (EXPLICIT_POLICY overrides SOURCING_DEFAULT). Without brand: the explicit policy list, optionally filtered by discount percent, discount status or sourcing type.",
    input: object({
      brand: text(100, { minLength: 1, description: "Brand name or brand code" }),
      discountPercent: int(0, 100),
      discountStatus: text(40),
      sourcingType: oneOf(["WHOLESALE", "CONSIGNMENT", "OWN_PRODUCTION", "HYBRID", "UNKNOWN"]),
      limit: int(1, 100, { default: 50 })
    }),
    async run({ brand, discountPercent, discountStatus, sourcingType, limit }, up) {
      if (brand) {
        const query = /^B[0-9A-Z]{7}$/.test(brand) ? { brand_code: brand } : { name: brand };
        const body = await up.getJson("/api/intelligence/commercial-policy", query);
        if (!body.found) throw new ToolError("NOT_FOUND", `No commercial policy match for "${brand}"`);
        const p = body.policy || {};
        return envelope("get_commercial_policy", {
          brand: { brandCode: p.brand_code ?? body.brand?.brandId ?? null, name: p.canonical_brand_name ?? body.brand?.name ?? null },
          policyStatus: body.policy_status,
          sourcingType: p.sourcing_type ?? null,
          stylistDiscountPercent: p.stylist_discount_percent ?? null,
          discountStatus: p.discount_status ?? null,
          note: p.note ?? null,
          productRules: slice(p.product_rules, 10),
          policySource: p.source ?? null,
          effectivePolicy: body.effective_policy ?? null,
          fallback: body.fallback ?? null
        }, { source: "/api/intelligence/commercial-policy", completeness: "COMPLETE" });
      }
      const body = await up.getJson("/api/intelligence/commercial-policy");
      const rows = (body.policies || []).filter((p) =>
        (discountPercent === undefined || p.stylist_discount_percent === discountPercent) &&
        (!discountStatus || p.discount_status === discountStatus) &&
        (!sourcingType || p.sourcing_type === sourcingType));
      return envelope("get_commercial_policy", {
        total: rows.length,
        policies: rows.slice(0, limit).map((p) => pick(p, ["brand_code", "canonical_brand_name", "sourcing_type", "stylist_discount_percent", "discount_status", "note"]))
      }, {
        source: "/api/intelligence/commercial-policy", completeness: "COMPLETE",
        notes: ["list contains explicit policies only; brands without one use SOURCING_DEFAULT (query by brand for the effective policy)"]
      });
    }
  }
];

async function foreignPeriod(up, since, until, storeCode) {
  const body = await up.getJson("/api/intelligence/clients", { since, until, store: storeCode, view: "summary" });
  const row = (body.typeBreakdown || []).find((t) => t.type === "foreign");
  if (!row) throw new ToolError("UPSTREAM_UNAVAILABLE", "Marketing OS clients response has no foreign type row", { details: { path: "/api/intelligence/clients" } });
  const offline = body.coverage?.offline || {};
  const completeness = offlineMonthsCompleteness(offline);
  const available = completeness !== "UNAVAILABLE";
  const notes = monthNotes(offline);
  if (!available) notes.unshift(`no offline sales data in Marketing OS for ${since}..${until}; amount is unavailable, not 0`);
  return {
    requestedPeriod: { since, until },
    availablePeriod: { since: body.periodStart, until: body.periodEnd },
    completeness,
    includedMonths: offline.includedMonths || [],
    partialMonths: offline.partialMonths || [],
    missingMonths: offline.missingMonths || [],
    foreign: {
      label: row.label,
      salesAmount: available ? row.salesAmount : null,
      purchaseCount: available ? row.purchaseCount : null,
      clientCount: available ? row.clientCount : null,
      ratioPct: available ? row.ratioPct : null
    },
    coverage: body.coverage || null,
    notes
  };
}

export const MAX_TOOL_RESULT_BYTES = 200_000;

// Last-line PII guard for every tool result (the endpoint may run without auth). Masks phone
// numbers, emails and "name + title" forms such as "김OO 실장님" that appear in canonical free-text
// fields (personal-payment product names, ECOUNT item names). Generic words like 손님/고객님 are kept.
// The 개인결제창 rule masks everything before that marker, whatever form the buyer name takes.
const PII_PATTERNS = [
  [/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, "[비공개]"],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[비공개]"],
  [/[가-힣]{2,4}\s?(실장|이사|팀장|대표|과장|부장|차장|원장|작가|디렉터|매니저|에디터|기자)님/g, "[비공개]"],
  // Cafe24 personal-payment items are named after the buyer ("<name> 개인결제창 <date>").
  [/^[^\n]*?(?=\s*개인결제창)/, "[비공개]"]
];
function redact(value) {
  if (typeof value === "string") return PII_PATTERNS.reduce((text, [pattern, mask]) => text.replace(pattern, mask), value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  return value;
}

// Validates arguments, runs the tool and returns either an envelope or a ToolError JSON.
export async function runReadTool(name, args, up) {
  const tool = READ_TOOLS.find((t) => t.name === name);
  if (!tool) return new ToolError("NOT_FOUND", `Unknown tool: ${name}`).toJSON();
  const parsed = validateArgs(tool.input, args);
  if (parsed.error) return new ToolError("VALIDATION_FAILED", parsed.error.slice(0, 300)).toJSON();
  try {
    return capPayload(redact(await tool.run(parsed.value, up)), MAX_TOOL_RESULT_BYTES);
  } catch (error) {
    if (error instanceof ToolError) return error.toJSON();
    return new ToolError("UPSTREAM_UNAVAILABLE", "Unexpected gateway error", { retryable: true }).toJSON();
  }
}
