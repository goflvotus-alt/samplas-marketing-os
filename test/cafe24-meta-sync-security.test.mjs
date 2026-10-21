import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
function fn(name){const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert(start>=0,name);const end=source.indexOf('\n}',start);assert(end>start);return source.slice(start,end+2);}
function harness(){
 let now=1000,serial=0,calls=0,saved;
 const logs=[];const c={URL,URLSearchParams,Buffer,Date:class extends Date{static now(){return now;}},randomUUID:()=>`FAKE_STATE_${++serial}`,cafe24MetaSyncOAuthStates:new Map(),
 env:{CAFE24_MALL_ID:'FAKE_MALL',CAFE24_META_SYNC_CLIENT_ID:'FAKE_CLIENT',CAFE24_META_SYNC_CLIENT_SECRET:'FAKE_SECRET'},
 cafe24RedirectUri:()=> 'https://example.invalid/api/cafe24/oauth/callback',
 console:{log:(...x)=>logs.push(JSON.stringify(x)),error:(...x)=>logs.push(JSON.stringify(x))},
 fetch:async()=>{calls++;return{ok:true,json:async()=>({access_token:'FAKE_ACCESS',refresh_token:'FAKE_REFRESH',scopes:['mall.read_product']})};},
 writeCafe24MetaSyncTokenRecord:async x=>(saved=x)};
 runInNewContext(['sanitizeCafe24OAuthError','createCafe24MetaSyncOAuthState','consumeCafe24MetaSyncOAuthState','cafe24MetaSyncRedirectUri','cafe24MetaSyncScopes','buildCafe24MetaSyncAuthorizeUrl','handleCafe24MetaSyncOAuthCallback'].map(fn).join('\n'),c);
 return {c,logs,start:()=>new URL(c.buildCafe24MetaSyncAuthorizeUrl()).searchParams.get('state'),callback:(state,extra='')=>c.handleCafe24MetaSyncOAuthCallback(new URL(`https://example.invalid/callback?code=FAKE_CODE${state==null?'':`&state=${state}`}${extra}`)),expire:()=>{now+=600000;},get calls(){return calls;},get saved(){return saved;}};
}
test('Meta Sync: missing/mismatched/expired/restarted state rejects before error handling and exchange',async()=>{
 const h=harness(),s=h.start();for(const state of [null,'UNKNOWN'])await assert.rejects(h.callback(state,'&error=INJECTED_ERROR'),/state/);
 h.expire();await assert.rejects(h.callback(s),/state/);assert.equal(h.calls,0);
 const restarted=harness();await assert.rejects(restarted.callback(s),/state/);assert.equal(restarted.calls,0);
});
test('Meta Sync: concurrent independent states exchange once each and store only the dedicated token',async()=>{
 const h=harness(),a=h.start(),b=h.start();assert.notEqual(a,b);await Promise.all([h.callback(a),h.callback(b)]);assert.equal(h.calls,2);assert.equal(h.saved.accessToken,'FAKE_ACCESS');
 await assert.rejects(h.callback(a),/state/);assert.equal(h.calls,2);assert.equal(h.logs.length,0);
});
test('Meta Sync: error callbacks consume state; errors are sanitized, bounded and redact state/code/secrets/URLs',async()=>{
 const h=harness(),state=h.start();const description=`${state} FAKE_CODE FAKE_SECRET https://example.invalid/authorize?state=${state}\n\x00 ${'x'.repeat(200)}`;
 await assert.rejects(h.callback(state,`&error=denied%0A%00&error_description=${encodeURIComponent(description)}`),e=>{
  assert(!/[\x00-\x1f\x7f]/.test(e.message));for(const secret of [state,'FAKE_CODE','FAKE_SECRET','https://'])assert(!e.message.includes(secret),e.message);assert(e.message.length<=275);return true;
 });await assert.rejects(h.callback(state),/state/);assert.equal(h.calls,0);
});
test('Meta Sync: token errors are sanitized and in-flight duplicate callback cannot exchange',async()=>{
 const h=harness(),s=h.start();let release,calls=0;
 h.c.fetch=async()=>{calls++;await new Promise(r=>{release=r;});return {ok:false,status:400,json:async()=>({error_description:`FAKE_CODE ${s}\n${'x'.repeat(200)}`})};};
 const pending=h.callback(s);await assert.rejects(h.callback(s),/state/);assert.equal(calls,1);release();await assert.rejects(pending,e=>e.message.length<=120&&!e.message.includes(s)&&!e.message.includes('FAKE_CODE')&&!e.message.includes('\n'));
});
test('automatic probe, guard (including force) and scheduled tick are inert even with enabled env',async()=>{
 const calls=[];const c={env:{CAFE24_META_SYNC_GUARD_ENABLED:'on',CAFE24_META_SYNC_TEST_PRODUCT_NO:'123'},
 resendCafe24ProductForMeta:async()=>calls.push('PUT'),fetch:async(...x)=>calls.push(x),readFile:async()=>{throw Error('Unexpected IO');},writeFile:async()=>{throw Error('Unexpected write');}};
 runInNewContext(['runCafe24MetaSyncStartupProbe','runCafe24MetaSyncGuard','runCafe24MetaSyncGuardScheduledCheck'].map(fn).join('\n'),c);
 for(const invoke of [()=>c.runCafe24MetaSyncStartupProbe(),()=>c.runCafe24MetaSyncGuard(),()=>c.runCafe24MetaSyncGuard({force:true}),()=>c.runCafe24MetaSyncGuardScheduledCheck()]){
  const result=await invoke();assert.equal(result.skipped,true);assert.equal(result.reason,'automatic_product_writes_disabled');
 }assert.deepEqual(calls,[]);
});
test('real startup listener and every registered periodic tick make zero product writes',async()=>{
 const timers=[],calls=[];const disabled=()=>{calls.push('UNEXPECTED_AUTOMATIC_PRODUCT_PATH');return Promise.resolve();};
 const c={env:{CAFE24_META_SYNC_GUARD_ENABLED:'on',CAFE24_META_SYNC_TEST_PRODUCT_NO:'123'},host:'FAKE',port:0,console:{log:()=>{}},
 runCafe24MetaSyncStartupProbe:disabled,runCafe24MetaSyncGuard:disabled,runCafe24MetaSyncGuardScheduledCheck:disabled,
 runMetaCatalogReadProbe:()=>Promise.resolve(),runInstagramBackgroundSync:()=>{},runSeedingCandidateCheck:()=>{},runNaverWeeklyReportCheck:()=>{},runEcountProductMasterCheck:()=>{},
 instagramSyncScheduler:{intervalMs:1},naverWeeklyReportScheduler:{intervalMs:1},ecountProductMasterScheduler:{intervalMs:1},ecountAutoSyncEnabled:false,runMetaWeeklyReportCheck:()=>{},runInstagramWeeklyReportCheck:()=>{},runVeilFoundScheduledCheck:()=>{},metaWeeklyReportScheduler:{intervalMs:1},instagramWeeklyReportScheduler:{intervalMs:1},veilFoundPublisherScheduler:{intervalMs:1},
 setInterval:fn=>{timers.push(fn);},fetch:async(...args)=>calls.push(args)};
 const start=source.indexOf('}).listen(port, host, () => {')+'}).listen(port, host, () => {'.length;
 const end=source.indexOf('\n}) : null;',start);assert(end>start);
 runInNewContext(`(async()=>{${source.slice(start,end)}})()`,c);
 for(const tick of timers)await tick();assert.deepEqual(calls,[]);
});
test('product PUT implementation is retained but only isolated manual functions call it',()=>{
 const manual=['executeCafe24MetaSyncManualProbe','executeCafe24MetaSyncManualGuard'];
 let remaining=source;for(const name of manual)remaining=remaining.replace(fn(name),'');
 assert.match(fn('resendCafe24ProductForMeta'),/method: "PUT"/);
 assert.equal((remaining.match(/resendCafe24ProductForMeta\(/g)||[]).length,1,'only definition outside manual functions');
 for(const name of manual)assert.equal((source.match(new RegExp(`${name}\\(`,'g'))||[]).length,1,'no automatic or HTTP caller');
});
test('Meta catalog probe uses Graph GET and token read only: no refresh, token write or product request',async()=>{
 const calls=[];const c={env:{META_CATALOG_ID:'FAKE_CATALOG',CAFE24_META_SYNC_TEST_PRODUCT_NO:'123'},graphVersion:'v1',URL,
 metaTokenStoreFile:'/FAKE',metaAccessTokenEnvFallback:'FAKE_FALLBACK',metaStoredAccessTokenCache:'',
 readFile:async()=>{calls.push('read');return JSON.stringify({accessToken:'FAKE_META'});},
 fetch:async(url,options)=>{calls.push(options?.method||'GET');assert.equal(new URL(url).hostname,'graph.facebook.com');return{ok:true,json:async()=>({data:[]})};},console:{log:()=>{},error:()=>{}},safeErrorMessage:e=>e.message};
 runInNewContext(['readMetaTokenRecord','resolveMetaAccessToken','graphGet','runMetaCatalogReadProbe'].map(fn).join('\n'),c);
 await c.runMetaCatalogReadProbe();assert.deepEqual(calls,['read','GET']);
});
test('Meta Sync: missing code consumes valid state; transport/JSON failures never expose raw provider messages',async()=>{
 const h=harness(),s=h.start();await assert.rejects(h.c.handleCafe24MetaSyncOAuthCallback(new URL(`https://example.invalid/callback?state=${s}`)),/code/);await assert.rejects(h.callback(s),/state/);
 for(const mode of ['network','json']){
  const state=h.start(),secret=`FAKE_SECRET FAKE_CODE ${state}\nPRIVATE_PAYLOAD`;
  h.c.fetch=async()=>{if(mode==='network')throw Error(secret);return {ok:true,json:async()=>{throw Error(secret);}};};
  await assert.rejects(h.callback(state),e=>!e.message.includes('FAKE_')&&!e.message.includes('PRIVATE_PAYLOAD')&&!e.message.includes('\n'));
 }
});
