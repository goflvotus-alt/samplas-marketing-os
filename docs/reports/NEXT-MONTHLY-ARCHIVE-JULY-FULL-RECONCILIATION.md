# NEXT — July Monthly Archive: Full Reconciliation (READ-ONLY)

READ-ONLY 검증. `work/monthly/2026-07.json`/소스/테스트/기존 리포트
전부 무수정. git 쓰기 명령 미실행.

## 1. Executive Summary

**오프라인(ECOUNT) 재병합 부분은 완전히 검증됐다** — 76개 브랜드
코드 전체에 대해 독립 재계산한 offline 금액이 현재 로컬 아카이브와
1원 단위까지 정확히 일치(0/76 불일치), 이미 커밋된
`fix(monthly): refresh stale brand-sales archives`(5b70343)의 근거는
확고하다.

**그러나 이번 전수 검증에서 새로운, 이전에 발견되지 않은 문제를
찾았다**: `commerce.brandSales`의 **온라인(Cafe24) 성분**이 브랜드
단위로는 "지금 다시 계산한 canonical 값"과 크게 다르다 — 온라인
매출이 있는 48개 브랜드 중 36개(75%)에서 브랜드별 온라인 금액이
불일치한다(단, 전체 합계는 정확히 일치 — §6). 이 문제는:

- 이번에 커밋된 오프라인 freshness 수리와 **무관하다**(그 수리는
  온라인 필드를 전혀 건드리지 않으며, 재병합 전후로 온라인 값이
  1원도 바뀌지 않았음을 이미 확인함, 별도 세션의 numeric-verification
  리포트 §1 참고).
- 근본 원인을 이번 조사에서 **확정하지 못했다**(동시-재계산 경합
  가설은 배제했으나 — 같은 7월을 base/comparison 양쪽에 넣어도
  동일하게 재현됨 — 진짜 원인은 미확정).
- 따라서 **work/monthly/2026-07.json 파일 자체(브랜드별 온라인
  데이터를 포함)를 git에 커밋하는 것은 지금 단계에서 권장하지
  않는다** — §14/§15.

**이미 커밋된 오프라인 freshness 코드 수리(5b70343)는 이 결론으로
철회되거나 의심받지 않는다** — 그 수리가 다루는 부분은 완전히
정확하다는 것이 이번 조사로 오히려 더 강하게 확인됐다.

## 2. Git State

```
HEAD: 5b70343 fix(monthly): refresh stale brand-sales archives
branch: main
staged: (없음)
work/monthly/2026-07.json: modified, unstaged (git diff --stat: 7675 insertions(+), 1243 deletions(-))
```

이번 조사에서 어떤 파일도 쓰지 않았다 — 로컬 서버(이미 실행 중,
포트 8787, 5b70343의 코드가 이미 로드됨)에 대한 읽기 전용 GET
요청과, 기존 파일 직접 읽기, `git show HEAD:...`를 통한 읽기 전용
git 조회만 사용했다.

## 3. Canonical July Source

기존 canonical 경로를 그대로 재사용했다 — 새 로직 없음:

```
GET /api/reports/monthly-comparison-cutoff?base=2026-07&compare=2026-06
  → resolveCrossBrandPeriodCutoff()가 7월을 완결월로 판정(isPartial:false,
    07-01~07-31, 오늘이 8월이므로) → buildCrossBrandPeriodWindow(range)
      → buildBrandSalesDiagnostics(range.startDate, range.endDate)   (Cafe24 온라인)
      → buildMonthlyArchiveBrandSales(...)                           (ECOUNT 오프라인 병합, mergeOfflineBrandSales 그대로)
```

이 endpoint는 `work/monthly/*.json` 캐시를 전혀 읽거나 쓰지 않고
항상 그 자리에서 재계산한다(STEP67 P1 설계, 이미 여러 차례 확인됨)
— "지금 다시 계산하면 어떤 값이 나오는가"를 얻는 가장 직접적인
방법이다. 취소/환불/QQQ/CO 등 기존 정책은 `mergeOfflineBrandSales`/
`aggregateCafe24BrandSalesByBrandCode` 내부에 그대로 있고, 이번
조사는 그 함수들을 전혀 수정하지 않았다.

