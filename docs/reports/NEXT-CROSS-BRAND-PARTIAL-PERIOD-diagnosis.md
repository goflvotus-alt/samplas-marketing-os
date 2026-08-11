# NEXT-CROSS-BRAND — Partial-Period Chrome QA Failure Diagnosis (READ-ONLY)

진단 전용. 코드/HTML/CSS/JS/server/테스트/마스터 데이터 전부 미수정.
git 쓰기 명령 전부 미실행. Revenue 계산 로직 미수정. 이번 작업의
유일한 새 파일은 이 보고서다. 조사는 이미 로컬에서 실행 중이던
서버(`http://localhost:8787`, 이번 세션이 새로 띄우지 않음)에 대해
읽기 전용 GET 요청만으로 수행했고, 원본 아카이브/ECOUNT 스냅샷 파일도
읽기만 했다. 어떤 파일도 쓰지 않았다.

## 핵심 결론(미리 요약)

이번 조사에서 서로 다른 **3개의 독립적인 원인**을 확인했다. 사용자가
"Partial-Period 의심"이라고 표현한 현상 하나가 아니라, 실제로는 다음
3가지가 겹쳐 나타난 것이다:

1. **Day-cutoff 정규화는 애초에 구현된 적이 없다**(§1) — 이것은
   버그가 아니라 기존 문서가 이미 명시한 설계다. 화면의 "7월
   비교값"(23,303,130원/69개/66건)은 **7월 전체월 값**이며, 8/1~8/11
   같은 부분 구간이 아니다(직접 재계산으로 확인, 실측치와 완전 일치).
2. **TROUBLED WATERS의 2026-07 값이 "데이터 연결 대기"인 것은
   진짜 데이터 부재가 아니라, `enrichMonthlyArchiveBrandSales()`의
   캐시 단락(short-circuit) 로직 때문에 서빙되는 "saved" 아카이브가
   실제로는 stale하기 때문이다**(§3) — ECOUNT 원본에는 TROUBLED
   WATERS의 2026-07 오프라인 매출 2,414,200원(6건)이 실제로 존재하고,
   실제 프로덕션 함수(`mergeOfflineBrandSales`)를 지금 다시 실행하면
   정확히 이 값을 찾아낸다. 이건 STEP67-10G-1이 예전에 확인했던
   "진짜 무데이터"와 **다른, 새로 발견된 문제**다.
3. **Customer Composition의 "데이터 연결 실패"는 client-side 10초
   타임아웃(재시도 없음) 때문일 가능성이 매우 높다**(§4) — 서버
   로직 자체는 지금 정상 응답(1.9~2.8초)하지만, 코드 경로가
   STEP67-10G-1이 `/api/reports/monthly`에만 적용했던 8초+30초 재시도
   패턴을 전혀 적용받지 못한 채 고정 10초·재시도 없음으로 남아 있다.

STEP67-10G-4(Partial-Period 정책)와 NEXT-CROSS-BRAND-FACT(cross-brand
확장)의 **핵심 규칙 자체는 이번 실제 값으로 재현했을 때 정확히
의도대로 동작한다**(§5) — PERIOD_CHANGE류 문장은 여전히 생성되지
않고, 인과 표현도 없다. 문제는 규칙 엔진이 아니라 그 **입력 데이터**
(캐시 staleness, 타임아웃)에 있다.

## 1. CARNET ARCHIVE 3개 구간 산출 및 Chrome 표시값 대조

**방법**: 로컬 서버(`http://localhost:8787`, 기존 실행 중)에 `GET
/api/reports/monthly?month=2026-07`/`2026-08`을 직접 호출해 실제
서빙되는 원본 아카이브를 받았다. 2026-07의 `orderHistory`(Cafe24
온라인, 주문 단위 날짜 포함)와 `work/ecount-sales/2026-07.json`
(ECOUNT 오프라인, 라인별 날짜 포함)을 프로덕션 함수 그대로
(`scripts/unified-identity-resolver.mjs`의 `resolveIdentity`/
`loadResolverContext`, `scripts/monthly-brand-sales.mjs`의
`mergeOfflineBrandSales`와 동일한 distinct-count 규칙)를 사용해 날짜로
필터링·재계산했다. 온라인/오프라인 각각 "전체 월" 재계산 결과가
아카이브의 `onlinePaidAmount`(2,448,430원)/`offlineSalesAmount`
(20,854,700원)와 정확히 일치함을 먼저 확인해 계산 방법론 자체를
검증했다.

