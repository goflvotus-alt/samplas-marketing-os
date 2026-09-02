import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

function sourceOf(name) {
  const starts = [`async function ${name}(`, `function ${name}(`].map((token) => source.indexOf(token)).filter((index) => index >= 0);
  const start = Math.min(...starts);
  assert.ok(Number.isFinite(start), `${name} missing`);
  const bodyStart = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} incomplete`);
}

test("optional Meta/Instagram failures become explicit unavailable state", async () => {
  const fn = Function("safeErrorMessage", `${sourceOf("monthlyOptionalSource")}; return monthlyOptionalSource;`)((error) => error?.message || String(error));
  const result = await fn(async () => { throw new Error("token invalid"); });
  assert.deepEqual(result, { available: false, error: "token invalid", data: {} });
});

test("missing September ECOUNT produces null offline/total and never reuses August", async () => {
  const fn = Function(
    "finiteNumberOrZero", "readEcountOfflineSalesSnapshot", "workDir",
    `${sourceOf("buildMonthlyArchiveSales")}; return buildMonthlyArchiveSales;`
  )((value) => Number.isFinite(Number(value)) ? Number(value) : 0, async (month) => {
    assert.equal(month, "2026-09");
    return null;
  }, "/tmp/work");
  const result = await fn("2026-09-01", "2026-09-30", { source: "cafe24", totals: { paidAmount: 123 } });
  assert.equal(result.onlineSales.paidAmount, 123);
  assert.equal(result.offlineSales.offlineSalesAmount, null);
  assert.equal(result.totalSales.amount, null);
  assert.equal(result.coverage.offline, false);
  assert.deepEqual(result.coverage.missingMonths, ["2026-09"]);
  assert.equal(result.provenance.ecount.available, false);
});

test("Clients coverage distinguishes missing ECOUNT from a genuine available zero", async () => {
  const load = (snapshot) => Function(
    "instagramRangeMonthKeys", "readEcountOfflineSalesSnapshot", "workDir", "monthRequestBounds",
    `${sourceOf("buildClientsSourceCoverage")}; return buildClientsSourceCoverage;`
  )(() => ["2026-09"], async () => snapshot, "/tmp/work", () => ({ start: "2026-09-01", end: "2026-09-01" }));

  const missing = await load(null)("2026-09-01", "2026-09-01", null, true);
  assert.equal(missing.offline.available, false);
  assert.deepEqual(missing.offline.missingMonths, ["2026-09"]);
  assert.equal(missing.complete, false);

  const zero = await load({ periodStart: "2026-09-01", periodEnd: "2026-09-01", salesLines: [] })("2026-09-01", "2026-09-01", null, true);
  assert.equal(zero.offline.available, true);
  assert.deepEqual(zero.offline.missingMonths, []);
  assert.equal(zero.complete, true);
});

test("Monthly and Clients routes preserve canonical errors while isolating optional/coverage state", () => {
  const monthly = source.slice(source.indexOf("export async function buildMonthlyArchive"), source.indexOf("async function buildMonthlyArchiveBrandSales"));
  assert.match(monthly, /buildBrandSalesDiagnostics\(monthStart, monthEnd\)/);
  assert.match(monthly, /monthlyOptionalSource\(\(\) => buildMetaAdsSummaryWithCache/);
  assert.match(monthly, /monthlyOptionalSource\(\(\) => buildInstagramMonthlyDataWithCache/);
  assert.match(monthly, /status: \{ available: metaAvailable/);
  assert.match(monthly, /status: \{ available: instagramResult\.available/);

  const clients = source.slice(source.indexOf('if (url.pathname === "/api/intelligence/clients")'), source.indexOf('if (url.pathname === "/api/intelligence/store")'));
  assert.match(clients, /coverage\.offline\.available \? overview\.summary/);
  assert.match(clients, /offlineSalesAmount: null/);
  assert.match(clients, /totalSalesAmount: null/);
});
