import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { normalizeBrandKey } from "./brand-engine.mjs";

const nodeModules = process.env.CODEX_NODE_MODULES;
if (!nodeModules) throw new Error("CODEX_NODE_MODULES is required");
const require = createRequire(join(nodeModules, "package.json"));
const { FileBlob, SpreadsheetFile } = require("@oai/artifact-tool");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  workbook: resolve(root, "work/brand-sourcing-representative-decision.xlsx"),
  outputDir: resolve(root, "work")
};
const sourcePaths = {
  master: resolve(root, "work/brand-master.json"),
  universe: resolve(root, "work/brand-universe.json"),
  candidates: resolve(root, "work/brand-sourcing-candidates.json"),
  reviewQueue: resolve(root, "work/brand-sourcing-review-queue.json"),
  review: resolve(root, "work/brand-sourcing-representative-review.json")
};
const requiredHeaders = [
  "universe_brand_code", "universe_brand_name", "universe_status",
  "xlsb_source_brand_name", "xlsb_source_row", "sourcing_type",
  "representative_decision", "approved_brand_code", "approved_brand_name",
  "approved_alias", "representative_note"
];
const originalFields = [
  "universe_brand_code", "universe_brand_name", "universe_status",
  "xlsb_source_brand_name", "xlsb_source_row", "sourcing_type"
];
const inputFields = [
  "representative_decision", "approved_brand_code", "approved_brand_name",
  "approved_alias", "representative_note"
];
const decisions = new Set(["CONNECT_EXISTING", "NEW_BRAND_CANDIDATE", "SOURCE_NAME_ERROR", "HOLD", "REJECT"]);
const structuralCodes = new Set([
  "MISSING_REQUIRED_SHEET", "MISSING_REQUIRED_HEADER", "INVALID_ROW_COUNT",
  "DUPLICATE_UNIVERSE_BRAND_CODE", "REVIEW_TARGET_MISMATCH",
  "CANDIDATE_CONTAMINATION", "ORIGINAL_FIELD_MODIFIED"
]);
const text = (value) => String(value ?? "").trim();
const rawText = (value) => value == null ? "" : String(value);
const key = (value) => normalizeBrandKey(value);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const countBy = (items, getter) => Object.fromEntries(items.reduce((counts, item) => {
  const value = getter(item);
  counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}, new Map()));

function issue(severity, code, row, field, value, message) {
  return {
    severity,
    code,
    row_number: row?.workbook_row ?? null,
    universe_brand_code: row?.universe_brand_code ?? "",
    universe_brand_name: row?.universe_brand_name ?? "",
    decision: row?.representative_decision ?? "",
    field: field ?? "",
    value: rawText(value),
    message
  };
}

function exactCell(value) {
  return value == null ? "" : String(value);
}

function validateAlias(row, approvedCode, alias, indexes, issues) {
  if (!alias) return;
  const aliasKey = key(alias);
  const canonicalOwners = indexes.canonical.get(aliasKey) || new Set();
  const aliasOwners = indexes.alias.get(aliasKey) || new Set();
  const otherCanonical = [...canonicalOwners].filter((code) => code !== approvedCode);
  const otherAliases = [...aliasOwners].filter((code) => code !== approvedCode);
  if (otherCanonical.length) issues.push(issue("ERROR", "CANONICAL_NAME_CONFLICT", row, "approved_alias", alias, `Alias conflicts with canonical brand code(s): ${otherCanonical.join(", ")}`));
  if (otherAliases.length) issues.push(issue("ERROR", "EXISTING_ALIAS_CONFLICT", row, "approved_alias", alias, `Alias conflicts with existing alias owner(s): ${otherAliases.join(", ")}`));
  if (approvedCode && aliasOwners.has(approvedCode)) issues.push(issue("INFO", "ALIAS_ALREADY_EXISTS", row, "approved_alias", alias, "Alias already exists on the approved brand"));
}

function addWhitespaceIssues(row, raw, issues) {
  for (const field of inputFields) {
    const value = raw[field];
    if (value && value !== value.trim()) issues.push(issue("WARNING", "LEADING_OR_TRAILING_WHITESPACE", row, field, value, "Leading or trailing whitespace must be removed by the representative"));
  }
}

