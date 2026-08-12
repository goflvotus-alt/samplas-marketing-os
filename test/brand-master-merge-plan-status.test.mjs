import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../scripts/build-brand-master-merge-plan.mjs", import.meta.url), "utf8");
const planKeySource = source.match(/const planKey = [\s\S]*?;\n/)?.[0];
const preserveSource = source.match(/const preserveMergeStatuses = [\s\S]*?\n};/)?.[0];
assert.ok(planKeySource && preserveSource, "merge status helpers must exist");
const context = { text: (value) => String(value ?? "").trim() };
vm.runInNewContext(`${planKeySource}${preserveSource};globalThis.preserveMergeStatuses = preserveMergeStatuses;`, context);

const plan = (codes, status = "PENDING", label = codes.join("/")) => ({
  label,
  merge_status: status,
  candidate_records: codes.map((brand_code) => ({ brand_code }))
});
const apply = (current, previous = []) => {
  const copy = structuredClone(current);
  context.preserveMergeStatuses(copy, structuredClone(previous));
  return copy;
};

test("no previous plan and new merges default to PENDING", () => {
  assert.deepEqual(apply([plan(["A", "B"]), plan(["C", "D"])], []).map((item) => item.merge_status), ["PENDING", "PENDING"]);
});

test("APPLIED and PENDING statuses survive reordered brand-code pairs", () => {
  const current = [plan(["B", "A"], "IGNORED", "new A/B"), plan(["C", "D"], "IGNORED", "new C/D")];
  const previous = [plan(["A", "B"], "APPLIED", "old A/B"), plan(["D", "C"], "PENDING", "old C/D")];
  const result = apply(current, previous);
  assert.deepEqual(result.map((item) => item.merge_status), ["APPLIED", "PENDING"]);
  assert.deepEqual(result.map((item) => item.label), ["new A/B", "new C/D"]);
});

test("removed plans stay removed and new plans start PENDING", () => {
  const result = apply([plan(["NEW", "PAIR"])], [plan(["OLD", "PAIR"], "APPLIED")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "NEW/PAIR");
  assert.equal(result[0].merge_status, "PENDING");
});

test("status preservation is deterministic", () => {
  const current = [plan(["B", "A"]), plan(["D", "C"])];
  const previous = [plan(["A", "B"], "APPLIED"), plan(["C", "D"], "PENDING")];
  assert.deepEqual(apply(current, previous), apply(current, previous));
});
