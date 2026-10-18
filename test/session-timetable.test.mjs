import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionService } from '../scripts/session-director-api.mjs';
import { callSessionTool, SESSION_TOOLS } from '../scripts/session-mcp.mjs';
import {createSessionDropboxStore,sessionPath} from '../scripts/session-dropbox.mjs';
import {createSessionDocument} from '../scripts/session-store.mjs';
import {createFakeDropbox} from './helpers/fake-session-dropbox.mjs';
import {applyTimetableOperations,emptyTimetable} from '../scripts/session-timetable.mjs';
import {createHash} from 'node:crypto';
import {timetableRequest} from '../scripts/session-timetable-api.mjs';

test('TIMETABLE has isolated service and two published MCP tools', () => {
  const service = createSessionService({}, { env: {} });
  assert.equal(typeof service.timetable, 'function');
  assert.equal(typeof service.updateTimetable, 'function');
  for (const name of ['getSessionTimetable','updateSessionTimetable']) assert.ok(SESSION_TOOLS.some(t => t.name === name));
});
test('TIMETABLE MCP switch is independent of original writes switch', async () => {
  let writes = 0;
  const context = { env: { SESSION_MCP_WRITES: 'off', SESSION_TIMETABLE_MCP_WRITES: 'test-only' }, service: { updateTimetable: async () => { writes++; return { version: 2 }; } }, actor: { kind: 'mcp', id: 'test' } };
  const args = { id: 'test-session-990', version: 1, operations: [{type:'add_item',item:{start:'13:00',end:'13:10',title:'OPENING',details:'첫 줄\n둘째 줄'}}] };
  assert.equal((await callSessionTool('updateSessionTimetable',args,context)).status,200);
  for (const mode of ['off','bad',undefined]) await assert.rejects(callSessionTool('updateSessionTimetable',args,{...context,env:{SESSION_MCP_WRITES:'on',SESSION_TIMETABLE_MCP_WRITES:mode}}), e=>e.status===403);
  await assert.rejects(callSessionTool('updateSessionTimetable',{...args,id:'session-002'},context),e=>e.status===403);
  await callSessionTool('updateSessionTimetable',{...args,id:'session-002'},{...context,env:{SESSION_MCP_WRITES:'off',SESSION_TIMETABLE_MCP_WRITES:'on'}});
  assert.equal(writes,2,'on permits the isolated mock target while old MCP writes remain off');
});

