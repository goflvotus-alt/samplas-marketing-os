import { constants } from "node:fs";
import { copyFile, link, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

export const COMMERCIAL_POLICY_SEED_FILES = [
  "brand-commercial-policy.json",
  "brand-sourcing-master.json"
];

export async function bootstrapCommercialPolicyFiles({
  projectRoot,
  workDir,
  logger = console
}) {
  const sourceDir = resolve(projectRoot, "deploy");
  const targetDir = resolve(workDir);

  await mkdir(targetDir, { recursive: true });

  const results = [];

  for (const name of COMMERCIAL_POLICY_SEED_FILES) {
    const source = join(sourceDir, name);
    const target = join(targetDir, name);

    if (existsSync(target)) {
      results.push({ name, status: "existing" });
      continue;
    }

    if (!existsSync(source)) {
      throw new Error(`Commercial Policy seed source is missing: ${source}`);
    }

    const temp = join(
      targetDir,
      `.${name}.${process.pid}.${randomUUID()}.tmp`
    );

    try {
      await copyFile(source, temp, constants.COPYFILE_EXCL);

      try {
        await link(temp, target);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        results.push({ name, status: "existing" });
        continue;
      }

      logger.log(`Commercial Policy seed created: ${target}`);
      results.push({ name, status: "seeded" });
    } finally {
      await unlink(temp).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }

  return results;
}
