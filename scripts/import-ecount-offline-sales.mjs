import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEcountOfflineSalesExcel } from "./load-ecount-offline-sales.mjs";
import { ecountOfflineSalesSnapshotPath } from "./read-ecount-offline-sales-snapshot.mjs";

const schemaVersion = 1;

// STORE-BATCH-B: options.storeCode가 있으면 매장별 분리 파일(work/ecount-sales/
// {month}.{storeCode}.json)로 저장한다 — 압구정을 다시 올려도 VAIL 파일은 전혀 건드리지
// 않는다(절대 원칙: 같은 periodKey+storeCode 재업로드는 그 매장만 교체). storeCode가
// 없으면(예: 기존 CLI 대량 재적재) 기존과 완전히 동일한 레거시 단일 파일 경로를 그대로
// 쓴다 — 하위 호환.
export async function importEcountOfflineSalesSnapshot(filePath, options = {}) {
  if (!filePath) throw new Error("ECOUNT Excel file path is required");
  const loaded = loadEcountOfflineSalesExcel(filePath, options);
  const month = monthFromLoadedSales(loaded);
  const workDir = resolve(options.workDir || join(process.cwd(), "work"));
  const snapshotDir = options.outputDir ? resolve(options.outputDir) : join(workDir, "ecount-sales");
  await mkdir(snapshotDir, { recursive: true });
  const snapshot = buildEcountSalesSnapshot(loaded, month, options);
  const outputPath = ecountOfflineSalesSnapshotPath(month, { snapshotDir, storeCode: options.storeCode });
  await writeJsonAtomic(outputPath, snapshot);
  return {
    outputPath,
    snapshot
  };
}

export function buildEcountSalesSnapshot(loaded, month = monthFromLoadedSales(loaded), options = {}) {
  const storeCode = options.storeCode || null;
  const salesLines = storeCode
    ? loaded.salesLines.map((line) => ({ ...line, storeCode }))
    : loaded.salesLines;
  return {
    schemaVersion,
    month,
    periodStart: loaded.periodStart,
    periodEnd: loaded.periodEnd,
    importedAt: new Date().toISOString(),
    sourceFileName: loaded.fileName,
    // STORE-BATCH-B: 업로드 슬롯이 store identity를 부여한다(Excel 내용에서 매장명을
    // 추측하지 않음) — 슬롯에서 넘어온 storeCode와, Store Master에서 그 slot에 대응하는
    // 실제 ECOUNT 창고코드/창고명(사용자 확인값)을 그대로 보존한다.
    storeCode,
    sourceWarehouseCode: options.sourceWarehouseCode || null,
    sourceWarehouseName: options.sourceWarehouseName || null,
    totalOfflineSales: loaded.totalOfflineSales,
    totalLineCount: loaded.totalLineCount,
    revenueLineCount: loaded.revenueLineCount,
    nonRevenueLineCount: loaded.nonRevenueLineCount,
    personalPaymentSales: loaded.personalPaymentSales,
    personalPaymentCount: loaded.personalPaymentCount,
    dailySales: loaded.dailySales,
    salesLines,
    rows: salesLines
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
