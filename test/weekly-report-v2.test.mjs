import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { buildWeeklyInstagramReportModel, buildWeeklyInstagramReportWorkbook } from '../scripts/instagram-weekly-report.mjs';
import { buildWeeklyReportModel, buildWeeklyReportWorkbook } from '../scripts/naver-ads-weekly-report.mjs';
import { instagramWinners, instagramActions, reachRate, naverCampaignSignal } from '../scripts/weekly-report-presentation.mjs';
import { runWeeklyReportPreview, handleWeeklyReportPreview, validateWeeklyPreviewRequest } from '../scripts/weekly-report-manual.mjs';
const dates={since:'2026-09-29',until:'2026-10-05',previousSince:'2026-09-22',previousUntil:'2026-09-28'};
const posts=[{id:'1',title:'착장 A',type:'릴스',date:'2026-10-01',reach:300,views:600,saves:40,shares:20,likes:100,comments:10,totalInteractions:170},{id:'2',title:'신상품 B',type:'피드',date:'2026-10-02',reach:100,views:200,saves:10,shares:5,likes:30,comments:2,totalInteractions:47},{id:'3',title:'미측정',type:'피드',reach:0,saves:null,shares:0,totalInteractions:0}];
const ig=()=>buildWeeklyInstagramReportModel({...dates,current:{ok:true,posts,stories:[{id:'story',date:'2026-10-01',reach:999999,unavailableReason:'missing'}]},previous:{ok:true,posts:[{...posts[0],reach:250,views:400,saves:30,shares:30}]}});
const current={spend:100000,impressions:199514,clicks:1398,cpc:72,ctr:0.7007,conversions:19,conversionValue:200000,conversionRate:1.36,cpa:5263,roas:2};
const previous={spend:100000,impressions:162474,clicks:1298,cpc:77,ctr:0.79,conversions:72,conversionValue:600000,conversionRate:5.55,cpa:1389,roas:6};
const nav=()=>buildWeeklyReportModel({...dates,current:{ok:true,summary:current,campaigns:[{...current,campaignId:'c',campaignName:'브랜드',status:'ACTIVE'}]},previous:{ok:true,summary:previous,campaigns:[{...previous,campaignId:'c',campaignName:'브랜드'}]}});
const cellText=w=>JSON.stringify(w.worksheets.filter(s=>s.state==='visible').map(s=>s.getSheetValues()));
const allText=w=>JSON.stringify(w.worksheets.map(s=>s.getSheetValues()));
const visible=w=>w.worksheets.filter(s=>s.state==='visible').map(s=>s.name);

