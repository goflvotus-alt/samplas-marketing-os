import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProposal, normalizeAnswer, planLayoutOperations, proposeFromDocx, readDocxParagraphs, verifyAgainstDocx } from "../scripts/session-docx-import.mjs";
import { applyOperations, createSessionDocument } from "../scripts/session-store.mjs";

// Minimal DOCX in the guest-answer layout: cue part, then numbered sent questions with answers. All text is fictional.
const para = (text, numbered = false) => `<w:p>${numbered ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ""}<w:r>${
  text.split("\n").map((part, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${part.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t>`).join("")}</w:r></w:p>`;
const BODY = [
  para("SAMPLAS SESSION 00X"), para("OPENING / 10:00–10:10"), para("게스트 소개"),
  para("01. WEAR / 10:10–10:30"), para("- Q1 / 5분"), para("MC가 읽는 Q1?"), para("→ 꼬리 질문 메모"),
  para("- Q2 / 7분"), para("MC가 읽는 Q2?"),
  para("11:35–11:50 / OPEN TALK"), para("참가자와 이야기"),
  para("CLOSING / 11:50–12:00"), para("LAST QUESTION"), para("마지막 가상 질문?"),
  para("사전 전달 질문"), para("아래 질문을 전달합니다."),
  para("게스트에게 보낸 Q1?\n가상 답변 첫 줄떄 & 기호 <확인>.", true), para("두 번째 줄 "), para(""),
  para("게스트에게 보낸 Q2?", true), para("가상 답변 둘입니다."), para(""),
  para("LAST. 마지막 가상 질문을 길게 보낸 문장?"), para("       가상 마지막 답변!\n둘째 줄.")
].join("");

async function makeDocx(body = BODY) {
  const dir = await mkdtemp(join(tmpdir(), "session-docx-"));
  await mkdir(join(dir, "word"));
  await writeFile(join(dir, "word", "document.xml"), `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  execFileSync("zip", ["-q", "-r", "answers.docx", "word"], { cwd: dir });
  return join(dir, "answers.docx");
}

test("proposal: sections with times, MC and sent wording kept apart, answers verbatim with boundary notes", async () => {
  const proposal = proposeFromDocx(await makeDocx());
  assert.equal(proposal.status, "PROPOSAL_UNREVIEWED");
  assert.deepEqual(proposal.sections.map((s) => [s.key, s.start, s.end]), [["OPENING", "10:00", "10:10"], ["WEAR", "10:10", "10:30"], ["OPEN_TALK", "11:35", "11:50"], ["CLOSING", "11:50", "12:00"]]);
  const [q1, q2, last] = proposal.questions;
  assert.deepEqual([q1.code, q1.sectionKey, q1.durationMin, q1.askText, q1.sentText, q1.cueNotes], ["Q1", "WEAR", 5, "MC가 읽는 Q1?", "게스트에게 보낸 Q1?", ["→ 꼬리 질문 메모"]]);
  assert.equal(q1.answer.text, "가상 답변 첫 줄떄 & 기호 <확인>.\n두 번째 줄", "typos and symbols kept; only block ends trimmed");
  assert.match(q1.answer.boundaryNotes[0], /inside the question paragraph/);
  assert.deepEqual([q2.answer.text, q2.answer.boundaryNotes], ["가상 답변 둘입니다.", []]);
  assert.deepEqual([last.code, last.sectionKey, last.askText, last.sentText, last.answer.text], ["LAST", "CLOSING", "마지막 가상 질문?", "마지막 가상 질문을 길게 보낸 문장?", "가상 마지막 답변!\n둘째 줄."]);
  assert.equal(last.sentDiffersFromAsk, true);
  assert.deepEqual(proposal.warnings, ["LAST: no planned minutes in the cue sheet"]);
  assert.equal(normalizeAnswer(" a\r\nb \n"), "a\nb");
});

