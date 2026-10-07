# Clients historical online = canonical live (2026-10-07)

Local implementation, tests and commit only. No push, deploy or archive write.

**Change** (`resolveHistoricalClientsSales`, Clients full past month with a saved archive):
- **Archive offline is a number:** online = `buildCanonicalTotalSales({ since, until })` online (live canonical, the same as `/api/sales/total`). Offline = saved archive offline (ECOUNT). Total = online + offline.
  - `accounting`:
    - `basis: "historical_canonical_online"`
    - `onlineBasis: "canonical_live"`, or `"saved_monthly_archive"` if the canonical call fails
    - `canonicalOnlineAmount`, `archiveOnlineAmount`, `onlineDeltaFromArchive`
    - `offlineBasis: "saved_monthly_archive"`, `archiveOfflineAmount`
    - plus the existing `attributedRevenue` / `unassignedRevenue`
  - No `asOf`, so no UI coverage notice for complete months.
- **Archive offline is null** (September): the existing `canonical_partial_coverage` path is unchanged.
- **Current month:** unchanged.
- Client attribution, counts, purchases and orders: unchanged.

**Local before/after** (old HEAD vs new on the same DEV data, Jan–Oct):
- Every month's Clients online equals canonical Sales online.
- Offline, client counts and purchase/order counts are unchanged in every month.
- October is unchanged.
- July (DEV archive identical to Production): online 35,571,903 → **35,000,863**; total 273,544,433 → **272,973,393**; delta −571,040. The delta is the 980,000 post-close return minus the +408,960 partial-claim fix.

**Production expectations** (to verify after deploy):

| Month | Online | Offline | Total | Path |
|---|---|---|---|---|
| 2026-07 | 35,000,863 | 237,972,530 | 272,973,393 | `historical_canonical_online` |
| 2026-08 | 34,722,620 | 253,583,500 | 288,306,120 | `historical_canonical_online` |
| 2026-09 | 31,099,793 | 201,473,160 | 232,572,953 | unchanged, `canonical_partial_coverage` |
| 2026-10 | unchanged | | | current month |

**Tests:** `test/clients-historical-partial.test.mjs`.
- Canonical ≠ archive (July/August Production values) → canonical online, archive offline, recomputed total, and the full accounting metadata.
- Canonical = archive → unchanged, delta 0.
- Canonical unavailable → archive online fallback, recorded.
- A null archive online is never 0.
- The September partial path is unchanged.
- The route test asserts the new basis and metadata.

Full suite passes.
