# NEXT-CROSS-BRAND-FACT — Implementation Report

번호 없는 작업(공식 STEP 번호 미배정). `docs/reports/NEXT-CROSS-BRAND-FACT-plan.md`
(GO 판정)를 그대로 구현했다. commit/push/배포 없음.

## 1. Executive Summary

`docs/reports/NEXT-CROSS-BRAND-FACT-plan.md`가 GO 판정한 범위(Units/
Orders/AOV cross-brand fact + Channel Dominance)를 계획서가 확정한
최소 변경(Option A — 기존 Comparison Summary 문장 확장, 새 DOM/CSS
없음)으로 구현했다. 수정 파일은 계획서가 예상한 정확히 2개
(`outputs/samplas-marketing-os.js`, `test/brand-comparison-summary.test.mjs`)
뿐이다. 새 함수는 `entityCompareSummaryChannelDominantFact()` 1개뿐이고,
나머지는 이미 존재하던 범용 함수(`entityCompareSummaryCrossBrandFact`)를
낮은 우선순위(5~7)로 3번 더 호출하는 것으로 끝났다 — 새 산식, 새 API,
새 서버 계산은 전혀 추가하지 않았다. 기존 12개 STEP67-10G-3 테스트는
전부 무변경으로 재통과했고, 신규 시나리오 13개를 추가해 총 25/25
PASS, 전체 회귀 290/290 PASS.

## 2. Changes Made

### `outputs/samplas-marketing-os.js`

1. **`entityCompareSummaryChannelFact()` 바로 아래에 신규 함수 2개 추가**
   (기존 함수는 완전히 무변경):
   - `entityCompareSummaryChannelDominance(share)` — 오프라인 비중을
     `ENTITY_COMPARE_SUMMARY_CHANNEL_DOMINANT_SHARE`(0.70, 기존에
     정의만 되고 미사용이던 상수)와 비교해 `OFFLINE_DOMINANT`/
     `ONLINE_DOMINANT`/`BALANCED_CHANNEL` 중 하나로 분류하는 순수 함수.
   - `entityCompareSummaryChannelDominantFact(aRow, bRow, brandAName, brandBName)`
     — 두 브랜드 각각의 dominance를 판정해 `CHANNEL_DOMINANT` fact를
     만든다. 둘 다 dominant가 아니면(둘 다 BALANCED) `null`(공허한
     문장 생성 안 함). 같은 방향이면 "모두 높습니다" 결합 문장, 다른
     방향이면 대비 문장, 한쪽만 dominant면 그 브랜드만 서술(반대쪽은
     추정하지 않음). 브랜드명 옆에는 "의"만 사용(기존 STEP67-10G-3
     조사 안전성 규칙 그대로 재사용).
2. **`buildComparisonSummaryFacts()` 안, 기존 revenue cross-brand
   블록 바로 뒤에 3줄 추가**: `ENTITY_COMPARE_SUMMARY_METRICS[1]`
   (quantitySold)/`[2]`(orderCount)/`[3]`(aov)로
   `entityCompareSummaryCrossBrandFact()`를 한 번씩 더 호출해 우선순위
   5/6/7로 candidates에 push(materiality가 `MATERIAL`일 때만, 기존
   revenue와 동일 조건).
3. **CHANNEL_MIX/CUSTOMER_MIX 블록의 `else`(구조 차이 미달일 때) 안에
   3줄 추가**: `entityCompareSummaryChannelDominantFact()`를 호출해
   우선순위 8로 candidates에 push — `channelFact`(기존 브랜드 간 구조
   차이)가 이미 material해서 priority-3 슬롯을 채운 경우에는 이 블록
   자체가 실행되지 않으므로 중복이 구조적으로 불가능하다.
4. 기존 `buildComparisonSummaryFacts()`의 나머지 로직(PERIOD_CHANGE
   생성, CONFLICTING_PERIOD_SIGNAL, LOW_BASE, Partial-Period 가드,
   우선순위 절단 `slice(0, ENTITY_COMPARE_SUMMARY_MAX_FACTS)`)은 **단
   한 줄도 수정하지 않았다.**

