import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(root, "work/brand-universe-candidates.json");
const outputPath = resolve(root, "work/brand-universe.json");
const reviewNotes = new Map([
  ["B00000SK", "Product Registry ambiguous; Cafe24 current product signal unavailable"],
  ["B00000YL", "Product Registry ambiguous; Cafe24 current product signal unavailable"]
]);

const candidates = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(candidates)) throw new Error("Brand Universe candidates must be an array");

const current = candidates.filter((item) => item?.proposed_status === "CURRENT");
const review = candidates.filter((item) => item?.proposed_status === "REVIEW");
const excluded = candidates.filter((item) => item?.proposed_status === "EXCLUDED");
const reviewCodes = review.map((item) => item.brand_code).sort();

if (candidates.length !== 44 || current.length !== 42 || review.length !== 2 || excluded.length !== 0) {
  throw new Error("Candidate counts do not match the approved 44/42/2/0 result");
}
if (JSON.stringify(reviewCodes) !== JSON.stringify([...reviewNotes.keys()].sort())) {
  throw new Error("REVIEW brands do not match the approved brand codes");
}

const universe = candidates
  .map((item) => ({
    brand_code: String(item.brand_code || "").trim(),
    review_status: item.proposed_status,
    override: null,
    override_reason: null,
    note: reviewNotes.get(item.brand_code) || null
  }))
  .sort((left, right) => left.brand_code.localeCompare(right.brand_code));

if (universe.some((item) => !item.brand_code) || new Set(universe.map((item) => item.brand_code)).size !== universe.length) {
  throw new Error("Final Brand Universe contains an empty or duplicate brand_code");
}

await writeFile(outputPath, `${JSON.stringify(universe, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputPath, records: universe.length, current: current.length, review: review.length }, null, 2));
