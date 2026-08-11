# NEXT-CROSS-BRAND-PARTIAL-PERIOD — Implementation Plan (READ-ONLY)

번호 없는 작업. 이 문서는 **설계 전용**이다. 코드/HTML/CSS/JS/server/
테스트/마스터 데이터 전부 미수정. git 쓰기 명령 전부 미실행. 이번
작업의 유일한 새 파일은 이 보고서다. 근거는 전부 `outputs/samplas-
marketing-os.js`/`server.mjs`/`scripts/monthly-brand-sales.mjs` 직접
읽기와, `docs/reports/NEXT-CROSS-BRAND-PARTIAL-PERIOD-diagnosis.md`
(직전 진단, 실측 데이터 포함)에서 이미 검증된 사실만 사용했다.

## 1. Executive Summary

Same-elapsed-day cutoff 비교에 필요한 **집계 로직은 이미 100% since/
until로 파라미터화돼 있다** — `aggregateCafe24BrandSalesByBrandCode`
(온라인, 실제로는 그 앞단 `fetchCafe24Orders(since, until)`가 날짜
범위를 받음)와 `mergeOfflineBrandSales({since, until, ...})`(오프라인)
둘 다 이미 임의의 날짜 범위를 받아 정확히 그 범위만 집계한다(직전
진단에서 이 두 함수를 실제로 재실행해 검증 완료). **새로 만들어야
하는 것은 계산 로직이 아니라, 이 두 함수를 월 전체 경계
(`monthStart`~`monthEnd`) 대신 "오늘까지의 경과일" 경계로 호출하는
얇은 오케스트레이션 한 겹**뿐이다. 이를 위해 새 서버 endpoint 1개
(`/api/reports/monthly-cutoff`)를 제안한다 — 기존 `/api/reports/
monthly`(이미 3번의 버그 수정을 거친 endpoint)는 **전혀 건드리지
않는다.** Canonical Calculation Owner는 **서버**(Option C: 기존
canonical aggregator를 재사용하는 새 전용 함수)이며, 클라이언트는
"cutoff 모드를 쓸지 말지"만 결정하고 실제 날짜 계산은 서버가
`todayKey()`(이미 존재하는 Asia/Seoul 타임존 안전 헬퍼)로 독립적으로
수행한다. 이 설계는 요청 횟수를 늘리지 않으며(현재도 2건, 이후도
2건), 직전 진단이 발견한 stale-cache 버그(§13)를 구조적으로
회피한다(새 경로가 `work/monthly/*.json` 캐시를 아예 읽지 않으므로).

## 2. Current Bug

`docs/reports/NEXT-CROSS-BRAND-PARTIAL-PERIOD-diagnosis.md` §1/§2가
이미 실측으로 확정한 사실: 2026-08(진행 중, 오늘 2026-08-11) vs
2026-07 비교에서, 화면의 "7월 비교값"(23,303,130원/69개/66건)은 **7월
1~11일이 아니라 7월 전체월 값**이다. 원인은 버그가 아니라 **기능
자체가 없었기 때문**이다 — `entityCompareKpiRowFromArchive()`(client)와
`aggregateCafe24BrandSalesByBrandCode()`/`mergeOfflineBrandSales()`
(server, 둘 다 이미 월 전체 경계로만 호출됨)는 day-cutoff 개념을
가진 적이 없다. STEP67-10G-4가 채택한 정책은 "정규화"가 아니라
"진행 중인 현재 월과 관련된 PERIOD_CHANGE 해석 문장 자체를 생성하지
않는다"(억제)였다 — 이번 계획은 이를 "정규화된 비교를 실제로 만들고,
그 위에서 안전하게 해석 문장을 다시 허용한다"로 발전시킨다.

## 3. Current Data Flow

```
selected period(entityPeriodState, entityCompareTargetPeriodKey())
  → currentKey/targetKey("YYYY-MM" 문자열, entityComparePeriodKeyForMode)
  → refreshEntityCompareTargetPeriodData()(js:13427 부근)
      → getEntityCompareMonthlyArchive(currentKey)  ─┐ Promise.all,
      → getEntityCompareMonthlyArchive(targetKey)   ─┘ 정확히 2건
          → getSharedJson(`/api/reports/monthly?month=${month}`, 8000/30000)
              → server.mjs: GET /api/reports/monthly
                  - month === currentMonth() → buildMonthlyArchive(month), archiveStatus:"live"
                  - 캐시 있음 → enrichMonthlyArchiveBrandSales(cached, month), archiveStatus:"saved"
                  - 캐시 없음 → buildMonthlyArchive(month), archiveStatus:"draft"
              buildMonthlyArchive(month)(server.mjs:3805)
                  monthStart = `${month}-01`, monthEnd = monthEndKey(month) (★ 항상 월 전체)
                  → buildBrandSalesDiagnostics(monthStart, monthEnd) (온라인, Cafe24)
                  → buildMonthlyArchiveBrandSales(monthStart, monthEnd, commerceSource) (오프라인 병합)
                      → mergeOfflineBrandSales({..., since: monthStart, until: monthEnd, ...})
  → entityCompareKpiRowFromArchive(archive, brandCode)(js:13359)
      archive.commerce.brandSales에서 brandCode 행 하나 → {revenue, quantitySold, orderCount, aov, online, offline}
      (day-cutoff 로직 전혀 없음 — 행을 찾아 필드를 그대로 읽을 뿐)
  → entityCompareTargetPeriodData.{aCurrent,aTarget,bCurrent,bTarget}
  → renderEntityCompareTargetPeriodKpis()(Period Performance 표) / renderEntityCompareSummary()(Comparison Summary)
```

