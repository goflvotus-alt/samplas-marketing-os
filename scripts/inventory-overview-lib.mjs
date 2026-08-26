// SAMPLAS Inventory Overview — Phase 3A / Phase 3A-2
//
// 운영 정책: ECOUNT stockQuantity가 유일한 재고 기준(Source of Truth)이다.
// Cafe24 inventoryQuantity는 이 계산에 전혀 사용하지 않는다(정책 명시 금지 사항).
//
// Phase 3A-2 교정 사항 (SAMPLAS 실제 운영 방식 반영):
// - SAMPLAS는 상시 재입고형 매장이 아니라 시즌 상품 위주 매장이다. stockQuantity==0을
//   "품절 오류"로 취급하지 않고 "재고 소진 / 완판 후보"라는 중립적 상태로 취급한다.
//   (누적 입고량을 아직 확인할 수 없으므로 확정 "완판"이라 단정하지 않는다.)
// - Low Stock(재고 1~3개)을 "발주 필요" 신호로 취급하지 않는다. 핵심 KPI에서 제거하고
//   lowStockCandidate라는 보조 플래그로만 남겨둔다.
// - QQQ productCode 상품을 더 이상 집계에서 제외하지 않는다. QQQ는 미등록 외부 판매/임시
//   상품 성격이라 음수 재고가 오류가 아니라 "추정 판매수량" 신호일 수 있다
//   (estimatedSoldQuantity = abs(min(stockQuantity, 0))). QQQ 음수는 일반 상품의
//   negative_review(음수 확인 필요) KPI와 절대 같은 그룹에 넣지 않는다.
// - stockQuantity === null은 0과 다르다. "재고 미수신"이며 재고 소진/품절/Low Stock 계산에서
//   제외한다.
// - 위치(매장/3PL)별 재고는 현재 ECOUNT 응답에 존재하지 않는다(투자 조사 결과, 아래 참고).
//   따라서 이번 단계에서는 위치 수량을 임의로 만들지 않고 항상 null + "unavailable"로 둔다.
//
// 조사 결과 요약 (work/ecount-inventory/raw-products.json, raw-inventory.json 실측):
// - GetBasicProductsList(품목조회) 응답에 WH_CD(창고코드) 필드가 존재하지만 10,000건 전부
//   빈 문자열("")이다 — 이 ECOUNT 계정은 상품 마스터 단계에서 창고를 지정하지 않는다.
// - GetListInventoryBalanceStatus(재고조회) 응답은 { PROD_CD, BAL_QTY } 두 필드뿐이며,
//   PROD_CD당 정확히 1행만 존재한다(3,209개 distinct PROD_CD == 3,209 rows, 중복 없음).
//   즉 이 API가 이미 창고 구분 없이 회사 전체 합계로 응답하고 있다.
// - 이 데이터만으로는 매장 재고와 3PL 재고를 구분할 방법이 없다. 구분하려면 ECOUNT의
//   창고별 재고조회(WH_CD 파라미터 지정) 또는 창고 마스터 목록을 추가로 확인해야 한다.
//
// 이 파일은 순수 계산 로직만 담는다(파일 I/O나 HTTP 서버 기동 없음).
// intelligence-service.mjs가 이 모듈을 import해서 API 응답을 만든다.
// 기존 diagnose-inventory-reconciliation.mjs / diagnose-cafe24-ecount-product-matching.mjs는
// 이번 Phase에서 전혀 수정하지 않았다(그 파일들의 ECOUNT 진단 로직은 그대로 유지).

const DEFAULT_LOW_STOCK_THRESHOLD = 3;
const DEFAULT_RECENT_SALES_WINDOW_DAYS = 30;

// 내부 위치 코드(고정) ↔ 사용자 표시명(교체 가능) 분리.
// 향후 제2매장이 생기면 STORE_2 키만 추가하고 표시명 매핑만 바꾸면 된다.
// OFFSITE라는 단어 자체는 영구 창고명이 아니라 내부 코드일 뿐이며, 표시명은 "3PL"이다.
export const LOCATION_CODES = ["STORE_1", "OFFSITE", "UNKNOWN"];
export const LOCATION_DISPLAY_NAMES = {
  STORE_1: "현 매장",
  OFFSITE: "3PL",
  UNKNOWN: "확인 불가"
};

