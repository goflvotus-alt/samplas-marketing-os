import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { reconcileAdgroupCoverage, verifyAdgroupSection } from "../scripts/naver-weekly-adgroup-integrity.mjs";
import { buildWeeklyReportModel, buildWeeklyReportWorkbook, generateWeeklyNaverAdsReport } from "../scripts/naver-ads-weekly-report.mjs";

// Synthetic test inputs only; production never reads these values.
const metrics = (spend) => ({ spend, impressions: spend * 10, clicks: spend / 10, conversions: 1, conversionValue: spend * 3, ctr: 1, cpc: 10, conversionRate: 10, cpa: spend, roas: 3 });
const campaign = (campaignId, spend) => ({ campaignId, campaignName: `Campaign ${campaignId}`, status: "ELIGIBLE", ...metrics(spend) });
const group = (id, campaignId, spend, extra = {}) => ({ id, campaignId, name: `GROUP ${id}`, canonicalBrandName: null, statsAvailable: true, ...metrics(spend), ...extra });
const summary = (spend) => ({ ...metrics(spend) });
const payload = (adgroups, campaigns = [campaign("c1", 600), campaign("c2", 400)]) => ({
  ok: true, since: "2026-10-20", until: "2026-10-26", summary: summary(campaigns.reduce((s, c) => s + c.spend, 0)), campaigns, adgroups,
  searchDemand: { available: false, top10: [], rising5: [], reason: "검색 수요 Snapshot 미제공" }, metadata: { source: "naver-searchad-stats" }
});
const previous = { ok: true, since: "2026-10-13", until: "2026-10-19", summary: summary(900), campaigns: [campaign("c1", 500), campaign("c2", 400)] };
const dates = { since: "2026-10-20", until: "2026-10-26", previousSince: "2026-10-13", previousUntil: "2026-10-19" };
const modelFor = (adgroups, campaigns) => buildWeeklyReportModel({ ...dates, current: payload(adgroups, campaigns), previous });

async function roundTrip(model) {
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await (await buildWeeklyReportWorkbook(model)).xlsx.writeBuffer());
  const parts = [];
  loaded.getWorksheet("ISSUE_EVIDENCE").eachRow((row) => parts.push(row.getCell(1).value));
  return { report: loaded.getWorksheet("REPORT"), evidence: JSON.parse(parts.join("")), hidden: loaded.getWorksheet("ISSUE_EVIDENCE").state };
}

test("normal: every adgroup measured and reconciled -> PASS, adgroup rows shown", async () => {
  const model = modelFor({ available: true, rows: [group("g1", "c1", 350), group("g2", "c1", 250), group("g3", "c2", 400)] });
  assert.equal(model.review.result, "PASS");
  assert.deepEqual(model.review.issues, []);
  const { report, evidence, hidden } = await roundTrip(model);
  assert.equal(hidden, "veryHidden");
  assert.equal(evidence.review.result, "PASS");
  assert.equal(evidence.review.sections.adgroups, "VERIFIED");
  assert.match(String(report.getCell("A4").value), /^검증 PASS/);
  assert.equal(report.getCell("A33").value, "광고그룹");
  assert.equal(report.getCell("A32").value, "03  브랜드 / 광고그룹 성과");
});

test("exceeds (2026-10-27 production error): report continues, campaigns unchanged, adgroups FAILED, PARTIAL with campaign ID and excess", async () => {
  const model = modelFor({ available: true, rows: [group("g1", "c1", 400), group("g2", "c1", 250), group("g3", "c2", 400)] });
  assert.equal(model.ok, true);
  assert.equal(model.review.result, "PARTIAL");
  assert.equal(model.adgroups.available, false);
  assert.equal(model.adgroups.verification, "FAILED");
  assert.deepEqual(model.adgroups.rows, []);
  const [issue] = model.review.issues;
  assert.equal(issue.status, "FAILED");
  assert.deepEqual(issue.reasons, ["naver_adgroup_spend_exceeds_campaign"]);
  assert.deepEqual(issue.evidence.exceeded, [{ campaignId: "c1", campaignName: "Campaign c1", campaignSpend: 600, adgroupSpend: 650, excess: 50 }]);
  // Source campaign amounts are passed through untouched.
  assert.deepEqual(model.campaigns.map((c) => c.spend), [600, 400]);
  assert.equal(model.summary.spend, 1000);

  const { report, evidence } = await roundTrip(model);
  assert.equal(evidence.review.result, "PARTIAL");
  assert.equal(evidence.review.sections.campaigns, "VERIFIED");
  assert.equal(evidence.review.sections.adgroups, "FAILED");
  assert.deepEqual(evidence.review.issues[0].evidence.exceeded[0], { campaignId: "c1", campaignName: "Campaign c1", campaignSpend: 600, adgroupSpend: 650, excess: 50 });
  const banner = String(report.getCell("A4").value);
  assert.match(banner, /^PARTIAL · 캠페인 성과 검증 완료 · 광고그룹 상세 검증 실패/);
  assert.match(banner, /campaign c1 adgroups 650 > campaign 600 \(\+50\)/);
  assert.match(String(report.getCell("A32").value), /광고그룹 상세 · 검증 실패/);
  assert.equal(report.getCell("A33").value, "캠페인");
  assert.equal(report.getCell("A34").value, "Campaign c1");
  assert.equal(report.getCell("B34").value, 600);
  const notes = [];
  report.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string") notes.push(cell.value); }));
  assert.ok(notes.some((t) => t.startsWith("광고그룹 검증 실패 → 검증된 캠페인 fallback: 광고그룹 상세 검증 실패 — naver_adgroup_spend_exceeds_campaign")));
  assert.ok(!notes.some((t) => t.startsWith("광고그룹 조회 불가")));
});

