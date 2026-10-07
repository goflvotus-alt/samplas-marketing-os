# Clients 2026-09 historical sales = 0: root cause (read only, 2026-10-07)

Read only: authenticated GETs, no closed-month `/api/reports/monthly` call, no code change, no write.

## A. September canonical totals (Production `/api/sales/total`, 09-01..09-30)

- online 30,967,793
- offline 201,473,160 (ECOUNT 09-01..09-29; snapshot `periodEnd` 09-29)
- total 232,440,953
- coverage `partialMonths: ["2026-09"]`

## B. Clients current output (09-01..09-30, no personal data recorded)

| Field | Value |
|---|---|
| totalClients | 101 |
| onlineSalesAmount | 30,967,793 |
| **offlineSalesAmount** | **0** |
| **totalSalesAmount** | **0** |
| totalPurchaseCount / orderCount / avgOrderValue | null |
| storeCoverage | unavailable (partial) |
| accounting.basis | `saved_monthly_archive` |
| accounting.attributedRevenue | **231,785,953**: the detail aggregation had real money before it was overwritten |

## C. Pipeline (`server.mjs`, `/api/intelligence/clients`)

1. `fetchCafe24Orders(since, until)`: online orders.
2. `buildClientsOverview({ since, until, cafe24Orders, storeCode, details })`: ECOUNT lines (through 09-29) plus Cafe24, normalised and aggregated per client. `overview.summary.totalSalesAmount` = 231,785,953 (= `attributedRevenue`).
3. `buildClientsSourceCoverage(since, until)`: until 09-30 is after the snapshot `periodEnd` 09-29, so `partialMonths ["2026-09"]` and offline unavailable.
4. Partial coverage, so `summary` replaces the offline-derived fields with **null** (total, offline, counts, AOV). This is still correct.
5. A full past month with a saved archive runs this guard:
   ```js
   if (!storeCode && since === `${month}-01` && until === monthEndKey(month) && month < currentMonth()) {
     const archive = await readMonthlyArchive(month);
     if (archive?.archiveStatus === "saved" && Number.isFinite(Number(archive?.sales?.totalSales?.amount))) {
       ({ summary, accounting } = reconcileHistoricalClientsSummary(summary, overview.summary, archive));
   ```
6. `reconcileHistoricalClientsSummary` (`server.mjs:5375`):
   ```js
   const totalSalesAmount = Number(archive.sales.totalSales.amount);           // Number(null) → 0
   offlineSalesAmount: Number(archive.sales.offlineSales.offlineSalesAmount),   // Number(null) → 0
   onlineSalesAmount: Number(archive.sales.onlineSales.paidAmount),             // 30,967,793
   ```

## D. First zero point

Step 5/6. The guard `Number.isFinite(Number(null))` is `true` because `Number(null) === 0`. Then `reconcileHistoricalClientsSummary` writes `Number(null)` (0) into `totalSalesAmount` and `offlineSalesAmount`. Until that point the values were 231,785,953 (detail) or null (coverage-masked), never 0.

## E. Root cause

A null-to-zero coercion on archive fields that are legitimately null.
- The September monthly archive is saved with `offlineSales.offlineSalesAmount = null` and `totalSales.amount = null`, because `buildMonthlyArchiveSales` keeps offline null when ECOUNT coverage is incomplete (`offlineComplete` false; ECOUNT ends 09-29, the month ends 09-30).
- The guard meant "the archive has a total", but `Number.isFinite(Number(x))` cannot tell null from 0. The reconcile then turns "unknown" into "zero".
- The current month is not affected: the guard requires `month < currentMonth()`, and October goes through the as-of path.

## F. Archive schema finding

- Not a schema or field-name mismatch.
- Both months use the same fields (`sales.onlineSales.paidAmount`, `sales.offlineSales.offlineSalesAmount`, `sales.totalSales.amount`), which is exactly what the reconcile reads.

| Month | online | offline | total |
|---|---|---|---|
| 2026-08 (saved) | 34,332,620 | 253,583,500 | 287,916,120 |
| 2026-09 (saved) | 30,967,793 | **null** | **null** |

Source: `/api/reports/monthly` snapshots taken at 04:52Z and 04:53Z today; no new closed-month call. This is the same null that makes the Monthly screen say "이 archive에는 통합 매출 필드가 없어…" for September.

## G. August comparison

- August's ECOUNT covers 08-01..08-31, so the archive is complete (non-null total and offline). The guard passes on a real number, and the reconcile copies real amounts: total 287,916,120 and offline 253,583,500.
- September differs at one point only: an archive total of null instead of a number.

## H. Jan–Oct Clients vs canonical Sales (Production)

| Month | Sales total | Clients total | Clients offline | Coverage | Diff (Clients − Sales) |
|---|---|---|---|---|---|
| 2026-01 | 250,102,958 | 250,102,958 | 209,042,100 | unavailable* | 0 |
| 2026-02 | 186,329,089 | 186,329,089 | 150,256,000 | available | 0 |
| 2026-03 | 330,054,363 | 330,054,363 | 270,106,810 | available | 0 |
| 2026-04 | 354,304,011 | 354,304,011 | 295,202,650 | available | 0 |
| 2026-05 | 344,037,071 | 344,037,071 | 314,528,650 | available | 0 |
| 2026-06 | 205,267,886 | 205,267,886 | 176,732,700 | available | 0 |
| 2026-07 | 272,564,433 | 273,544,433 | 237,972,530 | available | +980,000 (online only) |
| 2026-08 | 287,219,920 | 287,916,120 | 253,583,500 | available | +696,200 (online only) |
| **2026-09** | **232,440,953** | **0** | **0** | unavailable | **−232,440,953** |
| 2026-10 (this month, to 10-06) | 51,241,534 | 51,241,534 | 47,851,300 | available | 0 |

