#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const args = parseArgs(process.argv.slice(2));
const rootDir = resolve(args.root || process.cwd());
const workDir = resolve(args.workDir || join(rootDir, "work"));
const monthlyDir = join(workDir, "monthly");
const ecountDir = join(workDir, "ecount-sales");
const writeMode = Boolean(args.write);
const createMissing = Boolean(args.createMissing);

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const months = await resolveTargetMonths(args);
  if (!months.length) throw new Error("No target months. Use --month=YYYY-MM or --from=YYYY-MM --to=YYYY-MM.");

  const backupDir = writeMode ? join(monthlyDir, "backups", timestampKey(new Date())) : null;
  const results = [];

  for (const month of months) {
    const result = await backfillMonth(month, { backupDir });
    results.push(result);
  }

  printSummary(results);
}

async function backfillMonth(month, { backupDir }) {
  validateMonth(month);
  const archivePath = join(monthlyDir, `${month}.json`);
  const archiveExists = existsSync(archivePath);
  if (!archiveExists && !createMissing) {
    return { month, status: "skipped", reason: "monthly archive missing" };
  }

  const originalText = archiveExists ? await readFile(archivePath, "utf8") : "";
  const archive = archiveExists ? parseJson(originalText, archivePath) : { month };
  const originalArchive = JSON.parse(JSON.stringify(archive));
  const monthStart = `${month}-01`;
  const monthEnd = monthEndKey(month);
  const onlineSales = numberOrZero(archive?.commerce?.paidAmount ?? archive?.sales?.onlineSales?.paidAmount);
  const sales = await buildMonthlySales({ month, monthStart, monthEnd, onlineSales });

  archive.month = archive.month || month;
  archive.sales = sales;

  const changed = !archiveExists || JSON.stringify(originalArchive.sales || null) !== JSON.stringify(archive.sales);
  const nextText = `${JSON.stringify(archive, null, 2)}\n`;

  if (writeMode && changed) {
    await mkdir(backupDir, { recursive: true });
    if (archiveExists) {
      await writeFile(join(backupDir, basename(archivePath)), originalText);
    }
    await writeFile(archivePath, nextText);
  }

  return {
    month,
    status: writeMode ? changed ? "written" : "unchanged" : changed ? "would-change" : "unchanged",
    archiveExists,
    changed,
    onlineSales,
    offlineSales: sales.offlineSales.offlineSalesAmount,
    totalSales: sales.totalSales.amount,
    coverage: sales.coverage,
    before: originalArchive.sales ? summarizeSales(originalArchive.sales) : null,
    after: summarizeSales(sales),
    backupDir: writeMode && changed ? backupDir : null,
    checksumBefore: archiveExists ? sha256(originalText) : null,
    checksumAfter: sha256(nextText)
  };
}

async function buildMonthlySales({ month, monthStart, monthEnd, onlineSales }) {
  const missingMonths = [];
  const partialMonths = [];
  let offlineSalesAmount = 0;
  const snapshotPath = join(ecountDir, `${month}.json`);

  if (!existsSync(snapshotPath)) {
    missingMonths.push(month);
  } else {
    const snapshot = parseJson(await readFile(snapshotPath, "utf8"), snapshotPath);
    if (String(snapshot.periodStart || "") > monthStart || String(snapshot.periodEnd || "") < monthEnd) {
      partialMonths.push(month);
    }
    const lines = Array.isArray(snapshot.salesLines) ? snapshot.salesLines : Array.isArray(snapshot.rows) ? snapshot.rows : [];
    for (const line of lines) {
      const date = String(line?.date || "");
      const salesAmount = parseAmount(line?.salesAmount);
      if (line?.isOfflineRevenue === true && Number.isFinite(salesAmount) && date >= monthStart && date <= monthEnd) {
        offlineSalesAmount += salesAmount;
      }
    }
  }

  const offlineComplete = missingMonths.length === 0 && partialMonths.length === 0;
  return {
    periodStart: monthStart,
    periodEnd: monthEnd,
    onlineSales: {
      paidAmount: onlineSales
    },
    offlineSales: {
      offlineSalesAmount
    },
    totalSales: {
      amount: onlineSales + offlineSalesAmount
    },
    coverage: {
      online: true,
      offline: offlineComplete,
      complete: offlineComplete,
      partialMonths,
      missingMonths
    }
  };
}

async function resolveTargetMonths(options) {
  if (options.month) {
    validateMonth(options.month);
    return [options.month];
  }
  if (options.from || options.to) {
    if (!options.from || !options.to) throw new Error("--from and --to must be used together.");
    validateMonth(options.from);
    validateMonth(options.to);
    if (options.from > options.to) throw new Error("--from must be before or equal to --to.");
    const months = [];
    let cursor = options.from;
    while (cursor <= options.to) {
      months.push(cursor);
      cursor = addMonths(cursor, 1);
    }
    return months;
  }
  const names = await readdir(monthlyDir).catch(() => []);
  return names
    .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
    .map((name) => name.slice(0, 7))
    .sort();
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === "--write") options.write = true;
    else if (arg === "--create-missing") options.createMissing = true;
    else if (arg.startsWith("--month=")) options.month = arg.slice("--month=".length);
    else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
    else if (arg.startsWith("--to=")) options.to = arg.slice("--to=".length);
    else if (arg.startsWith("--root=")) options.root = arg.slice("--root=".length);
    else if (arg.startsWith("--work-dir=")) options.workDir = arg.slice("--work-dir=".length);
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/backfill-monthly-offline-sales.mjs --month=YYYY-MM [--write]
  node scripts/backfill-monthly-offline-sales.mjs --from=YYYY-MM --to=YYYY-MM [--write]

Options:
  --write             Write changed monthly archive JSON files. Default is dry-run.
  --create-missing    Create a minimal missing monthly archive. Default is skip.
  --work-dir=PATH     Use an alternate work directory for verification.`);
}

function printSummary(results) {
  console.log(JSON.stringify({
    mode: writeMode ? "write" : "dry-run",
    workDir,
    monthlyDir,
    ecountDir,
    count: results.length,
    results
  }, null, 2));
}

function summarizeSales(sales = {}) {
  return {
    onlineSales: numberOrZero(sales?.onlineSales?.paidAmount),
    offlineSales: numberOrZero(sales?.offlineSales?.offlineSalesAmount),
    totalSales: numberOrZero(sales?.totalSales?.amount),
    coverage: sales?.coverage || null
  };
}

function validateMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ""))) throw new Error(`Invalid month: ${value}`);
}

function addMonths(month, count) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthEndKey(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  return `${month}-${String(new Date(year, monthIndex, 0).getDate()).padStart(2, "0")}`;
}

function parseJson(text, filePath) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${filePath}: ${error.message}`);
  }
}

function parseAmount(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) return null;
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function numberOrZero(value) {
  const amount = parseAmount(value);
  return Number.isFinite(amount) ? amount : 0;
}

function timestampKey(date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ];
  return parts.join("");
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
