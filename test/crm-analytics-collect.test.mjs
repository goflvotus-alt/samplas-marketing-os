import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dueJobs, collectMonth, createCrmAnalyticsCollector } from "../scripts/crm-analytics-collect.mjs";
import { buildCrmDataset, loadTrackingSnapshots, crmAcquisition, crmMonthly } from "../scripts/crm-analytics.mjs";

const kst = (iso) => new Date(Date.parse(`${iso}+09:00`));
const row = (id, date, extra = {}) => ({ order_id: id, order_date: `${date} 10:00:00`, ad: "", medium: "", campaign: "", content: "", keyword: "", order_amount: "1000", buyer_email: "pii@example.com", member_id: "pii", ...extra });
const opts = { pauseMs: 0, retryMs: 0 };

// Fake Cafe24 Analytics: one row per day of each window, ids by date.
function fakeAnalytics({ rowsByDay = (d) => [row(`O-${d}`, d)], fail = () => null, partial = () => false } = {}) {
  const calls = [];
  const fn = async ({ startDate, endDate }) => {
    calls.push(`${startDate}..${endDate}`);
    const error = fail(startDate, endDate, calls.length);
    if (error) throw Object.assign(new Error("x"), { status: error });
    const rows = [];
    for (let d = startDate; d <= endDate; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) rows.push(...rowsByDay(d));
    return { ok: true, coverage: { completeness: partial(startDate, endDate) ? "PARTIAL" : "COMPLETE" }, data: { orderdetails: rows } };
  };
  fn.calls = calls;
  return fn;
}

test("schedule: daily from 04:00 KST over months touched by the last 7 days, monthly on the 3rd from 04:30", () => {
  assert.deepEqual(dueJobs({}, kst("2026-11-20T03:59:00")), []);
  assert.deepEqual(dueJobs({}, kst("2026-11-20T04:00:00")), [{ kind: "daily", key: "2026-11-20", months: [{ month: "2026-11", until: "2026-11-19" }] }]);
  assert.deepEqual(dueJobs({ daily: "2026-11-20", monthly: "2026-10" }, kst("2026-11-20T23:00:00")), []);
  // A missed monthly run (server down on the 3rd, or first activation later in the month) catches up.
  assert.deepEqual(dueJobs({ daily: "2026-11-20" }, kst("2026-11-20T23:00:00")).map((j) => j.kind + ":" + j.key), ["monthly:2026-10"]);
  const nov3 = dueJobs({}, kst("2026-11-03T04:30:00"));
  assert.deepEqual(nov3, [
    { kind: "daily", key: "2026-11-03", months: [{ month: "2026-10", until: "2026-10-31" }, { month: "2026-11", until: "2026-11-02" }] },
    { kind: "monthly", key: "2026-10", months: [{ month: "2026-10", until: "2026-10-31" }] }
  ]);
  assert.deepEqual(dueJobs({ daily: "2026-11-03" }, kst("2026-11-03T04:29:00")), []);
  assert.deepEqual(dueJobs({ daily: "2026-12-01" }, kst("2026-12-01T05:00:00")), [], "no monthly before the 3rd");
  assert.deepEqual(dueJobs({}, kst("2026-12-01T04:00:00"))[0].months, [{ month: "2026-11", until: "2026-11-30" }]);
  assert.deepEqual(dueJobs({}, kst("2027-01-02T04:00:00"), 40)[0].months.map((m) => m.month), ["2026-11", "2026-12", "2027-01"]);
});

