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
  assert.equal(serverCalls.length, 7);
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
