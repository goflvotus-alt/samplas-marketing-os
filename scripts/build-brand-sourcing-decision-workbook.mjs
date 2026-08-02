import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nodeModules = process.env.CODEX_NODE_MODULES;
if (!nodeModules) throw new Error("CODEX_NODE_MODULES is required");
const require = createRequire(join(nodeModules, "package.json"));
const { SpreadsheetFile, Workbook } = require("@oai/artifact-tool");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  reviewJson: resolve(root, "work/brand-sourcing-representative-review.json"),
  reviewCsv: resolve(root, "work/brand-sourcing-representative-review.csv"),
  brandMaster: resolve(root, "work/brand-master.json"),
  universe: resolve(root, "work/brand-universe.json"),
  candidates: resolve(root, "work/brand-sourcing-candidates.json"),
  workbook: resolve(root, "work/brand-sourcing-representative-decision.xlsx"),
  guide: resolve(root, "work/brand-sourcing-representative-decision-guide.md")
};
const decisions = ["CONNECT_EXISTING", "NEW_BRAND_CANDIDATE", "SOURCE_NAME_ERROR", "HOLD", "REJECT"];
const reviewHeaders = [
  "번호", "universe_brand_code", "universe_brand_name", "universe_status",
  "xlsb_source_brand_name", "xlsb_source_row", "sourcing_type",
  "suggested_brand_code", "suggested_brand_name", "suggestion_basis", "confidence",
  "representative_decision", "approved_brand_code", "approved_brand_name", "approved_alias", "representative_note"
];
const guideRows = [
  ["항목", "안내"],
  ["목적", "31개 Brand Sourcing 미매칭 항목을 대표가 직접 검토하고 결정하기 위한 입력 파일입니다."],
  ["자동 승인", "이 파일은 어떤 브랜드도 자동 승인하거나 Master Data에 반영하지 않습니다."],
  ["CONNECT_EXISTING", "기존 Brand Master와 연결. approved_brand_code, approved_brand_name, approved_alias 필수."],
  ["NEW_BRAND_CANDIDATE", "실제 신규 브랜드. approved_brand_name 필수이며 brand_code는 이번 단계에서 비워도 됩니다."],
  ["SOURCE_NAME_ERROR", "원천 브랜드명이 오기입 또는 잘못된 표기. representative_note 필수."],
  ["HOLD", "판단 보류. representative_note 입력을 권장합니다."],
  ["REJECT", "Brand Universe 또는 sourcing 대상에서 제외. representative_note 필수."],
  ["할인율", "할인율은 이번 검토 범위가 아니며 워크북에 포함하지 않았습니다."],
  ["다음 단계", "대표 결정 완료 후 별도 검증 STEP에서만 Brand Master 반영을 진행합니다."]
];
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const text = (value) => String(value ?? "").trim();

const review = await readJson(paths.reviewJson);
await readFile(paths.reviewCsv, "utf8");
const masterFile = await readJson(paths.brandMaster);
const master = Array.isArray(masterFile) ? masterFile : masterFile?.brands;
const universe = await readJson(paths.universe);
const candidates = await readJson(paths.candidates);
if (!Array.isArray(review) || review.length !== 31) throw new Error("Expected 31 representative review rows");
if (!Array.isArray(master) || !Array.isArray(universe) || universe.length !== 44 || !Array.isArray(candidates) || candidates.length !== 13) throw new Error("Unexpected Master Data inputs");

const reviewCodes = new Set(review.map((item) => text(item.universe_brand_code)));
const universeCodes = new Set(universe.map((item) => text(item.brand_code)));
const candidateCodes = new Set(candidates.map((item) => text(item.brand_code)));
if (reviewCodes.size !== 31 || review.some((item) => !universeCodes.has(text(item.universe_brand_code)) || candidateCodes.has(text(item.universe_brand_code)))) throw new Error("Review completeness failed");

const reviewRows = review.map((item, index) => [
  index + 1,
  text(item.universe_brand_code),
  text(item.universe_brand_name),
  text(item.universe_status),
  text(item.xlsb_source_brand_name),
  item.xlsb_source_row ?? null,
  text(item.sourcing_type),
  text(item.suggested_brand_code),
  text(item.suggested_brand_name),
  text(item.suggestion_basis),
  text(item.confidence),
  "", "", "", "", ""
]);
const masterRows = master.map((item) => [
  text(item.brand_code),
  text(item.brand_name),
  item.active === false ? "INACTIVE" : "ACTIVE",
  (Array.isArray(item.name_aliases) ? item.name_aliases : []).map(text).filter(Boolean).join(" | ")
]);

const workbook = Workbook.create();
const reviewSheet = workbook.worksheets.add("대표 검토");
const masterSheet = workbook.worksheets.add("Brand Master 참고");
const guideSheet = workbook.worksheets.add("입력 가이드");
reviewSheet.showGridLines = false;
masterSheet.showGridLines = false;
guideSheet.showGridLines = false;

