# STEP67 — Cross-Brand Partial-Period P1 Implementation

승인된 설계(`docs/reports/NEXT-CROSS-BRAND-PARTIAL-PERIOD-plan.md`, GO)의
P1 범위만 구현했다. **서버 계약(cutoff resolver + canonical aggregation
재사용 + 새 endpoint)만 구현했고, Brand Intelligence UI 배선/Comparison
Summary 문구 변경은 전혀 하지 않았다**(P2 범위, 의도적으로 보류).
commit/push 없음.

## 1. Executive Summary

승인된 계획 그대로 구현했다 — 새 판매 계산 시스템을 만들지 않고,
이미 존재하며 이미 임의 날짜 범위를 지원하는 `buildBrandSalesDiagnostics()`
(온라인)와 `buildMonthlyArchiveBrandSales()`/`mergeOfflineBrandSales()`
(오프라인)를 그대로 재사용했다. 새로 작성한 코드는 (1) 순수 날짜
계산만 하는 cutoff resolver 모듈(`scripts/cross-brand-period-cutoff.mjs`),
(2) 그 resolver와 기존 canonical 함수를 연결하는 얇은 서버 오케스트레이션
2개 함수, (3) 새 endpoint(`GET /api/reports/monthly-comparison-cutoff`)
뿐이다. 실 서버에 직접 요청해 CARNET ARCHIVE/TROUBLED WATERS 양쪽 모두
base(2026-08-01~08-11)/comparison(2026-07-01~07-11)이 실제 날짜 범위로
정확히 정규화됨을 확인했고, 특히 **TROUBLED WATERS가 기존
`/api/reports/monthly?month=2026-07`에서는 stale-cache 때문에 완전히
빠져 있었지만(직전 진단 §3) 새 endpoint에서는 실제 값(1,075,000원/
3개/3건)으로 정확히 나타나** 승인된 계획이 예측한 "새 경로가 stale
cache를 구조적으로 우회한다"는 가설을 실측으로 증명했다.

## 2. Files Modified

- `scripts/cross-brand-period-cutoff.mjs`(신규) — `resolveCrossBrandPeriodCutoff()`,
  `daysInMonth()` 순수 함수 export.
- `server.mjs`(수정) — import 1줄, `crossBrandPeriodBrandRow()`/
  `buildCrossBrandPeriodWindow()`/`buildCrossBrandComparisonPeriodPayload()`
  3개 함수 추가, `GET /api/reports/monthly-comparison-cutoff` 라우트
  1개 추가. 기존 `/api/reports/monthly`/`buildMonthlyArchive`/
  `enrichMonthlyArchiveBrandSales`/`readMonthlyArchive`/`writeMonthlyArchive`는
  **한 줄도 수정하지 않았다**(구조 테스트로 재확인, §12).
- `test/cross-brand-period-cutoff.test.mjs`(신규) — 11개 테스트.

`outputs/samplas-marketing-os.js`, `outputs/samplas-marketing-os.html`,
`outputs/samplas-marketing-os.css`, master data, Category Intelligence/
Sell-through 관련 코드, Customer Composition 재시도 코드는 전혀
수정하지 않았다.

## 3. Cutoff Resolver

`scripts/cross-brand-period-cutoff.mjs`의 `resolveCrossBrandPeriodCutoff({
baseMonth, comparisonMonth, referenceDate })` — 순수 함수, I/O 없음,
판매 계산 로직 전혀 없음(오직 날짜 산술만). `daysInMonth(monthKey)`는
`server.mjs`의 기존 `monthEndKey()`와 동일한 `Date.UTC(year, month, 0)`
패턴을 재사용해 월 길이/윤년을 정확히 계산한다(새 달력 로직 발명 없음).

