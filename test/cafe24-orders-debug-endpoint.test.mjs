import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
function reader(lines,env={}) {
 const start=source.indexOf('function redactCafe24OrdersDebug('),end=source.indexOf('async function readApiErrorLog(',start);
 assert(start>=0 && end>start,'debug reader missing');
 const reads=[];
 const fn=runInNewContext(`${source.slice(start,end)};readCafe24OrdersDebug`,{env,metaStoredAccessTokenCache:'stored-secret',URL,join:(...p)=>p.join('/'),workDir:'/work',readFile:async(...args)=>{reads.push(args);if(lines instanceof Error)throw lines;return lines;}});
 return {fn,reads};
}
const entry=i=>({time:`2026-10-06T00:00:${i}Z`,source:'cafe24_orders_debug',stage:'response',requestUrl:'https://test.cafe24api.com/api/v2/admin/orders?inflow_path=meta_ssage',apiVersion:'2025-07-01',statusCode:200,responseBody:{orders:'[array:1]'},index:i});
test('recent log defaults to 50, retains existing fields and reads only debug file',async()=>{
 const r=reader(Array.from({length:205},(_,i)=>JSON.stringify(entry(i))).join('\n'));const result=await r.fn();assert.equal(result.logs.length,50);assert.equal(result.logs[0].index,155);assert.equal(result.logs.at(-1).index,204);assert.equal(result.logs[0].apiVersion,'2025-07-01');assert.equal(result.logs[0].statusCode,200);assert.equal(result.logs[0].responseBody.orders,'[array:1]');assert.equal(result.logs[0].stage,'response');assert.equal(r.reads[0][0],'/work/cafe24-orders-debug.ndjson');
});
test('limit clamps at 200; invalid limits fall back safely; fractional/negative limits bounded',async()=>{
 const r=reader(Array.from({length:205},(_,i)=>JSON.stringify(entry(i))).join('\n'));
 for(const [limit,count] of [[500,200],[3,3],[1.9,1],[0,1],[-9,1],['bad',50],[Infinity,50],['',50]])assert.equal((await r.fn(limit)).logs.length,count);
});
test('malformed records are skipped without raw leakage and absent file returns empty',async()=>{
 const result=await reader('bad secret line\nnull\n42\n[]\n'+JSON.stringify(entry(1))).fn();assert.equal(result.logs.length,1);assert(!JSON.stringify(result).includes('secret line'));
 assert.equal((await reader(Object.assign(new Error('missing'),{code:'ENOENT'})).fn()).logs.length,0);
 await assert.rejects(reader(Object.assign(new Error('denied'),{code:'EACCES'})).fn(),/denied/);
});
test('redacts raw/encoded known credentials, nested keys, URL credentials, bearer and stale query tokens',async()=>{
 const e={...entry(1),requestUrl:'https://user:oldpass@test.cafe24api.com/api/v2/admin/orders?access_token=stale-token&client_secret=stale-secret&inflow_path=meta_ssage',authorizationHeader:'Bearer stale-bearer',responseBody:{access_token:'nested-token',nested:[{refreshToken:'nested-refresh'}],message:'known-secret stored-secret Bearer old-bearer access_token=old-token client_secret=old-secret',extra:'https://example.com/?password=old-password&x=known%2Fsecret',json:'{"client_secret":"old-json-secret"}'}};
 const result=await reader(JSON.stringify(e),{CAFE24_ACCESS_TOKEN:'known-secret',CAFE24_CLIENT_SECRET:'known/secret'}).fn();const serialized=JSON.stringify(result);
 for(const secret of ['stale-token','stale-secret','oldpass','stale-bearer','nested-token','nested-refresh','known-secret','stored-secret','old-bearer','old-token','old-secret','old-password','known%2Fsecret','old-json-secret'])assert(!serialized.includes(secret),secret);
 assert(serialized.includes('meta_ssage'));assert.equal(result.logs[0].apiVersion,'2025-07-01');assert.equal(result.logs[0].statusCode,200);
});
test('endpoint rejects mutation methods, forwards limit, and handles read errors without writes',async()=>{
 const start=source.indexOf('    if (url.pathname === "/api/diagnostics/cafe24-orders-debug")'),end=source.indexOf('    if (url.pathname === "/api/diagnostics/logs")',start);
 assert(start>=0&&end>start,'endpoint missing');let calls=0;
 const fn=runInNewContext(`(async(req,res,url)=>{${source.slice(start,end)}})`,{readCafe24OrdersDebug:async limit=>{calls++;if(limit==='error')throw new Error('failure secret');return {ok:true,logs:[],limit};},json:(_res,body,status=200)=>({body,status})});
 const url=limit=>({pathname:'/api/diagnostics/cafe24-orders-debug',searchParams:new URLSearchParams(limit?'limit='+limit:'')});
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fn({method},{},url())).status,405);
 assert.equal(calls,0);assert.equal((await fn({method:'GET'},{},url('3'))).body.limit,'3');
 const error=await fn({method:'GET'},{},url('error'));assert.equal(error.status,500);assert(!JSON.stringify(error).includes('secret'));
});
