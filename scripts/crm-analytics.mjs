// CRM analytics over the existing Cafe24 order caches (read-only).
//
// Definitions (approved 2026-11-14):
// - Valid purchase: Marketing OS canonical amount (cafe24OrderAmount) > 0. Full cancels score 0, partial
//   cancels/returns keep the remaining amount, Naver Pay prepaid orders are restored exactly as the
//   existing sales total does. Amounts here are always that canonical amount.
// - First real purchase: a member's earliest valid purchase. Cafe24 `first_order` marks the first order
//   *placed* (a fully canceled first order keeps T), so it is only used to prove the history is complete:
//   a member's first valid purchase is VERIFIED only when the member's first_order=T order is in the data
//   and every day between that order and the first valid purchase is covered by the caches.
// - Personal-payment orders (개인결제창) are separated from customer analysis. Guests (no member_id) and
//   Naver Pay guest orders are reported as unidentified buckets.
// - Analytics order details only supply the acquisition channel, joined by order_id. Their amount is
//   never used as revenue.
//
// Nothing here writes files. Member ids are pseudonymised with HMAC-SHA256 before grouping and never
// leave this module; outputs are aggregates only.
import { createHmac, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadCanonicalCafe24OrderCache } from "./cafe24-order-cache.mjs";
import { cafe24OrderAmount, cafe24OrderItems, trustedCafe24OrderDate } from "./cafe24-order-amount.mjs";

export const CRM_WINDOWS = [30, 60, 90, 180, 365];
const DAY_MS = 86_400_000;
const OPEN_CLAIM_STATUS = /^(C00|C10|C11|R00|R10|R12|R13|E00|E10|E12|E13)$/;

const kstDate = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const monthEnd = (month) => addDays(`${nextMonth(month)}-01`, -1);
function nextMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
const orderTime = (order) => Date.parse(order.order_date) || Date.parse(`${trustedCafe24OrderDate(order)}T00:00:00+09:00`);
const isPersonalPayment = (order) => cafe24OrderItems(order).some((item) => String(item?.product_name || item?.productName || "").includes("개인결제"));

// One key per process unless CRM_PSEUDONYM_KEY is set. Nothing pseudonymised is persisted, so an ephemeral
// key is enough; a stable secret key is only needed if customer-level tables are ever stored.
export function createPseudonymizer(secret = process.env.CRM_PSEUDONYM_KEY) {
  const key = secret ? Buffer.from(secret) : randomBytes(32);
  return (memberId) => createHmac("sha256", key).update(String(memberId)).digest("hex");
}

// ---------------------------------------------------------------------------------------------------------
// Sources

// Monthly tracking results (SAMPLAS_MONTHLY_TRACKING_*.json) carry a later Admin order snapshot and the
// Analytics order details. Searched recursively under the given directories.
async function findTrackingFiles(dir, depth = 3) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) out.push(...await findTrackingFiles(path, depth - 1));
    else if (entry.isFile() && /^SAMPLAS_MONTHLY_TRACKING_.*\.json$/.test(entry.name)) out.push(path);
  }
  return out;
}

export async function loadTrackingSnapshots(dirs = []) {
  const snapshots = [];
  for (const dir of dirs) {
    for (const path of await findTrackingFiles(dir)) {
      try {
        const body = JSON.parse(await readFile(path, "utf8"));
        const cafe24 = body?.data?.cafe24 || {};
        snapshots.push({
          name: path.split("/").pop(),
          observedAt: Date.parse(body?.generatedAt || body?.meta?.generatedAt || "") || (await stat(path)).mtimeMs,
          orders: Array.isArray(cafe24.orders) ? cafe24.orders : [],
          analyticsBatches: (cafe24.analyticsBatches || []).map((b) => ({
            since: b.since, until: b.until, ok: b.ok === true, completeness: b.coverage?.completeness || "UNKNOWN",
            rows: Array.isArray(b.data?.orderdetails) ? b.data.orderdetails : []
          }))
        });
      } catch {
        // Unreadable snapshot: skipped and therefore not counted as coverage.
      }
    }
  }
  return snapshots;
}

