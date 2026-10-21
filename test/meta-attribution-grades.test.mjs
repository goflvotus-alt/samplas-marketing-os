// PR A: attribution grades, amount status, Meta click/view split and 8-week refund tracking.
// Orders below are the real 2026-10-13..19 week reduced to non-personal fields (no product names).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import {buildActualProductsSold} from '../scripts/meta-actual-products-sold.mjs';
import {generateWeeklyMetaAdsReport} from '../scripts/meta-ads-weekly-report.mjs';
import {readIssuedMetaReport} from '../scripts/meta-issued-report.mjs';

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
const day=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
const level=(ads,totals)=>({completeness:'COMPLETE',coverage:{kind:'meta_insights',completeness:'COMPLETE',reasons:[]},source:'meta_marketing_api',rows:ads.map(a=>({...a,spend:100,impressions:1000,clicks:10,purchases:1,purchaseValue:100000})),totals});
const TOTALS={spend:395661,impressions:47504,clicks:2166,purchases:14,purchaseValue:5192070};
function weekOrder(since,state='kept'){
 const id=`${since.replaceAll('-','')}-0000001`,o={order_id:id,order_date:`${day(since,1)}T12:00:00+09:00`,paid:'T',canceled:'F',actual_order_amount:{payment_amount:'100000.00'},items:[{order_item_code:id+'-1',product_name:'P',quantity:1,product_price:'100000.00',status_text:'배송완료'}]};
 if(state==='kept')return o;
 return {...o,canceled:'T',cancel_date:state,actual_order_amount:{payment_amount:'0.00'},items:[{...o.items[0],status_text:'취소완료',cancel_date:state}]};
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

test('8-week refund tracking: new refund counted once, earlier refund not re-deducted, failed week isolated, issued bytes untouched',async()=>{
 const dir=await tmp();
 // Ten scheduled weeks issued in order (each Tuesday 10:00 KST): 2026-08-11 .. 2026-10-13.
 const weeks=Array.from({length:10},(_,i)=>day('2026-08-11',7*i));
 for(const s of weeks){const r=await generateWeeklyMetaAdsReport(opts(dir,s));assert.equal(r.ok,true,`${s}: ${r.error}`);assert.equal(r.publication.policy,'META_WEEKLY_REVIEW_V3');}
 const before=await snapshot(dir);
 const lastIssued=(await readIssuedMetaReport({outputDir:dir,since:'2026-10-13',until:'2026-10-19'})).issuedAt;
 const newRefund='2026-10-24T10:00:00+09:00',oldRefund='2026-10-01T10:00:00+09:00';
 const state={[weeks[4]]:newRefund,[weeks[3]]:oldRefund};
 const reread=async(s,u)=>{if(s===weeks[2])throw new Error('Cafe24 503');return {orders:[weekOrder(s,state[s]||'kept')],coverage:{completeness:'COMPLETE'}};};
 const r=await generateWeeklyMetaAdsReport(opts(dir,'2026-10-20',{fetchRefundOrders:reread}));
 assert.equal(r.ok,true,r.error);
 const t=r.publication&&r.review&&(await (async()=>{const w=new ExcelJS.Workbook();await w.xlsx.readFile(r.publication.filePath);return w;})());
 const rows=t.getWorksheet('REFUND_TRACKING').getSheetValues().filter(Boolean).slice(1).map(v=>v.slice(1));
 const periods=[...new Set(rows.filter(v=>/^\d{4}/.test(v[0]||'')).map(v=>v[0]))];
 assert.equal(periods.length,8); // 8 most recent weeks only
 assert.match(rows.find(v=>v[0].startsWith('2026-10-13'))[7],/ISSUED_COMPARISON/); // previous week listed, not re-totalled
 const fresh=rows.find(v=>v[2]===`${weeks[4].replaceAll('-','')}-0000001`),earlier=rows.find(v=>v[2]===`${weeks[3].replaceAll('-','')}-0000001`);
 assert.deepEqual([fresh[5],fresh[7],fresh[8]],[-100000,'REFUND_ADJUSTMENT','Y']);
 assert.deepEqual([earlier[5],earlier[7],earlier[8]],[-100000,'REFUND_ADJUSTMENT','N · 이전 보고']);
 assert.match(rows.find(v=>v[0].startsWith(weeks[2]))[7],/미검증 — CAFE24_REREAD_INCOMPLETE/);
 assert.match(t.getWorksheet('REPORT').getCell('D29').value,/최근 8주 신규 확인 환불 1건 -100,000원 · 미확인 차이 0건 · 조회 실패 1기간/);
 assert.ok(Date.parse(newRefund)>Date.parse(lastIssued)&&Date.parse(oldRefund)<Date.parse(lastIssued));
 const after=await snapshot(dir);for(const [k,v] of Object.entries(before))assert.equal(after[k],v,k); // issued files never modified
});

test('V2 and legacy records stay readable as the previous week; V3 adds grades and candidates without changing totals',async()=>{
 const dir=await tmp();
 const first=await generateWeeklyMetaAdsReport(opts(dir,'2026-10-13'));
 // Rewrite that record into the V2 shape the previous release issued (no grades, no candidates).
 const p=join(dir,'issued','2026-10-13_2026-10-19'),m=JSON.parse(await readFile(join(p,'manifest.json'),'utf8'));
 const {sha256,...rec}=m;rec.policy=rec.review.policy='META_WEEKLY_REVIEW_V2';delete rec.candidates;delete rec.summary.grades;rec.orders=rec.orders.map(({grade,amountStatus,...o})=>o);
 const w=new ExcelJS.Workbook();await w.xlsx.readFile(join(p,'report.xlsx'));w.removeWorksheet(w.getWorksheet('ISSUE_EVIDENCE').id);
 const ev=w.addWorksheet('ISSUE_EVIDENCE',{state:'veryHidden'}),json=JSON.stringify(rec);for(let i=0;i<json.length;i+=30000)ev.addRow([json.slice(i,i+30000)]);
 const bytes=Buffer.from(await w.xlsx.writeBuffer());await writeFile(join(p,'report.xlsx'),bytes);
 await writeFile(join(p,'manifest.json'),JSON.stringify({...rec,sha256:createHash('sha256').update(bytes).digest('hex')},null,2));
 const v2=await readIssuedMetaReport({outputDir:dir,since:'2026-10-13',until:'2026-10-19'});
 assert.equal(v2.policy,'META_WEEKLY_REVIEW_V2');assert.equal(first.publication.policy,'META_WEEKLY_REVIEW_V3');
 const next=await generateWeeklyMetaAdsReport(opts(dir,'2026-10-20'));
 assert.equal(next.ok,true,next.error);assert.equal(next.comparison.status,'RECONCILED');assert.equal(next.comparison.issuedRevenue,100000);
 assert.equal(next.publication.orders[0].grade,'G1_AD_ID');assert.deepEqual(next.publication.candidates,[]);
 assert.equal(next.publication.summary.metaPaidRevenue,100000);
});

test('scheduled V3 publication records the ad-name candidates and payment-unverified review reason',async()=>{
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
