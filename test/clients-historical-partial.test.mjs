import test from "node:test";
import assert from "node:assert/strict";
import { finiteOrNull, reconcileHistoricalClientsSummary, resolveHistoricalClientsSales } from "../server.mjs";

// Production 2026-10-07 read-only audit values (docs/reports/CLIENTS-HISTORICAL-SALES-ROOT-CAUSE-2026-10-07.md).
const masked = { totalClients: 101, onlineSalesAmount: 30967793, offlineSalesAmount: null, totalSalesAmount: null, totalPurchaseCount: null, orderCount: null, avgOrderValue: null };
const detail = { totalSalesAmount: 231785953 };
const septArchive = { archiveStatus: "saved", sales: { onlineSales: { paidAmount: 30967793 }, offlineSales: { offlineSalesAmount: null }, totalSales: { amount: null } } };
const septCanonical = { onlineSales: { paidAmount: 30967793 }, offlineSales: { offlineSalesAmount: 201473160 }, totalSales: { amount: 232440953 }, coverage: { complete: false, partialMonths: ["2026-09"] } };
const augArchive = { archiveStatus: "saved", sales: { onlineSales: { paidAmount: 34332620 }, offlineSales: { offlineSalesAmount: 253583500 }, totalSales: { amount: 287916120 } } };

test("finiteOrNull: missing is unknown, a real 0 is 0", () => {
  for (const missing of [null, undefined, "", "abc", NaN]) assert.equal(finiteOrNull(missing), null);
  assert.equal(finiteOrNull(0), 0);
  assert.equal(finiteOrNull("0"), 0);
  assert.equal(finiteOrNull(12.5), 12.5);
});

test("null archive totals are never turned into 0 by the reconcile itself", () => {
  const { summary, accounting } = reconcileHistoricalClientsSummary(masked, detail, septArchive);
  assert.equal(summary.totalSalesAmount, null);
  assert.equal(summary.offlineSalesAmount, null);
  assert.equal(summary.onlineSalesAmount, 30967793, "numeric online is kept");
  assert.equal(summary.avgOrderValue, null);
  assert.equal(accounting.unassignedRevenue, null);
});

test("closed month with null archive total shows canonical known amounts, partial, offline through 09-29", () => {
  const r = resolveHistoricalClientsSales({ summary: masked, detailSummary: detail, archive: septArchive, canonical: septCanonical, offlineThrough: "2026-09-29", since: "2026-09-01", until: "2026-09-30" });
  assert.deepEqual([r.summary.onlineSalesAmount, r.summary.offlineSalesAmount, r.summary.totalSalesAmount], [30967793, 201473160, 232440953]);
  assert.equal(r.summary.totalClients, 101);
  // Counts the source does not have stay null; nothing is estimated.
  assert.equal(r.summary.totalPurchaseCount, null);
  assert.equal(r.summary.orderCount, null);
  assert.equal(r.summary.avgOrderValue, null);
  assert.deepEqual(r.asOf, { basis: "canonical_partial_coverage", onlineThrough: "2026-09-30", offlineThrough: "2026-09-29", missingOfflineDays: 1, coverage: "partial" });
  assert.equal(r.accounting.basis, "canonical_partial_coverage");
  assert.equal(r.accounting.unassignedRevenue, 232440953 - 231785953);
});

test("all canonical amounts unknown stay null; a real canonical 0 is shown as 0", () => {
  const unknown = resolveHistoricalClientsSales({ summary: masked, detailSummary: detail, archive: septArchive, canonical: null, offlineThrough: null, since: "2026-09-01", until: "2026-09-30" });
  assert.deepEqual([unknown.summary.onlineSalesAmount, unknown.summary.offlineSalesAmount, unknown.summary.totalSalesAmount], [null, null, null]);
  assert.equal(unknown.asOf.offlineThrough, null);
  assert.equal(unknown.asOf.missingOfflineDays, null);
  const zero = resolveHistoricalClientsSales({ summary: masked, detailSummary: detail, archive: septArchive,
    canonical: { onlineSales: { paidAmount: 0 }, offlineSales: { offlineSalesAmount: 0 }, totalSales: { amount: 0 } }, offlineThrough: "2026-09-29", since: "2026-09-01", until: "2026-09-30" });
  assert.deepEqual([zero.summary.onlineSalesAmount, zero.summary.offlineSalesAmount, zero.summary.totalSalesAmount], [0, 0, 0]);
});

