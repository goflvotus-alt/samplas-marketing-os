import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import ExcelJS from 'exceljs';
import {generateWeeklyMetaAdsReport} from '../scripts/meta-ads-weekly-report.mjs';
import {metaAccountTotalsCoverage,accountReconciles} from '../scripts/weekly-data-completeness.mjs';
import {extractLegacyMetaBaseline,readIssuedMetaReport} from '../scripts/meta-issued-report.mjs';
import {importLegacyMetaBaseline} from '../scripts/meta-legacy-baseline-import.mjs';
import {isWeeklyNaverReportDue,seoulDateKey,previousTuesdayToMondayRange} from '../scripts/naver-ads-weekly-report.mjs';

const codes=['meta_meantime_look','meta_ssage','meta_adv_catalog','meta_adv_image','meta_adv_video'];
const id='20261011-0000055';
const original={order_id:id,order_date:'2026-10-11T20:33:59+09:00',paid:'T',canceled:'F',actual_order_amount:{payment_amount:'198000.00'},items:[{order_item_code:id+'-01',product_name:'Test jeans',product_price:'198000.00',quantity:1,order_status:'N30',status_code:'N1'}]};
const refunded={...original,canceled:'T',cancel_date:'2026-10-19T12:27:28+09:00',return_confirmed_date:'2026-10-19T12:27:28+09:00',actual_order_amount:{payment_amount:'0.00'},items:[{...original.items[0],order_status:'R40',status_code:'C3',status_text:'반품완료',refund_date:'2026-10-19T12:27:42+09:00'}]};
const current={...original,order_id:'20261013-0000134',order_date:'2026-10-13',actual_order_amount:{payment_amount:'107000.00'},items:[{...original.items[0],order_item_code:'new-item',product_price:107000}]};
const actual=orders=>({coverage:{completeness:'COMPLETE'},source:'cafe24_inflow_queries',orders:[],trackingQueries:codes.map(code=>({code,ok:true,complete:true,count:0})),analyticsOrders:orders,analyticsOrdersComplete:true});
const acquisition=orders=>({coverage:{completeness:'COMPLETE'},ok:true,data:{orderdetails:orders.map(o=>({order_id:o.order_id,ad:'ig',medium:'paid',content:'ad1',order_amount:198000}))}});
const totals={spend:395661,impressions:47504,clicks:2166,purchases:14,purchaseValue:5192070,ctr:.0456,cpc:183,cpa:28262,roas:13.12};
// A level whose rows omitted action_values: collector marks it UNKNOWN, never zero-filled COMPLETE.
const omitted={completeness:'UNKNOWN',coverage:{kind:'meta_insights',completeness:'UNKNOWN',reasons:['RAW_METRICS_NOT_RETURNED']},source:'meta_marketing_api',rows:[{adId:'ad1',adName:'Test ad'}],totals};
const account=(scope,over={})=>({kind:'meta_account_totals',scope,completeness:'COMPLETE',reasons:[],observed:{},totals:{spend:395661,impressions:47504,clicks:2166,purchases:14,purchaseValue:5192070},...over});
const tmp=()=>mkdtemp(join(tmpdir(),'meta-recovery-'));
const book=async path=>{const w=new ExcelJS.Workbook();await w.xlsx.readFile(path);return w;};
function scheduled(outputDir,week,over={}){
 const first=week==='first',s=first?'2026-10-06':'2026-10-13',u=first?'2026-10-12':'2026-10-19';
 return {outputDir,env:{},referenceDateKey:first?'2026-10-13':'2026-10-20',period:{since:s,until:u},onePage:true,requireCompleteData:true,
  now:()=>new Date(first?'2026-10-13T01:00:00Z':'2026-10-20T01:00:00Z'),
  fetchByLevel:async()=>structuredClone(omitted),fetchAccountTotals:async(s,u)=>account({since:s,until:u}),
  fetchActualOrders:async s=>actual(s==='2026-10-06'?[first?original:refunded]:s==='2026-10-13'?[current]:[]),
  fetchActualAnalytics:async s=>acquisition(s==='2026-10-06'?[original]:s==='2026-10-13'?[current]:[]),
  saveReport:async()=>({filePath:'/no-dropbox/stub.xlsx',uploaded:false}),...over};
}

