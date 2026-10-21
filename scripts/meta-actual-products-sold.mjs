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

    const key = text(item.order_item_code) || text(item.item_no) || [
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

  // Ad name -> distinct ad IDs among the period's delivering ads (Insights returns only those).
  const byName = new Map();
  for (const [adId, row] of byAdId) {
    const name = adNameKey(row?.adName || row?.ad_name || row?.name);
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(adId);
  }

  return { byAdId, byCampaignId, byName };
}

const adNameKey = (value) => text(value)?.normalize("NFC").trim() || null;
const PAID_META_SOURCES = new Set(["ig", "meta"]);
const isMetaPaidRow = (row) =>
  PAID_META_SOURCES.has(String(row?.ad || "").trim().toLowerCase()) &&
  String(row?.medium || "").trim().toLowerCase() === "paid";

// G1: Cafe24 Analytics recorded a paid visit with an ad ID that delivered in the period.
// G2: only the ad name matches, and exactly one delivering ad has that name (candidate, never summed).
// G3: paid Meta visit whose ID/name matches no delivering ad, or matches several (never summed).
function gradeMetaPaid(analyticsRow, metaIndexes) {
  const content = String(analyticsRow.content || "").trim();
  const byId = metaIndexes.byAdId.get(content);
  if (byId) {
    return { tracking_source: "META_PAID", attribution_grade: "G1_AD_ID", matched_ad_id: content,
      ad_mapping: text(byId.adName || byId.ad_name || byId.name) || `META PAID / ad ${content}`,
      attribution_note: "Cafe24 광고 ID 유입 확인: Analytics paid visit carried a delivering ad ID. Not a one-to-one match with a Meta purchase event." };
  }
  const ids = metaIndexes.byName.get(adNameKey(content)) || new Set();
  if (ids.size === 1) {
    const [adId] = ids;
    const row = metaIndexes.byAdId.get(adId);
    return { tracking_source: "META_PAID_NAME", attribution_grade: "G2_AD_NAME", matched_ad_id: adId,
      ad_mapping: text(row?.adName || row?.ad_name || row?.name),
      attribution_note: "광고명 유일 일치 후보: Analytics recorded the ad name, not its ID. Candidate only; excluded from confirmed revenue." };
  }
  return { tracking_source: "META_PAID_UNMATCHED", attribution_grade: "G3_UNMATCHED", matched_ad_id: null,
    ad_mapping: ids.size > 1 ? "AD NAME NOT UNIQUE" : content ? `UNMATCHED META PAID / ${content}` : "UNMATCHED META PAID",
    attribution_note: ids.size > 1
      ? "Paid Meta visit; several delivering ads share this name. Excluded from confirmed revenue."
      : "Paid Meta visit; no delivering ad has this ID or name. Excluded from confirmed revenue." };
}

