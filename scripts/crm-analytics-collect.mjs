// Scheduled Cafe24 Analytics collection for the CRM acquisition report.
//
// The CRM loader (crm-analytics.mjs) reads Analytics order details only from
// WORK_DIR/tracking-test/**/SAMPLAS_MONTHLY_TRACKING_*.json. This keeps one analytics-only file per month
// (orders: [], so CRM orders, amounts and new/repeat decisions cannot change) in
// WORK_DIR/tracking-test/crm-analytics-backfill/, the same place and format as the 2026-08..10 backfill.
//
// Off unless CRM_ANALYTICS_COLLECT=on. Polled every minute by server.mjs:
// - daily from 04:00 KST: every month touched by the last CRM_ANALYTICS_DAILY_DAYS (default 7) days is
//   re-fetched from its 1st up to yesterday;
// - monthly on the 3rd from 04:30 KST: the previous month is re-fetched in full.
// A month file is replaced only after the new data is complete and validated; the old file is kept as
// <file>.prev. Any failure leaves the existing file untouched. Only 8 non-personal fields are stored,
// and logs carry counts only.
//
// Operations:
// - Stop: set CRM_ANALYTICS_COLLECT=off (or remove it). Files already written stay and keep working.
// - Status: Render logs "[CRM_ANALYTICS_COLLECT]" (job, ok, rows per month) and collect-state.json
//   (last successful daily date / monthly month).
// - Re-run a job: remove its key from collect-state.json; the next minute's tick runs it again.
// - Restore a month: rename SAMPLAS_MONTHLY_TRACKING_ANALYTICS_<month>.json.prev over the .json file.
//   A missed monthly run (server down on the 3rd) catches up on the next tick after 04:30 KST.
import { readFile, rename, writeFile, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const ANALYTICS_KEYS = ["order_id", "order_date", "ad", "medium", "campaign", "content", "keyword", "order_amount"];
const DAY_MS = 86_400_000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const monthEnd = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).toISOString().slice(0, 10);
const prevMonth = (m) => addDays(`${m}-01`, -1).slice(0, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function kstNow(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3_600_000).toISOString();
  return { date: k.slice(0, 10), month: k.slice(0, 7), day: +k.slice(8, 10), minutes: +k.slice(11, 13) * 60 + +k.slice(14, 16) };
}

// Which jobs are due now. Pure, so the schedule is testable without timers.
export function dueJobs(state, now = new Date(), dailyDays = 7) {
  const k = kstNow(now);
  const yesterday = addDays(k.date, -1);
  const jobs = [];
  if (k.minutes >= 4 * 60 && state.daily !== k.date) {
    const months = [];
    for (let m = addDays(k.date, -dailyDays).slice(0, 7); m <= yesterday.slice(0, 7); m = addDays(monthEnd(m), 1).slice(0, 7)) months.push(m);
    jobs.push({ kind: "daily", key: k.date, months: months.map((m) => ({ month: m, until: monthEnd(m) < yesterday ? monthEnd(m) : yesterday })) });
  }
  if (k.day >= 3 && k.minutes >= 4 * 60 + 30 && state.monthly !== prevMonth(k.month)) {
    const m = prevMonth(k.month);
    jobs.push({ kind: "monthly", key: m, months: [{ month: m, until: monthEnd(m) }] });
  }
  return jobs;
}

// fetchAnalytics: the server's fetchCafe24AnalyticsOrderDetails ({ startDate, endDate } -> { ok, coverage, data }).
// Its own token handling refreshes through the server's single-flight refresh, so nothing here touches tokens.
async function fetchWindow(fetchAnalytics, since, until, { pauseMs, retryMs }) {
  let result;
  for (let attempt = 0; ; attempt++) {
    try {
      result = await fetchAnalytics({ startDate: since, endDate: until });
      break;
    } catch (error) {
      const status = Number(error?.status) || 0;
      if (attempt === 0 && (status === 429 || status >= 500)) { await sleep(retryMs); continue; }
      throw new Error(`${since}..${until}: Cafe24 Analytics ${status || "error"}`);
    } finally {
      await sleep(pauseMs);
    }
  }
  if (result?.ok !== true) throw new Error(`${since}..${until}: Cafe24 Analytics not ok`);
  const rows = Array.isArray(result.data?.orderdetails) ? result.data.orderdetails : [];
  // Zero rows is never COMPLETE: it can mean the Analytics retention ended, not that nobody ordered.
  const completeness = rows.length === 0 ? "EMPTY_UNVERIFIED" : result.coverage?.completeness || "UNKNOWN";
  return { since, until, ok: true, coverage: { completeness }, data: { orderdetails: rows.map((r) => Object.fromEntries(ANALYTICS_KEYS.map((k) => [k, r?.[k] ?? null]))) } };
}

// 7-day windows from the 1st to `until`; a window that hits the 100-row page limit is re-fetched day by day.
export async function fetchMonth(fetchAnalytics, month, until, opts) {
  const batches = [];
  for (let since = `${month}-01`; since <= until; since = addDays(since, 7)) {
    const end = addDays(since, 6) < until ? addDays(since, 6) : until;
    const week = await fetchWindow(fetchAnalytics, since, end, opts);
    if (week.coverage.completeness !== "PARTIAL" || since === end) { batches.push(week); continue; }
    for (let d = since; d <= end; d = addDays(d, 1)) batches.push(await fetchWindow(fetchAnalytics, d, d, opts));
  }
  return batches;
}

