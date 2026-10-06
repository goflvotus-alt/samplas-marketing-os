// Cafe24 actual order/items are the source of truth for sold products.
// Cafe24 Analytics is used only for order-level acquisition attribution.
// Meta product_id attribution is NEVER treated as an actually sold SKU.
import {
  isCafe24CanceledOrRefunded,
  isCafe24CanceledItem,
  cafe24OrderItems,
  cafe24ItemQuantity,
  cafe24ItemAmount,
  cafe24OrderAmount,
  trustedCafe24OrderDate
} from "./cafe24-order-amount.mjs";

const LEGACY_MAPPINGS = {
  meta_meantime_look: "MEANTIME 착장 광고",
  meta_ssage: "SSㅏ게 드립니다.",
  meta_adv_catalog: "어드벤티지 쇼핑 기본 카탈로그 광고",
  meta_adv_image: "어드벤티지 쇼핑 카탈로그 이미지 컬렉션 광고"
};

const text = (value) =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;

const isPrivatePaymentItem = (item) =>
  /개인결제창/.test(String(item?.product_name || item?.name || ""));

const isHistoricalClaimItem = (item) =>
  /^(취소완료|반품완료|교환완료)$/.test(
    String(item?.status_text || "").trim()
  );

function dedupeActiveItems(items = []) {
  const seen = new Set();
  const kept = [];

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) continue;
    if (isCafe24CanceledItem(item)) continue;
    if (isHistoricalClaimItem(item)) continue;
    if (isPrivatePaymentItem(item)) continue;

    const key = [
      text(item.variant_code) ||
        text(item.sku) ||
        text(item.product_code) ||
        text(item.product_no) ||
        "",
      text(item.option_value) ||
        text(item.option_name) ||
        text(item.option) ||
        "",
      text(item.product_name) || text(item.name) || ""
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }

  return kept.reverse();
}

function analyticsRows(analytics) {
  if (!analytics || analytics.ok === false) return [];
  if (Array.isArray(analytics.orderdetails)) return analytics.orderdetails;
  if (Array.isArray(analytics?.data?.orderdetails)) {
    return analytics.data.orderdetails;
  }
  return [];
}

function buildMetaIndexes(metaAds = []) {
  const byAdId = new Map();
  const byCampaignId = new Map();

  for (const row of metaAds || []) {
    const adId = text(row?.adId || row?.ad_id);
    const campaignId = text(row?.campaignId || row?.campaign_id);

    if (adId) byAdId.set(adId, row);
    if (campaignId && !byCampaignId.has(campaignId)) {
      byCampaignId.set(campaignId, row);
    }
  }

  return { byAdId, byCampaignId };
}

function legacyTracking(order) {
  const inflow = text(order?.inflow_path);
  const ghost = text(order?.ghost_mall_id);

  const inflowMeta = inflow?.startsWith("meta_");
  const ghostMeta = ghost?.startsWith("meta_");

  if (!inflowMeta && !ghostMeta) return null;

  const tracking = inflowMeta ? inflow : ghost;
  const conflict = inflowMeta && ghostMeta && inflow !== ghost;

  if (conflict) {
    return {
      tracking_source: "META_LEGACY",
      ad_mapping: "TRACKING CONFLICT / AD MAPPING NOT TRUSTED",
      attribution_note:
        "Legacy Cafe24 tracking conflict; actual Cafe24 product only."
    };
  }

  if (tracking === "meta_adv_video") {
    return {
      tracking_source: "META_LEGACY",
      ad_mapping: "LEGACY / TRACKING UNRELIABLE",
      attribution_note:
        "Legacy Cafe24 tracking present but mapping not trusted; actual Cafe24 product only."
    };
  }

  const mapping = LEGACY_MAPPINGS[tracking];

  return {
    tracking_source: "META_LEGACY",
    ad_mapping: mapping || "UNMAPPED META TRACKING CODE",
    attribution_note: mapping
      ? "Legacy Cafe24 tracking fallback; actual Cafe24 product."
      : "Cafe24 actual; Tracking present but ad mapping not trusted; not Meta-attributed product",
    legacy_tracking_code: tracking
  };
}