// A source covers only the days between its first and last returned order (never past the day it was
// observed). File ranges alone are not trusted: cafe24-proxy-orders-2025-12-01_2026-03-31 starts in January.
// ponytail: span heuristic assumes at least one order per covered stretch; fine for a shop with daily orders.
function sourceSpan(orders) {
  const dates = orders.map(trustedCafe24OrderDate).filter(Boolean).sort();
  return dates.length ? { since: dates[0], until: dates.at(-1) } : null;
}

export function buildCrmDataset({ cacheRecords = [], snapshots = [], pseudonymize = createPseudonymizer() } = {}) {
  const candidates = [];
  const spans = [];
  const byFile = new Map();
  for (const record of cacheRecords) {
    if (record.type === "csv") continue; // CSV caches have no member_id; the same orders exist in API caches.
    const list = byFile.get(record.file.name) || [];
    list.push(record.order);
    byFile.set(record.file.name, list);
    candidates.push({ order: record.order, observedAt: record.file.mtimeMs, source: "cache" });
  }
  for (const [name, orders] of byFile) {
    const file = cacheRecords.find((r) => r.file.name === name).file;
    const span = sourceSpan(orders);
    if (span) spans.push({ ...span, source: "cache", observedAt: file.mtimeMs });
  }
  for (const snap of snapshots) {
    for (const order of snap.orders) candidates.push({ order, observedAt: snap.observedAt, source: "snapshot" });
    const span = sourceSpan(snap.orders);
    if (span) spans.push({ ...span, source: "snapshot", observedAt: snap.observedAt });
  }

  // Latest observation of each order wins (a later snapshot carries later cancels and late orders).
  const latest = new Map();
  let duplicateObservations = 0;
  for (const c of candidates) {
    const id = c.order?.order_id;
    if (!id || !trustedCafe24OrderDate(c.order)) continue;
    const prev = latest.get(id);
    if (prev) duplicateObservations++;
    if (!prev || c.observedAt > prev.observedAt || (c.observedAt === prev.observedAt && c.source === "snapshot")) latest.set(id, c);
  }

  // Tracking snapshots strip member_id/first_order. Identity never changes for an order id, so it is taken
  // from any observation that has it; amounts and states always come from the latest observation.
  const identity = new Map();
  for (const c of candidates) {
    if (c.order && "member_id" in c.order && !identity.has(String(c.order.order_id))) {
      identity.set(String(c.order.order_id), { member_id: c.order.member_id, first_order: c.order.first_order ?? null });
    }
  }

  const orders = [...latest.values()].map(({ order, observedAt, source }) => {
    const amount = cafe24OrderAmount(order);
    const who = identity.get(String(order.order_id)) || null;
    const memberId = String(who?.member_id || "").trim();
    return {
      id: String(order.order_id),
      date: trustedCafe24OrderDate(order),
      time: orderTime(order),
      month: trustedCafe24OrderDate(order).slice(0, 7),
      amount,
      valid: amount > 0,
      firstOrderFlag: who?.first_order ?? null,
      identityKnown: Boolean(who),
      member: memberId ? pseudonymize(memberId) : null,
      market: order.market_id || null,
      personalPayment: isPersonalPayment(order),
      canceled: String(order.canceled || ""),
      unpaid: String(order.paid || "") === "F",
      openClaims: cafe24OrderItems(order).filter((i) => OPEN_CLAIM_STATUS.test(String(i?.order_status || ""))).length,
      observedAt,
      source
    };
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  const analytics = new Map();
  const analyticsSpans = [];
  for (const snap of [...snapshots].sort((a, b) => a.observedAt - b.observedAt)) {
    for (const batch of snap.analyticsBatches) {
      if (batch.ok && batch.completeness === "COMPLETE") analyticsSpans.push({ since: batch.since, until: batch.until });
      // Only the fields used downstream are kept (channel + amount for the mismatch check).
      for (const row of batch.rows) if (row?.order_id) analytics.set(String(row.order_id), { ad: row.ad, medium: row.medium, order_amount: row.order_amount });
    }
  }

  // Raw snapshot orders are not retained: only what the data-quality report needs.
  const snapshotSummaries = snapshots.map((s) => ({ name: s.name, observedAt: s.observedAt, months: new Set(s.orders.map((o) => String(o.order_date || "").slice(0, 7))) }));
  return { orders, spans, analytics, analyticsSpans, duplicateObservations, snapshots: snapshotSummaries, cacheFileCount: byFile.size };
}

// Same winners as loadCanonicalCafe24OrderCache, without JSON-parsing every cache file.
// Phase 1 scans each file's text for order ids only (strings, no object graph) and finds, per id, the
// highest-priority file (fileEnd, then mtime: the canonical order). Phase 2 fully parses only files that
// hold at least one such id and runs the canonical comparison on them. On 2026-11-14 that was 5 of 309
// files. A file whose id scan cannot be trusted (id count != "order_date" key count) is always parsed,
// and any id whose best file did not produce a valid record falls back to the full canonical loader.
const CACHE_FILE_PATTERN = /^cafe24-(csv-|proxy-)?orders-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/;
const ID_PATTERN = /"order_id"\s*:\s*"([^"]+)"/g;
const ORDER_DATE_KEY = /"order_date"\s*:/g;
const priority = (a, b) => a.fileEnd.localeCompare(b.fileEnd) || a.mtimeMs - b.mtimeMs;
function completenessOf(value) {
  if (value == null || value === "") return 0;
  if (Array.isArray(value)) return value.reduce((s, v) => s + completenessOf(v), value.length ? 1 : 0);
  if (typeof value === "object") return Object.values(value).reduce((s, v) => s + completenessOf(v), 1);
  return 1;
}

