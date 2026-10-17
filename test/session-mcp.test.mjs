import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSessionService, handleSessionDirectorRequest, signActorToken } from "../scripts/session-director-api.mjs";
import { createSessionDropboxStore, sessionPath } from "../scripts/session-dropbox.mjs";
import { serveSessionMcp, SESSION_TOOLS } from "../scripts/session-mcp.mjs";
import { createFakeDropbox } from "./helpers/fake-session-dropbox.mjs";

const WEB = "web-secret-value", MCP = "mcp-secret-value";
const BASE_ENV = { SESSION_WEB_SECRET: WEB, SESSION_MCP_SECRET: MCP, SESSION_OPERATOR_EMAILS: "op@samplas.test" };

async function start(env) {
  const fake = createFakeDropbox();
  const service = createSessionService(createSessionDropboxStore({ env: {}, fetchImpl: (u, i) => fake.fetchImpl(u, i), getToken: fake.getToken }));
  const server = createServer((req, res) => handleSessionDirectorRequest(req, res, new URL(req.url, "http://x"), { env, service, mcp: serveSessionMcp }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { fake, service, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
function post(port, path, body, headers) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "POST", path, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } }, (res) => {
      let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
const mcpHeaders = { "x-session-mcp-token": MCP, "x-session-mcp-user": "user-abc" };
let rpcId = 0;
async function tool(port, name, args) {
  const out = await post(port, "/api/session-director/mcp", { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }, mcpHeaders);
  return out.body.result.structuredContent;
}
const web = (port, method, path, body) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json", "x-session-director-token": WEB, "x-session-actor": signActorToken({ email: "op@samplas.test", secret: WEB }) } }, (res) => {
    let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve(JSON.parse(text)));
  });
  req.on("error", reject);
  req.end(body === undefined ? undefined : JSON.stringify(body));
});

