// SAMPLAS Marketing OS — Unified Identity Resolver Foundation (STEP63-2, STEP63-2B에서 확장)
//
// STEP63-1(work/reports/STEP63-1-resolver-spec.md)이 확정한 Resolver Contract를 그대로
// 구현한다. 여전히 어떤 기존 화면/API에도 연결하지 않는다(server.mjs/intelligence-
// service.mjs/outputs/*는 이 모듈을 import하지 않는다).
//
// STEP63-2B: STEP63-2A Shadow Reconciliation에서 확인한 두 사각지대를 합치기 위해
// Priority 2(Product Name Resolver)에 "온라인 카탈로그 레지스트리"를 **선택적 2차
// 조회원**으로 추가했다(Brand Master Constitution 준수 원칙 2/4/5 — Brand Master를
// 대체하지 않고, 그 위에 이미 검증된 값만 조회하는 얇은 층을 하나 더한다):
// - 1차: Brand Master(brand_name/name_aliases) 정확 일치(기존 그대로, 최우선).
// - 2차(신규, 선택적): Brand Master에서 못 찾았을 때만, "그 기간 온라인 Cafe24 카탈로그"에
//   등록된 brand_name과 정확 일치하는지 확인한다 — Resolver F(scripts/monthly-brand-
//   sales.mjs)가 온라인 카탈로그를 레지스트리로 쓰는 것과 동일한 아이디어이지만, 새 매칭
//   알고리즘을 작성하지 않고 brand-engine.mjs의 buildBrandRegistry/resolveBrand를 온라인
//   카탈로그 데이터에 그대로 재적용한다(입력 모양만 Brand Master와 동일하게 맞춘다).
//   이 2차 조회로 찾은 brand_code도 반드시 Brand Master에 실재해야 한다(아래
//   validateOnlineCatalogRegistry에서 그렇지 않은 항목은 등록 자체를 제외한다 — "Brand
//   Master에 없는 canonical을 새로 만들면 FAIL" 계약).
//
// 원칙(STEP63-1 + Project Constitution 그대로):
// - Identity Resolver는 매출을 계산하지 않는다("이 판매행이 누구인가"까지만 답한다).
// - brandGroup은 Canonical Identity 판정 근거로 절대 쓰지 않는다(operational 필드로만 동봉).
// - Monthly Resolver F/brand-engine.mjs의 파싱 로직을 새로 구현하지 않는다 — 두 모듈의
//   함수를 그대로 import해서 쓴다(brand-engine.mjs 자체는 이번 STEP에서도 수정하지 않는다).
// - fuzzy/substring 추측 없음. 임의의 confidence 숫자만으로 자동 승격하지 않는다.
// - work/brand-master.json, work/product-registry.json을 읽기만 하고 절대 쓰지 않는다.
// - 모든 resolved brand.brandCode는 반드시 Brand Master에 실재해야 한다(새 canonical
//   저장소를 만들지 않는다 — Brand Master가 유일한 Source of Truth).

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBrandRegistry,
  resolveBrand,
  extractBracketBrandCandidate,
  extractSlashBrandCandidate
} from "./brand-engine.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");

// ---------------------------------------------------------------------------
// Context 로딩(읽기 전용). resolveIdentity() 자체는 순수 함수로 유지하고, 파일 I/O는
// 이 헬퍼에서만 수행한다 — 테스트/향후 호출자가 원하는 시점에 한 번만 로딩해 재사용할 수
// 있도록 분리했다(같은 파일을 매 호출마다 다시 읽지 않는다).
// ---------------------------------------------------------------------------
async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

