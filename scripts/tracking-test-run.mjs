// One-off tracking test (PR-1): collect one real KST day from Meta Ads, Instagram, Naver Ads and
// Cafe24 (actual orders + Meta tracking-code orders) and save the result to a separate test path.
//
// Run inside the live Render instance (Render Shell), never imported by server.mjs:
//   node scripts/tracking-test-run.mjs --date 2026-10-27 [--at 2026-10-28T01:00:00Z] [--no-upload]
//
// Operational data is read, never written:
// - Meta / Instagram: direct Graph GETs. The token store is only read (server routes would write caches).
// - Naver: the server's read-only loopback route /api/intelligence/naver/ads/performance.
//   Adgroup and search-demand enrichment write a snapshot store, so they are NOT_COLLECTED here.
// - Cafe24: direct Admin GETs with the token the server stores. /api/cafe24/orders writes an
//   orders cache file, so it is not used. When the token is near expiry, the refresh goes through
//   the server's loopback /api/cafe24/refresh-token, so the rotating refresh token stays single-flight.
// Output: new files only (Dropbox mode "add", local flag "wx"); official weekly reports are untouched.
// Every item is OK, FAILED or NOT_COLLECTED. 0 is OK only when the source response was complete.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { cafe24OrderAmount, isCafe24CanceledOrRefunded } from "./cafe24-order-amount.mjs";
import { getDropboxAccessToken, dropboxUploadFile, isDropboxConfigured } from "./dropbox-report-uploader.mjs";

export const TRACKING_CODES = ["meta_meantime_look", "meta_ssage", "meta_adv_catalog", "meta_adv_image", "meta_adv_video"];
export const DEFAULT_DROPBOX_TEST_DIR = "/SAMPLAS WORK/병구 작업/_test";
const PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase"];
const CAFE24_PAGE = 100, CAFE24_MAX = 1000, GRAPH_MAX_PAGES = 20;

const kstToday = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export function assertPastKstDate(date, now = new Date()) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date || "") && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!valid) throw new Error(`Invalid date: ${date}`);
  if (date >= kstToday(now)) throw new Error(`Date ${date} is not a completed KST day yet.`);
}

const ok = (platform, item, metrics, extra = {}) => ({ platform, item, status: "OK", metrics, reason: null, ...extra });
const failed = (platform, item, error) => ({ platform, item, status: "FAILED", metrics: null, reason: String(error?.message || error).slice(0, 300) });
const notCollected = (platform, item, reason) => ({ platform, item, status: "NOT_COLLECTED", metrics: null, reason });

