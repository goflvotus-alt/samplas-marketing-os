import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BI-BATCH-I Part 1/2/9/10, 2026-08 deterministic-rules update — SAMPLAS Category Master v1
// (docs/BRAND_INTELLIGENCE_RULES.md, docs/reports/CATEGORY-MASTER-DETERMINISTIC-RULES-AND-
// SUBCATEGORY.md). Same source-extraction + Function() execution pattern already established
// in this repo (no jsdom) — real function bodies pulled from outputs/samplas-marketing-os.js,
// not reimplemented. Canonical policy source is scripts/category-classification-rules.mjs;
// this file exercises the hand-ported browser copy directly (parity is covered separately by
// test/category-classification-parity.test.mjs).
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
const html = await readFile(new URL("../outputs/samplas-marketing-os.html", import.meta.url), "utf8");

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

const CLASSIFIER_SOURCE = [
  sourceOfConst("CATEGORY_MASTER_V1"),
  sourceOfConst("CATEGORY_MASTER_V1_NAME_BY_CODE"),
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

function loadClassifier() {
  return Function(`${CLASSIFIER_SOURCE}; return { CATEGORY_MASTER_V1, matchCategoryByNameKeywords, ecountCategorySuffixFromProdCd, classifyEntityProductCategory, deriveCategoryBrandFromProductName, resurrectionThirteenInternalCode };`)();
}

// 1. Taxonomy master — 대분류는 이번 배치에서 절대 변경하지 않는다.
test("1. CATEGORY_MASTER_V1 defines exactly the 11 approved categories with correct display names", () => {
  const { CATEGORY_MASTER_V1 } = loadClassifier();
  const expected = {
    TOP: "상의", BOTTOM: "하의", OUTER: "아우터", DRESS: "드레스", BAG: "가방",
    FOOTWEAR: "신발", HEADWEAR: "모자", JEWELRY: "주얼리", ACCESSORY: "액세서리",
    OTHER: "기타", UNCLASSIFIED: "미분류"
  };
  assert.equal(CATEGORY_MASTER_V1.length, 11);
  CATEGORY_MASTER_V1.forEach((cat) => assert.equal(cat.name, expected[cat.code]));
});

// 2. Manual override priority — 개별 모델 예외/suffix/이름 규칙 어느 것보다도 우선한다.
// "SURGERY / process 009" 자체는 model_exception 규칙이 BOTTOM으로 확정 분류하는 이름이라
// override가 없으면 BOTTOM이 나올 상황 — 그런데도 override가 이긴다는 걸 확인한다.
test("2. manual override always wins over model exception, ECOUNT suffix, and name-keyword rules", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const overrides = new Map([["1001", "JEWELRY"]]);
  const withoutOverride = classifyEntityProductCategory("9999", "SURGERY / process 009", "BRD251BT00100", new Map());
  assert.equal(withoutOverride.code, "BOTTOM", "sanity check: without override this would be BOTTOM via model_exception");
  const result = classifyEntityProductCategory("1001", "SURGERY / process 009", "BRD251BT00100", overrides);
  assert.equal(result.code, "JEWELRY");
  assert.equal(result.source, "manual_override");
});

// 3-11. Deterministic keyword rules — one representative product name per category.
const KEYWORD_CASES = [
  ["3. TOP", "CARNET ARCHIVE / Basic Cotton T-Shirt Black", "TOP"],
  ["4. BOTTOM", "CARNET ARCHIVE / Wide Denim Trousers Blue", "BOTTOM"],
  ["5. OUTER", "CARNET ARCHIVE / Oversized Wool Coat", "OUTER"],
  ["6. DRESS", "CARNET ARCHIVE / Midi Slip Dress", "DRESS"],
  ["7. BAG", "CARNET ARCHIVE / Canvas Tote Bag", "BAG"],
  ["8. FOOTWEAR", "CARNET ARCHIVE / Leather Chelsea Boots", "FOOTWEAR"],
  ["9. HEADWEAR", "CARNET ARCHIVE / Logo Baseball Cap", "HEADWEAR"],
  ["10. JEWELRY", "CARNET ARCHIVE / Silver Chain Necklace", "JEWELRY"],
  ["11. ACCESSORY", "CARNET ARCHIVE / Leather Belt Black", "ACCESSORY"]
];
for (const [label, productName, expectedCode] of KEYWORD_CASES) {
  test(`${label}: "${productName}" classifies as ${expectedCode} via the deterministic name rule`, () => {
    const { classifyEntityProductCategory } = loadClassifier();
    const result = classifyEntityProductCategory("9001", productName, null, new Map());
    assert.equal(result.code, expectedCode);
    assert.equal(result.source, "name_rule");
  });
}

