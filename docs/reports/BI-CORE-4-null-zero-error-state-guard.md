# BI-CORE-4 — NULL != ZERO Error-State Guard

Implemented and verified. No commit, no push, no deploy. No unrelated file touched.

## 1. Pre-Flight

```
pwd    = ~/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com
branch = main
HEAD   = 24cf20efd0142e18bd1cdf4b1c828bc720f9b7f4
status (before edit) = only the 3 untracked BI-CORE-1/2/3 reports; git diff --stat empty
```
No pre-existing dirty tracked files existed to preserve (the repository was clean since the reconciliation merge — Checkpoint 13). The 3 BI-CORE reports were left untouched throughout.

## 2. Exact Current Path (before editing)

Confirmed by reading `outputs/samplas-marketing-os.js` directly:
- `getJson(url, timeoutMs = 8000)` — on `AbortError`/network failure, returns `{ error: "응답 지연" | error.message }`, no logging.
- `refreshEntityTrendMonths()` — built `entityTrendMonths[i]` with `revenue/quantitySold/orderCount/online/offline/aov` defaulted to **`0`** whenever no matching brand row was found (`row ? value : 0`), regardless of *why* the row was missing (genuine absence vs. `archive.error` from a timed-out fetch).
- `renderEntityHeroKpiFromMonthlyState()` — read those fields directly into the DOM via `apiWon`/`apiNum`, with no distinction between "real zero" and "fetch failed."
- No new architecture introduced — the fix stays entirely inside the existing state-shape/render functions already tracing this data.

## 3. Minimum Error State (implemented)

`entityTrendMonths[i]` now carries an explicit `fetchFailed: boolean` field, and — the core change — **`revenue`/`quantitySold`/`orderCount`/`online`/`offline`/`aov` are `null` (not fabricated `0`) whenever no brand row was found**, whether because the fetch itself failed or because the brand genuinely has no row that month. This reuses the exact convention this codebase already used for `entityTrendCompareMonths` ("월별 행이 없으면 null로 남겨 실제 0원으로 오해되지 않게 한다"), applied for the first time to the *primary* series.

```js
const fetchFailed = Boolean(archive?.error);
...
const revenue = row ? canonicalPaidAmount(row) : null;
const quantitySold = row ? Number(row.quantitySold || 0) : null;
const orderCount = row ? Number(row.orderCount || 0) : null;
const online = row ? Number(row.onlinePaidAmount || 0) : null;
const offline = row ? Number(row.offlineSalesAmount || 0) : null;
...
aov: row ? (orderCount ? Math.round(revenue / orderCount) : 0) : null,
...
fetchFailed
```
Success responses: `fetchFailed` is `false`; `archiveStatus`/brand-row data flow through exactly as before (verified byte-for-byte by the unchanged-regression test, §8 case 6/test 18).

## 4. Console Observability

