import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { attachCoverage, matchNaverRegistration, operationStatus, summarizeCafe24Products } from "../scripts/new-brand-coverage.mjs";
import { buildNewBrands } from "../scripts/new-brands.mjs";

const asOf = new Date("2026-10-04T12:00:00+09:00");
const daysAgo = n => new Date(Date.parse("2026-10-04T10:00:00+09:00") - n * 86_400_000).toISOString();
const product = (brand_code, display = "T", selling = "T", sold_out = "F") => ({ product_no: Math.random(), brand_code, display, selling, sold_out });
const adgroups = [{ name: "샘플라스", paused: false }, { name: " LAMENTIST", paused: false }, { name: "CRAIG GREEN", paused: false }, { name: "AESYNCTX", paused: false },
  { name: "RANRA", paused: true }, { name: "ROCKSTEADY", paused: false }, { name: "RECORDS INC SALE", paused: false }, { name: "Meantime", paused: false }];

function newBrands(rows) {
  const brands = rows.map(([code, name, n, extra = {}]) => ({ brand_code: code, brand_name: name, active: true, sourcing_type: "WHOLESALE", ...extra }));
  const queue = { candidates: rows.map(([code, , n]) => ({ id: code, status: "APPROVED", approvalAction: "NEW", canonicalBrandCode: code, approvedAt: daysAgo(n) })) };
  return buildNewBrands({ brands, queue, asOf });
}

test("Cafe24 sellable = displayed, selling and not sold out; a brand code with no products is not sellable", () => {
  assert.deepEqual(summarizeCafe24Products([], "B1"), { productCount: 0, displayedProductCount: 0, sellableProductCount: 0, hasSellableProducts: false });
  const mixed = [product("B1"), product("B1", "T", "T", "T"), product("B1", "F", "F", "T"), product("B1", "T", "F"), product("B2")];
  assert.deepEqual(summarizeCafe24Products(mixed, "B1"), { productCount: 4, displayedProductCount: 2, sellableProductCount: 1, hasSellableProducts: true });
  assert.equal(summarizeCafe24Products([product("B1", "T", "T", "T")], "B1").hasSellableProducts, false, "sold-out only is not sellable");
});

test("NAVER match: whole name under normalizeBrandKey or Brand Master alias; no substring; paused groups do not count", () => {
  assert.deepEqual(matchNaverRegistration({ brandName: "LAMENTIST" }, adgroups), { registered: true, matchedBy: "adgroup", adgroupName: "LAMENTIST", pausedOnly: false });
  assert.equal(matchNaverRegistration({ brandName: "MEANTIME" }, adgroups).registered, true, "case-insensitive");
  assert.deepEqual(matchNaverRegistration({ brandName: "AE SYNCTX", aliases: ["AESYNCTX"] }, adgroups).matchedBy, "adgroup-alias");
  assert.equal(matchNaverRegistration({ brandName: "AE SYNCTX" }, adgroups).registered, false, "no alias, no space-insensitive guessing");
  for (const name of ["RECORDS INC", "RECORDS", "ROCK", "SAMPLAS"]) assert.equal(matchNaverRegistration({ brandName: name }, adgroups).registered, false, name);
  assert.deepEqual(matchNaverRegistration({ brandName: "RANRA" }, adgroups), { registered: false, matchedBy: null, adgroupName: "RANRA", pausedOnly: true });
});

test("status order: not sellable → 새브랜드 입고; sellable without NAVER → NAVER 미등록; both → 완료", () => {
  assert.deepEqual(operationStatus({ hasSellableProducts: false }, { registered: true }), { operationStatus: "NEW_BRAND_ARRIVED", operationStatusLabel: "새브랜드 입고" });
  assert.deepEqual(operationStatus({ hasSellableProducts: true }, { registered: false }), { operationStatus: "NAVER_MISSING", operationStatusLabel: "NAVER 미등록" });
  assert.deepEqual(operationStatus({ hasSellableProducts: true }, { registered: true }), { operationStatus: "COMPLETE", operationStatusLabel: "완료" });
});