**전체월 값이 들어오는 정확한 지점**: `buildMonthlyArchive()`
(server.mjs:3811) `const monthEnd = monthEndKey(month);` — 이 한 줄이
모든 하위 집계 함수에 "월의 마지막 날"을 하드코딩해 전달한다. "오늘
날짜"를 참조하는 지점이 이 함수 전체에 단 한 곳도 없다(직접 확인).

## 4. Source Granularity

| 지표 | 원본에 일자 정보 있음? | 임의 날짜 범위 집계 가능한 기존 함수 있음? | 새 API 필요? |
|---|---|---|---|
| Revenue(온라인) | Y(Cafe24 주문 자체가 날짜 기반) | Y — `fetchCafe24Orders(since, until)`가 이미 임의 범위 지원(server.mjs, `buildBrandSalesDiagnostics`가 그대로 전달) | N |
| Revenue(오프라인) | Y(`work/ecount-sales/{month}.json`의 `salesLines[].date`, 라인별 날짜 확인됨 — 직전 진단에서 직접 읽음) | Y — `mergeOfflineBrandSales({since, until, ...})`가 이미 라인 단위로 `date < since \|\| date > until`로 필터링(scripts/monthly-brand-sales.mjs:80, 직접 확인) | N |
| Units | 위와 동일 소스(quantity 필드가 같은 라인/주문 항목에 존재) | Y — 위 두 함수가 revenue와 정확히 같은 패스에서 quantity도 함께 합산 | N |
| Orders | 위와 동일(orderId/documentNo가 같은 라인/주문에 존재) | Y — 위 두 함수가 distinct orderId/documentNo count도 같은 패스에서 계산 | N |
| AOV | 파생값(revenue/orderCount) | Y — 새 소스 불필요, 같은 cutoff 윈도우의 revenue/orderCount만 있으면 됨 | N |
| Online/Offline 비중(Channel Mix) | 위와 동일(`onlinePaidAmount`/`offlineSalesAmount` 필드가 같은 집계 결과물) | Y | N |

**결론**: 6개 지표 전부 **기존 함수가 이미 임의 날짜 범위를
지원한다** — 이번 조사에서 데이터 부재/새 계산식 필요를 하나도
발견하지 못했다. 새로 필요한 것은 **이 함수들을 월 전체가 아니라
경과일 경계로 호출하는 얇은 오케스트레이션**뿐이다(서버 측, §5).
클라이언트에는 원본 라인 데이터가 전혀 전달되지 않으므로(브랜드별
월간 합계만 응답에 포함) **클라이언트 측 slicing은 애초에 불가능하다**
— 서버 측 계산이 유일한 선택지다.

## 5. Canonical Calculation Owner

**OPTION C 채택**: 기존 canonical aggregator(`buildBrandSalesDiagnostics`,
`mergeOfflineBrandSales`)를 재사용하는 새 전용 서버 함수 +
새 얇은 endpoint.

- **OPTION A(클라이언트가 cutoff 계산) 기각**: 클라이언트는 원본
  라인 데이터를 갖고 있지 않다(§4) — "존재하지 않는 데이터를 슬라이싱"
  하게 되므로 요구사항이 명시적으로 금지한 패턴이다.
- **OPTION B(기존 `/api/reports/monthly`가 cutoff 메타데이터를
  받아 처리) 기각**: 그 endpoint는 이미 3단계 분기(live/saved-cache/
  draft, 그리고 STEP67-10G-1의 재시도 로직까지 얽혀 있음)와, 직전
  진단이 발견한 캐시 staleness 버그의 근원지다. 여기에 4번째 분기를
  더하면 이미 취약한 지점의 리스크 표면을 넓힌다.
- **OPTION C 채택 이유**: `buildMonthlyArchive()`는 Brand Comparison이
  전혀 쓰지 않는 Meta Ads/Instagram/재무 정합성 계산까지 포함하는
  무거운 함수다(server.mjs:3805-3917 확인 — marketing/content 블록).
  이를 통째로 재사용하면 cutoff 요청마다 불필요한 외부 API 호출이
  따라붙는다(§14 성능). 대신 `buildMonthlyArchive()`가 내부적으로
  쓰는 **두 개의 좁은 빌딩 블록**(`buildBrandSalesDiagnostics`,
  `buildMonthlyArchiveBrandSales`)만 새 함수에서 직접 재사용한다 —
  Commerce/Today/Monthly가 이미 신뢰하는 계산식과 100% 동일한 코드
  경로이며, 중복 로직이 전혀 없다.

## 6. Cutoff Contract

```
새 서버 함수: buildMonthlyCommerceCutoffArchive(month)
  today = todayKey()(server.mjs:6563, 이미 존재하는 Asia/Seoul 타임존
          안전 헬퍼 — env.REPORT_TIMEZONE || "Asia/Seoul", Intl.DateTimeFormat
          기반, 새 타임존 로직 불필요)
  elapsedDay = Number(today.slice(-2))  // 오늘의 "일" 성분
  daysInTargetMonth = monthEndKey(month)의 "일" 성분(기존 monthEndKey가
          이미 Date.UTC(year, m, 0) 기반이라 월 길이/윤년을 정확히 계산함,
          새 달력 로직 불필요 — §7의 edge case 1/2/3을 이 재사용만으로 해결)
  cutoffDay = Math.min(elapsedDay, daysInTargetMonth)  // 절대 clamp, 음수/0 불가
  until = `${month}-${String(cutoffDay).padStart(2, "0")}`
  monthStart = `${month}-01`
  commerceSource = await buildBrandSalesDiagnostics(monthStart, until)  // 기존 함수, 새 로직 없음
  brandSales = await buildMonthlyArchiveBrandSales(monthStart, until, commerceSource)  // 기존 함수, 새 로직 없음
  return {
    month, until,
    commerce: { brandSales, brandSalesBasis: "online_offline", productSales: commerceSource.products || [] },
    archiveStatus: "cutoff"  // 새 값 — live/saved/draft와 구분되는 4번째 상태
  }

새 endpoint: GET /api/reports/monthly-cutoff?month=YYYY-MM
  - month 형식 검증(기존 isValidMonthKey 재사용)
  - month >= currentMonth()면 400(cutoff는 과거/비교 대상 월에만 의미가 있음 —
    당월 자체는 이미 자연스럽게 "오늘까지"만 존재하므로 이 endpoint가 필요 없다)
  - work/monthly/*.json 캐시를 절대 읽거나 쓰지 않는다(§13)
```

