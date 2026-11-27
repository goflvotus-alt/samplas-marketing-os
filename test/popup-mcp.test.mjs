import test from "node:test";
import assert from "node:assert/strict";
import { createPopupService } from "../scripts/popup-service.mjs";
import { popupRpc, POPUP_TOOLS } from "../scripts/popup-mcp.mjs";

const ROOT = "/SAMPLAS WORK/병구 작업/팝업 관련 자동화";
const env = { DROPBOX_APP_KEY: "k", DROPBOX_APP_SECRET: "s", DROPBOX_REFRESH_TOKEN: "r" };

// In-memory Dropbox speaking the endpoints the service uses (rev-pinned uploads, folder moves).
function fakeDropbox() {
  const nodes = new Map(); // lower path -> { tag, display, body, rev }
  let revs = 0;
  const reply = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const parent = (p) => p.slice(0, p.lastIndexOf("/"));
  const mkdirs = (p) => { for (let q = p; q && q !== ""; q = parent(q)) if (!nodes.has(q.toLowerCase())) nodes.set(q.toLowerCase(), { tag: "folder", display: q }); };
  const put = (p, body) => { mkdirs(parent(p)); const rev = `r${++revs}`; nodes.set(p.toLowerCase(), { tag: "file", display: p, body, rev }); return rev; };
  const state = { nodes, put, failNextUpload: null, uploads: 0 };
  state.fetch = async (url, init = {}) => {
    const endpoint = url.split("/2/")[1];
    if (url.includes("oauth2/token")) return reply(200, { access_token: "t" });
    if (url.includes("/api/popup/logistics-report")) return state.webReport ? reply(200, state.webReport(decodeURIComponent(url.split("project=")[1]))) : reply(404, { ok: false, error: "logistics_not_configured" });
    const arg = init.headers?.["Dropbox-API-Arg"] ? JSON.parse(init.headers["Dropbox-API-Arg"]) : JSON.parse(init.body || "{}");
    const meta = (n) => ({ ".tag": n.tag, name: n.display.split("/").pop(), path_display: n.display, ...(n.tag === "file" ? { size: n.body.length, rev: n.rev } : {}) });
    switch (endpoint) {
      case "files/list_folder": {
        const base = arg.path.toLowerCase();
        if (!nodes.has(base)) return reply(409, { error_summary: "path/not_found/", error: { ".tag": "path", path: { ".tag": "not_found" } } });
        const entries = [...nodes.entries()].filter(([k]) => k.startsWith(base + "/") && (arg.recursive || !k.slice(base.length + 1).includes("/"))).map(([, n]) => meta(n));
        return reply(200, { entries, has_more: false });
      }
      case "files/download": {
        const n = nodes.get(arg.path.toLowerCase());
        if (!n) return reply(409, { error_summary: "path/not_found/", error: { ".tag": "path", path: { ".tag": "not_found" } } });
        return new Response(n.body, { status: 200, headers: { "dropbox-api-result": JSON.stringify({ rev: n.rev }) } });
      }
      case "files/upload": {
        state.uploads++;
        if (state.beforeUpload) { const f = state.beforeUpload; state.beforeUpload = null; f(); }
        const n = nodes.get(arg.path.toLowerCase());
        if (state.failNextUpload) { const f = state.failNextUpload; state.failNextUpload = null; if (f === "lost") { put(arg.path, init.body); } throw new Error("socket hang up"); }
        if (arg.mode[".tag"] === "add" && n) return reply(409, { error_summary: "path/conflict/file/" });
        if (arg.mode[".tag"] === "update" && n?.rev !== arg.mode.update) return reply(409, { error_summary: "path/conflict/file/" });
        put(arg.path, init.body);
        return reply(200, {});
      }
      case "files/get_metadata": {
        const n = nodes.get(arg.path.toLowerCase());
        return n ? reply(200, meta(n)) : reply(409, { error_summary: "path/not_found/" });
      }
      case "files/create_folder_v2": {
        if (nodes.has(arg.path.toLowerCase())) return reply(409, { error_summary: "path/conflict/folder/" });
        mkdirs(arg.path);
        return reply(200, { metadata: meta(nodes.get(arg.path.toLowerCase())) });
      }
      case "files/move_v2": {
        const from = arg.from_path.toLowerCase(), to = arg.to_path;
        if (!nodes.has(from)) return reply(409, { error_summary: "from_lookup/not_found/" });
        if (nodes.has(to.toLowerCase())) return reply(409, { error_summary: "to/conflict/folder/" });
        mkdirs(parent(to));
        for (const [k, n] of [...nodes.entries()]) if (k === from || k.startsWith(from + "/")) {
          nodes.delete(k);
          const display = to + n.display.slice(arg.from_path.length);
          nodes.set(display.toLowerCase(), { ...n, display });
        }
        return reply(200, { metadata: meta(nodes.get(to.toLowerCase())) });
      }
      default: throw new Error("unexpected endpoint " + endpoint);
    }
  };
  return state;
}

const SOC = { id: "soc-1", name: "SUNDAY OFF CLUB", start: "2026-10-09", end: "2026-10-11", version: 90, updatedAt: "2026-10-14T11:21:09.818Z",
  tasks: [{ id: "t1", date: "2026-10-01", title: "A", group: "기획", required: true, done: true, owner: "", memo: "" }], assets: [], notes: [],
  report: { status: "final", title: "SOC RESULT", headline: { visitors: 900, popupSalesAmount: 7087400 }, file: { type: "pptx", path: "REPORT/x.pptx" } },
  integrations: { pressList: { list: [{ name: "Kim", contact: "010-1234-5678", address: "Seoul" }] } } };

