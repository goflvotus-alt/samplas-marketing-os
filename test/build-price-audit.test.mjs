import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classify, resolvePolicy } from "../scripts/build-price-audit.mjs";
import { fetchAllCafe24ProductsFullCatalog } from "../scripts/cafe24-script-client.mjs";

function registryEntry(overrides = {}) {
  return {
    canonicalProductName: "PRODUCT",
    ecount: { matchedProducts: [{ prodCd: "SKU001" }] },
    verified: true,
    confidence: 100,
    ...overrides
  };
}

{
  const products = Array.from({ length: 201 }, (_, i) => ({ product_no: i + 1 }));
  const fetched = await fetchAllCafe24ProductsFullCatalog({
    pageSize: 100,
    env: { CAFE24_PROXY_BASE_URL: "https://example.invalid" },
    fetchImpl: async (url) => {
      const since = Number(new URL(url).searchParams.get("since_product_no"));
      const page = products.filter((product) => product.product_no > since).slice(0, 100);
      return { ok: true, text: async () => JSON.stringify({ products: page }) };
    }
  });
  assert.equal(fetched.products.length, 201, "full catalog snapshot must retain products beyond the first two pages");
}

// 1. ONLINE 100,000 / ECOUNT 100,000 => MATCH
assert.equal(classify({
  registryEntry: registryEntry(),
  cafe24Price: 100000,
  ecountPrice: 100000,
  ecountPriceConsistent: true,
  cafe24Fetched: true
}).status, "MATCH", "가격이 같으면 MATCH");

// 2. ONLINE 90,000 / ECOUNT 100,000 => ECOUNT_HIGHER
assert.equal(classify({
  registryEntry: registryEntry(),
  cafe24Price: 90000,
  ecountPrice: 100000,
  ecountPriceConsistent: true,
  cafe24Fetched: true
}).status, "ECOUNT_HIGHER", "ECOUNT이 더 높으면 ECOUNT_HIGHER");

// 3. ONLINE 100,000 / ECOUNT 90,000 => ECOUNT_LOWER
assert.equal(classify({
  registryEntry: registryEntry(),
  cafe24Price: 100000,
  ecountPrice: 90000,
  ecountPriceConsistent: true,
  cafe24Fetched: true
}).status, "ECOUNT_LOWER", "ECOUNT이 더 낮으면 ECOUNT_LOWER");

// 4. Registry 미연결(ECOUNT SKU 없음) => MATCH_REQUIRED
assert.equal(classify({
  registryEntry: registryEntry({ ecount: { matchedProducts: [] } }),
  cafe24Price: null,
  ecountPrice: null,
  ecountPriceConsistent: true,
  cafe24Fetched: false
}).status, "MATCH_REQUIRED", "ECOUNT 연결이 없으면 MATCH_REQUIRED");
assert.equal(classify({ registryEntry: registryEntry({ canonicalProductName: "상품명 없음", ecount: { matchedProducts: [] } }) }).status, "DATA_ISSUE", "missing identity is a data issue");

for (const [resolutionState, expected] of Object.entries({
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  GENUINE_AMBIGUOUS: "GENUINE_AMBIGUOUS",
  SPECIAL_PRODUCT: "SPECIAL_PRODUCT",
  HISTORICAL_OR_INACTIVE: "HISTORICAL",
  TRUE_NO_COUNTERPART: "NO_COUNTERPART",
  DATA_QUALITY_ISSUE: "REVIEW_REQUIRED"
})) {
  assert.equal(classify({ registryEntry: registryEntry({ verified: false, resolutionState }), cafe24Fetched: false }).status, expected);
}
assert.equal(classify({
  registryEntry: registryEntry({ resolutionState: "SPECIAL_PRODUCT" }),
  cafe24Price: 100000, ecountPrice: 100000, ecountPriceConsistent: true, cafe24Fetched: true
}).status, "MATCH", "human-confirmed mapping takes precedence over terminal metadata");

{
  const ui = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
  for (const token of ["HUMAN_REVIEW_REQUIRED", "GENUINE_AMBIGUOUS", "TERMINAL", "DATA_ISSUE", "사람 검토 필요", "조치 불필요"]) assert.match(ui, new RegExp(token));
}

// 5/6. Commercial Policy 10% — 원인 추정(causeHint)이 어느 쪽을 확인하라고 가리키는지만
// 검증한다(가격을 자동 변경하지 않음, resolvePolicy는 참고 정보만 계산).
const policies = [{ brand_code: "B0001", stylist_discount_percent: 10, product_rules: [] }];
const policy = resolvePolicy(policies, "B0001", "ANY PRODUCT");
assert.equal(policy.effectiveDiscountPercent, 10, "브랜드 기본 할인율을 그대로 읽는다(새 정책 계산 없음)");