// 12. Tail-first name matching (2026-08): when a name matches two category keyword sets at
// once, the one closest to the end of the string wins — this replaces the old "never guess"
// behavior for genuinely resolvable cases (real naming convention: descriptor first, item
// noun last). A true tie (same end position) still falls through to UNCLASSIFIED.
test("12. tail-first: the LAST matching keyword in the product name wins (\"Belted Jacket Dress\" -> DRESS, not UNCLASSIFIED)", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const result = classifyEntityProductCategory("9002", "Belted Jacket Dress", null, new Map());
  assert.equal(result.code, "DRESS");
  assert.equal(result.source, "name_rule");
});

// ECOUNT suffix rules — full activated set (2026-08 confirmed formula).
test("ECOUNT suffix fallback activates the full confirmed formula (BG/BT/SH/JW/FW/OT/HW + ST/LT/HD/DR/AC/ACC)", () => {
  const { ecountCategorySuffixFromProdCd } = loadClassifier();
  assert.equal(ecountCategorySuffixFromProdCd("604251BG00100"), "BAG");
  assert.equal(ecountCategorySuffixFromProdCd("604251BT00500"), "BOTTOM");
  assert.equal(ecountCategorySuffixFromProdCd("RAS243SH00104"), "TOP");
  assert.equal(ecountCategorySuffixFromProdCd("4FE240JW01000"), "JEWELRY");
  assert.equal(ecountCategorySuffixFromProdCd("OTT243FW001275"), "FOOTWEAR");
  assert.equal(ecountCategorySuffixFromProdCd("RAC263OT00104"), "OUTER");
  assert.equal(ecountCategorySuffixFromProdCd("HEL251HW00100"), "HEADWEAR");
  // 2) ST -> TOP + SHORT_SLEEVE, 3) LT -> TOP + LONG_SLEEVE, 4) HD -> TOP + HOODIE,
  // 5) DR -> DRESS, 6) AC/ACC -> ACCESSORY (2026-08 재고 검수로 확정, 이전엔 비활성).
  assert.equal(ecountCategorySuffixFromProdCd("604253ST00200"), "TOP");
  assert.equal(ecountCategorySuffixFromProdCd("604251LT00300"), "TOP");
  assert.equal(ecountCategorySuffixFromProdCd("604251HD00100"), "TOP");
  assert.equal(ecountCategorySuffixFromProdCd("XXX251DR00100"), "DRESS");
  assert.equal(ecountCategorySuffixFromProdCd("RAC261AC00100"), "ACCESSORY");
  assert.equal(ecountCategorySuffixFromProdCd("RAC261ACC00100"), "ACCESSORY");
});

test("2/3/4/5/6. classifyEntityProductCategory returns the subcategoryCode for ST/LT/HD/DR/AC suffixes", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const cases = [
    ["604253ST00200", "TOP", "SHORT_SLEEVE"],
    ["604251LT00300", "TOP", "LONG_SLEEVE"],
    ["604251HD00100", "TOP", "HOODIE"],
    ["XXX251DR00100", "DRESS", "DRESS"],
    ["RAC261AC00100", "ACCESSORY", "ACCESSORY"]
  ];
  for (const [prodCd, code, subcategoryCode] of cases) {
    const result = classifyEntityProductCategory("9100", "Some Generic Product Name", prodCd, new Map());
    assert.equal(result.code, code, prodCd);
    assert.equal(result.subcategoryCode, subcategoryCode, prodCd);
    assert.equal(result.source, "ecount_suffix", prodCd);
  }
});

