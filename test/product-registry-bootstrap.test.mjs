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

test("known legacy Render registry is backed up and migrated to the expanded deployment seed", async () => {
  const { root, source, target } = await fixture();

  try {
    await mkdir(target, { recursive: true });

    const legacy = {
      generatedAt: "2026-07-19T05:29:36.915Z",
      summary: {
        registryCount: 177,
        verifiedCount: 17
      },
      entries: Array.from({ length: 177 }, (_, index) => ({
        canonicalProductId: `CP-${index}`,
        status: index < 17 ? "confirmed" : "ambiguous",
        verified: index < 17,
        ecount: {
          matchedProducts: index < 17
            ? [{ prodCd: `SKU-${index}` }]
            : []
        }
      }))
    };

    const expanded = {
      generatedAt: "2026-08-20T05:26:48.361Z",
      summary: {
        registryCount: 3596,
        verifiedCount: 254
      },
      entries: [
        ...legacy.entries.map((entry) => ({ ...entry })),
        ...Array.from({ length: 3596 - 177 }, (_, index) => ({
          canonicalProductId: `NEW-${index}`,
          status: "ambiguous",
          verified: false,
          ecount: { matchedProducts: [] }
        }))
      ]
    };

    await writeFile(
      join(source, "product-registry.json"),
      `${JSON.stringify(expanded)}\n`
    );

    await writeFile(
      join(target, "product-registry.json"),
      `${JSON.stringify(legacy)}\n`
    );

    const result = await bootstrapProductRegistryFiles({
      projectRoot: root,
      workDir: target,
      logger: { log() {} }
    });

    const migrated = JSON.parse(
      await readFile(join(target, "product-registry.json"), "utf8")
    );

    assert.equal(migrated.entries.length, 3596);
    assert.equal(migrated.summary.verifiedCount, 254);
    assert.equal(result[0].status, "migrated_legacy");
    assert.match(result[0].backup, /backup-legacy-render-/);

    const backup = JSON.parse(
      await readFile(result[0].backup, "utf8")
    );

    assert.equal(backup.entries.length, 177);
    assert.equal(backup.summary.verifiedCount, 17);

    const second = await bootstrapProductRegistryFiles({
      projectRoot: root,
      workDir: target,
      logger: { log() {} }
    });

    assert.equal(second[0].status, "existing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-legacy persistent Product Registry is never overwritten", async () => {
  const { root, source, target } = await fixture();

  try {
    await mkdir(target, { recursive: true });

    const persistent = {
      generatedAt: "2026-08-20T06:00:00.000Z",
      summary: {
        registryCount: 178,
        verifiedCount: 18
      },
      entries: Array.from({ length: 178 }, (_, index) => ({
        canonicalProductId: `PERSISTENT-${index}`,
        status: index < 18 ? "confirmed" : "ambiguous",
        verified: index < 18,
        ecount: { matchedProducts: [] }
      }))
    };

    const expanded = {
      generatedAt: "2026-08-20T05:26:48.361Z",
      summary: {
        registryCount: 3596,
        verifiedCount: 254
      },
      entries: Array.from({ length: 3596 }, (_, index) => ({
        canonicalProductId: `SEED-${index}`,
        status: "ambiguous",
        verified: false,
        ecount: { matchedProducts: [] }
      }))
    };

    await writeFile(
      join(source, "product-registry.json"),
      `${JSON.stringify(expanded)}\n`
    );

    await writeFile(
      join(target, "product-registry.json"),
      `${JSON.stringify(persistent)}\n`
    );

    const before = await readFile(
      join(target, "product-registry.json"),
      "utf8"
    );

    const result = await bootstrapProductRegistryFiles({
      projectRoot: root,
      workDir: target,
      logger: { log() {} }
    });

    const after = await readFile(
      join(target, "product-registry.json"),
      "utf8"
    );

    assert.equal(result[0].status, "existing");
    assert.equal(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