test('account totals: only a complete single-row, in-scope account response with action arrays is COMPLETE',()=>{
 const scope={since:'2026-10-13',until:'2026-10-19'};
 const row={date_start:scope.since,date_stop:scope.until,spend:'395661',impressions:'47504',clicks:'2166',actions:[{action_type:'purchase',value:'14'}],action_values:[{action_type:'purchase',value:'5192070'}]};
 const t={spend:395661,impressions:47504,clicks:2166,purchases:14,purchaseValue:5192070};
 assert.equal(metaAccountTotalsCoverage({data:[row]},scope,t).completeness,'COMPLETE');
 for(const [body,want] of [[{data:[{...row,action_values:undefined}]},'UNKNOWN'],[{data:[{...row,actions:undefined}]},'UNKNOWN'],[{data:[]},'UNKNOWN'],[{data:[row,row]},'UNKNOWN'],[{data:[row],paging:{next:'x'}},'UNKNOWN'],[{data:[{...row,date_stop:'2026-10-18'}]},'UNKNOWN'],[{error:{message:'x'}},'UNAVAILABLE']])
  assert.equal(metaAccountTotalsCoverage(body,scope,t).completeness,want);
 assert.equal(accountReconciles(t,account(scope),scope),true);
 assert.equal(accountReconciles({...t,purchaseValue:5192069},account(scope),scope),false);
 assert.equal(accountReconciles(t,account({since:'2026-10-06',until:'2026-10-12'}),scope),false);
 assert.equal(accountReconciles(t,account(scope,{completeness:'UNKNOWN'}),scope),false);
});

test('PASS: omitted action_values proven zero by matching account totals, published with PASS banner',async()=>{
 const outputDir=await tmp();const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second'));
 assert.equal(r.ok,true);assert.equal(r.review.result,'PASS',JSON.stringify(r.review));
 assert.equal(r.review.coverage['current.ad'],'COMPLETE_BY_ACCOUNT_TOTALS');
 assert.equal(r.publication.review.result,'PASS');
 assert.match(String((await book(r.publication.filePath)).getWorksheet('REPORT').getCell('A4').value),/^검증 PASS/);
});

for(const [name,fetchAccountTotals] of [
 ['account totals disagree',async(s,u)=>account({since:s,until:u},{totals:{spend:395661,impressions:47504,clicks:2166,purchases:15,purchaseValue:5300000}})],
 ['account totals themselves omit action values',async(s,u)=>account({since:s,until:u},{completeness:'UNKNOWN',totals:null})],
 ['account request fails',async()=>{throw Error('offline');}]
])test(`UNKNOWN: ${name} keeps the level unverified, published with reasons and no zero-filling`,async()=>{
 const outputDir=await tmp();const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second',{fetchAccountTotals}));
 assert.equal(r.ok,true);assert.equal(r.review.result,'UNKNOWN');assert.ok(r.review.unknowns.includes('current.ad:COVERAGE_UNKNOWN'));
 const page=(await book(r.publication.filePath)).getWorksheet('REPORT');
 assert.match(String(page.getCell('A4').value),/미검증\(UNKNOWN\) · 확정 수치 아님/);
 assert.match(String(page.getCell('A4').value),/0으로 대체하지 않음/);
 assert.match(String(page.getCell('A11').value),/^미검증 · /);
 assert.equal(page.getCell('A6').value,395661);
});

test('FAIL: a known gap blocks publication and the Dropbox callback is never called',async()=>{
 const outputDir=await tmp();let uploads=0;
 const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second',{fetchByLevel:async()=>({...structuredClone(omitted),completeness:'PARTIAL',coverage:{completeness:'PARTIAL'}}),saveReport:async()=>{uploads++;return {filePath:'x'};}}));
 assert.equal(r.ok,false);assert.equal(r.error,'AUTO_REVIEW_FAILED');assert.equal(r.review.result,'FAIL');assert.equal(uploads,0);
 await assert.rejects(access(join(outputDir,'issued','2026-10-13_2026-10-19')));
});

