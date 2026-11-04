import test from "node:test";
import assert from "node:assert/strict";
import { emptyReport, assertReport, seedReportFromNotes, reportTotal, applyReportOperations } from "../scripts/session-report.mjs";
const actor={id:"tester@example.test"};
const apply=(doc,ops)=>applyReportOperations(doc,ops,{actor,at:"2026-11-04T07:00:00.000Z",snapshot:{participants:{total:4,checkedIn:3},feedback:{count:2}}});
test("001, 002, 003, 004, and future SESSIONs all receive independent reports",()=>{
 for(const n of [1,2,3,4,50]){
  const id="session-"+String(n).padStart(3,"0"),r=emptyReport(id);
  assert.equal(r.sessionId,id);assert.equal(r.version,0);assert.equal(reportTotal(r),0);
  const next=apply(r,[{type:"add_expense",expense:{name:"인쇄",amount:n*100}}]);
  assert.equal(next.sessionId,id);assert.equal(reportTotal(next),n*100);
  assert.equal(r.expenses.length,0);
 }
});
test("legacy notes are imported from title once without old body totals",()=>{
 const notes=[
 {id:"fdbe5849-a0ff-48ba-b50f-f29f7dcd91f5",title:"SESSION 002 비용 기록 | 팜플렛 출력 7,200원",date:"2026-11-01",body:"기존 72,000원은 오기"},
 {id:"0e13ebd4-167c-44f7-8981-c404fcbb46f9",title:"SESSION 002 비용 기록 | 큐시트 출력 10,000원",date:"2026-11-01"},
 {id:"56e1de6f-e5c9-4985-aea1-6be45b69b68f",title:"SESSION 002 비용 기록 | 관계자 발렛비 62,000원",date:"2026-11-01"}];
 const r=seedReportFromNotes("session-002",notes);
 assert.equal(r.expenses.length,3);assert.equal(reportTotal(r),79200);
 assert.equal(r.expenses[0].amount,7200);
 assert.equal(r.version,0);
});
test("add, edit, delete, evaluation, finalize and reopen are versioned and immutable",()=>{
 let r=emptyReport("session-003");
 r=apply(r,[{type:"add_expense",expense:{name:"간식",amount:5000}}]);
 assert.equal(r.version,1);
 const id=r.expenses[0].id;
 r=apply(r,[{type:"update_expense",expenseId:id,patch:{amount:8000}},{type:"set_evaluation",patch:{summary:"완료"}}]);
 assert.equal(reportTotal(r),8000);assert.equal(r.evaluation.summary,"완료");
 r=apply(r,[{type:"finalize"}]);
 assert.ok(r.finalizedAt);assert.equal(r.snapshot.expensesTotal,8000);
 assert.throws(()=>apply(r,[{type:"delete_expense",expenseId:id}]),/Reopen/);
 r=apply(r,[{type:"reopen"},{type:"delete_expense",expenseId:id}]);
 assert.equal(reportTotal(r),0);assert.equal(r.finalizedAt,null);
});
test("invalid expense data and report corruptions fail closed",()=>{
 assert.throws(()=>apply(emptyReport("session-004"),[{type:"add_expense",expense:{name:"",amount:500}}]));
 assert.throws(()=>apply(emptyReport("session-004"),[{type:"add_expense",expense:{name:"비용",amount:-1}}]));
 assert.throws(()=>assertReport({}));
});
