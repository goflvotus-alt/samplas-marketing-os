import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { captureWeeklyFollowers } from "../scripts/weekly-account-demand.mjs";
import { seoulDateKey } from "../scripts/naver-ads-weekly-report.mjs";

// Same source-extraction pattern as the weekly scheduler tests: the real scheduler code from
// server.mjs runs in a vm context; only Graph and the clock are fakes. The snapshot store and
// captureWeeklyFollowers() are real.
const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const start = source.indexOf("// Daily 10:xx KST follower snapshot");
const end = source.indexOf("// Naver Search Ads Weekly Report: same in-process", start);
assert.ok(start > 0 && end > start, "daily follower snapshot section not found");
const schedulerSource = `${source.slice(start, end)}\nthis.run = runInstagramDailyFollowerSnapshot; this.state = () => instagramFollowerSnapshotScheduler;`;

const clockAt = (iso) => { const t = Date.parse(iso); return class extends Date { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; };

async function harness({ followersFor = () => 46000, graphFails = () => false } = {}) {
  const workDir = await mkdtemp(join(tmpdir(), "ig-daily-followers-"));
  const graphCalls = [], logged = [];
  let clock;
  const context = {
    env: { INSTAGRAM_BUSINESS_ACCOUNT_ID: "17840000000000000" },
    workDir, join, seoulDateKey, captureWeeklyFollowers,
    graphGet: async (id, params) => {
      graphCalls.push({ id, params, at: clock });
      if (graphFails(clock)) throw new Error("Graph API 인증 실패 (code 190)");
      return { id, followers_count: followersFor(clock) };
    },
    safeErrorMessage: (error) => String(error?.message || error),
    logApiError: async (sourceName, error) => { logged.push(`${sourceName}: ${error.message}`); }
  };
  runInNewContext(schedulerSource, context);
  const at = (iso) => { clock = iso; context.Date = clockAt(iso); return context.run(); };
  return { at, state: context.state, graphCalls, logged, store: join(workDir, "instagram-weekly-followers.json") };
}

test("captures once per day inside 10:00-10:59 KST only; no Graph call outside the window", async () => {
  const h = await harness();
  await h.at("2026-10-14T00:59:00Z"); // 09:59 KST
  await h.at("2026-10-14T02:00:00Z"); // 11:00 KST
  assert.equal(h.graphCalls.length, 0);
  await h.at("2026-10-14T01:00:00Z");
  await h.at("2026-10-14T01:15:00Z");
  await h.at("2026-10-14T01:45:00Z");
  assert.equal(h.graphCalls.length, 1);
  const store = JSON.parse(await readFile(h.store, "utf8"));
  assert.deepEqual(store.snapshots.map((s) => [s.date, s.followers]), [["2026-10-14", 46000]]);
  assert.equal(h.state().lastDate, "2026-10-14");
});

test("a week whose Tuesday report failed still gives the next Tuesday a real 7-day delta", async () => {
  const followers = { "2026-10-13": 46031, "2026-10-20": 46095 };
  const h = await harness({ followersFor: (iso) => followers[iso.slice(0, 10)] ?? 46050 });
  // Daily polls 10-13 .. 10-20 at 10:00 KST; the 10-13 weekly report itself never ran.
  for (let day = 13; day <= 20; day += 1) await h.at(`2026-10-${day}T01:00:00Z`);
  // The 10-20 weekly report captures a few minutes later and reuses today's snapshot.
  const weekly = await captureWeeklyFollowers(h.store, { accountId: "17840000000000000", followers: 46095, capturedAt: "2026-10-20T01:07:00.000Z" });
  assert.equal(weekly.previous.date, "2026-10-13");
  assert.equal(weekly.delta, 64);
  assert.equal(weekly.reason, "실제 수집일 7일 간격 (2시간 이내) 스냅샷 비교");
});

test("Graph failure is persisted, stores nothing, and is retried on the next poll the same day", async () => {
  const h = await harness({ graphFails: (iso) => iso < "2026-10-14T01:15" });
  await h.at("2026-10-14T01:00:00Z");
  assert.deepEqual(h.logged, ["instagram_daily_follower_snapshot: Graph API 인증 실패 (code 190)"]);
  assert.equal(h.state().lastDate, null);
  await assert.rejects(readFile(h.store, "utf8"), { code: "ENOENT" });
  await h.at("2026-10-14T01:15:00Z");
  assert.equal(h.state().lastDate, "2026-10-14");
  assert.equal(h.state().lastError, null);
});

test("a missing followers_count is never stored as a value", async () => {
  const h = await harness({ followersFor: () => undefined });
  await h.at("2026-10-14T01:00:00Z");
  assert.deepEqual(h.logged, ["instagram_daily_follower_snapshot: 현재 followers_count 미제공"]);
  assert.equal(h.state().lastDate, null);
  await assert.rejects(readFile(h.store, "utf8"), { code: "ENOENT" });
});
