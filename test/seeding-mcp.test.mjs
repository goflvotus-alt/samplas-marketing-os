import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SEEDING_TOOLS,callSeedingTool,createSeedingRestClient,seedingRpc,serveSeedingMcp} from '../scripts/seeding-mcp.mjs';
import {isAiAuditAuthorized} from '../scripts/ai-audit.mjs';
const detail=version=>({ok:true,project:{name:'민타임 / MEANTIME',version},seedings:[{instagramId:'test',memo:'keep'}],creators:[],summary:{total:1}});
const update={name:'민타임 / MEANTIME',version:5,operations:[{type:'update_seeding',instagramId:'@test',patch:{memo:'requested'}}]};
test('exact three tools and schemas, list does not disclose detail',async()=>{
 assert.deepEqual(SEEDING_TOOLS.map(t=>t.name),['listSeedingProjects','getSeedingProject','updateSeedingProject']);
 assert.deepEqual(SEEDING_TOOLS[2].inputSchema.required,['name','version','operations']);
 let calls=[];const result=await callSeedingTool('listSeedingProjects',{},async(...a)=>{calls.push(a);return {status:200,body:{ok:true,projects:[{name:'MEANTIME',version:5,counts:{total:1}}]}}});
 assert.equal(result.status,200);assert.deepEqual(calls,[['GET','projects']]);
 assert.equal((await callSeedingTool('listSeedingProjects',{},async()=>({status:200,body:{ok:true,projects:[{name:'MEANTIME',phone:'private'}]}}))).status,502);
 assert.equal((await callSeedingTool('getSeedingProject',{name:update.name},async(method,path,name)=>{assert.deepEqual([method,path,name],['GET','project',update.name]);return {status:200,body:detail(5)}})).body.project.version,5);
});
test('valid write GET → exact PUT → GET verification, rename supported',async()=>{
 let state=detail(5),calls=[];const request=async(method,path,name,payload)=>{calls.push([method,path,name,payload]);if(method==='PUT'){assert.deepEqual(payload,{version:5,operations:update.operations});state.project.version++;state.seedings[0].memo='requested'}return {status:200,body:structuredClone(state)}};
 const result=await callSeedingTool('updateSeedingProject',update,request);assert.equal(result.body.verified,true);assert.equal(result.body.project.version,6);assert.equal(result.body.seedings[0].memo,'requested');assert.deepEqual(calls.map(c=>c[0]),['GET','PUT','GET']);
 let names=[];await callSeedingTool('updateSeedingProject',{name:'old',version:5,operations:[{type:'update_project',patch:{name:'new'}}]},async(method,path,name)=>{names.push(name);return {status:200,body:{...detail(method==='PUT'||names.length===3?6:5),project:{name:method==='GET'&&names.length===1?'old':'new',version:method==='PUT'||names.length===3?6:5}}}});assert.deepEqual(names,['old','old','new']);
});
test('stale version and Dropbox rev races read latest, never retry',async()=>{
 let calls=[];let result=await callSeedingTool('updateSeedingProject',update,async(method)=>{calls.push(method);return {status:200,body:detail(6)}});assert.equal(result.status,409);assert.equal(result.body.currentVersion,6);assert.deepEqual(calls,['GET']);
 calls=[];result=await callSeedingTool('updateSeedingProject',update,async(method)=>{calls.push(method);return method==='PUT'?{status:409,body:{ok:false,error:'version_conflict',currentVersion:6}}:{status:200,body:detail(calls.length===1?5:6)}});assert.equal(result.status,409);assert.equal(result.body.latest.project.version,6);assert.deepEqual(calls,['GET','PUT','GET']);
});
test('invalid payload rejected before any I/O; 404 preserved',async()=>{
 for(const args of [{...update,version:'5'},{...update,operations:[{type:'update_seeding',instagramId:'test',patch:{phone:42}}]},{...update,expectedVersion:5},{...update,operations:[{type:'update_seeding',instagramId:'test',patch:{id:'bad'}}]}]){assert.equal((await callSeedingTool('updateSeedingProject',args,()=>assert.fail('must not call upstream'))).status,400)}
 assert.equal((await callSeedingTool('getSeedingProject',{name:'missing'},async()=>({status:404,body:{ok:false,error:'project_not_found'}}))).status,404);
});
test('readback failure/concurrent change and ambiguous write do not retry',async()=>{
 for(const mode of ['failed','changed','ambiguous']){let calls=[];const result=await callSeedingTool('updateSeedingProject',update,async method=>{calls.push(method);if(calls.length===1)return {status:200,body:detail(5)};if(method==='PUT')return mode==='ambiguous'?{status:502,body:{ok:false,error:'write_outcome_unknown_read_before_retry'}}:{status:200,body:detail(6)};return mode==='failed'?{status:502,body:{ok:false,error:'offline'}}:{status:200,body:detail(7)}});assert.notEqual(result.status,200);assert.equal(calls.filter(x=>x==='PUT').length,1)}
});
test('upstream URL encoded, token server-side, body untouched, redirect/errors safe',async()=>{
 let seen;const request=createSeedingRestClient({baseUrl:'http://127.0.0.1:9999',token:'fixture-only',fetchImpl:async(url,init)=>{seen={url,init};return new Response(JSON.stringify(detail(6)))}});
 assert.equal((await request('PUT','project',update.name,{version:5,operations:update.operations})).status,200);assert.equal(seen.url.searchParams.get('name'),update.name);assert.equal(seen.init.headers['x-samplas-internal-token'],'fixture-only');assert.equal(seen.init.redirect,'manual');assert.deepEqual(JSON.parse(seen.init.body),{version:5,operations:update.operations});
 for(const response of [new Response('',{status:302,headers:{Location:'https://other.example'}}),new Response('private upstream error',{status:502})]){const client=createSeedingRestClient({baseUrl:'http://127.0.0.1',token:'fixture-only',fetchImpl:async()=>response});const failure=await client('GET','project','x');assert.equal(failure.status,502);assert.ok(!JSON.stringify(failure).includes('private upstream'))}
 const offline=createSeedingRestClient({baseUrl:'http://127.0.0.1',token:'fixture-only',fetchImpl:async()=>{throw Error('fixture-only private token')}});assert.equal((await offline('PUT','project','x',{})).body.error,'write_outcome_unknown_read_before_retry');
});
test('RPC initialize, notifications, bad methods and errors',async()=>{
 assert.equal((await seedingRpc({jsonrpc:'2.0',method:'notifications/initialized'},null)).status,202);
 assert.equal((await seedingRpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},null)).body.result.protocolVersion,'2025-03-26');
 assert.equal((await seedingRpc([],null)).body.error.code,-32600);
 assert.equal((await seedingRpc({jsonrpc:'2.0',id:1,method:'bad'},null)).body.error.code,-32601);
 const failure=await seedingRpc({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'updateSeedingProject',arguments:{}}},null);assert.equal(failure.body.result.isError,true);assert.equal(failure.body.result.structuredContent.httpStatus,400);
});
test('real external MCP SDK initialize/list/get/write over HTTP; auth denies, GET 405',async()=>{
 let state=detail(5),puts=0;
 const server=createServer(async(req,res)=>{if(!isAiAuditAuthorized(req,{AI_AUDIT_SECRET:'fixture-only'})){res.writeHead(401);return res.end('{}')}await serveSeedingMcp(req,res,async(method)=>{if(method==='PUT'){puts++;state.project.version=6;state.seedings[0].memo='requested'}return {status:200,body:method==='GET'&&req.url==='never'?{}:structuredClone(state)}})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=new URL(`http://127.0.0.1:${server.address().port}/mcp`);
 const client=new Client({name:'seeding-tests',version:'1.0.0'}),transport=new StreamableHTTPClientTransport(url,{requestInit:{headers:{'x-samplas-internal-token':'fixture-only'}}});
 try{
  assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(url,{headers:{'x-samplas-internal-token':'fixture-only'}})).status,405);
  await client.connect(transport);assert.equal((await client.listTools()).tools.length,3);
  assert.equal((await client.callTool({name:'getSeedingProject',arguments:{name:update.name}})).structuredContent.project.version,5);
  assert.equal((await client.callTool({name:'updateSeedingProject',arguments:update})).structuredContent.verified,true);assert.equal(puts,1);
 }finally{await client.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
});
