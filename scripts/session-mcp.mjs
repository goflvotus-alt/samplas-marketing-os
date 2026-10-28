// SAMPLAS SESSION DIRECTOR MCP (stateless JSON-RPC over POST /api/session-director/mcp).
// Auth: x-session-mcp-token = SESSION_MCP_SECRET (this path only); the Sites worker forwards the
// ChatGPT user as x-session-mcp-user and the actor becomes chatgpt:<user>.
// Writes: SESSION_MCP_WRITES = "off" (default) | "test-only" (test-session-* only) | "on".
// Same service as REST: version check, 409 on a stale version, read-back before success.
import { defaultSessionService, safeEqual } from "./session-director-api.mjs";
import { SessionError, sessionProjectView, APPLICATION_FORM_SCHEMA } from "./session-store.mjs";
import {TIMETABLE_OPERATION_SCHEMA} from './session-timetable.mjs';
import { NOTICES, STATUSES } from "./session-participants.mjs";

const protocols = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const id = { type: "string", pattern: "^(test-)?session-\\d{3,4}$", description: "Session id from listSessionProjects, e.g. session-002" };
const version = { type: "integer", minimum: 1, description: "Latest version from getSessionProject or getSessionCueSheet" };
const strict = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const RULES = "Only after the user explicitly approves this exact change. Read the latest version first. On 409 read again and report the conflict; never retry automatically. The result is read back before it is reported as saved.";
export const TASK_OPERATIONS = ["add_task", "update_task", "delete_task", "add_note", "update_note", "delete_note", "restore_from_trash"];
// Same as on-site staff in the web app: status and check-in, never capacity, form or import.
export const PARTICIPANT_STATUS_OPERATIONS = ["update_participant", "check_in", "undo_check_in"];
export const CUE_OPERATIONS = ["update_section", "update_question", "update_question_mc", "move_question", "add_question", "propose_answer_correction"];

// Every argument an operation takes is declared, so ChatGPT sends it (an undeclared property may be dropped).
// The server still validates each field per operation (unknown fields are refused there).
const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const dateOrNull = (description) => ({ type: ["string", "null"], description: `${description} (YYYY-MM-DD, or null to clear)` });
const TASK_FIELDS = { title: str("Task title"), due: dateOrNull("Due date; the SCHEDULE calendar shows the task on this day"), owner: str("Owner"),
  group: str("Group / category"), done: { type: "boolean", description: "Completed" }, required: { type: "boolean", description: "Required task (필수)" }, memo: str("Memo, up to 2000 characters") };
const NOTE_FIELDS = { date: dateOrNull("Meeting date"), title: str("Note title"), body: str("Decisions / open items / follow-ups") };
const TASK_ITEM = { type: "object", required: ["type"], additionalProperties: false, properties: {
  type: { enum: TASK_OPERATIONS },
  task: { type: "object", additionalProperties: false, properties: TASK_FIELDS, description: "add_task: the new task (title required)" },
  taskId: str("update_task / delete_task: task id from getSessionProject"),
  note: { type: "object", additionalProperties: false, properties: NOTE_FIELDS, description: "add_note: the new meeting note (title required)" },
  noteId: str("update_note / delete_note: note id from getSessionProject"),
  patch: { type: "object", additionalProperties: false, properties: { ...TASK_FIELDS, ...NOTE_FIELDS },
    description: "update_task: any of title, due, owner, group, done, required, memo. update_note: any of date, title, body." },
  trashId: str("restore_from_trash: trash entry id from getSessionProject (project.trash)") } };
const MC_PATCH = { summary: str("MC summary / expected answer core"), keywords: { type: "array", items: { type: "string" } }, episodes: str("Episodes"),
  followUps: { type: "array", items: { type: "string" }, description: "Follow-up questions" }, toAudience: { type: "array", items: { type: "string" }, description: "Questions for participants" },
  directionNotes: str("Direction notes"), cautions: str("Cautions"), liveMemo: str("On-site memo") };
const QUESTION_FIELDS = { code: str("Question code, e.g. Q3"), askText: str("MC question"), sentText: str("Question sent to the guest"),
  durationMin: { type: ["integer", "null"], minimum: 0, maximum: 240, description: "Planned minutes" }, hidden: { type: "boolean", description: "true = archived (removed from the run, restorable)" } };
