# MONTHLY UI RESTRUCTURE — Summary / Commerce / Content / Monthly Intelligence

**Date**: 2026-08-14
**Scope**: Remove all advertising UI from Monthly (ad data/API/calc logic untouched, kept for future Content Intelligence), fully separate Monthly from Annual/YTD (both routes already shared one DOM section — now visibility-toggled so only one shows at a time), and re-chapter Monthly into `01 Summary / 02 Commerce / 03 Content / 04 Monthly Intelligence`. Today is not touched by this batch.

---

## STARTING HEAD

`93039d9` (STORE-INTEL-UI-B + doc-fix). `git status --short` at batch start showed only pre-existing untracked BI-BATCH docs; `git diff --stat` empty.

## FILES CHANGED

- `outputs/samplas-marketing-os.js` — `renderMonthlyArchiveReport` re-chaptered; `monthlyReportBrandSignalsBlock` signature/markup no longer takes/renders an ad reconciliation label; `homeGoalCards` drops the "광고" goal card; `setActiveView` gains three new visibility toggles
- `outputs/samplas-marketing-os.html` — `#monthlyDestinationLayout` (Monthly Operations / Goal Progress / Calendar) moved from before `#monthlyArchiveReport` to after it
- `test/monthly-restructure.test.mjs` — new, 20 tests

No changes to `server.mjs`, `intelligence-service.mjs`, or any file under `work/` — this batch is 100% client-side UI, as scoped. No calculation logic changed anywhere.

## 변경 전 구조 (Before)

```
Reports view (#Reports)
├── monthRail
├── monthlyDestinationLayout   ← Goal Progress / Calendar sat ABOVE the report
├── monthlyFreshnessHeader
├── monthlyArchiveReport
│    ├── header + summary sentence (included "광고비는...")
│    ├── TOC: 01 Commerce / 02 Marketing / 03 Content
│    ├── salesSummaryBlock + brandSignalsBlock (with "데이터 일치검증" ad label)
│    ├── ch1 Commerce
│    ├── ch2 Marketing  ← 광고비, Meta 구매값, 집행/미집행, 오차율, 일치검증, "광고 데이터 보기" 버튼
│    ├── ch3 Content
│    └── missionSummaryBlock (unlabeled, no chapter number)
└── annualArchiveFlow          ← ALWAYS rendered directly below Monthly, no hide/show
```
`setActiveView` only toggled `monthlyDestinationLayout` by route; `annualArchiveFlow`/`monthlyArchiveReport`/`monthlyFreshnessHeader` had no route-based visibility, so scrolling down Monthly always revealed Annual/YTD content, and visiting Annual scrolled to the same shared page.

## 변경 후 구조 (After)

```
Reports view (#Reports)
├── monthRail
├── monthlyFreshnessHeader        ← hidden when route = annual-report
├── monthlyArchiveReport          ← hidden when route = annual-report
│    ├── header + summary sentence (ad line removed)
│    ├── TOC: 01 Summary / 02 Commerce / 03 Content / 04 Monthly Intelligence
│    ├── ch1 Summary   ← salesSummaryBlock(+전월대비 delta) + brandSignalsBlock + 콘텐츠 핵심 성과 + Intelligence teaser
│    ├── ch2 Commerce  ← was ch1/01, content unchanged (결제수단/브랜드TOP5/상품TOP5)
│    ├── ch3 Content   ← unchanged (조회/저장/좋아요/공유/팔로워/Format Mix/TOP콘텐츠)
│    └── ch4 Monthly Intelligence  ← missionSummaryBlock, now a numbered chapter with anchor
├── monthlyDestinationLayout      ← Goal Progress(광고 목표 제거)/Calendar, moved to AFTER the report
└── annualArchiveFlow             ← hidden when route ≠ annual-report; independently reachable via Annual menu
```

## Monthly에서 제거한 광고 요소

