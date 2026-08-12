# NEXT-CROSS-BRAND-FACT — Implementation Plan (READ-ONLY)

번호 없는 작업(공식 STEP 번호 미배정, `STEP67-progress-audit.md`의
NEXT CANDIDATE #1을 그대로 착수). 이 문서는 **설계/진단 전용**이다.
코드/HTML/CSS/JS/server/테스트/마스터 데이터 전부 미수정. git 쓰기
명령 전부 미실행. 이번 작업의 유일한 새 파일은 이 보고서다.

## Executive Summary

Cross-brand fact 확장(판매수량/주문수/AOV/Channel Dominance)에 필요한
데이터는 **전부 이미 클라이언트 state에 존재한다** — 새 API, 새
fetch, 새 서버 계산이 필요 없다. 필요한 계산 함수도 대부분 이미
존재한다: `entityCompareSummaryCrossBrandFact()`(4개 지표 전부에
재사용 가능한 범용 함수, 현재 revenue 1개로만 호출)와 Channel
Dominance 임계값 상수(`ENTITY_COMPARE_SUMMARY_CHANNEL_DOMINANT_SHARE
= 0.70`, 정의만 되고 미사용)가 이미 코드에 있다. **Day-cutoff
정규화는 이 범위에서 필요 없다** — 확장 대상 4개 지표 전부 기존
`CROSS_BRAND` axis(같은 기간 열, Brand A vs Brand B) 또는 순수 스냅샷
분류(Channel Dominance)이지, `PERIOD_CHANGE` axis(다른 두 기간 비교)가
아니기 때문이다. Partial-Period 정책(STEP67-10G-4)의 "live 기간은
완결 기간과 직접 비교하지 않는다"는 오직 `PERIOD_CHANGE`에만 적용되고,
`CROSS_BRAND`는 원래부터 예외였다(두 브랜드가 같은 만큼만 누적된
값을 보므로 공정) — 이번 확장은 이 예외 축 안에서만 이뤄지므로 정책
위반 가능성이 구조적으로 없다.

**GO 권장.** UI는 Option A(기존 Comparison Summary 문장 확장)를
추천한다 — 새 DOM/CSS 없이 기존 3-fact 우선순위 사다리에 낮은
우선순위(5~8) 후보로만 추가하면, 현재 정상 동작 중인 실측 케이스
(CARNET ARCHIVE vs TROUBLED WATERS)의 출력이 **1글자도 바뀌지 않으면서**
더 희소한 데이터 상황에서만 새 fact가 드러난다.

## A. DATA FLOW

각 지표를 서버 원본부터 렌더러까지 추적(전부 코드 직접 확인):

### Revenue(회귀 기준선, 변경 없음)
```
source:        Cafe24 주문 아이템 paidAmount(server.mjs:allocateCanonicalPaidSalesForOrder)
                + ECOUNT 오프라인 salesAmount(scripts/monthly-brand-sales.mjs:84-88)
normalization:  canonicalSalesObject() — gross/paid/discount 통일(server.mjs:3209)
aggregation:    aggregateCafe24BrandSalesByBrandCode()(온라인, server.mjs:3106)
                + mergeOfflineBrandSales()(오프라인 병합, scripts/monthly-brand-sales.mjs:60)
API response:   GET /api/reports/monthly?month= → archive.commerce.brandSales[].canonicalPaidAmount
frontend state: entityCompareKpiRowFromArchive() → {revenue}(outputs/samplas-marketing-os.js:13359)
renderer:       entityCompareSummaryCrossBrandFact(ENTITY_COMPARE_SUMMARY_METRICS[0], ...) → REVENUE_LEADER(이미 구현, 13827행)
```

### Units(판매수량)
```
source(온라인):  Cafe24 주문 아이템 quantity — server.mjs:3116 `Number(sales.quantity || 0)`
source(오프라인): ECOUNT 판매 라인 quantity — scripts/monthly-brand-sales.mjs:89 `Number(line.quantity)`
normalization:  없음(단순 합산, 반품/취소는 이미 상위 필터에서 제외 — cafe24OrderItems().filter(!isCafe24CanceledItem))
aggregation:    aggregateCafe24BrandSalesByBrandCode()의 `bucket.quantitySold += quantitySold`(server.mjs:3144)
                + mergeOfflineBrandSales()의 `brand.quantitySold = ... + line.quantity`(scripts/monthly-brand-sales.mjs:89)
API response:   archive.commerce.brandSales[].quantitySold(온라인+오프라인 합산 완료)
frontend state: entityCompareKpiRowFromArchive() → {quantitySold}(이미 배선됨, 13359행)
renderer:       없음(cross-brand 후보 목록에 미포함 — 이번 계획의 확장 대상)
```

### Orders(주문수)
```
source(온라인):  Cafe24 주문 ID의 distinct set — server.mjs:3118/3145 `bucket.orderIds.add(orderId)` → `.size`
source(오프라인): ECOUNT 전표(date|documentNo/slipNo) distinct set — scripts/monthly-brand-sales.mjs:90-94/113 `documents.add(...)` → `.size`
normalization:  **정의가 서로 다름을 확인**(§C 참고) — 온라인은 Cafe24 order_id 1개, 오프라인은
                (판매일자|전표번호) 조합 1개. 개념적으로는 둘 다 "distinct 거래 문서 수"로
                일치하지만, 물리적 식별자 체계는 다른 시스템에서 온다.
aggregation:    온라인/오프라인 각자 distinct set을 만든 뒤 그대로 합산(`brand.orderCount = ... + documents.size`)
API response:   archive.commerce.brandSales[].orderCount(온라인 distinct order 수 + 오프라인 distinct 전표 수)
frontend state: entityCompareKpiRowFromArchive() → {orderCount}(이미 배선됨)
renderer:       없음(확장 대상)
```

### AOV(객단가)
```
source:         새 계산 없음 — revenue/orderCount의 파생값
formula:        `orderCount ? Math.round(revenue / orderCount) : 0`
                (outputs/samplas-marketing-os.js:13369, entityCompareKpiRowFromArchive 내부)
                — STEP67-10G-3 정정대로 revenue/quantitySold가 아님, 재확인 완료.
frontend state: entityCompareKpiRowFromArchive() → {aov}(이미 배선됨)
renderer:       없음(확장 대상)
```

### Online Revenue / Offline Revenue / Channel Mix
```
source:         canonicalPaidAmount(online) — Cafe24 아이템 배분액 합
                offlineSalesAmount(offline) — ECOUNT 판매 라인 salesAmount 합
aggregation:    row.onlinePaidAmount / row.offlineSalesAmount(archive.commerce.brandSales[])
API response:   같은 brandSales row
frontend state: entityCompareKpiRowFromArchive() → {online, offline}(STEP67-10G-3에서 배선됨, 13359행)
renderer:       entityCompareSummaryChannelShare(row) → offline/(online+offline) 비율(13648행, 이미 구현)
                entityCompareSummaryChannelFact() → 브랜드 간 구조 차이만(CHANNEL_STRUCTURE_DIFF,
                13657행, 이미 구현) — 단일 브랜드 dominance 분류(ONLINE_DOMINANT/OFFLINE_DOMINANT/
                BALANCED)는 주석에 "판정" 언급만 있고 실제로 구현되지 않음(확장 대상)
```

**핵심 발견**: 4개 지표 전부 서버 데이터 자체는 완전하고, 클라이언트
state도 전부 이미 존재한다. 유일하게 없는 것은 이 데이터를 fact로
변환하는 **호출부**(Units/Orders/AOV cross-brand 함수 호출, Channel
Dominance 분류 함수 자체)이지 데이터 파이프라인이 아니다.

## B. EXISTING CROSS-BRAND INFRA

| 심볼 | 위치 | 역할 | 재사용 가능? |
|---|---|---|---|
| `ENTITY_COMPARE_SUMMARY_METRICS` | js:13544 | 4개 지표(revenue/quantitySold/orderCount/aov) 설정 배열, 각각 `topic`/`subject` 한국어 조사 형태까지 사전 계산됨 | **그대로 재사용**(이미 4개 전부 준비됨, 새 항목 추가 불필요) |
| `entityCompareSummaryCrossBrandFact(metric, aValue, bValue, brandAName, brandBName)` | js:13618 | 두 브랜드의 한 지표를 비교해 A_HIGHER/B_HIGHER/SIMILAR 판정, `${metric.key.toUpperCase()}_LEADER` 타입 fact 생성 | **그대로 재사용**(이미 metric 파라미터로 범용화됨, 지표 무관) |
| `ENTITY_COMPARE_SUMMARY_CROSS_BRAND_MATERIAL_PCT = 0.20` | js:13552 | cross-brand materiality 임계값(20%) | **그대로 재사용** |
| `ENTITY_COMPARE_SUMMARY_CHANNEL_DOMINANT_SHARE = 0.70` | js:13553 | 단일 브랜드 dominance 임계값(70%) | **정의만 존재, 실제 판정 로직 없음 — 이번에 처음 사용** |
| `entityCompareSummaryChannelShare(row)` | js:13648 | 오프라인 비중 계산 | **그대로 재사용** |
| `entityCompareSummaryChannelFact(aRow, bRow, ...)` | js:13657 | 브랜드 간 채널 구조 차이(CHANNEL_STRUCTURE_DIFF)만 생성 | **부분 재사용**(단일 브랜드 dominance는 새 함수 필요) |
| `buildComparisonSummaryFacts(input)` | js:13756 | 순수 오케스트레이터, candidates 배열 + 우선순위 절단 | **확장 대상**(새 candidate push만 추가, 구조 변경 없음) |
| `entityCompareTargetPeriodData.{aCurrent,bCurrent}` | js:13407 | 두 브랜드의 현재 기간 KPI row(revenue/quantitySold/orderCount/aov/online/offline 전부 포함) | **그대로 재사용**(새 필드 불필요) |
| `renderEntityCompareSummary()` | js:13859 | DOM 렌더 wrapper, `sentences.join(" ")`로 facts+caveats를 이어붙임 | **그대로 재사용**(새 fact가 늘어나도 렌더 로직 변경 없음) |
| `currentArchiveStatus`("live" 판정) | `entityCompareTargetPeriodData.currentArchiveStatus` | Partial-Period 가드 | **그대로 재사용**(CROSS_BRAND는 이 값과 무관하게 항상 허용되는 기존 설계 그대로 유지) |
| `entityIsLiveMonthRow(row)`(STEP67-10G-4) | js:13243 | `entityTrendMonths` row 전용 헬퍼, **Comparison Summary 엔진과는 무관한 다른 state 형태** | 사용 안 함(이미 STEP67-10G-4 보고서 §8에서 "두 컨테이너를 강제 통합하지 않는다"고 결정된 사항, 이번 확장도 그 결정을 따름) |

**신규 필요**: 없음(데이터/파라미터 레벨). 신규 필요한 것은 오직
`buildComparisonSummaryFacts()` 안에 candidate push 3~4줄, 그리고
Channel Dominance 전용 분류 함수 1개(기존 `entityCompareSummaryChannelFact`
옆에 추가, 기존 함수는 무변경).

## C. METRIC DEFINITIONS

**Units(판매수량)**: 1 unit = 상품 라인의 `quantity` 필드 1개 단위
(온라인 Cafe24 주문 아이템 quantity, 오프라인 ECOUNT 판매 라인
quantity) — 번들/세트 상품이 여러 개별 SKU로 분해되는지는 원본 데이터
정의를 그대로 따르며 이번 조사에서 별도 변형을 발견하지 못했다. 취소된
아이템은 이미 상위 `cafe24OrderItems().filter(item => !isCafe24CanceledItem(item))`
에서 제외됨(server.mjs 확인). **정의 명확 — BLOCKER 아님.**

**Orders(주문수)**: canonical 기준은 **온라인/오프라인이 서로 다른
식별자 체계**를 쓴다(§A에서 확인). 온라인 = Cafe24 `order_id`(주문
단위) distinct count. 오프라인 = ECOUNT `(판매일자|전표번호/slipNo)`
조합 distinct count. 개념적으로는 둘 다 "distinct 거래 문서 1건"으로
일치하지만, 물리적으로는 서로 다른 시스템의 서로 다른 필드다. 이
사실은 **이미 기존 Revenue/AOV cross-brand fact에도 동일하게 적용되고
있던 조건**(orderCount는 AOV 분모로 이미 쓰이고 있음, STEP67-10G-3부터)
이므로 새로운 리스크가 아니라 기존에 이미 수용된 정의다. **정의
명확(온라인/오프라인 다름을 기록함) — BLOCKER 아님.**

**AOV(객단가)**: `revenue / orderCount`(orderCount>0일 때만, 아니면
0) — STEP67-10G-3의 정정 그대로, `revenue / quantitySold`가 **아님을
재확인**. 새 산식 없음, 기존 `entityCompareKpiRowFromArchive()`가
이미 계산해 둔 값을 그대로 읽기만 한다. **정의 명확 — BLOCKER 아님.**

**Channel Dominance**: STEP67-10G-2 §10(원 아키텍처 문서)이 이미 정의:
"offline share >= 70% → OFFLINE_DOMINANT, online share >= 70% →
ONLINE_DOMINANT, 그 외 → BALANCED_CHANNEL" — 단일 브랜드의 자기
채널 비중만으로 판정하는 스냅샷 분류이며, 두 브랜드를 비교하는 것이
아니다(비교는 이미 존재하는 `CHANNEL_STRUCTURE_DIFF`가 담당). 임계값
상수(`ENTITY_COMPARE_SUMMARY_CHANNEL_DOMINANT_SHARE = 0.70`)도 이미
코드에 존재. **정의 명확(원 설계 문서에 이미 기록됨) — BLOCKER 아님.**

**4개 지표 전부 정의가 명확하다 — 이번 조사에서 새 BLOCKER를 발견하지
못했다.**

## D. PARTIAL PERIOD

| 시나리오 | Revenue(기존) | Units(신규) | Orders(신규) | AOV(신규) | Channel Dominance(신규) |
|---|---|---|---|---|---|
| 현재 월(live) vs 과거 완료 월 | PERIOD_CHANGE 생성 안 함(caveat만) | 해당 없음(cross-brand만 확장, PERIOD_CHANGE 미확장) | 해당 없음 | 해당 없음 | 해당 없음(스냅샷이라 두 기간 비교 자체가 없음) |
| 현재 월(live) vs 현재 월(live, cross-brand) | REVENUE_LEADER 허용(같은 만큼 누적) | **동일 원칙으로 허용**(같은 elapsed time, 공정) | **동일 원칙으로 허용** | **동일 원칙으로 허용** | 허용(현재 기간 스냅샷 그 자체) |
| 완료 월 vs 완료 월(cross-brand) | 허용 | 허용 | 허용 | 허용 | 허용 |
| 연간/전체 모드 | Comparison Summary는 월 단위 `entityCompareTargetPeriodData`만 입력받음 — 연간 모드 자체가 이 엔진의 입력 경로에 없음(코드 확인: `refreshEntityCompareTargetPeriodData()`가 `entityPeriodState.mode !== "monthly"`이면 `currentKey = null`) | 좌동 | 좌동 | 좌동 | 좌동 |

**결론**: 4개 신규 지표 전부 `CROSS_BRAND` axis에만 추가되며,
`PERIOD_CHANGE` axis(과거 vs 현재 단일 브랜드 비교, day-cutoff가
실제로 문제되는 지점)는 전혀 건드리지 않는다. 따라서 **"동일 day
cutoff로 비교"라는 요구사항은 이번 확장 범위에서 자동으로 충족된다**
— cross-brand 비교는 항상 "같은 기간 열"(aCurrent vs bCurrent, 또는
aTarget vs bTarget) 안에서만 이뤄지므로 두 브랜드가 항상 정확히 같은
elapsed time을 공유한다(둘 다 live면 둘 다 월 초부터 오늘까지, 둘 다
완료 월이면 둘 다 전체 월).

**별도 기록(이번 범위 밖 BLOCKER)**: 만약 향후 "진행 중인 현재 월을
과거 완료 월과 같은 day-cutoff로 정규화해 비교"(예: 8월 1~11일 vs
7월 1~11일)하는 기능을 만들려면, 현재 archive 파이프라인은 이를
지원하지 못한다 — `mergeOfflineBrandSales()`/`aggregateCafe24BrandSalesByBrandCode()`
둘 다 월 전체를 하나의 브랜드 행으로 집계하며, 브랜드 행 레벨에는
일자별 세부 내역이 보존되지 않는다(원본 오프라인 라인에는 `date`
필드가 있지만 집계 시 버려짐, §A 확인). **이 기능은 이번
cross-brand-fact 확장의 범위가 아니며, 착수하지 않는다** — 별도
BLOCKER로만 기록한다.

