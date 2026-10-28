// ChatGPT runs the SESSION 002 notice / reply / confirm / check-in flow through updateSessionParticipants.
// Synthetic people in a fake Dropbox only; a test session id, with SESSION 001 alongside to prove it never changes.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { createSessionService, handleSessionDirectorRequest } from "../scripts/session-director-api.mjs";
import { createSessionDropboxStore, sessionPath } from "../scripts/session-dropbox.mjs";
import { serveSessionMcp, SESSION_TOOLS } from "../scripts/session-mcp.mjs";
import { emptyParticipants, participantSummary } from "../scripts/session-participants.mjs";
import { createFakeDropbox } from "./helpers/fake-session-dropbox.mjs";

const MCP = "mcp-secret-value";
const ID = "test-session-902";
const person = (i, ops = {}) => ({ id: `p${i}`, responseKey: `r${i}`, phoneKey: `k${i}`, emailKey: null, removedFromSheet: false, duplicateOf: [],
  response: { submittedAt: `2026-10-0${1 + (i % 9)} 10:${String(i).padStart(2, "0")}`, name: `합성${i}`, phone: `010-0000-${String(1000 + i)}`,
    phoneMasked: `010-****-${1000 + i}`, emailMasked: "", instagram: `synthetic_${i}`, motivation: "", guestQuestion: "", consent: null, sourceProfile: "session-002" },
  ops: { status: "applied", notice: "none", memo: "", checkedInAt: null, statusChangedAt: "2026-10-01T00:00:00.000Z", ...ops } });

async function start() {
  const fake = createFakeDropbox();
  const service = createSessionService(createSessionDropboxStore({ env: {}, fetchImpl: (u, i) => fake.fetchImpl(u, i), getToken: fake.getToken }));
  const env = { SESSION_MCP_SECRET: MCP, SESSION_MCP_WRITES: "test-only" };
  const server = createServer((req, res) => handleSessionDirectorRequest(req, res, new URL(req.url, "http://x"), { env, service, mcp: serveSessionMcp }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  await service.create({ number: 902, title: "Synthetic 002 flow", isTest: true }, { id: "test" });
  const put = (id, doc) => fake.files.set(sessionPath(id, "participants.json"), { text: JSON.stringify(doc), rev: `seed-${id}` });
  put(ID, { ...emptyParticipants(ID), version: 1, people: Array.from({ length: 14 }, (_, i) => person(i + 1)) });
  put("session-001", { ...emptyParticipants("session-001"), version: 7, people: [person(99, { status: "confirmed", notice: "replied" })] });
  return { fake, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
let rpcId = 0;
const tool = (port, name, args) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, method: "POST", path: "/api/session-director/mcp",
    headers: { "content-type": "application/json", "x-session-mcp-token": MCP, "x-session-mcp-user": "user-abc" } }, (res) => {
    let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve(JSON.parse(text).result.structuredContent));
  });
  req.on("error", reject);
  req.end(JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }));
});
const ops = (ids, patch) => ids.map((i) => ({ type: "update_participant", participantId: `p${i}`, patch }));
const upd = (port, version, operations) => tool(port, "updateSessionParticipants", { id: ID, version, operations });

test("published schema offers the reply notices and the bulk limit", () => {
  const schema = SESSION_TOOLS.find((t) => t.name === "updateSessionParticipants").inputSchema;
  assert.deepEqual(schema.properties.operations.items.properties.patch.properties.notice.enum, ["none", "sent", "replied", "available", "unavailable"]);
  assert.equal(schema.properties.operations.maxItems, 20);
});

