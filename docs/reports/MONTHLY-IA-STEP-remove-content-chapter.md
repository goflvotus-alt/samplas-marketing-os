# MONTHLY INFORMATION ARCHITECTURE STEP — Remove Content Chapter

**Date**: 2026-08-14
**Scope**: Finalize Monthly's information architecture to exactly `01 Summary / 02 Commerce / 03 Monthly Intelligence`. Content is no longer an independent Monthly area — Content and Advertising detail both belong to the future Content Intelligence screen. Today and Annual are not touched.

---

## 변경 목적

The previous batch (MONTHLY-RESTRUCTURE) had already removed Advertising detail from Monthly and separated Monthly from Annual, landing on a 4-chapter structure (`01 Summary / 02 Commerce / 03 Content / 04 Monthly Intelligence`). This step finalizes the architecture per the updated principle:

```
Monthly = 월간 의사결정 화면 (summary + judgment layer)
Content + Advertising detail = Content Intelligence (not yet built)
Commerce detail = Commerce Intelligence / Monthly's own Commerce chapter
```

Content was still rendered as a full Monthly chapter (03) and as a mini "콘텐츠 핵심 성과" strip inside Summary (01). Both are removed so Monthly no longer duplicates content-detail responsibility that will belong to Content Intelligence.

## STARTING HEAD

`cfea02f` (MONTHLY-RESTRUCTURE + doc-fix). `git status --short` at batch start showed only pre-existing untracked BI-BATCH docs; `git diff --stat` empty.

## 변경 파일

- `outputs/samplas-marketing-os.js` — `renderMonthlyArchiveReport`'s Content chapter (`ch3`) and the Summary chapter's "콘텐츠 핵심 성과" block removed in full; TOC reduced to 3 entries; `missionSummaryBlock`/"Monthly Intelligence" renumbered from `ch4`/`04` to `ch3`/`03`; now-dead local variables (`content`, `previousContent`, `summaryPreviousContent`, `formatMix`, `topContent`, `aboveAverageSaveRatePosts`) removed; top summary sentence (`monthlySummary`) reduced to the online-sales direction sentence only (content/follower clauses dropped)
- `test/monthly-restructure.test.mjs` — 3 stale assertions updated to match the new 3-chapter structure (was asserting the now-removed `03 Content`/`04 Monthly Intelligence` numbering)
- `test/monthly-content-removal.test.mjs` — new, 16 tests

No changes to `outputs/samplas-marketing-os.html`, `server.mjs`, `intelligence-service.mjs`, or any file under `work/`.

## 제거한 Monthly 영역

From the Summary chapter (`01`):
- "콘텐츠 핵심 성과" block (조회수, 저장, 좋아요, 팔로워 변화 strip)

From the top summary sentence:
- "콘텐츠 조회는 ~" clause and the follower-delta clause (both used `archive.content`)

The entire Content chapter (`03`, now fully removed):
- 조회수 / 저장 hero, 콘텐츠 수 / 좋아요 / 공유 / 팔로워 변화 side rows
- Format Mix breakdown (릴스 / 카드뉴스 / 피드 비중)
- 조회 상위 콘텐츠 ranking, 평균 저장률 상회 ranking
- "Content ▸ Editorial AI" drill button / `data-jump-view="Editorial AI"`

TOC: `03 Content` entry removed; `04 Monthly Intelligence` renumbered to `03 Monthly Intelligence` (its section id changed from `monthly-report-ch4` to `monthly-report-ch3` to match).

Advertising: already fully removed from Monthly in the prior batch — re-verified this step (grep found zero `marketing.*`/`Advertising` UI references remaining in the function, only a historical comment).

## 보존한 데이터/API

- `/api/reports/monthly?month=` fetch is completely unchanged — `archive.content` and `archive.marketing` are still returned in full by the server and still arrive in the client's `archive` object; only the *local variable aliases* that fed Monthly's now-removed UI (`const content = archive.content || {}`, etc.) were removed from this one function, since nothing in Monthly's template references them anymore
- `server.mjs` — zero lines changed (`git diff --stat` confirms), so `buildCanonicalTotalSales`, Cafe24/ECOUNT logic, archive/snapshot logic, and brand canonical mapping are all untouched
- The standalone top-level **Content** page (`renderContentOperations`, nav item `Content`/`#content`) is a completely separate function/view and was not touched — it keeps showing the full content analytics UI today; this batch only removed Content's *embedded copy* inside Monthly
- `monthlyReportFollowerDirectionText` helper — left in place (unused by Monthly now) since it's a small, self-contained text formatter that Content Intelligence can reuse later for follower-delta phrasing
- Mission/Monthly Intelligence UI (`missionSummaryBlock`, `intelligenceBriefCard`, `missionRows` from `/api/intelligence/missions`) — reused as-is, just renumbered to chapter `03`; no new Monthly Intelligence feature was built this step, only the existing Mission block was confirmed to already occupy that role

## 최종 Monthly 정보 구조