function setup() {
  const db = fakeDropbox();
  db.put(`${ROOT}/PROJECTS/SUNDAY OFF CLUB/popup.json`, JSON.stringify(SOC, null, 2));
  db.put(`${ROOT}/PROJECTS/SUNDAY OFF CLUB/ASSETS/POSTER/a.png`, "png");
  const socBefore = db.nodes.get(`${ROOT}/PROJECTS/SUNDAY OFF CLUB/popup.json`.toLowerCase()).body;
  let t = Date.parse("2026-10-17T03:00:00Z");
  const service = createPopupService({ env, fetchImpl: db.fetch, now: () => new Date((t += 1000)) });
  const call = async (name, args, extraEnv = {}) => {
    const reply = await popupRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { env: { ...env, ...extraEnv }, service, actor: "chatgpt:test" });
    return reply.result.structuredContent;
  };
  const socUnchanged = () => assert.equal(db.nodes.get(`${ROOT}/PROJECTS/SUNDAY OFF CLUB/popup.json`.toLowerCase()).body, socBefore);
  return { db, call, socUnchanged };
}

test("tools/list exposes CRUD tools and keeps the three original names", async () => {
  const reply = await popupRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {});
  const names = reply.result.tools.map((t) => t.name);
  for (const n of ["listPopupProjects", "getPopupProject", "updatePopupProject", "createPopupProject", "deletePopupProject", "restorePopupProject"]) assert.ok(names.includes(n), n);
  assert.equal(POPUP_TOOLS.find((t) => t.name === "updatePopupProject").inputSchema.properties.body.type, "object");
});

test("create → list → get → partial edits → archive → trash → remove → restore, SOC untouched", async () => {
  const { db, call, socUnchanged } = setup();
  const created = await call("createPopupProject", { name: "TEST-GARAGE", start: "2026-11-20", end: "2026-11-22", scheduleTentative: true });
  assert.equal(created.ok, true); assert.equal(created.verified, true); assert.equal(created.httpStatus, 201);
  assert.equal(created.project.version, 1); assert.equal(created.project.tasks.length, 10); assert.equal(created.project.assets.length, 3);
  assert.equal(created.project.brand, null); assert.equal(created.project.venue, null); assert.equal(created.project.status, "PLANNING");
  assert.equal(created.project.tasks[0].date, "2026-11-10");
  for (const sub of ["ASSETS/POSTER", "ASSETS/VIDEO", "ASSETS/VMD", "ASSETS/LOGISTICS", "REPORT"]) assert.ok(db.nodes.has(`${ROOT}/PROJECTS/TEST-GARAGE/${sub}`.toLowerCase()), sub);

  const dup = await call("createPopupProject", { name: "test-garage", start: "2026-11-20", end: "2026-11-22" });
  assert.equal(dup.error, "already_exists"); assert.equal(dup.httpStatus, 409);

  const list = await call("listPopupProjects", {});
  const row = list.projects.find((p) => p.name === "TEST-GARAGE");
  assert.deepEqual(row.progress, { done: 0, total: 10, percent: 0, requiredOpen: 10, overdue: 0 });
  assert.equal(list.projects.find((p) => p.name === "SUNDAY OFF CLUB").status, "ENDED");

  const got = await call("getPopupProject", { name: created.project.id });
  assert.equal(got.project.name, "TEST-GARAGE");
  const [t1, t2] = got.project.tasks;

  // schedule moved, three tasks added, one done — one call, nothing else touched
  const edited = await call("updatePopupProject", { name: "TEST-GARAGE", expectedVersion: 1, patch: { start: "2026-11-27", end: "2026-11-29" },
    operations: [{ type: "add_task", task: { title: "미팅 1", group: "기획", priority: "high" } }, { type: "add_task", task: { title: "미팅 2" } },
      { type: "add_task", task: { title: "미팅 3" } }, { type: "set_task_done", taskId: t1.id, done: true }] });
  assert.equal(edited.verified, true); assert.equal(edited.version, 2);
  assert.equal(edited.project.tasks.length, 13); assert.equal(edited.project.tasks[0].done, true); assert.ok(edited.project.tasks[0].doneAt);
  assert.deepEqual(edited.project.tasks[1], t2);
  assert.equal(edited.project.start, "2026-11-27");

  const stale = await call("updatePopupProject", { name: "TEST-GARAGE", expectedVersion: 1, patch: { venue: "성수" } });
  assert.equal(stale.error, "version_conflict"); assert.equal(stale.currentVersion, 2);

  const del = await call("updatePopupProject", { name: "TEST-GARAGE", expectedVersion: 2, operations: [{ type: "delete_task", taskId: t2.id }] });
  assert.equal(del.project.tasks.length, 12); assert.equal(del.project.trash[0].item.id, t2.id);
  const back = await call("updatePopupProject", { name: "TEST-GARAGE", expectedVersion: 3, operations: [{ type: "restore_from_trash", trashId: del.project.trash[0].id }] });
  assert.ok(back.project.tasks.some((t) => t.id === t2.id)); assert.equal(back.project.trash.length, 0);

  const archived = await call("updatePopupProject", { name: "TEST-GARAGE", expectedVersion: 4, patch: { status: "ARCHIVED" } });
  assert.equal(archived.project.status, "ARCHIVED");
  const unarchived = await call("restorePopupProject", { name: "TEST-GARAGE", expectedVersion: 5 });
  assert.equal(unarchived.project.status, "PLANNING");

  const trashed = await call("deletePopupProject", { name: "TEST-GARAGE", expectedVersion: 6 });
  assert.equal(trashed.verified, true);
  assert.ok(!(await call("listPopupProjects", {})).projects.some((p) => p.name === "TEST-GARAGE"));
  assert.ok((await call("listPopupProjects", { includeDeleted: true })).projects.some((p) => p.name === "TEST-GARAGE"));

  const noConfirm = await call("deletePopupProject", { name: "TEST-GARAGE", expectedVersion: 7, mode: "remove" });
  assert.equal(noConfirm.error, "confirmation_required");
  const removed = await call("deletePopupProject", { name: "TEST-GARAGE", expectedVersion: 7, mode: "remove", confirmName: "TEST-GARAGE" });
  assert.equal(removed.ok, true); assert.match(removed.removedPath, /^_DELETED\/PROJECTS\/TEST-GARAGE__/);
  assert.ok(!db.nodes.has(`${ROOT}/PROJECTS/TEST-GARAGE`.toLowerCase()));
  assert.ok([...db.nodes.keys()].some((k) => k.includes("_deleted/projects/test-garage__") && k.endsWith("assets/poster")), "files kept");
  assert.equal((await call("listPopupProjects", { includeRemoved: true })).removed[0].name, "TEST-GARAGE");

  const restored = await call("restorePopupProject", { name: "TEST-GARAGE" });
  assert.equal(restored.verified, true); assert.equal(restored.project.deleted, undefined); assert.equal(restored.project.removed, undefined);
  assert.ok((await call("listPopupProjects", {})).projects.some((p) => p.name === "TEST-GARAGE"));
  socUnchanged();
});

