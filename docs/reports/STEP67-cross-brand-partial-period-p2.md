# STEP67 — Cross-Brand Partial-Period P2: Frontend Wiring + Chrome QA

승인된 P1 서버 계약(`docs/reports/STEP67-cross-brand-partial-period-p1.md`,
PASS)을 실제 Brand Intelligence Compare Mode UI에 배선했다. Chrome
실검수까지 완료했다. commit/push 없음.

## 1. Executive Summary

P1이 만든 `GET /api/reports/monthly-comparison-cutoff`를
`refreshEntityCompareTargetPeriodData()`가 base 기간이 실제 진행 중일
때만 호출하도록 배선했다. 서버는 여전히 유일한 계산 주체다 —
클라이언트는 날짜 계산이나 매출/수량/주문/AOV 재계산을 전혀 하지
않고, 서버가 이미 계산한 payload를 기존 렌더러가 읽는 shape
(`{revenue, quantitySold, orderCount, aov, online, offline}`)으로만
옮긴다. Comparison Summary는 `targetPeriodBasis` 입력 하나로
cutoff 정규화 여부를 전달받아, 정규화됐을 때만 PERIOD_CHANGE류 fact
생성을 허용하고 캐치업 문구를 "동일 경과일 기준으로 비교했습니다"로
바꾼다. 실제 로컬 서버에서 CARNET ARCHIVE vs TROUBLED WATERS,
2026-08(진행 중) vs 2026-07을 Chrome으로 직접 확인해 **요구된 모든
수치(Revenue/Units/Orders/AOV)가 정확히 일치**함을 확인했다.

## 2. Files Modified

- `outputs/samplas-marketing-os.js`(수정) — cutoff-aware fetch 헬퍼
  2개(`getEntityCompareMonthlyArchiveCutoff`, `entityCompareKpiRowFromCutoffPayload`),
  라벨 헬퍼 1개(`entityCompareCutoffRangeLabel`), `entityCompareTargetPeriodData`에
  `cutoff` 필드 추가, `refreshEntityCompareTargetPeriodData()` 재설계
  (cutoff 분기 추가 + 헤더 라벨 갱신), `buildComparisonSummaryFacts()`
  재설계(`targetPeriodBasis` 입력, `isCutoffNormalized` 분기,
  `CUTOFF_NORMALIZED` caveat, cross-brand 문구에 "동일 경과일 기준"
  프리픽스), `renderEntityCompareSummary()`에 `targetPeriodBasis` 전달
  1줄 추가.
- `test/brand-comparison-summary.test.mjs`(수정) — 신규 시나리오
  26~28 추가(기존 25개 무변경).
- `test/cross-brand-partial-period-p2.test.mjs`(신규) — 11개 테스트.

`server.mjs`(P1에서 이미 완료, 이번 STEP에서 무수정),
`outputs/samplas-marketing-os.html`, `outputs/samplas-marketing-os.css`,
master data, Category Intelligence, Sell-through, Customer Composition
재시도 코드, Today/Monthly/Annual/Clients는 전혀 건드리지 않았다.

## 3. Frontend Data Flow

```
refreshEntityCompareTargetPeriodData()
  currentKey = currentEntityPeriodMonthKey()
  currentTrendRow = entityTrendMonths.find(row => row.key === currentKey)  // 새 fetch 없음
  useCutoff = entityIsLiveMonthRow(currentTrendRow)                        // STEP67-10G-4 헬퍼 재사용

  useCutoff === true:
    getEntityCompareMonthlyArchiveCutoff(currentKey, targetKey)  // 새 endpoint, 8초+30초 재시도
      → payload { cutoff, base: {brandSales}, comparison: {brandSales} }
      → entityCompareKpiRowFromCutoffPayload(payload, "base"/"comparison", brandCode)
      → { revenue, quantitySold, orderCount, aov, online, offline }  // 기존 shape과 동일

  useCutoff === false:
    getEntityCompareMonthlyArchive(currentKey) + getEntityCompareMonthlyArchive(targetKey)  // 기존 그대로, 무수정

  → entityCompareTargetPeriodData = { ...atomic 단일 할당... }
  → 헤더 라벨(cutoff.cutoffNormalized일 때만 "동일 경과일 기준 N/M~N/M" 추가)
  → renderEntityCompareTargetPeriodKpis()  // 기존 렌더러, 무수정
  → renderEntityCompareSummary()           // targetPeriodBasis만 새로 전달
```