| Brand | Period | Revenue | Units | Orders | AOV | Expected Cutoff | Chrome Value Match |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| CARNET ARCHIVE | 2026-07 전체(캐시/서빙값) | 23,303,130 | 69 | 66 | 353,078 | 없음(day-cutoff 미구현, 전체 월 그대로 서빙) | **YES** — Chrome의 "7월 비교값"과 정확히 일치 |
| CARNET ARCHIVE | 2026-07-01~07-11(가상 재계산, 실제로는 서빙되지 않음) | 6,482,990 | 19 | 17 | 381,352 | 해당 없음(완결 기간이라 애초에 이 구간 자체가 UI 어디에도 노출되지 않음) | N/A — 화면에 이 값이 표시된 적 없음(비교용 참고치) |
| CARNET ARCHIVE | 2026-08-01~08-11(=현재, live) | 10,883,059 | 32 | 25 | 435,322 | 오늘이 8/11이므로 미래 데이터가 존재하지 않아 자연히 1~11일치만 존재(day-cutoff 로직과 무관한 결과) | **YES** — Chrome의 "8월 현재값"과 정확히 일치 |
| TROUBLED WATERS | 2026-07 전체(실제 서빙값, stale) | (행 없음 → null) | (null) | (null) | (null) | 없음 | **YES** — Chrome의 "데이터 연결 대기"와 일치(단, §3에서 이 자체가 버그로 확인됨) |
| TROUBLED WATERS | 2026-07 전체(현재 원본 데이터 재계산, ground truth) | 2,414,200 | 6 | 6 | 402,367 | 없음(day-cutoff와 무관) | 화면에 표시되지 않음 — §3의 stale-cache 버그로 서빙 자체가 안 됨 |
| TROUBLED WATERS | 2026-08-01~08-11(=현재, live) | 8,274,400 | 26 | 21 | 394,019 | 위와 동일(자연 cutoff) | **YES** — Chrome의 "8월 현재값"과 정확히 일치 |

**결론**: 화면에 표시된 "23,303,130원/69개/66건"은 **7월 1~11일이
아니라 7월 전체월 값이다** — 추측이 아니라 (a) 캐시 파일 직접 읽기,
(b) 서버 재요청, (c) 원본 `orderHistory`/ECOUNT 라인 재집계 3가지
방법 전부가 동일한 숫자로 교차 확인됐다.

## 2. Cross-Brand Fact의 Partial-Period Clamp/Day-Cutoff 적용 지점 추적

요청하신 4개 지점(기준 브랜드 current/comparison fact, 비교 브랜드
current/comparison fact)을 코드에서 직접 추적했다:

```
기준 브랜드(A) current fact  <- entityCompareTargetPeriodData.aCurrent
                                 (entityCompareKpiRowFromArchive(archive, brandACode), archive는
                                 /api/reports/monthly?month=<현재월> 응답 그대로)
기준 브랜드(A) comparison fact <- entityCompareTargetPeriodData.aTarget
                                 (같은 함수, archive는 /api/reports/monthly?month=<비교월> 응답 그대로)
비교 브랜드(B) current fact   <- entityCompareTargetPeriodData.bCurrent(같은 current archive, brandBCode)
비교 브랜드(B) comparison fact <- entityCompareTargetPeriodData.bTarget(같은 target archive, brandBCode)
```

네 지점 전부 **정확히 동일한 함수**(`entityCompareKpiRowFromArchive`,
`outputs/samplas-marketing-os.js:13359`)를 brandCode 인자만 바꿔
재사용한다 — 코드가 A/B를 다르게 취급하는 지점이 구조적으로 없다.
그리고 이 함수는 day-cutoff/clamp 로직을 **전혀 갖고 있지 않다** —
`archive.commerce.brandSales`에서 브랜드에 해당하는 행 하나를 찾아
`revenue`/`quantitySold`/`orderCount`/`aov`/`online`/`offline`을 그대로
읽을 뿐이다. 그 `archive` 자체(서버가 만드는 `commerce.brandSales`)도
`aggregateCafe24BrandSalesByBrandCode()`(server.mjs:3106, 온라인)와
`mergeOfflineBrandSales()`(scripts/monthly-brand-sales.mjs:60, 오프라인)
둘 다 `since`/`until`로 항상 **월 전체 경계**(`monthStart`=`YYYY-MM-01`,
`monthEnd`=`monthEndKey(month)`=그 달의 마지막 날, `server.mjs:6502`
`monthEndKey()` 확인 — "오늘 날짜"를 전혀 참조하지 않음)만 받는다 —
"진행 중인 현재 월이니 일부만 집계한다"는 개념 자체가 이 두 집계
함수에 존재하지 않는다.

