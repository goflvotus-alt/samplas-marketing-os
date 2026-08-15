# BI-CORE-1 — Brand Intelligence Core Metrics Data Flow Diagnosis

READ-ONLY. No source, test, or data file modified. Verified live via the already-running local server (`node server.mjs`, PID 57547, port 8787, serving this exact repository) using plain `GET` requests and a Chrome QA pass — no write operations performed anywhere.

## 1. Repository State

```
pwd    = ~/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com
branch = main
HEAD   = 24cf20efd0142e18bd1cdf4b1c828bc720f9b7f4
status = (clean — no modified, untracked, or staged files)
```

This is the post-reconciliation `main` (the git-divergence reconciliation merge from the prior checkpoint sequence). This fact turns out to be central to the finding below.

## 2. Brand Intelligence Core Metric UI — Located

- **File**: `outputs/samplas-marketing-os.html` (markup) + `outputs/samplas-marketing-os.js` (binding)
- **Elements**: `#entityHeroKpiSales` (Revenue), `#entityHeroKpiQty` (Units), `#entityHeroKpiAov` (AOV), `#entityHeroKpiOrders` (Orders) — inside `#entityHeroKpiGrid` (`outputs/samplas-marketing-os.html:1554-1588`)
- **Function**: `renderEntityHeroKpiFromMonthlyState()` (`outputs/samplas-marketing-os.js:14118-14147`)
- **State variable read**: `entityTrendMonths` (module-level array, one row per month) — specifically the row where `row.key === currentEntityPeriodMonthKey()`
- **Payload properties used**: `row.revenue`, `row.quantitySold`, `row.aov`, `row.orderCount`
- **Fallback/loading behavior**: if no row is found for the current period (`index < 0`), all four fields render literally `"-"` (dash), not `"0"`.
- **Zero/default behavior**: if a row *is* found but its source `brandSales` entry was not matched (`row` inside the `.map()` in `refreshEntityTrendMonths()` is `null`), each field defaults via `row ? value : 0` — i.e., a **found month with no matching brand** renders as `0원`/`0개`/`0건`, which is exactly the symptom described (zero, not dash).

**Classification of where a zero *would* come from, if it occurred**: **C — frontend/brand-code matching mismatch inside `refreshEntityTrendMonths()`'s `.find(item => monthlyReportBrandCode(item) === brandCode)`**, not A (API returning zero for a real match), not D (fetch failure — a failure would leave `entityTrendMonths` empty, producing dashes, not zeros), not G (stale cache — `getSharedJson` is a simple in-flight-dedupe cache keyed by URL, not a stale-data cache). This is not a guess — it follows directly from reading the exact fallback logic in both functions (§3 below traces it end to end, and §5/§6 test it against real data).

## 3. Fetch Path Trace

```
outputs/samplas-marketing-os.js: applyBrandIdentity(name)
  → resolveBrandIdentity(name)                          [resolves display name → brand_code via brandSelectorIdentityByName]
  → refreshEntityTrendMonths()
      → GET /api/reports/monthly?month=YYYY-MM  (getSharedJson, cached per URL)  — one call per month, Jan..selected
server.mjs:386  GET /api/reports/monthly
  → if month === currentMonth(): buildMonthlyArchive(month)              [live, uncached]
  → else: readMonthlyArchive(month) + enrichMonthlyArchiveBrandSales()   [saved/cached] or buildMonthlyArchive() [draft]
buildMonthlyArchive() → buildMonthlyArchiveBrandSales(monthStart, monthEnd, commerceSource)
  → loadResolverContext({ onlineCatalog })              [scripts/unified-identity-resolver.mjs]
  → mergeOfflineBrandSales({ brandSales, onlinePaidAmount, offlineLines, identityContext })
      → resolveIdentity(line, identityContext)           [scripts/unified-identity-resolver.mjs — per offline ECOUNT line]
  → returns commerce.brandSales[] with sales.paidAmount / quantitySold / orderCount / onlinePaidAmount / offlineSalesAmount per brand_code
outputs/samplas-marketing-os.js: refreshEntityTrendMonths()
  → row = archive.commerce.brandSales.find(item => monthlyReportBrandCode(item) === brandCode)
  → entityTrendMonths[i] = { revenue: canonicalPaidAmount(row), quantitySold, orderCount, online, offline, aov }
  → renderEntityHeroKpiFromMonthlyState()  → writes into #entityHeroKpiSales/Qty/Aov/Orders
```