async function readJsonFile(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function fetchJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000), ...init });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text || "{}"); } catch { body = null; }
  if (!response.ok || !body || body.error) {
    const message = body?.error?.message || (typeof body?.error === "string" ? body.error : null) || body?.message || `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body;
}

// ---------- Meta / Instagram (Graph GET only) ----------

function graphClient({ env, fetchImpl, token }) {
  const version = env.GRAPH_VERSION || "v25.0";
  const get = (path, params) => {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
    url.searchParams.set("access_token", token);
    return fetchJson(fetchImpl, url);
  };
  const all = async (path, params) => {
    let body = await get(path, params);
    if (!Array.isArray(body.data)) throw new Error("Graph response has no data array");
    const rows = [...body.data];
    for (let pages = 1; body.paging?.next; pages += 1) {
      if (pages >= GRAPH_MAX_PAGES) throw new Error("PAGE_LIMIT");
      body = await fetchJson(fetchImpl, body.paging.next);
      rows.push(...(body.data || []));
    }
    return rows;
  };
  return { get, all };
}

const purchase = (items, key = "value") => Number((items || []).find((a) => PURCHASE_TYPES.includes(a.action_type))?.[key] || 0);

async function collectMeta(ctx) {
  const { date, env } = ctx;
  const account = env.META_AD_ACCOUNT_ID && env.META_AD_ACCOUNT_ID !== "act_" ? env.META_AD_ACCOUNT_ID : "";
  if (!ctx.metaToken || !account) {
    const reason = !ctx.metaToken ? "META_TOKEN_MISSING" : "META_AD_ACCOUNT_ID_MISSING";
    return ["account", "campaigns", "attribution"].map((item) => failed("meta", item, reason));
  }
  const graph = graphClient({ env, fetchImpl: ctx.fetchImpl, token: ctx.metaToken });
  const time_range = { since: date, until: date };
  const results = [];
  try {
    // Empty data from a successful response means no delivery that day: a real 0.
    const [row] = await graph.all(`${account}/insights`, { level: "account", fields: "spend,impressions,clicks,reach,actions,action_values", time_range });
    results.push(ok("meta", "account", { spend: Number(row?.spend || 0), impressions: Number(row?.impressions || 0), clicks: Number(row?.clicks || 0), reach: Number(row?.reach || 0), purchases: purchase(row?.actions), purchaseValue: purchase(row?.action_values) }));
  } catch (error) { results.push(failed("meta", "account", error)); }
  try {
    const rows = await graph.all(`${account}/insights`, { level: "campaign", fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values", time_range, limit: 200 });
    results.push(ok("meta", "campaigns", { count: rows.length, spend: rows.reduce((s, r) => s + Number(r.spend || 0), 0) }, {
      rows: rows.map((r) => ({ campaignId: r.campaign_id, campaignName: r.campaign_name, spend: Number(r.spend || 0), impressions: Number(r.impressions || 0), clicks: Number(r.clicks || 0), purchases: purchase(r.actions), purchaseValue: purchase(r.action_values) }))
    }));
  } catch (error) { results.push(failed("meta", "campaigns", error)); }
  try {
    const rows = await graph.all(`${account}/insights`, { level: "ad", fields: "ad_id,actions,action_values", time_range, action_attribution_windows: ["7d_click", "1d_view"], limit: 200 });
    const totals = { clickPurchases: 0, clickValue: 0, viewPurchases: 0, viewValue: 0 };
    for (const r of rows) {
      totals.clickPurchases += purchase(r.actions, "7d_click"); totals.clickValue += purchase(r.action_values, "7d_click");
      totals.viewPurchases += purchase(r.actions, "1d_view"); totals.viewValue += purchase(r.action_values, "1d_view");
    }
    results.push(ok("meta", "attribution", { ads: rows.length, ...totals }));
  } catch (error) { results.push(failed("meta", "attribution", error)); }
  return results;
}

async function collectInstagram(ctx) {
  const igId = ctx.metaRecord?.instagramBusinessAccountId || ctx.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!ctx.metaToken || !igId) return ["account_reach", "account_totals", "followers"].map((item) => failed("instagram", item, !ctx.metaToken ? "META_TOKEN_MISSING" : "INSTAGRAM_BUSINESS_ACCOUNT_ID_MISSING"));
  const graph = graphClient({ env: ctx.env, fetchImpl: ctx.fetchImpl, token: ctx.metaToken });
  // KST day boundaries as unix seconds (Graph "day" buckets are Pacific time, so use total_value over the exact range).
  const since = Date.parse(`${ctx.date}T00:00:00+09:00`) / 1000, until = since + 86400;
  const results = [];
  // Metric sets the server already reads in production; each set is its own item so one failure never hides the other.
  for (const [item, metric] of [["account_reach", "reach"], ["account_totals", "profile_views,website_clicks,views"]]) {
    try {
      const body = await graph.get(`${igId}/insights`, { metric, metric_type: "total_value", period: "day", since: String(since), until: String(until) });
      if (!Array.isArray(body.data)) throw new Error("Graph response has no data array");
      const metrics = {};
      for (const m of body.data) {
        if (!m.total_value || !Object.hasOwn(m.total_value, "value")) throw new Error(`metric ${m.name} has no total_value`);
        metrics[m.name] = Number(m.total_value.value);
      }
      const missing = metric.split(",").filter((name) => !Object.hasOwn(metrics, name));
      if (missing.length) throw new Error(`metrics missing: ${missing.join(",")}`);
      results.push(ok("instagram", item, metrics, { basis: item === "account_reach" ? "account unique reach for the KST day" : "account totals for the KST day" }));
    } catch (error) { results.push(failed("instagram", item, error)); }
  }
  try {
    const body = await graph.get(igId, { fields: "followers_count,media_count" });
    if (typeof body.followers_count !== "number") throw new Error("followers_count missing");
    results.push(ok("instagram", "followers", { followersCount: body.followers_count, mediaCount: body.media_count ?? null }, { basis: "snapshot at run time, not end of day" }));
  } catch (error) { results.push(failed("instagram", "followers", error)); }
  return results;
}

// ---------- Naver (server loopback, read-only route) ----------

async function collectNaver(ctx) {
  const results = [];
  try {
    const body = await fetchJson(ctx.fetchImpl, `${ctx.serverBase}/api/intelligence/naver/ads/performance?since=${ctx.date}&until=${ctx.date}`);
    if (body.ok !== true || !Array.isArray(body.campaigns) || !body.summary) throw new Error(body.error || "Incomplete Naver performance response");
    results.push(ok("naver", "campaigns", { ...body.summary, campaignCount: body.campaigns.length }, {
      rows: body.campaigns.map((c) => ({ campaignId: c.campaignId, campaignName: c.campaignName, spend: c.spend, impressions: c.impressions, clicks: c.clicks, conversions: c.conversions, conversionValue: c.conversionValue }))
    }));
  } catch (error) { results.push(failed("naver", "campaigns", error)); }
  results.push(notCollected("naver", "adgroups", "Adgroup and search-demand enrichment write the operational snapshot store; skipped in this test."));
  return results;
}

// ---------- Cafe24 (direct GET; refresh only through the server) ----------

// Same rule as server.mjs normalizeCafe24ExpiresAt: Cafe24 times without an offset are KST.
const cafe24ExpiresAt = (value) => typeof value === "string" ? Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}+09:00`) : NaN;
const needsRefresh = (record, now) => !record?.accessToken || !(cafe24ExpiresAt(record.expiresAt) - now.getTime() > 10 * 60 * 1000);