**당월(live)이 실제로 일부만 채워지는 이유**: day-cutoff 로직이
있어서가 아니라, **아직 존재하지 않는 미래 날짜의 주문/판매 라인이
원본 데이터에 물리적으로 없기 때문**이다(Cafe24 주문 API가 미래
주문을 반환할 수 없고, ECOUNT 오프라인 스냅샷도 오늘까지의 라인만
존재). 이것은 "자연스러운 결과"이지 "구현된 정책"이 아니다 — 이
차이가 §1의 "Expected Cutoff" 열에 명시한 구분이다.

**기존 문서와의 일치 확인**: 이 발견은 새로운 것이 아니라 이미 이전
STEP들이 명시적으로 문서화한 사실을 실측으로 재확인한 것이다.
`docs/reports/NEXT-CROSS-BRAND-FACT-plan.md` §D: *"만약 향후 '진행
중인 현재 월을 과거 완료 월과 같은 day-cutoff로 정규화해 비교'하는
기능을 만들려면, 현재 archive 파이프라인은 이를 지원하지 못한다...
이 기능은 이번 cross-brand-fact 확장의 범위가 아니며, 착수하지
않는다."* — 즉 day-cutoff는 **한 번도 GO 판정을 받거나 구현된 적이
없는 기능**이다. STEP67-10G-4/STEP67-10G-2가 채택한 실제 정책은
"정규화"가 아니라 "**당월이 진행 중이면 PERIOD_CHANGE류 해석 문장
자체를 생성하지 않는다**"(억제, suppression)이다 — 이 정책은 §5에서
확인하듯 지금도 정확히 동작하고 있다.

## 3. TROUBLED WATERS 2026-07 "데이터 연결 대기" 정확한 원인

**결론: resolver/key mismatch가 아니라 stale cache다.**

단계별 추적:

1. `GET /api/reports/monthly?month=2026-07` 응답의 `archiveStatus`는
   `"saved"`다 — `server.mjs:392`의 캐시 경로(`readMonthlyArchive` +
   `enrichMonthlyArchiveBrandSales`)를 탄다.
2. `enrichMonthlyArchiveBrandSales()`(server.mjs:3944)는 **핵심 단락
   로직**을 갖고 있다: `if (archive?.commerce?.brandSalesBasis ===
   "online_offline") return archive;` — 즉 캐시된 아카이브가 이미
   "온라인+오프라인 병합 완료" 표시를 갖고 있으면, **다시 병합을
   시도하지 않고 캐시를 그대로 반환한다.**
3. `work/monthly/2026-07.json`을 직접 읽어 확인한 결과
   `commerce.brandSalesBasis: "online_offline"`이 이미 설정돼 있다
   (`generatedAt: 2026-08-05T04:35:15.709Z`) — 따라서 이 캐시는
   **2026-08-05 이후 단 한 번도 재병합되지 않았고, 앞으로도(코드가
   바뀌지 않는 한) 재병합되지 않는다.**
4. 실제 프로덕션 함수(`mergeOfflineBrandSales`, 직접 import해 재실행,
   재구현이 아닌 진짜 함수)를 **지금** 같은 `since`/`until`
   (2026-07-01~2026-07-31)로, 현재의 `work/ecount-sales/2026-07.json`
   스냅샷(1,343줄)과 현재의 identity resolver로 다시 실행하면 —
   `brand_code: "B00000WW"`, `canonicalPaidAmount: 2,414,200`,
   `quantitySold: 6`, `orderCount: 6`인 **유효한 행이 정확히
   재현된다.**
5. 원본 ECOUNT 라인 6건을 직접 확인(날짜 07-01/07-01/07-07/07-12/
   07-12/07-13, `brandGroup: "TRO"`, `productName`이 전부
   `"TROUBLED WATERS / ..."`로 시작, `salesAmount`가 전부 양수/유한)
   — resolver가 오작동한 흔적이 없고, 지금 이 순간 다시 계산해도
   정확히 같은 브랜드로 resolve된다.

