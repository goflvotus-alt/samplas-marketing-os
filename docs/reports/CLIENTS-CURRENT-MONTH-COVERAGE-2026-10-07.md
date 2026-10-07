# Clients current-month coverage UX (2026-10-07)

Local implementation, tests and commit only. No push and no Production write.

**Problem:**
- The Clients "이번 달" preset requested 10-01..today (10-07).
- ECOUNT covers 10-01..10-06, so offline coverage was partial and totals, counts and AOV showed "-".
- Monthly already ends the current month at `asOfDate`.

**Change (one rule, shared):**
- `currentMonthAsOf(month)` in `server.mjs` uses the existing `currentMonthSalesCutoff(monthEnd, today, ECOUNT periodEnd)`. It returns `{ asOfDate, offlineThrough, currentMonthInProgress, uncollectedThroughToday }` for the current month when ECOUNT covers the month from day 1, otherwise null.
- `buildMonthlyArchive` now calls this helper instead of an inline copy. Behaviour is identical: 2026-10 is still online 3,390,234 / offline 47,851,300 / total 51,241,534 / `asOfDate` 2026-10-06.
- `/api/intelligence/clients` takes an opt-in `coverage=current-month`. Only when `since` is the first of the current month does it shrink `until` to `asOfDate`. The response then includes `requestedPeriod` and `asOf`.
- Explicit ranges are untouched: no flag, so the partial-coverage nulls remain. Past months ignore the flag.
- The UI sends the flag only for the "이번 달" preset. The status line reads `이번 달 · 데이터 기준 2026-10-01 ~ 2026-10-06 · 오프라인 최신 10-06`.

**Verified locally against the October snapshot** (the same files as Production; values are checks only, not hardcoded):

| Request | Result |
|---|---|
| "이번 달" (`coverage=current-month`) | period 10-01~10-06 (requested ~10-07); 37 clients; total 51,241,534; offline 47,851,300; online 3,390,234; purchases 177; orders 99; AOV ≈289,500 |
| Explicit 10-01~10-07 | offline, total and counts null, as before |
| September, with or without the flag | identical; no `asOf` |

**Tests:** `test/clients-current-month-coverage.test.mjs`.
- Shared cutoff rule, and both call sites use the helper.
- Spawned server with a dynamic current-month ECOUNT fixture: the preset clamps, an explicit range keeps nulls, a past month ignores the flag.
- UI flag and label.

Full suite: 1413/1413.
