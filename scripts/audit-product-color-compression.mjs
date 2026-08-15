#!/usr/bin/env node
// SAMPLAS Product Color Master — COLOR PHASE 1: READ-ONLY DISCOVERY AUDIT.
//
// 이 스크립트는 work/ecount-inventory/latest.json을 읽기만 한다. 어떤 원본 파일도 쓰지
// 않고, 색상 canonicalization(예: GREY=GRAY, OFF WHITE=WHITE) 결정도 내리지 않는다 —
// 그건 이 audit 결과를 사람이 검토한 뒤 별도로 결정할 일이다. 이 스크립트는 상품명에
// 실제로 어떤 색상 표현이 어떤 빈도로 쓰이고 있는지 "발견"만 한다.
//
// 모델 단위 그룹핑(brandFromName/modelBaseName/buildConservativeModels)은
// scripts/audit-product-identity-category-compression.mjs의 동일 알고리즘을 그대로
// 복사한 것이다(그 파일은 손대지 않음 — Category Phase 코드 수정 금지 지시에 따름).
//
// 출력: work/product-color-audit.json (신규 아티팩트, 기존 category-master.json/
// category-unclassified-model-audit.json과 무관).
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const output = resolve(root, process.argv[2] || "work/product-color-audit.json");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const inventory = await readJson("work/ecount-inventory/latest.json");

// ====================================================================
// 1) 모델 단위 그룹핑 (audit-product-identity-category-compression.mjs와 동일 알고리즘,
//    복사본 — 원본 파일은 수정하지 않는다)
// ====================================================================
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizedText = (value) => String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9가-힣]+/g, "");

function brandFromName(productName) {
  const [brand, rest] = String(productName || "").split("/");
  return rest === undefined ? "UNASSIGNED" : brand.trim() || "UNASSIGNED";
}

function modelBaseName(row) {
  let value = String(row.productName || "").normalize("NFKC").trim();
  const specification = String(row.specification || "").normalize("NFKC").trim();
  if (specification) value = value.replace(new RegExp(`(?:\\s*[/|-]\\s*|\\s+)${escapeRegex(specification)}(?:\\s+SIZE)?\\s*$`, "i"), "");
  return normalizedText(value);
}

function buildConservativeModels(rows) {
  const provisional = new Map();
  for (const row of rows) {
    const code = String(row.productCode || "");
    const prefix = row.specification && /^[A-Za-z0-9]{8,}$/.test(code) && /\d{2}$/.test(code) ? code.slice(0, -2) : null;
    const key = prefix ? `CODE_PREFIX:${prefix}` : `SKU:${code}`;
    const group = provisional.get(key) || [];
    group.push(row);
    provisional.set(key, group);
  }
  const safe = [];
  const rejected = [];
  for (const [key, group] of provisional) {
    const baseNames = new Set(group.map(modelBaseName));
    if (group.length === 1 || (key.startsWith("CODE_PREFIX:") && baseNames.size === 1 && !baseNames.has(""))) safe.push(group);
    else {
      rejected.push({ key, skuCount: group.length, productNames: [...new Set(group.map((row) => row.productName))] });
      group.forEach((row) => safe.push([row]));
    }
  }
  const models = safe.map((group) => ({
    modelKey: group.length > 1 ? `CODE_PREFIX:${String(group[0].productCode).slice(0, -2)}` : `SKU:${group[0].productCode}`,
    brand: brandFromName(group[0].productName),
    productName: group[0].productName,
    skuCount: group.length,
    productCodes: group.map((row) => row.productCode)
  }));
  return { models, rejectedUnsafeGroups: rejected };
}

