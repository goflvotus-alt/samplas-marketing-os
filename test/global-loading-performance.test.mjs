import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
const requestSource = js.slice(
  js.indexOf("const inFlightJsonRequests"),
  js.indexOf("// 브랜드 코드 → 영문 Canonical Name", js.indexOf("const inFlightJsonRequests"))
);

function requestHarness(fetch) {
  const context = {
    AbortController,
    clearTimeout,
    fetch,
    registerBrandCanonicalNames() {},
    registerBrandMasterResponse() {},
    setTimeout
  };
  vm.runInNewContext(`${requestSource}\nthis.getJson = getJson;`, context);
  return context.getJson;
}

const response = (body = { ok: true }) => ({ ok: true, text: async () => JSON.stringify(body) });

test("simultaneous identical GET requests share one in-flight promise and clear after completion", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const getJson = requestHarness(async () => {
    calls += 1;
    await pending;
    return response();
  });
  const first = getJson("/api/example?month=2026-08");
  const second = getJson("/api/example?month=2026-08");
  assert.equal(first, second);
  assert.equal(calls, 1);
  release();
  await first;
  await getJson("/api/example?month=2026-08");
  assert.equal(calls, 2);
});

test("failed GET requests clear the in-flight entry", async () => {
  let calls = 0;
  const getJson = requestHarness(async () => {
    calls += 1;
    if (calls === 1) throw new Error("network down");
    return response();
  });
  assert.equal((await getJson("/api/retry")).error, "network down");
  assert.equal((await getJson("/api/retry")).ok, true);
  assert.equal(calls, 2);
});

test("different month/query requests never cross-share", async () => {
  let calls = 0;
  const getJson = requestHarness(async () => {
    calls += 1;
    return response();
  });
  await Promise.all([
    getJson("/api/reports/monthly?month=2026-08"),
    getJson("/api/reports/monthly?month=2026-07")
  ]);
  assert.equal(calls, 2);
});

test("initial render only starts data work for the active route", () => {
  const renderAll = js.match(/function renderAll\(\) \{[\s\S]*?\n}/)?.[0] || "";
  assert.match(renderAll, /if \(\$\("#Reports"\)\?\.classList\.contains\("active"\)\) renderReportsMonth/);
  assert.match(renderAll, /if \(\$\("#Content"\)\?\.classList\.contains\("active"\)\)/);
  assert.doesNotMatch(js.slice(js.lastIndexOf("renderNav();")), /renderStoryInsights\(\)/);
});

test("route hash follow-up does not execute the same lazy refresh twice", () => {
  const setActiveView = js.match(/function setActiveView\(view, options = \{\}\) \{[\s\S]*?\n}/)?.[0] || "";
  assert.match(setActiveView, /const shouldLoadRoute = options\.updateHash !== false \|\| !monthlyData\.length/);
  assert.match(setActiveView, /targetView === "Clients" && shouldLoadRoute/);
  assert.match(setActiveView, /targetView === "ProductRegistry" && shouldLoadRoute/);
  assert.match(setActiveView, /targetView === "ApgujeongIntelligence" && shouldLoadRoute/);
});