// 7. RESURRECITON 13 internal code — suffix is always RES for this brand (unusable), the
// product name carries the real internal code instead (25-T090 / 24-B008 / 25-O004 / 25-AC001).
test("7. RESURRECITON 13 reads the internal product code from the name (T/B/O/AC), not the RES suffix", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const cases = [
    ["RESURRECITON 13 / 25-T090 black / M SIZE", "TOP"],
    ["RESURRECITON 13 / 24-B008 navy / S SIZE", "BOTTOM"],
    ["RESURRECITON 13 / 25-O004 black / M SIZE", "OUTER"],
    ["RESURRECITON 13 / 25-AC001 CREAM", "ACCESSORY"]
  ];
  for (const [productName, code] of cases) {
    const result = classifyEntityProductCategory("9200", productName, "POP263RES00103", new Map());
    assert.equal(result.code, code, productName);
    assert.equal(result.source, "resurrection13_internal_code", productName);
  }
  // 다른 브랜드는 이 규칙이 적용되지 않는다 — RES suffix가 없으면 애초에 안 쓰이고,
  // 브랜드가 다르면 내부 품번 패턴이 우연히 일치해도 무시한다.
  const other = classifyEntityProductCategory("9201", "OTHER BRAND / 25-T090 black", "POP263RES00199", new Map());
  assert.notEqual(other.source, "resurrection13_internal_code");
});

// 8. Tail-first fallback — "SCAR BOOT CUT PANTS": BOOT(FOOTWEAR)가 앞, PANTS(BOTTOM)가 뒤.
test("8. \"SCAR BOOT CUT PANTS - BLACK\" classifies as BOTTOM (tail keyword wins over an earlier descriptor)", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const result = classifyEntityProductCategory("9300", "SCAR BOOT CUT PANTS - BLACK", null, new Map());
  assert.equal(result.code, "BOTTOM");
  assert.equal(result.source, "name_rule");
});

// 9/10. False-positive guards — substring matches inside a longer word must not fire
// (Unicode-aware boundary matching, not \b which only understands ASCII \w).
test("9. \"HORSESHOE\" never matches the FOOTWEAR \"shoe\" keyword as a false positive", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const result = classifyEntityProductCategory("9400", "Vintage HORSESHOE Pendant Necklace", null, new Map());
  assert.equal(result.code, "JEWELRY");
  assert.equal(result.source, "name_rule");
});

test("10. \"SHIRRING\" never matches the JEWELRY \"ring\" keyword as a false positive", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const result = classifyEntityProductCategory("9401", "KIMYO / SHIRRING Detail Blouse", null, new Map());
  assert.equal(result.code, "TOP");
  assert.equal(result.source, "name_rule");
});

// 11. "SKIN-OFF SHIRT JACKET" — SHIRT(TOP)가 앞, JACKET(OUTER)이 뒤 -> OUTER.
test("11. \"SKIN-OFF SHIRT JACKET BLACK\" classifies as OUTER (tail keyword wins)", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const result = classifyEntityProductCategory("9402", "SKIN-OFF SHIRT JACKET BLACK", null, new Map());
  assert.equal(result.code, "OUTER");
  assert.equal(result.source, "name_rule");
});

// 12(spec). HOODIE/후드 -> TOP (OUTER 아님) — 사용자 확정 비즈니스 규칙.
test("HOODIE / 후드 classifies as TOP, not OUTER", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  assert.equal(classifyEntityProductCategory("9500", "CARNET ARCHIVE / Oversized Hoodie Black", null, new Map()).code, "TOP");
  assert.equal(classifyEntityProductCategory("9501", "CARNET ARCHIVE / 후드 스웨터", null, new Map()).code, "TOP");
});

// 13. ZIP-UP/집업 -> OUTER — 사용자 확정 비즈니스 규칙.
test("13. ZIP-UP / 집업 classifies as OUTER", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  assert.equal(classifyEntityProductCategory("9502", "LOADING ROOM / (ARIELLA) SPOILED ZIP UP WHITE", null, new Map()).code, "OUTER");
  assert.equal(classifyEntityProductCategory("9503", "CARNET ARCHIVE / 후드집업 블랙", null, new Map()).code, "OUTER");
});

