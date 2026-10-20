import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ExcelJS from 'exceljs';
import {generateWeeklyMetaAdsReport} from '../scripts/meta-ads-weekly-report.mjs';

const codes=['meta_meantime_look','meta_ssage','meta_adv_catalog','meta_adv_image','meta_adv_video'];
const id='20261011-0000055';
const original={order_id:id,order_date:'2026-10-11T20:33:59+09:00',payment_date:'2026-10-11T20:33:59+09:00',paid:'T',canceled:'F',actual_order_amount:{payment_amount:'198000.00'},items:[{order_item_code:id+'-01',product_name:'Test jeans',product_price:'198000.00',quantity:1,order_status:'N30',status_code:'N1'}]};
const refunded={...original,canceled:'T',cancel_date:'2026-10-19T12:27:28+09:00',return_confirmed_date:'2026-10-19T12:27:28+09:00',actual_order_amount:{payment_amount:'0.00'},items:[{...original.items[0],order_status:'R40',status_code:'C3',status_text:'반품완료',refund_date:'2026-10-19T12:27:42+09:00'}]};
const current={...original,order_id:'20261015-0000011',order_date:'2026-10-15',actual_order_amount:{payment_amount:'107000.00'},items:[{...original.items[0],order_item_code:'new-item',product_price:107000}]};
const actual=orders=>({source:'cafe24_inflow_queries',orders:[],trackingQueries:codes.map(code=>({code,ok:true,complete:true,count:0})),analyticsOrders:orders,analyticsOrdersComplete:true});
const acquisition=orders=>({ok:true,data:{orderdetails:orders.map(o=>({order_id:o.order_id,ad:'ig',medium:'paid',content:'ad1',order_amount:198000}))}});
const level={completeness:'COMPLETE',source:'meta_marketing_api',rows:[{adId:'ad1',adName:'Test ad'}],totals:{spend:10000,impressions:1000,clicks:100,purchases:7,purchaseValue:1720000,ctr:.1,cpc:100,cpa:10000/7,roas:172}};
async function setup(){return {outputDir:await mkdtemp(join(tmpdir(),'meta-issued-'))};}
function options(outputDir,week='first',overrides={}){
 const first=week==='first',s=first?'2026-10-06':'2026-10-13',u=first?'2026-10-12':'2026-10-19';
 return {outputDir,env:{},referenceDateKey:first?'2026-10-13':'2026-10-20',period:{since:s,until:u},onePage:true,requireCompleteData:true,now:()=>new Date(first?'2026-10-13T01:00:00Z':'2026-10-20T01:00:00Z'),fetchByLevel:async()=>structuredClone(level),fetchActualOrders:async since=>actual(since==='2026-10-06'?[first?original:refunded]:since==='2026-10-13'?[current]:[]),fetchActualAnalytics:async since=>acquisition(since==='2026-10-06'?[original]:since==='2026-10-13'?[current]:[]),...overrides};
}

test('scheduled automatic PASS is a verified immutable publication, not only a generated file',async()=>{
 const {outputDir}=await setup();const r=await generateWeeklyMetaAdsReport(options(outputDir));
 assert.equal(r.ok,true);assert.equal(r.publication?.review.result,'PASS');
 const manifest=JSON.parse(await readFile(join(outputDir,'issued','2026-10-06_2026-10-12','manifest.json'),'utf8'));
 assert.equal(manifest.summary.metaPaidOrderCount,1);assert.equal(manifest.summary.metaPaidRevenue,198000);assert.equal(manifest.orders[0].amount,198000);
 assert.equal(manifest.generatedAt,'2026-10-13T01:00:00.000Z');assert.ok(manifest.issuedAt);assert.ok(manifest.reviewedAt);assert.match(manifest.sha256,/^[a-f0-9]{64}$/);
 const bytes=await readFile(r.filePath);assert.ok(bytes.length>0);
});

