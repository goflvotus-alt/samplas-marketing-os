import test from "node:test";
import assert from "node:assert/strict";
import { createSessionDropboxStore, sessionPath, SESSION_ROOTS } from "../scripts/session-dropbox.mjs";
import { createSessionDocument, SessionError } from "../scripts/session-store.mjs";
import { createFakeDropbox } from "./helpers/fake-session-dropbox.mjs";

const web = { kind: "web", id: "op@samplas.test", approver: false };
const setup = () => {
  const fake = createFakeDropbox();
  return { fake, store: createSessionDropboxStore({ env: {}, fetchImpl: fake.fetchImpl, getToken: fake.getToken }) };
};
const is = (status, code) => (e) => e instanceof SessionError && e.status === status && (!code || e.code === code);

test("paths come only from validated ids; test sessions live under _DIRECTOR_TEST", () => {
  assert.equal(sessionPath("session-002"), `${SESSION_ROOTS.live}/session-002/session.json`);
  assert.equal(sessionPath("test-session-001"), `${SESSION_ROOTS.test}/test-session-001/session.json`);
  for (const bad of ["../x", "session-2", "session-002/../../a", "SESSION-002", ""]) assert.throws(() => sessionPath(bad), is(400));
});

test("create never overwrites; sessions are separate files; the list excludes test sessions by default", async () => {
  const { fake, store } = setup();
  await store.create(createSessionDocument({ number: 2, title: "002" }));
  await store.create(createSessionDocument({ number: 3, title: "003" }));
  await store.create(createSessionDocument({ number: 1, title: "T", isTest: true }));
  await assert.rejects(store.create(createSessionDocument({ number: 2, title: "dup" })), is(409, "session_exists"));
  assert.equal(fake.json(sessionPath("session-002")).title, "002");
  assert.deepEqual((await store.list()).map((s) => s.id), ["session-002", "session-003"]);
  assert.deepEqual((await store.list({ includeTest: true })).map((s) => s.id), ["test-session-001", "session-002", "session-003"]);
  await assert.rejects(store.read("session-009"), is(404, "session_not_found"));
});

test("update: version check, rev CAS, and editing 003 never touches 002", async () => {
  const { fake, store } = setup();
  await store.create(createSessionDocument({ number: 2, title: "002" }));
  await store.create(createSessionDocument({ number: 3, title: "003" }));
  const before002 = fake.files.get(sessionPath("session-002")).text;
  const out = await store.update("session-003", 1, [{ type: "update_project", patch: { theme: "새 주제" } }], { actor: web });
  assert.equal(out.doc.version, 2);
  assert.equal(fake.json(sessionPath("session-003")).theme, "새 주제");
  assert.equal(fake.files.get(sessionPath("session-002")).text, before002);

  await assert.rejects(store.update("session-003", 1, [{ type: "update_project", patch: { theme: "stale" } }], { actor: web }),
    (e) => is(409, "version_conflict")(e) && e.details.currentVersion === 2);

  // Another writer lands between our read and our upload: the rev CAS refuses, nothing is overwritten.
  const original = fake.fetchImpl;
  let raced = false;
  fake.fetchImpl = async (url, init) => {
    if (url.endsWith("/files/upload") && !raced) { raced = true; fake.touch(sessionPath("session-003"), (d) => { d.version = 3; d.title = "other writer"; }); }
    return original(url, init);
  };
  const racing = createSessionDropboxStore({ env: {}, fetchImpl: (u, i) => fake.fetchImpl(u, i), getToken: fake.getToken });
  await assert.rejects(racing.update("session-003", 2, [{ type: "update_project", patch: { theme: "mine" } }], { actor: web }),
    (e) => is(409, "version_conflict")(e) && e.details.currentVersion === 3);
  assert.equal(fake.json(sessionPath("session-003")).title, "other writer");
});

