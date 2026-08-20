import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bootstrapCommercialPolicyFiles,
  COMMERCIAL_POLICY_SEED_FILES
} from "../scripts/bootstrap-commercial-policy.mjs";

async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "samplas-commercial-policy-bootstrap-")
  );

  const source = join(root, "deploy");
  const target = join(root, "runtime-work");

  await mkdir(source);

  for (const name of COMMERCIAL_POLICY_SEED_FILES) {
    await writeFile(
      join(source, name),
      `source:${name}`
    );
  }

  return { root, source, target };
}

test("missing Commercial Policy runtime files are seeded", async () => {
  const { root, target } = await fixture();

  try {
    const logs = [];

    const result = await bootstrapCommercialPolicyFiles({
      projectRoot: root,
      workDir: target,
      logger: {
        log(line) {
          logs.push(line);
        }
      }
    });

    assert.deepEqual(
      result.map(row => row.status),
      ["seeded", "seeded"]
    );

    for (const name of COMMERCIAL_POLICY_SEED_FILES) {
      assert.equal(
        await readFile(join(target, name), "utf8"),
        `source:${name}`
      );
    }

    assert.equal(logs.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing Commercial Policy runtime files are never overwritten", async () => {
  const { root, target } = await fixture();

  try {
    await mkdir(target, { recursive: true });

    for (const name of COMMERCIAL_POLICY_SEED_FILES) {
      await writeFile(
        join(target, name),
        `persistent:${name}`
      );
    }

    const result = await bootstrapCommercialPolicyFiles({
      projectRoot: root,
      workDir: target,
      logger: { log() {} }
    });

    assert.deepEqual(
      result.map(row => row.status),
      ["existing", "existing"]
    );

    for (const name of COMMERCIAL_POLICY_SEED_FILES) {
      assert.equal(
        await readFile(join(target, name), "utf8"),
        `persistent:${name}`
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing deployment snapshot reports the exact file", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "samplas-commercial-policy-missing-")
  );

  try {
    await mkdir(join(root, "deploy"));

    await assert.rejects(
      bootstrapCommercialPolicyFiles({
        projectRoot: root,
        workDir: join(root, "runtime-work")
      }),
      /brand-commercial-policy\.json/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