## E. UI

현재 Comparison Summary는 `<p id="entityCompareSummaryText">` 단일
문단(HTML 1894~1897행)이며, `renderEntityCompareSummary()`가
`[...facts, ...caveats].map(f => f.text).join(" ")`로 텍스트만
채운다 — 새 DOM 구조가 전혀 없다.

### Option A — 기존 Comparison Summary 문장을 richer fact sentence로 확장

`buildComparisonSummaryFacts()`의 candidates 배열에 Units/Orders/AOV
cross-brand + Channel Dominance를 **낮은 우선순위(5~8)**로 추가한다
(기존 1~4번 우선순위는 완전히 무변경). `entityCompareSummaryCrossBrandFact()`를
`ENTITY_COMPARE_SUMMARY_METRICS[1]`(quantitySold)/`[2]`(orderCount)/
`[3]`(aov)로 각각 1번씩 더 호출하기만 하면 되고, Channel Dominance는
새 함수 1개(`entityCompareSummaryChannelDominantFact`, 기존
`entityCompareSummaryChannelFact`와 나란히)만 추가한다.

**장점**:
- 새 DOM/CSS 0줄. HTML 파일 변경 없음.
- 이미 12/12 테스트가 통과 중인 Wording Contract/Materiality/Null≠Zero/
  Partial-Period 가드를 100% 상속(같은 함수, 같은 데이터 형태).
