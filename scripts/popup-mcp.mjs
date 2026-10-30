// SAMPLAS POPUP DIRECTOR MCP (stateless JSON-RPC over POST /api/ai-audit/popup/mcp).
// Auth: the /api/ai-audit/ guard in server.mjs (x-samplas-internal-token = AI audit secret), the same
// secret the "SAMPLAS Popup Projects" Sites bridge already holds. The bridge forwards tools/list and
// tools/call unchanged, so new tools ship with a Render deploy only.
// Writes: POPUP_MCP_WRITES = "on" (default) | "test-only" (projects named TEST-*) | "off".
import { createPopupService } from "./popup-service.mjs";
import { PopupError, PROJECT_STATUSES, TASK_GROUPS, TASK_PRIORITIES, ASSET_STATUSES, REPORT_STATUSES, OPERATIONS, TEMPLATES, STAFF_SITES } from "./popup-projects.mjs";

export const POPUP_MCP_PATH = "/api/ai-audit/popup/mcp";
const protocols = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { ...WRITE, destructiveHint: true };
const strict = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const nullableStr = (description) => ({ type: ["string", "null"], description });
const date = (description) => str(`${description} (YYYY-MM-DD)`, { pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const name = str("Project name (= its Dropbox folder) or project id from listPopupProjects", { minLength: 1 });
const expectedVersion = { type: "integer", minimum: 1, description: "version from the latest getPopupProject / listPopupProjects" };
const opId = str("Optional idempotency key (8-80 chars). Reuse the same opId only when retrying the same request after a timeout; a write already applied is not applied twice.");
const RULES = "Only after the user asked for this change. Use the latest version; on 409 (version_conflict) read again, tell the user what changed and ask before retrying. Never retry automatically. A reply without verified:true is not a saved change.";

const TASK = { title: str("Task title"), date: { type: ["string", "null"], description: "Due date YYYY-MM-DD, null/'' = no date" }, group: { enum: TASK_GROUPS },
  owner: str("Owner"), priority: { type: ["string", "null"], enum: [...TASK_PRIORITIES, null] }, required: { type: "boolean", description: "필수 업무" },
  done: { type: "boolean" }, memo: str("Memo") };
const ASSET = { name: str("Asset name"), status: { enum: ASSET_STATUSES }, url: str("https:// link (Drive, Instagram, …) or empty"), sns: { type: "boolean" }, ad: { type: "boolean" }, memo: str("Memo") };
const FILE = strict({ path: str("Path inside the project folder, e.g. ASSETS/POSTER/main.png or REPORT/final.pptx"), label: str("Label"), type: str("Kind, e.g. feed, story, pptx") }, ["path"]);
const NOTE = { date: { type: ["string", "null"], description: "YYYY-MM-DD" }, title: str("Title"), body: str("Decisions / open items / follow-ups") };
const OPERATION = { type: "object", required: ["type"], additionalProperties: false, properties: {
  type: { enum: OPERATIONS },
  task: strict(TASK, ["title"]), taskId: str("Task id from getPopupProject"), done: { type: "boolean", description: "set_task_done" },
  asset: strict({ ...ASSET, files: { type: "array", items: FILE } }, ["name"]), assetId: str("Asset id from getPopupProject"),
  file: FILE, path: str("unlink_asset_file: linked path to remove (the Dropbox file itself is kept)"),
  note: strict(NOTE, ["title"]), noteId: str("Note id from getPopupProject"),
  expense: strict({date, category: str("Expense category"), title: str("Expense title"), amount: {type:"integer",minimum:0,maximum:1000000000}, vatIncluded: {type:["boolean","null"]}, payer: str("Payer"), relatedStage: str("Stage"), memo: str("Memo"), estimate:{type:"boolean"}, hourlyWage:{type:"number",minimum:0}, paidHours:{type:"number",minimum:0}, shift:str("Shift"), breakHours:{type:"number",minimum:0}}, ["date","category","title","amount"]),
  expenseId: str("Existing expense ID from getPopupProject"),
  trashId: str("restore_from_trash: entry id from project.trash"),
  patch: { type: "object", description: "update_task: any TASK field. update_asset: any ASSET field. update_note: date, title, body. update_expense: validated expense fields. update_report: status (draft|final), title, summary, period {start,end,venue}, file {path,label,type} or null, headline, findings, nextActions, dailyVisitors, comparison, logistics — objects are merged into the existing report, so existing figures are kept unless named." } } };

export const POPUP_TOOLS = [
  { name: "listPopupProjects", description: "List SAMPLAS popup projects: name, id, status (PLANNING/ACTIVE/ENDED/ARCHIVED; derived from dates when a project has none stored), dates, brand, venue, TODO progress, report state, version and last change. Trashed projects are hidden unless includeDeleted; folders moved to _DELETED are listed with includeRemoved.",
    inputSchema: strict({ status: { enum: PROJECT_STATUSES }, includeDeleted: { type: "boolean", default: false }, includeRemoved: { type: "boolean", default: false } }), annotations: READ },
  { name: "getPopupProject", description: "Read one popup project with its latest version: details, TODO (tasks), ASSETS, NOTES, REPORT, trash, recent changeLog, the project folder and its files (ASSETS/, REPORT/) and the web app link. PRESS LIST contact/address are removed.",
    inputSchema: strict({ name, includeFiles: { type: "boolean", default: true } }, ["name"]), annotations: READ },
  { name: "getPopupProjectHistory", description: "Read the last 50 recorded changes of a project (who, when, what, version).",
    inputSchema: strict({ name }, ["name"]), annotations: READ },
  { name: "createPopupProject", description: `Create a new popup project: Dropbox folder PROJECTS/<name> with ASSETS/ and REPORT/ and popup.json version 1. template "default" adds the standard 10 TODO and 3 ASSETS of the local app; "empty" adds none. Leave unknown details (brand, venue) out instead of guessing. Refused if a project with the same name exists. ${RULES}`,
    inputSchema: strict({ name: str("Project name; also the folder name", { minLength: 1, maxLength: 80 }), start: date("Start date"), end: date("End date"),
      brand: nullableStr("Brand(s); omit or null when undecided"), venue: nullableStr("Venue; omit or null when undecided"),
      status: { enum: ["PLANNING", "ACTIVE", "ENDED"], default: "PLANNING" }, scheduleTentative: { type: "boolean", description: "true when the dates are not final (잠정)" },
      template: { enum: TEMPLATES, default: "default" }, note: strict(NOTE, ["title"]), opId }, ["name", "start", "end"]), annotations: WRITE },
  { name: "updatePopupProject", description: `Change part of a project; everything not named stays as it is. patch: name (renames the folder too), start, end, brand, venue, status (PLANNING/ACTIVE/ENDED/ARCHIVED — ARCHIVED = 보관), scheduleTentative. operations (max 30): add_task {task}, update_task {taskId, patch}, set_task_done {taskId, done}, delete_task {taskId}, add_asset {asset}, update_asset {assetId, patch}, link_asset_file {assetId, file}, unlink_asset_file {assetId, path}, delete_asset {assetId}, add_note {note}, update_note {noteId, patch}, delete_note {noteId}, add_expense {expense}, update_expense {expenseId, patch}, update_report {patch}, restore_from_trash {trashId}. Deleted tasks/assets/notes go to project.trash and can be restored; Dropbox files are never deleted. Legacy form: {name, body: {project, expectedVersion}} replaces tasks/assets/notes/start/end only. ${RULES}`,
    inputSchema: strict({ name, expectedVersion, patch: strict({ name: str("New name"), start: date("Start"), end: date("End"), brand: nullableStr("Brand"), venue: nullableStr("Venue"),
      status: { enum: PROJECT_STATUSES }, scheduleTentative: { type: "boolean" } }), operations: { type: "array", minItems: 1, maxItems: 30, items: OPERATION }, opId,
      body: { type: "object", description: "Legacy only: {project, expectedVersion} from getPopupProject. Prefer patch/operations." } }, ["name"]), annotations: DESTRUCTIVE },
  { name: "deletePopupProject", description: `Delete a project in two safe steps, only after the user explicitly confirms. mode "trash" (default): hidden from the list, nothing else changes, restorable. mode "remove": only for a project already in trash and only with confirmName = the exact project name after the user confirms again; moves the whole folder to _DELETED/PROJECTS (no file is deleted; restorable). To archive instead, use updatePopupProject patch.status ARCHIVED. ${RULES}`,
    inputSchema: strict({ name, expectedVersion, mode: { enum: ["trash", "remove"], default: "trash" }, confirmName: str("remove only: exact project name"), opId }, ["name", "expectedVersion"]), annotations: DESTRUCTIVE },
  { name: "restorePopupProject", description: `Restore a project: moves a removed folder back from _DELETED/PROJECTS, takes a trashed project out of trash, and returns an ARCHIVED project to its previous status. ${RULES}`,
    inputSchema: strict({ name: str("Project name, id, or removedFolder from listPopupProjects includeRemoved"), expectedVersion: { ...expectedVersion, description: "version from getPopupProject (not needed for a removed folder)" }, opId }, ["name"]), annotations: WRITE }
,
  { name: "getPopupStaffBoard", description: "Read a project's STAFF BOARD (the web app's 근무표): STAFF POOL, and per date the staff at 본점 and VEIL, plus the project version and last change time. stored:false means no board was saved yet and the pool is the app's default.",
    inputSchema: strict({ name }, ["name"]), annotations: READ },
  { name: "updatePopupStaffBoard", description: `Save staff placements on the STAFF BOARD. assignments: {"YYYY-MM-DD": {"본점": [names], "VEIL": [names]}}. For each date given, only the sites given are replaced (an empty list clears that site); every other date and site stays as it is. Names not in the STAFF POOL are added to it. One person can be in only one place per date (duplicate_staff_assignment). Copy names exactly as the user wrote them; never drop, merge or rename anyone. ${RULES}`,
    inputSchema: strict({ name, expectedVersion,
      assignments: { type: "object", description: "Dates (YYYY-MM-DD) to set, each with 본점 and/or VEIL lists", additionalProperties: strict(Object.fromEntries(STAFF_SITES.map((site) => [site, { type: "array", items: { type: "string" }, description: `Staff at ${site}` }]))) },
      addToPool: { type: "array", items: { type: "string" }, description: "Optional: names to add to the STAFF POOL without placing them" }, opId }, ["name", "expectedVersion", "assignments"]), annotations: WRITE }
];
const WRITE_TOOLS = new Set(["createPopupProject", "updatePopupProject", "deletePopupProject", "restorePopupProject", "updatePopupStaffBoard"]);

function assertWritable(env, args) {
  const mode = env.POPUP_MCP_WRITES || "on";
  if (mode === "on") return;
  if (mode === "test-only" && /^TEST-/i.test(String(args.name || "")) && (!args.patch?.name || /^TEST-/i.test(args.patch.name))) return;
  throw new PopupError(403, "mcp_writes_disabled", mode === "test-only" ? "Writes are enabled for TEST-* projects only" : "Writes are disabled");
}

export async function callPopupTool(toolName, args, { env, service, actor }) {
  const tool = POPUP_TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new PopupError(404, "unknown_tool");
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new PopupError(400, "invalid_arguments");
  const unknown = Object.keys(args).filter((k) => !(k in tool.inputSchema.properties));
  if (unknown.length) throw new PopupError(400, "invalid_arguments", `unknown argument ${unknown.join(", ")}`);
  for (const key of tool.inputSchema.required) if (args[key] === undefined) throw new PopupError(400, "invalid_arguments", `${key} is required`);
  if (WRITE_TOOLS.has(toolName)) assertWritable(env, args);
  switch (toolName) {
    case "listPopupProjects": return { status: 200, body: { ok: true, ...(await service.list(args)) } };
    case "getPopupProject": return { status: 200, body: { ok: true, project: await service.get(args.name, { includeFiles: args.includeFiles !== false }) } };
    case "getPopupStaffBoard": return { status: 200, body: { ok: true, ...(await service.staffBoard(args.name)) } };
    case "updatePopupStaffBoard": return { status: 200, body: { ok: true, ...(await service.updateStaffBoard(args.name, args.expectedVersion, args, { actor, opId: args.opId })) } };
    case "getPopupProjectHistory": return { status: 200, body: { ok: true, ...(await service.history(args.name)) } };
    case "createPopupProject": {
      const result = await service.create(args, { actor });
      return { status: result.replayed ? 200 : 201, body: { ok: true, verified: true, ...result } };
    }
    case "updatePopupProject": {
      if (args.body !== undefined) {
        if (args.patch !== undefined || args.operations !== undefined || args.expectedVersion !== undefined) throw new PopupError(400, "invalid_arguments", "use either body (legacy) or expectedVersion + patch/operations");
        return { status: 200, body: { ok: true, ...(await service.legacyUpdate(args.name, args.body, { actor })) } };
      }
      if (args.patch === undefined && args.operations === undefined) throw new PopupError(400, "invalid_arguments", "patch and/or operations are required");
      if (Array.isArray(args.operations) && args.operations.length > 30) throw new PopupError(400, "invalid_arguments", "at most 30 operations");
      return { status: 200, body: { ok: true, ...(await service.update(args.name, args.expectedVersion, args, { actor, opId: args.opId })) } };
    }
    case "deletePopupProject": return { status: 200, body: { ok: true, ...(await service.delete(args.name, args.expectedVersion, args, { actor, opId: args.opId })) } };
    case "restorePopupProject": return { status: 200, body: { ok: true, ...(await service.restore(args.name, args.expectedVersion, { actor, opId: args.opId })) } };
    default: throw new PopupError(404, "unknown_tool");
  }
}

export async function popupRpc(message, context) {
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
      serverInfo: { name: "samplas-popup-director", version: "2.0.0" },
      instructions: "Private SAMPLAS POPUP DIRECTOR. Read (getPopupProject) before editing and send only the change with expectedVersion. Write only what the user asked; never invent budget, venue or brand. Delete only after explicit confirmation. Never retry a conflict or an unconfirmed write automatically; only verified:true means saved." };
  } else if (message.method === "ping") result = {};
  else if (message.method === "tools/list") result = { tools: POPUP_TOOLS };
  else if (message.method === "tools/call") {
    let outcome;
    try {
      outcome = await callPopupTool(params.name, params.arguments ?? {}, context);
    } catch (e) {
      outcome = e instanceof PopupError
        ? { status: e.status, body: { ok: false, error: e.code, message: e.message, ...e.details } }
        : { status: 502, body: { ok: false, error: "upstream_error", message: "The request did not complete. Read the project again before retrying; nothing is reported as saved." } };
    }
    const structuredContent = { ...outcome.body, httpStatus: outcome.status };
    result = { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent, isError: outcome.status >= 300 || outcome.body.ok !== true };
  } else return error(-32601, "Method not found");
  return { jsonrpc: "2.0", id: rpcId, result };
}

// Called by server.mjs after the /api/ai-audit/ token check.
export async function servePopupMcp(req, res, { env = process.env, service } = {}) {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body === null ? "" : JSON.stringify(body));
  };
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
  const user = String(req.headers["x-popup-mcp-user"] || "").replace(/[^A-Za-z0-9_.:@-]/g, "").slice(0, 120);
  service ||= createPopupService({ env });
  const reply = await popupRpc(message, { env, service, actor: user ? `chatgpt:${user}` : "chatgpt" });
  return reply === null ? send(202, null) : send(200, reply);
}