test("report patch keeps existing figures; press contact/address never returned", async () => {
  const { call } = setup();
  const got = await call("getPopupProject", { name: "SUNDAY OFF CLUB" });
  assert.equal(got.project.integrations.pressList.list[0].contact, undefined);
  assert.equal(got.project.integrations.pressList.list[0].address, undefined);
  assert.equal(got.project.report.headline.popupSalesAmount, 7087400);
  assert.deepEqual(got.project.storage.files, [{ path: "ASSETS/POSTER/a.png", size: 3 }]);
  const r = await call("updatePopupProject", { name: "SUNDAY OFF CLUB", expectedVersion: 90, operations: [{ type: "update_report", patch: { headline: { visitors: 901 } } }] }, { POPUP_MCP_WRITES: "test-only" });
  assert.equal(r.error, "mcp_writes_disabled");
  const ok = await call("updatePopupProject", { name: "SUNDAY OFF CLUB", expectedVersion: 90, operations: [{ type: "update_report", patch: { headline: { visitors: 901 }, status: "draft" } }] });
  assert.deepEqual(ok.project.report.headline, { visitors: 901, popupSalesAmount: 7087400 });
  assert.equal(ok.project.report.file.path, "REPORT/x.pptx");
});

test("legacy body only replaces lists, so redacted press data survives a round trip", async () => {
  const { db, call } = setup();
  const got = await call("getPopupProject", { name: "SUNDAY OFF CLUB", includeFiles: false });
  const project = { ...got.project, notes: [{ id: "n1", date: "", title: "x", body: "" }] };
  const r = await call("updatePopupProject", { name: "SUNDAY OFF CLUB", body: { project, expectedVersion: 90 } });
  assert.equal(r.verified, true);
  const stored = JSON.parse(db.nodes.get(`${ROOT}/PROJECTS/SUNDAY OFF CLUB/popup.json`.toLowerCase()).body);
  assert.equal(stored.integrations.pressList.list[0].contact, "010-1234-5678");
  assert.equal(stored.notes.length, 1); assert.equal(stored.version, 91); assert.equal(stored.storage, undefined);
});

test("lost upload response is settled by read-back, never re-sent; a failed rename is rolled back", async () => {
  const { db, call } = setup();
  await call("createPopupProject", { name: "TEST-NET", start: "2026-12-01", end: "2026-12-02", template: "empty" });
  db.failNextUpload = "lost";
  const before = db.uploads;
  const r = await call("updatePopupProject", { name: "TEST-NET", expectedVersion: 1, patch: { venue: "한남" } });
  assert.equal(r.verified, true); assert.equal(r.version, 2); assert.equal(db.uploads, before + 1);

  db.failNextUpload = "drop";
  const lost = await call("updatePopupProject", { name: "TEST-NET", expectedVersion: 2, patch: { name: "TEST-NET2" } });
  assert.equal(lost.error, "write_unconfirmed");
  assert.ok(db.nodes.has(`${ROOT}/PROJECTS/TEST-NET/popup.json`.toLowerCase()), "folder renamed back");

  const renamed = await call("updatePopupProject", { name: "TEST-NET", expectedVersion: 2, patch: { name: "TEST-NET2" } });
  assert.equal(renamed.project.name, "TEST-NET2");
  assert.ok(db.nodes.has(`${ROOT}/PROJECTS/TEST-NET2/popup.json`.toLowerCase()));
});