**정확한 분류**: 요청하신 4가지 후보 중 **"partial-period lookup
실패"에 가장 가깝지만, 정확히는 별개의 5번째 원인** — "**캐시
무효화 부재(stale cache)**"다. `brand-master.json`의 이름/별칭은
이 문제의 원인이 아니다(§3-4에서 재확인: 별칭 자체는 비어 있고,
resolve는 productName 기반 매칭으로 이뤄지며 지금도 정상 동작).
2026-08-05 원본 빌드 시점에 정확히 왜 이 6건이 누락됐는지(원본
ECOUNT 스냅샷이 그 순간 아직 완전히 반영되지 않았을 가능성이 가장
유력하나, `work/`가 git 이력에 없어 그 시점의 정확한 재구성은
불가능하다)는 확정할 수 없지만, **"캐시가 한 번 `online_offline`
표시를 얻으면 이후 원본이 어떻게 바뀌어도 절대 재검증되지 않는다"는
구조적 사실은 100% 확정**됐다(§3-4에서 실증).

**STEP67-10G-1과의 관계**: STEP67-10G-1 보고서(§12)는 "2026-07:
TROUBLED WATERS: matching row 없음 → 데이터 연결 대기/null 유지"를
**"진짜 무데이터"**로 분류했다. 이번 조사로 그 분류가 **그 시점
기준으로는 맞았을 수 있지만 지금은 더 이상 사실이 아님**을 확인했다
— ECOUNT 원본에 실제 매출이 존재하는데 캐시가 그것을 반영하지 못하고
있다. 같은 UI 증상("데이터 연결 대기")이 **서로 다른 시점에 서로
다른 원인**(당시: 진짜 무데이터 / 지금: stale cache)으로 나타난
사례다.

## 4. Customer Composition "데이터 연결 실패" 원인 추적

**단계 구분(요청하신 4가지 후보) 결과: network(client-side timeout)
단계 — resolver/fact/render 로직 문제 아님.**

1. **Render 단계 확인**: `entityCompositionDataset(data, key)`
   (outputs/samplas-marketing-os.js:12679)는 `data?.error`가
   참이거나 `data.typeStats`가 배열이 아닐 때만 `status: "error"`
   (→ "데이터 연결 실패" 텍스트, `renderEntityCompareCompositionDonut`,
   :12738-12739)를 반환한다. 서버가 정상 응답하면 `typeStats`는
   항상 배열(빈 배열이라도)이므로, 이 상태로 가려면 **`data.error`가
   설정돼 있어야 한다.**
2. **Network 단계 확인**: `getJson(url, timeoutMs)`
   (outputs/samplas-marketing-os.js:398)는 `AbortController`로
   `timeoutMs` 뒤 요청을 중단하고, 중단되면 정확히
   `{ error: "응답 지연" }`을 반환한다(STEP67-10G-1이 YoY 타임아웃
   때 확인한 것과 완전히 동일한 메커니즘). Customer Composition
   fetch 두 곳(`refreshEntityCustomerComposition`:13199,
   `refreshEntityCompareCustomerComposition`:12814) 모두
   **`getJson(url, 10000)`로 고정 10초, 재시도 없음**이다.
   STEP67-10G-1이 `/api/reports/monthly`에만 적용한
   `getEntityCompareMonthlyArchive`(8초 실패 시 30초 1회 재시도)
   패턴이 이 endpoint에는 **전혀 적용돼 있지 않다.**
3. **Server/Resolver 단계 확인**: 지금 이 endpoint를 직접
   호출했다 — `GET /api/brand-intelligence/B00000KU/customer-
   composition?month=2026-08`(1.9~2.8초, `ok:true`, 실제 타입별
   통계 정상 반환), `GET /api/brand-intelligence/B00000WW/customer-
   composition?month=2026-08`(1.9초, `ok:true`, 정상 반환) — **서버
   로직/resolver 자체는 지금 두 브랜드 모두 정상 동작한다.** 즉
   서버가 계속 실패하고 있는 게 아니다.
4. **결론**: 서버 로직이 살아있고(3번) 클라이언트가 정확히 timeout
   시 `{error: "응답 지연"}`을 반환하는 게 코드로 확인되며(2번), 그
   에러가 정확히 "데이터 연결 실패" 텍스트로 이어지는 게 코드로
   확인되므로(1번) — **가장 유력한 설명은 사용자가 실제로 Chrome
   QA를 수행한 시점에, 이 정확한 (브랜드, 2026-08) 조합에 대한 서버
   측 캐시가 아직 warm되지 않아 계산(`buildBrandSalesDiagnostics`의
   실시간 Cafe24 조회 + `buildBrandCustomerComposition`의 ECOUNT
   재집계)이 10초를 넘겼을 가능성이다.** 지금 재현이 빠른 것은 이
   세션의 반복 호출로 하위 캐시(Cafe24 주문 캐시, 상품 대시보드
   캐시)가 이미 warm됐기 때문으로 보인다 — **cold-start 재현은
   서버 캐시를 지워야 하므로 이번 READ-ONLY 진단에서는 직접 재현하지
   않았다**(그 파일들을 삭제/초기화하는 것은 진단 범위를 벗어나는
   변경 행위이기 때문).