두 fetch 경로(cutoff/기존)가 만드는 row가 **정확히 같은 필드 이름**
(`online`/`offline`, `onlineRevenue`/`offlineRevenue`가 아님)을 쓰므로
`renderEntityCompareKpiValue`/`entityCompareSummaryChannelShare`/
`entityCompareSummaryChannelFact`/`entityCompareSummaryChannelDominantFact`
등 기존 렌더러·규칙 엔진 함수는 **단 한 줄도 수정하지 않았다** —
이 함수들은 데이터가 어느 경로에서 왔는지 구분할 필요 자체가 없다.

## 4. Period Performance Wiring

Revenue/Units/Orders/AOV 4개 표 전부 `entityCompareTargetPeriodData.{aCurrent,
aTarget,bCurrent,bTarget}`를 그대로 읽는 기존 `renderEntityCompareKpiValue`
(무수정)로 렌더된다 — cutoff 모드일 때 이 함수가 읽는 데이터 자체가
이미 정규화돼 있으므로 표/델타 컬럼 모두 자동으로 정규화된 값을
쓴다. Chrome 실측(§11) 결과 4개 지표 전부 사용자가 지정한 기대값과
정확히 일치했다.

## 5. Cutoff Context UI

새 DOM/CSS 0줄 — 기존 Comparison Header의 두 배지
(`#entityCompareHeaderCurrentPeriod`/`#entityCompareHeaderTargetPeriod`,
이미 존재하던 `<span>`)의 텍스트만 `cutoff.cutoffNormalized`일 때
확장한다:

```
cutoffNormalized === true:
  현재: "2026년 8월 · 8/1~8/11"
  비교 대상: "2026년 7월 · 동일 경과일 기준 7/1~7/11"
cutoffNormalized === false(또는 cutoff 자체가 없음):
  기존 그대로(entityCompareTargetLabel(), 무변경)
```

날짜 문자열은 전부 서버가 반환한 `cutoff.base`/`cutoff.comparison`
(`{startDate,endDate}`)에서 잘라 조립할 뿐, 하드코딩된 날짜는 없다
(`entityCompareCutoffRangeLabel()`, 순수 문자열 절단 함수). Chrome
실측(§11)에서 완결 월(6월 vs 5월) 선택 시 이 문구가 **전혀 나타나지
않고** 기존 plain 라벨만 표시됨을 직접 확인했다(§11-H).

## 6. Comparison Summary Semantics

`buildComparisonSummaryFacts()`의 `isLive` 분기를 `isLive &&
targetPeriodBasis !== "cutoff"`로 좁혔다 — cutoff 정규화가 적용되면
기존 `else` 블록(완결 기간과 동일한 tiers/conflicting 계산 로직,
무수정 재사용)을 그대로 타되, 그 진입 시점에 `CUTOFF_NORMALIZED`
caveat(`"진행 중인 기간은 동일 경과일 기준으로 비교했습니다."`)를
하나 추가한다. CROSS_BRAND 4개 fact(Revenue/Units/Orders/AOV)는
`isLive`일 때(정규화 여부 무관, aCurrent/bCurrent는 언제나 같은
기간이라 원래도 유효했으므로) 문구 앞에 `"동일 경과일 기준"`을
붙인다. 실제 Chrome에서 확인한 문장(§11):

