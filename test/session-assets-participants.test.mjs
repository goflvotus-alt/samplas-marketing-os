import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createSessionService, handleSessionDirectorRequest, signActorToken } from "../scripts/session-director-api.mjs";
import { createSessionDropboxStore } from "../scripts/session-dropbox.mjs";
import { createLocalDropboxFetch } from "../scripts/session-local-dropbox.mjs";
import { createSessionDocument } from "../scripts/session-store.mjs";
import { classify, imageSize } from "../scripts/session-assets.mjs";
import { applyParticipantOperations, emptyParticipants, FORM_HEADERS, maskEmail, maskPhone, mergeSync, parseSheetRows } from "../scripts/session-participants.mjs";

const SECRET = "test-web-secret-value";
const HMAC = "participant-hmac-key-0123456789abcdef0123";
const ENV = { SESSION_WEB_SECRET: SECRET, SESSION_OPERATOR_EMAILS: "op@samplas.test", SESSION_PARTICIPANT_HMAC_KEY: HMAC, SESSION_ASSETS_ROOT: "/DESIGN TEAM/VEIL SESSION" };
const ASSETS = "/DESIGN TEAM/VEIL SESSION";
const SHEET = "sheet-0123456789abcdefghij";

// Fictional applicants only.
const ROWS = [FORM_HEADERS,
  ["2026-10-01 10:00:00", "테스트 하나", "010-1111-2222", "@test.one", "one@example.test", "동기 A", "질문 A", "동의합니다"],
  ["2026-10-01 11:00:00", "테스트 둘", "010-3333-4444", "test.two", "", "동기 B", "", "동의합니다"],
  ["2026-10-01 12:00:00", "테스트 하나", "+82 10-1111-2222", "", "other@example.test", "다시 신청", "", "동의합니다"],
  ["2026-10-01 13:00:00", "동의 안 함", "010-5555-6666", "", "", "동기", "", "동의하지 않음"],
  ["2026-10-01 14:00:00", "", "010-7777-8888", "", "", "", "", "동의합니다"]];

function png(width, height) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(height * (width * 3 + 1)))), chunk("IEND", Buffer.alloc(0))]);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sd-ap-"));
  const put = (path, bytes) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), bytes); };
  for (const n of [1, 2, 3]) put(`/SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR/session-00${n}/session.json`, JSON.stringify(createSessionDocument({ number: n, title: `TEST ${n}` }, { actor: "t" })));
  put(`${ASSETS}/SESSION 001/세션 인스타/feed.png`, png(1080, 1350));
  put(`${ASSETS}/SESSION 001/세션 인스타/story.png`, png(1080, 1920));
  put(`${ASSETS}/SESSION 001/세션 인스타/참가신청.png`, png(1080, 1350));
  put(`${ASSETS}/SESSION 001/캐러셀/02.png`, png(1080, 1350));
  put(`${ASSETS}/SESSION 001/캐러셀/01.png`, png(1080, 1350));
  put(`${ASSETS}/SESSION 001/릴스/세션 스케치 영상.mp4`, Buffer.from("video"));
  put(`${ASSETS}/SESSION 001/릴스/편집중.mp4`, Buffer.from("video"));
  put(`${ASSETS}/SESSION 001/릴스/project.prproj`, Buffer.from("x"));
  put(`${ASSETS}/SESSION 001/릴스/Adobe Premiere Pro Auto-Save/a.mp4`, Buffer.from("x"));
  put(`${ASSETS}/SESSION 001/팜플렛/odd.png`, png(1000, 1500));
  put(`${ASSETS}/SESSION 001/릴스/Premiere Composer Files/Audio/swoosh.wav`, Buffer.from("x"));
  put(`${ASSETS}/SESSION 001/릴스/클립/IMG_1203.MOV`, Buffer.from("x"));
  put(`${ASSETS}/SESSION 001/릴스/C0797.MP4`, Buffer.from("x"));
  put(`${ASSETS}/SESSION 001/릴스/Adobe Premiere Pro Audio Previews/S.PRV/x.cfa`, Buffer.from("x"));
  mkdirSync(join(root, ASSETS, "SESSION 002"), { recursive: true });
  put(`${ASSETS}/SESSION 004/기획초안.pdf`, Buffer.from("%PDF-1.4 mock"));
  const sheets = join(root, "sheets.json");
  writeFileSync(sheets, JSON.stringify({ [SHEET]: ROWS }));
  return { root, sheets };
}