// Streams a file in 64 KB chunks (below V8 large-object size, so chunks die young) so phase 1 never holds a whole cache file in memory. Matches are
// counted on chunk + carry-over; the carry keeps the unfinished tail (ids and keys are < 200 chars).
async function scanOrderIds(path) {
  const ids = [];
  let dateKeys = 0, carry = "";
  for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 16 })) {
    const text = carry + chunk;
    let consumed = 0;
    // Ids are copied for the same reason: a regex capture is a slice of the chunk it came from.
    for (const m of text.matchAll(ID_PATTERN)) { ids.push(Buffer.from(m[1]).toString()); consumed = m.index + m[0].length; }
    for (const m of text.matchAll(ORDER_DATE_KEY)) consumed = Math.max(consumed, m.index + m[0].length), dateKeys++;
    // Copy the tail: a plain slice is a V8 sliced string that keeps the whole chunk (and, through the
    // next concatenation, every earlier chunk) alive.
    carry = Buffer.from(text.slice(Math.max(consumed, text.length - 200))).toString();
  }
  return { ids, dateKeys };
}

export async function loadCacheWinners(workDir) {
  const files = [];
  for (const name of await readdir(workDir).catch(() => [])) {
    const match = name.match(CACHE_FILE_PATTERN);
    if (!match) continue;
    try {
      files.push({ name, fileStart: match[2], fileEnd: match[3], type: match[1] === "csv-" ? "csv" : "api", mtimeMs: (await stat(join(workDir, name))).mtimeMs });
    } catch { /* removed between readdir and stat */ }
  }
  files.sort((a, b) => priority(a, b) || a.name.localeCompare(b.name));

  const best = new Map(); // id -> [file indexes tied at the top priority]
  const mustParse = new Set();
  for (const [index, file] of files.entries()) {
    let scan;
    try { scan = await scanOrderIds(join(workDir, file.name)); } catch { continue; }
    const { ids } = scan;
    if (ids.length !== scan.dateKeys) mustParse.add(index);
    for (const id of ids) {
      const top = best.get(id);
      const cmp = top ? priority(file, files[top[0]]) : 1;
      if (cmp > 0) best.set(id, [index]);
      else if (cmp === 0) top.push(index);
    }
  }
  const needed = new Set(mustParse);
  for (const list of best.values()) for (const i of list) needed.add(i);

  const keyed = new Map();
  for (const index of [...needed].sort((a, b) => a - b)) {
    const file = files[index];
    let data;
    try { data = JSON.parse(await readFile(join(workDir, file.name), "utf8")); } catch { continue; }
    for (const [i, order] of (data?.orders || []).entries()) {
      const orderDate = trustedCafe24OrderDate(order);
      const id = order?.order_id == null || order.order_id === "" ? null : String(order.order_id);
      if (!orderDate || !id) continue; // unkeyed orders cannot be analysed per customer either
      const record = { order, orderDate, type: file.type, file, index: i, completeness: completenessOf(order) };
      const prev = keyed.get(id);
      if (!prev || file.fileEnd > prev.file.fileEnd || (file.fileEnd === prev.file.fileEnd && file.mtimeMs > prev.file.mtimeMs) ||
          (file.fileEnd === prev.file.fileEnd && file.mtimeMs === prev.file.mtimeMs && record.completeness > prev.completeness)) {
        keyed.set(id, record);
      }
    }
    data = null;
  }
  // Safety net: every scanned id must have been won by one of its best files.
  for (const [id, list] of best) {
    const won = keyed.get(id);
    if (!won || !list.some((i) => files[i] === won.file)) {
      const full = await loadCanonicalCafe24OrderCache({ workDir });
      return { records: full.records, filesScanned: files.length, filesParsed: files.length, fallback: true };
    }
  }
  return { records: [...keyed.values()], filesScanned: files.length, filesParsed: needed.size, fallback: false };
}

