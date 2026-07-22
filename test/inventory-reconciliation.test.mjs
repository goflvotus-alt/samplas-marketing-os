// ECOUNT ↔ Cafe24 재고 정합성 진단(scripts/diagnose-inventory-reconciliation.mjs) 테스트.
//
// 이 파일은 원래 2026-07-19 커밋(93016d8)에서 만들어졌던 구버전 스크립트를 대상으로
// 작성되었으나(DEFAULT_THRESHOLDS/normalizeInventoryValue/reconcileInventoryPair/summarizeItems를
// import), 그 버전은 Product Registry(work/product-registry.json)가 생성되기 전에 실행되어
// 실제로는 비교 대상 0건짜리 빈 결과만 냈다. 2026-07-21~22 세션에서 스크립트 전체를 Product
// Registry 실제 스키마(entries[].canonicalProductId/cafe24/ecount.matchedProducts 등) 기준으로
// 새로 구현하면서 함수명과 구조가 모두 바뀌어 이 테스트의 원래 import가 깨졌다.
//
// 이 파일은 단순히 import만 새 이름으로 바꾸는 대신, 원래 테스트가 검증하려던 핵심 목적
// (exact/within_tolerance/mismatch/missing_ecount/missing_cafe24/duplicate_mapping 판정,
// 잘못된 수치 처리, 요약 집계)을 실제 fixture 기반으로 새 구현에 맞게 재작성한 것이다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildCafe24ProductMap,
  isConsignmentProductName,
  compareEntry,
  detectConflicts,
  isTrustedEntry,
  loadRegistry,
  loadEcountSource,
  monthWindow,
  isPlausibleYear,
  selectCafe24Source,
  buildNegativeStockCandidates,
  isActionCandidate,
  normalizeBrandName,
  brandFromEcountProductName
} from "../scripts/diagnose-inventory-reconciliation.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/diagnose-inventory-reconciliation.mjs", import.meta.url));

function makeEntry(overrides = {}) {
  return {
    canonicalProductId: "CP-TEST-1",
    brandId: "B-TEST",
    brandName: "TESTBRAND",
    canonicalProductName: "Test Product",
    status: "confirmed",
    confidence: 100,
    verified: true,
    cafe24: { productNo: "1001", productCode: "PTEST001", productName: "[TESTBRAND] Test Product" },
    ecount: {
      matchedProducts: [
        { prodCd: "TST251OT00100", barcode: "TST251OT00100", productName: "TESTBRAND / Test Product", size: "OS", supplier: null, consignment: false }
      ]
    },
    matching: { strategy: "normalized_brand_product_exact", diagnosticType: ["exact_one_to_one"], evidence: [], pendingReasons: [] },
    ...overrides
  };
}

function makeEcountMap(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.productCode, row);
  return map;
}

function makeCafe24Source(products) {
  return { productMap: buildCafe24ProductMap(products), fallbackIndex: new Map() };
}

// ---------------------------------------------------------------------------
// 원 테스트 목적 1: 정확히 일치 → exact_match
// (구버전: pair(3, 3).reconciliationStatus === "exact_match")
// ---------------------------------------------------------------------------
test("exact match: ECOUNT와 Cafe24 재고가 같으면 exact_match", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 3 }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 3 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "exact_match");
  assert.equal(result.comparison.difference, 0);
});

// ---------------------------------------------------------------------------
// 원 테스트 목적 2: 근소한 차이 → within_tolerance(신규 명칭: near_match)
// (구버전: pair(3, 2) 및 pair(100, 98) 모두 "within_tolerance")
// ---------------------------------------------------------------------------
test("near match(구 within_tolerance): 절대 차이 1이면 near_match", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 3 }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 2 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "near_match");
});

test("near match(구 within_tolerance): 큰 수량이어도 차이 비율이 작으면 near_match", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 100 }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 98 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "near_match");
});

// ---------------------------------------------------------------------------
// 원 테스트 목적 3: 큰 차이 → mismatch
// (구버전: pair(10, 4) 및 pair(0, 3) 모두 "mismatch")
// ---------------------------------------------------------------------------
test("mismatch: 절대/비율 차이가 모두 기준을 초과하면 mismatch", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 10 }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 4 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "mismatch");
});