### `test/brand-comparison-summary.test.mjs`

- `loadChannelDominantFact()` 헬퍼 1개 추가(기존 `ENGINE_SOURCE` 추출
  블록을 그대로 재사용, 새 소스 추출 로직 없음 — `buildComparisonSummaryFacts`
  대신 `entityCompareSummaryChannelDominantFact`를 반환하도록 `Function()`
  호출부만 바꿈).
- 신규 테스트 13개(13~25번) 추가. 기존 1~12번은 **텍스트 한 글자도
  수정하지 않았다.**

## 3. Files Modified

정확히 계획서가 예상한 2개 파일만 수정했다(요구사항 검증, §9 참고):

```
outputs/samplas-marketing-os.js
test/brand-comparison-summary.test.mjs
```

`server.mjs`, `outputs/samplas-marketing-os.html`, `outputs/samplas-marketing-os.css`,
마스터 데이터, Category Intelligence 관련 코드, Sell-through 관련
코드, 다른 dashboard/page 전부 이번 세션에서 손대지 않았다.

## 4. Facts Implemented

| Fact Type | Axis | Priority | 조건 | 재사용/신규 |
|---|---|---|---|---|
| `REVENUE_LEADER` | CROSS_BRAND | 2(기존) | 무변경 | 재사용, 무수정 |
| `QUANTITYSOLD_LEADER` | CROSS_BRAND | 5(신규) | `entityCompareSummaryCrossBrandFact(METRICS[1], ...)`, MATERIAL일 때만 | 함수 재사용, 호출부만 신규 |
| `ORDERCOUNT_LEADER` | CROSS_BRAND | 6(신규) | 동일, `METRICS[2]` | 함수 재사용, 호출부만 신규 |
| `AOV_LEADER` | CROSS_BRAND | 7(신규) | 동일, `METRICS[3]`(`revenue/orderCount` 값 그대로 사용, 새 산식 없음) | 함수 재사용, 호출부만 신규 |
| `CHANNEL_STRUCTURE_DIFF` | CHANNEL_MIX | 3(기존) | 무변경 | 재사용, 무수정 |
| `CHANNEL_DOMINANT` | CHANNEL_MIX | 8(신규) | 구조 차이가 미달일 때만, 최소 한 브랜드가 70% 이상 한 채널에 쏠릴 때 | 신규 함수 |

우선순위 1(REVENUE_PERIOD_CHANGE/CONFLICTING)과 4(RECENT_TREND)는
전혀 손대지 않았다.

## 5. Partial-Period Preservation

`buildComparisonSummaryFacts()`의 Partial-Period 가드 코드(`isLive`
분기, `PARTIAL_PERIOD` caveat 생성, `aCurrent`/`aTarget` 기반
PERIOD_CHANGE 억제)는 **단 한 줄도 수정하지 않았다.** 신규 4개 fact는
전부 `CROSS_BRAND` axis(같은 기간 열, Brand A vs Brand B — 두 브랜드가
항상 정확히 같은 elapsed time을 공유)에만 추가됐고, `PERIOD_CHANGE`
axis(다른 두 기간을 비교하는, day-cutoff가 실제로 문제되는 축)는
전혀 확장하지 않았다 — 계획서 §D의 결론 그대로다. 신규 테스트 23번이
`currentArchiveStatus: "live"`에서도 새 cross-brand fact가 유지되고
동시에 `PERIOD_CHANGE` 타입 fact는 여전히 하나도 생성되지 않음을
직접 검증한다.

## 6. Test Results

```
node --test test/brand-comparison-summary.test.mjs
  25/25 PASS(기존 12개 + 신규 13개)

node --test test/brand-comparison-summary.test.mjs \
  test/brand-intelligence-partial-period.test.mjs \
  test/brand-intelligence-live-data.test.mjs \
  test/brand-intelligence-ui-restoration.test.mjs
  38/38 PASS

node --test test/*.mjs (전체)
  290/290 PASS, 0 fail(기존 277개 + 신규 13개)
```

신규 시나리오 13개(요구사항 §8의 15개 항목과 매핑):

