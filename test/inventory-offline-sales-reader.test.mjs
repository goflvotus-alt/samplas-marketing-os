// Inventory의 buildEcountOfflineSalesIndexFromDisk() P0 fix 검증 — warehouse-split
// 파일(YYYY-MM.APGUJEONG.json/YYYY-MM.VAIL.json)도 legacy 병합 파일(YYYY-MM.json)과
// 동일하게 인식하고, 존재 시 legacy는 무시해 double-count를 방지하는지 확인한다.
// (docs/reports/inventory-intelligence-v2-preaudit-2026-08-26.md §B.1에서 발견된 gap)
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEcountSalesSnapshot } from "../scripts/import-ecount-offline-sales.mjs";
import { buildEcountOfflineSalesIndexFromDisk } from "../intelligence-service.mjs";

const withTemp = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), "inv-offline-sales-"));
  try { return await fn(join(dir, "work")); } finally { await rm(dir, { recursive: true, force: true }); }
};

function line({ date, amount = 10000, qty = 1, productName = "NAMILIA / Test Item", specification = "OS", isOfflineRevenue = true, slipNo = "1" }) {
  return {
    date, slipNo, documentNo: slipNo, productName, specification, quantity: qty,
    brandGroup: "NAM", customerName: "매장방문고객", poNo: slipNo,
    salesAmount: amount, isPersonalPayment: false, personalPaymentReason: null, isOfflineRevenue
  };
}

async function writeSnapshot(workDir, month, lines, options = {}) {
  const total = lines.reduce((sum, l) => sum + l.salesAmount, 0);
  const loaded = {
    fileName: `${month}.xlsx`, periodStart: lines[0]?.date || `${month}-01`, periodEnd: lines.at(-1)?.date || `${month}-01`,
    totalOfflineSales: total, totalLineCount: lines.length,
    revenueLineCount: lines.filter((l) => l.isOfflineRevenue).length,
    nonRevenueLineCount: lines.filter((l) => !l.isOfflineRevenue).length,
    personalPaymentSales: 0, personalPaymentCount: 0,
    dailySales: [{ date: lines[0]?.date || `${month}-01`, offlineSalesAmount: total, revenueLineCount: lines.length, totalLineCount: lines.length, quantity: lines.length }],
    salesLines: lines
  };
  const snapshot = buildEcountSalesSnapshot(loaded, month, options);
  const dir = join(workDir, "ecount-sales");
  await mkdir(dir, { recursive: true });
  const fileName = options.storeCode ? `${month}.${options.storeCode}.json` : `${month}.json`;
  await writeFile(join(dir, fileName), JSON.stringify(snapshot, null, 2));
}

function totalQtyFor(index, productName, specification) {
  const entry = index.index.get(`${productName}|${specification}`);
  return entry ? entry.totalQty : 0;
}

test("1. legacy only — single merged month file is read", () => withTemp(async (workDir) => {
  await writeSnapshot(workDir, "2026-07", [line({ date: "2026-07-05", qty: 3 })]);
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 3);
}));

test("2. split only, two stores — both merged, no legacy file", () => withTemp(async (workDir) => {
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-01", qty: 2 })], { storeCode: "APGUJEONG" });
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-02", qty: 5 })], { storeCode: "VAIL" });
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 7, "두 매장 판매수량이 합산되어야 한다");
}));

test("3. APGUJEONG only — VAIL missing does not crash or fabricate data", () => withTemp(async (workDir) => {
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-01", qty: 4 })], { storeCode: "APGUJEONG" });
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 4);
}));

test("4. VAIL only", () => withTemp(async (workDir) => {
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-01", qty: 6 })], { storeCode: "VAIL" });
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 6);
}));

test("5. legacy + split coexist for the same month — split wins, no double count", () => withTemp(async (workDir) => {
  // 레거시 병합 파일이 (예: 과거 업로드 잔재로) 여전히 남아있어도, 매장별 분리 파일이
  // 존재하면 그쪽만 사용해야 한다 — 둘 다 합치면 이중 집계가 된다.
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-01", qty: 999 })]);
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-01", qty: 2 })], { storeCode: "APGUJEONG" });
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-02", qty: 5 })], { storeCode: "VAIL" });
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 7, "legacy(999)는 무시되고 split 합계(2+5=7)만 반영되어야 한다");
}));

test("6. malformed filename is ignored, not crashed on", () => withTemp(async (workDir) => {
  const dir = join(workDir, "ecount-sales");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "not-a-month.json"), "{}");
  await writeFile(join(dir, "2026-07.before-2026-07-27.json"), "{}"); // 알려진 legacy 백업 산출물
  await writeSnapshot(workDir, "2026-07", [line({ date: "2026-07-05", qty: 1 })]);
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 1);
}));

test("7. unsupported store code file is not picked up as a known-store split", () => withTemp(async (workDir) => {
  const dir = join(workDir, "ecount-sales");
  await mkdir(dir, { recursive: true });
  // KNOWN_STORE_CODES에 없는 매장코드 — readEcountOfflineSalesSnapshot이 이 파일을 찾지
  // 않으므로(APGUJEONG/VAIL만 스캔) 정상적으로 무시되어야 한다.
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-01", qty: 100 })], { storeCode: "UNKNOWN_STORE" });
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 0, "미지원 매장코드 파일은 반영되지 않아야 한다");
}));

test("8. empty month directory returns an empty, non-throwing index", () => withTemp(async (workDir) => {
  await mkdir(join(workDir, "ecount-sales"), { recursive: true });
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(idx.index.size, 0);
  assert.equal(idx.latestDataDate, null);
}));

test("9. non-revenue lines (e.g. 택배 이동) are excluded from recent sales quantity", () => withTemp(async (workDir) => {
  await writeSnapshot(workDir, "2026-07", [
    line({ date: "2026-07-05", qty: 3, isOfflineRevenue: true }),
    line({ date: "2026-07-06", qty: 50, isOfflineRevenue: false, slipNo: "2" })
  ]);
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 3, "isOfflineRevenue:false 라인은 집계에서 제외되어야 한다");
}));

test("10. July historical regression — legacy-only month unaffected by the fix", () => withTemp(async (workDir) => {
  await writeSnapshot(workDir, "2026-07", [line({ date: "2026-07-10", qty: 8 })]);
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 8);
}));

test("11. August regression — merged file present alongside split files (real production shape)", () => withTemp(async (workDir) => {
  // 2026-08은 실제 production에서 legacy 병합 파일과 매장별 분리 파일이 공존하는 달이다.
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-01", qty: 999 })]); // stale legacy 잔재
  await writeSnapshot(workDir, "2026-08", [line({ date: "2026-08-01", qty: 10 })], { storeCode: "APGUJEONG" });
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 10, "split 파일이 있으면 legacy 잔재는 무시되어야 한다");
}));

test("12. September split-only future case — no merged file exists yet", () => withTemp(async (workDir) => {
  // 실제 production 상태(2026-09.APGUJEONG.json만 존재, 2026-09.json 없음)를 그대로 재현.
  await writeSnapshot(workDir, "2026-09", [line({ date: "2026-09-02", qty: 12 })], { storeCode: "APGUJEONG" });
  const idx = await buildEcountOfflineSalesIndexFromDisk(workDir);
  assert.equal(totalQtyFor(idx, "NAMILIA / Test Item", "OS"), 12, "병합 파일이 없어도 split 파일만으로 정상 집계되어야 한다(수정 전에는 0이었을 케이스)");
}));

console.log("inventory offline sales reader (warehouse-split P0 fix) tests passed");
