import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

// Source-extraction pattern already used across this repo's test suite (e.g.
// test/naver-ads-read-only.test.mjs, test/server-advertising-route-forwarding.test.mjs):
// the REAL naverWeeklyReportScheduler state object + runNaverWeeklyReportCheck()/
// fetchNaverAdsPerformanceForWeeklyReport() bodies are pulled out of server.mjs as text
// and executed in a vm context with injected fakes for generateWeeklyNaverAdsReport,
// isWeeklyNaverReportDue, resolveWeeklyReportDestination and saveWeeklyReportToDropbox —
// this tests the actual success/failure/idempotency state machine shipped in server.mjs,
// not a hand-written reimplementation of it.
const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
function section(start, end) {
  assert.ok(source.includes(start), `missing marker: ${start}`);
  assert.ok(source.includes(end), `missing marker: ${end}`);
  return source.slice(source.indexOf(start), source.indexOf(end));
}
// naverWeeklyReportScheduler is a lexically-scoped const inside the sliced script (not
// exposed on the vm context object, same pitfall documented elsewhere in this test
// suite) — appending a getter in the SAME executed script gives it access via closure.
// End marker stops right after runNaverWeeklyReportCheck() — NOT at the old
// "// TEMPORARY diagnostic" marker anymore, since the Meta/Instagram weekly report
// schedulers were added directly after this Naver block and before that comment; slicing
// through them too would pull in `export` keywords (SyntaxError in a vm script) and
// unrelated identifiers this test never mocks. Naver's own scheduler code is unchanged.
const schedulerSource = [
  section("const naverWeeklyReportScheduler = {", "// Meta Ads Weekly Report scheduler"),
  "function __getSchedulerState() { return { ...naverWeeklyReportScheduler }; }"
].join("\n");

function freshContext(overrides = {}) {
  const context = {
    env: {},
    URL,
    capturingResponse: () => ({}),
    handleNaverAdsReadOnlyRoute: async () => {},
    resolveWeeklyReportDestination: () => ({ mode: "dropbox" }),
    saveWeeklyReportToDropbox: async () => ({ uploaded: true }),
    isWeeklyNaverReportDue: () => true,
    seoulDateKey: () => "2026-09-29",
    safeErrorMessage: (error) => String(error?.message || error),
    logApiError: async () => {},
    ...overrides
  };
  runInNewContext(schedulerSource, context);
  return context;
}

