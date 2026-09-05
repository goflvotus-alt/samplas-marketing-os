import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOfflineSalesResult, loadEcountOfflineSalesExcel } from "./load-ecount-offline-sales.mjs";
import { ecountOfflineSalesSnapshotPath } from "./read-ecount-offline-sales-snapshot.mjs";

const schemaVersion = 1;
export const WAREHOUSE_ROUTING_START_MONTH = "2026-08";
export const ECOUNT_WAREHOUSE_STORES = [
  { warehouseName: "매장", storeCode: "APGUJEONG", warehouseCode: "100" },
  { warehouseName: "SAMPLAS Veil", storeCode: "VAIL", warehouseCode: "200" }
];

// STORE-BATCH-B: options.storeCode가 있으면 매장별 분리 파일(work/ecount-sales/
// {month}.{storeCode}.json)로 저장한다 — 압구정을 다시 올려도 VAIL 파일은 전혀 건드리지
// 않는다(절대 원칙: 같은 periodKey+storeCode 재업로드는 그 매장만 교체). storeCode가
// 없으면(예: 기존 CLI 대량 재적재) 기존과 완전히 동일한 레거시 단일 파일 경로를 그대로
// 쓴다 — 하위 호환.
export async function importEcountOfflineSalesSnapshot(filePath, options = {}) {
  if (!filePath) throw new Error("ECOUNT Excel file path is required");
  const loaded = loadEcountOfflineSalesExcel(filePath, options);
  const month = monthFromLoadedSales(loaded, options.expectedMonth);
  if (options.expectedMonth && month !== options.expectedMonth) {
    throw new Error(`파일명 월 ${options.expectedMonth}과 XLSX 데이터 월 ${month}이 일치하지 않습니다.`);
  }
  const workDir = resolve(options.workDir || join(process.cwd(), "work"));
  const snapshotDir = options.outputDir ? resolve(options.outputDir) : join(workDir, "ecount-sales");
  await mkdir(snapshotDir, { recursive: true });
  if (month >= WAREHOUSE_ROUTING_START_MONTH && !options.storeCode) {
    const snapshots = buildWarehouseRoutedSnapshots(loaded, month, filePath);
    const entries = snapshots.map((snapshot) => ({
      filePath: ecountOfflineSalesSnapshotPath(month, { snapshotDir, storeCode: snapshot.storeCode }),
      data: snapshot
    }));
    await writeJsonSetAtomic(entries, options.atomicFs);
    return { outputPaths: entries.map((entry) => entry.filePath), snapshots, snapshot: { month } };
  }
  const snapshot = buildEcountSalesSnapshot(loaded, month, options);
  const outputPath = ecountOfflineSalesSnapshotPath(month, { snapshotDir, storeCode: options.storeCode });
  await writeJsonAtomic(outputPath, snapshot);
  return {
    outputPath,
    snapshot
  };
}

export function buildWarehouseRoutedSnapshots(loaded, month = monthFromLoadedSales(loaded), filePath = loaded?.fileName || "ecount.xlsx") {
  const byStore = new Map(ECOUNT_WAREHOUSE_STORES.map((store) => [store.storeCode, []]));
  const mapping = new Map(ECOUNT_WAREHOUSE_STORES.map((store) => [store.warehouseName, store]));
  for (const line of loaded.salesLines || []) {
    const warehouseName = String(line?.warehouseName || "").trim();
    const store = mapping.get(warehouseName);
    if (!store) {
      throw new Error(`Unknown ECOUNT warehouse at row ${line?.sourceRowNumber || "?"}: ${warehouseName || "<EMPTY>"} · ${line?.date || "-"} · ${line?.productName || "-"}`);
    }
    byStore.get(store.storeCode).push(line);
  }
  return ECOUNT_WAREHOUSE_STORES.map((store) => {
    const routed = buildOfflineSalesResult({ filePath, sheetName: loaded.sheetName, salesLines: byStore.get(store.storeCode) });
    return buildEcountSalesSnapshot(routed, month, {
      storeCode: store.storeCode,
      sourceWarehouseCode: store.warehouseCode,
      sourceWarehouseName: store.warehouseName
    });
  });
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

function monthFromLoadedSales(loaded, expectedMonth = null) {
  const month = String(loaded.periodStart || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Unable to determine ECOUNT sales month");
  if (loaded.periodEnd && String(loaded.periodEnd).slice(0, 7) !== month) {
    const filenameNote = expectedMonth ? ` (파일명 월: ${expectedMonth})` : "";
    throw new Error(`ECOUNT sales snapshot must not span multiple months: ${loaded.periodStart} ~ ${loaded.periodEnd}${filenameNote}`);
  }
  return month;
}

async function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tempPath, filePath);
}

export async function writeJsonSetAtomic(entries, atomicFs = {}) {
  const write = atomicFs?.writeFile || writeFile;
  const move = atomicFs?.rename || rename;
  const remove = atomicFs?.unlink || unlink;
  const read = atomicFs?.readFile || readFile;
  const transaction = `${process.pid}-${Date.now()}`;
  const prepared = [];
  try {
    for (const [index, entry] of entries.entries()) {
      let previous = null;
      try { previous = await read(entry.filePath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      const tempPath = `${entry.filePath}.tmp-${transaction}-${index}`;
      prepared.push({ ...entry, tempPath, previous, committed: false });
      await write(tempPath, `${JSON.stringify(entry.data, null, 2)}\n`);
    }
    for (const entry of prepared) {
      await move(entry.tempPath, entry.filePath);
      entry.committed = true;
    }
  } catch (error) {
    for (const entry of prepared) {
      if (entry.committed) {
        if (entry.previous === null) await remove(entry.filePath).catch(() => {});
        else {
          const restorePath = `${entry.filePath}.restore-${transaction}`;
          await write(restorePath, entry.previous);
          await move(restorePath, entry.filePath);
        }
      }
      await remove(entry.tempPath).catch(() => {});
    }
    throw error;
  }
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
    const snapshots = result.snapshots || [result.snapshot];
    results.push({
      fileName: basename(file),
      outputPath: result.outputPath || result.outputPaths,
      month: snapshots[0].month,
      periodStart: snapshots.map((item) => item.periodStart).filter(Boolean).sort()[0] || null,
      periodEnd: snapshots.map((item) => item.periodEnd).filter(Boolean).sort().at(-1) || null,
      totalOfflineSales: snapshots.reduce((sum, item) => sum + item.totalOfflineSales, 0),
      totalLineCount: snapshots.reduce((sum, item) => sum + item.totalLineCount, 0),
      revenueLineCount: snapshots.reduce((sum, item) => sum + item.revenueLineCount, 0),
      nonRevenueLineCount: snapshots.reduce((sum, item) => sum + item.nonRevenueLineCount, 0)
    });
  }
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}
