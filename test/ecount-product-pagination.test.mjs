import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchAllProducts, writeInventoryOutputsAtomically, PROD_CD_UPPER_BOUND } from "../scripts/sync-ecount-inventory.mjs";

const codes = n => Array.from({ length: n }, (_, i) => `P${String(i).padStart(6, "0")}`);
// Mirrors observed ECOUNT behaviour: PROD_CD ascending, FROM/TO inclusive, 10,000-row cap.
function mockEcount(all, { limit = 10000, ignoreFrom = false, failAt = 0, shuffle = false } = {}) {
  const calls = [];
  const sorted = [...all].sort();
  const request = async (body, page) => {
    calls.push(body);
    if (page === failAt) throw new Error("injected page failure");
    const rows = sorted.filter(c => ignoreFrom || !body.FROM_PROD_CD || (c >= body.FROM_PROD_CD && c <= body.TO_PROD_CD)).slice(0, limit);
    const result = rows.map(PROD_CD => ({ PROD_CD, PROD_DES: `BRAND / ${PROD_CD}` }));
    if (shuffle && result.length < limit) result.reverse();
    return { httpStatus: 200, body: { Status: "200", Data: { TotalCnt: Math.min(limit, sorted.length), Result: result } } };
  };
  return { request, calls };
}
const run = (mock, opts = {}) => fetchAllProducts(mock.request, { SESSION_ID: "s" }, { delayMs: 0, ...opts });

test("collects more than 10,000 products across range pages", async () => {
  const mock = mockEcount(codes(25_000));
  const { productList, pagination, rawProducts } = await run(mock);
  assert.equal(productList.length, 25_000);
  assert.equal(pagination.pageCount, 3);
  assert.equal(pagination.complete, true);
  assert.equal(pagination.firstProdCd, "P000000");
  assert.equal(pagination.lastProdCd, "P024999");
  assert.equal(pagination.duplicateCount, 2, "each inclusive cursor boundary is fetched twice");
  assert.equal(rawProducts.Data.Result.length, 25_000);
  assert.equal(rawProducts.Data.TotalCnt, 25_000);
  assert.deepEqual(mock.calls[1], { SESSION_ID: "s", FROM_PROD_CD: "P009999", TO_PROD_CD: PROD_CD_UPPER_BOUND });
  assert.equal(mock.calls[0].FROM_PROD_CD, undefined, "page 1 is the plain call");
});

test("exactly 10,000 rows is not assumed complete; a short page ends the scan", async () => {
  const mock = mockEcount(codes(10_000));
  const { productList, pagination } = await run(mock);
  assert.equal(mock.calls.length, 2);
  assert.equal(pagination.pages[1].count, 1, "second page only repeats the boundary");
  assert.equal(productList.length, 10_000);
  const small = await run(mockEcount(codes(42)));
  assert.equal(small.pagination.pageCount, 1);
});

test("a failed page rejects and the existing canonical files are preserved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ecount-pages-"));
  try {
    const canonical = JSON.stringify({ Data: { Result: [{ PROD_CD: "OLD" }] } });
    await writeFile(join(dir, "raw-products.json"), canonical);
    await assert.rejects(
      run(mockEcount(codes(25_000), { failAt: 2 })).then(({ rawProducts }) =>
        writeInventoryOutputsAtomically(dir, { rawProducts, rawInventory: { Data: { Result: [] } }, latest: [], diagnostic: { startedAt: "x", finishedAt: "y" } })),
      /injected page failure/
    );
    assert.equal(await readFile(join(dir, "raw-products.json"), "utf8"), canonical);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("duplicate PROD_CD rows are kept once", async () => {
  const all = [...codes(12_000), "P000005", "P011000"];
  const { productList, pagination } = await run(mockEcount(all));
  assert.equal(productList.length, 12_000);
  assert.equal(new Set(productList.map(r => r.PROD_CD)).size, 12_000);
  assert.ok(pagination.duplicateCount >= 3);
});

test("output is sorted by PROD_CD regardless of response row order; unordered continuation fails safe", async () => {
  const a = await run(mockEcount(codes(500)));
  const b = await run(mockEcount(codes(500), { shuffle: true }));
  assert.deepEqual(b.productList.map(r => r.PROD_CD), a.productList.map(r => r.PROD_CD));
  assert.equal(b.productList[0].PROD_CD, "P000000");
  // A continuation page that does not restart at the cursor cannot be trusted.
  await assert.rejects(run(mockEcount(codes(10_500), { shuffle: true })), /연속성/);
});

test("partial or ignored-range responses are never reported complete", async () => {
  await assert.rejects(run(mockEcount(codes(25_000), { ignoreFrom: true })), /연속성/);
  await assert.rejects(run(mockEcount(codes(25_000), { limit: 10_001 }), { pageLimit: 10_000 }), /한도/);
  await assert.rejects(run(mockEcount(codes(60_000)), { maxPages: 2 }), /안전 한도/);
  const noCode = { request: async () => ({ httpStatus: 200, body: { Data: { Result: [{ PROD_DES: "x" }] } } }) };
  await assert.rejects(run(noCode), /PROD_CD/);
});
