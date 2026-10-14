// SAMPLAS SESSION DIRECTOR: guest answer DOCX -> import proposal, and verification (read only).
//   node scripts/session-docx-import.mjs propose <answers.docx> [--out proposal.json]
//   node scripts/session-docx-import.mjs verify  <answers.docx> <proposal.json|session.json>
// "propose" writes a local JSON proposal for a person to check; it never imports anything.
// "verify" re-extracts every answer from the DOCX and compares sha256 per question (exit 1 on any
// mismatch). Answers keep the guest's exact wording; the only normalisation is CRLF -> LF and
// trimming the ends of each answer block.
//
// Document layout (guest answer DOCX, checked 2026-10-13):
//   cue part      section headers "01. WEAR / 10:10–10:30" (or "11:35–11:50 / OPEN TALK"),
//                 "- Q1 / 5분" then the MC question paragraph, then cue notes; "LAST QUESTION".
//   answer part   after "사전 전달 질문": one numbered paragraph per question (the text sent to
//                 the guest) followed by the answer paragraphs; finally "LAST. <question>" + answer.
//                 Q1's answer starts inside the question paragraph after a line break.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
export const normalizeAnswer = (text) => String(text).replace(/\r\n?/g, "\n").trim();

// Paragraphs of word/document.xml in order: { text, numbered } (tabs and line breaks kept).
export function readDocxParagraphs(file) {
  const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { maxBuffer: 50_000_000 }).toString("utf8");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || []).map((p) => ({
    numbered: p.includes("<w:numPr>"),
    text: [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\/>/g)].map((m) => (m[1] !== undefined ? decode(m[1]) : m[2] === "tab" ? "\t" : "\n")).join("")
  }));
}

const SECTION = /^(?:\d{2}\.\s*)?(OPENING|WEAR|MAKE|BREAK|PEOPLE|OPEN TALK|CLOSING)\s*\/\s*(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})$/;
const SECTION_TIME_FIRST = /^(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})\s*\/\s*(OPENING|WEAR|MAKE|BREAK|PEOPLE|OPEN TALK|CLOSING)$/;
const QUESTION_MARK = /^-\s*(Q\d{1,2})(?:\s*\/\s*(\d+)\s*분)?$/;
const ANSWER_PART = "사전 전달 질문";

export function buildProposal(paragraphs, { file = "", fileSha256 = "" } = {}) {
  const warnings = [];
  const split = paragraphs.findIndex((p) => p.text.trim() === ANSWER_PART);
  if (split < 0) throw new Error(`"${ANSWER_PART}" heading not found`);

  // Cue part.
  const sections = [];
  const questions = [];
  let current = null;
  for (let i = 0; i < split; i += 1) {
    const text = paragraphs[i].text.trim();
    const s = text.match(SECTION) || text.match(SECTION_TIME_FIRST);
    if (s) {
      const [key, start, end] = SECTION.test(text) ? [s[1], s[2], s[3]] : [s[3], s[1], s[2]];
      sections.push({ key: key.replace(" ", "_"), title: key, start, end, description: [] });
      current = null;
      continue;
    }
    const q = text.match(QUESTION_MARK) || (text === "LAST QUESTION" ? [text, "LAST", undefined] : null);
    if (q) {
      if (!sections.length) throw new Error(`${q[1]} appears before any section`);
      current = { code: q[1], sectionKey: sections.at(-1).key, durationMin: q[2] ? Number(q[2]) : null, askText: (paragraphs[i + 1]?.text || "").trim(), cueNotes: [] };
      questions.push(current);
      i += 1;
      continue;
    }
    if (!text) continue;
    if (current) current.cueNotes.push(text);
    else if (sections.length) sections.at(-1).description.push(text);
  }

  // Answer part: numbered paragraphs are the questions sent to the guest, in order Q1, Q2, ...
  const blocks = [];
  for (let i = split + 1; i < paragraphs.length; i += 1) {
    const { text, numbered } = paragraphs[i];
    const isLast = /^LAST\.\s*/.test(text.trim());
    if (numbered || isLast) {
      const [first, ...rest] = (isLast ? text.trim().replace(/^LAST\.\s*/, "") : text).split("\n");
      blocks.push({ code: isLast ? "LAST" : `Q${blocks.filter((b) => b.code !== "LAST").length + 1}`, sentText: first.trim(), lines: rest, startParagraph: i, inline: rest.length > 0 });
    } else if (blocks.length) {
      blocks.at(-1).lines.push(text);
    }
  }
  for (const block of blocks) {
    const question = questions.find((q) => q.code === block.code);
    const text = normalizeAnswer(block.lines.join("\n"));
    const boundaryNotes = [];
    if (block.inline) boundaryNotes.push("answer starts inside the question paragraph after a line break; check where the question ends");
    if (!text) boundaryNotes.push("no answer text found");
    const entry = { sentText: block.sentText, answer: text ? { text, textSha256: sha256(text), startParagraph: block.startParagraph, boundaryNotes } : null };
    if (question) Object.assign(question, entry);
    else { warnings.push(`${block.code} has an answer but no cue question`); questions.push({ code: block.code, sectionKey: null, durationMin: null, askText: "", cueNotes: [], ...entry }); }
  }
  for (const q of questions) {
    if (!q.answer) warnings.push(`${q.code}: no guest answer`);
    if (q.durationMin === null) warnings.push(`${q.code}: no planned minutes in the cue sheet`);
    if (q.sentText !== undefined && q.sentText !== q.askText) q.sentDiffersFromAsk = true;
  }
  return {
    kind: "session-answer-import-proposal",
    status: "PROPOSAL_UNREVIEWED",
    source: { file, sha256: fileSha256 },
    paragraphs: paragraphs.length,
    sections,
    questions,
    counts: { questions: questions.length, answers: questions.filter((q) => q.answer).length },
    warnings
  };
}

