# NEXT — Monthly Archive First-Merge Freshness Marker Fix

구현 + 테스트 + Chrome QA 완료. **커밋하지 않음(사용자 명시 승인
대기).**

## Root Cause

`docs/reports/NEXT-JULY-HISTORICAL-ONLINE-SNAPSHOT-FORENSICS.md`에서
확정한 SECOND MERGE 버그: `buildMonthlyArchive()`가 최초로
`commerce.brandSales`를 만들 때 이미 `mergeOfflineBrandSales()`를
성공적으로 실행해 온라인+오프라인이 합쳐진 결과를 만들지만,
`brandSalesBasis: "online_offline"`만 기록하고 `5b70343`이 새로
도입한 `brandSalesSourceImportedAt` 마커는 기록하지 않았다. 그
결과 그 아카이브가 처음 서빙될 때 `enrichMonthlyArchiveBrandSales()`
가 마커 부재를 "stale"로 오판해 이미 병합된 `brandSales`를 다시
`mergeOfflineBrandSales()`에 입력으로 넣었고, `cloneBrand()`가 그
이미-합산된 총액을 `onlinePaidAmount`로 스냅샷한 뒤 오프라인을 한
번 더 더해 이중 계산됐다.

## Implementation

**`server.mjs`**, 두 함수만 수정:

1. **`buildMonthlyArchiveBrandSales(monthStart, monthEnd, commerceSource)`**
   — 반환값을 `mergeOfflineBrandSales(...)`(배열)에서
   `{ brandSales, sourceImportedAt }`로 바꿨다. `sourceImportedAt`은
   이 함수가 **이미 호출 중인** `readEcountOfflineSalesSnapshot()`의
   결과(`snapshot?.importedAt`)를 그대로 반환하는 것뿐 — 새 스냅샷
   읽기를 추가하지 않았다.
2. **`buildMonthlyArchive(month)`** — `buildMonthlyArchiveBrandSales()`
   호출을 구조분해로 받도록 변경(`const { brandSales, sourceImportedAt:
   brandSalesSourceImportedAt } = await buildMonthlyArchiveBrandSales(...)`)
   하고, `commerce` 객체 리터럴에 `brandSalesBasis: "online_offline"`
   바로 옆에 `brandSalesSourceImportedAt`을 함께 추가했다 — **두
   마커가 항상 같은 병합 호출에서, 같은 시점에 함께 기록된다.**
3. **`buildCrossBrandPeriodWindow(range)`**(STEP67 cutoff endpoint,
   `da1bc09`에서 도입, 이번 STEP과 무관) — `buildMonthlyArchiveBrandSales()`
   의 반환 형태 변경에 맞춰 `const { brandSales } = await
   buildMonthlyArchiveBrandSales(...)`로 구조분해만 추가했다.
   `.map(crossBrandPeriodBrandRow)`에 넘기는 `brandSales` 배열
   내용 자체는 완전히 동일 — STEP67 cutoff 시맨틱은 전혀 바뀌지
   않았다.

**변경하지 않은 것**: `cloneBrand()`, `mergeOfflineBrandSales()`의
누적기 시맨틱, `enrichMonthlyArchiveBrandSales()`,
`monthlyArchiveBrandSalesIsFresh()`, canonical paid amount/온라인/
오프라인 정의, Customer Composition, Category Intelligence,
Sell-through — 전부 원본 그대로.

## Marker Propagation Path

```
buildMonthlyArchive(month)
  → buildMonthlyArchiveBrandSales(monthStart, monthEnd, commerceSource)
      → readEcountOfflineSalesSnapshot(month, {workDir})  ← 1회만 읽음
      → mergeOfflineBrandSales({...})
      → return { brandSales, sourceImportedAt: snapshot.importedAt }
  → commerce = { ..., brandSalesBasis: "online_offline", brandSalesSourceImportedAt }
  → writeMonthlyArchive(month, {...archive, archiveStatus:"saved"})

(다음 서빙 시)
GET /api/reports/monthly?month=X
  → enrichMonthlyArchiveBrandSales(cached, month)
      → archiveImportedAt = cached.commerce.brandSalesSourceImportedAt  ← 이제 항상 채워져 있음
      → sourceImportedAt = (같은 스냅샷을 다시 읽어) 현재 importedAt
      → archiveImportedAt >= sourceImportedAt → fresh → 그대로 반환(재병합 없음)
```

## New Regression Test — 가장 중요

`test/monthly-archive-freshness.test.mjs`에 시나리오 16-20 추가(기존
1-15는 무수정):

