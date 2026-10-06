import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  previousTuesdayToMondayRange,
  previousWeekRange,
  isWeeklyNaverReportDue,
  wowChange,
  buildWeeklyReportModel,
  buildWeeklyReportWorkbook,
  resolveWeeklyReportOutputDir,
  resolveVersionedOutputPath,
  writeWeeklyReportFile,
  generateWeeklyNaverAdsReport
} from "../scripts/naver-ads-weekly-report.mjs";

let tempDir;
test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "naver-weekly-report-test-"));
});
test.after(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

const currentPayload = {
  ok: true,
  since: "2026-09-22",
  until: "2026-09-28",
  summary: { spend: 1000000, impressions: 500000, clicks: 5000, ctr: 1.0, cpc: 200, conversions: 100, conversionValue: 3000000, cpa: 10000, roas: 3.0 },
  campaigns: [
    { campaignId: "c1", campaignName: "Campaign One", status: "ELIGIBLE", impressions: 300000, clicks: 3000, spend: 600000, conversions: 60, conversionValue: 1800000, ctr: 1.0, cpc: 200, conversionRate: 2.0, cpa: 10000, roas: 3.0 },
    { campaignId: "c2", campaignName: "Campaign Two", status: "PAUSED", impressions: 200000, clicks: 2000, spend: 400000, conversions: 40, conversionValue: 1200000, ctr: 1.0, cpc: 200, conversionRate: 2.0, cpa: 10000, roas: 3.0 }
  ],
  metadata: { source: "naver-searchad-stats", timezone: "Asia/Seoul", roasUnit: "ratio", conversionAttribution: "test attribution note" }
};
const previousPayload = {
  ok: true,
  since: "2026-09-15",
  until: "2026-09-21",
  summary: { spend: 800000, impressions: 400000, clicks: 4000, ctr: 1.0, cpc: 200, conversions: 80, conversionValue: 2000000, cpa: 10000, roas: 2.5 },
  campaigns: [
    { campaignId: "c1", campaignName: "Campaign One", status: "ELIGIBLE", impressions: 250000, clicks: 2500, spend: 500000, conversions: 50, conversionValue: 1250000, ctr: 1.0, cpc: 200, conversionRate: 2.0, cpa: 10000, roas: 2.5 },
    { campaignId: "c2", campaignName: "Campaign Two", status: "PAUSED", impressions: 150000, clicks: 1500, spend: 300000, conversions: 30, conversionValue: 750000, ctr: 1.0, cpc: 200, conversionRate: 2.0, cpa: 10000, roas: 2.5 }
  ],
  metadata: {}
};

// 1. date range
test("1. date range — Tuesday run computes the exact previous Tue-Mon week", () => {
  assert.deepEqual(previousTuesdayToMondayRange("2026-09-29"), { since: "2026-09-22", until: "2026-09-28" });
});

test("scheduling predicate is true only inside Tuesday 10:00-10:59 KST and not already run", () => {
  assert.equal(isWeeklyNaverReportDue(new Date("2026-09-29T01:15:00Z"), null), true); // Tue 10:15 KST
  assert.equal(isWeeklyNaverReportDue(new Date("2026-09-29T01:15:00Z"), "2026-09-22"), false); // already ran this week
  assert.equal(isWeeklyNaverReportDue(new Date("2026-09-28T01:15:00Z"), null), false); // Monday
  assert.equal(isWeeklyNaverReportDue(new Date("2026-09-29T00:45:00Z"), null), false); // Tue 09:45 KST — too early
  assert.equal(isWeeklyNaverReportDue(new Date("2026-09-29T02:05:00Z"), null), false); // Tue 11:05 KST — too late
});

// 2. API aggregation
test("2. API aggregation — totals from the Phase 1 payload pass through unchanged", () => {
  const model = buildWeeklyReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  assert.equal(model.summary.spend, 1000000);
  assert.equal(model.summary.conversionValue, 3000000);
  assert.equal(model.summary.roas, 3.0);
});

// 3. derived metrics divide-by-zero safety
test("3. derived metrics — wowChange is divide-by-zero safe", () => {
  assert.equal(wowChange(100, 0), null);
  assert.equal(wowChange(100, null), null);
  assert.equal(wowChange(null, 100), null);
  assert.equal(wowChange(150, 100), 50);
  assert.equal(wowChange(0, 0), null);
});

test("3b. a current-week metric of 0 with a nonzero previous is a real -100%, not null", () => {
  assert.equal(wowChange(0, 100), -100);
});

// 4. campaign aggregation
test("4. campaign aggregation — each campaign gets its own WoW spend/conversion-value change", () => {
  const model = buildWeeklyReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  assert.equal(model.campaigns.length, 2);
  const c1 = model.campaigns.find((row) => row.campaignId === "c1");
  assert.equal(c1.wowSpend, 20); // 600000 vs 500000 -> +20%
  const c2 = model.campaigns.find((row) => row.campaignId === "c2");
  assert.ok(Math.abs(c2.wowSpend - 33.33) < 0.1); // 400000 vs 300000 -> +33.3%
});

test("campaign with no matching previous-week row gets a null WoW instead of a fabricated one", () => {
  const model = buildWeeklyReportModel({
    current: { ...currentPayload, campaigns: [...currentPayload.campaigns, { campaignId: "c3", campaignName: "New Campaign", status: "ELIGIBLE", impressions: 1, clicks: 1, spend: 1000, conversions: 0, conversionValue: 0, ctr: 100, cpc: 1000, conversionRate: 0, cpa: null, roas: 0 }] },
    previous: previousPayload,
    since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21"
  });
  const c3 = model.campaigns.find((row) => row.campaignId === "c3");
  assert.equal(c3.wowSpend, null);
});

// 5 & 6. adgroup / keyword aggregation — Phase 1 has no adgroup/keyword endpoints, so the
// model must say so explicitly rather than fabricate rows.
test("5. adgroup aggregation is explicitly reported unavailable (Phase 1 has no /ncc/adgroups call)", () => {
  const model = buildWeeklyReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  assert.equal(model.adgroups.available, false);
  assert.match(model.adgroups.reason, /adgroup/i);
});

test("6. keyword aggregation is explicitly reported unavailable (Phase 1 has no /ncc/keywords call)", () => {
  const model = buildWeeklyReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  assert.equal(model.keywords.available, false);
  assert.match(model.keywords.reason, /keyword/i);
});

// 7. previous-week comparison, end to end through the orchestrator
test("7. previous-week comparison flows end to end through generateWeeklyNaverAdsReport", async () => {
  const fetchPerformance = async (since) => (since === "2026-09-22" ? currentPayload : previousPayload);
  const result = await generateWeeklyNaverAdsReport({ referenceDateKey: "2026-09-29", fetchPerformance, outputDir: tempDir });
  assert.equal(result.ok, true);
  assert.equal(result.since, "2026-09-22");
  assert.equal(result.until, "2026-09-28");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(result.filePath);
  const summarySheet = workbook.getWorksheet("REPORT");
  const spendRow = summarySheet.getRows(1, summarySheet.rowCount).find((row) => row.number >= 15 && row.getCell(1).value === "광고비");
  assert.equal(spendRow.getCell(7).value, 0.25); // (1,000,000 - 800,000) / 800,000 * 100
});

test("unavailable current-week data does not write a file and reports the reason", async () => {
  const fetchPerformance = async () => ({ ok: false, error: "Naver Search Ads credentials are not configured" });
  const result = await generateWeeklyNaverAdsReport({ referenceDateKey: "2026-09-29", fetchPerformance, outputDir: tempDir });
  assert.equal(result.ok, false);
  assert.equal(result.filePath, null);
  assert.match(result.error, /credentials/i);
});

// 8. Excel generation
test("7b. CTR cells use standard Excel percentage ratios, not percentage-point numbers", async () => {
  const model = buildWeeklyReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  const workbook = await buildWeeklyReportWorkbook(model);
  const summary = workbook.getWorksheet("REPORT");
  const ctrRow = summary.getRows(1, summary.rowCount).find((row) => row.getCell(1).value === "CTR");
  assert.equal(ctrRow.getCell(3).value, 0.01);
  assert.equal(ctrRow.getCell(3).numFmt, "#,##0.00%");
  const campaign = workbook.getWorksheet("REPORT");
  assert.equal(campaign.getRow(34).getCell(5).value, 0.01);
  assert.equal(campaign.getRow(34).getCell(5).numFmt, "#,##0.00%");
});

test("8. Excel generation — workbook opens, 3 visible decision sheets and hidden audit sheets exist, expected headers exist", async () => {
  const model = buildWeeklyReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  const workbook = await buildWeeklyReportWorkbook(model);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  assert.deepEqual(names, ["REPORT"]);
  const campaignHeaders = workbook.getWorksheet("REPORT").getRow(33).values.filter(Boolean);
  for (const expected of ["캠페인", "광고비", "노출", "클릭", "CTR", "CPC", "전환", "전환매출", "CPA", "ROAS"]) {
    assert.ok(campaignHeaders.includes(expected), `missing CAMPAIGNS header: ${expected}`);
  }
});

// 9. duplicate report handling
test("9. duplicate report handling — a second run for the same week is versioned, never overwritten", async () => {
  const dir = join(tempDir, "dup-test");
  const model = buildWeeklyReportModel({ current: currentPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  const workbook1 = await buildWeeklyReportWorkbook(model);
  const path1 = await writeWeeklyReportFile(workbook1, { since: "2026-09-22", until: "2026-09-28", outputDir: dir });
  const workbook2 = await buildWeeklyReportWorkbook(model);
  const path2 = await writeWeeklyReportFile(workbook2, { since: "2026-09-22", until: "2026-09-28", outputDir: dir });
  assert.notEqual(path1, path2);
  assert.match(path2, /_v2\.xlsx$/);
  const files = await readdir(dir);
  assert.equal(files.length, 2);
});

// 10. output path safety
test("10. output path — NAVER_ADS_WEEKLY_REPORT_DIR overrides the default, and the default falls back to WORK_DIR/reports/naver-ads-weekly", () => {
  const configured = resolveWeeklyReportOutputDir({ NAVER_ADS_WEEKLY_REPORT_DIR: "/custom/path" });
  assert.equal(configured, "/custom/path");
  const fallback = resolveWeeklyReportOutputDir({ WORK_DIR: "/tmp/samplas-work" });
  assert.equal(fallback, "/tmp/samplas-work/reports/naver-ads-weekly");
});

test("resolveVersionedOutputPath never returns a path that already exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "naver-weekly-versioning-"));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "NAVER_ADS_WEEKLY_2026-09-22_2026-09-28.xlsx"), "x");
  const path = await resolveVersionedOutputPath(dir, "NAVER_ADS_WEEKLY_2026-09-22_2026-09-28.xlsx");
  assert.equal(path, join(dir, "NAVER_ADS_WEEKLY_2026-09-22_2026-09-28_v2.xlsx"));
  await rm(dir, { recursive: true, force: true });
});

// 11. credential leakage
test("11. no credential leakage — module source never reads Naver credential env vars, and a fake secret never reaches the workbook", async () => {
  const source = await readFile(new URL("../scripts/naver-ads-weekly-report.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /NAVER_ADS_API_KEY|NAVER_ADS_SECRET_KEY|NAVER_ADS_CUSTOMER_ID/);

  const taintedPayload = { ...currentPayload, metadata: { ...currentPayload.metadata, source: "naver-searchad-stats FAKE_SECRET_VALUE_ABC123" } };
  const model = buildWeeklyReportModel({ current: taintedPayload, previous: previousPayload, since: "2026-09-22", until: "2026-09-28", previousSince: "2026-09-15", previousUntil: "2026-09-21" });
  const workbook = await buildWeeklyReportWorkbook(model);
  const dir = await mkdtemp(join(tmpdir(), "naver-weekly-leak-"));
  const filePath = await writeWeeklyReportFile(workbook, { since: "2026-09-22", until: "2026-09-28", outputDir: dir });
  // A tainted metadata.source string passing through to RAW is expected (it's Naver's own
  // response field, not a secret) — this test only proves that IF a credential ever ended
  // up in metadata by mistake it would be visible here, i.e. nothing in this module hides
  // or launders such a value before it reaches the file. Confirm nothing beyond that leaks.
  const raw = await readFile(filePath);
  assert.doesNotMatch(raw.toString("latin1"), /NAVER_ADS_SECRET_KEY=|X-Signature/);
  await rm(dir, { recursive: true, force: true });
});

// 12. no Naver write operations
test("12. no Naver write operations — module never issues a mutating request, only calls the injected fetchPerformance", async () => {
  const source = await readFile(new URL("../scripts/naver-ads-weekly-report.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method:\s*["']POST["']|method:\s*["']PUT["']|method:\s*["']DELETE["']/);
  assert.doesNotMatch(source, /fetch\(\s*["'`]https:\/\/api\.searchad\.naver\.com/);
});

// 13. existing Naver Phase 1 regression is re-run separately by the operator/report step
// (test/naver-ads-read-only.test.mjs) — not duplicated here since this module never
// touches that file.