const CUE_ITEM = { type: "object", required: ["type"], additionalProperties: false, properties: {
  type: { enum: CUE_OPERATIONS },
  sectionId: str("update_section / add_question / move_question: section id from getSessionCueSheet"),
  questionId: str("update_question / update_question_mc / move_question / propose_answer_correction: question id"),
  beforeQuestionId: { type: ["string", "null"], description: "move_question: place before this question in the target section; null = at the end" },
  question: { type: "object", additionalProperties: false, properties: QUESTION_FIELDS, description: "add_question: the new question" },
  patch: { type: "object", additionalProperties: false, properties: { key: str("Section key"), title: str("Section title"), start: str("HH:MM"), end: str("HH:MM"), ...QUESTION_FIELDS, ...MC_PATCH },
    description: "update_section: key, title, start, end. update_question: code, askText, sentText, durationMin, hidden. update_question_mc: summary, keywords, episodes, followUps, toAudience, directionNotes, cautions, liveMemo." },
  text: str("propose_answer_correction: the corrected wording proposed for the guest's original (an approver accepts it in the web app)"),
  reason: str("propose_answer_correction: why"), evidence: str("propose_answer_correction: where the correction comes from") } };
const PARTICIPANT_ITEM = { type: "object", required: ["type", "participantId"], additionalProperties: false, properties: {
  type: { enum: PARTICIPANT_STATUS_OPERATIONS }, participantId: str("Participant id from getSessionParticipants"),
  patch: { type: "object", additionalProperties: false, description: "update_participant only", properties: {
    status: { enum: STATUSES, description: "confirmed = final attendance (capacity enforced); cancelled = cancel" },
    notice: { enum: NOTICES, description: "sent = notice SMS sent; available / unavailable = the person replied they can / cannot attend; replied = older reply without the answer" }, memo: str("Operator memo, up to 1000 characters") } } } };
export const BENEFIT_OPERATIONS = ["verify_feedback", "unverify_feedback", "mark_used", "undo_used"];
const BENEFIT_ITEM = { type: "object", required: ["type", "participantId"], additionalProperties: false, properties: {
  type: { enum: BENEFIT_OPERATIONS }, participantId: str("Confirmed participant id from getSessionParticipants"), staff: str("Staff name recorded with the check, up to 40 characters") } };

