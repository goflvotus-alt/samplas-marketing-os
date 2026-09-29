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
    post.totalInteractions ?? [post.likes, post.comments, post.saves, post.shares].filter((v) => v !== null && v !== undefined).reduce((a, b) => a + Number(b), 0)
  );
  return {
    postCount: posts.length,
    views: sumMetric(posts, "views"),
    reach: sumMetric(posts, "reach"),
    likes: sumMetric(posts, "likes"),
    comments: sumMetric(posts, "comments"),
    saves: sumMetric(posts, "saves"),
    shares: sumMetric(posts, "shares"),
    engagement: engagementValues.length ? engagementValues.reduce((a, b) => a + Number(b || 0), 0) : null
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

  return {
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
    reels: currentOk ? posts.filter(isReel) : [],
    raw: currentOk ? current : null
  };
}

// ---------------------------------------------------------------------------
// Excel workbook
// ---------------------------------------------------------------------------

const NUM_FMT = "#,##0";
const PCT1_SIGNED_FMT = "+0.0\"%\";-0.0\"%\";0.0\"%\"";

const KPI_ROWS = [
  ["게시물 수 (Post Count)", "postCount"],
  ["조회수 / Views", "views"],
  ["Reach (도달)", "reach"],
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
  { header: "Permalink", key: "permalink", width: 40 }
];

function setupSheet(sheet, columns) {
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

function buildSummarySheet(workbook, model) {
  const sheet = workbook.addWorksheet("SUMMARY");
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
  return sheet;
}

function buildContentSheet(workbook, name, posts, model) {
  const sheet = workbook.addWorksheet(name);
  setupSheet(sheet, CONTENT_COLUMNS);
  if (!model.ok) {
    sheet.addRow({ date: `UNAVAILABLE — ${model.error}` });
    return sheet;
  }
  for (const post of posts) sheet.addRow(post);
  return sheet;
}

function buildAccountInsightsSheet(workbook, model) {
  const sheet = workbook.addWorksheet("ACCOUNT INSIGHTS");
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
  sheet.addRow({ label: "이번 주 Reach 합계", value: model.summary.reach ?? "—", basis: "weekly, sum of real per-post reach" });
  sheet.addRow({ label: "이번 주 Engagement 합계", value: model.summary.engagement ?? "—", basis: "weekly, sum of real per-post engagement" });
  sheet.addRow({});
  const snapshot = model.accountSnapshot;
  sheet.addRow({ label: "Followers (최신 월간 스냅샷)", value: snapshot?.followers ?? "UNAVAILABLE", basis: "MONTH snapshot, NOT weekly-precise — Instagram client only exposes account identity at month granularity" });
  sheet.addRow({ label: "Follower 증감 (최신 월간 스냅샷)", value: snapshot?.followerDelta ?? "UNAVAILABLE", basis: "MONTH snapshot, NOT weekly-precise" });
  sheet.addRow({ label: "Account Reach (최신 월간 스냅샷)", value: snapshot?.reach ?? "UNAVAILABLE", basis: "MONTH snapshot — see 위 '이번 주 Reach 합계' for the real weekly figure" });
  return sheet;
}

function buildRawSheet(workbook, model) {
  const sheet = workbook.addWorksheet("RAW");
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
  buildSummarySheet(workbook, model);
  buildContentSheet(workbook, "CONTENT", model.content, model);
  buildContentSheet(workbook, "REELS", model.reels, model);
  buildAccountInsightsSheet(workbook, model);
  buildRawSheet(workbook, model);
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
    for (const required of ["SUMMARY", "CONTENT", "REELS", "ACCOUNT INSIGHTS", "RAW"]) {
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
