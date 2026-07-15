import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEcountOfflineSalesExcel } from "./load-ecount-offline-sales.mjs";

const schemaVersion = 1;

export async function importEcountOfflineSalesSnapshot(filePath, options = {}) {
  if (!filePath) throw new Error("ECOUNT Excel file path is required");
  const loaded = loadEcountOfflineSalesExcel(filePath, options);
  const month = monthFromLoadedSales(loaded);
  const workDir = resolve(options.workDir || join(process.cwd(), "work"));
  const outputDir = options.outputDir ? resolve(options.outputDir) : join(workDir, "ecount-sales");
  await mkdir(outputDir, { recursive: true });
  const snapshot = buildEcountSalesSnapshot(loaded, month);
  const outputPath = join(outputDir, `${month}.json`);
  await writeJsonAtomic(outputPath, snapshot);
  return {
    outputPath,
    snapshot
  };
}

export function buildEcountSalesSnapshot(loaded, month = monthFromLoadedSales(loaded)) {
  return {
    schemaVersion,
    month,
    periodStart: loaded.periodStart,
    periodEnd: loaded.periodEnd,
    importedAt: new Date().toISOString(),
    sourceFileName: loaded.fileName,
    totalOfflineSales: loaded.totalOfflineSales,
    totalLineCount: loaded.totalLineCount,
    revenueLineCount: loaded.revenueLineCount,
    nonRevenueLineCount: loaded.nonRevenueLineCount,
    dailySales: loaded.dailySales,
    salesLines: loaded.salesLines,
    rows: loaded.salesLines
  };
}

function monthFromLoadedSales(loaded) {
  const month = String(loaded.periodStart || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Unable to determine ECOUNT sales month");
  if (loaded.periodEnd && String(loaded.periodEnd).slice(0, 7) !== month) {
    throw new Error(`ECOUNT sales snapshot must not span multiple months: ${loaded.periodStart} ~ ${loaded.periodEnd}`);
  }
  return month;
}

async function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tempPath, filePath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: node scripts/import-ecount-offline-sales.mjs /path/to/ecount-sales.xlsx [...]");
    process.exit(1);
  }
  const results = [];
  for (const file of files) {
    const result = await importEcountOfflineSalesSnapshot(file);
    results.push({
      fileName: basename(file),
      outputPath: result.outputPath,
      month: result.snapshot.month,
      periodStart: result.snapshot.periodStart,
      periodEnd: result.snapshot.periodEnd,
      totalOfflineSales: result.snapshot.totalOfflineSales,
      totalLineCount: result.snapshot.totalLineCount,
      revenueLineCount: result.snapshot.revenueLineCount,
      nonRevenueLineCount: result.snapshot.nonRevenueLineCount
    });
  }
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}
