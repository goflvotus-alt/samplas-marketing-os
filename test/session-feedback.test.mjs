// FEEDBACK / BENEFIT / PAMPHLET for SESSION DIRECTOR. Fake Dropbox, fake sheet rows; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { createSessionService } from "../scripts/session-director-api.mjs";
import { createSessionDropboxStore, sessionPath } from "../scripts/session-dropbox.mjs";
import { summariseFeedback } from "../scripts/session-feedback.mjs";
import { createFakeDropbox } from "./helpers/fake-session-dropbox.mjs";

const ID = "test-session-990";
const ACTOR = { kind: "web", id: "web@session.local" };
const ROWS = [
  ["타임스탬프", "전반적으로 어떠셨나요?", "기억에 남은 이야기", "더 듣고 싶었던 이야기", "다음 SESSION 제안", "다시 참여?", "추천?"],
  ["2026. 9. 6 오후 2:53:36", "5", "시작 이야기", "운영 방식", "브랜드 대표", "꼭 다시", "5"],
  ["2026. 9. 6 오후 2:54:27", "4", "실패 이야기", "", "마케팅", "주제를 보고", "4"],
  ["2026. 9. 6 오후 2:55:11", "5", "성장 이야기", "디깅 방법", "디렉터", "꼭 다시", "5"],
  ["", "", "", "", "", "", ""]
];
const CONFIG = {
  schemaVersion: 1, sessionId: ID,
  applicationForm: { editUrl: "https://docs.google.com/forms/d/APPLY/edit", responderUrl: "https://docs.google.com/forms/d/e/APPLY_PUBLIC/viewform", sheetUrl: "https://docs.google.com/spreadsheets/d/APPLY_SHEET/edit" },
  feedbackForm: { editUrl: "https://docs.google.com/forms/d/FEEDBACK/edit", responderUrl: "https://docs.google.com/forms/d/e/FEEDBACK_PUBLIC/viewform", sheetId: "PRIVATE_FEEDBACK_SHEET_ID", sheetRange: "A:G",
    qrTarget: "https://docs.google.com/forms/d/e/FEEDBACK_PUBLIC/viewform?usp=header" },
  pamphlet: { path: "/ASSETS/SESSION 990/팜플렛/990 A5.png", paper: "A5" },
  benefit: { title: "30% OFF", items: ["오프라인 30%"], notes: ["1회 사용"], validFrom: "2026-09-06", validUntil: "2026-09-20" },
  analysis: { highlights: "기억에 남은 이야기", requests: "더 듣고 싶었던 이야기", nextIdeas: "다음 SESSION 제안" },
  messages: [{ label: "참가 확정 안내", text: "안내" }, { label: "", text: "dropped" }]
};
const person = (id, status) => ({ id, response: { name: `테스트 ${id}` }, ops: { status, notice: "none", memo: "", checkedInAt: null, statusChangedAt: null } });

async function setup({ rows = ROWS, config = CONFIG } = {}) {
  const fake = createFakeDropbox();
  const reads = [];
  const service = createSessionService(createSessionDropboxStore({ env: {}, fetchImpl: (u, i) => fake.fetchImpl(u, i), getToken: fake.getToken }),
    { env: {}, readRows: async (args) => { reads.push(args); if (rows instanceof Error) throw rows; return rows; } });
  await service.create({ number: 990, title: "TEST", date: "2026-09-06", isTest: true }, ACTOR);
  const put = (file, doc) => fake.files.set(sessionPath(ID, file), { text: JSON.stringify(doc), rev: `seed-${file}` });
  put("participants.json", { schemaVersion: 1, sessionId: ID, version: 3, updatedAt: null, capacity: 15, form: { formUrl: "", sheetId: "", sheetRange: "", linkVisible: false },
    sync: { lastSuccessAt: null, lastAttemptAt: null, lastError: null, rowCount: 0, skippedNoConsent: 0, skippedInvalid: 0 }, people: [person("p1", "confirmed"), person("p2", "cancelled"), person("p3", "confirmed")], log: [] });
  if (config) put("feedback.json", config);
  return { fake, service, reads, participantsBefore: fake.files.get(sessionPath(ID, "participants.json")).text };
}