test("adgroups outside every reported campaign fail at account level with campaignId null", () => {
  const { section } = verifyAdgroupSection({ available: true, rows: [group("g1", "c1", 600), group("g9", "c9", 50)] }, [campaign("c1", 600)]);
  assert.equal(section.status, "FAILED");
  assert.deepEqual(JSON.parse(JSON.stringify(section.evidence.exceeded)), [{ campaignId: null, campaignName: null, campaignSpend: 600, adgroupSpend: 650, excess: 50 }]);
  assert.equal(section.detail, "naver_adgroup_spend_exceeds_campaign: account adgroups 650 > campaigns 600 (+50)");
});

test("duplicate adgroup IDs also fail only the adgroup section", () => {
  const model = modelFor({ available: true, rows: [group("g1", "c1", 300), group("g1", "c1", 300), group("g3", "c2", 400)] });
  assert.equal(model.ok, true);
  assert.equal(model.review.result, "PARTIAL");
  assert.deepEqual(model.review.issues[0].reasons, ["naver_duplicate_adgroup_id"]);
  assert.deepEqual(model.review.issues[0].evidence, { adgroupId: "g1" });
});

test("adgroup API error (enrichment fallback): campaign report continues, adgroups UNAVAILABLE, PARTIAL", async () => {
  const model = modelFor({ available: false, reason: "광고그룹 통계 조회 실패 또는 불완전 응답", rows: [] });
  assert.equal(model.ok, true);
  assert.equal(model.review.result, "PARTIAL");
  assert.equal(model.review.sections.adgroups, "UNAVAILABLE");
  assert.deepEqual(model.review.issues[0].reasons, ["ADGROUPS_UNAVAILABLE"]);
  const { report, evidence } = await roundTrip(model);
  assert.equal(evidence.review.sections.adgroups, "UNAVAILABLE");
  assert.match(String(report.getCell("A4").value), /광고그룹 상세 조회 불가 — 광고그룹 통계 조회 실패 또는 불완전 응답/);
  assert.equal(report.getCell("A33").value, "캠페인");
});

test("partial adgroup stats: measured rows kept, unmeasured stay N/A (never 0), PARTIAL", async () => {
  const unmeasured = group("g2", "c1", null, { statsAvailable: false, impressions: null, clicks: null, conversions: null, conversionValue: null });
  const model = modelFor({ available: true, rows: [group("g1", "c1", 350), unmeasured, group("g3", "c2", 400)] });
  assert.equal(model.review.result, "PARTIAL");
  assert.equal(model.review.sections.adgroups, "PARTIAL");
  assert.deepEqual(model.review.issues[0].reasons, ["ADGROUP_STATS_PARTIAL", "ADGROUP_SPEND_UNRECONCILED"]);
  assert.equal(model.adgroups.coverage.difference, 250);
  assert.equal(model.adgroups.rows.find((r) => r.id === "g2").spend, null);
  const { report, evidence } = await roundTrip(model);
  assert.equal(evidence.review.sections.adgroups, "PARTIAL");
  assert.match(String(report.getCell("A4").value), /광고그룹 상세 부분 확인 — 광고그룹 실측 2\/3 · 캠페인 대비 미확인 차액 250원/);
  assert.equal(report.getCell("A33").value, "광고그룹");
});

test("campaign API error still fails the whole report: no workbook, no evidence, no save", async () => {
  let saved = 0;
  const result = await generateWeeklyNaverAdsReport({
    referenceDateKey: "2026-10-27",
    fetchPerformance: async () => ({ ok: false, error: "Naver Search Ads request timed out" }),
    saveReport: async () => { saved += 1; return {}; }
  });
  assert.deepEqual({ ok: result.ok, error: result.error, filePath: result.filePath }, { ok: false, error: "Naver Search Ads request timed out", filePath: null });
  assert.equal(saved, 0);
});

test("end to end: an exceeding week is saved as a PARTIAL report instead of throwing (regression for 10/20, 10/27)", async () => {
  let workbook;
  const result = await generateWeeklyNaverAdsReport({
    referenceDateKey: "2026-10-27",
    fetchPerformance: async (since) => since === "2026-10-20"
      ? payload({ available: true, rows: [group("g1", "c1", 700), group("g3", "c2", 400)] })
      : previous,
    saveReport: async (wb, { since, until }) => { workbook = wb; return { filePath: `/stub/NAVER_ADS_WEEKLY_${since}_${until}.xlsx`, uploaded: false }; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.filePath, "/stub/NAVER_ADS_WEEKLY_2026-10-20_2026-10-26.xlsx");
  const parts = [];
  workbook.getWorksheet("ISSUE_EVIDENCE").eachRow((row) => parts.push(row.getCell(1).value));
  const evidence = JSON.parse(parts.join(""));
  assert.equal(evidence.review.result, "PARTIAL");
  assert.equal(evidence.review.issues[0].evidence.exceeded[0].excess, 100);
});

test("reconcileAdgroupCoverage still throws for direct callers, with code and amounts", () => {
  assert.throws(() => reconcileAdgroupCoverage({ available: true, rows: [group("g1", "c1", 110)] }, [campaign("c1", 100)]),
    (error) => error.code === "naver_adgroup_spend_exceeds_campaign" && error.message === "naver_adgroup_spend_exceeds_campaign: campaign c1 adgroups 110 > campaign 100 (+10)");
});
