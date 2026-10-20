import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOperations, createSessionDocument, cueSheetView, sessionSummary, sessionIdFor, sha256, SessionError
} from "../scripts/session-store.mjs";

const web = { kind: "web", id: "op@samplas.test", approver: false };
const approver = { kind: "web", id: "boss@samplas.test", approver: true };
const mcp = { kind: "mcp", id: "chatgpt:user-1", approver: false };
const SHA = "a".repeat(64);

function seeded() {
  let doc = createSessionDocument({ number: 2, title: "TEST SESSION", guest: { name: "TEST GUEST" }, date: null }, { now: "2026-10-13T00:00:00Z" });
  const wear = doc.sections[1].id;
  doc = applyOperations(doc, [
    { type: "add_question", sectionId: wear, question: { code: "Q1", askText: "가상 질문 하나?", sentText: "게스트에게 보낸 가상 질문 하나?", durationMin: 5 } },
    { type: "add_question", sectionId: wear, question: { code: "Q2", askText: "가상 질문 둘", sentText: "게스트에게 보낸 가상 질문 둘?", durationMin: 7 } },
    { type: "add_question", sectionId: wear, question: { code: "Q3", askText: "가상 질문 셋", sentText: "게스트에게 보낸 가상 질문 셋?", durationMin: 8 } }
  ], { actor: web }).doc;
  return doc;
}
const q = (doc, code) => doc.questions.find((x) => x.code === code);
const rejects = (fn, status, code) => assert.throws(fn, (e) => e instanceof SessionError && e.status === status && (!code || e.code === code));

test("create copies only the template structure; ids and versions are per session", () => {
  const a = createSessionDocument({ number: 2, title: "A" });
  const b = createSessionDocument({ number: 3, title: "B" });
  assert.equal(a.id, "session-002");
  assert.equal(sessionIdFor(12), "session-012");
  assert.equal(createSessionDocument({ number: 1, title: "T", isTest: true }).id, "test-session-001");
  assert.deepEqual([a.version, a.status, a.questions.length, a.date], [1, "PLANNING", 0, null]);
  assert.equal(a.sections.length, 7);
  assert.notEqual(a.sections[0].id, b.sections[0].id);
  rejects(() => createSessionDocument({ number: 4 }), 400);
  rejects(() => createSessionDocument({ number: 4, title: "x", secret: "y" }), 400);
});

test("operations are all-or-nothing, bump the version once and log before/after", () => {
  const doc = seeded();
  const { doc: next, changed } = applyOperations(doc, [
    { type: "update_project", patch: { status: "GUEST_CONFIRMED", theme: "가상 주제" } },
    { type: "update_question_mc", questionId: q(doc, "Q2").id, patch: { summary: "가상 요약 둘", keywords: ["키워드A", "키워드B"], directionNotes: "참가자에게 가상 질문으로 넘긴다" } },
    { type: "update_section", sectionId: doc.sections[1].id, patch: { key: "WEAR", title: "WEAR", start: "10:10", end: "10:30" } }
  ], { actor: mcp });
  assert.equal(next.questions.find((x) => x.code === "Q2").mc.directionNotes, "참가자에게 가상 질문으로 넘긴다");
  assert.equal(next.sections[1].key, "WEAR");
  assert.equal(doc.questions[0].mc.directionNotes, "", "new questions start with an empty direction note");
  assert.equal(next.version, doc.version + 1);
  assert.equal(changed.length, 3);
  assert.deepEqual(next.changes.at(-2).before, { summary: "", keywords: [], directionNotes: "" });
  assert.equal(next.changes.at(-1).actor, "chatgpt:user-1");
  assert.equal(doc.status, "PLANNING", "input document is never mutated");
  // second op fails: nothing from the first op is applied
  rejects(() => applyOperations(doc, [{ type: "update_project", patch: { title: "X" } }, { type: "update_question", questionId: "nope", patch: { askText: "y" } }], { actor: web }), 404);
});

test("no normal edit can reach the guest answer; only import, then approved corrections append revisions", () => {
  let doc = seeded();
  const id = q(doc, "Q1").id;
  rejects(() => applyOperations(doc, [{ type: "update_question", questionId: id, patch: { guestAnswer: "x" } }], { actor: web }), 400);
  rejects(() => applyOperations(doc, [{ type: "update_question_mc", questionId: id, patch: { text: "x" } }], { actor: web }), 400);
  rejects(() => applyOperations(doc, [{ type: "import_guest_answer", questionId: id, text: "원문", source: { file: "a.docx", sha256: SHA } }], { actor: mcp }), 403);
  doc = applyOperations(doc, [{ type: "import_guest_answer", questionId: id, text: "가상 원문떄", source: { file: "answers.docx", sha256: SHA } }], { actor: web }).doc;
  rejects(() => applyOperations(doc, [{ type: "import_guest_answer", questionId: id, text: "다른 원문", source: { file: "a.docx", sha256: SHA } }], { actor: web }), 409, "answer_exists");

  doc = applyOperations(doc, [{ type: "update_question_mc", questionId: id, patch: { summary: "가상 MC 요약" } }], { actor: web }).doc;
  doc = applyOperations(doc, [{ type: "propose_answer_correction", questionId: id, text: "정정된 원문", reason: "guest_correction", evidence: "게스트 메일 10/14" }], { actor: mcp }).doc;
  const proposalId = q(doc, "Q1").guestAnswer.pending[0].id;
  rejects(() => applyOperations(doc, [{ type: "approve_answer_correction", questionId: id, proposalId }], { actor: mcp }), 403);
  rejects(() => applyOperations(doc, [{ type: "approve_answer_correction", questionId: id, proposalId }], { actor: web }), 403, "approver_required");
  doc = applyOperations(doc, [{ type: "approve_answer_correction", questionId: id, proposalId }], { actor: approver }).doc;

  const answer = q(doc, "Q1").guestAnswer;
  assert.deepEqual(answer.revisions.map((r) => [r.rev, r.text, r.reason]), [[1, "가상 원문떄", "import"], [2, "정정된 원문", "guest_correction"]]);
  assert.deepEqual([answer.currentRev, answer.revisions[1].supersedes, answer.revisions[1].approvedBy, answer.pending.length], [2, 1, "boss@samplas.test", 0]);
  assert.equal(answer.revisions[0].textSha256, sha256("가상 원문떄"));
  const view = cueSheetView(doc, { includeAnswers: true }).sections[1].questions[0];
  assert.equal(view.guestAnswer.text, "정정된 원문");
  assert.equal(view.guestAnswer.readOnly, true);
  assert.equal(view.mc.staleAgainstAnswer, true, "MC notes written against rev 1 are flagged");
  assert.equal(cueSheetView(doc).sections[1].questions[0].guestAnswer.text, undefined, "answers are opt-in");

  doc = applyOperations(doc, [{ type: "propose_answer_correction", questionId: id, text: "또 다른", reason: "import_error", evidence: "x" }], { actor: web }).doc;
  doc = applyOperations(doc, [{ type: "reject_answer_correction", questionId: id, proposalId: q(doc, "Q1").guestAnswer.pending[0].id }], { actor: approver }).doc;
  assert.equal(q(doc, "Q1").guestAnswer.rejected.length, 1);
  assert.equal(q(doc, "Q1").guestAnswer.revisions.length, 2);
});

