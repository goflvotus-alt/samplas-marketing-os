// SAMPLAS SESSION DIRECTOR MCP (stateless JSON-RPC over POST /api/session-director/mcp).
// Auth: x-session-mcp-token = SESSION_MCP_SECRET (this path only); the Sites worker forwards the
// ChatGPT user as x-session-mcp-user and the actor becomes chatgpt:<user>.
// Writes: SESSION_MCP_WRITES = "off" (default) | "test-only" (test-session-* only) | "on".
// Same service as REST: version check, 409 on a stale version, read-back before success.
import { defaultSessionService, safeEqual } from "./session-director-api.mjs";
import { SessionError, sessionProjectView } from "./session-store.mjs";

const protocols = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const id = { type: "string", pattern: "^(test-)?session-\\d{3,4}$", description: "Session id from listSessionProjects, e.g. session-002" };
const version = { type: "integer", minimum: 1, description: "Latest version from getSessionProject or getSessionCueSheet" };
const strict = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const RULES = "Only after the user explicitly approves this exact change. Read the latest version first. On 409 read again and report the conflict; never retry automatically. The result is read back before it is reported as saved.";
export const CUE_OPERATIONS = ["update_section", "update_question", "update_question_mc", "move_question", "add_question", "propose_answer_correction"];

export const SESSION_TOOLS = [
  { name: "listSessionProjects", description: "List SAMPLAS SESSION projects (number, guest, status, date, version, progress).",
    inputSchema: strict({ includeTest: { type: "boolean", default: false } }), annotations: READ },
  { name: "getSessionProject", description: "Read one session: details, tasks, version and recent changes. Guest answers are not included.",
    inputSchema: strict({ id }, ["id"]), annotations: READ },
  { name: "getSessionCueSheet", description: "Read the cue sheet: sections and questions with the MC question (askText), the question sent to the guest (sentText), MC notes (mc) and the guest's original answer as a separate read-only block (guestAnswer, text only with includeAnswers). The original answer can never be edited; corrections are proposals an approver accepts in the web app.",
    inputSchema: strict({ id, includeAnswers: { type: "boolean", default: false } }, ["id"]), annotations: READ },
  { name: "listSessionAssets", description: "Read existing Dropbox asset metadata for a session; does not create, move or delete files.",
    inputSchema: strict({ id }, ["id"]), annotations: READ },
  { name: "getSessionParticipants", description: "Read participant counts and version only. Application details and personal data stay in the authenticated operator view. Read only.",
    inputSchema: strict({ id }, ["id"]), annotations: READ },
  { name: "createSessionProject", description: `Create a new session from the default template (structure only; no answers are copied). ${RULES}`,
    inputSchema: strict({ number: { type: "integer", minimum: 1, maximum: 9999 }, title: { type: "string", minLength: 1, maxLength: 200 }, theme: { type: "string", maxLength: 1000 },
      date: { type: ["string", "null"], description: "YYYY-MM-DD or null when undecided" }, guest: strict({ name: { type: "string" }, handle: { type: "string" }, bio: { type: "string" } }),
      isTest: { type: "boolean", default: false } }, ["number", "title"]), annotations: WRITE },
  { name: "updateSessionProject", description: `Change session details: title, theme, date, timeStart, timeEnd, venue, owners, guest, status (not ARCHIVED). ${RULES}`,
    inputSchema: strict({ id, version, patch: { type: "object", minProperties: 1 } }, ["id", "version", "patch"]), annotations: WRITE },
  { name: "updateSessionCueSheet", description: `Apply cue sheet operations by id: ${CUE_OPERATIONS.join(", ")}. update_question_mc patches summary, keywords, episodes, followUps, toAudience, directionNotes, cautions, liveMemo. Guest answers cannot be changed here. ${RULES}`,
    inputSchema: strict({ id, version, operations: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", required: ["type"], properties: { type: { enum: CUE_OPERATIONS } } } } }, ["id", "version", "operations"]),
    annotations: WRITE }
];

const WRITE_TOOLS = new Set(["createSessionProject", "updateSessionProject", "updateSessionCueSheet"]);

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
  switch (name) {
    case "listSessionProjects": return { status: 200, body: { ok: true, projects: await service.list({ includeTest: args.includeTest === true }) } };
    case "getSessionProject": return { status: 200, body: { ok: true, project: await service.project(args.id) } };
    case "getSessionCueSheet": return { status: 200, body: { ok: true, cueSheet: await service.cueSheet(args.id, { includeAnswers: args.includeAnswers === true }) } };
    case "listSessionAssets": return { status: 200, body: { ok: true, ...(await service.assets(args.id)) } };
    case "getSessionParticipants": return { status: 200, body: { ok: true, participants: await service.participantCounts(args.id) } };
    case "createSessionProject": return { status: 201, body: { ok: true, verified: true, project: sessionProjectView(await service.create(args, actor)) } };
    case "updateSessionProject":
    case "updateSessionCueSheet": {
      const operations = name === "updateSessionProject" ? [{ type: "update_project", patch: args.patch }] : args.operations;
      if (!Array.isArray(operations) || operations.some((op) => name === "updateSessionCueSheet" && !CUE_OPERATIONS.includes(op?.type))) {
        throw new SessionError(400, "invalid_operation", `operations must be ${CUE_OPERATIONS.join(", ")}`);
      }
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
