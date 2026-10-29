// Real recorded TAEGLOBAL identities + historical stock. Frozen replay, not a live-stock assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductTagService,createPostStore} from '../scripts/instagram-product-tag-runner.mjs';
import {createSchedulingRegistrationHook} from '../scripts/instagram-scheduling-registration-hook.mjs';
import {GraphError,SAMPLAS_META} from '../scripts/instagram-product-tags.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/instagram-scheduled-taeglobal.json',import.meta.url),'utf8'));

async function setup(t,env={},extra=[]){
 t.mock.timers.enable({apis:['Date'],now:Date.parse(fixture.asOf)+1000});
 const {igUserId,catalogId}=SAMPLAS_META;const c={posts:0,stale:false};
 const graph={get:async(path,p={})=>{
  if(path==='app')return {id:SAMPLAS_META.appId};
  if(path==='me/permissions')return {data:['instagram_basic','instagram_shopping_tag_products','catalog_management'].map(permission=>({permission,status:'granted'}))};
  if(path===igUserId)return {id:igUserId,username:'samplaskr',shopping_product_tag_eligibility:true};
  if(path===catalogId)return {id:catalogId,business:{id:SAMPLAS_META.businessId}};
  if(path===`${igUserId}/available_catalogs`)return {data:[{catalog_id:catalogId}]};
  if(path===`${igUserId}/media`)return {data:[{id:fixture.published.mediaId,caption:fixture.caption,timestamp:fixture.published.timestamp,permalink:fixture.published.permalink,media_type:'CAROUSEL_ALBUM',children:{data:fixture.tags.map(x=>({id:x.childId}))}}]};
  if(path===fixture.published.mediaId)return {id:path,username:'samplaskr',owner:{id:igUserId},media_type:'CAROUSEL_ALBUM'};
  if(path===`${fixture.published.mediaId}/children`)return {data:fixture.tags.map(x=>({id:x.childId,media_type:'IMAGE'}))};
  if(path.endsWith('/product_tags'))return {data:[]}; // Absent tags in the simulated new-post plan, never read/written on live TAEGLOBAL.
  if(path===`${catalogId}/products`)throw new GraphError(403,{error:{code:200,message:'(#200) Permissions error'}}); // Refused live since 2026-10-29; rows come via the product group.
  const row=fixture.catalogRows.find(r=>r.product_id===path);if(row&&p.fields==='product_group{id,retailer_id}')return {product_group:{id:`G${row.retailer_id.split('.')[0]}`,retailer_id:row.retailer_id.split('.')[0]}};
  if(/^G\d+\/products$/.test(path))return {data:fixture.catalogRows.filter(r=>r.retailer_id.startsWith(`${path.slice(1).split('/')[0]}.`)).map(r=>({...r,id:r.product_id}))};
  if(path===`${igUserId}/catalog_product_search`)return {data:[{product_id:fixture.tags.find(x=>String(x.productNo)===p.q).metaProductId,retailer_id:`${p.q}.group`,review_status:'approved',product_variants:fixture.catalogRows.filter(r=>r.retailer_id.startsWith(`${p.q}.`)).map(r=>({product_id:r.product_id}))}]}; // Historical approval replay only.
  throw new Error(`unexpected GET ${path}`);
 },post:async()=>{c.posts++;assert.fail('No real or simulated tag POST allowed in this replay');}};
 const mappingProposal={schemaVersion:1,folderName:fixture.manifest.folderName,brand:'TAEGLOBAL',preparedBy:'Reused Claude TAEGLOBAL mapping',mappings:fixture.tags.map(x=>({slideIndex:x.order,savedAsset:x.savedAsset,productNo:x.productNo,metaProductId:x.metaProductId,variantCode:x.variantCode,color:x.productNo===15570?'GRAY':'BLACK',option:'M',x:x.x,y:x.y,evidence:'Previously verified image/product match, reused without new image analysis',confidence:x.confidence,reviewRequired:false})).concat(extra)};
 const config={folderName:fixture.manifest.folderName,slotIso:fixture.slotIso,captionSha256:fixture.captionSha256,slideCount:7,dimensions:Array(7).fill('1080x1350'),mappingProposal};
 const store=createPostStore(await mkdtemp(join(tmpdir(),'taeglobal-proposal-')));
 const service=createProductTagService({graph,store,dropbox:{readFeedFolder:async()=>({manifest:fixture.manifest,mapping:null,location:'READY',path:'/read-only'})},env,getCafe24Product:async no=>{const v=fixture.cafe24.find(x=>x.productNo===no);return {...v,fetchedAt:c.stale?'2000-01-01T00:00:00Z':v.fetchedAt};}});
 const hook=createSchedulingRegistrationHook({config,stateDir:await mkdtemp(join(tmpdir(),'taeglobal-outbox-')),baseUrl:'https://isolated.test',authorization:'Basic mock',fetchImpl:async(url,init)=>{assert.equal(url,'https://isolated.test/api/instagram-product-tags/posts');const out=await service.register(JSON.parse(init.body));return {ok:out.ok,json:async()=>out};}});
 const slot='2026년 10월 28일 (수) 시간 08 : 00 PM';
 await hook.observe({kind:'schedule-success',ok:true,account:'samplaskr',captionSha256:fixture.captionSha256,slotText:slot});
 assert.equal((await hook.observe({kind:'schedule-verification',complete:true,calendarCount:1,observations:[{captionSha256:fixture.captionSha256,captionMatch:true,sched:slot,sizes:config.dimensions,order:fixture.tags.map(x=>[x.order,0])}]})).state,'REGISTERED');
 return {c,config,service};
}