## 4. Archive Population

```
canonical brands with July activity (endpoint): 76
archive brands with July activity (work/monthly/2026-07.json): 76
missing in archive: 0
extra in archive: 0
```

브랜드 코드 집합 자체는 완전히 일치한다 — 문제는 "어떤 브랜드가
있는가"가 아니라 "그 브랜드의 온라인 금액이 얼마인가"다.

## 5. Full Brand Reconciliation

| 항목 | 값 |
|---|---:|
| canonical brands | 76 |
| archive brands | 76 |
| exact brand matches(5개 필드 전부 일치) | 40 |
| missing in archive | 0 |
| extra in archive | 0 |
| metric mismatches | 36 |

**오프라인(offline)만 따로 보면 76/76 전부 정확히 일치(§7 이전
세션 검증과 동일 결과, 이번에 재확인).** 36개 불일치는 전부
**온라인(online) 필드 차이에서만** 발생한다:

- 온라인 매출이 0원인 28개(오프라인 전용 브랜드)는 100% 정확히
  일치(온라인 0=0이니 당연히 일치).
- 온라인 매출이 있는 48개 중 **12개만 정확히 일치**, **36개는
  브랜드별 온라인 금액이 다르다.**
- 이 36개의 diff 부호/크기가 (많은 경우) 그 브랜드 자신의 오프라인
  금액과 정확히 같은 크기로 나타나는 패턴을 발견했다(예: CARNET
  ARCHIVE canon 온라인=2,448,430 / 아카이브 온라인=23,303,130,
  차이 -20,854,700 = 그 브랜드의 오프라인 금액과 정확히 같음).
  같은 달(2026-07)을 base/comparison 양쪽에 동시에 넣어 재호출해도
  똑같이 재현돼 **동시성 경합(race condition)은 배제**했지만, 왜
  이런 패턴이 나오는지 근본 원인은 **미확정**이다.

## 6. Total Reconciliation

```
CANONICAL ONLINE TOTAL:  35,571,903원
ARCHIVE ONLINE TOTAL:    35,571,903원   ✓ 일치

CANONICAL OFFLINE TOTAL: 237,972,530원
ARCHIVE OFFLINE TOTAL:   237,972,530원  ✓ 일치

CANONICAL GRAND TOTAL:   273,544,433원 (= 35,571,903 + 237,972,530)
ARCHIVE GRAND TOTAL:     273,544,433원 (= 35,571,903 + 237,972,530)  ✓ 일치

CANONICAL UNITS:  1,024개
ARCHIVE UNITS:    1,911개   ✗ 불일치
CANONICAL ORDERS: 1,004건
ARCHIVE ORDERS:   1,794건   ✗ 불일치
```

**매출(revenue) 총액은 정확히 일치하지만 units/orders 총합은 크게
다르다.** 이는 §5의 브랜드별 온라인 불일치가 units/orders에도 함께
반영되기 때문이다 — 매출은 브랜드 간 재배분돼도 총합이 보존되는
구조(§7 참고)지만, 온라인 units/orders는 브랜드별로 다르게 세어지면
총합 자체도 달라질 수 있다(같은 주문이 다른 브랜드/개수로 집계되면
총 카운트가 달라짐 — 매출처럼 "재배분해도 합은 보존"되는 보장이
없음). **이 자체가 unexplained mismatch로 남는다** — 지시사항의
"명시적으로 설명되지 않는 한 mismatch로 취급" 원칙에 따라, revenue
총액 일치는 §14 GO 판단에 긍정적이지만 units/orders 총액 불일치는
**미해결 항목으로 명시**한다.

**"제외 규칙으로 인해 의도적으로 다른 경우"에 해당하는가**: 아니다
— 이 차이는 명시적으로 문서화된 제외 규칙(배송비 제외, gift 제외
등)이 아니라, 원인 미상의 온라인 브랜드 귀속 차이에서 온다.
그러므로 "설명된 제외"로 분류하지 않는다.

## 7. Restored Offline Revenue

이전 세션(commit 5b70343 이전)에서 이미 독립 검증했고, 이번에
**재확인(archive는 그 이후 무수정이므로 동일 결과)**:

```
restored offline revenue: 237,972,530원  (정확히 일치, 재확인됨)
affected real brands: 62개
```

- **정확한 금액**: 이번 조사의 canonical endpoint 호출로도 offline
  total이 다시 237,972,530원으로 재확인됐다(§6).
- **모든 복원 금액이 현재 canonical ECOUNT 데이터로 추적 가능한가**:
  YES — 76개 브랜드 전부, offline 필드가 canonical(endpoint) 값과
  1원 단위까지 정확히 일치(0/76 불일치, §5).
- **중복/제외 대상 행에서 온 것인가**: NO — `mergeOfflineBrandSales`의
  기존 필터(`isOfflineRevenue===true`, 날짜 범위, `resolveIdentity`)를
  그대로 통과한 라인만 반영되며, 이 필터는 이전 세션 numeric-
  verification에서 소스코드 대조로 이미 검증했다. 취소/환불 라인은
  음수 금액 그대로 합산돼 자연스럽게 상쇄된다(별도 배제 로직 없음,
  기존 정책 그대로).

**숫자가 정확히 237,972,530이 아니라면 왜인가**: 해당 없음 — 정확히
일치.

## 8. Top 20 Changes (HEAD vs Local)

**주의**: 여기서 "HEAD"는 `work/monthly/2026-07.json`이 git에
마지막으로 커밋된 상태(`4322b67 data: backfill July offline sales
archive`, 2026-07-17, `generatedAt: 2026-07-13T13:36:44.779Z`)다 —
**7월 13일 시점의 부분월(月中) 백필 스냅샷**이며, 이번 freshness
수리 하나만의 delta가 아니다(그 사이 5주간의 통상적인 온라인 주문
누적/동기화까지 전부 포함). 순수하게 "이번 수리가 만든 delta"는
§7의 62개 브랜드/237,972,530원이다.

| brand | HEAD revenue | local revenue | diff | online(H/L) | offline(H/L) | units(H/L) | orders(H/L) |
|---|---:|---:|---:|---|---|---|---|
| B00000KU 카르넷 아카이브 | 664,000 | 44,157,830 | +43,493,830 | 0 / 23,303,130 | 0 / 20,854,700 | 3 / 132 | 2 / 127 |
| B00000WE 레이서 월드 와이드 | 268,000 | 31,376,000 | +31,108,000 | 0 / 15,902,600 | 0 / 15,473,400 | 1 / 108 | 1 / 100 |
| B00000ZW LIFE IS HELL | 0(없음) | 28,360,410 | +28,360,410 | — / 14,388,010 | — / 13,972,400 | — / 67 | — / 73 |
| B00000HD 선데이오프클럽 | 416,000 | 21,825,437 | +21,409,437 | 0 / 11,095,237 | 0 / 10,730,200 | 2 / 125 | 2 / 102 |
| B0000BCU OURSELVES REMAKE | 0(없음) | 16,069,600 | +16,069,600 | — / 8,700,800 | — / 7,368,800 | — / 42 | — / 47 |
| B0000BCK 밍가 | 278,000 | 14,095,840 | +13,817,840 | 0 / 7,186,920 | 0 / 6,908,920 | 1 / 111 | 1 / 107 |
| B00000ZT 파코서플라이 | 1,102,000 | 14,841,321 | +13,739,321 | 0 / 8,302,621 | 0 / 6,538,700 | 7 / 105 | 6 / 106 |
| B00000YL COZY WORLDWIDE | 0(없음) | 12,905,300 | +12,905,300 | — / 0 | — / 12,905,300 | — / 30 | — / 38 |
| B0000BCQ 카미긴 | 398,000 | 12,731,454 | +12,333,454 | 0 / 6,741,654 | 0 / 5,989,800 | 1 / 51 | 1 / 53 |
| B00000UX 리매진 | 3,580,000 | 14,412,047 | +10,832,047 | 0 / 9,687,247 | 0 / 4,724,800 | 5 / 29 | 5 / 29 |
| B00000MJ 레저렉션13 | 75,000 | 9,606,623 | +9,531,623 | 0 / 5,307,623 | 0 / 4,299,000 | 1 / 86 | 1 / 81 |
| B0000BBS 츄 포에버 | 478,000 | 9,966,800 | +9,488,800 | 0 / 5,222,400 | 0 / 4,744,400 | 1 / 19 | 1 / 23 |
| B00000PY 엘리엇 에밀 | 798,000 | 10,046,246 | +9,248,246 | 0 / 5,369,846 | 0 / 4,676,400 | 1 / 15 | 1 / 17 |
| B00000SA 본네 | 1,642,000 | 9,657,200 | +8,015,200 | 0 / 5,823,100 | 0 / 3,834,100 | 12 / 81 | 9 / 45 |
| B00000RI 아이필럭키 | 175,000 | 7,140,969 | +6,965,969 | 0 / 3,657,419 | 0 / 3,483,550 | 3 / 45 | 3 / 51 |
| B0000BBA CLEIONER | 0(없음) | 6,766,400 | +6,766,400 | — / 3,457,200 | — / 3,309,200 | — / 13 | — / 23 |
| B0000BCH DINGYUN ZHANG | 0(없음) | 6,683,840 | +6,683,840 | — / 3,699,040 | — / 2,984,800 | — / 19 | — / 23 |
| B00000YY LSOUL | 0(없음) | 6,444,000 | +6,444,000 | — / 3,346,000 | — / 3,098,000 | — / 23 | — / 23 |
| B0000000 (미확정 코드) | 1,212,800 | 7,190,000 | +5,977,200 | 0 / 7,190,000 | 0 / 0 | 4 / 15 | 4 / 15 |
| B00000OE 어나더유스 | 0(없음) | 5,877,000 | +5,877,000 | — / 3,158,000 | — / 2,719,000 | — / 31 | — / 49 |