function classifyAttribution(analyticsRow, metaIndexes, order) {
  if (!analyticsRow) {
    return (
      legacyTracking(order) || {
        tracking_source: "UNATTRIBUTED",
        ad_mapping: "추적정보 없음",
        attribution_note:
          "Cafe24 actual order/item; no direct acquisition attribution."
      }
    );
  }

  const ad = String(analyticsRow.ad || "").trim();
  const keyword = String(analyticsRow.keyword || "").trim();
  const medium = String(analyticsRow.medium || "").trim();
  const campaignId = String(analyticsRow.campaign || "").trim();
  const contentId = String(analyticsRow.content || "").trim();

  if (ad.toLowerCase() === "ig" && medium.toLowerCase() === "paid") {
    const meta =
      metaIndexes.byAdId.get(contentId) ||
      metaIndexes.byCampaignId.get(campaignId) ||
      null;

    const adName =
      text(meta?.adName || meta?.ad_name || meta?.name) ||
      (contentId ? `META PAID / ad ${contentId}` : "META PAID");

    return {
      tracking_source: "META_PAID",
      ad_mapping: adName,
      campaign_id: campaignId || null,
      content_id: contentId || null,
      analytics_ad: ad || null,
      analytics_medium: medium || null,
      analytics_keyword: keyword || null,
      attribution_note:
        "Cafe24 Analytics direct paid tracking; product and paid amount are from the actual Cafe24 order."
    };
  }

  if (ad.toLowerCase() === "ig" && medium.toLowerCase() === "social") {
    return {
      tracking_source: "INSTAGRAM_ORGANIC",
      ad_mapping:
        contentId === "link_in_bio"
          ? "Instagram link in bio"
          : "Instagram organic",
      campaign_id: campaignId || null,
      content_id: contentId || null,
      analytics_ad: ad || null,
      analytics_medium: medium || null,
      analytics_keyword: keyword || null,
      attribution_note:
        "Cafe24 Analytics organic Instagram acquisition; actual Cafe24 order/item."
    };
  }

  if (ad === "네이버" && medium.toLowerCase() === "shopping") {
    return {
      tracking_source: "NAVER_SHOPPING",
      ad_mapping: "네이버 쇼핑",
      campaign_id: campaignId || null,
      content_id: contentId || null,
      analytics_ad: ad || null,
      analytics_medium: medium || null,
      analytics_keyword: keyword || null,
      attribution_note:
        "Cafe24 Analytics Naver Shopping acquisition; actual Cafe24 order/item."
    };
  }

  if (keyword) {
    return {
      tracking_source: "SEARCH",
      ad_mapping: `검색어: ${keyword}`,
      campaign_id: campaignId || null,
      content_id: contentId || null,
      analytics_ad: ad || null,
      analytics_medium: medium || null,
      analytics_keyword: keyword,
      attribution_note:
        "Cafe24 Analytics search acquisition; actual Cafe24 order/item."
    };
  }

  return {
    tracking_source: "UNATTRIBUTED",
    ad_mapping: "추적정보 없음",
    campaign_id: campaignId || null,
    content_id: contentId || null,
    analytics_ad: ad || null,
    analytics_medium: medium || null,
    analytics_keyword: keyword || null,
    attribution_note:
      "Cafe24 actual order/item; Analytics row exists but no acquisition values were recorded."
  };
}

// Filtered Orders queries establish membership; Analytics remains supplemental.
// Query metadata is internal and never masquerades as a Cafe24 payload field.
function inflowQueryAttribution(order, codes, analyticsRow, metaIndexes) {
  const supplemental = classifyAttribution(analyticsRow, metaIndexes, order);
  const conflict = codes.size > 1;
  const code = order._metaTrackingCode;
  const trusted = !conflict && Boolean(LEGACY_MAPPINGS[code]);
  const mapping = conflict ? "TRACKING CONFLICT / AD MAPPING NOT TRUSTED"
    : code === "meta_adv_video" ? "LEGACY / TRACKING UNRELIABLE"
    : LEGACY_MAPPINGS[code] || "UNMAPPED META TRACKING CODE";
  return {
    ...supplemental,
    tracking_source: trusted ? "META_INFLOW" : "META_INFLOW_UNTRUSTED",
    inflow_path: [...codes].sort().join(" | "),
    ad_mapping: mapping,
    trusted,
    attribution_note: `Cafe24 actual via inflow_path query; trusted=${trusted}; ${trusted ? "known mapping" : "ad mapping not trusted"}; Analytics supplemental only; not Meta-attributed product`
  };
}

