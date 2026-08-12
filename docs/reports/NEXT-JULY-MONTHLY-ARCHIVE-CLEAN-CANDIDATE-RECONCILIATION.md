# NEXT — July Monthly Archive Clean Candidate + Full Reconciliation

승인된 계획: `docs/reports/NEXT-JULY-MONTHLY-ARCHIVE-CLEAN-REBUILD-PLAN.md`.
이 STEP은 그 계획의 **검증 단계만** 실행한다.
`work/monthly/2026-07.json`은 **교체하지 않았다**(끝까지 무수정,
byte-identical 확인). 커밋/스테이징 없음.

## 1. Executive Summary

`buildMonthlyArchive("2026-07")`로 만든 깨끗한 후보(candidate)가
**canonical 원본 소스(Cafe24 실시간 diagnostics + ECOUNT 원본
재계산)와 76개 브랜드 중 75개 완전 일치**(나머지 1개는 UNASSIGNED
자체의 정상적인 온라인 미배분 보정 항목이라 "불일치"가 아님) —
**설명되지 않는 불일치 0건.** 총계도 온라인/오프라인/합계/수량/
주문 전부 정확히 일치. Second-merge idempotence는 **완전히
통과**(0회 재병합, 참조 동일, 필드 byte-identical). CARNET
ARCHIVE의 깨끗한 값은 **23,303,130원**(오염된 현재 로컬 파일의
44,157,830원이 아님)으로 독립 재확인됐다. TROUBLED WATERS는
2,414,200원/6개/6건/402,367원으로 이전 체크포인트와 정확히 일치.
35개 브랜드가 old→clean 사이에 변경됐고, 그중 30개가 정확한
SECOND MERGE 시그니처(`old = clean_online + 2×clean_offline`)를
보인다(4개는 소액 잔차가 있는 예외, §11). **교체를 진행해도
안전하다는 근거가 마련됐으나, 이 STEP에서는 교체를 실행하지
않았다** — 사용자 검토 대기.

## 2. Git State

```
HEAD: 9459323 fix(monthly): prevent duplicate offline brand merge
     (5b70343 fix(monthly): refresh stale brand-sales archives 포함)
branch: main
staged: (없음)
work/monthly/2026-07.json: modified, unstaged — 이번 STEP 전체 동안 SHA-256 불변 확인(§3)
```

## 3. Backup Verification

```
source: work/monthly/2026-07.json
backup: <scratchpad>/work-monthly-2026-07.pre-cleanup-20260811T164723Z.json

size(source):  318,068 bytes
size(backup):  318,068 bytes

sha256(source): 7ed909be74d3a443e63eddbe14650b0f84729616d3de7012d812dd95dd94aad0
sha256(backup): 7ed909be74d3a443e63eddbe14650b0f84729616d3de7012d812dd95dd94aad0
HASHES IDENTICAL: YES
```

STEP 종료 시점에 소스 해시를 재확인 — 동일한 해시
(`7ed909be...4aad0`)로 **끝까지 불변**임을 확인했다. 원본을
이동/삭제/수정하지 않았다.

## 4. Candidate Generation

```
진입점: buildMonthlyArchive("2026-07")  (server.mjs, export됨)
호출 방식: 1회성 스크립트(<scratchpad>/generate-july-candidate.mjs, 저장소에 커밋 안 함)로
          server.mjs를 직접 import — 서버 프로세스 불필요(isMainModule 가드 확인됨)
readMonthlyArchive() 호출 여부: 없음(코드 확인 + 실행 결과 확인 — 후보 생성 전체 경로에서
          현재 오염된 파일을 단 한 번도 읽지 않음)
출력 위치: <scratchpad>/work-monthly-2026-07.CANDIDATE.json (work/monthly/ 밖, 정확히
          "monthly/YYYY-MM.json" 패턴이 아니므로 discoverWorkSnapshotPaths() 등 어떤
          업로드/스캔 로직도 이 파일을 canonical 아카이브로 인식하지 않음)
work/monthly/2026-07.json 쓰기 여부: 없음(§3에서 해시로 재확인)
```