test("mismatch: 한쪽이 0이고 다른 쪽이 0이 아니면 mismatch", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 0 }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 3 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "mismatch");
});

// ---------------------------------------------------------------------------
// 원 테스트 목적 4: 한쪽 데이터 없음 → missing_ecount / missing_cafe24
// (신규 명칭: 둘 다 one_source_missing으로 통합, 원인은 flags로 구분)
// ---------------------------------------------------------------------------
test("source missing(구 missing_ecount): ECOUNT 재고가 없으면 one_source_missing + missing_ecount_item 플래그", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([]); // TST251OT00100 자체가 ECOUNT 스냅샷에 없음
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 4 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "one_source_missing");
  assert.ok(result.flags.includes("missing_ecount_item"));
});

test("source missing(구 missing_cafe24): Cafe24 재고가 없으면 one_source_missing + missing_cafe24_product 플래그", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 4 }]);
  const cafe24 = makeCafe24Source([]); // productNo 1001이 어디에도 없음
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "one_source_missing");
  assert.ok(result.flags.includes("missing_cafe24_product"));
});

// ---------------------------------------------------------------------------
// 원 테스트 목적 5: 양쪽 0 → 정확히 일치, differenceRate는 division by zero 없이 0
// (구버전: pair(0, 0).differenceRate === 0)
// ---------------------------------------------------------------------------
test("양쪽 재고가 모두 0이면 exact_match이고 differenceRate는 0이다 (division by zero 없음)", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 0 }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 0 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "exact_match");
  assert.equal(result.comparison.differenceRate, 0);
});

// ---------------------------------------------------------------------------
// 원 테스트 목적 6: 잘못된 수치 → invalid_value(신규 명칭: invalid_data)
// (구버전: pair(-1, 3).reconciliationStatus === "invalid_value",
//  normalizeInventoryValue("abc").status === "invalid")
//
// 신규 구현에서는 ECOUNT/Cafe24 원본 소스(work/ecount-inventory/latest.json,
// product-dashboard-proxy-*.json)의 stockQuantity/inventoryQuantity가 이미 순수 JSON 숫자
// 타입으로 저장되어 있음을 실측 확인했다(문자열 "1,234"/"(2)" 형태로 오는 사례가 없음).
// 따라서 문자열 파싱(normalizeInventoryValue)은 현재 데이터 구조에서는 불필요하며, 대신
// NaN/Infinity 같은 비정상 숫자값이 들어오는 경우를 invalid_data로 분류하는지 검증한다.
// ---------------------------------------------------------------------------
test("invalid data(구 invalid_value): ECOUNT stockQuantity가 NaN이면 invalid_data", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: NaN }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 4 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "invalid_data");
});

test("invalid data: verified 상품인데 ECOUNT PROD_CD 연결이 아예 없으면 invalid_data", () => {
  const entry = makeEntry({ ecount: { matchedProducts: [] } });
  const ecountMap = makeEcountMap([]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 4 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.status, "invalid_data");
  assert.ok(result.flags.includes("verified_without_ecount_prodcd"));
});

// ---------------------------------------------------------------------------
// 원 테스트 목적 7: 중복 매핑 → duplicate_mapping(신규: 아이템 status는 그대로,
// detectConflicts가 전역 충돌 목록으로 별도 보고)
// (구버전: pair(1, 1, ["duplicate_ecount_product_code"]).reconciliationStatus === "duplicate_mapping")
// ---------------------------------------------------------------------------
test("duplicate link(구 duplicate_mapping): 동일 ECOUNT PROD_CD가 2개의 Canonical Product에 걸리면 duplicateEcountProdCds에 잡힌다", () => {
  const entries = [
    makeEntry({ canonicalProductId: "CP-A" }),
    makeEntry({ canonicalProductId: "CP-B", cafe24: { productNo: "2002", productCode: "PTEST002" } })
  ];
  const conflicts = detectConflicts(entries, new Set(["CP-A", "CP-B"]));
  assert.equal(conflicts.duplicateEcountProdCds.length, 1);
  assert.equal(conflicts.duplicateEcountProdCds[0].prodCd, "TST251OT00100");
  assert.equal(conflicts.duplicateEcountProdCdsAffectingVerified.length, 1);
});

