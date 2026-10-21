import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const frontend = await readFile(new URL('../outputs/samplas-marketing-os.js', import.meta.url), 'utf8');
function harness() {
  let now = 1000, serial = 0, calls = 0, saved;
  const logs = [];
  const c = { URL, URLSearchParams, Buffer, Date: class extends Date { static now(){return now;} },
    randomUUID:()=>`FAKE_STATE_${++serial}`, host:'localhost', port:8787,
    env:{CAFE24_MALL_ID:'FAKE', CAFE24_CLIENT_ID:'FAKE', CAFE24_CLIENT_SECRET:'FAKE'},
    console:{log:(...args)=>logs.push(JSON.stringify(args))},
    fetch:async()=>{calls++;return {ok:true,json:async()=>({access_token:'FAKE_ACCESS',refresh_token:'FAKE_REFRESH',scopes:['mall.read_order']})};},
    writeCafe24TokenRecord:async record=>(saved=record),safeCafe24TokenRecord:()=>({status:'active'}) };
  const start=source.indexOf('const cafe24OAuthStates');
  assert(start>=0,'dedicated state store exists');
  runInNewContext(source.slice(start,source.indexOf('// cafe24OAuthSuccessHtml',start))+source.slice(source.indexOf('function cafe24RedirectUri()'),source.indexOf('// ---------------------------------------------------------------------------',source.indexOf('function cafe24RedirectUri()'))),c);
  return {c,logs,get calls(){return calls;},get saved(){return saved;},expire:()=>{now+=600000;},start:()=>new URL(c.buildCafe24AuthorizeUrl()).searchParams.get('state'),callback:state=>c.handleCafe24OAuthCallback(new URL(`http://localhost/callback?code=FAKE_CODE${state==null?'':`&state=${state}`}`))};
}
test('concurrent starts remain independent; valid callbacks exchange once and preserve scopes', async()=>{
  const h=harness(), a=h.start(), b=h.start();assert.notEqual(a,b);
  await Promise.all([h.callback(a),h.callback(b)]);assert.equal(h.calls,2);
  assert.deepEqual(Array.from(h.saved.scopes),['mall.read_order']);
  await assert.rejects(h.callback(a),/state/);assert.equal(h.calls,2);
  assert(!h.logs.join('').includes(a));assert(!h.logs.join('').includes('authorize?'));
});
test('missing, mismatched, expired and pre-restart states never exchange tokens',async()=>{
  const h=harness(),state=h.start();
  for(const value of [null,'UNKNOWN']) await assert.rejects(h.callback(value),/state/);
  h.expire();await assert.rejects(h.callback(state),/state/);assert.equal(h.calls,0);
  const restarted=harness();await assert.rejects(restarted.callback(state),/state/);assert.equal(restarted.calls,0);
});
test('OAuth errors are bounded and control characters removed; error callbacks consume state',async()=>{
  const h=harness(),state=h.start();
  await assert.rejects(h.c.handleCafe24OAuthCallback(new URL(`http://localhost/callback?state=${state}&error=denied%0A%00&error_description=${'x'.repeat(200)}%0D%0A`)),e=>!/[\x00-\x1f\x7f]/.test(e.message)&&e.message.length<=265);
  await assert.rejects(h.callback(state),/state/);assert.equal(h.calls,0);
});
test('token writer stores only string scopes and defaults missing scopes to []',async()=>{
  let stored;const c={mkdir:async()=>{},writeFile:async(p,v)=>{stored=JSON.parse(v);},rename:async()=>{},join:(...x)=>x.join('/'),process:{pid:1},randomUUID:()=>1,cafe24TokenStoreDir:'/FAKE',cafe24TokenStoreFile:'/FAKE/store',normalizeCafe24ExpiresAt:()=>null,hydrateCafe24EnvFromTokenRecord:()=>{}};
  runInNewContext(source.slice(source.indexOf('async function writeCafe24TokenRecord('),source.indexOf('function hydrateCafe24EnvFromTokenRecord(')),c);
  await c.writeCafe24TokenRecord({scopes:['mall.read_order',null,{}]});assert.deepEqual(stored.scopes,['mall.read_order']);
  await c.writeCafe24TokenRecord({});assert.deepEqual(stored.scopes,[]);
});
test('dashboard obtains operator session before navigation and stays on cancellation/failure',async()=>{
  for(const result of [true,false,'throw']){
    let release;const location={href:'UNCHANGED'};
    const c={window:{location},fetchWithOperatorSession:()=>new Promise((resolve,reject)=>{release=()=>result==='throw'?reject(Error('FAKE')):resolve({ok:result});})};
    const start=frontend.indexOf('async function startCafe24Reauth(');assert(start>=0);
    runInNewContext(frontend.slice(start,frontend.indexOf('\nasync function ',start+1)),c);
    const pending=c.startCafe24Reauth();assert.equal(location.href,'UNCHANGED');release();await pending;
    assert.equal(location.href,result===true?'/api/cafe24/oauth/start':'UNCHANGED');
  }
  assert.match(frontend,/event\.target\.closest\(['"]a\[href=.*cafe24\/oauth\/start/);
});
test('state is consumed before a pending token exchange; a concurrent replay cannot exchange',async()=>{
  const h=harness(), state=h.start();let release, calls=0;
  h.c.fetch=async()=>{calls++;await new Promise(resolve=>{release=resolve;});return {ok:true,json:async()=>({access_token:'FAKE',refresh_token:'FAKE'})};};
  const first=h.callback(state);await assert.rejects(h.callback(state),/state/);assert.equal(calls,1);release();await first;
});
test('missing code consumes state without exchange; exchange errors are sanitized and not replayable',async()=>{
  const h=harness(), state=h.start();
  await assert.rejects(h.c.handleCafe24OAuthCallback(new URL(`http://localhost/callback?state=${state}`)),/code/);
  await assert.rejects(h.callback(state),/state/);assert.equal(h.calls,0);
  const next=h.start();h.c.fetch=async()=>({ok:false,status:400,json:async()=>({error_description:`bad\n\x00  ${'x'.repeat(200)}`})});
  await assert.rejects(h.callback(next),e=>e.message.length===120&&!/[\x00-\x1f\x7f]/.test(e.message)&&!e.message.includes('  '));
  await assert.rejects(h.callback(next),/state/);
});
test('legacy stored records without scopes normalize to an empty array on read',async()=>{
  const c={readFile:async()=>JSON.stringify({accessToken:'FAKE',refreshToken:'FAKE'}),cafe24TokenStoreFile:'/FAKE',hydrateCafe24EnvFromTokenRecord:()=>{}};
  runInNewContext(source.slice(source.indexOf('async function readCafe24TokenRecord('),source.indexOf('function normalizeCafe24ExpiresAt(')),c);
  assert.deepEqual(Array.from((await c.readCafe24TokenRecord()).scopes),[]);
});
test('OAuth logs contain no credentials, authorization code, state or full authorization URL',async()=>{
  const h=harness(),state=h.start();await h.callback(state);
  for(const value of [state,'FAKE_CODE','FAKE_ACCESS','FAKE_REFRESH','FAKE_SECRET','https://','authorizeUrl']) assert(!h.logs.join('').includes(value),value);
  assert(!source.includes('env.CAFE24_OAUTH_STATE'));
});
