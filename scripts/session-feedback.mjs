// SAMPLAS SESSION feedback, pamphlet and participant benefit. Two files next to session.json:
//   feedback.json   per-session settings written by the team (forms, response sheet, pamphlet, benefit policy,
//                   message drafts). Read-only here.
//   benefits.json   per-participant benefit state the staff change (feedback confirmed -> available -> used).
// Kept apart from participants.json so feedback and benefits never touch applications, statuses or check-ins.
//
// Rules:
//   - Feedback responses are read from the response sheet (read-only) and summarised per question. They are
//     anonymous: no timestamps or row numbers leave the server, and no response is ever matched to a participant.
//   - A benefit becomes available only when a staff member confirms that participant's feedback by hand
//     (verify_feedback). Response counts never grant anything on their own.
//   - A benefit is used once: mark_used on a used benefit is refused (409). Use after the policy's last day is
//     recorded as a restoration of a past record (recordedAfterExpiry), never inferred.
//   - The log keeps operation, participant id, time and the staff name typed in; never names of participants.
import { SessionError } from "./session-store.mjs";

export const BENEFIT_SCHEMA_VERSION = 1;
export const BENEFIT_STATES = ["feedback_unverified", "available", "used"];
export const BENEFIT_OPERATIONS = ["verify_feedback", "unverify_feedback", "mark_used", "undo_used"];
const LOG_LIMIT = 500;
const bad = (message) => new SessionError(400, "invalid_request", message);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v, max) => (typeof v === "string" && v.length <= max ? v : "");
const httpsUrl = (v) => (typeof v === "string" && /^https:\/\/(docs\.google\.com|forms\.gle)\/[\w\-./?=&%]+$/.test(v) ? v : "");
const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// --- feedback.json (settings) ----------------------------------------------------------------------
export function assertFeedbackConfig(doc) {
  if (!isObject(doc) || doc.schemaVersion !== 1 || typeof doc.sessionId !== "string") throw new SessionError(500, "invalid_feedback_config", "feedback.json is not a v1 settings file");
  return doc;
}
// What a browser may see: links and policy only (the response sheet id and Dropbox path stay on the server).
export function feedbackConfigView(doc) {
  const form = (f) => ({ editUrl: httpsUrl(f?.editUrl), responderUrl: httpsUrl(f?.responderUrl), responderCheck: str(f?.responderCheck, 200), sheetUrl: httpsUrl(f?.sheetUrl) });
  const b = doc.benefit || {};
  return {
    applicationForm: form(doc.applicationForm),
    feedbackForm: { ...form(doc.feedbackForm), qrTarget: httpsUrl(doc.feedbackForm?.qrTarget), qrCheck: str(doc.feedbackForm?.qrCheck, 200) },
    pamphlet: doc.pamphlet?.path ? { name: str(doc.pamphlet.name, 200) || doc.pamphlet.path.split("/").pop(), paper: str(doc.pamphlet.paper, 10) || "A5" } : null,
    benefit: { title: str(b.title, 100), items: (Array.isArray(b.items) ? b.items : []).map((i) => str(i, 200)).filter(Boolean),
      notes: (Array.isArray(b.notes) ? b.notes : []).map((i) => str(i, 200)).filter(Boolean), validFrom: date(b.validFrom), validUntil: date(b.validUntil), singleUse: b.singleUse !== false },
    messages: (Array.isArray(doc.messages) ? doc.messages : []).filter((m) => isObject(m) && str(m.label, 60) && str(m.text, 4000)).map((m) => ({ label: m.label, text: m.text }))
  };
}

// --- responses: per-question summary of the sheet (first row = questions, first column = timestamp) ----
const SCALE = /^[1-5]$/;
export function summariseFeedback(rows, analysis = {}) {
  const header = (rows[0] || []).map((h) => String(h ?? "").trim());
  const answers = rows.slice(1).filter((r) => r.some((c, i) => i > 0 && String(c ?? "").trim()));
  const questions = header.slice(1).map((title, k) => {
    const values = answers.map((r) => String(r[k + 1] ?? "").trim()).filter(Boolean);
    const counts = values.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map());
    if (values.length && values.every((v) => SCALE.test(v))) {
      return { title, type: "scale", answered: values.length, average: Math.round((values.reduce((s, v) => s + Number(v), 0) / values.length) * 100) / 100,
        distribution: ["5", "4", "3", "2", "1"].map((v) => ({ value: v, count: counts.get(v) || 0 })) };
    }
    if (values.length && counts.size <= 6 && counts.size < values.length) {
      return { title, type: "choice", answered: values.length, distribution: [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })) };
    }
    return { title, type: "text", answered: values.length, answers: values };
  });
  // The team names which question feeds which analysis list; nothing is classified by guesswork.
  const pick = (name) => { const q = questions.find((x) => x.title === analysis[name]); return q?.type === "text" ? q.answers : []; };
  return { count: answers.length, questions, analysis: { highlights: pick("highlights"), requests: pick("requests"), nextIdeas: pick("nextIdeas") } };
}

