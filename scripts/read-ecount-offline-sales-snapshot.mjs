import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const monthPattern = /^\d{4}-\d{2}$/;

// STORE-BATCH-B: SAMPLAS Store Master v1(work/store-master.json)의 storeCode 목록.
// 이 스크립트는 어떤 {month}.{storeCode}.json 파일들이 존재하는지 스캔하는 데만 이
// 목록이 필요하다 — 표시명 등 나머지 메타데이터가 필요하면 work/store-master.json을
// 직접 읽는다(중복 정의 최소화). 새 매장이 생기면 이 배열과 work/store-master.json을
// 함께 갱신해야 한다.
export const KNOWN_STORE_CODES = ["APGUJEONG", "VAIL"];

export function assertEcountSalesMonth(month) {
  if (!monthPattern.test(String(month || ""))) {
    throw new Error("Invalid ECOUNT offline sales month. Expected YYYY-MM.");
  }
}

function snapshotDirFor(options = {}) {
  const workDir = resolve(options.workDir || join(process.cwd(), "work"));
  return options.snapshotDir ? resolve(options.snapshotDir) : join(workDir, "ecount-sales");
}

// storeCode가 있으면 매장별 분리 파일 경로, 없으면 매장 분리 이전(레거시) 단일 월 파일
// 경로를 반환한다 — 두 경우 모두 이 함수 하나로 통일해 경로 규칙이 여러 곳에 흩어지지
// 않게 한다.
export function ecountOfflineSalesSnapshotPath(month, options = {}) {
  assertEcountSalesMonth(month);
  const snapshotDir = snapshotDirFor(options);
  const storeCode = options.storeCode || null;
  const fileName = storeCode ? `${month}.${storeCode}.json` : `${month}.json`;
  return join(snapshotDir, fileName);
}

async function readSnapshotFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error(`Invalid ECOUNT offline sales snapshot JSON: ${filePath}`);
    throw error;
  }
}

// STORE-BATCH-B: 한 달치 매장별 스냅샷들을 하나로 합친다. 기존 필드 shape(salesLines/
// dailySales/totalOfflineSales 등)을 그대로 유지해, readEcountOfflineSalesSnapshot()을
// 호출하던 기존 6개 소비자가 코드 변경 없이 동일한 ALL 합계를 계속 받는다 — 새 계산식이
// 아니라 이미 각 매장에서 계산된 라인/일별 합계를 이어붙이고 다시 더하는 것뿐이다
// (STORE-BATCH-B 절대 원칙 1: APGUJEONG + VAIL = 기존 offline 합계).
function mergeStoreSnapshots(month, storeSnapshots) {
  const salesLines = [];
  const dailyMap = new Map();
  let totalOfflineSales = 0;
  let totalLineCount = 0;
  let revenueLineCount = 0;
  let personalPaymentSales = 0;
  let personalPaymentCount = 0;
  let periodStart = null;
  let periodEnd = null;
  const storesIncluded = [];
  const sources = [];

  for (const { storeCode, snapshot } of storeSnapshots) {
    storesIncluded.push(storeCode);
    sources.push({
      storeCode,
      sourceFileName: snapshot.sourceFileName || null,
      importedAt: snapshot.importedAt || null,
      sourceWarehouseCode: snapshot.sourceWarehouseCode || null,
      sourceWarehouseName: snapshot.sourceWarehouseName || null
    });
    const lines = Array.isArray(snapshot.salesLines) ? snapshot.salesLines : Array.isArray(snapshot.rows) ? snapshot.rows : [];
    for (const line of lines) salesLines.push({ ...line, storeCode: line.storeCode ?? storeCode });
    totalOfflineSales += Number(snapshot.totalOfflineSales || 0);
    totalLineCount += Number(snapshot.totalLineCount || 0);
    revenueLineCount += Number(snapshot.revenueLineCount || 0);
    personalPaymentSales += Number(snapshot.personalPaymentSales || 0);
    personalPaymentCount += Number(snapshot.personalPaymentCount || 0);
    if (snapshot.periodStart && (!periodStart || snapshot.periodStart < periodStart)) periodStart = snapshot.periodStart;
    if (snapshot.periodEnd && (!periodEnd || snapshot.periodEnd > periodEnd)) periodEnd = snapshot.periodEnd;
    for (const day of Array.isArray(snapshot.dailySales) ? snapshot.dailySales : []) {
      const existing = dailyMap.get(day.date) || { date: day.date, offlineSalesAmount: 0, revenueLineCount: 0, totalLineCount: 0, quantity: 0 };
      existing.offlineSalesAmount += Number(day.offlineSalesAmount || 0);
      existing.revenueLineCount += Number(day.revenueLineCount || 0);
      existing.totalLineCount += Number(day.totalLineCount || 0);
      existing.quantity += Number(day.quantity || 0);
      dailyMap.set(day.date, existing);
    }
  }

  return {
    schemaVersion: 1,
    month,
    periodStart,
    periodEnd,
    source: "ecount_sales_status_excel_store_separated",
    // STORE-BATCH-B Part 6: 두 매장 중 하나만 업로드된 상태를 정상 처리하기 위한 완전성
    // 신호 — VAIL이 storesMissing에 있으면 UI가 "미업로드"로 구분하고, ALL 합계가
    // 아직 불완전하다는 것을 알 수 있다(0으로 조용히 확정하지 않는다).
    storesIncluded,
    storesMissing: KNOWN_STORE_CODES.filter((code) => !storesIncluded.includes(code)),
    sources,
    totalOfflineSales,
    totalLineCount,
    revenueLineCount,
    nonRevenueLineCount: totalLineCount - revenueLineCount,
    personalPaymentSales,
    personalPaymentCount,
    dailySales: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    salesLines,
    rows: salesLines,
    // 병합된 스냅샷들 중 가장 최신 importedAt(NEXT-MONTHLY-ARCHIVE-STALE-CACHE의 stale
    // 비교 용도와 동일한 목적) — 매장별 개별 시각은 sources[]에 그대로 보존된다.
    importedAt: sources.reduce((latest, s) => (s.importedAt && (!latest || s.importedAt > latest) ? s.importedAt : latest), null)
  };
}

