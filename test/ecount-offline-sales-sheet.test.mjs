import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEcountOfflineSalesExcel } from "../scripts/load-ecount-offline-sales.mjs";

const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function workbookFixture(sheets) {
  const dir = await mkdtemp(join(tmpdir(), "ecount-sheet-"));
  const xl = join(dir, "xl");
  await mkdir(join(xl, "_rels"), { recursive: true });
  await mkdir(join(xl, "worksheets"), { recursive: true });
  const sheetTags = sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const relTags = sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  await writeFile(join(xl, "workbook.xml"), `<workbook xmlns:r="r"><sheets>${sheetTags}</sheets></workbook>`);
  await writeFile(join(xl, "_rels", "workbook.xml.rels"), `<Relationships>${relTags}</Relationships>`);
  for (const [index, sheet] of sheets.entries()) {
    const warehouseHeader = Object.hasOwn(sheet, "warehouseName") ? `<c r="I1" t="inlineStr"><is><t>창고명</t></is></c>` : "";
    const warehouseCell = Object.hasOwn(sheet, "warehouseName") ? `<c r="I2" t="inlineStr"><is><t>${xml(sheet.warehouseName)}</t></is></c>` : "";
    const summaryRows = sheet.summaryRows ? `
      <row><c r="A3" t="inlineStr"><is><t>2026/08  계</t></is></c><c r="H3"><v>${sheet.amount}</v></c></row>
      <row><c r="A4" t="inlineStr"><is><t>총합계</t></is></c><c r="H4"><v>${sheet.amount}</v></c></row>` : "";
    const dateNo = sheet.dateNo || "2026/08/13 -2";
    await writeFile(join(xl, "worksheets", `sheet${index + 1}.xml`), `<worksheet><sheetData>
      <row><c r="A1" t="inlineStr"><is><t>일자-No.</t></is></c><c r="B1" t="inlineStr"><is><t>품목명</t></is></c><c r="C1" t="inlineStr"><is><t>규격</t></is></c><c r="D1" t="inlineStr"><is><t>수량</t></is></c><c r="E1" t="inlineStr"><is><t>품목그룹1명</t></is></c><c r="F1" t="inlineStr"><is><t>거래처명</t></is></c><c r="G1" t="inlineStr"><is><t>PO. NO</t></is></c><c r="H1" t="inlineStr"><is><t>합계</t></is></c>${warehouseHeader}</row>
      <row><c r="A2" t="inlineStr"><is><t>${xml(dateNo)}</t></is></c><c r="B2" t="inlineStr"><is><t>${xml(sheet.productName || "TEST PRODUCT")}</t></is></c><c r="C2" t="inlineStr"><is><t>OS</t></is></c><c r="D2"><v>1</v></c><c r="E2" t="inlineStr"><is><t>${xml(sheet.brandGroup || "TEST")}</t></is></c><c r="F2" t="inlineStr"><is><t>성진님</t></is></c><c r="G2" t="inlineStr"><is><t>PO-1</t></is></c><c r="H2"><v>${sheet.amount}</v></c>${warehouseCell}</row>${summaryRows}
    </sheetData></worksheet>`);
  }
  const file = join(dir, "fixture.xlsx");
  execFileSync("zip", ["-qr", file, "xl"], { cwd: dir });
  return { dir, file };
}

const withWorkbook = async (sheets, fn) => {
  const fixture = await workbookFixture(sheets);
  try { return await fn(fixture.file); } finally { await rm(fixture.dir, { recursive: true, force: true }); }
};

test("loads the current 판매현황내역 sheet without changing row parsing", () => withWorkbook([
  { name: "판매현황내역", amount: 70200, productName: "PACOSPLY / WonderLand T-shirts BLACK", brandGroup: "PAC" }
], (file) => {
  const result = loadEcountOfflineSalesExcel(file);
  assert.equal(result.sheetName, "판매현황내역");
  assert.equal(result.revenueLineCount, 1);
  assert.equal(result.totalOfflineSales, 70200);
  assert.deepEqual(result.salesLines[0], {
    date: "2026-08-13", slipNo: "2", documentNo: "2",
    productName: "PACOSPLY / WonderLand T-shirts BLACK", specification: "OS", quantity: 1,
    brandGroup: "PAC", customerName: "성진님", poNo: "PO-1", salesAmount: 70200,
    isPersonalPayment: false, personalPaymentReason: null, isOfflineRevenue: true
  });
}));

test("keeps legacy 판매현황 compatibility", () => withWorkbook([
  { name: "판매현황", amount: 100 }
], (file) => assert.equal(loadEcountOfflineSalesExcel(file).sheetName, "판매현황")));

test("explicit sheetName overrides the default priority", () => withWorkbook([
  { name: "판매현황내역", amount: 200 }, { name: "판매현황", amount: 100 }
], (file) => {
  assert.equal(loadEcountOfflineSalesExcel(file).totalOfflineSales, 200);
  assert.equal(loadEcountOfflineSalesExcel(file, { sheetName: "판매현황" }).totalOfflineSales, 100);
}));

test("missing explicit and supported sheets fail clearly", () => withWorkbook([
  { name: "다른시트", amount: 100 }
], (file) => {
  assert.throws(() => loadEcountOfflineSalesExcel(file, { sheetName: "지정시트" }), /Sheet not found: 지정시트/);
  assert.throws(() => loadEcountOfflineSalesExcel(file), /Sheet not found: 판매현황내역, 판매현황/);
}));

test("reads warehouse name from detail rows and ignores blank-warehouse summary rows", () => withWorkbook([
  { name: "판매현황내역", amount: 70200, warehouseName: "SAMPLAS Veil", summaryRows: true }
], (file) => {
  const result = loadEcountOfflineSalesExcel(file);
  assert.equal(result.totalLineCount, 1);
  assert.equal(result.salesLines[0].warehouseName, "SAMPLAS Veil");
  assert.equal(result.salesLines[0].sourceRowNumber, 2);
}));

test("accepts compact YYYYMMDD date-No. format alongside the slash format", () => withWorkbook([
  { name: "판매현황내역", amount: 70200, dateNo: "20260813 -2" }
], (file) => {
  const result = loadEcountOfflineSalesExcel(file);
  assert.equal(result.revenueLineCount, 1);
  assert.equal(result.salesLines[0].date, "2026-08-13");
  assert.equal(result.salesLines[0].slipNo, "2");
}));

test("parses a compact-date year boundary correctly (no month/day digit bleed)", () => withWorkbook([
  { name: "판매현황내역", amount: 100, dateNo: "20261231 -5" }
], (file) => {
  const result = loadEcountOfflineSalesExcel(file);
  assert.equal(result.salesLines[0].date, "2026-12-31");
  assert.equal(result.salesLines[0].slipNo, "5");
}));

test("rejects a malformed date-No. (dash-separated) instead of misparsing it", () => withWorkbook([
  { name: "판매현황내역", amount: 100, dateNo: "2026-08-13 -2" }
], (file) => {
  const result = loadEcountOfflineSalesExcel(file);
  assert.equal(result.revenueLineCount, 0, "지원하지 않는 구분자는 매칭되지 않고 조용히 skip되어야 한다");
}));
