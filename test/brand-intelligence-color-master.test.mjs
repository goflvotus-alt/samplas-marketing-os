import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BI-CATEGORY-COLOR-INTELLIGENCE-COMPLETION — SAMPLAS Color Master v1. Same source-
// extraction + Function() execution pattern already established for Category
// (test/brand-intelligence-category-master.test.mjs) — real function bodies pulled from
// outputs/samplas-marketing-os.js, not reimplemented. Color Master canonical source is
// work/color-master.json, served read-only via GET /api/intelligence/color-master
// (intelligence-service.mjs handleColorMasterGet) — never hardcoded here.
const js = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
const colorMaster = JSON.parse(await readFile(new URL("../work/color-master.json", import.meta.url), "utf8"));
const intelligenceService = await readFile(new URL("../intelligence-service.mjs", import.meta.url), "utf8");

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
  sourceOfConst("COLOR_RAW_MODIFIER_WORDS"),
  sourceOfFunction("colorAliasPattern"),
  sourceOfFunction("buildColorAliasIndex"),
  sourceOfFunction("matchColorFamiliesInText"),
  sourceOfFunction("extractColorRawForFamily"),
  sourceOfFunction("classifyEntityProductColor")
].join("\n\n");

function loadClassifier() {
  return Function(`${CLASSIFIER_SOURCE}; return { classifyEntityProductColor };`)();
}

// 1. Color Master canonical source — 36 families / 124 aliases (하드코딩 아님, 파일에서 직접 읽음).
test("1. work/color-master.json defines 36 families with the confirmed specialFamilyPriority", () => {
  assert.equal(colorMaster.version, "v1");
  assert.equal(colorMaster.families.length, 36);
  const aliasTotal = Object.values(colorMaster.aliases).flat().length;
  assert.equal(aliasTotal, 124);
  assert.deepEqual(colorMaster.policy.specialFamilyPriority, ["CAMO", "LEOPARD", "CHECK", "STRIPE", "DENIM", "PRINT"]);
  assert.equal(colorMaster.policy.ambiguousColorGuessing, false);
});

// 2. API route/handler registered (구조 확인 — 실제 HTTP는 다른 통합 테스트가 아니라
// 여기서는 route registration만 정적으로 확인, 기존 category-master 패턴과 동일).
test("2. GET /api/intelligence/color-master is registered and reads work/color-master.json read-only", () => {
  assert.match(intelligenceService, /url\.pathname === "\/api\/intelligence\/color-master"/);
  assert.match(intelligenceService, /handleColorMasterGet/);
  assert.match(intelligenceService, /colorMasterFile = join\(workRoot, "color-master\.json"\)/);
  const handlerMatch = intelligenceService.match(/async function handleColorMasterGet\(res\) \{[\s\S]*?\n\}/);
  assert.notEqual(handlerMatch, null);
  assert.doesNotMatch(handlerMatch[0], /writeFile|writeJsonAtomic/, "color-master GET handler must never write the file");
});

// 3-13. Deterministic special-priority / MULTI / UNKNOWN cases (요구 목록 그대로).
const CASES = [
  ["3. DENIM + CAMO => CAMO", "424 / SOMETHING DENIM CAMO PANTS", "CAMO"],
  ["4. LEOPARD + BROWN + PRINT => LEOPARD", "424 / LEOPARD BROWN PRINT DRESS", "LEOPARD"],
  ["5. CHECK + PRINT + RED => CHECK", "424 / CHECK PRINT RED SHIRT", "CHECK"],
  ["6. STRIPE + PRINT => STRIPE", "424 / STRIPE PRINT TOP", "STRIPE"],
  ["7. DENIM + PRINT + BLUE => DENIM", "424 / DENIM PRINT BLUE JEANS", "DENIM"],
  ["8. BLACK => BLACK", "424 / SOMETHING BLACK", "BLACK"],
  ["9. DIRTY WHITE => WHITE", "424 / DRAGONRIDER ROCK LEATHER DIRTY WHITE", "WHITE"],
  ["10. BLACK + WHITE => MULTI", "424 / SOMETHING BLACK WHITE JACKET", "MULTI"],
  ["11. no evidence => UNKNOWN", "424 / NO EVIDENCE HERE GIBBERISH XYZZY", "UNKNOWN"],
  ["12. CAMO DENIM => CAMO", "424 / CAMO DENIM JACKET", "CAMO"],
  ["13. BLUE DENIM => DENIM", "424 / BLUE DENIM JACKET", "DENIM"]
];
for (const [label, productName, expectedFamily] of CASES) {
  test(label, () => {
    const { classifyEntityProductColor } = loadClassifier();
    const result = classifyEntityProductColor(productName, colorMaster);
    assert.equal(result.family, expectedFamily, productName);
  });
}