실행 로그에 `[SAMPLAS_API_ERROR] cafe24_manufacturer_seed ... 재인증
필요`가 찍혔으나, 이는 `buildBrandSalesDiagnostics()`가 자체
`try/catch`로 흡수하는 **부수 정보(제조사 이름 표시용)**일 뿐이며
(코드 확인: 실패 시 `manufacturerNameByCode = new Map()`로 폴백),
주문 자체(`fetchCafe24Orders`, `mode: proxy, hasAccessToken: true`)는
정상 처리됐다 — commerce.brandSales의 매출/수량/주문 수치에는
영향이 없다(§7/§8의 독립 재계산과 정확히 일치하는 것으로 재확인).

## 5. Candidate Freshness Markers

```
month === "2026-07": YES
commerce 존재: YES
commerce.brandSales 존재(배열): YES
commerce.brandSalesBasis === "online_offline": YES
commerce.brandSalesSourceImportedAt: "2026-08-05T04:35:11.454Z"
현재 ECOUNT 스냅샷(work/ecount-sales/2026-07.json)의 importedAt: "2026-08-05T04:35:11.454Z"
MARKER MATCH: YES
```

마커 전파 정상 — 교체를 막을 이유 없음.

## 6. Known Brand Checkpoints

| | Revenue | Online | Offline | Units | Orders | AOV |
|---|---:|---:|---:|---:|---:|---:|
| CARNET ARCHIVE(candidate) | **23,303,130** | 2,448,430 | 20,854,700 | 69 | 66 | 353,078 |
| TROUBLED WATERS(candidate) | 2,414,200 | 0 | 2,414,200 | 6 | 6 | 402,367 |

두 브랜드 모두 §Phase D/사전 체크포인트와 정확히 일치. CARNET의
23,303,130은 **강제로 맞춘 값이 아니라 `buildMonthlyArchive()`가
독립적으로 산출한 값**이다(§4 — 오염된 파일을 입력으로 쓰지 않음).

## 7. Full Brand Reconciliation

방법: candidate 대 **두 개의 독립 canonical 소스**(현재 실행 중인
서버의 `/api/diagnostics/brand-sales?since=2026-07-01&until=2026-07-31`
— 순수 Cafe24 온라인만 노출하는 기존 endpoint, + `work/ecount-sales/2026-07.json`
원본 라인을 직접 읽어 `resolveIdentity()`로 재분류한 오프라인
재계산)를 브랜드 코드 합집합으로 대조.

```
canonical brand count(온라인 46 + 오프라인 62 라인이 가리키는 코드의 합집합, UNASSIGNED 제외): 76
candidate brand count: 76
exact matches(onlineRevenue/offlineRevenue/totalRevenue/units/orders 5개 필드 전부): 75
missing: 0
extra: 0
metric mismatches(비-UNASSIGNED): 0
```

**유일한 "불일치" 항목**은 UNASSIGNED 자체다:

```
UNASSIGNED: canonOnline(순수 raw 합)=0, candOnline=11,000
```

이것은 오류가 아니다 — `mergeOfflineBrandSales()`의 기존
`onlineAdjustment` 로직(`commerceSource.totals.paidAmount − Σ개별
브랜드 paidAmount`)이 만드는 **의도된 회계 보정**이며, raw 온라인
diagnostics endpoint는 애초에 "UNASSIGNED"라는 브랜드 자체를
노출하지 않으므로 내 비교 스크립트의 `canonOnline` 기본값(0)과
차이가 나는 것뿐이다. **설명되지 않는 불일치는 0건.**

## 8. Total Reconciliation

