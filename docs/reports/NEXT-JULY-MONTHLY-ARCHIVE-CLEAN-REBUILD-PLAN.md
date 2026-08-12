# NEXT — July Monthly Archive Clean Rebuild Plan (READ-ONLY DESIGN)

READ-ONLY 설계 전용. `work/monthly/2026-07.json`/소스/테스트/마스터
데이터/캐시/설정 전부 무수정. 후보 아카이브도 아직 생성하지 않았다.
git 쓰기 명령 미실행.

## 1. Executive Summary

`5b70343`(오프라인 신선도)과 `9459323`(SECOND MERGE 방지, 최초
생성 시 `brandSalesSourceImportedAt` 즉시 기록)이 이미 커밋됐고
334/334 회귀·STEP67·Customer Composition 전부 통과가 확인됐다.
이제 코드 자체는 **깨끗한 7월 아카이브를 처음부터 다시 만들
준비가 됐다**(§3에서 증명). 이 STEP은 그 재생성을 **아직
실행하지 않고**, 가장 안전한 절차만 설계한다.

핵심 설계 결정:
- **`buildMonthlyArchive("2026-07")`을 직접 호출**하는 것이 가장
  안전한 진입점이다 — 이 함수는 기존 아카이브 파일을 전혀 읽지
  않고, 매번 Cafe24/ECOUNT 원본에서 처음부터 계산한다(§3).
- 후보는 **메모리 안에서만** 만들고, 검증 전에는 어디에도 쓰지
  않는다 — `work/monthly/2026-07.json`은 검증이 끝나고 사용자
  승인이 있을 때까지 손대지 않는다(§4/§9).
- 교체 직전 현재(오염된) 파일을 스크래치패드에 타임스탬프
  백업해 절대 유일한 사본을 잃지 않는다(§4).
- 이미 이 세션에서 여러 차례 검증된 방법론(원본 ECOUNT/Cafe24
  재계산, STEP67 cutoff endpoint 교차검증, brand-by-brand 전수
  대조)을 그대로 재사용한다 — 새 검증 로직을 만들지 않는다.

## 2. Git State

```
HEAD: 9459323 fix(monthly): prevent duplicate offline brand merge
branch: main
staged: (없음)
work/monthly/2026-07.json: modified, unstaged (git status --short 확인)
```

이번 조사에서 어떤 파일도 쓰지 않았다.

## 3. Clean Build Entry Point

**답: `buildMonthlyArchive("2026-07")`을 서버 프로세스 없이 직접
import해서 호출하는 것이 가장 안전한 진입점이다.**

근거(코드 직접 확인):

- `export async function buildMonthlyArchive(month)`(server.mjs
  3840줄) 본문 전체를 확인 — **`readMonthlyArchive()`를 단 한
  곳에서도 호출하지 않는다.** 매번
  `buildBrandSalesDiagnostics(monthStart, monthEnd)`(Cafe24, 항상
  fresh) + `buildMetaAdsSummaryWithCache`/`buildMetaAdsFullReportWithCache`/
  `buildInstagramMonthlyDataWithCache`(각자 자체 캐시 정책)를 병렬로
  새로 계산하고, `buildMonthlyArchiveBrandSales(monthStart, monthEnd,
  commerceSource)`가 ECOUNT 오프라인을 새로 읽어 병합한다. **기존
  오염된 파일 내용은 이 경로 어디에도 입력되지 않는다** — 처음부터
  다시 계산한다.
- `9459323` 이후 `buildMonthlyArchiveBrandSales()`는
  `{ brandSales, sourceImportedAt }`를 반환하고, `buildMonthlyArchive()`
  는 이를 구조분해해 `commerce.brandSalesBasis: "online_offline"`과
  `commerce.brandSalesSourceImportedAt`을 **같은 병합 호출에서 함께**
  기록한다(server.mjs 3854-3866줄 직접 재확인) — 즉 이번에 새로
  만드는 후보는 **생성되는 순간부터 올바르게 "신선함" 표시가
  된다.**
- `writeMonthlyArchive(month, archive)`(export됨, server.mjs
  4206줄)는 `writeJsonAtomic()`(tmp 파일 생성 후 `rename`)을 써서
  이미 원자적이다 — 새 원자성 로직이 필요 없다.
