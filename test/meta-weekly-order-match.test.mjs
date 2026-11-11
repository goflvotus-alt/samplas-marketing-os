import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {buildRevenueEvidence} from '../scripts/meta-weekly-revenue.mjs';
import {buildWeeklySalesTrace,attachWeeklyOrderMatch,addWeeklySalesTraceSheets} from '../scripts/meta-weekly-sales-trace.mjs';
import {orderMatchLine} from '../scripts/weekly-onepage-report.mjs';

const since='2026-10-06',until='2026-10-12',coverage={completeness:'COMPLETE',scope:{since,until}};
const order=(id,amount,initial=amount,extra={})=>({order_id:id,order_date:'2026-10-05T12:00:00+09:00',payment_date:'2026-10-11T00:10:00+09:00',paid:'T',canceled:'F',actual_order_amount:{payment_amount:amount,shipping_fee:'0'},initial_order_amount:{payment_amount:initial},items:[{order_item_code:id+'-1',product_no:'7',variant_code:'P000000A',product_name:'[MEANTIME] Denim',option_value:'SIZE=M',quantity:1,product_price:amount,order_status:'N40'}],...extra});
const inflow=(id,ad,medium,content)=>({order_id:id,order_date:since,ad,medium,content,campaign:'',keyword:'',order_amount:1});
// 10/11 regression shape: G1 ad-ID order, G2 name-only candidate, naver shopping, no inflow, canceled.
const orders=[order('20261011-0000055',150000,198000),order('G2',100000),order('NAVER',50000),order('NONE',30000),order('CANCEL',0,80000,{canceled:'T'})];
const analytics={ok:true,coverage,data:{orderdetails:[inflow('20261011-0000055','ig','paid','ad1'),inflow('G2','meta','paid','Catalog Video'),inflow('NAVER','naver','shopping','')]}};
const ads=[{adId:'ad1',adName:'Look'},{adId:'ad2',adName:'Catalog Video'}];
const paymentOrders={orders,coverage,dateType:'pay_date',queriedAt:'2026-10-13T01:00:00Z'};