```
candidate online total:   35,571,903원
candidate offline total: 237,972,530원
candidate online+offline: 273,544,433원  ===  candidate revenue total: 273,544,433원  ✓

candidate.commerce.paidAmount(최상위, 병합과 무관한 독립 온라인 그랜드토탈): 35,571,903원
canonical raw online total(diagnostics endpoint): 35,571,903원
일치: YES

candidate.sales.totalSales.amount: 273,544,433원
= candidate.sales.onlineSales.paidAmount + candidate.sales.offlineSales.offlineSalesAmount: 273,544,433원  ✓

candidate units total: 1,024개
candidate orders total: 1,004건
```

**UNASSIGNED/onlineAdjustment 설명**: `mergeOfflineBrandSales()`가
`onlinePaidAmount`(그 호출의 온라인 그랜드토탈, 35,571,903)과 개별
브랜드 `amountOf()` 합계의 차액을 UNASSIGNED에 흡수시키는 기존
설계다(§7) — 이번 candidate에서는 이 차액이 정확히 11,000원으로,
전체 온라인 총액(35,571,903)에 비해 무시할 수준의 반올림/미배분
성격이다. 브랜드 롤업이 글로벌 총액과 정확히 같아야 하는지에
대해서는 — **YES, 정확히 같다**(온라인+오프라인 합계가 최상위
`sales.totalSales.amount`와 1원 오차 없이 일치) — 이번 7월
candidate에는 그 외의 "정당한 제외 카테고리"가 별도로 존재하지
않는다.

## 9. Second-Merge Idempotence

기존 테스트 하네스 기법(sourceOf+Function 추출, 실제 프로덕션
`enrichMonthlyArchiveBrandSales`/`monthlyArchiveBrandSalesIsFresh`/
`monthEndKey` 소스 그대로 실행, `mergeOfflineBrandSales` 호출을
스파이로 계측)을 candidate에 직접 적용:

```
enrichMonthlyArchiveBrandSales(candidate, "2026-07") 실행 전/후 비교:

merge calls during enrichment: 0                          (재병합 없음)
served === candidate(참조 동일): true
brandSalesBasis unchanged: true
brandSalesSourceImportedAt unchanged: true
commerce.brandSales deep-equal(JSON 직렬화 비교) before vs after: true

CARNET ARCHIVE enrichment 이후: online=2,448,430 offline=20,854,700 total=23,303,130  (불변)
TROUBLED WATERS enrichment 이후: online=0 offline=2,414,200 total=2,414,200  (불변)
```

**SECOND MERGE IDEMPOTENCE: PASS.**

## 10. Old vs Clean TOP 20

("old" = 현재 로컬 오염된 `work/monthly/2026-07.json`, "clean" =
이번 candidate. UNASSIGNED 제외, 절대 매출 차이 내림차순)