async function workbook(result){const w=new ExcelJS.Workbook();await w.xlsx.readFile(result.filePath);return w;}
test('October 11 payment stays 198000 in issued comparison after October 19 full refund',async()=>{
 const {outputDir}=await setup();const first=await generateWeeklyMetaAdsReport(options(outputDir));
 const before=await readFile(first.publication.manifestPath);
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second'));assert.equal(r.ok,true);
 assert.equal(r.comparison.issuedRevenue,198000);assert.equal(r.comparison.refundAdjustment,-198000);assert.equal(r.comparison.currentRevenue,0);
 const w=await workbook(r);assert.equal(w.getWorksheet('REPORT').getCell('E23').value,198000);
 assert.equal(w.getWorksheet('REPORT').pageSetup.fitToHeight,1);
 const detail=w.getWorksheet('REFUND_ADJUSTMENTS');assert.equal(detail.getCell('A2').value,id);assert.equal(detail.getCell('D2').value,198000);
 assert.ok(JSON.stringify(w.getWorksheet('SUMMARY').getSheetValues()).includes('1720000'));
 assert.deepEqual(await readFile(first.publication.manifestPath),before);
});
for(const [name,change] of [
 ['partial refund with an explicit refunded amount',o=>({...o,canceled:'M',actual_order_amount:{payment_amount:99000},refunds:[{order_id:id,refund_code:'R1',refund_date:'2026-10-19T12:27:42+09:00',actual_refund_amount:99000}]})],
 ['one returned product among several items',o=>({...o,canceled:'M',actual_order_amount:{payment_amount:99000},items:[{...o.items[0],product_price:99000},{...o.items[0],order_item_code:'returned-item',product_price:99000,order_status:'R40',status_code:'C3',status_text:'반품완료',refund_date:'2026-10-19T12:27:42+09:00'}]})]
])test(name,async()=>{
 const {outputDir}=await setup();
 const baseline=name==='one returned product among several items'?{...original,items:[{...original.items[0],product_price:99000},{...original.items[0],order_item_code:'returned-item',product_price:99000}]}:original;
 await generateWeeklyMetaAdsReport(options(outputDir,'first',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[baseline]:[])}));
 const amended=change(structuredClone(baseline));
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[amended]:[current])}));
 assert.equal(r.ok,true);assert.equal(r.comparison.issuedRevenue,198000);assert.equal(r.comparison.currentRevenue,99000);assert.equal(r.comparison.refundAdjustment,-99000);
});
test('duplicate orders and duplicate refund events never double count',async()=>{
 const {outputDir}=await setup();await generateWeeklyMetaAdsReport(options(outputDir,'first',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[original,original]:[])}));
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[refunded,refunded]:[current])}));
 assert.equal(r.comparison.refundAdjustment,-198000);assert.equal(r.comparison.rows.length,1);
});
test('no prior issued workbook leaves published value unavailable while current net stays visible',async()=>{
 const {outputDir}=await setup();const r=await generateWeeklyMetaAdsReport(options(outputDir,'second'));
 assert.equal(r.ok,true);assert.equal(r.comparison.issuedRevenue,null);assert.equal(r.comparison.currentRevenue,0);assert.equal(r.comparison.refundAdjustment,null);
 const w=await workbook(r);assert.equal(w.getWorksheet('REPORT').getCell('E23').value,'UNAVAILABLE');
 assert.ok(JSON.stringify(w.getWorksheet('REPORT').getRow(28).values).includes('0원'));
});
test('preview and non-scheduled generation cannot become verified publications',async()=>{
 const {outputDir}=await setup();for(const extra of [{publicationMode:'preview'},{now:()=>new Date('2026-10-13T03:00:00Z')}]){
  const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',extra));assert.equal(r.publication,null);
 }
 await assert.rejects(access(join(outputDir,'issued','2026-10-06_2026-10-12','manifest.json')));
});
test('PARTIAL and missing payment evidence cannot pass scheduled automatic review',async()=>{
 for(const extra of [{fetchByLevel:async()=>({...level,meta:{completeness:'PARTIAL'}})},{fetchActualOrders:async s=>actual(s==='2026-10-06'?[{...original,paid:'F'}]:[])}]){
 const {outputDir}=await setup();const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',extra));
 assert.equal(r.ok,false);assert.equal(r.publication,null);await assert.rejects(access(join(outputDir,'issued','2026-10-06_2026-10-12','manifest.json')));
 }
});
test('an unexplained decrease blocks review and publication instead of being called a refund',async()=>{
 const {outputDir}=await setup();await generateWeeklyMetaAdsReport(options(outputDir));
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[{...original,actual_order_amount:{payment_amount:99000}}]:[current])}));
 assert.equal(r.ok,false);assert.equal(r.comparison.status,'UNKNOWN_ADJUSTMENT');assert.equal(r.comparison.refundAdjustment,null);assert.equal(r.publication,null);
});
test('old or unrelated cancellation evidence does not explain a new amount difference',async()=>{
 const {outputDir}=await setup();await generateWeeklyMetaAdsReport(options(outputDir));
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[{...original,canceled:'M',actual_order_amount:{payment_amount:99000},refunds:[{refund_date:'2026-10-12T01:00:00Z',refund_amount:99000}]}]:[current])}));
 assert.equal(r.ok,false);assert.equal(r.comparison.status,'UNKNOWN_ADJUSTMENT');
});
test('previous reread failure blocks publication even when a verified prior report exists',async()=>{
 const {outputDir}=await setup();await generateWeeklyMetaAdsReport(options(outputDir));
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second',{fetchActualOrders:async s=>{if(s==='2026-10-06')throw Error('offline');return actual([current]);}}));
 assert.equal(r.ok,false);await assert.rejects(access(join(outputDir,'issued','2026-10-13_2026-10-19','manifest.json')));
});
test('tampered review result or workbook bytes are not accepted as issued comparisons',async()=>{
 for(const target of ['manifest','workbook']){
 const {outputDir}=await setup();const first=await generateWeeklyMetaAdsReport(options(outputDir));
 if(target==='manifest'){const m=JSON.parse(await readFile(first.publication.manifestPath));m.review.result='FAIL';await writeFile(first.publication.manifestPath,JSON.stringify(m));}
 else await writeFile(first.publication.filePath,'corrupted');
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second'));assert.equal(r.ok,false);assert.equal(r.publication,null);
 }
});
test('publishing twice never overwrites the first reviewed workbook or manifest',async()=>{
 const {outputDir}=await setup();const first=await generateWeeklyMetaAdsReport(options(outputDir));const bytes=await readFile(first.publication.manifestPath);
 const r=await generateWeeklyMetaAdsReport(options(outputDir));assert.equal(r.ok,true);assert.equal(r.publication.alreadyIssued,true);assert.deepEqual(await readFile(first.publication.manifestPath),bytes);
});
test('missing authoritative completeness evidence is insufficient for automatic publication',async()=>{
 const {outputDir}=await setup();const {completeness,...unverified}=level;
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',{fetchByLevel:async()=>unverified}));
 assert.equal(r.ok,false);assert.ok(r.review.errors.some(s=>s.includes('COMPLETE_COVERAGE_REQUIRED')));
});
test('a partial or failed previous Analytics response cannot pass review',async()=>{
 const {outputDir}=await setup();
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',{fetchActualAnalytics:async s=>s==='2026-09-29'?{...acquisition([]),meta:{completeness:'PARTIAL'}}:acquisition([original])}));
 assert.equal(r.ok,false);
});
test('empty actual API responses without source provenance cannot be issued as verified zeros',async()=>{
 const {outputDir}=await setup();const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',{fetchActualOrders:async()=>({orders:[]}),fetchActualAnalytics:async()=>acquisition([])}));
 assert.equal(r.ok,false);
});
test('unknown positive and negative order changes cannot cancel each other into a clean review',async()=>{
 const {outputDir}=await setup();await generateWeeklyMetaAdsReport(options(outputDir));
 const replacement={...original,order_id:'replacement'};
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[refunded,replacement]:[current]),fetchActualAnalytics:async s=>acquisition(s==='2026-10-06'?[original,replacement]:[current])}));
 assert.equal(r.ok,false);assert.equal(r.comparison.status,'UNKNOWN_ADJUSTMENT');
});
test('duplicate partial refund events count once and an unrelated claim amount is rejected',async()=>{
 for(const amount of [99000,50000]){
 const {outputDir}=await setup();await generateWeeklyMetaAdsReport(options(outputDir));
 const event={order_id:id,refund_code:'refund1',refund_date:'2026-10-19T12:27:42+09:00',actual_refund_amount:amount};
 const partial={...original,canceled:'M',actual_order_amount:{payment_amount:99000},refunds:[event,event]};
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[partial]:[current])}));
 assert.equal(r.ok,amount===99000);assert.equal(r.comparison.refundAdjustment,amount===99000?-99000:null);
 }
});
test('failed delivery never leaves a trusted issued baseline, and a retry can publish',async()=>{
 const {outputDir}=await setup();await assert.rejects(generateWeeklyMetaAdsReport(options(outputDir,'first',{saveReport:async()=>{throw Error('delivery failed');}})),/delivery failed/);
 await assert.rejects(access(join(outputDir,'issued','2026-10-06_2026-10-12','manifest.json')));
 const r=await generateWeeklyMetaAdsReport(options(outputDir));assert.equal(r.ok,true);
});
test('the existing delivery callback receives the exact bytes preserved with the issued hash',async()=>{
 const {outputDir}=await setup();let delivered;
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',{saveReport:async w=>{delivered=Buffer.from(await w.xlsx.writeBuffer());return {filePath:'/delivery/verified.xlsx',uploaded:true};}}));
 assert.equal(r.filePath,'/delivery/verified.xlsx');assert.deepEqual(delivered,await readFile(r.publication.filePath));
});
test('unverified Render storage blocks publication even with otherwise complete data',async()=>{
 const {outputDir}=await setup();const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',{env:{RENDER:'true'}}));
 assert.equal(r.ok,false);assert.equal(r.error,'ISSUED_STORAGE_UNVERIFIED');
});
test('an automatic caller outside the Tuesday10 window never falls through to an unreviewed final upload',async()=>{
 const {outputDir}=await setup();let delivered=false;
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',{now:()=>new Date('2026-10-13T02:00:00Z'),saveReport:async()=>{delivered=true;return {filePath:'final.xlsx'};}}));
 assert.equal(r.ok,false);assert.equal(delivered,false);assert.equal(r.error,'AUTO_PUBLICATION_WINDOW_CLOSED');
});
test('an existing unverified delivery is never retroactively registered as a publication',async()=>{
 const {outputDir}=await setup();
 await assert.rejects(generateWeeklyMetaAdsReport(options(outputDir,'first',{saveReport:async()=>({filePath:'existing-final.xlsx',alreadyExists:true})})),/UNVERIFIED_EXISTING_DELIVERY/);
 await assert.rejects(access(join(outputDir,'issued','2026-10-06_2026-10-12','manifest.json')));
});
test('a discounted partial return without a confirmed refund amount stays UNKNOWN',async()=>{
 const {outputDir}=await setup();
 const discounted={...original,items:[{...original.items[0],product_price:150000},{...original.items[0],order_item_code:'second',product_price:150000}]};
 await generateWeeklyMetaAdsReport(options(outputDir,'first',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[discounted]:[])}));
 const returned={...discounted,canceled:'M',actual_order_amount:{payment_amount:99000},items:[discounted.items[0],{...discounted.items[1],order_status:'R40',refund_date:'2026-10-19T12:27:42+09:00'}]};
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'second',{fetchActualOrders:async s=>actual(s==='2026-10-06'?[returned]:[current])}));
 assert.equal(r.ok,false);assert.equal(r.comparison.status,'UNKNOWN_ADJUSTMENT');
});
test('only one concurrent publisher may deliver a period before immutable issuance completes',async()=>{
 const {outputDir}=await setup();let deliveries=0,release,started;
 const waiting=new Promise(r=>{release=r;});const entered=new Promise(r=>{started=r;});
 const first=generateWeeklyMetaAdsReport(options(outputDir,'first',{saveReport:async()=>{deliveries++;started();await waiting;return {filePath:'first.xlsx'};}}));
 await entered;
 try{await assert.rejects(generateWeeklyMetaAdsReport(options(outputDir,'first',{saveReport:async()=>{deliveries++;return {filePath:'second.xlsx'};}})),/ISSUED_PUBLICATION_BUSY/);}
 finally{release();await first;}
 assert.equal(deliveries,1);
});
test('explicit scheduled mode also fails closed outside the issue window',async()=>{
 const {outputDir}=await setup();let saved=false;
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',{publicationMode:'scheduled',now:()=>new Date('2026-10-13T02:00:00Z'),saveReport:async()=>{saved=true;return {filePath:'unreviewed.xlsx'};}}));
 assert.equal(r.ok,false);assert.equal(saved,false);
});
test('a saturated inflow query cannot be called complete by its own boolean flag',async()=>{
 const {outputDir}=await setup();
 const r=await generateWeeklyMetaAdsReport(options(outputDir,'first',{fetchActualOrders:async()=>{const d=actual([]);d.trackingQueries[0].count=500;return d;},fetchActualAnalytics:async()=>acquisition([])}));
 assert.equal(r.ok,false);
});