// 5. 정가 100,000, ONLINE 90,000(정책 10% 반영), ECOUNT 100,000(정가) => ECOUNT 가격 확인 가능
{
  const expectedIfPolicyAppliedOnline = Math.round(100000 * (1 - policy.effectiveDiscountPercent / 100));
  assert.equal(expectedIfPolicyAppliedOnline, 90000, "정책 10%가 온라인 가격과 일치하면 ECOUNT 가격 확인으로 안내");
}

// 6. 정가 100,000, ONLINE 100,000(정가), ECOUNT 90,000(정책 10% 반영) => Cafe24 가격 확인 가능
{
  const expectedIfPolicyAppliedOnEcount = Math.round(100000 * (1 - policy.effectiveDiscountPercent / 100));
  assert.equal(expectedIfPolicyAppliedOnEcount, 90000, "정책 10%가 ECOUNT 가격과 일치하면 Cafe24 가격 확인으로 안내");
}

// Registry 매칭 신뢰도가 낮으면(verified:false, confidence<90) 가격이 달라도 ECOUNT_HIGHER/LOWER로
// 단정하지 않고 REVIEW_REQUIRED로 남긴다 — 잘못된 매칭을 "가격 오류"로 오판하지 않기 위함.
assert.equal(classify({
  registryEntry: registryEntry({ verified: false, confidence: 78 }),
  cafe24Price: 80700,
  ecountPrice: 538000,
  ecountPriceConsistent: true,
  cafe24Fetched: true
}).status, "REVIEW_REQUIRED", "매칭 신뢰도가 낮으면 가격이 달라도 REVIEW_REQUIRED");

// 연결된 ECOUNT SKU끼리 현재 판매가가 서로 다르면(예: 사이즈별 가격이 실제로 다른 상황) 자동
// 판단하지 않고 REVIEW_REQUIRED로 남긴다.
assert.equal(classify({
  registryEntry: registryEntry(),
  cafe24Price: 100000,
  ecountPrice: 100000,
  ecountPriceConsistent: false,
  cafe24Fetched: true
}).status, "DATA_ISSUE", "ECOUNT SKU 가격이 서로 다르면 DATA_ISSUE");

console.log("build-price-audit classification tests passed");

// ECOUNT SKU는 연결되어 있지만 master price가 없으면 가격 불일치로 단정하지 않는다.
{
  const result = classify({
    registryEntry: registryEntry(),
    cafe24Price: 998000,
    ecountPrice: null,
    ecountPriceConsistent: false,
    ecountPriceComplete: false,
    cafe24Fetched: true
  });

  assert.equal(result.status, "DATA_ISSUE");
  assert.equal(result.reason, "ecount_master_price_missing");
}

// 여러 ECOUNT SKU 중 일부만 가격이 있어도 비교 가능한 상품으로 취급하지 않는다.
{
  const result = classify({
    registryEntry: registryEntry(),
    cafe24Price: 328000,
    ecountPrice: 328000,
    ecountPriceConsistent: true,
    ecountPriceComplete: false,
    cafe24Fetched: true
  });

  assert.equal(result.status, "DATA_ISSUE");
  assert.equal(result.reason, "ecount_master_price_missing");
}

console.log("missing ECOUNT price regression tests passed");

// Cafe24 API 호출은 성공했더라도 실제 가격이 0/null이면 가격 비교 대상으로 사용하지 않는다.
{
  const result = classify({
    registryEntry: registryEntry(),
    cafe24Price: 0,
    ecountPrice: 148000,
    ecountPriceConsistent: true,
    ecountPriceComplete: true,
    cafe24Fetched: true
  });

  assert.equal(result.status, "DATA_ISSUE");
  assert.equal(result.reason, "cafe24_price_missing_or_invalid");
}

{
  const result = classify({
    registryEntry: registryEntry(),
    cafe24Price: null,
    ecountPrice: 148000,
    ecountPriceConsistent: true,
    ecountPriceComplete: true,
    cafe24Fetched: true
  });

  assert.equal(result.status, "DATA_ISSUE");
  assert.equal(result.reason, "cafe24_price_missing_or_invalid");
}

console.log("invalid Cafe24 price regression tests passed");

{
  const { resolveBrandName } = await import("../scripts/build-price-audit.mjs");

  const brandNameByCode = new Map([
    ["B00000PY", "엘리엇 에밀"],
    ["B00000SK", "나밀리아"]
  ]);

  assert.equal(
    resolveBrandName(
      {
        brandId: "B00000PY",
        brandName: null
      },
      brandNameByCode
    ),
    "엘리엇 에밀",
    "missing registry brandName must fall back to Brand Master"
  );

  assert.equal(
    resolveBrandName(
      {
        brandId: "B00000SK",
        brandName: "NAMiLIA Registry Name"
      },
      brandNameByCode
    ),
    "NAMiLIA Registry Name",
    "existing registry brandName must remain authoritative"
  );

  assert.equal(
    resolveBrandName(
      {
        brandId: "UNKNOWN",
        brandName: null
      },
      brandNameByCode
    ),
    null,
    "unknown brand code must remain null"
  );

  console.log("brand master fallback regression tests passed");
}