export const SESSION_TOOLS = [
  { name: 'getSessionTimetable', description: 'Read the independently versioned timetable, trash and history.', inputSchema: strict({id},['id']), annotations: READ },
  { name: 'updateSessionTimetable', description: `Update timetable only: add_item, update_item, delete_item, restore_item, move_item. ${RULES}`, inputSchema: strict({id,version:{type:'integer',minimum:1,description:'Independent version from getSessionTimetable, never the session/cue version'},operations:{type:'array',minItems:1,maxItems:20,items:TIMETABLE_OPERATION_SCHEMA}},['id','version','operations']), annotations: WRITE },
  { name: "listSessionProjects", description: "List SAMPLAS SESSION projects (number, guest, status, date, version, progress).",
    inputSchema: strict({ includeTest: { type: "boolean", default: false } }), annotations: READ },
  { name: "getSessionProject", description: "Read one session: details, tasks, meeting notes, trash (deleted tasks and notes), version and recent changes. Guest answers are not included.",
    inputSchema: strict({ id }, ["id"]), annotations: READ },
  { name: "getSessionCueSheet", description: "Read the cue sheet: sections and questions with the MC question (askText), the question sent to the guest (sentText), MC notes (mc) and the guest's original answer as a separate read-only block (guestAnswer, text only with includeAnswers). The original answer can never be edited; corrections are proposals an approver accepts in the web app.",
    inputSchema: strict({ id, includeAnswers: { type: "boolean", default: false } }, ["id"]), annotations: READ },
  { name: "listSessionAssets", description: "Read existing Dropbox asset metadata for a session; does not create, move or delete files.",
    inputSchema: strict({ id }, ["id"]), annotations: READ },
  { name: "getSessionParticipants", description: "Private operator view of one session's participants: name, Instagram, masked phone (010-****-1234), application answers, status, notice, memo and check-in, plus counts and version. Personal data: use only for running the session; never share it publicly.",
    inputSchema: strict({ id }, ["id"]), annotations: READ },
  { name: "updateSessionParticipants", description: `Change participants by id from getSessionParticipants: update_participant {participantId, patch: {status applied|confirmed|waitlisted|cancelled|no_show, notice none|sent|replied|available|unavailable, memo}}, check_in {participantId}, undo_check_in {participantId}. Up to 20 operations apply together or not at all (bulk change). Capacity is enforced on the server. The reply includes summary counts by status and notice. ${RULES}`,
    inputSchema: strict({ id, version: { type: "integer", minimum: 0, description: "Participants version from getSessionParticipants" },
      operations: { type: "array", minItems: 1, maxItems: 20, items: PARTICIPANT_ITEM } }, ["id", "version", "operations"]), annotations: WRITE },
  { name: "createSessionProject", description: `Create a new session from the default template (structure only; no answers are copied). ${RULES}`,
    inputSchema: strict({ number: { type: "integer", minimum: 1, maximum: 9999 }, title: { type: "string", minLength: 1, maxLength: 200 }, theme: { type: "string", maxLength: 1000 },
      date: { type: ["string", "null"], description: "YYYY-MM-DD or null when undecided" }, guest: strict({ name: { type: "string" }, handle: { type: "string" }, bio: { type: "string" } }),
      isTest: { type: "boolean", default: false } }, ["number", "title"]), annotations: WRITE },
  { name: "updateSessionProject", description: `Change session details (patch: applicationForm {responderUrl, editUrl, sheetUrl} (verified existing Google URLs only; omitted fields preserved, empty string clears), title, theme, date, timeStart, timeEnd, venue, owners, guest, status, not ARCHIVED) and/or the schedule TODO list and meeting notes (tasks: add_task {task: {title, due YYYY-MM-DD|null, owner, group, done, required, memo}}, update_task {taskId, patch}, delete_task {taskId}, add_note {note: {date YYYY-MM-DD|null, title, body}}, update_note {noteId, patch}, delete_note {noteId}, restore_from_trash {trashId}). Deleted tasks and notes go to the session trash (project.trash) and can be restored. Ids come from getSessionProject. ${RULES}`,
    inputSchema: strict({ id, version, patch: { type: "object", minProperties: 1, properties:{applicationForm:APPLICATION_FORM_SCHEMA} },
      tasks: { type: "array", minItems: 1, maxItems: 20, items: TASK_ITEM } }, ["id", "version"]), annotations: WRITE },
  { name: "updateSessionCueSheet", description: `Apply cue sheet operations by id: ${CUE_OPERATIONS.join(", ")}. update_question_mc patches summary, keywords, episodes, followUps, toAudience, directionNotes, cautions, liveMemo. Guest answers cannot be changed here. ${RULES}`,
    inputSchema: strict({ id, version, operations: { type: "array", minItems: 1, maxItems: 20, items: CUE_ITEM } }, ["id", "version", "operations"]),
    annotations: WRITE },
  { name: "getSessionFeedback", description: "Read the session's FEEDBACK and PAMPHLET: feedback form links, the pamphlet's QR check, the anonymous per-question response summary (counts, averages, free-text answers) and the benefit policy. Responses are anonymous and never matched to participants.",
    inputSchema: strict({ id }, ["id"]), annotations: READ },
  { name: "getSessionBenefits", description: "Read the participant benefit state by participant id (feedback_unverified, available, used) with who confirmed it and when, plus the benefits version.",
    inputSchema: strict({ id }, ["id"]), annotations: READ },
  { name: "updateSessionBenefits", description: `Change benefits by participant id (confirmed participants only): verify_feedback (a staff member confirmed this person's feedback), unverify_feedback, mark_used (once; a second use is refused), undo_used. Never grant a benefit from response counts. ${RULES}`,
    inputSchema: strict({ id, version: { type: "integer", minimum: 0, description: "Benefits version from getSessionBenefits" },
      operations: { type: "array", minItems: 1, maxItems: 20, items: BENEFIT_ITEM } }, ["id", "version", "operations"]), annotations: WRITE }
];

