# NEXT — July Monthly Archive Clean Replacement

승인된 검증 리포트: `docs/reports/NEXT-JULY-MONTHLY-ARCHIVE-CLEAN-CANDIDATE-RECONCILIATION.md`
(GO 승인). 이 STEP은 `work/monthly/2026-07.json`을 검증된 깨끗한
후보로 **실제 교체**했다. 소스/테스트/마스터 데이터/기타 파일은
전혀 건드리지 않았다. 커밋/푸시 없음.

## 1. Backup Verification

```
source: work/monthly/2026-07.json (교체 전)
backup: <scratchpad>/work-monthly-2026-07.pre-cleanup-20260811T164723Z.json (직전 STEP에서 생성)

교체 직전 재확인:
sha256(source): 7ed909be74d3a443e63eddbe14650b0f84729616d3de7012d812dd95dd94aad0
sha256(backup): 7ed909be74d3a443e63eddbe14650b0f84729616d3de7012d812dd95dd94aad0
일치: YES — 백업이 승인 리포트에 기록된 해시와 정확히 동일함을 재확인
```

## 2. Candidate Verification

지시사항에 따라 **재생성**(승인 리포트의 candidate를 그대로 재사용하지
않고, `buildMonthlyArchive("2026-07")`를 다시 호출)해 그 사이 상태
변화가 없는지 재확인했다:

```
CARNET ARCHIVE: revenue=23,303,130 online=2,448,430 offline=20,854,700 units=69 orders=66 aov=353,078  → MATCH
TROUBLED WATERS: revenue=2,414,200 online=0 offline=2,414,200 units=6 orders=6 aov=402,367  → MATCH
brandSalesBasis: "online_offline"
brandSalesSourceImportedAt: "2026-08-05T04:35:11.454Z"
```

두 체크포인트 모두 승인 리포트와 1원 단위까지 정확히 일치 — 쓰기
진행.

## 3. Atomic Replacement

```
writeMonthlyArchive("2026-07", { ...candidate, archiveStatus: "saved" })
```

`server.mjs`에서 export된 기존 함수를 그대로 호출했다(새 쓰기 로직
없음, `writeJsonAtomic()` — 임시파일 생성 후 `rename` — 이미
원자적). 셸 리다이렉션으로 수동 덮어쓰기하지 않았다. 정확히 이
한 번의 함수 호출로 교체가 끝났다.

```
saved.month: 2026-07
saved.archiveStatus: saved
saved.commerce.brandSalesBasis: online_offline
saved.commerce.brandSalesSourceImportedAt: 2026-08-05T04:35:11.454Z
```

## 4. Post-Write Verification

디스크에서 파일을 다시 읽어 직접 재확인(메모리 상 객체가 아니라
실제로 기록된 바이트를 검증):

```
month: 2026-07
archiveStatus: saved
commerce.brandSalesBasis: online_offline
commerce.brandSalesSourceImportedAt: 2026-08-05T04:35:11.454Z
ECOUNT 소스 importedAt: 2026-08-05T04:35:11.454Z
MARKER MATCH: YES

CARNET ARCHIVE: revenue=23,303,130 online=2,448,430 offline=20,854,700 units=69 orders=66 aov=353,078
TROUBLED WATERS: revenue=2,414,200 online=0 offline=2,414,200 units=6 orders=6 aov=402,367
```

## 5. Idempotence

실제 저장된 파일에 대해 **실제 정상 서빙 경로**(`GET
/api/reports/monthly?month=2026-07`, 실행 중인 서버로 실제 HTTP
호출 — 추출된 함수가 아니라 진짜 요청/응답 경로)로 검증:

```
서빙 요청 전 파일 SHA-256: 9cd0bda5cd49e61504b5cdc5d72ad85fe1d60e4ba0cf10f09d2793d028458346
서빙 요청 후 파일 SHA-256: 9cd0bda5cd49e61504b5cdc5d72ad85fe1d60e4ba0cf10f09d2793d028458346
일치(추가 쓰기 없음, enriched===cached로 재병합 안 됨): YES

응답 값:
archiveStatus: saved
brandSalesBasis: online_offline
brandSalesSourceImportedAt: 2026-08-05T04:35:11.454Z(불변)
CARNET ARCHIVE: revenue=23,303,130(불변, 44,157,830 아님)
TROUBLED WATERS: revenue=2,414,200(불변)
```

**POST-WRITE IDEMPOTENCE: PASS. SECOND MERGE 재발: NO.**

## 6. CARNET ARCHIVE Result

```
Revenue: 23,303,130원
Online:  2,448,430원
Offline: 20,854,700원
Units:   69개
Orders:  66건
AOV:     353,078원
```

Chrome UI(§8)에서도 1원 단위까지 동일하게 렌더링 확인.

## 7. TROUBLED WATERS Result

```
Revenue: 2,414,200원
Online:  0원
Offline: 2,414,200원
Units:   6개
Orders:  6건
AOV:     402,367원
```

"데이터 연결 대기" 없음(§8).

## 8. Chrome QA

실제 Chrome 브라우저로 로컬 서버(교체된 파일을 서빙 중인 그 서버)
확인:

1. Brand Intelligence → CARNET ARCHIVE, 2026년 7월 단독 조회:
   매출 23,303,130원 · 판매수량 69개 · 객단가 353,078원 · 주문수
   66건 · Channel Mix 온라인 2,448,430원/오프라인 20,854,700원 —
   전부 정확히 일치.
