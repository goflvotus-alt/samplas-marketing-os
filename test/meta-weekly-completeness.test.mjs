import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import * as coverage from '../scripts/weekly-data-completeness.mjs';
import {mkdtemp,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateWeeklyMetaAdsReport} from '../scripts/meta-ads-weekly-report.mjs';
const src=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const extract=(start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start))).replaceAll('export ','');
const adapter=extract('export async function buildMetaAdsSummaryForWeeklyReport','// Query provenance is internal metadata');
test('weekly Meta adapter preserves coverage and source metadata without changing platform totals',async()=>{
 const input={source:'meta_marketing_api',since:'2026-10-06',until:'2026-10-12',level:'ad',coverage:{completeness:'PARTIAL',reasons:['NEXT_PAGE_PRESENT']},rows:[{purchaseValue:1720000}],totals:{purchaseValue:1720000}};
 const c={...coverage,buildMetaAdsSummaryWithCache:async()=>input,safeErrorMessage:()=> 'unavailable',summarizeMetaAdsRows:()=>{throw Error('must preserve totals');}};
 runInNewContext(adapter,c);const r=await c.buildMetaAdsSummaryForWeeklyReport('2026-10-06','2026-10-12','ad');
 assert.equal(r.coverage?.completeness,'PARTIAL');assert.equal(r.totals,input.totals);assert.equal(r.source,input.source);
});
const scope={since:'2026-10-06',until:'2026-10-12',level:'ad'};
const raw={spend:'100',impressions:'1000',clicks:'10',actions:[{action_type:'purchase',value:'1'}],action_values:[{action_type:'purchase',value:'198000'}]};
for(const [name,body,want] of [
 ['terminal response',{data:[raw]},'COMPLETE'],['explicit empty terminal response',{data:[]},'COMPLETE'],
 ['next page exists',{data:[raw],paging:{next:'not-retained'}},'PARTIAL'],['saturated first page',{data:Array(100).fill(raw)},'PARTIAL'],
 ['missing raw metric despite legacy zero filling',{data:[{...raw,spend:undefined}]},'UNKNOWN'],['missing action fields',{data:[{...raw,action_values:undefined}]},'UNKNOWN'],
 ['error envelope',{error:{message:'not retained'}},'UNAVAILABLE'],['missing data array',{},'UNAVAILABLE'],['upstream partial',{data:[raw],meta:{completeness:'PARTIAL'}},'PARTIAL']
])test('Meta coverage: '+name,()=>{const r=coverage.metaInsightsCoverage(body,scope);assert.equal(r.completeness,want);assert.ok(!JSON.stringify(r).includes('not-retained'));});
test('legacy, stale, fallback and wrong-period caches remain UNKNOWN, exact fresh evidence survives',()=>{
 const c=coverage.metaInsightsCoverage({data:[raw]},scope);
 const fresh={source:'meta_marketing_api_cached',...scope,coverage:c,cacheAgeMs:1000,ttlMs:60000};
 assert.equal(coverage.metaWeeklyCoverage(fresh,scope).completeness,'COMPLETE');
 for(const d of [{...fresh,coverage:undefined},{...fresh,cacheAgeMs:60001},{...fresh,cacheMode:'fallback_after_error'},{...fresh,until:'2026-10-19'}])assert.equal(coverage.metaWeeklyCoverage(d,scope).completeness,'UNKNOWN');
});
test('strict Orders reader records actual terminal page, pages and requested bound',async()=>{
 const reader=extract('async function cafe24GetOrders(','async function cafe24FetchOrdersPage');
 for(const [count,want,pages] of [[101,'COMPLETE',2],[500,'PARTIAL',5]]){
  const c={...coverage,URL,env:{CAFE24_MALL_ID:'fixture'},attachCafe24OrderItems:async()=>{},cafe24FetchOrdersPage:async u=>({orders:Array.from({length:Math.min(100,count-Number(u.searchParams.get('offset')))},(_,n)=>({order_id:String(Number(u.searchParams.get('offset'))+n),order_date:'2026-10-11'}))})};
  runInNewContext(reader,c);const r=await c.cafe24GetOrders(scope.since,scope.until,{strictOrders:true,limit:500});
  assert.equal(r.coverage.completeness,want);assert.equal(r.coverage.observed.pages,pages);assert.equal(r.orders.length,count);
 }
});
test('Analytics distinguishes terminal, partial, missing shape and invalid acquisition rows',()=>{
 const row={order_id:'1',order_date:'2026-10-11',order_amount:198000,ad:'',medium:'',campaign:'',content:'',keyword:''};
 for(const [body,want] of [[{orderdetails:[{...row,medium:undefined}]},'UNKNOWN'],[{orderdetails:[row]},'COMPLETE'],[{orderdetails:[]},'COMPLETE'],[{orderdetails:Array(100).fill(row)},'PARTIAL'],[{orderdetails:[row],total_count:2},'PARTIAL'],[{},'UNAVAILABLE'],[{orderdetails:[{...row,order_id:null}]},'UNKNOWN'],[{orderdetails:[row],completeness:'UNKNOWN'},'UNKNOWN']])assert.equal(coverage.cafe24AnalyticsCoverage(body,scope).completeness,want);
});
test('failed Meta adapter returns UNAVAILABLE, without upstream raw error text',async()=>{
 const c={...coverage,buildMetaAdsSummaryWithCache:async()=>{throw Error('FAKE_SECRET');},safeErrorMessage:()=> 'unavailable'};
 runInNewContext(adapter,c);const r=await c.buildMetaAdsSummaryForWeeklyReport(scope.since,scope.until,'ad');assert.equal(r.completeness,'UNAVAILABLE');assert.equal(r.ok,false);assert.ok(!JSON.stringify(r).includes('FAKE_SECRET'));
});

