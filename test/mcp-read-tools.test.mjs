import test from "node:test";
import assert from "node:assert/strict";
import { READ_TOOLS, runReadTool } from "../scripts/mcp/read-tools.mjs";
import { ToolError } from "../scripts/mcp/upstream.mjs";

// Stub upstream: path -> body or (params) => body. Records every call.
function stub(routes) {
  const calls = [];
  return {
    calls,
    async getJson(path, params = {}) {
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
      calls.push({ path, params: clean });
      const route = routes[path];
      if (route === undefined) throw new ToolError("NOT_FOUND", `no stub for ${path}`);
      const body = typeof route === "function" ? route(clean) : route;
      if (body instanceof ToolError) throw body;
      return structuredClone(body);
    }
  };
}

// Shapes follow Production responses observed 2026-10-06 (trimmed, no client PII).
const typeBreakdown = (foreignAmount) => [
  { type: "stylist", label: "스타일리스트", clientCount: 71, purchaseCount: 579, salesAmount: 163360940, ratioPct: 68.0 },
  { type: "foreign", label: "외국인", clientCount: 1, purchaseCount: foreignAmount ? 546 : 0, salesAmount: foreignAmount, ratioPct: foreignAmount ? 8.0 : 0 }
];
const clientsBody = (since, until) => {
  const is2025 = since.startsWith("2025");
  return {
    ok: true, periodStart: since, periodEnd: until, storeCode: null,
    storeCoverage: {},
    summary: { totalClients: 101 },
    typeBreakdown: typeBreakdown(is2025 ? 0 : 133480850),
    stylistTop10: [{ clientId: "c1", name: "Stylist A", purchaseCount: 3, salesAmount: 100, purchaseDateCounts: [], products: [{ x: 1 }] }],
    pressTop10: [], ffTop10: [],
    clients: [{ clientId: "c1", name: "Stylist A", contact: "010-0000-0000" }],
    meta: {}, accounting: { basis: "saved_monthly_archive" },
    coverage: {
      online: { available: true, status: "available" },
      offline: is2025
        ? { available: false, status: "unavailable", storesIncluded: [], includedMonths: [], missingMonths: ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09"], partialMonths: [] }
        : { available: false, status: "unavailable", storesIncluded: [], includedMonths: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"], missingMonths: [], partialMonths: ["2026-01", "2026-09"] },
      complete: false
    }
  };
};

test("exactly the 10 planned read tools, all with strict object schemas", () => {
  assert.deepEqual(READ_TOOLS.map((t) => t.name), [
    "get_sales_summary", "get_monthly_report", "get_clients_summary", "get_foreign_sales", "get_brand",
    "get_pending_brands", "get_new_brands", "get_inventory", "get_advertising_summary", "get_commercial_policy"
  ]);
  for (const t of READ_TOOLS) assert.ok(t.description.length > 40, t.name);
});

test("validation happens before any upstream call", async () => {
  const up = stub({});
  for (const [name, args] of [
    ["get_sales_summary", { since: "2026-09-31", until: "2026-09-30" }],
    ["get_sales_summary", { since: "2026-09-30", until: "2026-09-01" }],
    ["get_sales_summary", { since: "2026-09-01", until: "2026-09-30", url: "http://x" }],
    ["get_monthly_report", { month: "2026-13" }],
    ["get_inventory", { limit: 500 }],
    ["get_foreign_sales", { since: "2026-01-01", until: "2026-09-30", compareSince: "2025-01-01" }]
  ]) {
    const out = await runReadTool(name, args, up);
    assert.equal(out.error?.code, "VALIDATION_FAILED", `${name} ${JSON.stringify(args)}`);
  }
  assert.equal(up.calls.length, 0);
  assert.equal((await runReadTool("set_discount", {}, up)).error.code, "NOT_FOUND");
});

test("sales: values pass through; partial coverage is never complete", async () => {
  const body = {
    periodStart: "2026-09-01", periodEnd: "2026-09-30", storeCode: null,
    onlineSales: { paidAmount: 30967793 }, offlineSales: { offlineSalesAmount: 200000000, byStore: { APGUJEONG: 150000000, VAIL: 50000000 } }, totalSales: { amount: 230967793 },
    coverage: { online: true, offline: true, complete: false, partialMonths: ["2026-09"], missingMonths: [], storesIncluded: ["APGUJEONG", "VAIL"], storesMissing: [] }
  };
  const up = stub({ "/api/sales/total": body });
  const out = await runReadTool("get_sales_summary", { since: "2026-09-01", until: "2026-09-30" }, up);
  assert.equal(out.data.total.amount, 230967793);
  assert.deepEqual(out.data.offline.byStore, body.offlineSales.byStore);
  assert.equal(out.meta.completeness, "PARTIAL");
  assert.match(out.meta.notes[0], /^COVERAGE_INCOMPLETE/);
  assert.ok(out.meta.notes.includes("partial months: 2026-09"));
  assert.deepEqual(out.meta.requestedPeriod, { since: "2026-09-01", until: "2026-09-30" });
  assert.equal(out.meta.dataAsOf, null);

  const complete = await runReadTool("get_sales_summary", { since: "2026-08-01", until: "2026-08-31" }, stub({ "/api/sales/total": { ...body, coverage: { ...body.coverage, complete: true, partialMonths: [] } } }));
  assert.equal(complete.meta.completeness, "COMPLETE");
  const missing = await runReadTool("get_sales_summary", { since: "2025-08-01", until: "2025-08-31" }, stub({ "/api/sales/total": { ...body, coverage: { online: false, offline: false, complete: false, partialMonths: [], missingMonths: ["2025-08"], storesMissing: ["APGUJEONG", "VAIL"] } } }));
  assert.equal(missing.meta.completeness, "UNAVAILABLE");
});

test("monthly report: lists capped, draft noted, generatedAt as dataAsOf", async () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ i }));
  const up = stub({ "/api/reports/monthly": { month: "2026-09", generatedAt: "2026-10-04T09:32:39.914Z", status: "draft", archiveStatus: "saved",
    sales: { coverage: { online: true, offline: true, complete: true, partialMonths: [], missingMonths: [] }, provenance: { big: true } },
    commerce: { paidAmount: 1, brandSales: many(80), productSales: many(300) }, marketing: { spend: 1, attentionCampaigns: many(40) },
    content: { totalViews: 1, topContent: many(30), aboveAverageSaveRatePosts: many(30) } } });
  const out = await runReadTool("get_monthly_report", { month: "2026-09" }, up);
  assert.equal(out.data.commerce.brandSales.length, 10);
  assert.equal(out.data.commerce.productSales.length, 10);
  assert.equal(out.data.marketing.attentionCampaigns.length, 10);
  assert.equal(out.data.content.topContent.length, 5);
  assert.equal(out.data.content.aboveAverageSaveRatePosts, undefined);
  assert.equal(out.data.sales.provenance, undefined);
  assert.equal(out.meta.dataAsOf, "2026-10-04T09:32:39.914Z");
  assert.ok(out.meta.notes.includes("report status is draft (not final)"));
});

