// PR A: attribution grades, amount status, Meta click/view split and 8-week refund tracking.
// Orders below are the real 2026-10-13..19 week reduced to non-personal fields (no product names).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import {buildActualProductsSold} from '../scripts/meta-actual-products-sold.mjs';
import {generateWeeklyMetaAdsReport} from '../scripts/meta-ads-weekly-report.mjs';
import {readIssuedMetaReport} from '../scripts/meta-issued-report.mjs';
import {importLegacyMetaBaseline} from '../scripts/meta-legacy-baseline-import.mjs';

// [order_id, order_date, paid, canceled, payment, market_id, items:[qty, price, status_code, status_text], analytics:[ad, medium, campaign, content, keyword]]
const WEEK=[["20261019-0000094","2026-10-19T17:45:18+09:00","T","F","198000.00","mobile",[[1,"198000.00","N1","배송완료"]],["","","","",""]],["20261019-0000058","2026-10-19T15:56:04+09:00","T","F","198000.00","mobile",[[1,"198000.00","N1","배송중"]],["","","","",""]],["20261019-0000036","2026-10-19T12:09:09+09:00","T","F","835200.00","self",[[1,"835200.00","N1","배송중"]],["","","","",""]],["20261019-0000029","2026-10-19T06:18:20+09:00","T","F","911400.00","self",[[1,"980000.00","N1","배송중"]],["","","","","샘플라스"]],["20261019-0000015","2026-10-19T01:03:58+09:00","T","F","1499000.00","mobile",[[1,"468000.00","N1","배송완료"],[1,"398000.00","N1","배송완료"],[1,"838000.00","N1","배송완료"]],["","","","",""]],["20261018-0000018","2026-10-18T22:26:29+09:00","T","F","108000.00","NCHECKOUT",[[1,"108000.00","N1","배송완료"]],["","","","",""]],["20261017-0000023","2026-10-17T20:38:13+09:00","T","F","0.00","NCHECKOUT",[[1,"758000.00","N1","배송완료"]],["ig","social","","link_in_bio",""]],["20261016-0000082","2026-10-16T20:38:52+09:00","T","T","0.00","self",[[1,"520000.00","C2","취소완료"]],["","","","",""]],["20261016-0000065","2026-10-16T19:30:11+09:00","T","F","0.00","NCHECKOUT",[[1,"198000.00","N1","배송완료"]],["","","","",""]],["20261016-0000028","2026-10-16T14:18:49+09:00","T","T","218000.00","NCHECKOUT",[[1,"218000.00","C2","취소완료"]],["","","","",""]],["20261015-0000078","2026-10-15T20:38:53+09:00","T","F","228000.00","mobile",[[1,"228000.00","N1","배송완료"]],["","","","",""]],["20261015-0000066","2026-10-15T17:38:36+09:00","T","F","275855.00","NCHECKOUT",[[1,"278000.00","C3","반품신청"]],["meta","paid","어드벤티지 교핑 캠페인","기본 카탈로그 광고",""]],["20261015-0000045","2026-10-15T17:19:13+09:00","T","F","129000.00","self",[[1,"129000.00","N1","배송완료"]],["ig","social","","link_in_bio",""]],["20261015-0000037","2026-10-15T12:35:59+09:00","T","F","498000.00","mobile",[[1,"498000.00","N1","배송완료"]],["meta","paid","어드벤티지 교핑 캠페인","기본 카탈로그 광고",""]],["20261015-0000025","2026-10-15T09:54:09+09:00","T","F","169660.00","self",[[1,"198000.00","C3","반품신청"]],["","","","",""]],["20261015-0000013","2026-10-15T03:32:11+09:00","T","F","6134.00","NCHECKOUT",[[1,"138000.00","C3","반품신청"]],["","","","","선데이오프클럽"]],["20261014-0000106","2026-10-14T21:48:16+09:00","T","F","198000.00","self",[[1,"198000.00","N1","배송완료"]],["","","","",""]],["20261014-0000093","2026-10-14T20:12:43+09:00","T","F","2407540.00","self",[[1,"63000.00","N1","배송완료"],[1,"185000.00","N1","배송완료"],[1,"278000.00","N1","배송완료"],[1,"580000.00","N1","배송완료"],[1,"196000.00","N1","배송완료"],[1,"68000.00","N1","배송완료"],[1,"168000.00","N1","배송완료"],[1,"228000.00","N1","배송완료"],[1,"148000.00","N1","배송완료"],[1,"380000.00","N1","배송완료"],[1,"188000.00","N1","배송완료"]],["","","","","샘플라스"]],["20261014-0000069","2026-10-14T01:28:08+09:00","T","F","279510.00","NCHECKOUT",[[1,"280000.00","N1","배송완료"]],["","","","",""]],["20261014-0000012","2026-10-14T00:52:26+09:00","T","F","538350.00","self",[[1,"160000.00","N1","배송완료"],[1,"220000.00","N1","배송완료"],[1,"175000.00","N1","배송완료"]],["","","","",""]],["20261013-0000154","2026-10-13T23:30:16+09:00","T","F","181125.00","NCHECKOUT",[[1,"688000.00","N1","배송완료"]],["","","","",""]],["20261013-0000141","2026-10-13T22:40:59+09:00","T","F","114460.00","self",[[1,"118000.00","N1","배송완료"]],["","","","",""]],["20261013-0000134","2026-10-13T20:01:36+09:00","T","F","107000.00","mobile",[[1,"125000.00","N1","배송완료"]],["ig","paid","120249957936250277","120249957936240277",""]],["20261013-0000127","2026-10-13T12:49:06+09:00","T","F","108000.00","self",[[1,"108000.00","N1","배송완료"]],["","","","",""]],["20261013-0000119","2026-10-13T12:46:54+09:00","T","F","198000.00","self",[[1,"198000.00","N1","배송완료"]],["","","","",""]],["20261013-0000102","2026-10-13T12:36:10+09:00","T","T","0.00","NCHECKOUT",[[1,"128000.00","C3","반품완료"]],["","","","","선데이오프클럽"]],["20261013-0000098","2026-10-13T10:19:55+09:00","T","F","58500.00","self",[[1,"65000.00","N1","배송완료"]],["","","","",""]],["20261013-0000084","2026-10-13T03:49:42+09:00","T","M","205200.00","self",[[1,"326000.00","C2","취소완료"],[1,"228000.00","N1","배송완료"]],["","","","",""]]];
const ADS=[['120247123734970277','기본 카탈로그 광고','어드벤티지 쇼핑 캠페인'],['120249957936240277','SSㅏ게 드립니다','SSㅏ게 드립니다.'],['120239218024980277','SAMPLAS BRAND LIST - 일본','SAMPLAS 해외 광고'],['120250012266880277','착장 광고','민타임 26SS 광고'],['120239218105100277','SAMPLAS BRAND LIST - 미국','SAMPLAS 해외 광고'],['120239218376220277','SAMPLAS BRAND LIST -  파리스, 런던, 베를린','SAMPLAS 해외 광고'],['120239217739010277','SAMPLAS BRAND LIST - 중국','SAMPLAS 해외 광고'],['120247122344870277','카탈로그 이미지 컬렉션 광고','어드벤티지 쇼핑 캠페인'],['120247120670510277','카탈로그 영상 컬렉션 광고','어드벤티지 쇼핑 캠페인']].map(([adId,adName,campaignName])=>({adId,adName,campaignName}));
const order=([order_id,order_date,paid,canceled,payment,market_id,items])=>({order_id,order_date,paid,canceled,market_id,actual_order_amount:{payment_amount:payment},items:items.map(([quantity,product_price,status_code,status_text],i)=>({order_item_code:`${order_id}-${i}`,product_name:`P${i}`,quantity,product_price,status_code,status_text}))});
// Optional 9th field: the Analytics order_amount when it differs from the Admin payment (real Naver Pay case).
const acquisition=rows=>({ok:true,coverage:{completeness:'COMPLETE'},data:{orderdetails:rows.map(([id,,,,payment,,,a,amount])=>({order_id:id,ad:a[0],medium:a[1],campaign:a[2],content:a[3],keyword:a[4],order_amount:amount??Number(payment)}))}});
const codes=['meta_meantime_look','meta_ssage','meta_adv_catalog','meta_adv_image','meta_adv_video'];
const weekly=orders=>({source:'cafe24_inflow_queries',coverage:{completeness:'COMPLETE'},orders:[],trackingQueries:codes.map(code=>({code,ok:true,complete:true,count:0,coverage:{completeness:'COMPLETE'}})),analyticsOrders:orders,analyticsOrdersComplete:true});
const build=(rows,{ads=ADS,adGrades=true,mode='weekly'}={})=>buildActualProductsSold({data:mode==='weekly'?weekly(rows.map(order)):{orders:rows.map(order)},analytics:acquisition(rows),metaAds:ads,since:'2026-10-13',until:'2026-10-19',adGrades});
const byOrder=r=>Object.fromEntries(r.rows.map(x=>[x.order_id,x]));