async function cafe24Token(ctx, { force = false } = {}) {
  let record = await ctx.readJson(ctx.cafe24TokenFile);
  if (record?.status === "reauth_required") throw new Error("Cafe24 token store says reauth_required");
  if (force || needsRefresh(record, ctx.now())) {
    // The server owns the rotating refresh token; the response body (token data) is discarded.
    await fetchJson(ctx.fetchImpl, `${ctx.serverBase}/api/cafe24/refresh-token`, { method: "POST" });
    record = await ctx.readJson(ctx.cafe24TokenFile);
  }
  if (!record?.accessToken) throw new Error("Cafe24 access token missing");
  return record.accessToken;
}

async function cafe24Orders(ctx, inflowPath) {
  const url = new URL(`https://${ctx.env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/orders`);
  url.searchParams.set("start_date", ctx.date);
  url.searchParams.set("end_date", ctx.date);
  url.searchParams.set("embed", "items");
  if (inflowPath) url.searchParams.set("inflow_path", inflowPath);
  const orders = [];
  for (let offset = 0; offset < CAFE24_MAX; offset += CAFE24_PAGE) {
    url.searchParams.set("limit", String(CAFE24_PAGE));
    url.searchParams.set("offset", String(offset));
    const page = async (token) => fetchJson(ctx.fetchImpl, url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Cafe24-Api-Version": ctx.env.CAFE24_API_VERSION || ctx.env.CAFE24_ADMIN_API_VERSION || "2025-06-01" } });
    let body;
    try { body = await page(await cafe24Token(ctx)); } catch (error) {
      if (error.status !== 401) throw error;
      body = await page(await cafe24Token(ctx, { force: true }));
    }
    if (!Array.isArray(body.orders)) throw new Error("Cafe24 orders page has no orders array");
    orders.push(...body.orders);
    if (body.orders.length < CAFE24_PAGE) return orders;
  }
  throw new Error(`Cafe24 orders exceed ${CAFE24_MAX}; result would be incomplete`);
}

const orderSummary = (orders) => {
  const active = orders.filter((o) => !isCafe24CanceledOrRefunded(o));
  return { orderCount: orders.length, activeOrderCount: active.length, canceledOrRefundedCount: orders.length - active.length, paidAmount: active.reduce((s, o) => s + cafe24OrderAmount(o), 0) };
};
const orderRows = (orders, code = null) => orders.map((o) => ({ orderId: o.order_id, orderDate: o.order_date, trackingCode: code, canceledOrRefunded: isCafe24CanceledOrRefunded(o), amount: cafe24OrderAmount(o) }));

async function collectCafe24(ctx) {
  if (!ctx.env.CAFE24_MALL_ID) return [failed("cafe24", "actual_orders", "CAFE24_MALL_ID_MISSING"), ...TRACKING_CODES.map((c) => failed("cafe24", `tracking:${c}`, "CAFE24_MALL_ID_MISSING"))];
  const results = [];
  try {
    const orders = await cafe24Orders(ctx);
    results.push(ok("cafe24", "actual_orders", orderSummary(orders), { rows: orderRows(orders) }));
  } catch (error) { results.push(failed("cafe24", "actual_orders", error)); }
  for (const code of TRACKING_CODES) {
    try {
      const orders = await cafe24Orders(ctx, code);
      results.push(ok("cafe24", `tracking:${code}`, orderSummary(orders), { rows: orderRows(orders, code) }));
    } catch (error) { results.push(failed("cafe24", `tracking:${code}`, error)); }
  }
  return results;
}

// Meta-attributed purchases vs Cafe24 orders carrying a Meta tracking code. Different metrics: shown side by side, never merged.
export function attributionCheck(items) {
  const meta = items.find((i) => i.platform === "meta" && i.item === "attribution");
  const tracked = items.filter((i) => i.platform === "cafe24" && i.item.startsWith("tracking:"));
  const missing = [meta, ...tracked].filter((i) => !i || i.status !== "OK").map((i) => i?.item || "meta:attribution");
  if (missing.length) return { platform: "attribution", item: "meta_vs_cafe24_tracking", status: "FAILED", metrics: null, reason: `Inputs not OK: ${missing.join(", ")}` };
  const sum = (key) => tracked.reduce((s, i) => s + i.metrics[key], 0);
  return ok("attribution", "meta_vs_cafe24_tracking", {
    metaClickPurchases: meta.metrics.clickPurchases, metaViewPurchases: meta.metrics.viewPurchases, metaClickValue: meta.metrics.clickValue, metaViewValue: meta.metrics.viewValue,
    cafe24TrackedActiveOrders: sum("activeOrderCount"), cafe24TrackedPaidAmount: sum("paidAmount")
  }, { basis: "Meta-attributed values and Cafe24 tracked orders are different metrics and are not added together" });
}

export async function collectTrackingDay({ date, env = process.env, fetchImpl = fetch, readJson = readJsonFile, serverBase, now = () => new Date() }) {
  assertPastKstDate(date, now());
  const workDir = resolve(env.WORK_DIR || "work");
  const secrets = resolve(env.CAFE24_TOKEN_STORE_DIR || join(workDir, "secrets"));
  const metaRecord = await readJson(join(resolve(env.META_TOKEN_STORE_DIR || secrets), "meta-token-store.json")).catch(() => null);
  const ctx = {
    date, env, fetchImpl, readJson, now, metaRecord,
    serverBase: serverBase || `http://127.0.0.1:${env.PORT || 8787}`,
    metaToken: metaRecord?.accessToken || env.META_ACCESS_TOKEN || "",
    cafe24TokenFile: join(secrets, "cafe24-token-store.json")
  };
  const startedAt = now().toISOString();
  // Sequential on purpose: Cafe24 and Graph rate limits, and only one possible token refresh at a time.
  const items = [...await collectMeta(ctx), ...await collectInstagram(ctx), ...await collectNaver(ctx), ...await collectCafe24(ctx)];
  items.push(attributionCheck(items));
  const counts = Object.fromEntries(["OK", "FAILED", "NOT_COLLECTED"].map((s) => [s, items.filter((i) => i.status === s).length]));
  return { kind: "tracking_test", date, timezone: "Asia/Seoul", startedAt, finishedAt: now().toISOString(), result: counts.FAILED ? "FAILED" : counts.NOT_COLLECTED ? "PARTIAL" : "PASS", counts, items };
}

export async function buildTrackingWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("RESULTS");
  sheet.addRow([`TRACKING TEST ${report.date} (KST)`, `result ${report.result}`, `run ${report.startedAt}`]);
  sheet.addRow(["OK = 성공 · FAILED = 실패 · NOT_COLLECTED = 미수집 (0 is shown only for complete responses)"]);
  sheet.addRow(["platform", "item", "status", "metrics", "reason / basis"]);
  for (const i of report.items) sheet.addRow([i.platform, i.item, i.status, i.metrics ? Object.entries(i.metrics).map(([k, v]) => `${k}=${v}`).join(", ") : "N/A", i.reason || i.basis || ""]);
  const rows = workbook.addWorksheet("ROWS");
  rows.addRow(["platform", "item", "row"]);
  for (const i of report.items) for (const r of i.rows || []) rows.addRow([i.platform, i.item, JSON.stringify(r)]);
  return workbook;
}