// month의 매장별 분리 스냅샷이 하나라도 있으면 전부 합쳐서 반환한다(레거시 단일 파일이
// 남아있어도 무시 — 이중집계 방지). 매장별 분리 스냅샷이 하나도 없으면(STORE-BATCH-B
// 이전에 업로드된 과거 월) 레거시 단일 파일을 그대로 읽어 반환하되, 그 라인들은 매장을
// 알 수 없으므로 storeCode: null(UNKNOWN)을 채운다 — 압구정으로 임의 추정하지 않는다
// (STORE-BATCH-A Part 6 / STORE-BATCH-B 절대 원칙 4). 이 fallback 덕분에 기존 9개월치
// 데이터의 ALL 합계는 이번 배치 이후에도 완전히 동일하게 유지된다.
export async function readEcountOfflineSalesSnapshot(month, options = {}) {
  assertEcountSalesMonth(month);
  if (options.storeCode) {
    return readSnapshotFile(ecountOfflineSalesSnapshotPath(month, options));
  }
  const storeSnapshots = [];
  for (const storeCode of KNOWN_STORE_CODES) {
    const snapshot = await readSnapshotFile(ecountOfflineSalesSnapshotPath(month, { ...options, storeCode }));
    if (snapshot) storeSnapshots.push({ storeCode, snapshot });
  }
  if (storeSnapshots.length) return mergeStoreSnapshots(month, storeSnapshots);

  const legacy = await readSnapshotFile(ecountOfflineSalesSnapshotPath(month, options));
  if (!legacy) return null;
  const legacyLines = (Array.isArray(legacy.salesLines) ? legacy.salesLines : Array.isArray(legacy.rows) ? legacy.rows : [])
    .map((line) => ({ ...line, storeCode: line.storeCode ?? null }));
  return {
    ...legacy,
    source: legacy.source || "ecount_sales_status_excel",
    storesIncluded: [],
    storesMissing: [...KNOWN_STORE_CODES],
    salesLines: legacyLines,
    rows: legacyLines
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const month = process.argv[2];
  if (!month) {
    console.error("Usage: node scripts/read-ecount-offline-sales-snapshot.mjs YYYY-MM [storeCode]");
    process.exit(1);
  }
  const storeCode = process.argv[3] || undefined;
  const snapshot = await readEcountOfflineSalesSnapshot(month, storeCode ? { storeCode } : {});
  console.log(JSON.stringify(snapshot, null, 2));
}