// 온라인 Cafe24 카탈로그(/api/diagnostics/brand-sales 응답의 brands[]/products[])를 Brand
// Master와 동일한 입력 모양({ brands: [{ brand_code, brand_name, name_aliases }] })으로
// 바꿔 buildBrandRegistry에 그대로 넣는다 — 새 registry 빌더를 작성하지 않는다. Brand
// Master에 실재하지 않는 brand_code는 등록에서 제외한다("Brand Master에 없는 canonical을
// 새로 만들면 FAIL" 계약, Constitution 3/4번 항목).
//
// products[]도 함께 훑는 이유(Resolver F와 동일한 동작을 재현하기 위한 필수 단계):
// brands[].brand_name은 Brand Master의 한글 표시명 그대로라(예: "본네") ECOUNT productName
// 에서 뽑은 영문 후보("BONNAE")와 정확히 일치하지 않는다. Resolver F(scripts/monthly-
// brand-sales.mjs의 buildResolver)는 이 문제를 "온라인 상품 하나하나의 productName"에서도
// extractBracketBrandCandidate로 영문 후보를 추가로 뽑아 같은 brand_code에 등록해 두는
// 방식으로 해결한다 — 이 STEP은 그 동작을 새 알고리즘 없이 그대로 재현한다(extract 함수는
// brand-engine.mjs에서 가져온 것 그대로, 여기서는 "어느 리스트에 적용할지"만 다르다).
function buildOnlineCatalogRegistry(onlineCatalog, brandMaster) {
  const brands = Array.isArray(onlineCatalog?.brands) ? onlineCatalog.brands : [];
  const products = Array.isArray(onlineCatalog?.products) ? onlineCatalog.products : [];
  if (!brands.length) return { brands: [], aliases: [] };
  const brandMasterCodes = new Set((brandMaster?.brands || []).map((b) => b.brand_code));

  const aliasesByCode = new Map(); // brand_code -> Set(영문 후보)
  for (const product of products) {
    const code = String(product?.brand_code || product?.brandCode || "").trim();
    if (!code || code === "UNASSIGNED" || !brandMasterCodes.has(code)) continue;
    const candidate = extractBracketBrandCandidate(product?.productName || product?.product_name);
    if (candidate?.type !== "single") continue; // 콜라보는 등록하지 않는다(brand-engine.mjs 원칙 그대로).
    if (!aliasesByCode.has(code)) aliasesByCode.set(code, new Set());
    aliasesByCode.get(code).add(candidate.candidate);
  }

  const shaped = {
    brands: brands
      .filter((b) => b.brand_code && b.brand_code !== "UNASSIGNED" && brandMasterCodes.has(b.brand_code))
      .map((b) => ({
        brand_code: b.brand_code,
        brand_name: b.brand_name,
        name_aliases: [...(aliasesByCode.get(b.brand_code) || [])]
      }))
  };
  return buildBrandRegistry(shaped);
}

export async function loadResolverContext({ workDir: overrideWorkDir, onlineCatalog } = {}) {
  const dir = overrideWorkDir || workDir;
  const [brandMaster, productRegistry, reviewQueue] = await Promise.all([
    readJsonIfExists(join(dir, "brand-master.json")),
    readJsonIfExists(join(dir, "product-registry.json")),
    readJsonIfExists(join(dir, "brand-alias-review-queue.json"))
  ]);
  const resolvedBrandMaster = brandMaster || { brands: [] };
  return {
    brandMaster: resolvedBrandMaster,
    brandRegistry: buildBrandRegistry(resolvedBrandMaster),
    // onlineCatalog는 이 함수의 파라미터로 "이미 호출자가 읽어 온" 데이터만 받는다(이
    // 모듈 스스로 Cafe24 API를 호출하지 않는다 — Identity Resolver는 데이터를 가져오지
    // 않고 판정만 한다). 넘기지 않으면 온라인 카탈로그 2차 조회 없이 STEP63-2와 동일하게
    // 동작한다(하위 호환).
    onlineCatalogRegistry: onlineCatalog ? buildOnlineCatalogRegistry(onlineCatalog, resolvedBrandMaster) : null,
    productRegistry: productRegistry || { entries: [] },
    reviewQueue: reviewQueue || null
  };
}

