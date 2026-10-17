// POPUP parity: task required + memo, task delete, meeting notes; deletes go to a restorable trash.
import test from "node:test";
import assert from "node:assert/strict";
import { applyOperations, createSessionDocument, sessionProjectView, SessionError } from "../scripts/session-store.mjs";
import { callSessionTool, TASK_OPERATIONS } from "../scripts/session-mcp.mjs";

const web = { kind: "web", id: "web@session.local", approver: false };
const mcp = { kind: "mcp", id: "chatgpt:user-1", approver: false };
const rejects = (fn, status, code) => assert.throws(fn, (e) => e instanceof SessionError && e.status === status && (!code || e.code === code));
const apply = (doc, ops, actor = web) => applyOperations(doc, ops, { actor }).doc;

test("tasks keep required + memo; delete moves a task to the trash and restore brings it back unchanged", () => {
  let doc = createSessionDocument({ number: 990, title: "T", isTest: true });
  doc = apply(doc, [{ type: "add_task", task: { title: "현장 리허설", due: "2026-11-01", required: true, memo: "11시 집합" } }]);
  const task = doc.tasks.at(-1);
  assert.deepEqual([task.required, task.memo], [true, "11시 집합"]);
  doc = apply(doc, [{ type: "update_task", taskId: task.id, patch: { required: false, memo: "10시 집합" } }]);
  const count = doc.tasks.length;
  doc = apply(doc, [{ type: "delete_task", taskId: task.id }]);
  assert.equal(doc.tasks.length, count - 1);
  assert.equal(doc.trash.length, 1);
  assert.deepEqual([doc.trash[0].kind, doc.trash[0].item.memo, doc.trash[0].deletedBy], ["task", "10시 집합", web.id]);
  doc = apply(doc, [{ type: "restore_from_trash", trashId: doc.trash[0].id }]);
  assert.deepEqual(doc.tasks.find((t) => t.id === task.id), { ...task, required: false, memo: "10시 집합" });
  assert.equal(doc.trash.length, 0);
  rejects(() => apply(doc, [{ type: "delete_task", taskId: "missing" }]), 404, "task_not_found");
  rejects(() => apply(doc, [{ type: "update_task", taskId: task.id, patch: { memo: "x".repeat(2001) } }]), 400);
  rejects(() => apply(doc, [{ type: "update_task", taskId: task.id, patch: { required: "yes" } }]), 400);
});

test("meeting notes: add, edit, delete to trash, restore; a document without notes still works", () => {
  let doc = createSessionDocument({ number: 991, title: "T", isTest: true });
  delete doc.notes; delete doc.trash; // documents saved before this change
  doc = apply(doc, [{ type: "add_note", note: { date: "2026-10-17", title: "게스트 미팅", body: "결정: 13:00 시작" } }]);
  const note = doc.notes[0];
  assert.deepEqual([note.date, note.title, note.body], ["2026-10-17", "게스트 미팅", "결정: 13:00 시작"]);
  doc = apply(doc, [{ type: "update_note", noteId: note.id, patch: { body: "결정: 13:00 시작 / 후속: 큐시트" } }], mcp);
  assert.equal(doc.notes[0].body, "결정: 13:00 시작 / 후속: 큐시트");
  doc = apply(doc, [{ type: "delete_note", noteId: note.id }], mcp);
  assert.deepEqual([doc.notes.length, doc.trash[0].kind], [0, "note"]);
  const view = sessionProjectView(doc);
  assert.equal(view.trash[0].item.title, "게스트 미팅", "the project view carries the trash for the web and ChatGPT");
  doc = apply(doc, [{ type: "restore_from_trash", trashId: doc.trash[0].id }]);
  assert.equal(doc.notes[0].id, note.id);
  rejects(() => apply(doc, [{ type: "add_note", note: { title: " " } }]), 400);
  rejects(() => apply(doc, [{ type: "add_note", note: { title: "x", secret: 1 } }]), 400);
  rejects(() => apply(doc, [{ type: "update_note", noteId: note.id, patch: { title: "" } }]), 400);
  rejects(() => apply(doc, [{ type: "restore_from_trash", trashId: "missing" }]), 404, "trash_not_found");
});

test("the trash keeps the newest 200 entries", () => {
  let doc = createSessionDocument({ number: 992, title: "T", isTest: true });
  const ops = Array.from({ length: 205 }, (_, i) => ({ type: "add_task", task: { title: `t${i}` } }));
  for (let i = 0; i < ops.length; i += 50) doc = apply(doc, ops.slice(i, i + 50));
  const ids = doc.tasks.filter((t) => /^t\d+$/.test(t.title)).map((t) => t.id);
  for (let i = 0; i < ids.length; i += 50) doc = apply(doc, ids.slice(i, i + 50).map((taskId) => ({ type: "delete_task", taskId })));
  assert.equal(doc.trash.length, 200);
  assert.equal(doc.trash.at(-1).item.title, "t204");
});

test("ChatGPT updateSessionProject accepts the new task and note operations, nothing else", async () => {
  assert.deepEqual(TASK_OPERATIONS, ["add_task", "update_task", "delete_task", "add_note", "update_note", "delete_note", "restore_from_trash"]);
  const calls = [];
  const service = { update: async (id, version, operations) => { calls.push(operations); return { doc: createSessionDocument({ number: 993, title: "T", isTest: true }), unchanged: false, changed: [] }; } };
  const env = { SESSION_MCP_WRITES: "on" };
  await callSessionTool("updateSessionProject", { id: "test-session-993", version: 1, tasks: [{ type: "add_note", note: { title: "n" } }, { type: "delete_task", taskId: "t1" }] }, { env, service, actor: mcp });
  assert.deepEqual(calls[0].map((o) => o.type), ["add_note", "delete_task"]);
  await assert.rejects(callSessionTool("updateSessionProject", { id: "test-session-993", version: 1, tasks: [{ type: "import_guest_answer" }] }, { env, service, actor: mcp }), (e) => e.status === 400);
});
