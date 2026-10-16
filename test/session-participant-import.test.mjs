import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticipantImportService, SESSION001_SOURCE } from '../scripts/session-participant-import.mjs';
import { createSessionService, handleSessionDirectorRequest, signActorToken } from '../scripts/session-director-api.mjs';
import { createSessionDropboxStore, sessionPath, SESSION_ROOTS } from '../scripts/session-dropbox.mjs';
import { createSessionDocument, SessionError } from '../scripts/session-store.mjs';
import { FORM_HEADERS, SESSION001_HEADERS } from '../scripts/session-participants.mjs';
import { callSessionTool, SESSION_TOOLS } from '../scripts/session-mcp.mjs';
import { createFakeDropbox } from './helpers/fake-session-dropbox.mjs';

// Only fixture rows, never live Sheet reads. Reuse the historical header contract without real applications.
const HEADERS=SESSION001_HEADERS;
const ID='test-session-908', SOURCE={sheetId:'synthetic_sheet_01234567890',sheetRange:"'Responses'!A1:J10002",profile:'session-001'};
const ENV={SESSION_PARTICIPANT_HMAC_KEY:'synthetic-only-hmac-key-0123456789012345',SESSION_PARTICIPANTS_SYNC:'on',SESSION_GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'fixture@example.test',private_key:'fixture-only'}),SESSION_WEB_SECRET:'fixture-web',SESSION_OPERATOR_EMAILS:'operator@example.test'};
const ACTOR={kind:'web',id:'operator@example.test',approver:false};
const row=n=>['2026-09-01 13:00:'+n,'Synthetic Person '+n,'0107000'+String(n).padStart(4,'0'),'@fixture'+n,'참석 가능','1년','Synthetic question '+n,'Synthetic topic','촬영 미동의','인터뷰 미참여'];
function fixture(){
 const fake=createFakeDropbox();const project=createSessionDocument({number:908,title:'SYNTHETIC IMPORT TEST',isTest:true},{actor:'fixture'});
 fake.files.set(sessionPath(ID),{text:JSON.stringify(project),rev:'project-fixture'});
 let rows=[HEADERS,...Array.from({length:18},(_,i)=>row(i+1))],time=Date.parse('2026-10-16T00:00:00Z'),reads=0;
 const store=createSessionDropboxStore({env:{},getToken:fake.getToken,fetchImpl:fake.fetchImpl});
 const readRows=async({sheetId,range})=>{reads++;assert.equal(sheetId,SOURCE.sheetId);assert.equal(range,SOURCE.sheetRange);return structuredClone(rows);};
 const service=createParticipantImportService(store,{env:ENV,readRows,now:()=>time});
 return {fake,store,readRows,service,setRows:r=>{rows=r;},rows:()=>rows,setTime:t=>{time=t;},reads:()=>reads,uploads:()=>fake.calls.filter(c=>c.url.endsWith('/files/upload'))};
}
const preview=f=>f.service.preview(ID,{version:0,source:SOURCE},ACTOR);
const commit=(f,p,actor=ACTOR)=>f.service.commit(ID,{version:p.version,source:SOURCE,previewToken:p.previewToken},actor);

