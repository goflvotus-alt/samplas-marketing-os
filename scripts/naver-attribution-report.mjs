import {
  cafe24OrderAmount, cafe24OrderItems, cafe24ItemQuantity,
  firstCafe24MoneyOrNull, isCafe24CanceledOrRefunded, isCafe24CanceledItem
} from "./cafe24-order-amount.mjs";

const DAY = 86400000;
const KST = 9 * 3600000;
const UNKNOWN_BRAND = "UNMAPPED";
const adFields = ["spend", "impressions", "clicks", "platformRevenue"];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const shift = (day, by) => new Date(Date.parse(day) + by * DAY).toISOString().slice(0, 10);
const validDay = (day) => typeof day === "string" && datePattern.test(day) && Number.isFinite(Date.parse(day)) && shift(day, 0) === day;

export function previousPeriod(since, until) {
  if (!validDay(since) || !validDay(until) || until < since) throw new RangeError("Invalid date range");
  return { since: shift(since, -((Date.parse(until) - Date.parse(since)) / DAY + 1)), until: shift(since, -1) };
}

function dayOf(value) {
  if (validDay(value)) return value;
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(text)) return null;
  const normalized = /(?:Z|[+-]\d\d:?\d\d)$/i.test(text) ? text : text.replace(" ", "T") + "+09:00";
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? new Date(time + KST).toISOString().slice(0, 10) : null;
}

function daysIn(since, until) {
  const days = [];
  for (let day = since; day <= until; day = shift(day, 1)) days.push(day);
  return days;
}

function bucketOf(day, grain) {
  if (grain === "month") return day.slice(0, 7);
  if (grain === "week") return shift(day, -((new Date(day).getUTCDay() + 6) % 7));
  return day;
}

function completeDays(evidence, since, until) {
  const days = new Set();
  for (const span of evidence) {
    if (validDay(span)) {
      if (span >= since && span <= until) days.add(span);
      continue;
    }
    if (!span || span.ok !== true || span.completeness !== "COMPLETE" || !validDay(span.since) || !validDay(span.until)) continue;
    for (const day of daysIn(span.since > since ? span.since : since, span.until < until ? span.until : until)) days.add(day);
  }
  return days;
}

const identity = (id) => String(id ?? "").trim();
const orderKey = (row) => identity(row?.order_id ?? row?.orderId);
const normalized = (value) => String(value || "").trim().toLowerCase();
const compound = (x, y) => JSON.stringify([x, y]);
const lookup = (source, key) => source instanceof Map ? source.get(key) : Object.hasOwn(source, key) ? source[key] : undefined;

function latestOrders(orders) {
  const result = new Map();
  for (const row of orders) {
    const id = orderKey(row);
    if (!id) continue;
    const previous = result.get(id);
    const observedAt = (order) => Date.parse(order.observedAt || order.updated_date || order.modified_date || 0);
    if (!previous || observedAt(row) > observedAt(previous)) result.set(id, row);
  }
  return result;
}

function totalsForOrder(order) {
  const initial = firstCafe24MoneyOrNull([order.initial_order_amount?.payment_amount, order.initial_payment_amount]);
  const remaining = firstCafe24MoneyOrNull([order.actual_order_amount?.payment_amount, order.actual_payment_amount, order.payment_amount]);
  const explicitRefund = firstCafe24MoneyOrNull([order.refund_amount, order.total_refund_amount]);
  const paidState = normalized(order.paid);
  const unpaid = ["f", "false", "n", "0"].includes(paidState);
  const canceled = isCafe24CanceledOrRefunded(order);
  const partial = normalized(order.canceled ?? order.cancelled) === "m";
  const claimPending = cafe24OrderItems(order).some((item) => /^(C00|C10|C11|R00|R10|R12|R13|E00|E10|E12|E13)$/.test(item.order_status));
  if (unpaid) return { paid: 0, refund: 0, net: 0, status: "UNPAID" };
  if (claimPending) return { paid: initial ?? remaining, refund: null, net: null, status: "PENDING" };
  if (canceled) {
    const paid = initial ?? explicitRefund;
    return { paid, refund: paid, net: paid === null ? null : 0, status: paid === null ? "UNVERIFIED" : "CANCELED" };
  }
  if (remaining === null) return { paid: initial, refund: null, net: null, status: "UNVERIFIED" };
  let net = cafe24OrderAmount(order);
  if (!partial && explicitRefund > 0) {
    if (initial !== null && initial - remaining === explicitRefund) net = remaining;
    else if (initial === null || initial === remaining) net = Math.max(0, remaining - explicitRefund);
    else return { paid: initial, refund: null, net: null, status: "UNVERIFIED" };
  }
  const paid = partial ? initial ?? (explicitRefund === null ? null : net + explicitRefund) : initial ?? (explicitRefund > 0 ? net + explicitRefund : net);
  const refund = paid === null || paid < net ? null : paid - net;
  return { paid, refund, net, status: refund === null ? "UNVERIFIED" : partial || refund ? "PARTIAL_REFUND" : "VERIFIED" };
}

