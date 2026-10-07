import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request, createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveHistoricalMonthlySales } from "../server.mjs";

// Production values (2026-10-07): saved archive amounts and the live canonical /api/sales/total online.
const sales = (online, offline, total, coverage = { complete: true }) => ({ periodStart: "x", periodEnd: "y", onlineSales: { paidAmount: online }, offlineSales: { offlineSalesAmount: offline }, totalSales: { amount: total }, coverage });
const canonical = (online, offline = 0, total = online + offline) => ({ onlineSales: { paidAmount: online }, offlineSales: { offlineSalesAmount: offline }, totalSales: { amount: total } });

test("complete month: canonical live online + archive offline, archive online kept as metadata", () => {
  for (const [archive, live, total] of [[sales(35571903, 237972530, 273544433), 35000863, 272973393], [sales(34332620, 253583500, 287916120), 34722620, 288306120]]) {
    const view = resolveHistoricalMonthlySales({ sales: archive, canonical: canonical(live), offlineThrough: null, since: "2026-07-01", until: "2026-07-31" });
    assert.equal(view.onlineSales.paidAmount, live);
    assert.equal(view.offlineSales.offlineSalesAmount, archive.offlineSales.offlineSalesAmount, "archive offline preserved");
    assert.equal(view.totalSales.amount, total, "total recomputed");
    assert.deepEqual(view.coverage, archive.coverage);
    assert.deepEqual(view.reconciliation, { basis: "historical_canonical_online", onlineBasis: "canonical_live", canonicalOnlineAmount: live,
      archiveOnlineAmount: archive.onlineSales.paidAmount, onlineDeltaFromArchive: live - archive.onlineSales.paidAmount,
      offlineBasis: "saved_monthly_archive", archiveOfflineAmount: archive.offlineSales.offlineSalesAmount });
    assert.equal(archive.onlineSales.paidAmount !== live, true, "input object is not mutated");
  }
});

test("complete month with identical online is unchanged; canonical failure shows the archive and says so", () => {
  const same = resolveHistoricalMonthlySales({ sales: sales(100, 50, 150), canonical: canonical(100), since: "x", until: "y" });
  assert.deepEqual([same.onlineSales.paidAmount, same.totalSales.amount, same.reconciliation.onlineDeltaFromArchive], [100, 150, 0]);
  const failed = resolveHistoricalMonthlySales({ sales: sales(100, 50, 150), canonical: null, since: "x", until: "y" });
  assert.deepEqual([failed.onlineSales.paidAmount, failed.offlineSales.offlineSalesAmount, failed.totalSales.amount], [100, 50, 150]);
  assert.equal(failed.reconciliation.onlineBasis, "saved_monthly_archive");
  assert.equal(failed.reconciliation.canonicalOnlineAmount, null);
});

test("partial month (null archive offline, September): canonical known amounts, partial coverage, never 0", () => {
  const archive = sales(30967793, null, null, { complete: false, partialMonths: ["2026-09"] });
  const view = resolveHistoricalMonthlySales({ sales: archive, canonical: canonical(31099793, 201473160, 232572953), offlineThrough: "2026-09-29", since: "2026-09-01", until: "2026-09-30" });
  assert.deepEqual([view.onlineSales.paidAmount, view.offlineSales.offlineSalesAmount, view.totalSales.amount], [31099793, 201473160, 232572953]);
  assert.deepEqual(view.coverage, archive.coverage, "coverage stays partial");
  assert.equal(view.reconciliation.basis, "canonical_partial_coverage");
  assert.deepEqual(view.reconciliation.asOf, { basis: "canonical_partial_coverage", onlineThrough: "2026-09-30", offlineThrough: "2026-09-29", missingOfflineDays: 1, coverage: "partial" });
  const unknown = resolveHistoricalMonthlySales({ sales: archive, canonical: canonical(1, null, null), offlineThrough: null, since: "2026-09-01", until: "2026-09-30" });
  assert.equal(unknown.offlineSales.offlineSalesAmount, null);
  assert.equal(unknown.totalSales.amount, null);
});