test("clients: summary only, no client records or contacts", async () => {
  const up = stub({ "/api/intelligence/clients": (p) => clientsBody(p.since, p.until) });
  const out = await runReadTool("get_clients_summary", { since: "2026-09-01", until: "2026-09-30" }, up);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /Stylist A|010-0000-0000|contact|purchaseDateCounts|products/);
  assert.deepEqual(Object.keys(out.data).sort(), ["accounting", "summary", "typeBreakdown"]);
  assert.deepEqual(up.calls[0].params, { since: "2026-09-01", until: "2026-09-30", view: "summary" });
  assert.equal(out.meta.completeness, "PARTIAL");
});

test("foreign sales: canonical row as is; 2025 missing is null not 0; growth null when not comparable", async () => {
  const up = stub({ "/api/intelligence/clients": (p) => clientsBody(p.since, p.until) });
  const out = await runReadTool("get_foreign_sales", { since: "2026-01-01", until: "2026-09-30", compareSince: "2025-01-01", compareUntil: "2025-09-30" }, up);
  assert.equal(out.ok, true);
  assert.equal(out.data.current.foreign.salesAmount, 133480850);
  assert.equal(out.data.current.completeness, "PARTIAL");
  assert.deepEqual(out.data.current.partialMonths, ["2026-01", "2026-09"]);
  assert.equal(out.data.comparison.completeness, "UNAVAILABLE");
  assert.equal(out.data.comparison.foreign.salesAmount, null);
  assert.equal(out.data.comparison.foreign.purchaseCount, null);
  assert.notEqual(out.data.comparison.foreign.salesAmount, 0);
  assert.deepEqual(out.data.growth, { comparable: false, growthRate: null });
  assert.equal(out.meta.completeness, "UNAVAILABLE");
  assert.ok(out.meta.notes.some((n) => /amount is unavailable, not 0/.test(n)));
  assert.deepEqual(up.calls.map((c) => c.params.since), ["2026-01-01", "2025-01-01"]);
  assert.ok(up.calls.every((c) => c.params.view === "summary"), "foreign sales reads the summary view only");

  // `available:false` with included months still counts as data (observed upstream quirk).
  const single = await runReadTool("get_foreign_sales", { since: "2026-09-01", until: "2026-09-30" }, up);
  assert.equal(single.data.comparison, null);
  assert.equal(single.data.growth, null);
  assert.equal(single.data.current.completeness, "PARTIAL");

  const noRow = stub({ "/api/intelligence/clients": { ...clientsBody("2026-01-01", "2026-01-31"), typeBreakdown: [] } });
  assert.equal((await runReadTool("get_foreign_sales", { since: "2026-01-01", until: "2026-01-31" }, noRow)).error.code, "UPSTREAM_UNAVAILABLE");
});