- Chapter "02 Marketing / 월간 광고 스냅샷" entire section: 광고비 hero, 광고비/실제 매출 비중, 오차율, 일치검증, 광고비-Meta 구매값 비교 바, 집행/미집행/누락 카운트, "광고 데이터 보기" 드릴 버튼
- Top summary sentence's "광고비는 ~" clause (`monthlySummary` array)
- "브랜드 신호" block-head's "데이터 일치검증 {일치/불일치/확인 불가}" span (was ad-reconciliation status leaking into a Commerce/Brand block)
- Goal Progress widget's "광고" goal card (월 예산 150만원 진행률)
- TOC entry "02 Marketing"

## Annual로 분리한 요소

Nothing was moved/duplicated — Annual's own render (`renderAnnualArchiveFlow` → `#annualArchiveFlow`) was already independent and untouched by this or any prior batch. What changed is purely **visibility**: `#annualArchiveFlow` is no longer permanently visible beneath Monthly; it is shown only when `routeHash === "annual-report"`. `renderReportsMonth` still calls both `renderMonthlyArchiveReport` and `renderAnnualArchiveFlow` unconditionally on every load (unchanged — zero risk to Annual's own data path), so Annual's data is always fresh whichever route triggered the render; the DOM toggle just controls which one the user actually sees.

## 보존한 데이터/API

- `/api/reports/monthly?month=` fetch (archive.commerce/marketing/content/sales) — unchanged call, still returns `archive.marketing` in full
- `archive.marketing` field itself — still present in every archive response; only the local JS variable alias in `renderMonthlyArchiveReport` (which fed the now-removed chapter) was dropped, since nothing in Monthly's template references it anymore. Server-side calculation (`server.mjs`) untouched — confirmed via `git diff --stat` (0 lines changed in `server.mjs`)
- `homeGoalCards({ metaTotals, ... })`'s `metaTotals` parameter and its call-site computation (`metaCanonical.reportingSpend/reportingPurchaseValue`) — left in place even though the goal card no longer renders it, so Content Intelligence can reuse the same call site later without re-deriving it
- `monthlyReportDelta`, `monthlyReportRatio`, `monthlyReportRankRows`, `intelligenceBriefCard` — all reused as-is, no new calculation helpers written
- Canonical sales calculation (`buildCanonicalTotalSales` and the whole `/api/reports/monthly` pipeline in `server.mjs`) — untouched

## 실제 브라우저 QA 결과 (127.0.0.1:8787)

Performed live against the running dev server (PID unchanged, no restart needed — static `outputs/*` served fresh via existing `Cache-Control: no-store`):