// The full number is for the web operations screen; ChatGPT gets the masked copy only.
const withoutPhone = (view) => ({ ...view, people: view.people.map(({ response: { phone: _phone, ...response }, ...person }) => ({ ...person, response })) });
const WRITE_TOOLS = new Set(["createSessionProject", "updateSessionProject", "updateSessionCueSheet", "updateSessionParticipants", "updateSessionBenefits"]);

function assertWritable(env, tool, args) {
  const mode = env.SESSION_MCP_WRITES || "off";
  const target = tool === "createSessionProject" ? (args.isTest === true ? "test-" : "") : String(args.id || "");
  if (mode === "on") return;
  if (mode === "test-only" && target.startsWith("test-")) return;
  throw new SessionError(403, "mcp_writes_disabled", mode === "test-only" ? "MCP writes are enabled for test sessions only" : "MCP writes are disabled");
}

export async function callSessionTool(name, args, { env, service, actor }) {
  const tool = SESSION_TOOLS.find((t) => t.name === name);
  if (!tool) throw new SessionError(404, "unknown_tool");
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new SessionError(400, "invalid_arguments");
  const unknown = Object.keys(args).filter((k) => !(k in tool.inputSchema.properties));
  if (unknown.length) throw new SessionError(400, "invalid_arguments", `unknown argument ${unknown.join(", ")}`);
  for (const key of tool.inputSchema.required) if (args[key] === undefined) throw new SessionError(400, "invalid_arguments", `${key} is required`);
  if (WRITE_TOOLS.has(name)) assertWritable(env, name, args);
  if (name === 'updateSessionTimetable') {
    const mode = env.SESSION_TIMETABLE_MCP_WRITES || 'off';
    if (mode !== 'on' && !(mode === 'test-only' && /^test-session-\d{3,4}$/.test(args.id))) throw new SessionError(403, 'timetable_mcp_writes_disabled');
  }
  switch (name) {
    case 'getSessionTimetable': return {status:200,body:{ok:true,timetable:await service.timetable(args.id)}};
    case 'updateSessionTimetable': return {status:200,body:{ok:true,verified:true,timetable:await service.updateTimetable(args.id,args.version,args.operations,actor)}};
    case "listSessionProjects": return { status: 200, body: { ok: true, projects: await service.list({ includeTest: args.includeTest === true }) } };
    case "getSessionProject": return { status: 200, body: { ok: true, project: await service.project(args.id) } };
    case "getSessionCueSheet": return { status: 200, body: { ok: true, cueSheet: await service.cueSheet(args.id, { includeAnswers: args.includeAnswers === true }) } };
    case "listSessionAssets": return { status: 200, body: { ok: true, ...(await service.assets(args.id)) } };
    case "getSessionParticipants": return { status: 200, body: { ok: true, participants: withoutPhone(await service.participants(args.id)) } };
    case "updateSessionParticipants": {
      if (!Array.isArray(args.operations) || !args.operations.length || args.operations.some((op) => !PARTICIPANT_STATUS_OPERATIONS.includes(op?.type))) {
        throw new SessionError(400, "invalid_operation", `operations must be ${PARTICIPANT_STATUS_OPERATIONS.join(", ")}`);
      }
      return { status: 200, body: { ok: true, verified: true, participants: withoutPhone(await service.updateParticipants(args.id, args.version, args.operations, actor)) } };
    }
    case "getSessionFeedback": return { status: 200, body: { ok: true, feedback: await service.feedback(args.id) } };
    case "getSessionBenefits": return { status: 200, body: { ok: true, benefits: await service.benefits(args.id) } };
    case "updateSessionBenefits": {
      if (!Array.isArray(args.operations) || !args.operations.length || args.operations.some((op) => !BENEFIT_OPERATIONS.includes(op?.type))) {
        throw new SessionError(400, "invalid_operation", `operations must be ${BENEFIT_OPERATIONS.join(", ")}`);
      }
      return { status: 200, body: { ok: true, verified: true, benefits: await service.updateBenefits(args.id, args.version, args.operations, actor) } };
    }
    case "createSessionProject": return { status: 201, body: { ok: true, verified: true, project: sessionProjectView(await service.create(args, actor)) } };
    case "updateSessionProject":
    case "updateSessionCueSheet": {
      const isProject = name === "updateSessionProject";
      const listed = isProject ? (args.tasks ?? []) : args.operations;
      if (!Array.isArray(listed) || listed.some((op) => !(isProject ? TASK_OPERATIONS : CUE_OPERATIONS).includes(op?.type))) {
        throw new SessionError(400, "invalid_operation", isProject ? `tasks must be ${TASK_OPERATIONS.join(", ")}` : `operations must be ${CUE_OPERATIONS.join(", ")}`);
      }
      const operations = isProject && args.patch !== undefined ? [{ type: "update_project", patch: args.patch }, ...listed] : listed;
      if (!operations.length) throw new SessionError(400, "invalid_operation", "patch and/or tasks are required");
      const result = await service.update(args.id, args.version, operations, actor);
      const view = name === "updateSessionCueSheet" ? { cueSheet: await service.cueSheet(args.id) } : { project: sessionProjectView(result.doc) };
      return { status: 200, body: { ok: true, verified: true, version: result.doc.version, unchanged: result.unchanged, changed: result.changed, ...view } };
    }
    default: throw new SessionError(404, "unknown_tool");
  }
}

