// SAMPLAS Category Master v1 — deterministic classification policy (2026-08 update).
//
// This is the canonical Node-side copy of the classification rules, imported directly by
// scripts/audit-product-identity-category-compression.mjs. outputs/samplas-marketing-os.js
// is a plain (non-module) browser <script>, so it cannot import this file — it carries a
// hand-ported copy of the same constants/logic instead (see the "BI-BATCH-I — SAMPLAS
// Category Master v1" block there). Keep both in sync; test/category-classification-parity.
// test.mjs cross-checks a shared fixture set against both copies to catch drift.
//
// Priority (highest wins):
//   1) manual override (work/category-master.json manualOverrides/modelAssignments — applied
//      by the caller, not this module)
//   2) individual model/product exception (INDIVIDUAL_MODEL_EXCEPTIONS below — confirmed by
//      user inventory review, not a general rule)
//   3) confirmed ECOUNT suffix (CATEGORY_ECOUNT_SUFFIX_MAP) or RESURRECITON 13 internal code
//      (product name only carries a brand-internal code, suffix is unusable for this brand)
//   4) product-name tail-first keyword match (CATEGORY_NAME_KEYWORD_RULES) — when multiple
//      category keywords appear in a name, the one closest to the end of the string wins
//      (fashion naming convention: descriptors first, the actual item noun last)
//   5) UNCLASSIFIED
//
// Never calls an LLM/AI API — purely deterministic string rules.

export const CATEGORY_ECOUNT_SUFFIX_MAP = {
  BG: "BAG", BT: "BOTTOM", SH: "TOP", JW: "JEWELRY", FW: "FOOTWEAR", OT: "OUTER", HW: "HEADWEAR",
  ST: "TOP", LT: "TOP", HD: "TOP", DR: "DRESS", AC: "ACCESSORY", ACC: "ACCESSORY"
};

export const CATEGORY_ECOUNT_SUBCATEGORY_MAP = {
  BG: "BAG", BT: "BOTTOM", SH: "SHIRT", JW: "JEWELRY", FW: "FOOTWEAR", OT: "OUTER", HW: "HEADWEAR",
  ST: "SHORT_SLEEVE", LT: "LONG_SLEEVE", HD: "HOODIE", DR: "DRESS", AC: "ACCESSORY", ACC: "ACCESSORY"
};

// 2026-08 inventory review: these brands' AC-suffixed ECOUNT codes were audited and found to
// actually be FOOTWEAR/BAG items miscoded as AC at the source (e.g. ALIVEFORM "STRATUM
// RUNNER", ADIDAS X AVAVAV "AVAVAV SST VACUUM LEATHER") — not a semantic ACCESSORY meaning
// for this brand. Do not trust the AC/ACC suffix for these brands; fall through to the
// name/exception tiers instead. This does NOT invalidate the AC formula for any other brand.
export const AC_SUFFIX_DISTRUST_BRANDS = new Set(["424", "ALIVEFORM", "ADIDAS X AVAVAV"]);

