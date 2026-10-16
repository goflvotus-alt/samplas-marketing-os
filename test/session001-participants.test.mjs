import test from "node:test";
import assert from "node:assert/strict";
import { parseSheetRows, emptyParticipants, mergeSync, applyParticipantOperations, participantSummary } from "../scripts/session-participants.mjs";

const HEADERS = [
  "타임스탬프",
  "이름 / 닉네임",
  "연락처",
  "인스타 아이디",
  "2026년 9월 6일(일) 13:00–15:00 SESSION에 참석 가능하신가요?",
  "SAMPLAS를 알게 된 지 얼마나 되었나요?",
  "이번 SESSION에서 가장 궁금한 이야기는 무엇인가요?",
  "위 내용 외에도 SESSION에서 꼭 함께 이야기해보고 싶은 것이 있다면 남겨주세요.\n(SAMPLAS, 브랜드, 편집샵 운영, 패션 업계, VEIL 등\n어떤 내용이든 자유롭게 남겨주세요.)",
  "촬영 및 콘텐츠 활용 동의\nSAMPLAS SESSION 001에서는 행사 기록 및 이후 SESSION 관련 콘텐츠 제작을 위해 사진 및 영상 촬영이 진행될 예정입니다.\n촬영된 사진 및 영상에는 참가자의 얼굴, 모습, 음성 등이 포함될 수 있으며, 일부 결과물은 SAMPLAS 공식 Instagram 및 기타 SAMPLAS 관련 콘텐츠에 활용될 수 있습니다.\n아래 내용을 확인해 주세요.\nSESSION 진행 중 사진 및 영상 촬영이 진행될 수 있습니다.촬영된 사진 및 영상은 SESSION 기록 및 SAMPLAS SNS 콘텐츠 제작에 활용될 수 있습니다.콘텐츠는 편집 및 재가공되어 게시될 수 있습니다.촬영 및 콘텐츠 활용이 어려운 경우 SESSION 시작 전 스태프에게 말씀해 주세요.촬영 및 콘텐츠 활용에 동의하시나요?",
  "SESSION 종료 후 인터뷰 안내\nSESSION 종료 후 참가자 중 일부를 대상으로 약 1~2분 정도의 짧은 인터뷰를 진행할 예정입니다.\n인터뷰에서는 SESSION에 대한 간단한 소감과 다음 SESSION에서 듣고 싶은 이야기 등을 질문할 예정이며, 촬영된 인터뷰 영상은 SAMPLAS SESSION 기록 및 추후 SNS 콘텐츠에 활용될 수 있습니다.\n인터뷰 참여 여부는 SESSION 참가 여부와 관계가 없으며, 현장에서 다시 한번 참여 의사를 확인한 후 진행합니다.\n종료 후 인터뷰 참여 의향이 있으신가요?"
];
const ENV = { SESSION_PARTICIPANT_HMAC_KEY: "test-key-0123456789abcdef0123456789" };
const row = (n, patch = {}) => Object.assign(["2026-09-01 13:00:"+String(n).padStart(2,"0"),"Synthetic "+n,"0109000"+String(n).padStart(4,"0"),"@test"+n,"참석 가능합니다","1년","궁금한 이야기 "+n,"추가 질문 "+n,"촬영 동의하지 않음","인터뷰 미참여"],patch);
const parse = rows => parseSheetRows([HEADERS,...rows],ENV,{sessionId:"session-001"});

test("001 exact historical headers map without inventing motivation, email or privacy consent",()=>{
 const p=parse([row(1)]).people[0];
 assert.equal(p.response.name,"Synthetic 1");
 assert.equal(p.response.emailMasked,"");
 assert.equal(p.response.motivation,"");
 assert.equal(p.response.guestQuestion,"궁금한 이야기 1");
 assert.equal(p.response.attendanceAvailability,"참석 가능합니다");
 assert.equal(p.response.familiarity,"1년");
 assert.equal(p.response.otherTopics,"추가 질문 1");
 assert.equal(p.response.recordingConsent,"촬영 동의하지 않음");
 assert.equal(p.response.interviewInterest,"인터뷰 미참여");
 assert.equal(p.response.consent,null);
 assert(!JSON.stringify(p).includes("01090000001"));
});

test("legacy mapping cannot activate for 002 or a changed header",()=>{
 assert.throws(()=>parseSheetRows([HEADERS,row(1)],ENV,{sessionId:"session-002"}),e=>e.code==="header_changed");
 const changed=[...HEADERS];changed[5]="다른 질문";
 assert.throws(()=>parseSheetRows([changed,row(1)],ENV,{sessionId:"session-001"}),e=>e.code==="header_changed");
});

