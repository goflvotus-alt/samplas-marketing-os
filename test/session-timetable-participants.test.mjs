import test from 'node:test';
import { createHmac } from 'node:crypto';
import { timetableRequest } from '../scripts/session-timetable-api.mjs';
import assert from 'node:assert/strict';
import { createSessionService } from '../scripts/session-director-api.mjs';
import { callSessionTool, SESSION_TOOLS } from '../scripts/session-mcp.mjs';
import { createSessionDropboxStore, sessionPath } from '../scripts/session-dropbox.mjs';
import { createSessionDocument } from '../scripts/session-store.mjs';
import { createFakeDropbox } from './helpers/fake-session-dropbox.mjs';
import { applyTimetableOperations, emptyTimetable, publicTimetable } from '../scripts/session-timetable.mjs';

const id='test-session-990';
const legacy=()=>({...emptyTimetable(id),items:Array.from({length:13},(_,i)=>({id:`legacy-${i}`,start:'',end:'',title:`Row ${i}`,details:`Original\n${i}`}))});
const update=(doc,itemId,participants,kind='web')=>applyTimetableOperations(doc,[{type:'update_item',itemId,patch:{participants}}],{actor:{id:'tester',kind,privateField:'secret'}}).doc;

test('legacy active/trash read normalizes only responses; missing file read creates nothing',async()=>{
  const fake=createFakeDropbox(),store=createSessionDropboxStore({env:{},fetchImpl:fake.fetchImpl,getToken:fake.getToken});
  await store.create(createSessionDocument({number:990,isTest:true,title:'Test'}));
  const service=createSessionService(store,{env:{}});
  await service.timetable(id);
  assert.equal(fake.files.has(sessionPath(id,'timetable.json')),false);
  const doc=legacy();doc.trash.push({item:{...doc.items.pop()},index:12});
  await store.writeTimetable(id,doc,null);
  const before=fake.files.get(sessionPath(id,'timetable.json')).text;
  const response=await callSessionTool('getSessionTimetable',{id},{service,env:{},actor:{kind:'mcp',id:'test'}});
  for(const item of [...response.body.timetable.items,...response.body.timetable.trash.map(e=>e.item)])assert.deepEqual(item.participants,[]);
  assert.equal(fake.files.get(sessionPath(id,'timetable.json')).text,before);
  assert.deepEqual(publicTimetable(doc).items[0].participants,[]);
});

test('participant-only edits preserve 13 legacy rows; omitted field preserves, explicit empty clears, snapshots record source',()=>{
  const original=legacy();let doc=update(original,'legacy-4',[{name:'Alice'}]);
  assert.deepEqual(doc.items[4].participants,[{name:'Alice'}]);
  doc=update(doc,'legacy-4',[{name:'Alice',role:'Host'},{name:'Bob',role:'Guest'}],'mcp');
  doc=update(doc,'legacy-4',[{name:'Alicia',role:'Moderator'},{name:'Bob',role:'Guest'}]);
  doc=update(doc,'legacy-4',[{name:'Alicia',role:'Moderator'}]);
  for(let i=0;i<13;i++){const {participants,...rest}=doc.items[i];assert.deepEqual(rest,original.items[i]);}
  assert.deepEqual(original.items[4].participants,undefined);
  assert.equal(doc.log[0].source,'web');assert.equal(doc.log[1].source,'mcp');
  assert.deepEqual(doc.log[1].changes[0].participants,{before:[{name:'Alice',role:''}],after:[{name:'Alice',role:'Host'},{name:'Bob',role:'Guest'}]});
  assert.equal(JSON.stringify(doc.log).includes('secret'),false);
  doc=update(doc,'legacy-4',[]);assert.deepEqual(doc.items[4].participants,[]);
  const current=applyTimetableOperations(emptyTimetable(id),[{type:'add_item',item:{start:'13:00',title:'A',participants:[{name:'A'}]}}]).doc;
  const edited=applyTimetableOperations(current,[{type:'update_item',itemId:current.items[0].id,patch:{title:'B'}}]).doc;
  assert.deepEqual(edited.items[0].participants,[{name:'A'}]);
});

test('add arrays are independent of input and each other; move/delete/restore preserve participants',()=>{
  const input=[{name:'A',role:'Host'}];
  let doc=applyTimetableOperations(emptyTimetable(id),['A','B'].map(title=>({type:'add_item',item:{start:'13:00',title,participants:input}}))).doc;
  input[0].name='Changed';assert.equal(doc.items[0].participants[0].name,'A');
  doc.items[0].participants[0].name='First';assert.equal(doc.items[1].participants[0].name,'A');
  const [a,b]=doc.items.map(i=>i.id),before=structuredClone(doc.items[0]);
  doc=applyTimetableOperations(doc,[{type:'move_item',itemId:b,beforeItemId:a},{type:'delete_item',itemId:a}]).doc;
  assert.deepEqual(doc.trash[0].item,before);
  doc=applyTimetableOperations(doc,[{type:'restore_item',itemId:a}]).doc;
  assert.deepEqual(doc.items.find(i=>i.id===a),before);
});

