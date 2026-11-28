// One manual preview entry point. Uses the scheduled generators and their adapters;
// scheduler state is intentionally not accepted here, so previews cannot mark a week done.
import { calendarMonthPeriod, isReportDate } from './report-period.mjs';
import { fetchReportAnalyticsRange } from './weekly-data-completeness.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateWeeklyNaverAdsReport, resolveWeeklyReportOutputDir, weeklyReportFileName, seoulDateKey, previousTuesdayToMondayRange } from './naver-ads-weekly-report.mjs';
import { generateWeeklyInstagramReport, resolveInstagramWeeklyReportOutputDir, instagramWeeklyReportFileName } from './instagram-weekly-report.mjs';
import { generateWeeklyMetaAdsReport, resolveMetaWeeklyReportOutputDir, metaWeeklyReportFileName } from './meta-ads-weekly-report.mjs';
import { resolveWeeklyReportDestination, resolvePlatformDropboxDestination, dropboxWeeklyReportDir, saveWeeklyReportToDropboxAtPath } from './dropbox-report-uploader.mjs';

class WeeklyPreviewError extends Error {
  constructor(message,status) {super(message);this.status=status;}
}
function requestError(message,status=400) {return new WeeklyPreviewError(message,status);}
export function validateWeeklyPreviewRequest(body) {
  if(!body||!['meta','instagram','naver'].includes(body.platform))throw requestError('invalid_platform');
  const correction=body.mode==='correction' && body.platform==='meta' && body.month==='2026-10';
  if(body.mode!=='preview'&&!correction)throw requestError('invalid_mode; preview only');
  if (body.month !== undefined && body.platform === 'naver') {
    const today = seoulDateKey();
    const start = typeof body.month === 'string' ? body.month + '-01' : '';
    if (body.platform !== 'naver' || !isReportDate(start) || start < '2025-01-01' || start >= today) throw requestError('invalid_preview_month');
    const previewUntil = body.month === today.slice(0, 7)
      ? new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10)
      : undefined;
    return { platform: 'naver', mode: 'preview', month: body.month, previewUntil };
  }
  const date=body.referenceDate||seoulDateKey();
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(`${date}T00:00:00Z`))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw requestError('invalid_reference_date');
  if (body.month !== undefined) {
    if (body.platform !== 'meta' || typeof body.month !== 'string' || !/^\d{4}-\d{2}$/.test(body.month) ||
        !isReportDate(body.month+'-01') || calendarMonthPeriod(body.month).until >= seoulDateKey()) throw requestError('invalid_closed_month');
    return {platform:body.platform,referenceDate:date,mode:correction?'correction':'preview',month:body.month};
  }
  return {platform:body.platform,referenceDate:date,mode:'preview'};
}
export async function runWeeklyReportPreview(body,{env={},fetchers,hasPersistentMetaConnection,upload=saveWeeklyReportToDropboxAtPath}={}) {
  const {platform,referenceDate,mode,month,previewUntil}=validateWeeklyPreviewRequest(body);
  if(platform==='meta'&&(!hasPersistentMetaConnection||!await hasPersistentMetaConnection()))throw requestError('persistent_meta_connection_required',503);
  const config={
    naver:{generate:generateWeeklyNaverAdsReport,fileName:weeklyReportFileName,outputDir:resolveWeeklyReportOutputDir,options:{fetchPerformance:fetchers?.naver,fetchAttribution:fetchers?.naverAttribution},destination:()=>({...resolveWeeklyReportDestination(env),dir:dropboxWeeklyReportDir(env)})},
    instagram:{generate:generateWeeklyInstagramReport,fileName:instagramWeeklyReportFileName,outputDir:resolveInstagramWeeklyReportOutputDir,options:{fetchRange:fetchers?.instagram},destination:()=>resolvePlatformDropboxDestination(env,{dirEnvKey:'DROPBOX_INSTAGRAM_WEEKLY_REPORT_DIR',defaultDir:'/SAMPLAS WORK/병구 작업/인스타그램 리포트'})},
    meta:{generate:generateWeeklyMetaAdsReport,fileName:metaWeeklyReportFileName,outputDir:resolveMetaWeeklyReportOutputDir,options:{publicationMode:mode==='correction'?'monthly':'preview',period:month?undefined:previousTuesdayToMondayRange(referenceDate),month,onePage:true,requireCompleteData:true,fetchByLevel:fetchers?.meta,fetchCustomerTypes:fetchers?.customerTypes,fetchAdTracking:fetchers?.metaTracking,fetchItemPayments:fetchers?.itemPayments,fetchMetaProducts:fetchers?.metaProducts,
      fetchActualOrders:month&&fetchers?.actualOrders?(s,u,args)=>fetchers.actualOrders(s,u,{...args,officialReport:true}):fetchers?.actualOrders,
      fetchActualAnalytics:month&&fetchers?.actualAnalytics?(s,u)=>fetchReportAnalyticsRange(s,u,fetchers.actualAnalytics):fetchers?.actualAnalytics,fetchAccountTotals:fetchers?.metaAccount,fetchAttribution:fetchers?.metaAttribution,fetchRefundOrders:fetchers?.refundOrders},destination:()=>resolvePlatformDropboxDestination(env,{dirEnvKey:'DROPBOX_META_WEEKLY_REPORT_DIR',defaultDir:'/SAMPLAS WORK/병구 작업/메타 광고/리포트'})}
  }[platform];
  const destination=config.destination();
  if(mode==='correction'&&destination.mode!=='dropbox')throw requestError('official_report_dropbox_required',503);
  if(destination.mode==='misconfigured')throw requestError('dropbox_partially_configured',503);
  const result=await config.generate({referenceDateKey:referenceDate,month,previewUntil,...config.options,env,saveReport:async(workbook,{since,until})=>{
    // Unique preview name + uploader's existing strict add contract protects official files.
    const baseName=config.fileName(since,until);
    const periodName=month?baseName.replace("_WEEKLY_","_MONTHLY_"):baseName;
    const fileName=periodName.replace(/\.xlsx$/i,mode==='correction'?'_CORRECTED.xlsx':`_PREVIEW_${randomUUID()}.xlsx`);
    if(mode==='correction'){
      const audit=workbook.getWorksheet('META_LEVEL_CHECK');
      const rows=audit?.getRows(2,5);
      if(rows?.length!==5||rows.some(row=>!['MATCH','MATCH_COVERAGE_UNVERIFIED'].includes(row.getCell('E').text))) {
        throw requestError('correction_level_totals_do_not_reconcile',409);
      }
      const scope=workbook.addWorksheet('CORRECTION');
      scope.addRows([
        ['Supersedes',periodName],
        ['Reason','Original Meta ad set and ad data used a different end date.'],
        ['Basis','Exact-period Meta Insights and current Cafe24 order evidence. Original workbook retained.']
      ]);
      scope.columns=[{width:17},{width:96}];
    }
    if(destination.mode==='dropbox')return upload(workbook,{targetPath:`${destination.dir.replace(/\/+$/,'')}/${fileName}`,env});
    const outputDir=config.outputDir(env);await mkdir(outputDir,{recursive:true});const filePath=join(outputDir,fileName);
    await writeFile(filePath,await workbook.xlsx.writeBuffer(),{flag:'wx'});return {filePath};
  }});
  return {ok:result.ok,platform,since:result.since,until:result.until,filePath:result.filePath??null,mode,...(mode==='correction'?{alreadyExists:result.alreadyExists===true}:{}),...(!result.ok?{error:result.error}:{})};
}
export async function handleWeeklyReportPreview(req,res,{authorized,readBody,json,run}) {
  if(req.method!=='POST')return json(res,{ok:false,error:'Method not allowed; POST only.'},405);
  if(!authorized(req))return json(res,{ok:false,error:'Unauthorized'},401);
  try {const result=await run(await readBody(req));return json(res,result,result.ok?200:502);}
  catch(error){
    // Only validation codes are returned. Upstream headers, tokens and data never leak.
    const expected=error instanceof WeeklyPreviewError;
    return json(res,{ok:false,error:expected?error.message:'weekly_preview_failed'},expected?error.status:502);
  }
}