function orderDetail(order, entry, id, day, customerTypes, catalog) {
  const result = totalsForOrder(order);
  const items = cafe24OrderItems(order).map((item) => {
    const productNo = identity(item.product_no ?? item.productNo);
    const product = lookup(catalog, productNo);
    return {
      productNo: productNo || null, name: String(item.product_name || item.productName || item.name || productNo),
      quantity: cafe24ItemQuantity(item), brand: product?.brandName || product?.brandCode || item.brand_name || item.brand_code || null,
      canceled: isCafe24CanceledItem(item)
    };
  });
  const classification = lookup(customerTypes, id);
  const customerType = typeof classification === "string" ? classification : classification?.type || "UNVERIFIED";
  const { member_id: memberId } = order;
  return {
    orderId: id, day, acquisitionBrand: entry.brandName || entry.brandCode || UNKNOWN_BRAND, brandCode: entry.brandCode || UNKNOWN_BRAND,
    purchaseBrands: [...new Set(items.filter((item) => !item.canceled && item.brand).map((item) => item.brand))],
    items, customerType, ...result, memberId: identity(memberId)
  };
}

function aggregate({ days, ads, linked, trackingIssues, adDays, verifiedDays, generatedDay, trackedDays }) {
  const metrics = {};
  for (const field of adFields) {
    const observed = ads.map((row) => row[field]).filter(Number.isFinite);
    metrics[field] = observed.length ? observed.reduce((sum, value) => sum + value, 0) : !ads.length && days.every((day) => adDays.has(day)) ? 0 : null;
  }
  const adStatus = days.every((day) => adDays.has(day)) && ads.every((row) => adFields.every((field) => Number.isFinite(row[field])))
    ? "VERIFIED" : "UNVERIFIED";
  const fullyTracked = days.every((day) => trackedDays.has(day));
  const complete = fullyTracked && days.every((day) => verifiedDays.has(day) && (!generatedDay || day < generatedDay)) && !trackingIssues;
  const trackingStatus = complete ? "VERIFIED" : !fullyTracked || trackingIssues ? "UNVERIFIED" : "PENDING";
  const validOrders = linked.filter((order) => order.net > 0);
  const counts = {};
  for (const [key, type] of [["newCustomers", "NEW"], ["repeatCustomers", "REPEAT"]]) {
    counts[key] = new Set(validOrders.filter((order) => order.customerType === type && order.memberId).map((order) => order.memberId)).size;
  }
  const known = {
    orders: validOrders.length,
    paid: linked.reduce((sum, order) => sum + (order.paid ?? 0), 0),
    refund: linked.reduce((sum, order) => sum + (order.refund ?? 0), 0),
    net: linked.reduce((sum, order) => sum + (order.net ?? 0), 0),
    ...counts
  };
  const report = Object.fromEntries(Object.keys(known).map((key) => [key, complete ? known[key] : null]));
  const customerHistoryIncomplete = validOrders.some((order) => !["NEW", "REPEAT", "GUEST"].includes(order.customerType)
    || (order.customerType !== "GUEST" && !order.memberId));
  if (customerHistoryIncomplete) {
    report.newCustomers = null;
    report.repeatCustomers = null;
  }
  return {
    ...metrics, ...report, known,
    ctr: metrics.impressions > 0 && metrics.clicks !== null ? metrics.clicks / metrics.impressions : null,
    cpc: metrics.clicks > 0 && metrics.spend !== null ? metrics.spend / metrics.clicks : null,
    roas: complete && adStatus === "VERIFIED" && metrics.spend > 0 ? known.net / metrics.spend : null,
    adStatus, trackingStatus, customerStatus: customerHistoryIncomplete ? "UNVERIFIED" : trackingStatus
  };
}