- **Monthly 상단**: `#monthly-report` loads directly into "01 SUMMARY / 이번 달 한눈에 보기" with Sales Summary hero (총매출 97,107,996원, 전월 대비 -176,436,437원 · -64.5% delta now shown), followed by 브랜드 신호 (header now reads "이번 달 vs 전월", no ad label), 콘텐츠 핵심 성과 strip, and an Intelligence teaser ("3건의 Mission · 최우선 '검색 데이터 수집 후보'") linking to `04 Monthly Intelligence`. No advertising figure anywhere on first screen. **PASS**
- **Commerce (02)**: unchanged content — 결제수단 구성, 브랜드 매출 TOP5, 상품 매출 TOP5, 온라인 실제 매출 hero with 전월 대비 delta, "Commerce ▸ Product" drill button all present and numerically identical to pre-batch. **PASS**
- **Content (03)**: unchanged content — 조회수/저장/좋아요/공유/팔로워 변화, Format Mix, 조회 상위/저장률 상위 콘텐츠, "Content ▸ Editorial AI" drill button. No paid/ad metrics present (never were). **PASS**
- **Monthly 마지막 영역**: `04 Monthly Intelligence / 다음 달 우선순위 Mission` renders as a proper numbered chapter directly after Content, then Monthly Operations (Calendar + Goal Progress, ad goal removed) follows, then the page ends — verified via `document.body.innerText` containing no "YTD"/"누적 흐름" text and `Reports` section's visible children ending at `monthlyDestinationLayout`. **PASS**
- **Annual/YTD no longer follows Monthly**: confirmed via DOM inspection — `#annualArchiveFlow.hasAttribute('hidden') === true` while on `#monthly-report`, and `document.body.innerText` contains neither "YTD" nor "누적 흐름" (hidden elements are excluded from `innerText` by spec, so this is a real rendering check, not just an attribute check). **PASS**
- **Annual independently reachable**: navigating to `#annual-report` flips the toggle — `monthlyArchiveReport`/`monthlyFreshnessHeader`/`monthlyDestinationLayout` all `hidden`, `annualArchiveFlow` visible, page shows "2026년 누적 흐름 · YTD 8월까지" with 누적 총매출/온라인/오프라인, 월별 총매출 흐름 차트, 연간 브랜드 매출 TOP5 — complete and independent, own Marketing/Content tabs untouched (Annual was never asked to drop ad UI). **PASS**
- **Advertising UI removed from Monthly**: grep-verified in the render function (no "월간 광고 스냅샷", no `data-jump-view="Advertising"`, no `marketing.spend/purchaseValue/adSpendShare` references) and visually confirmed in the screenshots above — chapter 2 goes straight from Sales Summary content into Commerce, no ad chapter in between. **PASS**
- **Sales figures unchanged before/after**: 2026-08 총매출 97,107,996원 (온라인 17,963,196원 · 오프라인 79,144,800원) — identical across Today, Monthly Summary, Monthly Commerce, and Commerce view screenshots taken in this QA pass. **PASS**
- **Today unchanged**: `#today` screenshot shows all four Today Summary cards (Commerce/Meta Ads Cache/총매출/Reports) exactly as before, same 총매출 figure, same store breakdown text; console shows no new application errors (only the pre-existing benign Chrome-extension messaging noise seen in every prior batch's QA). **PASS**

## 매출 regression 결과

**PASS** — 2026-08 총매출/온라인/오프라인 figures match exactly across Today, Commerce, and Monthly (both Summary and Commerce chapters) in this session's live QA: 97,107,996원 / 17,963,196원 / 79,144,800원. `buildCanonicalTotalSales` and the `/api/reports/monthly` server pipeline were not touched (`git diff --stat` shows 0 lines changed in `server.mjs`). Full automated regression: **563/563 PASS** (543 pre-existing + 20 new in `test/monthly-restructure.test.mjs`).

## Today regression 결과

**PASS** — no line in `renderOverviewLiveData`, `todayViewActive`, `renderTodayBriefing`, `renderTodaySummary`, or the `#Overview` section markup was touched. The only shared function this batch modified that Today's own render path also calls is `homeGoalCards()`, whose sole render target (`#nextActions`) exists exclusively inside `#monthlyDestinationLayout` (Monthly's Goal Progress widget, not Today's own section) — verified via `grep 'id="nextActions"'` returning exactly one match. Live QA confirms Today's screen content and figures are pixel/data-identical to pre-batch.

## Known issue

Monthly's in-page TOC anchors (`<a href="#monthly-report-ch1">` etc.) trigger the SPA's global `hashchange` listener, which calls `viewFromHash()` → since chapter hashes aren't registered in `hashViewMap`, it falls back to `"Overview"` and the view resets to Today instead of just scrolling to the chapter. **This is pre-existing behavior, not introduced by this batch** — the TOC anchors used the identical `href="#monthly-report-chN"` pattern before this restructure (only the numbers/labels changed), and `hashViewMap`/the `hashchange` listener were not touched. Not fixed here as it's outside this batch's scope; flagged for a future small fix (e.g. `event.preventDefault()` + manual `scrollIntoView` on TOC link clicks).

## 다음 단계 제안

**CONTENT-INTELLIGENCE-A** — build the standalone Content Intelligence screen that will own Organic Content → Paid Advertising → Advertising Performance → Commerce/Conversion, reusing the `archive.marketing` data/API and `metaTotals`/`reportingSpend`/`reportingPurchaseValue` computations that were deliberately preserved (not deleted) in this batch.

---

## COMMITS

`34dda70 refactor(monthly): remove ad UI, separate Annual, re-chapter into Summary/Commerce/Content/Intelligence` — staged only the exact 4 MONTHLY-RESTRUCTURE files, no `git add .`/`git add -A`. Pre-existing untracked BI-BATCH docs left untouched.

## FINAL HEAD

`34dda70` (parent: `93039d9`)

## PUSH: NONE
## DEPLOY: NONE
