import { mkdir, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importEcountOfflineSalesSnapshot } from "./import-ecount-offline-sales.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monthFromFile = (name) => name.match(/^(\d{4})[.-](\d{2})\.xlsx$/i)?.slice(1, 3).join("-") || "";
const currentMonth = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: process.env.REPORT_TIMEZONE || "Asia/Seoul",
  year: "numeric",
  month: "2-digit"
}).format(new Date());
const reason = (error) => String(error?.message || error || "Unknown error");

export async function monthlySnapshotStatus(xlsxPath, snapshotPath) {
  const xlsx = await stat(xlsxPath);
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "MISSING", reason: "Snapshot does not exist" };
    if (error instanceof SyntaxError) return { status: "INVALID", reason: "Snapshot JSON parse failed" };
    throw error;
  }
  const importedAt = Date.parse(snapshot?.importedAt);
  if (!Number.isFinite(importedAt)) return { status: "INVALID", reason: "Snapshot importedAt is invalid" };
  return xlsx.mtimeMs > importedAt
    ? { status: "STALE", reason: "XLSX is newer than snapshot" }
    : { status: "FRESH", reason: "Snapshot is up to date" };
}

export function validateMonthlyArchive(archive) {
  const total = Number(archive?.sales?.totalSales?.amount);
  const online = Number(archive?.sales?.onlineSales?.paidAmount);
  const offline = Number(archive?.sales?.offlineSales?.offlineSalesAmount);
  const coverage = archive?.sales?.coverage;
  if (![total, online, offline].every(Number.isFinite)) throw new Error("Invalid monthly sales totals");
  if (total !== online + offline) throw new Error(`Monthly sales mismatch: ${total} !== ${online} + ${offline}`);
  if (!coverage || typeof coverage.online !== "boolean" || typeof coverage.offline !== "boolean" || typeof coverage.complete !== "boolean") {
    throw new Error("Invalid monthly sales coverage");
  }
  return true;
}

export async function refreshMonthlySales(folder, options = {}) {
  const workDir = resolve(options.workDir || join(root, "work"));
  const log = options.log || console.log;
  const nowMonth = options.currentMonth || currentMonth();
  const importSnapshot = options.importSnapshot || importEcountOfflineSalesSnapshot;
  const buildArchive = options.buildArchive;
  const writeArchive = options.writeArchive;
  const files = (await readdir(resolve(folder), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && monthFromFile(entry.name))
    .map((entry) => ({ name: entry.name, month: monthFromFile(entry.name) }))
    .sort((left, right) => left.month.localeCompare(right.month) || left.name.localeCompare(right.name));
  const duplicates = files.filter((item, index) => files.findIndex((candidate) => candidate.month === item.month) !== index);
  if (duplicates.length) throw new Error(`Duplicate Monthly Sales month: ${duplicates.map((item) => item.month).join(", ")}`);
  await mkdir(join(workDir, "monthly"), { recursive: true });
  const results = [];

  for (const file of files) {
    const startedAt = Date.now();
    const xlsxPath = join(resolve(folder), file.name);
    const detected = await monthlySnapshotStatus(xlsxPath, join(workDir, "ecount-sales", `${file.month}.json`));
    log(`[${file.month}] ${file.name}\n${detected.status}`);
    if (detected.status === "FRESH") {
      log("Skipped");
      results.push({ month: file.month, status: detected.status, snapshot: "SKIP", archive: "SKIP", reason: detected.reason, duration: Date.now() - startedAt });
      continue;
    }
    const lockPath = join(workDir, "monthly", `.refresh-lock-${file.month}`);
    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      log("Skipped\nReason\nRefresh already running");
      results.push({ month: file.month, status: detected.status, snapshot: "SKIP", archive: "SKIP", reason: "Refresh already running", duration: Date.now() - startedAt });
      continue;
    }
    await lock.close();

    const result = { month: file.month, status: detected.status, snapshot: "FAIL", archive: "SKIP", reason: detected.reason, duration: 0 };
    try {
      const imported = await importSnapshot(xlsxPath, { workDir });
      if (imported?.snapshot?.month !== file.month) throw new Error(`Filename month ${file.month} does not match snapshot month ${imported?.snapshot?.month || "unknown"}`);
      result.snapshot = "PASS";
      log("Snapshot\nPASS");

      if (file.month === nowMonth) {
        result.archive = "SKIP";
        result.reason = "Current month snapshot only";
        log("Archive\nSKIP\nReason\nCurrent month snapshot only\nRefresh PASS");
      } else {
        try {
          const archive = await buildArchive(file.month);
          validateMonthlyArchive(archive);
          await writeArchive(file.month, { ...archive, archiveStatus: "saved" });
          result.archive = "PASS";
          result.integrity = "PASS";
          log("Archive\nPASS\nIntegrity\nPASS\nRefresh PASS");
        } catch (error) {
          result.archive = "FAIL";
          result.integrity = "FAIL";
          result.reason = reason(error);
          log(`Archive\nFAIL\nReason\n${result.reason}\nRefresh FAIL`);
        }
      }
    } catch (error) {
      result.reason = reason(error);
      log(`Snapshot\nFAIL\nReason\n${result.reason}\nRefresh FAIL`);
    } finally {
      await unlink(lockPath).catch((error) => { if (error?.code !== "ENOENT") throw error; });
    }
    result.duration = Date.now() - startedAt;
    results.push(result);
  }
  return results;
}

async function main() {
  const folder = process.argv[2];
  if (!folder) throw new Error("Usage: node scripts/refresh-monthly-sales.mjs /path/to/monthly-sales");
  process.chdir(root);
  const { buildMonthlyArchive, writeMonthlyArchive } = await import("../server.mjs");
  const results = await refreshMonthlySales(folder, { buildArchive: buildMonthlyArchive, writeArchive: writeMonthlyArchive });
  console.log(JSON.stringify(results, null, 2));
  if (results.some((item) => item.snapshot === "FAIL" || item.archive === "FAIL")) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(reason(error));
  process.exitCode = 1;
});
