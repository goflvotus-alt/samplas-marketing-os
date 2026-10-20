// SAMPLAS SESSION DIRECTOR: session document model and operations (pure; no I/O).
// One session = one document. Every change is an operation applied to the latest document;
// the caller (session-dropbox.mjs) owns the version check and the Dropbox rev CAS.
// Guest answers are append-only revisions: rev 1 by import, later revs only by an approved
// correction. No operation edits or removes a revision. See docs/session-director-design.md.
import { createHash, randomUUID } from "node:crypto";

export const SCHEMA_VERSION = 1;
export const STATUSES = ["PLANNING", "GUEST_CONFIRMED", "RECRUITING", "READY", "DONE", "ARCHIVED"];
export const CORRECTION_REASONS = ["guest_correction", "import_error"];
export const MAX_CHANGES = 200;

export const DEFAULT_TEMPLATE = {
  id: "session-default",
  sections: [
    { key: "OPENING", title: "OPENING" },
    { key: "PART_1", title: "PART 1" },
    { key: "PART_2", title: "PART 2" },
    { key: "BREAK", title: "BREAK" },
    { key: "PART_3", title: "PART 3" },
    { key: "OPEN_TALK", title: "OPEN TALK" },
    { key: "CLOSING", title: "CLOSING" }
  ],
  tasks: [
    { title: "게스트 확정", group: "기획" },
    { title: "메인 질문 확정 및 게스트 전달", group: "기획" },
    { title: "게스트 사전 답변 수령", group: "기획" },
    { title: "모집 포스터 게시", group: "모집" },
    { title: "참가자 확정 및 안내", group: "모집" },
    { title: "공간·좌석·촬영 준비", group: "현장" },
    { title: "큐시트 최종 출력", group: "현장" },
    { title: "회고 및 아카이브", group: "사후" }
  ]
};

export class SessionError extends Error {
  constructor(status, code, message = code, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const bad = (message) => new SessionError(400, "invalid_operation", message);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isoNow = (now) => (now ? new Date(now) : new Date()).toISOString();
export const sha256 = (text) => createHash("sha256").update(String(text), "utf8").digest("hex");

// Test sessions get their own id prefix, so their storage folder (_DIRECTOR_TEST) follows from the id.
export const SESSION_ID_PATTERN = /^(test-)?session-\d{3,4}$/;
export function sessionIdFor(number, isTest = false) {
  if (!Number.isInteger(number) || number < 1 || number > 9999) throw bad("number must be an integer 1-9999");
  return `${isTest ? "test-" : ""}session-${String(number).padStart(3, "0")}`;
}

// --- field rules -----------------------------------------------------------------------------

const text = (max) => (value, key) => {
  if (typeof value !== "string" || value.length > max) throw bad(`${key} must be a string of at most ${max} characters`);
  return value;
};
const textList = (maxItems, maxEach) => (value, key) => {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string" || item.length > maxEach)) {
    throw bad(`${key} must be a list of at most ${maxItems} strings`);
  }
  return [...value];
};
const dateOrNull = (value, key) => {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw bad(`${key} must be YYYY-MM-DD or null`);
  return value;
};
const timeOrEmpty = (value, key) => {
  if (value !== "" && (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw bad(`${key} must be HH:MM or empty`);
  return value;
};
const minutes = (value, key) => {
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 240)) throw bad(`${key} must be 0-240 or null`);
  return value;
};
const bool = (value, key) => {
  if (typeof value !== "boolean") throw bad(`${key} must be true or false`);
  return value;
};
const status = (value, key) => {
  if (!STATUSES.includes(value)) throw bad(`${key} must be one of ${STATUSES.join(", ")}`);
  return value;
};
const guest = (value, key) => {
  if (!isObject(value)) throw bad(`${key} must be an object`);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!["name", "handle", "bio"].includes(k)) throw bad(`${key}.${k} is not editable`);
    out[k] = text(k === "bio" ? 4000 : 200)(v, `${key}.${k}`);
  }
  return out;
};