test('real week: one ad-ID order confirmed, two ad-name candidates never summed, nothing demoted',()=>{
 const r=build(WEEK),o=byOrder(r);
 assert.equal(r.available,true);
 assert.deepEqual(Object.keys(o).sort(),['20261013-0000134','20261015-0000037','20261015-0000066']);
 assert.deepEqual([o['20261013-0000134'].attribution_grade,o['20261013-0000134'].matched_ad_id,o['20261013-0000134'].amount_status,o['20261013-0000134'].actual_paid_amount],['G1_AD_ID','120249957936240277','NORMAL',107000]);
 assert.deepEqual([o['20261015-0000037'].attribution_grade,o['20261015-0000037'].matched_ad_id,o['20261015-0000037'].amount_status,o['20261015-0000037'].actual_paid_amount],['G2_AD_NAME','120247123734970277','NORMAL',498000]);
 assert.deepEqual([o['20261015-0000066'].attribution_grade,o['20261015-0000066'].amount_status,o['20261015-0000066'].actual_paid_amount],['G2_AD_NAME','CLAIM_IN_PROGRESS',275855]);
 assert.equal(o['20261015-0000037'].campaign_id,'어드벤티지 교핑 캠페인'); // typo kept as evidence, not used for matching
 assert.deepEqual([r.summary.metaPaidOrderCount,r.summary.metaPaidRevenue],[1,107000]);
 assert.deepEqual(r.summary.grades,{adIdCount:1,inflowCodeCount:0,normalCount:1,normalRevenue:107000,claimCount:0,claimRevenue:0,paymentUnverifiedCount:0,adNameCandidateCount:2,unmatchedPaidCount:0,candidateMissingAdmin:0});
});