export function proposeFromDocx(file) {
  return buildProposal(readDocxParagraphs(file), { file: basename(file), fileSha256: sha256(readFileSync(file)) });
}

// Compares stored answers (a proposal, or a session.json's rev-1 originals) with the DOCX.
export function verifyAgainstDocx(file, stored) {
  const fresh = proposeFromDocx(file);
  const storedAnswers = new Map();
  if (stored?.kind === "session-answer-import-proposal") {
    for (const q of stored.questions) if (q.answer) storedAnswers.set(q.code, { text: q.answer.text, sourceSha256: stored.source?.sha256 });
  } else {
    for (const q of stored?.questions || []) {
      const original = q.guestAnswer?.revisions?.find((r) => r.rev === 1);
      if (original) storedAnswers.set(q.code, { text: original.text, sourceSha256: original.source?.sha256 });
    }
  }
  const results = fresh.questions.map((q) => {
    const kept = storedAnswers.get(q.code);
    if (!q.answer) return { code: q.code, status: "NO_ANSWER_IN_DOCX" };
    if (!kept) return { code: q.code, status: "MISSING", expectedSha256: q.answer.textSha256 };
    const actual = sha256(normalizeAnswer(kept.text));
    return { code: q.code, status: actual === q.answer.textSha256 ? "MATCH" : "MISMATCH", expectedSha256: q.answer.textSha256, actualSha256: actual,
      sourceFileMatches: kept.sourceSha256 ? kept.sourceSha256 === fresh.source.sha256 : null };
  });
  for (const code of storedAnswers.keys()) if (!fresh.questions.some((q) => q.code === code)) results.push({ code, status: "NOT_IN_DOCX" });
  return { ok: results.every((r) => r.status === "MATCH" && r.sourceFileMatches !== false), source: fresh.source, results };
}

// Session-specific layout (format: scripts/session-layouts/example.json) -> operation batches.
// Batch 1 renames/retimes the session's sections (by order) and adds the questions; batch 2 imports
// the originals and needs the question ids created by batch 1. Nothing is sent from here.
export function planLayoutOperations(doc, proposal, layout) {
  const warnings = [];
  const sections = [...doc.sections].sort((a, b) => a.order - b.order);
  if (sections.length !== layout.sections.length) throw new Error(`session has ${sections.length} sections, layout has ${layout.sections.length}`);
  if (doc.questions.length) throw new Error("session already has questions; the layout plan is for an empty session");
  const placed = layout.sections.flatMap((s) => s.questions);
  const proposed = proposal.questions.map((q) => q.code);
  const missing = proposed.filter((code) => !placed.includes(code));
  const unknown = placed.filter((code) => !proposed.includes(code));
  if (missing.length || unknown.length || new Set(placed).size !== placed.length) throw new Error(`layout and proposal disagree (missing ${missing.join(",") || "-"}, unknown ${unknown.join(",") || "-"})`);
  const operations = [];
  layout.sections.forEach((section, index) => {
    const fromDocx = proposal.sections.find((s) => s.key === section.key);
    if (fromDocx && (fromDocx.start !== section.start || fromDocx.end !== section.end)) warnings.push(`${section.key}: layout ${section.start}-${section.end} differs from DOCX ${fromDocx.start}-${fromDocx.end}`);
    operations.push({ type: "update_section", sectionId: sections[index].id, patch: { key: section.key, title: section.title, start: section.start, end: section.end } });
    for (const code of section.questions) {
      const q = proposal.questions.find((x) => x.code === code);
      const durationMin = layout.durationOverrides?.[code] ?? q.durationMin;
      if (durationMin === null) warnings.push(`${code}: no planned minutes`);
      operations.push({ type: "add_question", sectionId: sections[index].id, question: { code, askText: q.askText, sentText: q.sentText ?? "", durationMin } });
    }
  });
  const answerOperations = (docWithQuestions) => docWithQuestions.questions.filter((q) => proposal.questions.find((x) => x.code === q.code)?.answer).map((q) => ({
    type: "import_guest_answer", questionId: q.id, text: proposal.questions.find((x) => x.code === q.code).answer.text, source: { file: proposal.source.file, sha256: proposal.source.sha256 }
  }));
  return { operations, answerOperations, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, docx, third, fourth] = process.argv.slice(2);
  if (command === "propose" && docx) {
    const proposal = proposeFromDocx(docx);
    const out = third === "--out" ? fourth : null;
    if (out) writeFileSync(out, `${JSON.stringify(proposal, null, 2)}\n`);
    console.log(JSON.stringify({ out, counts: proposal.counts, sections: proposal.sections.map((s) => `${s.title} ${s.start}-${s.end}`), warnings: proposal.warnings,
      questions: proposal.questions.map((q) => ({ code: q.code, section: q.sectionKey, min: q.durationMin, sentDiffersFromAsk: Boolean(q.sentDiffersFromAsk), answerSha256: q.answer?.textSha256 || null, notes: q.answer?.boundaryNotes || [] })) }, null, 2));
  } else if (command === "verify" && docx && third) {
    const report = verifyAgainstDocx(docx, JSON.parse(readFileSync(third, "utf8")));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } else {
    console.error("Usage: session-docx-import.mjs propose <docx> [--out file] | verify <docx> <proposal.json|session.json>");
    process.exitCode = 2;
  }
}
