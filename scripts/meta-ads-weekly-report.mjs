// Meta Ads Weekly Report generator — mirrors scripts/naver-ads-weekly-report.mjs's
// architecture exactly (same date math, same pluggable saveReport, same local-vs-Dropbox
// split) but built independently: the Naver file is never imported for its report-model
// or Excel-building logic (only its pure, platform-agnostic date helpers are reused, via
// import, never by copy — see below), so nothing about Naver's own weekly report changes.
//
// Data collection is NOT reimplemented here: this module only ever consumes an
// already-fetched Meta Ads Insights payload (the same shape server.mjs's existing
// buildMetaAdsSummaryWithCache(since, until, {level}) already returns — the same function
// backing the existing /api/meta-ads/summary route). The actual Graph API fetch is
// injected by the caller (server.mjs's scheduler; the CLI/tests inject their own).
//
// Metric availability (from the existing Meta Marketing API Insights call, unchanged):
//   AVAILABLE: spend, impressions, reach, clicks, ctr, cpc, cpm, purchases (Meta-reported),
//              purchase value (Meta-reported), cpa, roas, frequency
//   NOTE: "purchases"/"purchase value"/"roas" are Meta's own attributed conversions
//   (action_type "purchase"), not Cafe24 actual revenue — never mixed with Cafe24 data
//   in the attribution KPIs; Cafe24 actual orders are a separate sheet.
import { mkdir, rename, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { seoulDateKey, previousMondayToSundayRange, previousWeekRange, wowChange } from "./naver-ads-weekly-report.mjs";

import { buildActualProductsSold } from "./meta-actual-products-sold.mjs";
import {buildWeeklySalesTrace,addWeeklySalesTraceSheets} from './meta-weekly-sales-trace.mjs';
import {scheduledMetaPublication,reviewMetaPublication,reconcileMetaPublication,publicationRecord,readIssuedMetaReport,inspectIssuedStorage,storeIssuedMetaReport,trackIssuedRefunds} from './meta-issued-report.mjs';
import { metaOnePage } from "./weekly-onepage-report.mjs";
import { analyzeMetaLevels, writeDecisionSheet, addExecutiveRead, addWowFormatting, addPerformanceFormatting } from "./weekly-report-analysis.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export { seoulDateKey, previousMondayToSundayRange, previousWeekRange, wowChange };

const SUMMARY_FIELDS = ["spend", "reach", "impressions", "clicks", "ctr", "cpc", "cpm", "purchases", "purchaseValue", "cpa", "roas"];
const LEVELS = ["campaign", "adset", "ad"];

// ---------------------------------------------------------------------------
// Report data model. `fetchByLevel(since, until, level)` is injected — same contract for
// all 3 levels — and is expected to return the exact shape buildMetaAdsSummaryWithCache()
// already produces: { rows: [...], totals: {...} } on success, or { ok:false, error } on
// failure. Never fabricates a metric the Insights API doesn't return.
// ---------------------------------------------------------------------------

export async function fetchAllMetaLevels(since, until, fetchByLevel) {
  const results = {};
  for (const level of LEVELS) {
    results[level] = await fetchByLevel(since, until, level);
  }
  return results;
}

function levelOk(data) {
  return Boolean(data) && data.ok !== false && Array.isArray(data.rows);
}

export function buildWeeklyMetaReportModel({ current, previous, since, until, previousSince, previousUntil, actualOrders, actualAnalytics, adGrades = false, payments, metaProducts, tracking }) {
  const campaignCurrent = current?.campaign;
  const currentOk = levelOk(campaignCurrent);

  const summary = currentOk
    ? Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, campaignCurrent.totals?.[field] ?? null]))
    : null;
  const previousSummary = levelOk(previous?.campaign)
    ? Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, previous.campaign.totals?.[field] ?? null]))
    : null;
  const wow = summary && previousSummary
    ? Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, wowChange(summary[field], previousSummary[field])]))
    : null;

  function rowsForLevel(level, idField) {
    const currentLevel = current?.[level];
    if (!levelOk(currentLevel)) return [];
    const previousRows = levelOk(previous?.[level]) ? previous[level].rows : [];
    const previousById = new Map(previousRows.map((row) => [row[idField], row]));
    return currentLevel.rows.map((row) => ({
      ...row,
      wowSpend: wowChange(row.spend, previousById.get(row[idField])?.spend ?? null),
      wowPurchaseValue: wowChange(row.purchaseValue, previousById.get(row[idField])?.purchaseValue ?? null)
    }));
  }

  return {
    since,
    until,
    previousSince,
    previousUntil,
    ok: currentOk,
    error: currentOk ? null : campaignCurrent?.error || "Meta Ads data unavailable",
    summary,
    previousSummary,
    wow,
    campaigns: rowsForLevel("campaign", "campaignId"),
    adsets: rowsForLevel("adset", "adsetId"),
    ads: rowsForLevel("ad", "adId"),
    analysis: analyzeMetaLevels(current, previous),
    salesTrace: buildWeeklySalesTrace({since,until,actualOrders,analytics:actualAnalytics,payments,metaProducts,tracking,ads:current?.ad?.rows||[],metaSummary:campaignCurrent?.totals}),
    actualProducts: buildActualProductsSold({
      data: actualOrders,
      analytics: actualAnalytics,
      metaAds: current?.ad?.rows || [],
      since,
      until,
      adGrades
    }),
    raw: currentOk ? current : null
  };
}

