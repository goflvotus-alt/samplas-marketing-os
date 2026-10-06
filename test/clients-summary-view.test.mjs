import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEcountSalesSnapshot } from "../scripts/import-ecount-offline-sales.mjs";
import { buildClientsOverview } from "../intelligence-service.mjs";
import { toClientsSummaryView } from "../scripts/clients-summary-view.mjs";

const line = (date, customerName, amount, slipNo) => ({
  date, slipNo, documentNo: slipNo, productName: "NAMILIA / Test Item", specification: "OS", quantity: 1, brandGroup: "NAM",
  customerName, poNo: slipNo, salesAmount: amount, isPersonalPayment: false, personalPaymentReason: null, isOfflineRevenue: true, storeCode: "APGUJEONG"
});

async function withSnapshot(lines, fn) {
  const dir = await mkdtemp(join(tmpdir(), "clients-summary-"));
  try {
    const workDir = join(dir, "work");
    const total = lines.reduce((sum, l) => sum + l.salesAmount, 0);
    const snapshot = buildEcountSalesSnapshot({
      fileName: "2026-08.xlsx", periodStart: lines[0].date, periodEnd: lines.at(-1).date, totalOfflineSales: total,
      totalLineCount: lines.length, revenueLineCount: lines.length, nonRevenueLineCount: 0, personalPaymentSales: 0, personalPaymentCount: 0,
      dailySales: [{ date: lines[0].date, offlineSalesAmount: total, revenueLineCount: lines.length, totalLineCount: lines.length, quantity: lines.length }],
      salesLines: lines
    }, "2026-08", { storeCode: "APGUJEONG" });
    await mkdir(join(workDir, "ecount-sales"), { recursive: true });
    await writeFile(join(workDir, "ecount-sales", "2026-08.APGUJEONG.json"), JSON.stringify(snapshot));
    return await fn(workDir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const LINES = [
  line("2026-08-01", "김하나 실장님", 120000, "1"),
  line("2026-08-02", "김하나실장님", 80000, "2"),
  line("2026-08-03", "TAXFREE 외국인", 300000, "3"),
  line("2026-08-04", "매장방문고객", 50000, "4"),
  line("2026-08-05", "TAXFREE 외국인", 150000, "5")
];

test("details:false keeps every aggregate identical to the full build; only per-line details are skipped", () => withSnapshot(LINES, async (workDir) => {
  const args = { since: "2026-08-01", until: "2026-08-31", cafe24Orders: [], workDir };
  const full = await buildClientsOverview(args);
  const light = await buildClientsOverview({ ...args, details: false });
  assert.ok(full.clients.length >= 3, "fixture produces several client groups");
  assert.ok(full.clients.some((c) => c.purchaseDetails.length > 0));
  assert.deepEqual(light.summary, full.summary);
  assert.deepEqual(light.typeBreakdown, full.typeBreakdown);
  assert.deepEqual(light.meta, full.meta);
  const aggregates = (c) => ({ clientId: c.clientId, clientType: c.clientType, purchaseCount: c.purchaseCount, onlineSales: c.onlineSales, offlineSales: c.offlineSales, totalSales: c.totalSales });
  assert.deepEqual(light.clients.map(aggregates), full.clients.map(aggregates));
  assert.ok(light.clients.every((c) => c.purchaseDetails.length === 0));
  const foreign = full.typeBreakdown.find((t) => t.type === "foreign");
  assert.equal(foreign.salesAmount, 450000);
  assert.deepEqual(light.typeBreakdown.find((t) => t.type === "foreign"), foreign);
}));

test("summary view is an allowlist: aggregates and coverage only, no client names or details", () => {
  const payload = {
    ok: true, periodStart: "2026-08-01", periodEnd: "2026-08-31", storeCode: null,
    summary: { totalClients: 3 }, typeBreakdown: [{ type: "foreign", salesAmount: 1 }], meta: { excludedGiftCount: 0 },
    coverage: { complete: false }, storeCoverage: { includedMonths: ["2026-08"] }, accounting: { basis: "x" },
    clients: [{ name: "김하나", aliases: ["김하나 실장님"] }], stylistTop10: [{ name: "김하나" }], pressTop10: [], ffTop10: [], futureDetail: [{ name: "x" }]
  };
  const view = toClientsSummaryView(payload);
  assert.deepEqual(Object.keys(view).sort(), ["accounting", "coverage", "meta", "ok", "periodEnd", "periodStart", "storeCode", "storeCoverage", "summary", "typeBreakdown", "view"]);
  assert.doesNotMatch(JSON.stringify(view), /김하나/);
  assert.equal(view.typeBreakdown, payload.typeBreakdown);
});

test("route wiring: full response unchanged by default; view=summary uses details:false and the summary serializer", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /const summaryView = url\.searchParams\.get\("view"\) === "summary";/);
  assert.match(server, /buildClientsOverview\(\{ since, until, cafe24Orders: cafe24\.orders, storeCode, details: !summaryView \}\)/);
  assert.match(server, /return json\(res, summaryView \? toClientsSummaryView\(payload\) : payload\);/);
});