test("feedback summary: scale, choice and text questions from the real header; empty rows skipped; no timestamps", () => {
  const s = summariseFeedback(ROWS, CONFIG.analysis);
  assert.equal(s.count, 3);
  assert.deepEqual(s.questions.map((q) => [q.type, q.answered]), [["scale", 3], ["text", 3], ["text", 2], ["text", 3], ["choice", 3], ["scale", 3]]);
  assert.equal(s.questions[0].average, 4.67);
  assert.deepEqual(s.questions[0].distribution.slice(0, 2), [{ value: "5", count: 2 }, { value: "4", count: 1 }]);
  assert.deepEqual(s.questions[4].distribution, [{ value: "꼭 다시", count: 2 }, { value: "주제를 보고", count: 1 }]);
  assert.deepEqual(s.analysis, { highlights: ["시작 이야기", "실패 이야기", "성장 이야기"], requests: ["운영 방식", "디깅 방법"], nextIdeas: ["브랜드 대표", "마케팅", "디렉터"] });
  assert.ok(!JSON.stringify(s).includes("오후"), "timestamps never leave the server");
  assert.deepEqual(summariseFeedback(ROWS, {}).analysis, { highlights: [], requests: [], nextIdeas: [] }, "no guessing without the team's mapping");
});

test("feedback: settings view hides the sheet id and Dropbox path; a sheet failure keeps the settings", async () => {
  const { service, reads } = await setup();
  const out = await service.feedback(ID);
  assert.equal(out.responses.count, 3);
  assert.deepEqual(reads[0], { env: {}, sheetId: "PRIVATE_FEEDBACK_SHEET_ID", range: "A:G", fetchImpl: reads[0].fetchImpl });
  assert.ok(!JSON.stringify(out).includes("PRIVATE_FEEDBACK_SHEET_ID") && !JSON.stringify(out).includes("/ASSETS/"));
  assert.deepEqual(out.messages, [{ label: "참가 확정 안내", text: "안내" }]);
  assert.equal(out.pamphlet.name, "990 A5.png");
  const failed = await (await setup({ rows: Object.assign(new (await import("../scripts/session-store.mjs")).SessionError(404, "sheet_not_found"), {}) })).service.feedback(ID);
  assert.deepEqual([failed.responses, failed.responsesError, failed.feedbackForm.editUrl], [null, "sheet_not_found", CONFIG.feedbackForm.editUrl]);
  assert.deepEqual(await (await setup({ config: null })).service.feedback(ID), { sessionId: ID, configured: false });
});