// ====================================================================
// 2) 색상 후보 discovery (tail-first). canonicalization 없음 — 원문 표현 그대로 보존.
// ====================================================================
// 아래 세 목록은 "정답"이 아니라 tail 위치에서 색상 표현의 경계를 찾기 위한 탐지용
// 사전이다. 실 데이터(work/ecount-inventory/latest.json 9,994건 트레일링 단어 빈도
// 분석) 기반으로 구성했고, 최종 raw expression 출력은 항상 원문 그대로 기록한다 —
// 이 목록에 없는 새 표현은 UNKNOWN TAILS로 남아 사람이 발견하도록 한다.
const MODIFIER_WORDS = new Set([
  "LIGHT", "DARK", "OFF", "WASHED", "MELANGE", "OIL", "RUSTY", "DEEP", "PALE", "BRIGHT",
  "NEON", "DUSTY", "MUTED", "VINTAGE", "FADED", "DIRTY", "ANTIQUE", "MIXED", "ICE",
  "STONE", "ASH", "SAND", "MOSS", "SAGE", "FROSTED", "RAW", "ROYAL", "BABY", "HAND",
  "PASTEL", "DEBOSSED", "SOLID", "DAMAGE", "DAMAGED", "SMOKY", "DEWY", "GRAYISH",
  "GREYISH", "KHAKIISH", "BLUISH", "REDDISH", "GREENISH", "PINKISH", "WHITISH",
  "BLACKISH", "BROWNISH"
]);
const BASE_COLOR_WORDS = new Set([
  "BLACK", "WHITE", "IVORY", "GREY", "GRAY", "NAVY", "BLUE", "CREAM", "BEIGE", "BROWN",
  "RED", "PINK", "GREEN", "YELLOW", "PURPLE", "ORANGE", "SILVER", "GOLD", "CHARCOAL",
  "KHAKI", "OLIVE", "BURGUNDY", "MAROON", "TAN", "RUST", "CORAL", "TEAL", "MINT",
  "LAVENDER", "INDIGO", "NUDE", "OATMEAL", "NICKEL", "BRONZE", "COPPER", "CAMEL",
  "MOCHA", "TAUPE", "WINE", "SKY", "MULTI", "BONE", "CARBON", "ANTHRACITE", "VIOLET",
  "JADE", "LEMON", "BLK", "BK", "WHT", "WH", "BLU"
]);
const PATTERN_WORDS = new Set([
  "CAMO", "CAMOUFLAGE", "WOODLAND", "MULTICOLOR", "PRINT", "STRIPE", "STRIPED", "PLAID",
  "DENIM", "HOUNDSTOOTH", "LEOPARD", "ZEBRA", "FLORAL", "TIE-DYE", "TIEDYE", "CHECK"
]);
const ALL_COLORISH = new Set([...MODIFIER_WORDS, ...BASE_COLOR_WORDS, ...PATTERN_WORDS]);
const CONNECTOR_SYMBOLS = new Set(["&", "-", "/"]);
const CONNECTOR_WORDS = new Set(["AND"]);

// specification(사이즈 필드) 값이 상품명 끝에 그대로 반복되는 경우가 많다(예: "... BLACK /
// M SIZE"에서 specification="M") — 이걸 먼저 잘라내야 진짜 색상 tail이 드러난다.
// audit-product-identity-category-compression.mjs의 modelBaseName()과 동일한 스트립
// 정규식을 재사용(복사)한다.
function stripSizeTail(productName, specification) {
  let value = String(productName || "").normalize("NFKC").trim();
  const spec = String(specification || "").normalize("NFKC").trim();
  if (spec) value = value.replace(new RegExp(`(?:\\s*[/|-]\\s*|\\s+)${escapeRegex(spec)}(?:\\s+SIZE)?\\s*$`, "i"), "");
  // specification과 정확히 일치하지 않아도 "... / OS SIZE" 같은 일반적인 사이즈 표기는
  // 추가로 한 번 더 제거한다(원문 자체에 이미 박혀 있는 경우가 있다).
  value = value.replace(/[\s/|-]*\b[A-Za-z0-9]{1,4}\s+SIZE\s*$/i, "");
  return value.trim();
}