function validateDecisionRow(row, raw, masterByCode, indexes, issues) {
  const decision = row.representative_decision;
  addWhitespaceIssues(row, raw, issues);
  if (!decision) {
    issues.push(issue("INFO", "PENDING_DECISION", row, "representative_decision", "", "Representative decision is pending"));
    for (const field of inputFields.slice(1)) {
      if (row[field]) issues.push(issue("WARNING", "UNEXPECTED_FIELD_VALUE", row, field, raw[field], "Input exists while decision is pending"));
    }
    return;
  }
  if (!decisions.has(decision)) {
    issues.push(issue("ERROR", "INVALID_DECISION", row, "representative_decision", raw.representative_decision, "Decision must exactly match an allowed enum value"));
    return;
  }

  const required = (...fields) => {
    for (const field of fields) if (!row[field]) issues.push(issue("ERROR", "REQUIRED_FIELD_MISSING", row, field, raw[field], `${field} is required for ${decision}`));
  };
  const unexpected = (severity, ...fields) => {
    for (const field of fields) if (row[field]) issues.push(issue(severity, "UNEXPECTED_FIELD_VALUE", row, field, raw[field], `${field} should be empty for ${decision}`));
  };

  if (decision === "CONNECT_EXISTING") {
    required("approved_brand_code", "approved_brand_name", "approved_alias");
    const approved = masterByCode.get(row.approved_brand_code);
    if (row.approved_brand_code && !approved) issues.push(issue("ERROR", "UNKNOWN_APPROVED_BRAND_CODE", row, "approved_brand_code", raw.approved_brand_code, "Approved brand code does not exist in Brand Master"));
    if (approved && row.approved_brand_name !== text(approved.brand_name)) issues.push(issue("ERROR", "APPROVED_NAME_MISMATCH", row, "approved_brand_name", raw.approved_brand_name, `Expected canonical name: ${text(approved.brand_name)}`));
    if (row.approved_alias && row.approved_alias !== row.xlsb_source_brand_name) issues.push(issue("WARNING", "ALIAS_SOURCE_MISMATCH", row, "approved_alias", raw.approved_alias, "Approved alias differs from the XLSB source brand name"));
    validateAlias(row, row.approved_brand_code, row.approved_alias, indexes, issues);
    if (approved) issues.push(issue("INFO", "APPROVED_BRAND_LINK", row, "approved_brand_code", raw.approved_brand_code, row.approved_brand_code === row.universe_brand_code ? "Approved brand is the current Universe brand" : "Approved brand differs from the current Universe brand; representative confirmation retained"));
  }

  if (decision === "NEW_BRAND_CANDIDATE") {
    required("approved_brand_name");
    if (row.approved_brand_code) issues.push(issue("WARNING", "UNEXPECTED_FIELD_VALUE", row, "approved_brand_code", raw.approved_brand_code, "New brand code is created in a later STEP and should normally be empty"));
    const nameKey = key(row.approved_brand_name);
    if (nameKey && indexes.canonical.has(nameKey)) issues.push(issue("ERROR", "CANONICAL_NAME_CONFLICT", row, "approved_brand_name", raw.approved_brand_name, `Normalized name conflicts with existing canonical brand code(s): ${[...indexes.canonical.get(nameKey)].join(", ")}`));
    if (nameKey && indexes.alias.has(nameKey)) issues.push(issue("ERROR", "EXISTING_ALIAS_CONFLICT", row, "approved_brand_name", raw.approved_brand_name, `Name conflicts with existing alias owner(s): ${[...indexes.alias.get(nameKey)].join(", ")}`));
    validateAlias(row, "", row.approved_alias, indexes, issues);
  }

  if (decision === "SOURCE_NAME_ERROR") {
    if (!row.representative_note) issues.push(issue("ERROR", "SOURCE_ERROR_WITHOUT_NOTE", row, "representative_note", raw.representative_note, "SOURCE_NAME_ERROR requires a note"));
    unexpected("ERROR", "approved_brand_code", "approved_brand_name", "approved_alias");
  }

  if (decision === "HOLD") {
    if (!row.representative_note) issues.push(issue("WARNING", "HOLD_WITHOUT_NOTE", row, "representative_note", raw.representative_note, "HOLD should include a note"));
    unexpected("WARNING", "approved_brand_code", "approved_brand_name", "approved_alias");
    issues.push(issue("INFO", "EXCLUDED_FROM_APPLY", row, "representative_decision", decision, "HOLD is excluded from apply candidates"));
  }

  if (decision === "REJECT") {
    if (!row.representative_note) issues.push(issue("ERROR", "REJECT_WITHOUT_NOTE", row, "representative_note", raw.representative_note, "REJECT requires a note"));
    unexpected("ERROR", "approved_brand_code", "approved_brand_name", "approved_alias");
    issues.push(issue("INFO", "EXCLUDED_FROM_APPLY", row, "representative_decision", decision, "REJECT is excluded from apply candidates"));
  }
}

