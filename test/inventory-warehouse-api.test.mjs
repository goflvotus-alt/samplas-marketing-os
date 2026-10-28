import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const work=await mkdtemp(join(tmpdir(),'warehouse-api-'));
const {PRODUCT_REGISTRY_SEED_FILES}=await import('../scripts/bootstrap-product-registry.mjs');
for(const file of PRODUCT_REGISTRY_SEED_FILES) await writeFile(join(work,file),JSON.stringify(file==='product-registry.json'?{products:[]}:{entries:[]}));
const previous=process.env.WORK_DIR;
process.env.WORK_DIR=work;
const {handleIntelligenceRequest}=await import('../intelligence-service.mjs');
if(previous===undefined)delete process.env.WORK_DIR;else process.env.WORK_DIR=previous;
after(()=>rm(work,{recursive:true,force:true}));
await mkdir(join(work,'ecount-inventory'),{recursive:true});
await writeFile(join(work,'ecount-inventory/latest.json'),JSON.stringify([
 {productCode:'A',productName:'Brand / A',stockQuantity:3,stockByWarehouse:{APGUJEONG:2,VAIL:1}},
 {productCode:'B',productName:'Brand / B',stockQuantity:4,stockByWarehouse:{APGUJEONG:0,VAIL:4}},
 {productCode:'U',productName:'Brand / U',stockQuantity:null}
]));
async function get(query=''){
 let code,payload;const res={writeHead(status){code=status;},end(body){payload=JSON.parse(body);}};
 await handleIntelligenceRequest({url:'/api/inventory/overview'+query,method:'GET',headers:{host:'localhost'}},res);
 return {code,body:payload};
}
test('overview API retains summary, brands, coverage, and exposes per-item warehouse quantities',async()=>{
 const {code,body}=await get();assert.equal(code,200);
 assert.equal(body.summary.totalKnownStock,7);
 assert.equal(body.coverage.locationKnownItems,2);assert.equal(body.coverage.locationUnknownItems,1);
 assert.equal(body.summary.warehouseStock.APGUJEONG.stockQuantity,2);
 assert.equal(body.summary.warehouseStock.VAIL.stockQuantity,5);
 assert.equal(body.brandRollup.length,1);
 assert.deepEqual(body.items.find(i=>i.prodCd==='A').stockByWarehouse,{APGUJEONG:2,VAIL:1});
});
test('store is an item membership filter; global summary and company quantities remain unchanged',async()=>{
 const {code,body}=await get('?store=APGUJEONG&sort=stock-desc');assert.equal(code,200);
 assert.equal(body.filterScope,'items');assert.equal(body.storeFilter,'APGUJEONG');
 assert.deepEqual(body.items.map(i=>[i.prodCd,i.stockQuantity]),[['A',3]]);
 assert.equal(body.summary.totalKnownStock,7);
 const veil=await get('?store=VAIL');assert.equal(veil.body.itemsTotal,2);
 const invalid=await get('?store=VEIL');assert.equal(invalid.code,400);
});