export function buildNaverAttributionReport({
  since, until, grain = "day", brand = "", generatedAt = new Date().toISOString(),
  mapping = [], adRows = [], adCoverage = [], totalAdRows, totalAdCoverage, analyticsBatches = [], orders = [], ordersCoverage = [], customerTypes = {}, catalog = {}
}) {
  previousPeriod(since, until);
  if (!["day", "week", "month"].includes(grain) || Date.parse(until) - Date.parse(since) > 365 * DAY) throw new RangeError("Invalid report period or grain");
  const days = daysIn(since, until);
  const generatedDay = dayOf(generatedAt);
  const inPeriod = (day) => Boolean(day && day >= since && day <= until);
  const byContent = new Map();
  const byAd = new Map();
  const brands = new Map();
  const tracked = new Map();
  for (const entry of mapping) {
    const code = entry.brandCode || UNKNOWN_BRAND;
    brands.set(code, entry.brandName || code);
    if (!validDay(entry.startDay)) continue;
    if (entry.content && byContent.has(entry.content)) throw new Error("Duplicate attribution tag");
    if (entry.content) byContent.set(entry.content, entry);
    for (const id of new Set([entry.oldAdId, entry.newAdId].filter(Boolean))) {
      if (byAd.has(id)) throw new Error("Duplicate attribution ad ID");
      byAd.set(id, entry);
    }
    if (entry.content && (!tracked.has(code) || tracked.get(code) > entry.startDay)) tracked.set(code, entry.startDay);
  }

  const admin = latestOrders(orders);
  const analyticsDays = completeDays(analyticsBatches, since, until);
  const orderDays = completeDays(ordersCoverage, since, until);
  const joinedAnalytics = new Set();
  const tagsByOrder = new Map();
  const unresolvedDays = new Set();
  for (const batch of analyticsBatches) {
    if (batch.ok !== true) continue;
    for (const row of batch.rows || []) {
      const id = orderKey(row);
      const order = admin.get(id);
      const day = dayOf(row.order_date) || dayOf(order?.order_date || order?.orderDate);
      if (!inPeriod(day) || !id) continue;
      joinedAnalytics.add(compound(id, day));
      let tags = tagsByOrder.get(id);
      if (!tags) tagsByOrder.set(id, tags = new Map());
      const source = normalized(row.ad ?? row.utm_source);
      const medium = normalized(row.medium ?? row.utm_medium);
      const campaign = normalized(row.campaign ?? row.utm_campaign);
      const content = identity(row.content ?? row.utm_content);
      const entry = ["naver", "네이버"].includes(source) && medium === "cpc" && campaign === "powerlink" ? byContent.get(content) : null;
      if (["naver", "네이버"].includes(source) && medium === "cpc" && campaign === "powerlink" && !entry) unresolvedDays.add(day);
      const fingerprint = JSON.stringify([day, source === "네이버" ? "naver" : source, medium, campaign, content]);
      tags.set(fingerprint, { entry, day });
    }
  }
  for (const [id, order] of admin) {
    const day = dayOf(order.order_date || order.orderDate || order.ordered_date || order.order_timestamp);
    if (!inPeriod(day) || isCafe24CanceledOrRefunded(order) || ["f", "false", "n", "0"].includes(normalized(order.paid))) continue;
    if (!joinedAnalytics.has(compound(id, day))) unresolvedDays.add(day);
  }

  const linked = [];
  for (const [id, tags] of tagsByOrder) {
    const attributable = [...tags.values()].filter(({ entry, day }) => entry && day >= entry.startDay);
    if (!attributable.length) continue;
    if (tags.size > 1 || !admin.has(id)) {
      for (const { day } of attributable) unresolvedDays.add(day);
      continue;
    }
    const [{ entry, day }] = attributable;
    const order = admin.get(id);
    if (entry.registeredAt && day === entry.startDay) {
      const registration = Date.parse(entry.registeredAt);
      const rawTime = String(order.order_date || order.orderDate || "");
      const orderTime = /[T ]\d/.test(rawTime)
        ? Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/i.test(rawTime) ? rawTime : rawTime.replace(" ", "T") + "+09:00")
        : NaN;
      if (!Number.isFinite(orderTime) || orderTime < registration) {
        unresolvedDays.add(day);
        continue;
      }
    }
    const detail = orderDetail(order, entry, id, day, customerTypes, catalog);
    if (["PENDING", "UNVERIFIED"].includes(detail.status)) unresolvedDays.add(day);
    linked.push(detail);
  }

  const uniqueAds = new Map();
  const uncertainAdDays = new Set();
  for (const raw of adRows) {
    const day = dayOf(raw.day);
    const id = identity(raw.id);
    if (!inPeriod(day) || !id) continue;
    const entry = byAd.get(id);
    const code = entry?.brandCode || raw.brandCode || UNKNOWN_BRAND;
    brands.set(code, entry?.brandName || raw.brandName || brands.get(code) || code);
    const key = compound(id, day);
    const existing = uniqueAds.get(key);
    if (existing && (existing.brandCode !== code || adFields.some((field) => existing[field] !== raw[field]))) {
      uniqueAds.set(key, { conflict: true });
      uncertainAdDays.add(day);
    } else if (!existing) uniqueAds.set(key, { ...raw, day, brandCode: code });
  }

  const ads = [...uniqueAds.values()].filter((ad) => !ad.conflict);
  const verifiedDays = new Set(days.filter((day) => analyticsDays.has(day) && orderDays.has(day)));
  const scopeStart = [...tracked.values()].sort().at(-1);
  const metricsFor = (slice, code) => {
    const forSlice = (row) => row.day >= slice[0] && row.day <= slice.at(-1) && (!code || row.brandCode === code);
    const useCampaign = !code && Array.isArray(totalAdRows);
    const adDays = completeDays((useCampaign ? totalAdCoverage || [] : adCoverage).filter((span) => typeof span === "string" || !span.brandCode || span.brandCode === code), slice[0], slice.at(-1));
    if (!useCampaign) for (const day of uncertainAdDays) adDays.delete(day);
    const trackingStart = code ? tracked.get(code) : scopeStart;
    return aggregate({
      days: slice, ads: (useCampaign ? totalAdRows : ads).filter(forSlice), linked: linked.filter(forSlice), adDays,
      trackingIssues: slice.some((day) => unresolvedDays.has(day)), verifiedDays, generatedDay,
      trackedDays: new Set(slice.filter((day) => trackingStart && day >= trackingStart))
    });
  };
  const buckets = new Map();
  for (const day of days) {
    const key = bucketOf(day, grain);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(day);
  }
  const totals = metricsFor(days, brand);
  const rows = [...buckets].map(([key, slice]) => ({ key, label: key, since: slice[0], until: slice.at(-1), brandCode: brand || null, ...metricsFor(slice, brand) }));
  const brandRows = [...brands].filter(([code]) => !brand || brand === code).map(([code, name]) => ({
    key: code, label: name, since, until, brandCode: code, ...metricsFor(days, code)
  }));
  return {
    ok: true, period: { since, until }, generatedAt, trackingStatus: totals.trackingStatus,
    brands: [...brands].map(([code, name]) => ({ code, name })), totals, rows, brandRows,
    orders: linked.filter((order) => !brand || order.brandCode === brand)
      .sort((a, b) => b.day.localeCompare(a.day) || a.orderId.localeCompare(b.orderId))
      .map(({ memberId, ...order }) => order)
  };
}