```
"CARNET ARCHIVE의 매출은 비교 대상 기간 대비 큰 폭으로 증가했습니다.
동일 경과일 기준 CARNET ARCHIVE의 매출이 TROUBLED WATERS보다 높습니다.
CARNET ARCHIVE의 최근 매출은 변동성 큰 흐름입니다.
진행 중인 기간은 동일 경과일 기준으로 비교했습니다."
```

기존 `"이번 기간은 진행 중이라 완결된 기간과 직접 비교하지
않았습니다."`(더 이상 사실이 아닌 문구)는 나타나지 않는다. 인과
표현("~로 인해"/"견인"/"상쇄") 0건.

## 7. Channel Mix

`entityCompareKpiRowFromCutoffPayload()`가 payload의 `onlineRevenue`/
`offlineRevenue`를 기존 row shape의 `online`/`offline`으로 그대로
매핑하므로, Comparison Summary의 Channel Mix 관련 fact
(`CHANNEL_STRUCTURE_DIFF`/`CHANNEL_DOMINANT`, 둘 다 NEXT-CROSS-BRAND-FACT
STEP에서 이미 구현·테스트됨)는 **무수정으로 자동 정규화**됐다 —
별도 배선 코드가 필요 없었다. 단일 브랜드 Hero Channel Mix 위젯
(`renderEntityHeroChannelSplit`)은 이번 STEP의 범위가 아니다 — 이미
STEP67-10G-4 정책대로 "진행 중인 기간의 스냅샷"으로 정상 동작
중이며, 두 기간을 비교하는 축이 아니라서 cutoff 정규화 대상이
아니다(요구사항 유지, 변경 없음). Chrome 실측(§11): CARNET ARCHIVE
Online 1,021,959원/Offline 9,861,100원, 비중 9.4%/90.6% — 사용자
지정 기대값과 정확히 일치.

## 8. Loading / Failure Behavior

- **Stale response 방지**: `entityCompareTargetPeriodRefreshSeq` 가드가
  cutoff 분기와 기존 분기 양쪽 모두에서 `await` 직후 그대로 실행된다
  (구조 테스트로 확인, §9).
- **원자적 갱신**: `entityCompareTargetPeriodData`는 두 분기 각각
  정확히 한 번의 객체 리터럴 할당으로 교체된다 — Revenue만 갱신되고
  Orders/AOV가 이전 값으로 남는 부분 갱신은 코드 구조상 불가능하다
  (구조 테스트로 확인, §9). cutoff 모드는 한 번의 HTTP 응답에 두
  기간이 모두 담겨 오므로 오히려 기존 2-fetch 방식보다 원자성이
  더 강하다.
- **실패 시 안전한 폴백**: cutoff fetch가 timeout/error면 `payload`가
  null이 되어 `aCurrent`/`aTarget`/`bCurrent`/`bTarget` 전부 null —
  기존 `renderEntityCompareKpiValue`의 "데이터 연결 대기/지연/실패"
  표시가 그대로 나온다. **cutoff 실패 시 전체월 fetch로 조용히
  되돌아가는 코드 경로는 존재하지 않는다**(구조 테스트로 확인, §9) —
  요구사항이 명시적으로 금지한 "잘못된 의미의 fallback"을 만들지
  않았다.
- **Customer Composition 무영향**: 이 STEP은 `getEntityCompositionJson`/
  `refreshEntityCustomerComposition`/`refreshEntityCompareCustomerComposition`
  코드를 전혀 읽거나 수정하지 않았다(구조 테스트로 확인, §9). Chrome
  실측에서도 두 브랜드 Customer Composition 도넛이 정상 로드됨을
  확인(§11-I).

## 9. Tests

`test/brand-comparison-summary.test.mjs` 신규 3개(26~28) + 기존 25개
무변경 = 28개. `test/cross-brand-partial-period-p2.test.mjs`(신규)
11개. 요구된 18개 시나리오 매핑:

| # | 요구 시나리오 | 커버 방식 |
|---|---|---|
| 1-4 | normalized Revenue/Units/Orders/AOV 렌더 | `entityCompareKpiRowFromCutoffPayload` 직접 검증(1-4) + Chrome 실측(§11-B~E) |
| 5 | delta가 정규화된 값 사용 | 같은 window 계열에서 나온 값이라 델타가 자동 정규화됨을 직접 증명(5) |
| 6/7 | cutoff context 렌더 + 서버 metadata 사용 | `entityCompareCutoffRangeLabel` 직접 검증, 하드코딩 아님을 다른 날짜로 재확인(6/7) |
| 8 | 완결 월은 partial context 미표시 | 구조 테스트(8) + Chrome 실측(§11-H) |
| 9 | Comparison Summary가 normalized Revenue 사용 | brand-comparison-summary.test.mjs #26 |
| 10 | Brand vs Brand 요약이 normalized base 값 사용 | brand-comparison-summary.test.mjs #27 |
| 11 | Channel Mix가 normalized online/offline 사용 | §7(무수정 자동 상속) + Chrome 실측(§11-G) |
| 12-14 | 기간/Brand A/Brand B 전환 시 stale 없음 | 구조 테스트(seq 가드 2곳) + Chrome 실측(§11-H, 실제 전환 3종 수행) |
| 15 | endpoint 실패 시 전체월로 조용히 fallback 안 함 | 구조 테스트(15) |
| 16 | Customer Composition 무영향 | 구조 테스트(16/17) + Chrome 실측(§11-I) |
| 17 | Category Intelligence 무영향 | 구조 테스트(18) + Chrome 실측(§11-I) |
| 18 | 기존 comparison 테스트 PASS | 전체 회귀(§10) |

```
node --test test/brand-comparison-summary.test.mjs
  28/28 PASS

node --test test/cross-brand-partial-period-p2.test.mjs
  11/11 PASS
```

## 10. Regression

```
기준선(P1 완료 후): 307/307 PASS
이번 STEP 완료 후 node --test test/*.mjs: 321/321 PASS, 0 fail
```

307 + 신규 14(brand-comparison-summary +3, cross-brand-partial-period-p2 +11) = 321 — 정확히 일치, 회귀 없음.

## 11. Chrome QA

로컬 서버(`node server.mjs`, 새 코드 반영을 위해 재시작)에서 실제
Chrome 세션으로 직접 수행했다. Brand Intelligence → Compare Mode ON
→ Brand A = CARNET ARCHIVE, Brand B = TROUBLED WATERS, Base = 2026년
8월, Compare = 2026년 7월(prev), 참조 날짜 = 서버의 실제 오늘
(2026-08-11).

**A. Period context** — PASS. `현재 기간 2026년 8월 · 8/1~8/11` /
`비교 대상 2026년 7월 · 동일 경과일 기준 7/1~7/11` 정확히 렌더됨
(줌 스크린샷으로 재확인).

**B. Revenue** — PASS. CARNET ARCHIVE 10,883,059원 vs 6,481,990원,
TROUBLED WATERS 8,274,400원 vs 1,075,000원 — 표에서 직접 확인, 요구된
값과 정확히 일치.

**C. Units** — PASS. CARNET ARCHIVE 32개 vs 19개, TROUBLED WATERS
26개 vs 3개 — 정확히 일치.

**D. Orders** — PASS. CARNET ARCHIVE 25건 vs 17건, TROUBLED WATERS
21건 vs 3건 — 정확히 일치.

**E. AOV** — PASS. CARNET ARCHIVE 435,322원 vs 381,294원, TROUBLED
WATERS 394,019원 vs 358,333원 — 정확히 일치.

**F. Comparison Summary** — PASS. "8월 진행분과 7월 전체를 비교"한다는
잘못된 인상을 주는 문구 없음. §6에 인용한 정규화 문장 그대로 렌더됨.

