import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  previousMondayToSundayRange,
  wowChange,
  buildWeeklyMetaReportModel,
  buildWeeklyMetaReportWorkbook,
  resolveMetaWeeklyReportOutputDir,
  generateWeeklyMetaAdsReport
} from "../scripts/meta-ads-weekly-report.mjs";

let tempDir;
test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "meta-weekly-report-test-"));
});
test.after(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

function levelPayload(rows, totals) {
  return { ok: true, rows, totals };
}

const currentCampaignRows = [
  { campaignId: "c1", campaignName: "Campaign One", status: "ACTIVE", spend: 600000, impressions: 300000, reach: 200000, clicks: 3000, ctr: 1.0, cpc: 200, cpm: 2000, purchases: 30, purchaseValue: 1800000, cpa: 20000, roas: 3.0 },
  { campaignId: "c2", campaignName: "Campaign Two", status: "PAUSED", spend: 400000, impressions: 200000, reach: 150000, clicks: 2000, ctr: 1.0, cpc: 200, cpm: 2000, purchases: 20, purchaseValue: 1200000, cpa: 20000, roas: 3.0 }
];
const previousCampaignRows = [
  { campaignId: "c1", campaignName: "Campaign One", status: "ACTIVE", spend: 500000, impressions: 250000, reach: 180000, clicks: 2500, ctr: 1.0, cpc: 200, cpm: 2000, purchases: 25, purchaseValue: 1500000, cpa: 20000, roas: 3.0 },
  { campaignId: "c2", campaignName: "Campaign Two", status: "PAUSED", spend: 300000, impressions: 150000, reach: 120000, clicks: 1500, ctr: 1.0, cpc: 200, cpm: 2000, purchases: 15, purchaseValue: 900000, cpa: 20000, roas: 3.0 }
];

const currentTotals = { spend: 1000000, reach: 350000, impressions: 500000, clicks: 5000, ctr: 1.0, cpc: 200, cpm: 2000, purchases: 50, purchaseValue: 3000000, cpa: 20000, roas: 3.0 };
const previousTotals = { spend: 800000, reach: 300000, impressions: 400000, clicks: 4000, ctr: 1.0, cpc: 200, cpm: 2000, purchases: 40, purchaseValue: 2400000, cpa: 20000, roas: 3.0 };

const currentByLevel = {
  campaign: levelPayload(currentCampaignRows, currentTotals),
  adset: levelPayload([], currentTotals),
  ad: levelPayload([], currentTotals)
};
const previousByLevel = {
  campaign: levelPayload(previousCampaignRows, previousTotals),
  adset: levelPayload([], previousTotals),
  ad: levelPayload([], previousTotals)
};

test("date range uses the most recently completed Monday-Sunday week", () => {
  assert.deepEqual(previousMondayToSundayRange("2026-09-29"), { since: "2026-09-21", until: "2026-09-27" });
});

test("KPI aggregation — campaign-level totals pass through unchanged, never fabricated", () => {
  const model = buildWeeklyMetaReportModel({ current: currentByLevel, previous: previousByLevel, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  assert.equal(model.ok, true);
  assert.equal(model.summary.spend, 1000000);
  assert.equal(model.summary.purchaseValue, 3000000);
  assert.equal(model.summary.roas, 3.0);
});

test("WoW calculation — per-campaign wowSpend/wowPurchaseValue and divide-by-zero safety", () => {
  const model = buildWeeklyMetaReportModel({ current: currentByLevel, previous: previousByLevel, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  const c1 = model.campaigns.find((row) => row.campaignId === "c1");
  assert.equal(c1.wowSpend, 20); // 600000 vs 500000
  assert.equal(wowChange(100, 0), null);
  assert.equal(wowChange(0, 0), null);
});

test("a campaign with no matching previous-week row gets a null WoW instead of a fabricated one", () => {
  const model = buildWeeklyMetaReportModel({
    current: { ...currentByLevel, campaign: levelPayload([...currentCampaignRows, { campaignId: "c3", campaignName: "New", status: "ACTIVE", spend: 1000, purchaseValue: 0 }], currentTotals) },
    previous: previousByLevel,
    since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21"
  });
  const c3 = model.campaigns.find((row) => row.campaignId === "c3");
  assert.equal(c3.wowSpend, null);
});

test("Meta attribution is never mislabeled as Cafe24 revenue — SUMMARY sheet carries an explicit attribution note", async () => {
  const model = buildWeeklyMetaReportModel({ current: currentByLevel, previous: previousByLevel, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  const workbook = await buildWeeklyMetaReportWorkbook(model);
  const summarySheet = workbook.getWorksheet("SUMMARY");
  const noteRow = summarySheet.getRows(1, summarySheet.rowCount).find((row) => String(row.getCell(1).value || "").includes("Attribution"));
  assert.ok(noteRow, "expected an Attribution 안내 row");
  assert.match(String(noteRow.getCell(2).value), /Meta 자체 귀속.*Cafe24 실제 매출과 다릅니다/);
});

test("unavailable current-week data does not write a file and reports the reason, never fabricating rows", async () => {
  const fetchByLevel = async () => ({ ok: false, error: "Meta access token expired" });
  const result = await generateWeeklyMetaAdsReport({ referenceDateKey: "2026-09-29", fetchByLevel, outputDir: tempDir });
  assert.equal(result.ok, false);
  assert.equal(result.filePath, null);
  assert.match(result.error, /access token/i);
});

test("XLSX generation — workbook has all 7 decision sheets plus RAW with the expected CAMPAIGNS headers", async () => {
  const model = buildWeeklyMetaReportModel({ current: currentByLevel, previous: previousByLevel, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  const workbook = await buildWeeklyMetaReportWorkbook(model);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  assert.deepEqual(names, ["SUMMARY", "CAMPAIGN", "AD SET", "CREATIVE_AD", "TREND", "AI_ANALYSIS", "ACTUAL_PRODUCTS_SOLD", "RAW"]);
  const campaignHeaders = workbook.getWorksheet("CAMPAIGN").getRow(1).values.filter(Boolean);
  for (const expected of ["Campaign ID", "Campaign Name", "Spend", "Impressions", "Reach", "Clicks", "CTR", "CPC", "CPM", "Purchases", "Purchase Value", "CPA", "ROAS"]) {
    assert.ok(campaignHeaders.includes(expected), `missing CAMPAIGNS header: ${expected}`);
  }
});

test("end to end through generateWeeklyMetaAdsReport picks the correct week by since", async () => {
  const fetchByLevel = async (since, until, level) => (since === "2026-09-21" ? currentByLevel[level] : previousByLevel[level]);
  const result = await generateWeeklyMetaAdsReport({ referenceDateKey: "2026-09-29", fetchByLevel, outputDir: tempDir });
  assert.equal(result.ok, true);
  assert.equal(result.since, "2026-09-21");
  assert.equal(result.until, "2026-09-27");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(result.filePath);
  const summarySheet = workbook.getWorksheet("SUMMARY");
  const spendRow = summarySheet.getRows(1, summarySheet.rowCount).find((row) => row.getCell(1).value === "Spend (광고비)");
  assert.equal(spendRow.getCell(4).value, 25); // (1,000,000 - 800,000) / 800,000 * 100
});

test("duplicate report handling — a second local run for the same week is versioned, never overwritten", async () => {
  const dir = join(tempDir, "dup-test");
  const fetchByLevel = async (since, until, level) => (since === "2026-09-21" ? currentByLevel[level] : previousByLevel[level]);
  await generateWeeklyMetaAdsReport({ referenceDateKey: "2026-09-29", fetchByLevel, outputDir: dir });
  await generateWeeklyMetaAdsReport({ referenceDateKey: "2026-09-29", fetchByLevel, outputDir: dir });
  const files = await readdir(dir);
  assert.equal(files.length, 2);
  assert.ok(files.some((name) => name.endsWith("_v2.xlsx")));
});

test("output path — META_ADS_WEEKLY_REPORT_DIR overrides the default, and the default falls back to WORK_DIR/reports/meta-ads-weekly", () => {
  const configured = resolveMetaWeeklyReportOutputDir({ META_ADS_WEEKLY_REPORT_DIR: "/custom/path" });
  assert.equal(configured, "/custom/path");
  const fallback = resolveMetaWeeklyReportOutputDir({ WORK_DIR: "/tmp/samplas-work" });
  assert.equal(fallback, "/tmp/samplas-work/reports/meta-ads-weekly");
});
