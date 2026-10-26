import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetRows, emptyParticipants, mergeSync } from '../scripts/session-participants.mjs';
import { createParticipantImportService } from '../scripts/session-participant-import.mjs';
import { HEADERS, row } from './fixtures/session002-rows.mjs';
const ENV = { SESSION_PARTICIPANT_HMAC_KEY:'synthetic-hmac-012345678901234567890', SESSION_PARTICIPANTS_SYNC:'on',
 SESSION_GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'fixture@example.test',private_key:'fake-only'}) };
const parse = rows => parseSheetRows([HEADERS,...rows],ENV,{sessionId:'session-002'});
const ACTOR={kind:'web',id:'fixture@example.test'};
const SOURCE={sheetId:'synthetic_sheet_002_01234567890',sheetRange:"'Form Responses 1'!A1:R10002",profile:'session-002'};
function fixture(){
 let doc=emptyParticipants('test-session-902'),rev=0,rows=[HEADERS,...Array.from({length:6},(_,i)=>row(i+1))],writes=0,reads=0;
 const store={readParticipants:async()=>({doc:structuredClone(doc),rev:String(rev)}),writeParticipants:async(id,next,expected)=>{assert.equal(expected,String(rev));doc=structuredClone(next);rev++;writes++;}};
 const service=createParticipantImportService(store,{env:ENV,readRows:async()=>{reads++;return structuredClone(rows);}});
 return {service,doc:()=>doc,rows:r=>{rows=r;},writes:()=>writes,reads:()=>reads};
}
const preview=f=>f.service.preview('test-session-902',{version:f.doc().version,source:SOURCE},ACTOR);
const commit=(f,p)=>f.service.commit('test-session-902',{version:p.version,source:SOURCE,previewToken:p.previewToken},ACTOR);
test('002 maps six 18-column responses from I:R with duplicate contact headers and empty B:H',()=>{
 const parsed=parse(Array.from({length:6},(_,i)=>row(i+1)));
 assert.equal(parsed.people.length,6);assert.equal(parsed.skippedInvalid,0);
 const r=parsed.people[0].response;
 assert.equal(r.name,'Synthetic Applicant 1');assert.equal(r.phone,'010-8000-0001');assert.equal(r.instagram,'fixture1');
 for(const consent of ['동의합니다','촬영만 동의, 콘텐츠 활용 거부','동의하지 않습니다','']) {
  const answer=parse([row(1,{15:consent})]).people[0].response;assert.equal(answer.recordingConsent,consent);assert.equal(answer.consent,null);
 }
 assert.equal(r.sourceProfile,'session-002');assert.equal(r.consent,null);assert.equal(r.emailMasked,'');assert.equal(r.motivation,'');
 assert.equal(r.attendanceAvailability,'참석 가능');assert.equal(r.familiarity,'합성 기간');
 assert.equal(r.discussionTopics,'합성 관심 이야기 1');assert.equal(r.otherTopics,'합성 함께 이야기 1');
 assert.equal(r.guestQuestion,'합성 대표 질문 1');assert.equal(r.recordingConsent,'촬영만 동의, 콘텐츠 활용 거부');assert.equal(r.interviewInterest,'인터뷰 미참여');
 assert.equal(parse([row(1,{1:'OLD NAME',2:'01099999999',7:'동의합니다'})]).people[0].response.consent,null);
 assert.equal(parse([row(1,{1:'OLD NAME',2:'01099999999',7:'동의합니다'})]).people[0].response.name,'Synthetic Applicant 1');
});
test('002 reuses normalized phone + Instagram identity and preserves every operating field',()=>{
 const d=emptyParticipants('session-002');mergeSync(d,parse([row(1)]));
 const id=d.people[0].id;Object.assign(d.people[0].ops,{status:'confirmed',notice:'sent',memo:'private synthetic memo',checkedInAt:'2026-11-01T04:00:00Z'});
 const ops=structuredClone(d.people[0].ops);
 const parsed=parse([row(1),row(1,{0:'2026-10-21 12:00:00',9:'+82 10-8000-0001',10:'https://instagram.com/FIXTURE1/',15:'콘텐츠 활용 거부'}),row(2)]);
 assert.equal(parsed.duplicateResponses,1);
 assert.equal(parse([row(1),row(1,{10:'different_fixture'}),row(1,{9:'01080000002'})]).people.length,3);
 assert.deepEqual(mergeSync(d,parsed),{added:1,updated:1,removed:0});
 assert.equal(d.people[0].id,id);assert.deepEqual(d.people[0].ops,ops);assert.equal(d.people[1].ops.status,'applied');
 assert.deepEqual(d.people[0].response.sourceRows,[2,3]);assert.equal(d.people[0].response.additionalResponses[0].recordingConsent,'콘텐츠 활용 거부');
});
test('002 exact headers reject reordered, changed, shortened and extra columns without reflecting their contents',()=>{
 for(const headers of [[...HEADERS].reverse(),HEADERS.slice(0,17),HEADERS.map((h,i)=>i===8?' '+h:h),[...HEADERS,'extra'],HEADERS.map((h,i)=>i===8?'PRIVATE BAD HEADER':h)]){
  assert.throws(()=>parseSheetRows([headers,row(1)],ENV,{sessionId:'session-002'}),e=>e.code==='header_changed'&&!JSON.stringify(e).includes('PRIVATE'));
 }
 assert.throws(()=>parseSheetRows([HEADERS,row(1)],ENV,{sessionId:'session-003'}),e=>e.code==='header_changed');
});
test('002 preview remains read-only; approved synthetic import returns counts and never logs answers',async()=>{
 const f=fixture(),p=await preview(f);assert.equal(f.writes(),0);
 assert.deepEqual(p.counts,{rawResponses:6,validApplicants:6,duplicateResponses:0,excludedResponses:0});
 const out=await commit(f,p);assert.equal(out.verified,true);assert.equal(out.summary.applied,6);assert.equal(f.writes(),1);
 for(const value of [p,out,f.doc().log]){assert(!JSON.stringify(value).includes('Synthetic Applicant'));assert(!JSON.stringify(value).includes('010-8000'));assert(!JSON.stringify(value).includes('합성 대표'));}
});
test('002 changed rows, headers, sheet or range after preview cannot write',async()=>{
 const f=fixture(),p=await preview(f);
 f.rows([HEADERS,row(7)]);await assert.rejects(commit(f,p),e=>e.code==='preview_stale');
 f.rows([[...HEADERS].reverse(),row(1)]);await assert.rejects(commit(f,p),e=>e.code==='header_changed');
 for(const source of [{...SOURCE,sheetId:'different_synthetic_01234567890'},{...SOURCE,sheetRange:"'Form Responses 1'!A:H"},{...SOURCE,sheetRange:"'Wrong Tab'!A:R"}]){
  await assert.rejects(f.service.commit('test-session-902',{version:0,source,previewToken:p.previewToken},ACTOR));
 }
 f.rows([HEADERS,[...row(1),'unexpected column']]);await assert.rejects(preview(f),e=>e.code==='invalid_sheet_rows');
 assert.equal(f.writes(),0);
});
test('002 live connection rejects an unverified sheet and changed range before reading or writing',async()=>{
 const f=fixture();
 for(const source of [SOURCE,{...SOURCE,sheetRange:"'Wrong Tab'!A:R"},{...SOURCE,sheetRange:"'Form Responses 1'!A:H"}]){
  await assert.rejects(f.service.preview('session-002',{version:0,source},ACTOR));
 }
 assert.equal(f.reads(),0);assert.equal(f.writes(),0);
});