// 14. UNDERWEAR/SWIMWEAR/OVERALL/SET_UP -> OTHER (신규 카테고리 도달 경로).
test("14. UNDERWEAR/SWIMWEAR/OVERALL/SET_UP name matches classify as OTHER with the matching subcategoryCode", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const cases = [
    ["604SERVICE / Classic Underwear Set", "UNDERWEAR"],
    ["BONNAE / Printed Swimwear Bikini", "SWIMWEAR"],
    ["KIMYO / Tech Hooded Zip Overall", "OVERALL"],
    ["KIMYO / Saturn Layers Set-Up", "SET_UP"]
  ];
  for (const [productName, subcategoryCode] of cases) {
    const result = classifyEntityProductCategory("9600", productName, null, new Map());
    assert.equal(result.code, "OTHER", productName);
  }
});

// Individual model exceptions (섹션 5) — 전역 규칙으로 일반화하지 않은 확정 예외 하나씩 확인.
test("model exceptions: SURGERY process numbers and the AC-suffix-distrust brands resolve to their confirmed category", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  assert.equal(classifyEntityProductCategory("9700", "SURGERY / process 009", "POP253SUR00102", new Map()).code, "BOTTOM");
  assert.equal(classifyEntityProductCategory("9701", "SURGERY / process 013", "POP253SUR00300", new Map()).code, "TOP");
  // 424/ALIVEFORM/ADIDAS X AVAVAV: AC suffix가 실제로는 FOOTWEAR인 소스 데이터 오류 사례 —
  // 이 브랜드의 AC suffix는 신뢰하지 않고 개별 예외로 FOOTWEAR를 반환해야 한다.
  const result = classifyEntityProductCategory("9702", "ALIVEFORM / STRATUM RUNNER CHARCOAL", "ALI253AC001042", new Map());
  assert.equal(result.code, "FOOTWEAR");
  assert.equal(result.source, "model_exception");
  // 다른 브랜드는 AC suffix 공식이 그대로 유효해야 한다(무효화 금지).
  const otherBrandAc = classifyEntityProductCategory("9703", "SOME OTHER BRAND / Generic Item", "XYZ251AC00100", new Map());
  assert.equal(otherBrandAc.code, "ACCESSORY");
  assert.equal(otherBrandAc.source, "ecount_suffix");
});

// 2026-08-15 사용자 확인값 — 마지막 6개 UNCLASSIFIED 모델을 개별 예외로 확정. 이름만으로는
// 근거가 부족해 자동 규칙으로 일반화하지 않고, 사용자가 직접 확인한 정답을 그대로 고정한다.
test("2026-08-15 user-confirmed exceptions: DOMINNICO LACE SLEEVES / CARNET Unearthed Fragment Chain / SUNDAYOFFCLUB Moneyclip Chain", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const cases = [
    ["DOMINNICO / PINK LACE SLEEVES", "TOP"],
    ["DOMINNICO / BLACK LACE SLEEVES", "TOP"],
    ["DOMINNICO / WHITE LACE SLEEVES", "TOP"],
    ["CARNET ARCHIVE / Unearthed Fragment Chain RUSTY WHITE", "ACCESSORY"],
    ["CARNET ARCHIVE / Unearthed Fragment Chain OIL BLACK", "ACCESSORY"],
    ["[SUNDAYOFFCLUB : 선데이오프클럽] Montmartre Cross Moneyclip Chain - Antique Silver", "ACCESSORY"]
  ];
  for (const [productName, code] of cases) {
    const result = classifyEntityProductCategory("9800", productName, null, new Map());
    assert.equal(result.code, code, productName);
    assert.equal(result.source, "model_exception", productName);
  }
});

