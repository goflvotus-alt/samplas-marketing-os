import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {execFileSync} from 'node:child_process';
const src=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const extract=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const normalization=()=>extract('function normalizeCafe24ExpiresAt(','async function writeCafe24TokenRecord');
const expiry=extract('function cafe24TokenNeedsRefresh(','function safeCafe24TokenRecord');
const reader=extract('async function fetchCafe24AnalyticsOrderDetails(','async function attachCafe24OrderItems(');
const single=extract('let cafe24RefreshInFlightPromise','async function ensureCafe24AccessToken');
function context(fetch,refresh){const c={URL,cafe24AnalyticsCoverage:()=>({completeness:'COMPLETE'}),env:{CAFE24_MALL_ID:'fixture',CAFE24_ACCESS_TOKEN:'old'},ensureCafe24AccessToken:async()=>{},fetch,refreshCafe24Token:refresh||(async()=>{c.env.CAFE24_ACCESS_TOKEN='new';})};runInNewContext(single+'\n'+reader,c);return c;}
const response=(status,message)=>({ok:status===200,status,text:async()=>JSON.stringify(status===200?{orderdetails:[]}:{error:{code:status,message}})});
const request=c=>c.fetchCafe24AnalyticsOrderDetails({startDate:'2026-10-06',endDate:'2026-10-12'});
test('legacy KST, UTC and offset expiries normalize identically in UTC and KST processes',()=>{
 const code=normalization()+'\n'+expiry+'\n'+`Date.now=()=>Date.parse('2026-10-20T02:51:00Z'); console.log(JSON.stringify(['2026-10-20T12:00:47.000','2026-10-20T03:00:47Z','2026-10-20T12:00:47+09:00'].map(expiresAt=>[normalizeCafe24ExpiresAt(expiresAt),cafe24TokenNeedsRefresh({accessToken:'x',expiresAt})])));`;
 for(const TZ of ['UTC','Asia/Seoul'])assert.deepEqual(JSON.parse(execFileSync(process.execPath,['-e',code],{env:{...process.env,TZ},encoding:'utf8'})),Array(3).fill(['2026-10-20T03:00:47.000Z',true]));
});
test('expiry keeps ten-minute proactive boundary; invalid/missing expiry requires refresh',()=>{
 const c={Date:class extends Date{static now(){return Date.parse('2026-10-20T02:50:47Z');}}};runInNewContext(normalization()+'\n'+expiry,c);
 assert.equal(c.cafe24TokenNeedsRefresh({accessToken:'x',expiresAt:'2026-10-20T12:00:47.000'}),true);
 assert.equal(c.cafe24TokenNeedsRefresh({accessToken:'x',expiresAt:'2026-10-20T12:00:48.000'}),false);
 for(const expiresAt of [null,'bad','2026-02-30T12:00:00','2026-10-20T24:00:00'])assert.equal(c.cafe24TokenNeedsRefresh({accessToken:'x',expiresAt}),true);
});
test('token writer normalizes new records without exposing secrets',async()=>{
 let payload;const c={mkdir:async()=>{},writeFile:async(p,s)=>{payload=JSON.parse(s);},rename:async()=>{},join:(...x)=>x.join('/'),cafe24TokenStoreDir:'fixture',cafe24TokenStoreFile:'fixture/token',process:{pid:1},randomUUID:()=> 'id',hydrateCafe24EnvFromTokenRecord:()=>{}};
 runInNewContext(normalization()+'\n'+extract('async function writeCafe24TokenRecord(','function hydrateCafe24EnvFromTokenRecord'),c);
 await c.writeCafe24TokenRecord({accessToken:'FAKE_TOKEN',refreshToken:'FAKE_REFRESH',expiresAt:'2026-10-20T12:00:47.000'});assert.equal(payload.expiresAt,'2026-10-20T03:00:47.000Z');assert.equal(payload.refreshToken,'FAKE_REFRESH');
});
test('Analytics expiry 401 refreshes once then succeeds without changing the Production response contract',async()=>{let calls=0,refreshes=0;const c=context(async(u,o)=>{assert.equal(o.headers.Authorization,calls?'Bearer new':'Bearer old');return ++calls===1?response(401,'Expired access token.'):response(200);},async()=>{refreshes++;c.env.CAFE24_ACCESS_TOKEN='new';});const r=await request(c);assert.equal(r.ok,true);assert.equal(r.statusCode,200);assert.equal(calls,2);assert.equal(refreshes,1);});
test('persistent expiry retries at most once; permission and unrelated 401/403 never refresh',async()=>{
 for(const [status,message,retries] of [[401,'access_token time expired. (invalid_token)',1],[401,'access_token lacks permission',0],[401,'invalid_client',0],[401,'invalid_token',0],[403,'Expired access token.',0]]){let calls=0,refreshes=0;const c=context(async()=>{calls++;return response(status,message);},async()=>{refreshes++;c.env.CAFE24_ACCESS_TOKEN='new';});await assert.rejects(request(c),e=>e.status===status);assert.equal(calls,1+retries);assert.equal(refreshes,retries);}
});
test('refresh failure cannot produce COMPLETE or leak refresh error secrets',async()=>{let calls=0;const c=context(async()=>{calls++;return response(401,'Expired access token. FAKE_TOKEN');},async()=>{throw Error('FAKE_SECRET');});await assert.rejects(request(c),e=>e.status===401&&!JSON.stringify(e).includes('FAKE_')&&!e.message.includes('FAKE_'));assert.equal(calls,1);});
test('overlapping and late 401 responses reuse single-flight refresh or already rotated token',async()=>{
 let release;const gate=new Promise(r=>{release=r;});let refreshes=0;const c=context(async(u,o)=>{if(o.headers.Authorization==='Bearer old')return response(401,'Expired access token.');return response(200);},async()=>{refreshes++;await gate;c.env.CAFE24_ACCESS_TOKEN='new';});const a=request(c),b=request(c);await new Promise(r=>setImmediate(r));release();await Promise.all([a,b]);assert.equal(refreshes,1);
 let lateRelease;const lateGate=new Promise(r=>{lateRelease=r;});let n=0,lateRefreshes=0;const d=context(async(u,o)=>{if(o.headers.Authorization==='Bearer old'){if(++n===2)await lateGate;return response(401,'Expired access token.');}return response(200);},async()=>{lateRefreshes++;d.env.CAFE24_ACCESS_TOKEN='new';});const x=request(d),y=request(d);await x;lateRelease();await y;assert.equal(lateRefreshes,1);
});

