// SAMPLAS Marketing OS — Brand Engine Lite (STEP 34-1)
//
// 이 모듈은 향후 ECOUNT 오프라인 브랜드 매출 배분(별도 STEP)에서 사용할 최소 공통
// Brand Engine이다. 이번 STEP에서는 server.mjs / intelligence-service.mjs / inventory
// 관련 파일 어디에도 연결하지 않는다(신규 모듈 + 신규 테스트만 추가).
//
// canonical source: work/brand-master.json (이 모듈은 읽기만 하며, 이 파일을 절대 쓰지 않는다)
//
// 원칙(STEP34-1 지시사항 그대로):
// - fuzzy matching 금지
// - substring/startsWith 추측 금지
// - brandGroup을 브랜드 귀속 근거로 사용 금지(이 모듈은애초에 brandGroup을 참조하지 않는다)
// - 미해결 값은 null로 남긴다(추측하지 않는다)
// - 콜라보 상품을 특정 브랜드 하나로 임의 귀속하지 않는다(extractBracketBrandCandidate가
//   콜라보를 감지하면 candidates 배열로만 반환하고 단일 브랜드로 좁히지 않는다)
// - alias 충돌 시 임의 선택하지 않는다(buildBrandRegistry/resolveBrand 참고)

// ---------------------------------------------------------------------------
// 1. normalizeBrandCode
// server.mjs의 기존 구현과 동일: 문자열 변환 + trim만 수행한다.
// ---------------------------------------------------------------------------
export function normalizeBrandCode(value) {
  return String(value ?? "").trim();
}

// ---------------------------------------------------------------------------
// 2. normalizeBrandName
// server.mjs의 기존 구현과 동일: HTML entity 디코딩(숫자/16진수/명명된 엔티티) +
// 연속 공백을 단일 공백으로 정리 + trim. 새로운 규칙을 추가하지 않는다.
// ---------------------------------------------------------------------------
const HTML_NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  Ccedil: "Ç",
  ccedil: "ç",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\""
};

