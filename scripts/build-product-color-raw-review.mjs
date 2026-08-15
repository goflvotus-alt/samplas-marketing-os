#!/usr/bin/env node
// SAMPLAS Product Color Master — COLOR PHASE 1B: RAW EXPRESSION REVIEW ARTIFACT.
//
// READ-ONLY. 이 스크립트는 work/ecount-inventory/latest.json과
// work/product-color-audit.json을 읽기만 하고, 어떤 canonicalization/분류 결정도
// 내리지 않는다 — 417개 raw expression을 사람이 검토하기 쉽게 펼쳐서 보여주는 것만이
// 목적이다 (semantic color compression 없음, UNKNOWN 재분류 없음).
//
// tail-first 색상 추출 로직(MODIFIER_WORDS/BASE_COLOR_WORDS/PATTERN_WORDS/
// extractTailColor 등)과 모델 그룹핑 로직은 scripts/audit-product-color-compression.mjs
// (Phase 1)의 것을 한 글자도 바꾸지 않고 그대로 복사했다 — Phase 1 원본 결과와 정확히
// 같은 숫자가 나오는지 이 스크립트 안에서 직접 검증한다(아래 "5) 검증" 참고). Phase 1
// 스크립트 자체는 수정하지 않았다.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const output = resolve(root, process.argv[2] || "work/product-color-raw-review.json");
const reportOutput = resolve(root, process.argv[3] || "docs/reports/COLOR-MASTER-RAW-EXPRESSIONS-REVIEW.md");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const inventory = await readJson("work/ecount-inventory/latest.json");
const phase1Audit = await readJson("work/product-color-audit.json");

// ====================================================================
// 1) Phase 1과 동일한 모델 그룹핑 로직 (scripts/audit-product-identity-category-
//    compression.mjs -> scripts/audit-product-color-compression.mjs 그대로 복사, 미수정)
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
  for (const [key, group] of provisional) {
    const baseNames = new Set(group.map(modelBaseName));
    if (group.length === 1 || (key.startsWith("CODE_PREFIX:") && baseNames.size === 1 && !baseNames.has(""))) safe.push(group);
    else group.forEach((row) => safe.push([row]));
  }
  const models = safe.map((group) => ({
    modelKey: group.length > 1 ? `CODE_PREFIX:${String(group[0].productCode).slice(0, -2)}` : `SKU:${group[0].productCode}`,
    brand: brandFromName(group[0].productName),
    productName: group[0].productName,
    skuCount: group.length,
    productCodes: group.map((row) => row.productCode)
  }));
  return { models };
}

// ====================================================================
// 2) Phase 1과 동일한 색상 tail 추출 로직 (scripts/audit-product-color-compression.mjs
//    그대로 복사, 미수정 — 이번 작업에서 extraction logic을 확장하지 않는다)
// ====================================================================
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