test("9a. generation + upload success marks the week complete", async () => {
  const ctx = freshContext({
    generateWeeklyNaverAdsReport: async () => ({ ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/SAMPLAS WORK/.../f.xlsx", uploaded: true })
  });
  await ctx.runNaverWeeklyReportCheck();
  assert.equal(ctx.__getSchedulerState().lastRunSinceKey, "2026-09-22");
  assert.ok(ctx.__getSchedulerState().lastSuccessAt);
  assert.equal(ctx.__getSchedulerState().lastError, null);
  assert.equal(ctx.__getSchedulerState().lastUploadedReport, "/SAMPLAS WORK/.../f.xlsx");
});

test("9b. generation success but Dropbox upload failure does NOT mark the week complete", async () => {
  const ctx = freshContext({
    generateWeeklyNaverAdsReport: async () => { throw new Error("Dropbox upload failed (HTTP 507): insufficient_space"); }
  });
  await ctx.runNaverWeeklyReportCheck();
  assert.equal(ctx.__getSchedulerState().lastRunSinceKey, null);
  assert.equal(ctx.__getSchedulerState().lastSuccessAt, null);
  assert.match(ctx.__getSchedulerState().lastError, /insufficient_space/);
});

test("9c. a later retry succeeds after an earlier failure in the same window", async () => {
  let attempt = 0;
  const ctx = freshContext({
    generateWeeklyNaverAdsReport: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network error");
      return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx", uploaded: true };
    }
  });
  await ctx.runNaverWeeklyReportCheck(); // fails
  assert.equal(ctx.__getSchedulerState().lastRunSinceKey, null);
  await ctx.runNaverWeeklyReportCheck(); // next 15-minute poll, succeeds
  assert.equal(ctx.__getSchedulerState().lastRunSinceKey, "2026-09-22");
  assert.equal(attempt, 2);
});

test("9d. once this week is marked complete, isWeeklyNaverReportDue(false) prevents a duplicate run", async () => {
  let calls = 0;
  const ctx = freshContext({
    isWeeklyNaverReportDue: (_now, lastRunSinceKey) => lastRunSinceKey !== "2026-09-22",
    generateWeeklyNaverAdsReport: async () => {
      calls += 1;
      return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx", uploaded: true };
    }
  });
  await ctx.runNaverWeeklyReportCheck();
  await ctx.runNaverWeeklyReportCheck(); // same poll cycle again, e.g. 15 min later, same week
  assert.equal(calls, 1); // generation/upload only ever ran once
});

// 10. server-restart-style duplicate scenario: scheduler state is process-memory-only, so
// a restart resets lastRunSinceKey to null — but if the report already exists in Dropbox
// from before the restart, saveWeeklyReportToDropbox (exercised for real in
// test/dropbox-report-uploader.test.mjs) returns alreadyExists:true instead of uploading
// again. Here we confirm the scheduler treats that idempotent success exactly like a
// fresh upload — i.e. restart-safe without any new persistent state.
test("10. restart-style duplicate: report already exists in Dropbox -> still marked complete, no re-upload attempted twice", async () => {
  const ctx = freshContext({
    // Simulates naverWeeklyReportScheduler having just been re-created after a restart
    // (lastRunSinceKey already null by construction of freshContext).
    generateWeeklyNaverAdsReport: async () => ({
      ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/SAMPLAS WORK/.../f.xlsx", uploaded: false, alreadyExists: true
    })
  });
  await ctx.runNaverWeeklyReportCheck();
  assert.equal(ctx.__getSchedulerState().lastRunSinceKey, "2026-09-22");
  assert.equal(ctx.__getSchedulerState().lastError, null);
});

test("dropbox mode is only selected when resolveWeeklyReportDestination says so; local mode gets no saveReport override", async () => {
  let capturedSaveReport = "not called";
  const ctx = freshContext({
    resolveWeeklyReportDestination: () => ({ mode: "local" }),
    generateWeeklyNaverAdsReport: async (options) => {
      capturedSaveReport = options.saveReport;
      return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/local/f.xlsx" };
    }
  });
  await ctx.runNaverWeeklyReportCheck();
  assert.equal(capturedSaveReport, undefined);
});

// Blocker 1 fix: a partially-configured Dropbox must fail closed — the scheduler must
// never fall through to generateWeeklyNaverAdsReport() at all (so neither a Dropbox
// upload nor a local-filesystem write is even attempted), must not mark the week
// complete, and must record a safe error naming only the missing env var(s).
test("partial Dropbox config fails closed: no report is generated, week is not marked complete, error names only the missing vars", async () => {
  let generateCalls = 0;
  const ctx = freshContext({
    resolveWeeklyReportDestination: () => ({ mode: "misconfigured", missing: ["DROPBOX_REFRESH_TOKEN"] }),
    generateWeeklyNaverAdsReport: async () => { generateCalls += 1; return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx" }; }
  });
  await ctx.runNaverWeeklyReportCheck();
  assert.equal(generateCalls, 0); // neither a Dropbox upload nor a local write was ever attempted
  assert.equal(ctx.__getSchedulerState().lastRunSinceKey, null);
  assert.equal(ctx.__getSchedulerState().lastSuccessAt, null);
  assert.match(ctx.__getSchedulerState().lastError, /DROPBOX_REFRESH_TOKEN/);
});

test("a concurrent poll while already running is a no-op (running flag guard)", async () => {
  let concurrentCalls = 0;
  let releaseFirstCall;
  const stillRunning = new Promise((resolve) => { releaseFirstCall = resolve; });
  const ctx = freshContext({
    generateWeeklyNaverAdsReport: async () => {
      concurrentCalls += 1;
      await stillRunning; // stays "in flight" until the test explicitly releases it
      return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx" };
    }
  });
  const firstCall = ctx.runNaverWeeklyReportCheck(); // not awaited yet — still in flight
  await ctx.runNaverWeeklyReportCheck(); // second poll while the first is still running
  assert.equal(concurrentCalls, 1);
  releaseFirstCall();
  await firstCall;
});
