# MONTHLY CLEANUP — Remove Mission Placeholder + Fix TOC Routing Bug

**Date**: 2026-08-14
**Scope**: Remove `03 Monthly Intelligence / 다음 달 우선순위 Mission` from Monthly (a placeholder reusing `/api/intelligence/missions` UI, not a real Monthly Intelligence feature — user decision: not needed now). Monthly finalizes to exactly `01 Summary / 02 Commerce`. Also fixes the pre-existing Monthly TOC bug where clicking a chapter anchor bounced the user to Today.

---

## STARTING HEAD

`45dd164` (MONTHLY-IA-STEP + doc-fix). `git status --short` at batch start showed only pre-existing untracked BI-BATCH docs; `git diff --stat` empty.

## FILES CHANGED

- `outputs/samplas-marketing-os.js`:
  - `renderMonthlyArchiveReport` — removed the `/api/intelligence/missions` fetch from its `Promise.all`, removed `missionRows`/`missionSummaryBlock`, removed the `03 Monthly Intelligence` chapter and its TOC entry, removed the Summary chapter's "이번 달 주요 Intelligence" teaser/link
  - `renderNav` — added a delegated click handler scoped to `.monthly-report-toc a[href^="#monthly-report-ch"]` that intercepts the native anchor jump, scrolls to the target section, and updates the URL via `history.pushState` (which never fires `hashchange`)
  - `currentRouteHash`/`viewFromHash` area — added `normalizedRouteHash(hash)`, which maps `monthly-report-chN` back to `monthly-report` so a hard reload/deep-link on a chapter anchor still resolves to the Monthly view instead of falling back to Overview; applied at all three router entry points (initial load, `popstate`, `hashchange`)
- `test/monthly-restructure.test.mjs` — 3 assertions updated (TOC/chapter count/end-of-template) to match the new 2-chapter reality instead of asserting the now-removed `03 Monthly Intelligence`
- `test/monthly-content-removal.test.mjs` — 5 assertions (tests 5–8, 10) updated for the same reason
- `test/monthly-cleanup-mission-removal.test.mjs` — new, 17 tests, dedicated to this batch

No changes to `outputs/samplas-marketing-os.html`, `server.mjs`, `intelligence-service.mjs`, or any file under `work/`.

## 제거한 UI

From Monthly's rendered template:
- TOC entry `03 Monthly Intelligence` / anchor `#monthly-report-ch3`
- The entire `<section id="monthly-report-ch3">` chapter: chapter head ("03 · Monthly Intelligence · 다음 달 우선순위 Mission"), the Mission card grid (`intelligenceBriefCard` per mission), and its empty-state text
- Summary chapter's "이번 달 주요 Intelligence" teaser block (mission count + top-1 title + link to chapter 03)
- The `/api/intelligence/missions` fetch call inside `renderMonthlyArchiveReport`'s `Promise.all` (Monthly no longer needs this data at all, so the network call itself was removed — not just its rendering)

Verified via `grep`: zero remaining references to "Monthly Intelligence", "다음 달 우선순위 Mission", `missionRows`, `missionSummaryBlock`, or `/api/intelligence/missions` anywhere inside `renderMonthlyArchiveReport`.

## 보존한 Mission/API

- `/api/intelligence/missions` endpoint — still registered and functional in `intelligence-service.mjs` (grep-verified, zero lines of that file touched)
- Mission calculation logic — untouched, lives entirely in the intelligence service, not in this client file
- `intelligenceBriefCard(item)` — the Mission card renderer function itself was **not** deleted; it's still called from another screen (line ~9891, the Intelligence destination view), only Monthly's one call site was removed
- Any other screen's consumption of missions (e.g. the Intelligence view) — untouched; this batch only removed Monthly's fetch and rendering, not the feature

## 최종 Monthly 구조