test("foreign sales: growth only when both periods are complete", async () => {
  const complete = (amount) => ({ ...clientsBody("2026-08-01", "2026-08-31"), typeBreakdown: typeBreakdown(amount),
    coverage: { online: { available: true }, offline: { includedMonths: ["x"], partialMonths: [], missingMonths: [] }, complete: true } });
  const up = stub({ "/api/intelligence/clients": (p) => complete(p.since.startsWith("2026-08") ? 150 : 100) });
  const out = await runReadTool("get_foreign_sales", { since: "2026-08-01", until: "2026-08-31", compareSince: "2026-07-01", compareUntil: "2026-07-31" }, up);
  assert.deepEqual(out.data.growth, { comparable: true, growthRate: 0.5 });
  assert.equal(out.meta.completeness, "COMPLETE");
});

const brandRoutes = () => ({
  "/api/intelligence/brands/resolve": (p) => ({ ok: true, query: p.name, brand: /records|B0000BDV/i.test(p.name) ? { brandId: "B0000BDV", name: "RECORDS INC" } : null }),
  "/api/brand-master": { ok: true, updatedAt: "2026-10-04T05:38:15Z", brands: [{ brand_code: "B0000BDV", brand_name: "RECORDS INC", name_aliases: [], instagram_tag: "", active: true, sourcing_type: "WHOLESALE" }] },
  "/api/intelligence/commercial-policy": { ok: true, found: true, policy_status: "SOURCING_DEFAULT", policy: null, fallback: { sourcing_type: "WHOLESALE", stylist_discount_percent: 20 }, effective_policy: { effective_discount_percent: 20, decision_source: "SOURCING_DEFAULT" } },
  "/api/brands/new": { ok: true, asOf: "2026-10-06", windowDays: 90, count: 2, statusCounts: { NEW_BRAND_ARRIVED: 0, NAVER_MISSING: 1, COMPLETE: 1 },
    coverage: { naverCheckedAt: "2026-10-06T00:00:00Z", naverError: null },
    brands: [
      { brandCode: "B0000BDV", brandName: "RECORDS INC", approvedAt: "2026-10-04T05:38:15Z", daysSinceOnboarding: 2, operationStatus: "NAVER_MISSING", operationStatusLabel: "NAVER 미등록",
        cafe24: { checked: true, productCount: 18, displayedProductCount: 18, sellableProductCount: 16, hasSellableProducts: true }, naver: { checked: true, registered: false, matchedBy: null, adgroupName: null, pausedOnly: false } },
      { brandCode: "B0000LAM", brandName: "LAMENTIST", operationStatus: "COMPLETE", operationStatusLabel: "완료", cafe24: { checked: true }, naver: { checked: true, registered: true } }
    ] },
  "/api/pending-brands": { ok: true, updatedAt: "2026-10-04T09:45:20.692Z", provenance: { ecountAvailable: true },
    candidates: [
      { id: "p1", rawBrandName: "PERSONSOUL", sourceBrandCode: "B0000AAA", status: "PENDING", reviewReason: "INACTIVE_CODE_REUSED", uiReview: { operationalClass: "INACTIVE_CODE_REUSED", recommendedUiAction: null }, relatedProductCount: 3 },
      { id: "p2", rawBrandName: "UNDER THE SIGN", sourceBrandCode: "B0000AAB", status: "PENDING", reviewReason: "INACTIVE_CODE_REUSED", uiReview: { operationalClass: "INACTIVE_CODE_REUSED" } },
      { id: "p3", rawBrandName: "PRAYING", sourceBrandCode: "B0000AAC", status: "PENDING", reviewReason: "INACTIVE_CODE_REUSED", uiReview: {} },
      { id: "p4", rawBrandName: "RECORDS INC", sourceBrandCode: "B0000BDV", status: "APPROVED", reviewReason: null, uiReview: {} }
    ] }
});

