import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as sync from '../scripts/sync-ecount-inventory.mjs';
import {buildInventoryOverview} from '../scripts/inventory-overview-lib.mjs';
import {runReadTool} from '../scripts/mcp/read-tools.mjs';
const row=(PROD_CD,BAL_QTY)=>({PROD_CD,BAL_QTY:String(BAL_QTY)});
const company=[row('A',3),row('B',4),row('NEG',-2),row('ZERO',0)];
const warehouses={'100':[row('A',2),row('NEG',-3)],'200':[row('A',1),row('B',4),row('NEG',1),row('ZERO',0)]};
const products=['A','B','NEG','ZERO','UNKNOWN'].map(PROD_CD=>({PROD_CD,PROD_DES:'Brand / '+PROD_CD}));
test('warehouse merge maps codes, preserves company stock/null, and handles zero/negative by product code',()=>{
 const merged=sync.mergeWarehouseInventory(company,warehouses);
 const {latest}=sync.buildLatestRows(products,company,merged.stockByProduct);
 assert.deepEqual(latest.map(r=>[r.productCode,r.stockQuantity,r.stockByWarehouse??null]),[
 ['A',3,{APGUJEONG:2,VAIL:1}],['B',4,{APGUJEONG:0,VAIL:4}],['NEG',-2,{APGUJEONG:-3,VAIL:1}],['ZERO',0,{APGUJEONG:0,VAIL:0}],['UNKNOWN',null,null]]);
 assert.equal(merged.parity.mismatchCount,0);
 assert.equal(merged.parity.company.totalQuantity,5);
});
test('per-SKU mismatch aborts even when grand totals match',()=>{
 assert.throws(()=>sync.mergeWarehouseInventory([row('A',3),row('B',4)],{'100':[row('A',4),row('B',3)],'200':[]}),/parity/i);
});
test('unknown/missing warehouse, malformed quantity, missing product code and capped list fail closed',()=>{
 for(const w of [{'100':[],'200':[],'300':[]},{'100':[]},{'100':[{PROD_CD:'A',BAL_QTY:''}],'200':[]},{'100':[row('',1)],'200':[]},{'100':Array(10000).fill(row('A',0)),'200':[]}]) assert.throws(()=>sync.mergeWarehouseInventory([],w));
});
test('warehouse-only zero codes reconcile without turning unknown company stock into zero',()=>{
 const m=sync.mergeWarehouseInventory([],{ '100':[row('ONLY',0)],'200':[] });
 assert.equal(m.parity.mismatchCount,0);
 assert.equal(sync.buildLatestRows([{PROD_CD:'ONLY'}],[],m.stockByProduct).latest[0].stockQuantity,null);
 assert.throws(()=>sync.mergeWarehouseInventory([],{'100':[row('ONLY',1)],'200':[]}),/parity/i);
});
test('overview exposes validated warehouses and retains legacy locations and company statuses',()=>{
 const rows=[{productCode:'A',productName:'Brand / A',stockQuantity:3,stockByWarehouse:{APGUJEONG:2,VAIL:1}}, {productCode:'B',productName:'Brand / B',stockQuantity:0}, {productCode:'C',stockQuantity:2,stockByWarehouse:{APGUJEONG:1,VAIL:9}}];
 const result=buildInventoryOverview({ecountRows:rows,brandRegistry:{brands:[],aliases:[]},salesIndex:new Map()});
 assert.equal(result.summary.locationKnownItems,1);
 assert.equal(result.summary.locationUnknownItems,2);
 assert.deepEqual(result.items[0].stockByWarehouse,{APGUJEONG:2,VAIL:1});
 assert.deepEqual(result.items[0].locations,{STORE_1:null,OFFSITE:null,UNKNOWN:null});
 assert.equal(result.summary.warehouseStock.APGUJEONG.stockQuantity,2);
 assert.equal(result.summary.warehouseStock.VAIL.stockQuantity,1);
});
test('MCP items retain warehouse quantities',async()=>{
 const r=await runReadTool('get_inventory',{view:'items'}, {getJson:async()=>({items:[{prodCd:'A',stockQuantity:3,stockByWarehouse:{APGUJEONG:2,VAIL:1}}],coverage:{},itemsTotal:1})});
 assert.deepEqual(r.data.items[0].stockByWarehouse,{APGUJEONG:2,VAIL:1});
});
function requestFixture({mismatch=false,failWarehouse=false}={}){
 const calls=[];const request=async(url,body)=>{
 calls.push({url,body});let result;
 if(url.includes('/Zone'))return {httpStatus:200,body:{Data:{ZONE:'AC'}}};
 if(url.includes('OAPILogin'))return {httpStatus:200,body:{Data:{Datas:{SESSION_ID:'test-session'}}}};
 if(url.includes('GetBasicProductsList'))result=products;
 else if(failWarehouse&&body.WH_CD==='200')throw Error('warehouse unavailable');
 else result=body.WH_CD?warehouses[body.WH_CD]:mismatch?[row('A',4),...company.slice(1)]:company;
 return {httpStatus:200,body:{Data:{Result:result}}};};return {request,calls};
}
test('canonical sync fetches each warehouse once and rejects before replacing snapshots',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'warehouse-sync-'));
 const env={ECOUNT_COM_CODE:'c',ECOUNT_USER_ID:'u',ECOUNT_API_CERT_KEY:'k'};
 try{
 const f=requestFixture();await sync.syncEcountInventory({env,outDir:dir,request:f.request,delayMs:0});
 const before=await readFile(join(dir,'latest.json'),'utf8');
 assert.deepEqual(JSON.parse(before)[0].stockByWarehouse,{APGUJEONG:2,VAIL:1});
 assert.deepEqual(f.calls.filter(c=>c.url.includes('GetListInventory')).map(c=>c.body.WH_CD??null),[null,'100','200']);
 assert.deepEqual(f.calls.map(c=>c.url.includes('/Zone')?'zone':c.url.includes('OAPILogin')?'login':c.url.includes('GetBasicProductsList')?'products':c.body.WH_CD??'company'),['zone','login','company','100','200','products']);
 for(const options of [{mismatch:true},{failWarehouse:true}]){
 const rejected=requestFixture(options);
 await assert.rejects(sync.syncEcountInventory({env,outDir:dir,request:rejected.request,delayMs:0}));
 assert.equal(rejected.calls.some(c=>c.url.includes('GetBasicProductsList')),false,'warehouse failures must stop before product fetch');
 assert.equal(await readFile(join(dir,'latest.json'),'utf8'),before);
 }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('dry-run exercises real canonical merge without creating snapshots or history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'warehouse-dry-'));
 try{
 const {readdir}=await import('node:fs/promises');
 const r=await sync.syncEcountInventory({env:{ECOUNT_COM_CODE:'c',ECOUNT_USER_ID:'u',ECOUNT_API_CERT_KEY:'k'},outDir:dir,request:requestFixture().request,delayMs:0,dryRun:true});
 assert.equal(r.dryRun,true);assert.equal(r.warehouseParity.mismatchCount,0);
 assert.deepEqual(await readdir(dir),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('store item filter uses nonzero warehouse stock including negative, preserving company quantities',async()=>{
 const {filterAndSortItems}=await import('../scripts/inventory-overview-lib.mjs');
 const items=[{prodCd:'A',stockQuantity:3,stockByWarehouse:{APGUJEONG:2,VAIL:1}}, {prodCd:'B',stockQuantity:4,stockByWarehouse:{APGUJEONG:0,VAIL:4}}, {prodCd:'N',stockQuantity:-2,stockByWarehouse:{APGUJEONG:-3,VAIL:1}}, {prodCd:'U',stockQuantity:null}];
 assert.deepEqual(filterAndSortItems(items,{store:'APGUJEONG',sort:'stock-desc'}).map(i=>i.prodCd),['A','N']);
 assert.equal(items[0].stockQuantity,3);
 assert.throws(()=>filterAndSortItems(items,{store:'VEIL'}),/store/i);
});
test('MCP store filter is items-only and forwards canonical store without changing summary scope',async()=>{
 const calls=[];
 const up={getJson:async(path,args)=>{calls.push(args);return {items:[],coverage:{},itemsTotal:0};}};
 await runReadTool('get_inventory',{view:'items',store:'VAIL'},up);
 assert.equal(calls[0].store,'VAIL');
 const invalid=await runReadTool('get_inventory',{store:'VAIL'},up);
 assert.equal(invalid.error.code,'VALIDATION_FAILED');assert.match(invalid.error.message,/items/i);
});
test('nonzero warehouse stock absent from product master aborts without writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'warehouse-missing-product-'));
 const f=requestFixture();const request=async(url,body)=>url.includes('GetBasicProductsList')?{httpStatus:200,body:{Data:{Result:products.filter(p=>p.PROD_CD!=='A')}}}:f.request(url,body);
 try{await assert.rejects(sync.syncEcountInventory({env:{ECOUNT_COM_CODE:'c',ECOUNT_USER_ID:'u',ECOUNT_API_CERT_KEY:'k'},outDir:dir,request,delayMs:0}),/missing from product master/);
 const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(dir),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('products-only retains validation behavior without fetching inventory or writing snapshots',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'warehouse-products-only-'));
 const f=requestFixture();
 try{
 await assert.rejects(sync.syncEcountInventory({env:{ECOUNT_COM_CODE:'c',ECOUNT_USER_ID:'u',ECOUNT_API_CERT_KEY:'k'},outDir:dir,request:f.request,delayMs:0,productsOnly:true}),/products-only/);
 assert.equal(f.calls.filter(c=>c.url.includes('GetBasicProductsList')).length,1);
 assert.equal(f.calls.some(c=>c.url.includes('GetListInventory')),false);
 const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(dir),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});

async function explicitPolicyFixture(code,{masterPresent=false}={}) {
 const f=requestFixture();
 const request=async(url,body)=>{
 const response=await f.request(url,body);
 if(url.includes('GetListInventory'))response.body.Data.Result=[...response.body.Data.Result,row(code,body.WH_CD==='100'?-1:body.WH_CD==='200'?-2:-3)];
 if(masterPresent&&url.includes('GetBasicProductsList'))response.body.Data.Result=[...response.body.Data.Result,{PROD_CD:code,PROD_DES:'Operational record'}];
 return response;
 };
 const dir=await mkdtemp(join(tmpdir(),'explicit-policy-'));
 try{return await sync.syncEcountInventory({env:{ECOUNT_COM_CODE:'c',ECOUNT_USER_ID:'u',ECOUNT_API_CERT_KEY:'k'},outDir:dir,request,delayMs:0,dryRun:true});}
 finally{await rm(dir,{recursive:true,force:true});}
}
test('operator-confirmed ECOUNT code is in the existing explicit registry',async()=>{
 const {isExcludedProductCode}=await import('../scripts/category-classification-rules.mjs');
 assert.equal(isExcludedProductCode('적립금'),true);
 assert.equal(isExcludedProductCode('NOT_REGISTERED_REAL_SKU'),false);
});
test('missing-master explicit code is excluded only from merge, with signed parity and diagnostic retained',async()=>{
 const r=await explicitPolicyFixture('적립금');
 assert.equal(r.latest.some(i=>i.productCode==='적립금'),false);
 assert.equal(r.latest.filter(i=>Number.isFinite(i.stockQuantity)).reduce((n,i)=>n+i.stockQuantity,0),5);
 assert.equal(r.warehouseParity.company.totalQuantity,2);
 assert.equal(r.warehouseParity.warehouses['100'].totalQuantity,-2);
 assert.equal(r.warehouseParity.warehouses['200'].totalQuantity,4);
 assert.equal(r.warehouseParity.combined.totalQuantity,2);
 assert.equal(r.warehouseParity.mismatchCount,0);
 assert.equal(r.realProductMissingMasterCount,0);
 assert.deepEqual(r.nonProductInventoryRowsExcludedFromProductMerge,{
 count:1,rows:[{productCode:'적립금',stockByWarehouse:{APGUJEONG:-1,VAIL:-2},companyStockQuantity:-3,reason:'explicit non-product/admin code'}],truncated:false
 });
});
test('explicit code already represented in master merges normally rather than being globally removed',async()=>{
 const r=await explicitPolicyFixture('적립금',{masterPresent:true});
 const item=r.latest.find(i=>i.productCode==='적립금');
 assert.equal(item.stockQuantity,-3);assert.deepEqual(item.stockByWarehouse,{APGUJEONG:-1,VAIL:-2});
 assert.equal(r.nonProductInventoryRowsExcludedFromProductMerge.count,0);
});
test('missing-name real SKU remains HARD FAIL even when the display classifier falls back to admin_code',async()=>{
 const {classifyProductType}=await import('../scripts/save-inventory-snapshot.mjs');
 const {isExcludedProductCode}=await import('../scripts/category-classification-rules.mjs');
 assert.equal(classifyProductType({productCode:'NOT_REGISTERED_REAL_SKU',productName:null}),'admin_code');
 assert.equal(isExcludedProductCode('NOT_REGISTERED_REAL_SKU'),false);
 await assert.rejects(explicitPolicyFixture('NOT_REGISTERED_REAL_SKU'),/missing from product master/);
});