```
isBaseLive = baseMonth === referenceDate의 월
아니면(완결된 월 선택): base/comparison 모두 전체월, cutoffNormalized=false, elapsedDay=null
맞으면(진행 중인 현재 월): elapsedDay = referenceDate의 "일"
  base.endDate = `${baseMonth}-${min(elapsedDay, daysInMonth(baseMonth))}`
  comparison.endDate = `${comparisonMonth}-${min(elapsedDay, daysInMonth(comparisonMonth))}`
  둘 다 isPartial=true, cutoffNormalized=true
```

`referenceDate`는 호출자가 명시적으로 넘긴다 — 서버 라우트는 이 값을
`todayKey()`(기존 Asia/Seoul 타임존 안전 헬퍼, server.mjs:6563,
무수정 재사용)로 채운다. 순수 함수 자체는 `referenceDate`를 파라미터로
받으므로 테스트에서 임의 날짜로 완전히 결정론적으로 검증 가능하다.

## 4. Canonical Aggregation Reuse

```
buildCrossBrandPeriodWindow({startDate, endDate})
  commerceSource = await buildBrandSalesDiagnostics(startDate, endDate)   // 기존 함수, 무수정
  brandSales = await buildMonthlyArchiveBrandSales(startDate, endDate, commerceSource)  // 기존 함수, 무수정
  return brandSales.map(crossBrandPeriodBrandRow)  // 투영만, 새 계산 없음
```

두 재사용 함수(`buildBrandSalesDiagnostics`, `buildMonthlyArchiveBrandSales`)
모두 **한 글자도 수정하지 않았다** — 이미 `since`/`until` 파라미터를
받는 기존 시그니처 그대로 호출만 했다. `buildMonthlyArchive()`(Meta
Ads/Instagram/재무 정합성까지 포함하는 무거운 함수)는 전혀 호출하지
않는다 — Brand Comparison에 불필요한 외부 API 호출(Meta/Instagram)이
cutoff 요청마다 따라붙지 않는다(승인된 계획 §5의 근거 그대로 구현).

## 5. Endpoint Contract

```
GET /api/reports/monthly-comparison-cutoff?base=YYYY-MM&compare=YYYY-MM

- base/compare 둘 다 YYYY-MM 형식 검증(기존 isValidMonthKey 재사용), 아니면 400
- GET 외 메서드 405
- 브랜드별 필터링을 서버에서 하지 않는다 — 기존 /api/reports/monthly와 동일하게
  전체 브랜드 행을 반환(승인된 계획 §9: "브랜드별 shortcut을 만들지 않는다")
- work/monthly/*.json 캐시를 전혀 읽거나 쓰지 않는다(§11에서 재확인)
- 실패 시 500 + { error: <message> }(safeErrorMessage 기존 헬퍼 재사용)
```

## 6. Payload Example

실제 서버에서 받은 응답(민감 정보 없음, 아래 §14 실측):

```json
{
  "cutoff": {
    "base": { "month": "2026-08", "startDate": "2026-08-01", "endDate": "2026-08-11", "isPartial": true },
    "comparison": { "month": "2026-07", "startDate": "2026-07-01", "endDate": "2026-07-11", "isPartial": true },
    "cutoffNormalized": true,
    "elapsedDay": 11
  },
  "base": { "brandSales": [ { "brand_code": "B00000KU", "brand_name": "카르넷 아카이브", "revenue": 10883059, "quantitySold": 32, "orderCount": 25, "aov": 435322, "onlineRevenue": 1021959, "offlineRevenue": 9861100 }, ... ] },
  "comparison": { "brandSales": [ { "brand_code": "B00000KU", "brand_name": "카르넷 아카이브", "revenue": 6481990, "quantitySold": 19, "orderCount": 17, "aov": 381294, "onlineRevenue": 161290, "offlineRevenue": 6320700 }, ... ] }
}
```