test("complete archive month without a canonical result falls back to the archive online, recorded as such", () => {
  const summary = { totalClients: 117, totalPurchaseCount: 1080, orderCount: 508 };
  const r = resolveHistoricalClientsSales({ summary, detailSummary: { totalSalesAmount: 286069920 }, archive: augArchive, canonical: null, offlineThrough: null, since: "2026-08-01", until: "2026-08-31" });
  assert.deepEqual([r.summary.onlineSalesAmount, r.summary.offlineSalesAmount, r.summary.totalSalesAmount], [34332620, 253583500, 287916120]);
  assert.equal(r.summary.avgOrderValue, 287916120 / 1080);
  assert.equal(r.accounting.basis, "historical_canonical_online");
  assert.equal(r.accounting.onlineBasis, "saved_monthly_archive");
  assert.equal(r.accounting.onlineDeltaFromArchive, null);
  assert.equal(r.asOf, undefined);
});

// Production after the partial-claim fix: canonical online differs from the frozen archive online.
const julArchive = { archiveStatus: "saved", sales: { onlineSales: { paidAmount: 35571903 }, offlineSales: { offlineSalesAmount: 237972530 }, totalSales: { amount: 273544433 } } };
const canonicalOf = (online) => ({ onlineSales: { paidAmount: online }, offlineSales: { offlineSalesAmount: 0 }, totalSales: { amount: online } });

test("complete month: online is the live canonical amount, offline stays the archive, total is recomputed", () => {
  for (const [archive, online, expectedTotal] of [[julArchive, 35000863, 272973393], [augArchive, 34722620, 288306120]]) {
    const r = resolveHistoricalClientsSales({ summary: { totalClients: 100, totalPurchaseCount: 10 }, detailSummary: { totalSalesAmount: 1 }, archive, canonical: canonicalOf(online), offlineThrough: null, since: "x", until: "y" });
    const archiveOnline = archive.sales.onlineSales.paidAmount, archiveOffline = archive.sales.offlineSales.offlineSalesAmount;
    assert.deepEqual([r.summary.onlineSalesAmount, r.summary.offlineSalesAmount, r.summary.totalSalesAmount], [online, archiveOffline, expectedTotal]);
    assert.equal(r.summary.totalClients, 100, "attribution and counts untouched");
    assert.equal(r.summary.avgOrderValue, expectedTotal / 10);
    assert.deepEqual({ ...r.accounting, attributedRevenue: undefined, unassignedRevenue: undefined }, {
      basis: "historical_canonical_online", attributedRevenue: undefined, unassignedRevenue: undefined, onlineBasis: "canonical_live",
      canonicalOnlineAmount: online, archiveOnlineAmount: archiveOnline, onlineDeltaFromArchive: online - archiveOnline,
      offlineBasis: "saved_monthly_archive", archiveOfflineAmount: archiveOffline });
    assert.equal(r.asOf, undefined, "complete months show no coverage notice");
  }
});

test("complete month: identical canonical and archive online leaves the result unchanged; a null archive online is never 0", () => {
  const same = resolveHistoricalClientsSales({ summary: {}, detailSummary: {}, archive: augArchive, canonical: canonicalOf(34332620), since: "x", until: "y" });
  assert.deepEqual([same.summary.onlineSalesAmount, same.summary.totalSalesAmount, same.accounting.onlineDeltaFromArchive], [34332620, 287916120, 0]);
  const noOnline = { sales: { onlineSales: { paidAmount: null }, offlineSales: { offlineSalesAmount: 100 }, totalSales: { amount: 100 } } };
  const missing = resolveHistoricalClientsSales({ summary: {}, detailSummary: {}, archive: noOnline, canonical: null, since: "x", until: "y" });
  assert.deepEqual([missing.summary.onlineSalesAmount, missing.summary.totalSalesAmount, missing.accounting.archiveOnlineAmount], [null, null, null]);
});