```
Monthly Report
├── header + online-sales direction sentence (ad/content clauses removed)
├── store scope note (unchanged, STORE-INTEL-UI-B)
├── TOC: 01 Summary · 02 Commerce · 03 Monthly Intelligence
├── ch1 Summary
│    ├── Sales Summary (총매출/온라인/오프라인 + 전월대비 delta)
│    ├── 브랜드 신호 (상승/하락 TOP3)
│    └── 이번 달 주요 Intelligence teaser → links to #monthly-report-ch3
├── ch2 Commerce
│    ├── 온라인 실제 매출 hero + 주문수/객단가/제외주문
│    ├── 결제수단 구성
│    ├── 브랜드 매출 TOP5 / 상품 매출 TOP5
│    └── "Commerce ▸ Product" drill button
└── ch3 Monthly Intelligence
     └── 다음 달 우선순위 Mission (existing Mission UI, real empty state if none)
```
Reads top-to-bottom as Summary → Commerce → Monthly Intelligence with no chapter in between, no leftover divider, and no `display:none` husk — the Content `<section>` was deleted from the template string entirely (verified structurally; see test #7 in `monthly-content-removal.test.mjs`).

## 실제 브라우저 QA 결과 (127.0.0.1:8787)

1. **CONTENT chapter가 Monthly에서 완전히 사라졌는가**: PASS — TOC shows only `01 SUMMARY / 02 COMMERCE / 03 MONTHLY INTELLIGENCE`; scrolled the full page, no "월간 콘텐츠 스냅샷"/Format Mix/조회 상위 콘텐츠 anywhere.
2. **광고 상세 영역이 Monthly에 남아 있지 않은가**: PASS — already removed in the prior batch, re-confirmed no residual ad UI this step.
3. **CONTENT 제거 위치에 큰 빈 공간이 생기지 않았는가**: PASS — screenshot shows "브랜드 신호" → "이번 달 주요 Intelligence" teaser → divider → "02 COMMERCE" immediately, and "상품 매출 TOP 5" (end of Commerce) → divider → "03 MONTHLY INTELLIGENCE" immediately. No gap.
4. **chapter 순서가 자연스러운가 / SUMMARY → COMMERCE → MONTHLY INTELLIGENCE 흐름**: PASS — confirmed by scrolling and by DOM source-order assertion (test #6).
5. **Commerce 데이터가 기존과 동일한가**: PASS — see comparison table below.
6. **기존 Monthly selector/월 이동이 정상인가**: PASS — clicked the "◀" month selector to move from 2026-08 to 2026-07; archive correctly switched to "Saved Archive" status and re-rendered the same 3-chapter structure with July's figures (273,544,433원 total).
7. **콘솔 오류가 없는가**: PASS — only the known benign Chrome-extension messaging noise seen in every prior batch's QA (`onlyErrors: true` check).
8. **Today/Annual에 회귀가 없는가**: PASS — Today screenshot shows identical cards/figures (97,107,996원); Annual screenshot shows its own independent YTD flow (2,060,903,958원) with its own Marketing/Content tabs still fully intact and untouched.
9. Bonus: standalone top-level **Content** page (`#content`, unrelated to Monthly) screenshot-verified still fully functional — confirms only Monthly's embedded copy was removed, not the content analytics feature itself.

## Regression 결과

**PASS** — full automated suite: **579/579** (563 pre-existing + 16 new in `test/monthly-content-removal.test.mjs`, plus 3 assertions in `test/monthly-restructure.test.mjs` updated to match the new numbering rather than left stale). `server.mjs` diff is empty — Cafe24/ECOUNT/archive/snapshot/brand-canonical logic and the `/api/reports/monthly` contract are all byte-identical to before this batch.

## 변경 전후 Commerce 데이터 비교 (2026-08)

| 지표 | 변경 전 (MONTHLY-RESTRUCTURE 이후) | 변경 후 (이번 배치) |
| --- | --- | --- |
| 총매출 | 97,107,996원 | 97,107,996원 |
| 온라인 매출 | 17,963,196원 | 17,963,196원 |
| 오프라인 매출 | 79,144,800원 | 79,144,800원 |
| 온라인 주문수 | 50건 | 50건 |
| 객단가 | 359,264원 | 359,264원 |
| 브랜드 매출 TOP5 / 상품 매출 TOP5 | 동일 랭킹·금액 | 동일 랭킹·금액 |

All figures identical — confirmed live in Chrome by re-loading `#monthly-report` before and after the change and comparing the Sales Summary/Commerce chapter numbers.

## 남은 이슈

- (Carried over, not introduced by this batch, not fixed here — out of scope) Monthly's in-page TOC anchors (`<a href="#monthly-report-chN">`) still bounce to Today because the SPA's global `hashchange` handler doesn't recognize chapter-anchor hashes. Same pre-existing behavior as reported in the prior MONTHLY-RESTRUCTURE report.
- `.monthly-report-fmix*` CSS classes (Format Mix styling) are now unused by any JS in this file (only `renderMonthlyArchiveReport` used them, and that usage is gone). Left in place deliberately — zero visual/behavioral effect, and deleting shared-looking class names carries more risk than value for a UI-only cleanup step. Flagged here rather than silently left unmentioned.

## 다음 STEP 추천

**CONTENT-INTELLIGENCE-A** — build the standalone Content Intelligence screen (Organic Content → Paid Advertising → Advertising Performance → Commerce/Conversion), reusing `archive.content`/`archive.marketing` (still fully intact in the `/api/reports/monthly` response) and the preserved `monthlyReportFollowerDirectionText`/`metaTotals` computations that both this batch and the prior one deliberately kept alive for exactly this purpose.

---

## COMMITS

`358f4f7 refactor(monthly): remove Content chapter, finalize IA to Summary/Commerce/Monthly Intelligence` — staged only the exact 4 files for this batch, no `git add .`/`git add -A`. Pre-existing untracked BI-BATCH docs left untouched.

## FINAL HEAD

`358f4f7` (parent: `cfea02f`)

## PUSH: NONE
## DEPLOY: NONE