- 우선순위 5~8로 넣으면 STEP67-10G-3 §21의 실측 CARNET ARCHIVE vs
  TROUBLED WATERS 케이스(이미 1~4번 슬롯이 REVENUE_LEADER+RECENT_TREND
  등으로 채워짐)는 **한 글자도 바뀌지 않는다** — 회귀 위험 최소화.
- Channel Dominance는 정확히 STEP67-10G-3 §21이 이미 발견한 빈 슬롯
  (CARNET ARCHIVE 89.2%/TROUBLED WATERS 100% 오프라인 — 구조 차이는
  10.8%p로 미달이지만 둘 다 개별적으로는 70% 이상 OFFLINE_DOMINANT)을
  채우는 자연스러운 후속 작업이다.

**단점**:
- 여전히 "최대 3문장" 예산 안에서 경쟁하므로, 데이터가 풍부한 브랜드
  쌍에서는 새 지표가 실제로 노출되지 않을 수 있다(우선순위가 낮으므로
  의도된 동작이지만, "기능은 있는데 안 보인다"는 인상을 줄 수 있음).

### Option B — 기존 비교 영역 안에 compact fact rows/chips 추가

Period Performance 표 또는 Comparison Summary 카드 옆에 새로운 작은
행/칩 UI(예: "Units: A 높음" 배지)를 추가.