```
✔ 16. buildMonthlyArchiveBrandSales() returns the exact ECOUNT snapshot
     importedAt used for the merge, no second snapshot read
✔ 17. first build produces the correct one-time-merged CARNET-like total
     (online 2,448,430 + offline 20,854,700 = 23,303,130)
✔ 18/19. a freshly-built archive (brandSalesBasis + brandSalesSourceImportedAt
     stamped together, mirroring buildMonthlyArchive()'s commerce object) is
     immediately fresh and is NOT re-merged on its first read — the exact
     missed scenario
✔ 20. buildMonthlyArchive()'s commerce object construction stamps
     brandSalesSourceImportedAt from the same buildMonthlyArchiveBrandSales()
     call that produces brandSales
```

시나리오 18/19가 지시된 정확한 A~E 순서를 그대로 구현한다: (A)
CARNET-유사 픽스처(온라인 2,448,430원 + 오프라인 20,854,700원)로
`buildMonthlyArchiveBrandSales()`를 호출해 1차 병합 결과를 만들고,
(B) 그 결과로 `buildMonthlyArchive()`의 commerce 객체와 동일한 모양
(`brandSalesBasis`+`brandSalesSourceImportedAt` 함께 존재)의 아카이브를
구성한 뒤, (C) 그것을 곧바로 `enrichMonthlyArchiveBrandSales()`에
통과시키고, (D) `mergeOfflineBrandSales` 호출 스파이가 **정확히
1회만**(재호출 없이) 기록됐음을 확인하고, (E) 결과 브랜드 값이
1차 병합 결과와 **byte-identical**하며 `44,157,830`으로 바뀌지
**않았음**을 확인한다.

## Existing Freshness Tests

```
node --test test/monthly-archive-freshness.test.mjs
tests 13
pass 13
fail 0
```

기존 시나리오 1-15(2026-08 이전 세션에서 커밋된 것) 전부 무수정,
전부 통과.

## Full Regression

```
node --test 'test/**/*.test.mjs'
tests 334
pass 334
fail 0
```

기존 330개(직전 커밋 `5b70343` 기준) + 신규 4개 = 334개, 전부 통과.
기존 테스트를 약화시키거나 삭제하지 않았다.

`test/cross-brand-period-cutoff.test.mjs`(STEP67 관련, `buildMonthlyArchiveBrandSales`
반환 형태 변경의 영향을 받을 수 있는 유일한 다른 테스트 파일)도
포함해 전부 통과 확인 — 해당 파일의 구조적 assertion
(`buildMonthlyArchiveBrandSales(range.startDate, range.endDate,
commerceSource)` 호출 패턴 정규식)은 내가 추가한 구조분해가 그
정확한 호출 문자열을 그대로 유지하므로 영향받지 않는다.

## Chrome QA

로컬 서버 재기동(수정된 코드 반영) 후 실제 Chrome으로 확인. **7월
아카이브를 건드리는 어떤 라우트도 호출하지 않았다** — 대신:

1. `GET /api/status` → 200
2. `GET /api/reports/monthly?month=2026-08`(현재/live 월 — 캐시
   읽기/쓰기 없이 매번 `buildMonthlyArchive()`를 직접 실행하는
   경로, `archiveStatus:"live"` 확인) → 정상 응답, brandSales 57건
3. Today 화면 로드 → 정상
4. Brand Intelligence 화면, 월 2026-08(current, live)에서 CARNET
   ARCHIVE 선택 → 매출/판매수량/객단가/Channel Mix 등 정상 렌더링,
   기존 세션들에서 봤던 8월 라이브 수치와 일치
5. 콘솔 확인 — Chrome 확장 프로그램의 표준 노이즈
   ("A listener indicated an asynchronous response...")만 있음,
   앱 자체의 런타임 에러 없음

**7월(또는 다른 과거월) Monthly/Brand Intelligence 화면은 의도적으로
열지 않았다** — 과거월 조회는 `enrichMonthlyArchiveBrandSales()`를
거쳐 잠재적으로 `writeMonthlyArchive()`를 호출할 수 있는 경로라
(이번 STEP 지시사항 "Do NOT rebuild any monthly archive"에 따라)
피했다.

## Proof July Archive Remained Untouched

구현+테스트+QA 전 과정 동안, 시작 시점과 끝 시점의 `git diff --stat
-- work/monthly/2026-07.json`이 **완전히 동일**함을 확인했다:

```
work/monthly/2026-07.json | 8918 ++++++++++++++++++++++++++++++++++++++-------
 1 file changed, 7675 insertions(+), 1243 deletions(-)
```

(이 STEP 시작 전과 QA 이후 모두 동일한 7675/1243 — 단 1바이트도
추가로 변경되지 않았다.)

## Git Diff Summary

```
git status --short (work-tree 관련 부분만):
 M server.mjs                              (이번 STEP)
?? test/monthly-archive-freshness.test.mjs → M (이번 STEP, 기존 커밋되지 않은 새 파일이 수정됨)
 M work/monthly/2026-07.json               (무수정, 이전 상태 그대로 유지)
 M .gitignore / intelligence-service.mjs / outputs/samplas-marketing-os.{css,html} /
   scripts/build-brand-master-merge-plan.mjs / scripts/build-brand-sourcing-review-table.mjs /
   scripts/monthly-brand-sales.mjs / scripts/validate-brand-sourcing-decisions.mjs /
   test/monthly-brand-sales.test.mjs        (전부 이번 STEP과 무관, 사전 존재, 무수정 그대로 보존)
```

