import test from 'node:test';
import ExcelJS from 'exceljs';
import assert from 'node:assert/strict';
import {buildRevenueEvidence} from '../scripts/meta-weekly-revenue.mjs';
const since='2026-11-03',until='2026-11-09';
const coverage={completeness:'COMPLETE',scope:{since,until}};
const order=(id,amount=100)=>({order_id:id,order_date:'2026-11-01',payment_date:'2026-11-04T00:00:00+09:00',paid:'T',actual_order_amount:{payment_amount:amount},initial_order_amount:{payment_amount:100},items:[{order_item_code:id+'-1',product_name:'Item',quantity:1,product_price:amount,order_status:'N40'}]});
const source=orders=>({orders,coverage,dateType:'pay_date',queriedAt:'2026-11-10T12:00:00Z'});
const analytics=rows=>({ok:true,coverage,data:{orderdetails:rows}});
const row=(id,content='ad1')=>({order_id:id,order_date:since,ad:'ig',medium:'paid',content,campaign:'',keyword:'',order_amount:100});
const run=(orders,rows=[],extra={})=>buildRevenueEvidence({since,until,paymentOrders:source(orders),analytics:analytics(rows),metaAds:[{adId:'ad1',adName:'Name'}],...extra});
test('paid-date orders deduplicate; partial cancellation uses remaining canonical payment once',()=>{const a=order('A',60);a.canceled='M';const b=order('B');const e=run([a,a,b],[row('A'),row('B','Name')]);assert.equal(e.onlineRevenue,160);assert.equal(e.onlineOrders,2);assert.equal(e.adjustment,-40);assert.equal(e.verifiedRevenue,60);assert.equal(e.verifiedOrders,1);assert.equal(e.unlinkedOrders,1);assert.equal(e.duplicateOrders,1);});
test('missing payment, failed/partial coverage and unknown paid state are not zero',()=>{for(const change of [o=>delete o.actual_order_amount,o=>o.paid='?',o=>o.actual_order_amount.payment_amount=0]){const o=order('A');change(o);assert.equal(run([o]).onlineRevenue,null);}assert.equal(run([] ,[],{paymentOrders:{...source([]),coverage:{completeness:'PARTIAL'}}}).onlineRevenue,null);assert.equal(run([],[],{paymentOrders:undefined}).onlineRevenue,null);});
test('complete empty result is a real zero; analytics failure cannot invalidate independent online total',()=>{assert.equal(run([]).onlineRevenue,0);const e=run([order('A')],[],{analytics:{ok:false}});assert.equal(e.onlineRevenue,100);assert.equal(e.verifiedRevenue,null);assert.equal(e.unknownLinkOrders,1);});
test('full refunds excluded; unpaid orders excluded; conflicting duplicate evidence fails closed',()=>{const a=order('A',0);a.canceled='T';const b=order('B');b.paid='F';const e=run([a,b]);assert.equal(e.onlineRevenue,0);assert.equal(e.onlineOrders,0);assert.equal(e.adjustment,-100);assert.equal(run([order('X'),order('X',60)]).onlineRevenue,null);});
test('UTC boundary is converted to KST; advertising candidates without order IDs cannot add revenue',()=>{const o=order('A');o.payment_date='2026-11-02T15:00:00Z';assert.equal(run([o],[row('', 'ad1')]).verifiedRevenue,0);o.payment_date='2026-11-09T15:00:00Z';assert.equal(run([o]).onlineRevenue,null);});
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {paymentDay} from '../scripts/meta-weekly-revenue.mjs';
import {cafe24OrdersCoverage} from '../scripts/weekly-data-completeness.mjs';
test('existing Admin reader requests payment dates with explicit KST boundaries; old callers unchanged',async()=>{
 const code=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 const fn=code.slice(code.indexOf('async function cafe24GetOrders('),code.indexOf('async function cafe24FetchOrdersPage('));
 const urls=[];const c=vm.createContext({URL,env:{CAFE24_MALL_ID:'test'},paymentDay,cafe24OrdersCoverage,attachCafe24OrderItems:async()=>{},cafe24FetchOrdersPage:async url=>{urls.push(new URL(url));return {orders:[order('A')]};}});
 vm.runInContext(fn,c);const result=await c.cafe24GetOrders(since,until,{strictOrders:true,dateType:'pay_date'});
 assert.equal(urls[0].searchParams.get('date_type'),'pay_date');assert.equal(urls[0].searchParams.get('start_date'),since+'T00:00:00+09:00');assert.equal(urls[0].searchParams.get('end_date'),until+'T23:59:59+09:00');assert.equal(result.coverage.completeness,'COMPLETE');
 await c.cafe24GetOrders(since,until,{});assert.equal(urls[1].searchParams.has('date_type'),false);assert.equal(urls[1].searchParams.get('start_date'),since);
});
import {buildWeeklyMetaReportModel,buildWeeklyMetaReportWorkbook,generateWeeklyMetaAdsReport} from '../scripts/meta-ads-weekly-report.mjs';
const levels=(value=100,count=2)=>Object.fromEntries(['campaign','adset','ad'].map(level=>[level,{rows:[],totals:{purchaseValue:value,purchases:count,spend:20,roas:5,cpa:10,ctr:0.02,cpc:1}}]));
test('REPORT contains six separate metrics, agrees with evidence and has guarded WoW formulas',async()=>{
 const model=buildWeeklyMetaReportModel({current:levels(),previous:levels(50,1),since,until,previousSince:'2026-10-27',previousUntil:'2026-11-02'});
 model.revenueEvidence={current:run([order('A')],[row('A')]),previous:{...run([]),onlineRevenue:50,onlineOrders:1,verifiedRevenue:null,verifiedOrders:null}};
 const w=await buildWeeklyMetaReportWorkbook(model,{onePage:true});const s=w.getWorksheet('REPORT'),e=w.getWorksheet('ISSUE_EVIDENCE');
 assert.match(s.getCell('D28').value,/온라인 1건 100원/);assert.match(s.getCell('D28').value,/Meta 연결 검증 1건 100원/);
 assert.equal(s.getCell('C16').value,100);assert.equal(s.getCell('C16').value,e.getCell('D3').value);assert.equal(s.getCell('C17').value,e.getCell('D4').value);assert.equal(s.getCell('E17').value,'UNVERIFIED');
 assert.equal(s.getCell('G16').value.result,1);assert.match(s.getCell('G16').value.formula,/ISNUMBER/);assert.equal(s.getCell('G17').value.result,'N/A');assert.equal(s.pageSetup.fitToHeight,1);
});
test('draft generator collects current and previous evidence with the existing fetcher',async()=>{
 const periods=[];let captured;
 await generateWeeklyMetaAdsReport({period:{since,until},onePage:true,fetchByLevel:async()=>levels().campaign,fetchActualOrders:async(s,u)=>{periods.push(s);return {paymentOrders:{...source([]),coverage:{completeness:'COMPLETE',scope:{since:s,until:u}}}};},fetchActualAnalytics:async(s,u)=>({ok:true,data:{orderdetails:[]},coverage:{completeness:'COMPLETE',scope:{since:s,until:u}}}),saveReport:async w=>{captured=w;return {filePath:'not-written'};}});
 assert.deepEqual(periods,[since,'2026-10-27']);assert.equal(captured.getWorksheet('REPORT').getCell('C16').value,0);assert.equal(captured.getWorksheet('REPORT').getCell('E16').value,0);
});
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readIssuedMetaReport} from '../scripts/meta-issued-report.mjs';
import {minimizeCafe24Source} from '../scripts/meta-weekly-cafe24-source.mjs';
test('complete payment-date evidence publishes PASS and preserves immutable JSON ledger readback',async()=>{
 const outputDir=await mkdtemp(join(tmpdir(),'samplas-revenue-publish-'));
 const admin={...order('A'),order_date:'2026-11-04'};
 const r=await generateWeeklyMetaAdsReport({outputDir,env:{},referenceDateKey:'2026-11-10',period:{since,until},onePage:true,requireCompleteData:true,now:()=>new Date('2026-11-10T01:00:00Z'),
  fetchByLevel:async()=>({completeness:'COMPLETE',rows:[{adId:'ad1',adName:'Name'}],totals:{...levels().campaign.totals,impressions:1000,clicks:20}}),
  fetchActualOrders:async(s,u)=>{const orders=s===since?[admin]:[],c={completeness:'COMPLETE',scope:{since:s,until:u}};return {source:'cafe24_inflow_queries',orders:[],trackingQueries:['meta_meantime_look','meta_ssage','meta_adv_catalog','meta_adv_image','meta_adv_video'].map(code=>({code,ok:true,complete:true,count:0})),coverage:c,analyticsOrders:orders,analyticsOrdersComplete:true,analyticsOrdersCoverage:c,paymentOrders:{orders,coverage:c,dateType:'pay_date',queriedAt:'2026-11-10T01:00:00Z'}};},
  fetchActualAnalytics:async(s,u)=>({ok:true,coverage:{completeness:'COMPLETE',scope:{since:s,until:u}},data:{orderdetails:s===since?[row('A')]:[]}})
 });
 assert.equal(r.review.result,'PASS');const issued=await readIssuedMetaReport({outputDir,since,until});assert.equal(issued.revenueEvidence.current.onlineRevenue,100);assert.equal(issued.revenueEvidence.current.verifiedRevenue,100);assert.equal(issued.orders.length,1);assert.equal(issued.revenueEvidence.current.linkEvidence[0].adId,'ad1');
});
test('payment source uses existing privacy allowlist, never customer details',()=>{
 const o={...order('A'),buyer_name:'PRIVATE',email:'PRIVATE',receiver_address:'PRIVATE'};
 const r=minimizeCafe24Source('actual',{source:'cafe24_inflow_queries',orders:[],trackingQueries:[],coverage,paymentOrders:source([o])});
 assert.equal(r.paymentOrders.orders[0].order_id,'A');assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});