test("duplicate link: 동일 Cafe24 productNo가 2개의 Canonical Product에 걸리면 duplicateCafe24Products에 잡힌다", () => {
  const entries = [
    makeEntry({ canonicalProductId: "CP-A" }),
    makeEntry({ canonicalProductId: "CP-B", ecount: { matchedProducts: [{ prodCd: "OTHER001" }] } })
  ];
  const conflicts = detectConflicts(entries, new Set(["CP-A", "CP-B"]));
  assert.equal(conflicts.duplicateCafe24Products.length, 1);
  assert.equal(conflicts.duplicateCafe24Products[0].productNo, "1001");
});

// ---------------------------------------------------------------------------
// 원 테스트 목적 8(구 요약 함수 summarizeItems 검증) → 신규 구현에서는 요약을
// main()이 CLI 레벨에서 계산하므로, 실제 CLI를 fixture로 실행해 summary 필드를 검증한다.
// ---------------------------------------------------------------------------
test("summary 집계: 단순 재고 차이는 후보에서 제외하고 조치 후보만 출력한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-recon-summary-"));
  try {
    const entries = [
      makeEntry({ canonicalProductId: "CP-1", cafe24: { productNo: "1", productCode: "P1" }, ecount: { matchedProducts: [{ prodCd: "E1" }] } }), // 단순 불일치, 제외
      makeEntry({ canonicalProductId: "CP-2", cafe24: { productNo: "2", productCode: "P2" }, ecount: { matchedProducts: [{ prodCd: "QQQ002" }] } }), // QQQ 음수, 포함
      makeEntry({ canonicalProductId: "CP-3", cafe24: { productNo: "3", productCode: "P3" }, ecount: { matchedProducts: [{ prodCd: "E3" }] } }), // 일반 음수+판매, 포함
      makeEntry({ canonicalProductId: "CP-4", cafe24: { productNo: "4", productCode: "P4" }, ecount: { matchedProducts: [{ prodCd: "E4" }] } })  // 일반 음수+판매 없음, 제외
    ];
    const registry = { entries };
    const ecountRows = [
      { productCode: "E1", productName: "TESTBRAND / Diff Only", stockQuantity: 50 },
      { productCode: "QQQ002", productName: "QQQBRAND / Negative", stockQuantity: -1 },
      { productCode: "E3", productName: "TESTBRAND / Sold Negative", stockQuantity: -1 },
      { productCode: "E4", productName: "TESTBRAND / Unsold Negative", stockQuantity: -1 }
    ];
    const cafe24Products = [
      { productNo: 1, options: [], inventoryQuantity: 1, quantitySold: 0, orderCount: 0, salesAmount: 0 },
      { productNo: 2, options: [], inventoryQuantity: 0, quantitySold: 0, orderCount: 0, salesAmount: 0 },
      { productNo: 3, options: [], inventoryQuantity: 0, quantitySold: 1, orderCount: 1, salesAmount: 1000 },
      { productNo: 4, options: [], inventoryQuantity: 0, quantitySold: 0, orderCount: 0, salesAmount: 0 }
    ];

    const registryPath = join(dir, "registry.json");
    const ecountPath = join(dir, "ecount.json");
    const cafe24Path = join(dir, "cafe24.json");
    const outputPath = join(dir, "output.json");
    await writeFile(registryPath, JSON.stringify(registry));
    await writeFile(ecountPath, JSON.stringify(ecountRows));
    await writeFile(cafe24Path, JSON.stringify({ products: cafe24Products }));

    execFileSync("node", [scriptPath, `--registry=${registryPath}`, `--ecount=${ecountPath}`, `--cafe24=${cafe24Path}`, `--output=${outputPath}`]);

    const result = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(result.summary.actionCandidateCount, 2);
    assert.equal(result.summary.negativeStockCount, 2);
    assert.equal(result.summary.mismatchCount, 0);
    assert.ok(!result.meta.registryPath.startsWith("/"));
    assert.ok(!result.meta.ecountPath.startsWith("/"));
    assert.equal(result.meta.policy.excludedNonQqqNegativeWithoutSales, 1);
    assert.equal(result.meta.policy.keptQqqNegative, 1);
    assert.equal(result.meta.policy.keptNonQqqNegativeWithSales, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 추가 회귀 방지 항목 (사용자 요청): ECOUNT 다중 사이즈 합산 / Cafe24 variant 합산 /
// 음수 재고 flag / QQQ·CON flag / dry-run 무파일 생성 / 원본 JSON 무변경
// ---------------------------------------------------------------------------
test("ECOUNT 다중 사이즈 합산: S/M/L PROD_CD의 stockQuantity를 합산한다", () => {
  const entry = makeEntry({
    ecount: {
      matchedProducts: [
        { prodCd: "TST251OT00101", productName: "T", size: "S" },
        { prodCd: "TST251OT00102", productName: "T", size: "M" },
        { prodCd: "TST251OT00103", productName: "T", size: "L" }
      ]
    }
  });
  const ecountMap = makeEcountMap([
    { productCode: "TST251OT00101", stockQuantity: 2 },
    { productCode: "TST251OT00102", stockQuantity: 3 },
    { productCode: "TST251OT00103", stockQuantity: 1 }
  ]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 6 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.ecount.ecountStockQuantity, 6);
  assert.ok(result.flags.includes("multiple_ecount_sizes"));
});

test("Cafe24 variant 합산: 여러 옵션이 있어도 기존에 계산된 inventoryQuantity를 그대로 신뢰한다", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 7 }]);
  const cafe24 = makeCafe24Source([
    { productNo: 1001, options: [{ quantity: 3 }, { quantity: 4 }], inventoryQuantity: 7 }
  ]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.equal(result.cafe24.cafe24VariantCount, 2);
  assert.equal(result.cafe24.cafe24InventoryQuantity, 7);
  assert.ok(result.flags.includes("multiple_cafe24_variants"));
});

