import test from "node:test";
import assert from "node:assert/strict";
import { applyChanges, PopupError } from "../scripts/popup-projects.mjs";
import { POPUP_TOOLS } from "../scripts/popup-mcp.mjs";

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
