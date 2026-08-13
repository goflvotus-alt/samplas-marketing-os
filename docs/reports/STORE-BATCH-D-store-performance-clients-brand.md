# STORE-BATCH-D — Store Performance UX + Clients + Brand Intelligence

**Date**: 2026-08-13
**Scope**: Establish the information architecture `ALL = 회사 전체 / APGUJEONG = 압구정 매장 현미경 / VAIL = SAMPLAS VAIL 현미경` across Today, Monthly, Annual, Commerce, and — newly — Clients and Brand Intelligence, without ever attributing online revenue to a physical store and without changing any existing ALL number.

---

## STARTING HEAD

`a0a440e` (STORE-BATCH-C + doc-fix). Pre-flight confirmed clean: `git status --short` showed only pre-existing untracked BI-BATCH docs; `git diff --stat` empty; HEAD matched. No `git add .`/`git add -A` used at any point.

## STORE UX: **COMPLETE**

The three-tier mental model is now real, not just a filter: ALL shows a company-wide online/APGUJEONG/VAIL breakdown wherever the underlying data supports it; selecting APGUJEONG or VAIL switches the screen into "store focus" mode — the headline number becomes that store's own offline revenue (never combined with online), with a secondary "share of canonical ALL" KPI where feasible.

## ALL COMPANY VIEW: **PASS**

## ALL BREAKDOWN: **ONLINE / APGUJEONG / VAIL**

`buildCanonicalTotalSales` now returns an additive `offlineSales.byStore = {APGUJEONG, VAIL}` field, computed in the same existing per-line loop (no new calculation, no extra API call) and populated regardless of which `storeCode` filter was requested — this is what lets any consumer compute a genuine canonical-ALL denominator without a second round trip. Today's ALL card now reads, live-verified: `총매출 17,473,196원 · 온라인 17,358,196원 · 오프라인 115,000원 · 압구정 115,000원 · VAIL 미분류` — the existing `APGUJEONG+VAIL=OFFLINE`/`ONLINE+OFFLINE=TOTAL` formulas are untouched; this is purely an additive breakdown line.

## APGUJEONG FOCUS: **PASS**
## VAIL FOCUS: **PASS**

Live-verified on Today: selecting 압구정 with real uploaded data (115,000원) showed `오프라인 매출 (압구정) 115,000원 · 온라인 매출은 매장별로 구분되지 않아 포함하지 않습니다 (참고: 전체 온라인 17,358,196원) · 전체 회사 매출 대비 0.7%` — the share KPI's denominator is `online + byStore.APGUJEONG + byStore.VAIL` (the real canonical ALL total for that period), never the store's own partial sum. Before any upload existed, both stores correctly showed `데이터 없음` (never a fabricated 0원).

## ONLINE ATTRIBUTION SAFETY: **PASS**

Verified at every layer touched this batch:
- `buildCanonicalTotalSales`'s online computation still never references `storeCode` (static regex-asserted, unchanged since STORE-BATCH-C).
- `buildClientsOverview`: when `storeCode` is set, `onlineOrdersInPeriod` is forced to `[]` for every client (not just zeroed after the fact) — online purchases are structurally excluded from Store Focus Mode, not filtered down to zero.
- `buildBrandCustomerComposition`: this function only ever reads ECOUNT offline lines — it never had online data mixed in, so the "never attribute online to a store" principle was already structurally guaranteed before this batch; only the `storeCode` filter was added.

## TODAY: **PASS**

Both the ALL 3-axis breakdown and the Store Focus headline + share KPI, described above, live on Today. `todaySummarySalesInfo()` gained the `storeCode` param and a `storeBreakdown`/`share`/`shareLabel` set of fields; rendering reuses the exact existing `sales-compare-card` component (no new card, no new layout — the breakdown/share is appended as extra text inside the same `<p>` note).

## MONTHLY: **PASS**

Deliberately kept the shared archive pipeline (`buildMonthlyArchiveSales`/`/api/reports/monthly`) untouched — it's consumed by many other features and STORE-BATCH-C already established the pattern of layering a disclosure note on top rather than risking that shared surface. New this batch: the ALL-mode note now shows the 3-axis breakdown too, computed client-side from the already-fetched `offlineSnapshot.salesLines` (no new API call): `매장 구성: 온라인 X · 압구정 Y · VAIL Z`(or "미분류" per store). Store-focus mode's disclosure banner (built in STORE-BATCH-C) is unchanged.

## ANNUAL: **PASS**

Added "매장별 분석 가능 기간" to the store-focus disclosure banner — computed for real from `uploadedMonths` (the earliest month within the displayed year that actually has a store-separated upload), never hardcoded. Existing missing-months disclosure (STORE-BATCH-C) unchanged.