reviewSheet.getRange(`A1:P${reviewRows.length + 1}`).values = [reviewHeaders, ...reviewRows];
reviewSheet.freezePanes.freezeRows(1);
const reviewTable = reviewSheet.tables.add(`A1:P${reviewRows.length + 1}`, true, "RepresentativeReviewTable");
reviewTable.showFilterButton = true;
reviewSheet.getRange("A1:P1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
  verticalAlignment: "center"
};
reviewSheet.getRange(`L2:P${reviewRows.length + 1}`).format = { fill: "#FFF2CC", wrapText: true };
reviewSheet.getRange(`A2:K${reviewRows.length + 1}`).format = { fill: "#F7F9FC" };
reviewSheet.getRange(`L2:L${reviewRows.length + 1}`).dataValidation = { rule: { type: "list", values: decisions } };
reviewSheet.getRange(`A1:P${reviewRows.length + 1}`).format.borders = { preset: "inside", style: "thin", color: "#D9E2F3" };
reviewSheet.getRange(`A1:A${reviewRows.length + 1}`).format.columnWidth = 7;
for (const column of ["B", "D", "F", "G", "H", "J", "K", "L", "M"]) reviewSheet.getRange(`${column}1:${column}${reviewRows.length + 1}`).format.columnWidth = 18;
for (const column of ["C", "E", "I", "N", "O"]) reviewSheet.getRange(`${column}1:${column}${reviewRows.length + 1}`).format.columnWidth = 24;
reviewSheet.getRange(`P1:P${reviewRows.length + 1}`).format.columnWidth = 36;
reviewSheet.getRange(`E2:P${reviewRows.length + 1}`).format.wrapText = true;
reviewSheet.getRange("A1:P1").format.rowHeight = 34;

const masterHeaders = ["brand_code", "brand_name", "status", "aliases"];
masterSheet.getRange(`A1:D${masterRows.length + 1}`).values = [masterHeaders, ...masterRows];
masterSheet.freezePanes.freezeRows(1);
const masterTable = masterSheet.tables.add(`A1:D${masterRows.length + 1}`, true, "BrandMasterReferenceTable");
masterTable.showFilterButton = true;
masterSheet.getRange("A1:D1").format = { fill: "#44546A", font: { bold: true, color: "#FFFFFF" } };
masterSheet.getRange(`A2:D${masterRows.length + 1}`).format = { fill: "#F7F7F7" };
masterSheet.getRange(`A1:A${masterRows.length + 1}`).format.columnWidth = 18;
masterSheet.getRange(`B1:B${masterRows.length + 1}`).format.columnWidth = 30;
masterSheet.getRange(`C1:C${masterRows.length + 1}`).format.columnWidth = 14;
masterSheet.getRange(`D1:D${masterRows.length + 1}`).format.columnWidth = 48;
masterSheet.getRange(`D2:D${masterRows.length + 1}`).format.wrapText = true;

guideSheet.getRange(`A1:B${guideRows.length}`).values = guideRows;
guideSheet.freezePanes.freezeRows(1);
guideSheet.getRange("A1:B1").format = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" } };
guideSheet.getRange(`A2:A${guideRows.length}`).format = { fill: "#D9EAF7", font: { bold: true } };
guideSheet.getRange(`B2:B${guideRows.length}`).format = { fill: "#F7F9FC", wrapText: true };
guideSheet.getRange(`A1:A${guideRows.length}`).format.columnWidth = 24;
guideSheet.getRange(`B1:B${guideRows.length}`).format.columnWidth = 90;
guideSheet.getRange(`A1:B${guideRows.length}`).format.borders = { preset: "inside", style: "thin", color: "#D9E2F3" };

const inspection = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 2000
});
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(paths.workbook);

const previewDir = process.env.SAMPLAS_WORKBOOK_PREVIEW_DIR;
if (previewDir) {
  await mkdir(previewDir, { recursive: true });
  for (const sheetName of ["대표 검토", "Brand Master 참고", "입력 가이드"]) {
    const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
    await writeFile(join(previewDir, `${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}

const guide = `# Brand Sourcing Representative Decision Guide

대표 입력 열: representative_decision, approved_brand_code, approved_brand_name, approved_alias, representative_note

## Decision enum

- CONNECT_EXISTING: approved_brand_code, approved_brand_name, approved_alias 필수
- NEW_BRAND_CANDIDATE: approved_brand_name 필수
- SOURCE_NAME_ERROR: representative_note 필수
- HOLD: representative_note 권장
- REJECT: representative_note 필수

이 워크북은 자동 승인하지 않으며, 할인율을 포함하지 않습니다. Brand Master 반영은 다음 STEP의 별도 검증 후 진행합니다.
`;
await writeFile(paths.guide, guide, "utf8");
await rm(`${paths.workbook}.inspect.ndjson`, { force: true });

console.log(JSON.stringify({
  reviewRows: reviewRows.length,
  masterRows: masterRows.length,
  sheets: ["대표 검토", "Brand Master 참고", "입력 가이드"],
  decisions,
  inspection: inspection.ndjson
}, null, 2));
