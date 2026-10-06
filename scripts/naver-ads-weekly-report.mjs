// Naver Search Ads Weekly Report generator.
//
// Data collection is NOT reimplemented here: this module only ever consumes an
// already-fetched Naver Ads Phase 1 performance payload (the same shape returned by
// intelligence-service.mjs's handleNaverAdsReadOnlyRoute("performance", ...), which is
// itself GET-only and allowlisted to /ncc/campaigns + /stats). The actual HTTP fetch is
// injected by the caller (see fetchNaverAdsPerformanceForReport in server.mjs, and
// createIntelligenceServiceFetcher() below for the standalone-CLI case) so this module
// stays a small, independently-testable report builder — never a second Naver client.
//
// Metric availability (Phase 1 only fetches campaign-level /ncc/campaigns + /stats):
//   AVAILABLE:  spend, impressions, clicks, conversions, conversionValue, ctr, cpc, cpa, roas
//   UNAVAILABLE: ad group level data, keyword level data (Phase 1 has no /ncc/adgroups or
//                /ncc/keywords call) — the ADGROUPS/KEYWORDS sheets say so explicitly rather
//                than fabricating rows.
import { mkdir, rename, writeFile, unlink, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Date math (Asia/Seoul calendar only, no external deps — same idiom already used
// throughout this codebase, e.g. server.mjs's todayKey()/campaignComparisonAddDays).
// ---------------------------------------------------------------------------

export function seoulDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 1=Mon..7=Sun (date-only, so this is never affected by time-of-day/timezone drift —
// the caller is expected to have already reduced a KST instant to a KST calendar date
// via seoulDateKey()).
function isoWeekdayOfDateKey(dateKey) {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

// Finds the most recently fully-completed Tuesday-through-Monday week as of
// referenceDateKey. On the intended trigger (Tuesday 10:00 KST), "yesterday" is exactly
// last Monday, so this reduces to since = referenceDate-7, until = referenceDate-1 — but
// the general form works for any reference date, which keeps it testable without having
// to fake being "on a Tuesday".
export function previousTuesdayToMondayRange(referenceDateKey = seoulDateKey()) {
  const yesterday = addDaysToDateKey(referenceDateKey, -1);
  const daysBackToMonday = isoWeekdayOfDateKey(yesterday) - 1; // Monday=1 -> 0 back
  const until = addDaysToDateKey(yesterday, -daysBackToMonday);
  const since = addDaysToDateKey(until, -6);
  return { since, until };
}

export function previousMondayToSundayRange(referenceDateKey = seoulDateKey()) {
  const yesterday = addDaysToDateKey(referenceDateKey, -1);
  const daysBackToSunday = isoWeekdayOfDateKey(yesterday) % 7;
  const until = addDaysToDateKey(yesterday, -daysBackToSunday);
  const since = addDaysToDateKey(until, -6);
  return { since, until };
}

export function previousWeekRange({ since, until }) {
  return { since: addDaysToDateKey(since, -7), until: addDaysToDateKey(until, -7) };
}

// ---------------------------------------------------------------------------
// Scheduling predicate — a pure function of (now, lastRunSinceKey) so "does this mean
// Tuesday 10:00 KST" is directly unit-testable without waiting for a real Tuesday.
// ---------------------------------------------------------------------------

export function isWeeklyNaverReportDue(now = new Date(), lastRunSinceKey = null) {
  const dateKey = seoulDateKey(now);
  if (isoWeekdayOfDateKey(dateKey) !== 2) return false; // not Tuesday
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(now)
  );
  if (hour !== 10) return false; // only inside the 10:00:00-10:59:59 KST window
  const { since } = previousTuesdayToMondayRange(dateKey);
  return since !== lastRunSinceKey; // idempotent: already generated this week's report
}

// ---------------------------------------------------------------------------
// Derived metrics not provided by Phase 1 (week-over-week % change). Per-metric ratios
// (ctr/cpc/cpa/roas) are NOT recomputed here — Phase 1's own naverAdsRatios() already
// returns them on both `summary` and each campaign row, and this module always uses
// those values as-is rather than re-deriving them a second time.
// ---------------------------------------------------------------------------

export function wowChange(current, previous) {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined || previous === 0) return null;
  const value = ((current - previous) / previous) * 100;
  return Number.isFinite(value) ? value : null;
}

import { analyzeNaver, writeDecisionSheet, addExecutiveRead, addWowFormatting, addPerformanceFormatting } from "./weekly-report-analysis.mjs";

const SUMMARY_FIELDS = ["spend", "impressions", "clicks", "ctr", "cpc", "conversions", "conversionValue", "conversionRate", "cpa", "roas"];

// ---------------------------------------------------------------------------
// Report data model: combines the current-week and previous-week Phase 1 performance
// payloads (as returned by handleNaverAdsReadOnlyRoute("performance", ...)) into the
// shape the Excel builder below consumes. Never fabricates a metric Phase 1 doesn't
// return — a missing/unavailable current-week fetch produces ok:false with the reason,
// not zeros.
// ---------------------------------------------------------------------------

export function buildWeeklyReportModel({ current, previous, since, until, previousSince, previousUntil }) {
  const currentOk = current?.ok === true;
  const previousOk = previous?.ok === true;

  const summary = currentOk
    ? Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, current.summary?.[field] ?? null]))
    : null;
  const previousSummary = previousOk
    ? Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, previous.summary?.[field] ?? null]))
    : null;

  const wow = summary && previousSummary
    ? Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, wowChange(summary[field], previousSummary[field])]))
    : null;

  const previousCampaignsById = new Map((previous?.campaigns || []).map((row) => [row.campaignId, row]));
  const campaigns = currentOk
    ? current.campaigns.map((row) => ({
        ...row,
        wowSpend: wowChange(row.spend, previousCampaignsById.get(row.campaignId)?.spend ?? null),
        wowConversionValue: wowChange(row.conversionValue, previousCampaignsById.get(row.campaignId)?.conversionValue ?? null)
      }))
    : [];

  const model = {
    since,
    until,
    previousSince,
    previousUntil,
    ok: currentOk,
    error: currentOk ? null : current?.error || "Naver Search Ads data unavailable",
    summary,
    previousSummary,
    wow,
    campaigns,
    // Ad group / keyword level data requires /ncc/adgroups and /ncc/keywords, which the
    // reused Phase 1 client does not call. Reported explicitly rather than guessed at.
    adgroups: { available: false, reason: "Naver Ads Phase 1 client only fetches campaign-level data (/ncc/campaigns + /stats); ad group level (/ncc/adgroups) is not implemented." },
    keywords: { available: false, reason: "Naver Ads Phase 1 client only fetches campaign-level data (/ncc/campaigns + /stats); keyword level (/ncc/keywords) is not implemented." },
    raw: currentOk ? current : null
  };
  model.analysis=analyzeNaver(model,current,previous);
  return model;
}

