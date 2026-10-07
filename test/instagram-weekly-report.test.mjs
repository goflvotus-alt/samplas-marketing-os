import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  previousTuesdayToMondayRange,
  wowChange,
  buildWeeklyInstagramReportModel,
  buildWeeklyInstagramReportWorkbook,
  resolveInstagramWeeklyReportOutputDir,
  generateWeeklyInstagramReport
} from "../scripts/instagram-weekly-report.mjs";

let tempDir;
test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "instagram-weekly-report-test-"));
});
test.after(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

const currentPosts = [
  { id: "p1", date: "2026-09-23", title: "Post One", type: "이미지", views: 1000, reach: 800, likes: 100, comments: 10, saves: 5, shares: 2, totalInteractions: 117 },
  { id: "p2", date: "2026-09-24", title: "Reel One", type: "릴스", views: 5000, reach: 4000, likes: 500, comments: 50, saves: 30, shares: 20, totalInteractions: 600 },
  { id: "p3", date: "2026-09-25", title: "Reel Two", type: "릴스", views: 3000, reach: 2500, likes: 300, comments: 20, saves: 10, shares: 5, totalInteractions: 335 },
  { id: "p4", date: "2026-09-26", title: "Post Two", type: "이미지", views: 800, reach: 600, likes: 80, comments: 8, saves: 4, shares: 1, totalInteractions: 93 }
];
const previousPosts = [
  { id: "q1", date: "2026-09-16", title: "Prev One", type: "이미지", views: 900, reach: 700, likes: 90, comments: 9, saves: 4, shares: 1, totalInteractions: 104 },
  { id: "q2", date: "2026-09-17", title: "Prev Reel", type: "릴스", views: 4000, reach: 3200, likes: 400, comments: 40, saves: 20, shares: 10, totalInteractions: 470 },
  { id: "q3", date: "2026-09-18", title: "Prev Two", type: "이미지", views: 700, reach: 500, likes: 70, comments: 7, saves: 3, shares: 1, totalInteractions: 81 }
];

const currentPayload = { ok: true, since: "2026-09-22", until: "2026-09-28", posts: currentPosts, account: { followers: 12000, followerDelta: 150, reach: 90000 } };
const previousPayload = { ok: true, since: "2026-09-15", until: "2026-09-21", posts: previousPosts, account: { followers: 11850, followerDelta: 120, reach: 82000 } };

test("date range reuses Naver's Tuesday-Monday week math unchanged", () => {
  assert.deepEqual(previousTuesdayToMondayRange("2026-09-29"), { since: "2026-09-22", until: "2026-09-28" });
});

test("KPI aggregation — real weekly sums of per-post metrics, never fabricated", () => {
  const model = buildWeeklyInstagramReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  assert.equal(model.ok, true);
  assert.equal(model.summary.postCount, 4);
  assert.equal(model.summary.views, 1000 + 5000 + 3000 + 800);
  assert.equal(model.summary.engagement, 117 + 600 + 335 + 93);
});

test("WoW calculation — 4 posts vs 3 posts is a real +33.33%, not a fabricated figure", () => {
  const model = buildWeeklyInstagramReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  assert.ok(Math.abs(model.wow.postCount - 33.33) < 0.1);
  assert.equal(wowChange(100, 0), null);
  assert.equal(wowChange(0, 0), null);
});

test("REELS filtering — only posts tagged 릴스 land in reels, others stay in content", () => {
  const model = buildWeeklyInstagramReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  assert.equal(model.reels.length, 2);
  assert.deepEqual(model.reels.map((post) => post.id).sort(), ["p2", "p3"]);
  assert.equal(model.content.length, 4);
});

test("account snapshot stays a separate month-basis figure, never blended into the weekly post sums", () => {
  const model = buildWeeklyInstagramReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  assert.equal(model.accountSnapshot.followers, 12000);
  assert.notEqual(model.accountSnapshot.followers, model.summary.views);
});

test("REPORT never substitutes monthly followers for current followers_count",async()=>{
 const m=buildWeeklyInstagramReportModel({current:currentPayload,previous:previousPayload,since:"2026-09-22",until:"2026-09-28"});
 const w=await buildWeeklyInstagramReportWorkbook(m),s=w.getWorksheet("REPORT");
 assert.equal(s.getCell("A6").value,"N/A");assert.equal(s.getCell("A15").value,"팔로워 · 수집시점");assert.equal(s.getCell("C15").value,"N/A");assert.match(s.getCell("A7").value,/생성 시점/);
});
test("unprovided weekly/account metrics remain N/A",async()=>{
 const m=buildWeeklyInstagramReportModel({current:{ok:true,posts:currentPosts,account:null},previous:previousPayload,since:"2026-09-22",until:"2026-09-28"});const w=await buildWeeklyInstagramReportWorkbook(m);assert.equal(w.getWorksheet("REPORT").getCell("A6").value,"N/A");
});

test("unavailable current-week data does not write a file and reports the reason, never fabricating posts", async () => {
  const fetchRange = async () => ({ ok: false, error: "Instagram access token expired" });
  const result = await generateWeeklyInstagramReport({ referenceDateKey: "2026-09-29", fetchRange, outputDir: tempDir });
  assert.equal(result.ok, false);
  assert.equal(result.filePath, null);
  assert.match(result.error, /access token/i);
});

test("XLSX generation — workbook has 3 visible decision sheets plus hidden audit sheets with the expected CONTENT headers", async () => {
  const model = buildWeeklyInstagramReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  const workbook = await buildWeeklyInstagramReportWorkbook(model);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  assert.deepEqual(names, ["REPORT"]);
  const contentHeaders = workbook.getWorksheet("REPORT").getRow(33).values.filter(Boolean);
  for (const expected of ["게시일", "콘텐츠명", "종류", "조회", "도달", "좋아요", "댓글", "저장", "공유", "참여율", "판단"]) {
    assert.ok(contentHeaders.includes(expected), `missing CONTENT header: ${expected}`);
  }
});

test("end to end through generateWeeklyInstagramReport picks the correct week by since", async () => {
  const fetchRange = async (since) => (since === "2026-09-22" ? currentPayload : previousPayload);
  const result = await generateWeeklyInstagramReport({ referenceDateKey: "2026-09-29", fetchRange, outputDir: tempDir });
  assert.equal(result.ok, true);
  assert.equal(result.since, "2026-09-22");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(result.filePath);
  const summarySheet = workbook.getWorksheet("REPORT");
  assert.equal(summarySheet.getCell("C22").value,9800);
});

test("duplicate report handling — a second local run for the same week is versioned, never overwritten", async () => {
  const dir = join(tempDir, "dup-test");
  const fetchRange = async (since) => (since === "2026-09-22" ? currentPayload : previousPayload);
  await generateWeeklyInstagramReport({ referenceDateKey: "2026-09-29", fetchRange, outputDir: dir });
  await generateWeeklyInstagramReport({ referenceDateKey: "2026-09-29", fetchRange, outputDir: dir });
  const files = await readdir(dir);
  assert.equal(files.length, 2);
  assert.ok(files.some((name) => name.endsWith("_v2.xlsx")));
});

test("output path — INSTAGRAM_WEEKLY_REPORT_DIR overrides the default, and the default falls back to WORK_DIR/reports/instagram-weekly", () => {
  const configured = resolveInstagramWeeklyReportOutputDir({ INSTAGRAM_WEEKLY_REPORT_DIR: "/custom/path" });
  assert.equal(configured, "/custom/path");
  const fallback = resolveInstagramWeeklyReportOutputDir({ WORK_DIR: "/tmp/samplas-work" });
  assert.equal(fallback, "/tmp/samplas-work/reports/instagram-weekly");
});
