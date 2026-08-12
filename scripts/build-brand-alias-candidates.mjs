// SAMPLAS Marketing OS — Brand Alias Candidate Builder (STEP62-4)
//
// 목적: ECOUNT 판매 라인의 brandGroup(ECOUNT 원본 컬럼명 "품목그룹1명" — ECOUNT 자체
// 내부 품목 그룹 분류이지 공인된 브랜드 필드가 아니다, scripts/load-ecount-offline-sales.mjs:187
// 참고) 원본 코드들을 사람이 검토할 Alias Candidate 목록(Review Queue)으로 정리한다.
//
// 절대 하지 않는 것:
// - work/brand-master.json을 읽기만 하고 절대 쓰지 않는다.
// - 어떤 Candidate도 자동 승인하지 않는다(전부 status: "REVIEW").
// - fuzzy/substring/접두사 추측을 하지 않는다. "XXX CO" 접미사를 제거해 매칭하지 않는다.
// - brandGroup 값 자체를 증거로 취급하지 않는다(scripts/brand-engine.mjs STEP34-1 정책과
//   동일한 원칙 — brandGroup은 오직 아래 3번 조회의 "조회 키"로만 쓰이고, 실제 근거(evidence)는
//   항상 Brand Master의 이미 확정된 alias 또는 work/product-registry.json의 이미 검증된
//   Cafe24↔ECOUNT 상품 매칭 결과에서만 나온다.
//
// 사용하는 증거 소스(모두 읽기 전용):
// 1. work/brand-master.json — brand_name/name_aliases와 brandGroup 코드의 정확 일치(대소문자/
//    공백만 정규화, 부분 일치 없음).
// 2. work/product-registry.json — Cafe24↔ECOUNT 상품 매칭 diagnostic(STEP 관련 이전 작업,
//    mode: product_registry_phase1_diagnostic_only). 각 entry의 ecount.matchedProducts[].prodCd
//    앞부분이 brandGroup 코드와 정확히 일치하는 경우만 사용한다(prodCd는 ECOUNT 자체 상품
//    코드 체계이며, 이 STEP은 그 코드의 앞부분과 brandGroup 코드 문자열이 정확히 같은지만
//    비교한다 — 접두사를 잘라내거나 변형하지 않는다). entry.verified===true(Phase 1에서
//    "exact_one_to_one"만 verified로 표시됨, 문서화된 policy)인 매칭만 HIGH로 취급한다.
//
// ECOUNT 운영 코드 정책(지시사항 그대로):
// - "<3글자> CO" 형태(예: "BON CO")는 위탁/운영 그룹 신호로 간주하고 canonical brand 후보
//   생성을 시도하지 않는다(OPERATIONAL_GROUP으로 분리, "CO" 제거 후 매칭 절대 금지).
// - 비-ASCII 문자가 섞인 코드(예: "QQQ 퀵")는 특수/운영 그룹으로 간주하고 후보 생성을
//   시도하지 않는다(SPECIAL_GROUP으로 분리).

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizeUpper(value) {
  return String(value ?? "").trim().toUpperCase();
}

// Brand Master 정확 일치(대소문자/공백만 정규화) — 부분/추론 매칭 없음.
function exactBrandMasterMatch(code, brandMaster) {
  const normalized = normalizeUpper(code);
  if (!normalized) return null;
  for (const brand of brandMaster.brands || []) {
    const candidates = [brand.brand_name, ...(brand.name_aliases || [])];
    if (candidates.some((c) => normalizeUpper(c) === normalized)) return brand;
  }
  return null;
}

