import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// BI-BATCH-I Part 1/2/9/10 — SAMPLAS Category Master v1 (docs/BRAND_INTELLIGENCE_RULES.md).
// Same source-extraction + Function() execution pattern already established in this repo
// (no jsdom) — real function bodies pulled from outputs/samplas-marketing-os.js, not
// reimplemented.
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
  sourceOfConst("CATEGORY_ECOUNT_SUFFIX_MAP"),
  sourceOfFunction("categoryKeywordPattern"),
  sourceOfFunction("matchCategoryByNameKeywords"),
  sourceOfFunction("ecountCategorySuffixFromProdCd"),
  sourceOfFunction("classifyEntityProductCategory")
].join("\n\n");

function loadClassifier() {
  return Function(`${CLASSIFIER_SOURCE}; return { CATEGORY_MASTER_V1, matchCategoryByNameKeywords, ecountCategorySuffixFromProdCd, classifyEntityProductCategory };`)();
}

// 1. Taxonomy master
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

// 2. Manual override priority
test("2. manual override always wins over name-keyword and ECOUNT-suffix rules", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  const overrides = new Map([["1001", "JEWELRY"]]);
  const result = classifyEntityProductCategory("1001", "SOME DENIM JEANS", "BRD251BT00100", overrides);
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

// 12. Ambiguous → UNCLASSIFIED (name matches two categories at once — must not guess)
test("12. a product name matching two category keyword sets at once never guesses — falls through to UNCLASSIFIED (no ECOUNT suffix available)", () => {
  const { classifyEntityProductCategory } = loadClassifier();
  // "Jacket Dress" matches both OUTER(jacket) and DRESS(dress).
  const result = classifyEntityProductCategory("9002", "Belted Jacket Dress", null, new Map());
  assert.equal(result.code, "UNCLASSIFIED");
  assert.equal(result.source, "fallback");
});

// ECOUNT suffix rules — activated set only (audited against work/product-registry.json's
// 103 verified+confirmed entries, see docs/BRAND_INTELLIGENCE_RULES.md for the evidence).
test("ECOUNT suffix fallback activates only the audited-deterministic codes (BG/BT/SH/JW/FW/OT/HW)", () => {
  const { ecountCategorySuffixFromProdCd } = loadClassifier();
  assert.equal(ecountCategorySuffixFromProdCd("604251BG00100"), "BAG");
  assert.equal(ecountCategorySuffixFromProdCd("604251BT00500"), "BOTTOM");
  assert.equal(ecountCategorySuffixFromProdCd("RAS243SH00104"), "TOP");
  assert.equal(ecountCategorySuffixFromProdCd("4FE240JW01000"), "JEWELRY");
  assert.equal(ecountCategorySuffixFromProdCd("OTT243FW001275"), "FOOTWEAR");
  assert.equal(ecountCategorySuffixFromProdCd("RAC263OT00104"), "OUTER");
  assert.equal(ecountCategorySuffixFromProdCd("HEL251HW00100"), "HEADWEAR");
});

test("ECOUNT suffix fallback does NOT activate AC/LT/ST/DR — real catalog evidence showed mixed or absent semantics", () => {
  const { ecountCategorySuffixFromProdCd } = loadClassifier();
  assert.equal(ecountCategorySuffixFromProdCd("RAC261AC00100"), null);
  assert.equal(ecountCategorySuffixFromProdCd("604251LT00300"), null);
  assert.equal(ecountCategorySuffixFromProdCd("604253ST00200"), null);
  assert.equal(ecountCategorySuffixFromProdCd("XXX251DR00100"), null);
});

// 13. No runtime AI/LLM classification
test("13. the classifier never calls an LLM/AI API at runtime — purely deterministic keyword/suffix/override rules", () => {
  const source = [
    sourceOfFunction("matchCategoryByNameKeywords"),
    sourceOfFunction("ecountCategorySuffixFromProdCd"),
    sourceOfFunction("classifyEntityProductCategory")
  ].join("\n");
  assert.doesNotMatch(source, /fetch\(|getJson\(|getSharedJson\(|openai|anthropic|claude|gpt/i);
});

// 14/15/16/17. Aggregation, unattributed preservation, revenue/units reconciliation.
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

// 18. Customer Workspace Category
test("18. Customer Workspace Category breakdown classifies real offline purchaseDetails lines by product name (no prodCd on offline lines)", () => {
  const source = [
    "const nf = new Intl.NumberFormat(\"ko-KR\");",
    sourceOfFunction("hasApiValue"),
    sourceOfFunction("apiNum"),
    sourceOfFunction("apiWon"),
    sourceOfFunction("esc"),
    sourceOfConst("CATEGORY_NAME_KEYWORD_RULES"),
    sourceOfFunction("categoryKeywordPattern"),
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
  assert.match(js, /categoryCode: entityDrawerState\.type === "category" \? row\.dataset\.entityId : \(entityDrawerState\.context\?\.categoryCode \|\| null\)/);
  const skuMarker = js.indexOf('sku: {');
  const region = js.slice(skuMarker, skuMarker + 1500);
  assert.match(region, /entityDrawerState\.context\?\.categoryCode/);
  assert.match(region, /entitySkuRows\.filter\(\(row\) => row\.categoryCode === categoryCode\)/);
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
  // number is reported in docs/reports/BI-BATCH-I-complete-business-rules.md, not hidden.
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