test("same opId is applied once", async () => {
  const { call } = setup();
  await call("createPopupProject", { name: "TEST-OP", start: "2026-12-01", end: "2026-12-02", template: "empty" });
  const args = { name: "TEST-OP", expectedVersion: 1, operations: [{ type: "add_note", note: { title: "회의" } }], opId: "op-12345678" };
  const first = await call("updatePopupProject", args);
  const again = await call("updatePopupProject", args);
  assert.equal(first.version, 2); assert.equal(again.replayed, true); assert.equal(again.project.notes.length, 1);
});

test("bad input is refused before any write", async () => {
  const { db, call } = setup();
  const before = db.uploads;
  for (const args of [{ name: "../x", start: "2026-11-20", end: "2026-11-22" }, { name: "A", start: "2026-11-22", end: "2026-11-20" }, { name: "A", start: "2026-13-01", end: "2026-13-02" }]) {
    assert.equal((await call("createPopupProject", args)).httpStatus, 400);
  }
  assert.equal((await call("updatePopupProject", { name: "SUNDAY OFF CLUB", expectedVersion: 90, operations: [{ type: "add_task", task: { title: "x", group: "없음" } }] })).httpStatus, 400);
  assert.equal(db.uploads, before);
});

// STAFF BOARD tools. AE has no stored board yet (the web app then shows the default pool).
const AE = { id: "ae-1", name: "TEST-AE", start: "2026-11-06", end: "2026-11-08", version: 9, updatedAt: "2026-10-26T08:43:14.518Z",
  tasks: [{ id: "a1", date: "2026-10-30", title: "VMD 그래픽 전달", group: "VMD", required: true, done: false, owner: "", memo: "" }],
  assets: [], notes: [{ id: "n1", date: "2026-10-26", title: "회의", body: "행거" }], changeLog: [{ at: "2026-10-26T08:43:14.518Z", by: "chatgpt:x", op: "update", changes: ["note added: 회의"], version: 9 }] };
const AE_TABLE = {
  "2026-11-06": { "본점": ["민준", "병구", "명석", "애림", "준희"], VEIL: ["우혁"] },
  "2026-11-07": { "본점": ["민준", "병구", "윤재", "영은", "준희"], VEIL: ["우혁"] },
  "2026-11-08": { "본점": ["병구", "윤재", "준희"], VEIL: ["우혁"] } };
function staffSetup(ae = AE) {
  const s = setup();
  s.db.put(`${ROOT}/PROJECTS/TEST-AE/popup.json`, JSON.stringify(ae, null, 2));
  s.stored = () => JSON.parse(s.db.nodes.get(`${ROOT}/PROJECTS/TEST-AE/popup.json`.toLowerCase()).body);
  return s;
}

test("tools/list exposes getPopupStaffBoard (read) and updatePopupStaffBoard (write)", async () => {
  const tools = (await popupRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {})).result.tools;
  const get = tools.find((t) => t.name === "getPopupStaffBoard"), put = tools.find((t) => t.name === "updatePopupStaffBoard");
  assert.equal(get.annotations.readOnlyHint, true); assert.deepEqual(get.inputSchema.required, ["name"]);
  assert.equal(put.annotations.readOnlyHint, false); assert.deepEqual(put.inputSchema.required, ["name", "expectedVersion", "assignments"]);
  assert.deepEqual(Object.keys(put.inputSchema.properties.assignments.additionalProperties.properties).sort(), ["VEIL", "본점"].sort());
});

test("AE table: read, save, read back exactly; pool gains new names; nothing else changes", async () => {
  const { db, call, stored, socUnchanged } = staffSetup();
  const before = await call("getPopupStaffBoard", { name: "TEST-AE" });
  assert.equal(before.ok, true); assert.equal(before.version, 9); assert.equal(before.staffBoard.stored, false);
  assert.deepEqual(before.staffBoard.pool, ["민준", "병구", "우혁", "윤재", "준희", "애림", "민철"]); assert.deepEqual(before.staffBoard.assignments, {});

  const saved = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 9, assignments: AE_TABLE });
  assert.equal(saved.ok, true); assert.equal(saved.verified, true); assert.equal(saved.version, 10);
  assert.deepEqual(saved.poolAdded, ["명석", "영은"]);
  assert.ok(saved.changed.includes("staff 2026-11-06 본점: - → 민준, 병구, 명석, 애림, 준희"));

  const after = await call("getPopupStaffBoard", { name: "TEST-AE" });
  assert.equal(after.staffBoard.stored, true); assert.equal(after.version, 10);
  for (const [date, day] of Object.entries(AE_TABLE)) for (const site of ["본점", "VEIL"]) assert.deepEqual(after.staffBoard.assignments[date][site], day[site], `${date} ${site}`);
  assert.deepEqual(Object.keys(after.staffBoard.assignments), Object.keys(AE_TABLE));
  assert.deepEqual(after.staffBoard.pool, ["민준", "병구", "우혁", "윤재", "준희", "애림", "민철", "명석", "영은"]);

  const doc = stored();
  for (const key of Object.keys(AE)) if (!["version", "updatedAt", "changeLog"].includes(key)) assert.deepEqual(doc[key], AE[key], key);
  assert.deepEqual(doc.changeLog.slice(0, 1), AE.changeLog);
  assert.equal(doc.changeLog.at(-1).op, "update_staff_board"); assert.equal(doc.changeLog.at(-1).by, "chatgpt:test");
  // web app shape: both sites on every stored date
  assert.deepEqual(Object.keys(doc.staffBoard.assignments["2026-11-08"]), ["VEIL", "본점"]);
  socUnchanged();

  // same table again: nothing to write
  const again = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 10, assignments: AE_TABLE });
  assert.equal(again.unchanged, true); assert.equal(again.version, 10);
});