const get = (port, path) => new Promise((resolve, reject) => {
  request({ host: "127.0.0.1", port, path, headers: { host: "127.0.0.1" } }, (res) => {
    let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve(JSON.parse(body)));
  }).on("error", reject).end();
});

test("route: past-month Monthly shows the canonical view while the saved archive file stays byte-identical", { timeout: 30000 }, async () => {
  const kstToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const [y, m] = kstToday.slice(0, 7).split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 7);
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  const dir = await mkdtemp(join(tmpdir(), "monthly-hist-"));
  for (const sub of ["ecount-sales", "monthly"]) await mkdir(join(dir, sub), { recursive: true });
  for (const name of ["product-registry.json", "product-registry-review-queue.json", "brand-commercial-policy.json", "brand-sourcing-master.json"]) await writeFile(join(dir, name), JSON.stringify({ entries: [], brands: [], policies: [] }));
  await writeFile(join(dir, "brand-master.json"), JSON.stringify({ brands: [] }));
  const line = { date: `${month}-02`, productName: "ONE / Tee", quantity: 1, salesAmount: 50000, isOfflineRevenue: true };
  await writeFile(join(dir, "ecount-sales", `${month}.json`), JSON.stringify({ month, periodStart: `${month}-01`, periodEnd: lastDay, importedAt: "2026-01-01T00:00:00.000Z", totalOfflineSales: 50000, salesLines: [line], rows: [line] }));
  // Archive froze an online amount (70,000) that the live Cafe24 source no longer has (0).
  const archive = { month, archiveStatus: "saved", sales: { periodStart: `${month}-01`, periodEnd: lastDay, onlineSales: { paidAmount: 70000 }, offlineSales: { offlineSalesAmount: 50000 }, totalSales: { amount: 120000 }, coverage: { complete: true } },
    commerce: { paidAmount: 70000, brandSales: [], brandSalesBasis: "online_offline", brandSalesSourceImportedAt: "2026-01-01T00:00:00.000Z" } };
  const archiveText = JSON.stringify(archive);
  await writeFile(join(dir, "monthly", `${month}.json`), archiveText);
  const proxy = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ orders: [], brands: [], products: [], totals: {} })); });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], { cwd: dir, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WORK_DIR: dir, HOST: "127.0.0.1", PORT: String(port), CAFE24_PROXY_BASE_URL: `http://127.0.0.1:${proxy.address().port}`, META_ACCESS_TOKEN: "", INSTAGRAM_ACCESS_TOKEN: "" } });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
      child.stdout.on("data", (c) => { if (String(c).includes("running at")) { clearTimeout(timer); resolve(); } });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exit ${code}`)); });
    });
    const body = await get(port, `/api/reports/monthly?month=${month}`);
    assert.equal(body.archiveStatus, "saved");
    assert.equal(body.sales.onlineSales.paidAmount, 0, "live canonical online");
    assert.equal(body.sales.offlineSales.offlineSalesAmount, 50000);
    assert.equal(body.sales.totalSales.amount, 50000);
    assert.equal(body.sales.reconciliation.archiveOnlineAmount, 70000);
    assert.equal(body.sales.reconciliation.onlineDeltaFromArchive, -70000);
    assert.equal(await readFile(join(dir, "monthly", `${month}.json`), "utf8"), archiveText, "archive file is not rewritten");
  } finally {
    child.kill("SIGTERM");
    proxy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("UI: the Monthly summary sentence reads the same online figure as the KPI card", async () => {
  const frontend = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  assert.match(frontend, /monthlyReportDirectionText\("온라인 실제 매출은",\s*hasApiValue\(archive\.sales\?\.onlineSales\?\.paidAmount\) \? archive\.sales\.onlineSales\.paidAmount : commerce\.paidAmount,/);
});