**장점**: 3문장 예산과 무관하게 4개 지표가 항상 노출 가능.

**단점**:
- 새 HTML 마크업 + 새 CSS 클래스 + 새 JS 렌더 함수 + 새 테스트 표면
  필요 — "새 대형 UI 섹션을 만들지 않는다"는 지시와 정면으로는
  아니지만 방향이 다르다(신규 시각 컴포넌트 자체가 발생).
- Units/Orders/AOV는 이미 Period Performance 표에 브랜드별 raw
  값이 나란히 있어 사용자가 육안으로 이미 비교 가능 — 칩을 추가하면
  같은 정보를 두 번 표시하는 중복이 생긴다(Hero KPI MoM과 AI Summary가
  같은 화면에서 모순됐던 STEP67-10G-4의 교훈과 유사한 "같은 정보의
  다른 표현이 화면에 중복"되는 패턴을 새로 만들 위험).
- STEP67-10G-3/10G-4가 이미 Chrome QA를 통과시킨 Comparison Summary
  카드 바로 옆에 새 형태의 UI를 추가하면, 그 영역의 시각적 회귀
  리스크가 Option A보다 명백히 크다.

### 추천: **Option A**

이유: 새 UI 표면 0, 기존 12개 테스트 인프라 100% 상속, 회귀 위험이
구조적으로 가장 낮음(우선순위 숫자만 낮게 배정하면 실측 회귀 케이스
불변 보장), Channel Dominance가 채울 빈 슬롯이 이미 이전 STEP의
실측으로 구체적으로 확인돼 있음. Option B는 "새 대형 섹션을 만들지
않는다"는 지시의 정신(최소 변경)과 어긋난다.

## F. TEST PLAN

기존 `test/brand-comparison-summary.test.mjs`(12개 시나리오, 전부
현재 PASS)를 **회귀 없이 확장**하는 형태로 설계한다 — 기존 12개는
그대로 두고 새 시나리오만 추가.

**최소 필요 신규 시나리오**:
1. Revenue regression — 기존 12개 시나리오 전부 무변경 재실행, 특히
   시나리오 9(Fact Priority)의 정확한 facts[0]/[1] 타입이 바뀌지
   않는지(새 낮은 우선순위 후보가 추가돼도 상위 슬롯 순서 불변 확인).
2. Units cross-brand — `entityCompareSummaryCrossBrandFact(METRICS[1], ...)`가
   material할 때 `QUANTITYSOLD_LEADER` fact가 후보에 들어가는지, 우선순위가
   실제로 5인지(1~4번 슬롯이 채워진 상태에서는 노출되지 않는지도 함께 검증).
3. Orders cross-brand — 동일 패턴, `ORDERCOUNT_LEADER`.
4. AOV cross-brand — 동일 패턴, `AOV_LEADER`, revenue/quantitySold/orderCount와
   별개로 AOV만 material한 fixture(§C의 AOV=revenue/orderCount 정의 재검증 겸함).
5. Channel Dominance — 정확히 STEP67-10G-3 §21 실측 값(CARNET ARCHIVE
   89.2%/TROUBLED WATERS 100% 오프라인)으로 두 브랜드 모두
   OFFLINE_DOMINANT fact가 생성되는지, 구조 차이(CHANNEL_STRUCTURE_DIFF)가
   이미 있을 때는 Channel Dominance가 추가로 노출되지 않는지(중복 방지).
6. Partial-period cutoff — live 현재 기간에서도 신규 4개 지표의
   CROSS_BRAND fact가 여전히 생성되는지(PERIOD_CHANGE 가드와 무관함을
   재확인, 기존 시나리오 1/2와 동일 원칙).
7. Compare mode ON/OFF — 이 항목은 `buildComparisonSummaryFacts()` 자체가
   순수 함수라 mode 토글과 무관하다 — `renderEntityCompareSummary()`
   호출 여부만 mode에 의존(기존 구조), 새 테스트 불필요(회귀
   문서화만).
8. comparison brand change / period change — 순수 함수 특성상 입력이
   바뀌면 출력만 바뀌는 것이 이미 기존 테스트로 검증됨(같은 함수를
   다른 fixture로 재호출) — 신규 지표도 같은 방식으로 커버되므로
   별도 시나리오 불필요, 기존 패턴 재사용.
9. Wording safety(신규 4개 지표 포함) — 새로 생성되는 모든 fact.text가
   기존 PROHIBITED_WORDS 목록(인과/평가/추천 표현)을 포함하지 않는지
   재확인(기존 assertNoProhibitedWording 헬퍼 재사용).
10. Null≠Zero(신규 4개 지표) — quantitySold/orderCount/aov 중 하나가
    null/0인 브랜드 행에서 해당 지표의 cross-brand fact만 SKIPPED되고
    나머지 지표는 정상 생성되는지(§16 기존 계약 재확인).

**Chrome QA 시나리오**(구현 후, 이번 단계에서는 실행하지 않음):
- CARNET ARCHIVE vs TROUBLED WATERS, 2026-08 vs 2025-08: 기존 문장
  ("CARNET ARCHIVE의 매출이 TROUBLED WATERS보다 높습니다.") 불변 확인
  + Channel Dominance 문장이 새로 추가되는지 육안 확인(3번째 슬롯).
- 판매수량/주문수/AOV 중 하나만 material하고 나머지 상위 슬롯이 비는
  희소 데이터 브랜드 쌍(가능하면 실측)으로 새 지표가 실제로 노출되는지
  확인.
- 진행 중인 현재 월(live)에서도 신규 지표의 cross-brand 문장이
  유지되는지(PARTIAL_PERIOD caveat와 공존 확인).

## G. CHANGE SURFACE

| 파일 | 왜 수정하는지 | 예상 변경 범위 | 회귀 위험 |
|---|---|---|---|
| `outputs/samplas-marketing-os.js` | `buildComparisonSummaryFacts()`에 낮은 우선순위(5~8) candidate push 3~4개 추가, `entityCompareSummaryChannelDominantFact()` 신규 함수 1개 추가(기존 `entityCompareSummaryChannelFact` 옆) | 약 30~50줄 추가, 기존 함수/우선순위 1~4 완전 무변경 | **낮음** — 새 함수는 순수 추가이며 기존 호출부를 수정하지 않음. `ENTITY_COMPARE_SUMMARY_METRICS`/`entityCompareSummaryCrossBrandFact`/`entityCompareTargetPeriodData` 전부 기존 그대로 재사용 |
| `test/brand-comparison-summary.test.mjs` | §F의 신규 시나리오 추가 | 기존 12개 유지 + 신규 ~8~10개 추가 | **없음**(테스트 파일, 프로덕션 코드 아님) |
| `outputs/samplas-marketing-os.html` | 수정 없음(Option A는 새 DOM 불필요) | 0줄 | 없음 |
| `outputs/samplas-marketing-os.css` | 수정 없음 | 0줄 | 없음 |
| `server.mjs` | 수정 없음(모든 데이터 이미 API 응답에 존재) | 0줄 | 없음 |
| `intelligence-service.mjs` | 수정 없음 | 0줄 | 없음 |

**최소 파일 수정 계획**: 실질적으로 **`outputs/samplas-marketing-os.js`
1개 파일**(+ 그 파일을 검증하는 테스트 파일)만 수정하면 된다 — 이번
조사에서 확인한 가장 작은 실행 가능한 범위다.

## H. GO / NO-GO

```
GO / NO-GO:
GO

RECOMMENDED UI:
Option A

METRICS READY:
- Revenue: 이미 구현됨(회귀 없음, 변경 대상 아님)
- Units: READY(데이터/함수 전부 존재, candidate push만 필요)
- Orders: READY(데이터/함수 전부 존재, candidate push만 필요 — 온라인/오프라인 orderCount 정의 차이는 기록됨, BLOCKER 아님)
- AOV: READY(revenue/orderCount 파생값, 새 산식 없음, candidate push만 필요)
- Channel Dominance: READY(임계값 상수 이미 존재, 신규 판정 함수 1개만 필요)

BLOCKERS:
없음(이번 확장 범위 안에서). 별도 기록(범위 밖): "진행 중인 현재 월을
과거 완료 월과 같은 day-cutoff로 정규화해 비교"하려면 현재 archive
파이프라인에 일자별 브랜드 집계가 없어 새 데이터 경로가 필요함 —
이번 cross-brand-fact 확장에는 해당하지 않음.

FILES TO MODIFY:
- outputs/samplas-marketing-os.js (buildComparisonSummaryFacts 확장 + 신규 Channel Dominance 함수)
- test/brand-comparison-summary.test.mjs (신규 테스트 시나리오 추가)

TESTS TO ADD/UPDATE:
- 기존 12개 시나리오: 무변경 재검증(특히 시나리오 9 Fact Priority)
- 신규: Units/Orders/AOV cross-brand 생성 조건(각 1개 이상), Channel
  Dominance 생성 조건 + 기존 CHANNEL_STRUCTURE_DIFF와의 중복 방지,
  Partial-period 중에도 신규 지표 cross-brand 유지, Wording safety
  재확인, Null≠Zero 재확인(신규 지표 포함)
```

---

**중요**: 이번 단계에서는 위 계획을 코드로 옮기지 않았다. 코드/HTML/CSS/JS/server/테스트/마스터 데이터 전부 미수정. commit하지 않았다. push하지 않았다. 다음 지시를 기다린다.
