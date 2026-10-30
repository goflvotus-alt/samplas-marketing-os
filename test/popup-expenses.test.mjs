import test from "node:test";
import assert from "node:assert/strict";
import { applyChanges, PopupError } from "../scripts/popup-projects.mjs";
import { POPUP_TOOLS, popupRpc } from "../scripts/popup-mcp.mjs";

const now = new Date("2026-10-30T12:00:00Z");
const opts = { now, actor: "test" };
const existing = () => ({
  name: "SUNDAY OFF CLUB",start:"2026-10-09",end:"2026-10-11",
  tasks:[{id:"task1",title:"Keep"}],assets:[],notes:[],
  staffBoard:{pool:["윤재"],assignments:{}},
  expenses:{currency:"KRW",items:[{id:"original",date:"2026-10-09",category:"VMD",title:"Existing",amount:756790}],total:756790}
});

test("MCP updatePopupProject exposes validated expense operations", () => {
  const tool=POPUP_TOOLS.find(x=>x.name==="updatePopupProject");
  assert.ok(tool.inputSchema.properties.operations.items.properties.expense);
  assert.ok(tool.inputSchema.properties.operations.items.properties.expenseId);
  assert.ok(tool.inputSchema.properties.operations.items.properties.type.enum.includes("add_expense"));
  assert.ok(tool.inputSchema.properties.operations.items.properties.type.enum.includes("update_expense"));
});

test("serialized tools/list retains the required expense date schema", async () => {
  const reply = JSON.parse(JSON.stringify(await popupRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {})));
  assert.equal(reply.result.tools.length, 9);
  const operation = reply.result.tools.find(t => t.name === "updatePopupProject").inputSchema.properties.operations.items;
  const expense = operation.properties.expense;
  assert.equal(expense.additionalProperties, false);
  for (const key of expense.required) assert.ok(Object.hasOwn(expense.properties, key), key);
  assert.equal(expense.properties.date.type, "string");
  assert.equal(expense.properties.date.pattern, "^\\d{4}-\\d{2}-\\d{2}$");
  assert.match("2026-10-27", new RegExp(expense.properties.date.pattern));
  assert.doesNotMatch("2026/10/27", new RegExp(expense.properties.date.pattern));
  assert.ok(operation.properties.type.enum.includes("add_expense"));
  assert.ok(operation.properties.type.enum.includes("update_expense"));
});

test("add and update accept YYYY-MM-DD dates without changing existing costs", () => {
  const p = existing();
  applyChanges(p, { operations: [{ type: "add_expense", expense: {
    date: "2026-10-27", category: "VMD", title: "Local fixture", amount: 10
  } }] }, opts);
  const added = p.expenses.items[1];
  assert.equal(added.date, "2026-10-27");
  applyChanges(p, { operations: [{ type: "update_expense", expenseId: added.id, patch: { date: "2026-10-28" } }] }, opts);
  assert.equal(added.date, "2026-10-28");
  assert.equal(added.amount, 10);
  assert.deepEqual(p.expenses.items[0], existing().expenses.items[0]);
  assert.equal(p.expenses.total, 756800);
});

test("add and update reject malformed, impossible and non-string expense dates", () => {
  for (const date of ["2026/10/27", "2026-1-27", "2026-02-30", "", null, 20261027]) {
    for (const operation of [
      { type: "add_expense", expense: { date, category: "VMD", title: "Local fixture", amount: 10 } },
      { type: "update_expense", expenseId: "original", patch: { date } }
    ]) {
      const p = existing(), before = structuredClone(p);
      assert.throws(() => applyChanges(p, { operations: [operation] }, opts), PopupError);
      assert.deepEqual(p, before);
    }
  }
});

test("adding expense preserves historical SOC items and unrelated fields", () => {
  const p=existing(), prior=structuredClone(p);
  const changes=applyChanges(p,{operations:[{type:"add_expense",expense:{date:"2026-10-30",category:"VMD/장비",title:"JS렌탈",amount:304058,vatIncluded:true,estimate:false}}]},opts);
  assert.equal(changes.length,1);
  assert.equal(p.expenses.total,1060848);
  assert.equal(p.expenses.items.length,2);
  assert.deepEqual(p.expenses.items[0],prior.expenses.items[0]);
  assert.deepEqual(p.tasks,prior.tasks);
  assert.deepEqual(p.staffBoard,prior.staffBoard);
  assert.match(p.expenses.items[1].id,/^[0-9a-f-]{36}$/);
});

test("update expense changes one entry and recalculates total", () => {
  const p=existing();
  applyChanges(p,{operations:[{type:"update_expense",expenseId:"original",patch:{amount:700000,estimate:true}}]},opts);
  assert.equal(p.expenses.total,700000);
  assert.equal(p.expenses.items[0].estimate,true);
  assert.equal(p.expenses.items[0].title,"Existing");
});

test("invalid amount, date, and mismatched ID are rejected", () => {
  for (const expense of [
    {date:"2026-10-30",category:"VMD",title:"Bad",amount:-1},
    {date:"2026-02-30",category:"VMD",title:"Bad",amount:10},
    {date:"2026-10-30",category:"VMD",title:"Bad",amount:12.5}
  ]) assert.throws(()=>applyChanges(existing(),{operations:[{type:"add_expense",expense}]},opts),PopupError);
  assert.throws(()=>applyChanges(existing(),{operations:[{type:"update_expense",expenseId:"missing",patch:{amount:500}}]},opts),PopupError);
});

test("existing totals cannot silently truncate malformed records", () => {
  const p=existing();p.expenses.items[0].amount=-1;
  assert.throws(()=>applyChanges(p,{operations:[{type:"add_expense",expense:{date:"2026-10-30",category:"VMD",title:"Test",amount:10}}]},opts),PopupError);
});
