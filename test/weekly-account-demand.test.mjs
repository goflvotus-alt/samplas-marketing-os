import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { collectWeeklyAccount, exactTotal, captureWeeklyFollowers, demandCandidates, exactDemand, buildSearchDemand } from '../scripts/weekly-account-demand.mjs';
import { buildWeeklyInstagramReportModel, buildWeeklyInstagramReportWorkbook } from '../scripts/instagram-weekly-report.mjs';
import { buildWeeklyReportModel, buildWeeklyReportWorkbook } from '../scripts/naver-ads-weekly-report.mjs';
const dates={since:'2026-09-29',until:'2026-10-05',previousSince:'2026-09-22',previousUntil:'2026-09-28'};
test('Account exact range, separate current/prior and independent partial failures',async()=>{
 const calls=[];const fetchMetric=async(metric,since,until)=>{calls.push([metric,since,until]);if(metric==='website_clicks')throw Error('private-token');return [{name:metric,total_value:{value:metric==='profile_views'?0:111},values:[{value:999}]}];};
 const current=await collectWeeklyAccount({...dates,fetchMetric}),prior=await collectWeeklyAccount({since:dates.previousSince,until:dates.previousUntil,fetchMetric});
 assert.equal(current.reach,111);assert.equal(current.profile_views,0);assert.equal(current.website_clicks,null);assert(!JSON.stringify(current).includes('private-token'));assert.equal(calls.length,8);assert.equal(prior.since,dates.previousSince);
});
test('Unique reach forbids daily or post sums; missing/duplicate/null total remains N/A',()=>{
 for(const rows of [[],[{name:'reach',values:[{value:10},{value:20}]}],[{name:'reach',total_value:{value:null}}],[{name:'reach',total_value:{value:10}},{name:'reach',total_value:{value:20}}]])assert.equal(exactTotal(rows,'reach'),null);
 assert.equal(exactTotal([{name:'reach',total_value:{value:0}}],'reach'),0);
});
test('Current/prior weekly metrics reach REPORT, zero distinguished and views correctly named',async()=>{
 const m=buildWeeklyInstagramReportModel({...dates,current:{ok:true,posts:[],account:{followers:9999,reach:8888},accountWeekly:{reach:120,views:300,profile_views:0,website_clicks:null},followerSnapshot:{followers:500,delta:20,current:{followers:500},previous:{followers:480}}},previous:{ok:true,posts:[],accountWeekly:{reach:100,views:200,profile_views:10,website_clicks:4}}});
 const s=(await buildWeeklyInstagramReportWorkbook(m)).getWorksheet('REPORT');assert.equal(s.getCell('A6').value,500);assert.equal(s.getCell('E6').value,120);assert.equal(s.getCell('I6').value,300);assert.equal(s.getCell('A10').value,0);assert.equal(s.getCell('E10').value,'N/A');assert.equal(s.getCell('C16').value,20);assert.equal(s.getCell('E17').value,100);assert.match(s.getCell('I5').value,/조회수/);assert(!JSON.stringify(s.getSheetValues()).includes('8888'));
});
test('Followers persisted once/day, concurrent calls safe, first run N/A and comparable seven-day delta',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'followers-'));try{
  const file=join(dir,'weekly.json');const first=await captureWeeklyFollowers(file,{accountId:'ig',followers:100,capturedAt:'2026-09-29T01:00:00Z'});assert.equal(first.delta,null);
  const results=await Promise.all([captureWeeklyFollowers(file,{accountId:'ig',followers:120,capturedAt:'2026-10-06T01:30:00Z'}),captureWeeklyFollowers(file,{accountId:'ig',followers:125,capturedAt:'2026-10-06T01:31:00Z'})]);assert.equal(results[0].delta,20);assert.equal(results[1].delta,20);assert.equal(JSON.parse(await readFile(file)).snapshots.length,2);
  assert.equal((await captureWeeklyFollowers(file,{accountId:'ig',followers:140,capturedAt:'2026-10-13T08:00:00Z'})).delta,null);
  assert.equal((await captureWeeklyFollowers(file,{accountId:'other',followers:100,capturedAt:'2026-10-06T01:00:00Z'})).delta,null);
 }finally{await rm(dir,{recursive:true,force:true});}
});
const registry={brands:[{id:'a',name:'BRAND A',active:true},{id:'b',name:'BRAND B',active:true}],aliases:[{alias:'에이',brandId:'a'}]};
test('Candidates use exact canonical/approved aliases and exclude operational/fuzzy groups',()=>{assert.deepEqual(demandCandidates([{name:'에이'},{name:'BRAND A'},{name:'BRAND B'},{name:'BRAND A campaign'},{name:'통합 광고'}],registry),[{brandId:'a',name:'BRAND A'},{brandId:'b',name:'BRAND B'}]);});
test('Only exact brand keyword row, never sum related rows or censored/missing values',()=>{
 assert.deepEqual(exactDemand([{keyword:'BRANDA',monthlyPcQueryCount:10,monthlyMobileQueryCount:20},{keyword:'BRAND A shoes',monthlyPcQueryCount:1000,monthlyMobileQueryCount:1000}],'BRAND A'),{pc:10,mobile:20,total:30});
 for(const v of [null,'<10',undefined])assert.equal(exactDemand([{keyword:'BRAND A',monthlyPcQueryCount:v,monthlyMobileQueryCount:20}],'BRAND A'),null);
 assert.equal(exactDemand([{keyword:'BRANDA',monthlyPcQueryCount:0,monthlyMobileQueryCount:0}],'BRAND A').total,0);
});
const snapshot=(name,total,collectedAt)=>({id:name+collectedAt,keyword:name,source:'naver-searchad-keywordstool',collectedAt,rows:[{keyword:name,monthlyPcQueryCount:0,monthlyMobileQueryCount:total}]});
test('Demand TOP10 descending actual PC+Mobile, rise absolute-first, prior-week only, NEW zero base',()=>{
 const names=['A','B','C','D','E','F','G','H','I','J','K'],candidates=names.map(name=>({name,brandId:name})),snapshots=[];
 names.forEach((name,i)=>{snapshots.push(snapshot(name,i*100,'2026-10-06T01:00:00Z'));if(i<5)snapshots.push(snapshot(name,i===0?0:i*10,'2026-09-29T01:00:00Z'));});
 snapshots.push(snapshot('A',1,'2026-10-06T02:00:00Z'));
 const d=buildSearchDemand(candidates,snapshots,'2026-10-06T03:00:00Z');assert.equal(d.top10.length,10);assert.equal(d.top10[0].name,'K');assert.equal(d.rising5.length,5);assert.equal(d.rising5[0].name,'E');assert.equal(d.rising5.at(-1).name,'A');assert.equal(d.rising5.at(-1).growth,null);assert.equal(d.rising5.at(-1).increase,1);assert(!d.rising5.some(r=>r.name==='K'));
});
test('No fabricated five rows; empty/current-only/old snapshot yields no risers',()=>{
 const candidates=[{name:'A'}];for(const snapshots of [[],[snapshot('A',10,'2026-10-06T01:00:00Z')],[snapshot('A',10,'2026-09-01T01:00:00Z')]])assert.equal(buildSearchDemand(candidates,snapshots,'2026-10-06T02:00:00Z').rising5.length,0);
});
const summary={spend:100,impressions:1000,clicks:20,ctr:2,cpc:5,conversions:2,conversionRate:10,conversionValue:200,cpa:50,roas:2};
test('Naver REPORT uses actual adgroup rows, keeps campaign totals and fixed TOP10/TOP5 slots',async()=>{
 const model=buildWeeklyReportModel({...dates,current:{ok:true,summary,campaigns:[{campaignName:'CAMPAIGN',...summary}],adgroups:{available:true,rows:[{name:'BRAND A',...summary,spend:80}]},searchDemand:{top10:[{name:'BRAND A',pc:10,mobile:20,total:30}],rising5:[{name:'BRAND A',previous:0,total:30,increase:30,growth:null}]}},previous:{ok:true,summary,campaigns:[]}});
 const wb=await buildWeeklyReportWorkbook(model),s=wb.getWorksheet('REPORT');assert.deepEqual(wb.worksheets.map(x=>x.name),['REPORT']);assert.equal(s.getCell('A6').value,100);assert.equal(s.getCell('A34').value,'BRAND A');assert.equal(s.getCell('B34').value,80);assert.equal(s.getCell('E34').value,.02);assert.equal(s.getCell('H34').value,.1);assert.equal(s.getCell('F45').value,30);assert.equal(s.getCell('L45').value,'NEW / 기준 없음');assert.equal(s.pageSetup.printArea,'A1:L69');assert.equal(s.rowCount,69);
});
const service=await readFile(new URL('../intelligence-service.mjs',import.meta.url),'utf8');
const slice=(a,b)=>service.slice(service.indexOf(a),service.indexOf(b));
function naverHarness({missing=false,fail=false,demand=false}={}){
 const calls=[],store={snapshots:[]};const ctx={URL,URLSearchParams,AbortController,setTimeout,clearTimeout,createHmac,naverAdsBaseUrl:'https://api.searchad.naver.com',naverAdsTimeoutMs:1000,env:{NAVER_ADS_API_KEY:'fixture',NAVER_ADS_SECRET_KEY:'fixture',NAVER_ADS_CUSTOMER_ID:'fixture'},fetch:async(url,options)=>{calls.push({path:url.pathname,params:Object.fromEntries(url.searchParams),method:options.method});if(fail&&url.pathname==='/stats')return new Response('{}',{status:400});const payload=url.pathname==='/keywordstool'?{keywordList:[{relKeyword:url.searchParams.get('hintKeywords'),monthlyPcQcCnt:10,monthlyMobileQcCnt:20}]}:url.pathname==='/ncc/campaigns'?[{nccCampaignId:'cmp',name:'SAMPLAS'}]:url.pathname==='/ncc/adgroups'?[{nccAdgroupId:'grp',name:'BRAND A',status:'ELIGIBLE'}]:{data:missing?[]:[{id:'grp',impCnt:1000,clkCnt:20,salesAmt:100,ccnt:2,convAmt:200}]};return new Response(JSON.stringify(payload));},readBrandRegistry:async()=>registry,readNaverSnapshotsStore:async()=>store,writeNaverSnapshotsStore:async()=>{},clearMissionCache:()=>{},normalizeBrandName:value=>String(value).trim(),normalizeBrandKey:value=>String(value).trim().toLowerCase(),withPendingBrandWrite:fn=>fn(),demandCandidates:()=>demand?registry.brands.map(b=>({brandId:b.id,name:b.name})):[],buildSearchDemand:()=>({top10:[],rising5:[]})};
 runInNewContext([slice('function naverAdsPerformancePeriod','// Minimal `res`-shaped'),slice('function naverAdsCredentials','async function fetchNaverKeywordSearch'),slice('async function fetchNaverKeywordSearch','function brandIntelligencePeriod'),slice('function createNaverSearchSnapshot','async function readJsonBody')].join('\n').replaceAll('export ',''),ctx);
 return {ctx,calls,store};
}
test('Actual signed Naver adgroup GET/stats uses exact dates and existing ratio semantics',async()=>{
 const {ctx,calls}=naverHarness();const value=await ctx.fetchNaverWeeklyEnrichment(dates.since,dates.until);assert.equal(value.adgroups.available,true);assert.equal(value.adgroups.rows[0].ctr,2);assert.equal(value.adgroups.rows[0].roas,2);assert.equal(value.adgroups.rows[0].campaignId,'cmp');assert.equal(value.adgroups.rows[0].status,'ELIGIBLE');const request=calls.find(c=>c.path==='/stats');assert.equal(request.params.ids,'grp');assert.deepEqual(JSON.parse(request.params.timeRange),{since:dates.since,until:dates.until});assert(calls.every(c=>c.method==='GET'));
});
for(const mode of ['missing','fail'])test(`Naver ${mode} adgroup stats falls back unavailable, never zero`,async()=>{const {ctx}=naverHarness({[mode]:true});const value=await ctx.fetchNaverWeeklyEnrichment(dates.since,dates.until);assert.equal(value.adgroups.available,false);assert.equal(value.adgroups.rows.length,0);});
test('Monthly Instagram collector unchanged; weekly until exclusive KST and metrics independent',async()=>{
 const src=await readFile(new URL('../server.mjs',import.meta.url),'utf8');const a=src.slice(src.indexOf('export async function buildInstagramRangeDataForWeeklyReport'),src.indexOf('async function runInstagramWeeklyReportCheck'));
 const calls=[];const ctx={env:{INSTAGRAM_BUSINESS_ACCOUNT_ID:'ig'},workDir:'/fixture',join,buildInstagramRangeData:async()=>({since:dates.since,until:dates.until,posts:[],account:{followers:9999}}),readCachedStories:async()=>null,collectWeeklyAccount,captureWeeklyFollowers:async()=>({followers:500,delta:null}),logApiError:async()=>{},safeErrorMessage:()=> 'safe',graphGet:async(path,params)=>{calls.push({path,params});return path==='ig'?{followers_count:500}:{data:[{name:params.metric,total_value:{value:0}}]};}};runInNewContext(a.replace('export ',''),ctx);
 const value=await ctx.buildInstagramRangeDataForWeeklyReport(dates.since,dates.until);assert.equal(value.accountWeekly.reach,0);assert.equal(value.followerSnapshot.followers,500);const query=calls.find(c=>c.params.metric==='reach').params;assert.equal(query.since,Date.parse('2026-09-29T00:00:00+09:00')/1000);assert.equal(query.until,Date.parse('2026-10-06T00:00:00+09:00')/1000);assert.equal(query.metric_type,'total_value');assert.match(src,/async function fetchInstagramAccountInsights\(igId, month\)/);
});

test('Current/prior enrichment shares one keyword fetch and preserves existing Snapshot schema',async()=>{
 const {ctx,calls,store}=naverHarness({demand:true});await Promise.all([ctx.fetchNaverWeeklyEnrichment(dates.since,dates.until),ctx.fetchNaverWeeklyEnrichment(dates.previousSince,dates.previousUntil)]);
 assert.equal(calls.filter(c=>c.path==='/keywordstool').length,2);assert.equal(store.snapshots.length,2);for(const row of store.snapshots){assert(row.id&&row.keyword&&row.collectedAt);assert.equal(row.source,'naver-searchad-keywordstool');assert.equal(row.rows[0].monthlyPcQueryCount,10);}
 const ranges=calls.filter(c=>c.path==='/stats').map(c=>JSON.parse(c.params.timeRange).since);assert(ranges.includes(dates.since));assert(ranges.includes(dates.previousSince));
});