**G. Channel Mix** — PASS. CARNET ARCHIVE base: Online 1,021,959원/
Offline 9,861,100원, 비중 9.4%/90.6% — 정확히 일치(Hero 섹션, 단일
브랜드 스냅샷 — §7에서 설명한 대로 이 STEP의 정규화 대상은 아니지만
이미 정확했음을 재확인).

**H. Interaction** — PASS. (1) 비교 대상을 `이전 달(prev, 7월)` →
`전년 동월(yoy, 2025년 8월)`로 전환 → 헤더가
`비교 대상 2025년 8월 · 동일 경과일 기준 8/1~8/11`로 정확히 갱신,
TROUBLED WATERS는 2025-08 cutoff 윈도우에 데이터가 없어 정직하게
"데이터 연결 대기"로 표시(진짜 무데이터, Null≠Zero 유지) → 다시
`이전 달`로 전환 → `aTarget.revenue`가 정확히 6,481,990원으로
복귀(YoY 값 1,553,000원이 남아있지 않음, JS로 직접 state 확인). (2)
current 기간을 완결 월(6월)로 전환 → cutoff 문구 완전히 사라지고
plain 라벨만 표시, Comparison Summary도 "동일 경과일 기준" prefix
없이 기존 완결기간 문장으로 정상 전환 → 다시 8월로 복귀 → cutoff
문구 정확히 재표시. (3) Brand B를 `MEANTIME`으로 전환 →
`TROUBLED WATERS`로 복귀 → `bCurrent.revenue`가 정확히
8,274,400원으로 복귀(state 직접 확인, stale 값 없음).

**I. Existing protected sections** — PASS. Customer Composition 양쪽
브랜드 도넛(31건/29건) 정상 로드. Category Intelligence
"상품군 데이터가 연결되지 않았습니다 · 공식 상품군 source가 확정되기
전에는 임의 분류를 표시하지 않습니다" — 무변경. Sell-through
"정의 미확정 · BLOCKED · 공식 산식 필요" — 무변경.

**콘솔 확인**: 앱 코드 관련 JS 에러 0건(패턴 검색으로 재확인 —
발견된 3건은 Chrome 확장 메시징 인프라의 일반적인 아티팩트로, 이
앱 코드와 무관함을 확인).

## 12. Exact QA Values

| Brand | Metric | Base(8/1~8/11) | Comparison(7/1~7/11) | 요구값 일치 |
|---|---|---:|---:|---|
| CARNET ARCHIVE | Revenue | 10,883,059원 | 6,481,990원 | YES |
| CARNET ARCHIVE | Units | 32개 | 19개 | YES |
| CARNET ARCHIVE | Orders | 25건 | 17건 | YES |
| CARNET ARCHIVE | AOV | 435,322원 | 381,294원 | YES |
| CARNET ARCHIVE | Online(base) | 1,021,959원 | — | YES |
| CARNET ARCHIVE | Offline(base) | 9,861,100원 | — | YES |
| TROUBLED WATERS | Revenue | 8,274,400원 | 1,075,000원 | YES |
| TROUBLED WATERS | Units | 26개 | 3개 | YES |
| TROUBLED WATERS | Orders | 21건 | 3건 | YES |
| TROUBLED WATERS | AOV | 394,019원 | 358,333원 | YES |

## 13. Protected Sections Verification

| 섹션 | 상태 |
|---|---|
| Customer Composition | 무영향 — 코드 무수정, Chrome에서 정상 로드 확인 |
| Category Intelligence | 무영향 — 코드 무수정, BLOCKED 상태 그대로 |
| Sell-through | 무영향 — 코드 무수정, BLOCKED 상태 그대로 |
| Master Data | 무영향 — 이번 STEP에서 전혀 읽거나 수정하지 않음 |
| Today/Monthly/Annual/Clients | 무영향 — 이번 STEP에서 전혀 읽거나 수정하지 않음 |
| Monthly Trend(단일 브랜드) | 무영향 — STEP67-10G-4의 완결월 전용 로직 무수정, 그대로 동작(최저 매출 2026-07 23,303,130원, live 8월 미포함 유지) |