test("only the dates and sites named change; other dates are kept; an empty list clears a site", async () => {
  const board = { pool: ["민준", "병구", "우혁"], assignments: { "2026-11-01": { VEIL: ["민준"], "본점": ["병구"] }, "2026-11-06": { VEIL: ["우혁"], "본점": ["민준"] } } };
  const { call, stored } = staffSetup({ ...AE, staffBoard: board });
  const r = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 9, assignments: { "2026-11-06": { "본점": ["병구", "민준"] } } });
  assert.equal(r.verified, true);
  const doc = stored().staffBoard;
  assert.deepEqual(doc.assignments["2026-11-01"], board.assignments["2026-11-01"]);
  assert.deepEqual(doc.assignments["2026-11-06"], { VEIL: ["우혁"], "본점": ["병구", "민준"] });
  assert.deepEqual(r.poolAdded, []);
  const cleared = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 10, assignments: { "2026-11-01": { VEIL: [], "본점": [] } } });
  assert.equal(cleared.verified, true); assert.equal(stored().staffBoard.assignments["2026-11-01"], undefined);
  assert.deepEqual(stored().staffBoard.assignments["2026-11-06"], { VEIL: ["우혁"], "본점": ["병구", "민준"] });
});

test("duplicates, bad input and disabled writes are refused before any upload", async () => {
  const { db, call } = staffSetup();
  const uploads = db.uploads;
  const dup = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 9, assignments: { "2026-11-06": { "본점": ["민준", "병구"], VEIL: ["민준"] } } });
  assert.equal(dup.error, "duplicate_staff_assignment"); assert.equal(dup.httpStatus, 400); assert.equal(dup.staff, "민준");
  const twiceSameSite = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 9, assignments: { "2026-11-06": { VEIL: ["우혁", "우혁"] } } });
  assert.equal(twiceSameSite.error, "duplicate_staff_assignment");
  for (const assignments of [{ "2026-13-01": { VEIL: ["a"] } }, { "2026-11-06": { "성수": ["a"] } }, { "2026-11-06": { VEIL: "민준" } }, { "2026-11-06": { VEIL: [""] } }, { "2026-11-06": null }, {}]) {
    const r = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 9, assignments });
    assert.equal(r.httpStatus, 400, JSON.stringify(assignments));
  }
  const off = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 9, assignments: AE_TABLE }, { POPUP_MCP_WRITES: "off" });
  assert.equal(off.error, "mcp_writes_disabled");
  assert.equal(db.uploads, uploads);
});

test("stale version and a concurrent save both answer 409; the newer data is never overwritten", async () => {
  const { db, call, stored } = staffSetup();
  const stale = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 8, assignments: AE_TABLE });
  assert.equal(stale.error, "version_conflict"); assert.equal(stale.currentVersion, 9);
  // Someone (e.g. the web app) saves between our read and our upload.
  db.beforeUpload = () => db.put(`${ROOT}/PROJECTS/TEST-AE/popup.json`, JSON.stringify({ ...AE, version: 10, notes: [...AE.notes, { id: "n2", title: "web" }] }));
  const raced = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 9, assignments: AE_TABLE });
  assert.equal(raced.error, "version_conflict"); assert.equal(raced.httpStatus, 409); assert.equal(raced.currentVersion, 10);
  assert.equal(stored().version, 10); assert.equal(stored().notes.length, 2); assert.equal(stored().staffBoard, undefined);
});

test("updatePopupStaffBoard with the same opId is applied once", async () => {
  const { call } = staffSetup();
  const first = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 9, assignments: AE_TABLE, opId: "staff-ae-1106-08" });
  const retry = await call("updatePopupStaffBoard", { name: "TEST-AE", expectedVersion: 9, assignments: AE_TABLE, opId: "staff-ae-1106-08" });
  assert.equal(first.version, 10); assert.equal(retry.replayed, true); assert.equal(retry.version, 10);
});

// --- Full POPUP DIRECTOR operations: settlement, LOGISTICS, DAY REPORT → FINAL REPORT, VMD, PRESS ---
const AE_FIXTURE = { id: "ae-1", name: "TEST-AE", start: "2026-11-06", end: "2026-11-08", version: 47, tasks: [], assets: [], notes: [],
  expenses: { currency: "KRW", items: [{ id: "e1", date: "2026-11-06", category: "인건비", title: "x", amount: 1000 }], total: 1000 },
  report: { status: "final", title: "AE", summary: "keep", headline: { managerRevenueTarget: 20000000, commissionAmount: 4508000 }, findings: ["keep"] },
  logistics: { salesStore: "APGUJEONG", sources: [], commissionPolicy: { mode: "UNCONFIRMED", rate: null },
    salesCodeRules: [{ prefix: "pop", type: "CONSIGNMENT" }, { prefix: "aey263", type: "SAMPLAS_OWNED", ledger: false }],
    salesFile: { path: "REPORT/old.xlsx", coverageEnd: "2026-11-07" } },
  integrations: { pressList: { list: [{ id: "p1", instagram: "@kim", contact: "010-0000-0000", address: "Seoul" }] } } };