test('malformed participants reject entire batch atomically; CAS remains independent',async()=>{
  const doc=legacy(),before=JSON.stringify(doc);
  const invalid=[null,{},'A',Array(21).fill({name:'A'}),[{}],[{name:''}],[{name:'  '}],[{name:2}],[{name:'a'.repeat(101)}],[{name:'A',role:null}],[{name:'A',role:'x'.repeat(101)}],[{name:'A',email:'private'}]];
  for(const participants of invalid){
    assert.throws(()=>applyTimetableOperations(doc,[{type:'update_item',itemId:'legacy-0',patch:{participants:[{name:'Good'}]}},{type:'update_item',itemId:'legacy-1',patch:{participants}}]),e=>e.status===400);
    assert.equal(JSON.stringify(doc),before);
  }
  let writes=0;
  const service=createSessionService({readTimetable:async()=>({doc,rev:'old'}),writeTimetable:async()=>{writes++;throw Object.assign(new Error('CAS'),{status:409});}},{env:{}});
  await assert.rejects(service.updateTimetable(id,2,[{type:'update_item',itemId:'legacy-0',patch:{participants:[]}}]),e=>e.status===409);
  assert.equal(writes,0);
  await assert.rejects(service.updateTimetable(id,1,[{type:'update_item',itemId:'legacy-0',patch:{participants:[{name:'A'}]}}]),e=>e.status===409);
  assert.equal(writes,1,'CAS is attempted once without retries');
  const schema=SESSION_TOOLS.find(t=>t.name==='updateSessionTimetable').inputSchema.properties.operations.items;
  for(const type of ['add_item','update_item'])assert.equal(schema.oneOf.find(s=>s.properties.type.const===type).properties[type==='add_item'?'item':'patch'].properties.participants.maxItems,20);
});

test('authenticated web and MCP edits persist to one filesystem store across service restart',async()=>{
  const {mkdtempSync}=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
  const {createLocalDropboxFetch}=await import('../scripts/session-local-dropbox.mjs');
  const root=mkdtempSync(join(tmpdir(),'tt-participants-disk-'));
  const makeStore=()=>createSessionDropboxStore({env:{},fetchImpl:createLocalDropboxFetch(root),getToken:async()=>"synthetic-local-only"});
  const store=makeStore();
  await store.create(createSessionDocument({number:990,isTest:true,title:'Test'}));
  const service=createSessionService(store,{env:{}}),env={SESSION_WEB_SECRET:'w'.repeat(40)},now=Date.now(),iat=Math.floor(now/1000);
  const payload=Buffer.from(JSON.stringify({iat,exp:iat+120,scope:'timetable:write',method:'PUT',id})).toString('base64url');
  const token=payload+'.'+createHmac('sha256',env.SESSION_WEB_SECRET).update('session-timetable-actor:v1.'+payload).digest('base64url');
  const web=await timetableRequest({method:'PUT',headers:{'x-session-timetable-actor':token}},id,{env,now,service,actor:{kind:'web',id:'web-tester'},readBody:async()=>({version:1,operations:[{type:'add_item',item:{start:'13:00',title:'A',participants:[{name:'Alice'}]}}]})});
  assert.deepEqual(web.timetable.items[0].participants,[{name:'Alice',role:''}]);
  const mcp=await callSessionTool('updateSessionTimetable',{id,version:2,operations:[{type:'update_item',itemId:web.timetable.items[0].id,patch:{participants:[{name:'Alice',role:'Host'}]}}]},{env:{SESSION_TIMETABLE_MCP_WRITES:'test-only'},service,actor:{kind:'mcp',id:'mcp-tester'}});
  assert.deepEqual(mcp.body.timetable.log.map(entry=>[entry.source,entry.actor]),[['web','web-tester'],['mcp','mcp-tester']]);
  const stored=(await store.readTimetable(id)).doc;
  assert.deepEqual(stored.items[0].participants,[{name:'Alice',role:'Host'}]);
  const restarted=createSessionService(makeStore(),{env:{}});
  assert.deepEqual((await restarted.timetable(id)).items[0].participants,[{name:'Alice',role:'Host'}]);
});