async function startApi(envExtra = {}) {
  const fx = fixture();
  const env = { ...ENV, ...envExtra };
  const store = createSessionDropboxStore({ env: {}, fetchImpl: createLocalDropboxFetch(fx.root), getToken: async () => "local" });
  const readRows = async ({ sheetId }) => { const all = JSON.parse(readFileSync(fx.sheets, "utf8")); if (!all[sheetId]) throw Object.assign(new Error("x")); return all[sheetId]; };
  const service = createSessionService(store, { env: { ...env, SESSION_LOCAL_STORE_DIR: fx.root, SESSION_LOCAL_SHEETS_FILE: fx.sheets }, readRows });
  const server = createServer((req, res) => handleSessionDirectorRequest(req, res, new URL(req.url, "http://x"), { env, service }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { ...fx, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
function call(port, method, path, { body, headers = auth() } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json", ...headers } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* binary */ } resolve({ status: res.statusCode, headers: res.headers, body: json, bytes: buf, text: buf.toString() }); });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}
const auth = () => ({ "x-session-director-token": SECRET, "x-session-actor": signActorToken({ email: "op@samplas.test", secret: SECRET }) });
const q = (path) => encodeURIComponent(path);

test("image size from the first bytes, and category rules", () => {
  assert.deepEqual(imageSize(png(1080, 1350)), { width: 1080, height: 1350 });
  assert.equal(imageSize(Buffer.from("not an image at all, sorry!")), null);
  assert.equal(classify({ path: "/a/x.png", kind: "image", size: { width: 1080, height: 1920 } }), "story");
  assert.equal(classify({ path: "/a/x.png", kind: "image", size: { width: 1080, height: 1350 } }), "feed");
  assert.equal(classify({ path: "/현장 사진/x.jpg", kind: "image", size: null }), "photo");
  assert.equal(classify({ path: "/릴스/x.mov", kind: "video" }), "reels");
  assert.equal(classify({ path: "/x/세션 스케치 영상.mp4", kind: "video" }), "sketch");
  assert.equal(classify({ path: "/x/기획초안.pdf", kind: "document" }), "document");
  assert.equal(classify({ path: "/x/file", kind: "file" }), "other");
});

test("ASSETS: session folder by number, categories, specs, carousel order, editing leftovers skipped; 002 empty; 003 no folder", async () => {
  const api = await startApi();
  try {
    const r = await call(api.port, "GET", "/api/session-director/assets?id=session-001");
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.assets.map((a) => [a.name, a]));
    assert.deepEqual([by["feed.png"].category, by["feed.png"].spec], ["feed", { width: 1080, height: 1350, matches: true }]);
    assert.equal(by["story.png"].category, "story");
    assert.equal(by["참가신청.png"].category, "recruit");
    assert.deepEqual([by["01.png"].order, by["02.png"].order], [1, 2]);
    assert.equal(by["세션 스케치 영상.mp4"].category, "sketch");
    assert.equal(by["편집중.mp4"].category, "reels");
    assert.equal(by["odd.png"].category, "other");
    assert.deepEqual([by["project.prproj"].category, by["a.mp4"].category, by["swoosh.wav"].category], ["work", "work", "work"], "Premiere files are work files");
    assert.deepEqual([by["IMG_1203.MOV"].category, by["C0797.MP4"].category], ["raw", "raw"], "camera originals are raw");
    assert.ok(!by["x.cfa"], "render caches are never listed");
    assert.equal(r.body.counts.carousel, 2);
    const empty = await call(api.port, "GET", "/api/session-director/assets?id=session-002");
    assert.deepEqual([empty.body.assets.length, Boolean(empty.body.folder)], [0, true]);
    assert.equal((await call(api.port, "GET", "/api/session-director/assets?id=session-003")).body.folder, null);
    const plan = (await call(api.port, "GET", "/api/session-director/assets?id=session-004")).body.assets;
    assert.deepEqual(plan.map((a) => [a.name, a.category, a.thumbnail]), [["기획초안.pdf", "document", false]], "a planning PDF is a document, no thumbnail");
    assert.equal(by["편집중.mp4"].thumbnail, false, "no thumbnail request for videos");
  } finally { await api.close(); }
});

test("ASSETS: thumbnails and temporary links only for paths inside that session's folder; no auth, no data", async () => {
  const api = await startApi();
  try {
    const inside = `${ASSETS}/SESSION 001/세션 인스타/feed.png`;
    const thumb = await call(api.port, "GET", `/api/session-director/asset-thumbnail?id=session-001&path=${q(inside)}`);
    assert.deepEqual([thumb.status, thumb.headers["content-type"]], [200, "image/png"]);
    assert.ok(thumb.bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
    const link = await call(api.port, "GET", `/api/session-director/asset-link?id=session-001&path=${q(inside)}`);
    assert.deepEqual([link.status, link.body.expiresInSeconds], [200, 14400]);
    for (const path of [`${ASSETS}/SESSION 002/x.png`, `${ASSETS}/SESSION 001/../SESSION 002/x.png`, "/SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR/session-001/session.json", `${ASSETS}/SESSION 001`, "relative.png"]) {
      assert.equal((await call(api.port, "GET", `/api/session-director/asset-link?id=session-001&path=${q(path)}`)).status, 404, path);
      assert.equal((await call(api.port, "GET", `/api/session-director/asset-thumbnail?id=session-001&path=${q(path)}`)).status, 404, path);
    }
    for (const route of ["assets?id=session-001", `asset-thumbnail?id=session-001&path=${q(inside)}`, "participants?id=session-001"]) {
      assert.equal((await call(api.port, "GET", `/api/session-director/${route}`, { headers: {} })).status, 401, route);
    }
  } finally { await api.close(); }
});

test("sheet rows: header check, consent, masking, keyed HMAC duplicates; originals never stored", () => {
  const parsed = parseSheetRows(ROWS, ENV);
  assert.deepEqual([parsed.people.length, parsed.skippedNoConsent, parsed.skippedInvalid], [3, 1, 1]);
  const doc = emptyParticipants("session-003");
  mergeSync(doc, parsed, { now: "2026-10-02T00:00:00.000Z" });
  const json = JSON.stringify(doc);
  for (const original of ["010-1111-2222", "01011112222", "1111-2222", "one@example.test", "other@example.test", "010-5555-6666", "동의 안 함"]) assert.ok(!json.includes(original), original);
  assert.equal(maskPhone("010-1111-2222"), "010-****-2222");
  assert.equal(maskEmail("one@example.test"), "on***@example.test");
  const [one, two, again] = doc.people;
  assert.deepEqual([one.duplicateOf, again.duplicateOf, two.duplicateOf], [[again.id], [one.id], []], "same phone (+82 form too) flagged both ways");
  assert.notEqual(one.phoneKey, parseSheetRows(ROWS, { SESSION_PARTICIPANT_HMAC_KEY: "another-key-0123456789abcdef0123456789" }).people[0].phoneKey, "keyed, not a plain hash");
  assert.throws(() => parseSheetRows([[...FORM_HEADERS.slice(0, -1), "새 질문"]], ENV), (e) => e.code === "header_changed" && e.details.missing.includes("개인정보 수집·이용 동의") && e.details.extra.includes("새 질문"));
  assert.throws(() => parseSheetRows(ROWS, {}), (e) => e.code === "participants_sync_disabled");
});

test("re-sync keeps statuses and check-ins, adds no duplicates, flags rows gone from the sheet", () => {
  const doc = emptyParticipants("session-003");
  mergeSync(doc, parseSheetRows(ROWS, ENV));
  let next = applyParticipantOperations(doc, [{ type: "update_participant", participantId: doc.people[0].id, patch: { status: "confirmed", notice: "sent" } }], { actor: { id: "op" } });
  next = applyParticipantOperations(next, [{ type: "check_in", participantId: doc.people[0].id }], { actor: { id: "op" }, now: "2026-10-10T10:00:00.000Z" });
  const again = mergeSync(next, parseSheetRows(ROWS, ENV));
  assert.deepEqual([next.people.length, again.added], [3, 0]);
  assert.deepEqual([next.people[0].ops.status, next.people[0].ops.notice, next.people[0].ops.checkedInAt], ["confirmed", "sent", "2026-10-10T10:00:00.000Z"]);
  mergeSync(next, parseSheetRows(ROWS.slice(0, 2), ENV));
  assert.deepEqual(next.people.map((p) => p.removedFromSheet), [false, true, true]);
  assert.equal(next.people.length, 3, "nothing deleted");
  assert.ok(!JSON.stringify(next.log).includes("테스트"), "log has no names");
});

test("capacity is enforced on the server; applications and waitlist stay open; check-in once, confirmed only", () => {
  let doc = emptyParticipants("session-003");
  mergeSync(doc, parseSheetRows(ROWS, ENV));
  const [a, b, c] = doc.people.map((p) => p.id);
  const op = (ops, now) => { doc = applyParticipantOperations(doc, ops, { actor: { id: "op" }, now }); };
  op([{ type: "set_capacity", capacity: 1 }, { type: "update_participant", participantId: a, patch: { status: "confirmed" } }]);
  assert.throws(() => op([{ type: "update_participant", participantId: b, patch: { status: "confirmed" } }]), (e) => e.status === 409 && e.code === "capacity_full");
  op([{ type: "update_participant", participantId: b, patch: { status: "waitlisted" } }]);
  assert.throws(() => op([{ type: "set_capacity", capacity: 0 }]));
  assert.throws(() => op([{ type: "check_in", participantId: b }]), (e) => e.code === "not_confirmed");
  op([{ type: "check_in", participantId: a }], "2026-10-10T10:00:00.000Z");
  assert.throws(() => op([{ type: "check_in", participantId: a }]), (e) => e.code === "already_checked_in" && e.details.checkedInAt === "2026-10-10T10:00:00.000Z");
  op([{ type: "undo_check_in", participantId: a }]);
  assert.throws(() => op([{ type: "update_participant", participantId: c, patch: { name: "x" } }]), (e) => e.code === "invalid_operation", "response fields cannot be edited");
});

test("participants API: off until every guard is set; then sync, ops with version check, server-side capacity; 001/002 never publish a form link", async () => {
  const off = await startApi();
  try {
    const r = await call(off.port, "GET", "/api/session-director/participants?id=session-003");
    assert.deepEqual([r.status, r.body.participants.syncAvailable, r.body.participants.people.length, r.body.participants.capacity], [200, false, 0, 15]);
    const set = await call(off.port, "PUT", "/api/session-director/participants?id=session-003", { body: { version: 0, operations: [{ type: "set_participant_form", form: { sheetId: SHEET } }] } });
    assert.equal(set.status, 200);
    assert.equal((await call(off.port, "POST", "/api/session-director/participants-sync?id=session-003", { body: { version: 1 } })).status, 503, "sync switch off");
  } finally { await off.close(); }

  const api = await startApi({ SESSION_PARTICIPANTS_SYNC: "on" });
  try {
    const put = (id, version, operations) => call(api.port, "PUT", `/api/session-director/participants?id=${id}`, { body: { version, operations } });
    assert.equal((await put("session-001", 0, [{ type: "set_participant_form", form: { formUrl: "https://forms.gle/abc", linkVisible: true } }])).body.error, "form_link_not_allowed");
    assert.equal((await put("session-002", 0, [{ type: "set_participant_form", form: { linkVisible: true } }])).status, 403);
    assert.equal((await put("session-003", 0, [{ type: "set_participant_form", form: { sheetId: SHEET, linkVisible: true } }])).status, 200);
    const sync = await call(api.port, "POST", "/api/session-director/participants-sync?id=session-003", { body: { version: 1 } });
    assert.equal(sync.status, 200);
    assert.deepEqual(sync.body.result, { added: 3, updated: 0, removed: 0 });
    const people = sync.body.participants.people;
    assert.ok(!sync.text.includes("010-1111-2222") && !sync.text.includes("one@example.test") && !sync.text.includes("phoneKey"), "no originals, no matching keys in the browser view");
    assert.equal(people[0].response.phoneMasked, "010-****-2222");
    const resync = await call(api.port, "POST", "/api/session-director/participants-sync?id=session-003", { body: { version: 2 } });
    assert.deepEqual([resync.body.result.added, resync.body.participants.people.length], [0, 3]);
    assert.equal((await put("session-003", 2, [{ type: "set_capacity", capacity: 1 }])).status, 409, "stale version");
    await put("session-003", 3, [{ type: "set_capacity", capacity: 1 }, { type: "update_participant", participantId: people[0].id, patch: { status: "confirmed" } }]);
    const full = await put("session-003", 4, [{ type: "update_participant", participantId: people[1].id, patch: { status: "confirmed" } }]);
    assert.deepEqual([full.status, full.body.error], [409, "capacity_full"]);
    const stored = JSON.parse(readFileSync(join(api.root, "/SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR/session-003/participants.json"), "utf8"));
    assert.equal(stored.version, 4);
    assert.ok(!JSON.stringify(stored).includes("010-1111-2222"));
    const session = readFileSync(join(api.root, "/SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR/session-003/session.json"), "utf8");
    assert.ok(!session.includes("테스트 하나"), "session.json never gets participants");
  } finally { await api.close(); }
});
