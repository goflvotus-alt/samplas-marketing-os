import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const monthPattern = /^\d{4}-\d{2}$/;

export async function readEcountOfflineSalesSnapshot(month, options = {}) {
  const filePath = ecountOfflineSalesSnapshotPath(month, options);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid ECOUNT offline sales snapshot JSON: ${filePath}`);
    }
    throw error;
  }
}

export function ecountOfflineSalesSnapshotPath(month, options = {}) {
  assertEcountSalesMonth(month);
  const workDir = resolve(options.workDir || join(process.cwd(), "work"));
  const snapshotDir = options.snapshotDir ? resolve(options.snapshotDir) : join(workDir, "ecount-sales");
  return join(snapshotDir, `${month}.json`);
}

export function assertEcountSalesMonth(month) {
  if (!monthPattern.test(String(month || ""))) {
    throw new Error("Invalid ECOUNT offline sales month. Expected YYYY-MM.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const month = process.argv[2];
  if (!month) {
    console.error("Usage: node scripts/read-ecount-offline-sales-snapshot.mjs YYYY-MM");
    process.exit(1);
  }
  const snapshot = await readEcountOfflineSalesSnapshot(month);
  console.log(JSON.stringify(snapshot, null, 2));
}