// Feedback responses are assigned by their submission date in Asia/Seoul.
// Both boundaries are inclusive: event day through the seventh calendar day after it.
// Invalid or blank timestamps are excluded rather than attributed to the wrong SESSION.
const KST_DAY_MS = 24 * 60 * 60 * 1000;
export function feedbackWindow(eventDate, days = 7) {
  if (typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  const start = new Date(eventDate + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== eventDate) return null;
  return { from: eventDate, through: new Date(start.getTime() + days * KST_DAY_MS).toISOString().slice(0, 10) };
}
export function feedbackTimestampDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    // Google Sheets serial dates: 1899-12-30 is day zero.
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * KST_DAY_MS).toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  const m = text.match(/^(\d{4})[.\/\-]\s*(\d{1,2})[.\/\-]\s*(\d{1,2})(?:\D|$)/);
  if (m) {
    const day = `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
    return feedbackWindow(day, 0) ? day : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const dt = new Date(text);
    return Number.isNaN(dt.getTime()) ? null : feedbackTimestampDay(dt);
  }
  return null;
}
export function filterFeedbackBySessionDate(rows, eventDate, { days = 7, otherEventDates = [] } = {}) {
  const window = feedbackWindow(eventDate, days);
  if (!window || !Array.isArray(rows) || rows.length === 0) return null;
  const otherWindows = otherEventDates.filter((v) => v !== eventDate).map((v) => feedbackWindow(v, days)).filter(Boolean);
  return [rows[0], ...rows.slice(1).filter((row) => {
    const day = feedbackTimestampDay(row?.[0]);
    if (!day || day < window.from || day > window.through) return false;
    // If two event windows overlap, do not double count the same response.
    return !otherWindows.some((w) => day >= w.from && day <= w.through);
  })];
}

// --- benefits.json ------------------------------------------------------------------------------
export const emptyBenefits = (id) => ({ schemaVersion: BENEFIT_SCHEMA_VERSION, sessionId: id, version: 0, updatedAt: null, people: {}, log: [] });
export function assertBenefits(doc) {
  if (!isObject(doc) || doc.schemaVersion !== BENEFIT_SCHEMA_VERSION || !Number.isInteger(doc.version) || !isObject(doc.people) || !Array.isArray(doc.log)) {
    throw new SessionError(500, "invalid_benefits", "benefits.json is not a v1 benefit file");
  }
  return doc;
}
export const benefitsView = ({ log, ...doc }) => doc;

export function validateBenefitOperations(operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 20) throw bad("operations must be a list of 1-20 operations");
  for (const op of operations) {
    if (!isObject(op) || !BENEFIT_OPERATIONS.includes(op.type)) throw bad(`unknown operation ${isObject(op) ? op.type : ""}`.trim());
    if (typeof op.participantId !== "string" || !/^[\w-]{1,100}$/.test(op.participantId)) throw bad("participantId is required");
    if (op.staff !== undefined && (typeof op.staff !== "string" || op.staff.length > 40)) throw bad("staff must be text up to 40 characters");
  }
}

// participants: the participants.json document (only confirmed people have a benefit). validUntil: policy's last day.
export function applyBenefitOperations(current, operations, { participants, validUntil = null, actor, now = new Date().toISOString() } = {}) {
  validateBenefitOperations(operations);
  const doc = structuredClone(current);
  for (const op of operations) {
    const person = participants.people.find((p) => p.id === op.participantId);
    if (!person) throw new SessionError(404, "participant_not_found", "participant not found");
    if (person.ops.status !== "confirmed") throw new SessionError(409, "not_confirmed", "only confirmed participants have a benefit");
    const entry = doc.people[op.participantId] || { state: "feedback_unverified", verifiedAt: null, verifiedBy: "", usedAt: null, usedBy: "", recordedAfterExpiry: false };
    const staff = (op.staff || "").trim();
    if (op.type === "verify_feedback") {
      if (entry.state !== "feedback_unverified") throw new SessionError(409, "feedback_already_verified", "feedback was already confirmed");
      Object.assign(entry, { state: "available", verifiedAt: now, verifiedBy: staff });
    } else if (op.type === "unverify_feedback") {
      if (entry.state !== "available") throw new SessionError(409, entry.state === "used" ? "benefit_already_used" : "feedback_unverified", "only an unused, confirmed benefit can be reset");
      Object.assign(entry, { state: "feedback_unverified", verifiedAt: null, verifiedBy: "" });
    } else if (op.type === "mark_used") {
      if (entry.state === "used") throw new SessionError(409, "benefit_already_used", "the benefit was already used", { usedAt: entry.usedAt });
      if (entry.state !== "available") throw new SessionError(409, "feedback_unverified", "confirm the feedback first");
      Object.assign(entry, { state: "used", usedAt: now, usedBy: staff, recordedAfterExpiry: Boolean(validUntil && now.slice(0, 10) > validUntil) });
    } else if (op.type === "undo_used") {
      if (entry.state !== "used") throw new SessionError(409, "benefit_not_used", "the benefit was not used");
      Object.assign(entry, { state: "available", usedAt: null, usedBy: "", recordedAfterExpiry: false });
    }
    doc.people[op.participantId] = entry;
  }
  doc.version += 1;
  doc.updatedAt = now;
  doc.log = [...doc.log, ...operations.map((op) => ({ v: doc.version, at: now, actor: actor?.id || "", op: op.type, participantId: op.participantId, staff: (op.staff || "").trim() }))].slice(-LOG_LIMIT);
  return doc;
}
