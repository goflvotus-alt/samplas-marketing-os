import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importEcountOfflineSalesSnapshot } from "../scripts/import-ecount-offline-sales.mjs";

// PHASE 5A / Section D-E: proves — with a real parsed XLSX, not a mocked importer —
// that the existing filename-vs-content-month guard (import-ecount-offline-sales.mjs
// monthFromLoadedSales + importEcountOfflineSalesSnapshot's expectedMonth check)
// actually rejects a mismatched or mixed-month upload before any canonical write,
// and still accepts a genuinely matching one. Row parsing itself (date formats,
// warehouse column, personal-payment detection) is already covered by
// ecount-offline-sales-sheet.test.mjs — this file only exercises the month gate.

const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// rows: [{ dateNo, warehouseName, amount, productName }]. Builds one real minimal
// xlsx (same zip-of-XML approach as ecount-offline-sales-sheet.test.mjs) with N
// detail rows plus two trailing summary rows (blank 일자-No.) to prove summary rows
// never influence the detected content month.
async function workbookFixture(rows) {
  const dir = await mkdtemp(join(tmpdir(), "ecount-month-"));
  const xl = join(dir, "xl");
  await mkdir(join(xl, "_rels"), { recursive: true });
  await mkdir(join(xl, "worksheets"), { recursive: true });
  await writeFile(join(xl, "workbook.xml"), `<workbook xmlns:r="r"><sheets><sheet name="판매현황내역" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  await writeFile(join(xl, "_rels", "workbook.xml.rels"), `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
  const header = `<row><c r="A1" t="inlineStr"><is><t>일자-No.</t></is></c><c r="B1" t="inlineStr"><is><t>품목명</t></is></c><c r="C1" t="inlineStr"><is><t>규격</t></is></c><c r="D1" t="inlineStr"><is><t>수량</t></is></c><c r="E1" t="inlineStr"><is><t>품목그룹1명</t></is></c><c r="F1" t="inlineStr"><is><t>거래처명</t></is></c><c r="G1" t="inlineStr"><is><t>PO. NO</t></is></c><c r="H1" t="inlineStr"><is><t>합계</t></is></c><c r="I1" t="inlineStr"><is><t>창고명</t></is></c></row>`;
  const dataRows = rows.map((row, index) => {
    const r = index + 2;
    return `<row><c r="A${r}" t="inlineStr"><is><t>${xml(row.dateNo)}</t></is></c><c r="B${r}" t="inlineStr"><is><t>${xml(row.productName || "TEST PRODUCT")}</t></is></c><c r="C${r}" t="inlineStr"><is><t>OS</t></is></c><c r="D${r}"><v>1</v></c><c r="E${r}" t="inlineStr"><is><t>TEST</t></is></c><c r="F${r}" t="inlineStr"><is><t>고객${r}</t></is></c><c r="G${r}" t="inlineStr"><is><t>PO-${r}</t></is></c><c r="H${r}"><v>${row.amount}</v></c><c r="I${r}" t="inlineStr"><is><t>${xml(row.warehouseName)}</t></is></c></row>`;
  }).join("");
  const summaryRowIndex = rows.length + 2;
  const summaryRows = `
    <row><c r="A${summaryRowIndex}" t="inlineStr"><is><t>월계</t></is></c><c r="H${summaryRowIndex}"><v>999999</v></c></row>
    <row><c r="A${summaryRowIndex + 1}" t="inlineStr"><is><t>총합계</t></is></c><c r="H${summaryRowIndex + 1}"><v>999999</v></c></row>`;
  await writeFile(join(xl, "worksheets", "sheet1.xml"), `<worksheet><sheetData>${header}${dataRows}${summaryRows}</sheetData></worksheet>`);
  const file = join(dir, "fixture.xlsx");
  execFileSync("zip", ["-qr", file, "xl"], { cwd: dir });
  return { dir, file };
}

const withWorkbook = async (rows, fn) => {
  const fixture = await workbookFixture(rows);
  try { return await fn(fixture.file); } finally { await rm(fixture.dir, { recursive: true, force: true }); }
};

const withWorkDir = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), "ecount-month-work-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

const listSnapshotFiles = async (workDir) => {
  try { return (await readdir(join(workDir, "ecount-sales"))).sort(); } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};

