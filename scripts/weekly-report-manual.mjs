// One manual preview entry point. Uses the scheduled generators and their adapters;
// scheduler state is intentionally not accepted here, so previews cannot mark a week done.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateWeeklyNaverAdsReport, resolveWeeklyReportOutputDir, weeklyReportFileName, seoulDateKey } from './naver-ads-weekly-report.mjs';
import { generateWeeklyInstagramReport, resolveInstagramWeeklyReportOutputDir, instagramWeeklyReportFileName } from './instagram-weekly-report.mjs';
import { generateWeeklyMetaAdsReport, resolveMetaWeeklyReportOutputDir, metaWeeklyReportFileName } from './meta-ads-weekly-report.mjs';
import { resolveWeeklyReportDestination, resolvePlatformDropboxDestination, dropboxWeeklyReportDir, saveWeeklyReportToDropboxAtPath } from './dropbox-report-uploader.mjs';

class WeeklyPreviewError extends Error {
  constructor(message,status) {super(message);this.status=status;}
}
function requestError(message,status=400) {return new WeeklyPreviewError(message,status);}
export function validateWeeklyPreviewRequest(body) {
  if(!body||!['meta','instagram','naver'].includes(body.platform))throw requestError('invalid_platform');
  if(body.mode!=='preview')throw requestError('invalid_mode; preview only');
  const date=body.referenceDate||seoulDateKey();
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(`${date}T00:00:00Z`))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw requestError('invalid_reference_date');
  return {platform:body.platform,referenceDate:date,mode:'preview'};
}
export async function runWeeklyReportPreview(body,{env={},fetchers,hasPersistentMetaConnection,upload=saveWeeklyReportToDropboxAtPath}={}) {
  const {platform,referenceDate,mode}=validateWeeklyPreviewRequest(body);
  if(platform==='meta'&&(!hasPersistentMetaConnection||!await hasPersistentMetaConnection()))throw requestError('persistent_meta_connection_required',503);
  const config={
    naver:{generate:generateWeeklyNaverAdsReport,fileName:weeklyReportFileName,outputDir:resolveWeeklyReportOutputDir,options:{fetchPerformance:fetchers?.naver},destination:()=>({...resolveWeeklyReportDestination(env),dir:dropboxWeeklyReportDir(env)})},
    instagram:{generate:generateWeeklyInstagramReport,fileName:instagramWeeklyReportFileName,outputDir:resolveInstagramWeeklyReportOutputDir,options:{fetchRange:fetchers?.instagram},destination:()=>resolvePlatformDropboxDestination(env,{dirEnvKey:'DROPBOX_INSTAGRAM_WEEKLY_REPORT_DIR',defaultDir:'/SAMPLAS WORK/병구 작업/인스타그램 리포트'})},
    meta:{generate:generateWeeklyMetaAdsReport,fileName:metaWeeklyReportFileName,outputDir:resolveMetaWeeklyReportOutputDir,options:{fetchByLevel:fetchers?.meta,fetchActualOrders:fetchers?.actualOrders,fetchActualAnalytics:fetchers?.actualAnalytics},destination:()=>resolvePlatformDropboxDestination(env,{dirEnvKey:'DROPBOX_META_WEEKLY_REPORT_DIR',defaultDir:'/SAMPLAS WORK/병구 작업/메타 광고/리포트'})}
  }[platform];
  const destination=config.destination();
  if(destination.mode==='misconfigured')throw requestError('dropbox_partially_configured',503);
  const result=await config.generate({referenceDateKey:referenceDate,...config.options,env,saveReport:async(workbook,{since,until})=>{
    // Unique preview name + uploader's existing strict add contract protects official files.
    const fileName=config.fileName(since,until).replace(/\.xlsx$/i,`_PREVIEW_${randomUUID()}.xlsx`);
    if(destination.mode==='dropbox')return upload(workbook,{targetPath:`${destination.dir.replace(/\/+$/,'')}/${fileName}`,env});
    const outputDir=config.outputDir(env);await mkdir(outputDir,{recursive:true});const filePath=join(outputDir,fileName);
    await writeFile(filePath,await workbook.xlsx.writeBuffer(),{flag:'wx'});return {filePath};
  }});
  return {ok:result.ok,platform,since:result.since,until:result.until,filePath:result.filePath??null,mode,...(!result.ok?{error:result.error}:{})};
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
