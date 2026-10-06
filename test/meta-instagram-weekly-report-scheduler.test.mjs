import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

// Same source-extraction technique as test/naver-weekly-report-scheduler.test.mjs: pull the
// REAL metaWeeklyReportScheduler/instagramWeeklyReportScheduler state objects + their
// runXWeeklyReportCheck() bodies out of server.mjs as text and execute them in a vm context
// with injected fakes — this exercises the actual state machine shipped in server.mjs, not a
// hand-written reimplementation of it. The Naver scheduler section (which sits textually
// before this one) is deliberately excluded from the slice so it is never re-executed here.
const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
function section(start, end) {
  assert.ok(source.includes(start), `missing marker: ${start}`);
  assert.ok(source.includes(end), `missing marker: ${end}`);
  return source.slice(source.indexOf(start), source.indexOf(end));
}

// Each platform's scheduler state + runXWeeklyReportCheck() straddle an exported thin
// adapter function (buildMetaAdsSummaryForWeeklyReport / buildInstagramRangeDataForWeeklyReport)
// sitting textually between them — a real `export` keyword there is a SyntaxError inside a vm
// script (same pitfall documented in test/naver-weekly-report-scheduler.test.mjs), so each
// slice is built from two disjoint pieces that skip over that export function entirely.
const metaSchedulerSource = [
  section("const metaWeeklyReportScheduler = {", "// Thin adapter: reuses the existing buildMetaAdsSummaryWithCache"),
  section("async function runMetaWeeklyReportCheck()", "// Instagram Weekly Report scheduler"),
  "function __getMetaSchedulerState() { return { ...metaWeeklyReportScheduler }; }"
].join("\n");

const instagramSchedulerSource = [
  section("const instagramWeeklyReportScheduler = {", "// Thin adapter over the existing buildInstagramRangeData"),
  section("async function runInstagramWeeklyReportCheck()", "// TEMPORARY diagnostic"),
  "function __getInstagramSchedulerState() { return { ...instagramWeeklyReportScheduler }; }"
].join("\n");

function freshMetaContext(overrides = {}) {
  const context = {
    env: {},
    isWeeklyNaverReportDue: () => true,
    resolvePlatformDropboxDestination: () => ({ mode: "dropbox", dir: "/SAMPLAS WORK/병구 작업/메타 광고/리포트" }),
    saveWeeklyReportToDropboxAtPath: async () => ({ uploaded: true }),
    // runMetaWeeklyReportCheck() references this identifier directly (as the fetchByLevel
    // arg) — it's normally the real exported adapter, excluded from this slice on purpose
    // (see the SyntaxError comment above), so a harmless stand-in is injected here.
    buildMetaAdsSummaryForWeeklyReport: () => {},
    fetchCafe24ActualOrdersForWeeklyReport: () => {},
    safeErrorMessage: (error) => String(error?.message || error),
    logApiError: async () => {},
    seoulDateKey: () => "2026-09-29",
    ...overrides
  };
  runInNewContext(metaSchedulerSource, context);
  return context;
}

function freshInstagramContext(overrides = {}) {
  const context = {
    env: {},
    isWeeklyNaverReportDue: () => true,
    resolvePlatformDropboxDestination: () => ({ mode: "local" }),
    saveWeeklyReportToDropboxAtPath: async () => ({ uploaded: true }),
    // Same reasoning as buildMetaAdsSummaryForWeeklyReport above.
    buildInstagramRangeDataForWeeklyReport: () => {},
    safeErrorMessage: (error) => String(error?.message || error),
    logApiError: async () => {},
    seoulDateKey: () => "2026-09-29",
    ...overrides
  };
  runInNewContext(instagramSchedulerSource, context);
  return context;
}

// --- Meta scheduler ---

