# Monthly 03 Store Performance — Live Data

## Baseline

- Starting branch: `main`
- Starting HEAD: `21771e3`
- Commit: NO
- Push / Deploy / Render: NO

## Changed files

- `server.mjs`
- `outputs/samplas-marketing-os.js`
- `outputs/samplas-marketing-os.css`
- `test/monthly-performance-ia.test.mjs`
- `docs/reports/MONTHLY-STORE-PERFORMANCE-LIVE-DATA.md`

Existing unrelated changes, input files, and the preceding ECOUNT sheet-compatibility batch were preserved and were not staged.

## Reused implementation

- Store headline source: existing `GET /api/sales/total` → `offlineSales.byStore`
- Store lines: existing `readEcountOfflineSalesSnapshot()` merged store-separated response
- Canonical identity: existing `loadResolverContext()`
- Store brand aggregation: existing `mergeOfflineBrandSales()`
- Unresolved exclusion: existing `isExcludedBrandPerformance()` policy (`UNASSIGNED`, `B0000000`)
- Brand and Store navigation: existing Monthly Intelligence link handlers
- Ranking and popover shell: existing `monthlyReportRankRows()` and `monthlyIntelBrandLabelHtml()`

## Implementation

- `/api/ecount-sales/monthly` keeps all existing fields unchanged and adds `storeBrandSales` only when `includeStoreBrands=1` is requested without a store filter.
- `storeBrandSales` is offline-only and is produced by filtering actual `salesLines` by `storeCode`, then calling the official canonical merge function.
- Store headline amounts and share denominator use the existing canonical `offlineSales.byStore` response. `salesLines` totals are not used as a headline fallback.
- Store coverage is shown from the actual min/max dates present for each attributed store.
- Previous-month comparison is shown only when the prior snapshot contains the same real store attribution; July legacy ALL data therefore remains `전월 비교 데이터 없음`.
- TOP BRAND renders only real resolved rows, up to five. VEIL currently renders exactly one row.

Canonical sales calculation changed: **NO**

## 2026-08 reconciliation

| Metric | Amount |
|---|---:|
| APGUJEONG | 97,177,900원 |
| VEIL (internal key `VAIL`) | 70,200원 |
| Offline | 97,248,100원 |
| Online | 18,113,792원 |
| Total | 115,361,892원 |

- APGUJEONG + VAIL = Offline: PASS
- Online + Offline = Total: PASS
- Difference before/after: 0원

## Coverage and previous month

- APGUJEONG: `08.01–08.14`
- VEIL: `08.03–08.13`
- Previous store-separated snapshot: unavailable for both stores
- UI result: `전월 비교 데이터 없음`
- Missing store behavior: unavailable / unclassified, never fabricated as 0원

## Store canonical brand results

### APGUJEONG TOP 5

1. CARNET ARCHIVE — 11,562,800원 — 34개
2. TROUBLED WATERS — 9,179,600원 — 28개
3. MINGA — 5,111,600원 — 40개
4. REMAGINE — 3,791,200원 — 8개
5. PHTMNE — 3,265,600원 — 4개

### VEIL

1. PACOSPLY — 70,200원 — 1개

No synthetic ranks 2–5 were rendered.

### Unresolved policy

APGUJEONG contains unresolved offline revenue, but the existing overall Brand Performance exclusion policy removes `UNASSIGNED` from the visible TOP list. No brand was guessed. VEIL unresolved revenue is 0원.

## Verification

- JavaScript / server syntax: PASS
- Targeted regression: 43/43 PASS
- Full regression: 666/666 PASS
- `git diff --check`: PASS

## Chrome QA

URL: `http://127.0.0.1:8788/#monthly-report`

- Sales Structure: 115,361,892원 / 97,248,100원 / 18,113,792원 — PASS
- APGUJEONG headline/share/coverage/TOP5 — PASS
- VEIL spelling/headline/share/coverage/one real brand — PASS
- Overall Brand Performance unchanged and visible — PASS
- Online Summary unchanged and visible — PASS
- VEIL Intelligence navigation — PASS (`#store-vail-intelligence`)
- PACOSPLY Brand Intelligence navigation — PASS (`#brand-dashboard`)
- Medium viewport: Store cards stack within the report content area — PASS
- Application TypeError / null-reference / NaN / uncaught error — NONE

The first cold browser load hit the pre-existing Monthly report 8-second upstream response timeout. A reload after the server cache was warm rendered the complete report. Chrome logged only extension message-channel errors while navigating; no application-source error was observed.

## Final Git state

No staging or commit was performed. Existing unrelated modified/untracked files remain preserved alongside the five files changed in this batch.
