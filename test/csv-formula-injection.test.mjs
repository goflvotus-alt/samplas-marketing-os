import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const scripts = [
  "../scripts/build-brand-sourcing-review-table.mjs",
  "../scripts/validate-brand-sourcing-decisions.mjs"
];

async function loadCsvCell(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const declaration = source.match(/const csvCell = \(value\) => \{[\s\S]*?\n\};/)?.[0];
  assert.ok(declaration, `csvCell not found: ${path}`);
  return { source, csvCell: vm.runInNewContext(`${declaration}; csvCell`) };
}

for (const path of scripts) {
  test(`${path}: CSV formula injection and escaping`, async () => {
    const { source, csvCell } = await loadCsvCell(path);
    assert.equal(csvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
    assert.equal(csvCell("+123"), "'+123");
    assert.equal(csvCell("-10"), "'-10");
    assert.equal(csvCell("@cmd"), "'@cmd");
    assert.equal(csvCell(" =SUM(A1:A2)"), "' =SUM(A1:A2)");
    assert.equal(csvCell("normal text"), "normal text");
    assert.equal(csvCell("123"), "123");
    assert.equal(csvCell(123), "123");
    assert.equal(csvCell("'=SUM(A1:A2)"), "'=SUM(A1:A2)");
    assert.equal(csvCell('a,"b"\n'), '"a,""b""\n"');
    assert.match(source, /\\uFEFF/);
  });
}

test("representative fields use protected CSV cell paths", async () => {
  const review = await readFile(new URL(scripts[0], import.meta.url), "utf8");
  const validator = await readFile(new URL(scripts[1], import.meta.url), "utf8");
  assert.match(review, /fields\.map\(\(field\) => csvCell\(item\[field\]\)\)/);
  assert.match(review, /"representative_note"/);
  assert.match(validator, /row\.map\(csvCell\)/);
  assert.match(validator, /"approved_brand_name"/);
  assert.match(validator, /"approved_alias"/);
  assert.match(validator, /"representative_note"/);
});

test("temporary CSV keeps BOM and protects representative values", async () => {
  const { csvCell } = await loadCsvCell(scripts[1]);
  const temp = await mkdtemp(join(tmpdir(), "csv-formula-protection-"));
  try {
    const path = join(temp, "validation.csv");
    const csv = `\uFEFFapproved_brand_name,approved_alias,representative_note\n${["=Brand", "+Alias", " @note"].map(csvCell).join(",")}\n`;
    await writeFile(path, csv, "utf8");
    assert.equal(await readFile(path, "utf8"), "\uFEFFapproved_brand_name,approved_alias,representative_note\n'=Brand,'+Alias,' @note\n");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