// productCode가 QQQ로 시작하는 행은 정상 ECOUNT 상품명 규칙("브랜드 / 상품명")을 따르지 않고
// "[브랜드 : 한글명] 상품명 / 가격" 같은 혼재된 형식을 쓰거나 미등록 외부 판매/임시 성격의
// 행이다. Phase 3A에서는 이 규칙을 diagnose-cafe24-ecount-product-matching.mjs와 동일하게
// "자동 브랜드 매칭에서 제외"로만 썼지만, Phase 3A-2부터는 Inventory Overview 집계 자체에서는
// 제외하지 않는다(그 진단 스크립트 자체는 여전히 수정하지 않는다 — 그 스크립트의 판단은 그대로 유효).
export function isQqqProductCode(productCode) {
  return /^QQQ/i.test(String(productCode ?? "").trim());
}

// ECOUNT productName은 관례적으로 "브랜드 / 상품명" 형태다.
// 다만 실제 데이터에는 슬래시 앞에 공백이 없는 경우도 있어("MIDNIGHT/ Flow Flared Jeans"),
// 슬래시 뒤 공백만 필수로 요구하는 완화된 정규식을 사용한다.
export function splitEcountBrandProduct(productName) {
  const raw = String(productName ?? "").trim();
  const parts = raw.split(/\s*\/\s+/);
  const hasBrand = parts.length > 1 && parts[0].trim().length > 0;
  const brandRaw = hasBrand ? parts[0].trim() : "";
  const nameRaw = hasBrand ? parts.slice(1).join(" / ").trim() : raw;
  return { raw, brandRaw, nameRaw };
}

// QQQ 상품명은 표준 "브랜드 / 상품명" 형식을 따르지 않는 경우가 많다(예:
// "[604SERVICE : 604서비스] EMBROIDERED LEATHER JACKET IN CHARCOAL / 420,000").
// 대괄호 표기와 끝에 붙는 가격 접미사를 우선 처리하고, 그래도 실패하면 원문을 그대로 보존한다
// (불확실한 상황에서 억지로 브랜드를 만들어내지 않는다).
export function parseQqqBrandProduct(productName) {
  const raw = String(productName ?? "").trim();

  const bracketMatch = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracketMatch) {
    const bracketBrand = bracketMatch[1].split(":")[0].trim();
    const rest = bracketMatch[2].trim().replace(/\s*\/\s*[\d,]+\s*$/, "").trim();
    return { raw, brandRaw: bracketBrand, nameRaw: rest || bracketMatch[2].trim() || raw, parseConfidence: "bracket" };
  }

  const standard = splitEcountBrandProduct(raw);
  if (standard.brandRaw) {
    const nameRaw = standard.nameRaw.replace(/\s*\/\s*[\d,]+\s*$/, "").trim();
    return { raw, brandRaw: standard.brandRaw, nameRaw: nameRaw || standard.nameRaw, parseConfidence: "slash" };
  }

  return { raw, brandRaw: "", nameRaw: raw, parseConfidence: "raw" };
}

function normalizeBrandName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

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

// brandRegistry = { brands: [{id, name, active}], aliases: [{alias, brandId}] }
// (work/intelligence/brand-master-list.json + brand-aliases.json 그대로, 읽기 전용으로만 사용)
export function resolveEcountBrand(brandRaw, brandRegistry) {
  const key = normalizeBrandKey(brandRaw);
  if (!key) return null;
  const brands = brandRegistry?.brands || [];
  const aliases = brandRegistry?.aliases || [];
  const byName = new Map(brands.map((brand) => [normalizeBrandKey(brand.name), brand]));
  const direct = byName.get(key);
  if (direct) return { brandId: direct.id, name: direct.name, source: "registry_name" };
  const byId = new Map(brands.map((brand) => [normalizeBrandKey(brand.id), brand]));
  const idMatch = byId.get(key);
  if (idMatch) return { brandId: idMatch.id, name: idMatch.name, source: "registry_id" };
  const alias = aliases.find((entry) => normalizeBrandKey(entry.alias) === key);
  if (alias) {
    const brand = brands.find((item) => item.id === alias.brandId);
    if (brand) return { brandId: brand.id, name: brand.name, source: "registry_alias" };
  }
  return null;
}