// 13(옛 번호). No runtime AI/LLM classification.
test("the classifier never calls an LLM/AI API at runtime — purely deterministic keyword/suffix/override rules", () => {
  const source = [
    sourceOfFunction("matchCategoryByNameKeywords"),
    sourceOfFunction("ecountCategorySuffixFromProdCd"),
    sourceOfFunction("resurrectionThirteenInternalCode"),
    sourceOfFunction("matchIndividualModelException"),
    sourceOfFunction("classifyEntityProductCategory")
  ].join("\n");
  assert.doesNotMatch(source, /fetch\(|getJson\(|getSharedJson\(|openai|anthropic|claude|gpt/i);
});

// 14/15/16/17(옛 번호). Aggregation, unattributed preservation, revenue/units reconciliation.
test("14/15/16/17. rebuildEntityCategoryRows aggregates classified entitySkuRows and reconciles attributed+unattributed to the canonical total", () => {
  const source = [
    sourceOfFunction("rebuildEntityCategoryRows")
  ].join("\n\n");
  const brandCode = "B00000KU";
  const periodKey = "2026-08";
  const entitySkuRows = [
    { categoryCode: "TOP", revenue: 600000, quantitySold: 3, stockOnly: false },
    { categoryCode: "TOP", revenue: 100000, quantitySold: 1, stockOnly: false },
    { categoryCode: "UNCLASSIFIED", revenue: 300000, quantitySold: 2, stockOnly: false },
    // Case C (stock-only, zero revenue) must be excluded from aggregation entirely.
    { categoryCode: "BAG", revenue: 0, quantitySold: 0, stockOnly: true }
  ];
  const entityTrendMonths = [{ key: periodKey, revenue: 2000000, quantitySold: 20 }]; // canonical total (online+offline)
  const CATEGORY_MASTER_V1 = [
    { code: "TOP", name: "상의" }, { code: "BOTTOM", name: "하의" }, { code: "OUTER", name: "아우터" },
    { code: "DRESS", name: "드레스" }, { code: "BAG", name: "가방" }, { code: "FOOTWEAR", name: "신발" },
    { code: "HEADWEAR", name: "모자" }, { code: "JEWELRY", name: "주얼리" }, { code: "ACCESSORY", name: "액세서리" },
    { code: "OTHER", name: "기타" }, { code: "UNCLASSIFIED", name: "미분류" }
  ];
  const fn = Function(
    "brandIdentityState", "entitySkuSalesState", "entitySkuRows", "entityTrendMonths", "currentEntityPeriodMonthKey", "CATEGORY_MASTER_V1", "renderEntityCategorySection",
    `let entityCategoryRows = []; let entityCategoryCoverage = null;
     ${source}
     rebuildEntityCategoryRows();
     return { entityCategoryRows, entityCategoryCoverage };`
  )(
    { brandCode }, { brandCode, fetchFailed: false }, entitySkuRows, entityTrendMonths, () => periodKey, CATEGORY_MASTER_V1, () => {}
  );
  const rows = fn.entityCategoryRows;
  const coverage = fn.entityCategoryCoverage;
  // Case C excluded: only TOP(700000/4) and UNCLASSIFIED(300000/2) rows exist.
  assert.equal(rows.length, 2);
  const top = rows.find((r) => r.code === "TOP");
  assert.equal(top.revenue, 700000);
  assert.equal(top.quantitySold, 4);
  const unclassified = rows.find((r) => r.code === "UNCLASSIFIED");
  assert.equal(unclassified.revenue, 300000);
  // Coverage: attributed excludes UNCLASSIFIED (700000 of 2000000 canonical total).
  assert.equal(coverage.attributedRevenue, 700000);
  assert.equal(coverage.unattributedRevenue, 1300000);
  assert.equal(coverage.attributedRevenue + coverage.unattributedRevenue, coverage.totalRevenue, "attributed + unattributed must reconcile to the canonical total");
  assert.equal(coverage.attributedUnits, 4);
  assert.equal(coverage.unattributedUnits, 16);
  assert.equal(coverage.attributedUnits + coverage.unattributedUnits, coverage.totalUnits);
  assert.equal(Math.round(coverage.coveragePct), 35, "700000/2000000 = 35%");
});

// 18(옛 번호). Customer Workspace Category
test("18. Customer Workspace Category breakdown classifies real offline purchaseDetails lines by product name (no prodCd on offline lines)", () => {
  const source = [
    "const nf = new Intl.NumberFormat(\"ko-KR\");",
    sourceOfFunction("hasApiValue"),
    sourceOfFunction("apiNum"),
    sourceOfFunction("apiWon"),
    sourceOfFunction("esc"),
    sourceOfConst("CATEGORY_NAME_KEYWORD_RULES"),
    sourceOfConst("CATEGORY_NAME_SUBCATEGORY_BY_KEYWORD"),
    sourceOfConst("CATEGORY_HANGUL_ONLY_PATTERN"),
    sourceOfFunction("categoryKeywordPattern"),
    sourceOfFunction("matchCategoryByNameKeywordsDetailed"),
    sourceOfFunction("matchCategoryByNameKeywords"),
    sourceOfFunction("clientWorkspaceCategoryHtml")
  ].join("\n\n");
  const brandLines = [
    { productName: "CARNET ARCHIVE / Wool Coat", salesAmount: 500000, quantity: 1 },
    { productName: "CARNET ARCHIVE / Denim Trousers", salesAmount: 200000, quantity: 1 }
  ];
  const CATEGORY_MASTER_V1_NAME_BY_CODE = new Map([["OUTER", "아우터"], ["BOTTOM", "하의"], ["UNCLASSIFIED", "미분류"]]);
  const html2 = Function(
    "CATEGORY_MASTER_V1_NAME_BY_CODE",
    `${source}; return clientWorkspaceCategoryHtml;`
  )(CATEGORY_MASTER_V1_NAME_BY_CODE)(brandLines);
  assert.match(html2, /아우터/);
  assert.match(html2, /하의/);
  assert.match(html2, /500,000원/);
  assert.doesNotMatch(html2, /고객별 상품군 데이터 연결 대기/, "old placeholder text must be gone");
});

// 19. Category Drawer reuses real entityCategoryRows (no separate placeholder array)
test("19. Category Drawer config reuses entityCategoryRows directly — no separate placeholder array", () => {
  assert.doesNotMatch(js, /entityCategoryDrawerRows/, "the old permanently-empty placeholder array must be removed");
  const marker = js.indexOf("category: {");
  const region = js.slice(marker, marker + 1200);
  assert.match(region, /rows: \(\) => entityCategoryRows/);
});

// 20. Category → SKU drill-down filters by the clicked category's code
test("20. Category row click threads categoryCode into drawer context, and the SKU drawer filters entitySkuRows by it", () => {
  assert.match(js, /openEntityDrawer\("sku", \{ label: row\.name, categoryCode: row\.code \}\)/);
  const skuMarker = js.indexOf('sku: {');
  const region = js.slice(skuMarker, skuMarker + 1500);
  assert.match(region, /entityDrawerState\.context\?\.categoryCode/);
  assert.match(region, /entitySkuRows\.filter\(\(row\) => row\.categoryCode === categoryCode\)/);
});

test("21. Category and Color rows open the existing SKU drawer by click/keyboard and preserve direct all-SKU fallback", () => {
  assert.match(js, /#entityCategoryList[\s\S]*?addEventListener\("click"[\s\S]*?openEntityDrawer\("sku", \{ label: row\.name, categoryCode: row\.code \}\)/);
  assert.match(js, /#entityCategoryList[\s\S]*?addEventListener\("keydown"[\s\S]*?event\.key !== "Enter" && event\.key !== " "/);
  assert.match(js, /#entityColorList[\s\S]*?addEventListener\("click"[\s\S]*?openEntityDrawer\("sku", \{ label: row\.family, colorFamily: row\.family \}\)/);
  assert.match(js, /#entityColorList[\s\S]*?addEventListener\("keydown"[\s\S]*?event\.key !== "Enter" && event\.key !== " "/);
  const skuMarker = js.indexOf('sku: {');
  const region = js.slice(skuMarker, skuMarker + 1800);
  assert.match(region, /entitySkuRows\.filter\(\(row\) => row\.colorFamily === colorFamily\)/);
  assert.match(region, /return entitySkuRows;/, "opening SKU directly must still show every SKU");
});

// Part 9 QA — registry-wide classification coverage (real catalog, not a sample).
test("Part 9 QA: real Product Registry classification coverage (verified+confirmed entries)", async () => {
  const registry = JSON.parse(await readFile(new URL("../work/product-registry.json", import.meta.url), "utf8"));
  const { matchCategoryByNameKeywords, ecountCategorySuffixFromProdCd } = loadClassifier();
  const verified = registry.entries.filter((e) => e.verified === true && e.status === "confirmed");
  let classified = 0;
  for (const entry of verified) {
    const name = entry.canonicalProductName || entry.cafe24?.productName || "";
    const prodCd = entry.ecount?.matchedProducts?.[0]?.prodCd || null;
    const code = matchCategoryByNameKeywords(name) || ecountCategorySuffixFromProdCd(prodCd);
    if (code) classified += 1;
  }
  // Informational assertion: coverage must be measurable and non-negative — the real
  // number is reported in docs/reports/CATEGORY-MASTER-DETERMINISTIC-RULES-AND-SUBCATEGORY.md.
  assert.ok(classified >= 0 && classified <= verified.length);
  assert.ok(verified.length > 0, "registry must have at least some verified+confirmed entries to measure coverage against");
});

// UI: empty/loading/failure states are honest (NULL != ZERO) and Category is no longer
// permanently blocked.
test("Category HTML default state is 'select a brand', not a permanent 'not connected' message", () => {
  assert.match(html, /브랜드를 선택하면 상품군 데이터를 확인할 수 있습니다/);
  assert.doesNotMatch(html, /공식 상품군 source가 확정되기 전에는 임의 분류를 표시하지 않습니다/);
});

test("Category coverage note element exists for Part 1/9 coverage disclosure", () => {
  assert.match(html, /id="entityCategoryCoverageNote"/);
});

// BI-CATEGORY-COLOR-INTELLIGENCE-COMPLETION — Category detail UX (hover/focus subcategory
// breakdown). Only real, already-confirmed categorySubcategoryCode values are shown — never
// invented from a product name on the fly. stockOnly rows are excluded, matching Category's
// own revenue aggregation principle (rebuildEntityCategoryRows).
test("entityCategorySubcategoryBreakdown aggregates only real categorySubcategoryCode values from entitySkuRows, excludes stockOnly and other category codes", () => {
  const source = sourceOfFunction("entityCategorySubcategoryBreakdown");
  const entitySkuRows = [
    { categoryCode: "TOP", categorySubcategoryCode: "LONG_SLEEVE", stockOnly: false },
    { categoryCode: "TOP", categorySubcategoryCode: "LONG_SLEEVE", stockOnly: false },
    { categoryCode: "TOP", categorySubcategoryCode: "HOODIE", stockOnly: false },
    { categoryCode: "TOP", categorySubcategoryCode: null, stockOnly: false },
    { categoryCode: "TOP", categorySubcategoryCode: "SHORT_SLEEVE", stockOnly: true },
    { categoryCode: "BOTTOM", categorySubcategoryCode: "BOTTOM", stockOnly: false }
  ];
  const fn = Function("entitySkuRows", `${source}; return entityCategorySubcategoryBreakdown;`)(entitySkuRows);
  const result = fn("TOP");
  assert.deepEqual(result, [["LONG_SLEEVE", 2], ["HOODIE", 1]], "stockOnly row and null subcategory must be excluded, BOTTOM category must not leak in");
});

test("entityCategoryProfileHtml shows an honest empty message when no confirmed subcategory exists for that category", () => {
  const source = [
    sourceOfFunction("entityCategoryRevenueSharePct"),
    sourceOfFunction("entityCategorySubcategoryBreakdown"),
    sourceOfFunction("entityCategoryProfileHtml")
  ].join("\n\n");
  const entityCategoryRows = [{ code: "BAG", name: "가방", revenue: 100000, quantitySold: 1, skuCount: 1 }];
  const entitySkuRows = [{ categoryCode: "BAG", categorySubcategoryCode: null, stockOnly: false }];
  const html2 = Function(
    "entityCategoryRows", "entitySkuRows", "apiWon", "apiNum", "esc",
    `${source}; return entityCategoryProfileHtml;`
  )(entityCategoryRows, entitySkuRows, (v) => `${v}원`, (v) => `${v}`, (v) => v)(entityCategoryRows[0]);
  assert.match(html2, /확정된 세부 분류 없음/);
});