test('stored-value zero cash uses canonical initial and remaining values, including discounts and exact ad ID',()=>{
 const o={...order('stored',0),payment_method_name:'선불금',actual_order_amount:{payment_amount:0,order_price_amount:280000},initial_order_amount:{payment_amount:0,order_price_amount:280000},items:[{order_item_code:'stored-1',order_status:'N40',quantity:1,product_price:280000,additional_discount_price:112000}]};
 const e=run([o,o],[row('stored')]);assert.equal(e.status,'PASS');assert.equal(e.onlineRevenue,168000);assert.equal(e.grossPayment,168000);assert.equal(e.adjustment,0);assert.equal(e.onlineOrders,1);assert.equal(e.verifiedRevenue,168000);assert.equal(e.verifiedOrders,1);assert.equal(e.duplicateOrders,1);
 assert.equal(run([o],[row('stored','Name')]).verifiedRevenue,0);
});
test('partial refund excludes completed returned item without subtracting remaining payment again',()=>{
 const o={...order('partial',60),canceled:'M',refund_date:'2026-11-05',items:[{order_item_code:'kept',order_status:'N40',quantity:1,product_price:60},{order_item_code:'returned',order_status:'R40',quantity:1,product_price:40,refund_date:'2026-11-05'}]};
 const e=run([o],[row('partial')]);assert.equal(e.status,'PASS');assert.equal(e.onlineRevenue,60);assert.equal(e.verifiedRevenue,60);assert.equal(e.adjustment,-40);assert.equal(e.onlineOrders,1);
});
test('stored-value designation alone cannot verify an absent payment or canceled items',()=>{
 const a={...order('missing'),payment_method_name:'선불금'};delete a.actual_order_amount;assert.equal(run([a]).onlineRevenue,null);
 const b={...order('inactive',0),payment_method_name:'선불금',actual_order_amount:{payment_amount:0,order_price_amount:100},items:[{order_item_code:'canceled',order_status:'C40',quantity:1,product_price:100}]};assert.equal(run([b]).onlineRevenue,null);
});
test('preview workbook keeps ISSUE_EVIDENCE veryHidden after an XLSX round-trip, REPORT values unchanged',async()=>{
 let bytes;
 const r=await generateWeeklyMetaAdsReport({period:{since,until},onePage:true,publicationMode:'preview',fetchByLevel:async()=>levels().campaign,fetchActualOrders:async(s,u)=>({paymentOrders:{...source([]),coverage:{completeness:'COMPLETE',scope:{since:s,until:u}}}}),fetchActualAnalytics:async(s,u)=>({ok:true,data:{orderdetails:[]},coverage:{completeness:'COMPLETE',scope:{since:s,until:u}}}),saveReport:async w=>{bytes=Buffer.from(await w.xlsx.writeBuffer());return {filePath:'preview.xlsx'};}});
 assert.equal(r.ok,true);
 const l=new ExcelJS.Workbook();await l.xlsx.load(bytes);
 assert.equal(l.getWorksheet('ISSUE_EVIDENCE').state,'veryHidden');
 assert.equal(l.getWorksheet('REPORT').state,'visible');
 assert.equal(l.getWorksheet('REPORT').getCell('C16').value,0);assert.equal(l.getWorksheet('ISSUE_EVIDENCE').getCell('D3').value,0);
});