test("nine tools with read/write annotations; the MCP secret is separate from the web secret", async () => {
  assert.deepEqual(SESSION_TOOLS.map((t) => [t.name, t.annotations.readOnlyHint]), [
    ["listSessionProjects", true], ["getSessionProject", true], ["getSessionCueSheet", true],
    ["listSessionAssets", true], ["getSessionParticipants", true],
    ["updateSessionParticipants", false], ["createSessionProject", false], ["updateSessionProject", false], ["updateSessionCueSheet", false],
    ["getSessionFeedback", true], ["getSessionBenefits", true], ["updateSessionBenefits", false]]);
  const api = await start(BASE_ENV);
  try {
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    assert.equal((await post(api.port, "/api/session-director/mcp", list, { "x-session-mcp-token": WEB, "x-session-mcp-user": "u" })).status, 401, "web secret does not open MCP");
    assert.equal((await post(api.port, "/api/session-director/mcp", list, { "x-session-mcp-token": MCP })).status, 401, "a ChatGPT user is required");
    assert.equal((await post(api.port, "/api/session-director/projects", {}, { "x-session-director-token": MCP, "x-session-actor": signActorToken({ email: "op@samplas.test", secret: MCP }) })).status, 401, "MCP secret does not open REST");
    assert.equal((await post(api.port, "/api/session-director/mcp", list, { ...mcpHeaders, origin: "https://evil.example" })).status, 403);

    const client = new Client({ name: "session-tests", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${api.port}/api/session-director/mcp`), { requestInit: { headers: mcpHeaders } }));
    assert.equal((await client.listTools()).tools.length, 12);
    await client.close();
  } finally { await api.close(); }
  const unconfigured = await start({ ...BASE_ENV, SESSION_MCP_SECRET: "" });
  try { assert.equal((await post(unconfigured.port, "/api/session-director/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, mcpHeaders)).status, 503); } finally { await unconfigured.close(); }
});

test("writes are off by default; test-only opens test sessions only", async () => {
  const off = await start(BASE_ENV);
  try {
    const out = await tool(off.port, "createSessionProject", { number: 1, title: "T", isTest: true });
    assert.deepEqual([out.httpStatus, out.error], [403, "mcp_writes_disabled"]);
    assert.equal(off.fake.files.size, 0);
  } finally { await off.close(); }
  const testOnly = await start({ ...BASE_ENV, SESSION_MCP_WRITES: "test-only" });
  try {
    assert.equal((await tool(testOnly.port, "createSessionProject", { number: 2, title: "real" })).httpStatus, 403);
    assert.equal((await tool(testOnly.port, "createSessionProject", { number: 1, title: "T", isTest: true })).httpStatus, 201);
  } finally { await testOnly.close(); }
});

test("final-test flow in miniature: read cue sheet, edit one MC note, read back, web sees it, stale version gets 409", async () => {
  const api = await start({ ...BASE_ENV, SESSION_MCP_WRITES: "test-only" });
  try {
    const created = await web(api.port, "POST", "/api/session-director/projects", { session: { number: 1, title: "TEST", isTest: true } });
    const sectionId = created.project.sections[1].id;
    const added = await web(api.port, "PUT", "/api/session-director/project?id=test-session-001",
      { version: 1, operations: [{ type: "add_question", sectionId, question: { code: "Q1", askText: "MC 질문", sentText: "보낸 질문", durationMin: 5 } }] });
    const questionId = added.changed[0].target;
    await web(api.port, "PUT", "/api/session-director/project?id=test-session-001",
      { version: 2, operations: [{ type: "import_guest_answer", questionId, text: "게스트 원문", source: { file: "x.docx", sha256: "c".repeat(64) } }] });

    const sheet = await tool(api.port, "getSessionCueSheet", { id: "test-session-001", includeAnswers: true });
    const q = sheet.cueSheet.sections[1].questions[0];
    assert.deepEqual([sheet.cueSheet.version, q.guestAnswer.text, q.guestAnswer.readOnly, q.mc.summary], [3, "게스트 원문", true, ""]);

    const edit = await tool(api.port, "updateSessionCueSheet", { id: "test-session-001", version: 3, operations: [{ type: "update_question_mc", questionId, patch: { summary: "핵심: 원단" } }] });
    assert.deepEqual([edit.httpStatus, edit.verified, edit.version], [200, true, 4]);
    assert.equal(api.fake.json(sessionPath("test-session-001")).changes.at(-1).actor, "chatgpt:user-abc");
    const fromWeb = await web(api.port, "GET", "/api/session-director/cuesheet?id=test-session-001");
    assert.equal(fromWeb.cueSheet.sections[1].questions[0].mc.summary, "핵심: 원단");

    const stale = await tool(api.port, "updateSessionCueSheet", { id: "test-session-001", version: 3, operations: [{ type: "update_question_mc", questionId, patch: { summary: "old" } }] });
    assert.deepEqual([stale.httpStatus, stale.error, stale.currentVersion], [409, "version_conflict", 4]);

    // The original stays out of reach through every MCP write.
    for (const op of [{ type: "update_question", questionId, patch: { guestAnswer: "x" } }, { type: "import_guest_answer", questionId, text: "x", source: {} },
      { type: "approve_answer_correction", questionId, proposalId: "p" }, { type: "save_live_log", run: {} }]) {
      const out = await tool(api.port, "updateSessionCueSheet", { id: "test-session-001", version: 4, operations: [op] });
      assert.equal(out.httpStatus, 400, op.type);
    }
    assert.equal((await tool(api.port, "updateSessionProject", { id: "test-session-001", version: 4, patch: { status: "ARCHIVED" } })).httpStatus, 403);
    const proposal = await tool(api.port, "updateSessionCueSheet", { id: "test-session-001", version: 4,
      operations: [{ type: "propose_answer_correction", questionId, text: "정정안", reason: "import_error", evidence: "docx 대조" }] });
    assert.equal(proposal.httpStatus, 200);
    const stored = api.fake.json(sessionPath("test-session-001")).questions[0].guestAnswer;
    assert.deepEqual([stored.currentRev, stored.revisions.length, stored.revisions[0].text, stored.pending.length], [1, 1, "게스트 원문", 1]);
  } finally { await api.close(); }
});


test("private asset and participant MCP reads reuse the operator service without writes", async () => {
  const api = await start({ ...BASE_ENV, SESSION_MCP_WRITES: "off" });
  try {
    const created = await api.service.create({ number: 901, title: "Read test", isTest: true }, { id: "test" });
    assert.equal(created.id, "test-session-901");
    const people = await tool(api.port, "getSessionParticipants", { id: "test-session-901" });
    assert.equal(people.httpStatus, 200);
    assert.equal(people.participants.summary.total, 0);
    const assets = await tool(api.port, "listSessionAssets", { id: "test-session-901" });
    assert.equal(assets.httpStatus, 200);
    assert.equal(assets.ok, true);
    assert.equal((await tool(api.port, "getSessionParticipants", { id: "invalid" })).httpStatus >= 400, true);
  } finally { await api.close(); }
});

test("ChatGPT schedules the event and runs the TODO list through updateSessionProject; the web app reads the same tasks", async () => {
  const api = await start({ ...BASE_ENV, SESSION_MCP_WRITES: "test-only" });
  try {
    const created = await tool(api.port, "createSessionProject", { number: 902, title: "TASKS", isTest: true });
    const id = created.project.id;
    const both = await tool(api.port, "updateSessionProject", { id, version: 1, patch: { date: "2026-11-21", timeStart: "13:00", timeEnd: "15:00", owners: ["병구"] },
      tasks: [{ type: "add_task", task: { title: "포스터 시안", due: "2026-11-01", owner: "디자인", group: "모집" } }] });
    assert.deepEqual([both.httpStatus, both.verified, both.project.date, both.project.tasks.length], [200, true, "2026-11-21", 9]);
    const task = (await tool(api.port, "getSessionProject", { id })).project.tasks.find((t) => t.title === "포스터 시안");
    assert.deepEqual([task.due, task.owner, task.done], ["2026-11-01", "디자인", false]);
    const done = await tool(api.port, "updateSessionProject", { id, version: 2, tasks: [{ type: "update_task", taskId: task.id, patch: { done: true, owner: "병구" } }] });
    assert.deepEqual([done.httpStatus, done.project.tasks.filter((t) => t.done).length], [200, 1]);
    const fromWeb = await web(api.port, "GET", `/api/session-director/project?id=${id}`);
    assert.deepEqual(fromWeb.project.tasks.find((t) => t.id === task.id), { ...task, done: true, owner: "병구" });

    for (const tasks of [[{ type: "update_project", patch: { title: "x" } }], [{ type: "add_question", sectionId: "s", question: {} }], []]) {
      assert.equal((await tool(api.port, "updateSessionProject", { id, version: 3, tasks })).httpStatus, 400, JSON.stringify(tasks));
    }
    assert.equal((await tool(api.port, "updateSessionProject", { id, version: 3 })).httpStatus, 400, "patch or tasks required");
    assert.equal((await tool(api.port, "updateSessionProject", { id: "session-002", version: 1, tasks: [{ type: "add_task", task: { title: "x" } }] })).httpStatus, 403, "test-only keeps 002 untouched");
  } finally { await api.close(); }
});

test("ChatGPT parity: published schemas accept every argument the operations take, and the SDK client runs the full TODO/NOTES cycle", async () => {
  const { default: Ajv } = await import("ajv");
  const ajv = new Ajv({ strict: false });
  const schema = (name) => SESSION_TOOLS.find((t) => t.name === name).inputSchema;
  const accepts = (name, args) => { const ok = ajv.validate(schema(name), args); assert.ok(ok, `${name}: ${JSON.stringify(ajv.errors)} for ${JSON.stringify(args)}`); };
  const id = "test-session-903";
  // Every operation shape the web app uses, as ChatGPT would send it.
  accepts("updateSessionProject", { id, version: 1, patch: { date: "2026-10-31" }, tasks: [
    { type: "add_task", task: { title: "t", due: "2026-10-20", owner: "o", group: "g", done: false, required: true, memo: "m" } },
    { type: "update_task", taskId: "x", patch: { due: null, done: true, required: false, memo: "" } }, { type: "delete_task", taskId: "x" },
    { type: "restore_from_trash", trashId: "x" }, { type: "add_note", note: { date: "2026-10-17", title: "n", body: "b" } },
    { type: "update_note", noteId: "x", patch: { title: "n2", body: "b2", date: null } }, { type: "delete_note", noteId: "x" }] });
  accepts("updateSessionCueSheet", { id, version: 1, operations: [{ type: "add_question", sectionId: "s", question: { code: "Q1", askText: "a", sentText: "s", durationMin: 5 } },
    { type: "update_question", questionId: "q", patch: { hidden: true } }, { type: "move_question", questionId: "q", sectionId: "s", beforeQuestionId: null },
    { type: "update_question_mc", questionId: "q", patch: { followUps: ["f"], liveMemo: "m" } }, { type: "update_section", sectionId: "s", patch: { title: "WEAR", start: "13:10" } },
    { type: "propose_answer_correction", questionId: "q", text: "t", reason: "r", evidence: "e" }] });
  accepts("updateSessionParticipants", { id, version: 1, operations: [{ type: "update_participant", participantId: "p", patch: { status: "confirmed", notice: "sent", memo: "m" } }, { type: "check_in", participantId: "p" }] });
  accepts("updateSessionBenefits", { id, version: 0, operations: [{ type: "verify_feedback", participantId: "p", staff: "s" }, { type: "mark_used", participantId: "p" }] });
  assert.equal(ajv.validate(schema("updateSessionProject"), { id, version: 1, tasks: [{ type: "add_task", task: { title: "t", secret: 1 } }] }), false, "undeclared fields stay refused");

  const api = await start({ ...BASE_ENV, SESSION_MCP_WRITES: "test-only" });
  const client = new Client({ name: "chatgpt-like", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${api.port}/api/session-director/mcp`), { requestInit: { headers: mcpHeaders } }));
    const listed = (await client.listTools()).tools.find((t) => t.name === "updateSessionProject").inputSchema.properties.tasks.items.properties;
    assert.deepEqual(Object.keys(listed).sort(), ["note", "noteId", "patch", "task", "taskId", "trashId", "type"], "tools/list publishes the operation arguments");
    const call = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;
    await call("createSessionProject", { number: 903, title: "PARITY", isTest: true });
    let p = (await call("getSessionProject", { id })).project;
    let r = await call("updateSessionProject", { id, version: p.version, tasks: [{ type: "add_task", task: { title: "달력 테스트", due: "2026-10-20", required: true, memo: "m" } }, { type: "add_note", note: { date: "2026-10-17", title: "회의", body: "b" } }] });
    const task = r.project.tasks.find((t) => t.title === "달력 테스트"), note = r.project.notes[0];
    assert.deepEqual([task.due, task.required, task.memo, note.title], ["2026-10-20", true, "m", "회의"]);
    r = await call("updateSessionProject", { id, version: r.version, tasks: [{ type: "update_task", taskId: task.id, patch: { due: "2026-10-22", done: true } }, { type: "update_note", noteId: note.id, patch: { body: "b2" } }] });
    assert.deepEqual([r.project.tasks.find((t) => t.id === task.id).due, r.project.tasks.find((t) => t.id === task.id).done, r.project.notes[0].body], ["2026-10-22", true, "b2"]);
    r = await call("updateSessionProject", { id, version: r.version, tasks: [{ type: "delete_task", taskId: task.id }, { type: "delete_note", noteId: note.id }] });
    assert.deepEqual([r.project.tasks.some((t) => t.id === task.id), r.project.trash.length], [false, 2]);
    const fromWeb = await web(api.port, "GET", `/api/session-director/project?id=${id}`);
    assert.equal(fromWeb.project.trash.length, 2, "the web app reads the same trash");
    r = await call("updateSessionProject", { id, version: r.version, tasks: r.project.trash.map((e) => ({ type: "restore_from_trash", trashId: e.id })) });
    assert.deepEqual([r.project.tasks.find((t) => t.id === task.id).due, r.project.notes[0].body, r.project.trash.length], ["2026-10-22", "b2", 0]);
    const stale = await call("updateSessionProject", { id, version: 1, tasks: [{ type: "delete_task", taskId: task.id }] });
    assert.deepEqual([stale.httpStatus, stale.error], [409, "version_conflict"]);
    assert.equal((await call("getSessionFeedback", { id })).feedback.configured, false);
    assert.equal((await call("getSessionBenefits", { id })).benefits.version, 0);
  } finally { await client.close(); await api.close(); }
});
