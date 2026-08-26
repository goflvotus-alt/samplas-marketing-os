#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllCafe24ProductsFullCatalog } from "./cafe24-script-client.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const outputPathDefault = join(workDir, "cafe24-ecount-product-matching-diagnostic.json");

const SAMPLE_LIMIT = 20;
const SIZE_TOKENS = new Set(["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "OS", "OSFA", "FREE", "ONE", "ONESIZE", "ONE SIZE"]);

function parseCliArgs(argv) {
  const options = { output: outputPathDefault, sampleLimit: SAMPLE_LIMIT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") options.output = resolve(rootDir, argv[++index] || "");
    else if (arg.startsWith("--output=")) options.output = resolve(rootDir, arg.slice("--output=".length));
    else if (arg === "--sample-limit") options.sampleLimit = Math.max(1, Number(argv[++index]) || SAMPLE_LIMIT);
    else if (arg.startsWith("--sample-limit=")) options.sampleLimit = Math.max(1, Number(arg.slice("--sample-limit=".length)) || SAMPLE_LIMIT);
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.Data?.Result)) return payload.Data.Result;
  return [];
}

// (Registry 생성 정책 리팩터링) 이전에는 latestProductDashboardSource()가
// work/product-dashboard-proxy-*.json(특정 기간 동안 Product Dashboard가 캐시해 둔 부분
// 집합)에서만 Cafe24 상품을 읽었다. 이 소스는 Dashboard가 실제로 조회했던 상품만 포함하므로
// Cafe24 전체 카탈로그를 대표하지 못한다(예: display=T/selling=T인데 Dashboard 캐시 기간
// 밖이라 한 번도 조회되지 않은 상품은 여기 없다). 이 함수는 그 소스를 완전히 대체한다 —
// Cafe24 admin/products를 Pagination 끝까지 순회해 display/selling 여부와 무관하게 전체
// 상품을 가져온다(scripts/cafe24-script-client.mjs). 중간에 임의 개수에서 멈추지 않는다.
async function fullCafe24ProductCatalogSource(options = {}) {
  if (Array.isArray(options.cafe24ProductsOverride)) {
    // 테스트/오프라인 재현용 — 실 네트워크 호출 없이 준비된 상품 목록을 그대로 사용한다.
    return {
      relativePath: "test_override",
      modifiedAt: options.now || new Date().toISOString(),
      products: options.cafe24ProductsOverride
    };
  }
  const result = await fetchAllCafe24ProductsFullCatalog(options.fullCatalogFetchOptions || {});
  return {
    relativePath: "cafe24_admin_products_api_full_catalog",
    modifiedAt: new Date().toISOString(),
    products: result.products,
    pagesFetched: result.pagesFetched,
    stoppedReason: result.stoppedReason
  };
}

async function loadBrandSources() {
  const brandMaster = existsSync(join(workDir, "brand-master.json")) ? await readJson(join(workDir, "brand-master.json")) : { brands: [] };
  const brandList = existsSync(join(workDir, "intelligence", "brand-master-list.json")) ? await readJson(join(workDir, "intelligence", "brand-master-list.json")) : [];
  const aliases = existsSync(join(workDir, "intelligence", "brand-aliases.json")) ? await readJson(join(workDir, "intelligence", "brand-aliases.json")) : [];
  return { brandMaster, brandList, aliases };
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[·•∙]/g, " ")
    .replace(/[_/\\|:：,.;]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripConsignmentToken(value) {
  return normalizeText(value).replace(/(^|\s)CON(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
}

function stripBracketParts(value) {
  return String(value ?? "").replace(/^\s*\[[^\]]+\]\s*/, "").replace(/\([^)]*\)/g, " ");
}

function removeOptionSuffix(value) {
  const tokens = normalizeText(value).split(" ").filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    const prev = tokens[tokens.length - 2];
    if (/^\d{1,3}$/.test(last) || /^\d{2,3}(MM|CM)$/.test(last) || SIZE_TOKENS.has(last) || SIZE_TOKENS.has(`${prev} ${last}`)) {
      tokens.pop();
      continue;
    }
    break;
  }
  return tokens.join(" ");
}

export function normalizeProductName(value) {
  return removeOptionSuffix(stripBracketParts(value));
}

function normalizeBrand(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function extractCafe24BrandTokens(productName) {
  const bracket = String(productName || "").match(/^\s*\[([^\]]+)\]/);
  if (!bracket) return [];
  return bracket[1].split(/[:：/|]/).map((item) => item.trim()).filter(Boolean);
}

export function splitEcountProductName(productName) {
  const raw = String(productName ?? "").trim();
  const parts = raw.split(/\s+\/\s+/);
  const hasSlashBrand = parts.length > 1;
  const brandRaw = hasSlashBrand ? parts[0].trim() : "";
  const nameRaw = hasSlashBrand ? parts.slice(1).join(" / ").trim() : raw;
  return { raw, brandRaw, nameRaw };
}

function splitCafe24ProductName(productName, brandName) {
  const raw = String(productName ?? "").trim();
  const tokens = extractCafe24BrandTokens(raw);
  return {
    raw,
    brandRaw: brandName || tokens[0] || "",
    nameRaw: stripBracketParts(raw).trim()
  };
}

function makeBrandResolver(sources) {
  const codeToName = new Map();
  const aliasToName = new Map();
  for (const brand of sources.brandMaster?.brands || []) {
    const code = String(brand.brand_code || brand.id || "").trim();
    const name = String(brand.brand_name || brand.name || "").trim();
    if (code) codeToName.set(code, name || code);
    for (const value of [name, ...(brand.name_aliases || [])]) {
      const key = normalizeBrand(value);
      if (key) aliasToName.set(key, name || value);
    }
  }
  for (const brand of sources.brandList || []) {
    const code = String(brand.id || brand.brand_code || "").trim();
    const name = String(brand.name || brand.brand_name || "").trim();
    if (code && !codeToName.has(code)) codeToName.set(code, name || code);
    const key = normalizeBrand(name);
    if (key) aliasToName.set(key, name);
  }
  for (const entry of sources.aliases || []) {
    const alias = normalizeBrand(entry.alias);
    const brandName = codeToName.get(entry.brandId) || entry.brandId || entry.alias;
    if (alias) aliasToName.set(alias, brandName);
  }
  return {
    codeToName,
    addAlias(alias, canonicalName) {
      const key = normalizeBrand(alias);
      const canonical = String(canonicalName || "").trim();
      if (key && canonical) aliasToName.set(key, canonical);
    },
    resolve(value) {
      const key = normalizeBrand(value);
      return aliasToName.get(key) || String(value || "").trim();
    }
  };
}

function isQqqProduct(record) {
  return /^QQQ/i.test(String(record.productCode || "")) || /^QQQ(\s|$|\/)/i.test(String(record.rawName || record.productName || ""));
}

function tokenSet(value) {
  return new Set(normalizeProductName(value).split(" ").filter((token) => token.length > 1));
}

export function tokenSimilarity(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

function keyFor(brandKey, productKey) {
  return `${brandKey}||${productKey}`;
}

function addIndex(index, key, value) {
  if (!key) return;
  const list = index.get(key) || [];
  list.push(value);
  index.set(key, list);
}

function normalizeCafe24Products(products, brandResolver) {
  return products.map((product) => {
    const brandCode = String(product.brand || product.brand_code || product.brandCode || "").trim();
    const brandName = brandResolver.codeToName.get(brandCode) || brandCode;
    const split = splitCafe24ProductName(product.productName || product.product_name, brandName);
    const brandResolved = brandResolver.resolve(split.brandRaw);
    const normalizedBrand = normalizeBrand(brandResolved);
    const normalizedProduct = normalizeProductName(split.nameRaw);
    return {
      source: "cafe24",
      productNo: String(product.productNo || product.product_no || "").trim(),
      productCode: String(product.productCode || product.product_code || "").trim(),
      manufacturerCode: String(product.manufacturer_code || product.manufacturerCode || "").trim(),
      supplierCode: String(product.supplier_code || product.supplierCode || product.manufacturer_code || "").trim(),
      brandCode,
      brandName: brandResolved,
      rawName: split.raw,
      productName: split.nameRaw,
      normalizedBrand,
      normalizedProduct,
      normalizedProductWithoutCon: stripConsignmentToken(normalizedProduct),
      original: product
    };
  });
}

function normalizeEcountProducts(rows, brandResolver) {
  return rows.map((row) => {
    const productCode = String(row.productCode || row.PROD_CD || "").trim();
    const split = splitEcountProductName(row.productName || row.PROD_DES);
    const brandResolved = brandResolver.resolve(split.brandRaw);
    const normalizedBrand = normalizeBrand(brandResolved || split.brandRaw);
    const normalizedProduct = normalizeProductName(split.nameRaw);
    const normalizedProductWithoutCon = stripConsignmentToken(normalizedProduct);
    return {
      source: "ecount",
      productCode,
      barcode: String(row.barcode || row.BAR_CODE || "").trim(),
      specification: String(row.specification || row.SIZE_DES || "").trim(),
      rawName: split.raw,
      brandName: brandResolved || split.brandRaw,
      productName: split.nameRaw,
      normalizedBrand,
      normalizedProduct,
      normalizedProductWithoutCon,
      consignmentCandidate: normalizedProduct !== normalizedProductWithoutCon,
      qqq: /^QQQ/i.test(productCode) || /^QQQ(\s|$|\/)/i.test(split.raw),
      original: row
    };
  });
}

function auxiliaryMatches(ecount, cafe24) {
  const ecountCodes = new Set([ecount.productCode, ecount.barcode].map((item) => normalizeText(item)).filter(Boolean));
  const cafeCodes = [
    ["product_code", cafe24.productCode],
    ["manufacturer_code", cafe24.manufacturerCode],
    ["supplier_code", cafe24.supplierCode]
  ];
  return cafeCodes.filter(([, value]) => ecountCodes.has(normalizeText(value))).map(([type, value]) => ({ type, value }));
}

function buildExactMatches(ecountProducts, cafe24Products) {
  const cafeByKey = new Map();
  const ecountByKey = new Map();
  for (const cafe24 of cafe24Products) addIndex(cafeByKey, keyFor(cafe24.normalizedBrand, cafe24.normalizedProductWithoutCon), cafe24);
  for (const ecount of ecountProducts.filter((item) => !item.qqq)) addIndex(ecountByKey, keyFor(ecount.normalizedBrand, ecount.normalizedProductWithoutCon), ecount);
  const matches = [];
  const matchedEcount = new Set();
  const matchedCafe = new Set();
  for (const [key, eList] of ecountByKey.entries()) {
    const cList = cafeByKey.get(key) || [];
    if (!cList.length) continue;
    const classification = eList.length === 1 && cList.length === 1 ? "exact_one_to_one" : "exact_one_to_many";
    for (const ecount of eList) {
      for (const cafe24 of cList) {
        const aux = auxiliaryMatches(ecount, cafe24);
        matches.push(makeResult(classification, ecount, cafe24, {
          confidence: classification === "exact_one_to_one" ? 0.96 : aux.length ? 0.86 : 0.78,
          evidence: ["normalized_brand", "normalized_product_name", ...aux.map((item) => item.type)],
          pendingReasons: classification === "exact_one_to_one" ? [] : aux.length ? ["multiple_exact_candidates_auxiliary_supported"] : ["multiple_exact_candidates"]
        }));
        matchedEcount.add(ecount.productCode);
        matchedCafe.add(cafe24.productNo);
      }
    }
  }
  return { matches, matchedEcount, matchedCafe, cafeByKey, ecountByKey };
}

function buildFuzzyMatches(ecountProducts, cafe24Products, matchedEcount, matchedCafe) {
  const matches = [];
  for (const ecount of ecountProducts.filter((item) => !item.qqq && !matchedEcount.has(item.productCode))) {
    const candidates = cafe24Products
      .filter((cafe24) => !matchedCafe.has(cafe24.productNo) && cafe24.normalizedBrand === ecount.normalizedBrand)
      .map((cafe24) => {
        const similarity = tokenSimilarity(ecount.normalizedProductWithoutCon, cafe24.normalizedProductWithoutCon);
        const aux = auxiliaryMatches(ecount, cafe24);
        return { cafe24, similarity, aux, score: similarity + (aux.length ? 0.08 : 0) };
      })
      .filter((item) => item.similarity >= 0.45)
      .sort((a, b) => b.score - a.score || b.similarity - a.similarity || a.cafe24.productNo.localeCompare(b.cafe24.productNo));
    if (!candidates.length) continue;
    const [best, second] = candidates;
    const high = best.score >= 0.78 && (!second || best.score - second.score >= 0.12);
    const classification = high ? "fuzzy_high_confidence" : "fuzzy_ambiguous";
    const selected = high ? [best] : candidates.slice(0, 5);
    for (const candidate of selected) {
      matches.push(makeResult(classification, ecount, candidate.cafe24, {
        confidence: Number(Math.min(0.9, candidate.score).toFixed(4)),
        evidence: ["normalized_brand", "product_name_token_similarity", ...candidate.aux.map((item) => item.type)],
        similarity: candidate.similarity,
        pendingReasons: high ? ["fuzzy_match_requires_review"] : ["multiple_fuzzy_candidates", "manual_review_required"]
      }));
    }
    if (high) {
      matchedEcount.add(ecount.productCode);
      matchedCafe.add(best.cafe24.productNo);
    }
  }
  return { matches, matchedEcount, matchedCafe };
}

function makeResult(classification, ecount, cafe24, details = {}) {
  return {
    classification,
    confidence: details.confidence ?? null,
    evidence: details.evidence || [],
    pendingReasons: details.pendingReasons || [],
    similarity: details.similarity ?? null,
    ecount: ecount ? {
      productCode: ecount.productCode,
      barcode: ecount.barcode || null,
      rawName: ecount.rawName,
      brandName: ecount.brandName,
      productName: ecount.productName,
      specification: ecount.specification || null,
      normalizedBrand: ecount.normalizedBrand,
      normalizedProduct: ecount.normalizedProduct,
      normalizedProductWithoutCon: ecount.normalizedProductWithoutCon,
      consignmentCandidate: ecount.consignmentCandidate,
      qqq: ecount.qqq
    } : null,
    cafe24: cafe24 ? {
      productNo: cafe24.productNo,
      productCode: cafe24.productCode || null,
      manufacturerCode: cafe24.manufacturerCode || null,
      supplierCode: cafe24.supplierCode || null,
      rawName: cafe24.rawName,
      brandCode: cafe24.brandCode || null,
      brandName: cafe24.brandName,
      productName: cafe24.productName,
      normalizedBrand: cafe24.normalizedBrand,
      normalizedProduct: cafe24.normalizedProduct,
      normalizedProductWithoutCon: cafe24.normalizedProductWithoutCon
    } : null
  };
}

function summarizeByBrand(results, ecountProducts, cafe24Products) {
  const brands = new Map();
  const ensure = (brand) => {
    const key = brand || "UNASSIGNED";
    if (!brands.has(key)) brands.set(key, { brand: key, ecountCount: 0, cafe24Count: 0, matchedEcount: new Set(), matchedCafe24: new Set(), exactOneToOne: 0, fuzzyHighConfidence: 0, ambiguous: 0 });
    return brands.get(key);
  };
  for (const item of ecountProducts) ensure(item.normalizedBrand).ecountCount += 1;
  for (const item of cafe24Products) ensure(item.normalizedBrand).cafe24Count += 1;
  for (const result of results) {
    const brand = result.ecount?.normalizedBrand || result.cafe24?.normalizedBrand || "UNASSIGNED";
    const row = ensure(brand);
    const isMatchedClassification = ["exact_one_to_one", "exact_one_to_many", "fuzzy_high_confidence", "fuzzy_ambiguous"].includes(result.classification);
    if (isMatchedClassification && result.ecount?.productCode) row.matchedEcount.add(result.ecount.productCode);
    if (isMatchedClassification && result.cafe24?.productNo) row.matchedCafe24.add(result.cafe24.productNo);
    if (result.classification === "exact_one_to_one") row.exactOneToOne += 1;
    if (result.classification === "fuzzy_high_confidence") row.fuzzyHighConfidence += 1;
    if (["exact_one_to_many", "fuzzy_ambiguous"].includes(result.classification)) row.ambiguous += 1;
  }
  return [...brands.values()].map((row) => ({
    brand: row.brand,
    ecountCount: row.ecountCount,
    cafe24Count: row.cafe24Count,
    matchedEcountCount: row.matchedEcount.size,
    matchedCafe24Count: row.matchedCafe24.size,
    ecountMatchRate: row.ecountCount ? Number((row.matchedEcount.size / row.ecountCount).toFixed(4)) : null,
    cafe24MatchRate: row.cafe24Count ? Number((row.matchedCafe24.size / row.cafe24Count).toFixed(4)) : null,
    exactOneToOne: row.exactOneToOne,
    fuzzyHighConfidence: row.fuzzyHighConfidence,
    ambiguous: row.ambiguous
  })).sort((a, b) => b.ecountCount - a.ecountCount || a.brand.localeCompare(b.brand));
}

function duplicateKeys(index) {
  return [...index.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, count: list.length, samples: list.slice(0, 10).map((item) => item.productCode || item.productNo || item.rawName) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function brandCollisionSamples(ecountProducts, cafe24Products) {
  const byName = new Map();
  for (const item of [...ecountProducts, ...cafe24Products]) {
    addIndex(byName, item.normalizedProductWithoutCon, item);
  }
  return [...byName.entries()]
    .map(([name, list]) => ({ name, brands: [...new Set(list.map((item) => item.normalizedBrand).filter(Boolean))], samples: list.slice(0, 8).map((item) => ({ source: item.source, id: item.productCode || item.productNo, brand: item.brandName, rawName: item.rawName })) }))
    .filter((row) => row.name && row.brands.length > 1)
    .slice(0, 50);
}

function classificationSummary(results, totalEcount, totalCafe24) {
  const counts = {};
  for (const result of results) counts[result.classification] = (counts[result.classification] || 0) + 1;
  for (const key of ["exact_one_to_one", "exact_one_to_many", "fuzzy_high_confidence", "fuzzy_ambiguous", "cafe24_only", "ecount_only", "excluded_qqq", "consignment_candidate", "unresolved"]) {
    counts[key] ||= 0;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => [key, { count, ecountRatio: totalEcount ? Number((count / totalEcount).toFixed(4)) : null, cafe24Ratio: totalCafe24 ? Number((count / totalCafe24).toFixed(4)) : null }]));
}

function sampleByClassification(results, limit) {
  const samples = {};
  for (const result of results) {
    const list = samples[result.classification] || [];
    if (list.length < limit) list.push(result);
    samples[result.classification] = list;
  }
  return samples;
}

function auxiliaryContribution(results) {
  const auxTypes = new Set(["manufacturer_code", "supplier_code", "product_code"]);
  const supported = results.filter((result) => result.evidence.some((item) => auxTypes.has(item)));
  return {
    totalWithAuxiliaryEvidence: supported.length,
    ambiguitySupportedByAuxiliary: supported.filter((result) => result.pendingReasons.includes("multiple_exact_candidates_auxiliary_supported")).length,
    fuzzySupportedByAuxiliary: supported.filter((result) => result.classification.startsWith("fuzzy")).length,
    note: "Auxiliary codes are diagnostic evidence only; they are not treated as standalone match keys."
  };
}

function conImpact(ecountProducts, cafe24Products) {
  const cafeOriginal = new Set(cafe24Products.map((item) => keyFor(item.normalizedBrand, item.normalizedProduct)));
  const cafeWithout = new Set(cafe24Products.map((item) => keyFor(item.normalizedBrand, item.normalizedProductWithoutCon)));
  const candidates = ecountProducts.filter((item) => item.consignmentCandidate);
  let gained = 0;
  const samples = [];
  for (const item of candidates) {
    const before = cafeOriginal.has(keyFor(item.normalizedBrand, item.normalizedProduct));
    const after = cafeWithout.has(keyFor(item.normalizedBrand, item.normalizedProductWithoutCon));
    if (!before && after) {
      gained += 1;
      if (samples.length < 20) samples.push({ productCode: item.productCode, rawName: item.rawName, before: item.normalizedProduct, after: item.normalizedProductWithoutCon });
    }
  }
  return { consignmentCandidateCount: candidates.length, gainedExactKeyMatchesAfterConRemoval: gained, samples };
}

export async function buildCafe24EcountProductMatchingDiagnostic(options = {}) {
  const [dashboard, brandSources, ecountRaw] = await Promise.all([
    fullCafe24ProductCatalogSource(options),
    loadBrandSources(),
    Array.isArray(options.ecountProductsOverride)
      ? Promise.resolve({ products: options.ecountProductsOverride })
      : readJson(join(workDir, "ecount-inventory", "latest.json"))
  ]);
  const brandResolver = makeBrandResolver(brandSources);
  for (const product of dashboard.products) {
    const brandCode = String(product.brand || product.brand_code || product.brandCode || "").trim();
    const canonicalBrandName = brandResolver.codeToName.get(brandCode) || brandCode;
    for (const token of extractCafe24BrandTokens(product.productName || product.product_name)) {
      brandResolver.addAlias(token, canonicalBrandName);
    }
  }
  const cafe24Products = normalizeCafe24Products(dashboard.products, brandResolver);
  const ecountProducts = normalizeEcountProducts(extractList(ecountRaw), brandResolver);
  const { matches: exactMatches, matchedEcount, matchedCafe, cafeByKey, ecountByKey } = buildExactMatches(ecountProducts, cafe24Products);
  const fuzzy = buildFuzzyMatches(ecountProducts, cafe24Products, matchedEcount, matchedCafe);
  const results = [...exactMatches, ...fuzzy.matches];
  const matchedEcountFinal = fuzzy.matchedEcount;
  const matchedCafeFinal = fuzzy.matchedCafe;
  for (const ecount of ecountProducts) {
    if (ecount.qqq) {
      results.push(makeResult("excluded_qqq", ecount, null, { confidence: 1, evidence: ["qqq_product_code"], pendingReasons: ["excluded_from_automatic_matching"] }));
    } else if (ecount.consignmentCandidate && !matchedEcountFinal.has(ecount.productCode)) {
      results.push(makeResult("consignment_candidate", ecount, null, { confidence: null, evidence: ["independent_con_token"], pendingReasons: ["manual_review_required"] }));
    } else if (!matchedEcountFinal.has(ecount.productCode)) {
      results.push(makeResult("ecount_only", ecount, null, { confidence: null, evidence: [], pendingReasons: ["no_cafe24_candidate"] }));
    }
  }
  for (const cafe24 of cafe24Products) {
    if (!matchedCafeFinal.has(cafe24.productNo) && !results.some((result) => result.cafe24?.productNo === cafe24.productNo)) {
      results.push(makeResult("cafe24_only", null, cafe24, { confidence: null, evidence: [], pendingReasons: ["no_ecount_candidate"] }));
    }
  }
  const totalEcount = ecountProducts.length;
  const totalCafe24 = cafe24Products.length;
  const classification = classificationSummary(results, totalEcount, totalCafe24);
  const exactOneToOneEcount = new Set(results.filter((item) => item.classification === "exact_one_to_one").map((item) => item.ecount?.productCode).filter(Boolean)).size;
  const fuzzyHighEcount = new Set(results.filter((item) => item.classification === "fuzzy_high_confidence").map((item) => item.ecount?.productCode).filter(Boolean)).size;
  const ambiguousEcount = new Set(results.filter((item) => ["exact_one_to_many", "fuzzy_ambiguous"].includes(item.classification)).map((item) => item.ecount?.productCode).filter(Boolean)).size;
  return {
    generatedAt: new Date().toISOString(),
    mode: "cafe24_ecount_product_matching_diagnostic_read_only",
    sources: {
      cafe24: {
        path: dashboard.relativePath,
        productCount: cafe24Products.length,
        modifiedAt: dashboard.modifiedAt,
        mode: "full_catalog_pagination",
        pagesFetched: dashboard.pagesFetched ?? null,
        stoppedReason: dashboard.stoppedReason ?? null
      },
      ecount: {
        path: Array.isArray(options.ecountProductsOverride)
          ? "ecount_products_override"
          : "work/ecount-inventory/latest.json",
        productCount: ecountProducts.length
      },
      brandMaster: ["work/brand-master.json", "work/intelligence/brand-master-list.json", "work/intelligence/brand-aliases.json"]
    },
    policy: {
      barcode: "ECOUNT BAR_CODE is preserved but not used for Cafe24 matching because Cafe24 barcode-like fields are unavailable.",
      cafe24ProductCode: "Cafe24 product_code is preserved as Cafe24 canonical identifier and diagnostic tracking signal only.",
      auxiliaryCodes: "manufacturer_code and supplier_code are auxiliary evidence only.",
      con: "Only independent CON token is treated as consignment marker; CON inside another word is not removed.",
      qqq: "QQQ is excluded from automatic product matching."
    },
    metrics: {
      cafe24ProductCount: totalCafe24,
      ecountProductCount: totalEcount,
      exactOneToOneCount: exactOneToOneEcount,
      exactOneToOneRate: Number((exactOneToOneEcount / totalEcount).toFixed(4)),
      fuzzyHighConfidenceCount: fuzzyHighEcount,
      fuzzyHighConfidenceRate: Number((fuzzyHighEcount / totalEcount).toFixed(4)),
      ambiguousCount: ambiguousEcount,
      ambiguousRate: Number((ambiguousEcount / totalEcount).toFixed(4)),
      unmatchedEcountCount: new Set(results.filter((item) => ["ecount_only", "consignment_candidate"].includes(item.classification)).map((item) => item.ecount?.productCode).filter(Boolean)).size,
      unmatchedCafe24Count: new Set(results.filter((item) => item.classification === "cafe24_only").map((item) => item.cafe24?.productNo).filter(Boolean)).size,
      auxiliaryContribution: auxiliaryContribution(results),
      conImpact: conImpact(ecountProducts, cafe24Products)
    },
    classification,
    brandCoverage: summarizeByBrand(results, ecountProducts, cafe24Products).slice(0, 120),
    duplicates: {
      cafe24NormalizedKeys: duplicateKeys(cafeByKey).slice(0, 100),
      ecountNormalizedKeys: duplicateKeys(ecountByKey).slice(0, 100)
    },
    brandCollisions: brandCollisionSamples(ecountProducts, cafe24Products),
    samples: sampleByClassification(results, options.sampleLimit || SAMPLE_LIMIT),
    results,
    recommendation: {
      automaticApply: "Do not apply automatically in this phase. exact_one_to_one is the only low-risk auto-match candidate set for a later reviewed phase.",
      reviewRequired: ["exact_one_to_many", "fuzzy_high_confidence", "fuzzy_ambiguous", "consignment_candidate", "ecount_only", "cafe24_only"],
      nextStep: "Review exact_one_to_one samples, then build a candidate review queue for fuzzy and ambiguous rows."
    }
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const diagnostic = await buildCafe24EcountProductMatchingDiagnostic(options);
  await writeFile(options.output, `${JSON.stringify(diagnostic, null, 2)}\n`);
  console.log("Cafe24 ↔ ECOUNT product matching diagnostic");
  console.log(`- Cafe24 products: ${diagnostic.metrics.cafe24ProductCount}`);
  console.log(`- ECOUNT products: ${diagnostic.metrics.ecountProductCount}`);
  console.log(`- exact one-to-one: ${diagnostic.metrics.exactOneToOneCount}`);
  console.log(`- fuzzy high-confidence: ${diagnostic.metrics.fuzzyHighConfidenceCount}`);
  console.log(`- ambiguous: ${diagnostic.metrics.ambiguousCount}`);
  console.log(`- output: ${options.output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Cafe24 ↔ ECOUNT product matching diagnostic failed: ${error.message}`);
    process.exitCode = 1;
  });
}