// Project-specific application links; never response rows or access credentials.
export const APPLICATION_FORM_SCHEMA = {type:'object',additionalProperties:false,minProperties:1,properties:{
  responderUrl:{type:'string',maxLength:500},editUrl:{type:'string',maxLength:500},sheetUrl:{type:'string',maxLength:500}
}};
const applicationForm = (value,key) => {
  if (!isObject(value) || !Object.keys(value).length) throw bad(`${key} must be a non-empty object`);
  const patterns={responderUrl:/^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform(?:\?[^#\s]*)?$/,editUrl:/^https:\/\/docs\.google\.com\/forms\/d\/[\w-]+\/edit(?:\?[^#\s]*)?$/,sheetUrl:/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit(?:\?[^#\s]*)?(?:#gid=\d+)?$/};
  const out={};
  for (const [field,url] of Object.entries(value)) {
    if (!Object.hasOwn(patterns,field)) throw bad(`${key}.${field} is not editable`);
    if (typeof url!=='string' || url.length>500 || (url!=='' && !patterns[field].test(url))) throw bad(`${key}.${field} must be a matching Google URL or empty`);
    out[field]=url;
  }
  return out;
};

const PROJECT_FIELDS = {
  title: text(200), theme: text(1000), date: dateOrNull, timeStart: timeOrEmpty, timeEnd: timeOrEmpty,
  venue: text(200), owners: textList(20, 100), guest, status, applicationForm
};
const SECTION_FIELDS = { key: text(30), title: text(100), start: timeOrEmpty, end: timeOrEmpty };
const QUESTION_FIELDS = { code: text(20), askText: text(4000), sentText: text(4000), durationMin: minutes, hidden: bool };
const MC_FIELDS = {
  summary: text(4000), keywords: textList(30, 100), episodes: text(4000), followUps: textList(30, 1000),
  toAudience: textList(30, 1000), directionNotes: text(4000), cautions: text(4000), liveMemo: text(4000)
};
const TASK_FIELDS = { title: text(300), due: dateOrNull, owner: text(100), done: bool, group: text(50), required: bool, memo: text(2000) };
// Meeting notes, as POPUP DIRECTOR's 미팅 기록: date, title, body (decisions / open items / follow-ups).
const NOTE_FIELDS = { date: dateOrNull, title: text(200), body: text(10000) };
// Deleted tasks and notes go to the session's trash (newest kept) and can be restored; nothing is erased at once.
const TRASH_LIMIT = 200;

function cleanPatch(patch, rules, label) {
  if (!isObject(patch) || !Object.keys(patch).length) throw bad(`${label}.patch must be a non-empty object`);
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(rules, key)) throw bad(`${label}.patch.${key} is not editable`);
    out[key] = rules[key](value, `${label}.patch.${key}`);
  }
  return out;
}

// --- documents -------------------------------------------------------------------------------

// directionNotes: how the MC steers the question (intent, the bridge to the next one, when to hand over to participants).
const emptyMc = () => ({ summary: "", keywords: [], episodes: "", followUps: [], toAudience: [], directionNotes: "", cautions: "", liveMemo: "", basedOnRev: null });

// A new session copies only the template's structure (sections and tasks), never answers or notes.
export function createSessionDocument(input, { template = DEFAULT_TEMPLATE, now, actor = "system" } = {}) {
  if (!isObject(input)) throw bad("session must be an object");
  const number = input.number;
  const id = sessionIdFor(number, input.isTest === true);
  const at = isoNow(now);
  const fields = cleanPatch(Object.fromEntries(Object.entries(input).filter(([k]) => !["number", "isTest"].includes(k))), PROJECT_FIELDS, "session");
  if (!fields.title?.trim()) throw bad("session.title is required");
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    number,
    isTest: input.isTest === true,
    version: 1,
    createdAt: at,
    updatedAt: at,
    templateId: template.id,
    status: "PLANNING",
    title: "",
    theme: "",
    date: null,
    timeStart: "",
    timeEnd: "",
    venue: "",
    owners: [],
    ...fields,
    guest: { name: "", handle: "", bio: "", ...(fields.guest || {}) },
    sections: template.sections.map((section, index) => ({ id: randomUUID(), key: section.key, title: section.title, start: section.start || "", end: section.end || "", order: index + 1 })),
    questions: [],
    tasks: template.tasks.map((task) => ({ id: randomUUID(), title: task.title, due: null, owner: "", done: false, group: task.group || "" })),
    liveLog: { runs: [] },
    changes: [{ v: 1, at, actor, op: "create_session", target: id, before: null, after: { templateId: template.id } }]
  };
}