test('proactive ensure failure is an authentication failure without raw credential errors',async()=>{const c=context(async()=>{assert.fail('must not request after failed ensure');});c.ensureCafe24AccessToken=async()=>{throw Error('FAKE_SECRET');};await assert.rejects(request(c),e=>e.status===401&&!e.message.includes('FAKE_SECRET'));});

test('token storage uses a private temporary file and atomic replacement; failed writes preserve the old record',async()=>{
 for(const failure of [null,'write','rename']){
  const files=new Map([['fixture/token','OLD_RECORD']]),calls=[];let hydrated=false;
  const c={mkdir:async()=>{},writeFile:async(p,s,o)=>{calls.push(['write',p,o.mode]);assert.notEqual(p,'fixture/token');if(failure==='write')throw Error('disk full');files.set(p,s);},rename:async(a,b)=>{calls.push(['rename',a,b]);if(failure==='rename')throw Error('rename failed');files.set(b,files.get(a));files.delete(a);},join:(...x)=>x.join('/'),cafe24TokenStoreDir:'fixture',cafe24TokenStoreFile:'fixture/token',process:{pid:1},randomUUID:()=> 'id',hydrateCafe24EnvFromTokenRecord:()=>{hydrated=true;}};
  runInNewContext(normalization()+'\n'+extract('async function writeCafe24TokenRecord(','function hydrateCafe24EnvFromTokenRecord'),c);
  const task=c.writeCafe24TokenRecord({accessToken:'FAKE_TOKEN',refreshToken:'FAKE_REFRESH',expiresAt:'2026-10-20T12:00:47.000'});
  if(failure){await assert.rejects(task);assert.equal(files.get('fixture/token'),'OLD_RECORD');assert.equal(hydrated,false);}else{await task;assert.equal(JSON.parse(files.get('fixture/token')).expiresAt,'2026-10-20T03:00:47.000Z');assert.equal(hydrated,true);assert.equal(calls[1][0],'rename');}
  assert.equal(calls[0][2],0o600);
 }
});
test('parallel proactive ensure calls share the existing refresh token rotation',async()=>{
 let release,refreshes=0;const gate=new Promise(r=>{release=r;});const c={env:{},readCafe24TokenRecord:async()=>({status:'active',accessToken:'old',refreshToken:'FAKE_REFRESH',expiresAt:'2026-10-20T12:00:47.000'}),cafe24TokenNeedsRefresh:()=>true,hydrateCafe24EnvFromTokenRecord:()=>{},refreshCafe24Token:async()=>{refreshes++;await gate;c.env.CAFE24_ACCESS_TOKEN='new';}};
 runInNewContext(single+'\n'+extract('async function ensureCafe24AccessToken(','// Internal Production API auth'),c);
 const calls=[c.ensureCafe24AccessToken(),c.ensureCafe24AccessToken(),c.ensureCafe24AccessToken()];await new Promise(r=>setImmediate(r));assert.equal(refreshes,1);release();assert.deepEqual(await Promise.all(calls),['new','new','new']);
});