// ---------------------------------------------------------------------------
// Excel workbook
// ---------------------------------------------------------------------------

const NUM_FMT = "#,##0";
const WON_FMT = "#,##0\"원\"";
const PCT1_FMT = "0.0%";
const PCT1_SIGNED_FMT = "+0.0\"%\";-0.0\"%\";0.0\"%\"";
const MULTIPLE_FMT = "0.00\"x\"";

const KPI_ROWS = [
  ["Spend (광고비)", "spend", WON_FMT],
  ["Impressions (노출)", "impressions", NUM_FMT],
  ["Clicks (클릭)", "clicks", NUM_FMT],
  ["CTR", "ctr", PCT1_FMT],
  ["CPC", "cpc", WON_FMT],
  ["Conversions (전환)", "conversions", NUM_FMT],
  ["Conversion Value (전환매출)", "conversionValue", WON_FMT],
  ["CVR", "conversionRate", PCT1_FMT],
  ["CPA", "cpa", WON_FMT],
  ["ROAS", "roas", MULTIPLE_FMT]
];

const CAMPAIGN_COLUMNS = [
  { header: "Campaign ID", key: "campaignId", width: 16 },
  { header: "Campaign Name", key: "campaignName", width: 28 },
  { header: "Status", key: "status", width: 12 },
  { header: "Spend", key: "spend", width: 14, style: { numFmt: WON_FMT } },
  { header: "Impressions", key: "impressions", width: 14, style: { numFmt: NUM_FMT } },
  { header: "Clicks", key: "clicks", width: 12, style: { numFmt: NUM_FMT } },
  { header: "CTR", key: "ctr", width: 10, style: { numFmt: PCT1_FMT } },
  { header: "CPC", key: "cpc", width: 12, style: { numFmt: WON_FMT } },
  { header: "Conversions", key: "conversions", width: 13, style: { numFmt: NUM_FMT } },
  { header: "Conversion Value", key: "conversionValue", width: 16, style: { numFmt: WON_FMT } },
  { header: "CVR", key: "conversionRate", width: 12, style: { numFmt: PCT1_FMT } },
  { header: "CPA", key: "cpa", width: 12, style: { numFmt: WON_FMT } },
  { header: "ROAS", key: "roas", width: 10, style: { numFmt: MULTIPLE_FMT } },
  { header: "WoW Spend", key: "wowSpend", width: 12, style: { numFmt: PCT1_SIGNED_FMT } },
  { header: "WoW Conv. Value", key: "wowConversionValue", width: 16, style: { numFmt: PCT1_SIGNED_FMT } }
];

