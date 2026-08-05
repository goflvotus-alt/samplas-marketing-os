import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { refreshMonthlySales, validateMonthlyArchive } from "../scripts/refresh-monthly-sales.mjs";

const archive = (online = 70, offline = 30) => ({
  month: "2026-07",
  sales: {
    onlineSales: { paidAmount: online },
    offlineSales: { offlineSalesAmount: offline },
    totalSales: { amount: online + offline },
    coverage: { online: true, offline: true, complete: true, partialMonths: [], missingMonths: [] }
  }
});
const withTemp = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), "monthly-refresh-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

test("past month reuses snapshot import, builds and writes a valid archive", () => withTemp(async (dir) => {
  const folder = join(dir, "sales");
  await mkdir(folder);
  await writeFile(join(folder, "2026.07.xlsx"), "fixture");
  const calls = [];
  const results = await refreshMonthlySales(folder, {
    workDir: join(dir, "work"), currentMonth: "2026-08", log: () => {},
    importSnapshot: async (_file, options) => { calls.push(["snapshot", options.workDir]); return { snapshot: { month: "2026-07" } }; },
    buildArchive: async (month) => { calls.push(["build", month]); return archive(); },
    writeArchive: async (month, value) => { calls.push(["write", month, value.archiveStatus]); }
  });
  assert.equal(results[0].snapshot, "PASS");
  assert.equal(results[0].archive, "PASS");
  assert.equal(results[0].status, "MISSING");
  assert.equal(typeof results[0].duration, "number");
  assert.deepEqual(calls.map((item) => item[0]), ["snapshot", "build", "write"]);
}));

test("current month writes snapshot only", () => withTemp(async (dir) => {
  const folder = join(dir, "sales");
  await mkdir(folder);
  await writeFile(join(folder, "2026.08.xlsx"), "fixture");
  let archiveCalls = 0;
  const results = await refreshMonthlySales(folder, {
    workDir: join(dir, "work"), currentMonth: "2026-08", log: () => {},
    importSnapshot: async () => ({ snapshot: { month: "2026-08" } }),
    buildArchive: async () => { archiveCalls += 1; }, writeArchive: async () => { archiveCalls += 1; }
  });
  assert.equal(results[0].snapshot, "PASS");
  assert.equal(results[0].archive, "SKIP");
  assert.equal(archiveCalls, 0);
}));

test("archive failure keeps a successful snapshot and releases the lock", () => withTemp(async (dir) => {
  const folder = join(dir, "sales");
  const workDir = join(dir, "work");
  await mkdir(folder);
  await writeFile(join(folder, "2026-07.xlsx"), "fixture");
  const snapshotPath = join(workDir, "snapshot-written");
  const options = {
    workDir, currentMonth: "2026-08", log: () => {},
    importSnapshot: async () => { await mkdir(workDir, { recursive: true }); await writeFile(snapshotPath, "ok"); return { snapshot: { month: "2026-07" } }; },
    buildArchive: async () => { throw new Error("Cafe24 timeout"); }, writeArchive: async () => {}
  };
  const first = await refreshMonthlySales(folder, options);
  assert.equal(first[0].snapshot, "PASS");
  assert.equal(first[0].archive, "FAIL");
  assert.equal(await readFile(snapshotPath, "utf8"), "ok");
  const second = await refreshMonthlySales(folder, options);
  assert.notEqual(second[0].snapshot, "SKIP");
}));

test("existing month lock prevents duplicate execution", () => withTemp(async (dir) => {
  const folder = join(dir, "sales");
  const workDir = join(dir, "work");
  await mkdir(folder);
  await mkdir(join(workDir, "monthly"), { recursive: true });
  await writeFile(join(folder, "2026.07.xlsx"), "fixture");
  await writeFile(join(workDir, "monthly", ".refresh-lock-2026-07"), "");
  let imported = false;
  const results = await refreshMonthlySales(folder, { workDir, currentMonth: "2026-08", log: () => {}, importSnapshot: async () => { imported = true; } });
  assert.equal(results[0].snapshot, "SKIP");
  assert.equal(imported, false);
}));

test("STALE and INVALID refresh while FRESH skips", () => withTemp(async (dir) => {
  const folder = join(dir, "sales");
  const workDir = join(dir, "work");
  await mkdir(folder);
  await mkdir(join(workDir, "ecount-sales"), { recursive: true });
  for (const month of ["05", "06", "07"]) await writeFile(join(folder, `2026.${month}.xlsx`), "fixture");
  await writeFile(join(workDir, "ecount-sales", "2026-05.json"), JSON.stringify({ importedAt: "2999-01-01T00:00:00.000Z" }));
  await writeFile(join(workDir, "ecount-sales", "2026-06.json"), JSON.stringify({ importedAt: "2000-01-01T00:00:00.000Z" }));
  await writeFile(join(workDir, "ecount-sales", "2026-07.json"), "not json");
  const imported = [];
  const results = await refreshMonthlySales(folder, {
    workDir, currentMonth: "2026-08", log: () => {},
    importSnapshot: async (file) => {
      const month = file.match(/2026[.-](\d{2})\.xlsx$/)[1];
      imported.push(month);
      return { snapshot: { month: `2026-${month}` } };
    },
    buildArchive: async () => archive(), writeArchive: async () => {}
  });
  assert.deepEqual(results.map((item) => item.status), ["FRESH", "STALE", "INVALID"]);
  assert.deepEqual(imported, ["06", "07"]);
  assert.deepEqual(results.map((item) => item.snapshot), ["SKIP", "PASS", "PASS"]);
  assert.ok(results.every((item) => typeof item.duration === "number"));
}));

test("integrity rejects total mismatch and invalid coverage", () => {
  const mismatch = archive();
  mismatch.sales.totalSales.amount = 99;
  assert.throws(() => validateMonthlyArchive(mismatch), /mismatch/);
  const missingCoverage = archive();
  delete missingCoverage.sales.coverage;
  assert.throws(() => validateMonthlyArchive(missingCoverage), /coverage/);
});

test("importing server.mjs does not start the HTTP server", async () => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", "await import('./server.mjs'); console.log('IMPORTED')"], {
    cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0, stderr);
  assert.equal(stdout.trim(), "IMPORTED");
  const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(serverSource, /const server = isMainModule \? createServer/);
  assert.match(serverSource, /\.listen\(port, host,/);
});