export function assertSessionDocument(doc) {
  if (!isObject(doc) || doc.schemaVersion !== SCHEMA_VERSION || typeof doc.id !== "string" || !Number.isInteger(doc.version) ||
      !Array.isArray(doc.sections) || !Array.isArray(doc.questions) || !Array.isArray(doc.tasks) || !isObject(doc.liveLog)) {
    throw new SessionError(500, "invalid_session_document", "stored session document has an unexpected shape");
  }
  return doc;
}

const findOr404 = (list, id, what) => {
  const item = list.find((x) => x.id === id);
  if (!item) throw new SessionError(404, `${what}_not_found`, `${what} ${id} not found`);
  return item;
};
const renumber = (doc, sectionId) => doc.questions
  .filter((q) => q.sectionId === sectionId)
  .sort((a, b) => a.order - b.order)
  .forEach((q, index) => { q.order = index + 1; });

// --- operations ------------------------------------------------------------------------------

// actor: { kind: "web" | "mcp", id: string, approver: boolean }
const WEB_ONLY = new Set(["import_guest_answer", "approve_answer_correction", "reject_answer_correction", "save_live_log"]);
const APPROVER_ONLY = new Set(["approve_answer_correction", "reject_answer_correction"]);
export const OPERATION_TYPES = ["update_project", "update_section", "update_question", "update_question_mc", "move_question", "add_question",
  "add_task", "update_task", "delete_task", "add_note", "update_note", "delete_note", "restore_from_trash", "import_guest_answer", "propose_answer_correction", "approve_answer_correction", "reject_answer_correction", "save_live_log"];

export function validateOperations(operations, actor) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 50) throw bad("operations must be a list of 1-50 operations");
  if (!actor || !["web", "mcp"].includes(actor.kind) || typeof actor.id !== "string" || !actor.id) throw new SessionError(401, "actor_required");
  for (const op of operations) {
    if (!isObject(op) || !OPERATION_TYPES.includes(op.type)) throw bad(`unknown operation ${isObject(op) ? op.type : ""}`.trim());
    if (WEB_ONLY.has(op.type) && actor.kind !== "web") throw new SessionError(403, "operation_not_allowed", `${op.type} is not available through MCP`);
    if (APPROVER_ONLY.has(op.type) && actor.approver !== true) throw new SessionError(403, "approver_required", `${op.type} needs an approver`);
    if (op.type === "update_project" && actor.kind === "mcp" && op.patch?.status === "ARCHIVED") throw new SessionError(403, "operation_not_allowed", "archiving is not available through MCP");
  }
}

function canonicalRun(run) {
  if (!isObject(run)) throw bad("save_live_log.run must be an object");
  const id = (value, key, max = 80) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value) || value.length > max) throw bad(`run.${key} must be 1-80 letters, digits, - or _`);
    return value;
  };
  const iso = (value, key) => {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw bad(`run.${key} must be an ISO date-time`);
    return value;
  };
  if (!Number.isInteger(run.baseVersion) || run.baseVersion < 1) throw bad("run.baseVersion must be a positive integer");
  const done = isObject(run.done) ? Object.fromEntries(Object.entries(run.done).map(([k, v]) => [k, iso(v, `done.${k}`)])) : {};
  const actual = isObject(run.actual) ? Object.fromEntries(Object.entries(run.actual).map(([k, v]) => {
    if (!isObject(v)) throw bad(`run.actual.${k} must be {start, end}`);
    return [k, { start: v.start ? iso(v.start, `actual.${k}.start`) : null, end: v.end ? iso(v.end, `actual.${k}.end`) : null }];
  })) : {};
  return {
    runId: id(run.runId, "runId"), deviceId: id(run.deviceId, "deviceId"), baseVersion: run.baseVersion,
    startedAt: iso(run.startedAt, "startedAt"), endedAt: iso(run.endedAt, "endedAt"),
    done, actual, notes: text(20000)(run.notes ?? "", "run.notes")
  };
}