// 14. RAW 표현은 실제 매칭된 evidence만 보존한다 — 임의 단어를 색상 서술어로 추론하지 않는다.
test("14. RAW preservation: only audited modifier words extend the raw phrase, not arbitrary preceding words", () => {
  const { classifyEntityProductColor } = loadClassifier();
  const dirty = classifyEntityProductColor("424 / DRAGONRIDER ROCK LEATHER DIRTY WHITE", colorMaster);
  assert.equal(dirty.raw, "DIRTY WHITE");
  const notModifier = classifyEntityProductColor("CARNET ARCHIVE / Basic Cotton T-Shirt Black", colorMaster);
  assert.equal(notModifier.raw, "Black", "\"Shirt\" must NOT be pulled into the raw phrase — it is not an audited modifier word");
});

// 15. explicit MULTI wording resolves to MULTI via the alias itself (섹션 7 explicitMultiRule).
test("15. explicit MULTI/MULTICOLOR wording classifies as MULTI via color_master source", () => {
  const { classifyEntityProductColor } = loadClassifier();
  const result = classifyEntityProductColor("SOME BRAND / Print Scarf MULTICOLOR", colorMaster);
  assert.equal(result.family, "MULTI");
  assert.equal(result.source, "color_master");
});

// 16. word-boundary safety — Category classifier와 동일한 이유로 부분 문자열 오검출 방지.
test("16. word-boundary matching prevents false-positive substring matches (no crash/false match on non-alias substrings)", () => {
  const { classifyEntityProductColor } = loadClassifier();
  const result = classifyEntityProductColor("SOME BRAND / SHIRRING DETAIL BLOUSE", colorMaster);
  assert.equal(result.family, "UNKNOWN");
});

// 17. no evidence => UNKNOWN with fallback source, never guesses from brand/type/price/etc.
test("17. UNKNOWN result has source: fallback and empty matchedAliases (never guesses)", () => {
  const { classifyEntityProductColor } = loadClassifier();
  const result = classifyEntityProductColor("SOME BRAND / Totally Unrelated Product Name Zzz", colorMaster);
  assert.equal(result.family, "UNKNOWN");
  assert.equal(result.source, "fallback");
  assert.equal(result.raw, null);
  assert.deepEqual(result.matchedAliases, []);
});

// 18. missing/null colorMaster (아직 로드 전) => UNKNOWN, never throws.
test("18. classifyEntityProductColor never throws and returns UNKNOWN when colorMaster is not yet loaded", () => {
  const { classifyEntityProductColor } = loadClassifier();
  assert.doesNotThrow(() => {
    const result = classifyEntityProductColor("ANY PRODUCT NAME BLACK", null);
    assert.equal(result.family, "UNKNOWN");
  });
});

