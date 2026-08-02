import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sourceScript = new URL("../scripts/build-brand-universe-candidates.mjs", import.meta.url);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "brand-universe-generator-"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "work/ecount-inventory"), { recursive: true });
  await copyFile(sourceScript, join(root, "scripts/build-brand-universe-candidates.mjs"));
  await writeFile(join(root, "work/brand-master.json"), JSON.stringify({ brands: [
    { brand_code: "B001", brand_name: "TEST", active: true }
  ] }));
  await writeFile(join(root, "work/ecount-inventory/raw-inventory.json"), JSON.stringify({ Data: { Result: [] } }));
  await writeFile(join(root, "work/product-registry.json"), JSON.stringify({ entries: [] }));
  return root;
}

function run(root, args = []) {
  return spawnSync(process.execPath, [join(root, "scripts/build-brand-universe-candidates.mjs"), ...args], { encoding: "utf8" });
}

test("product dashboard CLI input is required and validated", async () => {
  const root = await fixture();
  try {
    assert.match(run(root).stderr, /Usage:/);
    assert.match(run(root, ["--product-dashboard", join(root, "missing.json")]).stderr, /input is missing/);

    const invalidJson = join(root, "invalid.json");
    await writeFile(invalidJson, "{");
    assert.notEqual(run(root, ["--product-dashboard", invalidJson]).status, 0);

    const invalidStructure = join(root, "invalid-structure.json");
    await writeFile(invalidStructure, JSON.stringify({ products: [{}] }));
    assert.match(run(root, ["--product-dashboard", invalidStructure]).stderr, /missing required keys/);

    const valid = join(root, "products.json");
    await writeFile(valid, JSON.stringify({ products: [{
      productNo: 1,
      productName: "TEST PRODUCT",
      brand: "B001",
      display: "T",
      selling: "T",
      inventoryQuantity: 1,
      soldOut: false
    }] }));
    assert.equal(run(root, ["--product-dashboard", valid]).status, 0);
    const candidates = JSON.parse(await readFile(join(root, "work/brand-universe-candidates.json")));
    assert.equal(candidates[0].brand_code, "B001");
    assert.equal(candidates[0].proposed_status, "CURRENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generator source has no hardcoded product dashboard temp path", async () => {
  assert.doesNotMatch(await readFile(sourceScript, "utf8"), /samplas-product-dashboard\.json/);
});