import { spawn } from "node:child_process";
import { request, createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const get = (port, path) => new Promise((resolve, reject) => {
  request({ host: "127.0.0.1", port, path, headers: { host: "127.0.0.1" } }, (res) => {
    let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve(JSON.parse(body)));
  }).on("error", reject).end();
});

test("route: closed month with null archive total returns canonical known amounts and partial metadata; complete month unchanged", { timeout: 30000 }, async () => {
  const kstToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const [y, m] = kstToday.slice(0, 7).split("-").map(Number);
  const monthKey = (offset) => new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7);
  const lastDay = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5)), 0)).toISOString().slice(0, 10);
  const partial = monthKey(-1); const full = monthKey(-2);
  const dir = await mkdtemp(join(tmpdir(), "clients-hist-"));
  for (const sub of ["ecount-sales", "monthly"]) await mkdir(join(dir, sub), { recursive: true });
  for (const name of ["product-registry.json", "product-registry-review-queue.json", "brand-commercial-policy.json", "brand-sourcing-master.json"]) await writeFile(join(dir, name), JSON.stringify({ entries: [], brands: [], policies: [] }));
  await writeFile(join(dir, "brand-master.json"), JSON.stringify({ brands: [{ brand_code: "B0000001", brand_name: "ONE", name_aliases: [], active: true }] }));
  const snapshot = (key, end, amount) => {
    const line = { date: `${key}-01`, slipNo: "1", documentNo: "1", productName: "ONE / Tee", quantity: 1, customerName: "매장방문고객", salesAmount: amount, isOfflineRevenue: true };
    return { month: key, periodStart: `${key}-01`, periodEnd: end, importedAt: "2026-10-01T00:00:00.000Z", totalOfflineSales: amount, salesLines: [line], rows: [line] };
  };
  const partialEnd = new Date(Date.parse(`${lastDay(partial)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  await writeFile(join(dir, "ecount-sales", `${partial}.json`), JSON.stringify(snapshot(partial, partialEnd, 70000)));
  await writeFile(join(dir, "ecount-sales", `${full}.json`), JSON.stringify(snapshot(full, lastDay(full), 50000)));
  const archive = (key, offline, total) => ({ month: key, archiveStatus: "saved", sales: { onlineSales: { paidAmount: 0 }, offlineSales: { offlineSalesAmount: offline }, totalSales: { amount: total } }, commerce: { brandSales: [] } });
  await writeFile(join(dir, "monthly", `${partial}.json`), JSON.stringify(archive(partial, null, null)));
  await writeFile(join(dir, "monthly", `${full}.json`), JSON.stringify(archive(full, 50000, 50000)));
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
    const p = await get(port, `/api/intelligence/clients?since=${partial}-01&until=${lastDay(partial)}`);
    assert.equal(p.summary.offlineSalesAmount, 70000, "known offline, not 0");
    assert.equal(p.summary.totalSalesAmount, 70000);
    assert.equal(p.accounting.basis, "canonical_partial_coverage");
    assert.deepEqual(p.requestedPeriod, { since: `${partial}-01`, until: lastDay(partial) });
    assert.deepEqual(p.asOf, { basis: "canonical_partial_coverage", onlineThrough: lastDay(partial), offlineThrough: partialEnd, missingOfflineDays: 1, coverage: "partial" });
    assert.equal(p.storeCoverage.available, false, "coverage stays partial");
    const f = await get(port, `/api/intelligence/clients?since=${full}-01&until=${lastDay(full)}`);
    assert.equal(f.accounting.basis, "historical_canonical_online");
    assert.equal(f.accounting.onlineBasis, "canonical_live");
    assert.equal(f.accounting.archiveOfflineAmount, 50000);
    assert.equal(f.summary.totalSalesAmount, 50000);
    assert.equal(f.asOf, undefined);
  } finally {
    child.kill("SIGTERM");
    proxy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("UI: historical partial months show the offline-through date and the missing days", async () => {
  const { readFile } = await import("node:fs/promises");
  const frontend = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  assert.match(frontend, /data\.asOf\?\.missingOfflineDays > 0 \? ` · 월말 \$\{esc\(String\(data\.asOf\.missingOfflineDays\)\)\}일 미수집 \(부분 집계\)`/);
});
