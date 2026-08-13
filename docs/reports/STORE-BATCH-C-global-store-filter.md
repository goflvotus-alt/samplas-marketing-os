# STORE-BATCH-C — Global Store Filter UI (ALL / 압구정 / VAIL)

**Date**: 2026-08-13
**Scope**: Attach a shared, global Store Filter (`ALL / APGUJEONG / VAIL`) to Today, Monthly, Annual, and Commerce, on top of STORE-BATCH-B's backend foundation — without ever combining online (channel-unattributable) revenue into a store-scoped total, and without changing any existing ALL number.

---

## STORE-BATCH-B commit

`cbd172e feat(sales): separate Monthly Sales by store (압구정 매장 / SAMPLAS VAIL)` — already committed before this batch started. Re-verified clean (no unrelated diff bundled in): `git diff 0216e90 cbd172e --stat` for every touched file matches exactly the line counts of STORE-BATCH-B's own documented edits, and the files flagged as "possibly unrelated" (`.gitignore`, `test/monthly-brand-sales.test.mjs`) were already resolved in an earlier commit (`c36780d`) before `0216e90` — nothing rode along. `git status --short` / `git log -1 --oneline` confirmed clean at batch start.

## GLOBAL STORE STATE: **COMPLETE**

One module-level variable, `let storeFilterState = "ALL"` (`outputs/samplas-marketing-os.js`), following the exact pattern of the existing `operationsRange` selector (plain in-memory state, resets to `ALL` on reload — no new persistence architecture). Verified structurally: `storeFilterState` is declared exactly once in the client bundle (`test/store-filter.test.mjs`, test 12) — no per-screen duplicate state.

## STORE SELECTOR: **COMPLETE**

Single `<select id="storeFilterSelect">` added to the shared `.topbar .controls` block (`outputs/samplas-marketing-os.html`), reusing the exact existing `<select>` styling — zero new CSS. Options: `전체 매장 / 압구정 / VAIL`. Visible on Today (Overview)/Monthly+Annual (Reports)/Commerce (Sales) via a new `showStoreFilter` check in `updateTopbarControls()`, independent from the existing `showOperations` list (Reports has its own month/year nav and was never in that list, but does need the Store filter).

## DEFAULT: **ALL**

First `<option>`, matches `storeFilterState`'s initial value — no divergence possible.

## TODAY: **PASS**

`/api/sales/total` fetch now appends `&store=${storeFilterState}` when not ALL. `todaySummarySalesInfo()` gained a `storeCode` param: when set, it never combines online+offline into a single "총매출" — it renders "오프라인 매출 (매장명)" only, with a note explicitly stating online is not store-attributable, and — critically — checks `coverage.storesIncluded` before treating an amount as real: if the selected store isn't in `storesIncluded` for the requested range, it shows **데이터 없음**, never a confirmed 0원.

Live-verified: ALL showed the exact pre-batch baseline `96,124,996원 = 16,980,196원 + 79,144,800원` (byte-for-byte, no change). Switching to 압구정/VAIL on the untouched Aug 2026 data (no per-store files existed at test time) correctly showed "데이터 없음 · 이 기간에는 매장별로 분리 업로드된 오프라인 매출이 없습니다(미업로드)" for both. A real synthetic upload (압구정, 42,000원) was then performed through the actual wizard; the card updated live to "오프라인 매출 (압구정) 42,000원 · 온라인 매출은 매장별로 구분되지 않아 포함하지 않습니다 (참고: 전체 온라인 16,980,196원)."

## MONTHLY: **PASS**

Deliberately did **not** touch `buildMonthlyArchiveSales`/the `/api/reports/monthly` archive pipeline — that endpoint is shared by many other features (Annual, brand comparisons, Brand Intelligence) and rebuilding it to support live store filtering was assessed as carrying disproportionate regression risk for this batch (per the explicit escape-hatch: "임의로 구현하지 말고 가장 안전한 UX를 설계하고 보고한다"). Instead, when `storeFilterState !== "ALL"`, `renderMonthlyArchiveReport` fetches `/api/ecount-sales/monthly?month=&store=` (already existed, STORE-BATCH-B) and renders a clearly separate disclosure line: `매장 필터: 압구정 — 오프라인 매출 42,000원(해당 매장 업로드분만 집계). 아래 브랜드/상품 상세는 매장 구분 없는 전체(ALL) 기준입니다. 온라인 매출은 매장별로 구분되지 않으므로 이 숫자에 합산하지 않습니다.` The main archive-driven Sales Summary/브랜드 tables underneath are untouched and always ALL. Live-verified exactly this behavior in Chrome after the synthetic upload.