**클라이언트가 cutoff 모드를 쓸지 결정하는 지점**: `refreshEntityCompareTargetPeriodData()`
안에서, **네트워크 요청 없이** 이미 갖고 있는 상태만으로 판단한다 —
`entityTrendMonths.find(row => row.key === currentKey)`의
`archiveStatus`(STEP67-10G-4가 이미 각 행에 심어둔 필드)가 `"live"`인지
`entityIsLiveMonthRow()`(STEP67-10G-4가 이미 만든 헬퍼, 재사용)로
확인한다. `entityTrendMonths`는 Compare Mode 진입 여부와 무관하게
항상 `refreshEntityTrendMonths()`가 먼저 채우므로(기존 트리거 체인)
이 값은 target 기간 fetch 시점에 이미 준비돼 있다. 못 찾으면(드문
타이밍 케이스) 안전하게 "live 아님"으로 취급 — 기존과 동일한
전체월 동작으로 fallback(회귀 없음, 정규화 기회만 놓칠 뿐 오류 없음).

## 7. Edge Cases

| # | 케이스 | 처리 |
|---|---|---|
| 1 | 2월/월별 길이 다름 | `monthEndKey()` 재사용 — `Date.UTC(year, m, 0)`이 이미 정확한 월 길이를 계산(기존 코드, 새 로직 없음) |
| 2 | base=2026-03-31 live vs compare=2026-02(28일뿐) | `cutoffDay = Math.min(31, 28) = 28` — 2월 전체가 그대로 비교 대상이 됨(2월의 마지막 날을 넘길 수 없으므로 자동 clamp, §6) |
| 3 | 윤년 2월 | `Date.UTC(year, 2, 0)`이 윤년을 정확히 인식(JS 내장 달력 계산, 이미 검증된 기존 패턴 그대로 재사용) |
| 4 | 타임존 Asia/Seoul | `todayKey()`(server.mjs:6563)가 이미 `env.REPORT_TIMEZONE \|\| "Asia/Seoul"` 기준으로 계산 — 새 타임존 로직 불필요, 기존 헬퍼 재사용 |
| 5 | 주문 0건 | `mergeOfflineBrandSales`/`aggregateCafe24BrandSalesByBrandCode`가 해당 브랜드 행 자체를 만들지 않음 → `entityCompareKpiRowFromArchive`가 `null` 반환(기존 동작 그대로, §4에서 새 로직 없다고 확인한 이유) — 기존 MISSING_DATA caveat 정책 그대로 적용 |
| 6 | null 브랜드 행 | 위와 동일 — cutoff 윈도우 안에서 그 브랜드의 라인이 전혀 없으면 행이 없다(진짜 null, 0으로 위장 안 함 — 기존 Null≠Zero 계약 상속) |
| 7 | 비교 대상 아카이브 없음(fetch 실패) | 새 endpoint도 기존 `getEntityCompareMonthlyArchive`와 동일한 timeout/error 상태 구분을 그대로 쓴다(§9 성능/재시도) — `targetStatus: "timeout"/"error"`는 기존 caveat 문구 재사용 |
| 8 | stale 월간 아카이브 | §13에서 별도로 다룸 — 이 새 경로는 그 캐시를 아예 안 쓰므로 구조적으로 영향받지 않음 |
| 9 | cutoff 윈도우 안에서 비교 브랜드 데이터 없음 | 5/6과 동일 원리 — 그 브랜드만 null, 다른 브랜드는 영향 없음(브랜드별 독립 판정, 기존 LOW_BASE/MISSING_DATA 원칙과 동일 패턴) |
| 10 | 현재 날짜가 1일 | `elapsedDay=1`, `until = ${month}-01` — 1일치만 비교(저모수), 기존 LOW_BASE caveat(주문 3건 미만/매출 50만원 미만)가 이미 이 상황을 다룬다(STEP67-10G-3, 재사용) |
| 11 | 완결된 과거 월을 수동 선택 | `currentArchiveStatus !== "live"`이므로 cutoff 모드 자체가 발동하지 않음 — 기존 전체월 vs 전체월 동작 그대로(요구사항 D, 회귀 없음) |

## 8. Metric Semantics

- **Revenue/Units/Orders**: cutoff 윈도우의 원본 라인만 합산(§4/§6) —
  새 산식 없음, 기존 `canonicalPaidAmount`/`quantity`/`orderId`(온라인)·
  `documentNo`(오프라인) 카운트 규칙 100% 그대로.
