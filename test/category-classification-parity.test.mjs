import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyProductCategory } from "../scripts/category-classification-rules.mjs";

// 2026-08 deterministic-rules update, section 8 — Category Review(감사 스크립트)와 실제
// Brand Intelligence/Inventory 결과가 같은 정책을 써야 한다. outputs/samplas-marketing-os.js
// 는 plain <script>라 scripts/category-classification-rules.mjs를 import할 수 없어 손으로
// 이식한 사본을 갖고 있다 — 이 테스트가 두 사본이 동일한 fixture 집합에 대해 동일한 결과를
// 내는지 교차 검증해서 향후 한쪽만 고치는 drift를 잡아낸다.
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");

function sourceOfFunction(name) {
  const asyncMarker = `async function ${name}(`;
  const asyncStart = js.indexOf(asyncMarker);
  const marker = asyncStart !== -1 ? asyncMarker : `function ${name}(`;
  const start = asyncStart !== -1 ? asyncStart : js.indexOf(marker);
  assert.notEqual(start, -1, `${name} missing`);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = start; index < js.length; index += 1) {
    if (js[index] === "(") parenDepth += 1;
    if (js[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { bodyStart = js.indexOf("{", index); break; }
    }
  }
  assert.notEqual(bodyStart, -1, `${name} body not found`);
  let depth = 0;
  let opened = false;
  for (let index = bodyStart; index < js.length; index += 1) {
    if (js[index] === "{") { depth += 1; opened = true; }
    if (js[index] === "}" && --depth === 0 && opened) return js.slice(start, index + 1);
  }
  throw new Error(`${name} incomplete`);
}

function sourceOfConst(name) {
  const marker = `const ${name} = `;
  const start = js.indexOf(marker);
  assert.notEqual(start, -1, `${name} missing`);
  const end = js.indexOf(";\n", start);
  assert.notEqual(end, -1, `${name} end not found`);
  return js.slice(start, end + 1);
}

const BROWSER_CLASSIFIER_SOURCE = [
  sourceOfConst("CATEGORY_NAME_KEYWORD_RULES"),
  sourceOfConst("CATEGORY_NAME_SUBCATEGORY_BY_KEYWORD"),
  sourceOfConst("CATEGORY_ECOUNT_SUFFIX_MAP"),
  sourceOfConst("CATEGORY_ECOUNT_SUBCATEGORY_MAP"),
  sourceOfConst("CATEGORY_AC_SUFFIX_DISTRUST_BRANDS"),
  sourceOfConst("CATEGORY_HANGUL_ONLY_PATTERN"),
  sourceOfFunction("categoryKeywordPattern"),
  sourceOfFunction("matchCategoryByNameKeywordsDetailed"),
  sourceOfFunction("matchCategoryByNameKeywords"),
  sourceOfFunction("ecountCategorySuffixFromProdCd"),
  sourceOfConst("CATEGORY_BRACKET_BRAND_PATTERN"),
  sourceOfFunction("deriveCategoryBrandFromProductName"),
  sourceOfConst("CATEGORY_RESURRECTION_13_BRAND"),
  sourceOfConst("CATEGORY_RESURRECTION_13_CODE_MAP"),
  sourceOfConst("CATEGORY_RESURRECTION_13_CODE_PATTERN"),
  sourceOfFunction("resurrectionThirteenInternalCode"),
  sourceOfConst("CATEGORY_INDIVIDUAL_MODEL_EXCEPTIONS"),
  sourceOfFunction("matchIndividualModelException"),
  sourceOfFunction("classifyEntityProductCategory")
].join("\n\n");

function browserClassify(productNo, productName, prodCd) {
  return Function(
    `${BROWSER_CLASSIFIER_SOURCE}; return classifyEntityProductCategory(arguments[0], arguments[1], arguments[2], new Map());`
  )(productNo, productName, prodCd);
}

const FIXTURES = [
  ["9001", "CARNET ARCHIVE / Basic Cotton T-Shirt Black", null],
  ["9002", "CARNET ARCHIVE / Wide Denim Trousers Blue", null],
  ["9003", "SCAR BOOT CUT PANTS - BLACK", null],
  ["9004", "SKIN-OFF SHIRT JACKET BLACK", null],
  ["9005", "Vintage HORSESHOE Pendant Necklace", null],
  ["9006", "KIMYO / SHIRRING Detail Blouse", null],
  ["9007", "RESURRECITON 13 / 25-T090 black / M SIZE", "POP263RES00103"],
  ["9008", "RESURRECITON 13 / 24-B008 navy / S SIZE", "POP263RES00203"],
  ["9009", "SURGERY / process 009", "POP253SUR00102"],
  ["9010", "ALIVEFORM / STRATUM RUNNER CHARCOAL", "ALI253AC001042"],
  ["9011", "SOME OTHER BRAND / Generic Item", "XYZ251AC00100"],
  ["9012", "Some Generic Product Name", "604253ST00200"],
  ["9013", "Some Generic Product Name", "604251LT00300"],
  ["9014", "Some Generic Product Name", "604251HD00100"],
  ["9015", "Some Generic Product Name", "XXX251DR00100"],
  ["9016", "CARNET ARCHIVE / 후드집업 블랙", null],
  ["9017", "CARNET ARCHIVE / Oversized Hoodie Black", null],
  ["9018", "604SERVICE / Classic Underwear Set", null],
  ["9019", "Completely Unresolvable Gibberish Xyzzy", null],
  // 2026-08-15 사용자 확인값 — 마지막 6개 UNCLASSIFIED 모델 개별 예외.
  ["9020", "DOMINNICO / PINK LACE SLEEVES", null],
  ["9021", "CARNET ARCHIVE / Unearthed Fragment Chain RUSTY WHITE", null],
  ["9022", "[SUNDAYOFFCLUB : 선데이오프클럽] Montmartre Cross Moneyclip Chain - Antique Silver", null]
];

for (const [productNo, productName, prodCd] of FIXTURES) {
  test(`parity: "${productName}" (${prodCd || "no prodCd"}) — audit script and runtime copy agree`, () => {
    const nodeResult = classifyProductCategory({ productNo, productName, prodCd, overrides: new Map() });
    const browserResult = browserClassify(productNo, productName, prodCd);
    assert.equal(browserResult.code, nodeResult.code, `code mismatch for "${productName}"`);
    assert.equal(browserResult.subcategoryCode, nodeResult.subcategoryCode, `subcategoryCode mismatch for "${productName}"`);
    assert.equal(browserResult.source, nodeResult.source, `source mismatch for "${productName}"`);
  });
}
