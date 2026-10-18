// POPUP DIRECTOR project rules shared by the ChatGPT MCP (scripts/popup-mcp.mjs).
// Pure functions only: no Dropbox, no clock (callers pass `now`), so every rule is unit tested.
// popup.json stays the same document the local app and the VIEW-ONLY web app read; this module
// only adds optional fields (status, brand, venue, scheduleTentative, deleted, trash, changeLog,
// task priority/doneAt/history, note createdAt/updatedAt). Unknown fields are always preserved.
import { randomUUID } from "node:crypto";

export const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ENDED", "ARCHIVED"];
export const TASK_GROUPS = ["기획", "VMD", "상품", "콘텐츠", "홍보", "운영", "사후", "기타"];
export const TASK_PRIORITIES = ["high", "normal", "low"];
export const ASSET_STATUSES = ["미제작", "제작 중", "검수 중", "완료"];
export const REPORT_STATUSES = ["draft", "final"];
export const PROJECT_SUBFOLDERS = ["ASSETS", "ASSETS/POSTER", "ASSETS/VIDEO", "ASSETS/VMD", "ASSETS/LOGISTICS", "REPORT"];
const CHANGELOG_MAX = 200;
const TRASH_MAX = 100;
const TASK_HISTORY_MAX = 20;
const PRESS_PRIVATE_FIELDS = ["contact", "address"];

// Same as POPUP_DIRECTOR_LITE 3 app.js `template` / makeTask / makeAsset (the local "새 팝업").
const DEFAULT_TASKS = [[-10, "브랜드 미팅 및 판매 조건 협의", "기획"], [-9, "VMD 및 비용 분담 확정", "VMD"], [-7, "상품 리스트·가격·재고 확정", "상품"],
  [-7, "메인 포스터 및 SNS 홍보물 준비", "콘텐츠"], [-5, "프로모션 및 모객 계획 확정", "홍보"], [-3, "광고·SNS 소재 검수 및 게시", "홍보"],
  [-2, "운영 인력·POS·촬영 계획 점검", "운영"], [-1, "설치 및 최종 점검", "VMD"], [0, "팝업 오픈", "운영"], [2, "결과 정리 및 정산", "사후"]];
const DEFAULT_ASSETS = ["MAIN POSTER", "TEASER VIDEO", "SNS / AD CREATIVE"];
export const TEMPLATES = ["default", "empty"];

export class PopupError extends Error {
  constructor(status, code, message = code, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const bad = (message, code = "invalid_arguments") => new PopupError(400, code, message);

export function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export const addDays = (date, n) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const kstToday = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

// A project name is also its PROJECTS/<name> Dropbox folder, so it must be a safe single path segment.
export function validateProjectName(value) {
  if (typeof value !== "string") throw bad("name is required");
  const name = value.normalize("NFC").trim();
  if (!name || name.length > 80) throw bad("name must be 1-80 characters");
  if (/[\/\\:*?"<>|\u0000-\u001f\u007f]/.test(name) || name.startsWith(".") || name.startsWith("_")) {
    throw bad("name cannot contain / \\ : * ? \" < > | or start with . or _");
  }
  return name;
}
export const sameName = (a, b) => String(a || "").normalize("NFC").toLowerCase() === String(b || "").normalize("NFC").toLowerCase();

const text = (value, field, max = 2000) => {
  if (typeof value !== "string") throw bad(`${field} must be a string`);
  if (value.length > max) throw bad(`${field} must be at most ${max} characters`);
  return value;
};
const optionalText = (value, field, max) => (value === null ? null : text(value, field, max));
const oneOf = (value, list, field) => { if (!list.includes(value)) throw bad(`${field} must be one of ${list.join(", ")}`); return value; };
const dateOrEmpty = (value, field) => {
  if (value === null || value === "") return "";
  if (!isDate(value)) throw bad(`${field} must be YYYY-MM-DD`);
  return value;
};
const bool = (value, field) => { if (typeof value !== "boolean") throw bad(`${field} must be true or false`); return value; };
function only(obj, allowed, field) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw bad(`${field} must be an object`);
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length) throw bad(`${field}: unknown field ${unknown.join(", ")}`);
  return obj;
}

// Status shown to ChatGPT: the stored one, or derived from the dates for older projects (SOC) without one.
export function effectiveStatus(project, today) {
  if (PROJECT_STATUSES.includes(project.status)) return { status: project.status, statusSource: "stored" };
  const derived = project.end && today > project.end ? "ENDED" : project.start && today >= project.start ? "ACTIVE" : "PLANNING";
  return { status: derived, statusSource: "derived_from_dates" };
}

export function progressOf(project, today) {
  const tasks = Array.isArray(project.tasks) ? project.tasks : [];
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    requiredOpen: tasks.filter((t) => !t.done && t.required).length,
    overdue: tasks.filter((t) => !t.done && t.date && t.date < today).length };
}

