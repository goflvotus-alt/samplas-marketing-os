// SAMPLAS SESSION participants: applications read from a Google Form's response sheet, plus the
// operating state the team adds (status, notice, check-in). Kept in its own file next to session.json:
//   /SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR/<id>/participants.json
// so names and applications never enter session.json, its change log or any ChatGPT MCP view.
//
// Privacy rules:
//   - Phone numbers and e-mail addresses stay in the Google Sheet. Only a masked form and a keyed
//     HMAC (SESSION_PARTICIPANT_HMAC_KEY) are stored; the HMAC finds duplicates without the original.
//   - The standard template refuses rows without privacy consent. Historical 001 keeps consent null;
//     its filming/interview answers never become privacy consent.
//   - The response part of a person (`response`) is replaced on every sync; the operating part
//     (`ops`) is never touched by a sync, so re-syncing never resets statuses or check-ins.
//   - Historical 001 coalesces an exact phone+Instagram identity, retaining additional responses.
//     Other duplicates and people missing from the sheet are flagged; source rows are never deleted.
//   - The log records operation, person id and time only, never names or contents.
import { createHmac, randomUUID } from "node:crypto";
import { SessionError } from "./session-store.mjs";

export const PARTICIPANT_SCHEMA_VERSION = 1;
export const DEFAULT_CAPACITY = 15;
export const STATUSES = ["applied", "confirmed", "waitlisted", "cancelled", "no_show"];
export const NOTICES = ["none", "sent", "replied"];
export const PARTICIPANT_OPERATIONS = ["set_capacity", "set_participant_form", "update_participant", "check_in", "undo_check_in"];
const LOG_LIMIT = 500;
const MIN_HMAC_KEY = 32;

// Header row of the SESSION application form template (docs: form questions in the same order).
// A sheet whose header row differs is refused, so a renamed or moved question never lands in the wrong field.
export const FORM_HEADERS = ["타임스탬프", "이름", "연락처", "Instagram ID", "이메일", "신청 동기", "게스트에게 하고 싶은 질문", "개인정보 수집·이용 동의"];
const FIELD_OF = { "타임스탬프": "submittedAt", "이름": "name", "연락처": "phone", "Instagram ID": "instagram", "이메일": "email",
  "신청 동기": "motivation", "게스트에게 하고 싶은 질문": "guestQuestion", "개인정보 수집·이용 동의": "consent" };


// The historical 001 form has no privacy-consent question. Preserve that absence;
// filming/interview answers are separate and never treated as privacy consent.
export const SESSION001_HEADERS = [
  "타임스탬프",
  "이름 / 닉네임",
  "연락처",
  "인스타 아이디",
  "2026년 9월 6일(일) 13:00–15:00 SESSION에 참석 가능하신가요?",
  "SAMPLAS를 알게 된 지 얼마나 되었나요?",
  "이번 SESSION에서 가장 궁금한 이야기는 무엇인가요?",
  "위 내용 외에도 SESSION에서 꼭 함께 이야기해보고 싶은 것이 있다면 남겨주세요.\n(SAMPLAS, 브랜드, 편집샵 운영, 패션 업계, VEIL 등\n어떤 내용이든 자유롭게 남겨주세요.)",
  "촬영 및 콘텐츠 활용 동의\nSAMPLAS SESSION 001에서는 행사 기록 및 이후 SESSION 관련 콘텐츠 제작을 위해 사진 및 영상 촬영이 진행될 예정입니다.\n촬영된 사진 및 영상에는 참가자의 얼굴, 모습, 음성 등이 포함될 수 있으며, 일부 결과물은 SAMPLAS 공식 Instagram 및 기타 SAMPLAS 관련 콘텐츠에 활용될 수 있습니다.\n아래 내용을 확인해 주세요.\nSESSION 진행 중 사진 및 영상 촬영이 진행될 수 있습니다.촬영된 사진 및 영상은 SESSION 기록 및 SAMPLAS SNS 콘텐츠 제작에 활용될 수 있습니다.콘텐츠는 편집 및 재가공되어 게시될 수 있습니다.촬영 및 콘텐츠 활용이 어려운 경우 SESSION 시작 전 스태프에게 말씀해 주세요.촬영 및 콘텐츠 활용에 동의하시나요?",
  "SESSION 종료 후 인터뷰 안내\nSESSION 종료 후 참가자 중 일부를 대상으로 약 1~2분 정도의 짧은 인터뷰를 진행할 예정입니다.\n인터뷰에서는 SESSION에 대한 간단한 소감과 다음 SESSION에서 듣고 싶은 이야기 등을 질문할 예정이며, 촬영된 인터뷰 영상은 SAMPLAS SESSION 기록 및 추후 SNS 콘텐츠에 활용될 수 있습니다.\n인터뷰 참여 여부는 SESSION 참가 여부와 관계가 없으며, 현장에서 다시 한번 참여 의사를 확인한 후 진행합니다.\n종료 후 인터뷰 참여 의향이 있으신가요?"
];
const SESSION001_FIELDS = ["submittedAt", "name", "phone", "instagram", "attendanceAvailability", "familiarity", "guestQuestion", "otherTopics", "recordingConsent", "interviewInterest"];