test("음수 재고 flag: ECOUNT stockQuantity가 음수면 negative_ecount_stock", () => {
  const entry = makeEntry();
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: -2 }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 3 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.ok(result.flags.includes("negative_ecount_stock"));
});

test("QQQ flag: PROD_CD가 QQQ로 시작하면 qqq_product", () => {
  const entry = makeEntry({ ecount: { matchedProducts: [{ prodCd: "QQQ00777", productName: "Some Item" }] } });
  const ecountMap = makeEcountMap([{ productCode: "QQQ00777", stockQuantity: 5 }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 5 }]);
  const result = compareEntry(entry, ecountMap, cafe24);
  assert.ok(result.flags.includes("qqq_product"));
});

test("CON 위탁 flag: consignment=true 또는 상품명 CON- 표기 모두 consignment_product를 표시한다", () => {
  const entryFlag = makeEntry({ ecount: { matchedProducts: [{ prodCd: "TST251OT00100", productName: "Test", consignment: true }] } });
  const entryName = makeEntry({ ecount: { matchedProducts: [{ prodCd: "TST251OT00100", productName: "CON - Brand Item", consignment: false }] } });
  const ecountMap = makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 5 }]);
  const cafe24 = makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 5 }]);
  assert.ok(compareEntry(entryFlag, ecountMap, cafe24).flags.includes("consignment_product"));
  assert.ok(compareEntry(entryName, ecountMap, cafe24).flags.includes("consignment_product"));
  assert.equal(isConsignmentProductName("CON-BRAND ITEM"), true);
  assert.equal(isConsignmentProductName("REGULAR ITEM"), false);
});