export async function loadCrmDataset({ workDir, snapshotDirs = [] } = {}) {
  const cache = await loadCacheWinners(workDir);
  const snapshots = await loadTrackingSnapshots(snapshotDirs);
  const ds = buildCrmDataset({ cacheRecords: cache.records, snapshots });
  ds.load = { filesScanned: cache.filesScanned, filesParsed: cache.filesParsed, fallback: cache.fallback };
  return ds;
}

// ---------------------------------------------------------------------------------------------------------
// Coverage

function coveredDays(spans) {
  const days = new Set();
  for (const s of spans) for (let d = s.since; d <= s.until; d = addDays(d, 1)) days.add(d);
  return days;
}
function gapsBetween(days, since, until) {
  const gaps = [];
  let start = null;
  for (let d = since; d <= until; d = addDays(d, 1)) {
    if (!days.has(d)) start ??= d;
    else if (start) { gaps.push({ since: start, until: addDays(d, -1) }); start = null; }
  }
  if (start) gaps.push({ since: start, until });
  return gaps;
}

// ---------------------------------------------------------------------------------------------------------
// Members

function analyseMembers(ds) {
  const days = coveredDays(ds.spans);
  const covered = (from, to) => { for (let d = from; d <= to; d = addDays(d, 1)) if (!days.has(d)) return false; return true; };
  const members = new Map();
  for (const o of ds.orders) {
    if (!o.member || o.personalPayment) continue;
    const m = members.get(o.member) || { orders: [], valid: [] };
    m.orders.push(o);
    if (o.valid) m.valid.push(o);
    members.set(o.member, m);
  }
  for (const m of members.values()) {
    const tOrder = m.orders.find((o) => o.firstOrderFlag === "T");
    m.first = m.valid[0] || null;
    m.verified = Boolean(m.first && tOrder && tOrder.time <= m.first.time && covered(tOrder.date, m.first.date));
    m.firstFlagAgrees = m.first ? m.first.firstOrderFlag === "T" : null;
  }
  return { members, days, covered };
}

