import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActualProductsSold} from '../scripts/meta-actual-products-sold.mjs';
import {generateWeeklyMetaAdsReport} from '../scripts/meta-ads-weekly-report.mjs';
const period={since:'2026-10-06',until:'2026-10-12'};
const order={order_id:'paid-order',order_date:'2026-10-11',paid:'T',canceled:'F',payment_amount:198000,items:[{order_item_code:'item1',product_name:'Verified jeans',option_value:'XL',quantity:1,product_price:198000,status_code:'N1'}]};
const codes=['meta_meantime_look','meta_ssage','meta_adv_catalog','meta_adv_image','meta_adv_video'];
const data={source:'cafe24_inflow_queries',orders:[],trackingQueries:codes.map(code=>({code,ok:true,complete:true})),analyticsOrders:[order],analyticsOrdersComplete:true};
const analytics={ok:true,data:{orderdetails:[{order_id:'paid-order',ad:'ig',medium:'paid',content:'ad1',campaign:'camp1',order_amount:999999}]}};
const run=(extra={})=>buildActualProductsSold({data,analytics,metaAds:[{adId:'ad1',adName:'Confirmed ad'}],...period,...extra});
test('empty ghost filters still recover exact Analytics paid order with Admin product/payment evidence',()=>{
 const result=run();assert.equal(result.available,true);assert.equal(result.rows.length,1);assert.equal(result.summary.metaPaidOrderCount,1);assert.equal(result.summary.metaPaidRevenue,198000);assert.equal(result.rows[0].tracking_source,'META_PAID');assert.equal(result.rows[0].ad_mapping,'Confirmed ad');
});
test('union deduplicates overlap and does not infer organic/unmatched orders',()=>{
 const result=run({data:{...data,orders:[{...order,_metaTrackingCode:'meta_ssage'}],analyticsOrders:[order,order,{...order,order_id:'other'}]}});assert.equal(result.rows.length,1);assert.equal(result.summary.metaPaidRevenue,198000);
 assert.equal(run({analytics:{ok:true,data:{orderdetails:[{...analytics.data.orderdetails[0],medium:'social'}]}}}).rows.length,0);
});
test('cancel/refund exclude orders and partial claims keep only active remaining payment',()=>{
 for(const extra of [{canceled:'T'},{refunded:'T'}])assert.equal(run({data:{...data,analyticsOrders:[{...order,...extra}]}}).rows.length,0);
 const partial={...order,canceled:'M',cancel_date:'2026-10-12',actual_order_amount:{payment_amount:99000},items:[{...order.items[0],product_price:99000},{...order.items[0],order_item_code:'cancelled',status_code:'C1'}]};
 const result=run({data:{...data,analyticsOrders:[partial,partial]}});assert.equal(result.rows.length,1);assert.equal(result.summary.metaPaidRevenue,99000);
});
test('incomplete general orders or Analytics never turn into zero actual sales',()=>{
 assert.equal(run({data:{...data,analyticsOrdersComplete:false}}).available,false);
 assert.equal(run({analytics:{ok:false}}).available,false);
 assert.equal(run({data:{...data,analyticsOrders:[]}}).available,false);
 assert.equal(run({analytics:{ok:true,data:{}}}).available,false);
});
test('distinct item codes with the same SKU are real units; repeated item snapshots are deduplicated',()=>{
 const second={...order.items[0],order_item_code:'item2'};
 const result=run({data:{...data,analyticsOrders:[{...order,payment_amount:396000,items:[order.items[0],second,second]}]}});
 assert.equal(result.rows.length,2);assert.equal(result.rows.reduce((sum,r)=>sum+r.quantity,0),2);assert.equal(result.rows.reduce((sum,r)=>sum+(r.actual_paid_amount||0),0),396000);
});
test('explicit Tuesday-Monday period preserves comparison and opts into Analytics Admin orders',async()=>{
 const calls=[];let captured;
 const level={rows:[],totals:{spend:100,purchases:1,purchaseValue:999}};
 await generateWeeklyMetaAdsReport({period,onePage:true,fetchByLevel:async(s,u)=>{calls.push([s,u]);return level;},fetchActualOrders:async(s,u,options)=>{assert.equal(options.includeAnalyticsOrders,true);return data;},fetchActualAnalytics:async()=>analytics,saveReport:async w=>{captured=w;return {filePath:'fixture'};}});
 assert(calls.some(([s,u])=>s==='2026-09-29'&&u==='2026-10-05'));assert(captured.getWorksheet('REPORT'));assert(captured.getWorksheet('ACTUAL_PRODUCTS_SOLD'));assert.equal(captured.getWorksheet('REPORT').pageSetup.fitToHeight,1);
});

test('strict automated report refuses missing performance or actual coverage before saving',async()=>{
 for (const failure of ['ad','actual','previousActual']) {
  let saved=false;
  const result=await generateWeeklyMetaAdsReport({period,requireCompleteData:true,
   fetchByLevel:async(s,u,level)=>failure==='ad'&&level==='ad'?{ok:false}:{rows:[],totals:{}},
   fetchActualOrders:async(s)=>failure==='actual'||failure==='previousActual'&&s==='2026-09-29'?{ok:false}:data,
   fetchActualAnalytics:async()=>analytics,
   saveReport:async()=>{saved=true;return {filePath:'fixture'};}});
  assert.equal(result.ok,false);assert.equal(saved,false);assert.equal(result.filePath,null);
 }
});

test('strict report verifies both actual periods and exports confirmed quantities',async()=>{
 const ranges=[];let workbook;
 const result=await generateWeeklyMetaAdsReport({period,onePage:true,requireCompleteData:true,
 fetchByLevel:async()=>({rows:[],totals:{purchaseValue:1720000}}),
 fetchActualOrders:async(s,u)=>{ranges.push([s,u]);return {...data,analyticsOrders:[{...order,order_date:s}]};},
 fetchActualAnalytics:async()=>analytics,
 saveReport:async w=>{workbook=w;return {filePath:'fixture'};}});
 assert.equal(result.ok,true);assert.deepEqual(ranges,[['2026-10-06','2026-10-12'],['2026-09-29','2026-10-05']]);
 assert.equal(workbook.getWorksheet('ACTUAL_PRODUCTS_SOLD').getRow(2).getCell('quantity').value,1);
 assert.equal(workbook.getWorksheet('ACTUAL_PRODUCTS_SOLD').getRow(2).getCell('actual_paid_amount').value,198000);
});