```js
if (fetchFailed) {
  console.warn(`[Brand Intelligence] monthly fetch failure — month=${month}, reason=${archive.error}`);
}
```
`console.warn` (not `console.error`, per instructions), one line, names the month and the exact error reason already produced by `getJson()` (`"응답 지연"` or a caught error message) — no payload dump, no secrets (the error string never contains request/response bodies, only `AbortError`'s fixed message or a generic `error.message`). No log on success — confirmed live: exactly one warning appeared, only when the mocked failure was introduced (§11).

## 5. Hero KPI Rendering

`apiWon()`/`apiNum()` already treat `null` as `"-"` (`hasApiValue`), so `apiWon(row.revenue)`/`apiWon(row.aov)` needed no change. The two integer fields append a suffix (`개`/`건`) *outside* `apiNum()`, which would have produced `"-개"`/`"-건"` on `null` — fixed with an explicit check:
```js
qtyEl.textContent = row.quantitySold == null ? "-" : `${apiNum(row.quantitySold)}개`;
ordersEl.textContent = row.orderCount == null ? "-" : `${apiNum(row.orderCount)}건`;
```
Verified (unit tests 13-15, 18; live Chrome QA §11): fetch failure → all four "-"; successful row with real `0` → real `0원`/`0개`/`0건`/`0원`; successful response with no matching brand → "-". No formatting change for any valid number (test 18, unchanged from before this STEP).

## 6. AI Summary Safety

`renderEntityHeroInsight()` now short-circuits for a fetch-failed selected month, reusing the **existing** neutral fallback text verbatim (no new wording invented):
```js
if (row.fetchFailed) {
  summaryEl.textContent = "이번 기간 판단 가능한 데이터가 부족합니다.";
  ...
  return;
}
```
Also hardened `entityTrendMoMPct(index)` to return `null` (not a fabricated ±100%) whenever either the current or previous month's `revenue` is `null`, and filtered fetch-failed/null-revenue months out of the `completedRevenues` array used for the "이번 달 매출이 가장 낮습니다/높습니다" ranking sentence — without this, `Math.min(...)`/`Math.max(...)` coerce `null` to `0`, which would either falsely rank the failed month as the extreme, or (more subtly) mask a real extreme among the *other* months. Both false-inference paths named in the task are now structurally impossible, not just untriggered by luck (unit tests 16, 20; live QA §11 confirmed the actual rendered text).

## 7. Monthly Trend Safety

Two related fixes, both reusing patterns already present in the file rather than inventing new ones:
- **Chart** (`entityTrendChartSvg()`): excluded fetch-failed months from the `min`/`max` axis-range calculation; compute `y: null` for a fetch-failed month's coordinate; split the primary polyline into segments around any `null`-`y` gap (mirroring the exact segment-splitting pattern the compare line already used); skip the `<circle>` point for fetch-failed months. Axis text labels are still rendered for every month (unchanged) — only the data point/line is omitted, never faked at zero.
- **Trend stats** (`renderEntityTrendSection()`'s `completedMonths`): added `&& !row.fetchFailed` to the existing "exclude live month" filter, so Max/Min/평균 AOV/trend-direction indicators can no longer be corrupted by a `null`-as-`0` coercion. This is a 1-line extension of an existing filter, not a redesign, and was necessary because those statistics read the exact same `entityTrendMonths` fields this STEP changed to `null`.

Verified via unit tests 17 (chart point count) and 19 (Min/Max exclusion), and live in Chrome (§11: chart showed 7 plotted points for Jan-Jul with no dip at August, and 최저 매출/평균 객단가 correctly reflected only the 7 real months).

Not touched: the chart's own SVG structure, the "insight" narrative paragraph's wording logic (only its already-correct upstream inputs were fixed), and the SKU-count line (`renderEntityHeroSku`) — that line's data comes from a wholly separate endpoint (`/api/brand-intelligence/{code}/customer-composition`, per BI-CORE-2 §5) outside this STEP's named scope (Revenue/Units/Orders/AOV), and was left as-is deliberately.

## 8. Tests Added

All 8 new tests appended to `test/brand-intelligence-partial-period.test.mjs` (the existing home for this exact source-extraction test harness — no new test infrastructure invented):

| # | Case | Covers |
|---|---|---|
| 13 | Monthly fetch failure | Hero KPIs render "-" for all four metrics, never `0` |
| 14 | Successful row, genuine zero | Hero KPIs render real `0원`/`0개`/`0건`/`0원` |
| 15 | Successful response, no matching brand row | "-", not a fabricated `0` |
| 16 | Fetch failure | AI Summary shows the neutral fallback, never a false `-100%` MoM or ranking claim |
| 17 | Fetch failure | Trend chart plots no point for the failed month; only successful months get a `<circle>` |
| 18 | Successful CARNET ARCHIVE values | Unchanged: `10,883,059원`/`32개`/`25건`/`435,322원` |
| 19 | Fetch-failed month mixed with real months | Excluded from Max/Min trend stats (would otherwise falsely win "lowest") |
| 20 | `entityTrendMoMPct()` unit check | `null` current or previous revenue → `null`, never a fabricated ±100% |

```
node --test test/brand-intelligence-partial-period.test.mjs
→ 19 tests, 19 pass, 0 fail   (tests 1-12 pre-existing, unmodified, all still pass; 13-20 new)
```

## 9. Targeted Verification

```
node --test test/brand-intelligence-partial-period.test.mjs test/cross-brand-period-cutoff.test.mjs test/cross-brand-partial-period-p2.test.mjs test/unified-identity-resolver.test.mjs test/monthly-brand-sales.test.mjs test/monthly-archive-freshness.test.mjs test/entity-composition-retry.test.mjs test/brand-comparison-summary.test.mjs test/brand-comparison-yoy-timeout.test.mjs
→ 108 tests, 108 pass, 0 fail
```
Covers: Brand Intelligence (this STEP), STEP67 (cross-brand-period-cutoff, cross-brand-partial-period-p2), Brand Identity (unified-identity-resolver, monthly-brand-sales), Monthly Archive (monthly-archive-freshness), Customer Composition (entity-composition-retry), and cross-brand comparison summary/timeout regressions. All pass — proceeded to full regression.

## 10. Full Regression

```
node --test test/*.test.mjs
→ 342 tests, 342 pass, 0 fail, 0 skipped
```
(334 before this STEP + 8 new = 342; no pre-existing test weakened, none skipped, no unrelated failure chased or masked.)

## 11. Chrome QA

**Normal state** (hard-refreshed `http://127.0.0.1:8787/#brand-dashboard`, selected CARNET ARCHIVE, period 2026년 8월, real server, no mocking):
```
Revenue: 10,883,059원
Units:   32개
Orders:  25건
AOV:     435,322원
```
Unchanged from BI-CORE-1/2/3 — confirms this STEP introduced no regression to the success path.

**Failure state**, verified through a deterministic client-side mock (not a real service outage — per instructions, no external API was broken and no service was stopped): installed a temporary `window.fetch` override in the live page that intercepts only `GET /api/reports/monthly?month=2026-08` and resolves it with the exact `{ error: "응답 지연" }` shape `getJson()`'s own timeout handler already produces, leaving every other request (including the other 7 months, Inventory, Customer Composition) hitting the real server unmodified. Cleared the app's own `sharedJsonRequests` cache and called its own `refreshEntityTrendMonths()` to force a fresh fetch under the mock.

Result, read directly from the rendered page:
```
Revenue: -
Units:   -
Orders:  -
AOV:     -
AI Summary: "이번 기간 판단 가능한 데이터가 부족합니다."   (no -100%/false claim)
Trend chart: 7 points plotted (Jan-Jul), no point/dip at Aug; label "8월" still shown on the axis
최저 매출 (lowest revenue): 23,303,130원 · 2026-07   (July — not the failed August, not a fake 0)
평균 객단가 (avg AOV): 393,006원   (computed over the 7 real months only)
Console: exactly one line — "[Brand Intelligence] monthly fetch failure — month=2026-08, reason=응답 지연" (WARNING level)
Inventory: 272개, offline SKU count: 23개   (unaffected — separate endpoints, confirms BI-CORE-2's isolation finding)
```
Reloaded (hard refresh) immediately after to remove the temporary mock and confirm the app returns cleanly to the normal, correct state — re-verified.

## 12. Scope Guard

Not touched: Sell-through, Category Intelligence implementation, Compare Mode, Customer Composition design, canonical sales formulas (`server.mjs`, `scripts/monthly-brand-sales.mjs`, `scripts/unified-identity-resolver.mjs` — all untouched), brand identity resolver semantics, Monthly Archive semantics, server-side revenue calculations, production data. No retry logic added — deferred per instructions, unchanged from BI-CORE-3's conclusion.

## Files Modified

- `outputs/samplas-marketing-os.js` (78 lines changed: 61 insertions, 17 deletions — all within `refreshEntityTrendMonths`, `renderEntityHeroKpiFromMonthlyState`, `renderEntityHeroInsight`, `entityTrendMoMPct`, `entityTrendChartSvg`, `renderEntityTrendSection`)
- `test/brand-intelligence-partial-period.test.mjs` (119 lines added: 8 new tests, existing 12 untouched)

No other file modified. `docs/reports/BI-CORE-1/2/3-*.md` remain untracked, unstaged, unmodified.
