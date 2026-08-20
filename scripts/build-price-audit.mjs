#!/usr/bin/env node
// TODAY 온라인 ↔ ECOUNT 가격 불일치 Audit builder. READ-ONLY: never writes to
// work/product-registry.json, work/brand-master.json, work/brand-commercial-policy.json,
// or Cafe24/ECOUNT themselves. Only writes work/price-audit.json.
//
// Reuses existing infrastructure, no new matching/policy logic:
// - Product Registry (work/product-registry.json) for Cafe24<->ECOUNT identity —
//   the exact same canonicalProductId / cafe24.productNo / ecount.matchedProducts
//   shape every other script in this project already uses.
// - The existing Cafe24 proxy routes (/api/cafe24/products/:no,
//   /api/cafe24/products/:no/discountprice) via the local Marketing OS server —
//   same auth headers (CAFE24_PROXY_SECRET / CAFE24_PROXY_BASIC_AUTH) and the same
//   price-resolution formula intelligence-service.mjs's resolveCommercialPolicyOnlinePrice
//   already uses (pc_discount_price ?? mobile_discount_price ?? price ?? retail_price).
// - ECOUNT CURRENT product master price (work/ecount-inventory/latest.json .salesPrice),
//   never work/ecount-sales/*.json transaction amounts.
// - work/brand-commercial-policy.json's existing brand_code / product_rules(PRODUCT_NAME_PREFIX)
//   resolution, mirrored read-only from intelligence-service.mjs's
//   handleBrandCommercialPolicyGet — used only to annotate a probable cause, never to
//   change a price or a classification.
//
// Requires the local Marketing OS server (server.mjs) running on 127.0.0.1:8787 (or
// $PORT) so Cafe24 calls go through the already-authenticated Render proxy, exactly
// like every other read-only regression check in this project.
//
// Usage:
//   node scripts/build-price-audit.mjs                 (full run over the whole registry)
//   node scripts/build-price-audit.mjs --limit 200      (first N eligible entries, for a quick check)
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const workDir = join(rootDir, "work");
const outputPath = join(workDir, "price-audit.json");

const CONCURRENCY = 1; // Cafe24 rate-limit protection
const PRICE_TOLERANCE_KRW = 100; // rounding/float tolerance, not a VAT adjustment

function parseArgs(argv) {
  const options = { limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--limit") options.limit = Math.max(1, Number(argv[++i]) || null);
  }
  return options;
}

async function loadEnv() {
  const envPath = join(rootDir, ".env");
  const parsed = { ...process.env };
  if (!existsSync(envPath)) return parsed;
  const text = await readFile(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!parsed[key]) parsed[key] = value;
  }
  return parsed;
}