5. **6월은 왜 정상이었는가**: 6월은 완결된 과거 월이라 이 endpoint가
   호출하는 `buildBrandSalesDiagnostics(monthStart, monthEnd)`가
   이전 여러 STEP(9H 시리즈 등)에서 이미 반복적으로 조회돼 하위
   캐시가 이미 충분히 warm됐을 가능성이 높다 — 반면 "2026-08 현재
   진행 중인 달의 Compare Mode Customer Composition"이라는 정확한
   조합은 이번이 이 기능(NEXT-CROSS-BRAND-FACT)의 첫 실사용 QA라서
   cold-start를 처음 만났을 수 있다. 이 부분은 서버 로그가 남아있지
   않아 **확정이 아니라 가장 근거가 강한 가설**임을 명시한다
   (CONFIDENCE: MEDIUM-HIGH — 코드 경로는 100% 확인, 정확한
   타이밍 재현만 못함).

## 5. STEP67-10G-4 / NEXT-CROSS-BRAND-FACT 정책 충돌 여부

**충돌 없음, 우회 경로 없음 — 직접 재현으로 확인.** 이번 Chrome QA의
정확한 실측값(CARNET ARCHIVE 8월 10,883,059원/32개/25건/435,322원 vs
7월 23,303,130원/69개/66건/353,078원, TROUBLED WATERS 8월
8,274,400원/26개/21건/394,019원)을 그대로 `buildComparisonSummaryFacts()`
(수정하지 않은 실제 함수)에 넣어 재실행한 결과:

```
facts:
  1. "CARNET ARCHIVE의 매출이 TROUBLED WATERS보다 높습니다."(REVENUE_LEADER, CROSS_BRAND)
  2. "CARNET ARCHIVE의 오프라인 비중이 높고, TROUBLED WATERS의 오프라인 비중도 높습니다."(CHANNEL_DOMINANT, NEXT-CROSS-BRAND-FACT 신규)
caveats:
  1. "이번 기간은 진행 중이라 완결된 기간과 직접 비교하지 않았습니다."(PARTIAL_PERIOD)
```

- PERIOD_CHANGE류 fact(REVENUE_PERIOD_CHANGE 등)는 **생성되지
  않았다** — STEP67-10G-4의 `isLive` 가드가 정확히 의도대로
  작동했다.
- 인과 표현("~로 인해"/"견인"/"상쇄") 0건.
- NEXT-CROSS-BRAND-FACT가 추가한 `CHANNEL_DOMINANT`는 정상적으로
  낮은 우선순위 슬롯을 채웠을 뿐, PERIOD_CHANGE/Partial-Period 가드를
  우회하는 어떤 코드 경로도 타지 않았다(§2에서 이미 확인한 대로,
  두 STEP 다 같은 `entityCompareTargetPeriodData.{aCurrent,bCurrent}`
  값만 읽고 day-cutoff 로직 자체가 어디에도 없으므로 "우회"할
  대상 자체가 없다).
- Units/Orders cross-brand fact가 이번 실측에서 노출되지 않은 것은
  버그가 아니라 materiality 미달(32 vs 26 = 18.75%, 25 vs 21 = 16%,
  둘 다 20% 임계값 미만)이다 — 의도된 정상 동작.

**결론: Comparison Summary 문장 자체는 이번 실측 상황에서도 정확하고
안전하다.** 이번에 발견된 문제(§1의 day-cutoff 미구현, §3의 stale
cache, §4의 timeout)는 전부 **Comparison Summary 이전 단계**(Period
Performance 표의 raw 값, Customer Composition fetch)에서 발생하며,
STEP67-10G-4/NEXT-CROSS-BRAND-FACT가 새로 만든 코드와는 무관하다.

## ROOT CAUSE

**3개의 독립적 원인**(우선순위 아님, 전부 실재):

1. Day-cutoff 정규화 기능은 **애초에 구현된 적이 없다**(설계 문서가
   이미 명시적으로 범위 밖으로 남긴 상태) — 진행 중인 현재 월과
   완결된 과거 월을 비교할 때 과거 월은 항상 전체월로 표시된다.
   버그가 아니라 미구현 기능.