// ---------------------------------------------------------------------------
// Excel workbook
// ---------------------------------------------------------------------------

const NUM_FMT = "#,##0";
const WON_FMT = "#,##0\"원\"";
const PCT1_FMT = "0.00%";
const PCT1_SIGNED_FMT = "+0.0\"%\";-0.0\"%\";0.0\"%\"";
const MULTIPLE_FMT = "0.00\"x\"";

const KPI_ROWS = [
  ["Spend (광고비)", "spend", WON_FMT],
  ["Impressions (노출)", "impressions", NUM_FMT],
  ["Reach (도달)", "reach", NUM_FMT],
  ["Clicks (클릭)", "clicks", NUM_FMT],
  ["CTR", "ctr", PCT1_FMT],
  ["CPC", "cpc", WON_FMT],
  ["CPM", "cpm", WON_FMT],
  ["Purchases (Meta 보고 기준)", "purchases", NUM_FMT],
  ["Purchase Conversion Value (Meta 보고 기준)", "purchaseValue", WON_FMT],
  ["CPA", "cpa", WON_FMT],
  ["ROAS (Meta 보고 기준)", "roas", MULTIPLE_FMT]
];

function levelColumns(labelHeader, idHeader) {
  return [
    { header: idHeader, key: "id", width: 18 },
    { header: labelHeader, key: "name", width: 26 },
    { header: "Status", key: "status", width: 12 },
    { header: "Objective", key: "objective", width: 22 },
    { header: "Spend", key: "spend", width: 14, style: { numFmt: WON_FMT } },
    { header: "Impressions", key: "impressions", width: 14, style: { numFmt: NUM_FMT } },
    { header: "Reach", key: "reach", width: 14, style: { numFmt: NUM_FMT } },
    { header: "Clicks", key: "clicks", width: 12, style: { numFmt: NUM_FMT } },
    { header: "CTR", key: "ctr", width: 10, style: { numFmt: PCT1_FMT } },
    { header: "CPC", key: "cpc", width: 12, style: { numFmt: WON_FMT } },
    { header: "CPM", key: "cpm", width: 12, style: { numFmt: WON_FMT } },
    { header: "Purchases", key: "purchases", width: 12, style: { numFmt: NUM_FMT } },
    { header: "Purchase Value", key: "purchaseValue", width: 16, style: { numFmt: WON_FMT } },
    { header: "CPA", key: "cpa", width: 12, style: { numFmt: WON_FMT } },
    { header: "ROAS", key: "roas", width: 10, style: { numFmt: MULTIPLE_FMT } },
    { header: "WoW Spend", key: "wowSpend", width: 12, style: { numFmt: PCT1_SIGNED_FMT } },
    { header: "WoW Purchase Value", key: "wowPurchaseValue", width: 18, style: { numFmt: PCT1_SIGNED_FMT } }
  ];
}

