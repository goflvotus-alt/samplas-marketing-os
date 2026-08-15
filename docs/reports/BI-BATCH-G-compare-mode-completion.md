# BI-BATCH-G — Compare Mode Completion

Live-first sweep of the existing Compare Mode architecture: 1 real bug found and fixed, everything else confirmed already complete. One commit, no push, no deploy.

## Pre-Flight

```
branch = main
HEAD (start) = cebc91b24bbbcacaef57ee70dabba49877fae63f
```
`c9d90f4` / `92cba37` / `2c90677` / `43ed178` / `0d5df53` / `cebc91b` all present. BI-BATCH-E was already committed as `cebc91b` — no checkpoint commit needed. Working tree clean except the usual untracked `docs/reports/*.md` files.

## Method

Per instruction, started from the live UI (real click path for brand selection and the Compare toggle; `window.selectBrandSelectorName()`/`window.selectEntityCompareBrandB()` — the actual wrapper functions the click handlers call, not the lower-level `applyBrandIdentity()` alone, which BI-BATCH-E already found gives a misleading "didn't select" signal if called directly) before reading any source. Source was only traced for the one gap actually found.

## Compare Semantics (as built, not assumed)

Traced from the live UI and `entityCompareTargetPeriodData`/`entityComparePeriodKeyForMode`:

