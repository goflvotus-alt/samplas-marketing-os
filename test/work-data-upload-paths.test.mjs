import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isAllowedWorkDataUploadPath } from "../server.mjs";
import { discoverWorkSnapshotPaths } from "../scripts/upload-work-snapshots-to-render.mjs";

test("server allows exact monthly JSON paths and keeps explicit inventory paths", () => {
  for (const path of [
    "ecount-sales/2026-08.json", "ecount-sales/2026-12.json", "ecount-sales/2027-01.json",
    "monthly/2026-07.json", "monthly/2027-01.json",
    "ecount-inventory/latest.json", "ecount-inventory/diagnostic.json"
  ]) assert.equal(isAllowedWorkDataUploadPath(path), true, path);
});

test("server rejects invalid months, traversal, extensions and unrelated paths", () => {
  for (const path of [
    "ecount-sales/2026-00.json", "ecount-sales/2026-13.json", "ecount-sales/2026-8.json",
    "ecount-sales/../../secret.json", "ecount-sales/%2e%2e/secret.json", "ecount-sales/2026-08.json.tmp",
    "monthly/test.json", "monthly/2026-8.json", "work/brand-master.json", "backups/2026-08.json",
    "input/2026.08.xlsx", "/absolute/2026-08.json", "https://example.com/2026-08.json"
  ]) assert.equal(isAllowedWorkDataUploadPath(path), false, path);
});

test("discovery includes only existing valid monthly and explicit files, sorted without duplicates", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "work-upload-discovery-"));
  try {
    await mkdir(join(workDir, "ecount-sales"));
    await mkdir(join(workDir, "monthly"));
    await mkdir(join(workDir, "ecount-inventory"));
    for (const path of [
      "ecount-sales/2026-08.json", "ecount-sales/2026-12.json", "ecount-sales/2026-13.json",
      "ecount-sales/2026-08.json.tmp", "monthly/2027-01.json", "monthly/test.json",
      "ecount-inventory/latest.json", "brand-master.json"
    ]) {
      await mkdir(join(workDir, ...path.split("/").slice(0, -1)), { recursive: true });
      await writeFile(join(workDir, ...path.split("/")), "{}");
    }
    assert.deepEqual(await discoverWorkSnapshotPaths(workDir), [
      "ecount-inventory/latest.json",
      "ecount-sales/2026-08.json",
      "ecount-sales/2026-12.json",
      "monthly/2027-01.json"
    ]);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