test("same 001 phone and instagram response is not duplicated; every source row remains traceable",()=>{
 const rows=[row(1),row(1,{0:"2026-09-02 13:00:00",6:"재신청 질문 원문"}),row(2)];
 const parsed=parse(rows);
 assert.equal(parsed.people.length,2);
 assert.equal(parsed.duplicateResponses,1);
 assert.deepEqual(parsed.people[0].response.sourceRows,[2,3]);
 assert.equal(parsed.people[0].response.additionalResponses[0].guestQuestion,"재신청 질문 원문");
 const d=emptyParticipants("session-001");
 mergeSync(d,parsed);
 const again=mergeSync(d,parse(rows));
 assert.equal(again.added,0);
 assert.equal(d.people.length,2);
});

test("resync of 18 applications preserves all operating states and check-in; availability does not confirm attendance",()=>{
 const rows=Array.from({length:18},(_,i)=>row(i+1));let d=emptyParticipants("session-001");
 mergeSync(d,parse(rows));
 assert.equal(participantSummary(d).applied,18);
 const ids=d.people.map(p=>p.id),actor={id:"test-operator"};
 d=applyParticipantOperations(d,[{type:"update_participant",participantId:ids[0],patch:{status:"confirmed",notice:"sent",memo:"operator note"}},{type:"update_participant",participantId:ids[1],patch:{status:"waitlisted"}},{type:"update_participant",participantId:ids[2],patch:{status:"cancelled"}}],{actor});
 d=applyParticipantOperations(d,[{type:"check_in",participantId:ids[0]}],{actor,now:"2026-09-06T04:00:00.000Z"});
 const before=structuredClone(d.people.map(p=>p.ops));
 const result=mergeSync(d,parse([row(1,{0:"2026-09-03 13:00:00"}),...rows.slice(1)].reverse()));
 assert.equal(result.added,0);
 assert.deepEqual(d.people.map(p=>p.ops),before);
 assert.deepEqual(d.people.map(p=>p.id),ids);
 assert.equal(participantSummary(d).checkedIn,1);
 assert.throws(()=>applyParticipantOperations(d,[{type:"check_in",participantId:ids[0]}],{actor}),e=>e.code==="already_checked_in");
 assert.throws(()=>applyParticipantOperations(d,[{type:"check_in",participantId:ids[1]}],{actor}),e=>e.code==="not_confirmed");
});


import { createSessionService, handleSessionDirectorRequest } from "../scripts/session-director-api.mjs";

test("001 service uses existing sheet reader, preserves versioned operations, and never touches 002 or project documents",async()=>{
 const docs=new Map([['session-001',emptyParticipants('session-001')],['session-002',emptyParticipants('session-002')]]);
 const writes=[],before002=JSON.stringify(docs.get('session-002'));let revision=0,readCount=0;
 const store={
  async readParticipants(id){return {doc:structuredClone(docs.get(id)),rev:String(revision)};},
  async writeParticipants(id,doc,rev){assert.equal(rev,String(revision));revision++;docs.set(id,structuredClone(doc));writes.push(id);},
  async read(){throw Error('project document must not be read or changed');}
 };
 const env={...ENV,SESSION_PARTICIPANTS_SYNC:'on',SESSION_GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'test@example.test',private_key:'synthetic-only'})};
 const service=createSessionService(store,{env,readRows:async({sheetId,range})=>{assert.equal(sheetId,'synthetic_sheet_id_0123456789');assert.equal(range,"'Responses'!A:J");readCount++;return [HEADERS,...Array.from({length:18},(_,i)=>row(i+1))];}});
 const actor={id:'test-operator'};
 await service.updateParticipants('session-001',0,[{type:'set_participant_form',form:{sheetId:'synthetic_sheet_id_0123456789',sheetRange:"'Responses'!A:J",linkVisible:false}}],actor);
 let result=await service.syncParticipants('session-001',1,actor);assert.equal(result.result.added,18);
 const id=result.people[0].id;
 await service.updateParticipants('session-001',2,[{type:'update_participant',participantId:id,patch:{status:'confirmed'}},{type:'check_in',participantId:id}],actor);
 await assert.rejects(service.syncParticipants('session-001',2,actor),e=>e.code==='version_conflict');
 result=await service.syncParticipants('session-001',3,actor);
 assert.equal(result.result.added,0);assert.equal(result.summary.checkedIn,1);assert.equal(result.summary.confirmed,1);
 assert.equal(readCount,2);assert(writes.every(id=>id==='session-001'));assert.equal(JSON.stringify(docs.get('session-002')),before002);
 assert(!JSON.stringify(docs.get('session-001')).includes('01090000001'));
});

test("unauthenticated participant writes fail before the service is called",async()=>{
 for(const route of ['participants','participants-sync']){
  let status,body,calls=0;
  const req={method:route==='participants'?'PUT':'POST',headers:{}};
  const res={writeHead(s){status=s;},end(t){body=JSON.parse(t);}};
  await handleSessionDirectorRequest(req,res,new URL('http://local/api/session-director/'+route+'?id=session-001'),{env:{SESSION_WEB_SECRET:'test-only',SESSION_OPERATOR_EMAILS:'op@example.test'},service:new Proxy({},{get(){calls++;throw Error('must not reach service');}})});
  assert.equal(status,401);assert.equal(calls,0);assert.equal(body.ok,false);
 }
});