**플래그**:
- **사라진 브랜드**: 0개 — HEAD에 있던 33개 브랜드 전부 local에도
  존재한다.
- **새로 나타난 브랜드**: 42개(§8 표 상위 다수 포함) — HEAD가
  7월 13일 시점의 부분월 스냅샷이라 그 뒤 발생한 주문/브랜드가
  전부 새로 나타나는 것은 정상.
- **음수 diff(매출 감소)**: 6개 — `B00000UI(-1,299,303)`,
  `B00000UO(-1,252,800)`, `B00000VJ(-914,600)`, `B00000UR(-434,243)`,
  `B00000VM(-278,800)`, `B00000TQ(-211,200)`. HEAD가 월 중순(7/13)
  스냅샷이므로, 그 이후 취소/환불이 초기 부분월 값보다 크게 반영된
  경우 자연스럽게 음수가 될 수 있다 — 이례적이지 않다(추가 조사
  불필요, HEAD 자체가 부분월이라는 성격 때문).
- **이례적으로 큰 코드**: `B0000000`(브랜드명도 "B0000000") — 일반
  브랜드 코드 형식(B0000XXX)과 다른 placeholder성 코드로 보인다.
  버그로 단정하지 않되, 향후 브랜드 마스터 점검 대상으로 플래그.
- **매출 0원인데 units/orders는 있는 행**: 0건(§10 무결성 검사에서
  재확인).
- **매출은 있는데 orders가 0인 행**: 0건(§10).

## 9. Cross-System Consistency

- **Today / Monthly / Annual 화면**: 이번 조사에서 직접 열어
  대조하지는 않았다(과거월 조회는 이 아카이브 자체를 그대로
  서빙하므로 순환 검증이 되어 무의미 — Today/Monthly는
  `work/monthly/2026-07.json`을 그대로 반환하는 동일 경로다).
- **Commerce/Clients 화면**: 이들은 별도의 자체 Cafe24/ECOUNT 조회
  경로를 쓰며 이번 아카이브 파일을 참조하지 않는다 — 직접 비교할
  공통 지표가 없어 **INCONCLUSIVE**로 남긴다(추측하지 않음).
- **STEP67 cutoff endpoint 자신과의 일치**: 이 endpoint를 canonical
  소스로 사용했으므로 "일치 여부"를 그 자신과 비교하는 것은
  순환논리다 — 별도의 세 번째 독립 시스템 비교가 필요하지만
  이번 조사 범위에서는 확보하지 못했다. **INCONCLUSIVE.**
