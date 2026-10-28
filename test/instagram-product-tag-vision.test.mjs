import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageAnalyzer, loadVisionProducts } from '../scripts/instagram-product-tag-vision.mjs';
import { registerScheduledPost } from '../scripts/instagram-scheduled-registration.mjs';

const manifest = { folderName:'TAEGLOBAL-26AW', items:[{order:1,savedAsset:'assets/01.jpg'}] };
const products = [{productNo:15570,name:'[TAEGLOBAL] jacket',imageUrl:'https://example.com/jacket.jpg'}];
const slides = [{order:1,savedAsset:'assets/01.jpg',items:[{label:'jacket',color:'GRAY',x:.51,y:.33,candidates:[{productNo:15570,confidence:.9,evidence:'matching panels and zipper'}]}]}];
const response = (s=slides) => ({ok:true,status:200,json:async()=>({status:'completed',id:'resp_test',model:'gpt-4.1-mini',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({slides:s})}]}]})});
const receipt = {account:'samplaskr',state:'SCHEDULED',folderName:manifest.folderName,slotIso:'2026-10-29T11:00:00Z',caption:'test',slideCount:1,verified:{caption:true,slot:true,slides:true,order:true,dimensions:true}};

test('success adapter only calls registration with verified receipt; never reschedules', async()=>{
 const calls=[];
 const out=await registerScheduledPost({receipt,baseUrl:'https://example.com',authorization:'Basic test',autoTag:{brand:'TAEGLOBAL'},fetchImpl:async(url,init)=>{calls.push([url,JSON.parse(init.body)]);return {ok:true,json:async()=>({ok:true})};}});
 assert.equal(out.ok,true); assert.equal(calls.length,1); assert.equal(calls[0][0],'https://example.com/api/instagram-product-tags/posts');
 assert.deepEqual(calls[0][1].autoTag,{brand:'TAEGLOBAL'}); assert.equal(calls[0][1].acceptUnverifiedVariantApproval,false);
 for(const change of [{account:'other'},{state:'PENDING'},{verified:{...receipt.verified,order:false}}]) await assert.rejects(()=>registerScheduledPost({receipt:{...receipt,...change},fetchImpl:()=>assert.fail('network')}));
});

test('vision uses reference images and strict findings, local validation blocks invented products/slides', async()=>{
 let request;
 const analyze=createImageAnalyzer({env:{OPENAI_API_KEY:'test'},fetchImpl:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');request=JSON.parse(init.body);return response();}});
 const out=await analyze({manifest,brand:'TAEGLOBAL',products,images:['data:image/jpeg;base64,YQ==']});
 assert.equal(out.findings.slides[0].items[0].candidates[0].productNo,15570);
 assert.equal(request.store,false); assert.equal(request.text.format.strict,true);
 assert.equal(request.input[0].content.filter(c=>c.type==='input_image').length,2);
 for(const s of [[],[{...slides[0],order:2}],[{...slides[0],savedAsset:'../x'}],[{...slides[0],items:[{...slides[0].items[0],x:2}]}],[{...slides[0],items:[{...slides[0].items[0],candidates:[{productNo:999,confidence:.99,evidence:'guess'}]}]}]]) {
  await assert.rejects(()=>createImageAnalyzer({env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>response(s)})({manifest,brand:'TAEGLOBAL',products,images:['data:image/jpeg;base64,YQ==']}),/invalid_vision_findings/);
 }
});

test('missing key, refusal, truncated response, and HTTP failure never retry', async()=>{
 await assert.rejects(()=>createImageAnalyzer({env:{},fetchImpl:()=>assert.fail('network')})({manifest,products,images:[]}),/vision_not_configured/);
 for(const body of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}]) {
  let calls=0; await assert.rejects(()=>createImageAnalyzer({env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>{calls++;return {ok:true,json:async()=>body};}})({manifest,brand:'TAEGLOBAL',products,images:['data:image/jpeg;base64,YQ==']})); assert.equal(calls,1);
 }
 let calls=0; await assert.rejects(()=>createImageAnalyzer({env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>{calls++;return {ok:false,status:429};}})({manifest,brand:'TAEGLOBAL',products,images:['data:image/jpeg;base64,YQ==']}),/vision_http:429/);assert.equal(calls,1);
});

test('candidate catalog paginates, exact brand only; never silently truncates', async()=>{
 let calls=0;
 const graph={get:async(path,p)=>{calls++;assert.equal(path,'593883097881439/products');return p.after?{data:[{retailer_id:'15571.X',name:'[OTHER] TAEGLOBAL',image_url:'https://example.com/x.jpg'}]}:{data:[{retailer_id:'15570.X',name:'[tae global : label] jacket',image_url:'https://example.com/j.jpg'}],paging:{next:'ignored',cursors:{after:'next'}}};}};
 assert.deepEqual((await loadVisionProducts(graph,'TAEGLOBAL')).map(p=>p.productNo),[15570]);assert.equal(calls,2);
 await assert.rejects(()=>loadVisionProducts({get:async()=>({data:[],paging:{next:'yes'}})},'TAEGLOBAL'),/catalog_pagination_incomplete/);
});

test('registration transport uncertainty is recoverable without repeating scheduling; timezone explicit',async()=>{
 await assert.rejects(()=>registerScheduledPost({receipt:{...receipt,slotIso:'2026-10-29T20:00:00'},fetchImpl:()=>assert.fail('network')}),/schedule_timezone_required/);
 let calls=0;
 const out=await registerScheduledPost({receipt,baseUrl:'https://example.com',authorization:'Basic test',fetchImpl:async()=>{calls++;throw new Error('network');}});
 assert.equal(calls,1);assert.equal(out.error,'registration_outcome_unknown');assert.match(out.action,/never_reschedule/);
});
