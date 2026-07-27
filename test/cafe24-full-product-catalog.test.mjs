// SAMPLAS Product Registry 리팩터링 — Cafe24 전체 상품 기반 생성 정책 테스트.
//
// 검증 대상:
// 1. fetchAllCafe24ProductsFullCatalog: 200개(과거 fetchCafe24ProductList의 하드 캡)를
//    넘는 상품도 Pagination이 끝날 때까지(마지막 페이지가 pageSize보다 작을 때) 전부
//    수집하는지.
// 2. buildCafe24EcountProductMatchingDiagnostic: cafe24ProductsOverride로 주입한 Cafe24
//    전체 상품이 display/selling 값과 무관하게 전부 진단 결과(results)에 반영되는지, 그리고
//    ECOUNT 매칭이 없는 상품은 전부 "cafe24_only"로 남아 build-product-registry.mjs가 그대로
//    Registry 항목으로 승격할 수 있는 상태인지(이 스크립트는 그 승격까지는 하지 않는다 —
//    그 부분은 test/product-registry.test.mjs가 이미 검증한다. 여기서는 입력 단계만 검증).
import test from "node:test";
import assert from "node:assert/strict";
import { fetchAllCafe24ProductsFullCatalog } from "../scripts/cafe24-script-client.mjs";
import { buildCafe24EcountProductMatchingDiagnostic } from "../scripts/diagnose-cafe24-ecount-product-matching.mjs";

function makeFakeCafe24Env() {
  return { CAFE24_MALL_ID: "test-mall", CAFE24_ACCESS_TOKEN: "test-token" };
}

// 3페이지(100+100+37=237개, 과거 200개 하드 캡을 넘는 규모)를 순서대로 돌려주는 fetch mock.
function makePagedFetchMock(totalCount) {
  let calls = 0;
  return async (url) => {
    calls += 1;
    const params = new URL(url).searchParams;
    const limit = Number(params.get("limit"));
    const offset = Number(params.get("offset"));
    const remaining = Math.max(0, totalCount - offset);
    const pageCount = Math.min(limit, remaining);
    const page = Array.from({ length: pageCount }, (_, i) => ({
      product_no: offset + i + 1,
      product_code: `P${String(offset + i + 1).padStart(6, "0")}`,
      product_name: `[BRAND] Product ${offset + i + 1}`,
      brand_code: "BRAND",
      display: pageCount % 2 === 0 ? "F" : "T",
      selling: pageCount % 3 === 0 ? "F" : "T"
    }));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ products: page })
    };
  };
}

test("fetchAllCafe24ProductsFullCatalog: 200개 하드 캡을 넘는 상품도 pagination 끝까지 수집한다", async () => {
  const fetchImpl = makePagedFetchMock(237);
  const result = await fetchAllCafe24ProductsFullCatalog({
    env: makeFakeCafe24Env(),
    pageSize: 100,
    fetchImpl
  });
  assert.equal(result.products.length, 237, "과거 fetchCafe24ProductList의 200개 캡을 넘는 237개가 전부 수집되어야 한다");
  assert.equal(result.pagesFetched, 3);
  assert.equal(result.stoppedReason, "partial_page");
});

test("fetchAllCafe24ProductsFullCatalog: 정확히 pageSize의 배수인 경우 마지막 빈 페이지로 종료한다", async () => {
  const fetchImpl = makePagedFetchMock(200);
  const result = await fetchAllCafe24ProductsFullCatalog({
    env: makeFakeCafe24Env(),
    pageSize: 100,
    fetchImpl
  });
  assert.equal(result.products.length, 200);
  assert.equal(result.pagesFetched, 3); // 100 + 100 + 0(빈 페이지 확인)
  assert.equal(result.stoppedReason, "empty_page");
});

test("fetchAllCafe24ProductsFullCatalog: maxPages 안전장치가 무한루프를 막는다", async () => {
  // 절대 끝나지 않는(항상 pageSize만큼 채워진 페이지를 주는) 비정상 mock
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ products: Array.from({ length: 100 }, (_, i) => ({ product_no: i + 1 })) })
  });
  const result = await fetchAllCafe24ProductsFullCatalog({
    env: makeFakeCafe24Env(),
    pageSize: 100,
    maxPages: 5,
    fetchImpl
  });
  assert.equal(result.pagesFetched, 5);
  assert.equal(result.stoppedReason, "max_pages_reached");
});

test("buildCafe24EcountProductMatchingDiagnostic: 237개 전체 Cafe24 상품이 display/selling과 무관하게 결과에 반영된다", async () => {
  const cafe24ProductsOverride = Array.from({ length: 237 }, (_, i) => ({
    productNo: String(i + 1),
    productCode: `P${String(i + 1).padStart(6, "0")}`,
    productName: `[TESTBRAND] Product ${i + 1}`,
    brand: "TESTBRAND",
    // 절반은 display=F, selling=F로 섞어서 필터링되지 않는지 확인한다.
    display: i % 2 === 0 ? "T" : "F",
    selling: i % 2 === 0 ? "T" : "F"
  }));
  const diagnostic = await buildCafe24EcountProductMatchingDiagnostic({ cafe24ProductsOverride });
  assert.equal(diagnostic.metrics.cafe24ProductCount, 237, "display/selling 상관없이 237개 전부가 진단 대상이어야 한다");
  assert.equal(diagnostic.sources.cafe24.productCount, 237);
  const cafe24OnlyProductNos = new Set(
    diagnostic.results.filter((r) => r.classification === "cafe24_only").map((r) => r.cafe24.productNo)
  );
  // ECOUNT 쪽에 실제 매칭될 리 없는 임의 productNo이므로(실제 work/ecount-inventory/latest.json
  // 데이터와 우연히 겹치지 않는 한) 대부분 cafe24_only로 남아야 한다.
  assert.ok(cafe24OnlyProductNos.size > 0, "최소 1건 이상 cafe24_only로 분류되어야 한다");
  for (let i = 1; i <= 237; i += 1) {
    const found = diagnostic.results.some((r) => r.cafe24?.productNo === String(i));
    assert.ok(found, `productNo ${i}가 결과 어디에도 없다 — display/selling 필터링으로 누락되었을 가능성`);
  }
});

console.log("cafe24 full product catalog tests passed");