export function projectSummary(project, { folderName, today }) {
  return { id: project.id ?? null, name: project.name ?? folderName, folder: folderName, start: project.start ?? null, end: project.end ?? null,
    ...effectiveStatus(project, today), brand: project.brand ?? null, venue: project.venue ?? null, scheduleTentative: project.scheduleTentative === true,
    progress: progressOf(project, today), assets: Array.isArray(project.assets) ? project.assets.length : 0,
    notes: Array.isArray(project.notes) ? project.notes.length : 0, report: project.report ? (project.report.status || "final") : null,
    deleted: project.deleted ? { at: project.deleted.at } : null, version: project.version ?? null, updatedAt: project.updatedAt ?? null };
}

// PRESS LIST contact/address never leave the server through ChatGPT (same rule as the VIEW-ONLY web app).
export function redactProject(project) {
  const copy = structuredClone(project);
  const press = copy.integrations?.pressList;
  if (press && typeof press === "object") {
    for (const item of press.list || []) if (item && typeof item === "object") for (const f of PRESS_PRIVATE_FIELDS) delete item[f];
    for (const op of Object.values(press.operations || {})) if (op?.overrides && typeof op.overrides === "object") for (const f of PRESS_PRIVATE_FIELDS) delete op.overrides[f];
  }
  if (Array.isArray(copy.changeLog)) copy.changeLog = copy.changeLog.slice(-20);
  return copy;
}

export function newProject(args, { now, actor, opId }) {
  only(args, ["name", "start", "end", "brand", "venue", "status", "scheduleTentative", "template", "note", "opId"], "arguments");
  const name = validateProjectName(args.name);
  if (!isDate(args.start) || !isDate(args.end)) throw bad("start and end must be YYYY-MM-DD");
  if (args.end < args.start) throw bad("end cannot be before start");
  const status = args.status === undefined ? "PLANNING" : oneOf(args.status, PROJECT_STATUSES.filter((s) => s !== "ARCHIVED"), "status");
  const template = args.template === undefined ? "default" : oneOf(args.template, TEMPLATES, "template");
  const at = now.toISOString();
  const project = { id: randomUUID(), name, start: args.start, end: args.end, status,
    brand: args.brand === undefined ? null : optionalText(args.brand, "brand", 200),
    venue: args.venue === undefined ? null : optionalText(args.venue, "venue", 300),
    scheduleTentative: args.scheduleTentative === undefined ? false : bool(args.scheduleTentative, "scheduleTentative"),
    tasks: template === "default" ? DEFAULT_TASKS.map(([offset, title, group]) => makeTask({ date: addDays(args.start, offset), title, group })) : [],
    assets: template === "default" ? DEFAULT_ASSETS.map((n) => makeAsset({ name: n })) : [],
    notes: [], updatedAt: at, version: 1,
    changeLog: [{ at, by: actor, op: "create", summary: `created (${template} template)`, opId, version: 1 }] };
  if (args.note !== undefined) {
    only(args.note, ["date", "title", "body"], "note");
    project.notes.push(makeNote(args.note, at));
  }
  return project;
}

function makeTask(t) {
  return { id: randomUUID(), date: t.date || "", title: t.title, group: t.group || "기획", required: t.required ?? true, done: false, owner: t.owner || "", memo: t.memo || "",
    ...(t.priority ? { priority: t.priority } : {}) };
}
function makeAsset(a) { return { id: randomUUID(), name: a.name, url: a.url || "", status: a.status || "미제작", sns: a.sns ?? false, ad: a.ad ?? false, ...(a.memo ? { memo: a.memo } : {}), ...(a.files ? { files: a.files } : {}) }; }
function makeNote(n, at) {
  if (!n.title) throw bad("note.title is required");
  return { id: randomUUID(), date: dateOrEmpty(n.date ?? "", "note.date"), title: text(n.title, "note.title", 200), body: n.body === undefined ? "" : text(n.body, "note.body", 10000), createdAt: at, updatedAt: at };
}