- 결론: 온라인 브랜드별 귀속 문제의 "어느 쪽이 진짜 맞는 값인가"를
  가릴 제3의 독립 소스가 이번 조사에서는 없었다 — 이는 §14 판단에
  직접 영향을 준다(추측 대신 INCONCLUSIVE로 명시).

## 10. Data Integrity Checks

전체 76개 브랜드 행에 대해 자동 검사, 결과 전부 클린:

```
duplicate brand_code rows: 없음
duplicate canonical brand identities: 없음(코드 유일성과 동일 검사)
missing brand_code: 0
blank brand names(UNASSIGNED 제외): 0
NaN/null numeric fields: 0
negative revenue(실제 브랜드, UNASSIGNED 제외): 0
negative units: 0
negative orders: 0
online + offline != total(실제 브랜드): 0건(전부 정확히 합산됨)
매출>0인데 orders=0: 0건
매출=0인데 units>0: 0건
```

**UNASSIGNED 버킷의 큰 음수값**(`paidAmount: -104,493,470`,
`onlinePaidAmount: -146,848,370`)은 무결성 위반이 아니라
`mergeOfflineBrandSales()`의 기존 설계다 — 온라인 총액(input)이
개별 브랜드에 배분된 합보다 작을 때 그 차액을 UNASSIGNED에
보정값으로 흡수하는 로직으로, `test/monthly-brand-sales.test.mjs`가
이미 검증하는 정상 동작이다("real brand"가 아니므로 §5/§10의
"실제 브랜드" 통계에서 제외했다).

## 11. Unexplained Differences

```
1. 브랜드별 온라인(Cafe24) 귀속 금액 불일치 — 36/48개 온라인-보유
   브랜드에서 canonical(지금 재계산) 값과 아카이브 저장값이 다름.
   전체 온라인 총액은 정확히 일치하지만 브랜드별 배분이 다르다.
   동시성 경합은 배제했으나 정확한 근본 원인은 미확정.
2. 그 결과로 파생되는 units/orders 총합 불일치(canonical 1,024개/
   1,004건 vs 아카이브 1,911개/1,794건).
```

이 두 항목은 서로 같은 근본 원인에서 파생된 하나의 이슈로 보이며,
**이번 세션에서 커밋된 오프라인 freshness 수리(5b70343)와는 무관한
별개의, 사전에 존재했던 문제**다(§1 근거).

## 12. CARNET ARCHIVE Verification

사용자가 제시한 "expected candidate"(아카이브 자신의 현재 값)와
정확히 일치:

```
Online:  23,303,130원  ✓
Offline: 20,854,700원  ✓
Total:   44,157,830원  ✓
Units:   132개          ✓
Orders:  127건          ✓
AOV:     round(44,157,830/127) = 347,699원  ✓
```

**PASS** — 단, §5/§6/§11에서 밝혔듯 "지금 다시 계산"하면 온라인이
2,448,430원으로 나온다(오프라인 20,854,700원은 동일) — 이 사실은
CARNET ARCHIVE 검증을 FAIL로 만들지 않는다(§8이 요구하는 것은
"현재 아카이브 값과 일치하는가"이고 이는 정확히 YES다), 하지만
"아카이브의 온라인 저장값 자체가 지금 다시 계산한 값과 다르다"는
사실은 §11의 미해결 항목으로 별도 기록한다.

## 13. TROUBLED WATERS Verification

```
Online:  0원          ✓ (canonical 재계산도 동일하게 0 — 이 브랜드는 온라인 카탈로그에 아예 없음, 불일치 대상 아님)
Offline: 2,414,200원  ✓
Total:   2,414,200원  ✓
Units:   6개           ✓
Orders:  6건           ✓
AOV:     402,367원     ✓
```

**PASS, 완전히 클린** — 이 브랜드는 온라인 성분이 아예 없는
오프라인 전용 브랜드라 §11의 온라인 귀속 문제 자체가 적용되지
않는다.

## 14. Decision

**BLOCK ARCHIVE COMMIT.**

**단, 이 판단은 이미 커밋된 `5b70343`을 되돌리거나 의심하는 것이
아니다** — 그 커밋(server.mjs의 freshness 로직 + 테스트 + 리포트)은
이번 조사로 오히려 더 강하게 재확인됐다(오프라인 76/76 완전 일치).
이번 BLOCK은 오직 **`work/monthly/2026-07.json` 데이터 파일 자체를
지금 git에 추가로 커밋하는 것**에 대한 판단이다.

