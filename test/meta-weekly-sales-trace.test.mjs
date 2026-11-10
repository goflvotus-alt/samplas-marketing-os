import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWeeklySalesTrace,fetchWeeklyItemPayments,addWeeklySalesTraceSheets} from '../scripts/meta-weekly-sales-trace.mjs';
import {buildWeeklyMetaReportModel,buildWeeklyMetaReportWorkbook} from '../scripts/meta-ads-weekly-report.mjs';
import ExcelJS from 'exceljs';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const scope={since:'2026-10-13',until:'2026-10-19'};
const item=(code,product,qty=1)=>({order_item_code:code,product_no:'12',variant_code:'P000000A',product_name:product,option_value:'COLOR=BLACK, SIZE=M',quantity:qty,product_price:'100',order_status:'N40'});
const order=(id,items,amount)=>({order_id:id,order_date:'2026-10-13T12:00:00+09:00',paid:'T',canceled:'F',actual_order_amount:{payment_amount:String(amount),shipping_fee:'0'},items});
const source=orders=>({analyticsOrders:orders,analyticsOrdersComplete:true,coverage:{completeness:'COMPLETE'},trackingQueries:[{code:'meta_adv_image',ok:true,complete:true,count:0}]});
test('all orders, not only Meta inflow, appear with exact options, cancellations and redacted private payment titles',()=>{
 const a=order('a',[item('a-1','[BRAND] Coat',2)],180),b={...order('b',[item('b-1','Person 개인정보 개인결제창')],20),canceled:'T'};
 const m=buildWeeklySalesTrace({...scope,actualOrders:source([a,a,b])});
 assert.equal(m.orders.length,2);assert.equal(m.details.length,2);assert.equal(m.summary.quantity,2);assert.equal(m.summary.revenue,180);assert.equal(m.details[0].option,'COLOR=BLACK, SIZE=M');
 assert.equal(m.details[0].salesAmount,180);assert.equal(m.details[1].salesAmount,0);assert(!JSON.stringify(m).includes('Person'));assert(m.warnings.includes('DUPLICATE_ORDER'));
});
test('multiple items never receive an arbitrary split; payment API amounts are line totals, reconciled independently',()=>{
 const o=order('a',[item('a-1','[B] A',2),item('a-2','[B] B')],270);
 let m=buildWeeklySalesTrace({...scope,actualOrders:source([o])});assert.equal(m.summary.unallocated,270);assert(m.details.every(r=>r.salesAmount===null));
 m=buildWeeklySalesTrace({...scope,actualOrders:source([o]),payments:{rows:[{order_item_code:'a-1',payment_amount:'180'},{order_item_code:'a-2',payment_amount:'90'}]}});
 assert.equal(m.summary.unallocated,0);assert.equal(m.details[0].salesAmount,180);assert.equal(m.products.reduce((s,p)=>s+p.quantity,0),3);assert.equal(m.products.reduce((s,p)=>s+p.amount,0),270);
 m=buildWeeklySalesTrace({...scope,actualOrders:source([o]),payments:{rows:[{order_item_code:'a-1',payment_amount:'180'},{order_item_code:'a-2',payment_amount:'80'}]}});assert.equal(m.summary.unallocated,270);assert(m.warnings.includes('ITEM_PAYMENT_RECONCILIATION_FAILED'));
});
test('a failed general-order scope never claims a complete all-order total; missing qty and duplicate conflicts remain warnings',()=>{
 const o=order('a',[item('a-1','[B] A')],100);delete o.items[0].quantity;
 const m=buildWeeklySalesTrace({...scope,actualOrders:{...source([o]),analyticsOrdersComplete:false}});assert.equal(m.completeness,'PARTIAL');assert(m.warnings.includes('ALL_ORDERS_UNVERIFIED'));assert.equal(m.details[0].quantity,null);assert.equal(m.daily[0].revenue,null);assert.equal(m.summary.quantity,null);
});
test('Meta product comparison joins only the existing product.variant identifier and never allocates an order event',()=>{
 const m=buildWeeklySalesTrace({...scope,actualOrders:source([order('a',[item('a-1','[B] A',2)],180)]),metaSummary:{purchases:14},metaProducts:{completeness:'COMPLETE',rows:[{ad_id:'ad',product_id:'12.P000000A',actions:[{action_type:'purchase',value:'3'}]},{product_id:'12',actions:[{action_type:'purchase',value:'7'}]}]}});
 assert.equal(m.metaProducts[0].actualQuantity,2);assert.equal(m.metaProducts[0].metaPurchases,3);assert.equal(m.metaProducts[1].actualQuantity,null);assert.equal(m.metaProducts[1].match,'UNRESOLVED');assert.equal(m.summary.matchedPurchaseEvents,0);
 assert.equal(m.summary.metaProductPurchases,10);assert(m.warnings.includes('META_PRODUCT_PURCHASE_TOTAL_DIFF'));
});
test('supplemental product pagination fails closed on the cap, without changing existing callers',async()=>{
 const code=await readFile(new URL('../server.mjs',import.meta.url),'utf8'),start=code.indexOf('async function graphGetAllPages('),end=code.indexOf('async function fetchAllCampaignsList',start);
 const context={graphGet:async()=>({data:[{}],paging:{next:'https://graph.facebook.com/next'}}),graphGetRawUrl:async()=>({data:[{}],paging:{next:'https://graph.facebook.com/next'}})};
 runInNewContext(code.slice(start,end)+'\nthis.get=graphGetAllPages;',context);
 await assert.rejects(context.get('x',{}, {maxPages:1,requireComplete:true}),/PAGE_LIMIT/);assert.equal((await context.get('x',{}, {maxPages:1})).length,1);
});
test('private payment names inside Meta product_id are redacted while retaining only the product identifier',()=>{
 const m=buildWeeklySalesTrace({...scope,actualOrders:source([]),metaProducts:{rows:[{product_id:'12.P000000A, Person 개인결제창',actions:[{action_type:'purchase',value:'1'}]}],completeness:'COMPLETE'}});
 assert(!JSON.stringify(m).includes('Person'));assert.equal(m.metaProducts[0].productNo,'12');
});
test('expired or malformed token expiry blocks the actual adapter before any HTTP or refresh',async()=>{
 const code=await readFile(new URL('../server.mjs',import.meta.url),'utf8');const start=code.indexOf('export async function fetchCafe24ItemPaymentsForWeeklyReport'),end=code.indexOf('export async function fetchMetaProductsForWeeklyReport',start);let calls=0;
 for(const expiresAt of ['not-a-date','2000-01-01T00:00:00Z']){
  const context={Date,readCafe24TokenRecord:async()=>({status:'active',accessToken:'fake',expiresAt}),fetchWeeklyItemPayments:async()=>{calls++;},cafe24OrderItems:o=>o.items};
  runInNewContext(code.slice(start,end).replace('export ', '')+'\nthis.read=fetchCafe24ItemPaymentsForWeeklyReport;',context);
  const result=await context.read(scope.since,scope.until,{actualOrders:source([order('a',[item('a-1','[B] A')],100)])});assert.equal(result.errors[0].reason,'TOKEN_REFRESH_PROHIBITED');
 }assert.equal(calls,0);
});
test('tracking distinguishes ad ID, unique name candidate, unknown and missing; URL secrets never appear',()=>{
 const orders=['a','b','c','d'].map(id=>order(id,[item(id+'-1','[B] A')],100));
 const m=buildWeeklySalesTrace({...scope,actualOrders:source(orders),analytics:{data:{orderdetails:[{order_id:'a',ad:'meta',medium:'paid',content:'11'},{order_id:'b',ad:'ig',medium:'paid',content:'Only Name'},{order_id:'c',ad:'meta',medium:'paid',content:'wrong'}]}},ads:[{adId:'11',adName:'Only Name'}],tracking:{completeness:'COMPLETE',rows:[{id:'11',creative:{url_tags:'utm_source=ig&utm_medium=paid&access_token=secret&email=pii@example.com'}}]}});
 assert.deepEqual(m.tracking.orders.map(r=>r.grade),['G1_AD_ID','G2_AD_NAME','G3_UNMATCHED','NO_INFLOW']);assert.equal(m.summary.ordersWithoutInflow,1);assert(m.warnings.includes('GHOST_MALL_ID_UNVERIFIED'));assert(!JSON.stringify(m).includes('secret'));assert(!JSON.stringify(m).includes('pii@example.com'));
});
test('payment batches use GET, safe error codes, no retries or refresh, and allowlisted response records',async()=>{
 const calls=[];const result=await fetchWeeklyItemPayments({codes:['a','a','b','c'],batchSize:2,get:async(path,params)=>{calls.push([path,params]);return calls.length===1?{paymentamount:[{order_item_code:'a',payment_amount:'80',buyer_email:'hidden'}]}:{error:{code:400,message:'자동계산을 사용하지 않는 품주입니다 buyer@example.com'}};}});
 assert.equal(calls.length,2);assert.equal(calls[0][0],'/orders/paymentamount');assert.equal(calls[0][1].order_item_code,'a,b');assert.equal(result.errors[0].reason,'AUTO_CALCULATION_UNAVAILABLE');assert(!JSON.stringify(result).includes('@'));assert(!JSON.stringify(result).includes('hidden'));
});
test('version failures are reported separately and cannot be mistaken for zero item amounts',async()=>{
 const result=await fetchWeeklyItemPayments({codes:['a'],get:async()=>({error:{code:400,message:'Requested 2025-07-01 is invalid version'}})});
 assert.equal(result.errors[0].reason,'API_VERSION_UNAVAILABLE');assert.equal(result.rows.length,0);assert.equal(result.completeness,'PARTIAL');
});
test('a successful empty payment result stays unavailable, not a complete zero-amount result',async()=>{
 const r=await fetchWeeklyItemPayments({codes:['a'],get:async()=>({paymentamount:[]})});assert.equal(r.completeness,'PARTIAL');assert.equal(r.errors[0].reason,'PAYMENT_RECORDS_MISSING');
});
test('weekly generator integrates all four sheets and preserves Meta KPIs; exported workbook contains no private title',async()=>{
 const payload={ok:true,rows:[],totals:{spend:20,purchases:2,purchaseValue:180,roas:9}},actualOrders=source([order('a',[item('a-1','Person 개인결제창')],180)]);
 const model=buildWeeklyMetaReportModel({...scope,current:{campaign:payload,ad:payload,adset:payload},actualOrders,actualAnalytics:{data:{orderdetails:[]}}});
 const workbook=await buildWeeklyMetaReportWorkbook(model);for(const n of ['ORDER_DETAIL','PRODUCT SUMMARY','META_PRODUCTS','TRACKING_DIAGNOSTICS'])assert(workbook.getWorksheet(n),n);
 assert.equal(model.summary.spend,20);assert.equal(model.summary.roas,9);const reloaded=new ExcelJS.Workbook();await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());assert(!JSON.stringify(reloaded.model).includes('Person'));
});
test('new scheduled adapters use existing product breakdown and GET-only Cafe24 transport without token refresh',async()=>{
 const code=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 const block=code.slice(code.indexOf('export async function fetchCafe24ItemPaymentsForWeeklyReport'),code.indexOf('// Query provenance is internal metadata'));
 assert.match(block,/fetchWeeklyItemPayments/);assert.match(block,/method:\s*["']GET["']/);assert.match(block,/fetchMetaProductBreakdownRows/);
 assert.doesNotMatch(block,/refreshCafe24Token|ensureCafe24AccessToken|writeCafe24TokenRecord|fetchCafe24ProductDetail/);
 assert.doesNotMatch(block,/X-Cafe24-Api-Version|cafe24OrdersApiVersion\(\)/);
 for(const name of ['fetchItemPayments: fetchCafe24ItemPaymentsForWeeklyReport','fetchMetaProducts: fetchMetaProductsForWeeklyReport','fetchAdTracking: fetchMetaAdTrackingForWeeklyReport'])assert(code.includes(name));
});
test('product grouping preserves each ad and reconciles 14 account / 11 product / 3 unbroken-down purchases',async()=>{
 const rows=[{ad_id:'a',ad_name:'Ad A',product_id:'12.P000000A',purchaseCount:7},{ad_id:'a',product_id:'12.P000000A',purchaseCount:2},{ad_id:'b',ad_name:'Ad B',product_id:'12.P000000A',purchaseCount:2}];
 const m=buildWeeklySalesTrace({...scope,ads:[{adId:'a',adName:'Ad A',purchases:9},{adId:'b',adName:'Ad B',purchases:2},{adId:'c',adName:'Ad C',purchases:3}],metaSummary:{purchases:14},metaProducts:{rows,completeness:'COMPLETE'}});
 assert.equal(m.metaProducts.length,2);assert.deepEqual(m.metaProducts.map(r=>[r.adId,r.adName,r.metaPurchases]),[['a','Ad A',9],['b','Ad B',2]]);
 assert.equal(m.summary.metaAccountPurchases,14);assert.equal(m.summary.metaProductPurchases,11);assert.equal(m.metaAdDifferences.reduce((s,r)=>s+r.metaPurchases,0),3);
 const wb=new ExcelJS.Workbook();addWeeklySalesTraceSheets(wb,m);const saved=new ExcelJS.Workbook();await saved.xlsx.load(await wb.xlsx.writeBuffer());const sh=saved.getWorksheet('META_PRODUCTS');
 assert(sh.getRow(1).values.includes('Meta 귀속 구매 (광고 노출 상품 기준 · 실제 판매 상품 아님)'));assert(sh.getRow(1).values.includes('광고 ID'));assert(sh.getRow(1).values.includes('광고명'));
 assert(sh.getRows(2,sh.rowCount-1).some(r=>r.values.includes('product_id 없음 / 상품별 분해 불가')));
});
test('same product number with a different variant is PRODUCT_NO_ONLY without actual sales matching',()=>{
 const m=buildWeeklySalesTrace({...scope,actualOrders:source([order('a',[item('a-1','[B] A',2)],180)]),metaProducts:{completeness:'COMPLETE',rows:[{ad_id:'a',product_id:'12.OTHER',purchaseCount:1}]}});
 assert.equal(m.metaProducts[0].match,'PRODUCT_NO_ONLY');assert.equal(m.metaProducts[0].actualQuantity,null);assert.equal(m.metaProducts[0].actualAmount,null);assert.equal(m.summary.matchedPurchaseEvents,0);
});
test('missing or contradictory ad evidence never becomes an asserted missing-product count',()=>{
 for(const [total,complete] of [[undefined,'COMPLETE'],[2,'PARTIAL'],[0,'COMPLETE']]){
  const m=buildWeeklySalesTrace({...scope,ads:[{adId:'a',purchases:total}],metaProducts:{completeness:complete,rows:[{ad_id:'a',product_id:'12.P000000A',purchaseCount:1}]}});
  assert.equal(m.metaAdDifferences[0].metaPurchases,null);assert.match(m.metaAdDifferences[0].note,/원인 확정 불가/);
 }
});
test('summary explicitly labels the Cafe24 source snapshot time',()=>{
 const wb=new ExcelJS.Workbook();wb.addWorksheet('SUMMARY').columns=[{key:'label'},{key:'current'},{key:'previous'},{key:'change'}];
 addWeeklySalesTraceSheets(wb,buildWeeklySalesTrace({...scope,actualOrders:source([])}));
 assert(JSON.stringify(wb.model).includes('Cafe24 조회 시점 상태 (source snapshot time)'));assert(!JSON.stringify(wb.model).includes('조회 현재 상태'));
});