test("attachCoverage over buildNewBrands: inactive and D+90 excluded; unknown data never upgrades a brand", () => {
  const base = newBrands([["B_ARRIVED", "Fresh Label", 1], ["B_MISSING", "RECORDS INC", 0], ["B_DONE", "LAMENTIST", 0], ["B_OLD", "CRAIG GREEN", 90], ["B_OFF", "Ghost", 2, { active: false }],
    ["B_CAFE24_ERR", "Error Brand", 3], ["B_PAUSED", "RANRA", 4]]);
  assert.deepEqual(base.brands.map(b => b.brandCode).sort(), ["B_ARRIVED", "B_CAFE24_ERR", "B_DONE", "B_MISSING", "B_PAUSED"], "inactive and D+90 excluded");
  const cafe24ByCode = new Map([
    ["B_ARRIVED", summarizeCafe24Products([], "B_ARRIVED")],
    ["B_MISSING", summarizeCafe24Products([product("B_MISSING")], "B_MISSING")],
    ["B_DONE", summarizeCafe24Products([product("B_DONE")], "B_DONE")],
    ["B_CAFE24_ERR", { error: "Cafe24 brand_code filter was not applied" }],
    ["B_PAUSED", summarizeCafe24Products([product("B_PAUSED")], "B_PAUSED")]
  ]);
  const out = attachCoverage(base, { cafe24ByCode, naverIndex: { ok: true, fetchedAt: "t", adgroups } });
  const status = Object.fromEntries(out.brands.map(b => [b.brandCode, b.operationStatusLabel]));
  assert.deepEqual(status, { B_ARRIVED: "새브랜드 입고", B_MISSING: "NAVER 미등록", B_DONE: "완료", B_CAFE24_ERR: "새브랜드 입고", B_PAUSED: "NAVER 미등록" });
  assert.equal(out.brands.find(b => b.brandCode === "B_ARRIVED").naver.checked, false, "NAVER not checked without sellable products");
  assert.equal(out.brands.find(b => b.brandCode === "B_CAFE24_ERR").cafe24.checked, false);
  assert.deepEqual(out.statusCounts, { NEW_BRAND_ARRIVED: 2, NAVER_MISSING: 2, COMPLETE: 1 });

  const naverDown = attachCoverage(base, { cafe24ByCode, naverIndex: { ok: false, error: "Naver Search Ads request failed", adgroups: [] } });
  assert.equal(naverDown.brands.find(b => b.brandCode === "B_DONE").operationStatus, "NAVER_MISSING", "NAVER outage never reports 완료");
  assert.equal(naverDown.coverage.naverError, "Naver Search Ads request failed");
});

test("server wiring: /api/brands/new keeps the plain response with coverage=0; Cafe24 filter is verified; NAVER is read-only", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /buildNewBrandsResponse\(new Date\(\), \{ coverage: url\.searchParams\.get\("coverage"\) !== "0" \}\)/);
  assert.match(server, /if \(!coverage\) return result;/);
  assert.match(server, /if \(products\.some\(\(p\) => p\.brand_code !== brandCode\)\) throw new Error\("Cafe24 brand_code filter was not applied"\);/);
  const intel = await readFile(new URL("../intelligence-service.mjs", import.meta.url), "utf8");
  assert.match(intel, /\["\/ncc\/campaigns", "\/ncc\/adgroups", "\/stats"\]\.includes\(uri\)/);
  assert.doesNotMatch(intel.slice(intel.indexOf("async function fetchNaverAdsReadOnly"), intel.indexOf("function normalizeNaverAdsCampaigns")), /method: "(POST|PUT|DELETE)"/);
});

test("panel: status-first sorting, Korean labels only, 10/04 date and summary line", async () => {
  const source = await readFile(new URL("../outputs/new-brands-panel.js", import.meta.url), "utf8");
  const window = {};
  runInNewContext(source, { window, document: { readyState: "complete", getElementById: () => null }, fetch: async () => ({}), Intl, Date });
  const api = window.SamplasNewBrands;
  const rows = [
    { brandName: "LAMENTIST", approvedAt: "2026-10-04T05:39:39Z", operationStatus: "COMPLETE", operationStatusLabel: "완료", daysSinceOnboarding: 0, sourcingType: "WHOLESALE" },
    { brandName: "Fresh", approvedAt: "2026-10-03T05:00:00Z", operationStatus: "NEW_BRAND_ARRIVED", operationStatusLabel: "새브랜드 입고", daysSinceOnboarding: 1, sourcingType: "CONSIGNMENT" },
    { brandName: "RECORDS INC", approvedAt: "2026-10-04T05:38:15Z", operationStatus: "NAVER_MISSING", operationStatusLabel: "NAVER 미등록", daysSinceOnboarding: 0, sourcingType: "WHOLESALE" }
  ];
  assert.deepEqual([...api.sortRows(rows).map(r => r.brandName)], ["RECORDS INC", "Fresh", "LAMENTIST"]);
  const html = api.rowsHtml(rows);
  assert.match(html, /<td>RECORDS INC<\/td>\s*<td>10\/04<\/td>\s*<td>D\+0<\/td>\s*<td>사입<\/td>\s*<td>NAVER 미등록<\/td>/);
  assert.doesNotMatch(html, /NAVER_MISSING|COMPLETE|NEW_BRAND_ARRIVED/);
  assert.equal(api.summary({ count: 3, statusCounts: { NEW_BRAND_ARRIVED: 1, NAVER_MISSING: 1, COMPLETE: 1 } }), "최근 90일 신규 브랜드 3 · 새브랜드 입고 1 · NAVER 미등록 1 · 완료 1");
  assert.match(api.rowsHtml([{ ...rows[0], brandName: "<img onerror=x>" }]), /&lt;img onerror=x&gt;/);
});