\* January coverage is partial, but its archive has a non-null total, so the amounts are correct; purchase and order counts are null.

**Only September is zeroed.** July and August show a separate, small online-only difference: the saved-archive online (Clients) versus the live canonical online (Sales). That is pre-existing and unrelated.

## I. Minimal fix design (not implemented)

1. **Required, null-safe guard and reconcile:** only reconcile fields the archive actually has.
   - Guard: `archive?.sales?.totalSales?.amount != null && Number.isFinite(Number(...))`. Then a null-total archive is never reconciled to 0.
   - Inside `reconcileHistoricalClientsSummary`, use a `finiteOrNull` helper: a field that is null in the archive stays null; it is never `Number(null)`.
   - Result for September: online 30,967,793; offline and total null, with the partial coverage shown. That is "unknown", not "0".
2. **Recommended, show known amounts with partial metadata:** for a closed month whose archive offline is null because ECOUNT ended early (09-29), take offline and total from the canonical `buildCanonicalTotalSales` for the same range (201,473,160 / 232,440,953, `partialMonths ["2026-09"]`), and label "오프라인 09-29까지".
   - Nothing is estimated for 09-30.
   - This mirrors the current-month as-of path and `/api/sales/total`, which already reports these amounts.
3. Tests:
   - archive null total → no zero (September fixture)
   - complete archive → unchanged (August)
   - current month → unchanged
   - a null field is never coerced
4. Out of scope, separate item: the July/August online difference between the archive and live data.

## J. Mutation check

- Production: authenticated GETs only (`/api/sales/total` and `/api/intelligence/clients` for Jan–Oct). Both are read paths.
- No closed-month `/api/reports/monthly` call (archive evidence came from this morning's snapshots).
- No archive rebuild, ECOUNT upload, Brand Master, policy or pending change, push or deploy.

## K. Verdict

CLIENTS HISTORICAL SALES — ROOT CAUSE IDENTIFIED: `Number(null) → 0` in the `reconcileHistoricalClientsSummary` guard and body, for an archive whose total and offline are legitimately null (ECOUNT ended 09-29).

## Fix (local commit, not deployed)

**1. Null bug fixed.**
- `finiteOrNull(value)` returns null for null, undefined, "" or a non-finite value. A real 0 stays 0.
- The route guard and every amount in `reconcileHistoricalClientsSummary` use it. A null archive field stays null.
- `avgOrderValue` and `unassignedRevenue` are null when the total is unknown.

**2. Historical partial fallback.** `resolveHistoricalClientsSales(...)`, for a closed full month with a saved archive:
- The archive total is a number → the existing saved-archive reconciliation (basis `saved_monthly_archive`), unchanged.
- The archive total is null → amounts come from the canonical `buildCanonicalTotalSales({ since, until })`, the same function as `/api/sales/total`.
  - basis `canonical_partial_coverage`.
  - Response adds `requestedPeriod` and `asOf: { basis, onlineThrough, offlineThrough (ECOUNT periodEnd), missingOfflineDays, coverage: "partial" }`.
  - Coverage stays partial.
  - Counts the source does not have (purchases, orders, AOV) stay null.
  - Nothing is estimated for the missing days.

**3. UI:** the Clients status line adds `오프라인 최신 MM-DD` and `월말 N일 미수집 (부분 집계)`.

**Expected September on Production** (canonical, as `/api/sales/total` reports today):
- online 30,967,793; offline 201,473,160 (through 09-29); total 232,440,953
- 101 clients; coverage partial
- `asOf.offlineThrough` 2026-09-29; `missingOfflineDays` 1

Online covers the whole month (Cafe24 is complete). Offline covers 09-01..09-29, so the label says "오프라인 최신 09-29 · 월말 1일 미수집" rather than shortening the whole period.

**Regression (local):**
- The old code (HEAD) and the new code ran side by side on the same DEV data.
- Clients Jan–Oct are identical in every month and every field.
- DEV's September archive is complete, so September there takes the unchanged path; the null-archive path is covered by tests.
- The July/August online difference is out of scope and unchanged.

**Tests:** `test/clients-historical-partial.test.mjs` (7 tests).
- `finiteOrNull`, including a real 0.
- A null archive is never 0.
- The September fixture with Production values gives the canonical known amounts, partial metadata and null counts.
- All-unknown stays null; a real canonical 0 shows as 0.
- August with a complete archive is unchanged.
- Spawned server: the null-archive month uses `canonical_partial_coverage` with `missingOfflineDays` 1, and the complete month uses `saved_monthly_archive`.
- The UI label.

The existing tests (`final-data-trust-remediation`, Clients current month, auth) pass. Full suite: 1420/1420.
