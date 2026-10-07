# Monthly historical online = canonical live (2026-10-07)

Local implementation, tests and commit only. No push or deploy. Archives are immutable: no rewrite, rebuild or overwrite.

**Change:**
- `GET /api/reports/monthly` for a closed month with a saved archive now returns `sales` passed through `historicalMonthlySalesView`. This is display only. It runs after the existing freshness-enrichment step and never writes the overlaid values.
- `resolveHistoricalMonthlySales` reuses the Clients rule (`resolveHistoricalClientsSales`):
  - **Archive offline is a number:** online = live `buildCanonicalTotalSales` online; offline = archive; total = online + offline. `sales.reconciliation` holds `basis: historical_canonical_online`, `onlineBasis: canonical_live`, `canonicalOnlineAmount`, `archiveOnlineAmount`, `onlineDeltaFromArchive`, `offlineBasis: saved_monthly_archive` and `archiveOfflineAmount`.
  - **Archive offline is null** (September): canonical known amounts; coverage stays partial; `reconciliation.basis: canonical_partial_coverage` with `asOf` (offlineThrough, missingOfflineDays).
  - **Canonical unavailable:** the archive amounts are shown unchanged, with `onlineBasis: saved_monthly_archive` and `canonicalOnlineAmount: null`.
- Current month: unchanged.
- `commerce` (brand and product sales) is unchanged.
- UI: the Monthly summary sentence ("온라인 실제 매출은 …") now reads the same `sales.onlineSales.paidAmount` as the KPI card, for this month and last month, with `commerce.paidAmount` as the fallback. No new warning; partial months keep the existing coverage note.

**Local check** (new server on a scratch copy of DEV work, so DEV archives were never touched): Monthly online = Sales online = Clients online in every month Jan–Oct. July: 35,000,863 / 237,972,530 / 272,973,393.

**Production expectations** (to verify after deploy):

| Month | Online | Offline | Total | Path |
|---|---|---|---|---|
| 2026-07 | 35,000,863 | 237,972,530 | 272,973,393 | historical_canonical_online |
| 2026-08 | 34,722,620 | 253,583,500 | 288,306,120 | historical_canonical_online |
| 2026-09 | 31,099,793 | 201,473,160 | 232,572,953 | canonical_partial_coverage, partial, offline through 09-29 |
| 2026-10 | unchanged | | | current month |

**Tests:** `test/monthly-historical-online.test.mjs`.
- Canonical ≠ archive (July/August values): online, offline, total and metadata.
- Equal values → unchanged.
- Canonical failure → archive shown, fallback recorded.
- September partial: known amounts, partial coverage, null stays null.
- Route: canonical view returned, and the archive file is byte-identical after the GET.
- UI summary source.

Full suite passes. Out of scope and untouched: the April 26,400 product-allocation gap, Clients, ECOUNT, Brand Master, policy and pending.