test('all 28 orders classified: canceled excluded, organic/search/no-source kept apart from Meta',()=>{
 const r=build(WEEK,{mode:'all'}),seen={};
 for(const row of Object.values(byOrder(r)))seen[row.tracking_source]=(seen[row.tracking_source]||0)+1;
 assert.equal(Object.values(seen).reduce((a,b)=>a+b),25); // 3 fully canceled/returned orders are not sales
 assert.deepEqual(seen,{META_PAID:1,META_PAID_NAME:2,INSTAGRAM_ORGANIC:2,SEARCH:3,UNATTRIBUTED:17});
});

test('grade boundaries: duplicate name, undelivered ad and unknown ad ID are G3 and excluded',()=>{
 const base=WEEK.find(r=>r[0]==='20261015-0000037');
 const dup=build([base],{ads:[...ADS,{adId:'999',adName:'기본 카탈로그 광고'}]}).rows[0];
 assert.deepEqual([dup.attribution_grade,dup.tracking_source,dup.ad_mapping],['G3_UNMATCHED','META_PAID_UNMATCHED','AD NAME NOT UNIQUE']);
 const gone=build([base],{ads:ADS.filter(a=>a.adName!=='기본 카탈로그 광고')});
 assert.equal(gone.rows[0].attribution_grade,'G3_UNMATCHED');
 const unknownId=[...WEEK.find(r=>r[0]==='20261013-0000134')];unknownId[7]=['ig','paid','1','123'];
 const u=build([unknownId]);
 assert.deepEqual([u.rows[0].attribution_grade,u.summary.metaPaidRevenue,u.summary.grades.unmatchedPaidCount],['G3_UNMATCHED',0,1]);
 // Callers without grading (advertising overview) keep the previous rule unchanged.
 const legacy=buildActualProductsSold({data:{orders:[order(unknownId)]},analytics:acquisition([unknownId]),since:'2026-10-13',until:'2026-10-19'});
 assert.deepEqual([legacy.rows[0].tracking_source,legacy.summary.metaPaidRevenue,'attribution_grade' in legacy.rows[0],'grades' in legacy.summary],['META_PAID',107000,false,false]);
});

test('Naver Pay paid order with payment 0 is 미검증, never 0 or the Analytics amount',()=>{
 const np=[...WEEK.find(r=>r[0]==='20261017-0000023')];np[7]=['ig','paid','c','120249957936240277',''];np[8]=379000;
 const r=build([np]),row=r.rows[0];
 assert.deepEqual([row.attribution_grade,row.amount_status,row.actual_paid_amount,row.analytics_order_amount],['G1_AD_ID','PAYMENT_UNVERIFIED',0,379000]);
 assert.deepEqual([r.summary.grades.paymentUnverifiedCount,r.summary.grades.normalRevenue],[1,0]);
});