test('pay-date orders all appear; only the existing G1 evidence counts as matched and matched+unmatched equals total',async()=>{
 const evidence=buildRevenueEvidence({since,until,paymentOrders,analytics,metaAds:ads});
 const trace=attachWeeklyOrderMatch(buildWeeklySalesTrace({since,until,actualOrders:{paymentOrders,analyticsOrders:[order('OTHER',1)]},analytics,ads,metaSummary:{purchases:9}}),evidence,{attribution:{completeness:'COMPLETE',totals:{click:{purchases:3},view:{purchases:6}}}});
 assert.equal(trace.basis,'PAY_DATE');
 assert.deepEqual(trace.orders.map(o=>o.orderId),orders.map(o=>o.order_id));
 const status=Object.fromEntries(trace.orders.map(o=>[o.orderId,o.matchStatus]));
 assert.deepEqual(status,{'20261011-0000055':'MATCHED',G2:'UNMATCHED',NAVER:'UNMATCHED',NONE:'UNMATCHED',CANCEL:'EXCLUDED_CANCELED'});
 const m=trace.match;
 assert.deepEqual([m.paidOrders,m.matched,m.unmatched,m.unknown],[4,1,3,0]);
 assert.equal(m.matched+m.unmatched,m.paidOrders);
 assert.equal(m.matchedPayment,198000);assert.equal(m.matchedNet,150000);
 assert.equal(trace.orders[0].refundAmount,48000);assert.equal(trace.orders[0].matchAdId,'ad1');
 const reason=Object.fromEntries(trace.orders.map(o=>[o.orderId,o.matchReason]));
 assert.match(reason.G2,/G2_AD_NAME/);assert.match(reason.NAVER,/naver\/shopping/);assert.match(reason.NONE,/NO_INFLOW/);
 assert.equal(m.g2Candidates,1);assert.equal(m.g3Unmatched,0);
 assert.equal(trace.orders.find(o=>o.orderId==='G2').matchGrade,'G2_AD_NAME');assert.equal(trace.orders[0].matchGrade,'G1_AD_ID');
 // Valid trace orders reconcile to the same pay-date revenue as REPORT/ISSUE_EVIDENCE.
 assert.equal(trace.orders.filter(o=>!o.excluded).reduce((s,o)=>s+o.revenue,0),evidence.onlineRevenue);
 assert.equal(orderMatchLine(m),'Cafe24 결제 4건 · Meta 광고 매칭 1건 (결제 198,000원 · 순매출 150,000원) · 미매칭 3건 · G2 후보 1건(미포함) · Meta 보고 구매 9건(클릭 3·노출 6) 별도 기준');
 const wb=new ExcelJS.Workbook();wb.addWorksheet('SUMMARY').columns=[{key:'label'},{key:'current'},{key:'previous'},{key:'change'}];
 addWeeklySalesTraceSheets(wb,trace);
 const back=new ExcelJS.Workbook();await back.xlsx.load(await wb.xlsx.writeBuffer());
 const detail=back.getWorksheet('ORDER_DETAIL'),head=detail.getRow(1).values;
 const col=name=>head.indexOf(name);
 const ids=new Set();detail.eachRow((r,n)=>{if(n>1&&r.getCell(col('주문번호')).value)ids.add(r.getCell(col('주문번호')).value);});
 assert.equal(ids.size,5);
 const g1=detail.getRow(2);assert.equal(g1.getCell(col('Meta 광고 매칭')).value,'MATCHED');assert.equal(g1.getCell(col('주문 환불·취소액 (주문 첫 행만)')).value,48000);assert.equal(g1.getCell(col('상품명')).value,'[MEANTIME] Denim');
 const diag=[];back.getWorksheet('TRACKING_DIAGNOSTICS').eachRow((r,n)=>{if(n>1&&r.getCell(1).value==='ORDER_INFLOW')diag.push(r.values.filter(v=>v!==undefined&&v!==null).join('|'));});
 assert.equal(diag.length,5);
 const gcol=col('유입 등급 (G1/G2 후보/G3)');let g2Row=false;detail.eachRow((r,n)=>{if(n>1&&r.getCell(col('주문번호')).value==='G2')g2Row=r.getCell(gcol).value==='G2_AD_NAME'&&r.getCell(col('Meta 광고 매칭')).value==='UNMATCHED';});assert(g2Row);assert(diag.some(d=>/G2\|.*UNMATCHED.*G2_AD_NAME/.test(d)));
 const summary=[];back.getWorksheet('SUMMARY').eachRow(r=>summary.push(`${r.getCell(1).value}=${r.getCell(2).value}`));
 for(const s of ['G2 광고명 후보 (매칭 미포함)=1','Cafe24 전체 결제 주문 (결제일 기준)=4','Meta 광고 연결 매칭 성공 주문=1','미매칭 주문=3','매칭 주문 실제 결제금액=198000','매칭 주문 순매출=150000','Meta 보고 구매 (Meta 귀속 · 별도 기준)=9'])assert(summary.includes(s),s);
});

test('unverified link evidence never reports zero matches',()=>{
 const evidence=buildRevenueEvidence({since,until,paymentOrders,analytics:{ok:false},metaAds:ads});
 const trace=attachWeeklyOrderMatch(buildWeeklySalesTrace({since,until,actualOrders:{paymentOrders},analytics,ads}),evidence);
 assert.equal(trace.match.matched,null);assert.equal(trace.match.unmatched,null);assert.equal(trace.match.unknown,4);
 assert(trace.orders.filter(o=>!o.excluded).every(o=>o.matchStatus==='UNKNOWN'));
 assert.match(orderMatchLine(trace.match),/Meta 광고 매칭 미검증 .* 검증불가 4건/);
});

test('stored-value orders keep a zero refund on the restored V2 basis',()=>{
 // Same financial shape as the real 2026-11-08 stored-value order (test/meta-stored-value-real.test.mjs).
 const amt={payment_amount:'0.00',order_price_amount:'628000.00',points_spent_amount:'0.00',credits_spent_amount:'0.00',membership_discount_amount:'0.00',coupon_discount_price:'0.00'};
 const o={...order('SV',0,0),payment_method_name:'선불금',payment_amount:'0.00',actual_order_amount:amt,initial_order_amount:{...amt}};
 const t=buildWeeklySalesTrace({since,until,actualOrders:{paymentOrders:{...paymentOrders,orders:[o]}}});
 assert.equal(t.orders[0].revenue,628000);assert.equal(t.orders[0].storedValue,true);assert.equal(t.orders[0].initialAmount,628000);assert.equal(t.orders[0].refundAmount,0);
});