test('independent file/version, add/edit/reorder/trash/restore and stale versions preserve original JSON hashes',async()=>{
  const fake=createFakeDropbox(),store=createSessionDropboxStore({env:{},fetchImpl:fake.fetchImpl,getToken:fake.getToken});
  for(const n of [1,2])await store.create(createSessionDocument({number:n,title:`Original ${n}`}));
  await store.create(createSessionDocument({number:990,isTest:true,title:'Local test'}));
  const hash=id=>createHash('sha256').update(fake.files.get(sessionPath(id)).text).digest('hex');
  const before=['session-001','session-002','test-session-990'].map(hash);
  const service=createSessionService(store,{env:{}}),id='test-session-990',actor={kind:'mcp',id:'owner'};
  assert.equal((await service.timetable(id)).version,1);
  assert.equal(fake.files.has(sessionPath(id,'timetable.json')),false,'read never creates a file');
  let d=await service.updateTimetable(id,1,[{type:'add_item',item:{title:'A',start:'13:00',end:'13:10',details:'원문\n\n줄  '}},{type:'add_item',item:{title:'B',start:'13:10'}}],actor);
  const [a,b]=d.items.map(i=>i.id);assert.equal(d.version,2);
  d=await service.updateTimetable(id,2,[{type:'update_item',itemId:a,patch:{title:'Changed'}},{type:'move_item',itemId:b,beforeItemId:a}],actor);
  assert.deepEqual(d.items.map(i=>i.id),[b,a]);assert.equal(d.items[1].details,'원문\n\n줄  ');
  d=await service.updateTimetable(id,3,[{type:'delete_item',itemId:a}],actor);assert.equal(d.trash[0].item.title,'Changed');
  d=await service.updateTimetable(id,4,[{type:'restore_item',itemId:a}],actor);assert.equal(d.items[1].id,a);assert.equal(d.log.length,4);
  const noop=await service.updateTimetable(id,5,[{type:'update_item',itemId:a,patch:{title:'Changed'}}],actor);assert.equal(noop.version,5);
  await assert.rejects(service.updateTimetable(id,2,[{type:'delete_item',itemId:a}],actor),e=>e.status===409);
  assert.deepEqual(['session-001','session-002','test-session-990'].map(hash),before);
  await assert.rejects(service.timetable('../bad'),e=>e.status===400);
  const rev=(await store.readTimetable(id)).rev;
  fake.touch(sessionPath(id,'timetable.json'),d=>{d.version++;});
  await assert.rejects(store.writeTimetable(id,d,rev),e=>e.status===409);
});
test('invalid fields/time/owner/operation and malicious HTML remain data, never cross into existing APIs',()=>{
  for(const op of [{type:'update_project',patch:{}},{type:'add_item',item:{title:'A',owner:'bad'}},{type:'add_item',item:{title:'A',start:'24:00'}},{type:'add_item',item:{title:'A',start:'14:00',end:'13:00'}},{type:'add_item',item:{title:''}},{type:'add_item',item:{title:'A',details:'a'.repeat(10001)}}])assert.throws(()=>applyTimetableOperations(emptyTimetable('test-session-990'),[op]),e=>e.status===400);
  const d=applyTimetableOperations(emptyTimetable('test-session-990'),[{type:'add_item',item:{title:'<script>alert(1)</script>',start:'13:00'}}]).doc;
  assert.equal(d.items[0].title,'<script>alert(1)</script>');
});
test('backend refuses timetable writes with only the old web actor, even when Origin/header is supplied',async()=>{
  let writes=0;
  await assert.rejects(timetableRequest({method:'PUT',headers:{origin:'https://test','x-session-director':'1'}},'test-session-990',{env:{SESSION_WEB_SECRET:'old'},service:{updateTimetable:async()=>writes++},actor:{kind:'web'},readBody:async()=>({})}),e=>e.status===403);
  assert.equal(writes,0);
});
test('required start/title errors are field-specific and never mutate stored data',async()=>{
  const fake=createFakeDropbox(),store=createSessionDropboxStore({env:{},fetchImpl:fake.fetchImpl,getToken:fake.getToken});
  await store.create(createSessionDocument({number:990,isTest:true,title:'Local test'}));
  const service=createSessionService(store,{env:{}}),id='test-session-990';
  for(const [item,field,reason] of [[{title:'A'},'start','required'],[{start:'13:00',title:' '},'title','required'],[{title:'A',start:'99:99'},'start','invalid_format'],[{title:'A',start:'13:00',end:'12:00'},'end','end_before_start']]){
    await assert.rejects(service.updateTimetable(id,1,[{type:'add_item',item}],{id:'test'}),e=>e.status===400&&e.details.field===field&&e.details.reason===reason&&!e.message.includes('Local test'));
    assert.equal((await service.timetable(id)).version,1);assert.equal(fake.files.has(sessionPath(id,'timetable.json')),false);
  }
  const d=await service.updateTimetable(id,1,[{type:'add_item',item:{start:'13:00',title:'A'}}],{id:'test'});assert.equal(d.items[0].end,'');assert.equal(d.items[0].details,'');
  const before=fake.files.get(sessionPath(id,'timetable.json')).text;
  await assert.rejects(service.updateTimetable(id,2,[{type:'update_item',itemId:d.items[0].id,patch:{start:''}}],{id:'test'}),e=>e.details.field==='start');
  assert.equal(fake.files.get(sessionPath(id,'timetable.json')).text,before);
});
test('trash retains newest 100 entries and history newest 200 versions',()=>{
  let doc=emptyTimetable('test-session-990');
  for(let i=0;i<105;i++){
    doc=applyTimetableOperations(doc,[{type:'add_item',item:{title:`A${i}`,start:'13:00'}}]).doc;
    doc=applyTimetableOperations(doc,[{type:'delete_item',itemId:doc.items[0].id}]).doc;
  }
  assert.equal(doc.trash.length,100);assert.equal(doc.trash[0].item.title,'A5');assert.equal(doc.trash.at(-1).item.title,'A104');assert.equal(doc.log.length,200);assert.equal(doc.log.at(-1).version,doc.version);
});