## ANNUAL: **PASS**

Same design as Monthly, extended across the year: `annualStoreScopeNote(year, months, storeCode)` calls the per-month store-scoped endpoint for all 12 months, sums what's present, and explicitly lists which months are missing that store's separate upload — e.g. live-verified text: `매장 필터: 압구정 — 오프라인 매출 42,000원 누적 (2026-01, 2026-02, ..., 2026-07은 매장별 미업로드 — 이 합계에서 제외됨, 연간 전체 매출로 오인 금지). 아래 브랜드/상품 상세는 매장 구분 없는 전체(ALL) 기준입니다.` This directly satisfies the "불완전한 연간 Store 합계를 완전한 데이터처럼 표시 금지" requirement. Main Annual Flow KPIs/charts underneath stay ALL, untouched.

## COMMERCE: **PASS**

`renderCafe24Sales`'s `/api/sales/total` fetch also gained `&store=`. Three separate rendering paths were updated to avoid the forced online+offline combine when a store is selected:
- `renderCommercePrimaryKpi()` — replaces the `[총매출, 온라인, 오프라인]` row set with `[온라인 (전체, 매장 무관), 오프라인 (매장명)]` when store≠ALL (no combined 총매출 card).
- `renderCommerceChannelCards()` — relabels the Offline row with the store name and an honest note ("이 기간 매장별 분리 업로드 없음(미업로드)" vs the real ECOUNT figure).
- `renderCommerceSalesSummary()` — was initially missed (still showed a combined "총매출 17,022,196원..." after a store was selected, discovered during live QA); fixed by threading `storeCode` into its existing `todaySummarySalesInfo()` call, same as Today's. Also fixed a minor double-period artifact (`...).).`) introduced by wrapping an already-period-terminated note string.

Live-verified: 핵심 지표 cards correctly split into "온라인 (전체, 매장 무관) 16,980,196원" / "오프라인 (압구정) 42,000원"; Sales Summary text correctly reads "오프라인 매출 (압구정) 42,000원(온라인 매출은 매장별로 구분되지 않아 포함하지 않습니다 (참고: 전체 온라인 16,980,196원))."

## CLIENTS: **DEFERRED**
## BRAND INTELLIGENCE: **DEFERRED**

Not in this batch's required scope (Today/Monthly/Annual/Commerce only, per explicit instruction). No changes made to either screen.

## LEGACY DATA HANDLING: **PASS**

For any month with no per-store snapshot files (all 9 pre-STORE-BATCH-B months, and Aug 2026 before the live-QA upload), selecting APGUJEONG or VAIL returns `offlineSalesAmount: 0` from the filter loop but — critically — `coverage.storesIncluded` is empty, which every UI surface checks before displaying a number. `test/store-filter.test.mjs` tests 9/10 assert this directly against `buildCanonicalTotalSales`.

## PARTIAL DATA DISCLOSURE: **PASS**