function dataThrough(ds) {
  return ds.spans.reduce((max, s) => (s.until > max ? s.until : max), "0000-00-00");
}

const sum = (list) => list.reduce((s, o) => s + o.amount, 0);
const median = (values) => {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);
const bucket = (n) => (n >= 5 ? "5+" : n >= 3 ? "3-4" : String(n));

function block(orders, memberCount) {
  const amount = sum(orders);
  return { members: memberCount, orders: orders.length, amount, averageOrderValue: orders.length ? Math.round(amount / orders.length) : null };
}

// ---------------------------------------------------------------------------------------------------------
// Reports (aggregates only)

export function crmMonthly(ds, month) {
  const { members } = analyseMembers(ds);
  const start = `${month}-01`;
  const inMonth = ds.orders.filter((o) => o.month === month);
  const validInMonth = inMonth.filter((o) => o.valid);
  const groups = { NEW: [], REPEAT: [], UNVERIFIED: [] };
  const groupMembers = { NEW: new Set(), REPEAT: new Set(), UNVERIFIED: new Set() };
  const intervals = [];
  const distribution = { 1: 0, 2: 0, "3-4": 0, "5+": 0 };
  let firstFlagDisagreements = 0;
  for (const [key, m] of members) {
    const mine = m.valid.filter((o) => o.month === month);
    if (!mine.length) continue;
    let group;
    if (m.valid.some((o) => o.date < start)) group = "REPEAT";
    else if (m.verified && m.first.month === month) group = "NEW";
    else group = "UNVERIFIED";
    groups[group].push(...mine);
    groupMembers[group].add(key);
    if (group !== "UNVERIFIED") distribution[bucket(m.valid.filter((o) => o.date <= monthEnd(month)).length)]++;
    if (group === "NEW") {
      if (m.firstFlagAgrees === false) firstFlagDisagreements++;
      const second = m.valid[1];
      if (second) intervals.push((second.time - m.first.time) / DAY_MS);
    }
  }
  const memberValid = validInMonth.filter((o) => o.member && !o.personalPayment);
  const guests = validInMonth.filter((o) => o.identityKnown && !o.member && !o.personalPayment);
  const noIdentity = validInMonth.filter((o) => !o.identityKnown && !o.personalPayment);
  const naverGuests = guests.filter((o) => o.market === "NCHECKOUT");
  const personal = validInMonth.filter((o) => o.personalPayment);
  return {
    month,
    newMembers: block(groups.NEW, groupMembers.NEW.size),
    repeatMembers: block(groups.REPEAT, groupMembers.REPEAT.size),
    unverifiedMembers: { ...block(groups.UNVERIFIED, groupMembers.UNVERIFIED.size), status: "UNVERIFIED", reason: "earlier purchase history is not fully covered by the caches" },
    newMemberRange: { min: groupMembers.NEW.size, max: groupMembers.NEW.size + groupMembers.UNVERIFIED.size },
    guests: { ...block(guests, null), naverPay: block(naverGuests, null), status: "UNIDENTIFIED" },
    personalPayment: { ...block(personal, null), note: "개인결제창 orders are excluded from customer analysis" },
    identityUnknown: { ...block(noIdentity, null), status: "UNVERIFIED", note: "seen only in a snapshot without member fields (e.g. late orders); member vs guest unknown" },
    staffPurchases: { status: "UNAVAILABLE", note: "Cafe24 orders carry no staff marker; online staff purchases cannot be separated" },
    total: { orders: validInMonth.length, amount: sum(validInMonth), memberOrders: memberValid.length },
    purchaseCountDistribution: { basis: "valid purchases in the data up to month end, verified NEW and REPEAT members", buckets: distribution },
    secondPurchaseDays: {
      basis: "NEW members of this month with a later valid purchase in the data",
      withSecondPurchase: intervals.length,
      withoutSecondPurchase: groupMembers.NEW.size - intervals.length,
      averageDays: intervals.length ? round1(intervals.reduce((a, b) => a + b, 0) / intervals.length) : null,
      medianDays: round1(median(intervals))
    },
    firstOrderFlagCheck: { newMembersWhoseFirstValidOrderWasNotFlaggedFirst: firstFlagDisagreements }
  };
}