test('Instagram: 3 decision sheets; technical/account/story sheets hidden after XLSX round trip',async()=>{
 const w=await buildWeeklyInstagramReportWorkbook(ig()),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await w.xlsx.writeBuffer());
 assert.deepEqual(visible(loaded),['01_한눈에','02_콘텐츠','03_다음주']);
 for(const name of ['01_주간요약','03_콘텐츠분석','04_스토리분석','ACCOUNT INSIGHTS','RAW'])assert.equal(loaded.getWorksheet(name).state,'hidden');
});
test('Instagram: dashboard KPIs, Korean verdict, exact post reach and no invented unique reach',async()=>{
 const m=ig(),w=await buildWeeklyInstagramReportWorkbook(m),s=w.getWorksheet('01_한눈에');
 assert.equal(s.getCell('A1').value,'SAMPLAS WEEKLY REPORT');assert.match(s.getCell('A4').value,/WEEKLY VERDICT/);
 assert.equal(s.getCell('A7').value,3);assert.equal(s.getCell('E7').value,800);assert.equal(s.getCell('I7').value,400);
 assert.equal(s.getCell('A12').value,217);assert.equal(s.getCell('E12').value,50);assert.equal(s.getCell('I12').value,25);
 assert(cellText(w).includes('게시물 Reach 합계'));assert(cellText(w).includes('계정 주간 고유 도달: N/A'));
 assert(!cellText(w).includes('999999'));assert.equal(m.weeklyUniqueReach,null);
});
test('Instagram: merged winners and top three no duplicated post',async()=>{
 const m=ig(),winners=instagramWinners(m.content);assert.equal(winners.length,1);assert.equal(winners[0].signals.length,4);
 const w=await buildWeeklyInstagramReportWorkbook(m);assert(cellText(w).includes('REACH WINNER / SAVE WINNER / SHARE WINNER / ENGAGEMENT WINNER'));
 assert.equal(instagramWinners([{reach:0,saves:0,shares:0,totalInteractions:0}]).length,0);
});
test('Instagram: rate denominators and missing values; source post metrics unchanged',async()=>{
 for(const r of [0,-1,null,undefined,NaN])assert.equal(reachRate(2,r),null);assert.equal(reachRate(null,100),null);assert.equal(reachRate(0,100),0);
 const m=ig(),before=JSON.stringify(m),w=await buildWeeklyInstagramReportWorkbook(m),s=w.getWorksheet('02_콘텐츠');
 assert.equal(s.getRow(2).getCell('saveRate').value,40/300);assert.equal(s.getRow(2).getCell('shareRate').value,20/300);assert.equal(s.getRow(2).getCell('engagementRate').value,170/300);
 for(const k of ['saveRate','shareRate','engagementRate'])assert.equal(s.getRow(4).getCell(k).value,'N/A');
 for(let i=0;i<posts.length;i++)for(const k of ['reach','views','likes','comments','saves','shares','totalInteractions'])assert.equal(s.getRow(i+2).getCell(k).value,posts[i][k]??null);
 assert.equal(JSON.stringify(m),before);assert.equal(s.getRow(2).getCell('performance_signal').font.color.argb,'FF216A3E');
});
test('Instagram: max five actions and P1 first, Korean actions',async()=>{
 const m=ig();m.actions=[...m.actions,...m.actions,...m.actions];const rows=instagramActions(m);assert(rows.length<=5);assert.deepEqual(rows.map(a=>a.priority),rows.map(a=>a.priority).sort());
 const w=await buildWeeklyInstagramReportWorkbook(m);assert(w.getWorksheet('03_다음주').rowCount<=6);assert(rows.every(a=>/[가-힣]/.test(a.action)));
});
test('Instagram: missing prior cannot assert growth; missing current cannot claim metrics',async()=>{
 const m=buildWeeklyInstagramReportModel({...dates,current:{ok:true,posts:[]},previous:null});const w=await buildWeeklyInstagramReportWorkbook(m);assert.match(w.getWorksheet('01_한눈에').getCell('A4').value,/전주 비교 데이터가 없습니다/);
 const bad=await buildWeeklyInstagramReportWorkbook(buildWeeklyInstagramReportModel({...dates,current:{ok:false},previous:null}));assert.match(bad.getWorksheet('01_한눈에').getCell('A4').value,/보류/);assert.equal(bad.getWorksheet('01_한눈에').getCell('A7').value,'N/A');
});
test('Naver: three visible sheets; unavailable details hidden and coverage note small',async()=>{
 const w=await buildWeeklyReportWorkbook(nav()),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await w.xlsx.writeBuffer());assert.deepEqual(visible(loaded),['01_한눈에','02_캠페인','03_액션']);
 for(const name of ['SUMMARY','ADGROUPS','KEYWORDS','AI_ANALYSIS','RAW'])assert.equal(loaded.getWorksheet(name).state,'hidden');
 assert(cellText(w).includes('Coverage:'));assert(!cellText(w).includes('/ncc/keywords'));assert(allText(w).includes('/ncc/keywords'));
});
test('Naver: Korean conversion-broken verdict, funnel and seven KPI cards',async()=>{
 const w=await buildWeeklyReportWorkbook(nav()),s=w.getWorksheet('01_한눈에');assert.match(s.getCell('A4').value,/입찰 축소보다 전환 추적·랜딩·재고·검색 품질/);
 assert.equal(s.getCell('A7').value,100000);assert.equal(s.getCell('E7').value,1398);assert.equal(s.getCell('I7').value,72);assert.equal(s.getCell('A12').value,19);assert.equal(s.getCell('E12').value,1.36/100);assert.equal(s.getCell('I12').value,5263);assert.equal(s.getCell('A17').value,2);
 assert.equal(s.getCell('E12').numFmt,'0.0%');const r=s.getRows(1,s.rowCount).find(r=>r.getCell(1).value==='CURRENT');assert.deepEqual([2,3,4].map(c=>r.getCell(c).value),[199514,1398,19]);
 const p=s.getRows(1,s.rowCount).find(r=>r.getCell(1).value==='PREVIOUS');assert.deepEqual([2,3,4].map(c=>p.getCell(c).value),[162474,1298,72]);assert.match(cellText(w),/전환 추적 → 랜딩 → 재고 → 검색 품질/);
});
test('Naver: actual campaign values/order/percent units unchanged',async()=>{
 const m=nav(),before=JSON.stringify(m),w=await buildWeeklyReportWorkbook(m),s=w.getWorksheet('02_캠페인');
 assert.deepEqual(s.getRow(1).values.slice(1,14),['Campaign','Status','Spend','Conversions','Revenue','ROAS','CPA','CTR','CPC','CVR','WoW Spend','WoW Revenue','Performance Signal']);
 for(const k of Object.keys(current))assert.equal(s.getRow(2).getCell(k).value,['ctr','conversionRate'].includes(k)?current[k]/100:current[k]);
 assert.equal(s.getRow(2).getCell('performanceSignal').value,'ACTION REQUIRED');assert.equal(JSON.stringify(m),before);
});
test('Naver: no new signal thresholds; comparable gain/stable/decline and unknown data',()=>{
 const m={analysis:[]};assert.equal(naverCampaignSignal({conversions:3,wowSpend:0,wowConversionValue:1},m),'STRONG');assert.equal(naverCampaignSignal({conversions:3,wowSpend:1,wowConversionValue:1},m),'HEALTHY');assert.equal(naverCampaignSignal({conversions:3,wowSpend:1,wowConversionValue:-1},m),'WATCH');assert.equal(naverCampaignSignal({conversions:3,wowSpend:null,wowConversionValue:null},m),'WATCH');
});
test('Naver: prioritized max five actionable checks from existing analysis',async()=>{
 const w=await buildWeeklyReportWorkbook(nav()),s=w.getWorksheet('03_액션');assert.equal(s.rowCount,5);assert.equal(s.getRow(2).getCell('priority').value,'P1');assert.deepEqual([2,3,4,5].map(i=>s.getRow(i).getCell('area').value),['전환 추적','랜딩','재고','검색 품질']);
});