`buildCanonicalTotalSales` now additionally returns `coverage.storesIncluded`/`coverage.storesMissing` (additive fields, unioned across the requested date range from each month's already-computed merge metadata — no new calculation). This is the single signal every disclosure banner (Today card, Commerce cards, Monthly/Annual notes) reads to distinguish "genuinely no data for this store" from "confirmed 0원."

## ONLINE ATTRIBUTION SAFETY: **PASS**

Verified twice: (1) statically, `buildCanonicalTotalSales`'s `onlinePaidAmount` computation line never references `storeCode` (regex-asserted in tests); (2) at every UI surface that shows a store-scoped number, online is either omitted entirely or shown as a separately-labeled, explicitly non-store-attributed reference value — never folded into a single combined figure once a specific store is selected.

## ALL TOTAL REGRESSION: **PASS**

Live-verified byte-for-byte against the pre-batch baseline at every checkpoint: `96,124,996원 = 16,980,196원 + 79,144,800원` before any QA action, and restored to the exact same figure (offline `79144800`, md5-verified byte-identical legacy snapshot file) after QA cleanup.

## TARGETED TESTS: **11/11 PASS**

New file `test/store-filter.test.mjs` (`buildCanonicalTotalSales` gained an optional `workDir` param for test isolation, following the same injection pattern already used by `readEcountOfflineSalesSnapshot`/`refreshMonthlySales` — zero behavior change for the one existing caller, which omits it):

1. default store = ALL preserves the legacy-fallback result — PASS
2. ALL = APGUJEONG + VAIL (exact) — PASS
3/4. selector `storeCode` routes to the exact matching filter — PASS
5/6. APGUJEONG excludes VAIL's lines and vice versa — PASS
7/8. online total identical across ALL/APGUJEONG/VAIL (live call + static source-code guard) — PASS
9/10. legacy null-store data never matched to APGUJEONG or VAIL, `storesIncluded` empty — PASS
11. partial upload (APGUJEONG only) — VAIL correctly absent from `storesIncluded`, not a confirmed zero — PASS
12. `storeFilterState` declared exactly once (shared, no per-screen duplicates) — PASS
13. ALL: total = online + offline invariant unchanged — PASS
14. store=ALL result identical whether explicit or omitted — PASS

## FULL REGRESSION: **487/487 PASS**

461 (pre-STORE-BATCH) + 15 (STORE-BATCH-B) + 11 (STORE-BATCH-C) = 487, all green, run twice (post-implementation and post-live-QA).

## LIVE QA: **PASS**

Performed in Chrome against the local server (restarted mid-batch after edits; also discovered and worked around a hash-only-navigation caching gotcha — `location.href` changes that only alter the `#hash` don't trigger a real script reload in this SPA, so `location.reload()` was used to pick up JS edits between checks):

- Today: ALL (exact baseline) → 압구정 (데이터 없음, honest) → VAIL (데이터 없음, honest) → real synthetic upload (압구정, 42,000원, built as a hand-crafted minimal xlsx matching the real ECOUNT 판매현황 header layout, since no real ECOUNT file is reachable from this environment per STORE-BATCH-A's confirmed IP-allowlist restriction) → card updated live to the real filtered amount with the correct non-attribution note.
- Monthly: disclosure banner rendered correctly for 압구정, main archive numbers stayed ALL.
- Annual: disclosure banner correctly listed all 7 months missing store-separated data, main Annual Flow numbers stayed ALL.
- Commerce: KPI cards split correctly; Sales Summary bug (still forcing a combined 총매출) found and fixed in the same pass.
- Selector switching cycled through ALL/APGUJEONG/VAIL on Today, Monthly, Annual, and Commerce with no errors.
- Console: no application-level errors (checked with `onlyErrors: true` across the full cycle) — only the known benign Chrome-extension messaging noise ("message channel closed") also seen in STORE-BATCH-B's QA, unrelated to the app.
- Cleanup: deleted the one QA per-store file (`2026-08.APGUJEONG.json`); confirmed the legacy `2026-08.json` file was md5-byte-identical before and after; confirmed the API and Today dashboard both reverted to the exact original `96,124,996원 = 16,980,196원 + 79,144,800원`. No temp upload directories left behind.

## VISUAL QA: **PASS**

Resized the browser window to 900×523 — the topbar controls (month/period/store selectors) wrapped cleanly onto their own row via the pre-existing `flex-wrap: wrap` on `.controls`; no overlap, no clipping, no change to any other existing selector's position. No existing UI was hidden or removed to make space.

## FILES CHANGED

- `outputs/samplas-marketing-os.html` — new `#storeFilterSelect` in the shared topbar controls
- `outputs/samplas-marketing-os.js` — `storeFilterState`, `updateTopbarControls` store-visibility logic, change handler, `todaySummarySalesInfo(storeCode)`, Today/Commerce fetch wiring, `monthlyStoreScopeNote`/`annualStoreScopeNote`, Commerce KPI/summary store-awareness
- `server.mjs` — `buildCanonicalTotalSales` gained `coverage.storesIncluded`/`storesMissing` (additive) and an optional `workDir` param for test isolation (additive, default unchanged)
- `test/store-filter.test.mjs` — new, 11 tests

No CSS changes were needed (existing `<select>` and `.controls` flex-wrap styling covers the new selector as-is).

## COMMITS

Pending — this report is written before the commit per the batch's required order; commit follows immediately after, staged only to these exact files (`git add outputs/samplas-marketing-os.html outputs/samplas-marketing-os.js server.mjs test/store-filter.test.mjs docs/reports/STORE-BATCH-C-global-store-filter.md`), no `git add .`/`git add -A`.

## FINAL HEAD

To be confirmed after commit (see final message).

## PUSH: NONE
## DEPLOY: NONE

## NEXT RECOMMENDED BATCH

Clients and Brand Intelligence store-filter wiring (deferred this batch, per explicit scope). Separately worth considering: if store-separated Monthly Sales uploads become the operational norm going forward, revisit whether `buildMonthlyArchiveSales`/`/api/reports/monthly` should gain native store-filtering rather than staying ALL-only with a disclosure banner — that would be a larger, more deliberate batch given how many features share that archive pipeline.