// ---------------------------------------------------------------------------
// Generator: scheduled weeks, split, refund tracking
// ---------------------------------------------------------------------------
const WEEK_0006_055=()=>order(['20261011-0000055','2026-10-11T20:33:59+09:00','T','F','198000.00','mobile',[[1,'198000.00','N1','배송완료']],['ig','paid','120216362640650277','120250012266880277','']]);
const day=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
const level=(ads,totals)=>({completeness:'COMPLETE',coverage:{kind:'meta_insights',completeness:'COMPLETE',reasons:[]},source:'meta_marketing_api',rows:ads.map(a=>({...a,spend:100,impressions:1000,clicks:10,purchases:1,purchaseValue:100000})),totals});
const TOTALS={spend:395661,impressions:47504,clicks:2166,purchases:14,purchaseValue:5192070};
// Week order state at reread time: kept, fully canceled on a date, one of two items canceled
// (partial) on a date, or a paid order showing 0 without any claim evidence (unexplained).
function weekOrder(since,state='kept'){
 const id=`${since.replaceAll('-','')}-0000001`,item=n=>({order_item_code:`${id}-${n}`,product_name:'P',quantity:1,product_price:'50000.00',status_text:'배송완료'});
 const o={order_id:id,order_date:`${day(since,1)}T12:00:00+09:00`,paid:'T',canceled:'F',actual_order_amount:{payment_amount:'100000.00'},items:[item(1),item(2)]};
 if(state==='kept')return o;
 if(state.zero)return {...o,actual_order_amount:{payment_amount:'0.00'}};
 if(state.partial)return {...o,canceled:'M',actual_order_amount:{payment_amount:'50000.00'},items:[{...item(1),status_text:'취소완료',cancel_date:state.partial},item(2)]};
 return {...o,canceled:'T',cancel_date:state.cancel,actual_order_amount:{payment_amount:'0.00'},items:[{...item(1),status_text:'취소완료',cancel_date:state.cancel},{...item(2),status_text:'취소완료',cancel_date:state.cancel}]};
}
const acq=os=>({ok:true,coverage:{completeness:'COMPLETE'},data:{orderdetails:os.map(o=>({order_id:o.order_id,ad:'ig',medium:'paid',content:'ad1',order_amount:100000}))}});
function opts(outputDir,since,extra={}){
 const tuesday=day(since,7),ads=[{adId:'ad1',adName:'Ad one',campaignName:'C'}];
 return {outputDir,env:{},referenceDateKey:tuesday,period:{since,until:day(since,6)},onePage:true,requireCompleteData:true,now:()=>new Date(`${tuesday}T01:00:00Z`),
  fetchByLevel:async()=>level(ads,TOTALS),fetchAccountTotals:async(s,u)=>({kind:'meta_account_totals',scope:{since:s,until:u},completeness:'COMPLETE',reasons:[],observed:{},totals:TOTALS}),
  fetchActualOrders:async s=>weekly([weekOrder(s)]),fetchActualAnalytics:async s=>acq([weekOrder(s)]),saveReport:async()=>({filePath:'/no-dropbox/stub.xlsx',uploaded:false}),...extra};
}
const tmp=()=>mkdtemp(join(tmpdir(),'meta-grades-'));
async function snapshot(dir){const out={};for(const p of await readdir(join(dir,'issued'))){if(p.startsWith('.'))continue;for(const f of await readdir(join(dir,'issued',p)))out[`${p}/${f}`]=createHash('sha256').update(await readFile(join(dir,'issued',p,f))).digest('hex');}return out;}
const split=(click,view)=>async(s,u)=>({kind:'meta_attribution_split',scope:{since:s,until:u},completeness:'COMPLETE',reasons:[],ads:{ad1:{click,view}},totals:{click,view}});

test('click/view split shown beside unchanged Meta totals; mismatch or failure is 미검증 and still publishes',async()=>{
 const good=await generateWeeklyMetaAdsReport(opts(await tmp(),'2026-10-13',{fetchAttribution:split({purchases:11,value:4054410},{purchases:3,value:1137660})}));
 assert.equal(good.ok,true,good.error);
 const w=new ExcelJS.Workbook();await w.xlsx.readFile(good.publication.filePath);const page=w.getWorksheet('REPORT');
 assert.equal(page.getCell('D6').value,14);assert.equal(page.getCell('G6').value,5192070);
 assert.equal(page.getCell('D7').value,'클릭 11건 · 노출 3건');assert.equal(page.getCell('G7').value,'클릭 4,054,410원 · 노출 1,137,660원');
 assert.deepEqual(w.getWorksheet('META_ATTRIBUTION').getRow(2).values.slice(1,8),['ad1','Ad one',11,4054410,3,1137660,1]);
 const bad=await generateWeeklyMetaAdsReport(opts(await tmp(),'2026-10-13',{fetchAttribution:split({purchases:10,value:1},{purchases:3,value:1})}));
 const failed=await generateWeeklyMetaAdsReport(opts(await tmp(),'2026-10-13',{fetchAttribution:()=>{throw new Error('Graph 500');}}));
 for(const r of [bad,failed]){
  assert.equal(r.ok,true);const b=new ExcelJS.Workbook();await b.xlsx.readFile(r.publication.filePath);
  assert.equal(b.getWorksheet('REPORT').getCell('D7').value,'클릭/노출 분해 미검증');assert.equal(b.getWorksheet('REPORT').getCell('D6').value,14);
 }
});