test("collectMonth: 7-day windows, PARTIAL week split by day, 8 fields only, duplicates removed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crm-collect-"));
  const fetchAnalytics = fakeAnalytics({ partial: (s, e) => s === "2026-10-08" && e === "2026-10-14", rowsByDay: (d) => (d === "2026-10-02" ? [row("O-dup", d), row("O-dup", d)] : [row(`O-${d}`, d)]) });
  const r = await collectMonth({ fetchAnalytics, outDir: dir, month: "2026-10", until: "2026-10-31", ...opts });
  assert.equal(r.written, true);
  assert.ok(fetchAnalytics.calls.includes("2026-10-08..2026-10-14") && fetchAnalytics.calls.includes("2026-10-08..2026-10-08"));
  assert.ok(fetchAnalytics.calls.every((c) => c >= "2026-10-01" && c.slice(-10) <= "2026-10-31"), "no call outside the month");
  const text = await readFile(join(dir, "SAMPLAS_MONTHLY_TRACKING_ANALYTICS_2026-10.json"), "utf8");
  assert.doesNotMatch(text, /pii|buyer_email|member_id/);
  const body = JSON.parse(text);
  assert.deepEqual(body.data.cafe24.orders, []);
  const rows = body.data.cafe24.analyticsBatches.flatMap((b) => b.data.orderdetails);
  assert.equal(rows.length, 31, "30 days + one de-duplicated order");
  assert.deepEqual(Object.keys(rows[0]), ["order_id", "order_date", "ad", "medium", "campaign", "content", "keyword", "order_amount"]);
  assert.ok(body.data.cafe24.analyticsBatches.every((b) => b.coverage.completeness === "COMPLETE"));
});

test("collectMonth never replaces a good file with failed, partial, empty or smaller data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crm-collect-"));
  const file = join(dir, "SAMPLAS_MONTHLY_TRACKING_ANALYTICS_2026-10.json");
  await collectMonth({ fetchAnalytics: fakeAnalytics(), outDir: dir, month: "2026-10", until: "2026-10-31", ...opts });
  const good = await readFile(file, "utf8");
  const cases = {
    "API error": fakeAnalytics({ fail: (s) => (s === "2026-10-15" ? 400 : null) }),
    "single day still PARTIAL": fakeAnalytics({ partial: (s) => s === "2026-10-08" }),
    "no rows": fakeAnalytics({ rowsByDay: () => [] }),
    "fewer rows": fakeAnalytics({ rowsByDay: (d) => (d < "2026-10-20" ? [row(`O-${d}`, d)] : []) }),
    "row outside window": fakeAnalytics({ rowsByDay: (d) => [row(`O-${d}`, "2026-09-30")] })
  };
  for (const [label, fetchAnalytics] of Object.entries(cases)) {
    const r = await collectMonth({ fetchAnalytics, outDir: dir, month: "2026-10", until: "2026-10-31", ...opts }).catch((e) => ({ written: false, problems: [e.message] }));
    assert.equal(r.written, false, label);
    if (label === "fewer rows") assert.match(r.problems.join(), /fewer rows than existing file \(19 < 31\)/);
    assert.equal(await readFile(file, "utf8"), good, `${label}: existing file changed`);
  }
  assert.ok(!(await readdir(dir)).some((f) => f.endsWith(".tmp")), "no temp file left from failed runs");
  // A good re-fetch replaces atomically and keeps the previous file.
  const more = fakeAnalytics({ rowsByDay: (d) => [row(`O-${d}`, d), row(`P-${d}`, d)] });
  assert.equal((await collectMonth({ fetchAnalytics: more, outDir: dir, month: "2026-10", until: "2026-10-31", ...opts })).written, true);
  assert.equal(await readFile(`${file}.prev`, "utf8"), good);
});

test("retry: one retry on 429/5xx, none on auth errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crm-collect-"));
  const flaky = fakeAnalytics({ fail: (s, e, n) => (n === 1 ? 429 : null) });
  assert.equal((await collectMonth({ fetchAnalytics: flaky, outDir: dir, month: "2026-10", until: "2026-10-07", ...opts })).written, true);
  assert.equal(flaky.calls.length, 2);
  const auth = fakeAnalytics({ fail: () => 401 });
  await assert.rejects(collectMonth({ fetchAnalytics: auth, outDir: dir, month: "2026-11", until: "2026-11-07", ...opts }), /401/);
  assert.equal(auth.calls.length, 1);
});

