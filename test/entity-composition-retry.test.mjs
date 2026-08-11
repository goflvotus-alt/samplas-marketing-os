import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// STEP67-customer-composition-retry-fix: getEntityCompositionJson()는 STEP67-10G-1이
// /api/reports/monthly에 적용한 것과 정확히 같은 패턴(8초 실패 시 30초 1회 재시도)을
// Customer Composition endpoint에 적용한 새 헬퍼다. 이미 이 저장소가 쓰는 패턴
// (test/brand-comparison-yoy-timeout.test.mjs)을 그대로 따라 실제 소스를 추출해
// Function()으로 실행한다.
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOf(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} source missing`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(start, index + 1);
  }
  throw new Error(`${name} source incomplete`);
}

function loadGetEntityCompositionJson(getJsonImpl) {
  const source = sourceOf("getEntityCompositionJson").replace(/^function /, "async function ");
  return Function(
    "getJson",
    `const ENTITY_COMPOSITION_TIMEOUT_MS=8000; const ENTITY_COMPOSITION_RETRY_TIMEOUT_MS=30000; ${source}; return getEntityCompositionJson;`
  )(getJsonImpl);
}

test("successful first response never triggers a retry", async () => {
  const calls = [];
  const data = { ok: true, typeStats: [{ type: "stylist", count: 5, sales: 100000 }], topCustomers: [] };
  const result = await loadGetEntityCompositionJson(async (url, timeout) => { calls.push([url, timeout]); return data; })(
    "/api/brand-intelligence/B00000KU/customer-composition?month=2026-06"
  );
  assert.deepEqual(calls, [["/api/brand-intelligence/B00000KU/customer-composition?month=2026-06", 8000]]);
  assert.equal(result, data);
});

test("first-attempt timeout retries exactly once at 30 seconds", async () => {
  const calls = [];
  const data = { ok: true, typeStats: [], topCustomers: [] };
  const result = await loadGetEntityCompositionJson(async (url, timeout) => {
    calls.push([url, timeout]);
    return calls.length === 1 ? { error: "응답 지연" } : data;
  })("/api/brand-intelligence/B00000WW/customer-composition?month=2026-08");
  assert.deepEqual(calls.map((call) => call[1]), [8000, 30000]);
  assert.equal(calls.length, 2, "must retry exactly once, never loop indefinitely");
  assert.equal(result, data);
});

test("a second timeout is returned as-is, not retried a third time", async () => {
  const calls = [];
  const result = await loadGetEntityCompositionJson(async (url, timeout) => {
    calls.push(timeout);
    return { error: "응답 지연" };
  })("/api/brand-intelligence/B00000KU/customer-composition?month=2026-08");
  assert.deepEqual(calls, [8000, 30000]);
  assert.equal(result.error, "응답 지연");
});

test("a genuine (non-timeout) error is returned immediately without any retry", async () => {
  const calls = [];
  const result = await loadGetEntityCompositionJson(async (url, timeout) => {
    calls.push(timeout);
    return { error: "API 오류 500" };
  })("/api/brand-intelligence/B00000KU/customer-composition?month=2026-08");
  assert.deepEqual(calls, [8000]);
  assert.equal(result.error, "API 오류 500");
});

// 요구사항 5(stale-response 방지): 재시도 로직이 기존 entityCompositionSeq/
// entityCompareCompositionSeq stale-guard를 우회하지 않는지 — 두 호출부 모두
// getEntityCompositionJson()을 await한 "바로 다음 줄"에 여전히 seq 비교가 있는지
// 구조적으로 확인한다(순수 async/await 의미상 재시도 중 seq가 바뀌어도 await 완료
// 후 이 검사가 그대로 걸러낸다 — 검사 자체가 이동/삭제되지 않았음을 검증).
test("stale-response guard still runs immediately after the retry-wrapped fetch in both call sites", () => {
  const compareSource = sourceOf("refreshEntityCompareCustomerComposition");
  assert.match(compareSource, /await getEntityCompositionJson\(`[\s\S]*?`\);\s*\n\s*if \(seq !== entityCompareCompositionSeq\) return;/);

  const primarySource = sourceOf("refreshEntityCustomerComposition");
  assert.match(primarySource, /await getEntityCompositionJson\(`[\s\S]*?`\);\s*\n\s*if \(seq !== entityCompositionSeq\) return;/);
});

test("both Customer Composition call sites use the retry helper, not a bare fixed-timeout getJson", () => {
  assert.doesNotMatch(js, /customer-composition\?month=\$\{encodeURIComponent\(month\)\}`, 10000\)/, "no call site should still use the old fixed 10s timeout");
  const compareSource = sourceOf("refreshEntityCompareCustomerComposition");
  assert.match(compareSource, /getEntityCompositionJson\(`\/api\/brand-intelligence\/\$\{encodeURIComponent\(brandBCode\)\}/);
  const primarySource = sourceOf("refreshEntityCustomerComposition");
  assert.match(primarySource, /getEntityCompositionJson\(`\/api\/brand-intelligence\/\$\{encodeURIComponent\(brandCode\)\}/);
});