function tokenizeWithSpans(text) {
  const tokens = [];
  const re = /[A-Za-z]+(?:['’][A-Za-z]+)?|[&\-/]|\S/g;
  let match;
  while ((match = re.exec(text))) tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  return tokens;
}

function classifyWords(words) {
  const upper = words.map((w) => w.toUpperCase());
  if (upper.some((w) => PATTERN_WORDS.has(w))) return "PATTERN";
  if (upper.length === 1 && BASE_COLOR_WORDS.has(upper[0])) return "SINGLE";
  return "COMPOUND";
}

// 상품명 뒤쪽(tail)에서부터 색상스러운 토큰이 이어지는 가장 긴 구간을 찾는다. 첫 토큰부터
// 색상스럽지 않으면 즉시 포기(UNKNOWN) — 중간에 있는 색상 단어를 억지로 끌어오지 않는다
// (예: "BLACK/POTASSIUM"에서 POTASSIUM을 모르면 BLACK도 끌어오지 않고 통째로 UNKNOWN —
// 사람이 직접 봐야 하는 케이스를 안전하게 남긴다).
function extractTailColor(cleanedName) {
  const trimmed = cleanedName.trim();
  if (!trimmed) return null;
  const parenMatch = trimmed.match(/\(([^()]+)\)\s*$/);
  if (parenMatch) {
    const innerTokens = parenMatch[1].trim().split(/\s+/).filter(Boolean);
    if (innerTokens.length && innerTokens.every((t) => ALL_COLORISH.has(t.toUpperCase()))) {
      return { raw: parenMatch[0], kind: classifyWords(innerTokens) };
    }
  }
  const tokens = tokenizeWithSpans(trimmed);
  if (!tokens.length) return null;
  let i = tokens.length - 1;
  const included = [];
  while (i >= 0) {
    const tok = tokens[i];
    const upper = tok.text.toUpperCase();
    if (/[A-Za-z]/.test(tok.text)) {
      if (CONNECTOR_WORDS.has(upper)) {
        const prev = tokens[i - 1];
        if (prev && /[A-Za-z]/.test(prev.text) && ALL_COLORISH.has(prev.text.toUpperCase())) { included.unshift(tok); i -= 1; continue; }
        break;
      }
      if (!ALL_COLORISH.has(upper)) break;
      included.unshift(tok);
      i -= 1;
    } else if (CONNECTOR_SYMBOLS.has(tok.text)) {
      const prev = tokens[i - 1];
      if (prev && /[A-Za-z]/.test(prev.text) && ALL_COLORISH.has(prev.text.toUpperCase())) { included.unshift(tok); i -= 1; }
      else break;
    } else break;
  }
  if (!included.length) return null;
  const start = included[0].start;
  const end = included[included.length - 1].end;
  const raw = trimmed.slice(start, end);
  const words = included.filter((t) => /[A-Za-z]/.test(t.text) && !CONNECTOR_WORDS.has(t.text.toUpperCase())).map((t) => t.text);
  if (!words.length) return null;
  return { raw, kind: classifyWords(words) };
}

// ====================================================================
// 3) 실행
// ====================================================================
const { models, rejectedUnsafeGroups } = buildConservativeModels(inventory);
const modelKeyByProductCode = new Map();
for (const model of models) for (const code of model.productCodes) modelKeyByProductCode.set(String(code), model.modelKey);

const productNamePopulated = inventory.filter((row) => String(row.productName || "").trim()).length;
const nameFreq = new Map();
for (const row of inventory) {
  const name = String(row.productName || "");
  nameFreq.set(name, (nameFreq.get(name) || 0) + 1);
}
const exactDuplicateProductNameCount = [...nameFreq.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);

const byRawExpression = new Map(); // raw -> { kind, skuCount, modelKeys:Set, examples:[] }
const unknownRows = [];
const ambiguityRows = [];
let foundSkuCount = 0;
let unknownSkuCount = 0;

for (const row of inventory) {
  const cleaned = stripSizeTail(row.productName, row.specification);
  const result = extractTailColor(cleaned);
  const modelKey = modelKeyByProductCode.get(String(row.productCode)) || `SKU:${row.productCode}`;

  const tailStart = result ? cleaned.lastIndexOf(result.raw) : cleaned.length;
  const beforeTail = cleaned.slice(0, tailStart);
  const midTokens = beforeTail.match(/[A-Za-z]+/g) || [];
  const midHits = midTokens.filter((token) => BASE_COLOR_WORDS.has(token.toUpperCase()) || PATTERN_WORDS.has(token.toUpperCase()));
  if (midHits.length) {
    ambiguityRows.push({
      brand: brandFromName(row.productName),
      productCode: row.productCode,
      productName: row.productName,
      midStringHits: [...new Set(midHits.map((w) => w.toUpperCase()))],
      extractedTail: result?.raw || null
    });
  }

  if (!result) {
    unknownSkuCount += 1;
    unknownRows.push({ brand: brandFromName(row.productName), productCode: row.productCode, productName: row.productName });
    continue;
  }
  foundSkuCount += 1;
  const rec = byRawExpression.get(result.raw) || { kind: result.kind, skuCount: 0, modelKeys: new Set(), examples: [] };
  rec.skuCount += 1;
  rec.modelKeys.add(modelKey);
  if (rec.examples.length < 3 && !rec.examples.includes(row.productName)) rec.examples.push(row.productName);
  byRawExpression.set(result.raw, rec);
}

const rawExpressionRows = [...byRawExpression.entries()]
  .map(([raw, rec]) => ({ raw, kind: rec.kind, modelCount: rec.modelKeys.size, skuCount: rec.skuCount, examples: rec.examples }))
  .sort((a, b) => b.skuCount - a.skuCount || b.modelCount - a.modelCount);

const singleCandidates = rawExpressionRows.filter((r) => r.kind === "SINGLE");
const compoundCandidates = rawExpressionRows.filter((r) => r.kind === "COMPOUND");
const patternCandidates = rawExpressionRows.filter((r) => r.kind === "PATTERN");

// UNKNOWN 샘플은 productName 중복을 줄여 다양성을 우선한다(같은 이름의 사이즈별 SKU가
// 여러 개 있으면 대표 1건만).
const seenUnknownNames = new Set();
const unknownSamples = [];
for (const row of unknownRows) {
  if (seenUnknownNames.has(row.productName)) continue;
  seenUnknownNames.add(row.productName);
  unknownSamples.push(row);
  if (unknownSamples.length >= 200) break;
}

const result = {
  generatedAt: new Date().toISOString(),
  mode: "read_only_color_audit",
  sources: ["work/ecount-inventory/latest.json"],
  summary: {
    totalSku: inventory.length,
    uniqueProductModels: models.length,
    rejectedUnsafeModelGroups: rejectedUnsafeGroups.length,
    productNamePopulated,
    productNameCoveragePct: (productNamePopulated / inventory.length) * 100,
    exactDuplicateProductNameSkuCount: exactDuplicateProductNameCount,
    foundSkuCount,
    unknownSkuCount,
    foundCoveragePct: (foundSkuCount / inventory.length) * 100,
    distinctRawExpressions: rawExpressionRows.length,
    singleCandidateCount: singleCandidates.length,
    compoundCandidateCount: compoundCandidates.length,
    patternCandidateCount: patternCandidates.length,
    ambiguitySkuCount: ambiguityRows.length
  },
  topRawExpressions: rawExpressionRows.slice(0, 100),
  singleColorCandidates: singleCandidates,
  compoundColorCandidates: compoundCandidates,
  patternCandidates,
  unknownTailSamples: unknownSamples,
  potentialAmbiguities: ambiguityRows.slice(0, 300)
};

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);

// ====================================================================
// 4) 터미널 출력 (사람이 검수하기 쉬운 순서)
// ====================================================================
console.log("=== COLOR AUDIT SUMMARY ===");
console.log(`TOTAL SKU: ${result.summary.totalSku}`);
console.log(`UNIQUE MODELS: ${result.summary.uniqueProductModels}`);
console.log(`PRODUCT NAME COVERAGE: ${productNamePopulated}/${inventory.length} (${result.summary.productNameCoveragePct.toFixed(2)}%)`);
console.log(`EXACT DUPLICATE PRODUCT NAME SKUs: ${exactDuplicateProductNameCount}`);
console.log(`TAIL COLOR FOUND: ${foundSkuCount}/${inventory.length} (${result.summary.foundCoveragePct.toFixed(2)}%) — UNKNOWN: ${unknownSkuCount}`);
console.log(`DISTINCT RAW EXPRESSIONS: ${rawExpressionRows.length} (SINGLE ${singleCandidates.length} / COMPOUND ${compoundCandidates.length} / PATTERN ${patternCandidates.length})`);

console.log("\n=== TOP 100 RAW COLOR EXPRESSIONS ===");
console.log("raw expression | model count | sku count | examples");
for (const row of rawExpressionRows.slice(0, 100)) {
  console.log(`${row.raw} | ${row.modelCount} | ${row.skuCount} | ${row.examples[0] || ""}`);
}

console.log("\n=== SINGLE COLOR CANDIDATES ===");
console.log(singleCandidates.map((r) => r.raw).join(", "));

console.log("\n=== COMPOUND COLOR CANDIDATES ===");
console.log(compoundCandidates.map((r) => r.raw).join(", "));

console.log("\n=== PATTERN / NON-STANDARD CANDIDATES ===");
console.log(patternCandidates.map((r) => r.raw).join(", "));

console.log(`\n=== UNKNOWN TAILS (showing ${Math.min(100, unknownSamples.length)} of ${unknownSkuCount} SKU / ${unknownSamples.length} distinct names) ===`);
for (const row of unknownSamples.slice(0, 100)) {
  console.log(`${row.brand} | ${row.productCode} | ${row.productName}`);
}

console.log(`\n=== POTENTIAL AMBIGUITIES (showing 60 of ${ambiguityRows.length}) ===`);
for (const row of ambiguityRows.slice(0, 60)) {
  console.log(`${row.midStringHits.join(",")} (mid-string) | tail: ${row.extractedTail || "UNKNOWN"} | ${row.brand} | ${row.productCode} | ${row.productName}`);
}

console.log(`\nFull artifact written to: ${output}`);