`cutoff` 필드가 base/comparison 각각의 정확한 날짜 범위와
`cutoffNormalized`/`elapsedDay`를 명시적으로 포함하므로, 이 payload만
보고도 "이게 부분 비교인지 전체월 비교인지" 프론트엔드가 절대
혼동할 수 없다(요구사항 "PAYLOAD MUST MAKE PERIOD SEMANTICS EXPLICIT"
충족). `orderHistory` 같은 원본 거래 데이터는 응답에 전혀 포함되지
않는다(`crossBrandPeriodBrandRow()`가 6개 필드만 명시적으로 투영).

## 7. Metric Semantics

| 지표 | 필드명 | 소스 |
|---|---|---|
| Revenue | `revenue` | `row.canonicalPaidAmount`(온라인+오프라인 합산, 기존 규칙 무변경) |
| Units | `quantitySold` | `row.quantitySold`(기존 규칙 무변경) |
| Orders | `orderCount` | `row.orderCount`(온라인 distinct orderId + 오프라인 distinct 전표, 기존 규칙 무변경) |
| AOV | `aov` | `orderCount ? round(revenue/orderCount) : 0`(§8에서 검증) |
| Online Revenue | `onlineRevenue` | `row.onlinePaidAmount`(기존 필드 무변경) |
| Offline Revenue | `offlineRevenue` | `row.offlineSalesAmount`(기존 필드 무변경) |

## 8. AOV Verification

`crossBrandPeriodBrandRow()`는 **하나의 row 객체**에서 `revenue`와
`orderCount`를 동시에 읽어 `aov`를 계산한다 — 그 row 자체가
`buildCrossBrandPeriodWindow()`의 **단일** `buildMonthlyArchiveBrandSales(startDate,
endDate, ...)` 호출 결과이므로, "cutoff revenue + 전체월 orderCount"
같은 조합이 만들어질 수 있는 코드 경로가 설계상 존재하지 않는다(믹싱
불가능 — 별도 방어 코드가 필요 없는 구조). 실측 재확인(§14): CARNET
ARCHIVE comparison window `revenue=6,481,990`, `orderCount=17` →
`aov = round(6481990/17) = 381,294` — 응답값과 정확히 일치. `orderCount=0`
케이스(테스트 14번)는 `aov=0`(null이 아님, NaN/Infinity 아님) — 기존
Null≠Zero 계약과 동일한 컨벤션(새 컨벤션 도입 없음).

## 9. Channel Mix Inputs

