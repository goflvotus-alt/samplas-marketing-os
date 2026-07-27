function cleanString(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function parseMetaContentId(value) {
  const rawContentId = Array.isArray(value) ? value.map(cleanString).filter(Boolean).join(",") : cleanString(value).split(",")[0].trim();
  if (!rawContentId) return { rawContentId, cafe24ProductNo: null, variantCode: null, format: "empty", valid: false };
  if (Array.isArray(value)) return { rawContentId, cafe24ProductNo: null, variantCode: null, format: "array", valid: false };
  if (/^\d+$/.test(rawContentId)) return { rawContentId, cafe24ProductNo: null, variantCode: null, format: "manual_numeric_id", valid: false };
  const parts = rawContentId.split(".");
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !parts[1].trim()) {
    return { rawContentId, cafe24ProductNo: null, variantCode: null, format: "manual_or_unknown_id", valid: false };
  }
  return {
    rawContentId,
    cafe24ProductNo: Number(parts[0]),
    variantCode: parts[1].trim(),
    format: "cafe24_product_variant",
    valid: true
  };
}

export function buildProductRegistryIndex(registry = {}) {
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const byProductNo = new Map();
  const byRetailerId = new Map();
  const byProductVariant = new Map();
  for (const entry of entries) {
    const productNo = cleanString(entry?.cafe24?.productNo ?? entry?.cafe24ProductNo ?? entry?.productNo);
    const productCode = cleanString(entry?.cafe24?.productCode ?? entry?.productCode);
    if (productNo && !byProductNo.has(productNo)) byProductNo.set(productNo, entry);
    for (const id of [entry?.retailerId, entry?.retailer_id, entry?.canonicalRetailerId, entry?.meta?.retailerId, entry?.cafe24?.retailerId].map(cleanString).filter(Boolean)) {
      byRetailerId.set(id, entry);
    }
    const variantCodes = [
      entry?.variantCode,
      entry?.variant_code,
      entry?.cafe24?.variantCode,
      entry?.cafe24?.variant_code,
      ...(Array.isArray(entry?.cafe24?.variants) ? entry.cafe24.variants.map((item) => item?.variantCode ?? item?.variant_code ?? item?.id) : []),
      ...(Array.isArray(entry?.variantIds) ? entry.variantIds : [])
    ].map(cleanString).filter(Boolean);
    for (const variantCode of variantCodes) {
      if (productNo) byProductVariant.set(`${productNo}.${variantCode}`, entry);
    }
    if (productNo && productCode) byProductVariant.set(`${productNo}.${productCode}`, entry);
  }
  return { entries, byProductNo, byRetailerId, byProductVariant };
}

export function resolveMetaContentId(contentId, registryIndex) {
  const parsed = parseMetaContentId(contentId);
  const raw = parsed.rawContentId;
  let matchType = "unresolved_manual_id";
  if (parsed.valid) matchType = "unresolved_product_registry_miss";
  else if (parsed.format === "manual_numeric_id") matchType = "unresolved_manual_numeric_id";
  else if (parsed.format === "empty") matchType = "unresolved_empty";
  else if (parsed.format === "array") matchType = "unresolved_array";
  let entry = null;
  if (raw && registryIndex?.byRetailerId?.has(raw)) {
    entry = registryIndex.byRetailerId.get(raw);
    matchType = "retailer_id_exact";
  } else if (parsed.valid && registryIndex?.byProductVariant?.has(raw)) {
    entry = registryIndex.byProductVariant.get(raw);
    matchType = "product_no_variant_exact";
  } else if (parsed.valid && registryIndex?.byProductNo?.has(String(parsed.cafe24ProductNo))) {
    entry = registryIndex.byProductNo.get(String(parsed.cafe24ProductNo));
    matchType = "product_no_exact";
  }
  return {
    contentId: raw,
    parsed,
    matched: Boolean(entry),
    matchType: entry ? matchType : matchType,
    product: entry ? productFromRegistryEntry(entry, parsed) : null
  };
}