test("live log: a repeated run writes nothing; a conflict reports whether the run is already stored; snapshots kept", async () => {
  const { fake, store } = setup();
  await store.create(createSessionDocument({ number: 1, title: "T", isTest: true }));
  const run = { runId: "run-1", deviceId: "ipad", baseVersion: 1, startedAt: "2026-10-20T04:00:00Z", endedAt: "2026-10-20T06:00:00Z", done: {}, actual: {}, notes: "" };
  const first = await store.update("test-session-001", 1, [{ type: "save_live_log", run }], { actor: web });
  assert.equal(first.doc.version, 2);
  assert.equal(fake.json(sessionPath("test-session-001", "snapshots/v1.json")).version, 1);
  const uploads = fake.calls.filter((c) => c.url.endsWith("/files/upload")).length;
  const again = await store.update("test-session-001", 2, [{ type: "save_live_log", run }], { actor: web });
  assert.equal(again.unchanged, true);
  assert.equal(fake.calls.filter((c) => c.url.endsWith("/files/upload")).length, uploads, "no write for a repeated run");
  await assert.rejects(store.update("test-session-001", 1, [{ type: "save_live_log", run }], { actor: web }),
    (e) => is(409, "version_conflict")(e) && e.details.liveRunSaved === true);
  await assert.rejects(store.update("test-session-001", 1, [{ type: "save_live_log", run: { ...run, runId: "run-2" } }], { actor: web }),
    (e) => is(409, "version_conflict")(e) && e.details.liveRunSaved === false);
});

test("a broken stored file is reported, never treated as empty", async () => {
  const { fake, store } = setup();
  fake.files.set(sessionPath("session-005"), { text: "{not json", rev: "r1" });
  await assert.rejects(store.read("session-005"), is(500, "invalid_session_document"));
  fake.files.set(sessionPath("session-006"), { text: JSON.stringify({ hello: 1 }), rev: "r2" });
  await assert.rejects(store.read("session-006"), is(500, "invalid_session_document"));
});

test("local development store: same add/update rev rules on a directory; refused on Render", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createLocalDropboxFetch, localStoreAllowed } = await import("../scripts/session-local-dropbox.mjs");
  const dir = await mkdtemp(join(tmpdir(), "session-local-"));
  assert.equal(localStoreAllowed({ SESSION_LOCAL_STORE_DIR: dir }), true);
  assert.equal(localStoreAllowed({ SESSION_LOCAL_STORE_DIR: dir, RENDER: "true" }), false);
  assert.equal(localStoreAllowed({}), false);
  const store = createSessionDropboxStore({ env: {}, fetchImpl: createLocalDropboxFetch(dir), getToken: async () => "local" });
  await store.create(createSessionDocument({ number: 1, title: "T", isTest: true }));
  await assert.rejects(store.create(createSessionDocument({ number: 1, title: "T", isTest: true })), is(409, "session_exists"));
  assert.equal((await store.update("test-session-001", 1, [{ type: "update_project", patch: { theme: "x" } }], { actor: web })).doc.version, 2);
  await assert.rejects(store.update("test-session-001", 1, [{ type: "update_project", patch: { theme: "y" } }], { actor: web }), is(409, "version_conflict"));
  assert.deepEqual((await store.list({ includeTest: true })).map((s) => [s.id, s.version]), [["test-session-001", 2]]);
});

// Fictional credentials only; the transport never reaches Dropbox.
const oauthEnv = { DROPBOX_APP_KEY: "test-key", DROPBOX_APP_SECRET: "test-secret", DROPBOX_REFRESH_TOKEN: "test-refresh" };
function tokenTransport({ tokenFailure, fileFailure } = {}) {
  const fake = createFakeDropbox();
  let issued = 0;
  const calls = [];
  return { fake, calls, get issued() { return issued; }, fetchImpl: async (url, init) => {
    calls.push(url);
    if (url.endsWith("/oauth2/token")) {
      if (tokenFailure) return tokenFailure();
      issued++;
      return new Response(JSON.stringify({ access_token: `test-token-${issued}`, expires_in: 1 }), { status: 200 });
    }
    assert.equal(init.headers.Authorization, `Bearer test-token-${issued}`);
    if (fileFailure) return fileFailure(url, init);
    return fake.fetchImpl(url, init);
  } };
}