test("brand: canonical code joins only; NEW, Cafe24 and NAVER come from /api/brands/new verbatim", async () => {
  const up = stub(brandRoutes());
  const out = await runReadTool("get_brand", { brand: "records inc" }, up);
  assert.equal(out.data.brandCode, "B0000BDV");
  assert.equal(out.data.canonicalName, "RECORDS INC");
  assert.equal(out.data.sourcingType, "WHOLESALE");
  assert.equal(out.data.commercialPolicy.policyStatus, "SOURCING_DEFAULT");
  assert.equal(out.data.newBrand.operationStatusLabel, "NAVER 미등록");
  assert.deepEqual(pickCounts(out.data.cafe24), [18, 18, 16]);
  assert.equal(out.data.naver.registered, false);
  assert.deepEqual(out.data.pendingCandidates.map((c) => c.id), ["p4"]);
  assert.deepEqual(up.calls.find((c) => c.path === "/api/intelligence/commercial-policy").params, { brand_code: "B0000BDV" });
  const missing = await runReadTool("get_brand", { brand: "zzz" }, up);
  assert.equal(missing.error.code, "NOT_FOUND");
  assert.match(missing.error.message, /get_pending_brands/);
});
const pickCounts = (c) => [c.productCount, c.displayedProductCount, c.sellableProductCount];

test("pending brands: read-only list with reasons; default PENDING", async () => {
  const out = await runReadTool("get_pending_brands", {}, stub(brandRoutes()));
  assert.deepEqual(out.data.candidates.map((c) => c.rawBrandName), ["PERSONSOUL", "UNDER THE SIGN", "PRAYING"]);
  assert.deepEqual(out.data.countsByReviewReason, { INACTIVE_CODE_REUSED: 3 });
  assert.equal(out.data.candidates[0].operationalClass, "INACTIVE_CODE_REUSED");
});