export async function saveTrackingReport(report, { env = process.env, upload = true, fetchImpl = fetch } = {}) {
  const stamp = report.startedAt.replace(/[-:]/g, "").slice(0, 15); // 20261028T010012
  const base = `TRACKING_TEST_${report.date}_run${stamp}`;
  const json = Buffer.from(JSON.stringify(report, null, 2));
  const xlsx = Buffer.from(await (await buildTrackingWorkbook(report)).xlsx.writeBuffer());
  const localDir = resolve(env.TRACKING_TEST_DIR || join(env.WORK_DIR || "work", "tracking-test", report.date));
  await mkdir(localDir, { recursive: true });
  await writeFile(join(localDir, `${base}.json`), json, { flag: "wx" });
  await writeFile(join(localDir, `${base}.xlsx`), xlsx, { flag: "wx" });
  const saved = { localDir, files: [`${base}.json`, `${base}.xlsx`], dropbox: null };
  if (upload) {
    if (!isDropboxConfigured(env)) throw new Error("Dropbox is not configured; refusing to report a local-only save as uploaded.");
    const dir = `${(env.TRACKING_TEST_DROPBOX_DIR || DEFAULT_DROPBOX_TEST_DIR).replace(/\/+$/, "")}/tracking-${report.date}`;
    const accessToken = await getDropboxAccessToken({ env, fetchImpl });
    saved.dropbox = [];
    // XLSX first, JSON last: a JSON in Dropbox means its XLSX is there too.
    for (const [name, buffer] of [[`${base}.xlsx`, xlsx], [`${base}.json`, json]]) saved.dropbox.push((await dropboxUploadFile(`${dir}/${name}`, buffer, { accessToken, fetchImpl })).pathDisplay);
  }
  // Written only after every save step succeeded; the scheduler treats only this marker as "done".
  await writeFile(join(localDir, `${base}.done`), JSON.stringify(saved), { flag: "wx" });
  return saved;
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const date = arg("--date"), at = arg("--at");
  if (at) {
    const wait = Date.parse(at) - Date.now();
    if (!Number.isFinite(wait)) throw new Error(`Invalid --at: ${at}`);
    console.log(`[TRACKING_TEST] waiting until ${at} (${Math.round(wait / 1000)}s)`);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  assertPastKstDate(date);
  const report = await collectTrackingDay({ date });
  const saved = await saveTrackingReport(report, { upload: !argv.includes("--no-upload") });
  console.log(`[TRACKING_TEST] ${JSON.stringify({ date, result: report.result, counts: report.counts, items: report.items.map((i) => `${i.platform}:${i.item}=${i.status}`), saved })}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`[TRACKING_TEST] failed: ${error.message}`); process.exit(1); });
}