function proxyHeaders(env) {
  const headers = { Accept: "application/json" };
  if (env.CAFE24_PROXY_SECRET) headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
  if (env.CAFE24_PROXY_BASIC_AUTH) headers.Authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
  return headers;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok || (response.status !== 429 && response.status < 500)) {
        return response;
      }
      lastError = new Error(`http_${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(500 * (2 ** (attempt - 1)));
    }
  }

  throw lastError || new Error("fetch_failed");
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Mirrors intelligence-service.mjs's resolveCommercialPolicyOnlinePrice() price
// formula exactly (same fallback chain), read-only, no new pricing rule invented.
function effectiveCafe24Price(product, discountprice) {
  const retailPrice = Number(product?.retail_price ?? product?.price ?? 0);
  const rawSalePrice = Number(
    discountprice?.pc_discount_price ??
    discountprice?.mobile_discount_price ??
    product?.price ??
    retailPrice
  );
  const salePrice = Number.isFinite(rawSalePrice) && rawSalePrice >= 0 ? Math.round(rawSalePrice) : Math.round(retailPrice);
  return { retailPrice: Number.isFinite(retailPrice) ? Math.round(retailPrice) : null, salePrice };
}

// Mirrors handleBrandCommercialPolicyGet's policy/product-rule resolution (server-side
// intelligence-service.mjs), read-only — used only to annotate a probable cause.
export function resolveBrandName(entry, brandNameByCode) {
  return entry?.brandName || brandNameByCode?.get(entry?.brandId) || null;
}

export function resolvePolicy(policies, brandCode, canonicalProductName) {
  const policy = policies.find((item) => item.brand_code === brandCode) || null;
  if (!policy) return null;
  const baseDiscount = policy.stylist_discount_percent ?? null;
  const rules = Array.isArray(policy.product_rules) ? policy.product_rules : [];
  const matchedRule = canonicalProductName
    ? rules.find((rule) => rule?.type === "PRODUCT_NAME_PREFIX" && String(rule.value || "").trim() &&
        canonicalProductName.trim().toUpperCase().startsWith(String(rule.value).trim().toUpperCase())) || null
    : null;
  const effectiveDiscountPercent = matchedRule?.stylist_discount_percent ?? baseDiscount;
  return { baseDiscount, effectiveDiscountPercent, matchedRule: matchedRule?.value || null };
}

export function classify({
  registryEntry,
  cafe24Price,
  ecountPrice,
  ecountPriceConsistent,
  ecountPriceComplete = true,
  cafe24Fetched
}) {
  if (!registryEntry.ecount.matchedProducts.length) {
    return { status: "MATCH_REQUIRED", reason: "no_ecount_sku_connected" };
  }
  if (!cafe24Fetched) {
    return { status: "REVIEW_REQUIRED", reason: "cafe24_price_fetch_failed" };
  }
  if (
    typeof cafe24Price !== "number" ||
    !Number.isFinite(cafe24Price) ||
    cafe24Price <= 0
  ) {
    return { status: "REVIEW_REQUIRED", reason: "cafe24_price_missing_or_invalid" };
  }
  if (!ecountPriceComplete) {
    return { status: "REVIEW_REQUIRED", reason: "ecount_master_price_missing" };
  }
  if (!ecountPriceConsistent) {
    return { status: "REVIEW_REQUIRED", reason: "ecount_sku_prices_disagree" };
  }
  const lowConfidenceMatch = !registryEntry.verified && Number(registryEntry.confidence || 0) < 90;
  const diff = cafe24Price - ecountPrice;
  if (Math.abs(diff) <= PRICE_TOLERANCE_KRW) {
    return { status: "MATCH", reason: "price_equal" };
  }
  if (lowConfidenceMatch) {
    return { status: "REVIEW_REQUIRED", reason: "low_confidence_registry_match_with_price_diff" };
  }
  if (diff < 0) {
    return { status: "ECOUNT_HIGHER", reason: "ecount_master_price_above_cafe24" };
  }
  return { status: "ECOUNT_LOWER", reason: "ecount_master_price_below_cafe24" };
}

export async function buildPriceAudit(options = {}) {
  const generatedAt = new Date().toISOString();
  const env = await loadEnv();
  const baseUrl = (env.INTELLIGENCE_MARKETING_OS_BASE_URL || env.MARKETING_OS_BASE_URL || `http://127.0.0.1:${env.PORT || 8787}`).replace(/\/$/, "");
  const headers = proxyHeaders(env);

  const [registry, latestInventory, commercialPolicy, brandMaster] = await Promise.all([
    readJson(join(workDir, "product-registry.json")),
    readJson(join(workDir, "ecount-inventory", "latest.json")),
    readJson(join(workDir, "brand-commercial-policy.json")).catch(() => ({ policies: [] })),
    readJson(join(workDir, "brand-master.json")).catch(() => ({ brands: [] }))
  ]);
  const inventoryByCode = new Map(latestInventory.map((row) => [row.productCode, row]));
  const policies = Array.isArray(commercialPolicy?.policies) ? commercialPolicy.policies : [];
  const brandNameByCode = new Map(
    (Array.isArray(brandMaster) ? brandMaster : brandMaster?.brands || [])
      .filter((brand) => brand?.brand_code)
      .map((brand) => [brand.brand_code, brand.brand_name || null])
  );

  const eligible = (registry.entries || []).filter((e) => e?.cafe24?.productNo);
  const targets = options.limit ? eligible.slice(0, options.limit) : eligible;

  console.error(`[price-audit] ${targets.length} registry entries with a Cafe24 productNo (of ${eligible.length} total, ${registry.entries.length} in registry)`);

  const rows = await mapWithConcurrency(targets, CONCURRENCY, async (entry) => {
    const productNo = entry.cafe24.productNo;
    const ecountSkus = entry.ecount.matchedProducts.map((m) => ({ ...m, current: inventoryByCode.get(m.prodCd) || null }));

    const validEcountPrice = (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0;

    const ecountPriceComplete =
      ecountSkus.length > 0 &&
      ecountSkus.every((s) => validEcountPrice(s.current?.salesPrice));

    const ecountPrices = ecountSkus
      .map((s) => s.current?.salesPrice)
      .filter(validEcountPrice);

    const ecountPriceConsistent =
      ecountPrices.length > 0 &&
      new Set(ecountPrices).size === 1;

    const ecountPrice = ecountPrices.length ? ecountPrices[0] : null;

    let cafe24Fetched = false;
    let cafe24Price = null;
    let cafe24RetailPrice = null;
    let cafe24Display = null;
    let cafe24Selling = null;
    let fetchError = null;

    if (ecountSkus.length) {
      try {
        const detailRes = await fetchWithRetry(
          `${baseUrl}/api/cafe24/products/${encodeURIComponent(productNo)}`,
          { headers }
        );
        await sleep(100);
        const discountRes = await fetchWithRetry(
          `${baseUrl}/api/cafe24/products/${encodeURIComponent(productNo)}/discountprice`,
          { headers }
        );
        const detailBody = await detailRes.json();
        const discountBody = await discountRes.json();
        if (detailRes.ok && !detailBody.error) {
          const product = detailBody.product || {};
          const discountprice = discountRes.ok && !discountBody.error ? (discountBody.discountprice || {}) : {};
          const priced = effectiveCafe24Price(product, discountprice);
          cafe24Price = priced.salePrice;
          cafe24RetailPrice = priced.retailPrice;
          cafe24Display = product.display ?? null;
          cafe24Selling = product.selling ?? null;
          cafe24Fetched = true;
        } else {
          fetchError = detailBody.error || `http_${detailRes.status}`;
        }
      } catch (error) {
        fetchError = error.message;
      }
    }

    const classification = classify({
      registryEntry: entry,
      cafe24Price,
      ecountPrice,
      ecountPriceConsistent,
      ecountPriceComplete,
      cafe24Fetched
    });

    let policyNote = null;
    if ((classification.status === "ECOUNT_HIGHER" || classification.status === "ECOUNT_LOWER") && entry.brandId) {
      const policy = resolvePolicy(policies, entry.brandId, entry.canonicalProductName);
      if (policy && Number.isFinite(policy.effectiveDiscountPercent) && Number.isFinite(ecountPrice)) {
        const expectedIfPolicyAppliedOnline = Math.round(ecountPrice * (1 - policy.effectiveDiscountPercent / 100));
        const policyExplainsGap = Math.abs(expectedIfPolicyAppliedOnline - cafe24Price) <= PRICE_TOLERANCE_KRW;
        policyNote = {
          effectiveDiscountPercent: policy.effectiveDiscountPercent,
          decisionSource: policy.matchedRule ? "PRODUCT_RULE" : "BRAND_POLICY",
          policyExplainsGap,
          causeHint: policyExplainsGap
            ? (classification.status === "ECOUNT_HIGHER" ? "브랜드 정책 할인이 Cafe24에는 반영, ECOUNT는 정가 — ECOUNT 가격 확인" : "브랜드 정책 할인이 ECOUNT에는 반영, Cafe24는 정가 — Cafe24 가격 확인")
            : null
        };
      }
    }

    return {
      canonicalProductId: entry.canonicalProductId,
      brandId: entry.brandId,
      brandName: resolveBrandName(entry, brandNameByCode),
      canonicalProductName: entry.canonicalProductName,
      cafe24ProductNo: productNo,
      cafe24ProductCode: entry.cafe24.productCode || null,
      registryStatus: entry.status,
      registryConfidence: entry.confidence,
      registryVerified: Boolean(entry.verified),
      ecountSkus: ecountSkus.map((s) => ({ prodCd: s.prodCd, productName: s.current?.productName || s.productName || null, size: s.size, salesPrice: s.current?.salesPrice ?? null })),
      ecountPrice,
      ecountPriceConsistent,
      cafe24Price,
      cafe24RetailPrice,
      cafe24Display,
      cafe24Selling,
      priceDiff: Number.isFinite(cafe24Price) && Number.isFinite(ecountPrice) ? cafe24Price - ecountPrice : null,
      status: classification.status,
      reason: classification.reason,
      policyNote,
      fetchError
    };
  });

  const summary = { MATCH: 0, ECOUNT_HIGHER: 0, ECOUNT_LOWER: 0, MATCH_REQUIRED: 0, REVIEW_REQUIRED: 0 };
  for (const row of rows) summary[row.status] = (summary[row.status] || 0) + 1;

  return {
    generatedAt,
    source: "price_audit_registry_ecount_cafe24_join",
    registryTotal: registry.entries.length,
    eligibleTotal: eligible.length,
    auditedTotal: rows.length,
    summary,
    rows
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildPriceAudit(options);
  console.log("=== TODAY Price Audit build ===");
  console.log(`- registry total: ${result.registryTotal}`);
  console.log(`- eligible (has cafe24.productNo): ${result.eligibleTotal}`);
  console.log(`- audited this run: ${result.auditedTotal}${options.limit ? ` (--limit ${options.limit})` : ""}`);
  console.log(`- MATCH: ${result.summary.MATCH}`);
  console.log(`- ECOUNT_HIGHER: ${result.summary.ECOUNT_HIGHER}`);
  console.log(`- ECOUNT_LOWER: ${result.summary.ECOUNT_LOWER}`);
  console.log(`- MATCH_REQUIRED: ${result.summary.MATCH_REQUIRED}`);
  console.log(`- REVIEW_REQUIRED: ${result.summary.REVIEW_REQUIRED}`);
  await writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(`- output: work/price-audit.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`build-price-audit failed: ${error.message}`);
    console.error(error.stack);
    process.exitCode = 1;
  });
}