- **AOV 계약(요구사항 Phase D)**: `entityCompareKpiRowFromArchive()`가
  **이미** `aov = orderCount ? Math.round(revenue / orderCount) : 0`을
  같은 `archive.commerce.brandSales` 행 하나에서 계산한다(js:13359
  부근, 무수정 예정) — cutoff 아카이브의 revenue와 orderCount는 **항상
  같은 `buildMonthlyCommerceCutoffArchive()` 호출, 같은 `until` 값으로
  집계된 같은 행**에서 나오므로, "cutoff revenue + 전체월 orderCount"가
  섞일 수 있는 코드 경로 자체가 존재하지 않는다(설계상 원천 차단,
  추가 방어 코드 불필요). `orderCount === 0`이면 기존과 동일하게
  `aov = 0`(null이 아니라 명시적 0 — 기존 정책 그대로, §7-5/6이 이미
  이 상황의 null-vs-zero 구분을 보장).
- **Channel Mix**: `online`/`offline` 필드도 같은 cutoff 아카이브 행에서
  나오므로 자동으로 같은 윈도우(§10에서 재확인).
- **Customer Composition**: 이번 계획의 지표 목록(Revenue/Units/Orders/
  AOV/Channel Mix/Comparison Summary/Period Performance)에 포함되지
  않는다 — Customer Composition은 애초에 "현재 vs 비교 대상" 축이
  없고(두 브랜드의 현재 기간 스냅샷만 나란히 보여줌, STEP67-9H
  시리즈) cutoff 정규화 대상이 아니다. **범위 밖으로 명시.**

## 9. Brand A/B Symmetry

| 위치 | 사용하는 fetch | cutoff 적용 여부 |
|---|---|---|
| Brand A current | `getEntityCompareMonthlyArchive(currentKey)`(기존, 무수정) | 해당 없음(당월이면 자연히 오늘까지만 존재, §2) |
| Brand A comparison | `currentArchiveStatus`가 live면 새 cutoff endpoint, 아니면 기존 endpoint | current가 live일 때만 |
| Brand B current | Brand A current와 **정확히 같은 archive 응답**(`aCurrent`/`bCurrent` 모두 같은 fetch 결과에서 brandCode만 바꿔 추출, 기존 `entityCompareKpiRowFromArchive` 구조 그대로) | Brand A와 동일 |
| Brand B comparison | Brand A comparison과 **정확히 같은 archive 응답**(같은 이유) | Brand A와 동일 |

**브랜드별 분기 없음**: cutoff 여부는 오직 "어느 기간을 보고 있는가"
(current vs target)로만 결정되고, "어느 브랜드인가"와는 무관하다 —
`entityCompareKpiRowFromArchive(archive, brandCode)`가 이미 Brand A/B에
동일하게 재사용되는 단일 함수이므로(§3), 이 함수에 들어가는 `archive`
자체가 cutoff-정규화됐는지 여부만 상위에서 한 번 결정하면 A/B 양쪽에
자동으로 대칭 적용된다 — 브랜드별 shortcut을 만들 필요도, 만들
지점도 없다.

## 10. Channel Mix

`entityCompareSummaryChannelShare(row)`(js:13648, NEXT-CROSS-BRAND-FACT가
이미 구현)는 `row.online`/`row.offline`만 읽는다 — cutoff 아카이브의
행도 정확히 같은 필드 이름과 의미를 가지므로(§6, §8) **이 함수는
무수정으로 그대로 재사용된다.** "전체월 채널 믹스"가 섞여 들어올
코드 경로가 없다 — `online`/`offline`은 revenue/units/orders와 완전히
같은 한 번의 `buildMonthlyArchiveBrandSales`/`mergeOfflineBrandSales`
패스에서 같은 cutoff 윈도우로 계산되기 때문이다(§6).
`entityCompareSummaryChannelDominantFact()`(NEXT-CROSS-BRAND-FACT)도
동일하게 무수정 재사용 가능.

## 11. UI Semantics

**표를 재설계하지 않는다.** 기존 Period Performance 표는 이미 각
열 헤더 아래 `<small>` 서브라벨을 갖고 있다(`outputs/samplas-
marketing-os.html:1604` 등, 4개 카드 동일 구조: `<small>비교 대상</small>`).
**새 DOM/새 클래스를 추가하지 않고**, `entityCompareMonthKeyLabel(key)`
(js:13415 부근, `renderEntityCompareKpiValue`가 이미 이 값을 저
`<strong data-entity-compare-target-period>` 텍스트로 쓰고 있음)가
반환하는 문자열 자체에 cutoff 정보를 포함시키는 것이 가장 작은
변경이다:

```
기존: "2026년 7월"
cutoff 정규화 시: "2026년 7월 · 1~11일"
```

`entityCompareTargetPeriodData`에 새 필드(`targetCutoffUntil` 또는
`until` 그대로)를 추가해 이 라벨 생성 시 참조하면 된다 — 표의 열 구조/
카드 크기/컨트롤은 전혀 바뀌지 않는다. 사용자가 요구한 개념
("동일 경과일 기준 · 1~11일"/"비교 범위 7/1~7/11")과 부합하되, 기존에
이미 존재하는 라벨 자리를 재사용하는 형태로 축약했다 — **구현 시
정확한 문구는 사용자 확인 후 확정**(이 STEP은 설계만).

## 12. Comparison Summary Semantics

**요구사항 그대로 Option 2를 권장한다**: 기존 `"이번 기간은 진행
중이라 완결된 기간과 직접 비교하지 않았습니다."`를, cutoff 정규화가
실제로 적용된 경우 `"진행 중인 기간은 동일 경과일(1~11일) 기준으로
비교했습니다."`류의 문구로 교체한다.

**이유**: cutoff 정규화가 구현되면 "완결된 기간과 직접 비교하지
않았습니다"는 더 이상 사실이 아니다 — 실제로는 동일 경과일 기준의
유효한 비교가 이뤄진다. 기존 문구를 그대로 두면(Option 1) STEP67-10G-4가
막으려 했던 바로 그 종류의 "화면 안 모순된 문구"가 재현된다(다른
데이터로, 같은 문제).