const monthsBetween = (from, to) => { const out = []; for (let m = from; m <= to; m = nextMonth(m)) out.push(m); return out; };

export function crmCohort(ds, from, to, windows = CRM_WINDOWS) {
  const { members, covered } = analyseMembers(ds);
  const through = dataThrough(ds);
  const cohorts = monthsBetween(from, to).map((month) => {
    const cohort = [...members.values()].filter((m) => m.verified && m.first.month === month);
    const unverifiedFirsts = [...members.values()].filter((m) => !m.verified && m.first && m.first.month === month).length;
    const cells = windows.map((w) => {
      const matureAt = addDays(monthEnd(month), w);
      const repurchased = (m) => m.valid.slice(1).some((o) => o.time - m.first.time <= w * DAY_MS);
      if (!cohort.length) return { window: w, status: "EMPTY", rate: null };
      if (matureAt > through) {
        const mature = cohort.filter((m) => addDays(m.first.date, w) <= through);
        return { window: w, status: "IMMATURE", rate: null, matureMembers: mature.length, repurchasedAmongMature: mature.filter(repurchased).length };
      }
      if (!covered(`${month}-01`, matureAt)) return { window: w, status: "UNVERIFIED", rate: null, reason: "coverage gap inside the window" };
      const count = cohort.filter(repurchased).length;
      return { window: w, status: "MATURE", members: cohort.length, repurchased: count, rate: round1((count / cohort.length) * 100) };
    });
    return { month, members: cohort.length, unverifiedFirstPurchases: unverifiedFirsts, cells };
  });
  return { from, to, windows, dataThrough: through, cohorts };
}

function channelOf(row) {
  if (!row) return { channel: "UNKNOWN", medium: null };
  const ad = String(row.ad || "").trim();
  return { channel: ad || "(no ad / direct)", medium: String(row.medium || "").trim() || null };
}

export function crmAcquisition(ds, month) {
  const { members } = analyseMembers(ds);
  const days = coveredDays(ds.analyticsSpans);
  const analyticsCoverage = gapsBetween(days, `${month}-01`, monthEnd(month)).length ? "PARTIAL" : "COMPLETE";
  const groupBy = (orders) => {
    const map = new Map();
    for (const o of orders) {
      const { channel, medium } = channelOf(ds.analytics.get(o.id));
      const key = `${channel}\u0000${medium ?? ""}`;
      const row = map.get(key) || { channel, medium, orders: 0, amount: 0, customers: new Set() };
      row.orders++; row.amount += o.amount;
      if (o.member) row.customers.add(o.member);
      map.set(key, row);
    }
    return [...map.values()].map(({ customers, ...r }) => ({ ...r, members: customers.size })).sort((a, b) => b.amount - a.amount);
  };
  const firstPurchases = [...members.values()].filter((m) => m.verified && m.first.month === month).map((m) => m.first);
  const allValid = ds.orders.filter((o) => o.month === month && o.valid && !o.personalPayment);
  const matched = allValid.filter((o) => ds.analytics.has(o.id)).length;
  return {
    month,
    analyticsCoverage,
    amountBasis: "Marketing OS canonical paid amount; Analytics order_amount is never used as revenue",
    firstPurchaseChannels: groupBy(firstPurchases),
    allOrderChannels: groupBy(allValid),
    matchRate: { validOrders: allValid.length, matchedToAnalytics: matched, unknown: allValid.length - matched }
  };
}