export function normalizeBrandName(value) {
  return String(value ?? "")
    .replace(/&(#(\d+)|#x([0-9a-fA-F]+)|[A-Za-z][A-Za-z0-9]+);/g, (entity, _all, decimal, hex) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return HTML_NAMED_ENTITIES[_all] || entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 3. normalizeBrandKey
// intelligence-service.mjs의 기존 구현과 동일: normalizeBrandName 적용 후 NFKC 정규화,
// 스마트 따옴표/대시류 문자 치환, 공백 정리, 소문자화(en-US 로케일). fuzzy matching이
// 아니라 "같은 문자를 다르게 표기한 경우"를 하나의 키로 모으기 위한 정확한 정규화다.
// ---------------------------------------------------------------------------
export function normalizeBrandKey(value) {
  return normalizeBrandName(value)
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

// ---------------------------------------------------------------------------
// 4. parseBrandAliases
// server.mjs의 기존 구현(배열/문자열 모두 지원, normalizeBrandName 적용, 빈 값 제거)을
// 그대로 유지하되, 이번 STEP 지시사항에 명시된 "중복 제거"를 추가했다.
//
// 명시적 차이점 기록: server.mjs의 현재 parseBrandAliases는 중복을 제거하지 않는다.
// 이번 STEP 지시사항이 "중복 제거"를 명시적으로 요구했으므로 이 모듈에서는 dedupe를
// 추가했다(정규화 키 기준). work/brand-master.json의 모든 브랜드가 현재 name_aliases: []
// (빈 배열)이므로(2026-07-29 기준 288개 브랜드 전수 확인), 이 dedupe는 현재 운영 데이터에
// 대해서는 아무 동작 차이를 만들지 않는 안전한 추가다. 최종 보고서에도 동일하게 명시한다.
// ---------------------------------------------------------------------------
export function parseBrandAliases(value) {
  const list = Array.isArray(value)
    ? value.map(normalizeBrandName).filter(Boolean)
    : String(value ?? "")
        .split(/[\n,]/)
        .map(normalizeBrandName)
        .filter(Boolean);

  const seen = new Set();
  const deduped = [];
  for (const item of list) {
    const key = normalizeBrandKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// 5. buildBrandRegistry
// 입력: work/brand-master.json에서 읽은 JSON (배열 또는 { brands: [...] } 객체 모두 지원 —
// server.mjs의 readBrandMasterFile과 동일한 관용을 따른다). 원본 객체/파일은 수정하지 않는다.
//
// alias 충돌 정책(명시): 동일 alias 키(normalizeBrandKey 기준)가 서로 다른 brandId에
// 연결되면, 그 alias 키는 최종 registry.aliases 배열에서 완전히 제외한다(어느 brandId도
// 임의로 선택하지 않는다). 같은 brandId 내부에서 동일 alias가 중복 등록된 경우는 하나로
// 정리한다(첫 번째 표기를 대표값으로 유지). 이 정책은 resolveBrand가 "정확 일치 + 충돌 시
// null"을 보장하도록 하기 위함이며, 아래 test/brand-engine.test.mjs에도 동일하게 문서화한다.
// ---------------------------------------------------------------------------
export function buildBrandRegistry(brandMaster) {
  const rawBrands = Array.isArray(brandMaster)
    ? brandMaster
    : Array.isArray(brandMaster?.brands)
      ? brandMaster.brands
      : [];

  const brands = [];
  // key(normalizeBrandKey) -> { alias, brandId, source } (최초 등록자)
  const aliasOwnerByKey = new Map();
  // 서로 다른 brandId가 동일 alias key를 주장하는 경우 이 Set에 추가되고, 최종 aliases에서 제외된다.
  const conflictedKeys = new Set();

  for (const entry of rawBrands) {
    const id = normalizeBrandCode(entry?.brand_code);
    if (!id) continue; // brand_code가 없는 항목은 server.mjs의 normalizeBrandMasterEntry와 동일하게 건너뛴다

    const name = normalizeBrandName(entry?.brand_name);
    const brandAliases = parseBrandAliases(entry?.name_aliases);
    const active = entry?.active === undefined ? true : Boolean(entry.active);

    brands.push({ id, name, aliases: brandAliases, active });

    for (const alias of brandAliases) {
      const key = normalizeBrandKey(alias);
      if (!key) continue;
      const existing = aliasOwnerByKey.get(key);
      if (!existing) {
        aliasOwnerByKey.set(key, { alias, brandId: id, source: "name_alias" });
      } else if (existing.brandId !== id) {
        conflictedKeys.add(key);
      }
      // existing.brandId === id (같은 브랜드 내부 중복) → 이미 등록되어 있으므로 무시(정리 완료)
    }
  }

  const aliases = [];
  for (const [key, owner] of aliasOwnerByKey.entries()) {
    if (conflictedKeys.has(key)) continue; // 충돌 alias는 resolve 대상에서 완전히 제외
    aliases.push(owner);
  }

  return { brands, aliases };
}

// ---------------------------------------------------------------------------
// 6. resolveBrand
// canonical name / brand id / alias exact match 후보를 모두 수집한 뒤 brandId 기준으로
// 중복 제거한다. active 후보가 하나면 우선 반환하고, active 후보가 없을 때만 inactive
// 단독 후보를 fallback으로 반환한다. 같은 상태의 후보가 여러 개면 임의 선택하지 않는다.
// ---------------------------------------------------------------------------
export function resolveBrand(input, registry) {
  const key = normalizeBrandKey(input);
  if (!key) return null;

  const brands = registry?.brands || [];
  const aliasList = registry?.aliases || [];
  const candidates = new Map();
  const addCandidate = (brand, matchedBy) => {
    if (!brand?.id || candidates.has(brand.id)) return;
    candidates.set(brand.id, { brand, matchedBy });
  };

  for (const brand of brands) {
    if (brand?.name && normalizeBrandKey(brand.name) === key) addCandidate(brand, "name");
  }
  for (const brand of brands) {
    if (brand?.id && normalizeBrandKey(brand.id) === key) addCandidate(brand, "id");
  }
  for (const entry of aliasList) {
    if (entry?.alias && normalizeBrandKey(entry.alias) === key) {
      const brand = brands.find((item) => item.id === entry.brandId);
      if (brand) addCandidate(brand, "alias");
    }
  }

  const active = [...candidates.values()].filter(({ brand }) => brand.active !== false);
  const eligible = active.length ? active : [...candidates.values()].filter(({ brand }) => brand.active === false);
  if (eligible.length !== 1) return null;
  const [{ brand, matchedBy }] = eligible;
  return { brandId: brand.id, name: brand.name, matchedBy };
}

// ---------------------------------------------------------------------------
// 7. extractBracketBrandCandidate
// "[BRAND : 한글명] 상품명" → { type:"single", candidate:"BRAND" }
// "[BRAND1 x BRAND2] 상품명" / "[BRAND1 X BRAND2] 상품명" → { type:"collab", candidates:[...] }
// 판단 불가(선행 대괄호 없음, 닫는 대괄호 없음, 대괄호 내용이 빈 문자열) → null
// 콜라보는 특정 브랜드 하나로 resolve하지 않는다(candidates 배열만 반환).
// ---------------------------------------------------------------------------
export function extractBracketBrandCandidate(productName) {
  const raw = String(productName ?? "");
  const match = raw.match(/^\s*\[\s*([^\]]*?)\s*\]/);
  if (!match) return null;

  const content = match[1].trim();
  if (!content) return null;

  const collabParts = content.split(/\s[xX]\s/).map((part) => part.trim()).filter(Boolean);
  if (collabParts.length >= 2) {
    return { type: "collab", candidates: collabParts };
  }

  const colonIndex = content.search(/[:：]/);
  if (colonIndex !== -1) {
    const candidate = content.slice(0, colonIndex).trim();
    if (!candidate) return null;
    return { type: "single", candidate };
  }

  return { type: "single", candidate: content };
}

// ---------------------------------------------------------------------------
// 8. extractSlashBrandCandidate
// "BRAND / 상품명" → { candidate:"BRAND", rest:"상품명" } (슬래시 앞뒤 공백 유무 무관)
// 슬래시가 없거나 슬래시 앞부분이 빈 문자열이면 null.
// ---------------------------------------------------------------------------
export function extractSlashBrandCandidate(productName) {
  const raw = String(productName ?? "");
  const slashIndex = raw.indexOf("/");
  if (slashIndex === -1) return null;

  const candidate = raw.slice(0, slashIndex).trim();
  if (!candidate) return null;

  const rest = raw.slice(slashIndex + 1).trim();
  return { candidate, rest };
}
