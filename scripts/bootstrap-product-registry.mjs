import { constants } from "node:fs";
import { copyFile, link, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

export const PRODUCT_REGISTRY_SEED_FILES = [
  "product-registry.json",
  "product-registry-review-queue.json"
];

const LEGACY_RENDER_PRODUCT_REGISTRY = Object.freeze({
  generatedAt: "2026-07-19T05:29:36.915Z",
  registryCount: 177,
  verifiedCount: 17
});

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function isKnownLegacyRenderProductRegistry(registry) {
  return (
    registry?.generatedAt === LEGACY_RENDER_PRODUCT_REGISTRY.generatedAt &&
    Array.isArray(registry?.entries) &&
    registry.entries.length === LEGACY_RENDER_PRODUCT_REGISTRY.registryCount &&
    registry?.summary?.registryCount === LEGACY_RENDER_PRODUCT_REGISTRY.registryCount &&
    registry?.summary?.verifiedCount === LEGACY_RENDER_PRODUCT_REGISTRY.verifiedCount
  );
}

async function migrateKnownLegacyProductRegistry({ source, target, logger }) {
  let current;
  let seed;

  try {
    [current, seed] = await Promise.all([
      readJson(target),
      readJson(source)
    ]);
  } catch {
    return null;
  }

  if (!isKnownLegacyRenderProductRegistry(current)) return null;

  const seedEntries = Array.isArray(seed?.entries) ? seed.entries : [];
  const currentEntries = current.entries || [];

  if (
    seedEntries.length <= currentEntries.length ||
    Number(seed?.summary?.verifiedCount || 0) <
      Number(current?.summary?.verifiedCount || 0)
  ) {
    return null;
  }

  const seedByCanonicalId = new Map(
    seedEntries.map((entry) => [String(entry?.canonicalProductId || ""), entry])
  );

  const allCurrentConfirmedPreserved = currentEntries
    .filter((entry) => entry?.status === "confirmed" && entry?.verified === true)
    .every((entry) => {
      const next = seedByCanonicalId.get(String(entry?.canonicalProductId || ""));
      if (!next) return false;

      const currentCodes = (entry?.ecount?.matchedProducts || [])
        .map((row) => String(row?.prodCd || ""))
        .filter(Boolean)
        .sort();

      const nextCodes = (next?.ecount?.matchedProducts || [])
        .map((row) => String(row?.prodCd || ""))
        .filter(Boolean)
        .sort();

      return (
        next?.status === "confirmed" &&
        next?.verified === true &&
        JSON.stringify(currentCodes) === JSON.stringify(nextCodes)
      );
    });

  if (!allCurrentConfirmedPreserved) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${target}.backup-legacy-render-${timestamp}`;
  const temp = `${target}.migration-${process.pid}-${randomUUID()}.tmp`;

  await copyFile(target, backup);
  await copyFile(source, temp);

  try {
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }

  logger.log(`Product Registry legacy persistent file migrated: ${target}`);
  logger.log(`Product Registry legacy backup created: ${backup}`);

  return {
    name: "product-registry.json",
    status: "migrated_legacy",
    backup
  };
}

export async function bootstrapProductRegistryFiles({ projectRoot, workDir, logger = console }) {
  const sourceDir = resolve(projectRoot, "work");
  const targetDir = resolve(workDir);
  if (sourceDir === targetDir) return [];

  await mkdir(targetDir, { recursive: true });
  const results = [];
  for (const name of PRODUCT_REGISTRY_SEED_FILES) {
    const source = join(sourceDir, name);
    const target = join(targetDir, name);
    if (existsSync(target)) {
      if (name === "product-registry.json" && existsSync(source)) {
        const migration = await migrateKnownLegacyProductRegistry({
          source,
          target,
          logger
        });
        if (migration) {
          results.push(migration);
          continue;
        }
      }

      results.push({ name, status: "existing" });
      continue;
    }
    if (!existsSync(source)) {
      throw new Error(`Product Registry seed source is missing: ${source}`);
    }

    const temp = join(targetDir, `.${name}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await copyFile(source, temp, constants.COPYFILE_EXCL);
      try {
        await link(temp, target);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        results.push({ name, status: "existing" });
        continue;
      }
      logger.log(`Product Registry seed created: ${target}`);
      results.push({ name, status: "seeded" });
    } finally {
      await unlink(temp).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
  return results;
}