export function crmDataQuality(ds, month) {
  const { members, days } = analyseMembers(ds);
  const inMonth = ds.orders.filter((o) => o.month === month);
  const firstDay = [...days].sort()[0] || null;
  const through = dataThrough(ds);
  const cacheOnly = inMonth.filter((o) => o.source === "cache");
  const fromSnapshot = inMonth.filter((o) => o.source === "snapshot");
  const lastCacheObservation = Math.max(0, ...ds.spans.filter((s) => s.source === "cache" && s.until >= `${month}-01` && s.since <= monthEnd(month)).map((s) => s.observedAt));
  const snapshotsForMonth = ds.snapshots.filter((s) => s.months.has(month));
  const analyticsRows = inMonth.filter((o) => ds.analytics.has(o.id));
  const amountMismatch = analyticsRows.filter((o) => o.valid && Number(ds.analytics.get(o.id).order_amount) !== o.amount).length;
  const unverified = [...members.values()].filter((m) => m.first && m.first.month <= month && !m.verified).length;
  const issues = [];
  if (!snapshotsForMonth.length && lastCacheObservation && kstDate(lastCacheObservation) <= monthEnd(month)) issues.push("MONTH_CACHE_OBSERVED_BEFORE_MONTH_END");
  if (inMonth.some((o) => o.openClaims > 0)) issues.push("OPEN_CLAIMS_AT_LAST_OBSERVATION");
  issues.push("POST_SNAPSHOT_CANCELS_UNVERIFIED");
  return {
    month,
    closeStatus: "NOT_FINAL",
    sources: {
      cacheFiles: ds.cacheFileCount,
      lastCacheObservedAt: lastCacheObservation ? new Date(lastCacheObservation).toISOString() : null,
      snapshots: snapshotsForMonth.map((s) => ({ name: s.name, observedAt: new Date(s.observedAt).toISOString() })),
      ordersFromLatestSnapshot: fromSnapshot.length,
      ordersFromCacheOnly: cacheOnly.length,
      duplicateObservationsMerged: ds.duplicateObservations
    },
    totals: {
      merged: { orders: inMonth.filter((o) => o.valid).length, amount: sum(inMonth.filter((o) => o.valid)) },
      latestOrderAt: inMonth.length ? new Date(Math.max(...inMonth.map((o) => o.time))).toISOString() : null
    },
    orderStates: {
      fullyCanceled: inMonth.filter((o) => o.canceled === "T").length,
      partiallyCanceled: inMonth.filter((o) => o.canceled === "M").length,
      unpaid: inMonth.filter((o) => o.unpaid && !o.valid).length,
      ordersWithOpenClaims: inMonth.filter((o) => o.openClaims > 0).length,
      openClaimAmountAtObservation: sum(inMonth.filter((o) => o.openClaims > 0))
    },
    history: { coveredFrom: firstDay, dataThrough: through, gaps: firstDay ? gapsBetween(days, firstDay, through) : [] },
    members: { unverifiedFirstPurchaseUpToMonth: unverified },
    analytics: { rowsForMonth: analyticsRows.length, validOrdersWithAmountDifferentFromAnalytics: amountMismatch },
    staffPurchases: "UNAVAILABLE",
    issues
  };
}

// ponytail: one in-process memo; the caches change once a day, so a 10-minute TTL is plenty.
// Concurrent requests share one in-flight load (single-flight), so N parallel calls cost one load.
let memo = null;
export function cachedCrmDataset(options, ttlMs = 600_000, loader = loadCrmDataset) {
  const key = JSON.stringify(options);
  if (memo && memo.key === key && (!memo.settledAt || Date.now() - memo.settledAt < ttlMs)) return memo.promise;
  const entry = { key, settledAt: 0 };
  entry.promise = loader(options).then(
    (ds) => { entry.settledAt = Date.now(); return ds; },
    (error) => { if (memo === entry) memo = null; throw error; }
  );
  memo = entry;
  return entry.promise;
}
