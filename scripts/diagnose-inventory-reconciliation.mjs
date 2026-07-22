// SAMPLAS Inventory Intelligence Phase 2A — ECOUNT ↔ Cafe24 재고 정합성 진단
//
// 이 스크립트는 Diagnostic Only다. Canonical Product Registry(work/product-registry.json)에서
// verified === true (Phase 1 정의상 exact_one_to_one, confidence 100, status "confirmed"와 동일 집합)로
// 확정된 상품과 ECOUNT 음수 재고를 대상으로, 실제 조치가 필요한 재고 후보만 만든다.
// Cafe24는 재고 차이 판정용이 아니라 Product Registry 연결과 판매 증거 확인용으로만 사용한다.
//
// 원본 데이터(Product Registry, ECOUNT 캐시, Cafe24 캐시)는 전부 읽기 전용이다. 이 스크립트가
// 쓰는 파일은 --output 경로(기본 work/inventory-intelligence-candidates.json) 하나뿐이다.
//
// 실행:
//   node scripts/diagnose-inventory-reconciliation.mjs
//   node scripts/diagnose-inventory-reconciliation.mjs --dry-run --strict
//   node scripts/diagnose-inventory-reconciliation.mjs --output=work/foo.json --registry=work/product-registry.json
//
// 옵션:
//   --output=<path>    출력 JSON 경로 (기본 work/inventory-intelligence-candidates.json)
//   --registry=<path>  Product Registry 경로 (기본 work/product-registry.json)
//   --ecount=<path>    ECOUNT 재고 스냅샷 경로 (기본 work/ecount-inventory/latest.json)
//   --cafe24=<path>    Cafe24 재고 캐시 경로를 명시적으로 강제 지정 (기본은 자동 선택)
//   --dry-run          파일을 쓰지 않고 콘솔 요약만 출력한다
//   --strict           필수 source가 없거나 필드가 불명확하면 추정하지 않고 즉시 실패한다

import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const workDir = join(root, "work");

const DEFAULT_PATHS = {
  registry: join(workDir, "product-registry.json"),
  ecount: join(workDir, "ecount-inventory", "latest.json"),
  output: join(workDir, "inventory-intelligence-candidates.json"),
  cafe24ProductCatalog: join(workDir, "cafe24-product-catalog.json")
};

const THRESHOLDS = {
  nearMatchAbsoluteUnits: 2,
  nearMatchRate: 0.1
};

const BRAND_ALIASES = new Map([
  ["aah midnight", "AAH MIDNIGHT CLUB"],
  ["aah midnight club", "AAH MIDNIGHT CLUB"]
]);

function compactText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeBrandName(value) {
  const compact = compactText(value);
  if (!compact) return null;
  const key = compact.toLowerCase();
  return BRAND_ALIASES.get(key) || compact.toUpperCase();
}

function brandFromEcountProductName(productName) {
  const text = compactText(productName);
  const bracket = text.match(/^\[([^:\]]+)/);
  if (bracket) return normalizeBrandName(bracket[1]);
  if (!text.includes("/")) return null;
  return normalizeBrandName(text.split("/")[0]);
}

function brandFromCafe24ProductName(productName) {
  const text = compactText(productName);
  const match = text.match(/^\[([^:\]]+)/);
  return match ? normalizeBrandName(match[1]) : null;
}

function resolveBrand(entry, ecountItems = [], cafe24Product = null) {
  const canonical = normalizeBrandName(entry?.brandName);
  if (canonical) return { name: canonical, source: "product_registry" };
  for (const item of ecountItems) {
    const ecountBrand = brandFromEcountProductName(item.productName);
    if (ecountBrand) return { name: ecountBrand, source: "ecount_alias" };
  }
  const cafe24Brand = brandFromCafe24ProductName(cafe24Product?.productName);
  if (cafe24Brand) return { name: cafe24Brand, source: "cafe24_canonical" };
  return { name: "UNKNOWN", source: "unknown" };
}

function repoRelativePath(value) {
  return relative(root, resolve(value)).split(sep).join("/");
}