// ---------------------------------------------------------------------------
// Priority 1: Verified Product Registry Identity.
// work/product-registry.json의 entries[].ecount.matchedProducts[].prodCd/barcode 또는
// entries[].cafe24.productNo가 입력과 정확히 일치하고, 그 entry가 status:"confirmed" +
// verified:true인 경우만 채택한다(STEP63-1 8번 항목: 임의 confidence 숫자로 자동 승격 금지).
// ---------------------------------------------------------------------------
function resolveViaProductRegistry(input, productRegistry) {
  const entries = Array.isArray(productRegistry?.entries) ? productRegistry.entries : [];
  const ecountProdCd = input.ecountProdCd ? String(input.ecountProdCd).trim() : "";
  const barcode = input.barcode ? String(input.barcode).trim() : "";
  const cafe24ProductNo = input.cafe24ProductNo ? String(input.cafe24ProductNo).trim() : "";
  if (!ecountProdCd && !barcode && !cafe24ProductNo) return null;

  for (const entry of entries) {
    if (entry?.verified !== true || entry?.status !== "confirmed") continue;
    if (cafe24ProductNo && String(entry?.cafe24?.productNo || "").trim() === cafe24ProductNo) {
      return { entry, matchedVia: "cafe24_product_no" };
    }
    const matched = (entry?.ecount?.matchedProducts || []).find((product) => (
      (ecountProdCd && String(product?.prodCd || "").trim() === ecountProdCd) ||
      (barcode && String(product?.barcode || "").trim() === barcode)
    ));
    if (matched) {
      return { entry, matchedVia: matched.prodCd === ecountProdCd ? "ecount_prod_cd" : "barcode" };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Priority 2: Product Name Resolver. Monthly Resolver F(scripts/monthly-brand-sales.mjs
// candidateFromProductName)와 정확히 동일한 순서(대괄호 단일 표기 우선 → 슬래시 표기)로
// 후보를 추출한 뒤, work/brand-master.json 기준 registry(buildBrandRegistry/resolveBrand,
// 둘 다 brand-engine.mjs에서 그대로 가져온 함수)로 정확 일치만 확인한다. 콜라보 상품
// (extractBracketBrandCandidate가 type:"collab"을 반환)은 단일 브랜드로 좁히지 않고
// ambiguous로 처리한다(brand-engine.mjs의 기존 원칙 그대로).
// ---------------------------------------------------------------------------
function resolveViaProductName(productName, brandRegistry, onlineCatalogRegistry) {
  if (!productName) return { outcome: "missing_product_identity" };

  const bracket = extractBracketBrandCandidate(productName);
  if (bracket?.type === "collab") {
    return { outcome: "ambiguous_product_match", candidates: bracket.candidates };
  }
  const candidateText = bracket?.type === "single"
    ? bracket.candidate
    : extractSlashBrandCandidate(productName)?.candidate || null;

  if (!candidateText) return { outcome: "missing_product_identity" };

  // 1차: Brand Master 정확 일치(기존 STEP63-2 그대로, 최우선).
  const brandMasterHit = resolveBrand(candidateText, brandRegistry);
  if (brandMasterHit) {
    return { outcome: "resolved", resolved: brandMasterHit, candidateText, registrySource: "brand_master" };
  }

  // 2차(STEP63-2B 신규, 선택적): 그 기간 온라인 카탈로그에 등록된 이름과 정확 일치하는지
  // 확인한다(Resolver F의 강점 흡수, buildOnlineCatalogRegistry로 이미 Brand Master
  // 존재 여부까지 검증된 registry만 여기 들어온다). onlineCatalogRegistry가 없으면(호출자가
  // 넘기지 않았으면) 이 단계는 건너뛴다 — STEP63-2와 동일하게 동작(하위 호환).
  if (onlineCatalogRegistry) {
    const catalogHit = resolveBrand(candidateText, onlineCatalogRegistry);
    if (catalogHit) {
      return { outcome: "resolved", resolved: catalogHit, candidateText, registrySource: "online_catalog" };
    }
  }

  // resolveBrand()는 "후보와 정확히 일치하는 브랜드가 0개"와 "충돌(복수 브랜드가 같은
  // alias를 주장)" 둘 다 null로 반환한다(brand-engine.mjs 6번 항목 문서 그대로, 이 모듈은
  // 그 동작을 변경하지 않는다). 대괄호 콜라보(collab)는 이미 위에서 별도로 걸러냈으므로,
  // 여기 도달한 null은 "후보 텍스트는 뽑았지만 Brand Master/온라인 카탈로그 어디에도
  // 해당 브랜드/alias가 없다"는 뜻이다 — missing_brand_master로 분류한다(STEP63-1 11번
  // 항목 표 그대로).
  return { outcome: "missing_brand_master", candidateText };
}

// ---------------------------------------------------------------------------
// Priority 3: Reviewed Brand Alias. STEP63-2 지시사항 그대로 — 아직 사람이 승인한 alias
// 데이터가 없으므로(work/brand-alias-review-queue.json의 모든 candidate는 status:"REVIEW",
// STEP62-4 산출물, 승인된 항목 없음) 이 함수는 항상 null을 반환하는 placeholder다. 향후
// review queue에 "APPROVED" 같은 승인 상태가 생기면 이 함수만 채우면 되도록 구조를
// 미리 만들어 둔다(호출부/Output Contract는 이미 이 자리를 갖고 있다).
// ---------------------------------------------------------------------------
function resolveViaReviewedAlias(rawText, reviewQueue) {
  if (!rawText || !reviewQueue) return null;
  const approved = (reviewQueue.candidates || []).find((candidate) => (
    candidate.status === "APPROVED" &&
    String(candidate.raw_alias || "").trim().toUpperCase() === String(rawText).trim().toUpperCase()
  ));
  if (!approved) return null; // 현재 데이터에는 APPROVED 상태가 없어 항상 이 분기로 빠진다(placeholder).
  return {
    brandId: approved.brand_code,
    name: approved.canonical_brand,
    evidence: approved.evidence || []
  };
}

// ---------------------------------------------------------------------------
// resolveIdentity(): STEP63-1 Output Contract 그대로 반환한다. 순수 함수 — 파일 I/O 없음,
// 매출/수량 계산 없음(9번 항목: Identity Resolution ≠ Sales Calculation).
//
// input:
//   { productName, ecountProdCd, barcode, cafe24ProductNo, brandGroup }
//   (전부 optional — 있는 값만 채워 넣는다. 공통 인터페이스이므로 Cafe24만 있거나
//   ECOUNT만 있어도 동작한다.)
// context: loadResolverContext()의 반환값(또는 동일 shape의 { brandRegistry,
//   productRegistry, brandMaster, reviewQueue }).
// ---------------------------------------------------------------------------
export function resolveIdentity(input = {}, context = {}) {
  const { brandRegistry, productRegistry, reviewQueue, brandMaster, onlineCatalogRegistry } = context;
  const operational = { brandGroup: input.brandGroup || null };

  // Priority 1: Verified Product Registry.
  const registryHit = resolveViaProductRegistry(input, productRegistry);
  if (registryHit) {
    const { entry, matchedVia } = registryHit;
    const inMaster = (brandMaster?.brands || []).some((b) => b.brand_code === entry.brandId);
    return {
      resolved: true,
      productIdentity: {
        barcode: input.barcode || null,
        ecountProdCd: input.ecountProdCd || null,
        cafe24ProductNo: input.cafe24ProductNo || entry?.cafe24?.productNo || null,
        productName: input.productName || entry?.cafe24?.productName || null,
        matchedVia
      },
      brand: {
        brandCode: entry.brandId,
        canonicalName: entry.brandName,
        confidence: inMaster ? "VERIFIED" : "CANDIDATE"
      },
      operational,
      evidence: [`product_registry_verified: ${matchedVia}가 status:confirmed, verified:true 항목과 정확히 일치`],
      source: "product_registry",
      unresolvedReason: null
    };
  }

  // Priority 2: Product Name Resolver(Monthly Resolver F와 동일 규칙, brand-engine.mjs 재사용).
  // STEP63-2B: Brand Master(1차)에 없으면 온라인 카탈로그(2차, 있을 때만)까지 시도한다.
  const nameResult = resolveViaProductName(input.productName, brandRegistry, onlineCatalogRegistry);
  if (nameResult.outcome === "resolved") {
    const registryLabel = nameResult.registrySource === "online_catalog" ? "온라인 카탈로그" : "Brand Master";
    return {
      resolved: true,
      productIdentity: {
        barcode: input.barcode || null,
        ecountProdCd: input.ecountProdCd || null,
        cafe24ProductNo: input.cafe24ProductNo || null,
        productName: input.productName,
        matchedVia: "product_name_" + nameResult.resolved.matchedBy
      },
      brand: {
        brandCode: nameResult.resolved.brandId,
        canonicalName: nameResult.resolved.name,
        // STEP63-1 8번 항목: 사람 승인이 없으면 REVIEWED를 자동으로 주지 않는다.
        // productName 텍스트가 registry의 이름/alias와 정확히 일치했을 뿐, 이 특정
        // 판매행이 사람 검토를 거친 것은 아니므로 CANDIDATE로 남긴다(1차/2차 모두 동일).
        confidence: "CANDIDATE"
      },
      operational,
      evidence: [`product_name_exact_match: "${nameResult.candidateText}"가 ${registryLabel}의 이름/alias와 정확히 일치(${nameResult.resolved.matchedBy})`],
      source: nameResult.registrySource === "online_catalog" ? "product_name_resolver_online_catalog" : "product_name_resolver",
      unresolvedReason: null
    };
  }

  // Priority 3: Reviewed Brand Alias(placeholder — 승인된 alias 데이터가 아직 없음).
  const reviewedHit = resolveViaReviewedAlias(input.brandGroup || nameResult.candidateText, reviewQueue);
  if (reviewedHit) {
    return {
      resolved: true,
      productIdentity: {
        barcode: input.barcode || null,
        ecountProdCd: input.ecountProdCd || null,
        cafe24ProductNo: input.cafe24ProductNo || null,
        productName: input.productName || null,
        matchedVia: "reviewed_alias"
      },
      brand: {
        brandCode: reviewedHit.brandId,
        canonicalName: reviewedHit.name,
        confidence: "REVIEWED"
      },
      operational,
      evidence: reviewedHit.evidence,
      source: "brand_master_alias_reviewed",
      unresolvedReason: null
    };
  }

  // Priority 4 / Unresolved: brandGroup은 canonical 판정에 절대 쓰지 않는다 — operational
  // 필드로만 동봉하고, resolved:false로 남긴다(STEP63-1 4번/11번 항목). nameResult.outcome은
  // 이미 STEP63-1 표의 값(missing_product_identity/ambiguous_product_match/
  // missing_brand_master) 중 하나이므로 그대로 사용한다.
  const unresolvedReason = nameResult.outcome || "other";

  return {
    resolved: false,
    productIdentity: {
      barcode: input.barcode || null,
      ecountProdCd: input.ecountProdCd || null,
      cafe24ProductNo: input.cafe24ProductNo || null,
      productName: input.productName || null,
      matchedVia: null
    },
    brand: null,
    operational,
    evidence: [],
    source: "unresolved",
    unresolvedReason
  };
}