test("new brands: three server labels only, filter by operationStatus", async () => {
  const out = await runReadTool("get_new_brands", { operationStatus: "NAVER_MISSING" }, stub(brandRoutes()));
  assert.deepEqual(out.data.brands.map((b) => b.brandName), ["RECORDS INC"]);
  assert.equal(out.data.brands[0].operationStatusLabel, "NAVER 미등록");
  assert.equal(out.meta.dataAsOf, "2026-10-06");
  assert.equal((await runReadTool("get_new_brands", { operationStatus: "NEW_STATE" }, stub(brandRoutes()))).error.code, "VALIDATION_FAILED");
});

const inventoryBody = (params) => {
  const total = 14746;
  const limit = Number(params.limit);
  const offset = Number(params.offset || 0);
  const all = Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({ brandKey: "k", brandName: "B", productName: `P${offset + i}`, prodCd: `C${offset + i}`, stockQuantity: -1, status: "negative_review", recentSalesQty: 0, lastSaleDate: null, salesPrice: 1000, daysOfSupply: null, barcode: "x", locations: [], rawProductName: "raw" }));
  return {
    ok: true, generatedAt: "2026-10-04T09:45:14.668Z", salesDataAsOf: "2026-10-03",
    coverage: { totalItems: total, stockKnownItems: 3738, stockUnknownItems: 11008, locationKnownItems: 0, locationUnknownItems: total },
    summary: { negativeReviewSkuCount: 612 },
    brandRollup: [
      { brandKey: "a", brandName: "A", negativeReviewCount: 0, negativeUnits: 0 },
      { brandKey: "b", brandName: "B", negativeReviewCount: 2, negativeUnits: 5 },
      { brandKey: "c", brandName: "C", negativeReviewCount: 1, negativeUnits: 9 }
    ],
    operations: { negativeInventory: { skuCount: 612, totalNegativeUnits: 900, recentlySellingCount: 10, topByUnits: Array.from({ length: 50 }, (_, i) => ({ i })) } },
    itemsTotal: params.status ? 612 : total, offset, limit, items: all
  };
};

test("inventory: default summary asks upstream for limit=1, never the full 14,746 rows", async () => {
  const up = stub({ "/api/inventory/overview": inventoryBody });
  const out = await runReadTool("get_inventory", {}, up);
  assert.deepEqual(up.calls[0].params, { limit: 1, offset: 0 });
  assert.equal(out.data.negativeInventory.topByUnits.length, 10);
  assert.equal(out.meta.completeness, "PARTIAL");
  assert.ok(JSON.stringify(out).length < 200_000);
});

test("inventory: items page uses upstream filters and pagination; default 20", async () => {
  const up = stub({ "/api/inventory/overview": inventoryBody });
  const page = await runReadTool("get_inventory", { view: "items", status: "negative_review" }, up);
  assert.deepEqual(up.calls[0].params, { status: "negative_review", limit: 20, offset: 0 });
  assert.equal(page.data.items.length, 20);
  assert.equal(page.data.itemsTotal, 612);
  assert.equal(page.data.items[0].barcode, undefined);
  const next = await runReadTool("get_inventory", { view: "items", status: "negative_review", offset: 20, limit: 100 }, up);
  assert.deepEqual(up.calls[1].params, { status: "negative_review", limit: 100, offset: 20 });
  assert.equal(next.data.items[0].productName, "P20");
});

test("inventory: negative brands view lists only brands with negative SKUs, most units first", async () => {
  const out = await runReadTool("get_inventory", { view: "brands", status: "negative_review" }, stub({ "/api/inventory/overview": inventoryBody }));
  assert.deepEqual(out.data.brands.map((b) => b.brandKey), ["c", "b"]);
  assert.equal(out.data.negativeInventory.skuCount, 612);
});