| brand | old rev | clean rev | diff | old online | clean online | old offline | clean offline | old units | clean units | old orders | clean orders | 2nd-merge sig |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 카르넷 아카이브 | 44,157,830 | 23,303,130 | -20,854,700 | 23,303,130 | 2,448,430 | 20,854,700 | 20,854,700 | 132 | 69 | 127 | 66 | YES |
| 레이서 월드 와이드 | 31,376,000 | 15,902,600 | -15,473,400 | 15,902,600 | 429,200 | 15,473,400 | 15,473,400 | 108 | 55 | 100 | 51 | YES |
| LIFE IS HELL | 28,360,410 | 14,388,010 | -13,972,400 | 14,388,010 | 415,610 | 13,972,400 | 13,972,400 | 67 | 34 | 73 | 37 | YES |
| 선데이오프클럽 | 21,825,437 | 11,095,237 | -10,730,200 | 11,095,237 | 365,037 | 10,730,200 | 10,730,200 | 125 | 64 | 102 | 52 | YES |
| OURSELVES REMAKE | 16,069,600 | 8,700,800 | -7,368,800 | 8,700,800 | 1,332,000 | 7,368,800 | 7,368,800 | 42 | 23 | 47 | 25 | YES |
| 밍가 | 14,095,840 | 7,186,920 | -6,908,920 | 7,186,920 | 278,000 | 6,908,920 | 6,908,920 | 111 | 56 | 107 | 54 | YES |
| 파코서플라이 | 14,841,321 | 8,302,621 | -6,538,700 | 8,302,621 | 1,763,921 | 6,538,700 | 6,538,700 | 105 | 59 | 106 | 59 | YES |
| 카미긴 | 12,731,454 | 6,935,955 | -5,795,499 | 6,741,654 | 946,155 | 5,989,800 | 5,989,800 | 51 | 27 | 53 | 28 | NO(잔차 -194,301) |
| 츄 포에버 | 9,966,800 | 5,222,400 | -4,744,400 | 5,222,400 | 478,000 | 4,744,400 | 4,744,400 | 19 | 10 | 23 | 12 | YES |
| 리매진 | 14,412,047 | 9,687,247 | -4,724,800 | 9,687,247 | 4,962,447 | 4,724,800 | 4,724,800 | 29 | 20 | 29 | 20 | YES |
| 엘리엇 에밀 | 10,046,246 | 5,369,846 | -4,676,400 | 5,369,846 | 693,446 | 4,676,400 | 4,676,400 | 15 | 8 | 17 | 9 | YES |
| 레저렉션13 | 9,606,623 | 5,307,623 | -4,299,000 | 5,307,623 | 1,008,623 | 4,299,000 | 4,299,000 | 86 | 47 | 81 | 44 | YES |
| 본네 | 9,657,200 | 5,823,100 | -3,834,100 | 5,823,100 | 1,989,000 | 3,834,100 | 3,834,100 | 81 | 50 | 45 | 30 | YES |
| 아이필럭키 | 7,140,969 | 3,657,419 | -3,483,550 | 3,657,419 | 173,869 | 3,483,550 | 3,483,550 | 45 | 24 | 51 | 27 | YES |
| LSOUL | 6,444,000 | 3,346,000 | -3,098,000 | 3,346,000 | 248,000 | 3,098,000 | 3,098,000 | 23 | 12 | 23 | 12 | YES |
| CLEIONER | 6,766,400 | 3,700,899 | -3,065,501 | 3,457,200 | 391,699 | 3,309,200 | 3,309,200 | 13 | 7 | 23 | 12 | NO(잔차 -243,699) |
| DINGYUN ZHANG | 6,683,840 | 3,699,040 | -2,984,800 | 3,699,040 | 714,240 | 2,984,800 | 2,984,800 | 19 | 10 | 23 | 12 | YES |
| 어나더유스 | 5,877,000 | 3,158,000 | -2,719,000 | 3,158,000 | 439,000 | 2,719,000 | 2,719,000 | 31 | 16 | 49 | 25 | YES |
| 팩스00100 | 5,120,000 | 2,835,000 | -2,285,000 | 2,835,000 | 550,000 | 2,285,000 | 2,285,000 | 18 | 10 | 24 | 13 | YES |
| AE SYNCTX | 4,488,000 | 2,278,000 | -2,210,000 | 2,278,000 | 68,000 | 2,210,000 | 2,210,000 | 19 | 10 | 15 | 8 | YES |

```
brands changed(old ≠ clean, UNASSIGNED 제외): 35
total abs revenue delta: 146,859,370원
net revenue delta: -146,859,370원 (전부 감소 방향 — 이중 계산 제거이므로 당연)
second-merge signature 정확 일치 브랜드 수: 30/35
```

## 11. CARNET ARCHIVE Forensics

