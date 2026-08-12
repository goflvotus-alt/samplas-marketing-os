// SAMPLAS Marketing OS — Unified Identity Resolver Foundation (STEP63-2) Shadow Test.
//
// 아직 어떤 화면/API에도 연결하지 않은 상태에서, resolveIdentity()가 STEP63-1 명세와
// 일치하게 동작하는지만 확인한다(파일을 쓰지 않는다 — work/brand-master.json/
// work/product-registry.json은 읽기만 한다).
//
// 정직하게 기록해 둘 사실: STEP0에서 실측한 대로 현재 work/brand-master.json의
// name_aliases는 거의 비어 있다. "BON CO"의 productName 후보("BONNAE")는 브랜드
// B00000SA의 실제 brand_name("본네", 한글)과 정확히 일치하지 않아 **오늘 시점의 실데이터
// 로는 UNRESOLVED가 정상**이다(추측 금지 원칙상 올바른 동작 — 코드 결함이 아니라 Brand
// Master에 영문 alias가 아직 등록되지 않은 것뿐). 로직 자체가 맞다는 것은 별도로 합성
// (synthetic) registry에 그 alias를 추가한 테스트로 증명한다(brand-engine.test.mjs와
// 동일한 방식).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { resolveIdentity, loadResolverContext } from "../scripts/unified-identity-resolver.mjs";
import { buildBrandRegistry } from "../scripts/brand-engine.mjs";

const realContext = await loadResolverContext();
const realBrandMasterExists = (realContext.brandMaster.brands || []).length > 0;

// ---------------------------------------------------------------------------
// 실데이터 Shadow Test 1: OUR → OURSELVES REMAKE
// work/brand-master.json에 brand_code B0000BCU의 brand_name이 정확히
// "OURSELVES REMAKE"(영문)로 등록돼 있어, productName 기반 Priority 2가 실제로
// canonical을 찾아낸다(STEP63-0에서 이미 39/39 판매행 100% 대응을 확인한 실제 사례).
// ---------------------------------------------------------------------------
test("Shadow: OUR productName → OURSELVES REMAKE(실데이터, Priority 2)", { skip: !realBrandMasterExists && "work/brand-master.json 없음" }, () => {
  const result = resolveIdentity(
    { productName: "OURSELVES REMAKE / Retread Vest -jacket", brandGroup: "OUR" },
    realContext
  );
  assert.equal(result.resolved, true);
  assert.equal(result.brand.canonicalName, "OURSELVES REMAKE");
  assert.equal(result.brand.confidence, "CANDIDATE"); // 사람 승인 전이므로 REVIEWED가 아니다.
  assert.equal(result.source, "product_name_resolver");
  assert.equal(result.operational.brandGroup, "OUR"); // brandGroup은 동봉만, 판정 근거 아님.
  assert.equal(result.unresolvedReason, null);
});

// ---------------------------------------------------------------------------
// 실데이터 Shadow Test 2: BON CO → Brand Master의 BONNAE alias로 직접 resolve.
// ---------------------------------------------------------------------------
test("Shadow: BON CO productName → BONNAE alias로 직접 resolve", { skip: !realBrandMasterExists && "work/brand-master.json 없음" }, () => {
  const result = resolveIdentity(
    { productName: "BONNAE / Studded school bag", brandGroup: "BON CO" },
    realContext
  );
  assert.equal(result.resolved, true);
  assert.equal(result.brand.brandCode, "B00000SA");
  assert.equal(result.source, "product_name_resolver");
  // brandGroup은 canonical 판정에 쓰지 않고 operational 필드로 그대로 보존된다.
  assert.equal(result.operational.brandGroup, "BON CO");
});

// ---------------------------------------------------------------------------
// 합성(synthetic) Shadow Test: 로직 자체는 BON CO → BONNAE를 정확히 처리할 수 있음을
// 증명한다(Brand Master에 영문 alias "BONNAE"가 등록됐다고 가정한 가상 registry).
// 이 테스트는 실제 work/brand-master.json을 전혀 건드리지 않는다.
// ---------------------------------------------------------------------------
test("Shadow(synthetic): BON CO productName → BONNAE(가상 alias 등록 시 Priority 2 성공)", () => {
  const syntheticBrandMaster = {
    brands: [
      { brand_code: "B00000SA", brand_name: "본네", name_aliases: ["BONNAE"], active: true }
    ]
  };
  const context = {
    brandMaster: syntheticBrandMaster,
    brandRegistry: buildBrandRegistry(syntheticBrandMaster),
    productRegistry: { entries: [] },
    reviewQueue: null
  };
  const result = resolveIdentity(
    { productName: "BONNAE / Studded school bag", brandGroup: "BON CO" },
    context
  );
  assert.equal(result.resolved, true);
  assert.equal(result.brand.canonicalName, "본네");
  assert.equal(result.brand.brandCode, "B00000SA");
  assert.equal(result.operational.brandGroup, "BON CO"); // canonical과 operational 동시 보존.
  assert.equal(result.source, "product_name_resolver");
});

