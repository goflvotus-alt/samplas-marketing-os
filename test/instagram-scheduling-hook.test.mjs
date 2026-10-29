import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captionSha256} from '../scripts/instagram-product-tag-runner.mjs';
import {createSchedulingRegistrationHook} from '../scripts/instagram-scheduling-registration-hook.mjs';
const config={folderName:'TAEGLOBAL-26AW',slotIso:'2026-10-28T11:00:00Z',captionSha256:captionSha256('test caption'),slideCount:7,dimensions:Array(7).fill('1080x1350'),autoTag:{brand:'TAEGLOBAL'},acceptUnverifiedVariantApproval:true};
const success={kind:'schedule-success',ok:true,account:'samplaskr',captionSha256:config.captionSha256,slotText:'2026년 10월 28일 (수) 시간 08 : 00 PM',at:'2026-10-28T03:32:25.924Z'};
const observed={captionSha256:config.captionSha256,captionMatch:true,sched:'2026년 10월 28일 (수) 시간 08 : 00 PM',sizes:Array(7).fill('1080x1350'),order:Array.from({length:7},(_,i)=>[i+1,0])};
const verification={kind:'schedule-verification',complete:true,calendarCount:1,observations:[observed]};
const options=async()=>({config,stateDir:await mkdtemp(join(tmpdir(),'schedule-hook-')),baseUrl:'https://example.com',authorization:'Basic mock'});

test('actual f3 → nt6 result contract registers only after both; success idempotent',async()=>{
 const o=await options();const calls=[];const hook=createSchedulingRegistrationHook({...o,fetchImpl:async(u,i)=>{calls.push(JSON.parse(i.body));return {ok:true,json:async()=>({ok:true})};}});
 assert.equal((await hook.observe(verification)).state,'AWAITING_SCHEDULE_SUCCESS');assert.equal(calls.length,0);
 await hook.observe(success);assert.equal(calls.length,0);
 assert.equal((await hook.observe(verification)).state,'REGISTERED');assert.equal(calls.length,1);
 assert.equal(calls[0].slideCount,7);assert.equal(calls[0].captionSha256,config.captionSha256);
 assert.equal((await hook.observe(verification)).state,'REGISTERED');assert.equal(calls.length,1);
});

test('missing success, duplicate calendar match, wrong slot/order/caption/dimensions never register',async()=>{
 for(const v of [{...verification,complete:false},{...verification,calendarCount:2,observations:[observed,observed]},...['sched','captionSha256','sizes','order'].map(k=>({...verification,observations:[{...observed,[k]:k==='sched'?'2026년 10월 29일 시간 08 : 00 PM':k==='sizes'?Array(7).fill('1080x1080'):k==='order'?Array.from({length:7},(_,i)=>[i+1,i===3?26:0]):'wrong'}]}))]) {
  const hook=createSchedulingRegistrationHook({...await options(),fetchImpl:()=>assert.fail('registration forbidden')});await hook.observe(success);
  assert.equal((await hook.observe(v)).state,'VERIFICATION_FAILED');
 }
});

test('API failure is durable; no automatic retry or schedule changes; explicit registration-only recovery',async()=>{
 const o=await options();let calls=0;
 const fetchImpl=async()=>{calls++;return calls===1?{ok:false,json:async()=>({error:'down'})}:{ok:true,json:async()=>({ok:true})};};
 const h=createSchedulingRegistrationHook({...o,fetchImpl});await h.observe(success);
 assert.equal((await h.observe(verification)).state,'REGISTRATION_FAILED');assert.equal(calls,1);
 const saved=JSON.parse(await readFile(join(o.stateDir,'TAEGLOBAL-26AW.json'),'utf8'));
 assert.equal(saved.receipt.verified.order,true);assert.equal(saved.registrationAttempts,1);assert.ok(!JSON.stringify(saved).includes('Basic mock'));
 const restarted=createSchedulingRegistrationHook({...o,fetchImpl});
 assert.equal((await restarted.observe(verification)).state,'REGISTRATION_FAILED');assert.equal(calls,1);
 assert.equal((await restarted.retryRegistration()).state,'REGISTERED');assert.equal(calls,2);
});

test('uncertain transport/interrupted REGISTERING holds for explicit recovery; outbox checkpoint precedes API',async()=>{
 const o=await options();let calls=0;
 const h=createSchedulingRegistrationHook({...o,fetchImpl:async()=>{calls++;const r=JSON.parse(await readFile(join(o.stateDir,'TAEGLOBAL-26AW.json'),'utf8'));assert.equal(r.state,'REGISTERING');throw new Error('network');}});
 await h.observe(success);assert.equal((await h.observe(verification)).state,'REGISTRATION_OUTCOME_UNKNOWN');
 await h.observe(verification);assert.equal(calls,1);
});