test("collector: state survives restarts, no overlap, failed jobs retried at most 3 times an hour apart", async () => {
  const work = await mkdtemp(join(tmpdir(), "crm-collect-"));
  let t = kst("2026-11-20T04:00:00");
  const logs = [];
  const fetchAnalytics = fakeAnalytics();
  const mk = () => createCrmAnalyticsCollector({ workDir: work, fetchAnalytics, now: () => t, log: (l) => logs.push(l), pauseMs: 0, retryMs: 0 });
  const tick = mk();
  await Promise.all([tick(), tick()]);
  assert.equal(fetchAnalytics.calls.length, 3, "Nov 1..19 in three 7-day windows, run once");
  const state = JSON.parse(await readFile(join(work, "tracking-test", "crm-analytics-backfill", "collect-state.json"), "utf8"));
  assert.equal(state.daily, "2026-11-20");
  await mk()(); // a restarted server does not repeat today's job
  assert.equal(fetchAnalytics.calls.length, 3);
  assert.doesNotMatch(logs.join("\n"), /pii|O-2026/);

  const broken = fakeAnalytics({ fail: () => 503 });
  t = kst("2026-11-21T04:00:00");
  const tick2 = createCrmAnalyticsCollector({ workDir: work, fetchAnalytics: broken, now: () => t, log: () => {}, pauseMs: 0, retryMs: 0 });
  await tick2();
  await tick2(); // within the hour: no retry
  t = kst("2026-11-21T05:01:00"); await tick2();
  t = kst("2026-11-21T06:02:00"); await tick2();
  t = kst("2026-11-21T07:03:00"); await tick2();
  assert.equal(broken.calls.filter((c) => c.startsWith("2026-11")).length, 6, "daily: 3 attempts x (call + one retry)");
  assert.equal(broken.calls.filter((c) => c.startsWith("2026-10")).length, 6, "catch-up monthly: same limits");
});

test("CRM: collected files change only acquisition, never orders, amounts or member groups", async () => {
  const work = await mkdtemp(join(tmpdir(), "crm-collect-"));
  const orders = ["2026-10-02", "2026-10-09", "2026-10-20"].map((d, i) => ({ order_id: `O-${d}`, order_date: `${d}T10:00:00+09:00`, member_id: `m${i}`, first_order: "T", paid: "T", canceled: "F", actual_order_amount: { payment_amount: "10000" }, items: [] }));
  await mkdir(join(work, "tracking-test", "x"), { recursive: true });
  await writeFile(join(work, "tracking-test", "x", "SAMPLAS_MONTHLY_TRACKING_orders.json"), JSON.stringify({ data: { cafe24: { orders, analyticsBatches: [] } } }));
  const load = async () => buildCrmDataset({ snapshots: await loadTrackingSnapshots([join(work, "tracking-test")]), pseudonymize: (m) => `p-${m}` });
  const before = await load();
  await collectMonth({ fetchAnalytics: fakeAnalytics(), outDir: join(work, "tracking-test", "crm-analytics-backfill"), month: "2026-10", until: "2026-10-31", ...opts });
  const after = await load();
  assert.deepEqual(crmMonthly(after, "2026-10"), crmMonthly(before, "2026-10"));
  assert.equal(crmAcquisition(before, "2026-10").matchRate.matchedToAnalytics, 0);
  const acq = crmAcquisition(after, "2026-10");
  assert.equal(acq.matchRate.validOrders, 3);
  assert.equal(acq.matchRate.matchedToAnalytics, 3);
  assert.equal(acq.analyticsCoverage, "COMPLETE");
});

test("server wiring: collector is registered only when CRM_ANALYTICS_COLLECT=on", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /if \(env\.CRM_ANALYTICS_COLLECT === "on"\) \{\n\s+const crmAnalyticsTick = createCrmAnalyticsCollector\(\{ workDir, env, fetchAnalytics: fetchCafe24AnalyticsOrderDetails \}\);/);
});