test("each read/write obtains a fresh token across expiry; writes happen once and keep rev CAS", async () => {
  const transport = tokenTransport();
  const store = createSessionDropboxStore({ env: oauthEnv, fetchImpl: transport.fetchImpl });
  await store.create(createSessionDocument({ number: 1, title: "T", isTest: true }));
  await store.read("test-session-001");
  await store.read("test-session-001"); // Earlier tokens are now invalid in the simulated issuer.
  const out = await store.update("test-session-001", 1, [{ type: "update_project", patch: { theme: "fresh" } }], { actor: web });
  assert.equal(out.doc.version, 2);
  assert.equal((await store.read("test-session-001")).doc.theme, "fresh");
  const files = transport.calls.filter((u) => !u.endsWith("/oauth2/token"));
  assert.equal(transport.issued, files.length, "no token survives into the next request");
  assert.equal(files.filter((u) => u.endsWith("/files/upload")).length, 2);
  await assert.rejects(store.update("test-session-001", 1, [{ type: "update_project", patch: { theme: "stale" } }], { actor: web }), is(409, "version_conflict"));
});

test("OAuth authentication and network failures are distinct, sanitized, and never start a file write", async () => {
  for (const [failure, code] of [
    [() => new Response("test-secret must never escape", { status: 400 }), "dropbox_auth_failed"],
    [() => { throw new Error("test-secret network detail"); }, "dropbox_network_failed"]
  ]) {
    const transport = tokenTransport({ tokenFailure: failure });
    const store = createSessionDropboxStore({ env: oauthEnv, fetchImpl: transport.fetchImpl });
    await assert.rejects(store.create(createSessionDocument({ number: 1, title: "T", isTest: true })),
      (e) => is(502, code)(e) && !e.message.includes("test-secret"));
    assert.equal(transport.calls.length, 1);
  }
});

test("file authentication errors never replay uploads; the next request gets another token", async () => {
  let rejected = true;
  const transport = tokenTransport({ fileFailure: async (url, init) => rejected
    ? new Response("expired_access_token test-secret", { status: 401 }) : transport.fake.fetchImpl(url, init) });
  const store = createSessionDropboxStore({ env: oauthEnv, fetchImpl: transport.fetchImpl });
  const doc = createSessionDocument({ number: 1, title: "T", isTest: true });
  await assert.rejects(store.create(doc), (e) => is(502, "dropbox_auth_failed")(e) && !e.message.includes("test-secret"));
  assert.equal(transport.calls.filter((u) => u.endsWith("/files/upload")).length, 1);
  rejected = false;
  await store.create(doc);
  assert.equal(transport.issued, 2);
});

test("an upload committed before a network loss is never replayed or overwritten", async () => {
  const transport = tokenTransport({ fileFailure: async (url, init) => {
    const reply = await transport.fake.fetchImpl(url, init);
    if (url.endsWith("/files/upload")) throw new Error("test-secret connection lost after commit");
    return reply;
  } });
  const store = createSessionDropboxStore({ env: oauthEnv, fetchImpl: transport.fetchImpl });
  await assert.rejects(store.create(createSessionDocument({ number: 1, title: "T", isTest: true })),
    (e) => is(502, "dropbox_network_failed")(e) && !e.message.includes("test-secret"));
  assert.equal(transport.calls.filter((u) => u.endsWith("/files/upload")).length, 1);
  assert.equal((await store.read("test-session-001")).doc.version, 1);
});

test("read failures distinguish authentication, HTTP service failure and body network loss without retry", async () => {
  for (const [failure, code] of [
    [() => new Response("private upstream details", { status: 403 }), "dropbox_auth_failed"],
    [() => new Response("private upstream details", { status: 503 }), "dropbox_failed"],
    [() => ({ ok: true, status: 200, text: async () => { throw new Error("private upstream details"); } }), "dropbox_network_failed"]
  ]) {
    const transport = tokenTransport({ fileFailure: failure });
    const store = createSessionDropboxStore({ env: oauthEnv, fetchImpl: transport.fetchImpl });
    await assert.rejects(store.read("test-session-001"), (e) => is(502, code)(e) && !e.message.includes("private"));
    assert.equal(transport.calls.length, 2, "one refresh and one download, no retries");
  }
});