function parseSession001Rows(rows, env) {
  const header = rows[0].map(h => String(h ?? "").trim());
  const col = Object.fromEntries(SESSION001_HEADERS.map((h, i) => [SESSION001_FIELDS[i], header.indexOf(h)]));
  const people = [], byIdentity = new Map();
  let skippedInvalid = 0, responseCount = 0, duplicateResponses = 0;
  for (const [i, row] of rows.slice(1).entries()) {
    if (!row.some(cell => String(cell ?? "").trim())) continue;
    const get = field => String(row[col[field]] ?? "");
    const digits = phoneDigits(get("phone")), instagram = normalizeInstagram(get("instagram"));
    if (!get("name").trim() || digits.length < 9 || !get("submittedAt").trim()) { skippedInvalid++; continue; }
    responseCount++;
    const responseKey = keyed(env, "session001-response", digits + "|" + instagram);
    const existing = byIdentity.get(responseKey);
    const person = {
      responseKey, phoneKey: keyed(env, "phone", digits), emailKey: null,
      response: { submittedAt: get("submittedAt"), name: get("name"), phone: formatPhone(digits), phoneMasked: maskPhone(digits), emailMasked: "",
        instagram, motivation: "", guestQuestion: get("guestQuestion"), consent: null, sourceProfile: "session-001",
        attendanceAvailability: get("attendanceAvailability"), familiarity: get("familiarity"),
        otherTopics: get("otherTopics"), recordingConsent: get("recordingConsent"), interviewInterest: get("interviewInterest"),
        sourceRows: [i + 2], additionalResponses: [] }
    };
    if (existing) {
      const { additionalResponses, ...response } = person.response;
      existing.response.sourceRows.push(i + 2);
      existing.response.additionalResponses.push(response);
      duplicateResponses++; continue;
    }
    byIdentity.set(responseKey, person); people.push(person);
  }
  return { people, skippedNoConsent: 0, skippedInvalid, responseCount, duplicateResponses };
}

const bad = (message) => new SessionError(400, "invalid_operation", message);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => String(v ?? "").trim().slice(0, max);

export function emptyParticipants(sessionId) {
  return { schemaVersion: PARTICIPANT_SCHEMA_VERSION, sessionId, version: 0, updatedAt: null, capacity: DEFAULT_CAPACITY,
    form: { formUrl: "", sheetId: "", sheetRange: "", linkVisible: false },
    sync: { lastSuccessAt: null, lastAttemptAt: null, lastError: null, rowCount: 0, skippedNoConsent: 0, skippedInvalid: 0 },
    people: [], log: [] };
}

export function assertParticipants(doc) {
  if (!isObject(doc) || doc.schemaVersion !== PARTICIPANT_SCHEMA_VERSION || !Number.isInteger(doc.version) || !Array.isArray(doc.people) || !isObject(doc.form) || !isObject(doc.sync)) {
    throw new SessionError(500, "invalid_participants_document", "stored participants file has an unexpected shape");
  }
  return doc;
}

