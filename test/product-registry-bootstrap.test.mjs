import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapProductRegistryFiles, PRODUCT_REGISTRY_SEED_FILES } from "../scripts/bootstrap-product-registry.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "samplas-registry-bootstrap-"));
  const source = join(root, "work");
  const target = join(root, "runtime-work");
  await mkdir(source);
  for (const name of PRODUCT_REGISTRY_SEED_FILES) {
    await writeFile(join(source, name), `source:${name}`);
  }
  return { root, source, target };
}

test("missing runtime files are seeded without overwriting existing files", async () => {
  const { root, target } = await fixture();
  try {
    const logs = [];
    await bootstrapProductRegistryFiles({ projectRoot: root, workDir: target, logger: { log: (line) => logs.push(line) } });
    for (const name of PRODUCT_REGISTRY_SEED_FILES) {
      assert.equal(await readFile(join(target, name), "utf8"), `source:${name}`);
    }
    assert.equal(logs.length, 2);

    await writeFile(join(target, PRODUCT_REGISTRY_SEED_FILES[0]), "persistent");
    await rm(join(target, PRODUCT_REGISTRY_SEED_FILES[1]));
    const result = await bootstrapProductRegistryFiles({ projectRoot: root, workDir: target, logger: { log() {} } });
    assert.equal(await readFile(join(target, PRODUCT_REGISTRY_SEED_FILES[0]), "utf8"), "persistent");
    assert.equal(await readFile(join(target, PRODUCT_REGISTRY_SEED_FILES[1]), "utf8"), `source:${PRODUCT_REGISTRY_SEED_FILES[1]}`);
    assert.deepEqual(result.map((row) => row.status), ["existing", "seeded"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("default project work directory is a no-op", async () => {
  const { root, source } = await fixture();
  try {
    const result = await bootstrapProductRegistryFiles({ projectRoot: root, workDir: source });
    assert.deepEqual(result, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing deployment seed reports the exact file", async () => {
  const root = await mkdtemp(join(tmpdir(), "samplas-registry-bootstrap-missing-"));
  try {
    await mkdir(join(root, "work"));
    await assert.rejects(
      bootstrapProductRegistryFiles({ projectRoot: root, workDir: join(root, "runtime-work") }),
      /product-registry\.json/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