export function buildActualProductsSold({
  data,
  analytics,
  metaAds = [],
  since,
  until
}) {
  if (
    !data ||
    data.ok === false ||
    data.error ||
    data.source === "csv_required" ||
    data.requiresCsv ||
    data.csvRequired ||
    !Array.isArray(data.orders)
  ) {
    return {
      available: false,
      reason:
        "Cafe24 actual orders unavailable; Meta-attributed revenue is never substituted.",
      rows: []
    };
  }

  const queryMode = data.source === "cafe24_inflow_queries";
  const codesByOrder = new Map();
  if (queryMode) {
    const queries = data.trackingQueries;
    const requiredCodes = [...Object.keys(LEGACY_MAPPINGS), "meta_adv_video"];
    const complete = Array.isArray(queries) && requiredCodes.every(code => queries.some(q => q.code === code))
      && queries.every(q => q && typeof q.code === "string" && q.code.startsWith("meta_") && q.ok === true && q.complete === true);
    if (!complete) return {
      available: false, rows: [],
      reason: "Cafe24 inflow query failed or incomplete; no Meta revenue substitution.",
      possibleLimitReached: queries?.some(q => q?.count >= 500) || false
    };
    const queried = new Set(queries.map(q => q.code));
    for (const order of data.orders) {
      const id = text(order?.order_id) || text(order?.orderId);
      const code = order?._metaTrackingCode;
      if (!id || typeof code !== "string" || !code.startsWith("meta_") || !queried.has(code)) return {
        available: false, rows: [], reason: "Missing verified Cafe24 inflow query provenance or order ID."
      };
      if (!codesByOrder.has(id)) codesByOrder.set(id, new Set());
      codesByOrder.get(id).add(code);
    }
  }

  const analyticsByOrderId = new Map(
    analyticsRows(analytics)
      .filter((row) => text(row?.order_id))
      .map((row) => [text(row.order_id), row])
  );

  const metaIndexes = buildMetaIndexes(metaAds);

  const rows = [];
  const seenOrders = new Set();
  let missingItems = 0;
  let missingDates = 0;

  const orderSummary = new Map();

  for (const order of data.orders) {
    const date = trustedCafe24OrderDate(order);

    if (!date) {
      missingDates += 1;
      continue;
    }

    if (date < since || date > until) continue;
    if (isCafe24CanceledOrRefunded(order)) continue;

    const orderId = text(order.order_id) || text(order.orderId);

    if (orderId && seenOrders.has(orderId)) continue;
    if (orderId) seenOrders.add(orderId);

    const rawItems = cafe24OrderItems(order);

    if (!rawItems.length) {
      missingItems += 1;
      continue;
    }

    const items = dedupeActiveItems(rawItems);
    if (!items.length) continue;

    const analyticsRow = orderId
      ? analyticsByOrderId.get(orderId)
      : undefined;

    const attribution = queryMode
      ? inflowQueryAttribution(order, codesByOrder.get(orderId), analyticsRow, metaIndexes)
      : classifyAttribution(analyticsRow, metaIndexes, order);

    const paidAmount = cafe24OrderAmount(order);
    const analyticsOrderAmount =
      Number(analyticsRow?.order_amount) || null;

    orderSummary.set(orderId || `NO_ID_${rows.length}`, {
      tracking_source: attribution.tracking_source,
      paidAmount
    });

    items.forEach((item, index) => {
      const quantity = cafe24ItemQuantity(item);

      rows.push({
        order_id: orderId,
        order_date: date,

        inflow_path: attribution.inflow_path || null,
        tracking_source: attribution.tracking_source,
        ad_mapping: attribution.ad_mapping,

        campaign_id: attribution.campaign_id || null,
        content_id: attribution.content_id || null,

        analytics_ad: attribution.analytics_ad || null,
        analytics_medium: attribution.analytics_medium || null,
        analytics_keyword: attribution.analytics_keyword || null,

        product_name:
          text(item.product_name) || text(item.name),
        product_no: text(item.product_no),
        product_code:
          text(item.variant_code) ||
          text(item.sku) ||
          text(item.product_code),

        option_size:
          text(item.option_value) ||
          text(item.option_name) ||
          text(item.option),

        quantity,
        product_amount: cafe24ItemAmount(item, quantity),

        actual_paid_amount:
          index === 0 ? paidAmount : null,

        analytics_order_amount:
          index === 0 ? analyticsOrderAmount : null,

        order_status:
          text(order.order_status) ||
          text(order.status) ||
          text(item.status_text) ||
          text(item.status_code),

        attribution_note: attribution.attribution_note
      });
    });
  }

  if (queryMode && (missingItems || missingDates || data.orders.some(order => order.itemFetchError))) return {
    available: false, rows: [], missingItems, missingDates,
    reason: "Incomplete Cafe24 order items or dates; no Meta revenue substitution."
  };
  const uniqueOrders = [...orderSummary.values()];

  return {
    available: true,
    rows,
    missingItems,
    missingDates,
    source: queryMode ? "cafe24_inflow_queries_plus_analytics" : "cafe24_actual_plus_analytics",
    possibleLimitReached: queryMode ? false : data.orders.length >= 500,

    summary: {
      actualOrderCount: uniqueOrders.length,

      metaPaidOrderCount: uniqueOrders.filter(
        (row) => ["META_PAID", "META_INFLOW"].includes(row.tracking_source)
      ).length,

      metaPaidRevenue: uniqueOrders
        .filter((row) => ["META_PAID", "META_INFLOW"].includes(row.tracking_source))
        .reduce(
          (sum, row) => sum + Number(row.paidAmount || 0),
          0
        ),

      unattributedOrderCount: uniqueOrders.filter(
        (row) => row.tracking_source === "UNATTRIBUTED"
      ).length
    }
  };
}