- **기존 CLI/스크립트**: `scripts/refresh-monthly-sales.mjs`의
  `refreshMonthlySales()`가 `buildArchive(month)` +
  `validateMonthlyArchive(archive)`(상위 `sales.totalSales.amount ===
  onlineSales.paidAmount + offlineSales.offlineSalesAmount` 검증
  포함) + `writeArchive(...)` 패턴을 이미 갖고 있지만, **이 스크립트는
  디렉터리에서 새 XLSX 파일을 찾아야만 동작한다**(ECOUNT 재수입이
  전제) — 이번엔 ECOUNT 원본을 다시 가져올 필요가 없으므로(이미
  올바름, forensics에서 확인됨) 이 스크립트를 그대로 쓰는 것은
  맞지 않는다. 다만 그 `validateMonthlyArchive()` 함수 자체(순수
  검증 함수, I/O 없음)는 **후보 검증 단계에서 그대로 재사용**할
  가치가 있다(§8).
- **새 리빌드 스크립트가 필요한가**: **아니오.** `server.mjs`가
  `isMainModule` 가드로 HTTP 서버 시작을 막아두므로(이미 기존
  테스트 `test/runtime-auto-enrichment.test.mjs`의 "importing
  server.mjs does not start the HTTP server"로 검증됨),
  `import { buildMonthlyArchive, writeMonthlyArchive } from
  "./server.mjs"`로 **서버 프로세스 없이** 직접 호출하는 1회성
  스크립트(저장소에 커밋하지 않는 임시 스크립트, 스크래치패드에
  둠)면 충분하다 — 새 비즈니스 로직 없음, 기존 함수 재사용뿐이다.

## 4. Preservation Strategy

**추천: OPTION C(별도로 먼저 생성하고 완전히 검증한 뒤에만 교체)
+ 교체 직전 OPTION A(타임스탬프 백업).** 두 옵션을 조합한다 —
"먼저 완전히 검증"이 핵심이고, "교체 직전 백업"은 검증을 통과한
뒤에도 만일을 위한 마지막 안전망이다.

- **OPTION A(타임스탬프 백업)**: 교체 직전 현재 파일을
  `/private/tmp/claude-501/.../scratchpad/work-monthly-2026-07.pre-cleanup-<ISO
  timestamp>.json`로 복사한다 — `work/monthly/` 안이 아니라
  **세션 스크래치패드**에 둔다(이유: `discoverWorkSnapshotPaths()`/
  업로드 스크립트가 `work/monthly/YYYY-MM.json` 정확한 패턴만
  스캔하므로 다른 파일명은 애초에 간섭하지 않지만, 그래도 앱이
  참조하는 디렉터리 밖에 두는 것이 가장 안전하다).
- **OPTION B(임시로 옮기기)**: 채택하지 않음 — `work/monthly/2026-07.json`
  이 자리를 비우면 그 사이 `/api/reports/monthly?month=2026-07`
  요청이 들어올 경우 "draft"(캐시 없음) 브랜치를 타 버려 예상치
  못한 동작을 유발할 수 있다.
- **OPTION C(후보를 별도로 먼저 생성)**: **채택.** `buildMonthlyArchive("2026-07")`
  결과를 변수/임시 파일(`work/monthly/2026-07.candidate.json`처럼
  `discoverWorkSnapshotPaths()`의 정확한 정규식에 걸리지 않는
  이름 — 확인 필요, 안전하게는 스크래치패드에 두는 편이 더 확실)
  에 담아두고, **모든 검증(§8/§9/§10)을 통과하기 전까지는
  `work/monthly/2026-07.json` 자체를 전혀 건드리지 않는다.**

**절대 하지 않을 것**: 검증 전에 현재 유일한 로컬 사본을 덮어쓰거나
삭제하는 것.

## 5. Canonical Input Contract (변경 없음, 기존 규칙 그대로 문서화)

| 항목 | 소스/규칙 |
|---|---|
| Cafe24 온라인 | `buildBrandSalesDiagnostics(monthStart, monthEnd)` → `fetchCafe24Orders`(과거월은 `loadCanonicalCafe24OrderCache`로 로컬 캐시만, 라이브 API 재호출 없음) → `aggregateCafe24BrandSalesByBrandCode` |
| ECOUNT 오프라인 | `readEcountOfflineSalesSnapshot("2026-07", {workDir})` → `work/ecount-sales/2026-07.json`(이미 올바름, forensics에서 확인 — 재수입 불필요) |
| 브랜드 정규화 | `loadResolverContext()` + `resolveIdentity()`(scripts/unified-identity-resolver.mjs), 현재 `work/brand-master.json` 상태 그대로 사용 |
| 취소/환불 | 별도 로직 없음 — 원본 라인의 부호(양수/음수) 그대로 합산(mergeOfflineBrandSales 확인됨) |
| 온라인/오프라인 시맨틱 | `onlinePaidAmount`=그 병합 호출 시점 온라인 입력 스냅샷, `offlineSalesAmount`=그 호출에서 처리된 오프라인 라인 합, `salesAmount`/`canonicalPaidAmount`/`sales.paidAmount`=누적기(온라인 시작값+오프라인) |
| 수량/주문 시맨틱 | 분리 필드 없는 누적기(quantitySold/orderCount) |
| 배송비 제외 | 기존 `buildBrandSalesDiagnostics`/`computeCafe24OrderTotals` 정책 그대로(변경 안 함) |
| QQQ/CO 운영 품목그룹 | canonical brand key로 쓰지 않는 기존 정책 그대로(`mergeOfflineBrandSales` 내부, 변경 안 함) |

**새 비즈니스 로직을 추가하지 않는다** — 전부 기존에 이미 검증된
함수 그대로 재사용.

## 6. Known July Checkpoints (QA용, 재조정으로 재확정할 값)

| | Revenue | Online | Offline | Units | Orders | AOV |
|---|---:|---:|---:|---:|---:|---:|
| TROUBLED WATERS | 2,414,200 | 0 | 2,414,200 | 6 | 6 | 402,367 |
| CARNET ARCHIVE(예상, §Phase D 근거) | **23,303,130**(44,157,830 아님) | 2,448,430 | 20,854,700 | — | — | — |

**중요**: CARNET의 44,157,830은 SECOND MERGE로 오염된 값이었다
(forensics 리포트로 확정) — 깨끗한 재생성 결과는 **23,303,130이어야
한다.** 다만 이 리포트가 그 값을 최종 진실로 미리 단정하지는
않는다 — §8/§9의 독립 재조정으로 **재확인**하는 것이 필수 절차다.

## 7. Candidate Generation Strategy

```js
// 저장소에 커밋하지 않는 1회성 스크립트, 스크래치패드에 둠
import { buildMonthlyArchive } from "<repo>/server.mjs";
const candidate = await buildMonthlyArchive("2026-07");
// candidate는 메모리 / 스크래치패드 임시 파일에만 존재, work/monthly/2026-07.json 무수정
```

- 새 스냅샷 재수입 없음(§3에서 이미 확인 — ECOUNT는 이미 올바름).
- Cafe24는 과거월이므로 `fetchCafe24Orders`가 로컬
  `loadCanonicalCafe24OrderCache` 경로를 타 라이브 API를 재호출하지
  않는다(이미 확인된 기존 동작, 변경 없음).
- Meta Ads/Instagram도 함께 계산되지만(무거움, `buildMonthlyArchive`
  의 기존 설계 그대로) 이번 조사의 관심사(commerce.brandSales)와는
  무관 — 그대로 둔다(새 경량 경로를 만들지 않음, "기존 canonical
  함수 재사용" 원칙 준수).

## 8. Full Brand Reconciliation (재사용할 기존 방법론)

이미 이 세션에서 두 번 검증에 성공한 방법을 그대로 재사용한다
(`docs/reports/NEXT-MONTHLY-ARCHIVE-JULY-FULL-RECONCILIATION.md`,
`NEXT-JULY-HISTORICAL-ONLINE-SNAPSHOT-FORENSICS.md`):

1. `candidate.commerce.brandSales` 전체를 브랜드 코드로 맵핑.
2. **독립 재계산** — 원본 `work/ecount-sales/2026-07.json`을 직접
   읽어 `isOfflineRevenue===true` + 날짜범위 + `resolveIdentity()`
   필터로 오프라인을, `/api/diagnostics/brand-sales?since=2026-07-01&until=2026-07-31`
   (순수 온라인, `buildBrandSalesDiagnostics`를 그대로 노출하는
   기존 endpoint)로 온라인을 각각 독립적으로 재확인.
3. 브랜드별 `onlineRevenue`/`offlineRevenue`/`totalRevenue`/`units`/
   `orders`/`AOV`(반올림 정책은 기존과 동일: `Math.round(revenue/orders)`)
   비교.
4. 카운트 산출: canonical brands / candidate brands / exact matches /
   missing / extra / metric mismatches.
5. 목표: **0 unexplained mismatches** — 만약 불일치가 남으면 그
   즉시 원인을 code로 추적해야 하며(§7 forensics에서 했던 것과
   동일한 엄격도), 원인 불명인 채로 교체를 진행하지 않는다.

## 9. Total Reconciliation

```
sum(onlineRevenue) 검증 대상: candidate 내 전 브랜드 vs 순수 Cafe24 diagnostics 총액
sum(offlineRevenue) 검증 대상: candidate 내 전 브랜드 vs ECOUNT 원본 재계산 총액
sum(total) = sum(online) + sum(offline) 항등식 확인(mergeOfflineBrandSales 계약)
sum(units), sum(orders) 마찬가지로 비교
```

**7월 브랜드 롤업이 글로벌 7월 매출과 정확히 같아야 하는가**: 아니오
— `UNASSIGNED`(온라인 미배분/미매칭 오프라인)와, `commerce.paidAmount`
(온라인 그랜드토탈, 상품별 배분과 별개로 주문 자체의 결제 총액)
사이에는 이미 알려진, 의도된 차이가 있을 수 있다(`onlineAdjustment`
로직, `mergeOfflineBrandSales` 기존 설계) — 이는 결함이 아니라
브랜드 미배정 매출을 보존하기 위한 기존 정책이다. 재조정 시 이
항목이 나타나면 "예외"가 아니라 "정상"으로 문서화한다(§9 리포트
서식에 이미 반영됨).

## 10. Second-Merge Proof (idempotence)

기존에 이미 확립된 테스트 하네스 기법(`test/monthly-archive-freshness.test.mjs`
의 `sourceOf()`+`Function()` 추출 패턴, 시나리오 18/19와 동일한
방식)을 그대로 재사용한다 — **파일에 쓰지 않고** 메모리 안에서
검증:

```
1. candidate = await buildMonthlyArchive("2026-07")  (§7)
2. candidate.commerce.brandSalesBasis === "online_offline" 확인
3. candidate.commerce.brandSalesSourceImportedAt이 채워져 있는지 확인
4. served = await enrichMonthlyArchiveBrandSales(candidate, "2026-07")
   (테스트 하네스로 추출, 실제 ECOUNT 스냅샷을 그대로 다시 읽게 둠 —
   방금 만든 candidate와 같은 스냅샷이므로 importedAt이 일치해 fresh 판정)
5. 확인: served === candidate(참조 동일, 재병합 없음)
6. 확인: served.commerce.brandSales의 모든 필드가 candidate와
   byte-identical(특히 CARNET의 onlinePaidAmount/offlineSalesAmount/
   salesAmount가 그대로 23,303,130 계열 유지, 44,157,830으로
   바뀌지 않음)
```

이 절차가 통과하면 "이 candidate를 실제로 저장한 뒤 다음 요청이
들어와도 다시 오염되지 않는다"는 것을 배포 전에 증명하는 것이다.

## 11. Old vs Clean Diff

기존에 이미 두 차례 성공적으로 쓴 방법(`NEXT-MONTHLY-ARCHIVE-PRECOMMIT-NUMERIC-VERIFICATION.md`
방식)을 재사용:

```
현재(오염된) work/monthly/2026-07.json의 commerce.brandSales
  vs
candidate.commerce.brandSales

브랜드별: old revenue / new revenue / diff / old online / new online /
         old offline / new offline / old units / new units / old orders / new orders

TOP 20(절대 diff 기준) 리포트.

특히 플래그: "old가 raw_online + 2×offline 패턴을 따르고 new가
raw_online + 1×offline 패턴을 따르는" 브랜드들 — 이것이 정확히
SECOND MERGE가 교정되는 증거다.
```

CARNET ARCHIVE 예상(§6에서 이미 명시, **candidate 생성 후 §8/§9로
재확인 전까지 최종 진실로 취급하지 않음**):

```
오염됨(현재 로컬 파일): 44,157,830
깨끗한 후보(예상):      23,303,130
차이:                  -20,854,700
```

## 12. Replacement Strategy (실행은 다음 STEP)

1. §4의 타임스탬프 백업을 스크래치패드에 생성.
2. §8/§9/§10이 전부 통과한 candidate에 한해서만,
   `writeMonthlyArchive("2026-07", { ...candidate, archiveStatus: "saved" })`
   를 호출한다 — 이 함수는 이미 `writeJsonAtomic()`(tmp 파일 생성
   후 `rename`)을 쓰므로 원자적 교체가 보장된다, 새 원자성 코드
   불필요.
3. 교체는 **정확히 이 한 번의 함수 호출**로 끝난다 — 부분 쓰기,
   중간 상태 노출 위험 없음(rename은 POSIX상 원자적).
4. `work/monthly/` 밖의 다른 파일은 이 절차에서 전혀 건드리지
   않는다.
5. 이번 STEP에서는 **실행하지 않는다** — §8/§9/§10 검증 결과와
   old-vs-clean diff(§11)를 사용자에게 먼저 보여주고 명시적 승인을
   받은 뒤에만 다음 STEP에서 실행한다.

## 13. Archive Git Policy

**git 이력 조사(추측 없음)**:

```
git ls-files work/monthly/           → work/monthly/2026-07.json 단 하나만 추적됨
git log --oneline -- work/monthly/   → 4322b67 "data: backfill July offline sales archive"(2026-07-17) 단 한 커밋
```

- **다른 어떤 달(2026-01~06, 2026-08)도 git에 추적된 적이 없다.**
  `.gitignore`는 `work/`를 전체 제외하고 있고, 7월 파일은 그
  제외 규칙을 무시하고(force-add로 추정) **단 한 번, 예외적으로**
  커밋된 것이다.
- 저장소 전체에는 이 패턴(force-add된 `work/*.json` 진단/스냅샷
  파일들, 예: `work/cafe24-*.json`, `work/canonical-product-matching-*.json`)
  이 여러 개 더 있다 — "특정 시점의 데이터 스냅샷을 감사/기록
  목적으로 예외적으로 커밋해두는" 관행이 이 저장소에 산발적으로
  존재하지만, **월간 아카이브 전체에 대한 일관된 정책은 없다.**

**추천 정책**: **C(조건부)** — 이미 이 파일이 (예외적으로) 추적된
상태이므로, 아예 커밋하지 않고 영구히 "modified, unstaged" 상태로
방치하면 `git status`가 이 파일에 대해 계속 잡음을 내고, 이번
정리 작업의 감사 근거(무엇이 왜 고쳐졌는지)가 git 이력에 전혀
남지 않는다. **깨끗한 재생성 결과를 이 STEP과는 별개의, 명시적인
1회성 커밋으로 갱신**하는 것을 권장한다(예: `data: rebuild July
2026-07 monthly archive without second-merge corruption` 같은
명확한 메시지) — 단, 이는 **이번 STEP의 실행 범위가 아니며**,
사용자가 §11의 diff를 검토한 뒥 별도로 승인할 사안이다. 대안(비커밋,
`.gitignore`에 예외 추가해 완전히 무시)도 가능하지만, 이미 추적된
파일을 이력에서 지우려면 `git rm --cached`가 필요해 오히려 더 큰
git 조작이 된다 — **현상 유지(이미 추적됨) + 정기적이지 않은 1회성
갱신 커밋**이 가장 작은 변경이다.

## 14. Chrome QA Plan (실행은 교체 이후, 이번 STEP은 설계만)

```
1. Brand Intelligence → CARNET ARCHIVE 선택, 비교 모드 ON, 브랜드 B = TROUBLED WATERS
   Base: 2026-07, Compare: 2026-06
   확인: CARNET ARCHIVE 매출이 23,303,130원(44,157,830원이 아님),
         TROUBLED WATERS 매출 2,414,200원/6개/6건/402,367원,
         "데이터 연결 대기" 없음
2. 기준 월을 2026-08로 전환 → STEP67 partial-period 모드
   (2026-08 vs 2026-07, "동일 경과일 기준") 정상 표시 확인 —
   이번 교체가 STEP67 cutoff endpoint(항상 fresh, 캐시 무관)에
   영향을 주지 않음을 재확인
3. Customer Composition(7월, 두 브랜드) — ECOUNT 스냅샷 직접 읽는
   별도 경로이므로 이번 교체와 무관하게 정상이어야 함, 확인만
4. Channel Mix(7월 CARNET) — 온라인 2,448,430 / 오프라인 20,854,700
   비율로 정확히 표시되는지 확인
```

## 15. Implementation Sequence (다음 STEP들에서 실행할 순서)

```
1. 현재 로컬 아카이브를 스크래치패드에 타임스탬프 백업(§4)
2. buildMonthlyArchive("2026-07")로 candidate를 메모리/임시 위치에만 생성(§7)
3. brand-by-brand 전수 재조정(§8) — 0 unexplained mismatches 확인
4. 총계 재조정(§9)
5. Second-merge idempotence 증명(§10)
6. old-vs-clean diff 생성 및 사용자 검토(§11)
7. 사용자 승인 대기
8. writeMonthlyArchive()로 work/monthly/2026-07.json 교체(§12)
9. Chrome QA(§14)
10. 아카이브 커밋 여부 별도 결정(§13)
```

## 16. Risks

- Meta Ads/Instagram 등 무거운 부수 계산이 `buildMonthlyArchive()`
  안에 함께 있어, candidate 생성이 오프라인/온라인 재조정만 필요한
  이번 목적보다 느릴 수 있다(성능만의 문제, 정확성에는 영향 없음).
- Cafe24 온라인 데이터가 §Phase 9(온라인 freshness, 아직 미구현)
  대상이라, 이번에 생성하는 candidate의 "온라인" 성분은 여전히
  **현재 캐시된 Cafe24 데이터 기준**이다 — 이는 정확하지만
  (2026-08-05 시점의 오염된 값과 달리) SECOND MERGE 없이 1회만
  반영된, 있는 그대로의 canonical 값이다. 온라인 브랜드 마스터
  드리프트 재검증 메커니즘은 이번 STEP의 범위 밖(별도 STEP)이다.
- 사람이 개입하는 승인 단계(§11→§7 대기)가 있어 실행이 즉시
  자동화되지 않는다 — 의도된 안전장치.

## 17. GO / NO-GO

**GO(설계 승인 가능, 실행은 다음 STEP)** — 진입점이 코드로
증명됐고(§3), 보존 전략이 유일 사본을 절대 위험에 빠뜨리지
않으며(§4), 재조정/멱등성 증명 방법론이 이미 이 세션에서 실전
검증된 것을 재사용하고(§8-§10), 교체가 이미 원자적인 기존 함수
하나로 끝난다(§12). 실제 candidate 생성/재조정/교체는 사용자 승인
후 별도 STEP에서 진행할 것을 권장한다.

---

====================
JULY CLEAN REBUILD PLAN
====================

CURRENT JULY ARCHIVE:
CORRUPTED (SECOND MERGE, 이전 forensics로 확정)

CLEAN BUILD ENTRY POINT:
buildMonthlyArchive("2026-07") — server.mjs에서 직접 import, 서버 프로세스 불필요(isMainModule 가드로 안전)

USES EXISTING ARCHIVE AS INPUT:
NO (readMonthlyArchive를 전혀 호출하지 않음, 코드로 확인됨)

CAN GENERATE SEPARATE CANDIDATE:
YES (메모리/스크래치패드에만, work/monthly/2026-07.json 무수정)

RECOMMENDED PRESERVATION:
OPTION C(먼저 별도 생성·완전 검증) + 교체 직전 OPTION A(스크래치패드 타임스탬프 백업)

CURRENT ECOUNT MARKER PROPAGATION:
SAFE (9459323 이후 buildMonthlyArchive가 brandSalesBasis와 brandSalesSourceImportedAt을 같은 병합 호출에서 함께 기록)

SECOND MERGE PREVENTION:
READY

KNOWN CARNET RAW ONLINE:
2,448,430

KNOWN CARNET OFFLINE:
20,854,700

EXPECTED CLEAN CARNET TOTAL CANDIDATE:
23,303,130 (candidate 생성 후 §8/§9 독립 재조정으로 재확인 필요, 최종 확정 아님)

KNOWN TROUBLED WATERS TOTAL:
2,414,200

FULL BRAND RECONCILIATION REQUIRED:
YES

TOTAL RECONCILIATION REQUIRED:
YES

OLD VS CLEAN DIFF REQUIRED:
YES

ARCHIVE REPLACEMENT:
writeMonthlyArchive("2026-07", {...candidate, archiveStatus:"saved"}) — 기존 writeJsonAtomic()로 이미 원자적, 검증 통과 및 사용자 승인 후에만 실행

ARCHIVE SHOULD BE COMMITTED:
CONDITIONAL — 이미 예외적으로 추적된 파일이므로, §11 diff 검토 후 별도의 명시적 1회성 커밋을 권장(이번 STEP 범위 아님)

CHROME QA REQUIRED:
YES

CODE CHANGE REQUIRED FOR REBUILD:
NO

NEW REBUILD SCRIPT REQUIRED:
NO (기존 export된 buildMonthlyArchive()/writeMonthlyArchive()를 직접 호출하는 1회성 임시 스크립트로 충분, 저장소에 커밋 안 함)

GO / NO-GO:
GO (설계 승인 가능, 실행은 별도 STEP)

COMMIT:
NONE

PUSH:
NONE
====================