function setupSheet(sheet, columns) {
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  if (sheet.rowCount >= 1) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
}

function buildSummarySheet(workbook, model) {
  const sheet = workbook.addWorksheet("SUMMARY");
  setupSheet(sheet, [
    { header: "지표 (Metric)", key: "label", width: 26 },
    { header: "이번 주", key: "current", width: 18 },
    { header: "직전 주", key: "previous", width: 18 },
    { header: "WoW 증감률", key: "wow", width: 14 }
  ]);

  sheet.addRow({ label: "기간 (Period)", current: `${model.since} ~ ${model.until}`, previous: model.previousSince ? `${model.previousSince} ~ ${model.previousUntil}` : "—", wow: "" });
  sheet.addRow({});

  if (!model.ok) {
    sheet.addRow({ label: "상태", current: `UNAVAILABLE — ${model.error}`, previous: "", wow: "" });
    return sheet;
  }

  for (const [label, field, numFmt] of KPI_ROWS) {
    const percentPointField = field === "ctr" || field === "conversionRate";
    const currentValue = percentPointField && model.summary[field] !== null
      ? model.summary[field] / 100
      : model.summary[field];
    const previousValue = percentPointField && model.previousSummary?.[field] !== null && model.previousSummary?.[field] !== undefined
      ? model.previousSummary[field] / 100
      : model.previousSummary?.[field] ?? null;
    const row = sheet.addRow({
      label,
      current: currentValue,
      previous: previousValue,
      wow: model.wow ? model.wow[field] : null
    });
    row.getCell("current").numFmt = numFmt;
    if (model.previousSummary) row.getCell("previous").numFmt = numFmt;
    if (model.wow) row.getCell("wow").numFmt = PCT1_SIGNED_FMT;
  }

  let metricRow=4;for(const [,field] of KPI_ROWS)addWowFormatting(sheet,"wow",metricRow,metricRow++,field);
  addExecutiveRead(sheet,model.analysis||[]);

  if (model.campaigns.length) {
    sheet.addRow({});
    sheet.addRow({ label: "주요 변화 (WoW Spend 기준, Top/Bottom 3)" });
    const ranked = model.campaigns
      .filter((row) => row.wowSpend !== null)
      .sort((a, b) => b.wowSpend - a.wowSpend);
    for (const row of ranked.slice(0, 3)) {
      const r = sheet.addRow({ label: `▲ ${row.campaignName}`, current: row.spend, wow: row.wowSpend });
      r.getCell("current").numFmt = WON_FMT;
      r.getCell("wow").numFmt = PCT1_SIGNED_FMT;
    }
    for (const row of ranked.slice(-3).reverse()) {
      const r = sheet.addRow({ label: `▼ ${row.campaignName}`, current: row.spend, wow: row.wowSpend });
      r.getCell("current").numFmt = WON_FMT;
      r.getCell("wow").numFmt = PCT1_SIGNED_FMT;
    }
  }
  return sheet;
}

function buildCampaignsSheet(workbook, model) {
  const sheet = workbook.addWorksheet("CAMPAIGNS");
  setupSheet(sheet, CAMPAIGN_COLUMNS);
  if (!model.ok) {
    sheet.addRow({ campaignId: `UNAVAILABLE — ${model.error}` });
    return sheet;
  }
  for (const row of model.campaigns) {
    sheet.addRow({
      ...row,
      ctr: row.ctr === null || row.ctr === undefined ? null : row.ctr / 100,
      conversionRate: row.conversionRate === null || row.conversionRate === undefined ? null : row.conversionRate / 100
    });
  }
  addPerformanceFormatting(sheet,{spend:"spend",outcome:"conversions",roas:"roas"});
  addWowFormatting(sheet,"wowConversionValue",2,sheet.rowCount,"conversionValue");
  return sheet;
}

function buildUnavailableEntitySheet(workbook, name, columns, unavailable) {
  const sheet = workbook.addWorksheet(name);
  setupSheet(sheet, columns);
  sheet.addRow({ [columns[0].key]: `UNAVAILABLE — ${unavailable.reason}` });
  return sheet;
}