test('TAEGLOBAL 7: verified schedule registration → publish detection → validation → human approval → gated tag plan, no paid API or tag POST',async t=>{
 const {c,config,service}=await setup(t);
 const proposed=(await service.run(config.folderName)).record;
 assert.equal(proposed.publish.state,'PUBLISHED');assert.equal(proposed.tags.state,'TAG_REVIEW_REQUIRED');
 assert.deepEqual(proposed.autoMapping.slides.flatMap(s=>s.tags.map(x=>[s.order,x.productNo,x.metaProductId,x.x,x.y,x.approved])),fixture.tags.map(x=>[x.order,x.productNo,x.metaProductId,x.x,x.y,false]));
 const picks=fixture.tags.map(x=>({order:x.order,productNo:x.productNo}));
 c.stale=true;assert.equal((await service.approveAutoMap(config.folderName,picks,'fixture-human',proposed.autoMapping.source.builtAt,{acceptUnverifiedVariantApproval:true})).ok,false);
 c.stale=false;assert.equal((await service.approveAutoMap(config.folderName,picks,'fixture-human',proposed.autoMapping.source.builtAt,{acceptUnverifiedVariantApproval:true})).ok,true);
 assert.equal((await service.register({...config,acceptUnverifiedVariantApproval:true})).existing,true);
 const planned=(await service.run(config.folderName)).record;
 assert.equal(planned.tags.state,'PENDING');assert.equal(planned.tags.tags.length,7);assert.equal(planned.tags.applyReason,'writes_disabled');assert.equal(c.posts,0);
});

test('auto approval on: only verified PROPOSED tags are approved, the review entry stays out, POST still gated by WRITES',async t=>{
 const review={slideIndex:1,savedAsset:fixture.tags.find(x=>x.order===1).savedAsset,evidence:'skirt not in catalog',reviewRequired:true};
 const {c,config,service}=await setup(t,{INSTAGRAM_PRODUCT_TAG_AUTO_APPROVE:'on'},[review]);
 const rec=(await service.run(config.folderName)).record;
 assert.equal(rec.autoMapping.source.state,'APPROVED');assert.equal(rec.autoApproval.approved,7);
 assert.equal(rec.approvals.acceptUnverifiedVariantApproval,true);
 assert.ok(rec.autoMapping.slides.every(s=>s.tags.every(x=>x.approvedBy==='auto-policy-v1' && x.reviewRequired===false)));
 assert.equal(rec.tags.state,'PENDING');assert.equal(rec.tags.tags.length,7);assert.equal(rec.tags.applyReason,'writes_disabled');assert.equal(c.posts,0);
});