// 정확히 하나의 카테고리 키워드만 매칭되면 그 카테고리를 반환하는 게 아니라(구v1), 매칭된
// 키워드 중 상품명에서 가장 뒤(tail)에 위치한 것을 우선한다 — "SCAR BOOT CUT PANTS"처럼
// 앞쪽 서술어(BOOT)보다 뒤쪽 실제 품목(PANTS)이 진짜 카테고리인 실제 명명 관행 때문이다.
// 후보가 전혀 없으면 null(다음 우선순위로 이관), 동률(같은 끝 위치)이면 추측하지 않고 null.
export const CATEGORY_NAME_KEYWORD_RULES = [
  ["TOP", [
    "t-shirt", "t-shirts", "tshirt", "tshirts", "t - shirt", "t - shirts", "t-shrit", "tee", "t",
    "short sleeve", "half sleeve", "sleeveless", "long sleeve", "longsleeve", "longtee",
    "top", "corset", "bra", "bodysuit", "body suit", "shirt", "shirts", "blouse", "polo",
    "tank top", "tank", "cardigan", "sweater", "sweatshirt", "crew neck", "hoodie", "knit",
    "jersey top", "jumper", "후드", "스웨터"
  ]],
  ["BOTTOM", [
    "pants", "trousers", "trouser", "trourser", "troursers", "jeans", "jean", "denim pants",
    "shorts", "short", "micro-short", "skirt", "skort", "slacks", "sweatpants",
    "leggings", "legging", "panty", "denim", "바지", "baji"
  ]],
  ["OUTER", [
    "jacket", "자켓", "coat", "blazer", "vest", "parka", "bomber", "ma-1", "wind breaker",
    "windbreaker", "trucker", "outer", "후리스", "후드집업", "집업", "zip-up", "zip up", "hooded zip"
  ]],
  ["DRESS", ["dress", "one-piece", "jumpsuit"]],
  ["BAG", ["bag", "backpack", "tote", "shopper", "pouch"]],
  ["FOOTWEAR", ["boots", "boot", "shoe", "shoes", "sneaker", "sneakers", "mule", "sandal", "sandals", "loafer"]],
  ["HEADWEAR", ["cap", "hat", "beanie", "beret", "headwear"]],
  ["JEWELRY", ["necklace", "ring", "earring", "earrings", "bracelet", "bangle", "chain jewelry", "pendant", "dog tag"]],
  ["ACCESSORY", [
    "belt", "wallet", "keyring", "key chain", "scarf", "tie", "gloves", "glove", "sunglasses",
    "eyewear", "socks", "accessory", "card holder", "card case", "leg warmer", "arm warmer",
    "hands warmers", "warmers", "mittens", "bandana", "bandanna", "stocking", "phone grip"
  ]],
  ["OTHER", ["underwear", "swimwear", "overall", "set up", "set-up", "setup", "set_up", "bikini"]]
];

// 매칭된 키워드가 명확히 하나의 표준 소분류로 이어지는 경우만 subcategoryCode를 채운다
// (섹션 2의 "권장 예시" 목록에 없는 세부 품목은 대분류만 반환 — 억지로 만들지 않는다).
const SUBCATEGORY_BY_KEYWORD = {
  "hoodie": "HOODIE", "후드": "HOODIE",
  "long sleeve": "LONG_SLEEVE", "longsleeve": "LONG_SLEEVE", "longtee": "LONG_SLEEVE",
  "short sleeve": "SHORT_SLEEVE", "t-shirt": "SHORT_SLEEVE", "t-shirts": "SHORT_SLEEVE",
  "tshirt": "SHORT_SLEEVE", "t - shirt": "SHORT_SLEEVE", "t - shirts": "SHORT_SLEEVE",
  "t-shrit": "SHORT_SLEEVE", "tee": "SHORT_SLEEVE",
  "shirt": "SHIRT", "blouse": "SHIRT",
  "dress": "DRESS", "one-piece": "DRESS", "jumpsuit": "DRESS",
  "bag": "BAG", "backpack": "BAG", "tote": "BAG", "shopper": "BAG", "pouch": "BAG",
  "underwear": "UNDERWEAR", "swimwear": "SWIMWEAR", "bikini": "SWIMWEAR",
  "overall": "OVERALL",
  "set up": "SET_UP", "set-up": "SET_UP", "setup": "SET_UP", "set_up": "SET_UP"
};

const HANGUL_ONLY = /^[가-힣]+$/;

// \b(ASCII \w 전용)는 한글에서 전혀 동작하지 않는다(한글은 \w가 아니라서 경계가 안 생김).
// ASCII/혼합 키워드는 유니코드 인식 경계(앞뒤에 글자/숫자가 오면 매칭 안 함)로 SHIRRING의
// RING, HORSESHOE의 SHOE 같은 부분 문자열 오검출을 막는다. 순수 한글 키워드는 한국어 압축
// 복합어(후드집업 = 후드+집업, 공백 없음) 특성상 경계 매칭이 아예 실패하므로 의도적으로
// 무경계 부분 문자열 매칭을 쓴다(이 카탈로그의 통제된 소수 한글 용어에서는 오검출 위험이
// 낮다 — ponytail: 한글은 경계 없는 substring, 향후 대규모 한글 카탈로그가 생기면 형태소
// 분석기 도입 검토).
function categoryKeywordPattern(keyword) {
  const esc = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (HANGUL_ONLY.test(keyword)) return new RegExp(esc, "i");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "iu");
}