// 19/20. rebuildEntityColorRows aggregation: stockOnly excluded, UNKNOWN included, rawExpressions deduped.
test("19/20. rebuildEntityColorRows aggregates entitySkuRows only, excludes stockOnly, includes UNKNOWN, dedupes rawExpressions", () => {
  const source = [sourceOfFunction("rebuildEntityColorRows")].join("\n\n");
  const brandCode = "B00000KU";
  const periodKey = "2026-08";
  const entitySkuRows = [
    { colorFamily: "BLACK", colorRaw: "BLACK", revenue: 600000, quantitySold: 3, stockOnly: false },
    { colorFamily: "BLACK", colorRaw: "BLACK", revenue: 100000, quantitySold: 1, stockOnly: false },
    { colorFamily: "UNKNOWN", colorRaw: null, revenue: 300000, quantitySold: 2, stockOnly: false },
    { colorFamily: "WHITE", colorRaw: "WHITE", revenue: 0, quantitySold: 0, stockOnly: true }
  ];
  const entityTrendMonths = [{ key: periodKey, revenue: 2000000, quantitySold: 20 }];
  const fn = Function(
    "brandIdentityState", "entitySkuSalesState", "entitySkuRows", "entityTrendMonths", "currentEntityPeriodMonthKey", "renderEntityColorSection",
    `let entityColorRows = []; let entityColorCoverage = null;
     ${source}
     rebuildEntityColorRows();
     return { entityColorRows, entityColorCoverage };`
  )(
    { brandCode }, { brandCode, fetchFailed: false }, entitySkuRows, entityTrendMonths, () => periodKey, () => {}
  );
  const rows = fn.entityColorRows;
  const coverage = fn.entityColorCoverage;
  assert.equal(rows.length, 2, "stockOnly WHITE row must be excluded — only BLACK and UNKNOWN remain");
  const black = rows.find((r) => r.family === "BLACK");
  assert.equal(black.revenue, 700000);
  assert.equal(black.quantitySold, 4);
  assert.deepEqual(black.rawExpressions, ["BLACK"], "rawExpressions must be deduplicated");
  const unknown = rows.find((r) => r.family === "UNKNOWN");
  assert.notEqual(unknown, undefined, "UNKNOWN must not be hidden from entityColorRows");
  assert.equal(unknown.revenue, 300000);
  assert.equal(coverage.attributedRevenue, 700000, "UNKNOWN excluded from attributed");
  assert.equal(coverage.unattributedRevenue, 1300000);
  assert.equal(coverage.attributedRevenue + coverage.unattributedRevenue, coverage.totalRevenue);
});

// CARNET ARCHIVE 2026-08 regression (BI-COLOR-AGGREGATION-FIX). 실 데이터를 직접 검사해 재현한
// 시나리오: productNo 9049(MASS DENIM JACKET DARK GREY)는 이번 기간 온라인 판매가 0건이라
// (entitySkuSalesState.rows에 없음) stockOnly:true, revenue:0인 Case C 행이고, colorFamily는
// DENIM으로 정확히 분류되어 있다. 나머지 4개 실판매 SKU(1,210,000/628,139/269,660/124,160원,
// 합계 2,231,959원)는 Product Registry에 verified+confirmed 연결이 없어 colorFamily가
// UNKNOWN이다(브라우저 라이브 조사로 확인 — Category가 이 4개를 전부 이름 기반 fallback으로
// 분류해내는 것과 대조적). 이 테스트는 "entitySkuRows에 DENIM 행이 존재하는데 집계가
// UNKNOWN 100%" 상태가 **버그가 아니라 두 사실(revenue=0 stockOnly 제외 + registry 커버리지
// 격차)의 수학적으로 정확한 결과**임을 고정한다 — stockOnly 제외 정책이나 집계 로직이
// 나중에 실수로 바뀌면 이 테스트가 잡아낸다.
test("CARNET ARCHIVE 2026-08 regression: a real stockOnly DENIM row (0 revenue) does not change the UNKNOWN 100% result of the 4 real-revenue UNKNOWN rows", () => {
  const source = [sourceOfFunction("rebuildEntityColorRows")].join("\n\n");
  const brandCode = "B00000KU";
  const periodKey = "2026-08";
  const entitySkuRows = [
    { productNo: "11753", colorFamily: "UNKNOWN", colorRaw: null, revenue: 1210000, quantitySold: 2, stockOnly: false },
    { productNo: "13383", colorFamily: "UNKNOWN", colorRaw: null, revenue: 628139, quantitySold: 1, stockOnly: false },
    { productNo: "12616", colorFamily: "UNKNOWN", colorRaw: null, revenue: 269660, quantitySold: 1, stockOnly: false },
    { productNo: "12610", colorFamily: "UNKNOWN", colorRaw: null, revenue: 124160, quantitySold: 1, stockOnly: false },
    { productNo: "9049", colorFamily: "DENIM", colorRaw: "DENIM", revenue: 0, quantitySold: 0, stockOnly: true }
  ];
  const entityTrendMonths = [{ key: periodKey, revenue: 13794759, quantitySold: 39 }];
  const fn = Function(
    "brandIdentityState", "entitySkuSalesState", "entitySkuRows", "entityTrendMonths", "currentEntityPeriodMonthKey", "renderEntityColorSection",
    `let entityColorRows = []; let entityColorCoverage = null;
     ${source}
     rebuildEntityColorRows();
     return { entityColorRows, entityColorCoverage };`
  )(
    { brandCode }, { brandCode, fetchFailed: false }, entitySkuRows, entityTrendMonths, () => periodKey, () => {}
  );
  const rows = fn.entityColorRows;
  const coverage = fn.entityColorCoverage;
  // 현재 실제 화면과 정확히 같은 숫자 — 이것이 버그가 아니라 올바른 결과임을 고정한다.
  assert.equal(rows.length, 1, "the stockOnly DENIM row (0 revenue) is correctly excluded, leaving only the UNKNOWN bucket");
  assert.equal(rows[0].family, "UNKNOWN");
  assert.equal(rows[0].revenue, 2231959);
  assert.equal(rows[0].skuCount, 4);
  assert.equal(coverage.attributedRevenue, 0);
  assert.equal(coverage.unattributedRevenue, 13794759);
  assert.equal(coverage.coveragePct, 0);
  // DENIM은 매출 0원이라 revenue 기준 집계 자체에는 등장하지 않는다 — 임의로 revenue를
  // 만들어내지 않는다(수정 원칙: 새로운 매출 계산 로직 추가 금지).
  assert.equal(rows.find((r) => r.family === "DENIM"), undefined);
});