test('multi-item orders put order-level cash/refund on one row only; item and order sums never double count',()=>{
 const o=order('MULTI',300,400);o.items=[{...o.items[0],order_item_code:'M-1',product_price:200},{...o.items[0],order_item_code:'M-2',product_price:100}];
 const p={...paymentOrders,orders:[o]},evidence=buildRevenueEvidence({since,until,paymentOrders:p,analytics:{ok:true,coverage,data:{orderdetails:[]}},metaAds:ads});
 const t=attachWeeklyOrderMatch(buildWeeklySalesTrace({since,until,actualOrders:{paymentOrders:p},payments:{rows:[{order_item_code:'M-1',payment_amount:'200'},{order_item_code:'M-2',payment_amount:'100'}]}}),evidence);
 assert.equal(t.details.length,2);
 assert.deepEqual(t.details.map(d=>d.orderCash),[300,null]);assert.deepEqual(t.details.map(d=>d.orderRefund),[100,null]);
 assert.equal(t.details.reduce((s,d)=>s+(d.orderCash||0),0),300);assert.equal(t.details.reduce((s,d)=>s+d.paidAmount,0),300);
});

test('REPORT 04 keeps all counts but lists only confirmed matches; unmatched and canceled stay off page one; actions move to 05',async()=>{
 const {generateWeeklyMetaAdsReport}=await import('../scripts/meta-ads-weekly-report.mjs');
 const s2='2026-11-03',u2='2026-11-09',cov=(s,u)=>({completeness:'COMPLETE',scope:{since:s,until:u}});
 const pay=(id,amount,initial=amount,extra={})=>({...order(id,amount,initial,extra),payment_date:'2026-11-05T10:00:00+09:00'});
 const multi=pay('MULTI',300000);multi.items=[{...multi.items[0],order_item_code:'M-1',product_name:'[B] Coat'},{...multi.items[0],order_item_code:'M-2',product_name:'[B] Cap'}];
 const current=[pay('UNM',50000),multi,pay('G1',198000),pay('CANCEL',0,80000,{canceled:'T'})];
 const lv=Object.fromEntries(['campaign','adset','ad'].map(l=>[l,{rows:l==='ad'?[{adId:'ad1',adName:'Look',spend:10,purchases:9}]:[],totals:{purchaseValue:100,purchases:9,spend:20,roas:5,cpa:10,ctr:0.02,cpc:1}}]));
 let wb;
 await generateWeeklyMetaAdsReport({period:{since:s2,until:u2},onePage:true,publicationMode:'preview',fetchByLevel:async(s,u,level)=>lv[level],
  fetchActualOrders:async(s,u)=>({paymentOrders:{orders:s===s2?current:[],coverage:cov(s,u),dateType:'pay_date',queriedAt:'2026-11-10T01:00:00Z'}}),
  fetchActualAnalytics:async(s,u)=>({ok:true,coverage:cov(s,u),data:{orderdetails:s===s2?[{...inflow('G1','ig','paid','ad1'),order_date:s2}]:[]}}),
  saveReport:async w=>{wb=new ExcelJS.Workbook();await wb.xlsx.load(await w.xlsx.writeBuffer());return {filePath:'preview.xlsx'};}});
 const r=wb.getWorksheet('REPORT'),t=a=>{const v=r.getCell(a).value;return v&&typeof v==='object'&&'result' in v?v.result:v;};
 assert.match(t('A43'),/^04  주문 매칭 현황/);
 assert.deepEqual([t('A45'),t('E45'),t('I45')],[3,1,2]);
 assert.deepEqual([t('A47'),t('D47'),t('J47'),t('L47')],['주문번호','제품명','옵션 / 사이즈','결제금액']);
 assert.deepEqual([t('A48'),t('D48'),t('L48')],['G1','[MEANTIME] Denim',198000]);
 assert.match(t('A49'),/확정 매칭 주문 1건/);assert.equal(t('L49'),198000);assert.equal(r.getCell('L49').value.formula,'SUM(L48:L48)');
 const page=JSON.stringify(r.getSheetValues());for(const id of ['UNM','MULTI','CANCEL'])assert(!page.includes(`"${id}"`),id);
 assert.match(t('A51'),/^05  다음 액션/);assert.equal(t('A57'),'SOURCE / DATA NOTE');
 const ids=new Set();wb.getWorksheet('ORDER_DETAIL').eachRow((row,n)=>{if(n>1&&row.getCell(2).value)ids.add(row.getCell(2).value);});assert.deepEqual([...ids].sort(),['CANCEL','G1','MULTI','UNM']);
 assert.equal(t('C16'),548000);
});