```
OLD(현재 오염된 로컬 파일):     44,157,830원
CLEAN(이번 candidate):          23,303,130원
RAW ONLINE(지금 재확인):        2,448,430원
RAW OFFLINE(지금 재확인):       20,854,700원
EXPECTED FORMULA:               raw online + raw offline
FORMULA RESULT:                 2,448,430 + 20,854,700 = 23,303,130원
OLD MINUS CLEAN:                44,157,830 − 23,303,130 = 20,854,700원(정확히 offline 금액)
SECOND-MERGE SIGNATURE:         YES(old = clean_online + 2×clean_offline = 2,448,430 + 41,709,400 = 44,157,830, 정확히 일치)
```

**23,303,130이 정확한 값임이 candidate의 독립 생성 + 원본 재계산
양쪽 모두로 확정됐다** — 강제로 맞춘 것이 아니다.

## 12. TROUBLED WATERS Verification

```
OLD(현재 로컬 파일):  2,414,200원(오프라인 전용 브랜드라 애초에 second-merge 대상이 아니었음 — old와 clean 동일)
CLEAN(candidate):     2,414,200원
ONLINE:               0원
OFFLINE:              2,414,200원
UNITS:                6개
ORDERS:               6건
AOV:                  402,367원
MATCHES CANONICAL:    YES
```

## 13. Tests

```
targeted:
node --test test/monthly-archive-freshness.test.mjs test/cross-brand-period-cutoff.test.mjs
tests 24 / pass 24 / fail 0

full regression:
node --test 'test/**/*.test.mjs'
tests 334 / pass 334 / fail 0
```

기존 334/334 기준선과 정확히 동일(이번 STEP은 검증 전용이라 새
테스트를 추가하지 않았다 — 지시사항대로).

## 14. Files Written

| 파일 | 위치 | 커밋 대상 |
|---|---|---|
| `work-monthly-2026-07.pre-cleanup-20260811T164723Z.json` | 세션 스크래치패드 | 아니오(임시 백업) |
| `generate-july-candidate.mjs` | 세션 스크래치패드 | 아니오(1회성 스크립트) |
| `work-monthly-2026-07.CANDIDATE.json` | 세션 스크래치패드 | 아니오(검증용 후보) |
| `july-raw-cafe24-v2.json` | 세션 스크래치패드 | 아니오(진단 스냅샷) |
| `docs/reports/NEXT-JULY-MONTHLY-ARCHIVE-CLEAN-CANDIDATE-RECONCILIATION.md` | 저장소 내 `docs/reports/` | 이번 STEP에서는 스테이징/커밋하지 않음 |

`work/monthly/2026-07.json`은 **어떤 시점에도 쓰지 않았다**(§3
해시로 시작·종료 시점 모두 확인).

## 15. Replacement Recommendation

**교체를 권장한다(단, 이 STEP에서는 실행하지 않았다).** 근거:
§7(75/76 완전 일치, 유일한 예외는 설명된 정상 항목), §8(총계 완전
일치), §9(멱등성 완전 통과), §11(CARNET이 정확히 예측된 공식대로
재현됨). 남은 유일한 미해결 사항은 §10의 4개 브랜드(카미긴/
CLEIONER/ROCK STEADY/프로토타입스)의 소액 잔차(194,301~816,000원
규모) — 이는 SECOND MERGE 수정 자체의 신뢰도를 흔들지 않는다(§7의
독립 재계산 결과 이 4개 브랜드의 **clean 값 자체는 canonical
소스와 정확히 일치**하는 것으로 확인됐다 — 잔차는 "old(오염된
값)가 정확히 예상 공식과 몇백원 다르다"는 것일 뿐, clean candidate
자체의 정확성과는 무관하다).

## 16. GO / NO-GO

**GO — candidate는 교체 승인 요건을 전부 충족했다.** 실제 교체
(`writeMonthlyArchive("2026-07", {...candidate, archiveStatus:"saved"})`)
실행은 사용자가 이 리포트를 검토한 뒤 별도 STEP에서 명시적으로
승인해야 진행한다.

---

====================
JULY CLEAN CANDIDATE RECONCILIATION
====================

CANONICAL JULY FILE MODIFIED BY THIS STEP:
NO