// Generator reading/writing a temp dir: states maps an issued week to its order state at reread time.
const reread=(states,fail=[])=>async(s,u)=>{if(fail.includes(s))throw new Error('Cafe24 503');return {orders:[weekOrder(s,states[s]||'kept')],coverage:{completeness:'COMPLETE'}};};
const runWeek=(dir,since,states={},fail=[])=>generateWeeklyMetaAdsReport(opts(dir,since,{fetchRefundOrders:reread(states,fail),fetchActualOrders:async s=>weekly([weekOrder(s,s===since?'kept':states[s]||'kept')]),fetchActualAnalytics:async s=>acq([weekOrder(s)])}));
const rowsOf=async r=>{const w=new ExcelJS.Workbook();await w.xlsx.readFile(r.publication.filePath);return {w,rows:w.getWorksheet('REFUND_TRACKING').getSheetValues().filter(Boolean).slice(1).map(v=>v.slice(1))};};
const orderOf=s=>`${s.replaceAll('-','')}-0000001`;
// Frozen copy of the issued-record reader of releases da0c941 and 1392fb2 (rollback targets).
async function releasedReader(dir,since,until){
 const m=JSON.parse(await readFile(join(dir,'issued',`${since}_${until}`,'manifest.json'),'utf8'));
 const P='META_WEEKLY_REVIEW_V2',time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
 const publishable=r=>r?.policy===P&&Array.isArray(r.failures)&&Array.isArray(r.unknowns)&&!r.failures.length&&(r.result==='PASS'?!r.unknowns.length:r.result==='UNKNOWN'&&r.unknowns.length>0)&&JSON.stringify(r.errors)===JSON.stringify([...r.failures,...r.unknowns]);
 const inPeriod=d=>/^\d{4}-\d{2}-\d{2}/.test(d||'')&&d.slice(0,10)>=since&&d.slice(0,10)<=until;
 if(m.schemaVersion!==1||m.policy!==P||m.mode!=='scheduled'||!publishable(m.review)||m.since!==since||m.until!==until||!(time(m.reviewedAt)>=time(m.generatedAt))||m.issuedAt!==m.reviewedAt||!Array.isArray(m.orders))throw Error('ISSUED_REVIEW_INVALID');
 if(new Set(m.orders.map(o=>o.orderId)).size!==m.orders.length||m.orders.some(o=>!o.orderId||!inPeriod(o.orderDate)||!Number.isSafeInteger(o.amount)||o.amount<0)||m.orders.length!==m.summary?.metaPaidOrderCount||m.orders.reduce((s,o)=>s+o.amount,0)!==m.summary?.metaPaidRevenue)throw Error('ISSUED_LEDGER_INVALID');
 const bytes=await readFile(join(dir,'issued',`${since}_${until}`,'report.xlsx'));
 if(createHash('sha256').update(bytes).digest('hex')!==m.sha256)throw Error('ISSUED_HASH_MISMATCH');
 const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);const {sha256,...record}=m,parts=[];
 w.getWorksheet('ISSUE_EVIDENCE')?.eachRow(row=>parts.push(row.getCell(1).value));
 if(parts.join('')!==JSON.stringify(record))throw Error('ISSUED_LEDGER_MISMATCH');
 return m;
}