BLOCK 사유(§11 대비 §11의 결정 규칙 "no unexplained mismatches"
엄격 적용):
- 브랜드별 온라인 귀속에 36개 브랜드에 걸친 설명되지 않은 불일치가
  남아있다(§5/§11).
- units/orders 총합이 canonical 재계산과 일치하지 않는다(§6).
- 제3의 독립 시스템과 교차검증할 방법이 이번 조사 범위에서
  확보되지 않아 INCONCLUSIVE로 남는 항목이 있다(§9).

통과한 항목(참고용, 아래 GO 판단 기준을 어느 하나라도 만족 못 해
전체는 BLOCK):
- CARNET ARCHIVE: PASS(§12)
- TROUBLED WATERS: PASS(§13)
- 복원된 오프라인 매출 설명: PASS(§7)
- 데이터 무결성: PASS(§10)
- 오프라인 성분 전수 일치: PASS(§5)
- 총매출(revenue) 합계 일치: PASS(§6)

## 15. Archive Commit Recommendation

1. **지금 이 시점에는 `work/monthly/2026-07.json`을 커밋하지
   않는다** — 위 BLOCK 사유가 해소될 때까지 로컬 미커밋 상태로 둔다
   (이미 그런 상태이며, 이번 조사도 그 상태를 변경하지 않았다).
2. **별도의 새 진단 STEP을 권장한다**: "온라인(Cafe24) 브랜드별
   귀속 신선도/안정성" — 이번에 발견한 문제(브랜드별 온라인 귀속이
   시점에 따라 달라짐, 총액은 보존되지만 배분이 다름)를 전담으로
   다루는 진단. 이는 이번 offline-freshness 수리와 구조적으로
   대칭되는 문제(온라인 버전의 "재검증 메커니즘 없음")일 가능성이
   높다.
3. 그 진단이 원인을 확정하고 (필요시) 수리한 뒤, 이 전수 재조정
   절차를 다시 실행해 온라인 성분까지 76/76 완전 일치를 확인한
   다음 `work/monthly/2026-07.json` 커밋을 재검토할 것을 권장한다.
4. 이미 커밋된 `5b70343`(오프라인 freshness 로직)은 그대로 유지한다
   — 되돌릴 근거가 없다.

---

====================
JULY MONTHLY ARCHIVE FULL RECONCILIATION
====================

CANONICAL BRANDS:
76

ARCHIVE BRANDS:
76

EXACT BRAND MATCHES:
40

MISSING IN ARCHIVE:
0

EXTRA IN ARCHIVE:
0

METRIC MISMATCHES:
36

CANONICAL ONLINE TOTAL:
35,571,903원

ARCHIVE ONLINE TOTAL:
35,571,903원

CANONICAL OFFLINE TOTAL:
237,972,530원

ARCHIVE OFFLINE TOTAL:
237,972,530원

CANONICAL GRAND TOTAL:
273,544,433원

ARCHIVE GRAND TOTAL:
273,544,433원

CANONICAL UNITS:
1,024개

ARCHIVE UNITS:
1,911개

CANONICAL ORDERS:
1,004건

ARCHIVE ORDERS:
1,794건

RESTORED OFFLINE REVENUE:
237,972,530원

RESTORED BRANDS:
62

CARNET ARCHIVE:
PASS

TROUBLED WATERS:
PASS

DATA INTEGRITY:
PASS

UNEXPLAINED DIFFERENCES:
브랜드별 온라인(Cafe24) 귀속 금액 불일치(48개 중 36개 브랜드) 및 이로 인한 units/orders 총합 불일치 — 오프라인 freshness 수리와는 무관, 근본 원인 미확정(§11)

DECISION:
BLOCK ARCHIVE COMMIT

REPORT:
docs/reports/NEXT-MONTHLY-ARCHIVE-JULY-FULL-RECONCILIATION.md

ARCHIVE MODIFIED DURING THIS STEP:
NO

COMMIT:
NONE

PUSH:
NONE
====================