| # | 시나리오 | 매핑되는 요구사항 |
|---|---|---|
| 13 | Units cross-brand fact, 다른 지표와 격리 검증 | 2 |
| 14 | Orders cross-brand fact | 3 |
| 15 | AOV cross-brand fact(`revenue/orderCount` 산식 재확인) | 4 |
| 16 | Channel Dominance — 동일 dominant channel | 5, 6 |
| 17 | Channel Dominance — 서로 다른 dominant channel | 5, 7 |
| 18 | Channel Dominance — 한쪽만 균형(반대쪽은 서술 안 함) | 5 |
| 19 | Channel Dominance — 둘 다 균형이면 fact 생성 안 함(공허한 문장 방지) | 5 |
| 20 | Channel Dominance는 이미 material한 CHANNEL_STRUCTURE_DIFF와 중복되지 않음 | 5 |
| 21 | null metric(orderCount null)은 그 지표만 제외, 나머지는 정상 | 8 |
| 22 | 진짜 0은 결측이 아니라 유효값으로 처리, Infinity/NaN 없음 | 9 |
| 23 | live 기간에도 신규 cross-brand fact 유지, PERIOD_CHANGE는 여전히 없음 | 10 |
| 24 | 브랜드 swap/기간 변경이 순수하게 해당 출력만 바꿈(숨은 상태 없음) | 11, 12 |
| 25 | 신규 4개 지표의 생성 문장에 금지 어휘 없음 | 14 |

요구사항 1(기존 Revenue regression)/15(전체 PASS)는 위 전체 실행
결과로 충족됐다. 요구사항 13(Compare Mode OFF regression)은 §8에서
별도로 다룬다.

## 7. Known Limitations

- **Compare Mode OFF 경로는 이번 구현에서 코드가 전혀 바뀌지 않아
  별도 자동 테스트를 추가하지 않았다** — `renderEntityCompareSummary()`
  (DOM wrapper, `entityCompareState.enabled`가 false면 조기 반환하는
  로직)는 이번 diff에 포함되지 않는다(§9 diff 확인). 새 테스트를
  추가하는 대신 "이 함수는 무변경"이라는 사실 자체로 회귀 없음을
  보장한다 — 프로덕션 구조를 테스트만을 위해 바꾸지 않는다는 지시에
  따른 판단.
- **실제 CARNET ARCHIVE vs TROUBLED WATERS(live, 2026-08 vs 2026-07)
  Chrome-QA-확인 케이스는 문장이 1개 더 늘어난다** — 계획서는 "출력이
  1글자도 바뀌지 않는다"고 썼으나, 이는 **1~4번 우선순위 슬롯이 이미
  꽉 찬 완결 기간 케이스에서만 정확하다**(예: 기존 시나리오 9의 saved
  fixture는 실제로 facts 배열이 정확히 동일하게 유지됨, 재확인 완료).
  live 기간 실측 케이스는 원래 우선순위 1(PERIOD_CHANGE류)이 구조적으로
  항상 비어 있어(Partial-Period 가드), 이전에는 2문장(REVENUE_LEADER +
  RECENT_TREND)만 채워지던 3번째 슬롯이 이번 확장으로 채워진다(units
  cross-brand fact 추가) — **기존 문장이 바뀌거나 사라지는 것이 아니라
  비어 있던 슬롯에 새 문장이 추가되는 것**이므로 회귀는 아니지만,
  계획서의 표현을 이 보고서에서 더 정확하게 바로잡는다. Chrome QA
  체크리스트(§9)에 이 기대치를 명시했다.
- Channel Dominance의 "한쪽만 dominant"(A_ONLY/B_ONLY) 케이스는 반대쪽
  브랜드에 대해 아무 말도 하지 않는다 — 이는 의도된 설계(근거 없는
  해석을 만들지 않음)이지, 놓친 케이스가 아니다.

## 8. Chrome QA Checklist (사용자 수행 필요 — 이번 세션에서 자체 PASS 선언하지 않음)