**엔진 계약(요구사항: 엔진이 스스로 cutoff를 계산하면 안 됨)**:
`buildComparisonSummaryFacts(input)`에 새 입력 필드
`targetPeriodBasis: "full_month" | "cutoff"`(또는 boolean
`isCutoffNormalized`)를 추가한다 — 이 값은 `entityCompareTargetPeriodData.targetArchiveStatus
=== "cutoff"`에서 그대로 옮겨 담을 뿐, 엔진 내부에서 날짜 계산을
전혀 하지 않는다(순수 함수 원칙 유지). `isLive` 분기 로직을 다음처럼
재설계한다(설계만, 미구현):

```
if (isLive) {
  if (targetPeriodBasis === "cutoff" && aCurrent && aTarget) {
    caveats.push({ type: "CUTOFF_NORMALIZED", text: "진행 중인 기간은 동일 경과일 기준으로 비교했습니다." });
    // §7의 tiers/conflicting 로직을 그대로 재사용해 PERIOD_CHANGE/CONFLICTING fact 생성 허용
    // (기존 "else" 분기의 계산 로직을 그대로 타되, 문구만 캐치업 — 새 계산식 없음)
  } else {
    caveats.push({ type: "PARTIAL_PERIOD", text: "이번 기간은 진행 중이라 완결된 기간과 직접 비교하지 않았습니다." });
    // 기존 그대로: PERIOD_CHANGE류 생성 안 함
  }
}
```

CROSS_BRAND axis(§9)는 이미 `isLive`와 무관하게 항상 허용되므로
무수정.

## 13. Stale Archive Interaction

**새 cutoff 경로는 이 문제를 구조적으로 우회한다.** 직전 진단 §3이
확인한 stale-cache 버그(`enrichMonthlyArchiveBrandSales`의
`brandSalesBasis === "online_offline"` 단락 로직)는 `/api/reports/monthly`의
**"saved" 캐시 읽기 경로**에서만 발생한다. `buildMonthlyCommerceCutoffArchive()`
는 `work/monthly/*.json`을 **전혀 읽지도 쓰지도 않는다** — 매 요청마다
`buildBrandSalesDiagnostics`/`buildMonthlyArchiveBrandSales`를 처음부터
다시 실행한다(§6). 따라서 TROUBLED WATERS의 2026-07 매출처럼 원본
ECOUNT 스냅샷에는 실제로 존재하지만 캐시된 아카이브에는 반영되지
않은 데이터도, cutoff 경로를 통하면 **항상 최신 원본 기준으로 정확히
잡힌다**(직전 진단에서 실제 프로덕션 함수 재실행으로 이미 검증됨 —
`mergeOfflineBrandSales`를 지금 다시 돌리면 그 6건이 정확히
잡힌다는 사실 자체가 이 설계의 타당성을 뒷받침한다).