test("advertising: channel metrics pass through; one channel down is PARTIAL", async () => {
  const meta = { schemaVersion: 1, channel: "meta", source: "meta_marketing_api_cached", period: {}, status: "available", spend: 429562, clicks: 2244, platformRoas: 9.25, issues: [], attribution: { big: 1 }, extensions: { big: 1 } };
  const naver = { ...meta, channel: "naver", source: "naver-searchad-stats", spend: 84982, status: "unavailable", issues: ["NAVER request failed"] };
  const out = await runReadTool("get_advertising_summary", { since: "2026-10-01", until: "2026-10-05" }, stub({ "/api/advertising/overview": { ok: true, since: "2026-10-01", until: "2026-10-05", channels: [meta, naver], actualCommerce: null, notes: [] } }));
  assert.equal(out.data.channels[0].spend, 429562);
  assert.equal(out.data.channels[0].attribution, undefined);
  assert.equal(out.meta.completeness, "PARTIAL");
  assert.ok(out.meta.notes.some((n) => n.startsWith("naver: status unavailable")));
  assert.equal(out.data.actualCommerce, null);
});

test("commercial policy: AE SYNCTX explicit 10% passes through; list filters on returned fields", async () => {
  const single = { ok: true, found: true, policy_status: "EXPLICIT_POLICY", brand: { brandId: "B0000AES", name: "AE SYNCTX" },
    policy: { brand_code: "B0000AES", canonical_brand_name: "AE SYNCTX", sourcing_type: "CONSIGNMENT", stylist_discount_percent: 10, discount_status: "STANDARD", note: null, product_rules: [], source: { file: "x.xlsb", row: 29 } },
    effective_policy: { base_discount_percent: 10, effective_discount_percent: 10, decision_source: "BRAND_POLICY" }, fallback: null };
  const list = { ok: true, count: 3, policies: [
    { brand_code: "B1", canonical_brand_name: "X", sourcing_type: "WHOLESALE", stylist_discount_percent: 20, discount_status: "STANDARD" },
    { brand_code: "B2", canonical_brand_name: "Y", sourcing_type: "CONSIGNMENT", stylist_discount_percent: 10, discount_status: "STANDARD" },
    { brand_code: "B3", canonical_brand_name: "Z", sourcing_type: "WHOLESALE", stylist_discount_percent: 10, discount_status: "SPECIAL" }
  ] };
  const up = stub({ "/api/intelligence/commercial-policy": (p) => (p.name || p.brand_code ? (p.name === "nope" ? { ok: true, found: false } : single) : list) });
  const out = await runReadTool("get_commercial_policy", { brand: "AE SYNCTX" }, up);
  assert.equal(out.data.policyStatus, "EXPLICIT_POLICY");
  assert.equal(out.data.stylistDiscountPercent, 10);
  assert.equal(out.data.effectivePolicy.effective_discount_percent, 10);
  assert.deepEqual(up.calls[0].params, { name: "AE SYNCTX" });
  await runReadTool("get_commercial_policy", { brand: "B0000AES" }, up);
  assert.deepEqual(up.calls[1].params, { brand_code: "B0000AES" });
  const ten = await runReadTool("get_commercial_policy", { discountPercent: 10 }, up);
  assert.deepEqual(ten.data.policies.map((p) => p.brand_code), ["B2", "B3"]);
  assert.equal((await runReadTool("get_commercial_policy", { brand: "nope" }, up)).error.code, "NOT_FOUND");
});