test('required collection failure blocks before review',async()=>{
 const outputDir=await tmp();let uploads=0;
 const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second',{fetchByLevel:async()=>({ok:false,error:'down',completeness:'UNAVAILABLE'}),saveReport:async()=>{uploads++;}}));
 assert.equal(r.ok,false);assert.equal(uploads,0);
});

test('preview carries a PREVIEW banner and never creates an issued record',async()=>{
 const outputDir=await tmp();let bytes;
 const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second',{publicationMode:'preview',saveReport:async w=>{bytes=Buffer.from(await w.xlsx.writeBuffer());return {filePath:'/x_PREVIEW_1.xlsx'};}}));
 assert.equal(r.ok,true);assert.equal(r.publication,null);
 const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);assert.match(String(w.getWorksheet('REPORT').getCell('A4').value),/^PREVIEW · 발행본 아님/);
 await assert.rejects(access(join(outputDir,'issued')));
});

// A workbook in the same layout as the delivered 2026-10-06~12 report (generated by the existing code).
async function legacyWorkbook(){
 let bytes;const outputDir=await tmp();
 await generateWeeklyMetaAdsReport(scheduled(outputDir,'first',{publicationMode:'preview',adGrades:false,saveReport:async w=>{bytes=Buffer.from(await w.xlsx.writeBuffer());return {filePath:'p'};}}));
 const file=join(outputDir,'META_ADS_WEEKLY_2026-10-06_2026-10-12_PRODUCTION_VERIFIED.xlsx');await writeFile(file,bytes);return {file,bytes};
}
const source={dropboxFileId:'id:GCgD4vfxn2IAAAAAAApDXQ',dropboxPath:'/SAMPLAS WORK/병구 작업/메타 광고/리포트/META_ADS_WEEKLY_2026-10-06_2026-10-12_PRODUCTION_VERIFIED.xlsx',serverModified:'2026-10-13T03:24:35Z'};

test('legacy dry-run records source id, hash, period and reported actual without writing or inventing items',async()=>{
 const {file,bytes}=await legacyWorkbook();const outputDir=await tmp();
 const r=await importLegacyMetaBaseline({file,source,now:()=>new Date('2026-10-20T06:00:00Z')});
 assert.equal(r.mode,'dry-run');const m=r.record;
 assert.equal(m.kind,'legacy_import');assert.equal(m.legacyImport,true);assert.equal(m.since,'2026-10-06');assert.equal(m.until,'2026-10-12');
 assert.equal(m.source.dropboxFileId,source.dropboxFileId);assert.match(m.source.sha256,/^[a-f0-9]{64}$/);assert.equal(m.source.size,bytes.length);
 assert.deepEqual(m.reportedActual.metaPaidRevenue,198000);assert.equal(m.summary.metaPaidOrderCount,1);
 assert.deepEqual(m.orders,[{orderId:id,orderDate:'2026-10-11',amount:198000,items:[]}]);
 assert.equal(m.importedAt,'2026-10-20T06:00:00.000Z');assert.equal(m.issuedAt,'2026-10-13T03:24:35.000Z');
 assert.deepEqual(await readdir(outputDir),[]);
});

test('10/11 198,000 payment refunded 10/19: legacy baseline keeps issued value and shows the refund adjustment',async()=>{
 const {file}=await legacyWorkbook();const outputDir=await tmp();
 const stored=await importLegacyMetaBaseline({file,source,write:true,outputDir,now:()=>new Date('2026-10-20T06:00:00Z')});
 const manifestBefore=await readFile(stored.manifestPath);
 const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second'));
 assert.equal(r.ok,true);assert.equal(r.review.result,'PASS',JSON.stringify(r.review));
 assert.equal(r.comparison.issuedKind,'legacy_import');assert.equal(r.comparison.issuedRevenue,198000);
 assert.equal(r.comparison.refundAdjustment,-198000);assert.equal(r.comparison.currentRevenue,0);
 const w=await book(r.publication.filePath),page=w.getWorksheet('REPORT');
 assert.equal(page.getCell('E23').value,198000);assert.match(String(page.getCell('I23').value),/legacy_import/);
 assert.equal(w.getWorksheet('REFUND_ADJUSTMENTS').getCell('A2').value,id);assert.equal(w.getWorksheet('REFUND_ADJUSTMENTS').getCell('D2').value,198000);
 assert.deepEqual(await readFile(stored.manifestPath),manifestBefore);
});

