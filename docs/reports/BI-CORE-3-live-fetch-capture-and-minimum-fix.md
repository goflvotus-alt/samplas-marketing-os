# BI-CORE-3 — Live Monthly Fetch Capture

READ-ONLY (per Result D — see below). No server restart. No source file modified. No cache-clearing workaround used to reach the observation.

## Checkpoint A — Direct Capture

Method: rather than relying on screenshots/timing estimates, instrumented `window.fetch` at runtime inside the live page (a temporary in-memory wrapper installed via the browser's JS console equivalent — **not a file edit**, reverted automatically on navigation/close) to record start time, duration, HTTP status, parsed body's `error`/`archiveStatus` fields, and whether the `B00000KU` row was found, for every `/api/reports/monthly?month=...` call `refreshEntityTrendMonths()` actually issued. Then navigated to `http://127.0.0.1:8787/#brand-dashboard`, selected **CARNET ARCHIVE**, period **2026년 8월** (already the default), and let all 8 requests (Jan-Aug) complete naturally.

**Full capture, all 8 requests**:

| Month | Duration | HTTP | error | archiveStatus | B00000KU found | Revenue |
|---|---|---|---|---|---|---|
| 2026-01 | 36ms | 200 | null | saved | yes | 31,404,600 |
| 2026-02 | 38ms | 200 | null | saved | yes | 23,414,750 |
| 2026-03 | 48ms | 200 | null | saved | yes | 40,460,800 |
| 2026-04 | 52ms | 200 | null | saved | yes | 31,727,600 |
| 2026-05 | 69ms | 200 | null | saved | yes | 40,822,100 |
| 2026-06 | 65ms | 200 | null | saved | yes | 24,375,900 |
| 2026-07 | 27ms | 200 | null | saved | yes | 23,303,130 |
| **2026-08** | **1,974ms** | **200** | **null** | **live** | **yes** | **10,883,059** |

August (the live, uncached build) was, as expected architecturally, the slowest of the eight by roughly 30-70×, but at **1.97 seconds it used only ~25% of the 8-second client timeout budget** — comfortably successful, not a near-miss.

**Rendered UI, read directly from the DOM after the fetch completed**:
```
Revenue: 10,883,059원
Units:   32개
AOV:     435,322원
Orders:  25건
AI Summary: "8월 현재 누적 매출은 10,883,059원입니다. 매출의 90.6%가 오프라인에서 발생했습니다."
```

The AI Summary text confirms the **live-month branch** was taken (`entityIsLiveMonthRow(row)` was true), not the MoM-comparison branch that produced the user's reported "전월 대비 100% 감소" text — consistent with `archiveStatus: "live"` being received correctly this time.

This is the **third** independent reproduction attempt across BI-CORE-1/2/3 (initial test, two BI-CORE-2 attempts, this instrumented attempt) — all four produced correct, non-zero data, with measured durations of 0.77s-2.7s, none approaching the 8s timeout.

## Checkpoint B — Classification

**D — FAILURE NOT REPRODUCED.**

Everything rendered correctly during this direct, instrumented observation: HTTP 200, no `error` field, `archiveStatus: "live"`, the `B00000KU` row present, and correct values propagated all the way to the DOM. This does not contradict BI-CORE-2's hypothesis (a timeout race is, by nature, intermittent and load-dependent — a 1.97s response today says nothing about response time under different external-API latency conditions) — it simply means the specific failure could not be *captured* in this session, on this attempt, against the current state of the world (warm caches from repeated testing, no current Cafe24/Meta/Instagram slowness).

## Required Action for Result D (per task instructions — no code change)

**No source file was modified in this checkpoint.** Per the task's explicit branching, Result D calls for inspecting observability, not applying the retry fix (that is reserved for Result A, which was not obtained).

**Observability assessment** — confirmed by reading the source (`outputs/samplas-marketing-os.js`), not inferred:
- `getJson()`'s timeout/error catch block (line ~417) returns `{ error: ... }` **silently — no `console.error`/`console.warn` call anywhere in this path.** Grepped the entire frontend for `console.error`/`console.warn` near `getJson`/"응답 지연"/"monthly" — zero matches.
- `refreshEntityTrendMonths()` converts that error object into `entityTrendMonths[i] = { revenue: 0, quantitySold: 0, orderCount: 0, aov: 0, archiveStatus: null, ... }` — a shape **byte-for-byte indistinguishable** from a row that was fetched successfully but genuinely contains zero sales for that brand/month.
- Nothing in the DOM, console, or network-visible state marks a timed-out month differently from a real zero-revenue month. A developer (or this diagnosis, on a lucky/fast attempt) cannot tell the two apart without either (a) capturing the failure live, as attempted here, or (b) adding explicit instrumentation.
- This gap is real and independent of whether the timeout is ever actually hit in practice — it is a pre-existing observability weakness, not a hypothesis that needs the failure captured to be true.

**Smallest diagnostic/error-state improvement to propose (not implemented)**: give `refreshEntityTrendMonths()`'s per-month fetch the same shape of visibility Customer Composition already has for its own timeout (`getEntityCompositionJson`'s retry, `test/entity-composition-retry.test.mjs`'s existing coverage) — specifically:
1. `console.warn` (not `console.error`, to avoid tripping any error-monitoring on an expected/handled condition) when a month's fetch returns `{ error: "응답 지연" }`, naming the month, so a future occurrence is directly visible in the console instead of silently rendering as a plausible-looking zero.
2. Have `renderEntityHeroKpiFromMonthlyState()` distinguish "row not found because the fetch itself failed" (render `"-"`, consistent with the existing "NULL != ZERO" principle already tested in `test/brand-intelligence-partial-period.test.mjs` #10) from "row not found because this brand genuinely has no sales this month" (also `"-"`, already correct) vs. "row found with revenue exactly 0" (render `"0원"`, already correct) — today, a *fetch failure* incorrectly collapses into the same code path as "brand has zero real sales," when it should collapse into the same path as "row not found" (`"-"`) instead.
3. If BI-CORE-2's timeout hypothesis is ever directly confirmed in a future session, the retry pattern already used by `getEntityCompositionJson()` (one retry with an extended timeout, no infinite loop) remains the correct, smallest fix for the underlying slowness — this checkpoint is not recommending against that fix, only declining to apply it without Result A evidence, per the task's own explicit branching rule.

**This proposal is not implemented.** Per Result D's branching, it is reported here for the user's review before any code is touched.

## Original Repository Safety

`git status --short`: only the two prior untracked BI-CORE reports plus this one; `git diff --stat` and `git diff`: empty. No source, test, or data file modified. No server restart. No archive rebuild/upload. Nothing staged.