test("reordering moves by id and keeps orders contiguous in both sections", () => {
  let doc = seeded();
  const [wear, make] = [doc.sections[1].id, doc.sections[2].id];
  doc = applyOperations(doc, [{ type: "move_question", questionId: q(doc, "Q3").id, sectionId: wear, beforeQuestionId: q(doc, "Q1").id }], { actor: web }).doc;
  const codes = (sectionId) => doc.questions.filter((x) => x.sectionId === sectionId).sort((a, b) => a.order - b.order).map((x) => `${x.code}:${x.order}`);
  assert.deepEqual(codes(wear), ["Q3:1", "Q1:2", "Q2:3"]);
  doc = applyOperations(doc, [{ type: "move_question", questionId: q(doc, "Q1").id, sectionId: make, beforeQuestionId: null }], { actor: web }).doc;
  assert.deepEqual([codes(wear), codes(make)], [["Q3:1", "Q2:2"], ["Q1:1"]]);
  rejects(() => applyOperations(doc, [{ type: "move_question", questionId: q(doc, "Q2").id, sectionId: make, beforeQuestionId: q(doc, "Q3").id }], { actor: web }), 400);
});

test("live log: web only, same runId twice is a no-op, a different run under that id conflicts", () => {
  let doc = seeded();
  const run = { runId: "run-1", deviceId: "ipad-1", baseVersion: doc.version, startedAt: "2026-10-20T04:00:00Z", endedAt: "2026-10-20T06:00:00Z",
    done: { [q(doc, "Q1").id]: "2026-10-20T04:15:00Z" }, actual: {}, notes: "" };
  rejects(() => applyOperations(doc, [{ type: "save_live_log", run }], { actor: mcp }), 403);
  doc = applyOperations(doc, [{ type: "save_live_log", run }], { actor: web }).doc;
  const again = applyOperations(doc, [{ type: "save_live_log", run }], { actor: web });
  assert.equal(again.unchanged, true);
  assert.equal(again.doc.version, doc.version);
  rejects(() => applyOperations(doc, [{ type: "save_live_log", run: { ...run, notes: "다름" } }], { actor: web }), 409, "live_run_conflict");
  rejects(() => applyOperations(doc, [{ type: "save_live_log", run: { ...run, runId: "run-2", done: { ghost: "2026-10-20T04:15:00Z" } } }], { actor: web }), 400);
});

test("mcp cannot archive; summary counts tasks and answers", () => {
  const doc = seeded();
  rejects(() => applyOperations(doc, [{ type: "update_project", patch: { status: "ARCHIVED" } }], { actor: mcp }), 403);
  const s = sessionSummary(doc);
  assert.deepEqual(s.progress, { tasksDone: 0, tasksTotal: 8, questions: 3, answers: 0 });
  assert.equal(s.guest, "TEST GUEST");
});

test('application links: strict Google destinations, partial merge, no unrelated session changes',()=>{
 const source=seeded(),before=structuredClone(source);
 const links={responderUrl:'https://docs.google.com/forms/d/e/PUBLIC/viewform',editUrl:'https://docs.google.com/forms/d/FORM/edit',sheetUrl:'https://docs.google.com/spreadsheets/d/SHEET/edit'};
 const next=applyOperations(source,[{type:'update_project',patch:{applicationForm:links}}],{actor:mcp}).doc;
 assert.deepEqual(next.applicationForm,links);assert.deepEqual(source,before);
 for(const key of ['questions','tasks','notes','sections','date'])assert.deepEqual(next[key],source[key]);
 const partial=applyOperations(next,[{type:'update_project',patch:{applicationForm:{sheetUrl:''}}}],{actor:mcp}).doc;
 assert.deepEqual(partial.applicationForm,{...links,sheetUrl:''});
 for(const invalid of [{editUrl:'https://evil.test/edit'},{sheetUrl:'https://docs.google.com.evil.test/spreadsheets/d/S/edit'},{responderUrl:'javascript:alert(1)'},{secret:'x'},{sheetUrl:'https://docs.google.com/forms/d/F/edit'}])rejects(()=>applyOperations(next,[{type:'update_project',patch:{applicationForm:invalid}}],{actor:mcp}),400);
});