test("benefits: manual confirmation, single use, 409 on reuse and stale versions; participants untouched", async () => {
  const { service, fake, participantsBefore } = await setup();
  assert.deepEqual(await service.benefits(ID), { schemaVersion: 1, sessionId: ID, version: 0, updatedAt: null, people: {} });
  await assert.rejects(service.updateBenefits(ID, 0, [{ type: "mark_used", participantId: "p1" }], ACTOR), (e) => e.status === 409 && e.code === "feedback_unverified");
  let b = await service.updateBenefits(ID, 0, [{ type: "verify_feedback", participantId: "p1", staff: "현장A" }], ACTOR);
  assert.deepEqual([b.version, b.people.p1.state, b.people.p1.verifiedBy], [1, "available", "현장A"]);
  b = await service.updateBenefits(ID, 1, [{ type: "mark_used", participantId: "p1", staff: "매장B" }], ACTOR);
  assert.deepEqual([b.people.p1.state, b.people.p1.usedBy, b.people.p1.recordedAfterExpiry], ["used", "매장B", true], "use after 09-20 is recorded as a restoration");
  await assert.rejects(service.updateBenefits(ID, 2, [{ type: "mark_used", participantId: "p1" }], ACTOR), (e) => e.status === 409 && e.code === "benefit_already_used");
  await assert.rejects(service.updateBenefits(ID, 1, [{ type: "verify_feedback", participantId: "p3" }], ACTOR), (e) => e.status === 409 && e.code === "version_conflict");
  await assert.rejects(service.updateBenefits(ID, 2, [{ type: "verify_feedback", participantId: "p2" }], ACTOR), (e) => e.code === "not_confirmed");
  await assert.rejects(service.updateBenefits(ID, 2, [{ type: "verify_feedback", participantId: "nobody" }], ACTOR), (e) => e.status === 404);
  await assert.rejects(service.updateBenefits(ID, 2, [{ type: "grant_all", participantId: "p3" }], ACTOR), (e) => e.status === 400);
  await assert.rejects(service.updateBenefits(ID, 2, [{ type: "unverify_feedback", participantId: "p1" }], ACTOR), (e) => e.code === "benefit_already_used");
  b = await service.updateBenefits(ID, 2, [{ type: "undo_used", participantId: "p1" }], ACTOR);
  assert.equal(b.people.p1.state, "available");
  const stored = fake.json(sessionPath(ID, "benefits.json"));
  assert.deepEqual(stored.log.map((l) => [l.op, l.participantId]), [["verify_feedback", "p1"], ["mark_used", "p1"], ["undo_used", "p1"]]);
  assert.ok(!JSON.stringify(stored).includes("테스트"), "no participant names in benefits.json");
  assert.equal(fake.files.get(sessionPath(ID, "participants.json")).text, participantsBefore, "participants.json never changes");
  assert.ok(!fake.files.has(sessionPath(ID, "feedback.json")) || fake.files.get(sessionPath(ID, "feedback.json")).rev === "seed-feedback.json", "feedback.json is never written");
});

test("benefits: a concurrent writer between read and upload is a 409, not an overwrite", async () => {
  const { service, fake } = await setup();
  await service.updateBenefits(ID, 0, [{ type: "verify_feedback", participantId: "p1" }], ACTOR);
  const original = fake.fetchImpl;
  fake.fetchImpl = async (url, init) => {
    if (url.endsWith("/files/upload")) fake.touch(sessionPath(ID, "benefits.json"), (d) => { d.version = 9; });
    return original(url, init);
  };
  await assert.rejects(service.updateBenefits(ID, 1, [{ type: "mark_used", participantId: "p1" }], ACTOR), (e) => e.status === 409);
  fake.fetchImpl = original;
  assert.equal(fake.json(sessionPath(ID, "benefits.json")).people.p1.state, "available");
});

test("pamphlet: only the configured file, checked inside the session's asset folder", async () => {
  const { service } = await setup();
  await assert.rejects(service.pamphletLink(ID), (e) => e.status === 404, "no asset folder for the test session -> refused, never an arbitrary path");
  await assert.rejects((await setup({ config: { ...CONFIG, pamphlet: null } })).service.pamphletLink(ID), (e) => e.code === "pamphlet_not_set");
});

test('FORM reads project links before legacy settings without touching participants or feedback settings',async()=>{
 const {fake,service}=await setup();
 const links={responderUrl:'https://docs.google.com/forms/d/e/NEW/viewform',editUrl:'https://docs.google.com/forms/d/NEW/edit',sheetUrl:'https://docs.google.com/spreadsheets/d/NEW/edit'};
 const source=fake.files.get(sessionPath(ID));const doc=JSON.parse(source.text);doc.applicationForm=links;source.text=JSON.stringify(doc);
 const before=[...fake.files.entries()].map(([path,file])=>[path,file.text]);
 const result=await service.feedback(ID);assert.deepEqual({...result.applicationForm,responderCheck:undefined},{...links,responderCheck:undefined});
 assert.deepEqual([...fake.files.entries()].map(([path,file])=>[path,file.text]),before);
});