```
git diff --stat -- server.mjs test/monthly-archive-freshness.test.mjs:
 server.mjs                              |  15 +++-
 test/monthly-archive-freshness.test.mjs | 133 ++++++++++++++++++++++++++++++++
 2 files changed, 145 insertions(+), 3 deletions(-)
```

staged 파일 없음(`git diff --cached --name-only` 빈 결과), 커밋
없음.

## Files Modified

| 파일 | 내용 |
|---|---|
| `server.mjs` | `buildMonthlyArchiveBrandSales()` 반환값에 `sourceImportedAt` 추가, `buildMonthlyArchive()`가 `brandSalesSourceImportedAt`을 즉시 기록, `buildCrossBrandPeriodWindow()`는 새 반환 형태에 맞춰 구조분해만 추가(동작 무변경) |
| `test/monthly-archive-freshness.test.mjs` | 신규 시나리오 16-20, 기존 1-15 무수정 |
| `docs/reports/NEXT-MONTHLY-FIRST-MERGE-FRESHNESS-MARKER-FIX.md` | 본 보고서 |

`work/monthly/2026-07.json`(또는 다른 어떤 아카이브 파일)도, 다른
소스/테스트/마스터 데이터/설정도 이번 STEP에서 건드리지 않았다.

## Commit Recommendation

**YES** — 근본 원인이 정확히 좁은 지점(마커 기록 누락)에서
수리됐고, 새 회귀 테스트가 정확히 놓쳤던 시나리오를 재현해
막으며, 기존 334개 테스트 전부 통과, Chrome QA 정상, 7월 아카이브
무변경 확인. 다만 **이번 STEP 지시사항에 따라 커밋은 수행하지
않았다** — 사용자 승인 후 별도로 진행.

---

====================
MONTHLY FIRST-MERGE FRESHNESS MARKER FIX
====================

ROOT CAUSE:
SECOND MERGE / missing first-generation source marker

IMPLEMENTATION:
buildMonthlyArchiveBrandSales()가 { brandSales, sourceImportedAt }을 반환하도록 변경(새 I/O 없음, 이미 읽은 스냅샷의 importedAt 재사용). buildMonthlyArchive()가 이를 구조분해해 commerce.brandSalesSourceImportedAt을 brandSalesBasis와 함께 즉시 기록. buildCrossBrandPeriodWindow()는 새 반환 형태에 맞춰 구조분해만 추가(동작 무변경).

MARKER SOURCE:
buildMonthlyArchiveBrandSales() 내부에서 이미 호출 중인 readEcountOfflineSalesSnapshot()의 snapshot.importedAt

SAME SNAPSHOT AS FIRST MERGE:
YES

NEW FIRST-BUILD MARKER TEST:
PASS (시나리오 16/17/20)

SECOND MERGE REGRESSION TEST:
PASS (시나리오 18/19)

CARNET-LIKE FIXTURE AFTER FIRST MERGE:
Online: 2,448,430원
Offline: 20,854,700원
Total: 23,303,130원

CARNET-LIKE FIXTURE AFTER ENRICHMENT:
Online: 2,448,430원
Offline: 20,854,700원
Total: 23,303,130원

DOUBLE COUNT PREVENTED:
YES

EXISTING FRESHNESS TESTS:
[13/13]

RELATED MONTHLY TESTS:
[13/13] (test/monthly-archive-freshness.test.mjs 전체, 1-20)

FULL REGRESSION:
[334/334]

CHROME QA:
PASS

JULY ARCHIVE MODIFIED:
NO

CANONICAL SALES SEMANTICS:
UNCHANGED

STEP67 REGRESSION:
PASS (test/cross-brand-period-cutoff.test.mjs 전체 통과, 구조적 assertion 포함)

CUSTOMER COMPOSITION:
PASS (무수정, buildBrandCustomerComposition()은 이 변경과 무관한 별도 경로)

CATEGORY INTELLIGENCE:
UNCHANGED

SELL-THROUGH:
UNCHANGED

FILES MODIFIED:
server.mjs, test/monthly-archive-freshness.test.mjs, docs/reports/NEXT-MONTHLY-FIRST-MERGE-FRESHNESS-MARKER-FIX.md

UNRELATED PRE-EXISTING FILES:
PRESERVED

COMMIT RECOMMENDATION:
YES

COMMIT:
NONE

PUSH:
NONE

REPORT:
docs/reports/NEXT-MONTHLY-FIRST-MERGE-FRESHNESS-MARKER-FIX.md
====================