`onlineRevenue`/`offlineRevenue`를 canonical 금액 그대로 반환할 뿐,
비중(%) 계산은 이 endpoint가 하지 않는다(요구사항 "Channel Mix can
derive share from these canonical facts at the presentation layer
only" 그대로 준수) — 비중 계산은 이미 클라이언트에 존재하는
`entityCompareSummaryChannelShare()`(NEXT-CROSS-BRAND-FACT, 무수정)가
P2에서 이 필드들을 그대로 소비하면 된다. 별도의 중복 채널 계산 경로를
만들지 않았다.

## 10. Brand A/B Symmetry

`resolveCrossBrandPeriodCutoff()`는 브랜드 파라미터를 아예 받지
않는다 — `cutoff.base`/`cutoff.comparison`은 브랜드와 무관한 단일
날짜 범위이며, `buildCrossBrandPeriodWindow()`도 브랜드 필터링 없이
**모든 브랜드의 행을 한 번의 패스로 반환**한다. 실측(§14)에서 CARNET
ARCHIVE와 TROUBLED WATERS 둘 다 정확히 같은 `base`(8/1~8/11)/
`comparison`(7/1~7/11) 메타데이터 아래 계산됐음을 같은 응답 안에서
직접 확인했다 — 브랜드별 shortcut이 코드에 존재하지 않으므로 대칭이
구조적으로 보장된다(회귀 테스트 6/7번, §12).

## 11. Stale Archive Verification

**검증 완료 — 계획이 예측한 대로 구조적으로 우회함을 실측으로
증명했다.** `buildCrossBrandComparisonPeriodPayload()`/
`buildCrossBrandPeriodWindow()` 소스 전체에 `readMonthlyArchive`/
`writeMonthlyArchive`(work/monthly/*.json 캐시 읽기/쓰기 함수) 호출이
전혀 없음을 구조 테스트로 확인했다(§12 테스트 목록의 마지막 항목).
실측으로도 확인: 기존 `/api/reports/monthly?month=2026-07`는 stale
캐시 때문에 TROUBLED WATERS 행이 아예 없지만(직전 진단 §3), 새
endpoint의 `comparison.brandSales`에는 TROUBLED WATERS가
`revenue: 1,075,000`으로 정상적으로 나타난다(§14) — 이 값은 원본
ECOUNT 라인(7/1~7/11 구간 3건)을 직접 다시 읽어 계산한 것이므로 캐시
상태와 무관하다. **BLOCKED 상황은 발생하지 않았다** — archive 캐시
재구조화 없이 그대로 P1을 완료했다.

## 12. Tests

`test/cross-brand-period-cutoff.test.mjs`(신규, 11개, 전부 PASS) —
요구된 21개 시나리오를 다음과 같이 매핑해 커버했다:

| # | 요구 시나리오 | 커버 방식 |
|---|---|---|
| 1 | 8/11 vs 7/11 | 직접 단위 테스트("1.") |
| 2 | 8/11 vs YoY 8/11 | 직접 단위 테스트("2.") |
| 3 | 3/31 vs 2월 clamp | 직접 단위 테스트("3.") |
| 4 | 윤년 2월 clamp | 직접 단위 테스트("4.") |
| 5 | 완결 6월 vs 완결 5월 = 전체월 | 직접 단위 테스트("5.") + 실측 재확인(§14 부록) |
| 6/7 | Brand A/B 동일 base/comparison 윈도우 | 구조 테스트("6/7.", resolver가 브랜드 파라미터 자체를 안 받음을 증명) + 실측(§14) |
| 8-13 | Revenue/Units/Orders/AOV/onlineRevenue/offlineRevenue cutoff | 직접 단위 테스트("8-13.", crossBrandPeriodBrandRow 격리 검증) |
| 14 | zero-order AOV 정책 | 직접 단위 테스트("14.") |
| 15 | cutoff 윈도우 안에 행 없는 브랜드 | 구조 확인 테스트("15.", mergeOfflineBrandSales의 기존 보장 재확인) |
| 16 | stale 아카이브가 결과를 결정하지 않음 | 구조 테스트(readMonthlyArchive/writeMonthlyArchive 미참조 확인) + 실측(§11/§14) |
| 17 | 기존 완결기간 비교 회귀 | 전체 회귀 스위트(§13) |
| 18 | 기존 Brand Comparison 테스트 유지 | `test/brand-comparison-summary.test.mjs`(25개) 재실행 |
| 19 | Customer Composition 재시도 테스트 유지 | `test/entity-composition-retry.test.mjs`(6개) 재실행 |
| 20 | Category Intelligence 무영향 | 이번 STEP이 관련 코드를 전혀 읽거나 수정하지 않음(§2) |
| 21 | Sell-through 무영향 | 이번 STEP이 관련 코드를 전혀 읽거나 수정하지 않음(§2) |

추가로 잘못된 입력(월 형식 오류, 날짜 형식 오류) 거부 테스트, 그리고
서버 라우트/오케스트레이션 함수가 정확히 resolver와 기존 canonical
함수만 호출하는지 확인하는 구조 테스트를 포함했다.

```
node --test test/cross-brand-period-cutoff.test.mjs
  11/11 PASS

node --test test/cross-brand-period-cutoff.test.mjs test/monthly-brand-sales.test.mjs \
  test/brand-comparison-summary.test.mjs test/entity-composition-retry.test.mjs \
  test/brand-intelligence-partial-period.test.mjs test/brand-intelligence-live-data.test.mjs \
  test/brand-intelligence-ui-restoration.test.mjs test/work-data-upload-paths.test.mjs
  59/59 PASS
```

## 13. Regression

```
기준선(이번 STEP 시작 전): 296/296 PASS
node --test test/*.mjs (전체, 이번 STEP 완료 후): 307/307 PASS, 0 fail
```

296 + 신규 11 = 307 — 정확히 일치, 회귀 없음.

## 14. Direct Endpoint Verification

로컬 서버(`node server.mjs`, 이미 실행 중이던 것을 새 코드 반영을
위해 재시작 — 데이터 파일 변경 없음, 코드만 재로딩)에 직접 GET
요청했다.

**base=2026-08, compare=2026-07** (오늘 2026-08-11):

```
cutoff.base       = 2026-08-01 ~ 2026-08-11 (isPartial: true)
cutoff.comparison = 2026-07-01 ~ 2026-07-11 (isPartial: true)
cutoffNormalized  = true
elapsedDay        = 11
응답 시간          = 3.53초
```

**CARNET ARCHIVE(B00000KU)**:
```
base(8/1~8/11):        revenue=10,883,059  units=32  orders=25  aov=435,322  online=1,021,959  offline=9,861,100
comparison(7/1~7/11):   revenue=6,481,990   units=19  orders=17  aov=381,294  online=161,290    offline=6,320,700
```

**TROUBLED WATERS(B00000WW)**:
```
base(8/1~8/11):        revenue=8,274,400  units=26  orders=21  aov=394,019  online=0  offline=8,274,400
comparison(7/1~7/11):   revenue=1,075,000  units=3   orders=3   aov=358,333  online=0  offline=1,075,000
```

**교차 검증**: TROUBLED WATERS의 comparison 값(1,075,000원/3개/3건)은
직전 진단(`NEXT-CROSS-BRAND-PARTIAL-PERIOD-diagnosis.md`)이 원본
ECOUNT 라인을 직접 읽어 찾아낸 7/1(2건)+7/7(1건) 실제 매출과 정확히
일치한다(358,000+382,400+334,600=1,075,000) — **새 endpoint가 stale
캐시에 가려졌던 실제 데이터를 정확히 찾아낸다는 것을 실측으로
재확인**했다. CARNET ARCHIVE의 comparison revenue(6,481,990원)는
직전 진단 보고서에 손으로 적었던 "6,482,990원"과 1,000원 차이가
나는데, 재검산 결과 손 계산(161,290+6,320,700)의 올바른 합은
6,481,990원이다 — **직전 진단 문서의 단순 합산 오타를 이번 실측이
바로잡았다**(endpoint 자체의 계산은 정확함, 이번에 새로 발견된
버그 아님).

**완결 월 vs 완결 월(base=2026-06, compare=2026-05)**:
```
cutoffNormalized = false, elapsedDay = null
base       = 2026-06-01 ~ 2026-06-30(전체월)
comparison = 2026-05-01 ~ 2026-05-31(전체월)
```

**에러 케이스**: `base=bad` → `400 { error: "base and compare must be
YYYY-MM" }` 정상 반환.

Chrome 최종 시각 확인은 하지 않았다(PASS로 단정하지 않음) — 이
STEP은 UI 배선이 없으므로 Chrome에서 볼 수 있는 화면 변화 자체가
없다.

## 15. Remaining P2 Work

- `refreshEntityCompareTargetPeriodData()`(outputs/samplas-marketing-os.js)에서
  `entityIsLiveMonthRow()`(STEP67-10G-4, 이미 존재) 기반으로 새
  endpoint 호출 여부를 결정하는 배선.
- 클라이언트 재시도 헬퍼(`getEntityCompareMonthlyArchiveCutoff` 류,
  기존 `getEntityCompareMonthlyArchive`/`getEntityCompositionJson`과
  동일한 8초+30초 1회 재시도 패턴 재사용 — 승인된 계획 §14가 명시적으로
  경고한 지점).
- Period Performance 표의 `<small>` 라벨에 cutoff 문구 반영(승인된
  계획 §11, 새 DOM 불필요).
- `buildComparisonSummaryFacts()`의 `isLive` 분기 재설계 — `targetPeriodBasis`
  입력 추가, PARTIAL_PERIOD → CUTOFF_NORMALIZED 캐치업(승인된 계획
  §12, 가장 리스크가 큰 지점으로 이미 표시됨).
- `entityCompareTargetPeriodData`에 cutoff 메타데이터 필드 추가.
- 위 항목들에 대응하는 신규 클라이언트 테스트.

## 16. Risks

- 새 endpoint의 응답 시간(3.53초, 캐시 없음)은 이번 실측 1건
  기준이며, 반복 요청/부하 상황에서의 안정성은 확인하지 않았다 — P2
  구현 시 재시도 정책이 반드시 함께 들어가야 한다(§15).
- `readEcountOfflineSalesSnapshot(month, ...)`가 여전히 "월" 단위
  파일을 통째로 읽으므로(라인 단위 필터링은 메모리 내에서 발생),
  cutoff 요청도 오프라인 스냅샷 전체 파싱 비용은 동일하게 부담한다 —
  성능 특성은 기존 `/api/reports/monthly`의 draft/live 경로와 같은
  수준이며 새로운 리스크는 아니다.
- 새 endpoint는 인증/레이트리밋이 기존 `/api/reports/monthly`와
  동일한 수준(별도 인증 없음, 공개 GET)으로 남아 있다 — 기존 관례를
  그대로 따랐을 뿐 새로 검토하지 않았다.

## 17. GO / NO-GO

**GO** — P1 서버 계약이 승인된 설계대로 정확히 구현됐고, 실 서버
직접 검증으로 정확성(cutoff 날짜, 6개 지표, Brand A/B 대칭, stale-cache
우회)을 전부 확인했다. 회귀 없음(307/307). P2(클라이언트 배선 +
Comparison Summary 문구)로 진행 가능한 상태다.

---

====================
STEP67 CROSS-BRAND PARTIAL-PERIOD P1
====================

IMPLEMENTATION:
PASS

CUTOFF RESOLVER:
PASS

CANONICAL AGGREGATION:
PASS

ENDPOINT:
PASS

BASE RANGE:
2026-08-01 ~ 2026-08-11

COMPARISON RANGE:
2026-07-01 ~ 2026-07-11

CUTOFF NORMALIZED:
true (elapsedDay=11)

REVENUE:
PASS

UNITS:
PASS

ORDERS:
PASS

AOV:
PASS

ONLINE REVENUE:
PASS

OFFLINE REVENUE:
PASS

BRAND A/B SYMMETRY:
PASS

STALE ARCHIVE DEPENDENCY:
NONE

TARGETED TESTS:
11/11

FULL REGRESSION:
307/307 (기준선 296 + 신규 11)

DIRECT ENDPOINT CHECK:
PASS

CARNET ARCHIVE:
base(8/1~8/11): revenue=10,883,059 units=32 orders=25 aov=435,322 online=1,021,959 offline=9,861,100
comparison(7/1~7/11): revenue=6,481,990 units=19 orders=17 aov=381,294 online=161,290 offline=6,320,700

TROUBLED WATERS:
base(8/1~8/11): revenue=8,274,400 units=26 orders=21 aov=394,019 online=0 offline=8,274,400
comparison(7/1~7/11): revenue=1,075,000 units=3 orders=3 aov=358,333 online=0 offline=1,075,000

FILES MODIFIED:
scripts/cross-brand-period-cutoff.mjs(신규), server.mjs, test/cross-brand-period-cutoff.test.mjs(신규)

REPORT:
docs/reports/STEP67-cross-brand-partial-period-p1.md

CHROME QA:
DEFERRED TO P2

COMMIT:
NONE

PUSH:
NONE

NEXT:
P2 frontend wiring + explicit cutoff context + Comparison Summary semantics

====================