test("verify: MATCH for a faithful proposal or imported session; any changed character is a MISMATCH", async () => {
  const docx = await makeDocx();
  const proposal = proposeFromDocx(docx);
  assert.equal(verifyAgainstDocx(docx, proposal).ok, true);

  // Imported through the real operation into a session document (rev 1 originals).
  let doc = createSessionDocument({ number: 1, title: "T", isTest: true });
  const actor = { kind: "web", id: "op@samplas.test", approver: false };
  const ops = proposal.questions.map((q) => ({ type: "add_question", sectionId: doc.sections[1].id, question: { code: q.code, askText: q.askText, sentText: q.sentText } }));
  doc = applyOperations(doc, ops, { actor }).doc;
  doc = applyOperations(doc, doc.questions.map((q) => ({ type: "import_guest_answer", questionId: q.id,
    text: proposal.questions.find((p) => p.code === q.code).answer.text, source: { file: "answers.docx", sha256: proposal.source.sha256 } })), { actor }).doc;
  const report = verifyAgainstDocx(docx, doc);
  assert.deepEqual(report.results.map((r) => [r.code, r.status, r.sourceFileMatches]), [["Q1", "MATCH", true], ["Q2", "MATCH", true], ["LAST", "MATCH", true]]);

  const tampered = structuredClone(proposal);
  tampered.questions[1].answer.text = "가상 답변 둘입니다";
  delete tampered.questions[2].answer;
  const bad = verifyAgainstDocx(docx, tampered);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.results.map((r) => r.status), ["MATCH", "MISMATCH", "MISSING"]);
});

test("a document without the answer heading is refused", async () => {
  const docx = await makeDocx(para("OPENING / 10:00–10:10"));
  assert.throws(() => buildProposal(readDocxParagraphs(docx)), /사전 전달 질문/);
});

test("a session-specific layout plans sections, questions and minutes without touching the template; answers verify", async () => {
  const docx = await makeDocx();
  const proposal = proposeFromDocx(docx);
  const layout = { sections: [
    { key: "OPENING", title: "OPENING", start: "10:00", end: "10:10", questions: [] }, { key: "WEAR", title: "WEAR", start: "10:10", end: "10:30", questions: ["Q1", "Q2"] },
    { key: "MAKE", title: "MAKE", start: "10:30", end: "11:00", questions: [] }, { key: "BREAK", title: "BREAK", start: "11:00", end: "11:10", questions: [] },
    { key: "PEOPLE", title: "PEOPLE", start: "11:10", end: "11:35", questions: [] }, { key: "OPEN_TALK", title: "OPEN TALK", start: "11:35", end: "11:50", questions: [] },
    { key: "CLOSING", title: "CLOSING", start: "11:50", end: "12:00", questions: ["LAST"] }], durationOverrides: { LAST: 5 } };
  const actor = { kind: "web", id: "op@samplas.test", approver: false };
  let doc = createSessionDocument({ number: 1, title: "T", isTest: true });
  const template = createSessionDocument({ number: 9, title: "other" });
  const plan = planLayoutOperations(doc, proposal, layout);
  assert.deepEqual(plan.warnings, []);
  doc = applyOperations(doc, plan.operations, { actor }).doc;
  doc = applyOperations(doc, plan.answerOperations(doc), { actor }).doc;
  const byCode = Object.fromEntries(doc.questions.map((q) => [q.code, q]));
  assert.deepEqual(doc.sections.map((s) => s.key), ["OPENING", "WEAR", "MAKE", "BREAK", "PEOPLE", "OPEN_TALK", "CLOSING"]);
  assert.deepEqual([byCode.Q1.durationMin, byCode.Q2.durationMin, byCode.LAST.durationMin], [5, 7, 5]);
  assert.equal(doc.sections.find((s) => s.id === byCode.LAST.sectionId).key, "CLOSING");
  assert.equal(verifyAgainstDocx(docx, doc).ok, true);
  assert.equal(template.sections[1].key, "PART_1", "the default template is unchanged for other sessions");
  assert.throws(() => planLayoutOperations(createSessionDocument({ number: 2, title: "x", isTest: true }), proposal, { ...layout, sections: layout.sections.map((s) => ({ ...s, questions: s.key === "WEAR" ? ["Q1"] : s.questions })) }), /disagree/);
});

test("the fictional example layout plans cleanly onto a new session", async () => {
  const layout = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../scripts/session-layouts/example.json", import.meta.url), "utf8"));
  const proposal = { sections: [], source: { file: "example.docx", sha256: "0".repeat(64) },
    questions: ["Q1", "Q2", "Q3", "LAST"].map((code) => ({ code, askText: `가상 ${code}?`, sentText: `보낸 가상 ${code}?`, durationMin: code === "LAST" ? null : 5 })) };
  const plan = planLayoutOperations(createSessionDocument({ number: 1, title: "T", isTest: true }), proposal, layout);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.operations.filter((o) => o.type === "add_question").map((o) => [o.question.code, o.question.durationMin]), [["Q1", 5], ["Q2", 5], ["Q3", 5], ["LAST", 5]]);
});
