# MONTHLY PERFORMANCE IA REBUILD

## STARTING HEAD

`880b7135cf8611711dc90d23b7374b962e418a16`

## FILES CHANGED

- `outputs/samplas-marketing-os.html`
- `outputs/samplas-marketing-os.css`
- `outputs/samplas-marketing-os.js`
- Monthly UI regression tests under `test/`
- This report

## OLD MONTHLY IA

Monthly mixed the calendar, long Commerce detail, Marketing/Content summaries, Mission UI, and placeholder operations areas into a long report. The daily sales calendar was below the report instead of being the first decision surface.

## NEW MONTHLY IA

1. Daily Sales
2. Sales Structure
3. Store Performance
4. Brand Performance
5. Online Summary

Existing Goal Progress remains after the performance report because it is a functioning goal surface, not an empty Monthly Operations placeholder.

## CALENDAR MOVE

The existing `todaySalesCalendar` renderer and its existing API/calculation path are reused unchanged. Its DOM slot now appears immediately after the Monthly selectors and freshness header. Chrome QA confirmed the calendar is visible at the top of Monthly and month switching remains synchronized with the report.

## SALES STRUCTURE

The report now presents Total, Offline, and Online together in a compact three-card section. Values continue to come from the existing monthly archive/live state and existing delta helper.

## OFFLINE STORE SPLIT

The store split accepts only actual `storesIncluded` data. When both APGUJEONG and VAIL are present, the donut denominator is `APGUJEONG + VAIL`, never total company sales. When attribution is absent, the UI says `미분류` / `확인 불가`; zero or an arbitrary allocation is never fabricated.

## STORE TOP5 SOURCE

No trustworthy store-scoped brand sales source exists in the current July/August data. The two store cards therefore retain the TOP BRAND 5 shell and show `매장별 판매 데이터 업로드 후 표시됩니다`. They are ready to render only when existing store-separated data becomes available.

## APGUJEONG TOP5

Not displayed because the current source does not provide a trustworthy APGUJEONG-scoped canonical brand ranking. No company-wide fallback is used.

## VAIL TOP5

Not displayed because the current source does not provide a trustworthy VAIL-scoped canonical brand ranking. No APGUJEONG or company-wide fallback is used.

## OVERALL BRAND PERFORMANCE

The long historical row dump is replaced by a compact canonical TOP 5 showing current month, previous month, difference, growth rate, quantity, and rank. Hover preserves Monthly Quick Intelligence. Click resolves the row's canonical `brand_code` at interaction time and opens the existing Brand Intelligence view.

## ONLINE SUMMARY

Monthly now keeps only online sales, orders, and AOV. Payment method, brand, and product detail remain in the existing Commerce view. All summary cards and the closing CTA reuse the existing Commerce route.

## REMOVED PLACEHOLDERS

- Monthly Operations / relocation shell
- Monthly embedded Marketing chapter
- Monthly embedded Content chapter
- Monthly Mission/Intelligence teaser
- Duplicated long Commerce detail

Underlying APIs and data remain intact for their destination views.

## DATA CALCULATION CHANGED

No. Cafe24 paid sales, ECOUNT offline sales, canonical total sales, archive calculation, canonical brand resolution, and store attribution logic were not changed.

## TARGETED TESTS

`143/143 PASS`

The focused suite covers IA order, calendar placement, removal boundaries, conservative store split, donut denominator, dynamic brand/store navigation, compact Commerce delegation, Quick Intelligence, and the medium-width Monthly layout guard.

## FULL REGRESSION

`660/660 PASS`

JavaScript syntax and `git diff --check` also pass.

## CHROME QA

Actual Google Chrome at `http://127.0.0.1:8787/#monthly-report`:

- Calendar is the first Monthly data surface.
- At the connected 903 × 761 CSS-pixel viewport, the report no longer falls below the full sidebar; the medium-width Monthly layout keeps navigation and report side by side.
- August live values render as Total 97,258,592원, Offline 79,144,800원, Online 18,113,792원.
- July saved report renders Total 273,544,433원, Offline 237,972,530원, Online 35,571,903원.
- Missing store attribution stays `미분류`; no donut or TOP5 values are fabricated.
- Brand hover displays current/previous/delta/rate/quantity/rank.
- CARNET ARCHIVE click opens Brand Intelligence with CARNET ARCHIVE selected.
- 압구정 card opens the existing Apgujeong Intelligence view.
- Online sales card opens Commerce.
- Today and Annual navigation/rendering remain operational.
- No application `Uncaught`, `TypeError`, `NaN`, or null-reference error was observed. Chrome recorded only the browser-extension message-channel closure noise, unrelated to Marketing OS code.

## KNOWN BLOCKERS

- Current monthly files have no store-separated attribution, so APGUJEONG/VAIL donut and store TOP5 correctly remain unavailable.
- July's reused Daily Calendar live endpoint shows Online 34,591,903원 and Total 272,564,433원, while the saved July Archive shows Online 35,571,903원 and Total 273,544,433원. Offline is identical at 237,972,530원. This pre-existing source-timing difference was not hidden or recalculated in this UI-only batch.
- Store Intelligence destination pages still identify themselves as existing MOCK/UI shells; this batch only reuses their established routes.

## COMMIT

`feat(monthly): rebuild performance dashboard IA`

## FINAL HEAD

The commit containing this report (recorded in the completion response).