test("dry-run: --dry-run은 출력 파일을 생성하지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-recon-dryrun-"));
  try {
    const registryPath = join(dir, "registry.json");
    const ecountPath = join(dir, "ecount.json");
    const cafe24Path = join(dir, "cafe24.json");
    const outputPath = join(dir, "output.json");
    await writeFile(registryPath, JSON.stringify({ entries: [makeEntry()] }));
    await writeFile(ecountPath, JSON.stringify([{ productCode: "TST251OT00100", stockQuantity: 5 }]));
    await writeFile(cafe24Path, JSON.stringify({ products: [{ productNo: 1001, options: [], inventoryQuantity: 5 }] }));

    execFileSync("node", [
      scriptPath,
      `--registry=${registryPath}`,
      `--ecount=${ecountPath}`,
      `--cafe24=${cafe24Path}`,
      `--output=${outputPath}`,
      "--dry-run"
    ]);

    assert.equal(existsSync(outputPath), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("원본 JSON 무변경: 진단 실행 후 Registry/ECOUNT/Cafe24 fixture 내용이 그대로 보존된다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-recon-immutable-"));
  try {
    const registryPath = join(dir, "registry.json");
    const ecountPath = join(dir, "ecount.json");
    const cafe24Path = join(dir, "cafe24.json");
    const outputPath = join(dir, "output.json");

    const registryContent = JSON.stringify({ entries: [makeEntry()] });
    const ecountContent = JSON.stringify([{ productCode: "TST251OT00100", stockQuantity: 5 }]);
    const cafe24Content = JSON.stringify({ products: [{ productNo: 1001, options: [], inventoryQuantity: 5 }] });

    await writeFile(registryPath, registryContent);
    await writeFile(ecountPath, ecountContent);
    await writeFile(cafe24Path, cafe24Content);

    execFileSync("node", [
      scriptPath,
      `--registry=${registryPath}`,
      `--ecount=${ecountPath}`,
      `--cafe24=${cafe24Path}`,
      `--output=${outputPath}`
    ]);

    assert.equal(readFileSync(registryPath, "utf8"), registryContent);
    assert.equal(readFileSync(ecountPath, "utf8"), ecountContent);
    assert.equal(readFileSync(cafe24Path, "utf8"), cafe24Content);

    const leftoverTmp = (await readdir(dir)).filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftoverTmp, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 2B(Inventory Health Dashboard) 준비 과정에서 tests/diagnose-inventory-
// reconciliation.test.mjs(임시로 만들었던 중복 테스트 폴더)에만 있던 고유 케이스를
// 이 파일로 이전한 것. 프로젝트 실제 관례는 test/(단수)이므로 tests/(복수) 폴더는
// 이 이전 작업 이후 제거한다(section 15 지시사항).
// ---------------------------------------------------------------------------

test("재실행 안전성(구 tests/ 고유 케이스): 두 번 실행해도 output이 안전하게 교체되고 tmp 파일이 남지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-recon-rerun-"));
  try {
    const registryPath = join(dir, "registry.json");
    const ecountPath = join(dir, "ecount.json");
    const cafe24Path = join(dir, "cafe24.json");
    const outputPath = join(dir, "output.json");
    await writeFile(registryPath, JSON.stringify({ entries: [makeEntry()] }));
    await writeFile(ecountPath, JSON.stringify([{ productCode: "TST251OT00100", stockQuantity: 5 }]));
    await writeFile(cafe24Path, JSON.stringify({ products: [{ productNo: 1001, options: [], inventoryQuantity: 5 }] }));

    const args = [scriptPath, `--registry=${registryPath}`, `--ecount=${ecountPath}`, `--cafe24=${cafe24Path}`, `--output=${outputPath}`];
    execFileSync("node", args);
    const first = JSON.parse(readFileSync(outputPath, "utf8"));
    execFileSync("node", args);
    const second = JSON.parse(readFileSync(outputPath, "utf8"));

    assert.equal(second.items.length, first.items.length);
    const leftoverTmp = (await readdir(dir)).filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftoverTmp, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isTrustedEntry(구 tests/ 고유 케이스): verified/status/confidence 세 조건 중 하나만 만족해도 true", () => {
  assert.equal(isTrustedEntry({ verified: true }), true);
  assert.equal(isTrustedEntry({ status: "confirmed" }), true);
  assert.equal(isTrustedEntry({ confidence: 100, ecount: { matchedProducts: [{ prodCd: "X" }] } }), true);
  assert.equal(isTrustedEntry({ confidence: 100, ecount: { matchedProducts: [] } }), false);
  assert.equal(isTrustedEntry({ status: "ambiguous", confidence: 78 }), false);
});

test("loadRegistry(구 tests/ 고유 케이스): entries가 배열이 아니면 실패를 반환한다", () => {
  const result = loadRegistry({ data: { notEntries: [] } });
  assert.equal(result.ok, false);
});

test("loadEcountSource(구 tests/ 고유 케이스): 배열이 아니면 실패를 반환한다", () => {
  const result = loadEcountSource({ data: { not: "an array" } });
  assert.equal(result.ok, false);
});