// 이 함수 결과가 "브랜드별 재고"의 그룹 키가 된다.
// 캐노니컬 레지스트리에서 못 찾으면(ECOUNT 쪽 영문 표기가 등록되어 있지 않은 경우),
// 정보 손실 없이 ECOUNT 원문 브랜드명을 그대로 그룹 키로 사용한다(추측으로 새 별칭을 만들지 않음).
export function resolveDisplayBrand(brandRaw, brandRegistry) {
  const resolved = resolveEcountBrand(brandRaw, brandRegistry);
  if (resolved) return { key: resolved.brandId, name: resolved.name, canonical: true };
  const raw = normalizeBrandName(brandRaw) || "미분류";
  return { key: `raw:${normalizeBrandKey(raw)}`, name: raw, canonical: false };
}

// ---------------------------------------------------------------------------
// 재고 상태 분류 (Phase 3A-2)
//
// 일반 상품/관리코드: in_stock / depleted_candidate / negative_review / unknown
// QQQ 상품:            qqq_remaining / qqq_depleted_record / qqq_estimated_sale / qqq_unknown
// 두 그룹의 상태값은 절대 서로 섞이지 않는다(같은 KPI에 합산하지 않는다).
// ---------------------------------------------------------------------------

export function classifyGeneralStock(stockQuantity) {
  if (stockQuantity === null || stockQuantity === undefined || !Number.isFinite(stockQuantity)) return "unknown";
  if (stockQuantity < 0) return "negative_review";
  if (stockQuantity === 0) return "depleted_candidate";
  return "in_stock";
}

export function classifyQqqStock(stockQuantity) {
  if (stockQuantity === null || stockQuantity === undefined || !Number.isFinite(stockQuantity)) return "qqq_unknown";
  if (stockQuantity < 0) return "qqq_estimated_sale";
  if (stockQuantity === 0) return "qqq_depleted_record";
  return "qqq_remaining";
}

// QQQ의 음수 재고는 "추정 판매수량" 신호다. 0을 판매 1개로 임의 취급하지 않는다.
export function estimatedQqqSoldQuantity(stockQuantity) {
  if (stockQuantity === null || stockQuantity === undefined || !Number.isFinite(stockQuantity)) return null;
  return Math.abs(Math.min(stockQuantity, 0));
}

// Low Stock은 더 이상 핵심 KPI/상태값이 아니라 in_stock 위에 얹는 보조 플래그다.
// 재고 1~3개라고 자동으로 발주가 필요하다는 신호로 쓰지 않는다.
export function isLowStockCandidate(status, stockQuantity, lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD) {
  return status === "in_stock" && Number.isFinite(stockQuantity) && stockQuantity > 0 && stockQuantity <= lowStockThreshold;
}

// 위치별 재고 모델. 현재 ECOUNT 응답에는 위치(창고) 정보가 전혀 없으므로(조사 결과 상단 참고),
// 항상 STORE_1/OFFSITE 모두 null + locationCoverageStatus "unavailable"을 반환한다.
// 0으로 임의 채우지 않는다 — null(확인 불가)과 0(재고 없음 확인됨)은 다른 의미다.
// 향후 위치 데이터 소스가 생기면 이 함수만 교체하면 된다(호출부는 변경 불필요).
export function buildLocationInfo() {
  return {
    locations: { STORE_1: null, OFFSITE: null, UNKNOWN: null },
    locationCoverageStatus: "unavailable"
  };
}

function salesLineKey(row) {
  return `${String(row.productName ?? "").trim()}|${String(row.specification ?? "").trim()}`;
}

