import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSessionService, handleSessionDirectorRequest, signActorToken, verifyActorToken } from "../scripts/session-director-api.mjs";
import { createSessionDropboxStore, sessionPath } from "../scripts/session-dropbox.mjs";
import { createFakeDropbox } from "./helpers/fake-session-dropbox.mjs";

const SECRET = "test-web-secret-value";
const ENV = { SESSION_WEB_SECRET: SECRET, SESSION_OPERATOR_EMAILS: "op@samplas.test, boss@samplas.test", SESSION_APPROVER_EMAILS: "boss@samplas.test" };
const actor = (email = "op@samplas.test", extra = {}) => signActorToken({ email, secret: SECRET, ...extra });

async function startApi(env = ENV) {
  const fake = createFakeDropbox();
  const service = createSessionService(createSessionDropboxStore({ env: {}, fetchImpl: (url, init) => fake.fetchImpl(url, init), getToken: fake.getToken }));
  const server = createServer((req, res) => handleSessionDirectorRequest(req, res, new URL(req.url, "http://x"), { env, service }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { fake, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
function call(port, method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json", ...headers } }, (res) => {
      let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}
const auth = (email) => ({ "x-session-director-token": SECRET, "x-session-actor": actor(email) });

test("actor tokens: signature, expiry and maximum lifetime are enforced", () => {
  const now = Date.parse("2026-10-13T00:00:00Z");
  assert.deepEqual(verifyActorToken(actor("OP@samplas.test", { now }), SECRET, { now }), { email: "op@samplas.test" });
  const [payload, sig] = actor("op@samplas.test", { now }).split(".");
  const forged = Buffer.from(JSON.stringify({ email: "boss@samplas.test", iat: now / 1000, exp: now / 1000 + 60 })).toString("base64url");
  for (const [token, at] of [[`${forged}.${sig}`, now], [actor("op@samplas.test", { now }), now + 121_000], [actor("op@samplas.test", { now, ttlSeconds: 3600 }), now],
    [actor("op@samplas.test", { now: now + 120_000 }), now], [`${payload}`, now], [signActorToken({ email: "op@samplas.test", secret: "other", now }), now]]) {
    assert.throws(() => verifyActorToken(token, SECRET, { now: at }), (e) => e.status === 401);
  }
});

test("REST: only the session credentials open the routes; operators come from Render's own list", async () => {
  const api = await startApi();
  try {
    assert.equal((await call(api.port, "GET", "/api/session-director/projects")).status, 401);
    assert.equal((await call(api.port, "GET", "/api/session-director/projects", { headers: { "x-session-director-token": SECRET } })).status, 401, "token without actor");
    assert.equal((await call(api.port, "GET", "/api/session-director/projects", { headers: { "x-session-director-token": "wrong", "x-session-actor": actor() } })).status, 401);
    assert.equal((await call(api.port, "GET", "/api/session-director/projects", { headers: auth("stranger@samplas.test") })).status, 403);
    assert.equal((await call(api.port, "GET", "/api/session-director/projects", { headers: { "x-samplas-internal-token": "anything", authorization: "Basic eDp5" } })).status, 401);
    assert.equal((await call(api.port, "DELETE", "/api/session-director/project?id=session-002", { headers: auth() })).status, 405);
    assert.equal((await call(api.port, "GET", "/api/session-director/nope", { headers: auth() })).status, 404);
  } finally { await api.close(); }
  const unconfigured = await startApi({});
  try { assert.equal((await call(unconfigured.port, "GET", "/api/session-director/projects", { headers: auth() })).status, 503); } finally { await unconfigured.close(); }
});

test("REST: create, read, cue sheet, operation update with 409, read-back and approver role", async () => {
  const api = await startApi();
  try {
    const created = await call(api.port, "POST", "/api/session-director/projects", { headers: auth(), body: { session: { number: 1, title: "TEST SESSION", isTest: true } } });
    assert.equal(created.status, 201);
    assert.equal(created.body.project.id, "test-session-001");
    assert.equal((await call(api.port, "POST", "/api/session-director/projects", { headers: auth(), body: { session: { number: 1, title: "dup", isTest: true } } })).status, 409);

    const project = (await call(api.port, "GET", "/api/session-director/project?id=test-session-001", { headers: auth() })).body.project;
    const sectionId = project.sections[1].id;
    const added = await call(api.port, "PUT", "/api/session-director/project?id=test-session-001", { headers: auth(),
      body: { version: 1, operations: [{ type: "add_question", sectionId, question: { code: "Q1", askText: "MC 질문", sentText: "게스트 질문", durationMin: 5 } }] } });
    assert.equal(added.status, 200);
    assert.equal(added.body.version, 2);
    const questionId = added.body.changed[0].target;

    const mc = await call(api.port, "PUT", "/api/session-director/project?id=test-session-001", { headers: auth(),
      body: { version: 2, operations: [{ type: "update_question_mc", questionId, patch: { followUps: ["그 브랜드를 고른 이유?"] } }] } });
    assert.equal(mc.body.version, 3);
    const stale = await call(api.port, "PUT", "/api/session-director/project?id=test-session-001", { headers: auth(),
      body: { version: 2, operations: [{ type: "update_question_mc", questionId, patch: { summary: "stale" } }] } });
    assert.deepEqual([stale.status, stale.body.error, stale.body.currentVersion], [409, "version_conflict", 3]);

    const sheet = (await call(api.port, "GET", "/api/session-director/cuesheet?id=test-session-001", { headers: auth() })).body.cueSheet;
    const q = sheet.sections[1].questions[0];
    assert.deepEqual([q.askText, q.sentText, q.mc.followUps, q.guestAnswer], ["MC 질문", "게스트 질문", ["그 브랜드를 고른 이유?"], null]);
    assert.equal(api.fake.json(sessionPath("test-session-001")).questions[0].mc.summary, "", "the stale write changed nothing");

    const imported = await call(api.port, "PUT", "/api/session-director/project?id=test-session-001", { headers: auth(),
      body: { version: 3, operations: [{ type: "import_guest_answer", questionId, text: "원문", source: { file: "x.docx", sha256: "b".repeat(64) } }] } });
    assert.equal(imported.status, 200);
    const proposed = await call(api.port, "PUT", "/api/session-director/project?id=test-session-001", { headers: auth(),
      body: { version: 4, operations: [{ type: "propose_answer_correction", questionId, text: "정정", reason: "guest_correction", evidence: "메일" }] } });
    const proposalId = proposed.body.changed[0].after.proposalId;
    const byOperator = await call(api.port, "PUT", "/api/session-director/project?id=test-session-001", { headers: auth(),
      body: { version: 5, operations: [{ type: "approve_answer_correction", questionId, proposalId }] } });
    assert.deepEqual([byOperator.status, byOperator.body.error], [403, "approver_required"]);
    const byBoss = await call(api.port, "PUT", "/api/session-director/project?id=test-session-001", { headers: auth("boss@samplas.test"),
      body: { version: 5, operations: [{ type: "approve_answer_correction", questionId, proposalId }] } });
    assert.equal(byBoss.status, 200);
    const revisions = api.fake.json(sessionPath("test-session-001")).questions[0].guestAnswer.revisions;
    assert.deepEqual(revisions.map((r) => r.text), ["원문", "정정"]);
    assert.equal(api.fake.json(sessionPath("test-session-001")).changes.at(-1).actor, "boss@samplas.test");
  } finally { await api.close(); }
});

test("REST: a write that does not read back as written is not reported as success", async () => {
  const api = await startApi();
  try {
    await call(api.port, "POST", "/api/session-director/projects", { headers: auth(), body: { session: { number: 2, title: "T", isTest: true } } });
    const original = api.fake.fetchImpl;
    api.fake.fetchImpl = async (url, init) => {
      const response = await original(url, init);
      if (url.endsWith("/files/upload")) api.fake.touch(sessionPath("test-session-002"), (d) => { d.title = "changed after write"; });
      return response;
    };
    const out = await call(api.port, "PUT", "/api/session-director/project?id=test-session-002", { headers: auth(), body: { version: 1, operations: [{ type: "update_project", patch: { theme: "x" } }] } });
    assert.deepEqual([out.status, out.body.error], [502, "write_unverified"]);
  } finally { await api.close(); }
});

test("server.mjs: the session routes ignore the generic /api credentials and loopback access", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "session-api-"));
  for (const name of ["product-registry.json", "product-registry-review-queue.json", "brand-commercial-policy.json", "brand-sourcing-master.json"]) await writeFile(join(dir, name), JSON.stringify({ entries: [], brands: [], policies: [] }));
  const probe = createNetServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  const root = fileURLToPath(new URL("..", import.meta.url));
  const child = spawn(process.execPath, [join(root, "server.mjs")], { cwd: dir, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ECOUNT_AUTO_SYNC: "off", WORK_DIR: dir, HOST: "127.0.0.1", PORT: String(port), CAFE24_PROXY_BASE_URL: "http://127.0.0.1:9", META_ACCESS_TOKEN: "", INSTAGRAM_ACCESS_TOKEN: "",
      AI_AUDIT_SECRET: "audit-secret", SESSION_WEB_SECRET: "", SESSION_MCP_SECRET: "", SESSION_OPERATOR_EMAILS: "" } });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
      child.stdout.on("data", (c) => { if (String(c).includes("running at")) { clearTimeout(timer); resolve(); } });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exit ${code}`)); });
    });
    // Loopback opens the generic /api gate, and the AI audit token opens /api/ai-audit; neither opens this.
    const out = await call(port, "GET", "/api/session-director/projects", { headers: { "x-samplas-internal-token": "audit-secret" } });
    assert.deepEqual([out.status, out.body.error], [503, "not_configured"]);
  } finally { child.kill(); }
});

test("shared actor vector: the web app's signer and this verifier agree", () => {
  // Same vector as samplas-session-director test/auth-proxy.test.mjs.
  const token = "eyJlbWFpbCI6Im9wQHNhbXBsYXMudGVzdCIsImlhdCI6MTc5MTg0OTYwMCwiZXhwIjoxNzkxODQ5NzIwfQ.R3aXVWwKzBiuZNctnN2Jtbiyc68heWYhbKCECe486wA";
  const now = Date.parse("2026-10-13T00:00:30Z");
  assert.deepEqual(verifyActorToken(token, "vector-secret", { now }), { email: "op@samplas.test" });
  assert.equal(signActorToken({ email: "op@samplas.test", secret: "vector-secret", now: Date.parse("2026-10-13T00:00:00Z") }), token);
});