**단, 이 계획은 기존 stale-cache 버그 자체를 고치지 않는다** —
요구사항이 명시한 대로("Do NOT implement archive cache restructuring in
this planning STEP") 완결 월 vs 완결 월 비교(§7-11)나 현재 기간 자체의
fetch는 여전히 기존 `/api/reports/monthly`의 캐시 경로를 타므로, 그
버그는 **별도 STEP으로 그대로 남는다.** 이번 계획으로 얻는 것은
"cutoff 경로가 우연히도 그 버그의 영향을 받지 않는다"는 사실이지,
"그 버그를 고쳤다"는 것이 아니다 — 혼동하지 않도록 명시한다.

## 14. Performance / Caching

**요청 수는 늘어나지 않는다.** 현재도 Compare Mode는 current/target
2건의 아카이브 fetch만으로 Brand A/B 양쪽을 전부 커버한다
(`entityCompareKpiRowFromArchive(archive, brandCode)`를 brandCode만
바꿔 두 번 호출, §3/§9) — 이번 계획도 정확히 2건을 유지한다(target
fetch가 기존 endpoint 대신 새 endpoint를 쓸 뿐, 건수는 동일). "브랜드당
독립 요청 4건"이라는 우려는 현재 아키텍처에 애초에 존재하지 않는다.

**cutoff 요청은 항상 "live 계산"과 같은 비용**이다(캐시를 안 쓰므로,
§13) — `buildMonthlyArchive()`의 무거운 부분(Meta Ads/Instagram)을
빼서(§5) 상대적으로 가볍지만, Cafe24 온라인 주문 조회 + ECOUNT 오프라인
스냅샷 파싱은 매번 새로 실행된다. **재시도 정책을 반드시 함께
적용해야 한다** — STEP67-10G-1(`getEntityCompareMonthlyArchive`)과
직전 STEP(Customer Composition retry fix)이 이미 두 번 같은 교훈을
남겼다: 캐시 없이 실시간 계산하는 endpoint는 고정 timeout 하나만
쓰면 반드시 같은 종류의 "데이터 연결 대기/실패" 오탐이 재현된다.
새 `getEntityCompareMonthlyArchiveCutoff(month)` 클라이언트 헬퍼도
**동일한 8초+30초 1회 재시도 패턴**(`getEntityCompareMonthlyArchive`/
`getEntityCompositionJson`과 완전히 같은 구조)을 반드시 적용한다 —
새로 발명하지 않고 이미 검증된 패턴을 세 번째로 재사용한다.

**캐싱**: 이번 계획 범위에서는 cutoff 응답을 별도로 캐시하지 않는다
(같은 요청 세션 안에서도 "오늘"이 바뀌지 않는 한 결과가 안정적이므로
`getSharedJson`(URL 기반 요청 coalescing, 이미 존재)을 그대로 재사용하면
동시 중복 요청은 자동으로 합쳐진다 — 새 캐싱 계층 불필요).

## 15. Test Plan

요구사항 18개 시나리오를 이 저장소의 기존 패턴
(`test/brand-comparison-yoy-timeout.test.mjs`의 `sourceOf` + `Function()`
추출, `test/brand-comparison-summary.test.mjs`의 엔진 fixture 방식)으로
설계한다. 실제 구현 STEP에서 작성할 목록이며, 이번 STEP에서는 작성만
계획한다(코드 없음):

| # | 시나리오 | 검증 계층 |
|---|---|---|
| 1 | 8/11 vs 7/11(오늘=8/11, current=8월 live) | 서버 pure 함수(`cutoffDay` 계산) + 클라이언트 fixture(cutoff 아카이브 fixture로 `buildComparisonSummaryFacts` 재실행) |
| 2 | 8/11 vs 전년 동월 8/11(YoY) | 동일 — target=2025-08, 같은 cutoff 계산 재사용(연도만 다름, 로직 무관) |
| 3 | 3/31 vs 2월 마지막날 clamp | 서버 pure 함수 단위 테스트(`Math.min(31, daysInFeb)`) |
| 4 | 윤년 2월 | 서버 pure 함수 단위 테스트(2024/2028 등 윤년 month로 `monthEndKey` 재확인) |
| 5 | 완결 6월 vs 완결 5월은 여전히 전체월 | `entityIsLiveMonthRow`가 false인 fixture로 기존 `getEntityCompareMonthlyArchive` 경로만 타는지(cutoff endpoint 호출 안 함) 확인 |
| 6 | Brand A/B 같은 cutoff 윈도우 | 같은 cutoff 아카이브 fixture에서 `entityCompareKpiRowFromArchive(archive, brandACode)`/`(archive, brandBCode)` 둘 다 같은 `until` 근거의 값인지(§9) |
| 7 | Revenue cutoff | 서버: `buildBrandSalesDiagnostics(monthStart, until)` mock/fixture로 revenue 합계가 until 이전 라인만 반영하는지 |
| 8 | Units cutoff | 동일 fixture로 quantity 합계 |
| 9 | Orders cutoff | 동일 fixture로 distinct order/document count |
| 10 | AOV cutoff 일관성 | 같은 행에서 revenue/orderCount가 항상 같은 until로 계산됐는지(§8, mixing 방지) — cutoff revenue와 전체월 orderCount를 섞은 fixture를 **의도적으로 구성할 수 없음을 코드 구조로 증명**(같은 함수 한 번 호출로 둘 다 나오므로) |
| 11 | Channel Mix cutoff | cutoff 아카이브의 online/offline 필드로 `entityCompareSummaryChannelShare`/`ChannelDominantFact` 재확인 |
| 12 | null 브랜드 행 | cutoff 윈도우에 해당 브랜드 라인이 없는 fixture → `entityCompareKpiRowFromArchive` null, MISSING_DATA caveat |
| 13 | 주문 0건 | orderCount=0 fixture → AOV=0(null 아님), 기존 Null≠Zero 회귀 테스트 재사용 |
| 14 | 기간 변경 후 stale response 없음 | `getEntityCompareMonthlyArchiveCutoff`에 대해 `test/brand-comparison-yoy-timeout.test.mjs`와 동일한 timeout/retry mock 테스트 + 기존 `entityCompareTargetPeriodRefreshSeq` 가드가 cutoff 경로에서도 그대로 유지되는지 구조 확인(`test/entity-composition-retry.test.mjs`의 stale-guard 검증 패턴 재사용) |
| 15 | Comparison Summary 정규화 문구 | `buildComparisonSummaryFacts`에 `targetPeriodBasis: "cutoff"` fixture를 넣어 CUTOFF_NORMALIZED caveat과 PERIOD_CHANGE fact가 함께 생성되는지, 기존 PARTIAL_PERIOD 문구가 이 경우 나오지 않는지 |
| 16 | 기존 전체월 회귀 | `test/brand-comparison-summary.test.mjs`(25개), `test/brand-intelligence-partial-period.test.mjs`(11개) 전체 재실행 — 전부 무변경 PASS 필수 |
| 17 | Customer Composition 재시도 회귀 | `test/entity-composition-retry.test.mjs`(6개) 재실행 — 이번 계획이 그 코드를 건드리지 않으므로 무변경 PASS 필수 |
| 18 | Category/Sell-through 무영향 | 기존 구조 assertion(`entityCategoryRows = []`, `BLOCKED · 공식 산식 필요`) 재확인 — 이번 계획이 해당 코드를 전혀 읽지 않았음을 grep으로 재확인 |

## 16. Change Surface

| 파일 | WHY | EXPECTED CHANGE | RISK |
|---|---|---|---|
| `server.mjs` | cutoff 아카이브를 만드는 새 함수 + 새 endpoint 필요 | `buildMonthlyCommerceCutoffArchive(month)`(신규 함수, §6) 추가, `GET /api/reports/monthly-cutoff` 라우트 1개 추가. 기존 `/api/reports/monthly`/`buildMonthlyArchive`/`enrichMonthlyArchiveBrandSales`는 **한 줄도 수정하지 않음** | **낮음** — 순수 추가, 기존 함수 재사용만, 기존 라우트 무변경이라 회귀 표면이 작음. 단 새 endpoint 자체의 인증/레이트리밋 정책은 기존 `/api/reports/monthly`와 동일 수준으로 맞춰야 함(구현 시 확인) |
| `outputs/samplas-marketing-os.js` | 클라이언트가 cutoff 모드를 판단하고, 새 endpoint를 재시도 포함으로 호출하고, 결과를 기존 state 구조에 흘려보내야 함 | (a) `getEntityCompareMonthlyArchiveCutoff(month)` 신규 헬퍼(§14, 재시도 패턴 재사용) (b) `refreshEntityCompareTargetPeriodData()` 안에서 `entityIsLiveMonthRow` 기반 분기 추가(§6) (c) `entityCompareTargetPeriodData`에 `targetPeriodBasis`/cutoff 범위 필드 추가 (d) `entityCompareMonthKeyLabel` 또는 그 호출부에 cutoff 라벨 로직(§11) (e) `buildComparisonSummaryFacts`의 `isLive` 분기 재설계(§12) | **중간** — (e)가 가장 신경 써야 할 지점(기존 PARTIAL_PERIOD 회귀 25개 테스트가 이미 이 분기를 정확히 검증하고 있음). (a)-(d)는 낮은 리스크(순수 추가/파생 필드) |
| `test/brand-comparison-summary.test.mjs` | §12의 새 `targetPeriodBasis` 분기 검증 | 신규 시나리오 추가(§15-15), 기존 25개는 무변경이어야 함 | 낮음(테스트 파일) |
| `test/brand-comparison-yoy-timeout.test.mjs` 또는 신규 유사 파일 | `getEntityCompareMonthlyArchiveCutoff`의 재시도 로직 검증 | 신규 시나리오 추가(§15-14), 기존 파일은 무변경 | 낮음 |
| `outputs/samplas-marketing-os.html` | Phase G가 "표 재설계 금지"를 명시했고, §11에서 기존 `<small>`/라벨 텍스트 재사용만으로 충분하다고 확인했으므로 | **변경 불필요**(라벨 문자열은 JS가 채우는 기존 자리, HTML 구조 자체는 무수정) | 없음 |
| `outputs/samplas-marketing-os.css` | 새 DOM/새 클래스가 없으므로 | 변경 불필요 | 없음 |

Category Intelligence/Sell-through/Customer Composition/master data 관련
파일은 이 변경 표면에 전혀 포함되지 않는다(§8, §18).

## 17. Implementation Sequence

저장소 아키텍처 기준으로 실제 도출한 순서(예시를 그대로 베끼지 않음):

```
P1. 서버: buildMonthlyCommerceCutoffArchive(month) 순수 함수 작성
    (기존 buildBrandSalesDiagnostics/buildMonthlyArchiveBrandSales 재사용,
    §6/§7의 clamp 로직 포함) + GET /api/reports/monthly-cutoff 라우트.
    이 단계만으로 curl 테스트 가능(§15의 서버 pure-function 테스트
    선행 가능) — 클라이언트는 아직 건드리지 않음.
P2. 클라이언트: getEntityCompareMonthlyArchiveCutoff(month) 헬퍼
    (재시도 패턴 포함) + refreshEntityCompareTargetPeriodData()의
    entityIsLiveMonthRow 기반 분기 + entityCompareTargetPeriodData
    확장 필드. 이 단계까지는 UI/Summary 문구가 아직 예전 그대로라도
    "잘못된 값"이 나오지 않아야 함(§15-6/16 회귀 우선 확인).
P3. Comparison Summary 엔진: targetPeriodBasis 입력 추가 + isLive 분기
    재설계(§12) — 가장 리스크가 큰 지점이므로 기존 25개 테스트를
    먼저 재실행해 정확히 무엇이 깨지는지 관찰하며 진행.
P4. UI 라벨: entityCompareMonthKeyLabel의 cutoff 문구(§11) — 가장
    마지막(눈에 보이는 변화이므로 앞 단계들의 데이터 정확성이 먼저
    검증된 뒤에 붙이는 것이 안전).
P5. 테스트 전체 작성/보강(§15의 18개 시나리오).
P6. 전체 회귀 스위트 실행(현재 296/296 기준선 유지 확인).
P7. Chrome QA(§Chrome QA 항목).
```

P1이 가장 먼저인 이유: 서버 함수는 클라이언트/UI/Summary 어느 것에도
의존하지 않는 순수 조합이라 독립적으로 완전히 검증 가능하고, 이후
모든 단계가 이 함수의 정확성을 전제로 하기 때문이다(가장 낮은 리스크,
가장 높은 재사용 가치).

## 18. Risks

- **가장 큰 리스크는 §12(Comparison Summary `isLive` 분기 재설계)다**
  — 이 분기는 현재 25개(brand-comparison-summary) + 11개
  (brand-intelligence-partial-period) 테스트가 보호하고 있는 코드다.
  `targetPeriodBasis`를 잘못 배선하면 "cutoff가 아닌데 PERIOD_CHANGE를
  생성"하거나 "cutoff인데 여전히 억제"하는 두 방향 모두의 회귀가
  가능하다 — 구현 시 기존 fixture(CARNET ARCHIVE/TROUBLED WATERS
  실측값)로 반드시 재대조.
- **재시도 정책을 빠뜨리면 STEP67-10G-1/Customer-Composition-retry-fix와
  동일한 버그가 세 번째로 재현된다** — §14에서 이미 명시적으로
  경고했으나, 실제 구현 시 "새 endpoint니까 일단 단순 timeout만
  넣고 나중에 고치자"는 유혹을 특별히 경계해야 한다.
- **`monthEndKey`/`todayKey`의 `env.REPORT_TIMEZONE` 의존성**: 두 헬퍼
  모두 같은 환경변수를 참조하므로 정합적이지만, 이 값이 배포 환경에서
  실제로 항상 설정돼 있는지(기본값 "Asia/Seoul"이 항상 맞는지)는 이번
  계획에서 재검증하지 않았다 — 기존 코드가 이미 이 패턴에 의존하고
  있으므로 새로운 리스크는 아니나, 완전히 배제된 것도 아니다.
- **cutoff 요청의 응답 시간**: §14에서 이미 다뤘듯 캐시가 없어 매번
  실시간 계산이다 — 재시도까지 포함하면 최악의 경우 38초까지 걸릴 수
  있다(Period Performance/Comparison Summary 전체가 이 하나의 fetch를
  기다림). 사용자 체감 지연이 실제로 허용 가능한 수준인지는 Chrome
  QA에서 확인이 필요하다.
- **새 endpoint의 `month >= currentMonth()` 400 검증**을 놓치면, 당월
  자체를 cutoff endpoint로 잘못 요청했을 때 `elapsedDay`가 항상 오늘의
  날짜와 같아 사실상 무해하지만(같은 값), 의미상 혼란(어느 endpoint가
  "진짜" 현재값의 소스인지)이 생길 수 있다 — 명확한 에러로 막는 것을
  권장.

## 19. GO / NO-GO

**GO** — 필요한 모든 원본 계산 함수가 이미 존재하고 이미 임의 날짜
범위를 지원함을 실측으로 확인했고(§4), 새로 만들어야 하는 부분은
얇은 오케스트레이션 한 겹뿐이며, 요청 수 증가가 없고, 기존 3개
Chrome-QA-PASS 흐름(완결기간 비교/단일 브랜드 Partial-Period/Customer
Composition 재시도) 중 어느 것도 코드 레벨에서 겹치지 않는다(§16).
단, §18의 리스크(특히 Comparison Summary 분기 재설계)를 고려해 실제
구현은 §17의 순서를 반드시 지켜 단계적으로 진행하고, 각 단계마다
기존 회귀 스위트(296개)를 재실행할 것을 권장한다.

---

====================
NEXT-CROSS-BRAND-PARTIAL-PERIOD PLAN
====================

GO / NO-GO:
GO

Canonical Calculation Owner:
서버 — 기존 canonical aggregator(buildBrandSalesDiagnostics, mergeOfflineBrandSales/buildMonthlyArchiveBrandSales) 재사용하는 신규 전용 함수(buildMonthlyCommerceCutoffArchive)

New API Required:
YES(1개, GET /api/reports/monthly-cutoff — 단, 새 집계 로직은 없음, 기존 함수 재사용만)

Same-Day Cutoff Supported By Existing Data:
YES(6개 지표 전부 — 원본 데이터와 집계 함수 모두 이미 임의 날짜 범위를 지원, 실측 재실행으로 검증됨)

Revenue:
READY

Units:
READY

Orders:
READY

AOV:
READY(같은 cutoff 윈도우의 revenue/orderCount가 항상 같은 행에서 나오므로 mixing 불가능한 설계)

Channel Mix:
READY(같은 cutoff 아카이브 행의 online/offline 필드 재사용, 무수정 가능)

Brand A/B Symmetry:
READY(브랜드별 분기 없음 — cutoff 여부는 기간 단위로만 결정, 기존 entityCompareKpiRowFromArchive 구조가 이미 대칭 보장)

Stale Archive Risk:
새 cutoff 경로는 구조적으로 회피(work/monthly 캐시 미사용) — 단 기존 /api/reports/monthly의 stale-cache 버그 자체는 REMAINS(이번 계획 범위 밖, 별도 STEP 필요)

UI Context Label:
REQUIRED(기존 <small> 라벨 텍스트에 "· N~M일" 추가, 새 DOM 불필요)

Comparison Summary Partial-Period Wording:
Option 2 권장 — cutoff 정규화 시 기존 PARTIAL_PERIOD("완결된 기간과 직접 비교하지 않았습니다")를 CUTOFF_NORMALIZED("동일 경과일 기준으로 비교했습니다")로 교체하고 PERIOD_CHANGE류 fact 생성을 허용. 엔진은 이 판단을 스스로 계산하지 않고 입력 필드(targetPeriodBasis)로만 받는다.

Files Expected:
server.mjs(신규 함수+라우트), outputs/samplas-marketing-os.js(cutoff 헬퍼/분기/라벨/Summary 재설계), test/brand-comparison-summary.test.mjs(확장), 신규 또는 기존 재시도 테스트 파일(확장). HTML/CSS 무수정.

Implementation Steps:
P1 서버 cutoff 함수+endpoint(독립 검증 가능) → P2 클라이언트 fetch/분기 배선(재시도 포함) → P3 Comparison Summary isLive 분기 재설계(최고 리스크 지점) → P4 UI 라벨 문구 → P5 테스트 작성 → P6 전체 회귀(296개 기준선) → P7 Chrome QA

Critical Risks:
Comparison Summary isLive 분기 재설계가 기존 36개(25+11) 테스트가 보호하는 회귀 위험 지대 / 재시도 정책 누락 시 STEP67-10G-1·Customer-Composition-retry-fix와 동일한 버그 3번째 재현 / cutoff 요청은 캐시 없이 매번 실시간 계산이라 최악 38초 지연 가능

Chrome QA Cases:
(1) CARNET ARCHIVE/TROUBLED WATERS 2026-08 vs 2026-07 cutoff 정규화 후 "1~11일" 라벨 및 정규화된 수치 확인 (2) 2026-08 vs 2025-08(YoY) 동일 확인 (3) 완결 6월 vs 완결 5월은 기존처럼 전체월 그대로인지(회귀) (4) Comparison Summary 문구가 CUTOFF_NORMALIZED로 바뀌고 PERIOD_CHANGE 문장이 안전하게(인과 표현 없이) 나오는지 (5) Customer Composition/Category Intelligence/Sell-through 무영향 확인

COMMIT:
NONE

PUSH:
NONE
====================