function setupSheet(sheet, columns) {
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

function buildSummarySheet(workbook, model) {
  const sheet = workbook.addWorksheet("SUMMARY");
  setupSheet(sheet, [
    { header: "지표 (Metric)", key: "label", width: 32 },
    { header: "이번 주", key: "current", width: 18 },
    { header: "직전 주", key: "previous", width: 18 },
    { header: "WoW 증감률", key: "wow", width: 14 }
  ]);

  sheet.addRow({ label: "기간 (Period)", current: `${model.since} ~ ${model.until}`, previous: model.previousSince ? `${model.previousSince} ~ ${model.previousUntil}` : "—", wow: "" });
  sheet.addRow({ label: "Attribution 안내", current: "Purchases/Purchase Value/ROAS는 Meta 자체 귀속(보고) 기준이며 Cafe24 실제 매출과 다릅니다.", wow: "" });
  sheet.addRow({});

  if (!model.ok) {
    sheet.addRow({ label: "상태", current: `UNAVAILABLE — ${model.error}`, previous: "", wow: "" });
    return sheet;
  }

  for (const [label, field, numFmt] of KPI_ROWS) {
    const row = sheet.addRow({
      label,
      current: model.summary[field],
      previous: model.previousSummary ? model.previousSummary[field] : null,
      wow: model.wow ? model.wow[field] : null
    });
    row.getCell("current").numFmt = numFmt;
    if (model.previousSummary) row.getCell("previous").numFmt = numFmt;
    if (model.wow) row.getCell("wow").numFmt = PCT1_SIGNED_FMT;
  }
  let n=5;for(const [,field] of KPI_ROWS)addWowFormatting(sheet,"wow",n,n++,field);
  addExecutiveRead(sheet,model.analysis||[]);
  return sheet;
}

function buildLevelSheet(workbook, name, rows, model, { labelHeader, idHeader, idField, nameField }) {
  const sheet = workbook.addWorksheet(name);
  setupSheet(sheet, levelColumns(labelHeader, idHeader));
  if (!model.ok) {
    sheet.addRow({ id: `UNAVAILABLE — ${model.error}` });
    return sheet;
  }
  for (const row of rows) {
    const added=sheet.addRow({ id: row[idField], name: row[nameField] || row.label, ...row });
    if(/SALES|CONVERSIONS|PRODUCT_CATALOG/i.test(row.objective||""))addPerformanceFormatting(sheet,{spend:"spend",outcome:"purchases",roas:"roas",from:added.number,to:added.number});
  }
  addWowFormatting(sheet,"wowPurchaseValue",2,sheet.rowCount,"purchaseValue");
  return sheet;
}

function buildRawSheet(workbook, model) {
  const sheet = workbook.addWorksheet("RAW");
  sheet.addRow(["source", "meta_marketing_api"]);
  sheet.addRow(["attribution", "Meta-reported action_type purchase; not Cafe24 actual revenue or reconciled attribution."]);
  sheet.addRow([]);
  if (!model.ok) {
    sheet.addRow([`UNAVAILABLE — ${model.error}`]);
    return sheet;
  }
  const columns = ["campaignId", "campaignName", "adsetId", "adsetName", "adId", "adName", "objective", "status", "spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "purchases", "purchaseValue", "roas", "cpa"];
  sheet.addRow(columns);
  sheet.getRow(sheet.rowCount).font = { bold: true };
  for (const row of model.raw.ad.rows.length ? model.raw.ad.rows : model.raw.campaign.rows) {
    sheet.addRow(columns.map((key) => row[key] ?? null));
  }
  return sheet;
}

export async function buildWeeklyMetaReportWorkbook(model, { onePage = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SAMPLAS Marketing OS";
  workbook.created = new Date();
  if (onePage) metaOnePage(workbook, model);
  buildSummarySheet(workbook, model);
  buildLevelSheet(workbook, "CAMPAIGN", model.campaigns, model, { labelHeader: "Campaign Name", idHeader: "Campaign ID", idField: "campaignId", nameField: "campaignName" });
  buildLevelSheet(workbook, "AD SET", model.adsets, model, { labelHeader: "Adset Name", idHeader: "Adset ID", idField: "adsetId", nameField: "adsetName" });
  buildLevelSheet(workbook, "CREATIVE_AD", model.ads, model, { labelHeader: "Ad Name", idHeader: "Ad ID", idField: "adId", nameField: "adName" });
  const trend=workbook.addWorksheet("TREND");
  setupSheet(trend,[{header:"Period",key:"period",width:26},...SUMMARY_FIELDS.map(key=>({header:key,key,width:16}))]);
  if(model.previousSummary)trend.addRow({period:`${model.previousSince} ~ ${model.previousUntil}`,...model.previousSummary});
  if(model.summary)trend.addRow({period:`${model.since} ~ ${model.until}`,...model.summary});
  trend.addRow({period:"Available range only; no fabricated 8-week history"});
  writeDecisionSheet(workbook,"AI_ANALYSIS",model.analysis||[]);
  const actual=workbook.addWorksheet("ACTUAL_PRODUCTS_SOLD");
  const cols=[
    "order_id",
    "order_date",
    "inflow_path",
    "tracking_source",
    "ad_mapping",
    "campaign_id",
    "content_id",
    "analytics_ad",
    "analytics_medium",
    "analytics_keyword",
    "product_name",
    "product_no",
    "product_code",
    "option_size",
    "quantity",
    "product_amount",
    "actual_paid_amount",
    "analytics_order_amount",
    "order_status",
    "attribution_note",
    ...(model.actualProducts?.summary?.grades ? ["attribution_grade", "matched_ad_id", "amount_status"] : [])
  ];
  setupSheet(actual,cols.map(key=>({header:key=== "product_code"?"SKU/product_code":key==="option_size"?"option/size":key,key,width:["ad_mapping","attribution_note"].includes(key)?65:22})));
  if(!model.actualProducts?.available)actual.addRow({attribution_note:"UNAVAILABLE — "+(model.actualProducts?.reason||"Cafe24 actual orders not supplied; no Meta revenue substitution.")});
  else{for(const row of model.actualProducts.rows)actual.addRow(row);if(model.actualProducts.missingItems||model.actualProducts.missingDates)actual.addRow({attribution_note:`Coverage warning: missing item detail ${model.actualProducts.missingItems}; missing trusted date ${model.actualProducts.missingDates}. Not a complete sales reconciliation.`});}
  if(model.actualProducts?.possibleLimitReached)actual.addRow({attribution_note:"Coverage warning: existing Cafe24 reader limit reached; report may be partial."});
  if(model.verification?.actual?.current===false)actual.addRow({attribution_note:'미검증: Cafe24 Analytics/주문 범위를 검증하지 못해 Meta 귀속 실제 주문·금액을 확정할 수 없음. 0원으로 해석하지 말 것.'});
  for(const key of ["product_amount","actual_paid_amount","analytics_order_amount"])actual.getColumn(key).numFmt=WON_FMT;
  if (model.previousPublicationComparison) {
    const c = model.previousPublicationComparison;
    // Values that depend on an unverified Cafe24 reread or issue are 미검증, never a computed 0.
    const prevOk = model.verification?.actual?.previous !== false, issuedOk = c.issuedVerified !== false, U = '미검증';
    const sheet = workbook.addWorksheet('REFUND_ADJUSTMENTS');
    setupSheet(sheet,[['orderId','주문번호'],['orderDate','주문일'],['refundDate','취소·환불일'],['refundAmount','환불금액'],['issuedAt','발행 기준일'],['currentStatus','현재 상태'],['issuedAmount','발행 금액'],['currentAmount','현재 순매출'],['adjustment','조정액'],['status','검증 결과']].map(([key,header])=>({key,header,width:24})));
    for (const row of c.rows) sheet.addRow(prevOk && issuedOk ? row : {...row, issuedAmount: issuedOk ? row.issuedAmount : U, currentAmount: prevOk ? row.currentAmount : U, adjustment: U, refundAmount: U});
    if (!c.rows.length) sheet.addRow({status:c.status});
    const summary = workbook.addWorksheet('ISSUED_COMPARISON');
    summary.addRows([['전주 기간',model.previousSince,model.previousUntil],['발행 당시 주문 수',!issuedOk?U:c.issuedOrderCount??'UNAVAILABLE'],['발행 당시 매출',!issuedOk?U:c.issuedRevenue??'UNAVAILABLE'],['후속 환불 조정',!issuedOk||!prevOk?U:c.refundAdjustment??'UNAVAILABLE'],['현재 기준 순매출',!prevOk?U:c.currentRevenue??'UNAVAILABLE'],['발행 기준일',c.issuedAt??'UNAVAILABLE'],['발행본 종류',c.issuedKind??'UNAVAILABLE'],['현재 조회 기준일',c.asOf],['검증 결과',c.status]]);
  }
  if (model.attribution) buildAttributionSheet(workbook, model);
  if (model.refundTracking) buildRefundTrackingSheet(workbook, model.refundTracking);
  buildRawSheet(workbook, model);
  if(model.salesTrace)addWeeklySalesTraceSheets(workbook,model.salesTrace);
  return workbook;
}

const GRADE_LABEL = { G1_AD_ID: "광고 ID 유입 확인", G2_AD_NAME: "광고명 후보 (합산 안 함)" };
// Meta click/view purchases per ad next to Cafe24 orders; candidates are counted, never summed.
function buildAttributionSheet(workbook, model) {
  const sheet = workbook.addWorksheet("META_ATTRIBUTION");
  setupSheet(sheet, [["adId", "광고 ID"], ["adName", "광고명"], ["clickPurchases", "Meta 클릭 구매 (7일)"], ["clickValue", "Meta 클릭 매출"], ["viewPurchases", "Meta 노출 구매 (1일)"], ["viewValue", "Meta 노출 매출"], ["g1", `Cafe24 ${GRADE_LABEL.G1_AD_ID}`], ["g1Revenue", "확인 매출 (정상+클레임)"], ["g2", GRADE_LABEL.G2_AD_NAME]].map(([key, header]) => ({ key, header, width: 20 })));
  const a = model.attribution, ok = a.completeness === "COMPLETE", U = "미검증";
  const rows = model.actualProducts?.available ? model.actualProducts.rows.filter((r, i, all) => all.findIndex(x => x.order_id === r.order_id) === i) : [];
  for (const ad of model.ads || []) {
    const split = a.ads?.[ad.adId], mine = grade => rows.filter(r => r.attribution_grade === grade && r.matched_ad_id === ad.adId);
    sheet.addRow({ adId: ad.adId, adName: ad.adName, clickPurchases: ok ? split?.click.purchases ?? 0 : U, clickValue: ok ? split?.click.value ?? 0 : U, viewPurchases: ok ? split?.view.purchases ?? 0 : U, viewValue: ok ? split?.view.value ?? 0 : U,
      g1: model.actualProducts?.available ? mine("G1_AD_ID").length : U, g1Revenue: model.actualProducts?.available ? mine("G1_AD_ID").reduce((s, r) => s + Number(r.actual_paid_amount || 0), 0) : U, g2: model.actualProducts?.available ? mine("G2_AD_NAME").length : U });
  }
  if (ok) sheet.addRow({ adId: "합계", clickPurchases: a.totals.click.purchases, clickValue: a.totals.click.value, viewPurchases: a.totals.view.purchases, viewValue: a.totals.view.value });
  else sheet.addRow({ adId: `미검증 — ${(a.reasons || []).join(", ")}` });
  sheet.addRow({ adId: "노출 구매는 클릭이 없어 Cafe24 주문과 연결할 수 없는 구조입니다. G1은 Cafe24 Analytics의 광고 ID 유입 기록이며 Meta 개별 구매 이벤트와 일대일 대응이 아닙니다." });
  for (const key of ["clickValue", "viewValue", "g1Revenue"]) sheet.getColumn(key).numFmt = WON_FMT;
}

// Recent issued weeks re-read by order number; issued files are never modified. "이번 반영액" is what this
// report adds on top of what earlier issued reports already adjusted (refund ledger), so nothing twice.
const LEDGER_LABEL = { NEW: "최초 반영", PREVIOUSLY_REPORTED: "이전 반영", UNKNOWN: "미확인 (합산 안 함)", LEDGER_UNVERIFIED: "장부 미검증 (합산 안 함)" };
function buildRefundTrackingSheet(workbook, t) {
  const sheet = workbook.addWorksheet("REFUND_TRACKING");
  setupSheet(sheet, [["period", "발행 기간"], ["kind", "발행본 종류"], ["orderId", "주문번호"], ["issuedAmount", "발행 금액"], ["currentAmount", "현재 금액"], ["adjustment", "누적 조정액"], ["refundDate", "취소·환불일"], ["status", "검증 결과"], ["ledger", "장부 판정"], ["applied", "이번 반영액"]].map(([key, header]) => ({ key, header, width: 20 })));
  if (t.error) sheet.addRow({ period: `미검증 — ${t.error}` });
  if (t.ledgerError) sheet.addRow({ period: `정정 장부 미검증 — ${t.ledgerError} · 이번 보고서는 새 정정을 반영하지 않음` });
  for (const p of t.periods || []) {
    const period = `${p.since} ~ ${p.until}`;
    if (!p.rows.length) { sheet.addRow({ period, kind: p.kind, status: p.error ? `미검증 — ${p.error}` : p.status }); continue; }
    for (const r of p.rows) sheet.addRow({ period, kind: p.kind, orderId: r.orderId, issuedAmount: r.issuedAmount, currentAmount: r.currentAmount, adjustment: r.adjustment, refundDate: r.refundDate, status: r.status,
      ledger: r.ledger === "PREVIOUSLY_REPORTED" && r.reportedIn ? `이전 반영 (${r.reportedIn} 발행본)` : LEDGER_LABEL[r.ledger] || r.ledger, applied: r.applied ?? null });
  }
  sheet.addRow({ period: `최근 ${t.weeks || 8}주 발행 주문 · 이번 반영액 = 누적 조정액 − 이전 발행본 장부 반영액 · 미확인은 합계 제외 · 직전 주는 ISSUED_COMPARISON과 같은 대조 결과` });
  for (const key of ["issuedAmount", "currentAmount", "adjustment", "applied"]) sheet.getColumn(key).numFmt = WON_FMT;
}

// ---------------------------------------------------------------------------
// Output path + atomic, non-clobbering local save (identical discipline to Naver's)
// ---------------------------------------------------------------------------

export function resolveMetaWeeklyReportOutputDir(env = process.env) {
  const workDir = resolve(env.WORK_DIR || join(root, "work"));
  return resolve(env.META_ADS_WEEKLY_REPORT_DIR || join(workDir, "reports", "meta-ads-weekly"));
}

export function metaWeeklyReportFileName(since, until) {
  return `META_ADS_WEEKLY_${since}_${until}.xlsx`;
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

export async function writeMetaWeeklyReportFile(workbook, { since, until, outputDir }) {
  await mkdir(outputDir, { recursive: true });
  const fileName = metaWeeklyReportFileName(since, until);
  const finalPath = await resolveVersionedOutputPath(outputDir, fileName);
  const tempPath = join(outputDir, `.meta-ads-weekly-${process.pid}-${randomUUID()}.tmp.xlsx`);
  await workbook.xlsx.writeFile(tempPath);
  try {
    const validation = new ExcelJS.Workbook();
    await validation.xlsx.readFile(tempPath);
    const sheetNames = validation.worksheets.map((sheet) => sheet.name);
    for (const required of ["SUMMARY", "CAMPAIGN", "AD SET", "CREATIVE_AD", "TREND", "AI_ANALYSIS", "ACTUAL_PRODUCTS_SOLD", "RAW"]) {
      if (!sheetNames.includes(required)) throw new Error(`Generated workbook is missing sheet: ${required}`);
    }
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
  await rename(tempPath, finalPath);
  return finalPath;
}

// Click (7d_click) + view (1d_view) must add back up to the weekly Meta totals, else the split is not shown.
export function checkAttributionSplit(split, summary) {
  if (!split || split.completeness !== "COMPLETE" || !split.totals) return { completeness: "UNAVAILABLE", reasons: split?.reasons || ["ATTRIBUTION_REQUEST_FAILED"], ads: {} };
  const { click, view } = split.totals, cents = v => Math.round(Number(v || 0) * 100);
  const matches = click.purchases + view.purchases === Number(summary?.purchases) && cents(click.value) + cents(view.value) === cents(summary?.purchaseValue);
  return matches ? split : { ...split, completeness: "MISMATCH", reasons: ["CLICK_PLUS_VIEW_NOT_EQUAL_TOTAL"] };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function generateWeeklyMetaAdsReport({ referenceDateKey, period, onePage = false, requireCompleteData = false, fetchByLevel, fetchActualOrders, fetchActualAnalytics, fetchAccountTotals, fetchAttribution, fetchRefundOrders, fetchItemPayments, fetchMetaProducts, fetchAdTracking, adGrades = requireCompleteData, outputDir, env = process.env, saveReport, publicationMode = referenceDateKey && onePage && requireCompleteData ? 'auto' : 'draft', now = () => new Date() } = {}) {
  // The existing scheduler supplies referenceDateKey + strict onePage; library calls remain drafts.
  const generatedAt = now().toISOString();
  if (typeof fetchByLevel !== "function") throw new Error("generateWeeklyMetaAdsReport requires fetchByLevel(since, until, level)");
  // Explicit report periods do not change the established scheduler's default week.
  if (period && (!/^\d{4}-\d{2}-\d{2}$/.test(period.since || '') || !/^\d{4}-\d{2}-\d{2}$/.test(period.until || '') || Date.parse(period.until) - Date.parse(period.since) !== 6 * 86400000 || [period.since,period.until].some(d => !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10) !== d))) throw new Error('Explicit Meta report period must be seven valid consecutive dates.');
  const { since, until } = period || previousMondayToSundayRange(referenceDateKey);
  const { since: previousSince, until: previousUntil } = previousWeekRange({ since, until });

  const issuedOutputDir = outputDir || resolveMetaWeeklyReportOutputDir(env);
  const scheduled = scheduledMetaPublication({at:new Date(generatedAt),since,until,mode:publicationMode,onePage,requireCompleteData});
  if (['auto','scheduled'].includes(publicationMode) && !scheduled) return {ok:false,since,until,filePath:null,publication:null,error:'AUTO_PUBLICATION_WINDOW_CLOSED'};
  if (scheduled) {
    const storage = await inspectIssuedStorage({outputDir:issuedOutputDir,env});
    if (!storage.ok) return {ok:false,since,until,filePath:null,publication:null,error:'ISSUED_STORAGE_UNVERIFIED'};
    try {
      const prior = await readIssuedMetaReport({outputDir:issuedOutputDir,since,until});
      if (prior) return {ok:true,since,until,filePath:prior.filePath,publication:{...prior,alreadyIssued:true}};
    } catch { return {ok:false,since,until,filePath:null,publication:null,error:'ISSUED_REPORT_INVALID'}; }
  }
  const [current, previous] = await Promise.all([
    fetchAllMetaLevels(since, until, fetchByLevel),
    fetchAllMetaLevels(previousSince, previousUntil, fetchByLevel)
  ]);

  let actualOrders;
  let actualAnalytics;

  if (levelOk(current.campaign)) {
    if (fetchActualOrders) {
      try {
        actualOrders = await fetchActualOrders(since, until, { includeAnalyticsOrders: true });
      } catch {
        actualOrders = { ok: false };
      }
    }

    if (fetchActualAnalytics) {
      try {
        actualAnalytics = await fetchActualAnalytics(since, until);
      } catch {
        actualAnalytics = { ok: false };
      }
    }
  }

  const extra={};
  if(levelOk(current.campaign))for(const [key,fetcher]of [['payments',fetchItemPayments],['metaProducts',fetchMetaProducts],['tracking',fetchAdTracking]]){
    if(typeof fetcher==='function')try{extra[key]=await fetcher(since,until,{actualOrders,ads:current.ad?.rows||[]});}catch{extra[key]={completeness:'UNAVAILABLE',rows:[]};}
  }
  const model = buildWeeklyMetaReportModel({
    current,
    previous,
    since,
    until,
    previousSince,
    previousUntil,
    actualOrders,
    actualAnalytics,
    adGrades,
    ...extra
  });
  if (!model.ok) {
    return { ok: false, since, until, error: model.error, filePath: null };
  }

  let previousOrders, previousAnalytics;
  if (requireCompleteData) {
    if (![current, previous].every(levels => LEVELS.every(level => levelOk(levels[level]))) || !model.actualProducts.available) {
      return { ok: false, since, until, error: "Incomplete Meta performance or Cafe24 actual attribution data; report was not saved.", filePath: null };
    }
    try {
      previousOrders = await fetchActualOrders(previousSince, previousUntil, { includeAnalyticsOrders: true });
      previousAnalytics = await fetchActualAnalytics(previousSince, previousUntil);
    } catch { /* Explicitly fail below rather than save an incomplete report. */ }
    model.previousActualProducts = buildActualProductsSold({ data: previousOrders, analytics: previousAnalytics, metaAds: previous.ad.rows, since: previousSince, until: previousUntil, adGrades });
    if (!model.previousActualProducts.available) return { ok: false, since, until, error: "Previous Cafe24 actual attribution data unavailable; report was not saved.", filePath: null };
  }

  let comparison = null;
  if (requireCompleteData) {
    let issued;
    try { issued = await readIssuedMetaReport({outputDir:issuedOutputDir,since:previousSince,until:previousUntil}); }
    catch { return {ok:false,since,until,filePath:null,publication:null,error:'PREVIOUS_ISSUED_REPORT_INVALID'}; }
    comparison = reconcileMetaPublication({issued,currentProducts:model.previousActualProducts,currentOrders:previousOrders,asOf:now().toISOString()});
    model.previousPublicationComparison = comparison;
  }
  // Account-level totals only upgrade an UNKNOWN level when every additive metric matches; a failed
  // account request leaves the level UNKNOWN.
  const accountTotals = {};
  if (requireCompleteData && fetchAccountTotals) {
    for (const [name, s, u] of [['current', since, until], ['previous', previousSince, previousUntil]]) {
      try { accountTotals[name] = await fetchAccountTotals(s, u); } catch { accountTotals[name] = null; }
    }
  }
  // Supplementary views: a failure is shown as 미검증 in its own section and never blocks publication.
  if (requireCompleteData && fetchAttribution) model.attribution = checkAttributionSplit(await Promise.resolve().then(() => fetchAttribution(since, until)).catch(() => null), model.summary);
  if (requireCompleteData && fetchRefundOrders) {
    try { model.refundTracking = await trackIssuedRefunds({ outputDir: issuedOutputDir, before: since, weeks: 8, fetchOrders: fetchRefundOrders, asOf: now().toISOString(), previous: { since: previousSince, comparison } }); }
    catch (error) { model.refundTracking = { error: String(error?.message || error), periods: [] }; }
  }
  const review = reviewMetaPublication({model,current,previous,actualOrders,actualAnalytics,previousOrders,previousAnalytics,comparison,accountTotals});
  if (scheduled && review.result === 'FAIL') return {ok:false,since,until,filePath:null,publication:null,review,comparison,error:'AUTO_REVIEW_FAILED'};
  if (requireCompleteData) model.verification = {result:review.result,unknowns:review.unknowns,failures:review.failures,actual:review.actual,mode:scheduled?'scheduled':publicationMode};
  const workbook = await buildWeeklyMetaReportWorkbook(model, { onePage });
  if (scheduled) {
    const record = publicationRecord({model,actualOrders,generatedAt,reviewedAt:now().toISOString(),review});
    const publication = await storeIssuedMetaReport({outputDir:issuedOutputDir,workbook,record,save:saveReport ? () => saveReport(workbook,{since,until,env}) : null});
    return {ok:true,since,until,...publication.delivery,filePath:publication.delivery?.filePath||publication.filePath,publication,review,comparison};
  }
  if (saveReport) {
    const saved = await saveReport(workbook, { since, until, env });
    return { ok: true, since, until, ...saved, publication:null, review, comparison };
  }

  const resolvedOutputDir = outputDir || resolveMetaWeeklyReportOutputDir(env);
  const filePath = await writeMetaWeeklyReportFile(workbook, { since, until, outputDir: resolvedOutputDir });
  return { ok: true, since, until, filePath, publication:null, review, comparison };
}

// ---------------------------------------------------------------------------
// Standalone CLI: node scripts/meta-ads-weekly-report.mjs [YYYY-MM-DD]
// ---------------------------------------------------------------------------

async function createServerFetcher() {
  const serverModule = await import("../server.mjs");
  if (typeof serverModule.buildMetaAdsSummaryForWeeklyReport !== "function") {
    throw new Error("server.mjs does not export buildMetaAdsSummaryForWeeklyReport — CLI cannot run standalone.");
  }
  return {
    fetchByLevel: serverModule.buildMetaAdsSummaryForWeeklyReport,
    fetchActualOrders: serverModule.fetchCafe24ActualOrdersForWeeklyReport,
    fetchActualAnalytics: serverModule.fetchCafe24AnalyticsForWeeklyReport,
    fetchItemPayments: serverModule.fetchCafe24ItemPaymentsForWeeklyReport,
    fetchMetaProducts: serverModule.fetchMetaProductsForWeeklyReport,
    fetchAdTracking: serverModule.fetchMetaAdTrackingForWeeklyReport
  };
}

async function main() {
  const referenceDateKey = process.argv[2] || undefined;
  const fetchers = await createServerFetcher();

  const result = await generateWeeklyMetaAdsReport({
    referenceDateKey,
    ...fetchers
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