test('legacy registration refuses duplicates, tampered bytes and inconsistent totals',async()=>{
 const {file,bytes}=await legacyWorkbook();const outputDir=await tmp();
 await importLegacyMetaBaseline({file,source,write:true,outputDir});
 await assert.rejects(importLegacyMetaBaseline({file,source,write:true,outputDir}),/ISSUED_PERIOD_ALREADY_RECORDED/);
 await writeFile(join(outputDir,'issued','2026-10-06_2026-10-12','report.xlsx'),Buffer.concat([bytes,Buffer.from('x')]));
 await assert.rejects(readIssuedMetaReport({outputDir,since:'2026-10-06',until:'2026-10-12'}),/ISSUED_HASH_MISMATCH/);
 const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);
 const sold=w.getWorksheet('ACTUAL_PRODUCTS_SOLD');sold.getRow(2).getCell(sold.getRow(1).values.indexOf('actual_paid_amount')).value=99000;
 await assert.rejects(extractLegacyMetaBaseline(Buffer.from(await w.xlsx.writeBuffer())),/LEGACY_TOTAL_MISMATCH/);
 await assert.rejects(importLegacyMetaBaseline({file,source:{...source,dropboxFileId:'not-an-id'}}),/LEGACY_SOURCE_INVALID/);
});

test('fixed Tuesday 10:00 KST dry-run publishes locally with no Dropbox upload; a second run reuses the record',async()=>{
 const outputDir=await tmp();const calls=[];
 const opts=scheduled(outputDir,'second',{now:()=>new Date('2026-10-20T01:00:00Z'),saveReport:async(w,p)=>{calls.push(p);return {filePath:'/no-dropbox/stub.xlsx',uploaded:false};}});
 const first=await generateWeeklyMetaAdsReport(opts),again=await generateWeeklyMetaAdsReport(opts);
 assert.equal(first.ok,true);assert.equal(calls.length,1);assert.equal(again.publication.alreadyIssued,true);
 assert.equal(first.publication.since,'2026-10-13');assert.equal(first.publication.until,'2026-10-19');
});

// Real server scheduler + real generator/issued store; only network adapters and the clock are fakes.
async function schedulerHarness(outputDir,{fail={},uploads=[],logs=[]}={}){
 const src=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
 const opts=scheduled(outputDir,'second');let clock;
 const c={console:{log:l=>logs.push(l)},env:{},isWeeklyNaverReportDue,seoulDateKey,previousTuesdayToMondayRange,
  resolvePlatformDropboxDestination:()=>({mode:'dropbox',dir:'/SAMPLAS WORK/병구 작업/메타 광고/리포트'}),
  generateWeeklyMetaAdsReport:o=>generateWeeklyMetaAdsReport({...o,outputDir,now:()=>new Date(clock)}),
  buildMetaAdsSummaryForWeeklyReport:async(...a)=>fail.meta?.(clock)?{ok:false,error:'Meta HTTP 500',completeness:'UNAVAILABLE',coverage:{completeness:'UNAVAILABLE',reasons:['INSIGHTS_REQUEST_FAILED']}}:opts.fetchByLevel(...a),
  fetchCafe24ActualOrdersForWeeklyReport:async(...a)=>{if(fail.cafe24?.(clock))throw new Error('Cafe24 HTTP 401');return opts.fetchActualOrders(...a);},
  fetchCafe24ItemPaymentsForWeeklyReport:async()=>({rows:[],completeness:'UNAVAILABLE'}),
  fetchMetaProductsForWeeklyReport:async()=>({rows:[],completeness:'UNAVAILABLE'}),
  fetchMetaAdTrackingForWeeklyReport:async()=>({rows:[],completeness:'UNAVAILABLE'}),
  fetchCafe24AnalyticsForWeeklyReport:opts.fetchActualAnalytics,fetchMetaAccountTotalsForWeeklyReport:opts.fetchAccountTotals,fetchMetaAttributionForWeeklyReport:async()=>null,fetchCafe24OrdersForRefundTracking:async()=>null,
  saveWeeklyReportToDropboxAtPath:async(w,{targetPath})=>{if(fail.dropbox?.(clock))throw new Error('Dropbox upload failed (HTTP 503)');uploads.push(targetPath);return {filePath:targetPath,uploaded:true};},
  safeErrorMessage:e=>String(e?.message||e),logApiError:async()=>{}};
 runInNewContext(cut('const metaWeeklyReportScheduler = {','// Thin adapter')+'\n'+cut('async function runMetaWeeklyReportCheck()','// Instagram Weekly Report scheduler')+'\nthis.run=runMetaWeeklyReportCheck;this.state=()=>metaWeeklyReportScheduler;',c);
 const at=hhmm=>{clock=`2026-10-20T${hhmm}:00Z`;c.Date=class extends Date{constructor(...a){super(...(a.length?a:[clock]));}};return c.run();};
 return {at,state:c.state};
}
const minutes=(from,to)=>Array.from({length:to-from+1},(_,i)=>`0${1+Math.floor((from+i)/60)}:${String((from+i)%60).padStart(2,'0')}`);

