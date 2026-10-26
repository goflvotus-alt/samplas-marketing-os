import assert from 'node:assert/strict';
// Synthetic-only integration probe. The argument is connection metadata; no live reads are made.
const base=new URL('../',import.meta.url).href;
const {createParticipantImportService}=await import(base+'scripts/session-participant-import.mjs');
const {emptyParticipants}=await import(base+'scripts/session-participants.mjs');
const {createSessionDropboxStore,sessionPath}=await import(base+'scripts/session-dropbox.mjs');
const {createSessionDocument}=await import(base+'scripts/session-store.mjs');
const {createFakeDropbox}=await import(base+'test/helpers/fake-session-dropbox.mjs');
const {HEADERS,row}=await import(base+'test/fixtures/session002-rows.mjs');
assert(process.argv[2], 'Pass the verified sheet id as a command argument (not credentials or applicant data)');
const id='session-002',sheetId=process.argv[2],actor={kind:'web',id:'fixture@example.test'};
const fake=createFakeDropbox();
fake.files.set(sessionPath(id),{text:JSON.stringify(createSessionDocument({number:2,title:'SYNTHETIC ONLY'},{actor:'fixture'})),rev:'project-fixture'});
const path=sessionPath(id,'participants.json'),doc=emptyParticipants(id);
doc.form={...doc.form,sheetId,sheetRange:"'Form Responses 1'!A:R"};
fake.files.set(path,{text:JSON.stringify(doc),rev:'participants-fixture'});
const store=createSessionDropboxStore({env:{},getToken:fake.getToken,fetchImpl:fake.fetchImpl});
const env={SESSION_PARTICIPANTS_SYNC:'on',SESSION_PARTICIPANT_HMAC_KEY:'fake-hmac-only-012345678901234567890',SESSION_GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'fixture@example.test',private_key:'fake-only'})};
let rows=[HEADERS,...Array.from({length:6},(_,i)=>row(i+1))],reads=0,now=Date.parse('2026-10-26T00:00:00Z');
const service=createParticipantImportService(store,{env,now:()=>now,readRows:async({sheetId:actual,range})=>{assert.equal(actual,sheetId);assert.equal(range,"'Form Responses 1'!A1:R10002");reads++;return structuredClone(rows);}});
const uploads=()=>fake.calls.filter(c=>c.url.endsWith('/files/upload')).length;
assert.equal((await service.autoSync(id)).status,'awaiting_initial_import');assert.equal(reads,0);assert.equal(uploads(),0);
const p=await service.preview(id,{version:0},actor);assert.equal(p.counts.validApplicants,6);assert.equal(uploads(),0);
const out=await service.commit(id,{version:0,previewToken:p.previewToken},actor);assert.equal(out.summary.applied,6);assert.equal(uploads(),1);
fake.touch(path,d=>{d.version++;Object.assign(d.people[0].ops,{status:'confirmed',notice:'sent',memo:'fake memo',checkedInAt:'2026-11-01T04:00:00Z'});});
const ops=fake.json(path).people.map(p=>p.ops),ids=fake.json(path).people.map(p=>p.id);
rows.push(row(7),row(1,{0:'2026-10-21 12:00:00',10:'https://instagram.com/FIXTURE1/',15:'촬영 및 활용 거부'}));now+=60000;
const sync=await service.autoSync(id);assert.equal(sync.status,'synced');assert.equal(sync.intervalSeconds,60);assert.equal(sync.counts.validApplicants,7);assert.equal(sync.counts.duplicateResponses,1);assert.equal(sync.result.added,1);
const saved=fake.json(path);assert.deepEqual(saved.people.slice(0,6).map(p=>p.ops),ops);assert.deepEqual(saved.people.slice(0,6).map(p=>p.id),ids);
assert.equal(saved.people[0].response.additionalResponses[0].recordingConsent,'촬영 및 활용 거부');assert(!JSON.stringify(saved.log).includes('Synthetic Applicant'));assert(!JSON.stringify(sync).includes('fake memo'));
assert.equal((await service.autoSync(id)).status,'unchanged');assert.equal(uploads(),2);
for(const mutate of [d=>{d.form.sheetRange="'Wrong Tab'!A:R";},d=>{d.form.sheetId='changed_fixture_sheet_01234567890';}]){
 const old=structuredClone(fake.files.get(path));fake.touch(path,mutate);const before=structuredClone([...fake.files]);const n=uploads();assert.equal((await service.autoSync(id)).status,'error');assert.equal(uploads(),n);assert.deepEqual([...fake.files],before);fake.files.set(path,old);
}
rows[0]=[...HEADERS].reverse();const before=structuredClone([...fake.files]);assert.equal((await service.autoSync(id)).status,'error');assert.deepEqual([...fake.files],before);
console.log('PASS: SESSION 002 pinned source, fake Dropbox CAS/readback, approval gate, 6→7 applicants, duplicate, preserved ops/check-in, 60s clock advance, unchanged/no-write, changed sheet/range/header blocked; no network or production writes.');