test("monthWindow(구 tests/ 고유 케이스): 해당 월의 since=1일, until=말일을 반환한다", () => {
  const w = monthWindow(new Date(Date.UTC(2026, 6, 21)));
  assert.deepEqual(w, { since: "2026-07-01", until: "2026-07-31" });
});

test("isPlausibleYear(구 tests/ 고유 케이스): 기준연도 -3~+1년 범위만 통과, 2099년 같은 합성 데이터 제외", () => {
  assert.equal(isPlausibleYear("2026-07-01", 2026), true);
  assert.equal(isPlausibleYear("2099-01-01", 2026), false);
  assert.equal(isPlausibleYear("2020-01-01", 2026), false);
});

test("selectCafe24Source(구 tests/ 고유 케이스): 명시적 --cafe24 경로가 최우선(explicit)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-recon-source-explicit-"));
  try {
    const explicitPath = join(dir, "explicit-cafe24.json");
    await writeFile(explicitPath, JSON.stringify({ products: [{ productNo: 1, options: [], inventoryQuantity: 1 }] }));
    const result = await selectCafe24Source(explicitPath, { scanDir: dir });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "explicit");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selectCafe24Source(구 tests/ 고유 케이스): 이번 달 창과 정확히 일치하는 캐시를 우선 선택한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-recon-source-current-month-"));
  try {
    const now = new Date(Date.UTC(2026, 6, 21));
    await writeFile(
      join(dir, "product-dashboard-proxy-2026-07-01_2026-07-31.json"),
      JSON.stringify({ catalogSyncedAt: "2026-07-19T00:00:00.000Z", products: [{ productNo: 1, options: [], inventoryQuantity: 1 }] })
    );
    await writeFile(
      join(dir, "product-dashboard-proxy-2025-01-01_2025-12-31.json"),
      JSON.stringify({ catalogSyncedAt: "2026-07-20T00:00:00.000Z", products: [{ productNo: 2, options: [], inventoryQuantity: 2 }] })
    );
    const result = await selectCafe24Source(null, { scanDir: dir, catalogPath: join(dir, "nonexistent-catalog.json"), now });
    assert.equal(result.ok, true);
    assert.equal(result.selectionRule, "current_month_window_exact_match");
    assert.equal(result.primary.file, "product-dashboard-proxy-2026-07-01_2026-07-31.json");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selectCafe24Source(구 tests/ 고유 케이스): 이번 달 파일이 없으면 catalogSyncedAt 최신 파일로 fallback한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-recon-source-fallback-"));
  try {
    const now = new Date(Date.UTC(2026, 6, 21));
    await writeFile(
      join(dir, "product-dashboard-proxy-2026-04-01_2026-05-31.json"),
      JSON.stringify({ catalogSyncedAt: "2026-07-18T00:00:00.000Z", products: [{ productNo: 1, options: [], inventoryQuantity: 1 }] })
    );
    await writeFile(
      join(dir, "product-dashboard-proxy-2026-01-01_2026-02-28.json"),
      JSON.stringify({ catalogSyncedAt: "2026-07-19T00:00:00.000Z", products: [{ productNo: 2, options: [], inventoryQuantity: 2 }] })
    );
    const result = await selectCafe24Source(null, { scanDir: dir, catalogPath: join(dir, "nonexistent-catalog.json"), now });
    assert.equal(result.ok, true);
    assert.equal(result.selectionRule, "max_catalogSyncedAt_fallback");
    assert.equal(result.primary.file, "product-dashboard-proxy-2026-01-01_2026-02-28.json");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selectCafe24Source(구 tests/ 고유 케이스): 2099년 등 합성 연도 파일은 제외되고 excludedSyntheticFiles에 기록된다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inv-recon-source-synthetic-"));
  try {
    const now = new Date(Date.UTC(2026, 6, 21));
    await writeFile(
      join(dir, "product-dashboard-proxy-2099-01-01_2099-01-31.json"),
      JSON.stringify({ catalogSyncedAt: "2026-07-20T00:00:00.000Z", products: [{ productNo: 1, options: [], inventoryQuantity: 1 }] })
    );
    await writeFile(
      join(dir, "product-dashboard-proxy-2026-04-01_2026-05-31.json"),
      JSON.stringify({ catalogSyncedAt: "2026-07-18T00:00:00.000Z", products: [{ productNo: 2, options: [], inventoryQuantity: 2 }] })
    );
    const result = await selectCafe24Source(null, { scanDir: dir, catalogPath: join(dir, "nonexistent-catalog.json"), now });
    assert.equal(result.ok, true);
    assert.equal(result.excludedSyntheticFiles.length, 1);
    assert.equal(result.excludedSyntheticFiles[0].file, "product-dashboard-proxy-2099-01-01_2099-01-31.json");
    assert.equal(result.primary.file, "product-dashboard-proxy-2026-04-01_2026-05-31.json");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("정책: QQQ -1은 판매전표가 없어도 포함된다", () => {
  const ecount = makeEcountMap([{ productCode: "QQQ001", productName: "QQQ / Sample", stockQuantity: -1 }]);
  const result = buildNegativeStockCandidates(ecount, [], makeCafe24Source([]));
  assert.equal(result.candidates.length, 1);
  assert.ok(result.candidates[0].flags.includes("qqq_product"));
});

test("정책: 일반 -1은 판매전표가 없으면 제외된다", () => {
  const entry = makeEntry({ ecount: { matchedProducts: [{ prodCd: "GEN001", productName: "GEN / Sample" }] } });
  const ecount = makeEcountMap([{ productCode: "GEN001", productName: "GEN / Sample", stockQuantity: -1 }]);
  const result = buildNegativeStockCandidates(ecount, [entry], makeCafe24Source([{ productNo: 1001, inventoryQuantity: 0, quantitySold: 0, orderCount: 0, salesAmount: 0 }]));
  assert.equal(result.candidates.length, 0);
  assert.equal(result.stats.excludedNonQqqNegativeWithoutSales, 1);
});

test("정책: 일반 -1은 판매전표가 있으면 포함된다", () => {
  const entry = makeEntry({ ecount: { matchedProducts: [{ prodCd: "GEN001", productName: "GEN / Sample" }] } });
  const ecount = makeEcountMap([{ productCode: "GEN001", productName: "GEN / Sample", stockQuantity: -1 }]);
  const result = buildNegativeStockCandidates(ecount, [entry], makeCafe24Source([{ productNo: 1001, inventoryQuantity: 0, quantitySold: 1, orderCount: 1, salesAmount: 1000 }]));
  assert.equal(result.candidates.length, 1);
  assert.ok(result.candidates[0].flags.includes("sales_voucher_found"));
});

test("정책: 일반 0 이상은 negative stock 후보가 아니다", () => {
  const ecount = makeEcountMap([{ productCode: "GEN001", productName: "GEN / Sample", stockQuantity: 0 }]);
  const result = buildNegativeStockCandidates(ecount, [], makeCafe24Source([]));
  assert.equal(result.candidates.length, 0);
});

test("브랜드 정규화: AAH MIDNIGHT 계열은 AAH MIDNIGHT CLUB 한 그룹이다", () => {
  assert.equal(normalizeBrandName("AAH MIDNIGHT"), "AAH MIDNIGHT CLUB");
  assert.equal(normalizeBrandName("aah midnight club"), "AAH MIDNIGHT CLUB");
});

test("브랜드 정규화: 대소문자만 다른 브랜드는 한 그룹이다", () => {
  assert.equal(normalizeBrandName("goomheo"), normalizeBrandName("GOOMHEO"));
});

test("브랜드 정규화: 제품명 전체나 SKU 전체는 브랜드 fallback으로 쓰지 않는다", () => {
  assert.equal(brandFromEcountProductName("ONLYPRODUCTNAME"), null);
  assert.equal(brandFromEcountProductName("QQQ001"), null);
});

test("정책: 단순 Cafe24/ECOUNT 수량 차이만으로 후보 생성하지 않는다", () => {
  const item = compareEntry(makeEntry(), makeEcountMap([{ productCode: "TST251OT00100", stockQuantity: 10 }]), makeCafe24Source([{ productNo: 1001, options: [], inventoryQuantity: 1 }]));
  assert.equal(item.status, "mismatch");
  assert.equal(isActionCandidate(item), false);
});

console.log("inventory reconciliation tests passed");
