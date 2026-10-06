import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActualProductsSold} from '../scripts/meta-actual-products-sold.mjs';
import {buildWeeklyMetaReportModel,buildWeeklyMetaReportWorkbook} from '../scripts/meta-ads-weekly-report.mjs';
const period={since:'2026-09-21',until:'2026-09-27'};
const order={order_id:'1',order_date:'2026-09-23',payment_amount:17000,items:[{product_name:'A',quantity:1,product_price:17000}]};
const codes=['meta_meantime_look','meta_ssage','meta_adv_catalog','meta_adv_image','meta_adv_video'];
const query=orders=>({source:'cafe24_inflow_queries',orders,trackingQueries:codes.map(code=>({code,ok:true,complete:true}))});
test('filtered orders without response tracking fields are available via query provenance',()=>{
 const result=buildActualProductsSold({data:{...query([{...order,_metaTrackingCode:'meta_ssage'}]),purchaseValue:999999},...period});assert.equal(result.available,true);assert.equal(result.rows[0].inflow_path,'meta_ssage');assert.equal(result.rows[0].actual_paid_amount,17000);
});
test('present tracking fields retain actual sales and canonical partial cancellation',()=>{
 const result=buildActualProductsSold({data:{orders:[{...order,ghost_mall_id:'meta_ssage',items:[...order.items,{product_name:'CANCELLED',quantity:1,status_code:'C1'}]}],purchaseValue:999999},...period});assert.equal(result.available,true);assert.equal(result.rows.length,1);assert.equal(result.rows[0].actual_paid_amount,17000);
});
test('Analytics-only compatibility and filtered provenance validation are independent',()=>{
 assert.equal(buildActualProductsSold({data:{orders:[{...order,inflow_path:''}]},...period}).available,true);
 const nested=buildActualProductsSold({data:query([{...order,extra:{_metaTrackingCode:'meta_ssage'}}]),...period});assert.equal(nested.available,false);assert.deepEqual(nested.rows,[]);
 assert.equal(buildActualProductsSold({data:query([]),...period}).available,true);
});
test('workbook writes UNAVAILABLE for incomplete inflow query results',async()=>{
 const level={ok:true,rows:[],totals:{purchaseValue:999999,purchases:10}};
 const model=buildWeeklyMetaReportModel({...period,current:{campaign:level,adset:level,ad:level},previous:{campaign:level,adset:level,ad:level},actualOrders:{source:'cafe24_inflow_queries',orders:[order],trackingQueries:[]}});
 const workbook=await buildWeeklyMetaReportWorkbook(model);const sheet=workbook.getWorksheet('ACTUAL_PRODUCTS_SOLD');
 assert.equal(model.actualProducts.available,false);assert.equal(sheet.rowCount,2);assert.match(sheet.getRow(2).getCell('attribution_note').value,/UNAVAILABLE.*query failed or incomplete/);assert.equal(sheet.getRow(2).getCell('actual_paid_amount').value,null);
});