test("upstream errors become structured tool errors", async () => {
  const up = stub({ "/api/sales/total": new ToolError("UPSTREAM_UNAVAILABLE", "Marketing OS returned HTTP 502", { retryable: true }) });
  const out = await runReadTool("get_sales_summary", { since: "2026-09-01", until: "2026-09-30" }, up);
  assert.deepEqual(out, { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Marketing OS returned HTTP 502", retryable: true, details: {} } });
});

test("monthly report drops order history and signed media URLs", async () => {
  const up = stub({ "/api/reports/monthly": { month: "2026-09", generatedAt: "t", status: "draft", archiveStatus: "saved",
    sales: { coverage: { complete: true } },
    commerce: { brandSales: [{ brand_code: "B1", brand_name: "X", salesAmount: 10, orderCount: 1, orderHistory: [{ orderId: "O-1", orderDate: "2026-09-01", products: [{ productName: "김병규 실장님 개인결제창" }] }] }], productSales: [] },
    marketing: {}, content: { topContent: [{ id: "1", date: "d", title: "t", type: "릴스", permalink: "https://www.instagram.com/p/x", mediaUrl: "https://cdn/x?oh=sig", thumbnailUrl: "https://cdn/t?oh=sig", coverImageUrl: "https://cdn/c", caption: "long", reach: 5, views: 6, saves: 1, shares: 2, likes: 3 }] } } });
  const out = await runReadTool("get_monthly_report", { month: "2026-09" }, up);
  assert.equal(out.data.commerce.brandSales[0].orderHistory, undefined);
  assert.equal(out.data.commerce.brandSales[0].salesAmount, 10);
  assert.deepEqual(Object.keys(out.data.content.topContent[0]).sort(), ["date", "id", "likes", "permalink", "reach", "saves", "shares", "title", "type", "views"]);
  assert.doesNotMatch(JSON.stringify(out), /O-1|oh=sig|김병규/);
});

test("every tool result is redacted for names with titles, phone numbers and emails", async () => {
  const up = stub({ "/api/inventory/overview": () => ({ ok: true, generatedAt: "t", coverage: {}, operations: {},
    brandRollup: [{ brandKey: "raw:김욱 이사님 의상 제작건", brandName: "김욱 이사님 의상 제작건", negativeReviewCount: 1, negativeUnits: 2 },
      { brandKey: "k2", brandName: "문의 010-1234-5678 / a.b@example.com", negativeReviewCount: 1, negativeUnits: 1 },
      { brandKey: "k3", brandName: "일반 손님 고객님 AE SYNCTX", negativeReviewCount: 1, negativeUnits: 0 },
      { brandKey: "k4", brandName: "페노메코님 개인결제창 26.08.15", negativeReviewCount: 1, negativeUnits: 0 }],
    itemsTotal: 0, items: [] }) });
  const out = await runReadTool("get_inventory", { view: "brands", status: "negative_review" }, up);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /김욱|이사님|010-1234-5678|a\.b@example\.com/);
  assert.equal(out.data.brands[0].brandName, "[비공개] 의상 제작건");
  assert.ok(text.includes("일반 손님 고객님 AE SYNCTX"), "generic words and brand names are untouched");
  assert.ok(text.includes("[비공개] 개인결제창 26.08.15"));
  assert.doesNotMatch(text, /페노메코/);
});

// Shapes observed on Production 2026-10-06 (/api/intelligence/commercial-policy).
const policyBodies = {
  BLUEMARBLE: { ok: true, brand: { brandId: "B0000BEI", name: "BLUEMARBLE", matchedBy: "name" }, found: false, policy_status: "SOURCING_DEFAULT", policy: null,
    fallback: { brand_code: "B0000BEI", canonical_brand_name: "BLUEMARBLE", sourcing_type: "WHOLESALE", stylist_discount_percent: 20, policy_status: "SOURCING_DEFAULT", policy_source: "brand-sourcing-master", warning: "Commercial Policy 미등록 브랜드입니다. sourcing 기반 기본 권장 할인율입니다." },
    effective_policy: { base_discount_percent: 20, effective_discount_percent: 20, matched_product_rule: null, product_name: null, decision_source: "SOURCING_FALLBACK" } },
  "AE SYNCTX": { ok: true, brand: { brandId: "B00000MT", name: "AE SYNCTX", matchedBy: "name" }, found: true, policy_status: "EXPLICIT_POLICY",
    policy: { brand_code: "B00000MT", canonical_brand_name: "AE SYNCTX", sourcing_type: "CONSIGNMENT", stylist_discount_percent: 10, discount_status: "STANDARD", note: null, product_rules: [], source: { file: "x.xlsb", row: 29 } },
    fallback: null, effective_policy: { base_discount_percent: 10, effective_discount_percent: 10, decision_source: "BRAND_POLICY" } },
  unknown: { ok: true, brand: null, found: false, policy_status: "UNRESOLVED", policy: null, fallback: null, effective_policy: null },
  B9999ZZZ: { ok: true, brand: { brandId: "B9999ZZZ", name: null, matchedBy: "brand_code" }, found: false, policy_status: "UNRESOLVED", policy: null, fallback: null, effective_policy: null }
};
const policyStub = () => stub({ "/api/intelligence/commercial-policy": (p) => policyBodies[p.name || p.brand_code] || policyBodies.unknown });

test("commercial policy: SOURCING_DEFAULT fallback brand is returned, not NOT_FOUND", async () => {
  const out = await runReadTool("get_commercial_policy", { brand: "BLUEMARBLE" }, policyStub());
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.equal(out.data.brand.brandCode, "B0000BEI");
  assert.equal(out.data.brandCode, "B0000BEI");
  assert.equal(out.data.explicitPolicy, false);
  assert.equal(out.data.policySource, "SOURCING_DEFAULT");
  assert.equal(out.data.sourcingType, "WHOLESALE");
  assert.equal(out.data.discountPercent, 20);
  assert.equal(out.data.stylistDiscountPercent, 20);
  assert.equal(out.data.effectivePolicy.decision_source, "SOURCING_FALLBACK");
  assert.ok(out.meta.notes.some((n) => n.includes("SOURCING_DEFAULT")));
});

test("commercial policy: explicit policy keeps precedence (AE SYNCTX 10%)", async () => {
  const out = await runReadTool("get_commercial_policy", { brand: "AE SYNCTX" }, policyStub());
  assert.equal(out.data.explicitPolicy, true);
  assert.equal(out.data.policySource, "EXPLICIT_POLICY");
  assert.equal(out.data.discountPercent, 10);
  assert.equal(out.data.sourcingType, "CONSIGNMENT");
  assert.deepEqual(out.data.sourceDocument, { file: "x.xlsb", row: 29 });
});

test("commercial policy: unresolved brand name or code is NOT_FOUND", async () => {
  for (const brand of ["zzzz-not-a-brand", "B9999ZZZ"]) {
    assert.equal((await runReadTool("get_commercial_policy", { brand }, policyStub())).error?.code, "NOT_FOUND", brand);
  }
});

test("get_brand: fallback brand shows explicit vs effective policy", async () => {
  const routes = { ...brandRoutes(), "/api/intelligence/brands/resolve": { ok: true, brand: { brandId: "B0000BEI", name: "BLUEMARBLE" } },
    "/api/brand-master": { ok: true, updatedAt: "t", brands: [{ brand_code: "B0000BEI", brand_name: "BLUEMARBLE", name_aliases: ["BLUEMARBLE"], active: true, sourcing_type: "WHOLESALE" }] },
    "/api/intelligence/commercial-policy": policyBodies.BLUEMARBLE };
  const out = await runReadTool("get_brand", { brand: "BLUEMARBLE" }, stub(routes));
  const cp = out.data.commercialPolicy;
  assert.equal(cp.policyStatus, "SOURCING_DEFAULT");
  assert.equal(cp.explicitPolicy, false);
  assert.equal(cp.stylistDiscountPercent, 20);
  assert.equal(cp.discountPercent, 20);
  assert.equal(cp.policySource, "SOURCING_DEFAULT");
  assert.equal(out.data.sourcingType, "WHOLESALE");
});