function buildRawSheet(workbook, model) {
  const sheet = workbook.addWorksheet("RAW");
  sheet.addRow(["source", model.raw?.metadata?.source ?? "UNAVAILABLE"]);
  sheet.addRow(["timezone", model.raw?.metadata?.timezone ?? "UNAVAILABLE"]);
  sheet.addRow(["roasUnit", model.raw?.metadata?.roasUnit ?? "UNAVAILABLE"]);
  sheet.addRow(["conversionAttribution", model.raw?.metadata?.conversionAttribution ?? "UNAVAILABLE"]);
  sheet.addRow([]);
  if (!model.ok) {
    sheet.addRow([`UNAVAILABLE — ${model.error}`]);
    return sheet;
  }
  const columns = ["campaignId", "campaignName", "campaignType", "status", "deliveryMethod", "impressions", "clicks", "spend", "conversions", "conversionValue", "ctr", "cpc", "conversionRate", "cpa", "roas"];
  sheet.addRow(columns);
  sheet.getRow(sheet.rowCount).font = { bold: true };
  for (const row of model.raw.campaigns) sheet.addRow(columns.map((key) => row[key] ?? null));
  return sheet;
}

export async function buildWeeklyReportWorkbook(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SAMPLAS Marketing OS";
  workbook.created = new Date();
  buildSummarySheet(workbook, model);
  buildCampaignsSheet(workbook, model);
  buildUnavailableEntitySheet(workbook, "ADGROUPS", [
    { header: "Adgroup ID", key: "adgroupId", width: 30 },
    { header: "Campaign", key: "campaignName", width: 20 },
    { header: "Spend", key: "spend", width: 14 },
    { header: "Impressions", key: "impressions", width: 14 },
    { header: "Clicks", key: "clicks", width: 12 },
    { header: "CTR", key: "ctr", width: 10 },
    { header: "CPC", key: "cpc", width: 12 },
    { header: "Conversions", key: "conversions", width: 13 },
    { header: "Conversion Value", key: "conversionValue", width: 16 },
    { header: "CPA", key: "cpa", width: 12 },
    { header: "ROAS", key: "roas", width: 10 },
    { header: "WoW change", key: "wow", width: 12 }
  ], model.adgroups);
  buildUnavailableEntitySheet(workbook, "KEYWORDS", [
    { header: "Keyword", key: "keyword", width: 30 },
    { header: "Campaign", key: "campaignName", width: 20 },
    { header: "Adgroup", key: "adgroupName", width: 20 },
    { header: "Impressions", key: "impressions", width: 14 },
    { header: "Clicks", key: "clicks", width: 12 },
    { header: "CTR", key: "ctr", width: 10 },
    { header: "CPC", key: "cpc", width: 12 },
    { header: "Spend", key: "spend", width: 14 },
    { header: "Conversions", key: "conversions", width: 13 },
    { header: "Conversion Value", key: "conversionValue", width: 16 },
    { header: "CPA", key: "cpa", width: 12 },
    { header: "ROAS", key: "roas", width: 10 }
  ], model.keywords);
  writeDecisionSheet(workbook,"AI_ANALYSIS",model.analysis||[]);
  buildRawSheet(workbook, model);
  return workbook;
}

// ---------------------------------------------------------------------------
// Output path + atomic, non-clobbering save
// ---------------------------------------------------------------------------

export function resolveWeeklyReportOutputDir(env = process.env) {
  const workDir = resolve(env.WORK_DIR || join(root, "work"));
  return resolve(env.NAVER_ADS_WEEKLY_REPORT_DIR || join(workDir, "reports", "naver-ads-weekly"));
}

export function weeklyReportFileName(since, until) {
  return `NAVER_ADS_WEEKLY_${since}_${until}.xlsx`;
}

// Never silently overwrites an existing report for the same week: appends _v2, _v3, ...
// to the first name that doesn't already exist, so a re-run for the same week is always
// visible as a new, clearly-numbered file rather than replacing prior output.
export async function resolveVersionedOutputPath(outputDir, fileName) {
  const base = fileName.replace(/\.xlsx$/i, "");
  let candidate = join(outputDir, fileName);
  let version = 2;
  while (existsSync(candidate)) {
    candidate = join(outputDir, `${base}_v${version}.xlsx`);
    version += 1;
  }
  return candidate;
}