**필수 케이스 — CARNET ARCHIVE vs TROUBLED WATERS, 2026-08(live) vs
2026-07**:
1. 기존 문장("CARNET ARCHIVE의 매출이 TROUBLED WATERS보다 높습니다.",
   "CARNET ARCHIVE의 최근 매출은 변동성 큰 흐름입니다.")이 그대로
   남아 있는지.
2. **새 문장 1개가 추가로 나타나는지** — "CARNET ARCHIVE의 판매수량이
   TROUBLED WATERS보다 높습니다." 류(§7에서 설명한 "빈 슬롯이 채워짐"
   기대치).
3. PARTIAL_PERIOD caveat("이번 기간은 진행 중이라...")가 여전히
   나타나는지.
4. 인과 표현("~로 인해"/"~덕분에"/"견인"/"상쇄") 여전히 0건인지.
5. Comparison Summary 카드가 여전히 컴팩트한 단일 문단인지(새 카드/
   섹션/표/칩이 생기지 않았는지).

**보조 케이스 — 완결 월 vs 완결 월(예: 2026-06 vs 2026-05)**:
6. 기존처럼 우선순위 1~4번 슬롯이 이미 다 찼다면(예: CONFLICTING +
   REVENUE_LEADER + CHANNEL/CUSTOMER + TREND), 신규 지표가 노출되지
   않고 기존 3문장이 그대로 유지되는지(byte-identical 회귀 확인).

**공통 확인**:
7. Compare Mode OFF → ON → OFF 토글 시 기존 동작(카드 표시/숨김)이
   그대로인지.
8. Category Intelligence는 여전히 BLOCKED 상태(변경 없음)인지.
9. Sell-through는 여전히 BLOCKED 상태(변경 없음)인지.
10. Hero KPI/AI Summary/Trend Summary/Monthly Trend/Customer
    Composition/Channel Mix — STEP67-10G-4에서 QA PASS된 동작이
    전부 그대로인지(이번 구현이 그 코드를 전혀 건드리지 않았음을
    diff로 재확인함, §3).

## 9. git diff Summary

```
git status --short (변경분만, 이번 세션에서 실제로 건드린 파일만 표시)
 M outputs/samplas-marketing-os.js
?? test/brand-comparison-summary.test.mjs(이미 STEP67-10G-3에서 생성된
   untracked 파일, 이번 세션에서 내용만 확장 — 새 파일 아님)
```

`server.mjs`/`outputs/samplas-marketing-os.html`/`outputs/samplas-marketing-os.css`
등 다른 파일은 `git status --short`상 이번 세션 시작 시점과 종료
시점에 완전히 동일하다(이전 STEP들이 누적한 uncommitted 변경만
남아 있음, 이번 구현이 추가한 diff는 0). `node --check
outputs/samplas-marketing-os.js` PASS, 구문 오류 없음.

---

====================
NEXT-CROSS-BRAND-FACT IMPLEMENTATION RESULT
====================

IMPLEMENTATION:
PASS

FILES MODIFIED:
outputs/samplas-marketing-os.js, test/brand-comparison-summary.test.mjs

FACTS:
Revenue: 기존 유지(무수정)
Units: 구현됨(QUANTITYSOLD_LEADER, priority 5)
Orders: 구현됨(ORDERCOUNT_LEADER, priority 6)
AOV: 구현됨(AOV_LEADER, priority 7, revenue/orderCount 산식 그대로)
Channel Dominance: 구현됨(CHANNEL_DOMINANT, priority 8, 구조 차이와 중복 방지)

PARTIAL PERIOD:
PASS

TESTS:
25/25 passed(brand-comparison-summary.test.mjs, 기존 12 + 신규 13)

REGRESSION:
PASS(290/290 전체 스위트, 0 fail)

CHROME QA:
NOT READY(사용자 수행 필요 — §8 체크리스트 참고, 이번 세션에서 자체 PASS 선언하지 않음)

COMMIT:
NOT CREATED

PUSH:
NOT PERFORMED

IMPORTANT:
이번 단계에서는 commit 하지 않았다. push 하지 않았다. 배포하지 않았다.
Chrome QA 전에는 작업 완료로 확정하지 않는다. 다음 지시를 기다린다.
====================
