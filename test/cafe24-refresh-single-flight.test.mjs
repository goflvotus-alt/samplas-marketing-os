import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {join} from 'node:path';
import * as coverage from '../scripts/weekly-data-completeness.mjs';

const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const slice = (s, a, b) => {
  const start = s.indexOf(a), end = s.indexOf(b, start);
  assert(start >= 0 && end > start, a);
  return s.slice(start, end).replaceAll('export ', '');
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const period = ['2026-10-13', '2026-10-19'];
const invalid = () => Object.assign(Error('invalid_token'), {status:401});
const payload = {orders:[{order_id:'FAKE_ORDER',order_date:'2026-10-14',items:[{product_no:1,quantity:1}]}]};
const json = (status, body) => ({ok:status >= 200 && status < 300,status,json:async()=>body,text:async()=>JSON.stringify(body)});
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-21T03:00:00Z'])); }
  static now() { return Date.parse('2026-10-21T03:00:00Z'); }
}

// Execute production function bodies, with all IO confined to a Map and this fake OAuth server.
function harness({old=false,oauthFailure=null,external=false,always401=false,first401=true}={}) {
  let code = source;
  if (old) {
    // Restore only the four changed callers; pre-existing single-flight paths stay intact.
    for (const [start, end] of [
      ['if (url.pathname === "/api/cafe24/refresh-token")','if (url.pathname === "/api/cafe24/oauth/start")'],
      ['async function fetchCafe24Orders(startDate','// Only the Meta weekly adapter'],
      ['async function fetchCafe24WeeklyTrackingOrders','async function fallbackCafe24OrdersAfterError'],
      ['  // Cafe24 에러 응답은 엔드포인트','  const skip =']
    ]) {
      const begin=code.indexOf(start), finish=code.indexOf(end,begin);
      code=code.slice(0,begin)+code.slice(begin,finish).replace('await refreshCafe24TokenSingleFlight()', 'await refreshCafe24Token()')+code.slice(finish);
    }
    code = code.replace(/    if \(isCafe24RefreshTokenInvalid\(response.status, body\)\) \{[\s\S]*?\n    throw refreshError;/,
      '    if (isCafe24RefreshTokenInvalid(response.status, body)) {\n      await markCafe24ReauthRequired(refreshError);\n    }\n    throw refreshError;');
    code = code.replace(/  if \(existing\?\.refreshToken !== failedRefreshToken\) \{\n    \/\/ Do not mark a token[\s\S]*?\n  }\n/, '');
  }
  const initial = {schema:1,status:'active',accessToken:'FAKE_ACCESS_0',refreshToken:'FAKE_REFRESH_0',expiresAt:'2026-10-21T09:00:00Z'};
  const files = new Map([['/FAKE/tokens/store.json',JSON.stringify(initial)]]), calls = [], writes = [];
  let serial=0, oauthCalls=0, currentRefresh='FAKE_REFRESH_0', currentAccess=first401?'FAKE_ACCESS_REMOTE':'FAKE_ACCESS_0';
  let failure=oauthFailure, releaseOAuth=null, pending=false;
  const readStore = () => JSON.parse(files.get('/FAKE/tokens/store.json'));
  const c = {Date:FixedDate,Intl,URL,URLSearchParams,Buffer,join,process:{pid:1},randomUUID:()=>String(++serial),
    env:{CAFE24_MALL_ID:'FAKE_MALL',CAFE24_CLIENT_ID:'FAKE_CLIENT',CAFE24_CLIENT_SECRET:'FAKE_SECRET'},
    cafe24TokenStoreDir:'/FAKE/tokens',cafe24TokenStoreFile:'/FAKE/tokens/store.json',workDir:'/FAKE/work',
    readFile:async p=>{if(!files.has(p))throw Object.assign(Error('missing'),{code:'ENOENT'});return files.get(p);},
    mkdir:async()=>{},writeFile:async(p,value)=>{writes.push(p);files.set(p,value);},
    rename:async(a,b)=>{files.set(b,files.get(a));files.delete(a);},
    safeErrorMessage:e=>e.message,logCafe24OrdersDebug:async()=>{},logApiError:async()=>{},
    cafe24OrdersDebugContext:()=>({}),compactCafe24Body:()=>({}),cafe24RateLimitBackoffMs:()=>null,
    attachCafe24OrderItems:async()=>{},cafe24ApiVersion:()=>'FAKE_VERSION',
    cafe24OrdersHeaders:()=>({Authorization:`Bearer ${c.env.CAFE24_ACCESS_TOKEN}`}),
    isCurrentMonth:()=>true,monthFromDate:d=>d.slice(0,7),summarizeCafe24Orders:()=>({}),
    readCachedCafe24Orders:async()=>null,decorateCachedSource:x=>x,
    fallbackCafe24OrdersAfterError:async(s,u,e)=>{throw e;},...coverage,
    fetch:async(url,options={})=>{
      const u=new URL(url);
      assert.equal(u.hostname,'fake_mall.cafe24api.com');
      if(u.pathname.endsWith('/oauth/token')) {
        oauthCalls++;
        assert.equal(options.method,'POST');
        const submitted=new URLSearchParams(options.body).get('refresh_token');
        assert.match(submitted,/^FAKE_/);
        if(pending) await new Promise(resolve=>{releaseOAuth=resolve;});
        if(failure==='network')throw Error('FAKE_NETWORK_FAILURE');
        if(failure==='parse')return {ok:true,status:200,json:async()=>{throw Error('FAKE_PARSE_FAILURE');}};
        if(external) {
          currentAccess='FAKE_ACCESS_EXTERNAL';currentRefresh='FAKE_REFRESH_EXTERNAL';
          files.set('/FAKE/tokens/store.json',JSON.stringify({...initial,accessToken:currentAccess,refreshToken:currentRefresh}));
          return json(400,{error:'invalid_grant',error_description:'Invalid refresh_token'});
        }
        if(failure==='invalid'||submitted!==currentRefresh) {
          // Let the winning process finish its atomic write before the loser marks reauth.
          await tick();
          return json(400,{error:'invalid_grant',error_description:'Invalid refresh_token'});
        }
        currentAccess=`FAKE_ACCESS_${oauthCalls}`;currentRefresh=`FAKE_REFRESH_${oauthCalls}`;
        return json(200,{access_token:currentAccess,refresh_token:currentRefresh,expires_at:'2026-10-21T09:00:00Z'});
      }
      assert.equal(options.method||'GET','GET');
      const authorization=options.headers.Authorization;
      calls.push({path:u.pathname,authorization});
      if(always401||authorization!==`Bearer ${currentAccess}`)return json(401,{error:'invalid_token',message:'invalid_token'});
      return json(200,structuredClone(payload));
    }
  };
  const chunks = [
    slice(code,'async function readCafe24TokenRecord()', '// Internal Production API auth'),
    slice(code,'async function refreshCafe24Token()','function buildCafe24AuthorizeUrl()'),
    slice(code,'function isCafe24InvalidToken(','function cleanAdAccountId('),
    slice(code,'async function cafe24FetchJson(','async function fetchCafe24AnalyticsOrderDetails('),
    slice(code,'async function cafe24GetOrders(','function cafe24ApiVersion()'),
    slice(code,'async function fetchCafe24Orders(startDate','async function fallbackCafe24OrdersAfterError'),
    slice(code,'const META_WEEKLY_TRACKING_CODES','async function runMetaWeeklyReportCheck()')
  ];
  const diagnostic=slice(code,'  // Cafe24 에러 응답은 엔드포인트','  const skip =');
  const manual=code.match(/if \(url.pathname === "\/api\/cafe24\/refresh-token"\) \{([\s\S]*?)\n    \}/)[1];
  c.json=(res,data)=>data;c.res={};
  runInNewContext(chunks.join('\n')+`\nasync function diagnosticRead(){const mallId=env.CAFE24_MALL_ID;${diagnostic}\nreturn runCheck('orders','/orders');}\nasync function manualRefresh(){${manual}\n}`,c);
  return {c,calls,writes,files,readStore,get oauthCalls(){return oauthCalls;},
    clearFailure:()=>{failure=null;},hold:()=>{pending=true;},release:()=>{pending=false;releaseOAuth?.();},
    currentAccess:()=>currentAccess,
    rotate:()=>{
      currentAccess='FAKE_ACCESS_EXTERNAL';currentRefresh='FAKE_REFRESH_EXTERNAL';
      files.set('/FAKE/tokens/store.json',JSON.stringify({...initial,accessToken:currentAccess,refreshToken:currentRefresh}));
    }};
}

async function concurrentPaths(h) {
  // Force the outer Orders catch branches too; their retry uses the real Orders reader.
  const read=h.c.cafe24GetOrders, once=new Set();
  h.c.cafe24GetOrders=async(s,u,o={})=>{
    const key=o.inflowPath||'general';
    if(!once.has(key)){once.add(key);throw invalid();}
    return read(s,u,o);
  };
  return Promise.allSettled([
    h.c.fetchCafe24WeeklyTrackingOrders(...period,{inflowPath:'meta_ssage'}),
    h.c.fetchCafe24Orders(...period),
    h.c.cafe24FetchJson('https://FAKE_MALL.cafe24api.com/api/v2/admin/orders'),
    h.c.manualRefresh(),h.c.diagnosticRead()
  ]);
}

test('T1 concurrent tracking/general/common/manual/diagnostic refresh once and all reads succeed',async()=>{
  const h=harness();h.hold();
  const task=concurrentPaths(h);await tick();
  assert.equal(h.oauthCalls,1);h.release();
  const results=await task;
  assert(results.every(r=>r.status==='fulfilled'),JSON.stringify(results));
  assert.equal(results[0].value.coverage.completeness,'COMPLETE');
  assert.equal(results[1].value.orders[0].order_id,'FAKE_ORDER');
  assert.equal(results[2].value.orders[0].order_id,'FAKE_ORDER');
  assert.equal(results[3].value.ok,true);assert.equal(results[4].value.ok,true);
  assert.equal(h.oauthCalls,1);assert.equal(h.readStore().status,'active');
});

test('T2 control: former direct callers reuse one-use refresh token and incorrectly mark reauth',async()=>{
  const h=harness({old:true});
  const results=await concurrentPaths(h);
  assert(h.oauthCalls>1);assert.equal(h.readStore().status,'reauth_required');
  assert(results.some(r=>r.status==='rejected'||r.value?.error||r.value?.ok===false));
});

test('T3 external rotation hydrates latest access token and actual following Orders request succeeds',async()=>{
  const h=harness({external:true});
  const result=await h.c.cafe24FetchJson('https://FAKE_MALL.cafe24api.com/api/v2/admin/orders');
  assert.equal(result.orders?.[0].order_id,'FAKE_ORDER');
  assert.equal(h.calls.at(-1).authorization,'Bearer FAKE_ACCESS_EXTERNAL');
  assert.equal(h.c.env.CAFE24_ACCESS_TOKEN,'FAKE_ACCESS_EXTERNAL');
  assert.equal(h.readStore().status,'active');assert.equal(h.oauthCalls,1);
  assert.equal(h.writes.length,0);
});

test('T4 genuinely invalid refresh token still marks reauth and later ensure makes no OAuth call',async()=>{
  const h=harness({oauthFailure:'invalid'});
  await assert.rejects(h.c.refreshCafe24TokenSingleFlight());
  assert.equal(h.readStore().status,'reauth_required');
  await assert.rejects(h.c.ensureCafe24AccessToken(),/reauth_required/);
  assert.equal(h.oauthCalls,1);
});

test('W1 rotation after the outer reread but before mark preserves active and returns recovery to the caller',async()=>{
  for(const throughOrders of [false,true]) {
    const h=harness({oauthFailure:'invalid'}),mark=h.c.markCafe24ReauthRequired;
    let received;
    h.c.markCafe24ReauthRequired=async(error,usedToken)=>{
      received=usedToken;
      h.rotate(); // The winner finishes its atomic rename just before mark reads the store.
      return mark(error,usedToken);
    };
    if(throughOrders) {
      const result=await h.c.cafe24FetchJson('https://FAKE_MALL.cafe24api.com/api/v2/admin/orders');
      assert.equal(result.orders?.[0].order_id,'FAKE_ORDER');
    } else {
      const result=await h.c.refreshCafe24TokenSingleFlight();
      assert.equal(result.ok,true);assert.equal(result.concurrentRefresh,true);
      assert.deepEqual(Array.from(result.updated),[]);assert.equal(result.token.status,'active');
      assert(!JSON.stringify(result).includes('FAKE_'));
      assert.equal((await h.c.cafe24FetchJson('https://FAKE_MALL.cafe24api.com/api/v2/admin/orders')).orders[0].order_id,'FAKE_ORDER');
    }
    assert.equal(received,'FAKE_REFRESH_0');
    assert.equal(h.calls.at(-1).authorization,'Bearer FAKE_ACCESS_EXTERNAL');
    assert.equal(h.readStore().status,'active');assert.equal(h.writes.length,0);assert.equal(h.oauthCalls,1);
  }
});

test('T5 network and parsing failures keep active and release single-flight for a later retry',async()=>{
  for(const failure of ['network','parse']){
    const h=harness({oauthFailure:failure});
    await assert.rejects(h.c.refreshCafe24TokenSingleFlight());
    assert.equal(h.readStore().status,'active');h.clearFailure();
    assert.equal((await h.c.refreshCafe24TokenSingleFlight()).ok,true);
    assert.equal(h.oauthCalls,2);assert.equal(h.readStore().status,'active');
  }
});

test('T6 persistent 401 has a finite per-tracking-code refresh bound and unavailable actuals',async()=>{
  const h=harness({always401:true});
  const result=await h.c.fetchCafe24ActualOrdersForWeeklyReport(...period);
  assert.equal(h.oauthCalls,25); // 5 codes * (two embed reads + outer refresh + two retry reads).
  assert.equal(result.trackingQueries.length,5);
  assert(result.trackingQueries.every(q=>q.ok===false));
  assert.equal(result.coverage.completeness,'UNAVAILABLE');
  assert.equal(h.readStore().status,'active');
});

test('T7 a 403 access_token false positive refreshes once, preserves active and returns original error',async()=>{
  const h=harness(),error=Object.assign(Error('access_token scope forbidden'),{status:403});
  h.c.cafe24GetOrders=async()=>{throw error;};
  await assert.rejects(h.c.fetchCafe24WeeklyTrackingOrders(...period,{inflowPath:'meta_ssage'}),e=>e===error);
  assert.equal(h.oauthCalls,1);assert.equal(h.readStore().status,'active');
});

test('T8 normal and recovered Orders/coverage are identical to the previous implementation; no weekly cache write',async()=>{
  for(const first401 of [false,true]){
    const values=[];
    for(const old of [true,false]){
      const h=harness({old,first401});
      values.push(JSON.parse(JSON.stringify(await h.c.fetchCafe24WeeklyTrackingOrders(...period,{inflowPath:'meta_ssage'}))));
      assert.equal(h.oauthCalls,first401?1:0);
      assert(h.writes.every(p=>p.startsWith('/FAKE/tokens/')));
    }
    assert.deepEqual(values[1],values[0]);assert.equal(values[1].coverage.completeness,'COMPLETE');
  }
});

test('T9 raw refresh is called only inside single-flight; all four callers use single-flight',()=>{
  assert.equal((source.match(/\brefreshCafe24Token\(/g)||[]).length,2);
  for(const [start,end] of [
    ['if (url.pathname === "/api/cafe24/refresh-token")','if (url.pathname === "/api/cafe24/oauth/start")'],
    ['async function fetchCafe24Orders(startDate','// Only the Meta weekly adapter'],
    ['async function fetchCafe24WeeklyTrackingOrders','async function fallbackCafe24OrdersAfterError'],
    ['  // Cafe24 에러 응답은 엔드포인트','  const skip =']
  ])assert.match(slice(source,start,end),/await refreshCafe24TokenSingleFlight\(\)/);
});

test('every reauth marker call passes the refresh token used by the failed OAuth request',()=>{
  const verify = code => {
    const body = code.replace(/async function markCafe24ReauthRequired\([^)]*\)/, '');
    const calls = [...body.matchAll(/\bmarkCafe24ReauthRequired\s*\(([^)]*)\)/g)];
    assert(calls.length > 0);
    for (const [,args] of calls) {
      assert.deepEqual(args.split(',').map(arg=>arg.trim()), ['refreshError','record.refreshToken']);
    }
  };
  verify(source);
  // Prove the static guard rejects a missing argument and a token read after the failed request.
  for (const args of ['refreshError','refreshError, latest.refreshToken']) {
    assert.throws(()=>verify(source.replace('markCafe24ReauthRequired(refreshError, record.refreshToken)',`markCafe24ReauthRequired(${args})`)));
  }
});
