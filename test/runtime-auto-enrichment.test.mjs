// SAMPLAS Product Registry 리팩터링 — Runtime Auto Enrichment 테스트.
//
// 사용자가 지정한 4개 content_id가 전부 Registry miss인 상태에서 Cafe24 상세 API(모킹)를
// 거쳐 Runtime Product로 정상 보강되는지 확인한다. 기존 enrichMetaProductBreakdown/
// resolveMetaContentId/parseMetaContentId는 이 테스트에서도 원본 그대로 사용한다(수정하지
// 않았음을 이 테스트 자체가 증명한다 — import 대상이 기존 함수 그대로다).
import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichMetaProductBreakdown,
  applyRuntimeAutoEnrichment,
  buildRuntimeProductFromCafe24Detail,
  parseMetaContentId,
  resolveMetaContentId,
  buildProductRegistryIndex
} from "../scripts/meta-product-registry-link.mjs";

// 이번 리팩터링 대상 4개 content_id. 전부 productNo가 "Registry에는 없지만 Cafe24에는
// 실제 존재"하는 상황을 재현한다 — 그래서 registry.entries는 이 4개와 무관한 항목만 둔다.
const TARGET_CONTENT_IDS = [
  "6193.P0000JEF000B",
  "6960.P0000KHS000B",
  "5860.P0000IRK000B",
  "14338.P0000VFM000G"
];

const emptyRegistry = {
  entries: [
    {
      canonicalProductId: "CP-C24-1",
      brandName: "UNRELATED",
      canonicalProductName: "Unrelated Product",
      cafe24: { productNo: "1", productCode: "P000001" },
      ecount: { matchedProducts: [] }
    }
  ]
};

// Cafe24 GET /admin/products/{product_no} 응답을 흉내낸 fixture. 실제 필드명
// (product_no/product_code/product_name/brand_code)을 그대로 사용해 server.mjs의
// fetchCafe24ProductDetail()이 반환하는 모양과 일치시킨다.
const CAFE24_DETAIL_FIXTURES = {
  6193: { product_no: 6193, product_code: "P0000JEF", product_name: "Tailored Wool Jacket", brand_code: "GOOMHEO", display: "T", selling: "T" },
  6960: { product_no: 6960, product_code: "P0000KHS", product_name: "Heavy Cotton Hoodie", brand_code: "UNBORN", display: "T", selling: "T" },
  5860: { product_no: 5860, product_code: "P0000IRK", product_name: "Metal Sabot Sandal", brand_code: "TOGA", display: "T", selling: "T" },
  14338: { product_no: 14338, product_code: "P0000VFM", product_name: "Signature Tee", brand_code: "BONNAE", display: "T", selling: "T" }
};

function makeFetchDetailMock({ failFor = new Set() } = {}) {
  const calls = [];
  const fetchDetail = async (productNo) => {
    calls.push(productNo);
    if (failFor.has(productNo)) {
      const error = new Error(`Cafe24 product not found: ${productNo}`);
      error.status = 404;
      throw error;
    }
    const detail = CAFE24_DETAIL_FIXTURES[productNo];
    if (!detail) throw new Error(`no fixture for productNo ${productNo}`);
    return detail;
  };
  return { fetchDetail, calls };
}

test("사전 확인: 4개 content_id 모두 parseMetaContentId에서 valid Cafe24 형식으로 파싱된다", () => {
  for (const contentId of TARGET_CONTENT_IDS) {
    const parsed = parseMetaContentId(contentId);
    assert.equal(parsed.valid, true, `${contentId}는 valid Cafe24 product.variant 형식이어야 한다`);
    assert.equal(parsed.format, "cafe24_product_variant");
  }
});

test("사전 확인: 4개 content_id 모두 현재 Registry에서는 miss(unresolved_product_registry_miss)다", () => {
  const index = buildProductRegistryIndex(emptyRegistry);
  for (const contentId of TARGET_CONTENT_IDS) {
    const resolved = resolveMetaContentId(contentId, index);
    assert.equal(resolved.matched, false, `${contentId}는 Registry miss여야 한다`);
    assert.equal(resolved.matchType, "unresolved_product_registry_miss");
    assert.equal(resolved.product, null);
  }
});