// Real save entry point: builds the versioned path itself (since it needs since/until,
// not just a bare filename), writes to a temp file, re-opens it to confirm the workbook
// is actually valid, then atomically renames it into place.
export async function writeWeeklyReportFile(workbook, { since, until, outputDir }) {
  await mkdir(outputDir, { recursive: true });
  const fileName = weeklyReportFileName(since, until);
  const finalPath = await resolveVersionedOutputPath(outputDir, fileName);
  const tempPath = join(outputDir, `.naver-ads-weekly-${process.pid}-${randomUUID()}.tmp.xlsx`);
  await workbook.xlsx.writeFile(tempPath);
  try {
    const validation = new ExcelJS.Workbook();
    await validation.xlsx.readFile(tempPath);
    const sheetNames = validation.worksheets.map((sheet) => sheet.name);
    for (const required of ["SUMMARY", "CAMPAIGNS", "ADGROUPS", "KEYWORDS", "AI_ANALYSIS", "RAW"]) {
      if (!sheetNames.includes(required)) throw new Error(`Generated workbook is missing sheet: ${required}`);
    }
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
  await rename(tempPath, finalPath);
  return finalPath;
}

// ---------------------------------------------------------------------------
// Orchestrator. `fetchPerformance(since, until)` is injected so this module never talks
// to Naver directly — the caller supplies the exact same Phase 1 route already used
// everywhere else (server.mjs's in-process scheduler passes a thin wrapper around the
// already-imported handleNaverAdsReadOnlyRoute; the CLI/tests pass their own).
// ---------------------------------------------------------------------------

// `saveReport(workbook, { since, until, env })` is optional and pluggable so Production
// (Dropbox upload — see scripts/dropbox-report-uploader.mjs) and Local (filesystem) can
// share this exact same fetch/model/workbook pipeline instead of each having their own
// copy of the report-building logic. Omitting it preserves the original local-filesystem
// behavior unchanged (this is what the CLI and all existing tests still do).
export async function generateWeeklyNaverAdsReport({ referenceDateKey, fetchPerformance, outputDir, env = process.env, saveReport } = {}) {
  if (typeof fetchPerformance !== "function") throw new Error("generateWeeklyNaverAdsReport requires fetchPerformance(since, until)");
  const { since, until } = previousTuesdayToMondayRange(referenceDateKey);
  const { since: previousSince, until: previousUntil } = previousWeekRange({ since, until });

  const [current, previous] = await Promise.all([
    fetchPerformance(since, until),
    fetchPerformance(previousSince, previousUntil)
  ]);

  const model = buildWeeklyReportModel({ current, previous, since, until, previousSince, previousUntil });
  if (!model.ok) {
    return { ok: false, since, until, error: model.error, filePath: null };
  }

  const workbook = await buildWeeklyReportWorkbook(model);

  if (saveReport) {
    // Any throw here (upload failure, auth failure, network failure) intentionally
    // propagates uncaught — the caller (server.mjs's scheduler) must NOT treat this
    // week as complete unless saveReport actually resolves successfully.
    const saved = await saveReport(workbook, { since, until, env });
    return { ok: true, since, until, ...saved };
  }

  const resolvedOutputDir = outputDir || resolveWeeklyReportOutputDir(env);
  const filePath = await writeWeeklyReportFile(workbook, { since, until, outputDir: resolvedOutputDir });
  return { ok: true, since, until, filePath };
}

// ---------------------------------------------------------------------------
// Standalone CLI entry: node scripts/naver-ads-weekly-report.mjs [YYYY-MM-DD]
// Only this path pays the cost of importing the full intelligence-service.mjs module
// (bootstraps product registry/commercial policy/etc. as a side effect of that import) —
// exactly the same tradeoff scripts/refresh-monthly-sales.mjs already makes with
// `await import("../server.mjs")` for its own CLI entry.
// ---------------------------------------------------------------------------

async function createIntelligenceServiceFetcher() {
  const { handleNaverAdsReadOnlyRoute, capturingResponse } = await import("../intelligence-service.mjs");
  return async (since, until) => {
    const url = new URL(`http://internal/api/intelligence/naver/ads/performance?since=${since}&until=${until}`);
    const capture = capturingResponse();
    await handleNaverAdsReadOnlyRoute("performance", url, capture);
    return capture.body;
  };
}

// Same minimal .env-file loader server.mjs/intelligence-service.mjs already use (process.env
// wins over the file; the file only fills in what process.env doesn't already have) — needed
// here so a .env-only NAVER_ADS_WEEKLY_REPORT_DIR (no shell export) is honored by manual CLI
// runs exactly the way it already is inside the running server process.
async function loadEnvFile() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return { ...process.env };
  const text = await readFile(envPath, "utf8");
  const parsed = { ...process.env };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key]) continue;
    parsed[key] = value;
  }
  return parsed;
}

async function main() {
  const referenceDateKey = process.argv[2] || undefined;
  const [fetchPerformance, env] = await Promise.all([createIntelligenceServiceFetcher(), loadEnvFile()]);
  const result = await generateWeeklyNaverAdsReport({ referenceDateKey, fetchPerformance, env });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
