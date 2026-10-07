import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const intelligence = await readFile(new URL("../intelligence-service.mjs", import.meta.url), "utf8");

function executableResolverCalls(source) {
  const uncommented = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const calls = [];
  for (const match of uncommented.matchAll(/loadResolverContext\(/g)) {
    calls.push(uncommented.slice(match.index, match.index + 220));
  }
  return calls;
}

test("every Production resolver consumer receives canonical runtime workDir", () => {
  const serverCalls = executableResolverCalls(server);
  const intelligenceCalls = executableResolverCalls(intelligence);
  // 13 = 7 report/attribution consumers + 2 in the SPLIT_CODE_IDENTITY dry-run preview + 2 in the
  // archive brand-attribution rebuild (before/after canonical) + 1 in the one-click split read-back
  // + 1 in the REKEY_INTERNAL_IDENTITY resolver snapshot (dry-run and read-back).
  assert.equal(serverCalls.length, 13);
  assert.equal(intelligenceCalls.length, 1);
  for (const call of [...serverCalls, ...intelligenceCalls]) assert.match(call, /workDir/);
});

test("Brand Master corruption is logged and surfaced, never converted to valid empty data", () => {
  const start = server.indexOf("async function readBrandMasterFile()");
  const end = server.indexOf("async function readBrandSourcingMaster()", start);
  const source = server.slice(start, end);
  assert.match(source, /logApiError\("brand_master_read"/);
  assert.match(source, /throw Object\.assign\(new Error\(`Brand Master source failure:/);
  assert.doesNotMatch(source, /catch[^]*return \{ updatedAt: null, brands: \[\] \}/);
});