test('rollback: graded records keep the V2 policy and pass the released reader, PASS and UNKNOWN alike',async()=>{
 const dir=await tmp(),states={};
 for(const s of ['2026-09-29','2026-10-06','2026-10-13'])assert.equal((await runWeek(dir,s)).ok,true);
 states['2026-09-29']={cancel:'2026-10-24T10:00:00+09:00'};
 const r=await runWeek(dir,'2026-10-20',states);
 assert.deepEqual([r.publication.policy,r.publication.recordFormat,r.publication.reportedAdjustments.length],['META_WEEKLY_REVIEW_V2',3,1]);
 for(const s of ['2026-09-29','2026-10-06','2026-10-13','2026-10-20'])assert.equal((await releasedReader(dir,s,day(s,6))).policy,'META_WEEKLY_REVIEW_V2');
 const np=[...WEEK.find(x=>x[0]==='20261017-0000023')];np[7]=['ig','paid','c','120249957936240277',''];np[8]=379000;
 const u=await generateWeeklyMetaAdsReport(opts(await tmp(),'2026-10-13',{fetchByLevel:async()=>level(ADS,TOTALS),fetchActualOrders:async s=>weekly(s==='2026-10-13'?[order(np)]:[]),fetchActualAnalytics:async s=>acquisition(s==='2026-10-13'?[np]:[])}));
 assert.equal(u.review.result,'UNKNOWN');
 assert.equal((await releasedReader(dirname(dirname(dirname(u.publication.filePath))),'2026-10-13','2026-10-19')).review.unknowns[0],'PAYMENT_AMOUNT_UNVERIFIED');
});

test('20261011-0000055: never adjusted by the 10/20 legacy report, applied once (-198,000) on 10/27 and not again on 11/03',async()=>{
 const dir=await tmp(),ret='2026-10-19T12:27:28+09:00';
 const o055=WEEK_0006_055(),o134=order(WEEK.find(x=>x[0]==='20261013-0000134'));
 // Both earlier weeks exist only as legacy_import baselines, as in Production.
 for(const [s,o,ad,file,mod] of [['2026-10-06',o055,'120250012266880277','a.xlsx','2026-10-13T03:24:35Z'],['2026-10-13',o134,'120249957936240277','b.xlsx','2026-10-20T01:00:55Z']]){
  let bytes;const ads=[{adId:ad,adName:'A',campaignName:'C'}];
  await generateWeeklyMetaAdsReport({...opts(await tmp(),s,{fetchByLevel:async()=>level(ads,TOTALS),fetchActualOrders:async x=>weekly(x===s?[o]:[]),fetchActualAnalytics:async x=>({ok:true,coverage:{completeness:'COMPLETE'},data:{orderdetails:x===s?[{order_id:o.order_id,ad:'ig',medium:'paid',content:ad,order_amount:1}]:[]}})}),publicationMode:'preview',adGrades:false,saveReport:async w=>{bytes=Buffer.from(await w.xlsx.writeBuffer());return {filePath:'p'};}});
  const f=join(await tmp(),file);await writeFile(f,bytes);
  await importLegacyMetaBaseline({file:f,source:{dropboxFileId:'id:fixture'+s.replaceAll('-',''),dropboxPath:'/x/'+file,serverModified:mod},write:true,outputDir:dir,now:()=>new Date('2026-10-20T11:00:00Z')});
 }
 const before=await snapshot(dir);
 const refunded={...o055,canceled:'T',cancel_date:ret,return_confirmed_date:ret,actual_order_amount:{payment_amount:'0.00'},items:[{...o055.items[0],order_status:'R40',status_code:'C3',status_text:'반품완료',return_confirmed_date:ret,refund_date:'2026-10-19T12:27:42+09:00'}]};
 const ads=[{adId:'120249957936240277',adName:'A',campaignName:'C'}];
 const run=s=>generateWeeklyMetaAdsReport(opts(dir,s,{fetchByLevel:async()=>level(ads,TOTALS),fetchActualOrders:async x=>weekly(x==='2026-10-13'?[o134]:[]),fetchActualAnalytics:async x=>({ok:true,coverage:{completeness:'COMPLETE'},data:{orderdetails:x==='2026-10-13'?[{order_id:o134.order_id,ad:'ig',medium:'paid',content:'120249957936240277',order_amount:107000}]:[]}}),fetchRefundOrders:async x=>({orders:x==='2026-10-06'?[refunded]:x==='2026-10-13'?[o134]:[],coverage:{completeness:'COMPLETE'}})}));
 const oct27=await run('2026-10-20');
 assert.equal(oct27.ok,true,oct27.error);
 let {w,rows}=await rowsOf(oct27);
 const r055=rows.find(v=>v[2]==='20261011-0000055');
 assert.deepEqual([r055[0],r055[3],r055[4],r055[5],r055[7],r055[8],r055[9]],['2026-10-06 ~ 2026-10-12',198000,0,-198000,'REFUND_ADJUSTMENT','최초 반영',-198000]);
 assert.match(w.getWorksheet('REPORT').getCell('D29').value,/정정 최초 반영 1건 -198,000원 · 이전 반영 0건 · 미확인 0건 · 조회 실패 0기간/);
 assert.deepEqual(oct27.publication.reportedAdjustments,[{issuedPeriod:'2026-10-06_2026-10-12',orderId:'20261011-0000055',cumulativeAdjustment:-198000,refundDate:'2026-10-19T12:27:42+09:00'}]);
 const nov3=await run('2026-10-27');
 ({w,rows}=await rowsOf(nov3));
 const again=rows.find(v=>v[2]==='20261011-0000055');
 assert.deepEqual([again[8],again[9]],['이전 반영 (2026-10-20_2026-10-26 발행본)',0]);
 assert.match(w.getWorksheet('REPORT').getCell('D29').value,/정정 최초 반영 0건 0원 · 이전 반영 1건/);
 const after=await snapshot(dir);for(const [k,v] of Object.entries(before))assert.equal(after[k],v,k);
});