// ---------------------------------------------------------------------------
// Priority 1: Verified Product Registry가 존재하면 Priority 2보다 우선한다.
// ---------------------------------------------------------------------------
test("Priority 1: verified:true product-registry entry가 있으면 VERIFIED로 즉시 반환", () => {
  const context = {
    brandMaster: { brands: [{ brand_code: "B0000BCU", brand_name: "OURSELVES REMAKE", name_aliases: [], active: true }] },
    brandRegistry: buildBrandRegistry({ brands: [{ brand_code: "B0000BCU", brand_name: "OURSELVES REMAKE", name_aliases: [], active: true }] }),
    productRegistry: {
      entries: [{
        brandId: "B0000BCU",
        brandName: "OURSELVES REMAKE",
        status: "confirmed",
        verified: true,
        cafe24: { productNo: "9999" },
        ecount: { matchedProducts: [{ prodCd: "OUR263BT00502", barcode: "OUR263BT00502" }] }
      }]
    },
    reviewQueue: null
  };
  const result = resolveIdentity({ ecountProdCd: "OUR263BT00502", productName: "OURSELVES REMAKE / X" }, context);
  assert.equal(result.resolved, true);
  assert.equal(result.brand.confidence, "VERIFIED");
  assert.equal(result.source, "product_registry");
  assert.equal(result.productIdentity.matchedVia, "ecount_prod_cd");
});

// ---------------------------------------------------------------------------
// 콜라보 상품은 단일 브랜드로 좁히지 않는다(brand-engine.mjs의 기존 원칙 그대로 재사용).
// ---------------------------------------------------------------------------
test("콜라보 상품(대괄호 x 표기)은 ambiguous_product_match로 UNRESOLVED", () => {
  const context = {
    brandMaster: { brands: [] },
    brandRegistry: buildBrandRegistry({ brands: [] }),
    productRegistry: { entries: [] },
    reviewQueue: null
  };
  const result = resolveIdentity({ productName: "[KOIN SEOUL x MEANTIME] Gear Warm Jacket" }, context);
  assert.equal(result.resolved, false);
  assert.equal(result.unresolvedReason, "ambiguous_product_match");
});

// ---------------------------------------------------------------------------
// productName조차 없으면 missing_product_identity.
// ---------------------------------------------------------------------------
test("productName 없음 → missing_product_identity", () => {
  const context = {
    brandMaster: { brands: [] },
    brandRegistry: buildBrandRegistry({ brands: [] }),
    productRegistry: { entries: [] },
    reviewQueue: null
  };
  const result = resolveIdentity({ brandGroup: "QQQ 퀵" }, context);
  assert.equal(result.resolved, false);
  assert.equal(result.unresolvedReason, "missing_product_identity");
  assert.equal(result.operational.brandGroup, "QQQ 퀵");
});

// ---------------------------------------------------------------------------
// Priority 3(Reviewed Brand Alias)는 아직 placeholder — APPROVED 상태가 없으므로
// review queue에 후보가 있어도 항상 통과하지 못하고 다음 판정(UNRESOLVED)으로 넘어간다.
// ---------------------------------------------------------------------------
test("Priority 3 placeholder: review queue에 APPROVED 상태가 없으면 통과하지 못함", () => {
  const context = {
    brandMaster: { brands: [] },
    brandRegistry: buildBrandRegistry({ brands: [] }),
    productRegistry: { entries: [] },
    reviewQueue: { candidates: [{ raw_alias: "RAC", canonical_brand: "레이서 월드 와이드", brand_code: "B00000WE", status: "REVIEW" }] }
  };
  const result = resolveIdentity({ brandGroup: "RAC" }, context);
  assert.equal(result.resolved, false); // status가 REVIEW(승인 전)이므로 placeholder는 null 반환.
});