test('outbox refuses Dropbox/feed locations and changed receipt identity',async()=>{
 const o=await options();
 for(const stateDir of ['/Users/test/Dropbox/state','/tmp/READY/state','/tmp/UPLOADED/state'])assert.throws(()=>createSchedulingRegistrationHook({...o,stateDir}),/invalid_hook_config/);
 const h=createSchedulingRegistrationHook(o);await h.observe(success);
 const conflict=createSchedulingRegistrationHook({...o,config:{...config,slotIso:'2026-10-29T11:00:00Z'}});
 await assert.rejects(()=>conflict.observe(verification),/registration_config_changed/);
});

test('prepared mapping proposal travels with registration, never as approval',async()=>{
 const mappingProposal={schemaVersion:1,folderName:config.folderName,brand:'TAEGLOBAL',preparedBy:'Claude schedule preparation',mappings:[{slideIndex:1,savedAsset:'assets/01.jpg',productNo:15570,metaProductId:'28840522035586978',variantCode:'P0000XAW000F',color:'GRAY',option:'M',x:.51,y:.33,evidence:'reused prior verified mapping',confidence:.9,reviewRequired:false}]};
 let body;const h=createSchedulingRegistrationHook({...await options(),config:{...config,mappingProposal},fetchImpl:async(u,i)=>{body=JSON.parse(i.body);return {ok:true,json:async()=>({ok:true})};}});
 await h.observe(success);await h.observe(verification);
 assert.deepEqual(body.mappingProposal,mappingProposal);assert.equal(body.autoTag,undefined);assert.equal(body.acceptUnverifiedVariantApproval,false);
});

test('scheduled-content preview: smaller same-aspect sizes and small order distances register (KIMYO 2026-10-29 shape)',async()=>{
 const kimyo={...observed,sizes:Array(7).fill('720x900'),order:[[1,9.4],[2,11.7],[3,8.6],[4,10],[5,12],[6,9],[7,11]]};
 let calls=0;const hook=createSchedulingRegistrationHook({...await options(),fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({ok:true})};}});
 await hook.observe(success);
 assert.equal((await hook.observe({...verification,observations:[kimyo]})).state,'REGISTERED');assert.equal(calls,1);
 const swapped=createSchedulingRegistrationHook({...await options(),fetchImpl:()=>assert.fail('registration forbidden')});await swapped.observe(success);
 assert.equal((await swapped.observe({...verification,observations:[{...kimyo,order:kimyo.order.map((p,i)=>i===0?[2,9.4]:p)}]})).state,'VERIFICATION_FAILED');
});

test('default export sends only the registration credential, never the shared internal one',async()=>{
 const {default:observeSchedulingStep}=await import('../scripts/instagram-scheduling-registration-hook.mjs');
 const {writeFile}=await import('node:fs/promises');
 const dir=await mkdtemp(join(tmpdir(),'schedule-hook-env-'));const file=join(dir,'registration.json');await writeFile(file,JSON.stringify(config));
 const base={SAMPLAS_IG_REGISTRATION_CONFIG:file,SAMPLAS_MARKETING_OS_URL:'https://hook-test.invalid',CAFE24_PROXY_BASIC_AUTH:'shared:FAKE'};
 const seen=[];const realFetch=globalThis.fetch;
 globalThis.fetch=async(u,i)=>{seen.push(i.headers.Authorization);return {ok:true,json:async()=>({ok:true})};};
 try{
  const shared={...base,SAMPLAS_IG_REGISTRATION_STATE_DIR:join(dir,'a')};
  await observeSchedulingStep(success,{env:shared});assert.notEqual((await observeSchedulingStep(verification,{env:shared})).state,'REGISTERED');
  const own={...base,SAMPLAS_IG_REGISTRATION_STATE_DIR:join(dir,'b'),SAMPLAS_IG_REGISTRATION_BASIC_AUTH:'reg:FAKE'};
  await observeSchedulingStep(success,{env:own});assert.equal((await observeSchedulingStep(verification,{env:own})).state,'REGISTERED');
 }finally{globalThis.fetch=realFetch;}
 assert.deepEqual(seen,[`Basic ${Buffer.from('reg:FAKE').toString('base64')}`]);
});