function addIndex(index, value, code) {
  const normalized = key(value);
  if (!normalized) return;
  const owners = index.get(normalized) || new Set();
  owners.add(code);
  index.set(normalized, owners);
}

async function loadSources() {
  const [masterFile, universe, candidates, reviewQueue, review] = await Promise.all([
    readJson(sourcePaths.master), readJson(sourcePaths.universe), readJson(sourcePaths.candidates),
    readJson(sourcePaths.reviewQueue), readJson(sourcePaths.review)
  ]);
  const master = Array.isArray(masterFile) ? masterFile : masterFile?.brands;
  if (![master, universe, candidates, reviewQueue, review].every(Array.isArray)) throw new Error("Invalid validation source JSON");
  return { master, universe, candidates, reviewQueue, review };
}

export async function validateWorkbook(workbookPath) {
  const sources = await loadSources();
  const issues = [];
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
  let sheet;
  try {
    sheet = workbook.worksheets.getItem("대표 검토");
  } catch {
    issues.push(issue("ERROR", "MISSING_REQUIRED_SHEET", null, "sheet", "대표 검토", "Required sheet is missing"));
  }

  let values = [];
  let headerIndex = new Map();
  if (sheet) {
    values = sheet.getUsedRange(true)?.values || [];
    const headers = (values[0] || []).map(text);
    headerIndex = new Map(headers.map((header, index) => [header, index]));
    for (const header of requiredHeaders) if (!headerIndex.has(header)) issues.push(issue("ERROR", "MISSING_REQUIRED_HEADER", null, header, "", `Required header is missing: ${header}`));
  }

  const canReadRows = sheet && requiredHeaders.every((header) => headerIndex.has(header));
  const rows = [];
  if (canReadRows) {
    for (let index = 1; index < values.length; index += 1) {
      const cells = values[index];
      const raw = Object.fromEntries(requiredHeaders.map((header) => [header, rawText(cells[headerIndex.get(header)])]));
      rows.push({
        workbook_row: index + 1,
        ...Object.fromEntries(requiredHeaders.map((header) => [header, text(cells[headerIndex.get(header)])])),
        _raw: raw
      });
    }
  }

  if (rows.length !== 31) issues.push(issue("ERROR", "INVALID_ROW_COUNT", null, "rows", rows.length, `Expected 31 data rows, found ${rows.length}`));
  const codes = rows.map((row) => row.universe_brand_code).filter(Boolean);
  for (const code of new Set(codes.filter((value, index) => codes.indexOf(value) !== index))) {
    for (const row of rows.filter((item) => item.universe_brand_code === code)) issues.push(issue("ERROR", "DUPLICATE_UNIVERSE_BRAND_CODE", row, "universe_brand_code", code, "Universe brand code is duplicated in workbook"));
  }

  const reviewByCode = new Map(sources.review.map((item) => [text(item.universe_brand_code), item]));
  const reviewQueueCodes = new Set(sources.reviewQueue.map((item) => text(item.brand_code)));
  const universeCodes = new Set(sources.universe.map((item) => text(item.brand_code)));
  const candidateCodes = new Set(sources.candidates.map((item) => text(item.brand_code)));
  const workbookCodes = new Set(codes);
  if (workbookCodes.size !== reviewByCode.size || [...workbookCodes].some((code) => !reviewByCode.has(code)) || [...reviewByCode.keys()].some((code) => !workbookCodes.has(code))) {
    issues.push(issue("ERROR", "REVIEW_TARGET_MISMATCH", null, "universe_brand_code", "", "Workbook targets do not exactly match representative review targets"));
  }

  for (const row of rows) {
    if (candidateCodes.has(row.universe_brand_code)) issues.push(issue("ERROR", "CANDIDATE_CONTAMINATION", row, "universe_brand_code", row.universe_brand_code, "Exact sourcing candidate must not appear in review workbook"));
    if (!universeCodes.has(row.universe_brand_code) || !reviewQueueCodes.has(row.universe_brand_code)) issues.push(issue("ERROR", "REVIEW_TARGET_MISMATCH", row, "universe_brand_code", row.universe_brand_code, "Brand is outside Brand Universe or review queue"));
    const expected = reviewByCode.get(row.universe_brand_code);
    if (!expected) continue;
    for (const field of originalFields) {
      const expectedValue = field === "universe_brand_code" ? text(expected.universe_brand_code) : exactCell(expected[field]);
      const actualValue = exactCell(row[field]);
      if (actualValue !== expectedValue) issues.push(issue("ERROR", "ORIGINAL_FIELD_MODIFIED", row, field, row._raw[field], `Original field differs from representative review JSON; expected ${expectedValue || "(blank)"}`));
    }
  }

  const masterByCode = new Map(sources.master.map((item) => [text(item.brand_code), item]).filter(([code]) => code));
  const indexes = { canonical: new Map(), alias: new Map() };
  for (const [code, brand] of masterByCode) {
    addIndex(indexes.canonical, brand.brand_name, code);
    for (const alias of Array.isArray(brand.name_aliases) ? brand.name_aliases : []) addIndex(indexes.alias, alias, code);
  }
  for (const row of rows) validateDecisionRow(row, row._raw, masterByCode, indexes, issues);

  const workbookAliases = new Map();
  for (const row of rows.filter((item) => ["CONNECT_EXISTING", "NEW_BRAND_CANDIDATE"].includes(item.representative_decision) && item.approved_alias)) {
    const aliasKey = key(row.approved_alias);
    const owner = row.approved_brand_code || `NEW:${key(row.approved_brand_name) || row.workbook_row}`;
    const entries = workbookAliases.get(aliasKey) || [];
    entries.push({ row, owner });
    workbookAliases.set(aliasKey, entries);
  }
  for (const entries of workbookAliases.values()) {
    if (new Set(entries.map((item) => item.owner)).size < 2) continue;
    for (const { row } of entries) issues.push(issue("ERROR", "WORKBOOK_ALIAS_CONFLICT", row, "approved_alias", row._raw.approved_alias, "The same alias is connected to different brands in this workbook"));
  }

  for (const row of rows) delete row._raw;
  for (const row of rows) row.validation_state = !row.representative_decision ? "PENDING" : issues.some((item) => item.row_number === row.workbook_row && item.severity === "ERROR") ? "INVALID" : "VALID";
  const pendingRows = rows.filter((row) => !row.representative_decision);
  const errorCount = issues.filter((item) => item.severity === "ERROR").length;
  const structuralErrorCount = issues.filter((item) => item.severity === "ERROR" && structuralCodes.has(item.code)).length;
  const validationStatus = structuralErrorCount ? "INVALID_STRUCTURE" : errorCount ? "BLOCKED" : pendingRows.length ? "INCOMPLETE" : "READY_TO_APPLY";
  const validRows = rows.filter((row) => row.validation_state === "VALID");
  const applyCandidates = validRows.filter((row) => ["CONNECT_EXISTING", "NEW_BRAND_CANDIDATE"].includes(row.representative_decision));
  const excludedRows = validRows.filter((row) => ["SOURCE_NAME_ERROR", "HOLD", "REJECT"].includes(row.representative_decision));
  const countsBySeverity = { ERROR: 0, WARNING: 0, INFO: 0, ...countBy(issues, (item) => item.severity) };
  const countsByDecision = { PENDING: 0, CONNECT_EXISTING: 0, NEW_BRAND_CANDIDATE: 0, SOURCE_NAME_ERROR: 0, HOLD: 0, REJECT: 0, ...countBy(rows, (row) => row.representative_decision || "PENDING") };
  return {
    generated_at: new Date().toISOString(),
    source_workbook: basename(workbookPath),
    validation_status: validationStatus,
    summary: {
      total_rows: rows.length,
      pending: pendingRows.length,
      errors: countsBySeverity.ERROR,
      warnings: countsBySeverity.WARNING,
      info: countsBySeverity.INFO,
      structural_errors: structuralErrorCount,
      apply_candidates: applyCandidates.length,
      excluded_rows: excludedRows.length
    },
    counts_by_decision: countsByDecision,
    counts_by_severity: countsBySeverity,
    counts_by_issue_code: countBy(issues, (item) => item.code),
    pending_rows: pendingRows,
    apply_candidates: applyCandidates,
    excluded_rows: excludedRows,
    issues,
    rows
  };
}

