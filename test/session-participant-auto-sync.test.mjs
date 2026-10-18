import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticipantImportService } from '../scripts/session-participant-import.mjs';
import { createSessionService, startParticipantAutoSync } from '../scripts/session-director-api.mjs';
import { createSessionDropboxStore, sessionPath } from '../scripts/session-dropbox.mjs';
import { SESSION001_HEADERS, participantsView, applyParticipantOperations } from '../scripts/session-participants.mjs';
import { createSessionDocument, SessionError } from '../scripts/session-store.mjs';
import { callSessionTool } from '../scripts/session-mcp.mjs';
import { createFakeDropbox } from './helpers/fake-session-dropbox.mjs';
import { execFileSync } from 'node:child_process';

// No live credentials, Sheets requests or files: even SESSION 001 is entirely in-memory here.
const ID='session-001',ACTOR={kind:'web',id:'fixture@example.test'};
const ENV={SESSION_PARTICIPANTS_SYNC:'on',SESSION_PARTICIPANT_HMAC_KEY:'synthetic-hmac-key-01234567890123456789',SESSION001_SHEET_ID:'synthetic_sheet_01234567890',
 SESSION_GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'fixture@example.test',private_key:'fixture-only'})};
const row=n=>['2026-09-01 12:00:'+n,'Synthetic '+n,'0107000'+String(n).padStart(4,'0'),'fixture'+n,'참석 가능','1년','Fixture question','Fixture answer','촬영 미동의','인터뷰 미참여'];
function fixture(){
 const fake=createFakeDropbox(),store=createSessionDropboxStore({env:{},getToken:fake.getToken,fetchImpl:fake.fetchImpl});
 fake.files.set(sessionPath(ID),{text:JSON.stringify(createSessionDocument({number:1,title:'SYNTHETIC AUTO SYNC FIXTURE'},{actor:'fixture'})),rev:'fixture-project'});
 let rows=[SESSION001_HEADERS,...Array.from({length:18},(_,i)=>row(i+1))],reads=0,time=Date.parse('2026-10-17T00:00:00Z'),readError=null;
 const readRows=async()=>{reads++;if(readError)throw readError;return structuredClone(rows);};
 const service=createParticipantImportService(store,{env:ENV,readRows,now:()=>time});
 const uploads=()=>fake.calls.filter(c=>c.url.endsWith('/files/upload'));
 const bootstrap=async()=>{const p=await service.preview(ID,{version:0},ACTOR);return service.commit(ID,{version:0,previewToken:p.previewToken},ACTOR);};
 return {fake,store,service,readRows,bootstrap,uploads,reads:()=>reads,rows:r=>{rows=r;},error:e=>{readError=e;},advance:()=>{time+=60000;}};
}

test('automatic sync cannot bootstrap real data; only the existing approved preview/commit unlocks it',async()=>{
 const f=fixture();const out=await f.service.autoSync(ID);
 assert.equal(out.status,'awaiting_initial_import');assert.equal(f.reads(),0);assert.equal(f.uploads().length,0);
 assert.notEqual((await f.service.autoSync('session-002')).status,'synced');assert.equal((await f.service.autoSync('test-session-990')).status,'unavailable');assert.equal(f.uploads().length,0);
 const initial=await f.bootstrap();assert.equal(initial.summary.applied,18);assert.equal(initial.summary.confirmed,0);assert.equal(initial.summary.capacity,15);
 f.advance();const again=await f.service.autoSync(ID);assert.equal(again.status,'unchanged');assert.equal(f.uploads().length,1,'no repeated write for identical responses');
 assert.equal(again.counts.validApplicants,18);
});

test('new requests become applied; repeated HMAC identity merges and every operating field survives',async()=>{
 const f=fixture();await f.bootstrap();
 const path=sessionPath(ID,'participants.json');
 f.fake.touch(path,d=>{d.version++;for(let i=0;i<d.people.length;i++)Object.assign(d.people[i].ops,{status:['confirmed','waitlisted','cancelled','no_show','applied'][i%5],notice:'sent',memo:'fixture private memo',checkedInAt:i===0?'2026-09-06T04:00:00Z':null});});
 const before=f.fake.json(path),ops=before.people.map(p=>p.ops),ids=before.people.map(p=>p.id);
 f.rows([SESSION001_HEADERS,...Array.from({length:19},(_,i)=>row(i+1)),Object.assign(row(19),{0:'2026-09-02 12:00:00'})]);
 const out=await f.service.autoSync(ID),saved=f.fake.json(path);
 assert.equal(out.status,'synced');assert.equal(out.result.added,1);assert.equal(out.counts.duplicateResponses,1);assert.equal(saved.people.length,19);
 assert.deepEqual(saved.people.slice(0,18).map(p=>p.ops),ops);assert.deepEqual(saved.people.slice(0,18).map(p=>p.id),ids);
 assert.equal(saved.people[18].ops.status,'applied');assert.equal(saved.people[18].response.additionalResponses.length,1);
 assert.equal(saved.capacity,15);assert(!JSON.stringify(out).includes('Synthetic'));assert(!JSON.stringify(saved.log).includes('private memo'));
 assert.equal((await f.service.autoSync(ID)).status,'unchanged');assert.equal(f.uploads().length,2);
});

