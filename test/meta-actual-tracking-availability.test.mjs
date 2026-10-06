import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActualProductsSold} from '../scripts/meta-actual-products-sold.mjs';
import {buildWeeklyMetaReportModel,buildWeeklyMetaReportWorkbook} from '../scripts/meta-ads-weekly-report.mjs';
const period={since:'2026-09-21',until:'2026-09-27'};
const order={order_id:'1',order_date:'2026-09-23',payment_amount:17000,items:[{product_name:'A',quantity:1,product_price:17000}]};
test('existing orders without tracking fields are unavailable, never attributed revenue',()=>{
 const result=buildActualProductsSold({data:{orders:[order],purchaseValue:999999},...period});assert.equal(result.available,false);assert.equal(result.reason,'Cafe24 order payload does not expose inflow tracking fields; ad-level actual product attribution is unavailable.');assert.deepEqual(result.rows,[]);
});
test('present tracking fields retain actual sales and canonical partial cancellation',()=>{
 const result=buildActualProductsSold({data:{orders:[{...order,ghost_mall_id:'meta_ssage',items:[...order.items,{product_name:'CANCELLED',quantity:1,status_code:'C1'}]}],purchaseValue:999999},...period});assert.equal(result.available,true);assert.equal(result.rows.length,1);assert.equal(result.rows[0].actual_paid_amount,17000);
});
test('blank tracking is exposed but unattributed; nested fields cannot fabricate actual rows',()=>{
 assert.equal(buildActualProductsSold({data:{orders:[{...order,inflow_path:''}]},...period}).available,true);
 const nested=buildActualProductsSold({data:{orders:[{...order,extra:{ghost_mall_id:'meta_ssage'}}]},...period});assert.equal(nested.available,false);assert.deepEqual(nested.rows,[]);
 assert.equal(buildActualProductsSold({data:{orders:[]},...period}).available,false);
});
test('workbook explicitly writes UNAVAILABLE when orders exist without tracking',async()=>{
 const level={ok:true,rows:[],totals:{purchaseValue:999999,purchases:10}};
 const model=buildWeeklyMetaReportModel({...period,current:{campaign:level,adset:level,ad:level},previous:{campaign:level,adset:level,ad:level},actualOrders:{orders:[order]}});
 const workbook=await buildWeeklyMetaReportWorkbook(model);const sheet=workbook.getWorksheet('ACTUAL_PRODUCTS_SOLD');
 assert.equal(model.actualProducts.available,false);assert.equal(sheet.rowCount,2);assert.match(sheet.getRow(2).getCell('attribution_note').value,/UNAVAILABLE.*does not expose inflow tracking fields/);assert.equal(sheet.getRow(2).getCell('actual_paid_amount').value,null);
});
