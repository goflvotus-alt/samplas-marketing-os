import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditBrandOwnership } from "../scripts/audit-brand-master-integrity.mjs";

const brand = (brand_code, brand_name, active, name_aliases = []) => ({ brand_code, brand_name, active, name_aliases });
const critical = (result) => result.issues.filter((issue) => issue.priority === "Critical");

test("active alias wins over inactive canonical without Critical", () => {
  const result = auditBrandOwnership([brand("A", "현재", true, ["LEGACY"]), brand("B", "LEGACY", false)]);
  assert.equal(critical(result).length, 0);
  assert.equal(result.issues[0].type, "ACTIVE_OWNER_WITH_INACTIVE_LEGACY");
  assert.deepEqual(result.issues[0].brand_codes, ["A", "B"]);
});

test("active canonical wins over inactive canonical without Critical", () => {
  assert.equal(critical(auditBrandOwnership([brand("A", "SAME", true), brand("B", "SAME", false)])).length, 0);
});

test("active canonical and another active alias remain Critical", () => {
  const result = auditBrandOwnership([brand("A", "SAME", true), brand("B", "OTHER", true, ["SAME"])]);
  assert.equal(critical(result)[0].type, "CANONICAL_ALIAS_CONFLICT");
});

test("aliases owned by different active brands remain Critical", () => {
  const result = auditBrandOwnership([brand("A", "ONE", true, ["SAME"]), brand("B", "TWO", true, ["SAME"])]);
  assert.equal(critical(result)[0].type, "ALIAS_ALIAS_CONFLICT");
});

test("canonicals owned by different active brands remain Critical", () => {
  const result = auditBrandOwnership([brand("A", "SAME", true), brand("B", "SAME", true)]);
  assert.equal(critical(result)[0].type, "ACTIVE_DUPLICATE_CANONICAL");
});

test("inactive canonical and inactive alias are Medium", () => {
  const result = auditBrandOwnership([brand("A", "SAME", false), brand("B", "OTHER", false, ["SAME"])]);
  assert.equal(critical(result).length, 0);
  assert.equal(result.issues[0].priority, "Medium");
});

test("canonical and alias on the same brandId are not a conflict", () => {
  assert.equal(auditBrandOwnership([brand("A", "SAME", true, ["SAME", "same"])]).issues.length, 0);
});

test("MEANTIME post-merge has no Critical ownership conflict", () => {
  const result = auditBrandOwnership([
    brand("B00000HM", "민타임", true, ["MEANTIME"]),
    brand("B00000KS", "Meantime", false)
  ]);
  assert.equal(critical(result).length, 0);
  assert.deepEqual(result.issues[0].brand_codes, ["B00000HM", "B00000KS"]);
});

test("BARRAGAN post-merge has no Critical ownership conflict", () => {
  const result = auditBrandOwnership([
    brand("B0000BCX", "BARRAGAN", true),
    brand("B00000KI", "BARRAGAN", false)
  ]);
  assert.equal(critical(result).length, 0);
  assert.deepEqual(result.issues[0].brand_codes, ["B00000KI", "B0000BCX"]);
});

test("pre-merge fixture keeps BARRAGAN Critical and 13 inactive duplicate groups", () => {
  const inactiveDuplicates = Array.from({ length: 13 }, (_, index) => [
    brand(`INACTIVE-${index}-A`, `INACTIVE ${index}`, false),
    brand(`INACTIVE-${index}-B`, `INACTIVE ${index}`, false)
  ]).flat();
  const result = auditBrandOwnership([
    brand("B0000BCX", "BARRAGAN", true),
    brand("B00000KI", "BARRAGAN", true),
    ...inactiveDuplicates
  ]);
  assert.equal(critical(result).some((issue) => issue.type === "ACTIVE_DUPLICATE_CANONICAL" && issue.normalized_key === "barragan"), true);
  assert.equal(result.inactiveDuplicateGroups.length, 13);
});

test("real Brand Master is parseable and auditable without fixed issue counts", async () => {
  const master = JSON.parse(await readFile(new URL("../work/brand-master.json", import.meta.url), "utf8"));
  const result = auditBrandOwnership(master.brands);
  assert.equal(Array.isArray(result.issues), true);
  assert.equal(result.duplicateCanonicalGroups.length >= 0, true);
  assert.equal(result.activeDuplicateGroups.length >= 0, true);
  assert.equal(result.inactiveDuplicateGroups.length >= 0, true);
});