// 상품명 안에서 매칭된 키워드 중 가장 뒤(tail)에 위치한 것 하나를 고른다. 동률(같은 끝
// 위치)이면 추측하지 않고 null.
function matchCategoryByNameKeywordsDetailed(productName) {
  const normalized = String(productName || "");
  if (!normalized.trim()) return null;
  let best = null;
  for (const [category, keywords] of CATEGORY_NAME_KEYWORD_RULES) {
    for (const keyword of keywords) {
      const match = categoryKeywordPattern(keyword).exec(normalized);
      if (!match) continue;
      const endIndex = match.index + match[0].length;
      if (!best || endIndex > best.endIndex) {
        best = { endIndex, category, subcategoryCode: SUBCATEGORY_BY_KEYWORD[keyword.toLowerCase()] || null };
      } else if (endIndex === best.endIndex && category !== best.category) {
        best.tie = true;
      }
    }
  }
  if (!best || best.tie) return null;
  return { code: best.category, subcategoryCode: best.subcategoryCode };
}

export function matchCategoryByNameKeywords(productName) {
  return matchCategoryByNameKeywordsDetailed(productName)?.code || null;
}

export function ecountCategorySuffixFromProdCd(prodCd) {
  const match = String(prodCd || "").match(/([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return CATEGORY_ECOUNT_SUFFIX_MAP[match[1].toUpperCase()] || null;
}

// 레거시 QQQ 계열 코드는 "BRAND / 상품명"이 아니라 "[BRAND : 한글이름] 상품명" 형식을
// 쓴다(예: "[SURGERY : 써저리] SS008 triangle") — 두 형식 모두 지원한다.
const BRACKET_BRAND_PATTERN = /^\[([^:\]]+?)(?:\s*:[^\]]*)?\]/;

export function deriveBrandFromProductName(productName) {
  const text = String(productName || "");
  const bracketMatch = BRACKET_BRAND_PATTERN.exec(text);
  if (bracketMatch) return bracketMatch[1].trim().toUpperCase() || "UNASSIGNED";
  const [brand, rest] = text.split("/");
  return rest === undefined ? "UNASSIGNED" : brand.trim().toUpperCase() || "UNASSIGNED";
}

export const RESURRECTION_13_BRAND = "RESURRECITON 13";
const RESURRECTION_13_CODE_MAP = { T: "TOP", B: "BOTTOM", O: "OUTER", AC: "ACCESSORY" };
const RESURRECTION_13_CODE_PATTERN = /\b(\d{2})-([A-Za-z]{1,3})(\d+)\b/;

// RESURRECITON 13은 POP/QQQ 바코드 끝 suffix가 항상 RES로 잡혀 카테고리 판단에 쓸 수
// 없다 — 상품명 안의 내부 품번(예: 25-T090)을 대신 읽는다. 이 브랜드일 때만 적용한다.
export function resurrectionThirteenInternalCode(brand, productName) {
  if (brand !== RESURRECTION_13_BRAND) return null;
  const match = RESURRECTION_13_CODE_PATTERN.exec(String(productName || ""));
  if (!match) return null;
  const code = RESURRECTION_13_CODE_MAP[match[2].toUpperCase()];
  return code ? { code, subcategoryCode: code === "TOP" ? null : null } : null;
}

// 전역 규칙으로 일반화하지 않는 개별 확정 예외 — 실사용 재고 검수에서 사용자가 하나씩
// 확인한 모델/상품 단위 override. brand는 deriveBrandFromProductName() 결과와 비교하고
// (null이면 브랜드 무관), includes는 상품명 부분 문자열(대소문자 무시)로 매칭한다.
export const INDIVIDUAL_MODEL_EXCEPTIONS = [
  // SURGERY process 번호 — 이름에 품목 정보가 전혀 없어 규칙화 불가, 개별 확정.
  { brand: "SURGERY", includes: "process 006", code: "BOTTOM" },
  { brand: "SURGERY", includes: "process 009", code: "BOTTOM" },
  { brand: "SURGERY", includes: "process 013", code: "TOP" },
  { brand: "SURGERY", includes: "process 014", code: "BOTTOM" },
  { brand: "SURGERY", includes: "process 015", code: "TOP" },
  { brand: "SURGERY", includes: "process 021", code: "TOP" },
  { brand: "SURGERY", includes: "process 026", code: "BOTTOM" },
  { brand: "SURGERY", includes: "process 027", code: "TOP" },
  { brand: "SURGERY", includes: "process 028", code: "BOTTOM" },
  { brand: "SURGERY", includes: "process 029", code: "TOP" },
  { brand: "SURGERY", includes: "process 031", code: "BOTTOM" },
  { brand: "SURGERY", includes: "process 032", code: "OUTER" },
  { brand: null, includes: "ss008 triangle", code: "ACCESSORY" },
  // DOMINNICO
  { brand: null, includes: "logo heart rong", code: "ACCESSORY", subcategoryCode: null },
  { brand: "DOMINNICO", includes: "pink moto pagoda shoulders", code: "OUTER" },
  // 2026-08-15 사용자 확인: LACE SLEEVES는 탈부착 액세서리가 아니라 상의 구성품(TOP).
  { brand: "DOMINNICO", includes: "lace sleeves", code: "TOP" },
  // SUPER POSITION
  { brand: "SUPER POSITION", includes: "pinch lm", code: "TOP", subcategoryCode: "SHIRT" },
  { brand: "SUPER POSITION", includes: "stm", code: "TOP", subcategoryCode: "SHIRT" },
  { brand: null, includes: "sp0834", code: "TOP", subcategoryCode: "SHORT_SLEEVE" },
  // KIMYO
  { brand: "KIMYO", includes: "petal texture shirring overfit", code: "TOP", subcategoryCode: "SHIRT" },
  { brand: "KIMYO", includes: "saturn layers set-up", code: "OTHER", subcategoryCode: "SET_UP" },
  { brand: "KIMYO", includes: "tasselled multi wear", code: "ACCESSORY" },
  { brand: "KIMYO", includes: "tech hooded zip fullsuit", code: "OTHER", subcategoryCode: "OVERALL" },
  // SUNDAYOFFCLUB
  { brand: "SUNDAYOFFCLUB", includes: "cow leather puffy sleeve park", code: "OUTER" },
  { brand: "SUNDAYOFFCLUB", includes: "fascination distressed t-shrit", code: "TOP", subcategoryCode: "SHORT_SLEEVE" },
  { brand: "SUNDAYOFFCLUB", includes: "wakame studded bet", code: "ACCESSORY" },
  { brand: "SUNDAYOFFCLUB", includes: "layered racing shirt with camouflage short", code: "BOTTOM" },
  { brand: "SUNDAYOFFCLUB", includes: "waxed black denim", code: "BOTTOM" },
  // 2026-08-15 사용자 확인: 목걸이가 아니라 액세서리(머니클립 체인)로 확정.
  { brand: "SUNDAYOFFCLUB", includes: "montmartre cross moneyclip chain", code: "ACCESSORY" },
  // 604SERVICE
  { brand: "604SERVICE", includes: "hard to get boxer brief", code: "OTHER", subcategoryCode: "UNDERWEAR" },
  { brand: "604SERVICE", includes: "classic thong", code: "OTHER", subcategoryCode: "UNDERWEAR" },
  { brand: "604SERVICE", includes: "biker banding sweat panty", code: "BOTTOM" },
  // BONNAE
  { brand: "BONNAE", includes: "graphic bikini", code: "OTHER", subcategoryCode: "SWIMWEAR" },
  { brand: "BONNAE", includes: "star rivet pleated skort", code: "BOTTOM" },
  // KANGJUNGSEOK
  { brand: "KANGJUNGSEOK", includes: "origami circle torusers", code: "BOTTOM" },
  { brand: "KANGJUNGSEOK", includes: "pleats hood", code: "TOP" },
  // LOADING ROOM
  { brand: "LOADING ROOM", includes: "dirty trucker", code: "OUTER" },
  // RASSVET (브랜드 접두어 없는 한글 상품명)
  { brand: null, includes: "라스벳 보드 - 1", code: "ACCESSORY" },
  { brand: null, includes: "라스벳 보드 - 2", code: "ACCESSORY" },
  // CARNET
  { brand: "CARNET ARCHIVE", includes: "oil-submerged arm guard", code: "ACCESSORY" },
  // 2026-08-15 사용자 확인: 목걸이가 아니라 액세서리(체인 프래그먼트)로 확정.
  { brand: "CARNET ARCHIVE", includes: "unearthed fragment chain", code: "ACCESSORY" },
  // 424 / ALIVEFORM / ADIDAS X AVAVAV — AC suffix 신뢰 불가(위 AC_SUFFIX_DISTRUST_BRANDS)
  // 브랜드의 이름만으로는 못 푸는 모델들.
  { brand: "424", includes: "dragonrider", code: "FOOTWEAR" },
  { brand: "424", includes: "marathon cowboy", code: "FOOTWEAR" },
  { brand: "ALIVEFORM", includes: "stratum runner", code: "FOOTWEAR" },
  { brand: "ALIVEFORM", includes: "stratum derby", code: "FOOTWEAR" },
  { brand: "ALIVEFORM", includes: "stratum talon", code: "FOOTWEAR" },
  { brand: "ALIVEFORM", includes: "spiralis oxford", code: "FOOTWEAR" },
  { brand: "ALIVEFORM", includes: "flaine l", code: "FOOTWEAR" },
  { brand: "ALIVEFORM", includes: "armis high", code: "FOOTWEAR" },
  { brand: "ALIVEFORM", includes: "armis low", code: "FOOTWEAR" },
  { brand: "ALIVEFORM", includes: "laptop case", code: "BAG" },
  { brand: "ADIDAS X AVAVAV", includes: "sst vacuum", code: "FOOTWEAR" },
  { brand: "ADIDAS X AVAVAV", includes: "bubble gb", code: "FOOTWEAR" },
  { brand: "ADIDAS X AVAVAV", includes: "megaride", code: "FOOTWEAR" },
  { brand: "ADIDAS X AVAVAV", includes: "band set", code: "ACCESSORY" },
  { brand: "ADIDAS X AVAVAV", includes: "kneesocks", code: "ACCESSORY" }
];

export function matchIndividualModelException(brand, productName) {
  const name = String(productName || "").toLowerCase();
  for (const exception of INDIVIDUAL_MODEL_EXCEPTIONS) {
    if (exception.brand && exception.brand !== brand) continue;
    if (!name.includes(exception.includes)) continue;
    return { code: exception.code, subcategoryCode: exception.subcategoryCode || null };
  }
  return null;
}

// 실제 상품이 아닌 결제/운영 편의성 라인(할인, 퀵비 등) — Category Master 분류 대상과
// Category Review 검수 대상 양쪽에서 제외한다. OTHER로 억지 분류하지 않는다.
export const EXCLUDED_PRODUCT_CODES = new Set(["00000", "00001", "00002", "A0001", "MAKE001", "QQQ00262"]);

export function isExcludedProductCode(productCode) {
  return EXCLUDED_PRODUCT_CODES.has(String(productCode || ""));
}

// productNo(Cafe24) 기준 manual override는 호출자가 overrides로 전달한다(work/category-
// master.json — 이 모듈은 그 파일을 모른다, 순수 분류 로직만 담당).
export function classifyProductCategory({ productNo, productName, prodCd, overrides } = {}) {
  const override = overrides instanceof Map
    ? overrides.get(String(productNo || ""))
    : overrides?.byProductNo?.get(String(productNo || "")) || overrides?.byProductCode?.get(String(prodCd || ""));
  if (override) return { code: override, subcategoryCode: null, source: "manual_override" };

  const brand = deriveBrandFromProductName(productName);

  const exception = matchIndividualModelException(brand, productName);
  if (exception) return { ...exception, source: "model_exception" };

  const resurrection = resurrectionThirteenInternalCode(brand, productName);
  if (resurrection) return { ...resurrection, source: "resurrection13_internal_code" };

  const suffix = String(prodCd || "").match(/([A-Za-z]+)(\d+)$/)?.[1]?.toUpperCase() || null;
  const suffixIsAcLike = suffix === "AC" || suffix === "ACC";
  if (suffix && !(suffixIsAcLike && AC_SUFFIX_DISTRUST_BRANDS.has(brand))) {
    const suffixCode = CATEGORY_ECOUNT_SUFFIX_MAP[suffix];
    if (suffixCode) return { code: suffixCode, subcategoryCode: CATEGORY_ECOUNT_SUBCATEGORY_MAP[suffix] || null, source: "ecount_suffix" };
  }

  const nameMatch = matchCategoryByNameKeywordsDetailed(productName);
  if (nameMatch) return { ...nameMatch, source: "name_rule" };

  return { code: "UNCLASSIFIED", subcategoryCode: null, source: "fallback" };
}
