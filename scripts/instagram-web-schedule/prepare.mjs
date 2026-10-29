// node scripts/instagram-web-schedule/prepare.mjs <schedule.json> <outDir>
// Checks the schedule file (no browser, no network) and writes <outDir>/<folder>.registration.json, the
// nonsecret config the run2 registration hook reads (SAMPLAS_IG_REGISTRATION_CONFIG). outDir must be
// outside Dropbox. Prints the plan summary and the env lines for the browser steps.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadSchedulePlan } from "./plan.mjs";

const [schedule, outDir] = process.argv.slice(2);
if (!schedule || !outDir) { console.log("usage: prepare.mjs <schedule.json> <outDir>"); process.exit(2); }
if (/(?:^|\/)(?:Dropbox[^/]*|READY|UPLOADED)(?:\/|$)/i.test(resolve(outDir))) { console.log("BLOCK outDir must be outside Dropbox"); process.exit(2); }
const out = await loadSchedulePlan(resolve(schedule));
if (!out.ok) { console.log("BLOCK", out.problems.join(",")); process.exit(1); }
const p = out.plan;
await mkdir(outDir, { recursive: true });
const file = join(resolve(outDir), `${p.folderName}.registration.json`);
await writeFile(file, JSON.stringify(p.registration, null, 2));
const tags = p.registration.mappingProposal?.mappings ?? [];
console.log(JSON.stringify({ folderName: p.folderName, store: p.store, location: p.location.name, slot: `${p.slot.dateText} ${p.slot.hours}:${p.slot.minutes} ${p.slot.ampm}`,
  slides: p.slideCount, dimensions: [...new Set(p.dimensions)], captionSha256: p.captionSha256,
  proposal: tags.length ? { mappings: tags.length, reviewRequired: tags.filter((m) => m.reviewRequired).length } : null }, null, 1));
console.log(`SAMPLAS_IG_SCHEDULE=${resolve(schedule)}\nSAMPLAS_IG_REGISTRATION_CONFIG=${file}`);