test("Meta: generation + save success marks the week complete", async () => {
  const ctx = freshMetaContext({
    generateWeeklyMetaAdsReport: async () => ({ ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x/META_ADS_WEEKLY_2026-09-22_2026-09-28.xlsx" })
  });
  await ctx.runMetaWeeklyReportCheck();
  const state = ctx.__getMetaSchedulerState();
  assert.equal(state.lastRunSinceKey, "2026-09-22");
  assert.ok(state.lastSuccessAt);
  assert.equal(state.lastError, null);
});

test("Meta: partial Dropbox config fails closed — no report generated, week not marked complete", async () => {
  let generateCalls = 0;
  const ctx = freshMetaContext({
    resolvePlatformDropboxDestination: () => ({ mode: "misconfigured", missing: ["DROPBOX_REFRESH_TOKEN"] }),
    generateWeeklyMetaAdsReport: async () => { generateCalls += 1; return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx" }; }
  });
  await ctx.runMetaWeeklyReportCheck();
  assert.equal(generateCalls, 0);
  const state = ctx.__getMetaSchedulerState();
  assert.equal(state.lastRunSinceKey, null);
  assert.match(state.lastError, /DROPBOX_REFRESH_TOKEN/);
});

test("Meta: canonical Dropbox path is dir + META_ADS_WEEKLY_<since>_<until>.xlsx", async () => {
  let capturedTargetPath;
  const ctx = freshMetaContext({
    generateWeeklyMetaAdsReport: async (options) => {
      const saved = await options.saveReport({}, { since: "2026-09-22", until: "2026-09-28" });
      return { ok: true, since: "2026-09-22", until: "2026-09-28", ...saved };
    },
    saveWeeklyReportToDropboxAtPath: async (workbook, { targetPath }) => { capturedTargetPath = targetPath; return { uploaded: true, filePath: targetPath }; }
  });
  await ctx.runMetaWeeklyReportCheck();
  assert.equal(capturedTargetPath, "/SAMPLAS WORK/병구 작업/메타 광고/리포트/META_ADS_WEEKLY_2026-09-22_2026-09-28.xlsx");
});

test("Meta: a same-size existing Dropbox file (duplicate prevention / restart safety) still marks the week complete without re-upload", async () => {
  const ctx = freshMetaContext({
    generateWeeklyMetaAdsReport: async () => ({ ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x/META_ADS_WEEKLY_2026-09-22_2026-09-28.xlsx", uploaded: false, alreadyExists: true })
  });
  await ctx.runMetaWeeklyReportCheck();
  const state = ctx.__getMetaSchedulerState();
  assert.equal(state.lastRunSinceKey, "2026-09-22");
  assert.equal(state.lastError, null);
});

test("Meta: upload failure and retry — a failed poll does not mark the week complete, and a later poll succeeds", async () => {
  let attempt = 0;
  const ctx = freshMetaContext({
    generateWeeklyMetaAdsReport: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("Dropbox upload failed (HTTP 507): insufficient_space");
      return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx" };
    }
  });
  await ctx.runMetaWeeklyReportCheck();
  assert.equal(ctx.__getMetaSchedulerState().lastRunSinceKey, null);
  await ctx.runMetaWeeklyReportCheck();
  assert.equal(ctx.__getMetaSchedulerState().lastRunSinceKey, "2026-09-22");
  assert.equal(attempt, 2);
});

test("Meta: a concurrent poll while already running is a no-op (running flag guard)", async () => {
  let concurrentCalls = 0;
  let releaseFirstCall;
  const stillRunning = new Promise((resolve) => { releaseFirstCall = resolve; });
  const ctx = freshMetaContext({
    generateWeeklyMetaAdsReport: async () => {
      concurrentCalls += 1;
      await stillRunning;
      return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx" };
    }
  });
  const firstCall = ctx.runMetaWeeklyReportCheck();
  await ctx.runMetaWeeklyReportCheck();
  assert.equal(concurrentCalls, 1);
  releaseFirstCall();
  await firstCall;
});

// --- Instagram scheduler ---

test("Instagram: generation + local save success marks the week complete", async () => {
  const ctx = freshInstagramContext({
    generateWeeklyInstagramReport: async () => ({ ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/local/INSTAGRAM_WEEKLY_2026-09-22_2026-09-28.xlsx" })
  });
  await ctx.runInstagramWeeklyReportCheck();
  const state = ctx.__getInstagramSchedulerState();
  assert.equal(state.lastRunSinceKey, "2026-09-22");
  assert.equal(state.lastError, null);
});

test("Instagram: uses the confirmed default Dropbox dir 인스타그램 리포트, overridable via DROPBOX_INSTAGRAM_WEEKLY_REPORT_DIR", async () => {
  let capturedOptions;
  const ctx = freshInstagramContext({
    resolvePlatformDropboxDestination: (env, options) => { capturedOptions = options; return { mode: "local" }; },
    generateWeeklyInstagramReport: async () => ({ ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/local/x.xlsx" })
  });
  await ctx.runInstagramWeeklyReportCheck();
  assert.equal(capturedOptions.dirEnvKey, "DROPBOX_INSTAGRAM_WEEKLY_REPORT_DIR");
  assert.equal(capturedOptions.defaultDir, "/SAMPLAS WORK/병구 작업/인스타그램 리포트");
});

test("Instagram: partial Dropbox config fails closed — no report generated, week not marked complete", async () => {
  let generateCalls = 0;
  const ctx = freshInstagramContext({
    resolvePlatformDropboxDestination: () => ({ mode: "misconfigured", missing: ["DROPBOX_APP_SECRET"] }),
    generateWeeklyInstagramReport: async () => { generateCalls += 1; return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx" }; }
  });
  await ctx.runInstagramWeeklyReportCheck();
  assert.equal(generateCalls, 0);
  const state = ctx.__getInstagramSchedulerState();
  assert.equal(state.lastRunSinceKey, null);
  assert.match(state.lastError, /DROPBOX_APP_SECRET/);
});

test("Instagram: canonical Dropbox path is the confirmed 인스타그램 리포트 dir + INSTAGRAM_WEEKLY_<since>_<until>.xlsx", async () => {
  let capturedTargetPath;
  const ctx = freshInstagramContext({
    resolvePlatformDropboxDestination: () => ({ mode: "dropbox", dir: "/SAMPLAS WORK/병구 작업/인스타그램 리포트" }),
    generateWeeklyInstagramReport: async (options) => {
      const saved = await options.saveReport({}, { since: "2026-09-22", until: "2026-09-28" });
      return { ok: true, since: "2026-09-22", until: "2026-09-28", ...saved };
    },
    saveWeeklyReportToDropboxAtPath: async (workbook, { targetPath }) => { capturedTargetPath = targetPath; return { uploaded: true, filePath: targetPath }; }
  });
  await ctx.runInstagramWeeklyReportCheck();
  assert.equal(capturedTargetPath, "/SAMPLAS WORK/병구 작업/인스타그램 리포트/INSTAGRAM_WEEKLY_2026-09-22_2026-09-28.xlsx");
});

test("Instagram: a same-size existing Dropbox file (restart safety) still marks the week complete without re-upload", async () => {
  const ctx = freshInstagramContext({
    resolvePlatformDropboxDestination: () => ({ mode: "dropbox", dir: "/SAMPLAS WORK/병구 작업/인스타그램 리포트" }),
    generateWeeklyInstagramReport: async () => ({ ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x/INSTAGRAM_WEEKLY_2026-09-22_2026-09-28.xlsx", uploaded: false, alreadyExists: true })
  });
  await ctx.runInstagramWeeklyReportCheck();
  const state = ctx.__getInstagramSchedulerState();
  assert.equal(state.lastRunSinceKey, "2026-09-22");
  assert.equal(state.lastError, null);
});

test("Instagram: a concurrent poll while already running is a no-op (running flag guard)", async () => {
  let concurrentCalls = 0;
  let releaseFirstCall;
  const stillRunning = new Promise((resolve) => { releaseFirstCall = resolve; });
  const ctx = freshInstagramContext({
    generateWeeklyInstagramReport: async () => {
      concurrentCalls += 1;
      await stillRunning;
      return { ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx" };
    }
  });
  const firstCall = ctx.runInstagramWeeklyReportCheck();
  await ctx.runInstagramWeeklyReportCheck();
  assert.equal(concurrentCalls, 1);
  releaseFirstCall();
  await firstCall;
});

// --- destination lock: asserts against the REAL server.mjs source text, not a mock, so a
// future edit that silently reintroduces the wrong Meta path or drops Instagram's confirmed
// default would fail this test even if every mocked scheduler test above still passed. ---

test("destination lock: server.mjs hardcodes exactly the three approved default directories and never the old Meta path", () => {
  assert.match(source, /defaultDir:\s*"\/SAMPLAS WORK\/병구 작업\/메타 광고\/리포트"/);
  assert.match(source, /defaultDir:\s*"\/SAMPLAS WORK\/병구 작업\/인스타그램 리포트"/);
  assert.doesNotMatch(source, /메타 광고 리포트"/); // the old, incorrect Meta path (without the "/" segment)
});

// --- isolation between the two platforms ---

test("isolation: a Meta scheduler exception does not touch the Instagram scheduler's state (and vice versa)", async () => {
  const metaCtx = freshMetaContext({
    generateWeeklyMetaAdsReport: async () => { throw new Error("Meta Graph API rate limited"); }
  });
  const instagramCtx = freshInstagramContext({
    generateWeeklyInstagramReport: async () => ({ ok: true, since: "2026-09-22", until: "2026-09-28", filePath: "/x.xlsx" })
  });
  await metaCtx.runMetaWeeklyReportCheck();
  await instagramCtx.runInstagramWeeklyReportCheck();
  assert.match(metaCtx.__getMetaSchedulerState().lastError, /rate limited/);
  assert.equal(instagramCtx.__getInstagramSchedulerState().lastRunSinceKey, "2026-09-22");
  assert.equal(instagramCtx.__getInstagramSchedulerState().lastError, null);
});