function productSalesEvidence(product) {
  const quantitySold = Number(product?.quantitySold || 0);
  const orderCount = Number(product?.orderCount || 0);
  const salesAmount = Number(product?.salesAmount || 0);
  return {
    quantitySold,
    orderCount,
    salesAmount,
    lastSaleDate: product?.lastSaleDate || null,
    hasSalesVoucher: quantitySold > 0 || orderCount > 0 || salesAmount > 0
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCliArgs(argv) {
  const options = { dryRun: false, strict: false, output: null, registry: null, ecount: null, cafe24: null };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--registry=")) options.registry = arg.slice("--registry=".length);
    else if (arg.startsWith("--ecount=")) options.ecount = arg.slice("--ecount=".length);
    else if (arg.startsWith("--cafe24=")) options.cafe24 = arg.slice("--cafe24=".length);
  }
  return options;
}

// ---------------------------------------------------------------------------
// 안전한 JSON 읽기
// ---------------------------------------------------------------------------

async function readJsonSafe(path) {
  if (!existsSync(path)) return { ok: false, reason: "missing_file", path };
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return { ok: true, data: parsed, path };
  } catch (err) {
    return { ok: false, reason: "invalid_json", path, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Product Registry 로드 + 신뢰 가능한(verified) 대상 추출
// ---------------------------------------------------------------------------

function isTrustedEntry(entry) {
  // 세 조건이 실제 데이터에서는 항상 같은 집합을 가리키지만(Phase1 정책상
  // exact_one_to_one만 verified=true), 향후 데이터 변화에 대비해 OR로 판단한다.
  const verifiedFlag = entry.verified === true;
  const confirmedStatus = entry.status === "confirmed";
  const fullConfidenceWithEcount =
    entry.confidence === 100 && Array.isArray(entry.ecount?.matchedProducts) && entry.ecount.matchedProducts.length > 0;
  return verifiedFlag || confirmedStatus || fullConfidenceWithEcount;
}

function loadRegistry(registryResult) {
  const data = registryResult.data;
  if (!data || !Array.isArray(data.entries)) {
    return { ok: false, reason: "registry_missing_entries" };
  }
  const entries = data.entries;
  const trusted = entries.filter(isTrustedEntry);
  const verifiedFlagCount = entries.filter((e) => e.verified === true).length;
  const confirmedStatusCount = entries.filter((e) => e.status === "confirmed").length;
  const fullConfidenceCount = entries.filter(
    (e) => e.confidence === 100 && Array.isArray(e.ecount?.matchedProducts) && e.ecount.matchedProducts.length > 0
  ).length;
  return {
    ok: true,
    entries,
    trusted,
    registryEntryCount: entries.length,
    verifiedFlagCount,
    confirmedStatusCount,
    fullConfidenceCount
  };
}

// ---------------------------------------------------------------------------
// ECOUNT 재고 소스 로드 (work/ecount-inventory/latest.json)
// 실제 필드: {productCode, productName, specification, barcode, purchasePrice, salesPrice, stockQuantity}
// ---------------------------------------------------------------------------

function loadEcountSource(ecountResult) {
  const data = ecountResult.data;
  if (!Array.isArray(data)) {
    return { ok: false, reason: "ecount_not_array" };
  }
  const map = new Map();
  for (const row of data) {
    const code = row?.productCode;
    if (!code) continue;
    map.set(String(code), row);
  }
  return { ok: true, map, itemCount: data.length };
}

// ---------------------------------------------------------------------------
// Cafe24 재고 소스 선택
//
// 우선순위:
//  1. --cafe24 명시 경로 (강제 지정, fallback 없음)
//  2. work/cafe24-product-catalog.json (전체 카탈로그 캐시 — 존재하면 이것이 canonical)
//  3. work/product-dashboard-proxy-*.json 중 "현재 월" 조회 구간(프론트엔드 기본 동작:
//     since=이번달-01, until=이번달 말일)과 일치하는 파일을 최우선으로 하고,
//     없으면 catalogSyncedAt이 가장 최신인 파일을 사용한다.
//     연도가 현재로부터 비정상적으로 먼(합성/테스트로 추정되는) 파일은 제외 후보로 별도 기록한다.
//
// 추가로, 선택된 1개 파일에 없는 productNo를 위해 "모든 product-dashboard-proxy 파일 중
// 해당 productNo가 존재하는 가장 catalogSyncedAt이 최신인 레코드"를 찾는 fallback 인덱스를
// 만든다. 이건 새로운 매칭 로직이 아니라, 이미 존재하는 캐시 파일들 중 더 최신 사본을
// 그대로 재사용하는 것뿐이다. 사용 여부는 각 item의 cafe24SourceUsed에 투명하게 기록한다.
// ---------------------------------------------------------------------------

function monthWindow(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-based
  const since = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const until = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { since, until };
}

function isPlausibleYear(dateStr, referenceYear) {
  if (!dateStr) return false;
  const year = Number(dateStr.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return year >= referenceYear - 3 && year <= referenceYear + 1;
}

async function scanProductDashboardProxyFiles(dir = workDir) {
  let files = [];
  try {
    files = (await readdir(dir)).filter((name) =>
      /^product-dashboard-proxy-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(name)
    );
  } catch {
    return [];
  }
  const rows = [];
  for (const name of files) {
    const match = name.match(/^product-dashboard-proxy-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/);
    const filePath = join(dir, name);
    const parsed = await readJsonSafe(filePath);
    if (!parsed.ok || !Array.isArray(parsed.data?.products)) continue;
    rows.push({
      file: name,
      path: filePath,
      since: match[1],
      until: match[2],
      catalogSyncedAt: parsed.data.catalogSyncedAt || null,
      catalogSource: parsed.data.catalogSource || null,
      productCount: parsed.data.products.length,
      products: parsed.data.products
    });
  }
  return rows;
}

async function selectCafe24Source(explicitPath, options = {}) {
  const scanDir = options.scanDir || workDir;
  const catalogPath = options.catalogPath || DEFAULT_PATHS.cafe24ProductCatalog;
  const now = options.now || new Date();

  if (explicitPath) {
    const explicit = await readJsonSafe(explicitPath);
    if (!explicit.ok) {
      return { ok: false, reason: explicit.reason, path: explicitPath };
    }
    const products = Array.isArray(explicit.data) ? explicit.data : explicit.data?.products;
    if (!Array.isArray(products)) {
      return { ok: false, reason: "cafe24_explicit_not_product_array", path: explicitPath };
    }
    return {
      ok: true,
      mode: "explicit",
      primary: { file: explicitPath, since: null, until: null, catalogSyncedAt: explicit.data?.catalogSyncedAt || null, productCount: products.length },
      productMap: buildCafe24ProductMap(products),
      fallbackIndex: new Map(),
      excludedSyntheticFiles: []
    };
  }

  const catalogResult = await readJsonSafe(catalogPath);
  if (catalogResult.ok) {
    const products = Array.isArray(catalogResult.data) ? catalogResult.data : catalogResult.data?.products;
    if (Array.isArray(products) && products.length) {
      return {
        ok: true,
        mode: "cafe24_product_catalog",
        primary: { file: catalogPath, since: null, until: null, catalogSyncedAt: catalogResult.data?.generatedAt || null, productCount: products.length },
        productMap: buildCafe24ProductMap(products),
        fallbackIndex: new Map(),
        excludedSyntheticFiles: []
      };
    }
  }

  const rows = await scanProductDashboardProxyFiles(scanDir);
  if (!rows.length) {
    return { ok: false, reason: "no_cafe24_source_found" };
  }

  const currentYear = now.getUTCFullYear();
  const { since: curSince, until: curUntil } = monthWindow(now);

  const excludedSyntheticFiles = rows
    .filter((r) => !isPlausibleYear(r.since, currentYear) || !isPlausibleYear(r.until, currentYear))
    .map((r) => ({ file: r.file, since: r.since, until: r.until }));

  const plausible = rows.filter((r) => isPlausibleYear(r.since, currentYear) && isPlausibleYear(r.until, currentYear));
  const candidatePool = plausible.length ? plausible : rows;

  let primaryRow = candidatePool.find((r) => r.since === curSince && r.until === curUntil && r.productCount > 0);
  let selectionRule = "current_month_window_exact_match";

  if (!primaryRow) {
    const withSyncedAt = candidatePool.filter((r) => r.catalogSyncedAt);
    const pool = withSyncedAt.length ? withSyncedAt : candidatePool;
    primaryRow = pool.reduce((best, r) => {
      if (!best) return r;
      const a = r.catalogSyncedAt || "";
      const b = best.catalogSyncedAt || "";
      if (a > b) return r;
      if (a === b && r.productCount > best.productCount) return r;
      return best;
    }, null);
    selectionRule = "max_catalogSyncedAt_fallback";
  }

  if (!primaryRow) {
    return { ok: false, reason: "no_usable_cafe24_cache_after_filtering" };
  }

  // 보조 fallback 인덱스: 모든(합성 제외) 파일 중 productNo별 catalogSyncedAt 최신 레코드
  const fallbackIndex = new Map();
  for (const row of candidatePool) {
    for (const product of row.products) {
      const key = String(product.productNo);
      const existing = fallbackIndex.get(key);
      const candidateSyncedAt = row.catalogSyncedAt || "";
      if (!existing || candidateSyncedAt > existing.catalogSyncedAt) {
        fallbackIndex.set(key, { product, file: row.file, catalogSyncedAt: candidateSyncedAt });
      }
    }
  }

  return {
    ok: true,
    mode: "product_dashboard_proxy_auto",
    selectionRule,
    primary: {
      file: primaryRow.file,
      since: primaryRow.since,
      until: primaryRow.until,
      catalogSyncedAt: primaryRow.catalogSyncedAt,
      catalogSource: primaryRow.catalogSource,
      productCount: primaryRow.productCount
    },
    productMap: buildCafe24ProductMap(primaryRow.products),
    fallbackIndex,
    excludedSyntheticFiles
  };
}

function buildCafe24ProductMap(products) {
  const map = new Map();
  for (const product of products) {
    if (product?.productNo === undefined || product?.productNo === null) continue;
    map.set(String(product.productNo), product);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 비교 로직
// ---------------------------------------------------------------------------

function toCafe24Variants(product) {
  if (!Array.isArray(product?.options)) return [];
  return product.options.map((o) => ({
    variantCode: o.variantCode ?? null,
    optionName: o.optionSummary ?? null,
    quantity: typeof o.quantity === "number" ? o.quantity : null
  }));
}

function isConsignmentProductName(name) {
  return typeof name === "string" && /\bCON\s*-/i.test(name);
}

function computeDifferenceRate(absoluteDifference, a, b) {
  const denom = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0));
  if (denom === 0) return 0;
  return absoluteDifference / denom;
}

function compareEntry(entry, ecountMap, cafe24Source) {
  const flags = [];
  const canonicalProductId = entry.canonicalProductId ?? null;
  const brandId = entry.brandId ?? null;
  const canonicalBrandName = entry.brandName ?? null;
  const canonicalProductName = entry.canonicalProductName ?? null;

  const cafe24ProductNo = entry.cafe24?.productNo ?? null;
  const cafe24ProductCode = entry.cafe24?.productCode ?? null;

  // --- Cafe24 side ---
  let cafe24SourceUsed = "missing";
  let cafe24Product = cafe24ProductNo ? cafe24Source.productMap.get(String(cafe24ProductNo)) : undefined;
  if (cafe24Product) {
    cafe24SourceUsed = "primary";
  } else if (cafe24ProductNo && cafe24Source.fallbackIndex.has(String(cafe24ProductNo))) {
    const fb = cafe24Source.fallbackIndex.get(String(cafe24ProductNo));
    cafe24Product = fb.product;
    cafe24SourceUsed = `fallback:${fb.file}`;
    flags.push("cafe24_from_fallback_cache");
  }

  const salesEvidence = productSalesEvidence(cafe24Product);
  const cafe24Variants = cafe24Product ? toCafe24Variants(cafe24Product) : [];
  const cafe24InventoryQuantity =
    cafe24Product && typeof cafe24Product.inventoryQuantity === "number" ? cafe24Product.inventoryQuantity : null;
  const cafe24VariantCount = cafe24Variants.length;

  if (!cafe24Product) flags.push("missing_cafe24_product");
  if (cafe24InventoryQuantity === null && cafe24Product) flags.push("cafe24_inventory_quantity_null");
  if (typeof cafe24InventoryQuantity === "number" && cafe24InventoryQuantity < 0) flags.push("negative_cafe24_stock");
  if (cafe24VariantCount > 1) flags.push("multiple_cafe24_variants");

  // --- ECOUNT side ---
  const matchedProducts = Array.isArray(entry.ecount?.matchedProducts) ? entry.ecount.matchedProducts : [];
  const ecountItems = [];
  let ecountStockSum = 0;
  let ecountStockKnownCount = 0;
  let ecountAnyNull = false;
  let ecountMissingCount = 0;

  for (const mp of matchedProducts) {
    const prodCd = mp.prodCd;
    const row = prodCd ? ecountMap.get(String(prodCd)) : undefined;
    if (!row) {
      ecountMissingCount += 1;
      ecountItems.push({ prodCd, barcode: mp.barcode ?? null, productName: mp.productName ?? null, size: mp.size ?? null, stockQuantity: null, foundInEcount: false });
      continue;
    }
    const stockQuantity = typeof row.stockQuantity === "number" ? row.stockQuantity : null;
    if (stockQuantity === null) ecountAnyNull = true;
    else {
      ecountStockSum += stockQuantity;
      ecountStockKnownCount += 1;
    }
    ecountItems.push({
      prodCd,
      barcode: row.barcode ?? mp.barcode ?? null,
      productName: row.productName ?? mp.productName ?? null,
      size: mp.size ?? null,
      stockQuantity,
      foundInEcount: true
    });
    if (typeof stockQuantity === "number" && stockQuantity < 0) flags.push("negative_ecount_stock");
    if (String(prodCd).toUpperCase().startsWith("QQQ")) flags.push("qqq_product");
    if (mp.consignment === true || isConsignmentProductName(mp.productName) || isConsignmentProductName(row.productName)) {
      flags.push("consignment_product");
    }
  }

  const ecountProdCdCount = matchedProducts.length;
  if (matchedProducts.length > 1) flags.push("multiple_ecount_sizes");
  if (ecountProdCdCount === 0) flags.push("verified_without_ecount_prodcd");
  if (ecountMissingCount > 0) flags.push("missing_ecount_item");
  if (ecountAnyNull) flags.push("ecount_stock_partial_or_full_null");

  const ecountStockQuantity = ecountStockKnownCount > 0 ? ecountStockSum : null;
  const brand = resolveBrand(entry, ecountItems, cafe24Product);

  // --- 비교 및 상태 분류 ---
  let status;
  let difference = null;
  let absoluteDifference = null;
  let differenceRate = null;

  const uniqueFlags = [...new Set(flags)];

  if (ecountProdCdCount === 0 || cafe24ProductNo === null || cafe24ProductCode === null) {
    status = "invalid_data";
  } else if (cafe24InventoryQuantity === null || ecountStockQuantity === null) {
    status = "one_source_missing";
  } else if (!Number.isFinite(cafe24InventoryQuantity) || !Number.isFinite(ecountStockQuantity)) {
    status = "invalid_data";
  } else {
    difference = ecountStockQuantity - cafe24InventoryQuantity;
    absoluteDifference = Math.abs(difference);
    differenceRate = computeDifferenceRate(absoluteDifference, ecountStockQuantity, cafe24InventoryQuantity);
    if (difference === 0) status = "exact_match";
    else if (absoluteDifference <= THRESHOLDS.nearMatchAbsoluteUnits || differenceRate <= THRESHOLDS.nearMatchRate) status = "near_match";
    else status = "mismatch";
  }

  return {
    canonicalProductId,
    brandId,
    canonicalBrandName: brand.name,
    rawCanonicalBrandName: canonicalBrandName,
    brandGroupKey: brand.name,
    brandSource: brand.source,
    canonicalProductName,
    cafe24: {
      cafe24ProductNo,
      cafe24ProductCode,
      cafe24VariantCount,
      cafe24InventoryQuantity,
      cafe24Variants,
      cafe24SourceUsed,
      salesEvidence
    },
    ecount: {
      ecountProdCdCount,
      ecountProdCds: matchedProducts.map((m) => m.prodCd),
      ecountStockQuantity,
      ecountItems
    },
    comparison: {
      difference,
      absoluteDifference,
      differenceRate
    },
    status,
    flags: uniqueFlags
  };
}

function isActionCandidate(item) {
  if (item.status === "negative_stock") return true;
  if (item.status === "invalid_data" && item.flags.includes("verified_without_ecount_prodcd")) return true;
  if (item.status === "one_source_missing") {
    return item.flags.includes("missing_cafe24_product") || item.flags.includes("missing_ecount_item");
  }
  return false;
}

function buildProdCdEntryMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    for (const mp of entry.ecount?.matchedProducts || []) {
      if (mp.prodCd && !map.has(String(mp.prodCd))) map.set(String(mp.prodCd), entry);
    }
  }
  return map;
}

function findCafe24ProductForEntry(entry, cafe24Source) {
  const productNo = entry?.cafe24?.productNo;
  if (!productNo || !cafe24Source?.productMap) return null;
  return cafe24Source.productMap.get(String(productNo)) || cafe24Source.fallbackIndex?.get(String(productNo))?.product || null;
}

function auditAahMidnightRegistry(entries) {
  const before = new Set();
  const after = new Set();
  for (const entry of entries) {
    const names = [entry.brandName, ...(entry.ecount?.matchedProducts || []).map((mp) => brandFromEcountProductName(mp.productName))];
    for (const name of names) {
      const compact = compactText(name);
      if (!/^aah midnight( club)?$/i.test(compact)) continue;
      before.add(compact);
      after.add(normalizeBrandName(compact));
    }
  }
  return { before: [...before], after: [...after] };
}

function buildNegativeStockCandidates(ecountMap, registryEntries, cafe24Source) {
  const entryByProdCd = buildProdCdEntryMap(registryEntries);
  const candidates = [];
  const stats = { excludedNonQqqNegativeWithoutSales: 0, keptQqqNegative: 0, keptNonQqqNegativeWithSales: 0 };
  const beforeBrandNames = new Set();
  const afterBrandNames = new Set();
  const aahBefore = new Set();

  for (const [prodCd, row] of ecountMap) {
    const stockQuantity = typeof row.stockQuantity === "number" ? row.stockQuantity : null;
    if (!(stockQuantity < 0)) continue;
    const isQqq = String(prodCd).toUpperCase().startsWith("QQQ");
    const entry = entryByProdCd.get(String(prodCd)) || null;
    const cafe24Product = findCafe24ProductForEntry(entry, cafe24Source);
    const salesEvidence = productSalesEvidence(cafe24Product);
    const rawBrand = entry?.brandName || brandFromEcountProductName(row.productName) || brandFromCafe24ProductName(cafe24Product?.productName);
    if (rawBrand) beforeBrandNames.add(compactText(rawBrand));
    if (/^aah midnight( club)?$/i.test(compactText(rawBrand))) aahBefore.add(compactText(rawBrand));

    if (!isQqq && !salesEvidence.hasSalesVoucher) {
      stats.excludedNonQqqNegativeWithoutSales += 1;
      continue;
    }
    if (isQqq) stats.keptQqqNegative += 1;
    else stats.keptNonQqqNegativeWithSales += 1;

    const ecountItem = {
      prodCd,
      barcode: row.barcode ?? null,
      productName: row.productName ?? null,
      size: entry?.ecount?.matchedProducts?.find((m) => String(m.prodCd) === String(prodCd))?.size ?? null,
      stockQuantity,
      foundInEcount: true
    };
    const brand = resolveBrand(entry, [ecountItem], cafe24Product);
    afterBrandNames.add(brand.name);
    const cafe24Variants = cafe24Product ? toCafe24Variants(cafe24Product) : [];
    candidates.push({
      canonicalProductId: entry?.canonicalProductId ?? null,
      brandId: entry?.brandId ?? null,
      canonicalBrandName: brand.name,
      rawCanonicalBrandName: entry?.brandName ?? null,
      brandGroupKey: brand.name,
      brandSource: brand.source,
      canonicalProductName: entry?.canonicalProductName ?? (compactText(String(row.productName || "").split("/").slice(1).join("/")) || null),
      cafe24: {
        cafe24ProductNo: entry?.cafe24?.productNo ?? null,
        cafe24ProductCode: entry?.cafe24?.productCode ?? null,
        cafe24VariantCount: cafe24Variants.length,
        cafe24InventoryQuantity: typeof cafe24Product?.inventoryQuantity === "number" ? cafe24Product.inventoryQuantity : null,
        cafe24Variants,
        cafe24SourceUsed: cafe24Product ? "registry_link" : "missing",
        salesEvidence
      },
      ecount: {
        ecountProdCdCount: 1,
        ecountProdCds: [prodCd],
        ecountStockQuantity: stockQuantity,
        ecountItems: [ecountItem]
      },
      comparison: { difference: null, absoluteDifference: null, differenceRate: null },
      status: "negative_stock",
      issueType: "negative_stock",
      flags: ["negative_ecount_stock", ...(isQqq ? ["qqq_product"] : ["non_qqq_product", "sales_voucher_found"])]
    });
  }

  return {
    candidates,
    stats,
    brandStats: {
      beforeBrandGroupCount: beforeBrandNames.size,
      afterBrandGroupCount: afterBrandNames.size,
      caseDuplicateMergedCount: Math.max(0, beforeBrandNames.size - afterBrandNames.size),
      aahMidnightBefore: [...aahBefore],
      aahMidnightAfter: aahBefore.size ? "AAH MIDNIGHT CLUB" : null
    }
  };
}

// ---------------------------------------------------------------------------
// 중복/충돌 진단 (전체 Registry 177건 기준으로 계산, verified 여부와 무관하게 존재 자체를 진단)
// ---------------------------------------------------------------------------

function detectConflicts(allEntries, trustedCanonicalIds) {
  const ecountOwners = new Map(); // prodCd -> Set(canonicalProductId)
  const cafe24Owners = new Map(); // productNo -> Set(canonicalProductId)

  for (const entry of allEntries) {
    const id = entry.canonicalProductId;
    for (const mp of entry.ecount?.matchedProducts || []) {
      if (!mp.prodCd) continue;
      if (!ecountOwners.has(mp.prodCd)) ecountOwners.set(mp.prodCd, new Set());
      ecountOwners.get(mp.prodCd).add(id);
    }
    const productNo = entry.cafe24?.productNo;
    if (productNo !== undefined && productNo !== null) {
      const key = String(productNo);
      if (!cafe24Owners.has(key)) cafe24Owners.set(key, new Set());
      cafe24Owners.get(key).add(id);
    }
  }

  const duplicateEcountProdCds = [...ecountOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([prodCd, owners]) => ({ prodCd, canonicalProductIds: [...owners] }));

  const duplicateCafe24Products = [...cafe24Owners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([productNo, owners]) => ({ productNo, canonicalProductIds: [...owners] }));

  const duplicateEcountProdCdsAffectingVerified = duplicateEcountProdCds.filter((d) =>
    d.canonicalProductIds.some((id) => trustedCanonicalIds.has(id))
  );
  const duplicateCafe24ProductsAffectingVerified = duplicateCafe24Products.filter((d) =>
    d.canonicalProductIds.some((id) => trustedCanonicalIds.has(id))
  );

  return {
    duplicateEcountProdCds,
    duplicateCafe24Products,
    duplicateEcountProdCdsAffectingVerified,
    duplicateCafe24ProductsAffectingVerified
  };
}

// ---------------------------------------------------------------------------
// 안전한 파일 쓰기 (atomic rename, server.mjs의 writeJsonAtomic 패턴과 동일)
// ---------------------------------------------------------------------------

async function writeJsonAtomic(file, data) {
  await mkdir(workDir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const json = JSON.stringify(data, null, 2);
  // 쓰기 전 재파싱하여 유효성 확인
  JSON.parse(json);
  await writeFile(tmp, json);
  await rename(tmp, file);
}

// ---------------------------------------------------------------------------
// 콘솔 리포트
// ---------------------------------------------------------------------------

function printReport(result) {
  const { meta, summary, conflicts, items } = result;
  console.log("Inventory Reconciliation Diagnostic");
  console.log("====================================");
  console.log(`Registry entries: ${meta.registryEntryCount}`);
  console.log(`Verified entries: ${meta.verifiedEntryCount}`);
  console.log(`Compared entries: ${meta.comparedEntryCount}`);
  console.log(`Action candidates: ${summary.actionCandidateCount}`);
  console.log(`Negative stock: ${summary.negativeStockCount}`);
  console.log(`Connection issue: ${summary.connectionIssueCount}`);
  console.log(`Excluded non-QQQ negative without sales: ${meta.policy.excludedNonQqqNegativeWithoutSales}`);
  console.log(`Kept QQQ negative: ${meta.policy.keptQqqNegative}`);
  console.log(`Kept non-QQQ negative with sales: ${meta.policy.keptNonQqqNegativeWithSales}`);
  console.log();
  console.log("Top 20 action candidates:");
  for (const m of items.slice(0, 20)) {
    console.log(
      `- ${m.status} | ${m.canonicalBrandName} | ${m.canonicalProductName || "-"} | ECOUNT ${m.ecount.ecountStockQuantity ?? "n/a"} | flags [${m.flags.join(", ")}]`
    );
  }
  console.log();
  console.log("Conflict summary:");
  console.log(`- duplicate ECOUNT links (전체 Registry 기준): ${conflicts.duplicateEcountProdCds.length}`);
  console.log(`- duplicate Cafe24 anchors (전체 Registry 기준): ${conflicts.duplicateCafe24Products.length}`);
  console.log(`- duplicate ECOUNT links affecting verified set: ${conflicts.duplicateEcountProdCdsAffectingVerified.length}`);
  console.log(`- duplicate Cafe24 anchors affecting verified set: ${conflicts.duplicateCafe24ProductsAffectingVerified.length}`);
  console.log(`- missing ECOUNT codes (verified 대상 중): ${meta.missingEcountProdCdCount}`);
  console.log(`- missing Cafe24 products (verified 대상 중): ${meta.missingCafe24ProductCount}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const registryPath = cli.registry || DEFAULT_PATHS.registry;
  const ecountPath = cli.ecount || DEFAULT_PATHS.ecount;
  const outputPath = cli.output || DEFAULT_PATHS.output;

  const registryRaw = await readJsonSafe(registryPath);
  if (!registryRaw.ok) {
    console.error(`[FATAL] Product Registry를 읽을 수 없습니다: ${registryPath} (${registryRaw.reason})`);
    process.exitCode = 1;
    return;
  }
  const registry = loadRegistry(registryRaw);
  if (!registry.ok) {
    console.error(`[FATAL] Product Registry 구조가 예상과 다릅니다: ${registry.reason}`);
    process.exitCode = 1;
    return;
  }

  const ecountRaw = await readJsonSafe(ecountPath);
  if (!ecountRaw.ok) {
    console.error(`[FATAL] ECOUNT 재고 스냅샷을 읽을 수 없습니다: ${ecountPath} (${ecountRaw.reason})`);
    process.exitCode = 1;
    return;
  }
  const ecountSource = loadEcountSource(ecountRaw);
  if (!ecountSource.ok) {
    console.error(`[FATAL] ECOUNT 재고 스냅샷 구조가 예상과 다릅니다: ${ecountSource.reason}`);
    process.exitCode = 1;
    return;
  }

  const cafe24Source = await selectCafe24Source(cli.cafe24);
  if (!cafe24Source.ok) {
    if (cli.strict) {
      console.error(`[FATAL] --strict 모드: Cafe24 재고 source를 확정할 수 없습니다 (${cafe24Source.reason}).`);
      process.exitCode = 1;
      return;
    }
    console.error(`[WARN] Cafe24 재고 source를 찾지 못했습니다 (${cafe24Source.reason}). 모든 항목이 one_source_missing으로 분류됩니다.`);
  }

  const trustedIds = new Set(registry.trusted.map((e) => e.canonicalProductId));
  const conflicts = detectConflicts(registry.entries, trustedIds);

  const compareSource = cafe24Source.ok ? cafe24Source : { productMap: new Map(), fallbackIndex: new Map() };
  const comparedItems = registry.trusted.map((entry) => compareEntry(entry, ecountSource.map, compareSource));
  const registryConnectionItems = comparedItems.filter(isActionCandidate);
  const negativeStock = buildNegativeStockCandidates(ecountSource.map, registry.entries, compareSource);
  const aahMidnightRegistryAudit = auditAahMidnightRegistry(registry.entries);
  const items = [...negativeStock.candidates, ...registryConnectionItems].sort((a, b) =>
    String(a.canonicalBrandName || "").localeCompare(String(b.canonicalBrandName || ""), "ko") ||
    String(a.canonicalProductName || "").localeCompare(String(b.canonicalProductName || ""), "ko")
  );

  const missingEcountProdCds = items.filter((i) => i.flags.includes("missing_ecount_item") || i.flags.includes("verified_without_ecount_prodcd"));
  const missingCafe24Products = items.filter((i) => i.flags.includes("missing_cafe24_product"));

  const summaryCounts = items.reduce(
    (acc, i) => {
      acc[i.status] = (acc[i.status] || 0) + 1;
      return acc;
    },
    {}
  );

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "diagnostic_only",
    meta: {
      registryPath: repoRelativePath(registryPath),
      ecountPath: repoRelativePath(ecountPath),
      cafe24Source: cafe24Source.ok
        ? {
            mode: cafe24Source.mode,
            selectionRule: cafe24Source.selectionRule || null,
            primary: cafe24Source.primary,
            excludedSyntheticFiles: cafe24Source.excludedSyntheticFiles || []
          }
        : { mode: "unavailable", reason: cafe24Source.reason },
      registryEntryCount: registry.registryEntryCount,
      verifiedEntryCount: registry.trusted.length,
      verifiedFlagCount: registry.verifiedFlagCount,
      confirmedStatusCount: registry.confirmedStatusCount,
      fullConfidenceCount: registry.fullConfidenceCount,
      comparedEntryCount: comparedItems.length,
      missingEcountProdCdCount: missingEcountProdCds.length,
      missingCafe24ProductCount: missingCafe24Products.length,
      thresholds: THRESHOLDS,
      policy: {
        negativeStock: "QQQ negative always included; non-QQQ negative only included with Cafe24 sales evidence",
        cafe24Usage: "connection_and_sales_evidence_only",
        beforeCandidateCount: comparedItems.length,
        afterCandidateCount: items.length,
        ...negativeStock.stats,
        ...negativeStock.brandStats,
        aahMidnightRegistryBefore: aahMidnightRegistryAudit.before,
        aahMidnightRegistryAfter: aahMidnightRegistryAudit.after
      }
    },
    summary: {
      actionCandidateCount: items.length,
      negativeStockCount: summaryCounts.negative_stock || 0,
      connectionIssueCount: (summaryCounts.invalid_data || 0) + (summaryCounts.one_source_missing || 0),
      exactMatchCount: 0,
      nearMatchCount: 0,
      mismatchCount: 0,
      oneSourceMissingCount: summaryCounts.one_source_missing || 0,
      invalidDataCount: summaryCounts.invalid_data || 0
    },
    conflicts: {
      duplicateEcountProdCds: conflicts.duplicateEcountProdCds,
      duplicateCafe24Products: conflicts.duplicateCafe24Products,
      duplicateEcountProdCdsAffectingVerified: conflicts.duplicateEcountProdCdsAffectingVerified,
      duplicateCafe24ProductsAffectingVerified: conflicts.duplicateCafe24ProductsAffectingVerified,
      missingEcountProdCds: missingEcountProdCds.map((i) => ({ canonicalProductId: i.canonicalProductId, ecountProdCds: i.ecount.ecountProdCds })),
      missingCafe24Products: missingCafe24Products.map((i) => ({ canonicalProductId: i.canonicalProductId, cafe24ProductNo: i.cafe24.cafe24ProductNo }))
    },
    items
  };

  printReport(result);

  if (cli.dryRun) {
    console.log();
    console.log("[dry-run] 파일을 쓰지 않았습니다.");
    return;
  }

  await writeJsonAtomic(outputPath, result);
  console.log();
  console.log(`[OK] 진단 결과 저장: ${outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export {
  parseCliArgs,
  isTrustedEntry,
  loadRegistry,
  loadEcountSource,
  monthWindow,
  isPlausibleYear,
  buildCafe24ProductMap,
  toCafe24Variants,
  isConsignmentProductName,
  computeDifferenceRate,
  compareEntry,
  isActionCandidate,
  buildNegativeStockCandidates,
  auditAahMidnightRegistry,
  normalizeBrandName,
  brandFromEcountProductName,
  productSalesEvidence,
  detectConflicts,
  selectCafe24Source,
  scanProductDashboardProxyFiles
};