test('network/empty/header errors leave the saved list and operations byte-identical',async()=>{
 const f=fixture();await f.bootstrap();const before=structuredClone([...f.fake.files]);
 f.error(new SessionError(502,'sheets_network_failed','PRIVATE DETAILS'));
 assert.equal((await f.service.autoSync(ID)).status,'error');
 f.error(null);f.rows([SESSION001_HEADERS]);assert.equal((await f.service.autoSync(ID)).status,'error');
 f.rows([['wrong header'],['private cell']]);assert.equal((await f.service.autoSync(ID)).status,'error');
 assert.deepEqual([...f.fake.files],before);assert.equal(f.uploads().length,1);
 assert(!JSON.stringify(f.service.autoSyncStatus(ID,(await f.store.readParticipants(ID)).doc)).includes('PRIVATE'));
});

test('CAS conflict never overwrites a concurrent operator change; next poll rereads and preserves it',async()=>{
 const f=fixture();await f.bootstrap();f.rows([SESSION001_HEADERS,...Array.from({length:19},(_,i)=>row(i+1))]);
 const write=f.store.writeParticipants.bind(f.store),path=sessionPath(ID,'participants.json');let once=true;
 f.store.writeParticipants=async(...args)=>{if(once){once=false;f.fake.touch(path,d=>{d.version++;d.people[0].ops.memo='concurrent operator';});}return write(...args);};
 assert.equal((await f.service.autoSync(ID)).status,'error');assert.equal(f.fake.json(path).people.length,18);
 const after=await f.service.autoSync(ID);assert.equal(after.status,'synced');assert.equal(f.fake.json(path).people.length,19);assert.equal(f.fake.json(path).people[0].ops.memo,'concurrent operator');
});

test('lost upload reply is not retried blindly or duplicated on the next poll',async()=>{
 const f=fixture();await f.bootstrap();f.rows([SESSION001_HEADERS,...Array.from({length:19},(_,i)=>row(i+1))]);
 const write=f.store.writeParticipants.bind(f.store);f.store.writeParticipants=async(...args)=>{await write(...args);throw new SessionError(502,'dropbox_network_failed');};
 assert.equal((await f.service.autoSync(ID)).status,'error');assert.equal(f.uploads().length,2);assert.equal(f.fake.json(sessionPath(ID,'participants.json')).people.length,19);
 assert.equal((await f.service.autoSync(ID)).status,'unchanged');assert.equal(f.uploads().length,2);
});

test('concurrent polls share work; disabled gate and changed HMAC cannot write',async()=>{
 const f=fixture();await f.bootstrap();const n=f.reads();
 await Promise.all([f.service.autoSync(ID),f.service.autoSync(ID)]);assert.equal(f.reads(),n+1);
 for(const env of [{...ENV,SESSION_PARTICIPANTS_SYNC:'off'},{...ENV,SESSION_PARTICIPANT_HMAC_KEY:'different-synthetic-key-01234567890123456789'}]){
  const service=createParticipantImportService(f.store,{env,readRows:f.readRows});
  assert(['disabled','error'].includes((await service.autoSync(ID)).status));
 }
 assert.equal(f.uploads().length,1);
});

test('REST and MCP see the same stored participants; HMAC internals never enter replies',async()=>{
 const f=fixture();await f.bootstrap();const service=createSessionService(f.store,{env:ENV,readRows:f.readRows});
 const doc=await service.participants(ID),mcp=await callSessionTool('getSessionParticipants',{id:ID},{env:ENV,service,actor:{kind:'mcp',id:'fixture'}});
 assert.equal(doc.people.length,18);assert.equal(mcp.body.participants.people.length,18);assert.equal(doc.version,mcp.body.participants.version);
 assert(!JSON.stringify(mcp).includes('importKeyId'));assert.equal(mcp.body.participants.people[0].response.phone,undefined);
 assert.equal(doc.autoSync.status,'idle');assert.equal(participantsView((await f.store.readParticipants(ID)).doc).sync.importKeyId,undefined);
 assert.throws(()=>applyParticipantOperations((f.fake.json(sessionPath(ID,'participants.json'))),Array.from({length:16},(_,i)=>({type:'update_participant',participantId:doc.people[i].id,patch:{status:'confirmed'}})),{actor:ACTOR}),e=>e.code==='capacity_full');
});

test('server scheduler polls without a browser, detaches timer and never logs sensitive failures',async()=>{
 let tick,period,detached=false,calls=0;
 const timer=startParticipantAutoSync(()=>({list:async()=>[{id:ID},{id:'test-session-990'}],autoSyncParticipants:async id=>{assert.equal(id,ID);calls++;throw Error('PRIVATE');}}),(callback,ms)=>{tick=callback;period=ms;return {unref(){detached=true;}};});
 assert.equal(period,60000);assert.equal(detached,true);assert(timer);
 await tick();assert.equal(calls,1);
});

test('automatic startup is Render production runtime only, never preview, build or local imports',()=>{
 const code="let timers=0;globalThis.setInterval=()=>{timers++;return {unref(){}}};await import('./scripts/session-director-api.mjs');console.log(timers)";
 for(const [env,expected] of [[{},0],[{RENDER:'true',IS_PULL_REQUEST:'true',NODE_ENV:'production'},0],[{RENDER:'true',IS_PULL_REQUEST:'false'},0],[{RENDER:'true',IS_PULL_REQUEST:'false',NODE_ENV:'production'},1]]){
  const out=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('../',import.meta.url),env,encoding:'utf8'});
  assert.equal(Number(out.trim()),expected);
 }
});