```
Monthly Report
├── header + online-sales direction sentence
├── store scope note (unchanged, STORE-INTEL-UI-B)
├── TOC: 01 Summary · 02 Commerce
├── ch1 Summary
│    ├── Sales Summary (총매출/온라인/오프라인 + 전월대비 delta)
│    └── 브랜드 신호 (상승/하락 TOP3)
└── ch2 Commerce
     ├── 온라인 실제 매출 hero + 주문수/객단가/제외주문
     ├── 결제수단 구성
     ├── 브랜드 매출 TOP5 / 상품 매출 TOP5
     └── "Commerce ▸ Product" drill button
[END — template literal closes immediately after Commerce's closing </section>]
```
Reads `MONTHLY → 01 SUMMARY → 02 COMMERCE → END` exactly as specified. The removal is a true template-string deletion (verified structurally: no `display:none`, no `hidden`-and-empty `<section>` husk — the chapter markup simply no longer exists in the generated HTML).

## TOC bug 원인

The Monthly TOC's chapter links (`<a href="#monthly-report-ch1">`, etc.) are in-page anchors, but this SPA treats every hash change as a route change. The global handlers:
```js
function viewFromHash() {
  return hashViewMap[currentRouteHash()] || "Overview";
}
window.addEventListener("hashchange", () => setActiveView(viewFromHash(), { routeHash: currentRouteHash(), ... }));
```
`hashViewMap` only knows about real routes (`monthly-report`, `annual-report`, `today`, etc.) — it has no entry for `monthly-report-ch1`/`monthly-report-ch2`. So clicking a TOC link: (1) the browser's native anchor-jump changes `location.hash`, (2) that fires `hashchange`, (3) `viewFromHash()` looks up the unmapped hash, finds nothing, and falls back to `"Overview"`, (4) `setActiveView("Overview", ...)` switches the visible panel to Today. This bug pre-dates this batch (reported in the prior MONTHLY-RESTRUCTURE report) — it exists for any anchor-style in-page link this SPA might ever add, and was carried into this Mission-removal batch's fix scope per the user's explicit request.

## TOC fix 방법

Two small, additive changes, scoped only to Monthly TOC — no redesign of the SPA's routing:

1. **Click interception** (`renderNav`'s existing shared `document.addEventListener("click", ...)` handler, one new branch): a click on `.monthly-report-toc a[href^="#monthly-report-ch"]` calls `event.preventDefault()` (so the native anchor jump, and therefore `hashchange`, never fires), then manually `scrollIntoView`s the target chapter `<section>`, then calls `window.history.pushState(null, "", href)` to reflect the chapter in the URL bar. `pushState` never fires `hashchange`/`popstate`, so the SPA router never re-runs and the visible view never changes.
   - Initially implemented with `behavior: "smooth"`; live QA showed the smooth-scroll animation did not complete in this Chrome automation session (scroll position stayed at 0 even after a full second, while `behavior: "auto"` scrolled instantly and reliably). Switched to `"auto"` — this also more faithfully matches the native anchor-jump's own (non-animated) behavior, so nothing was lost.
2. **Reload/deep-link safety** (`normalizedRouteHash(hash)`, new 3-line helper): maps any `monthly-report-chN` hash back to `monthly-report` before it's looked up in `hashViewMap`. Applied inside `viewFromHash()` itself and at the two remaining router entry points that read `currentRouteHash()` directly (`popstate` and `hashchange` listeners, plus the initial `setActiveView` call in `renderNav`). This means even a hard reload or manually-typed URL on `#monthly-report-ch2` still resolves to the Monthly view instead of Overview — verified live (see Chrome QA below).

Neither change touches `viewHashMap`, `hashViewMap`, the sidebar nav's own click delegation, or any other route's behavior.

## Chrome QA (127.0.0.1:8787)

1. **TOC shows only `01 SUMMARY / 02 COMMERCE`**: PASS — screenshot confirms, no third entry.
2. **`이번 달 주요 Intelligence` teaser gone from Summary**: PASS — Summary chapter now ends after 브랜드 신호, no teaser block.
3. **No `03 MONTHLY INTELLIGENCE` after Commerce**: PASS — scrolled past Commerce's 상품 매출 TOP5, next content is the pre-existing "Monthly Operations/월간 운영" widget (unrelated, from a prior batch), not a Mission chapter.
4. **`다음 달 우선순위 Mission` completely gone**: PASS — confirmed absent from the full page, and via `grep` on the source template.
5. **No unnecessary large empty space after Commerce**: PASS — screenshot shows Commerce's closing content flows directly into the next widget with normal spacing, no dead gap.
6. **`01 SUMMARY` click**: PASS — `hash` → `#monthly-report-ch1`, `activeView` stayed `"Reports"`, `activeNavRoute` stayed `"monthly-report"`, page scrolled to the Summary chapter (verified via `getBoundingClientRect`/`scrollY` JS checks).
7. **`02 COMMERCE` click**: PASS — same checks, `hash` → `#monthly-report-ch2`, stayed on Monthly, screenshot shows the Commerce chapter (결제수단 구성/브랜드 매출 TOP5) scrolled into view.
8. **TOC click does not bounce to Today**: PASS — `activeView` remained `"Reports"` (not `"Overview"`) after every TOC click tested; sidebar "Monthly" stayed highlighted, not "Today".
9. **Monthly 월 변경 정상**: PASS — clicked the "◀" month arrow, moved 2026-08 → 2026-07, archive correctly switched to "Saved Archive" / "ARCHIVE" status badge and re-rendered with July's figures (273,544,433원), still showing the correct 2-chapter TOC.
10. **Monthly Store Selector 정상**: PASS — set `#storeFilterSelect` to `APGUJEONG` via its native `change` event, the store-scope disclosure note rendered correctly ("매장 필터: 압구정 — ..."), reset to `ALL` cleanly.
11. **2026-08 Commerce 숫자 작업 전후 동일**: PASS — see comparison table below.
12. **Today regression**: PASS — screenshot identical to pre-batch (same 총매출 97,107,996원, all four Today Summary cards intact).
13. **Annual regression**: PASS — screenshot identical to pre-batch (same 2,060,903,958원 total, own Marketing/Content tabs still present and untouched).
14. **콘솔 신규 오류 없음**: PASS — `read_console_messages({ onlyErrors: true })` returned zero errors/exceptions across the entire QA session (Monthly, TOC clicks, month change, store selector, hard reload on a chapter hash, Today, Annual).

## Commerce data regression (2026-08)

| 지표 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 총매출 | 97,107,996원 | 97,107,996원 |
| 온라인 매출 | 17,963,196원 | 17,963,196원 |
| 오프라인 매출 | 79,144,800원 | 79,144,800원 |
| 온라인 주문수 | 50건 | 50건 |
| 객단가 | 359,264원 | 359,264원 |
| 브랜드 매출 TOP5 (1위) | CARNET ARCHIVE 2,231,959원 | CARNET ARCHIVE 2,231,959원 |

All figures identical — confirmed live by comparing Today/Commerce/Monthly screenshots before and after this batch's changes.

## Full regression

**596/596 PASS** — 579 pre-existing + 17 new (`test/monthly-cleanup-mission-removal.test.mjs`), plus 8 stale assertions across `test/monthly-restructure.test.mjs` and `test/monthly-content-removal.test.mjs` updated to match the current 2-chapter structure rather than left describing removed markup.

## Today/Annual regression

**PASS** for both — see Chrome QA items 12–13 above. No file under either view's exclusive render path (`renderOverviewLiveData`, `renderAnnualArchiveFlow`, their HTML sections) was touched; `git diff --stat` confirms zero changes outside `outputs/samplas-marketing-os.js` and the three test files.

## 남은 이슈

None new. The only carried-over note (not introduced by this batch, already fixed by this batch for the case it applies to): the TOC-anchor hashchange-bounce bug that was flagged as a known issue in the prior MONTHLY-RESTRUCTURE report is now resolved for Monthly's own TOC. If a future batch adds more in-page anchor links elsewhere in the SPA, the same `normalizedRouteHash`/click-interception pattern should be extended to them — it was deliberately kept generic (a hash-prefix regex + a scoped CSS selector) rather than Monthly-only-hardcoded, but is currently only wired for `.monthly-report-toc` links specifically.

## 다음 STEP 추천

None proposed — per instruction, this batch stops here without proposing or starting further work.

---

## COMMITS

(recorded after commit — see follow-up doc-fix)

## FINAL HEAD

(recorded after commit — see follow-up doc-fix)

## PUSH: NONE
## DEPLOY: NONE
