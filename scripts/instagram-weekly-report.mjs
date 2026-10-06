// Instagram Weekly Report generator — same architecture as scripts/meta-ads-weekly-report.mjs
// and scripts/naver-ads-weekly-report.mjs (pluggable saveReport, same date helpers reused
// by import only). Data collection is NOT reimplemented: this module only ever consumes an
// already-fetched payload matching server.mjs's existing buildInstagramRangeData(since, until)
// shape ({ since, until, posts, account }) — the same function backing /api/instagram/range.
//
// NOTE ON GRANULARITY (read before trusting ACCOUNT INSIGHTS numbers):
//   - CONTENT/REELS sheets: real, per-post metrics for posts published in the exact
//     requested week — fully weekly-precise, taken as-is from buildInstagramRangeData's
//     already date-filtered `posts` array.
//   - The "이번 주 합계" (this week's total) rows in ACCOUNT INSIGHTS are SUMS of those
//     same real per-post metrics — also genuinely weekly.
//   - Follower count / follower change are NOT weekly-precise: the existing Instagram
//     client only exposes account-level identity (followers, follower delta) as a
//     whole-MONTH snapshot (server.mjs's buildInstagramMonthlyData), not a custom date
//     range. This module never invents a weekly follower figure — it reports the latest
//     available month snapshot and labels it explicitly as such, never blended into the
//     weekly post totals.
//   - A metric the API doesn't expose in either shape is UNAVAILABLE, never fabricated.
import { mkdir, rename, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { seoulDateKey, previousTuesdayToMondayRange, previousWeekRange, wowChange } from "./naver-ads-weekly-report.mjs";

import { analyzeInstagram } from "./instagram-weekly-analysis.mjs";
import { writeDecisionSheet, addExecutiveRead, addWowFormatting, metricPresent } from "./weekly-report-analysis.mjs";

import { instagramDashboard, instagramContentRows, instagramActions, addActionTable, styleTable } from "./weekly-report-presentation.mjs";

import { instagramOnePage } from "./weekly-onepage-report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export { seoulDateKey, previousTuesdayToMondayRange, previousWeekRange, wowChange };

function isReel(post) {
  return post?.type === "릴스";
}

function sumMetric(posts, key) {
  const values = posts.map((post) => post[key]).filter((value) => value !== null && value !== undefined);
  return values.length ? values.reduce((total, value) => total + Number(value), 0) : null;
}

const AGGREGATE_FIELDS = ["postCount", "views", "reach", "likes", "comments", "saves", "shares", "engagement"];

function aggregatePosts(posts) {
  const engagementValues = posts.map((post) =>
    post.totalInteractions ?? ([post.likes, post.comments, post.saves, post.shares].some(metricPresent) ? [post.likes, post.comments, post.saves, post.shares].filter(metricPresent).reduce((a, b) => a + b, 0) : null)
  );
  return {
    postCount: posts.length,
    views: sumMetric(posts, "views"),
    reach: sumMetric(posts, "reach"),
    likes: sumMetric(posts, "likes"),
    comments: sumMetric(posts, "comments"),
    saves: sumMetric(posts, "saves"),
    shares: sumMetric(posts, "shares"),
    engagement: engagementValues.some(metricPresent) ? engagementValues.filter(metricPresent).reduce((a, b) => a + b, 0) : null
  };
}

// ---------------------------------------------------------------------------
// Report data model
// ---------------------------------------------------------------------------

function rangeOk(data) {
  return Boolean(data) && data.ok !== false && Array.isArray(data.posts);
}

export function buildWeeklyInstagramReportModel({ current, previous, since, until, previousSince, previousUntil }) {
  const currentOk = rangeOk(current);
  const posts = currentOk ? current.posts : [];
  const previousPosts = rangeOk(previous) ? previous.posts : [];

  const summary = currentOk ? aggregatePosts(posts) : null;
  const previousSummary = rangeOk(previous) ? aggregatePosts(previousPosts) : null;
  const wow = summary && previousSummary
    ? Object.fromEntries(AGGREGATE_FIELDS.map((field) => [field, wowChange(summary[field], previousSummary[field])]))
    : null;

  const model = {
    since,
    until,
    previousSince,
    previousUntil,
    ok: currentOk,
    error: currentOk ? null : current?.error || "Instagram data unavailable",
    summary,
    previousSummary,
    wow,
    // Month-snapshot only — never claimed as weekly-precise. See module header note.
    accountSnapshot: currentOk ? (current.account || null) : null,
    content: currentOk ? posts : [],
    previousContent: rangeOk(previous) ? previous.posts : null,
    reels: currentOk ? posts.filter(isReel) : [],
    source: "instagram_graph_api",
    deliveryBasis: "Date-filtered monthly cache / Graph API collector; not a weekly account insight query",
    weeklyUniqueReach: metricPresent(current?.accountWeeklyUniqueReach) ? current.accountWeeklyUniqueReach : null,
    stories: Array.isArray(current?.stories) ? current.stories.filter(story=>{const date=String(story.date||story.timestamp||'').slice(0,10);return date>=since&&date<=until;}) : null,
    raw: currentOk ? current : null
  };
  const analysis=analyzeInstagram(model);model.analysis=analysis.rows;model.actions=analysis.actions;
  return model;
}

// ---------------------------------------------------------------------------
// Excel workbook
// ---------------------------------------------------------------------------

const NUM_FMT = "#,##0";
const PCT1_SIGNED_FMT = "+0.0\"%\";-0.0\"%\";0.0\"%\"";

const KPI_ROWS = [
  ["게시물 수 (Post Count)", "postCount"],
  ["조회수 / Views", "views"],
  ["게시물별 Reach 합계 (주간 고유 도달 아님)", "reach"],
  ["Likes", "likes"],
  ["Comments", "comments"],
  ["Saves", "saves"],
  ["Shares", "shares"],
  ["Engagement (합산)", "engagement"]
];

const CONTENT_COLUMNS = [
  { header: "Date", key: "date", width: 12 },
  { header: "Title", key: "title", width: 28 },
  { header: "Type", key: "type", width: 10 },
  { header: "Views", key: "views", width: 12, style: { numFmt: NUM_FMT } },
  { header: "Reach", key: "reach", width: 12, style: { numFmt: NUM_FMT } },
  { header: "Likes", key: "likes", width: 10, style: { numFmt: NUM_FMT } },
  { header: "Comments", key: "comments", width: 10, style: { numFmt: NUM_FMT } },
  { header: "Saves", key: "saves", width: 10, style: { numFmt: NUM_FMT } },
  { header: "Shares", key: "shares", width: 10, style: { numFmt: NUM_FMT } },
  { header: "Engagement", key: "totalInteractions", width: 14, style: { numFmt: NUM_FMT } },
  { header: "Permalink", key: "permalink", width: 40 }
];

function setupSheet(sheet, columns) {
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

function buildSummarySheet(workbook, model) {
  const sheet = workbook.addWorksheet("01_주간요약");
  setupSheet(sheet, [
    { header: "지표 (Metric)", key: "label", width: 28 },
    { header: "이번 주", key: "current", width: 16 },
    { header: "직전 주", key: "previous", width: 16 },
    { header: "WoW 증감률", key: "wow", width: 14 }
  ]);
  sheet.addRow({ label: "기간 (Period)", current: `${model.since} ~ ${model.until}`, previous: model.previousSince ? `${model.previousSince} ~ ${model.previousUntil}` : "—", wow: "" });
  sheet.addRow({});

  if (!model.ok) {
    sheet.addRow({ label: "상태", current: `UNAVAILABLE — ${model.error}`, previous: "", wow: "" });
    return sheet;
  }

  for (const [label, field] of KPI_ROWS) {
    const row = sheet.addRow({
      label,
      current: model.summary[field],
      previous: model.previousSummary ? model.previousSummary[field] : null,
      wow: model.wow ? model.wow[field] : null
    });
    row.getCell("current").numFmt = NUM_FMT;
    if (model.previousSummary) row.getCell("previous").numFmt = NUM_FMT;
    if (model.wow) row.getCell("wow").numFmt = PCT1_SIGNED_FMT;
  }
  sheet.addRow({label:"Account unique reach (week)",current:model.weeklyUniqueReach??"N/A"});
  sheet.addRow({label:"source",current:model.source});
  sheet.addRow({label:"delivery basis",current:model.deliveryBasis});
  let rowNumber=4;for(const [,metric] of KPI_ROWS)addWowFormatting(sheet,"wow",rowNumber,rowNumber++,metric);
  addExecutiveRead(sheet,model.analysis||[]);
  return sheet;
}

function buildContentSheet(workbook, name, posts, model) {
  const sheet = workbook.addWorksheet(name);
  setupSheet(sheet, [...CONTENT_COLUMNS,
    ...['saveRate','shareRate','engagementRate'].map(key=>({header:({saveRate:'Save Rate',shareRate:'Share Rate',engagementRate:'Engagement Rate'})[key],key,width:16,style:{numFmt:'0.0%'}})),
    {header:'performance_signal',key:'performance_signal',width:38},{header:'next_action',key:'next_action',width:40}]);
  if (!model.ok) {
    sheet.addRow({ date: `UNAVAILABLE — ${model.error}` });
    return sheet;
  }
  for (const post of instagramContentRows({...model,content:posts})) {
    const row=sheet.addRow(post);
    if(post.performance_signal.includes('WINNER'))row.getCell('performance_signal').font={bold:true,color:{argb:'FF216A3E'}};
    else if(post.performance_signal==='LOW PERFORMER')row.getCell('performance_signal').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2E8'}};
  }
  styleTable(sheet);
  return sheet;
}

function buildAccountInsightsSheet(workbook, model) {
  const sheet = workbook.addWorksheet("ACCOUNT INSIGHTS");
  sheet.state="hidden";
  setupSheet(sheet, [
    { header: "지표 (Metric)", key: "label", width: 32 },
    { header: "값", key: "value", width: 20 },
    { header: "기준 (Basis)", key: "basis", width: 40 }
  ]);
  if (!model.ok) {
    sheet.addRow({ label: `UNAVAILABLE — ${model.error}` });
    return sheet;
  }
  sheet.addRow({ label: "이번 주 게시물 수", value: model.summary.postCount, basis: `${model.since} ~ ${model.until} (weekly, precise)` });
  sheet.addRow({ label: "이번 주 조회수 합계", value: model.summary.views ?? "—", basis: "weekly, sum of real per-post views" });
  sheet.addRow({ label: "게시물별 Reach 합계", value: model.summary.reach ?? "—", basis: "weekly sum of per-post reach; NOT account-level weekly unique reach" });
  sheet.addRow({ label: "이번 주 Engagement 합계", value: model.summary.engagement ?? "—", basis: "weekly, sum of real per-post engagement" });
  sheet.addRow({});
  const snapshot = model.accountSnapshot;
  sheet.addRow({ label: "Followers (최신 월간 스냅샷)", value: snapshot?.followers ?? "UNAVAILABLE", basis: "MONTH snapshot, NOT weekly-precise — Instagram client only exposes account identity at month granularity" });
  sheet.addRow({ label: "Follower 증감 (최신 월간 스냅샷)", value: snapshot?.followerDelta ?? "UNAVAILABLE", basis: "MONTH snapshot, NOT weekly-precise" });
  sheet.addRow({ label: "Account Reach (최신 월간 스냅샷)", value: snapshot?.reach ?? "UNAVAILABLE", basis: "MONTH snapshot; 게시물별 Reach 합계 is non-unique and not account weekly reach" });
  return sheet;
}

function buildRawSheet(workbook, model) {
  const sheet = workbook.addWorksheet("RAW");
  sheet.state="hidden";
  sheet.addRow(["source", "instagram_graph_api"]);
  sheet.addRow([]);
  if (!model.ok) {
    sheet.addRow([`UNAVAILABLE — ${model.error}`]);
    return sheet;
  }
  const columns = ["id", "date", "title", "type", "tag", "reach", "views", "likes", "comments", "saves", "shares", "totalInteractions", "permalink"];
  sheet.addRow(columns);
  sheet.getRow(sheet.rowCount).font = { bold: true };
  for (const post of model.raw.posts) sheet.addRow(columns.map((key) => post[key] ?? null));
  return sheet;
}

export async function buildWeeklyInstagramReportWorkbook(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SAMPLAS Marketing OS";
  workbook.created = new Date();
  instagramOnePage(workbook, model);
  return workbook;
}

// ---------------------------------------------------------------------------
// Output path + atomic, non-clobbering local save
// ---------------------------------------------------------------------------

export function resolveInstagramWeeklyReportOutputDir(env = process.env) {
  const workDir = resolve(env.WORK_DIR || join(root, "work"));
  return resolve(env.INSTAGRAM_WEEKLY_REPORT_DIR || join(workDir, "reports", "instagram-weekly"));
}

export function instagramWeeklyReportFileName(since, until) {
  return `INSTAGRAM_WEEKLY_${since}_${until}.xlsx`;
}

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

export async function writeInstagramWeeklyReportFile(workbook, { since, until, outputDir }) {
  await mkdir(outputDir, { recursive: true });
  const fileName = instagramWeeklyReportFileName(since, until);
  const finalPath = await resolveVersionedOutputPath(outputDir, fileName);
  const tempPath = join(outputDir, `.instagram-weekly-${process.pid}-${randomUUID()}.tmp.xlsx`);
  await workbook.xlsx.writeFile(tempPath);
  try {
    const validation = new ExcelJS.Workbook();
    await validation.xlsx.readFile(tempPath);
    const sheetNames = validation.worksheets.map((sheet) => sheet.name);
    for (const required of ["REPORT"]) {
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
// Orchestrator
// ---------------------------------------------------------------------------

export async function generateWeeklyInstagramReport({ referenceDateKey, fetchRange, outputDir, env = process.env, saveReport } = {}) {
  if (typeof fetchRange !== "function") throw new Error("generateWeeklyInstagramReport requires fetchRange(since, until)");
  const { since, until } = previousTuesdayToMondayRange(referenceDateKey);
  const { since: previousSince, until: previousUntil } = previousWeekRange({ since, until });

  const [current, previous] = await Promise.all([
    fetchRange(since, until),
    fetchRange(previousSince, previousUntil)
  ]);

  const model = buildWeeklyInstagramReportModel({ current, previous, since, until, previousSince, previousUntil });
  if (!model.ok) {
    return { ok: false, since, until, error: model.error, filePath: null };
  }

  const workbook = await buildWeeklyInstagramReportWorkbook(model);

  if (saveReport) {
    const saved = await saveReport(workbook, { since, until, env });
    return { ok: true, since, until, ...saved };
  }

  const resolvedOutputDir = outputDir || resolveInstagramWeeklyReportOutputDir(env);
  const filePath = await writeInstagramWeeklyReportFile(workbook, { since, until, outputDir: resolvedOutputDir });
  return { ok: true, since, until, filePath };
}

// ---------------------------------------------------------------------------
// Standalone CLI: node scripts/instagram-weekly-report.mjs [YYYY-MM-DD]
// ---------------------------------------------------------------------------

async function createServerFetcher() {
  const serverModule = await import("../server.mjs");
  if (typeof serverModule.buildInstagramRangeDataForWeeklyReport !== "function") {
    throw new Error("server.mjs does not export buildInstagramRangeDataForWeeklyReport — CLI cannot run standalone.");
  }
  return serverModule.buildInstagramRangeDataForWeeklyReport;
}

async function main() {
  const referenceDateKey = process.argv[2] || undefined;
  const fetchRange = await createServerFetcher();
  const result = await generateWeeklyInstagramReport({ referenceDateKey, fetchRange });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