// ---------------------------------------------------------------------------
// STEP63-2B: 온라인 카탈로그 2차 조회(선택적) — Resolver F의 강점 흡수 검증.
// 합성 온라인 카탈로그를 만들어 실제 fetch 없이 로직만 검증한다.
// ---------------------------------------------------------------------------
function syntheticOnlineCatalog() {
  return {
    brands: [
      { brand_code: "B00000SA", brand_name: "본네" },
      { brand_code: "B00000HD", brand_name: "선데이오프클럽" }
    ],
    products: [
      { brand_code: "B00000SA", productName: "[BONNAE : 본네] Studded school bag" },
      { brand_code: "B00000HD", productName: "[SUNDAY OFF CLUB : 선데이오프클럽] Logo Tee" },
      { brand_code: "B00000HD", productName: "[KOIN SEOUL x SUNDAYOFFCLUB] Collab Jacket" } // 콜라보는 등록 제외돼야 함
    ]
  };
}

test("STEP63-2B: BON CO productName → BONNAE, Brand Master 1차 조회로 성공", async () => {
  const context = await loadResolverContext({ onlineCatalog: syntheticOnlineCatalog() });
  const result = resolveIdentity({ productName: "BONNAE / Studded school bag", brandGroup: "BON CO" }, context);
  assert.equal(result.resolved, true);
  assert.equal(result.brand.canonicalName, "본네");
  assert.equal(result.brand.brandCode, "B00000SA");
  assert.equal(result.brand.confidence, "CANDIDATE");
  assert.equal(result.source, "product_name_resolver");
  assert.equal(result.operational.brandGroup, "BON CO"); // canonical과 operational 동시 보존.
});

test("STEP63-2B: SUN CO productName → SUNDAY OFF CLUB(선데이오프클럽), 온라인 카탈로그 2차 조회", async () => {
  const context = await loadResolverContext({ onlineCatalog: syntheticOnlineCatalog() });
  const result = resolveIdentity({ productName: "SUNDAY OFF CLUB / Logo Tee", brandGroup: "SUN CO" }, context);
  assert.equal(result.resolved, true);
  assert.equal(result.brand.canonicalName, "선데이오프클럽");
  assert.equal(result.operational.brandGroup, "SUN CO");
});

test("STEP63-2B: 온라인 카탈로그의 콜라보 상품은 alias로 등록되지 않는다", async () => {
  const context = await loadResolverContext({ onlineCatalog: syntheticOnlineCatalog() });
  const result = resolveIdentity({ productName: "[KOIN SEOUL x SUNDAYOFFCLUB] Collab Jacket", brandGroup: "POP CO" }, context);
  // 이 라인 자체는 콜라보 표기라 collab 분기(ambiguous_product_match)로 먼저 걸러진다 —
  // "KOIN SEOUL x SUNDAYOFFCLUB"이라는 문자열이 alias로 등록돼도 이 라인은 UNRESOLVED다.
  assert.equal(result.resolved, false);
  assert.equal(result.unresolvedReason, "ambiguous_product_match");
});

test("STEP63-2B: onlineCatalog를 넘기지 않으면 STEP63-2와 동일하게 동작(하위 호환)", async () => {
  const context = await loadResolverContext();
  assert.equal(context.onlineCatalogRegistry, null);
  const result = resolveIdentity({ productName: "BONNAE / Studded school bag", brandGroup: "BON CO" }, context);
  assert.equal(result.resolved, true);
  assert.equal(result.source, "product_name_resolver");
});

test("STEP63-2B: 온라인 카탈로그에 Brand Master에 없는 brand_code가 있으면 그 항목은 등록 제외(Brand Master 계약)", async () => {
  const catalogWithGhostCode = {
    brands: [{ brand_code: "B00000000_GHOST", brand_name: "고스트브랜드" }],
    products: [{ brand_code: "B00000000_GHOST", productName: "[GHOST : 고스트] Item" }]
  };
  const context = await loadResolverContext({ onlineCatalog: catalogWithGhostCode });
  const result = resolveIdentity({ productName: "GHOST / Item" }, context);
  assert.equal(result.resolved, false); // Brand Master에 없는 brand_code는 registry에서 아예 제외됨.
});

// ---------------------------------------------------------------------------
// loadResolverContext()가 실제로 work/brand-master.json 등을 읽어 왔는지만 확인
// (내용을 바꾸지 않았는지는 별도로 원본 파일과 diff, 아래에서 확인).
// ---------------------------------------------------------------------------
test("loadResolverContext(): work/brand-master.json을 읽기만 하고 수정하지 않는다", async () => {
  const before = await readFile(new URL("../work/brand-master.json", import.meta.url), "utf8");
  await loadResolverContext();
  const after = await readFile(new URL("../work/brand-master.json", import.meta.url), "utf8");
  assert.equal(before, after);
});
