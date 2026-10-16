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

test("eight tools with read/write annotations; the MCP secret is separate from the web secret", async () => {
  assert.deepEqual(SESSION_TOOLS.map((t) => [t.name, t.annotations.readOnlyHint]), [
    ["listSessionProjects", true], ["getSessionProject", true], ["getSessionCueSheet", true],
    ["listSessionAssets", true], ["getSessionParticipants", true],
    ["createSessionProject", false], ["updateSessionProject", false], ["updateSessionCueSheet", false]]);
  const api = await start(BASE_ENV);
  try {
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    assert.equal((await post(api.port, "/api/session-director/mcp", list, { "x-session-mcp-token": WEB, "x-session-mcp-user": "u" })).status, 401, "web secret does not open MCP");
    assert.equal((await post(api.port, "/api/session-director/mcp", list, { "x-session-mcp-token": MCP })).status, 401, "a ChatGPT user is required");
    assert.equal((await post(api.port, "/api/session-director/projects", {}, { "x-session-director-token": MCP, "x-session-actor": signActorToken({ email: "op@samplas.test", secret: MCP }) })).status, 401, "MCP secret does not open REST");
    assert.equal((await post(api.port, "/api/session-director/mcp", list, { ...mcpHeaders, origin: "https://evil.example" })).status, 403);

    const client = new Client({ name: "session-tests", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${api.port}/api/session-director/mcp`), { requestInit: { headers: mcpHeaders } }));
    assert.equal((await client.listTools()).tools.length, 8);
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