// Reasons not to replace a month file; empty means the new batches are safe to write.
export function validateBatches(batches, month, previous) {
  const problems = [];
  let rows = 0;
  for (const b of batches) {
    if (!["COMPLETE", "EMPTY_UNVERIFIED"].includes(b.coverage.completeness)) problems.push(`${b.since}..${b.until} ${b.coverage.completeness}`);
    for (const r of b.data.orderdetails) {
      const day = String(r.order_date || "").slice(0, 10);
      if (!r.order_id || day < b.since || day > b.until) problems.push(`${b.since}..${b.until} row outside window`);
      rows++;
    }
  }
  if (!rows) problems.push("no rows returned");
  if (batches.some((b) => !b.since.startsWith(month))) problems.push("window outside month");
  // Analytics rows do not disappear when an order is canceled; fewer rows than before means a bad fetch.
  if (previous && rows < previous.rows) problems.push(`fewer rows than existing file (${rows} < ${previous.rows})`);
  return [...new Set(problems)];
}

export async function collectMonth({ fetchAnalytics, outDir, month, until, pauseMs = 3000, retryMs = 15000, now = () => new Date() }) {
  const file = join(outDir, `SAMPLAS_MONTHLY_TRACKING_ANALYTICS_${month}.json`);
  const previous = await readFile(file, "utf8").then((t) => {
    const b = JSON.parse(t).data.cafe24.analyticsBatches;
    return { rows: b.reduce((s, x) => s + x.data.orderdetails.length, 0) };
  }, (error) => (error.code === "ENOENT" ? null : Promise.reject(new Error(`existing ${month} file unreadable; left untouched`))));
  const batches = await fetchMonth(fetchAnalytics, month, until, { pauseMs, retryMs });
  // An order seen in two windows keeps its first row only.
  const seen = new Set();
  for (const b of batches) b.data.orderdetails = b.data.orderdetails.filter((r) => !seen.has(String(r.order_id)) && seen.add(String(r.order_id)));
  const problems = validateBatches(batches, month, previous);
  const rows = batches.reduce((s, b) => s + b.data.orderdetails.length, 0);
  if (problems.length) return { month, until, written: false, rows, problems: problems.slice(0, 5) };
  await mkdir(outDir, { recursive: true });
  const body = { generatedAt: now().toISOString(), source: "crm-analytics-collect", data: { cafe24: { orders: [], analyticsBatches: batches } } };
  await writeFile(`${file}.tmp`, JSON.stringify(body));
  JSON.parse(await readFile(`${file}.tmp`, "utf8")); // read-back check before the swap
  if (previous) await copyFile(file, `${file}.prev`);
  await rename(`${file}.tmp`, file);
  return { month, until, written: true, rows, previousRows: previous?.rows ?? null };
}

// Returns the per-minute tick for server.mjs. One job at a time per process (Render instances with a
// persistent disk never overlap). A failed job is retried after 60 minutes, at most 3 attempts per key.
export function createCrmAnalyticsCollector({ workDir, fetchAnalytics, env = process.env, now = () => new Date(), log = console.log, pauseMs, retryMs }) {
  const outDir = join(workDir, "tracking-test", "crm-analytics-backfill");
  const statePath = join(outDir, "collect-state.json");
  const dailyDays = Math.min(Math.max(parseInt(env.CRM_ANALYTICS_DAILY_DAYS || "7", 10) || 7, 1), 62);
  const attempts = new Map();
  let running = false;
  return async function tick() {
    if (running) return;
    running = true;
    try {
      const state = await readFile(statePath, "utf8").then(JSON.parse, () => ({}));
      for (const job of dueJobs(state, now(), dailyDays)) {
        const a = attempts.get(`${job.kind}:${job.key}`) || { n: 0, at: 0 };
        if (a.n >= 3 || now().getTime() - a.at < 60 * 60_000) continue;
        attempts.set(`${job.kind}:${job.key}`, { n: a.n + 1, at: now().getTime() });
        const results = [];
        for (const { month, until } of job.months) {
          try { results.push(await collectMonth({ fetchAnalytics, outDir, month, until, pauseMs, retryMs, now })); }
          catch (error) { results.push({ month, until, written: false, problems: [error.message] }); }
        }
        const ok = results.every((r) => r.written);
        log(`[CRM_ANALYTICS_COLLECT] ${JSON.stringify({ job: job.kind, key: job.key, attempt: a.n + 1, ok, results })}`);
        if (!ok) continue;
        const next = { ...(await readFile(statePath, "utf8").then(JSON.parse, () => ({}))), [job.kind]: job.key, [`${job.kind}At`]: now().toISOString() };
        await mkdir(outDir, { recursive: true });
        await writeFile(`${statePath}.tmp`, JSON.stringify(next));
        await rename(`${statePath}.tmp`, statePath);
      }
    } catch (error) {
      log(`[CRM_ANALYTICS_COLLECT] tick failed: ${error.message}`);
    } finally {
      running = false;
    }
  };
}