// 일반 케이스: 실제 매출이 있는 SKU가 DENIM으로 분류되면 그 매출만큼 정확히 DENIM에
// 집계된다(위 회귀 테스트는 우연히 매출이 0인 특정 SKU를 다루므로, 이 테스트가 "매출이
// 있는 DENIM 행은 실제로 집계에 반영된다"는 일반 정합성을 별도로 증명한다).
test("a DENIM row with real revenue is correctly aggregated into the DENIM family (not swallowed, not UNKNOWN)", () => {
  const source = [sourceOfFunction("rebuildEntityColorRows")].join("\n\n");
  const brandCode = "B00000KU";
  const periodKey = "2026-08";
  const entitySkuRows = [
    { productNo: "9049", colorFamily: "DENIM", colorRaw: "DENIM", revenue: 628139, quantitySold: 1, stockOnly: false },
    { productNo: "11753", colorFamily: "UNKNOWN", colorRaw: null, revenue: 1210000, quantitySold: 2, stockOnly: false }
  ];
  const entityTrendMonths = [{ key: periodKey, revenue: 1838139, quantitySold: 3 }];
  const fn = Function(
    "brandIdentityState", "entitySkuSalesState", "entitySkuRows", "entityTrendMonths", "currentEntityPeriodMonthKey", "renderEntityColorSection",
    `let entityColorRows = []; let entityColorCoverage = null;
     ${source}
     rebuildEntityColorRows();
     return { entityColorRows, entityColorCoverage };`
  )(
    { brandCode }, { brandCode, fetchFailed: false }, entitySkuRows, entityTrendMonths, () => periodKey, () => {}
  );
  const denim = fn.entityColorRows.find((r) => r.family === "DENIM");
  assert.notEqual(denim, undefined, "DENIM must appear in entityColorRows when a real-revenue row has colorFamily DENIM");
  assert.equal(denim.revenue, 628139, "DENIM revenue must exactly equal that SKU's revenue");
  assert.equal(denim.quantitySold, 1);
  assert.equal(fn.entityColorCoverage.attributedRevenue, 628139);
  assert.notEqual(fn.entityColorCoverage.coveragePct, 0, "coverage must not be 0% once a real classified SKU has revenue");
});

// Category 회귀 확인: 같은 CARNET ARCHIVE 2026-08 5행 데이터셋으로 Category 집계가
// stockOnly DENIM 행을 동일하게 제외하고, 나머지 4개는 그대로(이름 기반 fallback으로 이미
// 분류되어 있다고 가정, 이 테스트는 재분류하지 않고 이미 분류된 categoryCode만 검증) 집계됨을
// 확인한다 — Color 수정이 Category 결과에 영향을 주지 않았음을 고정한다.
test("Category aggregation on the same CARNET ARCHIVE 2026-08 dataset is unaffected by the stockOnly DENIM row", () => {
  const source = [sourceOfFunction("rebuildEntityCategoryRows")].join("\n\n");
  const brandCode = "B00000KU";
  const periodKey = "2026-08";
  const entitySkuRows = [
    { categoryCode: "TOP", revenue: 1210000, quantitySold: 2, stockOnly: false },
    { categoryCode: "OUTER", revenue: 628139, quantitySold: 1, stockOnly: false },
    { categoryCode: "ACCESSORY", revenue: 269660, quantitySold: 1, stockOnly: false },
    { categoryCode: "JEWELRY", revenue: 124160, quantitySold: 1, stockOnly: false },
    { categoryCode: "OUTER", revenue: 0, quantitySold: 0, stockOnly: true } // productNo 9049, DENIM jacket, real Category = OUTER too
  ];
  const entityTrendMonths = [{ key: periodKey, revenue: 13794759, quantitySold: 39 }];
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
  const outer = fn.entityCategoryRows.find((r) => r.code === "OUTER");
  // stockOnly 행이 제외되므로 OUTER는 productNo 13383(628,139원) 하나만 집계된다 —
  // 실제 화면에서 확인한 것과 동일(skuCount:1).
  assert.equal(outer.skuCount, 1, "the stockOnly OUTER row (productNo 9049) must be excluded, same as Color");
  assert.equal(outer.revenue, 628139);
  assert.equal(fn.entityCategoryCoverage.attributedRevenue, 2231959);
  assert.equal(fn.entityCategoryCoverage.coveragePct, (2231959 / 13794759) * 100);
});