function applyOne(doc, op, actor, at, log) {
  const record = (target, before, after) => log.push({ op: op.type, target, before, after });
  const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, structuredClone(obj[k])]));
  switch (op.type) {
    case "update_project": {
      const patch = cleanPatch(op.patch, PROJECT_FIELDS, "update_project");
      if (patch.guest) patch.guest = { ...doc.guest, ...patch.guest };
      if (patch.applicationForm) patch.applicationForm = { ...doc.applicationForm, ...patch.applicationForm };
      record(doc.id, pick(doc, Object.keys(patch)), patch);
      Object.assign(doc, structuredClone(patch));
      return;
    }
    case "update_section": {
      const section = findOr404(doc.sections, op.sectionId, "section");
      const patch = cleanPatch(op.patch, SECTION_FIELDS, "update_section");
      record(section.id, pick(section, Object.keys(patch)), patch);
      Object.assign(section, patch);
      return;
    }
    case "update_question": {
      const question = findOr404(doc.questions, op.questionId, "question");
      const patch = cleanPatch(op.patch, QUESTION_FIELDS, "update_question");
      record(question.id, pick(question, Object.keys(patch)), patch);
      Object.assign(question, patch);
      return;
    }
    case "update_question_mc": {
      const question = findOr404(doc.questions, op.questionId, "question");
      const patch = cleanPatch(op.patch, MC_FIELDS, "update_question_mc");
      record(question.id, pick(question.mc, Object.keys(patch)), patch);
      Object.assign(question.mc, structuredClone(patch), { basedOnRev: question.guestAnswer?.currentRev ?? null });
      return;
    }
    case "move_question": {
      const question = findOr404(doc.questions, op.questionId, "question");
      const section = findOr404(doc.sections, op.sectionId, "section");
      const before = op.beforeQuestionId == null ? null : findOr404(doc.questions, op.beforeQuestionId, "question");
      if (before && (before.sectionId !== section.id || before.id === question.id)) throw bad("beforeQuestionId must be another question in the target section");
      const from = { sectionId: question.sectionId, order: question.order };
      const siblings = doc.questions.filter((q) => q.sectionId === section.id && q.id !== question.id).sort((a, b) => a.order - b.order);
      const index = before ? siblings.indexOf(before) : siblings.length;
      siblings.splice(index, 0, question);
      question.sectionId = section.id;
      siblings.forEach((q, i) => { q.order = i + 1; });
      if (from.sectionId !== section.id) renumber(doc, from.sectionId);
      record(question.id, from, { sectionId: question.sectionId, order: question.order });
      return;
    }
    case "add_question": {
      const section = findOr404(doc.sections, op.sectionId, "section");
      const fields = cleanPatch(op.question, QUESTION_FIELDS, "add_question");
      const question = {
        id: randomUUID(), sectionId: section.id, order: doc.questions.filter((q) => q.sectionId === section.id).length + 1,
        code: "", askText: "", sentText: "", durationMin: null, hidden: false, ...fields, guestAnswer: null, mc: emptyMc()
      };
      doc.questions.push(question);
      record(question.id, null, { sectionId: section.id, code: question.code });
      return;
    }
    case "add_task": {
      const fields = cleanPatch(op.task, TASK_FIELDS, "add_task");
      if (!fields.title?.trim()) throw bad("add_task.task.title is required");
      const task = { id: randomUUID(), title: "", due: null, owner: "", done: false, group: "", ...fields };
      doc.tasks.push(task);
      record(task.id, null, fields);
      return;
    }
    case "update_task": {
      const task = findOr404(doc.tasks, op.taskId, "task");
      const patch = cleanPatch(op.patch, TASK_FIELDS, "update_task");
      record(task.id, pick(task, Object.keys(patch)), patch);
      Object.assign(task, patch);
      return;
    }
    case "delete_task":
    case "delete_note": {
      const kind = op.type === "delete_task" ? "task" : "note";
      const list = kind === "task" ? doc.tasks : (doc.notes ||= []);
      const item = findOr404(list, kind === "task" ? op.taskId : op.noteId, kind);
      list.splice(list.indexOf(item), 1);
      const entry = { id: randomUUID(), kind, item: structuredClone(item), deletedAt: at, deletedBy: actor.id };
      doc.trash = [...(doc.trash || []), entry].slice(-TRASH_LIMIT);
      record(item.id, { kind, title: item.title }, { trashId: entry.id });
      return;
    }
    case "restore_from_trash": {
      const entry = findOr404(doc.trash || [], op.trashId, "trash");
      const list = entry.kind === "task" ? doc.tasks : (doc.notes ||= []);
      if (list.some((x) => x.id === entry.item.id)) throw new SessionError(409, "already_restored", "that item is already back");
      list.push(structuredClone(entry.item));
      doc.trash = doc.trash.filter((x) => x !== entry);
      record(entry.item.id, { trashId: entry.id }, { kind: entry.kind, title: entry.item.title });
      return;
    }
    case "add_note": {
      const fields = cleanPatch(op.note, NOTE_FIELDS, "add_note");
      if (!fields.title?.trim()) throw bad("add_note.note.title is required");
      const note = { id: randomUUID(), date: null, title: "", body: "", ...fields, createdAt: at };
      (doc.notes ||= []).push(note);
      record(note.id, null, { date: note.date, title: note.title });
      return;
    }
    case "update_note": {
      const note = findOr404(doc.notes || [], op.noteId, "note");
      const patch = cleanPatch(op.patch, NOTE_FIELDS, "update_note");
      if (patch.title !== undefined && !patch.title.trim()) throw bad("update_note.patch.title must not be empty");
      record(note.id, pick(note, Object.keys(patch)), patch);
      Object.assign(note, patch, { updatedAt: at });
      return;
    }
    case "import_guest_answer": {
      const question = findOr404(doc.questions, op.questionId, "question");
      if (question.guestAnswer) throw new SessionError(409, "answer_exists", "the original answer was already imported; use a correction");
      const answer = text(20000)(op.text, "import_guest_answer.text");
      if (!answer.trim()) throw bad("import_guest_answer.text must not be empty");
      const source = op.source;
      if (!isObject(source) || typeof source.file !== "string" || !source.file || !/^[0-9a-f]{64}$/.test(String(source.sha256))) {
        throw bad("import_guest_answer.source needs file and the source file sha256");
      }
      question.guestAnswer = {
        currentRev: 1,
        revisions: [{ rev: 1, text: answer, textSha256: sha256(answer), reason: "import", source: { file: source.file, sha256: source.sha256 }, by: actor.id, at }],
        pending: [],
        rejected: []
      };
      record(question.id, null, { rev: 1, textSha256: sha256(answer) });
      return;
    }
    case "propose_answer_correction": {
      const question = findOr404(doc.questions, op.questionId, "question");
      if (!question.guestAnswer) throw new SessionError(409, "answer_missing", "no original answer to correct");
      const correction = text(20000)(op.text, "propose_answer_correction.text");
      if (!correction.trim()) throw bad("propose_answer_correction.text must not be empty");
      if (!CORRECTION_REASONS.includes(op.reason)) throw bad(`reason must be one of ${CORRECTION_REASONS.join(", ")}`);
      const evidence = text(2000)(op.evidence, "propose_answer_correction.evidence");
      if (!evidence.trim()) throw bad("propose_answer_correction.evidence is required");
      const proposal = { id: randomUUID(), text: correction, textSha256: sha256(correction), reason: op.reason, evidence, proposedBy: actor.id, proposedAt: at };
      question.guestAnswer.pending.push(proposal);
      record(question.id, null, { proposalId: proposal.id, reason: op.reason, textSha256: proposal.textSha256 });
      return;
    }
    case "approve_answer_correction":
    case "reject_answer_correction": {
      const question = findOr404(doc.questions, op.questionId, "question");
      const answer = question.guestAnswer;
      const proposal = answer?.pending.find((p) => p.id === op.proposalId);
      if (!proposal) throw new SessionError(404, "proposal_not_found");
      answer.pending = answer.pending.filter((p) => p.id !== proposal.id);
      if (op.type === "reject_answer_correction") {
        answer.rejected.push({ ...proposal, rejectedBy: actor.id, rejectedAt: at });
        record(question.id, { proposalId: proposal.id }, { rejected: true });
        return;
      }
      const rev = answer.revisions.length + 1;
      answer.revisions.push({ rev, text: proposal.text, textSha256: proposal.textSha256, reason: proposal.reason, evidence: proposal.evidence,
        supersedes: answer.currentRev, proposedBy: proposal.proposedBy, proposedAt: proposal.proposedAt, approvedBy: actor.id, approvedAt: at });
      record(question.id, { currentRev: answer.currentRev }, { currentRev: rev, proposalId: proposal.id });
      answer.currentRev = rev;
      return;
    }
    case "save_live_log": {
      const run = canonicalRun(op.run);
      const known = new Set(doc.questions.map((q) => q.id));
      for (const qid of [...Object.keys(run.done), ...Object.keys(run.actual)]) if (!known.has(qid)) throw bad(`run references unknown question ${qid}`);
      const existing = doc.liveLog.runs.find((r) => r.runId === run.runId);
      if (existing) {
        const { savedAt: _a, savedBy: _b, ...stored } = existing;
        if (JSON.stringify(stored) === JSON.stringify(run)) return; // same run sent again: nothing to do
        throw new SessionError(409, "live_run_conflict", "a different run with this runId is already saved");
      }
      doc.liveLog.runs.push({ ...run, savedAt: at, savedBy: actor.id });
      record(run.runId, null, { runId: run.runId, done: Object.keys(run.done).length });
      return;
    }
    default:
      throw bad(`unknown operation ${op.type}`);
  }
}