test("PASS: filename 2026-09.xlsx with real September rows across both warehouses imports and routes correctly", () => withWorkDir((workDir) => withWorkbook([
  { dateNo: "2026/09/03 -1", warehouseName: "매장", amount: 10000 },
  { dateNo: "2026/09/04 -2", warehouseName: "SAMPLAS Veil", amount: 20000 }
], async (file) => {
  const result = await importEcountOfflineSalesSnapshot(file, { workDir, expectedMonth: "2026-09" });
  assert.equal(result.snapshot.month, "2026-09");
  const files = await listSnapshotFiles(workDir);
  assert.deepEqual(files, ["2026-09.APGUJEONG.json", "2026-09.VAIL.json"]);
  const apgujeong = result.snapshots.find((s) => s.storeCode === "APGUJEONG");
  const vail = result.snapshots.find((s) => s.storeCode === "VAIL");
  assert.equal(apgujeong.totalOfflineSales, 10000);
  assert.equal(vail.totalOfflineSales, 20000);
})));

test("REJECT: filename 2026-09.xlsx containing only real August rows is rejected before any write", () => withWorkDir((workDir) => withWorkbook([
  { dateNo: "2026/08/15 -1", warehouseName: "매장", amount: 10000 },
  { dateNo: "2026/08/16 -2", warehouseName: "SAMPLAS Veil", amount: 20000 }
], async (file) => {
  await assert.rejects(
    () => importEcountOfflineSalesSnapshot(file, { workDir, expectedMonth: "2026-09" }),
    /파일명 월 2026-09.*XLSX 데이터 월 2026-08/
  );
  assert.deepEqual(await listSnapshotFiles(workDir), []);
})));

test("REJECT: September filename with mixed August+September real rows is rejected before any write, error names both", () => withWorkDir((workDir) => withWorkbook([
  { dateNo: "2026/08/30 -1", warehouseName: "매장", amount: 10000 },
  { dateNo: "2026/09/01 -2", warehouseName: "매장", amount: 20000 }
], async (file) => {
  await assert.rejects(
    () => importEcountOfflineSalesSnapshot(file, { workDir, expectedMonth: "2026-09" }),
    /must not span multiple months: 2026-08-30 ~ 2026-09-01 \(파일명 월: 2026-09\)/
  );
  assert.deepEqual(await listSnapshotFiles(workDir), []);
})));

test("PASS: trailing 월계/총합계 summary rows never shift the detected content month", () => withWorkDir((workDir) => withWorkbook([
  { dateNo: "2026/09/03 -1", warehouseName: "매장", amount: 10000 },
  { dateNo: "2026/09/04 -2", warehouseName: "SAMPLAS Veil", amount: 20000 }
], async (file) => {
  const result = await importEcountOfflineSalesSnapshot(file, { workDir, expectedMonth: "2026-09" });
  assert.equal(result.snapshot.month, "2026-09");
  const apgujeong = result.snapshots.find((s) => s.storeCode === "APGUJEONG");
  assert.equal(apgujeong.totalOfflineSales, 10000, "summary row amount(999999) must not leak into a store total");
})));

test("REJECT: an unrecognized warehouse name in a routed month is rejected before any write", () => withWorkDir((workDir) => withWorkbook([
  { dateNo: "2026/09/03 -1", warehouseName: "매장", amount: 10000 },
  { dateNo: "2026/09/04 -2", warehouseName: "알수없는창고", amount: 5000 }
], async (file) => {
  await assert.rejects(
    () => importEcountOfflineSalesSnapshot(file, { workDir, expectedMonth: "2026-09" }),
    /Unknown ECOUNT warehouse.*알수없는창고/
  );
  assert.deepEqual(await listSnapshotFiles(workDir), []);
})));

test("OBSERVED (not a fix in this phase): a routed-month file with zero rows for one warehouse still writes a zero-value snapshot for it, not a rejection", () => withWorkDir((workDir) => withWorkbook([
  { dateNo: "2026/09/03 -1", warehouseName: "매장", amount: 10000 }
], async (file) => {
  const result = await importEcountOfflineSalesSnapshot(file, { workDir, expectedMonth: "2026-09" });
  const vail = result.snapshots.find((s) => s.storeCode === "VAIL");
  assert.equal(vail.totalOfflineSales, 0);
  assert.equal(vail.totalLineCount, 0);
  // This is existing, unauthorized-to-change behavior for this phase (Section D scope
  // is filename/content-month only) — recorded here so it is a proven fact, not a guess,
  // for the Section E "empty required warehouse" line in the final report.
})));