test('18 fixture responses preview without writes and import as applied at capacity 15 with verified readback',async()=>{
 const f=fixture(),before=structuredClone([...f.fake.files]);const p=await preview(f);
 assert.deepEqual(p.counts,{rawResponses:18,validApplicants:18,duplicateResponses:0,excludedResponses:0});
 assert.equal(p.capacity,15);assert.equal(p.version,0);assert.deepEqual([...f.fake.files],before);assert.equal(f.uploads().length,0);
 assert(!JSON.stringify(p).includes('Synthetic Person'));assert(!JSON.stringify(p).includes('0107000'));
 const result=await commit(f,p);assert.equal(result.verified,true);assert.equal(result.version,1);assert.equal(result.summary.applied,18);assert.equal(result.summary.confirmed,0);assert.equal(result.summary.capacity,15);
 assert(!JSON.stringify(result).includes('Synthetic Person'));assert(!JSON.stringify(result).includes('0107000'));
 const saved=f.fake.json(sessionPath(ID,'participants.json'));assert.equal(saved.people.length,18);assert.equal(saved.form.linkVisible,false);
 assert(!JSON.stringify(saved).includes('01070000001'));assert(!JSON.stringify(saved.log).includes('Synthetic Person'));
 assert(f.uploads().every(c=>c.arg.path.startsWith(SESSION_ROOTS.test+'/')));
 assert.equal(f.fake.files.get(sessionPath(ID)).text,before[0][1].text);
});
test('historical duplicates coalesce; excluded and blank rows counted correctly; reimport keeps ops',async()=>{
 const f=fixture();f.setRows([HEADERS,row(1),{...row(1),0:'2026-09-02 12:00:00'},row(2),['bad','', '010'],[]].map(r=>Array.isArray(r)?r:Object.values(r)));
 const p=await preview(f);assert.deepEqual(p.counts,{rawResponses:4,validApplicants:2,duplicateResponses:1,excludedResponses:1});await commit(f,p);
 const {doc,rev}=await f.store.readParticipants(ID);doc.version++;Object.assign(doc.people[0].ops,{status:'confirmed',notice:'sent',checkedInAt:'2026-09-06T04:00:00Z'});await f.store.writeParticipants(ID,doc,rev);
 const ops=structuredClone(doc.people.map(p=>p.ops));const p2=await f.service.preview(ID,{version:2,source:SOURCE},ACTOR);const done=await commit(f,p2);
 assert.equal(done.result.added,0);assert.equal(done.summary.confirmed,1);assert.equal(done.summary.checkedIn,1);assert.deepEqual((await f.store.readParticipants(ID)).doc.people.map(p=>p.ops),ops);
});
test('stale versions, changed rows, source, actor, token and expiry fail without uploads',async()=>{
 const f=fixture(),p=await preview(f);f.setRows([HEADERS,row(99)]);
 await assert.rejects(commit(f,p),e=>e.code==='preview_stale');f.setRows([HEADERS,...Array.from({length:18},(_,i)=>row(i+1))]);
 await assert.rejects(commit(f,p,{...ACTOR,id:'other@example.test'}),e=>e.code==='invalid_preview');
 await assert.rejects(f.service.commit(ID,{version:0,source:{...SOURCE,sheetId:'another_sheet_01234567890'},previewToken:p.previewToken},ACTOR),e=>e.code==='invalid_preview');
 await assert.rejects(f.service.commit(ID,{version:0,source:SOURCE,previewToken:p.previewToken+'x'},ACTOR),e=>e.code==='invalid_preview');
 f.setTime(Date.parse('2026-10-16T00:11:00Z'));await assert.rejects(commit(f,p),e=>e.code==='preview_expired');assert.equal(f.uploads().length,0);
});
test('replayed import and participant CAS race return 409 and do not overwrite',async()=>{
 const f=fixture(),p=await preview(f);await commit(f,p);const count=f.uploads().length;
 await assert.rejects(commit(f,p),e=>e.code==='version_conflict');assert.equal(f.uploads().length,count);
 const p2=await f.service.preview(ID,{version:1,source:SOURCE},ACTOR);const write=f.store.writeParticipants.bind(f.store);
 f.store.writeParticipants=async(id,doc,rev)=>{f.fake.touch(sessionPath(ID,'participants.json'),d=>{d.version++;d.people[0].ops.notice='sent';});return write(id,doc,rev);};
 await assert.rejects(commit(f,p2),e=>e.code==='version_conflict');assert.equal(f.fake.json(sessionPath(ID,'participants.json')).people[0].ops.notice,'sent');
});
test('missing config, changed headers, empty sheet and unsafe inputs fail closed without writes',async()=>{
 const f=fixture();for(const env of [{...ENV,SESSION_PARTICIPANT_HMAC_KEY:''},{...ENV,SESSION_GOOGLE_SERVICE_ACCOUNT_JSON:''},{...ENV,SESSION_PARTICIPANTS_SYNC:'off'}]){
  const service=createParticipantImportService(f.store,{env,readRows:f.readRows});await assert.rejects(service.preview(ID,{version:0,source:SOURCE},ACTOR),e=>e.code==='participants_import_not_ready');
 }
 f.setRows([['Synthetic Person in a bad header'],row(1)]);await assert.rejects(preview(f),e=>e.code==='header_changed'&&!JSON.stringify(e).includes('Synthetic Person'));
 f.setRows([HEADERS]);await assert.rejects(preview(f),e=>e.code==='empty_import');
 for(const input of [{version:-1,source:SOURCE},{version:0,source:SOURCE,rows:[row(1)]},{version:0,source:{...SOURCE,profile:'unknown'}},{version:0,source:{...SOURCE,sheetRange:'A:J'}},{version:0,source:{...SOURCE,sheetRange:"'Responses'!A1:Z999999"}}]) await assert.rejects(f.service.preview(ID,input,ACTOR));
 await assert.rejects(f.service.preview(ID,{version:0,source:SOURCE},{kind:'mcp',id:'test'}),e=>e.code==='operator_required');assert.equal(f.uploads().length,0);
});
test('readback mismatch and lost write replies never report success or retry',async()=>{
 const f=fixture(),p=await preview(f);const write=f.store.writeParticipants.bind(f.store);f.store.writeParticipants=async(...args)=>{await write(...args);f.fake.touch(sessionPath(ID,'participants.json'),d=>d.version++);};
 await assert.rejects(commit(f,p),e=>e.code==='write_unverified');assert.equal(f.uploads().length,1);
 const g=fixture(),q=await preview(g);const write2=g.store.writeParticipants.bind(g.store);g.store.writeParticipants=async(...args)=>{await write2(...args);throw new SessionError(502,'dropbox_network_failed');};
 await assert.rejects(commit(g,q),e=>e.code==='dropbox_network_failed');assert.equal(g.uploads().length,1);
});
test('ordinary MCP participant reads return summary only and still expose exactly eight tools',async()=>{
 const f=fixture();await commit(f,await preview(f));const service=createSessionService(f.store,{env:ENV,readRows:f.readRows});
 const r=await callSessionTool('getSessionParticipants',{id:ID},{env:ENV,service,actor:{kind:'mcp',id:'fixture'}});
 assert.equal(SESSION_TOOLS.length,8);assert.equal(r.body.participants.summary.total,18);assert.deepEqual(r.body.participants.people,[]);
 assert(!JSON.stringify(r).includes('Synthetic Person'));assert(!JSON.stringify(r).includes('fixture1'));assert(!JSON.stringify(r).includes('Synthetic question'));
});
test('private REST readiness/preview/commit routes keep authentication and only return counts',async()=>{
 const f=fixture(),service=createSessionService(f.store,{env:ENV,readRows:f.readRows});
 async function route(name,body,auth=true){let status,out;const req={method:['participants-import-status','participants'].includes(name)?'GET':'POST',headers:auth?{'x-session-director-token':ENV.SESSION_WEB_SECRET,'x-session-actor':signActorToken({email:ACTOR.id,secret:ENV.SESSION_WEB_SECRET})}:{},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};const res={writeHead:s=>status=s,end:b=>out=JSON.parse(b),setHeader(){}};await handleSessionDirectorRequest(req,res,new URL('https://fixture/api/session-director/'+name+'?id='+ID),{env:ENV,service});return {status,out};}
 for(const name of ['participants-import-status','participants-import-preview','participants-import']) assert.equal((await route(name,{},false)).status,401);
 const status=await route('participants-import-status',{});assert.equal(status.out.readiness.hmacKeyReady,true);assert(!JSON.stringify(status).includes(ENV.SESSION_PARTICIPANT_HMAC_KEY));
 const p=await route('participants-import-preview',{version:0,source:SOURCE});assert.equal(p.status,200);assert.equal(f.uploads().length,0);
 assert.equal((await route('participants-sync',{version:0})).status,400,'old sync cannot bypass preview');
 const c=await route('participants-import',{version:0,source:SOURCE,previewToken:p.out.preview.previewToken});assert.equal(c.status,200);assert.equal(c.out.verified,true);assert(!JSON.stringify(c).includes('Synthetic Person'));
 const view=await route('participants',{});assert.equal(view.out.participants.summary.total,18);assert.deepEqual(view.out.participants.people,[]);assert(!JSON.stringify(view).includes('Synthetic Person'));
});

test('historical profile refuses even otherwise valid standard headers and excessive rows',async()=>{
 const f=fixture();f.setRows([FORM_HEADERS,['2026-01-01','Synthetic','01070000001','fixture','fixture@example.test','why','question','동의합니다']]);
 await assert.rejects(preview(f),e=>e.code==='header_changed');
 f.setRows([HEADERS,...Array.from({length:10001},()=>row(1))]);await assert.rejects(preview(f),e=>e.code==='invalid_sheet_rows');
});
test('changed HMAC identity cannot silently duplicate existing imported applicants',async()=>{
 const f=fixture();await commit(f,await preview(f));
 const rotated=createParticipantImportService(f.store,{env:{...ENV,SESSION_PARTICIPANT_HMAC_KEY:'different-fixture-key-01234567890123456789'},readRows:f.readRows});
 await assert.rejects(rotated.preview(ID,{version:1,source:SOURCE},ACTOR),e=>e.code==='import_key_changed');assert.equal(f.uploads().length,1);
});
