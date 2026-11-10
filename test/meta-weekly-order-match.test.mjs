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
 assert.equal(t.orders[0].revenue,628000);assert.equal(t.orders[0].initialAmount,628000);assert.equal(t.orders[0].refundAmount,0);
});

test('multi-item orders put order-level cash/refund on one row only; item and order sums never double count',()=>{
 const o=order('MULTI',300,400);o.items=[{...o.items[0],order_item_code:'M-1',product_price:200},{...o.items[0],order_item_code:'M-2',product_price:100}];
 const p={...paymentOrders,orders:[o]},evidence=buildRevenueEvidence({since,until,paymentOrders:p,analytics:{ok:true,coverage,data:{orderdetails:[]}},metaAds:ads});
 const t=attachWeeklyOrderMatch(buildWeeklySalesTrace({since,until,actualOrders:{paymentOrders:p},payments:{rows:[{order_item_code:'M-1',payment_amount:'200'},{order_item_code:'M-2',payment_amount:'100'}]}}),evidence);
 assert.equal(t.details.length,2);
 assert.deepEqual(t.details.map(d=>d.orderCash),[300,null]);assert.deepEqual(t.details.map(d=>d.orderRefund),[100,null]);
 assert.equal(t.details.reduce((s,d)=>s+(d.orderCash||0),0),300);assert.equal(t.details.reduce((s,d)=>s+d.paidAmount,0),300);
});
