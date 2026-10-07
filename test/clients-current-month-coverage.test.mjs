import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request, createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { currentMonthSalesCutoff } from "../server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const kstToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const month = kstToday.slice(0, 7);
const monthStart = `${month}-01`;

test("Monthly and Clients share one cutoff rule: the earliest of month end, today and ECOUNT coverage", () => {
  assert.equal(currentMonthSalesCutoff("2026-10-31", "2026-10-07", "2026-10-06"), "2026-10-06");
  assert.equal(currentMonthSalesCutoff("2026-10-31", "2026-10-07", "2026-10-09"), "2026-10-07");
  const server = readFile(new URL("../server.mjs", import.meta.url), "utf8");
  return server.then((source) => {
    assert.match(source, /const asOf = await currentMonthAsOf\(month\);/, "Monthly uses the shared helper");
    assert.match(source, /coverage"\) === "current-month" && since === `\$\{currentMonth\(\)\}-01` \? await currentMonthAsOf\(currentMonth\(\)\)/, "Clients uses the shared helper");
  });
});

function get(port, path) {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, headers: { host: "127.0.0.1" } }, (res) => {
      let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on("error", reject).end();
  });
}

test("Clients 'this month' ends at the ECOUNT as-of date; explicit ranges keep partial-coverage nulls", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "clients-asof-"));
  await mkdir(join(dir, "ecount-sales"), { recursive: true });
  for (const name of ["product-registry.json", "product-registry-review-queue.json", "brand-commercial-policy.json", "brand-sourcing-master.json"]) await writeFile(join(dir, name), JSON.stringify({ entries: [], brands: [], policies: [] }));
  await writeFile(join(dir, "brand-master.json"), JSON.stringify({ brands: [{ brand_code: "B0000001", brand_name: "ONE", name_aliases: [], active: true }] }));
  // ECOUNT covers only the first day of the current month.
  const line = { date: monthStart, slipNo: "1", documentNo: "1", productName: "ONE / Tee", quantity: 1, customerName: "매장방문고객", salesAmount: 120000, isOfflineRevenue: true };
  await writeFile(join(dir, "ecount-sales", `${month}.json`), JSON.stringify({ month, periodStart: monthStart, periodEnd: monthStart, importedAt: new Date().toISOString(), totalOfflineSales: 120000, salesLines: [line], rows: [line] }));
  const proxy = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ orders: [], brands: [], products: [], totals: {} })); });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [join(root, "server.mjs")], { cwd: dir, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WORK_DIR: dir, HOST: "127.0.0.1", PORT: String(port), CAFE24_PROXY_BASE_URL: `http://127.0.0.1:${proxy.address().port}`, META_ACCESS_TOKEN: "", INSTAGRAM_ACCESS_TOKEN: "" } });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
      child.stdout.on("data", (c) => { if (String(c).includes("running at")) { clearTimeout(timer); resolve(); } });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exit ${code}`)); });
    });
    const preset = (await get(port, `/api/intelligence/clients?since=${monthStart}&until=${kstToday}&coverage=current-month`)).body;
    assert.equal(preset.periodEnd, monthStart);
    assert.deepEqual(preset.requestedPeriod, { since: monthStart, until: kstToday });
    assert.equal(preset.asOf.asOfDate, monthStart);
    assert.equal(preset.asOf.offlineThrough, monthStart);
    assert.equal(preset.storeCoverage.available, true);
    assert.equal(preset.summary.offlineSalesAmount, 120000);
    if (kstToday > monthStart) {
      // Explicit range past ECOUNT coverage: unchanged policy, no invented numbers.
      const explicit = (await get(port, `/api/intelligence/clients?since=${monthStart}&until=${kstToday}`)).body;
      assert.equal(explicit.periodEnd, kstToday);
      assert.equal(explicit.asOf, undefined);
      assert.equal(explicit.summary.offlineSalesAmount, null);
      assert.equal(explicit.summary.totalSalesAmount, null);
    }
    // A past month ignores the flag.
    const prevMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1)).toISOString().slice(0, 7);
    const past = (await get(port, `/api/intelligence/clients?since=${prevMonth}-01&until=${prevMonth}-28&coverage=current-month`)).body;
    assert.equal(past.asOf, undefined);
    assert.equal(past.periodEnd, `${prevMonth}-28`);
  } finally {
    child.kill("SIGTERM");
    proxy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("UI: only the '이번 달' preset sends coverage=current-month and the status line shows the data period", async () => {
  const frontend = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  assert.match(frontend, /const coverageParam = range\.label === "이번 달" \? "&coverage=current-month" : "";/);
  assert.match(frontend, /데이터 기준 \$\{esc\(data\.periodStart \|\| range\.since\)\} ~ \$\{esc\(data\.periodEnd \|\| range\.until\)\}\$\{asOfNote\}/);
  assert.match(frontend, /오프라인 최신 \$\{esc\(String\(data\.asOf\.offlineThrough\)\.slice\(5\)\)\}/);
});