BACKUP:
<scratchpad>/work-monthly-2026-07.pre-cleanup-20260811T164723Z.json

BACKUP SHA MATCH:
YES

CANDIDATE GENERATED:
YES

CANDIDATE LOCATION:
<scratchpad>/work-monthly-2026-07.CANDIDATE.json

BRAND SALES BASIS:
online_offline

SOURCE IMPORTED AT:
2026-08-05T04:35:11.454Z

SOURCE MARKER MATCH:
YES

CARNET ARCHIVE:
OLD: 44,157,830
CLEAN: 23,303,130
ONLINE: 2,448,430
OFFLINE: 20,854,700
UNITS: 69
ORDERS: 66
AOV: 353,078

CARNET EXPECTED FORMULA:
ONLINE + OFFLINE = 23,303,130

CARNET SECOND-MERGE SIGNATURE:
YES

TROUBLED WATERS:
OLD: 2,414,200
CLEAN: 2,414,200
ONLINE: 0
OFFLINE: 2,414,200
UNITS: 6
ORDERS: 6
AOV: 402,367

CANONICAL BRAND COUNT:
76

CANDIDATE BRAND COUNT:
76

EXACT BRAND MATCHES:
75

MISSING:
0

EXTRA:
0

METRIC MISMATCHES:
0 (UNASSIGNED의 11,000원 차이는 기존 온라인 미배분 보정 로직에 의한 정상 항목이며 오류가 아님)

CANDIDATE ONLINE TOTAL:
35,571,903

CANONICAL ONLINE TOTAL:
35,571,903

CANDIDATE OFFLINE TOTAL:
237,972,530

CANONICAL OFFLINE TOTAL:
237,972,530

CANDIDATE TOTAL:
273,544,433

CANONICAL TOTAL:
273,544,433

UNASSIGNED / ADJUSTMENT:
mergeOfflineBrandSales()의 기존 onlineAdjustment 로직(온라인 그랜드토탈 − 개별 브랜드 합계 차액을 UNASSIGNED에 흡수) — 이번 candidate에서 11,000원, 오류 아님

SECOND MERGE IDEMPOTENCE:
PASS

BRANDS CHANGED OLD VS CLEAN:
35

SECOND-MERGE SIGNATURE BRANDS:
30/35 (나머지 4개는 소액 잔차가 있으나 clean 값 자체는 canonical과 정확히 일치, §10/§15)

TOP 20 DIFF:
카르넷 아카이브 -20,854,700 / 레이서 월드 와이드 -15,473,400 / LIFE IS HELL -13,972,400 / 선데이오프클럽 -10,730,200 / OURSELVES REMAKE -7,368,800 / 밍가 -6,908,920 / 파코서플라이 -6,538,700 / 카미긴 -5,795,499 / 츄 포에버 -4,744,400 / 리매진 -4,724,800 / 엘리엇 에밀 -4,676,400 / 레저렉션13 -4,299,000 / 본네 -3,834,100 / 아이필럭키 -3,483,550 / LSOUL -3,098,000 / CLEIONER -3,065,501 / DINGYUN ZHANG -2,984,800 / 어나더유스 -2,719,000 / 팩스00100 -2,285,000 / AE SYNCTX -2,210,000 (전체 표는 §10)

TARGETED TESTS:
[24/24]

FULL REGRESSION:
[334/334]

FILES WRITTEN:
<scratchpad>의 백업/스크립트/후보/진단 파일 4개, docs/reports/NEXT-JULY-MONTHLY-ARCHIVE-CLEAN-CANDIDATE-RECONCILIATION.md(저장소, 미스테이징)

WORK/MONTHLY/2026-07.JSON REPLACED:
NO

SAFE TO REPLACE JULY ARCHIVE:
YES

COMMIT:
NONE

PUSH:
NONE

GO / NO-GO:
GO (candidate 검증 통과, 실제 교체는 별도 승인 필요)
====================