- **Baseline** = the primary Brand Selector's brand + the global period selector's month (shared with Single-Brand — same `entityPeriodState`).
- **Comparison brand** = an independent second brand, selected via its own selector (`entityCompareBrandBSelection`), defaulting to none ("비교 브랜드 선택").
- **Comparison target period**, independent of comparison brand — three modes, confirmed live:
  - `prev` — previous calendar month (correct rollover, e.g. would roll year on January, not separately re-verified this batch since STEP67-10G-0/1 already proved it and nothing in this batch touches that logic).
  - `yoy` — same month, previous year.
  - `custom` — **not implemented** (confirmed, matches STEP67-10G-5's finding verbatim, unchanged): selecting it correctly shows "비교 대상 미확정" (undetermined) and every Period Performance cell honestly shows "데이터 연결 대기" — no fake date-picker exists and none was added.
- When the baseline period is the **current, in-progress month**, the comparison is automatically **cutoff-normalized to the same elapsed days** (e.g. 8/1–8/12 vs 7/1–7/12) via a dedicated server endpoint (`/api/reports/monthly-comparison-cutoff`) — confirmed live in the header ("동일 경과일 기준") and in the Comparison Summary text's own explicit disclosure sentence.

This is all pre-existing (STEP59-4C/STEP67-9E/STEP67-10G-0~4) — none of it was redesigned.

## Gap Found and Fixed

**The compare-target selector (`#entityCompareTarget`, previous/YoY/custom) did not refresh the actual comparison data when changed — only its own header label.**

Live-confirmed: switching from "previous month" to "YoY" correctly updated the small header text ("비교 대상 2025년 8월") but the "Period Performance" table below kept showing July's stale numbers under a stale "2026년 7월" column header, and the Comparison Summary text didn't change either.

**Root cause**: `$("#entityCompareTarget")?.addEventListener("change", renderEntityCompareUI)` — `renderEntityCompareUI()` only updates the header/toggle chrome. The actual fetch-and-render function, `refreshEntityCompareTargetPeriodData()` (aliased `refreshEntityCompareKpi()`), was never wired to this event — it was only ever called from `refreshEntityTrendMonths()` (the brand/period trigger). Changing the compare-target mode is a third, independent trigger that was simply missing from the dispatch chain.

**Fix**: one line — the change handler now also calls `refreshEntityCompareKpi()`, the exact existing function `refreshEntityTrendMonths()` already uses for the same purpose. No new fetch, no new render path — `refreshEntityCompareTargetPeriodData()` itself already re-renders both the Period Performance table (`renderEntityCompareTargetPeriodKpis()`) and the Comparison Summary (`renderEntityCompareSummary()`) in one call, so wiring the single missing call fixes both symptoms at once.

**Verified live, all 3 modes, after the fix**:
- `prev → yoy`: Period Performance header correctly changed to "2025년 8월", CARNET's comparison value correctly changed (6,755,590원 → 1,553,000원, a real different number), Comparison Summary correctly regenerated with a new, genuinely different fact ("CARNET ARCHIVE의 비교 대상 기간은 표본이 적어(주문 2건) 비교 의미가 제한적입니다." — a low-sample-size disclosure that only applies to the YoY period, confirming the underlying data genuinely refetched, not just re-labeled).
- `yoy → custom`: correctly fell back to "비교 대상 미확정" / "데이터 연결 대기" everywhere — no stale YoY numbers leaked.
- `custom → prev`: correctly restored July's real numbers.
- **AIVER's missing YoY data** rendered as "데이터 연결 대기" (not a fake 0) automatically — confirms the pre-existing NULL≠ZERO handling inside `refreshEntityCompareTargetPeriodData()` was untouched and still correct.
- **Rapid-fire race test** (yoy → custom → prev fired back-to-back with no waiting): resolved correctly to the final selection (July's real numbers), confirming the existing `entityCompareTargetPeriodRefreshSeq` stale-response guard (unmodified) still works correctly with the newly-added trigger.

## Confirmed Correct, No Fix Needed (classified via the live walk, not re-diagnosed from scratch)

- **Compare toggle, brand selection, header**: real click-path verified — CARNET (baseline) + AIVER (comparison) independently selectable, no cross-contamination.
- **Core Metrics compare (Revenue/Units/Orders/AOV)**: the "Period Performance" table — 4 metrics, both brands, current/target/delta columns, correct arithmetic (spot-checked: AOV delta 441,848 − 375,311 = +66,537, matches exactly).
- **Delta safety**: unavailable/failure states never produce a fabricated zero or `Infinity%` — confirmed via live failure mocking (below).
- **Inventory compare**: confirmed as intentionally **non-comparative** (Single-Brand's own current-snapshot Hero card, shown once, never duplicated into a fake period-delta or fake cross-brand row) — this is Phase 9's explicitly-sanctioned "Option A," and no existing fetch/UI slot for a second brand's inventory was ever built, so none was added (would have been new-feature scope, not a fix).
- **Customer Composition compare**: two real donuts side by side (CARNET 31건/94%·6%, AIVER 2건/100%·0%), real data both sides.
- **Comparison Summary (AI Compare Summary)**: `buildComparisonSummaryFacts()` (STEP67-10G-3, already tested) — confirmed live to produce only factual, deterministic sentences (revenue growth, cross-brand revenue leader, offline-share comparison, low-sample-size disclosure, partial-period disclosure) and to **never** mention Category/Sell-through/Brand Score/Recommended Action.
- **Category, Brand Score, Sell-through, Recommended Action in Compare context**: all mirror Single-Brand's honest blocked states exactly — Category shows "상품군 데이터가 연결되지 않았습니다" for **both** brand columns (no fake per-brand numbers), Sell-through/Score unchanged blocked shells (shown once, baseline-only, same as before).
- **SKU Drawer while Compare Mode is active**: still opens correctly, still shows the baseline brand's own real rows — Compare UI has no SKU-comparison section anywhere, so per Phase 11's own instruction, none was added.
- **Customer full-list Drawer + Client Workspace while Compare Mode is active**: BI-BATCH-E's fix (real click → real Workspace) still works correctly with Compare Mode on, for both CARNET and cross-checked against a non-TOP5 customer.
- **Cross-brand independence**: switching the comparison brand (AIVER → TROUBLED WATERS) correctly updated only the comparison side; baseline (CARNET) values were unaffected.
- **Failure QA**: mocked a timeout on `/api/reports/monthly-comparison-cutoff` (the endpoint actually used when the baseline period is live/in-progress) — every Period Performance cell for both brands correctly showed the existing "Archive 생성 지연 · 다시 시도" text (not zero), and the Comparison Summary safely fell back to baseline-only facts plus an explicit "AIVER의 현재 기간 데이터가 없습니다" disclosure — no fabricated comparison claim.

## Files Changed

- `outputs/samplas-marketing-os.js` (10 insertions, 1 deletion): the single `#entityCompareTarget` change-handler fix.
- `test/brand-intelligence-compare-mode-completion.test.mjs` (new, 5 tests).

## Tests

New file: **5/5 PASS** — the change handler calls both the existing header-render and the existing data-refresh function; `refreshEntityCompareKpi` is confirmed to still be the same thin wrapper `refreshEntityTrendMonths` already uses (no duplicate fetch path introduced); `refreshEntityCompareTargetPeriodData` is confirmed to still re-render both the Period Performance table and the Comparison Summary in one call; regression guards confirming Category/Score/Sell-through/Action text is untouched and the failure-state copy is unchanged.

Targeted (new file + Compare summary/YoY-timeout/cutoff/partial-period + Brand Intelligence + partial-period + Score/AI + single-brand sweep + Customer Purchase Detail + SKU sales/stock + live-data/UI-restoration + Product Registry/identity + monthly-brand-sales): **153/153 PASS**.

Full regression: **403/403 PASS, 0 fail, 0 skipped** (398 prior baseline + 5 new).

## Chrome QA

Real server, hard refresh:
- CARNET ARCHIVE Core Metrics: Revenue 11,488,059원 / Units 33개 / Orders 26건 / AOV 441,848원 / Inventory 272개 — internally consistent between Single-Brand and Compare Mode (byte-identical baseline row in both), confirming Compare Mode reuses the exact same canonical calculation, no duplicate formula. (Note: these figures are higher than the task prompt's stated "known August baseline" of 10,883,059원/32개/25건/435,322원 from BI-BATCH-E — confirmed this is legitimate: real time has passed since that QA session and August 2026 is still an in-progress month accruing real sales; Inventory's 272개 is unchanged, as expected for a current-snapshot metric.)
- CARNET vs AIVER, previous month: PASS (pre-existing, confirmed working).
- CARNET vs AIVER, YoY: PASS (was broken before this batch's fix — now confirmed correct with real, different data).
- CARNET vs AIVER, custom: PASS — honestly unavailable, as it always was (Custom Period UI was never built, out of scope, not attempted).
- CARNET vs TROUBLED WATERS (a brand with a meaningfully different profile — zero online SKU sales, no ECOUNT inventory match, per BI-BATCH-E): PASS — real, correct cross-brand comparison values and summary.
- Failure state (mocked cutoff-endpoint timeout): PASS — honest "Archive 생성 지연" everywhere, no fake zero.
- Stale/race guard (rapid-fire target-mode switching): PASS — resolves to the final selection only.
- Single-Brand regression (Customer Detail click-through, SKU Drawer): PASS, unaffected.
- Console: zero application errors across the entire sweep (only the pre-existing, unrelated browser-extension "message channel closed" artifact noted in every prior report this session).

## Completion Matrix

| Section | Status | Blocker | Notes |
|---|---|---|---|
| Compare toggle / brand selection | COMPLETE | — | |
| Previous month | COMPLETE | — | |
| YoY | COMPLETE | — | fixed this batch |
| Custom period | N/A | no UI ever built (STEP67-10G-5, unchanged) | honestly unavailable, not attempted (out of scope — no date-picker UX was invented) |
| Cross-brand mode | COMPLETE | — | |
| Revenue/Units/Orders/AOV compare | COMPLETE | — | fixed this batch (target-mode refresh) |
| Delta safety (zero/failure/partial) | COMPLETE | — | |
| Inventory compare | N/A | intentionally non-comparative (current snapshot, Option A) | correct as-is |
| Customer compare | COMPLETE | — | |
| SKU compare | N/A | no existing UI section | correctly not added |
| AI Compare Summary | COMPLETE | — | |
| Category (compare context) | BLOCKED | business taxonomy (BI-BATCH-C) | honest, unchanged |
| Brand Score (compare context) | BLOCKED | formula/weights (BI-BATCH-D) | honest, unchanged |
| Sell-through (compare context) | BLOCKED | data availability (BI-BATCH-F) | honest, unchanged |
| Recommended Action (compare context) | BLOCKED | policy (BI-BATCH-D) | honest, unchanged |
| Stale/race safety | COMPLETE | — | |
| Failure states | COMPLETE | — | |
| Drawers while comparing | COMPLETE | — | |

No PARTIAL remains — the one concrete technical defect found was fixed in this batch.

## Commit

```
cebc91b fix(brand-intelligence): complete single-brand data wiring   (prerequisite)
<next>  fix(brand-intelligence): complete compare mode wiring         (this batch)
```

## Next

Compare Mode's technical implementation is complete except for the three already-known, already-documented, non-technical blockers (Category taxonomy, Brand Score formula, Sell-through data availability) and the never-built Custom Period date UI (a genuine new-feature scope, correctly not attempted here). Per instruction, stopping here.
