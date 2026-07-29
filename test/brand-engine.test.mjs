// SAMPLAS Brand Engine Lite (STEP 34-1) — scripts/brand-engine.mjs 테스트.
// 순수 함수만 검증한다(파일 I/O 없음). work/brand-master.json은 이 테스트에서 읽지 않으며,
// 실제 스키마를 흉내 낸 합성(synthetic) 데이터만 사용한다.
//
// 정책 문서화(테스트에도 명시):
// - resolveBrand는 정확 일치만 수행한다(fuzzy/includes/startsWith 금지).
// - buildBrandRegistry의 alias 충돌 정책: 동일 alias가 서로 다른 brandId에 연결되면
//   그 alias는 registry.aliases에서 완전히 제외되어 resolveBrand로 절대 해결되지 않는다
//   (어느 brandId도 임의로 선택하지 않는다). 같은 brandId 내부의 중복 alias는 하나로 정리된다.
// - parseBrandAliases는 server.mjs의 기존 동작(배열/문자열 지원, HTML entity 포함
//   normalizeBrandName 적용, 빈 값 제거)에 "중복 제거"를 추가한 것으로, 이번 STEP 지시사항이
//   명시적으로 요구한 사양이다. work/brand-master.json의 모든 브랜드가 현재 name_aliases: []
//   (빈 배열)이므로 이 dedupe 추가는 현재 운영 데이터에 영향이 없다.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeBrandCode,
  normalizeBrandName,
  normalizeBrandKey,
  parseBrandAliases,
  buildBrandRegistry,
  resolveBrand,
  extractBracketBrandCandidate,
  extractSlashBrandCandidate
} from "../scripts/brand-engine.mjs";

// ---------------------------------------------------------------------------
// normalizeBrandCode
// ---------------------------------------------------------------------------
test("normalizeBrandCode: 정상 문자열", () => {
  assert.equal(normalizeBrandCode("B00000HD"), "B00000HD");
});

test("normalizeBrandCode: 앞뒤 공백 제거", () => {
  assert.equal(normalizeBrandCode("  B00000HD  "), "B00000HD");
});

test("normalizeBrandCode: null/undefined는 빈 문자열", () => {
  assert.equal(normalizeBrandCode(null), "");
  assert.equal(normalizeBrandCode(undefined), "");
});

// ---------------------------------------------------------------------------
// normalizeBrandName
// ---------------------------------------------------------------------------
test("normalizeBrandName: 일반 문자열", () => {
  assert.equal(normalizeBrandName("SUNDAYOFFCLUB"), "SUNDAYOFFCLUB");
});

test("normalizeBrandName: 연속 공백 정리", () => {
  assert.equal(normalizeBrandName("SUNDAY   OFF    CLUB"), "SUNDAY OFF CLUB");
  assert.equal(normalizeBrandName("  SUNDAY OFF CLUB  "), "SUNDAY OFF CLUB");
});