const markdownCell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
function issueTable(items) {
  if (!items.length) return "없음";
  return [
    "| 행 | 브랜드 코드 | 브랜드명 | 코드 | 필드 | 메시지 |",
    "| ---: | --- | --- | --- | --- | --- |",
    ...items.map((item) => `| ${item.row_number ?? "-"} | ${markdownCell(item.universe_brand_code)} | ${markdownCell(item.universe_brand_name)} | ${item.code} | ${item.field} | ${markdownCell(item.message)} |`)
  ].join("\n");
}

function rowTable(items) {
  if (!items.length) return "없음";
  return [
    "| 행 | 브랜드 코드 | 브랜드명 | decision |",
    "| ---: | --- | --- | --- |",
    ...items.map((row) => `| ${row.workbook_row} | ${markdownCell(row.universe_brand_code)} | ${markdownCell(row.universe_brand_name)} | ${row.representative_decision || "PENDING"} |`)
  ].join("\n");
}

function toMarkdown(result) {
  const errors = result.issues.filter((item) => item.severity === "ERROR");
  const warnings = result.issues.filter((item) => item.severity === "WARNING");
  return `# Brand Sourcing Decision Validation

## 최종 상태: ${result.validation_status}

${result.validation_status === "READY_TO_APPLY" ? "다음 반영 STEP 검토가 가능합니다." : "READY_TO_APPLY 상태가 아니므로 Master Data 반영을 진행할 수 없습니다."}

## 전체 요약

- 전체 행: ${result.summary.total_rows}
- PENDING: ${result.summary.pending}
- ERROR: ${result.summary.errors}
- WARNING: ${result.summary.warnings}
- INFO: ${result.summary.info}
- 적용 후보: ${result.summary.apply_candidates}
- 반영 제외: ${result.summary.excluded_rows}

## Decision 분포

${Object.entries(result.counts_by_decision).map(([name, count]) => `- ${name}: ${count}`).join("\n")}

## ERROR 목록

${issueTable(errors)}

## WARNING 목록

${issueTable(warnings)}

## PENDING 목록

${rowTable(result.pending_rows)}

## 적용 예정 후보

${rowTable(result.apply_candidates)}

## 반영 제외 대상

${rowTable(result.excluded_rows)}

## 다음 STEP 진행 가능 여부

${result.validation_status === "READY_TO_APPLY" ? "가능 — 별도 반영 STEP에서 다시 검증 후 진행" : "불가 — 대표 입력 및 오류 정리가 필요"}
`;
}