// --- privacy helpers -------------------------------------------------------------------------
export const hmacKeyReady = (env) => String(env.SESSION_PARTICIPANT_HMAC_KEY || "").length >= MIN_HMAC_KEY;
const keyed = (env, kind, value) => createHmac("sha256", env.SESSION_PARTICIPANT_HMAC_KEY).update(`session-participant:${kind}:${value}`).digest("base64url").slice(0, 32);
export const phoneDigits = (value) => String(value ?? "").replace(/\D/g, "").replace(/^82(?=10)/, "0");
export function maskPhone(value) {
  const d = phoneDigits(value);
  if (d.length < 8) return d ? "*".repeat(d.length) : "";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}
// The full number, for signed-in operators and staff running check-in (stored in participants.json only;
// never in session.json, logs or error messages). Re-importing fills it in for people imported before.
export function formatPhone(value) {
  const d = phoneDigits(value);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return d.startsWith("02") ? `02-${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}
export function maskEmail(value) {
  const e = String(value ?? "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1) return e ? "***" : "";
  return `${e.slice(0, Math.min(2, at))}***${e.slice(at)}`;
}
export const normalizeInstagram = (value) => String(value ?? "").trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase().slice(0, 60);

// "동의합니다" yes; "동의하지 않음", "미동의", "거부" no. Anything unclear counts as no consent.
export const consented = (value) => /동의|^예|yes|agree/i.test(value) && !/않|안\s*함|미동의|비동의|거부|^아니|\bno\b|disagree/i.test(value);

// --- sheet rows to people ----------------------------------------------------------------------
// rows: the sheet values (first row = header). Returns { people, header, skippedNoConsent, skippedInvalid } or
// throws 409 header_changed with header names only (never cell contents).
export function parseSheetRows(rows, env, { sessionId } = {}) {
  if (!hmacKeyReady(env)) throw new SessionError(503, "participants_sync_disabled", "SESSION_PARTICIPANT_HMAC_KEY is not set");
  if (!Array.isArray(rows) || !rows.length) return { people: [], skippedNoConsent: 0, skippedInvalid: 0 };
  const header = rows[0].map((h) => String(h ?? "").trim());
  if (sessionId === "session-001" && header.length === SESSION001_HEADERS.length &&
      new Set(header).size === header.length && SESSION001_HEADERS.every(h => header.includes(h))) return parseSession001Rows(rows, env);
  const missing = FORM_HEADERS.filter((h) => !header.includes(h));
  const extra = header.filter((h) => h && !FORM_HEADERS.includes(h));
  if (missing.length || extra.length) throw new SessionError(409, "header_changed", "the response sheet header does not match the SESSION form template", { missing, extra });
  const col = Object.fromEntries(header.map((h, i) => [FIELD_OF[h], i]).filter(([k]) => k));
  let skippedNoConsent = 0, skippedInvalid = 0;
  const people = [];
  for (const row of rows.slice(1)) {
    const get = (field) => String(row[col[field]] ?? "").trim();
    if (!row.some((cell) => String(cell ?? "").trim())) continue;
    if (!consented(get("consent"))) { skippedNoConsent++; continue; }
    const digits = phoneDigits(get("phone"));
    if (!get("name") || digits.length < 9 || !get("motivation") || !get("submittedAt")) { skippedInvalid++; continue; }
    const email = get("email").toLowerCase();
    people.push({
      responseKey: keyed(env, "response", `${get("submittedAt")}|${digits}`),
      phoneKey: keyed(env, "phone", digits),
      emailKey: email ? keyed(env, "email", email) : null,
      response: { submittedAt: text(get("submittedAt"), 40), name: text(get("name"), 80), phone: formatPhone(digits), phoneMasked: maskPhone(digits), emailMasked: maskEmail(email),
        instagram: normalizeInstagram(get("instagram")), motivation: text(get("motivation"), 2000), guestQuestion: text(get("guestQuestion"), 2000), consent: true }
    });
  }
  return { people, skippedNoConsent, skippedInvalid };
}

// Merges a parsed sheet into the stored people: same responseKey = same person (response replaced,
// ops kept). New rows become "applied". Rows gone from the sheet are flagged, not removed.
// Duplicates (same phone or e-mail HMAC on different responses) are flagged on every person involved.
export function mergeSync(doc, parsed, { now = new Date().toISOString() } = {}) {
  const byKey = new Map(doc.people.map((p) => [p.responseKey, p]));
  const seen = new Set();
  let added = 0, updated = 0;
  for (const row of parsed.people) {
    if (seen.has(row.responseKey)) continue;
    seen.add(row.responseKey);
    const existing = byKey.get(row.responseKey);
    if (existing) {
      if (JSON.stringify(existing.response) !== JSON.stringify(row.response) || existing.removedFromSheet) updated++;
      Object.assign(existing, { phoneKey: row.phoneKey, emailKey: row.emailKey, response: row.response, removedFromSheet: false });
    } else {
      doc.people.push({ id: randomUUID(), ...row, removedFromSheet: false, duplicateOf: [],
        ops: { status: "applied", notice: "none", memo: "", checkedInAt: null, statusChangedAt: now } });
      added++;
    }
  }
  let removed = 0;
  for (const p of doc.people) if (!seen.has(p.responseKey) && !p.removedFromSheet) { p.removedFromSheet = true; removed++; }
  flagDuplicates(doc.people);
  doc.sync = { ...doc.sync, lastSuccessAt: now, lastAttemptAt: now, lastError: null, rowCount: parsed.responseCount ?? parsed.people.length,
    ...(parsed.duplicateResponses === undefined ? {} : { duplicateResponses: parsed.duplicateResponses }),
    skippedNoConsent: parsed.skippedNoConsent, skippedInvalid: parsed.skippedInvalid };
  return { added, updated, removed };
}

export function flagDuplicates(people) {
  for (const p of people) {
    p.duplicateOf = people.filter((o) => o !== p && ((p.phoneKey && o.phoneKey === p.phoneKey) || (p.emailKey && o.emailKey === p.emailKey))).map((o) => o.id);
  }
}

// --- operations ----------------------------------------------------------------------------------
const confirmedCount = (doc, except) => doc.people.filter((p) => p !== except && p.ops.status === "confirmed").length;
const find = (doc, id) => {
  const person = doc.people.find((p) => p.id === id);
  if (!person) throw new SessionError(404, "participant_not_found", "participant not found");
  return person;
};

export function validateParticipantOperations(operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 20) throw bad("operations must be a list of 1-20 operations");
  for (const op of operations) {
    if (!isObject(op) || !PARTICIPANT_OPERATIONS.includes(op.type)) throw bad(`unknown operation ${isObject(op) ? op.type : ""}`.trim());
    if (op.type === "set_capacity" && (!Number.isInteger(op.capacity) || op.capacity < 1 || op.capacity > 500)) throw bad("capacity must be 1-500");
    if (op.type === "set_participant_form") {
      if (!isObject(op.form)) throw bad("form must be an object");
      const { formUrl, sheetId, sheetRange, linkVisible } = op.form;
      if (formUrl !== undefined && formUrl !== "" && !/^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)[\w\-./?=&]+$/.test(formUrl)) throw bad("formUrl must be a Google Forms link");
      if (sheetId !== undefined && sheetId !== "" && !/^[\w-]{20,100}$/.test(sheetId)) throw bad("sheetId must be a Google Sheets id");
      if (sheetRange !== undefined && sheetRange !== "" && !/^[^\n]{1,100}$/.test(sheetRange)) throw bad("sheetRange is too long");
      if (linkVisible !== undefined && typeof linkVisible !== "boolean") throw bad("linkVisible must be true or false");
    }
    if (["update_participant", "check_in", "undo_check_in"].includes(op.type) && (typeof op.participantId !== "string" || !op.participantId)) throw bad("participantId is required");
    if (op.type === "update_participant") {
      if (!isObject(op.patch) || !Object.keys(op.patch).length) throw bad("patch is required");
      for (const key of Object.keys(op.patch)) if (!["status", "notice", "memo"].includes(key)) throw bad(`cannot change ${key}`);
      if (op.patch.status !== undefined && !STATUSES.includes(op.patch.status)) throw bad("unknown status");
      if (op.patch.notice !== undefined && !NOTICES.includes(op.patch.notice)) throw bad("unknown notice");
      if (op.patch.memo !== undefined && (typeof op.patch.memo !== "string" || op.patch.memo.length > 1000)) throw bad("memo must be text up to 1000 characters");
    }
  }
}

// Applies to a copy. Capacity is enforced here, on the server, for every path that confirms someone.
export function applyParticipantOperations(current, operations, { actor, now = new Date().toISOString(), allowFormLink = false } = {}) {
  validateParticipantOperations(operations);
  const doc = structuredClone(current);
  for (const op of operations) {
    if (op.type === "set_capacity") {
      if (op.capacity < confirmedCount(doc)) throw new SessionError(409, "capacity_below_confirmed", `already ${confirmedCount(doc)} confirmed`, { confirmed: confirmedCount(doc) });
      doc.capacity = op.capacity;
    } else if (op.type === "set_participant_form") {
      // SESSION 001/002 never publish an application link (allowFormLink is false for them).
      if (op.form.linkVisible === true && !allowFormLink) throw new SessionError(403, "form_link_not_allowed", "this session does not publish an application link");
      doc.form = { ...doc.form, ...Object.fromEntries(Object.entries(op.form).filter(([k]) => ["formUrl", "sheetId", "sheetRange", "linkVisible"].includes(k))) };
    } else if (op.type === "update_participant") {
      const person = find(doc, op.participantId);
      if (op.patch.status === "confirmed" && person.ops.status !== "confirmed" && confirmedCount(doc, person) >= doc.capacity) {
        throw new SessionError(409, "capacity_full", `capacity ${doc.capacity} is full`, { capacity: doc.capacity, confirmed: confirmedCount(doc) });
      }
      if (op.patch.status !== undefined && op.patch.status !== person.ops.status) person.ops.statusChangedAt = now;
      Object.assign(person.ops, op.patch);
    } else if (op.type === "check_in") {
      const person = find(doc, op.participantId);
      if (person.ops.checkedInAt) throw new SessionError(409, "already_checked_in", "already checked in", { checkedInAt: person.ops.checkedInAt });
      if (person.ops.status !== "confirmed") throw new SessionError(409, "not_confirmed", "only confirmed participants can check in");
      person.ops.checkedInAt = now;
    } else if (op.type === "undo_check_in") {
      const person = find(doc, op.participantId);
      if (!person.ops.checkedInAt) throw new SessionError(409, "not_checked_in", "not checked in");
      person.ops.checkedInAt = null;
    }
  }
  doc.version += 1;
  doc.updatedAt = now;
  doc.log = [...doc.log, ...operations.map((op) => ({ v: doc.version, at: now, actor: actor?.id || "", op: op.type, participantId: op.participantId || null }))].slice(-LOG_LIMIT);
  return doc;
}

export function participantSummary(doc) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const p of doc.people) counts[p.ops.status]++;
  return { capacity: doc.capacity, total: doc.people.length, ...counts, checkedIn: doc.people.filter((p) => p.ops.checkedInAt).length,
    duplicates: doc.people.filter((p) => p.duplicateOf.length).length, removedFromSheet: doc.people.filter((p) => p.removedFromSheet).length,
    lastSyncAt: doc.sync.lastSuccessAt, syncError: doc.sync.lastError };
}

// What signed-in operators and staff get: the full phone number, never the HMAC keys (server-side matching data only).
export function participantsView(doc) {
  const { log, ...rest } = doc;
  const { importKeyId: _key, ...sync } = doc.sync;
  return { ...rest, sync, people: doc.people.map(({ phoneKey: _p, emailKey: _e, responseKey: _r, ...person }) => person), summary: participantSummary(doc) };
}