async function main() {
  // ---- 1. ECOUNT brandGroup 수집(전체 월, "before-" 백업 파일 제외) ----
  const ecountDir = join(root, "work/ecount-sales");
  const files = (await readdir(ecountDir))
    .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
    .sort();

  const brandGroupStats = new Map(); // code -> { count, months: Set }
  for (const file of files) {
    const monthKey = file.replace(".json", "");
    const data = await loadJson(join(ecountDir, file));
    const lines = Array.isArray(data.salesLines) ? data.salesLines : (Array.isArray(data.rows) ? data.rows : []);
    for (const line of lines) {
      const code = String(line?.brandGroup ?? "").trim();
      if (!code) continue;
      if (!brandGroupStats.has(code)) brandGroupStats.set(code, { count: 0, months: new Set() });
      const stat = brandGroupStats.get(code);
      stat.count += 1;
      stat.months.add(monthKey);
    }
  }

  // ---- 2. Brand Master(읽기 전용) ----
  const brandMaster = await loadJson(join(root, "work/brand-master.json"));
  const brandsById = new Map((brandMaster.brands || []).map((b) => [b.brand_code, b]));

  // ---- 3. Product Registry(읽기 전용) — prodCd 접두사(=코드 전체 길이만큼) -> 매칭 브랜드들 ----
  const registry = await loadJson(join(root, "work/product-registry.json"));
  const prefixToMatches = new Map(); // upper(prefix) -> [{brandId, brandName, verified, confidence, status, prodCd, canonicalProductId}]
  for (const entry of registry.entries || []) {
    const matched = entry.ecount?.matchedProducts || [];
    for (const m of matched) {
      const prodCd = String(m?.prodCd || "");
      if (!prodCd) continue;
      // 코드 길이만큼만 접두사로 쓴다(각 brandGroup 코드 자체 길이 기준으로 나중에 비교) —
      // 여기서는 흔한 3글자 접두사로 인덱싱해 두고, 비교 시 실제 코드 길이로 slice해 비교한다.
      const prefix3 = prodCd.slice(0, 3).toUpperCase();
      if (!prefixToMatches.has(prefix3)) prefixToMatches.set(prefix3, []);
      prefixToMatches.get(prefix3).push({
        brandId: entry.brandId,
        brandName: entry.brandName,
        verified: Boolean(entry.verified),
        confidence: entry.confidence,
        status: entry.status,
        prodCd,
        canonicalProductId: entry.canonicalProductId
      });
    }
  }

  // ---- 4. 코드 분류 + Candidate 생성 ----
  const operationalGroup = [];
  const specialGroup = [];
  const candidates = [];
  const unresolved = [];
  const ambiguous = [];

  const codes = [...brandGroupStats.keys()].sort();
  for (const code of codes) {
    const stat = brandGroupStats.get(code);
    const baseInfo = { raw_alias: code, transaction_count: stat.count, months: [...stat.months].sort() };

    if (/\sCO$/.test(code)) {
      operationalGroup.push({ ...baseInfo, reason: "위탁/운영 그룹 신호(\"<코드> CO\" 형태) — canonical brand 후보 생성 시도하지 않음(CO 제거 매칭 금지)" });
      continue;
    }
    if (/[^\x00-\x7f]/.test(code)) {
      specialGroup.push({ ...baseInfo, reason: "비-ASCII 문자 포함(예: 물류/배송 관련 태그로 추정) — 근거 없이 브랜드로 매핑하지 않음" });
      continue;
    }

    // 4-1. Brand Master 정확 일치
    const masterMatch = exactBrandMasterMatch(code, brandMaster);
    // 4-2. Product Registry prodCd 정확 접두사 일치(코드 길이만큼)
    const prefixCandidates = (prefixToMatches.get(code.slice(0, 3).toUpperCase()) || [])
      .filter((m) => m.prodCd.slice(0, code.length).toUpperCase() === normalizeUpper(code));

    const distinctBrandIds = new Set(prefixCandidates.map((m) => m.brandId));

    if (masterMatch) {
      candidates.push({
        raw_alias: code,
        canonical_brand: masterMatch.brand_name,
        brand_code: masterMatch.brand_code,
        confidence: "HIGH",
        evidence: [`brand_master_exact_match: brand_master.json의 brand_name "${masterMatch.brand_name}"(${masterMatch.brand_code})와 원본 코드가 정확히 일치`],
        transaction_count: stat.count,
        months: [...stat.months].sort(),
        status: "REVIEW"
      });
      continue;
    }

    if (distinctBrandIds.size > 1) {
      ambiguous.push({
        ...baseInfo,
        candidates: prefixCandidates.map((m) => ({ brandId: m.brandId, brandName: m.brandName, verified: m.verified, prodCd: m.prodCd })),
        reason: "동일 원본 코드가 product-registry.json에서 서로 다른 canonical brand로 매칭됨 — 자동 선택하지 않음"
      });
      continue;
    }

    if (prefixCandidates.length > 0) {
      const anyVerified = prefixCandidates.some((m) => m.verified);
      const brandName = prefixCandidates[0].brandName;
      const brandId = prefixCandidates[0].brandId;
      const brandInMaster = brandsById.get(brandId);
      const confidence = anyVerified ? "HIGH" : "MEDIUM";
      candidates.push({
        raw_alias: code,
        canonical_brand: brandInMaster ? brandInMaster.brand_name : brandName,
        brand_code: brandId,
        confidence,
        evidence: prefixCandidates.slice(0, 5).map((m) => `product_registry: prodCd "${m.prodCd}" -> brandId ${m.brandId}(${m.brandName}), verified=${m.verified}, status=${m.status}, confidence=${m.confidence}`),
        transaction_count: stat.count,
        months: [...stat.months].sort(),
        status: "REVIEW"
      });
      continue;
    }

    unresolved.push({ ...baseInfo, reason: "Brand Master 정확 일치 없음, product-registry.json에 동일 코드로 시작하는 검증된 ECOUNT 상품 코드(prodCd) 없음" });
  }

  // ---- 5. Validation: canonical brand가 실제 Brand Master에 존재하는지 확인 ----
  const validationFailures = [];
  for (const c of candidates) {
    if (!brandsById.has(c.brand_code)) {
      validationFailures.push({ raw_alias: c.raw_alias, brand_code: c.brand_code, reason: "brand_code가 work/brand-master.json에 존재하지 않음" });
    }
  }

  const summary = {
    ecountUniqueBrandGroupTotal: codes.length,
    brandMasterExactMatch: candidates.filter((c) => c.evidence[0].startsWith("brand_master_exact_match")).length,
    candidateGenerated: candidates.length,
    unresolvedCount: unresolved.length,
    ambiguousCount: ambiguous.length,
    operationalGroupCount: operationalGroup.length,
    specialGroupCount: specialGroup.length,
    validationFailureCount: validationFailures.length
  };

  const output = {
    generatedAt: new Date().toISOString(),
    step: "STEP62-4",
    sourceFiles: [
      "work/ecount-sales/*.json (2026-01 ~ 2026-08, before-백업 파일 제외)",
      "work/brand-master.json (읽기 전용)",
      "work/product-registry.json (읽기 전용)"
    ],
    policy: {
      autoApprove: false,
      note: "이 목록의 모든 항목은 status:REVIEW이며 사람이 검토하기 전까지 Brand Master에 반영되지 않는다."
    },
    summary,
    candidates,
    ambiguous,
    unresolved,
    operationalGroup,
    specialGroup,
    validationFailures
  };

  const outPath = join(root, "work/brand-alias-review-queue.json");
  await writeFile(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