const CLAIM_REQUESTED = /(취소|반품|교환)\s*(신청|접수|요청|보류)/;
// Claims still open keep their canonical amount but are shown apart from kept sales. A paid,
// uncanceled order whose canonical payment is 0 (seen on Naver Pay) is unverified, never 0원.
function orderAmountStatus(order, items, paidAmount) {
  if (paidAmount === 0 && String(order?.paid || "").trim().toUpperCase() === "T") return "PAYMENT_UNVERIFIED";
  // status_text is authoritative (a withdrawn claim keeps its request date); dates only when it is absent.
  const open = items.some((item) => item?.status_text
    ? CLAIM_REQUESTED.test(String(item.status_text))
    : Boolean(item?.cancel_request_date || item?.return_request_date || item?.exchange_request_date));
  return open ? "CLAIM_IN_PROGRESS" : "NORMAL";
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

function classifyAttribution(analyticsRow, metaIndexes, order, adGrades = false) {
  if (adGrades && analyticsRow && isMetaPaidRow(analyticsRow)) {
    return {
      ...gradeMetaPaid(analyticsRow, metaIndexes),
      campaign_id: String(analyticsRow.campaign || "").trim() || null,
      content_id: String(analyticsRow.content || "").trim() || null,
      analytics_ad: String(analyticsRow.ad || "").trim() || null,
      analytics_medium: String(analyticsRow.medium || "").trim() || null,
      analytics_keyword: String(analyticsRow.keyword || "").trim() || null
    };
  }
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
    // A campaign can contain several ads; never assign its first ad to an unknown content ID.
    const meta = metaIndexes.byAdId.get(contentId) || null;

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
function inflowQueryAttribution(order, codes, analyticsRow, metaIndexes, adGrades = false) {
  const supplemental = classifyAttribution(analyticsRow, metaIndexes, order, adGrades);
  const conflict = codes.size > 1;
  const code = order._metaTrackingCode;
  const trusted = !conflict && Boolean(LEGACY_MAPPINGS[code]);
  const mapping = conflict ? "TRACKING CONFLICT / AD MAPPING NOT TRUSTED"
    : code === "meta_adv_video" ? "LEGACY / TRACKING UNRELIABLE"
    : LEGACY_MAPPINGS[code] || "UNMAPPED META TRACKING CODE";
  return {
    ...supplemental,
    tracking_source: trusted ? "META_INFLOW" : "META_INFLOW_UNTRUSTED",
    ...(adGrades ? { attribution_grade: trusted ? "INFLOW_CODE" : "INFLOW_UNTRUSTED" } : {}),
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
  until,
  // Weekly reports grade paid Meta visits against the period's ads; other callers keep the old rule.
  adGrades = false
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
    const complete = Array.isArray(queries) && requiredCodes.every(code => queries.some(q => q?.code === code))
      && queries.every(q => q && typeof q.code === "string" && q.code.startsWith("meta_") && q.ok === true && q.complete === true);
    if (!complete) return {
      available: false, rows: [],
      reason: "Cafe24 inflow query failed or incomplete; no Meta revenue substitution.",
      possibleLimitReached: Array.isArray(queries) && queries.some(q => q?.count >= 500)
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
  let candidateOrders = data.orders, candidateMissingAdmin = 0;
  if (queryMode && Object.hasOwn(data, "analyticsOrders")) {
    const acquisition = analyticsRows(analytics);
    if (!data.analyticsOrdersComplete || !Array.isArray(data.analyticsOrders) || !analytics || analytics.ok === false || (!Array.isArray(analytics.orderdetails) && !Array.isArray(analytics.data?.orderdetails)) || acquisition.length >= 100) return {
      available: false, rows: [], reason: "Cafe24 Analytics or actual order coverage incomplete; no Meta revenue substitution."
    };
    const paidIds = new Set(acquisition.filter(row => String(row.ad || '').toLowerCase() === 'ig' && String(row.medium || '').toLowerCase() === 'paid').map(row => text(row.order_id)).filter(Boolean));
    const actualIds = new Set(data.analyticsOrders.map(order => text(order?.order_id) || text(order?.orderId)));
    if ([...paidIds].some(id => !actualIds.has(id))) return { available: false, rows: [], reason: "Analytics paid order has no matching Admin order; actual sales unavailable." };
    // meta/paid visits are graded candidates only; one without an Admin order is counted, never fatal.
    const namedIds = adGrades ? new Set(acquisition.filter(isMetaPaidRow).map(row => text(row.order_id)).filter(id => id && !paidIds.has(id))) : new Set();
    candidateMissingAdmin = [...namedIds].filter(id => !actualIds.has(id)).length;
    candidateOrders = [...data.orders, ...data.analyticsOrders.filter(order => { const id = text(order?.order_id) || text(order?.orderId); return paidIds.has(id) || namedIds.has(id); })];
  }

  const rows = [];
  const seenOrders = new Set();
  let missingItems = 0;
  let missingDates = 0;

  const orderSummary = new Map();

  for (const order of candidateOrders) {
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

    const attribution = queryMode && codesByOrder.has(orderId)
      ? inflowQueryAttribution(order, codesByOrder.get(orderId), analyticsRow, metaIndexes, adGrades)
      : classifyAttribution(analyticsRow, metaIndexes, order, adGrades);

    const paidAmount = cafe24OrderAmount(order);
    const analyticsOrderAmount =
      Number(analyticsRow?.order_amount) || null;
    const amountStatus = orderAmountStatus(order, items, paidAmount);

    orderSummary.set(orderId || `NO_ID_${rows.length}`, {
      tracking_source: attribution.tracking_source,
      attribution_grade: attribution.attribution_grade || null,
      amount_status: amountStatus,
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

        attribution_note: attribution.attribution_note,
        ...(adGrades ? {
          attribution_grade: attribution.attribution_grade || null,
          matched_ad_id: attribution.matched_ad_id || null,
          amount_status: amountStatus
        } : {})
      });
    });
  }

  if (queryMode && (missingItems || missingDates || candidateOrders.some(order => order.itemFetchError))) return {
    available: false, rows: [], missingItems, missingDates,
    reason: "Incomplete Cafe24 order items or dates; no Meta revenue substitution."
  };
  const uniqueOrders = [...orderSummary.values()];
  const confirmed = uniqueOrders.filter((row) => ["META_PAID", "META_INFLOW"].includes(row.tracking_source));
  const paid = (list) => list.reduce((sum, row) => sum + Number(row.paidAmount || 0), 0);
  const byStatus = (status) => confirmed.filter((row) => row.amount_status === status);

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
      ).length,

      // metaPaidRevenue keeps its issued meaning (every confirmed order); these only split it for display.
      ...(adGrades ? {
        grades: {
          adIdCount: confirmed.filter((row) => row.attribution_grade === "G1_AD_ID").length,
          inflowCodeCount: confirmed.filter((row) => row.tracking_source === "META_INFLOW").length,
          normalCount: byStatus("NORMAL").length,
          normalRevenue: paid(byStatus("NORMAL")),
          claimCount: byStatus("CLAIM_IN_PROGRESS").length,
          claimRevenue: paid(byStatus("CLAIM_IN_PROGRESS")),
          paymentUnverifiedCount: byStatus("PAYMENT_UNVERIFIED").length,
          adNameCandidateCount: uniqueOrders.filter((row) => row.attribution_grade === "G2_AD_NAME").length,
          unmatchedPaidCount: uniqueOrders.filter((row) => row.attribution_grade === "G3_UNMATCHED").length,
          candidateMissingAdmin
        }
      } : {})
    }
  };
}