test("Runtime Auto Enrichment: 4개 content_id 모두 Cafe24 Detail API를 거쳐 Runtime Product로 보강된다", async () => {
  const rows = TARGET_CONTENT_IDS.map((contentId, index) => ({
    ad_id: String(index + 1),
    ad_name: `Ad ${index + 1}`,
    content_id: contentId,
    actions: [{ action_type: "purchase", value: "1" }]
  }));

  const enriched = enrichMetaProductBreakdown(rows, emptyRegistry);
  assert.equal(enriched.summary.unresolvedRows, 4, "Runtime 보강 전에는 4건 전부 unresolved여야 한다");

  const { fetchDetail, calls } = makeFetchDetailMock();
  const result = await applyRuntimeAutoEnrichment(enriched, { fetchDetail });

  assert.equal(result.summary.runtimeEnrichedCount, 4);
  assert.equal(result.summary.unresolvedRows, 0);
  assert.equal(result.summary.matchedRows, 4);
  assert.equal(new Set(calls).size, 4, "productNo 4개 각각 정확히 1회씩 Cafe24 Detail API가 호출되어야 한다(dedup 포함)");

  const expected = {
    "6193.P0000JEF000B": { productNo: 6193, productCode: "P0000JEF", brand: "GOOMHEO", productName: "Tailored Wool Jacket" },
    "6960.P0000KHS000B": { productNo: 6960, productCode: "P0000KHS", brand: "UNBORN", productName: "Heavy Cotton Hoodie" },
    "5860.P0000IRK000B": { productNo: 5860, productCode: "P0000IRK", brand: "TOGA", productName: "Metal Sabot Sandal" },
    "14338.P0000VFM000G": { productNo: 14338, productCode: "P0000VFM", brand: "BONNAE", productName: "Signature Tee" }
  };

  for (const row of result.rows) {
    const exp = expected[row.contentId];
    assert.ok(exp, `예상치 못한 contentId: ${row.contentId}`);
    assert.equal(row.matched, true);
    assert.equal(row.matchType, "runtime_auto_enrichment");
    assert.equal(row.product.source, "runtime", `${row.contentId}: source는 반드시 "runtime"`);
    assert.equal(row.product.registry, false, `${row.contentId}: registry는 반드시 false(파일 미저장)`);
    assert.equal(row.product.cafe24ProductNo, exp.productNo, `${row.contentId}: product_no 불일치`);
    assert.equal(row.product.productCode, exp.productCode, `${row.contentId}: productCode 불일치`);
    assert.equal(row.product.brand, exp.brand, `${row.contentId}: 브랜드 불일치`);
    assert.equal(row.product.productName, exp.productName, `${row.contentId}: 상품명 불일치`);
    assert.equal(row.product.canonicalProductId, null, "Runtime Product는 canonicalProductId가 없다(Registry 항목이 아님)");
  }
});

test("Runtime Auto Enrichment: Cafe24 Detail API가 실패해도 전체 흐름이 죽지 않고 해당 행만 실패로 남는다", async () => {
  const rows = [{ ad_id: "1", content_id: "6960.P0000KHS000B", purchaseCount: 1 }];
  const enriched = enrichMetaProductBreakdown(rows, emptyRegistry);
  const { fetchDetail } = makeFetchDetailMock({ failFor: new Set([6960]) });
  const result = await applyRuntimeAutoEnrichment(enriched, { fetchDetail });
  assert.equal(result.summary.runtimeEnrichedCount, 0);
  assert.equal(result.rows[0].matched, false);
  assert.equal(result.rows[0].matchType, "runtime_auto_enrichment_failed");
  assert.ok(result.rows[0].runtimeEnrichmentError);
});

test("buildRuntimeProductFromCafe24Detail: resolveBrandName 훅으로 브랜드 코드를 브랜드명으로 치환할 수 있다", () => {
  const parsed = parseMetaContentId("5860.P0000IRK000B");
  const detail = CAFE24_DETAIL_FIXTURES[5860];
  const product = buildRuntimeProductFromCafe24Detail(parsed, detail, {
    resolveBrandName: (code) => (code === "TOGA" ? "TOGA VIRILIS" : code)
  });
  assert.equal(product.brand, "TOGA VIRILIS");
  assert.equal(product.source, "runtime");
  assert.equal(product.registry, false);
});

test("Registry에 이미 있는 productNo는 Runtime Auto Enrichment가 건드리지 않는다(기존 resolver 우선)", async () => {
  const registryWithHit = {
    entries: [
      {
        canonicalProductId: "CP-C24-5860",
        brandName: "TOGA",
        canonicalProductName: "Metal Sabot",
        verified: true,
        confidence: 100,
        cafe24: { productNo: "5860", productCode: "P0000IRK" },
        ecount: { matchedProducts: [{ prodCd: "TOG001" }] }
      }
    ]
  };
  const rows = [{ ad_id: "1", content_id: "5860.P0000IRK000B", purchaseCount: 1 }];
  const enriched = enrichMetaProductBreakdown(rows, registryWithHit);
  assert.equal(enriched.rows[0].matched, true);
  assert.equal(enriched.rows[0].matchType, "product_no_exact");

  let fetchDetailCalled = false;
  const result = await applyRuntimeAutoEnrichment(enriched, {
    fetchDetail: async () => { fetchDetailCalled = true; return {}; }
  });
  assert.equal(fetchDetailCalled, false, "이미 Registry에서 resolve된 행은 Cafe24 Detail API를 호출하면 안 된다");
  assert.equal(result.rows[0].product.source, undefined, "Registry 매칭 결과에는 source:runtime 필드가 없다(기존 productFromRegistryEntry 그대로)");
});

console.log("runtime auto enrichment tests passed");