test('ledger: partial refund applied in steps, unknown counted only once confirmed, 8 weeks only',async()=>{
 const dir=await tmp(),weeks=Array.from({length:10},(_,i)=>day('2026-08-11',7*i)),states={};
 for(const s of weeks)assert.equal((await runWeek(dir,s)).ok,true);
 states[weeks[9]]={partial:'2026-10-21T10:00:00+09:00'};          // previous week: half refunded
 states[weeks[5]]={zero:true};                                   // unexplained 0
 states[weeks[0]]={cancel:'2026-10-21T10:00:00+09:00'};          // outside the 8 tracked weeks
 const w1=await runWeek(dir,'2026-10-20',states);
 let {rows}=await rowsOf(w1);
 assert.equal(new Set(rows.filter(v=>/^\d{4}/.test(v[0]||'')).map(v=>v[0])).size,8);
 assert.deepEqual(rows.find(v=>v[2]===orderOf(weeks[9])).slice(5,10).filter((_,i)=>i!==1),[-50000,'REFUND_ADJUSTMENT','최초 반영',-50000]);
 assert.deepEqual(rows.find(v=>v[2]===orderOf(weeks[5])).slice(7,9),['UNKNOWN_ADJUSTMENT','미확인 (합산 안 함)']);
 assert.equal(rows.some(v=>v[2]===orderOf(weeks[0])),false);
 assert.equal(w1.publication.reportedAdjustments.length,1);
 states[weeks[9]]={cancel:'2026-10-28T10:00:00+09:00'};           // rest of the order refunded
 states[weeks[5]]={cancel:'2026-10-28T10:00:00+09:00'};           // now explained
 const w2=await runWeek(dir,'2026-10-27',states);
 ({rows}=await rowsOf(w2));
 assert.deepEqual(rows.find(v=>v[2]===orderOf(weeks[9])).slice(5,10).filter((_,i)=>i!==1),[-100000,'REFUND_ADJUSTMENT','최초 반영',-50000]);
 assert.deepEqual(rows.find(v=>v[2]===orderOf(weeks[5])).slice(8,10),['최초 반영',-100000]);
});

// Rollback round trip: week B was issued by an earlier release, which reported its previous week's refund
// only in its REFUND_ADJUSTMENTS sheet. The next graded report must not apply that refund again.
test('earlier-release REFUND_ADJUSTMENTS sheet counts as already reported; back on this release nothing is applied twice',async()=>{
 const dir=await tmp();
 assert.equal((await runWeek(dir,'2026-10-06')).ok,true);
 const refundA={'2026-10-06':{cancel:'2026-10-15T10:00:00+09:00'}};
 const b=await runWeek(dir,'2026-10-13',refundA);
 assert.equal(b.comparison.refundAdjustment,-100000);
 // Rewrite B into the shape an earlier release issued: same sheets, no recordFormat / ledger / grades.
 const p=join(dir,'issued','2026-10-13_2026-10-19');
 const m=JSON.parse(await readFile(join(p,'manifest.json'),'utf8')),{sha256,...rec}=m;
 delete rec.recordFormat;delete rec.reportedAdjustments;delete rec.candidates;delete rec.summary.grades;rec.orders=rec.orders.map(({grade,amountStatus,...o})=>o);
 const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(join(p,'report.xlsx'));wb.removeWorksheet(wb.getWorksheet('ISSUE_EVIDENCE').id);
 for(const name of ['REFUND_TRACKING','META_ATTRIBUTION'])if(wb.getWorksheet(name))wb.removeWorksheet(wb.getWorksheet(name).id);
 const ev=wb.addWorksheet('ISSUE_EVIDENCE',{state:'veryHidden'}),json=JSON.stringify(rec);for(let i=0;i<json.length;i+=30000)ev.addRow([json.slice(i,i+30000)]);
 const bytes=Buffer.from(await wb.xlsx.writeBuffer());await writeFile(join(p,'report.xlsx'),bytes);
 await writeFile(join(p,'manifest.json'),JSON.stringify({...rec,sha256:createHash('sha256').update(bytes).digest('hex')},null,2));
 assert.equal((await releasedReader(dir,'2026-10-13','2026-10-19')).recordFormat,undefined);
 const c=await runWeek(dir,'2026-10-20',refundA);
 const {w,rows}=await rowsOf(c);
 assert.deepEqual(rows.find(v=>v[2]===orderOf('2026-10-06')).slice(8,10),['이전 반영 (2026-10-13_2026-10-19 발행본)',0]);
 assert.match(w.getWorksheet('REPORT').getCell('D29').value,/정정 최초 반영 0건 0원 · 이전 반영 1건/);
});

