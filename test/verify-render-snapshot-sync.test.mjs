// scripts/verify-render-snapshot-sync.mjs의 핵심 비교 로직을, 실제 네트워크 없이
// global.fetch를 fixture 응답으로 바꿔치기해서 검증한다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  checkHistoricalMonthly,
  checkBrandRegistry,
  checkEcountCurrentMonth,
  checkProductRegistry,
  checkInventory,
  deepEqual
} from "../scripts/verify-render-snapshot-sync.mjs";

function jsonResponse(body) {
  return { status: 200, text: async () => JSON.stringify(body) };
}

function mockFetch(routes) {
  return async (url) => {
    const path = new URL(url).pathname + new URL(url).search;
    for (const [matcher, respond] of routes) {
      const isMatch = typeof matcher === "string" ? path.startsWith(matcher) : matcher.test(path);
      if (isMatch) return jsonResponse(respond(url));
    }
    throw new Error(`no mock route for ${path}`);
  };
}

test("deepEqual: order-independent key comparison via JSON.stringify (same key order only)", () => {
  assert.equal(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
});

test("checkHistoricalMonthly: PASS when every past month matches", async (t) => {
  t.mock.method(globalThis, "fetch", mockFetch([
    [/\/api\/reports\/monthly/, () => ({ sales: { totalSales: { amount: 100 } } })]
  ]));
  const result = await checkHistoricalMonthly("http://local", "http://render");
  assert.equal(result.status, "PASS");
});

test("checkHistoricalMonthly: FAIL and names the mismatching month", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    // local과 render를 번갈아 다른 값으로 응답 — 2026-01만 다르게 만든다.
    const isLocal = url.startsWith("http://local");
    const isJan = url.includes("month=2026-01");
    const amount = isJan && !isLocal ? 999 : 100;
    return jsonResponse({ sales: { totalSales: { amount } } });
  });
  const result = await checkHistoricalMonthly("http://local", "http://render");
  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /2026-01/);
});

test("checkBrandRegistry: FAIL when alias counts differ", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const isLocal = url.startsWith("http://local");
    return jsonResponse({ count: 278, aliasCount: isLocal ? 361 : 360 });
  });
  const result = await checkBrandRegistry("http://local", "http://render");
  assert.equal(result.status, "FAIL");
});

test("checkEcountCurrentMonth: separate import timestamps do not create false drift", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => jsonResponse({
    sources: [{
      storeCode: "APGUJEONG",
      sourceFileName: "2026-08.xlsx",
      importedAt: url.startsWith("http://local") ? "local-time" : "production-time"
    }]
  }));
  const result = await checkEcountCurrentMonth("http://local", "http://render");
  assert.equal(result.status, "PASS");
});

const entryA = { canonicalProductId: "CP-1", status: "confirmed" };
const entryB = { canonicalProductId: "CP-2", status: "unmatched" };

test("checkProductRegistry: PASS on exact registry match", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ registry: { entries: [entryA, entryB] } }));
  const same = await checkProductRegistry("http://local", "http://render");
  assert.equal(same.status, "PASS");
});

test("checkProductRegistry: FAIL with an exact diff count when entries differ", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const isLocal = url.startsWith("http://local");
    const entries = isLocal ? [entryA, entryB] : [entryA, { ...entryB, status: "confirmed" }];
    return jsonResponse({ registry: { entries } });
  });
  const diff = await checkProductRegistry("http://local", "http://render");
  assert.equal(diff.status, "FAIL");
  assert.match(diff.detail, /^1 entries differ/);
});

test("checkInventory: recentSalesQty differences alone do not fail the check", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const isLocal = url.startsWith("http://local");
    return jsonResponse({
      summary: { totalKnownStock: 100 },
      coverage: { ok: true },
      brandRollup: [{ brandId: "B1", recentSalesQty: isLocal ? 92 : 86, totalSku: 5 }]
    });
  });
  const result = await checkInventory("http://local", "http://render");
  assert.equal(result.status, "PASS", "recentSalesQty만 다르면 live rolling metric이라 PASS여야 한다");
});

test("checkInventory: slowWatchCount differences alone do not fail the check(recentSalesQty에서 파생되는 live 필드)", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const isLocal = url.startsWith("http://local");
    return jsonResponse({
      summary: { totalKnownStock: 100 },
      coverage: { ok: true },
      brandRollup: [{ brandId: "B1", recentSalesQty: isLocal ? 0 : 3, slowWatchCount: isLocal ? 5 : 4, totalSku: 5 }]
    });
  });
  const result = await checkInventory("http://local", "http://render");
  assert.equal(result.status, "PASS", "slowWatchCount는 recentSalesQty 파생 live 필드라 PASS여야 한다");
});

test("checkInventory: a real (non-recentSalesQty) field difference still fails", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const isLocal = url.startsWith("http://local");
    return jsonResponse({
      summary: { totalKnownStock: isLocal ? 100 : 90 },
      coverage: { ok: true },
      brandRollup: []
    });
  });
  const result = await checkInventory("http://local", "http://render");
  assert.equal(result.status, "FAIL");
});

console.log("verify-render-snapshot-sync core logic tests passed");