test("SESSION 002 flow: bulk notice, replies, confirm, check-in, cancel, conflicts, read-back; SESSION 001 untouched", async () => {
  const api = await start();
  const s001 = () => api.fake.files.get(sessionPath("session-001", "participants.json")).text;
  const before001 = s001();
  try {
    // 1. Bulk, one version: 2 told us they cannot come (cancelled), 12 got the selection SMS.
    let out = await upd(api.port, 1, [...ops([1, 2], { notice: "unavailable", status: "cancelled" }), ...ops([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], { notice: "sent" })]);
    assert.equal(out.httpStatus, 200, JSON.stringify(out));
    assert.equal(out.verified, true);
    assert.equal(out.participants.version, 2);
    // 2. Two replied they can attend.
    out = await upd(api.port, 2, ops([3, 4], { notice: "available" }));
    let s = out.participants.summary;
    assert.deepEqual([s.total, s.cancelled, s.applied], [14, 2, 12]);
    assert.deepEqual(s.notices, { none: 0, sent: 10, replied: 0, available: 2, unavailable: 2 }, "12 sent: 2 available, 10 waiting");

    // Stale version: 409 with the current version, nothing written.
    const fileBefore = api.fake.files.get(sessionPath(ID, "participants.json")).text;
    out = await upd(api.port, 2, ops([5], { notice: "available" }));
    assert.deepEqual([out.httpStatus, out.error, out.currentVersion], [409, "version_conflict", 3]);
    // Unknown id inside a bulk: the whole batch is refused (no partial write).
    out = await upd(api.port, 3, [...ops([5], { notice: "available" }), ...ops(["missing"], { status: "confirmed" })]);
    assert.deepEqual([out.httpStatus, out.error], [404, "participant_not_found"]);
    // Invalid values are refused by the server.
    assert.equal((await upd(api.port, 3, ops([5], { notice: "maybe" }))).httpStatus, 400);
    assert.equal((await upd(api.port, 3, ops([5], { name: "x" }))).httpStatus, 400);
    assert.equal(api.fake.files.get(sessionPath(ID, "participants.json")).text, fileBefore);

    // 3. Final confirmation, check-in, undo, then a cancellation.
    out = await upd(api.port, 3, ops([3, 4], { status: "confirmed" }));
    assert.equal(out.participants.summary.confirmed, 2);
    out = await upd(api.port, 4, [{ type: "check_in", participantId: "p3" }, { type: "check_in", participantId: "p4" }]);
    assert.equal(out.participants.summary.checkedIn, 2);
    out = await upd(api.port, 5, [{ type: "undo_check_in", participantId: "p4" }, ...ops([4], { status: "cancelled", memo: "당일 취소" })]);
    s = out.participants.summary;
    assert.deepEqual([s.confirmed, s.cancelled, s.checkedIn], [1, 3, 1]);
    // Check-in needs a confirmed participant.
    assert.deepEqual([(await upd(api.port, 6, [{ type: "check_in", participantId: "p5" }])).error], ["not_confirmed"]);

    // 4. Read back: the stored file, MCP read and write reply agree; ChatGPT never gets the full phone number.
    const read = await tool(api.port, "getSessionParticipants", { id: ID });
    const stored = JSON.parse(api.fake.files.get(sessionPath(ID, "participants.json")).text);
    assert.equal(read.participants.version, stored.version);
    assert.deepEqual(read.participants.summary, participantSummary(stored));
    assert.equal(JSON.stringify(read).includes("010-0000-"), false);
    assert.equal(read.participants.people.find((p) => p.id === "p3").ops.checkedInAt !== null, true);
    assert.deepEqual(stored.log.slice(-2).map((l) => [l.op, l.participantId, l.actor]), [["undo_check_in", "p4", "chatgpt:user-abc"], ["update_participant", "p4", "chatgpt:user-abc"]]);

    // 5. Real sessions stay closed in test-only mode; SESSION 001 bytes never change.
    for (const id of ["session-001", "session-002"]) assert.equal((await tool(api.port, "updateSessionParticipants", { id, version: 7, operations: ops([99], { notice: "sent" }) })).error, "mcp_writes_disabled");
    assert.equal(s001(), before001);
  } finally { await api.close(); }
});

test("summary counts people stored before the reply notices existed", () => {
  const doc = { ...emptyParticipants("session-001"), people: [person(1, { notice: "replied" }), person(2, { notice: undefined }), person(3, { notice: "constructor" })] };
  assert.deepEqual(participantSummary(doc).notices, { none: 2, sent: 0, replied: 1, available: 0, unavailable: 0 });
});