// Applies every operation to a copy (all-or-nothing). Returns the original document unchanged
// when nothing changed (e.g. a repeated save_live_log), so the caller can skip the write.
export function applyOperations(doc, operations, { actor, now } = {}) {
  assertSessionDocument(doc);
  validateOperations(operations, actor);
  const next = structuredClone(doc);
  const at = isoNow(now);
  const log = [];
  for (const op of operations) applyOne(next, op, actor, at, log);
  if (!log.length) return { doc, changed: [], unchanged: true };
  next.version = doc.version + 1;
  next.updatedAt = at;
  next.changes = [...(doc.changes || []), ...log.map((entry) => ({ v: next.version, at, actor: actor.id, ...entry }))].slice(-MAX_CHANGES);
  return { doc: next, changed: log, unchanged: false };
}

// --- read views ------------------------------------------------------------------------------

export function sessionSummary(doc) {
  const done = doc.tasks.filter((t) => t.done).length;
  const next = doc.tasks.filter((t) => !t.done && t.due).sort((a, b) => a.due.localeCompare(b.due))[0] || null;
  return {
    id: doc.id, number: doc.number, isTest: doc.isTest, title: doc.title, guest: doc.guest?.name || "", theme: doc.theme,
    status: doc.status, date: doc.date, timeStart: doc.timeStart, timeEnd: doc.timeEnd, venue: doc.venue, owners: doc.owners,
    version: doc.version, updatedAt: doc.updatedAt,
    progress: { tasksDone: done, tasksTotal: doc.tasks.length, questions: doc.questions.filter((q) => !q.hidden).length,
      answers: doc.questions.filter((q) => q.guestAnswer).length },
    nextTask: next && { id: next.id, title: next.title, due: next.due }
  };
}