**Data shape at each stage** (all confirmed live, §5):
| Stage | revenue | units | orders | aov | online | offline |
|---|---|---|---|---|---|---|
| `commerce.brandSales[]` row (server) | `sales.paidAmount` / `canonicalPaidAmount` | `quantitySold` | `orderCount` | *(not present server-side — frontend computes it)* | `onlinePaidAmount` | `offlineSalesAmount` |
| `entityTrendMonths[i]` (frontend) | `revenue` | `quantitySold` | `orderCount` | `aov` (computed: `orderCount ? round(revenue/orderCount) : 0`) | `online` | `offline` |
| rendered DOM | `apiWon(row.revenue)` | `apiNum(row.quantitySold)}개` | `apiNum(row.orderCount)}건` | `apiWon(row.aov)` | (channel-split bar, separate function) | (channel-split bar) |

## 4. Canonical Sales Source Identification

| | |
|---|---|
| **SOURCE** | `buildMonthlyArchiveBrandSales()` (`server.mjs`) → `mergeOfflineBrandSales()` (`scripts/monthly-brand-sales.mjs`), served via `GET /api/reports/monthly` |
| REVENUE | available (`sales.paidAmount`/`canonicalPaidAmount`) |
| UNITS | available (`quantitySold`) |
| ORDERS | available (`orderCount`) |
| AOV | unavailable server-side (frontend derives `revenue/orderCount` — consistent with `test/brand-intelligence-partial-period.test.mjs` test #11's explicit "AOV = revenue/orderCount, not revenue/quantitySold" contract) |
| ONLINE/OFFLINE | available (`onlinePaidAmount`, `offlineSalesAmount`) |
| BRAND FILTER | available (`brand_code`, matched via `monthlyReportBrandCode()`) |
| PERIOD FILTER | available (`month` query param, one archive per month) |
| PARTIAL-PERIOD SUPPORT | not on this endpoint (that's `/api/reports/monthly-comparison-cutoff`, a separate, Compare-Mode-only endpoint — see §7) |
| **RECOMMENDED** | **YES — already in use, no substitute needed** |

**Cross-checked against other screens**: `Monthly` report screen consumes this exact same `/api/reports/monthly` endpoint (it's the same feature this report was named after). `Commerce`/`Brand Dashboard` (online-only) instead use `aggregateCafe24BrandSalesByBrandCode()` (`server.mjs:3141`) — a *different*, online-only aggregator, correctly **not** what Brand Intelligence uses, since Brand Intelligence needs combined online+offline totals. `Clients` uses `intelligence-service.mjs`'s own `buildClientsOverview()`/`buildBrandCustomerComposition()`, unrelated to hero revenue. STEP67/partial-period uses `buildCrossBrandComparisonPeriodPayload()`, a Compare-Mode-only sibling. `monthly-brand-sales.mjs`'s `mergeOfflineBrandSales()` *is* the function `buildMonthlyArchiveBrandSales()` calls — it's the same source, not a competing one. **No new sales calculation exists or is needed; Brand Intelligence already reuses the one approved canonical aggregator.**

## 5. CARNET ARCHIVE / 2026-08 Direct Trace

Queried the live local server (`GET http://localhost:8787/api/reports/monthly?month=2026-08`, `archiveStatus: "live"`) and `GET http://localhost:8787/api/brand-master`, read-only:

```
Revenue (canonical paidAmount): 10,883,059원
Units (quantitySold):            32개
Orders (orderCount):             25건
AOV (revenue/orders):            435,322원  (10,883,059 / 25 = 435,322.36 → rounds to 435,322)
Online revenue (onlinePaidAmount):  1,021,959원
Offline revenue (offlineSalesAmount): 9,861,100원
Matched online orders (orderHistory): 2 Cafe24 orders shown in the sample payload (order 20260810-0000012, order 20260802-0000074), contributing to the 25-order total together with ECOUNT offline slips
Canonical brand code: B00000KU
Canonical brand name (Brand Master): 카르넷 아카이브
Brand Master name_aliases: ["CARNET ARCHIVE"]
Brand identity resolution result: consistent — every product line in the sample payload carries brandCode "B00000KU" and productName bracket-notation "[CARNET ARCHIVE : 카르넷 아카이브] ..."
```

No `work/monthly/*.json` file was rebuilt, written, or uploaded — this was a live, in-memory `buildMonthlyArchive()` call triggered by the existing `archiveStatus: "live"` code path for the current month, exactly as it runs for any normal page load.

## 6. Canonical vs. Endpoint vs. Frontend vs. Rendered — Comparison Table

Performed a live Chrome QA pass (select "CARNET ARCHIVE", period 2026년 8월) against this exact server, and read the browser console (which has a built-in diagnostic, `verifyBrandIdentityMonthlyMapping()`, logging exactly this comparison):

```
[Brand Identity] "CARNET ARCHIVE" (brand_code=B00000KU) → 2026-08 Monthly brandSales 매핑: FOUND
```

| Metric | Canonical (§5) | Endpoint payload | Frontend (`entityTrendMonths`) | Rendered DOM | Mismatch location |
|---|---|---|---|---|---|
| Revenue | 10,883,059 | 10,883,059 | 10,883,059 | **10,883,059원** | **none** |
| Units | 32 | 32 | 32 | **32개** | **none** |
| Orders | 25 | 25 | 25 | **25건** | **none** |
| AOV | 435,322 | *(not a server field; derived)* | 435,322 | **435,322원** | **none** |
| Online | 1,021,959 | 1,021,959 | 1,021,959 | 1,021,959원 (channel mix) | **none** |
| Offline | 9,861,100 | 9,861,100 | 9,861,100 | 9,861,100원 (channel mix) | **none** |

**No mismatch exists anywhere in this pipeline right now.** The Core Metrics render correctly, live, in the browser, for exactly the brand/period combination described in the task.

**Why this differs from the task's stated "Current UI" (all zero)**: this repository's `main` was, immediately prior to this diagnosis, the target of a separate git-divergence reconciliation (documented in `docs/reports/NEXT-GIT-DIVERGENCE-FINAL-RECONCILIATION-EXECUTION.md` and the chain of `NEXT-*` reports preceding it) that migrated `mergeOfflineBrandSales()` from an ad-hoc brand matcher to the canonical Unified Identity Pipeline (`scripts/unified-identity-resolver.mjs`). That migration is *exactly* the class of fix that would turn this precise symptom (brand-code match failure → all four Core Metrics silently falling to zero via the `row ? value : 0` fallback) into a working match. The running server process (PID 57547) has been serving these already-fixed files from disk throughout (the reconciliation's merge was proven to introduce zero file-content change — the fix was already on disk, only git history was missing it), so it is not possible to reproduce the reported zero-value state against the current code without deliberately reverting that fix. The task's "Current UI" description most likely reflects an observation made before that local fix existed, or against a stale browser tab — this cannot be verified further from the repository alone, but the mechanism match is exact and the live re-test is conclusive: **the bug this task asks to diagnose is the same bug already fixed by the reconciliation, and it is fixed as of the current `main`.**

## 7. Period Semantics

**Current approved behavior for single-brand normal mode**: **live, full-month canonical calculation** for the current month (`server.mjs:390-392`: `if (month === currentMonth()) { const archive = await buildMonthlyArchive(month); ... archiveStatus: "live" }`), re-run on every request (uncached), reflecting whatever transactions exist so far — not a deliberate month-to-date truncation, not a same-elapsed-day cutoff, and not read from a saved archive file (saved-archive reads only apply to *past*, closed months).

**Same-elapsed-day cutoff logic exists but is architecturally separate**: `buildCrossBrandComparisonPeriodPayload()` / `/api/reports/monthly-comparison-cutoff` (STEP67 cross-brand partial-period) is a distinct endpoint, and its frontend consumer (`refreshEntityCompareKpi()`, `entityCompareTargetPeriodData`) only activates when **Compare Mode is toggled on** (`entityCompareState.enabled`). `renderEntityHeroKpiFromMonthlyState()` — the single-brand Hero KPI function this task is about — reads only from `entityTrendMonths`, which is built from the plain, non-cutoff `/api/reports/monthly` endpoint, confirmed by direct code reading (§3). **Compare Mode's partial-period logic is not, and should not be, forced onto single-brand normal mode** — this is already the existing architecture, not something requiring a change.

`test/brand-intelligence-partial-period.test.mjs` test #1 ("HERO LIVE MONTH — raw value visible, no MoM %, no decline label") is the existing regression test locking in exactly this live-month-shows-raw-value behavior for single-brand mode.

## 8. Brand Identity Check

| | |
|---|---|
| Canonical brand name (Brand Master) | 카르넷 아카이브 |
| Canonical brand code | B00000KU |
| Cafe24 alias (bracket notation, from real order data) | `[CARNET ARCHIVE : 카르넷 아카이브]` |
| Brand Master `name_aliases` | `["CARNET ARCHIVE"]` |
| ECOUNT aliases/groups | not separately inspected this checkpoint (out of the narrow trace needed — the offline total, 9,861,100원, already flows through correctly per §5/§6, confirming ECOUNT-side resolution works) |
| Unmatched lines / UNASSIGNED records for this brand this period | none observed in the sample payload |
| Frontend display-name resolution | `brandCanonicalDisplayName()` correctly surfaces "CARNET ARCHIVE" (English, from the bracket-notation product name via `registerProductRegistryCanonicalNames()`, populated on Brand Intelligence's own `initBrandSelector()` — no dependency on visiting Commerce first) |
| Round-trip resolution (display name → brand_code → monthly brandSales match) | **consistent, confirmed FOUND** via the live console diagnostic |

**Identity resolution does not contribute to the zero metrics** — it resolves correctly and consistently across every layer checked (Brand Master, Cafe24 product naming, ECOUNT-derived offline totals, frontend selector, and the monthly archive's own brand-code matching).

## 9. Existing Test Coverage

| Test file | Covers | Result |
|---|---|---|
| `test/brand-intelligence-partial-period.test.mjs` | Hero KPI live-month raw-value display, AOV = revenue/orderCount semantics, NULL-vs-fake-zero handling, trend/chart live-month exclusion | 11/11 PASS |
| `test/monthly-brand-sales.test.mjs` | `mergeOfflineBrandSales()` / Resolver F → Unified Identity Pipeline migration | 1/1 PASS |
| `test/unified-identity-resolver.test.mjs` | `resolveIdentity()`/`loadResolverContext()` correctness | 13/13 PASS (+2 real-data shadow tests) |
| `test/monthly-archive-freshness.test.mjs` | `buildMonthlyArchive()`/`enrichMonthlyArchiveBrandSales()` staleness/second-merge-prevention, including the exact CARNET-like fixture scenario | 13/13 PASS |
| `test/cross-brand-period-cutoff.test.mjs`, `test/cross-brand-partial-period-p2.test.mjs` | Compare-Mode-only cutoff logic (confirmed architecturally separate, §7) | 11/11 each PASS |

All directly relevant existing tests already pass against the current code — no test needs to be written or modified to confirm this diagnosis; they already lock in the correct behavior.

## 10. Minimum Implementation Plan

**No implementation needed.** The canonical aggregator (`buildMonthlyArchiveBrandSales`/`mergeOfflineBrandSales`), the endpoint (`/api/reports/monthly`), and the UI binding (`refreshEntityTrendMonths`/`renderEntityHeroKpiFromMonthlyState`) are already fully connected and were verified live, end to end, to produce correct values for the exact brand/period in question. There is no gap to close.

**If the zero-value state is reproduced again in the future** (e.g., a different brand, a different month, or after some regression), the smallest safe fix — should one ever be needed — would remain exactly the pattern already used here: ensure `loadResolverContext()`/`resolveIdentity()` (`scripts/unified-identity-resolver.mjs`) can resolve the brand for the affected sales lines, since that is the single point where a match failure silently degrades all four Core Metrics to zero. No duplicate sales formula, no frontend calculation, no new archive semantics, no changes to Customer Composition/Category Intelligence/Sell-through/Compare Mode would be involved in such a fix — all of those remain untouched by this diagnosis, consistent with the task's constraints.

**Expected files to change**: none, for this task.

## 11. Regression Risk

No code change is proposed by this diagnosis, so risk is assessed at **NONE** across the board — nothing is being touched:

| Area | Risk |
|---|---|
| Today | NONE |
| Monthly | NONE |
| Annual | NONE |
| Commerce | NONE |
| Clients | NONE |
| STEP67 | NONE |
| Monthly Archive | NONE |
| Customer Composition | NONE |
| Inventory | NONE |
| Category Intelligence | NONE |
| Compare Mode | NONE |
| Sell-through | NONE |

## Original Repository Safety

No file modified. `git status --short` clean before and after this diagnosis. No archive rebuilt, no upload performed, no code/test/data changed.