const csvCell = (value) => {
  const raw = String(value ?? "");
  const safe = typeof value !== "number" && !raw.startsWith("'") && /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
function toCsv(issues) {
  const headers = ["severity", "code", "workbook_row", "universe_brand_code", "universe_brand_name", "decision", "field", "value", "message"];
  const rows = issues.map((item) => [item.severity, item.code, item.row_number, item.universe_brand_code, item.universe_brand_name, item.decision, item.field, item.value, item.message]);
  return `\uFEFF${headers.join(",")}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

async function writeOutputs(result, outputDir) {
  await Promise.all([
    writeFile(join(outputDir, "brand-sourcing-decision-validation.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    writeFile(join(outputDir, "brand-sourcing-decision-validation.md"), toMarkdown(result), "utf8"),
    writeFile(join(outputDir, "brand-sourcing-decision-validation.csv"), toCsv(result.issues), "utf8")
  ]);
}

async function scenarioWorkbook(directory, name, mutate) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(defaults.workbook));
  const sheet = workbook.worksheets.getItem("대표 검토");
  const range = sheet.getUsedRange(true);
  const values = range.values.map((row) => [...row]);
  const headers = new Map(values[0].map((header, index) => [text(header), index]));
  mutate(values, headers);
  range.values = values;
  const path = join(directory, `${name}.xlsx`);
  await (await SpreadsheetFile.exportXlsx(workbook)).save(path);
  return path;
}

function setCell(values, headers, dataRow, header, value) {
  values[dataRow][headers.get(header)] = value;
}

async function runSelfTest() {
  const temp = await mkdtemp(join(tmpdir(), "samplas-sourcing-validator-"));
  const masterFile = await readJson(sourcePaths.master);
  const brands = (Array.isArray(masterFile) ? masterFile : masterFile.brands).filter((item) => text(item.brand_code) && text(item.brand_name));
  const [brandA, brandB] = brands;
  const results = {};
  const run = async (name, mutate, expectedStatus, expectedCode) => {
    const path = await scenarioWorkbook(temp, name, mutate);
    const result = await validateWorkbook(path);
    if (result.validation_status !== expectedStatus || (expectedCode && !result.issues.some((item) => item.code === expectedCode))) throw new Error(`${name} failed: ${result.validation_status}`);
    results[name] = { status: result.validation_status, issue: expectedCode || null, pending: result.summary.pending, errors: result.summary.errors, apply: result.summary.apply_candidates, excluded: result.summary.excluded_rows };
  };
  try {
    await run("invalid_decision", (v, h) => setCell(v, h, 1, "representative_decision", "connect_existing"), "BLOCKED", "INVALID_DECISION");
    await run("missing_required", (v, h) => setCell(v, h, 1, "representative_decision", "CONNECT_EXISTING"), "BLOCKED", "REQUIRED_FIELD_MISSING");
    await run("unknown_code", (v, h) => {
      setCell(v, h, 1, "representative_decision", "CONNECT_EXISTING");
      setCell(v, h, 1, "approved_brand_code", "UNKNOWN");
      setCell(v, h, 1, "approved_brand_name", "Unknown Brand");
      setCell(v, h, 1, "approved_alias", "Unknown Alias");
    }, "BLOCKED", "UNKNOWN_APPROVED_BRAND_CODE");
    await run("name_mismatch", (v, h) => {
      setCell(v, h, 1, "representative_decision", "CONNECT_EXISTING");
      setCell(v, h, 1, "approved_brand_code", brandA.brand_code);
      setCell(v, h, 1, "approved_brand_name", "Wrong Name");
      setCell(v, h, 1, "approved_alias", "Unique Test Alias");
    }, "BLOCKED", "APPROVED_NAME_MISMATCH");
    await run("alias_conflict", (v, h) => {
      for (const [row, brand] of [[1, brandA], [2, brandB]]) {
        setCell(v, h, row, "representative_decision", "CONNECT_EXISTING");
        setCell(v, h, row, "approved_brand_code", brand.brand_code);
        setCell(v, h, row, "approved_brand_name", brand.brand_name);
        setCell(v, h, row, "approved_alias", "Shared Test Alias");
      }
    }, "BLOCKED", "WORKBOOK_ALIAS_CONFLICT");
    await run("reject_without_note", (v, h) => setCell(v, h, 1, "representative_decision", "REJECT"), "BLOCKED", "REJECT_WITHOUT_NOTE");
    await run("all_hold", (v, h) => {
      for (let row = 1; row < v.length; row += 1) {
        setCell(v, h, row, "representative_decision", "HOLD");
        setCell(v, h, row, "representative_note", "Representative review pending");
      }
    }, "READY_TO_APPLY", null);
    if (results.all_hold.pending !== 0 || results.all_hold.errors !== 0 || results.all_hold.apply !== 0 || results.all_hold.excluded !== 31) throw new Error("all_hold counts failed");
    return results;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

if (process.argv.includes("--self-test")) {
  console.log(JSON.stringify(await runSelfTest(), null, 2));
} else {
  const workbookPath = resolve(arg("--workbook") || defaults.workbook);
  const outputDir = resolve(arg("--output-dir") || defaults.outputDir);
  const result = await validateWorkbook(workbookPath);
  await writeOutputs(result, outputDir);
  console.log(JSON.stringify({
    validation_status: result.validation_status,
    summary: result.summary,
    counts_by_decision: result.counts_by_decision,
    counts_by_severity: result.counts_by_severity,
    counts_by_issue_code: result.counts_by_issue_code
  }, null, 2));
}