test('REPORT 04 expands with order count, keeps 05/notes below, and labels stored-value amounts without changing them',async()=>{
 const {generateWeeklyMetaAdsReport}=await import('../scripts/meta-ads-weekly-report.mjs');
 const s2='2026-11-03',u2='2026-11-09',cov=(s,u)=>({completeness:'COMPLETE',scope:{since:s,until:u}});
 const amt={payment_amount:'0.00',order_price_amount:'628000.00',points_spent_amount:'0.00',credits_spent_amount:'0.00',membership_discount_amount:'0.00',coupon_discount_price:'0.00'};
 const sv={...order('SV',0,0),payment_date:'2026-11-08T04:02:14+09:00',payment_method_name:'선불금',payment_amount:'0.00',actual_order_amount:amt,initial_order_amount:{...amt}};
 const many=Array.from({length:30},(_,i)=>({...order('O'+String(i).padStart(2,'0'),1000),payment_date:'2026-11-04T10:00:00+09:00'}));
 const lv=Object.fromEntries(['campaign','adset','ad'].map(l=>[l,{rows:l==='ad'?[{adId:'ad1',adName:'Look',spend:10,purchases:9}]:[],totals:{purchaseValue:100,purchases:9,spend:20,roas:5,cpa:10,ctr:0.02,cpc:1}}]));
 const all=[sv,...many];let wb;
 await generateWeeklyMetaAdsReport({period:{since:s2,until:u2},onePage:true,publicationMode:'preview',fetchByLevel:async(s,u,l)=>lv[l],
  fetchActualOrders:async(s,u)=>({paymentOrders:{orders:s===s2?all:[],coverage:cov(s,u),dateType:'pay_date',queriedAt:'2026-11-10T01:00:00Z'}}),
  fetchActualAnalytics:async(s,u)=>({ok:true,coverage:cov(s,u),data:{orderdetails:s===s2?all.map(o=>({...inflow(o.order_id,'ig','paid','ad1'),order_date:s2})):[]}}),
  saveReport:async w=>{wb=new ExcelJS.Workbook();await wb.xlsx.load(await w.xlsx.writeBuffer());return {filePath:'preview.xlsx'};}});
 const r=wb.getWorksheet('REPORT'),t=a=>{const v=r.getCell(a).value;return v&&typeof v==='object'&&'result' in v?v.result:v;};
 assert.deepEqual([t('A45'),t('E45'),t('I45')],[31,31,0]);
 assert.equal(t('A48'),'SV');assert.equal(t('L48'),628000);assert.match(r.getCell('L48').numFmt,/선불금/);
 assert.equal(t('A78'),'O29');assert.match(t('A79'),/확정 매칭 주문 31건/);assert.equal(t('L79'),658000);
 assert.match(t('A81'),/^05  다음 액션/);assert.equal(t('A87'),'SOURCE / DATA NOTE');
 assert.equal(t('C16'),658000);
});

test('REPORT 04 with zero confirmed matches shows the empty notice and keeps counts',async()=>{
 const {generateWeeklyMetaAdsReport}=await import('../scripts/meta-ads-weekly-report.mjs');
 const s2='2026-11-03',u2='2026-11-09',cov=(s,u)=>({completeness:'COMPLETE',scope:{since:s,until:u}});
 const lv=Object.fromEntries(['campaign','adset','ad'].map(l=>[l,{rows:[],totals:{purchaseValue:100,purchases:9,spend:20,roas:5,cpa:10,ctr:0.02,cpc:1}}]));
 const orders=['A','B'].map(id=>({...order(id,1000),payment_date:'2026-11-04T10:00:00+09:00'}));let wb;
 await generateWeeklyMetaAdsReport({period:{since:s2,until:u2},onePage:true,publicationMode:'preview',fetchByLevel:async(s,u,l)=>lv[l],
  fetchActualOrders:async(s,u)=>({paymentOrders:{orders:s===s2?orders:[],coverage:cov(s,u),dateType:'pay_date',queriedAt:'2026-11-10T01:00:00Z'}}),
  fetchActualAnalytics:async(s,u)=>({ok:true,coverage:cov(s,u),data:{orderdetails:[]}}),
  saveReport:async w=>{wb=new ExcelJS.Workbook();await wb.xlsx.load(await w.xlsx.writeBuffer());return {filePath:'preview.xlsx'};}});
 const r=wb.getWorksheet('REPORT'),t=a=>r.getCell(a).value;
 assert.deepEqual([t('A45'),t('E45'),t('I45')],[2,0,2]);assert.equal(t('A48'),'확정 매칭된 주문 없음');
 assert.match(t('A50'),/^05  다음 액션/);assert.equal(t('A56'),'SOURCE / DATA NOTE');
});