test('Meta 10:00 / Cafe24 10:15 / Dropbox 10:30 failures: three attempts, no upload, no record, legacy intact',async()=>{
 const {file}=await legacyWorkbook();const outputDir=await tmp();
 const {manifestPath}=await importLegacyMetaBaseline({file,source,write:true,outputDir,now:()=>new Date('2026-10-20T00:30:00Z')});
 const before=await readFile(manifestPath),uploads=[],logs=[];
 const h=await schedulerHarness(outputDir,{uploads,logs,fail:{meta:t=>t<'2026-10-20T01:15',cafe24:t=>t<'2026-10-20T01:30',dropbox:()=>true}});
 for(const m of minutes(0,59))await h.at(m);
 assert.deepEqual(uploads,[]);assert.equal(h.state().lastRunSinceKey,null);
 assert.deepEqual(logs.map(l=>l.replace(/ for .*?: /,' | ')),[
  '[META_ADS_WEEKLY_REPORT] attempt 1/3 failed | Meta HTTP 500; next retry 10:15 KST',
  '[META_ADS_WEEKLY_REPORT] attempt 2/3 failed | Incomplete Meta performance or Cafe24 actual attribution data; report was not saved.; next retry 10:30 KST',
  '[META_ADS_WEEKLY_REPORT] attempt 3/3 failed | Dropbox upload failed (HTTP 503); no retry left this week']);
 assert.deepEqual((await readdir(join(outputDir,'issued'))).filter(d=>!d.startsWith('.')),['2026-10-06_2026-10-12']);
 assert.deepEqual(await readFile(manifestPath),before);
});

test('recovers at 10:30 after Meta and Dropbox failures: one upload; restart and later polls never re-upload',async()=>{
 const {file}=await legacyWorkbook();const outputDir=await tmp();
 const {manifestPath}=await importLegacyMetaBaseline({file,source,write:true,outputDir,now:()=>new Date('2026-10-20T00:30:00Z')});
 const before=await readFile(manifestPath),uploads=[];
 const fail={meta:t=>t<'2026-10-20T01:15',dropbox:t=>t<'2026-10-20T01:30'};
 const h=await schedulerHarness(outputDir,{uploads,fail});
 for(const m of minutes(0,59))await h.at(m);
 assert.deepEqual(uploads,['/SAMPLAS WORK/병구 작업/메타 광고/리포트/META_ADS_WEEKLY_2026-10-13_2026-10-19.xlsx']);
 assert.equal(h.state().lastRunSinceKey,'2026-10-13');
 const issued=await readIssuedMetaReport({outputDir,since:'2026-10-13',until:'2026-10-19'});assert.equal(issued.mode,'scheduled');
 const restarted=await schedulerHarness(outputDir,{uploads,fail}); // new process inside the 10:30 slot
 await restarted.at('01:40');
 assert.equal(uploads.length,1);assert.equal(restarted.state().lastRunSinceKey,'2026-10-13');
 assert.deepEqual(await readFile(manifestPath),before);
});