const FIGURES = { headline: { popupSalesAmount: 23984000, transactionCount: 132, commissionRate: 0.2, commissionAmount: 4508000, contributionBeforeOwnedCostAndTax: 5227454, ownedGoodsCost: null, finalNetProfit: null },
  dailySales: [{ date: "2026-11-06", popupSalesAmount: 12784000, commissionAmount: 2394000 }, { date: "2026-11-07", popupSalesAmount: 9150000, commissionAmount: 1704000 }, { date: "2026-11-08", popupSalesAmount: 2050000, commissionAmount: 410000 }],
  dailyVisitors: [{ date: "2026-11-06", count: 146 }, { date: "2026-11-07", count: 118 }, { date: "2026-11-08", count: 51 }] };

function setupAE() {
  const ctx = setup();
  const path = `${ROOT}/PROJECTS/TEST-AE`;
  ctx.db.put(`${path}/popup.json`, JSON.stringify(AE_FIXTURE, null, 2));
  for (const f of ["REPORT/old.xlsx", "REPORT/VMC6MA2SKLJZSF8.xlsx", "ASSETS/AE_VMD_01.jpg"]) ctx.db.put(`${path}/${f}`, "x");
  const stored = () => JSON.parse(ctx.db.nodes.get(`${path}/popup.json`.toLowerCase()).body);
  // The web app computes the DAY REPORT from the stored project version.
  ctx.db.webReport = () => ({ ok: true, projectVersion: stored().version, salesError: null, days: [{ day: 1, date: "2026-11-06", salesStatus: "OK", revenue: 12784000, transactions: 70 }],
    total: { revenue: 23984000, transactions: 132 }, pnl: { commission: 4508000, contribution: 5227454, netProfit: null, provisionalCosts: [] }, finalReport: FIGURES, ledger: ["large"] });
  return { ...ctx, stored };
}

test("settlement: tiered 위탁 commission, 사입 cost unconfirmed, sales file must exist", async () => {
  const { call, stored, socUnchanged } = setupAE();
  const r = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 47, operations: [{ type: "update_logistics", patch: {
    commissionPolicy: { status: "CONFIRMED", note: "계약", rules: [{ id: "ae-contract", type: "TIERED", scope: "CONSIGNMENT", operator: "GT", application: "RETROACTIVE", baseRate: 0.2, tiers: [{ threshold: 27000000, rate: 0.15 }] }] },
    purchaseCost: { status: "UNCONFIRMED", note: "API 미제공" },
    salesCodeRules: [{ prefix: "pop", type: "CONSIGNMENT" }, { prefix: "aey263", type: "SAMPLAS_OWNED", ledger: false, settlement: "PURCHASE" }] } }] });
  assert.equal(r.verified, true); assert.equal(r.version, 48);
  assert.deepEqual(stored().logistics.commissionPolicy.rules[0], { id: "ae-contract", type: "TIERED", scope: "CONSIGNMENT", operator: "GT", application: "RETROACTIVE", baseRate: 0.2, tiers: [{ threshold: 27000000, rate: 0.15 }] });
  assert.deepEqual(stored().logistics.purchaseCost, { status: "UNCONFIRMED", amount: null, note: "API 미제공" });
  assert.equal(stored().logistics.salesStore, "APGUJEONG");

  const badRate = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "update_logistics", patch: { commissionPolicy: { mode: "PROJECT_OVERRIDE", rate: 20 } } }] });
  assert.equal(badRate.error, "invalid_arguments");
  const noCost = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "update_logistics", patch: { purchaseCost: { status: "CONFIRMED" } } }] });
  assert.equal(noCost.error, "invalid_arguments");

  const missing = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "update_logistics", patch: { salesFile: { path: "REPORT/nope.xlsx", coverageEnd: "2026-11-08" } } }] });
  assert.equal(missing.error, "file_not_found"); assert.deepEqual(missing.missing, ["REPORT/nope.xlsx"]);
  assert.equal(stored().version, 48);
  const file = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "update_logistics", patch: { salesFile: { path: "REPORT/VMC6MA2SKLJZSF8.xlsx", coverageEnd: "2026-11-08" } } }] });
  assert.equal(file.verified, true); assert.equal(stored().logistics.salesFile.path, "REPORT/VMC6MA2SKLJZSF8.xlsx");

  const src = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 49, operations: [{ type: "upsert_logistics_source", source: { id: "owned-1", label: "사입", path: "REPORT/old.xlsx", type: "SAMPLAS_OWNED", settlement: "PURCHASE", costRate: 0.45 } }] });
  assert.equal(src.verified, true); assert.equal(stored().logistics.sources[0].costRate, 0.45);
  const stale = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 49, operations: [{ type: "set_visitor_counts", counts: { "2026-11-06": { count: 1 } } }] });
  assert.equal(stale.error, "version_conflict");
  socUnchanged();
});