export function productFromRegistryEntry(entry, parsed = {}) {
  return {
    canonicalProductId: entry?.canonicalProductId ?? null,
    cafe24ProductNo: Number(entry?.cafe24?.productNo ?? parsed.cafe24ProductNo) || null,
    variantCode: parsed.variantCode ?? entry?.cafe24?.variantCode ?? null,
    brand: entry?.brandName ?? entry?.canonicalBrandName ?? null,
    productName: entry?.canonicalProductName ?? entry?.cafe24?.productName ?? null,
    optionName: entry?.optionName ?? entry?.cafe24?.optionName ?? null,
    color: entry?.color ?? entry?.cafe24?.color ?? null,
    size: entry?.size ?? entry?.cafe24?.size ?? null,
    registryStatus: entry?.status ?? null,
    verified: Boolean(entry?.verified),
    confidence: Number.isFinite(Number(entry?.confidence)) ? Number(entry.confidence) : null,
    ecountMatchedCount: Array.isArray(entry?.ecount?.matchedProducts) ? entry.ecount.matchedProducts.length : 0
  };
}

export function purchaseCountFromRow(row = {}) {
  const direct = Number(row.purchaseCount ?? row.purchases ?? row.value);
  if (Number.isFinite(direct)) return direct;
  const actions = Array.isArray(row.actions) ? row.actions : [];
  const purchase = actions.find((item) => String(item?.action_type || "").includes("purchase"));
  const count = Number(purchase?.value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

export function contentIdFromRow(row = {}) {
  return row.contentId ?? row.content_id ?? row.product_id ?? row.retailer_id ?? row.retailerId ?? row.breakdownValue ?? null;
}

// ---------------------------------------------------------------------------
// Runtime Auto Enrichment (Product Registry 생성 정책 리팩터링)
//
// Registry는 이제 Primary Cache일 뿐이고 실제 Source of Truth는 Cafe24다. content_id가
// 파싱은 되지만(cafe24_product_variant 형식) Registry에 그 productNo가 아직 없는 경우
// (matchType === "unresolved_product_registry_miss"), Registry를 절대 수정하거나 파일에
// 쓰지 않고 Cafe24 상품 상세 API를 호출해 메모리 안에서만 "Runtime Product"를 만들어
// 그 자리에서 채워 넣는다. 이 아래 함수들은 순수하게 이 계층만 담당하며, 기존
// enrichMetaProductBreakdown/resolveMetaContentId/parseMetaContentId는 한 글자도 바꾸지
// 않는다 — 이 함수들이 반환한 결과를 그대로 입력으로 받아 후처리(post-processing)만 한다.
// ---------------------------------------------------------------------------

function cafe24DetailBrandName(detail = {}) {
  return (
    detail.brand_name ||
    detail.brandName ||
    (detail.brand && typeof detail.brand === "object" ? detail.brand.name : null) ||
    detail.brand_code ||
    detail.brand ||
    null
  );
}

// Runtime Product는 productFromRegistryEntry()가 반환하는 것과 동일한 필드 모양을 갖는다 —
// 그래야 이걸 사용하는 쪽(예: Meta Ads 상품 테이블)이 "이게 registry에서 온 건지 runtime에서
// 온 건지" 분기 없이 그대로 소비할 수 있다. source/registry 두 필드만 보고 구분하면 된다.
export function buildRuntimeProductFromCafe24Detail(parsed, detail = {}, options = {}) {
  const resolveBrandName = typeof options.resolveBrandName === "function" ? options.resolveBrandName : null;
  const brandCode = detail.brand_code || detail.brandCode || detail.brand || null;
  const brand = resolveBrandName ? (resolveBrandName(brandCode) || cafe24DetailBrandName(detail)) : cafe24DetailBrandName(detail);
  return {
    source: "runtime",
    registry: false,
    canonicalProductId: null,
    cafe24ProductNo: Number(detail.product_no ?? detail.productNo ?? parsed.cafe24ProductNo) || null,
    productCode: detail.product_code || detail.custom_product_code || detail.productCode || parsed.variantCode || null,
    variantCode: parsed.variantCode ?? null,
    brand: brand || null,
    productName: detail.product_name || detail.eng_product_name || detail.productName || null,
    optionName: null,
    color: null,
    size: null,
    registryStatus: "runtime_enrichment",
    verified: false,
    confidence: null,
    ecountMatchedCount: 0
  };
}

// enrichMetaProductBreakdown()이 만든 결과를 받아 registry miss(파싱은 valid인데 매칭 실패)
// 행만 골라 Cafe24 상세 API로 보강한다. 같은 productNo가 여러 행(광고/캠페인별)에 걸쳐
// 나올 수 있으므로 productNo당 최대 1회만 호출한다(dedup). Cafe24 API 실패(404 등)는
// 그 행을 계속 unresolved로 남기고 전체 흐름은 중단하지 않는다 — 이 API 하나가 개별 상품
// 조회에 실패했다고 나머지 응답까지 실패시키지 않는다.
export async function applyRuntimeAutoEnrichment(enriched, options = {}) {
  const fetchDetail = options.fetchDetail;
  if (typeof fetchDetail !== "function") return enriched;

  const missRows = (enriched.rows || []).filter(
    (row) => !row.matched && row.parsed?.valid && row.matchType === "unresolved_product_registry_miss"
  );
  if (!missRows.length) return enriched;

  const uniqueProductNos = [...new Set(missRows.map((row) => row.parsed.cafe24ProductNo))];
  const concurrency = Math.max(1, Number(options.concurrency) || 3);
  const detailByProductNo = new Map();
  const errorByProductNo = new Map();

  let cursor = 0;
  async function worker() {
    while (cursor < uniqueProductNos.length) {
      const index = cursor;
      cursor += 1;
      const productNo = uniqueProductNos[index];
      try {
        const detail = await fetchDetail(productNo);
        if (detail && Object.keys(detail).length) detailByProductNo.set(productNo, detail);
        else errorByProductNo.set(productNo, "empty_detail_response");
      } catch (error) {
        errorByProductNo.set(productNo, error?.message || "cafe24_detail_fetch_failed");
        if (typeof options.onError === "function") {
          try { options.onError(productNo, error); } catch { /* logging failure must not break enrichment */ }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueProductNos.length) }, worker));

  let runtimeEnrichedCount = 0;
  const rows = (enriched.rows || []).map((row) => {
    if (!row.matched && row.parsed?.valid && row.matchType === "unresolved_product_registry_miss") {
      const detail = detailByProductNo.get(row.parsed.cafe24ProductNo);
      if (detail) {
        runtimeEnrichedCount += 1;
        return {
          ...row,
          matched: true,
          matchType: "runtime_auto_enrichment",
          product: buildRuntimeProductFromCafe24Detail(row.parsed, detail, options)
        };
      }
      const failureReason = errorByProductNo.get(row.parsed.cafe24ProductNo);
      if (failureReason) {
        return { ...row, matchType: "runtime_auto_enrichment_failed", runtimeEnrichmentError: failureReason };
      }
    }
    return row;
  });

  const unresolved = rows.filter((row) => !row.matched);
  return {
    rows,
    unresolved,
    summary: {
      ...enriched.summary,
      matchedRows: rows.filter((row) => row.matched).length,
      unresolvedRows: unresolved.length,
      runtimeEnrichedCount
    }
  };
}

export function enrichMetaProductBreakdown(rows = [], registry = {}) {
  const registryIndex = buildProductRegistryIndex(registry);
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const contentId = contentIdFromRow(row);
    const key = cleanString(contentId);
    if (!key) continue;
    const current = grouped.get(key) || { raw: row, purchaseCount: 0 };
    current.purchaseCount += purchaseCountFromRow(row);
    current.raw = { ...current.raw, ...row };
    grouped.set(key, current);
  }
  const enrichedRows = [...grouped.entries()].map(([contentId, group]) => {
    const resolved = resolveMetaContentId(contentId, registryIndex);
    return {
      campaignId: group.raw.campaign_id ?? group.raw.campaignId ?? "",
      campaignName: group.raw.campaign_name ?? group.raw.campaignName ?? "",
      adsetId: group.raw.adset_id ?? group.raw.adsetId ?? "",
      adsetName: group.raw.adset_name ?? group.raw.adsetName ?? "",
      adId: group.raw.ad_id ?? group.raw.adId ?? "",
      adName: group.raw.ad_name ?? group.raw.adName ?? "",
      contentId,
      purchaseCount: group.purchaseCount,
      matched: resolved.matched,
      matchType: resolved.matchType,
      parsed: resolved.parsed,
      product: resolved.product
    };
  });
  const unresolved = enrichedRows.filter((row) => !row.matched);
  return {
    rows: enrichedRows,
    unresolved,
    summary: {
      rowCount: enrichedRows.length,
      attributedPurchases: enrichedRows.reduce((sum, row) => sum + Number(row.purchaseCount || 0), 0),
      matchedRows: enrichedRows.filter((row) => row.matched).length,
      unresolvedRows: unresolved.length
    }
  };
}
