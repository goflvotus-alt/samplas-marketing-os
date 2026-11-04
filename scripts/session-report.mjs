// Versioned, per-SESSION final report: separate from NOTES and participant records.
// A missing report.json is represented by a virtual empty document. The first
// approved write is Dropbox add-only; later writes require the downloaded rev.
import { randomUUID } from 'node:crypto';
import { SessionError } from './session-store.mjs';
const fail = (message) => {throw new SessionError(400,'invalid_report',message)};
const isObj = v => v!==null&&typeof v==='object'&&!Array.isArray(v);
const sentence = (v,max=2000) => typeof v==='string'&&v.length<=max?v:fail('invalid text');
const fields=['summary','achievements','improvements','nextSteps'];
export const emptyReport = id => ({
 schemaVersion:1, sessionId:id, version:0, updatedAt:null,
 expenses:[], evaluation:{summary:'',achievements:'',improvements:'',nextSteps:''},
 finalizedAt:null, snapshot:null, history:[]
});
export function assertReport(r) {
 if(!isObj(r)||r.schemaVersion!==1||typeof r.sessionId!=='string'||!Number.isInteger(r.version)||r.version<0||
    !Array.isArray(r.expenses)||!isObj(r.evaluation)||!Array.isArray(r.history)||
    !(r.finalizedAt===null||typeof r.finalizedAt==='string'))fail('invalid report document');
 for(const e of r.expenses)validateExpense(e);
 return r;
}
function validateExpense(e) {
 if(!isObj(e)||typeof e.id!=='string'||!/^[\w-]{8,100}$/.test(e.id)||
    typeof e.name!=='string'||!e.name.trim()||e.name.length>100||
    !Number.isSafeInteger(e.amount)||e.amount<0||e.amount>1_000_000_000||
    (e.date!==null&&e.date!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(e.date))||
    typeof(e.memo??'')!=='string'||(e.memo??'').length>500)fail('invalid expense');
}
export function seedReportFromNotes(id,notes=[]) {
 const r=emptyReport(id);
 // Legacy amounts are migratable by title, not note bodies containing old totals.
 for(const n of notes){
  const match=String(n.title??'').match(/^SESSION \d+ 비용 기록 \| (.+?)\s+([\d,]+)원$/);
  if(!match)continue;
  const amount=Number(match[2].replaceAll(',',''));
  const e={id:n.id?'legacy-'+n.id:randomUUID(),name:match[1],amount,date:n.date??null,memo:'기존 NOTES 기록에서 이관'};
  validateExpense(e);r.expenses.push(e);
 }
 return r;
}
export function reportTotal(r){return r.expenses.reduce((n,e)=>n+e.amount,0)}
export function applyReportOperations(current,operations,{actor,at=new Date().toISOString(),snapshot=null}={}){
 assertReport(current);
 if(!Array.isArray(operations)||operations.length<1||operations.length>20)fail('operations must have 1-20 items');
 const doc=structuredClone(current);
 const allowed=new Set(['add_expense','update_expense','delete_expense','set_evaluation','finalize','reopen']);
 for(const op of operations){
  if(!isObj(op)||!allowed.has(op.type))fail('unknown report operation');
  if(doc.finalizedAt&&op.type!=='reopen')throw new SessionError(409,'report_finalized','Reopen report before editing');
  if(op.type==='add_expense'){
   if(!isObj(op.expense))fail('missing expense');
   const e={id:randomUUID(),name:sentence(op.expense.name,100).trim(),amount:op.expense.amount,
     date:op.expense.date??null,memo:sentence(op.expense.memo??'',500)};
   validateExpense(e);if(doc.expenses.length>=100)fail('too many expenses');doc.expenses.push(e);
  }else if(op.type==='update_expense'){
   const e=doc.expenses.find(e=>e.id===op.expenseId);
   if(!e||!isObj(op.patch)||!Object.keys(op.patch).length||Object.keys(op.patch).some(k=>!['name','amount','date','memo'].includes(k)))fail('invalid expense edit');
   Object.assign(e,op.patch);validateExpense(e);
  }else if(op.type==='delete_expense'){
   const i=doc.expenses.findIndex(e=>e.id===op.expenseId);
   if(i<0)fail('unknown expense');doc.expenses.splice(i,1);
  }else if(op.type==='set_evaluation'){
   if(!isObj(op.patch)||!Object.keys(op.patch).length||Object.keys(op.patch).some(k=>!fields.includes(k)))fail('invalid evaluation fields');
   for(const [key,value] of Object.entries(op.patch))doc.evaluation[key]=sentence(value);
  }else if(op.type==='finalize'){
   if(doc.finalizedAt)throw new SessionError(409,'report_finalized');
   if(!snapshot||!isObj(snapshot))fail('snapshot unavailable');
   doc.finalizedAt=at;doc.snapshot=structuredClone({...snapshot,expensesTotal:reportTotal(doc),at});
  }else if(op.type==='reopen'){
   if(!doc.finalizedAt)fail('report not finalized');
   doc.finalizedAt=null;doc.snapshot=null;
  }
 }
 doc.version+=1;doc.updatedAt=at;
 doc.history.push({version:doc.version,actor:String(actor?.id??'operator').slice(0,100),at,operations:operations.map(o=>o.type)});
 doc.history=doc.history.slice(-50);
 return assertReport(doc);
}