test("DAY REPORT: visitors, read, then FINAL REPORT sync with version check and re-read", async () => {
  const { call, stored, socUnchanged } = setupAE();
  const outside = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 47, operations: [{ type: "set_visitor_counts", counts: { "2026-11-09": { count: 5 } } }] });
  assert.equal(outside.error, "invalid_arguments");
  const v = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 47, operations: [{ type: "set_visitor_counts", counts: {
    "2026-11-06": { count: 146, source: "report.dailyVisitors" }, "2026-11-07": { count: 118, source: "report.dailyVisitors" }, "2026-11-08": { count: 51, source: "report.dailyVisitors" } } }] });
  assert.equal(v.verified, true);
  assert.deepEqual(stored().visitorCounts["2026-11-08"], { count: 51, status: "final", source: "report.dailyVisitors" });

  const day = await call("getPopupDayReport", { name: "TEST-AE" });
  assert.equal(day.ok, true); assert.equal(day.stale, false); assert.equal(day.dayReport.total.transactions, 132);
  assert.equal(day.dayReport.ledger, undefined); assert.equal(day.dayReport.pnl.provisionalCosts, undefined);

  const wrongVersion = await call("syncPopupFinalReport", { name: "TEST-AE", expectedVersion: 47 });
  assert.equal(wrongVersion.error, "day_report_stale");
  const locked = await call("syncPopupFinalReport", { name: "TEST-AE", expectedVersion: 48 });
  assert.equal(locked.error, "report_final"); assert.equal(stored().version, 48);
  const synced = await call("syncPopupFinalReport", { name: "TEST-AE", expectedVersion: 48, allowFinal: true });
  assert.equal(synced.verified, true); assert.equal(synced.version, 49); assert.equal(synced.recheck.matches, true);
  const report = stored().report;
  assert.equal(report.headline.managerRevenueTarget, 20000000); // other headline keys kept
  assert.equal(report.headline.contributionBeforeOwnedCostAndTax, 5227454); assert.equal(report.headline.finalNetProfit, null);
  assert.deepEqual(report.comparison.dailySales.map((d) => d.commissionAmount), [2394000, 1704000, 410000]);
  assert.deepEqual(report.dailyVisitors.map((d) => d.count), [146, 118, 51]);
  assert.equal(report.summary, "keep"); assert.deepEqual(report.findings, ["keep"]); assert.equal(report.status, "final");
  socUnchanged();
});

test("VMD ARCHIVE create, zone, photo link (file must exist), unlink", async () => {
  const { call, stored } = setupAE();
  const a = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 47, operations: [
    { type: "update_vmd_archive", patch: { status: "installed", finalSummary: "7 zones" } },
    { type: "upsert_vmd_zone", stage: "final", zone: { name: "ZONE 1", title: "거울 시트지", installedAt: "2026-11-05", expenseIds: ["e1"] } }] });
  assert.equal(a.verified, true);
  const zone = stored().vmdArchive.final.zones[0];
  assert.equal(zone.title, "거울 시트지"); assert.deepEqual(zone.photos, []); assert.equal(stored().vmdArchive.status, "installed");
  const badExpense = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "upsert_vmd_zone", stage: "final", zoneId: zone.id, zone: { expenseIds: ["zz"] } }] });
  assert.equal(badExpense.error, "invalid_arguments");
  const missing = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "link_vmd_photo", stage: "final", zoneId: zone.id, photo: { path: "ASSETS/none.jpg" } }] });
  assert.equal(missing.error, "file_not_found");
  const linked = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "link_vmd_photo", stage: "final", zoneId: zone.id, photo: { path: "ASSETS/AE_VMD_01.jpg", label: "① FINAL" } }] });
  assert.equal(linked.verified, true); assert.deepEqual(stored().vmdArchive.final.zones[0].photos, [{ label: "① FINAL", path: "ASSETS/AE_VMD_01.jpg" }]);
  const unlinked = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 49, operations: [{ type: "unlink_vmd_photo", stage: "final", zoneId: zone.id, path: "ASSETS/AE_VMD_01.jpg" }] });
  assert.equal(unlinked.verified, true); assert.deepEqual(stored().vmdArchive.final.zones[0].photos, []);
});

test("PRESS LIST add, duplicate, update, status check-in; contact/address kept but never returned", async () => {
  const { call, stored } = setupAE();
  const add = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 47, operations: [{ type: "add_press_item", item: { instagram: "lee", category: "매거진" } }] });
  assert.equal(add.verified, true);
  const lee = stored().integrations.pressList.list[1];
  assert.equal(lee.instagram, "@lee"); assert.equal(lee.responseStatus, "미회신");
  const dup = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "add_press_item", item: { instagram: "@KIM" } }] });
  assert.equal(dup.error, "duplicate_press_item");
  const noContact = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "update_press_item", pressId: "p1", patch: { contact: "x" } }] });
  assert.equal(noContact.error, "invalid_arguments");
  const st = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [
    { type: "update_press_item", pressId: "p1", patch: { responseStatus: "회신 완료" } }, { type: "set_press_status", pressId: "p1", status: { visitStatus: "방문 완료", storyStatus: "업로드 완료" } }] });
  assert.equal(st.verified, true);
  const op = stored().integrations.pressList.operations.p1;
  assert.equal(op.visitStatus, "방문 완료"); assert.ok(op.checkInAt); assert.equal(op.storyStatus, "업로드 완료");
  assert.equal(stored().integrations.pressList.list[0].contact, "010-0000-0000");
  assert.equal(st.project.integrations.pressList.list[0].contact, undefined); assert.equal(st.project.integrations.pressList.list[0].address, undefined);
  const cancel = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 49, operations: [{ type: "set_press_status", pressId: "p1", status: { visitStatus: "미방문" } }] });
  assert.equal(cancel.verified, true); assert.equal(stored().integrations.pressList.operations.p1.checkInAt, "");
});