// 21. Color coverage state is fully independent from Category coverage state.
test("21. Color coverage does not share state with Category coverage", () => {
  assert.match(js, /let entityColorCoverage = null;/);
  assert.match(js, /let entityCategoryCoverage = null;/);
  assert.doesNotMatch(sourceOfFunction("rebuildEntityColorRows"), /entityCategoryCoverage/);
});

// 22. Category/Color taxonomies are never merged into one.
test("22. Category and Color taxonomies remain structurally independent (no shared family/category list)", () => {
  assert.doesNotMatch(js, /CATEGORY_MASTER_V1[\s\S]{0,80}colorMaster/);
  const colorFamilyNames = new Set(colorMaster.families);
  const categoryCodes = ["TOP", "BOTTOM", "OUTER", "DRESS", "BAG", "FOOTWEAR", "HEADWEAR", "JEWELRY", "ACCESSORY", "OTHER", "UNCLASSIFIED"];
  const overlap = categoryCodes.filter((code) => colorFamilyNames.has(code) && code !== "OTHER");
  assert.deepEqual(overlap, [], "Category codes and Color families must not collide (OTHER existing independently in both is fine)");
});

// 23. entitySkuRows carries both Category and Color fields simultaneously without removing existing Category fields.
test("23. rebuildEntitySkuRows sets colorFamily/colorRaw/colorSource/colorMatchedAliases alongside unmodified categoryCode/categorySubcategoryCode/categorySource", () => {
  const source = sourceOfFunction("rebuildEntitySkuRows");
  assert.match(source, /categoryCode: category\.code/);
  assert.match(source, /categorySubcategoryCode: category\.subcategoryCode \|\| null/);
  assert.match(source, /categorySource: category\.source/);
  assert.match(source, /colorFamily: color\.family/);
  assert.match(source, /colorRaw: color\.raw/);
  assert.match(source, /colorSource: color\.source/);
  assert.match(source, /colorMatchedAliases: color\.matchedAliases/);
  // Case C(stockOnly) 경로에도 동일하게 존재해야 한다(이전에 categorySubcategoryCode가
  // 누락됐던 것과 같은 종류의 회귀를 막는다).
  const occurrences = [...source.matchAll(/categorySubcategoryCode: category\.subcategoryCode \|\| null/g)];
  assert.equal(occurrences.length, 2, "categorySubcategoryCode must be set on both the online-sales rows AND the Case C stock-only rows");
  const colorOccurrences = [...source.matchAll(/colorFamily: color\.family/g)];
  assert.equal(colorOccurrences.length, 2, "colorFamily must be set on both the online-sales rows AND the Case C stock-only rows");
});

// 24. Color evidence source is the ECOUNT productName (via exact prodCd join), not Cafe24's.
test("24. Color classification reads the ECOUNT item's productName via exact prodCd match, not Cafe24 productName, and not fuzzy join", () => {
  const source = sourceOfFunction("entityEcountProductNameFor");
  assert.match(source, /verified === true && item\?\.status === "confirmed"/);
  assert.match(source, /String\(item\?\.cafe24\?\.productNo \|\| ""\) === String\(productNo \|\| ""\)/);
  assert.doesNotMatch(source, /productName\.toLowerCase\(\)|includes\(|fuzzy/i, "must not fuzzy-match by productName text");
});