2. 비교 모드 ON, 비교 브랜드 TROUBLED WATERS, Base 2026-07 vs
   Compare 2026-06: Period Performance 표에 매출 2,414,200원/
   판매수량 6개/주문수 6건/객단가 402,367원 정확히 표시, "데이터
   연결 대기" 없음(무관한 CARNET 메타데이터 배지에만 그 문구가
   있음을 `document.body.innerText`로 재확인).
3. Monthly Trend 차트의 "최저 매출" 카드가 "23,303,130원
   2026-07"로 표시 — 별도의 독립 렌더링 경로에서도 동일 값 재확인.
4. 기준 월을 2026-08로 전환 → STEP67 partial-period 모드:
   "현재 기간 2026년 8월 · 8/1~8/12" / "비교 대상 2026년 7월 ·
   동일 경과일 기준 7/1~7/12" 정상 표시 — 이 교체와 무관하게 계속
   정상 동작(캐시 파일을 쓰지 않는 endpoint라 애초에 영향받지
   않음, 재확인).
5. Customer Composition(2026년 7월, 두 브랜드 모두) 정상 로드 —
   CARNET ARCHIVE 81건/TROUBLED WATERS 6건, 오류 없음.
6. Category Intelligence 섹션 정상 로드(스크롤 확인, 구조/화면
   무변경).
7. 콘솔 확인 — 이번 세션 동안 앱 자체의 런타임 에러 없음.

## 9. STEP67 Regression

§8-4에서 실제 UI로 재확인 + `test/cross-brand-period-cutoff.test.mjs`
전체(구조적 assertion 포함) 통과 — 이 교체가 STEP67 cutoff endpoint
(항상 fresh 계산, 캐시 파일 무관)에 어떤 영향도 주지 않음을 코드
테스트와 실제 UI 양쪽으로 확인.

## 10. Tests

```
targeted:
node --test test/monthly-archive-freshness.test.mjs test/cross-brand-period-cutoff.test.mjs
tests 24 / pass 24 / fail 0

full regression:
node --test 'test/**/*.test.mjs'
tests 334 / pass 334 / fail 0
```

## 11. Git Diff

```
git status --short (관련 부분만):
 M work/monthly/2026-07.json   (교체됨, 여전히 unstaged)
 M .gitignore / intelligence-service.mjs / outputs/samplas-marketing-os.{css,html} /
   scripts/build-brand-master-merge-plan.mjs / scripts/build-brand-sourcing-review-table.mjs /
   scripts/monthly-brand-sales.mjs / scripts/validate-brand-sourcing-decisions.mjs /
   test/monthly-brand-sales.test.mjs   (전부 이번 STEP과 무관, 무수정, 그대로 보존)

git diff --stat -- work/monthly/2026-07.json:
 work/monthly/2026-07.json | 8732 +++++++++++++++++++++++++++++++++++++++------
 1 file changed, 7551 insertions(+), 1181 deletions(-)

git diff --cached --name-only: (비어있음 — 아무것도 스테이징하지 않음)
HEAD: 9459323 (무변경)
```

(git HEAD의 7월 아카이브는 여전히 2026-07-17의 33행짜리 부분월
백필 스냅샷 — 이번 교체는 로컬 작업트리 파일만 바꿨고, 이 git
비교 대상 자체는 이전 STEP들과 동일하게 유지된다.)

## 12. Commit Recommendation

**커밋을 권장하되, 이번 STEP에서는 스테이징도 커밋도 하지
않았다** — 지시사항대로 실제 커밋 여부는 이 diff를 검토한 뒤 별도
STEP에서 사용자가 결정한다.

## 13. GO / NO-GO

**완료(교체 성공, 전 항목 검증 통과).** 다음 결정 사항: (1)
`work/monthly/2026-07.json`을 커밋할지, (2) 커밋한다면 정확히 어떤
메시지로 할지 — 이 두 가지만 남았다.

---

====================
JULY CLEAN ARCHIVE REPLACEMENT
====================

REPLACEMENT:
PASS

BACKUP VERIFIED:
YES

ATOMIC WRITE:
PASS

SOURCE MARKER:
PASS

CARNET ARCHIVE:
Revenue: 23,303,130원
Online: 2,448,430원
Offline: 20,854,700원
Units: 69개
Orders: 66건
AOV: 353,078원

TROUBLED WATERS:
Revenue: 2,414,200원
Online: 0원
Offline: 2,414,200원
Units: 6개
Orders: 6건
AOV: 402,367원

POST-WRITE IDEMPOTENCE:
PASS

SECOND MERGE REAPPEARED:
NO

CHROME QA:
PASS

STEP67:
PASS

CUSTOMER COMPOSITION:
PASS

CATEGORY INTELLIGENCE:
UNCHANGED

SELL-THROUGH:
UNCHANGED (화면 경로 자체가 이번 교체와 무관, 별도 확인 불필요할 만큼 구조적으로 독립적임을 코드로 이미 확인됨)

TARGETED TESTS:
[24/24]

FULL REGRESSION:
[334/334]

WORK/MONTHLY/2026-07.JSON:
REPLACED

STAGED:
NO

COMMIT:
NONE

PUSH:
NONE

SAFE TO REVIEW FOR ARCHIVE COMMIT:
YES

REPORT:
docs/reports/NEXT-JULY-MONTHLY-ARCHIVE-CLEAN-REPLACEMENT.md
====================