test("commission policy rules: validate, upsert, remove; legacy policy must be replaced first; basis lookup", async () => {
  const { call, stored, db, socUnchanged } = setupAE();
  const legacy = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 47, operations: [{ type: "upsert_commission_rule", rule: { id: "f", type: "FIXED", rate: 0.2 } }] });
  assert.equal(legacy.error, "policy_not_rule_based");
  const bad = [
    { id: "t", type: "TIERED", scope: "ALL", operator: "GT", application: "RETROACTIVE", baseRate: 0.2, tiers: [{ threshold: 1, rate: 0.1 }] },
    { id: "t", type: "TIERED", scope: "TOTAL", operator: "GT", application: "SOMETIMES", baseRate: 0.2, tiers: [{ threshold: 1, rate: 0.1 }] },
    { id: "s", type: "SEASONAL", rate: 0.3 }, { id: "b", type: "BRAND_SPECIFIC", rate: 0.3 }, { id: "i", type: "ITEM_OVERRIDE", rate: 0.3, match: {} },
    { id: "f", type: "FIXED", rate: 1.5 }, { type: "FIXED", rate: 0.2 }];
  for (const rule of bad) {
    const r = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 47, operations: [{ type: "update_logistics", patch: { commissionPolicy: { status: "CONFIRMED", rules: [rule] } } }] });
    assert.equal(r.error, "invalid_arguments", JSON.stringify(rule));
  }
  const dupe = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 47, operations: [{ type: "update_logistics", patch: { commissionPolicy: { status: "CONFIRMED", rules: [{ id: "f", type: "FIXED", rate: 0.2 }, { id: "f", type: "FIXED", rate: 0.3 }] } } }] });
  assert.equal(dupe.error, "invalid_arguments");
  assert.equal(stored().version, 47);

  const mixed = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 47, operations: [
    { type: "update_logistics", patch: { commissionPolicy: { status: "CONFIRMED", rules: [{ id: "base", type: "FIXED", rate: 0.25 }] }, purchaseUnitCosts: { aey2631: 45000 } } },
    { type: "upsert_commission_rule", rule: { id: "off", type: "SEASONAL", groups: ["OFF"], rate: 0.3 } },
    { type: "upsert_commission_rule", rule: { id: "tier", type: "TIERED", scope: "TOTAL", operator: "GTE", application: "MARGINAL", baseRate: 0.25, tiers: [{ threshold: 50000000, rate: 0.2 }, { threshold: 30000000, rate: 0.22 }] } },
    { type: "upsert_commission_rule", rule: { id: "x-brand", type: "BRAND_SPECIFIC", brand: "AE SYNCTX", rate: 0.18 } },
    { type: "upsert_commission_rule", rule: { id: "sku", type: "ITEM_OVERRIDE", match: { prodCdPrefixes: ["pop9"] }, rate: 0.1 } },
    { type: "upsert_commission_rule", rule: { id: "base", type: "FIXED", rate: 0.2 } }] });
  assert.equal(mixed.verified, true);
  const policy = stored().logistics.commissionPolicy;
  assert.deepEqual(policy.rules.map((r) => r.id), ["base", "off", "tier", "x-brand", "sku"]);
  assert.equal(policy.rules[0].rate, 0.2);
  assert.deepEqual(policy.rules[2].tiers.map((t) => t.threshold), [30000000, 50000000]); // sorted
  assert.deepEqual(stored().logistics.purchaseUnitCosts, { aey2631: 45000 });
  const removed = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 48, operations: [{ type: "remove_commission_rule", ruleId: "sku" }] });
  assert.equal(removed.verified, true); assert.equal(stored().logistics.commissionPolicy.rules.length, 4);
  const missing = await call("updatePopupProject", { name: "TEST-AE", expectedVersion: 49, operations: [{ type: "remove_commission_rule", ruleId: "sku" }] });
  assert.equal(missing.error, "commission_rule_not_found");

  db.webReport = () => ({ ok: true, projectVersion: stored().version, commissionBreakdown: [{ basis: "TIERED", ruleId: "tier", lines: 1 }], policyErrors: [],
    sales: [{ date: "2026-11-06", slipNo: "1", productName: "TEE", prodCd: "pop1", settlement: "CONSIGNMENT", quantity: 1, paidAmount: 100, commissionRate: 0.2, commissionBasis: "TIERED", commissionRuleId: "tier", commission: 20, commissionDetail: "TIERED tier: …" },
      { date: "2026-11-06", slipNo: "2", productName: "CAP", prodCd: "aey2631", settlement: "PURCHASE", quantity: 1, paidAmount: 100, commissionRate: null, commissionBasis: "PURCHASE_MARGIN", commission: 55, commissionDetail: "사입" }] });
  const basis = await call("getPopupCommissionBasis", { name: "TEST-AE", query: "aey" });
  assert.equal(basis.ok, true); assert.equal(basis.totalLines, 1); assert.equal(basis.lines[0].settlement, "PURCHASE");
  assert.equal(basis.priority[0], "ITEM_OVERRIDE"); assert.equal(basis.policy.rules.length, 4); assert.equal(basis.stale, false);
  socUnchanged();
});