test("normalizeBrandName: HTML entity 디코딩", () => {
  assert.equal(normalizeBrandName("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(normalizeBrandName("R&amp;D LAB"), "R&D LAB");
  assert.equal(normalizeBrandName("A&#38;B"), "A&B"); // 숫자 엔티티(&#38; = &)
  assert.equal(normalizeBrandName("A&#x26;B"), "A&B"); // 16진수 엔티티(&#x26; = &)
  assert.equal(normalizeBrandName("A&unknown;B"), "A&unknown;B"); // 미등록 named entity는 원문 그대로 유지(fallback)
});

test("normalizeBrandName: null/undefined는 빈 문자열", () => {
  assert.equal(normalizeBrandName(null), "");
  assert.equal(normalizeBrandName(undefined), "");
});

// ---------------------------------------------------------------------------
// normalizeBrandKey
// ---------------------------------------------------------------------------
test("normalizeBrandKey: 대소문자 무시", () => {
  assert.equal(normalizeBrandKey("SUNDAYOFFCLUB"), normalizeBrandKey("sundayoffclub"));
  assert.equal(normalizeBrandKey("SunDayOffClub"), normalizeBrandKey("SUNDAYOFFCLUB"));
});

test("normalizeBrandKey: NFKC 정규화(전각/반각 등)", () => {
  // 전각 라틴 대문자 "Ａ" (U+FF21) → NFKC 정규화 시 반각 "A"로 통합되어야 한다
  assert.equal(normalizeBrandKey("ＡBC"), normalizeBrandKey("ABC"));
});

test("normalizeBrandKey: 구분문자(스마트따옴표/대시) 정규화", () => {
  assert.equal(normalizeBrandKey("BRAND’S"), normalizeBrandKey("BRAND'S"));
  assert.equal(normalizeBrandKey("A–B"), normalizeBrandKey("A-B")); // en dash → hyphen
});

test("normalizeBrandKey: 빈 값", () => {
  assert.equal(normalizeBrandKey(""), "");
  assert.equal(normalizeBrandKey(null), "");
});

// ---------------------------------------------------------------------------
// parseBrandAliases
// ---------------------------------------------------------------------------
test("parseBrandAliases: 배열 입력", () => {
  assert.deepEqual(parseBrandAliases(["Alpha", "Beta"]), ["Alpha", "Beta"]);
});

test("parseBrandAliases: 쉼표/줄바꿈 문자열 입력", () => {
  assert.deepEqual(parseBrandAliases("Alpha,Beta"), ["Alpha", "Beta"]);
  assert.deepEqual(parseBrandAliases("Alpha\nBeta"), ["Alpha", "Beta"]);
});

test("parseBrandAliases: 중복 제거(정규화 키 기준)", () => {
  assert.deepEqual(parseBrandAliases(["Alpha", "alpha", "  ALPHA  "]), ["Alpha"]);
  assert.deepEqual(parseBrandAliases("Alpha,alpha,ALPHA"), ["Alpha"]);
});

test("parseBrandAliases: 빈 값 제거", () => {
  assert.deepEqual(parseBrandAliases(["Alpha", "", "   ", null]), ["Alpha"]);
  assert.deepEqual(parseBrandAliases(""), []);
  assert.deepEqual(parseBrandAliases(null), []);
});

// ---------------------------------------------------------------------------
// buildBrandRegistry
// ---------------------------------------------------------------------------
test("buildBrandRegistry: 정상 브랜드 2개", () => {
  const registry = buildBrandRegistry({
    brands: [
      { brand_code: "B001", brand_name: "ALPHA", name_aliases: ["ALFA"], active: true },
      { brand_code: "B002", brand_name: "BETA", name_aliases: [], active: true }
    ]
  });
  assert.equal(registry.brands.length, 2);
  assert.equal(registry.brands[0].id, "B001");
  assert.equal(registry.brands[0].name, "ALPHA");
  assert.deepEqual(registry.brands[0].aliases, ["ALFA"]);
  assert.equal(registry.aliases.length, 1);
  assert.equal(registry.aliases[0].alias, "ALFA");
  assert.equal(registry.aliases[0].brandId, "B001");
});

test("buildBrandRegistry: 동일 브랜드 내부 alias 중복은 하나로 정리", () => {
  const registry = buildBrandRegistry({
    brands: [
      { brand_code: "B001", brand_name: "ALPHA", name_aliases: ["ALFA", "alfa", "  ALFA  "], active: true }
    ]
  });
  const alfaEntries = registry.aliases.filter((a) => normalizeBrandKey(a.alias) === normalizeBrandKey("ALFA"));
  assert.equal(alfaEntries.length, 1);
  assert.equal(alfaEntries[0].brandId, "B001");
});

test("buildBrandRegistry: 서로 다른 브랜드 간 alias 충돌 시 완전 제외(임의 선택 없음)", () => {
  const registry = buildBrandRegistry({
    brands: [
      { brand_code: "B001", brand_name: "ALPHA", name_aliases: ["SHARED"], active: true },
      { brand_code: "B002", brand_name: "BETA", name_aliases: ["SHARED"], active: true }
    ]
  });
  const sharedEntries = registry.aliases.filter((a) => normalizeBrandKey(a.alias) === normalizeBrandKey("SHARED"));
  assert.equal(sharedEntries.length, 0, "충돌 alias는 registry.aliases에서 완전히 제외되어야 한다");
  // 브랜드 자체는 여전히 2개 모두 존재해야 한다(브랜드 목록 자체를 삭제하지 않음)
  assert.equal(registry.brands.length, 2);
});

test("buildBrandRegistry: 비활성 브랜드도 목록에 포함되고 active:false로 표시됨", () => {
  const registry = buildBrandRegistry({
    brands: [
      { brand_code: "B003", brand_name: "GAMMA", name_aliases: [], active: false }
    ]
  });
  assert.equal(registry.brands.length, 1);
  assert.equal(registry.brands[0].active, false);
});

test("buildBrandRegistry: brand_code 없는 항목은 건너뜀(server.mjs와 동일)", () => {
  const registry = buildBrandRegistry({
    brands: [
      { brand_code: "", brand_name: "NO CODE", name_aliases: [], active: true },
      { brand_code: "B004", brand_name: "DELTA", name_aliases: [], active: true }
    ]
  });
  assert.equal(registry.brands.length, 1);
  assert.equal(registry.brands[0].id, "B004");
});

test("buildBrandRegistry: 배열 입력도 지원", () => {
  const registry = buildBrandRegistry([{ brand_code: "B005", brand_name: "EPSILON", name_aliases: [], active: true }]);
  assert.equal(registry.brands.length, 1);
  assert.equal(registry.brands[0].id, "B005");
});

// ---------------------------------------------------------------------------
// resolveBrand
// ---------------------------------------------------------------------------
const sampleRegistry = buildBrandRegistry({
  brands: [
    { brand_code: "B001", brand_name: "ALPHA BRAND", name_aliases: ["ALFA", "ALPHA-ALT"], active: true },
    { brand_code: "B002", brand_name: "BETA BRAND", name_aliases: [], active: true }
  ]
});

test("resolveBrand: name exact match", () => {
  const result = resolveBrand("ALPHA BRAND", sampleRegistry);
  assert.deepEqual(result, { brandId: "B001", name: "ALPHA BRAND", matchedBy: "name" });
});

test("resolveBrand: id exact match", () => {
  const result = resolveBrand("B002", sampleRegistry);
  assert.deepEqual(result, { brandId: "B002", name: "BETA BRAND", matchedBy: "id" });
});

test("resolveBrand: alias exact match", () => {
  const result = resolveBrand("ALFA", sampleRegistry);
  assert.deepEqual(result, { brandId: "B001", name: "ALPHA BRAND", matchedBy: "alias" });
});

test("resolveBrand: 대소문자 정규화 후에도 일치", () => {
  const result = resolveBrand("alpha brand", sampleRegistry);
  assert.deepEqual(result, { brandId: "B001", name: "ALPHA BRAND", matchedBy: "name" });
});

test("resolveBrand: 알 수 없는 브랜드는 null", () => {
  assert.equal(resolveBrand("UNKNOWN BRAND XYZ", sampleRegistry), null);
});

test("resolveBrand: 유사 문자열은 null(fuzzy 금지)", () => {
  // "ALPHA BRANDD"는 "ALPHA BRAND"와 한 글자 차이지만 정확 일치가 아니므로 null이어야 한다
  assert.equal(resolveBrand("ALPHA BRANDD", sampleRegistry), null);
});

test("resolveBrand: substring은 null(부분 일치 금지)", () => {
  // "ALPHA"는 "ALPHA BRAND"의 substring이지만 정확 일치가 아니므로 null이어야 한다
  assert.equal(resolveBrand("ALPHA", sampleRegistry), null);
  assert.equal(resolveBrand("BRAND", sampleRegistry), null);
});

test("resolveBrand: 충돌 alias는 null(임의 선택 금지)", () => {
  const conflictRegistry = buildBrandRegistry({
    brands: [
      { brand_code: "B010", brand_name: "GAMMA", name_aliases: ["SHARED"], active: true },
      { brand_code: "B011", brand_name: "DELTA", name_aliases: ["SHARED"], active: true }
    ]
  });
  assert.equal(resolveBrand("SHARED", conflictRegistry), null);
});

test("resolveBrand: 빈 입력은 null", () => {
  assert.equal(resolveBrand("", sampleRegistry), null);
  assert.equal(resolveBrand(null, sampleRegistry), null);
});

// ---------------------------------------------------------------------------
// extractBracketBrandCandidate
// ---------------------------------------------------------------------------
test("extractBracketBrandCandidate: 단일 브랜드 '[BRAND : 한글명] 상품명'", () => {
  const result = extractBracketBrandCandidate("[SUNDAYOFFCLUB : 선데이오프클럽] Goat Keyring");
  assert.deepEqual(result, { type: "single", candidate: "SUNDAYOFFCLUB" });
});

test("extractBracketBrandCandidate: 콜라보 소문자 x", () => {
  const result = extractBracketBrandCandidate("[KOIN SEOUL x MEANTIME] Garment dyed jacket");
  assert.deepEqual(result, { type: "collab", candidates: ["KOIN SEOUL", "MEANTIME"] });
});

test("extractBracketBrandCandidate: 콜라보 대문자 X", () => {
  const result = extractBracketBrandCandidate("[KOIN SEOUL X KIMYO] Gear Warmers Keyring");
  assert.deepEqual(result, { type: "collab", candidates: ["KOIN SEOUL", "KIMYO"] });
});

test("extractBracketBrandCandidate: 잘못된 형식은 null", () => {
  assert.equal(extractBracketBrandCandidate("상품명만 있음"), null); // 대괄호 없음
  assert.equal(extractBracketBrandCandidate("[BRAND 상품명"), null); // 닫는 대괄호 없음
  assert.equal(extractBracketBrandCandidate("[] 상품명"), null); // 빈 대괄호
  assert.equal(extractBracketBrandCandidate(""), null);
  assert.equal(extractBracketBrandCandidate(null), null);
});

// ---------------------------------------------------------------------------
// extractSlashBrandCandidate
// ---------------------------------------------------------------------------
test("extractSlashBrandCandidate: 정상 'BRAND / 상품명'", () => {
  const result = extractSlashBrandCandidate("SUNDAYOFFCLUB / Goat Keyring");
  assert.deepEqual(result, { candidate: "SUNDAYOFFCLUB", rest: "Goat Keyring" });
});

test("extractSlashBrandCandidate: 공백 변형(슬래시 앞 공백 없음/여러 공백)", () => {
  assert.deepEqual(extractSlashBrandCandidate("MIDNIGHT/ Flow Flared Jeans"), {
    candidate: "MIDNIGHT",
    rest: "Flow Flared Jeans"
  });
  assert.deepEqual(extractSlashBrandCandidate("BRAND   /   상품명"), {
    candidate: "BRAND",
    rest: "상품명"
  });
});

test("extractSlashBrandCandidate: slash 없으면 null", () => {
  assert.equal(extractSlashBrandCandidate("상품명만 있음"), null);
  assert.equal(extractSlashBrandCandidate(""), null);
  assert.equal(extractSlashBrandCandidate(null), null);
});

test("extractSlashBrandCandidate: 슬래시 앞이 빈 문자열이면 null", () => {
  assert.equal(extractSlashBrandCandidate(" / 상품명"), null);
});