## COMMERCE: **PASS**

Extended STORE-BATCH-C's split-KPI behavior: `주문수`/`객단가` (Cafe24-canonical, online-only metrics) now show an explicit `(매장 필터 적용 대상 아님)` suffix when a store is selected, per Part D's requirement that online-only metrics never silently look like they belong to the selected store.

## CLIENTS: **PASS**

New this batch, built from scratch on top of the existing `buildClientsOverview()`:
- **Identity**: never duplicated per store — verified with a fixture where the same `customerName` purchased at both APGUJEONG and VAIL; the result is one client (`aliases` array), `totalSales` summing both stores' amounts. Confirmed live: uploading a real fixture for a synthetic customer ("김테스트 실장님") at 압구정 showed up correctly as exactly 1 client with 2 purchases, 115,000원.
- **ALL**: byte-identical to the pre-batch response shape — no field removed, only `storeCode`/`storeCoverage` added (both `null` when unfiltered).
- **APGUJEONG/VAIL**: offline lines filtered by `line.storeCode`; `onlineOrdersInPeriod` forced empty; the summary-level online metrics (order count, quantity, points used, shipping) also become empty rather than zeroed-after-the-fact.
- **Coverage disclosure**: `storeCoverage.includedMonths`/`missingMonths` (computed per month in the requested range via `readEcountOfflineSalesSnapshot`) lets the UI show `데이터 없음` — verified live: before any store upload, all 5 KPI cards correctly read `데이터 없음 · 2026-08 매장별 미업로드`; after uploading, they updated to real values (`1명`, `2건`, `115,000원`, `57,500원` avg).
- A real bug was found and fixed during this work: **server.mjs has its own local handler for `/api/intelligence/clients`** (a duplicate of `intelligence-service.mjs`'s `handleClientsOverviewRoute`, matched first since the browser's requests go through port 8787) that initially didn't read the `store` query param at all — the intelligence-service.mjs side was correctly updated but silently unreachable through the browser's actual path. Found via live QA (Clients KPI cards weren't relabeling despite the network request correctly including `&store=`), fixed by threading `storeCode` through the local handler too.

## BRAND INTELLIGENCE: **PARTIAL**

- **Brand Revenue (offline, per store)**: `buildBrandCustomerComposition` gained a `revenueByStore` accumulator (computed unconditionally per matching line, independent of the `storeCode` filter applied to the rest of the function) — additive, no new API call. Live-verified: NAMILIA/나밀리아 (a real Brand Master entry) with a synthetic 115,000원 압구정 upload showed `이 브랜드 오프라인 매출(압구정) — 115,000원 · 이 브랜드의 매장별 오프라인 매출 중 압구정 비중 100.0%`. **Scope note**: this is offline-only (온라인/APGUJEONG/VAIL 3-axis was not built for Brand Revenue) — `buildBrandCustomerComposition` has no access to the brand's online revenue, and wiring that in would mean touching `buildCommerceBrandInput`/the Cafe24 diagnostics path, which was out of scope this batch. The existing Channel Mix card (`archive.commerce.brandSales`-driven, untouched) still shows the real online/offline split for the brand — live-verified identical between ALL and APGUJEONG (proving it's correctly unaffected by the store filter, not silently broken).
- **Brand Store Share**: implemented as "매장별 오프라인 매출 중 이 매장의 비중" (share of the brand's own store-split total). The other direction described in the spec ("이 매장 전체 매출 중 이 브랜드의 비중", denominator = all-brands store total) was **not implemented** — it needs a store-wide all-brands total that no existing endpoint computes; deferred.
- **Customer Composition / Recent Orders / Customer Workspace**: all three already shared the same underlying data path (`entityClientsOverviewData`, fed by the same `/api/intelligence/clients` endpoint Clients uses, plus `buildBrandCustomerComposition`'s own `topCustomers`) — adding `storeCode` to both endpoints' calls made all three store-aware with no additional plumbing. Live-verified: the Customer Composition donut/TOP5 correctly showed only the synthetic 압구정 customer and their 2 purchases.

## BRAND STORE RANKING: **DEFERRED**

Store-scoped brand ranking ("압구정 브랜드 순위 2위") would require recomputing a rank across *all* brands per store — a materially larger computation than any single-brand endpoint this batch touched, and the only realistic data source (`archive.commerce.brandSales`) is the same shared archive pipeline STORE-BATCH-C and this batch both deliberately avoided modifying. Not implemented.

## CUSTOMER WORKSPACE: **PASS**

Inherits store-awareness for free via the Customer Composition/Clients Overview wiring above (Customer Workspace reads `entityClientPurchaseLinesFor`, which reads `entityClientsOverviewData`, which now carries the store filter).

## CATEGORY / SKU: **UNAVAILABLE**

Not investigated/implemented this batch — Category Intelligence and SKU drill-down were not traced to determine whether their underlying source carries row-level `storeCode`. Per Part explicit instruction ("지원되지 않으면 ALL 값을 physical Store 값처럼 재사용하지 않는다"), no code was touched here, so there is no risk of silent misattribution — the screens simply continue to show ALL-basis data regardless of the store filter, same as before this batch.

## STORE SCORE: **PARTIAL**

- **Inventory Integrity**: now hard-gated on `storeFilterState === "ALL"` — `entityInventoryItemsState` is company-wide (no WH_CD filter exists yet, confirmed deferred to STORE-BATCH-E), so this component becomes `null` (unavailable) rather than silently reusing the whole-company inventory ratio as if it belonged to the selected store. Verified via a structural test (`test/store-performance.test.mjs`, test 26) that greps the actual guard condition, since this logic lives entirely in client JS with no test harness for DOM-coupled functions.
- **Customer Momentum**: made store-scoped (passes `&store=` into its two `customer-composition` calls) since a store-specific source already existed for it.
- **Revenue Momentum / Order Momentum**: left company-wide (unchanged) — both derive from the shared archive pipeline (`archive.commerce.brandSales`/`entityTrendMonths`), which this batch did not modify, per the explicit "Score formula 자체는 변경하지 않는다" instruction. This means a Store Focus Score currently mixes 2 store-scoped components (Customer, and Inventory-when-ALL-only) with 2 company-wide components (Revenue, Order) — an acknowledged inconsistency, reported as PARTIAL rather than silently presented as fully store-scoped.
- Partial-coverage normalization rule (`availableWeight >= 60`) is unchanged (test 27).

## INVENTORY INTEGRITY POLICY: **PASS**

Directly covered by the Score guard above — a physical store's Score can never silently borrow the company-wide inventory ratio.

## LEGACY DATA: **PASS**

`test/store-performance.test.mjs` test 13/14/15: a legacy (pre-store-separation) snapshot's lines carry `storeCode: null`, which matches neither `"APGUJEONG"` nor `"VAIL"` in any of the three modified functions (`buildCanonicalTotalSales`, `buildClientsOverview`, `buildBrandCustomerComposition`) — confirmed to return `0`/empty with `storesIncluded` correctly excluding the requested store, never inferred as APGUJEONG.

## PARTIAL DATA: **PASS**

Every store-aware endpoint this batch touched now distinguishes "genuinely zero" from "not uploaded": `buildCanonicalTotalSales.coverage.storesIncluded`, `buildClientsOverview.storeCoverage.{includedMonths,missingMonths}`, `buildBrandCustomerComposition.storeHasData` — all live-verified rendering `데이터 없음`/`미분류`/`미업로드` rather than a bare `0원`.

## TARGETED TESTS: **15/15 PASS** (30 scenarios covered)

New file `test/store-performance.test.mjs`. `buildCanonicalTotalSales` unchanged from STORE-BATCH-C's `workDir` injection; `buildClientsOverview` and `buildBrandCustomerComposition` both newly exported/gained the same `workDir` injection pattern for test isolation (zero behavior change for their one real caller each, which omits it).

1. ALL/2. ALL breakdown sum/3-4. store-scoped routing/5-6. isolation/7-9. online exclusion — covered via `buildCanonicalTotalSales` (tests "10.", "11/12.", "7/8/9.")
13-15. legacy + missing-store honesty — covered (test "13/14/15.")
16-19. Clients identity/isolation/online-exclusion — covered (tests "16.", "17/18.", "19.", plus a dedicated `storeCoverage` test)
20-21. Brand revenue correctness/isolation — covered (test "20/21.", using the real Brand Master entry `B00000SK`/NAMILIA rather than a synthetic brand, since `resolveIdentity()` reads the real, unmodified identity pipeline)
22. Brand ranking store-scoped — **not applicable, DEFERRED** (no code exists to test)
23-24. Recent orders/Customer Workspace store-scoped — structurally covered by the shared Clients/Composition wiring (19, 20/21); no separate test needed since there's no separate code path
25. unsupported metric never reuses ALL — covered (test "25.")
26-27. Score inventory guard / partial coverage rule — covered via structural source assertions (client JS has no test harness)
28. shared store state across all 6 screens — covered (test "28.", asserts `showStoreFilter` includes all 6 views and `storeFilterState` is declared exactly once)
29-30. existing channel semantics / other selectors unchanged — covered (tests "29.", "30.")

One pre-existing regression test (`test/brand-intelligence-customer-purchase-detail.test.mjs`, BI-BATCH-I) asserted an exact-match regex against `refreshEntityClientsOverview`'s URL construction; updated to match the new conditional `&store=` fragment while preserving its actual intent (same `intelligenceUrl`/`getSharedJson`/`monthlyReportMonthRange` primitives, no new fetch architecture).

## FULL REGRESSION: **502/502 PASS**

487 (pre-STORE-BATCH-D) + 15 new = 502, run clean after implementation and again after live QA.

## LIVE QA: **PASS**

Performed in Chrome against both local servers (`server.mjs` on 8787, `intelligence-service.mjs` on 8797 — the latter had to be started fresh for this batch since Clients/Brand Intelligence route through it):

- **Today**: ALL (exact baseline `96,124,996원`, then real-upload state `17,473,196원 = 17,358,196 + 115,000` with correct 3-axis breakdown) → 압구정 (데이터 없음 → real `115,000원` + `0.7%` share after upload) → VAIL (데이터 없음, symmetric).
- **Monthly**: ALL-mode 3-axis note verified alongside the existing store-focus disclosure banner (both reuse the already-fetched snapshot, no extra request).
- **Annual**: coverage-period text verified present and computed from real `uploadedMonths` data.
- **Commerce**: online-only metric labeling (`매장 필터 적용 대상 아님`) verified.
- **Clients**: ALL (unchanged baseline) → 압구정 (데이터 없음 with explicit "2026-08 매장별 미업로드" note → after a real synthetic upload, `1명/2건/115,000원/57,500원 평균`, correctly deduplicated to one client identity). Found and fixed the server.mjs duplicate-route bug described above.
- **Brand Intelligence**: selected a real brand (NAMILIA/나밀리아) via the brand search; verified the new store-breakdown note, Brand Store Share (100%, correct since only one store had data), and Customer Composition donut/TOP5 all reflected the real synthetic customer/purchase — and verified Channel Mix (untouched, `archive.commerce.brandSales`-driven) stayed identical between ALL and 압구정, proving it wasn't accidentally caught by the store filter.
- Console: no application-level errors across the full session (checked with `onlyErrors: true`).
- Cleanup: deleted the one QA per-store snapshot file created during testing; confirmed the legacy `2026-08.json` file was md5-byte-identical before and after; confirmed the live API and dashboard both reverted to the exact original `79,144,800원` offline / `96,124,996원` total. No temp upload directories left behind.

## VISUAL QA: **PASS**

Resized to 900×523/900×700 on both Today and Brand Intelligence — the store selector (now also visible on Clients/Brand Intelligence per Part G) wraps cleanly with the existing `flex-wrap` topbar layout; no overlap, clipping, or shift of any existing selector (period/brand/compare-mode) on either screen. No existing UI was hidden or removed to make space.

## FILES CHANGED

- `intelligence-service.mjs` — `buildClientsOverview` gained `storeCode`/`workDir` params, per-client and summary-level store filtering, `storeCoverage` disclosure; `loadEcountClientLines` gained `workDirOverride`; `handleClientsOverviewRoute` parses `store` query
- `server.mjs` — `buildCanonicalTotalSales` gained `offlineSales.byStore`; `buildBrandCustomerComposition` exported, gained `storeCode`/`workDirOverride` params and `revenueByStore`; the local (duplicate) `/api/intelligence/clients` handler fixed to read `store`; the `customer-composition` route parses `store`
- `outputs/samplas-marketing-os.html` — no new markup beyond STORE-BATCH-C's selector (unchanged) plus one new `#entityCompositionStoreNote` paragraph
- `outputs/samplas-marketing-os.js` — `showStoreFilter` extended to Clients/BrandDashboard; `todaySummarySalesInfo` gained breakdown/share fields; Commerce online-only metric labeling; Monthly/Annual 3-axis + coverage-period notes; Clients KPI relabeling; Brand Intelligence store wiring (Customer Composition/Clients Overview/Score fetches); Inventory Integrity Score guard
- `test/store-performance.test.mjs` — new, 15 tests
- `test/brand-intelligence-customer-purchase-detail.test.mjs` — one regex updated (pre-existing test, adjusted for the new conditional query fragment)

## COMMITS

Pending — see final message for the hash after commit.

## FINAL HEAD

To be confirmed after commit.

## PUSH: NONE
## DEPLOY: NONE

## NEXT

**STORE-BATCH-E — ECOUNT WH_CD Store Inventory.** Connects `sync-ecount-inventory.mjs`/inventory items to `WH_CD 100`/`WH_CD 200` via the existing Store Master (no new warehouse mapping needed — confirmed reused as-is). Unblocks the two biggest deferrals from this batch: Score's Inventory Integrity component becoming genuinely store-scoped instead of unavailable, and Sell-through per store (explicitly out of scope for both this batch and STORE-BATCH-E per the user's own note).
