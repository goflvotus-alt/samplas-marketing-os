// Read-only check: do campaign/adset/ad insight sums equal account-level insights for a week?
// Only GET requests to the Graph API; writes no file, cache or token. Prints aggregates and match
// flags only (no raw rows, names, ids, tokens or URLs).
//   node scripts/meta-account-reconcile-check.mjs 2026-10-13 2026-10-19 [2026-10-06 2026-10-12 ...]
// Credentials: META_AD_ACCOUNT_ID plus META_ACCESS_TOKEN, or the existing meta-token-store.json under
// META_TOKEN_STORE_DIR / CAFE24_TOKEN_STORE_DIR (read only).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const env = process.env;
const METRICS = ["spend", "impressions", "clicks", "purchases", "purchaseValue"];
// Same matching rule as server.mjs actionValue(): first purchase or pixel purchase entry.
const actionValue = (items, type) => Number((items || []).find(i => [type, `offsite_conversion.fb_pixel_${type}`].includes(i.action_type))?.value || 0);
const cents = v => Math.round(Number(v) * 100);

async function token() {
  const dir = env.META_TOKEN_STORE_DIR || env.CAFE24_TOKEN_STORE_DIR;
  if (dir) {
    try { const r = JSON.parse(await readFile(join(dir, "meta-token-store.json"), "utf8")); if (r?.accessToken) return r.accessToken; } catch {}
  }
  return env.META_ACCESS_TOKEN || "";
}

async function insights(accessToken, level, since, until) {
  const url = new URL(`https://graph.facebook.com/${env.GRAPH_VERSION || "v25.0"}/${env.META_AD_ACCOUNT_ID}/insights`);
  url.searchParams.set("fields", "spend,impressions,clicks,actions,action_values");
  url.searchParams.set("level", level);
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("limit", "200");
  url.searchParams.set("access_token", accessToken);
  const rows = []; let pages = 0, next = url.toString();
  while (next) {
    const response = await fetch(next);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error || !Array.isArray(body.data)) throw Object.assign(new Error("GRAPH_ERROR"), { status: response.status, code: body.error?.code ?? null });
    rows.push(...body.data); pages += 1; next = body.paging?.next || null;
    if (pages > 50) throw new Error("PAGE_LIMIT");
  }
  return { rows, pages };
}

function summarize(rows) {
  const totals = Object.fromEntries(METRICS.map(k => [k, 0]));
  let omittedActions = 0, omittedActionValues = 0;
  for (const r of rows) {
    totals.spend += Number(r.spend || 0); totals.impressions += Number(r.impressions || 0); totals.clicks += Number(r.clicks || 0);
    totals.purchases += actionValue(r.actions, "purchase"); totals.purchaseValue += actionValue(r.action_values, "purchase");
    if (!Array.isArray(r.actions)) omittedActions += 1;
    if (!Array.isArray(r.action_values)) omittedActionValues += 1;
  }
  return { rowCount: rows.length, omittedActions, omittedActionValues, totals };
}

const periods = process.argv.slice(2);
if (!periods.length || periods.length % 2 || !periods.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
  console.error("usage: node scripts/meta-account-reconcile-check.mjs <since> <until> [<since> <until> ...]");
  process.exit(2);
}
const accessToken = await token();
if (!accessToken || !env.META_AD_ACCOUNT_ID) { console.log(JSON.stringify({ ok: false, error: "META_CREDENTIALS_UNAVAILABLE" })); process.exit(1); }

const report = [];
for (let i = 0; i < periods.length; i += 2) {
  const [since, until] = periods.slice(i, i + 2);
  try {
    const account = await insights(accessToken, "account", since, until);
    const row = account.rows[0] || {};
    const accountComplete = account.rows.length === 1 && row.date_start === since && row.date_stop === until && Array.isArray(row.actions) && Array.isArray(row.action_values);
    const accountTotals = summarize(account.rows).totals;
    const levels = {};
    for (const level of ["campaign", "adset", "ad"]) {
      const { rows, pages } = await insights(accessToken, level, since, until);
      const s = summarize(rows);
      levels[level] = { ...s, pages, matches: Object.fromEntries(METRICS.map(k => [k, cents(s.totals[k]) === cents(accountTotals[k])])) };
      levels[level].reconciles = accountComplete && Object.values(levels[level].matches).every(Boolean);
    }
    report.push({ since, until, accountComplete, accountRows: account.rows.length, accountTotals, levels });
  } catch (error) {
    report.push({ since, until, ok: false, error: error.message, status: error.status ?? null, code: error.code ?? null });
  }
}
console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), report }, null, 2));