test('real collector functions and adapters deliver evidence through review to immutable issuance; partial and missing evidence block',async()=>{
 const reader=extract('async function cafe24GetOrders(','async function cafe24FetchOrdersPage');
 const analyticsReader=extract('async function fetchCafe24AnalyticsOrderDetails','async function attachCafe24OrderItems(');
 const weekly=extract('const META_WEEKLY_TRACKING_CODES','async function runMetaWeeklyReportCheck()');
 const metaCollector=extract('async function buildMetaAdsSummary(since','// Performance Score Rule Engine');
 const order={order_id:'20261011-0000055',order_date:'2026-10-11',paid:'T',canceled:'F',actual_order_amount:{payment_amount:'198000.00'},items:[{order_item_code:'item1',product_name:'Test jeans',product_price:'198000.00',quantity:1}]};
 for(const state of ['complete','partial','missing','missing_acquisition']){
  const c={...coverage,URL,env:{CAFE24_MALL_ID:'fixture',CAFE24_ACCESS_TOKEN:'not-a-real-token'},workDir:'fixture',join:(...s)=>s.join('/'),mkdir:async()=>{},writeFile:async()=>{},ensureCafe24AccessToken:async()=>{},attachCafe24OrderItems:async()=>{},
   cafe24FetchOrdersPage:async u=>({orders:u.searchParams.get('start_date')===scope.since&&!u.searchParams.has('inflow_path')?[order]:[]}),
   fetch:async u=>({ok:true,status:200,text:async()=>JSON.stringify({orderdetails:u.searchParams.get('start_date')===scope.since?[{order_id:order.order_id,order_date:order.order_date,order_amount:198000,ad:'ig',medium:state==='missing_acquisition'?undefined:'paid',campaign:'camp1',content:'ad1',keyword:''}]:[]})}),
   cleanAdAccountId:()=> 'act_fixture',metaAdsLevel:x=>x,metaAdsFieldsForLevel:()=>[],graphGet:async()=>state==='missing'?{data:[{...raw,action_values:undefined}]}:{data:[{...raw,ad_id:'ad1'}],...(state==='partial'?{paging:{next:'not-retained'}}:{})},logMetaAdsDiagnostic:async()=>{},fetchCampaignObjectives:async()=>({}),
   actionValue:(a,k)=>Number((a||[]).find(x=>x.action_type===k)?.value||0),normalizeMetaObjective:()=>'',metaCampaignStatusLabel:()=>'',metaAdsLabelForLevel:()=>'',buildMetaAdsTopRows:()=>[],buildMetaAdsLowRows:()=>[],summarizeMetaAdsRows:()=>({spend:100,impressions:1000,clicks:10,purchases:1,purchaseValue:198000}),metaAdsCacheFileName:()=> 'unused',safeErrorMessage:()=> 'unavailable'};
  runInNewContext(reader+'\n'+analyticsReader+'\n'+weekly+'\n'+metaCollector+'\n'+adapter,c);
  c.buildMetaAdsSummaryWithCache=c.buildMetaAdsSummary;
  c.fetchCafe24Orders=async(s,u,o)=>{const r=await c.cafe24GetOrders(s,u,{...o,strictOrders:true});return {...r,source:'cafe24_admin_api_inflow'};};
  const outputDir=await mkdtemp(join(tmpdir(),'coverage-chain-'));
  const r=await generateWeeklyMetaAdsReport({outputDir,env:{},referenceDateKey:'2026-10-13',period:{since:scope.since,until:scope.until},onePage:true,requireCompleteData:true,now:()=>new Date('2026-10-13T01:00:00Z'),fetchByLevel:c.buildMetaAdsSummaryForWeeklyReport,fetchActualOrders:c.fetchCafe24ActualOrdersForWeeklyReport,fetchActualAnalytics:c.fetchCafe24AnalyticsForWeeklyReport});
  // Known gaps (partial pages) block; unverifiable evidence is issued only as UNKNOWN.
  assert.equal(r.ok,state!=='partial',JSON.stringify(r.review||r));
  assert.equal(r.review.result,{complete:'PASS',partial:'FAIL',missing:'UNKNOWN',missing_acquisition:'UNKNOWN'}[state]);
  const manifest=join(outputDir,'issued','2026-10-06_2026-10-12','manifest.json');
  if(state!=='partial'){await access(manifest);assert.equal(r.publication.summary.metaPaidRevenue,state==='missing_acquisition'?0:198000);assert.equal(r.publication.review.result,r.review.result);}else await assert.rejects(access(manifest));
 }
});