2. `enrichMonthlyArchiveBrandSales()`의 `brandSalesBasis ===
   "online_offline"` 단락 로직이 **한 번 병합된 "saved" 월간
   아카이브를 원본 데이터가 이후 바뀌어도 다시는 재검증하지 않아**,
   TROUBLED WATERS의 2026-07 매출(실제로는 2,414,200원 존재)이
   "데이터 연결 대기"로 잘못 표시된다 — **버그(데이터 staleness)**.
3. Customer Composition endpoint(`getJson(url, 10000)`, 두 호출부
   모두)가 STEP67-10G-1의 8초+30초 재시도 패턴을 적용받지 못해,
   진행 중인 현재 월처럼 실시간 계산이 오래 걸리는 조합에서 고정
   10초 타임아웃에 걸릴 수 있다 — **버그(재시도 미적용)**,
   MEDIUM-HIGH 확신(정확한 cold-start 재현은 못했으나 코드 경로는
   100% 확인).

PARTIAL-PERIOD:
FAIL — 단, Comparison Summary 문장 생성 규칙(§5) 자체는 PASS다.
FAIL 판정의 근거는 "day-cutoff 정규화가 실제로 적용되고 있는가"라는
이번 조사의 목표 질문에 대해 **적용되고 있지 않다**(애초에 없다)는
사실 그 자체, 그리고 §3의 stale-cache 버그가 "비교 대상 기간의 실제
값"이라는 Partial-Period 정책의 전제(정확한 원본 데이터를 정직하게
보여준다) 자체를 훼손하고 있기 때문이다.

CUSTOMER COMPOSITION:
FAIL — 코드 경로상 명백한 재시도 미적용 gap이 확인됐다(§4).

FIX REQUIRED:
YES

RECOMMENDED FIX SCOPE:
```
(a) Customer Composition endpoint에 STEP67-10G-1과 동일한 재시도
    패턴(예: 8초 실패 시 30초 1회 재시도) 적용 — 예상 파일:
    outputs/samplas-marketing-os.js(refreshEntityCustomerComposition,
    refreshEntityCompareCustomerComposition 두 호출부). 새 서버 변경
    불필요, 이미 검증된 패턴 재사용.
(b) enrichMonthlyArchiveBrandSales()의 캐시 단락 로직 재검토 — 예상
    파일: server.mjs. "saved" 아카이브가 실제로 최신 ECOUNT 스냅샷을
    반영하는지 확인하는 방법(재검증 조건 추가 또는 재빌드 트리거)이
    필요하나, 이는 캐시 전체 정합성에 영향을 미치는 더 넓은 범위의
    변경이라 별도 진단/설계 STEP으로 분리를 권장한다(이번 보고서는
    진단만, 수정 설계는 범위 밖).
(c) Day-cutoff 정규화는 "버그 수정"이 아니라 "신규 기능"이다 —
    NEXT-CROSS-BRAND-FACT-plan.md가 이미 이를 별도 BLOCKER로
    기록했다. 구현하려면 온라인/오프라인 원본 데이터에 일자별 브랜드
    집계를 보존하는 새 데이터 경로가 필요하다(현재 아키텍처는 월
    단위로만 집계, §2 확인) — 이번 보고서는 이 필요성을 재확인할
    뿐, 착수를 권장하지 않는다(사용자의 정책 결정 필요: day-cutoff
    정규화를 실제로 만들 것인지, 아니면 현재처럼 "진행 중 기간은
    비교 자체를 만들지 않는다" 정책을 유지할 것인지).
```

CONFIDENCE:
```
Day-cutoff 미구현(§1/§2): HIGH — 3가지 독립 방법으로 교차 확인
TROUBLED WATERS stale cache(§3): HIGH — 실제 프로덕션 함수 재실행으로 직접 재현
Customer Composition timeout(§4): MEDIUM-HIGH — 코드 경로는 100% 확인, 정확한 cold-start 타이밍 재현은 못함(서버 캐시를 지워야 하므로 READ-ONLY 범위에서 보류)
정책 충돌 없음(§5): HIGH — 실제 값으로 직접 재실행해 확인
```

---

**중요**: 이번 조사에서 코드/HTML/CSS/JS/server를 전혀 수정하지
않았다. Revenue 계산 로직 무수정. test 무수정. master data 무수정.
commit하지 않았다. push하지 않았다. 진단 보고서만 작성했다.