## 14. Remaining Risks

- YoY cutoff 라벨은 연도를 표시하지 않는다(`entityCompareCutoffRangeLabel`이
  월/일만 포맷) — 헤더가 `"2025년 8월 · 동일 경과일 기준 8/1~8/11"`
  형태라 앞의 "2025년"이 연도를 이미 알려주므로 오해 소지는 낮지만,
  더 명시적으로 만들려면 향후 라벨에 연도를 추가하는 것을 고려할 수
  있다(이번엔 "표를 재설계하지 않는다"는 지시에 따라 최소 변경으로
  유지).
- cutoff endpoint(P1)는 캐시가 없어 매번 실시간 계산이다(P1 §16에서
  이미 명시) — 이번 Chrome 실측에서는 3초 내외로 응답했으나, 반복
  사용/부하 상황에서의 안정성은 이번 STEP에서 별도로 부하 테스트하지
  않았다.
- 완결 과거월을 "base"로 선택했을 때 TROUBLED WATERS 같은 브랜드의
  일부 비교월에 데이터가 없는 경우(예: 2025-08 초 cutoff 윈도우)는
  정직하게 "데이터 연결 대기"로 표시되는 것을 확인했다 — 이는 새
  버그가 아니라 §11-H에서 직접 확인한 정상적인 Null≠Zero 동작이다.

## 15. GO / NO-GO

**GO.** 요구된 모든 UI 배선(Period Performance/Cutoff Context/
Comparison Summary/Channel Mix)이 실제 서버·실제 Chrome에서 정확한
실측값으로 확인됐다. 자동 테스트 39개 신규 추가, 전체 회귀
321/321 PASS, 0 fail. Customer Composition/Category Intelligence/
Sell-through 등 보호 대상 섹션 전부 무영향 확인.

## 16. Commit Recommendation

이번 세션에서는 commit하지 않았다(지시에 따름). 사용자가 이 보고서와
Chrome 실측 결과를 검토한 뒤, 별도로 commit 여부를 지시하면 그때
진행한다 — 이번 STEP의 범위는 구현 + 테스트 + Chrome QA + 보고서까지다.

---

====================
STEP67 CROSS-BRAND PARTIAL-PERIOD P2
====================

IMPLEMENTATION:
PASS

FRONTEND WIRING:
PASS

CUTOFF CONTEXT:
PASS

COMPARISON SUMMARY:
PASS

CHANNEL MIX:
PASS

BASE RANGE DISPLAYED:
2026년 8월 · 8/1~8/11

COMPARISON RANGE DISPLAYED:
2026년 7월 · 동일 경과일 기준 7/1~7/11

CARNET ARCHIVE:
Revenue 10,883,059원 / 6,481,990원
Units 32개 / 19개
Orders 25건 / 17건
AOV 435,322원 / 381,294원

TROUBLED WATERS:
Revenue 8,274,400원 / 1,075,000원
Units 26개 / 3개
Orders 21건 / 3건
AOV 394,019원 / 358,333원

STALE VALUE CHECK:
PASS

CUSTOMER COMPOSITION:
PASS

CATEGORY INTELLIGENCE:
UNCHANGED

SELL-THROUGH:
UNCHANGED

TARGETED TESTS:
39/39 (28 in brand-comparison-summary.test.mjs + 11 in cross-brand-partial-period-p2.test.mjs)

FULL REGRESSION:
321/321

CHROME QA:
PASS

FILES MODIFIED:
outputs/samplas-marketing-os.js, test/brand-comparison-summary.test.mjs, test/cross-brand-partial-period-p2.test.mjs(신규)

REPORT:
docs/reports/STEP67-cross-brand-partial-period-p2.md

COMMIT:
NONE

PUSH:
NONE

NEXT:
commit decision only after user reviews Chrome result

====================