export async function sessionRpc(message, context) {
  const rpcId = message?.id ?? null;
  const error = (code, text) => ({ jsonrpc: "2.0", id: rpcId, error: { code, message: text } });
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return error(-32600, "Invalid Request");
  if (!Object.hasOwn(message, "id")) return message.method === "notifications/initialized" ? null : error(-32600, "Unsupported notification");
  if (!(typeof rpcId === "string" || (typeof rpcId === "number" && Number.isFinite(rpcId)))) return error(-32600, "Invalid id");
  const params = message.params ?? {};
  if (typeof params !== "object" || Array.isArray(params)) return error(-32602, "Invalid params");
  let result;
  if (message.method === "initialize") {
    result = { protocolVersion: protocols.includes(params.protocolVersion) ? params.protocolVersion : protocols[0], capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "samplas-session-director", version: "1.0.0" },
      instructions: "Private SAMPLAS SESSION DIRECTOR. Read before editing. Guest original answers are read-only. Write only after explicit user approval, with the latest version; never retry a conflict or an ambiguous write automatically." };
  } else if (message.method === "ping") result = {};
  else if (message.method === "tools/list") result = { tools: SESSION_TOOLS };
  else if (message.method === "tools/call") {
    let outcome;
    try {
      outcome = await callSessionTool(params.name, params.arguments ?? {}, context);
    } catch (e) {
      outcome = e instanceof SessionError
        ? { status: e.status, body: { ok: false, error: e.code, message: e.message, ...e.details } }
        : { status: 500, body: { ok: false, error: "internal_error" } };
    }
    const structuredContent = { ...outcome.body, httpStatus: outcome.status };
    result = { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent, isError: outcome.status >= 300 || outcome.body.ok !== true };
  } else return error(-32601, "Method not found");
  return { jsonrpc: "2.0", id: rpcId, result };
}

export async function serveSessionMcp(req, res, { env = process.env, service } = {}) {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body === null ? "" : JSON.stringify(body));
  };
  if (!env.SESSION_MCP_SECRET) return send(503, { ok: false, error: "not_configured" });
  if (!safeEqual(req.headers["x-session-mcp-token"], env.SESSION_MCP_SECRET)) return send(401, { ok: false, error: "unauthorized" });
  const user = String(req.headers["x-session-mcp-user"] || "");
  if (!/^[A-Za-z0-9_.:@-]{1,120}$/.test(user)) return send(401, { ok: false, error: "user_required" });
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(405, { ok: false, error: "method_not_allowed" }); }
  if (req.headers.origin) return send(403, { ok: false, error: "browser_origin_not_supported" });
  if (req.headers["mcp-protocol-version"] && !protocols.includes(req.headers["mcp-protocol-version"])) return send(400, { ok: false, error: "unsupported_protocol_version" });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) return send(413, { ok: false, error: "request_too_large" });
    chunks.push(chunk);
  }
  let message;
  try { message = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  service ||= defaultSessionService(env);
  const reply = await sessionRpc(message, { env, service, actor: { kind: "mcp", id: `chatgpt:${user}`, approver: false } });
  return reply === null ? send(202, null) : send(200, reply);
}
