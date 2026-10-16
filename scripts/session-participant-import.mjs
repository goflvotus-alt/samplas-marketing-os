// Private operator import. Raw Sheets rows live only in server memory; public responses are counts.
// Reuses the SESSION reader, historical parser, mergeSync and participants.json CAS. No new storage.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { SessionError, SESSION_ID_PATTERN } from './session-store.mjs';
import { hmacKeyReady, parseSheetRows, mergeSync, participantSummary, FORM_HEADERS, SESSION001_HEADERS } from './session-participants.mjs';
import { readSheetRows, sheetsConfigured } from './session-sheets.mjs';

// SESSION 001's response sheet is pinned by the server. Its id is configuration (SESSION001_SHEET_ID), never source:
// this repository is public and the sheet holds applications. Without it, 001 imports stop before any read.
export const SESSION001_RANGE="'설문지 응답 시트1'!A1:J10002";
export function session001Source(env){
 const sheetId=String(env.SESSION001_SHEET_ID??'').trim();
 if(!/^[\w-]{20,100}$/.test(sheetId))fail(503,'session001_sheet_not_configured');
 return {sheetId,sheetRange:SESSION001_RANGE,profile:'session-001'};
}
const TTL=10*60*1000;
const fail=(status,code)=>{throw new SessionError(status,code,code);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
const mac=(env,purpose,value)=>createHmac('sha256',env.SESSION_PARTICIPANT_HMAC_KEY).update('session-import:v1:'+purpose+':'+value).digest('base64url');
const seal=(env,claims)=>{const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');return payload+'.'+mac(env,'preview',payload);};
const summary=doc=>{const {syncError,...counts}=participantSummary(doc);return counts;};
const validateActor=actor=>{if(actor?.kind!=='web'||typeof actor.id!=='string'||!actor.id)fail(403,'operator_required');};
function canonicalRange(value) {
 const match=typeof value==='string'&&value.match(/^(?:'([^'\r\n]{1,80})'|([^'!\r\n]{1,80}))!A(?:1)?:(H|J)(?:10002)?$/);
 if(!match)fail(400,'invalid_import_source');
 return "'"+(match[1]||match[2])+"'!A1:"+match[3]+'10002';
}
function sourceFor(env,id,doc,input){
 if(!SESSION_ID_PATTERN.test(String(id)))fail(400,'invalid_session_id');
 let source=input;
 const pinned=id==='session-001'?session001Source(env):null;
 if(source===undefined)source=pinned||{sheetId:doc.form.sheetId,sheetRange:doc.form.sheetRange,profile:'standard'};
 if(!object(source)||Object.keys(source).some(k=>!['sheetId','sheetRange','profile'].includes(k)))fail(400,'invalid_import_source');
 const {sheetId,profile='standard'}=source;
 const sheetRange=canonicalRange(source.sheetRange);
 // Bounded, complete A1 read plus a sentinel row: never silently truncate a response sheet.
 if(typeof sheetId!=='string'||!/^[\w-]{20,100}$/.test(sheetId)||typeof sheetRange!=='string'||!/^'[^'\r\n]{1,80}'!A1:(H|J)10002$/.test(sheetRange)||!['standard','session-001'].includes(profile))fail(400,'invalid_import_source');
 if(profile==='session-001'&&!sheetRange.endsWith('!A1:J10002'))fail(400,'invalid_import_source');
 if(profile==='standard'&&!sheetRange.endsWith('!A1:H10002'))fail(400,'invalid_import_source');
 const normalized={sheetId,sheetRange,profile};
 if(pinned&&!isDeepStrictEqual(normalized,pinned))fail(403,'import_source_not_allowed');
 if(!id.startsWith('test-')&&id!=='session-001'&&(profile!=='standard'||sheetId!==doc.form.sheetId||(doc.form.sheetRange&&doc.form.sheetRange.includes('!')&&sheetRange!==canonicalRange(doc.form.sheetRange))))fail(403,'import_source_not_allowed');
 if(doc.form.sheetId&&doc.form.sheetId!==sheetId)fail(409,'import_source_changed');
 return normalized;
}
function validateInput(input,commit){
 if(!object(input)||Object.keys(input).some(k=>!['version','source',...(commit?['previewToken']:[])].includes(k))||!Number.isSafeInteger(input.version)||input.version<0)fail(400,'invalid_import_request');
 if(commit&&(typeof input.previewToken!=='string'||input.previewToken.length>4096))fail(400,'invalid_preview');
}
function open(env,token){
 const [payload,signature,extra]=token.split('.');
 if(!payload||!signature||extra!==undefined||!equal(signature,mac(env,'preview',payload)))fail(409,'invalid_preview');
 try {const c=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(!object(c))fail(409,'invalid_preview');return c;}
 catch {fail(409,'invalid_preview');}
}
export function createParticipantImportService(store,{env=process.env,fetchImpl=fetch,readRows=readSheetRows,now=Date.now}={}){
 const readiness=()=>({hmacKeyReady:hmacKeyReady(env),sheetsConfigured:sheetsConfigured(env),syncEnabled:env.SESSION_PARTICIPANTS_SYNC==='on'});
 function guard(actor){validateActor(actor);if(!Object.values(readiness()).every(Boolean))fail(503,'participants_import_not_ready');}
 async function current(id,version){const found=await store.readParticipants(id);if(found.doc.version!==version)throw new SessionError(409,'version_conflict','participants changed since preview',{currentVersion:found.doc.version});return found;}
 async function parsedRows(source){
  let rows;
  try {rows=await readRows({env,sheetId:source.sheetId,range:source.sheetRange,fetchImpl});}
  catch(e){const allowed=['sheets_auth_failed','sheets_network_failed','sheet_not_found','sheets_failed'];fail(e instanceof SessionError&&e.status===404?404:502,allowed.includes(e?.code)?e.code:'sheets_failed');}
  if(!Array.isArray(rows)||rows.length>10001||rows.some(r=>!Array.isArray(r)||r.length>10||r.some(c=>!['string','number','boolean'].includes(typeof c)&&c!==null)))fail(409,'invalid_sheet_rows');
  // Refuse empty input rather than marking every stored applicant removed.
  const rawResponses=rows.slice(1).filter(r=>r.some(c=>String(c??'').trim())).length;
  if(!rawResponses)fail(409,'empty_import');
  const headers=source.profile==='session-001'?SESSION001_HEADERS:FORM_HEADERS;
  const actual=rows[0]?.map(c=>String(c??'').trim());
  if(!actual||actual.length!==headers.length||new Set(actual).size!==actual.length||!headers.every(h=>actual.includes(h)))fail(409,'header_changed');
  let parsed;
  try {parsed=parseSheetRows(rows,env,{sessionId:source.profile==='session-001'?'session-001':undefined});}
  catch(e){fail(e instanceof SessionError?e.status:400,e?.code==='header_changed'?'header_changed':'invalid_sheet_rows');}
  const unique=new Set(parsed.people.map(p=>p.responseKey)).size;
  if(!unique)fail(409,'empty_import');
  const excludedResponses=parsed.skippedInvalid+parsed.skippedNoConsent;
  return {parsed,digest:mac(env,'rows',JSON.stringify(rows)),counts:{rawResponses,validApplicants:unique,duplicateResponses:rawResponses-excludedResponses-unique,excludedResponses}};
 }
 function keyGuard(doc,parsed){
  const keyId=mac(env,'key-id','participants');
  if(doc.sync.importKeyId&&doc.sync.importKeyId!==keyId)fail(409,'import_key_changed');
  if(doc.people.length&&!doc.sync.importKeyId&&!parsed.people.some(p=>doc.people.some(old=>old.responseKey===p.responseKey)))fail(409,'import_identity_mismatch');
  return keyId;
 }
 return {
  readiness,
  async preview(id,input,actor){
   guard(actor);validateInput(input,false);const {doc,rev}=await current(id,input.version);const source=sourceFor(env,id,doc,input.source);
   const {parsed,digest,counts}=await parsedRows(source);keyGuard(doc,parsed);
   const iat=now(),exp=iat+TTL;
   const previewToken=seal(env,{id,actor:actor.id,version:doc.version,rev,source,digest,iat,exp});
   return {sessionId:id,version:doc.version,capacity:doc.capacity,counts,previewToken,expiresAt:new Date(exp).toISOString()};
  },
  async commit(id,input,actor){
   guard(actor);validateInput(input,true);const claims=open(env,input.previewToken);
   if(!Number.isFinite(claims.exp)||!Number.isFinite(claims.iat)||claims.exp-claims.iat!==TTL||claims.iat>now()||claims.exp<=now())fail(409,'preview_expired');
   if(claims.id!==id||claims.actor!==actor.id||claims.version!==input.version)fail(409,'invalid_preview');
   const {doc,rev}=await current(id,input.version);const source=sourceFor(env,id,doc,input.source);
   if(!isDeepStrictEqual(claims.source,source))fail(409,'invalid_preview');
   if(claims.rev!==rev)fail(409,'preview_stale');
   const {parsed,digest,counts}=await parsedRows(source);const keyId=keyGuard(doc,parsed);
   if(!equal(claims.digest,digest))fail(409,'preview_stale');
   const next=structuredClone(doc),at=new Date(now()).toISOString();
   const result=mergeSync(next,parsed,{now:at}); // Keeps ops, including confirmations, notices and check-ins.
   next.form={...next.form,sheetId:source.sheetId,sheetRange:source.sheetRange};
   next.sync.importKeyId=keyId;next.version++;next.updatedAt=at;
   next.log=[...next.log,{v:next.version,at,actor:actor.id,op:'import_participants',participantId:null,...result}].slice(-500);
   await store.writeParticipants(id,next,rev); // Dropbox CAS; deliberately never retried.
   const saved=(await store.readParticipants(id)).doc;
   if(!isDeepStrictEqual(saved,next))throw new SessionError(502,'write_unverified','participants readback did not match',{currentVersion:saved.version});
   return {sessionId:id,version:saved.version,verified:true,counts,result,summary:summary(saved)};
  }
 };
}