export function sessionProjectView(doc) {
  const { questions: _q, liveLog, changes, ...rest } = doc;
  return { ...rest, liveRuns: liveLog.runs.length, recentChanges: (changes || []).slice(-20) };
}

// The guest's original stays a separate, read-only block next to the operator's MC notes.
export function cueSheetView(doc, { includeAnswers = false } = {}) {
  const sections = [...doc.sections].sort((a, b) => a.order - b.order).map((section) => ({
    ...section,
    questions: doc.questions.filter((q) => q.sectionId === section.id).sort((a, b) => a.order - b.order).map((q) => {
      const answer = q.guestAnswer;
      const current = answer?.revisions.find((r) => r.rev === answer.currentRev) || null;
      return {
        id: q.id, code: q.code, order: q.order, durationMin: q.durationMin, hidden: q.hidden, askText: q.askText, sentText: q.sentText,
        guestAnswer: answer ? {
          readOnly: true, currentRev: answer.currentRev, revisionCount: answer.revisions.length, pendingCorrections: answer.pending.length,
          textSha256: current.textSha256, ...(includeAnswers ? { text: current.text, revisions: answer.revisions, pending: answer.pending } : {})
        } : null,
        mc: { ...q.mc, staleAgainstAnswer: Boolean(answer && q.mc.basedOnRev !== null && q.mc.basedOnRev !== answer.currentRev) }
      };
    })
  }));
  return { id: doc.id, version: doc.version, title: doc.title, timeStart: doc.timeStart, timeEnd: doc.timeEnd, sections };
}
