import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOf(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} source missing`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(start, index + 1);
  }
  throw new Error(`${name} source incomplete`);
}

function archiveLoader(getSharedJson) {
  const source = sourceOf("getEntityCompareMonthlyArchive").replace(/^function /, "async function ");
  return Function(
    "getSharedJson",
    `const ENTITY_COMPARE_ARCHIVE_TIMEOUT_MS=8000; const ENTITY_COMPARE_ARCHIVE_RETRY_TIMEOUT_MS=30000; ${source}; return getEntityCompareMonthlyArchive;`
  )(getSharedJson);
}

test("saved archive keeps the fast comparison path", async () => {
  const calls = [];
  const archive = { archiveStatus: "saved", commerce: { brandSales: [] } };
  const result = await archiveLoader(async (url, timeout) => { calls.push([url, timeout]); return archive; })("2026-07");
  assert.deepEqual(calls, [["/api/reports/monthly?month=2026-07", 8000]]);
  assert.deepEqual(result, { archive, status: "success" });
});

test("draft archive timeout retries once beyond the old 8-second boundary", async () => {
  const calls = [];
  const archive = { archiveStatus: "draft", commerce: { brandSales: [{ brand_code: "A", paidAmount: 10 }] } };
  const result = await archiveLoader(async (url, timeout) => {
    calls.push([url, timeout]);
    return calls.length === 1 ? { error: "응답 지연" } : archive;
  })("2025-08");
  assert.deepEqual(calls.map((call) => call[1]), [8000, 30000]);
  assert.deepEqual(result, { archive, status: "success" });
});

test("second timeout and actual failures remain distinct states", async () => {
  const delayed = await archiveLoader(async () => ({ error: "응답 지연" }))("2025-08");
  const failed = await archiveLoader(async () => ({ error: "API 오류 500" }))("2025-08");
  assert.equal(delayed.status, "timeout");
  assert.equal(failed.status, "error");
});

test("valid archive without a brand row remains honest null for both brands", () => {
  const rowFromArchive = Function(
    "monthlyReportBrandCode", "canonicalPaidAmount",
    `${sourceOf("entityCompareKpiRowFromArchive")}; return entityCompareKpiRowFromArchive;`
  )((row) => row.brand_code, (row) => row.paidAmount);
  const archive = { commerce: { brandSales: [{ brand_code: "A", paidAmount: 10, quantitySold: 1, orderCount: 1 }] } };
  assert.equal(rowFromArchive(archive, "B"), null);
  assert.equal(rowFromArchive(archive, "C"), null);
  assert.equal(rowFromArchive(archive, "A").revenue, 10);
});

test("previous month and YoY keys work while custom stays unimplemented", () => {
  const periodKey = Function("entityPeriodState", `${sourceOf("entityComparePeriodKeyForMode")}; return entityComparePeriodKeyForMode;`)({ mode: "monthly", year: 2026, month: 8 });
  assert.equal(periodKey("prev"), "2026-07");
  assert.equal(periodKey("yoy"), "2025-08");
  assert.equal(periodKey("custom"), null);
});

test("Monthly Trend keeps its existing shared 8-second fetch and comparison calculation", () => {
  const trend = sourceOf("refreshEntityTrendMonths");
  assert.match(trend, /getSharedJson\(`\/api\/reports\/monthly\?month=\$\{month\}`, 8000\)/);
  assert.match(trend, /entityTrendCompareMonths = compareBrandCode \? months\.map/);
});