test('previous-week refund is applied once although shown in ISSUED_COMPARISON and REFUND_TRACKING',async()=>{
 const dir=await tmp();
 for(const s of ['2026-10-06','2026-10-13'])assert.equal((await runWeek(dir,s)).ok,true);
 const r=await runWeek(dir,'2026-10-20',{'2026-10-13':{cancel:'2026-10-22T10:00:00+09:00'}});
 assert.equal(r.comparison.status,'RECONCILED');assert.equal(r.comparison.refundAdjustment,-100000);
 const {w,rows}=await rowsOf(r);
 assert.equal(rows.filter(v=>v[2]===orderOf('2026-10-13')).length,1);
 assert.match(w.getWorksheet('REPORT').getCell('D29').value,/정정 최초 반영 1건 -100,000원/);
});

test('unreadable earlier record: no new adjustment is applied or recorded; the report still publishes',async()=>{
 const dir=await tmp();
 for(const s of ['2026-09-29','2026-10-06','2026-10-13'])assert.equal((await runWeek(dir,s)).ok,true);
 await writeFile(join(dir,'issued','2026-10-06_2026-10-12','report.xlsx'),'corrupted fixture');
 const r=await runWeek(dir,'2026-10-20',{'2026-09-29':{cancel:'2026-10-21T10:00:00+09:00'}});
 assert.equal(r.ok,true,r.error);assert.deepEqual(r.publication.reportedAdjustments,[]);
 const {w,rows}=await rowsOf(r);
 assert.equal(rows.find(v=>v[2]===orderOf('2026-09-29'))[8],'장부 미검증 (합산 안 함)');
 assert.match(w.getWorksheet('REPORT').getCell('D29').value,/정정 장부 미검증 · 이번 반영 0건/);
});

test('scheduled graded publication records the ad-name candidates and payment-unverified review reason',async()=>{
 const dir=await tmp(),ads=ADS;
 const np=[...WEEK.find(r=>r[0]==='20261017-0000023')];np[7]=['ig','paid','c','120249957936240277',''];np[8]=379000;
 const rows=[...WEEK.filter(r=>['20261013-0000134','20261015-0000037','20261015-0000066'].includes(r[0])),np];
 const r=await generateWeeklyMetaAdsReport(opts(dir,'2026-10-13',{fetchByLevel:async()=>level(ads,TOTALS),fetchActualOrders:async s=>s==='2026-10-13'?weekly(rows.map(order)):weekly([]),fetchActualAnalytics:async s=>s==='2026-10-13'?acquisition(rows):acquisition([])}));
 assert.equal(r.ok,true,r.error);assert.equal(r.review.result,'UNKNOWN');assert.ok(r.review.unknowns.includes('PAYMENT_AMOUNT_UNVERIFIED'));
 assert.deepEqual(r.publication.candidates.map(c=>[c.orderId,c.amount,c.amountStatus]).sort(),[['20261015-0000037',498000,'NORMAL'],['20261015-0000066',275855,'CLAIM_IN_PROGRESS']]);
 assert.deepEqual(r.publication.orders.map(o=>[o.orderId,o.amount,o.grade,o.amountStatus]).sort(),[['20261013-0000134',107000,'G1_AD_ID','NORMAL'],['20261017-0000023',0,'G1_AD_ID','PAYMENT_UNVERIFIED']]);
 assert.equal(r.publication.summary.metaPaidRevenue,107000);
 const w=new ExcelJS.Workbook();await w.xlsx.readFile(r.publication.filePath);const page=w.getWorksheet('REPORT');
 assert.equal(page.getCell('J9').value,'Cafe24 광고 ID 유입 확인');assert.equal(page.getCell('J10').value,107000);
 assert.match(page.getCell('J11').value,/정상 유지 1건 · 클레임 진행 0건 0원 별도 · 결제금액 미검증 1건 · 광고명 후보 2건 합산 안 함/);
 assert.equal(page.getCell('C24').value,2);assert.match(page.getCell('A4').value,/결제금액 0원/);
});