function stripSizeTail(productName, specification) {
  let value = String(productName || "").normalize("NFKC").trim();
  const spec = String(specification || "").normalize("NFKC").trim();
  if (spec) value = value.replace(new RegExp(`(?:\\s*[/|-]\\s*|\\s+)${escapeRegex(spec)}(?:\\s+SIZE)?\\s*$`, "i"), "");
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
// 3) Phase 1과 동일하게 재실행 (raw expression별 productCode 예시를 추가로 뽑기 위해 —
//    Phase 1 JSON의 topRawExpressions는 상위 100개로 잘려 있고 productCode도 없음)
// ====================================================================
const { models } = buildConservativeModels(inventory);
const modelKeyByProductCode = new Map();
for (const model of models) for (const code of model.productCodes) modelKeyByProductCode.set(String(code), model.modelKey);

const byRawExpression = new Map();
const unknownSamples = [];
let foundSkuCount = 0;
let unknownSkuCount = 0;

for (const row of inventory) {
  const cleaned = stripSizeTail(row.productName, row.specification);
  const result = extractTailColor(cleaned);
  const modelKey = modelKeyByProductCode.get(String(row.productCode)) || `SKU:${row.productCode}`;
  if (!result) {
    unknownSkuCount += 1;
    unknownSamples.push({ brand: brandFromName(row.productName), productCode: row.productCode, productName: row.productName });
    continue;
  }
  foundSkuCount += 1;
  const rec = byRawExpression.get(result.raw) || { kind: result.kind, skuCount: 0, modelKeys: new Set(), examples: [] };
  rec.skuCount += 1;
  rec.modelKeys.add(modelKey);
  if (rec.examples.length < 3 && !rec.examples.some((e) => e.productName === row.productName)) {
    rec.examples.push({ productName: row.productName, productCode: row.productCode });
  }
  byRawExpression.set(result.raw, rec);
}

// ====================================================================
// 4) 후보 그룹 (읽기 전용 표시만, 자동 병합 없음)
// ====================================================================
function normalizeCase(raw) { return raw.toUpperCase(); }
function normalizeFormatting(raw) { return raw.toUpperCase().replace(/[\s\-&()]+/g, ""); }

const rawList = [...byRawExpression.keys()];

// 대소문자만 다른 그룹
const caseGroups = new Map();
for (const raw of rawList) {
  const key = normalizeCase(raw);
  const list = caseGroups.get(key) || [];
  list.push(raw);
  caseGroups.set(key, list);
}
const caseOnlyDuplicateGroups = [...caseGroups.entries()]
  .filter(([, members]) => members.length > 1)
  .map(([canonicalCase, members]) => ({
    normalizedCaseCandidate: canonicalCase,
    members: members.sort((a, b) => byRawExpression.get(b).skuCount - byRawExpression.get(a).skuCount),
    totalSkuCount: members.reduce((sum, m) => sum + byRawExpression.get(m).skuCount, 0)
  }))
  .sort((a, b) => b.totalSkuCount - a.totalSkuCount);

// 공백/하이픈/괄호/& 제거 기준 formatting 그룹 (대소문자 그룹과 별개 관점 — 겹칠 수 있음)
const fmtGroups = new Map();
for (const raw of rawList) {
  const key = normalizeFormatting(raw);
  const list = fmtGroups.get(key) || [];
  list.push(raw);
  fmtGroups.set(key, list);
}
const formattingVariationGroups = [...fmtGroups.entries()]
  .filter(([, members]) => members.length > 1)
  .map(([normalizedKey, members]) => ({
    normalizedFormattingCandidate: normalizedKey,
    members: members.sort((a, b) => byRawExpression.get(b).skuCount - byRawExpression.get(a).skuCount),
    totalSkuCount: members.reduce((sum, m) => sum + byRawExpression.get(m).skuCount, 0)
  }))
  .sort((a, b) => b.totalSkuCount - a.totalSkuCount);

// spelling/abbreviation variation 후보 — 자동 통합 없음, 알려진 대응쌍으로 "같은 위치에
// 다른 표기가 들어간 표현"을 찾아서 후보로만 묶는다(GREY<->GRAY가 대표 예시).
const SPELLING_PAIRS = [
  ["GREY", "GRAY"],
  ["GREYISH", "GRAYISH"]
];
const ABBREVIATION_PAIRS = [
  ["BLACK", "BLK"], ["BLACK", "BK"],
  ["WHITE", "WHT"], ["WHITE", "WH"],
  ["BLUE", "BLU"]
];

function findVariantCandidates(pairs, label) {
  const groups = [];
  const seen = new Set();
  for (const [a, b] of pairs) {
    for (const raw of rawList) {
      const upper = raw.toUpperCase();
      const re = new RegExp(`\\b${a}\\b`);
      if (!re.test(upper)) continue;
      const swapped = upper.replace(re, b);
      const swappedMatch = rawList.find((candidate) => candidate.toUpperCase() === swapped);
      if (!swappedMatch) continue;
      const groupKey = [raw, swappedMatch].sort().join("||");
      if (seen.has(groupKey)) continue;
      seen.add(groupKey);
      groups.push({
        variantType: label,
        pair: [a, b],
        members: [raw, swappedMatch].sort((x, y) => byRawExpression.get(y).skuCount - byRawExpression.get(x).skuCount),
        totalSkuCount: byRawExpression.get(raw).skuCount + byRawExpression.get(swappedMatch).skuCount
      });
    }
  }
  return groups.sort((x, y) => y.totalSkuCount - x.totalSkuCount);
}

const spellingVariationGroups = findVariantCandidates(SPELLING_PAIRS, "spelling");
const abbreviationVariationGroups = findVariantCandidates(ABBREVIATION_PAIRS, "abbreviation");

// possibleDuplicateGroup 태그 부여 (표시용 참조 키만 — 실제 병합 없음)
function duplicateGroupTag(raw) {
  const tags = [];
  const caseKey = normalizeCase(raw);
  if ((caseGroups.get(caseKey) || []).length > 1) tags.push(`CASE:${caseKey}`);
  const fmtKey = normalizeFormatting(raw);
  if ((fmtGroups.get(fmtKey) || []).length > 1 && fmtKey !== caseKey) tags.push(`FMT:${fmtKey}`);
  for (const group of [...spellingVariationGroups, ...abbreviationVariationGroups]) {
    if (group.members.includes(raw)) tags.push(`${group.variantType.toUpperCase()}:${group.pair.join("-")}`);
  }
  return tags.length ? tags.join(";") : null;
}

function reviewNote(raw, kind, dupGroupTag) {
  const notes = [];
  if (dupGroupTag) notes.push(`후보 그룹 있음(${dupGroupTag}) — 자동 병합 안 함`);
  if (kind === "PATTERN") notes.push("pattern 계열 — COLOR taxonomy 편입 여부 미결정");
  return notes.length ? notes.join("; ") : "-";
}

// ====================================================================
// 5) 검증 — Phase 1 원본 audit(work/product-color-audit.json)과 정확히 같은 숫자가
//    나오는지 확인한다. 다르면 오류로 표시(자동 수정하지 않음, 이 스크립트는 read-only).
// ====================================================================
const single = [...byRawExpression.entries()].filter(([, r]) => r.kind === "SINGLE");
const compound = [...byRawExpression.entries()].filter(([, r]) => r.kind === "COMPOUND");
const pattern = [...byRawExpression.entries()].filter(([, r]) => r.kind === "PATTERN");

const verification = {
  totalSkuMatch: inventory.length === phase1Audit.summary.totalSku,
  foundSkuCountMatch: foundSkuCount === phase1Audit.summary.foundSkuCount,
  unknownSkuCountMatch: unknownSkuCount === phase1Audit.summary.unknownSkuCount,
  distinctRawExpressionsMatch: byRawExpression.size === phase1Audit.summary.distinctRawExpressions,
  singleCountMatch: single.length === phase1Audit.summary.singleCandidateCount,
  compoundCountMatch: compound.length === phase1Audit.summary.compoundCandidateCount,
  patternCountMatch: pattern.length === phase1Audit.summary.patternCandidateCount,
  sumEqualsDistinct: single.length + compound.length + pattern.length === byRawExpression.size,
  recomputed: {
    totalSku: inventory.length,
    foundSkuCount,
    unknownSkuCount,
    distinctRawExpressions: byRawExpression.size,
    singleCount: single.length,
    compoundCount: compound.length,
    patternCount: pattern.length
  },
  phase1Original: phase1Audit.summary
};
verification.allMatch = Object.entries(verification)
  .filter(([key]) => key.endsWith("Match"))
  .every(([, value]) => value === true);

if (!verification.allMatch) {
  console.error("WARNING: Phase 1B 재계산 결과가 Phase 1 원본 audit과 일치하지 않습니다 — 아래 verification 블록을 확인하세요.");
  console.error(JSON.stringify(verification, null, 2));
}

// ====================================================================
// 6) UNKNOWN read-only 통계 (재분류 없음 — Phase 1 원본 unknownTailSamples 200건 기반
//    표본 통계일 뿐, 2,691건 전수 재계산이 아니다 — 표본이라는 점을 명시한다)
// ====================================================================
const unknownLastWordFreq = new Map();
for (const sample of unknownSamples) {
  const m = String(sample.productName || "").match(/([A-Za-z]+)\W*$/);
  if (!m) continue;
  const w = m[1].toUpperCase();
  unknownLastWordFreq.set(w, (unknownLastWordFreq.get(w) || 0) + 1);
}
const unknownLastWordTop = [...unknownLastWordFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);

// ====================================================================
// 7) 전체 417개 raw expression 테이블
// ====================================================================
const allExpressionRows = [...byRawExpression.entries()]
  .map(([raw, rec]) => {
    const dupTag = duplicateGroupTag(raw);
    return {
      rawExpression: raw,
      normalizedCaseCandidate: normalizeCase(raw),
      type: rec.kind,
      skuCount: rec.skuCount,
      modelCount: rec.modelKeys.size,
      exampleProductNames: rec.examples.map((e) => e.productName),
      exampleProductCodes: rec.examples.map((e) => e.productCode),
      possibleDuplicateGroup: dupTag,
      reviewNote: reviewNote(raw, rec.kind, dupTag)
    };
  })
  .sort((a, b) => b.skuCount - a.skuCount || a.rawExpression.localeCompare(b.rawExpression));

const reviewArtifact = {
  generatedAt: new Date().toISOString(),
  mode: "read_only_color_raw_review",
  sources: ["work/ecount-inventory/latest.json", "work/product-color-audit.json"],
  note: "PHASE 1B — raw expression review only. No canonicalization, no semantic color compression, no UNKNOWN reclassification. All 417 distinct raw tail expressions preserved verbatim (case included).",
  verification,
  summary: {
    rawExpressionCount: byRawExpression.size,
    singleCount: single.length,
    compoundCount: compound.length,
    patternCount: pattern.length,
    caseOnlyDuplicateGroupCount: caseOnlyDuplicateGroups.length,
    formattingVariationGroupCount: formattingVariationGroups.length,
    spellingVariationGroupCount: spellingVariationGroups.length,
    abbreviationVariationGroupCount: abbreviationVariationGroups.length,
    unknownSkuCount
  },
  allRawExpressions: allExpressionRows,
  compoundColorCandidatesFull: allExpressionRows.filter((r) => r.type === "COMPOUND"),
  patternCandidatesFull: allExpressionRows.filter((r) => r.type === "PATTERN"),
  caseOnlyDuplicateGroups,
  formattingVariationGroups,
  spellingVariationGroups,
  abbreviationVariationGroups,
  unknownReadOnlyStats: {
    unknownSkuCount,
    note: `UNKNOWN ${unknownSkuCount}건 전수의 상품명 마지막 알파벳 단어 빈도 — read-only 통계일 뿐, 재분류/새 규칙 추가 아님(기존 UNKNOWN 판정은 그대로 유지).`,
    tailLastWordFrequencyTop30: unknownLastWordTop.map(([word, count]) => ({ word, count }))
  }
};

await writeFile(output, `${JSON.stringify(reviewArtifact, null, 2)}\n`);

// ====================================================================
// 8) 상세 보고서 (Markdown) — 417개 raw expression 전체를 생략 없이 담는다.
// ====================================================================
function esc(value) { return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "); }
function mdTableRow(cells) { return `| ${cells.map(esc).join(" | ")} |`; }

const mainTableHeader = [
  mdTableRow(["#", "rawExpression", "normalizedCaseCandidate", "type", "skuCount", "modelCount", "exampleProductNames", "exampleProductCodes", "possibleDuplicateGroup", "reviewNote"]),
  mdTableRow(["---", "---", "---", "---", "---", "---", "---", "---", "---", "---"])
].join("\n");
const mainTableRows = allExpressionRows.map((row, index) => mdTableRow([
  index + 1, row.rawExpression, row.normalizedCaseCandidate, row.type, row.skuCount, row.modelCount,
  row.exampleProductNames.join("; "), row.exampleProductCodes.join("; "), row.possibleDuplicateGroup || "-", row.reviewNote
])).join("\n");

function simpleTable(rows) {
  const header = [mdTableRow(["#", "rawExpression", "skuCount", "modelCount", "exampleProductNames"]), mdTableRow(["---", "---", "---", "---", "---"])].join("\n");
  const body = rows.map((row, index) => mdTableRow([index + 1, row.rawExpression, row.skuCount, row.modelCount, row.exampleProductNames.join("; ")])).join("\n");
  return `${header}\n${body}`;
}

function caseGroupTable(groups) {
  const header = [mdTableRow(["#", "normalizedCaseCandidate", "members (raw, sku)", "totalSkuCount"]), mdTableRow(["---", "---", "---", "---"])].join("\n");
  const body = groups.map((g, index) => mdTableRow([
    index + 1, g.normalizedCaseCandidate,
    g.members.map((m) => `${m} (${byRawExpression.get(m).skuCount})`).join(", "),
    g.totalSkuCount
  ])).join("\n");
  return `${header}\n${body}`;
}

function fmtGroupTable(groups) {
  const header = [mdTableRow(["#", "normalizedFormattingCandidate", "members (raw, sku)", "totalSkuCount"]), mdTableRow(["---", "---", "---", "---"])].join("\n");
  const body = groups.map((g, index) => mdTableRow([
    index + 1, g.normalizedFormattingCandidate,
    g.members.map((m) => `${m} (${byRawExpression.get(m).skuCount})`).join(", "),
    g.totalSkuCount
  ])).join("\n");
  return `${header}\n${body}`;
}

function pairGroupTable(groups) {
  const header = [mdTableRow(["#", "pair", "members (raw, sku)", "totalSkuCount"]), mdTableRow(["---", "---", "---", "---"])].join("\n");
  const body = groups.map((g, index) => mdTableRow([
    index + 1, g.pair.join(" / "),
    g.members.map((m) => `${m} (${byRawExpression.get(m).skuCount})`).join(", "),
    g.totalSkuCount
  ])).join("\n");
  return `${header}\n${body}`;
}

const unknownTable = [
  mdTableRow(["#", "word", "count (of full UNKNOWN set)"]),
  mdTableRow(["---", "---", "---"]),
  ...unknownLastWordTop.map(([word, count], index) => mdTableRow([index + 1, word, count]))
].join("\n");

const verificationTable = [
  mdTableRow(["metric", "Phase 1 원본", "Phase 1B 재계산", "일치"]),
  mdTableRow(["---", "---", "---", "---"]),
  mdTableRow(["totalSku", phase1Audit.summary.totalSku, verification.recomputed.totalSku, verification.totalSkuMatch ? "✅" : "❌"]),
  mdTableRow(["foundSkuCount (TAIL COLOR FOUND)", phase1Audit.summary.foundSkuCount, verification.recomputed.foundSkuCount, verification.foundSkuCountMatch ? "✅" : "❌"]),
  mdTableRow(["unknownSkuCount", phase1Audit.summary.unknownSkuCount, verification.recomputed.unknownSkuCount, verification.unknownSkuCountMatch ? "✅" : "❌"]),
  mdTableRow(["distinctRawExpressions", phase1Audit.summary.distinctRawExpressions, verification.recomputed.distinctRawExpressions, verification.distinctRawExpressionsMatch ? "✅" : "❌"]),
  mdTableRow(["SINGLE", phase1Audit.summary.singleCandidateCount, verification.recomputed.singleCount, verification.singleCountMatch ? "✅" : "❌"]),
  mdTableRow(["COMPOUND", phase1Audit.summary.compoundCandidateCount, verification.recomputed.compoundCount, verification.compoundCountMatch ? "✅" : "❌"]),
  mdTableRow(["PATTERN", phase1Audit.summary.patternCandidateCount, verification.recomputed.patternCount, verification.patternCountMatch ? "✅" : "❌"])
].join("\n");

const reportMarkdown = `# COLOR MASTER — RAW EXPRESSIONS REVIEW (PHASE 1B)

**READ-ONLY REVIEW ARTIFACT.** 이 문서는 SAMPLAS Color Master의 canonical taxonomy를
확정하는 문서가 아니다. Color Phase 1 audit(\`work/product-color-audit.json\`)이 상품명
tail에서 발견한 417개 distinct raw color expression을 사람이 전부 검토할 수 있도록 펼쳐
보여주는 것이 유일한 목적이다.

## 핵심 정책 (이번 단계에서 지킨 것)

- **semantic color compression 없음** — FADED BLACK을 BLACK으로, OFF WHITE를 WHITE로,
  CREAM을 WHITE로, NAVY를 BLUE로 합치지 않았다. 417개 원문 표현이 모두 독립적으로 남아있다.
  - 복합 색상(BLACK WHITE, BLUE GREY 등)도 두 개의 canonical color로 분해하지 않았다 —
    원 상품명이 사용한 그대로 하나의 raw expression으로 보존했다.
- **normalization은 후보 표시만** — 대소문자 차이(BLACK/Black/black), formatting 차이
  (예: 공백·하이픈·괄호), GREY/GRAY 같은 철자 차이, BLK/BLACK 같은 약어 차이를 그룹으로
  묶어 **후보로만** 보여준다. 실제 데이터/코드에 병합·저장하지 않았다.
- **PATTERN 계열(CAMO/CHECK/STRIPE 등) 삭제·변환 없음** — Phase 1이 색상 tail로 잡은
  그대로 보존했다. COLOR taxonomy에 포함할지 별도 PATTERN dimension으로 분리할지는
  이 문서가 결정하지 않는다.
- **UNKNOWN 2,691건 재분류 없음** — 그대로 두었다. 아래 "UNKNOWN read-only 통계"는 새
  규칙을 추가하지 않고 참고용 빈도만 보여준다.
- Category 관련 코드, \`work/category-master.json\`, canonical sales/inventory 로직, UI —
  전혀 수정하지 않았다.

## 검증: Phase 1 원본 대비 재계산 일치 여부

이 리포트를 만들기 위해 Phase 1과 **완전히 동일한, 한 글자도 바꾸지 않은** tail 추출
로직을 재실행했다(exampleProductCodes를 새로 뽑기 위해 — Phase 1 JSON은 상위 100개만
저장했고 productCode는 없었다). 아래 표는 그 재계산 결과가 Phase 1 원본과 정확히
일치하는지 보여준다.

${verificationTable}

**전체 일치 여부: ${verification.allMatch ? "✅ 모두 일치 — Phase 1 원본 audit 결과가 변경되지 않았음을 확인" : "❌ 불일치 발견 — 아래 raw JSON의 verification 블록 확인 필요"}**

## 요약

| 항목 | 값 |
| --- | --- |
| rawExpressionCount | ${reviewArtifact.summary.rawExpressionCount} |
| SINGLE | ${reviewArtifact.summary.singleCount} |
| COMPOUND | ${reviewArtifact.summary.compoundCount} |
| PATTERN | ${reviewArtifact.summary.patternCount} |
| case-only duplicate 후보 그룹 | ${reviewArtifact.summary.caseOnlyDuplicateGroupCount} |
| formatting variation 후보 그룹 | ${reviewArtifact.summary.formattingVariationGroupCount} |
| spelling variation 후보 그룹 (GREY/GRAY류) | ${reviewArtifact.summary.spellingVariationGroupCount} |
| abbreviation variation 후보 그룹 (BLK/BLACK류) | ${reviewArtifact.summary.abbreviationVariationGroupCount} |
| UNKNOWN SKU (재분류 안 함, 그대로) | ${reviewArtifact.summary.unknownSkuCount} |

## 1. DISTINCT RAW COLOR EXPRESSIONS — 전체 ${allExpressionRows.length}개 (skuCount 내림차순)

${mainTableHeader}
${mainTableRows}

## 3. 대소문자 차이 후보 그룹 (case-only, ${caseOnlyDuplicateGroups.length}개 그룹)

같은 표현이 대소문자만 다르게 쓰인 경우. 병합하지 않았다.

${caseGroupTable(caseOnlyDuplicateGroups)}

## 4. Formatting variation 후보 그룹 (${formattingVariationGroups.length}개 그룹)

공백·하이픈·괄호·& 등을 제거하면 같아지는 표현들. 대소문자 그룹과 겹칠 수 있다(둘 다
정보로서 의미가 달라 별도로 보여준다). 병합하지 않았다.

${fmtGroupTable(formattingVariationGroups)}

## 5. Spelling variation 후보 그룹 (GREY/GRAY류, ${spellingVariationGroups.length}개 그룹)

영국식/미국식 철자 차이. 자동 통합하지 않았다 — 사람이 판단할 후보만 표시.

${pairGroupTable(spellingVariationGroups)}

### 5b. Abbreviation variation 후보 그룹 (BLK/BLACK류, ${abbreviationVariationGroups.length}개 그룹, 참고용 추가 섹션)

요청 범위 밖이지만 같은 방식으로 발견되어 참고용으로 함께 표시한다. 자동 통합하지 않았다.

${pairGroupTable(abbreviationVariationGroups)}

## 6. COMPOUND COLOR CANDIDATES — 전체 ${compound.length}개

${simpleTable(reviewArtifact.compoundColorCandidatesFull)}

## 7. PATTERN / NON-STANDARD CANDIDATES — 전체 ${pattern.length}개

${simpleTable(reviewArtifact.patternCandidatesFull)}

## 8. UNKNOWN read-only 통계 (재분류 없음)

UNKNOWN ${unknownSkuCount}건은 이번 단계에서 전혀 건드리지 않았다. 아래는 그 전수의
상품명 마지막 알파벳 단어 빈도 참고용 통계일 뿐이며, 이 단어들을 색상으로 판정하거나
새 규칙을 추가하지 않았다 — 대부분 JACKET/TOP/PANTS/SHIRT 같은 품목명이거나 진짜 색상
정보가 없는 상품(주얼리 등)이다.

${unknownTable}

## Rollback

이 작업은 새 파일 2건(\`work/product-color-raw-review.json\`, 이 보고서)만 생성했고
기존 파일은 전혀 수정하지 않았다. 되돌리려면 이 두 파일만 삭제하면 된다.

## COMMIT 여부

**커밋하지 않았습니다.**
`;

await writeFile(reportOutput, reportMarkdown);
console.log(JSON.stringify({ output, reportOutput, verification, summary: reviewArtifact.summary }, null, 2));