const TASK_FIELDS = ["title", "date", "group", "owner", "priority", "required", "done", "memo"];
function cleanTask(input, field, partial) {
  only(input, TASK_FIELDS, field);
  const out = {};
  if (input.title !== undefined) { if (!String(input.title).trim()) throw bad(`${field}.title cannot be empty`); out.title = text(input.title, `${field}.title`, 200); }
  else if (!partial) throw bad(`${field}.title is required`);
  if (input.date !== undefined) out.date = dateOrEmpty(input.date, `${field}.date`);
  if (input.group !== undefined) out.group = oneOf(input.group, TASK_GROUPS, `${field}.group`);
  if (input.owner !== undefined) out.owner = text(input.owner, `${field}.owner`, 100);
  if (input.priority !== undefined) out.priority = input.priority === null ? null : oneOf(input.priority, TASK_PRIORITIES, `${field}.priority`);
  if (input.required !== undefined) out.required = bool(input.required, `${field}.required`);
  if (input.done !== undefined) out.done = bool(input.done, `${field}.done`);
  if (input.memo !== undefined) out.memo = text(input.memo, `${field}.memo`);
  return out;
}
const ASSET_FIELDS = ["name", "status", "url", "sns", "ad", "memo"];
function cleanAsset(input, field, partial) {
  only(input, ASSET_FIELDS, field);
  const out = {};
  if (input.name !== undefined) { if (!String(input.name).trim()) throw bad(`${field}.name cannot be empty`); out.name = text(input.name, `${field}.name`, 200); }
  else if (!partial) throw bad(`${field}.name is required`);
  if (input.status !== undefined) out.status = oneOf(input.status, ASSET_STATUSES, `${field}.status`);
  if (input.url !== undefined) {
    out.url = text(input.url, `${field}.url`, 2000);
    if (out.url && !/^https:\/\//.test(out.url)) throw bad(`${field}.url must start with https://`);
  }
  if (input.sns !== undefined) out.sns = bool(input.sns, `${field}.sns`);
  if (input.ad !== undefined) out.ad = bool(input.ad, `${field}.ad`);
  if (input.memo !== undefined) out.memo = text(input.memo, `${field}.memo`);
  return out;
}
// Paths are relative to the project folder (ASSETS/... or REPORT/...); the files themselves are never touched.
function cleanFile(input, field) {
  only(input, ["path", "label", "type"], field);
  const path = text(input.path, `${field}.path`, 400).normalize("NFC");
  if (!/^(ASSETS|REPORT)\//.test(path) || path.split("/").some((seg) => !seg || seg === "." || seg === "..") || path.includes("\\")) {
    throw bad(`${field}.path must be a file path inside ASSETS/ or REPORT/ of the project folder`);
  }
  return { ...(input.type !== undefined ? { type: text(input.type, `${field}.type`, 40) } : {}), label: input.label === undefined ? path.split("/").pop() : text(input.label, `${field}.label`, 200), path };
}
const NOTE_FIELDS = ["date", "title", "body"];
const REPORT_KEYS = ["status", "title", "period", "file", "headline", "findings", "nextActions", "dailyVisitors", "comparison", "logistics", "summary"];

export const PATCH_FIELDS = ["name", "start", "end", "brand", "venue", "status", "scheduleTentative"];
export const OPERATIONS = ["add_task", "update_task", "set_task_done", "delete_task", "add_asset", "update_asset", "link_asset_file", "unlink_asset_file", "delete_asset",
  "add_note", "update_note", "delete_note", "update_report", "restore_from_trash"];

function find(list, id, kind) {
  const item = (list || []).find((x) => x?.id === id);
  if (!item) throw new PopupError(404, `${kind}_not_found`, `${kind} ${id} not found; read the project again`);
  return item;
}
function trash(project, kind, item, at, by) {
  project.trash = Array.isArray(project.trash) ? project.trash : [];
  project.trash.push({ id: randomUUID(), kind, item, deletedAt: at, by });
  if (project.trash.length > TRASH_MAX) project.trash = project.trash.slice(-TRASH_MAX);
}
function setDone(task, done, at, by) {
  if (task.done === done) return false;
  task.done = done;
  if (done) task.doneAt = at; else delete task.doneAt;
  task.history = [...(Array.isArray(task.history) ? task.history : []), { at, by, done }].slice(-TASK_HISTORY_MAX);
  return true;
}

// Applies a field patch and item operations in place. Returns a list of human-readable changes.
// Anything not named in the patch or an operation is left exactly as it was.
export function applyChanges(project, { patch, operations = [] }, { now, actor }) {
  const at = now.toISOString();
  const changes = [];
  if (patch !== undefined) {
    only(patch, PATCH_FIELDS, "patch");
    if (!Object.keys(patch).length) throw bad("patch is empty");
    const next = {};
    if (patch.name !== undefined) next.name = validateProjectName(patch.name);
    for (const key of ["start", "end"]) if (patch[key] !== undefined) { if (!isDate(patch[key])) throw bad(`patch.${key} must be YYYY-MM-DD`); next[key] = patch[key]; }
    if (patch.brand !== undefined) next.brand = optionalText(patch.brand, "patch.brand", 200);
    if (patch.venue !== undefined) next.venue = optionalText(patch.venue, "patch.venue", 300);
    if (patch.scheduleTentative !== undefined) next.scheduleTentative = bool(patch.scheduleTentative, "patch.scheduleTentative");
    if (patch.status !== undefined) next.status = oneOf(patch.status, PROJECT_STATUSES, "patch.status");
    if ((next.end ?? project.end) < (next.start ?? project.start)) throw bad("end cannot be before start");
    if (next.status === "ARCHIVED" && project.status !== "ARCHIVED") project.statusBeforeArchive = effectiveStatus(project, kstToday(now)).status;
    if (next.status && next.status !== "ARCHIVED") delete project.statusBeforeArchive;
    for (const [key, value] of Object.entries(next)) {
      if (project[key] === value) continue;
      changes.push(`${key}: ${JSON.stringify(project[key] ?? null)} → ${JSON.stringify(value)}`);
      project[key] = value;
    }
  }
  if (!Array.isArray(operations)) throw bad("operations must be an array");
  for (const [index, op] of operations.entries()) {
    const field = `operations[${index}]`;
    if (!op || typeof op !== "object" || !OPERATIONS.includes(op.type)) throw bad(`${field}.type must be one of ${OPERATIONS.join(", ")}`, "invalid_operation");
    for (const key of ["tasks", "assets", "notes"]) if (!Array.isArray(project[key])) project[key] = [];
    switch (op.type) {
      case "add_task": {
        only(op, ["type", "task"], field);
        const t = cleanTask(op.task, `${field}.task`, false);
        const task = makeTask({ ...t, required: t.required ?? true, group: t.group || "기획" });
        if (t.done) setDone(task, true, at, actor);
        if (t.priority === null) delete task.priority;
        project.tasks.push(task);
        changes.push(`task added: ${task.title}`);
        break;
      }
      case "update_task": {
        only(op, ["type", "taskId", "patch"], field);
        const task = find(project.tasks, op.taskId, "task");
        const t = cleanTask(op.patch, `${field}.patch`, true);
        if (!Object.keys(t).length) throw bad(`${field}.patch is empty`);
        if (t.done !== undefined && setDone(task, t.done, at, actor)) changes.push(`task ${t.done ? "done" : "reopened"}: ${task.title}`);
        delete t.done;
        for (const [key, value] of Object.entries(t)) {
          if (value === null) { if (key in task) { delete task[key]; changes.push(`task ${task.title}: ${key} cleared`); } continue; }
          if (task[key] !== value) { changes.push(`task ${task.title}: ${key} → ${JSON.stringify(value)}`); task[key] = value; }
        }
        break;
      }
      case "set_task_done": {
        only(op, ["type", "taskId", "done"], field);
        const task = find(project.tasks, op.taskId, "task");
        if (setDone(task, bool(op.done, `${field}.done`), at, actor)) changes.push(`task ${op.done ? "done" : "reopened"}: ${task.title}`);
        break;
      }
      case "delete_task": case "delete_asset": case "delete_note": {
        const kind = op.type.slice(7), idKey = `${kind}Id`, list = project[`${kind}s`];
        only(op, ["type", idKey], field);
        const item = find(list, op[idKey], kind);
        list.splice(list.indexOf(item), 1);
        trash(project, kind, item, at, actor);
        changes.push(`${kind} moved to trash: ${item.title || item.name}`);
        break;
      }
      case "add_asset": {
        only(op, ["type", "asset"], field);
        const { files, ...fields } = op.asset && typeof op.asset === "object" ? op.asset : {};
        const asset = makeAsset(cleanAsset(fields, `${field}.asset`, false));
        if (files !== undefined) {
          if (!Array.isArray(files)) throw bad(`${field}.asset.files must be an array`);
          asset.files = files.map((f, i) => cleanFile(f, `${field}.asset.files[${i}]`));
        }
        project.assets.push(asset);
        changes.push(`asset added: ${asset.name}`);
        break;
      }
      case "update_asset": {
        only(op, ["type", "assetId", "patch"], field);
        const asset = find(project.assets, op.assetId, "asset");
        const a = cleanAsset(op.patch, `${field}.patch`, true);
        if (!Object.keys(a).length) throw bad(`${field}.patch is empty`);
        for (const [key, value] of Object.entries(a)) if (asset[key] !== value) { changes.push(`asset ${asset.name}: ${key} → ${JSON.stringify(value)}`); asset[key] = value; }
        break;
      }
      case "link_asset_file": {
        only(op, ["type", "assetId", "file"], field);
        const asset = find(project.assets, op.assetId, "asset");
        const file = cleanFile(op.file, `${field}.file`);
        asset.files = Array.isArray(asset.files) ? asset.files : [];
        if (!asset.files.some((f) => f.path === file.path)) { asset.files.push(file); changes.push(`asset ${asset.name}: linked ${file.path}`); }
        break;
      }
      case "unlink_asset_file": {
        only(op, ["type", "assetId", "path"], field);
        const asset = find(project.assets, op.assetId, "asset");
        const before = (asset.files || []).length;
        asset.files = (asset.files || []).filter((f) => f.path !== op.path);
        if (asset.files.length === before) throw new PopupError(404, "file_link_not_found", `${op.path} is not linked to ${asset.name}`);
        changes.push(`asset ${asset.name}: unlinked ${op.path} (the Dropbox file itself is kept)`);
        break;
      }
      case "add_note": {
        only(op, ["type", "note"], field);
        only(op.note, NOTE_FIELDS, `${field}.note`);
        const note = makeNote(op.note, at);
        project.notes.push(note);
        changes.push(`note added: ${note.title}`);
        break;
      }
      case "update_note": {
        only(op, ["type", "noteId", "patch"], field);
        const note = find(project.notes, op.noteId, "note");
        only(op.patch, NOTE_FIELDS, `${field}.patch`);
        if (!Object.keys(op.patch).length) throw bad(`${field}.patch is empty`);
        const next = {};
        if (op.patch.date !== undefined) next.date = dateOrEmpty(op.patch.date, `${field}.patch.date`);
        if (op.patch.title !== undefined) { if (!String(op.patch.title).trim()) throw bad(`${field}.patch.title cannot be empty`); next.title = text(op.patch.title, `${field}.patch.title`, 200); }
        if (op.patch.body !== undefined) next.body = text(op.patch.body, `${field}.patch.body`, 10000);
        let changed = false;
        for (const [key, value] of Object.entries(next)) if (note[key] !== value) { note[key] = value; changed = true; }
        if (changed) { note.updatedAt = at; changes.push(`note updated: ${note.title}`); }
        break;
      }
      case "update_report": {
        only(op, ["type", "patch"], field);
        only(op.patch, REPORT_KEYS, `${field}.patch`);
        if (!Object.keys(op.patch).length) throw bad(`${field}.patch is empty`);
        const report = project.report && typeof project.report === "object" ? project.report : (project.report = { status: "draft", title: `${project.name} POP-UP RESULT` });
        for (const [key, value] of Object.entries(op.patch)) {
          let next = value;
          if (key === "status") next = oneOf(value, REPORT_STATUSES, `${field}.patch.status`);
          else if (key === "file") next = value === null ? null : { ...cleanFile(value, `${field}.patch.file`), storage: `PROJECTS/${project.name}` };
          else if (key === "title" || key === "summary") next = text(value, `${field}.patch.${key}`, key === "title" ? 200 : 10000);
          else if (value !== null && typeof value === "object" && !Array.isArray(value) && report[key] && typeof report[key] === "object" && !Array.isArray(report[key])) {
            next = { ...report[key], ...value }; // keep existing figures the patch does not name
          }
          if (next === null) { if (key in report) { delete report[key]; changes.push(`report ${key} cleared`); } continue; }
          if (JSON.stringify(report[key]) !== JSON.stringify(next)) { report[key] = next; changes.push(`report ${key} updated`); }
        }
        if (changes.length) report.updatedAt = at;
        break;
      }
      case "restore_from_trash": {
        only(op, ["type", "trashId"], field);
        const entry = find(project.trash, op.trashId, "trash");
        const list = project[`${entry.kind}s`];
        if (list.some((x) => x.id === entry.item.id)) throw new PopupError(409, "already_restored", "this item is already in the project");
        list.push(entry.item);
        project.trash.splice(project.trash.indexOf(entry), 1);
        changes.push(`${entry.kind} restored: ${entry.item.title || entry.item.name}`);
        break;
      }
    }
  }
  return changes;
}

export function appendChangeLog(project, entry) {
  project.changeLog = [...(Array.isArray(project.changeLog) ? project.changeLog : []), entry].slice(-CHANGELOG_MAX);
}