const fakeEnv={DROPBOX_APP_KEY:'fixture',DROPBOX_APP_SECRET:'fixture',DROPBOX_REFRESH_TOKEN:'fixture'};
const fetchers=()=>({instagram:async()=>({ok:true,posts}),naver:async()=>({ok:true,summary:current,campaigns:[]}),meta:async()=>({rows:[],totals:{spend:0}}),actualOrders:async()=>({source:'cafe24_inflow_queries',orders:[],trackingQueries:['meta_meantime_look','meta_ssage','meta_adv_catalog','meta_adv_image','meta_adv_video'].map(code=>({code,ok:true,complete:true,count:0}))}),actualAnalytics:async()=>({available:false,reason:'fixture'})});
for(const platform of ['instagram','naver','meta'])test(`Manual ${platform}: same generators/fetchers, unique preview path, destination, no scheduler mutation`,async()=>{
 const f=fetchers(),calls=[];for(const k of Object.keys(f)){const original=f[k];f[k]=async(...args)=>{calls.push([k,...args]);return original(...args);};}
 const state={lastRunSinceKey:'unchanged',lastSuccessAt:'unchanged',running:false},snapshot=JSON.stringify(state),paths=[];
 const env={...fakeEnv};const options={env,fetchers:f,hasPersistentMetaConnection:async()=>true,upload:async(w,{targetPath,env:passed})=>{assert.equal(passed,env);assert(targetPath.includes('_PREVIEW_'));assert(targetPath.endsWith('.xlsx'));paths.push(targetPath);const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await w.xlsx.writeBuffer());return {filePath:targetPath};}};
 const r=await runWeeklyReportPreview({platform,referenceDate:'2026-10-06',mode:'preview'},options);await runWeeklyReportPreview({platform,referenceDate:'2026-10-06',mode:'preview'},options);
 assert.equal(r.ok,true);assert.equal(r.until,platform==='meta'?'2026-10-04':'2026-10-05');assert.equal(r.mode,'preview');assert.notEqual(paths[0],paths[1]);assert.equal(JSON.stringify(state),snapshot);
 const folder={instagram:'/SAMPLAS WORK/병구 작업/인스타그램 리포트/',naver:'/SAMPLAS WORK/병구 작업/네이버 광고 리포트/',meta:'/SAMPLAS WORK/병구 작업/메타 광고/리포트/'}[platform];assert(paths.every(p=>p.startsWith(folder)));
 assert.equal(calls.filter(c=>c[0]===platform).length,platform==='meta'?12:4);if(platform==='meta'){assert.equal(calls.filter(c=>c[0]==='actualOrders').length,2);assert.equal(calls.filter(c=>c[0]==='actualAnalytics').length,2);}
});
test('Manual: date/platform/mode validation before any upstream call',()=>{
 for(const body of [{platform:'popup',mode:'preview'},{platform:'naver',mode:'official'},{platform:'naver',mode:'preview',referenceDate:'2026-02-30'},{platform:'naver',mode:'preview',referenceDate:'../x'}])assert.throws(()=>validateWeeklyPreviewRequest(body));
});
test('Manual: Meta requires persistent connection even with environment fallback token',async()=>{
 let called=false;await assert.rejects(runWeeklyReportPreview({platform:'meta',mode:'preview'},{env:{META_ACCESS_TOKEN:'fixture'},fetchers:{meta:()=>{called=true;}},hasPersistentMetaConnection:async()=>false}),/persistent_meta_connection_required/);assert.equal(called,false);
});
test('Manual: partial Dropbox configuration fails closed; override directory preserved',async()=>{
 await assert.rejects(runWeeklyReportPreview({platform:'instagram',mode:'preview'},{env:{DROPBOX_APP_KEY:'fixture'},fetchers:fetchers()}),/dropbox_partially_configured/);
 const r=await runWeeklyReportPreview({platform:'naver',mode:'preview'},{env:{...fakeEnv,DROPBOX_WEEKLY_REPORT_DIR:'/existing/custom'},fetchers:fetchers(),upload:async(w,{targetPath})=>({filePath:targetPath})});assert(r.filePath.startsWith('/existing/custom/'));
});
test('Manual: local preview does not overwrite an official report',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'weekly-preview-'));try {
  const official=join(dir,'INSTAGRAM_WEEKLY_2026-09-29_2026-10-05.xlsx');await writeFile(official,'official fixture');
  const r=await runWeeklyReportPreview({platform:'instagram',referenceDate:'2026-10-06',mode:'preview'},{env:{INSTAGRAM_WEEKLY_REPORT_DIR:dir},fetchers:fetchers()});assert.match(r.filePath,/_PREVIEW_/);assert.equal((await readdir(dir)).length,2);assert.equal(await readFile(official,'utf8'),'official fixture');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Manual route: server binds existing internal authorization and adapters; GET denied, unauthorized POST denied',async()=>{
 const src=await readFile(new URL('../server.mjs',import.meta.url),'utf8');const route=src.slice(src.indexOf('    if (url.pathname === "/api/reports/weekly/run")'),src.indexOf('    if (url.pathname === "/api/meta-ads/score-weights")'));
 const deps={handleWeeklyReportPreview,req:null,res:{},url:new URL('http://internal/api/reports/weekly/run'),isAuthorizedInternalRequest:r=>r.headers['x-samplas-internal-token']==='fixture',readJsonBody:async()=>({platform:'instagram',referenceDate:'2026-10-06',mode:'preview'}),json:(r,body,status=200)=>({body,status}),env:{},readMetaTokenRecord:async()=>({accessToken:'fixture'}),fetchNaverAdsPerformanceForWeeklyReport:()=>{},buildInstagramRangeDataForWeeklyReport:()=>{},buildMetaAdsSummaryForWeeklyReport:()=>{},fetchCafe24ActualOrdersForWeeklyReport:()=>{},fetchCafe24AnalyticsForWeeklyReport:()=>{},runWeeklyReportPreview:async(body,options)=>{assert.equal(options.fetchers.instagram,deps.buildInstagramRangeDataForWeeklyReport);assert.equal(options.fetchers.meta,deps.buildMetaAdsSummaryForWeeklyReport);assert.equal(options.fetchers.naver,deps.fetchNaverAdsPerformanceForWeeklyReport);assert.equal(await options.hasPersistentMetaConnection(),true);return {ok:true};}};
 // Exercise the route with the actual scheduler state initializers in its lexical scope.
 for(const name of ['naverWeeklyReportScheduler','metaWeeklyReportScheduler','instagramWeeklyReportScheduler']) {
  const start=src.indexOf(`const ${name} = {`),end=src.indexOf('\n};',start)+3;
  deps[name]=new Function(src.slice(start,end)+`\nreturn ${name};`)();
  deps[name].lastRunSinceKey='scheduled-week';deps[name].lastSuccessAt='scheduled-success';
 }
 const schedulerBefore=JSON.stringify([deps.naverWeeklyReportScheduler,deps.metaWeeklyReportScheduler,deps.instagramWeeklyReportScheduler]);
 const fn=new (Object.getPrototypeOf(async function(){}).constructor)(...Object.keys(deps),route);
 deps.req={method:'GET',headers:{}};assert.equal((await fn(...Object.values(deps))).status,405);
 deps.req={method:'POST',headers:{}};assert.equal((await fn(...Object.values(deps))).status,401);
 deps.req={method:'POST',headers:{'x-samplas-internal-token':'fixture'}};assert.equal((await fn(...Object.values(deps))).status,200);
 assert.equal(JSON.stringify([deps.naverWeeklyReportScheduler,deps.metaWeeklyReportScheduler,deps.instagramWeeklyReportScheduler]),schedulerBefore);
});
test('Manual route: upstream error sanitized and unavailable source is not success',async()=>{
 const deps={authorized:()=>true,readBody:async()=>({}),json:(r,body,status)=>({body,status}),run:async()=>{throw Object.assign(new Error('fixture-private-token'),{status:401});}};
 const r=await handleWeeklyReportPreview({method:'POST'},{},deps);assert.equal(r.status,502);assert.equal(r.body.error,'weekly_preview_failed');
 deps.run=async()=>({ok:false,error:'unavailable',filePath:null});assert.equal((await handleWeeklyReportPreview({method:'POST'},{},deps)).status,502);
});