const unverifiedAnalytics=orders=>({...acquisition(orders),coverage:{completeness:'UNKNOWN',reasons:['ANALYTICS_ROW_INVALID']}});
const cmp=w=>Object.fromEntries(w.getWorksheet('ISSUED_COMPARISON').getSheetValues().filter(Boolean).map(r=>[r[1],r[2]]));
test('unverifiable current Cafe24 actuals show 미검증 on page one, never a computed amount or 0',async()=>{
 const outputDir=await tmp();
 const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second',{fetchActualAnalytics:async s=>s==='2026-10-13'?unverifiedAnalytics([current]):acquisition(s==='2026-10-06'?[original]:[])}));
 assert.equal(r.ok,true);assert.equal(r.review.result,'UNKNOWN');assert.equal(r.review.actual.current,false);assert.equal(r.review.actual.previous,true);
 const w=await book(r.publication.filePath),page=w.getWorksheet('REPORT');
 assert.equal(page.getCell('J10').value,'미검증');assert.match(String(page.getCell('J11').value),/확인 불가.*0원 아님/);
 assert.equal(page.getCell('C22').value,'미검증');assert.equal(page.getCell('C23').value,'미검증');
 assert.ok(!JSON.stringify(page.getRow(10).values).includes('107000'));
 assert.ok(JSON.stringify(w.getWorksheet('ACTUAL_PRODUCTS_SOLD').getSheetValues()).includes('0원으로 해석하지 말 것'));
 assert.equal(r.publication.summary.actualVerified,false);
});

test('a verified zero stays 0 with a PASS banner',async()=>{
 const outputDir=await tmp();
 const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[refunded]:[]),fetchActualAnalytics:async s=>acquisition(s==='2026-10-06'?[original]:[])}));
 assert.equal(r.review.result,'PASS',JSON.stringify(r.review));
 const page=(await book(r.publication.filePath)).getWorksheet('REPORT');
 assert.equal(page.getCell('J10').value,0);assert.equal(page.getCell('C23').value,0);assert.equal(r.publication.summary.actualVerified,true);
});

test('unverifiable previous reread: issued value kept, adjustment and current net shown as 미검증 on page one and comparison sheets',async()=>{
 const {file}=await legacyWorkbook();const outputDir=await tmp();
 await importLegacyMetaBaseline({file,source,write:true,outputDir});
 const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second',{fetchActualAnalytics:async s=>s==='2026-10-06'?unverifiedAnalytics([original]):acquisition(s==='2026-10-13'?[current]:[])}));
 assert.equal(r.review.result,'UNKNOWN');assert.equal(r.review.actual.previous,false);
 const w=await book(r.publication.filePath),page=w.getWorksheet('REPORT'),c=cmp(w);
 assert.equal(page.getCell('E23').value,198000);
 assert.match(String(page.getCell('D28').value),/후속 환불 조정 미검증 · 현재 기준 순매출 미검증/);
 assert.equal(c['발행 당시 매출'],198000);assert.equal(c['후속 환불 조정'],'미검증');assert.equal(c['현재 기준 순매출'],'미검증');
 const adj=w.getWorksheet('REFUND_ADJUSTMENTS');assert.equal(adj.getCell('H2').value,'미검증');assert.equal(adj.getCell('I2').value,'미검증');
});

test('a week issued with unverified actuals is shown as 미검증 when it becomes the previous week',async()=>{
 const outputDir=await tmp();
 const first=await generateWeeklyMetaAdsReport(scheduled(outputDir,'first',{fetchActualAnalytics:async s=>s==='2026-10-06'?unverifiedAnalytics([original]):acquisition([])}));
 assert.equal(first.publication.summary.actualVerified,false);
 const r=await generateWeeklyMetaAdsReport(scheduled(outputDir,'second'));
 const w=await book(r.publication.filePath),c=cmp(w);
 assert.equal(r.comparison.issuedVerified,false);assert.equal(w.getWorksheet('REPORT').getCell('E23').value,'미검증');
 assert.equal(c['발행 당시 매출'],'미검증');assert.equal(c['후속 환불 조정'],'미검증');assert.equal(c['현재 기준 순매출'],0);
});