// monthlyFiles = [{ month, rows: [...] }] (work/ecount-sales/*.json 그대로)
// isOfflineRevenue === false 인 라인(예: "택배" 출고/이동)은 실제 판매가 아니므로 제외한다.
// isOfflineRevenue === true 라인은 quantity가 음수(반품)여도 포함해 순 판매수량을 계산한다.
export function buildOfflineSalesIndex(monthlyFiles) {
  const index = new Map();
  let latestDataDate = null;
  for (const file of monthlyFiles) {
    for (const row of file.rows || []) {
      if (!row.isOfflineRevenue) continue;
      const key = salesLineKey(row);
      if (!key.trim()) continue;
      const date = String(row.date || "");
      if (date && (!latestDataDate || date > latestDataDate)) latestDataDate = date;
      const entry = index.get(key) || { totalQty: 0, lastSaleDate: null, recentQty: 0, lines: [] };
      entry.totalQty += Number(row.quantity || 0);
      if (date && (!entry.lastSaleDate || date > entry.lastSaleDate)) entry.lastSaleDate = date;
      entry.lines.push({ date, quantity: Number(row.quantity || 0) });
      index.set(key, entry);
    }
  }
  if (latestDataDate) {
    const cutoff = addDays(latestDataDate, -DEFAULT_RECENT_SALES_WINDOW_DAYS);
    for (const entry of index.values()) {
      entry.recentQty = entry.lines
        .filter((line) => line.date && line.date >= cutoff)
        .reduce((sum, line) => sum + line.quantity, 0);
      delete entry.lines;
    }
  }
  return { index, latestDataDate };
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function lookupOfflineSales(salesIndex, productName, specification) {
  const key = `${String(productName ?? "").trim()}|${String(specification ?? "").trim()}`;
  const entry = salesIndex?.index?.get(key);
  if (!entry) return { recentQty: 0, lastSaleDate: null };
  return { recentQty: entry.recentQty, lastSaleDate: entry.lastSaleDate };
}

// registryProdCds: Set<string> — Product Registry(work/product-registry.json) entries의
// ecount.matchedProducts[].prodCd 전체(확정 17건 + 검토중 160건 모두 포함)를 모은 집합.
// "Registry 연결 여부"는 verified 여부와 무관하게, Registry가 이 ECOUNT 코드를 인지하고 있는지만 본다.
//
// productType 분류:
// - "qqq": productCode가 QQQ로 시작(미등록 외부 판매/임시 상품)
// - "admin_code": 정상 "브랜드 / 상품명" 형식이 아닌 관리용 행(할인/퀵비 등, 슬래시 없음)
// - "general": 그 외 정상 브랜드 상품
export function buildInventoryOverview({ ecountRows, brandRegistry, salesIndex, registryProdCds, lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD }) {
  const items = [];

  for (const row of ecountRows) {
    const prodCd = String(row.productCode || "").trim();
    const isQqq = isQqqProductCode(row.productCode);
    const stockQuantity = Number.isFinite(row.stockQuantity) ? row.stockQuantity : null;
    const sales = lookupOfflineSales(salesIndex, row.productName, row.specification);
    const location = buildLocationInfo(row);

    let productType;
    let brandRaw;
    let nameRaw;
    let parseConfidence = "slash";
    if (isQqq) {
      productType = "qqq";
      const parsed = parseQqqBrandProduct(row.productName);
      brandRaw = parsed.brandRaw;
      nameRaw = parsed.nameRaw;
      parseConfidence = parsed.parseConfidence;
    } else {
      const split = splitEcountBrandProduct(row.productName);
      brandRaw = split.brandRaw;
      nameRaw = split.nameRaw;
      productType = brandRaw ? "general" : "admin_code";
      parseConfidence = brandRaw ? "slash" : "raw";
    }

    const brand = resolveDisplayBrand(brandRaw || nameRaw || row.productName, brandRegistry);
    const status = isQqq ? classifyQqqStock(stockQuantity) : classifyGeneralStock(stockQuantity);
    const estimatedSoldQuantity = isQqq ? estimatedQqqSoldQuantity(stockQuantity) : null;
    const lowStockCandidate = !isQqq && isLowStockCandidate(status, stockQuantity, lowStockThreshold);
    const salesPrice = Number.isFinite(row.salesPrice) ? row.salesPrice : null;

    // Inventory Operations MVP(2026-08-26) — 재고금액은 "판매가 기준 재고자산"만 계산한다.
    // purchasePrice(매입가)는 이번 감사에서 신뢰도가 완전히 검증되지 않아(41%가 판매가와
    // 동일 — placeholder 가능성, docs/reports/inventory-intelligence-v2-preaudit-2026-08-26.md
    // §E "Margin" 참고) margin/profit 계열 계산에는 절대 쓰지 않는다(Cost Hard Gate).
    // 음수 재고는 값에 포함하지 않는다(양수 재고만) — status==='in_stock'일 때만 계산.
    const retailValue = status === "in_stock" && salesPrice !== null ? stockQuantity * salesPrice : null;
    // slowWatch: 재고는 있는데(known, positive) 최근 판매 window(30일, 오프라인만) 안에
    // 판매가 전혀 없었던 SKU. "DEAD STOCK"이라는 단정적 표현은 쓰지 않는다(입고일/재고
    // age가 없어 얼마나 오래 안 팔렸는지는 알 수 없음).
    const slowWatch = status === "in_stock" && (sales.recentQty || 0) === 0;
    // daysOfSupply: 판매 이력이 실제로 있는 SKU에서만 계산(분모 0 → Infinity를 절대
    // 노출하지 않는다). 판매가 없으면 N/A(null)로 남긴다.
    const daysOfSupply = status === "in_stock" && (sales.recentQty || 0) > 0
      ? stockQuantity / (sales.recentQty / DEFAULT_RECENT_SALES_WINDOW_DAYS)
      : null;

    items.push({
      brandKey: brand.key,
      brandName: brand.name,
      brandCanonical: brand.canonical,
      brandRaw,
      parseConfidence,
      productName: nameRaw,
      rawProductName: row.productName,
      specification: row.specification ?? null,
      prodCd,
      productType,
      barcode: row.barcode ?? null,
      stockQuantity,
      status,
      lowStockCandidate,
      estimatedSoldQuantity,
      locations: location.locations,
      locationCoverageStatus: location.locationCoverageStatus,
      purchasePrice: Number.isFinite(row.purchasePrice) ? row.purchasePrice : null,
      salesPrice,
      recentSalesQty: sales.recentQty,
      lastSaleDate: sales.lastSaleDate,
      registryLinked: registryProdCds ? registryProdCds.has(prodCd) : false,
      retailValue,
      slowWatch,
      daysOfSupply
    });
  }

  const summary = {
    // 일반 상품/관리코드 KPI (QQQ와 절대 합산하지 않음)
    totalKnownStock: 0,
    inStockSkuCount: 0,
    depletedSkuCount: 0,
    negativeReviewSkuCount: 0,
    unknownStockSkuCount: 0,
    lowStockCandidateCount: 0,
    // QQQ 전용 KPI
    qqqEstimatedSoldQuantity: 0,
    qqqEstimatedSoldSkuCount: 0,
    qqqDepletedRecordSkuCount: 0,
    qqqRemainingSkuCount: 0,
    qqqUnknownSkuCount: 0,
    // 유형별 총 SKU 수
    totalSkuCount: items.length,
    generalSkuCount: 0,
    adminCodeSkuCount: 0,
    qqqSkuCount: 0,
    // 위치 커버리지(현재는 항상 0/전체 unavailable — 미래 대비용 필드)
    locationKnownItems: 0,
    locationUnknownItems: 0
  };

  for (const item of items) {
    if (item.productType === "qqq") summary.qqqSkuCount += 1;
    else if (item.productType === "admin_code") summary.adminCodeSkuCount += 1;
    else summary.generalSkuCount += 1;

    if (item.locationCoverageStatus === "unavailable") summary.locationUnknownItems += 1;
    else summary.locationKnownItems += 1;

    if (item.productType === "qqq") {
      if (item.status === "qqq_estimated_sale") {
        summary.qqqEstimatedSoldSkuCount += 1;
        summary.qqqEstimatedSoldQuantity += item.estimatedSoldQuantity || 0;
      } else if (item.status === "qqq_depleted_record") {
        summary.qqqDepletedRecordSkuCount += 1;
      } else if (item.status === "qqq_remaining") {
        summary.qqqRemainingSkuCount += 1;
      } else if (item.status === "qqq_unknown") {
        summary.qqqUnknownSkuCount += 1;
      }
      continue;
    }

    if (item.lowStockCandidate) summary.lowStockCandidateCount += 1;
    if (item.status === "unknown") { summary.unknownStockSkuCount += 1; continue; }
    if (item.status === "in_stock") {
      summary.inStockSkuCount += 1;
      summary.totalKnownStock += item.stockQuantity;
    } else if (item.status === "depleted_candidate") {
      summary.depletedSkuCount += 1;
    } else if (item.status === "negative_review") {
      summary.negativeReviewSkuCount += 1;
    }
  }

  const brandMap = new Map();
  for (const item of items) {
    if (!brandMap.has(item.brandKey)) {
      brandMap.set(item.brandKey, {
        brandKey: item.brandKey,
        brandName: item.brandName,
        brandCanonical: item.brandCanonical,
        totalSku: 0,
        knownStock: 0,
        depletedCount: 0,
        negativeReviewCount: 0,
        negativeUnits: 0,
        lowStockCandidateCount: 0,
        qqqEstimatedSoldQuantity: 0,
        qqqSkuCount: 0,
        recentSalesQty: 0,
        slowWatchCount: 0,
        retailValue: 0
      });
    }
    const bucket = brandMap.get(item.brandKey);
    bucket.totalSku += 1;
    bucket.recentSalesQty += item.recentSalesQty || 0;
    bucket.retailValue += item.retailValue || 0;
    if (item.slowWatch) bucket.slowWatchCount += 1;
    if (item.productType === "qqq") {
      bucket.qqqSkuCount += 1;
      bucket.qqqEstimatedSoldQuantity += item.estimatedSoldQuantity || 0;
      continue;
    }
    if (item.lowStockCandidate) bucket.lowStockCandidateCount += 1;
    if (item.status === "in_stock") bucket.knownStock += item.stockQuantity;
    else if (item.status === "depleted_candidate") bucket.depletedCount += 1;
    else if (item.status === "negative_review") {
      bucket.negativeReviewCount += 1;
      bucket.negativeUnits += Math.abs(item.stockQuantity);
    }
  }
  const brandRollup = [...brandMap.values()].sort((left, right) => left.brandName.localeCompare(right.brandName, "ko"));

  // ---------------------------------------------------------------------------
  // Inventory Operations MVP(2026-08-26) — coverage-first: 모든 지표 옆에 분모를 명시한다.
  // Cost Hard Gate: purchasePrice 신뢰도가 검증되지 않아 margin/profit 계열은 절대 계산하지
  // 않는다(retailValue만, salesPrice 기준). daysOfSupply는 판매 이력이 있는 SKU에서만
  // 값을 갖고, 없으면 항상 null(N/A) — Infinity를 노출하지 않는다.
  // ---------------------------------------------------------------------------
  const negativeItems = items.filter((item) => item.status === "negative_review");
  const sellingItems = items.filter((item) => item.productType !== "qqq" && (item.recentSalesQty || 0) > 0);
  const slowWatchItems = items.filter((item) => item.slowWatch);
  const valuedItems = items.filter((item) => item.retailValue !== null);
  const missingPriceInStock = items.filter((item) => item.status === "in_stock" && item.salesPrice === null);

  const operations = {
    coverage: {
      totalSkuCount: items.length,
      knownStockSkuCount: summary.inStockSkuCount + summary.depletedSkuCount + summary.negativeReviewSkuCount,
      knownStockPct: items.length ? (summary.inStockSkuCount + summary.depletedSkuCount + summary.negativeReviewSkuCount) / items.length : 0,
      salesWindowDays: DEFAULT_RECENT_SALES_WINDOW_DAYS,
      sellingSkuCount: sellingItems.length,
      sellingSkuPct: items.length ? sellingItems.length / items.length : 0
    },
    negativeInventory: {
      skuCount: negativeItems.length,
      totalNegativeUnits: negativeItems.reduce((sum, item) => sum + Math.abs(item.stockQuantity), 0),
      recentlySellingCount: negativeItems.filter((item) => (item.recentSalesQty || 0) > 0).length,
      topByUnits: [...negativeItems]
        .sort((a, b) => Math.abs(b.stockQuantity) - Math.abs(a.stockQuantity))
        .slice(0, 10)
        .map((item) => ({ prodCd: item.prodCd, productName: item.productName, brandName: item.brandName, stockQuantity: item.stockQuantity }))
    },
    slowWatch: {
      skuCount: slowWatchItems.length,
      pctOfInStock: summary.inStockSkuCount ? slowWatchItems.length / summary.inStockSkuCount : 0
    },
    inventoryValue: {
      label: "retail_inventory_value", // 원가/margin 아님 — 판매가 × 양수 재고수량만
      totalRetailValue: valuedItems.reduce((sum, item) => sum + item.retailValue, 0),
      valuedSkuCount: valuedItems.length,
      missingPriceInStockSkuCount: missingPriceInStock.length,
      negativeStockExcludedUnits: negativeItems.reduce((sum, item) => sum + Math.abs(item.stockQuantity), 0)
    }
  };

  return { items, summary, brandRollup, operations };
}

// view: "all" | "in_stock" | "depleted_candidate" | "negative_review" | "unknown" |
//       "qqq_estimated_sale" | "location_unknown"  (Section 6 필터 목록과 1:1 대응)
export function filterAndSortItems(items, { brand, status, search, sort } = {}) {
  let filtered = items;
  if (brand && brand !== "all") filtered = filtered.filter((item) => item.brandKey === brand);
  if (status && status !== "all") {
    if (status === "location_unknown") filtered = filtered.filter((item) => item.locationCoverageStatus === "unavailable");
    else filtered = filtered.filter((item) => item.status === status);
  }
  if (search) {
    const needle = search.trim().toLowerCase();
    if (needle) {
      filtered = filtered.filter((item) => (
        item.brandName.toLowerCase().includes(needle) ||
        item.productName.toLowerCase().includes(needle) ||
        item.prodCd.toLowerCase().includes(needle) ||
        (item.barcode || "").toLowerCase().includes(needle)
      ));
    }
  }
  // 우선순위: 일반 음수 확인 필요 > 재고 미수신 > QQQ 판매 추정 > 재고 소진 계열 > 재고 있음/QQQ 잔여
  const statusRank = {
    negative_review: 0,
    unknown: 1,
    qqq_estimated_sale: 2,
    depleted_candidate: 3,
    qqq_depleted_record: 3,
    qqq_unknown: 4,
    in_stock: 5,
    qqq_remaining: 5
  };
  const sorted = filtered.slice().sort((a, b) => {
    if (sort === "stock-asc") return (a.stockQuantity ?? Infinity) - (b.stockQuantity ?? Infinity);
    if (sort === "stock-desc") return (b.stockQuantity ?? -Infinity) - (a.stockQuantity ?? -Infinity);
    if (sort === "recent-sales-desc") return (b.recentSalesQty || 0) - (a.recentSalesQty || 0);
    return ((statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)) ||
      a.brandName.localeCompare(b.brandName, "ko") ||
      a.productName.localeCompare(b.productName, "ko");
  });
  return sorted;
}

export const DEFAULTS = { DEFAULT_LOW_STOCK_THRESHOLD, DEFAULT_RECENT_SALES_WINDOW_DAYS };
